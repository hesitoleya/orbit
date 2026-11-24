'use strict';
// Offline tests execute narrow actual app sections with real bundled THREE math.
// No browser, GPU, network, navigation or production writes.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),app=fs.readFileSync(path.join(root,'public/js/app.js'),'utf8'),box={console};box.window=box;
vm.runInNewContext(fs.readFileSync(path.join(root,'public/js/three.min.js'),'utf8'),box);const T=box.THREE;
let n=0;function test(name,fn){fn();console.log(`PASS ${++n} ${name}`);}
const go=app.slice(app.indexOf('function goTarget('),app.indexOf('/* 星系全景的固定机位',app.indexOf('function goTarget(')));
test('explicit destination cancels cinematic writer before any async branch',()=>{
 assert(go.indexOf('journeyStop(true);')<go.indexOf('if (CS.active)'));
 for(const cosmic of [false,true])for(const tween of [false,true]){
  const earth={},sun={},state={on:true},events=[],c={JOURNEY:state,CS:{active:cosmic},TW:{on:tween},FLY:{on:true,chain:true,done:()=>{}},cam:{focus:earth,alt:1e7,dir:new T.Vector3()},
   journeyStop(silent){assert.equal(silent,true);events.push('stop');state.on=false;},cosmicLeave(){events.push('leave');c.CS.active=false;},
   _gotoBodyInstant(body,alt){assert.equal(state.on,false);events.push('goto');c.cam.focus=body;c.cam.alt=alt;},
   warpOr(fn){assert.equal(state.on,false);events.push('scheduled');c.pending=fn;},withFade(fn){fn();}};
  vm.runInNewContext(go,c);c.goTarget(sun,1.3e9,-Math.PI/2);
  assert.equal(events[0],'stop');assert.equal(state.on,false);assert.equal(c.FLY.on,false);assert.equal(c.FLY.chain,false);assert.equal(c.FLY.done,null);
  if(c.pending)c.pending();assert.equal(c.cam.focus,sun);assert.equal(c.cam.alt,1.3e9);assert.equal(c.cam.pitch,-Math.PI/2);assert.equal(c.CS.active,false);
 }
 const instant=app.slice(app.indexOf('function _gotoBodyInstant('),app.indexOf('/* 对外：同体走补间',app.indexOf('function _gotoBodyInstant(')));
 assert(!instant.includes('journeyStop'), 'cine internal placement must not cancel itself');
});
const basisStart=app.indexOf('const faceZ=dir.clone()'),basisEnd=app.indexOf('scene.add(NEB.mainVolume);',basisStart),basis=app.slice(basisStart,basisEnd);
test('fixed initial nebula quaternion faces observer with right-handed screen basis',()=>{
 assert(basisStart>=0&&basisEnd>basisStart);
 for(const xyz of [[1,0,0],[0,1,0],[0,0,1],[0,0,-1],[.3,.7,.1],[-.9,.2,.5],[.001,0,.999999]]){
  const dir=new T.Vector3(...xyz).normalize(),mesh=new T.Mesh(),c={THREE:T,dir,NEB:{mainVolume:mesh}};
  vm.runInNewContext(basis,c);const q=mesh.quaternion,x=new T.Vector3(1,0,0).applyQuaternion(q),y=new T.Vector3(0,1,0).applyQuaternion(q),z=new T.Vector3(0,0,1).applyQuaternion(q);
  assert(z.dot(dir)>1-1e-12,'local+Z points toward observer');assert(Math.abs(x.dot(y))<1e-12);assert(Math.abs(x.dot(z))<1e-12);assert(Math.abs(y.dot(z))<1e-12);
  assert(new T.Vector3().crossVectors(x,y).dot(z)>1-1e-12);
  const up=Math.abs(dir.z)>.999?new T.Vector3(1,0,0):new T.Vector3(0,0,1);up.addScaledVector(dir,-up.dot(dir)).normalize();assert(y.dot(up)>1-1e-12);
 }
});
test('volume updates preserve orientation through origin changes and obey settings',()=>{
 const fn=app.slice(app.indexOf('function updateNebula(origin)'),app.indexOf('/* 对话 57 的 A/B 开关',app.indexOf('function updateNebula(origin)')));
 const mesh=new T.Mesh(),c={THREE:T,NEB:{active:0,mainVolume:mesh,body:{pos:new T.Vector3(1e12,3e12,-2e12),radius:1e10},vol:true,group:{}},DEEP_SKY:{on:true}};
 mesh.quaternion.setFromAxisAngle(new T.Vector3(0,1,0),.73);const q=mesh.quaternion.clone();vm.runInNewContext(fn,c);
 for(const origin of [new T.Vector3(),new T.Vector3(8e11,-9e11,7e11)]){
  c.updateNebula(origin);assert(mesh.quaternion.equals(q));assert(mesh.position.equals(c.NEB.body.pos.clone().sub(origin)));assert.equal(mesh.scale.x,1e10);assert.equal(mesh.visible,true);
 }
 c.NEB.vol=false;c.updateNebula(new T.Vector3());assert.equal(mesh.visible,false);c.NEB.vol=true;c.DEEP_SKY.on=false;c.updateNebula(new T.Vector3());assert.equal(mesh.visible,false);
});
test('shape5 horsehead and shape6 shell select distinct defined media',()=>{
 const m=app.match(/const kind=([^;]+);\s*NEB.mainVolume=MAIN_VOLUMES.create/);assert(m);
 for(const [shape,expected] of [[0,6],[1,7],[2,8],[3,9],[4,10],[5,11],[6,12]])assert.equal(vm.runInNewContext(m[1],{nb:{shape}}),expected);
 const mod=fs.readFileSync(path.join(root,'public/js/main-volumes.js'),'utf8');assert(mod.includes('type===11')&&mod.includes('type===12'));
});
test('galaxy point LOD and current main volume share authoritative state',()=>{
 const a=app.indexOf('const mainMwVisible='),b=app.indexOf('const inDisk =',a),d=app.indexOf('CS.mainGalaxy.visible=mainMwVisible',b);assert(a>=0&&b>a&&d>b);
 const predicate=app.slice(b,app.indexOf(';',b));assert(predicate.includes('mainMwVisible'));assert(!predicate.includes('mwReal'));
 const size=app.slice(app.indexOf('gsz.array[i] = (m.visible || inDisk)',b),app.indexOf('\n',app.indexOf('gsz.array[i] = (m.visible || inDisk)',b))+100);assert(size.includes('? 0'));
});
test('unresolved galaxy locators are bounded compact points at every cosmic scale',()=>{
 const lo=app.match(/const dotMin = ([^;]+);/),hi=app.match(/const dotCap = ([^;]+);/);assert(lo&&hi);
 for(let lgR=19;lgR<=28;lgR+=.1){const c={lgR,smoothstep(x,a,b){const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);}};const a=vm.runInNewContext(lo[1],c),b=vm.runInNewContext(hi[1],c);assert(a>=2&&a<=2.8&&b>=4&&b<=6&&b>=a);}
});
console.log(`PASS ${n} offline navigation/basis/LOD contracts. Async browser event timing and rendered composition not accepted here.`);
