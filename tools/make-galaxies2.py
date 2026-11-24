#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""ORBIT — 把 2MRS 全天星表并入现有 SDSS 星系点云，补南天 / 银道面

背景
  public/data/galaxies.bin 现在是 bisous/SDSS 星表（z<0.15，一块北天楔形），
  南天与银道面附近是空的 —— 宇宙层 100 Mpc 视角里那块天区一片白。
  SDSS 本身回避银道面（尘埃遮蔽），而且只覆盖一块赤纬带。

做法
  1) 解码现有 galaxies.bin（GXY1，5 字节/颗）得到 173,342 颗 SDSS 的 RA/Dec/d/den。
  2) 读 2MRS（J/ApJS/199/26/table3，44,599 颗全天星系，含南天与银道面）：
     cz[km/s] → z=cz/c → ΛCDM(Ωm=0.3,h=0.7) comoving 距离[Mpc]。
  3) **3D 邻域去重**：2MRS 星系若在 SDSS 已有星系的 8 Mpc 半径内（同一颗天体），跳过；
     只有 SDSS 没覆盖到的地方（南天 / 银道面 / 楔形外）才保留 —— SDSS 部分零回归。
  4) 给保留的 2MRS 点算密度：与 SDSS 同一套 6 Mpc 网格邻域计数，log 归一到 0..1，
     让南天的纤维/团结构与 SDSS 楔形亮度连续。
  5) 重新打包 GXY1（5 字节/颗，格式不变 → 运行时 decode 不用改）。

用法
  python tools/make-galaxies2.py            # dry-run，只打印统计与去重结果
  python tools/make-galaxies2.py --write    # 真正覆盖 galaxies.bin（先自动备份）
