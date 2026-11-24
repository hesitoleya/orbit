#!/usr/bin/env python
"""去掉 NASA/JPL-Caltech 银河系俯视图上的文字标注与极坐标网格。

为什么这么做：银河系的外部"照片"物理上不存在（我们在盘内），天文界公认的
外部形象是 R. Hurt 基于 COBE/DIRBE 等实测数据做的重建图。它本身带有银经刻度、
距离圈和旋臂名称 —— 那是科学可视化的信息层，直接当贴图会显得像工程图纸。

掩膜：
  · 文字   —— 顶帽变换（原图 − 开运算），笔画只有 2~3 px 宽，比周围亮一截
  · 网格线 —— 极坐标几何精确生成（每 30° 径向线、每 15000 ly 环线）

填补必须分方向做，否则填不干净：
  · 环线在【银经方向是连续的】——角向窗口里全是线，只能沿半径方向插值；
  · 径向线和文字在【半径方向是连续的】——只能沿银经方向插值。
所以先按半径填环线，再按银经填剩下的，两步都在极坐标下做。

输出：public/data/mw-face.jpg（无标注、无网格、盘外透明黑）。
"""
import sys

import numpy as np
from PIL import Image, ImageFilter

SRC = '_cat/mw_big.jpg'      # 5600×5600 原图（NOIRLab，NASA/JPL-Caltech/R. Hurt）
DST = 'public/data/mw-face.jpg'

# 几何标定按 1280 版实测值 ×2（输出 2560²）。5600 原图的质心 (2787.8, 2802.0)，
# 缩放后是 (1274, 1281)，与这里一致。
SC = 2.0
CX, CY = 637.0 * SC, 640.0 * SC   # 盘心（银心）像素坐标
R_OUT = 588.0 * SC                # 盘的可视外缘，超出即纯黑
RMAX = 596.0 * SC                 # 极坐标重采样的最大半径


def load():
    # 5600 原图先降到 2560 再处理：分辨率是 1280 版的 2 倍（细节明显更足），
    # 但不用 5600 全程算 —— 极坐标重采样和形态学滤波在这个尺寸已经很慢
    im = Image.open(SRC).convert('RGB')
    side = int(1280 * SC)
    if im.size[0] != side:
        im = im.resize((side, side), Image.LANCZOS)
    return np.asarray(im).astype(np.float32)


def text_mask(a):
    """细亮结构检测：原图减去中值滤波结果。

    中值滤波会把「比周围亮、本身又很窄」的东西（笔画、网格线、标注引线）
    直接吃掉，而几十像素宽的旋臂亮带、核球、尘埃带都保留 —— 差分就只剩
    需要抹掉的叠加层。比顶帽变换（方向敏感）更通用，也不依赖网格半径标定
    （那组半径在 5600 原图上测不准，上一版就是这么漏掉一堆白线的）。
    """
    g = a.max(axis=2).astype(np.uint8)
    med = Image.fromarray(g, 'L').filter(ImageFilter.MedianFilter(int(11 * SC) | 1))
    thin = g.astype(np.float32) - np.asarray(med).astype(np.float32)

    h, w = g.shape
    yy, xx = np.mgrid[0:h, 0:w]
    r = np.hypot(xx - CX, yy - CY)
    # 盘心附近是亮黄核，细线对比度相对低，阈值放宽一点
    return np.where(r < 260.0 * SC, thin > 10, thin > 15)


def grid_split(shape):
    """返回 (环线掩膜, 径向线掩膜)。宽度按像素算，与半径无关。"""
    h, w = shape
    yy, xx = np.mgrid[0:h, 0:w]
    dx = xx - CX
    dy = yy - CY
    r = np.hypot(dx, dy)
    th = np.degrees(np.arctan2(dx, -dy)) % 360.0
    inside = r < R_OUT - 4.0 * SC

    ring = np.zeros((h, w), bool)
    for k in range(1, 6):
        rr = (196.0 + 98.0 * (k - 1)) * SC
        if rr < R_OUT:
            ring |= np.abs(r - rr) < 2.0 * SC

    d = np.abs(((th + 15.0) % 30.0) - 15.0)
    radial = inside & (r * np.sin(np.radians(d)) < 1.8 * SC)
    return ring, radial


