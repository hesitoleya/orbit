# -*- coding: utf-8 -*-
"""把真实影像处理成天球背景可用的贴图（对话 165）。

用户反馈：「地球的宇宙背景板有两块白色的星云，很模糊」——那是程序化
256² 贴图放大到 10°/5° 的大麦/小麦哲伦云。这里换成真实影像：

  大麦哲伦云  ESO/VISTA 全天巡天 mosaic（eso1914a, CC BY 4.0）→ lmc.jpg
  小麦哲伦云  DSS2 红板 + 蓝板合成（SkyView 取像）            → smc.jpg

两个都做「方形取景 + 径向羽化」：天球上是一块方形 sprite，边缘必须
羽化到 0，否则能看出贴图的方框（真实照片的四角也不是纯黑）。
"""
import os
import numpy as np
from PIL import Image, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
PUB = os.path.join(HERE, '..', 'public', 'data', 'sky')
os.makedirs(PUB, exist_ok=True)
TMP = os.path.join(HERE, '..')


def load(fn):
    return np.asarray(Image.open(os.path.join(TMP, fn)).convert('RGB')).astype(np.float32) / 255.0


def sstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def radial_fade(img, r0, r1):
    """方形贴图的边缘羽化：rr>r0 起淡出，到 r1 归零（r1=1 是内切圆）。"""
    H, W = img.shape[:2]
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    rr = np.hypot((xx - (W - 1) / 2) / (W / 2), (yy - (H - 1) / 2) / (H / 2))
    k = 1.0 - sstep(r0, r1, rr)
    return img * k[..., None]


def kill_pedestal(img, q=40):
    """天球贴图是加法混合：背景不能有底噪，否则整块 sprite 会给天空加一层灰纱。
    DSS 板、VISTA mosaic 的四角都不是纯黑（胶片底灰 + 天光），必须先扣掉。"""
    p = float(np.percentile(img.max(2), q))
    return np.clip((img - p) / max(1.0 - p, 1e-6), 0, 1)


def save_jpg(img, name, q=90):
    a = np.clip(img, 0, 1)
    # 轻微 S 曲线：巡天图的中间调太平，直接贴上去像一层灰雾
    a = a ** 0.92
    Image.fromarray((a * 255 + 0.5).astype(np.uint8)).save(
        os.path.join(PUB, name), quality=q, subsampling=1, optimize=True)
    print('  ->', name, Image.open(os.path.join(PUB, name)).size)


print('[1] 大麦哲伦云  ESO/VISTA eso1914a')
lmc = load('_lmc_screen.jpg')                     # 1280x1430
# 竖向取景，星系偏中上：裁成方形时以亮度重心为中心
lum = lmc.max(2)
H, W = lum.shape
cy, cx = np.unravel_index(np.argmax(Image.fromarray((lum * 255).astype(np.uint8))
                                    .filter(ImageFilter.GaussianBlur(60))), lum.shape)
side = min(W, H)
cy = int(np.clip(cy, side // 2, H - side // 2))
cx = int(np.clip(cx, side // 2, W - side // 2))
lmc_c = lmc[cy - side // 2:cy + side // 2, cx - side // 2:cx + side // 2]
print('   crop', lmc_c.shape, 'center', (cx, cy))
lmc_s = np.asarray(Image.fromarray((lmc_c * 255).astype(np.uint8))
                   .resize((1024, 1024), Image.LANCZOS)).astype(np.float32) / 255.0
lmc_s = radial_fade(kill_pedestal(lmc_s, 25), 0.86, 1.06)
# VISTA 这张的原色偏暖（棒部是 Hα 红 + 尘埃红化），整颗星系的蓝白盘被压住了。
# 轻微去红、提蓝，让它回到「蓝白主体 + 粉色恒星形成区」的真实观感。
lmc_s = lmc_s * np.array([0.90, 1.00, 1.12])
lmc_s = np.clip(lmc_s * 1.10, 0, 1)
save_jpg(lmc_s, 'lmc.jpg')

print('[2] 小麦哲伦云  DSS2 Red + Blue')
r = np.asarray(Image.open(os.path.join(TMP, '_smc_red.jpg')).convert('L')).astype(np.float32) / 255.0
b = np.asarray(Image.open(os.path.join(TMP, '_smc_blue.jpg')).convert('L')).astype(np.float32) / 255.0
print('   plates', r.shape, b.shape)
# DSS 两张板的零点/对比不一样，先各自按分位数归一
def norm(x):
    lo, hi = np.percentile(x, 42), np.percentile(x, 99.93)
    return np.clip((x - lo) / max(hi - lo, 1e-6), 0, 1)
r, b = norm(r), norm(b)
# 合成：蓝板当 G/B，红板当 R（SMC 主要由年轻蓝星和 HII 区组成，偏蓝白）
img = np.stack([0.62 * b + 0.46 * r, 0.86 * b + 0.20 * r, 1.00 * b + 0.08 * r], axis=2)
# 保留一点真实的色温差：亮星（红板更亮处）偏暖
warm = np.clip(r - b, 0, 1)[..., None]
img = img * (1 - 0.55 * warm) + np.array([1.0, 0.72, 0.48]) * (0.55 * warm)
img = np.clip(img, 0, 1)
img = radial_fade(kill_pedestal(img, 48), 0.74, 1.04)
# DSS 板动态范围窄：直接贴上去是「亮核 + 一点点雾」。抬中间调，让 3°~4° 的
# 弥散主体显出来（真实 SMC 就是这样一片没有明显核的雾），核区靠软肩压住。
img = 1.0 - (1.0 - np.clip(img, 0, 1)) ** 1.55
save_jpg(img, 'smc.jpg', q=92)

# 预览：把处理结果放进一张对照图
prev = Image.new('RGB', (1024, 520), (8, 8, 10))
a = Image.open(os.path.join(PUB, 'lmc.jpg')).resize((512, 512), Image.LANCZOS)
c = Image.open(os.path.join(PUB, 'smc.jpg')).resize((512, 512), Image.LANCZOS)
prev.paste(a, (0, 4))
prev.paste(c, (512, 4))
prev.save(os.path.join(PUB, '_preview.png'))
print('done')
