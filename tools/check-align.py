# -*- coding: utf-8 -*-
"""检查 bisous 骨架点与星系点是否落在同一坐标约定上

两层最终都走同一个 galWorld()，所以「是否对齐」等价于
「(RA, Dec, D) 三列是否自洽」。这里不需要还原银道坐标，直接在
赤道笛卡尔空间做最近邻。同时顺便验算 0.7 的距离因子是否该乘。
"""
import struct, math, json, sys

def load_fil(p):
    b = open(p, 'rb').read()
    n = struct.unpack_from('<I', b, 0)[0]
    off, out = 4, []
    for _ in range(n):
        np = struct.unpack_from('<H', b, off)[0]; off += 2
        for _ in range(np):
            ra, de, d = struct.unpack_from('<HHH', b, off); off += 6
            out.append((ra / 65535 * 360, de / 65535 * 180 - 90, d / 65535 * 900))
    return out

def load_gxy(p):
    b = open(p, 'rb').read()
    n = struct.unpack_from('<I', b, 4)[0]
    dmax = struct.unpack_from('<f', b, 8)[0]
    out = []
    for i in range(n):
        o = 12 + i * 5
        val = b[o] | (b[o+1] << 8) | (b[o+2] << 16) | (b[o+3] << 24) | (b[o+4] << 32)
        ra = (val >> 28) & 4095
        de = (val >> 16) & 4095
        d = (val >> 5) & 2047
        out.append((ra / 4095 * 360, de / 4095 * 180 - 90, d / 2047 * dmax))
    return out

def xyz(rows, k):
    o = []
    for ra, de, d in rows:
        a, b = math.radians(ra), math.radians(de)
        r = d * k
        o.append((r * math.cos(b) * math.cos(a), r * math.sin(b), r * math.cos(b) * math.sin(a)))
    return o

CELL = 5.0
def nn_stats(A, B, step=1):
    grid = {}
    for i in range(0, len(B), step):
        p = B[i]
        key = (int(p[0] // CELL), int(p[1] // CELL), int(p[2] // CELL))
        grid.setdefault(key, []).append(p)
    ds = []
    for p in A:
        cx, cy, cz = int(p[0] // CELL), int(p[1] // CELL), int(p[2] // CELL)
        best = 1e12
        for i in (-1, 0, 1):
            for j in (-1, 0, 1):
                for k in (-1, 0, 1):
                    for q in grid.get((cx + i, cy + j, cz + k), ()):
                        d = (q[0]-p[0])**2 + (q[1]-p[1])**2 + (q[2]-p[2])**2
                        if d < best: best = d
        if best < 1e11:
            ds.append(math.sqrt(best))
    ds.sort()
    if not ds: return None
    return {'n': len(ds), 'med': round(ds[len(ds)//2], 2),
            'p10': round(ds[int(len(ds)*0.10)], 2), 'p90': round(ds[int(len(ds)*0.90)], 2)}

F = load_fil('public/data/filaments.bin')
G = load_gxy('public/data/galaxies.bin')
print('fil points', len(F), 'galaxies', len(G))
res = {}
for name, kf, kg in [('raw(1,1)', 1.0, 1.0),
                     ('fil/0.7', 1/0.7, 1.0),
                     ('both/0.7', 1/0.7, 1/0.7),
                     ('gal/0.7', 1.0, 1/0.7)]:
    A = xyz(F, kf)
    B = xyz(G, kg)
    res[name] = nn_stats(A[::3], B, step=2)
    print(name, res[name])
