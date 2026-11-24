const fs=require('node:fs'),zlib=require('node:zlib'),crypto=require('node:crypto'),assert=require('node:assert/strict'),vm=require('node:vm');
const manifest=JSON.parse(fs.readFileSync('public/data/cinematic-nebula/manifest.json','utf8'));
let count=0;function pass(name){count++;console.log('PASS '+name);}
for(const p of manifest.profiles){
 const fields={};for(const role of ['medium','light','occupancy','shading']){
  const d=p[role];if(!d)continue;const raw=zlib.gunzipSync(fs.readFileSync('public/data/cinematic-nebula/'+d.file));
  assert.equal(raw.length,d.dimensions.reduce((a,b)=>a*b,1)*d.channels);
  assert.equal(crypto.createHash('sha256').update(raw).digest('hex'),d.rawSha256||d.uncompressedSha256);fields[role]=raw;
 }
 let independentEmission=0,solid=0;for(let i=0;i<fields.medium.length;i+=4){if(fields.medium[i+3]===0&&fields.medium[i]+fields.medium[i+1]+fields.medium[i+2]>0)independentEmission++;if(fields.medium[i+3]>10)solid++;}
 assert.ok(independentEmission>0);assert.ok(solid>100);pass(p.id+' hashes, native3D bytes, independent emission/extinction');
}
const source=fs.readFileSync('public/js/cinematic-assets.js','utf8');const window={CustomEvent:class{},dispatchEvent(){}};window.window=window;
vm.runInNewContext(source,{window,console,Map,Set,performance,Uint8Array,fetch:async()=>{throw Error('offline fixture');}});
assert.deepEqual(Array.from(window.ORBIT_CINEMATIC_ASSETS.status().ready),[]);assert.equal(window.ORBIT_CINEMATIC_ASSETS.get(6),null);assert.equal(window.ORBIT_CINEMATIC_ASSETS.setEnabled(false),false);pass('loader disabled and absent assets fail back without GPU access');
assert.ok(source.includes('T.NearestFilter'));assert.ok(source.includes('while(cache.size>2||')&&source.includes('144*1024*1024'));assert.ok(source.includes('root.crypto.subtle.digest'));assert.ok(source.includes('offset+value.length>expected'));pass('nearest conservative occupancy, bounded LRU, hash and bounded gzip decoding');
console.log(count+' asset contracts passed; not a GPU visual/performance acceptance.');
