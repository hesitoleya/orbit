'use strict';
/* Execute the real inline controller in a VM with fake DOM, timers, rAF,
 * MediaRecorder and candidate interface. No browser, network, GUI or writes. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public/rh-v4-continuity-capture.html'), 'utf8');
const matches = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
assert.equal(matches.length, 1);
const code = matches[0][1];
new vm.Script(code);
const resources = new Map([
  ['/rh-candidate-preview-v4.html', fs.readFileSync(path.join(root, 'public/rh-candidate-preview-v4.html'))],
  ['/js/rh-candidate-preview-v4.js', fs.readFileSync(path.join(root, 'public/js/rh-candidate-preview-v4.js'))]
]);
class Events {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, fn) { if (!this.listeners.has(type)) this.listeners.set(type, []); this.listeners.get(type).push(fn); }
  emit(type, event = {}) { return (this.listeners.get(type) || []).map(fn => fn(event)); }
}
class Matrix {
  constructor(v) { this.elements = v ? [...v] : [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]; }
  toArray() { return [...this.elements]; }
  clone() { return new Matrix(this.elements); }
  multiply(o) {
    const a = this.elements, b = o.elements, out = new Array(16).fill(0);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) out[c*4+r] += a[k*4+r] * b[c*4+k];
    this.elements = out; return this;
  }
}
class Camera { constructor(fov, aspect, near, far) { Object.assign(this, { fov, aspect, near, far, projectionMatrix: new Matrix(), projectionMatrixInverse: new Matrix() }); } }
class FakeRecorder {
  static isTypeSupported(m) { return m === 'video/webm;codecs=vp9' || m === 'video/webm;codecs=vp8' || m === 'video/webm'; }
  static instances = [];
  constructor(stream, options) {
    this.stream = stream; this.options = options; this.state = 'inactive';
    this.mimeType = options.mimeType; this.ondataavailable = null; this.onerror = null; this.onstop = null;
    this.chunks = []; FakeRecorder.instances.push(this);
  }
  start(ms) { assert.equal(this.state, 'inactive'); this.state = 'recording'; this.timeslice = ms; }
  stop() { if (this.state !== 'recording') return; this.state = 'inactive';
    if (!this.deferStop) this.dispatchStop(); }
  dispatchStop() {
    if (this.ondataavailable) this.ondataavailable({ data: new Blob([new Uint8Array(1000)]) });
    if (this.ondataavailable) this.ondataavailable({ data: new Blob([new Uint8Array(500)]) });
    if (this.onstop) this.onstop(); }
}
class FakeTrack extends Events {
  constructor() { super(); this.kind = 'video'; this.label = 'fake canvas'; this.readyState = 'live'; }
  getSettings() { return { width: 960, height: 540, frameRate: 30 }; }
}
class FakeStream {
  constructor() { this.tracks = [new FakeTrack()]; }
  getVideoTracks() { return this.tracks; }
}
function fixture(options = {}) {
  let now = 0, next = 1, seekCount = 0, stopCount = 0, appFrame = 100, recorderCount = 0;
  const timers = new Map(), rafs = new Map(), nodes = new Map();
  const location = new URL('http://127.0.0.1:8169/rh-v4-continuity-capture.html');
  const candidateURL = new URL('/rh-candidate-preview-v4.html?fresh=1&candidateHold=0&auto=0', location).href;
  const doc = new Events(), childDoc = new Events(), win = new Events(), child = new Events();
  win.MediaRecorder = FakeRecorder; win.Blob = Blob;
  const created = [];
  const canvas = { width: 960, height: 540, clientWidth: 1542, clientHeight: 664,
    captureStream(fps) { assert.equal(fps, 30); return new FakeStream(); } };
  doc.visibilityState = options.hidden ? 'hidden' : 'visible'; childDoc.visibilityState = 'visible';
  let focused = !options.unfocused;
  doc.hasFocus = () => focused; childDoc.hasFocus = () => true;
  doc.getElementById = id => { if (!nodes.has(id)) nodes.set(id, Object.assign(new Events(), { disabled: true, textContent: '' })); return nodes.get(id); };
  doc.createElement = () => { const a = { href: null, download: null, clicks: 0, click() { this.clicks++; created.push(this); } }; return a; };
  childDoc.title = 'EXPERIMENTAL RH CANDIDATE — SPACE·1:1';
  childDoc.querySelectorAll = selector => {
    if (selector === '#stage canvas') return [canvas];
    return [{ src: new URL('/js/rh-candidate-preview-v4.js', location).href }];
  };
  const r = { generation: 0, first: null, entry: null, restores: [], errors: [],
    validate: () => ({ status: 'passed-limited', checks: { fixture: true }, measurements: { synthetic: true } }) };
  const journey = { on: false, cine: true, cs: false, lg: 7.23 };
  const cs = { upCur: null, cam: { fov: 55, aspect: 2, near: .01, far: 1e9,
    projectionMatrix: new Matrix(), projectionMatrixInverse: new Matrix() },
    mwReal: { visible: true }, mwRealMat: { opacity: .7 } };
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
  const urls = new URL('http://127.0.0.1:8169/rh-v4-continuity-capture.html');
  const context = vm.createContext({
    document: doc, window: win, location, URL, Blob, Date, crypto: crypto.webcrypto, Uint8Array,
    MediaRecorder: FakeRecorder,
    performance: { now: () => now },
    setTimeout: (fn, ms) => setTimer(fn, ms, false), clearTimeout: id => timers.delete(id),
    setInterval: (fn, ms) => setTimer(fn, ms, true), clearInterval: id => timers.delete(id),
    URL: Object.assign(function(...args) { return new urls.constructor(...args); }, {
      createObjectURL: () => 'blob:fixture', revokeObjectURL: () => {}
    }),
    fetch: async url => {
      const data = options.badHash && url.includes('.js') ? Buffer.from('wrong') : resources.get(url);
      assert(data, 'unexpected fetch ' + url);
      return { ok: true, status: 200, url: new URL(url, location).href,
        arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) };
    }
  });
  child.document = childDoc; child.location = { href: candidateURL }; child.__SE = s; child.__RH_CANDIDATE__ = r;
  child.__rhInternals = { MWGC_LIST: new Array(144) }; child.innerWidth = 1542; child.innerHeight = 664; child.devicePixelRatio = 1.25;
  child.navigator = { serviceWorker: { controller: null } };
  child.requestAnimationFrame = fn => { const id = next++; rafs.set(id, fn); return id; };
  child.cancelAnimationFrame = id => rafs.delete(id);
  const frame = doc.getElementById('scene'); frame.contentWindow = child;
  vm.runInContext(code, context);
  const evaluate = text => vm.runInContext(text, context);
  const api = {
    s, r, journey, cs, child, childDoc, doc, win, nodes, frame, canvas, created, evaluate,
    get report() { return JSON.parse(evaluate('JSON.stringify(report)')); },
    get phase() { return evaluate('phase'); },
    get recorder() { return evaluate('recorder'); },
    get recorderCount() { return FakeRecorder.instances.length - recorderCount; },
    get stopCount() { return stopCount; }, get seekCount() { return seekCount; },
    load: async () => { if (!evaluate('candidateStarted')) nodes.get('initialize').onclick(); await Promise.all(frame.emit('load')); },
    emitLoad: async () => { await Promise.all(frame.emit('load')); },
    setFocus: value => { focused = value; win.emit(value ? 'focus' : 'blur'); },
    click: id => nodes.get(id).onclick(),
    tickRaf() { const batch = [...rafs.values()]; rafs.clear(); for (const fn of batch) fn(now); },
    advance(ms) {
      now += ms;
      const due = [...timers.entries()].filter(([, t]) => t.due <= now);
      for (const [id, timer] of due) {
        if (!timers.has(id)) continue;
        if (timer.interval) timer.due = now + timer.ms; else timers.delete(id);
        timer.fn();
      }
    },
    elapse(ms) { now += ms; },
    complete(patch) {
      appFrame += 10; r.generation++;
      r.entry = { mainFrame: appFrame - 1, mainLg: 19.999, mainForward: [1,0,0] };
      r.first = { frame: appFrame, sourceFrame: appFrame - 1, lg: 20.001, completed: true };
      Object.assign(journey, { cs: true, lg: 20.001 });
      if (patch) patch(api);
    },
    handoff() { this.complete(); this.tickRaf(); },
    continuous() {
      this.elapse(3000);
      for (let i = 0; i < 20; i++) { journey.lg = 20.01 + i * 0.005; this.tickRaf(); }
      this.elapse(3200); journey.lg = 20.2; this.tickRaf();
      this.tickRaf(); this.tickRaf();
    },
    assertFailed(pattern) {
      assert.equal(this.report.status, 'failed');
      assert.match(this.report.errors.map(x => x.message).join('\n'), pattern);
      assert.equal(nodes.get('record').disabled, true);
      assert(this.report.steps.some(x => x.step === 'failure-before-cleanup'));
      assert.equal(this.report.cleanup.length, 1);
      assert.equal(nodes.get('json').disabled, false);
    },
    resetRecorderCount() { recorderCount = FakeRecorder.instances.length; }
  };
  api.resetRecorderCount();
  return api;
}
let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log('PASS ' + name); }
(async () => {
  await test('hidden startup waits without loading, recording or timeout', async () => {
    const f = fixture({ hidden: true });
    assert.equal(f.report.status, 'waiting-foreground');
    assert.equal(f.frame.src, undefined); assert.equal(f.nodes.get('initialize').disabled, true);
    f.click('initialize'); f.advance(30000); await f.emitLoad();
    assert.equal(f.report.status, 'waiting-foreground'); assert.equal(f.frame.src, undefined);
    assert.equal(f.recorderCount, 0); assert.equal(f.journey.on, false);
    f.doc.visibilityState = 'visible'; f.doc.emit('visibilitychange');
    assert.equal(f.nodes.get('initialize').disabled, false);
    await f.load(); assert.equal(f.report.status, 'ready');
    assert.equal(f.report.steps[0].step, 'foreground-initialize');
  });
  await test('focus and visibility are rechecked at initialization', async () => {
    const f = fixture({ unfocused: true });
    assert.equal(f.nodes.get('initialize').disabled, true);
    assert.match(f.nodes.get('status').textContent, /visibility=visible，focus=false/);
    f.click('initialize'); assert.equal(f.frame.src, undefined);
    f.setFocus(true); assert.equal(f.nodes.get('initialize').disabled, false);
    f.doc.visibilityState = 'hidden'; f.click('initialize');
    assert.equal(f.frame.src, undefined); assert.equal(f.report.status, 'waiting-foreground');
  });
  await test('hiding after initialization before load locks and rejects late load', async () => {
    const f = fixture(); f.click('initialize');
    assert.match(f.frame.src, /candidateHold=0/);
    f.doc.visibilityState = 'hidden'; f.doc.emit('visibilitychange'); f.assertFailed(/页面隐藏/);
    const snapshot = JSON.stringify(f.report); await f.emitLoad(); f.advance(20000);
    assert.equal(JSON.stringify(f.report), snapshot); assert.equal(f.recorderCount, 0);
  });
  await test('load timeout begins only at initialization and blocks late load', async () => {
    const f = fixture(); f.advance(30000); assert.equal(f.report.status, 'waiting-foreground');
    f.click('initialize'); f.advance(15001); f.assertFailed(/加载超过15秒/);
    const snapshot = JSON.stringify(f.report); await f.emitLoad();
    assert.equal(JSON.stringify(f.report), snapshot);
  });
  await test('child hidden at load is rejected', async () => {
    const f = fixture(); f.childDoc.visibilityState = 'hidden'; await f.load();
    f.assertFailed(/候选=hidden/); assert.equal(f.recorderCount, 0);
  });
  await test('initial about:blank load is ignored even after initialize', async () => {
    const f = fixture(); const candidate = f.child.location.href;
    await f.emitLoad(); f.click('initialize'); f.child.location.href = 'about:blank'; await f.emitLoad();
    assert.equal(f.report.status, 'loading'); f.child.location.href = candidate; await f.emitLoad();
    assert.equal(f.report.status, 'ready');
  });
  await test('late load past absolute deadline fails even before timer dispatch', async () => {
    const f = fixture(); f.click('initialize'); f.elapse(15001); await f.emitLoad();
    f.assertFailed(/绝对15秒/); assert.equal(f.recorderCount, 0);
  });
  await test('repeated initialization or duplicate load cannot restart candidate', async () => {
    const f = fixture(); f.click('initialize'); const started = JSON.stringify(f.report);
    f.click('initialize'); assert.equal(JSON.stringify(f.report), started);
    await f.emitLoad(); assert.equal(f.report.status, 'ready'); await f.emitLoad();
    f.assertFailed(/重复load/);
  });
  await test('pagehide during load locks and blocks late load', async () => {
    const f = fixture(); f.click('initialize'); f.win.emit('pagehide'); f.assertFailed(/pagehide/);
    const snapshot = JSON.stringify(f.report); await f.emitLoad(); assert.equal(JSON.stringify(f.report), snapshot);
  });
  await test('child visibility loss during recording stops capture', async () => {
    const f = fixture(); await f.load(); f.click('record');
    f.childDoc.visibilityState = 'hidden'; f.childDoc.emit('visibilitychange');
    f.assertFailed(/候选=hidden/); assert.equal(f.report.cleanup[0].recorderStopped, true);
  });
  await test('verify real HTML/JS hashes and candidateHold=0 at identity', async () => {
    const f = fixture(); await f.load();
    assert.equal(f.report.status, 'ready');
    assert.equal(f.report.identity.candidateHoldConfigured, true);
    assert.equal(f.report.identity.mainCanvas.width, 960);
    assert.equal(f.report.identity.resources.length, 2);
    assert(f.report.identity.resources.every(x => x.matched));
    assert.equal(f.nodes.get('record').disabled, false);
  });
  await test('reject wrong JS hash before enabling recording', async () => {
    const f = fixture({ badHash: true }); await f.load(); f.assertFailed(/候选内容指纹不匹配/);
    assert.equal(f.report.cleanup[0].attempted, false);
  });
  await test('full natural synthetic session produces stopped recorder and passed-limited report', async () => {
    const f = fixture(); await f.load(); f.click('record'); f.handoff(); f.continuous();
    const report = f.report;
    assert.equal(report.status, 'passed-limited');
    assert.equal(report.video.bytes, 1500);
    assert.equal(report.video.chunks, 2);
    assert.equal(report.video.canvas.width, 960);
    assert.equal(f.stopCount, 1);
    assert.equal(f.seekCount, 0);
    assert(report.steps.some(x => x.step === 'natural-handoff-checks'));
    assert(report.steps.some(x => x.step === 'continuity-observed'));
    assert(report.steps.some(x => x.step === 'journey-stop'));
    assert.equal(report.steps.at(-1).result.visualApproval, false);
    assert.equal(f.nodes.get('json').disabled, false);
    assert.equal(f.nodes.get('video').disabled, false);
  });
  await test('asynchronous recorder stop keeps deadline until callback', async () => {
    const f = fixture(); await f.load(); f.click('record'); f.recorder.deferStop = true;
    f.handoff(); f.continuous(); assert.equal(f.report.status, 'ready');
    assert.equal(f.recorder.state, 'inactive'); f.elapse(1000); f.recorder.dispatchStop();
    assert.equal(f.report.status, 'passed-limited');
  });
  await test('missing asynchronous recorder callback times out and cannot revive', async () => {
    const f = fixture(); await f.load(); f.click('record'); f.recorder.deferStop = true;
    f.handoff(); f.continuous(); f.advance(5001); f.assertFailed(/录制收尾超时/);
    const snapshot = JSON.stringify(f.report); f.recorder.dispatchStop();
    assert.equal(JSON.stringify(f.report), snapshot);
  });
  await test('late recorder stop callback rejected before overdue timer dispatch', async () => {
    const f = fixture(); await f.load(); f.click('record'); f.recorder.deferStop = true;
    f.handoff(); f.continuous(); f.elapse(5001); f.recorder.dispatchStop();
    f.assertFailed(/录制收尾超时/);
  });
  await test('hiding during asynchronous recorder stop rejects callback', async () => {
    const f = fixture(); await f.load(); f.click('record'); f.recorder.deferStop = true;
    f.handoff(); f.continuous(); f.doc.visibilityState = 'hidden'; f.doc.emit('visibilitychange');
    f.assertFailed(/页面隐藏/); const snapshot = JSON.stringify(f.report); f.recorder.dispatchStop();
    assert.equal(JSON.stringify(f.report), snapshot);
  });
  await test('realistic undefined initial generation permits natural pre-handoff sampling', async () => {
    const f = fixture(); delete f.r.generation; await f.load(); f.click('record'); f.tickRaf();
    assert.notEqual(f.report.status, 'failed'); assert.equal(f.journey.on, true);
    f.r.generation = 0; f.handoff(); f.continuous(); assert.equal(f.report.status, 'passed-limited');
  });
  await test('undefined initial generation with stale entry is rejected before journey', async () => {
    const f = fixture(); delete f.r.generation; f.r.entry = { mainFrame: 42 };
    await f.load(); f.click('record'); f.assertFailed(/启动基线generation无效/);
    assert.equal(f.journey.on, false);
  });
  await test('undefined generation cannot be accepted after cosmic entry', async () => {
    const f = fixture(); delete f.r.generation; await f.load(); f.click('record');
    f.journey.cs = true; f.tickRaf(); f.assertFailed(/generation异常变化/);
  });
  await test('do not accept stale completed evidence from previous generation', async () => {
    const f = fixture(); await f.load(); f.r.first = { completed: true }; f.click('record'); f.tickRaf();
    f.assertFailed(/旧completed/);
  });
  for (const [name, patch] of [
    ['generation jump', f => { f.r.generation += 2; }],
    ['nonadjacent frame', f => { f.r.first.sourceFrame -= 2; }],
    ['entry source mismatch', f => { f.r.entry.mainFrame--; }],
    ['entry above boundary', f => { f.r.entry.mainLg = 20.1; }],
    ['late cosmic capture', f => { f.r.first.lg = 25.9; }]
  ]) await test(name + ' rejected at handoff', async () => {
    const f = fixture(); await f.load(); f.click('record'); f.complete(patch); f.tickRaf();
    f.assertFailed(/身份|相邻性|generation/);
  });
  await test('public seek during recording is an explicit failure', async () => {
    const f = fixture(); await f.load(); f.click('record'); f.s.journeySeek(21); f.complete(); f.tickRaf();
    f.assertFailed(/公开seek/);
  });
  await test('false validate check blocks acceptance', async () => {
    const f = fixture(); await f.load(); f.r.validate = () => ({ status: 'passed-limited', checks: { falseClaim: false } });
    f.click('record'); f.complete(); f.tickRaf(); f.assertFailed(/validate/);
  });
  await test('post-handoff frozen lg fails before budget expiry', async () => {
    const f = fixture(); await f.load(); f.click('record'); f.handoff();
    f.elapse(2300); f.tickRaf(); f.assertFailed(/冻结/);
  });
  await test('missing source frame fails explicitly', async () => {
    const f = fixture(); await f.load(); f.click('record'); f.journey.cs = true; f.journey.lg = 25.9;
    f.advance(200); f.advance(200); f.advance(200); f.assertFailed(/缺少本轮接力来源/);
  });
  await test('handoff timeout records pre-stop state and stops journey/recorder', async () => {
    const f = fixture(); await f.load(); f.click('record'); f.advance(26000);
    f.assertFailed(/超时/);
    assert.equal(f.stopCount, 1);
    assert.equal(f.report.cleanup[0].recorderStopped, true);
    const budget = f.report.steps.find(x => ['budget-expired', 'deadline-exceeded'].includes(x.step)).result;
    assert.equal(budget.budgetMs, 25000);
    assert(budget.snapshot.journey.on === true || budget.snapshot.journey.on === undefined);
  });
  await test('visibility loss during recording fails and late callbacks cannot revive', async () => {
    const f = fixture(); await f.load(); f.click('record');
    f.doc.visibilityState = 'hidden'; f.doc.emit('visibilitychange');
    f.assertFailed(/页面隐藏/);
    const snapshot = JSON.stringify(f.report); f.complete(); f.tickRaf();
    assert.equal(JSON.stringify(f.report), snapshot);
  });
  await test('history snapshots are deep copies and survive later mutation', async () => {
    const f = fixture(); await f.load(); const before = JSON.stringify(f.report.steps[0]);
    f.r.errors.push('later'); f.r.restores.push({ reason: 'later' });
    assert.equal(JSON.stringify(f.report.steps[0]), before);
    f.r.errors.length = 0; f.click('record'); f.handoff();
    const step = JSON.stringify(f.report.steps.find(x => x.step === 'natural-handoff-checks'));
    f.r.first.frame++; assert.equal(JSON.stringify(f.report.steps.find(x => x.step === 'natural-handoff-checks')), step);
  });
  await test('download buttons stay disabled before a completed session', async () => {
    const f = fixture(); await f.load(); assert.equal(f.nodes.get('json').disabled, true);
    assert.equal(f.nodes.get('video').disabled, true);
  });
  console.log('ALL ' + passed + ' PASSED');
})().catch(e => { console.error(e); process.exitCode = 1; });
