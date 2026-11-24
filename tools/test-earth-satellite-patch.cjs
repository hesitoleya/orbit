'use strict';
// No browser, CDP, server, or writes to app/html. Run: node tools/test-earth-satellite-patch.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { transformApp } = require('./earth-satellite-patch.cjs');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'public/js/app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'space.html'), 'utf8');
const start = html.indexOf('const MW_B64');
assert.ok(start >= 0, 'formal inline app start');
const formal = html.slice(start, html.indexOf('</script>', start));
const stripImport = s => s.replace(/^import\s+[^;]+;\s*$/mg, '');
for (const [name, app] of [['source', source], ['formal', formal]]) {
  const result = transformApp(app);
  new vm.Script(stripImport(result), { filename: name + '-satellite.js' });
  assert.equal(transformApp(result), result, 'idempotent');
  assert.ok(result.includes('if (PT.id === 0) return 0;'), 'zero physical terrain');
  assert.ok(result.includes('cam.alt = Math.max(200, cam.alt)'), 'camera surface guard');
  assert.ok(result.includes('if (S === scene) __satelliteEarthUpdate(K);'), 'all main-scene snapshots update');
  for (const token of ['terrainGroup.visible = false', 'vegGroup.visible = false',
    'bldGroup.visible = false', 'cloudQuad.visible = false', 'cirrusQuad.visible = false',
    'applyQuaternion(QeInv)', 'copy(origin).add(K.position).sub(EARTH.pos)',
    'texture2DGradEXT', 'gl_FragDepthEXT', 'RepeatWrapping']) assert.ok(result.includes(token), token);
  assert.ok(!result.includes("'./.workbuddy/"), 'no development asset dependency');
  // All input bytes survive in order except narrowly declared host hooks.
  // In particular, the official embedded image strings MUST remain untouched.
  if (name === 'formal') {
    for (const m of app.matchAll(/(?:tex|wxTex): load\(('data:image\/jpeg;base64,[^']+')\)/g)) {
      assert.ok(result.includes(m[0]), 'formal inline imagery preserved byte-for-byte');
    }
  }
  console.log(name + ': JS parse, hooks, assets, idempotence OK');
}
assert.throws(() => transformApp('no host'), /missing host anchor/);
assert.throws(() => transformApp(null), TypeError);
const threeBuild = fs.readFileSync(path.join(root, 'public/js/three.min.js'), 'utf8');
for (const alias of ['#define gl_FragDepthEXT gl_FragDepth', '#define texture2DGradEXT textureGrad']) {
  assert.ok(threeBuild.includes(alias), 'deployed Three WebGL2 compatibility alias: ' + alias);
}
console.log('deployed Three EXT depth/gradient aliases OK');
// Execute just the inserted runtime with narrow THREE stubs: verify reuse and
// uniform updates in floating-origin/Qe coordinates, without running Orbit boot.
class V3 {
  constructor(x = 0, y = 0, z = 0) { Object.assign(this, { x, y, z }); }
  copy(v) { Object.assign(this, { x: v.x, y: v.y, z: v.z }); return this; }
  add(v) { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
  sub(v) { this.x -= v.x; this.y -= v.y; this.z -= v.z; return this; }
  length() { return Math.hypot(this.x, this.y, this.z); }
  multiplyScalar(k) { this.x *= k; this.y *= k; this.z *= k; return this; }
  normalize() { return this.multiplyScalar(1 / this.length()); }
  applyQuaternion(q) { // rotation about Y, sufficient for this deterministic fixture
    const x = this.x, z = this.z, a = q.angle;
    this.x = Math.cos(a) * x + Math.sin(a) * z;
    this.z = -Math.sin(a) * x + Math.cos(a) * z; return this;
  }
}
class M4 { copy() { return this; } invert() { return this; } makeRotationFromQuaternion() { return this; } }
class M3 { setFromMatrix4() { return this; } }
const texture = () => ({ image: { width: 8192 } });
const scene = { objects: [], add(o) { this.objects.push(o); } };
const c = {
  PTKey: 'earth', R_EARTH: 6371000, THREE: { Vector3: V3, Matrix3: M3, Matrix4: M4,
    RepeatWrapping: 1000, ClampToEdgeWrapping: 1001, LinearMipmapLinearFilter: 1008,
    LinearFilter: 1006, NoColorSpace: '', SRGBColorSpace: 'srgb',
    ShaderMaterial: class { constructor(o) { Object.assign(this, o); } },
    PlaneGeometry: class {}, Mesh: class { constructor(g, m) { this.geometry = g; this.material = m; } } },
  __earthImagery: { tex: texture(), wxTex: texture() },
  renderer: { capabilities: { getMaxAnisotropy: () => 16, logarithmicDepthBuffer: true } },
  scene, terrainMat: { uniforms: {} }, atmoGLSL: () => '// reused atmosphere',
  origin: new V3(149600000000 + 6371200, 0, 0), EARTH: { pos: new V3(149600000000, 0, 0) },
  QeInv: { angle: -Math.PI / 2 }, sunDir: new V3(1, 0, 0), sysPxPerRad: 1000,
  terrainGroup: {}, vegGroup: {}, bldGroup: {}, cloudQuad: {}, cirrusQuad: {},
  document: {getElementById:()=>null}, CS:{active:false},
  CLOUD_QUAD_ON: true
};
const patched = transformApp(source);
const runtime = patched.slice(patched.indexOf('/* ORBIT_EARTH_SATELLITE_V1 */'), patched.indexOf('function renderFrame('));
vm.createContext(c);
vm.runInContext(runtime, c);
c.K = { position: new V3(), projectionMatrix: new M4(), matrixWorld: new M4(), far: 1e15, updateMatrixWorld() {} };
vm.runInContext('__satelliteEarthUpdate(K)', c);
const sphere = scene.objects[0], U = sphere.material.uniforms;
assert.equal(U.uSurface.value, c.__earthImagery.tex, 'existing albedo reused, not reloaded');
assert.equal(U.uCloudFraction.value, c.__earthImagery.wxTex);
assert.ok(Math.abs(U.uEyeW.value.x - 6371200) < 1e-6, 'heliocentric cancellation done in CPU doubles');
assert.ok(Math.abs(U.uEyeEF.value.z - 6371200 / 6371000) < 1e-12, 'Qe inverse tracks rotated Earth');
assert.ok(Math.abs(U.uSunEF.value.z - 1) < 1e-12, 'same EF light frame');
assert.equal(c.terrainGroup.visible, false);
assert.ok(!/aDir|aH|aAmp|vn\(|fbm\(/.test(sphere.material.fragmentShader), 'no terrain shader logic');
assert.ok(!sphere.material.fragmentShader.includes('projectionMatrix *'), 'explicit fragment projection uniform');
// Analytic-root precision and date-line sampling contract.
for (const height of [200, 1000, 1e5, 1e7]) {
  const h = height / c.R_EARTH, b = -(1 + h), cc = h * (2 + h);
  const t = cc / (-b + Math.sqrt(b * b - cc));
  assert.ok(Math.abs(t * c.R_EARTH - height) < 1e-6, 'stable true-radius hit at ' + height);
}
const wrapDerivative = d => d - Math.floor(d + 0.5);
assert.ok(Math.abs(wrapDerivative(-0.9998) - 0.0002) < 1e-12);
const uv = (x, y, z) => [Math.atan2(z, x) / (2 * Math.PI) + 0.5, 0.5 - Math.asin(y) / Math.PI];
assert.deepEqual(uv(1, 0, 0), [0.5, 0.5]);
assert.equal(uv(0, 1, 0)[1], 0);
c.PTKey = 'desert'; vm.runInContext('__satelliteEarthUpdate(K)', c);
assert.equal(sphere.visible, false, 'non-Earth mode hides replacement');
console.log('runtime reuse/Qe/origin/light/visibility + ray/UV math OK');
console.log('PASS (static + mocked math only; no GPU/browser visual claim)');
