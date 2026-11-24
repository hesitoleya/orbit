const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');

const root = 'D:/WB/orbit';
const html = path.join(root, 'space.html');
const run = Date.now() + '-' + crypto.randomUUID();
const expectedBuild = process.env.ORBIT_TEST_BUILD || 'v197';
if (!/^v\d+$/.test(expectedBuild)) throw Error('Invalid expected build: ' + expectedBuild);
const output = path.join(root, '_screenshot_recovery_' + expectedBuild + '_' + run + '.json');
const profile = path.join(os.tmpdir(), 'orbit-screenshot-recovery-' + expectedBuild + '-' + run);
const hash = () => crypto.createHash('sha256').update(fs.readFileSync(html)).digest('hex');
const chrome = path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe');
const browser = spawn(chrome, ['--headless=new', '--remote-debugging-pipe', '--user-data-dir=' + profile, '--window-size=640,480', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update', '--proxy-server=127.0.0.1:9', '--host-resolver-rules=MAP * ~NOTFOUND', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
let id = 0, buffer = Buffer.alloc(0);
const pending = new Map();
browser.stdio[2].resume();
browser.stdio[4].on('data', chunk => {
  buffer = Buffer.concat([buffer, chunk]);
  let n;
  while ((n = buffer.indexOf(0)) >= 0) {
    const msg = JSON.parse(buffer.subarray(0, n));
    buffer = buffer.subarray(n + 1);
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id); pending.delete(msg.id);
      msg.error ? p.reject(Error(JSON.stringify(msg.error))) : p.resolve(msg.result);
    }
  }
});
for (const event of ['error', 'exit']) browser.on(event, value => {
  for (const p of pending.values()) p.reject(Error('Chrome ' + event + ': ' + value));
  pending.clear();
});
function send(method, params = {}, sessionId) {
  return new Promise((resolve, reject) => {
    const num = ++id;
    pending.set(num, { resolve, reject });
    browser.stdio[3].write(JSON.stringify({ id: num, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0');
  });
}
async function main() {
  const before = hash();
  const version = await send('Browser.getVersion');
  const target = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
  const call = (method, params = {}) => send(method, params, sessionId);
  await call('Runtime.enable');
  await call('Page.enable');
  await call('Page.navigate', { url: pathToFileURL(html).href + '?tour=0&fresh=1' });
  async function ev(expression) {
    const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  }
  let ready = false;
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    if (await ev('!!(window.__SE && __SE.renderer && __SE.shot && __SE.savePNG)')) { ready = true; break; }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  if (!ready) throw Error('页面初始化超时');
  const env = await ev(`(()=>{const r=__SE.renderer,gl=r.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info');return {build:__SE.build,href:location.href,webgl:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER)}})()`);
  if (String(env.build) !== expectedBuild) throw Error('拒绝运行：页面不是 ' + expectedBuild + '，build=' + env.build);
  const allCases = [];
  for (let caseIndex = 0; caseIndex < 17; caseIndex++) {
    if (caseIndex) {
      await call('Page.navigate', {url:pathToFileURL(html).href+'?tour=0&fresh=1&case='+caseIndex});
      let initialized = false;
      const until = Date.now() + 90000;
      while (Date.now() < until) {
        try {
          if (await ev(`location.search.includes('case=${caseIndex}') && !!(window.__SE && __SE.savePNG)`)) { initialized = true; break; }
        } catch (_) {}
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      if (!initialized) throw Error('隔离页面初始化超时: ' + caseIndex);
    }
    const result = await ev(`(()=>{
    const se=__SE,r=se.renderer,T=se.THREE,canvas=r.domElement,gl=r.getContext(),cases=[];
    const state=()=>{const size=new T.Vector2(),vp=new T.Vector4(),sc=new T.Vector4();r.getSize(size);r.getViewport(vp);r.getScissor(sc);const target=r.getRenderTarget();return {size:size.toArray(),canvas:[canvas.width,canvas.height],buffer:[gl.drawingBufferWidth,gl.drawingBufferHeight],css:[canvas.style.width,canvas.style.height],pixelRatio:r.getPixelRatio(),viewport:vp.toArray(),scissor:sc.toArray(),scissorTest:r.getScissorTest(),aspect:se.camera.aspect,pixelAngle:se.terrainMat.uniforms.uPixAng.value,target:target?target.uuid:null,face:r.getActiveCubeFace(),mip:r.getActiveMipmapLevel(),autoClear:r.autoClear,toast:document.getElementById('toast')?.textContent||''}};
    const diff=(a,b)=>Object.fromEntries(Object.keys(a).filter(k=>JSON.stringify(a[k])!==JSON.stringify(b[k])).map(k=>[k,{before:a[k],after:b[k]}]));
    const add=(name,fn)=>{try{const x=fn();cases.push({name,...x,status:x.errors.length?'fail':'pass'})}catch(e){cases.push({name,status:'fail',fatal:String(e&&e.stack||e),errors:['测试执行异常']})}};
    const verify=(errors,condition,message)=>{if(!condition)errors.push(message)};
    const diag=()=>se.screenshotDiagnostics.restoreErrors;
    function sized(name,mode){add(name,()=>{
      const errors=[],before=state(),primary=Error('primary-'+name),cleanup=Error('restore-'+name),oldEncode=canvas.toDataURL,oldViewport=r.setViewport,oldScissor=r.setScissor,oldTest=r.setScissorTest;
      let phase=false,encodeCalls=0,viewportCalls=0,scissorCalls=0,testCalls=0,thrown,result;
      canvas.toDataURL=function(...args){encodeCalls++;phase=true;if(mode.includes('primary'))throw primary;return oldEncode.apply(this,args)};
      r.setViewport=function(...args){if(phase){viewportCalls++;if(mode.includes('once')&&viewportCalls===1||mode.includes('persistent'))throw cleanup}return oldViewport.apply(this,args)};
      r.setScissor=function(...args){if(phase){scissorCalls++;if(mode.includes('persistent'))throw Error('scissor-'+name)}return oldScissor.apply(this,args)};
      r.setScissorTest=function(...args){if(phase){testCalls++;if(mode.includes('persistent'))throw Error('scissorTest-'+name)}return oldTest.apply(this,args)};
      try{result=se.shot(96,64)}catch(e){thrown=e}finally{canvas.toDataURL=oldEncode;r.setViewport=oldViewport;r.setScissor=oldScissor;r.setScissorTest=oldTest}
      const after=state(),diagnostics=diag(),difference=diff(before,after);
      if(mode==='success'||mode==='primary')verify(errors,Object.keys(difference).length===0,'正常或仅主异常后关键状态不一致: '+JSON.stringify(difference));
      verify(errors,encodeCalls===1,'未准确命中编码阶段');
      if(mode.includes('primary'))verify(errors,thrown===primary,'主异常身份未保留');
      else if(mode.includes('once')||mode.includes('persistent'))verify(errors,thrown===cleanup,'首次恢复异常身份未保留');
      else verify(errors,!!result?.url&&!thrown,'正常截图失败');
      if(mode.includes('once'))verify(errors,viewportCalls>=1&&diagnostics.length===1&&diagnostics[0].message===cleanup.message,'单次恢复诊断不符');
      else if(mode.includes('persistent'))verify(errors,viewportCalls>=1&&scissorCalls>=1&&testCalls>=1&&diagnostics.length>=2&&diagnostics.some(x=>x.step==='scissor')&&diagnostics.some(x=>x.step==='scissorTest'),'持续故障未独立记录多个恢复步骤');
      else verify(errors,diagnostics.length===0,'不应有恢复诊断');
      const copy=se.screenshotDiagnostics;if(copy.restoreErrors.length){copy.restoreErrors[0].message='mutated';copy.restoreErrors.push({step:'fake',message:'fake'});verify(errors,JSON.stringify(diag())===JSON.stringify(diagnostics),'诊断不是防御副本')}
      return {errors,before,after,difference,diagnostics,encodeCalls,viewportCalls,scissorCalls,testCalls,thrown:thrown&&String(thrown),primaryIdentity:thrown===primary,cleanupIdentity:thrown===cleanup};
    })}
    switch(${JSON.stringify('__CASE_INDEX__')}) {
    case 0: sized('正常截图无旧诊断','success'); break;
    case 1: sized('仅主异常','primary'); break;
    case 2: sized('仅单次恢复异常','once'); break;
    case 3: sized('主异常与单次恢复异常','primary-once'); break;
    case 4: sized('持续恢复故障','persistent'); break;
    case 5: add('静默恢复失效触发状态校验',()=>{
      const errors=[],before=state(),oldEncode=canvas.toDataURL,oldViewport=r.setViewport;let phase=false,calls=0,thrown;
      canvas.toDataURL=function(...args){phase=true;return oldEncode.apply(this,args)};
      r.setViewport=function(...args){if(phase){calls++;return}return oldViewport.apply(this,args)};
      try{se.shot(96,64)}catch(e){thrown=e}finally{canvas.toDataURL=oldEncode;r.setViewport=oldViewport}
      const after=state(),difference=diff(before,after),diagnostics=diag();
      verify(errors,calls>=1,'未命中静默故障');
      verify(errors,!!thrown&&thrown.message.includes('画面状态可能未恢复'),'静默失效没有拒绝截图');
      verify(errors,!!difference.viewport,'未观察到 viewport 差异');
      verify(errors,diagnostics.some(x=>x.step==='stateMismatch'&&x.message.includes('viewport')),'未记录 viewport 状态差异');
      return {errors,before,after,difference,calls,thrown:thrown&&String(thrown),diagnostics};
    }); break;
    case 6: add('savePNG 恢复异常提示',()=>{
      const errors=[],before=state(),oldEncode=canvas.toDataURL,oldViewport=r.setViewport,cleanup=Error('save restore sentinel');let phase=false,calls=0,result;
      canvas.toDataURL=function(...args){phase=true;return oldEncode.apply(this,args)};
      r.setViewport=function(...args){if(phase&&++calls===1)throw cleanup;return oldViewport.apply(this,args)};
      try{result=se.savePNG(2)}finally{canvas.toDataURL=oldEncode;r.setViewport=oldViewport}
      const after=state(),diagnostics=diag();verify(errors,result===null,'失败未返回 null');verify(errors,calls>=1&&diagnostics.some(x=>x.message===cleanup.message),'未命中恢复异常');verify(errors,after.toast==='截图失败，画面状态可能未恢复，请刷新页面','恢复风险提示不符');return {errors,before,after,difference:diff(before,after),calls,result,diagnostics};
    }); break;
    case 7: add('savePNG 普通编码失败提示',()=>{
      const errors=[],before=state(),old=canvas.toDataURL,primary=Error('ordinary encoding sentinel');let calls=0,result;
      canvas.toDataURL=()=>{calls++;throw primary};try{result=se.savePNG(2)}finally{canvas.toDataURL=old}
      const after=state(),diagnostics=diag();verify(errors,result===null&&calls===1,'编码注入未命中');verify(errors,after.toast==='截图失败：'+primary.message,'普通错误提示不符');verify(errors,diagnostics.length===0,'普通编码错误误报恢复风险');return {errors,before,after,difference:diff(before,after),calls,result,diagnostics};
    }); break;
    case 8: add('snap 主异常与目标恢复异常',()=>{
      const errors=[],before=state(),target=new T.WebGLRenderTarget(4,4),oldRender=r.render,oldTarget=r.setRenderTarget,primary=Error('render primary sentinel'),cleanup=Error('target restore sentinel');let armed=false,renderCalls=0,targetCalls=0,thrown;
      r.render=function(){renderCalls++;if(!armed){oldTarget.call(r,target);armed=true;throw primary}return oldRender.apply(this,arguments)};
      r.setRenderTarget=function(value,...args){if(armed&&value===null){targetCalls++;throw cleanup}return oldTarget.call(this,value,...args)};
      try{se.snap()}catch(e){thrown=e}finally{r.render=oldRender;r.setRenderTarget=oldTarget}
      const after=state(),diagnostics=diag();
      try{verify(errors,renderCalls>=1&&targetCalls>=1,'未命中目标恢复故障');verify(errors,thrown===primary,'渲染主异常身份未保留');verify(errors,diagnostics.some(x=>x.step==='renderTarget'&&x.message===cleanup.message),'目标恢复异常未记录');verify(errors,after.target===target.uuid,'故障后目标差异未观察到')}finally{oldTarget.call(r,null);target.dispose()}
      return {errors,before,after,difference:diff(before,after),renderCalls,targetCalls,primaryIdentity:thrown===primary,diagnostics};
    }); break;
    case 9: add('恢复失败后禁止再次截图',()=>{
      const errors=[],before=state(),primary=Error('first primary sentinel'),cleanup=Error('first cleanup sentinel'),oldEncode=canvas.toDataURL,oldViewport=r.setViewport;let phase=false,calls=0,first,second,saveResult;
      canvas.toDataURL=()=>{phase=true;throw primary};
      r.setViewport=function(...args){if(phase&&++calls===1)throw cleanup;return oldViewport.apply(this,args)};
      try{se.shot(96,64)}catch(e){first=e}finally{canvas.toDataURL=oldEncode;r.setViewport=oldViewport}
      const afterFirst=state(),firstDiag=se.screenshotDiagnostics;
      try{se.snap()}catch(e){second=e}
      saveResult=se.savePNG(2);
      const after=state(),lastDiag=se.screenshotDiagnostics;
      verify(errors,first===primary,'首次主异常未保留');
      verify(errors,firstDiag.recoveryRisk&&firstDiag.restoreErrors.length>0,'未锁定恢复风险');
      verify(errors,!!second&&second.message.includes('刷新'),'后续 snap 未拒绝');
      verify(errors,saveResult===null&&after.toast.includes('刷新页面'),'后续 savePNG 未拒绝并提示');
      verify(errors,JSON.stringify(firstDiag)===JSON.stringify(lastDiag),'风险诊断被后续尝试清除');
      return {errors,before,afterFirst,after,difference:diff(before,after),calls,first:String(first),second:String(second),firstDiag,lastDiag};
    }); break;
    case 10: add('尺寸准备和恢复期间拒绝同步重入',()=>{
      const errors=[],before=state(),oldSize=r.setSize,oldViewport=r.setViewport,oldRender=r.render,oldEncode=canvas.toDataURL;
      const attempts=[],phases=[],counts={render:0,encode:0};let inAttempt=false,setupHit=false,cleanupHit=false,outerError,result;
      r.render=function(...args){counts.render++;return oldRender.apply(this,args)};
      canvas.toDataURL=function(...args){counts.encode++;return oldEncode.apply(this,args)};
      function attempt(phase){
        const diagBefore=se.screenshotDiagnostics, prior={...counts};
        for(const [name,fn] of Object.entries({snap:()=>se.snap(),capture:()=>se.capture(1),shot:()=>se.shot(32,32)})){
          let error;try{fn()}catch(e){error=e}
          attempts.push({phase,name,error:error&&error.message,unchangedCounts:JSON.stringify(prior)===JSON.stringify(counts)});
        }
        phases.push({phase,diagBefore,diagAfter:se.screenshotDiagnostics});
      }
      r.setSize=function(...args){
        if(!setupHit&&!inAttempt){setupHit=true;inAttempt=true;try{attempt('setup')}finally{inAttempt=false}}
        return oldSize.apply(this,args);
      };
      r.setViewport=function(...args){
        if(counts.encode===1&&!cleanupHit&&!inAttempt){cleanupHit=true;inAttempt=true;try{attempt('cleanup')}finally{inAttempt=false}}
        return oldViewport.apply(this,args);
      };
      try{result=se.shot(96,64)}catch(e){outerError=e}finally{r.setSize=oldSize;r.setViewport=oldViewport;r.render=oldRender;canvas.toDataURL=oldEncode}
      const after=state(),difference=diff(before,after);
      verify(errors,setupHit&&cleanupHit&&attempts.length===6,'未命中两个事务阶段及六次尝试');
      for(const a of attempts){verify(errors,a.error==='截图事务不可重入',a.phase+' '+a.name+' 未被重入锁拒绝');verify(errors,a.unchangedCounts,a.phase+' '+a.name+' 意外绘制或编码')}
      for(const p of phases)verify(errors,JSON.stringify(p.diagBefore)===JSON.stringify(p.diagAfter),p.phase+' 重入改变诊断');
      verify(errors,!!result?.url&&!outerError&&counts.encode===1,'外层合法截图失败或编码次数错误');
      verify(errors,Object.keys(difference).length===0,'外层截图后关键状态不一致: '+JSON.stringify(difference));
      return {errors,before,after,difference,attempts,phases,counts,outerError:outerError&&String(outerError)};
    }); break;
    case 11: add('恢复错误出现后重入不能清除风险',()=>{
      const errors=[],primary=Error('reentry primary'),cleanup=Error('reentry cleanup'),oldEncode=canvas.toDataURL,oldViewport=r.setViewport,oldScissor=r.setScissor,oldRender=r.render;
      let phase=false,failed=false,hit=false,encodeCalls=0,renderCalls=0,thrown;const attempts=[];
      canvas.toDataURL=function(){encodeCalls++;phase=true;throw primary};
      r.render=function(...args){renderCalls++;return oldRender.apply(this,args)};
      r.setViewport=function(...args){if(phase&&!failed){failed=true;throw cleanup}return oldViewport.apply(this,args)};
      r.setScissor=function(...args){
        if(failed&&!hit){
          hit=true;const prior={encodeCalls,renderCalls},diagBefore=se.screenshotDiagnostics;
          for(const [name,fn] of Object.entries({snap:()=>se.snap(),capture:()=>se.capture(1),shot:()=>se.shot(32,32)})){
            let error;try{fn()}catch(e){error=e}
            attempts.push({name,error:error&&error.message,unchanged:prior.encodeCalls===encodeCalls&&prior.renderCalls===renderCalls});
          }
          const diagAfter=se.screenshotDiagnostics;
          verify(errors,diagBefore.recoveryRisk&&diagBefore.restoreErrors.some(x=>x.message===cleanup.message),'重入前风险尚未记录');
          verify(errors,JSON.stringify(diagBefore)===JSON.stringify(diagAfter),'重入清除了风险诊断');
        }
        return oldScissor.apply(this,args);
      };
      try{se.shot(96,64)}catch(e){thrown=e}finally{canvas.toDataURL=oldEncode;r.setViewport=oldViewport;r.setScissor=oldScissor;r.render=oldRender}
      const diagnostics=se.screenshotDiagnostics;let later;try{se.snap()}catch(e){later=e}
      verify(errors,failed&&hit&&attempts.length===3,'未命中恢复风险后的重入阶段');
      for(const a of attempts)verify(errors,a.error==='截图事务不可重入'&&a.unchanged,a.name+' 重入未安全拒绝');
      verify(errors,thrown===primary,'主异常身份未保留');
      verify(errors,diagnostics.recoveryRisk&&diagnostics.restoreErrors.some(x=>x.message===cleanup.message),'外层恢复诊断丢失');
      verify(errors,!!later&&later.message.includes('刷新'),'事务结束后未进入刷新风险锁');
      return {errors,attempts,encodeCalls,renderCalls,diagnostics,primaryIdentity:thrown===primary,later:later&&later.message};
    }); break;
    case 12: add('无尺寸事务截图拒绝同步重入',()=>{
      const errors=[],oldEncode=canvas.toDataURL,oldRender=r.render,attempts=[];let encodeCalls=0,renderCalls=0,inHook=false,result,outerError;
      r.render=function(...args){renderCalls++;return oldRender.apply(this,args)};
      canvas.toDataURL=function(...args){
        encodeCalls++;
        if(!inHook){inHook=true;const prior={encodeCalls,renderCalls},diagBefore=se.screenshotDiagnostics;
          for(const [name,fn] of Object.entries({snap:()=>se.snap(),capture:()=>se.capture(1),shot:()=>se.shot(32,32)})){
            let error;try{fn()}catch(e){error=e}
            attempts.push({name,error:error&&error.message,unchanged:prior.encodeCalls===encodeCalls&&prior.renderCalls===renderCalls});
          }
          verify(errors,JSON.stringify(diagBefore)===JSON.stringify(se.screenshotDiagnostics),'重入修改诊断');inHook=false;
        }
        return oldEncode.apply(this,args);
      };
      try{result=se.snap()}catch(e){outerError=e}finally{canvas.toDataURL=oldEncode;r.render=oldRender}
      verify(errors,!!result&&!outerError&&encodeCalls===1&&attempts.length===3,'外层 snap 或注入次数不符');
      for(const a of attempts)verify(errors,a.error==='截图事务不可重入'&&a.unchanged,a.name+' 未被重入锁拒绝');
      return {errors,attempts,encodeCalls,renderCalls,outerError:outerError&&String(outerError)};
    }); break;
    case 13: add('恢复条件读取异常仍保留主异常并继续清理',()=>{
      const errors=[],cs=se.CS,descriptor=Object.getOwnPropertyDescriptor(cs,'cam'),oldEncode=canvas.toDataURL,oldRender=r.render;
      const originalCamera=cs.cam,primary=Error('cleanup primary sentinel'),cleanup=Error('cleanup getter sentinel');
      let phase=false,getterHits=0,renderAfterFault=0,thrown,later;
      Object.defineProperty(cs,'cam',{configurable:true,enumerable:descriptor.enumerable,get(){if(phase&&++getterHits===1)throw cleanup;return originalCamera},set(v){if(v!==originalCamera)throw Error('测试期间相机被替换')}});
      canvas.toDataURL=()=>{phase=true;throw primary};
      r.render=function(...args){if(getterHits)renderAfterFault++;return oldRender.apply(this,args)};
      try{se.shot(96,64)}catch(e){thrown=e}finally{Object.defineProperty(cs,'cam',descriptor);canvas.toDataURL=oldEncode;r.render=oldRender}
      const diagnostics=se.screenshotDiagnostics;try{se.shot(96,64)}catch(e){later=e}
      verify(errors,phase&&getterHits>=1,'条件 getter 未命中');
      verify(errors,thrown===primary,'主异常被恢复条件异常覆盖');
      verify(errors,diagnostics.recoveryRisk&&diagnostics.restoreErrors.some(x=>x.step==='cosmicCamera'&&x.message===cleanup.message),'未记录相机条件读取异常');
      verify(errors,renderAfterFault>0,'故障之后未继续尝试恢复重绘');
      verify(errors,!!later&&later.message.includes('刷新'),'事务锁未释放或风险锁未生效');
      return {errors,getterHits,renderAfterFault,primaryIdentity:thrown===primary,diagnostics,later:later&&later.message};
    }); break;
    case 14: add('snap 目标静默恢复失败被检测',()=>{
      const errors=[],target=new T.WebGLRenderTarget(4,4),oldRender=r.render,oldTarget=r.setRenderTarget,oldEncode=canvas.toDataURL;
      let armed=false,targetRestoreCalls=0,encodeCalls=0,thrown,trigger=0;
      r.render=function(...args){if(!armed){armed=true;trigger++;oldTarget.call(r,target);return}return oldRender.apply(this,args)};
      r.setRenderTarget=function(value,...args){if(armed&&value===null){targetRestoreCalls++;return}return oldTarget.call(this,value,...args)};
      canvas.toDataURL=function(...args){encodeCalls++;return oldEncode.apply(this,args)};
      try{se.snap()}catch(e){thrown=e}finally{r.render=oldRender;r.setRenderTarget=oldTarget;canvas.toDataURL=oldEncode}
      const diagnostics=se.screenshotDiagnostics,actualTarget=r.getRenderTarget();
      try{
        verify(errors,trigger===1&&targetRestoreCalls>=1&&actualTarget===target,'未命中静默目标恢复故障');
        verify(errors,!!thrown&&thrown.message.includes('状态不一致')&&encodeCalls===0,'静默故障未拒绝编码');
        verify(errors,diagnostics.recoveryRisk&&diagnostics.restoreErrors.some(x=>x.step==='renderTarget'&&x.message.includes('状态不一致')),'目标状态风险未记录');
      }finally{oldTarget.call(r,null);target.dispose()}
      return {errors,trigger,targetRestoreCalls,encodeCalls,thrown:thrown&&thrown.message,diagnostics};
    }); break;
    case 15: add('savePNG 下载点击异常清理与提示',()=>{
      const errors=[],oldCreate=document.createElement,clickError=Error('download click sentinel');let anchor=null,clicks=0,result,thrown;
      document.createElement=function(name,...args){const el=oldCreate.call(this,name,...args);if(String(name).toLowerCase()==='a'){anchor=el;el.click=()=>{clicks++;throw clickError}}return el};
      try{result=se.savePNG(1)}catch(e){thrown=e}finally{document.createElement=oldCreate}
      const toast=document.getElementById('toast')?.textContent||'';
      verify(errors,!!anchor&&clicks===1,'下载点击故障未命中');
      verify(errors,result===null&&!thrown,'下载异常未被捕获');
      verify(errors,!anchor?.isConnected,'失败后临时链接未移除');
      verify(errors,toast==='无法发起下载：'+clickError.message,'下载异常提示不符');
      verify(errors,!se.screenshotDiagnostics.recoveryRisk,'下载失败误报画面恢复风险');
      return {errors,clicks,result,thrown:thrown&&String(thrown),connected:anchor&&anchor.isConnected,toast};
    }); break;
    case 16: add('savePNG 成功仅提示发起下载',()=>{
      const errors=[],oldCreate=document.createElement;let anchor=null,clicks=0,result,thrown;
      document.createElement=function(name,...args){const el=oldCreate.call(this,name,...args);if(String(name).toLowerCase()==='a'){anchor=el;el.click=()=>{clicks++}}return el};
      try{result=se.savePNG(1)}catch(e){thrown=e}finally{document.createElement=oldCreate}
      const toast=document.getElementById('toast')?.textContent||'';
      verify(errors,!!anchor&&clicks===1&&result>0&&!thrown,'模拟点击流程失败');
      verify(errors,!!anchor&&/^space-\\d{8}-\\d{4}\\.png$/.test(anchor.download),'默认下载文件名格式不符');
      verify(errors,!anchor?.isConnected,'成功后临时链接未移除');
      verify(errors,toast.includes('已发起')&&toast.includes('下载')&&!toast.includes('已保存'),'提示错误地断言文件已保存');
      return {errors,clicks,result,thrown:thrown&&String(thrown),connected:anchor&&anchor.isConnected,toast};
    }); break;
    default: throw Error('未知测试项');
    }
    return {cases};
  })()`.replace(JSON.stringify('__CASE_INDEX__'), String(caseIndex)));
    allCases.push(...result.cases);
  }
  await call('Page.navigate', {url:pathToFileURL(html).href+'?tour=0&fresh=1&case=refresh'});
  let refreshed = false;
  const refreshDeadline = Date.now() + 90000;
  while (Date.now() < refreshDeadline) {
    try { if (await ev("location.search.includes('case=refresh') && !!(window.__SE && __SE.savePNG)")) { refreshed = true; break; } } catch (_) {}
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  if (!refreshed) throw Error('刷新后页面初始化超时');
  const refreshCase = await ev(`(()=>{const errors=[];let url,exception;try{url=__SE.snap()}catch(e){exception=String(e)}const diagnostics=__SE.screenshotDiagnostics;if(!url||exception||diagnostics.recoveryRisk||diagnostics.restoreErrors.length)errors.push('刷新后风险未解除或截图失败');return {name:'刷新页面后允许截图',status:errors.length?'fail':'pass',errors,diagnostics,exception}})()`);
  allCases.push(refreshCase);
  const result = {cases:allCases};
  const after = hash();
  const report = { time: new Date().toISOString(), file: html, sha256Before: before, sha256After: after, browser: version, env, profile, ...result, notes: ['每个用例使用重新载入的页面；前后状态和 DOM 提示在同一 JS 任务中采集，避免动画帧干扰及故障交叉污染。', '通过替换浏览器方法注入故障，不能证明真实设备故障行为；SwiftShader 不能代表真实 GPU。', '持久故障可能留下未恢复状态，报告逐字段列出差异；不保存截图。', 'Chrome 代理和 DNS 限制并非系统级网络审计，不能证明不存在其他网络活动。'] };
  report.identityOk = before === after && String(env.build) === expectedBuild;
  fs.writeFileSync(output, JSON.stringify(report, null, 2), { flag: 'wx' });
  console.log(JSON.stringify({ report: output, build: env.build, sha256Before: before, sha256After: after, identityOk: report.identityOk, cases: result.cases.map(({ name, status, errors, fatal }) => ({ name, status, errors, fatal })) }, null, 2));
  if (!report.identityOk || result.cases.some(c => c.status !== 'pass')) process.exitCode = 1;
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; }).finally(async () => { try { await send('Browser.close'); } catch (_) {} browser.kill(); });
