'use strict';

// 仅复用既有探针的离线 CDP 管道构造，不执行其 main 或原专项代码。
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const parentProbe = path.join(__dirname, 'probe-deep-perf-path-20261116.cjs');
const frameworkPath = path.join(__dirname, 'test-deep-models.cjs');
const reportPath = path.join(root, `deep-adaptive-v194-${crypto.randomUUID()}.json`);
const checkOnly = process.argv.includes('--check-vm');
let fd;
if (!checkOnly) fd = fs.openSync(reportPath, 'wx');
try {
  const original = fs.readFileSync(parentProbe, 'utf8');
  const begin = original.indexOf('  const framework = fs.readFileSync(frameworkPath');
  const end = original.indexOf('  const probe = String.raw`', begin);
  if (begin < 0 || end < 0) throw new Error('离线探针框架边界不匹配');
  // 复用相同的严格字符串校验和 pipe 改造；只求值框架构造部分。
  const setup = original.slice(begin, end) + '\nreturn prefix;';
  const prefix = new Function('fs', 'frameworkPath', setup)(fs, frameworkPath);
  const probe = String.raw`
const ENTRY = path.join(ROOT,'space.html');
const APP = path.join(ROOT,'public/js/app.js');
const OUT = ${JSON.stringify(reportPath)};
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
report.kind='offline-deep-adaptive-v194';
report.urls={file:FILE_URL}; report.viewport={width:480,height:320,dpr:1};
report.notes=[
 '仅通过 file 入口及 CDP pipe 操作自建 Chrome，阻断主 target 外部请求；非系统级网络审计。',
 '通过未修改的真实 rAF 动画与自然帧间隔驱动自适应；时间和调度结果不代表真实 GPU 的性能。',
 'M51 完整与降倍率图仅为固定机位、固定颗粒相位的单次对照；不冻结全部状态，不要求像素哈希相等，也不代表动态视觉验收。',
 '只关闭自己创建的浏览器，不删除隔离 profile。'
];
report.provenance={entry:{path:ENTRY,before:hash(ENTRY)},app:{path:APP,before:hash(APP)},framework:{path:${JSON.stringify(frameworkPath)},sha256:hash(${JSON.stringify(frameworkPath)})},baseProbe:{path:${JSON.stringify(parentProbe)},sha256:hash(${JSON.stringify(parentProbe)})},probe:{path:${JSON.stringify(__filename)},sha256:hash(${JSON.stringify(__filename)})}};
const oldEvent=onEvent;
onEvent=function(event){
 if(event.sessionId===session && event.method==='Fetch.requestPaused'){
  const p=event.params,url=p.request.url,allowed=/^(?:file|data|blob|about):/i.test(url);
  if(!allowed)recordError('阻止离线外部请求',{url});
  send(allowed?'Fetch.continueRequest':'Fetch.failRequest',allowed?{requestId:p.requestId}:{requestId:p.requestId,errorReason:'BlockedByClient'}).catch(error=>recordError('拦截失败',{url,error:errorText(error)})); return;
 }
 oldEvent(event);
};
const near=(a,b)=>Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<1e-6;
async function state(){return evaluate(` + "`" + `(()=>{const s=__SE,r=s.renderer,v=new s.THREE.Vector2(),vp=new s.THREE.Vector4(),sc=new s.THREE.Vector4();r.getSize(v);r.getViewport(vp);r.getScissor(sc);return {url:location.href,build:s.build,auto:s.SET.auto,perf:{...s.PERF},deepPerf:s.deep.perf(),deep:s.deep.info(),dpr:devicePixelRatio,pixelRatio:r.getPixelRatio(),canvas:[r.domElement.width,r.domElement.height],size:v.toArray(),viewport:vp.toArray(),scissor:sc.toArray(),scissorTest:r.getScissorTest(),target:r.getRenderTarget()?.uuid||null,face:r.getActiveCubeFace(),mip:r.getActiveMipmapLevel(),aspect:s.camera.aspect,autoClear:r.autoClear,diagnostics:s.screenshotDiagnostics}})()` + "`" + `)}
async function capture(label,expression){
 const result=await evaluate(expression); const url=typeof result==='string'?result:result&&result.url;
 assert(typeof url==='string'&&url.startsWith('data:image/png;base64,'),'截图未返回 PNG',{label,result:typeof result==='string'?result.slice(0,100):result});
 const bytes=Buffer.from(url.slice(url.indexOf(',')+1),'base64');
 assert(bytes.length>24 && bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),'PNG 无效',{label,bytes:bytes.length});
 return {label,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20),meta:typeof result==='object'?{w:result.w,h:result.h,msaa:result.msaa}:null};
}
async function gl(){return evaluate(` + "`" + `(()=>{const g=__SE.renderer.getContext(),errors=[];for(let i=0;i<16;i++){const e=g.getError();if(e===g.NO_ERROR)break;errors.push(e)}const x=g.getExtension('WEBGL_debug_renderer_info');return {errors,lost:g.isContextLost(),contextLost:window.__deepProbe.contextLost,renderer:g.getParameter(g.RENDERER),unmasked:x?g.getParameter(x.UNMASKED_RENDERER_WEBGL):null}})()` + "`" + `)}
async function sample(){return evaluate(` + "`" + `(async()=>{const times=[],states=[];await new Promise(resolve=>{function tick(t){times.push(t);states.push({perf:{...__SE.PERF},deepPerf:__SE.deep.perf(),pixelRatio:__SE.renderer.getPixelRatio()});if(times.length===10)resolve();else requestAnimationFrame(tick)}requestAnimationFrame(tick)});return {times,intervals:times.slice(1).map((t,i)=>t-times[i]),states}})()` + "`" + `)}
async function drive(){return evaluate(` + "`" + `(async()=>{const before=__SE.deep.perf(),trace=[];await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('等待自然慢帧降档超时')),90000);function tick(t){trace.push({time:t,...__SE.deep.perf()});if(__SE.deep.perf().scale<1){clearTimeout(timer);resolve()}else if(trace.length>=120){clearTimeout(timer);reject(Error('连续 120 帧未自然降档'))}else requestAnimationFrame(tick)}requestAnimationFrame(tick)});return {before,trace,after:__SE.deep.perf()}})()` + "`" + `)}
function samePerf(a,b){return JSON.stringify(a)===JSON.stringify(b)}
function full(s){return near(s.pixelRatio,1) && near(s.deepPerf.effectiveScale,1)}
async function run(){
 assert(FILE_URL==='file:///D:/WB/orbit/space.html?auto=0&q=high','入口不符',FILE_URL);
 assert(fs.readFileSync(ENTRY,'utf8').includes("const BUILD = 'v194';"),'入口不是 v194');
 await launch(); await send('Fetch.enable',{patterns:[{urlPattern:'*',requestStage:'Request'}]});
 phase='离线加载'; report.ready=await load(FILE_URL,'file'); assert(report.ready.url===FILE_URL,'URL 不符',report.ready);
 report.initial=await state(); assert(report.initial.build==='v194'&&report.initial.auto===0,'初始状态不符',report.initial);
 phase='启用 auto 并打开 M51';
 report.enabled=await evaluate(` + "`" + `(()=>{document.querySelector('[data-tog="auto"]').click();__SE.deep.open('m51');__SE.deep.setView('near');return {auto:__SE.SET.auto,on:__SE.PERF.on,deep:__SE.deep.info()}})()` + "`" + `);
 assert(report.enabled.auto===1&&report.enabled.on&&report.enabled.deep.active&&report.enabled.deep.id==='m51'&&near(report.enabled.deep.camera.distance,.35),'启用或 M51 near 失败',report.enabled);
 report.baseline=await state(); report.raf=await sample(); report.afterRaf=await state();
 assert(report.raf.intervals.length===9&&report.raf.intervals.every(v=>Number.isFinite(v)&&v>0),'真实 rAF 样本无效',report.raf);
 assert(samePerf(report.baseline.perf,report.afterRaf.perf)&&report.raf.states.every(x=>samePerf(x.perf,report.baseline.perf)),'DEEP 改变主 PERF',report.raf);
 phase='自然 rAF 驱动降档';
 /* Start a new observation window and wait for the real animation loop. */
 await evaluate("(__SE.deep.setQuality('interactive'),true)");
 report.drive=await drive(); report.reduced=await state();
 assert(report.drive.trace.length>0&&report.drive.after.scale<1&&report.drive.after.scale>=.6&&near(report.reduced.pixelRatio,report.drive.after.scale)&&samePerf(report.baseline.perf,report.reduced.perf),'降档或主 PERF 隔离失败',report.drive);
 phase='低 DPR 截图与恢复'; report.screens=[];
 for(const [label,expr,w,h] of [['snap',"__SE.snap('image/png',{gradePhase:0})",null,null],['shot-small',"__SE.shot(96,64,'image/png',{gradePhase:0})",96,64],['shot-wide',"__SE.shot(240,120,'image/png',{gradePhase:0})",240,120]]){
  /* Read state and execute screenshot in one JS task so a real rAF cannot
     change DPR between the compared snapshots. */
  const data=await evaluate(` + "`" + `(async()=>{const s=__SE,r=s.renderer,T=s.THREE,g=r.getContext();const state=()=>{const z=new T.Vector2(),v=new T.Vector4(),c=new T.Vector4();r.getSize(z);r.getViewport(v);r.getScissor(c);return {pixelRatio:r.getPixelRatio(),canvas:[r.domElement.width,r.domElement.height],buffer:[g.drawingBufferWidth,g.drawingBufferHeight],size:z.toArray(),viewport:v.toArray(),scissor:c.toArray(),scissorTest:r.getScissorTest(),target:r.getRenderTarget()?.uuid||null,face:r.getActiveCubeFace(),mip:r.getActiveMipmapLevel(),aspect:s.camera.aspect,deepAspect:s.deep.controller.camera.aspect,deepBuffer:s.deep.info().camera.drawingBuffer,autoClear:r.autoClear,diagnostics:s.screenshotDiagnostics}};const before=state(),result=\${expr},after=state();return {before,after,result}})()` + "`" + `);
  const before=data.before,after=data.after,result=data.result,url=typeof result==='string'?result:result&&result.url;
  assert(typeof url==='string'&&url.startsWith('data:image/png;base64,'),'截图未返回 PNG',{label});
  const bytes=Buffer.from(url.slice(url.indexOf(',')+1),'base64');
  assert(bytes.length>24&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),'PNG 无效',{label});
  const image={label,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20)};
  if(label==='snap'){image.file=path.join(ROOT,'deep-adaptive-v194-'+RUN_ID+'-reduced.png');fs.writeFileSync(image.file,bytes,{flag:'wx'});}
  const keys=['pixelRatio','canvas','buffer','size','viewport','scissor','scissorTest','target','face','mip','aspect','deepAspect','deepBuffer','autoClear'];
  const diff=Object.fromEntries(keys.filter(k=>JSON.stringify(before[k])!==JSON.stringify(after[k])).map(k=>[k,{before:before[k],after:after[k]}]));
  const health=await gl();report.screens.push({label,before,image,after,diff,health});
  assert(before.pixelRatio<1&&image.width===(w||before.canvas[0])&&image.height===(h||before.canvas[1])&&Object.keys(diff).length===0&&!after.diagnostics.recoveryRisk&&after.diagnostics.restoreErrors.length===0&&!health.lost&&!health.contextLost&&!health.errors.length,'低 DPR 截图或状态恢复失败',report.screens.at(-1));
 }
 phase='低倍率编码异常恢复';
 report.encodeFault=await evaluate(` + "`" + `(()=>{const s=__SE,r=s.renderer,c=r.domElement,g=r.getContext(),old=c.toDataURL,sentinel=Error('deep-encode-fault');const state=()=>({pr:r.getPixelRatio(),canvas:[c.width,c.height],buffer:[g.drawingBufferWidth,g.drawingBufferHeight],deepAspect:s.deep.controller.camera.aspect,diagnostics:s.screenshotDiagnostics});const before=state();let error;try{c.toDataURL=()=>{throw sentinel};s.shot(96,64)}catch(e){error=e}finally{c.toDataURL=old}return {before,after:state(),same:error===sentinel}})()` + "`" + `);
 assert(report.encodeFault.same&&report.encodeFault.before.pr<1&&JSON.stringify(report.encodeFault.before)===JSON.stringify(report.encodeFault.after),'低倍率截图编码异常后的状态不一致',report.encodeFault);
 phase='完整与降倍率画面对照';
 report.visualOff=await evaluate(` + "`" + `(()=>{document.querySelector('[data-tog="auto"]').click();return {auto:__SE.SET.auto,pr:__SE.renderer.getPixelRatio()}})()` + "`" + `);
 assert(report.visualOff.auto===0&&near(report.visualOff.pr,1),'对照未恢复基准像素比',report.visualOff);
 const full=await evaluate("__SE.snap('image/png',{gradePhase:0})");
 assert(typeof full==='string'&&full.startsWith('data:image/png;base64,'),'完整倍率对照图片缺失');
 const fullBytes=Buffer.from(full.slice(full.indexOf(',')+1),'base64'),fullFile=path.join(ROOT,'deep-adaptive-v194-'+RUN_ID+'-full.png');
 fs.writeFileSync(fullFile,fullBytes,{flag:'wx'});report.fullImage={file:fullFile,bytes:fullBytes.length,sha256:createHash('sha256').update(fullBytes).digest('hex'),width:fullBytes.readUInt32BE(16),height:fullBytes.readUInt32BE(20)};
 assert(report.fullImage.width===480&&report.fullImage.height===320,'完整倍率图尺寸不符',report.fullImage);
 await evaluate("document.querySelector('[data-tog=auto]').click()");await drive();
 phase='窗口与设备 DPR 切换'; report.resize=[];
 const metrics=async(width,height,dpr)=>{await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:dpr,mobile:false});await evaluate(` + "`" + `(async()=>{await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));return true})()` + "`" + `);return state()};
 for(const [width,height,dpr] of [[480,240,1],[360,480,2],[480,320,1]]){
  const state=await metrics(width,height,dpr);report.resize.push({width,height,dpr,state});
  assert(state.deep.active&&near(state.dpr,dpr)&&JSON.stringify(state.size)===JSON.stringify([width,height])&&near(state.aspect,width/height)&&near(state.deep.camera.aspect,state.deep.camera.drawingBuffer[0]/state.deep.camera.drawingBuffer[1]),'窗口或深空相机宽高比未同步',report.resize.at(-1));
  assert(near(state.pixelRatio,Math.min(dpr,2)*state.deepPerf.effectiveScale),'设备 DPR 与深空倍率不一致',report.resize.at(-1));
  assert(Math.abs(state.canvas[0]-Math.floor(width*state.pixelRatio))<=1&&Math.abs(state.canvas[1]-Math.floor(height*state.pixelRatio))<=1,'画布像素尺寸不匹配',report.resize.at(-1));
  assert(JSON.stringify(state.deep.camera.drawingBuffer)===JSON.stringify(state.canvas),'深空实际 drawing buffer 未同步',report.resize.at(-1));
 }
 phase='质量模式即时切换'; report.quality=[];
 for(const mode of ['reference','reference512','interactive']){
  if(mode==='reference512') { await evaluate("__SE.deep.setQuality('interactive')"); const driven=await drive(); assert(driven.after.scale<1,'reference512 前未降档',driven); }
  const item=await evaluate('(()=>{__SE.deep.setQuality('+JSON.stringify(mode)+');return {quality:__SE.deep.controller.getQuality(),deepPerf:__SE.deep.perf(),pixelRatio:__SE.renderer.getPixelRatio()}})()');
  report.quality.push(item); assert(item.quality===mode&&near(item.pixelRatio,1),'质量切换未即时恢复基准 DPR',item);
 }
 phase='参考档跨模型与非法质量'; report.qualityModels=[];
 for(const mode of ['reference','reference512']){
  await evaluate('__SE.deep.setQuality('+JSON.stringify(mode)+')');
  for(const id of ['m42','47tuc','m51']){
   const item=await evaluate('(()=>{__SE.deep.open('+JSON.stringify(id)+');return {id:__SE.deep.info().id,quality:__SE.deep.controller.getQuality(),perf:__SE.deep.perf()}})()');
   report.qualityModels.push({mode,...item});
   assert(item.id===id&&item.quality===mode&&item.perf.mode==='reference'&&near(item.perf.pixelRatio,1),'参考档跨模型未保持或 DPR 不符',report.qualityModels.at(-1));
  }
 }
 report.invalidQuality=await evaluate(` + "`" + `(()=>{const before={quality:__SE.deep.controller.getQuality(),pr:__SE.renderer.getPixelRatio()};let error=null;try{__SE.deep.setQuality('invalid-mode')}catch(e){error=String(e.message||e)}return {before,error,after:{quality:__SE.deep.controller.getQuality(),pr:__SE.renderer.getPixelRatio()}}})()` + "`" + `);
 assert(report.invalidQuality.error&&JSON.stringify(report.invalidQuality.before)===JSON.stringify(report.invalidQuality.after),'非法质量参数未拒绝或改变状态',report.invalidQuality);
 phase='auto UI 关闭与开启'; await evaluate("(__SE.deep.setQuality('interactive'),true)"); await drive();
 report.uiOff=await evaluate(` + "`" + `(()=>{const before=__SE.deep.perf();document.querySelector('[data-tog="auto"]').click();return {before,auto:__SE.SET.auto,on:__SE.PERF.on,perf:__SE.deep.perf(),pixelRatio:__SE.renderer.getPixelRatio()}})()` + "`" + `);
 assert(report.uiOff.before.scale<1&&report.uiOff.auto===0&&!report.uiOff.on&&report.uiOff.perf.mode==='disabled'&&near(report.uiOff.pixelRatio,1),'关闭 auto 未即时恢复',report.uiOff);
 report.uiOn=await evaluate(` + "`" + `(()=>{document.querySelector('[data-tog="auto"]').click();return {auto:__SE.SET.auto,on:__SE.PERF.on,perf:__SE.deep.perf(),pixelRatio:__SE.renderer.getPixelRatio()}})()` + "`" + `);
 assert(report.uiOn.auto===1&&report.uiOn.on&&report.uiOn.perf.mode==='adaptive'&&near(report.uiOn.pixelRatio,1),'重新开启 auto 失败',report.uiOn);
 phase='深空期间手动画质与退出';
 await evaluate("(__SE.deep.open('m51'),__SE.deep.setView('near'),true)");await drive();
 report.manualQuality=await evaluate(` + "`" + `(()=>{const s=__SE,before={pr:s.renderer.getPixelRatio(),q:s.SET.q};document.querySelector('[data-q="low"]').click();const changed={pr:s.renderer.getPixelRatio(),q:s.SET.q,deep:s.deep.perf(),main:{...s.PERF}};s.deep.close();return {before,changed,closed:{pr:s.renderer.getPixelRatio(),q:s.SET.q,main:{...s.PERF}}}})()` + "`" + `);
 assert(report.manualQuality.before.pr<1&&report.manualQuality.changed.q==='low'&&near(report.manualQuality.changed.pr,.85)&&report.manualQuality.closed.q==='low'&&near(report.manualQuality.closed.pr,.85)&&samePerf(report.manualQuality.changed.main,report.manualQuality.closed.main),'手动画质或退出的主 DPR 不符',report.manualQuality);
 await evaluate("(document.querySelector('[data-q=high]').click(),__SE.deep.open('m51'),__SE.deep.setView('near'),true)");
 phase='模型切换与退出'; report.switches=[];
 for(const id of ['m42','47tuc']){
  await evaluate("(__SE.deep.open('m51'),__SE.deep.setView('near'),true)");
  const driven=await drive();
  const item=await evaluate('(()=>{const prior={pixelRatio:__SE.renderer.getPixelRatio(),perf:__SE.deep.perf()};__SE.deep.open('+JSON.stringify(id)+');return {prior,switched:{deep:__SE.deep.info(),perf:__SE.deep.perf(),pixelRatio:__SE.renderer.getPixelRatio()}}})()');
  report.switches.push({id,driven,...item});
  assert(item.prior.pixelRatio<1&&item.switched.deep.active&&item.switched.deep.id===id&&near(item.switched.pixelRatio,1)&&near(item.switched.perf.scale,1),'模型切换未恢复 DPR',report.switches.at(-1));
 }
 await evaluate("(__SE.deep.open('m51'),__SE.deep.setView('near'),true)"); await drive();
 report.exit=await evaluate(` + "`" + `(()=>{const before={pixelRatio:__SE.renderer.getPixelRatio(),perf:{...__SE.PERF},deep:__SE.deep.perf()};__SE.deep.close();return {before,after:{pixelRatio:__SE.renderer.getPixelRatio(),perf:{...__SE.PERF},deep:__SE.deep.info(),dpr:devicePixelRatio}}})()` + "`" + `);
 assert(report.exit.before.pixelRatio<1&&!report.exit.after.deep.active&&near(report.exit.after.pixelRatio,Math.min(report.exit.after.dpr,1)*report.exit.after.perf.scale)&&samePerf(report.exit.before.perf,report.exit.after.perf),'退出后主 DPR 或 PERF 不符',report.exit);
 report.finalHealth=await gl(); assert(!report.finalHealth.lost&&!report.finalHealth.contextLost&&!report.finalHealth.errors.length,'GL 不健康',report.finalHealth);
 assert(report.errors.length===0,'浏览器或网络错误',report.errors);
}
async function finishProbe(){
 try{await run();report.ok=!report.interrupted}catch(error){report.ok=false;report.fatal={phase,error:errorText(error),details:error.details}}
 finally{
  if(browser){try{await browser.send('Browser.close')}catch(error){report.closeError=errorText(error)}try{child.stdio[3].end()}catch(_){}}
  if(child&&child.exitCode===null&&child.signalCode===null){const exited=await new Promise(resolve=>{const timer=setTimeout(()=>resolve(false),5000);child.once('exit',()=>{clearTimeout(timer);resolve(true)});if(child.exitCode!==null||child.signalCode!==null){clearTimeout(timer);resolve(true)}});if(!exited)report.killOwnChrome=child.kill()}
  try{for(const key of ['entry','app']){const item=report.provenance[key];item.after=hash(item.path);item.unchanged=item.before===item.after;if(!item.unchanged)report.ok=false}}catch(error){report.hashError=errorText(error);report.ok=false}
  if(report.closeError||report.errors.length||report.killOwnChrome||(child&&child.exitCode!==0))report.ok=false;
  report.finishedAt=new Date().toISOString();fs.writeFileSync(${JSON.stringify(fd)},JSON.stringify(report,null,2));fs.closeSync(${JSON.stringify(fd)});
  console.log('报告：'+OUT);console.log('结果：'+(report.ok?'通过':'失败'));process.exitCode=report.ok?0:1;
 }
}
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{report.interrupted=signal;process.exitCode=1;if(browser)browser.fail(new Error('收到 '+signal));if(child&&child.exitCode===null)child.kill()});
finishProbe();
`;
  const source = `(function(require,__dirname,__filename,process,Buffer,WebSocket){\n${prefix}\n${probe}\n})`;
  const compiled = new vm.Script(source, { filename: __filename });
  if (checkOnly) console.log('VM 拼接语法检查通过');
  else compiled.runInThisContext()(require, __dirname, __filename, process, Buffer, WebSocket);
} catch (error) {
  if (fd !== undefined) {
    fs.writeFileSync(fd, JSON.stringify({ ok: false, phase: '探针初始化', error: error.stack || String(error), finishedAt: new Date().toISOString() }, null, 2));
    fs.closeSync(fd);
    console.error('报告：' + reportPath);
  }
  console.error(error.stack || String(error));
  process.exitCode = 1;
}
