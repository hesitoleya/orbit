const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const port = 9467;
const base = 'http://127.0.0.1:8169/';
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'earth-diagnostic-'));
const browser = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', [
  '--headless=new', '--remote-debugging-port=' + port,
  '--user-data-dir=' + path.join(output, 'profile'), '--window-size=960,640',
  '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--disable-gpu-sandbox',
  '--no-first-run', 'about:blank'
], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const json = p => new Promise((resolve, reject) => {
  http.get({ host: '127.0.0.1', port, path: p }, r => {
    let text = ''; r.on('data', x => text += x); r.on('end', () => { try { resolve(JSON.parse(text)); } catch (e) { reject(e); } });
  }).on('error', reject);
});
(async () => {
  const report = { output, base, viewport: [960, 640], notes: [
    '旅程定位到 0 秒并冻结；模拟时间固定为 0。截图时间是定位后的等待时间，并非旅程播放时间。',
    '仅显示渲染画布以排除 DOM 覆盖；有云组的云动画仍使用真实时间，不能视为逐像素确定性。',
    'seconds 为计划采样时间，actualElapsedMs 为截图完成时间；状态读取先于截图，慢渲染时状态与截图可能不同帧，首帧也可能尚未更新机位。',
    '无云组禁用两层云 quad，但不禁用云影；隔离组同时关闭 bloom 和 grade。地形完成与否以 wstate 为准。'
  ], samples: [], errors: [] };
  try {
    let targets;
    for (let i = 0; i < 80; i++) { try { targets = await json('/json'); break; } catch { await sleep(250); } }
    if (!targets) throw new Error('浏览器调试端口未就绪');
    const socket = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
    let id = 0; const pending = new Map();
    socket.onmessage = event => {
      const msg = JSON.parse(event.data);
      if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
      if (msg.method === 'Runtime.exceptionThrown') report.errors.push(msg.params.exceptionDetails.text);
    };
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const n = ++id;
      pending.set(n, msg => msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg));
      socket.send(JSON.stringify({ id: n, method, params }));
    });
    const evaluate = async expression => {
      const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
      return r.result?.result?.value;
    };
    await send('Runtime.enable'); await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 960, height: 640, deviceScaleFactor: 1, mobile: false });
    for (const scenario of [
      { name: 'cloud-on-default', clouds: true, post: true },
      { name: 'cloud-off-default', clouds: false, post: true },
      { name: 'cloud-off-no-post', clouds: false, post: false }
    ]) {
      await send('Page.navigate', { url: base + '?ts=0' + (scenario.clouds ? '' : '&clouds=0') });
      let ready = false;
      for (let i = 0; i < 90; i++) {
        await sleep(1000);
        try { if (await evaluate('typeof window.__SE === "object"')) { ready = true; break; } } catch {}
      }
      if (!ready) { report.errors.push(scenario.name + ': __SE 未就绪'); continue; }
      const setup = await evaluate(`(() => {
        __SE.tour?.(false); __SE.ts = 0; __SE.setTime(0);
        const seek = __SE.journeySeek(0);
        if (!${scenario.post}) { __SE.bloom(false); __SE.grade(false); }
        const canvas = __SE.renderer.domElement;
        canvas.id = 'earth-diagnostic-canvas';
        const style = document.createElement('style');
        style.textContent = 'body * { visibility: hidden !important; } #earth-diagnostic-canvas { visibility: visible !important; }';
        document.head.appendChild(style);
        const rect = canvas.getBoundingClientRect();
        return { seek, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } };
      })()`);
      if (!setup.seek) throw new Error(scenario.name + ': journeySeek(0) 失败');
      const start = Date.now();
      for (const seconds of [0, 5, 15, 30]) {
        await sleep(Math.max(0, start + seconds * 1000 - Date.now()));
        const state = await evaluate(`(() => {
          const c = __SE.renderer.domElement, r = c.getBoundingClientRect();
          return { journey: __SE.journeyInfo, terrain: __SE.wstate, pending: __SE.pending,
            simTime: __SE.simTime, ts: __SE.ts, bloom: __SE.bloom(), grade: __SE.grade(),
            cloudVisible: __SE.scene.children.filter(x => x.material === __SE.cloudMat).map(x => x.visible),
            cirrus: __SE.cirrusQuad.visible, camera: { position: __SE.camera.position.toArray(), quaternion: __SE.camera.quaternion.toArray(), fov: __SE.camera.fov },
            canvas: { x: r.x, y: r.y, width: r.width, height: r.height, pixelWidth: c.width, pixelHeight: c.height } };
        })()`);
        const shot = await send('Page.captureScreenshot', { format: 'png' });
        const filename = scenario.name + '-' + seconds + 's.png';
        fs.writeFileSync(path.join(output, filename), Buffer.from(shot.result.data, 'base64'));
        report.samples.push({ scenario: scenario.name, seconds, actualElapsedMs: Date.now() - start, filename, setup, state });
        fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
      }
    }
    socket.close();
  } catch (e) { report.errors.push(String(e.stack || e)); process.exitCode = 1; }
  finally { fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); browser.kill(); console.log(JSON.stringify(report, null, 2)); }
})();
