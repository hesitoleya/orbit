'use strict';
// 复用原测试的 CDP、离线加载及清理逻辑；只在内存中替换 main，不改原文件。
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
process.env.ORBIT_GPU = '0';
const originalPath = path.join(__dirname, 'test-deep-models.cjs');
let source = fs.readFileSync(originalPath, 'utf8');
const begin = source.indexOf('async function main() {');
const end = source.indexOf('\nfunction cleanup()', begin);
if (begin < 0 || end < 0) throw new Error('原测试结构不匹配');

function browserExperiment(recording) {
  return new Promise((resolve, reject) => {
    const renderer = __SE.renderer, canvas = renderer.domElement;
    const originalRender = renderer.render, calls = [], views = [], parts = [];
    let stream, recorder, mime, start, stopped = false;
    renderer.render = function (...args) {
      const begin = performance.now();
      try { return originalRender.apply(this, args); }
      finally { const end = performance.now(); calls.push({ start: begin, end, elapsed: end - begin, scene: args[0]?.name || null, camera: args[1]?.name || null }); }
    };
    function restore() { renderer.render = originalRender; if (stream) stream.getTracks().forEach(t => t.stop()); }
    function fail(e) { if (stopped) return; stopped = true; restore(); reject(e); }
    async function finish() {
      if (stopped) return;
      stopped = true;
      try {
        const end = performance.now();
        restore();
        let bytes = null, length = null;
        if (recording) {
          const blob = new Blob(parts, { type: mime });
          bytes = blob.size;
          window.__deepProbe.video = await new Promise((r, j) => {
            const f = new FileReader(); f.onload = () => r(f.result); f.onerror = j; f.readAsDataURL(blob);
          });
          length = window.__deepProbe.video.length;
        }
        resolve({ recording, mime: mime || null, bytes, length, start, end,
          elapsed: end - start, views, renderCalls: calls,
          encodedFrameCount: null, encodedFrameCountStatus: '未测；render 调用不等于编码帧数' });
      } catch (e) { reject(e); }
    }
    try {
      if (recording) {
        stream = canvas.captureStream(30);
        mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find(x => MediaRecorder.isTypeSupported(x));
        if (!mime) throw new Error('无可用 WebM 编码器');
        recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 4500000 });
        recorder.ondataavailable = e => { if (e.data.size) parts.push(e.data); };
        recorder.onerror = e => fail(new Error('录像失败 ' + e));
        recorder.onstop = finish;
      }
      start = performance.now();
      if (recorder) recorder.start(500);
      function frame(t) {
        try {
          const callbackStart = performance.now();
          const u = Math.min(1, (t - start) / 8000), yaw = 2 * Math.PI * u, pitch = .20 * Math.sin(2 * Math.PI * u);
          const distance = u < .5 ? 3.6 * Math.pow(.35 / 3.6, 2 * u) : .35 * Math.pow(3.6 / .35, 2 * u - 1);
          const setViewStart = performance.now();
          __SE.deep.setView({ yaw, pitch, distance, target: [0, 0, 0] });
          const setViewEnd = performance.now();
          views.push({ rafTimestamp: t, callbackStart, u, yaw, pitch, distance, setViewStart, setViewEnd, setViewMs: setViewEnd - setViewStart });
          if (u < 1) requestAnimationFrame(frame); else if (recorder) recorder.stop(); else finish();
        } catch (e) { if (recorder && recorder.state !== 'inactive') recorder.stop(); fail(e); }
      }
      requestAnimationFrame(frame);
    } catch (e) { fail(e); }
  });
}

