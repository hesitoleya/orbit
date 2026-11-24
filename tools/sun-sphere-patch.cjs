'use strict';

/** Pure, fail-closed source transform. No files are read or written on require/call.
 * Apply to public/js/app.js, then use the normal build to regenerate formal HTML.
 * Also accepts the existing inline space.html for independent verification.
 * Marker: SUN_SPHERE_V1 (four scoped sections, idempotent).
 */
const MARKER = 'SUN_SPHERE_V1';

function once(source, pattern, replacement, label) {
  const matches = [...source.matchAll(new RegExp(pattern.source, 'g'))];
  if (matches.length !== 1) throw new Error(`${MARKER}: expected one ${label}, found ${matches.length}`);
  return source.replace(pattern, () => replacement);
}

const mesh = `/* SUN_SPHERE_V1: surface — true opaque sphere, local 3D texture, no billboard. */
const sunMesh = new THREE.Mesh(
  new THREE.SphereGeometry(R_SUN, 128, 80),
  new THREE.ShaderMaterial({
    uniforms: {
      uCol: { value: new THREE.Color(3000, 2910, 2760) },
      uSunTime: { value: 0 }
    },
    vertexShader: [
      '#include <common>',
      '#include <logdepthbuf_pars_vertex>',
      'varying vec3 vSunDir;',
      'varying vec3 vSunNormal;',
      'varying vec3 vSunView;',
      'void main() {',
      '  vSunDir = normalize(position);',
      '  vSunNormal = normalize(normalMatrix * normal);',
      '  vec4 vp = modelViewMatrix * vec4(position, 1.0);',
      '  vSunView = -vp.xyz;',
      '  gl_Position = projectionMatrix * vp;',
      '  #include <logdepthbuf_vertex>',
      '}'
    ].join('\\n'),
    fragmentShader: [
      'precision highp float;',
      '#include <logdepthbuf_pars_fragment>',
      'uniform vec3 uCol;',
      'uniform float uSunTime;',
      'varying vec3 vSunDir;',
      'varying vec3 vSunNormal;',
      'varying vec3 vSunView;',
      'vec3 sunHash(vec3 p) {',
      '  p = fract(p * vec3(0.1031, 0.1030, 0.0973));',
      '  p += dot(p, p.yxz + 33.33);',
      '  return fract((p.xxy + p.yxx) * p.zyx);',
      '}',
      'float sunNoise(vec3 p) {',
      '  vec3 i = floor(p), f = fract(p);',
      '  f = f * f * (3.0 - 2.0 * f);',
      '  return mix(mix(mix(sunHash(i).x, sunHash(i+vec3(1,0,0)).x, f.x),',
      '                 mix(sunHash(i+vec3(0,1,0)).x, sunHash(i+vec3(1,1,0)).x, f.x), f.y),',
      '             mix(mix(sunHash(i+vec3(0,0,1)).x, sunHash(i+vec3(1,0,1)).x, f.x),',
      '                 mix(sunHash(i+vec3(0,1,1)).x, sunHash(i+vec3(1,1,1)).x, f.x), f.y), f.z);',
      '}',
      // Distances in object-space 3D, not longitude/latitude or screen coordinates.
      'vec2 sunCells(vec3 p) {',
      '  vec3 i = floor(p), f = fract(p);',
      '  float d1 = 10.0, d2 = 10.0;',
      '  for (int z = -1; z <= 1; z++) {',
      '    for (int y = -1; y <= 1; y++) {',
      '      for (int x = -1; x <= 1; x++) {',
      '        vec3 o = vec3(float(x), float(y), float(z));',
      '        vec3 h = sunHash(i + o);',
      '        vec3 q = o + 0.5 + 0.65 * (h - 0.5) - f;',
      '        float d = dot(q, q);',
      '        d2 = min(d2, max(d1, d)); d1 = min(d1, d);',
      '      }',
      '    }',
      '  }',
      '  return sqrt(vec2(d1, d2));',
      '}',
      'float sunSpot(vec3 d, vec3 axis, float radius) {',
      '  float r = length(d - normalize(axis)) / radius;',
      '  float ragged = 0.90 + 0.18 * sunNoise(d * 190.0);',
      '  r *= ragged;',
      '  float pen = 1.0 - smoothstep(0.40, 1.0, r);',
      '  float umb = 1.0 - smoothstep(0.18, 0.42, r);',
      '  return 1.0 - 0.48 * pen - 0.43 * umb;',
      '}',
      'void main() {',
      '  #include <logdepthbuf_fragment>',
      '  vec3 d = normalize(vSunDir);',
      // Smooth periodic cell movement; no modulo snap. Spots stay attached to the body.
      '  vec3 drift = 0.65 * vec3(sin(uSunTime * 0.017), sin(uSunTime * 0.013 + 2.0), cos(uSunTime * 0.011));',
      '  vec3 p = d * 420.0 + drift;',
      '  float footprint = max(length(dFdx(p)), length(dFdy(p)));',
      '  float resolved = 1.0 - smoothstep(0.35, 1.4, footprint);',
      // Broad illustrative convection bands have their OWN antialiasing gates.
      '  float baseFootprint = max(length(dFdx(d)), length(dFdy(d)));',
      '  float lowResolved = 1.0 - smoothstep(0.35, 1.4, baseFootprint * 24.0);',
      '  float midResolved = 1.0 - smoothstep(0.35, 1.4, baseFootprint * 60.0);',
      '  float largeBand = 1.0 + 0.16 * (sunNoise(d * 24.0) - 0.5) * lowResolved;',
      '  float mediumBand = 1.0 + 0.12 * (sunNoise(d * 60.0) - 0.5) * midResolved;',
      '  float granule = 1.0;',
      '  if (resolved > 0.001) {',
      '    vec2 cell = sunCells(p);',
      '    float lane = smoothstep(0.018, 0.15, cell.y - cell.x);',
      '    granule = (0.80 + 0.28 * lane) * (0.96 + 0.08 * sunNoise(d * 155.0));',
      '  }',
      '  float textureK = largeBand * mediumBand * mix(1.0, granule, resolved);',
      '  float spot = 1.0;',
      '  spot *= sunSpot(d, vec3(0.93, 0.19, 0.31), 0.048);',
      '  spot *= sunSpot(d, vec3(0.90, 0.22, 0.38), 0.027);',
      '  spot *= sunSpot(d, vec3(-0.41, -0.23, 0.88), 0.040);',
      '  spot *= sunSpot(d, vec3(-0.47, -0.21, 0.85), 0.020);',
      '  spot *= sunSpot(d, vec3(0.22, 0.30, -0.93), 0.043);',
      '  spot *= sunSpot(d, vec3(-0.86, -0.16, -0.48), 0.033);',
      '  float mu = clamp(dot(normalize(vSunNormal), normalize(vSunView)), 0.0, 1.0);',
      // Quadratic limb darkening, not Lambert shading on a self-emissive star.
      '  float limb = 1.0 - 0.47 * (1.0 - mu) - 0.23 * (1.0 - mu) * (1.0 - mu);',
      '  vec3 limbTint = mix(vec3(1.0, 0.85, 0.66), vec3(1.0), sqrt(mu));',
      '  vec3 color = 0.45 * uCol * textureK * spot * limb * limbTint;',
      '  gl_FragColor = vec4(color, 1.0);',
      // Applied only on direct canvas render; RT keeps linear HDR for existing compositor.
      '  #include <tonemapping_fragment>',
      '  #include <colorspace_fragment>',
      '}'
    ].join('\\n'),
    extensions: { derivatives: true },
    toneMapped: true, fog: false, depthTest: true, depthWrite: true
  })
);
scene.add(sunMesh);`;

