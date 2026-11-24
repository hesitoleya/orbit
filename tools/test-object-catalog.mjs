import assert from 'node:assert/strict';
import { loadCatalog, parseCatalog } from '../server/object-catalog.mjs';
const rows = await loadCatalog();
assert.equal(rows.length, 268);
assert.equal(new Set(rows.map(x => x.code)).size, 268);
const bh = rows.filter(x => x.type === 'blackhole');
assert.equal(bh.length, 11);
assert(bh.some(x => x.code === 'cos:sgra'));
assert(bh.some(x => x.code === 'cos:m87bh'));
const sample = "('cos:test','O''Brien, A','Test','','blackhole',1,2,26000,1,NULL,'','quoted, text',0,0,0,200);";
const [record] = parseCatalog(sample);
assert.equal(record.name, "O'Brien, A");
assert.equal(record.magnitude, null);
assert.equal(record.description, 'quoted, text');
assert.throws(() => parseCatalog(sample + '\n' + sample), /Invalid catalog row/);
assert.throws(() => parseCatalog("('bad','Name','','','blackhole',NaN,2,3,4,NULL,'','',0,0,0,1);"), /Invalid catalog number/);
if (process.argv[2]) {
  const pages = await Promise.all([1, 2].map(async page => {
    const response = await fetch(new URL('/api/objects?page=' + page + '&size=200', process.argv[2]));
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.data.total, 268);
    assert.equal(payload.data.page, page);
    return payload.data.records;
  }));
  assert.equal(pages[0].length, 200);
  assert.equal(pages[1].length, 68);
  assert.deepEqual(pages.flat(), rows);
  console.log('PASS live catalog API: both pages exactly match SQL, 268 records / 11 black holes');
}
console.log('PASS catalog parsing: 268 unique records / 11 BH, apostrophes/commas/null, duplicate and invalid number rejection');
