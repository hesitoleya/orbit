/* 把 earth-terrain.png / earth-climate.png 重新 base64 内联进 space.html。
   用法：node tools/embed-earth-map.cjs
   只替换那两个常量的字符串内容，其余字节原样保留（space.html 1.7 MB，别整体重写）。 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const htmlPath = path.join(root, 'space.html');
let html = fs.readFileSync(htmlPath, 'utf8');
const before = html.length;

const files = [
  ['EARTH_TERRAIN_B64', 'earth-terrain.png'],
  ['EARTH_CLIMATE_B64', 'earth-climate.png']
];

for (const [name, file] of files) {
  const b64 = fs.readFileSync(path.join(root, file)).toString('base64');
  const re = new RegExp("(const " + name + " = ')[^']*(')");
  if (!re.test(html)) { console.error('未找到', name); process.exit(1); }
  html = html.replace(re, (m, a, b) => a + b64 + b);
  console.log(name, (b64.length / 1024).toFixed(0) + ' KB base64');
}

fs.writeFileSync(htmlPath, html);
console.log('space.html', before, '->', html.length, 'bytes');
