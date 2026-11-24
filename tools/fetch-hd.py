# -*- coding: utf-8 -*-
"""
下载 ESA/Hubble 高分辨率原图，压到 2048px 长边，供「超高清影像」查看器与
3D 场景近景 LOD 使用。原图来自 esahubble.org（CC BY 4.0）。

同时把 data/photo/*.jpg 统一成 640x640 黑边正方形（等比 contain，不裁切），
修掉图鉴里横幅图被裁成「只有一半」的问题。
"""
import concurrent.futures as cf
import io
import json
import re
import shutil
import urllib.request
from pathlib import Path

from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parent.parent
PUB = ROOT / 'public' / 'data'
SRV = ROOT.parent / 'orbit-server' / 'src' / 'main' / 'resources' / 'static' / 'data'
HD = PUB / 'hd'
SRV_HD = SRV / 'hd'
HD.mkdir(parents=True, exist_ok=True)
SRV_HD.mkdir(parents=True, exist_ok=True)

UA = {'User-Agent': 'Mozilla/5.0 (compatible; ORBIT-edu/1.0)'}


def get(url, timeout=45):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
        return r.read()


# ---------------------------------------------------------------- 1. 统一缩略图
def square(src, dst, size=640):
    im = Image.open(src).convert('RGB')
    im.thumbnail((size, size), Image.LANCZOS)
    canvas = Image.new('RGB', (size, size), (3, 6, 10))
    canvas.paste(im, ((size - im.width) // 2, (size - im.height) // 2))
    canvas.save(dst, 'JPEG', quality=86, optimize=True)


changed = 0
for f in sorted((PUB / 'photo').glob('*.jpg')):
    im = Image.open(f)
    if im.size == (640, 640):
        continue
    square(f, f)
    changed += 1
for f in (PUB / 'photo').glob('*.jpg'):
    shutil.copyfile(f, SRV / 'photo' / f.name)
print('缩略图统一为 640x640：', changed, '张', flush=True)

# ---------------------------------------------------------------- 2. 高清原图
cat = json.loads((PUB / 'photo-catalog.json').read_text(encoding='utf-8'))


def esa_id(key):
    if key.startswith('gc_'):
        return key[3:]
    if key.startswith('esa_'):
        return key[4:]
    if re.match(r'^(heic|opo|potw|potm|weic)\d{4}[a-z]?$', key):
        return key
    return None


cands = [(k, esa_id(k)) for k in cat if esa_id(k)]
# 星系（esa_）优先，其次球状星团 / 深场，控制总量
cands.sort(key=lambda x: (0 if x[0].startswith('esa_') else 1, x[0]))
cands = cands[:30]
print('待下载高清原图', len(cands), '张', flush=True)


def fetch_hd(pair):
    key, eid = pair
    out = HD / (key + '.jpg')
    if out.exists():
        return key, True
    for variant in ('large', 'screen'):
        try:
            raw = get('https://cdn.esahubble.org/archives/images/%s/%s.jpg' % (variant, eid))
            im = Image.open(io.BytesIO(raw)).convert('RGB')
            im.thumbnail((2048, 2048), Image.LANCZOS)
            im.save(out, 'JPEG', quality=86, optimize=True)
            return key, True
        except Exception:
            continue
    return key, False


hd = {}
with cf.ThreadPoolExecutor(max_workers=6) as ex:
    for key, ok in ex.map(fetch_hd, cands):
        if ok:
            hd[key] = key + '.jpg'
        else:
            print('下载失败', key, flush=True)

for key, fn in hd.items():
    shutil.copyfile(HD / fn, SRV_HD / fn)
(PUB / 'hd-map.json').write_text(json.dumps(hd, ensure_ascii=False, indent=1), encoding='utf-8')
(SRV / 'hd-map.json').write_text(json.dumps(hd, ensure_ascii=False, indent=1), encoding='utf-8')
print('高清图', len(hd), '张，总大小',
      round(sum((HD / f).stat().st_size for f in hd.values()) / 1048576, 1), 'MB', flush=True)
