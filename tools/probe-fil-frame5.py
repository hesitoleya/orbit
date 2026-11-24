#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""ORBIT — 按论文公式 1 精确反解，判定 (λ, η) 是赤道还是银道

Tempel+2014 公式 1：
    x = -d sinλ ,  y = d cosλ cosη ,  z = d cosλ sinη
反解：d = |v| , λ = asin(-x/d) , η = atan2(z, y)

论文说 (η, λ) 是 "SDSS angular coordinates"，且与 Liivamägi+2012 超星系团
用同一套 —— 那套是银道坐标。这里把「赤道」和「银道」两个假设都算一遍，
用「骨架点落在 SDSS 5° 天区网格的比例」判定。
"""
import struct, math

RGAL = [[-0.0548755604, -0.8734370902, -0.4838350155],
        [ 0.4941094279, -0.4448296300,  0.7469822445],
        [-0.8676661490, -0.1980763734,  0.4559837762]]

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
        val = int.from_bytes(b[o:o+5], 'little')
        ra = ((val >> 28) & 0xFFF) / 4095.0 * 360.0
        dec = ((val >> 16) & 0xFFF) / 4095.0 * 180.0 - 90.0
        g.add((int(ra // 5), int((dec + 90) // 5)))
    return g

def gal_to_eq(l_deg, b_deg):
    l = math.radians(l_deg); b = math.radians(b_deg)
    xg = math.cos(b) * math.cos(l)
    yg = math.cos(b) * math.sin(l)
    zg = math.sin(b)
    xe = RGAL[0][0]*xg + RGAL[0][1]*yg + RGAL[0][2]*zg
    ye = RGAL[1][0]*xg + RGAL[1][1]*yg + RGAL[1][2]*zg
    ze = RGAL[2][0]*xg + RGAL[2][1]*yg + RGAL[2][2]*zg
    dec = math.degrees(math.asin(max(-1.0, min(1.0, ze))))
    ra = math.degrees(math.atan2(ye, xe)) % 360.0
    return ra, dec

pts = load_fil(); grid = load_sdss_grid()
print('fil pts', len(pts), 'sdss cells', len(grid))

hitA = hitB = 0; tot = 0
decsA = []; decsB = []; rasB = []
for (x, y, z) in pts:
    d = math.sqrt(x*x + y*y + z*z)
    if d < 1:
        continue
    lam = math.degrees(math.asin(max(-1.0, min(1.0, -x / d))))
    eta = math.degrees(math.atan2(z, y)) % 360.0
    tot += 1
    # 假设 A：λ=Dec, η=RA（赤道）
    raA, decA = eta, lam
    if (int(raA // 5), int((decA + 90) // 5)) in grid:
        hitA += 1
    decsA.append(decA)
    # 假设 B：λ=b, η=l（银道）→ 赤道
    raB, decB = gal_to_eq(eta, lam)
    if (int(raB // 5), int((decB + 90) // 5)) in grid:
        hitB += 1
    decsB.append(decB); rasB.append(raB)

def q(a, f):
    a = sorted(a); return a[int(len(a) * f)] if a else 0

print('A equator (lam=Dec, eta=RA): hit %.3f  medDec %+.1f' % (hitA / max(1, tot), q(decsA, .5)))
print('B galactic(lam=b,  eta=l ): hit %.3f  medDec %+.1f  medRA %+.1f'
      % (hitB / max(1, tot), q(decsB, .5), q(rasB, .5)))
print('SDSS medDec ~ +25.1 , medRA ~ +185.6')
