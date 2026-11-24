# -*- coding: utf-8 -*-
"""生成真实地貌数据图 + 真实火山坐标表（对话 91）。

  earth-biome.png  2048×1024 RGB
      R = 森林/林地覆盖（真实生物群系多边形）
      G = 平原/耕地/草原（真实农业带多边形）—— 也是村庄选址依据
      B = 湿地/泛滥平原/红树林/珊瑚浅滩
  volcanoes.json   120 座真实火山（lat/lon/海拔/锥底半径/类型）

三张图用同一套 UV（等距圆柱、v=0 对北极），陆地/干旱/冰盖直接从
earth-terrain.png 与 earth-climate.png 读，避免两套海岸线不一致。

注意：本脚本必须在 make-earth-map.py 之后运行。
"""
from PIL import Image, ImageDraw, ImageFilter
import numpy as np
import os, json, math, importlib.util

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
spec = importlib.util.spec_from_file_location("geo_real", os.path.join(HERE, "geo-real.py"))
G = importlib.util.module_from_spec(spec)
spec.loader.exec_module(G)

BW, BH = 2048, 1024


def xy(lon, lat):
    return ((lon + 180.0) / 360.0 * BW, (90.0 - lat) / 180.0 * BH)


def fbm(w, h, octaves, base, seed, aspect=2.0):
    """和 make-earth-map.py 同源的 value noise，用来打碎生态区边界。"""
    rng = np.random.default_rng(seed)
    out = np.zeros((h, w), np.float32)
    amp, total, g = 1.0, 0.0, base
    for _ in range(octaves):
        gw, gh = max(2, int(g * aspect)), max(2, int(g))
        grid = (rng.random((gh, gw)).astype(np.float32) * 2 - 1)
        out += np.asarray(Image.fromarray(grid, 'F').resize((w, h), Image.BICUBIC), dtype=np.float32) * amp
        total += amp
        amp *= 0.5
        g *= 2
    return out / max(total, 1e-6)


def paint_regions(regions, blur, seed):
    """把「多边形 + 强度」清单画成 0..1 连续场，边缘用分形噪声打碎。"""
    img = Image.new('L', (BW, BH), 0)
    d = ImageDraw.Draw(img)
    for item in regions:
        poly, strength = item[1], item[2]
        pts = [xy(lon, lat) for lon, lat in poly]
        # 经度跨 180° 的区域分段画，避免横跨整张图
        d.polygon(pts, fill=int(255 * strength))
    img = img.filter(ImageFilter.GaussianBlur(blur))
    a = np.asarray(img, dtype=np.float32) / 255.0
    # 边界破碎：真实森林/农田边界是锯齿状斑块，不是多边形直边
    n1 = fbm(BW, BH, 4, 34, seed) * 0.5 + 0.5
    n2 = fbm(BW, BH, 3, 130, seed + 71) * 0.5 + 0.5
    a = a * (0.62 + 0.52 * n1) * (0.84 + 0.32 * n2)
    # 内部也要有林窗/田埂，不能是纯色板
    return np.clip(a, 0, 1)


def main():
    tp = os.path.join(ROOT, 'earth-terrain.png')
    cp = os.path.join(ROOT, 'earth-climate.png')
    terr = Image.open(tp).convert('RGB')
    clim = Image.open(cp).convert('RGB')
    land = np.asarray(terr.getchannel('R').resize((BW, BH), Image.LANCZOS), dtype=np.float32) / 255.0
    arid = np.asarray(clim.getchannel('R').resize((BW, BH), Image.LANCZOS), dtype=np.float32) / 255.0
    ice = np.asarray(clim.getchannel('G').resize((BW, BH), Image.LANCZOS), dtype=np.float32) / 255.0
    # 城市密度高（混凝土）的地方不该是森林/农田
    city = np.asarray(terr.getchannel('B').resize((BW, BH), Image.LANCZOS), dtype=np.float32) / 255.0

    onland = np.clip((land - 0.42) * 3.2, 0, 1)
    notice = 1.0 - np.clip(ice * 1.4, 0, 1)
    notdry = 1.0 - np.clip((arid - 0.50) * 2.2, 0, 0.92)
    nocity = 1.0 - np.clip(city * 1.25, 0, 0.85)

    forest = paint_regions(G.FORESTS, 7.0, 9101) * onland * notice * notdry * nocity
    farm = paint_regions(G.FARMLANDS, 5.0, 9102) * onland * notice * (1 - forest * 0.88) * nocity
    # 农田要有田块结构：等距圆柱下按经纬度画一组细格，再被噪声打断
    yy, xx = np.mgrid[0:BH, 0:BW].astype(np.float32)
    fieldA = np.sin(xx * 0.185 + np.sin(yy * 0.055) * 1.7) * 0.5 + 0.5
    fieldB = np.sin(yy * 0.221 + np.sin(xx * 0.048) * 1.4) * 0.5 + 0.5
    field = (fieldA * 0.55 + fieldB * 0.45)
    farm = farm * (0.80 + 0.32 * field)
    wet = paint_regions(G.WETLANDS, 4.0, 9103) * onland * notice

    out = np.zeros((BH, BW, 3), np.uint8)
    out[:, :, 0] = np.clip(forest * 255, 0, 255).astype(np.uint8)
    out[:, :, 1] = np.clip(farm * 255, 0, 255).astype(np.uint8)
    out[:, :, 2] = np.clip(wet * 255, 0, 255).astype(np.uint8)
    img = Image.fromarray(out, 'RGB')
    img.save(os.path.join(ROOT, 'earth-biome.png'), optimize=True)
    img.save(os.path.join(ROOT, 'public', 'data', 'earth-biome.png'), optimize=True)

    volc = {"volcanoes": [G.volcano_dict(v) for v in G.VOLCANOES]}
    for p in (os.path.join(ROOT, 'volcanoes.json'),
              os.path.join(ROOT, 'public', 'data', 'volcanoes.json')):
        with open(p, 'w', encoding='utf-8') as f:
            json.dump(volc, f, ensure_ascii=False, indent=1)

    print('earth-biome.png', os.path.getsize(os.path.join(ROOT, 'earth-biome.png')),
          'bytes  forest>0.2', round(float((forest > 0.2).mean()) * 100, 1), '%',
          ' farm>0.2', round(float((farm > 0.2).mean()) * 100, 1), '%',
          ' wet>0.2', round(float((wet > 0.2).mean()) * 100, 1), '%')
    print('volcanoes.json', len(volc['volcanoes']), 'volcanoes')


if __name__ == '__main__':
    main()