def to_polar(a, nr, nt):
    """笛卡尔 → 极坐标（双线性）。θ 从顶部逆时针，就是银经。"""
    rr = np.arange(nr, dtype=np.float32) * (RMAX / nr)
    tt = np.linspace(0.0, 360.0, nt, endpoint=False).astype(np.float32)
    rad = np.radians(tt)
    x = CX + rr[:, None] * np.sin(rad)[None, :]
    y = CY - rr[:, None] * np.cos(rad)[None, :]
    x0 = np.floor(x).astype(np.int32)
    y0 = np.floor(y).astype(np.int32)
    fx = (x - x0)[..., None]
    fy = (y - y0)[..., None]
    x0 = np.clip(x0, 0, a.shape[1] - 2)
    y0 = np.clip(y0, 0, a.shape[0] - 2)
    c00 = a[y0, x0]; c10 = a[y0, x0 + 1]
    c01 = a[y0 + 1, x0]; c11 = a[y0 + 1, x0 + 1]
    return (c00 * (1 - fx) * (1 - fy) + c10 * fx * (1 - fy) +
            c01 * (1 - fx) * fy + c11 * fx * fy)


def from_polar(p, shape, nr, nt):
    h, w = shape
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    r = np.hypot(xx - CX, yy - CY)
    th = np.degrees(np.arctan2(xx - CX, -(yy - CY))) % 360.0
    ri = np.clip((r / RMAX * nr).astype(np.int32), 0, nr - 1)
    ti = np.clip((th / 360.0 * nt).astype(np.int32), 0, nt - 1)
    return p[ri, ti]


def fill_along(pol, msk, axis):
    """沿某个轴按非掩膜点线性插值，填掉掩膜点。axis=1 时银经方向环回。"""
    out = pol.copy()
    n = pol.shape[axis]
    if axis == 1:
        idx = np.arange(n)
        # 把环回展开成线性：首尾各接一段
        ext = np.concatenate([out, out[:, :1]], axis=1)
        mext = np.concatenate([msk, msk[:, :1]], axis=1)
        for row in range(ext.shape[0]):
            g = ~mext[row]
            if g.sum() < 2 or not mext[row].any():
                continue
            gi = np.nonzero(g)[0]
            mi = np.nonzero(mext[row])[0]
            for c in range(3):
                out[row, mi % n, c] = np.interp(mi, gi, ext[row, gi, c])
    else:
        ex = out
        for col in range(ex.shape[1]):
            g = ~msk[:, col]
            if g.sum() < 2 or not msk[:, col].any():
                continue
            gi = np.nonzero(g)[0]
            mi = np.nonzero(msk[:, col])[0]
            for c in range(3):
                ex[mi, col, c] = np.interp(mi, gi, ex[gi, col, c])
    return out


def export_spiral(a):
    """导出 (半径 × 银经) 亮度表，给盘星按真实旋臂位置采样用。

    为什么需要：宇宙层那 120 万颗盘星原来是「4 条对数螺旋 + 随机撒」画出来的，
    和真实重建图的旋臂位置对不上；两套一起出现时，程序化那套会把真实形态盖住。
    这里把真实图的极坐标亮度压成 72×144 的表，JS 端按每行的累积分布采样方位角 ——
    盘星的旋臂就落在真实旋臂上，核球/径向轮廓仍用原来的物理模型。
    半径标定：15000 ly = 196 px，所以 R_OUT(588 px) ≈ 13.8 kpc。
    """
    NR, NT = 72, 144
    RMAX_KPC = 13.8
    h, w = a.shape[:2]
    lum = a.max(axis=2)
    out = np.zeros((NR, NT), np.uint8)
    for ir in range(NR):
        rp = (ir + 0.5) / NR * RMAX_KPC / RMAX_KPC * R_OUT   # 像素半径
        acc = np.zeros(NT)
        for it in range(NT):
            th = (it + 0.5) / NT * 360.0
            rad = np.radians(th)
            # 在该格内取 3 个半径样本平均，减少单像素噪声
            v = 0.0
            for dk in (-0.35, 0.0, 0.35):
                rr = rp + dk * (R_OUT / NR)
                x = int(round(CX + rr * np.sin(rad)))
                y = int(round(CY - rr * np.cos(rad)))
                if 0 <= x < w and 0 <= y < h:
                    v += lum[y, x]
            acc[it] = v / 3.0
        # 去掉直流本底：旋臂是"同一半径上比周围亮"的部分，用中值当基线
        base = np.median(acc)
        acc = np.clip(acc - base, 0, None)
        out[ir] = np.clip(acc, 0, 255).astype(np.uint8)
    # 3×3 平滑（半径方向 edge、银经方向环回）：单格 3 个采样点噪声太重，
    # 不平滑的话旋臂会被斑点噪声淹没
    p = np.pad(out.astype(np.float32), ((1, 1), (1, 1)), mode='edge')
    p[:, 0] = p[:, -2]
    p[:, -1] = p[:, 1]
    sm = np.zeros_like(out, np.float32)
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            sm += p[1 + dy:1 + dy + NR, 1 + dx:1 + dx + NT]
    sm /= 9.0
    for ir in range(NR):
        row = sm[ir]
        if row.max() > 0:
            out[ir] = np.clip(row / row.max() * 255.0, 0, 255).astype(np.uint8)
    with open('public/data/mw-spiral.bin', 'wb') as f:
        f.write(out.tobytes())
    print('spiral table', NR, 'x', NT, '=', out.size, 'bytes')


