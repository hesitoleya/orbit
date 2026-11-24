'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');

// 启动前需主代理单独许可；每次运行均创建隔离目录并保留全部证据。
const kind = process.argv[2];
if (!['chrome', 'edge'].includes(kind)) throw Error('用法：node test-v196-online-download-independent.cjs chrome|edge');
const root = path.resolve(__dirname, '..');
const executable = kind === 'chrome' ? path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe') : 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
if (!fs.existsSync(executable)) throw Error('未找到浏览器：' + executable);
const dir = fs.mkdtempSync(path.join(root, '.workbuddy', 'v196-online-download-' + kind + '-'));
const downloads = path.join(dir, 'downloads');
const profile = path.join(dir, 'profile');
fs.mkdirSync(downloads); fs.mkdirSync(profile);
const report = {kind, executable, dir, startedAt: new Date().toISOString(), events: [], errors: [], notes: ['使用真实 HTTP 与浏览器下载；未拦截或替代产品下载。', '浏览器无头模式，结果不代表所有图形驱动、设备和浏览器。', '下载文件以 Windows System.Drawing 独立解码；不删除任何证据。']};
let proc, session, cdp, phase = '启动';
const timeout = 90000;
const delay = ms => new Promise(r => setTimeout(r, ms));
function assert(v, message) { if (!v) throw Error(message); }
class CDP {
  constructor(proc) {
    this.seq = 0; this.pending = new Map(); this.buf = Buffer.alloc(0);
    proc.stdio[4].on('data', chunk => {
      this.buf = Buffer.concat([this.buf, chunk]); let i;
      while ((i = this.buf.indexOf(0)) >= 0) {
        const msg = JSON.parse(this.buf.subarray(0, i).toString()); this.buf = this.buf.subarray(i + 1);
        if (msg.id) { const p = this.pending.get(msg.id); if (!p) continue; clearTimeout(p.timer); this.pending.delete(msg.id); msg.error ? p.reject(Error(JSON.stringify(msg.error))) : p.resolve(msg.result || {}); }
        else if (msg.method.startsWith('Browser.download')) report.events.push({method: msg.method, ...msg.params});
        else if (msg.method === 'Runtime.exceptionThrown') report.errors.push({phase, type: msg.method, details: msg.params.exceptionDetails});
        else if (msg.method === 'Runtime.consoleAPICalled' && ['error','warning'].includes(msg.params.type)) report.errors.push({phase, type: msg.params.type, text: msg.params.args.map(a => a.value || a.description || '').join(' ')});
        else if (msg.method === 'Network.responseReceived' && msg.params.response.status >= 400) report.errors.push({phase, type: 'http', status: msg.params.response.status, url: msg.params.response.url});
        else if (msg.method === 'Network.loadingFailed' && !msg.params.canceled) report.errors.push({phase, type: 'network', details: msg.params});
      }
    });
    proc.once('exit', () => { for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(Error('浏览器退出')); } this.pending.clear(); });
  }
  send(method, params = {}, sid) { return new Promise((resolve, reject) => { const id = ++this.seq; const timer = setTimeout(() => {this.pending.delete(id); reject(Error('CDP 超时：' + method));}, timeout); this.pending.set(id, {resolve,reject,timer}); thisSend(); function thisSend() { proc.stdio[3].write(JSON.stringify({id,method,params,...(sid ? {sessionId:sid} : {})})+'\0'); } }); }
}
const send = (method, params) => cdp.send(method, params, session);
async function evaluate(expression) { const r = await send('Runtime.evaluate', {expression, awaitPromise:true, returnByValue:true}); if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails)); return r.result.value; }
async function until(label, fn, ms = timeout) { const end = Date.now()+ms; while(Date.now()<end) { const value = await fn(); if (value) return value; await delay(200); } throw Error('等待超时：'+label); }
async function click(selector) {
  const point = await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}); if(!e)return null; e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,width:r.width,height:r.height,top:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.outerHTML.slice(0,300)}})()`);
  assert(point && point.width > 0 && point.height > 0, '控件不可见：'+selector);
  await send('Input.dispatchMouseEvent', {type:'mouseMoved',x:point.x,y:point.y});
  await send('Input.dispatchMouseEvent', {type:'mousePressed',x:point.x,y:point.y,button:'left',buttons:1,clickCount:1});
  await send('Input.dispatchMouseEvent', {type:'mouseReleased',x:point.x,y:point.y,button:'left',buttons:0,clickCount:1});
  return point;
}
async function key(key, code, windowsVirtualKeyCode) { for (const type of ['keyDown','keyUp']) await send('Input.dispatchKeyEvent',{type,key,code,windowsVirtualKeyCode}); }
(async () => {
 try {
  proc = spawn(executable, ['--headless=new','--remote-debugging-pipe',`--user-data-dir=${profile}`,'--window-size=960,640','--force-device-scale-factor=1','--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-component-update','about:blank'], {stdio:['ignore','ignore','pipe','pipe','pipe'],windowsHide:true});
  proc.stderr.on('data', b => {report.stderrTail = ((report.stderrTail || '') + b.toString()).slice(-16000)});
  proc.on('error', e => {report.errors.push({phase,type:'process',text:String(e)})});
  cdp = new CDP(proc); report.browser = await cdp.send('Browser.getVersion');
  await cdp.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloads,eventsEnabled:true});
  const target = await cdp.send('Target.createTarget',{url:'about:blank'});
  session = (await cdp.send('Target.attachToTarget',{targetId:target.targetId,flatten:true})).sessionId;
  for (const method of ['Page.enable','Runtime.enable','Network.enable']) await send(method);
  await send('Emulation.setDeviceMetricsOverride',{width:960,height:640,deviceScaleFactor:1,mobile:false});
  await send('Page.addScriptToEvaluateOnNewDocument',{source:"try{localStorage.setItem('space11.tour','1')}catch(e){}"});
  phase='加载真实在线入口';
  const nav = await send('Page.navigate',{url:'http://127.0.0.1:8169/space.html?auto=0&q=high'}); assert(!nav.errorText,JSON.stringify(nav));
  await until('产品首帧',()=>evaluate('!!(window.__SE && __SE.firstFrame===false && __SE.deep)'));
  report.initial = await evaluate('({url:location.href,build:__SE.build,width:innerWidth,height:innerHeight,dpr:devicePixelRatio})');
  assert(report.initial.build === 'v196','在线构建不是 v196：'+JSON.stringify(report.initial));
  phase='使用 UI 打开 M51';
  report.deepButton = await click('#deepModelBtn');
  await until('深空面板',()=>evaluate("__SE.deep.info().active && getComputedStyle(document.querySelector('#deepModelPanel')).display!=='none'"));
  report.targetSelect = await click('#deepModelTarget');
  await key('End','End',35); await key('Enter','Enter',13);
  await until('M51',()=>evaluate("__SE.deep.info().id==='m51'"));
  await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  report.m51 = await evaluate("(()=>{const i=__SE.deep.info(),c=__SE.renderer.domElement,g=__SE.renderer.getContext();return {info:i,canvas:{width:c.width,height:c.height},glLost:g.isContextLost(),renderer:g.getParameter(g.RENDERER)}})()");
  assert(report.m51.canvas.width>0 && report.m51.canvas.height>0 && !report.m51.glLost,'M51 未渲染或 WebGL 丢失');
  phase='真实 UI 下载';
  report.shareButton = await click('[data-pop="share"]');
  report.exportButton = await click('#shot1x');
  const begin = await until('下载开始',()=>report.events.find(e=>e.method==='Browser.downloadWillBegin'));
  const completed = await until('下载完成',()=>report.events.find(e=>e.method==='Browser.downloadProgress' && e.guid===begin.guid && ['completed','canceled'].includes(e.state)));
  assert(completed.state==='completed','下载取消：'+JSON.stringify(completed));
  const file = path.join(downloads,begin.suggestedFilename);
  assert(path.dirname(file)===downloads && fs.existsSync(file),'下载文件不存在或文件名不安全');
  const bytes = fs.readFileSync(file); assert(bytes.length>100 && bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')),'PNG 签名或大小无效');
  const ps = "$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Drawing; $s=[System.IO.File]::OpenRead($env:ORBIT_DECODE_FILE); try { $i=[System.Drawing.Image]::FromStream($s,$true,$true); try { $b=New-Object System.Drawing.Bitmap($i); try { $p=$b.GetPixel(0,0); [PSCustomObject]@{width=$b.Width;height=$b.Height;pixel=$p.ToArgb()} | ConvertTo-Json -Compress } finally {$b.Dispose()} } finally {$i.Dispose()} } finally {$s.Dispose()}";
  const decoded = spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',ps],{encoding:'utf8',timeout:30000,env:{...process.env,ORBIT_DECODE_FILE:file}});
  assert(decoded.status===0,'独立解码失败：'+decoded.stderr);
  const dimensions = JSON.parse(decoded.stdout); assert(dimensions.width>0 && dimensions.height>0,'解码尺寸无效');
  report.download = {file, bytes:bytes.length, signature:bytes.subarray(0,8).toString('hex'), sha256:crypto.createHash('sha256').update(bytes).digest('hex'),dimensions,begin,completed};
  report.ok = true;
 } catch(e) {report.ok=false; report.fatal={phase,error:e.stack || String(e)};} finally {
  if(cdp) try {await cdp.send('Browser.close')} catch(e) {report.closeError=String(e)}
  report.finishedAt=new Date().toISOString(); fs.writeFileSync(path.join(dir,'report.json'),JSON.stringify(report,null,2),{flag:'wx'}); console.log(JSON.stringify({dir,ok:report.ok,fatal:report.fatal,download:report.download},null,2)); process.exitCode=report.ok?0:1;
 }
})();
