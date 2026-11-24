/* SPACE·1:1 — 单文件构建
 *
 * 把 public/ 重新打包成 space.html：内联 three.min.js、app.js 与两张数据图。
 * 目的：保留「双击就能跑」的桌面版（完全离线，不依赖 unpkg CDN），
 *       同时源码保持拆分（前端 app.js / 数据 data/*）。
 *
 * 默认不覆盖既有产物；用 --output-dir=<现有目录> 输出到独立目录。
 * 确认允许覆盖全部现有产物时使用 --replace-existing；--preflight 仅检查目标。
 */
import fs from 'node:fs';
import path from 'node:path';
import { Script } from 'node:vm';
import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUB = path.join(ROOT, 'public');
const args = process.argv.slice(2);
const outputArgs = args.filter(arg => arg.startsWith('--output-dir='));
const unknown = args.filter(arg => arg !== '--replace-existing' && arg !== '--preflight' && !arg.startsWith('--output-dir='));
if (unknown.length || outputArgs.length > 1 || outputArgs.some(arg => !arg.slice('--output-dir='.length))) {
  throw new Error('用法：node build.mjs [--output-dir=<现有目录>] [--replace-existing] [--preflight]');
}
const outputDir = outputArgs.length ? path.resolve(outputArgs[0].slice('--output-dir='.length)) : ROOT;
if (!fs.statSync(outputDir, { throwIfNoEntry: false })?.isDirectory()) {
  throw new Error(`输出目录不存在或不是目录：${outputDir}`);
}
const outputs = ['space.html', 'index.html', 'space-http.html'].map(name => path.join(outputDir, name));
const collisions = outputs.filter(file => fs.existsSync(file));
if (collisions.length && !args.includes('--replace-existing')) {
  throw new Error(`为保护现有成果，已停止构建；下列文件会被覆盖：\n${collisions.join('\n')}\n请使用 --output-dir=<现有空目录>；只有在明确确认覆盖全部目标文件后才使用 --replace-existing。`);
}
if (args.includes('--preflight')) {
  console.log(`预检通过：输出目录 ${outputDir}；${collisions.length ? '将覆盖现有产物' : '无同名产物'}；未写入文件。`);
  process.exit(0);
}
const read = (p) => fs.readFileSync(path.join(PUB, p), 'utf8');
const b64 = (p) => fs.readFileSync(path.join(PUB, p)).toString('base64');

