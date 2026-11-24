'use strict';
/* 对话 242 契约：土星环的真实径向剖面 + 环/球互投影，月球 LOLA LDEM 真实高程。
   目标是把 v241 文档里写明的两块「未解决」变成可核查的实现。 */
const fs = require('node:fs'), assert = require('node:assert/strict');
const app = fs.readFileSync('public/js/app.js', 'utf8');
const build = fs.readFileSync('build.mjs', 'utf8');
const sw = fs.readFileSync('public/sw.js', 'utf8');

/* ---------- 土星环：真实环区半径 + τ 剖面 ---------- */
assert(app.includes('const SAT_RING_R = 60268;'), 'Saturn equatorial radius in km');
assert(app.includes('const SAT_RING_IN = 1.110;') && app.includes('const SAT_RING_OUT = 2.330;'),
  'ring extent = D ring inner to F ring');
for (const km of ['66900', '74510', '74658', '92000', '117580', '122170', '136775', '140180']) {
  assert(app.includes(km), `ring region boundary ${km} km present`);
}
for (const gap of ['133427', '136484']) assert(app.includes(gap), `named gap at ${gap} km (Encke / Keeler)`);
assert(app.includes('const satRingLut = (function buildSaturnRingLut()'), 'tau/albedo LUT built once');
assert(app.includes('THREE.DataTexture(data, SAT_RING_LUT_W, SAT_RING_LUT_H, THREE.RGBAFormat, THREE.FloatType)'), 'LUT is float RGBA, 2D-packed since v250');

/* ---------- 环的几何光学，而不是常数亮度 ---------- */
assert(app.includes('float lit = 1.0 - exp(-tau / max(mu0, 0.035));'), 'tau-based illumination');
assert(app.includes('float opa = 1.0 - exp(-tau / max(mu, 0.035));'), 'tau-based coverage');
assert(app.includes('float shadow = 1.0;') && app.includes('float disc = b2 * b2 - a2 * c2;'), 'planet shadows the ring (ellipsoid test since v249)');
assert(app.includes('float ringK = 0.0;') && app.includes('ndl *= trans;'), 'ring shadows the planet');
assert(app.includes('texture2D(uRingLut, ringLutUV((rr - uRingIn) / (uRingOut - uRingIn))).r'), 'same LUT read on the globe (2D-packed since v250)');
/* 真 bug 回归：Matrix3 被当成 16 元素矩阵读 → 法线 NaN */
assert(!/applyMatrix4\(new THREE\.Matrix3\(\)/.test(app), 'ring normal built without the Matrix3/applyMatrix4 NaN bug');
assert(app.includes('applyQuaternion(b.ringMesh.quaternion).normalize()'), 'ring normal from quaternion');
assert(app.includes("ring: { inner: 1.110, outer: 2.330"), 'SYSTEM ring config uses real radii');

/* ---------- 月球 LDEM ---------- */
assert(fs.existsSync('public/data/moon-ldem8.bin'), '8 ppd LDEM downsample shipped');
const ldem8 = fs.statSync('public/data/moon-ldem8.bin').size;
assert(ldem8 === 2880 * 1440 * 2, 'LDEM8 is 2880x1440 uint16');
const ldem16 = fs.statSync('public/data/nasa-svs4720-ldem16-uint16le.bin').size;
assert(ldem16 === 5760 * 2880 * 2, '16 ppd LDEM source present');
assert(app.includes('function moonDemHeight(') && app.includes('(u16[i] - 20000) * 0.5'), 'uint16 -> metres conversion');
assert(app.includes('THREE.RedFormat, THREE.HalfFloatType'), 'DEM uploaded as half-float R texture');
assert(app.includes('function moonGeoFromDem(h, W, H)') && app.includes('geo.computeVertexNormals();'), 'geometry displaced from DEM');
assert(app.includes('float stepU = 6.28318530718 * 1737400.0 * max(cos(lat), 0.06) / uDemW;'), 'per-pixel DEM slope in metres');
assert(app.includes('n = normalize(n - tE * sU * uDemK - tN * sV * uDemK);'), 'DEM gradients perturb the shading normal');
assert(app.includes("get(base + 'nasa-svs4720-ldem16-uint16le.bin')") && app.includes("get(base + 'moon-ldem8.bin')"),
  'HTTP prefers 16 ppd, falls back to 8 ppd');

/* ---------- 打包 ---------- */
assert(build.includes("b64('data/moon-ldem8.bin')") && build.includes('moonLdem: withPhotos ? moonLdem'), 'offline bundle inlines the 8 ppd DEM');
assert(sw.includes('./data/moon-ldem8.bin') && /space11-v24[23]-/.test(sw), 'SW precaches the DEM');

/* ---------- 取景 ---------- */
assert(app.includes('function sunlitDir(body, off, lift)'), 'planets are framed on the sunlit side');
assert(app.includes('goTarget(SYS[3], 2.6e8, -Math.PI / 2, sunlitDir(SYS[3], 0.72, 0.16))'), 'Jupiter framed 3/4 lit');

console.log('PASS v242: Saturn rings use a real radial tau/albedo profile (D/C/B/Cassini/A/Roche/F with named gaps), tau-based illumination and coverage, planet-shadow-on-ring and ring-shadow-on-globe from the same LUT, and the Matrix3->NaN normal bug is fixed; the Moon loads LOLA LDEM 16 ppd (8 ppd inline for offline), displaces its geometry and perturbs per-pixel normals from the measured elevation grid; planets are framed on the sunlit side. Data-source limits (16 ppd DEM, zero-thickness ring, no particle dynamics) remain documented.');
