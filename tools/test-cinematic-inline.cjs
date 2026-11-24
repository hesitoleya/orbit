'use strict';
// node tools/test-cinematic-inline.cjs [构建目录] [精确基线]；只读成品，不启动浏览器。
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto'),zlib=require('node:zlib');
const root=path.resolve(__dirname,'..'),dir=path.resolve(process.argv[2]||root),baseline=process.argv[3]||path.join(root,'nonprod-pre-cinematic-split.html');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex'),data=path.join(root,'public/data/cinematic-nebula');
const manifest=JSON.parse(fs.readFileSync(path.join(data,'manifest.json'))),roles=['medium','light','occupancy','shading'];
const originals=manifest.profiles.flatMap(p=>roles.map(r=>p[r]).filter(Boolean)).concat(manifest.detail);
const marker='window.__ORBIT_INLINE__=',tag='<script id="orbit-cine-',movie='<script id="bhReferenceVideo"',mainTag="<script>(function () {\n'use strict';";
function pack(b){const i=b.indexOf(marker);assert(i>=0);const s=i+marker.length,e=b.indexOf(';</script>',s);assert(e>s);return {value:JSON.parse(b.toString('utf8',s,e)),size:e-s,main:b.indexOf(mainTag,e)};}
function reference(){const b=fs.readFileSync(baseline);assert.equal(hash(b),'95c0b86c43321d5552fc8cc4423b61a4f965b8e51820c76501a1f8a436872e3d');const {value,size,main}=pack(b);assert.deepEqual(value.cinematic.manifest,manifest);assert.equal(Object.keys(value.cinematic.files).length,originals.length);for(const d of originals)assert.equal(hash(Buffer.from(value.cinematic.files[d.file],'base64')),d.sha256);return {total:b.length,pack:size,main};}
const before=reference();
function offline(){const b=fs.readFileSync(path.join(dir,'space.html')), {value,size,main}=pack(b),c=value.cinematic;
 assert.deepEqual(c.manifest,manifest);assert.deepEqual(Object.keys(c).sort(),['manifest','previews']);assert.deepEqual(Object.keys(c.previews).sort(),['12','6','8','9']);
 const previews=Object.values(c.previews).flatMap(p=>[p.medium,p.light]);const specs=new Map([...originals,...previews].map(d=>[d.file,d]));
 const appEnd=b.indexOf('</script>',main),first=b.indexOf(tag),hd=b.indexOf('<script id="orbit-photo-hd-'),finish=b.indexOf('<script>ORBIT_CINEMATIC_ASSETS.parsed(null)</script>'),film=b.indexOf(movie);
 assert(main>0&&appEnd<first&&first<hd&&hd<finish&&finish<film&&film<b.indexOf('<script id="sdoMovie"'));assert(main<before.main-51e6 && size<before.pack-51e6);
 let i=first,order=[],previewEnd,nativeChars=0;
 while(i>=0){const e=b.indexOf('>',i),f=b.toString('ascii',i+tag.length,e).match(/^([-\w.]+)" type="application\/octet-stream"$/)?.[1],d=specs.get(f);assert(d,f);specs.delete(f);order.push(f);const stop=b.indexOf('</script>',e),endTag=`</script><script>ORBIT_CINEMATIC_ASSETS.parsed('${f}')</script>`;assert.equal(b.indexOf(endTag,stop),stop);assert(stop<finish);
  const s=b.toString('ascii',e+1,stop),gz=Buffer.from(s,'base64');assert.equal(s.length,Math.ceil(d.compressedBytes/3)*4);assert.equal(gz.length,d.compressedBytes);assert.equal(hash(gz),d.sha256);const raw=zlib.gunzipSync(gz);assert.equal(raw.length,d.dimensions.reduce((a,b)=>a*b)*d.channels);assert.equal(hash(raw),d.rawSha256||d.uncompressedSha256);
  if(f.startsWith('preview-')){assert(stop<hd);assert.deepEqual(d.dimensions,[32,32,32]);if(f===c.previews[9].light.file)previewEnd=stop+endTag.length;}
  else{assert(i>hd);assert(gz.equals(fs.readFileSync(path.join(data,f))));nativeChars+=s.length;}
  i=b.indexOf(tag,stop+endTag.length);
 }assert.equal(specs.size,0);assert.deepEqual(order.slice(0,2),[c.previews[9].medium.file,c.previews[9].light.file]);assert.equal(nativeChars,52018020);
 console.table({before,after:{total:b.length,pack:size,main},delta:{total:b.length-before.total,pack:size-before.pack,main:main-before.main}});console.log({first,firstPreviewComplete:previewEnd,movie:film,nativeChars,originals:originals.length,previews:previews.length});return hash(b);}
const digest=offline();assert.equal(hash(fs.readFileSync(path.join(dir,'index.html'))),digest);
const http=fs.readFileSync(path.join(dir,'space-http.html'));assert.equal(pack(http).value.cinematic,null);assert(!http.includes(tag)&&!http.includes('<script>ORBIT_CINEMATIC_ASSETS.parsed('));console.log('通过：精确基线、双离线入口逐字节一致、所有 gzip/解压散列、块闭合和时序、在线入口无块。');
