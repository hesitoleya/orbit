'use strict';
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const base = process.env.ORBIT_TEST_URL || 'http://127.0.0.1:8169/index.html?auto=0&q=low';
const port = Number(process.env.CDP_PORT || 19484);
const chrome = process.env.CHROME_PATH || path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-ledger-faults-'));
const proc = spawn(chrome, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--window-size=1280,720', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--no-first-run', 'about:blank'], { stdio: 'ignore' });
const report = { url: base, time: new Date().toISOString(), scope: '独立 Worker 故障注入：geo 请求 ID、重复及未知响应、fatal 和 postMessage 异常；不覆盖其他应用功能', coverage: {}, failures: [], scenarios: {} };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
let ws, seq = 0, documentResponse;
const pending = new Map();

const probe = `(() => {
  const NativeWorker = window.Worker;
  const p = window.__faultProbe = { instance: Math.random().toString(36).slice(2), sent: [], received: [], held: [], workers: [], mode: 'normal', injected: [] };
  window.Worker = class extends NativeWorker {
    constructor(...args) {
      super(...args); this.testId = p.workers.length + 1; p.workers.push(this);
      this.addEventListener('message', e => {
        if (e.data && e.data.requestId != null) p.received.push({ worker: this.testId, id: e.data.requestId, task: e.data.task === 'err' ? e.data.sourceTask : (e.data.task || 'geo') });
      });
    }
    postMessage(data, ...args) {
      if (!data) return super.postMessage(data, ...args);
      const task = data.task || 'geo';
      const item = { worker: this.testId, id: data.requestId, key: data.key, task, disposition: p.mode };
      p.sent.push(item);
      if (task !== 'geo') return super.postMessage(data, ...args);
      if (p.mode === 'throw') { p.mode = 'hold'; p.injected.push('throw'); throw new Error('injected synchronous postMessage failure'); }
      if (p.mode === 'hold') { p.held.push(item); return; }
      return super.postMessage(data, ...args);
    }
  };
  p.deliver = (worker, data) => { const w = p.workers[worker - 1]; if (w && w.onmessage) w.onmessage({ data }); };
  p.error = worker => { const w = p.workers[worker - 1]; if (w && w.onerror) { p.injected.push('fatal'); w.onerror({ message: 'injected fatal worker error' }); } };
})();`;

