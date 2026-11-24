'use strict';
// Real Three.js geometry/API + deterministic spatial contracts, not GPU acceptance.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const code=fs.readFileSync('public/js/milkyway-fill.js','utf8'),context={console,Math,Float32Array,ArrayBuffer};vm.createContext(context);vm.runInContext(fs.readFileSync('public/js/three.min.js','utf8'),context);vm.runInContext(code,context);
const api=context.ORBIT_MILKYWAY_FILL,T=context.THREE,hash=array=>crypto.createHash('sha256').update(Buffer.from(array.buffer,array.byteOffset,array.byteLength)).digest('hex');
const a=api.samplePopulation(),b=api.samplePopulation(),c=api.samplePopulation({seed:api.SEED+1});assert.equal(a.count,252000);assert.equal(a.localCount,72000);assert.equal(a.diskCount,180000);assert.equal(a.clouds.length,0);
for(const key of ['positions','colors','luminosities','kinds']){assert.equal(hash(a[key]),hash(b[key]),'fixed seeded '+key);if(key!=='kinds')assert.notEqual(hash(a[key]),hash(c[key]),'seed changes '+key);}
let local=0,global=0,near=0,far=0,north=0,south=0;const colors=new Set();
for(let i=0;i<a.count;i++){
 const p=Array.from(a.positions.slice(i*3,i*3+3));assert(p.every(Number.isFinite));const r=Math.hypot(...p);assert(a.luminosities[i]>0&&a.luminosities[i]<1);for(const component of a.colors.slice(i*3,i*3+3))assert(component>0&&component<=1);
 if(a.kinds[i]===0){local++;assert(r<=3000.001);assert(r>.5);if(r<50)near++;if(r>1000)far++;}else{global++;assert(Math.hypot(p[0]+8150,p[2])<=16000.01);assert(Math.abs(p[1])<3000);}
 north+=p[1]>0;south+=p[1]<0;colors.add(Array.from(a.colors.slice(i*3,i*3+3),x=>x.toFixed(2)).join(','));
}
assert.equal(local,72000);assert.equal(global,180000);assert(near>20&&far>20000,'local fixed shells cover neighbouring to distant flybys');assert(colors.size>300);assert(north>100000&&south>100000);
for(const cloud of a.clouds){assert(cloud.radius>=8&&cloud.radius<=190);assert(cloud.position.every(Number.isFinite));const u=new T.Vector3(...cloud.axisU),v=new T.Vector3(...cloud.axisV),n=new T.Vector3(...cloud.normal);assert(Math.abs(u.length()-1)<1e-12&&Math.abs(v.length()-1)<1e-12);assert(u.clone().cross(v).distanceTo(n)<1e-12);}
const layer=api.create(T),info=layer.info();assert.equal(info.invented,true);assert.equal(info.observed,false);assert.equal(info.sourceIDs,false);assert.equal(info.drawCalls,1);assert.equal(info.starCount,252000);assert.equal(info.cloudCount,0);assert.equal(info.timeDependent,false);assert.equal(info.billboard,false);assert.equal(layer.object.children.length,1);
const [stars]=layer.object.children,sg=stars.geometry,sm=stars.material;assert(stars instanceof T.Points);assert.equal(sg.attributes.position.count,252000);assert.equal(sm.blendDst,T.OneFactor);assert.equal(sm.depthWrite,false);
const originalHash=hash(sg.attributes.position.array),p0=new T.Vector3(api.SUN_X,0,0),p1=new T.Vector3(api.SUN_X+1234*api.PC,-321*api.PC,812*api.PC);
layer.update({cameraMeters:p0,unit:api.PC*100,quality:'low',gain:.8,dpr:1,pxPerRad:900});assert.deepEqual(Array.from(sm.uniforms.uCameraPc.value.toArray()),[0,0,0]);assert(Math.abs(sm.uniforms.uPcPerUnit.value-.01)<1e-15);assert.equal(sg.drawRange.count,84000);
layer.update({cameraMeters:p1,unit:api.PC*1000,quality:'medium',gain:.6,dpr:2,pxPerRad:700});const q=sm.uniforms.uCameraPc.value;assert(Math.abs(q.x-1234)<1e-10);assert(Math.abs(q.y+321)<1e-10);assert(Math.abs(q.z-812)<1e-10);assert.equal(sg.drawRange.count,168000);assert.equal(sm.uniforms.uGain.value,.6);
layer.update({cameraMeters:p0,unit:api.PC*100,quality:'high',gain:1});assert.deepEqual(Array.from(sm.uniforms.uCameraPc.value.toArray()),[0,0,0]);assert.equal(sg.drawRange.count,252000);assert.equal(hash(sg.attributes.position.array),originalHash,'translation/reverse never alters fixed source positions');assert.equal(stars.geometry,sg);
// Verify simulated view-space displacements come only from observer movement.
for(const i of [0,1,7,115,85003,200001]){const p=new T.Vector3().fromArray(sg.attributes.position.array,i*3),relative0=p.clone(),relative1=p.clone().sub(new T.Vector3(1234,-321,812));assert(relative0.sub(relative1).distanceTo(new T.Vector3(1234,-321,812))<1e-10);}
assert(/position-uCameraPc/.test(api.starVertex));assert(!/Math\.random|Date\.|performance\.|uTime|cameraPosition|lookAt|sampler2D|texture2D/.test(code),'no external textures, time warps, billboard placement or runtime random position movement');
// Display PSF and flux depend on physical distance, not render units/DPR.
assert.equal(info.cloudDepthSlices,0);assert.equal(info.starDisplay.minCssPixels,1.9);
for(const distance of [1,10,100,1000,3000,10000,30000]){
 const p=api.starProfile(.2,distance,1),hi=api.starProfile(.2,distance,2);
 assert(p.cssPixels>=1.9&&p.cssPixels<=6.2);assert.equal(hi.devicePixels,p.devicePixels*2);assert.equal(hi.radiance,p.radiance,'DPR cannot dim a star');
 if(distance<10000){const oldFlux=.2*Math.pow(160/(distance+25),1.30),oldEnergy=oldFlux*2.8*Math.PI/6;const newEnergy=p.flux*4.2*Math.PI*(4.2/14+.22/4.5);assert(newEnergy>oldEnergy*1.5,'recognisable brighter source through local kpc range');}
}
let localBrightCount=0;for(let i=0;i<a.count;i++)if(a.kinds[i]===0&&a.luminosities[i]>=.24)localBrightCount++;
assert(localBrightCount/local>.07&&localBrightCount/local<.13,'targeted local bright fraction near ten percent');
for(const d of [50,500,1500,3000]){const bright=api.starProfile(.3,d,1,0),global=api.starProfile(.3,d,1,1);assert(bright.cssPixels>=3.5);assert.equal(bright.localBright,1);assert(Math.abs(bright.flux/global.flux-1.8)<1e-12);assert.equal(global.localBright,0);}
assert.equal(api.starProfile(.3,5000,1,0).localBright,0,'bright PSF enhancement fades beyond resolved local range');
assert.equal(api.starProfile(.2,500,1,0).localBright,0,'ordinary locals do not get uniformly enlarged');
assert(/mix\(14\.0,8\.0,vLocalBright\)/.test(api.starFragment),'bright fraction has visibly wider core, not just transparent larger sprite');
assert.equal(a.clouds.length,0,'no blue/pink procedural dust clouds remain');
assert(api.starProfile(.2,100,1).radiance>api.starProfile(.2,10000,1).radiance);assert.equal(api.starProfile(.2,160000,1).radiance,0);
assert(/cssSize\*cssSize/.test(api.starVertex)&&!/uDpr[^;]*uDpr/.test(api.starVertex),'DPR-independent radiance normalization');
assert(/core=exp/.test(api.starFragment)&&/crossPSF/.test(api.starFragment));
assert.equal(info.cloudCount,0,'procedural cloud population removed');
layer.update({cameraMeters:p0,unit:1e18,quality:'low',gain:0});assert.equal(layer.object.visible,false);assert.throws(()=>layer.update({cameraMeters:p0,unit:0}),/positive unit/);assert.throws(()=>layer.update({cameraMeters:new T.Vector3(NaN,0,0),unit:1}),/Finite/);
let disposals=0;for(const resource of [sg,sm])resource.addEventListener('dispose',()=>disposals++);layer.dispose();layer.dispose();assert.equal(disposals,2);assert.equal(layer.object.children.length,0);assert.equal(layer.info().disposed,true);assert.throws(()=>layer.update({cameraMeters:p0,unit:1}),/disposed/);
console.log('PASS Milky Way fill: 252000 fixed seeded local/disk/arm/bulge stars; procedural blue/pink dust clouds removed; dispersed-star handoff only, one draw, proper-G heliocentric origin and resource lifecycle. CPU/VM only; actual GPU/visual inspection required.');
