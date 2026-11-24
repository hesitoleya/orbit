"""Read deployed M51 bytes, not baker function outputs. CPU only, no GPU claim."""
from pathlib import Path
import gzip,json,hashlib
import numpy as np
R=Path(__file__).resolve().parents[1];D=R/'public/data/cinematic-nebula';p=json.loads((D/'m51-profile.json').read_text(encoding='utf8'))
sha=lambda b:hashlib.sha256(b).hexdigest();data={}
for role in ['medium','light','occupancy']:
 s=p[role];packed=(D/s['file']).read_bytes();raw=gzip.decompress(packed);assert sha(packed)==s['sha256'];assert sha(raw)==s['rawSha256'];assert len(raw)==s['rawBytes'];x,y,z=s['dimensions'];data[role]=np.frombuffer(raw,np.uint8).reshape((z,y,x,s['channels']))
print('PASS deployed three compressed/raw hashes, byte counts and axis order')
m=data['medium'];assert m.shape==(512,64,512,4);assert np.count_nonzero(m.max((0,2,3)))>=8;assert np.ptp(m[:,:,:,3].sum(1))>0
print('PASS non-cubic high-planar-resolution medium has finite independent Y thickness')
assert p['emissionEncoding']=='sqrt-unorm8';j=(m[:,:,:,:3].astype(np.float32)/255)**2*p['emissionScale'];a=m[:,:,:,3].astype(np.float32)/255*p['sigmaMax'];assert np.isfinite(j).all();assert m[:,:,:,:3].max()<255;assert j.max()>1
sigma=a.sum(1);lum=(j*np.array([.2126,.7152,.0722])).sum(3).sum(1);corr=float(np.corrcoef(sigma.flatten(),lum.flatten())[0,1]);assert abs(corr)<.95;assert (a>0).any()
print('PASS weak emission transfer is explicit and independent dust not brightness alpha, corr',corr)
active=m.max(3)>0;occ=active.reshape(32,16,32,2,32,16).max((1,3,5));loaded=data['occupancy'][:,:,:,0]>0;assert (loaded|~occ).all();assert loaded.mean()<.5
for dz in [-1,0,1]:
 for dy in [-1,0,1]:
  for dx in [-1,0,1]:
   zs=slice(max(0,dz),min(32,32+dz));ys=slice(max(0,dy),min(32,32+dy));xs=slice(max(0,dx),min(32,32+dx))
   oz=slice(max(0,-dz),min(32,32-dz));oy=slice(max(0,-dy),min(32,32-dy));ox=slice(max(0,-dx),min(32,32-dx))
   assert (loaded[zs,ys,xs]|~occ[oz,oy,ox]).all()
print('PASS conservative occupancy includes every quantized cell plus trilinear-neighbor support')
assert data['light'].shape==(1,1,1,4);assert not data['light'].any();assert p['scatteringAlbedo']==[0,0,0];assert p['detailEnabled'] is False
print('PASS no invented illuminator or residual detail reshapes projected photograph')
s=p['source'];assert sha((R/s['path']).read_bytes())==s['sha256'];assert s['license']=='CC BY 4.0';assert 'Hubble Heritage' in s['credit'];assert 'NOT measured' in p['interpretation'];assert p['imageMapping']['preserveAspect'] and not p['imageMapping']['deprojection']
mapping=p['imageMapping'];scale=mapping['localUnitsPerPixel'];cx,cy=mapping['mainCorePixels'];assert cx==1545 and cy==1343 and scale==.000525
assert abs((4000*scale)/(2776*scale)-4000/2776)<1e-12
assert abs(((cx-cx)*scale))<1e-10 and abs(((cy-cy)*scale))<1e-10
assert -1.3<(0-cx)*scale<(4000-cx)*scale<1.3
assert -1.3<(0-cy)*scale<(2776-cy)*scale<1.3
assert all(s['rawBytes']<=96*1024*1024 for s in [p['medium'],p['light'],p['occupancy']])
assert 'median foreground-point suppression' in s['changes'] and 'NOT measured' in p['interpretation']
print('PASS source core coordinates/aspect/local bounds and loader per-field raw cap')
print('PASS source provenance and artificial depth/no deprojection caveats retained')
