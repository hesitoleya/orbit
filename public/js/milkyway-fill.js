/* Original INVENTED Milky Way fill. Not Gaia sources or a measured dust map.
 * Fixed proper-G heliocentric parsec positions: GC=(-8150,0,0), north=+Y.
 * Observer translation is subtracted before render-unit conversion. No moving
 * shells, wrapping, camera-following positions, elapsed-time trails or textures.
 */
(function(root){'use strict';
 const PC=3.0856775814913673e16,SUN_X=8150*PC,SEED=0x6d775f36,LOCAL_COUNT=72000,DISK_COUNT=180000,CLOUD_COUNT=0,CLOUD_SLICES=0;
 // Display PSF only: these constants never alter a source's physical position.
 const STAR_DISPLAY=Object.freeze({fluxScalePc:520,softDistancePc:90,falloff:1.10,minCssPixels:1.9,maxCssPixels:6.2,localBrightLuminosity:.24,localBrightCssFloor:3.5});
 function starProfile(luminosity,distancePc,dpr,kind){
  const proximity=clamp((distancePc-3000)/2000,0,1),localBright=(kind===0&&luminosity>=.24?1:0)*(1-proximity*proximity*(3-2*proximity));
  const d=Math.max(.05,distancePc),t=clamp((d-3000)/17000,0,1),resolved=1-t*t*(3-2*t);
  const flux=luminosity*Math.pow(STAR_DISPLAY.fluxScalePc/(d+STAR_DISPLAY.softDistancePc),STAR_DISPLAY.falloff)*(.28+.72*resolved)*(1+.80*localBright);
  const bright=clamp((flux-.25)/.75,0,1),spark=bright*bright*(3-2*bright),cssPixels=Math.max(clamp(1.9+Math.pow(Math.max(flux,0),.34)*1.8+spark*1.6,1.9,6.2),1.9+1.6*localBright);
  const f=clamp((d-35000)/125000,0,1),farFade=1-f*f*(3-2*f);
  return {flux,cssPixels,devicePixels:cssPixels*clamp(dpr==null?1:dpr,.1,3),radiance:Math.min(flux,1.8)*farFade*4.2/(cssPixels*cssPixels),spark,localBright};
 }
 const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
 function rng(seed){let s=seed>>>0;return()=>{s=(s+0x6D2B79F5)>>>0;let t=s;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296;};}
 function samplePopulation(options){
  options=options||{};const seed=options.seed==null?SEED:options.seed>>>0,rnd=rng(seed),normal=()=>rnd()+rnd()+rnd()+rnd()+rnd()+rnd()-3;
  const n=LOCAL_COUNT+DISK_COUNT,positions=new Float32Array(n*3),colors=new Float32Array(n*3),luminosities=new Float32Array(n),kinds=new Float32Array(n);
  const sphere=r=>{const y=rnd()*2-1,a=rnd()*Math.PI*2,q=Math.sqrt(1-y*y);return [q*Math.cos(a)*r,y*r,q*Math.sin(a)*r];};
  function disk(){
   let x,y,z,r,a,bulge=rnd()<.18;
   if(bulge){const q=sphere(2400*Math.pow(rnd(),.7));x=q[0];y=q[1]*.52;z=q[2];}
   else{r=Math.min(16000,450-4300*Math.log(Math.max(.03,1-rnd()*.975)));a=rnd()*Math.PI*2;
    if(rnd()<.82)a=(7.2*Math.log(Math.max(r/16000,.035))+Math.PI*2*Math.floor(rnd()*4))/4+normal()*.10;
    x=Math.cos(a)*r;z=Math.sin(a)*r;y=normal()*(rnd()<.12?650:95+r*.015);
   }return {p:[x-8150,y,z],bulge};
  }
  // Interleave two populations so drawRange quality preserves the entire Galaxy.
  let local=0,global=0;
  for(let i=0;i<n;i++){
   const useLocal=(i%7<2&&local<LOCAL_COUNT)||global>=DISK_COUNT;let p,bulge=false;
   if(useLocal){const u=(local+.5)/LOCAL_COUNT;const shell=Math.floor(rnd()*8),lo=Math.pow(3000,shell/8),hi=Math.pow(3000,(shell+1)/8);
    // Sparse nearest shells, progressively populated outer local neighbourhood.
    const radius=rnd()<.90?1+2999*Math.pow(rnd(),.52):Math.cbrt(lo*lo*lo+rnd()*(hi*hi*hi-lo*lo*lo));p=sphere(radius);p[1]*=.72+.28*(1-u);local++;
   }else{const g=disk();p=g.p;bulge=g.bulge;global++;}
   positions.set(p,i*3);kinds[i]=useLocal?0:1;
   const hot=!bulge&&rnd()<.47,red=rnd()<.18,white=rnd()<.30;
   const color=white?[.91,.94,1]:hot?[.47+rnd()*.22,.67+rnd()*.18,1]:red?[1,.48+rnd()*.18,.25+rnd()*.12]:[1,.79+rnd()*.12,.57+rnd()*.20];
   colors.set(color,i*3);luminosities[i]=(.025+Math.pow(rnd(),5)*.48)*(bulge?.50:1)*(useLocal?.78:1.15);
  }
  const clouds=[];
  // The solar-system-to-Galaxy handoff uses only spatially distributed stars;
  // no blue/pink dust cards or procedural color clouds are created here.
  for(let i=0;i<CLOUD_COUNT;i++){
   const local=i<220;let p,radius;
   if(local){p=sphere(25+Math.pow(rnd(),.55)*2200);p[1]*=.20;radius=8+rnd()*42;}
   else{const g=disk();p=g.p;p[1]*=.35;radius=30+rnd()*160;}
   const a=rnd()*Math.PI*2,b=(rnd()-.5)*1.8,nrm=[Math.cos(a)*Math.cos(b),Math.sin(b),Math.sin(a)*Math.cos(b)];
   const helper=Math.abs(nrm[1])<.9?[0,1,0]:[1,0,0];let u=[helper[1]*nrm[2]-helper[2]*nrm[1],helper[2]*nrm[0]-helper[0]*nrm[2],helper[0]*nrm[1]-helper[1]*nrm[0]],length=Math.hypot(...u);u=u.map(x=>x/length);
   const v=[nrm[1]*u[2]-nrm[2]*u[1],nrm[2]*u[0]-nrm[0]*u[2],nrm[0]*u[1]-nrm[1]*u[0]],pink=rnd()<.43,dust=rnd()<.38;
   clouds.push({position:p,radius,axisU:u,axisV:v,normal:nrm,color:dust?[.16,.105,.065]:pink?[.58,.19,.32]:[.18,.34,.62],dust,seed:rnd()*991});
  }
  return {seed,positions,colors,luminosities,kinds,clouds,localCount:local,diskCount:global,count:n};
 }
 const starVertex=`attribute vec3 aColor;attribute float aLum,aKind;uniform vec3 uCameraPc;uniform float uPcPerUnit,uGain,uDpr,uPxPerRad,uPopulation;varying vec3 vLight;varying float vSpark;varying float vLocalBright;
 void main(){vec3 relative=position-uCameraPc;float d=max(length(relative),.05);vec4 mv=modelViewMatrix*vec4(relative*uPcPerUnit,1.0);gl_Position=projectionMatrix*mv;
  float resolved=1.0-smoothstep(3000.0,20000.0,d);
   vLocalBright=(1.0-step(.5,aKind))*step(.24,aLum)*(1.0-smoothstep(3000.0,5000.0,d));
   float flux=aLum*pow(520.0/(d+90.0),1.10)*(.28+.72*resolved)*(1.0+.80*vLocalBright);
   vSpark=smoothstep(.25,1.0,flux);float cssSize=max(clamp(1.9+pow(max(flux,0.0),.34)*1.8+vSpark*1.6,1.9,6.2),1.9+1.6*vLocalBright);gl_PointSize=cssSize*uDpr;
  // Integrated flux falls with physical observer distance; unresolved disk points
  // do not retain huge constant 7px halos and burn the central bulge white.
  float farFade=1.0-smoothstep(35000.0,160000.0,d);vLight=mix(aColor,vec3(1.0),.24)*min(flux,1.8)*uGain*uPopulation*farFade/(cssSize*cssSize)*4.2;
  if(mv.z>=0.0)vLight=vec3(0.0);
 }`;
 const starFragment=`precision highp float;varying vec3 vLight;varying float vSpark;varying float vLocalBright;void main(){vec2 q=gl_PointCoord*2.0-1.0;float r=dot(q,q);if(r>1.0)discard;
   float core=exp(-r*mix(14.0,8.0,vLocalBright))*mix(4.2,3.3,vLocalBright),halo=exp(-r*4.5)*.22;
   float crossPSF=(exp(-abs(q.x)*35.0)*exp(-abs(q.y)*5.0)+exp(-abs(q.y)*35.0)*exp(-abs(q.x)*5.0))*.13*vSpark;
   gl_FragColor=vec4(vLight*(core+halo+crossPSF),0.0);
  }`;
 const cloudVertex=`attribute vec3 aCenter,aU,aV,aNormal,aColor;attribute vec4 aParams;uniform vec3 uCameraPc;uniform float uPcPerUnit,uGain;varying vec2 vUv;varying vec3 vColor;varying vec4 vParams;varying float vGain;
 void main(){vUv=uv*2.0-1.0;vColor=aColor;vParams=aParams;
  vec3 p=aCenter-uCameraPc+(aU*position.x+aV*position.y+aNormal*aParams.z*.10)*aParams.x;
  gl_Position=projectionMatrix*modelViewMatrix*vec4(p*uPcPerUnit,1.0);vGain=uGain*(1.0-smoothstep(15000.0,60000.0,length(aCenter-uCameraPc)));
 }`;
 const cloudFragment=`precision highp float;varying vec2 vUv;varying vec3 vColor;varying vec4 vParams;varying float vGain;
 float hash(vec3 p){p=fract(p*.1031+vParams.y*.0137);p+=dot(p,p.yzx+33.33);return fract((p.x+p.y)*p.z);}
 float noise(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);}
 float fbm(vec3 p){return .53*noise(p)+.28*noise(p*2.07)+.13*noise(p*4.19)+.06*noise(p*8.27);}
 void main(){float r=dot(vUv,vUv);if(r>1.0||vGain<.00001)discard;
  // One continuous field across overlapping depths, never repeated flat images.
  vec3 p=vec3(vUv*3.4,vParams.z*.38)+vec3(vParams.y*.071);
  vec3 warped=p+vec3(noise(p*1.3+4.1),noise(p*1.3+13.7),noise(p*1.3+29.2))*.95;
  float broad=fbm(warped),ridge=1.0-abs(2.0*noise(warped*2.7)-1.0);
  float clump=smoothstep(.47,.75,fbm(warped*3.0));
  float fine=noise(warped*12.0),edge=1.0-smoothstep(.52+.19*broad,.95,sqrt(r));
  float porous=smoothstep(.30,.65,broad),filament=pow(ridge,5.0)*(.45+.55*fine);
  float density=edge*porous*(.12+filament*1.8+clump*.9);
  float depthWeight=exp(-vParams.z*vParams.z*2.6)*.255;
  float opacity=density*.13*vGain*depthWeight;
  float dust=vParams.w;float alpha=clamp(opacity*mix(.45,2.7,dust),0.0,.24);
  vec3 c=mix(vColor,vec3(.48,.43,.36),.08)*(.55+filament*.95+clump*.60);
  // Muted filaments and warm brown extinction, not Gaussian colour discs.
  gl_FragColor=vec4(c*opacity*mix(2.5,.12,dust),alpha);
 }`;
 function create(T){
  if(!T||!T.InstancedBufferGeometry)throw new TypeError('Milky Way fill needs Three.js instancing');
  const data=samplePopulation(),object=new T.Group();object.name='Invented Milky Way stars and dust';object.userData.truth='Procedural artistic Milky Way fill. No measured source IDs, no observed dust or photo-depth reconstruction.';
  const geo=new T.BufferGeometry();geo.setAttribute('position',new T.BufferAttribute(data.positions,3));geo.setAttribute('aColor',new T.BufferAttribute(data.colors,3));geo.setAttribute('aLum',new T.BufferAttribute(data.luminosities,1));geo.setAttribute('aKind',new T.BufferAttribute(data.kinds,1));
  const shared={uCameraPc:{value:new T.Vector3()},uPcPerUnit:{value:1},uGain:{value:1},uDpr:{value:1},uPxPerRad:{value:600},uPopulation:{value:1}};
  const starMat=new T.ShaderMaterial({uniforms:shared,vertexShader:starVertex,fragmentShader:starFragment,transparent:true,depthTest:false,depthWrite:false,toneMapped:false,blending:T.CustomBlending,blendSrc:T.OneFactor,blendDst:T.OneFactor,blendEquation:T.AddEquation});
  const stars=new T.Points(geo,starMat);stars.name='Invented local shells and Milky Way disk';stars.frustumCulled=false;stars.renderOrder=-969;object.add(stars);
  // The former procedural cloud cards were intentionally removed: the handoff
  // now contains only fixed, spatially distributed stellar points.
  let disposed=false,last=null;const api={object,update(options){
   if(disposed)throw new Error('Milky Way fill disposed');options=options||{};const cam=options.cameraMeters,unit=options.unit;
   if(!cam||![cam.x,cam.y,cam.z,unit].every(Number.isFinite)||unit<=0)throw new TypeError('Finite absolute cameraMeters and positive unit required');
   const quality=options.quality||'high',count=quality==='low'||quality==='smooth'?84000:quality==='medium'?168000:data.count,gain=Number.isFinite(options.gain)?Math.max(0,options.gain):1;
   shared.uCameraPc.value.set((cam.x-SUN_X)/PC,cam.y/PC,cam.z/PC);shared.uPcPerUnit.value=PC/unit;shared.uGain.value=gain;shared.uDpr.value=Number.isFinite(options.dpr)?clamp(options.dpr,.1,3):1;shared.uPxPerRad.value=Number.isFinite(options.pxPerRad)?Math.max(1,options.pxPerRad):600;shared.uPopulation.value=Math.sqrt(data.count/count);
   geo.setDrawRange(0,count);object.visible=gain>0;
   last={cameraMeters:[cam.x,cam.y,cam.z],observerPc:shared.uCameraPc.value.toArray(),unit,gain,quality,starDrawCount:count,cloudDrawCount:0};return api;
  },info(){return {invented:true,observed:false,sourceIDs:false,seed:SEED,starCount:data.count,localCount:LOCAL_COUNT,diskCount:DISK_COUNT,cloudCount:0,cloudDepthSlices:0,starDisplay:STAR_DISPLAY,cloudAppearance:'Removed; transition is represented by fixed dispersed stellar points only',drawCalls:1,localRadiusPc:[1,3000],diskRadiusPc:16000,sunGalactocentricPc:[8150,0,0],frame:'proper-G heliocentric pc, Galactic north +Y',fixedPositions:true,timeDependent:false,billboard:false,disposed,last:last?{...last,cameraMeters:last.cameraMeters.slice(),observerPc:last.observerPc.slice()}:null};},dispose(){if(disposed)return;disposed=true;geo.dispose();starMat.dispose();object.remove(stars);}};return api;
 }
 root.ORBIT_MILKYWAY_FILL=Object.freeze({PC,SUN_X,SEED,LOCAL_COUNT,DISK_COUNT,CLOUD_COUNT,CLOUD_SLICES,STAR_DISPLAY,starProfile,samplePopulation,create,starVertex,starFragment,cloudVertex,cloudFragment});
})(typeof window!=='undefined'?window:globalThis);
