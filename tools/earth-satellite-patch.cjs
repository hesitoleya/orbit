'use strict';
/** Pure, fail-closed Orbit app transform. Does NOT read/write app/html or assets.
 * Apply to extracted app JS, not to the entire HTML document. Idempotent.
 * Existing __earthImagery.tex/wxTex is preferred; fallback uses the SAME local
 * deployable assets/inline keys as the unified build, never .workbuddy/network.
 * Exact analytic sphere: no cube patch UV, terrain displacement, trees/buildings.
 */
const MARK = '/* ORBIT_EARTH_SATELLITE_V1 */';

function runtime() {
  /* ORBIT_EARTH_SATELLITE_V1 */
  function __satelliteEarthOn() { return PTKey === 'earth'; }
  let __satelliteEarthState = null;
  function __satelliteEarthInit() {
    if (__satelliteEarthState) return __satelliteEarthState;
    function load(key, file, color) {
      const inline = window.__ORBIT_INLINE__;
      const image = inline && inline[key];
      const src = image ? (image.startsWith('data:') ? image : 'data:image/jpeg;base64,' + image) : './data/' + file;
      const t = new THREE.TextureLoader().load(src);
      t.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.flipY = false;
      return t;
    }
    const imagery = typeof __earthImagery !== 'undefined' ? __earthImagery : {
      tex: load('earthSurface', 'earth-surface-8k.jpg', true),
      wxTex: load('earthClouds', 'earth-cloudfraction.jpg', false)
    };
    for (const t of [imagery.tex, imagery.wxTex]) {
      t.wrapS = THREE.RepeatWrapping;
      t.wrapT = THREE.ClampToEdgeWrapping;
      t.minFilter = THREE.LinearMipmapLinearFilter;
      t.magFilter = THREE.LinearFilter;
      t.generateMipmaps = true;
      t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
      t.needsUpdate = true;
    }
    // Solar System Scope cloud image is visual grayscale opacity, not calibrated MODIS fraction.
    imagery.wxTex.colorSpace = THREE.NoColorSpace;
    const U = {
      uSurface: { value: imagery.tex }, uCloudFraction: { value: imagery.wxTex },
      uEyeEF: { value: new THREE.Vector3() }, uEyeC: { value: 0 },
      uEyeW: { value: new THREE.Vector3() }, uInvProjection: { value: new THREE.Matrix4() },
      uCameraWorld: { value: new THREE.Matrix4() }, uProjection: { value: new THREE.Matrix4() },
      uWorldToEf: { value: new THREE.Matrix3() }, uSunEF: { value: new THREE.Vector3() },
      uCloudOn: { value: 1 }, uRadius: { value: R_EARTH }, uLogFC: { value: 1 },
      uLogDepth: { value: renderer.capabilities.logarithmicDepthBuffer ? 1 : 0 }
    };
    // Reuse atmosphere/solar uniforms, NOT the old procedural fragment shader.
    for (const key of ['uTransLUT', 'uMSLUT', 'uCloudMap', 'uCenter', 'uSunDirW',
      'uAGain', 'uHR', 'uHM', 'uBR', 'uBMS', 'uBMA', 'uBO3', 'uSkyAmb']) {
      if (terrainMat.uniforms[key]) U[key] = terrainMat.uniforms[key];
    }
    const material = new THREE.ShaderMaterial({
      uniforms: U, depthTest: true, depthWrite: true,
      extensions: { derivatives: true, shaderTextureLOD: true, fragDepth: true },
      vertexShader: `
        varying vec2 vNdc;
        void main() {
          vNdc = position.xy;
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }
      `,
      fragmentShader: `
        precision highp float;
        varying vec2 vNdc;
        uniform sampler2D uSurface, uCloudFraction;
        uniform vec3 uEyeEF, uEyeW, uSunEF;
        uniform float uEyeC, uRadius, uCloudOn, uLogFC, uLogDepth;
        uniform mat4 uInvProjection, uCameraWorld, uProjection;
        uniform mat3 uWorldToEf;
        ${atmoGLSL(12)}
        // Global geocentric direction only: there are NO patch-local UVs.
        vec2 sphereUV(vec3 n) {
          return vec2(atan(n.z, n.x) / 6.283185307179586 + 0.5,
                      0.5 - asin(clamp(n.y, -1.0, 1.0)) / 3.141592653589793);
        }
        // Longitude is periodic. Correct its derivative before mip selection;
        // the date-line must not become a blurred stripe from a +/-1 UV jump.
        vec4 sampleSphere(sampler2D tex, vec2 uv) {
          vec2 dx = dFdx(uv), dy = dFdy(uv);
          dx.x -= floor(dx.x + 0.5); dy.x -= floor(dy.x + 0.5);
          return texture2DGradEXT(tex, uv, dx, dy);
        }
        void main() {
          vec4 vh = uInvProjection * vec4(vNdc, 0.0, 1.0);
          // Mid-depth avoids w=0 at enormous/infinite perspective far planes.
          vec3 rayView = normalize(vh.xyz);
          vec3 rayW = normalize((uCameraWorld * vec4(rayView, 0.0)).xyz);
          vec3 rd = normalize(uWorldToEf * rayW);
          float b = dot(uEyeEF, rd);
          float disc = b * b - uEyeC;
          if (disc < 0.0 || b >= 0.0) discard;
          // Rationalized near root is stable at the 200m minimum altitude.
          float t = uEyeC / max(-b + sqrt(max(disc, 0.0)), 1e-12);
          if (t <= 0.0) discard;
          vec3 n = normalize(uEyeEF + rd * t);
          vec2 uv = sphereUV(n);
          vec3 albedo = sampleSphere(uSurface, uv).rgb;
          float cf = sampleSphere(uCloudFraction, uv).r;
          float cloud = smoothstep(0.08, 0.88, cf) * 0.88 * uCloudOn;
          albedo = mix(albedo, vec3(0.92, 0.94, 0.96), cloud);
          float mu = dot(n, normalize(uSunEF));
          vec3 sunT = atmoTransToSun(uRadius + 1.0, mu);
          vec3 col = albedo * (vec3(0.003) + 1.25 * max(mu, 0.0) * sunT);
          vec3 T;
          vec3 air = atmoMarch(uEyeW, rayW, t * uRadius, T);
          col = col * T + air;
          gl_FragColor = vec4(col, 1.0);
          float viewDepth = max(1e-5, -rayView.z * t * uRadius);
          // Match Three's log-depth geometry so moons/cloud occlusion stay sane.
          float depth = log2(1.0 + viewDepth) * uLogFC * 0.5;
          if (uLogDepth < 0.5) {
            vec4 clip = uProjection * vec4(rayView * t * uRadius, 1.0);
            depth = clip.z / clip.w * 0.5 + 0.5;
          }
          gl_FragDepthEXT = clamp(depth, 0.0, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    mesh.name = 'Earth satellite analytic sphere';
    mesh.frustumCulled = false;
    mesh.renderOrder = 0;
    scene.add(mesh);
    __satelliteEarthState = { mesh, U, qMatrix: new THREE.Matrix4(), eye: new THREE.Vector3(),
      ready: false, imageFailed: false };
    return __satelliteEarthState;
  }
  function __satelliteEarthUpdate(K) {
    if (!__satelliteEarthOn()) {
      if (__satelliteEarthState) __satelliteEarthState.mesh.visible = false;
      const credit=document.getElementById('earthImageryCredit');if(credit)credit.hidden=true;
      return;
    }
    const s = __satelliteEarthInit(), U = s.U;
    // CPU doubles perform the large heliocentric subtraction BEFORE float upload.
    s.eye.copy(origin).add(K.position).sub(EARTH.pos);
    const h = Math.max(0, s.eye.length() - R_EARTH) / R_EARTH;
    U.uEyeC.value = h * (2 + h);
    U.uEyeW.value.copy(s.eye);
    U.uEyeEF.value.copy(s.eye).applyQuaternion(QeInv).multiplyScalar(1 / R_EARTH);
    U.uWorldToEf.value.setFromMatrix4(s.qMatrix.makeRotationFromQuaternion(QeInv));
    // QeInv is the inverse of the same simulation Qe used by the camera.
    U.uSunEF.value.copy(sunDir).applyQuaternion(QeInv).normalize();
    K.updateMatrixWorld();
    U.uInvProjection.value.copy(K.projectionMatrix).invert();
    U.uProjection.value.copy(K.projectionMatrix);
    U.uCameraWorld.value.copy(K.matrixWorld);
    U.uLogFC.value = 2 / Math.log2(K.far + 1);
    U.uLogDepth.value = renderer.capabilities.logarithmicDepthBuffer ? 1 : 0;
    U.uCloudOn.value = typeof CLOUD_QUAD_ON === 'undefined' || CLOUD_QUAD_ON ? 1 : 0;
    const img = U.uSurface.value.image;
    s.ready = !!(img && (img.naturalWidth || img.width));
    s.mesh.visible = (2 * R_EARTH / Math.max(s.eye.length(), 1)) * sysPxPerRad >= 2.5;
    const credit=document.getElementById('earthImageryCredit');
    if(credit) credit.hidden=!s.mesh.visible || !!CS.active;
    // Late render hook wins over per-frame visibility setters and snapshot paths.
    terrainGroup.visible = false;
    vegGroup.visible = false;
    bldGroup.visible = false;
    cloudQuad.visible = false;
    cirrusQuad.visible = false;
  }
}

const RUNTIME = runtime.toString().slice(runtime.toString().indexOf('{') + 1, runtime.toString().lastIndexOf('}'));
function insertAtFunction(source, name, insertion) {
  const re = new RegExp('function\\s+' + name + '\\s*\\([^)]*\\)\\s*\\{');
  const m = re.exec(source);
  if (!m) throw new Error('Earth patch: missing function ' + name + ' (unsupported app; no output)');
  if (re.exec(source.slice(m.index + m[0].length))) throw new Error('Earth patch: ambiguous function ' + name);
  const at = m.index + m[0].length;
  return source.slice(0, at) + '\n' + insertion + '\n' + source.slice(at);
}
function transformApp(source) {
  if (typeof source !== 'string') throw new TypeError('transformApp(source) expects a string');
  if (source.includes(MARK)) return source;
  // Fail before returning anything if the host architecture differs.
  for (const anchor of ['const R_EARTH', 'const Qe', 'const QeInv', 'const origin',
    'const terrainMat', 'const terrainGroup', 'const vegGroup', 'const bldGroup',
    'const skyMat', 'const cloudQuad', 'const cirrusQuad']) {
    if (!source.includes(anchor)) throw new Error('Earth patch: missing host anchor ' + anchor);
  }
  let out = source;
  // terrainHeight is serialized into Worker source: PT is included, PTKey is not.
  out = insertAtFunction(out, 'terrainHeight',
    "  if (PT.id === 0) return 0; // satellite-only physical radius; Worker-safe PT binding");
  for (const [name, code] of [
    ['updateCamAbs', 'if (__satelliteEarthOn() && cam.focus === EARTH) cam.alt = Math.max(200, cam.alt);'],
    ['updateTerrain', 'if (__satelliteEarthOn()) { visible.length = 0; return 0; }'],
    ['requestBuild', 'if (__satelliteEarthOn()) return;'],
    ['pumpBuildQueue', 'if (__satelliteEarthOn()) return 0;'],
    ['pumpSyncFallback', 'if (__satelliteEarthOn()) return 0;'],
    ['updateVeg', 'if (__satelliteEarthOn()) { vegGroup.visible = false; return; }'],
    ['updateBuild', 'if (__satelliteEarthOn()) { bldGroup.visible = false; return; }'],
    ['updateVegShadow', 'if (__satelliteEarthOn()) { terrainMat.uniforms.uShadowOn.value = 0; return; }'],
    ['terrainLoaderOutcome', "if (__satelliteEarthOn()) return __satelliteEarthState && __satelliteEarthState.ready ? 'ready' : (elapsed > 8000 ? 'timeout' : null);"],
    ['terrainWatchdogInScope', 'if (__satelliteEarthOn()) return false;']
  ]) out = insertAtFunction(out, name, '  ' + code);
  const renderAnchor = 'const S = scRef || scene, K = camRef || camera;';
  if (out.split(renderAnchor).length !== 2) throw new Error('Earth patch: ambiguous renderFrame camera anchor');
  out = out.replace(renderAnchor, renderAnchor + '\n  if (S === scene) __satelliteEarthUpdate(K);');
  // Place before renderFrame so initialization precedes startup invocations.
  const at = out.indexOf('function renderFrame(');
  if (at < 0) throw new Error('Earth patch: missing renderFrame');
  return out.slice(0, at) + RUNTIME + '\n' + out.slice(at);
}
module.exports = { transformApp };