let html = read('index.html');
const app = read('js/app.js');
html = html.replace('<script src="./js/blackhole-reference.js"></script>', () => '<script>' + read('js/blackhole-reference.js') + '</script>');
html = html.replace('<script src="./js/reference-deep-volume.js"></script>', () => '<script>' + read('js/reference-deep-volume.js') + '</script>');
const jpgDepth = Object.fromEntries(['galaxy','rose','blue','pillar','remnant'].map(k=>[k,b64('data/jpg-depth/'+k+'.jpg')]));
const bhReference = fs.readFileSync(path.join(ROOT, 'data', 'orbit.mp4')).toString('base64');
const sdoPortable = b64('data/sdo-sun-portable.mp4');
if (sdoPortable.length < 1024) throw new Error('缺少 SDO 离线影片');
html=html.replace('<script src="./js/cinematic-content.js"></script>',()=>'<script>'+read('js/cinematic-content.js')+'</script>');
html=html.replace('<script src="./js/cinematic-assets.js"></script>',()=>'<script>'+read('js/cinematic-assets.js')+'</script>');
html=html.replace('<script src="./js/cinematic-stars.js"></script>',()=>'<script>'+read('js/cinematic-stars.js')+'</script>');
const cinematicManifest=JSON.parse(read('data/cinematic-nebula/manifest.json'));
const previews = {}, previewBlocks = [], nativeBlocks = [];
const digest = b => createHash('sha256').update(b).digest('hex');
function cineBlock(file, data) {
  if (!/^[-\w.]+\.bin\.gz$/.test(file)) throw Error('非法体积文件名：' + file);
  return `<script id="orbit-cine-${file}" type="application/octet-stream">${data.toString('base64')}</script><script>ORBIT_CINEMATIC_ASSETS.parsed('${file}')</script>`;
}
// 离线快速预览只需发射/消光与入射光。在线资源与原 manifest 不变。
// 在原编码的线性光空间对每个体素盒求均值（sqrt 编码的 RGB 用均方根）。
function previewField(spec, compressed, sqrtRGB) {
  const raw = gunzipSync(compressed), [w,h,d] = spec.dimensions, c = spec.channels;
  if (raw.length !== w*h*d*c || digest(raw) !== (spec.rawSha256 || spec.uncompressedSha256)) throw Error('预览源损坏：' + spec.file);
  const n = 32, out = Buffer.alloc(n**3*c), sums = new Float64Array(c);
  for (let z=0; z<n; z++) for (let y=0; y<n; y++) for (let x=0; x<n; x++) {
    sums.fill(0); let count=0;
    for (let k=Math.floor(z*d/n); k<Math.floor((z+1)*d/n); k++)
      for (let j=Math.floor(y*h/n); j<Math.floor((y+1)*h/n); j++)
        for (let i=Math.floor(x*w/n); i<Math.floor((x+1)*w/n); i++) {
          const pos=((k*h+j)*w+i)*c; count++;
          for(let a=0;a<c;a++){const v=raw[pos+a]; sums[a]+=sqrtRGB && a<3 ? v*v : v;}
        }
    for(let a=0;a<c;a++) out[((z*n+y)*n+x)*c+a]=Math.round(sqrtRGB && a<3 ? Math.sqrt(sums[a]/count) : sums[a]/count);
  }
  const gz=gzipSync(out), file='preview-'+spec.file;
  previewBlocks.push(cineBlock(file,gz));
  return {file, dimensions:[n,n,n], channels:c, compressedBytes:gz.length, rawBytes:out.length, sha256:digest(gz), rawSha256:digest(out)};
}
function nativeField(spec) {
  const data=fs.readFileSync(path.join(PUB,'data/cinematic-nebula',spec.file));
  if (digest(data)!==spec.sha256) throw Error('压缩体积损坏：'+spec.file);
  nativeBlocks.push(cineBlock(spec.file,data)); return data;
}
// M16 是菜单中第一个保留烘焙场的近景。先让其低层可用，再放其他预览及原始块。
for (const p of [...cinematicManifest.profiles].sort((a,b)=>Number(b.type===9)-Number(a.type===9))) {
  for (const role of ['medium','light','occupancy','shading']) if (p[role]) {
    const data=nativeField(p[role]);
    if ([9,6,8,12].includes(p.type) && ['medium','light'].includes(role))
      (previews[p.type] ??= {})[role]=previewField(p[role],data,role==='medium' && p.emissionEncoding==='sqrt-unorm8');
  }
}
if(cinematicManifest.detail) { nativeField(cinematicManifest.detail); nativeBlocks.unshift(nativeBlocks.pop()); }
const cinematicEnd = '<script>ORBIT_CINEMATIC_ASSETS.parsed(null)</script>';
html = html.replace('<script src="./js/galaxy-structure.js"></script>', () => '<script>' + read('js/galaxy-structure.js') + '</script>');
html = html.replace('<script src="./js/main-volumes.js"></script>', () => '<script>' + read('js/main-volumes.js') + '</script>');
html = html.replace('<script src="./js/observed-galaxy-volume.js"></script>', () => '<script>' + read('js/observed-galaxy-volume.js') + '</script>');
html = html.replace('<script src="./js/gaia-stars.js"></script>', () => '<script>' + read('js/gaia-stars.js') + '</script>');
html = html.replace('<script src="./js/cosmic-population.js"></script>', () => '<script>' + read('js/cosmic-population.js') + '</script>');
html = html.replace('<script src="./js/milkyway-fill.js"></script>', () => '<script>' + read('js/milkyway-fill.js') + '</script>');
const atlasPhotoMeta=JSON.parse(read('data/atlas-photos/manifest.json')).records;
const atlasPhotos=Object.fromEntries(Object.entries(atlasPhotoMeta).map(([key,record])=>[key,b64('data/atlas-photos/'+record.file)]));
const photoCatalog=JSON.parse(read('data/photo-catalog.json'));
const photoMap=JSON.parse(read('data/photo-map.json'));
const skyPanorama=b64('data/sky/eso0932a-source.jpg');
const gaia={manifest:JSON.parse(read('data/gaia/manifest.json')),data:b64('data/gaia/gaia-dr3.bin')};
const sunEmission=b64('data/sun-emission-4k.jpg');
const moonLroc=b64('data/lroc_color_4k.jpg');
/* 对话 242：月球真实高程（8 ppd 降采样，离线内联） */
const moonLdem=b64('data/moon-ldem8.bin');
/* 对话 241：行星全球反照率图（等距圆柱 2:1）。离线单文件同样内联，
   离线也能拖动球体看背面，不依赖网络。 */