def main():
    a = load()
    h, w = a.shape[:2]
    tm = text_mask(a)
    ring, radial = grid_split(a.shape[:2])

    # 膨胀 3×3 覆盖抗锯齿边缘
    def dil(m):
        return np.asarray(Image.fromarray(m.astype(np.uint8) * 255, 'L')
                          .filter(ImageFilter.MaxFilter(3))) > 127

    ring, radial, tm = dil(ring), dil(radial), dil(tm)
    print('mask px: ring %d, radial %d, text %d' %
          (ring.sum(), radial.sum(), tm.sum()))

    nr, nt = int(560 * SC), int(600 * SC)
    pol = to_polar(a, nr, nt)
    pring = to_polar(ring.astype(np.float32)[..., None], nr, nt)[..., 0] > 0.3
    prad = to_polar((radial | tm).astype(np.float32)[..., None], nr, nt)[..., 0] > 0.3

    # ① 环线：沿半径插值（角向全是线，只能跨半径）
    pol = fill_along(pol, pring, axis=0)
    # ② 径向线 + 文字：沿银经插值（半径方向连续，只能跨角度）
    pol = fill_along(pol, prad, axis=1)

    filled = from_polar(pol, (h, w), nr, nt)
    allm = ring | radial | tm
    out = np.where(allm[..., None], filled, a)

    yy, xx = np.mgrid[0:h, 0:w]
    r = np.hypot(xx - CX, yy - CY)
    fade = np.clip((R_OUT + 4.0 * SC - r) / (34.0 * SC), 0.0, 1.0)[..., None]
    out = np.clip(out, 0, 255) * fade

    # 提亮暗部：原图的外盘只有 20~40 的亮度，在 additive 混合下几乎看不出盘面。
    # gamma 0.62 把暗部抬起来，同时压住核球的高光（等比提亮会让核球烧成纯白）。
    # 0.62 会把对比度压得太狠（旋臂和盘面拉平、整体发灰），0.78 只抬暗部不糊结构
    out = 255.0 * np.power(np.clip(out, 0, 255) / 255.0, 0.78)
    # gamma 抬暗部会把颜色一起拉向灰白（旋臂的蓝、HII 区的粉都被冲淡），
    # 按「相对亮度」把色度拉回来 —— 这是提亮后必须补的一步
    lum = out.mean(axis=2, keepdims=True)
    out = np.clip(lum + (out - lum) * 1.70, 0, 255)

    img = Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), 'RGB')
    # 插值填补 + 提亮都会软化旋臂边缘，最后一道 unsharp 把结构找回来
    img = img.filter(ImageFilter.UnsharpMask(radius=2.2, percent=115, threshold=3))
    img.save(DST, quality=92)
    img.resize((900, 900), Image.LANCZOS).save('_mw_clean_preview.png')
    print('written', DST, img.size)
    export_spiral(a)          # 用原图亮度（未 gamma），旋臂对比更强


if __name__ == '__main__':
    sys.exit(main())
