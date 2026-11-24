/* Shared numerical contract for the isolated, axis-aligned ROI GPU laboratory. */
(function(root){
'use strict';
const DOMAIN=1.3,GRID=32;
function weight(p,lo,hi,feather){let w=1;for(let k=0;k<3;k++){const d=Math.min(p[k]-lo[k],hi[k]-p[k]);let t=Math.max(0,Math.min(1,d/feather));w*=t*t*(3-2*t);}return w;}
function replace(base,fine,w){return base.map((x,k)=>x*(1-w)+fine[k]*w);}
// Conservative encoded-nonzero union. Nearest macro texture and one-cell halo
// cover both trilinear footprints and misaligned ROI edges. Never threshold faint RGB.
function occupancy(base,brick,lo,hi){
 const grid=new Uint8Array(GRID**3);
 function add(raw,min,max){
  const map=Array.from({length:3},(_,k)=>Array.from({length:256},(_,i)=>Math.max(0,Math.min(31,Math.floor(((min[k]+(i+.5)*(max[k]-min[k])/256)+DOMAIN)/(2*DOMAIN)*GRID)))));
  for(let z=0;z<256;z++)for(let y=0;y<256;y++){const row=(map[2][z]*32+map[1][y])*32;for(let x=0;x<256;x++){const i=((z*256+y)*256+x)*4;if(raw[i]|raw[i+1]|raw[i+2]|raw[i+3])grid[row+map[0][x]]=255;}}
 }
 if(base)add(base,[-DOMAIN,-DOMAIN,-DOMAIN],[DOMAIN,DOMAIN,DOMAIN]);if(brick)add(brick,lo,hi);
 const dilated=grid.slice();for(let z=0;z<32;z++)for(let y=0;y<32;y++)for(let x=0;x<32;x++)if(grid[(z*32+y)*32+x])for(let dz=-1;dz<=1;dz++)for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const a=x+dx,b=y+dy,c=z+dz;if(a>=0&&a<32&&b>=0&&b<32&&c>=0&&c<32)dilated[(c*32+b)*32+a]=255;}
 return dilated;
}
function unionOccupancy(a,b){if(!a||a.length!==GRID**3||b&&b.length!==a.length)throw Error('Invalid occupancy grid');const out=a.slice();if(b)for(let i=0;i<out.length;i++)out[i]=a[i]|b[i];return out;}
function plan(x,y,lo,hi,fine){let z=DOMAIN,segments=[];while(z>-DOMAIN+1e-10){const inXY=fine&&x>=lo[0]&&x<=hi[0]&&y>=lo[1]&&y<=hi[1];let ds=2*DOMAIN/256;if(inXY){if(z>hi[2])ds=Math.min(ds,z-hi[2]);else if(z>lo[2])ds=Math.min((hi[2]-lo[2])/512,z-lo[2]);}ds=Math.min(ds,z+DOMAIN);if(ds<=1e-12)throw Error('Zero segment');segments.push({z:z-ds*.5,ds});z-=ds;if(segments.length>1536)throw Error('Budget exhausted');}return segments;}
const api={DOMAIN,GRID,weight,replace,occupancy,unionOccupancy,plan};if(typeof module!=='undefined')module.exports=api;else root.ROILabKernel=api;
})(typeof window==='undefined'?globalThis:window);
