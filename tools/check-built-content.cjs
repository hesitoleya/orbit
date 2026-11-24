'use strict';
// Read-only checks of build inputs against the existing artifacts; does not rebuild.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const app = read('public/js/app.js');
const appBuilt = app.replace(/import \* as THREE from 'three';/, 'const THREE = window.THREE;');
const deep = read('public/js/main-volumes.js');
const auth = read('public/js/auth.js');
const template = read('public/index.html');
let failures = 0;
function check(name, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ': ' + detail : ''}`);
  if (!ok) failures++;
}
function count(text, needle) { return text.split(needle).length - 1; }
check('template app/deep/auth tags', ['<script type="module" src="./js/app.js"></script>', '<script src="./js/main-volumes.js"></script>', '<script src="./js/auth.js"></script>'].every(s => count(template, s) === 1));
check('app import transformed', appBuilt !== app);
let sqlRows = null;
try { sqlRows = fs.readFileSync(path.resolve(root, '../orbit-server/src/main/resources/db/data.sql'), 'utf8').split(/\r?\n/).filter(line => /^\('/.test(line)).length; }
catch (e) { console.log(`SKIP external SQL row comparison: ${e.code || e.message}`); }
for (const name of ['space.html', 'index.html', 'space-http.html']) {
  const bytes = fs.readFileSync(path.join(root, name));
  const html = bytes.toString('utf8');
  console.log(`\n${name}: bytes=${bytes.length} sha256=${crypto.createHash('sha256').update(bytes).digest('hex')}`);
  check('transformed app content exactly once', count(html, appBuilt) === 1);
  check('main volume content exactly once', count(html, deep) === 1);
  check('auth content exactly once', count(html, auth) === 1);
  const prefix = '<script>window.__ORBIT_INLINE__=';
  const start = html.indexOf(prefix);
  const end = start < 0 ? -1 : html.indexOf(';</script>', start + prefix.length);
  let pack;
  try {
    if (start < 0 || end < 0 || count(html, prefix) !== 1) throw Error('missing or duplicate pack boundary');
    pack = JSON.parse(html.slice(start + prefix.length, end));
    check('inline pack parses', true);
  } catch (e) { check('inline pack parses', false, e.message); continue; }
  const objects = Array.isArray(pack.objects) ? pack.objects : [];
  check('catalog populated', objects.length > 0, `${objects.length} objects`);
  if (sqlRows !== null) check('catalog count equals current external SQL rows', objects.length === sqlRows, `artifact=${objects.length}, SQL=${sqlRows}; count only`);
  const photoCount = Object.keys(pack.photo || {}).length;
  const hdCount = Object.keys(pack.photoHD || {}).length;
  check('photo packaging matches entry type', name === 'space-http.html' ? photoCount === 0 && hdCount === 0 : photoCount > 0 && hdCount > 0, `photo=${photoCount}, photoHD=${hdCount}`);
}
console.log(`\n${failures} failure(s). Static substring/count checks only: not proof of full reproducible build, SQL content equivalence, resource licensing, or browser behavior.`);
process.exitCode = failures ? 1 : 0;
