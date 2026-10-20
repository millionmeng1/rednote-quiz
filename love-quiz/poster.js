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
      + '<div class="pname">' + esc(ta.title) + '</div>'
      + '<div class="psub">' + esc(ta.name) + ' · ' + esc(ta.sub) + '</div>'
      + '<div class="pdiv"></div>'
      + '<div class="plab">你和 TA 的组合</div>'
      /* 注意：不能叫 pcombo —— 那个 class 第三段的匹配卡片已经在用（白底卡） */
      + '<div class="pduo">' + esc(m.name) + '</div>'
      + '<div class="pfit"><i style="width:' + an.pct + '%"></i></div>'
      + '<div class="pfitmeta"><span>贴合度</span><b>' + an.pct + '</b><em>' + esc(an.band) + '</em></div>'
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
    html += '<div class="psec">③ 你们卡在哪一段</div>';
    html += '<div class="pmname">' + esc(m.name) + '</div>';
    html += '<div class="pcard">'
      + '<div class="pcidx"><div class="pcidxt"><span>贴合度</span><b>' + an.pct + ' / 100</b></div>'
      + '<div class="pcidxb"><i style="width:' + an.pct + '%"></i></div>'
      + '<div class="pcidxn">贴合度只表示两种表达方式咬合得顺不顺，不代表这段关系好不好，也不预测结果。</div>'
      + '</div>';
    html += '<div class="pcard"><div class="pst">最容易卡住你们的点</div><p>' + esc(m.stuck) + '</p></div>';
    html += '<div class="pcard"><div class="pst">现在就能做的三件事</div>' + ul(m.tips) + '</div>';

    html += '<div class="plast">表达方式是可以学的，接收方式也是。你们中间差的那部分，叫翻译。</div>';
    html += '<div class="pdisc">' + esc(QD.DISCLAIMER).replace(/\n/g, '<br>') + '</div>';

    /* 长图是被转发得最多的东西，上面不印任何微信号：一是外发素材上出现微信号
       有限流风险，二是买家本来就是在小红书店铺下的单，指回站内更顺也更安全。 */
    var shop = cfg.shopName && String(cfg.shopName).indexOf('请到管理后台') < 0
      ? String(cfg.shopName) : '';

    html += '<div class="pfoot">'
      + '<div class="f1">' + esc(cfg.quizTitle || 'TA 的喜欢，是哪一种型号？') + '</div>'
      + '<div class="f2">出自「' + esc(shop || '恋爱型号自测') + '」<br>20 题 · TA 的型号 + 你的型号 + 你们的咬合方式</div>'
      + '<div class="pqr">'
      + '<canvas id="p-qr" class="pqrc"></canvas>'
      + '<div class="pqrt">扫码打开测评<br>拍下自动发货，输密码就能测</div>'
      + '</div>'
      /* 图上点不了链接，所以把「去哪儿买」写成一句能照做的搜索指令 */
      + (shop ? '<div class="f3">还没有测试密码？去小红书搜「' + esc(shop) + '」，拍下自动发货</div>' : '')
      + '</div>';

    return html;
  }

  /* 二维码：模块矩阵来自 vendor/qr.js（由 _quiz_tests/_gen_qr.py 生成）。
     必须用 canvas 手绘，不能用 <img>：外链图片会让 html2canvas 导出时污染
     canvas（toDataURL 直接抛异常），内联 SVG 又容易糊边。 */
  function drawQR() {
    var cv = document.getElementById('p-qr');
    var box = document.querySelector('#poster .pqr');
    var q = w.QR;

    if (!cv) return;
    if (!q || !q.matrix || !q.size || q.matrix.length !== q.size * q.size) {
      /* 拿不到矩阵就整块不印 —— 宁可不出现，也不要印一个扫不出来的方块 */
      if (box) box.style.display = 'none';
      return;
    }

    var CELL = 5;                            /* 每格 5 CSS px */
    var PX = q.size * CELL;
    var dpr = 2;
    cv.width = PX * dpr; cv.height = PX * dpr;
    cv.style.width = PX + 'px'; cv.style.height = PX + 'px';

    var ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, PX, PX);
    ctx.fillStyle = '#111111';
    for (var i = 0; i < q.size; i++) {
      for (var j = 0; j < q.size; j++) {
        if (q.matrix.charCodeAt(i * q.size + j) === 49 /* '1' */) {
          ctx.fillRect(j * CELL, i * CELL, CELL, CELL);
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
    drawQR();

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
