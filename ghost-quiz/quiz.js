/* 计分 / 结果解析 / 雷达图（屏幕用 SVG，长图用 Canvas）
   和疲惫款的两处不同：
   1. 计分是「投票制」：每个选项直接指向一只鬼，选了就给它一票。
      每只鬼出场次数不同（6～8 次），所以必须除以出场次数归一成附身度，
      否则出场 8 次的内耗鬼会天然占便宜。
   2. 七只鬼 → 雷达图是七边形，不是六边形。
   3. 万圣节不做「全低位给第 8 个结果」这种兜底：票投得再散也要落在一只鬼上，
      不然就是"测了个寂寞"。票数分散时用文案说明，而不是不给结果。 */
(function (w) {
  'use strict';
  var QD = w.QD;
  var DIMS = QD.DIMS, DIMNAME = QD.DIMNAME, DIMCOLOR = QD.DIMCOLOR, TYPES = QD.TYPES, COMBOS = QD.COMBOS;
  var N = DIMS.length;                       /* 7 */
  var STEP = 360 / N;                        /* 七边形每格角度 */

  /* ---------- 计分 ---------- */
  function computeScores(answers) {
    var hit = {};
    DIMS.forEach(function (d) { hit[d] = 0; });
    QD.QUESTIONS.forEach(function (q, i) {
      var a = answers[i] || 0;               /* 1..4，0 = 没答 */
      if (!a) return;
      var opt = q.o[a - 1];
      if (opt && hit[opt.g] !== undefined) hit[opt.g]++;
    });
    /* dim  = 取整后的百分数，只用于显示。
       raw  = 没取整的精确比值，用于排名。
       只按 dim 排的话，1/6=17% 和 2/12≈17% 会打平，平票时谁在前面谁赢 ——
       实测 15.7% 的人会撞上这种平票，而且永远偏向加班鬼/穷鬼/僵尸这三只靠前的，
       熬夜鬼和冤鬼被系统性压低。排名必须用 raw。 */
    var s = {}, raw = {};
    DIMS.forEach(function (d) {
      var total = QD.GCOUNT[d] || 1;
      raw[d] = hit[d] / total;
      s[d] = Math.round(raw[d] * 100);
    });
    var vals = DIMS.map(function (d) { return s[d]; });
    var mean = vals.reduce(function (a, b) { return a + b; }, 0) / N;
    var sorted = vals.slice().sort(function (a, b) { return b - a; });
    var top2 = (sorted[0] + sorted[1]) / 2;
    /* 「阴气」= 附身程度；阳气剩余 = 100 - 阴气。数值越低越阴，符合万圣节的读法 */
    var yin = Math.max(0, Math.min(100, Math.round(0.55 * top2 + 0.45 * mean)));
    return { dim: s, raw: raw, hit: hit, yin: yin, index: 100 - yin, mean: mean, max: sorted[0] };
  }

  /* ---------- 结果解析 ---------- */
  function analyze(answers) {
    var r = computeScores(answers);
    /* 排名用 raw（精确比值），不是 dim（取整百分数）。
       精确到 raw 还平手的话，看谁被实际选中的次数更多 —— 那是更硬的证据。
       最后才轮到固定顺序兜底。 */
    var order = DIMS.slice().sort(function (a, b) {
      if (r.raw[b] !== r.raw[a]) return r.raw[b] - r.raw[a];
      if (r.hit[b] !== r.hit[a]) return r.hit[b] - r.hit[a];
      return DIMS.indexOf(a) - DIMS.indexOf(b);
    });
    var mainKey = order[0], secKey = order[1];

    var comboKey = [mainKey, secKey].sort().join('-');
    var comboText = COMBOS[comboKey] || '';

    var vals = DIMS.map(function (d) { return r.dim[d]; });
    var span = r.max - Math.min.apply(null, vals);
    var flat = span <= 8;                    /* 七只鬼咬得很均匀 */
    var lowSec = r.dim[secKey] < 25;         /* 第二名太弱，不拼进标题 */
    var highLoad = DIMS.filter(function (d) { return r.dim[d] > 60; }).length >= 3;

    var band = r.index >= 75 ? '充足' : (r.index >= 55 ? '还行' : (r.index >= 35 ? '偏低' : '告急'));
    var nowline = '你剩下的阳气是 ' + r.index + '%，身上最重的两只鬼是 '
      + DIMNAME[mainKey] + '（' + r.dim[mainKey] + '）和 ' + DIMNAME[secKey] + '（' + r.dim[secKey] + '）。';
    if (lowSec) {
      nowline = '你剩下的阳气是 ' + r.index + '%，鬼气基本集中在 ' + DIMNAME[mainKey]
        + '（' + r.dim[mainKey] + '）一只身上，其余几只都还轻。';
    }
    if (flat) {
      nowline = '你剩下的阳气是 ' + r.index + '%，但七只鬼的票咬得非常近——说明困扰你的不是某一件具体的事，而是哪儿都绷着一点。';
    }
    if (highLoad) {
      nowline = '七只里有三只以上都在高位，这不是"某只鬼特别凶"，是你身上挂的东西太多了——现在该做的是减量，不是熬过去。';
    }

    var comboTitle = '', comboBody = '';
    if (flat) {
      comboTitle = '七鬼均沾 · 哪儿都绷着一点';
      comboBody = '你的票投得很散。这种状态的特点是「说不出自己到底怎么了」——不是某一件事压着你，是每件事都占了一点。对付它别从单点下手，先挑最吵的那一只处理，剩下的一次只动一只。';
    } else if (!lowSec && comboText) {
      comboTitle = DIMNAME[mainKey] + ' × ' + DIMNAME[secKey];
      comboBody = comboText;
    } else {
      comboTitle = '单只主导 · ' + DIMNAME[mainKey];
      comboBody = '你的鬼气高度集中在 ' + DIMNAME[mainKey] + ' 这一只身上，其余几只都还轻。这种情况其实最好办：不用全面整改，只要针对这一只动手就行。';
    }

    var title = flat ? '七鬼均沾'
      : (lowSec ? DIMNAME[mainKey] : DIMNAME[mainKey] + ' × ' + DIMNAME[secKey]);

    return {
      scores: r.dim, raw: r.raw, hit: r.hit, index: r.index, order: order,
      mainKey: mainKey, secKey: secKey, highLoad: highLoad,
      lowSec: lowSec, flat: flat,
      typeKey: mainKey, T: TYPES[mainKey], color: DIMCOLOR[mainKey],
      comboTitle: comboTitle, comboBody: comboBody, nowline: nowline, band: band,
      title: title
    };
  }

  /* ---------- 屏幕雷达图：SVG ---------- */
  function drawRadarSVG(scores) {
    var cx = 148, cy = 146, R = 88, LR = 112;
    var svg = '<svg viewBox="0 0 296 300" class="radar" role="img" aria-label="七鬼附身度雷达图">';
    [0.25, 0.5, 0.75, 1].forEach(function (f) {
      var pts = DIMS.map(function (_, i) {
        var a = (-90 + i * STEP) * Math.PI / 180;
        return (cx + R * f * Math.cos(a)).toFixed(1) + ',' + (cy + R * f * Math.sin(a)).toFixed(1);
      }).join(' ');
      svg += '<polygon points="' + pts + '" fill="none" stroke="#e5e8ee" stroke-width="0.6"/>';
    });
    DIMS.forEach(function (_, i) {
      var a = (-90 + i * STEP) * Math.PI / 180;
      svg += '<line x1="' + cx + '" y1="' + cy + '" x2="' + (cx + R * Math.cos(a)).toFixed(1)
        + '" y2="' + (cy + R * Math.sin(a)).toFixed(1) + '" stroke="#e5e8ee" stroke-width="0.6"/>';
    });
    var dpts = DIMS.map(function (d, i) {
      var a = (-90 + i * STEP) * Math.PI / 180;
      var r = R * Math.max(scores[d], 2) / 100;
      return (cx + r * Math.cos(a)).toFixed(1) + ',' + (cy + r * Math.sin(a)).toFixed(1);
    }).join(' ');
    svg += '<polygon points="' + dpts + '" fill="rgba(255,122,24,.22)" stroke="#ff7a18" stroke-width="1.6" stroke-linejoin="round"/>';
    DIMS.forEach(function (d, i) {
      var a = (-90 + i * STEP) * Math.PI / 180;
      var x = cx + LR * Math.cos(a), y = cy + LR * Math.sin(a);
      var anchor = Math.abs(x - cx) < 6 ? 'middle' : (x > cx ? 'start' : 'end');
      svg += '<text x="' + x.toFixed(1) + '" y="' + (y - 7).toFixed(1) + '" text-anchor="' + anchor
        + '" dominant-baseline="central" font-size="12.5" font-weight="600" fill="' + DIMCOLOR[d] + '" font-family="inherit">' + DIMNAME[d] + '</text>';
      svg += '<text x="' + x.toFixed(1) + '" y="' + (y + 8).toFixed(1) + '" text-anchor="' + anchor
        + '" dominant-baseline="central" font-size="11.5" fill="#9aa2ac" font-family="inherit">' + scores[d] + '</text>';
    });
    svg += '</svg>';
    return svg;
  }

  /* ---------- 长图雷达图：Canvas（避免 html2canvas 解析 SVG 的不确定性） ---------- */
  function drawRadarCanvas(ctx, scores, W, H, opt) {
    opt = opt || {};
    var cx = W / 2, cy = H / 2 + 4, R = Math.min(W, H) * 0.30, LR = R + 66;
    var ink = opt.ink || '#1c2026', grid = opt.grid || '#e2e6ec';

    ctx.clearRect(0, 0, W, H);
    ctx.lineWidth = 1;
    [0.25, 0.5, 0.75, 1].forEach(function (f) {
      ctx.beginPath();
      DIMS.forEach(function (_, i) {
        var a = (-90 + i * STEP) * Math.PI / 180;
        var x = cx + R * f * Math.cos(a), y = cy + R * f * Math.sin(a);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.closePath();
      ctx.strokeStyle = grid;
      ctx.stroke();
    });
    DIMS.forEach(function (_, i) {
      var a = (-90 + i * STEP) * Math.PI / 180;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + R * Math.cos(a), cy + R * Math.sin(a));
      ctx.strokeStyle = grid;
      ctx.stroke();
    });
    ctx.beginPath();
    DIMS.forEach(function (d, i) {
      var a = (-90 + i * STEP) * Math.PI / 180;
      var r = R * Math.max(scores[d], 2) / 100;
      var x = cx + r * Math.cos(a), y = cy + r * Math.sin(a);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.fillStyle = 'rgba(255,122,24,.20)';
    ctx.fill();
    ctx.strokeStyle = '#ff7a18';
    ctx.lineWidth = 2.2;
    ctx.lineJoin = 'round';
    ctx.stroke();
    DIMS.forEach(function (d, i) {
      var a = (-90 + i * STEP) * Math.PI / 180;
      var r = R * Math.max(scores[d], 2) / 100;
      ctx.beginPath();
      ctx.arc(cx + r * Math.cos(a), cy + r * Math.sin(a), 3.4, 0, Math.PI * 2);
      ctx.fillStyle = DIMCOLOR[d];
      ctx.fill();
    });
    DIMS.forEach(function (d, i) {
      var a = (-90 + i * STEP) * Math.PI / 180;
      var x = cx + LR * Math.cos(a), y = cy + LR * Math.sin(a);
      var align = Math.abs(x - cx) < 8 ? 'center' : (x > cx ? 'left' : 'right');
      ctx.textAlign = align;
      ctx.textBaseline = 'middle';
      ctx.font = '700 24px "PingFang SC","Microsoft YaHei",sans-serif';
      ctx.fillStyle = DIMCOLOR[d];
      ctx.fillText(DIMNAME[d], x, y - 15);
      ctx.font = '400 22px "PingFang SC","Microsoft YaHei",sans-serif';
      ctx.fillStyle = '#9aa2ac';
      ctx.fillText(String(scores[d]), x, y + 16);
    });
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    return { cx: cx, cy: cy, R: R };
  }

  w.QZ = {
    computeScores: computeScores,
    analyze: analyze,
    drawRadarSVG: drawRadarSVG,
    drawRadarCanvas: drawRadarCanvas
  };
})(window);
