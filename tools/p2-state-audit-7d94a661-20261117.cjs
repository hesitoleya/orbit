'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {randomUUID,createHash}=require('node:crypto');
const root=path.resolve(__dirname,'..'),output=path.join(root,'.workbuddy','p2-state-audit-'+randomUUID());
fs.mkdirSync(output);const reportPath=path.join(output,'report.json'),hash=x=>createHash('sha256').update(x).digest('hex');
const result={status:'blocked',output,startedAt:new Date().toISOString(),node:process.version,cases:[],errors:[],limitations:['仅审计所列可观测字段，不是通用快照；不恢复闭包、GPU/WebGL、事件监听器、异步任务或外部副作用。','随机数和时间未冻结且未恢复；资源就绪未知。','仅 lg=19.98 单尺度，同步构造宇宙机位；非自然双场景，未作视觉或跨尺度验收。','字段恢复仅限测试机位 CS 标量与引用；其余污染保留并量化，不可用于产品页面。','DOM 仅比对 document.body.outerHTML，不包括 canvas 像素、shadow DOM 和事件监听器。','uniform 递归只遍历数组和普通对象，其他对象仅记录引用和可用 toArray；数组仅比较前 32 项及长度，差异只输出前 100 项且每个值最多 500 字符；材质、几何只审计所列字段。']};
function save(){fs.writeFileSync(reportPath,JSON.stringify(result,null,2));}
function once(s,a,b){let i=s.indexOf(a);if(i<0||s.indexOf(a,i+a.length)>=0)throw Error('替换点缺失或不唯一 '+a);return s.slice(0,i)+b+s.slice(i+a.length);}
function audit(mode){
 const s=window.__SE,p=s.__audit,cs=s.CS,T=s.THREE,gl=s.renderer.getContext();
 const ids=new WeakMap();let next=1;const id=o=>{if(o===null||typeof o!=='object'&&typeof o!=='function')return null;if(!ids.has(o))ids.set(o,next++);return ids.get(o);};
 const scalar=v=>typeof v==='number'&&!Number.isFinite(v)?String(v):v;
 function digest(a){let h=2166136261;const b=new Uint8Array(a.buffer,a.byteOffset,a.byteLength);for(let i=0;i<b.length;i++){h^=b[i];h=Math.imul(h,16777619);}return (h>>>0).toString(16).padStart(8,'0');}
 function value(v,depth=0,seen=new Set()){
  if(v===null||typeof v!=='object')return scalar(v);
  const r={ref:id(v),type:v.constructor?.name};
  if(ArrayBuffer.isView(v)){r.length=v.length;r.bytes=v.byteLength;r.hash=digest(v);return r;}
  if(typeof v.toArray==='function'){try{r.value=v.toArray().map(scalar);}catch(e){r.error=String(e);}return r;}
  if(depth>=4||seen.has(v))return r;seen.add(v);
  if(Array.isArray(v)){r.length=v.length;r.items=v.slice(0,32).map(x=>value(x,depth+1,seen));r.truncated=v.length>32;return r;}
  if(Object.getPrototypeOf(v)===Object.prototype||Object.getPrototypeOf(v)===null){r.props={};for(const k of Object.keys(v).sort())r.props[k]=value(v[k],depth+1,seen);}
  return r;
 }
 function capture(){
  const records={},objects=[];function put(k,v){records[k]=v;}
  for(const [sceneName,scene] of [['main',s.scene],['cosmos',cs.scene]])scene.traverse(o=>{objects.push([sceneName,o]);});
  for(const [sceneName,o] of objects){const base=sceneName+'.object#'+id(o);put(base+'.identity',{type:o.type,name:o.name,parent:id(o.parent),children:o.children.map(id),keys:Object.keys(o).sort()});
   for(const k of ['visible','matrixAutoUpdate','matrixWorldAutoUpdate','matrixWorldNeedsUpdate','renderOrder','frustumCulled'])put(base+'.'+k,scalar(o[k]));
   for(const k of ['position','rotation','quaternion','scale','up','matrix','matrixWorld'])if(o[k])put(base+'.'+k,value(o[k]));
   if(o.isCamera)for(const k of ['fov','aspect','near','far','zoom','projectionMatrix','projectionMatrixInverse','matrixWorldInverse'])put(base+'.camera.'+k,value(o[k]));
   const mats=Array.isArray(o.material)?o.material:[o.material];put(base+'.materialRefs',mats.map(id));
   for(const m of mats.filter(Boolean)){const b='material#'+id(m);put(b+'.keys',Object.keys(m).sort());for(const k of ['visible','opacity','transparent','version','color','emissive','uniforms'])if(k in m)put(b+'.'+k,value(m[k]));}
   if(o.geometry){const g=o.geometry,b='geometry#'+id(g);put(base+'.geometryRef',id(g));put(b+'.attributesKeys',Object.keys(g.attributes).sort());for(const [k,a] of Object.entries(g.attributes)){const ab=b+'.attribute.'+k;put(ab,{ref:id(a),array:value(a.array),version:a.version,itemSize:a.itemSize,count:a.count,normalized:a.normalized});}if(g.index)put(b+'.index',{ref:id(g.index),array:value(g.index.array),version:g.index.version});}
  }
  for(const k of Object.keys(cs).sort()){const v=cs[k];if(v===null||['number','boolean','string','undefined'].includes(typeof v))put('CS.'+k,scalar(v));else if(['target','upCur'].includes(k))put('CS.'+k,value(v));else put('CS.'+k+'.ref',id(v));}
  {const text=document.body.outerHTML;let h=2166136261;for(let i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,16777619);}put('dom.body',{length:text.length,hash:(h>>>0).toString(16)});}put('sceneCounts',Object.fromEntries(['main','cosmos'].map(n=>[n,objects.filter(x=>x[0]===n).length])));
  return records;
 }
 function diff(a,b){const changes=[];let count=0;for(const k of new Set([...Object.keys(a),...Object.keys(b)])){const av=JSON.stringify(a[k]),bv=JSON.stringify(b[k]);if(av!==bv){count++;if(changes.length<100)changes.push({path:k,before:av?.slice(0,500)??'[缺失]',after:bv?.slice(0,500)??'[缺失]'});}}return {count,changes,truncated:count>changes.length};}
 if(!p.JOURNEY.frozen||cs.active||!cs.built||Math.abs(p.JOURNEY.lg-19.98)>1e-8)throw Error('基线不满足');
 const saved={};for(const k of ['orbitR','theta','phi','autoCenter','upCur'])saved[k]=cs[k];const target=cs.target.clone();
 const before=capture(),t0=[Date.now(),performance.now()],frame=p.getFrame();let caught=null,updated,after;
 try{const d=s.camera.getWorldDirection(new T.Vector3());cs.orbitR=2e20*Math.pow(10,p.JOURNEY.lg-20);cs.theta=Math.atan2(-d.z,-d.x);cs.phi=Math.asin(Math.max(-1,Math.min(1,-d.y)));cs.target.set(0,0,0);cs.autoCenter=false;cs.upCur=s.camera.up.clone();window.__auditInterrupt=mode==='throw';p.cosmicUpdate(0);updated=capture();}
 catch(e){caught=String(e.message||e);updated=capture();}finally{window.__auditInterrupt=false;for(const k of Object.keys(saved))cs[k]=saved[k];cs.target.copy(target);after=capture();}
 const baselineDiff=diff(before,after);let negative=null;
 if(mode==='negative'){
  const object=cs.scene.children[0],old=object.visible;object.visible=!old;object.matrixAutoUpdate=!object.matrixAutoUpdate;object.__auditInjected=1;
  const nd=diff(after,capture());negative={count:nd.count,changes:nd.changes.filter(x=>x.path.includes('object#'+id(object)+'.'))};
 }
 const debug=gl.getExtension('WEBGL_debug_renderer_info');return {mode,caught,interruptEvidence:window.__auditEvidence||null,frameBefore:frame,frameAfter:p.getFrame(),clockBefore:t0,clockAfter:[Date.now(),performance.now()],context:{version:gl.getParameter(gl.VERSION),vendor:debug?gl.getParameter(debug.UNMASKED_VENDOR_WEBGL):null,renderer:debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):null,lost:gl.isContextLost()},recordCount:Object.keys(before).length,updateDiff:diff(before,updated||after),restoreDiff:baselineDiff,negative};
}
async function run(){
 const files=['build.mjs','public/index.html','public/js/app.js','tools/test-deep-models.cjs',path.relative(root,__filename).replace(/\\/g,'/')];result.inputHashes=Object.fromEntries(files.map(f=>[f,hash(fs.readFileSync(path.join(root,f)))]));
 let b=fs.readFileSync(path.join(root,'build.mjs'),'utf8').replace(/\r\n/g,'\n');b=once(b,'const ROOT = path.dirname(fileURLToPath(import.meta.url));',`const ROOT = ${JSON.stringify(root)};`);b=once(b,"const app = read('js/app.js');","const app = read('js/app.js').replace('window.__SE = {', 'window.__SE = { __audit: {timeAtLg:cineTimeAtLg,JOURNEY,cosmicBuild,cosmicUpdate,getFrame:()=>frameId},').replace('  CS.cam.matrixWorldInverse.copy(CS.cam.matrixWorld).invert();', '  CS.cam.matrixWorldInverse.copy(CS.cam.matrixWorld).invert(); if(window.__auditInterrupt){window.__auditEvidence={unit:CS.unit, cameraMatrix:CS.cam.matrixWorld.elements.slice(),inverseMatrix:CS.cam.matrixWorldInverse.elements.slice()};throw Error(\"injected:cosmicUpdate-after-camera-before-pxPerRad\");}');");b=once(b,`for (const name of ['space.html', 'index.html']) {\n  fs.writeFileSync(path.join(ROOT, name), htmlOffline);\n}\nfs.writeFileSync(path.join(ROOT, 'space-http.html'), htmlHttp);`,`fs.writeFileSync(${JSON.stringify(path.join(output,'preview.html'))},htmlOffline,{flag:'wx'});`);await import('data:text/javascript;base64,'+Buffer.from(b).toString('base64'));result.previewSha256=hash(fs.readFileSync(path.join(output,'preview.html')));
 const framework=path.join(root,'tools/test-deep-models.cjs');let src=fs.readFileSync(framework,'utf8');src=src.slice(0,src.indexOf('async function main() {')).replace("const profile = fs.mkdtempSync(path.join(parent, 'probe-deep-models-'));","const profile = fs.mkdtempSync(path.join(output, 'chrome-profile-'));");
 const driver=`(async()=>{try{await launch();for(const mode of ['normal','throw','negative']){phase='独立页面 '+mode;await load(pathToFileURL(path.join(output,'preview.html')).href+'?auto=0&q=high&prewarm=0','file');await evaluate('__SE.__audit.cosmicBuild();__SE.journey(0);__SE.ts=0;__SE.journeySeek(__SE.__audit.timeAtLg(19.98));true');await frames(3);const x=await evaluate('('+audit.toString()+')('+JSON.stringify(mode)+')');result.cases.push(x);save();if(mode==='throw'&&(x.caught!=='injected:cosmicUpdate-after-camera-before-pxPerRad'||!x.interruptEvidence))throw Error('未验证 cosmicUpdate 中途故障');if(mode!=='throw'&&x.caught)throw Error('意外异常 '+x.caught);}result.driver={browser:report.browser,gpu:report.gpu,launch:report.launch,errors:report.errors};}catch(e){result.errors.push({phase,error:errorText(e)});}finally{if(browser){try{cleanupPromise=Promise.resolve();await browser.send('Browser.close');}catch(e){result.errors.push({phase:'关闭浏览器',error:errorText(e)});}browser.ws.close();}else if(child&&child.exitCode===null)child.kill();for(const [f,h] of Object.entries(result.inputHashes))if(hash(fs.readFileSync(path.join(root,f)))!==h)result.errors.push({phase:'输入哈希',error:f+' 已变化'});result.finishedAt=new Date().toISOString();result.exitCode=1;save();console.log(JSON.stringify({report:reportPath,status:result.status,counts:result.cases.map(x=>({mode:x.mode,update:x.updateDiff.count,after:x.restoreDiff.count,negative:x.negative?.count,caught:x.caught})),errors:result.errors},null,2));process.exitCode=1;}})();`;
 vm.runInThisContext(`(function(require,__dirname,__filename,process,Buffer,WebSocket,output,result,save,hash,audit,reportPath,root){${src}\n${driver}\n})`,{filename:framework})(require,__dirname,framework,process,Buffer,WebSocket,output,result,save,hash,audit,reportPath,root);
}
save();run().catch(e=>{result.errors.push({phase:'构建或初始化',error:e.stack||String(e)});result.exitCode=1;save();console.error(JSON.stringify({report:reportPath,errors:result.errors}));process.exitCode=1;});
