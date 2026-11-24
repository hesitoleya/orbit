#!/usr/bin/env node
'use strict';
/* 把 PDS 环掩星剖面（COUVIS_8001 / VG_2801 等 PDS3 TABLE）导入成渲染用的 τ 剖面。
   用法：
     node tools/import-couvis-tau.cjs <剖面.TAB> [--label <同名.LBL>] [--out public/data/saturn-ring-tau.json]
                                     [--col-radius N] [--col-tau N]
   做的事：
     1. 读 .LBL 的列定义（NAME / COLUMN_NUMBER / START_BYTE / BYTES / MISSING_CONSTANT）；
     2. 自动判断是**逗号分隔**还是**固定宽度**（COUVIS 的 .TAB 实际是 CSV，标签里的
        START_BYTE 对不上，这一点踩过坑）；
     3. 找半径列（含 RADIUS）与法向光深列（含 NORMAL OPTICAL DEPTH 或 TAU，
        排除 MAXIMUM/MINIMUM/DETECTABLE 干扰列）；
     4. 按 1.110R–2.330R（R = 60268 km）重采样到 2048 格，每格取中位数，空格线性插值；
     5. 写出 JSON（含来源文件、样本数、空格数），app.js 启动时会自动读取并覆盖环 LUT 的 τ 通道。
   注意：τ 与恒星仰角相关（自引力尾迹）。优先用仰角高、质量好的剖面，并记录用的是哪条。 */
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
if (!args.length) { console.error('用法：node tools/import-couvis-tau.cjs <剖面.TAB> [--label a.LBL] [--out x.json] [--col-radius N] [--col-tau N]'); process.exit(2); }
const tabPath = args[0];
const getOpt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const lblPath = getOpt('--label', tabPath.replace(/\.tab$/i, '.lbl'));
const outPath = getOpt('--out', 'public/data/saturn-ring-tau.json');
const optNum = (k) => { const i = args.indexOf(k); return i >= 0 ? (+args[i + 1]) : -1; };

const R_KM = 60268, IN = 1.110, OUT = 2.330;
/* 与 app.js 的 SAT_RING_LUT_N 保持一致（65536 ≈ 1.86 km/格，近景不糊） */
const NBINS = (() => { const i = args.indexOf('--bins'); return i >= 0 ? (+args[i + 1]) : 65536; })();

/* ---------- 标签解析 ---------- */
function parseLabel(lbl) {
  const cols = [];
  const re = /OBJECT\s*=\s*COLUMN([\s\S]*?)END_OBJECT\s*=\s*COLUMN/gi;
  let m;
  while ((m = re.exec(lbl))) {
    const b = m[1];
    const nm = /NAME\s*=\s*"?([A-Z0-9_ ]+?)"?\s*$/im.exec(b);
    if (!nm) continue;
    const num = /COLUMN_NUMBER\s*=\s*(\d+)/i.exec(b);
    const sb = /START_BYTE\s*=\s*(\d+)/i.exec(b);
    const by = /BYTES\s*=\s*(\d+)/i.exec(b);
    const mc = /MISSING_CONSTANT\s*=\s*(-?[\d.]+)/i.exec(b);
    cols.push({
      name: nm[1].trim().toUpperCase(),
      num: num ? +num[1] : cols.length + 1,
      start: sb ? +sb[1] : null,
      len: by ? +by[1] : null,
      missing: mc ? parseFloat(mc[1]) : null
    });
  }
  return cols.sort((a, b) => a.num - b.num);
}

const tabLines = fs.readFileSync(tabPath, 'utf8').split(/\r?\n/);
let cols = [];
if (fs.existsSync(lblPath)) cols = parseLabel(fs.readFileSync(lblPath, 'utf8'));

const pick = (pred, opt) => (opt >= 0 ? opt - 1 : cols.findIndex(pred));
let ri = pick(c => /RADIUS/.test(c.name), optNum('--col-radius'));
let ti = pick(c => (/NORMAL\s+OPTICAL\s+DEPTH|TAU/.test(c.name)) && !/MAX|MIN|DETECTABLE/.test(c.name), optNum('--col-tau'));
if (ri < 0 || ti < 0) { console.error('找不到半径列或光深列；现有列：', cols.map(c => c.name).join(' | ')); process.exit(1); }
const missing = cols[ti].missing;

/* 格式探测：CSV 还是固定宽度 */
const firstData = tabLines.find(l => l.trim() && /\d/.test(l) && !/^[A-Z_]+\s*=/.test(l)) || '';
const csv = firstData.includes(',');

