'use strict';
// Execute extracted production helpers with real THREE. CPU/VM, not visual acceptance.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const src=fs.readFileSync('public/js/app.js','utf8').replace(/\r\n/g,'\n');
const tc={console:{warn(){},log(){},error(){}}};vm.createContext(tc);vm.runInContext(fs.readFileSync('public/js/three.min.js','utf8'),tc);const THREE=tc.THREE;
function section(a,b){const i=src.indexOf(a),j=src.indexOf(b,i+a.length);assert(i>=0&&j>i,'missing '+a);return src.slice(i,j);}
function fn(name){const i=src.indexOf('function '+name+'('),j=src.indexOf('\n}',i);assert(i>=0&&j>i,'missing '+name);return src.slice(i,j+2);}
const smoothstep=(x,a,b)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);},clamp=(x,a,b)=>Math.max(a,Math.min(b,x)),V=(x=0,y=0,z=0)=>new THREE.Vector3(x,y,z);
const c={THREE,Math,DEG:Math.PI/180,smoothstep,clamp};vm.createContext(c);
vm.runInContext(section('const OBLIQUITY =','const AXIS_TILT ='),c);
vm.runInContext(section('function _eqDir(','const _gu =')+'\nglobalThis.GA=GA;',c);
vm.runInContext(section('const GALAXY_BRIDGE =','const GAIA =')+'\n'+fn('bridgeWeights')+'\n'+section('const BRIDGE_FRAME =','function ensureBridgeSky()')+'\nglobalThis.bridgeState=GALAXY_BRIDGE;',c);
const near=(a,b,m,t=1e-10)=>assert(Math.abs(a-b)<=t,m+': '+a+' != '+b);let pass=0;
function test(name,run){run();pass++;console.log('PASS '+name);}
test('reference weights reversible and persistent viewing pose',()=>{
 let last=1;for(let lg=12;lg<=23;lg+=.05){const r=10**lg,w=c.bridgeWeights(r,V(r,0,0));for(const k of ['photo','volume','pose'])assert(w[k]>=0&&w[k]<=1);near(w.photo+w.volume,1,'partition');near(w.pose,1,'pose must not dissolve with scale');assert(w.photo<=last+1e-12);last=w.photo;assert.deepEqual(c.bridgeWeights(r,V(r,0,0)),w);}
 assert(!/slerp|rho|uPhotoRadii|uPhotoOffset/.test(fn('bridgeWeights')));
});
test('proper N has positive determinant and exactly matches photograph orientation',()=>{
 const mapped=[V(1,0,0),V(0,1,0),V(0,0,1)].map(v=>c.bridgeToGalactic(v,V()));near(new THREE.Matrix4().makeBasis(...mapped).determinant(),1,'determinant');
 for(const v of [V(1,0,0),V(0,1,0),V(0,0,1),V(1,2,3).normalize()])assert(c.bridgeToEquatorial(c.bridgeToGalactic(v,V()),V()).distanceTo(v)<1e-10);
 const north=c.GA.ngp.clone(),center=c.GA.gc.clone().addScaledVector(north,-c.GA.gc.dot(north)).normalize(),east=V().crossVectors(center,north);
 assert(c.bridgeToGalactic(center,V()).distanceTo(V(-1,0,0))<1e-10);assert(c.bridgeToGalactic(north,V()).distanceTo(V(0,1,0))<1e-10);assert(c.bridgeToGalactic(east,V()).distanceTo(V(0,0,-1))<1e-10);
});
test('entry captures physical position and every camera ray without mirroring',()=>{
 const camera=new THREE.PerspectiveCamera(55,1.6,.1,1e9);camera.quaternion.setFromEuler(new THREE.Euler(.45,-.7,.35));camera.updateMatrixWorld();
 const position=V(.8,.3,-.5).normalize().multiplyScalar(1.8e16),calls=[];
 Object.assign(c,{camera,camAbs:position.clone(),SUN:{pos:V()},updateCamAbs(){},placeCamera(){},CS:{active:false,minR:1e16,cam:new THREE.PerspectiveCamera(55,1.6,.01,1e9)},cosmicEnter(r,th,ph){calls.push(r);c.CS.active=true;c.CS.orbitR=r;c.CS.theta=th;c.CS.phi=ph;},cosmicUpdate(){}});
 vm.runInContext(fn('enterGalaxyBridge'),c);c.enterGalaxyBridge(1.8e16);assert.equal(calls.length,1);
 const radial=c.mainToGalactic(position.clone().normalize(),V()),base=new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(radial,V(),V(0,1,0))),out=base.multiply(c.bridgeState.pose);
 for(const ray of [V(0,0,-1),V(.4,.3,-1).normalize(),V(-.4,.3,-1).normalize(),V(.4,-.3,-1).normalize()])assert(ray.clone().applyQuaternion(out).distanceTo(c.mainToGalactic(ray.clone().applyQuaternion(camera.quaternion),V()))<1e-10);
 c.enterGalaxyBridge(1.8e16);assert.equal(calls.length,1);
});
test('all physical input routes share bridge entry and reverse setter',()=>{
 const wheel=section("renderer.domElement.addEventListener('wheel',","window.addEventListener('keydown'"),mom=fn('momStep'),zoom=section('const ZOOM =','/* 本星系群取景'),pinch=section("renderer.domElement.addEventListener('pointermove',","renderer.domElement.addEventListener('wheel',");
 for(const [name,text] of [['wheel',wheel],['inertia',mom],['button',zoom]]){assert(text.includes('enterGalaxyBridge(next)'),name);assert(!/next > 1e20/.test(text));}
 for(const text of [wheel,pinch,mom,zoom])assert(text.includes('setCosmicZoomRadius('));assert(pinch.includes('enterGalaxyBridge(want)'));assert(!zoom.includes('FLY.a1 = 2.3e13'));
});
test('fixed captured residual survives every zoom scale and repeated updates',()=>{
 const state=c.bridgeState,cam=new THREE.PerspectiveCamera(55,1.6,.01,1e9),base=new THREE.Quaternion().setFromEuler(new THREE.Euler(.2,-.5,.1)),residual=new THREE.Quaternion().setFromEuler(new THREE.Euler(-.3,.15,.6)),uniforms={};
 for(const k of ['uFwd','uRight','uUpView'])uniforms[k]={value:V()};for(const k of ['uTanFov','uAspect','uSkyPanorama','uPanoramaReady','uSolarBand','uPhotoAlpha'])uniforms[k]={value:0};const sky={material:{uniforms},visible:false};
 Object.assign(c,{ensureBridgeSky:()=>sky,GAIA:{ready:false,mode:'combined'},SKY_PANORAMA:{ready:true},skyMat:{uniforms:{uSkyPanorama:{value:{original6K:true}}}},SUN_GAL:V(2.5e20,0,0),updateSkyPanoramaCredit(){},updateGaiaPanel(){},CS:{cam,orbitR:1.8e16}});state.active=true;state.pose.copy(residual);
 vm.runInContext(fn('updateBridgeSky'),c);const expected=base.clone().multiply(residual);
 for(const radius of [1.8e16,1e17,1e18,1e19,1e21,1e23,1e17]){c.CS.orbitR=radius;cam.quaternion.copy(base);c.updateBridgeSky(c.SUN_GAL.clone().add(V(radius,0,0)));near(cam.quaternion.angleTo(expected),0,'fixed complete frame',1e-7);assert.equal(uniforms.uSkyPanorama.value,c.skyMat.uniforms.uSkyPanorama.value);assert.equal(uniforms.uPhotoAlpha.value,c.bridgeWeights(radius,V(radius,0,0)).photo,'photograph fade follows displacement independently of optional measured catalogue');assert.equal(sky.visible,uniforms.uPhotoAlpha.value>.00001);}
 assert(!/slerp|poseWeight/.test(fn('updateBridgeSky')),'no scale-dependent roll');
});
test('reverse capture preserves full basis and residual does not fade during zoom',()=>{
 const camera=new THREE.PerspectiveCamera(55,1.5,.1,1e9),csCamera=new THREE.PerspectiveCamera(55,1.5,.01,1e9),state=c.bridgeState;csCamera.quaternion.setFromEuler(new THREE.Euler(-.3,.8,-.5));csCamera.updateMatrixWorld();state.offset.set(7e15,3e15,-2e15);state.active=true;
 const expectedPosition=c.galacticToMain(state.offset,V()),distance=expectedPosition.length(),expectedQ=new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(...[V(1,0,0),V(0,1,0),V(0,0,1)].map(v=>c.galacticToMain(v.applyQuaternion(csCamera.quaternion),V()))));
 const SUN={pos:V(),radius:7e8};Object.assign(c,{CS:{cam:csCamera,orbitR:distance,active:true},camera,SUN,cam:{focus:SUN,dir:V(1,0,0),shift:V(),alt:distance-SUN.radius,yaw:0,pitch:-Math.PI/2},MOM:{v:1,travel:1},_off:V(),_up:V(),_t4:V(),EARTH:{},efToWorld(){throw Error('unexpected Earth');},viewDirection(out){c._up.copy(c.cam.dir);return out.copy(c.cam.dir).negate();},updateCamAbs(){c.camAbs=c.cam.dir.clone().multiplyScalar(SUN.radius+c.cam.alt);},cosmicLeave(){c.CS.active=false;},_gotoBodyInstant(body,alt){c.cam.focus=body;c.cam.alt=alt;}});
 vm.runInContext(fn('placeCamera')+'\n'+fn('leaveGalaxyBridge'),c);c.leaveGalaxyBridge();c.placeCamera();assert(c.camAbs.distanceTo(expectedPosition)<4);near(camera.quaternion.angleTo(expectedQ),0,'exact return basis',1e-7);
 for(const alt of [distance/2,1e14,1e13]){c.cam.alt=alt;c.placeCamera();near(camera.quaternion.angleTo(expectedQ),0,'zoom must not fade residual',1e-7);c.placeCamera();near(camera.quaternion.angleTo(expectedQ),0,'nonaccumulating',1e-7);}
 assert(!/slerp|returnRadius\)\)/.test(fn('placeCamera')),'return path has no automatic roll');
});
console.log('RESULT galaxy bridge '+pass+' PASS. Real THREE/CPU/VM, no visual acceptance claim.');
