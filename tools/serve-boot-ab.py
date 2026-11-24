"""仅本机的 Orbit 启动对照；py -3 tools/serve-boot-ab.py。"""
import hashlib
import json
import math
import mimetypes
import mmap
import os
import re
import secrets
import shutil
import sys
import threading
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / 'public'
# Dedicated port isolates the exact pre-split comparison from the historical A/B server.
PRE_SPLIT = '--pre-atlas-split' in sys.argv[1:]
CINEMATIC = '--pre-cinematic-split' in sys.argv[1:]
M16_BLEND = '--m16-blend' in sys.argv[1:]
if sum((PRE_SPLIT, CINEMATIC, M16_BLEND)) > 1:
    raise SystemExit('对照模式不能同时使用')
HOST, PORT = '127.0.0.1', int(os.environ.get('ORBIT_AB_PORT', 18768 if M16_BLEND else 18767 if CINEMATIC else 18765 if PRE_SPLIT else 18764))
AUTHORITY = f'{HOST}:{PORT}'
ORIGIN = 'http://' + AUTHORITY
PAGES = {'a': ROOT / ('nonprod-pre-cinematic-split.html' if CINEMATIC else 'nonprod-pre-atlas-split.html' if PRE_SPLIT else 'nonprod-controlled-legacy-boot.html'), 'b': ROOT / 'space.html'}
if M16_BLEND:
    PAGES['a'] = ROOT / 'nonprod-pre-m16-blend.html'
BLOCK = 256 * 1024
STAGES = {'page-ready', 'engine-start', 'earth-start', 'earth-ready', 'interactive', 'frame-timeout', 'failed', 'surface-error', 'earth-fallback'}
ROWS = deque(maxlen=8192)
LOCK = threading.Lock()

PROBE = b'''<script>(()=>{
'use strict';
const arm=location.pathname.slice(1), run=crypto.randomUUID(), now=()=>performance.now();
const send=row=>fetch('/sample',{method:'POST',mode:'same-origin',credentials:'omit',redirect:'error',referrerPolicy:'no-referrer',keepalive:true,headers:{'Content-Type':'application/json'},body:JSON.stringify({arm,run,...row})}).catch(()=>{});
if(navigator.serviceWorker?.controller){send({kind:'invalid',reason:'sw-controlled'});return;}
const marks=new Set('page-ready engine-start earth-start earth-ready interactive frame-timeout failed surface-error earth-fallback'.split(' '));
new PerformanceObserver(list=>{for(const e of list.getEntries()){
  if(e.name.startsWith('orbit:') && marks.delete(e.name.slice(6)))send({kind:'boot',stage:e.name.slice(6),navMs:e.startTime});
}}).observe({type:'mark',buffered:true});
const camera=()=>{const c=window.__SE?.cam;return c?[c.yaw,c.pitch,c.dir.x,c.dir.y,c.dir.z]:null;};
let pointer=null,count=0;const pending=new WeakMap();
for(const type of ['pointerdown','pointermove']){
  window.addEventListener(type,e=>{
    if(!e.isTrusted || count>=48 || !e.target.matches?.('#stage > canvas') || (window.__SE && e.target!==window.__SE.renderer.domElement))return;
    if(type==='pointerdown')pointer=e.pointerId;
    else if(pointer!==e.pointerId || !e.buttons)return;
    const row={kind:'manual',event:type,seq:++count,navMs:now(),before:camera(),after:null};
    pending.set(e,row);
    requestAnimationFrame(()=>{row.rafNavMs=now();row.raf=camera();send(row);});
  },{capture:true,passive:true});
  window.addEventListener(type,e=>{const row=pending.get(e);if(row)row.after=camera();},{passive:true});
}
for(const type of ['pointerup','pointercancel','lostpointercapture'])window.addEventListener(type,e=>{if(e.isTrusted&&pointer===e.pointerId)pointer=null;},{capture:true,passive:true});
})();</script>'''


