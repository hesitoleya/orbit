'use strict';
// 隔离预览及实际活动场景离屏测量；不合入生产渲染管线。
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const {randomUUID, createHash} = require('node:crypto');
const root = path.resolve(__dirname, '..');
const output = path.join(root, '.workbuddy', 'p2-dual-scene-' + randomUUID());
fs.mkdirSync(output);
const framework = path.join(__dirname, 'test-deep-models.cjs');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const reportPath = path.join(output, 'report.json');
const result = {startedAt:new Date().toISOString(), output, status:'incomplete', errors:[], cases:[], limitations:[
  '实验旁路直接绘制当前活动场景，不是生产后处理或跨层混合。',
  '未实现固定同一时刻独立重建两场景；不得据此认定双场景 HDR 接力已验证。',
  '截图、尺寸变化和全部场景状态恢复未经验证；场景间比较仅供诊断。'
]};
function save() { fs.writeFileSync(reportPath, JSON.stringify(result,null,2)); }
save();
function once(s, a, b) { const i=s.indexOf(a); if(i<0 || s.indexOf(a,i+a.length)>=0) throw Error('替换点缺失或不唯一: '+a); return s.slice(0,i)+b+s.slice(i+a.length); }
async function build() {
  let s=fs.readFileSync(path.join(root,'build.mjs'),'utf8').replace(/\r\n/g,'\n');
  result.inputHashes={};
  for(const f of ['build.mjs','public/index.html','public/js/app.js']) result.inputHashes[f]=hash(fs.readFileSync(path.join(root,f)));
  s=once(s,"const ROOT = path.dirname(fileURLToPath(import.meta.url));",`const ROOT = ${JSON.stringify(root)};`);
  s=once(s,"const app = read('js/app.js');",`const app = read('js/app.js').replace('window.__SE = {', 'window.__SE = { __probeTimeAtLg: cineTimeAtLg,');`);
  s=once(s,`for (const name of ['space.html', 'index.html']) {\n  fs.writeFileSync(path.join(ROOT, name), htmlOffline);\n}\nfs.writeFileSync(path.join(ROOT, 'space-http.html'), htmlHttp);`,`fs.writeFileSync(${JSON.stringify(path.join(output,'preview.html'))}, htmlOffline, {flag:'wx'});`);
  await import('data:text/javascript;base64,'+Buffer.from(s).toString('base64'));
  result.previewSha256=hash(fs.readFileSync(path.join(output,'preview.html')));
}
function sample() {
  const r=__SE.renderer, gl=r.getContext(), T=__SE.THREE, cs=__SE.CS.active;
  const sc=cs?__SE.CS.scene:__SE.scene, camera=cs?__SE.CS.cam:__SE.camera;
  const prev=r.getRenderTarget(), face=r.getActiveCubeFace(), mip=r.getActiveMipmapLevel(), auto=r.autoClear;
  const tone=r.toneMapping, space=r.outputColorSpace;
  const size=r.getDrawingBufferSize(new T.Vector2());
  const target=new T.WebGLRenderTarget(96,64,{type:T.HalfFloatType,format:T.RGBAFormat,depthBuffer:true,stencilBuffer:false});
  const out=new T.WebGLRenderTarget(96,64,{type:T.UnsignedByteType,format:T.RGBAFormat,depthBuffer:false});
  const quadScene=new T.Scene(), quadCam=new T.OrthographicCamera(-1,1,1,-1,0,1);
  const mat=new T.ShaderMaterial({uniforms:{src:{value:target.texture}},vertexShader:'varying vec2 uv0;void main(){uv0=uv;gl_Position=vec4(position.xy,0.,1.);}',fragmentShader:'varying vec2 uv0;uniform sampler2D src;void main(){gl_FragColor=vec4(clamp(texture2D(src,uv0).rgb/8.,0.,1.),1.);}',toneMapped:false,depthTest:false,depthWrite:false});
  const mesh=new T.Mesh(new T.PlaneGeometry(2,2),mat);quadScene.add(mesh);
  let data;
  try {
    r.toneMapping=T.NoToneMapping; r.setRenderTarget(target);
    const status=gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    const component=gl.getFramebufferAttachmentParameter(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.FRAMEBUFFER_ATTACHMENT_COMPONENT_TYPE);
    const bits=['RED','GREEN','BLUE','ALPHA'].map(c=>gl.getFramebufferAttachmentParameter(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl['FRAMEBUFFER_ATTACHMENT_'+c+'_SIZE']));
    r.clear();r.render(sc,camera);r.setRenderTarget(out);r.clear();r.render(quadScene,quadCam);
    const pixels=new Uint8Array(96*64*4);r.readRenderTargetPixels(out,0,0,96,64,pixels);
    let sum=0,nonzero=0,max=0;for(let i=0;i<pixels.length;i+=4) for(let j=0;j<3;j++){const x=pixels[i+j];sum+=x;if(x)nonzero++;max=Math.max(max,x);}
    const dir=new T.Vector3();camera.getWorldDirection(dir);
    const errors=[];for(let i=0;i<16;i++){const e=gl.getError();if(e===gl.NO_ERROR)break;errors.push(e);}
    data={active:cs?'cosmos':'main', journey:__SE.journeyInfo, camera:{direction:dir.toArray(),up:camera.up.toArray(),quaternion:camera.quaternion.toArray(),aspect:camera.aspect},scale:{alt:__SE.cam.alt,orbitR:__SE.CS.orbitR,unit:__SE.CS.unit},drawingBuffer:[size.x,size.y], target:[96,64], fbo:{status,complete:status===gl.FRAMEBUFFER_COMPLETE,component,bits,rgba16f:component===gl.FLOAT&&bits.every(v=>v===16)},quantized:{scale:8,sum,nonzero,max,pixels:Array.from(pixels)},glErrors:errors,contextLost:gl.isContextLost(),webgl2:r.capabilities.isWebGL2,colorBufferFloat:!!gl.getExtension('EXT_color_buffer_float')};
  } finally { r.setRenderTarget(prev,face,mip);r.autoClear=auto;r.toneMapping=tone;target.dispose();out.dispose();mesh.geometry.dispose();mat.dispose(); }
  data.restored={target:r.getRenderTarget()===prev,face:r.getActiveCubeFace()===face,mip:r.getActiveMipmapLevel()===mip,autoClear:r.autoClear===auto,toneMapping:r.toneMapping===tone,outputColorSpace:r.outputColorSpace===space};
  return data;
}
async function run() {
  await build();
  let source=fs.readFileSync(framework,'utf8');
  const cut=source.indexOf('async function main() {');if(cut<0)throw Error('驱动入口缺失');
  source=source.slice(0,cut).replace("const profile = fs.mkdtempSync(path.join(parent, 'probe-deep-models-'));", "const profile = fs.mkdtempSync(path.join(output, 'chrome-profile-'));");
  const probe=`
  (async()=>{try {
    await launch();
    await load(pathToFileURL(path.join(output,'preview.html')).href+'?auto=0&q=high','file');
    phase='固定时刻活动路径采样';
    report.metadata=await evaluate('({build:__SE.build,three:__SE.THREE.REVISION,renderer:__SE.renderer.getContext().getParameter(__SE.renderer.getContext().RENDERER)})');
    await evaluate('__SE.journey(0); __SE.ts=0; true');
    for(const lg of [19.98,20,20.02,20.02,20,19.98]) {
      phase='seek '+lg;
      const time=await evaluate('__SE.__probeTimeAtLg('+lg+')');
      const seek=await evaluate('__SE.journeySeek('+time+')');
      await frames(2);
      const measurement=await evaluate('('+sample.toString()+')()');
      const bytes=Buffer.from(measurement.quantized.pixels);delete measurement.quantized.pixels;
      measurement.quantized.sha256=hash(bytes);
      result.cases.push({lg,time,seek,measurement});save();
    }
    result.seekComparisons=[0,1,2].map(i=>{
      const a=result.cases[i], b=result.cases[5-i];
      const stateA=JSON.stringify({journey:a.measurement.journey,camera:a.measurement.camera,scale:a.measurement.scale});
      const stateB=JSON.stringify({journey:b.measurement.journey,camera:b.measurement.camera,scale:b.measurement.scale});
      return {lg:a.lg,stateExactMatch:stateA===stateB,pixelsExactMatch:a.measurement.quantized.sha256===b.measurement.quantized.sha256,warning:stateA===stateB?'严格字段一致，其他状态未验证':'正反 seek 观测状态不匹配'};
    });
    result.activityComparison={differentSeekTimes:true,mainVsCosmosDifferent:result.cases[0].measurement.quantized.sha256!==result.cases[1].measurement.quantized.sha256,warning:'不同时间的活动场景，不代表同一时刻双场景结果'};
    report.browserErrors=report.errors;
  } catch(e) { result.errors.push({phase,error:errorText(e)}); }
  finally {
    result.driver={browser:report.browser,gpu:report.gpu,launch:report.launch,errors:report.errors,metadata:report.metadata};
    if(browser){try{cleanupPromise=Promise.resolve();await browser.send('Browser.close')}catch(e){result.errors.push({phase:'关闭浏览器',error:errorText(e)})}browser.ws.close()}else if(child&&child.exitCode===null)child.kill();
    save();console.log(JSON.stringify({report:reportPath,status:result.status,cases:result.cases.length,errors:result.errors},null,2));process.exitCode=1;
  }})();`;
  vm.runInThisContext(`(function(require,__dirname,__filename,process,Buffer,WebSocket,output,result,save,hash,sample,reportPath){${source}\n${probe}\n})`,{filename:framework})(require,__dirname,framework,process,Buffer,WebSocket,output,result,save,hash,sample,reportPath);
}
run().catch(e=>{result.errors.push({phase:'构建或驱动初始化',error:e.stack||String(e)});save();console.error(JSON.stringify({report:reportPath,status:result.status,errors:result.errors},null,2));process.exitCode=1;});
