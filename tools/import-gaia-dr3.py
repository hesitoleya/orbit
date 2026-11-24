"""Acquire selected observed Gaia DR3 astrometry; never synthesize missing distances.
Run --probe first to verify official TAP transport/table/fields, then no arguments.
Archive downloaded CSV exactly, pack lossless source IDs/float64 angles and
float32 published scalar measurements with documented quantization.
"""
from pathlib import Path
from urllib.request import Request,urlopen
from urllib.parse import urlencode
from urllib.error import HTTPError,URLError
import argparse,csv,io,json,hashlib,struct,gzip,datetime,math,sys
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'public/data/gaia'
ENDPOINT='https://gaia.ari.uni-heidelberg.de/tap/sync'
COLUMNS=['source_id','ra','dec','parallax','parallax_error','phot_g_mean_mag','bp_rp','ruwe','parallax_over_error']
WHERE='phot_g_mean_mag <= 10 AND parallax > 0 AND parallax_over_error >= 10 AND ruwe < 1.4 AND bp_rp IS NOT NULL'
QUERY='SELECT '+','.join(COLUMNS)+' FROM gaiadr3.gaia_source WHERE '+WHERE+' ORDER BY source_id'
def fetch(query,maxrec):
 data=urlencode({'REQUEST':'doQuery','LANG':'ADQL','FORMAT':'csv','MAXREC':maxrec,'QUERY':query}).encode('ascii')
 req=Request(ENDPOINT,data=data,headers={'User-Agent':'ORBIT-Gaia-import/1.0 (selected public DR3 astrometry)','Accept':'text/csv'})
 try:
  with urlopen(req,timeout=300) as r:
   raw=r.read(80_000_001)
   if len(raw)>80_000_000:raise RuntimeError('Response exceeds80MB bound')
   if r.status!=200:raise RuntimeError('HTTP '+str(r.status))
   return raw,{'url':r.geturl(),'status':r.status,'contentType':r.headers.get('Content-Type'),'retrievedUTC':datetime.datetime.now(datetime.timezone.utc).isoformat()}
 except HTTPError as e:
  print('HTTP failure',e.code,e.read(2000).decode('utf8',errors='replace'),file=sys.stderr);raise

