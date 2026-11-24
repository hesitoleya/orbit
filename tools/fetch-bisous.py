#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""ORBIT — 分片抓取 VizieR J/MNRAS/438/3465/table3（bisous 星系表）

哈佛镜像的数据库会间歇性返回 STDB_ERR（Postgres no connection），
`-out.max=unlimited` 被截断时 HTTP 仍然 200、curl 仍然退出 0，
所以每片必须校验：无 Error= 行、最后一行是 7 列完整行。

特点：
  · 每片单独落盘（_cat/g_<a>_<b>.tsv），已完整存在的片直接跳过 → 可续跑
  · 并行 3 路，单片最多 3 次尝试，失败只记账，下一轮再补
  · 逐片打印，随时能看到进度

用法：python tools/fetch-bisous.py [起] [止] [步长] [轮数]
"""
import subprocess, sys, os, math, json, time
from concurrent.futures import ThreadPoolExecutor

BASE = ('https://vizier.cfa.harvard.edu/viz-bin/asu-tsv'
        '?-source=J/MNRAS/438/3465/table3'
        '&-out=RAJ2000,DEJ2000,Dcor,z,Lr,w,Dfil&-out.max=unlimited&z=%s..%s')
DIR = os.path.join(os.path.dirname(__file__), '..', '_cat')
NFIELD = 7


def out_path(a, b):
    return os.path.join(DIR, 'g_%.2f_%.2f.tsv' % (a, b))


def valid(path):
    if not os.path.exists(path) or os.path.getsize(path) < 200:
        return 0
    with open(path, encoding='utf-8', errors='ignore') as f:
        body = []
        for line in f:
            if not line.strip() or line[0] in '#-':
                continue
            if len(line.rstrip('\n').split('\t')) == NFIELD:
                body.append(line)
    return len(body)


def fetch(a, b, tries=3):
    p = out_path(a, b)
    n = valid(p)
    if n > 0:
        return (a, b, n, 'cached')
    url = BASE % (a, b)
    for k in range(tries):
        r = subprocess.run(['curl', '-s', '-m', '150', url], capture_output=True)
        txt = r.stdout.decode('utf-8', 'ignore')
        if '#INFO\tError=' in txt or 'QUERY_STATUS=ERROR' in txt or len(txt) < 200:
            continue
        lines = [l for l in txt.splitlines()
                 if l.strip() and l[0] not in '#-' and len(l.split('\t')) == NFIELD]
        if len(lines) < 3 or len(lines[-1].split('\t')) != NFIELD:
            continue
        with open(p, 'w', encoding='utf-8') as f:
            f.write('\n'.join(lines[2:]) + '\n')     # 去掉两行表头
        return (a, b, len(lines) - 2, 'ok')
    return (a, b, 0, 'fail')


def main():
    a0 = float(sys.argv[1]) if len(sys.argv) > 1 else 0.0
    a1 = float(sys.argv[2]) if len(sys.argv) > 2 else 0.22
    st = float(sys.argv[3]) if len(sys.argv) > 3 else 0.01
    rounds = int(sys.argv[4]) if len(sys.argv) > 4 else 4
    os.makedirs(DIR, exist_ok=True)
    bins = []
    z = a0
    while z < a1 - 1e-9:
        b = round(min(z + st, a1), 4)
        bins.append((round(z, 4), b))
        z = b
    for r in range(rounds):
        left = [x for x in bins if valid(out_path(*x)) == 0]
        if not left:
            break
        print('--- round %d, %d slices left' % (r + 1, len(left)), flush=True)
        with ThreadPoolExecutor(max_workers=3) as ex:
            for (a, b, n, tag) in ex.map(lambda t: fetch(t[0], t[1]), left):
                print('%-14s %5d %s' % ('%s..%s' % (a, b), n, tag), flush=True)
    total = 0
    missing = []
    for (a, b) in bins:
        n = valid(out_path(a, b))
        total += n
        if n == 0:
            missing.append('%s..%s' % (a, b))
    print(json.dumps({'rows': total, 'missing': missing}, ensure_ascii=False))


if __name__ == '__main__':
    main()
