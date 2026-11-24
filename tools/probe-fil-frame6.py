#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""ORBIT — 按 SDSS Survey Coordinates (η,λ) 反解 bisous 骨架

SDSS 定义（sdss.org/dr15/algorithms/surveycoords）：
  (η,λ)=(0,0)   <-> (RA,Dec)=(185,32.5)
  (η,λ)=(0,90)  <-> (RA,Dec)=(275,0)
  (η,λ)=(57.5,0)<-> (RA,Dec)=(0,90)
其中 η 是 survey 纬度(-90..90)，λ 是 survey 经度(-180..180)，纯旋转。

论文公式 1：x=-d sinλ, y=d cosλ cosη, z=d cosλ sinη
=> 论文的 λ = survey 纬度 η_s，论文的 η = survey 经度 λ_s
=> survey 笛卡尔 vs = (y, z, -x) / d
用三个锚点构建 survey->赤道 的旋转矩阵 R，再检验天区命中率。
"""
import struct, math
import numpy as np

def load_fil():
    pts = []
    for line in open('_cat/fil2.tsv', encoding='utf-8', errors='ignore'):
        p = line.rstrip('\n').split('\t')
        if len(p) < 5:
            continue
        try:
            pts.append((float(p[2]), float(p[3]), float(p[4])))
        except ValueError:
            pass
    return pts

def load_sdss_grid():
    b = open('public/data/galaxies.bin', 'rb').read()
    n = struct.unpack('<I', b[4:8])[0]
    g = set()
    for i in range(min(173342, n)):
        o = 12 + i * 5
        val = int.from_bytes(b[o:o + 5], 'little')
        ra = ((val >> 28) & 0xFFF) / 4095.0 * 360.0
        dec = ((val >> 16) & 0xFFF) / 4095.0 * 180.0 - 90.0
        g.add((int(ra // 5), int((dec + 90) // 5)))
    return g

def eqvec(ra, dec):
    a, d = math.radians(ra), math.radians(dec)
    return np.array([math.cos(d)*math.cos(a), math.cos(d)*math.sin(a), math.sin(d)])

def survec(eta, lam):
    e, l = math.radians(eta), math.radians(lam)
    return np.array([math.cos(e)*math.cos(l), math.cos(e)*math.sin(l), math.sin(e)])

# 三个锚点：survey (eta,lam) -> equatorial (ra,dec)
A_s = survec(0, 0);    A_e = eqvec(185, 32.5)
B_s = survec(0, 90);   B_e = eqvec(275, 0)
C_s = survec(57.5, 0); C_e = eqvec(0, 90)

# 由两对正交基求 R（survey->eq）。先验 A_s,B_s 正交（eta=0, lam 0/90）✔
# 用 A,B 定前两列，第三列取叉积，再用 C 检符号
c1 = A_e
c2 = B_e
c3 = np.cross(c1, c2); c3 /= np.linalg.norm(c3)
if np.dot(c3, C_e) < 0:
    c3 = -c3
R = np.column_stack([c1, c2, c3])
print('R =\n', np.round(R, 6))
print('det R', round(np.linalg.det(R), 4))
print('check C_s->', np.round(R @ C_s, 4), ' want', np.round(C_e, 4))

pts = load_fil(); grid = load_sdss_grid()
hit = 0; tot = 0; decs = []; ras = []
for (x, y, z) in pts:
    d = math.sqrt(x*x + y*y + z*z)
    if d < 1:
        continue
    # survey 笛卡尔 vs = (y, z, -x)/d
    vs = np.array([y, z, -x]) / d
    ve = R @ vs
    dec = math.degrees(math.asin(max(-1.0, min(1.0, ve[2]))))
    ra = math.degrees(math.atan2(ve[1], ve[0])) % 360.0
    decs.append(dec); ras.append(ra); tot += 1
    if (int(ra // 5), int((dec + 90) // 5)) in grid:
        hit += 1

def q(a, f):
    a = sorted(a); return a[int(len(a)*f)]
print('hit %.3f  medDec %+.1f  medRA %+.1f  (SDSS ~ +25.1 / +185.6)'
      % (hit / max(1, tot), q(decs, .5), q(ras, .5)))
