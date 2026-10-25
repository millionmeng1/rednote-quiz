/* 主流程：密码入口 → 答题（可回退）→ 结果 → 长图 / 分享 / 再测 / 好评有礼 */
(function () {
  'use strict';
  var QD = window.QD, QZ = window.QZ, PO = window.PO;
  var N = QD.QUESTIONS.length;
  var ua = navigator.userAgent || '';
  var isMobile = /Android|iPhone|iPad|iPod|HarmonyOS|Mobile|MicroMessenger/i.test(ua);
  var isWeChat = /MicroMessenger/i.test(ua);

  /* ---------------- 免卡密版：通用口令 ----------------
     这一版不做「一单一码」。所有买家拿到的都是同一个通用口令，而且口令直接
     写在链接里（?k=LEI-TEST-2026）—— 点开就自动验证、直接进答题，一个字都不用输。

     为什么敢这么干：口令在库里是 unlimited（永久码），不消耗、不登记「已用」，
     所以同一条链接被多少人点开都不会互相挤掉。代价是口令会随链接一起被转发出去，
     这是这套模式本来就认的账 —— 换来的是彻底不需要第三方发码工具。

     拿不到 k（有人手敲了裸域名进来）也不拦死：下面 gate 那一屏还留着输入框，
     只是文案从「请输入测试密码」换成了「请输入口令」。 */
  var PUBLIC_CODE = String(window.PUBLIC_CODE || '').trim();

  /* 从地址栏读口令。小红书 / 微信的内置浏览器偶尔会吃掉大小写，统一转大写。 */
  function codeFromUrl() {
    try {
      var m = /(?:^|[?&])k=([^&#]*)/i.exec(location.search || '');
      if (!m) return '';
      return decodeURIComponent(m[1] || '').trim().toUpperCase();
    } catch (e) { return ''; }
  }

  /* 读地址栏参数（通用版）。分享链接以前用 hash（#/r/xxxx），
     小红书 / 微信的内置浏览器转发时会把 # 后面的整段吃掉，链接发出去
     就成了裸域名 —— 打开直接落在口令屏，看起来像「分享功能是坏的」。
     所以分享链接改用查询串 ?r=，转发时不会被截。旧 hash 链接照样认。 */
  function qsGet(key) {
    try {
      var m = new RegExp('(?:^|[?&])' + key + '=([^&#]*)', 'i').exec(location.search || '');
      return m ? decodeURIComponent(m[1] || '').trim() : '';
    } catch (e) { return ''; }
  }

  /* ---------------- 小工具 ---------------- */
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  var toastTimer = null;
  function toast(msg, ms) {
    var old = document.querySelector('.toast');
    if (old) old.parentNode.removeChild(old);
    var d = document.createElement('div');
    d.className = 'toast';
    d.textContent = msg;
    document.body.appendChild(d);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { if (d.parentNode) d.parentNode.removeChild(d); }, ms || 2200);
  }
  function showLoading(t) {
    hideLoading();
    var d = document.createElement('div');
    d.className = 'loading';
    d.id = 'loadingBox';
    d.innerHTML = '<div class="spin"></div><div class="lt">' + esc(t || '处理中…') + '</div>';
    document.body.appendChild(d);
  }
  function hideLoading() {
    var d = $('loadingBox');
    if (d && d.parentNode) d.parentNode.removeChild(d);
  }
  function legacyCopy(s) {
    var ta = document.createElement('textarea');
    ta.value = s; ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    try { ta.setSelectionRange(0, s.length); } catch (e) { }
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { }
    document.body.removeChild(ta);
    return ok;
  }
  function copyText(s) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(s).then(function () { return true; }, function () { return legacyCopy(s); });
    }
    return Promise.resolve(legacyCopy(s));
  }
  /* ---------------- 后端调用 ----------------
     原来这些请求是打给本机 Node 服务的 /api/*。现在整站是纯静态的（部署在
     GitHub Pages 上），后端换成了 Supabase。为了不改动下面几百行业务代码，
     这里保留 api(path, opts) 这个入口，内部把每个 path 路由到数据库函数。

     安全性说明：前端拿到的 anon key 是公开的、可以被改的，所以真正的防线不在
     前端，而在数据库 —— 所有表都对前端关闭（RLS + 收回权限），前端只能调用
     下面这几个函数；「一个密码只能测一次」的裁决也是在数据库里做的。 */
  var BE = window.SB;
  var ROUTES = {
    '/api/config': function () {
      return BE.rpc('public_config', {});
    },
    '/api/redeem': function (b) {
      return BE.rpc('redeem', {
        p_code: b.code,
        p_token: b.token || null,
        p_device: BE.device()
      });
    },
    '/api/session': function (b) {
      return BE.rpc('session', { p_token: b.token });
    },
    '/api/share': function (b) {
      return BE.rpc('save_result', {
        p_token: b.token,
        p_answers: b.answers,
        p_main: (S.an && S.an.mainKey) || null,
        p_index: (S.an && S.an.index) != null ? S.an.index : null
      });
    },
    '/api/retest': function (b) {
      return BE.rpc('can_retest', { p_token: b.token });
    }
  };

  function api(path, opts) {
    opts = opts || {};
    if (!BE || !BE.ready) {
      return Promise.resolve({ ok: false, error: 'config', message: '站点还没连上数据库，请联系店主。' });
    }
    /* 分享页带查询串，单独处理 */
    if (path.indexOf('/api/shared') === 0) {
      var m = /[?&]c=([^&]*)/.exec(path);
      return BE.rpc('get_shared', { p_share: m ? decodeURIComponent(m[1]) : '' });
    }
    var fn = ROUTES[path];
    if (!fn) return Promise.resolve({ ok: false, error: 'route', message: '未知接口。' });
    return fn(opts.body || {});
  }
  function download(url, name) {
    var a = document.createElement('a');
    a.href = url; a.download = name; a.rel = 'noopener';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { if (a.parentNode) a.parentNode.removeChild(a); }, 100);
  }

  /* ---------------- 状态 ---------------- */
  var CFG = { shopName: '', quizTitle: '', kefuWechat: '', cashback: '0.5', buyUrl: '', buyText: '' };
  /* 后端被确认有问题时（库没初始化、anon key 填错）在这里留一句话，
     在密码页顶部提示买家 —— 而不是让他输完密码才碰壁。 */
  var SB_PROBLEM = '';
  var S = {
    token: null, answers: new Array(N).fill(0), idx: 0,
    an: null, share: null, link: null, img: null,
    checked: {}, mode: 'own', authed: false,
    resultAt: null,
    /* 本次会话已经交过卷 —— 结果页据此不再给「再测一次」（一个密码只测一次） */
    finished: false,
    /* 店主自己的永久测试码：允许反复完整体验（前台唯一豁免） */
    unlimited: false,
    /* 这份结果是从本机调出来的旧结果（不是刚答完的）—— 顶部要挂说明 */
    restored: false, restoredAt: null
  };
  var K_TOKEN = 'lei_token_v1', K_RESULT = 'lei_result_v1', K_PROG = 'lei_prog_v1';
  var K_UNL = 'lei_unl_v1';
  var PROG_TTL = 6 * 3600 * 1000;

  function saveResult() {
    try {
      localStorage.setItem(K_RESULT, JSON.stringify({
        a: S.answers, s: S.share, c: S.checked, m: S.an ? S.an.mainKey : null, t: Date.now()
      }));
    } catch (e) { }
  }
  function readResult() {
    try {
      var o = JSON.parse(localStorage.getItem(K_RESULT) || 'null');
      if (o && o.a && o.a.length === N) return o;
    } catch (e) { }
    return null;
  }

  /* 答题进度：手机上切到后台被系统回收、或者误触返回，回来不用从第 1 题重答 */
  function saveProgress() {
    try { localStorage.setItem(K_PROG, JSON.stringify({ a: S.answers, i: S.idx, t: Date.now() })); } catch (e) { }
  }
  function readProgress() {
    try {
      var o = JSON.parse(localStorage.getItem(K_PROG) || 'null');
      if (o && o.a && o.a.length === N && o.t && (Date.now() - o.t) < PROG_TTL) return o;
    } catch (e) { }
    return null;
  }
  function clearProgress() { try { localStorage.removeItem(K_PROG); } catch (e) { } }

  /* ---------------- 视图切换 ---------------- */
  var VIEWS = ['view-gate', 'view-landing', 'view-quiz', 'view-result'];
  function show(id) {
    VIEWS.forEach(function (v) { var e = $(v); if (e) e.classList.add('hide'); });
    var t = $(id);
    if (t) t.classList.remove('hide');
    $('shell').classList.toggle('hasbar', id === 'view-result' && S.mode === 'own');
  }

  /* 店铺 / 搜索关键词：后台没填店铺名时退回商品名，保证搜得到 */
  function shopKey() {
    var s = CFG.shopName && String(CFG.shopName).indexOf('请到管理后台') < 0 ? String(CFG.shopName) : '';
    return s || '疲惫类型自测';
  }

  /* 购买入口。之前只有后台填了商品链接（buyUrl）才会出现，链接一空就整块消失
     —— 扫长图二维码进来的人满屏只有一个密码框，不知道去哪儿买。
     现在不管有没有链接都给一块卡片：有链接直接跳商品页，没链接点开弹窗，
     把「去小红书搜什么、密码发到哪儿」一步步讲清楚。 */
  function buyHTML() {
    var go = CFG.buyUrl
      ? '<a class="btn gold sm" style="text-decoration:none;display:block;text-align:center;max-width:320px;margin:0 auto"'
        + ' href="' + esc(CFG.buyUrl) + '" target="_blank" rel="noopener">'
        + esc(CFG.buyText || '去小红书拍一份 →') + '</a>'
      : '<button class="btn gold sm" id="buyBtn" type="button" style="max-width:320px;margin:0 auto">'
        + '去小红书拍一份 →</button>';
    return '<div class="buycard">'
      + '<div class="bct">还没有开测口令？</div>'
      + go
      + '<div class="bcs">拍下自动发货，开测链接直接发到小红书订单里，点开就能测</div>'
      + '</div>';
  }
  function bindBuy() {
    var b = $('buyBtn') || $('barBuyBtn') || $('mBuyBtn');
    if (b) b.onclick = openBuyModal;
  }

  /* 扫码直达购买。
     扫长图 / 笔记图二维码进来的人，本来就是想买自己的一份 —— 以前他先落到
     密码框那一屏，要自己找到按钮再点一次，这一步会掉不少人。
     现在只要后台配了商品链接，进门直接送商品页，中间不插「去小红书搜」。
     留一屏兜底（含可点按钮）是因为微信 / 小红书内置浏览器偶尔会拦脚本跳转。 */
  function goBuy(auto) {
    var v = $('view-gate');
    if (v) {
      v.innerHTML =
        '<div class="brand">' + esc(CFG.shopName || '疲惫类型自测') + '</div>'
        + '<h1>' + esc(CFG.quizTitle || '你现在的累，是哪一种累？') + '</h1>'
        + '<p class="lead">正在打开小红书商品页…</p>'
        + '<a class="btn gold" style="text-decoration:none;display:block;text-align:center;max-width:320px;margin:18px auto 0"'
        + ' href="' + esc(CFG.buyUrl) + '" rel="noopener">'
        + esc(CFG.buyText || '去小红书拍一份 →') + '</a>'
        + '<div class="buytip dim">没自动跳转，就点上面这个按钮</div>';
      show('view-gate');
    }
    if (auto) {
      setTimeout(function () { try { location.href = CFG.buyUrl; } catch (e) { } }, 600);
    }
  }

  /* 只自动跳一次。否则买家从商品页按返回键回到这里，又会被送走，来回弹。 */
  function qrJumped() {
    try { return sessionStorage.getItem('lei_qrjump_v1') === '1'; } catch (e) { return false; }
  }
  function markQrJump() {
    try { sessionStorage.setItem('lei_qrjump_v1', '1'); } catch (e) { }
  }
  function openBuyModal() {
    var key = shopKey();
    var h = '<p>拍下之后不用等、不用输密码 —— 订单里会直接给你一条开测链接，点开就是题目。</p>'
      + '<ol class="steps">'
      + '<li>打开小红书 App，搜索「' + esc(key) + '」；</li>'
      + '<li>找到这个测评，拍下付款；</li>'
      + '<li>付款后自动发货，开测链接发到你的订单里；</li>'
      + '<li>点那条链接，直接开始测。</li>'
      + '</ol>'
      + '<button class="btn line" id="mCopyKey" type="button">复制搜索词「' + esc(key) + '」</button>';
    openInfoModal('怎么拿到开测链接', h);
    var cb = $('mCopyKey');
    if (cb) {
      cb.onclick = function () {
        copyText(key).then(function (ok) {
          toast(ok ? '已复制「' + key + '」，去小红书搜索框粘贴'
            : '复制没成功，手动搜：' + key, 3000);
        });
      };
    }
  }

  /* 扫码来源：长图右下角那个二维码带 ?f=qr。扫进来的人是看了朋友的结果、
     想测自己 —— 认出来之后，第一屏就告诉他自己的那份怎么拿。 */
  function fromQR() {
    try {
      if (/(?:^|[?&])f=qr(?:&|$)/.test(location.search || '')) {
        try { sessionStorage.setItem('lei_fromqr_v1', '1'); } catch (e) { }
        return true;
      }
      return sessionStorage.getItem('lei_fromqr_v1') === '1';
    } catch (e) { return false; }
  }
  function qrChipHTML() {
    return '<div class="qrchip">你扫到的是别人的测评结果 —— 想测自己的那份？'
      + '下面这个按钮点一下，就知道去哪儿拍。</div>';
  }
  /* 客服入口：买家是在小红书店铺下的单，客服就在小红书里。
     这里不再给微信号、也不再复制任何东西 —— 只告诉他去哪儿找人。
     带一句站内路径，是因为大部分人不知道订单页里就有客服入口。 */
  var KEFU_GUIDE =
      '<ol class="steps">'
    + '<li>打开小红书 App → 右下角「我」；</li>'
    + '<li>「我的订单」→ 找到这一单，点进去；</li>'
    + '<li>订单详情里点「联系客服」。</li>'
    + '</ol>';

  function kefuHTML() {
    /* 买家一定是在小红书店铺下的单，客服入口永远存在 —— 不依赖后台有没有填微信号 */
    return '<div class="buytip dim">买过了但打不开？'
      + '<button class="mini" id="kefuCopy" type="button">联系客服</button></div>';
  }
  function bindKefu() {
    var b = $('kefuCopy');
    if (b) b.onclick = function () { openInfoModal('怎么联系客服', KEFU_GUIDE); };
  }

  /* ---------------- 口令入口 ----------------
     免卡密版：这一屏只在「链接里的口令没带上」时出现 —— 手敲了裸域名、
     或者微信 / 小红书把 ?k= 那截参数吃掉了。它同时是这个人的转化屏：
     告诉他去哪儿拍、拍完怎么拿到能直接开测的链接。 */
  function showGate(failMsg, prefill) {
    S.mode = 'own';
    $('actbar').classList.add('hide');
    $('view-gate').innerHTML =
      '<div class="brand">' + esc(CFG.shopName || '疲惫类型自测') + '</div>'
      + '<h1>' + esc(CFG.quizTitle || '你现在的累，是哪一种累？') + '</h1>'
      + '<p class="lead">大多数人只会说「我好累」，说不清是哪里累。<br>这个测试不给你分数，它给这种累一个名字。</p>'
      + (fromQR() ? qrChipHTML() : '')
      + '<div class="facts"><span class="fact">18 道题 · 约 3 分钟</span><span class="fact">6 个维度 · 7 种结果</span><span class="fact">每种累附恢复处方</span></div>'
      + buyHTML()
      + '<div class="gate">'
      + '<h2>请输入口令</h2>'
      + '<p class="tip">买过的订单，口令就在订单的「发货信息 / 查看物流」里 —— 复制那一串填进来就行，不分大小写。</p>'
      + (failMsg
        ? '<div class="msg err" style="margin:0 0 12px">' + esc(failMsg) + '</div>'
        : (SB_PROBLEM
          ? '<div class="msg err" style="margin:0 0 12px">' + esc(SB_PROBLEM)
            + '若持续出现，可以在小红书订单里联系店铺客服。</div>'
          : ''))
      + '<div class="pin"><input id="pwd" type="text" inputmode="text" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="例如 LEI-TEST-2026" maxlength="24" value="' + esc(prefill || '') + '"></div>'
      + '<button class="btn" id="goBtn">验证并开始</button>'
      + '<div class="msg" id="gmsg"></div>'
      + '</div>'
      + kefuHTML()
      + '<div class="box" style="margin-top:14px"><p><b>怎么作答：</b>不用想太久，凭第一反应选频率就行。没有对错，也没有「应该」的答案。</p>'
      + '<p><b>你会得到：</b>一个属于你的累的名字、一张六维疲劳分布图、三条今天就能做的事。</p></div>';
    show('view-gate');

    var input = $('pwd'), btn = $('goBtn');
    btn.onclick = doRedeem;
    bindKefu();
    bindBuy();
    input.onkeydown = function (e) { if (e.key === 'Enter') doRedeem(); };
    input.oninput = function () { input.value = input.value.toUpperCase().replace(/[^0-9A-Z-]/g, ''); $('gmsg').textContent = ''; $('gmsg').className = 'msg'; };
  }

  function doRedeem() {
    var v = ($('pwd').value || '').trim();
    var msg = $('gmsg');
    if (!v) { msg.className = 'msg err'; msg.textContent = '请先输入口令。'; return; }
    var btn = $('goBtn');
    btn.disabled = true; btn.textContent = '正在验证…';
    msg.className = 'msg'; msg.textContent = '';
    api('/api/redeem', { method: 'POST', body: { code: v, token: S.token } }).then(function (r) {
      btn.disabled = false; btn.textContent = '验证并开始';
      if (r && r.ok && r.token) {
        S.token = r.token; S.authed = true;
        /* 永久码标记要落到本地：刷新页面时也得认得出，否则会被「已出结果」挡在门外 */
        S.unlimited = r.unlimited === true;
        try {
          if (S.unlimited) localStorage.setItem(K_UNL, '1');
          else localStorage.removeItem(K_UNL);
        } catch (e) { }
        try { localStorage.setItem(K_TOKEN, r.token); } catch (e) { }
        /* 换手机 / 清过浏览器数据的老买家：服务端认出这张码已经测过，
           把上一次那份结果原样还回来了。直接进结果页，不再让他答一遍 ——
           这张码的一次机会已经用掉了，can_retest 那边也会挡住重测。 */
        if (r.recovered && r.answers && r.answers.length === N) {
          try { localStorage.removeItem(K_PROG); } catch (e) { }
          S.mode = 'own';
          S.answers = r.answers.slice();
          S.an = QZ.analyze(S.answers);
          S.share = r.share || null;
          S.resultAt = r.resultAt || null;
          S.checked = {};
          saveResult();
          msg.className = 'msg ok'; msg.textContent = '找到了你上次的结果';
          history.replaceState(null, '', '#/result');
          setTimeout(function () {
            renderResult();
            toast('这是你上次测的结果 —— 想重新测，点结果页底部的「再测一次」', 3600);
          }, 320);
          return;
        }
        try { localStorage.removeItem(K_RESULT); } catch (e) { }
        msg.className = 'msg ok'; msg.textContent = '验证通过，正在进入…';
        /* 重新输一次密码进来的人，前端此刻还不知道这张码出没出过结果 —— 问一次服务端。
           老版本就是漏了这一步：刚测完 5 分钟内重新登录，redeem 照样放行，
           于是又能答一遍。这里兜住，不依赖数据库有没有跑最新迁移。 */
        api('/api/session', { method: 'POST', body: { token: S.token } }).then(function (s) {
          if (s && s.ok && s.resultAt && !S.unlimited) {
            S.resultAt = s.resultAt;
            var cached = readResult();
            history.replaceState(null, '', '#/result');
            if (cached) {
              S.answers = cached.a.slice();
              S.share = cached.s || null;
              S.checked = cached.c || {};
              S.an = QZ.analyze(S.answers);
              renderResult();
              toast('这是你上次测的结果 —— 想重新测，点结果页底部的「再测一次」', 3600);
            } else {
              showLostResult();
            }
            return;
          }
          setTimeout(showLanding, 320);
        });
      } else {
        msg.className = 'msg err';
        msg.innerHTML = esc((r && r.message) || '口令验证失败，请检查后重试。');
      }
    });
  }

  /* ---------------- 首页 ---------------- */
  function showLanding() {
    S.mode = 'own';
    $('actbar').classList.add('hide');
    /* 兜底：正常情况下 redeem 在「已出结果」时会直接把人送去结果页，走不到这里。
       但多标签页 / 刷新竞态下仍有可能漏进来，这里再挡一次，别把「开始测试」递出去。 */
    if (S.resultAt && !S.unlimited) {
      var cached = readResult();
      if (cached) {
        S.answers = cached.a.slice();
        S.share = cached.s || null;
        S.checked = cached.c || {};
        S.an = QZ.analyze(S.answers);
        history.replaceState(null, '', '#/result');
        renderResult();
      } else {
        history.replaceState(null, '', '#/');
        showLostResult();
      }
      return;
    }
    $('view-landing').innerHTML =
      '<div class="brand">' + esc(CFG.shopName || '疲惫类型自测') + '</div>'
      + '<h1>' + esc(CFG.quizTitle || '你现在的累，是哪一种累？') + '</h1>'
      + '<p class="lead">大多数人只会说「我好累」，说不清是哪里累。<br>这个测试不给你分数，它给这种累一个名字。</p>'
      + '<div class="facts"><span class="fact">18 道题 · 约 3 分钟</span><span class="fact">6 个维度 · 7 种结果</span><span class="fact">每种累附恢复处方</span></div>'
      + '<div class="box">'
      + '<p><b>怎么作答：</b>不用想太久，凭第一反应选频率就行。没有对错，也没有「应该」的答案。答完可以返回上一题改选。</p>'
      + '<p><b>你会得到：</b>一个属于你的累的名字、一张六维疲劳分布图、三条今天就能做的事。结果可以存成一张长图带走。</p>'
      + '</div>'
      + '<button class="btn" id="startBtn">开始测试</button>'
      + '<div class="msg ok" style="text-align:center">口令已验证 · 点上面开始，测完还能再测</div>';
    show('view-landing');
    $('startBtn').onclick = function () { history.replaceState(null, '', '#/quiz'); startQuiz(); };
  }

  /* ---------------- 答题 ---------------- */
  function startQuiz() {
    S.mode = 'own';
    $('actbar').classList.add('hide');
    /* 全新开始时尝试接上本地进度（没答过任何一题才续，避免覆盖正在进行的作答） */
    var resumed = 0;
    if (!S.answers.some(function (v) { return v; })) {
      var prog = readProgress();
      if (prog) {
        S.answers = prog.a.slice();
        S.idx = Math.min(Math.max(0, prog.i | 0), N - 1);
        resumed = S.answers.filter(function (v) { return v; }).length;
      }
    }
    $('view-quiz').innerHTML =
      '<div class="pbar"><i id="pfill"></i></div>'
      + '<div class="pnum"><span id="pnum"></span><span id="ppct"></span></div>'
      + '<p class="qtxt" id="qtxt"></p>'
      + '<div class="opts" id="opts"></div>'
      + '<div class="qfoot"><button class="btn ghost" id="prevBtn">← 上一题</button><button class="btn ghost" id="nextBtn">下一题</button></div>';
    show('view-quiz');
    $('prevBtn').onclick = prevQ;
    $('nextBtn').onclick = nextQ;
    renderQ();
    window.scrollTo(0, 0);
    if (resumed > 0) toast('已接上上次的进度（第 ' + (S.idx + 1) + ' 题，前面 ' + resumed + ' 题已作答）', 2800);
  }

  function renderQ() {
    var q = QD.QUESTIONS[S.idx];
    $('pfill').style.width = ((S.idx + 1) / N * 100) + '%';
    $('pnum').textContent = '第 ' + (S.idx + 1) + ' / ' + N + ' 题';
    $('ppct').textContent = Math.round((S.idx + 1) / N * 100) + '%';
    $('qtxt').textContent = q.t;
    var box = $('opts');
    box.innerHTML = '';
    QD.SCALE.forEach(function (s) {
      var el = document.createElement('div');
      el.className = 'opt' + (S.answers[S.idx] === s.v ? ' sel' : '');
      el.innerHTML = '<span class="dot"></span><span>' + esc(s.t) + '</span>';
      el.onclick = function () { pick(s.v, el); };
      box.appendChild(el);
    });
    $('prevBtn').disabled = (S.idx === 0);
    $('nextBtn').disabled = !S.answers[S.idx];
    $('nextBtn').textContent = (S.idx === N - 1) ? '看结果 →' : '下一题 →';
  }

  /* 连点保护：原来是「点一下就排一个 200ms 后跳下一题」，手快连点两下会排两个
     定时器 —— 题号连跳两次，中间那题的答案永远是 0，交卷时服务端直接拒收
     （提示「答案格式有误」，买家完全不知道发生了什么）。
     改成：重复点击只重置这一个定时器，答案以最后一次为准，永远只前进一题。 */
  var pickTimer = null;
  function pick(v, el) {
    S.answers[S.idx] = v;
    var nodes = $('opts').children;
    for (var i = 0; i < nodes.length; i++) nodes[i].classList.remove('sel');
    if (el) el.classList.add('sel'); else if (nodes[v - 1]) nodes[v - 1].classList.add('sel');
    $('nextBtn').disabled = false;
    saveProgress();
    if (pickTimer) clearTimeout(pickTimer);
    pickTimer = setTimeout(function () {
      pickTimer = null;
      if (S.idx < N - 1) { S.idx++; saveProgress(); renderQ(); window.scrollTo(0, 0); }
      else finish();
    }, 200);
  }
  function prevQ() {
    if (S.idx === 0) return;
    S.idx--;
    saveProgress();
    renderQ();
    window.scrollTo(0, 0);
  }
  function nextQ() {
    if (!S.answers[S.idx]) { toast('先选一个频率吧'); return; }
    if (S.idx < N - 1) { S.idx++; saveProgress(); renderQ(); window.scrollTo(0, 0); }
    else finish();
  }

  /* ---------------- 结果 ---------------- */
  function finish() {
    /* 交卷前先自查：有任何一题没选就别交。以前带着残缺答案交上去，
       服务端会拒收，页面却照常显示结果，买家一点「复制链接」才炸出来。 */
    var miss = -1;
    for (var i = 0; i < N; i++) { if (!S.answers[i]) { miss = i; break; } }
    if (miss >= 0) {
      S.idx = miss; saveProgress(); renderQ(); window.scrollTo(0, 0);
      toast('第 ' + (miss + 1) + ' 题还没选 —— 选一下就能看结果了');
      return;
    }
    S.finished = true;
    S.restored = false; S.restoredAt = null;
    S.an = QZ.analyze(S.answers);
    S.mode = 'own';
    S.share = null;
    saveResult();
    clearProgress();
    history.replaceState(null, '', '#/result');
    renderResult();
    window.scrollTo(0, 0);
    /* 向服务端登记「这张码已经出过结果」——同时它也是一次分享码预热，
       等买家点「复制链接」时就不用再等网络。 */
    api('/api/share', { method: 'POST', body: { token: S.token, answers: S.answers } }).then(function (r) {
      if (r && r.ok && r.share) {
        S.share = r.share;
        S.resultAt = r.resultAt || S.resultAt || new Date().toISOString();
        /* 服务端说「这张码早就出过结果了」：说明这次是重复提交（绕过了入口硬答的，
           或者网络慢、点了两次）。把原来那份答案换回来重画 —— 不然页面显示的是
           他刚瞎选的，而分享链接指向的还是原来那份，长图和链接会对不上。 */
        if (r.fresh === false && !S.unlimited && r.answers && r.answers.length === N) {
          S.answers = r.answers.slice();
          S.an = QZ.analyze(S.answers);
          saveResult();
          renderResult();
          toast('这是你上次测的结果 —— 想重新测，点结果页底部的「再测一次」', 3600);
          return;
        }
        saveResult();
      }
    });
  }

  function resultHTML(an, mode) {
    var T = an.T, h = '';
    h += '<div class="rhead">';
    h += '<div class="rlab">' + (mode === 'shared' ? 'TA 的累叫' : '你的累叫') + '</div>';
    h += '<div class="rname" style="color:' + an.color + '">' + esc(an.title) + '</div>';
    h += '<div class="rsub">' + esc(T.name) + '｜' + esc(T.sub) + '｜' + esc(T.en) + '</div>';
    h += QZ.drawRadarSVG(an.scores);
    /* 图例 */
    h += '<div class="legend">';
    an.order.forEach(function (d) {
      var c = QD.DIMCOLOR[d];
      h += '<div class="lgrow"><div class="lgtop"><span class="lgdot" style="background:' + c + '"></span>'
        + '<span class="lgnm">' + QD.DIMNAME[d] + '</span><span class="lgval">' + an.scores[d] + '</span></div>'
        + '<div class="lgbar"><i style="width:' + Math.max(an.scores[d], 2) + '%;background:' + c + '"></i></div>'
        + '<div class="lgnote">' + QD.DIMNOTE[d] + '</div></div>';
    });
    h += '</div>';
    h += '<div class="temp"><div class="tl"><span>整体疲劳指数</span><b>' + an.index + ' / 100</b></div>'
      + '<div class="tbar"><i style="width:' + an.index + '%"></i></div>'
      + '<div class="nowline">' + esc(an.nowline) + '</div></div>';
    h += '</div>';

    h += '<div class="qcard">' + esc(T.def) + '</div>';

    if (an.comboBody) {
      h += '<div class="blk"><div class="lb">' + esc(an.comboTitle) + '</div><p style="margin:0;font-size:15.5px">' + esc(an.comboBody) + '</p></div>';
    }

    h += '<div class="blk"><div class="lb">你为什么会这样</div>';
    T.why.forEach(function (p) { h += '<p>' + p + '</p>'; });
    h += '<div class="theory">' + T.concept + '</div></div>';

    h += '<div class="blk"><div class="lb">你的典型一天</div><p>' + esc(T.day) + '</p></div>';

    h += '<div class="blk"><div class="lb">你没意识到的代价</div><ol>';
    T.cost.forEach(function (c) { h += '<li>' + c + '</li>'; });
    h += '</ol></div>';

    if (mode === 'own') {
      h += '<div class="blk"><div class="lb">恢复处方 · 点一下就是今天做到了</div><ul class="fix" id="fixlist">';
      T.fix.forEach(function (f, i) {
        h += '<li class="' + (S.checked[i] ? 'on' : '') + '" data-i="' + i + '"><span class="cb"></span><span class="tx">' + f + '</span></li>';
      });
      h += '</ul><div class="fixcount" id="fixcount"></div></div>';
    } else {
      h += '<div class="blk"><div class="lb">恢复处方</div><ul>' + T.fix.map(function (f) { return '<li>' + f + '</li>'; }).join('') + '</ul></div>';
    }

    h += '<div class="last">' + esc(T.last) + '</div>';
    h += '<div class="disc">' + esc(QD.DISCLAIMER).replace(/\n/g, '<br>') + '</div>';

    if (mode === 'own') {
      /* 免卡密版用的是通用口令（库里 unlimited），不受「一码一次」限制 ——
         「再测一次」一直摆着，点了就能重开一轮，这是这一版对买家的好处之一。
         （带密码那套会在交卷后把这个按钮藏掉，那边一张码只能完整测一次。） */
      h += '<button class="btn ghost sm" id="retestBtn">再测一次</button>';
      /* 换人测：清掉这台设备上的这一轮，让别人（或自己重新）从第一题开始。
         不是「重来一次」—— 它会把刚才那份结果从本机清掉，所以按钮文案说清楚。 */
      h += '<div class="switchrow">想给家人朋友也测一份？'
        + '<button class="mini" id="switchBtn" type="button">换个人测</button></div>';
    }
    return h;
  }

  function updateFixCount() {
    var n = 0;
    Object.keys(S.checked).forEach(function (k) { if (S.checked[k]) n++; });
    var el = $('fixcount');
    if (el) el.textContent = '今天完成了 ' + n + ' / 3';
  }

  function fmtWhen(ts) {
    if (!ts) return '';
    var d = new Date(ts);
    if (isNaN(d.getTime())) return '';
    return (d.getMonth() + 1) + '月' + d.getDate() + '日 '
      + ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
  }

  function renderResult() {
    var an = S.an;
    var head = '<div class="brand">' + esc(CFG.shopName || '疲惫类型自测') + '</div>';
    /* 从本机调出来的旧结果：顶部挂一条说明，别让人把别人的结果当成自己的 */
    if (S.restored) {
      head += '<div class="qrchip" style="margin-bottom:12px">这是这台设备上次'
        + (fmtWhen(S.restoredAt) ? '（' + fmtWhen(S.restoredAt) + '）' : '')
        + '测的结果 —— 想测自己的，点最下面的「换个人测」</div>';
    }
    $('view-result').innerHTML = head + resultHTML(an, S.mode);
    show('view-result');

    var fl = $('fixlist');
    if (fl) {
      fl.onclick = function (e) {
        var li = e.target.closest ? e.target.closest('li') : null;
        if (!li) return;
        var i = li.getAttribute('data-i');
        S.checked[i] = !S.checked[i];
        li.classList.toggle('on', !!S.checked[i]);
        updateFixCount();
        saveResult();
      };
      updateFixCount();
    }
    var rb = $('retestBtn');
    if (rb) rb.onclick = retest;
    var sb = $('switchBtn');
    if (sb) sb.onclick = switchCode;

    renderActbar();
  }

  function renderActbar() {
    var bar = $('actbar');
    if (S.mode === 'shared') {
      /* 扫码进来的人多半是「看了朋友的结果、想测自己」—— 这一步是唯一的转化口，
         所以有购买链接时把它做成主按钮（金色），「我也要测」退成次要按钮。 */
      bar.innerHTML = '<div class="innercol">'
        + (CFG.buyUrl
            ? '<a class="btn gold" style="text-decoration:none;display:block;text-align:center" '
              + 'href="' + esc(CFG.buyUrl) + '" target="_blank" rel="noopener">'
              + esc(CFG.buyText || '去小红书下单，自动发货') + '</a>'
              /* 小红书的链接在微信里经常被拦（提示「请在小红书 App 打开」），
                 而扫码进来的人恰恰多半是在微信里。所以主按钮下面必须留一条
                 「搜店铺名」的退路，别让人点了没反应就走了。 */
              + '<div class="barbuy">链接打不开？到小红书搜「' + esc(CFG.shopName || '疲惫类型自测') + '」</div>'
            /* 没配商品链接时，底栏那行「去小红书搜」原来只是行不能点的文字 ——
               想买的人看着干着急。换成能点的按钮，点了弹窗讲清搜什么。 */
            : '<button class="btn gold" id="barBuyBtn" type="button" style="margin:0">去小红书拍一份，自动发货</button>'
              + '<div class="barbuy">到小红书搜「' + esc(CFG.shopName || '疲惫类型自测') + '」</div>')
        + '<div class="inner"><button class="btn line" id="ctaBtn">我也要测一下我的 →</button></div>'
        + '</div>';
      bar.classList.remove('hide');
      bindBuy();
      /* 看过别人结果的人点了「我也要测」—— 他没付过钱，不该白送一轮，
         但更不该把他丢回「输入口令」那一屏（那屏对他来说就是个死胡同，
         他根本不知道口令是什么）。直接送商品页：他拍下就有自己的链接。 */
      $('ctaBtn').onclick = function () {
        if (CFG.buyUrl) { goBuy(true); return; }
        openBuyModal();
      };
      return;
    }
    bar.innerHTML = '<div class="inner">'
      + '<button class="btn" id="saveBtn">保存长图</button>'
      + '<button class="btn line" id="linkBtn">复制链接</button>'
      + '<button class="btn gold" id="praiseBtn">好评有礼</button>'
      + '</div>';
    bar.classList.remove('hide');
    $('saveBtn').onclick = saveImage;
    $('linkBtn').onclick = copyLink;
    $('praiseBtn').onclick = openPraise;
  }

  /* 再测一次：能不能再开一轮由服务端说了算（一个密码只完整测试一次） */
  function retest() {
    var btn = $('retestBtn');
    if (btn) { btn.disabled = true; btn.textContent = '正在确认…'; }
    api('/api/retest', { method: 'POST', body: { token: S.token } }).then(function (r) {
      if (btn) { btn.disabled = false; btn.textContent = '再测一次'; }
      if (r && r.ok && r.allow) {
        S.answers = new Array(N).fill(0);
        S.idx = 0; S.an = null; S.checked = {}; S.share = null; S.finished = false;
        S.restored = false; S.restoredAt = null;
        try { localStorage.removeItem(K_RESULT); } catch (e) { }
        clearProgress();
        history.replaceState(null, '', '#/quiz');
        startQuiz();
        return;
      }
      showRetestBlocked((r && r.message) || '暂时没能开新的一轮。');
    });
  }

  /* 换个人测：清掉这台设备上这一轮的结果和进度，让别人（或自己）从头开始。
     免卡密版不换口令 —— 口令是通用的，清完本地直接用同一个口令重新开一轮就行，
     所以这里清完就把人送回第一题，不回「输入口令」那一屏（那样只是多一步）。 */
  function switchCode() {
    try {
      localStorage.removeItem(K_PROG);
      localStorage.removeItem(K_RESULT);
    } catch (e) { }
    S.resultAt = null; S.finished = false;
    S.restored = false; S.restoredAt = null;
    S.idx = 0; S.an = null; S.share = null; S.checked = {};
    S.answers = new Array(N).fill(0);
    clearProgress();
    history.replaceState(null, '', '#/quiz');
    startQuiz();
    toast('已清空上一份 —— 现在从第一题开始');
  }

  function showRetestBlocked(msg) {
    var h = '<p>' + esc(msg) + '</p>'
      + '<p>你这次的测评结果还在这一页，随时可以回来看，也可以存成长图带走。</p>';
    h += '<div class="hl">口令是通用的、不限次数 —— 一般是网络抖了一下，退出重进一次就好。</div>'
      + '<button class="btn line" id="mKefu2" type="button">怎么联系客服</button>';
    if (CFG.buyUrl) {
      h += '<a class="btn gold" id="mBuy2" href="' + esc(CFG.buyUrl) + '" target="_blank" rel="noopener"'
        + ' style="margin-top:8px;text-decoration:none">' + esc(CFG.buyText || '回店铺看看') + '</a>';
    } else {
      /* 没配商品链接也要留一条能点的路 —— 不然这条提示就成了死胡同 */
      h += '<button class="btn gold" id="mBuyBtn" type="button" style="margin-top:8px">去小红书看看</button>';
    }
    openInfoModal('暂时没能开新的一轮', h);
    var cb = $('mKefu2');
    if (cb) cb.onclick = function () { openInfoModal('怎么联系客服', KEFU_GUIDE); };
    bindBuy();
  }

  /* 保存长图 */
  function saveImage() {
    if (!S.an) return;
    if (typeof html2canvas !== 'function') {
      openInfoModal('暂时无法生成图片', '<p>这个浏览器不支持自动生图。</p><p>你可以直接对当前页面连续截图保存，内容是一样的。</p>');
      return;
    }
    showLoading('正在生成结果长图…');
    PO.render(S.an, CFG, S.checked).then(function (res) {
      hideLoading();
      S.img = res.url;
      var name = '疲惫类型自测-' + String(S.an.title).replace(/[\s×]/g, '') + '.png';
      S.imgName = name;
      if (!isMobile) {
        download(res.url, name);
        toast('长图已保存到「下载」文件夹');
      } else {
        openPreview(res.url, name);
      }
    }).catch(function () {
      hideLoading();
      openInfoModal('生成失败', '<p>抱歉，自动生成图片的时候出错了。</p><p>你可以直接对当前页面截屏保存，效果是一样的。</p>');
    });
  }

  /* 长图预览层（手机端）
     —— 之前只有「长按保存」一条路，而 iOS Safari 对超长 data: 地址的图经常
        弹不出「存储到照片」，点了以为存了其实没存。现在三条路都给：
        ①「保存到相册」按钮（走 a[download]）；② 长按图片；③ 发给朋友。
        图片地址也从 dataURL 换成 blob: —— 长按菜单稳定得多。

     2026-10-25b：上一版「内置浏览器就不给按钮」是过度设计 —— 实测带密码那版
     （按钮一直摆着）是能存的，藏掉之后反而只剩长按一条路，而长按在
     小红书 / 微信的 WebView 里对 blob: 图常常不弹「保存图片」菜单。
     现在按钮**永远摆着**，另外补一条「在新页面打开」：打开后就是一张纯图片，
     长按保存这条路在任何 WebView 里都走得通。 */
  function openPreview(url, name) {
    var isApp = /MicroMessenger|Weibo|QQ\/|Xiaohongshu|xhs|Rednote|RedNote|DingTalk|AlipayClient/i.test(ua);
    var canShare = !isWeChat && typeof navigator.canShare === 'function' && typeof File === 'function';
    var isIOS = /iPhone|iPad|iPod/i.test(ua);

    var showUrl = url, objectUrl = null;
    try {
      objectUrl = URL.createObjectURL(PO.dataURLtoBlob(url));
      showUrl = objectUrl;
    } catch (e) { /* 拿不到 blob 就退回 dataURL，不影响后面的路 */ }

    var where = isIOS
      ? 'iPhone：存好的图在「照片」里；用按钮存的可能先落到「文件 → 下载」。'
      : '安卓：一般直接进相册，也可能在「文件管理 → 下载」。';
    var hint = '<b>①</b> 先点上面的「保存到相册」<br>'
      + '<b>②</b> 点了没动静 → 点「在新页面打开」，打开后长按那张图 →「保存图片」<br>'
      + '<b>③</b> 还是不行 → 点右上角「···」→「用浏览器打开」这一页，再点一次保存';

    var d = document.createElement('div');
    d.className = 'pv';
    d.innerHTML =
      '<div class="pvtop">'
      + '<div class="t"><b>结果长图已生成</b><span>三条路，总有一条能存下来</span></div>'
      + '<button id="pvSave">保存到相册</button>'
      + '<button id="pvOpen">在新页面打开</button>'
      + (canShare ? '<button id="pvShare">发给朋友</button>' : '')
      + '<button id="pvClose">关闭</button>'
      + '</div>'
      + '<div class="pvbody"><img src="' + showUrl + '" alt="我的测评结果长图">'
      + '<div class="hint">' + hint + '<br>' + where + '</div></div>';
    document.body.appendChild(d);

    function close() {
      if (d.parentNode) d.parentNode.removeChild(d);
      if (objectUrl) { try { URL.revokeObjectURL(objectUrl); } catch (e) { } }
    }
    d.querySelector('#pvClose').onclick = close;

    d.querySelector('#pvSave').onclick = function () {
      download(showUrl, name);
      /* 只说「已触发」，不说「已保存」—— 保存到没保存由系统决定，
         说死了而相册里没有，买家第一反应就是「这东西是坏的」。 */
      toast('已触发保存 —— 没看到图就点「在新页面打开」，长按存', 3600);
    };
    /* 内置浏览器里 a[download] 常被忽略，而「把图片单独打开成一页」几乎是
       所有 WebView 都支持的 —— 打开后长按保存是这类环境里最稳的一条路。 */
    var opener = d.querySelector('#pvOpen');
    if (opener) opener.onclick = function () {
      var a = document.createElement('a');
      a.href = showUrl; a.target = '_blank'; a.rel = 'noopener';
      a.style.display = 'none'; document.body.appendChild(a); a.click();
      setTimeout(function () { if (a.parentNode) a.parentNode.removeChild(a); }, 100);
      toast('已打开一张单独的图片 —— 长按它 →「保存图片」', 3600);
    };

    if (canShare) {
      d.querySelector('#pvShare').onclick = function () {
        try {
          var blob = PO.dataURLtoBlob(url);
          var file = new File([blob], name, { type: 'image/png' });
          if (navigator.canShare({ files: [file] })) {
            navigator.share({ files: [file], title: '我的疲惫类型', text: '我测出来的累是「' + S.an.title + '」' })
              .catch(function () { });
          } else {
            download(showUrl, name);
          }
        } catch (e) { download(showUrl, name); }
      };
    }
  }

  /* 复制结果链接 */
  function copyLink() {
    if (!S.an) return;
    var need = S.share ? Promise.resolve(S.share)
      : api('/api/share', { method: 'POST', body: { token: S.token, answers: S.answers } }).then(function (r) {
        if (r && r.ok && r.share) { S.share = r.share; saveResult(); return r.share; }
        /* 服务端那句「答案格式有误」买家看不懂也照做不了，换成能照做的动作 */
        throw new Error(r && r.error === 'answers'
          ? '结果还没保存好 —— 请下拉刷新页面，再点一次复制链接。'
          : ((r && r.message) || '分享链接生成失败，请稍后再试。'));
      });
    showLoading('正在生成分享链接…');
    need.then(function (code) {
      hideLoading();
      /* 用查询串而不是 hash —— 转发时 # 后面的内容常被内置浏览器吃掉，
         那样朋友点开只会看到口令屏，等于分享了个空链接。 */
      var url = location.origin + location.pathname + '?r=' + encodeURIComponent(code);
      S.link = url;
      /* 微信会拦境外域名（本站挂在 github.io），朋友点开常常就是一句
         「这个链接打不开了」。与其让他碰壁，不如复制完就把话说清楚，
         并且把「发长图」这条路摆在同一屏 —— 微信里发图片不受域名限制。 */
      return copyText(url).then(function (ok) {
        openShareModal(url, ok);
      });
    }).catch(function (e) {
      hideLoading();
      toast((e && e.message) || '分享失败，请稍后再试');
    });
  }

  function openLinkModal(url) {
    var d = document.createElement('div');
    d.className = 'mask';
    d.innerHTML = '<div class="modal" style="max-width:380px">'
      + '<button class="close">×</button>'
      + '<h3>复制这个链接</h3><p>自动复制被浏览器拦住了，长按下面的链接选中后复制即可。</p>'
      + '<div class="kefu"><div class="k" style="width:100%"><div class="kl">结果链接</div>'
      + '<textarea readonly style="width:100%;border:none;background:transparent;font-size:13px;color:#1c2026;resize:none;height:64px;outline:none">' + esc(url) + '</textarea></div></div>'
      + '<button class="btn" id="mlclose">知道了</button></div>';
    document.body.appendChild(d);
    var ta = d.querySelector('textarea');
    setTimeout(function () { ta.focus(); ta.select(); }, 60);
    d.querySelector('.close').onclick = function () { d.parentNode.removeChild(d); };
    d.querySelector('#mlclose').onclick = function () { d.parentNode.removeChild(d); };
    d.onclick = function (e) { if (e.target === d) d.parentNode.removeChild(d); };
  }

  /* 复制完结果链接后的说明屏。
     必须说清两件事：① 链接复制成功了没（自动复制在内置浏览器里常被拦）；
     ② 微信里很可能打不开（境外域名被拦），最稳的是发长图。
     少了 ②，朋友那边一句「链接打不开」就会落到店主头上。 */
  function openShareModal(url, autoCopied) {
    var d = document.createElement('div');
    d.className = 'mask';
    d.innerHTML = '<div class="modal" style="max-width:380px">'
      + '<button class="close">×</button>'
      + '<h3>' + (autoCopied ? '链接已复制' : '复制这个链接') + '</h3>'
      + '<p>' + (autoCopied
        ? '发给朋友，他点开就能看到你这份结果。'
        : '自动复制被浏览器拦住了 —— 长按下面的链接选中后复制就行。') + '</p>'
      + '<div class="hl" style="text-align:left">微信里点开有时会提示「这个链接打不开」——'
      + '微信会拦境外域名。<b>发到微信最稳的办法是发长图</b>：先存成图，再在微信里发图片。</div>'
      + '<div class="kefu"><div class="k" style="width:100%"><div class="kl">结果链接</div>'
      + '<textarea readonly style="width:100%;border:none;background:transparent;font-size:13px;color:#1c2026;resize:none;height:64px;outline:none">' + esc(url) + '</textarea></div></div>'
      + '<button class="btn" id="mSaveImg">去存长图（推荐发微信）</button>'
      + '<button class="btn line" id="mlclose" style="margin-top:8px">知道了</button></div>';
    document.body.appendChild(d);
    var ta = d.querySelector('textarea');
    setTimeout(function () { ta.focus(); ta.select(); }, 60);
    d.querySelector('.close').onclick = function () { d.parentNode.removeChild(d); };
    d.querySelector('#mlclose').onclick = function () { d.parentNode.removeChild(d); };
    d.querySelector('#mSaveImg').onclick = function () { d.parentNode.removeChild(d); saveImage(); };
    d.onclick = function (e) { if (e.target === d) d.parentNode.removeChild(d); };
  }

  /* 好评有礼 */
  function openPraise() {
    var cb = CFG.cashback || '1';
    /* 同上：不发微信号，只给小红书里的找人路径 */
    var kefuBtn = '<button class="btn line" id="cpKefu" type="button">怎么联系客服</button>';
    var d = document.createElement('div');
    d.className = 'mask';
    d.innerHTML = '<div class="modal">'
      + '<button class="close">×</button>'
      + '<h3>好评有礼</h3>'
      + '<p>谢谢你愿意测到最后。如果你觉得这个测评对你有一点帮助，欢迎给一个五星好评。</p>'
      + '<div class="hl">好评后可获得 <b>' + esc(cb) + ' 元</b>返现。</div>'
      + '<ol class="steps">'
      + '<li>回到订单页，点亮五星好评，写一句真实感受；</li>'
      + '<li>把好评页面截图保存；</li>'
      + '<li>回到小红书订单页，把截图发给店铺客服。</li>'
      + '</ol>'
      + kefuBtn
      + '<p style="font-size:12.5px;color:#7b848f;margin-top:10px">客服确认截图后，返现一般会在 24 小时内发出。感谢你的支持。</p>'
      + '<button class="btn" id="mclose">知道了</button></div>';
    document.body.appendChild(d);
    d.querySelector('.close').onclick = function () { d.parentNode.removeChild(d); };
    d.querySelector('#mclose').onclick = function () { d.parentNode.removeChild(d); };
    d.onclick = function (e) { if (e.target === d) d.parentNode.removeChild(d); };
    var cp = d.querySelector('#cpKefu');
    if (cp) cp.onclick = function () { openInfoModal('怎么联系客服', KEFU_GUIDE); };
  }

  function openInfoModal(title, bodyHTML) {
    var d = document.createElement('div');
    d.className = 'mask';
    d.innerHTML = '<div class="modal" style="max-width:360px"><button class="close">×</button><h3>' + esc(title) + '</h3>' + bodyHTML
      + '<button class="btn" id="mclose">知道了</button></div>';
    document.body.appendChild(d);
    d.querySelector('.close').onclick = function () { d.parentNode.removeChild(d); };
    d.querySelector('#mclose').onclick = function () { d.parentNode.removeChild(d); };
    d.onclick = function (e) { if (e.target === d) d.parentNode.removeChild(d); };
  }

  /* 结果不在这台设备上（换了手机 / 清了浏览器数据） */
  function showLostResult() {
    S.mode = 'own';
    $('actbar').classList.add('hide');
    $('view-gate').innerHTML =
      '<div class="brand">' + esc(CFG.shopName || '疲惫类型自测') + '</div>'
      + '<h1>你的结果不在这台设备上</h1>'
      + '<p class="lead">这一轮的结果保存在你当时做题的那台手机 / 电脑的浏览器里，换成别的设备、或者清理过浏览器数据，就取不回来了。</p>'
      + '<div class="box"><p>想再看一次结果、或者给自己 / 家人朋友再测一遍，联系客服说明情况就行；也可以直接再拍一份。</p></div>'
      + kefuHTML()
      + buyHTML()
      + '<button class="btn" id="lostHome">返回首页</button>';
    show('view-gate');
    bindKefu();
    bindBuy();
    $('lostHome').onclick = function () { history.replaceState(null, '', '#/'); location.reload(); };
  }

  /* ---------------- 分享页（只读） ---------------- */
  function showShared(code) {
    S.mode = 'shared';
    $('shell').classList.remove('hasbar');
    $('actbar').classList.add('hide');
    $('view-result').innerHTML = '<div class="brand">正在打开分享的结果…</div><div class="box"><p>请稍等。</p></div>';
    show('view-result');
    api('/api/shared?c=' + encodeURIComponent(code)).then(function (r) {
      if (!r || !r.ok || !r.answers) {
        $('view-result').innerHTML = '<div class="brand">结果链接无效</div>'
          + '<h1>这个链接打不开了</h1>'
          + '<p class="lead">链接可能被截断或者已经失效。请让朋友重新分享一次。</p>'
          + '<button class="btn" id="ctaBtn">我也要测一下我的</button>'
          + buyHTML();
        $('actbar').classList.add('hide');
        bindBuy();
        var b = $('ctaBtn');
        if (b) b.onclick = function () {
          if (CFG.buyUrl) { goBuy(true); return; }
          openBuyModal();
        };
        return;
      }
      if (r.shopName) CFG.shopName = r.shopName;
      if (r.quizTitle) CFG.quizTitle = r.quizTitle;
      if (r.kefuWechat) CFG.kefuWechat = r.kefuWechat;
      CFG.buyUrl = r.buyUrl || '';
      CFG.buyText = r.buyText || '';
      S.answers = r.answers.slice();
      S.an = QZ.analyze(S.answers);
      $('view-result').innerHTML =
        '<div class="brand">' + esc(CFG.shopName || '疲惫类型自测') + '</div>'
        + '<div class="sharedtag">这是一份朋友分享给你的测评结果 —— 往下看就能看到 TA 的完整分析。'
        + '<br>想测自己的？点下面的按钮直接拍，付款后开测链接自动发到订单。</div>'
        + resultHTML(S.an, 'shared');
      show('view-result');
      renderActbar();
      window.scrollTo(0, 0);
    });
  }

  /* ---------------- 启动 ---------------- */
  function bootFresh() {
    S.mode = 'own';
    $('actbar').classList.add('hide');
    if (S.authed) showLanding(); else showGate();
  }

  /* 链接里带了口令（?k=xxx）→ 后台自动验证，买家一个字都不用输。
     这是免卡密版最重要的一屏：小红书付款后点开发货链接，落到这里，
     验证完直接进「开始测试」，中间不再有任何一道门槛。 */
  function autoEnter(code, failMsg) {
    var v = $('view-gate');
    if (v) {
      v.innerHTML =
        '<div class="brand">' + esc(CFG.shopName || '疲惫类型自测') + '</div>'
        + '<h1>' + esc(CFG.quizTitle || '你现在的累，是哪一种累？') + '</h1>'
        + '<p class="lead">正在进入测试…</p>'
        + (failMsg ? '<div class="msg err" style="margin:16px 0 0">' + esc(failMsg) + '</div>' : '')
        + '<div class="box" style="margin-top:16px"><p>如果这个页面一直停在这里，'
        + '检查下网络，或者回到小红书订单里重新点一次链接。</p></div>'
        + kefuHTML();
      show('view-gate');
      bindKefu();
    }
    api('/api/redeem', { method: 'POST', body: { code: code, token: null } }).then(function (r) {
      if (r && r.ok && r.token) {
        S.token = r.token;
        S.authed = true;
        S.unlimited = r.unlimited === true;
        try { if (S.unlimited) localStorage.setItem(K_UNL, '1'); } catch (e) { }
        try { localStorage.setItem(K_TOKEN, r.token); } catch (e) { }
        /* 通用口令是永久码 —— 每次进来都是全新一轮，不走「还你上次那份结果」的分支 */
        try { localStorage.removeItem(K_RESULT); } catch (e) { }
        try { localStorage.removeItem(K_PROG); } catch (e) { }
        showLanding();
        return;
      }
      /* 口令失效 / 链接被截断 → 退回输入口令那一屏，并把口令留在框里让他改 */
      showGate((r && r.message) || '口令验证失败，请检查后重试。', code);
    });
  }

  function boot() {
    try { S.token = localStorage.getItem(K_TOKEN) || null; } catch (e) { S.token = null; }
    try { S.unlimited = localStorage.getItem(K_UNL) === '1'; } catch (e) { S.unlimited = false; }
    var h = location.hash.replace(/^#\/?/, '');
    /* 分享链接优先走查询串（?r=xxx），hash 版当兜底 —— 见 qsGet 的说明 */
    var shared = qsGet('r');
    if (shared) { showShared(shared); return; }
    if (h.indexOf('r/') === 0) { showShared(h.slice(2)); return; }

    /* 扫二维码进来 + 后台配了商品链接 → 直接送商品页，不用再点一次按钮 */
    if (!S.token && fromQR() && CFG.buyUrl && !qrJumped()) {
      markQrJump();
      goBuy(true);
      return;
    }

    /* 免卡密版的核心入口：链接自带口令 → 自动验证后直接进测试。
       注意这里**不**拿 PUBLIC_CODE 兜底：裸域名进来的人必须落在「输入口令」那一屏，
       否则等于把口令白送出去 —— 那一屏同时是他变成买家的唯一机会。
       口令是通用的，但「知道这个链接」仍然是付过钱才有的东西。 */
    if (!S.token) {
      var k = codeFromUrl();
      if (k) { autoEnter(k); return; }
    }

    var check = S.token
      ? api('/api/session', { method: 'POST', body: { token: S.token } }).then(function (r) {
        if (r && r.ok) { S.authed = true; S.resultAt = r.resultAt || null; } else { S.authed = false; }
      })
      : Promise.resolve();
    check.then(function () {
      if (!S.authed) {
        S.token = null;
        try { localStorage.removeItem(K_TOKEN); } catch (e) { }
        if (h === 'result' || h === 'quiz') { history.replaceState(null, '', '#/'); }
        showGate();
        return;
      }
      var saved = readResult();
      /* 已经出过结果 —— 不管本地有没有缓存，都先把人送回结果页。
         以前这里对永久码（unlimited）网开一面，裸域名进来一律给「开始测试」，
         结果就是：关掉页面再进来，上一份结果不见了 —— 买家只会认为东西是坏的。
         永久码照样回结果页：那页本来就有「再测一次」，想重测一步就能重测。 */
      if (S.resultAt) {
        if (h !== 'result') { history.replaceState(null, '', '#/result'); }
        if (saved) {
          S.answers = saved.a.slice();
          S.share = saved.s || null;
          S.checked = saved.c || {};
          S.an = QZ.analyze(S.answers);
          /* 这台设备上一次测的结果被调了出来 —— 必须让他一眼看出「这是旧的」，
             否则同一个人换台手机、或者下一个人拿这台手机点开链接，都会以为
             「我刚买的怎么直接给我看别人的结果」。 */
          S.restored = true;
          S.restoredAt = saved.t || null;
          renderResult();
        } else if (S.unlimited) {
          /* 永久码 + 本地缓存没了：不装作「结果丢了」，直接让他重来一轮 */
          showLanding();
        } else {
          showLostResult();
        }
        return;
      }
      if (h === 'result' && saved) {
        S.answers = saved.a.slice();
        S.share = saved.s || null;
        S.checked = saved.c || {};
        S.an = QZ.analyze(S.answers);
        renderResult();
        return;
      }
      if (h === 'quiz') { startQuiz(); return; }
      if (h === 'result') { history.replaceState(null, '', '#/'); }
      showLanding();
    });
  }

  window.addEventListener('hashchange', function () {
    var h = location.hash.replace(/^#\/?/, '');
    if (h.indexOf('r/') === 0) showShared(h.slice(2));
  });

  api('/api/config').then(function (c) {
    if (c && c.ok !== false) {
      CFG.shopName = c.shopName || CFG.shopName;
      CFG.quizTitle = c.quizTitle || CFG.quizTitle;
      CFG.kefuWechat = c.kefuWechat || '';
      CFG.cashback = c.cashback || '0.5';
      CFG.buyUrl = c.buyUrl || '';
      CFG.buyText = c.buyText || '';
      if (CFG.quizTitle && location.hash.indexOf('#/r/') !== 0) document.title = CFG.quizTitle;
    } else if (c && (c.error === 'notready' || c.error === 'config')) {
      /* 后端明确回了「函数/表不存在」或「key 不对」—— 这是确定性的故障，
         买家现在输密码一定失败。与其让他输完密码才看到报错，不如进门就说。
         只认这两种确定性的错；网络抖一下（net）不提，免得白白吓走买家。 */
      SB_PROBLEM = c.message || '暂时无法验证口令，请稍后再试。';
    }
    boot();
  });
})();
