/* Photograph-constrained SINGLE object-space 3D emissivity.
 * The image supplies colour/structure; disk + bulge depth is an explicit prior,
 * NOT measured depth. No camera-facing planes, repeated shells or source moves.
 * The caller owns the borrowed photograph texture and its world orientation.
 */
(function(root){'use strict';
 const TRUTH='Photograph-constrained fixed 3D emissivity with inferred disk/bulge depth; not measured volumetric reconstruction';
 const DEFAULTS=Object.freeze({thickness:.045,bulge:.20,bulgeRadius:.19,diskRadius:.50,photoScale:1,aspect:1,sourceDistance:2.3,steps:96,gain:1,opacity:1});
 const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
 function vector(value,fallback){if(value==null)return fallback.slice();const p=Array.isArray(value)?value:[value.x,value.y,value.z];if(p.length!==3||!p.every(Number.isFinite))throw new TypeError('Finite image basis vectors required');return p.slice();}
 function dot(a,b){return a[0]*b[0]+a[1]*b[1]+a[2]*b[2];}
 function normalize(a){const n=Math.hypot(...a);if(n<1e-9)throw new RangeError('Nonzero image basis required');return a.map(x=>x/n);}
 function cross(a,b){return [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];}
 function basis(options){options=options||{};const i=Number.isFinite(options.inclination)?options.inclination:0,pa=Number.isFinite(options.positionAngle)?options.positionAngle:0;
  // Angles in radians. Default photo horizontal is local X. Face-on photo
  // vertical is -Z, so cross(imageU,imageV) points towards source observer +Y.
  const ca=Math.cos(pa),sa=Math.sin(pa),ci=Math.cos(i),si=Math.sin(i),u=[ca,0,sa],v=[sa*ci,si,-ca*ci];
  const imageU=normalize(vector(options.imageU,u)),imageV=normalize(vector(options.imageV,v));if(Math.abs(dot(imageU,imageV))>1e-5)throw new RangeError('Image basis must be orthogonal');const viewDirection=normalize(vector(options.viewDirection,cross(imageU,imageV)));
  if(Math.abs(dot(imageU,imageV))>1e-5||Math.abs(dot(imageU,viewDirection))>1e-5||Math.abs(dot(imageV,viewDirection))>1e-5)throw new RangeError('Image basis must be orthogonal');
  return Object.freeze({imageU:Object.freeze(imageU),imageV:Object.freeze(imageV),viewDirection:Object.freeze(viewDirection)});
 }
 function parameters(options){options=options||{};const out={};for(const [k,v]of Object.entries(DEFAULTS)){out[k]=options[k]==null?v:Number(options[k]);if(!Number.isFinite(out[k]))throw new TypeError('Finite '+k+' required');}
  out.thickness=clamp(out.thickness,.025,.38);out.bulge=clamp(out.bulge,0,1);out.bulgeRadius=clamp(out.bulgeRadius,.08,.55);out.diskRadius=clamp(out.diskRadius,.25,.72);out.photoScale=clamp(out.photoScale,.4,3);out.aspect=clamp(out.aspect,.2,5);out.sourceDistance=clamp(out.sourceDistance,1.8,1e12);out.steps=clamp(Math.round(out.steps),48,160);out.gain=Math.max(0,out.gain);out.opacity=clamp(out.opacity,0,1);
  if(options.elliptical){out.thickness=out.diskRadius;out.bulge=Math.max(.35,out.bulge);}
  return Object.freeze(out);
 }
 function gaussian(p,s){return Math.exp(-p.reduce((n,x,k)=>n+x*x/(s[k]*s[k]),0));}
 function gaussianColumn(p,w,s){let a=0,b=0,c=0;for(let k=0;k<3;k++){const q=1/(s[k]*s[k]);a+=w[k]*w[k]*q;b+=p[k]*w[k]*q;c+=p[k]*p[k]*q;}return Math.sqrt(Math.PI/a)*Math.exp(-Math.max(0,c-b*b/a));}
 function density(p,options){const o=parameters(options),disk=[o.diskRadius,o.thickness,o.diskRadius],bulge=[o.bulgeRadius,o.bulgeRadius,o.bulgeRadius];return (1-o.bulge)*gaussian(p,disk)+o.bulge*gaussian(p,bulge);}
 function column(p,view,options){const o=parameters(options),w=normalize(vector(view,[0,1,0])),disk=[o.diskRadius,o.thickness,o.diskRadius],bulge=[o.bulgeRadius,o.bulgeRadius,o.bulgeRadius];return (1-o.bulge)*gaussianColumn(p,w,disk)+o.bulge*gaussianColumn(p,w,bulge);}
 function project(p,options){const o=parameters(options),b=basis(options),perspective=Math.max(.05,1-dot(p,b.viewDirection)/o.sourceDistance);return [.5+.5*o.photoScale*dot(p,b.imageU)/perspective,.5+.5*o.photoScale*o.aspect*dot(p,b.imageV)/perspective];}
 const vertexShader=`varying vec3 vLocal;void main(){vLocal=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`;
 const fragmentShader=`precision highp float;
 uniform sampler2D uMap;uniform vec3 uCamera,uImageU,uImageV,uSourceView;uniform float uThickness,uBulge,uBulgeRadius,uDiskRadius,uPhotoScale,uAspect,uSourceDistance,uGain,uOpacity,uReady,uSteps;
 varying vec3 vLocal;
 float gaussian(vec3 p,vec3 s){vec3 q=p/s;return exp(-dot(q,q));}
 float gaussianColumn(vec3 p,vec3 w,vec3 s){vec3 q=1.0/(s*s);float a=dot(w*w,q),b=dot(p*w,q),c=dot(p*p,q);return sqrt(3.14159265359/a)*exp(-max(0.0,c-b*b/a));}
 float prior(vec3 p){return mix(gaussian(p,vec3(uDiskRadius,uThickness,uDiskRadius)),gaussian(p,vec3(uBulgeRadius)),uBulge);}
 float sourceColumn(vec3 p){return mix(gaussianColumn(p,uSourceView,vec3(uDiskRadius,uThickness,uDiskRadius)),gaussianColumn(p,uSourceView,vec3(uBulgeRadius)),uBulge);}
 void main(){if(uReady<.5||uOpacity<=0.0||uGain<=0.0)discard;vec3 direction=normalize(vLocal-uCamera);vec3 safe=sign(direction)*max(abs(direction),vec3(1e-7));safe+=vec3(lessThan(abs(safe),vec3(1e-8)))*1e-7;vec3 t0=(-vec3(1.0)-uCamera)/safe,t1=(vec3(1.0)-uCamera)/safe;vec3 lo=min(t0,t1),hi=max(t0,t1);float nearT=max(0.0,max(lo.x,max(lo.y,lo.z))),farT=min(hi.x,min(hi.y,hi.z));if(farT<=nearT)discard;float stepLength=(farT-nearT)/uSteps;vec3 emission=vec3(0.0);
 for(int k=0;k<160;k++){if(float(k)>=uSteps)break;vec3 p=uCamera+direction*(nearT+(float(k)+.5)*stepLength);float d=prior(p);if(d<.000015)continue;float perspective=max(.05,1.0-dot(p,uSourceView)/uSourceDistance);vec2 uv=.5+.5*uPhotoScale*vec2(dot(p,uImageU),dot(p,uImageV)*uAspect)/perspective;if(any(lessThan(uv,vec2(0.0)))||any(greaterThan(uv,vec2(1.0))))continue;vec4 photo=texture2D(uMap,uv);float light=dot(photo.rgb,vec3(.2126,.7152,.0722));float imageMask=smoothstep(.0015,.008,light)*photo.a;float edge=1.0-smoothstep(.90,1.0,length((uv-.5)*2.0));float norm=max(sourceColumn(p),.0001);emission+=photo.rgb*(d/norm)*stepLength*imageMask*edge;}
 gl_FragColor=vec4(emission*uGain*uOpacity,0.0);
 }`;
 function create(T,options){options=options||{};if(!T||!T.ShaderMaterial)throw new TypeError('Three.js required');const p=parameters(options),b=basis(options),geometry=new T.BoxGeometry(2,2,2),uniforms={uMap:{value:options.texture||null},uCamera:{value:new T.Vector3()},uImageU:{value:new T.Vector3(...b.imageU)},uImageV:{value:new T.Vector3(...b.imageV)},uSourceView:{value:new T.Vector3(...b.viewDirection)},uThickness:{value:p.thickness},uBulge:{value:p.bulge},uBulgeRadius:{value:p.bulgeRadius},uDiskRadius:{value:p.diskRadius},uPhotoScale:{value:p.photoScale},uAspect:{value:p.aspect},uSourceDistance:{value:p.sourceDistance},uGain:{value:p.gain},uOpacity:{value:p.opacity},uReady:{value:options.ready===false?0:options.texture?1:0},uSteps:{value:p.steps}};
 // Alias lets the existing named-galaxy LOD controller own this ONE layer.
 uniforms.uLayerOpacity=uniforms.uOpacity;
 const material=new T.ShaderMaterial({vertexShader,fragmentShader,uniforms,side:T.BackSide,transparent:true,depthTest:false,depthWrite:false,toneMapped:false,blending:T.CustomBlending,blendEquation:T.AddEquation,blendSrc:T.OneFactor,blendDst:T.OneFactor,blendSrcAlpha:T.ZeroFactor,blendDstAlpha:T.OneFactor});
 const mesh=new T.Mesh(geometry,material);mesh.name='Photograph-constrained inferred galaxy volume';mesh.frustumCulled=false;mesh.renderOrder=-970;mesh.userData.truth=TRUTH;const inverse=new T.Matrix4(),cameraPosition=new T.Vector3();let disposed=false;
 mesh.onBeforeRender=function(renderer,scene,camera){camera.getWorldPosition(cameraPosition);inverse.copy(mesh.matrixWorld).invert();uniforms.uCamera.value.copy(cameraPosition).applyMatrix4(inverse);};
 const api={mesh,object:mesh,material,uniforms,setTexture(texture,ready){if(disposed)throw new Error('Observed galaxy volume disposed');uniforms.uMap.value=texture||null;uniforms.uReady.value=texture&&ready!==false?1:0;return api;},setBasis(value){if(disposed)throw new Error('Observed galaxy volume disposed');const v=basis(value);uniforms.uImageU.value.fromArray(v.imageU);uniforms.uImageV.value.fromArray(v.imageV);uniforms.uSourceView.value.fromArray(v.viewDirection);return api;},setQuality(quality){uniforms.uSteps.value=quality==='low'?96:quality==='ultra'?144:112;return api;},info(){return {truth:TRUTH,singleVolume:true,planes:false,cameraFacing:false,measuredDepth:false,photographConstrained:true,inferredDepth:true,borrowedTexture:true,ready:uniforms.uReady.value>.5,steps:uniforms.uSteps.value,thickness:uniforms.uThickness.value,sourceDistance:uniforms.uSourceDistance.value,columnNormalization:'analytic parallel-column approximation; perspective UV calibrated at source distance',bulge:uniforms.uBulge.value,imageU:uniforms.uImageU.value.toArray(),imageV:uniforms.uImageV.value.toArray(),viewDirection:uniforms.uSourceView.value.toArray(),disposed};},dispose(){if(disposed)return;disposed=true;geometry.dispose();material.dispose();mesh.onBeforeRender=function(){};mesh.removeFromParent();}};return api;
 }
 root.ORBIT_OBSERVED_GALAXY_VOLUME=Object.freeze({create,basis,parameters,density,column,project,vertexShader,fragmentShader,defaults:DEFAULTS,truth:TRUTH});
})(typeof window!=='undefined'?window:globalThis);
