'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const originalPath = path.join(__dirname, 'test-deep-models.cjs');
let source = fs.readFileSync(originalPath, 'utf8');
const begin = source.indexOf('async function main() {');
const end = source.indexOf('\nfunction cleanup()', begin);
if (begin < 0 || end < 0) throw Error('历史测试结构不匹配');

function recordTrajectory() {
  return new Promise((resolve, reject) => {
    const renderer = __SE.renderer, originalRender = renderer.render;
    const stream = renderer.domElement.captureStream(30), parts = [], views = [], finalRenders = [];
    const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find(x => MediaRecorder.isTypeSupported(x));
    if (!mime) { stream.getTracks().forEach(t => t.stop()); reject(Error('无可用 WebM 编码器')); return; }
    let finalSetAt = null, finalSetFrame = null, stopped = false, timer;
    const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 4500000 });
    function restore() { clearTimeout(timer); renderer.render = originalRender; stream.getTracks().forEach(t => t.stop()); }
    function fail(e) { if (stopped) return; stopped = true; try { if (recorder.state !== 'inactive') recorder.stop(); } catch (_) {} restore(); reject(e); }
    renderer.render = function (...args) {
      const value = originalRender.apply(this, args);
      if (finalSetAt !== null) finalRenders.push({ at: performance.now(), frame: renderer.info.render.frame, scene: args[0]?.name || null, camera: __SE.deep.info().camera });
      return value;
    };
    recorder.ondataavailable = e => { if (e.data.size) parts.push(e.data); };
    recorder.onerror = e => fail(Error('录像失败 ' + (e.error?.message || e)));
    recorder.onstop = async () => {
      if (stopped) return;
      stopped = true;
      try {
        const blob = new Blob(parts, { type: mime });
        window.__deepProbe.video = await new Promise((r, j) => { const f = new FileReader(); f.onload = () => r(f.result); f.onerror = () => j(f.error); f.readAsDataURL(blob); });
        const result = { mime, bytes: blob.size, length: window.__deepProbe.video.length, views, start, finalSetAt, finalSetFrame, finalRenders, stoppedAt: performance.now() };
        restore(); resolve(result);
      } catch (e) { restore(); reject(e); }
    };
    const start = performance.now();
    timer = setTimeout(() => fail(Error('录像或末态绘制等待超时')), 60000);
    recorder.start(500);
    function frame(t) {
      try {
        const u = Math.min(1, Math.max(0, (t - start) / 8000));
        const yaw = 2 * Math.PI * u, pitch = .20 * Math.sin(2 * Math.PI * u);
        const distance = u < .5 ? 3.6 * Math.pow(.35 / 3.6, 2 * u) : .35 * Math.pow(3.6 / .35, 2 * u - 1);
        __SE.deep.setView({ yaw, pitch, distance, target: [0, 0, 0] });
        views.push({ rafTimestamp: t, setAt: performance.now(), u, yaw, pitch, distance });
        if (u < 1) requestAnimationFrame(frame);
        else {
          finalSetAt = performance.now(); finalSetFrame = renderer.info.render.frame;
          function hold() {
            try {
              if (finalRenders.length >= 2 && performance.now() - finalSetAt >= 1500) {
                renderer.getContext().finish();
                recorder.stop();
              } else requestAnimationFrame(hold);
            } catch (e) { fail(e); }
          }
          requestAnimationFrame(hold);
        }
      } catch (e) { fail(e); }
    }
    requestAnimationFrame(frame);
  });
}

