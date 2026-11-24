'use strict';
// 执行 app.js 的真实初始化、视角判定、加载和回调；只替换网络、GPU 和时钟。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const publicDir = path.resolve(__dirname, '../public');
const app = fs.readFileSync(path.join(publicDir, 'js/app.js'), 'utf8');
function part(a, b) {
  const i = app.indexOf(a), j = app.indexOf(b, i + a.length);
  assert(i >= 0 && j > i, a); return app.slice(i, j);
}
const uniforms = () => Object.fromEntries(['uMap','uMapReady','uMapGain','uAtmo','uDem','uDemReady','uDemW','uDemH'].map(k => [k,{value:0}]));
function fixture(packed) {
  const images = [], requests = [], decodes = [], frames = [];
  const SYS = ['mercury','venus','mars','jupiter','saturn','uranus','neptune'].map(key => ({key, pos:{}, mesh:{material:{uniforms:uniforms()}}}));
  const c = vm.createContext({window:{__ORBIT_INLINE__:packed}, location:{protocol:packed?'file:':'https:', href:'https://example.invalid/orbit'}, SYS,
    EARTH:{pos:{}}, MOON:{pos:{}}, cam:{alt:1.25e7, pitch:0,yaw:0,dir:{x:1,y:0,z:0,set(){return this},normalize(){return this}}},
    performance:{now:()=>c.time}, time:0, innerHeight:1080, EXO:{}, NEB:{}, BH:{}, CS:{}, simTime:0, SET:{q:'high'}, clamp:(v,l,h)=>Math.min(h,Math.max(l,v)),
    renderer:{capabilities:{getMaxAnisotropy:()=>4,maxTextureSize:8192}},moonMat:{uniforms:uniforms()}, requestAnimationFrame:fn=>frames.push(fn),
    THREE:{TextureLoader:class{load(url,ok,progress,fail){images.push({url,ok,fail})}},DataTexture:class{dispose(){}}},
    fetch:url=>new Promise((resolve,reject)=>requests.push({url,resolve,reject})), atob:s=>{decodes.push(s.length);return atob(s)} });
  const run = code => vm.runInContext(code,c);
  run(part('const moonMapState =','function makeMoonMat('));
  run(part('function beginObservedLoad(', 'const _atmoQ ='));
  run(part('const PLANET_MAPS =','function makeOblateGeo('));
  run(part('function updateObservedBody(', 'function updateSystem('));
  // 使用真实 buildSystem 循环内的挂接语句以及每帧的月球替身分派，不在测试里重写策略。
  run('for(const b of SYS){'+part('    scene.add(b.mesh);','    if (b.ring)').replace('scene.add(b.mesh);','')+'}');
  run('cam.focus = EARTH; function tick(b, dist){ const sysPxPerRad = innerHeight/(2*Math.tan(55*Math.PI/360));'+part('    const pxAng = (2 * b.radius / dist)', '    const isEarthMoon')+'}');
  function tick(key, radius, dist) { const b=key==='moon'?{pos:c.MOON.pos}:SYS.find(b=>b.key===key); b.radius=radius; c.tick(b,dist); }
  return {c,run,tick,images,requests,decodes,frames};
}
const flush = () => new Promise(resolve=>setImmediate(resolve));
async function main(){
  const f=fixture(), {c,run,tick,images,requests}=f;
  for(const height of [720,1080,2160,4320]){
    c.innerHeight=height; tick('moon',1737400,3.65e8);
    for(const b of c.SYS) tick(b.key,7e7,4e10);
  }
  assert.equal(images.length+requests.length,0,'地球开场不启动所选资源'); c.innerHeight=1080;
  tick('jupiter',7e7,2e9); tick('jupiter',7e7,2e9);
  assert.deepEqual(images.map(x=>x.url),['./data/planet-maps/jupiter.jpg']);
  images[0].fail('断网'); c.time=59999; tick('jupiter',7e7,2e9); assert.equal(images.length,1);
  c.time=60001; tick('jupiter',7e7,1e12); assert.equal(images.length,1,'离开后不重试');
  tick('jupiter',7e7,2e9); images[1].ok({}); tick('jupiter',7e7,2e9);
  assert.equal(images.length,2); assert.equal(run('planetMapState.loaded'),1); assert.equal(run('planetMapState.errors.jupiter'),undefined);
  // 走图鉴的真实 locate → GO → goOrbit → goTarget → 瞬时跳转分支。
  Object.assign(c,{close(){},journeyStop(){},sunlitDir(){},TW:{on:false},FLY:{},GALAXY_BRIDGE:{},camAbs:{},
    _t1:{copy(){return this},sub(){return this},lengthSq(){return 2},normalize(){return this}}});
  c.cam.shift={set(){}}; c.cam.dir.copy=()=>{};
  run(part('function _gotoBodyInstant(', '/* 星系全景的固定机位'));
  run(part('const earthOrbitPitch =', "document.querySelectorAll('[data-go]')"));
  const html=fs.readFileSync(path.join(publicDir,'index.html'),'utf8');
  const locate=html.match(/  function locate\(o\)\{[\s\S]*?\n  \}/); assert(locate);
  run(locate[0]+"\nwindow.__SE={go:k=>GO[k]()}; locate({localPlanet:true,goKey:'neptune'})");
  assert.equal(c.cam.focus,c.SYS[6]); tick('neptune',1,1e12); assert.match(images.at(-1).url,/neptune\.jpg$/);
  // 分享生成与上电回读。即使盘面暂时很小也要启动目标自己的图。
  run("GO.venus(); const DEG=180/Math.PI;"+part('  function fmt(v, n)', '  /* 同步回读'));
  c.params=new URL(run('shareURL()')).searchParams; assert.equal(c.params.get('focus'),'venus'); c.cam.focus=c.EARTH;
  run(part('let _posPinned = false;', '/* 对话 83：`?yaw=`')); assert.equal(c.cam.focus,c.SYS[1]);
  tick('venus',1,1e12); c.setPlanetLayer('venus','surface');
  const cloud=images.at(-2), radar=images.at(-1), ct={}, rt={};
  assert.match(cloud.url,/venus\.jpg$/); assert.match(radar.url,/venus-surface/);
  radar.ok(rt); cloud.ok(ct); const u=c.SYS[1].mesh.material.uniforms; assert.equal(u.uMap.value,rt);
  c.setPlanetLayer('venus','cloud'); assert.equal(u.uMap.value,ct);
  c.cam.focus=c.EARTH; tick('moon',1737400,7e7); assert.match(images.at(-1).url,/4k.webp$/); assert.equal(requests.length,0);
  images.at(-1).fail(); assert.match(images.at(-1).url,/4k.jpg$/); images.at(-1).fail(); assert.match(images.at(-1).url,/2k.jpg$/); images.at(-1).ok({});
  tick('moon',1737400,2e7); c.cam.focus=c.MOON; c.cam.alt=2e6; tick('moon',1,1e12);
  assert.deepEqual(requests.map(r=>r.url),['./data/nasa-svs4720-ldem16-uint16le.bin']);
  requests[0].resolve({ok:true,arrayBuffer:()=>new ArrayBuffer(1)}); await flush(); assert.match(requests[1].url,/moon-ldem8.bin$/);
  requests[1].reject(Error('离线')); await flush(); tick('moon',1,1e12); assert.equal(requests.length,2);
  c.time+=60001; tick('moon',1,1e12); assert.equal(requests.length,3);
  // 用仓库的 8 ppd 数据执行真实解包/纹理绑定，拦下提交给 GPU 的几何重建帧。
  const bytes=fs.readFileSync(path.join(publicDir,'data/moon-ldem8.bin'));
  const off=fixture({moonLdem:bytes.toString('base64'), moonLroc:'bQ==',planetMaps:{saturn:'cw=='}});
  off.tick('moon',1737400,3.65e8); assert.equal(off.decodes.length+off.images.length,0);
  off.c.cam.focus=off.c.SYS[4]; off.tick('saturn',1,1e12); off.c.cam.focus=off.c.MOON; off.c.cam.alt=2e6;
  off.tick('moon',1,1e12); off.tick('moon',1,1e12);
  assert.deepEqual(off.images.map(x=>x.url),['data:image/jpeg;base64,cw==','data:image/jpeg;base64,bQ==']);
  assert.equal(off.run('MOON_DEM.source'),'inline moon-ldem8'); assert.equal(off.decodes.length,1); assert.equal(off.frames.length,1); assert.equal(off.requests.length,0);
  console.log('PASS：地球开场 0 请求；焦点与自然尺度、分享回读、并发去重、失败冷却、金星图层竞态、月图与 DEM 回退、离线解包。');
}
main().catch(e=>{console.error(e);process.exitCode=1});
