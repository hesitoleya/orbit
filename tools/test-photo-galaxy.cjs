'use strict';
// Execute module API and compare the real prior to the normalization generator.
// CPU/VM contracts only, not a substitute for a GPU external/inside image test.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('public/js/photo-galaxy.js','utf8'),ctx={};vm.createContext(ctx);vm.runInContext(source,ctx);
const api=ctx.ORBIT_PHOTO_GALAXY,P=api.parameters;
const close=(a,b,eps=1e-10)=>assert(Math.abs(a-b)<=eps,`${a} != ${b}`);
close(P.sunX,8.15*3.0856775814913673e19/5e20);
function reference(p){const [x,y,z]=p,r=Math.hypot(x,z),s=x=>{x=Math.min(1,Math.max(0,x));return x*x*(3-2*x);};return (Math.exp(-r*3.2)*Math.exp(-Math.abs(y)/(.018+.035*r))+1.4*Math.exp(-Math.hypot(x/.22,y/.12,z/.22)*4))*s((1.15-r)/.15)*s((.5-Math.abs(y))/.15);}
for(const x of [-1.2,-1.1,-.5,0,.50296544578,1,1.15])for(const y of [-.6,-.45,-.02,0,.1,.45,.6])for(const z of [-.7,0,.9])close(api.prior([x,y,z]),reference([x,y,z]));
assert(api.prior([0,0,0])>api.prior([.6,0,0]));assert(api.prior([0,0,0])>api.prior([0,.2,0]));
assert.equal(api.prior([1.15,0,0]),0);assert.equal(api.prior([0,.5,0]),0);
close(api.prior([1.149999,0,0]),0,1e-10);close(api.prior([0,.499999,0]),0,1e-10);
const sun=[P.sunX,0,0];
function dir(l,b){return [-Math.cos(b)*Math.cos(l),Math.sin(b),-Math.cos(b)*Math.sin(l)];}
function at(d,t){return d.map((v,i)=>sun[i]+v*t);}
for(const [l,b] of [[0,0],[.8,.25],[-2,-.45],[Math.PI-1e-7,0],[-Math.PI+1e-7,0]]){
 const uv=api.panoramaUV(at(dir(l,b),.7));close(uv[0],.5-l/(2*Math.PI));close(uv[1],.5+b/Math.PI);
 const farther=api.panoramaUV(at(dir(l,b),1.2));close(uv[0],farther[0]);close(uv[1],farther[1]);
}
close(api.panoramaUV([P.sunX,1,0])[1],1);close(api.panoramaUV([P.sunX,-1,0])[1],0);
for(const p of [[0,0,0],[.2,.1,.3],[-.4,-.02,-.5]])assert(api.panoramaUV(p).every(Number.isFinite));
function integrate(d,steps){let sum=0;for(let i=0;i<steps;i++)sum+=api.prior(at(d,(i+.5)*2.6/steps))*2.6/steps;return sum;}
let worst=0;
for(const l of [-2.8,-1.5,-.4,0,.9,2.5])for(const b of [-1.4,-.8,-.15,0,.08,.5,1.4]){
 const d=dir(l,b),normalization=integrate(d,512),encoded=Math.round(Math.max(0,Math.min(1,(Math.log2(Math.max(normalization,2**-12))+12)/16))*255)/255;
 const decoded=api.normDecode(encoded);assert(decoded>0);
 const relative=Math.abs(integrate(d,128)/decoded-1);worst=Math.max(worst,relative);assert(relative<.09,`Sun recovery discrepancy ${relative} at l${l},b${b}`);
}
class V3{constructor(x=0,y=0,z=0){this.set(x,y,z);}set(x,y,z){Object.assign(this,{x,y,z});return this;}copy(v){return this.set(v.x,v.y,v.z);}applyMatrix4(m){this.x-=m.origin[0];this.y-=m.origin[1];this.z-=m.origin[2];return this;}}
class M4{copy(m){this.origin=m.origin;return this;}invert(){return this;}}
class Material{constructor(o){Object.assign(this,o);this.userData={};}dispose(){this.disposed=true;}}
class Geometry{constructor(...size){this.size=size;}dispose(){this.disposed=true;}}
class Mesh{constructor(g,m){this.geometry=g;this.material=m;this.userData={};this.matrixWorld={origin:[.1,.2,.3]};}}
const T={Vector3:V3,Matrix4:M4,ShaderMaterial:Material,BoxGeometry:Geometry,Mesh,GLSL3:'GLSL3',BackSide:'BackSide',CustomBlending:'CustomBlending',AddEquation:'AddEquation',OneFactor:1,ZeroFactor:0};
const color={},normalization={},mesh=ctx.createPhotoGalaxy(T,{color,normalization}),u=mesh.material.uniforms;
assert.deepEqual(mesh.geometry.size,[2.3,1,2.3]);assert.equal(mesh.material.side,T.BackSide);assert.equal(mesh.material.depthWrite,false);assert.equal(mesh.material.toneMapped,false);assert.equal(mesh.material.blendSrc,1);assert.equal(mesh.material.blendDst,1);assert.equal(u.uReady.value,1);
close(u.uSun.value.x,P.sunX);assert.equal(u.uConstraint.value,color);assert.equal(u.uNormalization.value,normalization);
mesh.onBeforeRender(null,null,{getWorldPosition(v){return v.set(1,2,3);}});close(u.uObserver.value.x,.9);close(u.uObserver.value.y,1.8);close(u.uObserver.value.z,2.7);
mesh.userData.update({observer:[.5,0,0],autoObserver:false,steps:128,gain:.7,opacity:.4});mesh.onBeforeRender(null,null,{getWorldPosition(){throw Error('manual observer must not sample camera');}});close(u.uObserver.value.x,.5);close(u.uGain.value,.7);close(u.uOpacity.value,.4);assert.equal(u.uSteps.value,128);
mesh.userData.update({steps:1000,opacity:2,gain:-1});assert.equal(u.uSteps.value,192);assert.equal(u.uOpacity.value,1);assert.equal(u.uGain.value,0);assert.throws(()=>mesh.userData.update({gain:NaN}),/finite/);
mesh.userData.update({ready:false});assert.equal(u.uReady.value,0);mesh.userData.update({ready:true});assert.equal(u.uReady.value,1);mesh.userData.update({color:null});assert.equal(u.uReady.value,0);mesh.userData.update({color});assert.equal(u.uReady.value,1);
const missing=ctx.createPhotoGalaxy(T,{});assert.equal(missing.material.uniforms.uReady.value,0);
assert.match(mesh.material.fragmentShader,/vec3 p=ro\+rd/);assert.match(mesh.material.fragmentShader,/vec2 uv=photoUV\(p\)/);assert.doesNotMatch(mesh.material.fragmentShader,/photoUV\(rd\)/);assert.match(mesh.material.fragmentShader,/photoPrior\(p\)/);assert.match(mesh.material.fragmentShader,/density\/max\(integral/);assert.match(mesh.material.fragmentShader,/textureLod\(uConstraint/);assert.match(mesh.material.fragmentShader,/photoGalaxyColor=vec4\(radiance\*uGain\*uOpacity,0\.0\)/);
assert.doesNotMatch(mesh.material.fragmentShader,/hash\(|noise\(|sin\(.*p\./,'no synthetic arm noise');
mesh.userData.dispose();mesh.userData.dispose();assert(mesh.geometry.disposed&&mesh.material.disposed);assert.throws(()=>mesh.userData.update({}),/disposed/);assert(!color.disposed&&!normalization.disposed,'borrowed textures not owned');
const generator=fs.readFileSync('tools/build-photo-galaxy.py','utf8');assert.match(generator,/\(1\.15-r\)\/\.15/);assert.match(generator,/\(\.5-np\.abs\(y\)\)\/\.15/);assert.match(generator,/N=512/);assert.match(generator,/\(i\+\.5\)\*2\.6\/N/);
console.log(`PASS photo-constrained 3D galaxy: exact generator prior, Sun recovery max ${(worst*100).toFixed(2)}%, object-position UV, finite support, factory lifecycle, inverse observer, manual override, borrowed textures, no synthetic shells/noise. CPU/VM only; GPU evidence required separately.`);
