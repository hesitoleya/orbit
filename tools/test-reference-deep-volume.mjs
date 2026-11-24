// node tools/test-reference-deep-volume.mjs；不依赖服务器或外部包。
import assert from 'node:assert/strict';
import * as T from '../public/js/three.module.min.js';
import '../public/js/reference-deep-volume.js';
const A=globalThis.OrbitReferenceDeepVolume;
const ids=['galaxy','rose','blue','pillar','remnant'];
for(const id of ids) assert.equal(A.resolveSource({id}),`data/jpg-depth/${id}.jpg`);
globalThis.__ORBIT_INLINE__={jpgDepth:{blue:'AAEC'},photoHD:{own:'AQ=='},photoHDKeys:['own','another'],photo:{own:'AA=='}};
assert.equal(A.resolveSource({id:'blue'}),'data:image/jpeg;base64,AAEC');
assert.equal(A.resolveSource({id:'blue',source:'mine.jpg'}),'mine.jpg');
assert.equal(A.resolveSource({photoKey:'own'}),'data:image/jpeg;base64,AQ==');
assert.equal(A.resolveSource({photoKey:'another'}),'data/photo-hd/another.jpg');
assert.throws(()=>A.create(T,{id:'unmatched'}));
// 精确控制检测图像素，仅替代 Canvas 2D；Three 对象、材质、相机、释放事件均使用项目原版。
const W=1200,H=900, sx=960,sy=720;
const peaks=[[64,80],[240,170],[388,455],[525,281],[806,510]];
globalThis.document={createElement:()=>({getContext(){const self=this;return {
  drawImage(){},scale(){},fillRect(){},createRadialGradient(){return {addColorStop(){}}},
  getImageData(){let w=self.width,h=self.height;const a=new Uint8ClampedArray(w*h*4).fill(20);
    for(const [x,y] of peaks)a.set([255,237,194,255],4*(Math.round(y*h/sy)*w+Math.round(x*w/sx)));
    for(let x=4;x<w-4;x++)a.set([200,220,190,255],4*(8*w+x));
    return {data:a};}
};}})};
// 实图 EGL 夹具：Pillow 提供缩小的检测栅格，生产代码执行峰值分离、几何和相机更新。
if(process.argv[2]==='--fixture') {
 const {readFileSync}=await import('node:fs'); const [id,path,W,H,side]=process.argv.slice(3),dims=[+W,+H],patches=[];
 const rgba=readFileSync(path);let grad;
 globalThis.document={createElement:()=>({getContext:()=>({drawImage(){},scale(){},getImageData(){return {data:rgba}},
  createRadialGradient(x,y,r0,_x,_y,r1){grad=[x,y,r0,r1];return {addColorStop(t,c){if(!t)grad.push(...c.match(/[\d.]+/g).slice(0,3).map(Number))}}},fillRect(){patches.push(grad)}})})};
 const h=A.create(T,{id,source:{width:+W,height:+H}});await h.ready;h.object.updateMatrixWorld(true);
 const [mesh,pts]=h.object.children[0].children,u=mesh.material.uniforms, mats=[];
 const fov=33, radius=1, fit=radius/Math.tan(fov*Math.PI/360)*1.03;
 const wide=id==='blue'?fit*1.52:fit;
 for(const [yaw,dist,offY] of [[0,wide,0],[42,wide,0],[22,fit*.40,.04]]){
  const a=yaw*Math.PI/180, camera=new T.PerspectiveCamera(fov,1,.015,30);
  camera.position.set(dist*Math.sin(a),offY,dist*Math.cos(a));camera.lookAt(0,offY,0);camera.updateMatrixWorld(true);
  mesh.onBeforeRender({getCurrentViewport:v=>v.set(0,0,+side,+side)},null,camera);
  mats.push({mv:new T.Matrix4().multiplyMatrices(camera.matrixWorldInverse,mesh.matrixWorld).toArray(),projection:camera.projectionMatrix.toArray(),
   eye:u.uEye.value.toArray(),forward:u.uForward.value.toArray(),viewZ:u.uViewZ.value.toArray(),near:u.uNear.value,pointScale:u.uPointScale.value,yaw,dist});
 }
 const attr=(g,key)=>Array.from(g.getAttribute(key).array);
 const data={dims,half:u.uHalf.value.toArray(),steps:u.uSteps.value,patches,broad:[u.uBroad.value.image.width,u.uBroad.value.image.height],
  tri:Array.from(mesh.geometry.index.array).flatMap(i=>Array.from(mesh.geometry.attributes.position.array.slice(3*i,3*i+3))),
  stars:pts?Object.fromEntries(['position','diameter','starColor'].map(k=>[k,attr(pts.geometry,k)])):{position:[]},mats};
 process.stdout.write(JSON.stringify(data));h.dispose();process.exit(0);
}
const programs=[];
for(const id of [...ids,'gc','other']){
 const h=A.create(T,{id,kind:id==='gc'?'cluster':'nebula',radius:5,source:{width:W,height:H}});
 assert(h.object.isGroup);assert.equal(await h.ready,h.object);
 const [mesh,pts]=h.object.children[0].children, u=mesh.material.uniforms;
 assert(mesh.isMesh && pts.isPoints);assert.equal(u.uPhoto.value.image.width,W);assert.equal(u.uPhoto.value.image.height,H);
 assert.equal(pts.geometry.attributes.position.count,5,'连续明丝不可误识为星');
 const p=pts.geometry.attributes.position;const z=Array.from({length:p.count},(_,i)=>p.getZ(i));
 assert(Math.max(...z)-Math.min(...z)>.10);assert.equal(p.getY(0)>0,true);
 const q=pts.geometry.attributes.starColor;assert(q.getX(0)>q.getZ(0));
 h.object.position.set(300,-100,40);h.object.rotation.set(.07,.11,.24);h.object.updateMatrixWorld(true);
 const camera=new T.PerspectiveCamera(60,1,.04,3000);camera.position.set(301,-95,50);camera.lookAt(h.object.position);camera.updateMatrixWorld(true);
 const renderer={getCurrentViewport:v=>v.set(0,0,128,128)};mesh.onBeforeRender(renderer,null,camera);
 assert(u.uEye.value.distanceTo(mesh.worldToLocal(camera.position.clone()))<1e-8);
 const proj=new T.Vector3(), shift=[];
 for(let k=0;k<p.count;k++) {const v=mesh.localToWorld(new T.Vector3().fromBufferAttribute(p,k));
   const cam2=camera.clone();cam2.translateZ(2);cam2.updateMatrixWorld(true);shift.push(proj.copy(v).project(camera).distanceTo(v.clone().project(cam2)));}
 assert(Math.max(...shift)-Math.min(...shift)>.001);
 const ortho=new T.OrthographicCamera(-2,2,2,-2,.01,100);ortho.updateMatrixWorld(true);pts.onBeforeRender(renderer,null,ortho);assert.equal(u.uOrtho.value,1);
 for(const layer of [mesh,pts])programs.push({name:id+'/'+layer.type,form:layer.material.defines.FORM,vert:layer.material.vertexShader,frag:layer.material.fragmentShader});
 const resources=[mesh.geometry,pts.geometry,mesh.material,pts.material,u.uPhoto.value,u.uBroad.value];let count=0;
 for(const r of resources)r.addEventListener('dispose',()=>count++);
 h.dispose();h.dispose();assert.equal(count,6);assert.equal(h.object.children.length,0);
}
let cancel=A.create(T,{id:'blue'});cancel.dispose();await assert.rejects(cancel.ready,{name:'AbortError'});
let pending;globalThis.Image=class {constructor(){pending=this}removeAttribute(){}};
cancel=A.create(T,{id:'blue'});await Promise.resolve();cancel.dispose();await assert.rejects(cancel.ready,{name:'AbortError'});assert.equal(pending.onload,null);
const fail=A.create(T,{id:'blue'});await Promise.resolve();pending.onerror();await assert.rejects(fail.ready,/blue/);
if(process.argv.includes('--shaders')){
 // 导出到标准输出供 EGL 离屏测试读取；使用 Three 的原生 include 和 WebGL2 宏。
 const expand=s=>s.replace(/^[ \t]*#include <([\w\d]+)>/gm,(_,k)=>expand(T.ShaderChunk[k]));
 for(const p of programs){const common=`#version 300 es\nprecision highp float;precision highp int;\n#define FORM ${p.form}\n#define USE_LOGDEPTHBUF\n#define USE_LOGDEPTHBUF_EXT\n`;
   p.vert=common+'#define attribute in\n#define varying out\n#define texture2D texture\nuniform mat4 modelViewMatrix,projectionMatrix;in vec3 position;\n'+expand(p.vert);
   p.frag=common+'#define varying in\n#define texture2D texture\n#define gl_FragDepthEXT gl_FragDepth\nout vec4 outputColor;\n#define gl_FragColor outputColor\n'+T.ShaderChunk.colorspace_pars_fragment+'\nvec4 linearToOutputTexel(vec4 v){return sRGBTransferOETF(v);}\n'+expand(p.frag);}
 process.stdout.write(JSON.stringify(programs));
}else console.log('PASS：7 种形态、专属素材选择、原图尺寸、星点与细丝区分、空间视差、两种相机、错误及释放。');
