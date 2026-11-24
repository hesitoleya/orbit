'use strict';
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const net = require('node:net');
const { randomUUID } = require('node:crypto');
const path = require('node:path');
const chrome = process.env.CHROME_PATH || path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe');
const port = Number(process.env.CDP_PORT || 19483);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-worker-ledger-'));
let proc;
async function checkPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  await new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
}
const delay = ms => new Promise(r => setTimeout(r, ms));
let ws, seq = 0; const pending = new Map();
const report = {url:'http://127.0.0.1:8169/index.html?auto=0&q=low',time:new Date().toISOString(),failures:[]};
async function run() {
  await checkPort();
  proc = spawn(chrome, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--window-size=1280,720', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--no-first-run', 'about:blank'], {stdio:['ignore','ignore','pipe']});
  const debuggerUrl = await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(Error('Chrome 调试接口不可用')), 10000);
    proc.once('error', e => { clearTimeout(timer); reject(e); });
    proc.once('exit', () => { clearTimeout(timer); reject(Error('Chrome 启动失败')); });
    proc.stderr.on('data', chunk => {
      output += chunk.toString();
      const match = output.match(/DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[\w-]+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
  });
  ws = new WebSocket(debuggerUrl);
  await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
  ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}};
  let sessionId;
  const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params,...(sessionId&&!method.startsWith('Browser.')?{sessionId}:{})}));});
  const {targetId}=await send('Target.createTarget',{url:'about:blank'});
  ({sessionId}=await send('Target.attachToTarget',{targetId,flatten:true}));
  const ev=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;};
  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.addScriptToEvaluateOnNewDocument',{source:`
    (()=>{const NativeWorker=window.Worker;window.__ledgerProbe={sent:[],received:[],injectGeoError:false,injected:0,workers:0};
      window.Worker=class extends NativeWorker {
        constructor(...args){super(...args);const q=window.__ledgerProbe;this.__id=++q.workers;this.addEventListener('message',e=>{const d=e.data||{};if(d.requestId!=null)q.received.push({id:d.requestId,task:d.task||'geo',worker:this.__id});});}
        postMessage(d,...args){const q=window.__ledgerProbe;if(d&&d.requestId!=null){q.sent.push({id:d.requestId,key:d.key,worker:this.__id});if(q.injectGeoError){q.injectGeoError=false;q.injected++;setTimeout(()=>{const data={task:'err',sourceTask:'geo',requestId:d.requestId,msg:'test injected geo failure'};q.received.push({id:d.requestId,task:'err',worker:this.__id});if(this.onmessage)this.onmessage({data});},0);return;}}return super.postMessage(d,...args);}
      };
    })();`});
  await send('Page.navigate',{url:report.url});
  let ready=false;
  for(let i=0;i<240;i++){await delay(500);try{if(await ev('!!window.__SE && !!__SE.wstate && !!document.querySelector("#loader.done")')){ready=true;break;}}catch{}}
  if(!ready)throw Error('页面未就绪');
  report.initial=await ev('__SE.wstate');
  report.stress=await ev(`new Promise(resolve=>{const samples=[],resets=[];__SE.resetTerrain();for(let i=0;i<20;i++){const before=__SE.wstate;if(before.inflight>0){__SE.resetTerrain();resets.push({before,after:__SE.wstate});}}const started=performance.now();let lastReset=0;const timer=setInterval(()=>{const s=__SE.wstate;s.t=Math.round(performance.now()-started);samples.push(s);if(s.inflight>0&&resets.length<30&&s.t-lastReset>=40){const before=__SE.wstate;__SE.resetTerrain();resets.push({before,after:__SE.wstate});lastReset=s.t;}if(s.t>25000||(resets.length>=30&&s.inflight===0&&s.queue===0&&s.syncQueue===0)){clearInterval(timer);resolve({samples,resets});}},25);})`);
  report.fault=await ev(`new Promise(resolve=>{const before=__SE.wstate;__ledgerProbe.injectGeoError=true;__SE.resetTerrain();const start=performance.now(),samples=[];const t=setInterval(()=>{const s=__SE.wstate;samples.push(s);if((__ledgerProbe.injected&&performance.now()-start>3000&&s.frame>before.frame&&s.inflight===0&&s.queue===0&&s.syncQueue===0)||performance.now()-start>30000){clearInterval(t);resolve({before,after:s,samples,injected:__ledgerProbe.injected,armed:__ledgerProbe.injectGeoError});}},50);})`);
  report.probe=await ev('window.__ledgerProbe');
  const all=[report.initial,...report.stress.samples,...report.stress.resets.flatMap(x=>[x.before,x.after]),...report.fault.samples];
  for(const s of all)if(s.inflight<0||s.inflight>8||s.pj>s.inflight)report.failures.push({kind:'invalid-accounting',state:s});
  if(report.stress.resets.length<10)report.failures.push({kind:'insufficient-active-resets',count:report.stress.resets.length});
  const last=report.stress.samples.at(-1);
  if(!last||last.inflight||last.queue||last.syncQueue||last.pj||!last.geo)report.failures.push({kind:'stress-not-converged',state:last});
  if(!report.fault.injected)report.failures.push({kind:'failure-not-injected'});
  if(report.fault.after.inflight||report.fault.after.queue||report.fault.after.syncQueue||report.fault.after.pj||!report.fault.after.geo)report.failures.push({kind:'fault-not-converged',state:report.fault.after});
  const seen=new Set(), received=new Set(report.probe.received.map(x=>`${x.worker}:${x.id}`));
  for(const x of report.probe.sent){const k=`${x.worker}:${x.id}`;if(seen.has(k))report.failures.push({kind:'duplicate-request-id',request:x});seen.add(k);if(!received.has(k))report.failures.push({kind:'no-response',request:x});}
  report.summary={samples:all.length,resets:report.stress.resets.length,minInflight:Math.min(...all.map(s=>s.inflight)),maxInflight:Math.max(...all.map(s=>s.inflight)),sent:report.probe.sent.length,received:report.probe.received.length,workers:report.probe.workers,stressFinal:last,faultFinal:report.fault.after};
  await send('Browser.close').catch(()=>{});
}
run().catch(e=>{report.failures.push({kind:'exception',message:e.stack});}).finally(()=>{if(ws)ws.close();if(proc)proc.kill();const out=path.join(__dirname,'..',`worker-request-ledger-independent-report-${randomUUID()}.json`);fs.writeFileSync(out,JSON.stringify(report,null,2),{flag:'wx'});console.log(JSON.stringify({summary:report.summary,failures:report.failures,report:out},null,2));if(report.failures.length)process.exitCode=1;});
