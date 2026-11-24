"""Analytic and packed-cache tests, not GPU acceptance."""
import importlib.util,numpy as np,json,gzip,hashlib
from pathlib import Path
s=importlib.util.spec_from_file_location('common','tools/roi-light-common.py');C=importlib.util.module_from_spec(s);s.loader.exec_module(C)
lo=np.array([-.6,-.4,-.65]);hi=lo+.65;p=np.array([[0,0,0],[-.1,.1,-.2],[.2,.2,.3]],np.float32);source=[.4,.4,.4];base=np.full((8,8,8),2,np.float32);fine=np.full((8,8,8),2,np.float32)
expected=2*np.linalg.norm(np.array(source)-p,axis=-1)
for steps in [1,16,192]:np.testing.assert_allclose(C.trace(base,fine,p,source,lo,hi,steps),expected,rtol=2e-5,atol=2e-5)
np.testing.assert_allclose(C.trace(base*0,fine*0,p,source,lo,hi,16),0)
np.testing.assert_allclose(C.trace(base,fine,p,source,lo,hi,32),C.trace(base,fine,p,source,lo,hi,32,False))
# Fine grid empty only removes the feathered ROI extinction; global path must remain.
a=C.trace(base,fine*0,p,source,lo,hi,192);b=C.trace(base,fine,p,source,lo,hi,192);assert np.all(a<=b+1e-6) and np.any(a>0)
for sigma in [0,1e-8,1.1e-6,1e-5,.1,12]:
 f=C.transfer_factor(np.array([sigma],np.float32),.002539)[0];expected_factor=-np.expm1(-sigma*.002539)/sigma if sigma>0 else .002539;np.testing.assert_allclose(f,expected_factor,rtol=2e-6)
np.testing.assert_allclose(C.normalize(np.zeros((3,3))),np.tile([0,0,1],(3,1)))
# Texture texel centres and edge clamp, including noncubic data.
z,y,x=np.indices((3,4,5));field=(x+10*y+100*z).astype(np.float32);pts=np.array([[(x+.5)/5,(y+.5)/4,(z+.5)/3] for z in range(3) for y in range(4) for x in range(5)],np.float32);np.testing.assert_allclose(C.sample(field,pts,np.zeros(3),np.ones(3)),field.ravel(),atol=1e-4)
print('PASS analytic homogeneous/zero extinction, full-domain shadow paths, replacement not addition, zero moment fallback, texel-centre sampling')
path=Path('.workbuddy/v210-roi-light/report.json')
if path.exists():
 r=json.loads(path.read_text());gz=Path('.workbuddy/v210-roi-light/roi-light-rgb-direction-64.bin.gz').read_bytes();raw=gzip.decompress(gz);assert hashlib.sha256(raw).hexdigest()==r['rawSha256'];assert hashlib.sha256(gz).hexdigest()==r['sha256'];assert len(raw)==64**3*6==r['rawBytes'];a=np.frombuffer(raw,np.uint8).reshape(-1,6);v=a[:,3:].astype(np.float32)/255*2-1;assert np.max(np.abs(np.linalg.norm(v,axis=-1)-1))<.007;assert r['fineVsCoarseTauMax']>0;replay=json.loads(Path('.workbuddy/v210-roi-light/packed-replay.json').read_text());assert replay['cacheSha256']==r['sha256'];assert replay['scatteringDeltaMean']>0;assert replay['multilightMomentProbeCount']==125;assert replay['perSourceVsMomentMean']>0
 assert r['probeCount']==512 and r['shadowSteps']==192;assert r['probeTauMaxDelta']<.1
 print('PASS actual light/direction packed-cache hashes, bounded unit direction, nonzero shadow effect and probe convergence sanity (not global convergence)')
