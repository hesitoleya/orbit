#!/usr/bin/env python
"""把 Harris 球状星团星表（VizieR VII/202）导出成 JSON —— 带名字，供标签与详情卡用。

数据来自两次 VizieR 查询（同一星表、同一顺序）：
  · mwgc.tsv  : Name, RA, Dec, Rsun, Rgc, X, Y, Z, Vt   （X/Y/Z 是日心银道直角坐标）
  · mwgc2.tsv : ID,   Name, RA, Dec, Rsun, Rgc, Vt       （ID 是 NGC/Pal 编号，多数星团只有 ID）

Harris 星表的 Name 列只填了常用名（47 Tuc / ω Cen / M 13 …），大半是空的，
所以显示名按「Name 优先、否则 ID」取；详情卡里两个都写出来。

输出格式（每条 10 个字段，紧凑数组，约 9 KB）：
  [显示名, 编号, RA°, Dec°, 日心距离 kpc, 银心距 kpc, 视星等, X, Y, Z]
"""
import json
import sys

C = 0  # 列索引常量仅作注释用


def dmstodeg(s):
    s = s.strip()
    if not s:
        return None
    sign = -1.0 if s.startswith('-') else 1.0
    p = s.lstrip('+-').split()
    if len(p) != 3:
        return None
    return sign * (float(p[0]) + float(p[1]) / 60.0 + float(p[2]) / 3600.0)


def read_tsv(path, ncol):
    rows = []
    for line in open(path, encoding='utf-8', errors='ignore'):
        if line.startswith('#') or not line.strip():
            continue
        p = line.rstrip('\n').split('\t')
        if len(p) < ncol:
            continue
        rows.append(p)
    return rows


def main():
    a = read_tsv('_cat/mwgc.tsv', 9)      # Name, RA, Dec, Rsun, Rgc, X, Y, Z, Vt
    b = read_tsv('_cat/mwgc2.tsv', 7)     # ID, Name, RA, Dec, Rsun, Rgc, Vt

    # 以 (RA, Dec) 字符串为键把 ID 合进来
    ids = {}
    for p in b:
        ids[(p[2].strip(), p[3].strip())] = p[0].strip()

    out = []
    for p in a:
        ra_s, de_s = p[1].strip(), p[2].strip()
        try:
            ra = dmstodeg(ra_s); de = dmstodeg(de_s)
            rs = float(p[3]); rg = float(p[4]); vt = float(p[8])
            x = float(p[5]); y = float(p[6]); z = float(p[7])
        except ValueError:
            continue
        if ra is None or de is None or not (0.0 < rs < 200.0):
            continue
        name = p[0].strip()
        cid = ids.get((ra_s, de_s), '')
        disp = name if name else cid
        if not disp:
            continue
        out.append([disp, cid, round(ra, 4), round(de, 4),
                    round(rs, 2), round(rg, 2), round(vt, 2),
                    round(x, 2), round(y, 2), round(z, 2)])

    out.sort(key=lambda r: r[6])          # 按视星等从亮到暗
    s = json.dumps(out, ensure_ascii=False, separators=(',', ':'))
    open('public/data/mwgc.json', 'w', encoding='utf-8').write(s)
    print('globular clusters %d, %d bytes' % (len(out), len(s)))
    print('  brightest:', [r[0] for r in out[:6]])
    print('  named %d / %d' % (sum(1 for r in out if r[0] != r[1]), len(out)))


if __name__ == '__main__':
    sys.exit(main())
