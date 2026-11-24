'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict');
const volume=fs.readFileSync('public/js/main-volumes.js','utf8');
assert(volume.includes('uAnalyticSteps:{value:96}'));
assert(volume.includes('uAnalyticSupportCull:{value:0}'));
const branch=volume.slice(volume.indexOf('float analyticSteps='),volume.indexOf('// Premultiplied radiance'));
assert(branch.includes('clamp(floor(uAnalyticSteps+.5),64.0,96.0)'));
assert(branch.includes('float ds=(b-a)/analyticSteps;'));
assert(branch.includes('if(float(i)>=analyticSteps)break;'));
assert(branch.includes('a+(float(i)+.5)*ds'));
assert(branch.includes('exp(-m.a*ds)'));
assert(branch.includes('(1.0-tr)/m.a:ds'));
assert(!branch.includes('96.0/analyticSteps'));
assert(volume.indexOf('if(uAnalyticSupportCull>.5&&radius>=1.18)return vec4(0.0)')<volume.indexOf('float n=fb(p*8.0+uSeed)'));
const smoothstep=(a,b,x)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
for(const radius of [1.18,1.1800001,1.3,2])assert.equal(1-smoothstep(.88,1.18,radius),0);
for(const [a,b] of [[0,2.6],[.4,.41],[0,.3],[1,1.5]])for(const N of [64,80,96]){
 const ds=(b-a)/N;
 assert(Math.abs(N*ds-(b-a))<1e-12);
 assert(Math.abs((a+(N-.5)*ds)-(b-ds/2))<1e-12);
 for(const sigma of [0,.01,1,10]){
  let trans=1,rad=0;const emit=1.7;
  for(let i=0;i<N;i++){const tr=Math.exp(-sigma*ds),segment=sigma>.00001?(1-tr)/sigma:ds;rad+=trans*emit*segment;trans*=tr;}
  const expected=sigma?emit*(1-Math.exp(-sigma*(b-a)))/sigma:emit*(b-a);
  assert(Math.abs(rad-expected)<1e-10);
  assert(Math.abs(trans-Math.exp(-sigma*(b-a)))<1e-10);
 }
}
console.log('PASS analytic default96, disabled support experiment, full interval and homogeneous transfer at64/80/96; not GPU visual parity');