# 只拼入本机 cinematic 对照的响应，复用原探针的 run、时钟和发送通道。
CINE_TEST = r'''
const route='ui-m16', type=9;
let start=null, first=null, firstSize=0, interactive=null, finished=false, timer, undo=()=>{};
const limit=60000;
function record(stage,t,layer='none',w=0,h=0,d=0){
  send({kind:'nebula',route,stage,layer,w,h,d,navMs:t,startMs:start,
    sinceStartMs:start===null?null:t-start,afterFirstMs:first===null?null:t-first});
}
function finish(stage,end=now()){
  if(finished)return; finished=true; clearTimeout(timer); undo();
  if(stage!=='complete')record(stage,end); // final-256 本身就是完成记录。
  const tag=document.createElement('output');
  tag.style.cssText='position:fixed;top:6px;left:6px;z-index:2147483647;background:#111;color:white;padding:8px;pointer-events:none';
  tag.textContent=`${arm.toUpperCase()} M16 / ${stage} | 首绘 ${first===null?'--':`${firstSize}³ ${(first-start).toFixed(1)} ms`}${stage==='complete'?` | 256³ ${(end-start).toFixed(1)} ms`:''} | /results/${run}`;
  document.body?.append(tag);
}
// 只在候选里程碑读回当前程序和密度 sampler；辅助纹理不是 LOD 的判据。
function densityDraw(r,tex){
  const gl=r.getContext(),p=gl.getParameter(gl.CURRENT_PROGRAM);
  if(!p||gl.isContextLost())return false;
  const uniform=name=>{const loc=gl.getUniformLocation(p,name);return loc===null?null:gl.getUniform(p,loc);};
  const slot=uniform('uCineDensity'),handle=r.properties.get(tex).__webglTexture;
  if(!handle||!Number.isInteger(slot)||uniform('uType')!==type||uniform('uDepthEnabled')!==1||uniform('uCineEnabled')!==1)return false;
  const active=gl.getParameter(gl.ACTIVE_TEXTURE);
  try{gl.activeTexture(gl.TEXTURE0+slot);return gl.getParameter(gl.TEXTURE_BINDING_3D)===handle;}
  finally{gl.activeTexture(active);}
}
function select(){
  if(finished)return;
  const se=window.__SE, idx=window.__NEB?.findIndex(n=>n.shape===3 && /\bM16\b/i.test(n.n));
  if(document.hidden||!se?.enterNebula||!(idx>=0)||!se.EARTH||se.cam.focus!==se.EARTH)return finish('not-triggered');
  start=now();
  let body;
  try{body=se.enterNebula(idx);}catch(_){return finish('selection-error');}
  record('start',start);
  const n=se.neb, mesh=n.mainVolume, r=se.renderer;
  if(!body||body!==n.body||n.active!==idx||se.cam.focus!==body||mesh?.material.uniforms.uType.value!==type)return finish('selection-error');
  if(!r.capabilities.isWebGL2||n.imageField?.object?.parent)return finish('unsupported');
  const original=r.renderBufferDirect;
  r.renderBufferDirect=function(camera,scene,geometry,m,o,group){
    if(o!==mesh||n.mainVolume!==mesh||n.body!==body||se.cam.focus!==body||scene!==se.scene||camera!==se.camera||
       scene.overrideMaterial||m!==mesh.material||!m.colorWrite||!mesh.visible)return original.apply(this,arguments);
    const before=r.info.render.calls, out=original.apply(this,arguments);
    try{
      const u=m.uniforms,tex=u.uCineDensity.value;
      if(r.info.render.calls<=before||u.uDepthEnabled.value!==1||u.uCineEnabled.value!==1||
         u.uType.value!==type||u.uCineSteps.value!==320||!tex?.isData3DTexture)return out;
      const {width:w,height:h,depth:d}=tex.image;
      if(w<=1||w!==h||w!==d||(first!==null&&w!==256))return out;
      const a=window.ORBIT_CINEMATIC_ASSETS?.get(type), t=now();
      if(a?.type!==type||a.id!=='pillars'||a.density!==tex||!densityDraw(r,tex))return out;
      if(first===null){first=t;firstSize=w;record('first-texture',t,'pillars-density',w,h,d);}
      if(w===256){record('final-256',t,'pillars-density',w,h,d);finish('complete',t);}
    }catch(_){finish('probe-error');}
    return out;
  };
  undo=()=>{r.renderBufferDirect=original;};
  timer=setTimeout(()=>finish(first===null?'timeout':'no-final-256'),Math.max(0,start+limit-now()));
}
record('waiting',now());
timer=setTimeout(()=>finish('not-triggered'),180000);
addEventListener('pagehide',()=>finish(start===null?'not-triggered':'interrupted'),{once:true});
document.addEventListener('visibilitychange',()=>{if(document.hidden)finish(start===null?'not-triggered':'interrupted');});
new PerformanceObserver(list=>{for(const e of list.getEntries()){
  if(finished)break;
  if(e.name==='orbit:frame-timeout')finish('not-triggered');
  if(e.name==='orbit:interactive'&&interactive===null){interactive=e.startTime;clearTimeout(timer);
    timer=setTimeout(select,Math.max(0,interactive+1000-now()));}
}}).observe({type:'mark',buffered:true});
'''.encode()
if CINEMATIC:
    PROBE = PROBE.replace(b'})();</script>', CINE_TEST + b'\n})();</script>')


