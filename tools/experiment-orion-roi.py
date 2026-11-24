"""Isolated same-author-field ROI brick; no production writes, no GPU acceptance.
Evaluates the existing Orion author field at four times the production spatial density.
Array convention z,y,x,RGBA. CPU pure-emission/absorption preview excludes scattering/stars.
"""
from pathlib import Path
import importlib.util,json,gzip,hashlib,time
import numpy as np
from PIL import Image,ImageDraw
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'.workbuddy/v208-roi';OUT.mkdir(parents=True,exist_ok=True)
spec=importlib.util.spec_from_file_location('author',ROOT/'tools/bake-cinematic-nebula.py');b=importlib.util.module_from_spec(spec);spec.loader.exec_module(b)
m=json.loads((ROOT/'public/data/cinematic-nebula/manifest.json').read_text());p=next(q for q in m['profiles'] if q['id']=='orion')
lo=np.array([-.62,-.42,-.65],np.float32);extent=np.float32(.65);hi=lo+extent
assert p['medium']['dimensions']==[256,256,256]
assert np.all(lo>=-b.DOMAIN) and np.all(hi<=b.DOMAIN)
assert p['emissionEncoding']=='sqrt-unorm8'
original_grid=b.grid

def roi_grid(n):
 a=(np.arange(n,dtype=np.float32)+.5)*extent/n
 z,y,x=np.meshgrid(a+lo[2],a+lo[1],a+lo[0],indexing='ij');return x,y,z
b.grid=roi_grid
start=time.monotonic();n=256
try:rgb,sigma=b.field('orion',n=n,seed=p['seed'])
finally:b.grid=original_grid
# 4x spatial-density reference within a bounded .65 cube, 64MiB UNORM8 candidate.
medium=np.empty((n,n,n,4),np.uint8)
medium[...,:3]=np.rint(np.clip(rgb/p['emissionScale'],0,1)**.5*255).astype(np.uint8)
medium[...,3]=np.rint(np.clip(sigma/p['sigmaMax'],0,1)*255).astype(np.uint8)
packed=gzip.compress(medium.tobytes(),compresslevel=6,mtime=0)
(OUT/'orion-roi-256.rgba8.bin.gz').write_bytes(packed)
# Compare float-field full resolution with a 4x4x4 box-average restriction
# at global-equivalent spacing. This is NOT the deployed texture or its lattice.
def restrict(a):
 shape=(64,4,64,4,64,4)+a.shape[3:]
 return a.reshape(shape).mean(axis=(1,3,5))
low_rgb=restrict(rgb);low_sigma=restrict(sigma)
# Cell-centre trilinear reconstruction rather than nearest-neighbour upscale.
def up(a):
 result=a
 for axis in range(3):
  coord=(np.arange(256)+.5)/4-.5;idx=np.floor(coord).astype(int);t=coord-idx
  l=np.take(result,np.clip(idx,0,63),axis=axis);r=np.take(result,np.clip(idx+1,0,63),axis=axis)
  shape=[1]*a.ndim;shape[axis]=256;w=t.reshape(shape)
  result=(l*(1-w)+r*w).astype(np.float32)
 return result
coarse_rgb=up(low_rgb);coarse_sigma=up(low_sigma)
# Front-to-back exact homogeneous segment transfer, same ds for both data sets.
def render(j,s):
 tr=np.ones((256,256),np.float32);out=np.zeros((256,256,3),np.float32);ds=float(extent)/256
 for z in range(255,-1,-1):
  trans=np.exp(-s[z]*ds);segment=np.where(s[z]>1e-6,-np.expm1(-s[z]*ds)/np.maximum(s[z],1e-6),ds)
  out+=tr[...,None]*j[z]*segment[...,None];tr*=trans
 return out
fine=render(rgb,sigma);coarse=render(coarse_rgb,coarse_sigma)
# Separate delivered-brick preview: acknowledge clamping/quantization rather than
# claiming the float author reference equals the bytes sent to a future GPU.
packed_rgb=(medium[...,:3].astype(np.float32)/255)**2*p['emissionScale']
packed_sigma=medium[...,3].astype(np.float32)/255*p['sigmaMax']
packed_frame=render(packed_rgb,packed_sigma)
packed_linear=packed_frame*5
packed_srgb=np.where(packed_linear<=.0031308,packed_linear*12.92,1.055*np.maximum(packed_linear,0)**(1/2.4)-.055)
Image.fromarray(np.rint(np.clip(packed_srgb,0,1)*255).astype(np.uint8)).transpose(Image.Transpose.FLIP_TOP_BOTTOM).save(OUT/'orion-roi-packed-cpu.png')
# Actual deployed RGBA8 sampled using the shader's encoded-linear/square order.
source_bytes=gzip.decompress((ROOT/'public/data/cinematic-nebula'/p['medium']['file']).read_bytes())
assert hashlib.sha256(source_bytes).hexdigest()==p['medium']['rawSha256']
source=np.frombuffer(source_bytes,np.uint8).reshape(256,256,256,4)
a=(np.arange(256,dtype=np.float32)+.5)*extent/256
py,px=np.meshgrid(a+lo[1],a+lo[0],indexing='ij')
assert np.allclose(px[0,:],a+lo[0]) and np.allclose(py[:,0],a+lo[1])
deployed=np.zeros((256,256,3),np.float32);transmit=np.ones((256,256),np.float32);ds=float(extent)/256
for zi in range(255,-1,-1):
 pz=np.full_like(px,a[zi]+lo[2]);s=b.sample(source[...,3],px,py,pz)/255*p['sigmaMax']
 emission=np.stack([b.sample(source[...,c],px,py,pz)/255 for c in range(3)],axis=-1)**2*p['emissionScale']
 tr=np.exp(-s*ds);segment=-np.expm1(-s*ds)/np.maximum(s,1e-6);segment=np.where(s>1e-6,segment,ds)
 deployed+=transmit[...,None]*emission*segment[...,None];transmit*=tr
