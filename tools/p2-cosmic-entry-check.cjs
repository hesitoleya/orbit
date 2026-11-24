'use strict';
// 独立回归：手工进入/退出宇宙层、旅程中途停止后的上方向状态。
// 复用既有 CDP 脚手架，不改写产品源码与成品。
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const basePath = path.join(__dirname, 'test-deep-models.cjs');
let source = fs.readFileSync(basePath, 'utf8');
const beginMarker = 'async function main() {', endMarker = '\nfunction cleanup()';
const begin = source.indexOf(beginMarker), end = source.indexOf(endMarker);
if (begin < 0 || end <= begin) throw Error('CDP 脚手架结构已改变');
async function checkMain() {
  const probe = `(() => {const s=__SE;return {active:s.CS.active,up:s.CS.cam.up.toArray(),upCur:s.CS.upCur?s.CS.upCur.toArray():null,lg:s.journeyInfo.lg}})()`;
  report.experiment = 'P2 宇宙入口与旅程停止回归';
  await launch();
  pageKind = 'file';
  await load(FILE_URL, 'file');
  const r = {};
  r.manualEnter = await evaluate(`(() => {const s=__SE;s.journeyStop();s.cosmos(1e22);return ${probe}})()`);
  await frames(2);
  r.manualAfter = await evaluate(probe);
  r.manualLeave = await evaluate(`(() => {const s=__SE;s.cosmosLeave();return ${probe}})()`);
  r.seekCross = await evaluate(`(() => {const s=__SE;const a=s.journeySeek(7.49);const qa=s.CS.cam.quaternion.toArray();const b=s.journeySeek(7.501);return {a,b,qa,qb:s.CS.cam.quaternion.toArray()}})()`);
  /* 7.76s ≈ lg 20.2，处于 20→21 的滚动过渡段内 */
  r.midRoll = await evaluate(`(() => {const s=__SE;s.journeySeek(7.76);const before=${probe};s.journeyStop();const after=${probe};return {before,after}})()`);
  const qang = (a, b) => 2 * Math.acos(Math.min(1, Math.abs(a[0]*b[0]+a[1]*b[1]+a[2]*b[2]+a[3]*b[3]))) * 180 / Math.PI;
  const tests = [];
  tests.push({ name: '手工进入宇宙层', ok: r.manualEnter.active === true && r.manualAfter.up.every((v, i) => Math.abs(v - [0,1,0][i]) < 1e-6) && r.manualAfter.upCur === null, details: r.manualAfter });
  tests.push({ name: '手工退出宇宙层', ok: r.manualLeave.active === false, details: r.manualLeave });
  tests.push({ name: '冻结定位跨层连续', ok: r.seekCross.a.cs === false && r.seekCross.b.cs === true && qang(r.seekCross.qa, r.seekCross.qb) < 0.5, details: { deg: +qang(r.seekCross.qa, r.seekCross.qb).toFixed(3) } });
  tests.push({ name: '中途停止清理过渡上方向', ok: r.midRoll.before.upCur !== null && r.midRoll.after.upCur === null, details: r.midRoll });
  report.tests = tests.map(t => ({ name: t.name, status: t.ok ? 'pass' : 'fail', details: t.details }));
  report.summary = { pass: tests.filter(t => t.ok).length, fail: tests.filter(t => !t.ok).length };
  report.ok = report.summary.fail === 0;
}
source = source.slice(0, begin) + `async function main(){return (${checkMain.toString()})();}` + source.slice(end);
function replaceOnce(needle, replacement) {
  const first = source.indexOf(needle);
  if (first < 0 || source.indexOf(needle, first + needle.length) !== -1) throw Error('替换点必须唯一：' + needle);
  source = source.slice(0, first) + replacement + source.slice(first + needle.length);
}
replaceOnce("const REPORT_FILE = path.join(ROOT, `deep-models-test-184-${RUN_ID}.json`);", "const REPORT_FILE = path.join(ROOT, '.workbuddy', `p2-entry-${RUN_ID}.json`);");
replaceOnce("report.complete = report.ok && !FAST;", "report.complete = false; /* 定向回归，不是完整验收 */");
vm.runInThisContext(`(function(require,__dirname,__filename){${source}\n})`, { filename: basePath })(require, __dirname, basePath);
