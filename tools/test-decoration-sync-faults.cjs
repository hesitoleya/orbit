const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const source = fs.readFileSync(require('path').join(__dirname, '../public/js/app.js'), 'utf8');
function extract(start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  assert(a >= 0 && b > a);
  return source.slice(a, b);
}
const code = [
  extract('function requestVeg()', 'const _vegPos ='),
  extract('const _bd =', 'const _bldPos =')
].join('\n');
function run(kind, failure, failures, worker = false) {
  let calls = 0, writes = 0;
  const vec = () => ({ set() { return this; }, copy() { return this; }, multiplyScalar() { return this; } });
  const state = { on: true, pending: false, ready: false, seq: 0, appliedSeq: 0, pendT: 0, retryCount: 0, retryNeeded: false, rings: [], grassOn: false, denMul: 1, anchorDir: vec(), anchorPos: vec() };
  const mesh = () => ({ instanceMatrix: { array: { set() { writes++; if (failure === 'apply' && writes <= failures) throw Error('apply fault'); } } }, geometry: { attributes: { aVar: { array: { set() {} } }, aB: { array: { set() {} } } } } });
  const result = job => {
    calls++;
    if (failure === 'scatter' && calls <= failures) throw Error('scatter fault');
    const d = { key: job.key, ax: 1, ay: 0, az: 0, counts: [1] };
    d.m0 = new Float32Array(16); d.v0 = new Float32Array(2); d.b0 = new Float32Array(4);
    return d;
  };
  const earth = {};
  const ctx = { VEG: state, BLD: state, FLY: { on: false }, cam: { focus: earth, dir: { x: 1, y: 0, z: 0 } }, EARTH: earth, PT: {}, EARTH_DATA_OK: true, performance: { now: () => 10 }, TERRAIN_RETRY_LIMIT: 2, R_EARTH: 1, VEG_CAP: [1, 1, 1, 1], BLD_CAP: [1], BLD_TYPES: 1, vegMeshes: Array.from({ length: 4 }, mesh), bldMeshes: [mesh()], FAC: {}, HILL_FIX: {}, _shLastCenter: vec(), scatterVeg: result, scatterBuild: result, geoWorker: worker ? { postMessage(job) { calls++; if (calls <= failures) throw Error('post fault'); } } : null };
  vm.createContext(ctx);
  vm.runInContext(code + '\nthis.request = ' + (kind === 'veg' ? 'requestVeg' : 'requestBld') + '; this.stats = ' + (kind === 'veg' ? '_vd' : '_bd') + ';', ctx);
  ctx.request();
  return { state, ctx, calls: () => calls, writes: () => writes };
}
for (const kind of ['veg', 'build']) {
  for (const fault of ['scatter', 'apply']) {
    const recovered = run(kind, fault, 2);
    assert.equal(recovered.state.pending, false);
    assert.equal(recovered.state.ready, true);
    assert.equal(recovered.state.retryCount, 0);
    assert.equal(recovered.state.retryNeeded, false);
    assert.equal(recovered.state.appliedSeq, 3);
    assert.equal(recovered.ctx.stats.ok, 1);
    const exhausted = run(kind, fault, Infinity);
    assert.equal(exhausted.state.seq, 3);
    assert.equal(exhausted.state.pending, false);
    assert.equal(exhausted.state.pendT, 0);
    assert.equal(exhausted.state.retryCount, 3);
    assert.equal(exhausted.state.retryNeeded, true);
    assert.equal(exhausted.state.appliedSeq, 0);
    assert.match(exhausted.ctx.stats.err, /fault/);
    for (let i = 0; i < 10; i++) exhausted.ctx.request();
    assert.equal(exhausted.state.seq, 3);
  }
  const post = run(kind, 'post', Infinity, true);
  assert.equal(post.calls(), 3);
  assert.equal(post.state.retryCount, 3);
  assert.equal(post.state.pending, false);
}
console.log('同步植被与建筑故障注入测试通过');
