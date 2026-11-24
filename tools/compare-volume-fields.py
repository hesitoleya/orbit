"""Matched CPU orthographic transport comparison; explicitly NOT browser/GPU acceptance."""
from pathlib import Path
import json,gzip
import numpy as np
from PIL import Image,ImageDraw
ROOT=Path(__file__).resolve().parents[1]
OLD=ROOT/'.workbuddy/v203-volume-backup'
NEW=ROOT/'public/data/cinematic-nebula'
OUT=ROOT/'.workbuddy/v203-quality'
F=np.float32

def load(base,profile):
 m=json.loads((base/'manifest.json').read_text(encoding='utf8'));p=next(p for p in m['profiles'] if p['id']==profile);a={}
 for role in ('medium','light','shading'):
  if role not in p:continue
  d=p[role];a[role]=np.frombuffer(gzip.decompress((base/d['file']).read_bytes()),dtype=np.uint8).reshape((*d['dimensions'][::-1],d['channels'])).astype(F)/255
 return p,a

def sample(a,x,y,z,nearest=False):
 n=a.shape[0];ix=np.clip((x+1.3)/2.6*n-.5,0,n-1);iy=np.clip((y+1.3)/2.6*n-.5,0,n-1);iz=np.clip((z+1.3)/2.6*n-.5,0,n-1)
 if nearest:return a[np.rint(iz).astype(int),np.rint(iy).astype(int),np.rint(ix).astype(int)]
 i=np.floor(ix).astype(int);j=np.floor(iy).astype(int);k=np.floor(iz).astype(int);tx=(ix-i)[...,None];ty=(iy-j)[...,None];tz=(iz-k)[...,None];out=np.zeros(x.shape+(a.shape[-1],),dtype=F)
 for dz in (0,1):
  for dy in (0,1):
   for dx in (0,1):out+=a[np.minimum(k+dz,n-1),np.minimum(j+dy,n-1),np.minimum(i+dx,n-1)]*(tz if dz else 1-tz)*(ty if dy else 1-ty)*(tx if dx else 1-tx)
 return out

def octdecode(e):
 f=e*2-1;n=np.concatenate([f,(1-np.abs(f).sum(axis=-1))[...,None]],axis=-1);mask=n[...,2]<0
 folded=(1-np.abs(f[...,::-1]))*np.where(f>=0,1,-1);n[...,:2]=np.where(mask[...,None],folded,f);return n/np.maximum(np.linalg.norm(n,axis=-1,keepdims=True),1e-6)

def render(p,a,n=320,steps=384):
 axis=(np.arange(n,dtype=F)+.5)*2.6/n-1.3;x,y=np.meshgrid(axis,axis);trans=np.ones_like(x);L=np.zeros(x.shape+(3,),dtype=F);ds=2.6/steps
 for i in range(steps):
  z=np.full_like(x,1.3-(i+.5)*ds);field=sample(a['medium'],x,y,z);sigma=field[...,3]*p['sigmaMax'];j=(field[...,:3]**2 if p.get('emissionEncoding')=='sqrt-unorm8' else field[...,:3])*p['emissionScale'];incident=sample(a['light'],x,y,z)[...,:3]*p['lightScale']
  v=np.stack([x-p['lightPosition'][0],y-p['lightPosition'][1],z-p['lightPosition'][2]],axis=-1);v/=np.maximum(np.linalg.norm(v,axis=-1,keepdims=True),1e-6);response=1
  if 'shading' in a:
   s=sample(a['shading'],x,y,z,True);normal=octdecode(s[...,:2]);v=octdecode(s[...,2:]);response=.65+.70*np.maximum(0,np.sum(normal*-v,axis=-1))
  mu=v[...,2];phase=(1-.28**2)/(4*np.pi*(1+.28**2-2*.28*mu)**1.5);j=j+sigma[...,None]*np.array(p.get('scatteringAlbedo',[.55,.55,.55]),dtype=F)*incident*(phase*response)[...,None]
  tr=np.exp(-sigma*ds);segment=np.divide(1-tr,sigma,out=np.full_like(sigma,ds),where=sigma>1e-5);L+=trans[...,None]*j*segment[...,None];trans*=tr
 # Same display transform/exposure for both assets; no bloom, grain, sharpening.
 c=np.clip((L*(2.51*L+.03))/(L*(2.43*L+.59)+.14),0,1);c=np.where(c<=.0031308,c*12.92,1.055*c**(1/2.4)-.055)
 return Image.fromarray(np.uint8(np.flipud(c)*255))

def main():
 OUT.mkdir(parents=True,exist_ok=True);rows=[]
 for name in ('orion','pillars'):
  images=[]
  for base,label in ((OLD,'v202'),(NEW,'v203')):
   p,a=load(base,name);im=render(p,a);im.save(OUT/f'{name}-{label}-cpu.png');images.append((im,label,p['medium']['dimensions'][0]))
  canvas=Image.new('RGB',(960,510),(5,9,14));draw=ImageDraw.Draw(canvas)
  for i,(im,label,size) in enumerate(images):
   draw.text((12+i*480,8),f'{name} {label} / CPU orthographic / field {size}^3',fill=(220,229,239));canvas.paste(im.resize((480,480),Image.Resampling.NEAREST),(i*480,30))
  canvas.save(OUT/f'{name}-comparison.png');rows.append(canvas)
 contact=Image.new('RGB',(960,1020));contact.paste(rows[0],(0,0));contact.paste(rows[1],(0,510));contact.save(OUT/'cpu-field-comparison.png');print(OUT/'cpu-field-comparison.png')
if __name__=='__main__':main()
