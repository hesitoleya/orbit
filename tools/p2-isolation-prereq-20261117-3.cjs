'use strict';
// 仅供隔离预览前提诊断；不修改生产入口或既有脚本。
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const {randomUUID, createHash} = require('node:crypto');
const root = path.resolve(__dirname, '..');
const output = path.join(root, '.workbuddy', 'p2-isolation-prereq-' + randomUUID());
fs.mkdirSync(output);
const reportPath = path.join(output, 'report.json');
const hash = b => createHash('sha256').update(b).digest('hex');
const result = {status:'blocked', startedAt:new Date().toISOString(), output, errors:[], cases:[], replacements:[
  '仅在内存构建源码中暴露 cineTimeAtLg、JOURNEY 和资源计数；构建输出重定向到独立预览。',
  '通过 CDP 在预览执行前将 Math.random 替换为固定种子 xorshift32，并统计调用；这不是生产随机行为。',
  '预览使用 journeySeek 和 ts=0；不等于冻结 performance.now、rAF、定时器、异步解码或资源。'
], limitations:[
  '未独立更新并采集同一 lg 的两侧；未尝试有副作用的强制切换，也未取得完整状态恢复证明。',
  '主场景 journeyCineStep 将 alt clamp 到 1e20；lg>20 主侧若做适配只能使用该上限，不能声称真实同尺度。',
  '只检查列出的对象与资源计数；不可推断所有材质、uniform、异步任务、随机数或 WebGL 状态已冻结或恢复。',
  '未采 HDR，不测试生产后处理、混合、视觉质量、完整转场或性能。'
]};
function save(){fs.writeFileSync(reportPath,JSON.stringify(result,null,2));}
function once(s,a,b){const i=s.indexOf(a);if(i<0||s.indexOf(a,i+a.length)>=0)throw Error('替换点缺失或不唯一: '+a);return s.slice(0,i)+b+s.slice(i+a.length);}
function inspect(){
 const s=window.__SE, p=s.__isolationProbe, gl=s.renderer.getContext();
 const object=o=>o?{exists:true,visible:o.visible,position:o.position&&o.position.toArray(),scale:o.scale&&o.scale.toArray()}: {exists:false};
 const cam=c=>({position:c.position.toArray(),quaternion:c.quaternion.toArray(),up:c.up.toArray(),aspect:c.aspect,fov:c.fov});
 return {journey:s.journeyInfo, frozen:p.JOURNEY.frozen, simSpeed:s.ts,random:{...window.__seedProbe}, clock:{date:Date.now(),performance:performance.now()},
  main:{scene:!!s.scene,camera:cam(s.camera),alt:s.cam.alt,starfield:object(s.starfield),galaxyQuad:object(s.galaxyQuad),children:s.scene.children.length},
  cosmos:{built:s.CS.built,active:s.CS.active,scene:!!s.CS.scene,camera:s.CS.cam?cam(s.CS.cam):null,orbitR:s.CS.orbitR,unit:s.CS.unit,galaxies:s.CS.gals.length,children:s.CS.scene?s.CS.scene.children.length:null},
  resources:{geometries:s.renderer.info.memory.geometries,textures:s.renderer.info.memory.textures,programs:s.renderer.info.programs.length,resourceTimingEntries:performance.getEntriesByType('resource').length},contextLost:gl.isContextLost()};
}
async function build(){
 let b=fs.readFileSync(path.join(root,'build.mjs'),'utf8').replace(/\r\n/g,'\n');
 result.inputHashes=Object.fromEntries(['build.mjs','public/index.html','public/js/app.js','tools/test-deep-models.cjs'].map(f=>[f,hash(fs.readFileSync(path.join(root,f)))]));
 b=once(b,'const ROOT = path.dirname(fileURLToPath(import.meta.url));',`const ROOT = ${JSON.stringify(root)};`);
 b=once(b,"const app = read('js/app.js');",`const app = read('js/app.js').replace('window.__SE = {', 'window.__SE = { __isolationProbe: {timeAtLg:cineTimeAtLg,JOURNEY},');`);
 b=once(b,`for (const name of ['space.html', 'index.html']) {\n  fs.writeFileSync(path.join(ROOT, name), htmlOffline);\n}\nfs.writeFileSync(path.join(ROOT, 'space-http.html'), htmlHttp);`,`fs.writeFileSync(${JSON.stringify(path.join(output,'preview.html'))}, htmlOffline, {flag:'wx'});`);
 await import('data:text/javascript;base64,'+Buffer.from(b).toString('base64'));
 result.previewSha256=hash(fs.readFileSync(path.join(output,'preview.html')));
}
async function run(){
 await build();
 const framework=path.join(root,'tools/test-deep-models.cjs');
 let s=fs.readFileSync(framework,'utf8');const cut=s.indexOf('async function main() {');if(cut<0)throw Error('驱动入口缺失');
 s=s.slice(0,cut).replace("const profile = fs.mkdtempSync(path.join(parent, 'probe-deep-models-'));", "const profile = fs.mkdtempSync(path.join(output, 'chrome-profile-'));");
 const driver=`(async()=>{try {
  await launch();
  await send('Page.addScriptToEvaluateOnNewDocument',{source: \`(()=>{let x=0x13579bdf;window.__seedProbe={seed:x,calls:0,state:x};Math.random=()=>{x^=x<<13;x^=x>>>17;x^=x<<5;x>>>=0;window.__seedProbe.calls++;window.__seedProbe.state=x;return x/4294967296;};})();\`});
  await load(pathToFileURL(path.join(output,'preview.html')).href+'?auto=0&q=high','file');
  phase='正反 seek 与已观察对象状态';
  await evaluate('__SE.journey(0); __SE.ts=0; true');
  for(const lg of [19.98,20,20.02,20.02,20,19.98]){
    const time=await evaluate('__SE.__isolationProbe.timeAtLg('+lg+')');
    const seek=await evaluate('__SE.journeySeek('+time+')');
    await frames(2);
    const before=await evaluate('('+inspect.toString()+')()');
    await frames(2);
    const after=await evaluate('('+inspect.toString()+')()');
    result.cases.push({lg,time,seek,before,after,randomUnchanged:before.random.calls===after.random.calls,resourcesCountsUnchanged:JSON.stringify(before.resources)===JSON.stringify(after.resources)});save();
  }
  result.errors.push({phase:'隔离前提',error:'未能证明资源、时钟和两场景对象的完整冻结及可逆恢复；停止，不强制采集非活动场景。'});
 }catch(e){result.errors.push({phase,error:errorText(e)});}
 finally{
  result.driver={browser:report.browser,gpu:report.gpu,launch:report.launch,errors:report.errors,network:report.network};
  if(browser){try{cleanupPromise=Promise.resolve();await browser.send('Browser.close');}catch(e){result.errors.push({phase:'关闭浏览器',error:errorText(e)});}browser.ws.close();}else if(child&&child.exitCode===null)child.kill();
  save();console.log(JSON.stringify({report:reportPath,status:result.status,cases:result.cases.length,errors:result.errors},null,2));process.exitCode=1;
 }})();`;
 vm.runInThisContext(`(function(require,__dirname,__filename,process,Buffer,WebSocket,output,result,save,inspect,reportPath){${s}\n${driver}\n})`,{filename:framework})(require,__dirname,framework,process,Buffer,WebSocket,output,result,save,inspect,reportPath);
}
save();run().catch(e=>{result.errors.push({phase:'构建或驱动初始化',error:e.stack||String(e)});save();console.error(JSON.stringify({report:reportPath,status:result.status,errors:result.errors},null,2));process.exitCode=1;});
