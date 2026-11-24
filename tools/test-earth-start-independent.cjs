/* 使用已运行的服务，在独立 Chrome profile 中验证地球启动选点。不会启动服务或删除文件。 */
const http = require('http');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const base = process.argv[2] || 'http://127.0.0.1:8169/';
const port = 19400 + Math.floor(Math.random() * 1000);
const chrome = path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe');
const profile = path.join(os.tmpdir(), 'orbit-earth-start-' + process.pid + '-' + Date.now());
const delay = ms => new Promise(r => setTimeout(r, ms));
const get = p => new Promise((resolve, reject) => http.get({host:'127.0.0.1', port, path:p, timeout:2000}, r => {let s='';r.on('data', c => s += c);r.on('end', () => {try {resolve(JSON.parse(s));} catch(e) {reject(e);}});}).on('error', reject));
let proc, ws, id = 0, pending = new Map(), held = [], mode = 'hold', failures = 0, total = 0;
function send(method, params = {}) { return new Promise((resolve, reject) => {const i=++id; pending.set(i,{resolve,reject}); ws.send(JSON.stringify({id:i, method, params}));}); }
async function evalJS(expression) {const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true}); if (r.error || r.result.exceptionDetails) throw Error(JSON.stringify(r.error || r.result.exceptionDetails)); return r.result.result.value;}
function assert(name, condition, detail) {total++; if (!condition) failures++; console.log((condition?'PASS ':'FAIL ')+name+' '+JSON.stringify(detail));}
async function until(fn, ms, label) {const end=Date.now()+ms; while(Date.now()<end){if(await fn())return; await delay(250);} throw Error('timeout: '+label);}
async function release() {mode='pass'; const list=held; held=[]; await Promise.all(list.map(requestId=>send('Fetch.continueRequest',{requestId})));}
async function navigate(query, setup) {
  mode='hold'; held=[];
  await send('Page.navigate',{url:base+'?q=low&auto=0&tour=0&ts=0&'+query});
  await until(()=>held.length>=2,45000,'earth images intercepted');
  await until(async()=>await evalJS('typeof __SE !== "undefined"'),45000,'__SE');
  if(setup) await setup();
}
async function state() {return evalJS('JSON.stringify({cam:__SE.camState(),dir:__SE.cam.dir.toArray(),earth:!!__SE.EDATA,journey:__SE.journeyInfo.on,focus:__SE.cam.focus.name})').then(JSON.parse);}
const near=(a,b)=>Math.abs(a-b)<1e-5;
const sameDir=(a,b)=>a.every((v,i)=>near(v,b[i]));
(async()=>{
  proc=spawn(chrome,['--headless=new','--remote-debugging-port='+port,'--user-data-dir='+profile,'--window-size=800,600','--disable-gpu-sandbox','--no-first-run','--enable-unsafe-swiftshader','--use-angle=swiftshader','about:blank'],{stdio:'ignore'});
  await until(async()=>{try{return !!(await get('/json/version'));}catch{return false;}},20000,'Chrome CDP');
  const target=(await get('/json')).find(t=>t.type==='page');
  ws=new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
  ws.addEventListener('message', e=>{const m=JSON.parse(e.data); if(m.id && pending.has(m.id)){pending.get(m.id).resolve(m);pending.delete(m.id);} else if(m.method==='Fetch.requestPaused'){const requestId=m.params.requestId;if(mode==='hold')held.push(requestId);else if(mode==='fail'){mode='pass'; send('Fetch.failRequest',{requestId,errorReason:'Failed'}); }else send('Fetch.continueRequest',{requestId});}});
  await send('Page.enable'); await send('Runtime.enable');
  await send('Fetch.enable',{patterns:[{urlPattern:'*earth-terrain.png*',requestStage:'Request'},{urlPattern:'*earth-climate.png*',requestStage:'Request'}]});
  await navigate('fresh=1',async()=>{await evalJS('localStorage.removeItem("space11.session.v1")');});
  let before=await state(); await release(); await until(async()=> (await state()).earth,60000,'default earth ready'); let after=await state();
  assert('无输入时地球数据完成后自动选址',!sameDir(before.dir,after.dir),{before:before.dir,after:after.dir});
  await navigate('lat=-20&lon=47&alt=220&pitch=-0.45&yaw=0.3'); before=await state(); await release(); await until(async()=> (await state()).earth,60000,'URL earth ready'); after=await state();
  assert('URL 指定坐标和姿态不被选址覆盖',sameDir(before.dir,after.dir)&&near(after.cam.lat,-20)&&near(after.cam.lon,47)&&near(after.cam.alt,220)&&near(after.cam.pitch,-0.45)&&near(after.cam.yaw,0.3),{before,after});
  const sessionScript = await send('Page.addScriptToEvaluateOnNewDocument',{source:'localStorage.setItem("space11.session.v1",JSON.stringify({v:1,t:123,f:"earth",d:[0,1,0],alt:300,yaw:0.4,pitch:-0.5,ts:0}))'});
  await navigate(''); await send('Page.removeScriptToEvaluateOnNewDocument',{identifier:sessionScript.result.identifier}); before=await state(); await release(); await until(async()=> (await state()).earth,60000,'session earth ready'); after=await state();
  assert('会话恢复机位不被选址覆盖',sameDir(before.dir,after.dir)&&near(after.cam.lat,90)&&near(after.cam.alt,300)&&near(after.cam.yaw,0.4)&&near(after.cam.pitch,-0.5),{before,after});
  await navigate('fresh=1'); before=await state();
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Shift',code:'ShiftLeft',windowsVirtualKeyCode:16}); await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Shift',code:'ShiftLeft',windowsVirtualKeyCode:16});
  await release(); await until(async()=> (await state()).earth,60000,'input earth ready'); after=await state();
  assert('数据加载期间真实键盘输入阻止自动选址',sameDir(before.dir,after.dir),{before:before.dir,after:after.dir});
  await navigate('fresh=1'); await evalJS('__SE.journey()'); before=await state(); await release(); await until(async()=> (await state()).earth,60000,'journey earth ready'); after=await state();
  assert('旅程接管后地球数据不覆盖旅程方向',before.journey&&after.journey&&sameDir(before.dir,after.dir),{before,after});
  await evalJS('__SE.journeyStop()');
  await navigate('fresh=1'); mode='fail'; const requestId=held.shift(); await send('Fetch.failRequest',{requestId,errorReason:'Failed'}); await release();
  await until(async()=>await evalJS('document.getElementById("toast").textContent.includes("地球资源初始化失败")'),60000,'failure fallback toast');
  before=await state(); await until(async()=> (await state()).earth,90000,'earth retry'); after=await state();
  assert('地球资源失败后提示并自动重试恢复',!before.earth&&after.earth,{before,after});
  assert('失败降级后重试不再次改变相机方向',sameDir(before.dir,after.dir),{before:before.dir,after:after.dir});
  console.log('SUMMARY',JSON.stringify({total,failures,profile,base}));
})().catch(e=>{failures++; console.error('ERROR',e.stack);}).finally(()=>{if(ws)ws.close(); if(proc)proc.kill(); process.exitCode=failures?1:0;});
