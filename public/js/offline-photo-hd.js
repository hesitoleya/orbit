// 仅由离线构建插入。不扫描图库，也不缓存大字符串。解析器越过整组后唤醒提前请求。
(function () {
  'use strict';
  let finish;
  const parsed = new Promise(resolve => { finish = resolve; });
  document.addEventListener('orbit-photo-hd-parsed', finish, {once:true});
  document.addEventListener('DOMContentLoaded', finish, {once:true});
  function peek(key) {
    const sizes = window.__ORBIT_INLINE__?.photoHDLengths;
    if (!sizes || !Object.hasOwn(sizes, key)) return '';
    const node = document.getElementById('orbit-photo-hd-' + key);
    // 解析中的 script 元素可能已可见，但正文尚未写齐。
    if (!node || node.type !== 'application/octet-stream') return '';
    const text = node.textContent;
    return text.length === sizes[key] ? 'data:image/jpeg;base64,' + text : '';
  }
  async function read(key, current = () => true) {
    if (!current()) return '';
    const url = peek(key);
    if (url) return url;
    if (document.readyState === 'loading') await parsed;
    return current() ? peek(key) : '';
  }
  window.OrbitPackedHD = Object.freeze({peek, read, parsed});
})();
