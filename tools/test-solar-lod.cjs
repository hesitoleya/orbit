'use strict';
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const chrome = process.env.CHROME_PATH || path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe');
const port = 19387;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-lod-'));
const proc = spawn(chrome, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--window-size=1280,720', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--no-first-run', 'about:blank'], {stdio:'ignore'});
const delay = ms => new Promise(r => setTimeout(r, ms));
let ws, seq = 0; const pending = new Map();
async function run() {
  let targets;
  for (let i=0; i<100; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); break; } catch { await delay(100); } }
  if (!targets) throw Error('Chrome 调试接口不可用');
  ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve,reject) => { ws.onopen=resolve; ws.onerror=reject; });
  ws.onmessage = e => { const m=JSON.parse(e.data); if (m.id && pending.has(m.id)) { const p=pending.get(m.id); pending.delete(m.id); m.error ? p.reject(Error(JSON.stringify(m.error))) : p.resolve(m.result); } };
  const send = (method,params={}) => new Promise((resolve,reject) => { const id=++seq; pending.set(id,{resolve,reject}); ws.send(JSON.stringify({id,method,params})); });
  const ev = async expression => { const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true}); if(r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.navigate',{url:'http://127.0.0.1:8169/index.html?auto=0&q=low'});
  let ready=false;
  for(let i=0;i<240;i++){ await delay(500); try { if(await ev('!!window.__SE && !!__SE.moonDebug && !!document.querySelector("#loader.done")')) {ready=true;break;} } catch {} }
  if(!ready) throw Error('页面未就绪');
  const samples=[], failures=[];
  await ev('__SE.deepSky(true)');
  for (const focus of ['EARTH','MOON']) {
    for (const px of [2.4,2.6,7,2.6,2.4]) {
      await ev(`(()=>{const s=__SE,c=s.cam;s.MOM.v=0;c.focus=s.${focus};c.alt=1e8;c.shift.set(0,0,0);const d=2*s.R_EARTH*(innerHeight/(2*Math.tan(s.camera.fov*Math.PI/360)))/${px};if('${focus}'==='EARTH'){c.alt=d-s.R_EARTH;}else{c.shift.copy(s.EARTH.pos).sub(s.MOON.pos).addScaledVector(c.dir,d-(s.MOON.radius+c.alt));}})()`);
      await ev('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
      await delay(1000);
      const state=await ev(`new Promise(r=>requestAnimationFrame(()=>{const s=__SE,m=s.moonDebug(),d=s.EARTH.pos.distanceTo(new s.THREE.Vector3(...m.camAbs));const meshes=s.terrainGroup.children.filter(x=>x.visible),center=s.EARTH.pos.clone().sub(new s.THREE.Vector3(...m.camAbs));const maxCenterError=Math.max(0,...meshes.map(x=>Math.abs(x.position.clone().add(s.terrainGroup.position).distanceTo(center)-s.R_EARTH)));r({focus:s.cam.focus===s.${focus},earthPx:2*s.R_EARTH/d*(innerHeight/(2*Math.tan(s.camera.fov*Math.PI/360))),earthTerrain:s.terrainGroup.visible,earthGlow:s.EARTH.glow.visible,groupPosition:s.terrainGroup.position.toArray(),visibleMeshes:meshes.length,maxCenterError,meshPositions:meshes.slice(0,3).map(x=>x.position.toArray()),camAbs:m.camAbs,earthPos:s.EARTH.pos.toArray(),cs:s.CS.active})}))`);
      samples.push({focus,requestedEarthPx:px,...state});
      if (!state.focus || state.cs || Math.abs(state.earthPx-px)>0.08 || state.earthTerrain !== (state.earthPx>=2.5) || state.earthGlow !== (state.earthPx<3.3) || (state.earthTerrain && (!state.visibleMeshes || state.maxCenterError>1000))) failures.push({focus,px,state});
    }
  }
  const result={time:new Date().toISOString(),url:'http://127.0.0.1:8169/index.html?auto=0&q=low',profile,samples,failures};
  const out=path.join(__dirname,'..','solar-lod-terrain-validation.json'); fs.writeFileSync(out,JSON.stringify(result,null,2));
  console.log(JSON.stringify(result,null,2));
  if (failures.length) process.exitCode=1;
  await send('Browser.close').catch(()=>{});
}
run().catch(e=>{console.error(e.stack); if(ws) ws.close();proc.kill();process.exitCode=1;});
