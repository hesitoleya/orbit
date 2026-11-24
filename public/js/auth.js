/* =============================================================================
   ORBIT 统一认证组件（登录 / 注册 / 在线心跳）
   -----------------------------------------------------------------------------
   为什么要独立成一个文件：门户、三维宇宙、天体维基三个页面都要用同一套身份，
   早期只在档案库页面里写了一份登录框，三维页面里点收藏根本没有入口，
   「注册」也因此看起来像没实现。这里统一挂到 window.OrbitAuth。

   特性：
     · 登录 / 注册双 Tab，注册含昵称、邮箱、确认密码
     · 右上角关闭按钮 ×、ESC、点击遮罩三种关闭方式
     · 每 30 秒上报心跳，服务端据此累计在线时长并判定在线状态
     · 页面关闭 / 切换后台时用 keepalive 上报登出，保证时长结算准确
     · 网页只产生普通用户；管理员身份由代码与数据库维护
   ============================================================================= */
(function () {
  'use strict';

  var KEY = 'orbit_token';
  var listeners = [];
  var token = localStorage.getItem(KEY) || '';
  var user = null;
  var heartbeatTimer = null;
  var mode = 'login';
  var busy = false;
  var returnFocus = null;

  // Auth is also used by catalog.html, where the scene's shared helper is absent.
  function dialogKeys(e, box) {
    if (!box || !box.classList.contains('on')) return;
    if (window.OrbitModalKeys) { window.OrbitModalKeys(e, box, close); return; }
    if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); close(); return; }
    if (e.key === 'Tab') {
      var items = Array.prototype.slice.call(box.querySelectorAll('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]')).filter(function(x){ return x.getClientRects().length; });
      var first=items[0], last=items[items.length-1], active=document.activeElement;
      if (first && (!box.contains(active) || (e.shiftKey ? active===first : active===last))) {
        e.preventDefault(); (e.shiftKey ? last : first).focus();
      }
    }
    e.stopPropagation();
  }

  /* ---------------------------------------------------------------- 样式 */
  var css = `
  .oa-mask{position:fixed;inset:0;z-index:9000;background:rgba(2,5,9,.76);
    display:none;align-items:center;justify-content:center;backdrop-filter:blur(6px);
    font-family:-apple-system,"Segoe UI",system-ui,"PingFang SC","Microsoft YaHei",sans-serif}
  .oa-mask.on{display:flex}
  .oa-box{position:relative;box-sizing:border-box;width:min(392px,92vw);max-height:calc(100vh - 24px);max-height:calc(100dvh - 24px);overflow-y:auto;overscroll-behavior:contain;touch-action:pan-y;padding:26px 26px 22px;border-radius:16px;
    border:1px solid rgba(158,205,215,.18);color:#dcecf2;
    background:linear-gradient(160deg,rgba(14,24,33,.98),rgba(5,9,14,.99));
    box-shadow:0 26px 80px rgba(0,0,0,.7)}
  .oa-close{position:absolute;right:12px;top:10px;width:30px;height:30px;border-radius:8px;
    border:1px solid transparent;background:none;color:#6e8b98;font-size:21px;line-height:1;
    cursor:pointer;transition:.15s}
  .oa-close:hover{color:#eaf7fb;border-color:rgba(94,234,212,.35);background:rgba(94,234,212,.08)}
  .oa-box h2{margin:0 0 3px;font-size:17px;font-weight:600;letter-spacing:.03em}
  .oa-box .oa-sub{margin:0 0 18px;font-size:11.5px;color:#5d7784;line-height:1.7}
  .oa-tabs{display:flex;gap:4px;padding:3px;border-radius:9px;background:rgba(255,255,255,.04);
    border:1px solid rgba(158,205,215,.10);margin-bottom:16px}
  .oa-tabs button{flex:1;padding:7px 0;border:0;border-radius:7px;background:none;color:#7f9daa;
    font:inherit;font-size:12.5px;cursor:pointer;transition:.15s}
  .oa-tabs button.on{background:rgba(94,234,212,.15);color:#8df0dc;box-shadow:inset 0 0 0 1px rgba(94,234,212,.3)}
  .oa-box label{display:block;font-size:11px;color:#6d8c99;margin:0 0 5px;letter-spacing:.04em}
  .oa-box input{width:100%;box-sizing:border-box;margin-bottom:12px;padding:9px 11px;border-radius:8px;
    border:1px solid rgba(158,205,215,.16);background:rgba(255,255,255,.045);color:#e6f5fa;
    font:inherit;font-size:13px;outline:none;transition:.15s}
  .oa-box input:focus{border-color:rgba(94,234,212,.55);background:rgba(94,234,212,.045)}
  .oa-box input::placeholder{color:#46606c}
  .oa-submit{width:100%;padding:10px 0;border-radius:9px;cursor:pointer;font:inherit;font-size:13px;
    border:1px solid rgba(94,234,212,.5);background:rgba(94,234,212,.16);color:#9bf3e0;transition:.15s}
  .oa-submit:hover{background:rgba(94,234,212,.26)}
  .oa-submit:disabled{opacity:.55;cursor:wait}
  .oa-msg{min-height:17px;margin-top:10px;font-size:11.5px;color:#f0b060;line-height:1.5}
  .oa-foot{margin-top:6px;font-size:10.5px;color:#4b6672;line-height:1.7;text-align:center}
  .oa-user{position:fixed;z-index:8900;display:none;min-width:180px;padding:8px;border-radius:10px;
    border:1px solid rgba(158,205,215,.18);background:rgba(10,20,28,.97);box-shadow:0 14px 40px rgba(0,0,0,.6);
    font-family:-apple-system,"Segoe UI",system-ui,"PingFang SC","Microsoft YaHei",sans-serif}
  .oa-user.on{display:block}
  .oa-user .n{padding:6px 9px 9px;font-size:12px;color:#dcecf2;border-bottom:1px solid rgba(158,205,215,.1)}
  .oa-user .n i{display:block;font-style:normal;font-size:10px;color:#5d7784;margin-top:2px}
  .oa-user button{width:100%;margin-top:6px;padding:7px 9px;border:0;border-radius:7px;background:none;
    color:#9fc0cd;font:inherit;font-size:12px;text-align:left;cursor:pointer}
  .oa-user button:hover{background:rgba(94,234,212,.1);color:#9bf3e0}
  `;

  /* ---------------------------------------------------------------- DOM */
  function mount() {
    if (document.getElementById('oaMask')) return;
    var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

    var mask = document.createElement('div');
    mask.className = 'oa-mask'; mask.id = 'oaMask';
    mask.innerHTML =
      '<div class="oa-box" role="dialog" aria-modal="true" aria-label="登录或注册">' +
        '<button class="oa-close" id="oaClose" aria-label="关闭" title="关闭">×</button>' +
        '<h2>登录 ORBIT</h2>' +
        '<p class="oa-sub">收藏天体、记录观测日志、查看「此刻天空」需要登录。<br>没有账号？切到「注册」即可创建，注册后自动登录。</p>' +
        '<div class="oa-tabs"><button id="oaTabLogin" class="on">登录</button><button id="oaTabReg">注册</button></div>' +
        '<form id="oaForm" autocomplete="on">' +
          '<label for="oaU">用户名</label>' +
          '<input id="oaU" name="username" placeholder="3~20 位字母、数字或下划线" autocomplete="username" required>' +
          '<div id="oaExtra" style="display:none">' +
            '<label for="oaNick">昵称（选填）</label>' +
            '<input id="oaNick" placeholder="展示给其他观测者，留空则用用户名">' +
            '<label for="oaMail">邮箱（选填）</label>' +
            '<input id="oaMail" type="email" placeholder="用于找回账号">' +
          '</div>' +
          '<label for="oaP">密码</label>' +
          '<input id="oaP" name="password" type="password" placeholder="至少 6 位" autocomplete="current-password" required>' +
          '<div id="oaExtra2" style="display:none">' +
            '<label for="oaP2">确认密码</label>' +
            '<input id="oaP2" type="password" placeholder="再输入一次" autocomplete="new-password">' +
          '</div>' +
          '<button class="oa-submit" id="oaGo" type="submit">登录</button>' +
        '</form>' +
        '<div class="oa-msg" id="oaMsg"></div>' +
        '<div class="oa-foot">普通用户注册 · 管理维护由代码与数据库完成</div>' +
      '</div>';
    document.body.appendChild(mask);

    var menu = document.createElement('div');
    menu.className = 'oa-user'; menu.id = 'oaUserMenu';
    menu.innerHTML = '<div class="n" id="oaMenuName"></div>' +
      '<button id="oaMenuLogout">退出登录</button>';
    document.body.appendChild(menu);

    document.getElementById('oaClose').onclick = close;
    mask.addEventListener('mousedown', function (e) { if (e.target === mask) close(); });
    document.addEventListener('keydown', function (e) {
      if (mask.classList.contains('on')) { dialogKeys(e, mask); return; }
      if (e.key === 'Escape' && menu.classList.contains('on')) { hideMenu(); e.stopImmediatePropagation(); }
    });
    document.getElementById('oaTabLogin').onclick = function () { setMode('login'); };
    document.getElementById('oaTabReg').onclick = function () { setMode('register'); };
    document.getElementById('oaForm').onsubmit = submit;
    document.getElementById('oaMenuLogout').onclick = function () { hideMenu(); logout(); };
    document.addEventListener('click', function (e) {
      if (!menu.contains(e.target) && !e.target.closest('[data-auth-btn]')) hideMenu();
    });
  }

  function setMode(m) {
    mode = m;
    var login = m === 'login';
    document.getElementById('oaTabLogin').classList.toggle('on', login);
    document.getElementById('oaTabReg').classList.toggle('on', !login);
    document.getElementById('oaExtra').style.display = login ? 'none' : 'block';
    document.getElementById('oaExtra2').style.display = login ? 'none' : 'block';
    document.getElementById('oaGo').textContent = login ? '登录' : '注册并登录';
    document.querySelector('.oa-box h2').textContent = login ? '登录 ORBIT' : '创建观测账号';
    document.getElementById('oaP').autocomplete = login ? 'current-password' : 'new-password';
    document.getElementById('oaMsg').textContent = '';
  }

  function open(m) {
    mount(); var mask=document.getElementById('oaMask');
    if (!mask.classList.contains('on')) returnFocus=document.activeElement;
    setMode(m || 'login'); mask.classList.add('on');
    setTimeout(function () { if (mask.classList.contains('on')) document.getElementById('oaU').focus(); }, 40);
  }
  function close() {
    var m = document.getElementById('oaMask');
    if (!m || !m.classList.contains('on')) return;
    m.classList.remove('on');
    if (returnFocus && returnFocus.isConnected && returnFocus.focus) returnFocus.focus();
  }

  /* ---------------------------------------------------------------- 请求 */
  function headers(json) {
    var h = {};
    if (json) h['Content-Type'] = 'application/json';
    if (token) h.Authorization = 'Bearer ' + token;
    return h;
  }
  function api(path, opt) {
    opt = opt || {};
    var o = { headers: headers(opt.body !== undefined), method: opt.method || 'GET' };
    if (opt.body !== undefined) o.body = typeof opt.body === 'string' ? opt.body : JSON.stringify(opt.body);
    if (opt.keepalive) o.keepalive = true;
    return fetch(path, o).then(function (r) { return r.json().catch(function () { throw new Error('服务未响应（HTTP ' + r.status + '）'); }); })
      .then(function (j) {
        if (j.code === 401) { clear(); }
        if (j.code !== 0) throw new Error(j.msg || ('错误 ' + j.code));
        return j.data;
      });
  }

  function submit(e) {
    e.preventDefault();
    if (busy) return;
    var u = document.getElementById('oaU').value.trim();
    var p = document.getElementById('oaP').value;
    var msg = document.getElementById('oaMsg');
    msg.textContent = '';
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(u)) { msg.textContent = '用户名需 3~20 位字母、数字或下划线'; return; }
    if (p.length < 6) { msg.textContent = '密码至少 6 位'; return; }
    var body = { username: u, password: p };
    if (mode === 'register') {
      var p2 = document.getElementById('oaP2').value;
      if (p !== p2) { msg.textContent = '两次输入的密码不一致'; return; }
      var nick = document.getElementById('oaNick').value.trim();
      var mail = document.getElementById('oaMail').value.trim();
      if (nick) body.nickname = nick;
      if (mail) body.email = mail;
    }
    busy = true;
    var btn = document.getElementById('oaGo'); btn.disabled = true; btn.textContent = '请稍候…';
    api('/api/auth/' + (mode === 'login' ? 'login' : 'register'), { method: 'POST', body: body })
      .then(function (d) {
        token = d.token; user = d.user;
        localStorage.setItem(KEY, token);
        close(); startHeartbeat(); notify();
        toast('欢迎，' + (user.nickname || user.username));
      })
      .catch(function (err) { msg.textContent = err.message || '操作失败'; })
      .finally(function () { busy = false; btn.disabled = false; setMode(mode); });
  }

  function clear() {
    token = ''; user = null;
    localStorage.removeItem(KEY);
    stopHeartbeat(); notify();
  }
  function logout() {
    if (token) {
      api('/api/auth/logout', { method: 'POST', keepalive: true }).catch(function () {});
    }
    clear(); toast('已退出登录');
  }
  function requireLogin() { if (!token || !user) { open('login'); return false; } return true; }

  /* ---------------------------------------------------------------- 心跳 */
  function startHeartbeat() {
    stopHeartbeat();
    if (!token) return;
    var beat = function () { api('/api/auth/heartbeat', { method: 'POST' }).catch(function () {}); };
    beat();
    heartbeatTimer = setInterval(beat, 30000);
  }
  function stopHeartbeat() { if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; } }

  /* 页面隐藏 / 关闭时结算本次在线时长 */
  window.addEventListener('pagehide', function () {
    if (!token) return;
    try {
      fetch('/api/auth/logout', { method: 'POST', keepalive: true, headers: headers(false) }).catch(function () {});
    } catch (e) {}
  });
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && token) api('/api/auth/heartbeat', { method: 'POST' }).catch(function () {});
  });

  /* ---------------------------------------------------------------- 按钮 */
  function hideMenu() { var m = document.getElementById('oaUserMenu'); if (m) m.classList.remove('on'); }
  function showMenu(anchor) {
    var m = document.getElementById('oaUserMenu'); if (!m) return;
    document.getElementById('oaMenuName').innerHTML =
      '<span>' + escapeHtml(user ? (user.nickname || user.username) : '') + '</span><i>' +
      (user ? escapeHtml(user.username) : '') + ' · 普通观测者</i>';
    var r = anchor.getBoundingClientRect();
    m.style.top = Math.min(window.innerHeight - 110, r.bottom + 8) + 'px';
    m.style.left = Math.max(8, Math.min(window.innerWidth - 200, r.right - 190)) + 'px';
    m.classList.add('on');
  }
  function paintButtons() {
    document.querySelectorAll('[data-auth-btn]').forEach(function (b) {
      b.textContent = user ? (user.nickname || user.username) : (b.dataset.authLabel || '登录 / 注册');
      b.classList.toggle('logged', !!user);
      b.onclick = function (e) {
        e.stopPropagation();
        if (user) { var m = document.getElementById('oaUserMenu'); m.classList.contains('on') ? hideMenu() : showMenu(b); }
        else open('login');
      };
    });
  }
  function notify() { paintButtons(); listeners.forEach(function (f) { try { f(user, token); } catch (e) {} }); }
  function toast(text) {
    if (window.OrbitAuth.onToast) { window.OrbitAuth.onToast(text); return; }
    var t = document.createElement('div');
    t.textContent = text;
    t.style.cssText = 'position:fixed;left:50%;bottom:34px;transform:translateX(-50%);z-index:9500;' +
      'padding:9px 18px;border-radius:9px;background:rgba(10,26,32,.96);border:1px solid rgba(158,205,215,.2);' +
      'color:#cfe6ee;font:12px system-ui;box-shadow:0 8px 30px rgba(0,0,0,.5)';
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 2100);
  }
  function escapeHtml(s) { return String(s || '').replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  /* ---------------------------------------------------------------- 启动 */
  window.OrbitAuth = {
    open: open, close: close, logout: logout, api: api,
    requireLogin: requireLogin,
    user: function () { return user; },
    token: function () { return token; },
    isLogin: function () { return !!token; },
    onChange: function (f) { listeners.push(f); if (user) f(user, token); },
    onToast: null
  };

  function boot() {
    mount(); paintButtons();
    if (!token) return;
    api('/api/auth/me').then(function (u) { user = u; notify(); startHeartbeat(); })
      .catch(function () { clear(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
