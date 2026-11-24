"""Per-source optical-depth cache experiment, isolated CPU evidence only."""
import importlib.util,json,gzip,hashlib,time
from pathlib import Path
import numpy as np
from PIL import Image,ImageDraw

def load(path,name):
 s=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
C=load('tools/roi-light-common.py','common');B=load('tools/bake-cinematic-nebula.py','baker');out=Path('.workbuddy/v211-roi-tau');out.mkdir(exist_ok=True);start=time.time();r=json.loads(Path('.workbuddy/v208-roi/report.json').read_text());p=next(p for p in json.loads(Path('public/data/cinematic-nebula/manifest.json').read_text())['profiles'] if p['id']=='orion');lo=np.array(r['bounds']['min'],np.float32);hi=np.array(r['bounds']['max'],np.float32);lights=B.LIGHTS['orion'];assert r['sourceMediumRawSha256']==p['medium']['rawSha256'];assert p['medium']['dimensions']==[256]*3 and r['dimensions']==[256]*3;assert r['emissionScale']==8 and r['sigmaMax']==12;assert len(lights)==3;assert np.all(np.isfinite(lo)) and np.all(hi>lo) and np.all(lo>=-1.3) and np.all(hi<=1.3);assert all(np.all(np.abs(l['position'])<=1.3) for l in lights)
def data(path,compressed,raw):
 gz=Path(path).read_bytes();assert hashlib.sha256(gz).hexdigest()==compressed;buf=gzip.decompress(gz);assert hashlib.sha256(buf).hexdigest()==raw;return np.frombuffer(buf,np.uint8).reshape(256,256,256,4)
base=data('public/data/cinematic-nebula/'+p['medium']['file'],p['medium']['sha256'],p['medium']['rawSha256']);fine=data('.workbuddy/v208-roi/orion-roi-256.rgba8.bin.gz',r['sha256'],r['rawSha256']);bs=base[...,3].astype(np.float32)/255*12;fs=fine[...,3].astype(np.float32)/255*12
n=32;steps=192;axes=[lo[k]+(np.arange(n,dtype=np.float32)+.5)/n*(hi[k]-lo[k]) for k in range(3)];z,y,x=np.meshgrid(axes[2],axes[1],axes[0],indexing='ij');points=np.stack([x,y,z],axis=-1)
fields=[]
for i,l in enumerate(lights):
 print('tau source',i+1,flush=True);fields.append(C.trace(bs,fs,points,l['position'],lo,hi,steps,True))
tau=np.stack(fields,axis=-1);packed=np.zeros((n,n,n,4),dtype='<f2');packed[...,:3]=tau;raw=packed.tobytes();gz=gzip.compress(raw,mtime=0);(out/'orion-roi-tau-rgba16f-32.bin.gz').write_bytes(gz);cache=np.frombuffer(gzip.decompress(gz),dtype='<f2').reshape(n,n,n,4).astype(np.float32);assert np.all(np.isfinite(cache))
# Independent sparse integration reference tests interpolation AND precision, not just centres.
rng=np.random.default_rng(211);probe=lo+(hi-lo)*rng.random((256,3)).astype(np.float32);reference=np.stack([C.trace(bs,fs,probe,l['position'],lo,hi,384,True) for l in lights],axis=-1);sampled=np.stack([C.sample(cache[...,k],probe,lo,hi) for k in range(3)],axis=-1)
ambient=np.array([.035,.042,.055]);albedo=np.array(p['scatteringAlbedo']);g=.28
def phase(mu):return (1-g*g)/(4*np.pi*np.maximum(1+g*g-2*g*mu,.001)**1.5)
def angular(pos,optical):
 direct=np.zeros(pos.shape,np.float32);moment=np.zeros_like(direct);total=np.zeros_like(direct)
 for k,l in enumerate(lights):
  d=np.array(l['position'])-pos;dist=np.linalg.norm(d,axis=-1);rgb=(l['power']*np.exp(-optical[...,k])/(.45+dist*dist))[...,None]*np.array(l['color']);incoming=C.normalize(-d);direct+=rgb*phase(incoming[...,2])[...,None];total+=rgb;moment+=incoming*np.sum(rgb*np.array([.2126,.7152,.0722]),axis=-1)[...,None]
 return direct+ambient/(4*np.pi),total*phase(C.normalize(moment)[...,2])[...,None]+ambient/(4*np.pi),total
