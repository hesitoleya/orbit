'use strict';
// Behavioral regression against extracted production code; no WebGL/browser claim.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const src=fs.readFileSync('public/js/app.js','utf8').replace(/\r\n/g,'\n');

function section(start,end){const a=src.indexOf(start),b=src.indexOf(end,a+start.length);assert(a>=0&&b>a,`production section not found: ${start}`);return src.slice(a,b);}
class Vec3{constructor(x=0,y=0,z=0){Object.assign(this,{x,y,z});}normalize(){const l=Math.hypot(this.x,this.y,this.z)||1;this.x/=l;this.y/=l;this.z/=l;return this;}applyAxisAngle(axis,a){assert.deepEqual([axis.x,axis.y,axis.z],[1,0,0]);const y=this.y,z=this.z;this.y=Math.cos(a)*y-Math.sin(a)*z;this.z=Math.sin(a)*y+Math.cos(a)*z;return this;}}
const sandbox={THREE:{Vector3:Vec3,ShaderMaterial:class{constructor(o){Object.assign(this,o);}}},skyPanoramaEmpty:{placeholder:true},DEG:Math.PI/180,OBLIQUITY:23.4392911*Math.PI/180,atmoUniforms:()=>({}),atmoGLSL:()=>''};
vm.createContext(sandbox);
vm.runInContext(section('const skyMat = new THREE.ShaderMaterial({','const skyMesh ='),sandbox);
// Top-level lexical declaration is accessible through a subsequent same-context script.
const sky=vm.runInContext('skyMat',sandbox);
const shader=sky.fragmentShader;
assert.equal(typeof shader,'string');

function assertNoNestedFunctions(code){
 const clean=code.replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/[^\n]*/g,'');
 const depth=new Int32Array(clean.length+1);let n=0;
 for(let i=0;i<clean.length;i++){depth[i]=n;if(clean[i]==='{')n++;if(clean[i]==='}')n--;assert(n>=0,'GLSL braces underflow');}assert.equal(n,0,'GLSL braces balanced');
 const re=/\b(?:void|float|int|bool|vec[234]|mat[234])\s+([A-Za-z_]\w*)\s*\([^;{}]*\)\s*\{/g;let m,count=0;
 while((m=re.exec(clean))){assert.equal(depth[m.index],0,`GLSL function ${m[1]} must be at top level`);count++;}
 assert(count>=2,'actual shader must expose main and sphereHitT');
}
assertNoNestedFunctions(shader);
assert.throws(()=>assertNoNestedFunctions('void main(){float bad(vec3 p){return 0.0;}}'),/must be at top level/,'scanner detects the previous nested helper regression');
assert(sky.uniforms.uGalPole&&sky.uniforms.uGalCenter,'galactic frame uniforms');
for(const key of ['uGalPole','uGalCenter']){const v=sky.uniforms[key].value;assert(Math.abs(Math.hypot(v.x,v.y,v.z)-1)<1e-12,`${key} is a normalized direction`);}

