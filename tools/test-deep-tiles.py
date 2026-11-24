"""验收各目标所有层的核心拼回、每条gutter及角像素；同时测试预算与锁。
运行：python -B tools/test-deep-tiles.py [--source-dir PATH]
只读审计：python -B tools/test-deep-tiles.py --audit-only [--targets m51 m42 47tuc]
只读模式不运行写入/锁/服务测试，不更新validation.json；不代表联网、许可或视觉验收。
"""
import argparse
import hashlib
import importlib.util
import json
import sys
sys.dont_write_bytecode = True
from pathlib import Path
import tempfile
from unittest.mock import patch

from PIL import Image, ImageChops

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('deep_tiles', ROOT / 'tools/make-deep-tiles.py')
generator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(generator)


def require(condition, message):
    if not condition:
        raise ValueError(message)


def equal(first, second, message):
    require(first.size == second.size, message + ' 尺寸不一致')
    with ImageChops.difference(first, second) as difference:
        require(difference.getbbox() is None, message)


def verify_gutter(tile, level, x0, y0, tw, th):
    w, h = level.size
    for tx in (0, tw + 1):
        for ty in range(th + 2):
            expected = level.getpixel((min(w - 1, max(0, x0 + tx - 1)),
                                       min(h - 1, max(0, y0 + ty - 1))))
            require(tile.getpixel((tx, ty)) == expected, '左右gutter或角像素不匹配')
    for ty in (0, th + 1):
        for tx in range(1, tw + 1):
            expected = level.getpixel((min(w - 1, max(0, x0 + tx - 1)),
                                       min(h - 1, max(0, y0 + ty - 1))))
            require(tile.getpixel((tx, ty)) == expected, '上下gutter不匹配')


def verify_metadata(name, key, manifest, source, source_hash, byte_count, original_size):
    """只比较本地记录与文件事实；pageVerified不作为当前联网或授权证明。"""
    require(manifest['schema'] == 2, 'manifest schema不正确')
    require(manifest['target'] == name and manifest['sourceKey'] == key, '目标或sourceKey不匹配')
    require(manifest['tileSize'] == generator.TILE and manifest['border'] == generator.BORDER,
            '瓦片或边框配置不匹配')
    require(manifest['pipeline'] == generator.PIPELINE, '管线与当前生成器不匹配')
    provenance = manifest['provenance']
    require(provenance['sha256'] == source_hash, '来源hash不匹配')
    require(provenance['bytes'] == byte_count, '来源字节数不匹配')
    require(provenance['originalSize'] == list(original_size), '来源原始尺寸不匹配')
    fallback = source.resolve().parent == (ROOT / 'public/data/hd').resolve()
    require(provenance['fallbackHD'] is fallback, 'HD回退状态不匹配')
    try:
        local_file = source.resolve().relative_to((ROOT / 'public').resolve()).as_posix()
    except ValueError:
        local_file = source.name
    require(provenance['localFile'] == local_file, '来源本地路径不匹配')
    sidecar = source.with_suffix('.json')
    if sidecar.is_file():
        data = json.loads(sidecar.read_text(encoding='utf8'))
        require(data.get('sha256') == source_hash, '旁车源hash不匹配')
        if 'bytes' in data:
            require(data['bytes'] == byte_count, '旁车源字节数不匹配')
        require(data.get('originalSize') == list(original_size), '旁车原始尺寸不匹配')
        for field, value in data.items():
            require(provenance.get(field) == value, f'旁车与manifest来源字段不一致：{field}')
    else:
        data = {}
    expected = generator.provenance(source, key, source_hash, byte_count, original_size)
    require(provenance == expected, 'manifest来源与当前生成器来源记录不一致（含额外字段）')
    missing = [field for field in ('pageURL', 'downloadURL', 'credit') if not expected.get(field)]
    # 声明存在也不自动批准发布：本检查不访问原站、不作法律判断。
    license_fields = [field for field in ('license', 'licenseURL', 'usageTermsURL') if expected.get(field)]
    return {'sidecarPresent': sidecar.is_file(), 'localRecordsConsistent': True,
            'sidecarBytesDeclared': 'bytes' in data,
            'missingSourceFields': missing, 'licenseFieldsPresent': license_fields,
            'licenseStatus': 'declared-not-verified' if license_fields else 'unknown',
            'redistributionApproved': False, 'networkVerifiedThisRun': False}