pair=Image.new('RGB',(1280,690),(6,10,16));pd=ImageDraw.Draw(pair)
for col,(image,title) in enumerate([(deployed,'Deployed global 256 RGBA8 / trilinear encoded'),(packed_frame,'Candidate ROI 256 RGBA8 / local 4x density')]):
 linear=image*5;srgb=np.where(linear<=.0031308,linear*12.92,1.055*np.maximum(linear,0)**(1/2.4)-.055)
 im=Image.fromarray(np.rint(np.clip(srgb,0,1)*255).astype(np.uint8)).transpose(Image.Transpose.FLIP_TOP_BOTTOM)
 pair.paste(im.resize((640,640),Image.Resampling.NEAREST),(640*col,34));pd.text((640*col+10,10),title,fill='white')
pd.text((10,675),'CPU only / same bounds, fixed exposure, ds; no lighting, stars, detail tile or GPU. Candidate sampled at voxel centres.',fill=(210,215,225))
pair.save(OUT/'orion-deployed-vs-roi-cpu.png')
canvas=Image.new('RGB',(1280,690),(6,10,16));draw=ImageDraw.Draw(canvas)
# Fixed common exposure, no per-image autoscale/sharpening; CPU diagnostic only.
for col,(image,title) in enumerate([(coarse,'64^3 box-filter reference / global-equivalent spacing'),(fine,'256^3 ROI / effective global 1024 spacing')]):
 linear=image*5;srgb=np.where(linear<=.0031308,linear*12.92,1.055*np.maximum(linear,0)**(1/2.4)-.055)
 im=Image.fromarray(np.rint(np.clip(srgb,0,1)*255).astype(np.uint8)).transpose(Image.Transpose.FLIP_TOP_BOTTOM)
 canvas.paste(im.resize((640,640),Image.Resampling.NEAREST),(640*col,34));draw.text((640*col+10,10),title,fill='white')
draw.text((10,675),'CPU emissivity/extinction diagnostic only; no scattering, lighting cache, stars or GPU. Same field, bounds, exposure.',fill=(210,215,225))
canvas.save(OUT/'orion-roi-cpu-comparison.png')
report={'profile':'orion','seed':p['seed'],'bounds':{'min':lo.tolist(),'max':hi.tolist()},'dimensions':[256]*3,'effectiveGlobalResolution':1024,'voxelSpacing':float(extent/256),'coarseSpacing':float(extent/64),'nyquistCyclesPerLocalUnit':float(128/extent),'rawBytes':int(medium.nbytes),'compressedBytes':len(packed),'rawSha256':hashlib.sha256(medium.tobytes()).hexdigest(),'sha256':hashlib.sha256(packed).hexdigest(),'emissionScale':p['emissionScale'],'sigmaMax':p['sigmaMax'],'encoding':'sqrt-unorm8 RGB / linear alpha','renderLinearMAE':float(np.abs(fine-coarse).mean()),'packedRenderMAE':float(np.abs(packed_frame-fine).mean()),'deployedVsCandidateMAE':float(np.abs(packed_frame-deployed).mean()),'sourceMediumRawSha256':p['medium']['rawSha256'],'maxEmissionBeforeClip':float(rgb.max()),'gradientUnits':'Mean abs x difference per fine texel, index-space diagnostic only, not physical gradient or quality acceptance.','emissionClampedComponentFraction':float(np.mean(rgb>p['emissionScale'])),'comparisonReference':'Coarse is 4x4x4 float voxel-average restriction of fine author field, reconstructed at cell centres. Not the deployed global point-sampled UNORM field. Float CPU transport plus separate packed-byte CPU preview; no scattering.','fineSigmaGradientMean':float(np.mean(np.abs(np.diff(sigma,axis=2)))),'coarseSigmaGradientMean':float(np.mean(np.abs(np.diff(coarse_sigma,axis=2)))),'seconds':round(time.monotonic()-start,2),'license':'Original mathematical Orion author field CC0; no external imagery. Depth/density artistic, not measured.','acceptance':'Offline experimental brick, not included in production manifest or runtime; no GPU validation. Fourfold sample density is not proof of band limitation or cinematic quality.'}
(OUT/'report.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
