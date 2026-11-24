'use strict';
// Experimental runtime candidate. Never write production sources or entry artifacts.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8').replace(/\r\n/g,'\n');
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
let app=read('public/js/app.js'),html=read('public/index.html');
const suffix=process.argv[2]||'v2';
if(!/^[a-z0-9-]+$/.test(suffix))throw Error('invalid preview suffix');
function once(s,a,b){const parts=s.split(a);if(parts.length!==2)throw Error('missing/nonunique marker: '+a);return parts[0]+b+parts[1];}
const code=`
// ISOLATED CANDIDATE: anchored to last completed main render, NOT a same-time boundary.
/* 正规取景目标：用生产入口自然旅程实测曲线（tools/p2-prod-look-sample-20261117.cjs，
 * 采样 app b89fa2fc…）。入场偏移按尺度衰减到这个曲线，避免物理侧视构图留到中段。
 * 首行 20.0 取 20.49 的稳定值，避免把入场瞬间的过渡值当成目标。 */
const __CAND_LOOK=[[20.0,-0.54193,0.2608],[20.7437,-0.55473,0.26812],[21.0004,-0.57582,0.28017],[21.257,-0.5969,0.29222],[21.5137,-0.60975,0.29956],[21.771,-0.62071,0.30236],[22.0334,-0.66427,0.31204],[22.2959,-0.72219,0.32491]];
function __candLook(lg){
 const t=__CAND_LOOK;
 if(lg<=t[0][0])return [t[0][1],t[0][2]];
 for(let i=1;i<t.length;i++)if(lg<=t[i][0]){
   const a=t[i-1],b=t[i],u=(lg-a[0])/(b[0]-a[0]);
   return [a[1]+(b[1]-a[1])*u,a[2]+(b[2]-a[2])*u];
 }
 const e=t[t.length-1];return [e[1],e[2]];
}
let __candLast=null,__candActive=null;
const __candS=new THREE.Matrix4().makeScale(-1,1,1);
const __candReport=window.__P2_CANDIDATE__={status:'experimental',first:null,restores:[],errors:[],limitations:['last completed main snapshot, not same-time input','projection xy only; depth retains cosmic units','no culling/shader correction','no dual scene composition']};
function __candMap(v){return new THREE.Vector3(-v.dot(GA.gc),v.dot(GA.ngp),-v.dot(GA.yg));}
function __candCapture(K){
 if(CS.active||!JOURNEY.on||!JOURNEY.cine)return;
 const q=K.getWorldQuaternion(new THREE.Quaternion());
 __candLast={frame:frameId,lg:JOURNEY.lg,position:camAbs.clone(),sun:SUN.pos.clone(),forward:K.getWorldDirection(new THREE.Vector3()),up:new THREE.Vector3(0,1,0).applyQuaternion(q),quaternion:q.clone(),projection:K.projectionMatrix.clone()};
}
function __candApply(){
 if(!JOURNEY.on||!JOURNEY.cine||!__candLast)return;
 if(!__candActive){
  const a=__candLast,f=__candMap(a.forward).normalize(),up=__candMap(a.up).normalize();
  up.addScaledVector(f,-up.dot(f)).normalize();
  const position=SUN_GAL.clone().add(__candMap(a.position.clone().sub(a.sun))),n=f.clone().negate(),phi=Math.asin(THREE.MathUtils.clamp(n.y,-1,1));
  if(Math.abs(phi)>1.45)throw Error('candidate polar clamp');
  /* 目标点必须用【跨层半径】2e20 反推（与 cosmicEnter 的入场半径一致）。
     v6 用当时 CS.orbitR：直接 seek 到 lg=21 时 orbitR 已是 2e21，目标被推到
     65 kpc 外，视线偏离银心 52°，银河盘落到画外（disc debug 实测 NDC.x=1.57）。 */
  const theta=Math.atan2(n.z,n.x),target=position.clone().addScaledVector(f,2.0e20);
  /* 入射精确：记录相对正规取景角（cineViewAt）的偏移，随后按尺度衰减回正规取景，
     既不跳变、也不让物理入射的“侧视”构图一直留在中段。 */
  const base=__candLook(JOURNEY.lgCross);
  let offTh=theta-base[0];if(offTh>Math.PI)offTh-=Math.PI*2;else if(offTh<-Math.PI)offTh+=Math.PI*2;
  __candActive={position,target,forward:f,up,theta,phi,offTh,offPh:phi-base[1],entryTheta:CS.theta,entryPhi:CS.phi,projection:a.projection.clone(),sourceFrame:a.frame};
  /* 只读导出：供独立验证做同快照 NDC 对照与负控，不参与候选逻辑 */
  __candReport.entry={mainFrame:a.frame,mainLg:a.lg,mainForward:a.forward.toArray(),mainUp:a.up.toArray(),mainPosition:a.position.toArray(),mainSun:a.sun.toArray(),mainQuaternion:a.quaternion.toArray(),mappedForward:f.toArray(),mappedUp:up.toArray(),candidatePosition:position.toArray(),unmappedForwardErrorDegrees:a.forward.angleTo(f)/DEG};
 }
 const a=__candActive;CS.autoCenter=false;
 /* v5：入射偏移按尺度衰减回正规取景（20→21.2），不再把物理侧视构图锁死全程；
    目标从入射点渐进到银心（20.6→22.2），替代被关闭的 autoCenter。 */
 const k=1-THREE.MathUtils.smoothstep(JOURNEY.lg,20.0,22.0);
 const tw=THREE.MathUtils.smoothstep(JOURNEY.lg,20.6,22.2);
 CS.target.copy(a.target).multiplyScalar(1-tw);
 const vw=__candLook(JOURNEY.lg);
 CS.theta=vw[0]+a.offTh*k;
 CS.phi=THREE.MathUtils.clamp(vw[1]+a.offPh*k,-1.45,1.45);
 CS.upCur=a.up.clone().multiplyScalar(k).addScaledVector(new THREE.Vector3(0,1,0),1-k).normalize();
}
function __candProjection(){
 if(!__candActive||!JOURNEY.on)return;
 const a=__candActive,P=CS.cam.projectionMatrix;
 CS.cam.updateProjectionMatrix();
 // Preserve cosmic near/far; copy original x/y projection rows, then view-space reflection.
 for(const i of [0,4,8,12,1,5,9,13])P.elements[i]=a.projection.elements[i];
 P.multiply(__candS);CS.cam.projectionMatrixInverse.copy(P).invert();
 if(!__candReport.first){
  const n=new THREE.Vector3(Math.cos(CS.theta)*Math.cos(CS.phi),Math.sin(CS.phi),Math.sin(CS.theta)*Math.cos(CS.phi));
  const actual=CS.target.clone().addScaledVector(n,CS.orbitR),f=CS.cam.getWorldDirection(new THREE.Vector3());
  __candReport.first={frame:frameId,sourceFrame:a.sourceFrame,lg:JOURNEY.lg,positionRelativeError:actual.distanceTo(a.position)/CS.orbitR,forwardErrorDegrees:f.angleTo(a.forward)/DEG,projection:P.toArray(),target:CS.target.toArray(),completed:false};
 }
}
function __candReset(reason){
 if(__candActive){CS.cam.updateProjectionMatrix();CS.upCur=null;__candReport.restores.push({reason,frame:frameId,projection:CS.cam.projectionMatrix.toArray(),inverse:CS.cam.projectionMatrixInverse.toArray()});}
 __candActive=null;__candLast=null;
}
__candReport.cineTimeAtLg=cineTimeAtLg;
__candReport.basis={gc:GA.gc.toArray(),ngp:GA.ngp.toArray(),yg:GA.yg.toArray()};
`;
app=once(app,'function renderFrame(scRef, camRef, options) {',code+'\nfunction renderFrame(scRef, camRef, options) {');
// Capture after aim side effects; candidate is consumed on a later loop after return.
app=once(app,'  const needPost = deepActive || (BLOOM.on && str > 0.001) || (GLARE.on && GLARE.vis > 0.002);','  if(!CS.active) __candCapture(K);\n  const needPost = deepActive || (BLOOM.on && str > 0.001) || (GLARE.on && GLARE.vis > 0.002);');
app=once(app,'function cosmicUpdate(dt) {\n  const R = CS.orbitR;',"function cosmicUpdate(dt) {\n  try { __candApply(); } catch(e) { __candReport.errors.push(String(e)); __candReset('apply-error'); throw e; }\n  const R = CS.orbitR;");
app=once(app,'  CS.cam.matrixWorldInverse.copy(CS.cam.matrixWorld).invert();','  CS.cam.matrixWorldInverse.copy(CS.cam.matrixWorld).invert();\n  __candProjection();');
app=once(app,'    renderFrame(CS.scene, CS.cam);\n    return;',"    renderFrame(CS.scene, CS.cam);\n    if(__candReport.first) { __candReport.first.completed=true; if(params.get('candidateHold')==='1') JOURNEY.frozen=true; }\n    return;");
app=once(app,'function journeyStart(i) {',"function journeyStart(i) {\n  __candReset('start');");
app=once(app,'function journeyStop(silent) {',"function journeyStop(silent) {\n  __candReset('stop');");
app=once(app,'function cosmicLeave() {',"function cosmicLeave() {\n  __candReset('leave');");
app=once(app,'    const T = Math.max(0, +t || 0);',`    const T = Math.max(0, +t || 0);
    if(cineLgAt(T)<JOURNEY.lgCross) __candReset('reverse-seek');
    if(cineLgAt(T)>=JOURNEY.lgCross && !__candLast) {
      journeyCineStep(cineTimeAtLg(JOURNEY.lgCross)-1e-3);
      updateCamAbs(); placeCamera(); __candCapture(camera);
    }`);
html=once(html,'<script type="module" src="./js/app.js"></script>',`<script type="module" src="./js/p2-candidate-preview-${suffix}.js"></script>`);
html=html.replace('<title>','<title>EXPERIMENTAL CANDIDATE — ');
const files=[[`public/js/p2-candidate-preview-${suffix}.js`,app],[`public/p2-candidate-preview-${suffix}.html`,html]];
for(const [p] of files)if(fs.existsSync(path.join(root,p)))throw Error('refusing overwrite: '+p);
for(const [p,s] of files)fs.writeFileSync(path.join(root,p),s,{flag:'wx'});
console.log(JSON.stringify({sourceAppNormalized:hash(read('public/js/app.js')),files:files.map(([p,s])=>({path:p,sha256:hash(s)})),status:'experimental-not-production'},null,2));
