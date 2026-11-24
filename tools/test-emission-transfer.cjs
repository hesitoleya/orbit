'use strict';
// Quantify sqrt-UNORM trilinear bias on the deployed M51 medium.
// This is an analysis guard, not a browser/GPU acceptance test.
const fs=require('fs'),zlib=require('zlib'),crypto=require('crypto'),assert=require('assert/strict');
const manifest=JSON.parse(fs.readFileSync('public/data/cinematic-nebula/manifest.json','utf8'));
const p=manifest.profiles.find(x=>x.type===13);assert(p&&p.emissionEncoding==='sqrt-unorm8');
const gz=fs.readFileSync('public/data/cinematic-nebula/'+p.medium.file),raw=zlib.gunzipSync(gz);
assert.equal(crypto.createHash('sha256').update(gz).digest('hex'),p.medium.sha256);
assert.equal(crypto.createHash('sha256').update(raw).digest('hex'),p.medium.rawSha256);
const [W,H,D]=p.medium.dimensions;assert.equal(raw.length,W*H*D*4);const at=(x,y,z,c)=>raw[(((z*H+y)*W+x)*4)+c]/255;
let seed=0x9e3779b9;const rnd=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
let maxBias=0,sumBias=0,sumVar=0,maxVar=0,count=0,nonzero=0;
for(let q=0;q<20000;q++){
 const x=Math.floor(rnd()*(W-1)),y=Math.floor(rnd()*(H-1)),z=Math.floor(rnd()*(D-1)),fx=rnd(),fy=rnd(),fz=rnd();
 for(let c=0;c<3;c++){
  let hw=0,correct=0,ws=0;
  for(let dz=0;dz<2;dz++)for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++){
   const w=(dx?fx:1-fx)*(dy?fy:1-fy)*(dz?fz:1-fz),v=at(x+dx,y+dy,z+dz,c);hw+=w*v;correct+=w*v*v;ws+=w;
  }
  assert(Math.abs(ws-1)<1e-12);const bias=correct-hw*hw;const variance=bias;
  assert(bias>=-1e-12&&bias<=.25+1e-12);maxBias=Math.max(maxBias,bias);sumBias+=bias;sumVar+=variance;maxVar=Math.max(maxVar,variance);count++;if(bias>1e-8)nonzero++;
 }
}
const report={asset:p.id,dimensions:p.medium.dimensions,encoding:p.emissionEncoding,samples:count,maxBias:maxBias,meanBias:sumBias/count,maxVariance:maxVar,nonzeroFraction:nonzero/count,formula:'sum(w*encoded^2) - sum(w*encoded)^2 = weighted encoded variance',interpretation:'Correcting this requires eight decoded corner values or a linear-emission representation. It is intentionally not mixed into v207 light-cache acceptance.'};
assert(report.maxBias>0&&report.nonzeroFraction>.1);console.log(JSON.stringify(report,null,2));console.log('PASS source gzip/raw SHA, dimensions, sqrt transfer bias quantified on deployed M51 medium; no asset mutation');
