'use strict';
// M51 局部体密度对照：仅在浏览器内替换材质 shader，不改部署文件。
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const stamp = Date.now();
const prefix = `m51-density-experiment-${stamp}`;
const report = { experiment: 'disk density *= smoothstep(0.32, 0.68, fine)', notes: ['程序化密度试验，不是观测三维重建；RGB 为显示编码而非线性 HDR。', '材质 shader 在浏览器内临时修改；盘面发射改变，独立的 sigma 消光密度不变。'], cases: [], errors: [] };
let child, ws;
const pending = new Map(); let seq = 0, sid;
function send(method, params = {}, sessionId = sid) {
  return new Promise((resolve, reject) => {
    const id = ++seq, timer = setTimeout(() => { pending.delete(id); reject(new Error('CDP timeout: ' + method)); }, 120000);
    pending.set(id, { resolve, reject, timer });
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
}
async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}
async function run() {
  const base = path.join(root, '.workbuddy');
  if (!fs.statSync(base).isDirectory()) throw new Error('缺少项目 profile 目录');
  const profile = fs.mkdtempSync(path.join(base, 'm51-density-'));
  const choices = [process.env.CHROME_PATH, process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google/Chrome/Application/chrome.exe'), process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Google/Chrome/Application/chrome.exe'), process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe')].filter(Boolean);
  const chrome = choices.find(fs.existsSync); if (!chrome) throw new Error('未找到 Chrome');
  child = spawn(chrome, ['--headless=new', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--window-size=960,640', '--force-device-scale-factor=1', '--no-first-run', '--disable-background-networking', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
  const endpoint = await new Promise((resolve, reject) => {
    let text = ''; const timer = setTimeout(() => reject(new Error('Chrome 启动超时')), 45000);
    child.once('error', reject); child.once('exit', code => reject(new Error('Chrome 退出 ' + code)));
    child.stderr.on('data', d => { text += d; const m = text.match(/DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[^\s]+)/); if (m) { clearTimeout(timer); resolve(m[1]); } });
  });
  ws = new WebSocket(endpoint); await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }); });
  ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); clearTimeout(p.timer); pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result || {}); } else if (m.method === 'Runtime.exceptionThrown' || (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error')) report.errors.push(m.params); });
  report.browser = await send('Browser.getVersion', {}, null);
  const target = await send('Target.createTarget', { url: 'about:blank' }, null);
  sid = (await send('Target.attachToTarget', { targetId: target.targetId, flatten: true }, null)).sessionId;
  await Promise.all(['Runtime.enable', 'Page.enable', 'Network.enable'].map(x => send(x)));
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Network.setBypassServiceWorker', { bypass: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 960, height: 640, deviceScaleFactor: 1, mobile: false });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: "try{localStorage.setItem('space11.tour','1')}catch(_){}" });
  const nav = await send('Page.navigate', { url: 'http://127.0.0.1:8169/space.html?auto=0&q=high' });
  if (nav.errorText) throw new Error(nav.errorText);
  await evaluate(`new Promise((resolve,reject)=>{let n=0;function check(){if(window.__SE&&__SE.firstFrame===false&&__SE.deep)resolve(true);else if(++n>1200)reject(Error('页面未就绪'));else setTimeout(check,100)}check()})`);
  await evaluate(`(()=>{__SE.ts=0;if(__SE.tour)__SE.tour(false);if(__SE.help)__SE.help(false);__SE.deep.open('m51');__SE.deep.setDust(true);window.__densityPixels={};return true})()`);
  // 同一材质先后切换，顺序包括 A-B-A，避免单纯跨会话对比。
  const views = [ ['front',{yaw:0,pitch:0,distance:3.6,target:[0,0,0]}], ['back',{yaw:Math.PI,pitch:0,distance:3.6,target:[0,0,0]}], ['near-front',{yaw:0,pitch:0,distance:0.35,target:[0,0,0]}], ['near-back',{yaw:Math.PI,pitch:0,distance:0.35,target:[0,0,0]}] ];
  for (const [name, view] of views) {
    await evaluate(`__SE.deep.setView(${JSON.stringify(view)})`);
    for (const mode of ['baseline','trial','restored']) {
      const state = await evaluate(`(()=>{const c=__SE.deep.controller;let changed=0; c.scene.traverse(o=>{const m=o.material;if(!m)return;for(const key of ['fragmentShader','vertexShader']){if(!m[key])continue;const original='float disk=exp(-r*2.2)*exp(-abs(q.z)/height)*edgeR;';const trial='float disk=exp(-r*2.2)*exp(-abs(q.z)/height)*edgeR*smoothstep(0.32,0.68,fine);';let s=m[key]; if(${JSON.stringify(mode)}==='trial')s=s.replace(original,trial); else s=s.replace(trial,original);if(s!==m[key]){m[key]=s;m.needsUpdate=true;changed++;}}});return {changed,info:__SE.deep.info()}})()`);
      if (mode !== 'baseline' && state.changed !== 2) throw new Error('试验 shader 数量异常 ' + JSON.stringify(state));
      await evaluate('new Promise(r=>{let n=5;function f(){if(--n)requestAnimationFrame(f);else r()}requestAnimationFrame(f)})');
      const key = `${name}-${mode}`;
      const meta = await evaluate(`(async()=>{const u=__SE.snap('image/png');const img=new Image();img.src=u;await img.decode();const c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;const x=c.getContext('2d',{willReadFrequently:true});x.drawImage(img,0,0);const p=x.getImageData(0,0,c.width,c.height).data;window.__densityPixels[${JSON.stringify(key)}]=p;let sum=0,sum2=0,white=0;for(let i=0;i<p.length;i+=4){let y=.2126*p[i]+.7152*p[i+1]+.0722*p[i+2];sum+=y;sum2+=y*y;if(Math.min(p[i],p[i+1],p[i+2])>=250)white++}let n=p.length/4;return {url:u,width:c.width,height:c.height,mean:sum/n,std:Math.sqrt(sum2/n-(sum/n)**2),whiteRatio:white/n}})()`);
      const bytes = Buffer.from(meta.url.split(',')[1], 'base64'); delete meta.url;
      const file = path.join(root, `${prefix}-${key}.png`); fs.writeFileSync(file, bytes, { flag: 'wx' });
      report.cases.push({ name, mode, file, sha256: createHash('sha256').update(bytes).digest('hex'), ...meta, camera: state.info.camera });
    }
    const diff = await evaluate(`(()=>{function d(a,b){a=__densityPixels[${JSON.stringify(name+'-')}+a];b=__densityPixels[${JSON.stringify(name+'-')}+b];let s=0;for(let i=0;i<a.length;i+=4)for(let k=0;k<3;k++)s+=Math.abs(a[i+k]-b[i+k]);return s/(a.length/4*3)}return {trial:d('baseline','trial'),repeat:d('baseline','restored')}})()`);
    report.cases.push({ name, differencesRGB255: diff });
  }
  report.gl = await evaluate(`(()=>{const gl=__SE.renderer.getContext(),errors=[];for(let i=0;i<16;i++){let e=gl.getError();if(!e)break;errors.push(e)}return {errors,lost:gl.isContextLost()}})()`);
}
(async()=>{try{await run()}catch(e){report.fatal=e.stack;process.exitCode=1}finally{if(ws&&ws.readyState===WebSocket.OPEN){try{await send('Browser.close',{},null)}catch(_){}ws.close()}const file=path.join(root,`${prefix}.json`);fs.writeFileSync(file,JSON.stringify(report,null,2),{flag:'wx'});console.log(file)}})();
