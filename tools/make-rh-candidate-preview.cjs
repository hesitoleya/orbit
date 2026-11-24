'use strict';
/* RIGHT-HANDED cosmic-world candidate. Experimental only: never writes production
 * sources or entry artifacts. Built from current public/js/app.js via unique markers.
 *
 * World convention changes vs production (b89fa2fc…):
 *   galWorld: (-gx,gz,-gy) [mirror] -> (-gx,gz,+gy) [proper rotation, det=+1]
 *   programmatic galaxy stars: Z flipped
 *   Harris clusters: kz = -y
 *   galaxy photo PA: Euler(+incl,+pa) (undo mirror conjugation)
 *   CMB dipole: Z sign flipped
 *   Gaia/dust texture U flipped (keeps photo handedness of production)
 *   handoff: same rotation M maps forward/up; NO projection reflection P*S.
 */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8').replace(/\r\n/g,'\n');
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
let app=read('public/js/app.js'),html=read('public/index.html');
const suffix=process.argv[2]||'v4';
if(!/^[a-z0-9-]+$/.test(suffix))throw Error('invalid preview suffix');
function once(s,a,b){const parts=s.split(a);if(parts.length!==2)throw Error('missing/nonunique marker: '+a.slice(0,90));return parts[0]+b+parts[1];}

/* ---- world content: mirror -> proper rotation ---- */
app=once(app,'return out.set(-gx, gz, -gy).multiplyScalar(dist);','return out.set(-gx, gz, gy).multiplyScalar(dist);');
app=once(app,'const kx = SUN_LOCAL_KPC.x - x, ky = z, kz = y;','const kx = SUN_LOCAL_KPC.x - x, ky = z, kz = -y;');
app=once(app,'  for (let i = N_DISK + N_BULGE; i < o; i++) halo[i] = 1;\n  const geo = new THREE.BufferGeometry();',
  '  for (let i = N_DISK + N_BULGE; i < o; i++) halo[i] = 1;\n  for (let i = 2; i < o*3; i += 3) pos[i] = -pos[i]; /* RH: flip galactic Y axis */\n  const geo = new THREE.BufferGeometry();');
app=once(app,"new THREE.Euler(-photoIncl, -pa, 0, 'YXZ')","new THREE.Euler(photoIncl, pa, 0, 'YXZ')");
app=once(app,'      -Math.cos(bb) * Math.cos(lb), Math.sin(bb), Math.cos(bb) * Math.sin(lb)',
  '      -Math.cos(bb) * Math.cos(lb), Math.sin(bb), -Math.cos(bb) * Math.sin(lb)');
/* texture U flip: local x of the XY plane maps to world -Z after rotY(+pi/2);
 * flipping U keeps the Gaia/dust photo handedness of the production world. */
app=once(app,'      liftGaiaVolume(t);\n      t.colorSpace = THREE.SRGBColorSpace;',
  '      liftGaiaVolume(t);\n      t.wrapS = THREE.RepeatWrapping; t.repeat.x = -1; t.offset.x = 1; /* RH candidate */\n      t.colorSpace = THREE.SRGBColorSpace;');
app=once(app,'    new THREE.TextureLoader().load(dustURL, (dt) => {\n      dt.colorSpace = THREE.SRGBColorSpace;',
  '    new THREE.TextureLoader().load(dustURL, (dt) => {\n      dt.wrapT = THREE.RepeatWrapping; dt.repeat.y = -1; dt.offset.y = 1; /* RH: plane V is world -Z */\n      dt.colorSpace = THREE.SRGBColorSpace;');

/* Conjugated galaxy pose must also reflect its local content: S*R*v =
 * (S*R*S)*(S*v). Keep shared texture data intact; transform geometry once. */
app=once(app,'  const geo = makeGalVolumeGeo(2, 0.045, 0.16);',
  '  const geo = makeGalVolumeGeo(2, 0.045, 0.16);\n  geo.scale(1,1,-1);');
app=once(app,'    body.quaternion.copy(m.quaternion);',
  '    body.geometry.scale(1,1,-1);\n    body.quaternion.copy(m.quaternion);');
