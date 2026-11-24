/* SPACE·1:1 — Service Worker
   目标：装到桌面后能离线跑。
   策略：
   - 文档：**网络优先**，失败回缓存。开发时改了文件立刻生效，不会看到旧版。
   - 其它同源资源：网络优先（后端带 ETag，304 很便宜），失败回缓存。
   对话 64：three 已本地化（js/three.module.min.js），不再请求 unpkg；
     install 逐个 add 并吞掉单项失败，兼容「静态根 = public/」与「静态根 = 项目根」
     两种部署（旧版 addAll 里有个不存在的文件就会导致整批缓存失败）。
   改完入口想强刷缓存，把 VERSION 加一即可。 */
const VERSION = 'space11-v252-black-hole-plate';
const CORE = [
  './',
  './index.html',
  './space.html',
  './js/app.js',
  './js/main-volumes.js',
  './js/observed-galaxy-volume.js',
  './data/atlas-photos/manifest.json',
  './data/atlas-photos/sun.jpg',
  './data/atlas-photos/mercury.jpg',
  './data/atlas-photos/venus.jpg',
  './data/atlas-photos/earth.jpg',
  './data/atlas-photos/mars.jpg',
  './data/atlas-photos/jupiter.jpg',
  './data/atlas-photos/saturn.jpg',
  './data/atlas-photos/uranus.jpg',
  './data/atlas-photos/neptune.jpg',
  './data/atlas-photos/sgra.jpg',
  './data/atlas-photos/m87-eht.jpg',
  './data/lroc_color_4k.webp',
  './data/planet-maps/manifest.json',
  './data/moon-ldem8.bin',
  './data/planet-maps/venus.jpg',
  './data/planet-maps/jupiter.jpg',
  './data/planet-maps/saturn.jpg',
  './data/planet-maps/neptune.jpg',
  './js/gaia-stars.js',
  './js/cosmic-population.js',
  './js/milkyway-fill.js',
  './data/gaia/manifest.json',
  './data/gaia/gaia-dr3.bin',
  './js/galaxy-structure.js',
  './js/cinematic-assets.js',
  './js/cinematic-stars.js',
  './data/cinematic-nebula/manifest.json',
  './data/sun-emission-4k.jpg',
  './data/sky/eso0932a-source.jpg',
  './data/earth-surface-8k.jpg',
  './data/earth-cloudfraction.jpg',
  './js/three.module.min.js',
  './data/earth-terrain.png',
  './data/earth-climate.png',
  './data/earth-biome.png',
  './data/volcanoes.json',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    /* 逐项 add：某一种部署方式下不存在的文件只失败自己那一项，
       不再像 addAll 那样让整批缓存作废；也不会再等 CDN 超时 */
    await Promise.all(CORE.map(u => cache.add(u).catch(() => {})));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (req.headers.has('range') || url.pathname.endsWith('.mp4')) return;
  /* Detail tiles use the browser HTTP cache; do not duplicate unbounded pyramids in CacheStorage. */
  if (url.pathname.includes('/data/deep-tiles/') || url.pathname.includes('/data/deep-source/')) return;

  /* 文档：网络优先 */
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        const res = await fetch(req);
        const cache = await caches.open(VERSION);
        cache.put(req, res.clone());
        return res;
      } catch (err) {
        const hit = await caches.match(req);
        return hit || caches.match('./index.html') || caches.match('./space.html');
      }
    })());
    return;
  }

  /* 静态资源：网络优先（同源），失败回缓存 */
  if (url.origin === location.origin) {
    e.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (res && (res.ok || res.type === 'opaque')) {
          const cache = await caches.open(VERSION);
          cache.put(req, res.clone());
        }
        return res;
      } catch (err) {
        const hit = await caches.match(req);
        return hit || caches.match('./index.html') || caches.match('./space.html');
      }
    })());
  }
});