def main():
 p=argparse.ArgumentParser();p.add_argument('--probe',action='store_true');p.add_argument('--offline',action='store_true');a=p.parse_args()
 if a.probe:
  raw,meta=fetch('SELECT TOP 5 '+','.join(COLUMNS)+' FROM gaiadr3.gaia_source WHERE phot_g_mean_mag < 8 AND parallax > 0 AND parallax_over_error >= 10 AND ruwe < 1.4 AND bp_rp IS NOT NULL',10)
  print(json.dumps(meta,indent=2));print(raw.decode());return
 OUT.mkdir(parents=True,exist_ok=True)
 rawpath=OUT/'gaia-dr3-g10-selected.csv.gz'
 if a.offline:
  raw=gzip.decompress(rawpath.read_bytes());meta=json.loads((OUT/'manifest.json').read_text(encoding='utf8'))['retrieval']
 else:
  countRaw,countMeta=fetch('SELECT COUNT(*) AS n FROM gaiadr3.gaia_source WHERE '+WHERE,10)
  print('COUNT RESPONSE',countRaw.decode(),flush=True)
  countRows=list(csv.DictReader(io.StringIO(countRaw.decode('utf-8-sig'))))
  expected=int(countRows[0]['n'])
  if not 1000<expected<400000:raise RuntimeError('Unexpected selected count '+str(expected))
  raw,meta=fetch(QUERY,400001)
  meta['countQuery']=countMeta;meta['countExpected']=expected
  rawpath.write_bytes(gzip.compress(raw,compresslevel=9,mtime=0))
 text=raw.decode('utf-8-sig');rows=list(csv.DictReader(io.StringIO(text)))
 if not rows or list(rows[0])!=COLUMNS:raise RuntimeError('Bad CSV columns or TAP error: '+text[:1000])
 if len(rows)!=meta['countExpected']:raise RuntimeError('TAP truncated result expected '+str(meta['countExpected'])+' got '+str(len(rows)))
 records=bytearray();ids=set();stats={c:[] for c in COLUMNS[1:]};octants=[0]*8;raBins=[0]*24;decBins=[0]*18;distances=[]
 for row in rows:
  sid=row['source_id']
  if not sid.isdigit() or not 0<int(sid)<2**64 or sid in ids:raise RuntimeError('Invalid/duplicate source_id '+sid)
  ids.add(sid);v=[float(row[c]) for c in COLUMNS[1:]]
  if not all(math.isfinite(x) for x in v):raise RuntimeError('Nonfinite observation')
  ra,dec,par,err,g,bprp,ruwe,snr=v
  if not (0<=ra<360 and -90<=dec<=90 and par>0 and err>0 and g<=10 and ruwe<1.4 and snr>=10):raise RuntimeError('Selection mismatch '+str(row))
  records.extend(struct.pack('<Qddffffff',int(sid),*v))
  for c,x in zip(COLUMNS[1:],v):stats[c].append(x)
  d=1000/par;distances.append(d)
  ar,dr=math.radians(ra),math.radians(dec)
  x,y,z=math.cos(dr)*math.cos(ar),math.sin(dr),math.cos(dr)*math.sin(ar)
  octants[(x>=0)+2*(y>=0)+4*(z>=0)]+=1;raBins[min(23,int(ra/15))]+=1;decBins[min(17,int((dec+90)/10))]+=1
 packed=struct.pack('<8sIId8x',b'GAIA3D1\0',len(rows),48,2016.0)+records
 path=OUT/'gaia-dr3.bin';path.write_bytes(packed)
 def summary(vals):
  vals=sorted(vals);n=len(vals)
  return {'min':vals[0],'p05':vals[int((n-1)*.05)],'median':vals[n//2],'p95':vals[int((n-1)*.95)],'max':vals[-1]}
 manifest={'schemaVersion':1,'catalogue':'Gaia DR3 gaia_source','provider':'ARI Gaia TAP, Zentrum fuer Astronomie Heidelberg University; ESA Gaia/DPAC observations','table':'gaiadr3.gaia_source','query':QUERY,'selection':WHERE,'retrieval':meta,'count':len(rows),'recordBytes':48,'headerBytes':32,'file':'gaia-dr3.bin','byteLength':len(packed),'sha256':hashlib.sha256(packed).hexdigest(),'truncated':False,'skyCoverage':'Full sky query; magnitude/quality selected, NOT a complete sky or Galaxy census','epochJulianYear':2016.0,'frame':'ICRS equatorial; RA/Dec degrees; astrometry at reference epoch J2016.0','distancePolicy':{'estimator':'1000 / parallax_mas parsecs, ONLY for selected positive parallax_over_error>=10','randomSigmaApproxPc':'1000 * parallax_error_mas / parallax_mas^2 (linear propagation only)','zeroPointCorrectionApplied':False,'extinctionCorrectionApplied':False,'bayesianDistanceInferenceApplied':False,'properMotionPropagationApplied':False,'warning':'Inverse parallax is an estimate, not exact measured distance. Published random uncertainty excludes parallax systematics; bright-star selection/RUWE/parallax SNR cuts are not a completeness guarantee. Unknown/rejected sources are absent, never filled.'},'license':{'name':'CC BY-NC 3.0 IGO','url':'https://creativecommons.org/licenses/by-nc/3.0/igo/deed.en','verifiedOfficialURL':'https://www.cosmos.esa.int/web/gaia-users/license','termsURL':'https://www.cosmos.esa.int/web/esdc/terms-and-conditions','nonCommercialRestriction':True},'credit':'This work has made use of data from the European Space Agency (ESA) mission Gaia, processed by the Gaia Data Processing and Analysis Consortium (DPAC). Funding for the DPAC has been provided by national institutions, in particular the institutions participating in the Gaia Multilateral Agreement. Retrieved via ARI Gaia TAP, Heidelberg.','creditURL':'https://www.cosmos.esa.int/web/gaia-users/credits','citationURLs':['https://doi.org/10.1051/0004-6361/201629272','https://doi.org/10.1051/0004-6361/202243940'],'binary':{'file':path.name,'byteLength':len(packed),'sha256':hashlib.sha256(packed).hexdigest(),'headerBytes':32,'magic':'GAIA3D1\\0','littleEndian':True,'header':{'count':{'offset':8,'type':'uint32'},'stride':{'offset':12,'type':'uint32','value':48},'epoch':{'offset':16,'type':'float64','value':2016.0}},'recordBytes':48,'fields':[{'name':c,'offset':off,'type':typ,'unit':unit} for c,off,typ,unit in [('source_id',0,'uint64','identifier: decode BigInt then decimal string; NEVER JS Number'),('ra',8,'float64','deg'),('dec',16,'float64','deg'),('parallax',24,'float32','mas'),('parallax_error',28,'float32','mas'),('phot_g_mean_mag',32,'float32','mag'),('bp_rp',36,'float32','mag'),('ruwe',40,'float32','dimensionless'),('parallax_over_error',44,'float32','dimensionless')]],'quantization':'source_id and RA/Dec lossless for downloaded CSV representation; other published scalar measurements rounded once to IEEE754 float32, raw CSV retained.'},'raw':{'file':rawpath.name,'compression':'gzip mtime0','csvBytes':len(raw),'csvSHA256':hashlib.sha256(raw).hexdigest(),'gzipBytes':rawpath.stat().st_size,'gzipSHA256':hashlib.sha256(rawpath.read_bytes()).hexdigest()},'statistics':{**{c:summary(v) for c,v in stats.items()},'inverseParallaxDistancePc':summary(distances),'ra15DegreeBins':raBins,'dec10DegreeBins':decBins,'equatorialOctants':octants},'notIncluded':['No synthetic stars or fabricated source IDs','No inferred/fabricated positions for rejected or missing-parallax stars','No photo-to-source crossmatch','No measured 3D dust/gas reconstruction','No claim of complete Galaxy','No raw spacecraft scanning/tomography; processed catalogue astrometry only']}
 (OUT/'manifest.json').write_text(json.dumps(manifest,indent=2,ensure_ascii=False)+'\n',encoding='utf8')
 print(json.dumps({'count':len(rows),'binaryBytes':len(packed),'rawGzipBytes':rawpath.stat().st_size,'parallax':manifest['statistics']['parallax'],'distancePc':manifest['statistics']['inverseParallaxDistancePc'],'binarySHA256':manifest['binary']['sha256']},indent=2),flush=True)
if __name__=='__main__':main()
