"""Decode actual cache bytes and replay CPU transfer; no GPU/production claims."""
import importlib.util,json,gzip,hashlib,time
from pathlib import Path
import numpy as np
from PIL import Image,ImageDraw

def load(path,name):
 s=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
C=load('tools/roi-light-common.py','common');B=load('tools/bake-cinematic-nebula.py','baker');root=Path('.workbuddy/v210-roi-light');report=json.loads((root/'report.json').read_text());r=json.loads(Path('.workbuddy/v208-roi/report.json').read_text());p=next(p for p in json.loads(Path('public/data/cinematic-nebula/manifest.json').read_text())['profiles'] if p['id']=='orion');lo=np.array(r['bounds']['min'],np.float32);hi=np.array(r['bounds']['max'],np.float32)
assert r['sourceMediumRawSha256']==p['medium']['rawSha256'];assert r['sigmaMax']==12 and r['emissionScale']==8

def data(path,compressed,raw):
 gz=Path(path).read_bytes();assert hashlib.sha256(gz).hexdigest()==compressed;buf=gzip.decompress(gz);assert hashlib.sha256(buf).hexdigest()==raw;return buf
base=np.frombuffer(data('public/data/cinematic-nebula/'+p['medium']['file'],p['medium']['sha256'],p['medium']['rawSha256']),np.uint8).reshape(256,256,256,4);fine=np.frombuffer(data('.workbuddy/v208-roi/orion-roi-256.rgba8.bin.gz',r['sha256'],r['rawSha256']),np.uint8).reshape(256,256,256,4);cache=np.frombuffer(data(root/'roi-light-rgb-direction-64.bin.gz',report['sha256'],report['rawSha256']),np.uint8).reshape(64,64,64,6);rgb=cache[...,:3].astype(np.float32)/255*4;direction=cache[...,3:].astype(np.float32)/255*2-1;bs=base[...,3].astype(np.float32)/255*12;fs=fine[...,3].astype(np.float32)/255*12
ambient=np.array([.035,.042,.055]);albedo=np.array(p['scatteringAlbedo']);g=.28

def phase(mu):return (1-g*g)/(4*np.pi*np.maximum(1+g*g-2*g*mu,.001)**1.5)
# Independent source-wise angular reference on sparse points. Same full optical path,384steps.
a=[lo[k]+(np.arange(5,dtype=np.float32)+.5)/5*(hi[k]-lo[k]) for k in range(3)];z,y,x=np.meshgrid(a[2],a[1],a[0],indexing='ij');probe=np.stack([x,y,z],axis=-1);exact=np.zeros(probe.shape,np.float32);moment=np.zeros_like(exact);point_total=np.zeros_like(exact)
for light in B.LIGHTS['orion']:
 tau=C.trace(bs,fs,probe,light['position'],lo,hi,384,True);d=np.array(light['position'])-probe;dist=np.linalg.norm(d,axis=-1);v=(light['power']*np.exp(-np.minimum(tau,30))/(.45+dist*dist))[...,None]*np.array(light['color']);di=C.normalize(-d);exact+=v*phase(di[...,2])[...,None];point_total+=v;moment+=di*np.sum(v*np.array([.2126,.7152,.0722]),axis=-1)[...,None]
moment_scatter=point_total*phase(C.normalize(moment)[...,2])[...,None]
# Replay image uses actual exported bytes, stable -expm1 transfer, manifest albedo, isotropic ambient.
w,h=120,92;xx=np.linspace(lo[0]-.06,hi[0]+.06,w,dtype=np.float32);yy=np.linspace(hi[1]+.06,lo[1]-.06,h,dtype=np.float32);x,y=np.meshgrid(xx,yy);steps=768;ds=2.6/steps;T=np.ones((h,w),np.float32);L=[np.zeros((h,w,3),np.float32) for _ in range(2)]
for j in range(steps):
 pos=np.stack([x,y,np.full_like(x,1.3-(j+.5)*ds)],axis=-1);weight=C.weight(pos,lo,hi);a=np.stack([C.sample(base[...,k],pos,np.full(3,-1.3),np.full(3,1.3))/255 for k in range(3)],axis=-1)**2*8;b=np.stack([C.sample(fine[...,k],pos,lo,hi)/255 for k in range(3)],axis=-1)**2*8;emission=a*(1-weight[...,None])+b*weight[...,None];sigma=C.sigma_at(bs,fs,pos,lo,hi);irr=np.stack([C.sample(rgb[...,k],pos,lo,hi) for k in range(3)],axis=-1);incoming=C.normalize(np.stack([C.sample(direction[...,k],pos,lo,hi) for k in range(3)],axis=-1));scatter=sigma[...,None]*albedo*(np.maximum(irr-ambient,0)*phase(incoming[...,2])[...,None]+ambient/(4*np.pi))*weight[...,None];factor=C.transfer_factor(sigma,ds);L[0]+=T[...,None]*emission*factor[...,None];L[1]+=T[...,None]*(emission+scatter)*factor[...,None];T*=np.exp(-sigma*ds)
canvas=Image.new('RGB',(w*4,h*2+62),(7,12,19));draw=ImageDraw.Draw(canvas)
for k,label in enumerate(['Fine medium: emission only','Fine medium + packed ROI light']):
 v=L[k]*1.3;v=np.clip(v*(2.51*v+.03)/(v*(2.43*v+.59)+.14),0,1);v=np.where(v<=.0031308,12.92*v,1.055*v**(1/2.4)-.055);im=Image.fromarray(np.round(v*255).astype(np.uint8)).resize((w*2,h*2),Image.Resampling.NEAREST);canvas.paste(im,(k*w*2,62));draw.text((k*w*2+8,10),label,fill='#dbe7ef')
draw.text((8,34),'CPU packed-byte replay | no surface closure/Bloom | 2x nearest display | NOT GPU',fill='#bdc9ce');canvas.save(root/'roi-packed-light-cpu.png')
result={'cacheSha256':report['sha256'],'cameraSteps':steps,'cameraDs':ds,'imageResolution':[w,h],'albedo':p['scatteringAlbedo'],'phaseG':g,'ambient':ambient.tolist(),'displayExposure':1.3,'scatteringDeltaMean':float(np.mean(np.abs(L[1]-L[0]))),'multilightMomentProbeCount':125,'perSourceVsMomentMean':float(np.mean(np.abs(exact-moment_scatter))),'perSourceVsMomentMax':float(np.max(np.abs(exact-moment_scatter))),'limits':'Actual packed RGB+direction replay. Cache stores total incident including ambient and clips at4; point term=max(decodedTotal-ambient,0), an approximate recovery. Ambient isotropic. Moment HG is not exact per-source scattering; sparse125point384step reference only characterizes angular approximation. All added scattering feathered to ROI, cache clamps edges; no surface closure. Camera ds1.33x fine pitch, not converged. Original float-only triptych used different ambient/albedo and cancellation-prone transfer; preliminary only, do not compare as identical renderer.'}
(root/'packed-replay.json').write_text(json.dumps(result,indent=2));print(json.dumps(result,indent=2),flush=True)
