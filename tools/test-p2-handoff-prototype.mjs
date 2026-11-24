import assert from 'node:assert/strict';
import * as THREE from '../public/js/three.module.min.js';
import fs from 'node:fs';
import vm from 'node:vm';
import {mapDirection,candidateFrame,reflectedProjection,computeHandoff} from './p2-handoff-prototype.mjs';
assert.throws(()=>mapDirection(new THREE.Vector3()),/invalid direction/);
assert.throws(()=>mapDirection(new THREE.Vector3(NaN,0,0)),/invalid direction/);
assert.throws(()=>candidateFrame(new THREE.Vector3(1,0,0),new THREE.Vector3(2,0,0)),/parallel/);
assert.throws(()=>mapDirection(new THREE.Vector3(1e200,0,0)),/invalid direction/);
assert.throws(()=>mapDirection(new THREE.Vector3(1e-200,0,0)),/invalid direction/);
assert.throws(()=>candidateFrame(new THREE.Vector3(1,0,0),new THREE.Vector3(1e100,1e-1,0)),/parallel/);
const src=fs.readFileSync(new URL('../public/js/app.js',import.meta.url),'utf8').replace(/\r\n/g,'\n');
const begin=src.indexOf('function _eqDir(raDeg, decDeg, out) {'), end=src.indexOf('\n/* 日心星表',begin);
assert.ok(begin>=0&&end>begin&&src.indexOf('function _eqDir(raDeg, decDeg, out) {',begin+1)<0);
const context={THREE,DEG:Math.PI/180};vm.runInNewContext(src.slice(begin,end)+'\nthis.api={_eqDir,galWorld}',context);
for(const [ra,dec] of [[0,0],[10.685,41.269],[83,-5],[192,27],[266,-29],[300,70]]){
  const v=context.api._eqDir(ra,dec,new THREE.Vector3());
  const source=context.api.galWorld(ra,dec,1,new THREE.Vector3());
  assert.ok(mapDirection(v).distanceTo(source)<1e-12,`source drift at ${ra},${dec}`);
}
console.log('PASS prototype matches source functions for six directions');
const base={time:1234,cameraPosition:new THREE.Vector3(3e20,-2e19,5e19),sunPosition:new THREE.Vector3(1e11,2e10,-4e10),sunGalactic:new THREE.Vector3(2.5148e20,0,0),forward:new THREE.Vector3(1,0,0),up:new THREE.Vector3(0,1,0),radius:2e20,minRadius:1e19,maxRadius:1e27,projection:new THREE.PerspectiveCamera(50,1.5,.1,100).projectionMatrix};
const original=base.cameraPosition.clone(),handoff=computeHandoff(base);
const reconstructed=new THREE.Vector3(Math.cos(handoff.theta)*Math.cos(handoff.phi),Math.sin(handoff.phi),Math.sin(handoff.theta)*Math.cos(handoff.phi)).multiplyScalar(handoff.radius).add(handoff.target);
assert.ok(reconstructed.distanceTo(handoff.position)/handoff.radius<1e-14);
assert.ok(base.cameraPosition.equals(original),'mutated input');
assert.ok(handoff.forward.clone().add(reconstructed.clone().sub(handoff.target).normalize()).length()<1e-12);
const z=computeHandoff({...base,cameraPosition:base.sunPosition.clone()});assert.ok(z.position.equals(base.sunGalactic));
for(const input of [{...base,time:NaN},{...base,radius:0},{...base,radius:1e28},{...base,projection:new THREE.Matrix4().makeScale(0,1,1)},{...base,cameraPosition:new THREE.Vector3(Infinity,0,0)}])assert.throws(()=>computeHandoff(input));
assert.throws(()=>computeHandoff({...base,projection:new THREE.Matrix4().makeScale(1e200,1e200,1e200)}),/ill-conditioned projection/);
for(const scale of [1e-100,1e-6,1,1e100]){
 const p=new THREE.Matrix4().multiplyScalar(scale), h=computeHandoff({...base,projection:p});
 const product=h.projection.clone().multiply(h.inverse).elements;
 assert.ok(product.every((v,i)=>Math.abs(v-(i%5===0?1:0))<1e-12),`inverse failed at scale ${scale}`);
}
assert.throws(()=>computeHandoff({...base,projection:new THREE.Matrix4().makeScale(1,1,1e-14)}),/ill-conditioned/);
console.log('PASS homogeneous scale invariance and ill-conditioned rejection');
assert.throws(()=>computeHandoff({...base,sunGalactic:new THREE.Vector3(1e20,1e20,1e20),cameraPosition:new THREE.Vector3(),sunPosition:new THREE.Vector3(),radius:1,minRadius:1,maxRadius:1}),/precision/);
for(const d of [1e-200,1e-11]){
 const v=new THREE.Vector3(d,0,0), h=computeHandoff({...base,cameraPosition:v,sunPosition:new THREE.Vector3(),sunGalactic:new THREE.Vector3(),radius:1,minRadius:1,maxRadius:1});
 assert.ok(h.position.lengthSq()>0 || Math.hypot(...h.position.toArray())>0,'nonzero displacement lost');
 assert.ok(Math.abs(h.position.x/d - mapDirection(new THREE.Vector3(1,0,0)).x)<1e-12);
}
console.log('PASS non-finite determinant, lost target precision and tiny displacements');
const ngp=context.api._eqDir(192.85948,27.12825,new THREE.Vector3());
assert.throws(()=>computeHandoff({...base,forward:ngp,up:new THREE.Vector3(1,0,0)}),/latitude/);
console.log(`PASS snapshot position reconstruction relative error ${reconstructed.distanceTo(handoff.position)/handoff.radius}; radius, singular projection, non-finite and polar guards`);
// Order independence checks pure snapshot evaluation, not actual reverse journey/seek.
const seq=Array.from({length:101},(_,i)=>({...base,time:i,cameraPosition:base.cameraPosition.clone().add(new THREE.Vector3(i*1e16,-i*2e15,i*3e15)),forward:new THREE.Vector3(1,i*.001,-i*.0004).normalize()}));
const summarize=x=>{const h=computeHandoff(x);return [h.time,...h.position.toArray(),...h.target.toArray(),h.theta,h.phi,...h.forward.toArray(),...h.up.toArray(),...h.projection.elements,...h.inverse.elements];};
const asc=seq.map(summarize), desc=seq.slice().reverse().map(summarize).reverse();
assert.deepEqual(asc,desc,'result depends on evaluation order');
const beforeFailure=summarize(seq[50]);assert.throws(()=>computeHandoff({...seq[50],radius:Infinity}));assert.deepEqual(summarize(seq[50]),beforeFailure,'failure changed subsequent result');
let worst=0;for(let i=0;i<seq.length;i++){
  const h=computeHandoff(seq[i]), n=new THREE.Vector3(Math.cos(h.theta)*Math.cos(h.phi),Math.sin(h.phi),Math.sin(h.theta)*Math.cos(h.phi));
  const p=h.target.clone().addScaledVector(n,h.radius);worst=Math.max(worst,p.distanceTo(h.position)/h.radius);
}
assert.ok(worst<1e-14);console.log(`PASS 101 snapshots forward/reverse evaluation, failure isolation, max relative reconstruction ${worst}`);
let max=0, invMax=0;
for(const dir of [[1,0,0],[0,1,0],[0,0,1],[.2,.3,-.8],[-.7,.1,.2]]){
  const f=new THREE.Vector3(...dir).normalize();const arbitrary=Math.abs(f.y)>.9?new THREE.Vector3(1,0,0):new THREE.Vector3(0,1,0);
  const u=arbitrary.addScaledVector(f,-arbitrary.dot(f)).normalize(), r=f.clone().cross(u).normalize();
  const frame=candidateFrame(f,u);assert.ok(Math.abs(frame.forward.dot(frame.up))<1e-12);
  for(const aspect of [.6,1,1.8]){
    const a=new THREE.PerspectiveCamera(60,aspect,.1,100),b=new THREE.PerspectiveCamera(60,aspect,.1,100);
    a.up.copy(u);a.lookAt(f);a.updateMatrixWorld(true);
    b.up.copy(frame.up);b.lookAt(frame.forward);b.updateMatrixWorld(true);
    const {projection,inverse}=reflectedProjection(b),ident=projection.clone().multiply(inverse).elements;
    ident.forEach((n,i)=>{invMax=Math.max(invMax,Math.abs(n-(i%5===0?1:0)));});
    for(const [dx,dy] of [[0,0],[.1,.05],[-.2,.1]]){
      const v=f.clone().addScaledVector(r,dx).addScaledVector(u,dy).multiplyScalar(5);
      const expected=v.clone().project(a), actual=mapDirection(v).applyMatrix4(b.matrixWorldInverse).applyMatrix4(projection);
      max=Math.max(max,expected.distanceTo(actual));
    }
  }
}
assert.ok(max<1e-5);assert.ok(invMax<1e-12);
// Non-symmetric view offset distinguishes correct P*S from incorrect H*P.
const offsetCamera=new THREE.PerspectiveCamera(60,1.5,.1,100);
offsetCamera.setViewOffset(1800,1200,250,100,1100,900);
const S=new THREE.Matrix4().makeScale(-1,1,1), P=offsetCamera.projectionMatrix.clone();
const correct=reflectedProjection(offsetCamera).projection, wrong=P.clone().premultiply(S);
const sample=new THREE.Vector3(.35,.2,-4), mapped=sample.clone().applyMatrix4(S);
const target=sample.clone().applyMatrix4(P), got=mapped.clone().applyMatrix4(correct), bad=mapped.clone().applyMatrix4(wrong);
assert.ok(target.distanceTo(got)<1e-12);assert.ok(target.distanceTo(bad)>0.01);
console.log(`PASS asymmetric view offset: P*S error ${target.distanceTo(got)}, incorrect S*P error ${target.distanceTo(bad)}`);
console.log(`PASS 45 CPU point projections, max NDC error ${max}; inverse identity max ${invMax}`);
console.log('PASS zero, non-finite and parallel direction guards');
// Separate RH v4 mathematical model; does not invoke computeHandoff's mirrored mapping.
// Finite synthetic points are camera-relative so large world-origin subtraction does
// not silently erase offsets. Distances, displacements and clip limits share units.
const rhNorth=new THREE.Vector3(...ngp.toArray()).normalize();
const rhCenter=context.api._eqDir(266.40510,-28.936175,new THREE.Vector3()).normalize();
const rhY=new THREE.Vector3().crossVectors(rhNorth,rhCenter).normalize();
const rhMap=v=>new THREE.Vector3(-v.dot(rhCenter),v.dot(rhNorth),v.dot(rhY));
const basisAxes=[new THREE.Vector3(1,0,0),new THREE.Vector3(0,1,0),new THREE.Vector3(0,0,1)].map(rhMap);
const basisDet=basisAxes[0].clone().cross(basisAxes[1]).dot(basisAxes[2]);
assert.ok(Math.abs(rhNorth.length()-1)<1e-12 && Math.abs(rhCenter.length()-1)<1e-12 && Math.abs(rhY.length()-1)<1e-12);
assert.ok(Math.abs(rhNorth.dot(rhCenter))<2e-6 && Math.abs(rhNorth.dot(rhY))<1e-12 && Math.abs(rhCenter.dot(rhY))<1e-12);
assert.ok(Math.abs(basisDet-1)<1e-10);
const sampleForward=new THREE.Vector3(.3,.2,-.9).normalize();
const sampleUp=new THREE.Vector3(0,1,0).addScaledVector(sampleForward,-sampleForward.y).normalize();
const sampleRight=new THREE.Vector3().crossVectors(sampleForward,sampleUp).normalize();
const mainCam=new THREE.PerspectiveCamera(60,1.5,.1,1e9);
mainCam.up.copy(sampleUp);mainCam.lookAt(sampleForward);mainCam.updateMatrixWorld(true);
const rhCam=new THREE.PerspectiveCamera(60,1.5,.2,2e9);
rhCam.up.copy(rhMap(sampleUp));rhCam.lookAt(rhMap(sampleForward));rhCam.updateMatrixWorld(true);
const projectRelative=(offset,camera,projection=camera.projectionMatrix)=>{
 const view=offset.clone().applyMatrix4(camera.matrixWorldInverse);
 const clip=new THREE.Vector4(view.x,view.y,view.z,1).applyMatrix4(projection);
 if(![clip.x,clip.y,clip.z,clip.w].every(Number.isFinite)||clip.w<=0) throw Error('invalid or behind camera');
 const ndc=new THREE.Vector3(clip.x/clip.w,clip.y/clip.w,clip.z/clip.w);
 return {ndc,inside:Math.abs(ndc.x)<=1&&Math.abs(ndc.y)<=1&&Math.abs(ndc.z)<=1};
};
let rhMax=0, rhDepth=0, tested=0;
for(const distance of [1,10,1000,1e6]) for(const [x,y] of [[0,0],[.1,.1],[-.2,.15]]){
 const offset=sampleForward.clone().addScaledVector(sampleRight,x).addScaledVector(sampleUp,y).multiplyScalar(distance);
 const a=projectRelative(offset,mainCam), b=projectRelative(rhMap(offset),rhCam);
 assert.ok(a.inside&&b.inside);rhMax=Math.max(rhMax,Math.hypot(a.ndc.x-b.ndc.x,a.ndc.y-b.ndc.y));
 rhDepth=Math.max(rhDepth,Math.abs(a.ndc.z-b.ndc.z));tested++;
}
// Catalog constants are rounded; the source basis is only approximately orthogonal.
assert.ok(rhMax<1e-5, `rounded RH basis XY error ${rhMax}`);
const viewPoint=new THREE.Vector4(0,0,-1,1);
const depthWith=p=>{const q=viewPoint.clone().applyMatrix4(p);return q.z/q.w;};
const depthFormula=(n,f,z)=>(f+n)/(f-n)-(2*f*n)/((f-n)*z);
assert.ok(Math.abs(depthWith(mainCam.projectionMatrix)-depthFormula(.1,1e9,1))<1e-12);
assert.ok(Math.abs(depthWith(rhCam.projectionMatrix)-depthFormula(.2,2e9,1))<1e-12);
assert.ok(Math.abs(depthWith(mainCam.projectionMatrix)-depthWith(rhCam.projectionMatrix))>0.1);
const p=sampleForward.clone().multiplyScalar(10);
const baseline=projectRelative(p,mainCam).ndc;
const moved=projectRelative(rhMap(p).sub(rhMap(sampleRight.clone().multiplyScalar(1))),rhCam).ndc;
assert.ok(Math.hypot(baseline.x-moved.x,baseline.y-moved.y)>0.1,'lateral displacement must yield parallax');
const offAxis=sampleForward.clone().addScaledVector(sampleRight,.2).multiplyScalar(10);
const expectedOffAxis=projectRelative(offAxis,mainCam).ndc;
const goodOffAxis=projectRelative(rhMap(offAxis),rhCam);
assert.ok(goodOffAxis.inside && Math.hypot(goodOffAxis.ndc.x-expectedOffAxis.x,goodOffAxis.ndc.y-expectedOffAxis.y)<1e-5);
const wrongMirror=rhMap(offAxis);wrongMirror.z*=-1;
let negativeCaught=false;try {const wrong=projectRelative(wrongMirror,rhCam);negativeCaught=!wrong.inside||Math.hypot(wrong.ndc.x-expectedOffAxis.x,wrong.ndc.y-expectedOffAxis.y)>0.01;}catch{negativeCaught=true;}
assert.ok(negativeCaught,'wrong mapping negative control');
assert.throws(()=>projectRelative(sampleForward.clone().negate(),mainCam),/behind camera/);
const nearPoint=projectRelative(sampleForward.clone().multiplyScalar(.15),mainCam);
const nearRH=projectRelative(rhMap(sampleForward.clone().multiplyScalar(.15)),rhCam);
assert.ok(nearPoint.inside&&!nearRH.inside,'different near planes should change visibility');
console.log(`PASS independent RH synthetic finite-distance ${tested} points, max XY NDC error ${rhMax}, observed depth mismatch ${rhDepth}; synthetic relative displacement, wrong-map and clipping negative controls`);
console.log('Limit: synthetic camera-relative points, same-time assumed, no actual object catalog/GPU/image; candidate duplicated source constants.');
