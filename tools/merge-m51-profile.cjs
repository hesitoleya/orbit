'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict');
const file='public/data/cinematic-nebula/manifest.json',p=JSON.parse(fs.readFileSync('public/data/cinematic-nebula/m51-profile.json','utf8')),m=JSON.parse(fs.readFileSync(file,'utf8'));
assert.equal(p.type,13);p.disableDetail=true;p.dimensions=p.medium.dimensions;p.license={id:'CC-BY-4.0',credit:p.source.credit,url:p.source.licenseURL,notes:p.interpretation};
m.profiles=m.profiles.filter(x=>x.type!==13).concat(p);
m.license.notes='Per-profile licenses authoritative: original mathematical fields CC0, NASA/STScI Pillars source terms, M51 Hubble image-guided derivative CC BY 4.0 with full credit and invented depth.';
m.dimensionsNote='Per-file dimensions authoritative: nebula heroes256³/aux128³; M51 medium512x64x512, black light1³.';
m.notes=m.notes.filter(x=>!x.startsWith('No image extrusion;'));m.notes.push('Nebula morphology is mathematical; M51 is explicitly an image-guided artificial-thickness reprojection, not observed 3D density or calibrated radiance.');
fs.writeFileSync(file,JSON.stringify(m,null,2)+'\n');console.log('Merged M51 profile 13; old profiles retained:',m.profiles.length);
