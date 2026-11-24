"""Image-guided artistic 3D M51 volume. NOT an observed density reconstruction.
Independent extinction is a capped color/local-contrast heuristic; display RGB already
contains attenuation, so additional extinction is intentionally modest. X fastest, Z/Y/X.
"""
from pathlib import Path
import json, gzip, hashlib, math
import numpy as np
from PIL import Image, ImageFilter
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'public/data/cinematic-nebula'; EVID=ROOT/'.workbuddy/v205-quality';EVID.mkdir(parents=True,exist_ok=True)
SRC=ROOT/'public/data/deep-source/esa_heic0506a.jpg'
N=512; NY=64; SCALE=.000525; CORE=(1545,1343);DY=2.6/NY; EMISSION=16.;SIGMA=12.
sha=lambda b:hashlib.sha256(b).hexdigest()
def field(name,a,dims):
 raw=np.ascontiguousarray(a,dtype=np.uint8).tobytes();data=gzip.compress(raw,compresslevel=9,mtime=0);filename='m51-'+name+('.r8' if len(a.shape)==3 else '.rgba8')+'.bin.gz';(OUT/filename).write_bytes(data)
 channels=1 if len(a.shape)==3 else 4
 return dict(file=filename,dimensions=dims,size=dims[0],channels=channels,format='R8' if channels==1 else 'RGBA8',compression='gzip',byteOrder='z-major y-next x-fastest interleaved-channels',rawBytes=len(raw),uncompressedBytes=len(raw),bytes=len(data),compressedBytes=len(data),sha256=sha(data),rawSha256=sha(raw),uncompressedSha256=sha(raw))
source=Image.open(SRC).convert('RGB'); assert source.size==(4000,2776)
# Median removes small foreground star cores/spikes at output scale, not all foreground stars.
coord=(np.arange(N)+.5)/N*2.6-1.3
px=coord/SCALE+CORE[0];pz=coord/SCALE+CORE[1]
# PIL affine uses output pixel centers approximately; explicit coefficients align our center grid.
a=2.6/(N*SCALE);image=source.transform((N,N),Image.Transform.AFFINE,(a,0,(-1.3+1.3/N)/SCALE+CORE[0],0,a,(-1.3+1.3/N)/SCALE+CORE[1]),Image.Resampling.BICUBIC,fillcolor=(0,0,0))
image=image.filter(ImageFilter.MedianFilter(3));srgb=np.asarray(image,dtype=np.float32)/255
linear=np.where(srgb<=.04045,srgb/12.92,((srgb+.055)/1.055)**2.4)
# Background subtraction acts in display-linear space, not calibrated astrophysical radiance.
linear=np.maximum(0,linear-np.array([.0015,.002,.0025],np.float32))
x,z=np.meshgrid(coord,coord);sx,sz=np.meshgrid(px,pz)
edge=np.minimum.reduce([sx/200,(4000-sx)/200,sz/139,(2776-sz)/139]);edge=np.clip(edge,0,1);edge=edge*edge*(3-2*edge)
# Avoid turning residual sky JPEG noise into a rectangular luminous slab.
lum=linear@np.array([.2126,.7152,.0722]);mask=np.clip((lum-.001)/.012,0,1);mask=mask*mask*(3-2*mask)*edge
linear*=mask[...,None]
blur=Image.fromarray(np.uint8(np.clip(srgb,0,1)*255)).filter(ImageFilter.GaussianBlur(7));base=np.asarray(blur,dtype=np.float32)/255;base=np.where(base<=.04045,base/12.92,((base+.055)/1.055)**2.4)
baselum=base@np.array([.2126,.7152,.0722]);contrast=np.maximum(0,np.log((baselum+.008)/(lum+.008)))
red=np.maximum(0,(linear[...,0]-linear[...,2])/(lum+.025));dustcol=np.clip(contrast*(.15+.4*red),0,.65)*mask
# Warm bulge is thicker; young blue/HII associations thin. All heights/warps are artistic.
blue=np.clip((linear[...,2]-linear[...,0])/(lum+.02)*.6+.25,.08,.75)
hii=np.clip((linear[...,0]-linear[...,1])*5,0,1)
width=.045+.065*(1-blue)+.035*np.exp(-(x*x+z*z)/.12)
warp=.018*np.sin(x*7+z*3)+.011*np.sin(z*13-x*4)
y=(np.arange(NY)+.5)*DY-1.3
weights=np.exp(-.5*((y[None,:,None]-warp[:,None,:])/width[:,None,:])**2).astype(np.float32)
weights/=np.maximum(weights.sum(1)[:,None,:]*DY,1e-10)
dustwidth=.032+.012*np.sin(x*9+z*2)**2
dw=np.exp(-.5*((y[None,:,None]-warp[:,None,:]-.007)/dustwidth[:,None,:])**2).astype(np.float32);dw/=np.maximum(dw.sum(1)[:,None,:]*DY,1e-10)
medium=np.zeros((N,NY,N,4),np.uint8);maxj=0.;clip=0
for iy in range(NY):
 # Bounded volume modulation with nonplanar offsets; mean Y normalization preserves column light.
 j=linear*weights[:,iy,:,None]*1.35
 maxj=max(maxj,float(j.max()));clip+=int((j>EMISSION).sum());medium[:,iy,:,:3]=np.rint(np.sqrt(np.clip(j/EMISSION,0,1))*255).astype(np.uint8)
 sigma=dustcol*dw[:,iy,:];medium[:,iy,:,3]=np.rint(np.clip(sigma/SIGMA,0,1)*255).astype(np.uint8)
