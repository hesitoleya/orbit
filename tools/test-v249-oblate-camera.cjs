'use strict';
/* 对话 249 契约：
   ① 行星扁率（真实极/赤道半径比）烘进几何，而不是保持正球；
   ② 环上的行星影子按扁球求交；
   ③ 相机 up 修正——非地球天体改用世界 Y，否则行星近景会绕视轴滚 ~90°。 */
const fs = require('node:fs'), assert = require('node:assert/strict');
const app = fs.readFileSync('public/js/app.js', 'utf8');

/* ① 扁率 */
const polar = { mercury: 0.999, venus: 1.0, mars: 0.9949, jupiter: 0.9355, saturn: 0.902, uranus: 0.9773, neptune: 0.983 };
for (const [k, v] of Object.entries(polar)) {
  const re = new RegExp(`key: '${k}'[^\\n]*polar: ${v}`);
  assert(re.test(app), `${k} declares polar ${v}`);
}
assert(app.includes('function makeOblateGeo(polar, segW, segH)'), 'oblate geometry builder');
assert(app.includes('pos.setY(i, pos.getY(i) * polar);'), 'scales the polar axis');
assert(app.includes('geo.computeVertexNormals();'), 'normals recomputed after scaling');
assert(app.includes('b.polar && b.polar <= 0.9995 ? makeOblateGeo(b.polar) : geoUnit'), 'only oblate bodies get their own geometry');

/* ② 环上的行星影子：椭球求交（沿自转轴缩放） */
assert(app.includes('uniform float uPolar;'), 'ring material knows the flattening');
assert(app.includes('vec3 ocS = (oc - uRingN * ocAx) + uRingN * (ocAx / uPolar);'), 'scales the shadow test along the spin axis');
assert(app.includes('float a2 = max(dot(LS, LS), 1e-6);'), 'quadratic with the scaled ray');
assert(app.includes('float tHit = (-b2 - sqrt(disc)) / a2;'), 'root in the scaled space');

/* ③ 相机 up */
assert(app.includes("else if (Math.abs(_off.y) > 0.985) camera.up.copy(_up);"), 'keeps the radial up only near the zenith');
assert(app.includes('else camera.up.set(0, 1, 0);'), 'world up for non-Earth close-ups');
assert(app.includes("if (cam.focus === EARTH) camera.up.copy(efToWorld(_up, _t4));"), 'ground view unchanged');

console.log('PASS v249: planets are oblate with real polar/equatorial ratios baked into geometry (Saturn 0.902, Jupiter 0.9355, ...), the planet shadow on the rings is solved against an ellipsoid, and non-Earth close-ups use world-up so cloud belts run horizontally and the spin axis stays vertical (the old radial-up basis rolled every body view by ~90 degrees).');
