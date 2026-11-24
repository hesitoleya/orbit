'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const source = fs.readFileSync(path.join(__dirname, '../public/js/app.js'), 'utf8');
const extract = (pattern, label) => {
  const match = source.match(pattern);
  assert.ok(match, `无法提取 ${label}`);
  return match[1];
};
const auExpression = extract(/^const AU\s*=\s*([^;]+);/m, 'AU');
const tauExpression = extract(/^const TAU\s*=\s*([^;]+);/m, 'TAU');
const sysExpression = extract(/^const SYS\s*=\s*(\[[\s\S]*?^\]);/m, 'SYS');
const { AU, SYS } = vm.runInNewContext(
  `const AU = ${auExpression}; const TAU = ${tauExpression}; const SYS = ${sysExpression}; ({ AU, SYS })`,
  {}, { timeout: 1000 }
);
const keys = ['mercury', 'venus', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune'];

test('实际配置覆盖除地球以外的七颗行星，地球独立定义', () => {
  assert.deepEqual(Array.from(SYS, b => b.key), keys);
  assert.match(source, /const EARTH\s*=\s*\{\s*name:\s*['"]地球['"],\s*pos:\s*new THREE\.Vector3\(AU,\s*0,\s*0\)/);
  assert.ok(Number.isFinite(AU) && AU > 0);
});

test('行星几何、自转和颜色参数有限且符合几何约束', () => {
  for (const body of SYS) {
    for (const field of ['orbitR', 'radius', 'incl', 'phase', 'tilt', 'kind', 'spinW']) {
      assert.ok(Number.isFinite(body[field]), `${body.key}.${field} 必须有限`);
    }
    assert.ok(body.radius > 0 && body.orbitR > body.radius, `${body.key} 的尺寸或轨道无效`);
    assert.notEqual(body.spinW, 0, `${body.key} 自转速度不得为零`);
    assert.ok(Number.isInteger(body.kind) && body.kind >= 0, `${body.key}.kind 无效`);
    for (const field of ['tint', 'glow']) {
      assert.equal(body[field].length, 3, `${body.key}.${field} 应为三通道`);
      assert.ok(body[field].every(v => Number.isFinite(v) && v >= 0), `${body.key}.${field} 无效`);
    }
  }
});

test('轨道从内向外递增并在金星与火星之间包含地球', () => {
  const radii = Array.from(SYS, b => b.orbitR);
  for (let i = 1; i < radii.length; i++) assert.ok(radii[i - 1] < radii[i]);
  assert.ok(radii[1] < AU && AU < radii[2]);
  assert.match(source, /for\s*\(const b of SYS\)\s*mkOrbit\(b\.orbitR\);\s*mkOrbit\(AU\)/);
});

test('行星环配置可用于按行星半径缩放的环几何', () => {
  const ringed = SYS.filter(body => body.ring);
  assert.ok(ringed.length > 0, '至少有一个带环行星');
  assert.ok(ringed.some(body => body.key === 'saturn'), '土星应具有行星环');
  for (const { key, ring } of ringed) {
    assert.ok(Number.isFinite(ring.inner) && Number.isFinite(ring.outer));
    assert.ok(ring.inner > 1 && ring.outer > ring.inner, `${key} 环半径无效`);
    assert.ok(Number.isFinite(ring.tiltX), `${key} 环倾角无效`);
    assert.equal(ring.tint.length, 3);
    assert.ok(ring.tint.every(v => Number.isFinite(v) && v >= 0));
  }
  assert.match(source, /new THREE\.RingGeometry\(b\.ring\.inner,\s*b\.ring\.outer,/);
  assert.match(source, /b\.ringMesh\.scale\.setScalar\(b\.radius\)/);
});

test('P3 覆盖清单与源码数值和本地资产哈希一致', () => {
  const root = path.join(__dirname, '..');
  const audit = JSON.parse(fs.readFileSync(path.join(root, 'public/data/p3-solar-coverage.json'), 'utf8'));
  const expected = ['sun', 'mercury', 'venus', 'earth', 'moon', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune'];
  assert.deepEqual(audit.objects.map(body => body.id), expected);
  for (const planet of SYS) {
    const item = audit.objects.find(body => body.id === planet.key);
    assert.equal(item.radiusM, planet.radius, `${planet.key} 半径不一致`);
    assert.ok(Math.abs(item.orbitAU - planet.orbitR / AU) < 1e-12, `${planet.key} 轨道不一致`);
  }
  for (const item of audit.inspectedFiles) {
    const absolute = path.resolve(root, item.path);
    assert.ok(absolute.startsWith(root + path.sep), `路径越界: ${item.path}`);
    const bytes = fs.readFileSync(absolute);
    assert.equal(bytes.length, item.bytes, `${item.path} 字节数已变化`);
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), item.sha256, `${item.path} 哈希已变化，请重新审计而非直接更新哈希`);
  }
  for (const item of audit.objects) {
    for (const field of ['mainScene', 'localModel', 'modelClass', 'parameterSource', 'assetLicense', 'qualityTier', 'evidence']) assert.ok(item[field], `${item.id}.${field} 未填写`);
    assert.ok(item.gaps.length > 0, `${item.id} 应保留缺口`);
  }
});

test('GO 的七颗行星索引与 SYS 对应，地球单独指向 EARTH', () => {
  const go = extract(/^const GO\s*=\s*\{([\s\S]*?)^\};/m, 'GO');
  assert.match(go, /\bearth:\s*\(\)\s*=>\s*goTarget\(EARTH\s*,/);
  for (const key of keys) {
    const entry = go.match(new RegExp(`\\b${key}:\\s*\\(\\)\\s*=>\\s*goTarget\\(SYS\\[(\\d+)\\]\\s*,\\s*([^,]+),\\s*([^,)]+)\\)`));
    assert.ok(entry, `缺少 GO.${key}`);
    assert.equal(SYS[Number(entry[1])]?.key, key, `GO.${key} 指向错误`);
    const distance = Number(entry[2]);
    const pitch = Number(entry[3]);
    assert.ok(Number.isFinite(distance) && distance > SYS[Number(entry[1])].radius, `${key} 视距无效`);
    assert.ok(Number.isFinite(pitch), `${key} 俯仰角无效`);
  }
});