# 只改本机 HTTP 响应；按文件偏移拼入两个钩子，不复制整个数百 MB 的入口。
BLEND_HOOKS = [(b'\n  frameId++;', b'window.__m16probe?.begin(frameId,now);'),
               (b'\n  renderFrame();', b'window.__m16probe?.pixels(frameId);')]
BLEND_RUNS = deque(maxlen=12)
if M16_BLEND:
    PROBE = b'<script>' + Path(__file__).with_name('m16-blend-probe.js').read_bytes() + b'</script>'


def blend_offsets(f):
    points = []
    with mmap.mmap(f.fileno(), 0, access=mmap.ACCESS_READ) as data:
        for needle, hook in BLEND_HOOKS:
            i = data.find(needle)
            if i < 0 or data.find(needle, i + 1) >= 0:
                raise ValueError('M16 主循环插桩点不存在或不唯一')
            points.append((i + len(needle), hook))
    if points[0][0] >= points[1][0]:
        raise ValueError('M16 主循环插桩点顺序异常')
    return points


def loader(f):
    prefix = f.read(BLOCK)
    m = re.search(rb"<script>\r?\n\(function \(\) \{\r?\n  const loader = document\.getElementById\('loader'\)", prefix)
    if not m or b'<html lang="zh-CN">' not in prefix:
        raise ValueError('入口语言或 loader 不符合预期')
    end = prefix.index(b'</script>', m.end()) + 9
    return m.start(), prefix[m.start():end]


def check_sources():
    scripts = []
    for path in PAGES.values():
        with path.open('rb') as f:
            scripts.append(loader(f)[1])
    if scripts[0] != scripts[1]:
        raise ValueError('两端原 loader 不同，拒绝启动')
    return scripts[0]


PAGE_QUERY = 'tour=0&lang=zh-CN' + ('&q=high&cineVolume=1' if CINEMATIC else '')


if M16_BLEND:
    PAGE_QUERY += '&q=high&auto=0&cineVolume=1&lat=0&lon=0&alt=12500000&pitch=-1.44&yaw=0&t=0'


def target(arm, camera='fixed'):
    pose = f'&camera={camera}' if M16_BLEND else ''
    return f'/{arm}?{PAGE_QUERY}{pose}&ab={arm}-{secrets.token_hex(4)}'


RUN_ID = r'[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}'


