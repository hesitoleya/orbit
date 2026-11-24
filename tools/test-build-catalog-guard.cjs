'use strict';
// Test the exact catalog parser/guard in a VM with injected reads; never touch build outputs.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'build.mjs'), 'utf8').replace(/\r\n/g, '\n');
const start = source.indexOf('function splitSqlRow(line) {');
const end = source.indexOf('\n/* 对话 161', start);
assert.ok(start >= 0 && end > start, 'catalog source boundaries missing');
const code = source.slice(start, end) + '\nthis.result = objects;';
function run(readFileSync) {
  const context = {fs: {readFileSync}, path, ROOT: root};
  vm.runInNewContext(code, context);
  return context.result;
}
assert.throws(() => run(() => { throw Object.assign(new Error('missing'), {code: 'ENOENT'}); }), /构建中止：档案 SQL 读取或解析失败/);
console.log('PASS missing catalog aborts');
assert.throws(() => run(() => '-- SQL without matching rows\n'), /未解析到任何对象/);
console.log('PASS empty catalog aborts');
const good = "('code','name','','','galaxy_spiral',10,20,30,40,NULL,'photo','',0,0,1,100),";
assert.equal(run(() => good).length, 1);
assert.equal(run(() => good.replace(/,$/, ';'))[0].sort, 100);
console.log('PASS terminating semicolon parses final sort value');
for (const [label, fixture, error] of [
  ['duplicate code', good + '\n' + good, /重复档案 code/],
  ['missing column', "('code','name'),", /字段不完整/],
  ['invalid number', good.replace(',10,20,', ',bad,20,'), /数值无效/],
  ['unterminated string', "('code','name", /字符串未闭合/]
]) {
  assert.throws(() => run(() => fixture), error);
  console.log(`PASS ${label} aborts`);
}
const actual = run((file, enc) => fs.readFileSync(file, enc));
assert.ok(actual.length > 0);
console.log(`PASS current SQL parses ${actual.length} objects`);
assert.ok(source.indexOf('构建中止：档案 SQL') < source.indexOf('fs.writeFileSync(path.join(ROOT, name), htmlOffline)'), 'guard must precede output writes');
console.log('PASS guard appears before output writes');
console.log('Limit: VM fault injection and static write ordering, not an end-to-end build in a separate filesystem.');