def verify_target(name, key, source_dir):
    folder = ROOT / 'public/data/deep-tiles' / name
    manifest = json.loads((folder / 'manifest.json').read_text(encoding='utf8'))
    source = source_dir / (key + '.jpg')
    if not source.is_file():
        source = ROOT / 'public/data/hd' / (key + '.jpg')
    image, source_hash, source_bytes, original_size = generator.load_source(source)
    try:
        require(source_hash == manifest['sourceSHA256'], '源hash不匹配')
        metadata = verify_metadata(name, key, manifest, source, source_hash, source_bytes, original_size)
    except Exception:
        image.close()
        raise
    count = byte_count = 0
    try:
        version = hashlib.sha256((source_hash + json.dumps(generator.PIPELINE, sort_keys=True,
                                                          separators=(',', ':'))).encode()).hexdigest()[:24] + '-v2'
        require(manifest['version'] == version, '版本未绑定源及管线')
        require(manifest['preview'] == version + '/preview.jpg', '预览路径不正确')
        require(manifest['urlTemplate'] == version + '/{z}/{x}_{y}.png', '瓦片URL模板不正确')
        require(manifest['upscaled'] is False and manifest['representation'] == 'observed-2d-image', '表示声明不正确')
        require(image.size == (manifest['width'], manifest['height']), '源与manifest尺寸不一致')
        require(manifest['levels'] == generator.dimensions(*image.size), '层级不正确')
        for info in manifest['levels']:
            size = (info['width'], info['height'])
            level = image if size == image.size else image.resize(size, Image.Resampling.LANCZOS)
            restored = Image.new('RGB', size)
            try:
                for x in range(info['cols']):
                    for y in range(info['rows']):
                        x0, y0 = x * 512, y * 512
                        tw, th = min(512, size[0] - x0), min(512, size[1] - y0)
                        path = folder / version / str(info['z']) / f'{x}_{y}.png'
                        with Image.open(path) as tile:
                            tile.load()
                            require(tile.format == 'PNG' and tile.mode == 'RGB', '瓦片编码或色彩模式不正确')
                            require(tile.size == (tw + 2, th + 2), '瓦片尺寸不正确')
                            verify_gutter(tile, level, x0, y0, tw, th)
                            with tile.crop((1, 1, tw + 1, th + 1)) as core:
                                restored.paste(core, (x0, y0))
                        count += 1
                        byte_count += path.stat().st_size
                equal(restored, level, f'{name} 第{info["z"]}层核心拼回不一致')
            finally:
                restored.close()
                if level is not image:
                    level.close()
        preview = image.copy()
        try:
            preview.thumbnail((512, 512), Image.Resampling.LANCZOS)
            preview_path = folder / manifest['preview']
            require(preview_path.read_bytes() == generator.encoded(preview, 'JPEG', quality=90, subsampling=0),
                    '预览不是同源同管线')
            require(list(preview.size) == manifest['previewSize'], '预览尺寸错误')
            require(preview_path.stat().st_size == manifest['previewBytes'], '预览字节数不匹配')
        finally:
            preview.close()
        require(count == manifest['tileCount'] and byte_count == manifest['tileBytes'], '统计不一致')
        result = {'target': name, 'sourceSize': list(image.size), 'sourceBytes': source.stat().st_size,
                  'sourceSHA256': source_hash, 'levels': len(manifest['levels']), 'tileCount': count,
                  'tileBytes': byte_count, 'previewBytes': manifest['previewBytes'],
                  'coreReconstruction': 'all-levels-exact', 'gutter': 'all-edges-and-corners-exact',
                  'sameSourcePreview': True, 'fallbackHD': manifest['provenance']['fallbackHD'],
                  'provenanceAudit': metadata}
        print(json.dumps(result, ensure_ascii=False), flush=True)
        return result
    finally:
        image.close()


