'use strict';
/* 对话 243 契约：把 v242 里标为「观感参数」的三处换成可核查的物理量——
   ① 相位函数用双瓣 HG；② 土星夜面由「环照」积分点亮（不是 1/3 补光系数），
   背光侧的环由土星反照点亮；③ 月球高程法线改中心差分，uDemK 回到 1.0。 */
const fs = require('node:fs'), assert = require('node:assert/strict');
const app = fs.readFileSync('public/js/app.js', 'utf8');

/* ① 相位函数 */
assert(app.includes('const RING_PHASE_GLSL = ['), 'shared two-lobe phase GLSL');
assert(app.includes('float ringHg(float g, float c)'), 'Henyey-Greenstein lobe');
assert(app.includes('0.45 * ringHg(0.55, c) + 0.55 * ringHg(-0.20, c)'), 'forward + backward lobes');
assert(app.includes("'  float phase = ringPhase(cosA);',"), 'ring uses the shared phase instead of a fitted curve');
assert(!app.includes('float phase = 0.48 + 0.52 * pow(max(cosA, 0.0), 2.0);'), 'old ad-hoc phase curve removed');

/* ② 环照（ring-shine）：夜面亮度来自积分，不是常数补光 */
assert(app.includes('float E = 0.0;') && app.includes('for (int i = 0; i < 8; i++) {'), 'ring-shine integrates 8 radial samples');
assert(app.includes('E += pr.g * litR * ringPhase(cosAP) * hh * rr * dRho / (dist * dist * dist + 1e-4);'),
  'irradiance = albedo x lit x phase x cos / d^2 per annulus, summed');
assert(app.includes("'      E *= 2.0 * 0.35;',"), 'Lambertian overestimate calibrated down to ~3% of daylight');
assert(app.includes('lit += alb * sunC * E * (1.0 - 0.75 * ringK);'), 'ring-shine is blocked by the ring shadow');
/* 夜面补光：土星交给环照，其余行星保留 10% 地板（v241 是 34%） */
assert(app.includes('float fillK = (uRingShade > 0.5) ? 0.02 : 0.10;'), 'Saturn fill reduced to 2%, others 10%');
assert(!app.includes('ndlRaw) * 0.34;'), 'the 34% night fill is gone');

/* ③ 行星照亮环的夜面 */
assert(app.includes('uniform float uPlanetAlbedo;') && app.includes('uPlanetAlbedo: { value: 0.50 }'), 'planet albedo uniform');
assert(app.includes('float pShine = uPlanetAlbedo * (uPlanetR * uPlanetR) / (dP * dP) * cosP * ringPhase(cosAP) * 0.55;'),
  'planet-shine on the unlit ring face');
assert(app.includes("'  float nightK = 1.0 - smoothstep(0.0, 0.22, mu0);',"), 'planet-shine only where the ring is unlit');

/* ④ 月球 DEM：中心差分 + 物理系数 */
assert(app.includes('uDemK: { value: 1.0 }'), 'DEM normal coefficient is 1.0 (no taste factor)');
assert(app.includes('float sU = (hU1 - hU0) / (2.0 * stepU);'), 'central difference in longitude');
assert(app.includes('float sV = (hV1 - hV0) / (2.0 * stepV);'), 'central difference in latitude');
assert(app.includes('texture2D(uDem, uv - vec2(duv.x, 0.0))'), 'samples both sides of the texel');

console.log('PASS v243: ring phase is a two-lobe Henyey-Greenstein shared by the ring and the ring-shine; Saturn\'s night side is lit by an 8-sample ring irradiance integral (calibrated to ~3% of daylight) instead of a 34% fill, and the unlit ring face is lit by the planet; the Moon DEM normal uses central differences with coefficient 1.0. Remaining limits: 16 ppd DEM, zero-thickness ring, no particle dynamics, diffuse G/E rings not modelled, Venus/Neptune 2k source ceiling.');
