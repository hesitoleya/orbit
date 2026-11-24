'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const app=fs.readFileSync('public/js/app.js','utf8');
const start=app.indexOf('function bhResize() {'),end=app.indexOf('\nfunction bhFrame(',start);
assert(start>0&&end>start);
function boot({extension=true,complete=true,forced=false,throws=false}={}){
  const allocations=[],restored={name:'original'},bindings=[];
  let target=restored;
  class RT{constructor(w,h,options){this.width=w;this.height=h;this.options=options;this.disposed=0;allocations.push(this);}dispose(){this.disposed++;}}
  const gl={FRAMEBUFFER:1,FRAMEBUFFER_COMPLETE:2,checkFramebufferStatus(){if(throws)throw Error('not renderable');return complete?2:3;}};
  const BH={scale:.75,bloomK:.95};
  const renderer={domElement:{width:1280,height:800},capabilities:{isWebGL2:true},extensions:{has:()=>extension},getContext:()=>gl,getRenderTarget:()=>target,setRenderTarget(t){target=t;bindings.push(t);}};
  const ctx={BH,renderer,params:new URLSearchParams(forced?'bhHDR=0':''),THREE:{WebGLRenderTarget:RT,LinearFilter:1,HalfFloatType:1016,UnsignedByteType:1009}};
  vm.runInNewContext(app.slice(start,end)+'\nthis.resize=bhResize;',ctx);
  return {ctx,BH,allocations,bindings,restored,target:()=>target};
}
for(const settings of [{},{extension:false},{complete:false},{forced:true},{throws:true}]){
  const t=boot(settings),hdr=!Object.keys(settings).length;t.ctx.resize();
  assert.equal(t.BH.hdr,hdr);
  assert.equal(t.BH.rt.options.type,hdr?1016:1009);
  assert.equal(!!t.BH.b1a,hdr);
  assert.strictEqual(t.target(),t.restored,'restore pre-existing target after probe');
  assert.equal(t.BH.rt.width,960);assert.equal(t.BH.rt.height,600);
  const old=t.BH.rt,count=t.allocations.length;t.ctx.resize();assert.equal(t.allocations.length,count,'same size reuses RT');
  t.ctx.renderer.domElement.width=1600;t.ctx.resize();assert.equal(old.disposed,1,'resize disposes base');
  assert.equal(t.BH.rt.width,1200);
  for(const rt of t.allocations)if(rt!==t.BH.rt&&rt!==t.BH.b1a&&rt!==t.BH.b1b&&rt!==t.BH.b2a&&rt!==t.BH.b2b)assert.equal(rt.disposed,1,'old/intermediate RT disposed once');
}
assert(app.includes('const doBloom = BH.hdr && BH.bloomK > 0.001;'));
assert(app.includes('cu.uBloomK.value = doBloom ? BH.bloomK : 0;'),'disabled bloom cannot reuse base as bloom');
console.log('PASS actual bhResize: HDR supported, missing extension, incomplete FBO, forced LDR, throwing driver; target restoration, resize/reuse/disposal and no-bloom composition contracts. VM, not real unsupported-device test.');
