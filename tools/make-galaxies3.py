#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""ORBIT — 再把 2dFGRS 南天深样本并入 SDSS+2MRS 星系点云

现状（对话 130 后）
  galaxies.bin = SDSS(173,342) + 2MRS(34,358) = 207,700 颗。
  南天虽有了 2MRS，但 2MRS 是浅样本（z<0.05，主体 <200 Mpc），
  南天 200~640 Mpc 仍稀，比北天 SDSS 楔形空。

做法
  1) 解码现有 galaxies.bin（GXY1），207,700 颗的 RA/Dec/d/den 原样保留（零回归）。
  2) 读 2dFGRS（VII/226/2df_100k，VizieR 计算的 J2000 坐标 + zHelio + IGAL）：
     只留 IGAL=1 星系、0<z<=0.2（→ comoving <830 Mpc = 现有 dmax，
     不提高量化上限，现有 207,700 的距离精度不变），z→ΛCDM(Ωm=.3,h=.7) comoving。
  3) 3D 邻域去重：2dFGRS 落在现有 207,700 颗的 8 Mpc 内（同一颗天体）跳过。
  4) 密度：并入后全体走 6 Mpc 网格邻域计数 log 归一，2dFGRS 用 `0.18+0.72t`
     （与 2MRS 同一套，不做两套亮度标准）。
  5) 重新打包 GXY1（5 字节/颗，格式不变）。

用法
  python tools/make-galaxies3.py            # dry-run
  python tools/make-galaxies3.py --write    # 覆盖 galaxies.bin（自动备份 .bak130）
