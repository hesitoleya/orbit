'use strict';
// Production extraction of cinematic bridge input routing; CPU/VM, not GPU acceptance.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const src=fs.readFileSync('public/js/app.js','utf8').replace(/\r\n/g,'\n');
const i=src.indexOf('function journeyCineStep('),j=src.indexOf('\n}',i);
assert(i>=0&&j>i);const fn=src.slice(i,j+2);
const smoothstep=(x,a,b)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const calls=[],earth={},c={Math,smoothstep,clamp,
 JOURNEY:{lgCross:16,lg1:26.78,bridgeRadius:null},
 cam:{focus:earth,dir:{copy(){return this;},normalize(){return this;}},shift:{set(){}}},EARTH:earth,sunEf:{},
 CS:{active:false,minR:1e16,theta:.45,phi:-.2,orbitR:0,upCur:null},GALAXY_BRIDGE:{enter:1e16},
 MOM:{v:0,travel:0},FLY:{on:false,chain:false},document:{body:{dataset:{}}},
 cineLgAt(t){return t;},cosmicLeave(){c.CS.active=false;calls.push('leave');},
 _gotoBodyInstant(body,alt){c.cam.focus=body;c.cam.alt=alt;},
 enterGalaxyBridge(r){calls.push(['enter',r,c.cam.alt]);c.CS.active=true;c.CS.orbitR=r+7e8;c.CS.theta=.73;c.CS.phi=-.31;},
 journeyStop(){calls.push('stop');}
};
vm.createContext(c);vm.runInContext(fn,c);
assert(/lgCross:\s*16(?:\.0)?\b/.test(src),'shared cinematic early boundary16');
c.journeyCineStep(15.99);assert(!c.CS.active);assert.equal(c.cam.alt,10**15.99);
c.journeyCineStep(16);assert(c.CS.active);assert.deepEqual(calls[0],['enter',1e16,1e16]);
assert(Math.sin(c.cam.pitch)<-.99,'cinematic exit must look back, not outward in same direction as retreat');
assert.equal(c.CS.orbitR,1e16+7e8,'actual captured boundary radius retained');
const base=c.CS.orbitR,th=c.CS.theta,ph=c.CS.phi;
for(const lg of [16.01,17,18,20,21,22,25,26.5]){
 c.journeyCineStep(lg);
 assert.equal(c.CS.theta,th,'scale must not autonomously rotate theta');assert.equal(c.CS.phi,ph,'scale must not autonomously rotate phi');
 const want=clamp(base*10**(lg-16)*2**smoothstep(lg,21,22),1e16,1.2e27);
 assert.equal(c.CS.orbitR,want);assert.equal(c.CS.autoCenter,true);assert.equal(c.CS.upCur,null);
 const once=c.CS.orbitR;c.journeyCineStep(lg);assert.equal(c.CS.orbitR,once,'frozen frame does not accumulate scale');
}
assert.equal(calls.filter(x=>Array.isArray(x)&&x[0]==='enter').length,1,'one crossing');
c.journeyCineStep(15);assert(!c.CS.active);assert.equal(c.JOURNEY.crossed,false);
c.journeyCineStep(19);assert.deepEqual(calls[calls.length-1],['enter',1e16,1e16],'seek over boundary constructs boundary pose, not stale frame');
assert.equal(c.CS.theta,.73);assert.equal(c.CS.phi,-.31);assert(c.JOURNEY.viewOff.bridge,'existing seek API initialized sentinel');
assert(!/viewDirection\(|cineViewAt\(|CS\.(theta|phi)\s*=|_jUp|Qe/.test(fn),'no raw-E orbit, presentation hero, or roll interpolation');
const csBranch=src.slice(src.indexOf('if (CS.active) {\n    _terrainRecoveryPending'),src.indexOf('/* 对话 143：删掉 WASD'));
assert(/momStep\(dt\);[\s\S]*?if \(CS.active\) \{[\s\S]*?renderFrame\(CS.scene, CS.cam\)/.test(csBranch),'reverse inertia rechecks active before rendering');
assert(/else momStep\(dt\);[\s\S]*?if \(CS.active\) \{[\s\S]*?renderFrame\(CS.scene, CS.cam\)/.test(csBranch),'forward inertia rechecks scene');
console.log('PASS cinematic boundary16, exact captured radius, fixed proper-G orbit, deterministic forward/reverse/seek, no autonomous roll/raw-E angles, immediate scene routing. CPU/VM only.');
