#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""ORBIT — ICP（迭代最近点 + Kabsch）直接解 bisous 骨架的旋转

不再猜「银道 / 超星系 / 轴序」。把 table2 的 3D 点云与 SDSS 星系 3D 点云
做 ICP：每轮找最近邻、SVD 求最优旋转，迭代到收敛，直接读出旋转矩阵。
骨架在纤维轴上、星系离轴 d_fil（~1-3 Mpc），平均偏移应为零，所以 ICP
估出的旋转应接近真实坐标系。若中位最近邻距离收敛到 ~3-5 Mpc，说明对齐了。
"""
import struct, math
import numpy as np

RGAL = np.array([[-0.0548755604, -0.8734370902, -0.4838350155],
                 [ 0.4941094279, -0.4448296300,  0.7469822445],
                 [-0.8676661490, -0.1980763734,  0.4559837762]])
RSG = np.array([[-0.735742574804, -0.074553778365, 0.673145302109],
                [ 0.677261296414, -0.080991471307, 0.739271887780],
                [0.0,             0.993922590400, 0.018574938953]])

def load_fil(sample=4000):
    pts = []
    for line in open('_cat/fil2.tsv', encoding='utf-8', errors='ignore'):
        p = line.rstrip('\n').split('\t')
        if len(p) < 5:
            continue
        try:
            pts.append((float(p[2]), float(p[3]), float(p[4])))
        except ValueError:
            pass
    if len(pts) > sample:
        step = len(pts) // sample
        pts = pts[::step][:sample]
    return np.array(pts)

def load_sdss(sample=6000):
    b = open('public/data/galaxies.bin', 'rb').read()
    n = struct.unpack('<I', b[4:8])[0]
    dmax = struct.unpack('<f', b[8:12])[0]
    rows = []
    for i in range(min(173342, n)):
        o = 12 + i * 5
        val = int.from_bytes(b[o:o+5], 'little')
        ra = ((val >> 28) & 0xFFF) / 4095.0 * 360.0
        dec = ((val >> 16) & 0xFFF) / 4095.0 * 180.0 - 90.0
        d = ((val >> 5) & 0x7FF) / 2047.0 * dmax
        a, bb = math.radians(ra), math.radians(dec)
        x = d * math.cos(bb) * math.cos(a)
        y = d * math.cos(bb) * math.sin(a)
        z = d * math.sin(bb)
        rows.append((x, y, z))
    if len(rows) > sample:
        step = len(rows) // sample
        rows = rows[::step][:sample]
    return np.array(rows)

def nn_dist(P, Q, cell=30.0):
    """对 P 每个点在 Q 里找最近邻，返回 (距离数组, 配对 Q 点)"""
    grid = {}
    for q in Q:
        k = (int(q[0]//cell), int(q[1]//cell), int(q[2]//cell))
        grid.setdefault(k, []).append(q)
    dists = np.empty(len(P)); match = np.empty_like(P)
    for i, p in enumerate(P):
        cx, cy, cz = int(p[0]//cell), int(p[1]//cell), int(p[2]//cell)
        best = 1e18; bq = None
        rng = 2
        for di in range(-rng, rng+1):
            for dj in range(-rng, rng+1):
                for dk in range(-rng, rng+1):
                    for q in grid.get((cx+di, cy+dj, cz+dk), ()):
                        dd = (q[0]-p[0])**2 + (q[1]-p[1])**2 + (q[2]-p[2])**2
                        if dd < best:
                            best = dd; bq = q
        dists[i] = math.sqrt(best) if bq is not None else 1e6
        match[i] = bq if bq is not None else p
    return dists, match

def kabsch(P, Q):
    Pc = P - P.mean(0); Qc = Q - Q.mean(0)
    H = Pc.T @ Qc
    U, S, Vt = np.linalg.svd(H)
    d = np.sign(np.linalg.det(Vt.T @ U.T))
    R = Vt.T @ np.diag([1, 1, d]) @ U.T
    return R

def axang(R):
    ang = math.degrees(math.acos(max(-1.0, min(1.0, (np.trace(R)-1)/2))))
    return ang

P0 = load_fil() / 0.7          # table2 是 Mpc/h，SDSS 用 H0=70 的真实 Mpc
Q = load_sdss()
print('fil %d  sdss %d' % (len(P0), len(Q)))
print('P dist  min/med/max %.0f/%.0f/%.0f' % (np.linalg.norm(P0, axis=1).min(),
      np.median(np.linalg.norm(P0, axis=1)), np.linalg.norm(P0, axis=1).max()))
print('Q dist  min/med/max %.0f/%.0f/%.0f' % (np.linalg.norm(Q, axis=1).min(),
      np.median(np.linalg.norm(Q, axis=1)), np.linalg.norm(Q, axis=1).max()))

for init_name, initR in [('I', np.eye(3)), ('RGAL', RGAL), ('RGAL_T', RGAL.T),
                         ('RSG', RSG), ('RSG_T', RSG.T)]:
    R = initR.copy()
    P = P0 @ R.T
    d0, m0 = nn_dist(P, Q)
    prev = np.median(d0)
    for it in range(30):
        d, match = nn_dist(P, Q)
        # 只用较近的配对做 Kabsch（剔除骨架落在 SDSS 空洞里的点）
        thr = np.percentile(d, 70)
        ok = d < max(thr, 8.0)
        if ok.sum() < 50:
            break
        Rk = kabsch(P[ok], match[ok])
        # 累积旋转：P 已经是 P0@R.T，再左乘 Rk
        R = Rk @ R
        P = P0 @ R.T
        med = np.median(d)
        if abs(prev - med) < 0.05:
            break
        prev = med
    d, _ = nn_dist(P, Q)
    print('init %-7s -> conv medDist %.2f Mpc  median-all %.2f  rot %.1f deg'
          % (init_name, np.median(d), np.median(d), axang(R)))
    if init_name in ('RSG_T', 'RGAL_T'):
        np.save('/tmp/R_%s.npy' % init_name, R)
        print('   R_%s=' % init_name)
        print('   ' + str(np.round(R, 6)).replace('\n', '\n   '))
