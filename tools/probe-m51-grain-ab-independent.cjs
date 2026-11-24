'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createHash } = require('node:crypto');

const root = path.resolve(__dirname, '..');
const stamp = Date.now();
const prefix = `m51-grain-ab-independent-${stamp}`;
const report = {
  experiment: 'M51 后处理胶片颗粒单变量 A/B',
  constraints: [
    '只连接既有 http://127.0.0.1:8169/space.html；不启动、不重启服务。',
    '不修改产品源码；颗粒 shader 改动仅存在于独立 Chrome 页面生命周期内。',
    '不删除既有证据；独立 Chrome profile 保留。'
  ],
  method: [
    'A：保持胶片调色开启，冻结 _post.mComp.uniforms.uGradeT 为 0。',
    'B：保持同一胶片调色路径，仅将颗粒项系数 0.020 临时置为 0。',
    '同一会话、同一机位、同一 M51 seed；以 PNG 显示编码 RGB 计算差异。'
  ],
  views: [],
  errors: []
};

let child, ws, sid, seq = 0;
const pending = new Map();

function send(method, params = {}, sessionId = sid) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`CDP timeout: ${method}`));
    }, 300000);
    pending.set(id, { resolve, reject, timer });
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
}

async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}

function waitForPageEvent(method) {
  return new Promise(resolve => {
    const handler = event => {
      const m = JSON.parse(event.data);
      if (m.method === method) {
        ws.removeEventListener('message', handler);
        resolve(m);
      }
    };
    ws.addEventListener('message', handler);
  });
}

async function waitFrames(count = 6) {
  return evaluate(`new Promise(resolve => { let n = ${count}; function f() { if (--n <= 0) resolve(true); else requestAnimationFrame(f); } requestAnimationFrame(f); })`);
}

async function capture(tag) {
  const meta = await evaluate(`(async()=>{
    const url = __SE.snap('image/png');
    const img = new Image(); img.src = url; await img.decode();
    const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
    const x = c.getContext('2d', {willReadFrequently:true}); x.drawImage(img, 0, 0);
    const p = x.getImageData(0, 0, c.width, c.height).data;
    let sum = 0, sum2 = 0, min = 255, max = 0;
    for (let i = 0; i < p.length; i += 4) {
      for (let k = 0; k < 3; k++) { const v = p[i+k]; sum += v; sum2 += v*v; min = Math.min(min, v); max = Math.max(max, v); }
    }
    const n = p.length / 4 * 3, mean = sum / n;
    window.__m51GrainPixels = window.__m51GrainPixels || {};
    window.__m51GrainPixels[${JSON.stringify(tag)}] = p;
    return { tag: ${JSON.stringify(tag)}, url, width: c.width, height: c.height,
      rgbMean: mean, rgbStd: Math.sqrt(Math.max(0, sum2 / n - mean*mean)), rgbMin: min, rgbMax: max };
  })()`);
  const bytes = Buffer.from(meta.url.split(',')[1], 'base64');
  delete meta.url;
  return { meta, bytes, sha256: createHash('sha256').update(bytes).digest('hex') };
}

async function difference(tagA, tagB) {
  return evaluate(`(()=>{
    const a = window.__m51GrainPixels[${JSON.stringify(tagA)}];
    const b = window.__m51GrainPixels[${JSON.stringify(tagB)}];
    if (!a || !b || a.length !== b.length) throw new Error('像素缓存不存在或尺寸不一致');
    let sum = 0, sum2 = 0, changed = 0, max = 0;
    for (let i = 0; i < a.length; i += 4) {
      let pixelMax = 0;
      for (let k = 0; k < 3; k++) { const d = Math.abs(a[i+k] - b[i+k]); sum += d; sum2 += d*d; pixelMax = Math.max(pixelMax, d); max = Math.max(max, d); }
      if (pixelMax > 0) changed++;
    }
    const pixels = a.length / 4, channels = pixels * 3;
    return { meanRGB255: sum / channels, rmsRGB255: Math.sqrt(sum2 / channels), changedPixelRatio: changed / pixels, maxRGB255: max, pixels, channels };
  })()`);
}