def valid(row):
    def number(x):
        return type(x) in (float, int) and abs(x) <= 1e12 and math.isfinite(x)

    def snap(x):
        return x is None or (type(x) is list and len(x) == 5 and all(map(number, x)))

    if type(row) is not dict or row.get('arm') not in ('a', 'b') or not re.fullmatch(r'[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}', str(row.get('run'))):
        return False
    keys = row.keys() - {'arm', 'run', 'kind'}
    if row.get('kind') == 'invalid':
        return keys == {'reason'} and row['reason'] == 'sw-controlled'
    if not number(row.get('navMs')) or row['navMs'] < 0:
        return False
    if CINEMATIC and row.get('kind') == 'nebula':
        if keys != {'route','stage','layer','w','h','d','navMs','startMs','sinceStartMs','afterFirstMs'}:
            return False
        route, stage, layer = (row[k] for k in ('route','stage','layer'))
        if route != 'ui-m16' or any(type(row[k]) is not int or not 0 <= row[k] <= 256 for k in ('w','h','d')):
            return False
        start, delta, gap = (row[k] for k in ('startMs','sinceStartMs','afterFirstMs'))
        if start is None:
            if delta is not None or gap is not None or stage not in ('waiting','not-triggered','selection-error'): return False
        elif not (number(start) and number(delta) and 0 <= start <= row['navMs'] and delta == row['navMs']-start): return False
        if gap is not None and not (number(gap) and 0 <= gap <= delta): return False
        if stage in ('first-texture','final-256'):
            return (layer == 'pillars-density' and gap is not None and 1 < row['w'] == row['h'] == row['d'] and
                    (gap == 0 if stage == 'first-texture' else row['w'] == 256))
        return layer == 'none' and not any(row[k] for k in ('w','h','d')) and stage in (
            'waiting','start','not-triggered','timeout','selection-error','interrupted','probe-error','unsupported','no-final-256')
    if row.get('kind') == 'boot':
        return keys == {'stage', 'navMs'} and type(row['stage']) is str and row['stage'] in STAGES
    return (row.get('kind') == 'manual' and keys == {'event','seq','navMs','before','after','rafNavMs','raf'}
            and row['event'] in ('pointerdown','pointermove') and type(row['seq']) is int and 1 <= row['seq'] <= 48
            and number(row['rafNavMs']) and row['rafNavMs'] >= row['navMs'] and all(snap(row[k]) for k in ('before','after','raf')))


def cine_runs(rows):
    runs = {}
    for row in rows:
        run = runs.setdefault(row['run'], dict(run=row['run'], arm=row['arm'], route=None, earthInteractiveMs=None,
            selectionStartMs=None, firstTextureMs=None, dimensions=None, final256Ms=None,
            firstToFinalMs=None, quality='high', status='incomplete'))
        if row['kind'] == 'invalid': run['status'] = row['reason']
        if row['kind'] == 'boot' and row['stage'] == 'interactive': run['earthInteractiveMs'] = row['navMs']
        if row['kind'] != 'nebula': continue
        stage = row['stage']; run['route'] = row['route']
        if row['startMs'] is not None: run['selectionStartMs'] = row['startMs']
        if stage == 'first-texture':
            run.update(firstTextureMs=row['sinceStartMs'], dimensions=[row['w'],row['h'],row['d']])
        elif stage == 'final-256':
            run.update(final256Ms=row['sinceStartMs'], firstToFinalMs=row['afterFirstMs'], status='complete')
        elif stage not in ('waiting','start'): run['status'] = stage
    return list(runs.values())


