'use strict';
const fs=require('node:fs');const p='public/js/app.js';let s=fs.readFileSync(p,'utf8');
function range(start,end,repl,label){const a=s.indexOf(start),b=s.indexOf(end,a);if(a<0||b<0)throw Error(label+' anchors');s=s.slice(0,a)+repl+s.slice(b);}
range("  '    vec3 a = -1.5 * h2 * pos / (r2 * r2 * r);',","  '      float al = 0.0;',",`   '    vec3 a0 = -1.5 * h2 * pos / (r2 * r2 * r);',
   '    dt = min(dt, 0.08 * max(length(vel), 0.05) / max(length(a0), 0.00001));',
   '    vec3 prev = pos;',
   '    vec3 pm = pos + 0.5 * dt * vel;',
   '    vec3 vm = vel + 0.5 * dt * a0;',
   '    float pm2 = max(dot(pm, pm), 0.000001);',
   '    vec3 am = -1.5 * h2 * pm / (pm2 * pm2 * sqrt(pm2));',
   '    pos += dt * vm;',
   '    vel += dt * am;',
   /* 与盘面（y=0）求交，包含恰好落在平面的边界情况 */
   '    bool crosses = (prev.y > 0.0 && pos.y <= 0.0) || (prev.y < 0.0 && pos.y >= 0.0);',
   '    if (crosses) {',
   '      float den = prev.y - pos.y;',
   '      float k = abs(den) > 0.000001 ? prev.y / den : 0.0;',
   '      vec3 hit = mix(prev, pos, clamp(k, 0.0, 1.0));',
`,'RK2');
const ra=s.indexOf("  /* 光子环：");const rb=s.indexOf("\n\n  /* 曝光 + ACES",ra);if(ra<0||rb<0)throw Error('ring anchors');s=s.slice(0,ra)+"  /* Photon-ring brightness comes only from transported disk crossings. */"+s.slice(rb);
const grain="   '  x += gr * 0.012;',";if(s.includes(grain))s=s.replace(grain,"   '  x += gr * 0.007 * smoothstep(0.001, 0.04, dot(acc, vec3(0.333333)));',");
fs.writeFileSync(p,s);
