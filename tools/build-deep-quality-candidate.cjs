'use strict';
/* 基于现有入口的局部候选；绝不直接覆盖入口或替换整个 app 脚本。 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const offline = process.argv.includes('--offline');
const sourcePath = path.join(root, offline ? 'space.html' : 'space-http.html');
const outputPath = path.join(root, '.workbuddy', offline ? 'deep-quality-offline-candidate-v7.html' : 'deep-quality-http-candidate-v7.html');
const original = fs.readFileSync(sourcePath, 'utf8');
const source = fs.readFileSync(path.join(root, 'public/js/app.js'), 'utf8');
const eol = '\r\n';
let html = original;
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
function one(text, fragment, label) {
  const i = text.indexOf(fragment);
  if (i < 0 || text.indexOf(fragment, i + fragment.length) !== -1) throw new Error('锚点缺失或不唯一: ' + label);
  return i;
}
function block(text, start, end, label) {
  const i = one(text, start, label + ' 起点');
  const j = text.indexOf(end, i + start.length);
  if (j < 0 || text.indexOf(end, j + end.length) !== -1) throw new Error('结束锚点缺失或不唯一: ' + label);
  return text.slice(i, j);
}
function replaceOnce(before, after, label) {
  const i = one(html, before, label);
  html = html.slice(0, i) + after + html.slice(i + before.length);
}
function transplant(start, end, label) {
  const before = block(html, start, end, label);
  const after = block(source, start, end, '源码 ' + label);
  replaceOnce(before, after, label);
}
transplant('  const NEBULAE = [', '  window.__NEB = NEBULAE;', '星云目标数据');
transplant('const GAL_PHOTO_KEY = {', 'const GAL_PHOTO = {}', '星系专属照片映射');
const publicHtml = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
const nebButton = '      <button class="chip" data-pop="neb" aria-label="选择星云近景"><span>星云</span></button>';
const nebPanel = block(publicHtml, '    <div class="pop" data-panel="neb"', '    <div class="pop" data-panel="time">', '星云面板');
const compactHud = '  @media (max-width:820px){body.nebula-view .scalebox{width:220px;right:auto;bottom:62px;padding:7px 10px}body.nebula-view .scalebox .logbar,body.nebula-view #dateLine{display:none}}';
const logbarStyle = '  .logbar{margin-top:11px;height:24px;position:relative}';
replaceOnce(logbarStyle, compactHud + '\n\n' + logbarStyle, '窄屏星云信息栏');
replaceOnce('  .hv-head .hvsrc{font-size:10.5px;color:#5d7784}',
  '  .hv-head .hvsrc{font-size:10.5px;color:#b7cdd4;max-width:min(560px,100%)}\n  .hv-head .hvsrc a{padding:0;border:0;background:none;color:#b7dcd9;text-decoration:underline;white-space:normal}', '高清查看器来源样式');
const viewerEnd = '  function bind(){\n    box = $(\'#hdViewer\'); img = $(\'#hvImg\'); stage = $(\'#hvStage\');';
const viewerOld = block(html, '  function open(key, title){', viewerEnd, '原高清影像查看器');
const viewerNew = block(publicHtml, '  function open(key, title){', viewerEnd, '高清影像查看器');
replaceOnce(viewerOld, viewerNew, '高清影像查看器');
const atlasOld = block(html, '  function locate(o){', '  function open(){', '原图鉴定位');
const atlasNew = block(publicHtml, '  function locate(o){', '  var atlasLoadError = false;', '图鉴定位');
replaceOnce(atlasOld, atlasNew, '图鉴定位');
const timeButton = '      <button class="chip" data-pop="time"><span>时间</span></button>';
replaceOnce(timeButton, nebButton + '\n' + timeButton, '星云按钮');
replaceOnce('    <div class="pop" data-panel="time">', nebPanel + '    <div class="pop" data-panel="time">', '星云面板');
const uiOld = block(html, '  (function nebUI() {', '  for (let i = 0; i < NEBULAE.length; i++) {', '原星云导航');
const uiNew = block(source, '  (function nebUI() {', '  for (let i = 0; i < NEBULAE.length; i++) {', '星云导航');
replaceOnce(uiOld, uiNew, '星云导航');
replaceOnce('      if (NEB.active === i) {' + eol + '        nebVolMat.uniforms.uTex.value = t;',
  '      if (NEB.active === i && !NEB.nearTex) {' + eol + '        nebVolMat.uniforms.uTex.value = t;', '星云基础纹理回填');
const nebNew = block(source, '/* 显示当前影像的可核对来源', 'function updateNebula(origin)', '星云加载和离开');
const nebOld = block(html, 'function leaveNebula()', 'function updateNebula(origin)', '原星云加载和离开');
replaceOnce(nebOld, nebNew, '星云近景');
replaceOnce('          m.material.map = t;' + eol + '          m.material.needsUpdate = true;' + eol + '          m.userData.photo = true;',
  '          if (!m.userData.closeupActive) m.material.map = t;' + eol + '          m.material.needsUpdate = true;' + eol + '          m.userData.photo = true;', '星系基础纹理回填');
const galaxy = block(source, '/* 单个焦点星系按需读取', 'function galTexForName(', '星系高清加载');
replaceOnce('function galTexForName(', galaxy + 'function galTexForName(', '星系高清加载插入');
transplant('function cosmicLeave()', '/* 飞到某个星系', '宇宙退出');
transplant('CS.flyTo = function (mesh)', 'CS.flyToName = function', '星系飞行');
const galaxyUpdateAnchor = '  /* 银河系：相机在盘内时淡出（不然整屏被盘面糊住） */';
replaceOnce(galaxyUpdateAnchor, '  updateGalaxyCloseupCredit();' + eol + eol + galaxyUpdateAnchor, '星系来源显示更新');
transplant('  if (CS.gcPhoto) {' + eol + '    const sp = CS.gcPhoto, i', '  if (CS.bodyMat)', '星团贴图可见性');
transplant('function photoHDURL(key)', 'function closeCosCard()', '星团按需贴图');
transplant('function showCosCard(kind, name)', 'function cosmicLabels(', '深空详情卡');
transplant('  photoInfo() {', '  focusCluster(name) {', '深空状态诊断');

