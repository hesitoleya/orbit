'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {test} = require('node:test');
const root = path.join(__dirname, '../public/js');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8').replace(/\r\n/g, '\n');
const math = {}; vm.runInNewContext(fs.readFileSync(path.join(root, 'three.min.js'), 'utf8'), math);
const V = math.THREE.Vector3;
function section(from, to) {
  const a = app.indexOf(from), b = app.indexOf(to, a);
  assert(a >= 0 && b > a, from); return app.slice(a, b);
}
const inputs = [section('function csZoomK(', '/* 本星系群取景'),
  section('function setCosmicZoomRadius(', 'function ensureBridgeSky('),
  section('function _tapZoomIn()', '\n}\n') + '\n}',
  section("renderer.domElement.addEventListener('wheel'", "window.addEventListener('keydown'"),
  section('function flyStep(', 'function flyActive('),
  section('function momOnWheel(', 'function momSetPinch(')].join('\n');
function boot(alt = 500) {
  let wheel, now = 100; const timers = [];
  const c = {EARTH:{pos:new V(100,0,0)}, SUN:{pos:new V()}, SYS_DIR:new V(0,1,0),
    GEST:{taps:0}, BH:{}, DEEP:null, EXO:{active:false}, NEB:{active:null}, JOURNEY:{on:false},
    TW:{epoch:0}, GALAXY_BRIDGE:{enter:1e16}, CS:{orbitR:1e21,minR:1}, buildQueue:[],
    MOM:{mode:'light',v:0,k:1.35,vmax:1.8}, _sunBack:false,
    FLY:{on:false,c0:new V(),c1:new V(),d0:new V(),d1:new V()},
    clamp:(v,a,b)=>Math.max(a,Math.min(b,v)), performance:{now:()=>now},
    setTimeout:f=>timers.push(f), renderer:{domElement:{addEventListener(type,fn){assert.equal(type,'wheel');wheel=fn;}}},
    cosmicUpdate(){}, leaveGalaxyBridge(){c.CS.active=false; c.exits++;}, exits:0};
  c.cam = {focus:c.EARTH,alt,pitch:0,dir:new V(1,0,0),shift:new V()};
  vm.createContext(c); vm.runInContext(inputs,c);
  return {c,timers,roll:deltaY=>wheel({deltaY,preventDefault(){}}),tick:ms=>{now+=ms;c.flyStep(ms/1000);}};
}
for (const [name,alt] of [['贴地',500],['全景',2.95e12]]) {
  test(name+'推镜：同向预约，反向原地停，下一格才拉近',()=>{
    const {c,roll,tick,timers} = boot(alt);
    roll(120); assert(c.FLY.on); tick(0); tick(500);
    const pose = () => [c.cam.alt,c.cam.pitch,...c.cam.dir.toArray(),...c.cam.shift.toArray()];
    const before = pose(); if (alt>1e12) assert(c.cam.shift.length()>0);
    roll(0); assert.equal(c.FLY.chain,false); roll(120); assert.equal(c.FLY.chain,true);
    roll(0); assert.equal(c.FLY.chain,true);
    c.MOM.v=1; c.MOM.travel=.2; roll(-120); tick(5000);
    assert.equal(c.FLY.on,false); assert.equal(c.FLY.chain,false); assert.equal(c.FLY.done,null);
    assert.equal(c.MOM.v,0); assert.equal(c.MOM.travel,0); assert.equal(timers.length,0);
    assert.deepEqual(pose(),before); assert.equal(c.cam.focus,c.EARTH);
    roll(-120); assert(c.cam.alt<before[0]); assert(c.MOM.v<0);
  });
}
test('贴地推镜同向连滚只接一次全景推镜',()=>{
  const {c,roll,tick,timers}=boot(); roll(120); tick(0); roll(120); roll(120); tick(4000);
  assert.equal(timers.length,1); timers[0](); assert(c.FLY.on); assert.equal(c.FLY.a1,6.6e12);
});
test('主场景、星云、系外恒星系沿用当前相机，太阳全景打开回移闸门',()=>{
  for(const scene of ['sun','earth','neb','exo']) {
    const {c}=boot(5e14); if(scene==='sun') c.cam.focus=c.SUN;
    if(scene==='neb') c.NEB.active=0; if(scene==='exo') c.EXO.active=true;
    c._tapZoomIn(); assert(c.cam.alt<5e14 && c.cam.alt>3e12); assert.equal(c.CS.orbitR,1e21);
    assert.equal(c._sunBack,scene==='sun'); assert.equal(c.GEST.taps,1);
  }
});
test('宇宙双击只改轨道半径，跨桥只交接一次',()=>{
  const {c}=boot(); c.CS.active=true; c._tapZoomIn(); assert(c.CS.orbitR<1e21); assert.equal(c.cam.alt,500);
  c.CS.orbitR=1.01e16; c.CS.autoCenter=c.GALAXY_BRIDGE.active=true; c._tapZoomIn(); assert.equal(c.exits,1);
});
test('独立手势、推镜和转场不被通用双击覆盖',()=>{
  for(const mode of ['BH','DEEP','FLY','TW']) {
    const {c}=boot(); c.CS.active=true;
    if(mode==='BH'||mode==='DEEP') c[mode]={active:true}; else if(mode==='FLY') c.FLY.on=true; else c.TW.busy=true;
    c._tapZoomIn(); assert.equal(c.cam.alt,500); assert.equal(c.CS.orbitR,1e21);
  }
});