"""
import sys, os, math, struct, json, shutil

HERE = os.path.dirname(os.path.abspath(__file__))
BIN = os.path.join(HERE, '..', 'public', 'data', 'galaxies.bin')
MRS = os.path.join(HERE, '..', '_cat', '2mrs.tsv')
C_KM = 299792.458
H0 = 70.0
DH = C_KM / H0                     # c/H0 ≈ 4282.7 Mpc
OM, OL = 0.3, 0.7
CELL = 8.0                         # 去重 3D 网格（Mpc）
DCELL = 6.0                        # 密度网格（Mpc，与 make-galaxies.py 一致）
DMAX = 830.0                       # 量化上限，保持与现有 bin 一致


def comoving(z, n=240):
    """comoving distance [Mpc] for flat ΛCDM."""
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
    """银纬（度），用于统计银道面覆盖。"""
    a0 = math.radians(192.85948); d0 = math.radians(27.12825)
    a = math.radians(ra); d = math.radians(dec)
    sb = math.sin(d) * math.sin(d0) + math.cos(d) * math.cos(d0) * math.cos(a - a0)
    return math.degrees(math.asin(max(-1.0, min(1.0, sb))))


def decode_sdss():
    b = open(BIN, 'rb').read()
    magic = b[:4]
    if magic != b'GXY1':
        raise SystemExit('bad magic %r' % magic)
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


def parse_2mrs():
    rows = []
    bad = 0
    with open(MRS, encoding='utf-8', errors='ignore') as f:
        for line in f:
            if not line.strip() or line[0] in '#-':
                continue
            p = line.rstrip('\n').split('\t')
            if len(p) < 3:
                continue
            try:
                ra = float(p[0]); dec = float(p[1]); cz = float(p[2])
            except ValueError:
                bad += 1
                continue
            # 2MRS 设计范围 z<0.1（cz<30000）；更高的 25 颗是背景类星体/错误红移
            # （实测 max=51864 → 711 Mpc，会在南天远处戳出孤立点）
            if cz > 30000:
                bad += 1
                continue
            z = cz / C_KM
            if z < 0.0:
                z = 0.0
            d = comoving(z)
            if d < 0.6:
                d = 0.6
            rows.append((ra, dec, d))
    return rows, bad


def main():
    write = '--write' in sys.argv
    sdss, dmax = decode_sdss()
    print('SDSS decoded: %d  dmax=%.1f' % (len(sdss), dmax))

    mrs_all, bad = parse_2mrs()
    print('2MRS parsed: %d valid  bad=%d' % (len(mrs_all), bad))

    # ---- SDSS 3D 网格用于去重 ----
    grid = {}
    for (ra, dec, d, den) in sdss:
        x, y, z = xyz(ra, dec, d)
        grid.setdefault((int(x // CELL), int(y // CELL), int(z // CELL)), []).append((x, y, z))

    kept = []
    dup = 0
    cell2 = CELL * CELL
    for (ra, dec, d) in mrs_all:
        x, y, z = xyz(ra, dec, d)
        cx, cy, cz = int(x // CELL), int(y // CELL), int(z // CELL)
        hit = False
        for i in (-1, 0, 1):
            for j in (-1, 0, 1):
                for k in (-1, 0, 1):
                    for (sx, sy, sz) in grid.get((cx + i, cy + j, cz + k), ()):
                        if (x - sx) ** 2 + (y - sy) ** 2 + (z - sz) ** 2 < cell2:
                            hit = True
                            break
                    if hit:
                        break
                if hit:
                    break
            if hit:
                break
        if hit:
            dup += 1
        else:
            kept.append((ra, dec, d))
    print('2MRS dedup: dup=%d  kept=%d' % (dup, len(kept)))

    # ---- 保留点的天区分布 ----
    south = sum(1 for (ra, dec, d) in kept if dec < 0)
    gp = sum(1 for (ra, dec, d) in kept if abs(gal_b(ra, dec)) < 20)
    dmin = min((d for (ra, dec, d) in kept), default=0)
    dmaxk = max((d for (ra, dec, d) in kept), default=0)
    print('kept sky: south(dec<0)=%d  |b|<20=%d  d=%.1f..%.1f Mpc' % (south, gp, dmin, dmaxk))
    bins = [0, 50, 100, 150, 200, 250, 300, 1e9]
    hist = [0] * (len(bins) - 1)
    for (ra, dec, d) in kept:
        for bi in range(len(bins) - 1):
            if bins[bi] <= d < bins[bi + 1]:
                hist[bi] += 1
                break
    print('kept dist: ' + '  '.join('%d-%d:%d' % (bins[i], bins[i + 1] if bins[i + 1] < 1e8 else 999, hist[i])
                                    for i in range(len(hist))))

    if not write:
        # 打印 30°×15° 天区格里的覆盖对比（SDSS vs kept-2MRS）
        def skygrid(pts):
            g = {}
            for p in pts:
                key = (int(p[0] // 30), int((p[1] + 90) // 15))
                g[key] = g.get(key, 0) + 1
            return g
        gs = skygrid(sdss)
        gm = skygrid([(ra, dec, 0, 0) for (ra, dec, d) in kept])
        keys = sorted(set(gs) | set(gm))
        print('=== sky cells (RA30 x Dec15) SDSS / +2MRS ===')
        for k in keys:
            tag = '  NEW' if gs.get(k, 0) == 0 and gm.get(k, 0) > 0 else ''
            print('  RA%3d Dec%+4d : %6d / %6d%s' % (k[0] * 30, k[1] * 15 - 90, gs.get(k, 0), gm.get(k, 0), tag))
        return

    # ---- 合并 + 给 2MRS 算密度 ----
    allpts = [(ra, dec, d) for (ra, dec, d, den) in sdss] + kept
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
    lgp2 = math.log(max(p2, 1))
    lgp98 = math.log(max(p98, 1))

    def dens_of(ra, dec, d):
        x, y, z = xyz(ra, dec, d)
        key = (int(x // DCELL), int(y // DCELL), int(z // DCELL))
        ntot = local.get(key, 1)
        t = (math.log(max(ntot, 1)) - lgp2) / max(1e-6, lgp98 - lgp2)
        t = max(0.0, min(1.0, t))
        # 2MRS 没有 Dfil：只用邻域计数，映射到和 SDSS 场/纤维一致的亮度带
        return 0.18 + 0.72 * t

    body = bytearray()
    for (ra, dec, d, den) in sdss:
        q_ra = int(round(ra / 360.0 * 4095)) & 0xFFF
        q_de = int(round((dec + 90) / 180.0 * 4095)) & 0xFFF
        q_d = int(round(min(d, DMAX) / DMAX * 2047)) & 0x7FF
        q_dn = min(31, int(round(den * 31)))
        val = (q_ra << 28) | (q_de << 16) | (q_d << 5) | q_dn
        body += val.to_bytes(5, 'little')
    for (ra, dec, d) in kept:
        den = dens_of(ra, dec, d)
        q_ra = int(round(ra / 360.0 * 4095)) & 0xFFF
        q_de = int(round((dec + 90) / 180.0 * 4095)) & 0xFFF
        q_d = int(round(min(d, DMAX) / DMAX * 2047)) & 0x7FF
        q_dn = min(31, int(round(den * 31)))
        val = (q_ra << 28) | (q_de << 16) | (q_d << 5) | q_dn
        body += val.to_bytes(5, 'little')

    n_total = len(sdss) + len(kept)
    buf = bytearray(b'GXY1')
    buf += struct.pack('<I', n_total)
    buf += struct.pack('<f', DMAX)
    buf += body

    shutil.copyfile(BIN, BIN + '.bak129')
    with open(BIN, 'wb') as f:
        f.write(buf)
    print(json.dumps({'sdss': len(sdss), '2mrs_kept': len(kept), 'total': n_total,
                      'bytes': len(buf), 'out': BIN}, ensure_ascii=False))


if __name__ == '__main__':
    main()
