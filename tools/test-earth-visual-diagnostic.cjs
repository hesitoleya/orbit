'use strict';
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { randomUUID } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const chrome = [process.env.LOCALAPPDATA, process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)']].filter(Boolean).map(x => path.join(x, 'Google/Chrome/Application/chrome.exe')).find(fs.existsSync);
if (!chrome) throw Error('找不到 Chrome');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-earth-diag-'));
const proc = spawn(chrome, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--window-size=960,640', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
const id = randomUUID(), report = { id, cases: [], errors: [] }, delay = ms => new Promise(r => setTimeout(r, ms));
let ws, seq = 0; const pending = new Map();
function send(method, params = {}, sessionId) { return new Promise((resolve, reject) => { const n = ++seq, timer = setTimeout(() => reject(Error(method + ' 超时')), 60000); pending.set(n, { resolve, reject, timer }); ws.send(JSON.stringify({ id: n, method, params, ...(sessionId ? { sessionId } : {}) })); }); }
async function run() {
 const endpoint = await new Promise((resolve, reject) => { let buf = ''; const timer = setTimeout(() => reject(Error('Chrome 启动超时')), 30000); proc.stderr.on('data', data => { buf += data; const m = buf.match(/DevTools listening on (ws:\/\/\S+)/); if (m) { clearTimeout(timer); resolve(m[1]); } }); proc.on('error', reject); proc.on('exit', code => reject(Error('Chrome 退出 ' + code))); });
 ws = new WebSocket(endpoint); await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; }); ws.onmessage = e => { const m = JSON.parse(e.data), p = pending.get(m.id); if (p) { pending.delete(m.id); clearTimeout(p.timer); m.error ? p.reject(Error(JSON.stringify(m.error))) : p.resolve(m.result || {}); } };
 const target = await send('Target.createTarget', { url: 'about:blank' }), session = (await send('Target.attachToTarget', { targetId: target.targetId, flatten: true })).sessionId;
 const call = (method, params = {}) => send(method, params, session), ev = async expression => { const r = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw Error(r.exceptionDetails.text); return r.result.value; };
 await call('Page.enable'); await call('Runtime.enable'); await call('Emulation.setDeviceMetricsOverride', { width: 960, height: 640, deviceScaleFactor: 1, mobile: false });
 for (const [name, base] of [['http', 'http://127.0.0.1:8169/index.html?auto=0&q=low&fresh=1'], ['offline', pathToFileURL(path.join(root, 'space.html')).href + '?auto=0&q=low&fresh=1']]) for (const clouds of [true, false]) {
  const url = base + (clouds ? '' : '&clouds=0');
  await call('Page.navigate', { url }); let ready = false;
  for (let i = 0; i < 240; i++) { await delay(500); try { if (await ev('!!window.__SE && !!document.querySelector("#loader.done")')) { ready = true; break; } } catch {} }
  if (!ready) { report.errors.push(name + ' 页面未就绪'); continue; }
  const state = await ev('(()=>{let s=__SE,d=s.cam.dir;return {earthData:!!s.EDATA,climate:!!s.ECLIM,biome:!!s.EBIOME,dir:d.toArray(),height:s.terrainHeight(d.x,d.y,d.z),sun:s.sunEf.toArray(),meshes:s.terrainGroup.children.length}})()');
  await ev("__SE.journey();__SE.journeySeek(0);document.getElementById('loader').style.display='none';const t=document.getElementById('tour');if(t)t.style.display='none'");
  await delay(4000);
  const image = await call('Page.captureScreenshot', { format: 'png' }), filename = `earth-diagnostic-${id}-${name}-${clouds ? 'clouds' : 'clear'}.png`;
  fs.writeFileSync(path.join(root, filename), Buffer.from(image.data, 'base64')); report.cases.push({ name, clouds, state, screenshot: filename });
 }
}
run().catch(e => { report.errors.push(e.stack || String(e)); process.exitCode = 1; }).finally(async () => { fs.writeFileSync(path.join(root, `earth-diagnostic-${id}.json`), JSON.stringify(report, null, 2)); if (ws && ws.readyState === 1) { try { await send('Browser.close'); } catch {} ws.close(); } else proc.kill(); console.log(JSON.stringify(report)); });
