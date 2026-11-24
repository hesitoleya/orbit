'use strict';
const fs=require('fs'),assert=require('assert/strict');
const app=fs.readFileSync('public/js/app.js','utf8');
assert(app.includes("var GAL_TEX_ON = params.get('galTex') !== '0';"));
assert(app.includes('cosmicVisualInfo(){'));
assert(app.includes('const mainMwHaloVisible='));
assert(app.includes('CS.mainGalaxy.visible=BODY.on && insideK>.02 && mwFillK>.005;'),'current Milky Way volume is BODY/interior/blend gated');
assert(app.includes('CS.mainGalaxy.material.uniforms.uGain.value='));
assert(app.includes('const procWebK=webOn'));
assert(app.includes('CS.webMat.uniforms.uGain.value = procWebK * procK * cgK * (CS.webLineWeight == null ? 0 : CS.webLineWeight);'),'default natural view omits synthetic graph lines');
assert(app.includes('CS.ptsMat.uniforms.uGain.value = procWebK * procK * cgK;'));
assert(app.includes('photoLayer&&m.userData.photoLayer.visible'));
assert(!app.includes('!m.userData.webNode && !m.userData.photoLayer)'));
assert(app.includes('smoothstep(lgR, 25.60, 26.35)')||app.includes('smoothstep(lgR,25.60,26.35)'));
assert(app.includes('if (lgR > 26.35)'));
assert(!app.includes('smoothstep(lgR, 26.0, 26.50)'));
assert(!app.includes('if (lgR > 26.10)'));
const namedBuild=app.slice(app.indexOf('for (let i = 0; i < GAL_CAT.length; i++) {'),app.indexOf('/* 对话 145：同一星系的 3D 恒星点云。',app.indexOf('for (let i = 0; i < GAL_CAT.length; i++) {')));
assert(namedBuild.includes('ORBIT_OBSERVED_GALAXY_VOLUME.create(THREE'),'named bodies use photograph-constrained single volume');
assert(namedBuild.includes('const m=reconstructed?reconstructed.mesh:MAIN_VOLUMES.create('),'unphotographed bodies have a single explicit inferred fallback');
assert(namedBuild.includes('photoLayer:null'),'no second photo plane for named galaxies');
assert(!namedBuild.includes('new THREE.Mesh(geo, mat)')&&!namedBuild.includes('makeGalVolumeGeo('),'named source path does not build slice geometry');
assert(app.includes('observedVolume.setTexture(t)'),'async photo completion updates the ONE volume');
assert(!app.includes('mat.dispose();'));
assert(app.includes("uAlpha: { value: 0.05 }"));
assert(!app.includes("!(GXY.on && GXY.n) || R > 6.0e24"));
assert(app.includes('CS.web.visible = procWeb && cgK > .005;'));
assert(app.includes('const hasVisibleLayer=(m.visible&&(!m.material||m.material.opacity>.005))||!!(m.userData.photoLayer&&m.userData.photoLayer.visible);'));
assert(app.includes('m.visible = m.material.opacity > .005 && outside > 0.02'));
assert(app.includes('const sz = Math.max(trueSz, 5.0 * dist / pxRad);'));
assert(app.includes("if(m.userData.photoLayer)m.userData.photoLayer.visible=false"));
// Execute the actual source expressions, not a duplicate of their formulas.
const smoothstep=(x,a,b)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
const procExpr=app.match(/const procWebK=([^;]+);/)[1];
const proc=new Function('webOn','GXY','FIL','sdssK','insideK','return '+procExpr);
for(const catalog of [false,true])for(const filaments of [false,true]){
  let previous=-1;
  for(let i=0;i<=120;i++){
    const lg=24.5+i/100,sdssK=1-smoothstep(lg,24.70,25.30);
    const gain=proc(1,{on:catalog,n:267503},{on:filaments,data:[1]},sdssK,1);
    assert(gain>=previous-1e-12&&gain>=0&&gain<=1,'bounded monotonic handoff');
    if(previous>=0)assert(Math.abs(gain-previous)<.06,'no 0.01-decade handoff jump');
    assert.equal(proc(1,{on:catalog,n:267503},{on:filaments,data:[1]},sdssK,0),0,'outside/interior gating');
    previous=gain;
  }
}
const resolvedExpr=app.match(/const resolvedK=([^;]+);/)[1];
const resolved=new Function('szPx','smoothstep','return '+resolvedExpr);
assert.equal(resolved(5,smoothstep),0);assert.equal(resolved(12,smoothstep),1);
for(let px=5;px<12;px+=.01){assert(resolved(px+.01,smoothstep)>=resolved(px,smoothstep));assert(Math.abs(resolved(px+.01,smoothstep)-resolved(px,smoothstep))<.003);}
assert(app.includes('dotFade * (1-resolvedK)'));
assert(!app.includes('m.material.uniforms.uLayerOpacity.value=resolvedK*volumeWeight;'),'no legacy photo/analytic overlap weighting');
assert(app.includes('m.material.uniforms.uLayerOpacity.value=resolvedK;'),'resolved fade applies once, not photo/analytic weighting');
assert(app.includes('m.scale.setScalar(sz*0.5);'),'local box diameter2 maps to physical catalogue diameter');
assert(!app.includes('photoLayer.scale.setScalar(sz/.84);'),'removed tapered photo impostor size compensation');
// Execute the production volume CPU contract, not old shell/slice geometry.
require('../public/js/observed-galaxy-volume.js');
const observed=globalThis.ORBIT_OBSERVED_GALAXY_VOLUME;
for(const inclination of [0,.6,1.3,Math.PI/2]){
 const options={inclination,positionAngle:.4,sourceDistance:2.3},basis=observed.basis(options);
 const p=basis.imageU.map((u,k)=>u*.3+basis.imageV[k]*.15),source=basis.viewDirection.map(x=>x*2.3),uv=observed.project(p,options);
 for(const t of [.4,.7,1.2]){const rayPoint=source.map((x,k)=>x+(p[k]-x)*t),projected=observed.project(rayPoint,options);assert(Math.abs(projected[0]-uv[0])<1e-12&&Math.abs(projected[1]-uv[1])<1e-12,'photo source rays retain fixed UV through real depth');}
 assert(observed.column(p,basis.viewDirection,options)>0,'inferred volume has positive source column');
}
assert(observed.density([.25,0,0])>observed.density([.25,.12,0]));assert(observed.density([.25,.04,0])>.02,'finite nonzero disk depth, not a photo plane');
assert(observed.density([0,.12,0])>observed.density([.6,.12,0]),'nuclear depth differs from disk');
const mwGainExpr=app.match(/CS\.mainGalaxy\.material\.uniforms\.uGain\.value=([^;]+);/)[1];
const mwGain=new Function('mainMwPx','smoothstep','return '+mwGainExpr);
assert(Math.abs(mwGain(7.001,smoothstep)-mwGain(6.999,smoothstep))<.001,'no 7px Milky Way gain discontinuity');
assert.equal(mwGain(16,smoothstep),2.45);
const labelExpr=app.match(/const hasVisibleLayer=([^;]+);/)[1];
const label=new Function('m','return '+labelExpr);
assert.equal(label({visible:false,userData:{photoLayer:{visible:false}}}),false);
assert.equal(label({visible:false,userData:{photoLayer:{visible:true}}}),true);
assert.equal(label({visible:true,userData:{}}),true);
assert.equal(label({visible:true,material:{opacity:0},userData:{}}),false);
assert.equal(label({visible:true,material:{opacity:.01},userData:{}}),true);
assert(app.includes('a.userData.pos=a.position.clone().multiplyScalar(C_MPC);'));
assert(app.includes('v.copy(m.userData.pos).sub(camPos).divideScalar(unit);'));
assert(app.includes("if(!(CS.mainGalaxy&&CS.mainGalaxy.visible)){el.style.display='none';continue;}"));
assert(app.indexOf('cosmicLabels(camPos, unit);')>app.indexOf('CS.mainGalaxy.visible=BODY.on && insideK>.02 && mwFillK>.005;'),'current frame representation visibility precedes label projection');
const nodeExpr=app.match(/const nodeVisible=([\s\S]+?);/)[1];
const nodeVisible=new Function('m','CS','CMB','return '+nodeExpr);
assert.equal(nodeVisible({userData:{cmbNode:false}},{cosGroup:{visible:false},web:{visible:true}},{on:true}),false);
assert.equal(nodeVisible({userData:{cmbNode:false}},{cosGroup:{visible:true},web:{visible:false},webPts:{visible:false}},{on:true}),false);
assert.equal(nodeVisible({userData:{cmbNode:false}},{cosGroup:{visible:true},web:{visible:true}},{on:true}),true);
assert.equal(nodeVisible({userData:{cmbNode:true}},{cmbShell:{visible:true}},{on:true}),true);
assert.equal(nodeVisible({userData:{cmbNode:true}},{cmbShell:{visible:true}},{on:false}),false);
const cmbExpr=app.match(/: (smoothstep\(lgR, 25\.60, 26\.35\) \* \(1 - outK\))/)[1];
const cmb=new Function('lgR','outK','smoothstep','return '+cmbExpr);
assert(cmb(26.10,0,smoothstep)>.7,'CMB must be substantial at retired hide threshold');
assert.equal(cmb(26.35,0,smoothstep),1,'CMB fully entered before current internal cleanup');
// Execute the complete actual label pass against real Three.js projection.
const vm=require('node:vm'),threeCtx={console};threeCtx.window=threeCtx;
vm.runInNewContext(fs.readFileSync('public/js/three.min.js','utf8'),threeCtx);
const T=threeCtx.THREE;
const labelPassSource=app.slice(app.indexOf('function cosmicLabels(camPos, unit) {'),app.indexOf('/* 尺度读数：从 AU',app.indexOf('function cosmicLabels(camPos, unit) {')));
const cam=new T.PerspectiveCamera(55,1.6,.01,1e5);cam.updateMatrixWorld();
let previousLabelX;
for(const unit of [1e20,1e24,1e26]){
 const element=()=>({style:{display:'none'},textContent:'Structure'});
 const webEl=element(),mwEl=element(),cmbEl=element();
 const node={position:new T.Vector3(999,999,999),visible:true,userData:{webNode:true,dia:unit,pos:new T.Vector3(unit,0,-10*unit)}};
 const cmbNode={position:new T.Vector3(),visible:true,userData:{webNode:true,cmbNode:true,dia:unit,pos:new T.Vector3(-unit,2*unit,-10*unit)}};
 const CS={orbitR:1e25,pxPerRad:600,cam,labels:[{m:node,el:webEl,cos:true},{m:null,el:mwEl,mw:true},{m:cmbNode,el:cmbEl,cos:true}],cosGroup:{visible:true},web:{visible:true},webPts:{visible:true},mainGalaxy:{visible:false},cmbShell:{visible:false},cmbBall:{visible:false}};
 const CMB={on:true};
 const labelPass=new Function('THREE','CS','CMB','BH_ON','clamp','innerWidth','innerHeight',labelPassSource+';return cosmicLabels;')(T,CS,CMB,{value:1},(v,a,b)=>Math.max(a,Math.min(b,v)),1280,800);
 const camPos=new T.Vector3();labelPass(camPos,unit);
 assert.notEqual(webEl.style.display,'none','web label visible when matching layer is active');
 assert.equal(mwEl.style.display,'none','hidden Milky Way must not retain fixed-priority label');
 assert.equal(cmbEl.style.display,'none','hidden CMB must not retain node label');
 if(previousLabelX)assert.equal(webEl.style.left,previousLabelX,'same projected position across world units');previousLabelX=webEl.style.left;
 node.userData.dia=unit*.05;labelPass(camPos,unit);assert.equal(webEl.style.display,'none','ranking weight cannot rescue unresolved structure');node.userData.dia=unit;
 CS.web.visible=false;CS.webPts.visible=false;labelPass(camPos,unit);assert.equal(webEl.style.display,'none');
 CS.cmbShell.visible=true;labelPass(camPos,unit);assert.notEqual(cmbEl.style.display,'none');
 CMB.on=false;labelPass(camPos,unit);assert.equal(cmbEl.style.display,'none');
}
for(const [w,h]of [[390,844],[1280,800],[1920,1080]]){
 const cam2=new T.PerspectiveCamera(55,w/h,.01,1e5);cam2.updateMatrixWorld();const labels=[];
 for(let y=-.7;y<=.7;y+=.2)for(let x=-.85;x<=.85;x+=.15){const pos=new T.Vector3(x,y,0).unproject(cam2).normalize().multiplyScalar(10);labels.push({m:{visible:true,position:pos,userData:{dia:1}},el:{textContent:'X',style:{display:'none'}}});}
 const CS={cam:cam2,orbitR:1e23,pxPerRad:600,labels};
 const pass=new Function('THREE','CS','CMB','BH_ON','clamp','innerWidth','innerHeight',labelPassSource+';return cosmicLabels;')(T,CS,{on:true},{value:1},(v,a,b)=>Math.max(a,Math.min(b,v)),w,h);pass(new T.Vector3(),1);
 const n=labels.filter(x=>x.el.style.display!=='none').length,budget=Math.max(4,Math.min(12,Math.floor(w*h/110000)));assert(n>0);assert(n<=budget,'actual label pass respects screen area budget');
}
console.log('PASS complete actual label pass: unit-invariant Three.js projection, web/MilkyWay/CMB visibility');
console.log('PASS source-extracted physical web/resolved-point/MilkyWay fades, visible-body label gate and CMB overlap');
console.log('PASS named single-volume routing, no photo-plane overlap, actual inferred 3D density and perspective source-ray projection; browser GPU/visual acceptance remains separate.');
