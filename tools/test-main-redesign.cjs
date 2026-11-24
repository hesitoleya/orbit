'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8'),sha=s=>crypto.createHash('sha256').update(s).digest('hex');
const app=read('public/js/app.js'),template=read('public/index.html'),volume=read('public/js/main-volumes.js');
new vm.Script(app.replace("import * as THREE from 'three';",'const THREE = {};'));
new vm.Script(volume);
assert(!template.includes('id="deepModelPanel"'));assert(!template.includes('id="deepModelBtn"'));assert(!template.includes('src="./js/deep-models.js"'));assert(template.includes('src="./js/main-volumes.js"'));
assert(app.includes("var GAL_TEX_ON = params.get('galTex') !== '0';"));assert(!app.includes('(function bindDeepModels()'));
assert(app.includes('if (PT.id === 0) return 0;'));assert(app.includes('cam.alt = Math.max(200, cam.alt)'));
assert(app.includes('Object.assign(m.userData, { name: name'));
assert(app.includes('!m.userData.galaxyStructure'));
assert(app.includes('const m = MAIN_VOLUMES.create(type'));assert(app.includes('NEB.mainVolume=MAIN_VOLUMES.create'));assert(app.includes('CS.mainGalaxy=MAIN_VOLUMES.create'));
for(const f of ['space.html','index.html','space-http.html']){
 const h=read(f),start=h.indexOf('const MW_B64'),end=h.indexOf('</script>',start);assert(start>=0);
 const inline=h.slice(start,end).trim();const expected=app.slice(app.indexOf('const MW_B64')).replace("import * as THREE from 'three';",'const THREE = window.THREE;').trim();assert.equal(inline,expected,f+' inline source exact');
 assert(h.includes(volume),f+' volume exact');assert(h.includes(read('public/js/galaxy-structure.js')),f+' galaxy structure exact');assert(!h.includes('id="deepModelPanel"'));
 const record=JSON.parse(read('public/data/earth-imagery-sources.json'));
 for(const [key,name] of [['earthSurface','earth-surface-8k.jpg'],['earthClouds','earth-cloudfraction.jpg']]){const m=h.match(new RegExp('"'+key+'":"([^"]+)"'));assert(m,key);const image=Buffer.from(m[1],'base64');const local=fs.readFileSync(path.join(root,'public/data',name));assert.equal(sha(image),sha(local));assert.equal(sha(image),record.assets.find(a=>a.path.endsWith(name)).sha256);}
 console.log('PASS source/volume/assets exact:',f);
}
const ctx={console};ctx.window=ctx;vm.runInNewContext(read('public/js/three.min.js'),ctx);vm.runInNewContext(read('public/js/galaxy-structure.js'),ctx);vm.runInNewContext(volume,ctx);const pool=ctx.createMainVolumes(ctx.THREE);
for(let type=0;type<=12;type++){
 const mesh=pool.create(type,31,[1,.8,.6]);assert(mesh.isMesh);assert.equal(mesh.material.uniforms.uLayerOpacity.value,1);assert.equal(mesh.material.uniforms.uAnalyticSteps.value,96);assert.equal(mesh.material.uniforms.uAnalyticSupportCull.value,0);assert(mesh.material.fragmentShader.includes('vec4(radiance,alpha)*clamp(uLayerOpacity,0.0,1.0)'));assert.equal(mesh.material.uniforms.uType.value,type);if(type<5.5){assert(mesh.userData.galaxyStructure);assert.equal(mesh.children[0].name,'GalaxyEmbeddedStructure');}else assert(!mesh.userData.galaxyStructure);
 assert(mesh.material.vertexShader.includes('#include <common>'));assert(mesh.material.fragmentShader.includes('for(int i=0;i<96;i++)'));
 mesh.position.set(4,-2,8);mesh.scale.setScalar(2);mesh.onBeforeRender();const p=new ctx.THREE.Vector3(.2,.3,.4),q=p.clone().applyMatrix4(mesh.matrixWorld).applyMatrix4(mesh.material.uniforms.uInverse.value);assert(q.distanceTo(p)<1e-12);mesh.material.dispose();
}
let routed=null;ctx.ORBIT_CINEMATIC_ASSETS={get(t){routed=t;return null;}};const hero=pool.create(0,31,[1,1,1],{cinematicType:13});hero.scale.set(2,.25,2);hero.updateMatrixWorld(true);hero.onBeforeRender();assert.equal(routed,13);assert.equal(hero.material.uniforms.uType.value,0);assert.equal(hero.material.uniforms.uCineEnabled.value,0);const hp=new ctx.THREE.Vector3(.2,.3,.4),hq=hp.clone().applyMatrix4(hero.matrixWorld).applyMatrix4(hero.material.uniforms.uInverse.value);assert(hq.distanceTo(hp)<1e-12);hero.material.dispose();pool.dispose();console.log('PASS volume constructors, isolated asset13/analytic0 fallback, anisotropic transforms, depth dependencies, fixed 3D shader contracts');
assert(app.includes('MAIN_VOLUMES.renderOpaqueDepth(renderer, S, K, w, h);'));
assert(app.includes('m.visible = BODY.on && resolvedK > .01'));
assert(app.includes('CS.mainGalaxy.visible=mainMwHaloVisible'));assert(app.includes('CS.mainGalaxy.material.uniforms.uGain.value='));
assert(app.includes('const mainMwVisible=BODY.on'));
assert(app.includes('const inDisk = mainMwVisible'));
assert(!app.includes('const inDisk = !!(CS.mwReal'));
assert(app.includes('NEB.mainVolume.visible=NEB.vol && DEEP_SKY.on'));
assert(template.includes('earthImageryCredit')&&template.includes('Solar System Scope / NASA'));
assert(template.includes('关闭不会切回照片薄片'));
console.log('PASS depth integration, display settings and attribution contracts');
console.log('PASS integration static checks; not a complete visual/performance acceptance.');
