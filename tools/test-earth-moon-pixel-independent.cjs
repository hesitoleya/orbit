'use strict';
const {spawn}=require('node:child_process');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const root=path.resolve(__dirname,'..'), tag='earth-moon-pixel-'+new Date().toISOString().replace(/[:.]/g,'-')+'-'+process.pid;
const out=path.join(root,tag);fs.mkdirSync(out);
const chrome=process.env.CHROME_PATH||[process.env.LOCALAPPDATA,process.env.PROGRAMFILES,process.env['PROGRAMFILES(X86)']].filter(Boolean).map(x=>path.join(x,'Google/Chrome/Application/chrome.exe')).find(fs.existsSync);
if(!chrome)throw Error('找不到 Chrome，请设置 CHROME_PATH');
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'orbit-earth-moon-'));
const proc=spawn(chrome,['--headless=new','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--window-size=1280,900','--enable-unsafe-swiftshader','--use-angle=swiftshader','--no-first-run','about:blank'],{stdio:['ignore','ignore','pipe'],windowsHide:true});
const delay=ms=>new Promise(r=>setTimeout(r,ms));let ws,seq=0;const pending=new Map();
const report={url:process.env.ORBIT_TEST_URL||'http://127.0.0.1:8169/index.html?auto=0&q=low',profile,samples:[],failures:[],errors:[],limitations:['使用调试接口分步移动相机，不是鼠标滚轮或拖拽交互测试。','状态断言只验证对象状态，不能替代对截图的视觉检查。','截图不证明任意角度或真实 GPU 上均无瑕疵。']};
function send(method,params={},sessionId){return new Promise((resolve,reject)=>{const id=++seq,t=setTimeout(()=>{pending.delete(id);reject(Error(method+' 超时'));},60000);pending.set(id,{resolve,reject,t});ws.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));});}
async function run(){
 const endpoint=await new Promise((resolve,reject)=>{let buf='';const t=setTimeout(()=>reject(Error('浏览器启动超时')),30000);proc.stderr.on('data',v=>{buf+=v;const m=buf.match(/DevTools listening on (ws:\/\/\S+)/);if(m){clearTimeout(t);resolve(m[1]);}});proc.on('error',reject);proc.on('exit',c=>reject(Error('浏览器退出 '+c)));});
 ws=new WebSocket(endpoint);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j});ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);clearTimeout(p.t);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result||{});}};
 const target=await send('Target.createTarget',{url:'about:blank'}),session=(await send('Target.attachToTarget',{targetId:target.targetId,flatten:true})).sessionId;
 const call=(m,p={})=>send(m,p,session),ev=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;};
 await call('Page.enable');await call('Runtime.enable');await call('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});await call('Page.navigate',{url:report.url});
 let ready=false;for(let i=0;i<240;i++){await delay(500);try{if(await ev('!!window.__SE && !!__SE.moonDebug && !!document.querySelector("#loader.done")')){ready=true;break;}}catch{}}
 if(!ready)throw Error('页面未就绪');
 report.runtime=await ev(`(async()=>{const scripts=performance.getEntriesByType('resource').filter(x=>/app\\.js/.test(x.name)).map(x=>x.name);const response=await fetch(scripts[0],{cache:'no-store'});const hash=await crypto.subtle.digest('SHA-256',await response.arrayBuffer());return {scripts,appSha256:Array.from(new Uint8Array(hash),x=>x.toString(16).padStart(2,'0')).join(''),userAgent:navigator.userAgent}})()`);
 await ev("__SE.deepSky(true);document.getElementById('loader').style.display='none';const t=document.getElementById('tour');if(t)t.style.display='none';__SE.MOM.v=0;__SE.cam.focus=__SE.MOON;__SE.cam.dir.set(1,0,0);__SE.cam.pitch=-Math.PI/2;__SE.cam.yaw=0");
 const capture=async()=> (await call('Page.captureScreenshot',{format:'png'})).data;
 const compare=async(a,b)=>ev(`(async()=>{const load=src=>new Promise((r,j)=>{const i=new Image();i.onload=()=>r(i);i.onerror=j;i.src='data:image/png;base64,'+src});const imgs=await Promise.all([load(${JSON.stringify(a)}),load(${JSON.stringify(b)})]);const c=document.createElement('canvas');c.width=1280;c.height=900;const g=c.getContext('2d');g.drawImage(imgs[0],0,0);const a=g.getImageData(624,434,32,32).data;g.clearRect(0,0,1280,900);g.drawImage(imgs[1],0,0);const b=g.getImageData(624,434,32,32).data;let sum=0,max=0;for(let i=0;i<a.length;i+=4)for(let j=0;j<3;j++){const d=Math.abs(a[i+j]-b[i+j]);sum+=d;max=Math.max(max,d)}return {sum,max}})()`);
 let previous=null;
 for(const body of ['EARTH','MOON'])for(const [direction,series] of [['out',Array.from({length:17},(_,i)=>4-i*0.15)]])for(let i=0;i<series.length;i++){
  const px=series[i];await ev(`(()=>{const s=__SE,c=s.cam,b=s.${body};c.focus=s.MOON;c.dir.set(0,1,0);c.alt=2*b.radius*(innerHeight/(2*Math.tan(s.camera.fov*Math.PI/360)))/${px}-s.MOON.radius;c.shift.copy(b.pos).sub(s.MOON.pos);c.pitch=-Math.PI/2;c.yaw=0;s.MOM.v=0})()`);
  await ev('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');await delay(350);
  const state=await ev(`(()=>{const s=__SE,m=s.moonDebug(),p=new s.THREE.Vector3(...m.camAbs),e=s.EARTH.pos.distanceTo(p),b=s.${body},rel=b.pos.clone().sub(p),view=rel.clone().normalize(),g=b.glow.position.clone(),frontDot=b.glow.visible?g.sub(rel).dot(view):null,earthPx=2*s.R_EARTH/e*(innerHeight/(2*Math.tan(s.camera.fov*Math.PI/360)));return {earthPx,moonPx:m.px,earthTerrain:s.terrainGroup.visible,earthGlow:s.EARTH.glow.visible,moonMesh:m.visible,moonGlow:s.MOON.glow.visible,earthMeshes:s.terrainGroup.children.filter(x=>x.visible).length,camAbs:m.camAbs,cs:s.CS.active,glowFrontDot:frontDot,occCandidates:s.occBodies}})()`);
  const actual=body==='EARTH'?state.earthPx:state.moonPx, mesh=body==='EARTH'?state.earthTerrain:state.moonMesh,glow=body==='EARTH'?state.earthGlow:state.moonGlow,threshold=body==='EARTH'?2.5:2;
  if(Math.abs(actual-px)>0.12||mesh!==(body==='EARTH'?actual>=threshold:actual>threshold)||glow!==(actual<threshold+0.8)||state.cs||(state.glowFrontDot!=null&&state.glowFrontDot>=0)||state.occCandidates!==10)report.failures.push({body,direction,px,state});
  const name=`${body.toLowerCase()}-${direction}-${String(i).padStart(2,'0')}-${px}.png`,image=await call('Page.captureScreenshot',{format:'png'});const adjacent=i?await compare(previous,image.data):null;previous=image.data;fs.writeFileSync(path.join(out,name),Buffer.from(image.data,'base64'));report.samples.push({body,direction,requestedPx:px,state,adjacent,screenshot:name});
 }
 // 比较同一视角的屏幕中心像素；禁用材质颜色写入只作为光点消除对照。
 const wait=async()=>{await ev('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');await delay(500)};
 report.pixelSwitch=[];
 for(const body of ['EARTH','MOON']){
  await ev(`(()=>{const s=__SE,c=s.cam,b=s.${body};s.deepSky(true);c.focus=s.MOON;c.dir.set(0,1,0);c.alt=2*b.radius*(innerHeight/(2*Math.tan(s.camera.fov*Math.PI/360)))/1.4-s.MOON.radius;c.shift.copy(b.pos).sub(s.MOON.pos);c.pitch=-Math.PI/2;c.yaw=0;s.MOM.v=0})()`);await wait();
  const on=await capture();await ev('__SE.deepSky(false)');await wait();const off=await capture();
  await ev(`__SE.deepSky(true);__SE.${body}.glow.material.colorWrite=false`);await wait();const hidden=await capture();await ev(`__SE.${body}.glow.material.colorWrite=true`);
  const onOff=await compare(on,off),onHidden=await compare(on,hidden);for(const [name,data] of [['on',on],['off',off],['hidden',hidden]])fs.writeFileSync(path.join(out,`${body.toLowerCase()}-switch-${name}.png`),Buffer.from(data,'base64'));
  report.pixelSwitch.push({body,onOff,onHidden});if(onHidden.sum<20||onOff.sum>Math.max(30,onHidden.sum*0.25))report.failures.push({case:'deep-sky-preserves-earth-moon',body,onOff,onHidden});
 }
 // 地球遮挡月球：相机、地球、月球共线，月球光点在地球后方。
 await ev(`(()=>{const s=__SE,c=s.cam,dir=s.EARTH.pos.clone().sub(s.MOON.pos).normalize();c.focus=s.MOON;c.dir.copy(dir);c.shift.copy(s.EARTH.pos).sub(s.MOON.pos);c.alt=1.5e9-s.MOON.radius;c.pitch=-Math.PI/2;c.yaw=0})()`);
 await ev('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');await delay(1000);
 const occlusion=await ev(`(()=>{const s=__SE,m=s.moonDebug(),p=new s.THREE.Vector3(...m.camAbs),a=s.EARTH.pos.clone().sub(p),b=s.MOON.pos.clone().sub(p);return {earthPx:2*s.R_EARTH/a.length()*(innerHeight/(2*Math.tan(s.camera.fov*Math.PI/360))),moonPx:m.px,earthTerrain:s.terrainGroup.visible,moonMesh:m.visible,moonGlow:s.MOON.glow.visible,angularSeparation:a.angleTo(b),earthMeshes:s.terrainGroup.children.filter(x=>x.visible).length}})()`);
 const image=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(out,'occlusion-earth-in-front.png'),Buffer.from(image.data,'base64'));report.occlusion={state:occlusion,screenshot:'occlusion-earth-in-front.png'};
 if(!occlusion.earthTerrain||!occlusion.moonGlow||occlusion.moonMesh||occlusion.angularSeparation>0.001)report.failures.push({case:'occlusion-setup',state:occlusion});
 await ev(`(()=>{const s=__SE,c=s.cam,dir=s.EARTH.pos.clone().sub(s.MOON.pos).normalize();s.deepSky(true);c.focus=s.MOON;c.dir.copy(dir);c.shift.copy(s.EARTH.pos).sub(s.MOON.pos);c.alt=1e11-s.MOON.radius;c.pitch=-Math.PI/2;c.yaw=0;s.MOM.v=0})()`);await wait();
 const farOn=await capture();await ev('__SE.MOON.glow.material.colorWrite=false');await wait();const farHidden=await capture();await ev('__SE.MOON.glow.material.colorWrite=true');
 const farDiff=await compare(farOn,farHidden);report.farOcclusion={farDiff};fs.writeFileSync(path.join(out,'far-occlusion-on.png'),Buffer.from(farOn,'base64'));fs.writeFileSync(path.join(out,'far-occlusion-hidden.png'),Buffer.from(farHidden,'base64'));
 if(farDiff.sum>30)report.failures.push({case:'far-moon-behind-earth',farDiff});
 // 远距光点的前后顺序、部分交叠与自身遮挡；相机始终对准前景天体。
 report.farCases=[];
 for(const [front,back,angle,kind] of [['EARTH','MOON',0,'covered'],['EARTH','MOON',0.0166,'partial'],['EARTH','MOON',0.08,'separate'],['MOON','EARTH',0,'covered'],['MOON','EARTH',0.0166,'partial'],['MOON','EARTH',0.08,'separate']]){
  await ev(`(()=>{const s=__SE,c=s.cam,f=s.${front},b=s.${back};const axis=new s.THREE.Vector3(0,1,0),dir=f.pos.clone().sub(b.pos).normalize();if(Math.abs(dir.dot(axis))>0.9)axis.set(1,0,0);dir.applyAxisAngle(axis,${angle});c.focus=s.MOON;c.dir.copy(dir);c.shift.copy(f.pos).sub(s.MOON.pos);c.alt=1e11-s.MOON.radius;c.pitch=-Math.PI/2;c.yaw=0;s.MOM.v=0;s.deepSky(true)})()`);await wait();
  const state=await ev(`(()=>{const s=__SE,p=new s.THREE.Vector3(...s.moonDebug().camAbs),f=s.${front},b=s.${back},a=f.pos.clone().sub(p),z=b.pos.clone().sub(p);return {frontDistance:a.length(),backDistance:z.length(),separation:a.angleTo(z),frontRadius:Math.asin(f.radius/a.length()),backRadius:Math.asin(b.radius/z.length()),frontOpacity:f.glow.material.opacity,backOpacity:b.glow.material.opacity,frontVisible:f.glow.visible,backVisible:b.glow.visible}})()`);
  const on=await capture();await ev(`__SE.${front}.glow.material.colorWrite=false`);await wait();const hidden=await capture();await ev(`__SE.${front}.glow.material.colorWrite=true`);await wait();
  const diff=await compare(on,hidden),name=`far-${front.toLowerCase()}-${kind}`;fs.writeFileSync(path.join(out,name+'-on.png'),Buffer.from(on,'base64'));fs.writeFileSync(path.join(out,name+'-hidden.png'),Buffer.from(hidden,'base64'));
  report.farCases.push({front,back,kind,state,diff});
  const residual=state.frontRadius>=state.backRadius?0:1-(state.frontRadius/state.backRadius)**2,ratio=state.backOpacity/state.frontOpacity;
  if(!state.frontVisible||!state.backVisible||state.frontDistance>=state.backDistance||state.frontOpacity<0.8||diff.sum<20||!Number.isFinite(ratio)||kind==='covered'&&Math.abs(ratio-residual)>0.03||kind==='partial'&&!(state.separation>Math.abs(state.frontRadius-state.backRadius)&&state.separation<state.frontRadius+state.backRadius&&ratio>residual+0.005&&ratio<0.995)||kind==='separate'&&(state.separation<=state.frontRadius+state.backRadius||ratio<0.99))report.failures.push({case:name,state,ratio,residual,diff});
 }
}
run().catch(e=>{report.errors.push(e.stack||String(e));process.exitCode=1}).finally(async()=>{report.finished=new Date().toISOString();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));if(ws&&ws.readyState===1){try{await send('Browser.close')}catch{}ws.close()}else proc.kill();if(report.failures.length)process.exitCode=1;console.log(JSON.stringify({directory:out,samples:report.samples.length,failures:report.failures.length,errors:report.errors}));});
