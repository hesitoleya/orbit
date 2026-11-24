'use strict';
// Real THREE + production function extraction. CPU geometry, not visual acceptance.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const src=fs.readFileSync('public/js/app.js','utf8').replace(/\r\n/g,'\n');
const boot={console:{warn(){},log(){},error(){}}};vm.createContext(boot);vm.runInContext(fs.readFileSync('public/js/three.min.js','utf8'),boot);const T=boot.THREE,V=(x=0,y=0,z=0)=>new T.Vector3(x,y,z);
function section(a,b){const i=src.indexOf(a),j=src.indexOf(b,i+a.length);assert(i>=0&&j>i,a);return src.slice(i,j);}
function fn(n){const i=src.indexOf('function '+n+'('),j=src.indexOf('\n}',i);assert(i>=0&&j>i,n);return src.slice(i,j+2);}
const near=(a,b,msg,eps=1e-10)=>assert(Math.abs(a-b)<eps,`${msg}: ${a} != ${b}`),deg=180/Math.PI;
const c={THREE:T,Math,DEG:Math.PI/180};vm.createContext(c);
vm.runInContext(section('const OBLIQUITY =','const WORLDTOEF_M3 =')+'\nglobalThis.geometry={OBLIQUITY,AXIS_TILT,EARTH_TILT_Q,EARTH_SPIN_AXIS,EARTH_SPIN_Q,Qe,QeInv};',c);
vm.runInContext(section('function _eqDir(','const _gu =')+'\nglobalThis.GA=GA;',c);
vm.runInContext(section('const BRIDGE_FRAME =','function setCosmicZoomRadius('),c);
const eps=c.geometry.OBLIQUITY;
// Main solar world +Y is ecliptic pole; +Z longitude90. Correct ICRS
// ecliptic pole has E=(0,cos eps,-sin eps), RA270,Dec66.56.
assert(c.eclipticToEquatorial(V(0,1,0),V()).distanceTo(V(0,Math.cos(eps),-Math.sin(eps)))<1e-12);
near(c.eclipticToEquatorial(V(0,0,1),V()).y,Math.sin(eps),'ecliptic lon90 has positive declination');
for(const v of [V(1,0,0),V(0,1,0),V(0,0,1),V(.2,-.3,.7)]){
 const back=c.equatorialToEcliptic(c.eclipticToEquatorial(v,V()),V());assert(back.distanceTo(v)<1e-12);
 assert(c.galacticToMain(c.mainToGalactic(v,V()),V()).distanceTo(v)<1e-10);
 const alias=v.clone();c.eclipticToEquatorial(alias,alias);c.equatorialToEcliptic(alias,alias);assert(alias.distanceTo(v)<1e-12);
}
near(new T.Matrix4().makeBasis(...[V(1,0,0),V(0,1,0),V(0,0,1)].map(v=>c.mainToGalactic(v,V()))).determinant(),1,'no ecliptic-to-G reflection');
assert(c.bridgeToGalactic(c.GA.gc,V()).distanceTo(V(-1,0,0))<2e-6,'Gaia ICRS transform remains direct, not double-obliquity');
// Earth body north must be fixed through every sidereal spin, including t0.
const spinLine=src.match(/EARTH_SPIN_Q\.setFromAxisAngle\([^;]+;\s*Qe\.copy\(EARTH_TILT_Q\)\.multiply\(EARTH_SPIN_Q\);/);assert(spinLine,'static tilt times local spin production formula');
Object.assign(c,{simTime:0,ORBIT_W:{spin:1},...c.geometry});
for(let i=0;i<=24;i++){c.simTime=i*Math.PI/12;vm.runInContext(spinLine[0],c);assert(V(0,1,0).applyQuaternion(c.Qe).distanceTo(c.AXIS_TILT)<1e-12,'fixed geographic north');}
// Journey pitch is evaluated from actual production expression and must face
// toward the receding solar/Galactic centre, not along escape velocity.
const pitch=fn('journeyCineStep').match(/cam\.pitch = ([^;]+);/)[1];const smoothstep=(x,a,b)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
for(const lg of [7,8,9.3,12,16])assert(vm.runInNewContext(pitch,{lg,smoothstep})<0,'inward cinematic lookback');
const farPitch=vm.runInNewContext(pitch,{lg:16,smoothstep}),radial=V(1,0,0),forward=V(Math.sin(farPitch),Math.cos(farPitch),0);
assert(forward.dot(radial)<-.99,'retreat must not point forward out of Galaxy');
// Physical auto-centering is a lateral translation, not a free camera turn.
const angle=Math.acos(Math.max(-1,Math.min(1,c.GA.ngp.dot(c.eclipticToEquatorial(V(0,1,0),V())))))*deg;
assert(angle>60&&angle<61,'galaxy/ecliptic mutual inclination ~60.19deg');
assert(fn('enterGalaxyBridge').includes('mainToGalactic(camAbs')&&fn('leaveGalaxyBridge').includes('galacticToMain(b.offset'),'positions use same invertible frame as rays');
assert(src.includes('p=>bridgeToGalactic(new THREE.Vector3(...p)'),'measured Gaia E stays direct proper G');
assert(src.includes('const eqToMain = new THREE.Matrix4().makeRotationX(OBLIQUITY)'),'stellar catalogue baked into mainworld');
assert(src.includes('.applyAxisAngle(new THREE.Vector3(1,0,0),OBLIQUITY)'),'main photograph pole/centre in same mainworld');
vm.runInContext(section('const _gu =','/* ---------------- 星系目录'),Object.assign(c,{C_KPC:1,SUN_GAL:V(8.15,0,0)}));
for(const [name,ra,dec,d,incl,pa] of [['M31',10.685,41.269,778.8,77,35],['LMC',80.894,-69.756,49.97,25,0],['M33',23.462,30.660,837,54,23]]){
 const E=c._eqDir(ra,dec,V()),g=c.galWorld(ra,dec,d,V());
 assert(g.distanceTo(c.bridgeToGalactic(E,V()).multiplyScalar(d))<1e-9,name+' same proper frame as Gaia');
 const p=c.galPosition(ra,dec,d,8.15,V()).sub(V(8.15,0,0));assert(c.bridgeToEquatorial(p,V()).normalize().distanceTo(E)<1e-12,name+' sky direction inverse');
 const q=c.galaxyCatalogQuaternion(ra,dec,incl/deg,pa/deg,new T.Quaternion()),major=V(1,0,0).applyQuaternion(q),normal=V(0,1,0).applyQuaternion(q),minor=V(0,0,1).applyQuaternion(q);
 near(new T.Matrix4().makeBasis(major,normal,minor).determinant(),1,name+' right-handed disk');near(major.dot(g.clone().normalize()),0,name+' major axis on sky');near(normal.dot(g.clone().normalize().negate()),Math.cos(incl/deg),name+' inclination relative own Sun sightline');
 const north=c._eqDir(ra,dec+.0001,V()).sub(E).normalize(),east=c._eqDir(ra+.0001,dec,V()).sub(E).normalize();
 const expected=c.bridgeToGalactic(north.multiplyScalar(Math.cos(pa/deg)).addScaledVector(east,Math.sin(pa/deg)).normalize(),V());assert(major.distanceTo(expected)<2e-6,name+' astronomical PA east of north');
 const photoQ=c.galaxyPhotoQuaternion(ra,dec,new T.Quaternion());near(Math.abs(V(0,1,0).applyQuaternion(photoQ).dot(g.clone().normalize())),1,name+' already inclined photo not double tilted');
}
// Harris RA column is hours (data prose formerly said degrees). Rounded0.1kpc
// Galactic Cartesian columns preserve physical positions through the load boundary.
const harris=JSON.parse(fs.readFileSync('public/data/mwgc.json','utf8'));
for(const r of harris){const p=c.harrisGalPosition(r,8.15,V()).sub(V(8.15,0,0)),expected=c.galWorld(r[2]*15,r[3],r[4],V());assert(p.distanceTo(expected)<.23,r[0]+' Harris native XYZ vs RA-hours direction');}
assert(fn('decodeGalaxies').includes('galPosition(ra, dec, d'),'GXY binary is angular, decode directly through proper rotation');assert(fn('decodeFilaments').includes('galPosition(ra, dec, d'),'filament binary is angular, no additional sign flip');
assert(!section('function galWorld(','/* 日心星表').includes('out.set(-gx, gz, -gy)'),'legacy reflection removed');
console.log('PASS v237 geometry: proper ecliptic/ICRS/G rotations & inverses, no double tilt of Gaia, fixed Earth pole, inward cinematic lookback, main star/photo alignment. CPU/VM only.');
console.log(JSON.stringify({obliquityDegrees:eps*deg,galacticEclipticInclinationDegrees:angle,cinematicFarPitchDegrees:farPitch*deg,cinematicForwardDotEscape:forward.dot(radial),legacyExtragalacticMirrorStillPresent:false,namedDiskPAInclinationVerified:true,harrisRecords:harris.length,epochAccuracy:false},null,2));