async function diagnosticMain() {
  report.experiment = 'M51 离线 SwiftShader 录像开关时序对照';
  report.order = ['recording-off', 'recording-on'];
  report.runId = RUN_ID;
  report.identity = { pid: process.pid, node: process.version, platform: process.platform, arch: process.arch,
    user: require('node:os').userInfo().username, cwd: process.cwd() };
  report.entryBeforeSha256 = createHash('sha256').update(fs.readFileSync(path.join(ROOT, 'space.html'))).digest('hex');
  report.originalTestSha256 = createHash('sha256').update(fs.readFileSync(path.join(ROOT, 'tools/test-deep-models.cjs'))).digest('hex');
  report.sourceSha256 = Object.fromEntries(['public/js/app.js', 'public/js/deep-models.js', 'tools/probe-m51-video-timing-20261116.cjs'].map(name => [name, createHash('sha256').update(fs.readFileSync(path.join(ROOT, name))).digest('hex')]));
  assert(FILE_URL.startsWith('file:///') && FILE_URL.includes('/orbit/space.html?'), '拒绝非预期离线入口', {url: FILE_URL});
  report.notes.push('各组重新导航同一 file 入口，打开 M51 并等待相同的三帧；固定顺序，非随机化；浏览器缓存禁用。');
  report.notes.push('render 耗时为 JS 调用墙钟时间，可能不包含异步 GPU 工作；录制编码帧数未测，不等于 render 调用数。');
  report.notes.push('起止截图分别在轨迹启动前及结束后采样，不是编码视频首末帧；截图采样不在轨迹区间内。');
  await launch();
  for (const recording of [false, true]) {
    const label = recording ? 'recording-on' : 'recording-off';
    await test(label, async () => {
      phase = label + '-load';
      const networkStart = report.network.length;
      const ready = await load(FILE_URL, 'file');
      const setup = await evaluate(`(() => {const gl=__SE.renderer.getContext(), ext=gl.getExtension('WEBGL_debug_renderer_info'); return {build:__SE.build, url:location.href, renderer:gl.getParameter(gl.RENDERER), unmaskedRenderer:ext&&gl.getParameter(ext.UNMASKED_RENDERER_WEBGL), canvas:{width:__SE.renderer.domElement.width,height:__SE.renderer.domElement.height}}})()`);
      assert(setup.build === 'v192', '入口不是预期的 v192', setup);
      assert(/swiftshader/i.test(setup.unmaskedRenderer || ''), '未确认 SwiftShader 软件渲染', setup);
      const model = await openModel('m51');
      const before = await send('Page.captureScreenshot', {format:'png'});
      const firstFile = path.join(ROOT, `m51-timing-${label}-before-${RUN_ID}.png`);
      fs.writeFileSync(firstFile, Buffer.from(before.data, 'base64'), {flag:'wx'});
      const resourcesBefore = report.network.slice(networkStart).map(x => ({...x}));
      phase = label + '-trajectory';
      const result = await evaluate(`(${browserExperiment.toString()})(${recording})`);
      phase = label + '-after';
      const after = await send('Page.captureScreenshot', {format:'png'});
      const lastFile = path.join(ROOT, `m51-timing-${label}-after-${RUN_ID}.png`);
      fs.writeFileSync(lastFile, Buffer.from(after.data, 'base64'), {flag:'wx'});
      let bytes = null, file = null, sha256 = null;
      if (recording) {
        const parts = [];
        for (let i=0; i<result.length; i+=CHUNK) parts.push(await evaluate(`window.__deepProbe.video.slice(${i},${i+CHUNK})`));
        const data = parts.join('');
        bytes = Buffer.from(data.slice(data.indexOf(',')+1), 'base64');
        if (bytes.length) {
          file = path.join(ROOT, `m51-timing-recording-${RUN_ID}.webm`);
          fs.writeFileSync(file, bytes, {flag:'wx'});
          sha256 = createHash('sha256').update(bytes).digest('hex');
        }
      }
      const trajectory = { moreThan30: result.views.length > 30, firstULessThanPoint1: result.views.length > 0 && result.views[0].u < .1,
        originalLastUEquals1: result.views.length > 0 && result.views.at(-1).u === 1 };
      const fileCheck = recording ? { nonempty: !!file, receivedMatches: bytes.length === result.bytes, greaterThan10000: bytes.length > 10000 } : null;
      const evidence = {ready, setup, model, result, trajectory, fileCheck, file, sha256,
        screenshots: {before:firstFile, after:lastFile}, resourcesBefore, resourcesAfter: report.network.slice(networkStart).map(x=>({...x})),
        errors: report.errors.filter(x=>x.phase.startsWith(label))};
      report[label] = evidence;
      assert(trajectory.moreThan30 && trajectory.firstULessThanPoint1 && trajectory.originalLastUEquals1,
        '轨迹未达到原始门槛', evidence);
      if (recording) assert(fileCheck.nonempty && fileCheck.receivedMatches && fileCheck.greaterThan10000, '录像文件未达到原始门槛', evidence);
      return evidence;
    });
  }
}

source = source.slice(0, begin) + `const browserExperiment = ${browserExperiment.toString()};\nasync function main() { return (${diagnosticMain.toString()})(); }` + source.slice(end);
source = source.replace("  const result = await send('Page.navigate', { url });", "  if (url !== FILE_URL || kind !== 'file') throw new Error('只允许离线项目入口');\n  const result = await send('Page.navigate', { url });");
source = source.replace("  } else if (event.method === 'Network.loadingFailed') {", `  } else if (event.method === 'Network.loadingFinished') {
    const item = requests.get(p.requestId);
    if (item) { item.finished = true; item.encodedDataLength = p.encodedDataLength; item.finishedTimestamp = p.timestamp; }
  } else if (event.method === 'Network.loadingFailed') {`);
source = source.replace('deep-models-test-184-${RUN_ID}.json', 'm51-video-timing-20261116-${RUN_ID}.json');
source = source.replace('function finish() {\n  if (finished)', `function finish() {
  report.entryAfterSha256 = createHash('sha256').update(fs.readFileSync(path.join(ROOT,'space.html'))).digest('hex');
  if (finished)`);
vm.runInThisContext(`(function(require,__dirname,__filename){${source}\n})`, {filename:originalPath})(require, __dirname, originalPath);
