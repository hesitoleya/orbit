/* deep-models.js — classic script, Three.js r160 / GLSL ES 1.00.
 * No imports, network requests, textures, DOM, render calls, or renderer mutations.
 * All coordinates, morphology, visual stellar radii and optical coefficients are
 * UNCALIBRATED. These are deterministic technical/artistic models, not reconstructions.
 * Shader outputs are linear HDR; the host owns HDR targets, bloom and output transforms.
 *
 * window.createDeepModels(THREE, renderer)
 *   -> { scene, camera, open(id), close(), update(), setView(view), info(),
 *        dispose(), setDust(on), setQuality('interactive'|'reference'|'reference512') }
 * Reference is an expensive higher-step diagnostic, not a converged ground truth.
 * IDs: '47tuc', 'm42', 'm51', 'm82', 'm81', 'm83', 'm104'. Construction/open are synchronous. Initially inactive.
 * update(): camera matrices and uniforms only; never renders/rebuilds geometry.
 * setView('front'|'side'|'back'|'near' | {yaw,pitch,distance,target:[x,y,z]}).
 * Angles are RADIANS. yaw=0,pitch=0 looks from +Z toward target. Pitch is clamped
 * just short of the poles; distance is clamped to [0.08,12]. Object updates are partial.
 * front/side/back reset target and distance=3.6; near keeps angles/target, distance=.35.
 * Mutators return an info snapshot (dispose returns nothing). update returns active.
 * close releases the current model; dispose is terminal and NEVER disposes renderer.
 * Dust controls line-of-sight absorption in both volumes AND their stellar populations.
 * 47 Tuc has no dust model. Call update() before host.renderFrame(scene,camera).
 */
