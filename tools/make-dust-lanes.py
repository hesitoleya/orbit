# -*- coding: utf-8 -*-
"""对话 164b：从 Gaia 俯视图中提取「尘埃吸收图」（丝状体版本）。

164 首版拿银河中心照片裁剪当尘埃贴图，形态与 Gaia 旋臂无关 —— 叠上去就是
一团团粗黑斑。真实尘埃带是夹在旋臂里的窄丝状体，所以最忠实的做法是从银河
自己的亮度分布里把「比周围暗的沟」解出来：

  Ls   = 轻微去噪的亮度
  B1   = 丝状尺度模糊（σ≈8px）—— 一条尘埃带的宽度量级
  B2   = 旋臂尺度模糊（σ≈40px）—— 星族自身的平滑分布
  gap  = (B2 - Ls)/(B2+eps)      # 该点比它附近的星族模型暗多少

只有 gap 明显为正（真的被挡住了）才算尘埃。输出 alpha = 尘埃柱密度，
RGB = 吸收色（暗棕）。NormalBlending 叠在盘上就是「尘埃挡星光」。

同时输出一张 _preview.png（尘埃压回原图），用来肉眼确认丝带是否咬在
Gaia 自己的暗纹上。
"""
import sys
import numpy as np
from PIL import Image, ImageFilter

SRC = sys.argv[1] if len(sys.argv) > 1 else 'public/data/mw/gaia-face.jpg'
DST = sys.argv[2] if len(sys.argv) > 2 else 'public/data/mw/dust-lanes.png'
OUT = 1024
TO_W = 1400          # 工作分辨率（够细，又不至于太慢）

im = Image.open(SRC).convert('RGB')
W0, H0 = im.size
im = im.resize((TO_W, TO_W), Image.LANCZOS)
W = H = TO_W
a = np.asarray(im).astype(np.float32) / 255.0
L = a[:, :, 0] * 0.2126 + a[:, :, 1] * 0.7152 + a[:, :, 2] * 0.0722


def blur(arr, radius, down=1):
    q = max(1, down)
    w = max(8, arr.shape[1] // q)
    img = Image.fromarray((np.clip(arr, 0, 1) * 255).astype(np.uint8))
    img = img.resize((w, w), Image.LANCZOS).filter(
        ImageFilter.GaussianBlur(radius=max(0.5, radius / q)))
    img = img.resize((arr.shape[1], arr.shape[0]), Image.BILINEAR)
    return np.asarray(img).astype(np.float32) / 255.0


Ls = blur(L, 5, 1)          # 去星点噪
B1 = blur(L, 9, 2)          # 丝状尺度
B2 = blur(L, 46, 4)         # 旋臂尺度
BG = blur(L, 210, 8)        # 星系本体

# 局部缺损：比「旋臂尺度的平滑星族」暗多少
gap = (B2 - Ls) / np.maximum(B2, 0.02)
# 只保留真正的沟（gap 大）：软阈值，避免把整片盘都算成尘埃
d = np.clip((gap - 0.100) / 0.36, 0.0, 1.0)
d = d * d * (3 - 2 * d)

# 本体掩膜：星系外面的黑背景不算「被尘埃挡」。
# 164b：只按超宽尺度（BG）判本体是不够的 —— Gaia 外圈旋臂很淡但面积大，
# BG 仍在阈值以上，于是尘埃丝带落到亮盘之外，在纯黑背景上变成一片片
# 孤立的棕色「花瓣」（实测截图）。这里再乘一层**旋臂尺度**的亮度门槛，
# 只保留真正有星光的区域，丝带就被锁在亮盘里面。
def sstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)

body = sstep(0.045, 0.115, BG) * sstep(0.055, 0.145, B2)

# 盘边界窗口：按**方位平均亮度剖面**定出「亮盘到哪里结束」，丝带严格锁在里面。
# 只靠亮度阈值不行 —— 外圈旋臂很淡但面积大，尘埃落在那里就是纯黑背景上的
# 一片棕色花瓣（A/B 截图实测）。
yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
rr = np.hypot(xx - W / 2, yy - H / 2) / (W / 2)
bins = 120
prof = np.zeros(bins, np.float32)
cnt = np.zeros(bins, np.float32)
idx = np.clip((rr * bins).astype(np.int32), 0, bins - 1)
np.add.at(prof, idx, L)
np.add.at(cnt, idx, 1.0)
prof = prof / np.maximum(cnt, 1)
peak = prof.max()
edge = 0.55
for i in range(bins - 1, 0, -1):
    if prof[i] > 0.075 * peak:
        edge = (i + 0.5) / bins
        break
win = np.clip((edge - rr) / (edge * 0.30), 0.0, 1.0)
win = win * win * (3 - 2 * win)
print('disk edge r = %.3f' % edge)
body = body * win
# 最后一层：**必须有星光可挡**。尘埃本身不发光，挡在纯黑背景上应该看不见 ——
# 只有背后有星光的尘埃才会显形。用亮度本身当可见度权重，盘缘的孤立棕斑就没了。
body = body * sstep(0.030, 0.130, L)

alpha = np.clip(d * body * 3.40, 0.0, 1.0)

# 吸收色：暗棕（蓝光被尘埃散射掉得更彻底）
rgb = np.zeros((H, W, 3), np.float32)
rgb[:, :, 0] = 0.150
rgb[:, :, 1] = 0.086
rgb[:, :, 2] = 0.058
yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
n = (np.sin(xx * 0.041) * np.sin(yy * 0.037) + np.sin((xx + yy) * 0.019)) * 0.5 + 0.5
rgb *= (0.84 + 0.32 * n)[:, :, None]

out = np.dstack([rgb, alpha])
img = Image.fromarray((np.clip(out, 0, 1) * 255).astype(np.uint8), 'RGBA')
img = img.resize((OUT, OUT), Image.LANCZOS)
img.save(DST, optimize=True)

# --- 预览：把尘埃按 alpha 压回原图，检查丝带是否咬在暗纹上 ---
prev = a.copy()
k = (alpha * 0.88)[:, :, None]
prev = prev * (1 - k) + rgb * k * 0.55
Image.fromarray((np.clip(prev, 0, 1) * 255).astype(np.uint8)).save(
    'public/data/mw/_dust_preview.png')

print('dust-lanes:', DST, img.size)
print('alpha mean %.3f  cov>0.5 %.1f%%  cov>0.2 %.1f%%'
      % (alpha.mean(), (alpha > 0.5).mean() * 100, (alpha > 0.2).mean() * 100))
