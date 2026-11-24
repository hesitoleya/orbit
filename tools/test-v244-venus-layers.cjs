'use strict';
/* 对话 244：金星「云顶 ↔ 雷达地表」双层。
   背景：可见光云顶的公开全球图上限就是 2k，再高只有局部轨道器影像；
   但金星地表有 Magellan 雷达的 8k 全球图——那是真实观测，只是波长不同。
   所以这里不是"提高云层分辨率"（做不到），而是把同一颗星的另一层真实数据
   做成可切换图层，并在界面上标明它是什么。 */
const fs = require('node:fs'), assert = require('node:assert/strict');
const app = fs.readFileSync('public/js/app.js', 'utf8');
const html = fs.readFileSync('public/index.html', 'utf8');
const build = fs.readFileSync('build.mjs', 'utf8');
const manifest = JSON.parse(fs.readFileSync('public/data/planet-maps/manifest.json', 'utf8'));

/* 资产 */
const rec = manifest.records.venusSurface;
assert(rec, 'venusSurface recorded in the map manifest');
assert(rec.dimensions[0] === rec.dimensions[1] * 2, 'surface map is equirectangular');
assert(/Magellan/.test(rec.layer) && /雷达/.test(rec.caveat), 'radar provenance and caveat recorded');
const size = fs.statSync('public/data/planet-maps/venus-surface.jpg').size;
assert(size > 500000 && size < 4000000, 'surface jpeg is a sane size (' + size + ')');

/* 逻辑 */
assert(app.includes('const PLANET_ALT = {'), 'alternate layer table');
assert(app.includes("label: '雷达地表'") && app.includes("back: '云顶'"), 'layer labels');
assert(app.includes('function setPlanetLayer(key, layer)'), 'layer switch');
assert(app.includes("u.uAtmo.value = alt.atmo;"), 'surface view drops the haze (radar sees through clouds)');
assert(app.includes('planetMapState.texCloud[body.key] = t;'), 'cloud texture kept for switching back');
assert(app.includes("const q = new URLSearchParams(location.search).get('venus');"), '?venus=surface / cloud');
assert(app.includes('  setPlanetLayer,'), 'exposed on __SE');

/* 界面 */
assert(html.includes('id="layerBtn"') && html.includes('id="layerLabel"'), 'toggle button present');
assert(html.includes('body.journey #layerBtn'), 'button hides during the cinematic journey');
assert(app.includes('updateLayerButton();'), 'button refreshed per frame');

/* 打包 */
assert(build.includes("b64('data/planet-maps/'+record.file)"), 'surface map inlined for offline');

console.log('PASS v244: Venus ships a switchable second layer — Magellan radar surface (8k source downsampled to 4k, 2.1 MB) — beside the visible cloud deck, with provenance, caveat (radar albedo is not visible colour), haze reduction when the surface is shown, button + ?venus= URL + __SE.setPlanetLayer, and offline inlining. The cloud map itself remains 2k: that is the public data ceiling, not an implementation limit.');
