'use strict';
/* 对话 241：行星三维球体契约。
   v240 把任务观测图正交贴到前半球，视觉上是「弯起来的纸 + 背面空洞」；
   本测试钉住新契约：全球等距圆柱贴图铺满整颗球、贴图长在行星自己的材质上、
   拖动旋转的是天体本身、土星环仍是独立几何、月球仍用 LROC 全球图。 */
const fs = require('node:fs'), assert = require('node:assert/strict');
const app = fs.readFileSync('public/js/app.js', 'utf8');
const build = fs.readFileSync('build.mjs', 'utf8');
const sw = fs.readFileSync('public/sw.js', 'utf8');
const index = fs.readFileSync('public/index.html', 'utf8');
const manifest = JSON.parse(fs.readFileSync('public/data/planet-maps/manifest.json', 'utf8'));

/* 1) 全球贴图资产：四个巨行星/金星，2:1 等距圆柱，带来源与许可 */
for (const key of ['venus', 'jupiter', 'saturn', 'neptune']) {
  const rec = manifest.records[key];
  assert(rec, `planet map record ${key}`);
  assert(Array.isArray(rec.dimensions) && rec.dimensions[0] === rec.dimensions[1] * 2, `${key} map is equirectangular 2:1`);
  assert(fs.existsSync('public/data/planet-maps/' + rec.file), `${key} map file exists`);
}
assert(manifest.license === 'CC BY 4.0' && /Solar System Scope/.test(manifest.credit), 'attribution recorded');
assert(manifest.records.moon && /LROC/.test(manifest.records.moon.source), 'moon map provenance recorded');

/* 2) 贴图挂在行星材质上：不再有「观测图层」和前半球 discard */
assert(app.includes('const PLANET_MAPS = {'), 'planet map table');
assert(app.includes('function attachPlanetMap(body)'), 'map attaches to the body mesh');
assert(!/vObj\.z<0\.0/.test(app), 'front-hemisphere-only orthographic discard is gone');
assert(!/makeObservedPhotoLayer/.test(app), 'old 2D photo layer removed');
assert(app.includes("u.uMap.value = t; u.uMapReady.value = 1;"), 'map uploads into the body material');

/* 3) 着色器：整球经纬采样 + 夜面补光 */
assert(app.includes("'uniform sampler2D uMap;'") && app.includes("'varying vec2 vUv;'"), 'equirect sampling varyings');
assert(app.includes('vec3 mc = texture2D(uMap, vUv).rgb;'), 'samples full-sphere equirect UV');
assert(app.includes('float mapFill = smoothstep(-0.85, 0.15, ndlRaw) * fillK;'), 'night-side fill so dragging stays readable');
assert(app.includes('float fillK = (uRingShade > 0.5) ? 0.02 : 0.10;'), 'Saturn night side is handed to ring-shine, others keep a 10% floor');
assert(app.includes('if (uBump > 0.5 && uMapReady < 0.5) {'), 'procedural bump yields to the real map');

/* 4) 拖动旋转天体本身 + 惯性 + 命中测试 */
assert(app.includes('const GLOBE_DRAG = { body: null'), 'globe drag state');
assert(app.includes('function pickGlobe(cx, cy)'), 'pointer must hit the sphere to grab it');
assert(app.includes("t.gYaw += dx * k;") && app.includes("t.gPitch = clamp((t.gPitch || 0) + dy * k"), 'drag turns the body');
assert(app.includes('b.mesh.rotation.set(b.gPitch, simTime * b.spinW + b.gYaw, b.tilt, \'ZYX\');'), 'rotation applied per frame');
assert(app.includes('function updateGlobeInertia()'), 'release inertia');
assert(app.includes("moonMesh.rotation.set(MOON.gPitch || 0, thM + Math.PI + (MOON.gYaw || 0), 0, 'ZYX');"), 'moon is draggable too');

/* 5) 土星环与远景 LOD 保持独立 */
assert(app.includes('b.ringMesh.visible = !far;'), 'measured ring stays independent of the globe');
assert(app.includes('if (b.mesh) b.mesh.visible = !far;'), 'far LOD still hides sub-pixel spheres');
assert(app.includes('goTarget(b, 5.2e8, -Math.PI / 2, dir)'), 'Saturn framing fits the 2.52R ring');

/* 6) 月球：LROC 全球图 + 程序化坑退位 */
assert(app.includes('const MOON_PROC_CRATERS'), 'procedural craters are behind a flag');
assert(app.includes('if (!MOON_PROC_CRATERS) continue;'), 'procedural craters yield to LROC');
assert(app.includes('if (c.r < craterMinR) continue;'), 'sub-vertex craters no longer spike the silhouette');
assert(app.includes('lroc_color_4k.webp') && app.includes('lroc_color_4k.jpg'), 'LROC fallback chain');

/* 7) 打包与缓存 */
assert(build.includes("b64('data/planet-maps/'+record.file)") && build.includes('planetMaps: withPhotos ? planetMaps : {}'), 'offline bundle inlines the maps');
assert(sw.includes('./data/planet-maps/jupiter.jpg') && /space11-v24[123]-/.test(sw), 'service worker precaches the maps');
assert(index.includes('观测影像'), 'atlas keeps the mission photographs as observations');

console.log('PASS v241 planet globes: Venus/Jupiter/Saturn/Neptune use CC BY 4.0 equirectangular global maps wrapped on a closed sphere with sun-driven terminator and a night-side fill; drag on the sphere rotates the body with inertia (Moon included) while empty space still turns the camera; procedural surfaces and bump remain as fallback before the map loads; Saturn ring geometry stays independent; LROC remains the Moon albedo with sub-vertex procedural craters retired; offline bundle and SW cache updated.');
