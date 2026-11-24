# -*- coding: utf-8 -*-
"""补齐高清影像：图鉴保留原比例、长边不超过2048；场景等比黑底1024方形。

只写 public/data 与服务器 static/data。已有HD优先复用；清单从实际文件重建。
下载链接取自既有图源页面，优先官方 Publication JPEG，不解码巨幅原图。
"""
import concurrent.futures as cf
import hashlib
import html
import io
import json
import re
import tempfile
import time
import urllib.request
from collections import Counter
from pathlib import Path

import numpy as np
from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parent.parent
PUB = ROOT / 'public' / 'data'
SRV = ROOT.parent / 'orbit-server' / 'src' / 'main' / 'resources' / 'static' / 'data'
HD = PUB / 'hd'
PHD = PUB / 'photo-hd'
UA = {'User-Agent': 'Mozilla/5.0 (compatible; ORBIT-edu/1.0)'}
MAX_BYTES = 24 * 1024 * 1024
MAX_PIXELS = 32 * 1024 * 1024

# 三个已有ID由目录标题、旧cos JPEG注释及图像对照核实。
# 其余ID来自 photo-catalog.json 原有 search URL 返回的官方条目，不按名称猜ID。
# MACS0416 使用同一星系团的新合成影像，不声称是旧cos照片的原版。
COS_SOURCES = {
    'abell1689': ('heic1317a', 'Abell 1689 星系团（Hubble）'),
    'abell2218': ('heic0814a', 'Abell 2218 星系团（Hubble）'),
    'macs0416': ('heic2310a', 'MACS J0416.1-2403 星系团（Hubble/Webb 合成影像）'),
    'perseus': ('heic0817a', '英仙座星系团中心星系 NGC 1275（非全团视场）'),
    'quintet': ('heic0910i', "Stephan's Quintet 斯蒂芬五重星系（Hubble）"),
    'relativity': ('potw2050a', 'GAL-CLUS-022058s 引力透镜（Rings of Relativity）'),
}


def esa_id(key):
    for prefix in ('gc_', 'esa_', 'cos_'):
        if key.startswith(prefix):
            key = key[len(prefix):]
            break
    return key if re.fullmatch(r'(?:heic|opo|potw|potm|weic)\d{4}[a-z]?', key) else None


def digest(path):
    with path.open('rb') as f:
        return hashlib.file_digest(f, 'sha256').hexdigest()


def write_bytes(path, data):
    if path.exists() and path.read_bytes() == data:
        return
    tmp = path.with_suffix(path.suffix + '.tmp')
    try:
        tmp.write_bytes(data)
        tmp.replace(path)
    finally:
        tmp.unlink(missing_ok=True)


def write_json(path, data):
    write_bytes(path, json.dumps(data, ensure_ascii=False, indent=1).encode('utf8'))


def save_jpeg(im, path, quality):
    out = io.BytesIO()
    im.save(out, 'JPEG', quality=quality, subsampling=0, optimize=True)
    write_bytes(path, out.getvalue())


def sync(path):
    dest = SRV / path.relative_to(PUB)
    dest.parent.mkdir(parents=True, exist_ok=True)
    if not dest.exists() or digest(path) != digest(dest):
        write_bytes(dest, path.read_bytes())


def get(url, limit=MAX_BYTES):
    """有限读取：连接/单次读取30秒，总传输120秒，限制字节数并落临时盘。"""
    start = time.monotonic()
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=30) as response:
        length = int(response.headers.get('Content-Length', 0))
        if length > limit:
            raise ValueError(f'文件过大：{length} > {limit}')
        with tempfile.TemporaryFile(dir=HD) as f:
            total = 0
            while True:
                if time.monotonic() - start > 120:
                    raise TimeoutError('下载超过120秒')
                block = response.read1(64 * 1024)
                if not block:
                    break
                total += len(block)
                if total > limit:
                    raise ValueError('下载超出字节上限')
                f.write(block)
            if length and total != length:
                raise IOError(f'下载不完整：{total}/{length}')
            f.seek(0)
            return f.read()


def source_page(url, eid):
    text = get(url, 2 * 1024 * 1024).decode('utf8')
    urls = re.findall(r'href="(https://cdn\.esahubble\.org/archives/images/[^"\s]+)"', text)
    candidates = []
    for variant in ('publicationjpg', 'large'):
        for link in urls:
            if link.endswith(f'/{variant}/{eid}.jpg') and link not in candidates:
                candidates.append(link)
    if not candidates:
        raise ValueError('来源页未提供可用高清JPEG链接')
    match = re.search(r'<div class="credit">(.*?)</div>', text, re.S)
    credit = html.unescape(re.sub('<[^>]+>', '', match.group(1))).strip() if match else ''
    return candidates, credit


