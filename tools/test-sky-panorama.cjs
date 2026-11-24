'use strict';
// Production IIFE/GLSL extraction: mocks exercise lifecycle and projection math, not WebGL.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const source=fs.readFileSync('public/js/app.js','utf8').replace(/\r\n/g,'\n');
function between(a,b){const start=source.indexOf(a),end=source.indexOf(b,start+a.length);assert(start>=0&&end>start,`missing production boundary: ${a}`);return source.slice(start,end);}
const loader=between('(function loadMilkyWayPanorama() {','\n})();')+'\n})();';
assert(loader.endsWith('})();'),'extract whole actual loader IIFE');
function harness({inline,maxTexture=8192,anisotropy=16,dimensions=[6000,3000],canvasError=false,textureError=false,srcError=false}={}){
 const images=[],textures=[],canvases=[],timers=new Map(),cleared=[],credits=[],warnings=[];let next=0;
 const state={ready:false,error:null,texture:null,width:0,height:0},empty={placeholder:true};
 class ImageMock{constructor(){this.naturalWidth=dimensions[0];this.naturalHeight=dimensions[1];this.width=dimensions[0];this.height=dimensions[1];images.push(this);}set src(v){this.url=v;if(srcError)this.onerror();}get src(){return this.url;}}
 class TextureMock{constructor(bitmap){if(textureError)throw Error('texture constructor failed');this.image=bitmap;textures.push(this);}}
 const c={Image:ImageMock,window:inline===undefined?{}:{__ORBIT_INLINE__:{skyPanorama:inline}},SKY_PANORAMA:state,
  skyMat:{uniforms:{uSolarBand:{value:.92},uSkyPanorama:{value:empty},uPanoramaReady:{value:0}}},
  renderer:{capabilities:{maxTextureSize:maxTexture,getMaxAnisotropy:()=>anisotropy}},
  THREE:{Texture:TextureMock,SRGBColorSpace:'sRGB',RepeatWrapping:'repeat',ClampToEdgeWrapping:'clamp',LinearMipmapLinearFilter:'mipmap-linear',LinearFilter:'linear'},
  document:{createElement(tag){assert.equal(tag,'canvas','no procedural image/canvas fallback');const calls=[],canvas={width:0,height:0,calls,getContext(kind){assert.equal(kind,'2d');if(canvasError)throw Error('2d unavailable');return {drawImage(...args){calls.push(args);}};}};canvases.push(canvas);return canvas;}},
  setTimeout(fn,ms){const id=++next;timers.set(id,{fn,ms});return id;},clearTimeout(id){cleared.push(id);timers.delete(id);},
  updateSkyPanoramaCredit(gain){credits.push({gain,ready:state.ready,error:state.error});},console:{warn(...args){warnings.push(args);}}};
 vm.runInNewContext(loader,c,{filename:'app.js:loadMilkyWayPanorama'});
 return {c,state,empty,images,textures,canvases,timers,cleared,credits,warnings,load:()=>images[0].onload(),error:()=>images[0].onerror(),timeout(){const timer=[...timers.values()][0];assert(timer,'pending timer');timer.fn();}};
}
for(const inline of [undefined,'','AAAA']){const h=harness({inline});assert.equal(h.images.length,1);assert.equal(h.images[0].decoding,'async');assert.equal(h.images[0].src,inline?'data:image/jpeg;base64,AAAA':'./data/sky/eso0932a-source.jpg');assert.equal([...h.timers.values()][0].ms,30000);assert.equal(h.state.ready,false);assert.equal(h.c.skyMat.uniforms.uPanoramaReady.value,0);assert.equal(h.c.skyMat.uniforms.uSkyPanorama.value,h.empty);}
for(const maxTexture of [8192,6000,4096]){
 const h=harness({maxTexture}),pendingTimeout=[...h.timers.values()][0].fn;h.load();const texture=h.textures[0],resized=maxTexture<6000;
 assert.equal(h.state.ready,true);assert.equal(h.state.error,null);assert.equal(h.state.texture,texture);assert.equal(h.c.skyMat.uniforms.uSkyPanorama.value,texture);assert.equal(h.c.skyMat.uniforms.uPanoramaReady.value,1);
 assert.equal(h.state.width,resized?4096:6000);assert.equal(h.state.height,resized?2048:3000);assert.equal(h.canvases.length,resized?1:0);
 if(resized){const canvas=h.canvases[0];assert.equal(texture.image,canvas);assert.equal(canvas.calls.length,1);assert.deepEqual(canvas.calls[0],[h.images[0],0,0,4096,2048]);}else assert.equal(texture.image,h.images[0]);
 assert.equal(texture.colorSpace,'sRGB');assert.equal(texture.wrapS,'repeat');assert.equal(texture.wrapT,'clamp');assert.equal(texture.minFilter,'mipmap-linear');assert.equal(texture.magFilter,'linear');assert.equal(texture.anisotropy,8);assert.equal(texture.needsUpdate,true);
 assert.equal(h.timers.size,0);assert.equal(h.credits.length,1);assert.equal(h.credits[0].ready,true);
 h.error();h.load();pendingTimeout();assert.equal(h.state.error,null,'late error/queued timeout cannot destroy success');assert.equal(h.textures.length,1,'late/duplicate load cannot allocate twice');assert.equal(h.credits.length,1,'terminal success credit remains stable');
}
{const h=harness({anisotropy:2});h.load();assert.equal(h.textures[0].anisotropy,2,'respect device limit');}
for(const [label,options,trigger] of [
 ['bad width',{dimensions:[5999,3000]},'load'],['bad height',{dimensions:[6000,2999]},'load'],['zero dimensions',{dimensions:[0,0]},'load'],
 ['image error',{},'error'],['timeout',{},'timeout'],['resize context failure',{maxTexture:4096,canvasError:true},'load'],['texture failure',{textureError:true},'load'],['synchronous image error',{srcError:true},null]
]){
 const h=harness(options);if(trigger)h[trigger]();assert.equal(h.state.ready,false,label);assert(h.state.error,`${label}: useful error`);assert.equal(h.c.skyMat.uniforms.uPanoramaReady.value,0,`${label}: never ready`);assert.equal(h.c.skyMat.uniforms.uSkyPanorama.value,h.empty,`${label}: no synthesized replacement`);assert.equal(h.state.texture,null);assert.equal(h.timers.size,0,`${label}: timer settled`);assert.equal(h.warnings.length,1);assert.equal(h.credits.length,1);
 const previous=h.state.error;h.load();h.error();assert.equal(h.state.error,previous,`${label}: terminal error stable`);assert.equal(h.textures.length,0,`${label}: late image cannot create fallback`);assert.equal(h.credits.length,1);
}
// Exercise the actual attribution/error DOM callback, not just its loader spy.
{
 const state={ready:false,error:null},nodes=new Map(),appended=[];
 const c={SKY_PANORAMA:state,document:{getElementById:id=>nodes.get(id)||null,createElement:tag=>{assert.equal(tag,'div');return {style:{},dataset:{},hidden:false,innerHTML:''};},body:{appendChild(node){nodes.set(node.id,node);appended.push(node);}}}};
 vm.createContext(c);vm.runInContext(between('function updateSkyPanoramaCredit(gain) {','const skyMat ='),c);
 c.updateSkyPanoramaCredit(0);assert.equal(appended.length,0,'no empty attribution element while sky hidden');
 c.updateSkyPanoramaCredit(.92);const badge=nodes.get('skyPanoramaCredit');assert.equal(badge.dataset.state,'loading');assert.equal(badge.hidden,false);assert(badge.innerHTML.includes('正在加载'));
 state.ready=true;c.updateSkyPanoramaCredit(.92);assert.equal(badge.dataset.state,'ready');assert(badge.innerHTML.includes('ESO/S. Brunier')&&badge.innerHTML.includes('creativecommons.org/licenses/by/4.0/'),'observed image attribution and license linked');assert(badge.innerHTML.includes('原片方向参照') && badge.innerHTML.includes('无深度') && badge.innerHTML.includes('不模糊 / 不翻转'),'native image is explicitly angular reference, not invented measured depth');
 c.updateSkyPanoramaCredit(0);assert.equal(badge.hidden,true,'gain zero hides attribution');
 state.ready=false;state.error='unavailable';c.updateSkyPanoramaCredit(.92);assert.equal(badge.dataset.state,'error');assert(badge.innerHTML.includes('加载失败')&&badge.innerHTML.includes('保留星表背景'),'useful failure, no fake success/synthesis');assert.equal(appended.length,1,'reuse badge through lifecycle');
}
// Execute the actual assembled shader's panoramaUV, with a deliberately narrow
// vector-expression translation. Unrecognized future GLSL edits fail, not silently
// switch to a test-owned mapping formula.
class Vector3{constructor(x=0,y=0,z=0){Object.assign(this,{x,y,z});}normalize(){const l=Math.hypot(this.x,this.y,this.z)||1;for(const k of ['x','y','z'])this[k]/=l;return this;}applyAxisAngle(axis,a){assert.deepEqual([axis.x,axis.y,axis.z],[1,0,0]);const y=this.y,z=this.z;this.y=Math.cos(a)*y-Math.sin(a)*z;this.z=Math.sin(a)*y+Math.cos(a)*z;return this;}}
const env={THREE:{Vector3,ShaderMaterial:class{constructor(o){Object.assign(this,o);}}},skyPanoramaEmpty:{},DEG:Math.PI/180,OBLIQUITY:23.4392911*Math.PI/180,atmoUniforms:()=>({}),atmoGLSL:()=>''};vm.createContext(env);vm.runInContext(between('const skyMat = new THREE.ShaderMaterial({','const skyMesh ='),env);const sky=vm.runInContext('skyMat',env),shader=sky.fragmentShader;
const match=shader.match(/vec2 panoramaUV\(vec3 dir\)\s*\{([\s\S]*?)\}/);assert(match,'actual spherical mapping function');
let mapping=match[1];assert(mapping.includes('uGalCenter - north * dot(uGalCenter, north)'),'center orthogonalization retained');mapping=mapping.replace('uGalCenter - north * dot(uGalCenter, north)','sub(uGalCenter, mul(north, dot(uGalCenter, north)))').replace(/\b(?:vec3|float)\s+(\w+)\s*=/g,'let $1 =');
assert(!/\b(?:vec3|float)\b/.test(mapping),'translation supports every declaration');
const dot=(a,b)=>a.reduce((sum,v,i)=>sum+v*b[i],0),normalize=a=>{const l=Math.hypot(...a);return a.map(v=>v/l);},sub=(a,b)=>a.map((v,i)=>v-b[i]),mul=(a,s)=>a.map(v=>v*s),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],near=(a,b,msg)=>assert(Math.abs(a-b)<1e-10,`${msg}: ${a} != ${b}`);
const projectionEnv={dot,normalize,sub,mul,cross,atan:Math.atan2,asin:Math.asin,clamp:(x,a,b)=>Math.min(b,Math.max(a,x)),vec2:(u,v)=>[u,v]};
function actualUV(dir,center=[1,0,0],north=[0,1,0]){return vm.runInNewContext(`(function(dir){${mapping}})(dir)`,{...projectionEnv,dir:normalize(dir),uGalCenter:center,uGalPole:north});}
for(const [dir,expected,label] of [[[1,0,0],[.5,.5],'center'],[[0,0,1],[.25,.5],'east l+90'],[[0,0,-1],[.75,.5],'west l-90'],[[1,1,0],[.5,.75],'north latitude45'],[[1,-1,0],[.5,.25],'south latitude45']]){const uv=actualUV(dir);near(uv[0],expected[0],`${label} u`);near(uv[1],expected[1],`${label} v`);}
for(const [dir,v] of [[[0,1,0],1],[[0,-1,0],0]]){const uv=actualUV(dir);assert(uv.every(Number.isFinite),'pole finite');near(uv[1],v,'pole latitude');}
const left=actualUV([-1,0,1e-8]),right=actualUV([-1,0,-1e-8]);assert(left[0]<1e-7&&right[0]>1-1e-7,'anti-center seam meets u0/u1 without mirroring');near(left[1],right[1],'seam latitude');
const center=normalize([sky.uniforms.uGalCenter.value.x,sky.uniforms.uGalCenter.value.y,sky.uniforms.uGalCenter.value.z]),north=normalize([sky.uniforms.uGalPole.value.x,sky.uniforms.uGalPole.value.y,sky.uniforms.uGalPole.value.z]),orthCenter=normalize(sub(center,mul(north,dot(center,north)))),east=normalize(cross(orthCenter,north));
near(dot(orthCenter,north),0,'actual frame orthogonal');near(dot(east,north),0,'east orthogonal north');near(dot(east,orthCenter),0,'east orthogonal center');
for(const [dir,u,v] of [[orthCenter,.5,.5],[east,.25,.5],[mul(east,-1),.75,.5],[north,null,1],[mul(north,-1),null,0]]){const uv=actualUV(dir,center,north);if(u!==null)near(uv[0],u,'actual catalogue landmark u');near(uv[1],v,'actual catalogue landmark v');}
assert(!/\b(?:h13|n3)\s*\(|float\s+(?:rift|zodiac|sunGlow)\b/.test(shader),'no procedural fallback in photographic shader');
const photoGuard=shader.indexOf('if (uSolarBand > 0.0 && uPanoramaReady > 0.5)'),sample=shader.indexOf('texture2D(uSkyPanorama, uv)');assert(photoGuard>=0&&sample>photoGuard,'sample behind ready/gain guard');
// Execute the production post-compositor assignment and CA expression: a ready
// photographic main overview or cosmic volume suppresses RGB edge separation;
// other scenes must reset it rather than inherit a stale override.
assert(source.includes('uPhotoSky: { value: 0 }'),'compositor starts without a photographic override');
assert(source.includes("'uniform float uCosmos, uPhotoSky;'"),'CA override is an actual shader uniform');
const photoAssignment=source.match(/uc\.uPhotoSky\.value = [^;]+;/);assert(photoAssignment,'actual compositor photo-sky assignment');
const composite=between("'uniform float uCosmos, uPhotoSky;'", "'  vec3 base;'");
const caExpression=composite.match(/'\s*float ca = ([^;]+);'/);assert(caExpression,'actual compositor CA shader expression');
for(const mode of ['main','cosmos','foreign'])for(const overview of [false,true])for(const ready of [false,true]){
 const scene={},cosmos={},c={scene,CS:{scene:cosmos},S:mode==='main'?scene:mode==='cosmos'?cosmos:{},solarOverviewResolution:overview,SKY_PANORAMA:{ready},uc:{uPhotoSky:{value:-1}}};vm.runInNewContext(photoAssignment[0],c);
 const expected=((mode==='main'&&overview)||mode==='cosmos')&&ready?1:0;assert.equal(c.uc.uPhotoSky.value,expected,'override scoped to photographic main overview or cosmic field');
 for(const grade of [0,1])for(const radiusSquared of [0,.25,1,4]){const actual=vm.runInNewContext(caExpression[1],{uGrade:grade,uPhotoSky:c.uc.uPhotoSky.value,gr2:radiusSquared});near(actual,grade*(1-expected)*.0016*radiusSquared,'real CA expression preserves/suppresses edge offset as intended');if(expected)assert.equal(actual,0,'photographic overview RGB samples stay coincident');}
 // Reuse the same uniform on a later foreign frame to catch stale overrides.
 c.S={};vm.runInNewContext(photoAssignment[0],c);assert.equal(c.uc.uPhotoSky.value,0,'foreign frame resets previous override');
}
assert(source.includes('base.r = texture2D(tScene, vUv - gq * ca).r;')&&source.includes('base.g = texture2D(tScene, vUv).g;')&&source.includes('base.b = texture2D(tScene, vUv + gq * ca).b;'),'zero CA really aligns the production RGB sample coordinates');
const nebAssignment=source.match(/nebMats\[i\]\.opacity = [^;]+;/);assert(nebAssignment,'actual separate sky-photo overlay assignment');
for(const photoGain of [0,.25,.5,1])for(const visibility of [0,.4,1]){const c={i:0,nebMats:[{opacity:-1}],starA:visibility,skyK:.8,skyAltK:.6,_nbs:[{dir:'observed-direction'}],skyOccK:dir=>{assert.equal(dir,'observed-direction');return .5;},photoGain};vm.runInNewContext(nebAssignment[0],c);near(c.nebMats[0].opacity,visibility*.8*.6*.5*(1-photoGain),'separate LMC/SMC/M42 sky sprites fade out under full-sky photograph');if(photoGain===1)assert.equal(c.nebMats[0].opacity,0,'full panorama suppresses duplicate nebula photos');}
const rawJPEG=fs.readFileSync('public/data/sky/eso0932a-source.jpg'),sha256=b=>crypto.createHash('sha256').update(b).digest('hex'),rawHash=sha256(rawJPEG),expectedRawHash='60400c92c54b7c1bd12299c69e83b16e5b6256e7dabacc478c021758ecd28179';
assert.equal(rawHash,expectedRawHash,'raw source bytes match retrieved ESO derivative, not a screenshot/normalized-preview hash');
const license=fs.readFileSync('public/data/sky/eso0932a-license.md','utf8');assert(license.includes(rawHash),'provenance record uses actual raw JPEG hash');assert(license.includes('ESO/S. Brunier')&&license.includes('creativecommons.org/licenses/by/4.0/'),'asset license/credit preserved');
// Optional packaging verification: only run after parent rebuilds final entries.
// This compares embedded bytes to the raw source JPEG; it does not reencode it.
if(process.argv.includes('--built')){
 const jpeg=fs.readFileSync('public/data/sky/eso0932a-source.jpg'),hash=b=>crypto.createHash('sha256').update(b).digest('hex');
 for(const file of ['space.html','index.html','space-http.html']){const html=fs.readFileSync(file,'utf8'),marker='window.__ORBIT_INLINE__=',start=html.indexOf(marker),end=html.indexOf(';</script>',start);assert(start>=0&&end>start,`${file}: inline object`);const pack=JSON.parse(html.slice(start+marker.length,end));if(file==='space-http.html')assert.equal(pack.skyPanorama,'','HTTP leaves panorama external');else{assert.equal(typeof pack.skyPanorama,'string');const decoded=Buffer.from(pack.skyPanorama,'base64');assert(decoded.equals(jpeg),`${file}: exact source JPEG bytes`);assert.equal(hash(decoded),hash(jpeg));}assert(html.includes('./data/sky/eso0932a-source.jpg'),`${file}: actual external URL fallback retained`);}
 console.log('PASS panorama built packs: offline raw JPEG byte/hash equality, HTTP external-only panorama; source SHA256 '+hash(jpeg));
}
console.log('PASS extracted observed-panorama loader: inline/URL, 6K native, device4K resize, sampler settings, error/invalid/timeout settlement and late-callback immunity without synthesis; actual shader CPU projection landmarks, orientation, seam, poles and orthogonal catalogue basis. Mock/CPU tests, not GPU or photographic visual acceptance.');
