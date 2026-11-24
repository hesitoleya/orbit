'use strict';
// 独立离线探针；仅按需运行，保留 profile 和全部输出。
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createHash, randomBytes } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const url = 'file:///D:/WB/orbit/space.html?auto=0&q=high&grade=1&t=0';
const original = 'float disk=exp(-r*2.2)*exp(-abs(q.z)/height)*edgeR;';
const trial = 'float disk=exp(-r*2.2)*exp(-abs(q.z)/(height*0.8))*edgeR/0.8;';
const prefix = `m51-height-offline-${Date.now()}-${randomBytes(4).toString('hex')}`;
const report = { experiment: 'M51 体积盘面高度 A1→B→A2', url, original, trial, cases: [], requests: [], errors: [], limitations: [
  '仅针对主页面 session 阻断外部请求；不启动项目 HTTP 服务。Worker/其他 target 未做系统级网络隔离，不声称完全离线。',
  '只在浏览器内修改材质，不修改产品；显示编码 PNG 的 RGB 差异不是线性 HDR，中心 ROI 为图像宽高各一半。',
  'gradePhase 仅固定截图颗粒；时间尺度置零，其他帧时钟、GPU 和未暴露状态不能保证冻结。',
  'reference 为高采样诊断档，不代表收敛真值；强制 SwiftShader 不能代表真实 GPU。',
  '探针 getError 会消耗 GL 错误；应用先行读取的错误无法追溯。'
] };
let ws, child, sid, seq = 0;
const pending = new Map();
function send(method, params = {}, sessionId = sid) {
  if (method === 'Page.navigate' && params.url !== url) throw Error('拒绝非指定导航: ' + params.url);
  return new Promise((resolve, reject) => {
    const id = ++seq;
    const timer = setTimeout(() => { pending.delete(id); reject(Error('CDP 超时: ' + method)); }, 300000);
    pending.set(id, { resolve, reject, timer });
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
}
async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}
async function frames(n = 4) {
  await evaluate(`new Promise(r=>{let n=${n};function f(){if(--n)requestAnimationFrame(f);else r()}requestAnimationFrame(f)})`);
}
const hook = `(() => {
  const mark=${JSON.stringify(original)}, trial=${JSON.stringify(trial)};
  window.__heightProbe={compiles:[],uses:[],used:{},errors:[]};
  for(const C of [window.WebGLRenderingContext,window.WebGL2RenderingContext]) {
    if(!C || !Object.prototype.hasOwnProperty.call(C.prototype,'shaderSource')) continue;
    const p=C.prototype, source=p.shaderSource, compile=p.compileShader;
    p.shaderSource=function(shader,s){if(s.includes(mark)||s.includes(trial))shader.__heightProbeSource=s;return source.call(this,shader,s)};
    p.compileShader=function(shader){compile.call(this,shader);if(shader.__heightProbeSource){const s=shader.__heightProbeSource;window.__heightProbe.compiles.push({variant:s.includes(trial)?'B':'A',originalCount:s.split(mark).length-1,trialCount:s.split(trial).length-1,ok:this.getShaderParameter(shader,this.COMPILE_STATUS),log:this.getShaderInfoLog(shader)});}};
    const attach=p.attachShader,link=p.linkProgram,use=p.useProgram;
    p.attachShader=function(program,shader){if(shader.__heightProbeSource)program.__heightVariant=shader.__heightProbeSource.includes(trial)?'B':'A';return attach.call(this,program,shader)};
    p.linkProgram=function(program){link.call(this,program);if(program.__heightVariant)window.__heightProbe.uses.push({event:'link',variant:program.__heightVariant,ok:this.getProgramParameter(program,this.LINK_STATUS),log:this.getProgramInfoLog(program)})};
    p.useProgram=function(program){if(program&&program.__heightVariant)window.__heightProbe.used[program.__heightVariant]=(window.__heightProbe.used[program.__heightVariant]||0)+1;return use.call(this,program)};
  }
  try{localStorage.setItem('space11.tour','1')}catch(e){window.__heightProbe.errors.push(String(e))}
})();`;
async function run() {
  if (path.resolve(root).toLowerCase().replace(/\\/g, '/') !== 'd:/wb/orbit') throw Error('项目路径不符');
  const html = fs.readFileSync(path.join(root, 'space.html'));
  const count = html.toString('utf8').split(original).length - 1;
  if (count !== 1) throw Error('构建中原始表达式不是唯一命中: ' + count);
  report.build = { file: path.join(root, 'space.html'), sha256: createHash('sha256').update(html).digest('hex'), sourceMatches: count,
    sourceSha256: Object.fromEntries(['public/js/app.js','public/js/deep-models.js','tools/probe-m51-height-offline-20261116.cjs'].map(name => [name, createHash('sha256').update(fs.readFileSync(path.join(root,name))).digest('hex')])) };
  const base = path.join(root, '.workbuddy');
  if (!fs.statSync(base).isDirectory()) throw Error('profile 父目录不存在');
  const profile = fs.mkdtempSync(path.join(base, 'm51-height-offline-'));
  const chrome = [process.env.CHROME_PATH, process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google/Chrome/Application/chrome.exe'), process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Google/Chrome/Application/chrome.exe'), process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe')].filter(Boolean).find(fs.existsSync);
  if (!chrome) throw Error('未找到 Chrome');
  const args = ['--headless=new', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--window-size=480,320', '--force-device-scale-factor=1', '--no-first-run', '--disable-background-networking', 'about:blank'];
  report.launch = { chrome, profile, args };
  child = spawn(chrome, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
  const endpoint = await new Promise((resolve, reject) => {
    let text = ''; const timer = setTimeout(() => reject(Error('Chrome 启动超时')), 45000);
    child.once('error', reject); child.once('exit', code => reject(Error('Chrome 退出: ' + code)));
    child.stderr.on('data', chunk => { text += chunk; const m = text.match(/DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[^\s]+)/); if (m) { clearTimeout(timer); resolve(m[1]); } });
  });
  ws = new WebSocket(endpoint);
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }); });
  ws.addEventListener('message', event => {
    const m = JSON.parse(event.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); clearTimeout(p.timer); pending.delete(m.id); m.error ? p.reject(Error(JSON.stringify(m.error))) : p.resolve(m.result || {}); return; }
    if (m.method === 'Fetch.requestPaused') {
      const req = m.params.request, u = req.url;
      const allow = /^(file|data|blob):/i.test(u) && (m.params.resourceType !== 'Document' || u === url);
      const shown = /^data:/i.test(u) ? u.slice(0, 100) + '… (' + u.length + ' characters)' : u;
      report.requests.push({ url: shown, type: m.params.resourceType, allowed: allow });
      send(allow ? 'Fetch.continueRequest' : 'Fetch.failRequest', allow ? { requestId: m.params.requestId } : { requestId: m.params.requestId, errorReason: 'BlockedByClient' }, m.sessionId).catch(e => report.errors.push(String(e)));
    } else if (m.method === 'Runtime.exceptionThrown' || (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') || m.method === 'Log.entryAdded') report.errors.push({ method: m.method, params: m.params });
  });
  report.browser = await send('Browser.getVersion', {}, null);
  const target = await send('Target.createTarget', { url: 'about:blank' }, null);
  sid = (await send('Target.attachToTarget', { targetId: target.targetId, flatten: true }, null)).sessionId;
  await Promise.all(['Runtime.enable', 'Page.enable', 'Network.enable', 'Log.enable'].map(x => send(x)));
  await send('Network.setBypassServiceWorker', { bypass: true });
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
  await send('Emulation.setDeviceMetricsOverride', { width: 480, height: 320, deviceScaleFactor: 1, mobile: false });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: hook });
  const loaded = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { ws.removeEventListener('message', listener); reject(Error('页面加载超时')); }, 120000);
    function listener(event) { const m=JSON.parse(event.data); if(m.sessionId===sid && m.method==='Page.loadEventFired'){clearTimeout(timer);ws.removeEventListener('message',listener);resolve()} }
    ws.addEventListener('message',listener);
  });
  const nav = await send('Page.navigate', { url });
  if (nav.errorText) throw Error(nav.errorText);
  await loaded;
  await evaluate(`new Promise((resolve,reject)=>{let n=0;function check(){if(location.href!==${JSON.stringify(url)})return reject(Error('导航不符: '+location.href));if(window.__SE&&__SE.firstFrame===false&&__SE.deep)return resolve();if(++n>1200)return reject(Error('页面未就绪'));setTimeout(check,100)}check()})`);
  const navigation = await evaluate('location.href');
  if (navigation !== url || report.requests.filter(x => x.type === 'Document' && x.allowed).some(x => x.url !== url)) throw Error('导航断言失败');
  report.navigation = navigation;
  await evaluate(`(()=>{__SE.ts=0;if(__SE.tour)__SE.tour(false);if(__SE.help)__SE.help(false);__SE.deep.open('m51');__SE.deep.setDust(true);__SE.grade(true);window.__heightPixels={};return true})()`);
  await frames(6);
  report.gpu = await evaluate(`(()=>{const g=__SE.renderer.getContext(),e=g.getExtension('WEBGL_debug_renderer_info');return {vendor:g.getParameter(g.VENDOR),renderer:g.getParameter(g.RENDERER),unmasked:e&&g.getParameter(e.UNMASKED_RENDERER_WEBGL),version:g.getParameter(g.VERSION)}})()`);
  if (!/swiftshader/i.test(report.gpu.unmasked || '')) throw Error('未确认 SwiftShader 软件渲染');
  report.setup = await evaluate(`(()=>({build:__SE.build,info:__SE.deep.info(),bloom:window.__SE_BLOOM__&&window.__SE_BLOOM__.info,exposure:__SE.renderer.toneMappingExposure,pixelRatio:__SE.renderer.getPixelRatio()}))()`);
  if (report.setup.build !== 'v192' || report.setup.info.seed !== 510519 || report.setup.bloom.q !== 'high') throw Error('构建、种子或画质不符');
  const views = [
    {name:'near-default',yaw:0,pitch:0,distance:0.35,target:[0,0,0]},
    {name:'near-off-core',yaw:0,pitch:0,distance:0.35,target:[0.35,0,0]},
    {name:'front',yaw:0,pitch:0,distance:3.6,target:[0,0,0]},
    {name:'side',yaw:Math.PI/2,pitch:0,distance:3.6,target:[0,0,0]},
    {name:'back',yaw:Math.PI,pitch:0,distance:3.6,target:[0,0,0]}
  ];
  for (const quality of ['interactive', 'reference']) for (const view of views) {
    const entry = { quality, view, captures: {}, differences: {} }; report.cases.push(entry);
    await evaluate(`(()=>{__SE.deep.setQuality(${JSON.stringify(quality)});__SE.deep.setView(${JSON.stringify(view)});return true})()`);
    await frames();
    for (const mode of ['A1','B','A2']) {
      const state = await evaluate(`(()=>{
        const mark=${JSON.stringify(original)}, replacement=${JSON.stringify(trial)}, mode=${JSON.stringify(mode)};
        const slots=[];__SE.deep.controller.scene.traverse(o=>{const ms=Array.isArray(o.material)?o.material:[o.material];for(const m of ms)if(m)for(const key of ['fragmentShader','vertexShader'])if(typeof m[key]==='string'&&(m[key].includes(mark)||m[key].includes(replacement)))slots.push({m,key})});
        if(slots.length!==2||!slots.some(x=>x.key==='fragmentShader')||!slots.some(x=>x.key==='vertexShader'))throw Error('M51 材质槽位不符: '+slots.map(x=>x.key).join(','));
        const details=[];for(const {m,key} of slots){const before=m[key],a=before.split(mark).length-1,b=before.split(replacement).length-1;if(a+b!==1)throw Error('着色器内表达式命中数量不为一');if(mode==='A1'&&(a!==1||b!==0))throw Error('A1 并非基线');if(mode==='B'&&a!==1)throw Error('B 前不是基线');if(mode==='A2'&&b!==1)throw Error('A2 前不是候选');const after=mode==='B'?before.replace(mark,replacement):mode==='A2'?before.replace(replacement,mark):before;if(after!==before){m[key]=after;m.needsUpdate=true}details.push({uuid:m.uuid,key,beforeOriginal:a,beforeTrial:b,afterOriginal:after.split(mark).length-1,afterTrial:after.split(replacement).length-1})}
        return {materials:details, info:__SE.deep.info(),timeScale:__SE.ts,grade:__SE.gradeOn,location:location.href,canvas:{width:__SE.renderer.domElement.width,height:__SE.renderer.domElement.height},usedBefore:{...__heightProbe.used}};
      })()`);
      await frames();
      const key = `${quality}-${view.name}-${mode}`;
      const cap = await evaluate(`(async()=>{const data=__SE.snap('image/png',{gradePhase:0});const img=new Image();img.src=data;await img.decode();const c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;const ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(img,0,0);__heightPixels[${JSON.stringify(key)}]={pixels:ctx.getImageData(0,0,c.width,c.height).data,w:c.width,h:c.height};const g=__SE.renderer.getContext(),errors=[];for(let i=0;i<32;i++){const e=g.getError();if(!e)break;errors.push(e)}return {data,width:c.width,height:c.height,info:__SE.deep.info(),glErrors:errors,contextLost:g.isContextLost(),compiles:__heightProbe.compiles.slice(),links:__heightProbe.uses.slice(),used:{...__heightProbe.used},hookErrors:__heightProbe.errors}})()`);
      const bytes = Buffer.from(cap.data.split(',')[1], 'base64'); delete cap.data;
      const file = path.join(root, `${prefix}-${key}.png`); fs.writeFileSync(file, bytes, {flag:'wx'});
      entry.captures[mode] = {file,sha256:createHash('sha256').update(bytes).digest('hex'),state,...cap};
      if (cap.contextLost || cap.glErrors.length || cap.hookErrors.length || cap.compiles.some(c => !c.ok) || cap.links.some(c => !c.ok)) throw Error('WebGL 上下文/错误或 shader 编译、链接异常');
      const variant = mode === 'B' ? 'B' : 'A';
      const matchingCompile = c => c.variant===variant && c.ok && (variant==='B' ? c.trialCount===1 && c.originalCount===0 : c.originalCount===1 && c.trialCount===0);
      if (!cap.compiles.some(matchingCompile) || !cap.links.some(c => c.variant===variant && c.ok) || !(cap.used[variant] > (state.usedBefore[variant] || 0))) throw Error('未观察到 '+mode+' 的目标 shader 成功编译、链接并被使用');
      if (cap.info.rendering.quality !== quality || cap.info.camera.drawingBuffer[0] !== 480 || cap.info.camera.drawingBuffer[1] !== 320 || state.grade !== true || state.timeScale !== 0) throw Error('质量、尺寸或控制状态发生漂移');
    }
    for (const [a,b] of [['A1','A2'],['A1','B'],['B','A2']]) {
      entry.differences[`${a}-${b}`] = await evaluate(`(()=>{const a=__heightPixels[${JSON.stringify(`${quality}-${view.name}-`)}+${JSON.stringify(a)}],b=__heightPixels[${JSON.stringify(`${quality}-${view.name}-`)}+${JSON.stringify(b)}];if(!a||!b||a.w!==b.w||a.h!==b.h)throw Error('尺寸不一致');const w=a.w,h=a.h,bounds=[Math.floor(w/4),Math.floor(h/4),Math.floor(3*w/4),Math.floor(3*h/4)];function stat(x0,y0,x1,y1){let sum=0,sum2=0,max=0,changed=0;for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){let p=0,i=4*(y*w+x);for(let k=0;k<3;k++){const d=Math.abs(a.pixels[i+k]-b.pixels[i+k]);sum+=d;sum2+=d*d;max=Math.max(max,d);p=Math.max(p,d)}if(p)changed++}const n=(x1-x0)*(y1-y0);return {pixels:n,meanRGB255:sum/(3*n),rmsRGB255:Math.sqrt(sum2/(3*n)),maxRGB255:max,changedPixelRatio:changed/n}}return {full:stat(0,0,w,h),center:{bounds,...stat(...bounds)}}})()`);
    }
    await evaluate(`(()=>{for(const k of ${JSON.stringify(['A1','B','A2'])})delete __heightPixels[${JSON.stringify(`${quality}-${view.name}-`)}+k]})()`);
  }
  report.entryAfterSha256 = createHash('sha256').update(fs.readFileSync(path.join(root,'space.html'))).digest('hex');
  if (report.entryAfterSha256 !== report.build.sha256) throw Error('实验期间入口内容变化');
  if (report.requests.some(x => !x.allowed)) throw Error('检测到被阻断的外部请求');
  if (report.errors.length) throw Error('浏览器记录存在错误');
}
(async()=>{
  try { await run(); } catch (e) { report.fatal = e.stack || String(e); process.exitCode = 1; }
  finally {
    if (ws && ws.readyState === WebSocket.OPEN) { try { await send('Browser.close', {}, null); } catch (e) { report.errors.push(String(e)); } ws.close(); }
    const file = path.join(root, `${prefix}.json`);
    fs.writeFileSync(file, JSON.stringify(report, null, 2), {flag:'wx'});
    console.log(file);
  }
})();
