'use strict';
// Actual module/material bindings + homogeneous radiative-transfer mathematics.
// NO browser/GPU or visual quality acceptance.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),ctx={console};ctx.window=ctx;
vm.runInNewContext(fs.readFileSync(path.join(root,'public/js/three.min.js'),'utf8'),ctx);
const source=fs.readFileSync(path.join(root,'public/js/main-volumes.js'),'utf8');vm.runInNewContext(source,ctx);
const T=ctx.THREE,pool=ctx.createMainVolumes(T),mesh=pool.create(11,19,[1,.5,.2]),mat=mesh.material,shader=mat.fragmentShader;
let count=0;function test(name,fn){fn();console.log('PASS '+(++count)+' '+name);}
test('real RGBA8 3D texture slots, explicit linear HDR premultiplied blending',()=>{
 for(const key of ['uCineDensity','uCineLight','uCineDetail','uCineOccupancy','uCineShading'])assert(mat.uniforms[key].value.isData3DTexture,key);
 assert.equal(mat.blending,T.CustomBlending);assert.equal(mat.blendSrc,T.OneFactor);assert.equal(mat.blendDst,T.OneMinusSrcAlphaFactor);assert.equal(mat.toneMapped,true);
 assert(shader.includes('gl_FragColor=vec4(radiance,alpha)'));assert(!shader.includes('radiance/max(alpha'));assert(!shader.includes('length(radiance)*.35'));
 assert(shader.includes('#include <tonemapping_fragment>'));assert(shader.includes('#include <colorspace_fragment>'));
});
test('async cinematic binding is borrowed, null-safe and returns to analytic fallback',()=>{
 mesh.onBeforeRender();assert.equal(mat.uniforms.uCineEnabled.value,0);
 const density=new T.Data3DTexture(new Uint8Array(4),1,1,1),light=density.clone(),detail=density.clone(),occupancy=density.clone();
 ctx.ORBIT_CINEMATIC_ASSETS={get(type){assert.equal(type,11);return {density,light,detail,occupancy,size:160,sigmaMax:12,lightScale:4,emissionScale:4,occupancyGrid:32,lightPosition:[.1,.2,.3]};}};
 mesh.onBeforeRender();assert.equal(mat.uniforms.uCineEnabled.value,1);assert.equal(mat.uniforms.uCineDensity.value,density);assert.equal(mat.uniforms.uCineSize.value,160);assert.equal(mat.uniforms.uCineHasOccupancy.value,1);assert.equal(mat.uniforms.uCineHasDetail.value,1);assert.equal(mat.uniforms.uCineLightPos.value.x,.1);
 ctx.ORBIT_CINEMATIC_ASSETS.get=()=>({density,light,shading:density,shadingEncoding:'incoming-cartesian-response-unorm8'});mesh.onBeforeRender();assert.equal(mat.uniforms.uCineFilteredShading.value,1);
 ctx.ORBIT_CINEMATIC_ASSETS.get=()=>({density,light,shading:density});mesh.onBeforeRender();assert.equal(mat.uniforms.uCineFilteredShading.value,0);
 ctx.ORBIT_CINEMATIC_ASSETS.get=()=>null;mesh.onBeforeRender();assert.equal(mat.uniforms.uCineEnabled.value,0);assert.notEqual(mat.uniforms.uCineDensity.value,density);
 let released=0;density.addEventListener('dispose',()=>released++);mesh.material.dispose();assert.equal(released,0,'pool must not dispose shared asset');
});
test('quality budgets are bounded and runtime updates do not recreate materials',()=>{
 for(const [quality,steps] of [['low',128],['high',320],['ultra',448]]){pool.configureCinematic({quality});mesh.onBeforeRender();assert.equal(mat.uniforms.uCineSteps.value,steps);}
 assert.throws(()=>pool.configureCinematic({quality:'cinema-never-bounded'}),/must be low, high or ultra/);
 assert(shader.includes('for(int ci=0;ci<768;ci++)'));assert(shader.includes('float remaining=max(1.0,cellSamples)'));assert(shader.includes('samples+=1.0'));
});
function integrate(j,sigma,length,steps){let L=0,T=1,ds=length/steps;for(let i=0;i<steps;i++){const tr=Math.exp(-sigma*ds),segment=sigma>1e-5?(1-tr)/sigma:ds;L+=T*j*segment;T*=tr;}return {L,T};}
test('Beer-Lambert source integration is step invariant and supports pure emission',()=>{
 for(const sigma of [0,.1,1,12])for(const steps of [1,32,96,128,320]){const r=integrate(2,sigma,1.8,steps),truth=sigma?2*(1-Math.exp(-sigma*1.8))/sigma:3.6;assert(Math.abs(r.L-truth)<1e-10);assert(Math.abs(r.T-Math.exp(-sigma*1.8))<1e-12);}
 const vacuum=integrate(2,0,1,32),background=.7;assert.equal(vacuum.T,1);assert(Math.abs(vacuum.L+vacuum.T*background-2.7)<1e-12);
 assert(shader.includes('(1.0-tr)/m.a:ds'));assert(shader.includes('float alpha=clamp(1.0-trans,0.0,1.0)'));
});
test('cached single scattering, HG phase, static jitter, conservative empty skipping',()=>{
 assert(shader.includes('sigma*uCineAlbedo*incident*phase'));assert(shader.includes('float g=.28'));assert(shader.includes('textureLod(uCineOccupancy,uv,0.0).r<.001'));assert(shader.includes('exitMacro(p,rd)'));assert(!shader.includes('uFrame'));assert(!shader.includes('uTime'));assert(shader.includes('textureLod(uCineDensity,uv,0.0)'));assert(shader.includes('textureLod(uCineDetail,p*2.1+.5,0.0)'));
 // HG normalization midpoint quadrature over solid angle, independent radiance scaling.
 const g=.28,n=10000;let sum=0;for(let i=0;i<n;i++){const mu=-1+(i+.5)*2/n;sum+=(1-g*g)/(4*Math.PI*(1+g*g-2*g*mu)**1.5)*4*Math.PI/n;}assert(Math.abs(sum-1)<1e-7);
});
test('analytic fallback depth and fixed local morphology remain present',()=>{
 assert(shader.includes('for(int i=0;i<96;i++)'));assert(shader.includes('b=min(b,dot(localHit-ro,rd))'));assert(shader.includes('if(uDepthEnabled<0.5)discard'));assert(shader.includes('nebulaProfile(p,n)'));assert.equal(mat.depthTest,false);assert.equal(mat.depthWrite,false);
});
pool.dispose();console.log('PASS '+count+' cinematic texture/transport contracts; GPU compilation, assets, render budget, composition and visual quality must be integration tested.');
