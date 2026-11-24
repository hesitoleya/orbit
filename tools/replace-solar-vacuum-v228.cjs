'use strict';
const fs=require('node:fs'),p='public/js/app.js',s=fs.readFileSync(p,'utf8');
if(s.includes('SOLAR_VACUUM_V3'))throw Error('Already migrated');
const mark=s.indexOf('          /* Solar optics are screen-space'),end=s.lastIndexOf('\n',s.indexOf("'  c = acesFilmic(c);'",mark))+1;
if(mark<0||end<=mark)throw Error('Missing optics anchors');
const glsl=`  // SOLAR_VACUUM_V3: compact isotropic sensor PSF, no decorative lens features.
  if (uSunVis > 0.001 && uGlareK > 0.0) {
    vec2 d = (vUv - uSunUV) * vec2(uAspect2, 1.0);
    float px = max(uSunPixel, 0.00001);
    float r = length(d);
    float radius = max(0.0, uSunRadius);
    float sigma = 0.85 * px;
    float edge = max(0.0, r - radius);
    float resolved = smoothstep(1.0 * px, 3.0 * px, radius);
    float exterior = smoothstep(radius - px, radius + px, r);
    float pointPSF = exp(-0.5 * pow(r / sigma, 2.0));
    float edgePSF = exp(-0.5 * pow(edge / sigma, 2.0)) * exterior;
    float response = mix(pointPSF, edgePSF, resolved);
    float exposure = min(uSunEnergy, 20000.0);
    float radiance = mix(exposure, 0.35, resolved);
    c += uSunTint * response * radiance * uSunVis * min(uGlareK, 4.0);
    // Only Earth's atmospheric path creates a broad aerosol aureole; vacuum has none.
    float atmosphere = smoothstep(0.12, 0.85, uSunAtm);
    float aureole = exp(-edge / 0.045) * atmosphere * 0.035;
    c += uSunTint * aureole * uSunVis * min(uGlareK, 4.0);
  }
`;
const block='          /* Photographic Sun: physical disc plus compact finite-exposure response. */\n'+glsl.trimEnd().split('\n').map(x=>'           '+JSON.stringify(x)+',').join('\n')+'\n';
fs.writeFileSync(p,s.slice(0,mark)+block+s.slice(end));
