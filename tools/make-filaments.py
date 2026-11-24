#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""ORBIT — 把 VizieR 的 bisous 宇宙网纤维星表转成运行时可用的二进制

数据来源：Tempel et al. 2014, MNRAS 438, 3465（"The cosmic web of the SDSS: bisous model
filaments"），VizieR 编目 J/MNRAS/438/3465。
  table1: 纤维目录（ID / 点数 / 长度 / 星系计数 / 包围盒）
  table2: 纤维骨架点（ID, IDpt, x, y, z[Mpc], ...）—— 每条纤维按 IDpt 排序就是一条折线

星表用的是「观测者原点」的笛卡尔坐标，约定（用 table3 的星系做过交叉验证）：
  x = D·cosδ·cosα ,  y = −D·cosδ·sinα ,  z = −D·sinδ
反解：D = |v|, δ = asin(−z/D), α = atan2(−y, x)。

流程：按 ID 分组 → 按 IDpt 排序 → 三维 RDP 简化（默认 1.2 Mpc）→
      量化成 (RA 16bit, Dec 16bit, D 16bit) → 写 public/data/filaments.bin

用法：python tools/make-filaments.py <table1.tsv> <table2.tsv>
"""
import sys, struct, math, json, os

TOL = 0.5          # RDP 简化容差（Mpc）—— 100 Mpc 视距下 0.5 Mpc ≈ 0.4 px
DMAX = 900.0       # 距离量化上限（Mpc）
OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'data', 'filaments.bin')


def parse_tsv(path, ncol):
    rows = []
    with open(path, 'r', encoding='utf-8', errors='ignore') as f:
        for line in f:
            if not line or line[0] in '#\n\r':
                continue
            p = line.rstrip('\n').split('\t')
            if len(p) < ncol:
                continue
            if p[0].strip() in ('ID', '') or p[0].startswith('---'):
                continue
            try:
                rows.append(p)
            except ValueError:
                continue
    return rows


def rdp(pts, tol):
    """三维 Douglas-Peucker：pts 是 [(x,y,z)]"""
    if len(pts) < 3:
        return pts
    a, b = pts[0], pts[-1]
    ab = [b[i] - a[i] for i in range(3)]
    ab2 = sum(v * v for v in ab)
    best, idx = -1.0, 0
    for i in range(1, len(pts) - 1):
        p = pts[i]
        if ab2 < 1e-12:
            d = math.dist(p, a)
        else:
            t = sum((p[k] - a[k]) * ab[k] for k in range(3)) / ab2
            t = max(0.0, min(1.0, t))
            proj = [a[k] + ab[k] * t for k in range(3)]
            d = math.dist(p, proj)
        if d > best:
            best, idx = d, i
    if best <= tol:
        return [a, b]
    left = rdp(pts[:idx + 1], tol)
    right = rdp(pts[idx:], tol)
    return left[:-1] + right


def main():
    t2 = sys.argv[2] if len(sys.argv) > 2 else 'fil2.tsv'
    rows = parse_tsv(t2, 7)
    fil = {}
    for p in rows:
        try:
            fid = int(p[0]); ipt = int(p[1])
            x, y, z = float(p[4]), float(p[5]), float(p[6])
        except ValueError:
            continue
        fil.setdefault(fid, []).append((ipt, x, y, z))

    out = []
    n_raw = 0
    dmax = 0.0
    for fid, pts in fil.items():
        pts.sort(key=lambda t: t[0])
        xyz = [(t[1], t[2], t[3]) for t in pts]
        n_raw += len(xyz)
        simp = rdp(xyz, TOL)
        enc = []
        for (x, y, z) in simp:
            d = math.sqrt(x * x + y * y + z * z)
            if d < 1e-6:
                continue
            dec = math.degrees(math.asin(max(-1.0, min(1.0, -z / d))))
            ra = math.degrees(math.atan2(-y, x)) % 360.0
            dmax = max(dmax, d)
            enc.append((ra, dec, d))
        if len(enc) >= 2:
            out.append(enc)

    buf = bytearray()
    buf += struct.pack('<I', len(out))
    n_pts = 0
    for fil_pts in out:
        buf += struct.pack('<H', len(fil_pts))
        n_pts += len(fil_pts)
        for (ra, dec, d) in fil_pts:
            ra_q = int(round(ra / 360.0 * 65535)) & 0xFFFF
            de_q = int(round((dec + 90.0) / 180.0 * 65535)) & 0xFFFF
            d_q = int(round(min(d, DMAX) / DMAX * 65535)) & 0xFFFF
            buf += struct.pack('<HHH', ra_q, de_q, d_q)
    with open(OUT, 'wb') as f:
        f.write(buf)
    print(json.dumps({
        'filaments': len(out), 'points_raw': n_raw, 'points_kept': n_pts,
        'max_dist_Mpc': round(dmax, 1), 'bytes': len(buf), 'out': OUT
    }, ensure_ascii=False))


if __name__ == '__main__':
    main()
