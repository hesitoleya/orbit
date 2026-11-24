'use strict';
// 一次性隔离预览：同步采样，不用于产品渲染。
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {randomUUID,createHash}=require('node:crypto');
const root=path.resolve(__dirname,'..'),output=path.join(root,'.workbuddy','p2-paired-'+randomUUID());
fs.mkdirSync(output);
const reportPath=path.join(output,'report.json'),hash=x=>createHash('sha256').update(x).digest('hex');
const result={status:'incomplete',output,cases:[],errors:[],limitations:[
 '一次浏览器 JS 任务内同步采样；rAF 和普通事件回调不能在两侧之间执行，但 GPU、时钟、异步资源不因此完全冻结。',
 '测试先强制构建宇宙层并等待若干帧，改变了随机调用顺序和预热时机，不等价于自然旅程；并未证明全部资源就绪。',
 '主场景由 seek 后自然帧更新；宇宙层从该状态的实际主相机方向和 up 构造测试机位，并在同一任务调用 cosmicUpdate(0)，并非生产 lg<20 的活动路径。',
 'cosmicUpdate 改写大量宇宙场景对象、材质、缓冲和 DOM；本原型不恢复也不声称恢复这些字段，必须丢弃隔离页面。',
 '只核验报告列举的渲染器状态；未覆盖所有 WebGL 状态、场景对象、异步任务、随机数或持续恢复故障。',
 '离屏直接渲染绕过生产后处理、颗粒和混合，量化读回不是全精度 HDR 或视觉连续性验收。'
]};
function save(){fs.writeFileSync(reportPath,JSON.stringify(result,null,2));}
function once(s,a,b){let i=s.indexOf(a);if(i<0||s.indexOf(a,i+a.length)>=0)throw Error('替换点缺失或不唯一: '+a);return s.slice(0,i)+b+s.slice(i+a.length);}
function paired(inject){
 const s=__SE,p=s.__paired,r=s.renderer,T=s.THREE,gl=r.getContext(),cs=s.CS;
 const before={target:r.getRenderTarget(),face:r.getActiveCubeFace(),mip:r.getActiveMipmapLevel(),auto:r.autoClear,tone:r.toneMapping,space:r.outputColorSpace,viewport:r.getViewport(new T.Vector4()).toArray(),scissor:r.getScissor(new T.Vector4()).toArray(),scissorTest:r.getScissorTest()};
 const state=()=>({journey:s.journeyInfo,frozen:p.JOURNEY.frozen,frame:p.getFrame(),random:{...window.__seedProbe},main:{alt:s.cam.alt,starVisible:s.starfield.visible,children:s.scene.children.length},cosmos:{active:cs.active,built:cs.built,r:cs.orbitR,unit:cs.unit,theta:cs.theta,phi:cs.phi,target:cs.target.toArray(),gals:cs.gals.length,children:cs.scene.children.length},clock:[Date.now(),performance.now()]});
 const camera=c=>({position:c.position.toArray(),direction:c.getWorldDirection(new T.Vector3()).toArray(),up:c.up.toArray(),quaternion:c.quaternion.toArray(),aspect:c.aspect,fov:c.fov});
 const start=state(),targets=[],items=[];let caught=null;
 function draw(name,scene,cam){
  const target=new T.WebGLRenderTarget(96,64,{type:T.HalfFloatType,format:T.RGBAFormat,depthBuffer:true});targets.push(target);
  const out=new T.WebGLRenderTarget(96,64,{type:T.UnsignedByteType,format:T.RGBAFormat,depthBuffer:false});targets.push(out);
  r.setRenderTarget(target);const status=gl.checkFramebufferStatus(gl.FRAMEBUFFER),component=gl.getFramebufferAttachmentParameter(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.FRAMEBUFFER_ATTACHMENT_COMPONENT_TYPE),bits=['RED','GREEN','BLUE','ALPHA'].map(c=>gl.getFramebufferAttachmentParameter(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl['FRAMEBUFFER_ATTACHMENT_'+c+'_SIZE']));
  r.clear();r.render(scene,cam);
  if(inject===name)throw Error('injected:'+name);
  const qscene=new T.Scene(),qc=new T.OrthographicCamera(-1,1,1,-1,0,1),mat=new T.ShaderMaterial({uniforms:{src:{value:target.texture}},vertexShader:'varying vec2 v;void main(){v=uv;gl_Position=vec4(position.xy,0.,1.);}',fragmentShader:'varying vec2 v;uniform sampler2D src;void main(){gl_FragColor=vec4(clamp(texture2D(src,v).rgb/8.,0.,1.),1.);}',toneMapped:false,depthTest:false,depthWrite:false}),geo=new T.PlaneGeometry(2,2);qscene.add(new T.Mesh(geo,mat));
  try{r.setRenderTarget(out);const outStatus=gl.checkFramebufferStatus(gl.FRAMEBUFFER);r.clear();r.render(qscene,qc);const pixels=new Uint8Array(96*64*4);r.readRenderTargetPixels(out,0,0,96,64,pixels);let sum=0,nonzero=0,max=0,saturated=0;for(let i=0;i<pixels.length;i+=4)for(let j=0;j<3;j++){let v=pixels[i+j];sum+=v;nonzero+=v>0;max=Math.max(max,v);saturated+=v===255;}const errors=[];for(let i=0;i<16;i++){const e=gl.getError();if(e===gl.NO_ERROR)break;errors.push(e);}items.push({name,sceneChildren:scene.children.length,camera:camera(cam),state:state(),fbo:{status,complete:status===gl.FRAMEBUFFER_COMPLETE,component,bits,rgba16f:component===gl.FLOAT&&bits.every(v=>v===16),quantizationComplete:outStatus===gl.FRAMEBUFFER_COMPLETE},quantized:{divisor:8,sum,nonzero,max,saturated,pixels:Array.from(pixels)},errors});}finally{geo.dispose();mat.dispose();}
 }
 try{
  if(!p.JOURNEY.frozen||cs.active||!cs.built||Math.abs(p.JOURNEY.lg-19.98)>1e-8)throw Error('冻结主场景基线不满足');
  r.toneMapping=T.NoToneMapping;
  draw('main',s.scene,s.camera);
  const d=s.camera.getWorldDirection(new T.Vector3());cs.orbitR=2e20*Math.pow(10,p.JOURNEY.lg-20);cs.theta=Math.atan2(-d.z,-d.x);cs.phi=Math.asin(Math.max(-1,Math.min(1,-d.y)));cs.target.set(0,0,0);cs.autoCenter=false;cs.upCur=s.camera.up.clone();p.cosmicUpdate(0);
  draw('cosmos',cs.scene,cs.cam);
 }catch(e){caught=String(e&&e.message||e);}finally{
  r.setRenderTarget(before.target,before.face,before.mip);r.autoClear=before.auto;r.toneMapping=before.tone;r.outputColorSpace=before.space;r.setViewport(...before.viewport);r.setScissor(...before.scissor);r.setScissorTest(before.scissorTest);for(const t of targets)t.dispose();
 }
 const restored={target:r.getRenderTarget()===before.target,face:r.getActiveCubeFace()===before.face,mip:r.getActiveMipmapLevel()===before.mip,autoClear:r.autoClear===before.auto,toneMapping:r.toneMapping===before.tone,outputColorSpace:r.outputColorSpace===before.space,viewport:JSON.stringify(r.getViewport(new T.Vector4()).toArray())===JSON.stringify(before.viewport),scissor:JSON.stringify(r.getScissor(new T.Vector4()).toArray())===JSON.stringify(before.scissor),scissorTest:r.getScissorTest()===before.scissorTest};
 return {inject,caught,start,end:state(),items,restored,contextLost:gl.isContextLost()};
}
async function build(){
 let b=fs.readFileSync(path.join(root,'build.mjs'),'utf8').replace(/\r\n/g,'\n');
 result.inputHashes=Object.fromEntries(['build.mjs','public/index.html','public/js/app.js','tools/test-deep-models.cjs'].map(f=>[f,hash(fs.readFileSync(path.join(root,f)))]));
 b=once(b,'const ROOT = path.dirname(fileURLToPath(import.meta.url));',`const ROOT = ${JSON.stringify(root)};`);
 b=once(b,"const app = read('js/app.js');",`const app = read('js/app.js').replace('window.__SE = {', 'window.__SE = { __paired: {timeAtLg:cineTimeAtLg,JOURNEY,cosmicBuild,cosmicUpdate,getFrame:()=>frameId},');`);
 b=once(b,`for (const name of ['space.html', 'index.html']) {\n  fs.writeFileSync(path.join(ROOT, name), htmlOffline);\n}\nfs.writeFileSync(path.join(ROOT, 'space-http.html'), htmlHttp);`,`fs.writeFileSync(${JSON.stringify(path.join(output,'preview.html'))}, htmlOffline, {flag:'wx'});`);
 await import('data:text/javascript;base64,'+Buffer.from(b).toString('base64'));result.previewSha256=hash(fs.readFileSync(path.join(output,'preview.html')));
}
async function run(){
 await build();const framework=path.join(root,'tools/test-deep-models.cjs');let src=fs.readFileSync(framework,'utf8');const cut=src.indexOf('async function main() {');if(cut<0)throw Error('驱动入口缺失');src=src.slice(0,cut).replace("const profile = fs.mkdtempSync(path.join(parent, 'probe-deep-models-'));","const profile = fs.mkdtempSync(path.join(output, 'chrome-profile-'));");
 const driver=`(async()=>{try{
 await launch();await send('Page.addScriptToEvaluateOnNewDocument',{source: \`(()=>{let x=0x13579bdf;window.__seedProbe={seed:x,calls:0,state:x};Math.random=()=>{x^=x<<13;x^=x>>>17;x^=x<<5;x>>>=0;window.__seedProbe.calls++;window.__seedProbe.state=x;return x/4294967296;};})();\`});
 await load(pathToFileURL(path.join(output,'preview.html')).href+'?auto=0&q=high&prewarm=0','file');
 phase='预建宇宙层';result.prewarm=await evaluate('(()=>{const a={...window.__seedProbe};__SE.__paired.cosmicBuild();return {before:a,after:{...window.__seedProbe},built:__SE.CS.built,gals:__SE.CS.gals.length}})()');
 await evaluate('__SE.journey(0);__SE.ts=0;__SE.journeySeek(__SE.__paired.timeAtLg(19.98));true');await frames(3);
 for(const injection of [null,'main','cosmos']){
  phase='同步双侧采样 '+injection;const x=await evaluate('('+paired.toString()+')('+JSON.stringify(injection)+')');for(const item of x.items){const bytes=Buffer.from(item.quantized.pixels);delete item.quantized.pixels;item.quantized.sha256=hash(bytes);}result.cases.push(x);save();
 }
 result.driver={browser:report.browser,gpu:report.gpu,launch:report.launch,errors:report.errors};
 result.checks=result.cases.map(x=>({injection:x.inject,expectedException:x.inject?x.caught==='injected:'+x.inject:x.caught===null,rendererRestored:Object.values(x.restored).every(Boolean),sameFrame:x.start.frame===x.end.frame,fboValid:x.items.length?x.items.every(i=>i.fbo.complete&&i.fbo.rgba16f&&i.fbo.quantizationComplete&&!i.errors.length):null,nonzero:x.items.length?x.items.every(i=>i.quantized.nonzero>0):null,expectedItems:x.items.length===(x.inject==='main'?0:x.inject==='cosmos'?1:2),noContextLoss:!x.contextLost}));
 result.errors.push({phase:'完整状态隔离',error:'宇宙更新修改的场景对象、uniform、缓冲及 DOM 尚无完整快照和恢复，故整体不通过；隔离页面必须丢弃。'});
 }catch(e){result.errors.push({phase,error:errorText(e)});}finally{if(browser){try{cleanupPromise=Promise.resolve();await browser.send('Browser.close');}catch(e){result.errors.push({phase:'关闭浏览器',error:errorText(e)});}browser.ws.close();}else if(child&&child.exitCode===null)child.kill();for(const [f,h] of Object.entries(result.inputHashes||{})){if(hash(fs.readFileSync(path.join(root,f)))!==h)result.errors.push({phase:'输入哈希',error:f+' 已变化'});}save();console.log(JSON.stringify({report:reportPath,status:result.status,cases:result.cases.length,checks:result.checks,errors:result.errors},null,2));process.exitCode=1;}})();`;
 vm.runInThisContext(`(function(require,__dirname,__filename,process,Buffer,WebSocket,output,result,save,hash,paired,reportPath,root){${src}\n${driver}\n})`,{filename:framework})(require,__dirname,framework,process,Buffer,WebSocket,output,result,save,hash,paired,reportPath,root);
}
save();run().catch(e=>{result.errors.push({phase:'构建或初始化',error:e.stack||String(e)});save();console.error(JSON.stringify({report:reportPath,errors:result.errors},null,2));process.exitCode=1;});
