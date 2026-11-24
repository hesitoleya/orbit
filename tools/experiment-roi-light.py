"""Isolated ROI light-cache feasibility experiment. CPU only; no production writes."""
import importlib.util,json,gzip,hashlib,time
from pathlib import Path
import numpy as np
from PIL import Image,ImageDraw

def load(path,name):
 s=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
C=load('tools/roi-light-common.py','common');B=load('tools/bake-cinematic-nebula.py','baker')
out=Path('.workbuddy/v210-roi-light');out.mkdir(exist_ok=True);started=time.time()
r=json.loads(Path('.workbuddy/v208-roi/report.json').read_text());lo=np.array(r['bounds']['min'],np.float32);hi=np.array(r['bounds']['max'],np.float32)
manifest=json.loads(Path('public/data/cinematic-nebula/manifest.json').read_text());p=next(p for p in manifest['profiles'] if p['id']=='orion')
def read(path,compressed,raw):
 data=Path(path).read_bytes();assert hashlib.sha256(data).hexdigest()==compressed;data=gzip.decompress(data);assert hashlib.sha256(data).hexdigest()==raw;return np.frombuffer(data,np.uint8).reshape(256,256,256,4)
base=read('public/data/cinematic-nebula/'+p['medium']['file'],p['medium']['sha256'],p['medium']['rawSha256']);fine=read('.workbuddy/v208-roi/orion-roi-256.rgba8.bin.gz',r['sha256'],r['rawSha256']);bs=base[...,3].astype(np.float32)*12/255;fs=fine[...,3].astype(np.float32)*12/255
assert p['medium']['dimensions']==[256]*3 and r['dimensions']==[256]*3
assert r['emissionScale']==8 and r['sigmaMax']==12 and r['sourceMediumRawSha256']==p['medium']['rawSha256']
assert np.all(np.isfinite(lo)) and np.all(hi>lo) and np.all(lo>=-1.3) and np.all(hi<=1.3)
lights=B.LIGHTS['orion'];assert all(np.all(np.abs(l['position'])<=np.float32(1.3)) for l in lights);n=64;steps=192
def grid(n):
 axes=[lo[k]+(np.arange(n,dtype=np.float32)+.5)/n*(hi[k]-lo[k]) for k in range(3)];z,y,x=np.meshgrid(axes[2],axes[1],axes[0],indexing='ij');return np.stack([x,y,z],axis=-1)
points=grid(n);incident=[];tau_fields=[]
for enabled in (False,True):
 light=np.zeros((n,n,n,3),np.float32);moment=np.zeros_like(light);tau_all=[]
 for i,l in enumerate(lights):
  print('shadow',enabled,i,flush=True);tau=C.trace(bs,fs,points,l['position'],lo,hi,steps,enabled);tau_all.append(tau)
  delta=np.array(l['position'])-points;dist=np.linalg.norm(delta,axis=-1);rgb=(l['power']*np.exp(-np.minimum(tau,30))/(.45+dist*dist))[...,None]*np.array(l['color']);light+=rgb;moment+=C.normalize(-delta)*np.sum(rgb*np.array([.2126,.7152,.0722]),axis=-1)[...,None]
 light+=np.array([.035,.042,.055]);incident.append((np.clip(light,0,4),C.normalize(moment)));tau_fields.append(np.stack(tau_all,axis=-1))
