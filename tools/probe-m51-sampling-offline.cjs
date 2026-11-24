'use strict';
// 基于现有探针生成独立实验进程；不修改产品源码。
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
let source = fs.readFileSync(path.join(__dirname, 'probe-m51-grain-ab-independent.cjs'), 'utf8');
source = source.replace('m51-grain-ab-independent-${stamp}', 'm51-sampling-offline-${stamp}');
source = source.replace("'http://127.0.0.1:8169/space.html?auto=0&q=high&grade=1&t=0'", "'file:///D:/WB/orbit/space.html?auto=0&q=high&grade=1&t=0'");
source = source.replace("  const view = { name: 'front'", "  const view = { name: 'front'");
const start = source.indexOf("  const view = { name: 'front'");
const end = source.indexOf('\n}', start);
if (start < 0 || end < 0) throw new Error('原探针结构不匹配');
source = source.slice(0, start) + `
  report.experiment = 'M51 离线采样档对照';
  report.constraints = ['离线 file:///D:/WB/orbit/space.html，不使用本地服务', '仅运行时冻结 uGradeT，不修改产品源码', 'SwiftShader 软件渲染，未覆盖真实 GPU', 'PNG 显示编码 RGB 差异，不是线性 HDR；512 档不是收敛真值'];
  report.method = ['同会话同机位，每档两次截图', '全图和中心宽高各一半区域的 RGB 通道绝对差均值，单位 0–255'];
  report.views = [];
  const view = {name:'front', yaw:0, pitch:0, distance:3.6, target:[0,0,0]};
  const result = {view, cases:{}, differences:{}};
  report.views.push(result);
  await evaluate(\`__SE.deep.setView(\${JSON.stringify(view)})\`);
  report.gpu = await evaluate(\`(()=>{const gl=__SE.renderer.getContext(), ext=gl.getExtension('WEBGL_debug_renderer_info');return {vendor:gl.getParameter(gl.VENDOR),renderer:gl.getParameter(gl.RENDERER),unmaskedVendor:ext&&gl.getParameter(ext.UNMASKED_VENDOR_WEBGL),unmaskedRenderer:ext&&gl.getParameter(ext.UNMASKED_RENDERER_WEBGL),version:gl.getParameter(gl.VERSION),lost:gl.isContextLost(),error:gl.getError()}})()\`);
  for (const mode of ['interactive','reference','reference512']) {
    const started = Date.now();
    await evaluate(\`__SE.deep.setQuality(\${JSON.stringify(mode)})\`);
    await waitFrames(3);
    const state = await evaluate(\`(()=>({info:__SE.deep.info(),firstFrame:__SE.firstFrame,grade:__SE.gradeOn,uGradeT:window.__m51GrainMaterial.uniforms.uGradeT.value,hook:{...window.__m51GrainHook},timeScale:__SE.ts,canvas:{width:__SE.renderer.domElement.width,height:__SE.renderer.domElement.height}}))()\`);
    const entry = result.cases[mode] = {state,captures:[],elapsedMs:null};
    for (let i=1;i<=2;i++) {
      const tag=mode+'-'+i, t=Date.now();
      const cap=await capture(tag);
      const file=path.join(root, prefix+'-'+tag+'.png');
      fs.writeFileSync(file,cap.bytes,{flag:'wx'});
      entry.captures.push({ ...cap.meta, file, sha256:cap.sha256, elapsedMs:Date.now()-t });
    }
    entry.elapsedMs=Date.now()-started;
  }
  for (const [a,b] of [['interactive-1','interactive-2'],['reference-1','reference-2'],['reference512-1','reference512-2'],['interactive-1','reference-1'],['reference-1','reference512-1'],['interactive-1','reference512-1']]) {
    result.differences[a+'_vs_'+b] = await evaluate(\`(()=>{const a=window.__m51GrainPixels[\${JSON.stringify(a)}],b=window.__m51GrainPixels[\${JSON.stringify(b)}];const w=__SE.renderer.domElement.width,h=__SE.renderer.domElement.height;if(!a||!b||a.length!==b.length||a.length!==w*h*4)throw Error('图片尺寸不一致');let all=0,mid=0,n=0;for(let y=0;y<h;y++)for(let x=0;x<w;x++){let s=0;const i=4*(y*w+x);for(let k=0;k<3;k++)s+=Math.abs(a[i+k]-b[i+k]);all+=s;if(x>=Math.floor(w/4)&&x<Math.floor(3*w/4)&&y>=Math.floor(h/4)&&y<Math.floor(3*h/4)){mid+=s;n++}}return {meanRGB255:all/(w*h*3),centerMeanRGB255:mid/(n*3),centerPixels:n,centerBounds:[Math.floor(w/4),Math.floor(h/4),Math.floor(3*w/4),Math.floor(3*h/4)]}})()\`);
  }
` + source.slice(end);
vm.runInThisContext(`(function(require,__dirname,__filename){${source}\n})`, {filename:__filename})(require,__dirname,__filename);