(function (root) {
  'use strict';

  var TAU = Math.PI * 2;
  var SPECS = {
    '47tuc': {
      seed: 470104, type: 'statistical-plummer-star-cluster',
      box: [-1.28, -1.28, -1.28, 1.28, 1.28, 1.28],
      truth: '47 Tuc-inspired, truncated Plummer statistical population; NOT measured individual stars. Colors and PSF are illustrative; no calibrated photometry, distances, ages or stellar radii.'
    },
    m42: {
      seed: 420197, type: '3d-emission-absorption-nebula',
      box: [-1.3, -1.2, -1.05, 1.3, 1.2, 1.05],
      truth: 'M42 artistic morphology demonstration: asymmetric cavity, dark bay and filaments in a fixed 3D procedural field. NOT an observational 3D inversion. RGB emission and extinction are illustrative, not spectroscopy.'
    },
    m51: {
      seed: 510519, type: '3d-spiral-galaxy-emission-absorption',
      box: [-1.65, -1.4, -0.95, 1.65, 1.4, 0.95],
      truth: 'M51-inspired two-arm disk, bulge, companion and tidal bridge. Companion direction approximately constrained by the observed image; NOT a fitted reconstruction, measured stars or dynamics. Illustrative 20-degree tilt; depth and scale remain uncalibrated.'
    },
    m82: {
      seed: 820604, type: '3d-irregular-starburst-emission-absorption',
      box: [-1.34, -1.12, -1.16, 1.34, 1.12, 1.16],
      truth: 'M82-inspired irregular edge-on starburst: broken disk, central dust lane and a vertical superwind in a fixed 3D procedural field. Long axis, lane and wind direction follow the observed image only loosely; NOT an observational 3D inversion, measured stars or a calibrated outflow. Colours, scale and depth are illustrative.'
    },
    m81: {
      seed: 810327, type: '3d-grand-design-spiral-emission-absorption',
      box: [-1.55, -1.35, -1.05, 1.55, 1.35, 1.05],
      truth: 'M81-inspired grand-design two-arm spiral: tilted disk, compact bulge and dust lanes in a fixed 3D procedural field. No companion galaxy is modeled. NOT an observational 3D inversion; pitch angle, depth, colours and scale are illustrative.'
    },
    m83: {
      seed: 830614, type: '3d-barred-spiral-emission-absorption',
      box: [-1.55, -1.40, -1.05, 1.55, 1.40, 1.05],
      truth: 'M83-inspired barred spiral: open arms, a central bar and HII knots in a fixed 3D procedural field. NOT an observational 3D inversion or fitted rotation; depth, colours and scale are illustrative.'
    },
    m104: {
      seed: 104328, type: '3d-edge-on-lenticular-emission-absorption',
      box: [-1.42, -1.12, -0.92, 1.42, 1.12, 0.92],
      truth: 'M104-inspired edge-on system: extended thin disk, large bulge and a dark dust ring in a fixed 3D procedural field. NOT an observational 3D inversion; ring thickness, depth, colours and scale are illustrative.'
    }
  };

  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
  function smooth(a, b, x) { var t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
  function rng32(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function gaussian(random) {
    return Math.sqrt(-2 * Math.log(Math.max(1e-9, random()))) * Math.cos(TAU * random());
  }
  function accumulator() {
    return { n: 0, w: 0, sum: [0, 0, 0], square: [0, 0, 0], cross: [0, 0, 0],
      min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  }
  function accumulate(a, p, w) {
    a.n++; a.w += w;
    for (var k = 0; k < 3; k++) {
      a.sum[k] += p[k] * w; a.square[k] += p[k] * p[k] * w;
      a.min[k] = Math.min(a.min[k], p[k]); a.max[k] = Math.max(a.max[k], p[k]);
    }
    a.cross[0] += p[0] * p[1] * w;
    a.cross[1] += p[0] * p[2] * w;
    a.cross[2] += p[1] * p[2] * w;
  }
  function summary(a, source) {
    if (!a.w) return null;
    var m = a.sum.map(function (v) { return v / a.w; });
    var v = a.square.map(function (x, k) { return Math.max(0, x / a.w - m[k] * m[k]); });
    var xy = a.cross[0] / a.w - m[0] * m[1];
    var xz = a.cross[1] / a.w - m[0] * m[2];
    var yz = a.cross[2] / a.w - m[1] * m[2];
    return { source: source, sampleCount: a.n, mean: m, variance: v,
      covariance: [v[0], xy, xz, xy, v[1], yz, xz, yz, v[2]],
      bounds: { min: a.min.slice(), max: a.max.slice() } };
  }

  // Identical field definitions are shared by the volume fragment shader and the
  // stellar vertex extinction integral. Noise is evaluated in MODEL/WORLD space,
  // never screen space and never animated. Floating point details vary across GPUs.
  var COMMON = [
    'uniform float uSeed;',
    'uniform float uDust;',
    'uniform vec3 uBoxMin;',
    'uniform vec3 uBoxMax;',
    'float hash3(vec3 p) { return fract(sin(dot(p,vec3(127.1,311.7,74.7))+uSeed*19.19)*43758.5453); }',
    'float noise3(vec3 p) {',
    ' vec3 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);',
    ' return mix(mix(mix(hash3(i),hash3(i+vec3(1,0,0)),f.x),',
    '                mix(hash3(i+vec3(0,1,0)),hash3(i+vec3(1,1,0)),f.x),f.y),',
    '            mix(mix(hash3(i+vec3(0,0,1)),hash3(i+vec3(1,0,1)),f.x),',
    '                mix(hash3(i+vec3(0,1,1)),hash3(i+vec3(1,1,1)),f.x),f.y),f.z);',
    '}',
    'float fbm(vec3 p) { return 0.5714286*noise3(p)+0.2857143*noise3(p*2.03+7.1)+0.1428571*noise3(p*4.07-3.7); }',
    'float square(float x) { return x*x; }', // GLSL pow is undefined for negative bases, even with exponent 2.
    'float gauss(vec3 p) { return exp(-dot(p,p)); }',
    'float edgeWindow(vec3 p) {',
    ' vec3 d=min(p-uBoxMin,uBoxMax-p);',
    ' return smoothstep(0.0,0.13,min(d.x,min(d.y,d.z)));',
    '}',
    'vec2 intersectBox(vec3 ro, vec3 rd) {',
    // Avoid NaNs for axis-aligned rays without perturbing ordinary ray directions.
    ' vec3 sg=step(vec3(0.0),rd)*2.0-1.0;',
    ' vec3 inv=sg/max(abs(rd),vec3(0.000001));',
    ' vec3 a=(uBoxMin-ro)*inv, b=(uBoxMax-ro)*inv;',
    ' vec3 lo=min(a,b), hi=max(a,b);',
    ' return vec2(max(lo.x,max(lo.y,lo.z)),min(hi.x,min(hi.y,hi.z)));',
    '}'
  ].join('\n');

  var NEBULA = [
    'vec4 medium(vec3 p) {',
    ' float edge=edgeWindow(p); if(edge<=0.0) return vec4(0.0);',
    ' float n=fbm(p*3.5+vec3(3.1,0.7,5.3));',
    ' vec3 q=(p-vec3(-0.12,-0.04,0.0))/vec3(0.96,0.81,0.68);',
    ' float envelope=exp(-dot(q,q)*1.6);',
    ' vec3 c=(p-vec3(-0.23,-0.13,0.14))/vec3(0.48,0.40,0.46);',
    ' float cavityRadius=length(c)+(n-0.5)*1.15+0.38*p.y+0.19*sin(p.x*6.0+p.z*3.0);',
    ' float wall=exp(-square((cavityRadius-1.08)/0.25));',
    ' float outside=smoothstep(0.73,1.28,cavityRadius);',
    ' float ridge=pow(1.0-abs(2.0*noise3(p*14.0+vec3(n*3.0))-1.0),5.0);',
    ' float ripple=0.5+0.5*sin(p.x*20.0+p.y*11.0-p.z*17.0+n*13.0);',
    ' float fiber=ridge*(0.35+0.65*ripple);',
    ' float cloud=envelope*(0.16+1.5*n*n)*(0.15+0.85*outside);',
    ' vec3 bay=(p-vec3(-0.40,0.37,0.23))/vec3(0.32,0.55,0.24);',
    ' bay.x+=0.55*bay.y+0.20*sin(p.z*9.0);',
    ' float darkBay=gauss(bay)*(0.7+0.6*n);',
    ' float broken=0.18+0.82*smoothstep(0.27,0.72,fbm(p*6.0+4.2));',
    ' float j=(cloud*0.9+wall*envelope*(0.18+2.2*fiber)*broken)*edge;',
    ' j*=1.0-0.72*clamp(darkBay,0.0,1.0);',
    ' float ion=clamp(0.65-0.36*p.y+0.45*(1.0-outside),0.0,1.0);',
    ' vec3 color=mix(vec3(1.6,0.20,0.18),vec3(0.25,0.76,1.15),ion);',
    ' vec3 emission=color*j*2.3;',
    ' float sigma=(cloud*1.35+darkBay*7.0+fiber*cloud*1.5)*edge*uDust;',
    ' return vec4(emission,sigma);',
    '}'
  ].join('\n');

  var GALAXY = [
    'vec4 medium(vec3 world) {',
    ' float edge=edgeWindow(world); if(edge<=0.0) return vec4(0.0);',
    // Inverse of the ONE model-space X tilt applied to the star positions.
    ' vec3 p=vec3(world.x,0.93969262*world.y+0.34202014*world.z,-0.34202014*world.y+0.93969262*world.z);',
    ' vec3 q=p-vec3(-0.15,-0.08,0.0);',
    ' float r=length(q.xy/vec2(0.95,0.88));',
    ' float angle=atan(q.y/0.88,q.x/0.95+0.000001);',
    ' float n=fbm(p*7.0+vec3(5.1,2.7,0.3));',
    ' float phase=2.0*(angle-2.75*log(r+0.12))+0.55*sin(angle*3.0+r*7.0)+(n-0.5)*0.8;',
    // Unequal, interrupted arms are a procedural art adjustment inspired by the image;
    // they are not traced from the photograph or constrained in depth.
    ' float armSide=0.5+0.5*cos(angle-2.75*log(r+0.12));',
    ' float armMod=0.38+0.62*smoothstep(0.25,0.72,fbm(p*5.0+vec3(13.0,5.0,2.0)));',
    ' float arms=exp(-square(sin(phase*0.5)/0.48))*mix(0.67,1.0,armSide)*armMod;',
    ' float fine=fbm(p*38.0+vec3(2.0,8.0,1.0));',
    ' float filaments=pow(1.0-abs(2.0*noise3(p*64.0+vec3(n*4.0))-1.0),3.0);',
    ' float edgeR=1.0-smoothstep(0.88+0.12*(n-0.5),1.30+0.10*sin(angle*3.0),r);',
    ' float height=0.048+0.043*r;',
    ' float disk=exp(-r*2.2)*exp(-abs(q.z)/height)*edgeR;',
    ' float bulge=exp(-length(q/vec3(0.105,0.095,0.075))*2.0);',
    ' vec3 s=p-vec3(0.98,0.18,0.13);',
    ' float companion=exp(-length(s/vec3(0.10,0.085,0.07))*2.0);',
    ' float companionHalo=gauss(s/vec3(0.27,0.22,0.14));',
    ' float bx=clamp((p.x-0.36)/0.65,0.0,1.0);',
    ' float bridgeY=0.07+0.11*bx+0.08*sin(bx*3.14159265);',
    ' float bridge=exp(-square((p.y-bridgeY)/0.085)-square((p.z-0.13*bx)/0.075));',
    ' bridge*=smoothstep(0.31,0.48,p.x)*(1.0-smoothstep(0.93,1.12,p.x));',
    ' vec3 emission=disk*(vec3(0.74,0.68,0.56)*1.6+vec3(0.55,0.72,1.10)*arms*(3.0+8.0*fine)*(0.4+1.3*filaments));',
    ' emission+=vec3(1.25,1.02,0.68)*(bulge*14.0+companion*13.0+companionHalo*0.65);',
    ' emission+=vec3(1.2,0.18,0.26)*disk*arms*smoothstep(0.60,0.78,fine)*2.0;',
    ' emission+=vec3(0.55,0.68,1.0)*bridge*0.65;',
    ' float lane=exp(-square(sin((phase+0.40)*0.5)/0.17));',
    // World-fixed, multiscale clumps add near-field structure without a camera-locked overlay.
    // These are illustrative density variations, not observed dust measurements.
    ' float dustCloud=fbm(p*25.0+vec3(9.1,3.7,6.2));',
    ' float dustKnots=smoothstep(0.38,0.67,dustCloud);',
    ' float dustDisk=exp(-r*1.65)*exp(-abs(q.z)/(0.034+0.034*r))*edgeR;',
    ' float sigma=(dustDisk*(0.9+lane*10.0)*(0.35+2.2*fine+2.8*dustKnots)+companion*0.75+bridge*0.45)*uDust;',
    ' return vec4(emission*edge,sigma*edge);',
    '}'
  ].join('\n');

  /* M82: irregular edge-on starburst. The disk lies in the XZ plane with Y as the
     short axis, so the default camera (+Z) already reads the cigar-like edge-on
     profile. A broken mid-plane dust lane crosses the long axis, and a vertical
     red superwind leaves the centre along +/-Y. All of it is a fixed procedural
     field, not a fit to the photograph. */
  var IRREGULAR = [
    'vec4 medium(vec3 p) {',
    ' float edge=edgeWindow(p); if(edge<=0.0) return vec4(0.0);',
    ' float n=fbm(p*5.5+vec3(3.1,8.2,1.4));',
    ' float n2=fbm(p*23.0+vec3(7.7,2.2,5.9));',
    ' float dx=p.x/1.14, dz=p.z/0.36;',
    ' float rr=sqrt(dx*dx+dz*dz);',
    ' float ragged=0.52+0.48*smoothstep(0.34,0.76,n);',
    ' float radial=1.0-smoothstep(0.92,1.30,rr);',
    ' float height=0.038+0.040*rr;',
    ' float disk=exp(-rr*1.9)*exp(-abs(p.y)/height)*ragged*radial;',
    ' float bulge=exp(-length(vec3(p.x/0.19,p.y/0.12,p.z/0.20))*2.1);',
    // Fragmented mid-plane lane; tighter and darker than v1 so the cigar reads as cut in two.
    ' float laneY=p.y+0.024*sin(p.x*5.0)+0.012*sin(p.x*13.0+1.7);',
    ' float lane=exp(-square(laneY/(0.030+0.010*rr)))*exp(-rr*rr*0.75);',
    ' float knots=smoothstep(0.33,0.71,n2);',
    ' float dust=lane*(0.55+3.2*knots)*(0.50+0.50*smoothstep(0.25,0.70,n));',
    // Vertical superwind as a narrowing cone with fibrous strands, not a round blob.
    ' float ah=abs(p.y);',
    ' float cone=exp(-(square(p.x/(0.20-0.09*ah))+square(p.z/(0.15-0.06*ah))));',
    ' float strands=0.42+0.80*pow(1.0-abs(2.0*noise3(vec3(p.x*9.0,p.y*3.0,p.z*9.0))-1.0),2.0);',
    ' float wind=cone*exp(-ah*1.7)*smoothstep(0.06,0.40,ah)*(1.0-smoothstep(0.72,1.02,ah));',
    ' wind*=strands*(0.25+0.90*n2);',
    ' vec3 diskCol=vec3(0.80,0.82,0.86)*disk*(1.25+1.5*smoothstep(0.20,0.72,n));',
    ' vec3 coreCol=vec3(1.24,1.06,0.74)*bulge*11.0;',
    ' vec3 hiiCol=vec3(1.22,0.30,0.34)*disk*smoothstep(0.56,0.80,n2)*2.0;',
    ' vec3 windCol=vec3(1.25,0.30,0.26)*wind*1.05;',
    ' vec3 emission=diskCol+coreCol+hiiCol+windCol;',
    ' float sigma=(dust+0.24*disk)*uDust;',
    ' return vec4(emission*edge,sigma*edge);',
    '}'
  ].join('\n');

  /* M81 / M83: parameterised grand-design / barred spiral fields. The
     inverse X-rotation here is matched by spiralTilt() on the star positions.
     Values are injected as GLSL float literals, always with a decimal point. */
  var SPIRAL_CFG = {
    m81: { tilt: 32, arms: 2, wind: 3.15, rx: 1.02, ry: 0.94,
      barLen: 0.30, barW: 0.09, barGain: 0, hii: 1.35, dustLane: 9.0 },
    m83: { tilt: 12, arms: 2, wind: 1.95, rx: 1.06, ry: 0.98,
      barLen: 0.46, barW: 0.11, barGain: 3.6, hii: 3.1, dustLane: 7.0 }
  };
  function glf(v) { return Number(v).toFixed(5); }
  function spiralField(c) {
    var t = c.tilt * Math.PI / 180, cs = Math.cos(t), sn = Math.sin(t);
    return [
      'vec4 medium(vec3 world) {',
      ' float edge=edgeWindow(world); if(edge<=0.0) return vec4(0.0);',
      ' vec3 p=vec3(world.x,' + glf(cs) + '*world.y+' + glf(sn) + '*world.z,-' + glf(sn) + '*world.y+' + glf(cs) + '*world.z);',
      ' float r=length(p.xy/vec2(' + glf(c.rx) + ',' + glf(c.ry) + '));',
      ' float angle=atan(p.y/' + glf(c.ry) + ',p.x/' + glf(c.rx) + '+0.000001);',
      ' float n=fbm(p*7.0+vec3(5.1,2.7,0.3));',
      ' float phase=' + glf(c.arms) + '*(angle-' + glf(c.wind) + '*log(r+0.12))+0.45*sin(angle*3.0+r*6.0)+(n-0.5)*0.8;',
      ' float armMod=0.38+0.62*smoothstep(0.25,0.72,fbm(p*5.0+vec3(13.0,5.0,2.0)));',
      ' float arms=exp(-square(sin(phase*0.5)/0.48))*armMod;',
      ' float fine=fbm(p*38.0+vec3(2.0,8.0,1.0));',
      ' float filaments=pow(1.0-abs(2.0*noise3(p*64.0+vec3(n*4.0))-1.0),3.0);',
      ' float edgeR=1.0-smoothstep(0.88+0.12*(n-0.5),1.30+0.10*sin(angle*3.0),r);',
      ' float disk=exp(-r*2.2)*exp(-abs(p.z)/(0.048+0.043*r))*edgeR;',
      ' float bulge=exp(-length(p/vec3(0.115,0.105,0.085))*2.0);',
      ' float bar=exp(-square(p.x/' + glf(c.barLen) + ')-square(p.y/' + glf(c.barW) + ')-square(p.z/0.055));',
      ' vec3 emission=disk*(vec3(0.78,0.70,0.54)*1.6+vec3(0.52,0.70,1.10)*arms*(3.0+8.0*fine)*(0.4+1.3*filaments));',
      ' emission+=vec3(1.25,1.02,0.68)*(bulge*13.0+bar*' + glf(c.barGain) + ');',
      ' emission+=vec3(1.20,0.18,0.28)*disk*arms*smoothstep(0.58,0.78,fine)*' + glf(c.hii) + ';',
      ' float lane=exp(-square(sin((phase+0.40)*0.5)/0.17));',
      ' float dustKnots=smoothstep(0.38,0.67,fbm(p*25.0+vec3(9.1,3.7,6.2)));',
      ' float dustDisk=exp(-r*1.65)*exp(-abs(p.z)/(0.034+0.034*r))*edgeR;',
      ' float sigma=(dustDisk*(0.9+lane*' + glf(c.dustLane) + ')*(0.35+2.2*fine+2.8*dustKnots)+bar*0.25)*uDust;',
      ' return vec4(emission*edge,sigma*edge);',
      '}'
    ].join('\n');
  }

  /* M104: edge-on disk in the XZ plane, Y as the short axis, so the +Z
     default camera already reads the sombrero profile. Large bulge + a dark
     dust ring, no starburst wind. Fixed procedural field, not an inversion. */
  var LENTICULAR = [
    'vec4 medium(vec3 p) {',
    ' float edge=edgeWindow(p); if(edge<=0.0) return vec4(0.0);',
    ' float n=fbm(p*6.0+vec3(2.1,7.3,4.4));',
    ' float n2=fbm(p*22.0+vec3(8.3,1.7,5.1));',
    ' float dx=p.x/1.20, dz=p.z/0.34;',
    ' float rr=sqrt(dx*dx+dz*dz);',
    ' float radial=1.0-smoothstep(0.88,1.24,rr);',
    ' float disk=exp(-rr*1.15)*exp(-abs(p.y)/(0.036+0.030*rr))*radial*(0.75+0.45*n);',
    ' float bulge=exp(-length(vec3(p.x/0.50,p.y/0.31,p.z/0.42))*2.3);',
    ' float halo=gauss(p/vec3(0.72,0.66,0.58))*0.03;',
    ' float laneY=p.y+0.012*sin(p.x*4.0);',
    ' float ring=exp(-square((rr-0.58)/0.34));',
    ' float lane=exp(-square(laneY/(0.034+0.010*rr)))*exp(-square(p.x/1.18))*ring;',
    ' float knots=smoothstep(0.34,0.70,n2);',
    ' float dust=lane*(3.2+5.6*knots);',
    ' vec3 diskCol=vec3(0.86,0.84,0.78)*disk*2.4;',
    ' vec3 coreCol=vec3(1.26,1.10,0.80)*(bulge*5.5+halo);',
    ' vec3 emission=diskCol+coreCol;',
    ' float sigma=(dust+0.18*disk)*uDust;',
    ' return vec4(emission*edge,sigma*edge);',
    '}'
  ].join('\n');

  var QUAD_VERTEX = [
    'varying vec2 vNdc;',
    'void main() { vNdc=position.xy; gl_Position=vec4(position.xy,0.0,1.0); }'
  ].join('\n');

  var VOLUME_FRAGMENT = [
    'varying vec2 vNdc;',
    'uniform mat4 uProjectionInverse;',
    'uniform mat4 uCameraWorld;',
    'uniform float uPixelCone;',
    'void main() {',
    ' vec4 eye=uProjectionInverse*vec4(vNdc,1.0,1.0);',
    ' vec3 rd=normalize(mat3(uCameraWorld)*(eye.xyz/eye.w));',
    ' vec3 ro=uCameraWorld[3].xyz;',
    ' vec2 hit=intersectBox(ro,rd);',
    ' float start=max(hit.x,0.0), end=hit.y;',
    ' if(end<=start) { gl_FragColor=vec4(0.0,0.0,0.0,1.0); return; }',
    ' vec3 radiance=vec3(0.0), transmission=vec3(1.0);',
    ' float t=start;',
    // Midpoint quadrature: no temporal/screen-space random jitter. Remaining-length
    // floor guarantees that even close/internal views cover the ENTIRE segment.
    '#ifdef REFERENCE_512',
    ' for(int i=0;i<512;i++) {',
    '   float ds=(end-start)/512.0;',
    '#elif defined(REFERENCE_QUALITY)',
    ' for(int i=0;i<256;i++) {',
    '   float ds=(end-start)/256.0;',
    '#else',
    ' for(int i=0;i<128;i++) {',
    '   if(t>=end || max(transmission.r,max(transmission.g,transmission.b))<0.003) break;',
    '   float remaining=end-t;',
    '   float guaranteed=remaining/float(128-i);',
    '   float desired=clamp(0.010+t*uPixelCone*1.3,0.010,0.048);',
    '   float ds=min(remaining,max(guaranteed,desired));',
    '#endif',
    '   vec4 m=medium(ro+rd*(t+0.5*ds));',
    '   vec3 sigma=m.a*vec3(0.80,1.00,1.27);',
    '   vec3 tr=exp(-sigma*ds);',
    // Numerically stable small-tau branch; all quantities remain scene-linear.
    '   vec3 integral=vec3(ds);',
    '   if(sigma.r>0.001) integral.r=(1.0-tr.r)/sigma.r;',
    '   if(sigma.g>0.001) integral.g=(1.0-tr.g)/sigma.g;',
    '   if(sigma.b>0.001) integral.b=(1.0-tr.b)/sigma.b;',
    '   radiance+=transmission*m.rgb*integral;',
    '   transmission*=tr; t+=ds;',
    ' }',
    ' gl_FragColor=vec4(radiance,1.0);',
    '}'
  ].join('\n');

  var STAR_VERTEX = [
    'attribute vec3 aColor;',
    'attribute float aSize;',
    'attribute float aPower;',
    'attribute float aRank;',
    'uniform float uFocalPixels;',
    'uniform float uMaxPoint;',
    'uniform float uLod;',
    'uniform float uLodGain;',
    'varying vec3 vRadiance;',
    'varying float vEnergy;',
    'void main() {',
    ' float fade=1.0-smoothstep(uLod,uLod+0.075,aRank);',
    ' vRadiance=vec3(0.0); vEnergy=0.0;',
    ' vec4 mv=modelViewMatrix*vec4(position,1.0);',
    ' if(fade<=0.0 || mv.z>=-0.001) { gl_Position=vec4(2.0,2.0,2.0,1.0); gl_PointSize=1.0; return; }',
    ' float apparent=aSize*uFocalPixels/max(-mv.z,0.001);',
    ' float size=clamp(apparent,1.35,uMaxPoint);',
    ' gl_PointSize=size;',
    ' gl_Position=projectionMatrix*mv;',
    ' vec3 extinction=vec3(1.0);',
    '#ifdef VOLUME_STARS',
    ' vec3 world=(modelMatrix*vec4(position,1.0)).xyz;',
    ' vec3 delta=world-cameraPosition;',
    ' float distanceToStar=length(delta);',
    ' vec3 rd=delta/max(distanceToStar,0.00001);',
    ' vec2 interval=intersectBox(cameraPosition,rd);',
    ' float a=max(interval.x,0.0), b=min(interval.y,distanceToStar);',
    ' if(b>a && uDust>0.0) {',
    '#ifdef REFERENCE_QUALITY',
    '   float ds=(b-a)/56.0, tau=0.0;',
    '   for(int j=0;j<56;j++) {',
    '     tau+=medium(cameraPosition+rd*(a+(float(j)+0.5)*ds)).a*ds;',
    '#else',
    '   float ds=(b-a)/28.0, tau=0.0;',
    '   for(int j=0;j<28;j++) {',
    '     tau+=medium(cameraPosition+rd*(a+(float(j)+0.5)*ds)).a*ds;',
    '     if(tau>12.0) break;',
    '#endif',
    '   }',
    '   extinction=exp(-tau*vec3(0.80,1.00,1.27));',
    ' }',
    '#endif',
    ' vRadiance=aColor*aPower*extinction*fade*uLodGain;',
    // Min-point-size compensation, without unbounded close-range point energy.
    ' vEnergy=min(1.0,(apparent*apparent)/(size*size));',
    '}'
  ].join('\n');

  var STAR_FRAGMENT = [
    'varying vec3 vRadiance;',
    'varying float vEnergy;',
    'void main() {',
    ' vec2 q=gl_PointCoord*2.0-1.0;',
    ' float r2=dot(q,q); if(r2>=1.0) discard;',
    ' float psf=(exp(-5.8*r2)+0.045*exp(-1.8*r2))*(1.0-smoothstep(0.70,1.0,r2));',
    ' gl_FragColor=vec4(vRadiance*psf*vEnergy,1.0);',
    '}'
  ].join('\n');

  root.createDeepModels = function (THREE, renderer) {
    if (!THREE || !renderer || !renderer.getDrawingBufferSize) {
      throw new TypeError('createDeepModels requires THREE and a Three.js WebGLRenderer.');
    }
    var scene = new THREE.Scene();
    scene.name = 'DeepModels';
    scene.background = new THREE.Color(0, 0, 0);
    var camera = new THREE.PerspectiveCamera(48, 1, 0.002, 50);
    camera.name = 'DeepModelsCamera';
    var view = { yaw: 0, pitch: 0, distance: 3.6, target: [0, 0, 0] };
    var drawSize = new THREE.Vector2();
    var targetVector = new THREE.Vector3();
    var active = false, disposed = false, dust = true, current = null;
    var quality = 'interactive'; // Higher-step modes are diagnostics, not converged ground truth.
    var maxPoint = 64;
    try {
      var gl = renderer.getContext();
      maxPoint = Math.max(1, Math.min(96, gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE)[1]));
    } catch (ignore) { /* Conservative fallback; no renderer state was changed. */ }

    function assertLive() { if (disposed) throw new Error('DeepModels controller is disposed.'); }
    function fieldUniforms(spec) {
      return {
        uSeed: { value: (spec.seed % 997) / 997 },
        uDust: { value: dust ? 1 : 0 },
        uBoxMin: { value: new THREE.Vector3(spec.box[0], spec.box[1], spec.box[2]) },
        uBoxMax: { value: new THREE.Vector3(spec.box[3], spec.box[4], spec.box[5]) }
      };
    }
    function registerMaterial(material) {
      current.materials.push(material);
      // Explicitly exempt shaders from renderer tone-mapping injection. There are
      // deliberately no tonemapping/colorspace chunks in either fragment shader.
      material.toneMapped = false;
      return material;
    }
    function registerGeometry(geometry) { current.geometries.push(geometry); return geometry; }
    function addVolume(spec, field) {
      var uniforms = fieldUniforms(spec);
      uniforms.uProjectionInverse = { value: new THREE.Matrix4() };
      uniforms.uCameraWorld = { value: new THREE.Matrix4() };
      uniforms.uPixelCone = { value: 0.001 };
      var geometry = registerGeometry(new THREE.BufferGeometry());
      geometry.setAttribute('position', new THREE.Float32BufferAttribute([
        -1, -1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, 1, 1, 0, -1, 1, 0
      ], 3));
      var material = registerMaterial(new THREE.ShaderMaterial({
        uniforms: uniforms, vertexShader: QUAD_VERTEX,
        fragmentShader: COMMON + '\n' + field + '\n' + VOLUME_FRAGMENT,
        depthTest: false, depthWrite: false, transparent: false,
        blending: THREE.NoBlending
      }));
      var quad = new THREE.Mesh(geometry, material);
      quad.name = 'AnalyticVolumeRayIntegral'; quad.frustumCulled = false;
      quad.renderOrder = -100;
      current.group.add(quad); current.volume = material;
    }

    // Approximate illustrative linear-RGB temperature palette, not a spectral fit.
    function starColor(random, oldPopulation) {
      var t = random();
      if (oldPopulation) {
        if (t < 0.16) return [1.00, 0.40 + 0.20 * random(), 0.16 + 0.14 * random()];
        if (t < 0.91) return [1.00, 0.73 + 0.18 * random(), 0.46 + 0.25 * random()];
        return [0.46 + 0.18 * random(), 0.68 + 0.17 * random(), 1.0];
      }
      return t < 0.65 ? [0.36 + 0.24 * random(), 0.58 + 0.25 * random(), 1.0]
        : [1.0, 0.62 + 0.25 * random(), 0.32 + 0.24 * random()];
    }
    function makeStar(p, random, old, sizeScale, powerScale) {
      var bright = Math.pow(random(), 7);
      return { p: p, color: starColor(random, old), size: (0.006 + 0.013 * bright) * sizeScale,
        power: (0.42 + 1.65 * bright) * powerScale, priority: random() };
    }
    function addStars(stars, spec, field, block) {
      if (!stars.length) return;
      // Nested, fixed seeded priority order. LOD is a continuous uniform mask over
      // this stable order, NOT per-frame random sampling. Geometry never changes.
      stars.sort(function (a, b) { return a.priority - b.priority; });
      var n = stars.length;
      var positions = new Float32Array(n * 3), colors = new Float32Array(n * 3);
      var sizes = new Float32Array(n), powers = new Float32Array(n), ranks = new Float32Array(n);
      for (var i = 0; i < n; i++) {
        var star = stars[i]; positions.set(star.p, i * 3); colors.set(star.color, i * 3);
        sizes[i] = star.size; powers[i] = star.power; ranks[i] = (i + 0.5) / n;
        accumulate(current.starStats, star.p, 1);
      }
      var geometry = registerGeometry(new THREE.BufferGeometry());
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
      geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
      geometry.setAttribute('aPower', new THREE.BufferAttribute(powers, 1));
      geometry.setAttribute('aRank', new THREE.BufferAttribute(ranks, 1));
      geometry.computeBoundingSphere();
      var uniforms = fieldUniforms(spec);
      uniforms.uFocalPixels = { value: 1 };
      // Unresolved stars must not inflate into 96px glowing disks inside the cluster.
      uniforms.uMaxPoint = { value: Math.min(maxPoint, block ? 7 : 12) };
      uniforms.uLod = { value: 1 };
      uniforms.uLodGain = { value: 1 };
      var material = registerMaterial(new THREE.ShaderMaterial({
        uniforms: uniforms, defines: field ? { VOLUME_STARS: 1 } : {},
        vertexShader: (field ? COMMON + '\n' + field + '\n' : '') + STAR_VERTEX,
        fragmentShader: STAR_FRAGMENT,
        transparent: true, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false
      }));
      var points = new THREE.Points(geometry, material);
      points.name = block ? 'PlummerSpatialBlock' : 'VolumeExtinguishedStars';
      // Three.js point bounds do not include PSF radius; avoid edge popping.
      points.frustumCulled = false; points.renderOrder = 10;
      current.group.add(points);
      current.starGroups.push({ material: material, n: n, block: !!block,
        center: geometry.boundingSphere.center.clone(),
        radius: Math.max(0.12, geometry.boundingSphere.radius) });
      current.counts.stars += n;
    }

    function buildCluster(spec, random) {
      var buckets = [], i;
      for (i = 0; i < 64; i++) buckets.push([]);
      // Inverse CDF of Plummer radius, with explicit finite truncation. The
      // normalized scale radius and cutoff are artistic, not fitted to 47 Tuc.
      for (i = 0; i < 45000; i++) {
        var r;
        do { var u = Math.max(1e-8, random()); r = 0.18 / Math.sqrt(Math.pow(u, -2 / 3) - 1); }
        while (r > 1.25);
        var z = random() * 2 - 1, phi = TAU * random(), radial = Math.sqrt(1 - z * z);
        var p = [r * radial * Math.cos(phi), r * radial * Math.sin(phi), r * z];
        var ix = clamp(Math.floor((p[0] + 1.28) / 0.64), 0, 3);
        var iy = clamp(Math.floor((p[1] + 1.28) / 0.64), 0, 3);
        var iz = clamp(Math.floor((p[2] + 1.28) / 0.64), 0, 3);
        // Mostly modest warm stars and a small cool/hot tail: no artificial white
        // central glow, giant opaque sprite, or boosted central luminosity.
        buckets[ix + 4 * iy + 16 * iz].push(makeStar(p, random, true, 0.67, 0.58));
      }
      buckets.forEach(function (stars) { addStars(stars, spec, null, true); });
      current.counts.spatialBlocks = current.starGroups.length;
    }
    function insideBox(p, spec) {
      return p[0] > spec.box[0] && p[1] > spec.box[1] && p[2] > spec.box[2] &&
        p[0] < spec.box[3] && p[1] < spec.box[4] && p[2] < spec.box[5];
    }
    function buildNebulaStars(spec, random) {
      var stars = [];
      for (var i = 0; i < 246; i++) {
        var p;
        do {
          p = i < 130 ? [-0.23 + gaussian(random) * 0.32, -0.13 + gaussian(random) * 0.28, 0.10 + gaussian(random) * 0.30]
            : [(random() - 0.5) * 2.5, (random() - 0.5) * 2.3, (random() - 0.5) * 2.0];
        } while (!insideBox(p, spec));
        stars.push(makeStar(p, random, false, 0.8, 0.65));
      }
      [[-0.25, -0.15, 0.15], [-0.20, -0.13, 0.11], [-0.22, -0.08, 0.13], [-0.16, -0.11, 0.08]].forEach(function (p) {
        var star = makeStar(p, random, false, 1, 1);
        star.color = [0.55, 0.78, 1]; star.size = 0.027; star.power = 2.6; stars.push(star);
      });
      addStars(stars, spec, NEBULA, false);
    }
    function tilt(p) { return [p[0], 0.93969262 * p[1] - 0.34202014 * p[2], 0.34202014 * p[1] + 0.93969262 * p[2]]; }
    function buildGalaxyStars(spec, random) {
      var stars = [], i;
      for (i = 0; i < 4850; i++) {
        var p, old = false;
        do {
          if (i < 3600) {
            var r;
            do { r = -Math.log(Math.max(1e-9, 1 - random())) * 0.37; } while (r > 1.24);
            var theta = i % 4 === 0 ? random() * TAU : 2.75 * Math.log(r + 0.12) + (i % 2) * Math.PI + gaussian(random) * (0.14 + 0.12 * r);
            theta += 0.08 * Math.sin(r * 8);
            p = [-0.15 + 0.95 * r * Math.cos(theta), -0.08 + 0.88 * r * Math.sin(theta), gaussian(random) * (0.036 + 0.036 * r)];
            old = i % 4 === 0;
          } else if (i < 4300) {
            p = [-0.15 + gaussian(random) * 0.12, -0.08 + gaussian(random) * 0.105, gaussian(random) * 0.09]; old = true;
          } else if (i < 4750) {
            p = [0.98 + gaussian(random) * 0.145, 0.18 + gaussian(random) * 0.12, 0.13 + gaussian(random) * 0.08]; old = true;
          } else {
            var t = random();
            p = [0.36 + 0.65 * t, 0.07 + 0.11 * t + 0.08 * Math.sin(t * Math.PI) + gaussian(random) * 0.045,
              0.13 * t + gaussian(random) * 0.04];
          }
          p = tilt(p);
        } while (!insideBox(p, spec));
        stars.push(makeStar(p, random, old, 0.49, 0.46));
      }
      addStars(stars, spec, GALAXY, false);
    }
    /* M82 stellar population: broken disk (X long, Z narrow, Y thin), a compact
       nucleus and a sparse scattering in the outflow cones. Positions are seeded
       statistics, not catalog stars. */
    function buildIrregularStars(spec, random) {
      var stars = [], i;
      for (i = 0; i < 4200; i++) {
        var p, old = false;
        do {
          if (i < 3000) {
            var r = 1.32 * Math.sqrt(random());
            var th = random() * TAU;
            p = [r * Math.cos(th) * 1.06, gaussian(random) * (0.028 + 0.030 * r), r * Math.sin(th) * 0.33];
            old = i % 5 === 0;
          } else if (i < 3700) {
            p = [gaussian(random) * 0.13, gaussian(random) * 0.082, gaussian(random) * 0.14];
            old = true;
          } else {
            var side = random() < 0.5 ? -1 : 1;
            var h = 0.12 + 0.80 * random();
            p = [gaussian(random) * (0.13 + 0.10 * h), side * h, gaussian(random) * (0.11 + 0.09 * h)];
            old = false;
          }
        } while (!insideBox(p, spec));
        stars.push(makeStar(p, random, old, 0.47, 0.44));
      }
      addStars(stars, spec, IRREGULAR, false);
    }

    /* Forward X-rotation matching the inverse rotation inside spiralField(),
       so the stellar population sits IN the tilted disk. */
    function spiralTilt(p, c) {
      var t = c.tilt * Math.PI / 180, cs = Math.cos(t), sn = Math.sin(t);
      return [p[0], cs * p[1] - sn * p[2], sn * p[1] + cs * p[2]];
    }
    function buildSpiralStars(spec, random, c, field) {
      var stars = [], i;
      for (i = 0; i < 4700; i++) {
        var p, old = false;
        do {
          if (i < 3500) {
            var r;
            do { r = -Math.log(Math.max(1e-9, 1 - random())) * 0.37; } while (r > 1.24);
            var theta = i % 4 === 0 ? random() * TAU
              : c.wind * Math.log(r + 0.12) + (i % 2) * Math.PI + gaussian(random) * (0.15 + 0.13 * r);
            p = [c.rx * r * Math.cos(theta), c.ry * r * Math.sin(theta), gaussian(random) * (0.036 + 0.036 * r)];
            old = i % 4 === 0;
          } else if (i < 4150) {
            p = [gaussian(random) * 0.13, gaussian(random) * 0.115, gaussian(random) * 0.09]; old = true;
          } else if (c.barGain > 0) {
            var bx = (random() * 2 - 1) * c.barLen;
            p = [bx, gaussian(random) * c.barW * 0.7, gaussian(random) * 0.045]; old = true;
          } else {
            var hr = 0.55 + 0.75 * random(), ha = random() * TAU;
            p = [hr * Math.cos(ha) * c.rx, hr * Math.sin(ha) * c.ry, gaussian(random) * 0.12]; old = true;
          }
          p = spiralTilt(p, c);
        } while (!insideBox(p, spec));
        stars.push(makeStar(p, random, old, 0.49, 0.46));
      }
      addStars(stars, spec, field, false);
    }
    function buildLenticularStars(spec, random, field) {
      var stars = [], i;
      for (i = 0; i < 4400; i++) {
        var p, old = false;
        do {
          if (i < 3000) {
            var r = 1.30 * Math.sqrt(random()), th = random() * TAU;
            p = [r * Math.cos(th) * 1.18, gaussian(random) * (0.022 + 0.020 * r), r * Math.sin(th) * 0.30];
            old = i % 6 === 0;
          } else if (i < 3800) {
            p = [gaussian(random) * 0.26, gaussian(random) * 0.25, gaussian(random) * 0.23]; old = true;
          } else {
            var ha = random() * TAU, hz = random() * 2 - 1, rr = 0.42 + 0.55 * random();
            p = [rr * Math.cos(ha), hz * rr * 0.75, rr * Math.sin(ha) * 0.45]; old = true;
          }
        } while (!insideBox(p, spec));
        stars.push(makeStar(p, random, old, 0.47, 0.44));
      }
      addStars(stars, spec, field, false);
    }
    // Diagnostic quadrature of the CPU equivalent EMISSION field, not an invented
    // measured covariance. JS/GPU noise differs in floating point; this is explicitly
    // an approximate 20^3 CPU sample, computed once on open, never during update.
    function volumeStatistics(spec, id) {
      var seed = (spec.seed % 997) / 997;
      function hash(x, y, z) {
        var h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7 + seed * 19.19) * 43758.5453;
        return h - Math.floor(h);
      }
      function noise(x, y, z) {
        var ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
        var fx = smooth(0, 1, x - ix), fy = smooth(0, 1, y - iy), fz = smooth(0, 1, z - iz);
        var sum = 0;
        for (var a = 0; a < 2; a++) for (var b = 0; b < 2; b++) for (var c = 0; c < 2; c++) {
          sum += hash(ix + a, iy + b, iz + c) * (a ? fx : 1 - fx) * (b ? fy : 1 - fy) * (c ? fz : 1 - fz);
        }
        return sum;
      }
      function fbm(x, y, z) {
        return 0.5714286 * noise(x, y, z) + 0.2857143 * noise(x * 2.03 + 7.1, y * 2.03 + 7.1, z * 2.03 + 7.1)
          + 0.1428571 * noise(x * 4.07 - 3.7, y * 4.07 - 3.7, z * 4.07 - 3.7);
      }
      function g(x, y, z) { return Math.exp(-x * x - y * y - z * z); }
      function sq(x) { return x * x; }
      function weight(world) {
        var x = world[0], y = world[1], z = world[2], edge = Infinity;
        for (var k = 0; k < 3; k++) edge = Math.min(edge, world[k] - spec.box[k], spec.box[k + 3] - world[k]);
        edge = smooth(0, 0.13, edge);
        if (id === 'm82') {
          var n82 = fbm(x * 5.5 + 3.1, y * 5.5 + 8.2, z * 5.5 + 1.4);
          var n82b = fbm(x * 23 + 7.7, y * 23 + 2.2, z * 23 + 5.9);
          var dx82 = x / 1.14, dz82 = z / 0.36;
          var rr82 = Math.sqrt(dx82 * dx82 + dz82 * dz82);
          var ragged82 = 0.52 + 0.48 * smooth(0.34, 0.76, n82);
          var radial82 = 1 - smooth(0.92, 1.30, rr82);
          var height82 = 0.038 + 0.040 * rr82;
          var disk82 = Math.exp(-rr82 * 1.9) * Math.exp(-Math.abs(y) / height82) * ragged82 * radial82;
          var bulge82 = Math.exp(-Math.hypot(x / 0.19, y / 0.12, z / 0.20) * 2.1);
          var ah82 = Math.abs(y);
          var cone82 = Math.exp(-(sq(x / (0.20 - 0.09 * ah82)) + sq(z / (0.15 - 0.06 * ah82))));
          var wind82 = cone82 * Math.exp(-ah82 * 1.7) * smooth(0.06, 0.40, ah82) * (1 - smooth(0.72, 1.02, ah82));
          wind82 *= (0.25 + 0.90 * n82b);
          var lumDisk = 0.2126 * 0.80 + 0.7152 * 0.82 + 0.0722 * 0.86;
          var lumCore = 0.2126 * 1.24 + 0.7152 * 1.06 + 0.0722 * 0.74;
          var lumHii = 0.2126 * 1.22 + 0.7152 * 0.30 + 0.0722 * 0.34;
          var lumWind = 0.2126 * 1.25 + 0.7152 * 0.30 + 0.0722 * 0.26;
          return edge * (disk82 * (lumDisk * (1.25 + 1.5 * smooth(0.20, 0.72, n82)) + lumHii * smooth(0.56, 0.80, n82b) * 2.0)
            + lumCore * bulge82 * 11.0 + lumWind * wind82 * 1.05);
        }
        if (id === 'm81' || id === 'm83') {
          var sc = SPIRAL_CFG[id];
          var st = sc.tilt * Math.PI / 180, ccs = Math.cos(st), ssn = Math.sin(st);
          var px = x, py = ccs * y + ssn * z, pz = -ssn * y + ccs * z;
          var rs = Math.sqrt(sq(px / sc.rx) + sq(py / sc.ry));
          var phaseS = sc.arms * (Math.atan2(py / sc.ry, px / sc.rx + 0.000001) - sc.wind * Math.log(rs + 0.12));
          var armS = Math.exp(-sq(Math.sin(phaseS * 0.5) / 0.48));
          var erS = 1 - smooth(0.88, 1.30, rs);
          var diskS = Math.exp(-rs * 2.2) * Math.exp(-Math.abs(pz) / (0.048 + 0.043 * rs)) * erS;
          var bulgeS = Math.exp(-Math.hypot(px / 0.115, py / 0.105, pz / 0.085) * 2);
          var barS = Math.exp(-sq(px / sc.barLen) - sq(py / sc.barW) - sq(pz / 0.055));
          var lumWarm = 0.2126 * 0.78 + 0.7152 * 0.70 + 0.0722 * 0.54;
          var lumBlue = 0.2126 * 0.52 + 0.7152 * 0.70 + 0.0722 * 1.10;
          var lumCoreS = 0.2126 * 1.25 + 0.7152 * 1.02 + 0.0722 * 0.68;
          return edge * (diskS * (lumWarm * 1.6 + lumBlue * armS * 3.0) + lumCoreS * (bulgeS * 13 + barS * sc.barGain));
        }
        if (id === 'm104') {
          var nl = fbm(x * 6 + 2.1, y * 6 + 7.3, z * 6 + 4.4);
          var rrl = Math.sqrt(sq(x / 1.20) + sq(z / 0.34));
          var radialL = 1 - smooth(0.88, 1.24, rrl);
          var diskL = Math.exp(-rrl * 1.15) * Math.exp(-Math.abs(y) / (0.036 + 0.030 * rrl)) * radialL * (0.75 + 0.45 * nl);
          var bulgeL = Math.exp(-Math.hypot(x / 0.50, y / 0.31, z / 0.42) * 2.3);
          var lumD = 0.2126 * 0.86 + 0.7152 * 0.84 + 0.0722 * 0.78;
          var lumC = 0.2126 * 1.26 + 0.7152 * 1.10 + 0.0722 * 0.80;
          return edge * (lumD * diskL * 2.4 + lumC * bulgeL * 5.5);
        }
        if (id === 'm42') {
          var n = fbm(x * 3.5 + 3.1, y * 3.5 + 0.7, z * 3.5 + 5.3);
          var envelope = Math.exp(-1.6 * (sq((x + 0.12) / 0.96) + sq((y + 0.04) / 0.81) + sq(z / 0.68)));
          var cr = Math.sqrt(sq((x + 0.23) / 0.48) + sq((y + 0.13) / 0.40) + sq((z - 0.14) / 0.46)) + (n - 0.5) * 1.15 + 0.38 * y + 0.19 * Math.sin(x * 6 + z * 3);
          var wall = Math.exp(-sq((cr - 1.08) / 0.25)), outside = smooth(0.73, 1.28, cr);
          var ridge = Math.pow(1 - Math.abs(2 * noise(x * 14 + n * 3, y * 14 + n * 3, z * 14 + n * 3) - 1), 5);
          var fiber = ridge * (0.35 + 0.65 * (0.5 + 0.5 * Math.sin(x * 20 + y * 11 - z * 17 + n * 13)));
          var cloud = envelope * (0.16 + 1.5 * n * n) * (0.15 + 0.85 * outside);
          var by = (y - 0.37) / 0.55;
          var bay = g((x + 0.40) / 0.32 + 0.55 * by + 0.20 * Math.sin(z * 9), by, (z - 0.23) / 0.24) * (0.7 + 0.6 * n);
          var broken = 0.18 + 0.82 * smooth(0.27, 0.72, fbm(x * 6 + 4.2, y * 6 + 4.2, z * 6 + 4.2));
          var j = (cloud * 0.9 + wall * envelope * (0.18 + 2.2 * fiber) * broken) * edge * (1 - 0.72 * clamp(bay, 0, 1));
          var ion = clamp(0.65 - 0.36 * y + 0.45 * (1 - outside), 0, 1);
          var red = 1.6 * (1 - ion) + 0.25 * ion, green = 0.20 * (1 - ion) + 0.76 * ion, blue = 0.18 * (1 - ion) + 1.15 * ion;
          return j * 2.3 * (0.2126 * red + 0.7152 * green + 0.0722 * blue);
        }
        var py = 0.93969262 * y + 0.34202014 * z;
        z = -0.34202014 * y + 0.93969262 * z; y = py;
        var qx = x + 0.15, qy = y + 0.08;
        var r = Math.sqrt(sq(qx / 0.95) + sq(qy / 0.88));
        var angle = Math.atan2(qy / 0.88, qx / 0.95 + 0.000001);
        var ng = fbm(x * 7 + 5.1, y * 7 + 2.7, z * 7 + 0.3);
        var phase = 2 * (angle - 2.75 * Math.log(r + 0.12)) + 0.55 * Math.sin(angle * 3 + r * 7) + (ng - 0.5) * 0.8;
        var armSide = 0.5 + 0.5 * Math.cos(angle - 2.75 * Math.log(r + 0.12));
        var armMod = 0.38 + 0.62 * smooth(0.25, 0.72, fbm(x * 5 + 13, y * 5 + 5, z * 5 + 2));
        var arms = Math.exp(-sq(Math.sin(phase * 0.5) / 0.48)) * (0.67 + 0.33 * armSide) * armMod;
        var fine = fbm(x * 38 + 2, y * 38 + 8, z * 38 + 1);
        var filaments = Math.pow(1 - Math.abs(2 * noise(x * 64 + ng * 4, y * 64 + ng * 4, z * 64 + ng * 4) - 1), 3);
        var er = 1 - smooth(0.88 + 0.12 * (ng - 0.5), 1.30 + 0.10 * Math.sin(angle * 3), r);
        var disk = Math.exp(-r * 2.2 - Math.abs(z) / (0.048 + 0.043 * r)) * er;
        var bulge = Math.exp(-Math.hypot(qx / 0.105, qy / 0.095, z / 0.075) * 2);
        var comp = Math.exp(-Math.hypot((x - 0.98) / 0.10, (y - 0.18) / 0.085, (z - 0.13) / 0.07) * 2);
        var halo = g((x - 0.98) / 0.27, (y - 0.18) / 0.22, (z - 0.13) / 0.14);
        var bx = clamp((x - 0.36) / 0.65, 0, 1), by2 = 0.07 + 0.11 * bx + 0.08 * Math.sin(bx * Math.PI);
        var bridge = Math.exp(-sq((y - by2) / 0.085) - sq((z - 0.13 * bx) / 0.075)) * smooth(0.31, 0.48, x) * (1 - smooth(0.93, 1.12, x));
        var warm = 0.2126 * 1.25 + 0.7152 * 1.02 + 0.0722 * 0.68;
        return edge * (disk * ((0.2126 * 0.74 + 0.7152 * 0.68 + 0.0722 * 0.56) * 1.6 +
          (0.2126 * 0.55 + 0.7152 * 0.72 + 0.0722 * 1.10) * arms * (3.0 + 8 * fine) * (0.4 + 1.3 * filaments)) +
          warm * (bulge * 14 + comp * 13 + halo * 0.65) + (0.2126 * 0.55 + 0.7152 * 0.68 + 0.0722) * bridge * 0.65 +
          (0.2126 * 1.2 + 0.7152 * 0.18 + 0.0722 * 0.26) * disk * arms * smooth(0.60, 0.78, fine) * 2);
      }
      var stats = accumulator(), N = 20;
      for (var ix = 0; ix < N; ix++) for (var iy = 0; iy < N; iy++) for (var iz = 0; iz < N; iz++) {
        var p = [spec.box[0] + (ix + 0.5) * (spec.box[3] - spec.box[0]) / N,
          spec.box[1] + (iy + 0.5) * (spec.box[4] - spec.box[1]) / N,
          spec.box[2] + (iz + 0.5) * (spec.box[5] - spec.box[2]) / N];
        accumulate(stats, p, weight(p));
      }
      return summary(stats, 'Approximate CPU 20^3 midpoint quadrature, intrinsic linear-emission luminance weighted; not observed mass/density; JS/GPU noise rounding differs.');
    }

    function geometryBytes() {
      if (!current) return 0;
      var buffers = [], bytes = 0;
      current.geometries.forEach(function (g) {
        Object.keys(g.attributes).forEach(function (key) {
          var array = g.attributes[key].array;
          if (buffers.indexOf(array.buffer) < 0) { buffers.push(array.buffer); bytes += array.buffer.byteLength; }
        });
        if (g.index && buffers.indexOf(g.index.array.buffer) < 0) {
          buffers.push(g.index.array.buffer); bytes += g.index.array.buffer.byteLength;
        }
      });
      return bytes;
    }
    function releaseCurrent() {
      active = false;
      if (!current) return;
      scene.remove(current.group);
      current.geometries.forEach(function (g) { g.dispose(); });
      current.materials.forEach(function (m) { m.dispose(); });
      current.group.clear(); current = null;
    }
    function update() {
      if (disposed) return false;
      renderer.getDrawingBufferSize(drawSize);
      var width = Math.max(1, drawSize.x), height = Math.max(1, drawSize.y);
      var aspect = width / height;
      if (camera.aspect !== aspect) { camera.aspect = aspect; camera.updateProjectionMatrix(); }
      var cp = Math.cos(view.pitch);
      targetVector.set(view.target[0], view.target[1], view.target[2]);
      camera.position.set(targetVector.x + view.distance * Math.sin(view.yaw) * cp,
        targetVector.y + view.distance * Math.sin(view.pitch),
        targetVector.z + view.distance * Math.cos(view.yaw) * cp);
      camera.lookAt(targetVector); camera.updateMatrixWorld(true);
      if (!current || !active) return false;
      var focal = height / (2 * Math.tan(24 * Math.PI / 180));
      if (current.volume) {
        var vu = current.volume.uniforms;
        vu.uCameraWorld.value.copy(camera.matrixWorld);
        vu.uProjectionInverse.value.copy(camera.projectionMatrixInverse);
        vu.uPixelCone.value = 1 / focal;
        vu.uDust.value = dust ? 1 : 0;
      }
      var estimated = 0;
      current.starGroups.forEach(function (entry) {
        var u = entry.material.uniforms;
        u.uFocalPixels.value = focal; u.uDust.value = dust ? 1 : 0;
        var fraction = 1;
        if (entry.block) {
          var distance = Math.max(0.04, camera.position.distanceTo(entry.center));
          var projectedRadius = entry.radius * focal / distance;
          // Spatial-block projected coverage, smooth in distance and framebuffer
          // size; no time dependence and no hidden stochastic sample changes.
          fraction = clamp(Math.pow(projectedRadius / 100, 1.05), 0.13, 1);
        }
        u.uLod.value = fraction;
        u.uLodGain.value = Math.min(1.55, 1 / Math.sqrt(fraction));
        estimated += entry.n * Math.min(1, fraction + (fraction < 1 ? 0.0375 : 0));
      });
      current.counts.lodWeightedStarsEstimate = Math.round(estimated);
      return true;
    }
    function info() {
      var spec = current && current.spec;
      var result = {
        active: active, disposed: disposed, id: current ? current.id : null,
        modelType: spec ? spec.type : null, truth: spec ? spec.truth : null,
        seed: spec ? spec.seed : null, dust: dust,
        units: 'Local normalized coordinates; all scales, shapes, optical coefficients and visual PSFs uncalibrated.',
        counts: current ? Object.assign({}, current.counts) : { stars: 0, spatialBlocks: 0, volumeMeshes: 0, lodWeightedStarsEstimate: 0 },
        geometryBytes: current ? current.bytes : 0,
        geometryBytesMeaning: 'Unique geometry ArrayBuffer bytes (attributes/indices), not total GPU/driver/program memory.',
        camera: { fov: camera.fov, aspect: camera.aspect, near: camera.near, far: camera.far,
          yaw: view.yaw, pitch: view.pitch, distance: view.distance,
          target: view.target.slice(), position: camera.position.toArray(),
          drawingBuffer: [drawSize.x, drawSize.y], angleUnits: 'radians', distanceLimits: [0.08, 12] },
        bounds: spec ? { min: spec.box.slice(0, 3), max: spec.box.slice(3, 6),
          meaning: current.id === '47tuc' ? 'Model-space enclosing box; Plummer cutoff radius=1.25.' : 'World-space ray-integration clipping box; not a measured astronomical extent.' } : null,
        variance3D: current ? current.statistics : null,
        lod: current && current.id === '47tuc' ? {
          method: '4x4x4 spatial blocks; fixed seeded nested vertex ranks, continuous shader fade and capped flux compensation',
          note: 'All 45000 vertices stay resident/submitted. LOD reduces visible point/fragment work, NOT vertex submission or draw-call count. Estimate is fade-weighted, not visibility/occlusion counted.'
        } : null,
        rendering: { linearHDR: true, quality: quality,
          qualityNote: 'Reference modes are higher-step diagnostics, not converged ground truth; 47 Tuc has no volume extinction.',
          maxVolumeSteps: current && current.volume ? (quality === 'reference512' ? 512 : quality === 'reference' ? 256 : 128) : 0,
          stellarExtinctionSteps: current && current.volume ? (quality !== 'interactive' ? 56 : 28) : 0,
          modelTiltDegrees: current && current.id === 'm51' ? 20
            : (current && SPIRAL_CFG[current.id] ? SPIRAL_CFG[current.id].tilt : 0),
          pointSizeCapPixels: maxPoint,
          limitations: 'Technical prototype, not movie-quality. Full-resolution raymarch can be GPU-heavy; finite integration may miss thin details at extreme views. Point PSF sizes are hardware-capped. Star extinction is evaluated at point centers. No scattering, physical spectral calibration or self-consistent dynamics.' }
      };
      // Prevent consumers from mutating cached diagnostic arrays through snapshots.
      if (result.variance3D) result.variance3D = JSON.parse(JSON.stringify(result.variance3D));
      return result;
    }
    function open(id) {
      assertLive();
      if (!Object.prototype.hasOwnProperty.call(SPECS, id)) throw new RangeError('Unknown deep model: ' + id);
      releaseCurrent();
      var spec = SPECS[id];
      current = { id: id, spec: spec, group: new THREE.Group(), geometries: [], materials: [],
        volume: null, starGroups: [], starStats: accumulator(), statistics: null, bytes: 0,
        counts: { stars: 0, spatialBlocks: 0, volumeMeshes: 0, lodWeightedStarsEstimate: 0 } };
      current.group.name = 'DeepModel:' + id; scene.add(current.group);
      view = { yaw: 0, pitch: 0, distance: 3.6, target: [0, 0, 0] };
      try {
        var random = rng32(spec.seed);
        if (id === '47tuc') buildCluster(spec, random);
        else if (id === 'm82') {
          addVolume(spec, IRREGULAR);
          current.counts.volumeMeshes = 1;
          buildIrregularStars(spec, random);
        } else if (id === 'm81' || id === 'm83') {
          var spiralGLSL = spiralField(SPIRAL_CFG[id]);
          addVolume(spec, spiralGLSL);
          current.counts.volumeMeshes = 1;
          buildSpiralStars(spec, random, SPIRAL_CFG[id], spiralGLSL);
        } else if (id === 'm104') {
          addVolume(spec, LENTICULAR);
          current.counts.volumeMeshes = 1;
          buildLenticularStars(spec, random, LENTICULAR);
        } else {
          addVolume(spec, id === 'm42' ? NEBULA : GALAXY);
          current.counts.volumeMeshes = 1;
          if (id === 'm42') buildNebulaStars(spec, random); else buildGalaxyStars(spec, random);
        }
        current.statistics = {
          stars: summary(current.starStats, 'Exact generated star positions, number weighted, local/world coordinates; not catalog data.'),
          volumeEmission: id === '47tuc' ? null : volumeStatistics(spec, id)
        };
        current.bytes = geometryBytes();
        current.counts.geometries = current.geometries.length;
        current.counts.materials = current.materials.length;
        active = true; update();
        if (quality !== 'interactive') setQuality(quality);
        return info();
      } catch (error) { releaseCurrent(); throw error; }
    }
    function close() { releaseCurrent(); return info(); }
    function setView(next) {
      assertLive();
      if (typeof next === 'string') {
        if (next === 'near') next = { distance: 0.35 };
        else if (next === 'front') next = { yaw: 0, pitch: 0, distance: 3.6, target: [0, 0, 0] };
        else if (next === 'side') next = { yaw: Math.PI / 2, pitch: 0, distance: 3.6, target: [0, 0, 0] };
        else if (next === 'back') next = { yaw: Math.PI, pitch: 0, distance: 3.6, target: [0, 0, 0] };
        else throw new RangeError('Unknown view preset: ' + next);
      }
      if (!next || typeof next !== 'object') throw new TypeError('setView expects a preset or view object.');
      var candidate = { yaw: view.yaw, pitch: view.pitch, distance: view.distance, target: view.target.slice() };
      ['yaw', 'pitch', 'distance'].forEach(function (key) {
        if (next[key] !== undefined) {
          if (typeof next[key] !== 'number' || !Number.isFinite(next[key])) throw new TypeError(key + ' must be a finite number.');
          candidate[key] = next[key];
        }
      });
      if (next.target !== undefined) {
        if (!Array.isArray(next.target) || next.target.length !== 3 || next.target.some(function (n) { return typeof n !== 'number' || !Number.isFinite(n); })) {
          throw new TypeError('target must be [finite x, finite y, finite z].');
        }
        candidate.target = next.target.slice();
      }
      candidate.yaw = ((candidate.yaw % TAU) + TAU) % TAU;
      candidate.pitch = clamp(candidate.pitch, -Math.PI / 2 + 0.0001, Math.PI / 2 - 0.0001);
      candidate.distance = clamp(candidate.distance, 0.08, 12);
      view = candidate; update(); return info();
    }
    function setQuality(mode) {
      assertLive();
      if (mode !== 'interactive' && mode !== 'reference' && mode !== 'reference512') throw new RangeError('Unknown quality mode: ' + mode);
      quality = mode;
      if (current) current.materials.forEach(function (material) {
        if (material !== current.volume && !material.defines.VOLUME_STARS) return;
        if (mode !== 'interactive') material.defines.REFERENCE_QUALITY = 1;
        else delete material.defines.REFERENCE_QUALITY;
        if (mode === 'reference512' && material === current.volume) material.defines.REFERENCE_512 = 1;
        else delete material.defines.REFERENCE_512;
        material.needsUpdate = true;
      });
      return info();
    }
    function setDust(on) { assertLive(); dust = !!on; update(); return info(); }
    function dispose() { if (disposed) return; releaseCurrent(); disposed = true; }

    update();
    return { scene: scene, camera: camera, open: open, close: close, update: update,
      setView: setView, info: info, dispose: dispose, setDust: setDust, setQuality: setQuality,
      getQuality: function () { return quality; } };
  };
}(typeof window !== 'undefined' ? window : globalThis));
