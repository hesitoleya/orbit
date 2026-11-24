// Rebuild in memory and test the entire artifact against the explicitly expected UKS sort correction.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let source = fs.readFileSync(path.join(root, 'build.mjs'), 'utf8').replace(/\r\n/g, '\n');
function replaceOnce(before, after) {
  const chunks = source.split(before);
  assert.equal(chunks.length, 2, 'build boundary changed or is ambiguous');
  source = chunks[0] + after + chunks[1];
}
replaceOnce("const ROOT = path.dirname(fileURLToPath(import.meta.url));", `const ROOT = ${JSON.stringify(root)};`);
replaceOnce(`for (const name of ['space.html', 'index.html']) {
  fs.writeFileSync(path.join(ROOT, name), htmlOffline);
}
fs.writeFileSync(path.join(ROOT, 'space-http.html'), htmlHttp);`, `
for (const [name, rebuilt] of [['space.html', htmlOffline], ['index.html', htmlOffline], ['space-http.html', htmlHttp]]) {
  globalThis.__orbitCompare(name, rebuilt);
}
`);
globalThis.__orbitCompare = (name, rebuilt) => {
  const existing = fs.readFileSync(path.join(root, name), 'utf8');
  const prefix = '<script>window.__ORBIT_INLINE__=';
  const start = existing.indexOf(prefix), end = existing.indexOf(';</script>', start + prefix.length);
  assert.ok(start >= 0 && end > start, 'inline pack missing');
  assert.equal(existing.indexOf(prefix, start + prefix.length), -1, 'duplicate inline pack');
  const json = existing.slice(start + prefix.length, end);
  const pack = JSON.parse(json);
  const objects = pack.objects.filter(x => x.code === 'gc:UKS_1');
  assert.equal(objects.length, 1);
  assert.equal(objects[0].sort, 0);
  objects[0].sort = 300;
  const patched = existing.slice(0, start + prefix.length) + JSON.stringify(pack) + existing.slice(end);
  assert.ok(Buffer.from(patched).equals(Buffer.from(rebuilt)), `${name}: differences beyond expected inline UKS sort correction`);
  console.log(`PASS ${name}: entire rebuilt output matches existing artifact with only inline UKS 1 sort corrected`);
};
try { await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64')); }
finally { delete globalThis.__orbitCompare; }
console.log('No artifact written. This compares build output bytes after one explicit in-memory data change; it does not test rendering or runtime behavior.');
