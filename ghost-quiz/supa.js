/* ============================================================================
   后端调用层：零依赖直连 Supabase
   ----------------------------------------------------------------------------
   为什么不引 supabase-js：整站一共只用到「调数据库函数」这一个能力，
   直接 fetch PostgREST 的 /rest/v1/rpc/<函数名> 就够了，不需要多挂一个
   几十 KB 的 CDN 依赖 —— GitHub Pages 上少一个外部依赖就少一个挂掉的理由。
   ============================================================================ */
(function () {
  'use strict';

  var URL_BASE = String(window.SUPABASE_URL || '').replace(/\/+$/, '');
  var ANON_KEY = String(window.SUPABASE_ANON_KEY || '');

  /* 占位符检查：config.js 还没填的时候，页面要给一句人话，而不是一堆 404。
     不限定必须是 supabase.co，这样以后换成自建 / 自定义域名也不用改代码。 */
  function configured() {
    return /^https?:\/\/\S+/i.test(URL_BASE) &&
      URL_BASE.indexOf('请替换') < 0 &&
      ANON_KEY.indexOf('请替换') < 0 &&
      ANON_KEY.length > 40;
  }

  function fail(error, message) {
    return { ok: false, error: error, message: message };
  }

  /**
   * 调用数据库里的函数（PostgREST 的 RPC 接口）。
   * 参数按「名字」传递，所以 supa.js 里的参数名必须和 schema.sql 里的形参名一致。
   *   rpc('redeem', { p_code: 'LEI-XXXX-XXXX', p_token: null, p_device: 'd1a2' })
   * 永远 resolve，不 reject —— 调用方只需要看返回值里的 ok。
   */
  function rpc(fn, args) {
    if (!configured()) {
      return Promise.resolve(fail('config', '站点还没连上数据库，请联系店主。'));
    }
    return fetch(URL_BASE + '/rest/v1/rpc/' + fn, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': ANON_KEY,
        'Authorization': 'Bearer ' + ANON_KEY
      },
      body: JSON.stringify(args || {})
    }).then(function (res) {
      return res.text().then(function (t) {
        var j = null;
        try { j = JSON.parse(t); } catch (e) { j = null; }
        if (res.status >= 400) {
          /* 把数据库层面的错误分个类，给买家的话才说得准：
             - PGRST202/205：函数或表不存在 —— 通常意味着库还没初始化好（部署时最常见）
             - 401：anon key 不对或失效 —— 配置问题
             - 其他：真·服务抖动
             业务上的「密码不对」不会走到这里，那些都是 200 + {ok:false}。 */
          var code = (j && j.code) || '';
          var raw = (j && j.message) || '';
          /* 留一行原始错误在控制台：买家截图给我，我一眼能看出卡在哪一层。
             PostgREST 的错误体里不含任何密钥，给买家看到是安全的。 */
          try { console.warn('[rpc] ' + fn + ' → HTTP ' + res.status + ' ' + code + ' ' + raw); } catch (e) { }

          if (code === 'PGRST202' || code === 'PGRST205' ||
            /Could not find the (function|table)/i.test(raw)) {
            return fail('notready', '站点正在配置中，请稍后再试。');
          }
          if (res.status === 401 || /Invalid API key|No API key/i.test(raw)) {
            return fail('config', '站点配置有误，请联系店主。');
          }
          return fail('pg', '服务暂时不可用，请稍后重试。');
        }
        if (!j || typeof j !== 'object') return fail('bad', '服务返回异常，请稍后重试。');
        return j;
      });
    }, function () {
      return fail('net', '网络不太好，请检查网络后重试。');
    });
  }

  /* 设备标识：用来做「输错太多次先挡一会儿」的软限流，
     从 2026-10-25 起还兼作「换个地方打开也能找回上次那份结果」的钥匙。
     所以**不能**再用"存进 localStorage 的随机数"—— 那个一换浏览器 / 换 App
     就不见了，正好是我们要跨过去的那一道墙。
     改成设备指纹：只取 UA 里跨 App 一致的那一段（设备型号 / 系统版本），
     再配上屏幕、语言、时区。App 自己的标识（MicroMessenger / Xiaohongshu …）
     一律不参与 —— 同一个人在小红书里和 Chrome 里必须算出同一个值。
     不含任何能定位到个人的信息，也算不出手机号 / 账号。 */
  function device() {
    var k = 'ghost_dev_v2', v = '';
    try { v = localStorage.getItem(k) || ''; } catch (e) { v = ''; }
    if (!v) {
      var ua = navigator.userAgent || '';
      /* UA 括号里第三段的开头就是设备型号：
         (Linux; Android 14; SM-S918B Build/…) → SM-S918B
         (iPhone; CPU iPhone OS 17_0 like Mac OS X) → iPhone … */
      var dev = '';
      var m = /\(([^;]+);\s*([^;]+);\s*([^;)]+)/.exec(ua);
      if (m) dev = String(m[3]).replace(/Build\/.*/, '').trim();
      var s = [dev,
        (window.screen && screen.width) || 0,
        (window.screen && screen.height) || 0,
        navigator.language || '',
        new Date().getTimezoneOffset(),
        navigator.platform || ''].join('|');
      var h = 0;
      for (var i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) >>> 0; }
      v = 'd' + h.toString(36);
      try { localStorage.setItem(k, v); } catch (e) { }
    }
    return v;
  }

  window.SB = {
    rpc: rpc,
    device: device,
    ready: configured(),
    url: URL_BASE
  };
})();
