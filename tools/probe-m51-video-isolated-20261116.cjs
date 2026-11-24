'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const originalPath = path.join(__dirname, 'test-deep-models.cjs');
let source = fs.readFileSync(originalPath, 'utf8');
const start = source.indexOf("  if (!FAST) await test('M51连续相机轨迹录像'");
const end = source.indexOf("\n  if (FAST) report.tests.push({ name: 'M51连续相机轨迹录像'", start);
if (start < 0 || end < 0) throw Error('录像用例结构不匹配');
let recordingCase = source.slice(start, end);
const anchor = "    assert(bytes.length===recording.bytes && bytes.length>10000 && recording.views.length>30";
if (!recordingCase.includes(anchor)) throw Error('录像断言结构不匹配');
recordingCase = recordingCase.replace(anchor, `    report.decode = await evaluate(\`new Promise(resolve=>{const v=document.createElement('video');let done=false;const finish=(result)=>{if(done)return;done=true;clearTimeout(timer);v.removeAttribute('src');v.load();resolve(result)};const timer=setTimeout(()=>finish({ok:false,reason:'decode timeout'}),20000);v.muted=true;v.onloadeddata=()=>{try{const c=document.createElement('canvas');c.width=v.videoWidth;c.height=v.videoHeight;c.getContext('2d').drawImage(v,0,0);finish({ok:true,width:c.width,height:c.height,duration:Number.isFinite(v.duration)?v.duration:null,readyState:v.readyState})}catch(e){finish({ok:false,reason:String(e)})}};v.onerror=()=>finish({ok:false,reason:'video error '+(v.error&&v.error.code)});v.src=window.__deepProbe.video;v.load()})\`);
    report.evidenceBeforeAssertion = evidence;
    ` + anchor);
if (process.env.FORCE_VIDEO_ASSERT_FAILURE === '1') recordingCase = recordingCase.replace('bytes.length>10000 && recording.views.length>30', 'bytes.length>Number.MAX_SAFE_INTEGER && recording.views.length>30');
const mainStart = source.indexOf('async function main() {');
const mainEnd = source.indexOf('\nfunction cleanup()', mainStart);
if (mainStart < 0 || mainEnd < 0) throw Error('主函数结构不匹配');
source = source.slice(0, mainStart) + `async function main() {
  report.experiment = '离线 M51 原始录像用例隔离复用';
  report.controlledInjection = process.env.FORCE_VIDEO_ASSERT_FAILURE === '1' ? '仅将字节阈值替换为不可达到值，强制断言失败；未修改产品' : '无';
  report.entryBeforeSha256 = createHash('sha256').update(fs.readFileSync(path.join(ROOT,'space.html'))).digest('hex');
  report.originalTestSha256 = createHash('sha256').update(fs.readFileSync(path.join(ROOT,'tools/test-deep-models.cjs'))).digest('hex');
  await launch();
  await load(FILE_URL, 'file');
  report.setup = await evaluate(\`(()=>({build:__SE.build,location:location.href,gl:(()=>{const g=__SE.renderer.getContext(),x=g.getExtension('WEBGL_debug_renderer_info');return {renderer:g.getParameter(g.RENDERER),unmaskedRenderer:x&&g.getParameter(x.UNMASKED_RENDERER_WEBGL)}})()}))()\`);
${recordingCase}
}` + source.slice(mainEnd);
source = source.replace('function finish() {', `function finish() {
  report.entryAfterSha256 = createHash('sha256').update(fs.readFileSync(path.join(ROOT,'space.html'))).digest('hex');
  report.notes.push('隔离包装只运行离线录像用例；未运行完整验收；浏览器首帧解码不证明视频全程完整或视觉连续。');`);
source = source.replace('deep-models-test-184-${RUN_ID}.json', 'm51-video-isolated-20261116-${RUN_ID}.json');
vm.runInThisContext(`(function(require,__dirname,__filename){${source}\n})`, {filename:originalPath})(require,__dirname,originalPath);
