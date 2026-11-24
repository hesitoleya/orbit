'use strict';
const fs=require('node:fs'), path=require('node:path'), vm=require('node:vm');
const {randomUUID,createHash}=require('node:crypto');
const root=path.resolve(__dirname,'..'), output=path.join(root,'.workbuddy','p2-seek-diagnostic-'+randomUUID());
fs.mkdirSync(output);
const prior=path.join(root,'.workbuddy','p2-dual-scene-00079cd3-c698-4e58-bd09-2b8866ec699c');
const preview=path.join(prior,'preview.html'), framework=path.join(__dirname,'test-deep-models.cjs');
const out={output,preview,startedAt:new Date().toISOString(),steps:[],errors:[],limitations:['复用历史隔离预览；截图是默认浏览器可见输出，非 HDR 数值采样。','单次运行、固定模拟时间，不能证明全部设备和输入路径。']};
const save=()=>fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(out,null,2));
let source=fs.readFileSync(framework,'utf8');source=source.slice(0,source.indexOf('async function main() {')).replace("const profile = fs.mkdtempSync(path.join(parent, 'probe-deep-models-'));","const profile = fs.mkdtempSync(path.join(output, 'chrome-profile-'));");
const probe=`
(async()=>{try{
 await launch(); await load(pathToFileURL(preview).href+'?auto=0&q=high','file');
 out.previewSha256=createHash('sha256').update(fs.readFileSync(preview)).digest('hex');
 const snap=async label=>{await frames(3);const state=await evaluate('({j:__SE.journeyInfo,scale:{r:__SE.CS.orbitR,unit:__SE.CS.unit},cam:__SE.camera.quaternion.toArray(),csCam:__SE.CS.cam.quaternion.toArray()})');const image=await send('Page.captureScreenshot',{format:'png'});const bytes=Buffer.from(image.data,'base64');fs.writeFileSync(path.join(output,label+'.png'),bytes);out.steps.push({label,state,sha256:createHash('sha256').update(bytes).digest('hex')});save()};
 const seek=async lg=>evaluate('__SE.journeySeek(__SE.__probeTimeAtLg('+lg+'))');
 await evaluate('__SE.journey(0); __SE.ts=0; true');await seek(19.98);await snap('forward');
 await seek(20.02);await seek(19.98);await snap('reverse');await frames(30);await snap('reverse-after-30-frames');
 await seek(20.02);await snap('recross');
 await seek(19.98);await evaluate('__SE.journeyStop()');await snap('stopped-before-wheel');
 await send('Input.dispatchMouseEvent',{type:'mouseWheel',x:480,y:320,deltaX:0,deltaY:100});await frames(12);await snap('stopped-after-wheel');
 await evaluate('__SE.journey(0)');await seek(19.98);await snap('restarted');await seek(20.02);await snap('restarted-recross');
 await evaluate('__SE.journey(0); __SE.cam.focus=__SE.SUN; true');await seek(19.98);await snap('non-earth-return-main');await seek(20.02);await snap('non-earth-recross');
 out.driver={browser:report.browser,errors:report.errors};
 }catch(e){out.errors.push({phase,error:errorText(e)});}finally{if(browser){try{cleanupPromise=Promise.resolve();await browser.send('Browser.close')}catch(e){out.errors.push({phase:'关闭浏览器',error:errorText(e)})}browser.ws.close()}else if(child&&child.exitCode===null)child.kill();save();console.log(JSON.stringify({report:path.join(output,'report.json'),errors:out.errors,steps:out.steps.map(x=>x.label)}));process.exitCode=out.errors.length?1:0;}})();`;
vm.runInThisContext(`(function(require,__dirname,__filename,process,Buffer,WebSocket,output,preview,out,save){${source}\n${probe}\n})`,{filename:framework})(require,__dirname,framework,process,Buffer,WebSocket,output,preview,out,save);