const planetMapMeta=JSON.parse(read('data/planet-maps/manifest.json')).records;
const planetMaps=Object.fromEntries(Object.entries(planetMapMeta)
  .filter(([key,record])=>key!=='moon')
  .map(([key,record])=>[key,b64('data/planet-maps/'+record.file)]));
const earthSurface=b64('data/earth-surface-8k.jpg');
const earthClouds=b64('data/earth-cloudfraction.jpg');
const three = read('js/three.min.js');
const terrain = b64('data/earth-terrain.png');
const climate = b64('data/earth-climate.png');
const biome = b64('data/earth-biome.png');          /* 对话 91：真实地貌图 */
let peaks = { peaks: [] };
try { peaks = JSON.parse(read('data/peaks.json')); } catch {}
let volcanoes = { volcanoes: [] };                 /* 对话 91：真实火山表 */
try { volcanoes = JSON.parse(read('data/volcanoes.json')); } catch {}

/* 对话 96：真实星系照片（Wikimedia Commons，已裁成 448² 并压到 ~50 KB）
   内联进单文件，双击也能看到照片；http 模式由 app.js 回退到 data/gal/*.jpg */
/* 对话 106：SDSS bisous 纤维骨架（42 KB 二进制 → base64 约 57 KB） */
let gxy = '';
try { gxy = fs.readFileSync(path.join(PUB, 'data/galaxies.bin')).toString('base64'); } catch (e) { console.warn('星系数据缺失:', e.message); }
let fil = '';
try { fil = fs.readFileSync(path.join(PUB, 'data/filaments.bin')).toString('base64'); } catch (e) { console.warn('纤维数据缺失:', e.message); }
/* 对话 138：银河系俯视真实图（NASA/JPL-Caltech/R. Hurt 重建，去标注后 248 KB） */
let mwf = '';
try { mwf = fs.readFileSync(path.join(PUB, 'data/mw-face.jpg')).toString('base64'); } catch (e) { console.warn('银河系贴图缺失:', e.message); }
/* 对话 138：旋臂亮度表（72×144，10 KB），盘星按它采样方位角 */
let mws = '';
try { mws = fs.readFileSync(path.join(PUB, 'data/mw-spiral.bin')).toString('base64'); } catch (e) { console.warn('旋臂表缺失:', e.message); }
/* 对话 138/140：144 个银河系球状星团（Harris 星表 VII/202，带名称的 JSON，~9.5 KB） */
let mwg = '';
try { mwg = fs.readFileSync(path.join(PUB, 'data/mwgc.json'), 'utf8'); } catch (e) { console.warn('球状星团数据缺失:', e.message); }
/* 对话 164：真实 Gaia 银河系俯视图（ESA/Gaia/DPAC, Stefan Payne-Wardenar），
   用于把银河系从「程序化噪声」换成「真实影像 + 体积厚度」。 */
let mwGaia = '';
try { mwGaia = fs.readFileSync(path.join(PUB, 'data/mw/gaia-face.jpg')).toString('base64'); } catch (e) { console.warn('Gaia 银河系图缺失:', e.message); }
/* 对话 165：天球背景的真实影像（大/小麦哲伦云）。原来这两条是 256² 程序化
   贴图放大到 10°/5°，在近地轨道背景上是两团白雾。 */
