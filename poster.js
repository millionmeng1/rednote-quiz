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
      + '<div class="pbrand">' + esc(cfg.shopName || '疲惫类型自测') + '</div>'
      + '<div class="plab">我的累叫</div>'
      + '<div class="pname">' + esc(an.title) + '</div>'
      + '<div class="psub">' + esc(T.name) + '｜' + esc(T.sub) + '<br>' + esc(T.en) + '</div>'
      + '<div class="pflag">整体疲劳指数 ' + an.index + ' / 100</div>'
      + '</div>';

    /* 雷达 + 图例 + 指数 */
    html += '<div class="pcard first">'
      + '<div class="pradarwrap"><canvas id="p-radar" class="pradar"></canvas></div>'
      + legendHTML(an.scores)
      + '<div class="pidx"><div class="pidxt"><span>整体疲劳指数</span><b>' + an.index + ' / 100</b></div>'
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

    html += '<div class="pfoot">'
      + '<div class="f1">' + esc(cfg.quizTitle || '你现在的累，是哪一种累？') + '</div>'
      + '<div class="f2">出自「' + esc(cfg.shopName || '') + '」<br>18 题 · 6 个维度 · 7 种结果</div>'
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
     必须用 canvas 手绘，不能用 <img>：
       · 外链图片会让 html2canvas 导出时污染 canvas，toDataURL 直接抛异常；
       · 内联 SVG 虽然同源，但 html2canvas 走的是自己的序列化路径，容易糊边。
     整数倍格子 + 矩阵自带 2 格静默区，保证缩到小尺寸也扫得出来。 */
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
    var PX = q.size * CELL;                  /* 37 × 5 = 185px */
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