ref_scatter,_,ref_total=angular(probe,reference);cached_scatter,_,_=angular(probe,sampled)
# Same tau source data for each angular option: isolates phase compression from resolution/encoding.
w,h=120,92;xx=np.linspace(lo[0]-.06,hi[0]+.06,w,dtype=np.float32);yy=np.linspace(hi[1]+.06,lo[1]-.06,h,dtype=np.float32);x,y=np.meshgrid(xx,yy);camera_steps=768;ds=2.6/camera_steps;T=np.ones((h,w),np.float32);L=[np.zeros((h,w,3),np.float32) for _ in range(3)]
for j in range(camera_steps):
 pos=np.stack([x,y,np.full_like(x,1.3-(j+.5)*ds)],axis=-1);weight=C.weight(pos,lo,hi);sigma=C.sigma_at(bs,fs,pos,lo,hi);a=np.stack([C.sample(base[...,k],pos,np.full(3,-1.3),np.full(3,1.3))/255 for k in range(3)],axis=-1)**2*8;b=np.stack([C.sample(fine[...,k],pos,lo,hi)/255 for k in range(3)],axis=-1)**2*8;emission=a*(1-weight[...,None])+b*weight[...,None];sample_tau=np.stack([C.sample(cache[...,k],pos,lo,hi) for k in range(3)],axis=-1);direct,moment,_=angular(pos,sample_tau);source=[emission,emission+sigma[...,None]*albedo*moment*weight[...,None],emission+sigma[...,None]*albedo*direct*weight[...,None]];factor=C.transfer_factor(sigma,ds)
 for k in range(3):L[k]+=T[...,None]*source[k]*factor[...,None]
 T*=np.exp(-sigma*ds)
canvas=Image.new('RGB',(w*6,h*2+62),(7,12,19));draw=ImageDraw.Draw(canvas)
for k,label in enumerate(['Fine medium: emission only','Same tau: single moment HG','Same tau: per-source HG']):
 v=L[k]*1.3;v=np.clip(v*(2.51*v+.03)/(v*(2.43*v+.59)+.14),0,1);v=np.where(v<=.0031308,v*12.92,1.055*v**(1/2.4)-.055);im=Image.fromarray(np.round(v*255).astype(np.uint8)).resize((w*2,h*2),Image.Resampling.NEAREST);canvas.paste(im,(k*w*2,62));draw.text((k*w*2+8,10),label,fill='#dbe7ef')
draw.text((8,34),'CPU actual FP16 tau bytes | same camera/exposure/material | 2x nearest display | NOT GPU',fill='#bdc9ce');canvas.save(out/'per-source-tau-cpu.png')
report={'dimensions':[n]*3,'bounds':r['bounds'],'encoding':'RGBA16F little-endian; RGB optical depth per source, A zero; decode exp(-tau), no incident-radiance clipping','lightSources':lights,'ambient':ambient.tolist(),'albedo':albedo.tolist(),'phaseG':g,'rawBytes':len(raw),'compressedBytes':len(gz),'sha256':hashlib.sha256(gz).hexdigest(),'rawSha256':hashlib.sha256(raw).hexdigest(),'tauMin':float(tau.min()),'tauMax':float(tau.max()),'fp16TauMaxErrorAtCentres':float(np.max(np.abs(cache[...,:3]-tau))),'sparseProbeCount':256,'sparseProbeReferenceSteps':384,'sparseTauMaxError':float(np.max(np.abs(sampled-reference))),'sparseTauMeanError':float(np.mean(np.abs(sampled-reference))),'sparseScatterMeanError':float(np.mean(np.abs(cached_scatter-ref_scatter))),'sparseIncidentMax':float(ref_total.max()),'momentVsPerSourceRenderMean':float(np.mean(np.abs(L[2]-L[1]))),'renderScatteringMean':float(np.mean(np.abs(L[2]-L[0]))),'shadowSteps':steps,'cameraSteps':camera_steps,'imageResolution':[w,h],'seconds':round(time.time()-start,2),'sourceBaseRawSha256':p['medium']['rawSha256'],'sourceBrickRawSha256':r['rawSha256'],'limits':'CPU only. 32cubed tau grid is same local per-axis spacing as original128cubed global light, intentionally lower-cost proof not higher detail. Float16 quantization, cache interpolation and192step path integration all approximate. Same angular comparison inputs isolate moment compression; not comparison against previous clipped64cubed cache. Incident not clipped, tau unmodified (finite observed max); point falloff .45 artistic. Camera integration not converged, ROI-only feathered scattering, edge clamp, no surface closure/Bloom/stars. Requires WebGL2 RGBA16F upload/filter support check and actual GPU/memory testing before integration. Original CC0 fields, not measured.'}
(out/'report.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2),flush=True)
