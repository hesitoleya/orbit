/* 使用现有服务与真实 Chrome 注入 Worker 消息故障；保留独立浏览器配置作为证据。 */
const http = require('http');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const port = 20500 + Math.floor(Math.random() * 1000);
const chrome = path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe');
const profile = path.join(os.tmpdir(), 'orbit-terrain-fault-' + process.pid + '-' + Date.now());
const delay = ms => new Promise(r => setTimeout(r, ms));
const get = p => new Promise((resolve, reject) => http.get({host:'127.0.0.1', port, path:p, timeout:2000}, r => {let s='';r.on('data', c => s += c);r.on('end', () => {try {resolve(JSON.parse(s));} catch(e) {reject(e);}});}).on('error', reject));
let proc, ws, id=0, pending=new Map(), failures=0;
function send(method, params={}) {return new Promise((resolve,reject)=>{const i=++id;pending.set(i,{resolve,reject});ws.send(JSON.stringify({id:i,method,params}));});}
async function evaluate(expression) {const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.error || r.result.exceptionDetails)throw Error(JSON.stringify(r.error || r.result.exceptionDetails));return r.result.result.value;}
async function until(fn, ms, label) {const end=Date.now()+ms;while(Date.now()<end){if(await fn())return;await delay(250);}throw Error('超时: '+label);}
function check(name, ok, state) {console.log((ok?'PASS ':'FAIL ')+name+' '+JSON.stringify(state));if(!ok)failures++;}
const state=()=>evaluate(`JSON.stringify({t:Math.round(performance.now()),loader:document.getElementById('loader').dataset.outcome,done:document.getElementById('loader').classList.contains('done'),resets:__SE.terrainResets,rebuilds:__SE.workerRebuilt,visible:__SE.visCount,pending:__SE.pending,fault:window.__fault,journey:__SE.journeyInfo.on})`).then(JSON.parse);
(async()=>{
 proc=spawn(chrome,['--headless=new','--remote-debugging-port='+port,'--user-data-dir='+profile,'--window-size=800,600','--disable-gpu-sandbox','--no-first-run','--enable-unsafe-swiftshader','--use-angle=swiftshader','about:blank'],{stdio:'ignore'});
 await until(async()=>{try{return !!(await get('/json/version'));}catch{return false;}},20000,'Chrome CDP');
 const target=(await get('/json')).find(t=>t.type==='page');ws=new WebSocket(target.webSocketDebuggerUrl);
 await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
 ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id&&pending.has(m.id)){pending.get(m.id).resolve(m);pending.delete(m.id);}else if(m.method==='Runtime.consoleAPICalled'&&['warning','error'].includes(m.params.type)) console.log('CONSOLE',m.params.type,m.params.args.map(a=>a.value||a.description).join(' '));else if(m.method==='Runtime.exceptionThrown')console.log('EXCEPTION',JSON.stringify(m.params.exceptionDetails));});
 await send('Page.enable');await send('Runtime.enable');await send('Network.enable');await send('Network.setCacheDisabled',{cacheDisabled:true});await send('Network.setBypassServiceWorker',{bypass:true});
 const source=`(()=>{const Native=window.Worker, nativeTimeout=window.setTimeout;window.setTimeout=function(fn,ms,...args){return nativeTimeout(fn,ms===30000?90000:ms,...args)};window.__fault={workers:0,dropped:0,pass:false};window.Worker=class extends Native{constructor(...a){super(...a);this._faultId=++window.__fault.workers}postMessage(data,...rest){if(data && data.requestId && !window.__fault.pass){window.__fault.dropped++;return}return super.postMessage(data,...rest)}}})();`;
 await send('Page.addScriptToEvaluateOnNewDocument',{source});
 const navigate=async()=>{await send('Page.navigate',{url:'http://127.0.0.1:8169/?q=low&auto=0&tour=0&ts=0&fresh=1'});try { await until(()=>evaluate('typeof __SE!=="undefined" && __SE.pending>0'),20000,'地形请求'); } catch(e) { console.log('DEBUG',await evaluate('JSON.stringify({url:location.href,title:document.title,body:document.body.innerText.slice(0,500),se:typeof __SE,pending:__SE.pending,visible:__SE.visCount,tree:__SE.treeDbg(),fault:window.__fault,ready:document.readyState})')); throw e; }};
 await navigate();await until(async()=> (await state()).loader==='timeout',60000,'遮罩超时');let s=await state();check('遮罩超时且持续阻塞 geo',s.loader==='timeout'&&s.done&&s.fault.dropped>0&&s.resets===0,s);
 await until(async()=> (await state()).resets>0,55000,'30秒看门狗');s=await state();check('30秒无进展触发重建',s.resets===1&&s.rebuilds>=1&&s.fault.dropped>0,s);
 await evaluate('window.__fault.pass=true');await until(async()=> (await state()).visible>0,60000,'放行后可见地形');s=await state();check('放行 geo 后地形恢复',s.visible>0,s);
 await navigate();await until(async()=> (await state()).loader==='timeout',60000,'第二次遮罩超时');await evaluate('__SE.journey()');s=await state();check('进入旅程前已超时且阻塞',s.loader==='timeout'&&s.fault.dropped>0&&s.journey,s);
 await delay(36000);s=await state();check('旅程接管后即使旅程结束也不触发启动看门狗',s.resets===0&&s.rebuilds===0,s);
 console.log('SUMMARY',JSON.stringify({failures,profile,base:'http://127.0.0.1:8169/'}));
})().catch(e=>{failures++;console.error('ERROR',e.stack);console.log('SUMMARY',JSON.stringify({failures,profile}));}).finally(()=>{if(ws)ws.close();if(proc)proc.kill();process.exitCode=failures?1:0;});
