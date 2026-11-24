'use strict';
// 复用既有离线 CDP 探针，仅在浏览器内隔离平滑盘；不修改构建或产品源码。
const fs = require('node:fs');
const path = require('node:path');
const sourceFile = path.join(__dirname, 'probe-m51-height-offline-20261116.cjs');
let source = fs.readFileSync(sourceFile, 'utf8');
function replaceOnce(a, b) {
  if (source.split(a).length !== 2) throw Error('探针模板不匹配: ' + a);
  source = source.replace(a, b);
}
replaceOnce("const trial = 'float disk=exp(-r*2.2)*exp(-abs(q.z)/(height*0.8))*edgeR/0.8;'", "const trial = 'float disk=0.0;'");
replaceOnce('m51-height-offline-${Date.now()}', 'm51-disk-isolation-v194-${Date.now()}');
replaceOnce('M51 体积盘面高度 A1→B→A2', 'M51 平滑盘隔离 A1→B→A2；仅用于归因，非合并候选');
replaceOnce("report.setup.build !== 'v192'", "report.setup.build !== 'v194'");
replaceOnce("for (const quality of ['interactive', 'reference'])", "for (const quality of ['interactive'])");
replaceOnce("    {name:'near-off-core',yaw:0,pitch:0,distance:0.35,target:[0.35,0,0]},\n", '');
replaceOnce("    {name:'back',yaw:Math.PI,pitch:0,distance:3.6,target:[0,0,0]}\n", '');
replaceOnce("'tools/probe-m51-height-offline-20261116.cjs'].map", "'tools/probe-m51-height-offline-20261116.cjs','tools/probe-m51-disk-isolation-v194.cjs'].map");
replaceOnce("'--headless=new', '--enable-unsafe-swiftshader'", "'--headless=new', '--proxy-server=127.0.0.1:9', '--host-resolver-rules=MAP * ~NOTFOUND', '--enable-unsafe-swiftshader'");
replaceOnce("  report.entryAfterSha256 =", "  report.sourceAfterSha256 = Object.fromEntries(['public/js/app.js','public/js/deep-models.js'].map(name => [name, createHash('sha256').update(fs.readFileSync(path.join(root,name))).digest('hex')]));\n  if (Object.entries(report.sourceAfterSha256).some(([name,hash]) => report.build.sourceSha256[name] !== hash)) throw Error('实验期间源码内容变化');\n  report.entryAfterSha256 =");
new Function('require', '__dirname', '__filename', source)(require, __dirname, __filename);
