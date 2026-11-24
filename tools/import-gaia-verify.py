"""Verify packed catalogue against every raw observed row; no network access."""
from pathlib import Path
import gzip,csv,io,json,struct,hashlib,math
R=Path(__file__).resolve().parents[1]/'public/data/gaia'
m=json.loads((R/'manifest.json').read_text(encoding='utf8'))
blob=(R/m['binary']['file']).read_bytes();gz=(R/m['raw']['file']).read_bytes();raw=gzip.decompress(gz)
assert hashlib.sha256(blob).hexdigest()==m['binary']['sha256']
assert hashlib.sha256(raw).hexdigest()==m['raw']['csvSHA256']
assert hashlib.sha256(gz).hexdigest()==m['raw']['gzipSHA256']
magic,count,stride,epoch=struct.unpack_from('<8sIId',blob)
assert magic==b'GAIA3D1\0' and stride==48 and epoch==2016.0
assert count==m['count']==m['retrieval']['countExpected'] and len(blob)==32+count*stride
assert blob[24:32]==b'\0'*8
cols=['source_id','ra','dec','parallax','parallax_error','phot_g_mean_mag','bp_rp','ruwe','parallax_over_error']
seen=set();sidBig=0;maxQuant={c:0 for c in cols[3:]}
for i,row in enumerate(csv.DictReader(io.StringIO(raw.decode('utf-8-sig')))):
 sid,ra,dec,par,err,g,bp,ruwe,snr=struct.unpack_from('<Qddffffff',blob,32+i*48)
 assert str(sid)==row['source_id'] and sid not in seen;seen.add(sid)
 assert ra==float(row['ra']) and dec==float(row['dec'])
 sidBig+=sid>2**53-1
 vals=[par,err,g,bp,ruwe,snr]
 for col,v in zip(cols[3:],vals):
  expected=struct.unpack('<f',struct.pack('<f',float(row[col])))[0]
  assert expected==v and math.isfinite(v)
  maxQuant[col]=max(maxQuant[col],abs(v-float(row[col])))
 # Selection check on unrounded observations: float32 boundary rounding is not
 # silently used to decide source inclusion.
 assert float(row['phot_g_mean_mag'])<=10 and float(row['parallax'])>0 and float(row['parallax_error'])>0 and float(row['ruwe'])<1.4 and float(row['parallax_over_error'])>=10
assert len(seen)==count and all(v>0 for v in m['statistics']['equatorialOctants'])
assert all(v>0 for v in m['statistics']['ra15DegreeBins'])
assert m['license']['nonCommercialRestriction'] is True
assert m['distancePolicy']['zeroPointCorrectionApplied'] is False
assert m['truncated'] is False
print(json.dumps({'status':'PASS','count':count,'binaryBytes':len(blob),'sourceIDsAboveJSSafeInteger':sidBig,'allSourceIDsAndFloat64AnglesExact':True,'allFloat32ValuesExactlyRepacked':True,'maxFloat32Quantization':maxQuant,'octants':m['statistics']['equatorialOctants']},indent=2))
