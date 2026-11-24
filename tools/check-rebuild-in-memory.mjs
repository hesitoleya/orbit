// Re-run the current build entirely in memory, comparing output bytes without writing artifacts.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import crypto from 'node:crypto';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let source = fs.readFileSync(path.join(root, 'build.mjs'), 'utf8').replace(/\r\n/g, '\n');
function replaceOnce(before, after) {
  const parts = source.split(before);
  if (parts.length !== 2) throw new Error('Build source boundary missing or not unique; refusing to execute');
  source = parts[0] + after + parts[1];
}
replaceOnce("const ROOT = path.dirname(fileURLToPath(import.meta.url));", `const ROOT = ${JSON.stringify(root)};`);
replaceOnce(`for (const name of ['space.html', 'index.html']) {
  fs.writeFileSync(path.join(ROOT, name), htmlOffline);
}
fs.writeFileSync(path.join(ROOT, 'space-http.html'), htmlHttp);`, `
let mismatches = 0;
for (const [name, output] of [['space.html', htmlOffline], ['index.html', htmlOffline], ['space-http.html', htmlHttp]]) {
  const expected = Buffer.from(output);
  const actual = fs.readFileSync(path.join(ROOT, name));
  const same = expected.equals(actual);
  console.log((same ? 'PASS ' : 'FAIL ') + name + ' byte comparison; rebuilt sha256=' + globalThis.__orbitHash(expected));
  if (!same) mismatches++;
}
if (mismatches) process.exitCode = 1;
`);
globalThis.__orbitHash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
console.log('Checking existing files against in-memory rebuild; no output files will be written.');
try { await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64')); }
finally { delete globalThis.__orbitHash; }