let skyLmc = '', skySmc = '', skyM42 = '';
try { skyLmc = fs.readFileSync(path.join(PUB, 'data/sky/lmc.jpg')).toString('base64'); } catch (e) { console.warn('LMC 影像缺失:', e.message); }
try { skySmc = fs.readFileSync(path.join(PUB, 'data/sky/smc.jpg')).toString('base64'); } catch (e) { console.warn('SMC 影像缺失:', e.message); }
/* 对话 168：猎户座大星云（heic0601a，30' 视场）*/
try { skyM42 = fs.readFileSync(path.join(PUB, 'data/sky/m42.jpg')).toString('base64'); } catch (e) { console.warn('M42 影像缺失:', e.message); }
/* 对话 164：真实银河暗尘埃带纹理（遮挡银光的暗云），做体积尘埃云 */
let mwDust = '';
/* 对话 164b：尘埃层改用 tools/make-dust-lanes.py 从 Gaia 图反解出的丝状吸收图 */
try { mwDust = fs.readFileSync(path.join(PUB, 'data/mw/dust-lanes.png')).toString('base64'); } catch (e) { console.warn('尘埃带缺失:', e.message); }

/* 场景图片等比缩放并留黑边以适配方形几何；新增星云图最长边不超过 1536 像素，
   原图较小时不放大。离线内联；在线按 photoHDKeys 请求 data/photo-hd。 */
const photoHD = {};
try {
  for (const f of fs.readdirSync(path.join(PUB, 'data/photo-hd'))) {
    if (!/\.jpg$/i.test(f)) continue;
    photoHD[f.replace(/\.jpg$/i, '')] = fs.readFileSync(path.join(PUB, 'data/photo-hd', f)).toString('base64');
  }
  console.log('photoHD 内联', Object.keys(photoHD).length, '张');
} catch (e) { console.warn('photo-hd 目录缺失:', e.message); }
const nearKeys = ['neb_heic0515a', 'neb_heic1310a', 'neb_heic1307a', 'neb_heic0414a', 'neb_opo0306d'];
for (const key of nearKeys) if (!photoHD[key]) throw new Error('星云观测贴图缺失：' + key);
const closeKeys = ['esa_heic0506a', 'esa_heic0710a', 'esa_heic0604a', 'esa_opo0328a', 'esa_heic1403a'];
const galCloseHD = {};
for (const key of closeKeys) galCloseHD[key] = fs.readFileSync(path.join(PUB, 'data/hd', key + '.jpg')).toString('base64');

const gal = {};
try {
  for (const f of fs.readdirSync(path.join(PUB, 'data/gal'))) {
    if (!/\.jpg$/i.test(f)) continue;
    gal[f.replace(/\.jpg$/i, '')] = fs.readFileSync(path.join(PUB, 'data/gal', f)).toString('base64');
  }
} catch (e) { console.warn('gal 贴图缺失:', e.message); }

/* 对话 103：大尺度结构照片（ESA/Hubble，已裁成 448² 并做径向淡出到黑，
   单张 ~20 KB）。同样内联进单文件，file:// 双击也能看到真实星系团 */
const cos = {};
try {
  for (const f of fs.readdirSync(path.join(PUB, 'data/cos'))) {
    if (!/\.jpg$/i.test(f)) continue;
    cos[f.replace(/\.jpg$/i, '')] = fs.readFileSync(path.join(PUB, 'data/cos', f)).toString('base64');
  }
} catch (e) { console.warn('cos 贴图缺失:', e.message); }

/* 对话 142：天体图鉴大窗口 —— 268 条档案 + 84 张真实影像全部内联，
   file:// 双击也能看到「所有实拍图」，不依赖后端接口。 */
const photo = {};
try {
  for (const f of fs.readdirSync(path.join(PUB, 'data/photo'))) {
    if (!/\.jpg$/i.test(f)) continue;
    photo[f.replace(/\.jpg$/i, '')] = fs.readFileSync(path.join(PUB, 'data/photo', f)).toString('base64');
  }
} catch (e) { console.warn('实拍图目录缺失:', e.message); }

/* 图片分类（gal 星系 / gc 球状星团 / cos 深场）与高清图清单：
   体积很小，两个发布形态都内联，3D 详情卡与图鉴离线也能挑到对应类型的真实影像。 */
