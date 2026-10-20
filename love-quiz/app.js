/* 主流程：密码入口 → 答题（可回退）→ 结果 → 长图 / 分享 / 让 TA 也测一次

   这份是恋爱方向的独立站点，和疲惫款不共用任何东西：
   - 数据库函数全部带 love_ 前缀（见下面 ROUTES）；
   - 本地存储的键名全部带 love_ 前缀。
     后者尤其重要：两个站都部署在同一个 GitHub Pages 域名下，localStorage
     是同源共享的，键名不分开的话，在一边登录会影响另一边。 */
(function () {
  'use strict';
  var QD = window.QD, QZ = window.QZ, PO = window.PO;
  var N = QD.QUESTIONS.length;
  var ua = navigator.userAgent || '';
  var isMobile = /Android|iPhone|iPad|iPod|HarmonyOS|Mobile|MicroMessenger/i.test(ua);
  var isWeChat = /MicroMessenger/i.test(ua);

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
      return BE.rpc('love_public_config', {});
    },
    '/api/redeem': function (b) {
      return BE.rpc('love_redeem', {
        p_code: b.code,
        p_token: b.token || null,
        p_device: BE.device()
      });
    },
    '/api/session': function (b) {
      return BE.rpc('love_session', { p_token: b.token });
    },
    '/api/share': function (b) {
      return BE.rpc('love_save_result', {
        p_token: b.token,
        p_answers: b.answers,
        p_main: (S.an && S.an.ta) ? S.an.ta.key : null,
        p_index: (S.an && S.an.pct) != null ? S.an.pct : null
      });
    },
    '/api/retest': function (b) {
      return BE.rpc('love_can_retest', { p_token: b.token });
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
      return BE.rpc('love_get_shared', { p_share: m ? decodeURIComponent(m[1]) : '' });
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
    unlimited: false
  };
  var K_TOKEN = 'love_token_v1', K_RESULT = 'love_result_v1', K_PROG = 'love_prog_v1';
  var K_UNL = 'love_unl_v1';
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
    return s || '恋爱型号自测';
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
      + '<div class="bct">还没有测试密码？</div>'
      + go
      + '<div class="bcs">拍下自动发货，密码发到小红书订单消息里</div>'
      + '</div>';
  }
  function bindBuy() {
    var b = $('buyBtn') || $('barBuyBtn') || $('mBuyBtn');
    if (b) b.onclick = openBuyModal;
  }
  function openBuyModal() {
    var key = shopKey();
    var h = '<p>这个测评要一张测试密码才能开始，密码在小红书店铺里自动发货。</p>'
      + '<ol class="steps">'
      + '<li>打开小红书 App，搜索「' + esc(key) + '」；</li>'
      + '<li>找到这个测评，拍下付款；</li>'
      + '<li>付款后自动发货，密码会发到你的订单消息里；</li>'
      + '<li>回到这个页面，输入密码就能测。</li>'
      + '</ol>'
      + '<button class="btn line" id="mCopyKey" type="button">复制搜索词「' + esc(key) + '」</button>';
    openInfoModal('怎么拿到测试密码', h);
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
        try { sessionStorage.setItem('love_fromqr_v1', '1'); } catch (e) { }
        return true;
      }
      return sessionStorage.getItem('love_fromqr_v1') === '1';
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
    return '<div class="buytip dim">买过了但找不到密码？'
      + '<button class="mini" id="kefuCopy" type="button">联系客服</button></div>';
  }
  function bindKefu() {
    var b = $('kefuCopy');
    if (b) b.onclick = function () { openInfoModal('怎么联系客服', KEFU_GUIDE); };
  }

  /* ---------------- 密码入口 ---------------- */
  function showGate() {
    S.mode = 'own';
    $('actbar').classList.add('hide');
    $('view-gate').innerHTML =
      '<div class="brand">' + esc(CFG.shopName || '恋爱型号自测') + '</div>'
      + '<h1>' + esc(CFG.quizTitle || 'TA 的喜欢，是哪一种型号？') + '</h1>'
      + '<p class="lead">你不是想知道 TA 喜不喜欢你 ——<br>你是想知道，TA 的喜欢到底是什么形状的。</p>'
      + (fromQR() ? qrChipHTML() : '')
      + '<div class="facts"><span class="fact">20 道题 · 约 3 分钟</span><span class="fact">TA 的型号 + 你的型号</span><span class="fact">42 种组合的相处建议</span></div>'
      + buyHTML()
      + '<div class="gate">'
      + '<h2>请输入测试密码</h2>'
      + '<p class="tip">密码在商品详情页 / 小红书订单消息里，已购买的订单会自动发货。一个密码可以完整测试一次。</p>'
      + (SB_PROBLEM
        ? '<div class="msg err" style="margin:0 0 12px">' + esc(SB_PROBLEM)
          + '若持续出现，可以在小红书订单里联系店铺客服。</div>'
        : '')
      + '<div class="pin"><input id="pwd" type="text" inputmode="text" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="例如 LOVE-8F3K-2M9Q" maxlength="24"></div>'
      + '<button class="btn" id="goBtn">验证并开始</button>'
      + '<div class="msg" id="gmsg"></div>'
      + '</div>'
      + kefuHTML()
      + '<div class="box" style="margin-top:14px"><p><b>怎么作答：</b>前 10 题答你看到的 TA，后 10 题答你自己。不用想太久，凭第一反应选频率就行，没有对错。</p>'
      + '<p><b>你会得到：</b>TA 的表达型号、你的喜欢型号、你们俩的咬合方式，外加三条现在就能做的动作。</p></div>';
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
    if (!v) { msg.className = 'msg err'; msg.textContent = '请先输入密码。'; return; }
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
            toast('这是你上次测的结果 —— 一个密码只能测一次，想再测需要新的密码', 3600);
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
              toast('这是你上次测的结果 —— 一个密码只能完整测一次', 3600);
            } else {
              showLostResult();
            }
            return;
          }
          setTimeout(showLanding, 320);
        });
      } else {
        msg.className = 'msg err';
        msg.innerHTML = esc((r && r.message) || '密码验证失败，请检查后重试。');
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
      '<div class="brand">' + esc(CFG.shopName || '恋爱型号自测') + '</div>'
      + '<h1>' + esc(CFG.quizTitle || 'TA 的喜欢，是哪一种型号？') + '</h1>'
      + '<p class="lead">你不是想知道 TA 喜不喜欢你 ——<br>你是想知道，TA 的喜欢到底是什么形状的。</p>'
      + '<div class="facts"><span class="fact">20 道题 · 约 3 分钟</span><span class="fact">TA 的型号 + 你的型号</span><span class="fact">42 种组合的相处建议</span></div>'
      + '<div class="box">'
      + '<p><b>怎么作答：</b>前 10 题答你看到的 TA，后 10 题答你自己。凭第一反应选频率就行，没有对错，答完也能返回上一题改。</p>'
      + '<p><b>你会得到：</b>TA 的表达型号、你的喜欢型号、你们俩的咬合方式，外加三条现在就能做的动作。结果可以存成一张长图带走。</p>'
      + '</div>'
      + '<button class="btn" id="startBtn">开始测试</button>'
      + '<div class="msg ok" style="text-align:center">密码已验证 · 本次可完整测试一次</div>';
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
    var grp = QD.QUESTIONS[S.idx].g;
    $('pnum').textContent = '第 ' + (S.idx + 1) + ' / ' + N + ' 题'
      + (grp === 'me' ? ' · 关于你自己' : ' · 关于 TA');
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
          toast('这是你上次测的结果 —— 一个密码只能完整测一次', 3600);
          return;
        }
        saveResult();
      }
    });
  }

  /* ==========================================================================
     结果页
     ---------------------------------------------------------------------------
     结构原则（改版时定的，别随手打乱）：
       封面一屏给结论（型号 + 组合 + 贴合度 + 三个关键指标）→
       ① TA 怎么表达 ② 你怎么喜欢 ③ 你们卡在哪 → 一句金句 → 动作/钩子 → 免责
     每一段最多一个「白卡」，其余用无卡片的正文 / 黄卡 / 粉卡区分层次，
     否则 8 张一模一样的白卡排下来读者眼睛没有落点。
     ========================================================================== */
  function resultHTML(an, mode) {
    var ta = an.ta, me = an.me, m = an.match, h = '';
    var mine = (mode === 'own');
    var L = QZ.levelOf;
    var ts = an.taScores, ms = an.meScores;

    /* TA 在「给」什么 / 你在「等」什么 —— 取各自最突出的那个维度自动生成，
       不用手写 42 格，而且永远和上面的维度条一致。
       排序用「实际得分 + 型号特征」各占一半：只看实际得分的话，
       供养型这种 P 和 S 都满分的会取到「主动靠近」，可它的招牌明明是做事；
       加上型号特征坐标就能压回「时间和行动」。 */
    var TA_GIVE = { P: '主动靠近', Q: '把话说清楚', R: '忽冷忽热的存在感', S: '时间和行动' };
    var ME_WAIT = { M: '一句明确的确认', N: '被稳稳地放在心上', O: '你先迈出的那一步' };
    function topDim(scores, dims, vec) {
      var best = dims[0], bestScore = -1;
      dims.forEach(function (d) {
        var sc = (scores[d] | 0) * 0.5 + ((vec && vec[d]) | 0) * 0.5;
        if (sc > bestScore) { bestScore = sc; best = d; }
      });
      return best;
    }
    var giveKey = topDim(ts, QD.TA_DIMS, ta.vec), waitKey = topDim(ms, QD.ME_DIMS, me.vec);

    /* 投入浓度的「人话」，替掉原来那条和维度条重复的进度条 */
    var concText = an.concentration >= 80 ? '你已经把心放得很进去了，任何一点风吹草动都会被放大。'
      : an.concentration >= 60 ? '你投入得不轻，但还给自己留了一条退路。'
        : an.concentration >= 40 ? '你在投入和观望之间来回摆，还没定下来。'
          : '你还在门口站着，没真正走进去。';

    /* ---------- 封面：一屏之内把三件事说清 ---------- */
    h += '<div class="hero">';
    h += '<div class="hlab">TA 的表达型号</div>';
    h += '<div class="hname">' + esc(ta.title) + '</div>';
    h += '<div class="hsub">' + esc(ta.name) + ' · ' + esc(ta.sub) + '</div>';
    h += '<div class="hdiv"></div>';
    h += '<div class="hlab">你和 TA 的组合</div>';
    h += '<div class="hcombo">' + esc(m.name) + '</div>';
    h += '<div class="fit"><i style="width:' + an.pct + '%"></i></div>';
    h += '<div class="fitmeta"><span>贴合度</span><b>' + an.pct + '</b><em>' + esc(an.band) + '</em></div>';
    /* 声明放在封面卡里收尾：它很重要（不写清楚会被当成「不准」），
       但单独占一块放在正文中间会劝退 —— 读者还没读到内容就先被告知「这可能不对」。 */
    h += '<div class="heroNote">这份结果描述的是<b>你感受到的那个 TA</b>，不是 TA 本人，也不代表 TA 的真实想法。</div>';
    h += '</div>';

    /* 三个最关键的数字，直接给人话等级 */
    h += '<div class="kpi">';
    h += '<div class="k"><b>' + L(ts.P) + '</b><span>TA 主动</span></div>';
    h += '<div class="k"><b>' + L(ts.Q) + '</b><span>TA 把话说清</span></div>';
    h += '<div class="k"><b>' + L(ms.M) + '</b><span>你要的确认</span></div>';
    h += '</div>';

    h += '<div class="qcard">' + esc(ta.def) + '</div>';

    /* ---------- ① TA 是这样表达喜欢的 ---------- */
    h += '<div class="sec"><div class="sect">① TA 是这样表达喜欢的</div>';
    h += '<div class="chart">' + QZ.barsSVG(ts, QD.TA_DIMS, { label: 'TA 的四个维度' }) + '</div>';

    /* 引用体代替 bullet —— 这是全篇最该被记住的三句话 */
    h += '<div class="qbox"><div class="qlab">TA 这样的时候，其实是在说</div>';
    ta.signal.forEach(function (x) {
      h += '<p class="q">「' + esc(x) + '」</p>';
    });
    h += '</div>';

    h += '<div class="blk warn"><div class="lb">你最容易误读成</div><p>' + esc(ta.miss) + '</p></div>';

    /* 解释性内容 + 「你可以这样接」收进折叠区：想深挖的人点开，只看结论的人不用滚过去。
       ta.do 不能删 —— 这三条是针对这个型号的接法，和 ③ 段那个组合级的动作不重复。 */
    h += '<details class="acc"><summary><span>关于「' + esc(ta.name) + '」：TA 平时什么样</span></summary><div class="accin">';
    ta.why.forEach(function (p) { h += '<p>' + p + '</p>'; });
    h += '<p>' + esc(ta.day) + '</p>';
    h += '<p class="accdo">你可以这样接：</p><ul class="accdo-ul">';
    ta.do.forEach(function (x) { h += '<li>' + x + '</li>'; });
    h += '</ul>';
    h += '</div></details>';
    h += '</div>';

    /* ---------- ② 你是在这样喜欢的 ---------- */
    h += '<div class="sec"><div class="sect">② 你是在这样喜欢的</div>';
    h += '<div class="rname2">' + esc(me.name) + '</div>';
    h += '<div class="qcard">' + esc(me.def) + '</div>';
    h += '<div class="chart">' + QZ.barsSVG(ms, QD.ME_DIMS, { label: '你的三个维度' }) + '</div>';
    h += '<div class="conc">你的投入浓度 <b>' + L(an.concentration) + '</b> —— ' + concText + '</div>';

    h += '<div class="qbox"><div class="qlab">你怎么喜欢一个人</div>';
    h += '<p class="q">' + esc(me.way) + '</p></div>';

    /* 标题刻意和 ① 的「你最容易误读成」区分开：那一块说的是「你怎么看 TA」，
       这一块说的是「你一直以来的模式」，否则读者会觉得同一句话说两遍。 */
    h += '<div class="blk warn"><div class="lb">你一直以来的盲区</div><p>' + esc(me.blind) + '</p></div>';
    /* need 本身以「你需要…」开头，前面别再拼「你真正需要的，是」 */
    h += '<div class="qcard">' + esc(me.need) + '</div>';

    h += '<details class="acc"><summary><span>为什么会变成这样</span></summary><div class="accin">';
    me.why.forEach(function (p) { h += '<p>' + p + '</p>'; });
    h += '</div></details>';
    h += '</div>';

    /* ---------- ③ 你们卡在哪一段 ---------- */
    h += '<div class="sec"><div class="sect">③ 你们卡在哪一段</div>';
    h += '<div class="swap">'
      + '<div class="sw swa"><div class="swlab">TA 在给</div><div class="swval">' + TA_GIVE[giveKey] + '</div></div>'
      + '<div class="swarrow">↔</div>'
      + '<div class="sw swb"><div class="swlab">你在等</div><div class="swval">' + ME_WAIT[waitKey] + '</div></div>'
      + '</div>';
    h += '<div class="qbox"><div class="qlab">所以你们卡在这里</div><p class="q">' + esc(m.stuck) + '</p></div>';

    /* 三条动作做成可勾选的步骤 —— 勾完存本地，回来还在 */
    h += '<div class="steps"><div class="stepshead">现在就能做的三件事<em id="fixcount">今天完成了 0 / 3</em></div><ul id="fixlist">';
    m.tips.forEach(function (t, i) {
      h += '<li data-i="' + i + '"' + (S.checked && S.checked[i] ? ' class="on"' : '') + '>'
        + '<i class="tick"></i><p>' + esc(t) + '</p></li>';
    });
    h += '</ul></div>';
    h += '</div>';

    h += '<div class="last">表达方式是可以学的，接收方式也是。你们中间差的那部分，叫翻译。</div>';

    if (mine) {
      /* 复购钩子：测完 TA 的人，下一步一定想知道「那 TA 眼里的我呢」 */
      h += '<div class="box again"><p><b>想看看 TA 眼里的你？</b><br>让 TA 也拍一份测一次，两份结果放在一起看，才知道你们到底差在哪一段。</p>'
        + '<button class="btn gold sm" id="againBtn" type="button">给 TA 也拍一份 →</button></div>';
      /* 这一款不做返现，好评只能靠一句零成本的话去要 */
      h += '<div class="praiseline">说中了的话，回去给个好评吧 —— 那是我继续做下去的理由。</div>';
      if (!S.resultAt && !S.finished) {
        h += '<button class="btn ghost sm" id="retestBtn">再测一次</button>';
      }
      h += '<div class="switchrow">手上还有一张新密码？'
        + '<button class="mini" id="switchBtn" type="button">换个密码</button></div>';
    }

    h += '<div class="disc">' + esc(QD.DISCLAIMER).replace(/\n/g, '<br>') + '</div>';
    return h;
  }

  function updateFixCount() {
    var n = 0;
    Object.keys(S.checked).forEach(function (k) { if (S.checked[k]) n++; });
    var el = $('fixcount');
    if (el) el.textContent = '今天完成了 ' + n + ' / 3';
  }

  function renderResult() {
    var an = S.an;
    var head = '<div class="brand">' + esc(CFG.shopName || '恋爱型号自测') + '</div>';
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
    var ab = $('againBtn');
    if (ab) ab.onclick = openBuyModal;
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
              + '<div class="barbuy">链接打不开？到小红书搜「' + esc(CFG.shopName || '恋爱型号自测') + '」</div>'
            /* 没配商品链接时，底栏那行「去小红书搜」原来只是行不能点的文字 ——
               想买的人看着干着急。换成能点的按钮，点了弹窗讲清搜什么。 */
            : '<button class="btn gold" id="barBuyBtn" type="button" style="margin:0">去小红书拍一份，自动发货</button>'
              + '<div class="barbuy">到小红书搜「' + esc(CFG.shopName || '恋爱型号自测') + '」</div>')
        + '<div class="inner"><button class="btn line" id="ctaBtn">我也要测一下我的 →</button></div>'
        + '</div>';
      bar.classList.remove('hide');
      bindBuy();
      $('ctaBtn').onclick = function () {
        S.authed = false; S.token = null;
        try { localStorage.removeItem(K_TOKEN); localStorage.removeItem(K_RESULT); } catch (e) { }
        history.replaceState(null, '', '#/');
        bootFresh();
      };
      return;
    }
    bar.innerHTML = '<div class="inner">'
      + '<button class="btn" id="saveBtn">保存长图</button>'
      + '<button class="btn line" id="linkBtn">复制链接</button>'
      + '</div>';
    bar.classList.remove('hide');
    $('saveBtn').onclick = saveImage;
    $('linkBtn').onclick = copyLink;
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
        try { localStorage.removeItem(K_RESULT); } catch (e) { }
        clearProgress();
        history.replaceState(null, '', '#/quiz');
        startQuiz();
        return;
      }
      showRetestBlocked((r && r.message) || '这个密码已经完成过一次测试了。');
    });
  }

  /* 换个密码：退出这次登录，回到输密码那一步。
     只清凭证，不清本地那份结果 —— 同一个人重新输同一张码还能把结果取回来，
     而换了新密码的人则是一张全新的机会。（这里不做任何「重来一次」的口子：
     能不能再测，永远由服务端那张码说了算。） */
  function switchCode() {
    try {
      localStorage.removeItem(K_TOKEN);
      localStorage.removeItem(K_UNL);
      localStorage.removeItem(K_PROG);
    } catch (e) { }
    S.token = null; S.authed = false; S.resultAt = null; S.unlimited = false; S.finished = false;
    S.idx = 0; S.an = null; S.share = null; S.answers = new Array(N).fill(0);
    history.replaceState(null, '', '#/');
    showGate();
    toast('已退出这次登录 —— 输入新的密码就能再测');
  }

  function showRetestBlocked(msg) {
    var h = '<p>' + esc(msg) + '</p>'
      + '<p>你这次的测评结果还在这一页，随时可以回来看，也可以存成长图带走。</p>';
    h += '<div class="hl">要新的测试密码，去小红书订单里找客服要一张就行。</div>'
      + '<button class="btn line" id="mKefu2" type="button">怎么联系客服</button>';
    if (CFG.buyUrl) {
      h += '<a class="btn gold" id="mBuy2" href="' + esc(CFG.buyUrl) + '" target="_blank" rel="noopener"'
        + ' style="margin-top:8px;text-decoration:none">' + esc(CFG.buyText || '去店铺下单，获取新的测试密码') + '</a>';
    } else {
      /* 没配商品链接也要留一条能点的路 —— 不然这条提示就成了死胡同 */
      h += '<button class="btn gold" id="mBuyBtn" type="button" style="margin-top:8px">去小红书再拍一份</button>';
    }
    openInfoModal('这张密码已经用过啦', h);
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
      var name = '恋爱型号自测-' + String(S.an.ta.name).replace(/[\s×]/g, '') + '.png';
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
        图片地址也从 dataURL 换成 blob: —— 长按菜单稳定得多。 */
  function openPreview(url, name) {
    var canShare = !isWeChat && typeof navigator.canShare === 'function' && typeof File === 'function';
    var isIOS = /iPhone|iPad|iPod/i.test(ua);

    var showUrl = url, objectUrl = null;
    try {
      objectUrl = URL.createObjectURL(PO.dataURLtoBlob(url));
      showUrl = objectUrl;
    } catch (e) { /* 拿不到 blob 就退回 dataURL，不影响后面的路 */ }

    var hint = isWeChat
      ? '微信里请长按下面这张图 →「保存图片」'
      : '点上面的「保存到相册」；没反应就长按图片 →「保存图片」';
    var where = isIOS
      ? 'iPhone：长按存的会进「照片」；用按钮存的可能只进「文件 → 下载」。'
      : '安卓：一般直接进相册，也可能在「文件管理 → 下载」。';

    var d = document.createElement('div');
    d.className = 'pv';
    d.innerHTML =
      '<div class="pvtop">'
      + '<div class="t"><b>结果长图已生成</b><span>' + (isWeChat ? '长按图片即可保存' : '存到相册或直接分享') + '</span></div>'
      + '<button id="pvSave">保存到相册</button>'
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
      toast(isIOS ? '已保存，去「照片」或「文件 → 下载」看看' : '已保存，去相册或「下载」里看看');
    };

    if (canShare) {
      d.querySelector('#pvShare').onclick = function () {
        try {
          var blob = PO.dataURLtoBlob(url);
          var file = new File([blob], name, { type: 'image/png' });
          if (navigator.canShare({ files: [file] })) {
            navigator.share({ files: [file], title: '我的恋爱型号', text: '我测出来的 TA 是「' + S.an.ta.name + '」' })
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
      var url = location.origin + location.pathname + '#/r/' + code;
      S.link = url;
      return copyText(url).then(function (ok) {
        if (ok) toast('链接已复制，发给朋友就能看到你的结果');
        else openLinkModal(url);
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
      '<div class="brand">' + esc(CFG.shopName || '恋爱型号自测') + '</div>'
      + '<h1>你的结果不在这台设备上</h1>'
      + '<p class="lead">这张测试密码已经完成过一次测试了。测评结果保存在你当时做题的那台手机 / 电脑的浏览器里，换成别的设备、或者清理过浏览器数据，就取不回来了。</p>'
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
        if (b) b.onclick = function () { history.replaceState(null, '', '#/'); location.reload(); };
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
        '<div class="brand">' + esc(CFG.shopName || '恋爱型号自测') + '</div>'
        + '<div class="sharedtag">这是一份朋友分享给你的测评结果 —— 往下看就能看到 TA 测出来的型号。'
        + '<br>想测自己的？点下面的按钮去小红书拍一份，付款后自动发货。</div>'
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

  function boot() {
    try { S.token = localStorage.getItem(K_TOKEN) || null; } catch (e) { S.token = null; }
    try { S.unlimited = localStorage.getItem(K_UNL) === '1'; } catch (e) { S.unlimited = false; }
    var h = location.hash.replace(/^#\/?/, '');
    if (h.indexOf('r/') === 0) { showShared(h.slice(2)); return; }

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
      /* 这张码已经出过结果了 —— 不管本地有没有缓存，都不再给「开始测试」这条路。
         以前只有 #/quiz、#/result 两种情况被挡住，直接开首页（不带 hash）照样能
         点「开始测试」再答一遍，看起来就是「测完还能再测一次」。 */
      if (S.resultAt && !S.unlimited) {
        if (h !== 'result') { history.replaceState(null, '', '#/result'); }
        if (saved) {
          S.answers = saved.a.slice();
          S.share = saved.s || null;
          S.checked = saved.c || {};
          S.an = QZ.analyze(S.answers);
          renderResult();
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
      SB_PROBLEM = c.message || '暂时无法验证密码，请稍后再试。';
    }
    boot();
  });
})();
