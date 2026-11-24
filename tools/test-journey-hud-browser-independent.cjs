'use strict';
// 定向 HUD 回归；所有构建与报告均写入一次性独立目录。
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');
const output = path.join(root, '.workbuddy', 'hud-browser-' + crypto.randomUUID());
fs.mkdirSync(output);
const report = { output, cases: [], errors: [], limitations: ['预览构建不是正式入口；journeySeek 用于定位而非自然播放；未测试触屏或屏幕阅读器。'] };
const save = () => fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
async function main() {
  let build = fs.readFileSync(path.join(root, 'build.mjs'), 'utf8');
  const swap = (a, b) => { if (build.split(a).length !== 2) throw Error('构建替换点不唯一'); build = build.replace(a, b); };
  swap("const ROOT = path.dirname(fileURLToPath(import.meta.url));", `const ROOT = ${JSON.stringify(root)}; const OUT = ${JSON.stringify(output)};`);
  swap('fs.writeFileSync(path.join(ROOT, name), htmlOffline);', 'fs.writeFileSync(path.join(OUT, name), htmlOffline);');
  swap("fs.writeFileSync(path.join(ROOT, 'space-http.html'), htmlHttp);", "fs.writeFileSync(path.join(OUT, 'space-http.html'), htmlHttp);");
  await import('data:text/javascript;base64,' + Buffer.from(build).toString('base64'));
  const online = fs.readFileSync(path.join(output, 'space-http.html'));
  const server = http.createServer((req, res) => { if (req.url.split('?')[0] !== '/space.html') { res.writeHead(404); return res.end(); } res.writeHead(200, {'Content-Type':'text/html; charset=utf-8', 'Cache-Control':'no-store'}); res.end(online); });
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  let child, ws, sid, seq = 0; const pending = new Map();
  const executable = [process.env.CHROME_PATH, process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google/Chrome/Application/chrome.exe'), process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Google/Chrome/Application/chrome.exe'), process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Microsoft/Edge/Application/msedge.exe')].filter(Boolean).find(fs.existsSync);
  if (!executable) { server.close(); throw Error('未找到浏览器'); }
  report.browser = executable;
  function send(method, params = {}, session = sid) { return new Promise((resolve, reject) => { const id = ++seq; const timer = setTimeout(() => { pending.delete(id); reject(Error('CDP 超时 ' + method)); }, 60000); pending.set(id, {resolve, reject, timer}); ws.send(JSON.stringify({id,method,params,...(session ? {sessionId:session} : {})})); }); }
  async function evaluate(expression) { const r = await send('Runtime.evaluate', {expression, awaitPromise:true, returnByValue:true}); if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; }
  const wait = expr => evaluate(`new Promise((resolve,reject)=>{const end=Date.now()+60000;function poll(){try{if(${expr})return resolve(true)}catch(e){}if(Date.now()>end)return reject(Error('等待超时'));setTimeout(poll,100)}poll()})`);
  const probe = `(()=>{const e=document.querySelector('#cosmoHud'),s=getComputedStyle(e),r=e.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2,hit=document.elementFromPoint(x,y);return {body:document.body.className,display:s.display,opacity:s.opacity,pointerEvents:s.pointerEvents,hit:hit&&(hit.id||hit.tagName),hitHud:!!hit&&(hit===e||e.contains(hit)),journey:__SE.journeyInfo}})()`;
  try {
    child = spawn(executable, ['--headless=new','--remote-debugging-address=127.0.0.1','--remote-debugging-port=0',`--user-data-dir=${path.join(output,'profile')}`,'--window-size=1280,800','--no-first-run','--disable-background-networking','about:blank'], {stdio:['ignore','ignore','pipe'],windowsHide:true});
    const endpoint = await new Promise((resolve,reject)=>{let text='';const t=setTimeout(()=>reject(Error('浏览器启动超时')),45000);child.once('error',reject);child.once('exit',code=>reject(Error('浏览器退出 '+code)));child.stderr.on('data',c=>{text+=c;const m=text.match(/DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[^\s]+)/);if(m){clearTimeout(t);resolve(m[1]);}});});
    ws = new WebSocket(endpoint); await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
    ws.addEventListener('message', e=>{const m=JSON.parse(e.data);if(m.id&&pending.has(m.id)){const p=pending.get(m.id);clearTimeout(p.timer);pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result||{});}});
    report.version = await send('Browser.getVersion',{},null);
    const target = await send('Target.createTarget',{url:'about:blank'},null);sid=(await send('Target.attachToTarget',{targetId:target.targetId,flatten:true},null)).sessionId;
    await Promise.all(['Runtime.enable','Page.enable'].map(m=>send(m)));
    await send('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1,mobile:false});
    await send('Page.addScriptToEvaluateOnNewDocument',{source:"try{localStorage.setItem('space11.tour','1')}catch(_){}"});
    for (const [kind,url] of [['file',pathToFileURL(path.join(output,'space.html')).href],['http',`http://127.0.0.1:${server.address().port}/space.html`]]) {
      const item={kind,url,steps:[]}; report.cases.push(item); save();
      const record=(name,data,ok)=>item.steps.push({name,ok,data});
      try {
        const nav=await send('Page.navigate',{url});if(nav.errorText)throw Error(nav.errorText);await wait('window.__SE && __SE.firstFrame === false');
        const atlasProbe = `(()=>{const b=document.querySelector('#atlasBtn'),s=getComputedStyle(b),r=b.getBoundingClientRect(),hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return {journey:__SE.journeyInfo.on,display:s.display,visibility:s.visibility,opacity:s.opacity,pointerEvents:s.pointerEvents,rect:{x:r.left+r.width/2,y:r.top+r.height/2},hit:hit&&(hit.closest('#atlasBtn')?'atlasBtn':hit.id||hit.tagName),active:document.activeElement.id,modal:document.querySelector('#atlasModal').classList.contains('on')}})()`;
        await evaluate(`(()=>{const b=document.createElement('button');b.id='beforeJourneyFocus';document.querySelector('#ui').appendChild(b);b.focus()})()`);
        const beforeFocus=await evaluate('document.activeElement.id');
        const started=await evaluate(`(()=>{__SE.journey();return {active:document.activeElement.id,on:__SE.journeyInfo.on}})()`);
        record('自然启动时清除已有 HUD 焦点',{before:beforeFocus,...started},beforeFocus==='beforeJourneyFocus'&&started.active!=='beforeJourneyFocus'&&started.on);
        let atlas=await evaluate(atlasProbe);
        record('自然旅程隐藏图鉴按钮',atlas,atlas.journey&&atlas.visibility==='hidden'&&Number(atlas.opacity)===0&&atlas.pointerEvents==='none'&&atlas.hit!=='atlasBtn');
        await evaluate("document.querySelector('#atlasBtn').focus()");
        atlas=await evaluate(atlasProbe);
        record('自然旅程中图鉴不能程序聚焦',atlas,atlas.journey&&atlas.active!=='atlasBtn'&&atlas.visibility==='hidden');
        for(const type of ['mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,x:atlas.rect.x,y:atlas.rect.y,button:'left',clickCount:1});
        atlas=await evaluate(atlasProbe);
        record('隐藏图鉴位置的鼠标点击不打开图鉴',atlas,!atlas.modal);
        await evaluate('__SE.journeyStop()');
        const focusedAtlas=await evaluate(`(()=>{const b=document.querySelector('#atlasBtn');b.focus();return document.activeElement.id})()`);
        const restarted=await evaluate(`(()=>{__SE.journey();return {active:document.activeElement.id,on:__SE.journeyInfo.on}})()`);
        record('启动旅程时清除图鉴已有焦点',{before:focusedAtlas,...restarted},focusedAtlas==='atlasBtn'&&restarted.active!=='atlasBtn'&&restarted.on);
        await evaluate('__SE.journeySeek(7.501)');
        atlas=await evaluate(atlasProbe);
        record('seek 接力后隐藏图鉴按钮',atlas,atlas.journey&&atlas.visibility==='hidden'&&Number(atlas.opacity)===0&&atlas.pointerEvents==='none'&&atlas.hit!=='atlasBtn');
        await evaluate("document.querySelector('#atlasBtn').focus()");
        atlas=await evaluate(atlasProbe);
        record('seek 期间图鉴不能程序聚焦',atlas,atlas.journey&&atlas.active!=='atlasBtn'&&atlas.visibility==='hidden');
        await evaluate('__SE.journeyStop()');
        atlas=await evaluate(atlasProbe);
        record('停止旅程后图鉴恢复可见',atlas,!atlas.journey&&atlas.visibility==='visible'&&Number(atlas.opacity)===1&&atlas.pointerEvents!=='none'&&atlas.hit==='atlasBtn');
        for(const type of ['mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,x:atlas.rect.x,y:atlas.rect.y,button:'left',clickCount:1});
        atlas=await evaluate(atlasProbe);
        record('停止旅程后图鉴可用鼠标打开',atlas,atlas.modal);
        await evaluate("document.querySelector('#amClose').click(); document.activeElement.blur()");
        await evaluate('__SE.cosmos(1e22)'); await wait("document.body.classList.contains('cosmic')");
        let x=await evaluate(probe);record('普通手动宇宙层',x,x.display==='block'&&x.opacity==='1'&&x.pointerEvents!=='none'&&x.hitHud);
        await evaluate('__SE.journeySeek(7.49)'); x=await evaluate(probe);record('接力前',x,x.journey.on&&!x.journey.cs&&x.opacity==='0'&&x.pointerEvents==='none');
        await evaluate('__SE.journeySeek(7.501)'); x=await evaluate(probe);record('接力后',x,x.journey.on&&x.journey.cs&&x.display==='block'&&x.opacity==='0'&&x.pointerEvents==='none'&&!x.hitHud);
        await evaluate('__SE.journeyStop()'); x=await evaluate(probe);record('停止后恢复',x,!x.journey.on&&x.journey.cs&&x.display==='block'&&x.opacity==='1'&&x.pointerEvents!=='none'&&x.hitHud);
        await evaluate(`(()=>{window.__hudFocus=[];document.addEventListener('focusin',e=>{const el=e.target,hidden=el.closest('#ui,#labels,#cosmoLabels,#crumbs,#hud,#cosmoHud,#hint');window.__hudFocus.push({tag:el.tagName,id:el.id,hiddenUI:!!hidden,hiddenOpacity:hidden&&getComputedStyle(hidden).opacity,visibility:hidden&&getComputedStyle(el).visibility,journey:__SE.journeyInfo.on})},true)})()`);
        await evaluate(`(()=>{const b=document.createElement('button');b.id='hudFocusTest';b.textContent='test';document.querySelector('#ui').appendChild(b);b.focus()})()`);
        await evaluate('__SE.journeySeek(7.501)');
        const during=await evaluate(`(()=>{const b=document.querySelector('#hudFocusTest'),d=document.createElement('button');d.id='hudDynamicTest';b.parentNode.appendChild(d);b.focus();const first=document.activeElement.id;d.focus();return {first,dynamic:document.activeElement.id,visibility:getComputedStyle(d).visibility,journey:__SE.journeyInfo.on,events:window.__hudFocus}})()`);
        record('旅程期间已有和动态控件不可编程聚焦',during,during.journey&&during.first!=='hudFocusTest'&&during.dynamic!=='hudDynamicTest'&&during.visibility==='hidden'&&!during.events.some(f=>f.hiddenUI&&f.journey));
        for (const shift of [false,true]) {
          await evaluate(`(()=>{__SE.journeySeek(7.501);document.activeElement.blur();window.__hudFocus=[]})()`);
          for(const type of ['keyDown','keyUp'])await send('Input.dispatchKeyEvent',{type,key:'Tab',code:'Tab',windowsVirtualKeyCode:9,nativeVirtualKeyCode:9,modifiers:shift?8:0});
          const focus=await evaluate('({events:window.__hudFocus,journeyAfter:__SE.journeyInfo.on})');
          record(shift?'Shift+Tab 停止并恢复可见焦点':'Tab 停止并恢复可见焦点',focus,!focus.journeyAfter&&focus.events.length>0&&!focus.events.some(f=>f.hiddenUI&&(f.journey||Number(f.hiddenOpacity)<1||f.visibility!=='visible')));
        }
        const restored=await evaluate(`(()=>{const d=document.querySelector('#hudDynamicTest');d.focus();return {active:document.activeElement.id,visibility:getComputedStyle(d).visibility,opacity:getComputedStyle(d.parentNode).opacity}})()`);
        record('停止后动态控件恢复聚焦',restored,restored.active==='hudDynamicTest'&&restored.visibility==='visible'&&Number(restored.opacity)===1);
      } catch(e) {item.error=e.stack;} save();
    }
  } finally { if(ws && ws.readyState===WebSocket.OPEN){try{await send('Browser.close',{},null);}catch(_){}ws.close();}server.close(); }
}
main().catch(e=>{report.errors.push(e.stack);}).finally(()=>{save();console.log(path.join(output,'report.json'));if(report.errors.length||report.cases.length!==2||report.cases.some(c=>c.error||c.steps.length!==17||c.steps.some(s=>!s.ok)))process.exitCode=1;});
