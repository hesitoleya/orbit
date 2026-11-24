'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict');
const app=fs.readFileSync('public/js/app.js','utf8');
const timerSource=app.slice(app.indexOf('async cosmicGpuTimer(count){'),app.indexOf('\n  cosmicFrameProbe(count){')).replace('async cosmicGpuTimer(count){','return async function(count){').replace(/},\s*$/,'}');
const paritySource=app.slice(app.indexOf('cosmicSupportParity(flags){'),app.indexOf('\n  async cosmicGpuTimer(count){'));
assert(paritySource.includes('renderActiveFrame({gradePhase:0})'));
assert(app.includes('gradeT.value = (gradeT.value + 1.0) % 1000.0;'));
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
async function run(mode,count){
 let created=0,deleted=0,begin=0,end=0,renders=0,waits=0;
 const ext={TIME_ELAPSED_EXT:1,GPU_DISJOINT_EXT:2};
 const gl={CURRENT_QUERY:3,QUERY_RESULT_AVAILABLE:4,QUERY_RESULT:5,getExtension:()=>mode==='unsupported'?null:ext,getQuery:()=>mode==='busy'?{}:null,createQuery:()=>{created++;return {};},deleteQuery:()=>deleted++,beginQuery:()=>begin++,endQuery:()=>end++,getQueryParameter:(q,p)=>p===4?mode!=='timeout':2500000,getParameter:()=>mode==='disjoint',getError:()=>0};
 const fn=new Function('CS','renderer','renderActiveFrame','clamp','requestAnimationFrame',timerSource)({active:true},{getContext:()=>gl},options=>{assert.equal(options.gradePhase,0);renders++;if(mode==='throw'&&renders===2)throw new Error('render-fixture');},clamp,cb=>{waits++;cb();});
 let result,error;try{result=await fn(count);}catch(e){error=e;}
 return {result,error,created,deleted,begin,end,renders,waits};
}
(async()=>{
 const ok=await run('ok',2);assert.deepEqual(ok.result,{supported:true,valid:true,gpuMs:[2.5,2.5],glError:0});assert.equal(ok.created,ok.deleted);assert.equal(ok.begin,ok.end);
 const bounded=await run('ok',100);assert.equal(bounded.created,6);
 const unsupported=await run('unsupported',2);assert.equal(unsupported.result.supported,false);assert.equal(unsupported.created,0);
 const busy=await run('busy',2);assert.equal(busy.result.error,'timer-already-active');assert.equal(busy.created,0);
 const disjoint=await run('disjoint',2);assert.equal(disjoint.result.valid,false);assert.equal(disjoint.result.reason,'gpu-disjoint');assert.equal(disjoint.created,disjoint.deleted);
 const timeout=await run('timeout',2);assert.equal(timeout.result.reason,'query-timeout');assert.equal(timeout.waits,90);assert.equal(timeout.created,timeout.deleted);
 const throwing=await run('throw',2);assert.equal(throwing.error.message,'render-fixture');assert.equal(throwing.created,throwing.deleted);assert.equal(throwing.begin,throwing.end);
 console.log('PASS actual timer method: fixed grade, supported/busy guards, bounded count/wait, disjoint rejection, query cleanup on success/throw; not GPU performance proof');
})().catch(e=>{console.error(e);process.exitCode=1;});
