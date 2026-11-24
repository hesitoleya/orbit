'use strict';
// Real WebGL2 timer queries on the user's actual local file. Non-invasive: all
// instrumentation is installed in the temporary browser session only.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const framework = path.join(__dirname, 'test-deep-models.cjs');
const base = fs.readFileSync(framework, 'utf8');
const cut = base.indexOf('async function main() {');
if (cut < 0) throw new Error('CDP framework boundary was not found');

const probe = String.raw`
const OUTPUT = path.join(ROOT, 'v197-gpu-pass-timer-' + RUN_ID + '.json');
report.kind = 'v197-gpu-pass-timer';
report.notes = [
  '真实 WebGL2 EXT_disjoint_timer_query_webgl2 非阻塞查询；仅测已标记的 GPU 命令区间，不能测单次 draw 内部的噪声/吸收等细项。',
  '体积和恒星区间由对象 onBeforeRender/onAfterRender 包围对应 draw，不包含同一场景的 clear、场景目标绑定或前期准备。',
  '后处理每次区间包围 renderer.render；目标绑定和明确的 clear 在调用前，可能存在被延迟的 MSAA resolve，不等同纯 shader 耗时；遗漏区间不可相加成整帧。',
  '计时期间长时稳定性或其他浏览器可能同时使用同一 GPU；结果只描述本次共享负载，不代表独占硬件基准。',
  '固定 960×640、DPR 1、high、auto=0、interactive、M51 near；启动后预热，图形状态变化或计时 disjoint 导致的样本按报告丢弃。',
  '耗时是 GPU 定时器的区间采样，不是 rAF、显存、物理画质或最终优化收益；样本跨帧交错且有可能被驱动调度影响。'
];
function save() { fs.writeFileSync(OUTPUT, JSON.stringify(report, null, 2)); }
function sha(file) { return createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function instrumentation() {
  const r = __SE.renderer, gl = r.getContext(), ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  if (!ext || typeof gl.createQuery !== 'function') return { supported: false, reason: 'WebGL2 timer query extension unavailable' };
  const active = gl.getQuery(ext.TIME_ELAPSED_EXT, gl.CURRENT_QUERY);
  if (active) return { supported: false, reason: 'another elapsed query is active' };
  const deep = __SE.deep.controller.scene, objects = [];
  deep.traverse(o => { if (o.name === 'AnalyticVolumeRayIntegral' || o.name === 'VolumeExtinguishedStars') objects.push(o); });
  const volume = objects.filter(o => o.name === 'AnalyticVolumeRayIntegral');
  const stars = objects.filter(o => o.name === 'VolumeExtinguishedStars');
  if (volume.length !== 1 || stars.length !== 1) throw Error('unexpected M51 object counts ' + JSON.stringify(objects.map(o => o.name)));
  const origRender = r.render;
  const saved = objects.map(o => ({object:o,before:o.onBeforeRender,after:o.onAfterRender}));
  const state = { started: performance.now(), enabled:true, frame:0, post:0, pending:[], samples:[], failures:[], dropped:0, disjoint:0, maxPending:0, seen:{}, hookActive:null };
  function noteFailure(where, error) { state.failures.push({where, message:String(error && error.message || error), at:performance.now()}); }
  function harvest() {
    if (gl.isContextLost()) { state.failures.push({where:'harvest',message:'WebGL context lost',at:performance.now()}); return; }
    const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
    if (disjoint) {
      state.disjoint++;
      for (const item of state.pending) gl.deleteQuery(item.q);
      state.dropped += state.pending.length;
      state.pending.length = 0;
      return;
    }
    const waiting = [];
    for (const item of state.pending) {
      if (gl.getQueryParameter(item.q, gl.QUERY_RESULT_AVAILABLE)) {
        const ns = gl.getQueryParameter(item.q, gl.QUERY_RESULT);
        if (Number.isFinite(ns) && ns >= 0) state.samples.push({label:item.label, frame:item.frame, ms:ns/1e6, target:item.target});
        else { state.dropped++; noteFailure('query-result', 'non-finite or negative GPU time'); }
        gl.deleteQuery(item.q);
      } else waiting.push(item);
    }
    state.pending = waiting;
  }
  function begin(label, target) {
    if (!state.enabled || gl.isContextLost()) return null;
    state.seen[label] = (state.seen[label] || 0) + 1;
    if (state.pending.length >= 64 || state.hookActive) { state.dropped++; return null; }
    let q;
    try {
      q = gl.createQuery();
      if (!q) throw Error('createQuery returned null');
      gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
      state.hookActive = {q,label,frame:state.frame,target};
      return state.hookActive;
    } catch (error) { if (q) gl.deleteQuery(q); noteFailure('begin-'+label,error); return null; }
  }
  function end(token) {
    if (!token) return;
    try {
      if (state.hookActive !== token) throw Error('query token mismatch');
      gl.endQuery(ext.TIME_ELAPSED_EXT);
      state.pending.push(token);
      state.maxPending = Math.max(state.maxPending, state.pending.length);
    } catch (error) { try { gl.deleteQuery(token.q); } catch (_) {} noteFailure('end-'+token.label,error); }
    finally { state.hookActive = null; }
  }
  for (const savedObject of saved) {
    const o = savedObject.object, label = o === volume[0] ? 'volume-draw' : 'stars-draw';
    let token = null;
    o.onBeforeRender = function(...args) {
      if (savedObject.before) savedObject.before.apply(this,args);
      token = begin(label,'HDR-scene-target');
    };
    o.onAfterRender = function(...args) {
      end(token); token = null;
      if (savedObject.after) savedObject.after.apply(this,args);
    };
  }
  r.render = function(s,c,...args) {
    if (s === deep) {
      try { harvest(); } catch (error) { noteFailure('harvest',error); }
      state.frame++; state.post = 0;
      return origRender.call(this,s,c,...args);
    }
    state.post++;
    const target = r.getRenderTarget();
    const dims = target ? [target.width,target.height] : [gl.drawingBufferWidth,gl.drawingBufferHeight];
    const label = 'post-render-' + state.post;
    const token = begin(label,{defaultFramebuffer:target===null,dimensions:dims});
    try { return origRender.call(this,s,c,...args); }
    finally { end(token); }
  };
  window.__orbitGpuProbe = {
    state,
    async stop() {
      state.enabled = false;
      r.render = origRender;
      for (const s of saved) { s.object.onBeforeRender = s.before; s.object.onAfterRender = s.after; }
      const deadline = performance.now()+6000;
      while (state.pending.length && performance.now()<deadline && !gl.isContextLost()) {
        harvest();
        if (state.pending.length) await new Promise(resolve => setTimeout(resolve,50));
      }
      const remaining = state.pending.length;
      for (const item of state.pending) gl.deleteQuery(item.q);
      state.pending.length = 0;
      const byLabel = {};
      for (const s of state.samples) (byLabel[s.label] ||= []).push(s.ms);
      const summary = {};
      for (const [label, values] of Object.entries(byLabel)) {
        values.sort((a,b)=>a-b); const p=q=>values[Math.ceil(values.length*q)-1];
        summary[label] = {n:values.length,p50Ms:p(.5),p95Ms:p(.95),minMs:values[0],maxMs:values.at(-1)};
      }
      return {elapsedMs:performance.now()-state.started, frames:state.frame, seen:state.seen,
        summary, samples:state.samples, failures:state.failures, dropped:state.dropped,
        disjointCount:state.disjoint, pendingAtTimeout:remaining, maxPending:state.maxPending,
        hooksRestored:r.render===origRender && saved.every(s=>s.object.onBeforeRender===s.before && s.object.onAfterRender===s.after)};
    }
  };
  return { supported:true, objects:objects.map(o=>({name:o.name,type:o.type})), extension:'EXT_disjoint_timer_query_webgl2' };
}
async function state() {
  return evaluate("(()=>{const r=__SE.renderer,g=r.getContext(),x=g.getExtension('WEBGL_debug_renderer_info');return {build:__SE.build,url:location.href,visibility:document.visibilityState,viewport:[innerWidth,innerHeight],deviceDpr:devicePixelRatio,rendererDpr:r.getPixelRatio(),canvas:[r.domElement.width,r.domElement.height],buffer:[g.drawingBufferWidth,g.drawingBufferHeight],model:__SE.deep.info(),auto:__SE.SET.auto,qualityMain:__SE.SET.q,gpu:{version:g.getParameter(g.VERSION),renderer:x&&g.getParameter(x.UNMASKED_RENDERER_WEBGL),vendor:x&&g.getParameter(x.UNMASKED_VENDOR_WEBGL),lost:g.isContextLost(),lostEvents:window.__deepProbe.contextLost}}})()");
}
async function run() {
  const file=path.join(ROOT,'space.html');
  report.entry={file,url:FILE_URL,sha256:sha(file)}; save();
  assert(process.env.ORBIT_GPU !== '0','拒绝软件渲染参数');
  await launch();
  report.ready=await load(FILE_URL,'file');
  await evaluate('(__SE.deep.open("m51"),__SE.deep.setQuality("interactive"),__SE.deep.setView("front"),__SE.deep.setView("near"),true)');
  await delay(7000);
  report.before=await state(); save();
  assert(report.before.build==='v197' && report.before.model.id==='m51' && report.before.model.active,'入口版本或目标不符',report.before);
  assert(report.before.auto===0 && report.before.qualityMain==='high' && report.before.model.rendering.quality==='interactive','测试画质设置不符',report.before);
  assert(report.before.gpu.renderer && !/swiftshader|llvmpipe|software|basic render/i.test(report.before.gpu.renderer),'未确认真实硬件 GPU',report.before.gpu);
  phase='安装查询';
  report.probe=await evaluate('('+instrumentation.toString()+')()'); save();
  if (!report.probe.supported) { report.unsupported=true; return; }
  phase='GPU 查询采样';
  await delay(16000);
  report.results=await evaluate('window.__orbitGpuProbe.stop()');
  report.after=await state(); save();
  assert(report.results.hooksRestored,'浏览器临时钩子未恢复',report.results);
  assert(report.results.failures.length===0,'GPU 查询出现错误',report.results.failures);
  assert(report.results.disjointCount===0,'采样时报告 GPU disjoint',report.results);
  assert(report.results.pendingAtTimeout===0,'GPU 查询结果未全部返回',report.results);
  for (const key of ['volume-draw','stars-draw','post-render-1','post-render-2','post-render-3','post-render-4','post-render-5','post-render-6','post-render-7']) {
    assert(report.results.summary[key] && report.results.summary[key].n>=3,'计时有效样本不足：'+key,report.results);
  }
  assert(report.after.build===report.before.build && report.after.model.id==='m51' && report.after.model.active,'测量期间目标变化',report.after);
  assert(report.after.rendererDpr===report.before.rendererDpr && JSON.stringify(report.after.buffer)===JSON.stringify(report.before.buffer),'测量期间分辨率变化', {before:report.before,after:report.after});
  assert(!report.after.gpu.lost && report.after.gpu.lostEvents===0,'测量期间 context lost',report.after.gpu);
  assert(report.errors.length===0,'浏览器错误',report.errors);
}
(async()=>{
  try { await run(); }
  catch(e) { report.fatal={phase,error:errorText(e),details:e.details}; }
  finally {
    if (report.entry) try {report.entry.sha256After=sha(path.join(ROOT,'space.html'));} catch(e){report.hashError=errorText(e);}
    cleanupPromise=Promise.resolve();
    if(browser){try{await browser.send('Browser.close');}catch(e){report.closeError=errorText(e);}browser.ws.close();}
    else if(child && child.exitCode===null && child.signalCode===null)child.kill();
    report.finishedAt=new Date().toISOString();
    report.ok=!report.fatal && !report.unsupported && !report.hashError && !report.closeError && report.errors.length===0 && report.entry?.sha256===report.entry?.sha256After;
    save();console.log('报告 '+OUTPUT);console.log(JSON.stringify({ok:report.ok,unsupported:report.unsupported,fatal:report.fatal,summary:report.results?.summary}));
    process.exitCode=report.ok?0:1;
  }
})();
`;
vm.runInThisContext(`(function(require,__dirname,__filename,process,Buffer,WebSocket){\n${base.slice(0,cut)}\n${probe}\n})`, {filename:__filename})(require,__dirname,__filename,process,Buffer,WebSocket);