async function launchAndRun() {
  const base = path.join(root, '.workbuddy');
  if (!fs.statSync(base).isDirectory()) throw new Error('profile 父目录不存在');
  const profile = fs.mkdtempSync(path.join(base, 'm51-grain-ab-independent-'));
  const choices = [
    process.env.CHROME_PATH,
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google/Chrome/Application/chrome.exe'),
    process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Google/Chrome/Application/chrome.exe'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe')
  ].filter(Boolean);
  const chrome = choices.find(fs.existsSync);
  if (!chrome) throw new Error('未找到 Chrome');

  const args = [
    '--headless=new', '--enable-unsafe-swiftshader', '--use-angle=swiftshader',
    '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0',
    `--user-data-dir=${profile}`, '--window-size=960,640', '--force-device-scale-factor=1',
    '--no-first-run', '--disable-background-networking', 'about:blank'
  ];
  report.launch = { chrome, profile, args };
  child = spawn(chrome, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
  const endpoint = await new Promise((resolve, reject) => {
    let text = '';
    const timer = setTimeout(() => reject(new Error('Chrome 启动超时')), 45000);
    child.once('error', reject);
    child.once('exit', code => reject(new Error(`Chrome 退出 ${code}`)));
    child.stderr.on('data', chunk => {
      text += chunk;
      const m = text.match(/DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[^\s]+)/);
      if (m) { clearTimeout(timer); resolve(m[1]); }
    });
  });

  ws = new WebSocket(endpoint);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });
  ws.addEventListener('message', event => {
    const m = JSON.parse(event.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id); clearTimeout(p.timer); pending.delete(m.id);
      m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result || {});
    } else if (m.method === 'Runtime.exceptionThrown' || (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error')) {
      report.errors.push(m.params);
    }
  });

  report.browser = await send('Browser.getVersion', {}, null);
  const target = await send('Target.createTarget', { url: 'about:blank' }, null);
  sid = (await send('Target.attachToTarget', { targetId: target.targetId, flatten: true }, null)).sessionId;
  await Promise.all(['Runtime.enable', 'Page.enable', 'Network.enable'].map(method => send(method)));
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Network.setBypassServiceWorker', { bypass: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 480, height: 320, deviceScaleFactor: 1, mobile: false });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    try { localStorage.setItem('space11.tour', '1'); } catch (_) {}
    window.__m51GrainHook = { installed: false, materials: 0, patched: 0, frozen: 0, grainOff: false };
    (function install() {
      const T = window.THREE;
      if (!T || !T.WebGLRenderer || T.WebGLRenderer.prototype.__m51GrainHooked) { setTimeout(install, 0); return; }
      const proto = T.WebGLRenderer.prototype;
      const original = proto.render;
      proto.render = function(scene, camera) {
        try {
          scene.traverse(o => {
            const m = o.material;
            if (!m || typeof m.fragmentShader !== 'string' || !m.fragmentShader.includes('uGradeT')) return;
            window.__m51GrainHook.materials++;
            window.__m51GrainMaterial = m;
            const u = m.uniforms && m.uniforms.uGradeT;
            if (u) { u.value = 0; window.__m51GrainHook.frozen++; }
            const marker = 'sc += (n - 0.5) * 0.020 *';
            if (!m.__m51GrainOriginalShader && m.fragmentShader.includes(marker)) m.__m51GrainOriginalShader = m.fragmentShader;
            if (window.__m51GrainHook.grainOff && m.__m51GrainOriginalShader && m.fragmentShader.includes(marker)) {
              m.fragmentShader = m.__m51GrainOriginalShader.replace(marker, 'sc += (n - 0.5) * 0.0 *');
              m.needsUpdate = true;
              window.__m51GrainHook.patched++;
            }
            if (!window.__m51GrainHook.grainOff && m.__m51GrainOriginalShader && m.fragmentShader !== m.__m51GrainOriginalShader) {
              m.fragmentShader = m.__m51GrainOriginalShader;
              m.needsUpdate = true;
            }
          });
        } catch (_) {}
        return original.call(this, scene, camera);
      };
      proto.__m51GrainHooked = true;
      window.__m51GrainHook.installed = true;
    })();
  ` });
  const loaded = waitForPageEvent('Page.loadEventFired');
  const nav = await send('Page.navigate', { url: 'http://127.0.0.1:8169/space.html?auto=0&q=high&grade=1&t=0' });
  if (nav.errorText) throw new Error(nav.errorText);
  await loaded;
  await evaluate(`new Promise((resolve,reject)=>{let n=0;function check(){if(window.__SE&&__SE.firstFrame===false&&__SE.deep)resolve(true);else if(++n>1200)reject(Error('页面未就绪'));else setTimeout(check,100)}check()})`);
  await evaluate(`(()=>{__SE.ts=0;if(__SE.tour)__SE.tour(false);if(__SE.help)__SE.help(false);__SE.deep.open('m51');__SE.deep.setDust(true);__SE.deep.setQuality('interactive');__SE.deep.setView({yaw:0,pitch:0,distance:3.6,target:[0,0,0]});__SE.grade(true);return true})()`);
  await waitFrames(12);
  await evaluate(`(()=>{
    const r = __SE.renderer;
    const hook = window.__m51GrainHook || (window.__m51GrainHook = {installed:false,materials:0,patched:0,frozen:0,grainOff:false});
    if (!r.__m51GrainInstanceHooked) {
      const original = r.render.bind(r);
      r.render = function(scene, camera) {
        try { scene.traverse(o => {
          const m = o.material;
          if (!m || !m.uniforms || !m.uniforms.uGradeT || typeof m.fragmentShader !== 'string') return;
          hook.materials++; window.__m51GrainMaterial = m;
          m.uniforms.uGradeT.value = 0; hook.frozen++;
          const marker = 'sc += (n - 0.5) * 0.020 *';
          if (!m.__m51GrainOriginalShader && m.fragmentShader.includes(marker)) m.__m51GrainOriginalShader = m.fragmentShader;
          if (hook.grainOff && m.__m51GrainOriginalShader && m.fragmentShader.includes(marker)) {
            m.fragmentShader = m.__m51GrainOriginalShader.replace(marker, 'sc += (n - 0.5) * 0.0 *'); m.needsUpdate = true; hook.patched++;
          }
          if (!hook.grainOff && m.__m51GrainOriginalShader && m.fragmentShader !== m.__m51GrainOriginalShader) {
            m.fragmentShader = m.__m51GrainOriginalShader; m.needsUpdate = true;
          }
        }); } catch (_) {}
        return original(scene, camera);
      };
      r.__m51GrainInstanceHooked = true; hook.installed = true;
    }
    return {hook:{...hook}, rendererHooked:!!r.__m51GrainInstanceHooked};
  })()`);
  await waitFrames(12);

  const setup = await evaluate(`(()=>{
    const hook = window.__m51GrainHook;
    if (!hook || !hook.installed) throw new Error('运行时 hook 未安装');
    const m = window.__m51GrainMaterial;
    if (!m || !m.uniforms || !m.uniforms.uGradeT) throw new Error('后处理材质或 uGradeT 未建立');
    const marker = 'sc += (n - 0.5) * 0.020 *';
    return { frozen: m.uniforms.uGradeT.value === 0, hasGrainMarker: m.fragmentShader.includes(marker), grade: __SE.gradeOn, materials: hook.materials, info: __SE.deep.info(), hook: {...hook} };
  })()`);
  report.setup = setup;
  if (!setup.frozen || !setup.hasGrainMarker) throw new Error(`A/B 前置条件失败: ${JSON.stringify(setup)}`);

  const view = { name: 'front', yaw: 0, pitch: 0, distance: 3.6, target: [0, 0, 0] };
  const result = { view, cases: {}, differences: {} };
  await evaluate(`__SE.deep.setView(${JSON.stringify({ yaw: view.yaw, pitch: view.pitch, distance: view.distance, target: view.target })})`);
  await waitFrames(8);

  const a1 = await capture('A-grain-on-1');
  const a2 = await capture('A-grain-on-2');
  const a3 = await capture('A-grain-on-3');
  result.cases.A = { setting: 'uGrade=1；uGradeT 冻结为 0；颗粒系数 0.020', captures: [a1.meta, a2.meta, a3.meta], files: [] };
  for (const [captureResult, suffix] of [[a1, 'A-grain-on-1'], [a2, 'A-grain-on-2'], [a3, 'A-grain-on-3']]) {
    const file = path.join(root, `${prefix}-${suffix}.png`);
    fs.writeFileSync(file, captureResult.bytes, { flag: 'wx' });
    result.cases.A.files.push({ file, sha256: captureResult.sha256 });
  }
  result.differences.A_repeat_1_2 = await difference('A-grain-on-1', 'A-grain-on-2');
  result.differences.A_repeat_1_3 = await difference('A-grain-on-1', 'A-grain-on-3');

  const patch = await evaluate(`(()=>{
    const hook = window.__m51GrainHook;
    if (!hook || !hook.installed) throw new Error('运行时 hook 未安装');
    hook.grainOff = true;
    return { patched: true, grade: __SE.gradeOn, hook: {...hook} };
  })()`);
  result.B_patch = patch;
  if (!patch.patched) throw new Error(`B patch 失败: ${JSON.stringify(patch)}`);
  await waitFrames(12);

  const b1 = await capture('B-grain-off-1');
  const b2 = await capture('B-grain-off-2');
  const b3 = await capture('B-grain-off-3');
  result.cases.B = { setting: 'uGrade=1；uGradeT 冻结为 0；仅颗粒系数临时置 0', captures: [b1.meta, b2.meta, b3.meta], files: [] };
  for (const [captureResult, suffix] of [[b1, 'B-grain-off-1'], [b2, 'B-grain-off-2'], [b3, 'B-grain-off-3']]) {
    const file = path.join(root, `${prefix}-${suffix}.png`);
    fs.writeFileSync(file, captureResult.bytes, { flag: 'wx' });
    result.cases.B.files.push({ file, sha256: captureResult.sha256 });
  }
  result.differences.B_repeat_1_2 = await difference('B-grain-off-1', 'B-grain-off-2');
  result.differences.B_repeat_1_3 = await difference('B-grain-off-1', 'B-grain-off-3');
  result.differences.A_vs_B = await difference('A-grain-on-1', 'B-grain-off-1');
  await evaluate(`window.__m51GrainHook.grainOff=false`);
  await waitFrames(3);
  const restored = await capture('A-restored');
  const restoredFile = path.join(root, `${prefix}-A-restored.png`);
  fs.writeFileSync(restoredFile, restored.bytes, { flag: 'wx' });
  result.differences.A_vs_restored = await difference('A-grain-on-1', 'A-restored');
  result.restore = await evaluate(`(()=>{const m=window.__m51GrainMaterial;return {shaderRestored:!!m&&m.fragmentShader===m.__m51GrainOriginalShader,grade:__SE.gradeOn,hook:{...window.__m51GrainHook}};})()`);
  result.restore.capture = restored.meta;
  result.restore.file = restoredFile;
  result.restore.sha256 = restored.sha256;
  report.views.push(result);
  report.gpu = await evaluate(`(()=>{const gl=__SE.renderer.getContext();return {vendor:gl.getParameter(gl.VENDOR),renderer:gl.getParameter(gl.RENDERER),version:gl.getParameter(gl.VERSION),lost:gl.isContextLost(),error:gl.getError()}})()`);
}

(async()=>{
  try {
    await launchAndRun();
  } catch (error) {
    report.fatal = error.stack;
    process.exitCode = 1;
  } finally {
    if (ws && ws.readyState === WebSocket.OPEN) {
      try { await send('Browser.close', {}, null); } catch (error) { report.errors.push(String(error)); }
      ws.close();
    }
    const file = path.join(root, `${prefix}.json`);
    fs.writeFileSync(file, JSON.stringify(report, null, 2), { flag: 'wx' });
    console.log(file);
  }
})();
