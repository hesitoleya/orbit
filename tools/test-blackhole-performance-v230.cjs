'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict');
const app=fs.readFileSync('public/js/app.js','utf8');
const bh=app.slice(app.indexOf('const BH_FRAG = ['),app.indexOf('const BH = {',app.indexOf('const BH_FRAG = [')));
// Quality presets must stay inside the shader's hard loop and use no hidden second ray pass.
for(const s of ['[70, 0.52]','[110, 0.64]','[160, 0.75]','[220, 0.9]']) assert(app.includes(s),'missing quality preset '+s);
assert(bh.includes('for (int i = 0; i < 400; i++)'));
assert.equal((bh.match(/for \(int i = 0; i < 400; i\+\+\)/g)||[]).length,1);
assert(!bh.includes('for (int j = 0; j < 400; j++)'),'no nested geodesic loop');
assert(!bh.includes('texture2D')&&!bh.includes('texture('),'black-hole closeup has no per-step texture fetch');
// Disk FBM is only called from disk(hit), never as an independent full-screen pass.
const main=bh.slice(bh.indexOf("'void main(){"));
assert(!main.includes('fbm2('),'main must not noise-sample every geodesic step');
assert(app.includes('BH.scale = q[1]'));
console.log('PASS black-hole performance bounds: one bounded ray loop, preset budgets, no nested loop/full-screen noise/texture pass');
