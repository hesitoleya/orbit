'use strict';
/* Execute the actual inline controller in a VM with fake DOM/timers/rAF.
 * No browser, network, GUI, profiles, asset writes or production rebuild. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public/rh-v4-bounded-validation.html'), 'utf8');
const matches = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
assert.equal(matches.length, 1);
const code = matches[0][1];
new vm.Script(code);
const urls = ['/rh-candidate-preview-v4.html', '/js/rh-candidate-preview-v4.js'];
const resources = new Map(urls.map(url => [url, fs.readFileSync(path.join(root, 'public', url))]));
class Events {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, fn) { if (!this.listeners.has(type)) this.listeners.set(type, []); this.listeners.get(type).push(fn); }
  emit(type, event = {}) { return (this.listeners.get(type) || []).map(fn => fn(event)); }
}
class Matrix {
  constructor(values) { this.elements = values ? [...values] : [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]; }
  toArray() { return [...this.elements]; }
  clone() { return new Matrix(this.elements); }
  multiply(other) {
    const a = this.elements, b = other.elements, out = new Array(16).fill(0);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) out[c*4+r] += a[k*4+r]*b[c*4+k];
    this.elements = out; return this;
  }
}
class Camera { constructor() { this.projectionMatrix = new Matrix(); } }
function fixture(options = {}) {
  let now = 0, next = 1, seekCount = 0, stopCount = 0, appFrame = 100;
  const timers = new Map(), rafs = new Map(), nodes = new Map();
  const fetchCalls = [];
  let releaseFetch = null, releaseBody = null, signalDeferred;
  const deferredReady = new Promise(resolve => { signalDeferred = resolve; });
  const location = new URL('http://127.0.0.1:8169/rh-v4-bounded-validation.html');
  const candidateURL = new URL('/rh-candidate-preview-v4.html?fresh=1&candidateHold=1&auto=0', location).href;
  const doc = new Events(), childDoc = new Events(), win = new Events(), child = new Events();
  doc.visibilityState = childDoc.visibilityState = 'visible';
  doc.hasFocus = childDoc.hasFocus = () => true;
  doc.getElementById = id => { if (!nodes.has(id)) nodes.set(id, Object.assign(new Events(), { disabled: true, textContent: '' })); return nodes.get(id); };
  doc.createElement = () => ({ click() {} });
  childDoc.title = 'EXPERIMENTAL RH CANDIDATE — SPACE·1:1';
  childDoc.querySelectorAll = () => [{ src: new URL('/js/rh-candidate-preview-v4.js', location).href }];
  const r = { generation: 0, first: null, entry: null, restores: [], errors: [],
    validate: () => ({ status: 'passed-limited', checks: { fixture: true }, measurements: { synthetic: true } }),
    cineTimeAtLg: n => n };
  const journey = { on: false, cine: true, cs: false, lg: 7.23 };
  const cs = { upCur: null, cam: { fov: 55, aspect: 2, near: .01, far: 1e9,
    projectionMatrix: new Matrix(), projectionMatrixInverse: new Matrix() }, mwReal: { visible: true },
    mwRealMat: { opacity: .7, map: { repeat: { toArray: () => [-1, 1] }, offset: { toArray: () => [1, 0] }, image: { width: 10, height: 10 } } } };
  const s = { CS: cs, THREE: { Matrix4: Matrix, PerspectiveCamera: Camera }, build: 'v198', ctxLost: false,
    get journeyInfo() { return { ...journey }; },
    journey() { Object.assign(journey, { on: true, cs: false, lg: 7.23 }); return true; },
    journeyStop() {
      stopCount++; const was = journey.on; journey.on = false; cs.upCur = null;
      if (was && r.entry) r.restores.push({ reason: 'stop', frame: appFrame++, projection: cs.cam.projectionMatrix.toArray(), inverse: cs.cam.projectionMatrixInverse.toArray() });
      return was;
    },
    journeySeek(lg) { seekCount++; journey.lg = lg; journey.cs = true; return { lg, cs: true }; }
  };
  const setTimer = (fn, ms, interval) => { const id = next++; timers.set(id, { fn, ms, due: now + ms, interval }); return id; };
  child.document = childDoc; child.location = { href: candidateURL }; child.__SE = s; child.__RH_CANDIDATE__ = r;
  child.__rhInternals = { MWGC_LIST: new Array(144) }; child.innerWidth = 1542; child.innerHeight = 664; child.devicePixelRatio = 1.25;
  child.navigator = { serviceWorker: { controller: null } };
  child.requestAnimationFrame = fn => { const id = next++; rafs.set(id, fn); return id; };
  child.cancelAnimationFrame = id => rafs.delete(id);
  const frame = doc.getElementById('scene'); frame.contentWindow = child;
  const context = vm.createContext({ document: doc, window: win, location, URL, Blob,
    crypto: crypto.webcrypto, Uint8Array, Date, performance: { now: () => now },
    setTimeout: (fn, ms) => setTimer(fn, ms, false), clearTimeout: id => timers.delete(id),
    setInterval: (fn, ms) => setTimer(fn, ms, true), clearInterval: id => timers.delete(id),
    fetch: async url => {
      fetchCalls.push(url);
      if (options.deferFetch && fetchCalls.length === 1) await new Promise(resolve => { releaseFetch = resolve; signalDeferred(); });
      const original = resources.get(url), data = options.badHash ? Buffer.from('wrong candidate') : original;
      return { ok: true, status: 200, url: new URL(url, location).href,
        arrayBuffer: async () => {
          if (options.deferBody && fetchCalls.length === 1) await new Promise(resolve => { releaseBody = resolve; signalDeferred(); });
          return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
        } };
    }
  });
  vm.runInContext(code, context);
  const evaluate = text => vm.runInContext(text, context);
  const api = {
    s, r, journey, cs, child, childDoc, doc, win, nodes, frame, evaluate, fetchCalls, deferredReady,
    elapseWithoutTimers(ms) { now += ms; },
    releaseFetch() { assert(releaseFetch); releaseFetch(); },
    releaseBody() { assert(releaseBody); releaseBody(); },
    get report() { return JSON.parse(evaluate('JSON.stringify(report)')); },
    get phase() { return evaluate('phase'); },
    get stopCount() { return stopCount; }, get seekCount() { return seekCount; },
    load: async () => { await Promise.all(frame.emit('load')); },
    click: id => nodes.get(id).onclick(),
    tickRaf() { const batch = [...rafs.values()]; rafs.clear(); for (const fn of batch) fn(now); },
    watchdog() { for (const timer of [...timers.values()]) if (timer.interval) timer.fn(); },
    advance(ms) {
      now += ms;
      const due = [...timers.entries()].filter(([, t]) => t.due <= now);
      for (const [id, timer] of due) {
        if (!timers.has(id)) continue;
        if (timer.interval) timer.due = now + timer.ms; else timers.delete(id);
        timer.fn();
      }
    },
    complete(patch) {
      appFrame += 10; r.generation++;
      r.entry = { mainFrame: appFrame - 1, mainLg: 19.999, mainForward: [1,0,0] };
      r.first = { frame: appFrame, sourceFrame: appFrame - 1, lg: 20.001, completed: true };
      Object.assign(journey, { cs: true, lg: 20.001 });
      if (patch) patch(api);
    },
    handoff() { this.complete(); this.tickRaf(); this.tickRaf(); this.tickRaf(); },
    toStop() { this.click('first'); this.handoff(); this.click('lg21'); this.tickRaf(); this.tickRaf(); },
    toSecond() { this.toStop(); this.click('stop'); this.click('second'); },
    assertFailed(pattern) {
      assert.equal(this.report.status, 'failed');
      assert.match(this.report.errors.map(x => x.message).join('\n'), pattern);
      for (const id of ['first','lg21','stop','second','finish']) assert.equal(nodes.get(id).disabled, true);
      assert(this.report.steps.some(x => x.step === 'failure-before-cleanup'));
      assert.equal(this.report.cleanup.length, 1);
    }
  };
  return api;
}
let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log('PASS ' + name); }
(async () => {
  await test('visible parent event before iframe load is recorded and boot continues', async () => {
    const f = fixture(); f.doc.emit('visibilitychange');
    assert.equal(f.report.status, 'loading'); assert.equal(f.report.events.length, 1);
    assert.equal(f.report.events[0].environment.parentVisibility, 'visible');
    assert.equal(f.report.events[0].environment.iframeVisibility, null);
    assert.equal(f.nodes.get('first').disabled, true);
    await f.load(); assert.equal(f.report.status, 'ready'); assert.equal(f.nodes.get('first').disabled, false);
  });
  await test('hidden parent before load fails with useful snapshot and cannot recover via late load', async () => {
    const f = fixture(); f.doc.visibilityState = 'hidden'; f.doc.emit('visibilitychange');
    f.assertFailed(/页面隐藏/); const report = f.report;
    assert.equal(report.errors[0].phase, 'loading');
    const before = report.steps.find(x => x.step === 'failure-before-cleanup').result;
    assert.equal(before.candidateReady, false); assert.equal(before.environment.parentVisibility, 'hidden');
    assert.equal(before.environment.iframeVisibility, null); assert.equal(before.collectionError, undefined);
    assert.equal(report.cleanup[0].attempted, false); assert.equal(f.stopCount, 0);
    f.doc.visibilityState = 'visible'; f.doc.emit('visibilitychange'); await f.load(); f.advance(30000);
    assert.equal(JSON.stringify(f.report), JSON.stringify(report)); assert.equal(f.fetchCalls.length, 0);
  });
  await test('pre-load timeout snapshot preserves environment without null exception', async () => {
    const f = fixture(); f.advance(15000); f.assertFailed(/加载超过15秒/);
    const snap = f.report.steps.find(x => x.step === 'failure-before-cleanup').result;
    assert.equal(snap.candidateReady, false); assert.equal(snap.environment.parentVisibility, 'visible');
    assert.equal(snap.elapsedSinceLoadStartMs, 15000); assert.equal(snap.collectionError, undefined);
  });
  await test('hidden iframe at load fails despite visible parent', async () => {
    const f = fixture(); f.childDoc.visibilityState = 'hidden'; await f.load(); f.assertFailed(/页面隐藏/);
    assert.equal(f.report.identity, null); assert.equal(f.fetchCalls.length, 0);
  });
  await test('visibility loss during pending identity fails and late response cannot revive', async () => {
    const f = fixture({ deferFetch: true }); const loading = f.load(); await f.deferredReady;
    f.doc.visibilityState = 'hidden'; f.doc.emit('visibilitychange'); f.assertFailed(/页面隐藏/);
    const snapshot = JSON.stringify(f.report); f.releaseFetch(); await loading;
    assert.equal(JSON.stringify(f.report), snapshot); assert.equal(f.fetchCalls.length, 1);
  });
  await test('actual HTML/JS hashes, module URL and hold configuration checked', async () => {
    const f = fixture(); await f.load(); assert.equal(f.phase, 'ready'); assert.equal(f.report.identity.resources.length, 2);
    assert(f.report.identity.resources.every(x => x.matched)); assert.equal(f.report.identity.candidateHoldConfigured, true);
  });
  await test('full synthetic lifecycle uses new evidence twice and fresh stop records', async () => {
    const f = fixture(); await f.load(); f.toSecond(); f.handoff(); f.click('finish');
    assert.equal(f.report.status, 'passed-limited'); assert.equal(f.seekCount, 1); assert.equal(f.stopCount, 2);
    assert.equal(f.report.steps.at(-1).result.visualApproval, false);
    assert.equal(f.report.steps.filter(x => x.step.includes('-validation')).length, 2);
  });
  await test('first completed evidence from a previous generation rejected', async () => {
    const f = fixture(); await f.load(); f.r.first = { completed: true }; f.click('first'); f.tickRaf(); f.assertFailed(/旧completed/);
  });
  for (const [name, patch] of [
    ['generation jump', f => { f.r.generation++; }],
    ['nonadjacent frame', f => { f.r.first.sourceFrame -= 2; }],
    ['entry source mismatch', f => { f.r.entry.mainFrame--; }],
    ['entry above boundary', f => { f.r.entry.mainLg = 20.1; }],
    ['late cosmic capture', f => { f.r.first.lg = 25.9; }]
  ]) await test(name + ' rejected', async () => {
    const f = fixture(); await f.load(); f.click('first'); f.complete(patch); f.tickRaf(); f.assertFailed(/首帧身份/);
  });
  await test('validation false check rejected even with passed status string', async () => {
    const f = fixture(); await f.load(); f.r.validate = () => ({ status: 'passed-limited', checks: { falseClaim: false } });
    f.click('first'); f.complete(); f.tickRaf(); f.assertFailed(/validate/);
  });
  await test('hold configuration without actual stable hold rejected', async () => {
    const f = fixture(); await f.load(); f.click('first'); f.complete(); f.tickRaf(); f.journey.lg += .1;
    f.tickRaf(); f.tickRaf(); f.assertFailed(/candidateHold/);
  });
  await test('history is immutable after candidate arrays and objects mutate', async () => {
    const f = fixture(); await f.load(); const before = JSON.stringify(f.report.steps[0]);
    f.r.errors.push('later'); f.r.restores.push({ reason: 'later' });
    assert.equal(JSON.stringify(f.report.steps[0]), before);
    f.r.errors.length = 0; f.click('first'); f.handoff();
    const step = JSON.stringify(f.report.steps.find(x => x.step === 'first-entry-checks'));
    f.r.first.frame++; assert.equal(JSON.stringify(f.report.steps.find(x => x.step === 'first-entry-checks')), step);
  });
  await test('timeout saves actual pre-stop state and overshoot without rAF', async () => {
    const f = fixture(); await f.load(); f.click('first'); f.journey.lg = 19.8; f.advance(21000);
    f.assertFailed(/超时/); const b = f.report.steps.find(x => ['budget-expired', 'deadline-exceeded'].includes(x.step)).result;
    assert.equal(b.actualElapsedMs, 21000); assert.equal(b.overshootMs, 1000);
    assert.equal(b.snapshot.journey.on, true); assert.equal(b.snapshot.journey.lg, 19.8);
    assert.equal(f.report.cleanup[0].after.journey.on, false);
  });
  await test('cosmic missing source becomes explicit failure instead of generic timeout', async () => {
    const f = fixture(); await f.load(); f.click('first'); f.journey.cs = true; f.journey.lg = 25.9;
    f.watchdog(); f.advance(300); f.assertFailed(/缺少本轮接力来源/);
    assert.equal(f.report.steps.find(x => x.step === 'failure-before-cleanup').result.journey.lg, 25.9);
  });
  await test('unfinished first preserved in timeout snapshot', async () => {
    const f = fixture(); await f.load(); f.click('first'); f.complete(x => { x.r.first.completed = false; });
    f.advance(20000); f.assertFailed(/超时/);
    assert.equal(f.report.steps.find(x => x.step === 'failure-before-cleanup').result.first.completed, false);
  });
  await test('stopped journey without first rejected promptly', async () => {
    const f = fixture(); await f.load(); f.click('first'); f.journey.on = false; f.tickRaf(); f.assertFailed(/已停止/);
  });
  for (const type of ['error', 'unhandledrejection']) await test('child ' + type + ' locks immediately', async () => {
    const f = fixture(); await f.load(); f.click('first'); f.child.emit(type, { message: 'fixture-error', reason: 'fixture-rejection' });
    f.assertFailed(/候选/); const count = f.report.steps.length; f.tickRaf(); f.advance(30000); assert.equal(f.report.steps.length, count);
  });
  await test('cleanup exception retained separately from original error', async () => {
    const f = fixture(); await f.load(); f.click('first'); f.s.journeyStop = () => { throw Error('cleanup fixture'); };
    f.child.emit('error', { message: 'original fixture' }); f.assertFailed(/original fixture/);
    assert.match(f.report.cleanup[0].error, /cleanup fixture/);
  });
  for (const target of ['parent','child']) await test(target + ' visibility loss fails with snapshot', async () => {
    const f = fixture(); await f.load(); f.click('first'); const d = target === 'parent' ? f.doc : f.childDoc;
    d.visibilityState = 'hidden'; d.emit('visibilitychange'); f.assertFailed(/隐藏/); assert.equal(f.report.events.length, 1);
  });
  await test('content hash mismatch blocks start', async () => {
    const f = fixture({ badHash: true }); await f.load(); f.assertFailed(/指纹不匹配/);
  });
  await test('URL fragment change blocks current generation', async () => {
    const f = fixture(); await f.load(); f.child.location.href += '#wrong'; f.watchdog(); f.assertFailed(/URL或fragment/);
  });
  await test('module source mismatch rejected', async () => {
    const f = fixture(); f.childDoc.querySelectorAll = () => [{ src: 'http://127.0.0.1:8169/js/app.js' }];
    await f.load(); f.assertFailed(/模块URL/);
  });
  await test('iframe reload cannot enable start again', async () => {
    const f = fixture(); await f.load(); await f.load(); f.assertFailed(/重复load/);
  });
  await test('document replacement fails without stopping different page', async () => {
    const f = fixture(); await f.load(); f.click('first'); f.child.document = new Events(); f.watchdog();
    f.assertFailed(/文档实例/); assert.equal(f.report.cleanup[0].attempted, false);
  });
  await test('old stop record plus false return cannot pass', async () => {
    const f = fixture(); await f.load(); f.toStop(); f.r.restores.push({ reason: 'stop', frame: 1 });
    f.s.journeyStop = () => { f.journey.on = false; return false; }; f.click('stop'); f.assertFailed(/停止清理/);
  });
  await test('true stop with no newly added record cannot pass', async () => {
    const f = fixture(); await f.load(); f.toStop();
    f.s.journeyStop = () => { f.journey.on = false; return true; }; f.click('stop'); f.assertFailed(/停止清理/);
  });
  for (const [name, mutate] of [
    ['wrong reason', f => { f.r.restores.at(-1).reason = 'leave'; }],
    ['old frame', f => { f.r.restores.at(-1).frame = 1; }],
    ['uncleared up', f => { f.cs.upCur = { toArray: () => [0,1,0] }; }],
    ['NaN projection', f => { f.cs.cam.projectionMatrix.elements[0] = NaN; }],
    ['bad inverse', f => { f.cs.cam.projectionMatrixInverse.elements[0] = 2; }]
  ]) await test('stop rejects ' + name, async () => {
    const f = fixture(); await f.load(); f.toStop(); const original = f.s.journeyStop;
    f.s.journeyStop = () => { const out = original(); mutate(f); return out; }; f.click('stop'); f.assertFailed(/停止清理/);
  });
  await test('second start permits unchanged old first while waiting, not as completion', async () => {
    const f = fixture(); await f.load(); f.toSecond(); f.tickRaf(); assert.equal(f.phase, 'second-entry');
    assert(!f.report.steps.some(x => x.step === 'second-entry-validation'));
  });
  await test('old evidence in-place mutation before second start rejected', async () => {
    const f = fixture(); await f.load(); f.toStop(); f.click('stop'); f.r.entry.mainLg = 19.5;
    f.click('second'); f.assertFailed(/原地改写/);
  });
  await test('second generation reusing old first object rejected', async () => {
    const f = fixture(); await f.load(); f.toSecond(); const old = f.r.first;
    f.complete(x => { Object.assign(old, x.r.first); x.r.first = old; }); f.tickRaf(); f.assertFailed(/首帧身份/);
  });
  await test('second generation reusing old entry object rejected', async () => {
    const f = fixture(); await f.load(); f.toSecond(); const old = f.r.entry;
    f.complete(x => { Object.assign(old, x.r.entry); x.r.entry = old; }); f.tickRaf(); f.assertFailed(/首帧身份/);
  });
  await test('second source older than first run rejected', async () => {
    const f = fixture(); await f.load(); f.toSecond(); f.complete(x => {
      x.r.first.frame = 50; x.r.first.sourceFrame = 49; x.r.entry.mainFrame = 49;
    }); f.tickRaf(); f.assertFailed(/首帧身份/);
  });
  await test('failure during lg21 wait cannot resurrect success/buttons', async () => {
    const f = fixture(); await f.load(); f.click('first'); f.handoff(); f.click('lg21'); f.tickRaf();
    f.child.emit('error', { message: 'late fixture' }); const n = f.report.steps.length;
    f.tickRaf(); f.advance(30000); f.assertFailed(/late fixture/); assert.equal(f.report.steps.length, n);
  });
  await test('pagehide terminates instead of silently resuming', async () => {
    const f = fixture(); await f.load(); f.win.emit('pagehide'); f.assertFailed(/pagehide/);
  });
  await test('failure after second handoff prevents finish result', async () => {
    const f = fixture(); await f.load(); f.toSecond(); f.handoff(); f.child.emit('error', { message: 'post fixture' });
    f.click('finish'); f.assertFailed(/post fixture/); assert(!f.report.steps.some(x => x.step === 'finished'));
  });
  for (const stage of ['start', 'validate', 'seek', 'stop', 'finish']) await test(stage + ' synchronous error cannot commit success', async () => {
    const f = fixture(); await f.load();
    const wrap = name => { const original = f.s[name]; f.s[name] = (...args) => {
      const out = original(...args); f.child.emit('error', { message: 'reentrant fixture' }); return out;
    }; };
    if (stage === 'start') { wrap('journey'); f.click('first'); }
    if (stage === 'validate') {
      f.r.validate = () => { f.child.emit('error', { message: 'reentrant fixture' }); return { status: 'passed-limited', checks: { ok: true } }; };
      f.click('first'); f.complete(); f.tickRaf();
    }
    if (stage === 'seek') { f.click('first'); f.handoff(); wrap('journeySeek'); f.click('lg21'); }
    if (stage === 'stop') { f.toStop(); wrap('journeyStop'); f.click('stop'); }
    if (stage === 'finish') { f.toSecond(); f.handoff(); wrap('journeyStop'); f.click('finish'); }
    f.assertFailed(/reentrant fixture/);
    assert(!f.report.steps.some(x => x.step === 'finished'));
    const snapshot = JSON.stringify(f.report); f.tickRaf(); f.advance(30000); assert.equal(JSON.stringify(f.report), snapshot);
  });
  for (const stage of ['entry', 'hold', 'lg21']) await test(stage + ' overdue rAF rejected before timer dispatch', async () => {
    const f = fixture(); await f.load(); f.click('first');
    if (stage === 'entry') f.complete();
    if (stage === 'hold') { f.complete(); f.tickRaf(); }
    if (stage === 'lg21') { f.handoff(); f.click('lg21'); }
    f.elapseWithoutTimers(stage === 'lg21' ? 5001 : 20001); f.tickRaf(); f.assertFailed(/绝对截止时间/);
  });
  await test('slow synchronous validate rejected by absolute deadline', async () => {
    const f = fixture(); await f.load(); f.r.validate = () => {
      f.elapseWithoutTimers(20001); return { status: 'passed-limited', checks: { ok: true } };
    }; f.click('first'); f.complete(); f.tickRaf(); f.assertFailed(/绝对截止时间/);
  });
  await test('public seek during natural entry is actually counted and rejected', async () => {
    const f = fixture(); await f.load(); f.click('first'); f.s.journeySeek(21); f.complete(); f.tickRaf();
    f.assertFailed(/首帧身份/); assert.equal(f.report.steps.find(x => x.step === 'first-entry-checks').result.checks.naturalNoSeek, false);
  });
  await test('seek wrapper replacement rejected', async () => {
    const f = fixture(); await f.load(); f.click('first'); f.s.journeySeek = () => true; f.complete(); f.tickRaf(); f.assertFailed(/首帧身份/);
  });
  for (const [name, mutate] of [
    ['cine off', f => { f.journey.cine = false; }],
    ['cosmic off', f => { f.journey.cs = false; }],
    ['first in-place', f => { f.r.first.frame++; }],
    ['entry in-place', f => { f.r.entry.mainLg = 19.5; }]
  ]) await test('hold rejects ' + name + ' via watchdog', async () => {
    const f = fixture(); await f.load(); f.click('first'); f.complete(); f.tickRaf(); mutate(f); f.watchdog(); f.assertFailed(/保持期间/);
  });
  await test('validate in-place mutation rejected', async () => {
    const f = fixture(); await f.load(); f.r.validate = () => { f.r.first.frame++; return { status: 'passed-limited', checks: { ok: true } }; };
    f.click('first'); f.complete(); f.tickRaf(); f.assertFailed(/validate期间/);
  });
  for (const [name, mutate] of [
    ['reused object', f => { f.r.restores[f.r.restores.length - 1] = f.r.restores[0]; }],
    ['record inverse', f => { f.r.restores.at(-1).inverse[0] = 3; }],
    ['history replacement', f => { f.r.restores = [...f.r.restores]; }],
    ['history prefix mutation', f => { f.r.restores[0].reason = 'rewritten'; }]
  ]) await test('stop rejects ' + name, async () => {
    const f = fixture(); await f.load(); f.toStop();
    f.r.restores.push({ reason: 'stop', frame: 999, projection: f.cs.cam.projectionMatrix.toArray(), inverse: f.cs.cam.projectionMatrixInverse.toArray() });
    const original = f.s.journeyStop; f.s.journeyStop = () => { const out = original(); mutate(f); return out; };
    f.click('stop'); f.assertFailed(/停止清理/);
  });
  await test('missing iframe load fails at 15 seconds and late load stays failed', async () => {
    const f = fixture(); f.advance(15000); f.assertFailed(/加载超过15秒/);
    const snapshot = JSON.stringify(f.report); await f.load(); assert.equal(JSON.stringify(f.report), snapshot);
  });
  await test('overdue load rejected even before load timer dispatch', async () => {
    const f = fixture(); f.elapseWithoutTimers(15001); await f.load(); f.assertFailed(/绝对15秒/); assert.equal(f.fetchCalls.length, 0);
  });
  for (const defer of ['deferFetch', 'deferBody']) for (const timerFires of [false, true]) await test(defer + ' late identity cannot mutate failed report or fetch next resource (timer=' + timerFires + ')', async () => {
    const f = fixture({ [defer]: true }); const loading = f.load();
    await f.deferredReady;
    if (timerFires) f.advance(10001); else f.elapseWithoutTimers(10001);
    const before = timerFires ? JSON.stringify(f.report) : null;
    if (defer === 'deferFetch') f.releaseFetch(); else f.releaseBody();
    await loading; f.assertFailed(/身份检查超过/); assert.equal(f.fetchCalls.length, 1); assert.equal(f.report.identity.resources.length, 0);
    if (before) assert.equal(JSON.stringify(f.report), before);
  });
  await test('identity after child error cannot mutate terminal report', async () => {
    const f = fixture({ deferFetch: true }); const loading = f.load(); f.child.emit('error', { message: 'identity fixture' });
    const snapshot = JSON.stringify(f.report); f.releaseFetch(); await loading;
    f.assertFailed(/identity fixture/); assert.equal(JSON.stringify(f.report), snapshot); assert.equal(f.fetchCalls.length, 1);
  });
  await test('cineTimeAtLg synchronous failure prevents subsequent seek operation', async () => {
    const f = fixture(); await f.load(); f.click('first'); f.handoff();
    f.r.cineTimeAtLg = () => { f.child.emit('error', { message: 'time mapping fixture' }); return 21; };
    f.click('lg21'); f.assertFailed(/time mapping fixture/); assert.equal(f.seekCount, 0);
    assert.equal(f.journey.lg, f.report.cleanup[0].after.journey.lg);
  });
  await test('post-stop inverse callback cannot reactivate journey and still pass', async () => {
    const f = fixture(); await f.load(); f.toSecond(); f.handoff();
    const matrix = f.cs.cam.projectionMatrixInverse, original = matrix.toArray.bind(matrix); let calls = 0;
    matrix.toArray = () => {
      if (++calls === 3) { f.journey.on = true; f.cs.upCur = { toArray: () => [0,1,0] }; }
      return original();
    };
    f.click('finish'); f.assertFailed(/停止后置采样/); assert(!f.report.steps.some(x => x.step === 'finished'));
  });
  await test('environment getter reentry cannot silently remove next phase budget', async () => {
    const f = fixture(); await f.load(); f.click('first'); f.complete(); f.tickRaf(); f.tickRaf();
    const errors = f.r.errors; let reentered = false;
    Object.defineProperty(f.r, 'errors', { get() {
      if (!reentered && f.phase === 'first-ready-lg21') { reentered = true; f.click('lg21'); }
      return errors;
    } });
    f.tickRaf(); assert(reentered); f.assertFailed(/任务已失效/);
    const snapshot = JSON.stringify(f.report); f.advance(30000); assert.equal(JSON.stringify(f.report), snapshot);
  });
  console.log(`PASS ${passed}/${passed}: actual inline panel controller; synthetic state only, no browser/GPU/visual acceptance.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
