// 只由 --m16-blend 拼入本地响应。主循环的两个钩子分别在相机更新前、最终合成后。
(() => {
  'use strict';
  const camera = new URLSearchParams(location.search).get('camera');
  const run = crypto.randomUUID(), arm = location.pathname.slice(1), N = 64;
  const clock = () => performance.now();
  const frames = [], boot = {}, film = new Map();
  const report = {run, arm, camera, boot, frames, peaks:{}, missing:[], first32:null, first256:null,
    speedRadSec:camera === 'moving' ? 0.025 : 0, noise:'保留产品采样、动态颗粒、时变效果及后处理；未去噪或运动补偿',
    roi:'最终 canvas 中心正方形（边长为短边的 1/2），缩略至 64×64 sRGB',
    clock:'performance.now()，导航起点，毫秒；非 GPU timer 或显示器呈现时间'};
  let se, r, gl, mesh, body, idx, canvas, ctx, base, axis, alt, timer, observer, undo = () => {};
  let row, previous, done = false, epoch, postCount = 0;
  const thumb = document.createElement('canvas'); thumb.width = thumb.height = N;

  function link(panel, label, href, filename) {
    const a = document.createElement('a'); a.textContent = label; a.href = href;
    a.style.cssText = 'color:#bdf;margin-left:8px'; if (filename) a.download = filename;
    panel.append(a);
  }
  function filmstrip(panel) {
    if (!film.size) return;
    const strip = document.createElement('canvas'); strip.width = film.size * 120; strip.height = 104;
    const c = strip.getContext('2d'); c.fillStyle = '#151515'; c.fillRect(0,0,strip.width,strip.height);
    c.fillStyle = 'white'; c.font = '11px monospace';
    let x = 0;
    for (const [label, shot] of [...film].sort((a,b)=>a[1].row.id-b[1].row.id)) {
      c.putImageData(shot.image, x, 0); c.fillText(label,x,76);
      c.fillText(`#${shot.row.id} ${shot.row.lod}^3`,x,89);
      c.fillText(`${Math.round(shot.row.renderMs-report.selectionMs)} ms`,x,102); x += 120;
    }
    link(panel,'真实帧 PNG',strip.toDataURL('image/png'),`${arm}-${camera}-${run}.png`);
  }
  function finish(status) {
    if (done) return; done = true; clearTimeout(timer); observer?.disconnect(); undo(); delete window.__m16probe;
    report.endMs = clock(); report.status = status;
    for (const f of frames) {
      if (!f.error) continue;
      const last = report.missing.at(-1);
      if (last && last.reason === f.error && last.to + 1 === f.id) last.to = f.id;
      else report.missing.push({from:f.id,to:f.id,reason:f.error});
    }
    report.counts = {mainFrames:frames.length, pixels:frames.filter(f=>f.readMs!=null).length, verified256:postCount};
    const samples=frames.filter(f=>f.viewQ), head=samples[0];
    report.observedViewRotationRad=head ? samples.reduce((max,f)=>{
      const dot=f.viewQ.reduce((s,v,i)=>s+v*head.viewQ[i],0);
      return Math.max(max,2*Math.acos(Math.min(1,Math.abs(dot))));
    },0) : null;
    report.motionObserved=report.observedViewRotationRad==null ? null : report.observedViewRotationRad>1e-5;
    if(status==='complete' && report.motionObserved!==(camera==='moving')) report.status='pose-mismatch';
    else if(status==='complete' && !report.renderer) report.status='renderer-unverified';
    const a = report.first32, b = report.first256;
    report.first32To256 = a && b ? {ms:b.drawMs-a.drawMs,frameIntervals:b.id-a.id} : null;
    const panel = document.createElement('div'); panel.style.cssText='position:fixed;left:6px;top:6px;z-index:2147483647;background:#182027;color:white;padding:8px';
    panel.textContent = `${arm.toUpperCase()} / ${camera} / ${report.status}`; (document.body || document.documentElement).append(panel);
    const json = JSON.stringify(report);
    link(panel,'JSON',URL.createObjectURL(new Blob([json],{type:'application/json'})),`${arm}-${camera}-${run}.json`);
    filmstrip(panel);
    fetch('/m16-report',{method:'POST',headers:{'Content-Type':'application/json'},body:json,keepalive:json.length<60000})
      .then(resp=>{if(!resp.ok)throw Error(); link(panel,'本次结果','/results/'+run);})
      .catch(()=>panel.append(' 未入库，请下载本页 JSON'));
  }
  function begin(id, t) {
    if (frames.length >= 3600) return finish('frame-limit');
    if (se.cam.focus !== body || se.neb.active !== idx || se.neb.mainVolume !== mesh || se.neb.imageField?.object?.parent) return finish('target-changed');
    if (gl.isContextLost()) return finish('context-lost');
    // 两臂加载延迟可不同：首个真实 32³ draw 之前停在零角，之后按同一墙钟角速度走。
    const angle = epoch == null ? 0 : report.speedRadSec * (t-epoch)/1000;
    row = {id,beginMs:t,angle,error:'no-final-render'}; frames.push(row);
    se.cam.dir.copy(base).applyAxisAngle(axis,angle); se.cam.alt = alt; se.cam.yaw = 0; se.cam.pitch = -Math.PI/2; se.cam.shift.set(0,0,0);
  }
  // 查实际 draw 后留在 GL 上的程序和 sampler，不把 JS 端资源就绪或首次绑定当作像素样本。
  function density(m) {
    const p = gl.getParameter(gl.CURRENT_PROGRAM), u = m.uniforms, tex = u.uCineDensity?.value;
    if (!p || !tex?.isData3DTexture || u.uCineSteps?.value !== 320) return 0;
    const value = name => {const loc = gl.getUniformLocation(p,name); return loc === null ? null : gl.getUniform(p,loc);};
    row.blend = value('uM16NativeWeight');
    const slot = value('uCineDensity'), a = window.ORBIT_CINEMATIC_ASSETS?.get(9);
    if (a?.type !== 9 || a.id !== 'pillars' || !Number.isInteger(slot) || value('uType') !== 9 || value('uDepthEnabled') !== 1 || value('uCineEnabled') !== 1) return 0;
    const handle = r.properties.get(tex).__webglTexture, active = gl.getParameter(gl.ACTIVE_TEXTURE);
    const {width:w,height:h,depth:d} = tex.image;
    try { gl.activeTexture(gl.TEXTURE0+slot); return handle && gl.getParameter(gl.TEXTURE_BINDING_3D) === handle && w===h && h===d ? w : 0; }
    finally { gl.activeTexture(active); }
  }
  function fields(image) {
    const y = new Float32Array(N*N), e = new Float32Array((N-1)*(N-1)), d = image.data;
    for (let i=0;i<y.length;i++) y[i]=(0.2126*d[4*i]+0.7152*d[4*i+1]+0.0722*d[4*i+2])/255;
    for (let j=0;j<N-1;j++) for (let k=0;k<N-1;k++) {const i=j*N+k;e[j*(N-1)+k]=(Math.abs(y[i+1]-y[i])+Math.abs(y[i+N]-y[i]))/2;}
    return {y,e};
  }
  function mad(a,b) {let s=0; for(let i=0;i<a.length;i++) s+=Math.abs(a[i]-b[i]); return s/a.length;}
  function pixels(id) {
    if (!row || row.id !== id) return;
    row.renderMs = clock();
    if (row.lod!==32 && row.lod!==256) {row.error=row.lod?'unexpected-density-size':'no-verified-density-draw'; return;}
    if (gl.isContextLost() || r.getRenderTarget() !== null) {row.error='no-default-buffer'; return;}
    const w = canvas.width, h = canvas.height, side = Math.floor(Math.min(w,h)/2);
    if (w !== report.buffer[0] || h !== report.buffer[1] || side < N) {row.error='buffer-changed-or-small';return finish(row.error);}
    ctx.drawImage(canvas,Math.floor((w-side)/2),Math.floor((h-side)/2),side,side,0,0,N,N);
    const image=ctx.getImageData(0,0,N,N); row.readMs=clock(); delete row.error;
    row.dir=se.cam.dir.toArray(); row.viewQ=se.camera.quaternion.toArray();
    const shot={row,image,...fields(image)}, n=row.lod;
    if (n===32 && !report.first256) film.set('last 32',shot);
    if (n===256) {
      postCount++;
      if (!film.has('first 256')) film.set('first 256',shot);
      for (const ms of [100,300,800]) {
        const label=`256 +${ms}ms`;
        if (!film.has(label) && row.renderMs-report.first256.drawMs>=ms) film.set(label,shot);
      }
      film.set('tail 256',shot);
      report.tail={lastId:id,msSinceFirst256:row.renderMs-report.first256.drawMs,frameIntervals:id-report.first256.id};
    }
    if (previous && previous.row.id+1===id) {
      const last=previous.row, phase=last.lod===32 && n===32?'pre32':last.lod===32 && n===256?'switch':last.lod===256 && n===256?'post256':null;
      if (phase) {
        const group=report.peaks[phase] ??= {pairs:0}; group.pairs++;
        for (const [key,field] of [['luma','y'],['edge','e']]) {
          const v=mad(shot[field],previous[field]); row[key]=v;
          if (!group[key] || v>group[key].value) {
            group[key]={value:v,from:last.id,to:id,fromMs:last.renderMs,toMs:row.renderMs,deltaMs:row.renderMs-last.renderMs};
            if (phase==='post256') {film.set(key+' before',previous); film.set(key+' after',shot);}
          }
        }
      }
    }
    previous=shot;
    if (report.first256 && row.renderMs-report.first256.drawMs>=4000 && postCount>=13) {
      const p=report.peaks;
      finish(!p.pre32 || !p.switch || !p.post256 ? 'insufficient-adjacent-pairs' : frames.some(f=>f.error && f.id>=report.first32.id) ? 'partial-gaps' : 'complete');
    }
  }
  function select() {
    if (done) return;
    se=window.__SE; idx=window.__NEB?.findIndex(n=>n.shape===3 && /\bM16\b/i.test(n.n));
    if (document.hidden || !se?.EARTH || se.cam.focus!==se.EARTH || !(idx>=0) || boot['earth-ready']==null) return finish('no-ready-earth');
    report.selectionMs=clock(); body=se.enterNebula(idx); r=se.renderer; gl=r.getContext(); mesh=se.neb.mainVolume;
    if (!body || body!==se.neb.body || se.cam.focus!==body || !mesh || mesh.material.uniforms.uType.value!==9 || se.neb.imageField?.object?.parent) return finish('wrong-target');
    if (!r.capabilities.isWebGL2 || !(gl instanceof WebGL2RenderingContext)) return finish('no-webgl2');
    const ext=gl.getExtension('WEBGL_debug_renderer_info'); report.renderer=ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null;
    if (/swiftshader|llvmpipe|softpipe|software rasterizer|basic render driver|\bwarp\b/i.test(report.renderer||'')) return finish('software-renderer');
    canvas=r.domElement; report.buffer=[canvas.width,canvas.height]; report.dpr=devicePixelRatio; report.pixelRatio=r.getPixelRatio();
    base=body.pos.clone().normalize(); axis=base.clone().set(0,1,0).cross(base).normalize(); alt=se.cam.alt;
    report.pose={base:base.toArray(),axis:axis.toArray(),alt,yaw:0,pitch:-Math.PI/2};
    ctx=thumb.getContext('2d',{willReadFrequently:true}); if(!ctx) return finish('no-pixel-reader');
    const original=r.renderBufferDirect;
    r.renderBufferDirect=function(k,s,g,m,o) {
      const calls=r.info.render.calls, out=original.apply(this,arguments);
      if (row && o===mesh && k===se.camera && s===se.scene && m===mesh.material && m.colorWrite && !s.overrideMaterial && r.info.render.calls>calls) {
        try {
          const t=clock(), lod=density(m); row.lod=lod; row.drawMs=t;
          const key=lod===32?'first32':lod===256?'first256':null;
          if(key && !report[key]) report[key]={id:row.id,drawMs:t,sinceSelectionMs:t-report.selectionMs};
          if(lod===32 && epoch==null) report.motionEpochMs=epoch=row.beginMs;
          if (report.first256 && lod===32) finish('density-regressed');
        } catch (_) {row.error='draw-probe-error';finish(row.error);}
      }
      return out;
    };
    undo=()=>{r.renderBufferDirect=original;};
    window.__m16probe={begin,pixels(id){try{pixels(id);}catch(_){row.error='read-error';finish('read-error');}}};
    clearTimeout(timer);timer=setTimeout(()=>finish(!report.first32?'no-preview':!report.first256?'no-native':'short-tail'),90000);
  }
  timer=setTimeout(()=>finish('boot-timeout'),180000);
  observer=new PerformanceObserver(list=>{for(const e of list.getEntries()){
    if(!e.name.startsWith('orbit:') || done) continue;
    const stage=e.name.slice(6); boot[stage] ??= e.startTime;
    if(['failed','earth-fallback','surface-error','frame-timeout'].includes(stage)) return finish(stage);
    if(stage==='interactive') {clearTimeout(timer); timer=setTimeout(()=>{try{select();}catch(_){finish('selection-error');}},Math.max(0,e.startTime+1000-clock()));}
  }}); observer.observe({type:'mark',buffered:true});
  for(const type of ['pointerdown','wheel','keydown','resize']) addEventListener(type,()=>{if(se && !done) finish('input-or-resize');},{capture:true,passive:true});
  addEventListener('pagehide',()=>finish('interrupted'),{once:true});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)finish('hidden');});
  if(navigator.serviceWorker?.controller) finish('sw-controlled');
})();
