/* 构建预览：与 build.mjs 相同的单文件构建，但写入 .workbuddy/p2-preview/，
 * 不覆盖 space.html / index.html / space-http.html。
 * 用途：在改动进入正式入口之前，对实际构建产物做浏览器测量。
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let source = fs.readFileSync(path.join(root, 'build.mjs'), 'utf8').replace(/\r\n/g, '\n');
function replaceOnce(before, after) {
  const parts = source.split(before);
  if (parts.length !== 2) throw new Error('Build source boundary missing or not unique; refusing to execute');
  source = parts[0] + after + parts[1];
}
replaceOnce("const ROOT = path.dirname(fileURLToPath(import.meta.url));", `const ROOT = ${JSON.stringify(root)};`);
replaceOnce(`for (const name of ['space.html', 'index.html']) {
  fs.writeFileSync(path.join(ROOT, name), htmlOffline);
}
fs.writeFileSync(path.join(ROOT, 'space-http.html'), htmlHttp);`, `
const out = path.join(ROOT, '.workbuddy', 'p2-preview');
fs.mkdirSync(out, {recursive: true});
for (const name of ['space.html', 'index.html']) {
  fs.writeFileSync(path.join(out, name), htmlOffline);
}
fs.writeFileSync(path.join(out, 'space-http.html'), htmlHttp);
console.log('预览已写入 ' + out + '（未覆盖正式入口）');
`);
console.log('以当前源码构建预览；不写入项目根目录。');
await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
