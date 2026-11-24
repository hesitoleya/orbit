/* Original statistical 3D stellar populations; not a star catalogue or photo reconstruction.
 * Point positions share the parent analytic spiral parameters and fixed local XZ disk.
 * Dust attenuation integrates the actual analytic extinction law, not a random red mask. */
(function(root){'use strict';
 const MAX=12288,COUNTS={low:4096,high:8192,ultra:12288};
 function population(type,seed,arms,pitch,bar){
  let state=(seed>>>0)||1;const rnd=()=>((state=(Math.imul(state,1664525)+1013904223)>>>0)/4294967296),gauss=()=>rnd()+rnd()+rnd()+rnd()+rnd()+rnd()-3;
  const p=new Float32Array(MAX*3),c=new Float32Array(MAX*3),s=new Float32Array(MAX),clusters=[];
  // Correlated associations, not independent screen noise: compact 3D knots along shared arms.
  if(type<2)for(let j=0;j<32;j++){const r=.22+rnd()*.72,k=Math.floor(rnd()*Math.max(1,arms)),th=(Math.log(r)*pitch+Math.PI*2*k)/Math.max(1,arms);clusters.push([Math.cos(th)*r,gauss()*(.035+.065*r)*.2,Math.sin(th)*r]);}
  for(let i=0;i<MAX;i++){
   let x,y,z,r,th,warm=true,hii=false;const ell=type===2,bulge=ell||rnd()<(type===3?.38:.16),inbar=!ell&&!bulge&&bar>0&&rnd()<.13;
   if(bulge){r=(ell?.94:.28)*Math.pow(rnd(),.65);const u=rnd()*2-1,a=rnd()*Math.PI*2,q=Math.sqrt(1-u*u);x=q*Math.cos(a)*r;z=q*Math.sin(a)*r*(ell?1/.85:1);y=u*r/(ell?1.35:1.5);}
   else if(inbar){x=gauss()*.21;z=gauss()*.038;y=gauss()*.026;r=Math.hypot(x,z);}
   else{r=Math.max(.035,Math.min(1.13,-Math.log(Math.max(.01,1-rnd()*.974))*.27));th=rnd()*Math.PI*2;
    if(type<2&&rnd()<.81){const k=Math.floor(rnd()*Math.max(1,arms));th=(Math.log(Math.max(r,.035))*pitch+Math.PI*2*k)/Math.max(1,arms)+gauss()*.065;}
    x=Math.cos(th)*r;z=Math.sin(th)*r;y=gauss()*(.035+.065*r)*.53;warm=rnd()<.36;hii=type!==3&&rnd()<.035;
   }
   if(clusters.length&&!bulge&&rnd()<.16){const center=clusters[Math.floor(rnd()*clusters.length)],spread=.009+rnd()*.012;x=center[0]+gauss()*spread;z=center[2]+gauss()*spread;y=center[1]+gauss()*spread*.55;warm=false;hii=rnd()<.20;}
   const lum=(.025+Math.pow(rnd(),3)*.16)*(bulge?.48:1),rgb=hii?[1,.24,.32]:warm?[1,.76,.46]:[.51,.72,1];
   p.set([x,y,z],i*3);c.set(rgb.map(v=>v*lum),i*3);s[i]=1+Math.pow(rnd(),4)*1.8;
  }
  return {position:p,color:c,size:s};
 }
 root.createGalaxyStructure=function(T,parent,type,seed){
  if(type>=5.5||!parent.material||!parent.material.uniforms)return null;
  const U=parent.material.uniforms,read=(k,d)=>U[k]?U[k].value:d;
  const data=population(type,seed,read('uArms',2),read('uPitch',6.5),read('uBar',0));
  const geo=new T.BufferGeometry();geo.setAttribute('position',new T.BufferAttribute(data.position,3));geo.setAttribute('aColor',new T.BufferAttribute(data.color,3));geo.setAttribute('aSize',new T.BufferAttribute(data.size,1));geo.setDrawRange(0,8192);
  const uniforms={uInverse:{value:new T.Matrix4()},uEnable:{value:0},uPixelRatio:{value:1},uPopulation:{value:1}};
  ['uType','uSeed','uArms','uPitch','uBar','uGain','uTint'].forEach(k=>{uniforms[k]=U[k];});
  const material=new T.ShaderMaterial({uniforms,vertexShader:`#include <common>
   #include <logdepthbuf_pars_vertex>
   attribute vec3 aColor;attribute float aSize;uniform mat4 uInverse;uniform float uType,uSeed,uArms,uPitch,uBar,uGain,uEnable,uPixelRatio,uPopulation;uniform vec3 uTint;varying vec3 vLight;
   float hash(vec3 p){return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453);}
   float nv(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);}
   float fb(vec3 p){return .57*nv(p)+.28*nv(p*2.07)+.15*nv(p*4.17);}
   float extinction(vec3 p){float r=length(p.xz),h=abs(p.y),n=fb(p*8.0+uSeed);float disk=exp(-r*3.2)*exp(-h/(.035+.065*r));float phase=atan(p.z,p.x)*uArms-log(max(r,.035))*uPitch;float lane=pow(.5+.5*cos(phase+.50),12.0);
    if(uType>1.5&&uType<2.5)disk=0.0;if(uType>2.5&&uType<3.5){disk*=1.25;lane=exp(-pow((r-.48)/.17,2.0));}if(uType>3.5)disk*=.45+1.8*n;
    return disk*lane*(1.0+2.0*n)*3.2*(1.0-smoothstep(.88,1.18,length(p)));}
   void main(){vLight=vec3(0);if(uEnable<=0.0){gl_Position=vec4(2,2,2,1);gl_PointSize=1.0;return;}
    vec3 ro=(uInverse*vec4(cameraPosition,1)).xyz,delta=position-ro;float d=length(delta);vec3 rd=delta/max(d,.00001);vec3 safe=mix(vec3(-1),vec3(1),step(vec3(0),rd))*max(abs(rd),vec3(.000001));vec3 a=(-vec3(1.3)-ro)/safe,b=(vec3(1.3)-ro)/safe,n=min(a,b);float start=max(0.0,max(max(n.x,n.y),n.z));float ds=max(0.0,d-start)/24.0,tau=0.0;
    for(int i=0;i<24;i++)tau+=extinction(ro+rd*(start+(float(i)+.5)*ds))*ds;
    float size=clamp(aSize,1.0,3.0)*uPixelRatio;vLight=aColor*uTint*exp(-tau)*uEnable*min(uGain,2.5)*uPopulation/(size*size);vec4 mv=modelViewMatrix*vec4(position,1);gl_Position=projectionMatrix*mv;gl_PointSize=size;
    #include <logdepthbuf_vertex>
   }`,fragmentShader:`#include <logdepthbuf_pars_fragment>
   precision highp float;varying vec3 vLight;void main(){
    #include <logdepthbuf_fragment>
    float r=length(gl_PointCoord-.5)*2.0;if(r>1.0)discard;float aperture=exp(-r*r*5.0)*1.6;gl_FragColor=vec4(vLight*aperture,0.0);
   }`,transparent:true,depthTest:true,depthWrite:false,blending:T.CustomBlending,blendEquation:T.AddEquation,blendSrc:T.OneFactor,blendDst:T.OneFactor,toneMapped:false});
  const stars=new T.Points(geo,material);stars.name='GalaxyEmbeddedStructure';stars.frustumCulled=false;stars.renderOrder=4;
  const size=new T.Vector2(),scale=new T.Vector3(),center=new T.Vector3();let disposed=false;
  stars.onBeforeRender=function(renderer,scene,camera){
   if(disposed)return;const quality=typeof stars.userData.quality==='function'?stars.userData.quality():'high',count=COUNTS[quality]||COUNTS.high;geo.setDrawRange(0,count);uniforms.uPopulation.value=8192/count;
   renderer.getSize(size);stars.getWorldScale(scale);center.setFromMatrixPosition(stars.matrixWorld).applyMatrix4(camera.matrixWorldInverse);const diameter=2.3*Math.max(Math.abs(scale.x),Math.abs(scale.y),Math.abs(scale.z))*camera.projectionMatrix.elements[5]*size.y/(2*Math.max(.000001,-center.z));
   const fade=U.uCineEnabled&&U.uCineEnabled.value>.5?0:Math.min(1,Math.max(0,(diameter-60)/80));uniforms.uEnable.value=fade*fade*(3-2*fade);uniforms.uPixelRatio.value=Math.max(1,Math.min(2,renderer.getPixelRatio()));uniforms.uInverse.value.copy(stars.matrixWorld).invert();
  };
  stars.userData.dispose=()=>{if(disposed)return;disposed=true;geo.dispose();material.dispose();parent.remove(stars);};parent.add(stars);return stars;
 };
 // Read-only deterministic helper for CPU contracts; does not imply GPU/visual acceptance.
 root.createGalaxyStructure.population=population;
})(typeof window!=='undefined'?window:globalThis);
