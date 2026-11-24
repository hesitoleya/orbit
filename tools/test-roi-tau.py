"""Per-source FP16 tau codec/math checks. Not WebGL acceptance."""
import ast,importlib.util,json,gzip,hashlib
from pathlib import Path
import numpy as np
s=importlib.util.spec_from_file_location('common','tools/roi-light-common.py');C=importlib.util.module_from_spec(s);s.loader.exec_module(C)
# Compile only actual pure angular helpers, never execute bake or render at import.
tree=ast.parse(Path('tools/experiment-roi-tau.py').read_text());selected=[n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name in ('phase','angular')];scope={'np':np,'C':C,'ambient':np.zeros(3),'g':.28,'lights':[{'position':[0,0,-1],'color':[1,0,0],'power':20},{'position':[0,0,1],'color':[0,1,0],'power':20}]};exec(compile(ast.Module(body=selected,type_ignores=[]),'angular','exec'),scope)
point=np.zeros((1,3),np.float32);depth=np.zeros((1,2),np.float32);direct,moment,total=scope['angular'](point,depth);assert total.max()>4;assert np.all(np.isfinite(direct));assert np.max(np.abs(direct-moment))>.01
g=.28
forward=(1-g*g)/(4*np.pi*(1+g*g-2*g)**1.5);backward=(1-g*g)/(4*np.pi*(1+g*g+2*g)**1.5);assert forward>backward
np.testing.assert_allclose(scope['phase'](1),forward,rtol=1e-6);np.testing.assert_allclose(scope['phase'](-1),backward,rtol=1e-6)
expected=np.array([[20/1.45*forward,20/1.45*backward,0]]);np.testing.assert_allclose(direct,expected,rtol=1e-6)
a,_,_=scope['angular'](point,depth+2);np.testing.assert_allclose(a,direct*np.exp(-2),rtol=1e-6)
# Storage handles both tiny and large finite tau; no clamp at incident4 or tau1.
tau=np.array([0,1e-5,.1,1,5,20,80],np.float32);encoded=tau.astype('<f2');assert np.isfinite(encoded).all();assert encoded.max()==80;np.testing.assert_allclose(encoded.astype(np.float32),tau,rtol=.001,atol=1e-7)
# Optical-depth interpolation is not linear transmittance; make that chosen approximation explicit.
pair=np.zeros((2,2,2),np.float32);pair[:,:,1]=2
midpoint=np.array([[.5,.5,.5]],np.float32);interpolated_tau=C.sample(pair,midpoint,np.zeros(3),np.ones(3));interpolated_T=C.sample(np.exp(-pair),midpoint,np.zeros(3),np.ones(3));np.testing.assert_allclose(np.exp(-interpolated_tau),np.exp(-1),rtol=1e-6);assert np.exp(-interpolated_tau)[0]<interpolated_T[0]
print('PASS actual angular helper source-specific HG, photon direction, HDR incident>4, Beer-Lambert attenuation, FP16 tau dynamic range and geometric-transmittance interpolation invariant')
path=Path('.workbuddy/v211-roi-tau/report.json')
assert path.is_file(),'Required baked per-source report missing; run experiment-roi-tau.py'
if path.exists():
 r=json.loads(path.read_text());gz=Path('.workbuddy/v211-roi-tau/orion-roi-tau-rgba16f-32.bin.gz').read_bytes();raw=gzip.decompress(gz);assert hashlib.sha256(gz).hexdigest()==r['sha256'];assert hashlib.sha256(raw).hexdigest()==r['rawSha256'];assert len(raw)==32**3*8==r['rawBytes'];a=np.frombuffer(raw,dtype='<f2').reshape(32,32,32,4);assert np.isfinite(a).all() and (a>=0).all();assert (a[...,3]==0).all();assert r['fp16TauMaxErrorAtCentres']<.01;assert r['sparseProbeCount']==256;assert r['sparseTauMaxError']<.2;assert r['momentVsPerSourceRenderMean']>0;assert r['renderScatteringMean']>0
 assert r['sourceBrickRawSha256']==json.loads(Path('.workbuddy/v208-roi/report.json').read_text())['rawSha256']
 # Independently recompute deterministic points against current medium data/helper, not report metrics alone.
 m=json.loads(Path('public/data/cinematic-nebula/manifest.json').read_text());profile=next(p for p in m['profiles'] if p['id']=='orion');brick_report=json.loads(Path('.workbuddy/v208-roi/report.json').read_text());assert r['sourceBaseRawSha256']==profile['medium']['rawSha256'];assert r['albedo']==profile['scatteringAlbedo'];assert r['bounds']==brick_report['bounds'];assert r['phaseG']==.28
 baker_tree=ast.parse(Path('tools/bake-cinematic-nebula.py').read_text());lights_node=next(n for n in baker_tree.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='LIGHTS' for t in n.targets));assert r['lightSources']==ast.literal_eval(lights_node.value)['orion']
 def sigma(path,sha):
  raw=gzip.decompress(Path(path).read_bytes());assert hashlib.sha256(raw).hexdigest()==sha;return np.frombuffer(raw,np.uint8).reshape(256,256,256,4)[...,3].astype(np.float32)/255*12
 base=sigma('public/data/cinematic-nebula/'+profile['medium']['file'],r['sourceBaseRawSha256']);fine=sigma('.workbuddy/v208-roi/orion-roi-256.rgba8.bin.gz',r['sourceBrickRawSha256']);lo=np.array(r['bounds']['min'],np.float32);hi=np.array(r['bounds']['max'],np.float32);probe=lo+(hi-lo)*np.random.default_rng(211).random((256,3)).astype(np.float32);reference=np.stack([C.trace(base,fine,probe,l['position'],lo,hi,384,True) for l in r['lightSources']],axis=-1);sampled=np.stack([C.sample(a[...,k].astype(np.float32),probe,lo,hi) for k in range(3)],axis=-1);np.testing.assert_allclose(np.max(np.abs(sampled-reference)),r['sparseTauMaxError'],rtol=1e-5);np.testing.assert_allclose(np.mean(np.abs(sampled-reference)),r['sparseTauMeanError'],rtol=1e-5)
 print('PASS independent current-medium 256point384step replay matches report; bounds/albedo/source/light provenance checked')
 print('PASS actual per-source tau bytes SHA, zero spare channel, finite nonnegative range, quantization/probe sanity and nonzero phase comparison; CPU only')