let photoKind = {};
try {
  const c = JSON.parse(read('data/photo-catalog.json'));
  for (const k of Object.keys(c)) photoKind[k] = c[k].kind;
} catch (e) { console.warn('photo-catalog 缺失:', e.message); }
let hdKeys = [];
try { hdKeys = Object.keys(JSON.parse(read('data/hd-map.json'))); } catch (e) {}

/* 从 db/data.sql 直接解析档案，保证图鉴与数据库同源（不另存一份容易过期的副本） */
function splitSqlRow(line) {
  const s = line.trim().replace(/^\(/, '').replace(/\)[,;]?\s*$/, '');
  const out = []; let cur = '', inStr = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (c === "'") { if (s[i + 1] === "'") { cur += "'"; i++; } else inStr = false; }
      else cur += c;
    } else if (c === "'") inStr = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  if (inStr) throw new Error('档案 SQL 字符串未闭合');
  out.push(cur);
  return out;
}
const num = v => (v == null || v === 'NULL' || v === '') ? null : Number(v);
let objects = [];
try {
  const sql = fs.readFileSync(path.join(ROOT, '../orbit-server/src/main/resources/db/data.sql'), 'utf8');
  const seenCodes = new Set();
  objects = sql.split(/\r?\n/).filter(l => /^\('/.test(l)).map((l, i) => {
    const f = splitSqlRow(l);
    if (f.length !== 16 || !f[0] || !f[1] || !f[4]) throw new Error(`第 ${i + 1} 条档案字段不完整`);
    if (seenCodes.has(f[0])) throw new Error(`重复档案 code：${f[0]}`);
    seenCodes.add(f[0]);
    for (const col of [5, 6, 7, 8, 9, 15]) {
      if (num(f[col]) !== null && !Number.isFinite(num(f[col]))) throw new Error(`第 ${i + 1} 条档案数值无效，字段 ${col + 1}`);
    }
    return {
      id: i + 1, code: f[0], name: f[1], nameEn: f[2], alias: f[3], type: f[4],
      ra: num(f[5]), decl: num(f[6]), distanceLy: num(f[7]), diameterLy: num(f[8]),
      magnitude: num(f[9]), photoKey: f[10] || '', description: f[11] || '',
      sort: num(f[15]) || 0
    };
  });
} catch (e) {
  throw new Error(`构建中止：档案 SQL 读取或解析失败（未写入成品）：${e.message}`, { cause: e });
}
if (objects.length === 0) {
  throw new Error('构建中止：档案 SQL 未解析到任何对象（未写入成品）');
}

/* 对话 161（二修）：星系照片的「单一真相」是 app.js 的 GAL_PHOTO_KEY ——
   只有这 22 个天体有专属照片。其余 40 个星系（矮/不规则/部分旋涡）在 data.sql
   里的 photo_key 列曾整体错位写进 name_en（导致图鉴读到空、再随机 hash 兜底
   就变成「大小麦哲伦云同一张、一堆星系共用一张」）。这里不再信任 data.sql 的
   值，改为：
     · 名字在 GAL_PHOTO_KEY → 专属照片，photoFallback=false；
     · 其余星系 → 按形态从实拍图池【轮询】分配（矮/不规则用球状星团图更贴切），
       保证不重复，photoFallback=true（UI 标「类型示意」）。
   轮询（而非 hash）是刻意的：hash 会让 40 条在 32 张图里随机撞车。 */
