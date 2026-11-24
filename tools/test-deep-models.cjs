'use strict';

// Node.js 22+ 原生 CDP 探针；不依赖 npm 包，不加载任何 profile 清理脚本。
// 默认完整验收；TEST_FAST=1 仅跳过绕行与离线。CHROME_PATH 可指定 Chrome。
// 如需严格区分几何连续性和胶片颗粒，M51 近景回归同时保存固定相位与默认动态相位图。
// 只创建项目内独立 profile，结束 Browser.close；无论成功失败都不删除 profile。
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { createHash, randomUUID } = require('node:crypto');
const { performance } = require('node:perf_hooks');

const ROOT = path.resolve(__dirname, '..');
// 固定渲染档位，避免自适应分辨率让固定像素阈值和截图尺寸随机器负载漂移。
const HTTP_URL = 'http://127.0.0.1:8169/space.html?auto=0&q=high';
const FILE_URL = pathToFileURL(path.join(ROOT, 'space.html')).href + '?auto=0&q=high';
const RUN_ID = randomUUID();
const REPORT_FILE = path.join(ROOT, `deep-models-test-184-${RUN_ID}.json`);
const FAST = process.env.TEST_FAST === '1';
const WAIT_MS = 120000;
const CHUNK = 128 * 1024;
const IDS = ['47tuc', 'm42', 'm51'];
const report = {
  schema: 1, startedAt: new Date().toISOString(), node: process.version,
  fast: FAST, urls: { http: HTTP_URL, file: FILE_URL }, viewport: { width: 960, height: 640, dpr: 1 },
  tests: [], screenshots: [], errors: [], network: [], browser: null,
  notes: [
    '帧时间是浏览器 requestAnimationFrame 时间戳间隔，含页面调度、渲染提交及证据截图开销；不是 GPU 时间。',
    'renderer.info.memory.geometries 是 Three.js 已登记几何对象数量，不是 GPU 显存字节；geometryBytes 仅为模型属性缓冲字节。',
    '饱和比例同时报告任一 RGB 通道 >=250 与全部 RGB 通道 >=250；不是物理光度标定。',
    'statistics 来自模型 info().variance3D，counts 来自 info().counts；不伪造观测数据。',
    '只操作本程序创建的 Chrome 与项目内 profile，结束不删除 profile。'
  ]
};
let browser, child, session, phase = '初始化', pageKind = 'http', fatal, cleanupPromise, finished = false;
const requests = new Map();
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const assert = (ok, message, details) => {
  if (!ok) { const error = new Error(message); error.details = details; throw error; }
};
const errorText = error => error?.stack || String(error);
function recordError(kind, details) { report.errors.push({ phase, pageKind, kind, ...details }); }