/* Finish the Z reflection for fallback discs, dust poses and cluster navigation.
 * Texture transforms apply to MeshBasicMaterial; custom disc shaders use geometry UVs. */
app=once(app,'  mwGeo.rotateX(-Math.PI * 0.5);',
  '  mwGeo.rotateX(-Math.PI * 0.5);\n  { const uv = mwGeo.getAttribute("uv"); for(let i=0;i<uv.count;i++) uv.setX(i,1-uv.getX(i)); uv.needsUpdate=true; }');
app=once(app,'        m.rotation.y = u * 0.028;','        m.rotation.y = -u * 0.028;');
app=once(app,'        m.rotation.x = u * 0.008;','        m.rotation.x = -u * 0.008;');
app=once(app,'const kx = SUN_LOCAL_KPC.x - r[7], ky = r[9], kz = r[8];',
  'const kx = SUN_LOCAL_KPC.x - r[7], ky = r[9], kz = -r[8];');
app=once(app,'CS.target.set((SUN_LOCAL_KPC.x - r[7]) * C_KPC, r[9] * C_KPC, r[8] * C_KPC);',
  'CS.target.set((SUN_LOCAL_KPC.x - r[7]) * C_KPC, r[9] * C_KPC, -r[8] * C_KPC);');
app=once(app,'const perp = new THREE.Vector3().crossVectors(axis, up).normalize();',
  'const perp = new THREE.Vector3().crossVectors(up, axis).normalize();');
/* Legacy stop and cine tables describe the mirrored world. Reflect theta, not phi. */
for(const name of ['JSTOP','CINE_VIEW']) {
  const re=new RegExp('const '+name+' = \\[([\\s\\S]*?)\\n\\];');
  const match=app.match(re);if(!match)throw Error('missing table '+name);
  app=once(app,match[0],match[0]+'\n'+(name==='JSTOP'
    ? 'for(const s of JSTOP) if(s.th!==undefined) s.th=-s.th;'
    : 'for(const v of CINE_VIEW) v[1]=-v[1];'));
}

