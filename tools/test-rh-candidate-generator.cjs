'use strict';
// No disk writes/browser: execute the actual generator with captured outputs.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),filename=path.join(__dirname,'make-rh-candidate-preview.cjs');
const source=fs.readFileSync(filename,'utf8'),writes=new Map();
const fakeFs={readFileSync:fs.readFileSync,existsSync:()=>false,writeFileSync:(p,s,opt)=>{assert.equal(opt.flag,'wx');assert(!writes.has(p));writes.set(p,s);}};
const fakeRequire=id=>id==='node:fs'?fakeFs:require(id);
vm.runInNewContext(source,{require:fakeRequire,__dirname,process:{argv:['node',filename,'v4']},console:{log:()=>{}}},{filename});
assert.equal(writes.size,2);
for(const [p,s] of writes)assert.equal(s,fs.readFileSync(p,'utf8'),'Generated preview has drifted: '+p);
const app=writes.get(path.join(root,'public/js/rh-candidate-preview-v4.js'));
const html=writes.get(path.join(root,'public/rh-candidate-preview-v4.html'));
assert(app.includes('return out.set(-gx, gz, gy)'));
assert(app.includes('body.geometry.scale(1,1,-1)'));
assert(app.includes('dt.repeat.y = -1'));
assert(app.includes('kz = -r[8]'));
assert(app.includes('-r[8] * C_KPC'));
assert(app.includes('crossVectors(up, axis)'));
assert(app.includes('mainProjection:a.projection.toArray()'));
assert(app.includes('__rhReport.first=null; __rhReport.entry=null;'));
assert(!app.includes('P.multiply(__candS)'));
assert(!html.includes('Object.assign({},window.__ORBIT_INLINE__'));
assert(html.includes('js/rh-candidate-preview-v4.js'));
// Extract candidate curve and production table, verify handedness + late movement.
const curve=app.slice(app.indexOf('const __CAND_LOOK='),app.indexOf('let __rhLast='));
const table=app.slice(app.indexOf('const CINE_VIEW = ['),app.indexOf('function cineLgAt('));
const context={Math,smoothstep:(x,a,b)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);}};
vm.runInNewContext(table+'\n'+curve+'\nthis.look=__candLook;this.stations=CINE_VIEW;',context);
assert(Math.abs(context.look(21.0004)[0]-0.57582)<1e-12);
assert(Math.abs(context.look(22.2959-1e-8)[0]-context.look(22.2959+1e-8)[0])<1e-6);
assert.notEqual(context.look(24.4)[0],context.look(26.3)[0]);
// Refuse all outputs before any write if either output already exists.
let attempted=0;
const blocked={...fakeFs,existsSync:()=>true,writeFileSync:()=>{attempted++;}};
assert.throws(()=>vm.runInNewContext(source,{require:id=>id==='node:fs'?blocked:require(id),__dirname,process:{argv:['node',filename,'v4']},console}),/refusing overwrite/);
assert.equal(attempted,0);
console.log('PASS: exact v4 regeneration, RH patch guards, measured-prefix sign, late-curve continuity/movement, no partial inline table, refuse overwrite. CPU/source only; no GPU or visual acceptance.');
