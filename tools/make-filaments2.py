#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""ORBIT — 重算 bisous 纤维骨架（修正对话 106 的坐标系错误）

对话 106 直接把 table2 的 (x,y,z) 当成赤道笛卡尔做反解，结果整张骨架
相对真实星系**旋转了约 27°**：骨架铺满全天（中位 Dec 0.6°），而 SDSS 星系
集中在中位 Dec 25° 的天区里 —— 肉眼看是「两团东西」，逐点比是 133 Mpc 的偏差。

这里用 table3 的 IDpt（最近的骨架点 id）建立几千对
  table2(x,y,z)  ↔  table3(RA, Dec, Dcor)
然后用 Kabsch 求最优旋转 R，把 R 应用到全部骨架点。
残差会打印出来；半径相对误差 ~0.2%，说明距离尺度本身是对的（Mpc/h，÷0.7）。

用法：python tools/make-filaments2.py
"""
import struct, math, json, os, sys
import numpy as np

H = 0.70
DMAX = 900.0
TOL = 0.5
OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'data', 'filaments.bin')
T2 = os.path.join(os.path.dirname(__file__), '..', '_cat', 't2.tsv')
T3 = os.path.join(os.path.dirname(__file__), '..', '_cat', 't3id.tsv')


def eq_unit(ra, de):
    a, b = np.radians(ra), np.radians(de)
    return np.stack([np.cos(b) * np.cos(a), np.sin(b), np.cos(b) * np.sin(a)], axis=1)


def main():
    pts = {}
    for line in open(T2, encoding='utf-8', errors='ignore'):
        if line[:1] in '#\n':
            continue
        p = line.rstrip('\n').split('\t')
        if len(p) < 5:
            continue
        try:
            fid, idp = int(p[0]), int(p[1])
            xyz = [float(p[2]), float(p[3]), float(p[4])]
        except ValueError:
            continue
        pts.setdefault(fid, []).append((idp, xyz))
    by_id = {}
    for fid, lst in pts.items():
        for idp, xyz in lst:
            by_id[idp] = xyz

    A, B = [], []
    for line in open(T3, encoding='utf-8', errors='ignore'):
        if line[:1] in '#\n':
            continue
        p = line.rstrip('\n').split('\t')
        if len(p) < 5:
            continue
        try:
            ra, de, idp = float(p[0]), float(p[1]), int(p[4])
        except ValueError:
            continue
        v = by_id.get(idp)
        if not v:
            continue
        A.append(v)
        B.append((ra, de))
    A = np.array(A, dtype=float)
    A /= np.linalg.norm(A, axis=1)[:, None]
    B = eq_unit(np.array([b[0] for b in B]), np.array([b[1] for b in B]))

    Hm = A.T @ B
    U, S, Vt = np.linalg.svd(Hm)
    d = np.sign(np.linalg.det(Vt.T @ U.T))
    R = Vt.T @ np.diag([1.0, 1.0, d]) @ U.T
    res = np.degrees(np.arccos(np.clip(np.sum((A @ R.T) * B, axis=1), -1, 1)))
    print('pairs=%d  rot residual: median %.2f deg  p90 %.2f deg'
          % (len(A), np.median(res), np.percentile(res, 90)))

    out = []
    n_raw = 0
    dmax_seen = 0.0
    for fid, lst in pts.items():
        lst.sort(key=lambda t: t[0])
        xyz = np.array([t[1] for t in lst], dtype=float) / H     # Mpc/h → Mpc
        n_raw += len(xyz)
        v = xyz @ R.T
        # 三维 RDP（与旧实现同样的容差）
        keep = [0, len(v) - 1]
        stack = [(0, len(v) - 1)]
        while stack:
            i0, i1 = stack.pop()
            if i1 - i0 < 2:
                continue
            a, b = v[i0], v[i1]
            ab = b - a
            L2 = float(ab @ ab)
            seg = v[i0 + 1:i1]
            if L2 < 1e-12:
                dist = np.linalg.norm(seg - a, axis=1)
            else:
                t = np.clip(((seg - a) @ ab) / L2, 0, 1)
                proj = a + t[:, None] * ab
                dist = np.linalg.norm(seg - proj, axis=1)
            k = int(np.argmax(dist))
            if dist[k] > TOL:
                m = i0 + 1 + k
                keep.append(m)
                stack.append((i0, m))
                stack.append((m, i1))
        keep = sorted(set(keep))
        if len(keep) < 2:
            continue
        enc = []
        for idx in keep:
            x, y, z = v[idx]
            r = math.sqrt(x * x + y * y + z * z)
            if r < 1e-6:
                continue
            dec = math.degrees(math.asin(max(-1.0, min(1.0, y / r))))
            ra = math.degrees(math.atan2(z, x)) % 360.0
            dmax_seen = max(dmax_seen, r)
            enc.append((ra, dec, r))
        if len(enc) >= 2:
            out.append(enc)

    buf = bytearray()
    buf += struct.pack('<I', len(out))
    n_pts = 0
    for f in out:
        buf += struct.pack('<H', len(f))
        n_pts += len(f)
        for (ra, de, d) in f:
            buf += struct.pack('<HHH',
                               int(round(ra / 360 * 65535)) & 0xFFFF,
                               int(round((de + 90) / 180 * 65535)) & 0xFFFF,
                               int(round(min(d, DMAX) / DMAX * 65535)) & 0xFFFF)
    open(OUT, 'wb').write(buf)
    print(json.dumps({'filaments': len(out), 'points_raw': n_raw, 'points_kept': n_pts,
                      'max_Mpc': round(dmax_seen, 1), 'bytes': len(buf)}, ensure_ascii=False))


if __name__ == '__main__':
    main()