/* ---- handoff candidate (same as v7 but with a proper rotation and no reflection) ---- */
const code=`
// ISOLATED RH CANDIDATE: anchored to last completed main render, NOT a same-time boundary.
const __CAND_LOOK=[[20.0,-0.54193,0.2608],[20.7437,-0.55473,0.26812],[21.0004,-0.57582,0.28017],[21.257,-0.5969,0.29222],[21.5137,-0.60975,0.29956],[21.771,-0.62071,0.30236],[22.0334,-0.66427,0.31204],[22.2959,-0.72219,0.32491]];
function __candLook(lg){
 const t=__CAND_LOOK;
 /* Preserve the full journey beyond the measured prefix; transform the old
  * curve delta about its last measured anchor instead of freezing lg>22.3. */
 if(lg>t[t.length-1][0]){
   const e=t[t.length-1],v=cineViewAt(lg),a=cineViewAt(e[0]);
   return [-e[1]+v[0]-a[0],e[2]+v[1]-a[1]];
 }
 if(lg<=t[0][0])return [-t[0][1],t[0][2]];
 for(let i=1;i<t.length;i++)if(lg<=t[i][0]){
   const a=t[i-1],b=t[i],u=(lg-a[0])/(b[0]-a[0]);
   return [-(a[1]+(b[1]-a[1])*u),a[2]+(b[2]-a[2])*u];
 }
 const e=t[t.length-1];return [-e[1],e[2]];
}
let __rhLast=null,__rhActive=null,__rhGeneration=0;
const __rhReport=window.__RH_CANDIDATE__={status:'experimental-right-handed',first:null,restores:[],errors:[],limitations:[
 'world mapping is a proper rotation (-gx,gz,+gy); no projection reflection',
 'last completed main snapshot, not same-time input',
 'projection xy only; depth retains cosmic units',
 'no culling/shader correction; no dual scene composition']};
/* same proper rotation as galWorld in this preview */
function __rhMap(v){return new THREE.Vector3(-v.dot(GA.gc),v.dot(GA.ngp),v.dot(GA.yg));}
function __rhCapture(K){
 if(CS.active||!JOURNEY.on||!JOURNEY.cine)return;
 const q=K.getWorldQuaternion(new THREE.Quaternion());
 __rhLast={frame:frameId,lg:JOURNEY.lg,position:camAbs.clone(),sun:SUN.pos.clone(),forward:K.getWorldDirection(new THREE.Vector3()),up:new THREE.Vector3(0,1,0).applyQuaternion(q),quaternion:q.clone(),projection:K.projectionMatrix.clone()};
}
function __rhApply(){
 if(!JOURNEY.on||!JOURNEY.cine||!__rhLast)return;
 if(!__rhActive){
  __rhReport.first=null; __rhReport.entry=null; __rhReport.generation=++__rhGeneration;
  const a=__rhLast,f=__rhMap(a.forward).normalize(),up=__rhMap(a.up).normalize();
  up.addScaledVector(f,-up.dot(f)).normalize();
  const position=SUN_GAL.clone().add(__rhMap(a.position.clone().sub(a.sun))),n=f.clone().negate(),phi=Math.asin(THREE.MathUtils.clamp(n.y,-1,1));
  if(Math.abs(phi)>1.45)throw Error('candidate polar clamp');
  const theta=Math.atan2(n.z,n.x),target=position.clone().addScaledVector(f,2.0e20);
  const base=__candLook(JOURNEY.lgCross);
  let offTh=theta-base[0];if(offTh>Math.PI)offTh-=Math.PI*2;else if(offTh<-Math.PI)offTh+=Math.PI*2;
  __rhActive={position,target,forward:f,up,theta,phi,offTh,offPh:phi-base[1],projection:a.projection.clone(),sourceFrame:a.frame};
  __rhReport.entry={mainFrame:a.frame,mainLg:a.lg,mainForward:a.forward.toArray(),mainUp:a.up.toArray(),mainPosition:a.position.toArray(),mainSun:a.sun.toArray(),mainQuaternion:a.quaternion.toArray(),mainProjection:a.projection.toArray(),mappedForward:f.toArray(),mappedUp:up.toArray(),candidatePosition:position.toArray(),unmappedForwardErrorDegrees:a.forward.angleTo(f)/DEG};
 }
 const a=__rhActive;CS.autoCenter=false;
 const k=1-THREE.MathUtils.smoothstep(JOURNEY.lg,20.0,22.0);
 const tw=THREE.MathUtils.smoothstep(JOURNEY.lg,20.6,22.2);
 CS.target.copy(a.target).multiplyScalar(1-tw);
 const vw=__candLook(JOURNEY.lg);
 CS.theta=vw[0]+a.offTh*k;
 CS.phi=THREE.MathUtils.clamp(vw[1]+a.offPh*k,-1.45,1.45);
 CS.upCur=a.up.clone().multiplyScalar(k).addScaledVector(new THREE.Vector3(0,1,0),1-k).normalize();
}
function __rhProjection(){
 if(!__rhActive||!JOURNEY.on)return;
 const a=__rhActive,P=CS.cam.projectionMatrix;
 CS.cam.updateProjectionMatrix();
 /* RH: copy main x/y rows but DO NOT reflect; world mapping is a rotation. */
 for(const i of [0,4,8,12,1,5,9,13])P.elements[i]=a.projection.elements[i];
 CS.cam.projectionMatrixInverse.copy(P).invert();
 if(!__rhReport.first){
  const n=new THREE.Vector3(Math.cos(CS.theta)*Math.cos(CS.phi),Math.sin(CS.phi),Math.sin(CS.theta)*Math.cos(CS.phi));
  const actual=CS.target.clone().addScaledVector(n,CS.orbitR),f=CS.cam.getWorldDirection(new THREE.Vector3());
  __rhReport.first={frame:frameId,sourceFrame:a.sourceFrame,lg:JOURNEY.lg,positionRelativeError:actual.distanceTo(a.position)/CS.orbitR,forwardErrorDegrees:f.angleTo(a.forward)/DEG,projection:P.toArray(),target:CS.target.toArray(),completed:false};
 }
}
function __rhReset(reason){
 if(__rhActive){CS.cam.updateProjectionMatrix();CS.upCur=null;__rhReport.restores.push({reason,frame:frameId,projection:CS.cam.projectionMatrix.toArray(),inverse:CS.cam.projectionMatrixInverse.toArray()});}
 __rhActive=null;__rhLast=null;
}
__rhReport.validate=(${require('./rh-candidate-validation-20261117.cjs').probe.toString()});
__rhReport.cineTimeAtLg=cineTimeAtLg;
__rhReport.basis={gc:GA.gc.toArray(),ngp:GA.ngp.toArray(),yg:GA.yg.toArray()};
`;
app=once(app,'function renderFrame(scRef, camRef, options) {',code+'\nfunction renderFrame(scRef, camRef, options) {');
app=once(app,'  const needPost = deepActive || (BLOOM.on && str > 0.001) || (GLARE.on && GLARE.vis > 0.002);','  if(!CS.active) __rhCapture(K);\n  const needPost = deepActive || (BLOOM.on && str > 0.001) || (GLARE.on && GLARE.vis > 0.002);');
app=once(app,'function cosmicUpdate(dt) {\n  const R = CS.orbitR;',"function cosmicUpdate(dt) {\n  try { __rhApply(); } catch(e) { __rhReport.errors.push(String(e)); __rhReset('apply-error'); throw e; }\n  const R = CS.orbitR;");
app=once(app,'  CS.cam.matrixWorldInverse.copy(CS.cam.matrixWorld).invert();','  CS.cam.matrixWorldInverse.copy(CS.cam.matrixWorld).invert();\n  __rhProjection();');
app=once(app,'    renderFrame(CS.scene, CS.cam);\n    return;',"    renderFrame(CS.scene, CS.cam);\n    if(__rhReport.first) { __rhReport.first.completed=true; if(params.get('candidateHold')==='1') JOURNEY.frozen=true; }\n    return;");
app=once(app,'function journeyStart(i) {',"function journeyStart(i) {\n  __rhReset('start');");
app=once(app,'function journeyStop(silent) {',"function journeyStop(silent) {\n  if(__rhActive && JOURNEY.on) __rhApply(); /* keep final candidate pose before removing override */\n  __rhReset('stop');");
app=once(app,'function cosmicLeave() {',"function cosmicLeave() {\n  __rhReset('leave');");
app=once(app,'    const T = Math.max(0, +t || 0);',`    const T = Math.max(0, +t || 0);
    if(cineLgAt(T)<JOURNEY.lgCross) __rhReset('reverse-seek');
    if(cineLgAt(T)>=JOURNEY.lgCross && !__rhLast) {
      journeyCineStep(cineTimeAtLg(JOURNEY.lgCross)-1e-3);
      updateCamAbs(); placeCamera(); __rhCapture(camera);
    }`);
