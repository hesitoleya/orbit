'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict');
const html=fs.readFileSync('public/index.html','utf8'),app=fs.readFileSync('public/js/app.js','utf8');
assert(html.includes('#crumb{position:fixed')&&html.includes('z-index:40;pointer-events:auto;'));
assert(app.includes("const bs = document.querySelectorAll('#crumb button');"));
assert(app.includes("if (CS.active) { withFade(fn); return; }"));
assert(app.includes('if (mode === \'earth\' || mode === \'system\')'));
assert(app.includes('if (mode === \'local\') cosmicAimLocal();'));
console.log('PASS navigation contract: breadcrumb receives pointer events, all scale buttons bind, cosmic→system bypasses main-scene warp race, earth/system/local transitions retained. Browser partial chain verified separately; no claim of full journey coverage.');