const nearKeys = ['neb_heic0515a', 'neb_heic1310a', 'neb_heic1307a', 'neb_heic0414a', 'neb_opo0306d'];
const closeKeys = ['esa_heic0506a', 'esa_heic0710a', 'esa_heic0604a', 'esa_opo0328a', 'esa_heic1403a'];
const load = (dir, key) => fs.readFileSync(path.join(root, 'public/data', dir, key + '.jpg')).toString('base64');
const extraGalaxy = 'esa_heic0604a';
const addition = offline
  ? { photoHD: Object.fromEntries([...nearKeys, extraGalaxy].map(k => [k, load('photo-hd', k)])),
      photo: { [extraGalaxy]: load('photo', extraGalaxy) },
      galCloseHD: Object.fromEntries(closeKeys.map(k => [k, load('hd', k)])) }
  : { photoHD: {}, photo: {}, galCloseHD: {} };
const packAnchor = '<script>window.__ORBIT_INLINE__=';
const start = one(html, packAnchor, '原始内联资源包');
const end = html.indexOf('</script>', start);
if (end < 0) throw new Error('内联资源包结束锚点缺失');
/* 不解析或重写原资源包（含新版地球数据），只在紧随其后的脚本追加资源。 */
const extra = '<script>(function(){var p=window.__ORBIT_INLINE__;var x=' + JSON.stringify(addition) + ';Object.assign(p.photoHD||(p.photoHD={}),x.photoHD);Object.assign(p.photo||(p.photo={}),x.photo);p.galCloseHD=x.galCloseHD;p.photoKind=p.photoKind||{};p.photoKind[' + JSON.stringify(extraGalaxy) + ']=\"gal\";p.photoHDKeys=Array.from(new Set((p.photoHDKeys||[]).concat(' + JSON.stringify([...nearKeys, extraGalaxy]) + ')));p.hdKeys=Array.from(new Set((p.hdKeys||[]).concat(' + JSON.stringify([extraGalaxy]) + ')));(p.objects||[]).forEach(function(o){if(o.name===\"雪茄星系 M82\"){o.photoKey=' + JSON.stringify(extraGalaxy) + ';o.photoFallback=false;}});})();</script>';
html = html.slice(0, end + '</script>'.length) + extra + html.slice(end + '</script>'.length);
const originalStart = one(original, packAnchor, '原始入口内联资源包');
const originalEnd = original.indexOf('</script>', originalStart);
if (originalEnd < 0 || html.slice(start, end + '</script>'.length) !== original.slice(originalStart, originalEnd + '</script>'.length)) throw new Error('原内联资源包发生变化');
const earthMarkers = ['const __earthImagery', 'uEarthImg', 'uWxImg'];
for (const marker of earthMarkers) {
  const before = original.split(marker).length - 1, after = html.split(marker).length - 1;
  if (before !== after) throw new Error('地球影像标记数量发生变化: ' + marker);
}
fs.writeFileSync(outputPath, html, { flag: 'wx' });
console.log(JSON.stringify({ source: sourcePath, sourceSha256: hash(original), candidate: outputPath, candidateSha256: hash(html), sourceBytes: Buffer.byteLength(original), candidateBytes: Buffer.byteLength(html), inlineNebula: offline ? nearKeys.length : 0, inlineGalaxy: offline ? closeKeys.length : 0 }, null, 2));