let exclusive = {};
try {
  const _app = read('js/app.js');
  const m = _app.match(/const GAL_PHOTO_KEY = \{([\s\S]*?)\n\};/);
  if (m) {
    for (const line of m[1].split('\n')) {
      const mm = line.match(/^\s*'([^']+)'\s*:\s*'([^']+)'/);
      if (mm) exclusive[mm[1]] = mm[2];
    }
  }
} catch (e) { console.warn('解析专属照片映射失败:', e.message); }
const exclusiveNames = new Set(Object.keys(exclusive));
const exclusiveKeys = new Set(Object.values(exclusive));
const galPool = Object.keys(photoKind).filter(k => photoKind[k] === 'gal');
const gcPool = Object.keys(photoKind).filter(k => photoKind[k] === 'gc');
const cosPool = Object.keys(photoKind).filter(k => photoKind[k] === 'cos');
const galFree = galPool.filter(k => !exclusiveKeys.has(k));   /* 未被专属占用的星系图 */
const demoIdx = {};
let exclusiveN = 0, demoN = 0;
for (const o of objects) {
  if (!o.type || o.type.indexOf('galaxy') !== 0) continue;   /* 只处理星系 */
  if (exclusiveNames.has(o.name)) {
    o.photoKey = exclusive[o.name];
    o.photoFallback = false;
    exclusiveN++;
    continue;
  }
  /* 旋涡/棒旋用「未被专属占用」的星系图，不够再用深场图；其余（矮/不规则/椭圆/透镜）
     用球状星团图（椭圆星系视觉上就是密集星点、无旋臂）。三类池互斥 + 各自轮询，
     62 个星系（22 专属 + 40 示意）可做到 photoKey 完全无重复。 */
  const useGc = o.type === 'galaxy_dwarf' || o.type === 'galaxy_irregular'
             || o.type === 'galaxy_elliptical' || o.type === 'galaxy_lenticular';
  let pool, poolKey;
  if (useGc) { pool = galPool; poolKey = 'galReference'; }
  else if ((demoIdx.gal || 0) < galFree.length) { pool = galFree; poolKey = 'gal'; }
  else { pool = cosPool; poolKey = 'cos'; }
  const i = demoIdx[poolKey] || 0;
  o.photoKey = pool[i % pool.length];
  o.photoFallback = true;
  demoIdx[poolKey] = i + 1;
  demoN++;
}
if (demoN) console.log(`  · 专属照片 ${exclusiveN} 条 · 类型示意 ${demoN} 条（轮询去重）`);

/* 离线单文件：把「import * as THREE from 'three'」换成读全局 window.THREE，
   并在前面内联 UMD 版 three.min.js（挂 window.THREE）。这样 file:// 双击即跑，
   不再依赖 unpkg CDN —— 网络慢时页面会一直卡在「加载中」。 */
const appOffline = app.replace(/import \* as THREE from 'three';/, 'const THREE = window.THREE;');
if (appOffline === app) throw new Error('app.js 里找不到 three 的 import 行');

/* 去掉指向 unpkg 的 importmap（离线不再需要） */
html = html.replace(/<script type="importmap">[\s\S]*?<\/script>\s*/, '');

/* three.min.js 首行是 `console.warn('...'),` —— 结尾逗号把整个 UMD 包装
   `function(t,e){...}(this,...)` 变成逗号表达式。不能删这一行（否则 function 变成
   语句开头的匿名函数声明 → SyntaxError）；改用 `0&&` 短路掉 warning，同时保留
   逗号表达式的结构。 */
