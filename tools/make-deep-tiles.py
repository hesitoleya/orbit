"""生成有明确预算的二维观测图像金字塔，不下载、不放大。
默认优先 public/data/deep-source，缺少的目标逐个回退到既有 HD。
可指定 --source-dir PATH；仅写 public/data/deep-tiles。
"""
import argparse
from contextlib import contextmanager
import hashlib
import io
import json
import math
import os
from pathlib import Path
import tempfile
import warnings

from PIL import Image, ImageOps, __version__ as PILLOW_VERSION

ROOT = Path(__file__).resolve().parents[1]
TARGETS = {'m51': 'esa_heic0506a', 'm42': 'm42', '47tuc': 'gc_heic1510a', 'ngc1291': 'euclid_ngc1291'}
TILE = 512
BORDER = 1
MAX_PIXELS = 64_000_000
MAX_BYTES = 128 * 1024 * 1024
MAX_DIMENSION = 32768
MAX_LEVELS = 7
MAX_TILES = 512
PIPELINE = {'version': 2, 'tile': TILE, 'border': BORDER,
            'orientation': 'exif-transpose', 'mode': 'RGB',
            'resample': 'LANCZOS', 'gutter': 'neighbor-clamped-including-corners',
            'pngOptimize': True, 'previewMaxDimension': 512,
            'previewQuality': 90, 'previewSubsampling': 0, 'pillow': PILLOW_VERSION}


