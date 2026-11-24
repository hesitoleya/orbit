'use strict';
// 独立浏览器实验：复用交集审计的隔离预览与 CDP，产品代码不落盘修改。
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const base=path.join(__dirname,'p2-resource-intersection-audit.cjs');
let src=fs.readFileSync(base,'utf8');
src=src.replace('p2-resource-intersection-','p2-shared-lifecycle-');
src=src.replace('function save(){', `result.limitations=['预建宇宙场景后监听共享 geometry，预建和监听之前的操作不可见；跨层为自然旅程，返回为手动停止和调用 cosmosLeave。','只比较采样时数组内容摘要、attribute 版本及 Sprite 可见性和位置缩放；不能发现采样间写后复原、哈希碰撞、其他属性或 GPU 状态变化。','仅监听基线共享 geometry 的 dispose 事件，不覆盖材质、纹理、后续新增共享对象或未遍历到的资源；故障注入发生在独立页面末尾。','单次固定随机种子、离线页面和有限旅程范围，不证明只读、资源所有权、完整生命周期或生产隔离。'];\nfunction save(){`);
const start=src.indexOf('function inspect(inject){'),end=src.indexOf('async function run(){');
if(start<0||end<0)throw Error('交集审计结构已变化');
function inspect(action){
 const s=window.__SE;
 if(action==='install'){
  const m=new Set();s.scene.traverse(o=>{if(o.geometry)m.add(o.geometry)});
  const common=new Set();s.CS.scene.traverse(o=>{if(o.geometry&&m.has(o.geometry))common.add(o.geometry)});
  const entries=[...common].map((g,i)=>{const arrays=[];const seen=new Set();for(const a of [g.index,...Object.values(g.attributes)]){const ar=a?.array;if(ar&&!seen.has(ar)){seen.add(ar);arrays.push(ar)}}const e={id:i,geo:g,arrays,events:[]};g.addEventListener('dispose',()=>e.events.push({at:performance.now(),stack:new Error().stack}));return e});
  window.__lifecycle={entries};return {count:entries.length};
 }
 const state=window.__lifecycle;
 function digest(a){let h=2166136261;const b=new Uint8Array(a.buffer,a.byteOffset,a.byteLength);for(let i=0;i<b.length;i++){h^=b[i];h=Math.imul(h,16777619)}return (h>>>0).toString(16)}
 function refs(g,scene){const found=[];scene.traverse(o=>{if(o.geometry===g)found.push({uuid:o.uuid,type:o.type,visible:o.visible,position:o.position.toArray(),scale:o.scale.toArray()})});return found}
 if(action==='control'){
  const e=state.entries[0],a=e.arrays[0];if(!a||!a.length)throw Error('无可写数组');a[0]=a[0]===0?1:0;e.geo.dispose();
 }
 return {at:performance.now(),journey:{on:s.__audit.JOURNEY.on,frozen:s.__audit.JOURNEY.frozen,lg:s.__audit.JOURNEY.lg,cs:s.CS.active},entries:state.entries.map(e=>({id:e.id,uuid:e.geo.uuid,type:e.geo.type,parameters:e.geo.parameters,mainObjects:refs(e.geo,s.scene),cosmosObjects:refs(e.geo,s.CS.scene),arrays:e.arrays.map(a=>({type:a.constructor.name,length:a.length,hash:digest(a)})),versions:[e.geo.index,...Object.values(e.geo.attributes)].map(a=>a?.version??a?.data?.version??null),events:e.events}))};
}
src=src.slice(0,start)+inspect.toString()+'\n'+src.slice(end);
const ds=src.indexOf(' const driver=`'),de=src.indexOf('\n vm.runInThisContext',ds);
if(ds<0||de<0)throw Error('驱动结构已变化');
const driver=` const driver=\`(async()=>{try{await launch();await send('Page.addScriptToEvaluateOnNewDocument',{source:'(()=>{let x=0x13579bdf;Math.random=()=>{x^=x<<13;x^=x>>>17;x^=x<<5;return (x>>>=0)/4294967296}})()'});phase='加载';await load(pathToFileURL(path.join(output,'preview.html')).href+'?auto=0&q=high&prewarm=0','file');await evaluate('__SE.__audit.cosmicBuild();true');await frames(3);const call=action=>evaluate('('+inspect.toString()+')('+JSON.stringify(action)+')');result.install=await call('install');if(!result.install.count)throw Error('未发现共享几何');const snap=async label=>{result.cases.push({label,data:await call('snapshot')});save()};await snap('预建基线');phase='自然旅程';await evaluate('__SE.journey(0);true');await until('自然旅程跨层',async()=>{const x=await evaluate('({on:__SE.__audit.JOURNEY.on,lg:__SE.__audit.JOURNEY.lg,cs:__SE.CS.active})');return x.on&&x.cs&&x.lg>20.05},45000);await snap('自然跨层');await frames(5);await snap('宇宙层更新');phase='返回';await evaluate('__SE.journeyStop();__SE.cosmosLeave();true');await frames(5);await snap('停止并返回主场景');phase='故障注入负控';await call('control');await snap('注入数组修改和几何 dispose');const a=result.cases[3].data.entries[0],b=result.cases[4].data.entries[0];if(a.arrays[0].hash===b.arrays[0].hash||b.events.length!==a.events.length+1)throw Error('负控未检出');result.driver={browser:report.browser,gpu:report.gpu,launch:report.launch,errors:report.errors};if(report.errors.length)throw Error('浏览器记录错误');result.status='observations-complete-not-proof';}catch(e){result.errors.push({phase,error:errorText(e)});}finally{if(browser){try{cleanupPromise=Promise.resolve();await browser.send('Browser.close');}catch(e){result.errors.push({phase:'关闭浏览器',error:errorText(e)});}browser.ws.close();}else if(child&&child.exitCode===null)child.kill();for(const [f,h] of Object.entries(result.inputHashes||{}))if(hash(fs.readFileSync(path.join(root,f)))!==h)result.errors.push({phase:'输入哈希',error:f+' 已变化'});if(result.errors.length)result.status='incomplete';result.finishedAt=new Date().toISOString();save();console.log(JSON.stringify({report:reportPath,status:result.status,install:result.install,cases:result.cases.map(c=>({label:c.label,journey:c.data.journey})),errors:result.errors},null,2));process.exitCode=result.errors.length?1:0;}})();\`;
`;
src=src.slice(0,ds)+driver+src.slice(de);
src=src.replace("await import('data:text/javascript;base64,'+Buffer.from(b).toString('base64'))", "await dynamicImport('data:text/javascript;base64,'+Buffer.from(b).toString('base64'))");
vm.runInThisContext(`(function(require,__dirname,__filename,process,Buffer,WebSocket,dynamicImport){${src}\n})`,{filename:base})(require,__dirname,__filename,process,Buffer,WebSocket,x=>import(x));