async function edgeSamples(file) {
  const { spawn } = require('node:child_process');
  const candidates = [process.env.EDGE_PATH, process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Microsoft/Edge/Application/msedge.exe'), process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Microsoft/Edge/Application/msedge.exe'), process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Microsoft/Edge/Application/msedge.exe')].filter(Boolean);
  const edge = candidates.find(p => fs.existsSync(p));
  if (!edge) throw Error('未找到 Edge，可通过 EDGE_PATH 指定');
  const profile = fs.mkdtempSync(path.join(ROOT, '.workbuddy', 'probe-edge-decoder-'));
  const child = spawn(edge, ['--headless=new', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--disable-background-networking', 'about:blank'], {stdio:['ignore','ignore','pipe'], windowsHide:true});
  let ws, sequence = 0;
  const pending = new Map();
  try {
    const endpoint = await new Promise((resolve, reject) => {
      let text = '';
      const timer = setTimeout(() => reject(Error('Edge 启动超时')), 30000);
      child.once('error', e => { clearTimeout(timer); reject(e); });
      child.once('exit', () => { clearTimeout(timer); reject(Error('Edge 提前退出')); });
      child.stderr.on('data', chunk => { text += chunk; const match = text.match(/DevTools listening on (ws:\/\/\S+)/); if (match) { clearTimeout(timer); resolve(match[1]); } });
    });
    ws = new WebSocket(endpoint);
    await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, {once:true}); ws.addEventListener('error', () => reject(Error('Edge CDP 连接失败')), {once:true}); });
    ws.addEventListener('message', event => { const message = JSON.parse(event.data); const p = pending.get(message.id); if (p) { pending.delete(message.id); clearTimeout(p.timer); message.error ? p.reject(Error(JSON.stringify(message.error))) : p.resolve(message.result || {}); } });
    const sendEdge = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
      const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(Error(`Edge CDP 超时：${method}`)); }, 45000);
      pending.set(id, {resolve,reject,timer}); ws.send(JSON.stringify({id,method,params,...(sessionId ? {sessionId} : {})}));
    });
    const target = await sendEdge('Target.createTarget', {url:'about:blank'});
    const sessionId = (await sendEdge('Target.attachToTarget', {targetId:target.targetId, flatten:true})).sessionId;
    const evaluateEdge = async expression => {
      const result = await sendEdge('Runtime.evaluate', {expression, awaitPromise:true, returnByValue:true}, sessionId);
      if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      return result.result.value;
    };
    await evaluateEdge('window.videoParts=[]');
    const base64 = fs.readFileSync(file).toString('base64');
    for (let i = 0; i < base64.length; i += 256 * 1024) await evaluateEdge(`window.videoParts.push(${JSON.stringify(base64.slice(i, i + 256 * 1024))})`);
    const result = await evaluateEdge(`(async () => {
      const binary = atob(videoParts.join('')), bytes = new Uint8Array(binary.length);
      for (let i=0; i<binary.length; i++) bytes[i]=binary.charCodeAt(i);
      const url=URL.createObjectURL(new Blob([bytes],{type:'video/webm'})), video=document.createElement('video');
      video.muted=true; video.src=url; document.body.appendChild(video);
      const wait = (name) => new Promise((resolve,reject) => { const timer=setTimeout(()=>reject(Error(name+' 超时')),12000); video.addEventListener(name,()=>{clearTimeout(timer);resolve();},{once:true}); video.addEventListener('error',()=>{clearTimeout(timer);reject(Error('视频解码错误'));},{once:true}); });
      try {
        if (video.readyState < 1) await wait('loadedmetadata');
        if (!Number.isFinite(video.duration) || video.duration <= 0) { video.currentTime=1e100; await wait('seeked'); }
        const duration=video.duration;
        if (!Number.isFinite(duration) || duration <= 0) throw Error('无法确定视频时长');
        const samples=[];
        for (const [label,time] of [['first',0],['middle',duration/2],['last',Math.max(0,duration-0.001)]]) {
          const frame=new Promise(resolve=>{ if (!video.requestVideoFrameCallback) return resolve(null); let done=false; const timer=setTimeout(()=>{if(!done){done=true;resolve(null);}},1500); video.requestVideoFrameCallback((_,m)=>{if(!done){done=true;clearTimeout(timer);resolve({mediaTime:m.mediaTime,presentedFrames:m.presentedFrames});}}); });
          video.currentTime=time;
          if (video.seeking || video.readyState < 2) await wait('seeked');
          const metadata=await frame;
          if (video.readyState < 2 || !video.videoWidth) throw Error(label+' 未取得可绘制帧');
          const canvas=document.createElement('canvas'); canvas.width=video.videoWidth; canvas.height=video.videoHeight; canvas.getContext('2d').drawImage(video,0,0);
          samples.push({label,requestedTime:time,currentTime:video.currentTime,metadata,data:canvas.toDataURL('image/png')});
        }
        return {duration,samples};
      } finally { URL.revokeObjectURL(url); }
    })()`);
    for (const sample of result.samples) {
      const out = path.join(ROOT, `m51-v196-independent-${RUN_ID}-${sample.label}.png`);
      fs.writeFileSync(out, Buffer.from(sample.data.split(',')[1], 'base64'), {flag:'wx'});
      delete sample.data; sample.file = out;
    }
    return {tool:'Edge HTMLVideoElement seek', executable:edge, profile, status:'sampled', duration:result.duration, samples:result.samples, fullDecodeVerified:false, frameCountVerified:false, perFramePtsVerified:false, note:'仅 seek 抽样；首末不保证为首末编码帧，mediaTime 不等于完整逐帧 PTS。'};
  } finally {
    if (ws && ws.readyState === WebSocket.OPEN) { try { ws.send(JSON.stringify({id:++sequence,method:'Browser.close'})); } catch (_) {} ws.close(); }
    else if (child.exitCode === null && child.signalCode === null) child.kill();
  }
}

