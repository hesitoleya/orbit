#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""ORBIT — 把 bisous 星表的【星系】转成运行时点云

数据：Tempel et al. 2014 (J/MNRAS/438/3465) table3 = 576,493 个 SDSS 星系
      (RA, Dec, Dcor[Mpc/h], z, Lr, w, Dfil[Mpc/h])

两件必须做对的事
  1) 单位：星表距离是 Mpc/h。按 ΛCDM(Ωm=0.3, h=0.7) 积分得到的 comoving
     距离与 Dcor 的比值就是 1/h —— 脚本会自己拟合出来并打印，不靠猜。
  2) 密度：直接用它给的 Dfil（离最近纤维轴的距离）与 6 Mpc 网格邻域计数
     合成一个 8bit 的「成团度」，点云才能看出纤维/团/空洞，而不是均匀噪点。

输出 public/data/galaxies.bin：
  magic 'GXY1' | u32 n | f32 dmax
  u16 ra[n] · u16 dec[n] · u16 d[n] · u8 den[n]      （7 字节/星系，分段对齐）

用法：python tools/make-galaxies.py _cat/t3_all.tsv
"""
import sys, os, math, json, struct, random

OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'data', 'galaxies.bin')
H = 0.70           # bisous 的哈勃常数（脚本会验证 Dcor 确实是 Mpc/h）
DMAX = 830.0       # 量化上限（Mpc，真实距离；z=0.2 → 817 Mpc）
CELL = 6.0         # 密度网格（Mpc）
N_BRIGHT = 70000   # 最亮的这么多颗全留
KEEP_FAINT = 0.22  # 其余按比例抽样（点云只要成团度对，不需要逐颗）


def comoving_h(z, om=0.3, ol=0.7, n=200):
    """comoving distance in Mpc/h（因为 c/H0 取 2997.9 时 H0=100）"""
    s = 0.0
    for i in range(n):
        zz = z * (i + 0.5) / n
        s += 1.0 / math.sqrt(om * (1 + zz) ** 3 + ol)
    return 2997.9 * s * z / n


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else '_cat/t3_all.tsv'
    if not os.path.exists(path):
        # 直接吃 fetch-bisous.py 落的分片（顺序无关，脚本会全部读入）
        import glob
        parts = sorted(glob.glob(os.path.join(os.path.dirname(path), 'g_*.tsv')))
        if not parts:
            raise SystemExit('找不到 %s，也没有 _cat/g_*.tsv' % path)
        lines = []
        for q in parts:
            lines += open(q, encoding='utf-8', errors='ignore').read().splitlines()
        it = iter(lines)
        print('读取 %d 个分片，共 %d 行' % (len(parts), len(lines)))
    else:
        it = open(path, encoding='utf-8', errors='ignore')
    rows = []
    ratio = []
    if True:
        f = it
        for line in f:
            p = line.rstrip('\n').split('\t')
            if len(p) != 7:
                continue
            try:
                ra = float(p[0]); dec = float(p[1]); d = float(p[2])
                z = float(p[3]); lr = float(p[4]); w = float(p[5]); dfil = float(p[6])
            except ValueError:
                continue
            rows.append((ra, dec, d, z, lr, w, dfil))
            if 0.01 < z < 0.15:
                dc = comoving_h(z)
                if d > 1:
                    ratio.append(dc / d)
    n_all = len(rows)
    ratio.sort()
    med = ratio[len(ratio) // 2] if ratio else 1.0
    print('rows=%d  Dcor / D(H0=100) median=%.4f  → %s'
          % (n_all, med,
             'Mpc/h，需 ÷%.2f 换成真实 Mpc' % H if 0.9 < med < 1.1 else '直接是 Mpc'))

    # ---- 真实距离 + 网格密度 ----
    cells = {}
    pts = []
    for (ra, dec, d, z, lr, w, dfil) in rows:
        dd = d / H
        a = math.radians(ra); b = math.radians(dec)
        cb = math.cos(b)
        x = cb * math.cos(a) * dd
        y = math.sin(b) * dd
        zz = cb * math.sin(a) * dd          # 与 galWorld 同手性：用 (cosδcosα, sinδ, cosδsinα)
        key = (int(x // CELL), int(y // CELL), int(zz // CELL))
        cells[key] = cells.get(key, 0) + 1
        pts.append((ra, dec, dd, lr, dfil, key))

    # 邻域计数（3×3×3）→ log 压缩成 0..1
    local = {}
    for (cx, cy, cz), c in cells.items():
        s = 0
        for i in (-1, 0, 1):
            for j in (-1, 0, 1):
                for k in (-1, 0, 1):
                    s += cells.get((cx + i, cy + j, cz + k), 0)
        local[(cx, cy, cz)] = s
    vals = sorted(local.values())
    if vals:
        p2 = vals[int(len(vals) * 0.02)]
        p98 = vals[int(len(vals) * 0.98)] or 1
    else:
        p2, p98 = 1, 1

    def dens_byte(ntot, dfil):
        # 邻域计数（log 归一）占 0.65，离纤维轴的距离占 0.35
        t = (math.log(max(ntot, 1)) - math.log(max(p2, 1))) / max(1e-6, math.log(p98) - math.log(p2))
        t = max(0.0, min(1.0, t))
        ax = max(0.0, min(1.0, 1.0 - (dfil / H) / 8.0))
        v = 0.65 * t + 0.35 * ax
        return max(0, min(255, int(round(v * 255))))

    # ---- 抽样：亮的全留，暗的按比例 ----
    rnd = random.Random(1070)
    lr_cut = sorted((p[3] for p in pts), reverse=True)[:N_BRIGHT][-1] if len(pts) > N_BRIGHT else -1e9
    keep = []
    for (ra, dec, dd, lr, dfil, key) in pts:
        if lr >= lr_cut or rnd.random() < KEEP_FAINT:
            keep.append((ra, dec, dd, dens_byte(local.get(key, 1), dfil)))

    n = len(keep)
    body = bytearray(n * 5)
    for i, (ra, dec, dd, den) in enumerate(keep):
        q_ra = int(round(ra / 360.0 * 4095)) & 0xFFF
        q_de = int(round((dec + 90) / 180.0 * 4095)) & 0xFFF
        q_d = int(round(min(dd, DMAX) / DMAX * 2047)) & 0x7FF
        q_dn = min(31, den >> 3)
        val = (q_ra << 28) | (q_de << 16) | (q_d << 5) | q_dn
        o = i * 5
        body[o] = val & 0xFF
        body[o + 1] = (val >> 8) & 0xFF
        body[o + 2] = (val >> 16) & 0xFF
        body[o + 3] = (val >> 24) & 0xFF
        body[o + 4] = (val >> 32) & 0xFF

    buf = bytearray()
    buf += b'GXY1'
    buf += struct.pack('<I', n)
    buf += struct.pack('<f', DMAX)
    buf += body
    with open(OUT, 'wb') as f:
        f.write(buf)
    ds = [p[2] for p in keep]
    print(json.dumps({
        'rows_in': n_all, 'kept': n, 'ratio': round(n / max(1, n_all), 3),
        'h_used': H, 'bytes_per': 5, 'd_max_Mpc': round(max(ds), 1), 'd_med_Mpc': round(sorted(ds)[len(ds) // 2], 1),
        'bytes': len(buf), 'out': OUT
    }, ensure_ascii=False))


if __name__ == '__main__':
    main()
