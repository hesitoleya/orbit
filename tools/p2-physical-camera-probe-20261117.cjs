'use strict';
// 独立源码预览，生产帧路径只插入只读采样，不改变正式产品文件。
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {randomUUID,createHash}=require('node:crypto');
const root=path.resolve(__dirname,'..'),output=path.join(root,'.workbuddy','p2-physical-camera-'+randomUUID());
fs.mkdirSync(output);const reportPath=path.join(output,'report.json');
const hash=x=>createHash('sha256').update(x).digest('hex');
const result={status:'incomplete',output,startedAt:new Date().toISOString(),samples:[],errors:[],limitations:['源码独立预览插入采样代码；自然播放未 seek、未人工构造宇宙机位；load 脚手架设 ts=0，非无干预用户会话。','前后样本为真实相邻应用帧而非同一时刻；物理位置差同时包含时间推进，不是零时距跃迁的精确值。','太阳锚点和两层轴同向只是假设；方向、位置误差为此假设下的坐标比较，不能证明星体对应。','主场景 near/far 单位米，宇宙层以 unit 米/渲染单位换算；矩阵元素比较不等价于物理裁剪等价。','采样未校验全部资源就绪、视觉连续性、其他浏览器或设备。']};
function save(){fs.writeFileSync(reportPath,JSON.stringify(result,null,2));}
function once(s,a,b){const i=s.indexOf(a);if(i<0||s.indexOf(a,i+a.length)>=0)throw Error('替换点缺失或不唯一: '+a);return s.slice(0,i)+b+s.slice(i+a.length);}
function measure(){
 if(!JOURNEY.on||!JOURNEY.cine)return;
 const c=CS.active?CS.cam:camera,unit=CS.active?CS.unit:1;
 const n=new THREE.Vector3(Math.cos(CS.theta)*Math.cos(CS.phi),Math.sin(CS.phi),Math.sin(CS.theta)*Math.cos(CS.phi));
 const physical=CS.active?CS.target.clone().addScaledVector(n,CS.orbitR):camAbs.clone();
 const cam=c=>({position:c.position.toArray(),worldPosition:c.getWorldPosition(new THREE.Vector3()).toArray(),direction:c.getWorldDirection(new THREE.Vector3()).toArray(),up:c.up.toArray(),effectiveUp:new THREE.Vector3(0,1,0).applyQuaternion(c.getWorldQuaternion(new THREE.Quaternion())).toArray(),quaternion:c.quaternion.toArray(),fov:c.fov,aspect:c.aspect,near:c.near,far:c.far,zoom:c.zoom,filmGauge:c.filmGauge,filmOffset:c.filmOffset,view:c.view,projectionMatrix:c.projectionMatrix.toArray(),projectionMatrixInverse:c.projectionMatrixInverse.toArray(),nearMeters:c.near*unit,farMeters:c.far*unit});
 const x={frame:frameId,now:performance.now(),lg:JOURNEY.lg,active:CS.active,physical:physical.toArray(),sun:SUN.pos.toArray(),sunGal:SUN_GAL.toArray(),camAbs:camAbs.toArray(),target:CS.target.toArray(),orbitR:CS.orbitR,unit,theta:CS.theta,phi:CS.phi,camera:cam(c)};
 if(!CS.active&&JOURNEY.lg<20)window.__physicalBefore=x;
 if(CS.active&&JOURNEY.lg>=20&&!window.__physicalAfter){window.__physicalAfter=x;window.__physicalPair={before:window.__physicalBefore||null,after:x};}
}
function compare(pair){
 const {before:a,after:b}=pair;if(!a||!b)throw Error('缺少自然跨层相邻帧');
 const sub=(x,y)=>x.map((v,i)=>v-y[i]),add=(x,y)=>x.map((v,i)=>v+y[i]),norm=x=>Math.hypot(...x),angle=(x,y)=>Math.acos(Math.max(-1,Math.min(1,x.reduce((t,v,i)=>t+v*y[i],0)/(norm(x)*norm(y)))))*180/Math.PI;
 const mapped=add(a.sunGal,sub(a.physical,a.sun)),delta=sub(b.physical,mapped),ma=a.camera.projectionMatrix,mb=b.camera.projectionMatrix;
 return {mappedBeforeAssumingSameAxesMeters:mapped,afterMinusMappedMeters:delta,distanceMeters:norm(delta),distanceRelativeToBeforeAltitude:norm(delta)/norm(sub(a.physical,a.sun)),directionDegrees:angle(a.camera.direction,b.camera.direction),effectiveUpDegrees:angle(a.camera.effectiveUp,b.camera.effectiveUp),upPropertyDegrees:angle(a.camera.up,b.camera.up),projectionMaxAbsElementDelta:Math.max(...ma.map((v,i)=>Math.abs(v-mb[i]))),nearRatio:b.camera.nearMeters/a.camera.nearMeters,farRatio:b.camera.farMeters/a.camera.farMeters,frameDelta:b.frame-a.frame,elapsedMs:b.now-a.now,lgDelta:b.lg-a.lg};
}
async function run(){
 const files=['build.mjs','public/index.html','public/js/app.js','tools/test-deep-models.cjs','tools/p2-physical-camera-probe-20261117.cjs'];result.inputHashes=Object.fromEntries(files.map(f=>[f,hash(fs.readFileSync(path.join(root,f)))]));
 let b=fs.readFileSync(path.join(root,'build.mjs'),'utf8').replace(/\r\n/g,'\n');b=once(b,'const ROOT = path.dirname(fileURLToPath(import.meta.url));',`const ROOT = ${JSON.stringify(root)};`);
 const edits=`const app = read('js/app.js').replace(/\\r\\n/g,'\\n')\n .replace('window.__SE = {', ${JSON.stringify('function __physicalMeasure(){'+measure.toString().slice('function measure(){'.length,-1)+'}\nwindow.__SE = {')})\n .replace('    cosmicUpdate(dt);\\n    renderFrame(CS.scene, CS.cam);','    cosmicUpdate(dt);\\n    __physicalMeasure();\\n    renderFrame(CS.scene, CS.cam);')\n .replace('  placeCamera();\\n  /* 对话 139','  placeCamera();\\n  __physicalMeasure();\\n  /* 对话 139');`;
 b=once(b,"const app = read('js/app.js');",edits);
 b=once(b,`for (const name of ['space.html', 'index.html']) {\n  fs.writeFileSync(path.join(ROOT, name), htmlOffline);\n}\nfs.writeFileSync(path.join(ROOT, 'space-http.html'), htmlHttp);`,`fs.writeFileSync(${JSON.stringify(path.join(output,'preview.html'))},htmlOffline,{flag:'wx'});`);
 await import('data:text/javascript;base64,'+Buffer.from(b).toString('base64'));result.previewSha256=hash(fs.readFileSync(path.join(output,'preview.html')));
 const framework=path.join(root,'tools/test-deep-models.cjs');let src=fs.readFileSync(framework,'utf8');src=src.slice(0,src.indexOf('async function main() {')).replace("const profile = fs.mkdtempSync(path.join(parent, 'probe-deep-models-'));","const profile = fs.mkdtempSync(path.join(output, 'chrome-profile-'));");
 const driver=`(async()=>{try{await launch();await load(pathToFileURL(path.join(output,'preview.html')).href+'?auto=0&q=high','file');phase='自然播放跨层';await evaluate('__SE.journey(0);true');await until('自然播放跨层采样',()=>evaluate('window.__physicalPair||null'),90000);const pair=await evaluate('window.__physicalPair');result.samples.push(pair);result.comparison=compare(pair);result.driver={browser:report.browser,gpu:report.gpu,launch:report.launch,errors:report.errors};if(result.comparison.frameDelta!==1||pair.before.active||!pair.after.active)throw Error('样本不是前后相邻活动帧');if(report.errors.length)throw Error('浏览器记录错误');result.status='measurement-complete-not-validation';}catch(e){result.errors.push({phase,error:errorText(e)});try{result.diagnostic=await evaluate('({journey:__SE.journeyInfo,before:window.__physicalBefore||null,after:window.__physicalAfter||null})');}catch(_){}result.driver={browser:report.browser,errors:report.errors};}finally{if(browser){try{cleanupPromise=Promise.resolve();await browser.send('Browser.close');}catch(e){result.errors.push({phase:'关闭浏览器',error:errorText(e)});}browser.ws.close();}else if(child&&child.exitCode===null)child.kill();for(const [f,h] of Object.entries(result.inputHashes))if(hash(fs.readFileSync(path.join(root,f)))!==h)result.errors.push({phase:'输入哈希',error:f+' 已变化'});if(result.errors.length)result.status='incomplete';result.finishedAt=new Date().toISOString();save();console.log(JSON.stringify({report:reportPath,status:result.status,comparison:result.comparison,errors:result.errors},null,2));process.exitCode=result.errors.length?1:0;}})();`;
 vm.runInThisContext(`(function(require,__dirname,__filename,process,Buffer,WebSocket,output,result,save,hash,compare,reportPath,root){${src}\n${driver}\n})`,{filename:framework})(require,__dirname,framework,process,Buffer,WebSocket,output,result,save,hash,compare,reportPath,root);
}
save();run().catch(e=>{result.errors.push({phase:'构建或初始化',error:e.stack||String(e)});save();console.error(JSON.stringify({report:reportPath,errors:result.errors}));process.exitCode=1;});