class CDP {
  constructor(ws) {
    this.ws = ws; this.next = 0; this.pending = new Map();
    ws.addEventListener('message', event => {
      let message;
      try { message = JSON.parse(event.data); }
      catch (error) { this.fail(error); return; }
      if (message.id) {
        const p = this.pending.get(message.id);
        if (!p) return;
        clearTimeout(p.timer); this.pending.delete(message.id);
        if (message.error) p.reject(new Error(`${p.method}: ${JSON.stringify(message.error)}`));
        else p.resolve(message.result || {});
      } else {
        try { onEvent(message); } catch (error) { recordError('CDP 事件处理失败', { error: errorText(error) }); }
      }
    });
    ws.addEventListener('close', event => {
      if (!cleanupPromise) recordError('CDP 意外关闭', { code: event.code, reason: event.reason });
      this.fail(new Error(`CDP 已关闭：${event.code}`));
    });
    ws.addEventListener('error', () => {
      if (!cleanupPromise) recordError('CDP WebSocket 错误', {});
      this.fail(new Error('CDP WebSocket 错误'));
    });
  }
  fail(error) {
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(error); }
    this.pending.clear();
  }
  send(method, params = {}, sessionId) {
    return new Promise((resolve, reject) => {
      if (this.ws.readyState !== WebSocket.OPEN) return reject(new Error(`CDP 未连接：${method}`));
      const id = ++this.next;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP 超时：${method}`)); }, WAIT_MS);
      this.pending.set(id, { resolve, reject, timer, method });
      try { this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { ws.close(); reject(new Error('CDP 连接超时')); }, 45000);
      ws.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('CDP 连接失败')); }, { once: true });
    });
    return new CDP(ws);
  }
}
const send = (method, params) => browser.send(method, params, session);
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}
async function until(label, predicate, timeout = WAIT_MS) {
  const started = performance.now();
  while (performance.now() - started < timeout) {
    const result = await predicate();
    if (result) return result;
    await delay(100);
  }
  throw new Error(`等待超时（${timeout}ms）：${label}`);
}
function onEvent(event) {
  if (event.sessionId !== session) return;
  const p = event.params || {};
  if (event.method === 'Runtime.consoleAPICalled') {
    const text = p.args.map(a => a.value ?? a.description ?? a.type).join(' ');
    if (p.type === 'error' || /(?:WebGL|GL_INVALID|GL_OUT_OF_MEMORY|GL_CONTEXT_LOST|shader).*(?:error|fail|invalid|lost)|(?:error|fail|invalid).*(?:WebGL|shader)/i.test(text)) {
      recordError(p.type === 'error' ? 'console.error' : 'WebGL 错误', { text });
    }
  } else if (event.method === 'Runtime.exceptionThrown') {
    recordError('运行时异常', { details: p.exceptionDetails });
  } else if (event.method === 'Log.entryAdded') {
    if (p.entry.level === 'error' || /(?:WebGL|GL_INVALID|GL_OUT_OF_MEMORY|GL_CONTEXT_LOST).*(?:error|fail|invalid|lost)/i.test(p.entry.text)) {
      recordError('浏览器日志错误', { entry: p.entry });
    }
  } else if (event.method === 'Network.requestWillBeSent') {
    // 内联贴图只记录协议和摘要，避免 JSON 报告重复嵌入整份离线图片。
    const url = /^data:/i.test(p.request.url) ? `${p.request.url.slice(0, 100)}…（${p.request.url.length}字符）` : p.request.url;
    const item = { requestId: p.requestId, url, phase, pageKind, timestamp: p.timestamp };
    requests.set(p.requestId, item); report.network.push(item);
    if (pageKind === 'file' && !/^(?:file|data|blob|about):/i.test(item.url)) recordError('离线外部请求', { url: item.url });
  } else if (event.method === 'Network.webSocketCreated') {
    report.network.push({ url: p.url, phase, pageKind, type: 'WebSocket' });
    if (pageKind === 'file') recordError('离线 WebSocket 请求', { url: p.url });
  } else if (event.method === 'Network.responseReceived') {
    const item = requests.get(p.requestId);
    if (item) item.status = p.response.status;
    if (p.response.status >= 400) recordError('HTTP 错误', { url: p.response.url, status: p.response.status });
  } else if (event.method === 'Network.loadingFailed') {
    const item = requests.get(p.requestId);
    if (item) { item.failed = p.errorText; item.canceled = !!p.canceled; }
    if (!p.canceled && p.errorText !== 'net::ERR_ABORTED') recordError('资源加载失败', { url: item?.url, error: p.errorText });
  }
}
async function launch() {
  assert(typeof WebSocket === 'function', '需要 Node.js 22+ 原生 WebSocket');
  assert(fs.statSync(ROOT).isDirectory(), '项目根目录不存在');
  const parent = path.join(ROOT, '.workbuddy');
  if (!fs.existsSync(parent)) fs.mkdirSync(parent);
  assert(fs.statSync(parent).isDirectory(), '.workbuddy 不是目录');
  const profile = fs.mkdtempSync(path.join(parent, 'probe-deep-models-'));
  const candidates = [process.env.CHROME_PATH,
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google/Chrome/Application/chrome.exe'),
    process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Google/Chrome/Application/chrome.exe')].filter(Boolean);
  const chrome = candidates.find(file => fs.existsSync(file));
  assert(chrome, '未找到 Chrome；请设置 CHROME_PATH，不扫描个人目录');
  const args = ['--headless=new', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0',
    `--user-data-dir=${profile}`, '--window-size=960,640', '--force-device-scale-factor=1',
    '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
    '--disable-component-update', 'about:blank'];
  if (process.env.ORBIT_GPU === '0') args.unshift('--enable-unsafe-swiftshader', '--use-angle=swiftshader');
  report.launch = { chrome, profile, args, softwareRenderingRequested: process.env.ORBIT_GPU === '0' };
  child = spawn(chrome, args, { stdio: ['ignore', 'ignore', 'pipe'], detached: false, windowsHide: true });
  report.launch.pid = child.pid;
  let stderr = '';
  const endpoint = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Chrome 未报告回环 DevTools 地址：${stderr}`)), 45000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', (code, signal) => {
      report.launch.exit = { code, signal };
      clearTimeout(timer); reject(new Error(`Chrome 提前退出 ${code}/${signal}`));
    });
    child.stderr.on('data', chunk => {
      stderr = (stderr + chunk.toString()).slice(-16000);
      report.launch.stderrTail = stderr;
      const match = stderr.match(/DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[^\s]+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
  });
  report.launch.endpoint = endpoint;
  browser = await CDP.connect(endpoint);
  report.browser = await browser.send('Browser.getVersion');
  try { report.gpu = (await browser.send('SystemInfo.getInfo')).gpu; }
  catch (error) { report.notes.push(`GPU 元数据不可用：${error.message}`); }
  const target = await browser.send('Target.createTarget', { url: 'about:blank' });
  session = (await browser.send('Target.attachToTarget', { targetId: target.targetId, flatten: true })).sessionId;
  await Promise.all(['Page.enable', 'Runtime.enable', 'Log.enable', 'Network.enable'].map(method => send(method)));
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Network.setBypassServiceWorker', { bypass: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 960, height: 640, deviceScaleFactor: 1, mobile: false });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    try { localStorage.setItem('space11.tour','1'); } catch (_) {}
    window.__deepProbe = { shots: {}, pixels: {}, contextLost: 0 };
    document.addEventListener('webglcontextlost', () => { window.__deepProbe.contextLost++; }, true);
    document.addEventListener('DOMContentLoaded', () => {
      if (!document.querySelector('link[rel~="icon"]')) {
        const icon = document.createElement('link'); icon.rel='icon'; icon.href='data:,'; document.head.appendChild(icon);
      }
    }, {once:true});` });
}
async function load(url, kind) {
  pageKind = kind;
  const result = await send('Page.navigate', { url });
  assert(!result.errorText, `导航失败：${result.errorText}`);
  // 既有主入口的 firstFrame=true 表示首帧尚未完成，必须等到 false。
  await until('__SE 与已完成的 firstFrame', () => evaluate('!!(window.__SE && __SE.firstFrame === false && __SE.deep)'));
  const ready = await evaluate(`(() => {
    __SE.ts = 0;
    if (__SE.tour) __SE.tour(false);
    if (__SE.help) __SE.help(false);
    return {url:location.href,firstFrame:__SE.firstFrame,width:innerWidth,height:innerHeight,dpr:devicePixelRatio,
      api:['open','close','setView','info','setDust'].every(k=>typeof __SE.deep[k]==='function'),controller:!!__SE.deep.controller};
  })()`);
  assert(ready.width === 960 && ready.height === 640 && ready.dpr === 1, 'viewport/DPR 不符合要求', ready);
  assert(ready.api, 'deep API 不完整', ready); // Controller is deliberately lazy until first open.
  await until('加载遮罩已退出', () => evaluate(`(() => { const e=document.getElementById('loader'); return !e || getComputedStyle(e).display==='none' || getComputedStyle(e).visibility==='hidden'; })()`));
  return ready;
}
async function frames(n = 3) {
  await evaluate(`new Promise(resolve=>{let n=${n};function tick(){if(--n<=0)resolve(true);else requestAnimationFrame(tick);}requestAnimationFrame(tick);})`);
}
async function glHealth() {
  const health = await evaluate(`(() => {const gl=__SE.renderer.getContext(); const errors=[];
    for(let i=0;i<16;i++){const e=gl.getError();if(e===gl.NO_ERROR)break;errors.push(e);}
    return {errors,lost:gl.isContextLost(),contextLost:window.__deepProbe.contextLost};})()`);
  assert(!health.lost && health.contextLost === 0 && !health.errors.length, 'WebGL 状态错误', health);
  return health;
}
async function modelInfo(id) {
  const info = await evaluate('__SE.deep.info()');
  assert(info.active && info.id === id, `未激活目标 ${id}`, info);
  assert(['yaw', 'pitch', 'distance'].every(k => Number.isFinite(info.camera?.[k])), '相机诊断无效', info);
  assert(info.counts?.stars > 0 && info.counts?.geometries > 0 && info.geometryBytes > 0, '模型计数/几何诊断无效', info);
  assert(info.variance3D?.stars?.sampleCount === info.counts.stars, '模型 statistics 与 counts 不一致', info);
  return info;
}
async function openModel(id, view = 'front') {
  const state = await evaluate(`(() => {
    const result=__SE.deep.open(${JSON.stringify(id)});
    if(result && typeof result.then==='function')throw new Error('deep.open 必须同步');
    __SE.deep.setDust(true); __SE.deep.setView(${JSON.stringify(view)}); return __SE.deep.info();
  })()`);
  assert(state.active && state.id === id, '同步 open 未生效', state);
  await frames();
  return modelInfo(id);
}
async function panel() {
  const state = await evaluate(`(() => {
    const e=document.querySelector('#deepModelPanel'); if(!e)return null;
    const r=e.getBoundingClientRect(),s=getComputedStyle(e);
    return {visible:!e.hidden&&s.display!=='none'&&s.visibility!=='hidden'&&Number(s.opacity)>0&&r.width>0&&r.height>0,
      text:e.innerText,rect:{x:r.x,y:r.y,width:r.width,height:r.height}};
  })()`);
  assert(state?.visible, '#deepModelPanel 不可见', state);
  assert(/[\u4e00-\u9fff]/.test(state.text) && /统计|程序|示意|演示|艺术|模型/.test(state.text)
    && /并非|不等于|不是|非真实|非观测|非实测|非测量|非重建|非科学|不代表|未标定|不保证|非逐星|非逐颗/.test(state.text), '面板缺少中文真实性/局限说明', state);
  return state;
}
async function click(selector) {
  const point = await evaluate(`(() => {const e=document.querySelector(${JSON.stringify(selector)}); if(!e)return null;
    const r=e.getBoundingClientRect(),s=getComputedStyle(e); const x=r.x+r.width/2,y=r.y+r.height/2;
    return {x,y,width:r.width,height:r.height,disabled:!!e.disabled,visible:s.display!=='none'&&s.visibility!=='hidden',
      hit:e.contains(document.elementFromPoint(x,y))};})()`);
  assert(point?.visible && point.width > 0 && point.height > 0 && !point.disabled && point.hit, `按钮不可点击：${selector}`, point);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 });
  await frames();
}
async function capture(tag, existing = false, options = undefined) {
  const key = JSON.stringify(tag);
  if (!existing) await evaluate(`(window.__deepProbe.shots[${key}]=__SE.snap('image/png',${JSON.stringify(options) || 'undefined'}),true)`);
  const meta = await evaluate(`(async()=>{
    const p=window.__deepProbe,u=p.shots[${key}]; if(typeof u!=='string'||!u.startsWith('data:image/png;base64,'))throw new Error('snap 未返回 PNG');
    const im=new Image(); im.src=u; await im.decode();
    const c=document.createElement('canvas'); c.width=im.naturalWidth;c.height=im.naturalHeight;
    const ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(im,0,0);
    const pixels=ctx.getImageData(0,0,c.width,c.height).data;p.pixels[${key}]=pixels;
    let lit=0,saturated=0,white=0,sum=0,sum2=0,max=0;
    for(let i=0;i<pixels.length;i+=4){const r=pixels[i],g=pixels[i+1],b=pixels[i+2],hi=Math.max(r,g,b),lo=Math.min(r,g,b);
      if(hi>4)lit++;if(hi>=250)saturated++;if(lo>=250)white++;
      const l=.2126*r+.7152*g+.0722*b;sum+=l;sum2+=l*l;max=Math.max(max,hi);}
    const n=c.width*c.height,m=sum/n;
    return {length:u.length,width:c.width,height:c.height,pixels:n,nonblackRatio:lit/n,saturatedRatio:saturated/n,
      whiteClippedRatio:white/n,meanLuminance:m,luminanceStdDev:Math.sqrt(Math.max(0,sum2/n-m*m)),maxChannel:max};
  })()`);
  const parts = [];
  for (let offset = 0; offset < meta.length; offset += CHUNK) {
    parts.push(await evaluate(`window.__deepProbe.shots[${key}].slice(${offset},${offset + CHUNK})`));
  }
  const dataURL = parts.join('');
  assert(dataURL.length === meta.length, '分块读取长度不一致', meta);
  const bytes = Buffer.from(dataURL.slice(dataURL.indexOf(',') + 1), 'base64');
  assert(bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), '截图 PNG 签名无效');
  const file = path.join(ROOT, `${tag}-${RUN_ID}.png`);
  fs.writeFileSync(file, bytes, { flag: 'wx' });
  const shot = { phase, pageKind, tag, file, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), ...meta };
  report.screenshots.push(shot);
  assert(meta.width === 960 && meta.height === 640, '画布截图尺寸不正确', meta);
  assert(meta.nonblackRatio > 0.0001 && meta.luminanceStdDev > 0.05, '画布黑帧或无有效结构', meta);
  await glHealth();
  return shot;
}
async function difference(a, b) {
  return evaluate(`(() => {const a=window.__deepProbe.pixels[${JSON.stringify(a)}],b=window.__deepProbe.pixels[${JSON.stringify(b)}];
    if(!a||!b||a.length!==b.length)throw new Error('像素比较尺寸不一致');
    let sum=0,changed=0,max=0;
    for(let i=0;i<a.length;i+=4){let change=false;for(let k=0;k<3;k++){const d=Math.abs(a[i+k]-b[i+k]);sum+=d;max=Math.max(max,d);if(d>0)change=true;}if(change)changed++;}
    return {meanAbsoluteDifference:sum/(a.length/4*3),changedPixelRatio:changed/(a.length/4),maxChannelDifference:max,scale:'RGB 0..255'};
  })()`);
}
async function mainSnapshot() {
  return evaluate(`(() => {const s=__SE,c=s.cam;
    return {focus:c.focus===s.EARTH?'earth':c.focus===s.MOON?'moon':c.focus===s.SUN?'sun':c.focus?.name,
      dir:c.dir.toArray(),alt:c.alt,yaw:c.yaw,pitch:c.pitch,shift:c.shift.toArray(),
      cameraPosition:s.camera.position.toArray(),cameraQuaternion:s.camera.quaternion.toArray(),
      cameraFov:s.camera.fov,cosmicActive:!!s.CS.active,timeScale:s.ts,
      sceneVisible:s.scene.visible,toneMapping:s.renderer.toneMapping,exposure:s.renderer.toneMappingExposure};})()`);
}
function closeEnough(a, b) {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= 1e-8 * Math.max(1, Math.abs(a), Math.abs(b));
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const keys = Object.keys(a); return keys.length === Object.keys(b).length && keys.every(k => closeEnough(a[k], b[k]));
  }
  return a === b;
}
async function test(name, fn) {
  phase = name; const start = performance.now(), errorsBefore = report.errors.length;
  try {
    const details = await fn();
    await evaluate('true');
    assert(report.errors.length === errorsBefore, '用例出现浏览器/网络/WebGL 错误', report.errors.slice(errorsBefore));
    report.tests.push({ name, status: 'pass', durationMs: performance.now() - start, details });
    console.log(`通过：${name}`);
    return true;
  } catch (error) {
    report.tests.push({ name, status: 'fail', durationMs: performance.now() - start, error: errorText(error), details: error.details });
    console.error(`失败：${name}：${error.message}`);
    return false;
  }
}
async function trajectory(id) {
  await openModel(id);
  const run = await evaluate(`new Promise((resolve,reject)=>{
    const p=window.__deepProbe,intervals=[],views=[],evidence=[];
    const keep=new Set([0,5,10,15,20,25,29]);let index=0,previous;
    const frameStart=__SE.renderer.info.render.frame;
    function view(i){return {yaw:2*Math.PI*i/30,pitch:.22*Math.sin(2*Math.PI*i/30),distance:3.6,target:[0,0,0]};}
    function tick(t){try{
      if(previous!==undefined){
        intervals.push(t-previous);
        const i=index-1;
        views.push({index:i,camera:__SE.deep.info().camera});
        if(keep.has(i)){const tag='shot184-${id}-orbit-'+String(i).padStart(2,'0');p.shots[tag]=__SE.snap('image/png');evidence.push(tag);}
      }
      if(index===30){resolve({intervals,views,evidence,renderFrames:__SE.renderer.info.render.frame-frameStart});return;}
      previous=t;__SE.deep.setView(view(index++));requestAnimationFrame(tick);
    }catch(error){reject(error);}}
    requestAnimationFrame(tick);
  })`);
  assert(run.intervals.length === 30 && run.intervals.every(t => Number.isFinite(t) && t > 0), '绕行未取得30个实际浏览器帧间隔', run);
  for (const tag of run.evidence) await capture(tag, true);
  const sorted = [...run.intervals].sort((a, b) => a - b);
  return { ...run, p50Ms: sorted[Math.ceil(sorted.length * .5) - 1], p95Ms: sorted[Math.ceil(sorted.length * .95) - 1],
    note: '浏览器 rAF 时间戳间隔，固定30步轨迹；含每5帧及末帧 snap 同步读回/PNG 编码的后续帧开销，不是 GPU 时间，无性能通过阈值。' };
}
async function main() {
  phase = 'HTTP 内容校验';
  const localPath = path.join(ROOT, 'space-http.html');
  const local = fs.readFileSync(localPath);
  const verification = report.httpVerification = {
    url: HTTP_URL, localPath, localBytes: local.length,
    localSha256: createHash('sha256').update(local).digest('hex')
  };
  const response = await fetch(HTTP_URL, { redirect: 'manual', signal: AbortSignal.timeout(15000) });
  verification.status = response.status;
  assert(response.status === 200, `HTTP 内容校验失败：期望状态 200，实际 ${response.status}（禁止重定向）`, verification);
  const remote = Buffer.from(await response.arrayBuffer());
  verification.httpBytes = remote.length;
  verification.httpSha256 = createHash('sha256').update(remote).digest('hex');
  verification.matches = local.equals(remote);
  assert(verification.matches && verification.localSha256 === verification.httpSha256,
    'HTTP 内容校验失败：响应与本地 space-http.html 不一致', verification);
  await launch();
  let baseline;
  const loaded = await test('HTTP 首帧与主场景基线', async () => {
    const ready = await load(HTTP_URL, 'http');
    // 等主场景地形队列收敛，避免将它的异步新增几何误算为 deep 泄漏。
    await until('主场景地形队列空闲', () => evaluate('!!__SE.wstate && __SE.wstate.queue===0 && __SE.wstate.inflight===0 && __SE.wstate.syncQueue===0'));
    await frames();
    baseline = await mainSnapshot();
    return { ready, snapshot: baseline, screenshot: await capture('shot184-main-before') };
  });
  assert(loaded, 'HTTP 初始化失败，无法继续模型验收');
  await test('真实按钮进入 47tuc 与中文真实性说明', async () => {
    await click('#deepModelBtn');
    return { info: await modelInfo('47tuc'), panel: await panel(), screenshot: await capture('shot184-47tuc-button') };
  });
  for (const id of IDS) {
    await test(`四视图-${id}`, async () => {
      await openModel(id);
      const result = { info: await modelInfo(id), panel: await panel(), views: [] };
      for (const view of ['front', 'side', 'back', 'near']) {
        if (view === 'near') await evaluate('__SE.deep.setView("front")');
        await evaluate(`(__SE.deep.setView(${JSON.stringify(view)}),true)`); await frames();
        const info = await modelInfo(id);
        const expectedYaw = view === 'side' ? Math.PI / 2 : view === 'back' ? Math.PI : 0;
        assert(Math.abs(info.camera.yaw - expectedYaw) < 1e-8 && Math.abs(info.camera.pitch) < 1e-8
          && Math.abs(info.camera.distance - (view === 'near' ? .35 : 3.6)) < 1e-8, '视图预设未正确更新相机', info.camera);
        const screenshot = await capture(`shot184-${id}-${view}`);
        if (id === 'm51' && view === 'near') {
          // Engineering smoke thresholds for this fixed camera/exposure, not a visual-quality verdict.
          assert(screenshot.saturatedRatio < .02 && screenshot.meanLuminance > 30 && screenshot.meanLuminance < 190,
            'M51 近景固定机位亮度/高亮比例超出回归阈值', screenshot);
        }
        result.views.push({ view, info, screenshot });
      }
      return result;
    });
    await test(`稳定 seed 重复打开-${id}`, async () => {
      const first = await openModel(id);
      const a = await capture(`shot184-${id}-seed-a`);
      await openModel(IDS[(IDS.indexOf(id) + 1) % IDS.length]);
      const second = await openModel(id);
      const b = await capture(`shot184-${id}-seed-b`);
      const stats = info => ({ seed: info.seed, statistics: info.variance3D, counts: info.counts, geometryBytes: info.geometryBytes, camera: info.camera });
      const statisticsEqual = JSON.stringify(stats(first)) === JSON.stringify(stats(second));
      const delta = await difference(a.tag, b.tag);
      assert(Number.isFinite(first.seed) && statisticsEqual, '相同 seed 重建统计/计数不稳定', { first, second, delta });
      return { first: stats(first), second: stats(second), statisticsEqual, pixelsIdentical: a.sha256 === b.sha256, pixelDifference: delta,
        criterion: '相同 seed、相同视图的模型 statistics/counts 必须一致；同时报告真实像素差异。' };
    });
  }
  let m51DynamicContinuity;
  await test('M51 固定颗粒相位近景几何连续性', async () => {
    await openModel('m51');
    const samples = [];
    for (const [name, distance] of [['center-a', .35], ['center-b', .35], ['nearer', .349], ['farther', .351]]) {
      const view = { yaw: 0, pitch: 0, distance, target: [0, 0, 0] };
      await evaluate(`(__SE.deep.setView(${JSON.stringify(view)}),true)`);
      await frames();
      const dynamicTag = `shot184-m51-continuity-${name}-dynamic`;
      const fixedTag = `shot184-m51-continuity-${name}-fixed`;
      // 在同一 JS 任务读取相机/曝光并拍摄；设置机位和等待帧发生在此前任务。
      const state = await evaluate(`(() => {
        const read = () => ({ camera: __SE.deep.info().camera, timeScale: __SE.ts,
          exposure: __SE.renderer.toneMappingExposure, toneMapping: __SE.renderer.toneMapping });
        const before = read();
        window.__deepProbe.shots[${JSON.stringify(dynamicTag)}] = __SE.snap('image/png');
        const middle = read();
        window.__deepProbe.shots[${JSON.stringify(fixedTag)}] = __SE.snap('image/png', {gradePhase: 0});
        return { before, middle, after: read() };
      })()`);
      for (const item of [state.before, state.middle, state.after]) {
        const camera = item.camera;
        assert(Math.abs(camera.yaw - view.yaw) < 1e-8 && Math.abs(camera.pitch - view.pitch) < 1e-8
          && Math.abs(camera.distance - distance) < 1e-8 && closeEnough(camera.target, view.target),
          'M51 近景测试机位未正确设置', { view, state });
      }
      assert(closeEnough(state.before, state.middle) && closeEnough(state.before, state.after),
        'M51 同次截图的相机/曝光/时间倍率状态变化', { view, state });
      samples.push({ name, view, state, dynamic: await capture(dynamicTag, true), fixed: await capture(fixedTag, true) });
    }
    const measure = async mode => ({
      repeat: await difference(samples[0][mode].tag, samples[1][mode].tag),
      nearer: await difference(samples[0][mode].tag, samples[2][mode].tag),
      farther: await difference(samples[0][mode].tag, samples[3][mode].tag)
    });
    const fixed = await measure('fixed');
    const dynamic = await measure('dynamic');
    const thresholds = { repeatMeanMax: 2, stepMeanMax: 8, stepAboveRepeatMax: 6 };
    const details = { samples, differences: { fixed, dynamic }, thresholds,
      note: '固定相位仅用于几何连续性烟测；默认动态相位另设独立烟测。模拟时间倍率为0，但浏览器时间及其他动画未冻结。阈值沿用旧测试，均为显示编码 RGB 0–255；不代表跨设备或视觉质量验收。' };
    m51DynamicContinuity = details;
    assert(fixed.repeat.meanAbsoluteDifference <= details.thresholds.repeatMeanMax,
      'M51 固定颗粒相位同机位重复截图差异过大', details);
    for (const delta of [fixed.nearer, fixed.farther]) {
      assert(delta.meanAbsoluteDifference <= details.thresholds.stepMeanMax
        && delta.meanAbsoluteDifference <= fixed.repeat.meanAbsoluteDifference + details.thresholds.stepAboveRepeatMax,
      'M51 固定颗粒相位近景距离小步变化出现较大画面跳变', details);
    }
    return details;
  });
  await test('M51 默认动态颗粒近景重复与距离连续性', async () => {
    assert(!!m51DynamicContinuity, '动态相位样本未成功采集');
    const details = m51DynamicContinuity;
    const { repeat, nearer, farther } = details.differences.dynamic;
    const thresholds = details.thresholds;
    assert(repeat.meanAbsoluteDifference <= thresholds.repeatMeanMax,
      'M51 默认动态颗粒同机位重复截图差异过大', details);
    for (const delta of [nearer, farther]) {
      assert(delta.meanAbsoluteDifference <= thresholds.stepMeanMax
        && delta.meanAbsoluteDifference <= repeat.meanAbsoluteDifference + thresholds.stepAboveRepeatMax,
      'M51 默认动态颗粒近景距离小步变化出现较大画面跳变', details);
    }
    return { differences: details.differences.dynamic, thresholds, samples: details.samples.map(s => ({
      name: s.name, view: s.view, state: s.state, screenshot: s.dynamic
    })), note: '仅是默认动态相位的四张固定视点截图工程烟测，不代表连续动画、跨设备或视觉质量验收。' };
  });
  await test('M51 高采样参考与交互模式对照', async () => {
    await openModel('m51');
    await evaluate('(__SE.deep.setView("near"),true)');
    const normal = await capture('shot184-m51-quality-interactive');
    const state = await evaluate('__SE.deep.setQuality("reference")');
    assert(state.rendering.maxVolumeSteps === 256 && state.rendering.stellarExtinctionSteps === 56, '参考采样档未启用', state);
    const reference = await capture('shot184-m51-quality-reference');
    const delta = await difference(normal.tag, reference.tag);
    const reset = await evaluate('__SE.deep.setQuality("interactive")');
    const restored = await capture('shot184-m51-quality-restored');
    const repeat = await difference(normal.tag, restored.tag);
    assert(reset.rendering.maxVolumeSteps === 128 && repeat.meanAbsoluteDifference < 2, '恢复交互档失败', { reset, repeat });
    return { normal, reference, restored, delta, repeat,
      note: '显示编码RGB差异，不是线性HDR误差；256步参考未完成收敛性验证，不是标准真值。' };
  });
  await test('参考模式跨模型及无效输入', async () => {
    await openModel('m42');
    const initial = await capture('shot184-m42-quality-interactive');
    const ref = await evaluate('__SE.deep.setQuality("reference")');
    const image = await capture('shot184-m42-quality-reference');
    const delta = await difference(initial.tag, image.tag);
    const cluster = await evaluate('(__SE.deep.open("47tuc"),__SE.deep.info())');
    assert(cluster.rendering.quality === 'reference' && cluster.rendering.maxVolumeSteps === 0, '星团参考模式诊断错误', cluster);
    const check = await evaluate(`(() => { try { __SE.deep.setQuality('invalid'); return false; } catch(e) { return e instanceof RangeError; } })()`);
    assert(check, '无效质量档未拒绝');
    const reset = await evaluate('__SE.deep.setQuality("interactive")');
    return { ref: ref.rendering, delta, cluster: cluster.rendering, reset: reset.rendering,
      note: '仅检查兼容及显示编码截图差异，非收敛或性能验收。' };
  });
  await test('M51 256与512体积步采样对照', async () => {
    await openModel('m51');
    await evaluate('(__SE.deep.setView("near"),__SE.deep.setQuality("reference"),true)');
    const a = await capture('shot184-m51-reference256');
    const state = await evaluate('__SE.deep.setQuality("reference512")');
    assert(state.rendering.maxVolumeSteps === 512 && state.rendering.stellarExtinctionSteps === 56, '512档参数不符', state);
    const b = await capture('shot184-m51-reference512');
    const delta = await difference(a.tag, b.tag);
    const b2 = await capture('shot184-m51-reference512-repeat');
    const repeat = await difference(b.tag, b2.tag);
    await evaluate('__SE.deep.setQuality("interactive")');
    return { delta, repeat, camera: state.camera, note: '两档恒星消光均56步，仅体积积分步数改变；显示编码全图差异，不是HDR误差或收敛证明。' };
  });
  await test('九次模型切换无几何增长', async () => {
    const samples = [], baselines = {};
    const sample = async id => {
      await openModel(id);
      // snap 确保独立 scene 已真实渲染，不能只检查尚未上传的几何。
      return evaluate(`(() => {__SE.snap();return {id:${JSON.stringify(id)},memory:{...__SE.renderer.info.memory},
        model:__SE.deep.info(),renderFrame:__SE.renderer.info.render.frame};})()`);
    };
    for (const id of IDS) baselines[id] = await sample(id);
    for (let i = 0; i < 9; i++) {
      const id = IDS[i % IDS.length], state = await sample(id); samples.push({ index: i + 1, ...state });
      assert(Number.isFinite(state.memory.geometries) && state.memory.geometries <= baselines[id].memory.geometries,
        '重复切换后同模型 renderer.info.memory.geometries 增长', { baseline: baselines[id], state });
      assert(state.model.geometryBytes === baselines[id].model.geometryBytes, '模型几何字节数增长', state);
      await glHealth();
    }
    return { warmup: baselines, switches: samples, comparison: '3模型分别预热，再循环9次，按相同模型比较已渲染几何数量。' };
  });
  for (const id of ['m42', 'm51']) await test(`尘埃遮挡像素对照-${id}`, async () => {
    await openModel(id);
    await evaluate('(__SE.deep.setDust(false),true)'); await frames();
    const off = await capture(`shot184-${id}-dust-off`), offInfo = await modelInfo(id);
    await evaluate('(__SE.deep.setDust(true),true)'); await frames();
    const on = await capture(`shot184-${id}-dust-on`), onInfo = await modelInfo(id);
    const delta = await difference(off.tag, on.tag);
    assert(offInfo.dust === false && onInfo.dust === true, 'setDust 状态未切换', { offInfo, onInfo });
    assert(delta.meanAbsoluteDifference > .01 && delta.changedPixelRatio > .0001, '尘埃开关未产生有效像素差异', delta);
    assert(off.meanLuminance > on.meanLuminance, '开启吸收后画面未变暗', { off: off.meanLuminance, on: on.meanLuminance, delta });
    return { off, on, delta };
  });
  if (FAST) report.tests.push({ name: '固定30帧绕行（全部模型）', status: 'skip', reason: 'TEST_FAST=1' });
  else for (const id of IDS) await test(`固定30帧绕行-${id}`, () => trajectory(id));
  await test('关闭模型恢复原 main snapshot', async () => {
    await evaluate('(__SE.deep.close(),true)'); await frames();
    const info = await evaluate('__SE.deep.info()');
    const restored = await mainSnapshot();
    const state = await evaluate(`(() => {const e=document.querySelector('#deepModelPanel');return {hidden:!e||e.hidden||getComputedStyle(e).display==='none'||getComputedStyle(e).visibility==='hidden'};})()`);
    const screenshot = await capture('shot184-main-after');
    const pixels = await difference('shot184-main-before', 'shot184-main-after');
    assert(!info.active && state.hidden, 'close 后仍激活模型或显示面板', { info, state });
    assert(closeEnough(baseline, restored), 'close 未恢复主场景状态快照', { baseline, restored });
    return { before: baseline, after: restored, screenshot, pixelDifference: pixels,
      note: '状态快照要求恢复；主场景可有时变着色/异步资源，PNG 像素差异仅作证据，不要求逐字节一致。' };
  });
  await test('地球到宇宙网固定旅程取景', async () => {
    const samples = [];
    try {
      for (const seconds of [0, 4, 8, 12, 14, 15, 16, 17, 20]) {
        const state = await evaluate(`__SE.journeySeek(${seconds})`);
        assert(state && Number.isFinite(state.lg), '旅程定位未返回有效尺度', { seconds, state });
        assert(!samples.length || state.lg > samples[samples.length - 1].state.lg, '旅程尺度未随时间递增', { seconds, state });
        assert(state.cs === (seconds >= 8), '旅程主场景与宇宙场景状态异常', { seconds, state });
        await frames();
        const screenshot = await capture(`shot184-journey-${seconds}s`);
        const cosmic = await evaluate(`(() => ({ active: __SE.CS.active, bodyStarObjectsBuilt: Array.isArray(__SE.CS.bodyStars), bodyStarObjectsWithVisibleFlag: (__SE.CS.bodyStars || []).filter(x => x.visible).length }))()`);
        assert(cosmic.active === state.cs, '截图时场景状态与定位结果不符', { seconds, state, cosmic });
        samples.push({ seconds, state, cosmic, screenshot });
      }
    } finally {
      await evaluate('__SE.journeyStop()');
    }
    const stopped = await evaluate('__SE.journeyInfo');
    assert(!stopped.on, '旅程未停止', stopped);
    return { samples, stopped, note: '固定时间点非连续视频验收；对象visible标记不等于进入视锥或实际产生像素，不证明各尺度真实三维。' };
  });
  await test('GLSL 有符号平方使用乘法', async () => {
    const source = fs.readFileSync(path.join(ROOT, 'public/js/deep-models.js'), 'utf8');
    const shader = source.slice(source.indexOf('var COMMON'), source.indexOf('var QUAD_VERTEX'));
    assert(shader.includes('float square(float x) { return x*x; }'), '缺少安全平方函数');
    assert(!/pow\([^;\n]*,\s*2\.0\)/.test(shader), '密度场仍使用 pow(x,2.0)');
    return { safeSquares: (shader.match(/square\(/g) || []).length - 1 };
  });
  await test('中断穿梭清理 HUD 与峰值回调', async () => {
    const state = await evaluate(`(() => {
      window.__deepProbe.peakCalls=0;
      const started=__SE.warp(()=>window.__deepProbe.peakCalls++,2000);
      const during=document.body.classList.contains('warping');
      __SE.deep.open('m42'); __SE.deep.close();
      return {started,during,after:document.body.classList.contains('warping'),warp:__SE.warpInfo,motion:__SE.motionInfo};
    })()`);
    assert(state.started && state.during && !state.after && !state.warp.active && state.warp.amt===0 && !state.motion.warpCallback,
      '穿梭未完整取消', state);
    await frames(5);
    assert(await evaluate('window.__deepProbe.peakCalls===0'), '已取消的穿梭回调仍执行');
    return state;
  });
  for (const black of [false, true]) await test(`取消${black ? '黑场' : '溶解'}异步转场且不污染新转场`, async () => {
    await evaluate(`(() => {
      window.__deepProbe.oldCalls=0;window.__deepProbe.newCalls=0;
      __SE.transition(()=>window.__deepProbe.oldCalls++,${black},50);
      __SE.deep.open('47tuc');__SE.deep.close();
      __SE.transition(()=>window.__deepProbe.newCalls++,${black},80);
    })()`);
    await until('新转场结束', () => evaluate('!__SE.motionInfo.busy'));
    const state = await evaluate(`({oldCalls:window.__deepProbe.oldCalls,newCalls:window.__deepProbe.newCalls,
      motion:__SE.motionInfo,fade:document.getElementById('fade')?.style.opacity,
      dissolve:document.getElementById('xdissolve')?.style.opacity})`);
    assert(state.oldCalls===0 && state.newCalls===1 && !state.motion.busy, '旧回调执行或新转场被旧回调破坏', state);
    assert((!state.fade || state.fade==='0') && (!state.dissolve || state.dissolve==='0'), '遮罩残留', state);
    return state;
  });
  await test('画布 Tab 可进入近景控件且主快捷键隔离', async () => {
    await openModel('47tuc');
    const initial = await evaluate(`({focus:document.activeElement.id,tabIndex:__SE.renderer.domElement.tabIndex})`);
    assert(initial.focus==='deepModelTarget' && initial.tabIndex===0, '首次进入时画布不可通过键盘访问', initial);
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', modifiers: 8, windowsVirtualKeyCode: 9 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', modifiers: 8, windowsVirtualKeyCode: 9 });
    const canvasFocus = await evaluate('document.activeElement===__SE.renderer.domElement');
    assert(canvasFocus, 'Shift+Tab 未从首个面板控件进入画布');
    const rotated = await evaluate(`(() => {const c=__SE.renderer.domElement,before=__SE.deep.info().camera.yaw;
      c.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',code:'ArrowLeft',bubbles:true,cancelable:true}));
      return __SE.deep.info().camera.yaw!==before;})()`);
    assert(rotated, '键盘未控制画布视角');
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    const focus = await evaluate(`({id:document.activeElement.id,inPanel:!!document.activeElement.closest('#deepModelPanel')})`);
    assert(focus.inPanel, 'Tab 未从画布进入面板', focus);
    const isolated = await evaluate(`(() => {const c=__SE.renderer.domElement;c.focus();const before=__SE.ts;
      c.dispatchEvent(new KeyboardEvent('keydown',{key:'t',code:'KeyT',bubbles:true,cancelable:true}));
      return {before,after:__SE.ts};})()`);
    assert(isolated.before===isolated.after, '近景按键泄漏到主场景', isolated);
    await evaluate('(__SE.deep.close(),true)');
    return {focus,isolated};
  });
  await test('黑洞与近景输入互斥及 Escape 返回', async () => {
    const before = await evaluate(`(() => {__SE.enterBH('sgra');__SE.bhSet({dist:16,inc:.2,az:.1});
      __SE.deep.open('m42');return {bh:__SE.bhInfo,deep:__SE.deep.info().camera};})()`);
    // 真鼠标事件经过浏览器命中与捕获链；右侧避开近景面板。
    await send('Input.dispatchMouseEvent', {type:'mouseMoved',x:760,y:420});
    await send('Input.dispatchMouseEvent', {type:'mouseWheel',x:760,y:420,deltaX:0,deltaY:120});
    await send('Input.dispatchMouseEvent', {type:'mousePressed',x:760,y:420,button:'left',buttons:1,clickCount:1});
    await send('Input.dispatchMouseEvent', {type:'mouseMoved',x:820,y:460,button:'left',buttons:1});
    await send('Input.dispatchMouseEvent', {type:'mouseReleased',x:820,y:460,button:'left',buttons:0,clickCount:1});
    const after = await evaluate('({bh:__SE.bhInfo,deep:__SE.deep.info().camera})');
    assert(closeEnough(before.bh,after.bh), '隐藏黑洞视角被修改', {before,after});
    assert(before.deep.distance!==after.deep.distance && before.deep.yaw!==after.deep.yaw, '近景未接收真实滚轮与拖动', {before,after});
    await send('Input.dispatchKeyEvent', {type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
    await send('Input.dispatchKeyEvent', {type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
    const escaped = await evaluate('({bh:__SE.bhInfo,deep:__SE.deep.active})');
    assert(escaped.bh.active && !escaped.deep, 'Escape 同时退出了黑洞或未退出近景', escaped);
    const screenshot = await capture('shot184-bh-restored');
    await evaluate('(__SE.exitBH(),true)');
    return {before,after,escaped,screenshot};
  });
  if (!FAST) await test('M51连续相机轨迹录像', async () => {
    await openModel('m51');
    const recording = await evaluate(`new Promise((resolve,reject)=>{
      const canvas=__SE.renderer.domElement, stream=canvas.captureStream(30), parts=[];
      const mime=['video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm'].find(x=>MediaRecorder.isTypeSupported(x));
      if(!mime){stream.getTracks().forEach(t=>t.stop());reject(new Error('无可用WebM编码器'));return;}
      const recorder=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:4500000});
      const views=[],start=performance.now(), duration=8000;
      recorder.ondataavailable=e=>{if(e.data.size)parts.push(e.data)};
      recorder.onerror=e=>reject(new Error('录像失败 '+e));
      recorder.onstop=async()=>{try{stream.getTracks().forEach(t=>t.stop());const blob=new Blob(parts,{type:mime});
        window.__deepProbe.video=await new Promise((r,j)=>{const f=new FileReader();f.onload=()=>r(f.result);f.onerror=j;f.readAsDataURL(blob)});
        resolve({mime,bytes:blob.size,length:window.__deepProbe.video.length,views,elapsed:performance.now()-start});}catch(e){reject(e)}};
      recorder.start(500);
      function frame(t){try{const u=Math.min(1,(t-start)/duration),yaw=2*Math.PI*u,pitch=.20*Math.sin(2*Math.PI*u);
        const d=u<.5 ? 3.6*Math.pow(.35/3.6,2*u) : .35*Math.pow(3.6/.35,2*u-1);
        __SE.deep.setView({yaw,pitch,distance:d,target:[0,0,0]});views.push({u,yaw,pitch,distance:d});
        if(u<1)requestAnimationFrame(frame);else recorder.stop();}catch(e){recorder.stop();reject(e)}}
      requestAnimationFrame(frame);
    })`);
    const parts=[];for(let i=0;i<recording.length;i+=CHUNK)parts.push(await evaluate(`window.__deepProbe.video.slice(${i},${i+CHUNK})`));
    const data=parts.join(''), bytes=Buffer.from(data.slice(data.indexOf(',')+1),'base64');
    // 即使后续轨迹或大小断言失败，也先保存收到的非空字节作为诊断证据；不代表视频可解码。
    const file = bytes.length ? path.join(ROOT,`m51-orbit-approach-184-${RUN_ID}.webm`) : null;
    if (file) fs.writeFileSync(file,bytes,{flag:'wx'});
    const evidence = { ...recording, file, sha256: file ? createHash('sha256').update(bytes).digest('hex') : null,
      receivedBytes: bytes.length, note: '未检查视频可解码或逐帧视觉连续性；帧率随环境负载变化。' };
    assert(bytes.length===recording.bytes && bytes.length>10000 && recording.views.length>30,'录制视频为空或轨迹帧不足',evidence);
    assert(recording.views[0].u<.1 && recording.views.at(-1).u===1,'轨迹未覆盖完整时间段',evidence);
    return {file,sha256:evidence.sha256,bytes:bytes.length,mime:recording.mime,elapsed:recording.elapsed,frames:recording.views.length,
      path:'绕行一周，距离3.6→0.35→3.6',note:'实时浏览器画布录制；仅检查字节及轨迹，未检查视频可解码或逐帧视觉连续性。'};
  });
  if (FAST) report.tests.push({ name: 'M51连续相机轨迹录像', status: 'skip', reason: 'TEST_FAST=1' });
  if (FAST) report.tests.push({ name: '离线三个模型正面与零外部请求', status: 'skip', reason: 'TEST_FAST=1' });
  else await test('离线三个模型正面与零外部请求', async () => {
    const start = report.network.length;
    const ready = await load(FILE_URL, 'file'), models = [];
    await click('#deepModelBtn'); await modelInfo('47tuc');
    for (const id of IDS) {
      const info = await openModel(id);
      models.push({ id, info, panel: await panel(), screenshot: await capture(`shot184-${id}-offline-front`) });
    }
    await evaluate('(__SE.deep.close(),true)'); await frames(5);
    const network = report.network.slice(start);
    const external = network.filter(r => !/^(?:file|data|blob|about):/i.test(r.url));
    assert(!external.length, '离线入口发出外部请求', external);
    return { ready, models, requests: network.length, externalRequests: external };
  });
  await test('全程 console.error 与 WebGL 审计', async () => {
    const health = await glHealth();
    assert(report.errors.length === 0, '全程存在浏览器/网络/WebGL 错误', report.errors);
    return { errors: report.errors.length, health };
  });
}
function cleanup() {
  if (cleanupPromise) return cleanupPromise;
  cleanupPromise = (async () => {
    if (browser) {
      try { await browser.send('Browser.close'); }
      catch (error) { report.notes.push(`Browser.close 返回：${error.message}`); }
      browser.ws.close();
    }
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = await new Promise(resolve => {
        const timer = setTimeout(() => { child.removeListener('exit', onExit); resolve(false); }, 5000);
        function onExit() { clearTimeout(timer); resolve(true); }
        child.once('exit', onExit);
        if (child.exitCode !== null || child.signalCode !== null) onExit();
      });
      if (!exited) report.notes.push(`仅终止自建 Chrome PID ${child.pid}：${child.kill()}`);
    }
  })();
  return cleanupPromise;
}
function finish() {
  if (finished) return;
  finished = true;
  report.finishedAt = new Date().toISOString();
  if (fatal) report.fatal = { error: errorText(fatal), details: fatal.details };
  report.summary = { pass: report.tests.filter(t => t.status === 'pass').length,
    fail: report.tests.filter(t => t.status === 'fail').length, skip: report.tests.filter(t => t.status === 'skip').length,
    errors: report.errors.length };
  report.ok = !fatal && report.summary.fail === 0 && report.errors.length === 0;
  report.complete = report.ok && !FAST;
  fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2), { flag: 'wx' });
  console.log(`报告：${REPORT_FILE}`);
  console.log(`结果：${report.ok ? '通过' : '失败'}；通过 ${report.summary.pass}，失败 ${report.summary.fail}，跳过 ${report.summary.skip}${FAST ? '（调试模式，非完整验收）' : ''}`);
  process.exitCode = report.ok ? 0 : 1;
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
  fatal = new Error(`收到 ${signal}`);
  cleanup().then(() => { finish(); process.exit(signal === 'SIGINT' ? 130 : 143); })
    .catch(error => { console.error(errorText(error)); process.exit(1); });
});
(async () => {
  try { await main(); }
  catch (error) { fatal = error; console.error(errorText(error)); }
  finally {
    try { await cleanup(); } catch (error) { fatal ||= error; }
    finish();
  }
})();