def contain_square(im, size=1024):
    """等比完整保留，不裁切、不拉伸、不修改传入的图鉴图。"""
    fitted = ImageOps.contain(im, (size, size), Image.Resampling.LANCZOS)
    canvas = Image.new('RGB', (size, size), (0, 0, 0))
    canvas.paste(fitted, ((size - fitted.width) // 2, (size - fitted.height) // 2))
    return canvas


def kill_pedestal(im, frac=0.05):
    """低分位估计底灰，最多扣6/255；禁止亮部分位导致星云暗部被清空。"""
    if not 0 <= frac <= 0.1:
        raise ValueError('底灰分位须处于0至0.1')
    a = np.asarray(im, dtype=np.float32)
    p = min(float(np.quantile(a.max(axis=2), frac)), 6.0)
    a = np.clip((a - p) * (255.0 / (255.0 - p)), 0, 255)
    return Image.fromarray(a.round().astype('uint8'))


def radial_fade(im, inner=0.78, power=1.6):
    """以内切椭圆归一；四条边全部为零，留足黑边防JPEG边界振铃。"""
    w, h = im.size
    y, x = np.ogrid[:h, :w]
    r = np.hypot((x - (w - 1) / 2) / ((w - 1) / 2),
                 (y - (h - 1) / 2) / ((h - 1) / 2))
    t = np.clip((r - inner) / (0.96 - inner), 0, 1)
    k = (1 - t * t * (3 - 2 * t)) ** power
    a = np.asarray(im, dtype=np.float32) * k[..., None]
    return Image.fromarray(np.clip(a, 0, 255).round().astype('uint8'))


def fetch_group(item):
    eid, keys, page, previous = item
    try:
        # 同图不同键只下载一次；恢复中断时先找任意已完成本地或服务器副本。
        cached = next((folder / (key + '.jpg') for folder in (HD, SRV / 'hd')
                       for key in keys if (folder / (key + '.jpg')).exists()), None)
        meta = dict(max((previous[k] for k in keys if k in previous),
                        key=lambda value: bool(value.get('credit')), default={}))
        credit = meta.get('credit', '')
        if cached is not None:
            with Image.open(cached) as im:
                im.load()
                size = im.size
                if max(size) > 2048:
                    raise ValueError(f'已有HD超出尺寸上限：{size}')
            raw = cached.read_bytes()
            mode = '复用'
            meta.setdefault('download_url', None)
            meta.setdefault('source_note', '已有HD；历史下载字节未保留，不伪造原始校验值')
        else:
            links, credit = source_page(page, eid)
            errors = []
            for url in links:
                try:
                    source = get(url)
                    with Image.open(io.BytesIO(source)) as im:
                        source_size = im.size
                        if im.width * im.height > MAX_PIXELS:
                            raise ValueError(f'像素数过大：{im.size}')
                        im.draft('RGB', (2048, 2048))
                        im = ImageOps.exif_transpose(im)
                        im.thumbnail((2048, 2048), Image.Resampling.LANCZOS)
                        im = im.convert('RGB')
                        size = im.size
                        out = io.BytesIO()
                        im.save(out, 'JPEG', quality=86, subsampling=0, optimize=True)
                        raw = out.getvalue()
                    meta = {'download_url': url, 'source_size': list(source_size),
                            'source_sha256': hashlib.sha256(source).hexdigest()}
                    break
                except Exception as exc:
                    errors.append(f'{url}: {exc}')
            else:
                raise RuntimeError('; '.join(errors))
            mode = '下载'
        for key in keys:
            dst = HD / (key + '.jpg')
            if not dst.exists():
                write_bytes(dst, raw)
        meta.update({'image_id': eid, 'page_url': page, 'credit': credit})
        return keys, True, mode, size, meta
    except Exception as exc:
        return keys, False, str(exc), None, {}


def main():
    for directory in (HD, PHD, PUB / 'sky', SRV):
        directory.mkdir(parents=True, exist_ok=True)
    cat = json.loads((PUB / 'photo-catalog.json').read_text(encoding='utf8'))
    photo_map = json.loads((PUB / 'photo-map.json').read_text(encoding='utf8'))
    source_file = PUB / 'hd-sources.json'
    previous = json.loads(source_file.read_text(encoding='utf8')) if source_file.exists() else {}
    before = {p.name: digest(p) for p in HD.glob('*.jpg')}
    groups = {}
    for key in sorted(set(cat) | {p.stem for p in HD.glob('*.jpg')}):
        eid = esa_id(key)
        if eid:
            groups.setdefault(eid, []).append(key)
    for key, (eid, _) in COS_SOURCES.items():
        groups.setdefault(eid, []).append(key)
    groups.setdefault('heic0601a', []).append('m42')
    items = []
    for eid, keys in groups.items():
        keys = sorted(set(keys))
        page = next((cat[k]['url'] for k in keys if k in cat and esa_id(k)),
                    f'https://esahubble.org/images/{eid}/')
        items.append((eid, keys, page, previous))
    sources = {}
    failed = []
    counts = Counter()
    with cf.ThreadPoolExecutor(max_workers=2) as ex:
        for keys, success, mode, size, meta in ex.map(fetch_group, items):
            if not success:
                failed.extend(keys)
                print('失败', keys, mode, flush=True)
                continue
            counts[mode] += 1
            for key in keys:
                sources[key] = dict(previous.get(key, {}))
                sources[key].update({field: value for field, value in meta.items()
                                     if field in ('download_url', 'source_size', 'source_sha256',
                                                  'image_id', 'page_url', 'credit')})
                if not sources[key].get('download_url'):
                    sources[key].setdefault('source_note', '复用已有HD；历史下载字节未保留')
            print(mode, ','.join(keys), size, meta.get('download_url'), flush=True)

    # 只为成功落盘的同目标资源修订出处，保留原photo-map的exact标记。
    for key, (eid, title) in COS_SOURCES.items():
        if key not in sources:
            continue
        meta = sources[key]
        if not meta.get('credit'):
            try:
                _, meta['credit'] = source_page(meta['page_url'], eid)
            except Exception as exc:
                print('署名抓取失败', key, str(exc), flush=True)
        entry = cat[key]
        meta['provenance'] = entry.get('source_search_url', entry['url'])
        entry.setdefault('source_search_url', entry['url'])
        entry.update({'title': title, 'url': meta['page_url'], 'image_id': eid})
        if meta.get('credit'):
            entry['credit'] = meta['credit']
        if key == 'macs0416':
            # 同步图鉴低清预览，避免新合成图署名指向旧Hubble-only预览。
            with Image.open(HD / 'macs0416.jpg') as im:
                preview = contain_square(im.convert('RGB'), 640)
            save_jpeg(preview, PUB / 'photo' / 'macs0416.jpg', 86)
            sync(PUB / 'photo' / 'macs0416.jpg')
        meta['source_note'] = ('原有来源搜索页核实的同目标Hubble/Webb新版，不等同旧cos图源'
                               if key == 'macs0416' else '原有目录来源、JPEG注释或搜索页核实')
        for value in photo_map.values():
            if value['photo'] == key:
                for field in ('title', 'url', 'credit'):
                    value[field] = entry[field]
    hd_map = {}
    for path in sorted(HD.glob('*.jpg')):
        key = path.stem
        with Image.open(path) as original:
            original.load()
            if max(original.size) > 2048:
                raise ValueError(f'HD尺寸不符：{path}')
            square = contain_square(original.convert('RGB'))
            save_jpeg(square, PHD / path.name, 82)
            meta = sources.setdefault(key, previous.get(key, {}))
            meta['hd_size'] = list(original.size)
        hd_map[key] = path.name
        meta.update({'hd_file': 'hd/' + path.name, 'photo_hd_file': 'photo-hd/' + path.name,
                     'photo_hd_size': [1024, 1024], 'hd_sha256': digest(path),
                     'photo_hd_sha256': digest(PHD / path.name)})
        sync(path)
        sync(PHD / path.name)
    if 'm42' in hd_map:
        with Image.open(HD / 'm42.jpg') as im:
            base = contain_square(im.convert('RGB'))
        processed = radial_fade(kill_pedestal(base))
        output = PUB / 'sky' / 'm42.jpg'
        save_jpeg(processed, output, 90)
        with Image.open(output) as check:
            a = np.asarray(check.convert('RGB'))
        edges = np.concatenate((a[0], a[-1], a[:, 0], a[:, -1]))
        if edges.max() != 0 or a.mean() < 5 or np.quantile(a, 0.99) < 50:
            raise ValueError('M42亮度或边界检查失败')
        sources['m42']['sky'] = {'file': 'sky/m42.jpg', 'sha256': digest(output),
                                 'size': [1024, 1024], 'mean_rgb': float(a.mean()),
                                 'p99_rgb': float(np.quantile(a, 0.99)),
                                 'edge_max': int(edges.max())}
        print('M42亮度', sources['m42']['sky'], flush=True)
        sync(output)
    for name, value in (('hd-map.json', hd_map), ('hd-sources.json', sources),
                        ('photo-catalog.json', cat), ('photo-map.json', photo_map)):
        write_json(PUB / name, value)
        sync(PUB / name)
    assert all(digest(HD / name) == value for name, value in before.items()), '已有HD被意外改写'
    assert set(hd_map) == {p.stem for p in PHD.glob('*.jpg')}, 'HD/photo-hd存在孤立文件'
    print('完成：下载图源', counts['下载'], '复用图源', counts['复用'],
          '成功键', len(sources), '失败键', len(failed), failed,
          '保留旧HD', len(before), '新增HD', len(hd_map) - len(before), flush=True)
    print('HD/photo-hd/清单', len(hd_map),
          '体积MiB', {folder.name: round(sum(p.stat().st_size for p in folder.glob('*.jpg')) / 1048576, 2)
                      for folder in (HD, PHD)}, flush=True)
    return 1 if failed else 0


if __name__ == '__main__':
    raise SystemExit(main())
