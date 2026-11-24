'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const base = path.join(root, '.workbuddy');
const stamp = new Date().toISOString().replace(/[:.]/g, '-') + '-' + process.pid;
const output = path.join(base, 'file-v196-independent-' + stamp);
fs.mkdirSync(output);
const report = { url: 'file:///D:/WB/orbit/space.html', browsers: [], notes: ['近景模式中分享按钮被 CSS 隐藏，不伪装为可见 UI 操作。', '近景截图使用公开 API __SE.savePNG(1)，不是可见 UI；主场景截图使用可见分享 UI。'] };
const reportPath = path.join(output, 'report.json');
function persist() { fs.writeFileSync(reportPath, JSON.stringify(report, null, 2)); }
function inspect(file) {
  const b = fs.readFileSync(file);
  const signature = b.subarray(0, 8).toString('hex');
  const script = "$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Drawing; $i=[System.Drawing.Image]::FromFile($env:IMAGE_PATH); try { $b=New-Object System.Drawing.Bitmap($i); try { $min=255; $max=0; $nonblack=0; for($y=0;$y -lt $b.Height;$y+= [Math]::Max(1,[Math]::Floor($b.Height/80))) { for($x=0;$x -lt $b.Width;$x+= [Math]::Max(1,[Math]::Floor($b.Width/80))) { $p=$b.GetPixel($x,$y); $v=[Math]::Max($p.R,[Math]::Max($p.G,$p.B)); $min=[Math]::Min($min,$v); $max=[Math]::Max($max,$v); if($v -gt 8){$nonblack++} } }; @{width=$i.Width;height=$i.Height;min=$min;max=$max;sampleNonblack=$nonblack} | ConvertTo-Json -Compress } finally {$b.Dispose()} } finally {$i.Dispose()}";
  const decoded = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { env: { ...process.env, IMAGE_PATH: file }, encoding: 'utf8' }));
  return { file, bytes: b.length, signature, pngSignatureValid: signature === '89504e470d0a1a0a', sha256: crypto.createHash('sha256').update(b).digest('hex'), windowsSystemDrawing: decoded };
}
async function runBrowser(name, executable) {
  const r = { name, executable, events: [], errors: [], steps: [], downloads: [] }; report.browsers.push(r); persist();
  let child, ws, sid, seq = 0;
  const pending = new Map();
  const dl = new Map();
  const dir = path.join(output, name); fs.mkdirSync(dir);
  const profile = path.join(dir, 'profile'); fs.mkdirSync(profile);
  const downloads = path.join(dir, 'downloads'); fs.mkdirSync(downloads);
  function send(method, params = {}, session = sid) {
    return new Promise((resolve, reject) => {
      const id = ++seq;
      const timer = setTimeout(() => { pending.delete(id); reject(Error('CDP 超时：' + method)); }, 120000);
      pending.set(id, { resolve, reject, timer });
      ws.send(JSON.stringify({ id, method, params, ...(session ? { sessionId: session } : {}) }));
    });
  }
  async function evaluate(expression, userGesture = false) {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture });
    if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  }
  async function step(label, fn) {
    try { const result = await fn(); r.steps.push({ label, ok: true, result }); persist(); return result; }
    catch (e) { r.steps.push({ label, ok: false, error: e.stack }); persist(); return null; }
  }
  async function click(selector) {
    const point = await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('找不到元素');const r=e.getBoundingClientRect(),s=getComputedStyle(e),x=r.left+r.width/2,y=r.top+r.height/2,hit=document.elementFromPoint(x,y);if(!r.width||!r.height||s.visibility!=='visible'||s.display==='none'||!(hit===e||e.contains(hit)))throw Error('元素不可见或被遮挡: '+${JSON.stringify(selector)});return {x,y}})()`);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
    return point;
  }
  async function key(key, code, windowsVirtualKeyCode) { for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode, nativeVirtualKeyCode: windowsVirtualKeyCode }); }
  async function waitFor(expr, ms = 60000) { return evaluate(`new Promise((resolve,reject)=>{const end=Date.now()+${ms};function poll(){try{const v=(${expr});if(v)return resolve(v)}catch(e){}if(Date.now()>end)return reject(Error('等待条件超时: '+${JSON.stringify(expr)}));setTimeout(poll,100)}poll()})`); }
  async function capture(label) {
    const data = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
    const file = path.join(dir, label + '.png'); fs.writeFileSync(file, Buffer.from(data.data, 'base64'), { flag: 'wx' });
    return inspect(file);
  }
  async function download(label, action) {
    const before = new Set(dl.keys());
    const actionResult = await action();
    const start = Date.now(); let item;
    while (Date.now() - start < 120000) {
      item = [...dl.values()].find(x => !before.has(x.guid));
      if (item && (item.state === 'completed' || item.state === 'canceled')) break;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    if (!item || item.state !== 'completed') throw Error('下载未完成：' + JSON.stringify(item || null));
    const file = path.join(downloads, item.guid);
    if (!fs.existsSync(file)) throw Error('下载完成事件后文件不存在：' + file);
    const evidence = { label, actionResult, browserDownload: item, ...inspect(file) };
    r.downloads.push(evidence); persist();
    if (!evidence.pngSignatureValid || !evidence.windowsSystemDrawing.width || !evidence.windowsSystemDrawing.height) throw Error('下载 PNG 校验失败');
    return evidence;
  }
  try {
    if (!executable || !fs.existsSync(executable)) throw Error('浏览器可执行文件不存在');
    child = spawn(executable, ['--headless=new', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--window-size=1280,800', '--force-device-scale-factor=1', '--no-first-run', '--disable-background-networking', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    const endpoint = await new Promise((resolve, reject) => {
      let text = ''; const timer = setTimeout(() => reject(Error('浏览器启动超时')), 45000);
      child.once('error', reject); child.once('exit', code => reject(Error('浏览器退出：' + code)));
      child.stderr.on('data', chunk => { text += chunk; const m = text.match(/DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[^\s]+)/); if (m) { clearTimeout(timer); resolve(m[1]); } });
    });
    ws = new WebSocket(endpoint); await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }); });
    ws.addEventListener('message', e => {
      const m = JSON.parse(e.data);
      if (m.id && pending.has(m.id)) { const p = pending.get(m.id); clearTimeout(p.timer); pending.delete(m.id); m.error ? p.reject(Error(JSON.stringify(m.error))) : p.resolve(m.result || {}); return; }
      if (m.method === 'Browser.downloadWillBegin') { const v = { ...m.params, events: [{ method: m.method, ...m.params }] }; dl.set(v.guid, v); }
      if (m.method === 'Browser.downloadProgress') { const v = dl.get(m.params.guid); if (v) { Object.assign(v, m.params); v.events.push({ method: m.method, ...m.params }); } }
      if (m.method === 'Runtime.exceptionThrown' || (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') || (m.method === 'Log.entryAdded' && m.params.entry.level === 'error')) r.errors.push({ method: m.method, params: m.params });
    });
    r.version = await send('Browser.getVersion', {}, null);
    await send('Browser.setDownloadBehavior', { behavior: 'allowAndName', downloadPath: downloads, eventsEnabled: true }, null);
    const target = await send('Target.createTarget', { url: 'about:blank' }, null);
    sid = (await send('Target.attachToTarget', { targetId: target.targetId, flatten: true }, null)).sessionId;
    await Promise.all(['Runtime.enable', 'Page.enable', 'Log.enable', 'Network.enable'].map(x => send(x)));
    await send('Network.setCacheDisabled', { cacheDisabled: true });
    await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await send('Page.addScriptToEvaluateOnNewDocument', { source: "try{localStorage.setItem('space11.tour','1')}catch(_){}" });
    await step('打开实际 file 页面', async () => { const nav = await send('Page.navigate', { url: report.url }); if (nav.errorText) throw Error(nav.errorText); await waitFor('window.__SE && __SE.firstFrame === false && __SE.deep'); return evaluate('({url:location.href,build:__SE.build,title:document.title})'); });
    await step('WebGL 初始状态', () => evaluate(`(()=>{const gl=__SE.renderer.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info'),errors=[];for(let i=0;i<16;i++){const e=gl.getError();if(!e)break;errors.push(e)}return {version:gl.getParameter(gl.VERSION),renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),lost:gl.isContextLost(),errors}})()`));
    await step('主场景画面', () => capture('main-before'));
    await step('通过可见 UI 进入近景', async () => { await click('#deepModelBtn'); return waitFor("document.body.classList.contains('deep-model')"); });
    await step('通过选择框切换 M51', async () => { await click('#deepModelTarget'); await key('End', 'End', 35); await key('Enter', 'Enter', 13); return waitFor("document.querySelector('#deepModelTarget').value==='m51' && __SE.deep.info().id==='m51'"); });
    await step('M51 状态与分享可见性', () => evaluate(`(()=>{const e=document.querySelector('[data-pop="share"]'),r=e.getBoundingClientRect();return {deep:__SE.deep.info(),shareDisplay:getComputedStyle(e).display,uiDisplay:getComputedStyle(document.querySelector('#ui')).display,shareRect:{width:r.width,height:r.height}}})()`));
    await step('M51 画面', () => capture('m51'));
    await step('可见 UI 吸收开关', async () => { const before = await evaluate('__SE.deep.info().dust'); await click('#deepModelDust'); const after = await evaluate('__SE.deep.info().dust'); if (before === after) throw Error('开关状态未变化'); await click('#deepModelDust'); return { before, after, restored: await evaluate('__SE.deep.info().dust') }; });
    await step('M51 API 下载（非可见 UI）', () => download('m51-api-not-ui', () => evaluate('__SE.savePNG(1)', true)));
    await step('通过可见 UI 返回主场景', async () => { await click('#deepModelClose'); return waitFor("!document.body.classList.contains('deep-model')"); });
    await step('通过可见分享 UI 下载', () => download('main-visible-ui', async () => { await click('[data-pop="share"]'); await click('#shot1x'); return 'CDP 鼠标点击可见分享按钮与 1× 下载按钮'; }));
    await step('最终 WebGL 状态', () => evaluate(`(()=>{const gl=__SE.renderer.getContext(),errors=[];for(let i=0;i<16;i++){let e=gl.getError();if(!e)break;errors.push(e)}return {lost:gl.isContextLost(),errors}})()`));
  } catch (e) { r.fatal = e.stack; persist(); }
  finally { if (ws && ws.readyState === WebSocket.OPEN) { try { await send('Browser.close', {}, null); } catch (_) {} ws.close(); } persist(); }
}
(async () => {
  try {
    const candidates = (names) => names.filter(Boolean).find(fs.existsSync);
    await runBrowser('chrome', candidates([process.env.CHROME_PATH, process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google/Chrome/Application/chrome.exe'), process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Google/Chrome/Application/chrome.exe'), process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe')]));
    await runBrowser('edge', candidates([process.env.EDGE_PATH, process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Microsoft/Edge/Application/msedge.exe'), process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Microsoft/Edge/Application/msedge.exe'), process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Microsoft/Edge/Application/msedge.exe')]));
  } catch (e) { report.fatal = e.stack; }
  finally { persist(); console.log(reportPath); if (report.fatal || report.browsers.some(b => b.fatal || b.steps.some(s => !s.ok))) process.exitCode = 1; }
})();
