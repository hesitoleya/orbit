'use strict';

// 复用现有管道框架；--check-vm 仅编译拼接结果，不启动浏览器。
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const base = path.join(__dirname, 'probe-deep-perf-path-20261116.cjs');
let source = fs.readFileSync(base, 'utf8');
const begin = source.indexOf('  const probe = String.raw`');
const end = source.indexOf('`;\n  const source =', begin);
if (begin < 0 || end < 0) throw new Error('探针拼接边界不匹配');
const probe = String.raw`
const ENTRY = path.join(ROOT,'space.html');
const OUT = \${JSON.stringify(reportPath)};
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
report.kind='v196-offline-deep-perf';
report.urls={file:FILE_URL};
report.viewport={width:480,height:320,dpr:1};
report.notes=['真实 file:// 页面和浏览器 rAF；帧间隔包含浏览器调度及渲染开销，并非 GPU 耗时。',
 '测试仅覆盖离线入口，不验证在线 M51 对照图；仅主 target 拦截外部网络请求。',
 '策略 perf() 样本与面板独立观察样本不同；reference 和 auto off 均显示经平滑的帧间隔估算 FPS，不是 GPU 计时。',
 '不删除 profile、报告或截图。'];
report.provenance={entry:{path:ENTRY,before:hash(ENTRY)},framework:{path:\${JSON.stringify(frameworkPath)},sha256:hash(\${JSON.stringify(frameworkPath)})},base:{path:path.join(ROOT,'tools/probe-deep-perf-path-20261116.cjs'),sha256:hash(path.join(ROOT,'tools/probe-deep-perf-path-20261116.cjs'))},probe:{path:\${JSON.stringify(__filename)},sha256:hash(\${JSON.stringify(__filename)})}};
const oldEvent=onEvent;
onEvent=function(event){
 if(event.sessionId===session && event.method==='Fetch.requestPaused'){
  const p=event.params,url=p.request.url,allowed=/^(?:file|data|blob|about):/i.test(url);
  if(!allowed)recordError('阻止离线外部请求',{url});
  send(allowed?'Fetch.continueRequest':'Fetch.failRequest',allowed?{requestId:p.requestId}:{requestId:p.requestId,errorReason:'BlockedByClient'}).catch(e=>recordError('拦截失败',{url,error:errorText(e)}));return;
 }
 oldEvent(event);
};
async function state(){return evaluate("(()=>({text:document.querySelector('#deepPerfStatus').textContent,open:document.querySelector('#deepPerfDetails').open,model:__SE.deep.info().id,quality:__SE.deep.info().rendering.quality,policy:__SE.deep.perf(),main:{...__SE.PERF},auto:__SE.SET.auto,visible:!document.hidden,events:[...window.__perfEvents]}))()")}
async function screenshot(label){
 await evaluate("document.querySelector('#deepPerfDetails').scrollIntoView({block:'nearest'})");
 const panel=await evaluate("(()=>{const e=document.querySelector('#deepPerfStatus'),r=e.getBoundingClientRect(),s=getComputedStyle(e);return {x:r.x,y:r.y,width:r.width,height:r.height,display:s.display,visibility:s.visibility,text:e.innerText}})()");
 assert(panel.width>0 && panel.height>0 && panel.y>=0 && panel.y+panel.height<=innerHeightPlaceholder(), '面板状态不可见',panel);
 const res=await send('Page.captureScreenshot',{format:'png',fromSurface:true});const bytes=Buffer.from(res.data,'base64');
 assert(bytes.length>100 && bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),'截图不是 PNG');
 const file=path.join(ROOT,'deep-perf-v196-'+label+'-'+RUN_ID+'.png');fs.writeFileSync(file,bytes,{flag:'wx'});
 const shot={label,file,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),panel};report.screenshots.push(shot);return shot;
}
function innerHeightPlaceholder(){return 320}
async function sample(label, expectedMode, expectedModel, expectedQuality){
 phase=label;
 const raf=await evaluate("new Promise(resolve=>{const ts=[];function tick(t){ts.push(t);if(ts.length>=16)resolve(ts);else requestAnimationFrame(tick)}requestAnimationFrame(tick)})");
 assert(raf.length===16 && raf.slice(1).every((t,i)=>Number.isFinite(t)&&t>raf[i]),'真实 rAF 时间戳无效',raf);
 const result=await until(label+' 出现真实 FPS',async()=>{const s=await state();return s.visible&&s.open&&s.model===expectedModel&&s.quality===expectedQuality&&s.policy.mode===expectedMode&&/[0-9]+(?:[.][0-9]+)? ms [/ ]+约 [0-9]+(?:[.][0-9]+)? FPS/.test(s.text)?s:false},120000);
 assert(result.text.includes('场景 '+expectedModel)&&result.text.includes('质量 '+expectedQuality)&&result.text.includes('/ '+expectedMode),'面板文字与实际状态不一致',result);
 assert(result.events.some(x=>x.includes('数据不足')),'没有观察到数据不足状态',result);
 const shot=await screenshot(label);
 report.tests.push({name:label,status:'pass',raf,intervals:raf.slice(1).map((t,i)=>t-raf[i]),state:result,screenshot:shot});
 return result;
}
async function resetEvents(){await evaluate("(window.__perfEvents=[],true)")}
async function run(){
 assert(/const BUILD\s*=\s*['"]v196['"]/.test(fs.readFileSync(ENTRY,'utf8')),'离线入口不是最终 v196 构建');
 await launch();await send('Fetch.enable',{patterns:[{urlPattern:'*',requestStage:'Request'}]});
 phase='离线页面加载';report.ready=await load(FILE_URL,'file');
 assert(report.ready.url===FILE_URL,'入口 URL 不符',report.ready);
 await evaluate("(()=>{const e=document.querySelector('#deepPerfStatus');window.__perfEvents=[e.textContent];new MutationObserver(()=>window.__perfEvents.push(e.textContent)).observe(e,{childList:true,characterData:true,subtree:true});__SE.PERF.on=true;__SE.SET.auto=1;return true})()");
 await frames(5);
 phase='打开 47tuc 与展开诊断';report.mainBefore=await evaluate("(()=>{const before={...__SE.PERF};__SE.deep.open('47tuc');return before})()");await frames(3);
 phase='验证离线二维观测照片';report.referenceImage=await evaluate("(async()=>{document.querySelector('#deepModelReference').parentElement.open=true;__SE.deep.open('m51');const image=document.querySelector('#deepModelReference');await image.decode();const r=image.getBoundingClientRect(),s=getComputedStyle(image),gl=__SE.renderer.getContext();return {src:image.currentSrc.slice(0,32),complete:image.complete,natural:[image.naturalWidth,image.naturalHeight],rect:[r.width,r.height],display:s.display,model:__SE.deep.info().id,glLost:gl.isContextLost()}})()");
 assert(report.referenceImage.complete&&report.referenceImage.natural[0]>0&&report.referenceImage.natural[1]>0&&report.referenceImage.rect[0]>0&&report.referenceImage.rect[1]>0&&report.referenceImage.src.startsWith('data:image/')&&report.referenceImage.model==='m51'&&!report.referenceImage.glLost,'离线二维照片不可见或未加载',report.referenceImage);
 await evaluate("(document.querySelector('#deepModelReference').parentElement.open=false,__SE.deep.open('47tuc'),true)");await frames(3);
 assert(await evaluate("!document.querySelector('#deepPerfDetails').open"),'性能诊断默认应折叠');
 await evaluate("(document.querySelector('#deepPerfDetails summary').click(),true)");
 await sample('adaptive-47tuc','adaptive','47tuc','interactive');
 report.mainDuring=await evaluate('({...__SE.PERF})');
 assert(JSON.stringify(report.mainBefore)===JSON.stringify(report.mainDuring),'深空帧污染主场景 PERF',{before:report.mainBefore,during:report.mainDuring});
 phase='关闭重开面板';await evaluate("(document.querySelector('#deepPerfDetails summary').click(),true)");
 await until('面板关闭并重置',()=>evaluate("!document.querySelector('#deepPerfDetails').open && document.querySelector('#deepPerfStatus').textContent==='数据不足'"));
 await resetEvents();await evaluate("(document.querySelector('#deepPerfDetails summary').click(),true)");
 await sample('reopened-47tuc','adaptive','47tuc','interactive');
 phase='参考质量';await resetEvents();await evaluate("(__SE.deep.setQuality('reference'),true)");
 const ref=await sample('reference-47tuc','reference','47tuc','reference');
 assert(ref.policy.samples===0 && ref.policy.ema===null,'reference 不应伪装成策略采样',ref);
 phase='连续操作不重置策略窗口';await evaluate("(__SE.deep.setQuality('interactive'),true)");await frames(20);
 report.motion=await evaluate("(()=>{const s=__SE.deep,poses=[0,.01,.02,.03,.04,.05,.06,.07,.08,.09,.10,.11],before=s.perf(),samples=[];for(const yaw of poses){s.setView({yaw});samples.push(s.perf())}const afterViews=document.querySelector('#deepPerfStatus').textContent;s.setDust(!s.info().dust);const after=s.perf(),observed=document.querySelector('#deepPerfStatus').textContent;s.setDust(true);return {before,samples,afterViews,after,observed}})()");
 assert(report.motion.before.mode==='adaptive'&&report.motion.samples.every(x=>JSON.stringify(x)===JSON.stringify(report.motion.before))&&JSON.stringify(report.motion.after)===JSON.stringify(report.motion.before)&&!/数据不足/.test(report.motion.afterViews)&&/数据不足/.test(report.motion.observed),'连续视角应保留观察，吸收切换应重置观察但不清空自适应策略',report.motion);
 phase='auto 关闭';await resetEvents();await evaluate("(__SE.deep.setQuality('interactive'),document.querySelector('[data-tog=auto]').click(),true)");
 const off=await sample('auto-off-47tuc','disabled','47tuc','interactive');
 assert(off.auto===0 && !off.main.on && off.policy.samples===0 && off.policy.ema===null,'auto off 状态或策略采样不符',off);
 phase='真实多帧拖动期间显示观察值';
 await resetEvents();
 const initialYaw=await evaluate('__SE.deep.info().camera.yaw');
 const dragSteps=[];
 await send('Input.dispatchMouseEvent',{type:'mousePressed',x:400,y:160,button:'left',buttons:1,clickCount:1});
 for(let i=0;i<16;i++){
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:400+(i+1)*3,y:160,button:'left',buttons:1});
  const afterMove=await state();
  await frames(2);
  const afterFrames=await state();
  dragSteps.push({index:i+1,yaw:await evaluate('__SE.deep.info().camera.yaw'),afterMove:afterMove.text,afterFrames:afterFrames.text});
 }
 await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:448,y:160,button:'left',buttons:0,clickCount:1});
 report.drag={initialYaw,steps:dragSteps,events:await evaluate('[...window.__perfEvents]')};
 assert(dragSteps.every((step,i)=>Math.abs(step.yaw-(i?dragSteps[i-1].yaw:initialYaw))>0.00001),'真实鼠标移动未改变相机',report.drag);
 assert(dragSteps.every(step=>/ms\s*\/\s*约 [0-9.]+ FPS/.test(step.afterMove)&&/ms\s*\/\s*约 [0-9.]+ FPS/.test(step.afterFrames)),'跨帧持续拖动时面板丢失帧间隔',report.drag);
 assert(report.drag.events.filter(x=>/ms\s*\/\s*约 [0-9.]+ FPS/.test(x)).length>=2,'持续拖动期间没有持续更新数值',report.drag);
 report.tests.push({name:'real-multiframe-drag-47tuc',status:'pass',steps:dragSteps.length});
 phase='真实滚轮与键盘保持观察';
 report.inputBefore=await state();
 await send('Input.dispatchMouseEvent',{type:'mouseWheel',x:400,y:160,deltaX:0,deltaY:40});
 report.afterWheel=await state();await frames(2);
 await send('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowRight',code:'ArrowRight',windowsVirtualKeyCode:39});
 await send('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowRight',code:'ArrowRight',windowsVirtualKeyCode:39});
 report.afterKey=await state();
 assert([report.inputBefore,report.afterWheel,report.afterKey].every(x=>/ms\s*\/\s*约 [0-9.]+ FPS/.test(x.text)),'滚轮或键盘重置了观察', {before:report.inputBefore,wheel:report.afterWheel,key:report.afterKey});
 report.tests.push({name:'wheel-and-key-observation-47tuc',status:'pass'});
 phase='恢复 auto 并切模型';await resetEvents();await evaluate("(document.querySelector('[data-tog=auto]').click(),true)");
 await sample('auto-on-47tuc','adaptive','47tuc','interactive');
 await resetEvents();await evaluate("(__SE.deep.open('m42'),true)");
 await sample('model-m42','adaptive','m42','interactive');
 phase='退出及重新进入';await evaluate('(__SE.deep.close(),true)');await frames(3);
 assert(await evaluate("!__SE.deep.info().active && getComputedStyle(document.querySelector('#deepModelPanel')).display==='none'"),'退出后深空面板未隐藏');
 report.mainAfter=await evaluate('({...__SE.PERF})');
 await resetEvents();await evaluate("(__SE.deep.open('47tuc'),true)");
 if(!await evaluate("document.querySelector('#deepPerfDetails').open"))await evaluate("(document.querySelector('#deepPerfDetails summary').click(),true)");
 await sample('reenter-47tuc','adaptive','47tuc','interactive');
 phase='WebGL 健康检查';report.gl=await glHealth();
 assert(report.errors.length===0,'浏览器或网络错误',report.errors);
}
async function finishProbe(){
 try{await run();report.ok=!report.interrupted}catch(e){report.ok=false;report.fatal={phase,error:errorText(e),details:e.details};console.error(errorText(e));
  if(session&&browser)try{report.failureState=await state();if(report.failureState.open)await screenshot('failure')}catch(captureError){report.captureError=errorText(captureError)}
 }finally{
  if(browser){try{await browser.send('Browser.close')}catch(e){report.closeError=errorText(e)}try{child.stdio[3].end()}catch(_){}}
  if(child&&child.exitCode===null&&child.signalCode===null){const exited=await new Promise(resolve=>{const timer=setTimeout(()=>resolve(false),5000);child.once('exit',()=>{clearTimeout(timer);resolve(true)});if(child.exitCode!==null||child.signalCode!==null){clearTimeout(timer);resolve(true)}});if(!exited)report.killOwnChrome=child.kill()}
  try{report.provenance.entry.after=hash(ENTRY);report.provenance.entry.unchanged=report.provenance.entry.before===report.provenance.entry.after}catch(e){report.hashError=errorText(e);report.ok=false}
  if(report.provenance.entry.unchanged!==true||report.errors.length||report.closeError||report.killOwnChrome)report.ok=false;
  report.finishedAt=new Date().toISOString();fs.writeFileSync(\${JSON.stringify(fd)},JSON.stringify(report,null,2));fs.closeSync(\${JSON.stringify(fd)});
  console.log('报告：'+OUT);console.log('运行时 JS/GL/网络错误：'+JSON.stringify(report.errors));console.log('结果：'+(report.ok?'通过':'失败'));process.exitCode=report.ok?0:1;
 }
}
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{report.interrupted=signal;process.exitCode=1;if(browser)browser.fail(new Error('收到 '+signal));if(child&&child.exitCode===null)child.kill()});
finishProbe();
`;
// 在原框架源码中注入模板，继续使用其边界校验和 --check-vm。
source = source.slice(0, begin) + '  const probe = String.raw`' + probe.replace(/\\\$\{/g, '${').replace(/`/g, '\\`') + source.slice(end);
source = source.replace('deep-perf-path-20261116-', 'deep-perf-v196-');
new vm.Script('(function(require,__dirname,__filename,process,Buffer,WebSocket){\n'+source+'\n})', { filename: __filename }).runInThisContext()(require, __dirname, __filename, process, Buffer, globalThis.WebSocket);
