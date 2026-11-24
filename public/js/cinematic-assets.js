/* Orbit cinematic volume streaming. Original baked fields, not observational reconstruction.
 * Native gzip + RGBA8 3D textures; lazy loads only the inspected hero volume.
 * No dependency/CDN, embedded offline payload uses exactly the same verified bytes.
 */
(function(root){'use strict';
 const TYPES=new Set([6,7,8,9,10,11,12,13]), cache=new Map(), pending=new Map(), errors=new Map();
 let T=null,renderer=null,manifest=null,manifestPromise=null,detail=null,activeType=null,enabled=true,disposed=false;
 const MAX_RAW_BYTES=96*1024*1024;
 let selection=null, drawnPreview=null, handoff=null;
 const M16_BLEND_MS=360;
 function endHandoff(){
  if(!handoff)return;
  const h=handoff;handoff=null;clearTimeout(h.timer);release(h.preview);
 }
 // 只保留在 M16 有效绘制中借用过的预览。未绘制、离线块未提供或其他柱状目标都不创建过渡。
 function m16Draw(asset,quality){
  if(activeType!==9 || !asset || cache.get(9)!==asset || !enabled)return null;
  if(asset.lod==='preview')return null;
  if(!handoff || handoff.native!==asset)return null;
  if(quality==='low'){endHandoff();return null;}
  const h=handoff,t=h.start===null?0:Math.min(1,Math.max(0,(performance.now()-h.start)/M16_BLEND_MS));
  if(t===1){endHandoff();return null;}
  h.weight=t*t*(3-2*t);return h;
 }
 function m16Drawn(asset){
  // 上传/首次编译不占用插值时间；隐藏后即使再无绘制也会归还预览。
  if(!asset || activeType!==9 || cache.get(9)!==asset)return;
  if(asset.lod==='preview'){drawnPreview=asset;return;}
  if(handoff?.native===asset && handoff.start===null){
   clearTimeout(handoff.timer);handoff.start=performance.now();handoff.timer=setTimeout(endHandoff,M16_BLEND_MS+150);
  }
 }
 const closedBlocks=new Set(), waiters=new Map(); let endOfBlocks=false;
 // 只发布小文件名。只有挂起的当前需求才触碰相应节点的正文。
 function parsed(file){
  if(file===null){endOfBlocks=true;for(const wake of [...waiters.values()])wake();return;}
  closedBlocks.add(file);waiters.get(file)?.();
 }
 function check(signal){if(signal?.aborted)throw Error('Superseded volume load');}
 async function packedBytes(spec,signal){
  const file=spec.file;check(signal);
  if(!closedBlocks.has(file)&&!endOfBlocks&&document.readyState==='loading')await new Promise(resolve=>{
   function wake(){waiters.delete(file);document.removeEventListener('DOMContentLoaded',wake);signal?.removeEventListener('abort',wake);resolve();}
   waiters.set(file,wake);document.addEventListener('DOMContentLoaded',wake);signal?.addEventListener('abort',wake);
  });
  check(signal);
  const node=document.getElementById('orbit-cine-'+file),text=node?.type==='application/octet-stream'?node.textContent:'';
  if(!spec.compressedBytes || text.length!==4*Math.ceil(spec.compressedBytes/3))throw Error('Truncated volume block: '+file);
  return decode64(text);
 }
 let decodeTail=Promise.resolve();
 async function serializedDecode(work){const before=decodeTail;let done;decodeTail=new Promise(resolve=>{done=resolve;});await before;try{return await work();}finally{done();}}
 function emit(){if(root.dispatchEvent&&root.CustomEvent)root.dispatchEvent(new root.CustomEvent('orbit-cinematic-status',{detail:status()}));}
 function status(){return {enabled,previewTypes:Object.keys(pack()?.previews||{}).map(Number),supported:!renderer||!!renderer.capabilities.isWebGL2,activeType,loading:Array.from(pending.keys()),ready:Array.from(cache.keys()),errors:Array.from(errors.entries()).map(([type,message])=>({type,message})),gpuBytes:Array.from(cache.values()).reduce((n,a)=>n+a.gpuBytes,(detail?detail.image.data.byteLength:0)+(handoff?handoff.preview.gpuBytes:0)),profiles:manifest?manifest.profiles.map(p=>({id:p.id,type:p.type,size:p.medium.dimensions[0],dimensions:p.medium.dimensions.slice()})):[],diagnostics:Array.from(cache.values()).map(a=>({type:a.type,lod:a.lod,dimensions:[a.density.image.width,a.density.image.height,a.density.image.depth],directionalShading:!!a.shading,shadingEncoding:a.shadingEncoding,shadingTranscodeMs:a.shadingTranscodeMs,gpuBytes:a.gpuBytes}))};}
 function base(){return root.__ORBIT_CINEMATIC_BASE__||'./data/cinematic-nebula/';}
 function pack(){return (root.__ORBIT_INLINE__||{}).cinematic||null;}
 function safeFile(name){if(typeof name!=='string'||!/^[-a-zA-Z0-9_.]+\.bin\.gz$/.test(name))throw Error('Invalid cinematic asset filename');return name;}
 async function metadata(){
  if(manifest)return manifest;
  if(!manifestPromise)manifestPromise=(async()=>{
   const embedded=pack();let m;
   if(embedded||root.__ORBIT_INLINE__?.movieBase64Lengths){if(!embedded?.manifest)throw Error('Missing offline volume manifest');m=embedded.manifest;}
   else{const res=await fetch(base()+'manifest.json');if(!res.ok)throw Error('Volume manifest HTTP '+res.status);m=await res.json();}
   if(m.schemaVersion!==1||!Array.isArray(m.profiles)||!m.profiles.length)throw Error('Unsupported volume manifest');
   for(const p of m.profiles){if(!TYPES.has(p.type))throw Error('Unsupported hero type');for(const role of ['medium','light','occupancy','shading'])if(p[role])safeFile(p[role].file);}
   manifest=m;return m;
  })().catch(e=>{manifestPromise=null;throw e;});
  return manifestPromise;
 }
 function decode64(s){const binary=atob(s),out=new Uint8Array(binary.length);for(let i=0;i<binary.length;i++)out[i]=binary.charCodeAt(i);return out;}
 async function sha(bytes){if(!root.crypto||!root.crypto.subtle)return null;return Array.from(new Uint8Array(await root.crypto.subtle.digest('SHA-256',bytes))).map(n=>n.toString(16).padStart(2,'0')).join('');}
 async function bytes(spec,signal){
  check(signal);
  safeFile(spec.file);const dims=spec.dimensions;
  if(!Array.isArray(dims)||dims.length!==3||!dims.every(n=>Number.isInteger(n)&&n>0&&n<=512))throw Error('Invalid volume dimensions');
  const expected=dims[0]*dims[1]*dims[2]*spec.channels;
  if(![1,4].includes(spec.channels)||expected>MAX_RAW_BYTES||(spec.rawBytes||spec.uncompressedBytes)&&(spec.rawBytes||spec.uncompressedBytes)!==expected)throw Error('Invalid volume byte count');
  let compressed,embedded=pack();
  if(embedded){
   if(!root.crypto?.subtle || !spec.sha256 || !(spec.rawSha256||spec.uncompressedSha256))throw Error('Missing offline integrity metadata or SHA-256');
   compressed=await packedBytes(spec,signal);
   if(compressed.length!==spec.compressedBytes)throw Error('Compressed size mismatch: '+spec.file);
  }
  else{const response=await fetch(base()+spec.file,{signal});if(!response.ok)throw Error('Volume HTTP '+response.status+': '+spec.file);compressed=new Uint8Array(await response.arrayBuffer());}
  const gzipHash=await sha(compressed);if(spec.sha256&&gzipHash&&gzipHash!==spec.sha256)throw Error('Compressed volume integrity mismatch: '+spec.file);
  check(signal);if(typeof root.DecompressionStream!=='function')throw Error('This browser requires native gzip decompression');
  const reader=new Blob([compressed]).stream().pipeThrough(new root.DecompressionStream('gzip')).getReader();
  const out=new Uint8Array(expected);let offset=0;
  try{for(;;){const {value,done}=await reader.read();check(signal);if(done)break;if(offset+value.length>expected)throw Error('Volume exceeds declared size');out.set(value,offset);offset+=value.length;}}
  catch(e){await reader.cancel().catch(()=>{});throw e;}finally{reader.releaseLock();}
  if(offset!==expected)throw Error('Truncated volume: '+spec.file);
  const rawHash=await sha(out);if((spec.rawSha256||spec.uncompressedSha256)&&rawHash&&rawHash!==(spec.rawSha256||spec.uncompressedSha256))throw Error('Decoded volume integrity mismatch: '+spec.file);
  return out;
 }
 function texture(data,spec,repeat){
  const gl=renderer.getContext(),limit=gl.getParameter(gl.MAX_3D_TEXTURE_SIZE);
  if(spec.dimensions.some(n=>n>limit))throw Error('GPU 3D texture limit '+limit);
  const d=spec.dimensions,t=new T.Data3DTexture(data,d[0],d[1],d[2]);t.format=spec.channels===1?T.RedFormat:T.RGBAFormat;t.type=T.UnsignedByteType;
  t.colorSpace=T.NoColorSpace;t.unpackAlignment=1;t.minFilter=T.LinearFilter;t.magFilter=T.LinearFilter;t.generateMipmaps=false;
  if(spec.file.includes('occupancy')||spec.file.includes('shading')){t.minFilter=T.NearestFilter;t.magFilter=T.NearestFilter;}
  t.wrapS=t.wrapT=t.wrapR=repeat?T.RepeatWrapping:T.ClampToEdgeWrapping;t.needsUpdate=true;return t;
 }
 // Transcode verified nearest-oct cache to a linearly filterable lighting closure.
 // Normals only feed this bounded view-independent response; gas emission stays separate.
 function filterableShading(raw){
  const out=new Uint8Array(raw.length),lut=new Float64Array(65536*3);
  // Bounded 1.5MiB temporary lookup: no millions of arrays or repeated normalizations.
  for(let a=0;a<256;a++)for(let b=0;b<256;b++){let x=a/255*2-1,y=b/255*2-1,z=1-Math.abs(x)-Math.abs(y);if(z<0){const ox=x;x=(1-Math.abs(y))*(ox>=0?1:-1);y=(1-Math.abs(ox))*(y>=0?1:-1);}const l=Math.hypot(x,y,z),j=(a*256+b)*3;lut[j]=x/l;lut[j+1]=y/l;lut[j+2]=z/l;}
  for(let i=0;i<raw.length;i+=4){const n=(raw[i]*256+raw[i+1])*3,d=(raw[i+2]*256+raw[i+3])*3;for(let k=0;k<3;k++)out[i+k]=Math.round((lut[d+k]*.5+.5)*255);out[i+3]=Math.round(Math.max(0,-lut[n]*lut[d]-lut[n+1]*lut[d+1]-lut[n+2]*lut[d+2])*255);}
  return out;
 }
 async function detailTexture(m,signal){
  if(detail||!m.detail)return detail;
  const raw=await bytes(m.detail,signal);check(signal);return detail=texture(raw,m.detail,true);
 }
 function release(a){for(const name of ['density','light','occupancy','shading'])if(a[name])a[name].dispose();}
 function cancel(){drawnPreview=null;endHandoff();selection?.abort();selection=null;pending.clear();activeType=null;emit();}
 async function load(type,quality){
  type=Number(type);if(!enabled||!TYPES.has(type)||disposed)return null;
  const preview=pack()?.previews?.[type],target=preview&&quality==='low'?'preview':'native';
  if(activeType===type && target==='preview' && handoff){
   // 降档时旧预览仍有效，直接转回缓存所有权，无需再次解压或先闪到原生层。
   const h=handoff;handoff=null;clearTimeout(h.timer);cache.set(type,h.preview);release(h.native);cancel();activeType=type;emit();return h.preview;
  }
  if(activeType===type && selection?.target===target && pending.has(type))return pending.get(type);
  if(handoff && activeType===type && cache.get(type)?.lod===target)return cache.get(type);
  const previousDraw=activeType===type && target==='native'?drawnPreview:null;
  if(selection || handoff)cancel();
  drawnPreview=previousDraw;activeType=type;errors.delete(type);
  if(cache.get(type)?.lod===target){const a=cache.get(type);a.lastUsed=performance.now();emit();return a;}
  if(!T||!renderer)throw Error('Cinematic assets not initialized');
  const controller=selection=new AbortController(),signal=controller.signal;controller.target=target;
  const task=serializedDecode(async()=>{
   check(signal);const m=await metadata(),native=m.profiles.find(p=>p.type===type);if(!native)throw Error('Missing volume profile '+type);
   for(const lod of (preview && !cache.has(type) && target==='native'?['preview','native']:[target])){
   check(signal);const p=lod==='preview'?{...native,...preview,occupancy:null,shading:null,disableDetail:true}:native;
   const [medium,light,occupied,shading,tile]=await Promise.all([bytes(p.medium,signal),bytes(p.light,signal),p.occupancy?bytes(p.occupancy,signal):null,p.shading?bytes(p.shading,signal):null,p.disableDetail?null:detailTexture(m,signal)]);
   check(signal);
   const a={ready:true,id:p.id,type,density:null,light:null,occupancy:null,shading:null,shadingEncoding:shading?'incoming-cartesian-response-unorm8':null,detail:p.disableDetail?null:tile,size:p.medium.dimensions[0],sigmaMax:p.sigmaMax||12,emissionScale:p.emissionScale||4,lightScale:p.lightScale||4,lightPosition:p.lightPosition||[0,.25,.1],scatteringAlbedo:p.scatteringAlbedo||[.55,.55,.55],emissionEncoding:p.emissionEncoding||'linear-unorm8',occupancyGrid:p.occupancy?p.occupancy.dimensions[0]:0,gpuBytes:medium.byteLength+light.byteLength+(occupied?occupied.byteLength:0)+(shading?shading.byteLength:0),lastUsed:performance.now()};
   try{a.density=texture(medium,p.medium);a.light=texture(light,p.light);if(occupied)a.occupancy=texture(occupied,p.occupancy);if(shading){const started=performance.now();const filtered=filterableShading(shading);a.shadingTranscodeMs=performance.now()-started;a.shading=texture(filtered,p.shading);a.shading.minFilter=T.LinearFilter;a.shading.magFilter=T.LinearFilter;}}
   catch(e){release(a);throw e;}
   a.lod=lod;
   const old=cache.get(type);cache.set(type,a);errors.delete(type);
   const cube=(tex,n)=>tex.image.width===n && tex.image.height===n && tex.image.depth===n;
   if(old && old===drawnPreview && type===9 && old.lod==='preview' && lod==='native' &&
      cube(old.density,32) && cube(old.light,32) && cube(a.density,256) && renderer.capabilities.maxTextures>=8 && renderer.capabilities.maxVertexTextures>=2){
    handoff={preview:old,native:a,weight:0,start:null,timer:setTimeout(endHandoff,1500)};
   }else if(old)release(old);
   drawnPreview=null;
   // Keep only the active hero + one previous volume, not every nebula ever visited.
   while(cache.size>2||Array.from(cache.values()).reduce((n,a)=>n+a.gpuBytes,handoff?handoff.preview.gpuBytes:0)>144*1024*1024){let candidate=null;for(const [key,value]of cache)if(key!==activeType&&(!candidate||value.lastUsed<candidate[1].lastUsed))candidate=[key,value];if(!candidate)break;release(candidate[1]);cache.delete(candidate[0]);}
   emit();
   }
   return cache.get(type);
  }).catch(e=>{if(!signal.aborted){controller.abort();errors.set(type,String(e.message||e));console.warn('Cinematic volume unavailable',e);}return null;}).finally(()=>{if(selection===controller){pending.delete(type);emit();}});
  pending.set(type,task);emit();return task;
 }
 function init(three,r){T=three;renderer=r;if(!r.capabilities.isWebGL2)enabled=false;return status();}
 function setEnabled(on){enabled=!!on&&(!renderer||renderer.capabilities.isWebGL2);if(!enabled)cancel();else emit();return enabled;}
 function dispose(){disposed=true;cancel();cache.forEach(release);cache.clear();if(detail)detail.dispose();detail=null;emit();}
 root.ORBIT_CINEMATIC_ASSETS={init,load,cancel,parsed,m16Draw,m16Drawn,m16Current:asset=>handoff?.native===asset?handoff:null,get:type=>enabled?cache.get(Number(type))||null:null,status,setEnabled,dispose};
})(typeof window!=='undefined'?window:globalThis);
