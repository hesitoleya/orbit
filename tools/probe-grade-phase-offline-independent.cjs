'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
let source = fs.readFileSync(path.join(__dirname, 'probe-m51-grain-ab-independent.cjs'), 'utf8');
source = source.replace('m51-grain-ab-independent-${stamp}', 'grade-phase-offline-independent-${stamp}');
const start = source.indexOf("  await send('Page.addScriptToEvaluateOnNewDocument'");
const end = source.indexOf('\n}', source.indexOf("  const view = { name: 'front'", start));
if (start < 0 || end < 0) throw Error('原探针结构不匹配');
source = source.slice(0, start) + `
  report.experiment = 'M51 离线截图 gradePhase 独立验证';
  report.entrySha256 = createHash('sha256').update(fs.readFileSync(path.join(root, 'space.html'))).digest('hex');
  report.method = ['M51 固定机位，同一 JS 任务内连续使用产品截图 options，不修改 uniform', '按 PNG SHA-256 检验相同及不同相位，临时包裹 render 观察相位并注入一次异常', 'shot 结束时会额外执行一次普通渲染，正常推进相位'];
  report.constraints = ['使用 file:///D:/WB/orbit/space.html，不启动服务器', '不修改产品源码，不冻结相位；仅临时包裹 renderer.render 观察 uniform 或一次性注入异常', 'SwiftShader 软件渲染，不代表真实 GPU', '单一 M51 机位及有限分辨率，不证明完整收敛'];
  const loaded = waitForPageEvent('Page.loadEventFired');
  const nav = await send('Page.navigate', {url:'file:///D:/WB/orbit/space.html?auto=0&q=high&grade=1&t=0'});
  if (nav.errorText) throw Error(nav.errorText);
  await loaded;
  await evaluate(\`new Promise((resolve,reject)=>{let n=0;function check(){if(window.__SE&&__SE.firstFrame===false&&__SE.deep)resolve(true);else if(++n>1200)reject(Error('页面未就绪'));else setTimeout(check,100)}check()})\`);
  await evaluate(\`(()=>{__SE.ts=0;if(__SE.tour)__SE.tour(false);if(__SE.help)__SE.help(false);__SE.deep.open('m51');__SE.deep.setDust(true);__SE.deep.setQuality('interactive');__SE.deep.setView({yaw:0,pitch:0,distance:3.6,target:[0,0,0]});__SE.grade(true)})()\`);
  await waitFrames(12);
  report.gpu = await evaluate(\`(()=>{const gl=__SE.renderer.getContext(),e=gl.getExtension('WEBGL_debug_renderer_info');return {vendor:gl.getParameter(gl.VENDOR),renderer:gl.getParameter(gl.RENDERER),unmaskedRenderer:e&&gl.getParameter(e.UNMASKED_RENDERER_WEBGL),version:gl.getParameter(gl.VERSION),lost:gl.isContextLost(),error:gl.getError()}})()\`);
  report.setup = await evaluate(\`(()=>({build:__SE.build,info:__SE.deep.info(),timeScale:__SE.ts,grade:__SE.gradeOn,width:__SE.renderer.domElement.width,height:__SE.renderer.domElement.height}))()\`);
  const results = await evaluate(\`(()=>{
    const r=__SE.renderer, original=r.render, log=[]; let material=null, fault=false, stage='';
    r.render=function(scene,camera){
      scene.traverse(o=>{const m=o.material;if(m&&m.uniforms&&m.uniforms.uGradeT&&typeof m.fragmentShader==='string'){material=m;log.push({stage,value:m.uniforms.uGradeT.value});if(fault){fault=false;throw Error('grade-phase-injected-render-error')}}});
      return original.call(this,scene,camera);
    };
    const out={images:{},log,checks:{}};
    const size=()=>({width:r.domElement.width,height:r.domElement.height,pixelRatio:r.getPixelRatio(),cssWidth:r.domElement.style.width,cssHeight:r.domElement.style.height});
    try {
      stage='discover'; __SE.snap('image/png'); if(!material)throw Error('未定位后期材质');
      const u=material.uniforms.uGradeT; out.before=u.value;
      stage='phase0a';out.images.phase0a=__SE.snap('image/png',{gradePhase:0});out.after0a=u.value;
      stage='phase0b';out.images.phase0b=__SE.snap('image/png',{gradePhase:0});out.after0b=u.value;
      stage='phase1';out.images.phase1=__SE.snap('image/png',{gradePhase:1});out.after1=u.value;
      stage='default1';out.images.default1=__SE.snap('image/png');out.default1=u.value;
      stage='default2';out.images.default2=__SE.snap('image/png');out.default2=u.value;
      out.checks.fixedRestores = out.before===out.after0a&&out.before===out.after0b&&out.before===out.after1;
      out.checks.defaultAdvances = out.default1===(out.before+1)%1000&&out.default2===(out.default1+1)%1000;
      out.checks.observedPhases = ['phase0a','phase0b','phase1'].every((s,i)=>log.some(x=>x.stage===s&&x.value===[0,0,1][i]));
      stage='snapThrow'; const prior=u.value;fault=true;try{__SE.snap('image/png',{gradePhase:37})}catch(e){out.snapError=e.message}out.snapAfter=u.value;
      out.checks.snapExceptionRestores=out.snapError==='grade-phase-injected-render-error'&&out.snapAfter===prior&&log.some(x=>x.stage==='snapThrow'&&x.value===37);
      out.sizeBefore=size();stage='shot0a';let a=__SE.shot(400,240,'image/png',{gradePhase:0});out.images.shot0a=a.url;out.shotMeta={w:a.w,h:a.h,msaa:a.msaa};out.sizeAfterShot=size();
      stage='shot0b';out.images.shot0b=__SE.shot(400,240,'image/png',{gradePhase:0}).url;
      stage='shot1';out.images.shot1=__SE.shot(400,240,'image/png',{gradePhase:1}).url;
      out.checks.shotRestoresSize=JSON.stringify(out.sizeBefore)===JSON.stringify(out.sizeAfterShot);
      out.checks.shotObservedPhases=['shot0a','shot0b','shot1'].every((s,i)=>log.some(x=>x.stage===s&&x.value===[0,0,1][i]));
      stage='shotThrow';fault=true;try{__SE.shot(400,240,'image/png',{gradePhase:37})}catch(e){out.shotError=e.message}out.sizeAfterThrow=size();
      out.checks.shotExceptionRestoresSize=out.shotError==='grade-phase-injected-render-error'&&JSON.stringify(out.sizeBefore)===JSON.stringify(out.sizeAfterThrow);
      const shotThrowLog=log.filter(x=>x.stage==='shotThrow');out.shotThrowLog=shotThrowLog;
      out.checks.shotExceptionPhaseRestored=shotThrowLog.length>=2&&shotThrowLog[0].value===37&&shotThrowLog[1].value!==37;
      window.__gradePhaseMaterial=material;
    } finally {r.render=original}
    return out;
  })()\`);
  report.results = results;
  report.images = {};
  for(const [tag,url] of Object.entries(results.images)){
    if(typeof url !== 'string' || !url.startsWith('data:image/png;base64,'))throw Error('无效 PNG: '+tag);
    const bytes=Buffer.from(url.split(',')[1],'base64');const file=path.join(root,prefix+'-'+tag+'.png');
    fs.writeFileSync(file,bytes,{flag:'wx'});report.images[tag]={file,sha256:createHash('sha256').update(bytes).digest('hex'),width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20)};
  }
  delete results.images;
  for(const [a,b,expected] of [['phase0a','phase0b',true],['phase0a','phase1',false],['default1','default2',false],['shot0a','shot0b',true],['shot0a','shot1',false]]) results.checks[a+'_vs_'+b]=(report.images[a].sha256===report.images[b].sha256)===expected;
  const before=await evaluate(\`window.__gradePhaseMaterial.uniforms.uGradeT.value\`);
  await waitFrames(4);
  const after=await evaluate(\`window.__gradePhaseMaterial.uniforms.uGradeT.value\`);
  results.normalFrame={before,after};results.checks.normalFramesAdvance=before!==after;
  results.checks.shotDimensions=report.images.shot0a.width===400&&report.images.shot0a.height===240;
  if(Object.values(results.checks).some(v=>!v)){report.failure='存在断言失败';process.exitCode=1}
` + source.slice(end);
vm.runInThisContext(`(function(require,__dirname,__filename){${source}\n})`, {filename:__filename})(require,__dirname,__filename);
