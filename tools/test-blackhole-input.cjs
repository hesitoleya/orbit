'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const app=fs.readFileSync('public/js/app.js','utf8').replace(/\r\n/g,'\n'),start=app.indexOf('(function bhInput() {'),end=app.indexOf('\n})();',start)+6;
assert(start>0&&end>start);
function boot(){
 const events={},BH={active:true,dragging:false,tAz:0,tInc:.115,tDist:17.5},DEEP={active:false};let exits=0;
 const ctx={BH,DEEP,clamp:(x,a,b)=>Math.max(a,Math.min(b,x)),leaveBlackHole(){exits++;BH.active=false;BH.dragging=false;},window:{addEventListener(k,fn){events[k]=fn;}}};
 vm.runInNewContext(app.slice(start,end),ctx);
 function fire(type,props={}){let stopped=0,prevented=0,captured=[];const event={button:0,clientX:0,clientY:0,pointerId:1,target:{closest:()=>null,setPointerCapture:id=>captured.push(id)},stopPropagation(){stopped++;},preventDefault(){prevented++;},...props};events[type](event);return {stopped,prevented,captured};}
 return {BH,DEEP,fire,exits:()=>exits};
}
let t=boot();assert.deepEqual(t.fire('pointerdown').captured,[1]);assert(t.BH.dragging);
t.fire('pointermove',{clientX:100,clientY:30});assert.equal(t.BH.tAz,-.6);assert.equal(t.BH.tInc,.235);
t.fire('pointerup');assert(!t.BH.dragging);
for(const type of ['blur','pointercancel']){t.fire('pointerdown');t.fire(type);assert(!t.BH.dragging);}
for(const button of [1,2]){t.fire('pointerdown',{button});assert(!t.BH.dragging,'secondary buttons do not orbit');}
t.fire('pointerdown',{target:{closest:()=>({})}});assert(!t.BH.dragging,'HUD control does not start orbit');
t.fire('pointerdown');t.fire('pointermove',{clientY:1e6});assert.equal(t.BH.tInc,.62);t.fire('pointermove',{clientY:-1e6});assert.equal(t.BH.tInc,-.62);t.fire('pointerup');
t.BH.tInc=.04;t.fire('pointerdown');t.fire('pointermove',{clientY:-10});assert.equal(t.BH.tInc,.02,'coplanar guard');t.fire('pointerup');
assert.equal(t.fire('wheel',{deltaY:-120}).prevented,1);assert(t.BH.tDist<17.5);t.fire('wheel',{deltaY:1e6});assert.equal(t.BH.tDist,40);t.fire('wheel',{deltaY:-1e6});assert.equal(t.BH.tDist,4.2);
t.DEEP.active=true;const before={...t.BH};assert.equal(t.fire('wheel',{deltaY:500}).prevented,0);t.fire('pointerdown');t.fire('keydown',{key:'Escape'});assert.deepEqual(t.BH,before);assert.equal(t.exits(),0);
t.DEEP.active=false;t.fire('keydown',{key:'Escape'});assert.equal(t.exits(),1);assert(!t.BH.active);
assert(app.includes('BH.active = false;\n  BH.dragging = false;'));
assert(app.includes('BH.time = 0;\n  BH.dragging = false;'));
console.log('PASS actual bhInput: orbit, primary-button only, HUD guards, blur/cancel release, inclination/zoom limits, coplanar guard, higher-scene ownership, Escape and enter/exit drag reset. VM plus separate browser evidence required.');
