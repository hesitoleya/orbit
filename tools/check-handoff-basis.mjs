// Read-only mathematical characterization of the current source's equatorial-to-cosmic basis.
// This does not modify the camera or claim rendered handoff continuity.
import * as THREE from '../public/js/three.module.min.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
const source = fs.readFileSync(fileURLToPath(new URL('../public/js/app.js', import.meta.url)), 'utf8').replace(/\r\n/g, '\n');
const begin = source.indexOf('function _eqDir(raDeg, decDeg, out) {');
const end = source.indexOf('\n/* 日心星表', begin);
assert.ok(begin >= 0 && end > begin && source.indexOf('function _eqDir(raDeg, decDeg, out) {', begin + 1) < 0, 'source boundaries changed or ambiguous');
const ctx = {THREE, DEG: Math.PI/180};
vm.runInNewContext(source.slice(begin, end) + '\nthis.api={eq:_eqDir, galWorld, GA};', ctx);
const {eq: rawEq, galWorld, GA} = ctx.api;
const eq = (ra,dec) => rawEq(ra, dec, new THREE.Vector3());
const {ngp,gc,yg} = GA;
const convert = v => {
  const n = v.clone().normalize();
  const ra = Math.atan2(n.z, n.x)*180/Math.PI;
  const dec = Math.asin(Math.max(-1,Math.min(1,n.y)))*180/Math.PI;
  return galWorld(ra, dec, v.length(), new THREE.Vector3());
};
const x = convert(new THREE.Vector3(1,0,0)), y = convert(new THREE.Vector3(0,1,0)), z = convert(new THREE.Vector3(0,0,1));
const determinant = x.clone().cross(y).dot(z);
const maxDot = Math.max(Math.abs(x.dot(y)), Math.abs(x.dot(z)), Math.abs(y.dot(z)));
const maxLengthError = Math.max(...[x,y,z].map(v => Math.abs(v.length()-1)));
console.log(JSON.stringify({basisSource:'public/js/app.js extracted _eqDir, GA and galWorld', inputBasisDot:gc.dot(ngp), determinant, maxDot, maxLengthError}, null, 2));
assert.ok(determinant < 0, 'mapping is expected to reverse handedness');
assert.ok(Math.abs(Math.abs(determinant) - 1) < 1e-5 && maxDot < 1e-5 && maxLengthError < 1e-5, 'basis departure exceeds bound');
const tests = [['galactic center',gc,[-1,0,0]], ['north galactic pole',ngp,[0,1,0]], ['galactic l=90',yg,[0,0,-1]]];
for (const [name,input, expected] of tests) {
  const result = convert(input).normalize(), error = result.angleTo(new THREE.Vector3(...expected))*180/Math.PI;
  assert.ok(error < 0.001, `${name}: ${error}°`);
  console.log(`PASS ${name}: error=${error.toFixed(6)}°`);
}
// A reflection transforms both forward and up but reverses the camera right vector:
// the identity is M(a×b) = det(M) (Ma×Mb) only for an orthogonal M.
const forward = eq(10.685,41.269).normalize(), up = new THREE.Vector3(0,1,0).addScaledVector(forward, -forward.y).normalize();
const right = forward.clone().cross(up).normalize();
const mappedRight = convert(right).normalize();
const cameraRight = convert(forward).cross(convert(up)).normalize();
const angle = mappedRight.angleTo(cameraRight)*180/Math.PI;
assert.ok(angle > 179.999, 'expected handedness reversal in camera basis');
console.log(`PASS mapped right versus reconstructed right: ${angle.toFixed(6)}°; converting direction/up alone mirrors horizontal camera basis`);
let maxMirrorError = 0, maxVerticalError = 0;
for (const [ra,dec] of [[0,0],[10.685,41.269],[83,-5],[192,27],[266,-29],[300,70]]) {
  const f = eq(ra,dec).normalize();
  const u = new THREE.Vector3(0,1,0).addScaledVector(f,-f.y).normalize();
  const r = f.clone().cross(u).normalize();
  const mf = convert(f).normalize(), mu = convert(u).normalize(), mr = mf.clone().cross(mu).normalize();
  const mappedUp = mr.clone().cross(mf).normalize();
  for (const [dx,dy] of [[0,0],[0.1,0.05],[-0.2,0.1],[0.08,-0.16]]) {
    const point = f.clone().addScaledVector(r,dx).addScaledVector(u,dy).normalize();
    const mapped = convert(point).normalize();
    const depth = mapped.dot(mf);
    const px = mapped.dot(mr)/depth, py = mapped.dot(mappedUp)/depth;
    maxMirrorError = Math.max(maxMirrorError, Math.abs(px+dx));
    maxVerticalError = Math.max(maxVerticalError, Math.abs(py-dy));
  }
}
assert.ok(maxMirrorError < 1e-5 && maxVerticalError < 1e-5, 'projection reflection exceeds basis rounding tolerance');
console.log(`PASS six view directions / 24 ideal projection samples: horizontal mirrored; max x error=${maxMirrorError}, y error=${maxVerticalError}`);
// Test Three.js camera matrices separately from ideal dot products. A projection-X flip
// is only a mathematical candidate; it changes winding/culling and needs renderer tests.
let uncorrectedMax = 0, correctedMax = 0, verticalMax = 0, depthMax = 0;
for (const [ra,dec] of [[0,0],[10.685,41.269],[83,-5],[192,27],[266,-29],[300,70]]) {
  const f = eq(ra,dec).normalize();
  const u = new THREE.Vector3(0,1,0).addScaledVector(f,-f.y).normalize();
  const r = f.clone().cross(u).normalize();
  for (const aspect of [16/9,1,9/16]) for (const fov of [40,65]) {
    const src = new THREE.PerspectiveCamera(fov,aspect,0.1,100);
    src.up.copy(u); src.lookAt(f); src.updateMatrixWorld(true);
    const dst = new THREE.PerspectiveCamera(fov,aspect,0.1,100);
    dst.up.copy(convert(u).normalize()); dst.lookAt(convert(f).normalize()); dst.updateMatrixWorld(true);
    const flipped = dst.projectionMatrix.clone();
    // Clip-space horizontal reflection; affects all x components including projection offsets.
    flipped.premultiply(new THREE.Matrix4().makeScale(-1,1,1));
    for (const [dx,dy] of [[0,0],[0.1,0.05],[-0.2,0.1],[0.08,-0.16]]) {
      const p = f.clone().addScaledVector(r,dx).addScaledVector(u,dy).multiplyScalar(5);
      const a = p.clone().project(src), mapped = convert(p);
      const b = mapped.clone().project(dst);
      const c = mapped.clone().applyMatrix4(dst.matrixWorldInverse).applyMatrix4(flipped);
      uncorrectedMax = Math.max(uncorrectedMax, Math.abs(a.x-b.x));
      correctedMax = Math.max(correctedMax, Math.abs(a.x-c.x));
      verticalMax = Math.max(verticalMax, Math.abs(a.y-c.y));
      depthMax = Math.max(depthMax, Math.abs(a.z-c.z));
    }
  }
}
assert.ok(uncorrectedMax > 0.1, 'negative control must exhibit a horizontal discrepancy');
assert.ok(correctedMax < 1e-5 && verticalMax < 1e-5 && depthMax < 1e-5, 'projection candidate mismatch');
console.log(`PASS Three.js matrices / 144 samples: negative-control max x=${uncorrectedMax}; reflected projection max xyz errors=${correctedMax},${verticalMax},${depthMax}`);
// A clip-space x reflection reverses projected winding, independently of the camera basis.
// This demonstrates the culling risk, not Three.js/WebGL renderer state behavior.
function area2(a,b,c) { return (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x); }
const ca=new THREE.PerspectiveCamera(60,16/9,0.1,100); ca.updateMatrixWorld(true);
const points=[new THREE.Vector3(-1,-1,-4),new THREE.Vector3(1,-1,-4),new THREE.Vector3(0,1,-4)];
const normal=points.map(p=>p.clone().project(ca));
const flip=ca.projectionMatrix.clone().premultiply(new THREE.Matrix4().makeScale(-1,1,1));
const mirrored=points.map(p=>p.clone().applyMatrix4(ca.matrixWorldInverse).applyMatrix4(flip));
const a=area2(...normal), b=area2(...mirrored);
assert.ok(a*b<0 && Math.abs(a+b)<1e-12, 'projection flip must reverse the sample winding');
console.log(`PASS triangle projected signed area changes ${a.toFixed(6)} → ${b.toFixed(6)}; culling strategy requires GPU validation`);
console.log('Limit: source-extracted basis and ideal CPU camera math only; no actual viewDirection runtime, shader, renderer culling, GPU pixel or browser validation.');