class Handler(BaseHTTPRequestHandler):
    timeout = 12

    def log_message(self, *_):
        pass  # 不记录 IP、请求路径、请求头或请求正文。

    def headers_for(self, code, mime, size, **headers):
        self.send_response(code)
        for key, value in {'Content-Type': mime, 'Content-Length': str(size), 'Cache-Control':'no-store',
                'Content-Language':'zh-CN','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff',
                'Cross-Origin-Resource-Policy':'same-origin',
                'Content-Security-Policy':"default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:; style-src 'self' 'unsafe-inline'; worker-src blob:; connect-src 'self' data: blob:; frame-ancestors 'none'; form-action 'none'; base-uri 'none'", **headers}.items():
            self.send_header(key, value)
        self.end_headers()

    def reply(self, code, body=b'', mime='text/plain; charset=utf-8', **headers):
        self.headers_for(code, mime, len(body), **headers)
        if self.command != 'HEAD' and body:
            self.wfile.write(body)

    def local(self):
        if self.headers.get_all('Host') != [AUTHORITY] or self.headers.get('Origin', ORIGIN) != ORIGIN:
            self.reply(403)
            return False
        return True

    def do_POST(self):
        if not self.local(): return
        blend = M16_BLEND and self.path == '/m16-report'
        if not blend and (M16_BLEND or self.path != '/sample'): return self.reply(404)
        if self.headers.get_all('Origin') != [ORIGIN] or self.headers.get('Sec-Fetch-Site','same-origin') != 'same-origin': return self.reply(403)
        if self.headers.get_content_type() != 'application/json': return self.reply(415)
        length = self.headers.get('Content-Length','')
        cap = 2_000_000 if blend else 2048
        if self.headers.get('Transfer-Encoding') or not re.fullmatch('[0-9]{1,7}' if blend else '[0-9]{1,4}', length) or int(length) > cap: return self.reply(413)
        try:
            row = json.loads(self.rfile.read(int(length)))
            if blend:
                if not (type(row) is dict and row.get('arm') in ('a','b') and row.get('camera') in ('fixed','moving')
                        and re.fullmatch(RUN_ID, str(row.get('run'))) and isinstance(row.get('frames'), list)
                        and len(row['frames']) <= 3600 and isinstance(row.get('status'), str)):
                    return self.reply(400)
                body = json.dumps(row, allow_nan=False, separators=(',', ':')).encode()
                with LOCK: BLEND_RUNS.append((row['run'], body))
                return self.reply(204)
            if not valid(row): return self.reply(400)
        except (ValueError, RecursionError):
            return self.reply(400)
        with LOCK: ROWS.append(row)
        self.reply(204)

    def do_HEAD(self): self.do_GET()

    def do_GET(self):
        if not self.local(): return
        if not self.path.startswith('/') or self.headers.get('Service-Worker'): return self.reply(403)
        path, _, query = self.path.partition('?')
        if M16_BLEND and path == '/':
            links = ' · '.join(f'<a href="/{arm}?camera={cam}">{arm.upper()} / {cam}</a>'
                               for cam in ('fixed','moving') for arm in PAGES)
            page = f'<!doctype html><meta charset="utf-8"><title>M16 像素复测</title><h1>M16 · 地球启动后导航</h1>{links}<p>同一窗口逐次前台运行，勿拖动、缩放。结束后可下载真实帧胶片与 JSON。<a href="/results">最近 12 次终态报告</a></p>'
            return self.reply(200, page.encode(), 'text/html; charset=utf-8')
        if M16_BLEND and (path == '/results' or re.fullmatch('/results/' + RUN_ID, path)):
            with LOCK: reports = list(BLEND_RUNS)
            if path == '/results':
                body = b'[' + b','.join(data for _, data in reports) + b']'
            else:
                body = next((data for key, data in reversed(reports) if key == path[9:]), None)
                if body is None: return self.reply(404)
            return self.reply(200, body, 'application/json')
        if path == '/':
            if CINEMATIC:
                page = f'''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>M16 本机对照</title><h1>M16 · 真实体积首绘与最终 256³</h1>
<p><a href="/a">A：{PAGES['a'].name}</a> / <a href="/b">B：{PAGES['b'].name}</a>；两端固定精细画质。冷测每次使用新的浏览器用户目录，不用后退恢复页面。</p>
<p>左上角出现 complete 即可查看 /results/本次运行号，不必等超时。<a href="/results">本进程全部样本（毫秒）</a></p></html>'''
                return self.reply(200, page.encode(), 'text/html; charset=utf-8')
            page = f'''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>Orbit 启动对照</title><h1>Orbit 本机启动对照</h1>
<p>已核对相同 loader：<code>{hashlib.sha256(self.server.loader).hexdigest()}</code></p>
<p><a href="{target('a')}">打开 A · legacy</a>　<a href="{target('b')}">打开 B · space</a>　<a href="/results">查看采样 JSON</a></p>
<p>保持同一窗口原生尺寸，等首帧后在场景画布上按住并拖动。引导已关闭。启动只看 boot / interactive；frame-timeout 是超时放行，不算就绪。manual 的 navMs 包含人的等待。</p></html>'''
            return self.reply(200, page.encode(), 'text/html; charset=utf-8')
        single = CINEMATIC and re.fullmatch(r'/results/([0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12})', path)
        if path == '/results' or single:
            with LOCK: rows = [row for row in ROWS if not single or row['run'] == single[1]]
            if single and not rows: return self.reply(404)
            result = {'unit':'ms','clock':'navigation start','camera':['yaw','pitch','dir.x','dir.y','dir.z']}
            if CINEMATIC: result['runs'] = cine_runs(rows)
            result['samples'] = rows
            return self.reply(200,json.dumps(result,allow_nan=False).encode(),'application/json')
        arm = path[1:]
        is_page = arm in PAGES
        if is_page:
            pose = r'&camera=(?:fixed|moving)' if M16_BLEND else ''
            if not re.fullmatch(re.escape(PAGE_QUERY)+pose+'&ab='+arm+r'-[0-9a-f]{8}', query):
                return self.reply(302, Location=target(arm, 'moving' if query == 'camera=moving' else 'fixed'))
            asset = PAGES[arm]
        else:
            # 只映射公开产品资源，不映射工作目录、备份、个人 data 或测试报告。
            rel = path.removeprefix('/public/').lstrip('/') if path.startswith('/public/') else path[1:]
            if not re.fullmatch(r'(?:data|js)/(?:[A-Za-z0-9_-][A-Za-z0-9_.-]*/)*[A-Za-z0-9_-][A-Za-z0-9_.-]*\.(?:js|json|bin|gz|png|jpg|jpeg|webp|mp4|tif|ktx2)|manifest\.webmanifest|icon-(?:192|512|maskable-512)\.png', rel): return self.reply(404)
            asset = (PUBLIC / rel).resolve()
            if not asset.is_relative_to(PUBLIC) or not asset.is_file(): return self.reply(404)
        try:
            with asset.open('rb') as f:
                size = os.fstat(f.fileno()).st_size
                if is_page:
                    offset, original = loader(f)
                    if original != self.server.loader: return self.reply(409)
                    points = [(offset, PROBE)]
                    if M16_BLEND:
                        stat = os.fstat(f.fileno())
                        stamp, hooks = self.server.blend_hooks[arm]
                        if stamp != (stat.st_size, stat.st_mtime_ns): return self.reply(409)
                        points.extend(hooks)
                    self.headers_for(200,'text/html; charset=utf-8',size+sum(len(code) for _,code in points))
                    if self.command == 'HEAD': return
                    f.seek(0)
                    for pos, code in points:
                        while f.tell() < pos:
                            chunk = f.read(min(BLOCK, pos - f.tell()))
                            if not chunk: return
                            self.wfile.write(chunk)
                        self.wfile.write(code)
                else:
                    mime = mimetypes.guess_type(asset.name)[0] or 'application/octet-stream'
                    rng = self.headers.get('Range')
                    if rng:
                        m = re.fullmatch(r'bytes=(\d{0,18})-(\d{0,18})',rng)
                        if m and any(m.groups()):
                            a,b = m.groups(); start = int(a) if a else max(0,size-int(b)); end = min(size-1,int(b)) if a and b else size-1
                        else: start,end = size,-1
                        if not 0 <= start <= end < size: return self.reply(416, **{'Content-Range':f'bytes */{size}'})
                        left = end-start+1
                        self.headers_for(206,mime,left,**{'Accept-Ranges':'bytes','Content-Range':f'bytes {start}-{end}/{size}'})
                        if self.command == 'HEAD': return
                        f.seek(start)
                        while left:
                            chunk = f.read(min(BLOCK,left))
                            if not chunk: break
                            self.wfile.write(chunk); left -= len(chunk)
                        return
                    self.headers_for(200,mime,size,**{'Accept-Ranges':'bytes'})
                    if self.command == 'HEAD': return
                shutil.copyfileobj(f,self.wfile,BLOCK)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass


if __name__ == '__main__':
    original = check_sources()
    hooks = {}
    if M16_BLEND:
        for arm, path in PAGES.items():
            with path.open('rb') as f:
                stat = os.fstat(f.fileno())
                hooks[arm] = ((stat.st_size, stat.st_mtime_ns), blend_offsets(f))
    with ThreadingHTTPServer((HOST, PORT), Handler) as server:
        server.loader = original
        server.blend_hooks = hooks
        print(ORIGIN, flush=True)
        server.serve_forever()
