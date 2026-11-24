/* Main-scene local fixed 3D media: analytic fields and baked volumes.
 * M51 is explicitly image-guided with invented depth, not an observed reconstruction.
 * Shapes are illustrative, NOT reconstructed observational depth.
 * Call renderOpaqueDepth ONCE immediately before rendering the same scene/camera.
 * Actual opaque materials supply depth, including their discard, displacement and
 * gl_FragDepth. No overrideMaterial approximates custom analytic geometry.
 * WebGL2 only; if exact depth is unavailable/stale, volumes fail closed (hidden).
 */
(function(root){'use strict';
// One parameter table feeds both GLSL literals and deterministic CPU probes.
// Units are local volume coordinates; these are illustrative morphological fields.
const SHAPES=Object.freeze({ringRadius:.62,ringTube:.115,ringDepth:.15,
 remnantRadius:.68,remnantWidth:.09,shellRadius:.67,shellWidth:.145,
 horseDust:8.0,horseBackground:.78,horseDepth:.18});
const sq=x=>x*x,gauss=(p,c,s)=>Math.exp(-sq((p[0]-c[0])/s[0])-sq((p[1]-c[1])/s[1])-sq((p[2]-c[2])/s[2]));
function morphology(type,p,n=.5){
 const [x,y,z]=p,rr=Math.hypot(x,y,z);let emission=0,absorption=0;
 if(type===6){
  const cloud=gauss(p,[-.12,-.08,0],[.70,.53,.43])+ .55*gauss(p,[.43,-.25,-.12],[.43,.28,.30]);
  const cavity=gauss(p,[.19,.17,.13],[.34,.32,.33]);
  const core=gauss(p,[-.16,-.03,.03],[.14,.13,.13]);
  const veil=gauss(p,[-.12,.34,-.25],[.70,.20,.18]);
  const lane=gauss(p,[.16,-.16,.17],[.50,.11,.15]);
  emission=(cloud*(1-.91*cavity)*(.40+.80*n)+1.9*core+.55*veil)*.75;
  absorption=cloud*(.25+.65*n)+lane*2.0;
 }else if(type===7){
  const torus=Math.exp(-sq((Math.hypot(x,y)-SHAPES.ringRadius)/SHAPES.ringTube)-sq(z/SHAPES.ringDepth));
  emission=torus*(1.1+.75*n);absorption=torus*.60;
 }else if(type===8){
  const radius=rr+.035*Math.sin(9*x+3*y)*Math.sin(10*y-4*z);
  const shell=Math.exp(-sq((radius-SHAPES.remnantRadius)/SHAPES.remnantWidth));
  const f=Math.pow(.5+.5*Math.sin(33*x+17*y+9*z+4*n),8)+Math.pow(.5+.5*Math.sin(14*x-29*y+23*z-3*n),10);
  emission=shell*(.16+1.1*f)*(.5+n);absorption=shell*(.18+.35*n);
 }else if(type===9){
  const centers=[[-.38,-.10,.31,.12,.16],[.02,.12,.52,.15,.14],[.38,.22,.17,.10,.13]];
  let body=0,caps=0;
  for(const [cx,cz,top,w,d] of centers){
   const taper=w*(1+.32*(top-y));const path=cx+.055*Math.sin(y*3+cx*2);
   const cross=Math.exp(-sq((x-path)/taper)-sq((z-cz)/d));
   const length=Math.max(0,Math.min(1,(y+.77)/.15))*Math.max(0,Math.min(1,(top-y)/.12));
   body+=cross*length;
   caps+=gauss(p,[cx+.055*Math.sin(top*3+cx*2),top,cz],[w*1.35,.12,d*1.3]);
  }
  emission=body*(.10+.22*n)+caps*(1.35+.45*n);absorption=body*2.8+caps*.65;
 }else if(type===10){
  const lobes=Math.exp(-sq(Math.hypot(x,z)/(.14+.5*Math.abs(y))))*Math.exp(-sq((Math.abs(y)-.43)/.36));
  emission=lobes*(.40+1.2*n);absorption=lobes*1.8;
 }else if(type===11){
  const neck=gauss(p,[-.12+.22*(y+.1),-.22,.03],[.17,.43,SHAPES.horseDepth]);
  const head=gauss(p,[.035,.29,.03],[.22,.16,SHAPES.horseDepth]);
  const snout=gauss(p,[.29,.235,.03],[.22,.095,.15]);
  const ear=gauss(p,[-.055,.45,.025],[.065,.14,.12]);
  const base=gauss(p,[-.17,-.64,.04],[.55,.15,.23]);
  const horse=Math.max(Math.max(neck,head),Math.max(snout,Math.max(ear,base)));
  const background=gauss(p,[.03,.04,-.43],[.78,.85,.17]);
  emission=SHAPES.horseBackground*background*(.60+.65*n)+horse*.012;
  absorption=horse*SHAPES.horseDust*(.85+.3*n)+background*.12;
 }else if(type===12){
  const r=Math.hypot((x+.09)/1.04,(y-.02)/.87,z);
  const shell=Math.exp(-sq((r-SHAPES.shellRadius)/SHAPES.shellWidth));
  const rim=.72+.28*Math.sin(4*x-3*y)+.35*n;
  emission=shell*rim*(.55+.60*n);absorption=shell*(.65+.55*n);
 }
 const t=Math.max(0,Math.min(1,(rr-.88)/.30)),edge=1-t*t*(3-2*t);
 return {emission:emission*edge,absorption:absorption*edge};
}
root.ORBIT_NEBULA_SHAPES=Object.freeze({parameters:SHAPES,sample:morphology,
 truth:'Fixed illustrative object-space densities, not observed 3D reconstruction'});
root.createMainVolumes=function(T){
 const geometry=new T.BoxGeometry(2.6,2.6,2.6), materials=new Set();
 const depth={target:null,renderer:null,scene:null,camera:null,valid:false,busy:false,disposed:false,
  width:0,height:0,reason:'depth-not-rendered',generation:0,canvas:null};
 const depthUniforms={uOpaqueDepth:{value:null},uDepthSize:{value:new T.Vector2(1,1)},
  uDepthProjectionInverse:{value:new T.Matrix4()},uDepthCameraWorld:{value:new T.Matrix4()},
  uDepthLog:{value:0},uDepthLogFar:{value:1},uDepthHasTexture:{value:0}};
 const depthProjection=new T.Matrix4(),depthCameraWorld=new T.Matrix4();
 // Assets are owned by ORBIT_CINEMATIC_ASSETS; this pool only borrows their textures.
 // RGBA8: linear emission RGB/emissionScale, extinction A/sigmaMax.
 const fallback3D=new T.Data3DTexture(new Uint8Array([0,0,0,0]),1,1,1);
 fallback3D.format=T.RGBAFormat;fallback3D.type=T.UnsignedByteType;fallback3D.colorSpace=T.NoColorSpace;
 fallback3D.minFilter=T.LinearFilter;fallback3D.magFilter=T.LinearFilter;fallback3D.unpackAlignment=1;fallback3D.needsUpdate=true;
 const cine={quality:'high',steps:320,voxelFactor:.65};
 function configureCinematic(options){
  options=options||{};const quality=options.quality||'high';
  if(!['low','high','ultra'].includes(quality))throw new RangeError('Cinematic quality must be low, high or ultra');
  cine.quality=quality;cine.steps=quality==='low'?128:quality==='ultra'?448:320;
  cine.voxelFactor=quality==='low'?1.25:quality==='ultra'?.45:.65;
  return Object.assign({},cine);
 }
 function bindCinematic(mat,type){
  const api=root.ORBIT_CINEMATIC_ASSETS;
  const asset=api&&typeof api.get==='function'?api.get(type):null,U=mat.uniforms;
  const ready=!!(asset&&asset.ready!==false&&asset.density&&asset.light);
  U.uCineEnabled.value=ready?1:0;U.uCineSteps.value=cine.steps;
  U.uCineDensity.value=ready?asset.density:fallback3D;U.uCineLight.value=ready?asset.light:fallback3D;
  U.uCineDetail.value=ready&&asset.detail?asset.detail:fallback3D;
  U.uCineHasDetail.value=ready&&asset.detail?1:0;
   U.uCineShading.value=ready&&asset.shading?asset.shading:fallback3D;
   U.uCineHasShading.value=ready&&asset.shading?1:0;
    U.uCineFilteredShading.value=ready&&asset.shadingEncoding==='incoming-cartesian-response-unorm8'?1:0;
  U.uCineOccupancy.value=ready&&asset.occupancy?asset.occupancy:fallback3D;
  U.uCineHasOccupancy.value=ready&&asset.occupancy&&(asset.occupancyGrid||32)<=32?1:0;
  U.uCineGrid.value=ready?(asset.occupancyGrid||32):32;
  U.uCineSize.value=ready?(asset.size||128):128;
  U.uCineStepFactor.value=cine.voxelFactor;
  U.uCineSigmaMax.value=ready?(asset.sigmaMax||12):12;
  U.uCineEmissionScale.value=ready?(asset.emissionScale||4):4;
   U.uCineEmissionSqrt.value=ready&&asset.emissionEncoding==='sqrt-unorm8'?1:0;
  U.uCineLightScale.value=ready?(asset.lightScale||4):4;
  const p=ready&&asset.lightPosition?asset.lightPosition:[0,.25,.1];U.uCineLightPos.value.set(p[0],p[1],p[2]);
  // Explicit artistic wavelength-dependent dust albedo; absence preserves v202 neutral scattering.
   const albedo=ready&&asset.scatteringAlbedo?asset.scatteringAlbedo:[.55,.55,.55];
   const channel=i=>Number.isFinite(albedo[i])?Math.max(0,Math.min(.95,albedo[i])):.55;
   U.uCineAlbedo.value.set(channel(0),channel(1),channel(2));
   mat.userData.cinematicReady=ready;
   return asset;
 }
 const noise=`
 float hash(vec3 p){return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453);}
 float nv(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);}
 float fb(vec3 p){return .57*nv(p)+.28*nv(p*2.07)+.15*nv(p*4.17);}
 `;
 const fragment=`precision highp float;
 uniform mat4 uInverse;uniform float uType,uSeed,uGain,uLayerOpacity,uAnalyticSteps,uAnalyticSupportCull,uArms,uPitch,uBar;uniform vec3 uTint;
 uniform sampler2D uOpaqueDepth;uniform vec2 uDepthSize;
 uniform mat4 uDepthProjectionInverse,uDepthCameraWorld;
 uniform float uDepthEnabled,uDepthLog,uDepthLogFar,uDepthHasTexture;
 uniform highp sampler3D uCineDensity,uCineLight,uCineDetail,uCineOccupancy,uCineShading;
 #ifdef M16_HANDOFF
 uniform highp sampler3D uM16PreviewDensity,uM16PreviewLight;
 uniform float uM16NativeWeight;
 #endif
 uniform float uCineEnabled,uCineHasDetail,uCineHasShading,uCineFilteredShading,uCineHasOccupancy,uCineGrid,uCineSize,uCineSteps,uCineStepFactor;
 uniform float uCineSigmaMax,uCineEmissionScale,uCineEmissionSqrt,uCineLightScale;
 uniform vec3 uCineLightPos,uCineAlbedo;
 varying vec3 vWorld;
 ${noise}
 // Cache contains source-to-voxel shadowed incident radiance.
  vec2 signNotZero(vec2 v){return mix(vec2(-1.0),vec2(1.0),step(vec2(0.0),v));}
   vec3 decodeOct(vec2 encoded){
    vec2 f=encoded*2.0-1.0;vec3 n=vec3(f,1.0-abs(f.x)-abs(f.y));
    if(n.z<0.0)n.xy=(1.0-abs(n.yx))*signNotZero(n.xy);
    return n*inversesqrt(max(dot(n,n),.000001));
   }
   // Legacy oct must be NEAREST; current loader transcodes to Cartesian/response before LINEAR.
   vec4 cinematicMedium(vec3 p,vec3 rd,float footprint,bool preview){
   vec3 uv=clamp(p/2.6+.5,0.0,1.0);
   vec4 field;
   #ifdef M16_HANDOFF
   if(preview)field=textureLod(uM16PreviewDensity,uv,0.0);else
   #endif
   field=textureLod(uCineDensity,uv,0.0);
   float detail=1.0;
   if(!preview && uCineHasDetail>.5){
     // The high-resolution asset owns erosion. This residual tile fades at its Nyquist limit.
     float resolved=1.0-smoothstep(.35,1.0,footprint*67.2);
     float fine=textureLod(uCineDetail,p*2.1+.5,0.0).r;
     detail=1.0+(fine-.5)*.40*resolved;
    }
   float sigma=field.a*uCineSigmaMax*detail;
   // Explicit transfer encoding affects RGB only; sigma remains linear and independent.
    vec3 encodedEmission=field.rgb;
    vec3 decodedEmission=uCineEmissionSqrt>.5?encodedEmission*encodedEmission:encodedEmission;
    vec3 emission=decodedEmission*uCineEmissionScale*uGain*detail;
   vec3 incident;
   #ifdef M16_HANDOFF
   if(preview)incident=textureLod(uM16PreviewLight,uv,0.0).rgb*uCineLightScale;else
   #endif
   incident=textureLod(uCineLight,uv,0.0).rgb*uCineLightScale;
   vec3 incoming=normalize(p-uCineLightPos+vec3(.00001));float surfaceResponse=1.0;
    if(!preview && uCineHasShading>.5){
     vec4 encoded=textureLod(uCineShading,uv,0.0);
     // Filter Cartesian incoming direction and the pre-evaluated scalar closure,
     // never oct coordinates across their fold. No extra ray samples or texture fetches.
     if(uCineFilteredShading>.5){
      vec3 direction=encoded.rgb*2.0-1.0;float norm2=dot(direction,direction);
      if(norm2>.0001)incoming=direction*inversesqrt(norm2);
      surfaceResponse=.65+.70*encoded.a;
     }else{
      vec3 normal=decodeOct(encoded.rg);incoming=decodeOct(encoded.ba);
      surfaceResponse=.65+.70*max(0.0,dot(normal,-incoming));
     }
     // This porous-dust response never shades independent gas emissivity.
    }
   float g=.28,mu=clamp(dot(incoming,-rd),-1.0,1.0);
   float phase=(1.0-g*g)/(12.5663706*pow(max(1.0+g*g-2.0*g*mu,.001),1.5));
   vec3 scattering=sigma*uCineAlbedo*incident*phase*surfaceResponse;
   return vec4(emission+scattering,sigma);
  }
  float exitMacro(vec3 p,vec3 rd){
   vec3 uv=clamp(p/2.6+.5,vec3(.000001),vec3(.999999));
   vec3 cell=floor(uv*uCineGrid),side=step(vec3(0),rd);
   vec3 boundary=((cell+side)/uCineGrid-.5)*2.6;
   vec3 safe=mix(vec3(-1),vec3(1),side)*max(abs(rd),vec3(.000001));
   vec3 d=(boundary-p)/safe;
   return max(.00001,min(min(d.x,d.y),d.z)+.00001);
  }
  // Nearest-macro DDA plans only occupied support, not empty space between thin sheets.
   // 32^3 rays visit at most 3*32 cells; bounded 3*grid+3 also supports a 64^3 grid.
   float occupiedLength(vec3 ro,vec3 rd,float a,float b,out float count){
    count=0.0;if(uCineHasOccupancy<.5){count=1.0;return b-a;}
    float at=a,total=0.0;
    for(int oi=0;oi<195;oi++){
     if(at>=b)break;
     vec3 p=ro+rd*at;float segment=min(b-at,exitMacro(p,rd));
     vec3 uv=clamp(p/2.6+.5,0.0,1.0);
     if(textureLod(uCineOccupancy,uv,0.0).r>=.001){total+=segment;count+=1.0;}
     at+=segment;
    }
    // Malformed/oversized grid cannot silently truncate optical depth.
    if(at<b){total+=b-at;count+=1.0;}
    return total;
   }
   float sqr(float x){return x*x;}
  float gaussian3(vec3 p,vec3 c,vec3 s){vec3 q=(p-c)/s;return exp(-dot(q,q));}
  vec2 pillar(vec3 p,float cx,float cz,float top,float w,float d){
   float taper=w*(1.0+.32*(top-p.y)),path=cx+.055*sin(p.y*3.0+cx*2.0);
   float crossSection=exp(-sqr((p.x-path)/taper)-sqr((p.z-cz)/d));
   float body=crossSection*clamp((p.y+.77)/.15,0.0,1.0)*clamp((top-p.y)/.12,0.0,1.0);
   float cap=gaussian3(p,vec3(cx+.055*sin(top*3.0+cx*2.0),top,cz),vec3(w*1.35,.12,d*1.3));
   return vec2(body,cap);
  }
  // x=emission, y=absorption. No view/camera terms in any density equation.
  vec2 nebulaProfile(vec3 p,float n){
   float emission=0.0,absorption=0.0;
   if(uType<6.5){
    float cloud=gaussian3(p,vec3(-.12,-.08,0),vec3(.70,.53,.43))+.55*gaussian3(p,vec3(.43,-.25,-.12),vec3(.43,.28,.30));
    float cavity=gaussian3(p,vec3(.19,.17,.13),vec3(.34,.32,.33));
    float core=gaussian3(p,vec3(-.16,-.03,.03),vec3(.14,.13,.13));
    float veil=gaussian3(p,vec3(-.12,.34,-.25),vec3(.70,.20,.18));
    float lane=gaussian3(p,vec3(.16,-.16,.17),vec3(.50,.11,.15));
    emission=(cloud*(1.0-.91*cavity)*(.40+.80*n)+1.9*core+.55*veil)*.75;
    absorption=cloud*(.25+.65*n)+lane*2.0;
   }else if(uType<7.5){
    float torus=exp(-sqr((length(p.xy)-${SHAPES.ringRadius.toFixed(4)})/${SHAPES.ringTube.toFixed(4)})-sqr(p.z/${SHAPES.ringDepth.toFixed(4)}));
    emission=torus*(1.1+.75*n);absorption=torus*.60;
   }else if(uType<8.5){
    float radius=length(p)+.035*sin(9.0*p.x+3.0*p.y)*sin(10.0*p.y-4.0*p.z);
    float shell=exp(-sqr((radius-${SHAPES.remnantRadius.toFixed(4)})/${SHAPES.remnantWidth.toFixed(4)}));
    float f=pow(.5+.5*sin(33.0*p.x+17.0*p.y+9.0*p.z+4.0*n),8.0)+pow(.5+.5*sin(14.0*p.x-29.0*p.y+23.0*p.z-3.0*n),10.0);
    emission=shell*(.16+1.1*f)*(.5+n);absorption=shell*(.18+.35*n);
   }else if(uType<9.5){
    vec2 pillars=pillar(p,-.38,-.10,.31,.12,.16)+pillar(p,.02,.12,.52,.15,.14)+pillar(p,.38,.22,.17,.10,.13);
    emission=pillars.x*(.10+.22*n)+pillars.y*(1.35+.45*n);absorption=pillars.x*2.8+pillars.y*.65;
   }else if(uType<10.5){
    float lobes=exp(-sqr(length(p.xz)/(.14+.5*abs(p.y))))*exp(-sqr((abs(p.y)-.43)/.36));
    emission=lobes*(.40+1.2*n);absorption=lobes*1.8;
   }else if(uType<11.5){
    float neck=gaussian3(p,vec3(-.12+.22*(p.y+.1),-.22,.03),vec3(.17,.43,${SHAPES.horseDepth.toFixed(4)}));
    float head=gaussian3(p,vec3(.035,.29,.03),vec3(.22,.16,${SHAPES.horseDepth.toFixed(4)}));
    float snout=gaussian3(p,vec3(.29,.235,.03),vec3(.22,.095,.15));
    float ear=gaussian3(p,vec3(-.055,.45,.025),vec3(.065,.14,.12));
    float base=gaussian3(p,vec3(-.17,-.64,.04),vec3(.55,.15,.23));
    float horse=max(max(neck,head),max(snout,max(ear,base)));
    float background=gaussian3(p,vec3(.03,.04,-.43),vec3(.78,.85,.17));
    emission=${SHAPES.horseBackground.toFixed(4)}*background*(.60+.65*n)+horse*.012;
    absorption=horse*${SHAPES.horseDust.toFixed(4)}*(.85+.3*n)+background*.12;
   }else{
    float r=length(vec3((p.x+.09)/1.04,(p.y-.02)/.87,p.z));
    float shell=exp(-sqr((r-${SHAPES.shellRadius.toFixed(4)})/${SHAPES.shellWidth.toFixed(4)}));
    float rim=.72+.28*sin(4.0*p.x-3.0*p.y)+.35*n;
    emission=shell*rim*(.55+.60*n);absorption=shell*(.65+.55*n);
   }
   return vec2(emission,absorption);
  }
  vec4 medium(vec3 p){
  float radius=length(p);
   if(uAnalyticSupportCull>.5&&radius>=1.18)return vec4(0.0);
   float n=fb(p*8.0+uSeed),r=length(p.xz),h=abs(p.y),edge=1.0-smoothstep(.88,1.18,radius);
  vec3 emit=vec3(0);float dust=0.0;
  if(uType<5.5){
   float bulge=exp(-length(vec3(p.x,p.y*1.5,p.z))*12.0);
   float disk=exp(-r*3.2)*exp(-h/(.035+.065*r));
   float phase=atan(p.z,p.x)*uArms-log(max(r,.035))*uPitch;
   float arm=pow(.5+.5*cos(phase),5.0);
   float lane=pow(.5+.5*cos(phase+.50),12.0);
   float bar=exp(-pow(p.x/.48,2.0)-pow(p.z/.085,2.0)-pow(p.y/.05,2.0))*uBar;
   if(uType>1.5&&uType<2.5){disk=0.0;bulge=exp(-length(vec3(p.x,p.y*1.35,p.z*.85))*4.8);}
   if(uType>2.5&&uType<3.5){arm=.25;bulge*=2.0;disk*=1.25;lane=exp(-pow((r-.48)/.17,2.0));}
   if(uType>3.5){disk*=.45+1.8*n;arm=.3+1.7*smoothstep(.46,.72,n);bulge*=.35;}
   float knots=pow(max(0.0,n-.40)*2.6,3.0)*disk*arm;
   emit=(vec3(1.0,.69,.39)*bulge*1.6+vec3(.48,.63,1.0)*disk*(.10+1.8*arm*(.18+1.25*smoothstep(.32,.68,n)))+vec3(1.0,.24,.36)*knots*.7+vec3(1.0,.76,.49)*bar)*uTint;
   dust=disk*lane*(1.0+2.0*n)*3.2;
  }else{
   vec2 profile=nebulaProfile(p,n);
   
   
   
   
   emit=uTint*profile.x;dust=profile.y;
  }
  return vec4(emit*edge*uGain,dust*edge);
 }
 void main(){
  // A missing prepass must not resurrect the incorrect box-exit depth test.
  if(uDepthEnabled<0.5)discard;
  vec3 ro=(uInverse*vec4(cameraPosition,1.0)).xyz;
  vec3 endpoint=(uInverse*vec4(vWorld,1.0)).xyz;
  vec3 rd=normalize(endpoint-ro);
   // Evaluate derivatives before depth/occupancy-dependent branches and loops.
   float rayCone=max(length(dFdx(rd)),length(dFdy(rd)));
   float originFootprint=max(length(dFdx(ro)),length(dFdy(ro)));
  vec3 safe=mix(vec3(-1.0),vec3(1.0),step(vec3(0.0),rd))*max(abs(rd),vec3(.000001));
  vec3 aa=(-vec3(1.3)-ro)/safe,bb=(vec3(1.3)-ro)/safe;
  vec3 nearv=min(aa,bb),farv=max(aa,bb);
  float a=max(max(nearv.x,nearv.y),nearv.z),b=min(min(farv.x,farv.y),farv.z);
  a=max(a,0.0);
  vec2 depthUV=gl_FragCoord.xy/uDepthSize;
  float opaqueDepth=1.0;
  if(uDepthHasTexture>0.5)opaqueDepth=texture2D(uOpaqueDepth,depthUV).r;
  if(opaqueDepth<1.0){
   vec2 ndc=depthUV*2.0-1.0;
   vec3 viewPoint;
   if(uDepthLog>0.5){
    // Three r160 + the analytic Earth encode log2(1 + positive view-Z).
    float viewZ=exp2(opaqueDepth*uDepthLogFar)-1.0;
    vec4 rayH=uDepthProjectionInverse*vec4(ndc,0.0,1.0);
    vec3 rayView=normalize(rayH.xyz/rayH.w);
    viewPoint=rayView*(viewZ/max(-rayView.z,0.000001));
   }else{
    vec4 p=uDepthProjectionInverse*vec4(ndc,opaqueDepth*2.0-1.0,1.0);
    viewPoint=p.xyz/p.w;
   }
   vec3 localHit=(uInverse*uDepthCameraWorld*vec4(viewPoint,1.0)).xyz;
   b=min(b,dot(localHit-ro,rd));
  }
  if(b<=a)discard;
  float trans=1.0;vec3 radiance=vec3(0);
   if(uCineEnabled>.5){
    #ifdef M16_HANDOFF
    vec4 previewRay=vec4(0.0,0.0,0.0,1.0);
    for(int layer=0;layer<2;layer++){
     bool preview=layer==0;
     if((preview && uM16NativeWeight>=1.0)||(!preview && uM16NativeWeight<=0.0))continue;
     trans=1.0;radiance=vec3(0.0);
    #else
     const bool preview=false;
    #endif
    float t=a,voxel=2.6/(preview?32.0:uCineSize),samples=0.0,occupiedCells=1.0;
    bool skipEmpty=!preview && uCineHasOccupancy>.5;
    float occupiedRemaining=b-a;
    if(!preview)occupiedRemaining=occupiedLength(ro,rd,a,b,occupiedCells);
     float cellRemaining=0.0,cellSamples=0.0;
    // Static subpixel phase: no temporal crawling; accumulation can supply frame jitter later.
    float jitter=fract(sin(dot(gl_FragCoord.xy,vec2(12.9898,78.233)))*43758.5453);
    for(int ci=0;ci<768;ci++){
     if(samples>=uCineSteps||t>=b||trans<.004)break;
     vec3 p=ro+rd*t,uv=clamp(p/2.6+.5,0.0,1.0);
     if(skipEmpty&&textureLod(uCineOccupancy,uv,0.0).r<.001){t+=min(b-t,exitMacro(p,rd));cellRemaining=0.0;continue;}
      if(cellRemaining<=.0000001){
       cellRemaining=skipEmpty?min(b-t,exitMacro(p,rd)):b-t;
       float available=max(1.0,uCineSteps-samples);
       // Every occupied macrocell reserves >=1 sample; no local refinement can starve the far side.
       float proportional=available*cellRemaining/max(occupiedRemaining,.000001);
       float minimum=ceil(cellRemaining/max(voxel*uCineStepFactor,.000001));
       float allocation=min(minimum,max(1.0,floor(proportional+.5)));
       cellSamples=min(allocation,max(1.0,available-max(0.0,occupiedCells-1.0)));
      }
     // Cover the full remaining interval even at a low budget; never truncate the back of a nebula.
     float remaining=max(1.0,cellSamples);
     float ds=min(b-t,cellRemaining/remaining);
     // Alternating stratified phases remove repeated fixed-phase combing along each ray.
      float phaseOffset=mix(jitter,1.0-jitter,mod(samples,2.0));
      float sampleT=t+(.35+.30*phaseOffset)*ds;
      float footprint=originFootprint+rayCone*sampleT;
      vec4 m=cinematicMedium(ro+rd*sampleT,rd,footprint,preview);
     float tr=exp(-m.a*ds);
     float segment=m.a>.00001?(1.0-tr)/m.a:ds;
     radiance+=trans*m.rgb*segment;trans*=tr;t+=ds;samples+=1.0;
      occupiedRemaining=max(0.0,occupiedRemaining-ds);cellRemaining=max(0.0,cellRemaining-ds);cellSamples-=1.0;
      if(cellRemaining<=.0000001){occupiedCells=max(0.0,occupiedCells-1.0);cellRemaining=0.0;}
    }
    #ifdef M16_HANDOFF
     if(preview)previewRay=vec4(radiance,trans);
    }
    if(uM16NativeWeight<=0.0){radiance=previewRay.rgb;trans=previewRay.a;}
    else if(uM16NativeWeight<1.0){radiance=mix(previewRay.rgb,radiance,uM16NativeWeight);trans=mix(previewRay.a,trans,uM16NativeWeight);}
    #endif
   }else{
   float analyticSteps=clamp(floor(uAnalyticSteps+.5),64.0,96.0);
   float ds=(b-a)/analyticSteps;
  for(int i=0;i<96;i++){
   if(float(i)>=analyticSteps)break;
   vec4 m=medium(ro+rd*(a+(float(i)+.5)*ds));float tr=exp(-m.a*ds);
   float segment=m.a>.00001?(1.0-tr)/m.a:ds;
    radiance+=trans*m.rgb*segment;trans*=tr;if(trans<.008)break;
  }
  }
   // Premultiplied radiance, physical extinction; pure emission never darkens background.
   float alpha=clamp(1.0-trans,0.0,1.0);
  // No brightness-derived opacity.
  if(alpha<.00001&&dot(radiance,radiance)<1e-10)discard;
   gl_FragColor=vec4(radiance,alpha)*clamp(uLayerOpacity,0.0,1.0);
   #include <tonemapping_fragment>
   #include <colorspace_fragment>
 }
 `;
 function invalidate(reason){
  depth.valid=false;depth.reason=reason;
  materials.forEach(m=>{m.uniforms.uDepthEnabled.value=0;});
 }
 function releaseTarget(){
  if(depth.target){depth.target.dispose();depth.target=null;}
  depthUniforms.uOpaqueDepth.value=null;depth.width=0;depth.height=0;
 }
 function contextLost(){invalidate('context-lost');releaseTarget();}
 function contextRestored(){invalidate('context-restored-needs-prepass');releaseTarget();}
 function bindRenderer(renderer){
  if(depth.renderer===renderer)return;
  if(depth.canvas){depth.canvas.removeEventListener('webglcontextlost',contextLost);depth.canvas.removeEventListener('webglcontextrestored',contextRestored);}
  releaseTarget();depth.renderer=renderer;depth.canvas=renderer.domElement||null;
  if(depth.canvas){depth.canvas.addEventListener('webglcontextlost',contextLost);depth.canvas.addEventListener('webglcontextrestored',contextRestored);}
 }
 function info(){return {enabled:depth.valid,reason:depth.reason,width:depth.width,height:depth.height,generation:depth.generation};}
 function renderOpaqueDepth(renderer,scene,camera,width,height){
  if(depth.disposed)throw new Error('MainVolumes pool is disposed.');
  if(depth.busy)throw new Error('MainVolumes opaque depth prepass is not reentrant.');
  invalidate('depth-prepass-pending');
  if(!renderer||!scene||!camera)throw new TypeError('renderOpaqueDepth requires renderer, scene and camera.');
  bindRenderer(renderer);
  const gl=renderer.getContext();
  if(!renderer.capabilities.isWebGL2){invalidate('requires-webgl2-depth-texture');return info();}
  if(gl.isContextLost()){invalidate('context-lost');return info();}
  if(!Number.isFinite(width)||!Number.isFinite(height)||width<1||height<1){invalidate('invalid-size');return info();}
  const w=Math.floor(width),h=Math.floor(height),limit=renderer.capabilities.maxTextureSize;
  if(w>limit||h>limit){invalidate('size-exceeds-max-texture');return info();}
  if(!Number.isFinite(camera.far)||camera.far<=camera.near){invalidate('invalid-camera-range');return info();}
  if(!camera.isPerspectiveCamera){invalidate('requires-perspective-camera');return info();}
  if(scene.overrideMaterial){invalidate('scene-override-material-unsupported');return info();}
  const eligible=m=>m&&m.visible!==false&&!m.transparent&&m.depthWrite!==false;
  let hasOpaque=false,hasVolumes=false;
  scene.traverseVisible(o=>{if(o.material&&camera.layers.test(o.layers)){
   const list=Array.isArray(o.material)?o.material:[o.material];if(list.some(eligible))hasOpaque=true;
   if(list.some(m=>m&&m.visible!==false&&materials.has(m)))hasVolumes=true;
  }});
  if(!hasVolumes){invalidate('no-visible-volumes');return info();}
  if(!hasOpaque){
   camera.updateMatrixWorld();depthProjection.copy(camera.projectionMatrix);depthCameraWorld.copy(camera.matrixWorld);
   depthUniforms.uDepthHasTexture.value=0;depthUniforms.uDepthSize.value.set(w,h);
   depth.scene=scene;depth.camera=camera;depth.valid=true;depth.reason='no-opaque-occluders';return info();
  }
  // Exactly the same log mapping is required from ALL opaque depth-writing shaders.
  const logarithmic=!!renderer.capabilities.logarithmicDepthBuffer&&!!camera.isPerspectiveCamera;
  const target=renderer.getRenderTarget(),face=renderer.getActiveCubeFace(),mip=renderer.getActiveMipmapLevel();
  const viewport=renderer.getViewport(new T.Vector4()),scissor=renderer.getScissor(new T.Vector4()),scissorTest=renderer.getScissorTest();
  const currentViewport=renderer.getCurrentViewport?renderer.getCurrentViewport(new T.Vector4()):null;
  const currentScissor=gl.getParameter(gl.SCISSOR_BOX),currentScissorTest=gl.isEnabled(gl.SCISSOR_TEST);
  const depthWriteMask=gl.getParameter(gl.DEPTH_WRITEMASK);
  const autoClear=renderer.autoClear,xrEnabled=renderer.xr&&renderer.xr.enabled;
  const shadowAuto=renderer.shadowMap&&renderer.shadowMap.autoUpdate;
  const background=scene.background,override=scene.overrideMaterial;
  const changed=new Set();
  depth.busy=true;
  try{
   if(!depth.target||depth.width!==w||depth.height!==h){
    releaseTarget();
    const rt=new T.WebGLRenderTarget(w,h,{minFilter:T.NearestFilter,magFilter:T.NearestFilter,
     format:T.RGBAFormat,type:T.UnsignedByteType,depthBuffer:true,stencilBuffer:false,samples:0});
    rt.texture.generateMipmaps=false;rt.texture.colorSpace=T.NoColorSpace;
    rt.depthTexture=new T.DepthTexture(w,h,T.UnsignedIntType);
    rt.depthTexture.format=T.DepthFormat;rt.depthTexture.minFilter=T.NearestFilter;rt.depthTexture.magFilter=T.NearestFilter;
    rt.depthTexture.generateMipmaps=false;rt.depthTexture.compareFunction=null;
    depth.target=rt;depth.width=w;depth.height=h;depth.generation++;
   }
   // Do NOT override materials: preserves analytic sphere depth, alphaTest/discard,
   // displacement, skinning, morphs, instancing, custom vertex/fragment depth.
   // Suppress ineligible MATERIAL slots, never parent Object3D visibility: an
   // excluded transparent mesh may contain an eligible opaque child. Material
   // classification is stable even when shared across several meshes.
   scene.traverse(o=>{
    if(!o.material)return;
    const list=Array.isArray(o.material)?o.material:[o.material];
    list.forEach(m=>{if(m&&m.visible!==false&&!eligible(m)){changed.add(m);m.visible=false;}});
   });
   scene.background=null;scene.overrideMaterial=null;
   renderer.autoClear=false;if(renderer.xr)renderer.xr.enabled=false;
   if(renderer.shadowMap)renderer.shadowMap.autoUpdate=false;
   // RT viewport is physical pixels. setViewport() multiplies by the renderer
   // DPR in r160, so configure the target itself before binding it.
   depth.target.viewport.set(0,0,w,h);depth.target.scissor.set(0,0,w,h);depth.target.scissorTest=false;
   renderer.setRenderTarget(depth.target);renderer.setScissorTest(false);
   // setRenderTarget initializes attachments; reject an incomplete framebuffer.
   if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE){invalidate('incomplete-depth-framebuffer');return info();}
   // The preceding postprocess quad commonly leaves depthMask=false; GL clear
   // respects that mask. Force it on or old depth silently survives this frame.
   renderer.state.buffers.depth.setMask(true);
   renderer.clear(false,true,false);
   renderer.render(scene,camera);
   if(gl.isContextLost()){invalidate('context-lost');return info();}
   camera.updateMatrixWorld();
   depthProjection.copy(camera.projectionMatrix);depthCameraWorld.copy(camera.matrixWorld);
   depthUniforms.uOpaqueDepth.value=depth.target.depthTexture;depthUniforms.uDepthHasTexture.value=1;
   depthUniforms.uDepthSize.value.set(w,h);
   depthUniforms.uDepthProjectionInverse.value.copy(camera.projectionMatrix).invert();
   depthUniforms.uDepthCameraWorld.value.copy(camera.matrixWorld);
   depthUniforms.uDepthLog.value=logarithmic?1:0;
   depthUniforms.uDepthLogFar.value=Math.log2(camera.far+1);
   depth.scene=scene;depth.camera=camera;depth.valid=true;depth.reason='opaque-depth-ready';
  }catch(error){invalidate('depth-prepass-failed');throw error;}
  finally{
   changed.forEach(m=>{m.visible=true;});
   scene.background=background;scene.overrideMaterial=override;
   renderer.autoClear=autoClear;if(renderer.xr)renderer.xr.enabled=xrEnabled;
   if(renderer.shadowMap)renderer.shadowMap.autoUpdate=shadowAuto;
   renderer.setRenderTarget(target,face,mip);
   renderer.setViewport(viewport);renderer.setScissor(scissor);renderer.setScissorTest(scissorTest);
   // getViewport returns the default viewport, not an active render target's
   // current viewport. Restore its actual GL state as well (Three r160 API).
   if(currentViewport&&renderer.state&&renderer.state.viewport)renderer.state.viewport(currentViewport);
   if(renderer.state&&renderer.state.scissor)renderer.state.scissor(new T.Vector4(...currentScissor));
   if(renderer.state&&renderer.state.setScissorTest)renderer.state.setScissorTest(currentScissorTest);
   renderer.state.buffers.depth.setMask(depthWriteMask);
   depth.busy=false;
  }
  return info();
 }
 function create(type,seed,tint,config){
  if(depth.disposed)throw new Error('MainVolumes pool is disposed.');
  config=config||{};
  const assetType=config.cinematicType==null?type:config.cinematicType;
  const mat=new T.ShaderMaterial({uniforms:Object.assign({uInverse:{value:new T.Matrix4()},uType:{value:type},uSeed:{value:seed%997},uGain:{value:config.gain||1.8},uLayerOpacity:{value:1},uAnalyticSteps:{value:96},uAnalyticSupportCull:{value:0},uArms:{value:config.arms||2},uPitch:{value:config.pitch||6.5},uBar:{value:config.bar||0},uTint:{value:new T.Vector3(...(tint||[1,1,1]))},uDepthEnabled:{value:0},
     uCineEnabled:{value:0},uCineDensity:{value:fallback3D},uCineLight:{value:fallback3D},uCineDetail:{value:fallback3D},uCineOccupancy:{value:fallback3D},uCineShading:{value:fallback3D},
     uCineHasDetail:{value:0},uCineHasShading:{value:0},uCineFilteredShading:{value:0},uCineHasOccupancy:{value:0},uCineGrid:{value:32},uCineSize:{value:128},uCineSteps:{value:cine.steps},uCineStepFactor:{value:cine.voxelFactor},
     uCineSigmaMax:{value:12},uCineEmissionScale:{value:4},uCineEmissionSqrt:{value:0},uCineLightScale:{value:4},uCineLightPos:{value:new T.Vector3(0,.25,.1)},uCineAlbedo:{value:new T.Vector3(.55,.55,.55)}},depthUniforms),
   vertexShader:'#include <common>\n#include <logdepthbuf_pars_vertex>\nvarying vec3 vWorld;void main(){vec4 w=modelMatrix*vec4(position,1.0);vWorld=w.xyz;gl_Position=projectionMatrix*viewMatrix*w;\n#include <logdepthbuf_vertex>\n}',
   fragmentShader:fragment,side:T.BackSide,transparent:true,depthWrite:false,depthTest:false});
  mat.toneMapped=true;
   mat.blending=T.CustomBlending;mat.blendEquation=T.AddEquation;
   mat.blendSrc=T.OneFactor;mat.blendDst=T.OneMinusSrcAlphaFactor;
   mat.blendEquationAlpha=T.AddEquation;mat.blendSrcAlpha=T.OneFactor;mat.blendDstAlpha=T.OneMinusSrcAlphaFactor;
   materials.add(mat);mat.addEventListener('dispose',()=>materials.delete(mat));
  const mesh=new T.Mesh(geometry,mat);mesh.name='MainSceneVolume';mesh.frustumCulled=false;mesh.renderOrder=3;
  const m16=config.m16Lod===true && type===9 && assetType===9;
  let drawing=null;
  if(m16){
   Object.assign(mat.uniforms,{uM16NativeWeight:{value:1},uM16PreviewDensity:{value:fallback3D},uM16PreviewLight:{value:fallback3D}});
   mesh.onAfterRender=()=>{if(drawing)root.ORBIT_CINEMATIC_ASSETS?.m16Drawn?.(drawing);drawing=null;};
  }
  mesh.onBeforeRender=function(renderer,scene,camera){
   this.updateMatrixWorld(true);mat.uniforms.uInverse.value.copy(this.matrixWorld).invert();
   const asset=bindCinematic(mat,assetType);
   // Reject a stale prepass from another scene/camera or changed projection/view.
   mat.uniforms.uDepthEnabled.value=depth.valid&&!depth.busy&&renderer===depth.renderer&&scene===depth.scene&&camera===depth.camera
    &&depthProjection.equals(camera.projectionMatrix)&&depthCameraWorld.equals(camera.matrixWorld)?1:0;
   if(m16){
    const U=mat.uniforms;
    drawing=U.uDepthEnabled.value?asset:null;
    const h=drawing && root.ORBIT_CINEMATIC_ASSETS?.m16Draw?.(drawing,cine.quality);
    if(!!h!==('M16_HANDOFF' in mat.defines)){
     if(h)mat.defines.M16_HANDOFF=1;else delete mat.defines.M16_HANDOFF;
     mat.needsUpdate=true;
    }
    U.uM16NativeWeight.value=h?h.weight:asset?.lod==='preview'?0:1;
    U.uM16PreviewDensity.value=h?h.preview.density:fallback3D;
    U.uM16PreviewLight.value=h?h.preview.light:fallback3D;
   }
  };
  if(type<5.5&&typeof root.createGalaxyStructure==='function'){
   const structure=root.createGalaxyStructure(T,mesh,type,seed);mesh.userData.galaxyStructure=structure;
   if(structure){structure.userData.quality=()=>cine.quality;mat.addEventListener('dispose',()=>structure.userData.dispose());}
  }
  mesh.userData.truth='Fixed illustrative 3D density field, not observational depth reconstruction';return mesh;
 }
 function dispose(){
  if(depth.disposed)return;invalidate('disposed');depth.disposed=true;
  if(depth.canvas){depth.canvas.removeEventListener('webglcontextlost',contextLost);depth.canvas.removeEventListener('webglcontextrestored',contextRestored);}
  releaseTarget();geometry.dispose();fallback3D.dispose();materials.forEach(m=>m.dispose());
 }
 return {create,renderOpaqueDepth,configureCinematic,clearDepth:()=>invalidate('depth-cleared'),depthInfo:info,dispose};
};
})(typeof window!=='undefined'?window:globalThis);
