'use strict';
const fs=require('node:fs'),p='public/js/app.js';let s=fs.readFileSync(p,'utf8');
const m=s.indexOf('"    float sigma = 0.85 * px;"'),a=s.lastIndexOf('\n',m)+1,b=s.lastIndexOf('\n',s.indexOf('"    // Only Earth',m))+1;
if(a<0||b<=a)throw Error('Expected V3 source anchors');
s=s.slice(0,a)+'            "    float edge = max(0.0, r - radius);",\n            "    // Radiance belongs solely to the depth-tested physical source, not a screen overlay.",\n'+s.slice(b);
fs.writeFileSync(p,s);
