"""Photo-constrained optically thin emissivity. Depth is a disk/bulge prior,
not inferred stellar distances. Public ESO/S.Brunier eso0932a CC BY4.0.
Original photo unchanged; derived diffuse color + directional normalization.
"""
from pathlib import Path
import hashlib,json
import numpy as np
from PIL import Image, ImageFilter
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'public/data/sky'
source=OUT/'eso0932a-source.jpg'
image=Image.open(source).convert('RGB')
# Separate diffuse structure from unresolved stellar point texture. No new arms/noise.
diffuse=image.resize((2048,1024),Image.Resampling.LANCZOS).filter(ImageFilter.GaussianBlur(1.25))
diffuse.save(OUT/'mw-photo-diffuse.png',optimize=True)
W,H=1024,512
u=(np.arange(W,dtype=np.float32)+.5)/W
v=1-(np.arange(H,dtype=np.float32)+.5)/H
lon=(.5-u)*2*np.pi
lat=(v-.5)*np.pi
cl=np.cos(lat)[:,None]
dx=-cl*np.cos(lon)[None,:]
dy=np.broadcast_to(np.sin(lat)[:,None],(H,W))
dz=-cl*np.sin(lon)[None,:]
SUN=8.15*3.0856775814913673e19/5e20
norm=np.zeros((H,W),np.float32)
N=512
for i in range(N):
 t=(i+.5)*2.6/N
 x=SUN+dx*t; y=dy*t; z=dz*t
 r=np.sqrt(x*x+z*z)
 disk=np.exp(-r*3.2)*np.exp(-np.abs(y)/(.018+.035*r))
 bulge=1.4*np.exp(-np.sqrt((x/.22)**2+(y/.12)**2+(z/.22)**2)*4)
 # Compact, smooth edge so outside views never hit a hard galaxy wall.
 edge=np.clip((1.15-r)/.15,0,1);edge=edge*edge*(3-2*edge)
 height=np.clip((.5-np.abs(y))/.15,0,1);height=height*height*(3-2*height)
 norm+=(disk+bulge)*edge*height*(2.6/N)
encoded=np.uint8(np.clip((np.log2(np.maximum(norm,2**-12))+12)/16,0,1)*255+.5)
Image.fromarray(encoded).save(OUT/'mw-photo-normalization.png',optimize=True)
manifest={
 'version':1,'source':'ESO/S. Brunier · eso0932a','sourceURL':'https://www.eso.org/public/images/eso0932a/',
 'license':'CC BY 4.0','licenseURL':'https://creativecommons.org/licenses/by/4.0/',
 'sourceSHA256':hashlib.sha256(source.read_bytes()).hexdigest(),
 'method':'Single-view photo-constrained optically thin 3D emissivity; disk/bulge depth prior, NOT measured tomography or stellar distances',
 'radiusMeters':5e20,'sunLocal':[SUN,0,0],'prior':'exp(-R*3.2)*exp(-abs(y)/(.018+.035*R))+1.4*exp(-length(p/(.22,.12,.22))*4), smooth compact radial/height edges',
 'normalization':{'file':'mw-photo-normalization.png','width':W,'height':H,'steps':N,'pathLength':2.6,'decode':'exp2(red*16-12)','min':float(norm.min()),'max':float(norm.max())},
 'color':{'file':'mw-photo-diffuse.png','width':2048,'height':1024,'filter':'Lanczos resize then Gaussian sigma1.25px; diffuse structure, not individual star distances'},
 'limitations':['Depth unidentifiable from one sky image.','Optically thin emissivity only: observed dark lanes are low emissivity, not recovered physical dust extinction.','Volume viewed externally uses a modeled depth prior, not an external photograph.']}
for key in ['color','normalization']:
 f=OUT/manifest[key]['file'];manifest[key]['sha256']=hashlib.sha256(f.read_bytes()).hexdigest();manifest[key]['bytes']=f.stat().st_size
(OUT/'mw-photo-volume.json').write_text(json.dumps(manifest,indent=2,ensure_ascii=False)+'\n',encoding='utf8')
print(json.dumps(manifest,indent=2,ensure_ascii=False))