const point = `/* SUN_SPHERE_V1: distant LOD — unresolved source only; no 46px fake disc/flare. */
const sunPoint = new THREE.Points(
  new THREE.BufferGeometry().setAttribute('position',
    new THREE.Float32BufferAttribute([0, 0, 0], 3)),
  new THREE.ShaderMaterial({
    uniforms: { uCol: sunMesh.material.uniforms.uCol, uFlux:{value:1} },
    transparent: true, depthWrite: false, depthTest: true,
    blending: THREE.AdditiveBlending, toneMapped: true,
    vertexShader: [
      '#include <common>',
      '#include <logdepthbuf_pars_vertex>',
      'void main(){',
      '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
      '  #include <logdepthbuf_vertex>',
      '  gl_PointSize = 6.0;',
      '}'
    ].join('\\n'),
    fragmentShader: [
      '#include <logdepthbuf_pars_fragment>',
      'uniform vec3 uCol;',
      'uniform float uFlux;',
      'void main(){',
      '  #include <logdepthbuf_fragment>',
      '  float r = length(gl_PointCoord - 0.5) * 2.0;',
      '  if (r > 1.0) discard;',
      '  float a = exp(-0.5 * pow(r * 3.0 / 0.85, 2.0));',
      '  gl_FragColor = vec4(uCol * uFlux, a);',
      '  #include <tonemapping_fragment>',
      '  #include <colorspace_fragment>',
      '}'
    ].join('\\n')
  })
);
sunPoint.frustumCulled = false;
sunPoint.visible = false;
scene.add(sunPoint);`;

