'use strict';
const assert=require('node:assert/strict');
const dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0),norm=a=>Math.sqrt(dot(a,a));
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
function trace(b,{factor=1,budget=400,distance=17.5,inc=0}={}){
  // Rotate both camera and direction: inclination cannot accidentally change impact parameter.
  let p=[distance*Math.cos(inc),distance*Math.sin(inc),b],v=[-Math.cos(inc),-Math.sin(inc),0];
  const h2=dot(cross(p,v),cross(p,v));
  let state='exhausted',min=norm(p),maxAngularError=0;
  for(let i=0;i<budget;i++){
    const r2=dot(p,p),r=Math.sqrt(r2);min=Math.min(min,r);
    if(r<1){state='captured';break;}
    if(r>42&&dot(p,v)>0){state='escaped';break;}
    const a=p.map(x=>-1.5*h2*x/(r2*r2*r));
    let dt=Math.max(.012,Math.min(1.1,.075*r*Math.sqrt(Math.max(r-1,.02))));
    dt=factor*Math.min(dt,.08*Math.max(norm(v),.05)/Math.max(norm(a),.00001));
    const pm=p.map((x,k)=>x+.5*dt*v[k]),vm=v.map((x,k)=>x+.5*dt*a[k]);
    const pm2=Math.max(dot(pm,pm),.000001),am=pm.map(x=>-1.5*h2*x/(pm2*pm2*Math.sqrt(pm2)));
    p=p.map((x,k)=>x+dt*vm[k]);v=v.map((x,k)=>x+dt*am[k]);
    assert(p.concat(v).every(Number.isFinite));
    const h=cross(p,v);maxAngularError=Math.max(maxAngularError,Math.abs(dot(h,h)-h2)/Math.max(h2,1));
  }
  return {state,min,h2,maxAngularError,direction:v.map(x=>x/norm(v))};
}
assert.equal(trace(0).state,'captured');
assert.equal(trace(1).state,'captured');
assert.equal(trace(8).state,'escaped');
assert.equal(trace(8,{budget:1}).state,'exhausted');
for(const b of [2.5,2.598,2.7,3,4,8]){
  const q=trace(b);assert(Math.abs(q.h2-b*b)<1e-10,'impact parameter changes h²');
  for(const inc of [-.62,0,.62]){const r=trace(b,{inc});assert.equal(r.state,q.state);assert(Math.abs(r.min-q.min)<1e-7,'rotation invariance');}
}
const convergence=[];
for(const b of [3,4,8]){
  const coarse=trace(b),half=trace(b,{factor:.5,budget:1600}),quarter=trace(b,{factor:.25,budget:3200});
  assert.equal(coarse.state,'escaped');assert.equal(half.state,'escaped');assert.equal(quarter.state,'escaped');
  const error=q=>norm(q.direction.map((x,k)=>x-quarter.direction[k]));
  assert(error(half)<error(coarse),'midpoint step refinement improves outgoing direction');
  assert(coarse.maxAngularError<.02,'bounded angular-momentum drift');
  convergence.push({b,coarseError:error(coarse),halfError:error(half),angularDrift:coarse.maxAngularError});
}
console.log(JSON.stringify(convergence));
console.log('PASS numerical transport: capture/escape/exhaustion, varying impact, rotation invariance, RK2 step convergence, bounded angular drift. CPU approximation, not exact GR or GPU visual proof.');
