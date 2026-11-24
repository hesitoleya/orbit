'use strict';
// 独立诊断：复用 CDP 脚手架，不改写产品或既有证据。
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const basePath = path.join(__dirname, 'test-deep-models.cjs');
let source = fs.readFileSync(basePath, 'utf8');
function replaceOnce(needle, replacement) {
  const first = source.indexOf(needle);
  if (first < 0 || source.indexOf(needle, first + needle.length) !== -1) throw Error(`CDP 脚手架替换点必须唯一：${needle}`);
  source = source.slice(0, first) + replacement + source.slice(first + needle.length);
}
const beginMarker = 'async function main() {', endMarker = '\nfunction cleanup()';
const begin = source.indexOf(beginMarker), end = source.indexOf(endMarker);
if (begin < 0 || end <= begin || source.indexOf(beginMarker, begin + 1) !== -1 || source.indexOf(endMarker, end + 1) !== -1) throw Error('CDP 脚手架结构已改变');

async function journeyBaseline() {
  const os = require('node:os'), net = require('node:net');
  const entries = ['space.html','space-http.html','index.html','public/js/app.js','public/js/deep-models.js','build.mjs'];
  hashInputs = () => Object.fromEntries(entries.map(name => { try { return [name,createHash('sha256').update(fs.readFileSync(path.join(ROOT,name))).digest('hex')]; } catch(e) { return [name,{error:String(e)}]; } }));
  report.experiment = 'P1 双入口旅程采集';
  report.system = {platform:os.platform(), release:os.release(), arch:os.arch(), cpus:os.cpus()[0], memory:os.totalmem()};
  report.hashesBefore = hashInputs(); report.runs = [];
  report.notes.push('采集结果不是 P1 或视觉验收；视频未解码，不能视为验收通过。', 'journeySeek 只冻结旅程时间，不冻结太阳、随机数、资源及其他动画。', '自然播放不录像、不截图；rAF 间隔包含浏览器调度与渲染，不是 GPU 时间。', 'WebGL 仅检查起止时刻状态和观测到的 context lost 事件，不能证明期间从未发生错误。', 'renderCam 是各时刻实际渲染相机（宇宙场景 CS.cam，否则主 camera）；camera 字段始终是主相机，宇宙场景下不代表实际画面视角。');
  checkpoint();
  const makePort = () => new Promise((resolve,reject) => {const s=net.createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(e=>e?reject(e):resolve(p));});});
  const state = `(() => {const s=__SE, g=s.renderer.getContext(), x=g.getExtension('WEBGL_debug_renderer_info'), c=s.camera, rc=s.CS.active?s.CS.cam:c;return {at:performance.now(),journey:s.journeyInfo,cam:{alt:s.cam.alt,yaw:s.cam.yaw,pitch:s.cam.pitch,dir:s.cam.dir?.toArray(),focus:s.cam.focus?.name},camera:{position:c.position.toArray(),quaternion:c.quaternion.toArray(),fov:c.fov},renderCam:{src:s.CS.active?'CS.cam':'camera',position:rc.position.toArray(),quaternion:rc.quaternion.toArray(),fov:rc.fov},cosmos:s.cosmos(),renderer:g.getParameter(g.RENDERER),gpu:x&&g.getParameter(x.UNMASKED_RENDERER_WEBGL),canvas:{width:g.canvas.width,height:g.canvas.height},viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio},quality:{q:s.SET.q,auto:s.SET.auto,perfOn:s.PERF.on,scale:s.PERF.scale},url:location.href,build:s.build}})()`;
  const only = process.env.P1_ONLY || '';
  const times = [0,4.79,7.40,7.49,7.501,7.51,7.60,8.284,12.741,15.322,17.730,19.397,25.197];
  const port=await makePort();
  if(fatal) return;
  report.urls.http=`http://127.0.0.1:${port}/space.html?auto=0&q=high`;
  server=spawn(process.execPath,[path.join(ROOT,'server/server.mjs'),'--host','127.0.0.1','--port',String(port)],{stdio:['ignore','pipe','pipe'],windowsHide:true});
  report.server={port,pid:server.pid,stdout:'',stderr:''};
  server.stdout.on('data',b=>report.server.stdout+=b.toString()); server.stderr.on('data',b=>report.server.stderr+=b.toString());
  server.on('error',e=>{report.server.error=errorText(e);});
  server.on('exit',(code,signal)=>{report.server.exit={code,signal};});
  checkpoint();
  await until('本机服务',async()=>{if(report.server.error) throw Error('服务启动失败 '+report.server.error);if(server.exitCode!==null || server.signalCode!==null) throw Error('服务提前退出 '+JSON.stringify(report.server.exit));try {const r=await fetch(`http://127.0.0.1:${port}/api/health`,{signal:AbortSignal.timeout(2000)});return r.ok;}catch{return false;}},30000);
  if(fatal) return;
  if (only === 'file') { checkpoint(); }
  else {
  const httpResp = await fetch(`http://127.0.0.1:${port}/space.html`,{signal:AbortSignal.timeout(10000)});
  assert(httpResp.ok, 'HTTP 入口响应失败 ' + httpResp.status);
  const httpBytes = Buffer.from(await httpResp.arrayBuffer()), localBytes = fs.readFileSync(path.join(ROOT,'space-http.html'));
  report.httpIdentity = {route:'/space.html', servedBytes:httpBytes.length, servedSha256:createHash('sha256').update(httpBytes).digest('hex'), localFile:'space-http.html', localBytes:localBytes.length, localSha256:createHash('sha256').update(localBytes).digest('hex')};
  report.httpIdentity.match = report.httpIdentity.servedSha256 === report.httpIdentity.localSha256;
  assert(report.httpIdentity.match, 'HTTP 入口内容与本地 space-http.html 不一致', report.httpIdentity);
  checkpoint();
  }
  await launch();
  if(fatal) return;
  for (const [kind,url] of [['file',FILE_URL],['http',report.urls.http]]) {
    if (only && kind !== only) continue;
    if(fatal) return;
    const run={kind,url,samples:[],errors:[]};report.runs.push(run); pageKind=kind; checkpoint();
    try {
      phase=kind+' 加载'; run.ready=await load(url,kind); run.setup=await evaluate(state);
      phase=kind+' 起始 WebGL'; run.glStart=await glHealth();
      phase=kind+' 固定采样';
      for (const t of times) {
        if(fatal) return;
        const sample={seconds:t};run.samples.push(sample);
        try {sample.seek=await evaluate(`__SE.journeySeek(${t})`);
          assert(sample.seek && Number.isFinite(sample.seek.lg) && typeof sample.seek.cs === 'boolean' && sample.seek.cs === (sample.seek.lg >= 20), '定位结果无效', sample.seek);
          await frames(2); sample.state=await evaluate(state);
          assert(Math.abs(sample.state.journey.lg-sample.seek.lg)<1e-8 && sample.state.journey.cs===sample.seek.cs, '定位后状态不一致');
          const image=await send('Page.captureScreenshot',{format:'png',fromSurface:true});
          const png=Buffer.from(image.data,'base64');assert(png.length>8 && png.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])), '截图不是有效 PNG 签名');
          sample.file=path.join(ROOT,'.workbuddy',`p1-${RUN_ID}-${kind}-${String(t).replace('.','_')}.png`);
          fs.writeFileSync(sample.file,png,{flag:'wx'}); sample.bytes=png.length; sample.sha256=createHash('sha256').update(png).digest('hex');
        } catch(e) {sample.error=errorText(e);run.errors.push({phase,seconds:t,error:sample.error,details:e.details});}
      }
      assert(run.samples.length===times.length && run.samples.every(s=>!s.error && s.file), '固定采样数量或内容不完整');
      phase=kind+' 自然播放';
      run.playback=await evaluate(`(async()=>{__SE.journeyStop();const start=performance.now(),started=__SE.journey(0),initial=__SE.journeyInfo;const data=[];return await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('自然播放超时')),90000);function tick(t){const j=__SE.journeyInfo,rc=__SE.CS.active?__SE.CS.cam:__SE.camera;data.push({t,lg:j.lg,cs:j.cs,on:j.on,alt:j.alt,r:j.r,camera:__SE.camera.position.toArray(),quaternion:__SE.camera.quaternion.toArray(),renderCam:{src:__SE.CS.active?'CS.cam':'camera',position:rc.position.toArray(),quaternion:rc.quaternion.toArray()}});if(t-start<28000&&j.on)requestAnimationFrame(tick);else{clearTimeout(timeout);resolve({start,end:performance.now(),started,initial,samples:data,final:j});}}requestAnimationFrame(tick);});})()`);
      const p=run.playback, intervals=p.samples.slice(1).map((x,i)=>x.t-p.samples[i].t).sort((a,b)=>a-b);p.raf={count:intervals.length,p50:intervals[Math.floor(intervals.length*.5)],p95:intervals[Math.floor(intervals.length*.95)],max:intervals.at(-1),unit:'ms',notGpu:true};
      assert(p.started===true && p.initial.on && p.initial.cine && Math.abs(p.initial.lg-7.23)<0.001 && !p.initial.cs, '自然播放起点无效', p.initial);
      assert(p.samples.length>=30 && intervals.every(x=>Number.isFinite(x)&&x>0) && p.samples[0].t-p.start<1000, '自然播放帧不足或起始帧过晚');
      assert(p.final.on===false && p.final.cine && p.final.cs && p.final.lg>=26.779 && p.final.lg<=26.781 && p.end-p.start<28000, '自然播放未到达终点或已超时', p.final);
      phase=kind+' 连续录像';
      const rec=await evaluate(`(async()=>{__SE.journeyStop();const stream=__SE.renderer.domElement.captureStream(30),mime=['video/webm;codecs=vp8','video/webm'].find(x=>MediaRecorder.isTypeSupported(x));if(!mime)throw Error('MediaRecorder 不支持 WebM');return await new Promise((resolve,reject)=>{let chunks=[];const r=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:4000000}),started=performance.now(),timer=setTimeout(()=>{try{r.stop()}catch(e){}},32000);r.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};r.onerror=e=>reject(Error(String(e.error)));r.onstop=async()=>{clearTimeout(timer);stream.getTracks().forEach(t=>t.stop());const blob=new Blob(chunks,{type:mime}),reader=new FileReader();reader.onload=()=>{window.__p1Video=reader.result;resolve({mime,bytes:blob.size,length:reader.result.length,started,stopped:performance.now(),final:__SE.journeyInfo});};reader.onerror=()=>reject(reader.error);reader.readAsDataURL(blob)};r.start(500);__SE.journey(0);});})()`);
      run.recording=rec;rec.decode={status:'未验证',reason:'需独立解码并检查首末编码帧及逐帧 PTS'};
      let parts=[];for(let i=0;i<rec.length;i+=CHUNK)parts.push(await evaluate(`window.__p1Video.slice(${i},${i+CHUNK})`));
      const data=parts.join('');assert(data.length===rec.length && data.startsWith('data:video/webm'), '录像传输长度或类型错误');
      const bytes=Buffer.from(data.slice(data.indexOf(',')+1),'base64');rec.receivedBytes=bytes.length;
      if(bytes.length){rec.file=path.join(ROOT,'.workbuddy',`p1-${RUN_ID}-${kind}.webm`);fs.writeFileSync(rec.file,bytes,{flag:'wx'});rec.sha256=createHash('sha256').update(bytes).digest('hex');rec.fileSha256=createHash('sha256').update(fs.readFileSync(rec.file)).digest('hex');}
      assert(bytes.length===rec.bytes && bytes.length>10000 && rec.sha256===rec.fileSha256 && /^[a-f0-9]{64}$/.test(rec.sha256 || ''), '录像字节数或文件哈希无效', rec);
      assert(rec.final.on===false && rec.final.lg>=26.779 && rec.final.lg<=26.781, '录像终点状态无效', rec.final);
      phase=kind+' 结束 WebGL';run.glEnd=await glHealth();
    } catch(e) {run.errors.push({phase,error:errorText(e),details:e.details});}
    checkpoint();
    if(fatal) return;
  }
}
source = source.slice(0,begin) + 'let server, hashInputs;\n' + `async function main(){return (${journeyBaseline.toString()})();}` + source.slice(end);
replaceOnce("const REPORT_FILE = path.join(ROOT, `deep-models-test-184-${RUN_ID}.json`);", "const REPORT_FILE = path.join(ROOT, '.workbuddy', `p1-journey-${RUN_ID}.json`);");
replaceOnce("const FILE_URL = pathToFileURL(path.join(ROOT, 'space.html')).href + '?auto=0&q=high';", "const FILE_URL = pathToFileURL(process.env.P1_FILE || path.join(ROOT, 'space.html')).href + '?auto=0&q=high';");
replaceOnce("  if (event.method === 'Runtime.consoleAPICalled') {", "  if (event.method === 'Runtime.consoleAPICalled') { (report.console ||= []).push({phase,pageKind,type:p.type,text:p.args.map(a=>a.value ?? a.description ?? a.type).join(' ')});");
const cleanupMarker = '\nfunction cleanup()';
const tail = source.indexOf(cleanupMarker);
if (tail < 0 || source.indexOf(cleanupMarker,tail+1)!==-1) throw Error('清理替换点必须唯一');
source = source.slice(0,tail) + `
function checkpoint() { const tmp = REPORT_FILE + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(report,null,2)); fs.renameSync(tmp, REPORT_FILE); }
function waitExit(proc, ms) {
  return new Promise(resolve => {
    if (!proc || proc.exitCode !== null || proc.signalCode !== null || !proc.pid) return resolve(true);
    const timer=setTimeout(()=>{proc.removeListener('exit',done);resolve(false);},ms);
    function done(){clearTimeout(timer);resolve(true);}
    proc.once('exit',done);
    if(proc.exitCode!==null || proc.signalCode!==null) done();
  });
}
async function stopOwned(proc, info, label) {
  if(!proc) return;
  info ||= {};
  if(!await waitExit(proc, 1500)) {
    try { info.killRequested=proc.kill(); } catch(e) { info.killError=errorText(e); }
    if(!await waitExit(proc, 5000)) { info.exitTimeout=true; report.errors.push({kind:label+' 未在限时内退出'}); }
  }
  info.finalExit={code:proc.exitCode,signal:proc.signalCode};
}
function cleanup() {
  if(cleanupPromise) return cleanupPromise;
  cleanupPromise=(async()=>{
    if(browser) {
      try { await Promise.race([browser.send('Browser.close'),delay(2000).then(()=>{throw Error('Browser.close 超时');})]); }
      catch(e) { report.notes.push('Browser.close：'+e.message); }
      try { browser.ws.close(); } catch(e) { report.notes.push('WebSocket 关闭：'+e.message); }
    }
    await Promise.all([stopOwned(child,report.launch,'浏览器'),stopOwned(server,report.server,'服务器')]);
  })();
  return cleanupPromise;
}
function finish() {
  if(finished) return; finished=true;
  if(hashInputs && report.hashesBefore) {
    report.hashesAfter=hashInputs();
    const valid = h => h && Object.keys(h).length===6 && Object.values(h).every(v=>typeof v==='string' && /^[a-f0-9]{64}$/.test(v));
    report.hashesUnchanged=valid(report.hashesBefore) && valid(report.hashesAfter) && JSON.stringify(report.hashesBefore)===JSON.stringify(report.hashesAfter);
  } else report.hashesUnchanged=false;
  report.tests=(report.runs || []).map(r=>({name:r.kind+' 采集',status:!fatal && !r.errors.length && r.samples.length===13 && r.playback && r.recording && r.glStart && r.glEnd?'pass':'fail',details:r.errors}));
  if(!process.env.P1_ONLY && ((report.runs || []).length!==2 || new Set((report.runs||[]).map(r=>r.kind)).size!==2)) report.tests.push({name:'双入口采集',status:'fail'});
  if(!report.hashesUnchanged) report.tests.push({name:'输入哈希完整且未变',status:'fail'});
  report.finishedAt=new Date().toISOString();
  if(fatal) report.fatal={error:errorText(fatal),details:fatal.details};
  report.summary={pass:report.tests.filter(t=>t.status==='pass').length,fail:report.tests.filter(t=>t.status==='fail').length,errors:report.errors.length};
  report.collectionOk=!fatal && report.summary.fail===0 && report.summary.errors===0;
  report.ok=report.collectionOk; report.complete=false;
  report.verdict='仅采集状态；P1、视觉质量和视频解码均未验收';
  checkpoint();
  console.log('报告：'+REPORT_FILE);
  console.log('采集'+(report.collectionOk?'成功':'失败')+'；不是 P1 或视觉验收，视频未解码');
  process.exitCode=report.collectionOk?0:1;
}
fs.mkdirSync(path.dirname(REPORT_FILE),{recursive:true});
report.complete=false; report.collectionOk=false; report.verdict='采集中；不是 P1 或视觉验收';
fs.writeFileSync(REPORT_FILE,JSON.stringify(report,null,2),{flag:'wx'});
for(const signal of ['SIGINT','SIGTERM']) process.once(signal,()=>{
  fatal=new Error('收到 '+signal); report.interrupted=signal; checkpoint();
  cleanup().then(()=>{finish();process.exit(signal==='SIGINT'?130:143);}).catch(error=>{fatal=error;finish();process.exit(1);});
});
(async()=>{try {await main();} catch(error) {fatal=error;console.error(errorText(error));}
finally {try {await cleanup();} catch(error) {fatal ||= error;} finish();}})();
`;
vm.runInThisContext(`(function(require,__dirname,__filename){${source}\n})`,{filename:basePath})(require,__dirname,basePath);
