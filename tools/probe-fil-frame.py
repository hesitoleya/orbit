#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""ORBIT — 用「天区分布」判据定位 bisous table2 的坐标系

107 用「最近邻 / Kabsch」判据失败，因为 table2 是纤维骨架轴上的点、table3 是
纤维周围的星系，两者本就有 Dfil（几 Mpc）偏移，刚体拟合必然对不上。
这里换个更硬的判据：正确反解后，骨架点的 (RA, Dec) 必须落在 SDSS 楔形里；
错误反解会铺满全天。对 48 种轴序/符号逐个打分，命中率最高的就是正确变换。
"""
import struct, math, itertools

def load_fil(path='_cat/fil2.tsv'):
    pts = []
    for line in open(path, encoding='utf-8', errors='ignore'):
        p = line.rstrip('\n').split('\t')
        if len(p) < 5:
            continue
        try:
            x = float(p[2]); y = float(p[3]); z = float(p[4])
        except ValueError:
            continue
        pts.append((x, y, z))
    return pts

def load_sdss_grid():
    b = open('public/data/galaxies.bin', 'rb').read()
    n = struct.unpack('<I', b[4:8])[0]
    grid = set()
    N = min(173342, n)          # 前 173,342 颗是 SDSS
    for i in range(N):
        o = 12 + i * 5
        val = int.from_bytes(b[o:o + 5], 'little')
        ra = ((val >> 28) & 0xFFF) / 4095.0 * 360.0
        dec = ((val >> 16) & 0xFFF) / 4095.0 * 180.0 - 90.0
        grid.add((int(ra // 2), int((dec + 90) // 2)))
    return grid

pts = load_fil()
grid = load_sdss_grid()
print('fil pts', len(pts), ' sdss 2deg cells', len(grid))

def score(perm, signs):
    hit = 0; tot = 0; decs = []
    for (a, b, c) in pts:
        v = (a, b, c)
        x = signs[0] * v[perm[0]]
        y = signs[1] * v[perm[1]]
        z = signs[2] * v[perm[2]]
        D = math.sqrt(x * x + y * y + z * z)
        if D < 1:
            continue
        dec = math.degrees(math.asin(max(-1.0, min(1.0, y / D))))
        ra = math.degrees(math.atan2(z, x)) % 360.0
        decs.append(dec); tot += 1
        if (int(ra // 2), int((dec + 90) // 2)) in grid:
            hit += 1
    decs.sort()
    med = decs[len(decs) // 2] if decs else 0
    return hit / max(1, tot), med

res = []
for perm in itertools.permutations(range(3)):
    for signs in itertools.product([1, -1], repeat=3):
        r, med = score(perm, signs)
        res.append((r, perm, signs, med))
res.sort(reverse=True)
print('=== top 10 (hit = frac in SDSS sky, median Dec) ===')
for r, perm, signs, med in res[:10]:
    print('hit %.3f  perm %s  sign %s  medDec %+.1f' % (r, perm, signs, med))
print('=== bottom 3 ===')
for r, perm, signs, med in res[-3:]:
    print('hit %.3f  perm %s  sign %s  medDec %+.1f' % (r, perm, signs, med))
