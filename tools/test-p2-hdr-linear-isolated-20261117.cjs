'use strict';
// 独立 GPU 合成单元测试；不加载产品入口，不改写产品管线。
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const output = fs.mkdtempSync(path.join(root, '.workbuddy', 'p2-hdr-linear-isolated-'));
const base = path.join(__dirname, 'test-deep-models.cjs');
let source = fs.readFileSync(base, 'utf8');
function replaceOnce(oldText, newText) {
  const i = source.indexOf(oldText);
  if (i < 0 || source.indexOf(oldText, i + oldText.length) >= 0) throw Error('脚手架替换点不唯一：' + oldText);
  source = source.slice(0, i) + newText + source.slice(i + oldText.length);
}
async function hdrMain() {
  report.experiment = '隔离的半浮点线性 HDR 合成单元验证';
  report.outputDirectory = output;
  report.notes = ['仅测试合成数学与纹理/FBO 生命周期，不是旅程集成或视觉验收。', '两个人工常量场景用 ShaderMaterial 写入 RGBA16F；混合后使用测试专用 Reinhard 与分段 sRGB，非生产的 ACES、bloom、太阳眩光或宇宙调色。', 'HDR 数值通过额外着色器除以 8 写入 RGBA8 读回，因此容差包含 8 位量化；最终映射同样读回 RGBA8。'];
  await launch();
  const three = fs.readFileSync(path.join(ROOT, 'public/js/three.min.js'), 'utf8');
  await evaluate(three + '\n;true');
  const result = await evaluate(`(${gpuTest.toString()})()`);
  report.gpuTest = result;
  report.tests = result.tests;
}
function gpuTest() {
  const tests = [], metadata = {}, A = [4, 0.5, 2], B = [0.5, 3, 1];
  function check(name, ok, details) { tests.push({name, status: ok ? 'pass' : 'fail', details}); }
  const renderer = new THREE.WebGLRenderer({antialias:false, alpha:false, preserveDrawingBuffer:true});
  renderer.setSize(12, 8, false);
  renderer.toneMapping = THREE.NoToneMapping;
  const gl = renderer.getContext();
  metadata.threeRevision = THREE.REVISION;
  metadata.webgl2 = renderer.capabilities.isWebGL2;
  const debug = gl.getExtension('WEBGL_debug_renderer_info');
  metadata.renderer = gl.getParameter(gl.RENDERER);
  metadata.unmaskedRenderer = debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : null;
  metadata.colorBufferFloat = !!gl.getExtension('EXT_color_buffer_float');
  check('WebGL2 与 EXT_color_buffer_float', metadata.webgl2 && metadata.colorBufferFloat, metadata);
  if (!metadata.webgl2 || !metadata.colorBufferFloat) return {metadata, tests};
  const scene = new THREE.Scene(), camera = new THREE.OrthographicCamera(-1,1,1,-1,0,1);
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2,2)); scene.add(quad);
  const vertexShader = 'varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}';
  const makeMaterial = (fragmentShader, uniforms = {}) => new THREE.ShaderMaterial({vertexShader, fragmentShader, uniforms, toneMapped:false, depthTest:false, depthWrite:false});
  const solid = makeMaterial('uniform vec3 color; void main(){gl_FragColor=vec4(color,1.);}', {color:{value:new THREE.Vector3()}});
  const mixMat = makeMaterial('varying vec2 vUv; uniform sampler2D a; uniform sampler2D b; uniform float t; void main(){gl_FragColor=vec4(mix(texture2D(a,vUv).rgb,texture2D(b,vUv).rgb,t),1.);}', {a:{value:null}, b:{value:null}, t:{value:0}});
  const encode = makeMaterial('varying vec2 vUv; uniform sampler2D src; uniform float mapped; vec3 srgb(vec3 x){return mix(12.92*x,1.055*pow(x,vec3(1.0/2.4))-0.055,step(vec3(0.0031308),x));} void main(){vec3 v=texture2D(src,vUv).rgb; vec3 c=mapped>0.5?srgb(v/(1.0+v)):v/8.0; gl_FragColor=vec4(c,1.);}', {src:{value:null},mapped:{value:0}});
  function target(type) {return new THREE.WebGLRenderTarget(12,8,{type,format:THREE.RGBAFormat,minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter,depthBuffer:false,stencilBuffer:false});}
  const a=target(THREE.HalfFloatType), b=target(THREE.HalfFloatType), mixed=target(THREE.HalfFloatType), out=target(THREE.UnsignedByteType);
  const all=[a,b,mixed,out];
  function framebuffer(rt, label) {
    renderer.setRenderTarget(rt);
    const status=gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    const component=gl.getFramebufferAttachmentParameter(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.FRAMEBUFFER_ATTACHMENT_COMPONENT_TYPE);
    const bits=['RED','GREEN','BLUE','ALPHA'].map(c=>gl.getFramebufferAttachmentParameter(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl['FRAMEBUFFER_ATTACHMENT_'+c+'_SIZE']));
    const expectFloat=rt!==out;
    check(label, status===gl.FRAMEBUFFER_COMPLETE && component===(expectFloat?gl.FLOAT:gl.UNSIGNED_NORMALIZED) && bits.every(v=>v===(expectFloat?16:8)) && rt.texture.type===(expectFloat?THREE.HalfFloatType:THREE.UnsignedByteType), {status,component,bits,textureType:rt.texture.type,width:rt.width,height:rt.height});
  }
  function draw(mat,rt) {quad.material=mat;renderer.setRenderTarget(rt);renderer.render(scene,camera);}
  function read(rt) {const v=new Uint8Array(4);renderer.readRenderTargetPixels(rt,Math.floor(rt.width/2),Math.floor(rt.height/2),1,1,v);return Array.from(v).slice(0,3).map(x=>x/255);}
  const near=(got,want,tol)=>got.every((x,i)=>Math.abs(x-want[i])<=tol);
  const cpuMap=v=>v.map(x=>{x=x/(1+x);return x<=0.0031308?12.92*x:1.055*Math.pow(x,1/2.4)-0.055;});
  function run(label,w,h) {
    all.forEach(rt=>rt.setSize(w,h)); renderer.setSize(w,h,false);
    all.forEach((rt,i)=>framebuffer(rt,label+' FBO '+['A','B','mix','out'][i]));
    solid.uniforms.color.value.set(...A);draw(solid,a);solid.uniforms.color.value.set(...B);draw(solid,b);
    mixMat.uniforms.a.value=a.texture;mixMat.uniforms.b.value=b.texture;
    for(const t of [0,0.25,1]) {
      mixMat.uniforms.t.value=t;draw(mixMat,mixed);
      const expected=A.map((x,i)=>x*(1-t)+B[i]*t);
      encode.uniforms.src.value=mixed.texture;encode.uniforms.mapped.value=0;draw(encode,out);
      const linear=read(out).map(x=>x*8);
      check(label+' 线性 t='+t,near(linear,expected,8/255+0.003),{expected,actual:linear});
      check(label+' HDR 大于 1 t='+t,Math.max(...linear)>1,{actual:linear});
      encode.uniforms.mapped.value=1;draw(encode,out);
      const actual=read(out), mapped=cpuMap(expected);
      check(label+' 单次 Reinhard + sRGB t='+t,near(actual,mapped,2/255),{expected:mapped,actual});
    }
    const errors=[];for(let i=0;i<16;i++){const e=gl.getError();if(e===gl.NO_ERROR)break;errors.push(e);}
    check(label+' GL 无错误且上下文有效',!errors.length&&!gl.isContextLost(),{errors,lost:gl.isContextLost()});
  }
  try {run('初始 12x8',12,8);run('变更 19x11',19,11);run('恢复 12x8',12,8);}
  finally {all.forEach(rt=>rt.dispose());solid.dispose();mixMat.dispose();encode.dispose();quad.geometry.dispose();renderer.dispose();}
  return {metadata, tests, input:{A,B}, method:'RGBA16F 混合，RGBA8 量化读回'};
}
const start = source.indexOf('async function main() {'), end = source.indexOf('\nfunction cleanup()', start);
if (start < 0 || end < 0) throw Error('脚手架 main 不存在');
source = source.slice(0,start) + `async function main(){return (${hdrMain.toString()})();}` + source.slice(end);
replaceOnce("const REPORT_FILE = path.join(ROOT, `deep-models-test-184-${RUN_ID}.json`);", "const REPORT_FILE = path.join(output, 'report.json');");
replaceOnce("const profile = fs.mkdtempSync(path.join(parent, 'probe-deep-models-'));", "const profile = fs.mkdtempSync(path.join(output, 'chrome-profile-'));");
replaceOnce('report.complete = report.ok && !FAST;', 'report.complete = false;');
vm.runInThisContext(`(function(require,__dirname,__filename,output,gpuTest){${source}\n})`, {filename:base})(require,__dirname,base,output,gpuTest);
