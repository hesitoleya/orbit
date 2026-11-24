'use strict';
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const base = fs.readFileSync(path.join(__dirname, 'test-deep-models.cjs'), 'utf8');
const cut = base.indexOf('async function main() {');
if (cut < 0) throw Error('测试框架边界未找到');
const probe = String.raw`
const OUTPUT = path.join(ROOT, 'v197-file-hardware-long-' + RUN_ID + '.json');
const file = path.join(ROOT, 'space.html');
const hash = () => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const save = () => fs.writeFileSync(OUTPUT, JSON.stringify(report, null, 2));
report.kind = 'v197-file-hardware-long-independent';
report.notes = ['真实文件入口，独立 headless Chrome；缓存禁用，绕过 service worker。', 'rAF 间隔包括浏览器调度和渲染提交，不是 GPU 耗时；其他浏览器测试可能并行，结果不具有排他性能代表性。', 'performance.memory 是 Chromium 非标准 JS 堆估计值，可能被量化或受 GC 影响，不包括 GPU 显存、浏览器总内存或其他进程，不能单凭它判断泄漏。', '切换通过产品公开调试 API 执行，检查切换前后模型 ID 与活动状态，不等同于 UI 点击或视觉正确性。'];
async function state() { return evaluate("(()=>{const r=__SE.renderer,g=r.getContext(),x=g.getExtension('WEBGL_debug_renderer_info'),m=performance.memory,i=__SE.deep.info();return {url:location.href,build:__SE.build,visibility:document.visibilityState,model:{id:i.id,active:i.active,disposed:i.disposed},gl:{renderer:g.getParameter(g.RENDERER),unmaskedRenderer:x&&g.getParameter(x.UNMASKED_RENDERER_WEBGL),vendor:g.getParameter(g.VENDOR),version:g.getParameter(g.VERSION),lost:g.isContextLost(),lostEvents:window.__deepProbe.contextLost},memory:m?{usedJSHeapSize:m.usedJSHeapSize,totalJSHeapSize:m.totalJSHeapSize,jsHeapSizeLimit:m.jsHeapSizeLimit}:null,threeMemory:{...r.info.memory}}})()"); }
async function startRaf() { await evaluate("(()=>{const a=window.__longRaf={times:[],started:performance.now(),done:false};function tick(t){if(a.done)return;a.times.push(t);requestAnimationFrame(tick)}requestAnimationFrame(tick)})()"); }
async function raf(stop) { return evaluate("(()=>{const a=window.__longRaf;if("+stop+")a.done=true;const d=a.times.slice(1).map((t,i)=>t-a.times[i]).sort((x,y)=>x-y),p=q=>d.length?d[Math.ceil(d.length*q)-1]:null;return {elapsedMs:performance.now()-a.started,frameCount:a.times.length,intervalCount:d.length,p50Ms:p(.5),p95Ms:p(.95),p99Ms:p(.99),maxMs:d.length?d[d.length-1]:null,over33:d.filter(x=>x>33.333).length,over50:d.filter(x=>x>50).length}})()"); }
async function run() {
  const bytes=fs.readFileSync(file), text=bytes.toString('utf8');
  report.file={url:FILE_URL,buildMarker:(text.match(/const BUILD\s*=\s*['"]([^'"]+)/)||[])[1]||null,sha256:hash(),bytes:bytes.length}; save();
  assert(report.file.buildMarker==='v197','入口不是 v197',report.file);
  assert(process.env.ORBIT_GPU!=='0','禁止软件渲染参数');
  await launch(); phase='加载文件入口'; report.ready=await load(FILE_URL,'file'); report.initial=await state(); save();
  assert(report.initial.build==='v197' && report.initial.url.startsWith('file:///D:/WB/orbit/space.html?'),'运行入口或版本错误',report.initial);
  assert(report.initial.gl.unmaskedRenderer && !/swiftshader|llvmpipe|softpipe|software|microsoft basic render/i.test(report.initial.gl.unmaskedRenderer),'未确认硬件 GPU',report.initial.gl);
  await startRaf(); report.measurementStartedAt=new Date().toISOString(); const started=performance.now();
  const ids=['m51','m42','47tuc'];
  for(let n=0;n<40;n++) {
    phase='切换 '+(n+1); const target=ids[n%ids.length]; const item={index:n+1,target,at:new Date().toISOString()}; report.tests.push(item);
    try {
      item.before=await state();
      item.openResult=await evaluate('(__SE.deep.open('+JSON.stringify(target)+'),__SE.deep.setQuality("interactive"),__SE.deep.setView("near"),true)');
      await until('模型切换 '+target,async()=>{const s=await state();return s.model.active && s.model.id===target?s:false},30000);
      item.after=await state(); item.success=item.after.model.active && item.after.model.id===target && item.before.model.id!==target && !item.after.gl.lost;
    } catch(e) { item.success=false; item.error=errorText(e); }
    item.raf=await raf(false); save();
    const wait=started+(n+1)*30000-performance.now(); if(wait>0) await delay(wait);
  }
  report.measurementElapsedMs=performance.now()-started; report.final=await state(); report.raf=await raf(true); save();
}
(async()=>{try{await run()}catch(e){report.fatal={phase,error:errorText(e),details:e.details}}finally{
  try{report.file.sha256After=hash()}catch(e){report.hashError=errorText(e)}
  cleanupPromise=Promise.resolve(); if(browser){try{await browser.send('Browser.close')}catch(e){report.closeError=errorText(e)}browser.ws.close()}else if(child&&child.exitCode===null&&child.signalCode===null)child.kill();
  report.finishedAt=new Date().toISOString(); report.ok=!report.fatal&&!report.hashError&&!report.closeError&&report.measurementElapsedMs>=1200000&&report.tests.length>=30&&report.tests.every(x=>x.success)&&!report.final?.gl.lost&&report.final?.gl.lostEvents===0&&report.errors.length===0&&report.file.sha256===report.file.sha256After;
  save();console.log('报告 '+OUTPUT);console.log(JSON.stringify({ok:report.ok,fatal:report.fatal,elapsed:report.measurementElapsedMs,tests:report.tests.length,errors:report.errors.length}));process.exitCode=report.ok?0:1;
}})();
`;
vm.runInThisContext(`(function(require,__dirname,__filename,process,Buffer,WebSocket){\n${base.slice(0,cut)}\n${probe}\n})`,{filename:__filename})(require,__dirname,__filename,process,Buffer,WebSocket);
