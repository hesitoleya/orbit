'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const original = path.join(__dirname, 'probe-m51-v197-independent.cjs');
let source = fs.readFileSync(original, 'utf8');
source = source.replaceAll('v197', 'v198');
source = source.replace("report.experiment = 'v198 原始 file 入口 M51 连续录像';", "report.experiment = 'v198 原始 file 入口 M51 连续录像';\n  report.notes.push('下载由测试脚本创建链接触发，不是产品 UI 的下载功能。');\n  report.notes.push('轨迹由测试脚本设定，8 秒内绕行一周并按指数距离 3.6→0.35→3.6，末态保持至少 1500ms；captureStream 请求 30fps，目标码率 4500000bps。');\n  assert(process.env.ORBIT_GPU !== '0', '拒绝软件渲染参数');");
source = source.replace("source=source.replace('  report.complete = report.ok && !FAST;', '  report.complete = false;');", "source=source.replace('  report.complete = report.ok && !FAST;', '  report.complete = false;');\nsource=source.replace(\"  report.finishedAt = new Date().toISOString();\", \"  try { report.entryAtFinishSha256 = createHash('sha256').update(fs.readFileSync(path.join(ROOT, 'space.html'))).digest('hex'); } catch (e) { report.notes.push('结束哈希失败：' + e.message); }\\n  report.finishedAt = new Date().toISOString();\");");
vm.runInThisContext(`(function(require,__dirname,__filename){${source}\n})`, {filename: original})(require, __dirname, original);
