'use strict';
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const src = fs.readFileSync(require('node:path').join(__dirname, '../public/js/app.js'), 'utf8');
const part = (a, b) => {
  const start = src.indexOf(a), end = src.indexOf(b, start);
  assert.ok(start >= 0 && end > start, a);
  return src.slice(start, end);
};
let now = 10;
const context = vm.createContext({ console, performance: { now: () => now } });
vm.runInContext(`
${part('const MAX_INFLIGHT = 8;', 'const WORKER_SRC = [')}
let geoWorker=null, _werrs=0, _wmsgs=0, _jdone=0, _lastMsgT=0, _workerRebuilds=0;
const buildQueue=[], patchCache=new Map(), FLY={on:false}, PT={}, sunEf={x:0,y:0,z:0}, PEAKS=[], VOLCANOES=[];
const VEG={pending:false,seq:0,retryCount:0}, BLD={pending:false,seq:0,retryCount:0};
const WORKER_SRC='', URL={createObjectURL(){return ''}}, Blob=function(){};
let timers=new Map(), timerId=0, assembled=[], workers=[], throwBuild=false, throwAssemble=false, vegRequests=0, bldRequests=0;
const terrainGroup={remove(){},add(){}};
function setTimeout(fn){timers.set(++timerId,fn);return timerId} function clearTimeout(id){timers.delete(id)}
class Worker { constructor(){this.sent=[];workers.push(this)} postMessage(d){if(this.throwPost)throw Error('post');this.sent.push(d)} terminate(){this.dead=true} }
function updateTerrain(){} function pushEarthToWorker(){}
function buildPatchArrays(p){if(throwBuild)throw Error('build');return {key:p.key}}
function assemblePatch(p,d,stitch=p.targetStitch,bLodMax=p.targetBLodMax){if(throwAssemble)throw Error('assemble');p.queued=false;p.geo=true;p.stitch=stitch;p.bLodMax=bLodMax;p.terrainRetries=0;p.syncFallback=false;assembled.push([p,d])}
function applyVeg(){} function applyBuild(){} function requestVeg(){vegRequests++} function requestBld(){bldRequests++}
${part('const _mtask = Object.create(null);', 'spawnWorker();')}
${part('function resetTerrain() {', '/* ---------- 主线程：把 Worker')}
${part('function buildPatch(p) {', '/* =========================================================')}
function patch(key){const p={key,queued:true,dir:{},dist:0,terrainRetries:0};patchCache.set(key,p);return p}
function reply(worker,data){worker.onmessage({data})}
`, context);
const run = code => vm.runInContext(code, context);
run('spawnWorker(); for(let i=0;i<8;i++) buildQueue.push(patch("k"+i)); pumpBuildQueue()');
assert.equal(run('inFlight'), 8);
run('var oldWorker=geoWorker, old=oldWorker.sent[0]; resetTerrain(); var fresh=patch(old.key); buildQueue.push(fresh); pumpBuildQueue()');
run('reply(oldWorker,{key:old.key,requestId:old.requestId})');
assert.equal(run('assembled.length'), 0);
run('var freshMsg=oldWorker.sent.at(-1); reply(oldWorker,{task:"unexpected",key:freshMsg.key,requestId:freshMsg.requestId})');
assert.equal(run('inFlight===8 && terrainRequests.has(freshMsg.requestId) && pendingJobs.get(fresh.key)===fresh && assembled.length===0'), true);
run('reply(oldWorker,{key:freshMsg.key,requestId:freshMsg.requestId})');
assert.equal(run('assembled.length'), 1);
run('VEG.pending=true; VEG.seq=2; BLD.pending=true; BLD.seq=2; reply(oldWorker,{task:"err",sourceTask:"veg",key:1}); reply(oldWorker,{task:"err",sourceTask:"build",key:1})');
assert.equal(run('VEG.pending && BLD.pending && vegRequests===0 && bldRequests===0'), true);
run('reply(oldWorker,{task:"err",sourceTask:"veg",key:2}); reply(oldWorker,{task:"err",sourceTask:"build",key:2})');
assert.equal(run('vegRequests===1 && bldRequests===1'), true);
run('failTerrainWorker(); buildQueue.length=0; patchCache.clear(); var stale=patch("stale"); stale.syncFallback=true; queueSyncFallback(stale); patchCache.clear(); var replacement=patch("stale"); pumpSyncFallback()');
assert.equal(run('assembled.some(x=>x[0]===stale)'), false);
run('replacement.syncFallback=true; throwBuild=true; queueSyncFallback(replacement); pumpSyncFallback()');
assert.equal(run('replacement.queued && replacement.syncQueued'), true);
run('pumpSyncFallback()');
assert.equal(run('replacement.terrainRetries'), 1);
for (let i=0; i<10; i++) {
  now = run('replacement.syncRetryAt');
  run('pumpSyncFallback()');
}
assert.equal(run('replacement.queued && replacement.syncQueued && !replacement.terrainFailed'), true);
assert.equal(run('replacement.syncRetryAt') - now, 30000);
now = run('replacement.syncRetryAt');
run('throwBuild=false; pumpSyncFallback()');
assert.equal(run('replacement.geo'), true);
run('var existing=patch("existing"); existing.mesh={id:"old"}; existing.geo="old"; existing.syncFallback=true; throwBuild=true; queueSyncFallback(existing); pumpSyncFallback()');
assert.equal(run('existing.mesh.id==="old" && existing.geo==="old" && existing.syncQueued'), true);
now = run('existing.syncRetryAt');
run('throwBuild=false; pumpSyncFallback()');
assert.equal(run('existing.geo===true && !existing.queued'), true);
run('spawnWorker(); VEG.pending=true; VEG.pendT=10; BLD.pending=true; BLD.pendT=10; geoWorker.throwPost=true; var postPatch=patch("post-throw"); buildQueue.push(postPatch); pumpBuildQueue()');
assert.equal(run('geoWorker===null && inFlight===0 && pendingJobs.size===0 && !VEG.pending && !BLD.pending'), true);
assert.equal(run('postPatch.syncQueued && !postPatch.geo'), true);
run('pumpSyncFallback()');
assert.equal(run('postPatch.geo'), true);
run('spawnWorker(); var p=patch("assemble"); p.targetStitch=3;p.targetBLodMax=9; buildQueue.push(p); pumpBuildQueue(); var msg=geoWorker.sent.at(-1); throwAssemble=true; reply(geoWorker,{requestId:msg.requestId}); throwAssemble=false');
assert.equal(run('p.stitch'), undefined);
assert.equal(run('pendingJobs.get(p.key)===p'), true);
run('msg=geoWorker.sent.at(-1); reply(geoWorker,{requestId:msg.requestId})');
assert.equal(run('p.stitch===3 && p.bLodMax===9'), true);
vm.runInNewContext(`
let fail = true;
const THREE = {
  BufferGeometry: class { setAttribute(){if(fail)throw Error('attribute')} setIndex(){} dispose(){} },
  BufferAttribute: class {}, Sphere: class {}, Vector3: class {}, Mesh: class {constructor(geometry){this.geometry=geometry}}
};
const terrainMat={}, terrainGroup={add(){},remove(){}};
${part('function assemblePatch(p, d', '/* 同步兜底路径')}
const oldMesh={geometry:{dispose(){}}}, p={mesh:oldMesh,geo:'old',size:1,targetStitch:3,targetBLodMax:9};
assert.throws(()=>assemblePatch(p,{}), /attribute/);
assert.equal(p.mesh,oldMesh); assert.equal(p.stitch,undefined);
fail=false; assemblePatch(p,{});
assert.equal(p.stitch,3); assert.equal(p.bLodMax,9); assert.notEqual(p.mesh,oldMesh);
`, {assert});
vm.runInNewContext(`
const patchCache=new Map(), frameId=0, R_EARTH=100, G=10;
const FACES=[{n:[1,0,0],u:[0,1,0],v:[0,0,1]}], EARTH={pos:{x:0,y:0,z:0}};
const THREE={Vector3:class {constructor(x,y,z){Object.assign(this,{x,y,z})}}};
${part('function getPatch(f, l, x, y) {', '/* ---------- LOD 缝合')}
const p=getPatch(0,2,0,0);
assert.equal(p.targetStitch,0);
assert.equal(p.targetBLodMax,p.lodMax);
assert.equal(p.stitch,undefined);
p.stitch=p.targetStitch; p.bLodMax=p.targetBLodMax;
const mask=0, bLod=p.lodMax;
const need=(p.stitch===undefined) ? mask!==0 : (mask!==p.stitch || bLod!==p.bLodMax);
assert.equal(need,false);
`, {assert});
vm.runInNewContext(`
const buildQueue=[], MOM={v:1,travel:1}, EXO={active:false}, NEB={active:null};
const vec={copy(){return this}};
const FLY={d0:vec,d1:vec}, cam={alt:14,pitch:0,dir:vec};
function clamp(v,min,max){return Math.max(min,Math.min(max,v))}
${part('function groundFlyOut() {', 'function flyActive()')}
const normal={queued:true}, stitch={queued:true,stitchQueued:true,mesh:{},stitch:2}, inflight={queued:true};
buildQueue.push(normal,stitch);
assert.equal(groundFlyOut(),true); FLY.done();
assert.equal(buildQueue.length,0); assert.equal(normal.queued,false);
assert.equal(stitch.queued,false); assert.equal(stitch.stitchQueued,false);
assert.equal(stitch.stitch,2); assert.equal(inflight.queued,true);
`, {assert});
assert.match(src, /const idleNow = buildQueue\.length === 0 && syncFallbackQueue\.length === 0 && inFlight === 0/);
assert.match(src, /queue: buildQueue\.length, syncQueue: syncFallbackQueue\.length/);
assert.ok(src.indexOf('VEG.pending && performance.now() - VEG.pendT > 6000', src.indexOf('function updateVeg()')) < src.indexOf('if (!VEG.ready)', src.indexOf('function updateVeg()')));
assert.ok(src.indexOf('BLD.pending && performance.now() - BLD.pendT > 6000', src.indexOf('function updateBld()')) < src.indexOf('if (!BLD.ready)', src.indexOf('function updateBld()')));
console.log('地形故障测试通过：旧对象、回包匹配、同步异常恢复、组装重试、拼接提交及首轮超时');
