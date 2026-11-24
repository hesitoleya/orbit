# -*- coding: utf-8 -*-
"""
为 268 条天体档案补齐「真实实拍图」。

图源：ESA/Hubble 官方图库（esahubble.org / cdn.esahubble.org）+ 项目内已有的
      ESA/Hubble 与 NOIRLab 影像。所有图片都是真实望远镜拍摄，不是程序生成的示意图。

产出：
  public/data/photo/*.jpg                 统一 448x448 的真实影像
  public/data/photo-catalog.json         每张图的标题、原始页面、版权
  public/data/photo-map.json             code -> {photo,title,url,credit}
  ../orbit-server/src/main/resources/db/photo-map.json   （后端启动时补库用）
  ../orbit-server/src/main/resources/static/data/photo/  （与 public 同步）

每个天体都会拿到一张真实影像；专属影像（M31、47 Tuc 等）优先按名称精确匹配，
其余同类天体按名称哈希分配到该类型的真实影像池，并在维基页标注图像来源与
「同类型真实影像」字样，不冒充该天体本身的照片。
"""
import concurrent.futures as cf
import hashlib
import io
import json
import re
import shutil
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PUB = ROOT / 'public' / 'data'
PHOTO = PUB / 'photo'
SERVER_DB = ROOT.parent / 'orbit-server' / 'src' / 'main' / 'resources' / 'db'
SERVER_PHOTO = ROOT.parent / 'orbit-server' / 'src' / 'main' / 'resources' / 'static' / 'data' / 'photo'
DATA_SQL = ROOT.parent / 'orbit-server' / 'src' / 'main' / 'resources' / 'db' / 'data.sql'

PHOTO.mkdir(parents=True, exist_ok=True)
SERVER_PHOTO.mkdir(parents=True, exist_ok=True)

UA = {'User-Agent': 'Mozilla/5.0 (compatible; ORBIT-edu/1.0; graduation project)'}


def get(url, timeout=30):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


# ---------------------------------------------------------------- 已有本地影像
CATALOG = {}
for d, prefix in ((PUB / 'gal', ''), (PUB / 'cos', '')):
    if not d.exists():
        continue
    for f in sorted(d.glob('*.jpg')):
        key = f.stem
        dst = PHOTO / f.name
        if not dst.exists():
            shutil.copyfile(f, dst)
        CATALOG[key] = {
            'file': f.name,
            'title': key,
            'url': 'https://esahubble.org/images/' + key.replace('esa_', '') + '/'
            if key.startswith('esa_') or re.match(r'^(heic|opo|potw|potm)', key)
            else 'https://esahubble.org/images/',
            'credit': 'ESA/Hubble & NASA, CC BY 4.0',
            'kind': 'gal' if d.name == 'gal' else 'cos',
            'local': True,
        }

# ---------------------------------------------------------------- 抓取 ESA 图库索引
SEARCH = [
    ('gc', 'globular%20cluster'),
    ('gc', 'globular'),
    ('gc', 'star%20cluster'),
    ('cos', 'galaxy%20cluster'),
    ('cos', 'deep%20field'),
    ('cos', 'gravitational%20lensing'),
]
ENTRY = re.compile(r"\{\s*id:\s*'([a-z0-9]+)',\s*title:\s*'((?:[^'\\]|\\.)*)'.*?url:\s*'([^']+)'", re.S)

entries = {}
for kind, kw in SEARCH:
    try:
        html = get('https://esahubble.org/images/?search=' + kw, 25).decode('utf-8', 'ignore')
    except Exception as e:
        print('索引抓取失败', kw, e, file=sys.stderr)
        continue
    for m in ENTRY.finditer(html):
        i, title, url = m.group(1), m.group(2), m.group(3)
        if i in entries:
            continue
        entries[i] = {
            'id': i,
            'title': title.replace("\\'", "'"),
            'url': 'https://esahubble.org' + url if url.startswith('/') else url,
            'kind': kind,
        }
    print('索引', kw, '累计', len(entries))

# 只取前 46 张，控制体积与下载时间；球状星团优先
ids = sorted(entries, key=lambda i: (0 if entries[i]['kind'] == 'gc' else 1, i))
gc_ids = [i for i in ids if entries[i]['kind'] == 'gc'][:34]
cos_ids = [i for i in ids if entries[i]['kind'] == 'cos'][:12]
ids = gc_ids + cos_ids
print('待下载', len(ids), '张（球状星团', len(gc_ids), '，深场/星系团', len(cos_ids), '）')


def fetch(i):
    out = PHOTO / ('gc_' + i + '.jpg')
    if out.exists():
        return i, True, 'cached'
    for variant in ('screen', 'thumb600y', 'thumb300y'):
        try:
            raw = get('https://cdn.esahubble.org/archives/images/%s/%s.jpg' % (variant, i), 35)
            from PIL import Image, ImageOps
            im = Image.open(io.BytesIO(raw)).convert('RGB')
            im = ImageOps.fit(im, (448, 448), method=Image.LANCZOS, centering=(0.5, 0.5))
            im.save(out, 'JPEG', quality=82, optimize=True)
            return i, True, variant
        except Exception as e:
            last = str(e)
    return i, False, last


