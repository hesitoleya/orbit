'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync('public/index.html','utf8');
const begin=html.indexOf('window.OrbitModalKeys = function'),end=html.indexOf('\n};',begin)+3;
assert(begin>0&&end>begin);const first={focus(){doc.activeElement=this;},getClientRects(){return [1];}},last={focus(){doc.activeElement=this;},getClientRects(){return [1];}},doc={activeElement:first};
const ctx={window:{},document:doc};vm.runInNewContext(html.slice(begin,end),ctx);
const box={classList:{contains:()=>true},querySelectorAll:()=>[first,last],contains:x=>x===first||x===last};
function event(key,shiftKey=false){return {key,shiftKey,prevented:0,stopped:0,immediate:0,preventDefault(){this.prevented++;},stopPropagation(){this.stopped++;},stopImmediatePropagation(){this.immediate++;}};}
let closed=0,e=event('Escape');ctx.window.OrbitModalKeys(e,box,()=>closed++);assert.equal(closed,1);assert.equal(e.immediate,1);assert.equal(e.prevented,1);
doc.activeElement=last;e=event('Tab');ctx.window.OrbitModalKeys(e,box,()=>{});assert.equal(doc.activeElement,first);assert.equal(e.prevented,1);
e=event('Tab',true);ctx.window.OrbitModalKeys(e,box,()=>{});assert.equal(doc.activeElement,last);assert.equal(e.prevented,1);
doc.activeElement={};e=event('Tab');ctx.window.OrbitModalKeys(e,box,()=>{});assert.equal(doc.activeElement,first);
e=event('h');ctx.window.OrbitModalKeys(e,box,()=>{});assert.equal(e.stopped,1);assert.equal(e.prevented,0,'native keys not cancelled');
assert(html.includes('if (e.target===c && (e.key===\'Enter\' || e.key===\' \'))'));
assert(html.includes('returnFocus.isConnected'));assert(html.includes('atlasReturnFocus.isConnected'));
assert(html.includes('aria-label="搜索天体名称或编号"'));
console.log('PASS actual modal helper: topmost Escape stops sibling handlers, Tab/Shift+Tab containment and scene-shortcut isolation; atlas activation and focus-return contracts. VM, browser layered verification separate.');
