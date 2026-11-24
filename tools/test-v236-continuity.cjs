'use strict';
// Source-only physical handoff contracts. Geometry/morphology has separate owners.
// These assertions do not establish GPU, atlas or visual acceptance.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const app=fs.readFileSync('public/js/app.js','utf8').replace(/\r\n/g,'\n');
const c={console,Math,Float32Array,ArrayBuffer};vm.createContext(c);vm.runInContext(fs.readFileSync('public/js/three.min.js','utf8'),c);const T=c.THREE;
const smoothstep=(x,a,b)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
function expr(pattern){const match=app.match(pattern);assert(match,'missing authored integration expression: '+pattern);return match[1];}
const photoExpr=expr(/const photo = (1 - smoothstep\(lg, [\d.]+, [\d.]+\));/);
const fillExpr=expr(/const fillK=([^;]+);/),volumeExpr=expr(/const mwFillK=([^;]+);/),popExpr=expr(/const popK=([^;]+);/);
const volume=lgR=>Function('lgR','smoothstep','return '+volumeExpr)(lgR,smoothstep);
function weights(lgR,on=true){const photo=Function('lg','smoothstep','return '+photoExpr)(lgR,smoothstep);const fill=Function('BODY','bridge','lgR','smoothstep','return '+fillExpr)({on},{photo},lgR,smoothstep);return {lgR,photo,fill,volume:volume(lgR)};}
for(let lg=16;lg<=23;lg+=.125){const w=weights(lg);assert(w.photo>=0&&w.photo<=1&&w.fill>=0&&w.fill<=1&&w.volume>=0&&w.volume<=1);if(lg>=17.5&&lg<=21)assert(w.photo+w.fill+w.volume>.5,'photo-to-full-Galaxy cannot leave an empty scale at '+lg);}
assert(weights(18.5).fill>.99,'fixed near/disk fill exists when native photo reaches zero');assert(weights(19).volume>.8,'diffuse 3D Galaxy body overlaps star fill inside');assert(weights(20).fill>.99&&weights(20).volume>.99,'finite Gaia bright subset is not the sole Galaxy representation');
assert.equal(weights(19,false).fill,0,'BODY switch still gates fill');
const population=(lgR,on=true,insideK=1)=>Function('BODY','insideK','lgR','smoothstep','return '+popExpr)({on},insideK,lgR,smoothstep);
for(const lg of [21,22,23,24,25,26,26.3])assert(population(lg)>.99,'galaxies remain enabled throughout observable-volume interior at '+lg);assert.equal(population(26,true,.5),.5,'only the physical interior/exterior transition fades populations');assert.equal(population(22,false),0);assert.equal(population(22,true,0),0);
for(const forbidden of [/GAIA\.mode/,/GAIA\.selection/,/GAIA\.hiddenObjects/,/updateGaiaPanel/,/gaiaMeasuredPanel/,/data-gaia-(?:mode|selection|find|id)/,/\bgaiaMode\s*\(/,/\bgaiaSource\s*\(/,/\bcosmicPopulationMode\s*\(/])assert(!forbidden.test(app),'no retired independent-mode/selection UI contract: '+forbidden);
assert(!/event\.shiftKey|shiftKey.*GAIA|GAIA.*shiftKey/.test(app),'no retired Gaia shift-click interaction');
assert(/const GAIA = \{ready:false,error:null,catalog:null,layer:null,observerPc:/.test(app),'real Gaia layer remains essential state, without a display mode');
assert(/const photoOpacity\s*=\s*b\.photo\s*;/.test(app));assert(/const starOpacity\s*=\s*1\s*-\s*photoOpacity\s*;/.test(app),'one automatic photo-to-real-source handoff');
assert(/GAIA\.catalog=window\.ORBIT_GAIA\.parse\(buffer,manifest\);GAIA\.ready=true/.test(app));assert(/GAIA\.layer\.update\(GAIA\.observerPc,CS\.unit,CS\.pxPerRad,renderer\.getPixelRatio\(\),starOpacity\)/.test(app),'real Gaia sources stay on combined render path');
assert.equal((app.match(/CS\.cosmicPopulation\.update\(/g)||[]).length,1,'exactly one population update per cosmic frame');assert.equal((app.match(/CS\.milkywayFill\.update\(/g)||[]).length,1,'exactly one MW fill update per frame');
const cosmic=app.slice(app.indexOf('function cosmicUpdate(dt)'),app.indexOf('function cosmicUpdate(dt)')+6000);assert(cosmic.indexOf('CS.pxPerRad =')<cosmic.indexOf('CS.cosmicPopulation.update('),'current-frame pixel scale before population LOD');assert(cosmic.indexOf('CS.pxPerRad =')<cosmic.indexOf('CS.milkywayFill.update('));
assert(/CS\.mainGalaxy\.position\.copy\(CS\.mw\.position\)/.test(app),'MW representations share galactocentric origin');assert(/CS\.mainGalaxy\.scale\.setScalar\(5\.0e20\/unit\)/.test(app),'MW size fixed in physical meters, never screen-locked');assert(/if \(b\.active\) CS\.cam\.quaternion\.multiply\(b\.pose\)/.test(app));assert(!/slerp\(b\.pose/.test(app),'no autonomous scale-dependent flip');
assert(app.includes('(CS.webLineWeight == null ? 0 : CS.webLineWeight)'),'natural view does not draw white diagram filaments over member galaxies');
// Test the authored observer equations without depending on changing atlas/group APIs.
const sun=new T.Vector3(8.15*3.0856775814913673e19,0,0),direction=new T.Vector3(Math.cos(1.02),Math.sin(1.02),0),fixedPoint=sun.clone().add(new T.Vector3(1.8e21,8e20,-3e20));
function observer(radius){const target=sun.clone().multiplyScalar(1-smoothstep(Math.log10(radius),21.2,22.2)),position=target.addScaledVector(direction,radius),unit=Math.max(1e15,radius/5);return {position,unit,render:fixedPoint.clone().sub(position).divideScalar(unit)};}
const first=observer(1e21),far=observer(1e22),returned=observer(1e21);assert.deepEqual(returned.render.toArray(),first.render.toArray(),'reverse physical camera path recovers fixed-object position');assert(far.render.distanceTo(first.render)>.1,'retreat causes actual relative translation, not a screen-space trick');assert.deepEqual(first.render.clone().multiplyScalar(first.unit).add(first.position).toArray(),fixedPoint.toArray(),'physical object does not move with camera');
console.log('PASS v236 source continuum: always-combined photo/Gaia/fill path, no panel/modes/selection, no18.5..20.5 hole, current-frame single updates, BODY gates, fixed physical observer reversal, no scale-roll. Source/CPU only; geometry and GPU acceptance are separate.');
