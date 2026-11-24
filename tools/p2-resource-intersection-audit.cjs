'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {randomUUID,createHash}=require('node:crypto');
const root=path.resolve(__dirname,'..'), output=path.join(root,'.workbuddy','p2-resource-intersection-'+randomUUID());
fs.mkdirSync(output,{recursive:true});
const reportPath=path.join(output,'report.json'),hash=x=>createHash('sha256').update(x).digest('hex');
const result={status:'incomplete',startedAt:new Date().toISOString(),output,cases:[],errors:[],limitations:[
 '仅审计同一页面两棵场景树及其显式资源边，非全部闭包、全局变量、事件、renderer、GPU 或异步资源。',
 '只读仅指 Object.isFrozen 的浅冻结事实，不能证明内部内容只读；未冻结项均视作可变或未知，不推断所有权。',
 '预建宇宙层并 seek 至单个 lg=19.98，与自然播放不等价；异步资源可能尚未加载。',
 '资源路径每侧每对象最多保留 8 条；为避免循环，每侧同对象同类型只展开一次，路径计数不是完整可达路径数。仅递归普通对象、数组、uniform、纹理和列出的几何/材质边。',
 '场景遍历不包括自定义 Object3D 属性、动画、骨骼、渲染目标及材质之外的自定义引用；同一底层 GPU 资源的不同 JS 包装不会被识别。',
 '未执行状态恢复、视觉验证或生产隔离，结果不能证明隔离完成。'
]};
function save(){fs.writeFileSync(reportPath,JSON.stringify(result,null,2));}
function once(s,a,b){const i=s.indexOf(a);if(i<0||s.indexOf(a,i+a.length)>=0)throw Error('替换点缺失或不唯一 '+a);return s.slice(0,i)+b+s.slice(i+a.length);}
function inspect(inject){
 const s=window.__SE, main=s.scene, cosmos=s.CS.scene;
 if(!s.CS.built||!s.__audit.JOURNEY.frozen)throw Error('基线不满足');
 const synthetic=[];
 if(inject){
  const a=new s.THREE.Object3D(),b=new s.THREE.Object3D(),g=new s.THREE.BufferGeometry(),mat=new s.THREE.ShaderMaterial({uniforms:{shared:{value:new Float32Array([1,2,3])}}});
  const tex=new s.THREE.Texture();mat.uniforms.tex={value:tex};g.setAttribute('position',new s.THREE.BufferAttribute(new Float32Array([0,0,0]),3));
  const x=new s.THREE.Mesh(g,mat),y=new s.THREE.Mesh(g,mat);a.name='__audit_main';b.name='__audit_cosmos';a.add(x);b.add(y);main.add(a);cosmos.add(b);synthetic.push(a,b,g,mat,mat.uniforms,mat.uniforms.shared.value,tex,g.attributes.position.array,g.attributes.position.array.buffer);
 }
 const ids=new WeakMap();let next=1;const id=o=>{if(!ids.has(o))ids.set(o,next++);return ids.get(o);};
 const sides=[new Map(),new Map()];
 function collect(scene,side){
  const map=sides[side],expanded=new WeakMap();
  function add(o,kind,p){if(!o||typeof o!=='object')return false;let r=map.get(o);if(!r){r={id:id(o),type:o.constructor?.name||'Object',kinds:[],paths:[],pathCount:0,shallowFrozen:Object.isFrozen(o)};map.set(o,r);}if(!r.kinds.includes(kind))r.kinds.push(kind);r.pathCount++;if(r.paths.length<8)r.paths.push(p);return true;}
  function descend(o,kind,p,depth=0){
   if(!add(o,kind,p))return;
   if(depth>16)return;
   let kinds=expanded.get(o);if(!kinds){kinds=new Set();expanded.set(o,kinds);}if(kinds.has(kind))return;kinds.add(kind);
   if(ArrayBuffer.isView(o)){if(o.buffer)add(o.buffer,'arrayBuffer',p+'.buffer');return;}
   if(o instanceof ArrayBuffer)return;
   if(o.isTexture){if(o.source)descend(o.source,'textureSource',p+'.source',depth+1);if(o.image)descend(o.image,'textureImage',p+'.image',depth+1);return;}
   if(o.isBufferAttribute||o.isInterleavedBufferAttribute){if(o.array)descend(o.array,'typedArray',p+'.array',depth+1);if(o.data)descend(o.data,'interleavedBuffer',p+'.data',depth+1);return;}
   if(o.isInterleavedBuffer){if(o.array)descend(o.array,'typedArray',p+'.array',depth+1);return;}
   if(o.isBufferGeometry){if(o.index)descend(o.index,'attribute',p+'.index',depth+1);for(const [k,v] of Object.entries(o.attributes||{}))descend(v,'attribute',p+'.attributes.'+k,depth+1);for(const [k,v] of Object.entries(o.morphAttributes||{}))descend(v,'morphAttributes',p+'.morphAttributes.'+k,depth+1);return;}
   if(o.isMaterial){for(const [k,v] of Object.entries(o)){if(v&&typeof v==='object'){if(k==='uniforms')descend(v,'uniforms',p+'.uniforms',depth+1);else if(v.isTexture)descend(v,'texture',p+'.'+k,depth+1);else if(Array.isArray(v))descend(v,'materialArrayProperty',p+'.'+k,depth+1);}}return;}
   if(Array.isArray(o)){o.forEach((v,i)=>descend(v,kind==='materials'?'material':kind==='morphAttributes'?'attribute':'arrayValue',p+'['+i+']',depth+1));return;}
   const proto=Object.getPrototypeOf(o);
   if(proto===Object.prototype||proto===null||kind==='textureSource')for(const [k,v] of Object.entries(o)){if(v&&typeof v==='object')descend(v,kind==='uniforms'?'uniform':kind==='uniform'&&k==='value'?'uniformValue':'nestedValue',p+'.'+k,depth+1);}
  }
  scene.traverse(o=>{const p='scene.object#'+id(o)+(o.name?'('+o.name+')':'');add(o,'object3d',p);if(o.geometry)descend(o.geometry,'geometry',p+'.geometry');if(o.material)descend(o.material,Array.isArray(o.material)?'materials':'material',p+'.material');});
 }
 collect(main,0);collect(cosmos,1);
 const shared=[];for(const [o,a] of sides[0]){const b=sides[1].get(o);if(b)shared.push({id:a.id,type:a.type,kinds:[...new Set([...a.kinds,...b.kinds])],classification:a.shallowFrozen?'shallow-frozen-readonly-unproven':'mutable-or-unknown',main:{paths:a.paths,pathCount:a.pathCount},cosmos:{paths:b.paths,pathCount:b.pathCount}});}
 const counts=map=>{const c={};for(const r of map.values())for(const k of r.kinds)c[k]=(c[k]||0)+1;return c;};
 const sharedKinds={};for(const r of shared)for(const k of r.kinds)sharedKinds[k]=(sharedKinds[k]||0)+1;
 return {injected:inject,counts:{main:counts(sides[0]),cosmos:counts(sides[1]),shared:sharedKinds,sharedTotal:shared.length},shared,negativeControl:inject?{expected:synthetic.slice(2).map(o=>({id:id(o),detected:sides[0].has(o)&&sides[1].has(o)}))}:null};
}
async function run(){
 const files=['build.mjs','public/index.html','public/js/app.js','tools/test-deep-models.cjs',path.relative(root,__filename).replace(/\\/g,'/')];result.inputHashes=Object.fromEntries(files.map(f=>[f,hash(fs.readFileSync(path.join(root,f)))]));
 let b=fs.readFileSync(path.join(root,'build.mjs'),'utf8').replace(/\r\n/g,'\n');
 b=once(b,'const ROOT = path.dirname(fileURLToPath(import.meta.url));',`const ROOT = ${JSON.stringify(root)};`);
 b=once(b,"const app = read('js/app.js');","const app = read('js/app.js').replace('window.__SE = {', 'window.__SE = { __audit: {timeAtLg:cineTimeAtLg,JOURNEY,cosmicBuild},');");
 b=once(b,`for (const name of ['space.html', 'index.html']) {\n  fs.writeFileSync(path.join(ROOT, name), htmlOffline);\n}\nfs.writeFileSync(path.join(ROOT, 'space-http.html'), htmlHttp);`,`fs.writeFileSync(${JSON.stringify(path.join(output,'preview.html'))},htmlOffline,{flag:'wx'});`);
 await import('data:text/javascript;base64,'+Buffer.from(b).toString('base64'));result.previewSha256=hash(fs.readFileSync(path.join(output,'preview.html')));
 const framework=path.join(root,'tools/test-deep-models.cjs');let src=fs.readFileSync(framework,'utf8');const cut=src.indexOf('async function main() {');if(cut<0)throw Error('驱动入口缺失');src=src.slice(0,cut).replace("const profile = fs.mkdtempSync(path.join(parent, 'probe-deep-models-'));","const profile = fs.mkdtempSync(path.join(output, 'chrome-profile-'));");
 const driver=`(async()=>{try{await launch();await send('Page.addScriptToEvaluateOnNewDocument',{source:'(()=>{let x=0x13579bdf;Math.random=()=>{x^=x<<13;x^=x>>>17;x^=x<<5;return (x>>>=0)/4294967296}})()'});for(const inject of [false,true]){phase='独立页面 '+inject;await load(pathToFileURL(path.join(output,'preview.html')).href+'?auto=0&q=high&prewarm=0','file');await evaluate('__SE.__audit.cosmicBuild();__SE.journey(0);__SE.ts=0;__SE.journeySeek(__SE.__audit.timeAtLg(19.98));true');await frames(3);const x=await evaluate('('+inspect.toString()+')('+inject+')');result.cases.push(x);save();if(inject&&!x.negativeControl.expected.every(v=>v.detected))throw Error('注入共享资源未全部检出');}result.driver={browser:report.browser,gpu:report.gpu,launch:report.launch,errors:report.errors};if(report.errors.length)throw Error('浏览器记录错误');result.status='audit-complete-isolation-unproven';}catch(e){result.errors.push({phase,error:errorText(e)});}finally{if(browser){try{cleanupPromise=Promise.resolve();await browser.send('Browser.close');}catch(e){result.errors.push({phase:'关闭浏览器',error:errorText(e)});}browser.ws.close();}else if(child&&child.exitCode===null)child.kill();for(const [f,h] of Object.entries(result.inputHashes||{}))if(hash(fs.readFileSync(path.join(root,f)))!==h)result.errors.push({phase:'输入哈希',error:f+' 已变化'});if(result.errors.length)result.status='incomplete';result.finishedAt=new Date().toISOString();save();console.log(JSON.stringify({report:reportPath,status:result.status,cases:result.cases.map(x=>({injected:x.injected,counts:x.counts,negativeControl:x.negativeControl})),errors:result.errors},null,2));process.exitCode=result.errors.length?1:0;}})();`;
 vm.runInThisContext(`(function(require,__dirname,__filename,process,Buffer,WebSocket,output,result,save,hash,inspect,reportPath,root){${src}\n${driver}\n})`,{filename:framework})(require,__dirname,framework,process,Buffer,WebSocket,output,result,save,hash,inspect,reportPath,root);
}
save();run().catch(e=>{result.errors.push({phase:'构建或初始化',error:e.stack||String(e)});save();console.error(JSON.stringify({report:reportPath,errors:result.errors}));process.exitCode=1;});
