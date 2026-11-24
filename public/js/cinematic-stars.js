/* Embedded, depth-attenuated point sources. Original statistical artwork, not a star catalogue. */
(function(root){'use strict';
 root.createCinematicStars=function(T,parent,type){
  if(![6,9,11].includes(type))return null;
  let state=1697+type*7919;function random(){state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;}
  const points=[],colors=[],sizes=[];
  function add(x,y,z,power,color,size){points.push(x,y,z);colors.push(color[0]*power,color[1]*power,color[2]*power);sizes.push(size);}
  if(type===6){
   // Artistic compact cluster around the dominant baked ionizing source.
   add(-.12,.18,.13,2.4,[.60,.79,1],15);add(-.09,.225,.12,1.7,[.70,.84,1],10);add(-.17,.21,.15,1.2,[.80,.88,1],8);add(-.14,.16,.17,1.3,[.71,.84,1],9);
  }
  for(let i=0;i<(type===6?76:42);i++){
   const x=(random()-.5)*2.15,y=(random()-.5)*2.1,z=(random()-.5)*1.9;
   const bright=Math.pow(random(),5),warm=random()>.72;
   add(x,y,z,.025+bright*.43,warm?[1,.61,.31]:[.58,.75,1],1.7+bright*5.2);
  }
  const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(points,3));g.setAttribute('color',new T.Float32BufferAttribute(colors,3));g.setAttribute('aSize',new T.Float32BufferAttribute(sizes,1));
  const empty=new T.Data3DTexture(new Uint8Array(4),1,1,1);empty.format=T.RGBAFormat;empty.needsUpdate=true;
  const mat=new T.ShaderMaterial({uniforms:{uDensity:{value:empty},uReady:{value:0},uSigma:{value:12},uInverse:{value:new T.Matrix4()},uRatio:{value:1}},
   vertexShader:`#include <common>
    #include <logdepthbuf_pars_vertex>
    precision highp sampler3D;uniform sampler3D uDensity;uniform float uReady,uSigma,uRatio;uniform mat4 uInverse;attribute float aSize;attribute vec3 color;varying vec3 vLight;
    #ifdef M16_HANDOFF
    uniform sampler3D uM16PreviewDensity;uniform float uM16NativeWeight;
    #endif
    void main(){vec3 ro=(uInverse*vec4(cameraPosition,1.0)).xyz,rd=position-ro;float distance=length(rd);rd/=max(distance,.00001);
     vec3 safe=mix(vec3(-1),vec3(1),step(vec3(0),rd))*max(abs(rd),vec3(.000001));vec3 aa=(-vec3(1.3)-ro)/safe,bb=(vec3(1.3)-ro)/safe;vec3 n=min(aa,bb);float a=max(0.0,max(max(n.x,n.y),n.z));
     float tau=0.0,ds=max(0.0,distance-a)/32.0;
     #ifdef M16_HANDOFF
     float previewTau=0.0;
     #endif
     for(int i=0;i<32;i++){vec3 uv=clamp((ro+rd*(a+(float(i)+.5)*ds))/2.6+.5,0.0,1.0);if(uReady>.5)tau+=texture(uDensity,uv).a*uSigma*ds;
      #ifdef M16_HANDOFF
      previewTau+=texture(uM16PreviewDensity,uv).a*uSigma*ds;
      #endif
     }
     float visibility=exp(-tau);
     #ifdef M16_HANDOFF
     visibility=mix(exp(-previewTau),visibility,uM16NativeWeight);
     #endif
     vLight=color*visibility*uReady;vec4 p=modelViewMatrix*vec4(position,1);gl_Position=projectionMatrix*p;gl_PointSize=aSize*uRatio;
     #include <logdepthbuf_vertex>
    }`,
   fragmentShader:`#include <logdepthbuf_pars_fragment>
    precision highp float;varying vec3 vLight;void main(){
    #include <logdepthbuf_fragment>
    float r=length(gl_PointCoord-.5)*2.0;if(r>1.0)discard;float core=exp(-r*r*70.0);float halo=exp(-r*r*9.0)*.10;gl_FragColor=vec4(vLight*(core+halo),0.0);}`,transparent:true,depthTest:true,depthWrite:false,blending:T.CustomBlending,blendEquation:T.AddEquation,blendSrc:T.OneFactor,blendDst:T.OneFactor,toneMapped:false});
  const stars=new T.Points(g,mat);stars.frustumCulled=false;stars.renderOrder=4;stars.name='CinematicEmbeddedSources';
  const m16=!!parent.material?.uniforms?.uM16NativeWeight,U=mat.uniforms;
  if(m16)Object.assign(U,{uM16PreviewDensity:{value:empty},uM16NativeWeight:{value:1}});
  stars.onBeforeRender=function(renderer){
   const api=root.ORBIT_CINEMATIC_ASSETS,asset=api?.get(type);
   U.uReady.value=asset?1:0;U.uDensity.value=asset?asset.density:empty;U.uRatio.value=Math.min(2,renderer.getPixelRatio());
   if(asset){U.uSigma.value=asset.sigmaMax;U.uInverse.value.copy(this.matrixWorld).invert();}
   if(m16){
    // 不自行推进时间；只借当前仍归加载器持有的上一层，与父体积本帧权重一致。
    const h=parent.material.defines.M16_HANDOFF && api?.m16Current?.(asset);
    if(!!h!==('M16_HANDOFF' in mat.defines)){if(h)mat.defines.M16_HANDOFF=1;else delete mat.defines.M16_HANDOFF;mat.needsUpdate=true;}
    U.uM16PreviewDensity.value=h?h.preview.density:empty;U.uM16NativeWeight.value=h?h.weight:1;
   }
  };
  stars.userData.dispose=()=>{g.dispose();mat.dispose();empty.dispose();};parent.add(stars);return stars;
 };
})(window);
