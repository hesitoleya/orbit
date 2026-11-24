'use strict';
const fs=require('fs'),vm=require('vm'),assert=require('assert/strict'),source=fs.readFileSync('tools/roi-lab/lab.js','utf8');
const textureSource=source.slice(source.indexOf('function tex('),source.indexOf('const vert='));
function context(error,create=true){let deletes=0,uploads=0;const gl=new Proxy({NO_ERROR:0,createTexture:()=>create?{}:null,deleteTexture:()=>deletes++,getError:()=>error,texImage3D:()=>uploads++},{get:(o,k)=>k in o?o[k]:()=>{}});const c={gl,Error};vm.runInNewContext(textureSource+';this.upload=tex;',c);return {c,counts:()=>({deletes,uploads})};}
let fixture=context(0);assert(fixture.c.upload(new Uint8Array(4),1,4));assert.equal(fixture.counts().deletes,0);
fixture=context(1285);assert.throws(()=>fixture.c.upload(new Uint8Array(4),1,4),/upload failed/);assert.equal(fixture.counts().deletes,1);
fixture=context(0,false);assert.throws(()=>fixture.c.upload(new Uint8Array(4),1,4),/allocation failed/);assert.equal(fixture.counts().uploads,0);console.log('PASS real texture helper allocation failure and upload error release');
const loadSource=source.slice(source.indexOf('async function loadFine('),source.indexOf("document.querySelector('#fine').onclick"));
(async()=>{let deleted=0,rebuilds=0,draws=0;const c={controls:()=>{},loading:false,brick:null,epoch:0,disposed:false,fineController:null,AbortController,status:{},report:{bounds:{min:[0,0,0],max:[1,1,1]}},fineOccupancy:null,ROILabKernel:{occupancy:()=>new Uint8Array(32**3)},bytes:async()=>new Uint8Array(4),tex:()=>{throw Error('Simulated OOM');},rebuild:()=>rebuilds++,draw:()=>draws++,gl:{deleteTexture:()=>deleted++},diagnostics:{errors:[]},rawBrick:null,fine:false};vm.createContext(c);vm.runInContext(loadSource+';this.load=loadFine;',c);await c.load();assert.equal(c.fine,false);assert.equal(c.brick,null);assert.equal(c.rawBrick,null);assert.equal(c.loading,false);assert.equal(rebuilds,1);assert.equal(draws,1);assert.equal(c.diagnostics.errors.length,1);assert(c.status.textContent.includes('退回低档'));
// A publication whose request token was superseded must never allocate or draw.
let release;c.bytes=()=>new Promise(r=>release=r);c.tex=()=>{throw Error('stale allocated');};const promise=c.load();c.epoch++;release(new Uint8Array(4));await promise;assert.equal(c.diagnostics.errors.length,1);assert.equal(c.loading,false);
// Macro allocation failure after fine upload must delete fine and restore low mode.
c.bytes=async()=>new Uint8Array(4);c.tex=()=>({});let once=true;c.rebuild=()=>{if(once){once=false;throw Error('Macro upload OOM');}rebuilds++;};await c.load();assert.equal(c.fine,false);assert.equal(c.brick,null);assert.equal(c.rawBrick,null);assert.equal(deleted,1);assert.equal(c.diagnostics.errors.length,2);
// Successful upload retains only the small fine occupancy, not raw volume bytes.
c.tex=()=>({});c.rebuild=()=>rebuilds++;await c.load();assert(c.brick&&c.fine);assert.equal(c.rawBrick,null);assert.equal(c.fineOccupancy.byteLength,32768);assert.equal(c.loading,false);
console.log('PASS successful upload retains only occupancy CPU data; no raw brick assignment');
console.log('PASS actual async high-load helper OOM downgrade, stale publication guard, macro failure cleanup and low recovery; mock GL, not real GPU');})().catch(e=>{console.error(e);process.exitCode=1;});
