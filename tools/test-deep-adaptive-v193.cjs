'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const source = fs.readFileSync(path.join(__dirname, '../public/js/app.js'), 'utf8').replace(/\r\n/g, '\n');
const start = source.indexOf('function basePR() {');
const end = source.indexOf('\n\nconst scene =', start);
assert.ok(start >= 0 && end > start, 'source boundaries missing');
assert.equal(source.indexOf('function basePR() {', start + 1), -1, 'source boundary not unique');
const code = source.slice(start, end);

function env() {
  const calls = [];
  const details = { open: false, addEventListener(type, fn) { this[type] = fn; } };
  const status = { textContent: '' }, target = { value: 'm51' };
  const c = {
    devicePixelRatio: 2,
    SET: { auto: 1, q: 'high', sentinel: 'unchanged' },
    PERF: { on: true, scale: 0.72, ema: 19, cool: 7, acc: 3, slow: 4 },
    DEEP: { active: true, controller: { quality: 'interactive', getQuality() { return this.quality; } } },
    ctxLost: false, document: { hidden: false, getElementById(id) { return { deepPerfDetails: details, deepPerfStatus: status, deepModelTarget: target }[id]; } }, _screenshotBusy: false, _screenshotRecoveryRisk: false,
    renderer: { ratio: 1.5, getPixelRatio() { return this.ratio; }, setPixelRatio(v) { this.ratio = v; calls.push(v); } },
    qNow() { return { pr: c.SET.q === 'high' ? 1.5 : 1 }; },
    onResize() { calls.push('resize'); }
  };
  vm.createContext(c);
  vm.runInContext(code + '\nthis.state = DEEP_PERF; this.observation = deepObservation;', c, { filename: 'app.js:deep-adaptive' });
  return { c, calls, details, status, target };
}
function frames(c, n, ms) { for (let i = 0; i < n; i++) c.updateDeepPerf(ms); }
function near(a, b) { assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`); }
function snap(o) { return JSON.stringify(o); }
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('PASS ' + name); }
  catch (error) { failed++; console.error('FAIL ' + name + '\n' + error.stack); }
}

test('slow frames step down to 0.60 and fast frames recover', () => {
  const { c, calls } = env();
  const perf = snap(c.PERF), settings = snap(c.SET);
  frames(c, 500, 100);
  near(c.state.scale, 0.60); near(c.renderer.ratio, 0.9);
  const down = calls.filter(x => typeof x === 'number');
  assert.equal(down.length, 5);
  [0.92, 0.84, 0.76, 0.68, 0.60].forEach((v, i) => near(down[i], 1.5 * v));
  frames(c, 5000, 10);
  near(c.state.scale, 1); near(c.renderer.ratio, 1.5);
  const up = calls.filter(x => typeof x === 'number').slice(5);
  assert.equal(up.length, 10);
  up.forEach((v, i) => near(v, 1.5 * (0.64 + i * 0.04)));
  assert.equal(snap(c.PERF), perf); assert.equal(snap(c.SET), settings);
  assert.equal(calls.filter(x => x === 'resize').length, 15);
});

test('warmup, cooldown, observation window and hysteresis', () => {
  const { c } = env();
  frames(c, 3, 100); assert.equal(c.state.warmup, 0); assert.equal(c.state.samples, 0);
  frames(c, 6, 100); near(c.state.cool, 0.6); near(c.state.scale, 1);
  frames(c, 7, 100); near(c.state.cool, 0); near(c.state.scale, 1);
  frames(c, 7, 100); near(c.state.scale, 1);
  frames(c, 1, 100); near(c.state.scale, 0.92);
  assert.equal(c.state.samples, 0); assert.equal(c.state.warmup, 3); near(c.state.cool, 1.2);
  frames(c, 500, 25); near(c.state.scale, 0.92);
  frames(c, 2000, 10); near(c.state.scale, 1);
});

test('invalid values reset observations and warmup', () => {
  for (const bad of [NaN, Infinity, -Infinity, 0, -1]) {
    const { c } = env(); frames(c, 100, 100); const scale = c.state.scale;
    c.updateDeepPerf(bad);
    near(c.state.scale, scale); assert.equal(c.state.ema, null); assert.equal(c.state.samples, 0);
    assert.equal(c.state.warmup, 3); near(c.state.cool, 1.2);
    frames(c, 3, 100); assert.equal(c.state.samples, 0);
    c.updateDeepPerf(100); assert.equal(c.state.samples, 1);
  }
  const { c } = env(); frames(c, 3, 100); c.updateDeepPerf(3000);
  assert.equal(c.state.samples, 0); assert.equal(c.state.ema, null); near(c.state.cool, 1.2);
  c.updateDeepPerf(3000); assert.equal(c.state.samples, 1); assert.equal(c.state.ema, 1000); near(c.state.cool, 0.95);
});

test('warmup cannot consume the first formal long-gap exemption', () => {
  const { c } = env();
  c.updateDeepPerf(3000); frames(c, 3, 16);
  assert.equal(c.state.warmup, 0); assert.equal(c.state.longGaps, 0);
  c.updateDeepPerf(9000);
  assert.equal(c.state.samples, 0); assert.equal(c.state.ema, null);
});

test('isolated long pauses cannot by themselves cause a downgrade', () => {
  const { c, calls } = env();
  const perf = snap(c.PERF), settings = snap(c.SET);
  frames(c, 40, 16);
  const prior = { ema: c.state.ema, samples: c.state.samples, warmup: c.state.warmup, cool: c.state.cool };
  c.updateDeepPerf(3001);
  near(c.state.scale, 1); assert.equal(c.state.ema, prior.ema); assert.equal(c.state.samples, prior.samples);
  assert.equal(c.state.warmup, prior.warmup); near(c.state.cool, prior.cool);
  assert.equal(c.state.slowRun, 0);
  frames(c, 500, 16);
  for (let i = 0; i < 30; i++) { c.updateDeepPerf(9000); c.updateDeepPerf(16); }
  for (let i = 0; i < 30; i++) { c.updateDeepPerf(9000); c.updateDeepPerf(9000); c.updateDeepPerf(16); }
  frames(c, 500, 16);
  near(c.state.scale, 1); assert.equal(calls.filter(x => typeof x === 'number').length, 0);
  assert.equal(snap(c.PERF), perf); assert.equal(snap(c.SET), settings);
});

test('consecutive extreme frames eventually step down within a bounded number of frames', () => {
  for (const ms of [3001, 9000, Number.MAX_VALUE]) {
    const { c, calls } = env();
    const perf = snap(c.PERF), settings = snap(c.SET);
    c.updateDeepPerf(ms); near(c.state.scale, 1);
    frames(c, 120, ms);
    near(c.state.scale, 0.60); near(c.renderer.ratio, 0.9);
    assert.equal(calls.filter(x => typeof x === 'number').length, 5);
    assert.equal(snap(c.PERF), perf); assert.equal(snap(c.SET), settings);
    frames(c, 5000, 10); near(c.state.scale, 1); near(c.renderer.ratio, 1.5);
  }
});

test('mixed continuously slow intervals across long-gap boundaries still progress', () => {
  for (const sequence of [[3100, 2900], [3100, 200, 200, 200], [9000, 100, 100], [3000, 250, 251]]) {
    const { c } = env();
    for (let i = 0; i < 300; i++) c.updateDeepPerf(sequence[i % sequence.length]);
    near(c.state.scale, 0.60); near(c.renderer.ratio, 0.9);
  }
});

test('one long gap and short slow burst do not cause a late downgrade after recovery', () => {
  for (const gap of [2999, 3000, 3001, 9000]) {
    for (const burst of [0, 5, 8, 10]) {
      const { c } = env(); frames(c, 500, 16); c.updateDeepPerf(gap);
      frames(c, burst, 251); let prior = c.state.scale;
      for (let i = 0; i < 500; i++) {
        c.updateDeepPerf(16);
        assert.ok(c.state.scale + 1e-9 >= prior, `late downgrade for gap=${gap}, burst=${burst}, recoveryFrame=${i}`);
        prior = c.state.scale;
      }
    }
  }
});

test('explicit lifecycle reset prevents long-pause streaks from joining', () => {
  const { c } = env();
  for (let i = 0; i < 30; i++) {
    frames(c, 6, 9000);
    c.resetDeepPerf(false);
  }
  near(c.state.scale, 1); assert.equal(c.state.ema, null); assert.equal(c.state.samples, 0);
  frames(c, 500, 16); near(c.state.scale, 1);
});

test('background and screenshot lifecycle reset prevents joining guarded gaps', () => {
  for (const flag of ['hidden', 'screenshot', 'risk', 'context']) {
    const { c, calls } = env();
    frames(c, 6, 9000); near(c.state.scale, 1);
    if (flag === 'hidden') c.document.hidden = true;
    else if (flag === 'screenshot') c._screenshotBusy = true;
    else if (flag === 'risk') c._screenshotRecoveryRisk = true;
    else c.ctxLost = true;
    frames(c, 30, 9000); near(c.state.scale, 1);
    // Mirrors the explicit visibility, transaction or context lifecycle reset.
    c.resetDeepPerf(false);
    if (flag === 'hidden') c.document.hidden = false;
    else if (flag === 'screenshot') c._screenshotBusy = false;
    else if (flag === 'risk') c._screenshotRecoveryRisk = false;
    else c.ctxLost = false;
    frames(c, 6, 9000); near(c.state.scale, 1);
    assert.equal(calls.filter(x => typeof x === 'number').length, 0);
  }
});

test('auto off, PERF off and reference bypass adaptive scaling', () => {
  for (const disable of [c => { c.SET.auto = 0; }, c => { c.PERF.on = false; }, c => { c.DEEP.controller.quality = 'reference'; }]) {
    const { c } = env(); frames(c, 100, 100); assert.ok(c.state.scale < 1);
    disable(c); const settings = snap(c.SET), perf = snap(c.PERF);
    frames(c, 200, 100); near(c.state.scale, 1); near(c.renderer.ratio, 1.5);
    assert.equal(c.state.samples, 0); assert.notEqual(c.deepPerfInfo().mode, 'adaptive');
    assert.equal(c.deepPerfInfo().effectiveScale, 1);
    assert.equal(snap(c.SET), settings); assert.equal(snap(c.PERF), perf);
  }
});

test('busy, recovery risk, context loss and hidden do not sample', () => {
  const blockers = [
    c => { c._screenshotBusy = true; }, c => { c._screenshotRecoveryRisk = true; },
    c => { c.ctxLost = true; }, c => { c.document.hidden = true; }, c => { c.DEEP.active = false; }
  ];
  for (const block of blockers) {
    const { c, calls } = env(); frames(c, 20, 100);
    block(c); const before = snap(c.state), count = calls.length;
    frames(c, 100, 100); assert.equal(snap(c.state), before); assert.equal(calls.length, count);
  }
});

test('quality and device DPR changes reset observations and apply new ratio', () => {
  const { c } = env(); frames(c, 100, 100); const scale = c.state.scale;
  c.SET.q = 'mid'; c.updateDeepPerf(100);
  near(c.state.scale, scale); near(c.renderer.ratio, scale); assert.equal(c.state.warmup, 2); assert.equal(c.state.samples, 0);
  c.devicePixelRatio = 0.8; c.updateDeepPerf(100);
  near(c.renderer.ratio, 0.8 * scale); assert.equal(c.state.warmup, 2); assert.equal(c.state.samples, 0);
  c.devicePixelRatio = 3; c.updateDeepPerf(100); near(c.renderer.ratio, scale);
});

test('active and inactive DPR, thresholds and diagnostic values', () => {
  const { c, calls } = env(); c.state.scale = 0.6;
  near(c.desiredRenderPR(), 0.9); c.applyRenderScale(); near(c.renderer.ratio, 0.9);
  const info = c.deepPerfInfo(); assert.equal(info.mode, 'adaptive'); near(info.effectiveScale, 0.6); near(info.pixelRatio, 0.9);
  c.DEEP.active = false; near(c.desiredRenderPR(), 1.08); c.applyRenderScale(); near(c.renderer.ratio, 1.08);
  assert.equal(c.deepPerfInfo().mode, 'inactive'); assert.equal(c.deepPerfInfo().effectiveScale, 1);
  const count = calls.length; c.renderer.ratio = 1.07; c.applyRenderScale(); assert.equal(calls.length, count);
  c.applyRenderScale(true); near(c.renderer.ratio, 1.08); assert.equal(calls.length, count + 2);
  c.DEEP.active = true; c.renderer.ratio = 0.901; c.applyRenderScale(); near(c.renderer.ratio, 0.9);
});

test('diagnostic samples real intervals independently in reference and auto-off modes', () => {
  for (const mode of ['reference', 'disabled']) {
    const { c, details, status } = env();
    if (mode === 'reference') c.DEEP.controller.quality = 'reference'; else c.SET.auto = 0;
    details.open = true; details.toggle();
    c.observeDeepFrame(1000); c.observeDeepFrame(1016); c.observeDeepFrame(1032);
    assert.match(status.textContent, /数据不足/);
    c.observeDeepFrame(1300);
    assert.equal(c.observation.samples, 3);
    assert.match(status.textContent, new RegExp(mode));
    assert.doesNotMatch(status.textContent, /数据不足/);
    assert.ok(c.observation.ema > 16);
  }
});

test('diagnostic reset on close, scene and mode changes, gaps and hidden frames', () => {
  const { c, details, status, target } = env();
  details.open = true; details.toggle();
  for (let t = 1000; t <= 1400; t += 100) c.observeDeepFrame(t);
  assert.equal(c.observation.samples, 4);
  target.value = 'm42'; c.observeDeepFrame(1500);
  assert.equal(c.observation.samples, 0); assert.match(status.textContent, /数据不足/);
  c.observeDeepFrame(1600); c.SET.auto = 0; c.observeDeepFrame(1700);
  assert.equal(c.observation.samples, 0);
  c.observeDeepFrame(1800); c.observeDeepFrame(4800);
  assert.equal(c.observation.samples, 0); assert.match(status.textContent, /数据不足/);
  c.document.hidden = true; c.observeDeepFrame(4900); assert.equal(c.observation.last, null);
  c.document.hidden = false; c.observeDeepFrame(5000); assert.equal(c.observation.samples, 0);
  details.open = false; details.toggle(); assert.equal(c.observation.last, null);
  details.open = true; details.toggle(); c.observeDeepFrame(5100); assert.equal(c.observation.samples, 0);
});

test('view preserves observations; dust, quality, model and close reset as appropriate', () => {
  const binding = source.slice(source.indexOf('(function bindDeepModels() {'));
  const view = binding.match(/setView\(v\) \{[^\n]+/)[0];
  assert.doesNotMatch(view, /resetDeepObservation|resetDeepPerf/);
  assert.match(binding, /setDust\(on\).*resetDeepObservation\(\)/);
  assert.doesNotMatch(binding.match(/setDust\(on\) \{[^\n]+/)[0], /resetDeepPerf/);
  assert.match(binding, /setQuality\(mode\)[\s\S]*?resetDeepPerf\(true\)/);
  assert.match(binding, /DEEP\.active = true;[\s\S]*?resetDeepPerf\(true\)/);
  assert.match(binding, /DEEP\.active = false;[\s\S]*?resetDeepPerf\(true\);[\s\S]*?applyRenderScale\(true\)/);
  const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  assert.match(html, /body\.deep-model[^\n]*#perfpanel\s*\{\s*display:none\s*!important/);
  assert.match(html, /主场景 · 最近采样/);
});

test('only animation DEEP branch invokes updateDeepPerf', () => {
  const occurrences = [...source.matchAll(/\bupdateDeepPerf\s*\(/g)];
  assert.equal(occurrences.length, 2, 'expected one declaration and one call');
  const loop = source.indexOf('renderer.setAnimationLoop(() => {');
  const branch = source.indexOf('if (DEEP && DEEP.active) {', loop);
  const nextBranch = source.indexOf('if (BH.active)', branch);
  assert.ok(loop >= 0 && branch > loop && nextBranch > branch);
  const body = source.slice(branch, nextBranch);
  assert.match(body, /updateDeepPerf\(rawMs\);[\s\S]*?DEEP\.controller\.update\(\);[\s\S]*?return;/);
  assert.ok(occurrences[1].index >= branch && occurrences[1].index < nextBranch);
});

console.log(`RESULT ${passed} PASS, ${failed} FAIL`);
if (failed) process.exitCode = 1;