def verify_guards():
    for size in ((0, 10), (32769, 1), (8001, 8000)):
        try:
            generator.dimensions(*size)
        except ValueError:
            pass
        else:
            raise ValueError(f'预算未拒绝 {size}')
    # 临时验收资产只落在允许的deep-tiles树内，离开作用域自动清理。
    output = ROOT / 'public/data/deep-tiles'
    with tempfile.TemporaryDirectory(prefix='.acceptance-', dir=output) as temporary:
        path = Path(temporary)
        with generator.build_lock(path):
            try:
                with generator.build_lock(path):
                    raise ValueError('互斥锁未拒绝并发生成')
            except RuntimeError:
                pass
        require(not (path / '.build.lock').exists(), '生成锁未释放')
        generator.atomic(path / 'atomic.bin', b'first')
        generator.atomic(path / 'atomic.bin', b'second')
        require((path / 'atomic.bin').read_bytes() == b'second', '原子替换失败')
        require(not list(path.glob('*.tmp')), '临时文件未清理')
        corrupt = path / 'corrupt.jpg'
        corrupt.write_bytes(b'not an image')
        try:
            generator.load_source(corrupt)
        except OSError:
            pass
        else:
            raise ValueError('未拒绝损坏输入')
        # 模拟超大stat，确认在读取文件前就拒绝。
        with patch.object(Path, 'stat') as stat:
            stat.return_value.st_size = generator.MAX_BYTES + 1
            try:
                generator.load_source(corrupt)
            except ValueError:
                pass
            else:
                raise ValueError('未拒绝超大输入')
    for size in ((1, 1), (513, 517), (1024, 1025)):
        image = Image.new('RGB', size)
        image.putdata([((x * 13) % 256, (y * 17) % 256, (x + y * 3) % 256)
                       for y in range(size[1]) for x in range(size[0])])
        try:
            for x0 in range(0, size[0], 512):
                for y0 in range(0, size[1], 512):
                    tw, th = min(512, size[0] - x0), min(512, size[1] - y0)
                    with generator.tile_with_gutter(image, x0, y0, tw, th) as tile:
                        verify_gutter(tile, image, x0, y0, tw, th)
        finally:
            image.close()
    print('预算、互斥、原子写入、损坏输入、1像素及非整除gutter测试通过', flush=True)


def verify_service_and_fallback():
    import sys
    server_spec = importlib.util.spec_from_file_location('deep_server', ROOT / 'tools/serve-deep-detail.py')
    server = importlib.util.module_from_spec(server_spec)
    server_spec.loader.exec_module(server)
    with patch.object(sys, 'argv', ['serve-deep-detail.py']), \
            patch.object(server, 'ThreadingHTTPServer') as http, \
            patch.object(server.subprocess, 'run') as run, \
            patch.object(server.webbrowser, 'open') as browser:
        server.main()
        require(http.call_args.args[0] == ('127.0.0.1', 8169), '服务未绑定回环地址')
        require(not run.called and not browser.called, '默认启动不应构建或打开GUI')
    with patch.object(sys, 'argv', ['serve-deep-detail.py', '--build', '--source-dir', 'custom', '--open-browser']), \
            patch.object(server, 'ThreadingHTTPServer'), \
            patch.object(server.subprocess, 'run') as run, \
            patch.object(server.webbrowser, 'open') as browser:
        server.main()
        require(run.call_args.args[0][-2:] == ['--source-dir', 'custom'], '服务未转发source-dir')
        require(browser.call_count == 1, '显式打开浏览器开关失效')
    with tempfile.TemporaryDirectory(prefix='.mixed-source-', dir=ROOT / 'public/data/deep-tiles') as temporary:
        mixed = Path(temporary)
        (mixed / 'm42.jpg').write_bytes(b'path-selection-only')
        (mixed / 'euclid_ngc1291.jpg').write_bytes(b'path-selection-only')
        with patch.object(sys, 'argv', ['make-deep-tiles.py', '--source-dir', str(mixed)]), \
                patch.object(generator, 'build') as build:
            generator.main()
            selected = {call.args[0]: call.args[2] for call in build.call_args_list}
            require(selected['m42'] == mixed / 'm42.jpg', '未选择提供的高源')
            require(selected['m51'].parent == ROOT / 'public/data/hd', '混合源未逐个回退HD')
            require(selected['47tuc'].parent == ROOT / 'public/data/hd', '混合源未逐个回退HD')
    print('服务默认不构建/不打开GUI、回环绑定、显式开关、混合源回退测试通过；未启动真实服务', flush=True)


