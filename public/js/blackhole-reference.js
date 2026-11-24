/* The unit of the panorama is the fitted radius of the inner luminous edge.
 * At 960x540 that edge passes approximately (277,0), (166,170), (130,300).
 * Plate coordinates are bottom-up. Outside the plate, only image-space
 * extrapolation is possible: this is a moving matte painting, not recovered 3D. */
window.OrbitBlackHolePlate = (() => {
  const fragment = `
    precision highp float;
    varying vec2 vPlateUv;
    uniform sampler2D plate;
    uniform float aspect, ready, az, tilt, zoom;
    const vec2 center=vec2(674.55,159.19), size=vec2(960.,540.);
    const float radius=550.51;
    vec3 samplePx(vec2 pixel){return texture2D(plate,clamp(pixel,vec2(.5),size-.5)/size).rgb;}
    // Overlap irregularly offset cloud patches in unfilmed areas. No mirrored
    // repeats: otherwise bright wisps form conspicuous butterfly shapes.
    float hash(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453);}
    vec3 extendCloud(vec2 p){
      vec2 g=p/vec2(265.,130.), id=floor(g), f=fract(g), w=f*f*(3.-2.*f);
      vec3 c=vec3(0.);
      for(int j=0;j<2;j++) for(int i=0;i<2;i++){
        vec2 o=vec2(float(i),float(j)), k=id+o, d=f-o;
        vec2 anchor=vec2(236.+hash(k+1.2)*485.,108.+hash(k+6.3)*70.);
        vec2 v=anchor+vec2(d.x*195.+d.y*(hash(k+9.1)-.5)*49.,d.y*69.+d.x*(hash(k+4.4)-.5)*31.);
        vec2 a=mix(1.-w,w,o);
        c+=samplePx(v)*a.x*a.y;
      }
      return c;
    }
    void main(){
      if(ready<.5){gl_FragColor=vec4(0.,0.,0.,1.);return;}
      float halfW=max(3.86,aspect*1.62);
      vec2 p=(vPlateUv-.5)*vec2(2.*halfW,2.*halfW/aspect)/zoom;
      float turn=sin(az), elev=tilt-.205;
      float breadth=clamp(1.+1.75*elev,.54,1.90);
      vec2 q=vec2(p.x,p.y/breadth);
      vec2 raw=center+radius*q;
      float r=length(vec2(p.x,p.y/(1.+.17*elev)));
      // Take a radial colour profile ABOVE the filmed horizon. Never introduce
      // a second synthetic white line: colour, aura and inner edge travel together.
      float theta=atan(p.y,p.x);
      float angle=.54+.10*cos(theta+az)+.035*sin(2.*theta-az);
      vec2 dir=vec2(-cos(angle),sin(angle));
      vec2 lensPx=center+dir*radius*r;
      float inner=1.-smoothstep(.88,1.02,r);
      vec3 lens=samplePx(lensPx);
      lens*= (1.-smoothstep(1.16,1.56,r))*(.57+.43*(.5-.5*cos(theta+az)));
      lens=mix(lens,vec3(.026,.021,.020),inner*(1.-smoothstep(.35,.93,r)));
      // Reuse the moving cloud *silhouette* as well as its RGB. Fold outside
      // the filmed range with bounded slopes; the central field remains unwarped.
      float sx=raw.x+turn*220.;
      float outside=max(0.,max(-sx,sx-960.));
      sx+=smoothstep(0.,300.,outside)*(55.*sin(raw.y*.010+sx*.004)+30.*sin(raw.y*.021-sx*.008));
      sx=960.-abs(mod(sx,1920.)-960.);
      // Horizon in source frame is near y=230 at left, y=301 at right.
      float horizon=228.+.073*raw.x;
      float below=(horizon-raw.y)/radius;
      float hsrc=228.+.073*sx;
      float sy=hsrc-below*radius;
      float lower=smoothstep(0.,185.,-sy);
      float cx=sx+lower*(89.*sin(sx*.007-sy*.006)+37.*cos(sx*.012+sy*.009));
      float cy=sy<0.?175.-abs(mod(-sy*.78,350.)-175.):sy;
      vec3 cloud=samplePx(vec2(960.-abs(mod(cx,1920.)-960.),cy));
      float extrap=max(smoothstep(0.,145.,outside),smoothstep(0.,105.,-sy));
      cloud=mix(cloud,extendCloud(vec2(raw.x+turn*220.,sy)),extrap);
      float edgeDepth=length(vec2(p.x/3.67,(below-.10)/1.10));
      float envelope=1.-smoothstep(.76,1.02,edgeDepth);
      float rimIrregular=.017*(samplePx(vec2(sx,210.)).r-.35);
      float front=smoothstep(-.045,.050,below+rimIrregular)*envelope;
      // Continue clouds behind the bright junction as a shallow far-side sheet;
      // do not put an equally bright lower arc in front of the opaque near disk.
      float wing=smoothstep(1.04,1.34,abs(p.x));
      float farH=.26*sqrt(max(0.,1.-p.x*p.x/13.5));
      float far=wing*(1.-smoothstep(.01,farH+.03,-below))*envelope;
      vec3 back=samplePx(vec2(sx,clamp(hsrc-31.-abs(below)*280.,8.,240.)))*.70;
      lens*=mix(.085,1.,smoothstep(-.72,.06,p.y));
      vec3 col=mix(lens,back,far);
      col=mix(col,cloud*(1.-.27*smoothstep(1.15,3.62,abs(p.x))),front);
      // Preserve the filmed arc/horizon intersection with identity sampling in
      // its measured coordinates (not a scaled picture at the screen centre).
      vec2 uv=raw/size;
      vec2 e=min(uv,1.-uv);
      float trusted=smoothstep(0.,.13,e.x)*smoothstep(0.,.14,e.y);
      float pose=1.-smoothstep(.015,.63,abs(elev)+abs(sin(az*.5))*.65);
      col=mix(col,samplePx(raw),trusted*pose);
      gl_FragColor=vec4(clamp(col,0.,1.),1.);
    }`;
  function create(THREE,url,onState){
    const video=document.createElement('video');video.muted=true;video.defaultMuted=true;video.loop=true;video.playsInline=true;
    video.preload='metadata';if(url) video.src=url;
    const tex=new THREE.VideoTexture(video);tex.minFilter=tex.magFilter=THREE.LinearFilter;
    const uniforms={plate:{value:tex},aspect:{value:1},ready:{value:0},az:{value:0},tilt:{value:.205},zoom:{value:1}};
    const mat=new THREE.ShaderMaterial({uniforms,vertexShader:'varying vec2 vPlateUv;void main(){vPlateUv=position.xy*.5+.5;gl_Position=vec4(position.xy,0.,1.);}',fragmentShader:fragment,depthTest:false,depthWrite:false,toneMapped:false});
    const scene=new THREE.Scene(),cam=new THREE.OrthographicCamera(-1,1,1,-1,0,1),mesh=new THREE.Mesh(new THREE.PlaneGeometry(2,2),mat);mesh.frustumCulled=false;scene.add(mesh);
    const refresh=()=>onState(video.error?'error':video.readyState>=2?(video.paused?'paused':'playing'):'loading');
    for(const e of ['loadeddata','playing','pause','error'])video.addEventListener(e,refresh);
    return {video,play(){if(video.src) video.play().then(refresh,refresh);},pause(){video.pause();},draw(renderer,state){
      uniforms.ready.value=video.readyState>=2?1:0;uniforms.aspect.value=renderer.domElement.width/Math.max(1,renderer.domElement.height);
      uniforms.az.value=state.az;uniforms.tilt.value=state.inc;uniforms.zoom.value=35/state.dist;
      renderer.setRenderTarget(null);renderer.render(scene,cam);
    }};
  }
  return {create};
})();
