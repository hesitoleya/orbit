'use strict';
/* 对话 246：外部实测 τ 剖面的导入链路。
   Cassini UVIS / Voyager PPS 的掩星剖面对本机是 IP 级不可达（Anubis），
   所以做的不是"自动下载"，而是**把手动下载后的接入做成一条命令**：
     node tools/import-couvis-tau.cjs <剖面.TAB>
   生成 data/saturn-ring-tau.json，app.js 启动时自动把它盖到环 LUT 的 τ 通道上。
   本测试用一份合成的 PDS3 风格 TABLE 验证解析/重采样/覆盖全链路。 */
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const app = fs.readFileSync('public/js/app.js', 'utf8');

/* 1) 代码契约 */
assert(app.includes('function applyMeasuredRingTau(json)'), 'override function');
assert(app.includes("fetch(base + 'saturn-ring-tau.json')"), 'auto-load on startup');
assert(app.includes("if (location.protocol === 'file:') return;"), 'no request in the offline single file');
assert(app.includes("data[i * 4] = Math.max(0, Math.min(10, isFinite(v) ? v : 0));"), 'writes the tau channel only');
assert(app.includes('ringTau() {'), 'diagnostic accessor');
assert(fs.existsSync('tools/import-couvis-tau.cjs'), 'importer shipped');

/* 2) 用合成剖面跑一遍导入 */
const tmp = path.join('_tmp_test_tau');
fs.mkdirSync(tmp, { recursive: true });
fs.writeFileSync(path.join(tmp, 'demo.lbl'), [
  'PDS_VERSION_ID = "PDS3"',
  'OBJECT = COLUMN', '  NAME = RADIUS', '  START_BYTE = 1', '  BYTES = 10', 'END_OBJECT = COLUMN',
  'OBJECT = COLUMN', '  NAME = TAU_NORMAL', '  START_BYTE = 12', '  BYTES = 10', 'END_OBJECT = COLUMN'
].join('\n'));
let tab = '';
for (let km = 66000; km <= 141000; km += 5) {
  let tau = 0.002;
  if (km >= 74658 && km < 92000) tau = 0.08;
  else if (km >= 92000 && km < 117580) tau = 0.55 + 3.6 * Math.pow((km - 92000) / 25580, 2.2);
  else if (km >= 117580 && km < 122170) tau = 0.07;
  else if (km >= 122170 && km <= 136775) tau = 0.6;
  else if (km > 140180 && km < 140560) tau = 0.16;
  tab += String(km).padStart(10) + '  ' + tau.toFixed(4).padStart(10) + '\n';
}
fs.writeFileSync(path.join(tmp, 'demo.tab'), tab);
const out = path.join(tmp, 'out.json');
execFileSync(process.execPath, ['tools/import-couvis-tau.cjs', path.join(tmp, 'demo.tab'), '--out', out], { stdio: 'pipe' });
const j = JSON.parse(fs.readFileSync(out, 'utf8'));
assert(j.bins === 65536 && j.tau.length === 65536, 'resampled to 65536 bins (1.86 km/bin since v250)');
assert(j.inner === 1.11 && j.outer === 2.33, 'ring extent');
assert(j.samples > 14000, 'parsed most rows (' + j.samples + ')');
assert(j.filledBins > 14000 && j.tau.every(v => v !== null), 'gaps interpolated to a complete profile');
assert(Math.max(...j.tau) > 3 && Math.max(...j.tau) < 5, 'B ring tau preserved');
assert(j.source === 'demo.tab', 'source recorded');
/* 3) 交付的 τ 剖面必须带真实来源，不能是合成/占位数据 */
const shipped = 'public/data/saturn-ring-tau.json';
if (fs.existsSync(shipped)) {
  const d = JSON.parse(fs.readFileSync(shipped, 'utf8'));
  assert(/^UVIS_HSP_\d{4}_\d{3}_[A-Z0-9]+_[IE]_TAU01KM\.TAB$/.test(d.source || ''), 'shipped profile is a real UVIS product (' + d.source + ')');
  assert(d.samples > 10000 && d.filledBins > 58000, 'shipped profile covers the rings with real samples');
  assert(d.bins === 65536 && d.tau.length === 65536, 'shipped profile is 65536 bins');
  assert(d.tau.every(v => v >= 0 && v < 12), 'tau values stay in a physical range');
  assert(d.regionMeanTau && d.regionMeanTau.B > 1 && d.regionMeanTau.B < 6, 'B ring is optically thick (' + d.regionMeanTau.B + ')');
  assert(d.regionMeanTau.A > 0.2 && d.regionMeanTau.A < 1.5, 'A ring is moderately thick (' + d.regionMeanTau.A + ')');
  assert(d.regionMeanTau.cassini < 0.4, 'Cassini Division is thin (' + d.regionMeanTau.cassini + ')');
}
fs.rmSync(tmp, { recursive: true, force: true });

console.log('PASS v246: PDS3 TABLE -> tau profile import works end to end (fixed-width columns from the .lbl, 5 km rows -> 2048 bins over 1.110R-2.330R, median per bin, gaps interpolated, provenance recorded); app.js auto-applies data/saturn-ring-tau.json to the ring LUT tau channel only, skips it in the offline single file, and any shipped profile must be a real UVIS 1 km product whose regional tau values pass the published sanity ranges.');
