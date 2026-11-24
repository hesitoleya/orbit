'use strict';
// CPU morphology probes + generated-shader contracts. No GPU/visual acceptance claim.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(__dirname,'..'),source=fs.readFileSync(path.join(root,'public/js/main-volumes.js'),'utf8');
const context={console:{warn(){},log(){}}};context.window=context;
vm.runInNewContext(fs.readFileSync(path.join(root,'public/js/three.min.js'),'utf8'),context);
vm.runInNewContext(source,context);const shapes=context.ORBIT_NEBULA_SHAPES,p=shapes.parameters,s=shapes.sample,pool=context.createMainVolumes(context.THREE);
let count=0;function test(name,fn){fn();console.log('PASS '+(++count)+' '+name);}
const e=(t,x,y,z)=>s(t,[x,y,z],.5).emission,a=(t,x,y,z)=>s(t,[x,y,z],.5).absorption;
test('true XY torus has central and axial holes, not spherical shell',()=>{
 assert(e(7,p.ringRadius,0,0)>1);assert(e(7,0,0,0)<1e-10);assert(e(7,0,0,p.ringRadius)<1e-10);
 assert(e(7,p.ringRadius,0,0) > e(7,p.ringRadius,0,.30)*30);
});
test('Horsehead is absorption-led neck/head/snout with fixed positive-X asymmetry',()=>{
 assert(a(11,.29,.235,.03)>6);assert(a(11,.29,.235,.03)>e(11,.29,.235,.03)*100);
 assert(a(11,.29,.235,.03)>a(11,-.29,.235,.03)*3);
 assert(a(11,-.12,-.22,.03)>5);assert(a(11,-.055,.45,.025)>6);
 assert(e(11,.03,.04,-.43)>.65);assert(e(11,.03,.04,-.43)>e(11,.03,.04,.43)*100);
});
test('Horsehead foreground actually shadows luminous background under integration',()=>{
 function integrate(x,y){let trans=1,light=0;const dz=2.6/96;for(let i=0;i<96;i++){const q=s(11,[x,y,1.3-(i+.5)*dz],.5);light+=trans*q.emission*dz;trans*=Math.exp(-q.absorption*dz);}return light;}
 const head=integrate(.29,.235),beside=integrate(.52,.235);assert(head<beside*.65,{head,beside});
});
test('thick wind shell has empty cavity, finite thickness and distinct rim',()=>{
 const x=-.09+1.04*p.shellRadius;
 assert(e(12,x,.02,0)>.5);assert(e(12,-.09,.02,0)<1e-8);
 assert(e(12,x-.07,.02,0)>e(12,x,.02,0)*.5);
 assert(e(12,x+.45,.02,0)<e(12,x,.02,0)*.02);
});
test('Orion cloud has offset core, cavity and asymmetric veil',()=>{
 assert(e(6,-.16,-.03,.03)>e(6,.19,.17,.13)*4);
 assert(e(6,-.12,.34,-.25)>e(6,-.12,-.34,.25));
 assert(a(6,.16,-.16,.17)>e(6,.16,-.16,.17));
});
test('pillar caps emit above absorption-led trunk and remnant has angular filaments',()=>{
 const cx=.02,cz=.12,top=.52,x=cx+.055*Math.sin(top*3+cx*2);
 assert(e(9,x,top,cz)>e(9,cx,-.4,cz)*3);assert(a(9,cx,-.4,cz)>e(9,cx,-.4,cz)*3);
 const vals=[];for(let i=0;i<48;i++){const t=i*Math.PI*2/48;vals.push(e(8,p.remnantRadius*Math.cos(t),p.remnantRadius*Math.sin(t),0));}
 assert(Math.max(...vals)>Math.min(...vals)*3);assert(e(8,0,0,0)<1e-15);
});
test('all seven profiles are deterministic, finite, nonnegative and spatially bounded',()=>{
 for(let type=6;type<=12;type++)for(let x=-1.2;x<=1.2;x+=.2)for(let y=-1.2;y<=1.2;y+=.2)for(let z=-1.2;z<=1.2;z+=.4){
  const q=s(type,[x,y,z],.5),r=s(type,[x,y,z],.5);assert.deepEqual(q,r);
  for(const v of Object.values(q))assert(Number.isFinite(v)&&v>=0&&v<10);
 }
 for(let type=6;type<=12;type++){const q=s(type,[1.2,0,0]);assert.equal(q.emission,0);assert.equal(q.absorption,0);}
});
test('GLSL shares constants, matches shape branches and has no density camera terms',()=>{
 for(let type=6;type<=12;type++){
  const mesh=pool.create(type,31,[1,.8,.6]);const shader=mesh.material.fragmentShader;
  const profile=shader.slice(shader.indexOf('vec2 nebulaProfile'),shader.indexOf('vec4 medium'));
  assert(!/cameraPosition|vWorld|gl_FragCoord|sampler2D/.test(profile));
  assert(!profile.includes(',2.0)'),'signed squares use x*x, not undefined negative-base pow');
  assert(shader.includes('vec2 profile=nebulaProfile(p,n)'));assert(shader.includes('emit=uTint*profile.x;dust=profile.y;'));
  for(const value of Object.values(p))assert(shader.includes(value.toFixed(4)),'shared scalar '+value);
  assert(shader.includes('uType<11.5'));assert(shader.includes('length(p.xy)'));assert(shader.includes('for(int i=0;i<96;i++)'));
  assert.equal(mesh.material.depthTest,false);assert(shader.includes('b=min(b,dot(localHit-ro,rd))'));mesh.material.dispose();
 }
});
pool.dispose();console.log('PASS '+count+' morphology tests; CPU equations/contracts only, not GPU visual validation.');
