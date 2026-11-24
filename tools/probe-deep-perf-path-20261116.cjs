'use strict';

// 独立离线控制路径探针；不运行复用框架的 main。
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const frameworkPath = path.join(root, 'tools/test-deep-models.cjs');
const reportPath = path.join(root, `deep-perf-path-20261116-${crypto.randomUUID()}.json`);
const checkOnly = process.argv.includes('--check-vm');
let fd;
if (!checkOnly) fd = fs.openSync(reportPath, 'wx');
try {
  const framework = fs.readFileSync(frameworkPath, 'utf8');
  const cut = framework.indexOf('async function main() {');
  if (cut < 0) throw new Error('未找到框架 main 边界');
  let prefix = framework.slice(0, cut);
  for (const [from, to] of [
    ["'--window-size=960,640'", "'--window-size=480,320', '--proxy-server=127.0.0.1:9', '--host-resolver-rules=MAP * ~NOTFOUND'"],
    ['width: 960, height: 640', 'width: 480, height: 320'],
    ['ready.width === 960 && ready.height === 640', 'ready.width === 480 && ready.height === 320'],
    ["if (process.env.ORBIT_GPU === '0') args.unshift", 'if (true) args.unshift'],
    ["  const result = await send('Page.navigate', { url });", "  if (url !== 'file:///D:/WB/orbit/space.html?auto=0&q=high' || kind !== 'file') throw new Error('只允许指定离线入口');\n  const result = await send('Page.navigate', { url });"]
  ]) {
    if (!prefix.includes(from)) throw new Error('框架不匹配：' + from);
    prefix = prefix.replaceAll(from, to);
  }
  // Chrome 调试管道不监听网络端口，也不连接任何 HTTP 服务。
  if (!prefix.includes("'--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0'") || !prefix.includes("stdio: ['ignore', 'ignore', 'pipe']")) throw new Error('Chrome 管道替换不匹配');
  prefix = prefix.replace("'--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0'", "'--remote-debugging-pipe'");
  prefix = prefix.replace("stdio: ['ignore', 'ignore', 'pipe']", "stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe']");
  prefix = prefix.replace("softwareRenderingRequested: process.env.ORBIT_GPU === '0'", 'softwareRenderingRequested: true');
  const cdpStart = prefix.indexOf('class CDP {');
  const cdpEnd = prefix.indexOf('const send =', cdpStart);
  if (cdpStart < 0 || cdpEnd < 0) throw new Error('CDP 框架边界不匹配');
  prefix = prefix.slice(0, cdpStart) + String.raw`
class CDP {
  constructor(proc) {
    this.proc=proc; this.next=0; this.pending=new Map(); this.buffer=Buffer.alloc(0);
    proc.stdio[4].on('data', chunk=>{
      this.buffer=Buffer.concat([this.buffer,chunk]); let end;
      while((end=this.buffer.indexOf(0))>=0) {
        const data=this.buffer.subarray(0,end);this.buffer=this.buffer.subarray(end+1);
        try { const msg=JSON.parse(data.toString());
          if(msg.id){const p=this.pending.get(msg.id);if(!p)continue;clearTimeout(p.timer);this.pending.delete(msg.id);msg.error?p.reject(new Error(p.method+': '+JSON.stringify(msg.error))):p.resolve(msg.result||{});}
          else onEvent(msg);
        } catch(error){recordError('CDP 管道消息错误',{error:errorText(error)});}
      }
    });
    proc.stdio[4].on('error', error=>this.fail(error));
    proc.stdio[3].on('error', error=>this.fail(error));
    proc.once('exit',()=>this.fail(new Error('Chrome 已退出')));
  }
  fail(error){for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(error)}this.pending.clear()}
  send(method,params={},sessionId){return new Promise((resolve,reject)=>{const id=++this.next;const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error('CDP 超时：'+method))},WAIT_MS);this.pending.set(id,{resolve,reject,timer,method});try{this.proc.stdio[3].write(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})})+'\0')}catch(error){clearTimeout(timer);this.pending.delete(id);reject(error)}})}
}
` + prefix.slice(cdpEnd);
  const start = prefix.indexOf("  let stderr = '';", prefix.indexOf('async function launch()'));
  const end = prefix.indexOf("  report.browser = await browser.send('Browser.getVersion');", start);
  if (start < 0 || end < 0) throw new Error('Chrome 启动边界不匹配');
  prefix = prefix.slice(0,start) + String.raw`
  child.stderr.on('data',chunk=>{ report.launch.stderrTail=((report.launch.stderrTail||'')+chunk.toString()).slice(-16000); });
  child.once('error',error=>recordError('Chrome 进程错误',{error:errorText(error)}));
  browser = new CDP(child);
` + prefix.slice(end);
  const probe = String.raw`
const ENTRY = path.join(ROOT, 'space.html');
const OUT = ${JSON.stringify(reportPath)};
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
report.kind = 'offline-deep-perf-control-path';
report.urls = {file: FILE_URL};
report.viewport = {width:480,height:320,dpr:1};
report.notes = [
  '仅验证控制路径，不验证完整 auto UI、真实 GPU 性能或动态分辨率修复。',
  '临时会话手动设置 PERF.on 与 SET.auto，不调用 updatePerf。renderer.render 包装钩子可能引入开销；调用次数不证明 GPU 完成。',
  'rAF 间隔包含调度及软件渲染开销；截图经 CDP 采集并仅记录字节数和 SHA，不输出截图文件。',
  '主 target 拦截非 file/data/blob/about 请求，代理和域名解析额外阻断；不声称覆盖所有 worker 或 target 的系统级网络审计。',
  '仅关闭自建浏览器，不删除 profile 或其他证据。'
];
report.provenance = {entry:{path:ENTRY,before:hash(ENTRY)}, framework:{path:${JSON.stringify(frameworkPath)},sha256:hash(${JSON.stringify(frameworkPath)})},probe:{path:${JSON.stringify(__filename)},sha256:hash(${JSON.stringify(__filename)})}};
const oldEvent = onEvent;
onEvent = function(event) {
  if (event.sessionId === session && event.method === 'Fetch.requestPaused') {
    const p=event.params, url=p.request.url, allowed=/^(?:file|data|blob|about):/i.test(url);
    if (!allowed) recordError('阻止离线外部请求',{url});
    send(allowed?'Fetch.continueRequest':'Fetch.failRequest',allowed?{requestId:p.requestId}:{requestId:p.requestId,errorReason:'BlockedByClient'}).catch(error=>recordError('拦截失败',{url,error:errorText(error)}));
    return;
  }
  oldEvent(event);
};
async function shot(label) {
  const res=await send('Page.captureScreenshot',{format:'png',fromSurface:true});
  const bytes=Buffer.from(res.data,'base64');
  return {label,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
}
async function sample(label) {
  return evaluate(
    '(async()=>{'+
    'const r=__SE.renderer,p=window.__perfProbe,times=[];'+
    'const state=()=>({url:location.href,build:__SE.build,perf:{...__SE.PERF},auto:__SE.SET.auto,q:__SE.SET.q,pixelRatio:r.getPixelRatio(),canvas:{width:r.domElement.width,height:r.domElement.height,clientWidth:r.domElement.clientWidth,clientHeight:r.domElement.clientHeight},deep:__SE.deep.info(),counts:{...p.counts},now:performance.now()});'+
    'const before=state();'+
    'await new Promise((resolve,reject)=>{function tick(t){try{times.push(t);if(times.length>=10)resolve();else requestAnimationFrame(tick)}catch(e){reject(e)}}requestAnimationFrame(tick)});'+
    'const after=state();return {label:'+JSON.stringify(label)+',before,after,timestamps:times,intervals:times.slice(1).map((t,i)=>t-times[i])};'+
    '})()');
}
async function health() {
  return evaluate("(()=>{const gl=__SE.renderer.getContext(),errors=[];for(let i=0;i<16;i++){const e=gl.getError();if(e===gl.NO_ERROR)break;errors.push(e)}const ext=gl.getExtension('WEBGL_debug_renderer_info');return {errors,lost:gl.isContextLost(),contextLost:window.__deepProbe.contextLost,renderer:gl.getParameter(gl.RENDERER),unmaskedRenderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):null,vendor:gl.getParameter(gl.VENDOR),version:gl.getParameter(gl.VERSION)}})()");
}
async function run() {
  assert(FILE_URL === 'file:///D:/WB/orbit/space.html?auto=0&q=high','入口不符',FILE_URL);
  assert(/const BUILD\s*=\s*['"]v192['"]/.test(fs.readFileSync(ENTRY,'utf8')),'入口不是 v192');
  await launch();
  await send('Fetch.enable',{patterns:[{urlPattern:'*',requestStage:'Request'}]});
  phase='加载离线入口';
  report.ready=await load(FILE_URL,'file');
  assert(report.ready.url===FILE_URL,'页面 URL 不符',report.ready);
  report.initial=await evaluate("(()=>{const before={on:__SE.PERF.on,auto:__SE.SET.auto,q:__SE.SET.q};__SE.PERF.on=true;__SE.SET.auto=1;return {before,after:{on:__SE.PERF.on,auto:__SE.SET.auto,q:__SE.SET.q}}})()");
  await frames(5);
  phase='深空预热';
  report.open=await evaluate("(()=>{__SE.deep.open('m51');__SE.deep.setView('near');const r=__SE.renderer,original=r.render;const p=window.__perfProbe={original,counts:{deep:0,other:0}};r.render=function(scene,...args){if(scene===__SE.deep.controller.scene)p.counts.deep++;else p.counts.other++;return original.call(this,scene,...args)};return __SE.deep.info()})()");
  assert(report.open.active && report.open.id==='m51' && Math.abs(report.open.camera.distance-.35)<1e-8,'深空 near 未启用',report.open);
  await frames(5);
  report.deepShot=await shot('deep-near');
  report.deepHealth=await health();
  phase='深空采样';
  report.deep=await sample('deep');
  const a=report.deep.before,b=report.deep.after;
  report.deepChecks={realIntervals:report.deep.intervals.length>=8 && report.deep.intervals.every(x=>Number.isFinite(x)&&x>0),deepRenderCalls:b.counts.deep-a.counts.deep,unchanged:Object.fromEntries(['ema','fps','scale','cool','acc','slow'].map(k=>[k,Object.is(a.perf[k],b.perf[k])])),active:a.deep.active&&b.deep.active,auto:a.perf.on&&b.perf.on&&a.auto===1&&b.auto===1};
  phase='返回主场景';
  report.closed=await evaluate('(__SE.deep.close(),__SE.deep.info())');
  await frames(3);
  report.mainShot=await shot('main');
  report.mainHealth=await health();
  phase='主场景采样';
  report.main=await sample('main');
  const c=report.main.before,d=report.main.after;
  report.mainChecks={realIntervals:report.main.intervals.length>=8&&report.main.intervals.every(x=>Number.isFinite(x)&&x>0),otherRenderCalls:d.counts.other-c.counts.other,perfChanged:!Object.is(c.perf.ema,d.perf.ema)||!Object.is(c.perf.fps,d.perf.fps),deepInactive:!c.deep.active&&!d.deep.active};
  assert(report.deepChecks.realIntervals && report.deepChecks.deepRenderCalls>0 && Object.values(report.deepChecks.unchanged).every(Boolean) && report.deepChecks.active && report.deepChecks.auto,'深空控制路径断言失败',report.deepChecks);
  assert(report.mainChecks.realIntervals && report.mainChecks.otherRenderCalls>0 && report.mainChecks.perfChanged && report.mainChecks.deepInactive,'主场景对照断言失败',report.mainChecks);
  assert([report.deepHealth,report.mainHealth].every(h=>!h.lost&&!h.contextLost&&!h.errors.length),'GL 健康检查失败',{deep:report.deepHealth,main:report.mainHealth});
  assert(report.errors.length===0,'浏览器或网络错误',report.errors);
}
async function finishProbe() {
  try { await run(); report.ok=!report.interrupted; }
  catch(error) { report.ok=false; report.fatal={phase,error:errorText(error),details:error.details}; }
  finally {
    if(session && browser) try {report.hookRestored=await evaluate('(()=>{const p=window.__perfProbe;if(!p)return null;__SE.renderer.render=p.original;return __SE.renderer.render===p.original})()')} catch(error){report.hookRestoreError=errorText(error)}
    if(browser) {try{await browser.send('Browser.close')}catch(error){report.closeError=errorText(error)} try{child.stdio[3].end()}catch(_){}}
    if(child && child.exitCode===null && child.signalCode===null) {
      const exited=await new Promise(resolve=>{const timer=setTimeout(()=>resolve(false),5000);child.once('exit',()=>{clearTimeout(timer);resolve(true)});if(child.exitCode!==null||child.signalCode!==null){clearTimeout(timer);resolve(true)}});
      if(!exited) report.killOwnChrome=child.kill();
    }
    try{report.provenance.entry.after=hash(ENTRY);report.provenance.entry.unchanged=report.provenance.entry.before===report.provenance.entry.after}catch(error){report.hashError=errorText(error);report.ok=false}
    if(report.provenance.entry.unchanged!==true || report.hookRestored!==true || report.closeError || report.hookRestoreError || report.errors.length || report.killOwnChrome || (child && child.exitCode!==0))report.ok=false;
    report.finishedAt=new Date().toISOString();
    fs.writeFileSync(${JSON.stringify(fd)},JSON.stringify(report,null,2));fs.closeSync(${JSON.stringify(fd)});
    console.log('报告：'+OUT);console.log('结果：'+(report.ok?'通过':'失败'));process.exitCode=report.ok?0:1;
  }
}
for(const signal of ['SIGINT','SIGTERM']) process.once(signal,()=>{report.interrupted=signal;process.exitCode=1;if(browser)browser.fail(new Error('收到 '+signal));if(child && child.exitCode===null)child.kill()});
finishProbe();
`;
  const source = `(function(require,__dirname,__filename,process,Buffer,WebSocket){\n${prefix}\n${probe}\n})`;
  const compiled = new vm.Script(source, {filename: __filename});
  if (checkOnly) console.log('VM 拼接语法检查通过');
  else compiled.runInThisContext()(require, __dirname, __filename, process, Buffer, WebSocket);
} catch (error) {
  if (fd !== undefined) {
    fs.writeFileSync(fd, JSON.stringify({ok:false,phase:'探针初始化',error:error.stack || String(error),finishedAt:new Date().toISOString()}, null, 2));
    fs.closeSync(fd);
    console.error('报告：' + reportPath);
  }
  console.error(error.stack || String(error));
  process.exitCode = 1;
}
