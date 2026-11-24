/* SPACE·1:1 — 后端（Node，零依赖）
 *
 * 职责（对话 34 起，前端不再是一个人扛所有东西）：
 *   1. 静态资源宿主：public/ 下的 index.html / app.js / data/*.png，
 *      带 ETag + 304 + gzip。数据图 1.3 MB 不再塞进 HTML，
 *      浏览器可以缓存，改代码也不用重新下载一遍底图。
 *   2. 内容接口：/api/peaks（真实高峰群）、/api/health、/api/stats。
 *      山系高程这类「数据」放在后端，前端只管渲染；改数据不用重新构建客户端。
 *   3. 桌面单文件版仍然保留：`npm run build` 把 public/ 内联回 space.html。
 *
 * 用法：node server/server.mjs [--port 8132] [--host 127.0.0.1]
 */
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { loadCatalog } from './object-catalog.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUB = path.join(ROOT, 'public');
const PORT = Number(process.argv.find((a) => a.startsWith('--port='))?.slice(7)
  || process.argv[process.argv.indexOf('--port') + 1]) || 8132;
const HOST = process.argv.find((a) => a.startsWith('--host='))?.slice(7)
  || (process.argv.includes('--host') ? process.argv[process.argv.indexOf('--host') + 1] : '127.0.0.1');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8'
};
const TEXTY = /^(text\/|application\/(json|manifest\+json|javascript))/;

const started = Date.now();
let stats = { hits: 0, bytes: 0, api: 0 };

/* ---------- 工具 ---------- */
function etagOf(st) { return `W/"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`; }

function sendJson(res, code, obj, extra = {}) {
  const body = Buffer.from(JSON.stringify(obj));
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': body.length,
    'cache-control': 'no-store',
    ...extra
  });
  res.end(body);
  stats.api++;
}

async function readJson(rel, fallback) {
  try { return JSON.parse(await fsp.readFile(path.join(PUB, rel), 'utf8')); }
  catch { return fallback; }
}

/* ---------- 静态 ---------- */
async function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/favicon.ico') rel = '/icon-192.png';   /* 浏览器默认请求，别让它刷 404 */
  if (rel.endsWith('/')) rel += 'index.html';
  /* Built HTTP entry shares public/data with the detail viewer; never serve arbitrary ROOT paths. */
  const builtEntry = rel === '/space.html';
  const file = builtEntry ? path.join(ROOT, 'space-http.html')
    : path.resolve(PUB, '.' + path.normalize(rel));
  if (!builtEntry && file !== PUB && !file.startsWith(PUB + path.sep)) {
    res.writeHead(403).end('forbidden'); return;
  }

  let st;
  try { st = await fsp.stat(file); } catch { res.writeHead(404, { 'content-type': 'text/plain' }).end('404'); return; }
  if (st.isDirectory()) { res.writeHead(302, { location: rel.replace(/\/?$/, '/') }).end(); return; }

  const etag = etagOf(st);
  const inm = req.headers['if-none-match'];
  if (inm && inm === etag) { res.writeHead(304, { etag, 'cache-control': 'public, max-age=0, must-revalidate' }).end(); return; }

  const ext = path.extname(file).toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';
  /* 数据图变了文件名不变，所以走 must-revalidate + ETag；js/html 同理，避免改完看不到新版 */
  const cache = 'public, max-age=0, must-revalidate';

  if (ext === '.mp4') {
    const head = { 'content-type': type, 'accept-ranges': 'bytes', etag, 'cache-control': cache };
    let start = 0, end = st.size - 1, code = 200;
    if (req.headers.range) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
      if (m && m[1]) { start = Number(m[1]); if (m[2]) end = Math.min(end, Number(m[2])); }
      else if (m && Number(m[2]) > 0) start = Math.max(0, st.size - Number(m[2]));
      else start = st.size;
      if (start > end) { res.writeHead(416, { ...head, 'content-range': `bytes */${st.size}` }).end(); return; }
      code = 206; head['content-range'] = `bytes ${start}-${end}/${st.size}`;
    }
    res.writeHead(code, { ...head, 'content-length': end - start + 1 });
    if (req.method === 'HEAD') { res.end(); return; }
    const stream = fs.createReadStream(file, { start, end });
    stream.on('error', () => res.destroy());
    res.on('close', () => stream.destroy());
    stream.pipe(res);
    return;
  }

  const gz = TEXTY.test(type) && /\bgzip\b/.test(req.headers['accept-encoding'] || '') && st.size > 1024;
  const head = {
    'content-type': type,
    etag,
    'cache-control': cache,
    'x-content-type-options': 'nosniff'
  };
  if (gz) head['content-encoding'] = 'gzip';

  if (req.method === 'HEAD') { res.writeHead(200, head); res.end(); return; }

  const buf = await fsp.readFile(file);
  const out = gz ? zlib.gzipSync(buf, { level: 6 }) : buf;
  head['content-length'] = out.length;
  res.writeHead(200, head);
  res.end(out);
  stats.hits++; stats.bytes += out.length;
}

