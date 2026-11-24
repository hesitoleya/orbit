'use strict';

// 独立、零依赖探针；要求 Node.js 22+。只在显式执行时启动自己的 Chrome。
// DEEP_DETAIL_URL 或首个参数指定 HTTP 页面，默认 http://127.0.0.1:8169/deep-detail.html。
// CHROME_PATH 可覆盖 Chrome 可执行文件；MAIN_URL 可选主入口；MAIN_FILE=0 可跳过离线主入口。
// 输出只写项目根目录；profile 只创建在 .workbuddy/probe-*，不复用、不扫描、不删除任何 profile。
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawn } = require('node:child_process');
const { performance } = require('node:perf_hooks');

const ROOT = path.resolve(__dirname, '..');
const URL_INPUT = process.env.DEEP_DETAIL_URL || process.argv[2] || 'http://127.0.0.1:8169/deep-detail.html';
const RUN = `${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}`;
const PREFIX = path.join(ROOT, `deep-detail-test-${RUN}`);
const LIMIT = 32 * 1024 * 1024;
/* 主场景首帧要编译着色器 + 建地形，单条 Runtime.evaluate 可能被主线程拖住数十秒；
   15s 会让「页面慢」被误报成「CDP 断连」。瓦片页各步骤本身有单独超时。 */
