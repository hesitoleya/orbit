'use strict';
// Offline source/geometry/shader contract tests only. Never opens a browser or writes app/HTML.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { transformApp, MARKER } = require('./sun-sphere-patch.cjs');
const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'public/js/app.js'), 'utf8');
const formal = fs.readFileSync(path.join(root, 'space.html'), 'utf8');
let count = 0;
function test(name, fn) { fn(); count++; console.log(`ok ${count} - ${name}`); }
const patched = transformApp(app);
const section = (source, start, end) => {
  const a = source.indexOf(start); assert(a >= 0, start);
  const b = source.indexOf(end, a); assert(b > a, end);
  return source.slice(a, b + end.length).replace(/\r\n/g, '\n');
};
const meshStart = 'const sunMesh = new THREE.Mesh(';
const meshEnd = 'scene.add(sunMesh);';
const inlineScripts = [...formal.matchAll(/<script type="module">([\s\S]*?)<\/script>/g)];
const inline = inlineScripts.find(m => m[1].includes(meshStart))?.[1];
assert(inline, 'formal space.html app module exists');

test('pure string API and fail-closed missing anchors', () => {
  assert.throws(() => transformApp(null), TypeError);
  assert.throws(() => transformApp('const unrelated = 1;'), /expected one sun mesh/);
  assert.throws(() => transformApp(`${MARKER}: surface`), /incomplete prior patch/);
});
test('idempotent complete patch', () => assert.equal(transformApp(patched), patched));
test('transformed app parses without executing', () => {
  new vm.Script(patched.replace("import * as THREE from 'three';", 'const THREE = {};'));
});
test('current formal solar source has no fork from app.js', () => {
  for (const [a, b] of [
    [meshStart, meshEnd],
    ['const sunPoint = new THREE.Points(', 'scene.add(sunPoint);'],
    ['function updateSunGlare(K) {', 'const POST_VS = ['],
    ['  sunMesh.position.copy(SUN.pos).sub(origin);', '  moonMesh.position.copy(MOON.pos).sub(origin);'],
    ['  const sunCol = sunMesh.material.uniforms.uCol.value;', '  tu.uTime.value = now * 0.001;'],
    ['const BLOOM = {', 'const _glDir = new THREE.Vector3();']
  ]) assert.equal(section(inline, a, b), section(app, a, b), a);
});
test('formal HTML / inline accept same transform and retain formal-only injection', () => {
  const result = transformApp(inline);
  const htmlResult = transformApp(formal);
  assert.equal(section(result, meshStart, meshEnd), section(patched, meshStart, meshEnd));
  assert(htmlResult.includes(result));
  assert(htmlResult.includes('const __earthImagery'));
  assert(htmlResult.includes('earthSurface'));
  assert(htmlResult.includes('earthClouds'));
  assert.equal(transformApp(htmlResult), htmlResult);
  new vm.Script(result);
});
const sandbox = { console }; sandbox.window = sandbox;
vm.runInNewContext(fs.readFileSync(path.join(root, 'public/js/three.min.js'), 'utf8'), sandbox);
assert(sandbox.THREE, 'bundled THREE loaded without DOM/browser');
vm.runInNewContext(`const THREE = window.THREE; const R_SUN = 6.9634e8;
const scene = { add(){} }; const solarEmissionState={texture:new THREE.DataTexture(new Uint8Array([255,255,255,255]),1,1,THREE.RGBAFormat),ready:0}; ${section(patched, meshStart, meshEnd)}
window.testSunMesh = sunMesh;`, sandbox);
const sun = sandbox.testSunMesh;
test('real opaque 128x80 sphere with depth/logdepth', () => {
  assert.equal(sun.isMesh, true);
  assert.equal(sun.geometry.type, 'SphereGeometry');
  assert.equal(sun.geometry.parameters.radius, 6.9634e8);
  assert.equal(sun.geometry.parameters.widthSegments, 128);
  assert.equal(sun.geometry.parameters.heightSegments, 80);
  assert.equal(sun.material.transparent, false);
  assert.equal(sun.material.depthWrite, true);
  assert.equal(sun.material.depthTest, true);
  assert(sun.material.vertexShader.includes('logdepthbuf_vertex'));
  assert(sun.material.fragmentShader.includes('logdepthbuf_fragment'));
});
test('shader chunks exist in repository THREE, no unresolved generated JS escaping', () => {
  for (const shader of [sun.material.vertexShader, sun.material.fragmentShader]) {
    assert(shader.includes('\n')); assert(!shader.includes('\\n'));
    for (const m of shader.matchAll(/#include <([^>]+)>/g)) assert(sandbox.THREE.ShaderChunk[m[1]], m[1]);
  }
});
test('sphere-attached map and procedural 3D detail have derivative LOD, never screen billboard', () => {
  assert(sun.material.vertexShader.includes('vSunDir = normalize(position)'));
  assert(sun.material.fragmentShader.includes('sunCells(p)'));
  assert(sun.material.fragmentShader.includes('dFdx(p)'));
  assert(sun.material.fragmentShader.includes('mix(1.0, granule, resolved)'));
  assert(!/gl_PointCoord|gl_FragCoord|vUv/.test(sun.material.fragmentShader));
   assert.deepEqual([...sun.material.fragmentShader.matchAll(/uniform sampler2D (\w+);/g)].map(m=>m[1]),['uSolarMap']);
   assert(sun.material.fragmentShader.includes('texture2DGradEXT(uSolarMap,uv,dx,dy)'));
   assert(sun.material.fragmentShader.includes('atan(d.z,d.x)'));
   assert(sun.material.fragmentShader.includes('dx.x-=floor(dx.x+.5);dy.x-=floor(dy.x+.5)'));
  assert.equal((sun.material.fragmentShader.match(/spot \*= sunSpot/g) || []).length, 6);
});
test('bounded photosphere HDR and limb contrast without Lambert nightside', () => {
  const col = sun.material.uniforms.uCol.value;
  assert.deepEqual([col.r, col.g, col.b], [3000, 2910, 2760]);
  const limb = mu => 1 - 0.47 * (1-mu) - 0.23 * (1-mu)**2;
  assert(Math.abs(limb(0)-0.30) < 1e-9); assert.equal(limb(1), 1);
  // Output gain + both independently bounded broad bands; no new HDR blowout.
  assert.equal(sun.material.uniforms.uSolarMapReady.value,0);
   assert(0.45 * 3000 * 1.08 * 1.06 * 1.08 * 1.04 < 2000);
   // Loaded artistic map may exceed one, but preserves a finite linear HDR budget.
   const maxTexture=1.08*1.06*1.08*1.04;
   const maxMapped=(1+.06*(2.25-1))*(.94+.06*maxTexture);
   assert(.45*3000*(.12*maxTexture+.88*maxMapped)<2000);
   assert(sun.material.fragmentShader.includes('sourceContrast=clamp(pow(max(sourceLum,.0001)/.404,.85),.22,2.25)'));
   assert(sun.material.fragmentShader.includes('surfaceEmission=mix(vec3(textureK),sourceSolar*(.94+.06*textureK),.88*uSolarMapReady)'));
  assert(sun.material.fragmentShader.includes('0.45 * uCol'));
  assert(sun.material.fragmentShader.includes('largeBand * mediumBand * mix(1.0, granule, resolved)'));
  assert.equal(sun.material.toneMapped, true);
  assert(sun.material.fragmentShader.includes('tonemapping_fragment'));
  assert(sun.material.fragmentShader.includes('colorspace_fragment'));
});
test('solar lens gate restores projected glare; other stars/shared bloom untouched', () => {
  assert(patched.includes('function updateSunGlare(K) {\n  /* SUN_SPHERE_V1: solar lens gate'));
  const gate = section(patched, 'function updateSunGlare(K) {', '  if (!GLARE.on');
  assert(!gate.includes('GLARE.vis = 0;\n  return;'));
   assert(!patched.includes('GLARE.uv[1] = 0.56;'));
  for (const [a,b] of [
    ['function makeSpikeTex()', 'function makeStarTex()'],
    ['function makeStarGlowTex()', 'function makeCoronaTex()'],
    ['const BLOOM = {', 'const _glDir = new THREE.Vector3();'],
    ['function bloomStrength()', 'function ensurePost(w, h) {']
  ]) assert.equal(section(patched,a,b), section(app,a,b), a);
});
test('no solar halo, no journey-pinned solar point, tiny depth-tested far LOD', () => {
  const placement = section(patched, '  /* SUN_SPHERE_V1: placement', '  moonMesh.position.copy(MOON.pos).sub(origin);');
  assert(placement.includes('sunHalo.visible = false'));
  assert(!placement.includes('_cineSunDir')); assert(!placement.includes('JOURNEY'));
  assert(placement.includes('sunPoint.position.copy(sunMesh.position)'));
  const p = section(patched, 'const sunPoint = new THREE.Points(', 'scene.add(sunPoint);');
  assert(p.includes('gl_PointSize = 6.0;')); assert(!p.includes('46.0'));
  assert(p.includes('depthTest: true'));
});
test('CRLF source supported and duplicate anchors rejected', () => {
  assert(transformApp(app.replace(/\r?\n/g, '\r\n')).includes(`${MARKER}: surface`));
  assert.throws(() => transformApp(app + '\n' + section(app,meshStart,meshEnd)), /found 2/);
});
console.log(`PASS ${count} static solar patch tests; THREE r${sandbox.THREE.REVISION}; no browser/CDP, no production writes.`);
const normalizedInline = inline.replace(/\r\n/g, '\n').trim();
const normalizedApp = app.replace("import * as THREE from 'three';", 'const THREE = window.THREE;').replace(/\r\n/g, '\n').trim();
console.log(`INLINE_REPORT fullAppSame=${normalizedInline === normalizedApp} solarSectionsSame=true`);
if (normalizedInline !== normalizedApp) {
  const a = normalizedInline.split('\n'), b = normalizedApp.split('\n');
  const first = a.findIndex((line, i) => line !== b[i]);
  console.log(`INLINE_DIFF firstModuleLine=${first + 1} formal=${JSON.stringify(a[first]?.slice(0, 180))} app=${JSON.stringify(b[first]?.slice(0, 180))}`);
}
