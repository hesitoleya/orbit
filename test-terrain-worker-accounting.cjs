const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const src = fs.readFileSync(__dirname + '/public/js/app.js', 'utf8');
const section = (a, b) => {
  const start = src.indexOf(a), end = src.indexOf(b, start);
  assert.ok(start >= 0 && end > start, a);
  return src.slice(start, end);
};
const code = `
const performance = { now: () => 1 };
const console = { warn() {} };
${section('const MAX_INFLIGHT = 8;', 'const WORKER_SRC = [')}
let _lastMsgT = 0, _wmsgs = 0, _werrs = 0, _jdone = 0;
const _mtask = Object.create(null);
let sent = [], assembled = [];
let geoWorker = {postMessage: d => sent.push(d), terminate() {}};
let timerId = 0; const timers = new Map();
function setTimeout(fn) { timers.set(++timerId, fn); return timerId; }
function clearTimeout(id) { timers.delete(id); }
const VEG = {pending:false, seq:0, retryCount:0}, BLD = {pending:false, seq:0, retryCount:0};
function requestVeg() {} function requestBld() {}
let buildQueue = [], patchCache = new Map();
const terrainGroup = {remove() {}};
const FLY = {on:false}, PT = {}, sunEf = {x:0,y:0,z:0};
function updateTerrain() {}
function applyVeg() {}
function applyBuild() {}
function assemblePatch(p) { assembled.push(p); p.queued = false; }
let _workerRebuilds = 0;
const PEAKS = [], VOLCANOES = [];
function spawnWorker() { geoWorker = {postMessage: d => sent.push(d), terminate() {}}; return true; }
function pushEarthToWorker() {}
${section('function onWorkerMsg(e) {', 'function spawnWorker() {')}
${section('function resetTerrain() {', 'function sendJob(p) {')}
${section('function sendJob(p) {', '/* ---------- 主线程：把 Worker 算出的数组组装进场景')}
${section('function queueSyncFallback(p) {', '/* =========================================================')}
function patch(key) { const p = {key, queued:false, dir:{x:0,y:0,z:0}, dist:0, terrainRetries:0}; patchCache.set(key, p); return p; }
function reply(d) { onWorkerMsg({data:d}); }
`;
const tests = `
const old = patch('same'); requestBuild(old); pumpBuildQueue();
const oldId = sent[0].requestId;
resetTerrain();
const fresh = patch('same'), other = patch('other');
requestBuild(fresh); requestBuild(other); pumpBuildQueue();
assert.equal(inFlight, 3);
const freshId = sent[1].requestId, otherId = sent[2].requestId;
reply({key:'same', requestId:oldId});
assert.equal(inFlight, 2); assert.equal(assembled.length, 0);
assert.equal(pendingJobs.get('same'), fresh);
reply({key:'same', requestId:oldId}); assert.equal(inFlight, 2);
reply({task:'err', sourceTask:'veg', msg:'veg'}); assert.equal(inFlight, 2);
reply({task:'err', sourceTask:'geo', requestId:otherId, msg:'error'});
assert.equal(inFlight, 2); assert.equal(other.queued, true);
assert.equal(other.terrainRetries, 1);
assert.equal(pendingJobs.get('same'), fresh);
assert.equal(pendingJobs.get('other'), other);
const retryId = sent.at(-1).requestId; assert.notEqual(retryId, otherId);
reply({task:'err', sourceTask:'geo', requestId:otherId}); assert.equal(inFlight, 2);
reply({key:'same', requestId:freshId});
assert.equal(inFlight, 1); assert.deepEqual(assembled, [fresh]);
reply({key:'same', requestId:freshId}); assert.equal(inFlight, 1);
reply({key:'other', requestId:retryId});
assert.equal(inFlight, 0); assert.deepEqual(assembled, [fresh, other]);
for (let i=0;i<8;i++) requestBuild(patch('old'+i)); pumpBuildQueue();
assert.equal(inFlight, 8); const prior = sent.slice(-8);
resetTerrain(); for (let i=0;i<9;i++) requestBuild(patch('new'+i)); pumpBuildQueue();
assert.equal(inFlight, 8); assert.equal(buildQueue.length, 9);
reply({requestId:prior[0].requestId});
assert.equal(inFlight, 8); assert.equal(buildQueue.length, 8);
assert.equal(assembled.length, 2);
rebuildWorker();
assert.equal(inFlight, 0); assert.equal(terrainRequests.size, 0);
assert.equal(pendingJobs.size, 0); assert.equal(_jobT.size, 0);
assert.equal(buildQueue.length, 9);
resetTerrain();
assert.equal(patchCache.size, 0); assert.equal(buildQueue.length, 0);
const broken = patch('broken'); requestBuild(broken);
geoWorker.postMessage = () => { throw new Error('clone failed'); };
pumpBuildQueue();
assert.equal(geoWorker, null); assert.equal(inFlight, 0);
assert.equal(pendingJobs.size, 0); assert.equal(terrainRequests.size, 0);
assert.equal(_jobT.size, 0); assert.equal(timers.size, 0);
assert.equal(broken.queued, true); assert.equal(broken.syncQueued, true);
assert.equal(syncFallbackQueue.includes(broken), true);
resetTerrain();
assert.equal(patchCache.size, 0);
rebuildWorker();
const active = patch('active'); requestBuild(active); pumpBuildQueue();
assert.equal(inFlight, 1);
const waiting = patch('waiting'); requestBuild(waiting);
rebuildWorker();
assert.equal(active.queued, true); assert.equal(waiting.queued, true);
assert.equal(inFlight, 0); assert.equal(buildQueue.length, 2);
assert.equal(pendingJobs.size, 0); assert.equal(terrainRequests.size, 0);
assert.equal(_jobT.size, 0); assert.equal(timers.size, 0);
pumpBuildQueue();
assert.equal(inFlight, 2); assert.equal(pendingJobs.get('active'), active);
assert.equal(pendingJobs.get('waiting'), waiting);
`;
vm.runInNewContext(code + tests, {assert});
console.log('terrain worker accounting: PASS');
