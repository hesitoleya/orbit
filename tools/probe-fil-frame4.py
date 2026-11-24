#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""ORBIT — 用天区 2D 分布的相关系数 + 5 度网格命中率定位坐标系

medDec 是单值、会被「骨架只覆盖 SDSS 子集」带偏；这里看形状：
把 table2 各变换后的 (RA,Dec) 与 SDSS 的 (RA,Dec) 都做成 36x18 直方图，
算 Pearson 相关。真正正确的坐标系应该让两张天区图高度相似。
"""
import struct, math, itertools

RGAL = [[-0.0548755604, -0.8734370902, -0.4838350155],
        [ 0.4941094279, -0.4448296300,  0.7469822445],
        [-0.8676661490, -0.1980763734,  0.4559837762]]
RSG = [[-0.735742574804, -0.074553778365, 0.673145302109],
       [ 0.677261296414, -0.080991471307, 0.739271887780],
       [0.0,             0.993922590400, 0.018574938953]]

def T(M):
    return [[M[j][i] for j in range(3)] for i in range(3)]

I = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
MATS = [('I', I), ('RGAL', RGAL), ('RGAL_T', T(RGAL)), ('RSG', RSG), ('RSG_T', T(RSG))]
NB1, NB2 = 36, 18

def hist(rows):
    H = [[0]*NB2 for _ in range(NB1)]
    for ra, dec in rows:
        i = int(ra // (360.0/NB1)) % NB1
        j = int((dec + 90) // (180.0/NB2))
        j = max(0, min(NB2-1, j))
        H[i][j] += 1
    return H

def corr(A, B):
    a = [A[i][j] for i in range(NB1) for j in range(NB2)]
    b = [B[i][j] for i in range(NB1) for j in range(NB2)]
    n = len(a); ma = sum(a)/n; mb = sum(b)/n
    sa = math.sqrt(sum((x-ma)**2 for x in a)); sb = math.sqrt(sum((x-mb)**2 for x in b))
    cov = sum((a[k]-ma)*(b[k]-mb) for k in range(n))
    return cov/(sa*sb+1e-9)

def load_fil(path='_cat/fil2.tsv'):
    pts = []
    for line in open(path, encoding='utf-8', errors='ignore'):
        p = line.rstrip('\n').split('\t')
        if len(p) < 5:
            continue
        try:
            pts.append((float(p[2]), float(p[3]), float(p[4])))
        except ValueError:
            pass
    return pts

def load_sdss():
    b = open('public/data/galaxies.bin', 'rb').read()
    n = struct.unpack('<I', b[4:8])[0]
    rows = []; g5 = set()
    for i in range(min(173342, n)):
        o = 12 + i * 5
        val = int.from_bytes(b[o:o+5], 'little')
        ra = ((val >> 28) & 0xFFF) / 4095.0 * 360.0
        dec = ((val >> 16) & 0xFFF) / 4095.0 * 180.0 - 90.0
        rows.append((ra, dec))
        g5.add((int(ra // 5), int((dec + 90) // 5)))
    return rows, g5

def mm(M, v):
    return (M[0][0]*v[0]+M[0][1]*v[1]+M[0][2]*v[2],
            M[1][0]*v[0]+M[1][1]*v[1]+M[1][2]*v[2],
            M[2][0]*v[0]+M[2][1]*v[1]+M[2][2]*v[2])

pts = load_fil()[::6]         # 降采样 ~46k 点，形状足够
sd_rows, sd5 = load_sdss()
Hsd = hist(sd_rows)
print('fil pts(sampled) %d  sdss %d  sdss 5deg cells %d' % (len(pts), len(sd_rows), len(sd5)))

res = []
for name, M in MATS:
    for sg in itertools.product([1, -1], repeat=3):
        rows = []; hit = 0
        for p in pts:
            w = mm(M, p)
            w = (sg[0]*w[0], sg[1]*w[1], sg[2]*w[2])
            D = math.sqrt(w[0]**2 + w[1]**2 + w[2]**2)
            if D < 1:
                continue
            dec = math.degrees(math.asin(max(-1.0, min(1.0, w[2]/D))))
            ra = math.degrees(math.atan2(w[1], w[0])) % 360.0
            rows.append((ra, dec))
            if (int(ra // 5), int((dec + 90) // 5)) in sd5:
                hit += 1
        Hf = hist(rows)
        c = corr(Hf, Hsd)
        res.append((c, hit/max(1, len(rows)), name, sg))
res.sort(reverse=True)
print('=== top 12 by corr (shape similarity of sky maps) ===')
for c, r, name, sg in res[:12]:
    print('corr %+.3f  hit5 %+.3f  %-7s sign %s' % (c, r, name, sg))
