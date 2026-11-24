'use strict';
// Runtime material bindings and deterministic numerical refinement; not GPU/image acceptance.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const context={console};context.window=context;vm.runInNewContext(fs.readFileSync('public/js/three.min.js','utf8'),context);vm.runInNewContext(fs.readFileSync('public/js/main-volumes.js','utf8'),context);
const T=context.THREE,pool=context.createMainVolumes(T),mesh=pool.create(9,23,[1,1,1]),U=mesh.material.uniforms,shader=mesh.material.fragmentShader;
let passed=0;function test(name,fn){fn();console.log('PASS '+(++passed)+' '+name);}
const tex=()=>new T.Data3DTexture(new Uint8Array(4),1,1,1);let asset={density:tex(),light:tex(),shading:tex(),size:256,emissionScale:16,lightScale:8,sigmaMax:12};context.ORBIT_CINEMATIC_ASSETS={get:()=>asset};
test('optional local oct shading borrowed with heterogeneous resolution and legacy fallback',()=>{
 mesh.onBeforeRender();assert.equal(U.uCineShading.value,asset.shading);assert.equal(U.uCineHasShading.value,1);assert.equal(U.uCineSize.value,256);assert.equal(U.uCineEmissionScale.value,16);assert.equal(U.uCineLightScale.value,8);
 delete asset.shading;mesh.onBeforeRender();assert.equal(U.uCineHasShading.value,0);assert.ok(U.uCineShading.value.isData3DTexture);assert(shader.includes('decodeOct(encoded.rg)'));assert(shader.includes('decodeOct(encoded.ba)'));
});
function normalized(v){const l=Math.hypot(...v);return v.map(x=>x/l);}function sign(x){return x<0?-1:1;}
function encode(v){let n=normalized(v),s=n.reduce((a,b)=>a+Math.abs(b),0);n=n.map(x=>x/s);let f=n.slice(0,2);if(n[2]<0)f=[(1-Math.abs(n[1]))*sign(n[0]),(1-Math.abs(n[0]))*sign(n[1])];return f.map(x=>Math.round((x*.5+.5)*255)/255);}
function decode(e){const f=e.map(x=>x*2-1);let n=[...f,1-Math.abs(f[0])-Math.abs(f[1])];if(n[2]<0)n=[(1-Math.abs(n[1]))*sign(n[0]),(1-Math.abs(n[0]))*sign(n[1]),n[2]];return normalized(n);}
test('UNORM8 octahedral directions cover negative Z, zero components and all octants',()=>{
 const vectors=[[0,0,-1],[0,0,1],[1,0,0],[0,-1,0],[-.001,.001,-1],[1,-1,-1],[-1,-1,-1]];let seed=73;for(let i=0;i<10000;i++){const a=[];for(let j=0;j<3;j++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;a.push(seed/4294967296*2-1);}vectors.push(a);}
 let minimum=1;for(const v of vectors){const n=normalized(v),r=decode(encode(v)),dot=n.reduce((s,x,i)=>s+x*r[i],0);assert.ok(r.every(Number.isFinite));minimum=Math.min(minimum,dot);}assert(minimum>.9998,'oct max angle below1.15deg');
});
test('directional response bounded, gas and vacuum emission never acquire a Lambert dark side',()=>{
 assert(shader.includes('surfaceResponse=.65+.70*max(0.0,dot(normal,-incoming))'));assert(shader.includes('sigma*uCineAlbedo*incident*phase*surfaceResponse'));
 const emission=shader.match(/vec3 emission=([^;]+);/)[1];assert(!/surfaceResponse|normal|rd|incoming/.test(emission));for(let d=-1;d<=1;d+=.01){const response=.65+.70*Math.max(0,d);assert(response>=.65&&response<=1.35);}assert(shader.includes('clamp(dot(incoming,-rd),-1.0,1.0)'));
});
test('explicit spectral dust albedo is finite, bounded and defaults to legacy neutral',()=>{
 delete asset.scatteringAlbedo;mesh.onBeforeRender();assert.deepEqual(Array.from(U.uCineAlbedo.value.toArray()),[.55,.55,.55]);
 asset.scatteringAlbedo=[.56,.40,.25];mesh.onBeforeRender();assert.deepEqual(Array.from(U.uCineAlbedo.value.toArray()),[.56,.40,.25]);
 asset.scatteringAlbedo=[-1,Infinity,4];mesh.onBeforeRender();assert.deepEqual(Array.from(U.uCineAlbedo.value.toArray()),[0,.55,.95]);
 const emission=shader.match(/vec3 emission=([^;]+);/)[1];assert(!emission.includes('uCineAlbedo'));delete asset.scatteringAlbedo;
});
test('explicit sqrt UNORM emission preserves weak gas precision while linear legacy and sigma stay unchanged',()=>{
 delete asset.emissionEncoding;mesh.onBeforeRender();assert.equal(U.uCineEmissionSqrt.value,0);
 asset.emissionEncoding='sqrt-unorm8';mesh.onBeforeRender();assert.equal(U.uCineEmissionSqrt.value,1);
 asset.emissionEncoding='unrecognized';mesh.onBeforeRender();assert.equal(U.uCineEmissionSqrt.value,0);delete asset.emissionEncoding;
 const scale=32,decode=j=>(Math.round(Math.sqrt(j/scale)*255)/255)**2*scale;
 for(const j of [.001,.004,.01,.03,.06,.125]){const q=decode(j),root=Math.sqrt(j/scale),bound=scale*(root/255+1/(4*255*255));assert(Math.abs(q-j)<=bound+1e-12);assert(q>0);}
 assert.equal(Math.round(.03/scale*255)/255*scale,0,'legacy linear quantization erases this weak gas');assert(decode(.03)>.025);
 assert(shader.includes('uCineEmissionSqrt>.5?encodedEmission*encodedEmission:encodedEmission'));assert(shader.includes('float sigma=field.a*uCineSigmaMax*detail;'));
});
// This mirrors the actual shader's occupied-cell allocation arithmetic, including rounding/reservation.
function schedule(cells,budget,voxel,factor){let length=cells.reduce((s,x)=>s+x,0),count=cells.length,samples=0;const result=[];for(const cell of cells){const available=Math.max(1,budget-samples),proportional=available*cell/Math.max(length,1e-6),minimum=Math.ceil(cell/(voxel*factor));const allocation=Math.min(minimum,Math.max(1,Math.floor(proportional+.5)));const n=Math.min(allocation,Math.max(1,available-Math.max(0,count-1)));assert(Number.isInteger(n)&&n>=1);result.push({n,ds:cell/n});samples+=n;length-=cell;count--;}return {samples,result};}
test('occupied support budgets do not include empty gaps or starve far thin sheets',()=>{
 const cell=2.6/32;for(const budget of [128,320,448])for(const total of [1,2,24,64,96]){
  const cells=Array.from({length:total},(_,i)=>cell*(.05+((i*37)%17)/17));const s=schedule(cells,budget,2.6/256,budget===128?1.25:budget===320?.65:.45);assert(s.samples<=budget);assert(s.result.every(x=>x.n>=1));const coverage=s.result.reduce((a,x)=>a+x.n*x.ds,0);assert(Math.abs(coverage-cells.reduce((a,b)=>a+b,0))<1e-10);
 }
 const sparse=schedule([cell,cell],320,2.6/256,.65);assert(sparse.result.every(x=>x.ds<=2.6/256*.65));const oldDs=2.6/320;assert(oldDs>sparse.result[0].ds);assert(shader.includes('occupiedLength(ro,rd,a,b,occupiedCells)'));assert(!shader.includes('(b-t)/remaining'));assert(shader.includes('available-max(0.0,occupiedCells-1.0)'));
});
test('thin Gaussian filament quadrature benefits from occupied-support spacing at equal budget',()=>{
 const voxel=2.6/256,cell=2.6/32,budget=320,planned=schedule([cell],budget,voxel,.65).result[0];
 const oldDs=2.6/budget,center=.040625,width=voxel*.45;let oldError=0,newError=0;
 const gaussian=t=>Math.exp(-.5*((t-center)/width)**2);const truth=width*Math.sqrt(2*Math.PI);
 for(let k=0;k<100;k++){const jitter=(k+.5)/100;let old=0,fresh=0;
  for(let t=0;t<cell;t+=oldDs){const ds=Math.min(oldDs,cell-t);old+=gaussian(t+(.20+.60*jitter)*ds)*ds;}
  for(let i=0;i<planned.n;i++){const offset=i%2?1-jitter:jitter;fresh+=gaussian((i+.35+.30*offset)*planned.ds)*planned.ds;}
  oldError+=(old-truth)**2;newError+=(fresh-truth)**2;
 }
 assert(newError<oldError*.55,'phase-averaged thin-feature integration error decreases at identical step budget');
});
test('unresolved residual detail fades to mean without divergent derivatives or temporal flicker',()=>{
 const main=shader.indexOf('void main()'),derivative=shader.indexOf('float rayCone='),march=shader.indexOf('for(int ci=');assert(derivative>main&&derivative<march);assert(!/dFdx|dFdy/.test(shader.slice(march)));assert(shader.includes('footprint*67.2'));assert(shader.includes('detail=1.0+(fine-.5)*.40*resolved'));assert(!shader.includes('uFrame'));assert(!shader.includes('uTime'));
 for(let j=0;j<=1;j+=.01){const first=.35+.30*j,second=.35+.30*(1-j);assert(Math.abs((first+second)/2-.5)<1e-12);}
});
test('oversized occupancy falls back to full ray support rather than exceeding low budget',()=>{
 asset.occupancy=tex();asset.occupancyGrid=64;mesh.onBeforeRender();assert.equal(U.uCineHasOccupancy.value,0);asset.occupancyGrid=32;mesh.onBeforeRender();assert.equal(U.uCineHasOccupancy.value,1);
});
pool.dispose();console.log('PASS '+passed+' refinement contracts; native GPU compilation, perceptual filament resolution and frame time remain parent integration checks.');
