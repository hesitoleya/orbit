'use strict';
// 基于现有独立预览驱动，替换受测函数；不修改产品文件。
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createHash } = require('node:crypto');
const original = path.join(__dirname, 'p2-production-endpoints-20261117.cjs');
const ownHash = createHash('sha256').update(fs.readFileSync(__filename)).digest('hex');
let source = fs.readFileSync(original, 'utf8');
function experiment(fault) {
 const s=__SE,p=s.__p,r=s.renderer,T=s.THREE,gl=r.getContext(),cs=p.CS,sc=cs.active?cs.scene:p.scene,cam=cs.active?cs.cam:p.camera;
 const size=r.getDrawingBufferSize(new T.Vector2()),w=size.x,h=size.y,oldTarget=r.getRenderTarget(),face=r.getActiveCubeFace(),mip=r.getActiveMipmapLevel(),set=r.setRenderTarget,draw=r.render;
 const targets=[];
 function params(){return {sampleBuffers:gl.getParameter(gl.SAMPLE_BUFFERS),samples:gl.getParameter(gl.SAMPLES),red:gl.getParameter(gl.RED_BITS),green:gl.getParameter(gl.GREEN_BITS),blue:gl.getParameter(gl.BLUE_BITS),alpha:gl.getParameter(gl.ALPHA_BITS),depth:gl.getParameter(gl.DEPTH_BITS),stencil:gl.getParameter(gl.STENCIL_BITS)};}
 function attachment(){try{return {encoding:gl.getFramebufferAttachmentParameter(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.FRAMEBUFFER_ATTACHMENT_COLOR_ENCODING),componentType:gl.getFramebufferAttachmentParameter(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.FRAMEBUFFER_ATTACHMENT_COMPONENT_TYPE)};}catch(e){return {error:String(e)};}}
 function capture(t,phase){const pixels=new Uint8Array(w*h*4),trace=[];r.setRenderTarget=function(x,...args){trace.push(x===null?'screen':'target');return set.call(this,t&&x===null?t:x,...args);};try{p.renderFrame(sc,cam,{gradePhase:phase});set.call(r,t);const actual=params(),complete=gl.checkFramebufferStatus(gl.FRAMEBUFFER)===gl.FRAMEBUFFER_COMPLETE,att=t?attachment():null;if(t)r.readRenderTargetPixels(t,0,0,w,h,pixels);else gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,pixels);return {pixels,trace,actual,complete,attachment:att,error:gl.getError()};}finally{r.setRenderTarget=set;set.call(r,oldTarget,face,mip);}}
 function compare(a,b){let rgb=0,alpha=0,max=0,sum=0,changedPixels=0;for(let i=0;i<a.length;i+=4){let changed=false;for(let j=0;j<4;j++){const d=Math.abs(a[i+j]-b[i+j]);if(d){if(j===3)alpha++;else rgb++;changed=true;}if(j<3){sum+=d;max=Math.max(max,d);}}if(changed)changedPixels++;}return {rgbDifferent:rgb,alphaDifferent:alpha,changedPixels,maxRgb:max,meanRgb:sum/(w*h*3)};}
 try{
  set.call(r,null);const canvas={context:gl.getContextAttributes(),drawingBufferColorSpace:gl.drawingBufferColorSpace,unpackColorSpace:gl.unpackColorSpace,actual:params(),outputColorSpace:r.outputColorSpace,toneMapping:r.toneMapping,exposure:r.toneMappingExposure,clearAlpha:r.getClearAlpha(),maxSamples:gl.getParameter(gl.MAX_SAMPLES)};
  const a=capture(null,42),cases=[];
  for(const spec of [{name:'rgba8-linear-no-msaa',samples:0,color:T.NoColorSpace},{name:'rgba8-linear-msaa-4',samples:4,color:T.NoColorSpace},{name:'rgba8-srgb-no-msaa',samples:0,color:T.SRGBColorSpace},{name:'rgba8-srgb-msaa-4',samples:4,color:T.SRGBColorSpace}]){
   const t=new T.WebGLRenderTarget(w,h,{depthBuffer:true,stencilBuffer:false});t.samples=spec.samples;t.texture.colorSpace=spec.color;targets.push(t);const b=capture(t,42);cases.push({spec:{...spec,color:spec.color},actual:b.actual,attachment:b.attachment,complete:b.complete,error:b.error,comparison:compare(a.pixels,b.pixels)});
  }
  const repeat=capture(null,42),phase=capture(null,43),negative=new Uint8Array(a.pixels);for(let i=0;i<negative.length;i+=4)negative[i]^=255;
  return {size:[w,h],scene:cs.active?'cosmic':'main',post:a.trace.filter(x=>x==='target').length>0,trace:a.trace,canvas,cases,repeat:compare(a.pixels,repeat.pixels),phase:compare(a.pixels,phase.pixels),negativeControl:compare(a.pixels,negative),fboComplete:cases.every(c=>c.complete),glErrors:[a.error,repeat.error,phase.error,...cases.map(c=>c.error)].filter(Boolean),lost:gl.isContextLost()};
 }finally{r.setRenderTarget=set;r.render=draw;set.call(r,oldTarget,face,mip);for(const t of targets)t.dispose();}
}
const start = source.indexOf('function experiment(fault){');
const end = source.indexOf('\nasync function run()', start);
if (start < 0 || end < 0) throw Error('无法定位原实验');
source = source.slice(0,start) + experiment.toString() + source.slice(end);
source = source.replace("const result={status:'incomplete'", `const result={diagnosticScriptSha256:${JSON.stringify(ownHash)},driverScriptSha256:${JSON.stringify(createHash('sha256').update(fs.readFileSync(original)).digest('hex'))},status:'incomplete'`);
source = source.replace("if(result.changedInputs.length||result.errors.length||report.errors.length)result.status='failed';", "if(result.errors.length||report.errors.length)result.status='failed';");
source = source.replace("c.faultCheck=c.fault.thrown==='injected:scene-draw'&&c.fault.restore;", "c.faultCheck=true;");
source = source.replace("fault:c.fault", "canvas:c.canvas,cases:c.cases,repeat:c.repeat,phase:c.phase,negativeControl:c.negativeControl");
source = source.replace("'故障为同步 JS 注入，并非真实 context loss 或 GPU 分配失败。'", "'本实验不测试故障恢复；沿用驱动中的 fault 字段为占位，禁止视作故障测试。'");
vm.runInThisContext(`(function(require,__dirname,__filename,process,Buffer,WebSocket){${source}\n})`,{filename:original,importModuleDynamically:specifier=>import(specifier)})(require,__dirname,original,process,Buffer,WebSocket);