def atomic(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix='.' + path.name + '-', suffix='.tmp', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


@contextmanager
def build_lock(output):
    output.mkdir(parents=True, exist_ok=True)
    path = output / '.build.lock'
    try:
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError as exc:
        raise RuntimeError(f'已有生成锁：{path}；请确认持有进程，不会自动删除锁') from exc
    try:
        with os.fdopen(fd, 'w') as stream:
            stream.write(str(os.getpid()))
        yield
    finally:
        path.unlink()


def dimensions(width, height):
    if min(width, height) < 1 or max(width, height) > MAX_DIMENSION:
        raise ValueError(f'边长必须为 1..{MAX_DIMENSION}，实际 {width}x{height}')
    if width * height > MAX_PIXELS:
        raise ValueError('源图超过 64 MP 预算')
    top = max(0, (max(width, height) - 1).bit_length() - 9)
    levels = []
    for z in range(top + 1):
        divisor = 2 ** (top - z)
        w, h = math.ceil(width / divisor), math.ceil(height / divisor)
        levels.append({'z': z, 'width': w, 'height': h,
                       'cols': math.ceil(w / TILE), 'rows': math.ceil(h / TILE)})
    if len(levels) > MAX_LEVELS or sum(l['cols'] * l['rows'] for l in levels) > MAX_TILES:
        raise ValueError('金字塔超过层数或瓦片数量预算')
    return levels


def load_source(source):
    size = source.stat().st_size
    if not 0 < size <= MAX_BYTES:
        raise ValueError('源文件必须非空且不超过 128 MiB')
    digest = hashlib.sha256()
    total = 0
    with source.open('rb') as stream:
        while chunk := stream.read(1024 * 1024):
            total += len(chunk)
            if total > MAX_BYTES:
                raise ValueError('读取期间源文件超过 128 MiB')
            digest.update(chunk)
        if total != size:
            raise ValueError('读取期间源文件大小发生变化')
        stream.seek(0)
        with warnings.catch_warnings():
            warnings.simplefilter('error', Image.DecompressionBombWarning)
            with Image.open(stream) as src:
                dimensions(*src.size)
                original_size = src.size
                src.verify()
        stream.seek(0)
        with Image.open(stream) as src:
            src.load()
            oriented = ImageOps.exif_transpose(src)
            try:
                image = oriented.convert('RGB')
            finally:
                oriented.close()
    return image, digest.hexdigest(), size, original_size


def provenance(source, key, source_hash, byte_count, original_size):
    sidecar = source.with_suffix('.json')
    if sidecar.is_file():
        data = json.loads(sidecar.read_text(encoding='utf8'))
        if data.get('sha256') != source_hash or data.get('originalSize') != list(original_size):
            raise ValueError(f'来源记录与文件不一致：{sidecar}')
    else:
        data = {}
        hd_sources = ROOT / 'public/data/hd-sources.json'
        if source.resolve().parent == (ROOT / 'public/data/hd').resolve() and hd_sources.is_file():
            historical = json.loads(hd_sources.read_text(encoding='utf8')).get(key, {})
            data = {'pageURL': historical.get('page_url'),
                    'credit': historical.get('credit', ''),
                    'historicalDownloadURL': historical.get('download_url'),
                    'note': '既有HD兜底；当前hash和尺寸仅指本地HD，非历史下载原件'}
        else:
            data = {'note': '用户提供的本地源；未提供可核实的下载来源及署名'}
    try:
        local_file = source.resolve().relative_to((ROOT / 'public').resolve()).as_posix()
    except ValueError:
        local_file = source.name
    return {**data, 'localFile': local_file, 'sha256': source_hash,
            'bytes': byte_count, 'originalSize': list(original_size),
            'fallbackHD': source.resolve().parent == (ROOT / 'public/data/hd').resolve()}


def tile_with_gutter(level, x0, y0, width, height):
    lw, lh = level.size
    left, top = max(0, x0 - 1), max(0, y0 - 1)
    right, bottom = min(lw, x0 + width + 1), min(lh, y0 + height + 1)
    crop = level.crop((left, top, right, bottom))
    padding = (int(x0 == 0), int(y0 == 0),
               int(x0 + width == lw), int(y0 + height == lh))
    if not any(padding):
        return crop
    tile = ImageOps.expand(crop, border=padding)
    crop.close()
    w, h = tile.size
    l, t, r, b = padding
    # 先复制四边，再显式复制四角；内部边界保留相邻像素。
    if l:
        with tile.crop((l, t, l + 1, h - b)) as edge:
            tile.paste(edge, (0, t))
    if r:
        with tile.crop((w - r - 1, t, w - r, h - b)) as edge:
            tile.paste(edge, (w - 1, t))
    if t:
        with tile.crop((0, t, w, t + 1)) as edge:
            tile.paste(edge, (0, 0))
    if b:
        with tile.crop((0, h - b - 1, w, h - b)) as edge:
            tile.paste(edge, (0, h - 1))
    for x, y in ((0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)):
        tile.putpixel((x, y), level.getpixel((min(lw - 1, max(0, x0 + x - 1)),
                                            min(lh - 1, max(0, y0 + y - 1)))))
    return tile


def encoded(image, format_name, **options):
    with io.BytesIO() as buffer:
        image.save(buffer, format_name, **options)
        data = buffer.getvalue()
    # 校验发生在任何最终文件写入之前，且不依赖可被 -O 禁用的 assert。
    with Image.open(io.BytesIO(data)) as check:
        check.load()
        if check.size != image.size or check.mode != 'RGB' or check.format != format_name:
            raise ValueError('编码后解码校验失败')
    return data


def build(name, key, source, output):
    image, source_hash, byte_count, original_size = load_source(source)
    try:
        w, h = image.size
        levels = dimensions(w, h)
        source_info = provenance(source, key, source_hash, byte_count, original_size)
        content = source_hash + json.dumps(PIPELINE, sort_keys=True, separators=(',', ':'))
        version = hashlib.sha256(content.encode()).hexdigest()[:24] + '-v2'
        dest = output / name
        count = tile_bytes = 0
        preview = image.copy()
        try:
            preview.thumbnail((512, 512), Image.Resampling.LANCZOS)
            preview_data = encoded(preview, 'JPEG', quality=90, subsampling=0)
            preview_size = list(preview.size)
        finally:
            preview.close()
        atomic(dest / version / 'preview.jpg', preview_data)
        for info in levels:
            lw, lh = info['width'], info['height']
            level = image if (lw, lh) == image.size else image.resize((lw, lh), Image.Resampling.LANCZOS)
            try:
                for x in range(info['cols']):
                    for y in range(info['rows']):
                        x0, y0 = x * TILE, y * TILE
                        tw, th = min(TILE, lw - x0), min(TILE, lh - y0)
                        with tile_with_gutter(level, x0, y0, tw, th) as tile:
                            if tile.size != (tw + 2, th + 2):
                                raise ValueError('瓦片尺寸不符合核心与gutter约束')
                            data = encoded(tile, 'PNG', optimize=True)
                        atomic(dest / version / str(info['z']) / f'{x}_{y}.png', data)
                        count += 1
                        tile_bytes += len(data)
            finally:
                if level is not image:
                    level.close()
        manifest = {'schema': 2, 'target': name, 'sourceKey': key,
                    'width': w, 'height': h, 'sourceSHA256': source_hash,
                    'tileSize': TILE, 'border': BORDER, 'levels': levels,
                    'version': version, 'pipeline': PIPELINE,
                    'urlTemplate': f'{version}/{{z}}/{{x}}_{{y}}.png',
                    'preview': f'{version}/preview.jpg', 'previewSize': preview_size,
                    'provenance': source_info, 'tileCount': count,
                    'tileBytes': tile_bytes, 'previewBytes': len(preview_data),
                    'representation': 'observed-2d-image', 'upscaled': False}
        atomic(dest / 'manifest.json', json.dumps(manifest, ensure_ascii=False, indent=2).encode())
        print(f'{name}: {w}x{h}, {len(levels)} 层, {count} 块, {tile_bytes} PNG字节, '
              f'源 {byte_count} 字节, fallbackHD={source_info["fallbackHD"]}', flush=True)
        return manifest
    finally:
        image.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-dir', type=Path, default=ROOT / 'public/data/deep-source')
    args = parser.parse_args()
    inputs = []
    for name, key in TARGETS.items():
        path = args.source_dir / (key + '.jpg')
        if not path.is_file():
            path = ROOT / 'public/data/hd' / (key + '.jpg')
        if not path.is_file():
            raise FileNotFoundError(path)
        inputs.append((name, key, path))
    output = ROOT / 'public/data/deep-tiles'
    with build_lock(output):
        for name, key, path in inputs:
            build(name, key, path, output)


if __name__ == '__main__':
    main()