"""
import sys, os, math, struct, json, shutil

HERE = os.path.dirname(os.path.abspath(__file__))
BIN = os.path.join(HERE, '..', 'public', 'data', 'galaxies.bin')
SRC = os.path.join(HERE, '..', '_cat', '2dfgrs.tsv')
C_KM = 299792.458
H0 = 70.0
DH = C_KM / H0
OM, OL = 0.3, 0.7
CELL = 8.0        # 去重 3D 网格（Mpc）
DCELL = 6.0       # 密度网格（Mpc）
DMAX = 830.0      # 与现有 bin 一致（2dFGRS 过滤 z<=0.2 正好落在此内）
ZMAX = 0.20


def comoving(z, n=240):
    if z <= 0.0:
        return 0.0
    s = 0.0
    for i in range(n):
        zz = z * (i + 0.5) / n
        s += 1.0 / math.sqrt(OM * (1.0 + zz) ** 3 + OL)
    return DH * s * z / n


def xyz(ra, dec, d):
    a = math.radians(ra); b = math.radians(dec); cb = math.cos(b)
    return (cb * math.cos(a) * d, math.sin(b) * d, cb * math.sin(a) * d)


def gal_b(ra, dec):
    a0 = math.radians(192.85948); d0 = math.radians(27.12825)
    a = math.radians(ra); d = math.radians(dec)
    sb = math.sin(d) * math.sin(d0) + math.cos(d) * math.cos(d0) * math.cos(a - a0)
    return math.degrees(math.asin(max(-1.0, min(1.0, sb))))


def decode_bin():
    b = open(BIN, 'rb').read()
    if b[:4] != b'GXY1':
        raise SystemExit('bad magic')
    n = struct.unpack('<I', b[4:8])[0]
    dmax = struct.unpack('<f', b[8:12])[0]
    out = []
    for i in range(n):
        o = 12 + i * 5
        val = int.from_bytes(b[o:o + 5], 'little')
        ra = ((val >> 28) & 0xFFF) / 4095.0 * 360.0
        dec = ((val >> 16) & 0xFFF) / 4095.0 * 180.0 - 90.0
        d = ((val >> 5) & 0x7FF) / 2047.0 * dmax
        den = (val & 0x1F) / 31.0
        out.append((ra, dec, d, den))
    return out, dmax


def parse_2dfgrs():
    rows = []; bad = 0; zsk = 0
    with open(SRC, encoding='utf-8', errors='ignore') as f:
        for line in f:
            if not line.strip() or line[0] in '#-':
                continue
            p = line.rstrip('\n').split('\t')
            if len(p) < 5:
                bad += 1; continue
            try:
                ra = float(p[0]); dec = float(p[1]); z = float(p[2])
                igal = int(float(p[4]))
            except ValueError:
                bad += 1; continue
            if igal != 1:
                continue
            if z <= 0.0 or z > ZMAX:
                zsk += 1; continue
            d = comoving(z)
            if d < 0.6:
                d = 0.6
            rows.append((ra, dec, d))
    return rows, bad, zsk


def main():
    write = '--write' in sys.argv
    base, dmax = decode_bin()
    print('base decoded: %d  dmax=%.1f' % (len(base), dmax))

    rows, bad, zsk = parse_2dfgrs()
    print('2dFGRS: valid=%d  bad=%d  z_filtered=%d' % (len(rows), bad, zsk))

    grid = {}
    for (ra, dec, d, den) in base:
        x, y, z = xyz(ra, dec, d)
        grid.setdefault((int(x // CELL), int(y // CELL), int(z // CELL)), []).append((x, y, z))

    kept = []; dup = 0; c2 = CELL * CELL
    for (ra, dec, d) in rows:
        x, y, z = xyz(ra, dec, d)
        cx, cy, cz = int(x // CELL), int(y // CELL), int(z // CELL)
        hit = False
        for i in (-1, 0, 1):
            for j in (-1, 0, 1):
                for k in (-1, 0, 1):
                    for (sx, sy, sz) in grid.get((cx + i, cy + j, cz + k), ()):
                        if (x - sx) ** 2 + (y - sy) ** 2 + (z - sz) ** 2 < c2:
                            hit = True; break
                    if hit: break
                if hit: break
            if hit: break
        if hit:
            dup += 1
        else:
            kept.append((ra, dec, d))
    print('dedup: dup=%d kept=%d' % (dup, len(kept)))

    south = sum(1 for (ra, dec, d) in kept if dec < 0)
    gp = sum(1 for (ra, dec, d) in kept if abs(gal_b(ra, dec)) < 20)
    dmin = min((d for (ra, dec, d) in kept), default=0)
    dmaxk = max((d for (ra, dec, d) in kept), default=0)
    print('kept sky: south=%d  |b|<20=%d  d=%.1f..%.1f' % (south, gp, dmin, dmaxk))
    bins = [0, 100, 200, 300, 400, 500, 600, 700, 1e9]
    hist = [0] * (len(bins) - 1)
    for (ra, dec, d) in kept:
        for bi in range(len(bins) - 1):
            if bins[bi] <= d < bins[bi + 1]:
                hist[bi] += 1; break
    print('kept dist: ' + '  '.join('%d+:%d' % (bins[i], hist[i]) for i in range(len(hist))))

    if not write:
        return

    allpts = [(ra, dec, d) for (ra, dec, d, den) in base] + kept
    cells = {}
    for (ra, dec, d) in allpts:
        x, y, z = xyz(ra, dec, d)
        key = (int(x // DCELL), int(y // DCELL), int(z // DCELL))
        cells[key] = cells.get(key, 0) + 1
    local = {}
    for (cx, cy, cz), c in cells.items():
        s = 0
        for i in (-1, 0, 1):
            for j in (-1, 0, 1):
                for k in (-1, 0, 1):
                    s += cells.get((cx + i, cy + j, cz + k), 0)
        local[(cx, cy, cz)] = s
    vals = sorted(local.values())
    p2 = vals[int(len(vals) * 0.02)] if vals else 1
    p98 = vals[int(len(vals) * 0.98)] or 1
    lp2 = math.log(max(p2, 1)); lp98 = math.log(max(p98, 1))

    def dens_of(ra, dec, d):
        x, y, z = xyz(ra, dec, d)
        ntot = local.get((int(x // DCELL), int(y // DCELL), int(z // DCELL)), 1)
        t = (math.log(max(ntot, 1)) - lp2) / max(1e-6, lp98 - lp2)
        t = max(0.0, min(1.0, t))
        return 0.18 + 0.72 * t

    body = bytearray()
    for (ra, dec, d, den) in base:
        q_ra = int(round(ra / 360.0 * 4095)) & 0xFFF
        q_de = int(round((dec + 90) / 180.0 * 4095)) & 0xFFF
        q_d = int(round(min(d, DMAX) / DMAX * 2047)) & 0x7FF
        q_dn = min(31, int(round(den * 31)))
        body += ((q_ra << 28) | (q_de << 16) | (q_d << 5) | q_dn).to_bytes(5, 'little')
    for (ra, dec, d) in kept:
        den = dens_of(ra, dec, d)
        q_ra = int(round(ra / 360.0 * 4095)) & 0xFFF
        q_de = int(round((dec + 90) / 180.0 * 4095)) & 0xFFF
        q_d = int(round(min(d, DMAX) / DMAX * 2047)) & 0x7FF
        q_dn = min(31, int(round(den * 31)))
        body += ((q_ra << 28) | (q_de << 16) | (q_d << 5) | q_dn).to_bytes(5, 'little')

    n_total = len(base) + len(kept)
    buf = bytearray(b'GXY1')
    buf += struct.pack('<I', n_total)
    buf += struct.pack('<f', DMAX)
    buf += body
    shutil.copyfile(BIN, BIN + '.bak130')
    with open(BIN, 'wb') as f:
        f.write(buf)
    print(json.dumps({'base': len(base), '2dfgr_kept': len(kept), 'total': n_total,
                      'bytes': len(buf)}, ensure_ascii=False))


if __name__ == '__main__':
    main()
