'use strict';
// Exercise the actual timeline declarations/functions in isolation, without a browser.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const src = fs.readFileSync(path.join(__dirname, '../public/js/app.js'), 'utf8').replace(/\r\n/g, '\n');
const a = src.indexOf('const CINE_SEG = [');
const b = src.indexOf('\n/* 一镜到底：', a);
assert.ok(a >= 0 && b > a, 'timeline boundaries not found');
assert.equal(src.indexOf('const CINE_SEG = [', a + 1), -1, 'ambiguous timeline');
const ctx = vm.createContext({smoothstep(x, lo, hi) { const t = Math.max(0, Math.min(1, (x - lo) / (hi - lo))); return t * t * (3 - 2 * t); }});
vm.runInContext(src.slice(a, b) + '\nthis.api = {segments: CINE_SEG, times: CINE_T, duration: CINE_DUR, views: CINE_VIEW, lg: cineLgAt, view: cineViewAt};', ctx);
const {segments, times, duration, views, lg, view} = ctx.api;
assert.ok(Number.isFinite(duration) && duration > 0);
segments.forEach(([from, to, rate], i) => {
  assert.ok(Number.isFinite(from) && to > from && Number.isFinite(rate) && rate > 0, `invalid segment ${i}`);
  if (i) assert.ok(Math.abs(from - segments[i - 1][1]) < 1e-10, `gap at segment ${i}`);
  assert.ok(Math.abs(lg(times[i]) - from) < 1e-9, `bad segment start ${i}`);
  assert.ok(Math.abs(lg(times[i + 1]) - to) < 1e-9, `bad segment end ${i}`);
});
views.forEach((v, i) => { assert.ok(v.every(Number.isFinite)); if (i) assert.ok(v[0] > views[i - 1][0], 'view keys unordered'); });
for (let i = 0, prev = -Infinity; i <= 10000; i++) {
  const v = lg(duration * i / 10000);
  assert.ok(Number.isFinite(v) && v >= prev - 1e-10, `nonmonotonic at sample ${i}`);
  assert.ok(Array.from(view(v)).every(Number.isFinite), `invalid view at sample ${i}`);
  prev = v;
}
const secondsAt = value => {
  const i = segments.findIndex(([from, to]) => value >= from && value <= to);
  assert.ok(i >= 0, `scale ${value} is outside timeline`);
  return times[i] + (value - segments[i][0]) / segments[i][2];
};
console.log(`PASS: ${segments.length} contiguous positive-rate segments; ${views.length} ordered view keys; 10001 monotonic samples; duration ${duration.toFixed(3)} s`);
for (const [label, scale] of [['earth',7.23], ['solar range',11], ['handoff',20], ['milky-way view key',20.4], ['local group view key',22.8], ['virgo view key',24.4], ['web view key',25.8], ['CMB range',26.1]]) {
  const t = secondsAt(scale), angles = Array.from(view(scale));
  console.log(`${label}: t=${t.toFixed(3)}s lg=${scale} angles=${angles.map(x => x.toFixed(3)).join(',')}`);
}
console.log('Limit: source-level timing math only; not evidence of rendered content, clock determinism, camera continuity across scene handoff, or frame time.');
