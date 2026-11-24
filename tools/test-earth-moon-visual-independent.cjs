'use strict';
const {spawn}=require('node:child_process');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const root=path.resolve(__dirname,'..'), tag='earth-moon-visual-'+new Date().toISOString().replace(/[:.]/g,'-');
const out=path.join(root,tag);fs.mkdirSync(out);
const chrome=process.env.CHROME_PATH||[process.env.LOCALAPPDATA,process.env.PROGRAMFILES,process.env['PROGRAMFILES(X86)']].filter(Boolean).map(x=>path.join(x,'Google/Chrome/Application/chrome.exe')).find(fs.existsSync);
if(!chrome)throw Error('找不到 Chrome，请设置 CHROME_PATH');
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'orbit-earth-moon-'));
const proc=spawn(chrome,['--headless=new','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--window-size=1280,900','--enable-unsafe-swiftshader','--use-angle=swiftshader','--no-first-run','about:blank'],{stdio:['ignore','ignore','pipe'],windowsHide:true});
const delay=ms=>new Promise(r=>setTimeout(r,ms));let ws,seq=0;const pending=new Map();
const report={url:'http://127.0.0.1:8169/index.html?auto=0&q=low',profile,samples:[],failures:[],errors:[],limitations:['使用调试接口分步移动相机，不是鼠标滚轮或拖拽交互测试。','状态断言只验证对象状态，不能替代对截图的视觉检查。','截图不证明任意角度或真实 GPU 上均无瑕疵。']};
function send(method,params={},sessionId){return new Promise((resolve,reject)=>{const id=++seq,t=setTimeout(()=>{pending.delete(id);reject(Error(method+' 超时'));},60000);pending.set(id,{resolve,reject,t});ws.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));});}
async function run(){
 const endpoint=await new Promise((resolve,reject)=>{let buf='';const t=setTimeout(()=>reject(Error('浏览器启动超时')),30000);proc.stderr.on('data',v=>{buf+=v;const m=buf.match(/DevTools listening on (ws:\/\/\S+)/);if(m){clearTimeout(t);resolve(m[1]);}});proc.on('error',reject);proc.on('exit',c=>reject(Error('浏览器退出 '+c)));});
 ws=new WebSocket(endpoint);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j});ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);clearTimeout(p.t);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result||{});}};
 const target=await send('Target.createTarget',{url:'about:blank'}),session=(await send('Target.attachToTarget',{targetId:target.targetId,flatten:true})).sessionId;
 const call=(m,p={})=>send(m,p,session),ev=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;};
 await call('Page.enable');await call('Runtime.enable');await call('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});await call('Page.navigate',{url:report.url});
 let ready=false;for(let i=0;i<240;i++){await delay(500);try{if(await ev('!!window.__SE && !!__SE.moonDebug && !!document.querySelector("#loader.done")')){ready=true;break;}}catch{}}
 if(!ready)throw Error('页面未就绪');
 await ev("__SE.deepSky(true);document.getElementById('loader').style.display='none';const t=document.getElementById('tour');if(t)t.style.display='none';__SE.MOM.v=0;__SE.cam.focus=__SE.MOON;__SE.cam.dir.set(1,0,0);__SE.cam.pitch=-Math.PI/2;__SE.cam.yaw=0");
 for(const body of ['EARTH','MOON'])for(const [direction,series] of [['out',[4,3,2.7,2.55,2.45,2.3,2.1,1.9,1.7]],['in',[1.7,1.9,2.1,2.3,2.45,2.55,2.7,3,4]]])for(let i=0;i<series.length;i++){
  const px=series[i];await ev(`(()=>{const s=__SE,c=s.cam,b=s.${body};c.focus=s.MOON;c.dir.set(0,1,0);c.alt=2*b.radius*(innerHeight/(2*Math.tan(s.camera.fov*Math.PI/360)))/${px}-s.MOON.radius;c.shift.copy(b.pos).sub(s.MOON.pos);c.pitch=-Math.PI/2;c.yaw=0;s.MOM.v=0})()`);
  await ev('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');await delay(350);
  const state=await ev(`(()=>{const s=__SE,m=s.moonDebug(),p=new s.THREE.Vector3(...m.camAbs),e=s.EARTH.pos.distanceTo(p),earthPx=2*s.R_EARTH/e*(innerHeight/(2*Math.tan(s.camera.fov*Math.PI/360)));return {earthPx,moonPx:m.px,earthTerrain:s.terrainGroup.visible,earthGlow:s.EARTH.glow.visible,moonMesh:m.visible,moonGlow:s.MOON.glow.visible,earthMeshes:s.terrainGroup.children.filter(x=>x.visible).length,camAbs:m.camAbs,cs:s.CS.active}})()`);
  const actual=body==='EARTH'?state.earthPx:state.moonPx;
  const mesh=body==='EARTH'?state.earthTerrain:state.moonMesh;
  const glow=body==='EARTH'?state.earthGlow:state.moonGlow;
  const meshEdge=body==='EARTH'?2.5:2;
  const glowEdge=meshEdge+0.8;
  /* 光点在实体切换前 0.8px 进入渐变带；实体和光点对象可同时 visible，
     不能再用 visible 互斥判断替代渐变权重。 */
  if(Math.abs(actual-px)>0.12||mesh!==(actual>=meshEdge)||glow!==(actual<glowEdge)||state.cs)report.failures.push({body,direction,px,state});
  const name=`${body.toLowerCase()}-${direction}-${String(i).padStart(2,'0')}-${px}.png`,image=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(out,name),Buffer.from(image.data,'base64'));report.samples.push({body,direction,requestedPx:px,state,screenshot:name});
 }
 // 地球遮挡月球：相机、地球、月球共线，月球光点在地球后方。
 await ev(`(()=>{const s=__SE,c=s.cam,dir=s.EARTH.pos.clone().sub(s.MOON.pos).normalize();c.focus=s.MOON;c.dir.copy(dir);c.shift.copy(s.EARTH.pos).sub(s.MOON.pos);c.alt=1.5e9-s.MOON.radius;c.pitch=-Math.PI/2;c.yaw=0})()`);
 await ev('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');await delay(1000);
 const occlusion=await ev(`(()=>{const s=__SE,m=s.moonDebug(),p=new s.THREE.Vector3(...m.camAbs),a=s.EARTH.pos.clone().sub(p),b=s.MOON.pos.clone().sub(p);return {earthPx:2*s.R_EARTH/a.length()*(innerHeight/(2*Math.tan(s.camera.fov*Math.PI/360))),moonPx:m.px,earthTerrain:s.terrainGroup.visible,moonMesh:m.visible,moonGlow:s.MOON.glow.visible,angularSeparation:a.angleTo(b),earthMeshes:s.terrainGroup.children.filter(x=>x.visible).length}})()`);
 const image=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(out,'occlusion-earth-in-front.png'),Buffer.from(image.data,'base64'));report.occlusion={state:occlusion,screenshot:'occlusion-earth-in-front.png'};
 if(!occlusion.earthTerrain||!occlusion.moonGlow||occlusion.moonMesh||occlusion.angularSeparation>0.001)report.failures.push({case:'occlusion-setup',state:occlusion});
}
run().catch(e=>{report.errors.push(e.stack||String(e));process.exitCode=1}).finally(async()=>{report.finished=new Date().toISOString();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));if(ws&&ws.readyState===1){try{await send('Browser.close')}catch{}ws.close()}else proc.kill();if(report.failures.length)process.exitCode=1;console.log(JSON.stringify({directory:out,samples:report.samples.length,failures:report.failures.length,errors:report.errors}));});