async function run() {
  const expected = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'));
  const response = await fetch(base, { cache: 'no-store' });
  const actual = Buffer.from(await response.arrayBuffer());
  report.document = { status: response.status, servedHash: hash(actual), localHash: hash(expected) };
  if (!response.ok || !actual.equals(expected)) throw Error('服务器响应与 public/index.html 不一致');
  const expectedApp = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app.js'));
  const appResponse = await fetch(new URL('./js/app.js', base), { cache: 'no-store' });
  const actualApp = Buffer.from(await appResponse.arrayBuffer());
  report.app = { status: appResponse.status, servedHash: hash(actualApp), localHash: hash(expectedApp) };
  if (!appResponse.ok || !actualApp.equals(expectedApp)) throw Error('服务器响应与 public/js/app.js 不一致');
  let targets;
  for (let i = 0; i < 100; i++) {
    try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); break; } catch { await sleep(100); }
  }
  if (!targets) throw Error('Chrome 调试接口不可用');
  ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.method === 'Network.responseReceived' && m.params.type === 'Document') documentResponse = m.params.response;
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(Error(JSON.stringify(m.error))) : p.resolve(m.result); }
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
  const ev = async expression => { const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Network.setBypassServiceWorker', { bypass: true });
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: probe });
  async function load() {
    documentResponse = null;
    await send('Page.navigate', { url: base });
    for (let i = 0; i < 240; i++) {
      await sleep(500);
      try {
        if (await ev('!!window.__SE && !!__SE.wstate && !!document.querySelector("#loader.done")')) {
          const loaded = await ev('({url:location.href,title:document.title})');
          if (!documentResponse || documentResponse.status !== 200 || documentResponse.url !== loaded.url || loaded.url !== base || !loaded.title.includes('SPACE')) throw Error('浏览器未加载预期文档');
          return;
        }
      } catch (err) { if (err.message === '浏览器未加载预期文档') throw err; }
    }
    throw Error('页面未就绪');
  }
  async function scenario(name, expression) {
    await load();
    const instance = await ev('__faultProbe.instance');
    const result = await ev(expression);
    const data = await ev('({instance:__faultProbe.instance,sent:__faultProbe.sent,received:__faultProbe.received,injected:__faultProbe.injected})');
    report.scenarios[name] = { ...result, ...data };
    if (data.instance !== instance) report.failures.push({ scenario: name, kind: 'unexpected-navigation' });
    if (!data.sent.some(item => item.task === 'geo')) report.failures.push({ scenario: name, kind: 'no-geo-requests-sent' });
    const ids = new Set();
    for (const item of data.sent.filter(item => item.task === 'geo')) {
      if (!Number.isSafeInteger(item.id) || item.id <= 0 || ids.has(item.id)) report.failures.push({ scenario: name, kind: 'invalid-or-duplicate-request-id', request: item });
      ids.add(item.id);
    }
    for (const item of data.received.filter(item => item.task === 'geo')) if (!ids.has(item.id)) report.failures.push({ scenario: name, kind: 'unknown-native-response-id', response: item });
    for (const check of result.checks) if (!check.ok) report.failures.push({ scenario: name, ...check });
    report.coverage[name] = { checks: result.checks.length, passed: result.checks.filter(x => x.ok).length, sent: data.sent.length, received: data.received.length, checkedRequestIds: ids.size };
  }
  await scenario('duplicate-unknown-nongeo', `new Promise(resolve => {
    const p=__faultProbe, checks=[]; p.mode='hold'; __SE.resetTerrain();
    const timer=setInterval(() => {
      const h=p.held.find(item=>item.task==='geo');
      if (!h) return;
      clearInterval(timer);
      const before=__SE.wstate;
      p.deliver(h.worker,{task:'err',sourceTask:'veg',requestId:h.id,msg:'injected non-geo error'});
      const nongeo=__SE.wstate;
      p.deliver(h.worker,{task:'err',sourceTask:'geo',requestId:999999999,msg:'unknown'});
      const unknown=__SE.wstate;
      const sentBefore=p.sent.length;
      p.deliver(h.worker,{task:'err',sourceTask:'geo',requestId:h.id,msg:'first response'});
      const first=__SE.wstate, newlySent=p.sent.length-sentBefore;
      p.deliver(h.worker,{task:'err',sourceTask:'geo',requestId:h.id,msg:'duplicate response'});
      const duplicate=__SE.wstate;
      checks.push({kind:'nongeo-mutated-ledger',ok:nongeo.inflight===before.inflight&&nongeo.pj===before.pj});
      checks.push({kind:'unknown-mutated-ledger',ok:unknown.inflight===nongeo.inflight&&unknown.pj===nongeo.pj});
      checks.push({kind:'first-response-not-settled',ok:first.inflight===before.inflight-1+newlySent&&first.pj===before.pj-1+newlySent});
      checks.push({kind:'duplicate-mutated-ledger',ok:duplicate.inflight===first.inflight&&duplicate.pj===first.pj});
      resolve({checks,before,nongeo,unknown,first,duplicate,held:p.held});
    },20);
    setTimeout(()=>{clearInterval(timer);resolve({checks:[{kind:'no-held-request',ok:false}]});},15000);
  })`);
  await scenario('fatal-worker', `new Promise(resolve => {
    const p=__faultProbe; p.mode='hold'; __SE.resetTerrain();
    const timer=setInterval(()=>{const h=p.held.find(item=>item.task==='geo');if(!h)return;clearInterval(timer);clearTimeout(timeout);const before=__SE.wstate;p.error(h.worker);const after=__SE.wstate;
      let finished=false;
      const finish=()=>{if(finished)return;finished=true;clearTimeout(deadline);const later=__SE.wstate;
        resolve({before,after,later,checks:[{kind:'fatal-not-injected',ok:p.injected.includes('fatal')},{kind:'fatal-not-drained',ok:after.inflight===0&&after.pj===0},{kind:'fatal-no-fallback-growth',ok:later.geo>after.geo}]});};
      const deadline=setTimeout(finish,15000);
      const poll=()=>{if(finished)return;if(__SE.wstate.geo>after.geo)finish();else requestAnimationFrame(poll);};
      requestAnimationFrame(poll);},20);
    const timeout=setTimeout(()=>{clearInterval(timer);resolve({checks:[{kind:'no-held-request',ok:false}]});},15000);
  })`);
  await scenario('postmessage-throw', `new Promise(resolve => {
    const p=__faultProbe; p.mode='throw'; __SE.resetTerrain();
    const after=__SE.wstate;
    let finished=false;
    const finish=()=>{if(finished)return;finished=true;clearTimeout(deadline);const later=__SE.wstate;
      resolve({after,later,checks:[{kind:'throw-not-injected',ok:p.injected.includes('throw')},{kind:'throw-not-drained',ok:after.inflight===0&&after.pj===0},{kind:'throw-sync-queue-unreported',ok:Number.isSafeInteger(after.syncQueue)&&after.syncQueue>=0},{kind:'throw-no-fallback-growth',ok:later.geo>after.geo}]});};
    const deadline=setTimeout(finish,15000);
    const poll=()=>{if(finished)return;if(__SE.wstate.geo>after.geo)finish();else requestAnimationFrame(poll);};
    requestAnimationFrame(poll);
  })`);
  report.coverage.document = report.document;
  await send('Browser.close').catch(() => {});
}
run().catch(e => { report.failures.push({ kind: 'exception', message: e.stack }); }).finally(() => {
  if (ws) ws.close(); proc.kill();
  const out = path.join(__dirname, '..', `worker-ledger-faults-independent-report-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.json`);
  fs.writeFileSync(out, JSON.stringify(report, null, 2), { flag: 'wx' });
  console.log(JSON.stringify({ coverage: report.coverage, failures: report.failures, report: out }, null, 2));
  if (report.failures.length) process.exitCode = 1;
});