const placement = `  /* SUN_SPHERE_V1: placement — physical position, no pinned journey light. */
  sunMesh.position.copy(SUN.pos).sub(origin);
  sunHalo.position.copy(sunMesh.position);
  sunHalo.visible = false;
  sunPoint.position.copy(sunMesh.position);
  {
    const dSunCam = Math.max(sunMesh.position.length(), 1);
    const sunAngPx = (2 * R_SUN / dSunCam) * sysPxPerRad;
    sunMesh.visible = sunAngPx > 1.5 && NEB.active == null;
    sunPoint.visible = !sunMesh.visible && NEB.active == null;
    sunMesh.material.uniforms.uSunTime.value = now * 0.001;
    // Sidereal rotation about the solar axis; camera orbit remains the existing body control.
    sunMesh.rotation.y = (now * 0.001 / 2192832.0) * TAU;
  }
`;

function transformApp(source) {
  if (typeof source !== 'string') throw new TypeError('transformApp(source) requires a string');
  if (source.includes(MARKER)) {
    const sunCount=(source.match(/const sunMesh = new THREE\.Mesh\(/g)||[]).length;
    if(sunCount>1) throw new Error(`${MARKER}: expected one sun mesh, found ${sunCount}`);
    for (const section of ['surface', 'distant LOD', 'placement', 'solar lens gate']) {
      if (!source.includes(`${MARKER}: ${section}`)) throw new Error(`${MARKER}: incomplete prior patch (${section})`);
    }
    return source;
  }
  let out = once(source, /const sunMesh = new THREE\.Mesh\([\s\S]*?scene\.add\(sunMesh\);/, mesh, 'sun mesh');
  out = once(out, /const sunPoint = new THREE\.Points\([\s\S]*?scene\.add\(sunPoint\);/, point, 'sun point');
  out = once(out, /  sunMesh\.position\.copy\(SUN\.pos\)\.sub\(origin\);[\s\S]*?(?=  moonMesh\.position\.copy\(MOON\.pos\))/, placement, 'sun placement');
  out = once(out, /function updateSunGlare\(K\) \{/, `function updateSunGlare(K) {
  /* SUN_SPHERE_V1: solar lens gate — real projected Sun only; user-restored lens effects. */
`, 'solar lens gate');
  out = once(out, /scene\.add\(sunHalo\);/, 'scene.add(sunHalo);\nsunHalo.visible = false; // SUN_SPHERE_V1: retired solar billboard, kept for compatibility.', 'initial halo');
  out = once(out, /sunCol\.setRGB\(3\.2 \* tc\[0\], 2\.3 \* tc\[1\], 1\.35 \* tc\[2\]\);/, 'sunCol.setRGB(1.65 * tc[0], 1.47 * tc[1], 1.22 * tc[2]);', 'transmitted solar radiance');
  out = once(out, /sunCol\.setRGB\(3\.2, 2\.3, 1\.35\);/, 'sunCol.setRGB(1.65, 1.47, 1.22);', 'unattenuated solar radiance');
  return out;
}

module.exports = { transformApp, MARKER };