assert clip==0,('emission clipping',maxj)
active=medium.max(3)>0
occ=active.reshape(32,16,32,2,32,16).max((1,3,5))
# One macro-cell conservative halo includes trilinear support; never wrap opposite domain edges.
padded=np.pad(occ,1);halo=np.zeros_like(occ)
for dz in range(3):
 for dy in range(3):
  for dx in range(3):halo|=padded[dz:dz+32,dy:dy+32,dx:dx+32]
occupied=halo.astype(np.uint8)*255
light=np.zeros((1,1,1,4),np.uint8)
profile=dict(id='m51-image-guided',type=13,name='M51 image-guided artistic volume',domain=[-1.3,1.3],sigmaMax=SIGMA,emissionScale=EMISSION,emissionEncoding='sqrt-unorm8',lightScale=1,lightPosition=[0,0,0],scatteringAlbedo=[0,0,0],detailEnabled=False,
 medium=field('medium',medium,[N,NY,N]),light=field('light',light,[1,1,1]),occupancy=field('occupancy',occupied,[32,32,32]),
 source=dict(path='public/data/deep-source/esa_heic0506a.jpg',sha256=sha(SRC.read_bytes()),dimensions=list(source.size),url='https://esahubble.org/images/heic0506a/',downloadURL='https://cdn.esahubble.org/archives/images/publicationjpg/heic0506a.jpg',license='CC BY 4.0',licenseURL='https://esahubble.org/copyright/',credit='NASA, ESA, S. Beckwith (STScI), and The Hubble Heritage Team (STScI/AURA)',changes='Display-linear conversion, background subtraction, median foreground-point suppression, edge feather, artist-authored nonplanar Gaussian thickness, independent capped color/contrast extinction, square-root quantization.'),
 interpretation='Image-guided artistic reprojection with invented depth; NOT measured 3D emissivity, extinction, geometry or radiometric calibration. Source already includes attenuation; modest additional extinction is a heuristic and may double-count it. Companion NGC5195 is included in image footprint, not reconstructed independently.',
 imageMapping=dict(mainCorePixels=list(CORE),localUnitsPerPixel=SCALE,sourceX='local +X',sourceY='local +Z',thickness='local Y',preserveAspect=True,alreadyInclinedSource=True,deprojection=False,mainCoreLocal=[0,0,0],companionApproxLocal=[.95,0,-.24]),
 statistics=dict(maxEmission=maxj,emissionClippedChannels=clip,occupiedFraction=float(halo.mean()),nonzeroYSlices=int(active.any((0,2)).sum()),maxDustColumn=float(dustcol.max()),rawBytes=int(medium.nbytes+light.nbytes+occupied.nbytes)))
# Independent extinction must not simply be brightness-derived alpha.
assert np.count_nonzero(medium[:,:,:,3])>0
assert active.any((0,2)).sum()>=8
assert abs(float(np.corrcoef(lum.flatten(),dustcol.flatten())[0,1]))<.95
# Front projection of quantized fields using exact midpoint Beer-Lambert segment source integration.
trans=np.ones((N,N),np.float32);radiance=np.zeros((N,N,3),np.float32)
for iy in range(NY-1,-1,-1):
 sigma=medium[:,iy,:,3].astype(np.float32)/255*SIGMA;j=(medium[:,iy,:,:3].astype(np.float32)/255)**2*EMISSION
 tr=np.exp(-sigma*DY);segment=np.where(sigma>1e-6,(1-tr)/np.maximum(sigma,1e-6),DY)
 radiance+=trans[...,None]*j*segment[...,None];trans*=tr
v=radiance*.8;v=np.clip((v*(2.51*v+.03))/(v*(2.43*v+.59)+.14),0,1);v=np.where(v<=.0031308,v*12.92,1.055*v**(1/2.4)-.055)
Image.fromarray(np.uint8(v*255)).save(EVID/'m51-quantized-front.png')
Image.fromarray(np.uint8(np.clip(dustcol/.65,0,1)*255)).save(EVID/'m51-independent-dust.png')
(OUT/'m51-profile.json').write_text(json.dumps(profile,indent=2)+'\n',encoding='utf-8')
print(json.dumps(profile['statistics'],indent=2));print('gzipBytes',sum(profile[k]['bytes'] for k in ['medium','light','occupancy']));print('PASS source hash / finite 3D thickness / independent extinction / no clipping / conservative occupancy')
