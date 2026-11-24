'use strict';
// Source transform + real THREE CPU texture/loader protocol. No network/browser/GPU.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {transformApp}=require('./integrate-solar-map.cjs'),root=path.resolve(__dirname,'..');
const app=fs.readFileSync(path.join(root,'public/js/app.js'),'utf8'),MARK='/* ORBIT_SOLAR_EMISSION_MAP_V1 */',a=app.indexOf(MARK),b=app.indexOf('const sunMesh = new THREE.Mesh(',a);
assert(a>=0&&b>a,'current integrated solar loader');const loader=app.slice(a,b);
let count=0;function test(name,fn){fn();console.log('PASS '+(++count)+' '+name);}
test('deployed source identity, real4K dimensions provenance and honest rights metadata',()=>{
 const bytes=fs.readFileSync(path.join(root,'public/data/sun-emission-4k.jpg')),meta=JSON.parse(fs.readFileSync(path.join(root,'public/data/sun-emission-sources.json'),'utf8'));
 assert.equal(bytes.length,3696361);assert.equal(meta.bytes,bytes.length);assert.equal(meta.sha256,crypto.createHash('sha256').update(bytes).digest('hex'));
 assert.equal(meta.sha256,'f22b1cfb306ddce72a7e3b628668a0175b745038ce6268557cb2f7f1bdf98b9d');assert.equal(meta.width,4096);assert.equal(meta.height,2048);
 assert.equal(meta.license.spdx,'CC-BY-4.0');assert(meta.attribution.includes('Solar System Scope'));assert(meta.semantics.includes('not natural-color'));assert(meta.adaptation.includes('Source JPEG bytes unchanged'));
 // Parse JPEG SOF, not filename or an unverified metadata-only claim.
 let dims;for(let p=2;p<bytes.length;){assert.equal(bytes[p],255);const tag=bytes[p+1],len=bytes.readUInt16BE(p+2);if([0xc0,0xc1,0xc2].includes(tag)){dims=[bytes.readUInt16BE(p+7),bytes.readUInt16BE(p+5)];break;}p+=len+2;}assert.deepEqual(dims,[4096,2048]);
});
test('pure idempotent transforms preserve authentic current app and reject incomplete source',()=>{
 assert.equal(transformApp(app),app);assert.throws(()=>transformApp(null),/source must be text/);assert.throws(()=>transformApp(MARK),/Partial solar integration/);
 assert.throws(()=>transformApp('const sunMesh = new THREE.Mesh();'),/anchor count/);
 // Reverse only the declared additions to build an authentic pre-map source fixture.
 let before=app.slice(0,a)+app.slice(b);
 before=before.replace(',\n      uSolarMap: { value: solarEmissionState.texture },\n      uSolarMapReady: { value: solarEmissionState.ready }','');
 before=before.replace("      'uniform sampler2D uSolarMap;',\n      'uniform float uSolarMapReady;',\n",'');
 before=before.replace(/      \/\/ Authored emissivity map[^]*?(?=      'float sunSpot)/,'');
 before=before.replace(/      \/\/ SSS is artistic[^]*?(?=      '  gl_FragColor = vec4\(color, 1.0\);',)/,"      '  vec3 color = 0.45 * uCol * textureK * spot * limb * limbTint;',\n");
 before=before.replace('extensions: { derivatives: true, shaderTextureLOD: true },','extensions: { derivatives: true },');
 assert(!before.includes(MARK));assert(!before.includes('uSolarMap'));assert.equal(transformApp(before),app,'actual full app is exactly reproducible from original sphere source');
 new vm.Script(transformApp(before).replace("import * as THREE from 'three';",'const THREE = {};'));
});
function setup(packed,protocol='http:',assetBase){
 const box={console:{warn(){}},location:{protocol}};box.window=box;vm.runInNewContext(fs.readFileSync(path.join(root,'public/js/three.min.js'),'utf8'),box);
 const T=box.THREE;let request;T.TextureLoader=class{load(url,ok,progress,fail){request={url,ok,fail};}};
 box.__ORBIT_INLINE__=packed===undefined?{}:{sunEmission:packed};if(assetBase)box.__ORBIT_ASSET_BASE__=assetBase;
 vm.runInNewContext(`const THREE=window.THREE;const renderer={capabilities:{getMaxAnisotropy(){return 16;}}};${loader}\nconst sunMesh={material:{uniforms:{uSolarMap:{value:solarEmissionState.texture},uSolarMapReady:{value:solarEmissionState.ready}}}};window.testState=solarEmissionState;window.testMesh=sunMesh;`,box);
 return {box,T,request,state:box.testState,U:box.testMesh.material.uniforms};
}
test('unavailable map keeps complete procedural shader fallback without throwing',()=>{
 const {T,request,state,U}=setup();assert.equal(request.url,'./data/sun-emission-4k.jpg');assert.equal(state.ready,0);assert.equal(U.uSolarMapReady.value,0);assert(state.texture.isDataTexture);assert.equal(state.texture.colorSpace,T.NoColorSpace);
 assert.doesNotThrow(()=>request.fail(Error('offline')));assert.equal(state.ready,0);assert.equal(U.uSolarMapReady.value,0);assert.equal(U.uSolarMap.value,state.texture);assert(state.error.includes('unavailable'));
 assert(app.includes('surfaceEmission=mix(vec3(textureK),sourceSolar*(.94+.06*textureK),.88*uSolarMapReady)'));
});
test('inline full data URI/raw base64 and external asset bases resolve consistently',()=>{
 assert.equal(setup('aGVsbG8=').request.url,'data:image/jpeg;base64,aGVsbG8=');assert.equal(setup('data:image/jpeg;base64,aGVsbG8=').request.url,'data:image/jpeg;base64,aGVsbG8=');
 assert.equal(setup(undefined,'file:').request.url,'./public/data/sun-emission-4k.jpg');assert.equal(setup(undefined,'http:','/assets/').request.url,'/assets/sun-emission-4k.jpg');
});
test('successful decode updates uniforms atomically with linear sampling/mipmap filtering',()=>{
 const {T,request,state,U}=setup();let disposed=0;const blank=state.texture;blank.addEventListener('dispose',()=>disposed++);const tex=new T.Texture();request.ok(tex);
 assert.equal(state.ready,1);assert.equal(U.uSolarMapReady.value,1);assert.equal(U.uSolarMap.value,tex);assert.equal(state.texture,tex);assert.equal(disposed,1);
 assert.equal(tex.colorSpace,T.SRGBColorSpace);assert.equal(tex.flipY,false);assert.equal(tex.wrapS,T.RepeatWrapping);assert.equal(tex.wrapT,T.ClampToEdgeWrapping);assert.equal(tex.minFilter,T.LinearMipmapLinearFilter);assert.equal(tex.magFilter,T.LinearFilter);assert.equal(tex.anisotropy,8);assert.equal(tex.generateMipmaps,true);
});
test('spherical derivatives and runtime source are retained in both complete standalone builds',()=>{
 for(const name of ['space.html','index.html']){const html=fs.readFileSync(path.join(root,name),'utf8');assert(html.includes(MARK),name+' must be rebuilt from integrated app');const inlineMatch=html.match(/window\.__ORBIT_INLINE__=(\{[^]*?\});<\/script>/);assert(inlineMatch,name+' assetpack');
 const packed=JSON.parse(inlineMatch[1]).sunEmission;assert.equal(typeof packed,'string');
 const decoded=Buffer.from(packed.replace(/^data:image\/jpeg;base64,/,''),'base64');
 assert.equal(crypto.createHash('sha256').update(decoded).digest('hex'),'f22b1cfb306ddce72a7e3b628668a0175b745038ce6268557cb2f7f1bdf98b9d',name+' exact embedded source');assert(html.includes('texture2DGradEXT(uSolarMap,uv,dx,dy)'));assert(html.includes('dx.x-=floor(dx.x+.5);dy.x-=floor(dy.x+.5)'));assert.equal(transformApp(html),html);}
});
console.log('PASS '+count+' solar asset/loader/transform contracts; no rendered image/GPU/photographic-fidelity acceptance.');
