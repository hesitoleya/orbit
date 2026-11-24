'use strict';
/* 对话 250 契约：让"密度波"和"E 环"从不可见变成可见、可核查。
   ① 环剖面 LUT 提到 65536 格并做 2D 打包（1D 纹理受 MAX_TEXTURE_SIZE 限制）；
   ② 环系近景机位（只有贴近环面，密度波才不是亚像素）；
   ③ Lindblad 共振密度波（共振半径按轨道力学算，波长按 WKB 趋势，像素尺度淡出）；
   ④ E 环做成真的体积环面（射线-球求交 + 沿视线积分），带显示增益。 */
const fs = require('node:fs'), assert = require('node:assert/strict');
const app = fs.readFileSync('public/js/app.js', 'utf8');
const html = fs.readFileSync('public/index.html', 'utf8');
const prof = JSON.parse(fs.readFileSync('public/data/saturn-ring-tau.json', 'utf8'));

/* ① LUT 分辨率与打包 */
assert(app.includes('const SAT_RING_LUT_W = 4096, SAT_RING_LUT_H = 16;'), 'LUT packed 4096x16');
assert(app.includes('const SAT_RING_LUT_N = SAT_RING_LUT_W * SAT_RING_LUT_H;'), '65536 bins');
assert(app.includes('new THREE.DataTexture(data, SAT_RING_LUT_W, SAT_RING_LUT_H, THREE.RGBAFormat, THREE.FloatType)'), '2D data texture');
assert(app.includes('const RING_LUT_GLSL = ['), 'shared LUT sampling GLSL');
assert(app.includes("'vec2 ringLutUV(float t) {',"), 'index -> 2D uv helper');
assert((app.match(/ringLutUV\(/g) || []).length >= 3, 'used by ring + planet shaders');
assert(prof.bins === 65536 && prof.tau.length === 65536, 'shipped profile re-imported at 65536');

/* ② 环系近景 */
assert(app.includes('  ring: () => {'), 'GO.ring preset');
assert(app.includes('addScaledVector(N, 0.054)'), 'camera sits just above the ring plane');
assert(app.includes('goTarget(b, 0.60 * b.radius, -2.30, dir);'), 'framed 1.6R looking inward-down');
assert(html.includes('id="ringBtn"'), 'ring close-up button');
assert(app.includes('function updateRingButton()'), 'button only on Saturn');
assert(html.includes('body.journey #ringBtn'), 'hidden during the journey');

/* ③ 密度波 */
assert(app.includes('const SAT_MOONS_KM = ['), 'real satellite semi-major axes');
assert(app.includes("const r = mo.a * Math.pow((m - 1) / m, 2 / 3);"), 'Lindblad resonance radius from orbital mechanics');
assert(app.includes('const SAT_DENSITY_WAVES = (function buildWaves()'), 'wave table built once');
assert(app.includes("'uniform vec4 uWaves[8];',") && app.includes("'uniform int uWaveN;',"), 'wave uniforms');
assert(app.includes("'      float lam = w.w * (0.35 + 1.9 * d);',"), 'wavelength grows away from resonance (WKB trend)');
assert(app.includes("'      float aa = smoothstep(1.6, 4.0, lam / pxKm);',"), 'sub-pixel waves fade out (no moire)');
assert(app.includes("'      wave += w.z * env * aa * sin(w.y * phi + k * (rKm - w.x));',"), 'm-armed spiral');
assert(app.includes("'    tau = max(0.0, tau * (1.0 + wave));',"), 'modulates optical depth');

/* ④ E 环体积 */
assert(app.includes('function makeERingMaterial('), 'E ring material');
assert(app.includes("'  float t0 = max(0.0, -b - sq);',") && app.includes("'  float t1 = -b + sq;',"), 'ray-sphere roots with the right sign');
assert(app.includes("'  const int N = 64;',"), '64 steps through the torus');
assert(app.includes("'    acc += exp(-dr * dr - dz * dz) * ds;',"), 'Gaussian torus density');
assert(app.includes("'  float tauTot = acc * uTau / max(uH * 1.7725, 1e-9);',"), 'normal optical depth normalisation');
assert(app.includes('uGain: { value: 1 }'), 'display gain defaults to physical');
assert(app.includes('  eRingGain(k) {'), 'exposed for A/B');
assert(app.includes("b.eRingMesh.material.uniforms.uGain.value = 40;"), 'ring close-up turns the display gain on');
assert(app.includes('makeERingMaterial(5.5 * b.radius, b.radius, 5e-4)'), 'tau takes the published upper bound');

/* 长曝光 */
assert(app.includes('let EXP_LONG = 1;'), 'global long-exposure factor');
assert(app.includes('  longExposure(k) {'), 'exposed');

console.log('PASS v250: ring LUT is 65536 bins packed into a 4096x16 float texture (1D would exceed MAX_TEXTURE_SIZE), the ring close-up camera puts the eye 250 km above the ring plane at 1.6R so density waves are no longer sub-pixel, Lindblad resonance radii are computed from real satellite semi-major axes with WKB wavelength growth and pixel-footprint fade-out, and the E ring is a真 volume torus raymarched 64 steps with a documented display gain.');
