'use strict';
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const base = path.join(__dirname, 'test-p2-production-mcomp-independent-20261117.cjs');
let source = fs.readFileSync(base, 'utf8');
function gpuTest(extracted) {
  const renderer = new THREE.WebGLRenderer({antialias:false,preserveDrawingBuffer:true});
  renderer.setSize(4,4,false); renderer.toneMapping=THREE.NoToneMapping;
  const gl=renderer.getContext(), dbg=gl.getExtension('WEBGL_debug_renderer_info');
  const metadata={three:THREE.REVISION,webgl:gl.getParameter(gl.VERSION),shadingLanguage:gl.getParameter(gl.SHADING_LANGUAGE_VERSION),vendor:dbg?gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL):gl.getParameter(gl.VENDOR),renderer:dbg?gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),input:'1x1 RGBA Float32 DataTexture, NEAREST',output:'4x4 RGBA8 UnsignedByte render target; readRenderTargetPixels RGBA/UNSIGNED_BYTE',dither:'disabled'};
  const mat=new Function('THREE','GRADE',`const _post={}; ${extracted}; return _post.mComp;`)(THREE,{on:false});
  const scene=new THREE.Scene(), camera=new THREE.OrthographicCamera(-1,1,1,-1,0,1), quad=new THREE.Mesh(new THREE.PlaneGeometry(2,2),mat); scene.add(quad);
  const out=new THREE.WebGLRenderTarget(4,4,{depthBuffer:false,stencilBuffer:false,format:THREE.RGBAFormat,type:THREE.UnsignedByteType});
  renderer.setRenderTarget(out); gl.disable(gl.DITHER);
  const framebufferStatus=gl.checkFramebufferStatus(gl.FRAMEBUFFER), expectedStatus=gl.FRAMEBUFFER_COMPLETE;
  const errors=[]; function checkGL(stage){let e; while((e=gl.getError())!==gl.NO_ERROR)errors.push({stage,error:e});}
  checkGL('setup');
  function tex(v){const t=new THREE.DataTexture(new Float32Array([...v,1]),1,1,THREE.RGBAFormat,THREE.FloatType);t.minFilter=t.magFilter=THREE.NearestFilter;t.needsUpdate=true;return t;}
  const u=mat.uniforms, bloom=[0,0,0], bt=tex(bloom);
  ['tB1','tB2','tB3','tB4','tB5'].forEach(n=>u[n].value=bt);
  u.uStrength.value=.8;u.uExposure.value=1;u.uWide.value=1;u.uWGain.value=1;u.uSunVis.value=0;u.uGlareK.value=0;u.uStarK.value=0;u.uGhost.value=0;u.uGrade.value=0;u.uGradeT.value=0;
  const clamp=x=>Math.max(0,Math.min(1,x)),smooth=(a,b,x)=>{let t=clamp((x-a)/(b-a));return t*t*(3-2*t);},dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0),mix=(a,b,t)=>a*(1-t)+b*t;
  function cpu(input,k){
    let c=input.map(Math.fround).map(v=>v/.6), mul=(v,m)=>m.map(row=>dot(row,v));
    c=mul(c,[[.59719,.35458,.04823],[.076,.90834,.01566],[.0284,.13383,.83777]]);
    c=c.map(v=>(v*(v+.0245786)-.000090537)/(v*(.983729*v+.432951)+.238081));
    c=mul(c,[[1.60475,-.53108,-.07367],[-.10208,1.10813,-.00605],[-.00327,-.07276,1.07602]]).map(clamp);
    if(Math.fround(k)>Math.fround(.001)) {k=Math.fround(k); c=c.map((v,i)=>v+smooth(.70,1,v)*[1,.70,.44][i]*.085*k);const l=dot(c,[.2126,.7152,.0722]),t=smooth(.16,.82,l); c=c.map((v,i)=>mix(v*[.945,.985,1.065][i],v*[1.055,1.005,.945][i],t)); const bp=.012*k;c=c.map(v=>clamp(Math.max(v-bp,0)/Math.max(1-bp,.001)));c=c.map(v=>mix(v,v*v*(3-2*v),.08*k)*(1+.035*k));}
    const srgb=c.map(v=>v<=.0031308?12.92*v:1.055*Math.pow(v,.41666)-.055);return {srgb,rgba8:[...srgb.map(v=>Math.round(clamp(v)*255)),255]};
  }
  const inputs=[[.01,.01,.01],[.18,.18,.18],[1,1,1],[4,.5,2]], ks=[.000999,.001001], results=[];
  for(const input of inputs){const st=tex(input);u.tScene.value=st;const values=[];
    for(const k of ks){u.uCosmos.value=k;renderer.setRenderTarget(out);renderer.render(scene,camera);checkGL('draw '+input+' '+k);const status=gl.checkFramebufferStatus(gl.FRAMEBUFFER);const p=new Uint8Array(64);renderer.readRenderTargetPixels(out,0,0,4,4,p);checkGL('read '+input+' '+k);const pixel=Array.from(p.slice(0,4));const uniformPixels=Array.from({length:16},(_,i)=>Array.from(p.slice(i*4,i*4+4))).every(v=>v.every((x,i)=>x===pixel[i]));const reference=cpu(input,k); values.push({uCosmos:k,float32:Math.fround(k),framebufferStatus:status,rgba8:pixel,uniformPixels,cpu:reference,gpuMinusCpu:pixel.map((v,i)=>v-reference.rgba8[i])});}
    results.push({inputFloat32:input.map(Math.fround),values,jumpGpu:values[1].rgba8.map((v,i)=>v-values[0].rgba8[i]),jumpCpu:values[1].cpu.rgba8.map((v,i)=>v-values[0].cpu.rgba8[i])});st.dispose();
  }
  checkGL('final');const tests=[{name:'FBO 完整、无 GL 错误且上下文有效',status:framebufferStatus===expectedStatus&&results.every(r=>r.values.every(v=>v.framebufferStatus===expectedStatus&&v.uniformPixels))&&errors.length===0&&!gl.isContextLost()?'pass':'fail',details:{framebufferStatus,expectedStatus,errors,contextLost:gl.isContextLost()}},{name:'GPU 和独立 CPU 量化值相差不超过 2',status:results.every(r=>r.values.every(v=>v.gpuMinusCpu.every(x=>Math.abs(x)<=2)))?'pass':'fail'}];
  bt.dispose();out.dispose();mat.dispose();quad.geometry.dispose();renderer.dispose();
  return {metadata,settings:{bloom,exposure:1,grade:0,glare:0,star:0,ghost:0},notes:['阈值两侧均运行完整且完全相同的生产 mComp，只有 uCosmos 不同。','CPU 使用双精度公式近似及 float32 输入，不模拟全部 GPU 中间舍入。','不是端点独立基线，不是完整生产渲染，也不是转场修复。'],results,tests};
}
const start=source.indexOf('function gpuTest(extracted){'), end=source.indexOf('\nconst start=source.indexOf(',start);
if(start<0||end<0)throw Error('无法定位 GPU 测试');
source=source.slice(0,start)+gpuTest.toString()+'\n'+source.slice(end);
source=source.replace("'p2-production-mcomp-independent-'", "'p2-cosmos-threshold-gpu-independent-gp5-'");
source=source.replace("report.experiment='生产 mComp 有限输入独立 GPU 和 CPU 数学基准'", "report.experiment='生产 mComp uCosmos 阈值独立 GPU 和 CPU 对照'");
source=source.replace(/report\.notes=\[[\s\S]*?\];\n await launch\(\)/, "report.notes=['从 app.js 原样抽取完整材质；独立 about:blank 中执行，未加载产品入口。','固定 float32 常量 scene、零 bloom、曝光 1，关闭 grade 和全部 glare；同一 shader 只改变 uCosmos。','CPU 双精度近似，输入 float32；输出 RGBA8，非生产 RGBA16F 场景输入，不覆盖真实场景或完整后处理链。','脚手架 urls 和 viewport 为未使用的默认字段。'];\n await launch()");
vm.runInThisContext(`(function(require,__dirname,__filename){${source}\n})`,{filename:base})(require,__dirname,base);
