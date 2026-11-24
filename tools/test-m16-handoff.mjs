// node tools/test-m16-handoff.mjs；--shaders 为 EGL 输出正式材质和 Three 的展开代码。
import assert from 'node:assert/strict';
import * as T from '../public/js/three.module.min.js';
import {gzipSync} from 'node:zlib';
import {createHash,webcrypto} from 'node:crypto';
const hash=b=>createHash('sha256').update(b).digest('hex');
globalThis.window=globalThis;
await import('../public/js/main-volumes.js');await import('../public/js/cinematic-stars.js');
const pool=createMainVolumes(T),scene=new T.Scene(),cam=new T.PerspectiveCamera(),r={capabilities:{isWebGL2:true,maxTextures:16,maxVertexTextures:16,maxTextureSize:4096},getContext:()=>({isContextLost:()=>false,getParameter:()=>512}),getPixelRatio:()=>1};
const mesh=pool.create(9,17,[1,1,1],{m16Lod:true}),mat=mesh.material,U=mat.uniforms,stars=createCinematicStars(T,mesh,9);scene.add(mesh);
if(process.argv.includes('--shaders')){
 const expand=s=>s.replace(/^\s*#include <(\w+)>/gm,(_,k)=>expand(T.ShaderChunk[k]));
 const programs=[];for(const [name,m] of [['volume',mat],['stars',stars.material]])for(const blend of [false,true]){
  const common='#version 300 es\nprecision highp float;precision highp int;\n#define USE_LOGDEPTHBUF\n#define USE_LOGDEPTHBUF_EXT\n'+(blend?'#define M16_HANDOFF 1\n':'');
  const vert=common+'#define attribute in\n#define varying out\nuniform mat4 modelMatrix,viewMatrix,projectionMatrix,modelViewMatrix;uniform vec3 cameraPosition;in vec3 position;\n'+expand(m.vertexShader);
  const frag=common+'#define varying in\n#define texture2D texture\n#define gl_FragDepthEXT gl_FragDepth\nout vec4 outputColor;\n#define gl_FragColor outputColor\nuniform vec3 cameraPosition;\n'+T.ShaderChunk.colorspace_pars_fragment+'\nvec4 linearToOutputTexel(vec4 v){return v;}\n'+expand(m.fragmentShader);
  programs.push({name:name+(blend?'-blend':'-stable'),vert,frag});
 }process.stdout.write(JSON.stringify(programs));process.exit(0);
}
const files=new Map();function field(name,n){const file=name+'.bin.gz',raw=Buffer.alloc(n**3*4,47),gz=gzipSync(raw);files.set(file,gz.toString('base64'));return {file,dimensions:[n,n,n],channels:4,rawBytes:raw.length,compressedBytes:gz.length,sha256:hash(gz),rawSha256:hash(raw)};}
const p={type:9,id:'pillars',medium:field('density',256),light:field('light',2)},preview={medium:field('preview-density',32),light:field('preview-light',32)};
globalThis.__ORBIT_INLINE__={cinematic:{manifest:{schemaVersion:1,profiles:[p,{...p,type:6,medium:p.light}]},previews:{9:preview}}};
globalThis.document={readyState:'complete',getElementById:id=>({type:'application/octet-stream',textContent:files.get(id.slice('orbit-cine-'.length))})};
Object.defineProperty(globalThis,'crypto',{value:webcrypto,configurable:true});let now=100;
Object.defineProperty(globalThis,'performance',{value:{now:()=>now},configurable:true});
const timers=new Map();let id=0;globalThis.setTimeout=f=>{timers.set(++id,f);return id;};globalThis.clearTimeout=i=>timers.delete(i);
await import('../public/js/cinematic-assets.js');const api=ORBIT_CINEMATIC_ASSETS;api.init(T,r);
const draw=()=>{mesh.onBeforeRender(r,scene,cam);mesh.onAfterRender();stars.onBeforeRender(r);};
for(const action of ['finish','low','switch','exit','disable','timeout','not-drawn','too-few-units','dispose']){
 api.setEnabled(true);api.cancel();pool.configureCinematic({quality:'high'});const lo=await api.load(9,'low');assert.equal(lo.lod,'preview');
 pool.renderOpaqueDepth(r,scene,cam,32,32);if(action!=='not-drawn')draw();
 r.capabilities.maxTextures=action==='too-few-units'?7:16;
 let released=0;lo.density.addEventListener('dispose',()=>released++);
 const hi=await api.load(9,'high');assert.equal(hi.lod,'native');draw();
 if(action==='not-drawn'||action==='too-few-units'){assert.equal(released,1);assert(!mat.defines.M16_HANDOFF);continue;}
 assert(mat.defines.M16_HANDOFF);assert.equal(released,0);assert.equal(U.uM16NativeWeight.value,0);assert.equal(U.uM16PreviewLight.value,lo.light);assert.equal(U.uCineDensity.value,hi.density);
 assert.equal(api.status().gpuBytes,[...api.status().diagnostics].reduce((n,d)=>n+d.gpuBytes,lo.gpuBytes));
 for(const k of [.25,.5,.75]){now+=90;draw();assert.equal(U.uM16NativeWeight.value,k*k*(3-2*k));assert.equal(stars.material.uniforms.uM16NativeWeight.value,U.uM16NativeWeight.value);assert.equal(stars.material.uniforms.uM16PreviewDensity.value,lo.density);}
 if(action==='finish')now+=90;
 if(action==='low'){pool.configureCinematic({quality:'low'});assert.equal(await api.load(9,'low'),lo);}
 if(action==='switch')await api.load(6,'high');if(action==='exit')api.cancel();if(action==='disable')api.setEnabled(false);if(action==='dispose')api.dispose();if(action==='timeout')[...timers.values()][0]();
 draw();assert.equal(timers.size,0);assert(!mat.defines.M16_HANDOFF);assert(!stars.material.defines.M16_HANDOFF);assert.notEqual(U.uM16PreviewDensity.value,lo.density);
 if(action==='low'){assert.equal(released,0);assert.equal(U.uCineDensity.value,lo.density);assert.equal(stars.material.uniforms.uDensity.value,lo.density);}
 else assert.equal(released,1);
 if(action==='dispose'){assert.equal(api.status().gpuBytes,0);assert.equal(U.uCineEnabled.value,0);assert.notEqual(stars.material.uniforms.uDensity.value,hi.density);}
 console.log('PASS',action);
}
stars.userData.dispose();pool.dispose();console.log('PASS M16 实际加载器、有效深度绘制回调、两套材质权重与纹理释放');
