'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const framework=path.join(__dirname,'test-deep-models.cjs');
const src=fs.readFileSync(framework,'utf8'),cut=src.indexOf('async function main() {');
if(cut<0)throw Error('找不到驱动入口');
const code=String.raw`
const out=path.join(ROOT,'.workbuddy','m51-b0-v198-'+RUN_ID);fs.mkdirSync(out);
const files=['space.html','index.html','space-http.html','public/js/app.js','public/js/deep-models.js'];
const hash=f=>createHash('sha256').update(fs.readFileSync(path.join(ROOT,f))).digest('hex');
report.before=Object.fromEntries(files.map(f=>[f,hash(f)]));report.cases=[];
function shotSequence(){
 const r=__SE.renderer,s=__SE.deep.controller.scene,cam=__SE.deep.controller.camera,gl=r.getContext();
 const objects={};s.traverse(o=>{if(['AnalyticVolumeRayIntegral','VolumeExtinguishedStars'].includes(o.name))(objects[o.name] ||= []).push(o)});
 const v=objects.AnalyticVolumeRayIntegral,st=objects.VolumeExtinguishedStars;
 if(v?.length!==1||st?.length!==1)throw Error('分层对象不唯一');
 const volume=v[0],stars=st[0],orig=r.render, events=[];let layer=null,copyMat=null,copyGeo=null,mode='A',hits=0;
 const sceneCopy=new THREE.Scene(),copyCam=new THREE.OrthographicCamera(-1,1,1,-1,0,1);
 copyGeo=new THREE.PlaneGeometry(2,2);copyMat=new THREE.ShaderMaterial({uniforms:{tex:{value:null}},vertexShader:'varying vec2 uv0; void main(){uv0=uv;gl_Position=vec4(position.xy,0.,1.);}',fragmentShader:'varying vec2 uv0; uniform sampler2D tex; void main(){gl_FragColor=texture2D(tex,uv0);}',depthTest:false,depthWrite:false,blending:THREE.NoBlending,toneMapped:false});
 sceneCopy.add(new THREE.Mesh(copyGeo,copyMat));
 function wrapped(scene,camera,...args){
  if(mode!=='B'||scene!==s)return orig.call(this,scene,camera,...args);
  hits++;const target=r.getRenderTarget();if(!target||!target.texture||target.texture.type!==THREE.HalfFloatType)throw Error('场景目标不是 HDR RT');
  if(!layer){layer=target.clone();layer.samples=target.samples;layer.texture.name='experimental-volume';}
  if(layer.width!==target.width||layer.height!==target.height||layer.texture===target.texture)throw Error('目标尺寸或采样反馈异常');
  const old={background:s.background,auto:r.autoClear,v:volume.visible,st:stars.visible,target,viewport:r.getViewport(new THREE.Vector4()),scissor:r.getScissor(new THREE.Vector4()),test:r.getScissorTest()};
  try{
   s.background=null;stars.visible=false;r.setRenderTarget(layer);r.clear();orig.call(r,s,camera,...args);
   r.setRenderTarget(target);copyMat.uniforms.tex.value=layer.texture;r.autoClear=false;orig.call(r,sceneCopy,copyCam);
   volume.visible=false;stars.visible=old.st;orig.call(r,s,camera,...args);
   events.push({width:target.width,height:target.height,samples:target.samples,layerSamples:layer.samples,distinct:layer.texture!==target.texture,volume:old.v,stars:old.st});
  }finally{
   s.background=old.background;volume.visible=old.v;stars.visible=old.st;r.autoClear=old.auto;r.setRenderTarget(old.target);r.setViewport(old.viewport);r.setScissor(old.scissor);r.setScissorTest(old.test);
  }
 }
 const save={target:r.getRenderTarget(),viewport:r.getViewport(new THREE.Vector4()),scissor:r.getScissor(new THREE.Vector4()),test:r.getScissorTest(),auto:r.autoClear,bg:s.background,v:volume.visible,st:stars.visible};
 const images={};let failure=null;
 try {r.render=wrapped;for(const name of ['A1','B0','A2']){mode=name==='B0'?'B':'A';images[name]=__SE.snap('image/png',{gradePhase:0});}if(hits!==1)throw Error('B0 主场景调用次数 '+hits);}
 catch(e){failure=e.stack||String(e)}finally{r.render=orig;volume.visible=save.v;stars.visible=save.st;s.background=save.bg;r.autoClear=save.auto;r.setRenderTarget(save.target);r.setViewport(save.viewport);r.setScissor(save.scissor);r.setScissorTest(save.test);if(layer)layer.dispose();copyMat.dispose();copyGeo.dispose();}
 const errors=[];for(let i=0;i<16;i++){const e=gl.getError();if(!e)break;errors.push(e)}
 return {images,failure,hits,events,restored:{hook:r.render===orig,target:r.getRenderTarget()===save.target,viewport:r.getViewport(new THREE.Vector4()).equals(save.viewport),scissor:r.getScissor(new THREE.Vector4()).equals(save.scissor),scissorTest:r.getScissorTest()===save.test,autoClear:r.autoClear===save.auto,background:s.background===save.bg,volume:volume.visible===save.v,stars:stars.visible===save.st},glErrors:errors,lost:gl.isContextLost(),camera:__SE.deep.info().camera};
}
async function compareImages(urls){
 const imgs=await Promise.all(urls.map(url=>new Promise((resolve,reject)=>{const i=new Image();i.onload=()=>resolve(i);i.onerror=reject;i.src=url})));
 const canvas=document.createElement('canvas');canvas.width=imgs[0].width;canvas.height=imgs[0].height;const ctx=canvas.getContext('2d',{willReadFrequently:true});
 const pixels=imgs.map(i=>{if(i.width!==canvas.width||i.height!==canvas.height)throw Error('尺寸不一致');ctx.drawImage(i,0,0);return ctx.getImageData(0,0,canvas.width,canvas.height).data});
 function diff(a,b){let sum=0,max=0,changed=0;for(let i=0;i<a.length;i+=4)for(let j=0;j<3;j++){const d=Math.abs(a[i+j]-b[i+j]);sum+=d;max=Math.max(max,d);if(d)changed++;}return {meanAbsRgb:sum/(canvas.width*canvas.height*3),maxAbs:max,changedChannels:changed,totalChannels:canvas.width*canvas.height*3};}
 return {width:canvas.width,height:canvas.height,a1a2:diff(pixels[0],pixels[2]),a1b0:diff(pixels[0],pixels[1])};
}
async function run(){
 await launch();
 for(const msaa of [true,false]){
  phase='加载 '+(msaa?'默认 MSAA':'禁用 MSAA');await load(FILE_URL+(msaa?'':'&bloomMsaa=0'),'file');
  const env=await evaluate("(()=>{const r=__SE.renderer,g=r.getContext(),x=g.getExtension('WEBGL_debug_renderer_info');return {build:__SE.build,url:location.href,renderer:x&&g.getParameter(x.UNMASKED_RENDERER_WEBGL),vendor:x&&g.getParameter(x.UNMASKED_VENDOR_WEBGL),webgl:g.getParameter(g.VERSION),buffer:[g.drawingBufferWidth,g.drawingBufferHeight]}})()");
  assert(env.build==='v198','构建不是 v198',env);report.environment ||= [];report.environment.push(env);
  await evaluate('__SE.deep.open("m51");__SE.deep.setDust(true);__SE.deep.setView("front");true');await frames(3);
  for(const view of ['front','near']){
   phase=(msaa?'msaa':'no-msaa')+' '+view;await evaluate('__SE.deep.setView('+JSON.stringify(view)+');true');await frames(2);
   const result=await evaluate('('+shotSequence.toString()+')()');const item={msaa,view,...result};delete item.images;report.cases.push(item);
   if(result.failure)throw Error(result.failure);
   item.diff=await evaluate('('+compareImages.toString()+')('+JSON.stringify([result.images.A1,result.images.B0,result.images.A2])+')');
   for(const [name,data] of Object.entries(result.images)){const file=path.join(out,(msaa?'msaa':'no-msaa')+'-'+view+'-'+name+'.png');fs.writeFileSync(file,Buffer.from(data.split(',')[1],'base64'),{flag:'wx'});}
   assert(Object.values(result.restored).every(Boolean)&&!result.lost&&!result.glErrors.length,'渲染状态恢复或 GL 异常',result);
   assert(result.events.length===1&&result.events[0].samples===(msaa?4:0),'MSAA 状态异常',result.events);
  }
 }
}
(async()=>{try{await run()}catch(e){report.fatal={phase,error:errorText(e),details:e.details}}finally{
 report.after=Object.fromEntries(files.map(f=>[f,hash(f)]));report.hashesMatch=files.every(f=>report.before[f]===report.after[f]);
 if(browser){try{cleanupPromise=Promise.resolve();await browser.send('Browser.close')}catch(e){report.closeError=errorText(e)}browser.ws.close()}
 report.notes=['A1/B0/A2 在同一 JavaScript 任务内同步截图，固定 gradePhase=0；像素差为最终 PNG RGB 8 位而非线性 HDR。','未测 GPU 计时与半分辨率，不推断性能收益。','背景 null；切换离屏目标后才从纹理读取，禁止反馈；使用 Three.js render 完成后的 MSAA resolve。','独立浏览器 profile 保留；不清理其他 profile，也不操作项目服务。'];
 report.ok=!report.fatal&&report.hashesMatch&&report.cases.length===4;fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2),{flag:'wx'});console.log(JSON.stringify({out,ok:report.ok,fatal:report.fatal}));process.exitCode=report.ok?0:1;
}})();
`;
vm.runInThisContext(`(function(require,__dirname,__filename,process,Buffer,WebSocket){\n${src.slice(0,cut)}\n${code}\n})`,{filename:__filename})(require,__dirname,framework,process,Buffer,WebSocket);