def verify_audit_guards():
    """内存故障注入与分支测试；不创建临时文件，不改动实际资产。"""
    import copy
    import sys
    source = ROOT / 'public/data/deep-source/audit-fixture.jpg'
    digest = 'a' * 64
    data = {'sha256': digest, 'bytes': 10, 'originalSize': [2, 3],
            'pageURL': 'https://example.invalid/image',
            'downloadURL': 'https://example.invalid/image.jpg', 'credit': 'fixture'}
    provenance = {**data, 'localFile': 'data/deep-source/audit-fixture.jpg', 'fallbackHD': False}
    manifest = {'schema': 2, 'target': 'fixture', 'sourceKey': 'audit-fixture',
                'tileSize': 512, 'border': 1, 'pipeline': generator.PIPELINE,
                'provenance': provenance}
    count = 0
    with patch.object(Path, 'is_file', return_value=True), \
            patch.object(Path, 'read_text', return_value=json.dumps(data)):
        result = verify_metadata('fixture', 'audit-fixture', manifest, source, digest, 10, (2, 3))
        require(result['licenseStatus'] == 'unknown' and not result['redistributionApproved'],
                '无许可字段不能当作授权通过')
        count += 1
        for field, value in (('target', 'wrong'), ('sourceKey', 'wrong'), ('schema', 1),
                             ('tileSize', 256), ('border', 0), ('pipeline', {})):
            bad = copy.deepcopy(manifest)
            bad[field] = value
            try:
                verify_metadata('fixture', 'audit-fixture', bad, source, digest, 10, (2, 3))
            except ValueError:
                count += 1
            else:
                raise ValueError(f'未拒绝manifest字段错误：{field}')
        for field, value in (('sha256', 'b' * 64), ('bytes', 11), ('originalSize', [3, 2]),
                             ('localFile', '../escape.jpg'), ('fallbackHD', True),
                             ('credit', 'wrong'), ('pageURL', 'https://example.invalid/wrong')):
            bad = copy.deepcopy(manifest)
            bad['provenance'][field] = value
            try:
                verify_metadata('fixture', 'audit-fixture', bad, source, digest, 10, (2, 3))
            except ValueError:
                count += 1
            else:
                raise ValueError(f'未拒绝来源字段错误：{field}')
        for field, value in (('sha256', 'b' * 64), ('bytes', 11), ('originalSize', [3, 2])):
            bad = {**data, field: value}
            with patch.object(Path, 'read_text', return_value=json.dumps(bad)):
                try:
                    verify_metadata('fixture', 'audit-fixture', manifest, source, digest, 10, (2, 3))
                except ValueError:
                    count += 1
                else:
                    raise ValueError(f'未拒绝旁车字段错误：{field}')
        without_bytes = {key: value for key, value in data.items() if key != 'bytes'}
        with patch.object(Path, 'read_text', return_value=json.dumps(without_bytes)):
            result = verify_metadata('fixture', 'audit-fixture', manifest, source, digest, 10, (2, 3))
            require(not result['sidecarBytesDeclared'], '旁车未记录bytes应报告缺口而非误报损坏')
            count += 1
        extra = copy.deepcopy(manifest)
        extra['provenance']['license'] = 'stale or untrusted addition'
        try:
            verify_metadata('fixture', 'audit-fixture', extra, source, digest, 10, (2, 3))
        except ValueError:
            count += 1
        else:
            raise ValueError('未拒绝manifest独有的来源声明')
        licensed = {**data, 'license': 'fixture declaration, not authorization'}
        declared = copy.deepcopy(manifest)
        declared['provenance'].update(licensed)
        with patch.object(Path, 'read_text', return_value=json.dumps(licensed)):
            result = verify_metadata('fixture', 'audit-fixture', declared, source, digest, 10, (2, 3))
            require(result['licenseStatus'] == 'declared-not-verified' and not result['redistributionApproved'],
                    '许可声明不能当作授权核实')
            count += 1
    with patch.object(Path, 'is_file', return_value=False):
        no_sidecar = copy.deepcopy(manifest)
        no_sidecar['provenance'] = {field: provenance[field] for field in
                                    ('sha256', 'bytes', 'originalSize', 'localFile', 'fallbackHD')}
        no_sidecar['provenance']['note'] = '用户提供的本地源；未提供可核实的下载来源及署名'
        result = verify_metadata('fixture', 'audit-fixture', no_sidecar, source, digest, 10, (2, 3))
        require(not result['sidecarPresent'] and len(result['missingSourceFields']) == 3,
                '缺少旁车时必须报告来源缺口')
        count += 1
    with patch.object(sys, 'argv', ['test-deep-tiles.py', '--audit-only', '--targets', 'm51']), \
            patch.object(generator, 'atomic', side_effect=AssertionError('只读模式发生写入')), \
            patch.object(sys.modules[__name__], 'verify_guards', side_effect=AssertionError('只读模式运行写入测试')), \
            patch.object(sys.modules[__name__], 'verify_service_and_fallback',
                         side_effect=AssertionError('只读模式运行服务测试')), \
            patch.object(sys.modules[__name__], 'verify_target', return_value={'target': 'm51'}) as verify:
        main()
        require(verify.call_count == 1 and verify.call_args.args[:2] == ('m51', 'esa_heic0506a'),
                '只读目标选择失效')
        count += 1
    print(f'只读审计内存回归 {count}/{count} 通过（不代表实际资产、许可或视觉验收）', flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-dir', type=Path, default=ROOT / 'public/data/deep-source')
    parser.add_argument('--targets', nargs='+', choices=list(generator.TARGETS),
                        default=list(generator.TARGETS))
    parser.add_argument('--audit-only', action='store_true', help='只读取本地资产，结果仅输出到终端')
    parser.add_argument('--audit-self-test', action='store_true', help='仅运行只读审计的内存故障注入测试')
    args = parser.parse_args()
    if args.audit_self_test:
        verify_audit_guards()
        return
    if not args.audit_only:
        require(args.targets == list(generator.TARGETS), '完整验收不支持目标子集，请使用--audit-only')
        verify_guards()
        verify_service_and_fallback()
    results = [verify_target(name, generator.TARGETS[name], args.source_dir) for name in args.targets]
    report = {'passed': True, 'scope': 'local-asset-integrity', 'readOnly': args.audit_only,
              'visualVerified': False, 'licenseVerified': False, 'targets': results}
    if args.audit_only:
        print(json.dumps({'summary': {key: value for key, value in report.items() if key != 'targets'},
                          'targetsChecked': len(results)}, ensure_ascii=False), flush=True)
    else:
        generator.atomic(ROOT / 'public/data/deep-tiles/validation.json',
                         json.dumps(report, ensure_ascii=False, indent=2).encode())


if __name__ == '__main__':
    main()