# Convergence sampling on deterministic spatial probe points, not a convergence guarantee.
probe=points[::8,::8,::8];coarse_tau=C.trace(bs,fs,probe,lights[0]['position'],lo,hi,steps,True);dense_tau=C.trace(bs,fs,probe,lights[0]['position'],lo,hi,steps*2,True)
packed=np.round(incident[1][0]/4*255).astype(np.uint8);direction=np.round((incident[1][1]*.5+.5)*255).astype(np.uint8);raw=np.concatenate([packed,direction],axis=-1).tobytes();gz=gzip.compress(raw,mtime=0);(out/'roi-light-rgb-direction-64.bin.gz').write_bytes(gz)
# Historical float-only preview below is disabled. Final evidence must decode actual cache.
# Avoid rebuilding this expensive cache just to rerender: use replay-roi-light.py.
import runpy
runpy.run_path('tools/finalize-roi-light.py',run_name='__main__')
raise SystemExit(0)
# Historical code, not executed: pure scattering comparison with float fields.
w,h=280,220;xx=np.linspace(lo[0]-.07,hi[0]+.07,w,dtype=np.float32);yy=np.linspace(hi[1]+.07,lo[1]-.07,h,dtype=np.float32);x,y=np.meshgrid(xx,yy);ds=2.6/768
images=[];linear=[]
for option in (None,0,1):
 T=np.ones((h,w),np.float32);L=np.zeros((h,w,3),np.float32)
 for j in range(768):
  z=1.3-(j+.5)*ds;pos=np.stack([x,y,np.full_like(x,z)],axis=-1);weight=C.weight(pos,lo,hi);a=np.stack([C.sample(base[...,k],pos,np.full(3,-1.3),np.full(3,1.3))/255 for k in range(3)],axis=-1)**2*8;b=np.stack([C.sample(fine[...,k],pos,lo,hi)/255 for k in range(3)],axis=-1)**2*8;emission=a*(1-weight[...,None])+b*weight[...,None];sigma=C.sigma_at(bs,fs,pos,lo,hi)
  if option is not None:
   light,di=incident[option];irr=np.stack([C.sample(light[...,k],pos,lo,hi) for k in range(3)],axis=-1);direction=C.normalize(np.stack([C.sample(di[...,k],pos,lo,hi) for k in range(3)],axis=-1));mu=direction[...,2];g=.28;phase=(1-g*g)/(4*np.pi*np.maximum(1+g*g-2*g*mu,.001)**1.5);emission+=sigma[...,None]*np.array(p['scatteringAlbedo'])*(np.maximum(irr-np.array([.035,.042,.055]),0)*phase[...,None]+np.array([.035,.042,.055])/(4*np.pi))*weight[...,None]
  tr=np.exp(-sigma*ds);factor=C.transfer_factor(sigma,ds);L+=T[...,None]*emission*factor[...,None];T*=tr
 linear.append(L);v=L*1.3;v=np.clip((v*(2.51*v+.03))/(v*(2.43*v+.59)+.14),0,1);v=np.where(v<=.0031308,v*12.92,1.055*v**(1/2.4)-.055);images.append(Image.fromarray(np.round(v*255).astype(np.uint8)))
canvas=Image.new('RGB',(w*3,h+60),(7,12,19));draw=ImageDraw.Draw(canvas)
for i,(im,label) in enumerate(zip(images,['Fine medium: emission only','Fine medium + base-sigma shadows','Fine medium + ROI-sigma shadows'])):canvas.paste(im,(i*w,60));draw.text((i*w+8,9),label,fill='#dbe7ef')
draw.text((8,32),'CPU diagnosis | same exposure | ROI-only added scattering; no surface closure/Bloom/GPU',fill='#b3bcc8');canvas.save(out/'roi-shadow-cpu-comparison.png')
report={'dimensions':[n]*3,'shadowSteps':steps,'shadowProbeSteps':steps*2,'probeCount':int(coarse_tau.size),'probeTauMaxDelta':float(np.max(np.abs(dense_tau-coarse_tau))),'probeTauMeanDelta':float(np.mean(np.abs(dense_tau-coarse_tau))),'fineVsCoarseTauMax':float(np.max(np.abs(tau_fields[1]-tau_fields[0]))),'fineVsCoarseTauMean':float(np.mean(np.abs(tau_fields[1]-tau_fields[0]))),'renderLightDeltaMean':float(np.mean(np.abs(linear[2]-linear[1]))),'rawBytes':len(raw),'compressedBytes':len(gz),'rawSha256':hashlib.sha256(raw).hexdigest(),'sha256':hashlib.sha256(gz).hexdigest(),'encoding':'interleaved RGB incident UNORM8 scale4 + Cartesian incoming UNORM8 (6 bytes/texel), experimental not directly GPU uploadable','cpuSeconds':round(time.time()-started,2),'sourceBaseRawSha256':p['medium']['rawSha256'],'sourceBrickRawSha256':r['rawSha256'],'limits':'CPU only. 64cubed ROI light grid is 2x per-axis sampling resolution (8x samples per local volume) relative to original128cubed global light, not filament-resolution shadow. 192 midpoint steps not convergence guarantee. Fine sigma blended inside ROI, global base sigma retained outside ROI and full source-to-point path. Preview adds scattering only within ROI feather, uses approximate moment HG with no surface closure and clamps cache at edges. Not production renderer equivalence or cinematic acceptance.'}
(out/'report.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2),flush=True)
