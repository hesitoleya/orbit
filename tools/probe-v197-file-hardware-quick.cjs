'use strict';
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const framework = path.join(__dirname, 'test-deep-models.cjs');
const base = fs.readFileSync(framework, 'utf8');
const cut = base.indexOf('async function main() {');
if (cut < 0) throw new Error('测试框架边界未找到');
const probe = String.raw`
const OUTPUT = path.join(ROOT, 'v197-file-hardware-quick-' + RUN_ID + '.json');
report.kind = 'v197-file-hardware-quick';
report.notes = [
  'rAF 时间戳间隔包含浏览器调度、渲染及提交等开销，p50/p95/p99 不是 GPU 时间；不作性能通过结论。',
  '独立 headless Chrome、CSS viewport 960×640、仿真设备 DPR 1；renderer DPR 可能随自适应改变。',
  '每组固定机位，预热 5 秒后采集 12 秒；帧数和间隔为观测值，受调度影响。',
  '动态分辨率通过产品按钮切换；存储仅写入本次创建的独立 Chrome profile，该 profile 保留。'
];
function save() { fs.writeFileSync(OUTPUT, JSON.stringify(report, null, 2)); }
function hash(file) { return createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function chromePath() {
  return [process.env.CHROME_PATH,
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google/Chrome/Application/chrome.exe'),
    process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Google/Chrome/Application/chrome.exe')]
    .filter(Boolean).find(file => fs.existsSync(file));
}
async function state() {
  return evaluate("(()=>{const r=__SE.renderer,g=r.getContext(),x=g.getExtension('WEBGL_debug_renderer_info');return {build:__SE.build,url:location.href,visibility:document.visibilityState,viewport:[innerWidth,innerHeight],deviceDpr:devicePixelRatio,rendererDpr:r.getPixelRatio(),canvas:[r.domElement.width,r.domElement.height,r.domElement.clientWidth,r.domElement.clientHeight],buffer:[g.drawingBufferWidth,g.drawingBufferHeight],model:__SE.deep.info(),auto:__SE.SET.auto,qualityMain:__SE.SET.q,deepPerf:__SE.deep.perf(),gl:{renderer:g.getParameter(g.RENDERER),unmaskedRenderer:x&&g.getParameter(x.UNMASKED_RENDERER_WEBGL),vendor:g.getParameter(g.VENDOR),unmaskedVendor:x&&g.getParameter(x.UNMASKED_VENDOR_WEBGL),version:g.getParameter(g.VERSION),lost:g.isContextLost(),lostEvents:window.__deepProbe.contextLost}}})()");
}
async function scenario(auto) {
  phase = 'M51 auto=' + auto;
  const item = { label: phase, requestedAuto: auto, warmupMs: 5000, targetMeasurementMs: 12000, errorsFrom: report.errors.length };
  report.tests.push(item); save();
  const switched = await evaluate('(() => {' +
    'const button=document.querySelector(\'[data-tog="auto"]\');' +
    'if(!button)throw new Error(\'动态分辨率按钮不存在\');' +
    'const before=__SE.SET.auto;let clicks=0;' +
    'if(before===' + auto + '){button.click();clicks++;}' +
    'button.click();clicks++;' +
    'return {before,after:__SE.SET.auto,button:\'[data-tog="auto"]\',clicks};})()');
  item.autoSwitch = switched;
  assert(switched.after === auto, '动态分辨率按钮切换失败', switched);
  await evaluate('(__SE.deep.open("m51"),__SE.deep.setQuality("interactive"),__SE.deep.setView("front"),__SE.deep.setView("near"),true)');
  await delay(item.warmupMs);
  item.before = await state();
  assert(item.before.auto === auto && item.before.model.active && item.before.model.id === 'm51', '测量初始状态不符合要求', item.before);
  assert(item.before.deepPerf.mode === (auto ? 'adaptive' : 'disabled'), '自适应模式不符合要求', item.before.deepPerf);
  item.raf = await evaluate('new Promise(resolve => {' +
    'const times=[],started=performance.now(),deadline=started+12000;let done=false,timer;' +
    'function finish(){if(done)return;done=true;clearTimeout(timer);' +
    'const intervals=times.slice(1).map((t,i)=>t-times[i]).sort((a,b)=>a-b);' +
    'const percentile=q=>intervals.length?intervals[Math.ceil(intervals.length*q)-1]:null;' +
    'resolve({elapsedMs:performance.now()-started,frameCount:times.length,intervalCount:intervals.length,' +
    'p50Ms:percentile(.50),p95Ms:percentile(.95),p99Ms:percentile(.99),maxIntervalMs:intervals.length?intervals[intervals.length-1]:null});}' +
    'function tick(t){if(done)return;if(performance.now()>=deadline){finish();return;}times.push(t);requestAnimationFrame(tick);}' +
    'timer=setTimeout(finish,12000);requestAnimationFrame(tick);})');
  /* 采样结束后读取状态，不将状态查询计入 rAF 样本。 */
  item.after = await state();
  item.errors = report.errors.slice(item.errorsFrom);
  assert(item.raf.intervalCount > 0, '未采集到 rAF 间隔', item.raf);
  assert(item.after.auto === auto && item.after.model.active && item.after.model.id === 'm51', '测量结束状态不符合要求', item.after);
  const cameraFields = ['yaw', 'pitch', 'distance', 'target', 'position', 'fov', 'near', 'far'];
  for (const key of cameraFields) {
    assert(item.before.model.camera[key] !== undefined && item.after.model.camera[key] !== undefined &&
      closeEnough(item.before.model.camera[key], item.after.model.camera[key]), '固定机位发生变化：' + key,
      {before:item.before.model.camera,after:item.after.model.camera});
  }
  for (const sample of [item.before, item.after]) {
    assert(sample.qualityMain === 'high', '测量主画质不是 high', sample.qualityMain);
    const expected = sample.canvas.slice(2).map(size => Math.floor(size * sample.rendererDpr));
    assert(expected.every(size => size > 0) && closeEnough(sample.canvas.slice(0, 2), expected) &&
      closeEnough(sample.buffer, expected) && closeEnough(sample.model.camera.drawingBuffer, expected) &&
      closeEnough(sample.model.camera.aspect, expected[0] / expected[1]), '画幅或绘图缓冲区尺寸不一致', sample);
  }
  assert(!item.before.gl.lost && !item.after.gl.lost && item.after.gl.lostEvents === 0, 'WebGL context lost', item.after.gl);
  assert(item.errors.length === 0, '测量期间页面异常', item.errors);
  save();
}
async function run() {
  const file = path.join(ROOT, 'space.html');
  assert(path.resolve(file).toLowerCase().replace(/\\/g, '/') === 'd:/wb/orbit/space.html', '入口路径不是指定文件', file);
  const bytes = fs.readFileSync(file), text = bytes.toString('utf8');
  report.file = {url: FILE_URL, buildMarker:(text.match(/const BUILD\s*=\s*['"]([^'"]+)/)||[])[1]||null, sha256:hash(file), bytes:bytes.length};
  assert(report.file.buildMarker === 'v197', '入口构建不是 v197', report.file);
  assert(process.env.ORBIT_GPU !== '0', '禁止软件渲染参数 ORBIT_GPU=0');
  const chrome = chromePath(); assert(chrome, '未找到 Chrome；请设置 CHROME_PATH');
  report.chromeHash = {path:chrome, sha256:hash(chrome)}; save();
  await launch();
  assert(path.resolve(report.launch.chrome) === path.resolve(chrome), '实际浏览器路径不一致');
  phase = '加载文件入口';
  report.ready = await load(FILE_URL, 'file'); report.initial = await state(); save();
  assert(report.initial.build === 'v197', '运行构建不是 v197', report.initial.build);
  assert(report.initial.qualityMain === 'high', '初始主画质不是 high，无法与历史数据比较', report.initial.qualityMain);
  const renderer = report.initial.gl.unmaskedRenderer;
  assert(renderer && !/swiftshader|llvmpipe|softpipe|software|microsoft basic render/i.test(renderer), '未确认真实硬件 GPU', report.initial.gl);
  await scenario(0); await scenario(1);
  assert(report.errors.length === 0, '页面发生异常', report.errors);
}
(async () => {
  try { await run(); }
  catch (e) { report.fatal = {phase, error:errorText(e), details:e.details}; }
  finally {
    if (report.file) try { report.file.sha256After = hash(path.join(ROOT, 'space.html')); }
      catch (e) { report.hashError = errorText(e); }
    if (report.chromeHash) try { report.chromeHash.sha256After = hash(report.chromeHash.path); }
      catch (e) { report.hashError = errorText(e); }
    cleanupPromise = Promise.resolve();
    if (browser) {
      try { await browser.send('Browser.close'); } catch (e) { report.closeError = errorText(e); }
      browser.ws.close();
    } else if (child && child.exitCode === null && child.signalCode === null) child.kill();
    report.finishedAt = new Date().toISOString();
    report.ok = !report.fatal && !report.hashError && !report.closeError && report.errors.length === 0 && report.tests.length === 2 &&
      !!report.file?.sha256After && report.file.sha256 === report.file.sha256After &&
      !!report.chromeHash?.sha256After && report.chromeHash.sha256 === report.chromeHash.sha256After;
    save(); console.log('报告 ' + OUTPUT); console.log(JSON.stringify({ok:report.ok,fatal:report.fatal,errors:report.errors}));
    process.exitCode = report.ok ? 0 : 1;
  }
})();
`;
vm.runInThisContext(`(function(require,__dirname,__filename,process,Buffer,WebSocket){\n${base.slice(0, cut)}\n${probe}\n})`, { filename: __filename })(require, __dirname, __filename, process, Buffer, WebSocket);
