'use strict';
// Node 22+；复用项目 CDP 驱动，但不修改页面或产品文件。
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const framework = path.join(__dirname, 'test-deep-models.cjs');
const source = fs.readFileSync(framework, 'utf8');
const cut = source.indexOf('async function main() {');
if (cut < 0) throw new Error('无法定位 CDP 驱动入口');
const probe = String.raw`
const OUTPUT = path.join(ROOT, '.workbuddy', 'v198-bright-timing-' + RUN_ID);
fs.mkdirSync(OUTPUT);
const entry = path.join(ROOT, 'space.html');
const hash = f => createHash('sha256').update(fs.readFileSync(f)).digest('hex');
report.entryBefore = hash(entry);
report.frameworkSha256 = hash(${JSON.stringify(framework)});
report.scriptSha256 = hash(${JSON.stringify(__filename)});
report.cases = [];
report.notes = ['记录实际 bright pass 提取时的 uniform；截图为固定相位证据，不证明画质提升。', 'bloom 关闭且非 deep 时主动关闭 glare，预期直接渲染；deep 仍强制经过后处理。'];
function installProbe() {
  const r = __SE.renderer, original = r.render, events = [];
  if (window.__brightTiming) throw Error('探针已安装');
  function wrapped(s, c, ...args) {
    const found = [];
    s.traverse(o => { const m = o.material; if (m && m.uniforms && m.uniforms.uThr && /smoothstep\s*\(\s*uThr/.test(m.fragmentShader || '')) found.push(o); });
    if (found.length > 1) throw Error('亮部提取对象不唯一: ' + found.length);
    if (!found.length) return original.call(this, s, c, ...args);
    const o = found[0], prev = o.onBeforeRender;
    o.onBeforeRender = function(...a) {
      const target = r.getRenderTarget();
      events.push({actual: o.material.uniforms.uThr.value, base: __SE.bloomInfo.thr,
        bloom: __SE.bloom(), deep: __SE.deep.info().active, cosmos: __SE.cosmos().active,
        target: target && [target.width, target.height], timestamp: performance.now()});
      if (prev) return prev.apply(this, a);
    };
    try { return original.call(this, s, c, ...args); } finally { o.onBeforeRender = prev; }
  }
  r.render = wrapped;
  window.__brightTiming = {events, original, wrapped};
}
async function takeSample() {
  const p = window.__brightTiming;
  p.events.length = 0;
  await new Promise(resolve => { let n=4; function tick(){ if (--n === 0) resolve(); else requestAnimationFrame(tick); } requestAnimationFrame(tick); });
  const live = p.events.slice();
  p.events.length = 0;
  const png = __SE.snap('image/png', {gradePhase:42});
  return {png, live, events:p.events.slice()};
}
async function run() {
  await launch();
  for (const grade of [true, false]) {
    phase = '加载 cosGrade=' + Number(grade);
    await load(FILE_URL + '&cosGrade=' + Number(grade), 'file');
    const env = await evaluate('({build:__SE.build,bloom:__SE.bloomInfo,glare:__SE.glareOn,cosGrade:new URLSearchParams(location.search).get("cosGrade")})');
    assert(env.build === 'v198', '仅允许测试实际 v198 入口', env);
    assert(env.cosGrade === String(Number(grade)), 'cosGrade 查询参数不匹配', env);
    report.environment = report.environment || []; report.environment.push(env);
    await evaluate('(' + installProbe.toString() + ')()');
    const original = await evaluate('({bloom:__SE.bloom(),thr:__SE.bloomInfo.thr,glare:__SE.glareOn})');
    try {
      for (const bloom of [true, false]) {
        await evaluate('__SE.bloom(' + bloom + ');__SE.glare(false);__SE.setBloomThr(0.73)');
        const scenarios = [
          ['earth', '__SE.deep.close();__SE.cosmosLeave()'],
          ['deep-enter', '__SE.deep.open("m51");__SE.deep.setView("front")'],
          ['deep-exit', '__SE.deep.close()'],
          ['cosmos-enter', '__SE.cosmos(2e20,0,0.45)'],
          ['cosmos-exit', '__SE.cosmosLeave()']
        ];
        for (const [label, setup] of scenarios) {
          phase = 'grade=' + grade + ', bloom=' + bloom + ', ' + label;
          const state = await evaluate('(()=>{' + setup + ';return {deep:__SE.deep.info().active,cosmos:__SE.cosmos().active,bloom:__SE.bloom(),thr:__SE.bloomInfo.thr,glare:__SE.glareOn}})()');
          const isDeep = label === 'deep-enter', isCosmos = label === 'cosmos-enter';
          assert(state.deep === isDeep && state.cosmos === isCosmos && state.bloom === bloom && state.glare === false, '场景或开关设置无效', state);
          for (const thr of [0.73, 1.31]) {
            await evaluate('__SE.setBloomThr(' + thr + ')');
            const samples = [];
            for (let frame = 0; frame < 3; frame++) {
              if (frame) await frames(1);
              const sample = await evaluate('(' + takeSample.toString() + ')()');
              const expectedDraw = isDeep || bloom;
              assert(sample.events.length === (expectedDraw ? 1 : 0), '亮部提取次数不符合分支预期', {state, thr, frame, events:sample.events});
              assert(expectedDraw ? sample.live.length >= 2 : sample.live.length === 0, '连续帧亮部提取次数无效', {state, thr, frame, live:sample.live});
              for (const e of [...sample.live, ...sample.events]) {
                const expected = e.base * (grade && (isDeep || isCosmos) ? 1.35 : 1);
                assert(e.deep === isDeep && e.cosmos === isCosmos && e.bloom === bloom && Math.abs(e.base-thr)<1e-9 && Number.isFinite(e.actual) && Math.abs(e.actual-expected)<1e-6 && e.target, '提取时阈值或状态错误', {expected,e});
              }
              assert(typeof sample.png === 'string' && sample.png.startsWith('data:image/png;base64,'), '截图无效');
              const file = path.join(OUTPUT, [Number(grade),Number(bloom),label,thr,frame].join('-') + '.png');
              fs.writeFileSync(file, Buffer.from(sample.png.split(',')[1], 'base64'), {flag:'wx'});
              samples.push({frame,live:sample.live,events:sample.events,file,sha256:hash(file)});
            }
            report.cases.push({grade,bloom,label,thr,state,samples});
          }
        }
      }
    } finally {
      const restored = await evaluate('(()=>{const p=window.__brightTiming;__SE.deep.close();__SE.cosmosLeave();__SE.bloom(' + original.bloom + ');__SE.setBloomThr(' + JSON.stringify(original.thr) + ');__SE.glare(' + original.glare + ');__SE.renderer.render=p.original;const out={hook:__SE.renderer.render===p.original,bloom:__SE.bloom(),thr:__SE.bloomInfo.thr,glare:__SE.glareOn,deep:__SE.deep.info().active,cosmos:__SE.cosmos().active};delete window.__brightTiming;return out})()');
      assert(restored.hook && restored.bloom === original.bloom && restored.thr === original.thr && restored.glare === original.glare && !restored.deep && !restored.cosmos, '状态恢复失败', {original,restored});
      report.restoration = report.restoration || []; report.restoration.push({grade,original,restored});
    }
  }
}
(async()=>{try{await run()}catch(e){report.fatal={phase,error:errorText(e),details:e.details}}finally{
  try { report.entryAfter=hash(entry); } catch(e) { report.hashError=errorText(e); }
  if(browser){try{cleanupPromise=Promise.resolve();await browser.send('Browser.close')}catch(e){report.closeError=errorText(e)}browser.ws.close()}else if(child&&child.exitCode===null)child.kill();
  report.ok=!report.fatal&&!report.closeError&&!report.hashError&&report.entryBefore===report.entryAfter&&report.cases.length===40&&report.restoration?.length===2;
  fs.writeFileSync(path.join(OUTPUT,'report.json'),JSON.stringify(report,null,2),{flag:'wx'});
  console.log(JSON.stringify({output:OUTPUT,ok:report.ok,fatal:report.fatal}));process.exitCode=report.ok?0:1;
}})();
`;
vm.runInThisContext(`(function(require,__dirname,__filename,process,Buffer,WebSocket){\n${source.slice(0, cut)}\n${probe}\n})`, {filename:__filename})(require, __dirname, framework, process, Buffer, WebSocket);
