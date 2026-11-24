#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""ORBIT — 搜索：I / 银道 / 超星系，各含正逆矩阵 × 8 符号

目标是同时满足：天区命中率高、medDec ≈ SDSS 的 +25°。
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
    rows = []; grid = set()
    for i in range(min(173342, n)):
        o = 12 + i * 5
        val = int.from_bytes(b[o:o + 5], 'little')
        ra = ((val >> 28) & 0xFFF) / 4095.0 * 360.0
        dec = ((val >> 16) & 0xFFF) / 4095.0 * 180.0 - 90.0
        rows.append((ra, dec))
        grid.add((int(ra // 2), int((dec + 90) // 2)))
    return grid

def mm(M, v):
    return (M[0][0]*v[0]+M[0][1]*v[1]+M[0][2]*v[2],
            M[1][0]*v[0]+M[1][1]*v[1]+M[1][2]*v[2],
            M[2][0]*v[0]+M[2][1]*v[1]+M[2][2]*v[2])

def score(pts, grid, M, sg):
    hit = 0; tot = 0; decs = []
    for p in pts:
        w = mm(M, p)
        w = (sg[0]*w[0], sg[1]*w[1], sg[2]*w[2])
        D = math.sqrt(w[0]**2 + w[1]**2 + w[2]**2)
        if D < 1:
            continue
        dec = math.degrees(math.asin(max(-1.0, min(1.0, w[2] / D))))
        ra = math.degrees(math.atan2(w[1], w[0])) % 360.0
        decs.append(dec); tot += 1
        if (int(ra // 2), int((dec + 90) // 2)) in grid:
            hit += 1
    decs.sort()
    med = decs[len(decs)//2] if decs else 0
    return hit / max(1, tot), med

pts = load_fil(); grid = load_sdss()
out = []
for name, M in MATS:
    for sg in itertools.product([1, -1], repeat=3):
        r, med = score(pts, grid, M, sg)
        pen = abs(med - 25.0)          # 目标 medDec = SDSS 的 +25
        out.append((pen, r, name, sg, med))
out.sort()
print('=== best by |medDec-25| ===')
for pen, r, name, sg, med in out[:12]:
    print('pen %.1f  hit %.3f  %-7s sign %s  medDec %+.1f' % (pen, r, name, sg, med))
