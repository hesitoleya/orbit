'use strict';
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync(require('node:path').join(__dirname, '../public/js/app.js'), 'utf8');
const section = (a, b) => source.slice(source.indexOf(a), source.indexOf(b, source.indexOf(a)));
async function scenario(fail) {
  let resolveImage, rejectImage, calls = 0, ready = 0, toast = 0;
  const image = new Promise((resolve, reject) => { resolveImage = resolve; rejectImage = reject; });
  const ctx = { Promise, AbortController, console, setTimeout: () => 1, clearTimeout: () => {}, window: { __ORBIT_ASSET_BASE__: '/data/' },
    fetch: async () => ({ ok: true, json: async () => ({}) }),
    decodeB64Image: () => { calls++; return image; },
    EW: 1, EH: 1, ECW: 1, ECH: 1, EBW: 1, EBH: 1,
    setPeaks: () => 0, setVolcanoes: () => {}, PEAKS: [], VOLCANOES: [], geoWorker: null,
    onEarthDataReady: () => { ready++; }, selectEarthStartIfUntouched: () => {}, terrainMat: { uniforms: { uEarthData: {} } }, pickStartPoint: () => {}, showToast: () => { toast++; } };
  vm.createContext(ctx);
  vm.runInContext(`let EDATA=null,ECLIM=null,EBIOME=null,EARTH_DATA_OK=true;
    const PLANET_TYPES={earth:{earthMap:true},mars:{earthMap:false}};
    let PTKey='mars',PT=PLANET_TYPES.mars;
    ${section('let earthDataPromise = null;', 'if (PT.earthMap) loadEarthData();')}
    function switchTo(k) { PTKey=k; PT=PLANET_TYPES[k]; if(PT.earthMap && !EDATA) { EARTH_DATA_OK=false; loadEarthData(); } else EARTH_DATA_OK=true; }
    function state(){return {earth:PLANET_TYPES.earth.earthMap,mars:PLANET_TYPES.mars.earthMap,ok:EARTH_DATA_OK,data:!!EDATA};}`, ctx);
  vm.runInContext("switchTo('earth');switchTo('mars');switchTo('earth');switchTo('mars')", ctx);
  assert.equal(calls, 3, '并发切换应只发起一次解码');
  if (fail) rejectImage(Error('解码失败')); else resolveImage(new Uint8Array([1]));
  await vm.runInContext('earthDataPromise', ctx);
  const state = vm.runInContext('state()', ctx);
  assert.equal(state.mars, false, '不能改变其他行星类型');
  assert.equal(state.earth, !fail);
  assert.equal(state.data, !fail);
  assert.equal(ready, fail ? 0 : 1);
  assert.equal(toast, 0, '离开地球后失败不应提示当前行星');
}
function testInvalidation() {
  const ctx = { VEG: {seq: 7, appliedSeq: 2, ready: true, pending: true}, BLD: {seq: 9, appliedSeq: 1, ready: true, pending: true} };
  vm.createContext(ctx);
  vm.runInContext(section('function invalidateVeg()', 'function applyVeg(') + section('function invalidateBuild()', 'function requestBld('), ctx);
  vm.runInContext('invalidateVeg();invalidateBuild()', ctx);
  assert.equal(ctx.VEG.appliedSeq, 7); assert.equal(ctx.BLD.appliedSeq, 9);
  assert.equal(ctx.VEG.pending, false); assert.equal(ctx.BLD.pending, false);
  const switchBody = section('function setPlanetType(key)', 'const elDate =');
  assert.match(switchBody, /invalidateVeg\(\)/); assert.match(switchBody, /invalidateBuild\(\)/);
}
Promise.all([scenario(false), scenario(true)]).then(() => { testInvalidation(); console.log('行星加载及失效独立测试通过'); }).catch(e => { console.error(e); process.exitCode = 1; });