// Invoke the actual production helpers, including integration call expressions.
const runtime={smoothstep:(x,a,b)=>{const t=Math.min(1,Math.max(0,(x-a)/(b-a)));return t*t*(3-2*t);}};
vm.createContext(runtime);
vm.runInContext(section('function solarBackdropGain(', '(function buildStars()'),runtime);
const gain=vm.runInContext('solarBackdropGain',runtime),opacity=vm.runInContext('updateStarOpacity',runtime);
const near=(a,b,msg)=>assert(Math.abs(a-b)<1e-12,`${msg}: ${a} != ${b}`);
near(gain(false,0,false),.92,'solar overview enabled');
near(gain(true,0,false),0,'ground sky not polluted');
near(gain(true,150000,false),0,'atmospheric lower boundary');
near(gain(true,2000000,false),.92,'orbital upper boundary');
const middle=gain(true,1075000,false);near(middle,.46,'altitude fade midpoint');
for(const isEarth of [false,true])for(const altitude of [0,1e6,1e14])near(gain(isEarth,altitude,true),0,'special scene suppresses backdrop');
const mats=[1,.25,.32,.58].map(base=>({opacity:base,userData:{skyOpacity:base}}));
opacity(mats,1,1);mats.forEach((m,i)=>near(m.opacity,[1,.25,.32,.58][i],'base opacity preserved'));
opacity(mats,.5,.24);mats.forEach((m,i)=>near(m.opacity,[1,.25,.32,.58][i]*.12,'atmosphere/hero gains multiply once'));
opacity(mats,.5,.24);mats.forEach((m,i)=>near(m.opacity,[1,.25,.32,.58][i]*.12,'successive frames do not compound opacity'));
opacity(mats,0,1);mats.forEach(m=>near(m.opacity,0,'daytime visibility'));
opacity(mats,1,1);mats.forEach((m,i)=>near(m.opacity,[1,.25,.32,.58][i],'restoring visibility restores base'));
assert(/for \(const m of starMats\)\s*\{\s*m\.userData\.skyOpacity = m\.opacity;\s*attachStarOcc\(m\)/.test(src),'capture actual construction opacity before animation');
assert(src.includes('opacity: 0.25, depthWrite: false'),'actual MW starts at .25');
assert(src.includes('opacity: 0.32, depthWrite: false'),'actual faint stars start at .32');
assert(src.includes('opacity: 0.58, depthWrite: false'),'actual spikes start at .58');
assert(src.includes('updateStarOpacity(starMats, starA, heroStarK, photoGain);'),'animation uses base-preserving photo-aware helper');
const photoMats=[{opacity:1,userData:{skyOpacity:1}},{opacity:.25,userData:{skyOpacity:.25,photoLayer:'synthetic'}}];
for(const amount of [0,.25,.5,1]){opacity(photoMats,.5,.24,amount);near(photoMats[0].opacity,.12*(1-.82*amount),'catalogue core attenuates as photo fades in');near(photoMats[1].opacity,.03*(1-amount),'synthetic field suppressed rather than stacked on photo');opacity(photoMats,.5,.24,amount);near(photoMats[1].opacity,.03*(1-amount),'photo blend never compounds across frames');}
opacity(photoMats,1,1,0);near(photoMats[0].opacity,1,'failed/unavailable photo restores catalogue');near(photoMats[1].opacity,.25,'failed/unavailable photo restores statistical layer');
for(const material of ['mmat','dmat','smat2'])assert(src.includes(`${material}.userData.photoLayer = 'synthetic';`),`${material} correctly classified synthetic`);
const photoCall=src.match(/const photoGain = SKY_PANORAMA\.ready[^;]+;/);assert(photoCall,'actual photo readiness/gain integration');
for(const ready of [false,true])for(const gain of [0,.23,.46,.92,1.84]){const c={SKY_PANORAMA:{ready},skyMat:{uniforms:{uSolarBand:{value:gain}}},clamp:(v,a,b)=>Math.max(a,Math.min(b,v))};const actual=vm.runInNewContext(photoCall[0]+'photoGain',c);near(actual,ready?Math.min(1,gain/.92):0,'photo readiness controls actual opacity gain');}
assert(!/i === starMats\.length - 1/.test(src),'no array-index opacity special case');
const call=src.match(/skyMat\.uniforms\.uSolarBand\.value = solarBackdropGain\([\s\S]*?\);/);
assert(call,'actual backdrop update exists');
for(const special of ['neb','exo','bh','cosmos']){
 const c={cam:{focus:{}},EARTH:{},altNow:1e13,NEB:{active:null},EXO:{active:null},BH:{active:false},CS:{active:false},skyMat:{uniforms:{uSolarBand:{value:-1}}},solarBackdropGain:gain};
 if(special==='neb')c.NEB.active=0;if(special==='exo')c.EXO.active={};if(special==='bh')c.BH.active=true;if(special==='cosmos')c.CS.active=true;
 vm.runInNewContext(call[0],c);near(c.skyMat.uniforms.uSolarBand.value,0,`actual call gates ${special}`);
}
const atmoCall=src.match(/const earthNear = atmoCenter\.lengthSq\(\) < [^;]+;\s*skyMat\.uniforms\.uAtmoEnabled\.value = [^;]+;/);
assert(atmoCall,'actual atmosphere distance guard exists');
for(const distance of [1e7,1e9,3e9,1e12,6.6e12]){const c={atmoCenter:{lengthSq:()=>distance*distance},skyMat:{uniforms:{uAtmoEnabled:{value:-1}}}};vm.runInNewContext(atmoCall[0],c);assert.equal(c.skyMat.uniforms.uAtmoEnabled.value,distance<3e9?1:0,'far sphere path must disable');}
function guardedBody(text,condition){const start=text.indexOf(condition);assert(start>=0,`guard ${condition}`);const open=text.indexOf('{',start);let depth=1,end=open+1;while(end<text.length&&depth){if(text[end]==='{')depth++;if(text[end]==='}')depth--;end++;}assert.equal(depth,0,`guard closes: ${condition}`);return {body:text.slice(open+1,end-1),end};}
const atmo=guardedBody(shader,'if (uAtmoEnabled > 0.5)');
assert(atmo.body.includes('sphereHitT(ro, dir, ATM_RT)')&&atmo.body.includes('atmoMarch('),'all expensive/inaccurate distant atmosphere work inside guard');
assert(!shader.slice(atmo.end).includes('sphereHitT(ro,'),'no unguarded atmosphere intersection');
const band=guardedBody(shader,'if (uSolarBand > 0.0 && uPanoramaReady > 0.5)');
assert(band.body.includes('vec2 uv = panoramaUV(dir);') && band.body.includes('texture2D(uSkyPanorama, uv)'),'real photograph sampled only when ready and visible');
assert(!/uDiffuse|mix\(photograph|PHOTO_GALAXY|createPhotoGalaxy/.test(src),'native source has no diffuse replacement or invented photo volume');
assert(shader.includes('gl_FragColor = vec4(L, uPhotoAlpha);'),'main opaque sky defaults to one while additive bridge uses explicit photo weight');
assert.equal(sky.uniforms.uPhotoAlpha.value,1,'source alpha defaults opaque');
assert.equal(sky.uniforms.uDiffuseReady,undefined,'blurred diffuse texture removed');
assert(shader.indexOf('gl_FragColor =',band.end)>=band.end,'fragment output outside photo guard for unavailable photo or ground');
assert(!/\b(?:n3|h13)\s*\(|float\s+(?:sunGlow|zodiac|rift|clouds|transmission)\b/.test(shader),'procedural dust/noise/fake glow removed, not a synthesis fallback');
assert.equal(sky.uniforms.uPanoramaReady.value,0,'photo starts unavailable');
assert.equal(sky.uniforms.uSkyPanorama.value,sandbox.skyPanoramaEmpty,'safe placeholder until loader succeeds');
// Extract real DPR policy and real renderFrame scene gate, not a test-side reimplementation.
const ratioSource=section('let solarOverviewResolution = false;', 'function applyRenderScale(');
function ratioHarness({base=.85,scale=.8,deep=false,mode='adaptive',deepScale=.61}={}){
 const c={basePR:()=>base,PERF:{scale},DEEP:{active:deep},DEEP_PERF:{scale:deepScale},deepPerfMode:()=>mode};
 vm.createContext(c);vm.runInContext(ratioSource,c);
 return {c,value:()=>vm.runInContext('desiredRenderPR()',c),overview:on=>vm.runInContext(`solarOverviewResolution = ${!!on}`,c)};
}
let pr=ratioHarness();near(pr.value(),.68,'ordinary low-quality adaptive rendering retained');pr.overview(true);near(pr.value(),1,'solar low-quality native CSS floor');pr.overview(false);near(pr.value(),.68,'leaving overview removes floor');
for(const base of [1.25,2]){pr=ratioHarness({base,scale:.9});pr.overview(true);near(pr.value(),base*.9,'above-native DPR preserved');}
for(const mode of ['adaptive','reference','disabled']){pr=ratioHarness({deep:true,mode,deepScale:.61});const expected=.85*(mode==='adaptive'?.61:1);near(pr.value(),expected,'DEEP baseline');pr.overview(true);near(pr.value(),expected,'DEEP unaffected by stale overview flag');}
const overviewGate=src.match(/const overview = [^;]+;[\s\S]*?(?=\s*const size = renderer\.getDrawingBufferSize)/);
assert(overviewGate,'actual pre-render overview gate extracted');
function gateCase({foreign=false,cosmic=false,cosmicR=1e20,bh=false,neb=null,exo=null,alt=1e10,initial=false,busy=false,resizing=false}={}){
 const main={},cosmos={},c={scene:main,S:cosmic?cosmos:foreign?{}:main,CS:{scene:cosmos,orbitR:cosmicR},BH:{active:bh},NEB:{active:neb},EXO:{active:exo},cam:{alt},solarOverviewResolution:initial,_screenshotBusy:busy,_screenshotResizing:resizing,applied:0};
 // vm bare-call this is not the host object; use closure to count without relying on this.
 c.applyRenderScale=()=>{c.applied++;};vm.runInNewContext(overviewGate[0],c);return c;
}
for(const opts of [{},{alt:1e13},{cosmic:true,cosmicR:1e16},{cosmic:true,cosmicR:9.99e20}]){const c=gateCase(opts);assert.equal(c.solarOverviewResolution,true,'solar scene at/above threshold');assert.equal(c.applied,1,'entering floor applies once');}
for(const opts of [{foreign:true},{cosmic:true,cosmicR:1e21},{cosmic:true,cosmicR:1e25},{bh:true},{neb:0},{neb:{}},{exo:{}},{alt:1e10-1}]){const c=gateCase({...opts,initial:true});assert.equal(c.solarOverviewResolution,false,'scene/altitude gate suppresses floor');assert.equal(c.applied,1,'exiting floor reapplies prior policy');}
for(const initial of [true,false]){const c=gateCase({alt:initial?1e10:1e9,initial});assert.equal(c.applied,0,'stable scene does not resize every frame');}
for(const opts of [{busy:true},{resizing:true}])for(const initial of [false,true]){const c=gateCase({...opts,initial,alt:initial?1e9:1e10});assert.equal(c.applied,0,'capture must not resize rendering');assert.equal(c.solarOverviewResolution,initial,'capture leaves policy pending for next normal frame');}
console.log('PASS extracted solar background behavior: .25/.32/.58 base opacity/recovery, actual photo readiness/blend and synthetic suppression, NEB/exo/BH/cosmos gating, distance atmosphere guard, photographic shader with no procedural fallback, top-level GLSL and unconditional output; native solar/near-cosmic DPR floor/scene gate, high DPR and DEEP preserved. VM/static shader checks only; no GPU/visual acceptance claim.');
