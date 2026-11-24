'use strict';
/* 对话 245 契约：月球 32 ppd 高清高程（LDEM_64 → 2×2 平均）。
   为什么要做：16 ppd = 1.9 km/px，在 1080p 窗口下已经和屏幕像素打平；
   但 `__SE.shot(3840,2160)` 出静帧时每像素只分到 ~0.9 km，16 ppd 就成了短板。
   工程约束：11520 宽超过不少 GPU 的 MAX_TEXTURE_SIZE(8192，实测 SwiftShader=8192)，
   所以按经度劈成两张 5760×5760。 */
const fs = require('node:fs'), assert = require('node:assert/strict');
const app = fs.readFileSync('public/js/app.js', 'utf8');
const sw = fs.readFileSync('public/sw.js', 'utf8');

/* 资产 */
const gz = 'public/data/moon-ldem32.d16.gz';
assert(fs.existsSync(gz), '32 ppd pack shipped');
const st = fs.statSync(gz);
const head = fs.readFileSync(gz, { encoding: null, flag: 'r' }).subarray(0, 2);
assert(head[0] === 0x1f && head[1] === 0x8b, 'pack is gzip');
assert(st.size > 60e6 && st.size < 90e6, 'pack size is ~74 MB (' + Math.round(st.size / 1048576) + ' MB)');
/* 16 ppd 原文件仍在（HTTP 优先用它，32 ppd 只在贴近时叠加） */
assert(fs.statSync('public/data/nasa-svs4720-ldem16-uint16le.bin').size === 5760 * 2880 * 2, '16 ppd source intact');

/* 加载与解包 */
assert(app.includes('function loadMoonDemHi()'), 'hi-res loader');
assert(app.includes("new DecompressionStream('gzip')"), 'decompress in the browser');
assert(app.includes('const HALF = 5760, GLOBW = 11520, GLOBH = 5760;'), 'split halves and global size');
assert(app.includes('acc += dv.getInt16(so + x * 2, true);'), 'row delta decode back to metres');
assert(app.includes('maxTex < 5760'), 'refuses when MAX_TEXTURE_SIZE is too small');
assert(app.includes("location.protocol === 'file:'"), 'no fetch in the offline single file');
assert(app.includes('cam.alt < 3.2e6'), 'lazy: only when close to the Moon');

/* 着色器：两张纹理 + 与 16 ppd 分支并存 */
assert(app.includes('uniform sampler2D uDemA;') && app.includes('uniform sampler2D uDemB;'), 'two split samplers');
assert(app.includes('float demTex(float side, vec2 p) {'), 'side selector helper');
assert(app.includes('if (uDemSplit > 0.5) {'), '32 ppd branch');
assert(app.includes('n = normalize(n - tE * ((hU1 - hU0) / (2.0 * stepU)) * uDemK - tN * ((hV1 - hV0) / (2.0 * stepV)) * uDemK);'),
  'central differences on the 32 ppd grid');

/* 几何 */
assert(app.includes('moonGeoFrom(sample, GLOBW, GLOBH, 2048, 1024)'), 'geometry raised to 2048x1024 (2.7 km/vertex)');
assert(app.includes('function moonGeoFrom(sample, W, H, segW, segH)'), 'sampler-based geometry builder');

/* 打包：74 MB 不进 SW 预缓存 */
assert(!sw.includes('moon-ldem32'), 'the 74 MB pack is not precached');

console.log('PASS v245: the Moon gains a lazy 32 ppd elevation pack (LDEM_64 2x2-averaged, half-metre int16 -> metres, row-delta + gzip 74 MB) decompressed with DecompressionStream; it is split into two 5760x5760 half-float textures because 11520 exceeds MAX_TEXTURE_SIZE on many GPUs; the shading normal uses central differences on that grid and the mesh is rebuilt at 2048x1024. Loads only when the camera is within 3.2e6 m, and never in the offline single file.');
