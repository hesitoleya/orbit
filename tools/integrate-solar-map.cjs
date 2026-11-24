'use strict';
// Pure source transform by default; --apply is explicit and reads latest app first.
// --stage-assets copies only the inspected exact source bytes, never re-encodes.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),MARK='/* ORBIT_SOLAR_EMISSION_MAP_V1 */';
const SOURCE_SHA='f22b1cfb306ddce72a7e3b628668a0175b745038ce6268557cb2f7f1bdf98b9d';
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const loader=`${MARK}
const solarEmissionState = (() => {
  const blank = new THREE.DataTexture(new Uint8Array([255,255,255,255]),1,1,THREE.RGBAFormat);
  blank.colorSpace=THREE.NoColorSpace;blank.needsUpdate=true;
  const state={texture:blank,ready:0,error:null};
  const packed=(window.__ORBIT_INLINE__||{}).sunEmission;
  const base=window.__ORBIT_ASSET_BASE__||(location.protocol==='file:'?'./public/data/':'./data/');
  const src=packed?(packed.startsWith('data:')?packed:'data:image/jpeg;base64,'+packed):base+'sun-emission-4k.jpg';
  new THREE.TextureLoader().load(src,t=>{
    t.colorSpace=THREE.SRGBColorSpace;t.flipY=false;
    t.wrapS=THREE.RepeatWrapping;t.wrapT=THREE.ClampToEdgeWrapping;
    t.minFilter=THREE.LinearMipmapLinearFilter;t.magFilter=THREE.LinearFilter;t.generateMipmaps=true;
    t.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());t.needsUpdate=true;
    state.texture=t;state.ready=1;
    if(sunMesh.material.uniforms.uSolarMap){sunMesh.material.uniforms.uSolarMap.value=t;sunMesh.material.uniforms.uSolarMapReady.value=1;}
    blank.dispose();
  },undefined,err=>{state.error='Solar System Scope emission map unavailable';console.warn(state.error,err);});
  return state;
})();
`;
function once(s,a,b){const n=s.split(a).length-1;if(n!==1)throw Error('Solar integration anchor count '+n+': '+a.slice(0,70));return s.replace(a,b);}
function transformApp(source){
 if(typeof source!=='string')throw TypeError('source must be text');
 if(source.includes(MARK)){for(const token of ['uSolarMapReady','solarMapSample','sourceSolar','sun-emission-4k.jpg'])if(!source.includes(token))throw Error('Partial solar integration: '+token);return source;}
 let s=once(source,'const sunMesh = new THREE.Mesh(',loader+'const sunMesh = new THREE.Mesh(');
 s=once(s,'uSunTime: { value: 0 }','uSunTime: { value: 0 },\n      uSolarMap: { value: solarEmissionState.texture },\n      uSolarMapReady: { value: solarEmissionState.ready }');
 s=once(s,'extensions: { derivatives: true },','extensions: { derivatives: true, shaderTextureLOD: true },');
 s=once(s,"      'uniform float uSunTime;',","      'uniform float uSunTime;',\n      'uniform sampler2D uSolarMap;',\n      'uniform float uSolarMapReady;',");
 const helper=[
 "      // Authored emissivity map is attached to the opaque object-space sphere.",
 "      'vec3 solarMapSample(vec3 d) {',",
 "      '  vec2 uv=vec2(atan(d.z,d.x)/6.28318530718+.5,.5-asin(clamp(d.y,-1.0,1.0))/3.14159265359);',",
 "      '  vec2 dx=dFdx(uv),dy=dFdy(uv);',",
 "      '  dx.x-=floor(dx.x+.5);dy.x-=floor(dy.x+.5);',",
 "      '  return texture2DGradEXT(uSolarMap,uv,dx,dy).rgb;',",
 "      '}',"
 ].join('\n');
 s=once(s,"      'float sunSpot(vec3 d, vec3 axis, float radius) {'",helper+"\n      'float sunSpot(vec3 d, vec3 axis, float radius) {'");
 s=once(s,"      '  vec3 color = 0.45 * uCol * textureK * spot * limb * limbTint;',",[
 "      // SSS is artistic false-color emission, NOT natural photosphere observation.",
 "      '  vec3 mappedSolar=solarMapSample(d);',",
 "      '  float sourceLum=dot(mappedSolar,vec3(.2126,.7152,.0722));',",
 "      '  float sourceContrast=clamp(pow(max(sourceLum,.0001)/.404,.85),.22,2.25);',",
 "      '  float polarWeight=1.0-smoothstep(.92,.995,abs(d.y));',",
 "      '  vec3 sourceSolar=vec3(1.22,.79,.36)*mix(1.0,sourceContrast,polarWeight);',",
 "      '  vec3 surfaceEmission=mix(vec3(textureK),sourceSolar*(.94+.06*textureK),.88*uSolarMapReady);',",
 "      '  vec3 color = 0.45 * uCol * surfaceEmission * spot * limb * limbTint;',"
 ].join('\n'));
 return s;
}
function stageAssets(){
 const src=path.join(root,'.workbuddy/cinematic-research/sss-sun-8k.jpg'),dest=path.join(root,'public/data/sun-emission-4k.jpg');
 const bytes=fs.readFileSync(src);assert.equal(hash(bytes),SOURCE_SHA,'inspected original SHA');
 if(fs.existsSync(dest))assert.equal(hash(fs.readFileSync(dest)),SOURCE_SHA,'existing deployed asset differs; refusing overwrite');else fs.writeFileSync(dest,bytes,{flag:'wx'});
 const meta={schemaVersion:1,provider:'Solar System Scope / INOVE',path:'public/data/sun-emission-4k.jpg',bytes:bytes.length,sha256:SOURCE_SHA,width:4096,height:2048,sourcePage:'https://www.solarsystemscope.com/textures/',downloadUrl:'https://www.solarsystemscope.com/textures/download/8k_sun.jpg',license:{spdx:'CC-BY-4.0',url:'https://creativecommons.org/licenses/by/4.0/'},semantics:'Artistic saturated solar emissivity texture, not natural-color photosphere or measured granulation. Advertised 8k URL actually decodes 4096x2048.',adaptation:'Source JPEG bytes unchanged; runtime converts sRGB to linear, derives luminance normalized by approximate linear mean .404, remaps golden emission, reduces polar stretching and combines with procedural sphere granulation, fixed sunspots and limb darkening.',attribution:'Solar System Scope / INOVE, CC BY 4.0; artistic shader adaptation by Orbit. Do not imply direct observational reconstruction.',visualReview:'Staged source inspected with read_image before deployment; organic structures present, polar stretching visible; GPU output still requires parent validation.'};
 const metaPath=path.join(root,'public/data/sun-emission-sources.json');
 if(fs.existsSync(metaPath)){const old=JSON.parse(fs.readFileSync(metaPath,'utf8'));assert.deepEqual(old,meta,'existing metadata differs');}else fs.writeFileSync(metaPath,JSON.stringify(meta,null,2)+'\n',{flag:'wx'});
 console.log('STAGED source-identical4K solar emissivity '+bytes.length+' bytes '+SOURCE_SHA);
}
function test(){const source=fs.readFileSync(path.join(root,'public/js/app.js'),'utf8'),out=transformApp(source);assert.equal(transformApp(out),out);new vm.Script(out.replace("import * as THREE from 'three';",'const THREE = {};'));
 for(const t of ['texture2DGradEXT(uSolarMap','dx.x-=floor(dx.x+.5)','uSolarMapReady','solarEmissionState','gl_FragDepth','sunHalo.visible = false'])assert(out.includes(t),t);
 assert(out.includes('1.0 - 0.47 * (1.0 - mu)'));assert(out.includes('0.45 * uCol * surfaceEmission'));assert(out.includes('if (resolved > 0.001)'));
 assert.throws(()=>transformApp('no host'),/anchor count/);console.log('PASS pure transform, parse, idempotence, date-line derivative, sphere+fineLOD+limb+nohalo preserved. No GPU claim.');}
module.exports={transformApp,stageAssets};
if(require.main===module){const args=new Set(process.argv.slice(2));if(args.has('--stage-assets'))stageAssets();if(args.has('--apply')){const p=path.join(root,'public/js/app.js'),before=fs.readFileSync(p,'utf8'),after=transformApp(before);if(after!==before)fs.writeFileSync(p,after);console.log(after===before?'Already solar-integrated':'Applied solar transform to latest source');}else test();}
