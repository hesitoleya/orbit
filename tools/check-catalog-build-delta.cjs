'use strict';
// Compare current SQL parser output with embedded objects in existing build artifacts.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'build.mjs'), 'utf8').replace(/\r\n/g, '\n');
const start = source.indexOf('function splitSqlRow(line) {'), end = source.indexOf('\n/* 对话 161', start);
assert.ok(start >= 0 && end > start);
const ctx = {fs, path, ROOT: root};
vm.runInNewContext(source.slice(start, end) + '\nthis.result = objects;', ctx);
const parsed = ctx.result;
for (const name of ['space.html', 'index.html', 'space-http.html']) {
  const html = fs.readFileSync(path.join(root, name), 'utf8');
  const marker = '<script>window.__ORBIT_INLINE__=', pos = html.indexOf(marker);
  const endPack = html.indexOf(';</script>', pos + marker.length);
  assert.ok(pos >= 0 && endPack > pos);
  const objects = JSON.parse(html.slice(pos + marker.length, endPack)).objects;
  assert.equal(objects.length, parsed.length);
  const diffs = [];
  for (let i = 0; i < objects.length; i++) for (const key of ['code','name','nameEn','alias','type','ra','decl','distanceLy','diameterLy','magnitude','description','sort']) {
    if (objects[i][key] !== parsed[i][key]) diffs.push({code: parsed[i].code, field:key, built:objects[i][key], parsed:parsed[i][key]});
  }
  assert.deepEqual(diffs, [{code:'gc:UKS_1', field:'sort', built:0, parsed:300}]);
  console.log(`PASS ${name}: only original SQL-mapped field difference is UKS 1 sort 0 → 300; photoKey/fallback excluded because build modifies them`);
}
console.log('Limit: compares only mapped SQL fields, not all build bytes, browser behavior or scientific correctness.');
