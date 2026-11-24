/* Photo-constrained 3D Milky Way emissivity.
 * Source photograph: ESO/S. Brunier, eso0932a, CC BY 4.0.
 * ONE observed sky does not determine depth. This is a disk/bulge-prior
 * reconstruction of diffuse radiance, NOT tomography or measured star distances.
 * Its fixed object-space emission is constrained by the observed panorama seen
 * from the Sun; an external view integrates the SAME 3D field, not a sky shell.
 * Observed dark lanes become low emission, not recovered physical dust opacity.
 * Borrowed textures are owned/disposed by the caller.
 */
(function(root){'use strict';
 const MODEL=Object.freeze({radius:1.15,height:.5,radialTaper:.15,heightTaper:.15,
  diskFalloff:3.2,diskHeight:.018,diskFlare:.035,bulgeGain:1.4,bulgeX:.22,bulgeY:.12,
  bulgeFalloff:4,sunX:8.15*3.0856775814913673e19/5e20,normRange:16,normOffset:12});
 const smooth=x=>{x=Math.max(0,Math.min(1,x));return x*x*(3-2*x);};
 function prior(p){
  const r=Math.hypot(p[0],p[2]);
  const disk=Math.exp(-r*MODEL.diskFalloff)*Math.exp(-Math.abs(p[1])/(MODEL.diskHeight+MODEL.diskFlare*r));
  const bulge=MODEL.bulgeGain*Math.exp(-Math.hypot(p[0]/MODEL.bulgeX,p[1]/MODEL.bulgeY,p[2]/MODEL.bulgeX)*MODEL.bulgeFalloff);
  return (disk+bulge)*smooth((MODEL.radius-r)/MODEL.radialTaper)*smooth((MODEL.height-Math.abs(p[1]))/MODEL.heightTaper);
 }
 // p is an object-space position, not a camera ray. Galactic centre=-X,
 // Galactic north=+Y and positive longitude=-Z; coordinates are Sun-relative.
 function panoramaUV(p,sun=[MODEL.sunX,0,0]){
  const d=p.map((v,i)=>v-sun[i]),r=Math.hypot(...d);
  if(r<1e-12)return [.5,.5];
  const l=Math.atan2(-d[2],-d[0]),b=Math.asin(Math.max(-1,Math.min(1,d[1]/r)));
  return [.5-l/(2*Math.PI),.5+b/Math.PI];
 }
 const normDecode=red=>Math.pow(2,red*MODEL.normRange-MODEL.normOffset);
 const f=n=>Number(n).toFixed(12);
 const priorGLSL=`float photoPrior(vec3 p){
  float r=length(p.xz);
  float disk=exp(-r*${f(MODEL.diskFalloff)})*exp(-abs(p.y)/(${f(MODEL.diskHeight)}+${f(MODEL.diskFlare)}*r));
  float bulge=${f(MODEL.bulgeGain)}*exp(-length(p/vec3(${f(MODEL.bulgeX)},${f(MODEL.bulgeY)},${f(MODEL.bulgeX)}))*${f(MODEL.bulgeFalloff)});
  float edge=clamp((${f(MODEL.radius)}-r)/${f(MODEL.radialTaper)},0.0,1.0);edge=edge*edge*(3.0-2.0*edge);
  float height=clamp((${f(MODEL.height)}-abs(p.y))/${f(MODEL.heightTaper)},0.0,1.0);height=height*height*(3.0-2.0*height);
  return (disk+bulge)*edge*height;
 }`;
 const vertexShader=`out vec3 vLocal;
 void main(){vLocal=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`;
 const fragmentShader=`precision highp float;
 uniform sampler2D uConstraint,uNormalization;
 uniform vec3 uSun,uObserver;
 uniform float uGain,uOpacity,uSteps,uReady;
 in vec3 vLocal;
 out vec4 photoGalaxyColor;
 ${priorGLSL}
 vec2 photoUV(vec3 p){
  vec3 d=p-uSun;float r=max(length(d),0.0000001);
  float l=atan(-d.z,-d.x),b=asin(clamp(d.y/r,-1.0,1.0));
  return vec2(.5-l/6.283185307179586,.5+b/3.141592653589793);
 }
 // Intersect the compact cylindrical support, not just the proxy box. Rays
 // entering a thin galaxy face-on spend their samples in its actual height.
 vec2 support(vec3 ro,vec3 rd){
  float a=dot(rd.xz,rd.xz),b=dot(ro.xz,rd.xz),c=dot(ro.xz,ro.xz)-${f(MODEL.radius*MODEL.radius)};
  vec2 t=vec2(-1.0e20,1.0e20);
  if(a<0.00000001){if(c>0.0)return vec2(1.0,-1.0);}
  else{float disc=b*b-a*c;if(disc<0.0)return vec2(1.0,-1.0);float q=sqrt(max(0.0,disc));t=vec2((-b-q)/a,(-b+q)/a);}
  if(abs(rd.y)<0.00000001){if(abs(ro.y)>${f(MODEL.height)})return vec2(1.0,-1.0);}
  else{vec2 h=(vec2(-${f(MODEL.height)},${f(MODEL.height)})-ro.y)/rd.y;t=vec2(max(t.x,min(h.x,h.y)),min(t.y,max(h.x,h.y)));}
  t.x=max(0.0,t.x);return t;
 }
 void main(){
  if(uReady<.5||uOpacity<=0.0||uGain<=0.0)discard;
  vec3 ro=uObserver,delta=vLocal-ro;
  if(dot(delta,delta)<0.000000000001)discard;
  vec3 rd=normalize(delta);vec2 hit=support(ro,rd);
  if(hit.y<=hit.x)discard;
  int steps=int(clamp(uSteps,32.0,192.0));float dt=(hit.y-hit.x)/float(steps);
  vec3 radiance=vec3(0.0);
  for(int i=0;i<192;i++){
   if(i>=steps)break;
   vec3 p=ro+rd*(hit.x+(float(i)+.5)*dt);
   float density=photoPrior(p);
   if(density>0.00000001){
    vec2 uv=photoUV(p);
    // Explicit LOD avoids undefined derivative sampling inside a varying loop.
    // Color has already been low-pass filtered offline and uses sRGB hardware
    // decode. The R8 normalization has NoColorSpace and exp2 log encoding.
    vec3 observed=textureLod(uConstraint,uv,0.0).rgb;
    float integral=exp2(textureLod(uNormalization,uv,0.0).r*${f(MODEL.normRange)}-${f(MODEL.normOffset)});
    radiance+=observed*(density/max(integral,0.000244140625))*dt;
   }
  }
  // Optically thin, additive emissivity. Alpha zero preserves background alpha;
  // no invented extinction, shell surface shading, opaque wall or billboard.
  photoGalaxyColor=vec4(radiance*uGain*uOpacity,0.0);
 }`;
 root.ORBIT_PHOTO_GALAXY=Object.freeze({parameters:MODEL,prior,panoramaUV,normDecode,priorGLSL,
  truth:'Observed panorama constrains diffuse radiance; disk/bulge prior assigns unmeasured depth. Fixed optically thin emissivity, not tomography.'});
 root.createPhotoGalaxy=function(T,textures){
  if(!T||!T.ShaderMaterial||!T.Mesh)throw new TypeError('createPhotoGalaxy requires Three.js');
  textures=textures||{};
  const material=new T.ShaderMaterial({glslVersion:T.GLSL3,vertexShader,fragmentShader,
   uniforms:{uConstraint:{value:textures.color||null},uNormalization:{value:textures.normalization||null},
    uSun:{value:new T.Vector3(MODEL.sunX,0,0)},uObserver:{value:new T.Vector3()},
    uGain:{value:1},uOpacity:{value:1},uSteps:{value:96},uReady:{value:textures.color&&textures.normalization?1:0}},
   side:T.BackSide,transparent:true,depthTest:false,depthWrite:false,fog:false,toneMapped:false,
   blending:T.CustomBlending,blendEquation:T.AddEquation,blendSrc:T.OneFactor,blendDst:T.OneFactor,
   blendEquationAlpha:T.AddEquation,blendSrcAlpha:T.ZeroFactor,blendDstAlpha:T.OneFactor});
  const mesh=new T.Mesh(new T.BoxGeometry(2*MODEL.radius,2*MODEL.height,2*MODEL.radius),material);
  mesh.name='Photo-constrained 3D Milky Way';mesh.frustumCulled=false;mesh.renderOrder=-980;
  const inverse=new T.Matrix4(),observer=new T.Vector3();let autoObserver=true,disposed=false;
  mesh.onBeforeRender=function(renderer,scene,camera){
   if(autoObserver){inverse.copy(mesh.matrixWorld).invert();camera.getWorldPosition(observer);observer.applyMatrix4(inverse);material.uniforms.uObserver.value.copy(observer);}
  };
  mesh.userData.truth=root.ORBIT_PHOTO_GALAXY.truth;
  mesh.userData.update=function(options){
   if(disposed)throw new Error('Photo galaxy has been disposed');
   options=options||{};const u=material.uniforms;
   if(Object.prototype.hasOwnProperty.call(options,'color'))u.uConstraint.value=options.color;
   if(Object.prototype.hasOwnProperty.call(options,'normalization'))u.uNormalization.value=options.normalization;
   if(Object.prototype.hasOwnProperty.call(options,'autoObserver'))autoObserver=!!options.autoObserver;
   if(options.observer){const p=options.observer;if(Array.isArray(p))u.uObserver.value.set(p[0],p[1],p[2]);else u.uObserver.value.copy(p);}
   for(const [key,name,min,max] of [['gain','uGain',0,100],['opacity','uOpacity',0,1],['steps','uSteps',32,192]]){
    if(Object.prototype.hasOwnProperty.call(options,key)){
     if(!Number.isFinite(options[key]))throw new TypeError('Photo galaxy '+key+' must be finite');
     u[name].value=Math.max(min,Math.min(max,options[key]));
    }
   }
   u.uReady.value=options.ready===false?0:(u.uConstraint.value&&u.uNormalization.value?1:0);
   return mesh;
  };
  mesh.userData.dispose=function(){if(disposed)return;disposed=true;mesh.geometry.dispose();material.dispose();};
  return mesh;
 };
})(typeof window!=='undefined'?window:globalThis);