const COMMAND_MS = 45000;
const WAIT_MS = Number(process.env.TEST_TIMEOUT_MS || 60000);
const IDLE_MS = Math.max(1500, Number(process.env.IDLE_MS || 2000));
const report = {
  schema: 1, startedAt: new Date().toISOString(), node: process.version,
  url: URL_INPUT, tests: [], expectedErrors: [], unexpectedErrors: [], screenshots: [],
  notes: [
    'performance 是浏览器页面/CPU 时序与 CDP 指标，不代表 GPU 时间、GPU 显存或 GPU 性能。',
    'decodedBytes 是页面声明的解码图像缓存预算，不包含画布、浏览器进程及 GPU 内存。',
    '预算同时采集 info、原始 telemetry 及 CDP 网络并发；采样峰值不是连续内存审计。',
    '仅操作自建浏览器与 profile，结束不删除 profile，便于排查。'
  ],
  samples: [], measurements: [], network: [], browser: null,
  steps: [], cdp: { wsErrors: [], closes: [], lastRequest: null, pendingAtFailure: [] }
};
let browser, child, session, phase = '初始化', pageKind = 'deep', interception = null;
let fatal = null, sampleCount = 0, cleanupStarted = false;
const step = (label, details = {}) => {
  const entry = { at: new Date().toISOString(), phase, label, ...details };
  report.steps.push(entry);
  console.log(`[步骤] ${label}${Object.keys(details).length ? ` ${JSON.stringify(details)}` : ''}`);
};
const compact = value => {
  try {
    const text = JSON.stringify(value);
    return text.length > 4000 ? `${text.slice(0, 4000)}…` : value;
  } catch { return String(value); }
};
const errorDetails = error => ({
  message: error?.message || String(error),
  name: error?.name,
  stack: error?.stack,
  cause: error?.cause ? compact(error.cause) : undefined
});
const pendingRequests = new Map();
const listeners = new Set();
const held = new Map();
const injected = new Map();
const wasInjected = url => injected.get(url) === phase;
const asyncErrors = [];
const peaks = { decodedBytes: 0, inflight: 0, queued: 0, networkTiles: 0 };
const violations = [];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const isTile = url => /\/data\/deep-tiles\/[^/]+\/[^/]+\/\d+\/\d+_\d+\.png(?:[?#]|$)/.test(url);
const isManifest = url => /\/data\/deep-tiles\/[^/]+\/manifest\.json(?:[?#]|$)/.test(url);
const isData = url => /\/data\/(?:deep-tiles|hd)\//.test(url);
const assert = (ok, message, details) => {
  if (!ok) { const error = new Error(message); error.details = details; throw error; }
};
const errorText = error => error && (error.stack || error.message) || String(error);
function expected(kind, data) { report.expectedErrors.push({ phase, kind, ...data }); }
function unexpected(kind, data) { report.unexpectedErrors.push({ phase, kind, ...data }); }

class CDP {
  constructor(ws) {
    this.ws = ws; this.next = 0; this.pending = new Map(); this.failed = null;
    ws.addEventListener('message', event => {
      let message;
      try { message = JSON.parse(event.data); } catch (error) { this.fail(error, 'parse'); return; }
      if (message.id) {
        const p = this.pending.get(message.id);
        if (!p) return;
        clearTimeout(p.timer); this.pending.delete(message.id);
        if (message.error) p.reject(new Error(`${p.method}: ${JSON.stringify(message.error)}`));
        else p.resolve(message.result || {});
      } else for (const callback of listeners) {
        try { callback(message); } catch (error) { asyncErrors.push(errorText(error)); }
      }
    });
    ws.addEventListener('close', event => {
      const error = new Error(`CDP 通道关闭 code=${event.code} reason=${event.reason || '无'}`);
      report.cdp.closes.push({ at: new Date().toISOString(), code: event.code, reason: event.reason, phase, pending: [...this.pending.values()].map(p => ({ id: p.id, method: p.method })) });
      this.fail(error, 'close');
    });
    ws.addEventListener('error', event => {
      const error = new Error(`CDP WebSocket 错误${event.message ? `：${event.message}` : ''}`);
      report.cdp.wsErrors.push({ at: new Date().toISOString(), phase, event: compact(event), pending: [...this.pending.values()].map(p => ({ id: p.id, method: p.method })) });
      this.fail(error, 'error');
    });
  }
  fail(error, source) {
    if (!this.failed) {
      this.failed = error;
      report.cdp.lastFailure = { source, ...errorDetails(error), phase };
      report.cdp.pendingAtFailure = [...this.pending.values()].map(p => ({ id: p.id, method: p.method, params: compact(p.params), sessionId: p.sessionId }));
    }
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(error); }
    this.pending.clear();
  }
  send(method, params = {}, sessionId) {
    report.cdp.lastRequest = { at: new Date().toISOString(), phase, method, params: compact(params), sessionId };
    return new Promise((resolve, reject) => {
      if (this.ws.readyState !== WebSocket.OPEN) return reject(new Error(`CDP 未连接：${method}`));
      const id = ++this.next;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP 超时：${method}`)); }, COMMAND_MS);
      this.pending.set(id, { id, resolve, reject, timer, method, params, sessionId });
      try { this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { ws.close(); reject(new Error('连接 CDP 超时')); }, COMMAND_MS);
      ws.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('连接 CDP 失败')); }, { once: true });
    });
    return new CDP(ws);
  }
}
const send = (method, params) => browser.send(method, params, session);
async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}
async function until(label, predicate, timeout = WAIT_MS) {
  const started = performance.now();
  let last;
  while (performance.now() - started < timeout) {
    if (asyncErrors.length) throw new Error(`异步 CDP 处理失败：${asyncErrors.join('; ')}`);
    last = await predicate();
    if (last) return last;
    await delay(80);
  }
  throw new Error(`等待条件超时：${label}；最近值=${JSON.stringify(last)}`);
}
async function launch() {
  assert(typeof WebSocket === 'function', '需要带原生 WebSocket 的 Node.js 22+');
  assert(fs.statSync(ROOT).isDirectory(), '项目根目录不存在');
  const parent = path.join(ROOT, '.workbuddy');
  if (!fs.existsSync(parent)) fs.mkdirSync(parent);
  assert(fs.statSync(parent).isDirectory(), '.workbuddy 不是目录');
  // mkdtemp 仅在已确认的项目父目录创建自己的随机目录。
  const profile = fs.mkdtempSync(path.join(parent, 'probe-deep-detail-'));
  const candidates = [process.env.CHROME_PATH,
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google/Chrome/Application/chrome.exe'),
    process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Google/Chrome/Application/chrome.exe')].filter(Boolean);
  const chrome = candidates.find(file => fs.existsSync(file));
  assert(chrome, '未找到 Chrome；请设置 CHROME_PATH（只检查固定可执行文件路径，不扫描个人目录）');
  const args = ['--headless=new', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0',
    `--user-data-dir=${profile}`, '--window-size=1280,900', '--no-first-run', '--no-default-browser-check',
    '--disable-background-networking', '--disable-component-update', 'about:blank'];
  if (process.env.ORBIT_GPU === '0') args.unshift('--enable-unsafe-swiftshader', '--use-angle=swiftshader');
  report.launch = { chrome, profile, args, softwareRenderingRequested: process.env.ORBIT_GPU === '0' };
  child = spawn(chrome, args, { stdio: ['ignore', 'ignore', 'pipe'], detached: false, windowsHide: true });
  report.launch.pid = child.pid;
  let stderr = '';
  child.stderr.on('data', chunk => {
    stderr = (stderr + chunk.toString()).slice(-16000);
    report.launch.chromeStderrTail = stderr;
  });
  child.once('error', error => {
    report.launch.chromeError = errorDetails(error);
    step('Chrome 进程错误', report.launch.chromeError);
  });
  child.once('exit', (code, signal) => {
    report.launch.chromeExit = { at: new Date().toISOString(), code, signal, stderrTail: stderr };
    step('Chrome 进程退出', report.launch.chromeExit);
  });
  const endpoint = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Chrome 未报告 DevTools 地址：${stderr.slice(-3000)}`)), COMMAND_MS);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', (code, signal) => { clearTimeout(timer); reject(new Error(`Chrome 提前结束 ${code}/${signal}；stderr=${stderr.slice(-3000)}`)); });
    const checkEndpoint = () => {
      const match = stderr.match(/DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[^\s]+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    };
    child.stderr.on('data', checkEndpoint);
    checkEndpoint();
  });
  report.launch.endpoint = endpoint;
  step('Chrome 已启动', { pid: child.pid, endpoint });
  browser = await CDP.connect(endpoint);
  step('CDP 已连接');
  report.browser = await browser.send('Browser.getVersion');
  try { report.gpu = (await browser.send('SystemInfo.getInfo')).gpu; }
  catch (error) { report.notes.push(`未获取 GPU 元数据：${error.message}`); }
  const target = await browser.send('Target.createTarget', { url: 'about:blank' });
  session = (await browser.send('Target.attachToTarget', { targetId: target.targetId, flatten: true })).sessionId;
  report.launch.targetId = target.targetId;
  listeners.add(onEvent);
  await Promise.all(['Page.enable', 'Runtime.enable', 'Log.enable', 'Network.enable', 'Performance.enable'].map(method => send(method)));
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Network.setBypassServiceWorker', { bypass: true });
  // 缺省 favicon 与业务无关；为测试页使用内嵌空图标，避免简单静态服务器额外产生404。
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `document.addEventListener('DOMContentLoaded',()=>{if(!document.querySelector('link[rel~="icon"]')){const l=document.createElement('link');l.rel='icon';l.href='data:,';document.head.appendChild(l);}},{once:true});` });
}
function onEvent(event) {
  if (event.sessionId !== session) return;
  const p = event.params || {};
  if (event.method === 'Network.requestWillBeSent') {
    const item = { id: p.requestId, url: p.request.url, phase, pageKind, at: p.timestamp, tile: isTile(p.request.url), data: isData(p.request.url) };
    pendingRequests.set(p.requestId, item); report.network.push(item);
    const count = [...pendingRequests.values()].filter(r => r.tile).length;
    if (count > peaks.networkTiles) { peaks.networkTiles = count; peaks.networkTilesPhase = phase; peaks.networkTilesUrls = [...pendingRequests.values()].filter(r => r.tile).map(r => r.url.split('/').slice(-3).join('/')); }
  } else if (event.method === 'Network.responseReceived') {
    const item = pendingRequests.get(p.requestId);
    if (item) { item.status = p.response.status; item.mimeType = p.response.mimeType; }
    if (p.response.status >= 400) {
      const data = { url: p.response.url, status: p.response.status, requestId: p.requestId };
      if (wasInjected(p.response.url)) expected('注入 HTTP 错误', data);
      else unexpected('HTTP 错误', data);
    }
  } else if (event.method === 'Network.loadingFinished' || event.method === 'Network.loadingFailed') {
    const item = pendingRequests.get(p.requestId);
    if (item) { item.finishedAt = p.timestamp; item.encodedDataLength = p.encodedDataLength; }
    if (event.method === 'Network.loadingFailed') {
      if (item) { item.failed = p.errorText; item.canceled = Boolean(p.canceled); }
      const data = { url: item?.url, error: p.errorText, canceled: p.canceled, requestId: p.requestId };
      if (p.canceled || p.errorText === 'net::ERR_ABORTED') expected('取消请求', data);
      else if (item && wasInjected(item.url)) expected('注入请求失败', data);
      else unexpected('网络失败', data);
    }
    pendingRequests.delete(p.requestId);
  } else if (event.method === 'Runtime.exceptionThrown') {
    unexpected('运行时异常', { details: p.exceptionDetails });
  } else if (event.method === 'Runtime.consoleAPICalled' && p.type === 'error') {
    unexpected('console.error', { text: p.args.map(a => a.value ?? a.description ?? a.type).join(' ') });
  } else if (event.method === 'Log.entryAdded' && p.entry.level === 'error') {
    const entry = p.entry;
    if (wasInjected(entry.url) && /404|Failed to load resource/i.test(entry.text)) expected('注入资源日志', { entry });
    else unexpected('浏览器错误日志', { entry });
  } else if (event.method === 'Fetch.requestPaused') {
    handlePaused(p).catch(error => asyncErrors.push(errorText(error)));
  } else if (event.method === 'Page.javascriptDialogOpening') {
    report.dialogs ||= []; report.dialogs.push({ phase, ...p });
    send('Page.handleJavaScriptDialog', { accept: true }).catch(error => asyncErrors.push(errorText(error)));
  }
}
async function handlePaused(p) {
  const rule = interception;
  if (rule?.kind === 'hold' && isTile(p.request.url)) {
    held.set(p.requestId, { ...p, phase }); rule.hits++; return;
  }
  // 清单持续缺失；瓦片仅选一个 URL 持续 404，允许应用做有界重试，而不是误把重试当失败。
  const hit = rule && ((rule.kind === 'manifest404' && isManifest(p.request.url)) ||
    (rule.kind === 'tile404' && isTile(p.request.url) && (!rule.url || rule.url === p.request.url)));
  if (hit) {
    rule.hits++; rule.url = p.request.url; injected.set(p.request.url, phase);
    expected('主动注入', { kindOfFault: rule.kind, url: p.request.url, networkId: p.networkId });
    await send('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: 404,
      responseHeaders: [{ name: 'Content-Type', value: 'text/plain' }, { name: 'Cache-Control', value: 'no-store' }],
      body: Buffer.from('测试探针注入的 404').toString('base64') });
  } else await send('Fetch.continueRequest', { requestId: p.requestId });
}
async function setInterception(kind) {
  interception = { kind, hits: 0 };
  await send('Fetch.enable', { patterns: [{ urlPattern: '*data/deep-tiles/*', requestStage: 'Request' }] });
  return interception;
}
async function releaseInterception() {
  interception = null;
  for (const [requestId, p] of held) {
    try { await send('Fetch.continueRequest', { requestId }); }
    catch (error) {
      if (/Invalid InterceptionId|Invalid interception|Invalid Fetch|not found|No resource with given identifier/i.test(error.message)) {
        expected('已取消的拦截请求', { url: p.request.url, error: error.message });
      } else throw error;
    }
    held.delete(requestId);
  }
  await send('Fetch.disable');
  injected.clear();
}
async function info() {
  const value = await evaluate(`(() => {
    const api = window.__DEEP_DETAIL__; if (!api) return null;
    const i = api.info; const c = document.getElementById('view');
    let telemetry = i.telemetry || api.telemetry || null;
    if (typeof telemetry === 'function') telemetry = telemetry.call(api);
    if (!telemetry && typeof i.requests === 'number') telemetry = {requests:i.requests,completed:i.completed,evictions:i.evictions,cancelled:i.cancelled,maxActive:i.maxActive};
    return { ...i, telemetry, settled: typeof api.settled === 'function' ? api.settled() : i.settled,
      devicePixelRatio, canvas: c ? { width:c.width, height:c.height, cssWidth:c.clientWidth, cssHeight:c.clientHeight } : null,
      statusText:document.getElementById('status')?.textContent, errorText:document.getElementById('error')?.textContent };
  })()`);
  if (!value) return null;
  for (const key of ['decodedBytes', 'inflight', 'queued']) {
    if (Number.isFinite(value[key])) peaks[key] = Math.max(peaks[key], value[key]);
  }
  if (!Number.isFinite(value.decodedBytes) || value.decodedBytes > LIMIT || value.budget !== LIMIT || !Number.isFinite(value.inflight) || value.inflight > 4 || value.inflight < 0 || (value.telemetry?.maxActive ?? 0) > 4) {
    if (violations.length < 100) violations.push({ phase, info: value });
  }
  if (++sampleCount % 12 === 0 && report.samples.length < 1000) report.samples.push({ phase, at: new Date().toISOString(), info: value });
  return value;
}
function tiled(i) { return i && i.mode === '按视野分级加载' && Boolean(i.sourceHash) && i.width > 0 && i.cache > 0; }
async function ready(target) {
  let quietAt = 0, count = -1;
  return until(`${target} 真实瓦片加载`, async () => {
    const i = await info(); const currentCount = report.network.length;
    if (!tiled(i) || i.target !== target || i.inflight !== 0 || i.queued !== 0 || i.settled === false) { quietAt = 0; return false; }
    if (!quietAt || count !== currentCount) { quietAt = performance.now(); count = currentCount; }
    return performance.now() - quietAt >= 250 ? i : false;
  });
}
async function navigate(url) {
  const r = await send('Page.navigate', { url });
  assert(!r.errorText, `页面导航失败：${r.errorText}`, r);
  await until('页面 DOM 完成', () => evaluate('document.readyState === "complete"'));
}
async function rect(selector) {
  const r = await evaluate(`(() => { const el=document.querySelector(${JSON.stringify(selector)}); if(!el)return null;
    const r=el.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2,width:r.width,height:r.height}; })()`);
  assert(r && r.width > 0 && r.height > 0, `控件不可见：${selector}`, r);
  return r;
}
async function click(selector) {
  const { x, y } = await rect(selector);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
}
async function selectTarget(name) {
  // 原生 select 的弹出菜单在不同平台无稳定坐标；只在这里设置值并派发真实页面监听的 change。
  await evaluate(`(() => {const s=document.getElementById('target');s.value=${JSON.stringify(name)};s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await until(`切换目标 ${name}`, async () => (await info())?.target === name);
}
async function wheel(deltaY) {
  const { x, y } = await rect('#view');
  await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY });
}
async function drag() {
  const { x, y, width, height } = await rect('#view');
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
  for (let n = 1; n <= 5; n++) await send('Input.dispatchMouseEvent', {
    type: 'mouseMoved', x: x + width * 0.18 * n / 5, y: y + height * 0.12 * n / 5, button: 'left', buttons: 1
  });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x + width * 0.18, y: y + height * 0.12, button: 'left', buttons: 0, clickCount: 1 });
}
async function screen(tag) {
  const file = `${PREFIX}-${tag}.png`;
  step('截图开始', { tag });
  const viewport = await evaluate(`(() => ({ innerWidth, innerHeight, devicePixelRatio, visualWidth: visualViewport?.width, visualHeight: visualViewport?.height }))()`);
  assert(viewport.innerWidth > 0 && viewport.innerHeight > 0 && viewport.devicePixelRatio > 0, '截图前 viewport 无效', viewport);
  const physicalWidth = viewport.innerWidth * viewport.devicePixelRatio;
  const physicalHeight = viewport.innerHeight * viewport.devicePixelRatio;
  const scale = Math.min(1, 1280 / Math.max(physicalWidth, physicalHeight));
  const image = await send('Page.captureScreenshot', {
    format: 'png', captureBeyondViewport: false,
    clip: { x: 0, y: 0, width: viewport.innerWidth, height: viewport.innerHeight, scale }
  });
  const bytes = Buffer.byteLength(image.data, 'base64');
  fs.writeFileSync(file, Buffer.from(image.data, 'base64'));
  const after = await evaluate(`(() => ({ innerWidth, innerHeight, devicePixelRatio }))()`);
  assert(after.innerWidth === viewport.innerWidth && after.innerHeight === viewport.innerHeight && after.devicePixelRatio === viewport.devicePixelRatio,
    '截图过程中 viewport 发生变化', { before: viewport, after });
  const screenshot = { phase, file, viewport, scale, physicalWidth, physicalHeight, bytes, encodedBytes: image.data.length };
  report.screenshots.push(screenshot);
  step('截图完成', { tag, scale, bytes, viewport: `${viewport.innerWidth}x${viewport.innerHeight}@${viewport.devicePixelRatio}` });
  return file;
}
async function nonblank() {
  const pixels = await evaluate(`(() => {const c=document.getElementById('view'),ctx=c.getContext('2d');const colors=new Set();
    for(let y=1;y<24;y++)for(let x=1;x<24;x++){const p=ctx.getImageData(Math.floor(c.width*x/24),Math.floor(c.height*y/24),1,1).data;colors.add(Array.from(p).join(','));}
    return {sampledColors:colors.size,width:c.width,height:c.height};})()`);
  assert(pixels.sampledColors > 4, '画布采样未发现有效影像', pixels);
  return pixels;
}
async function observeIdle(duration = IDLE_MS) {
  const start = report.network.filter(r => r.data).length;
  const initialInfo = await info(); const initialTelemetry = initialInfo?.telemetry?.requests;
  const t = performance.now(); let count = 0;
  await until('静置观察窗口完成', async () => {
    const i = await info(); count++;
    assert(i && i.inflight === 0 && i.queued === 0 && i.settled !== false, '静置期间重新产生任务', i);
    if (Number.isFinite(initialTelemetry)) assert(i.telemetry?.requests === initialTelemetry, '静置期间 telemetry 请求数增长', { initialTelemetry, info: i });
    assert(report.network.filter(r => r.data).length === start, '静置期间资源请求数增长', { before: start, after: report.network.filter(r => r.data).length });
    return performance.now() - t >= duration;
  }, duration + COMMAND_MS);
  return { observedMs: performance.now() - t, samples: count, requestsBefore: start, requestsAfter: report.network.filter(r => r.data).length };
}
async function measure(label, action) {
  const before = await send('Performance.getMetrics'); const started = performance.now();
  const result = await action();
  const after = await send('Performance.getMetrics');
  const old = Object.fromEntries(before.metrics.map(m => [m.name, m.value]));
  const delta = Object.fromEntries(after.metrics.filter(m => /Duration|Count/.test(m.name)).map(m => [m.name, m.value - (old[m.name] || 0)]));
  report.measurements.push({ label, wallMs: performance.now() - started, cdpDelta: delta,
    note: '含资源等待与 CDP 往返；不是 GPU 计时，不作为通过阈值。' });
  return result;
}
async function test(name, fn) {
  phase = name; const started = performance.now(); const errorsBefore = report.unexpectedErrors.length;
  try {
    const details = await fn();
    const newErrors = report.unexpectedErrors.slice(errorsBefore);
    assert(!newErrors.length, '此用例出现非预期浏览器错误', newErrors);
    report.tests.push({ name, status: 'pass', durationMs: performance.now() - started, details });
    console.log(`通过：${name}`);
  } catch (error) {
    report.tests.push({ name, status: 'fail', durationMs: performance.now() - started, error: errorText(error), details: error.details });
    console.error(`失败：${name}：${error.message}`);
    try { await screen(`failure-${report.tests.length}`); } catch (captureError) { report.notes.push(`失败截图未获取：${captureError.message}`); }
  }
}
async function main() {
  const parsed = new URL(URL_INPUT);
  assert(/^https?:$/.test(parsed.protocol), '瓦片测试要求 HTTP(S) 页面，file 主入口另测');
  assert(Number.isFinite(WAIT_MS) && WAIT_MS >= 1000 && Number.isFinite(IDLE_MS), '测试等待参数必须是有效毫秒数');
  await launch();
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  for (const target of ['m51', 'm42', '47tuc', 'ngc1291']) {
    await test(`真实瓦片-${target}`, async () => {
      const url = new URL(URL_INPUT); url.searchParams.set('target', target);
      const state = await measure(`首屏-${target}`, async () => { await navigate(url.href); return ready(target); });
      const requests = report.network.filter(r => r.phase === phase && r.tile && r.status === 200);
      assert(requests.length > 0, '没有实际成功的瓦片网络请求', state);
      assert(state.failed === 0 && state.complete !== false, '正常目标有失败或缺失瓦片', state);
      if (target === 'ngc1291') {
        const provenance = await evaluate(`({credit:document.querySelector('#credit').textContent,source:document.querySelector('#source').href})`);
        assert(provenance.credit.includes('ESA/Euclid') && provenance.credit.includes('CC BY-SA 3.0 IGO') && provenance.source.includes('esa.int'), 'Euclid影像来源或许可未显示', provenance);
        assert(state.sourceHash === 'eda67fec4c08c627361ffab59f56b230b23df645b2f4f1a9bd62ce120fe3445d', 'Euclid图像来源hash不匹配', state);
      }
      const pixels = await nonblank(); await screen(`tiles-${target}`);
      return { info: state, successfulTiles: requests.length, pixels, idle: await observeIdle() };
    });
    await test(`按钮滚轮缩放与平移-${target}`, async () => {
      await ready(target); await click('#fit'); const before = await ready(target);
      // 先缩小确保存在可提升 LOD 的空间，避免大视口首屏已经位于最高层。
      for (let n = 0; n < 8; n++) await click('#minus');
      const low = await until('缩小后的较低层级', async () => { const i = await info(); return i?.level < before.level && i.inflight === 0 && i.queued === 0 && i.settled !== false ? i : false; });
      await wheel(-120);
      const wheeled = await until('真实滚轮改变缩放比例', async () => {
        const i = await info();
        return Number.isFinite(low.scale) ? (i?.scale > low.scale ? i : false) : i;
      });
      for (let n = 0; n < 9; n++) await click('#plus');
      const high = await until('放大后 LOD 上升', async () => { const i = await info(); return i?.level > low.level && i.inflight === 0 && i.queued === 0 && i.settled !== false ? i : false; });
      await drag(); const panned = await ready(target);
      if (Number.isFinite(high.cx)) assert(panned.cx !== high.cx || panned.cy !== high.cy, '真实拖动没有改变视野中心', { high, panned });
      await screen(`zoom-${target}`);
      return { before, low, wheeled, high, panned, pixels: await nonblank(), idle: await observeIdle() };
    });
  }
  await test('快速切换取消旧目标请求', async () => {
    await setInterception('hold');
    try {
      await selectTarget('m51');
      await until('旧目标瓦片已被拦截', () => held.size > 0);
      const initial = await info(); const oldIds = [...held.values()].map(p => p.networkId).filter(Boolean);
      const mark = report.network.length;
      await selectTarget('m42'); await selectTarget('47tuc'); await selectTarget('m42');
      await until('旧目标请求已取消', async () => {
        await info();
        return report.network.some(r => oldIds.includes(r.id) && r.canceled);
      }, Math.min(WAIT_MS, 15000));
      await releaseInterception();
      const recovered = await ready('m42');
      assert(recovered.target === 'm42', '旧目标结果覆盖了新目标', recovered);
      if (Number.isFinite(initial.telemetry?.cancelled)) assert(recovered.telemetry?.cancelled > initial.telemetry.cancelled, 'telemetry 未记录旧请求取消', { initial, recovered });
      await observeIdle(); await screen('rapid-switch-recovered');
      return { initial, recovered, canceled: report.network.filter(r => oldIds.includes(r.id) && r.canceled), requestsAfterSwitch: report.network.slice(mark).filter(r => r.data).length };
    } finally { await releaseInterception(); }
  });
  for (const viewport of [
    { width: 1920, height: 1080, deviceScaleFactor: 2, name: 'DPR2-物理4K' },
    { width: 3840, height: 2160, deviceScaleFactor: 2, name: 'CSS4K-DPR2压力' }
  ]) {
    await test(`32MiB与4路预算-${viewport.name}`, async () => {
      await send('Emulation.setDeviceMetricsOverride', { width: viewport.width, height: viewport.height, deviceScaleFactor: viewport.deviceScaleFactor, mobile: false });
      const startViolation = violations.length;
      const states = [];
      for (const target of ['m51', 'm42', '47tuc', 'ngc1291']) {
        await selectTarget(target); await ready(target); await click('#native'); await ready(target);
        await drag(); const state = await ready(target); states.push(state);
        assert(state.devicePixelRatio === 2, 'DPR2 设置未生效', state);
        assert(state.canvas.width === Math.round(state.canvas.cssWidth * 2), '画布未以 DPR2 创建', state);
        await observeIdle();
      }
      assert(violations.length === startViolation, '预算或并发越界', violations.slice(startViolation));
      await screen(`budget-${viewport.width}`);
      return { viewport, states, peaks: { ...peaks }, violations: violations.slice(startViolation) };
    });
  }
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await test('manifest缺失降级与恢复', async () => {
    const rule = await setInterception('manifest404');
    let fallback;
    try {
      await selectTarget('m51');
      fallback = await until('底图降级完成', async () => { const i = await info(); return i?.target === 'm51' && /回退|降级/.test(i.mode) && i.inflight === 0 && i.settled !== false ? i : false; });
      assert(rule.hits >= 1 && rule.hits <= 3, 'manifest 缺失未命中或重试超过3次', rule);
      assert(!fallback.sourceHash && fallback.cache === 0, 'manifest 失败后仍声称瓦片模式', fallback);
      await nonblank(); await screen('manifest-fallback'); await observeIdle();
    } finally { await releaseInterception(); }
    await selectTarget('m51'); const recovered = await ready('m51');
    await screen('manifest-recovered');
    return { injected: rule, fallback, recovered, pixels: await nonblank() };
  });
  await test('单tile404保留影像且静置不重试并恢复', async () => {
    const rule = await setInterception('tile404');
    let degraded, idle;
    try {
      await selectTarget('m42');
      let quietAt = 0, lastHits = 0;
      degraded = await until('单块失败且有界重试结束', async () => {
        const i = await info();
        assert(rule.hits <= 3, '单 tile 重试超过3次', rule);
        if (!tiled(i) || i.target !== 'm42' || i.failed < 1 || i.inflight !== 0 || i.queued !== 0 || i.settled === false) { quietAt = 0; return false; }
        if (!quietAt || lastHits !== rule.hits) { quietAt = performance.now(); lastHits = rule.hits; }
        return performance.now() - quietAt >= 2200 ? i : false;
      });
      assert(rule.hits >= 1 && rule.hits <= 3, '单 tile 404 注入未命中或无界重试', rule);
      await nonblank(); await screen('single-tile-404');
      // 容许最多3次有界重试，结束后跨过旧版15秒冷却期观察，不接受静置请求循环。
      idle = await observeIdle(16500);
    } finally { await releaseInterception(); }
    await selectTarget('m42'); const recovered = await ready('m42');
    assert(recovered.failed === 0, '恢复后残留失败状态', recovered);
    await screen('single-tile-recovered');
    return { injected: rule, degraded, idle, recovered, pixels: await nonblank() };
  });
  await test('深空页面全程资源与错误审计', async () => {
    assert(!violations.length, '曾观察到缓存预算/调度并发不合格', violations);
    assert(peaks.networkTiles <= 4, 'CDP 观察到同时在途瓦片超过4路', peaks);
    assert(!report.unexpectedErrors.length, '存在非预期错误', report.unexpectedErrors);
    assert(!asyncErrors.length, '存在异步协议错误', asyncErrors);
    return { peaks, expectedErrors: report.expectedErrors.length, unexpectedErrors: report.unexpectedErrors.length };
  });
  if (process.env.MAIN_URL) {
    await test('可选HTTP主入口回归', async () => {
      pageKind = 'main';
      await navigate(new URL(process.env.MAIN_URL).href);
      const state = await until('主入口 __SE 与 deepDetailBtn', () => evaluate(`(() => {const b=document.getElementById('deepDetailBtn');return window.__SE && b ? {se:true,button:true,disabled:b.disabled,handler:typeof b.onclick,url:location.href}:false;})()`));
      assert(state.handler === 'function' && !state.disabled, '深空按钮未绑定或禁用', state);
      const targetsBefore = new Set((await browser.send('Target.getTargets')).targetInfos.map(t => t.targetId));
      await click('#deepDetailBtn');
      const opened = await until('主入口按钮打开深空页面', async () => {
        const targets = (await browser.send('Target.getTargets')).targetInfos;
        return targets.find(t => !targetsBefore.has(t.targetId) && /\/deep-detail\.html(?:[?#]|$)/.test(t.url));
      });
      await browser.send('Target.closeTarget', { targetId: opened.targetId });
      await screen('main-entry'); return { state, opened };
    });
  } else report.tests.push({ name: '可选HTTP主入口回归', status: 'skip', reason: '未提供 MAIN_URL' });
  const mainFile = process.env.MAIN_FILE === '0' ? null : path.resolve(process.env.MAIN_FILE || path.join(ROOT, 'space.html'));
  if (mainFile) {
    await test('file主入口存在并可初始化', async () => {
      assert(fs.existsSync(mainFile) && fs.statSync(mainFile).isFile(), '离线主入口文件不存在', { mainFile });
      pageKind = 'file-main'; await navigate(pathToFileURL(mainFile).href);
      const state = await until('离线主场景 __SE 初始化', () => evaluate(`window.__SE ? {se:true,button:!!document.getElementById('deepDetailBtn'),readyState:document.readyState,url:location.href}:false`));
      /* 离线单文件把贴图内联成 data: URL，个别资源可能一直留在 CDP 的 pending 表里
         （不产生网络流量）。这里只要求「没有真正的网络请求」且 __SE 已就绪，
         不把 data: 残留当成页面失败。 */
      const settle = await until('离线页面资源加载结束', () => {
        const live = [...pendingRequests.values()].filter(r => r.pageKind === 'file-main'
          && !/^(data|blob):/.test(r.url));
        return live.length === 0 ? { pending: 0 } : false;
      }, 30000).catch(() => ({ pending: [...pendingRequests.values()].filter(r => r.pageKind === 'file-main').length, timedOut: true }));
      await screen('file-main'); return { ...state, settle };
    });
  } else report.tests.push({ name: 'file主入口存在并可初始化', status: 'skip', reason: 'MAIN_FILE=0' });
}
async function cleanup() {
  if (cleanupStarted) return;
  cleanupStarted = true;
  if (browser) {
    try { await browser.send('Browser.close'); }
    catch (error) { report.notes.push(`Browser.close：${error.message}`); }
    browser.ws.close();
  }
  if (child && child.exitCode === null && child.signalCode === null) {
    const exited = await new Promise(resolve => {
      const timer = setTimeout(() => { child.removeListener('exit', onExit); resolve(false); }, 5000);
      function onExit() { clearTimeout(timer); resolve(true); }
      child.once('exit', onExit);
      if (child.exitCode !== null || child.signalCode !== null) onExit();
    });
    if (!exited) {
      // 只终止本探针 spawn 返回的进程，不使用进程名匹配，也不触碰其他 profile。
      const killed = child.kill();
      report.notes.push(`Chrome 未及时退出，已对自有 PID ${child.pid} 发送终止：${killed}`);
    }
  }
}
function finish() {
  report.finishedAt = new Date().toISOString(); report.peaks = peaks;
  report.violations = violations; report.asyncErrors = asyncErrors;
  if (fatal) report.fatal = errorText(fatal);
  report.summary = { pass: report.tests.filter(t => t.status === 'pass').length,
    fail: report.tests.filter(t => t.status === 'fail').length, skip: report.tests.filter(t => t.status === 'skip').length,
    expectedErrors: report.expectedErrors.length, unexpectedErrors: report.unexpectedErrors.length };
  report.ok = !fatal && report.summary.fail === 0 && report.summary.unexpectedErrors === 0 && !asyncErrors.length && !violations.length;
  fs.writeFileSync(`${PREFIX}.json`, JSON.stringify(report, null, 2));
  console.log(`JSON 报告：${PREFIX}.json`);
  console.log(`结果：${report.ok ? '通过' : '失败'}；通过 ${report.summary.pass}，失败 ${report.summary.fail}，跳过 ${report.summary.skip}`);
  process.exitCode = report.ok ? 0 : 1;
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
  fatal = new Error(`收到 ${signal}`);
  cleanup().then(() => { finish(); process.exit(signal === 'SIGINT' ? 130 : 143); }).catch(error => { console.error(errorText(error)); process.exit(1); });
});
(async () => {
  try { await main(); }
  catch (error) { fatal = error; console.error(errorText(error)); }
  finally {
    try { await cleanup(); } catch (error) { fatal ||= error; report.notes.push(`清理失败：${errorText(error)}`); }
    finish();
  }
})();
