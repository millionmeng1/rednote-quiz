/* 长图渲染：构建 750px 宽的海报 DOM，用 html2canvas 输出 PNG dataURL */
(function (w) {
  'use strict';
  var QD = w.QD, QZ = w.QZ;
  var DIMNAME = QD.DIMNAME, DIMCOLOR = QD.DIMCOLOR;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function legendHTML(scores) {
    var order = QD.DIMS.slice().sort(function (a, b) {
      if (scores[b] !== scores[a]) return scores[b] - scores[a];
      return QD.DIMS.indexOf(a) - QD.DIMS.indexOf(b);
    });
    var out = '<div class="pleg">';
    order.forEach(function (d) {
      out += '<div class="plegi">'
        + '<div class="plegt"><span class="plegd" style="background:' + DIMCOLOR[d] + '"></span>'
        + '<span class="plegn">' + DIMNAME[d] + '</span>'
        + '<span class="plegv">' + scores[d] + '</span></div>'
        + '<div class="plegb"><i style="width:' + Math.max(scores[d], 2) + '%;background:' + DIMCOLOR[d] + '"></i></div>'
        + '<div class="plegs">' + QD.DIMSHORT[d] + '</div>'
        + '</div>';
    });
    out += '</div>';
    return out;
  }

  function build(an, cfg, checked) {
    checked = checked || {};
    var T = an.T;
    var html = '';

    html += '<div class="phead">'
      + '<div class="pbrand">' + esc(cfg.shopName || '万圣节鬼形自测') + '</div>'
      /* 这张鬼图是长图能不能被转发出去的关键：纯文字没人愿意发朋友圈。
         图案自带渐变底，所以圆裁 —— 和结果页保持同一个视觉语言。 */
      + (T.img ? '<div class="pghost"><img src="ghost/' + esc(T.img) + '" alt=""></div>' : '')
      + '<div class="plab">我身上住着</div>'
      + '<div class="pname">' + esc(an.title) + '</div>'
      + '<div class="psub">' + esc(T.name) + '｜' + esc(T.sub) + '<br>' + esc(T.en) + '</div>'
      + '<div class="pflag">阳气 · ' + esc(an.band) + '</div>'
      + '</div>';

    /* 雷达 + 图例 + 指数 */
    html += '<div class="pcard first">'
      + '<div class="pradarwrap"><canvas id="p-radar" class="pradar"></canvas></div>'
      + legendHTML(an.scores)
      + '<div class="pidx"><div class="pidxt"><span>阳气剩余</span><b>' + an.index + ' / 100</b></div>'
      + '<div class="pidxb"><i style="width:' + an.index + '%"></i></div>'
      + '<div class="pidxn">' + esc(an.nowline) + '</div></div>'
      + '</div>';

    html += '<div class="pdef">' + esc(T.def) + '</div>';

    if (an.comboBody) {
      html += '<div class="pcombo"><div class="ct">' + esc(an.comboTitle) + '</div>'
        + '<div class="cd">' + esc(an.comboBody) + '</div></div>';
    }

    html += '<div class="pcard"><div class="pst">你为什么会这样</div>';
    T.why.forEach(function (p) { html += '<p>' + p + '</p>'; });
    html += '<div class="pthy">' + T.concept + '</div></div>';

    html += '<div class="pcard"><div class="pst">你的典型一天</div><p>' + esc(T.day) + '</p></div>';

    html += '<div class="pcard"><div class="pst">你没意识到的代价</div><ol class="plist">';
    T.cost.forEach(function (c) { html += '<li>' + c + '</li>'; });
    html += '</ol></div>';

    html += '<div class="pcard"><div class="pst">恢复处方 · 今天可以先做这三件</div><ul class="pfix">';
    T.fix.forEach(function (f, i) {
      html += '<li class="' + (checked[i] ? 'on' : '') + '"><span class="cb"></span><span class="tx">' + f + '</span></li>';
    });
    html += '</ul></div>';

    html += '<div class="plast">' + esc(T.last) + '</div>';

    html += '<div class="pdisc">' + esc(QD.DISCLAIMER).replace(/\n/g, '<br>') + '</div>';

    /* 长图是被转发得最多的东西，上面**不印任何微信号**：
       一是微信号出现在外发素材上有被平台限流的风险，二是买家本来就是在
       小红书店铺下的单，指回站内比指去微信更顺、也更安全。
       所以这里只留店铺名，让人知道去小红书搜谁。 */
    var shop = cfg.shopName && String(cfg.shopName).indexOf('请到管理后台') < 0
      ? String(cfg.shopName) : '';

    /* 免卡密版：长图二维码默认直接指向「带口令的开测链接」，扫完就是题目，
       中间没有密码框、没有商品页 —— 这一版要的就是传播速度。
       想改成「扫码去拍」：把 config.js 里的 POSTER_QR 改成 'buy' 就行
       （那需要先在后台填上 buyUrl，否则会退回指向本站）。 */
    var direct = String(window.POSTER_QR || 'test').toLowerCase() === 'buy' && !!cfg.buyUrl;
    html += '<div class="pfoot">'
      + '<div class="f1">' + esc(cfg.quizTitle || '万圣节前夜，你身上住着哪只鬼？') + '</div>'
      + '<div class="f2">出自「' + esc(cfg.shopName || '') + '」<br>12 题 · 7 只鬼 · 21 种组合</div>'
      + '<div class="pqr">'
      + '<canvas id="p-qr" class="pqrc"></canvas>'
      + (direct
        ? '<div class="pqrt">扫码直接拍<br>付款后自动发货</div>'
        : '<div class="pqrt">扫码直接测<br>12 题 · 约 2 分钟</div>')
      + '</div>'
      + (direct
        ? '<div class="f3">想测自己的？扫右边的码，直达商品页，拍下自动发货</div>'
        : (shop ? '<div class="f3">扫右边的码直接开测 · 同款在小红书「' + esc(shop) + '」</div>' : ''))
      + '</div>';

    return html;
  }

  /* 二维码扫出来去哪儿 —— 由 config.js 的 POSTER_QR 决定：
       · 'buy' 且后台填了 buyUrl → 码指向商品页，扫完一步能拍
       · 'test'（默认）          → 码指向本站并带上通用口令 ?k=xxx，扫完直接开测
     口令写在 config.js 里，换口令只需要改那一个地方，不用重新出图。 */
  function qrTarget(cfg) {
    var site = location.href.split('#')[0].split('?')[0];
    if (String(window.POSTER_QR || 'test').toLowerCase() === 'buy') {
      var buy = cfg && cfg.buyUrl ? String(cfg.buyUrl).trim() : '';
      /* 商品链接一个字都别加 —— 小红书短链（xhslink）带多余参数会打不开 */
      if (/^https?:\/\//i.test(buy)) return buy;
    }
    var code = String(window.PUBLIC_CODE || '').trim();
    return code ? site + '?k=' + encodeURIComponent(code) : site;
  }

  /* 运行时编码：vendor/qr-gen.js（qrcode-generator, MIT）。
     以前是 python 预生成一份写死的矩阵，换域名 / 换商品链接就得重跑脚本重出图，
     而且那份矩阵指向的域名早就变了（恋爱款那份还指着旧镜像站）。改成运行时生成，
     编码内容跟着后台配置走，换什么都不用再动图。失败就退回预生成矩阵。 */
  function qrMatrix(text) {
    if (typeof w.qrcode !== 'function') return null;
    try {
      var q = w.qrcode(0, 'M');              /* 0 = 自动选版本，M = 中等纠错 */
      q.addData(text);
      q.make();
      var n = q.getModuleCount();
      if (!n) return null;
      var s = '';
      for (var r = 0; r < n; r++) {
        for (var c = 0; c < n; c++) s += q.isDark(r, c) ? '1' : '0';
      }
      return { size: n, matrix: s, target: text };
    } catch (e) { return null; }
  }

  /* 必须用 canvas 手绘，不能用 <img>：
       · 外链图片会让 html2canvas 导出时污染 canvas，toDataURL 直接抛异常；
       · 内联 SVG 虽然同源，但 html2canvas 走的是自己的序列化路径，容易糊边。
     整数倍格子 + 自己补 2 格静默区，保证缩到小尺寸也扫得出来。 */
  function drawQR(cfg) {
    var cv = document.getElementById('p-qr');
    var box = document.querySelector('#poster .pqr');
    if (!cv) return;

    var q = qrMatrix(qrTarget(cfg)) || w.QR;
    if (!q || !q.matrix || !q.size || q.matrix.length !== q.size * q.size) {
      /* 拿不到矩阵就整块不印 —— 宁可不出现，也不要印一个扫不出来的方块 */
      if (box) box.style.display = 'none';
      return;
    }

    var PAD = 2;                             /* 静默区：二维码四周必须留白才扫得动 */
    var TOTAL = q.size + PAD * 2;
    var CELL = Math.max(3, Math.floor(200 / TOTAL));   /* 取整格，不然格子会糊 */
    var PX = TOTAL * CELL;
    var dpr = 2;
    cv.width = PX * dpr; cv.height = PX * dpr;
    cv.style.width = PX + 'px'; cv.style.height = PX + 'px';

    var ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, PX, PX);
    ctx.fillStyle = '#111111';
    var off = PAD * CELL;
    for (var i = 0; i < q.size; i++) {
      for (var j = 0; j < q.size; j++) {
        if (q.matrix.charCodeAt(i * q.size + j) === 49 /* '1' */) {
          ctx.fillRect(off + j * CELL, off + i * CELL, CELL, CELL);
        }
      }
    }
  }

  /* 渲染成 dataURL（PNG） */
  function render(an, cfg, checked) {
    if (typeof html2canvas !== 'function') {
      return Promise.reject(new Error('nographer'));
    }
    var node = document.getElementById('poster');
    if (!node) {
      node = document.createElement('div');
      node.id = 'poster';
      document.body.appendChild(node);
    }
    node.innerHTML = build(an, cfg, checked);

    /* 雷达图用 canvas 画（不依赖 html2canvas 对 SVG 的支持） */
    var cv = document.getElementById('p-radar');
    var CW = 600, CH = 460, dpr = 2;
    cv.width = CW * dpr; cv.height = CH * dpr;
    cv.style.width = CW + 'px'; cv.style.height = CH + 'px';
    var ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    QZ.drawRadarCanvas(ctx, an.scores, CW, CH, {});
    drawQR(cfg);

    var H = node.offsetHeight || 4000;
    var maxArea = 9.2e6;                      /* 兼容 iOS 的 canvas 面积上限 */
    var scale = Math.min(1.55, Math.sqrt(maxArea / (750 * H)));
    scale = Math.max(0.8, scale);

    var opts = {
      backgroundColor: '#f6f4f8',
      scale: scale,
      useCORS: true,
      logging: false,
      windowWidth: 800,
      windowHeight: Math.max(H + 200, 1200)
    };

    var run = function () {
      return html2canvas(node, opts);
    };
    var fonts = (document.fonts && document.fonts.ready) ? document.fonts.ready : Promise.resolve();

    /* 鬼的图案是同源相对路径，html2canvas 会自己去加载。
       但买家第一次进来时这张图还没进缓存，直接截会得到一块空白 ——
       所以先显式预加载一次。加载失败也照样往下走，不能因为一张图卡死整张长图。 */
    var preload = function () {
      if (!an.T || !an.T.img) return Promise.resolve();
      return new Promise(function (res) {
        var im = new Image();
        im.onload = function () { res(); };
        im.onerror = function () { res(); };
        im.src = 'ghost/' + an.T.img;
      });
    };

    return fonts.then(preload).then(function () {
      return new Promise(function (r) { setTimeout(r, 60); });
    }).then(run).then(function (canvas) {
      var url;
      try { url = canvas.toDataURL('image/png'); }
      catch (e) { url = canvas.toDataURL('image/jpeg', 0.92); }
      return { url: url, width: canvas.width, height: canvas.height };
    });
  }

  function dataURLtoBlob(dataURL) {
    var parts = dataURL.split(',');
    var mime = (parts[0].match(/:(.*?);/) || [])[1] || 'image/png';
    var bin = atob(parts[1]);
    var len = bin.length;
    var u8 = new Uint8Array(len);
    for (var i = 0; i < len; i++) u8[i] = bin.charCodeAt(i);
    return new Blob([u8], { type: mime });
  }

  w.PO = { render: render, build: build, dataURLtoBlob: dataURLtoBlob };
})(window);
