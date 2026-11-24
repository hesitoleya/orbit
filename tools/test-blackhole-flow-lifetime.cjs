'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict');
const app=fs.readFileSync('public/js/app.js','utf8');
for(const s of ['float ageA = mod(t, 12.0);','float ageB = mod(t + 6.0, 12.0);','tri * tri * (3.0 - 2.0 * tri)','float stretchA = 1.0 + 3.9 * om * ageA;','gasNoise(qA, footprint * stretchA)','gasNoise(qB, footprint * stretchB)'])assert(app.includes(s),s);
assert(!app.includes('float ang = phi - om * t * 2.6;'),'unbounded winding removed');
assert(app.includes('BH.mat.uniforms.uTime.value = BH.time % 12;'),'reduce before float upload');
const upload=t=>Math.fround(t%12);
assert.equal(Math.fround(86400-.001),Math.fround(86400+.001),'raw 24h probe is indistinguishable');
for(const t of [86400,1e7,1e9]){
 const before=upload(t-.001),after=upload(t+.001);
 assert.notEqual(before,after,'bounded float retains distinct adjacent frames');
 assert(before>=0&&before<12&&after>=0&&after<12);
}
const mod=(x,m)=>((x%m)+m)%m;
function flow(t,r,phi){const a=mod(t,12),b=mod(t+6,12),tri=Math.abs(a-6)/6,w=tri*tri*(3-2*tri),om=1/Math.pow(r,1.5);const signal=age=>{const angle=phi-om*age*2.6;return Math.sin(1.7*r*Math.cos(angle)+.8*r*Math.sin(angle))+.2*Math.cos(3.1*r*Math.sin(angle));};return {a,b,w,value:(1-w)*signal(a)+w*signal(b),stretch:Math.max(1+3.9*om*a,1+3.9*om*b)};}
for(const r of [3,4,8,16])for(const phi of [-Math.PI,-1,0,Math.PI])for(const boundary of [0,6,12,18,60,600,3600,86400]){
 const e=1e-5,left=flow(boundary-e,r,phi),center=flow(boundary,r,phi),right=flow(boundary+e,r,phi);
 assert(Math.abs(left.value-right.value)<1e-3,'no reset jump');
 const dl=(center.value-left.value)/e,dr=(right.value-center.value)/e;
 assert(Math.abs(dl-dr)<.002,'smooth velocity at parcel replacement');
 assert(center.a<12&&center.b<12);assert(center.w>=0&&center.w<=1);assert(center.stretch<=1+3.9*12/Math.pow(3,1.5));
 assert(Math.abs(flow(boundary,r,phi).value-flow(boundary+12,r,phi).value)<1e-8,'explicit finite cycle, no unlimited winding');
}
console.log('PASS bounded parcel ages and shear, zero-weight resets, C1 blend and 24h boundary oracle. Scalar signal verifies blending algebra, not physical gas or actual GPU noise continuity.');
