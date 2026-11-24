// node tools/test-offline-photo-hd.mjs [隔离构建目录 [拆分前的 HTML]]；只读，无浏览器。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url)), src=p=>fs.readFileSync(path.join(root,p),'utf8');
const helper=src('public/js/offline-photo-hd.js'), html=src('public/index.html'), app=src('public/js/app.js');
const viewer=html.slice(html.indexOf('(function(){',html.indexOf('对话 143：超高清影像查看器')),html.indexOf('</script>',html.indexOf('window.OrbitHD =')));
const tick=()=>new Promise(r=>setImmediate(r)), prefix='data:image/jpeg;base64,';
function fixture(offline=true){
  const listeners={}, nodes={}, ui={}, assigned=[], reads=[];
  function element(id){return {style:{},classList:{on:false,add(){this.on=true},remove(){this.on=false},contains(){return this.on}},
    removeAttribute(k){delete this['_'+k];if(k==='href')delete this.href},focus(){},replaceChildren(){},addEventListener(){},naturalWidth:200,naturalHeight:100,
    cloneNode(){return element(id)},replaceWith(n){ui[id]=n},set src(url){assigned.push(url);this._src=url},get src(){return this._src}};}
  const document={readyState:'loading',querySelector:id=>ui[id]??=element(id),addEventListener(k,f){(listeners[k]??=[]).push(f)},
    getElementById(id){reads.push(id);return nodes[id]},activeElement:element('button')};
  const c=vm.createContext({document,location:{protocol:offline?'file:':'https:'},addEventListener(){},DOMException,fetch(){throw Error('不应发请求')}});c.window=c;
  if(offline)vm.runInContext(helper,c);vm.runInContext(viewer,c);
  const emit=k=>(listeners[k]||[]).forEach(fn=>fn());
  const put=(key,text)=>nodes['orbit-photo-hd-'+key]={type:'application/octet-stream',textContent:text};
  return {c,ui,reads,assigned,emit,put};
}
const f=fixture(), pack={photoHDLengths:{a:4,b:4},photo:{b:'BBBB'},galCloseHD:{}};
assert.deepEqual(f.reads,[]); f.c.OrbitHD.open('a');await tick();assert.deepEqual(f.assigned,[]);
f.c.__ORBIT_INLINE__=pack;f.put('a','AA');f.put('b','BB');f.c.OrbitHD.open('b');await tick();assert.deepEqual(f.assigned,[]);
f.put('a','AAAA');f.put('b','BBBB'.toLowerCase());f.emit('orbit-photo-hd-parsed');await tick();assert.deepEqual(f.assigned,[prefix+'bbbb']);
const stale=f.ui['#hvImg'];stale.onerror();await tick();assert.equal(f.assigned.at(-1),prefix+'BBBB');
stale.onerror();await tick();assert.match(f.ui['#hvInfo'].textContent,/暂无/);
f.c.OrbitHD.open('a');await tick();const before=f.assigned.length;stale.onerror();stale.onload();await tick();assert.equal(f.assigned.length,before);assert.equal(f.ui['#hvOpen'].href,undefined);
f.ui['#hvImg'].onload();assert.equal(f.ui['#hvOpen'].href,prefix+'AAAA');f.ui['#hvClose'].onclick();assert.equal(f.ui['#hvOpen'].href,undefined);
const early=fixture();early.c.__ORBIT_INLINE__=pack;early.c.OrbitHD.open('a');await tick();early.ui['#hvClose'].onclick();early.put('a','AAAA');early.emit('orbit-photo-hd-parsed');await tick();assert.deepEqual(early.assigned,[]);
const missing=fixture();missing.c.__ORBIT_INLINE__=pack;missing.put('b','B');missing.c.OrbitHD.open('b');await tick();missing.emit('DOMContentLoaded');await tick();assert.deepEqual(missing.assigned,[prefix+'BBBB']);
const online=fixture(false);online.c.OrbitHD.open('b');assert.equal(online.assigned[0],'./data/hd/b.jpg');
assert([...f.assigned,...missing.assigned].every(u=>u.startsWith(prefix)));
// 运行生产场景取图入口，检查提前需求、损坏回退，以及在线与对照开关。
const scene=fixture();scene.c.__ORBIT_INLINE__=pack;scene.c.params=new URLSearchParams();
vm.runInContext(app.slice(app.indexOf('function photoHDURL('),app.indexOf('function pickPhoto(')),scene.c);
const loads=[],loader={load(u,ok,progress,fail){loads.push(u);fail()}},fallback=()=>loads.push('fallback');
scene.c.loadSceneHD('a',loader,()=>{},fallback);await tick();assert.deepEqual(loads,[]);scene.put('a','AAAA');scene.emit('orbit-photo-hd-parsed');await tick();assert.deepEqual(loads,[prefix+'AAAA','fallback']);
scene.c.params.set('photoHD','0');scene.c.loadSceneHD('a',loader,()=>{},fallback);assert.equal(loads.at(-1),'fallback');
// 正在等解析的观测体积句柄释放后，不得创建 Image；无缩略图的专属星云不能打文件路径。
const field=fixture();field.c.__ORBIT_INLINE__=pack;let pic;
field.c.Image=class{constructor(){pic=this}removeAttribute(){}};const T={Group:class{removeFromParent(){}clear(){}}};
vm.runInContext(src('public/js/reference-deep-volume.js'),field.c);
const target={id:'a',photoKey:'a',kind:'nebula'}, gone=field.c.OrbitReferenceDeepVolume.create(T,target);await tick();gone.dispose();field.emit('orbit-photo-hd-parsed');await assert.rejects(gone.ready,{name:'AbortError'});assert.equal(pic,undefined);
await assert.rejects(field.c.OrbitReferenceDeepVolume.create(T,target).ready,/缺少内联/);
field.put('a','AAAA');const valid=field.c.OrbitReferenceDeepVolume.create(T,target);await tick();assert.equal(pic.src,prefix+'AAAA');pic.onerror();await assert.rejects(valid.ready,/无法加载/);
console.log('通过：逐键等待、短块、缺块、解码失败、重开、关闭、过期句柄、在线 URL。');
function packaged(file,mode){
  const buf=fs.readFileSync(file), marker=Buffer.from('window.__ORBIT_INLINE__='), start=buf.indexOf(marker)+marker.length,end=buf.indexOf(';</script>',start);
  assert(start>=marker.length&&end>start);const p=JSON.parse(buf.toString('utf8',start,end));
  const main=buf.indexOf("<script>(function () {\n'use strict';",end), block='<script id="orbit-photo-hd-',first=buf.indexOf(block,end),movie=buf.indexOf('<script id="bhReferenceVideo"',end);
  const summary={total:buf.length,pack:end-start,main};
  if(mode==='old')return summary;
  if(mode==='http'){assert.equal(main,-1);assert.equal(first,-1);assert.deepEqual(p.photoHD,{});assert(!p.photoHDLengths);assert(!buf.includes(helper));return summary;}
  assert(!Object.hasOwn(p,'photoHD'));assert(buf.includes(helper));assert(buf.indexOf('</script>',main)<first && main>0 && first<movie);
  const keys=new Set(p.photoHDKeys);assert.equal(keys.size,Object.keys(p.photoHDLengths).length);
  let i=first, bytes=0, raw=0;while(i!==-1){
    const e=buf.indexOf('>',i),h=buf.toString('ascii',i,e+1),key=/^<script id="orbit-photo-hd-([\w-]+)" type="application\/octet-stream">$/.exec(h)?.[1];assert(keys.delete(key),h);
    const stop=buf.indexOf('</script>',e);assert(stop<movie);const data=buf.toString('ascii',e+1,stop),image=fs.readFileSync(path.join(root,'public/data/photo-hd',key+'.jpg'));
    assert.equal(data.length,p.photoHDLengths[key]);assert.equal(data,image.toString('base64'));bytes+=data.length;raw+=image.length;
    i=buf.indexOf(block,stop+9);
  }
  assert.equal(keys.size,0);const signal=buf.indexOf("<script>document.dispatchEvent(new Event('orbit-photo-hd-parsed'))</script>",first);assert(signal>first && signal<movie);
  return {...summary,count:p.photoHDKeys.length,bytes,raw,index:Buffer.byteLength(JSON.stringify(p.photoHDLengths)),first,movie};
}
if(process.argv[2]){
  const dir=process.argv[2];console.log('离线',packaged(path.join(dir,'space.html'),'new'));console.log('在线',packaged(path.join(dir,'space-http.html'),'http'));
  if(process.argv[3])console.log('拆分前',packaged(process.argv[3],'old'));
}
