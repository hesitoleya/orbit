const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../public/js/app.js'), 'utf8');
const extract = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));

async function main() {
  let image;
  const ctx = { Image: class { constructor() { image = this; } }, document: { createElement: () => ({ getContext: () => ({ drawImage() { throw Error('canvas failed'); } }) }) }, Uint8Array, setTimeout, clearTimeout, Error };
  vm.createContext(ctx);
  vm.runInContext(extract('function decodeB64Image(', '\n/* RGB 字节'), ctx);
  const decoding = ctx.decodeB64Image('data:image/png;base64,AA', 1, 1);
  image.onload();
  await assert.rejects(decoding, /canvas failed/);
  let fireTimeout;
  ctx.setTimeout = fn => { fireTimeout = fn; return 1; };
  ctx.clearTimeout = () => {};
  const hangingImage = ctx.decodeB64Image('data:image/png;base64,AA', 1, 1);
  fireTimeout();
  await assert.rejects(hangingImage, /超时/);

  const block = extract('let EARTH_DATA_OK = false;', '\nif (PT.earthMap) loadEarthData();');
  let failWorker = 0, toast = 0, picks = 0, ready = 0, attempt = 0, retry;
  const context = {
    EDATA: null, ECLIM: null, EBIOME: null, EW: 1, EH: 1, ECW: 1, ECH: 1, EBW: 1, EBH: 1,
    window: { addEventListener() {}, __ORBIT_INLINE__: { terrain: 't', climate: 'c', peaks: {}, volcanoes: {} } },
    Promise, AbortController, console, setTimeout: fn => { retry = fn; return 1; }, clearTimeout() {},
    decodeB64Image: () => attempt === 0 ? Promise.reject(Error('decode')) : Promise.resolve(new Uint8Array([1])),
    setPeaks() {}, setVolcanoes() {}, PEAKS: [], VOLCANOES: [],
    geoWorker: { postMessage() { throw Error('post'); } },
    failTerrainWorker() { failWorker++; context.geoWorker = null; },
    PLANET_TYPES: { earth: { earthMap: true } }, PTKey: 'earth', PT: { earthMap: true },
    showToast() { toast++; }, pickStartPoint() { picks++; },
    markStage() { ready++; }, setLoaderText() {}, terrainMat: { uniforms: { uEarth: {}, uClim: {}, uBiome: {}, uEarthData: {} } },
    makeDataTex: () => ({}), patchCache: new Map(), buildQueue: [], pendingJobs: new Map(),
    invalidateVeg() {}, invalidateBuild() {}, updateHUD() {}, cam: { alt: 0 }
  };
  vm.createContext(context);
  vm.runInContext(block, context);
  assert.match(source, /mix\(dryN, eArid, 0\.82 \* uEarthData\)/);
  const loader = {};
  vm.createContext(loader);
  vm.runInContext(extract('function terrainLoaderOutcome(', '\n}').concat('\n}'), loader);
  assert.equal(loader.terrainLoaderOutcome(true, 1, 0, 0), 'ready');
  assert.equal(loader.terrainLoaderOutcome(false, 30, 4, 3000), 'ready');
  assert.equal(loader.terrainLoaderOutcome(true, 0, 4, 8000), null);
  assert.equal(loader.terrainLoaderOutcome(true, 0, 4, 8001), 'timeout');
  assert.equal(loader.terrainLoaderOutcome(false, 1, 0, 8001), 'timeout');
  assert.equal(loader.terrainLoaderOutcome(true, 1, 0, 8001), 'ready');
  const watchdog = {};
  vm.createContext(watchdog);
  vm.runInContext(extract('function terrainWatchdogExpired(', '\n/* 对话 88'), watchdog);
  assert.equal(watchdog.terrainWatchdogExpired(0, 1000, 32001, 20000, 30, 1), true);
  assert.equal(watchdog.terrainWatchdogExpired(0, 1000, 32000, 20000, 30, 1), false);
  assert.equal(watchdog.terrainWatchdogExpired(0, 1000, 32001, 22001, 30, 1), false);
  assert.equal(watchdog.terrainWatchdogExpired(2, 1000, 32001, 20000, 30, 1), false);
  assert.equal(watchdog.terrainWatchdogExpired(0, 0, 32001, 20000, 30, 1), false);
  assert.equal(watchdog.terrainWatchdogExpired(0, 1000, 32001, 20000, 50, 1), false);
  assert.equal(watchdog.terrainWatchdogExpired(0, 1000, 32001, 20000, 0, 0), false);
  const recovery = {
    ctxLost: false, EARTH: {}, cam: {}, JOURNEY: { on: false }, CS: { active: false },
    BH: { active: false }, DEEP: { active: false }, visible: [], pendingJobs: new Map([['a', {}]]),
    _terrainRecoveryPending: true, _terrainWatchdogStart: 1000, _terrainResets: 0,
    _wdDone: 0, _jdone: 0, _wdT: 1000, resets: 0, rebuilds: 0,
    firstFrame: false, _terrainWaitStart: 1000, _settleN: 0, buildQueue: [1], syncFallbackQueue: [], inFlight: 1,
    console: { warn() {} }, rebuildWorker() { this.rebuilds++; }, resetTerrain() { this.resets++; }
  };
  recovery.cam.focus = recovery.EARTH;
  recovery.rebuildWorker = () => recovery.rebuilds++;
  recovery.resetTerrain = () => recovery.resets++;
  vm.createContext(recovery);
  vm.runInContext(extract('function terrainLoaderOutcome(', '\n/* 对话 88'), recovery);
  const tickRecovery = extract('  if (_jdone !== _wdDone)', '\n  if (firstFrame && now - _ldLast');
  const tick = now => { recovery.now = now; vm.runInContext(tickRecovery, recovery); };
  assert.equal(loader.terrainLoaderOutcome(false, 0, 0, 8001), 'timeout');
  tick(31001); assert.equal(recovery.resets, 1, '遮罩超时后仍应恢复');
  tick(61002); assert.equal(recovery.resets, 2, '允许第二次恢复');
  tick(91003); assert.equal(recovery.resets, 2, '恢复次数有上限');
  recovery._terrainResets = 0; recovery._terrainWatchdogStart = 1000; recovery._wdT = 1000;
  recovery._jdone = 1; tick(40000); assert.equal(recovery.resets, 2, '有进展不重建');
  for (const field of ['JOURNEY', 'CS', 'BH', 'DEEP']) {
    recovery._terrainRecoveryPending = true; recovery[field][field === 'JOURNEY' ? 'on' : 'active'] = true;
    tick(80000); assert.equal(recovery.resets, 2, field);
    assert.equal(recovery._terrainRecoveryPending, false, field);
    recovery[field][field === 'JOURNEY' ? 'on' : 'active'] = false;
  }
  recovery._terrainRecoveryPending = true; recovery.cam.focus = {}; tick(80000);
  assert.equal(recovery._terrainRecoveryPending, false, '离开地球终止启动恢复');
  recovery.cam.focus = recovery.EARTH; recovery._terrainRecoveryPending = true;
  recovery.visible = [{}]; recovery.buildQueue = []; recovery.inFlight = 0;
  tick(80000); assert.equal(recovery._terrainRecoveryPending, false, '超时后就绪终止恢复');
  assert.equal(recovery.resets, 2, '就绪后不能触发重建');
  assert.match(source, /if \(outcome === 'ready'\) _terrainRecoveryPending = false/);
  assert.match(source, /ctxLost = true;\s*_terrainRecoveryPending = false/);
  assert.match(source, /function setPlanetType\(key\) \{\s*if \([^\n]+\) return;\s*_terrainRecoveryPending = false/);
  assert.match(source, /function journeyStart\(i\) \{\s*_terrainRecoveryPending = false/);
  assert.match(source, /markStage\(outcome === 'ready' \? 'ready' : 'terrain-timeout'\)/);
  assert.match(source, /else showToast\('地形加载较慢/);
  assert.match(source, /ld\.dataset\.outcome = outcome/);
  const handlers = {}, start = { PT: { earthMap: true }, window: { addEventListener(type, cb) { handlers[type] = cb; } }, _bootRestored: false, _posPinned: false, EARTH: {}, picks: 0 };
  const vec = (x = 0, y = 0, z = 0) => ({ x, y, z, clone() { return vec(this.x, this.y, this.z); }, equals(v) { return this.x === v.x && this.y === v.y && this.z === v.z; } });
  start.cam = { focus: start.EARTH, dir: vec(1, 0, 0), shift: vec(), alt: 60, yaw: 0, pitch: -0.12 };
  start.pickStartPoint = () => { start.picks++; };
  vm.createContext(start);
  vm.runInContext(block.slice(0, block.indexOf('function pushEarthToWorker()')), start);
  const capture = () => vm.runInContext('pendingEarthStart = true; earthStartCamera = {focus: cam.focus, dir: cam.dir.clone(), shift: cam.shift.clone(), alt: cam.alt, yaw: cam.yaw, pitch: cam.pitch}', start);
  const select = () => vm.runInContext('selectEarthStartIfUntouched()', start);
  capture(); select();
  assert.equal(start.picks, 1);
  for (const flag of ['_bootRestored', '_posPinned']) {
    capture(); start[flag] = true; select(); start[flag] = false;
    assert.equal(start.picks, 1, flag);
  }
  for (const field of ['alt', 'yaw', 'pitch']) {
    capture(); start.cam[field]++; select(); start.cam[field]--;
    assert.equal(start.picks, 1, field);
  }
  for (const field of ['dir', 'shift']) {
    for (const axis of ['x', 'y', 'z']) {
      capture(); start.cam[field][axis]++; select(); start.cam[field][axis]--;
      assert.equal(start.picks, 1, field + '.' + axis);
    }
  }
  capture(); start.cam.focus = {}; select(); start.cam.focus = start.EARTH;
  assert.equal(start.picks, 1, 'focus');
  for (const type of ['pointerdown', 'wheel', 'keydown', 'touchstart']) {
    capture(); handlers[type](); select(); assert.equal(start.picks, 1, type);
  }
  start.JSTOP = [{}]; start.WARP = { active: false };
  for (const name of ['journeyStart', 'journeyGo', 'journeyApply']) {
    const journey = extract('function ' + name + '(', '\n}');
    const end = journey.indexOf('pendingEarthStart = false;');
    assert.notEqual(end, -1, name);
    start._terrainRecoveryPending = true;
    vm.runInContext(journey.slice(0, end + 'pendingEarthStart = false;'.length) + '\n}', start);
    capture(); vm.runInContext(name + '(0)', start); select();
    assert.equal(start.picks, 1, name);
  }
  assert.ok(source.indexOf('earthStartCamera = { focus: cam.focus') > source.indexOf('if (isFinite(_bootYaw)) cam.yaw = _bootYaw'));
  assert.doesNotMatch(block.slice(0, block.indexOf('function pushEarthToWorker()')), /\bJOURNEY\b/);
  vm.runInContext('loadEarthData()', context);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(toast, 1);
  assert.equal(picks, 0);
  assert.equal(context.PLANET_TYPES.earth.earthMap, false);
  assert.equal(context.terrainMat.uniforms.uEarthData.value, 0);
  attempt++;
  retry();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(failWorker, 1);
  assert.equal(ready, 1);
  assert.equal(toast, 1);
  assert.equal(picks, 0);
  assert.equal(context.PLANET_TYPES.earth.earthMap, true);
  assert.equal(context.terrainMat.uniforms.uEarthData.value, 1);

  let failedRetry, fallbackToast = 0, fallbackPicks = 0;
  const pickFailure = { ...context, EDATA: null, ECLIM: null, EBIOME: null, geoWorker: null,
    PLANET_TYPES: { earth: { earthMap: true } }, PT: { earthMap: true }, PTKey: 'earth',
    window: { addEventListener() {}, __ORBIT_INLINE__: { terrain: 't', climate: 'c' } },
    terrainMat: { uniforms: { uEarth: {}, uClim: {}, uBiome: {}, uEarthData: {} } },
    decodeB64Image: () => Promise.reject(Error('decode')),
    setTimeout: fn => { failedRetry = fn; return 1; },
    showToast: () => { fallbackToast++; },
    pickStartPoint: () => { fallbackPicks++; throw Error('选址失败'); },
    _bootRestored: false, _posPinned: false, EARTH: {} };
  pickFailure.cam = { focus: pickFailure.EARTH, dir: { equals: () => true }, shift: { equals: () => true }, alt: 60, yaw: 0, pitch: 0 };
  vm.createContext(pickFailure);
  vm.runInContext(block, pickFailure);
  vm.runInContext('earthStartCamera = {focus: cam.focus, dir: {}, shift: {}, alt: 60, yaw: 0, pitch: 0}; loadEarthData()', pickFailure);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(fallbackPicks, 1);
  assert.equal(fallbackToast, 1);
  assert.equal(vm.runInContext('EARTH_DATA_OK', pickFailure), true);
  assert.equal(pickFailure.PLANET_TYPES.earth.earthMap, false);
  assert.equal(pickFailure.terrainMat.uniforms.uEarthData.value, 0);
  assert.equal(typeof failedRetry, 'function');
  assert.equal(vm.runInContext('earthDataPromise', pickFailure), null);
  pickFailure.decodeB64Image = () => Promise.resolve(new Uint8Array([1]));
  pickFailure.cam.alt = 0;
  failedRetry();
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(pickFailure.EDATA);
  assert.equal(pickFailure.PLANET_TYPES.earth.earthMap, true);

  const timers = [];
  const hangingFetch = { ...context, EDATA: null, ECLIM: null, EBIOME: null,
    window: { addEventListener() {} }, geoWorker: null, PLANET_TYPES: { earth: { earthMap: true } },
    fetch: () => new Promise(() => {}), decodeB64Image: () => Promise.resolve(new Uint8Array([1])),
    setTimeout: fn => { timers.push(fn); return timers.length; }, clearTimeout() {} };
  vm.createContext(hangingFetch);
  vm.runInContext(block, hangingFetch);
  vm.runInContext('loadEarthData()', hangingFetch);
  assert.equal(timers.length, 2);
  timers.forEach(fn => fn());
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(hangingFetch.EDATA);

  let retryInit, initCount = 0, workerStopped = 0;
  const oldEarth = {}, oldClimate = {}, oldBiome = {};
  const initFailure = { ...context, EDATA: null, ECLIM: null, EBIOME: null,
    window: { addEventListener() {}, __ORBIT_INLINE__: { terrain: 't', climate: 'c', biome: 'b' } },
    PLANET_TYPES: { earth: { earthMap: true } }, PT: { earthMap: true },
    geoWorker: { postMessage() {} }, failTerrainWorker() { workerStopped++; initFailure.geoWorker = null; },
    terrainMat: { uniforms: { uEarth: { value: oldEarth }, uClim: { value: oldClimate }, uBiome: { value: oldBiome }, uEarthData: {} } },
    decodeB64Image: src => src.endsWith('b') ? Promise.reject(Error('biome')) : Promise.resolve(new Uint8Array([1])),
    makeDataTex: () => { if (++initCount === 2) throw Error('texture'); return { dispose() {} }; },
    setTimeout: fn => { retryInit = fn; return 1; }, clearTimeout() {} };
  vm.createContext(initFailure);
  vm.runInContext(block, initFailure);
  vm.runInContext('loadEarthData()', initFailure);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(initFailure.EDATA, null);
  assert.equal(initFailure.ECLIM, null);
  assert.equal(workerStopped, 1);
  assert.equal(initFailure.terrainMat.uniforms.uEarth.value, oldEarth);
  assert.equal(initFailure.terrainMat.uniforms.uClim.value, oldClimate);
  assert.equal(initFailure.PLANET_TYPES.earth.earthMap, false);
  retryInit();
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(initFailure.EDATA);
  assert.ok(initFailure.ECLIM);
  assert.equal(initFailure.EBIOME, null);
  assert.equal(initFailure.PLANET_TYPES.earth.earthMap, true);
  assert.equal(vm.runInContext('EARTH_DATA_OK', initFailure), true);
  assert.equal(initFailure.terrainMat.uniforms.uBiome.value, oldBiome);

  for (const sourceTask of ['earth', 'peaks', 'volcanoes']) {
    let stopped = 0, pumped = 0;
    const workerContext = { performance: { now: () => 0 }, _lastMsgT: 0, _wmsgs: 0, _mtask: {}, _werrs: 0,
      console, failTerrainWorker() { stopped++; }, pumpBuildQueue() { pumped++; } };
    vm.createContext(workerContext);
    vm.runInContext(extract('function onWorkerMsg(e)', '\nfunction failTerrainWorker(reason)'), workerContext);
    workerContext.onWorkerMsg({ data: { task: 'err', sourceTask, msg: 'init failed' } });
    assert.equal(stopped, 1);
    assert.equal(pumped, 1);
  }

  let terminated = 0, cleared = 0;
  const timedOutA = { key: 'a', terrainRetries: 0, queued: false, mesh: null, geo: null, stitchQueued: false, syncFallback: false };
  const timedOutB = { key: 'b', terrainRetries: 2, queued: false, mesh: {}, geo: {}, stitchQueued: false, syncFallback: false };
  const timeoutContext = {
    geoWorker: { terminate() { terminated++; } },
    TERRAIN_RETRY_LIMIT: 2,
    terrainRequests: new Map([[1, { p: timedOutA, timer: 11 }], [2, { p: timedOutB, timer: 12 }]]),
    pendingJobs: new Map([['a', timedOutA], ['b', timedOutB]]), buildQueue: [], _jobT: new Map(), inFlight: 2,
    clearTimeout(timer) { cleared += timer; }, VEG: { pending: true, pendT: 3 }, BLD: { pending: true, pendT: 4 }
  };
  vm.createContext(timeoutContext);
  vm.runInContext(extract('function failTerrainWorker(reason)', '\nfunction onWorkerErr'), timeoutContext);
  timeoutContext.failTerrainWorker('timeout');
  assert.equal(terminated, 1);
  assert.equal(cleared, 23);
  assert.equal(timedOutA.terrainRetries, 1);
  assert.equal(timedOutB.terrainRetries, 3);
  assert.equal(timedOutA.syncFallback, false);
  assert.equal(timedOutB.syncFallback, true);
  assert.equal(timeoutContext.buildQueue.length, 2);
  assert.equal(timeoutContext.terrainRequests.size, 0);
  assert.equal(timeoutContext.inFlight, 0);
  assert.equal(timeoutContext.VEG.pending, false);
  assert.equal(timeoutContext.BLD.pending, false);
  console.log('地球加载针对性测试通过');
}
main().catch(err => { console.error(err); process.exitCode = 1; });
