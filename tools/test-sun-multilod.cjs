'use strict';
// CPU/static source contracts only. No browser, WebGL, network or production writes.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),app=fs.readFileSync(path.join(root,'public/js/app.js'),'utf8');
const box={console};box.window=box;vm.runInNewContext(fs.readFileSync(path.join(root,'public/js/three.min.js'),'utf8'),box);
const start=app.indexOf('const sunMesh = new THREE.Mesh('),end=app.indexOf('scene.add(sunMesh);',start);
assert(start>=0&&end>start);
vm.runInNewContext(`const THREE=window.THREE,R_SUN=696340000; const scene={add(){}}; const solarEmissionState={texture:new THREE.DataTexture(new Uint8Array([255,255,255,255]),1,1,THREE.RGBAFormat),ready:0}; ${app.slice(start,end)};window.sun=sunMesh;`,box);
const sun=box.sun,shader=sun.material.fragmentShader;
let count=0;function test(name,fn){fn();console.log(`PASS ${++count} ${name}`);}
function literal(re){const m=shader.match(re);assert(m,`shader contract ${re}`);return Number(m[1]);}
const fine=literal(/vec3 p = d \* ([\d.]+) \+ drift/),low=literal(/baseFootprint \* ([\d.]+)\);\s*float midResolved/),mid=literal(/float midResolved[^;]*baseFootprint \* ([\d.]+)/);
const thresholds=shader.match(/float resolved = 1\.0 - smoothstep\(([\d.]+), ([\d.]+), footprint\)/);assert(thresholds);
const a=+thresholds[1],b=+thresholds[2];
const smooth=x=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
const weight=(diameter,frequency)=>1-smooth(2*frequency/diameter);
test('independent object-space frequency gates survive fine-detail rejection',()=>{
 assert.equal(fine,420);assert.equal(low,24);assert.equal(mid,60);
 assert(shader.includes('float baseFootprint = max(length(dFdx(d)), length(dFdy(d)))'));
 assert(shader.includes('float largeBand = 1.0 + 0.16 * (sunNoise(d * 24.0) - 0.5) * lowResolved'));
 assert(shader.includes('float mediumBand = 1.0 + 0.12 * (sunNoise(d * 60.0) - 0.5) * midResolved'));
 assert(shader.includes('largeBand * mediumBand * mix(1.0, granule, resolved)'));
});
test('CPU center-footprint proxy at 220/360/900px; not a GPU visibility claim',()=>{
 const samples=[220,360,900].map(d=>({diameter:d,low:weight(d,low),mid:weight(d,mid),fine:weight(d,fine)}));
 for(const s of samples){assert.equal(s.low,1);assert(s.mid>.9);}
 assert.equal(samples[0].fine,0);assert.equal(samples[1].fine,0);assert(samples[2].fine>0&&samples[2].fine<1);
 assert(samples[1].mid>=samples[0].mid);assert.equal(weight(5,low),0);assert.equal(weight(5,mid),0);
 console.log(JSON.stringify(samples));
});
test('expensive cellular work guarded AFTER uniform derivative evaluation',()=>{
 const gate=shader.indexOf('if (resolved > 0.001)'),cells=shader.indexOf('vec2 cell = sunCells(p)'),base=shader.indexOf('dFdx(d)');
 assert(base>=0&&base<gate&&gate<cells);assert.equal((shader.match(/sunCells\(p\)/g)||[]).length,1);
 assert(shader.includes('float granule = 1.0;'));
});
test('bounded zero-centered new bands; preserve emissive quadratic limb and exposure',()=>{
 const lowRange=[1-.16*.5,1+.16*.5],midRange=[1-.12*.5,1+.12*.5];
 assert(lowRange[0]*midRange[0]>.86);assert(lowRange[1]*midRange[1]<1.15);
 assert(shader.includes('0.45 * uCol * surfaceEmission * spot * limb * limbTint'));
 assert(shader.includes('surfaceEmission=mix(vec3(textureK),sourceSolar*(.94+.06*textureK),.88*uSolarMapReady)'));
 assert.equal(sun.material.uniforms.uSolarMapReady.value,0,'missing/initial asset preserves full procedural textureK');
 const textureRange=[.86,1.15],sourceRange=[.22,2.25];
 for(const textureK of textureRange)for(const source of sourceRange)for(const ready of [0,1]){
  const mapped=(1+.06*(source-1))*(.94+.06*textureK),surface=(1-.88*ready)*textureK+.88*ready*mapped;
  const hdr=.45*3000*surface;assert(Number.isFinite(hdr)&&hdr>0&&hdr<2000,'finite exposed visible photosphere HDR before tone mapping');
  if(!ready)assert.equal(surface,textureK);
 }
 assert(shader.includes('1.0 - 0.47 * (1.0 - mu) - 0.23 * (1.0 - mu) * (1.0 - mu)'));
 const limb=mu=>1-.47*(1-mu)-.23*(1-mu)**2;assert(Math.abs(limb(0)-.3)<1e-12);assert.equal(limb(1),1);
 for(let i=1;i<=100;i++)assert(limb(i/100)>=limb((i-1)/100));
 assert(!/\bsunDir\b|directionalLights|lambert|\bvUv\b|gl_FragCoord|gl_PointCoord/i.test(shader));
 assert.deepEqual([...shader.matchAll(/uniform sampler2D (\w+);/g)].map(m=>m[1]),['uSolarMap']);
 assert(shader.includes('texture2DGradEXT(uSolarMap,uv,dx,dy)'));assert(shader.includes('atan(d.z,d.x)'));assert(shader.includes('asin(clamp(d.y'));
 assert(shader.includes('dx.x-=floor(dx.x+.5);dy.x-=floor(dy.x+.5)'));
 assert(sun.material.vertexShader.includes('vSunDir = normalize(position)'));
 assert(sun.material.depthWrite&&sun.material.depthTest&&!sun.material.transparent);
 assert(shader.includes('logdepthbuf_fragment')&&shader.includes('tonemapping_fragment')&&shader.includes('colorspace_fragment'));
});
test('atlas Sun has centered white sphere preset without legacy aim button',()=>{
 const placement=app.slice(app.indexOf('/* SUN_SPHERE_V1: placement'),app.indexOf('moonMesh.position.copy(MOON.pos).sub(origin);',app.indexOf('/* SUN_SPHERE_V1: placement')));
 assert(placement.includes('sunHalo.visible = false'));assert(!placement.includes('JOURNEY'));
 const glare=app.slice(app.indexOf('function updateSunGlare(K)'),app.indexOf('const POST_VS ='));
 assert(/GLARE\.vis = 0;\s*return;/.test(glare));
 assert(app.includes('goTarget(SUN, 2.4e9, -Math.PI/2)'));
 const radius=696340000,distance=radius+2.4e9,diameter=2*radius/Math.sqrt(distance*distance-radius*radius)/(2*Math.tan(55*Math.PI/360));assert(diameter>.4&&diameter<.6,'resolved solar disc occupies about half frame height');
 assert(app.includes('cam.yaw=0; goTarget(SUN'));
 const line=app.match(/sun: \(\) => \{([^}]+)\}/);assert(line);const cam={yaw:1.2},SUN={name:'太阳'};let request;
 new Function('cam','SUN','goTarget',line[1])(cam,SUN,(...args)=>{request=args;});assert.equal(cam.yaw,0);assert.deepEqual(request,[SUN,2.4e9,-Math.PI/2]);
 assert(!app.includes("{ name: '太阳', type: '恒星', key: 'sun'"));
 assert(app.includes('cam.dir.copy(SYS_DIR); cam.pitch = -Math.PI/2; cam.yaw=0;'));
 assert(!glare.includes('GLARE.uv[1] = 0.56;'));
});
test('distant solar logdepth has actual common dependency and independent LOD',()=>{
 const p0=app.indexOf('const sunPoint = new THREE.Points('),p1=app.indexOf('scene.add(sunPoint);',p0);
 vm.runInNewContext(`const pointScene={}; ${app.slice(p0,p1)};window.solarPoint=sunPoint;`,box);
 const point=box.solarPoint;assert(point.material.vertexShader.includes('#include <common>'));
 assert(box.THREE.ShaderChunk.logdepthbuf_vertex.includes('isPerspectiveMatrix'));
 assert(box.THREE.ShaderChunk.common.includes('bool isPerspectiveMatrix'));
 assert(point.material.vertexShader.includes('logdepthbuf_vertex'));assert(point.material.depthTest&&!point.material.depthWrite);
});
test('explicit target clears residual recenter shift without changing requested altitude',()=>{
 const src=app.slice(app.indexOf('function _gotoBodyInstant('),app.indexOf('/* 对外：同体',app.indexOf('function _gotoBodyInstant(')));
 const T=box.THREE,body={pos:new T.Vector3(0,0,0)},cam={shift:new T.Vector3(1e11,2e10,0),dir:new T.Vector3()};
 const jump=new Function('EXO','NEB','cam','camAbs','_t1','THREE','EARTH','leaveExo','leaveNebula','let _sunBack=true,_needTerrainReset=false;'+src+';return _gotoBodyInstant;')({active:null},{active:null},cam,new T.Vector3(1e12,0,0),new T.Vector3(),T,{},()=>{},()=>{});
 jump(body,1.3e9);assert.equal(cam.shift.lengthSq(),0);assert.equal(cam.focus,body);assert.equal(cam.alt,1.3e9);assert(Math.abs(cam.dir.length()-1)<1e-12);
 assert(app.includes('if(cam.shift.lengthSq()>1){_gotoBodyInstant(body,alt);'));
});
console.log(`PASS ${count} static/CPU solar multiband tests. No rendered image, color/LOD GPU behavior or performance acceptance.`);
