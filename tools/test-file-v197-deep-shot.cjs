'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const entry = path.join(root, 'space.html');
const expectedBuild = process.env.ORBIT_TEST_BUILD || 'v197';
if (!/^v\d+$/.test(expectedBuild)) throw Error('Invalid expected build: ' + expectedBuild);
const output = path.join(root, '.workbuddy', 'file-' + expectedBuild + '-deep-shot-' + new Date().toISOString().replace(/[:.]/g, '-') + '-' + process.pid);
fs.mkdirSync(output, { recursive: true });
const reportPath = path.join(output, 'report-' + expectedBuild + '-deep-shot.json');
const report = { expectedUrl: 'file:///D:/WB/orbit/space.html', expectedBuild, started: new Date().toISOString(), browsers: [] };
const persist = () => fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const assert = (condition, message) => { if (!condition) throw Error(message); };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function inspect(file) {
  const bytes = fs.readFileSync(file);
  const script = "$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Drawing; $i=[System.Drawing.Image]::FromFile($env:IMAGE_PATH); try { $b=New-Object System.Drawing.Bitmap($i); try { $nonblack=0; $samples=0; for($y=0;$y -lt $b.Height;$y+=[Math]::Max(1,[Math]::Floor($b.Height/80))) { for($x=0;$x -lt $b.Width;$x+=[Math]::Max(1,[Math]::Floor($b.Width/80))) { $p=$b.GetPixel($x,$y); $samples++; if([Math]::Max($p.R,[Math]::Max($p.G,$p.B)) -gt 8){$nonblack++} } }; @{width=$i.Width;height=$i.Height;sampleNonblack=$nonblack;samples=$samples} | ConvertTo-Json -Compress } finally {$b.Dispose()} } finally {$i.Dispose()}";
  return { file, bytes: bytes.length, signature: bytes.subarray(0, 8).toString('hex'), sha256: sha(file), decoded: JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { env: { ...process.env, IMAGE_PATH: file }, encoding: 'utf8' })) };
}
async function runBrowser(name, executable) {
  const r = { name, executable: executable || null, steps: [], downloads: [], downloadEvents: [], errors: [], glErrors: [] };
  report.browsers.push(r); persist();
  const dir = path.join(output, name), downloads = path.join(dir, 'downloads'), profile = path.join(dir, 'profile');
  fs.mkdirSync(downloads, { recursive: true }); fs.mkdirSync(profile);
  let child, ws, sid, seq = 0, exitPromise;
  const pending = new Map(), dl = new Map();
  function send(method, params = {}, session = sid) {
    return new Promise((resolve, reject) => {
      const id = ++seq;
      const timer = setTimeout(() => { pending.delete(id); reject(Error('CDP 超时：' + method)); }, 120000);
      pending.set(id, { resolve, reject, timer });
      try { ws.send(JSON.stringify({ id, method, params, ...(session ? { sessionId: session } : {}) })); }
      catch (e) { clearTimeout(timer); pending.delete(id); reject(e); }
    });
  }
  async function evalPage(expression) {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  }
  async function step(label, fn) {
    const record = { label, started: new Date().toISOString(), ok: false }; r.steps.push(record); persist();
    try { record.result = await fn(); record.ok = true; return record.result; }
    catch (e) { record.error = e.stack || String(e); return null; }
    finally { record.finished = new Date().toISOString(); persist(); }
  }
  async function waitFor(expr, ms = 60000) {
    return evalPage(`new Promise((resolve,reject)=>{const end=Date.now()+${ms};function poll(){try{const v=(${expr});if(v)return resolve(v)}catch(e){}if(Date.now()>end)return reject(Error('等待条件超时: '+${JSON.stringify(expr)}));setTimeout(poll,100)}poll()})`);
  }
  async function hit(selector, scroll = false) {
    return evalPage(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('元素不存在');if(${scroll})e.scrollIntoView({block:'center',inline:'nearest'});const r=e.getBoundingClientRect(),s=getComputedStyle(e),x=r.left+r.width/2,y=r.top+r.height/2,h=document.elementFromPoint(x,y);const detail={selector:${JSON.stringify(selector)},rect:{x:r.x,y:r.y,width:r.width,height:r.height},point:{x,y},hit:h&&{tag:h.tagName,id:h.id,className:String(h.className)},display:s.display,visibility:s.visibility,opacity:s.opacity};if(!r.width||!r.height||s.display==='none'||s.visibility!=='visible'||Number(s.opacity)===0||x<0||y<0||x>=innerWidth||y>=innerHeight||!(h===e||e.contains(h)))throw Error('不可见或被遮挡: '+JSON.stringify(detail));return detail})()`);
  }
  async function click(selector, scroll = false) {
    const evidence = await hit(selector, scroll), p = evidence.point;
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...p });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...p, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...p, button: 'left', clickCount: 1 });
    return evidence;
  }
  async function key(key, code, vk, text) {
    const base = { key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk };
    await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base });
    if (text) await send('Input.dispatchKeyEvent', { type: 'char', ...base, text, unmodifiedText: text });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
  }
  async function state() {
    const s = await evalPage(`(()=>{const r=__SE.renderer,g=r.getContext(),c=r.domElement,glErrors=[];for(let i=0;i<32;i++){const e=g.getError();if(!e)break;glErrors.push(e)}const v=r.getViewport(new THREE.Vector4()),sc=r.getScissor(new THREE.Vector4()),size=r.getSize(new THREE.Vector2());return {canvas:[c.width,c.height],buffer:[g.drawingBufferWidth,g.drawingBufferHeight],css:[c.style.width,c.style.height],size:size.toArray(),pixelRatio:r.getPixelRatio(),viewport:v.toArray(),scissor:sc.toArray(),scissorTest:r.getScissorTest(),autoClear:r.autoClear,targetDefault:r.getRenderTarget()===null,lost:g.isContextLost(),glErrors,deep:__SE.deep.info(),diagnostics:__SE.screenshotDiagnostics}})()`);
    if (s.glErrors.length) r.glErrors.push({ at: new Date().toISOString(), errors: s.glErrors });
    return s;
  }
  async function toast() {
    await waitFor("document.querySelector('#toast').classList.contains('on')", 5000);
    await delay(350);
    const t = await evalPage(`(()=>{const e=document.querySelector('#toast'),p=document.querySelector('#deepModelPanel'),r=e.getBoundingClientRect(),pr=p.getBoundingClientRect(),s=getComputedStyle(e),ps=getComputedStyle(p),x=r.left+r.width/2,y=r.top+r.height/2;return {text:e.textContent,rect:{left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height},panelRect:{left:pr.left,top:pr.top,right:pr.right,bottom:pr.bottom},viewport:[innerWidth,innerHeight],opacity:Number(s.opacity),display:s.display,visibility:s.visibility,zIndex:s.zIndex,panelZIndex:ps.zIndex,panelDisplay:ps.display,overlapsPanel:r.left<pr.right&&r.right>pr.left&&r.top<pr.bottom&&r.bottom>pr.top,centerStack:document.elementsFromPoint(x,y).slice(0,8).map(n=>({tag:n.tagName,id:n.id,z:getComputedStyle(n).zIndex}))}})()`);
    assert(t.opacity > 0 && t.display !== 'none' && t.visibility === 'visible' && t.rect.width > 0 && t.rect.height > 0 && t.rect.left >= 0 && t.rect.right <= t.viewport[0] && t.rect.top >= 0 && t.rect.bottom <= t.viewport[1], 'toast 不可见或超出视口：' + JSON.stringify(t));
    assert(!t.overlapsPanel || t.panelDisplay === 'none' || Number(t.zIndex) > Number(t.panelZIndex), 'toast 被面板遮挡：' + JSON.stringify(t));
    return t;
  }
  async function armClickSnapshot(selector) {
    await evalPage(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('截图按钮不存在');window.__v197ShotCapture={selector:${JSON.stringify(selector)}};const snapshot=()=>{const r=__SE.renderer,g=r.getContext(),c=r.domElement;return {canvas:[c.width,c.height],buffer:[g.drawingBufferWidth,g.drawingBufferHeight],css:[c.style.width,c.style.height],size:r.getSize(new THREE.Vector2()).toArray(),pixelRatio:r.getPixelRatio(),viewport:r.getViewport(new THREE.Vector4()).toArray(),scissor:r.getScissor(new THREE.Vector4()).toArray(),scissorTest:r.getScissorTest(),autoClear:r.autoClear,targetDefault:r.getRenderTarget()===null,deepActive:__SE.deep.active,model:document.querySelector('#deepModelTarget').value,policy:__SE.deep.perf(),diagnostics:__SE.screenshotDiagnostics}};e.addEventListener('click',()=>{window.__v197ShotCapture.before=snapshot()},{capture:true,once:true});e.addEventListener('click',()=>{window.__v197ShotCapture.after=snapshot()},{once:true});return true})()`);
  }
  async function download(label, scale, action, selector) {
    const record = { label, scale, started: new Date().toISOString() }; r.downloads.push(record); persist();
    try {
      const before = new Set(dl.keys());
      record.before = await state();
      assert(!record.before.lost && !record.before.glErrors.length, '截图前 WebGL 状态异常');
      await armClickSnapshot(selector);
      record.action = await action();
      record.sameClick = await evalPage('window.__v197ShotCapture');
      assert(record.sameClick && record.sameClick.before && record.sameClick.after, '未获取同一真实点击事件的前后状态');
      record.toast = await toast();
      const start = Date.now(); let item;
      while (Date.now() - start < 120000) {
        item = [...dl.values()].find(x => !before.has(x.guid));
        if (item && (item.state === 'completed' || item.state === 'canceled')) break;
        await delay(150);
      }
      record.browserDownload = item || null;
      assert(item && item.events.some(e => e.method === 'Browser.downloadWillBegin') && item.state === 'completed', '未收到完整下载事件：' + JSON.stringify(item));
      const file = path.join(downloads, item.guid);
      assert(fs.existsSync(file), '下载文件不存在：' + file);
      record.image = inspect(file);
      record.after = await state();
      persist();
      assert(record.image.signature === '89504e470d0a1a0a', 'PNG 签名错误');
      assert(record.image.decoded.width === record.sameClick.before.canvas[0] * scale && record.image.decoded.height === record.sameClick.before.canvas[1] * scale, 'PNG 尺寸与实际点击时画布及倍率不符');
      assert(record.image.decoded.sampleNonblack > 0, 'PNG 采样全黑');
      assert(!record.after.lost && !record.after.glErrors.length && !record.after.diagnostics.recoveryRisk && !record.after.diagnostics.restoreErrors.length, '截图后 WebGL 或恢复状态异常');
      for (const field of ['canvas', 'buffer', 'css', 'size', 'pixelRatio', 'viewport', 'scissor', 'scissorTest', 'autoClear', 'targetDefault', 'deepActive', 'model']) {
        assert(JSON.stringify(record.sameClick.before[field]) === JSON.stringify(record.sameClick.after[field]), '截图点击事务内状态未恢复：' + field);
      }
      assert(!record.sameClick.after.diagnostics.recoveryRisk && !record.sameClick.after.diagnostics.restoreErrors.length, '截图点击事务出现恢复风险');
      record.ok = true; return record;
    } catch (e) { record.ok = false; record.error = e.stack || String(e); throw e; }
    finally { record.finished = new Date().toISOString(); persist(); }
  }
  async function tabFocus(selector) {
    const trace = [];
    for (let i = 0; i < 80; i++) {
      await key('Tab', 'Tab', 9);
      const active = await evalPage(`({tag:document.activeElement.tagName,id:document.activeElement.id})`); trace.push(active);
      if (active.id === selector.slice(1)) return { trace, hit: await hit(selector) };
    }
    throw Error('Tab 未取得焦点：' + selector + '，轨迹：' + JSON.stringify(trace));
  }
  try {
    assert(executable && fs.existsSync(executable), '浏览器可执行文件不存在');
    child = spawn(executable, ['--headless=new', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--window-size=1280,800', '--force-device-scale-factor=1', '--no-first-run', '--disable-background-networking', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    exitPromise = new Promise(resolve => { child.once('exit', (code, signal) => resolve({ code, signal })); child.once('error', e => resolve({ error: String(e) })); });
    const endpoint = await new Promise((resolve, reject) => {
      let text = ''; const timer = setTimeout(() => reject(Error('浏览器启动超时')), 45000);
      child.once('error', e => { clearTimeout(timer); reject(e); });
      child.once('exit', code => { clearTimeout(timer); reject(Error('浏览器退出：' + code)); });
      child.stderr.on('data', chunk => { text += chunk; const m = text.match(/DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[^\s]+)/); if (m) { clearTimeout(timer); resolve(m[1]); } });
    });
    ws = new WebSocket(endpoint);
    await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }); });
    ws.addEventListener('message', e => {
      const m = JSON.parse(e.data);
      if (m.id && pending.has(m.id)) { const p = pending.get(m.id); clearTimeout(p.timer); pending.delete(m.id); m.error ? p.reject(Error(JSON.stringify(m.error))) : p.resolve(m.result || {}); return; }
      if (m.method === 'Browser.downloadWillBegin' || m.method === 'Browser.downloadProgress') { r.downloadEvents.push({ method: m.method, ...m.params }); persist(); }
      if (m.method === 'Browser.downloadWillBegin') dl.set(m.params.guid, { ...m.params, events: [{ method: m.method, ...m.params }] });
      if (m.method === 'Browser.downloadProgress') { const v = dl.get(m.params.guid); if (v) { Object.assign(v, m.params); v.events.push({ method: m.method, ...m.params }); } }
      if (m.method === 'Runtime.exceptionThrown' || (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') || (m.method === 'Log.entryAdded' && m.params.entry.level === 'error')) { r.errors.push({ method: m.method, params: m.params }); persist(); }
    });
    r.version = await send('Browser.getVersion', {}, null);
    await send('Browser.setDownloadBehavior', { behavior: 'allowAndName', downloadPath: downloads, eventsEnabled: true }, null);
    const target = await send('Target.createTarget', { url: 'about:blank' }, null);
    sid = (await send('Target.attachToTarget', { targetId: target.targetId, flatten: true }, null)).sessionId;
    await Promise.all(['Runtime.enable', 'Page.enable', 'Log.enable', 'Network.enable'].map(x => send(x)));
    await send('Network.setCacheDisabled', { cacheDisabled: true });
    await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await send('Page.addScriptToEvaluateOnNewDocument', { source: "try{localStorage.setItem('space11.tour','1')}catch(_){}" });
    await step('打开实际 ' + expectedBuild + ' 文件入口', async () => {
      const nav = await send('Page.navigate', { url: report.expectedUrl }); assert(!nav.errorText, nav.errorText);
      await waitFor('window.__SE && __SE.firstFrame === false && __SE.deep');
      const info = await evalPage('({url:location.href,build:__SE.build,title:document.title})'); r.actualPage = info; persist();
      assert(info.url === report.expectedUrl && info.build === expectedBuild, '入口 URL 或 build 不匹配：' + JSON.stringify(info)); return info;
    });
    await step('记录 GPU 与初始 WebGL 状态', async () => {
      const gpu = await evalPage(`(()=>{const g=__SE.renderer.getContext(),e=g.getExtension('WEBGL_debug_renderer_info');return {version:g.getParameter(g.VERSION),vendor:e?g.getParameter(e.UNMASKED_VENDOR_WEBGL):g.getParameter(g.VENDOR),renderer:e?g.getParameter(e.UNMASKED_RENDERER_WEBGL):g.getParameter(g.RENDERER)}})()`);
      r.gpu = gpu; const initial = await state(); assert(!initial.lost && !initial.glErrors.length, '初始 WebGL 异常'); return { gpu, initial };
    });
    await step('可见点击进入 47 Tuc', async () => { const point = await click('#deepModelBtn'); await waitFor("document.body.classList.contains('deep-model') && __SE.deep.info().id==='47tuc'"); return { point, deep: await evalPage('__SE.deep.info()') }; });
    await step('47 Tuc 可见点击 1× 并下载', () => download('47tuc-mouse-1x', 1, () => click('#deepShot1x', true), '#deepShot1x'));
    await step('可见选择 M51', async () => { const point = await click('#deepModelTarget', true); await key('End', 'End', 35); await key('Enter', 'Enter', 13, '\r'); await waitFor("document.querySelector('#deepModelTarget').value==='m51' && __SE.deep.info().id==='m51'"); return { point, deep: await evalPage('__SE.deep.info()') }; });
    await step('M51 可见点击 2× 并下载、验证恢复', () => download('m51-mouse-2x', 2, () => click('#deepShot2x', true), '#deepShot2x'));
    await step('退出后深空控件隐藏', async () => {
      const point = await click('#deepModelClose', true); await waitFor("!document.body.classList.contains('deep-model')");
      const controls = await evalPage(`['#deepModelPanel','#deepShot1x','#deepShot2x','#deepModelTarget','#deepModelClose'].map(q=>{const e=document.querySelector(q),r=e.getBoundingClientRect();return {selector:q,rect:[r.width,r.height],display:getComputedStyle(e).display,visible:!!(r.width&&r.height&&e.getClientRects().length)}})`);
      assert(controls.every(c => !c.visible), '退出后仍有深空控件可见'); return { point, controls };
    });
    await step('主场景分享 UI 实际下载', () => download('main-share-mouse-1x', 1, async () => ({ share: await click('[data-pop="share"]'), shot: await click('#shot1x') }), '#shot1x'));
    await step('切换小屏 360×480 并进入深空', async () => {
      await send('Emulation.setDeviceMetricsOverride', { width: 360, height: 480, deviceScaleFactor: 1, mobile: false });
      await waitFor('innerWidth===360 && innerHeight===480');
      const point = await click('#deepModelBtn'); await waitFor("document.body.classList.contains('deep-model')");
      const panel = await evalPage(`(()=>{const p=document.querySelector('#deepModelPanel'),s=getComputedStyle(p);return {clientHeight:p.clientHeight,scrollHeight:p.scrollHeight,overflowY:s.overflowY,viewport:[innerWidth,innerHeight]}})()`);
      assert(panel.scrollHeight > panel.clientHeight && ['auto','scroll'].includes(panel.overflowY), '小屏面板不可滚动：' + JSON.stringify(panel)); return { point, panel };
    });
    await step('小屏滚动后两个截图按钮命中检查', async () => {
      const first = await hit('#deepShot1x', true), second = await hit('#deepShot2x', true);
      const panel = await evalPage(`(()=>{const p=document.querySelector('#deepModelPanel');return {scrollTop:p.scrollTop,scrollHeight:p.scrollHeight,clientHeight:p.clientHeight}})()`);
      assert(panel.scrollTop > 0, '面板未实际滚动'); return { first, second, panel };
    });
    await step('小屏 Tab 聚焦 1× 并 Enter 下载', () => download('small-tab-enter-1x', 1, async () => { const focus = await tabFocus('#deepShot1x'); await key('Enter', 'Enter', 13, '\r'); return { focus, key: 'Enter' }; }, '#deepShot1x'));
    await step('小屏 Tab 聚焦 2× 并 Space 下载', () => download('small-tab-space-2x', 2, async () => { const focus = await tabFocus('#deepShot2x'); await key(' ', 'Space', 32, ' '); return { focus, key: 'Space' }; }, '#deepShot2x'));
    await step('最终 WebGL 与错误检查', async () => { const final = await state(); assert(!final.lost && !final.glErrors.length && !r.glErrors.length, '存在 WebGL 错误'); assert(!r.errors.length, '存在 JS 或浏览器错误：' + JSON.stringify(r.errors)); return final; });
  } catch (e) { r.fatal = e.stack || String(e); persist(); }
  finally {
    if (ws && ws.readyState === WebSocket.OPEN) { try { await send('Browser.close', {}, null); } catch (_) {} ws.close(); }
    if (child && exitPromise) {
      let result = await Promise.race([exitPromise, delay(15000).then(() => null)]);
      if (!result) { child.kill(); result = await Promise.race([exitPromise, delay(15000).then(() => null)]); }
      r.browserExit = result;
      if (!result) r.fatal = (r.fatal || '') + '\n浏览器进程未退出，禁止继续下一浏览器';
    }
    persist();
  }
  return r;
}
(async () => {
  try {
    report.entrySha256Before = sha(entry); persist();
    const candidate = names => names.filter(Boolean).find(fs.existsSync);
    const chrome = candidate([process.env.CHROME_PATH, process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google/Chrome/Application/chrome.exe'), process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Google/Chrome/Application/chrome.exe'), process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe')]);
    const edge = candidate([process.env.EDGE_PATH, process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Microsoft/Edge/Application/msedge.exe'), process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Microsoft/Edge/Application/msedge.exe'), process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Microsoft/Edge/Application/msedge.exe')]);
    const first = await runBrowser('chrome', chrome);
    if (first.browserExit === null) throw Error('Chrome 尚未退出，不启动 Edge');
    await runBrowser('edge', edge);
  } catch (e) { report.fatal = e.stack || String(e); }
  finally {
    try { report.entrySha256After = sha(entry); if (report.entrySha256Before !== report.entrySha256After) report.hashMismatch = true; } catch (e) { report.hashError = e.stack || String(e); }
    report.finished = new Date().toISOString(); persist(); console.log(reportPath);
    if (report.fatal || report.hashMismatch || report.hashError || report.browsers.length !== 2 || report.browsers.some(b => b.fatal || b.errors.length || b.glErrors.length || b.steps.some(s => !s.ok) || b.downloads.some(d => !d.ok))) process.exitCode = 1;
  }
})();