with cf.ThreadPoolExecutor(max_workers=8) as ex:
    for i, ok, how in ex.map(fetch, ids):
        if ok:
            e = entries[i]
            CATALOG['gc_' + i] = {
                'file': 'gc_' + i + '.jpg',
                'title': e['title'],
                'url': e['url'],
                'credit': 'ESA/Hubble & NASA, CC BY 4.0',
                'kind': e['kind'],
                'local': False,
            }
        else:
            print('下载失败', i, how, file=sys.stderr)

print('图片总数', len(CATALOG))

# ---------------------------------------------------------------- 解析 268 条档案
ROW = re.compile(
    r"^\('([^']*)','([^']*)','([^']*)','([^']*)','([^']*)',"
    r"([-\d.]+),([-\d.]+),([-\d.]+),([-\d.]+),(NULL|[-\d.]+),'([^']*)','([^']*)',",
    re.M)
rows = []
for m in ROW.finditer(DATA_SQL.read_text(encoding='utf-8')):
    rows.append({'code': m.group(1), 'name': m.group(2), 'name_en': m.group(3),
                 'alias': m.group(4), 'type': m.group(5), 'photo': m.group(11)})
print('档案条数', len(rows))

pools = {
    'gal': sorted(k for k, v in CATALOG.items() if v['kind'] == 'gal'),
    'gc': sorted(k for k, v in CATALOG.items() if v['kind'] == 'gc'),
    'cos': sorted(k for k, v in CATALOG.items() if v['kind'] == 'cos'),
}
# 保底：类型池为空时用其它池
for k in pools:
    if not pools[k]:
        pools[k] = sorted(CATALOG)

# 名称 -> 专属 ESA 影像（真实对应）
EXACT = [
    (r'47\s*Tuc|NGC\s*104', 'heic1510a'),
    (r'Omega|ω\s*Cen|半人马|NGC\s*5139', 'heic1302a'),
    (r'M\s*13|NGC\s*6205', 'heic0206a'),
    (r'M\s*15|NGC\s*7078', 'potw1428a'),
    (r'NGC\s*6752', 'potw1449a'),
    (r'M\s*22|NGC\s*6656', 'potw1550a'),
    (r'M\s*3|NGC\s*5272', 'potw1751a'),
    (r'M\s*5|NGC\s*5904', 'potw1804a'),
    (r'M\s*92|NGC\s*6341', 'potw1812a'),
]
exact_map = {}
for pat, eid in EXACT:
    for cand in ('gc_' + eid, 'esa_' + eid, eid):
        if cand in CATALOG:
            exact_map[re.compile(pat, re.I)] = cand
            break


def pick(row):
    name = (row['name'] + ' ' + row['name_en'] + ' ' + row['alias'])
    # 数据库里原本就有专属图
    if row['photo']:
        key = row['photo']
        if key in CATALOG:
            return key
    for rx, key in exact_map.items():
        if rx.search(name):
            return key
    t = row['type']
    if t == 'globular':
        pool = pools['gc']
    elif t.startswith('galaxy'):
        pool = pools['gal']
    else:
        pool = pools['cos']
    h = int(hashlib.md5(row['code'].encode('utf-8')).hexdigest()[:8], 16)
    return pool[h % len(pool)]


MAP = {}
for r in rows:
    key = pick(r)
    c = CATALOG[key]
    MAP[r['code']] = {
        'photo': key,
        'title': c['title'],
        'url': c['url'],
        'credit': c['credit'],
        'exact': bool(r['photo']) and r['photo'] in CATALOG,
    }

# ---------------------------------------------------------------- 输出
(PUB / 'photo-catalog.json').write_text(json.dumps(CATALOG, ensure_ascii=False, indent=1), encoding='utf-8')
(PUB / 'photo-map.json').write_text(json.dumps(MAP, ensure_ascii=False, indent=1), encoding='utf-8')
SERVER_DB.mkdir(parents=True, exist_ok=True)
(SERVER_DB / 'photo-map.json').write_text(json.dumps(MAP, ensure_ascii=False, indent=1), encoding='utf-8')
for f in PHOTO.glob('*.jpg'):
    shutil.copyfile(f, SERVER_PHOTO / f.name)

# 同步 data.sql 的 photo_key（重建库时即为最新）
sql = DATA_SQL.read_text(encoding='utf-8')
lines = sql.splitlines(True)
out, n = [], 0
for line in lines:
    m = ROW.match(line)
    if m:
        key = MAP.get(m.group(1), {}).get('photo')
        if key and m.group(11) != key:
            old = ",'%s','%s'," % (m.group(11), m.group(12))
            new = ",'%s','%s'," % (key, m.group(12))
            line = line.replace(old, new, 1)
            n += 1
    out.append(line)
DATA_SQL.write_text(''.join(out), encoding='utf-8')
print('data.sql 更新 photo_key', n, '行')
print('photo-map.json', len(MAP), '条')
