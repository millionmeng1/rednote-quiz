/* 计分 / 型号匹配 / 维度条（屏幕用 SVG，长图用 Canvas）
   ---------------------------------------------------------------------------
   和疲惫款最大的不同：这里不是「分数最高的那个维度 = 结果」，而是「两组坐标
   分别去比距离」。

     前 10 题 → 四个维度的一组坐标 → 和 7 个 TA 型号的特征坐标比，取最近的
     后 10 题 → 三个维度的一组坐标 → 和 6 个你的型号的特征坐标比，取最近的
     两个型号交叉 → 42 格匹配表里取那一格

   这样任何一组得分都有落点，不会出现「没有对应型号」，也不会因为某一维分数
   高就武断地定类型。
   --------------------------------------------------------------------------- */
(function (w) {
  'use strict';
  var QD = w.QD;
  var DIMNAME = QD.DIMNAME, DIMCOLOR = QD.DIMCOLOR;

  /* ---------- 分组计分 ---------- */
  /* 每题 1-5 分，先算维度内均值，再线性映射到 0-100。
     映射后的含义：0 = 从不，50 = 有时，100 = 几乎总是。 */
  function groupScores(answers, dims, from, to) {
    var sum = {}, cnt = {};
    dims.forEach(function (d) { sum[d] = 0; cnt[d] = 0; });
    for (var i = from; i < to; i++) {
      var q = QD.QUESTIONS[i];
      if (!q || !sum.hasOwnProperty(q.d)) continue;
      /* 反向题：选「几乎总是」(5) 表示这一项其实最低，翻成 1。
         不翻转的话，「你不说，但希望 TA 看出来」选了几乎总是，
         反而会把「主动表达」这一维顶到满分 —— 结论正好反过来。 */
      var v = answers[i] || 0;
      if (q.r && v >= 1 && v <= 5) v = 6 - v;
      sum[q.d] += v;
      cnt[q.d]++;
    }
    var s = {};
    dims.forEach(function (d) {
      var avg = cnt[d] ? sum[d] / cnt[d] : 3;
      s[d] = Math.max(0, Math.min(100, Math.round((avg - 1) / 4 * 100)));
    });
    return s;
  }

  /* 找特征坐标最近的型号（欧氏距离，相同时取靠前的那个，保证结果稳定） */
  function nearestType(types, scores, dims) {
    var best = 0, bestD = Infinity;
    types.forEach(function (t, i) {
      var d = 0;
      dims.forEach(function (k) {
        var diff = (scores[k] || 0) - (t.vec[k] || 0);
        d += diff * diff;
      });
      d = Math.sqrt(d);
      if (d < bestD - 0.0001) { bestD = d; best = i; }
    });
    return { index: best, dist: bestD };
  }

  /* ---------- 结果解析 ---------- */
  function analyze(answers) {
    var taScores = groupScores(answers, QD.TA_DIMS, 0, 10);
    var meScores = groupScores(answers, QD.ME_DIMS, 10, QD.N);

    var taHit = nearestType(QD.TA_TYPES, taScores, QD.TA_DIMS);
    var meHit = nearestType(QD.ME_TYPES, meScores, QD.ME_DIMS);

    var ta = QD.TA_TYPES[taHit.index];
    var me = QD.ME_TYPES[meHit.index];

    /* 42 格匹配表。万一某格漏写（比如以后加了型号），退回一个中性文案，
       绝不让页面出现空白或 undefined。 */
    var match = QD.MATCH[taHit.index + '-' + meHit.index] || {
      name: '两种不太一样的表达方式', pct: 68,
      stuck: '你们表达和接收喜欢的方式不在同一个频道上，需要一点翻译。',
      tips: ['把你要的东西说具体，别用暗示。', '看他做过的事，不只看他说过的话。', '给这件事定一个期限，到期按事实判断。']
    };

    var pct = Math.max(0, Math.min(100, match.pct | 0));
    var band = pct >= 85 ? '很顺' : (pct >= 72 ? '比较顺' : (pct >= 60 ? '需要翻译' : '需要多花点力气'));
    var concentration = meScores.N; /* 投入浓度：结果页单独展示的一条 */

    return {
      taScores: taScores, meScores: meScores,
      ta: ta, taIdx: taHit.index, taDist: taHit.dist,
      me: me, meIdx: meHit.index, meDist: meHit.dist,
      match: match, pct: pct, band: band,
      concentration: concentration,
      color: DIMCOLOR[QD.TA_DIMS[0]],
      title: ta.title,
      shareTitle: ta.name + ' × ' + me.name
    };
  }

  /* ---------- 维度条（屏幕用 SVG） ---------- */
  function barsSVG(scores, dims, opt) {
    opt = opt || {};
    var rowH = 42, W = 300, H = dims.length * rowH + 8;
    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" class="radar" role="img" aria-label="' + (opt.label || '维度分布') + '">';
    dims.forEach(function (d, i) {
      var y = 6 + i * rowH;
      var v = Math.max(scores[d] | 0, 2);
      s += '<text x="0" y="' + (y + 12) + '" dominant-baseline="central" font-size="13" font-weight="600" fill="' + DIMCOLOR[d] + '" font-family="inherit">' + DIMNAME[d] + '</text>';
      s += '<text x="' + W + '" y="' + (y + 12) + '" text-anchor="end" dominant-baseline="central" font-size="12.5" fill="#9aa2ac" font-family="inherit">' + v + '</text>';
      s += '<rect x="0" y="' + (y + 22) + '" width="' + W + '" height="8" rx="4" fill="#eef0f4"/>';
      s += '<rect x="0" y="' + (y + 22) + '" width="' + (W * v / 100).toFixed(1) + '" height="8" rx="4" fill="' + DIMCOLOR[d] + '"/>';
      s += '<text x="0" y="' + (y + 38) + '" dominant-baseline="central" font-size="11.5" fill="#9aa2ac" font-family="inherit">' + QD.DIMNOTE[d] + '</text>';
    });
    s += '</svg>';
    return s;
  }

  /* ---------- 维度条（长图用 Canvas） ---------- */
  function barsCanvas(ctx, scores, dims, x, y, W, opt) {
    opt = opt || {};
    var rowH = opt.rowH || 62;
    var ink = opt.ink || '#1c2026', sub = opt.sub || '#9aa2ac';
    dims.forEach(function (d, i) {
      var cy = y + i * rowH;
      var v = Math.max(scores[d] | 0, 2);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.font = '700 26px "PingFang SC","Microsoft YaHei",sans-serif';
      ctx.fillStyle = DIMCOLOR[d];
      ctx.fillText(DIMNAME[d], x, cy);
      ctx.textAlign = 'right';
      ctx.font = '700 26px "PingFang SC","Microsoft YaHei",sans-serif';
      ctx.fillStyle = ink;
      ctx.fillText(String(v), x + W, cy);
      var by = cy + 20;
      ctx.fillStyle = '#e6e9ef';
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(x, by, W, 12, 6) : ctx.rect(x, by, W, 12);
      ctx.fill();
      ctx.fillStyle = DIMCOLOR[d];
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(x, by, W * v / 100, 12, 6) : ctx.rect(x, by, W * v / 100, 12);
      ctx.fill();
      ctx.textAlign = 'left';
      ctx.font = '400 22px "PingFang SC","Microsoft YaHei",sans-serif';
      ctx.fillStyle = sub;
      ctx.fillText(QD.DIMNOTE[d], x, by + 32);
    });
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    return y + dims.length * rowH;
  }

  w.QZ = {
    groupScores: groupScores,
    nearestType: nearestType,
    analyze: analyze,
    barsSVG: barsSVG,
    barsCanvas: barsCanvas
  };
})(window);
