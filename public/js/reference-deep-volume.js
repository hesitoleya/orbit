/* 单张照片约束颜色和投影；以下纵深、星距和光学厚度均为形态先验，不是测量结果。
 * create(THREE,{id,kind?,source?,photoKey?,radius?,steps?}) -> {object,ready,dispose}
 * +Z 为照片正面，+Y 向上，长边半径为 radius。ready 成功返回 object，失败拒绝。
 * source 为 URL/data URL 或已解码图像；photoKey 必须属于该天体。不要同时绘制原照片平面。
 */
(function (root) {
  'use strict';
  const presets = Object.freeze({ galaxy: 'galaxy', rose: 'rose', blue: 'blue', pillar: 'pillar', remnant: 'remnant' });
  const types = ['galaxy', 'rose', 'blue', 'pillar', 'remnant', 'cluster', 'nebula'];
  const depth = [.32, .8, .76, .72, .96, 1, .8];
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const jpeg = s => s.startsWith('data:') ? s : 'data:image/jpeg;base64,' + s;
  function resolveSource(o) {
    if (o.source) return o.source;
    const data = root.__ORBIT_INLINE__ || {}, key = o.photoKey;
    if (key) {
      if (root.OrbitPackedHD) return root.OrbitPackedHD.peek(key) || (data.photo?.[key] ? jpeg(data.photo[key]) : '');
      if (data.photoHD && data.photoHD[key]) return jpeg(data.photoHD[key]);
      if ((data.photoHDKeys || []).includes(key)) return 'data/photo-hd/' + encodeURIComponent(key) + '.jpg';
      if (data.photo && data.photo[key]) return jpeg(data.photo[key]);
      return 'data/photo/' + encodeURIComponent(key) + '.jpg';
    }
    if (!Object.hasOwn(presets, o.id)) throw new Error('非预设目标需要专属 source 或 photoKey：' + o.id);
    return data.jpgDepth && data.jpgDepth[o.id] ? jpeg(data.jpgDepth[o.id]) : 'data/jpg-depth/' + o.id + '.jpg';
  }
  function canvas(w, h) {
    const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
  }
  function randomAt(x, y, seed) {
    let n = Math.imul(x + 1, 73856093) ^ Math.imul(y + 1, 19349663) ^ seed;
    n = Math.imul(n ^ (n >>> 16), 0x7feb352d); n = Math.imul(n ^ (n >>> 15), 0x846ca68b);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  }
  // 只在有紧凑峰、环形背景和双向下降的位置分离 PSF。不把丝状物、星系核或均匀云气撒成星场。
  function separate(image, type, id) {
    const W = image.naturalWidth || image.width, H = image.naturalHeight || image.height;
    if (!(W > 0 && H > 0)) throw new Error('观测图未解码或尺寸无效');
    const s = Math.min(1, (type === 5 ? 1400 : 960) / Math.max(W,H));
    const w = Math.max(1,Math.round(W*s)), h = Math.max(1,Math.round(H*s));
    const sample = canvas(w,h), ctx = sample.getContext('2d', {willReadFrequently:true});
    ctx.drawImage(image,0,0,w,h);
    const rgba = ctx.getImageData(0,0,w,h).data, lum = new Uint8Array(w*h);
    for (let i=0; i<lum.length; ++i) lum[i] = (rgba[4*i]*54 + rgba[4*i+1]*183 + rgba[4*i+2]*19) >> 8;
    const peaks = [], ring = [-3*w,3*w,-3,3,-2*w-2,-2*w+2,2*w-2,2*w+2];
    for (let y=3; y<h-3; ++y) for (let x=3; x<w-3; ++x) {
      const i=y*w+x, v=lum[i];
      if (v<44 || v<=lum[i-1] || v<lum[i+1] || v<=lum[i-w] || v<lum[i+w] ||
          v<lum[i-w-1] || v<lum[i-w+1] || v<lum[i+w-1] || v<lum[i+w+1]) continue;
      // 一条明亮细丝在沿线方向不会快速下降；平台/饱和延展区域亦不作星点处理。
      const ridge = Math.max(lum[i-2],lum[i+2],lum[i-2*w],lum[i+2*w],
        lum[i-2*w-2],lum[i+2*w+2],lum[i-2*w+2],lum[i+2*w-2]);
      if (v-ridge < 15) continue;
      let r=0,g=0,b=0; for (const d of ring) {const j=4*(i+d); r+=rgba[j];g+=rgba[j+1];b+=rgba[j+2];}
      r/=8;g/=8;b/=8; const excess = v-(.2126*r+.7152*g+.0722*b);
      if (excess<Math.max(25,v*.20)) continue;
      peaks.push({x,y,i,r,g,b,excess});
    }
    peaks.sort((a,b)=>b.excess-a.excess);
    const cap = type===5 ? 14000 : 2400;
    if (peaks.length>cap) peaks.length=cap;
    // 原生分辨率保留在 GPU 色图中，仅对已接受的峰做局部背景修补。
    const output = peaks.length ? canvas(W,H) : image;
    const paint = peaks.length ? output.getContext('2d') : null;
    if (paint) { paint.drawImage(image,0,0,W,H); paint.scale(W/w,H/h); }
    const pos=new Float32Array(3*peaks.length), col=new Float32Array(pos.length), size=new Float32Array(peaks.length);
    let seed=37; for (const c of String(id)) seed=Math.imul(seed,31)+c.charCodeAt(0)|0;
    for (let k=0;k<peaks.length;k++) {
      const {x,y,i,r,g,b,excess}=peaks[k], u=(x+.5)/w*2-1, v=1-(y+.5)/h*2;
      const k1=randomAt(x,y,seed), k2=randomAt(x,y,seed^0x4137), k3=randomAt(x,y,seed^0x6011);
      // 星团条件 Plummer 分布：投影位置固定，中心深度更集中；其他类别允许前/背景恒星。
      const z=type===5 ? clamp((2*k1-1)*Math.sqrt(.06+u*u+v*v)/Math.sqrt(Math.max(.035,1-(2*k1-1)**2)), -.98,.98)
        : (type===0 && k2>.24 ? (k1+k3-1)*(.24+.42*Math.exp(-6*(u*u+v*v))) : 1.94*k1-.97);
      pos.set([u,v,z],k*3);
      for (let j=0;j<3;j++) {const a=rgba[4*i+j]/255, bg=[r,g,b][j]/255;
        col[3*k+j]=Math.max(0,(a<=.04045?a/12.92:((a+.055)/1.055)**2.4)-(bg<=.04045?bg/12.92:((bg+.055)/1.055)**2.4));}
      const rad=clamp(1.65+excess/190,1.65,3.0), cx=x+.5, cy=y+.5;
      size[k]=rad*4/Math.max(w,h);
      const grad=paint.createRadialGradient(cx,cy,rad*.40,cx,cy,rad);
      const rgb=`${Math.round(r)},${Math.round(g)},${Math.round(b)}`;
      grad.addColorStop(0,`rgba(${rgb},1)`);grad.addColorStop(1,`rgba(${rgb},0)`);
      paint.fillStyle=grad;paint.fillRect(cx-rad,cy-rad,2*rad,2*rad);
    }
    // 模糊局部背景提供暗带的对比基准，不能替代全分辨率照片。
    const bw=Math.max(1,Math.round(w/12)),bh=Math.max(1,Math.round(h/12)), broad=canvas(bw,bh);
    broad.getContext('2d').drawImage(output,0,0,bw,bh);
    return {W,H,output,broad,pos,col,size};
  }

  // 密度在真实三维坐标中求值；转动相机不转动密度场。z 是厚度归一化坐标。
  const field = `
  uniform sampler2D uPhoto,uBroad;
  uniform vec3 uHalf;
  uniform float uOpacity;
  float sq(float x){return x*x;}
  // blue: enlarge the physical volume, not the photo. Work in original photo half-widths.
  #if FORM == 2
  const vec2 blueSpan=vec2(2.22,1.52);
  vec2 photoXY(vec2 p){return p*blueSpan;}
  // Coordinates stay identical in the core. Beyond the plate, follow curved dust streams
  // into the low-frequency colour field; do not clamp a single edge texel into a streak.
  vec2 blueUV(vec2 q){
    vec2 d=max(abs(q)-.70,0.); vec2 k=d*d/(.14+d);
    vec2 bent=q-sign(q)*(k+.60*d*k);
    bent+=vec2(k.y*(.28*sin(4.6*q.x+1.8*q.y)-.17),k.x*(.24*sin(3.1*q.y-q.x)+.22));
    return clamp(.5+.5*bent,.016,.984);
  }
  float blueOutside(vec2 q){return smoothstep(.69,.998,max(abs(q.x),abs(q.y)));}
  // Offset, tilted lobes follow the blue left shoulder and the fainter upper-right dust.
  // Turbulence belongs to local space, so the silhouette doesn't rotate with the viewer.
  float cloudSkin(vec3 p){vec2 q=photoXY(p.xy);
    vec2 v=q+vec2(.13*sin(4.2*q.y+.85*p.z)+.054*sin(9.*q.y-2.8*q.x),
      .09*sin(3.4*q.x+2.1*q.y-.65*p.z)+.041*sin(8.*q.x+6.*q.y));
    float a=length(vec2((v.x+.14+.49*v.y)/1.59,(v.y-.03)/1.33));
    float b=length(vec2((v.x+.51-.94*v.y)/1.44,(v.y+.12)/.72));
    float r=min(a,b);return 1.-smoothstep(.59,1.,r);
  }
  vec3 blueBroad(vec3 p){vec2 q=photoXY(p.xy);float w=blueOutside(q);vec2 uv=blueUV(q);
    vec3 base=texture2D(uBroad,uv).rgb;
    float f=.5+.5*sin(8.*q.y+2.*q.x+2.7*sin(3.*q.x-1.3*q.y)+.85*p.z);
    return base*mix(1.,.40+.53*f,w);
  }
  #else
  vec2 photoXY(vec2 p){return p;}
  float cloudSkin(vec3 p){return 1.;}
  #endif
  float density(vec3 p){
    float r2=dot(p.xy,p.xy), z=p.z, a=0.;
    #if FORM == 0
      float disk=z-.15*p.y-.10*sin(3.4*p.x+2.*p.y);
      a=2.35*exp(-sq(disk/.23)-.72*r2)+1.4*exp(-9.*r2-2.8*z*z);
    #elif FORM == 4
      float r=length(p*vec3(1.04,.96,.90))+.055*sin(8.*p.y+3.*z)*sin(7.*p.x-2.*z);
      a=2.7*exp(-sq((r-.77)/.13))+.36*exp(-sq((r-.52)/.24));
    #elif FORM == 1
      float r=length(vec3(p.xy-.07*vec2(sin(4.*z),cos(3.*z)),z*.82));
      a=.30*exp(-1.8*r*r)+2.0*exp(-sq((r-.67)/.24))*(.78+.22*cos(9.*p.y+4.*z));
    #elif FORM == 3
      float spine=.39*sin(3.8*p.x+1.3*p.y)+.15*p.y;
      a=1.65*exp(-sq((z-spine)/.39))*(.70+.30*cos(8.*p.x-2.*p.y+3.*z))+.54*exp(-sq((z+.40)/.50));
    #elif FORM == 5
      a=2.5*pow(1.+5.*(r2+z*z),-2.5);
    #else
      float fold=.36*sin(3.2*p.x+1.7*p.y)-.18*cos(4.*p.y-p.x);
      a=1.55*exp(-sq((z-fold)/.45))+.80*exp(-sq((z+.47+.16*sin(5.*p.y))/.31));
      #if FORM == 2
        a*=.48+.9*exp(-2.4*dot(p-vec3(-.24,.12,.28),p-vec3(-.24,.12,.28)));
      #endif
    #endif
    vec3 edge=1.-smoothstep(vec3(.88,.88,.83),vec3(1.),abs(p));
    return a*edge.x*edge.y*edge.z*cloudSkin(p);
  }
  // 把观测到的细结构锚定到曲面薄层，宽体积只承载漫射光；不能把同一张纤丝沿 Z 无限挤出。
  float ridgeZ(vec2 p){
    #if FORM == 0
      return .15*p.y+.10*sin(3.4*p.x+2.*p.y);
    #elif FORM == 4
      return .73*sqrt(max(.016,1.-dot(p,p)*1.35))-.22+.09*sin(6.*p.y+3.*p.x);
    #elif FORM == 1
      return .18+.24*sin(3.1*p.x-1.6*p.y)*cos(3.3*p.y);
    #elif FORM == 3
      return .39*sin(3.8*p.x+1.3*p.y)+.15*p.y;
    #elif FORM == 5
      return .08*sin(4.*p.x+3.*p.y);
    #else
      return .36*sin(3.2*p.x+1.7*p.y)-.18*cos(4.*p.y-p.x);
    #endif
  }
  // 有限厚度核的解析线积分；即使单步跨过薄层也不丢失它，不生成离散的虚线。
  float layerMass(float q0,float q1){const float w=.032;float dq=q1-q0;
    if(abs(dq)<.001){float k=clamp((.5*(q0+q1)+w)/(2.*w),0.,1.);return 3.*k*(1.-k)/w;}
    return (smoothstep(-w,w,q1)-smoothstep(-w,w,q0))/dq;
  }
  float lightOf(vec3 col){return sqrt(max(0.,dot(col,vec3(.2126,.7152,.0722))));}
  // 源图比邻域暗的部分吸收更强、发光更弱。吸收与步长在同一局部长度单位下计算。
  vec2 optical(vec3 col,vec3 broad){float l=lightOf(col),b=lightOf(broad);
    float dust=max(b-l,0.)*5.2+.14*b;
    #if FORM == 5
      return vec2(.64*l,.015*b);
    #else
      return vec2(1.15*sqrt(l),dust);
    #endif
  }
  vec3 safeDir(vec3 d){return mix(vec3(-1.),vec3(1.),step(vec3(0.),d))*max(abs(d),vec3(1.e-7));}
  float toBoundary(vec3 p,vec3 d){vec3 q=(mix(vec3(-1.),vec3(1.),step(vec3(0.),d))-p)/safeDir(d);return min(q.x,min(q.y,q.z));}
  `;
  const volumeVert=`
  #include <common>
  #include <logdepthbuf_pars_vertex>
  varying vec3 vExit;
  void main(){vExit=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);
    #include <logdepthbuf_vertex>
  }`;
  const volumeFrag=`
  #include <common>
  #include <logdepthbuf_pars_fragment>
  varying vec3 vExit;
  uniform vec3 uEye,uForward,uViewZ;
  uniform vec2 uPixels;
  uniform float uOrtho,uNear,uSteps;
  ${field}
  vec3 nativeColor(vec2 uv,float lod){
    #if __VERSION__ >= 300
      return textureLod(uPhoto,uv,lod).rgb;
    #elif defined(GL_EXT_shader_texture_lod)
      return texture2DLodEXT(uPhoto,uv,lod).rgb;
    #else
      return texture2D(uPhoto,uv).rgb;
    #endif
  }
  void main(){
    vec3 dir=normalize(mix(normalize(vExit-uEye),uForward,uOrtho));
    // 以代理盒出口为原点以免远距离相减。dFdx/dFdy 在任何非一致分支之前计算。
    vec3 dx=dFdx(vExit),dy=dFdy(vExit),ddx=dFdx(dir),ddy=dFdy(dir);
    vec3 metric=dir*uHalf*uHalf/max(1.e-12,dot(dir*uHalf,dir*uHalf));
    dx-=dir*dot(dx,metric);dy-=dir*dot(dy,metric);
    ddx-=dir*dot(ddx,metric);ddy-=dir*dot(ddy,metric);
    float exitZ=dot(vExit-uEye,uViewZ), slope=max(1.e-12,dot(dir,uViewZ));
    float span=min(toBoundary(vExit,-dir), (exitZ-uNear)/slope);
    if(span<=.00001) discard;
    float steps=clamp(ceil(uSteps*min(1.,span*.55)),8.,uSteps);
    float dt=span/steps, ds=dt*length(dir*uHalf)/uHalf.z;
    float trans=1.;vec3 sum=vec3(0.);vec3 start=vExit-span*dir;
    float q0=start.z-ridgeZ(start.xy);
    for(int i=0;i<96;i++){
      if(float(i)>=steps || trans<.008) break;
      float t=span-(float(i)+.5)*dt; vec3 p=vExit-t*dir;
      vec3 next=p+(.5*dt)*dir;float q1=next.z-ridgeZ(next.xy),mass=layerMass(q0,q1);
      float shift=abs(q1-q0)>.001?clamp(-q0/(q1-q0),0.,1.)-.5:0.;q0=q1;
      float rho=density(p);vec3 edge=1.-smoothstep(vec3(.88,.88,.83),vec3(1.),abs(p));
      float detail=mass*edge.x*edge.y*edge.z*cloudSkin(p);
      if(rho<.001 && detail<.001) continue;
      vec2 uv=.5+.5*p.xy;
      // 同一距离处的相邻射线间距（原生 texel / 屏幕像素），不按相机距离猜 LOD。
      // 正交/斜视时把导数投到垂直于射线的平面，避免代理盒侧面导数放大。
      vec2 gx=photoXY(dx.xy-t*ddx.xy)*.5*uPixels,gy=photoXY(dy.xy-t*ddy.xy)*.5*uPixels;
      float lod=.5*log2(max(1.,max(dot(gx,gx),dot(gy,gy))));
      #if FORM == 2
      vec3 broad=blueBroad(p);
      #else
      vec3 broad=texture2D(uBroad,uv).rgb;
      #endif
      vec2 ambient=optical(broad,broad)*(.22*rho);
      vec3 emit=broad*ambient.x;float ext=ambient.x+ambient.y;
      if(detail>.001){
        #if FORM == 2
        vec3 hit=p+dt*shift*dir;vec2 q=photoXY(hit.xy);float w=blueOutside(q);
        vec3 col=mix(nativeColor(clamp(.5+.5*q,0.,1.),lod),blueBroad(hit),w);
        #else
        vec3 col=nativeColor(uv+.5*dt*shift*dir.xy,lod);
        #endif
        vec2 fine=optical(col,broad)*(2.25*detail);
        emit+=col*fine.x;ext+=fine.x+fine.y;}
      float alpha=1.-exp(-ext*uOpacity*ds);
      sum+=trans*alpha*emit*(1.35/max(.0001,ext));
      trans*=1.-alpha;
    }
    float opacity=1.-trans; if(opacity<.0008) discard;
    gl_FragColor=vec4(sum/opacity,opacity);
    #include <colorspace_fragment>
    #include <logdepthbuf_fragment>
  }`;
  const starVert=`
  #include <common>
  #include <logdepthbuf_pars_vertex>
  attribute vec3 starColor;attribute float diameter;
  uniform vec3 uEye,uForward;uniform float uOrtho,uPointScale,uPhotoLod;
  varying vec3 vColor;
  #if __VERSION__ >= 300
    #define STAR_LOD textureLod
  #else
    #define STAR_LOD texture2DLod
  #endif
  ${field}
  void main(){vec3 dir=normalize(mix(normalize(uEye-position),-uForward,uOrtho));
    float h=max(0.,toBoundary(position,dir));
    if(uOrtho<.5) h=min(h,length(uEye-position));
    float dt=h/8.,ds=length(dir*uHalf)*dt/uHalf.z,tau=0.;
    #if FORM != 5
    float q0=position.z-ridgeZ(position.xy);
    for(int i=0;i<8;i++){vec3 p=position+dir*((float(i)+.5)*dt);vec2 uv=.5+.5*p.xy;
      vec3 n=p+.5*dt*dir;float q1=n.z-ridgeZ(n.xy),mass=layerMass(q0,q1);q0=q1;
      vec3 edge=1.-smoothstep(vec3(.88,.88,.83),vec3(1.),abs(p));
      #if FORM == 2
      vec2 q=photoXY(p.xy);vec3 broad=blueBroad(p);vec3 st=mix(STAR_LOD(uPhoto,clamp(.5+.5*q,0.,1.),uPhotoLod).rgb,broad,blueOutside(q));
      #else
      vec3 broad=STAR_LOD(uBroad,uv,0.).rgb;vec3 st=STAR_LOD(uPhoto,uv,uPhotoLod).rgb;
      #endif
      vec2 c=.22*density(p)*optical(broad,broad);
      c+=2.25*mass*edge.x*edge.y*edge.z*cloudSkin(p)*optical(st,broad);
      tau+=(c.x+c.y)*ds;}
    #endif
    vColor=starColor*exp(-tau*uOpacity)*uOpacity;
    vec4 mv=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*mv;
    float ideal=diameter*uPointScale/max(.00001,gl_Position.w);
    gl_PointSize=clamp(ideal,1.25,48.);vColor*=min(1.,sq(ideal/gl_PointSize));
    #include <logdepthbuf_vertex>
  }`;
  const starFrag=`
  #include <common>
  #include <logdepthbuf_pars_fragment>
  varying vec3 vColor;
  void main(){vec2 p=2.*gl_PointCoord-1.;float r=dot(p,p);if(r>1.)discard;
    gl_FragColor=vec4(vColor*(exp(-3.6*r)-.0273),1.);
    #include <colorspace_fragment>
    #include <logdepthbuf_fragment>
  }`;

  function create(T, o={}) {
    const deferred=!o.source && o.photoKey && root.OrbitPackedHD;
    const id=o.id, source=deferred ? null : resolveSource(o), kind=Object.hasOwn(presets,id)?presets[id]:o.kind;
    const type=types.indexOf(kind), radius=o.radius===undefined?1:o.radius;
    if(type<0 || !(Number.isFinite(radius)&&radius>0)) throw new TypeError('需要有效的 kind 和正 radius');
    const object=new T.Group();object.name='参考观测体积:'+id;
    const owned=[], textures=[]; let disposed=false, pending=null, cancel=null;
    function dispose(){if(disposed)return;disposed=true;
      if(pending){pending.onload=pending.onerror=null;pending.removeAttribute('src');pending=null;}
      if(cancel)cancel();cancel=null;
      object.removeFromParent();object.clear();for(const item of owned)item.dispose();owned.length=0;
      for(const t of textures)t.image=null;textures.length=0;
    }
    function texture(image){const t=new T.Texture(image);owned.push(t);textures.push(t);
      t.colorSpace=T.SRGBColorSpace;t.minFilter=T.LinearMipmapLinearFilter;t.magFilter=T.LinearFilter;t.generateMipmaps=true;t.needsUpdate=true;return t;}
    async function load(){
      let image=source;
      const thumbnail=()=>{const b=root.__ORBIT_INLINE__?.photo?.[o.photoKey];return b ? jpeg(b) : '';};
      if(deferred){
        image=await deferred.read(o.photoKey,()=>!disposed) || thumbnail();
        if(disposed)throw new DOMException('观测体积已释放','AbortError');
        if(!image)throw Error('缺少内联观测图：'+id);
      }
      if(typeof image==='string')image=await new Promise((resolve,reject)=>{
        const pic=pending=new Image();cancel=()=>reject(new DOMException('观测体积已释放','AbortError'));
        pic.onload=()=>{pending=cancel=null;pic.onload=pic.onerror=null;resolve(pic);};
        pic.onerror=()=>{
          const small=deferred && !disposed && thumbnail();
          if(small && pic.src!==small){pic.src=small;return;}
          pending=cancel=null;pic.onload=pic.onerror=null;reject(new Error('无法加载观测图：'+id));
        };
        if(/^https?:/i.test(image))pic.crossOrigin='anonymous';pic.src=image;
      });
      if(disposed)throw new DOMException('观测体积已释放','AbortError');
      const pic=separate(image,type,id), max=Math.max(pic.W,pic.H), half=new T.Vector3(pic.W/max,pic.H/max,depth[type]*Math.min(pic.W,pic.H)/max);
      if(type===2){half.x*=2.22;half.y*=1.52;
        for(let i=0;i<pic.pos.length;i+=3){pic.pos[i]/=2.22;pic.pos[i+1]/=1.52;}}
      const photo=texture(pic.output), broad=texture(pic.broad);
      const uniforms={uPhoto:{value:photo},uBroad:{value:broad},uPixels:{value:new T.Vector2(pic.W,pic.H)},uHalf:{value:half},
        uOpacity:{value:1},uSteps:{value:clamp(Math.round(o.steps||48),12,96)},uEye:{value:new T.Vector3()},uForward:{value:new T.Vector3()},
        uViewZ:{value:new T.Vector3()},uNear:{value:0},uOrtho:{value:0},uPointScale:{value:0},uPhotoLod:{value:Math.max(0,Math.log2(max/256))}};
      const common={uniforms,defines:{FORM:type},transparent:true,depthWrite:false,toneMapped:false};
      const geo=new T.BoxGeometry(2,2,2), mat=new T.ShaderMaterial({...common,side:T.BackSide,vertexShader:volumeVert,fragmentShader:volumeFrag,extensions:{derivatives:true,shaderTextureLOD:true}});
      owned.push(geo,mat);const mesh=new T.Mesh(geo,mat);mesh.name='观测发光和消光体';
      const group=new T.Group();group.scale.copy(half).multiplyScalar(radius);object.add(group);group.add(mesh);
      const inv=new T.Matrix4(), mv=new T.Matrix4(), viewport=new T.Vector4();
      function cameraUniforms(renderer,scene,camera){
        mv.multiplyMatrices(camera.matrixWorldInverse,mesh.matrixWorld); inv.copy(mv).invert();
        uniforms.uEye.value.setFromMatrixPosition(inv);uniforms.uForward.value.set(0,0,-1).transformDirection(inv);
        const m=mv.elements;uniforms.uViewZ.value.set(-m[2],-m[6],-m[10]);uniforms.uNear.value=camera.near;
        uniforms.uOrtho.value=camera.isOrthographicCamera?1:0;renderer.getCurrentViewport(viewport);
        uniforms.uPointScale.value=viewport.w*.5*Math.abs(camera.projectionMatrix.elements[5])*Math.max(Math.hypot(m[0],m[1],m[2])/half.x,Math.hypot(m[4],m[5],m[6])/half.y);
      }
      mesh.onBeforeRender=cameraUniforms;
      if(pic.size.length){const g=new T.BufferGeometry();g.setAttribute('position',new T.BufferAttribute(pic.pos,3));
        g.setAttribute('starColor',new T.BufferAttribute(pic.col,3));g.setAttribute('diameter',new T.BufferAttribute(pic.size,1));
        const m=new T.ShaderMaterial({...common,vertexShader:starVert,fragmentShader:starFrag,blending:T.CustomBlending,blendSrc:T.OneFactor,blendDst:T.OneFactor,blendSrcAlpha:T.ZeroFactor,blendDstAlpha:T.OneFactor});
        const pts=new T.Points(g,m);owned.push(g,m);pts.name='观测峰值独立三维星点';pts.renderOrder=mesh.renderOrder+1;pts.onBeforeRender=cameraUniforms;group.add(pts);}
      object.userData.referenceDeepVolume={id,kind,sourceSize:[pic.W,pic.H],stars:pic.size.length,steps:uniforms.uSteps.value,inferredDepth:true};
      return object;
    }
    const ready=Promise.resolve().then(()=>{if(disposed)throw new DOMException('观测体积已释放','AbortError');return load();}).catch(e=>{dispose();throw e;});
    return {object,ready,dispose};
  }
  root.OrbitReferenceDeepVolume=Object.freeze({create,resolveSource});
})(typeof window!=='undefined'?window:globalThis);
