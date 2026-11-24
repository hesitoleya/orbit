#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""ORBIT — 用 SDSS Survey Coordinates 正解 bisous 骨架（替代 106/107 的错误反解）

106/107 把 table2 的 (x,y,z) 当赤道笛卡尔反解，骨架天区铺满全天（中位 Dec 0.6°），
与真实 SDSS 星系（中位 Dec 25°）差 22°+。107 用 IDpt 配对 + Kabsch 也失败，
因为 table2 是纤维骨架轴上的点、table3 是纤维周围星系，本就有 d_fil 偏移。

真正原因：table2 是 **SDSS Survey coordinates (η,λ)** 的笛卡尔：
  论文公式 1：x=-d sinλ, y=d cosλ cosη, z=d cosλ sinη
  => survey 笛卡尔 vs = (y, z, -x)/d
SDSS 定义 (η,λ)=(0,0)/(0,90)/(57.5,0) 对应 (RA,Dec)=(185,32.5)/(275,0)/(0,90)，
是纯旋转；用三个锚点构建 R，天区命中率 0.0 -> 0.69，medDec/medRA 与 SDSS 差 2~5°。

输入：_cat/fil2.tsv（VizieR asu-tsv：ID, IDpt, x, y, z）
输出：public/data/filaments.bin（格式与旧版一致，运行时 decode 不用改）
"""
import sys, struct, math, json, os
import numpy as np

TOL = 0.5
DMAX = 900.0
OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'data', 'filaments.bin')

def eqvec(ra, dec):
    a, d = math.radians(ra), math.radians(dec)
    return np.array([math.cos(d)*math.cos(a), math.cos(d)*math.sin(a), math.sin(d)])

def survec(eta, lam):
    e, l = math.radians(eta), math.radians(lam)
    return np.array([math.cos(e)*math.cos(l), math.cos(e)*math.sin(l), math.sin(e)])

A_s = survec(0, 0);    A_e = eqvec(185, 32.5)
B_s = survec(0, 90);   B_e = eqvec(275, 0)
C_s = survec(57.5, 0); C_e = eqvec(0, 90)
c1 = A_e
c2 = B_e
c3 = np.cross(c1, c2); c3 /= np.linalg.norm(c3)
if np.dot(c3, C_e) < 0:
    c3 = -c3
R = np.column_stack([c1, c2, c3])

def parse_tsv(path):
    rows = []
    with open(path, encoding='utf-8', errors='ignore') as f:
        for line in f:
            if not line.strip() or line[0] in '#-':
                continue
            p = line.rstrip('\n').split('\t')
            if len(p) < 5:
                continue
            try:
                rows.append((int(p[0]), int(p[1]), float(p[2]), float(p[3]), float(p[4])))
            except ValueError:
                pass
    return rows

def rdp(pts, tol):
    if len(pts) < 3:
        return pts
    a, b = pts[0], pts[-1]
    ab = [b[i] - a[i] for i in range(3)]
    ab2 = sum(v*v for v in ab)
    best, idx = -1.0, 0
    for i in range(1, len(pts) - 1):
        p = pts[i]
        if ab2 < 1e-12:
            dd = math.dist(p, a)
        else:
            t = sum((p[k]-a[k])*ab[k] for k in range(3)) / ab2
            t = max(0.0, min(1.0, t))
            proj = [a[k] + ab[k]*t for k in range(3)]
            dd = math.dist(p, proj)
        if dd > best:
            best, idx = dd, i
    if best <= tol:
        return [a, b]
    return rdp(pts[:idx+1], tol)[:-1] + rdp(pts[idx:], tol)

def main():
    path = sys.argv[1] if len(sys.argv) > 1 else '_cat/fil2.tsv'
    rows = parse_tsv(path)
    fil = {}
    for (fid, ipt, x, y, z) in rows:
        fil.setdefault(fid, []).append((ipt, x, y, z))

    out = []; n_raw = 0; dmax = 0.0
    for fid, pts in fil.items():
        pts.sort(key=lambda t: t[0])
        xyz = [(t[1], t[2], t[3]) for t in pts]
        n_raw += len(xyz)
        simp = rdp(xyz, TOL)
        enc = []
        for (x, y, z) in simp:
            d = math.sqrt(x*x + y*y + z*z)
            if d < 1e-6:
                continue
            vs = np.array([y, z, -x]) / d          # survey 笛卡尔
            ve = R @ vs                            # -> 赤道笛卡尔
            dec = math.degrees(math.asin(max(-1.0, min(1.0, ve[2]))))
            ra = math.degrees(math.atan2(ve[1], ve[0])) % 360.0
            dm = d / 0.7                           # Mpc/h -> Mpc
            dmax = max(dmax, dm)
            enc.append((ra, dec, dm))
        if len(enc) >= 2:
            out.append(enc)

    # 抽样：只保留最长的 MAXFIL 条（15k 条线在宇宙层糊成一片，2500 条既有主干又清晰）
    MAXFIL = 2500
    if len(out) > MAXFIL:
        def flen(f):
            return sum(math.dist(f[i], f[i + 1]) for i in range(len(f) - 1))
        out.sort(key=flen, reverse=True)
        out = out[:MAXFIL]

    buf = bytearray(); buf += struct.pack('<I', len(out)); n_pts = 0
    for fil_pts in out:
        buf += struct.pack('<H', len(fil_pts)); n_pts += len(fil_pts)
        for (ra, dec, d) in fil_pts:
            ra_q = int(round(ra / 360.0 * 65535)) & 0xFFFF
            de_q = int(round((dec + 90.0) / 180.0 * 65535)) & 0xFFFF
            d_q = int(round(min(d, DMAX) / DMAX * 65535)) & 0xFFFF
            buf += struct.pack('<HHH', ra_q, de_q, d_q)
    with open(OUT, 'wb') as f:
        f.write(buf)
    print(json.dumps({'filaments': len(out), 'points_raw': n_raw, 'points_kept': n_pts,
                      'max_dist_Mpc': round(dmax, 1), 'bytes': len(buf), 'out': OUT},
                     ensure_ascii=False))

if __name__ == '__main__':
    main()
