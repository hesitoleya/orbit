'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict');
const app=fs.readFileSync('public/js/app.js','utf8');const start=app.indexOf('function solarOpticsParams('),end=app.indexOf('function updateSunGlare(',start),AU=149597870700;
const params=new Function('R_SUN','AU',app.slice(start,end)+'return solarOpticsParams;')(696340000,AU);
for(const h of [450,800,1080,2160])for(const d of [1.3e9,AU,6.6e12,1e16,1e20]){const p=params(d,55,h);assert(Number.isFinite(p.radius)&&p.radius>0&&p.radius<=2);assert(p.energy>=0&&p.energy<=20000);assert.equal(p.pixel,1/h);}
for(const d of [6.6e12,1e16]){const ratio=params(d,55,800).energy/params(d*2,55,800).energy;assert(Math.abs(ratio-4)<1e-6,'inverse-square unresolved flux');}
assert.equal(params(AU,55,450).radius,params(AU,55,2160).radius);
assert(Math.abs(params(6.6e12,55,1600).energy/params(6.6e12,55,800).energy-4)<1e-8,'pixel solid angle scales with resolution');
const mark=app.indexOf('// SOLAR_VACUUM_V3');assert(mark>0);const shader=app.slice(mark,app.indexOf("'  c = acesFilmic(c);'",mark));
for(const token of ['atan(','uBlades','uStarK','ghostCenter','streak','cos(','c *='])assert(!shader.includes(token),token+' removed');
assert(shader.includes('atmosphere * 0.035'));assert(!shader.includes('pointPSF'));assert(!shader.includes('edgePSF'));
assert(app.includes('(.45*3000*.805)*radius*radius/(2*sigma*sigma)'));
for(const radius of [0,.1,.3]){const px=1/800,r=radius+.02,edge=r-radius,psf=Math.exp(-.5*(edge/(.85*px))**2);assert(psf<1e-50,'vacuum response absent outside pixel PSF');}
assert(app.includes('sunPoint.material.uniforms.uFlux.value=solarSource.energy/3000'));
assert(app.includes('vec4(uCol * uFlux, a)'));assert(app.includes('sunCol.setRGB(3000, 2910, 2760)'));
assert(!app.includes('vec3 sourceSolar=vec3(1.22,.79,.36)'));
const r0=app.indexOf('  if(S===scene){',app.indexOf('function renderFrame(')),r1=app.indexOf('\n  /*',r0);assert(r0>0&&r1>r0);
const scene={},mesh={visible:true},point={material:{uniforms:{uFlux:{value:0}}}};
const transfer=new Function('S','scene','h','K','origin','SUN','solarOpticsParams','sunPoint','sunMesh','NEB',app.slice(r0,r1));
for(const h of [450,800,1600]){transfer(scene,scene,h,{fov:55},{distanceTo:()=>6.6e12},{pos:{}},params,point,mesh,{active:null});assert.equal(point.material.uniforms.uFlux.value,params(6.6e12,55,h).energy/3000);assert(point.visible&&!mesh.visible);}
const previous=point.material.uniforms.uFlux.value;transfer({},scene,800,{fov:55},{distanceTo:()=>1},{pos:{}},params,point,mesh,{active:null});assert.equal(point.material.uniforms.uFlux.value,previous,'foreign scene does not mutate solar source');
console.log('PASS SOLAR_VACUUM_V3: no decorative rays/ghost/streak, finite exposure, inverse-square flux, resolution solid angle, neutral visible light and compact PSF');