const threeClean = three.replace(/^console\.warn\(/, '0&&console.warn(');

/* 两个发布形态：
   · 离线单文件（space.html / index.html）：84 张实拍图全部 base64 内联，双击即看；
   · 在线轻量版（space-http.html → 后端 static/space.html）：实拍图走 data/photo/*.jpg，
     首屏体积回到改造前的量级，图鉴脚本会自动回退到相对路径。 */
// 键只来自受限文件名；正文只含 base64，不能结束 HTML 的原始文本标签。
const photoHDLengths = Object.fromEntries(Object.entries(photoHD).map(([key, data]) => {
  if (!/^[a-zA-Z0-9_-]+$/.test(key) || !data.length) throw Error('无效的高清影像：' + key);
  return [key, data.length];
}));
const hdBlocks = Object.entries(photoHD).map(([key, data]) =>
  `<script id="orbit-photo-hd-${key}" type="application/octet-stream">${data}</script>`).join('\n');
const inlinePack = (withPhotos) => `<script>window.__ORBIT_INLINE__=${JSON.stringify({
  terrain, climate, biome, peaks, volcanoes, gal, cos, fil, gxy, mwf, mws, mwg, earthSurface, earthClouds, sunEmission,
  jpgDepth: withPhotos ? jpgDepth : {},
  movieBase64Lengths: withPhotos ? {bhReferenceVideo: bhReference.length, sdoMovie: sdoPortable.length} : undefined,
  sdoPoster: withPhotos ? b64('data/sdo-poster.jpg') : '',
  skyPanorama: withPhotos ? skyPanorama : '',
  moonLroc: withPhotos ? moonLroc : '',
  moonLdem: withPhotos ? moonLdem : '',
  planetMaps: withPhotos ? planetMaps : {},
  gaia: withPhotos ? gaia : null,
  cinematic:withPhotos?{manifest:cinematicManifest,previews}:null,
  objects, atlasPhotos:withPhotos?atlasPhotos:{},atlasPhotoMeta,photoCatalog,photoMap,
  photo: withPhotos ? photo : {}, photoHD: withPhotos ? undefined : {}, photoHDLengths: withPhotos ? photoHDLengths : undefined, photoHDKeys: Object.keys(photoHD),
  galCloseHD: withPhotos ? galCloseHD : {}, photoKind, hdKeys, mwGaia, mwDust,
  /* 在线轻量版走相对路径，首屏不背这 700 KB */
  skyLmc: withPhotos ? skyLmc : '', skySmc: withPhotos ? skySmc : '',
  skyM42: withPhotos ? skyM42 : ''
})};</script>\n<script>${threeClean}</script>`;

const tag = /<script type="module" src="\.\/js\/app\.js"><\/script>/;
if (!tag.test(html)) throw new Error('index.html 里找不到 app.js 的 script 标签');

// 严格普通函数裸调用：顶层 this 为 undefined，声明不泄漏到 window。
// 只编译不执行；残留静态 import/export、import.meta 或顶层 await 会中止构建。
const classicApp = `(function () {\n'use strict';\n${appOffline}\n})();`;
new Script(classicApp, {filename: 'offline-app.js'});
const buildHtml = (withPhotos) => (withPhotos
  ? html.replace('</head>', () => `<script>${read('js/offline-photo-hd.js')}</script>\n</head>`)
  : html).replace(tag, () => {
  const pack = inlinePack(withPhotos);
  if (!withPhotos) return `${pack}\n<script type="module">\n${appOffline}\n</script>`;
  return `${pack}\n<script>${classicApp}</script>\n${previewBlocks.join('\n')}\n${hdBlocks}\n<script>document.dispatchEvent(new Event('orbit-photo-hd-parsed'))</script>\n${nativeBlocks.join('\n')}\n${cinematicEnd}\n<script id="bhReferenceVideo" type="application/octet-stream">${bhReference}</script>\n<script id="sdoMovie" type="application/octet-stream">${sdoPortable}</script>`;
});

/* 认证组件也内联：space.html 在根目录，没有 ./js/ 子目录 */
const authTag = /<script src="\.\/js\/auth\.js"><\/script>/;
if (authTag.test(html)) {
  let authSrc = '';
  try { authSrc = read('js/auth.js'); } catch (e) { console.warn('auth.js 缺失:', e.message); }
  html = html.replace(authTag, () => `<script>${authSrc}</script>`);
}
/* manifest 由 index.html 里的脚本按协议动态注入（http(s) 才挂），这里不用改 */

const htmlOffline = buildHtml(true);
const htmlHttp = buildHtml(false);
const writeOptions = args.includes('--replace-existing') ? {} : { flag: 'wx' };
fs.writeFileSync(outputs[0], htmlOffline, writeOptions);
fs.writeFileSync(outputs[1], htmlOffline, writeOptions);
fs.writeFileSync(outputs[2], htmlHttp, writeOptions);
const kb = (n) => (n / 1024).toFixed(0) + ' KB';
/* 对话 161：图鉴/资料卡的「天文维基」链接按协议分支（见 public/index.html）。
   不要简单地把 catalog.html 复制到根目录 —— 它内部还要读 js/auth.js 与
   data/*.json，根目录没有这两个目录，复制出来只会得到一个坏页面。 */

console.log('离线 space.html/index.html', kb(Buffer.byteLength(htmlOffline)),
  '· 在线 space-http.html', kb(Buffer.byteLength(htmlHttp)),
  `· 实拍图 ${Object.keys(photo).length} 张 · 档案 ${objects.length} 条`);