/* ---------- 逐行解析 ---------- */
const bins = Array.from({ length: NBINS }, () => []);
let rows = 0, used = 0, skippedMissing = 0;
for (const raw of tabLines) {
  const line = raw.replace(/\r$/, '');
  if (!line.trim() || /^[A-Z_]+\s*=/.test(line)) continue;
  let r = NaN, tau = NaN;
  if (csv) {
    const f = line.split(',');
    const vi = cols[ti].num - 1, vr = cols[ri].num - 1;
    r = parseFloat(f[vr]); tau = parseFloat(f[vi]);
  } else if (cols.length && cols.every(c => c.start && c.len)) {
    const cut = (c) => line.slice(c.start - 1, c.start - 1 + c.len);
    r = parseFloat(cut(cols[ri])); tau = parseFloat(cut(cols[ti]));
  } else {
    const f = line.trim().split(/[\s,]+/).map(Number);
    r = f[ri]; tau = f[ti];
  }
  rows++;
  if (!isFinite(r) || !isFinite(tau)) continue;
  if (missing != null && tau === missing) { skippedMissing++; continue; }
  if (tau < 0) { skippedMissing++; continue; }
  const t = (r / R_KM - IN) / (OUT - IN);
  if (t < 0 || t > 1) continue;
  const b = Math.min(NBINS - 1, Math.floor(t * NBINS));
  bins[b].push(tau); used++;
}

const tauOut = new Array(NBINS).fill(null);
let filled = 0;
for (let i = 0; i < NBINS; i++) {
  if (!bins[i].length) continue;
  const s = bins[i].slice().sort((a, b) => a - b);
  tauOut[i] = +s[Math.floor(s.length / 2)].toFixed(4);
  filled++;
}
if (!filled) { console.error('没有解析出任何样本：检查分隔符或列号（--col-radius/--col-tau）'); process.exit(1); }
let last = -1;
for (let i = 0; i < NBINS; i++) {
  if (tauOut[i] == null) continue;
  if (last >= 0 && i - last > 1) {
    for (let k = last + 1; k < i; k++) tauOut[k] = +(tauOut[last] + (tauOut[i] - tauOut[last]) * (k - last) / (i - last)).toFixed(4);
  }
  last = i;
}
/* 两端补齐：掩星的覆盖范围不一定正好等于 LUT 范围，两头用最近的实测值延伸 */
for (let i = 0; i < NBINS && tauOut[i] == null; i++) tauOut[i] = tauOut[last] || 0;
for (let i = NBINS - 1; i >= 0 && tauOut[i] == null; i--) tauOut[i] = tauOut[last] || 0;

const stats = (() => {
  /* 已知环区的量级对照，写进 JSON 方便核查 */
  const at = (from, to) => {
    const a = Math.floor(((from / R_KM - IN) / (OUT - IN)) * NBINS);
    const b = Math.ceil(((to / R_KM - IN) / (OUT - IN)) * NBINS);
    const seg = tauOut.slice(Math.max(0, a), Math.min(NBINS, b)).filter(v => v > 0);
    return seg.length ? +(seg.reduce((x, y) => x + y, 0) / seg.length).toFixed(3) : null;
  };
  return { C: at(76000, 90000), B: at(95000, 115000), cassini: at(118000, 121500), A: at(124000, 133000) };
})();

const out = {
  note: 'Cassini UVIS 恒星掩星实测法向光深 τ（1 km 剖面），按 1.110R–2.330R 重采样到 2048 格（土星赤道半径 60268 km）。反照率不在掩星数据里，仍按环区给。',
  source: path.basename(tabPath),
  label: fs.existsSync(lblPath) ? path.basename(lblPath) : null,
  inner: IN, outer: OUT, bins: NBINS,
  rows, samples: used, missingSkipped: skippedMissing, filledBins: filled,
  regionMeanTau: stats,
  tau: tauOut
};
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(out));
console.log('OK', outPath);
console.log('  行', rows, '| 有效样本', used, '| 缺失跳过', skippedMissing, '| 有值格', filled, '/', NBINS);
console.log('  区段平均 τ：C', stats.C, ' B', stats.B, ' 卡西尼缝', stats.cassini, ' A', stats.A);
console.log('  τ 范围', Math.min(...tauOut).toFixed(3), '–', Math.max(...tauOut).toFixed(3));