/* ---------- 路由 ---------- */
const server = http.createServer(async (req, res) => {
  const t0 = process.hrtime.bigint();
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (req.method === 'OPTIONS') { res.writeHead(204).end(); return; }

    if (url.pathname === '/api/objects') {
      const page = Math.max(1, Math.floor(Number(url.searchParams.get('page')) || 1));
      const size = Math.min(200, Math.max(1, Math.floor(Number(url.searchParams.get('size')) || 200)));
      const rows = await loadCatalog();
      return sendJson(res, 200, { data: { records: rows.slice((page - 1) * size, page * size), total: rows.length, page, size } });
    }

    if (url.pathname === '/api/health') {
      return sendJson(res, 200, {
        ok: true,
        name: 'space-1to1',
        version: '34',
        uptimeSec: Math.round((Date.now() - started) / 1000),
        node: process.version,
        hits: stats.hits,
        bytesOut: stats.bytes
      });
    }

    if (url.pathname === '/api/peaks') {
      /* 真实高峰群：山系高程的数据源。前端拿它把 4~5 km 的山抬到真实量级。
         失败时返回空表，前端会退回纯程序化山脊（不会崩）。 */
      const data = await readJson('data/peaks.json', { peaks: [] });
      return sendJson(res, 200, data, { 'cache-control': 'public, max-age=3600' });
    }

    if (url.pathname === '/api/stats') {
      const walk = async (dir) => {
        const out = [];
        for (const e of await fsp.readdir(dir, { withFileTypes: true })) {
          const p = path.join(dir, e.name);
          if (e.isDirectory()) out.push(...await walk(p));
          else {
            const s = await fsp.stat(p);
            out.push({ file: path.relative(PUB, p).replace(/\\/g, '/'), bytes: s.size });
          }
        }
        return out;
      };
      const files = await walk(PUB);
      const total = files.reduce((a, b) => a + b.bytes, 0);
      return sendJson(res, 200, { total, files: files.sort((a, b) => b.bytes - a.bytes) });
    }

    if (url.pathname.startsWith('/api/')) return sendJson(res, 404, { error: 'no such endpoint' });

    await serveStatic(req, res, url);
  } catch (err) {
    if (!res.headersSent) sendJson(res, 500, { error: String(err && err.message || err) });
    else res.end();
  } finally {
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    if (!url.pathname.startsWith('/icon')) {
      console.log(`${String(res.statusCode).padEnd(3)} ${ms.toFixed(1).padStart(6)}ms  ${req.method} ${url.pathname}`);
    }
  }
});

server.listen(PORT, HOST, () => {
  console.log(`SPACE·1:1 backend  http://${HOST}:${PORT}/   (public: ${path.relative(ROOT, PUB)})`);
  console.log('  GET /api/health   GET /api/peaks   GET /api/stats');
});
