"""仅在本机提供实验性深空瓦片查看页面。
默认只服务；--build 显式生成瓦片，--open-browser 显式打开浏览器。
仅绑定 127.0.0.1，不发布、不改主应用或构建产物。
"""
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import subprocess
import sys
import webbrowser

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=8169)
    parser.add_argument('--build', action='store_true', help='服务前显式生成瓦片')
    parser.add_argument('--source-dir', type=Path, default=ROOT / 'public/data/deep-source')
    parser.add_argument('--open-browser', action='store_true', help='显式打开浏览器')
    args = parser.parse_args()
    if not 1024 <= args.port <= 65535:
        parser.error('端口必须为 1024..65535')
    if args.build:
        subprocess.run([sys.executable, str(ROOT / 'tools/make-deep-tiles.py'),
                        '--source-dir', str(args.source_dir)], check=True)
    handler = partial(SimpleHTTPRequestHandler, directory=str(ROOT / 'public'))
    with ThreadingHTTPServer(('127.0.0.1', args.port), handler) as server:
        url = f'http://127.0.0.1:{args.port}/deep-detail.html'
        print('仅本机预览：', url, flush=True)
        print('Ctrl+C 停止服务；浏览器视觉效果尚需单独验收。', flush=True)
        if args.open_browser:
            webbrowser.open(url)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            print('\n服务已停止。')


if __name__ == '__main__':
    main()
