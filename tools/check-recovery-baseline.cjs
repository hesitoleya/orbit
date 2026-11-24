'use strict';
// Read-only recovery baseline check. Hashes identify this run; they are not a trusted signature.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const required = ['space.html', 'index.html', 'space-http.html', 'public/index.html', 'public/deep-detail.html', 'public/catalog.html', 'public/js/app.js', 'public/js/deep-models.js', 'public/js/three.min.js', 'build.mjs', 'server/server.mjs'];
let failed = 0;
const entries = {};
for (const name of required) {
  try {
    const data = fs.readFileSync(path.join(root, name));
    entries[name] = {bytes: data.length, sha256: crypto.createHash('sha256').update(data).digest('hex')};
  } catch (e) {
    failed++;
    entries[name] = {error: e.code || e.message};
  }
}
const offlineEqual = !!entries['space.html'].sha256 && entries['space.html'].sha256 === entries['index.html'].sha256;
if (!offlineEqual) failed++;
const sql = path.resolve(root, '../orbit-server/src/main/resources/db/data.sql');
let sqlStatus;
try {
  const data = fs.readFileSync(sql);
  sqlStatus = {available: true, bytes: data.length, sha256: crypto.createHash('sha256').update(data).digest('hex')};
} catch (e) {
  sqlStatus = {available: false, error: e.code || e.message, note: 'Build falls back if this external source is missing; catalog completeness is not established.'};
}
console.log(JSON.stringify({checkedAt: new Date().toISOString(), root, node: process.version, entries, offlineEqual, externalSql: sqlStatus, failures: failed, limitations: ['Hashes are fingerprints, not proof of a correct build or trusted provenance.', 'No files were written and neither build nor browser behavior was tested.']}, null, 2));
process.exitCode = failed ? 1 : 0;
