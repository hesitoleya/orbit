from pathlib import Path
import importlib.util, numpy as np
spec=importlib.util.spec_from_file_location('baker',Path(__file__).with_name('bake-cinematic-nebula.py'));b=importlib.util.module_from_spec(spec);spec.loader.exec_module(b)
x,y,z=b.grid(32);assert abs(x[0,0,0]-(-1.3+2.6/64))<1e-6
sample=b.sample(x,x,y,z);assert np.max(np.abs(sample-x))<1e-5
print('PASS texel-center sampling identity')
def cube(lo,hi):
 v=np.array([[lo[0],lo[1],lo[2]],[hi[0],lo[1],lo[2]],[hi[0],hi[1],lo[2]],[lo[0],hi[1],lo[2]],[lo[0],lo[1],hi[2]],[hi[0],lo[1],hi[2]],[hi[0],hi[1],hi[2]],[lo[0],hi[1],hi[2]]],dtype=np.float32)
 faces=[[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[1,2,6],[1,6,5],[2,3,7],[2,7,6],[3,0,4],[3,4,7]]
 return v[faces]
outer=cube([-.8,-.8,-.8],[.8,.8,.8]);inner=cube([-.3,-.3,-.3],[.3,.3,.3]);shape,stats=b.triangle_parity(np.concatenate([outer,inner]),32)
assert not shape[16,16,16];assert shape[16,16,24];assert not shape[16,16,31]
print('PASS exact triangle parity preserves internal cavity unlike span hull')
sdf=b.distance_to_boundary(shape);assert sdf[16,16,16]>0 and sdf[16,16,24]<0
assert np.max(np.abs(np.diff(sdf,axis=0)))<.18
print('PASS metric signed boundary distance sign and bounded gradient')
vec=np.array([[1,0,0],[0,1,0],[0,0,1],[0,0,-1],[-1,-1,-1]],dtype=np.float32);encoded=b.oct_encode(vec).astype(np.float32)/255*2-1
v=np.concatenate([encoded,1-np.abs(encoded).sum(axis=1,keepdims=True)],axis=-1)
fold=(1-np.abs(v[:,1::-1]))*np.where(v[:,:2]>=0,1,-1);v[:,:2]=np.where((v[:,2]<0)[:,None],fold,v[:,:2]);v/=np.linalg.norm(v,axis=1,keepdims=True);ref=vec/np.linalg.norm(vec,axis=1,keepdims=True)
assert np.min(np.sum(v*ref,axis=1))>.999
print('PASS oct normal/direction roundtrip including negative hemisphere')
import json,gzip,hashlib
manifest=json.loads((b.OUT/'manifest.json').read_text(encoding='utf8'))
for p in manifest['profiles']:
 if p['id'] not in ('orion','pillars'):continue
 assert p['medium']['dimensions']==[256]*3 and p['light']['dimensions']==[128]*3 and p['shading']['dimensions']==[128]*3
 q=p['shading'];data=(b.OUT/q['file']).read_bytes();raw=gzip.decompress(data)
 assert hashlib.sha256(raw).hexdigest()==q['rawSha256'];assert len(raw)==128**3*4
 assert p['sampling']['grid']=='texel centers';assert p['statistics']['fractionEmissionClipped']==0
 assert p.get('emissionEncoding')=='sqrt-unorm8';assert p['encodingMetrics']['firstNonzeroDecodedEmission']<p['encodingMetrics']['previousLinearThreshold']/100
 assert p['encodingMetrics']['nonzeroEncodedGasVoxels']>p['encodingMetrics']['linearEncodingNonzeroGasVoxels']*1.5
 # RGB decoding does not square sigma alpha. Weak j remains representable.
 levels=np.arange(256,dtype=np.float32)/255;decoded=levels**2*p['emissionScale'];assert decoded[1]>0 and np.all(np.diff(decoded)>0)
 assert len(p['scatteringAlbedo'])==3
 if p['id']=='pillars':
  meta=p['meshSeed'];assert meta['oddRaysExcluded']==0 and meta['intervalPairs']>meta['raysHit'];assert 'parity' in meta['voxelization']
 print('PASS '+p['id']+' dimensions/shading hashes/nonclipping/texel centers/provenance')
print('PASS 6 bake-quality math/asset tests; not visual/GPU acceptance')
