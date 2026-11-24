'use strict';
const fs=require('node:fs'),p='public/js/app.js',s=fs.readFileSync(p,'utf8');
if(s.includes('SOLAR_OPTICS_V2'))throw Error('One-shot historical migration already applied; do not overwrite later refinements');
const mark=s.indexOf('/* ---- 对话 100：太阳眩光'),a=s.lastIndexOf('\n',mark)+1,b=s.lastIndexOf('\n',s.indexOf("'  c = acesFilmic(c);'",mark))+1;
if(a<0||b<=a)throw Error('solar compositing anchors unavailable');
const glsl=`  // SOLAR_OPTICS_V2: bounded HDR point-spread, no whole-frame gain loss.
  if (uSunVis > 0.001 && uGlareK > 0.0) {
    vec2 d = (vUv - uSunUV) * vec2(uAspect2, 1.0);
    float r = length(d);
    float px = max(uSunPixel, 0.00001);
    float radius = max(uSunRadius, px * 1.4);
    float edge = max(0.0, r - radius);
    float energy = clamp(uSunEnergy, 0.0, 1.0);
    float gain = uSunVis * min(uGlareK, 4.0) * energy;
    float atmosphere = smoothstep(0.12, 0.85, uSunAtm);
    float coreWidth = max(2.2 * px, radius * 0.10);
    float core = exp(-pow(edge / coreWidth, 2.0));
    float shoulder = exp(-edge / max(6.0 * px, 0.008));
    float skirt = exp(-edge / 0.035) / (1.0 + edge * 35.0);
    float aureole = exp(-edge / 0.105) * atmosphere;
    vec3 warm = uSunTint * vec3(1.00, 0.90, 0.72);
    vec3 glow = uSunTint * core * 2.4 + warm * (shoulder * 0.38 + skirt * 0.12 + aureole * 0.055);
    c += glow * gain;
    if (uStarK > 0.001) {
      // Even/odd aperture diffraction: odd blade counts produce twice as many rays.
      float rays = mod(uBlades, 2.0) > 0.5 ? uBlades * 2.0 : uBlades;
      float angle = atan(d.y, d.x) + 0.13;
      float angularWidth = mix(52.0, 220.0, smoothstep(0.005, 0.24, edge));
      float aperture = pow(abs(cos(angle * rays * 0.5)), angularWidth);
      float tail = exp(-edge / 0.22) / (1.0 + edge * 28.0);
      float streakWidth = max(0.75 * px, 0.0012);
      float streak = exp(-pow(d.y / streakWidth, 2.0)) * exp(-abs(d.x) / 0.25);
      float outer = smoothstep(radius * 0.7, radius + 2.0 * px, r);
      c += (warm * aperture * tail * 0.48 + vec3(0.36, 0.55, 0.80) * streak * 0.075)
        * outer * gain * min(uStarK, 3.0);
    }
    if (uGhost > 0.5) {
      vec2 axis = vec2(0.5) - uSunUV;
      float offAxis = smoothstep(0.035, 0.28, length(axis));
      // No central target rings. Only two very faint off-axis coated-lens ghosts.
      for (int i = 1; i <= 2; i++) {
        float fi = float(i);
        vec2 ghostCenter = vec2(0.5) + axis * (0.55 + 0.45 * fi);
        float gr = length((vUv - ghostCenter) * vec2(uAspect2, 1.0));
        float ghostRadius = 0.014 + fi * 0.012;
        float ring = exp(-pow((gr - ghostRadius) / max(1.5 * px, 0.0015), 2.0));
        c += vec3(0.45, 0.65, 0.80) * ring * (0.006 / fi) * gain * offAxis;
      }
    }
  }
`;
const block='          /* Solar optics are screen-space lens response, not a physical corona. */\n'+glsl.trimEnd().split('\n').map(x=>'           '+JSON.stringify(x)+',').join('\n')+'\n';
fs.writeFileSync(p,s.slice(0,a)+block+s.slice(b));
