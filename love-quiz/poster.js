/* 长图渲染：构建 750px 宽的海报 DOM，用 html2canvas 输出 PNG dataURL
   ---------------------------------------------------------------------------
   这一版的长图有三段（TA 的型号 / 你的喜欢型号 / 你们俩的咬合方式），比疲惫款
   长不少。三段都要印，因为被转发得最多的就是这张图 —— 别人扫二维码进来，看到
   的是别人完整的三段结果，才知道这份东西值不值 1.99。
   --------------------------------------------------------------------------- */
(function (w) {
  'use strict';
  var QD = w.QD, QZ = w.QZ;
  var DIMNAME = QD.DIMNAME, DIMCOLOR = QD.DIMCOLOR;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function ul(list, cls) {
    return '<ul class="' + (cls || 'plist') + '">'
      + list.map(function (x) { return '<li>' + x + '</li>'; }).join('') + '</ul>';
  }

  function build(an, cfg) {
    var ta = an.ta, me = an.me, m = an.match;
    var html = '';

    /* 长图是分享出去给别人看的，第一眼必须同时给出「TA 是谁」和「你们什么组合」——
       只写 TA 的型号，看图的人不知道这张图跟谁有关，也就没有点开的动力。 */
    html += '<div class="phead">'
      + '<div class="pbrand">' + esc(cfg.shopName || '恋爱型号自测') + '</div>'
      + '<div class="plab">TA 的表达型号</div>'
      /* 型号名当主标题，那句形容降成副标题 —— 和网页版一致：
         读者要能第一眼说出「TA 是广播型」，而不是先读到一句文案。 */
      + '<div class="pname">' + esc(ta.name) + '</div>'
      + '<div class="ptitle">' + esc(ta.title) + '</div>'
      + '<div class="psub">' + esc(ta.sub) + '</div>'
      + '<div class="pdiv"></div>'
      + '<div class="plab">你和 TA 的组合</div>'
      /* 注意：不能叫 pcombo —— 那个 class 第三段的匹配卡片已经在用（白底卡） */
      + '<div class="pduo">' + esc(m.name) + '</div>'
      + '<div class="pfit"><i style="width:' + an.pct + '%"></i></div>'
      + '<div class="pfitmeta"><span>表达贴合度</span><b>' + an.pct + '</b><em>' + esc(an.band) + '</em></div>'
      + (an.bandNote ? '<div class="pfitnote">' + esc(an.bandNote) + '</div>' : '')
      + '</div>';

    /* ① TA 的型号：四个维度的条 */
    html += '<div class="pcard first">'
      + '<div class="pst">TA 的四个维度</div>'
      + '<div class="pbars"><canvas id="p-bars-ta"></canvas></div>'
      + '</div>';

    html += '<div class="pdef">' + esc(ta.def) + '</div>';

    /* 长图会被转发，这句声明必须跟着走 —— 否则看到图的人会以为这是客观结论 */
    html += '<div class="pnotice">这份结果描述的是「你感受到的那个 TA」，不是 TA 本人，也不代表 TA 的真实想法。</div>';

    html += '<div class="pcard"><div class="pst">为什么会是这个型号</div>';
    ta.why.forEach(function (p) { html += '<p>' + p + '</p>'; });
    html += '</div>';

    html += '<div class="pcard"><div class="pst">TA 的典型样子</div><p>' + esc(ta.day) + '</p></div>';

    html += '<div class="pcard"><div class="pst">TA 这样的时候，其实是在表达</div>' + ul(ta.signal) + '</div>';

    html += '<div class="pcard pwarn"><div class="pst">你最容易误读成什么</div><p>' + esc(ta.miss) + '</p></div>';

    html += '<div class="pcard"><div class="pst">你可以这样接</div>' + ul(ta.do) + '</div>';

    /* ② 你的喜欢型号 */
    html += '<div class="psec">② 你是在这样喜欢的</div>';
    html += '<div class="pname2">' + esc(me.name) + '</div>';

    html += '<div class="pcard">'
      + '<div class="pst">你的三个维度</div>'
      + '<div class="pbars"><canvas id="p-bars-me"></canvas></div>'
      + '<div class="pcidx"><div class="pcidxt"><span>你的投入浓度</span><b>' + an.concentration + ' / 100</b></div>'
      + '<div class="pcidxb"><i style="width:' + an.concentration + '%"></i></div></div>'
      + '</div>';

    html += '<div class="pdef">' + esc(me.def) + '</div>';
    html += '<div class="pcard"><div class="pst">你怎么喜欢一个人</div><p>' + esc(me.way) + '</p></div>';
    html += '<div class="pcard"><div class="pst">为什么会这样</div>';
    me.why.forEach(function (p) { html += '<p>' + p + '</p>'; });
    html += '</div>';
    html += '<div class="pcard pwarn"><div class="pst">你的盲区</div><p>' + esc(me.blind) + '</p></div>';
    html += '<div class="pcard"><div class="pst">你真正需要的</div><p>' + esc(me.need) + '</p></div>';

    /* ③ 匹配 */
    html += '<div class="psec">③ 你们可能遇到的问题</div>';
    html += '<div class="pmname">' + esc(m.name) + '</div>';
    html += '<div class="pcard">'
      + '<div class="pcidx"><div class="pcidxt"><span>表达贴合度</span><b>' + an.pct + ' / 100</b></div>'
      + '<div class="pcidxb"><i style="width:' + an.pct + '%"></i></div>'
      + '<div class="pcidxn">贴合度只表示两种表达方式咬合得顺不顺，不代表这段关系好不好，也不预测结果。</div>'
      + '</div>';
    html += '<div class="pcard"><div class="pst">你们之间可能出现的情况</div><p>' + esc(m.stuck) + '</p></div>';
    html += '<div class="pcard"><div class="pst">可以努力的三个方向</div>' + ul(m.tips)
      + '<div class="pnote">不用全做，挑一条顺手的开始就行。</div></div>';

    html += '<div class="plast">表达方式是可以学的，接收方式也是。你们差的不是喜欢，是把话说明白的那几句。</div>';
    html += '<div class="ptnote">以上是基于 20 道题推出来的倾向描述，说的是「可能」，不是对 TA 的判断，也不代表这段关系的结果。</div>';
    html += '<div class="pdisc">' + esc(QD.DISCLAIMER).replace(/\n/g, '<br>') + '</div>';

    /* 长图是被转发得最多的东西，上面不印任何微信号：一是外发素材上出现微信号
       有限流风险，二是买家本来就是在小红书店铺下的单，指回站内更顺也更安全。 */
    var shop = cfg.shopName && String(cfg.shopName).indexOf('请到管理后台') < 0
      ? String(cfg.shopName) : '';

    /* 配了商品链接时，扫码的人会被站点直接送去商品页 —— 那时才敢写「扫码直接拍」；
       没配链接 QR 只能到首页，文案退回「扫码打开测评」，别承诺做不到的事。 */
    var direct = !!cfg.buyUrl;
    html += '<div class="pfoot">'
      + '<div class="f1">' + esc(cfg.quizTitle || 'TA 的喜欢，是哪一种型号？') + '</div>'
      + '<div class="f2">出自「' + esc(shop || '恋爱型号自测') + '」<br>20 题 · TA 的型号 + 你的型号 + 你们的咬合方式</div>'
      + '<div class="pqr">'
      + '<canvas id="p-qr" class="pqrc"></canvas>'
      + (direct
        ? '<div class="pqrt">扫码直接拍<br>付款后自动发货</div>'
        : '<div class="pqrt">扫码打开测评<br>拍下自动发货，输密码就能测</div>')
      + '</div>'
      + (direct
        ? '<div class="f3">想测自己的？扫右边的码，直达商品页，拍下自动发货</div>'
        : (shop ? '<div class="f3">还没有测试密码？去小红书搜「' + esc(shop) + '」，拍下自动发货</div>' : ''))
      + '</div>';

    return html;
  }

  /* 二维码扫出来去哪儿 —— 两条路都开着，互为兜底：
       · 后台配了商品链接 → 码直接指向商品页，扫完一步能拍（新图走这条）
       · 没配 → 码指向本站并带 ?f=qr，站点认得这个标记会把人送去商品页（老图走这条）
     这样商品链接以后换了，不用重出图；老长图也永远不会失效。 */
  function qrTarget(cfg) {
    var buy = cfg && cfg.buyUrl ? String(cfg.buyUrl).trim() : '';
    /* 商品链接一个字都别加 —— 小红书短链（xhslink）带多余参数会打不开 */
    if (/^https?:\/\//i.test(buy)) return buy;
    var site = location.href.split('#')[0].split('?')[0];
    return site + '?f=qr';
  }

  /* 运行时编码：vendor/qr-gen.js（qrcode-generator, MIT）。
     以前是 python 预生成一份写死的矩阵，换域名 / 换商品链接就得重跑脚本重出图，
     而且那份矩阵指向的域名早就变了（这份还指着旧镜像站）。改成运行时生成，
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

  /* 必须用 canvas 手绘，不能用 <img>：外链图片会让 html2canvas 导出时污染
     canvas（toDataURL 直接抛异常），内联 SVG 又容易糊边。
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

  /* 维度条：用 canvas 画，不依赖 html2canvas 对 SVG 的支持 */
  function drawBars(id, scores, dims) {
    var cv = document.getElementById(id);
    if (!cv) return;
    var CW = 620, rowH = 84;
    var CH = dims.length * rowH + 20;
    var dpr = 2;
    cv.width = CW * dpr; cv.height = CH * dpr;
    cv.style.width = CW + 'px'; cv.style.height = CH + 'px';
    var ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, CW, CH);
    QZ.barsCanvas(ctx, scores, dims, 0, 16, CW, { rowH: rowH });
  }

  /* 渲染成 dataURL（PNG） */
  function render(an, cfg) {
    if (typeof html2canvas !== 'function') {
      return Promise.reject(new Error('nographer'));
    }
    var node = document.getElementById('poster');
    if (!node) {
      node = document.createElement('div');
      node.id = 'poster';
      document.body.appendChild(node);
    }
    node.innerHTML = build(an, cfg);

    drawBars('p-bars-ta', an.taScores, QD.TA_DIMS);
    drawBars('p-bars-me', an.meScores, QD.ME_DIMS);
    drawQR(cfg);

    var H = node.offsetHeight || 4000;
    var maxArea = 9.2e6;                      /* 兼容 iOS 的 canvas 面积上限 */
    var scale = Math.min(1.55, Math.sqrt(maxArea / (750 * H)));
    scale = Math.max(0.8, scale);

    var opts = {
      backgroundColor: '#f5f6f8',
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

    return fonts.then(function () {
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
