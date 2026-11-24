'use strict';

// 仅在 Node VM 中执行从 app.js 原样截取的函数；不启动浏览器或服务。
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const sourceBytes = fs.readFileSync(path.join(root, 'public/js/app.js'));
const source = sourceBytes.toString('utf8').replace(/\r\n/g, '\n');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const build = source.match(/const BUILD = '([^']+)'/);
assert.ok(build, '未找到 BUILD');
console.log(`BUILD=${build[1]} package=${pkg.version} app.js sha256=${crypto.createHash('sha256').update(sourceBytes).digest('hex')}`);
function section(start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, `源码边界不存在: ${start}`);
  assert.equal(source.indexOf(start, a + start.length), -1, `源码边界不唯一: ${start}`);
  return source.slice(a, b);
}
const code = [
  section('function basePR() {', '\n\nconst scene ='),
  section('function applyQuality(key, force) {', '\n/* 对话 98：星图入口。'),
  section("const QORDER = ['ultra', 'high', 'mid', 'low'];", '\n\n/* 关窗/切后台也存一次 */')
].join('\n');
function makeEnv({on = true, q = 'high', cool = 0, first = false, now = 20000, dpr = 2} = {}) {
  const calls = {resize: 0, saves: 0, toast: [], pr: [], buttons: [], stats: 0};
  const quality = {
    ultra: {pr: 2, csteps: 40, cirsteps: 8, cirlight: 2, shres: 1024, veg: 1, bld: 1, label: 'ultra'},
    high: {pr: 1.5, csteps: 40, cirsteps: 8, cirlight: 2, shres: 1024, veg: 1, bld: 1, label: 'high'},
    mid: {pr: 1, csteps: 40, cirsteps: 8, cirlight: 2, shres: 1024, veg: 0.6, bld: 0.6, label: 'mid'},
    low: {pr: 0.8, csteps: 40, cirsteps: 8, cirlight: 2, shres: 1024, veg: 0.3, bld: 0.3, label: 'low'}
  };
  const ctx = {
    SET: {q, auto: on ? 1 : 0}, QUALITY: quality, DEEP: null,
    document: {getElementById(id) {return id === 'deepPerfDetails' ? {open: false, addEventListener() {}} : {textContent: ''};}},
    PERF: {on, ema: 16.7, scale: 1, cool, acc: 0, slow: 0, fps: 0, bootT: 0},
    firstFrame: first, performance: {now: () => now}, devicePixelRatio: dpr,
    renderer: {ratio: Math.min(dpr, quality[q]?.pr || 1), getPixelRatio() {return this.ratio;}, setPixelRatio(v) {this.ratio = v; calls.pr.push(v);}},
    qNow() {return quality[ctx.SET.q];}, onResize() {calls.resize++;}, saveSet() {calls.saves++;},
    showToast(s) {calls.toast.push(s);}, cloudStepsNow: 40, cirrusStepsNow: 8, cirrusLightNow: 2, SHADOW_RES: 1024,
    _cloudQ: new URLSearchParams(), _atmoQ: new URLSearchParams(), params: new URLSearchParams(),
    VEG: {on: true, ready: true}, BLD: {on: false}, FAC: {}, STAR_LOD: {value: 1},
    qBtns: [{dataset: {q: 'mid'}, classList: {toggle(...args) {calls.buttons.push(args);}}}],
    refreshPerfStat() {calls.stats++;}, invalidateBuild() {throw Error('unexpected invalidateBuild');}
  };
  vm.createContext(ctx); vm.runInContext(code, ctx, {filename: 'app.js:extracted'});
  return {ctx, calls};
}
let passed = 0, failed = 0;
function test(name, fn) {
  try { const evidence = fn(); passed++; console.log(`PASS ${name}${evidence ? ' ' + JSON.stringify(evidence) : ''}`); }
  catch (e) { failed++; console.error(`FAIL ${name}: ${e.stack}`); }
}
function near(a, b, eps = 1e-9) {assert.ok(Math.abs(a-b) < eps, `${a} != ${b}`);}
function frames(ctx, n, ms, dt = 0.08) {for (let i = 0; i < n; i++) ctx.updatePerf(ms, dt);}
test('auto=0 不调整但统计继续更新', () => {
  const {ctx, calls} = makeEnv({on: false}); frames(ctx, 100, 100);
  assert.equal(ctx.PERF.scale, 1); assert.equal(ctx.PERF.cool, 0); assert.equal(calls.pr.length, 0);
  assert.ok(ctx.PERF.ema > 24 && ctx.PERF.fps > 0);
  return {scale: ctx.PERF.scale, ema: ctx.PERF.ema, fps: ctx.PERF.fps};
});
test('启动窗口、冷却单帧上限及 dt 无关', () => {
  const a = makeEnv({first: true, now: 14999, cool: 1}).ctx;
  a.updatePerf(1000, 0.08); assert.equal(a.PERF.cool, 1); near(a.PERF.ema, 27.797);
  const b = makeEnv({first: true, now: 15000, cool: 1}).ctx;
  b.updatePerf(1000, 0.001); near(b.PERF.cool, 0.5); b.updatePerf(1000, 100); near(b.PERF.cool, 0);
  assert.equal(b.PERF.acc, 0); b.updatePerf(1000, 0); near(b.PERF.scale, 0.94);
  return {emaClamped: a.PERF.ema, cooldownAfterTwoFrames: b.PERF.cool, nextScale: b.PERF.scale};
});
test('持续慢帧降至 0.8 并调整像素比', () => {
  const {ctx, calls} = makeEnv(); frames(ctx, 20, 100);
  near(ctx.PERF.scale, 0.8); near(ctx.renderer.ratio, 1.2); assert.equal(calls.pr.length, 4); assert.equal(calls.saves, 0);
  return {scale: ctx.PERF.scale, ratio: ctx.renderer.ratio, adjustments: calls.pr};
});
test('连续快帧逐步恢复到 1', () => {
  const {ctx, calls} = makeEnv(); ctx.PERF.scale = 0.8; ctx.renderer.ratio = 1.2; ctx.PERF.ema = 10;
  frames(ctx, 700, 10); near(ctx.PERF.scale, 1); near(ctx.renderer.ratio, 1.5);
  return {scale: ctx.PERF.scale, ratio: ctx.renderer.ratio, adjustments: calls.pr.length};
});
test('自动降档执行真实 applyQuality 的全局副作用', () => {
  const {ctx, calls} = makeEnv(); frames(ctx, 45, 100);
  assert.equal(ctx.SET.q, 'mid'); assert.equal(ctx.PERF.scale, 1); near(ctx.PERF.cool, 1.5);
  assert.equal(calls.saves, 1); assert.equal(calls.toast.length, 1); assert.equal(ctx.VEG.denMul, 0.6);
  assert.equal(ctx.VEG.ready, false); assert.equal(ctx.BLD.denMul, 0.6); assert.equal(ctx.FAC.den, 0.6);
  near(ctx.STAR_LOD.value, 0.62); near(ctx.renderer.ratio, 1); assert.equal(calls.stats, 1);
  return {quality: ctx.SET.q, scale: ctx.PERF.scale, cool: ctx.PERF.cool, saved: calls.saves, pixelRatio: ctx.renderer.ratio, veg: ctx.VEG.denMul, starLOD: ctx.STAR_LOD.value, toast: calls.toast[0]};
});
test('最低档与未知档不再降档', () => {
  for (const q of ['low', 'unknown']) {const {ctx, calls} = makeEnv({q}); ctx.PERF.slow = 5; ctx.PERF.scale = 0.8; ctx.autoStepDown(); assert.equal(ctx.PERF.slow, 0); near(ctx.PERF.scale, 0.8); assert.equal(calls.saves, 0);}
});
test('像素比变化不大于 0.02 时不重设', () => {
  const {ctx, calls} = makeEnv(); ctx.renderer.ratio = 1.49; ctx.applyRenderScale(); assert.equal(calls.pr.length, 0); assert.equal(calls.resize, 0);
  ctx.renderer.ratio = 1.47; ctx.applyRenderScale(); assert.equal(calls.pr.length, 1); assert.equal(calls.resize, 1);
});
test('DEEP 使用独立策略，BH、CS 仍提前返回的有界源码断言', () => {
  const loop = section('renderer.setAnimationLoop(() => {', '\n  else updatePerf(rawMs, dt);');
  assert.match(loop, /if \(DEEP && DEEP\.active\) \{[\s\S]*?updateDeepPerf\(rawMs\);[\s\S]*?renderFrame\(DEEP\.controller\.scene, DEEP\.controller\.camera\);[\s\S]*?return;\s*\}/);
  assert.match(loop, /if \(BH\.active\) \{[^\n]*bhFrame\(now\); return; \}/);
  assert.match(loop, /if \(CS\.active\) \{[\s\S]*?renderFrame\(CS\.scene, CS\.cam\);\s*return;\s*\}/);
  return {kind: '静态断言，非浏览器端到端'};
});
console.log(`结果: ${passed} PASS, ${failed} FAIL；仅读取源码和 package.json，不写入输出文件、不启动浏览器或服务。`);
if (failed) process.exitCode = 1;
