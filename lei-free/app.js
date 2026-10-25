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
    restored: false, restoredAt: null,
    /* 长图已经传上图床的网络地址 + 它对应的那版内容。
       出结果时就后台传好（见 prewarmPoster），买家点「保存长图」的那一刻
       直接就是能长按的网络图 —— 不用等十秒上传，也就不会长按到一张存不了的图。
       imgKey 变了（重测 / 改了勾选）就作废重传。 */
    remoteImg: null, imgKey: null, imgBlob: null, prewarm: null
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
       服务端会拒收，页面却照常显示结果，买家要分享时才炸出来。 */
    var miss = -1;
    for (var i = 0; i < N; i++) { if (!S.answers[i]) { miss = i; break; } }
    if (miss >= 0) {
      S.idx = miss; saveProgress(); renderQ(); window.scrollTo(0, 0);
      toast('第 ' + (miss + 1) + ' 题还没选 —— 选一下就能看结果了');
      return;
    }
    S.finished = true;
    S.restored = false; S.restoredAt = null;
    S.remoteImg = null; S.imgKey = null; S.imgBlob = null; S.prewarm = null;
    S.an = QZ.analyze(S.answers);
    S.mode = 'own';
    S.share = null;
    saveResult();
    clearProgress();
    history.replaceState(null, '', '#/result');
    renderResult();
    window.scrollTo(0, 0);
    /* 向服务端登记「这张码已经出过结果」——同时它也是一次分享码预热，
       之后要用分享码时不用再等网络。 */
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
        /* 图的内容变了，之前传好的那张作废，下次再传 */
        S.remoteImg = null; S.imgKey = null; S.imgBlob = null; S.prewarm = null;
        saveResult();
        prewarmPoster();
      };
      updateFixCount();
    }
    var rb = $('retestBtn');
    if (rb) rb.onclick = retest;
    var sb = $('switchBtn');
    if (sb) sb.onclick = switchCode;

    renderActbar();
    /* 结果一出来就把长图传好 —— 等买家点「保存长图」再传就来不及了 */
    prewarmPoster();
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
    /* 2026-10-25d：应主要求关掉「复制链接」。
       理由站得住：站点挂在境外域名上，微信里点开常常一句「链接打不开」，
       而朋友那边打不开，账会算到店主头上。分享这一环改成只走长图 ——
       图不受域名限制，发到哪都能看。 */
    bar.innerHTML = '<div class="inner">'
      + '<button class="btn" id="saveBtn">保存长图</button>'
      + '<button class="btn gold" id="praiseBtn">好评有礼</button>'
      + '</div>';
    bar.classList.remove('hide');
    $('saveBtn').onclick = saveImage;
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
        S.remoteImg = null; S.imgKey = null; S.imgBlob = null; S.prewarm = null;
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
    S.remoteImg = null; S.imgKey = null;
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
  /* 这个环境点了「下载」到底有没有反应 —— 决定了走哪条路。
     实测结论（不是猜的）：小红书 / 微信 / 微博 / QQ 这类 App 的内置浏览器，
     Android 上点击下载 **100% 无反应**（WebView 根本没接下载回调），
     iOS 的 WKWebView 也一样靠不住。所以这类环境**一个保存按钮都不摆** ——
     摆一个点了没反应的按钮，比不摆更糟（买家会以为东西坏了）。
     系统浏览器（Safari / Chrome）点了是真能存的，那种环境才走下载。 */
  function canDownload() {
    return !/MicroMessenger|Weibo|QQ\/|Xiaohongshu|xhs|Rednote|RedNote|DingTalk|AlipayClient/i.test(ua);
  }

  /* 为什么要把长图传到网上再让人长按：
     Android 的 WebView 长按菜单，判断"这是不是一张能存的图"普遍用
     URLUtil.isNetworkUrl() —— 只认 http/https。blob: 和 data: 会被判成
     无效地址，于是长按什么都不弹（这正是"点了没反应"的底层原因）。
     所以这里把长图传到 Supabase Storage 换一个 https 地址；
     没配 Storage（bucket 不存在 / 没给上传权限）就静默退回本地图，
     功能和现在完全一样，不会因为没配就报错。 */
  function uploadPoster(dataURL) {
    var base = String(window.SUPABASE_URL || '').replace(/\/+$/, '');
    var key0 = String(window.SUPABASE_ANON_KEY || '');
    if (!base || !key0 || typeof fetch !== 'function' || typeof AbortController !== 'function') {
      return Promise.resolve('');
    }
    var blob;
    try { blob = PO.dataURLtoBlob(dataURL); } catch (e) { return Promise.resolve(''); }
    if (!blob || !blob.size || blob.size > 9 * 1024 * 1024) return Promise.resolve('');

    var name = 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 11) + '.png';
    var ctrl = new AbortController();
    /* 超时给到 30 秒：一张 1MB 出头的长图，在手机网络（尤其小红书 WebView 里
       还套了一层代理）实测要 7 秒以上才传完。原来只给 7 秒，结果服务端都回了
       200、body 还没传完就被掐断（net::ERR_ABORTED），图就一直停在 blob:
       地址上 —— 长按依然没有菜单。宁可让人多等一会儿，也不能悄悄退回死路。 */
    var timer = setTimeout(function () { try { ctrl.abort(); } catch (e) { } }, 30000);

    function done(url) { clearTimeout(timer); return url; }

    return fetch(base + '/storage/v1/object/posters/' + name, {
      method: 'POST',
      headers: {
        apikey: key0,
        Authorization: 'Bearer ' + key0,
        'Content-Type': 'image/png',
        'x-upsert': 'false'
      },
      body: blob,
      signal: ctrl.signal
    }).then(function (r) {
      /* 必须把响应体读掉：不读的话 Chrome 会把它当成悬挂请求直接 abort，
         服务端其实已经存好了，这里却拿不到地址。 */
      var body = r.text().catch(function () { return ''; });
      if (!r.ok) return body.then(function () { return done(''); });
      return body.then(function () { return done(base + '/storage/v1/object/public/posters/' + name); });
    }).catch(function () { return done(''); });
  }

  /* 长图太大（1162×6576、1MB 出头），手机网络上传要十秒开外。
     缩到宽 900 之后体积掉一半多，上传快得多，而长按保存根本不在乎像素 ——
     这张图是拿去发朋友圈的，不是拿去印刷的。 */
  function shrinkPNG(dataURL, maxW) {
    return new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () {
        var w = img.naturalWidth, h = img.naturalHeight;
        if (!w || !h) return resolve('');
        var k = Math.min(1, (maxW || 900) / w);
        var c = document.createElement('canvas');
        c.width = Math.round(w * k);
        c.height = Math.round(h * k);
        var g = c.getContext('2d');
        g.fillStyle = '#fff';
        g.fillRect(0, 0, c.width, c.height);
        g.drawImage(img, 0, 0, c.width, c.height);
        try { resolve(c.toDataURL('image/png')); } catch (e) { resolve(''); }
      };
      img.onerror = function () { resolve(''); };
      img.src = dataURL;
    });
  }

  /* 内容指纹：answers + checked 一变，之前传好的那张图就作废 */
  function imgKeyNow() {
    try {
      return (S.answers || []).join(',') + '|' + JSON.stringify(S.checked || {});
    } catch (e) { return String(Date.now()); }
  }

  /* 出结果后立刻在后台把长图传好。
     为什么不等到点「保存长图」再传：那时才开始传，买家得对着一张还不能长按的
     图干等十秒，多数人会先按一下 —— 按到的还是 blob 图，没有菜单，等于白做。
     提前传完，点开就是网络图，按下去立刻有菜单。传失败不吭声，走原来的兜底。 */
  function prewarmPoster() {
    if (!S.an || typeof html2canvas !== 'function') return;
    var key = imgKeyNow();
    if (S.remoteImg && S.imgKey === key) return;
    S.remoteImg = null; S.imgKey = key; S.imgBlob = null;
    S.prewarm = PO.render(S.an, CFG, S.checked).then(function (res) {
      S.img = res.url;
      return shrinkPNG(res.url, 900).then(function (small) {
        var d = small || res.url;
        try { S.imgBlob = PO.dataURLtoBlob(d); } catch (e) { }
        return uploadPoster(d);
      });
    }).then(function (remote) {
      /* 期间又改了内容就别认这笔 —— 留着会给出一张跟当前结果对不上的图 */
      if (remote && S.imgKey === key) S.remoteImg = remote;
    }).catch(function () { });
  }

  function isIOS() { return /iPhone|iPad|iPod/i.test(ua); }
  function isAndroid() { return /Android/i.test(ua); }
  /* 小红书内置浏览器：长按图片**实测没有菜单**（百万 2026-10-25 实测），
     所以这个环境里长按保存这条路是死的 —— 必须换一条，见 openBrowserSave。 */
  function isXHS() { return /Xiaohongshu|xhs|Rednote|RedNote/i.test(ua); }
  /* 注意：文件开头已经有一个同名的布尔变量 isWeChat（别再定义成函数，
     同名 var 会把它盖掉，调用时就是 "is not a function"）—— 直接用那个变量。 */
  /* 是不是 App 内置的 WebView。
     光认 UA 里的 App 名不稳 —— 小红书有些版本的 UA 是伪装成系统 Chrome 的，
     认不出来就会把人送进一个按了没反应的长按层。所以这里加一条更硬的证据：
     Android 的 WebView 一定会在 UA 里带 "; wv)"，而系统 Chrome / 自带浏览器**没有**。
     两个信号取并集，伪装也能认出来。 */
  function isAppWebview() {
    if (isIOS()) return /MicroMessenger|Weibo|QQ\/|Xiaohongshu|xhs|Rednote|AlipayClient|DingTalk/i.test(ua);
    return /;\s*wv\)/i.test(ua)
      || /Xiaohongshu|xhs|Rednote|MicroMessenger|Weibo|QQ\/|AlipayClient|DingTalk/i.test(ua);
  }

  /* 这台设备上一次测的结果直接还给他 —— 并且明说「这是上次的」。
     以前这里一律清空重来：关掉页面再点订单链接就得重新做 18 道题，
     买家的第一反应是「我买的东西坏了」。现在改成有就还，顶部挂说明 +
     「换个人测」，想重测一步就能重测。 */
  function showSavedResult(saved) {
    S.answers = saved.a.slice();
    S.share = saved.s || null;
    S.checked = saved.c || {};
    S.an = QZ.analyze(S.answers);
    S.mode = 'own';
    S.finished = true;
    S.restored = true;
    S.restoredAt = saved.t || null;
    history.replaceState(null, '', '#/result');
    renderResult();
  }

  /* 系统分享面板 —— **iOS 上真能存进相册的那条路**。
     之前走的是「下载」：iOS Safari 下载只会进「文件 → 下载」，安卓进 Download 目录，
     两个都不在相册里，买家打开相册找不到，第一反应就是「根本没存上」。
     而 iOS 的系统分享面板里一定有「存储到照片」（就在第一排），点一下直接进相册；
     顺带还能直接发微信 —— 图片不受域名限制，正好绕开微信拦外链那个坑。

     **安卓不走这条**：安卓的分享面板里没有「存储到照片」这一项，全是分享给某个 App，
     点了之后系统照样提示"已分享"，买家以为存进了相册，打开相册却是空的 ——
     这正是实测里踩到的坑。安卓唯一确定能进相册的是「长按图片 → 保存图片」，见 openPreview。
     同步返回 'unsupported' 而不是 Promise，是为了能在点击的同一轮里立刻发起
     navigator.share —— iOS 要求它在用户手势内调用，绕一圈异步就会失活。 */
  function shareImage() {
    var name = S.imgName || '疲惫类型自测.png';
    if (!isIOS()) return 'unsupported';
    if (!S.imgBlob || typeof File !== 'function') return 'unsupported';
    if (!navigator.share || !navigator.canShare) return 'unsupported';
    var file;
    try { file = new File([S.imgBlob], name, { type: 'image/png' }); }
    catch (e) { return 'unsupported'; }
    var can = false;
    try { can = navigator.canShare({ files: [file] }); } catch (e) { can = false; }
    if (!can) return 'unsupported';
    return navigator.share({ files: [file] }).then(function () { return 'ok'; })
      .catch(function (e) { return (e && e.name === 'AbortError') ? 'cancelled' : 'unsupported'; });
  }

  /* 「这份结果」的网址 —— 带 ?r= 分享码，打开就是这一份答案，
     所以换到别的浏览器打开也不用重新答 18 道题。 */
  function ownResultUrl() {
    return location.origin + location.pathname + '?r=' + encodeURIComponent(S.share || '') + '&own=1';
  }

  /* 分享码是随结果一起生成的；万一点保存时还没生成好（网络慢），这里补一次 */
  function ensureShare() {
    if (S.share) return Promise.resolve(S.share);
    if (!S.token || !S.an || !S.finished) return Promise.resolve('');
    return api('/api/share', { method: 'POST', body: { token: S.token, answers: S.answers } })
      .then(function (r) {
        if (r && r.ok && r.share) { S.share = r.share; saveResult(); return S.share; }
        return '';
      }).catch(function () { return ''; });
  }

  function copyText(text, okMsg, failMsg) {
    var done = function (ok) { toast(ok ? okMsg : failMsg, 3400); };
    var el = document.createElement('textarea');
    el.value = text;
    el.setAttribute('readonly', '');
    el.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
    document.body.appendChild(el);
    var ok = false;
    try {
      el.select(); el.setSelectionRange(0, text.length);
      ok = document.execCommand('copy');
    } catch (e) { }
    document.body.removeChild(el);
    if (!ok && navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(false); });
      return;
    }
    done(ok);
  }

  /* 小红书内置浏览器里长按图片没有菜单 —— 摆一个长按层就是骗人。
     所以这个环境里「保存长图」只做一件事：把**带着结果**的网址交给他，
     让他粘贴到手机浏览器打开，浏览器里长按是能存的（那张图本来就在 https 图床上）。 */
  /* 试着把这份结果**直接甩到手机浏览器里打开** —— 不打扰用户做任何选择。
     只敢用 intent:// 这一种，而且必须带 fallback：
       - intent 是 Chrome 内核**认得**的 scheme，认得就一定会按规则处理（能唤起就唤起，
         唤不起就走 fallback 地址），不会甩一个「无法打开网页」的错误页给买家；
       - googlechrome:// 这类裸 scheme 试过，内核不认就直接跳错误页，把页面整个搞没了，
         比不跳还糟，所以不用。
     两发：先指定 Chrome（装了就直接开），再不指定包名（让系统弹「用哪个浏览器打开」）。
     每试一次都盯一眼页面有没有被切走（pagehide / visibilitychange / blur），
     切走了就说明成功跳出去了，后面不必再试；三次都没出去才认输、给全屏引导。
     fallback 地址统一带 &xhsguide=1 —— 万一 App 不认 intent、把 fallback 在自家
     WebView 里打开了，那一屏也会自动把引导弹出来，不会变成"跳了一下又回到原地"。 */
  function tryOpenExternal(url, onFail) {
    var left = false;
    function mark() { left = true; }
    window.addEventListener('pagehide', mark);
    window.addEventListener('blur', mark);
    document.addEventListener('visibilitychange', function () { if (document.hidden) mark(); });

    var fb = url + '&xhsguide=1';
    var noScheme = url.replace(/^https?:\/\//i, '');
    var steps = [];
    if (isAndroid()) {
      steps.push('intent://' + noScheme + '#Intent;scheme=https;package=com.android.chrome;'
        + 'S.browser_fallback_url=' + encodeURIComponent(fb) + ';end');
      steps.push('intent://' + noScheme + '#Intent;scheme=https;'
        + 'S.browser_fallback_url=' + encodeURIComponent(fb) + ';end');
    } else {
      steps.push(null);   /* iOS 没有可靠的唤起方式，只能开个新标签试试 */
    }
    var i = 0;
    (function next() {
      if (left) return;
      if (i >= steps.length) { setTimeout(function () { if (!left) onFail(); }, 300); return; }
      var s = steps[i++];
      try {
        if (s === null) window.open(fb, '_blank');
        else location.href = s;
      } catch (e) { }
      setTimeout(next, 700);
    })();
  }

  /* 跳不出去时的那一屏 —— 大字、指名右上角那个按钮，不再是一行没人看的小字。 */
  function showBrowserGuide(url) {
    var d = document.createElement('div');
    d.className = 'mask guide';
    d.innerHTML = '<div class="modal">'
      + '<button class="close">×</button>'
      + '<h2 class="gtitle">点右上角「···」<br>选「在浏览器打开」</h2>'
      + '<p>这个 App 里存不了图片（长按没有反应）。在手机浏览器里打开，就能存进相册 —— '
      + '打开的还是<b>你刚才这份结果</b>，不用重新做一遍。</p>'
      + '<ol class="steps">'
      + '<li>点屏幕右上角的 <b>···</b></li>'
      + '<li>选 <b>在浏览器中打开</b></li>'
      + '<li>打开后点 <b>保存长图</b> → 按住图片 → 选「下载图片 / 存储到照片」</li>'
      + '</ol>'
      + '<button class="btn" id="gRetry" type="button">再试一次自动打开</button>'
      + (url ? '<button class="btn line" id="gCopy" type="button" style="margin-top:10px" data-url="' + esc(url) + '">复制网址（备用）</button>' : '')
      + '</div>'
      /* 箭头钉在屏幕右上角 —— 就是那个「···」的位置，比任何一行说明都管用 */
      + '<div class="garrow">↗</div>';
    document.body.appendChild(d);
    function close() { if (d.parentNode) d.parentNode.removeChild(d); }
    d.querySelector('.close').onclick = close;
    d.onclick = function (e) { if (e.target === d) close(); };
    var rt = d.querySelector('#gRetry');
    if (rt) rt.onclick = function () { close(); tryOpenExternal(url, function () { showBrowserGuide(url); }); };
    var cp = d.querySelector('#gCopy');
    if (cp) cp.onclick = function () {
      copyText(cp.getAttribute('data-url') || url, '网址已复制 —— 粘贴到手机浏览器打开', '复制失败 —— 请手动记下网址');
    };
  }

  /* 内置浏览器里的「保存长图」：先拿到带结果的网址，再试着直接跳浏览器 */
  function openBrowserSave() {
    showLoading('正在打开浏览器…');
    ensureShare().then(function (share) {
      if (!share) { hideLoading(); showBrowserGuide(''); return; }
      var url = ownResultUrl();
      tryOpenExternal(url, function () { hideLoading(); showBrowserGuide(url); });
    });
  }

  function posterFail() {
    openInfoModal('生成失败', '<p>抱歉，自动生成图片的时候出错了。</p><p>你可以直接对当前页面截屏保存，效果是一样的。</p>');
  }

  /* 安卓的保存入口：把已经备好的网络长图铺开，让买家长按。
     图没备好就等后台那一份 —— **不在这里重新渲染**，之前重复渲染导致
     点第二次还要再卡好几秒。 */
  function openPosterSave(name) {
    if (S.imgBlob && S.imgKey === imgKeyNow()) {
      openPreview(S.remoteImg || S.img, name);
      return;
    }
    showLoading('正在准备图片…');
    var wait = S.prewarm || Promise.resolve(null);
    var to = setTimeout(function () { hideLoading(); }, 15000);
    wait.then(function () {
      clearTimeout(to); hideLoading();
      if (!S.img) { posterFail(); return; }
      openPreview(S.remoteImg || S.img, name);
    }).catch(function () {
      clearTimeout(to); hideLoading(); posterFail();
    });
  }

  function saveImage() {
    if (!S.an) return;
    if (typeof html2canvas !== 'function') {
      openInfoModal('暂时无法生成图片', '<p>这个浏览器不支持自动生图。</p><p>你可以直接对当前页面连续截图保存，内容是一样的。</p>');
      return;
    }
    var name = '疲惫类型自测-' + String(S.an.title).replace(/[\s×]/g, '') + '.png';
    S.imgName = name;

    /* 小红书 / App 内置浏览器（微信除外，微信长按是通的）：长按实测按了没反应，
       这里就不再摆长按层 —— 直接试着把这份结果甩到手机浏览器里打开。 */
    if (isXHS() || (isAndroid() && isAppWebview() && !isWeChat)) { openBrowserSave(); return; }

    /* 安卓：只有「长按图片 → 保存图片」这一条路（理由见 shareImage 的注释），
       所以直接把图铺开让他按，不在分享面板上浪费一次点击。 */
    if (isAndroid()) { openPosterSave(name); return; }

    /* 图已经备好了 → 就在这一次点击里同步发起系统分享，保住 iOS 要的用户手势 */
    if (S.imgBlob && S.imgKey === imgKeyNow()) {
      var r = shareImage();
      if (r === 'unsupported') { fallbackSave(name); return; }
      r.then(function (res) { if (res !== 'ok') fallbackSave(name); }).catch(function () { fallbackSave(name); });
      return;
    }

    /* 还没备好：等后台那一份就行，**不要在这里再渲染一次** ——
       之前就是重复渲染，买家点第二次还要再卡好几秒。 */
    showLoading('正在准备图片…');
    var wait = S.prewarm || Promise.resolve(null);
    var to = setTimeout(function () { hideLoading(); }, 15000);
    wait.then(function () {
      clearTimeout(to); hideLoading();
      if (!S.imgBlob) {
        openInfoModal('生成失败', '<p>抱歉，自动生成图片的时候出错了。</p><p>你可以直接对当前页面截屏保存，效果是一样的。</p>');
        return;
      }
      var r2 = shareImage();
      if (r2 === 'unsupported') { fallbackSave(name); return; }
      r2.then(function (res) { if (res !== 'ok') fallbackSave(name); }).catch(function () { fallbackSave(name); });
    }).catch(function () {
      clearTimeout(to); hideLoading();
      openInfoModal('生成失败', '<p>抱歉，自动生成图片的时候出错了。</p><p>你可以直接对当前页面截屏保存，效果是一样的。</p>');
    });
  }

  /* 系统分享用不了 / 被取消时的兜底 —— 依然只有一个动作 */
  function fallbackSave(name) {
    /* 电脑上没有"长按保存"这回事，右键另存为也不如直接下载省事 */
    var desk = !/Android|iPhone|iPad|iPod|Mobile/i.test(ua) && canDownload();
    if (desk && S.remoteImg) {
      download(S.remoteImg, name);
      toast('已保存 —— 去「下载」文件夹里看看', 3200);
      return;
    }
    if (S.remoteImg) { openPreview(S.remoteImg, name); return; }
    if (S.img) { openPreview(S.img, name); return; }
    openInfoModal('生成失败', '<p>抱歉，自动生成图片的时候出错了。</p><p>你可以直接对当前页面截屏保存，效果是一样的。</p>');
  }

  /* 长图预览层 —— **只有「长按保存」一条路**。
     为什么不给按钮：App 内置浏览器里点了没反应（见 canDownload 的说明），
     而「长按图片 → 保存图片」是这类 WebView 里唯一走得通的一条路
     （iOS WKWebView 和 Android WebView 都提供这个长按菜单）。
     这里因此不摆任何「保存方式」按钮，只把图铺满 + 一句话说清怎么存，
     免得买家在三条路之间挑，挑错了还以为是自己手机的问题。 */
  function openPreview(url, name) {
    /* 先用本地 blob 立刻显示（不等网络），随后如果传上去了就把 src 换成
       https 地址 —— 换的只是地址，画面一模一样，但长按能不能存全靠它。 */
    var isRemote = /^https?:\/\//i.test(url);
    var showUrl = url, objectUrl = null;
    if (!isRemote) {
      try {
        objectUrl = URL.createObjectURL(PO.dataURLtoBlob(url));
        showUrl = objectUrl;
      } catch (e) { /* 拿不到 blob 就退回 dataURL，不影响长按 */ }
    }

    var inApp = !canDownload();                       /* 微信 / 小红书 / QQ 内置浏览器 */
    var ios = isIOS();
    var desktop = !/Android|iPhone|iPad|iPod|Mobile/i.test(ua);
    /* 菜单里那一项的叫法每个环境都不一样，写错了买家对着菜单找不到 */
    var menuWord = desktop ? '「图片另存为」' : (ios ? '「存储到照片」' : (inApp ? '「保存图片」' : '「下载图片」'));
    var title = desktop ? ('在图片上点右键 → ' + menuWord) : ('按住图片 2 秒 → 点' + menuWord);
    function hintText(remote) {
      /* 长按这条路不是每个 App 都通（小红书实测就不通），所以永远留一句退路 */
      var tail = desktop ? '' : '<br><br>长按没反应：点右上角「···」→「用浏览器打开」，再点一次「保存长图」。';
      if (!remote) return '这张图还没传到网上，长按可能没有菜单。<br>点右上角「···」→「用浏览器打开」，再点一次「保存长图」。';
      if (desktop) return '在图上点右键，选' + menuWord + '，就能存到电脑里。';
      if (ios) return '手指按在图上别松开，等菜单弹出来，点' + menuWord + '，图就存进相册了。' + tail;
      if (inApp) return '手指按在图上别松开，等菜单弹出来，点' + menuWord + '。<br>存好后打开手机「相册」—— 微信里存的图在「微信」这个相册文件夹里。' + tail;
      return '手指按在图上别松开，等菜单弹出来，点' + menuWord + '。<br>存好后打开「相册」→「下载」文件夹就能看到。' + tail;
    }

    var d = document.createElement('div');
    d.className = 'pv';
    d.innerHTML =
      '<button class="pvx" id="pvClose" type="button" aria-label="关闭">×</button>'
      + '<div class="pvbar"><b id="pvTitle">' + esc(title) + '</b></div>'
      + '<div class="pvbody"><img src="' + showUrl + '" alt="我的测评结果长图">'
      + '<div class="hint" id="pvHint">' + hintText(isRemote) + '</div>'
      + '</div>';
    document.body.appendChild(d);

    function close() {
      if (d.parentNode) d.parentNode.removeChild(d);
      if (objectUrl) { try { URL.revokeObjectURL(objectUrl); } catch (e) { } }
    }
    d.querySelector('#pvClose').onclick = close;

    if (!isRemote) {
      var img = d.querySelector('img');
      uploadPoster(url).then(function (remote) {
        /* 只有在浮层还开着、且真的传成功了才换 —— 换失败保持本地图 */
        if (!remote || !img || !img.parentNode || !d.parentNode) return;
        img.src = remote;
        /* 图换成网络地址了，说明长按有戏，把提示也换成对应的那句话 */
        var h = d.querySelector('#pvHint'), t = d.querySelector('#pvTitle');
        if (t) t.textContent = title;
        if (h) h.innerHTML = hintText(true);
      });
    }
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
  function showShared(code, own) {
    S.mode = own ? 'own' : 'shared';
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
      /* own=1：这是本人从小红书复制过来存图的链接，内容就是他刚测的那份。
         写回本机缓存 —— 之后他直接点订单里的链接也能回到这份结果，不用重测；
         同时分享码留在本地，再点「保存长图」不用重新联网生成。 */
      if (own) {
        S.share = code;
        S.finished = true;
        S.restored = false; S.restoredAt = null;
        S.checked = S.checked || {};
        saveResult();
        history.replaceState(null, '', '#/result');
        renderResult();
        window.scrollTo(0, 0);
        /* xhsguide=1 说明这是「自动跳浏览器」失败后 fallback 回落到这个 App 里打开的 ——
           人还在 App 里，长按依然存不了，所以直接把引导弹出来，别让他对着结果页发呆。 */
        if (qsGet('xhsguide') === '1') setTimeout(function () { showBrowserGuide(ownResultUrl()); }, 700);
        return;
      }
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
        try { localStorage.removeItem(K_PROG); } catch (e) { }
        /* 这台设备上还留着上一份结果 → 直接还给他（顶部会挂「这是上次测的」+
           「换个人测」），不要让他再答一遍 18 道题。
           以前这里是一律清空重来：关掉页面再点订单链接就从第一题开始，
           买家只会以为自己买的东西坏了。 */
        var saved = readResult();
        if (saved) { showSavedResult(saved); return; }
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
    /* 分享链接优先走查询串（?r=xxx），hash 版当兜底 —— 见 qsGet 的说明。
       own=1 表示这是本人从小红书复制过来存图的链接，不是朋友转发来的。 */
    var shared = qsGet('r');
    if (shared) { showShared(shared, qsGet('own') === '1'); return; }
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
          /* 这台设备上一次测的结果被调了出来 —— 必须让他一眼看出「这是旧的」，
             否则同一个人换台手机、或者下一个人拿这台手机点开链接，都会以为
             「我刚买的怎么直接给我看别人的结果」。 */
          showSavedResult(saved);
        } else if (S.unlimited) {
          /* 永久码 + 本地缓存没了：不装作「结果丢了」，直接让他重来一轮 */
          showLanding();
        } else {
          showLostResult();
        }
        return;
      }
      if (h === 'result' && saved) { showSavedResult(saved); return; }
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
