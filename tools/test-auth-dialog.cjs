'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const src=fs.readFileSync('public/js/auth.js','utf8').replace(/\r\n/g,'\n');
const a=src.indexOf('  function dialogKeys('),b=src.indexOf('\n  /*',a);assert(a>0&&b>a);
const c=src.indexOf('  function open(m)'),d=src.indexOf('\n  /*',c);assert(c>0&&d>c);
function boot(shared=false){const pending=[],items=[],doc={activeElement:null};const opener={isConnected:true,focus(){doc.activeElement=this;}};const first={focus(){doc.activeElement=this;},getClientRects:()=>[1]},last={focus(){doc.activeElement=this;},getClientRects:()=>[1]};items.push(first,last);let on=false,closes=0,delegated=0;
 const mask={classList:{contains:()=>on,add(){on=true;},remove(){on=false;closes++;}},querySelectorAll:()=>items,contains:x=>items.includes(x)};
 doc.activeElement=opener;doc.getElementById=id=>id==='oaMask'?mask:first;
 const ctx={window:{},document:doc,returnFocus:null,mount(){},setMode(){},setTimeout:f=>pending.push(f)};
 if(shared)ctx.window.OrbitModalKeys=(e,box,close)=>{delegated++;close();};
 vm.runInNewContext(src.slice(a,b)+'\n'+src.slice(c,d)+'\nthis.api={open,close,dialogKeys};',ctx);
 return {ctx,mask,doc,opener,first,last,pending,on:()=>on,closes:()=>closes,delegated:()=>delegated};}
function key(key,shiftKey=false){return {key,shiftKey,prevented:0,stopped:0,immediate:0,preventDefault(){this.prevented++;},stopPropagation(){this.stopped++;},stopImmediatePropagation(){this.immediate++;}};}
let t=boot();t.ctx.api.open();t.pending.shift()();assert.equal(t.doc.activeElement,t.first);t.ctx.api.open();t.ctx.api.close();assert.equal(t.doc.activeElement,t.opener,'reopen does not overwrite original focus');t.pending.shift()();assert.equal(t.doc.activeElement,t.opener,'delayed focus cannot enter closed dialog');
t.ctx.api.open();t.doc.activeElement=t.last;let e=key('Tab');t.ctx.api.dialogKeys(e,t.mask);assert.equal(t.doc.activeElement,t.first);assert.equal(e.prevented,1);e=key('Tab',true);t.ctx.api.dialogKeys(e,t.mask);assert.equal(t.doc.activeElement,t.last);e=key('Escape');t.ctx.api.dialogKeys(e,t.mask);assert(!t.on());assert.equal(e.immediate,1);assert.equal(t.doc.activeElement,t.opener);
t=boot(true);t.ctx.api.open();t.ctx.api.dialogKeys(key('Escape'),t.mask);assert.equal(t.delegated(),1);assert(!t.on());
assert(src.includes('box-sizing:border-box;width:min(392px,92vw)'));assert(src.includes('max-height:calc(100dvh - 24px);overflow-y:auto'));
console.log('PASS actual auth open/close/dialogKeys: standalone and shared keyboard policy, repeated opens, delayed-focus guard, focus restoration, Tab containment; bounded mobile form CSS. No credentials or network calls.');