async function diagnosticMain() {
  report.experiment = 'v196 space.html M51 真实 GPU 连续录像与独立解码';
  report.notes.push('加载用户指定的独立 space.html 文件，而不是服务映射的 space-http.html 在线构建。');
  report.notes.push('设定视角次数不是已绘制或已编码帧数；末态后等待至少两次 renderer.render、保持 1500ms，并等待 WebGL finish。');
  report.notes.push('render 调用和 finish 不保证末态已被 captureStream 编码；视频帧 PTS 与 setView 的 performance.now 无严格同步映射。首中末帧为独立解码结果，画面与轨迹只能定性关联。');
  const { spawnSync } = require('node:child_process');
  const ffprobe = process.env.FFPROBE_PATH || 'ffprobe';
  const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
  const tools = Object.fromEntries([ffprobe, ffmpeg].map(binary => {
    const check = spawnSync(binary, ['-version'], { encoding: 'utf8', windowsHide: true });
    return [binary, !check.error && check.status === 0];
  }));
  report.decoderAvailability = { ffprobe: tools[ffprobe], ffmpeg: tools[ffmpeg] };
  assert(process.env.ORBIT_GPU !== '0', '拒绝软件渲染参数');
  await launch();
  phase = '加载';
  report.ready = await load(FILE_URL, 'file');
  report.entrySha256 = createHash('sha256').update(fs.readFileSync(path.join(ROOT, 'space.html'))).digest('hex');
  report.setup = await evaluate(`(() => {const gl=__SE.renderer.getContext(), ext=gl.getExtension('WEBGL_debug_renderer_info');return {build:__SE.build,url:location.href,renderer:gl.getParameter(gl.RENDERER),unmaskedRenderer:ext&&gl.getParameter(ext.UNMASKED_RENDERER_WEBGL),canvas:{width:gl.canvas.width,height:gl.canvas.height}}})()`);
  assert(report.setup.build === 'v196', '入口版本不是 v196', report.setup);
  assert(report.setup.unmaskedRenderer && !/swiftshader|llvmpipe|software|basic render/i.test(report.setup.unmaskedRenderer), '未确认硬件 GPU 渲染器', report.setup);
  report.model = await openModel('m51');
  phase = '连续录像';
  const recording = await evaluate(`(${recordTrajectory.toString()})()`);
  const chunks = [];
  for (let i = 0; i < recording.length; i += CHUNK) chunks.push(await evaluate(`window.__deepProbe.video.slice(${i},${i + CHUNK})`));
  const data = chunks.join('');
  const bytes = Buffer.from(data.slice(data.indexOf(',') + 1), 'base64');
  const file = bytes.length ? path.join(ROOT, `m51-v196-independent-${RUN_ID}.webm`) : null;
  if (file) fs.writeFileSync(file, bytes, {flag:'wx'});
  report.recording = {...recording, file, receivedBytes:bytes.length, sha256:file && createHash('sha256').update(bytes).digest('hex')};
  const v = recording.views;
  report.thresholds = {bytesGreaterThan10000:bytes.length > 10000, receivedEqualsBlob:bytes.length === recording.bytes, viewsGreaterThan30:v.length > 30, firstULessThan01:v.length > 0 && v[0].u < .1, lastUEquals1:v.length > 0 && v.at(-1).u === 1, finalRenderBarrier:recording.finalRenders.length >= 2 && recording.stoppedAt - recording.finalSetAt >= 1500};
  const thresholdsPassed = Object.values(report.thresholds).every(Boolean);
  phase = '独立解码';
  if (!file) {
    report.decode = { status: 'unavailable', reason: '录像为空，无法解码', fullDecodeVerified: false, frameCountVerified: false, perFramePtsVerified: false };
  } else if (tools[ffprobe] && tools[ffmpeg]) {
  const probe = spawnSync(ffprobe, ['-v','error','-select_streams','v:0','-show_streams','-show_frames','-of','json',file], {encoding:'utf8', maxBuffer:64*1024*1024, windowsHide:true});
  assert(!probe.error && probe.status === 0, 'ffprobe 解码失败', {error:String(probe.error), stderr:probe.stderr});
  const parsed = JSON.parse(probe.stdout), frames = parsed.frames || [];
  report.decode = { tool: ffprobe, stream: parsed.streams?.[0], frameCount: frames.length, frames: frames.map((f,i) => ({index:i,pts:f.pts,ptsTime:f.pts_time,bestEffortTimestamp:f.best_effort_timestamp,bestEffortTimestampTime:f.best_effort_timestamp_time,pktDurationTime:f.pkt_duration_time,keyFrame:f.key_frame,pictType:f.pict_type})) };
  assert(frames.length > 0 && frames.every(f => f.best_effort_timestamp_time !== undefined), '未获得全部解码帧及时间戳', report.decode);
  for (const [label, index] of [['first',0],['middle',Math.floor((frames.length-1)/2)],['last',frames.length-1]]) {
    const out = path.join(ROOT, `m51-v196-independent-${RUN_ID}-${label}.png`);
    const image = spawnSync(ffmpeg, ['-v','error','-i',file,'-vf',`select=eq(n\\,${index})`,'-fps_mode','passthrough','-frames:v','1','-n',out], {encoding:'utf8', windowsHide:true});
    assert(!image.error && image.status === 0 && fs.existsSync(out) && fs.statSync(out).size > 0, `提取${label}编码帧失败`, {stderr:image.stderr,error:String(image.error),index});
    (report.decode.images ||= []).push({label,index,file:out,ptsTime:frames[index].best_effort_timestamp_time});
  }
  report.decode.fullDecodeVerified = true;
  report.decode.frameCountVerified = true;
  report.decode.perFramePtsVerified = true;
  } else {
    try {
      report.decode = await edgeSamples(file);
    } catch (error) {
      report.decode = { tool: 'Edge', status: 'failed', error: errorText(error), fullDecodeVerified: false, frameCountVerified: false, perFramePtsVerified: false };
    }
  }
  assert(thresholdsPassed, '历史录像门槛或末态绘制屏障不满足', report.thresholds);
  assert(report.decode.status !== 'failed' && report.decode.status !== 'unavailable', '独立解码失败', report.decode);
  report.tests.push({name:'M51 连续录像与独立解码', status:'pass', details:{fullDecodeVerified:report.decode.fullDecodeVerified}});
}
source = source.slice(0, begin) + `const recordTrajectory = ${recordTrajectory.toString()};\nconst edgeSamples = ${edgeSamples.toString()};\nasync function main() { return (${diagnosticMain.toString()})(); }` + source.slice(end);
source = source.replace('deep-models-test-184-${RUN_ID}.json', 'm51-v196-recording-independent-${RUN_ID}.json');
source = source.replace('  report.complete = report.ok && !FAST;', '  report.complete = false;');
vm.runInThisContext(`(function(require,__dirname,__filename){${source}\n})`, {filename: originalPath})(require, __dirname, originalPath);
