/* Gaia DR3 measured-source viewer. No generated stars or photo-derived depth.
 * Positions use inverse positive high-S/N parallaxes; uncertainties, uncorrected
 * zero point and selection boundaries remain exposed in the catalogue manifest.
 * Reference epoch J2016.0, not current-epoch proper-motion propagation.
 */
(function(root){'use strict';
 const PC=3.0856775814913673e16, STRIDE=48;
 function parse(buffer,manifest){
  if(!(buffer instanceof ArrayBuffer))throw new TypeError('Gaia binary ArrayBuffer required');
  if(buffer.byteLength<32||(buffer.byteLength-32)%STRIDE)throw new Error('Gaia truncated record');
  const v=new DataView(buffer),magic=String.fromCharCode(...new Uint8Array(buffer,0,8));
  const count=(buffer.byteLength-32)/STRIDE;
  if(magic!=='GAIA3D1\u0000'||v.getUint32(8,true)!==count||v.getUint32(12,true)!==STRIDE||v.getFloat64(16,true)!==2016)throw new Error('Gaia invalid header');
  if(!manifest||manifest.count!==count||manifest.recordBytes!==STRIDE)throw new Error('Gaia manifest/count mismatch');
  const rows=new Array(count),seen=new Set();
  for(let i=0;i<count;i++){
   const b=32+i*STRIDE,sourceId=((BigInt(v.getUint32(b+4,true))<<32n)|BigInt(v.getUint32(b,true))).toString();
   const ra=v.getFloat64(b+8,true),dec=v.getFloat64(b+16,true),parallax=v.getFloat32(b+24,true),error=v.getFloat32(b+28,true),g=v.getFloat32(b+32,true),bpRp=v.getFloat32(b+36,true),ruwe=v.getFloat32(b+40,true),snr=v.getFloat32(b+44,true);
   if(seen.has(sourceId)||![ra,dec,parallax,error,g,bpRp,ruwe,snr].every(Number.isFinite)||g>10.00001||ra<0||ra>=360||dec< -90||dec>90||parallax<=0||error<=0||snr<9.99||ruwe>=1.4)throw new Error('Invalid Gaia measurement '+i);
   seen.add(sourceId);
   const distancePc=1000/parallax,sigmaPc=1000*error/(parallax*parallax),a=ra*Math.PI/180,d=dec*Math.PI/180,c=Math.cos(d);
   rows[i]={sourceId,ra,dec,parallax,error,g,bpRp,ruwe,snr,distancePc,sigmaPc,equatorial:[distancePc*c*Math.cos(a),distancePc*Math.sin(d),distancePc*c*Math.sin(a)]};
  }
  return {rows,count,manifest};
 }
 // Approximate display color from measured BP-RP; not calibrated RGB spectroscopy.
 function color(bpRp){
  if(!Number.isFinite(bpRp))return [1,1,1];
  const k=Math.max(0,Math.min(1,(bpRp+.4)/3.4));
  return [Math.min(1,.57+1.1*k),Math.max(.34,.72+.32*Math.sin(k*Math.PI)-.43*k),Math.max(.16,1-1.04*k)];
 }
 function create(T,catalog,transform){
  const n=catalog.count,positions=new Float32Array(n*3),colors=new Float32Array(n*3),absolute=new Float32Array(n),distance=new Float32Array(n);
  for(let i=0;i<n;i++){
   const r=catalog.rows[i],p=transform(r.equatorial),c=color(r.bpRp);
   positions.set(p,i*3);colors.set(c,i*3);
   absolute[i]=r.g-5*Math.log10(r.distancePc/10);distance[i]=r.distancePc;
  }
  const geometry=new T.BufferGeometry();
  geometry.setAttribute('position',new T.BufferAttribute(positions,3));geometry.setAttribute('color',new T.BufferAttribute(colors,3));
  geometry.setAttribute('aAbsG',new T.BufferAttribute(absolute,1));
  const material=new T.ShaderMaterial({
   uniforms:{uCameraPc:{value:new T.Vector3()},uPcPerUnit:{value:1},uPxPerRad:{value:600},uOpacity:{value:1},uDpr:{value:1},uDisplayGain:{value:6}}, 
   vertexShader:`attribute vec3 color;attribute float aAbsG;
    uniform vec3 uCameraPc;uniform float uPcPerUnit,uPxPerRad,uOpacity,uDpr,uDisplayGain;
    varying vec3 vColor;varying float vAlpha;
    void main(){
     vec3 relative=position-uCameraPc;
     float distancePc=max(length(relative),.00001);
     float apparentG=aAbsG+5.0*log(distancePc/10.0)/log(10.0);
     float flux=pow(10.0,clamp(-.4*(apparentG-4.0),-9.0,3.0));
     vec4 view=modelViewMatrix*vec4(relative*uPcPerUnit,1.0);
     gl_Position=projectionMatrix*view;
     float footprint=clamp(1.2+1.7*pow(flux,.22),1.15,7.0)*uDpr;
     gl_PointSize=footprint;
     vColor=color;
     vAlpha=uOpacity*uDisplayGain*min(flux*.55,2.0);
     if(view.z>=0.0) vAlpha=0.0;
    }`,
   fragmentShader:`varying vec3 vColor;varying float vAlpha;
    void main(){vec2 q=gl_PointCoord*2.0-1.0;float r=dot(q,q);if(r>1.0)discard;
     float core=exp(-r*5.5);gl_FragColor=vec4(vColor*core*vAlpha,0.0);}`,
   transparent:true,depthTest:false,depthWrite:false,toneMapped:false,
   blending:T.CustomBlending,blendSrc:T.OneFactor,blendDst:T.OneFactor,blendEquation:T.AddEquation});
  const object=new T.Points(geometry,material);object.frustumCulled=false;object.name='Gaia DR3 measured sources';object.renderOrder=-970;
  return {object,material,catalog,positions,update(cameraPc,unit,px,dpr,opacity){
   material.uniforms.uCameraPc.value.copy(cameraPc);material.uniforms.uPcPerUnit.value=PC/unit;
   material.uniforms.uPxPerRad.value=px;material.uniforms.uDpr.value=dpr;material.uniforms.uOpacity.value=opacity;
   object.visible=opacity>.00001;
  },pick(ndc,camera,unit,cameraPc,width,height){
   const p=new T.Vector3();let best=null,bestPixels=12;
   for(let i=0;i<n;i++){
    p.set(positions[i*3]-cameraPc.x,positions[i*3+1]-cameraPc.y,positions[i*3+2]-cameraPc.z).multiplyScalar(PC/unit);
    if(p.clone().applyMatrix4(camera.matrixWorldInverse).z>=0)continue;
    p.project(camera);if(p.z< -1||p.z>1)continue;
    const pixels=Math.hypot((p.x-ndc.x)*width*.5,(p.y-ndc.y)*height*.5);
    if(pixels<bestPixels){bestPixels=pixels;best=catalog.rows[i];}
   }return best;
  },nearestSource(sourceId){return catalog.rows.find(r=>r.sourceId===String(sourceId))||null;},dispose(){geometry.dispose();material.dispose();}};
 }
 root.ORBIT_GAIA=Object.freeze({PC,STRIDE,parse,color,create,
  truth:'Gaia DR3 measured angular positions, parallaxes and photometry; selected high-S/N subset, inverse-parallax distance estimate at epoch J2016.0. Not a complete Galaxy or a photographic 3D reconstruction.'});
})(typeof window!=='undefined'?window:globalThis);