app=once(app,'window.__SE = {','window.__rhInternals={galWorld,galPosition,GA,SUN_GAL,C_KPC,C_MLY,MWGC_LIST,GAL_CAT,WEB_NODES,COSMO_CAT,cosmicBuild,cosmicUpdate,decodeFilaments,decodeGalaxies,STAR_B64,cineViewAt,JSTOP,candidateLook:__candLook};\nwindow.__SE = {');
html=once(html,'<script type="module" src="./js/app.js"></script>',`<script type="module" src="./js/rh-candidate-preview-${suffix}.js"></script>`);
/* Supply only the Harris source, not a partial global inline resource table:
 * other loaders interpret that global as a complete offline bundle. */
const mwg=read('public/data/mwgc.json');JSON.parse(mwg);
app=once(app,'  if (!INL || !INL.mwg) return null;',
  '  if (!INL || !INL.mwg) return '+mwg.trim()+';');
html=html.replace('<title>','<title>EXPERIMENTAL RH CANDIDATE — ');
const files=[[`public/js/rh-candidate-preview-${suffix}.js`,app],[`public/rh-candidate-preview-${suffix}.html`,html]];
for(const [p] of files)if(fs.existsSync(path.join(root,p)))throw Error('refusing overwrite: '+p);
for(const [p,s] of files)fs.writeFileSync(path.join(root,p),s,{flag:'wx'});
console.log(JSON.stringify({sourceAppNormalized:hash(read('public/js/app.js')),files:files.map(([p,s])=>({path:p,sha256:hash(s)})),status:'experimental-right-handed-not-production'},null,2));
