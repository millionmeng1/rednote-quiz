/* 计分 / 结果解析 / 雷达图（屏幕用 SVG，长图用 Canvas）
   和万圣节款的四处不同：
   1. 两个维度：主结果（八位嘉宾，g）+ 观察室（六位，r）。
      两边都是投票制，都要除以出场次数归一，排名都必须用未取整的 raw。
   2. 八位嘉宾每人出场正好 6 次、六位观察室每人出场正好 8 次 ——
      但归一逻辑不能依赖这个巧合，题库以后加题就破了。
   3. 指数叫「意难平指数」：越高越放不下。数值本身= 万圣节款里"阴气"的位置
      （0.55×top2 + 0.45×mean），只是读法换了方向。
   4. 八边形雷达图。 */
(function (w) {
  'use strict';
  var QD = w.QD;
  var DIMS = QD.DIMS, RDIMS = QD.RDIMS, DIMNAME = QD.DIMNAME, DIMCOLOR = QD.DIMCOLOR;
  var OBS = QD.OBS, COMBOS = QD.COMBOS;
  var N = DIMS.length;                       /* 8 */
  var STEP = 360 / N;
  var ACCENT = '#7a5af8';

  /* ---------- 计分 ---------- */
  function computeScores(answers) {
    var hit = {}, rhit = {};
    DIMS.forEach(function (d) { hit[d] = 0; });
    RDIMS.forEach(function (d) { rhit[d] = 0; });
    QD.QUESTIONS.forEach(function (q, i) {
      var a = answers[i] || 0;               /* 1..4，0 = 没答 */
      if (!a) return;
      var opt = q.o[a - 1];
      if (!opt) return;
      if (hit[opt.g] !== undefined) hit[opt.g]++;
      if (rhit[opt.r] !== undefined) rhit[opt.r]++;
    });
    /* dim/raw 只用于显示与排名：raw 是没取整的精确比值，排名必须用它。
       只按取整百分数排，平票会永远偏向 DIMS 靠前的那几位。 */
    var s = {}, raw = {}, rs = {}, rraw = {};
    DIMS.forEach(function (d) {
      var total = QD.GCOUNT[d] || 1;
      raw[d] = hit[d] / total;
      s[d] = Math.round(raw[d] * 100);
    });
    RDIMS.forEach(function (d) {
      var total = QD.RCOUNT[d] || 1;
      rraw[d] = rhit[d] / total;
      rs[d] = Math.round(rraw[d] * 100);
    });
    var vals = DIMS.map(function (d) { return s[d]; });
    var mean = vals.reduce(function (a, b) { return a + b; }, 0) / N;
    /* 意难平指数：越集中=越放不下。
       标定依据（八位出场数相同，5 万次模拟量的）：纯随机作答 top1≈0.50、
       65% 本能≈0.75、全选同一位=1.00。所以映射不能直接乘 100 ——
       万圣节款那种 0.55×top2+0.45×mean 的写法在这里会把纯选的人算成 44。
       这里用 (0.8×top1 + 0.2×top2 − 0.30) / 0.60 拉满区间：
         纯选 → 96（浓得化不开） 65% → 64（还热着） 纯随机 → 30（基本释怀） */
    var rvals = DIMS.map(function (d) { return raw[d]; }).sort(function (a, b) { return b - a; });
    var zhi = Math.round(((0.8 * rvals[0] + 0.2 * rvals[1]) - 0.30) / 0.60 * 100);
    zhi = Math.max(0, Math.min(100, zhi));
    return { dim: s, raw: raw, hit: hit, rdim: rs, rraw: rraw, rhit: rhit,
      yin: zhi, index: zhi, mean: mean, max: Math.max.apply(null, vals) };
  }

  /* ---------- 结果解析 ---------- */
  function analyze(answers) {
    var r = computeScores(answers);
    var order = DIMS.slice().sort(function (a, b) {
      if (r.raw[b] !== r.raw[a]) return r.raw[b] - r.raw[a];
      if (r.hit[b] !== r.hit[a]) return r.hit[b] - r.hit[a];
      return DIMS.indexOf(a) - DIMS.indexOf(b);
    });
    var rorder = RDIMS.slice().sort(function (a, b) {
      if (r.rraw[b] !== r.rraw[a]) return r.rraw[b] - r.rraw[a];
      if (r.rhit[b] !== r.rhit[a]) return r.rhit[b] - r.rhit[a];
      return RDIMS.indexOf(a) - RDIMS.indexOf(b);
    });
    var mainKey = order[0], secKey = order[1], obsKey = rorder[0];

    var comboText = COMBOS[mainKey + '-' + obsKey] || '';

    var vals = DIMS.map(function (d) { return r.dim[d]; });
    var span = r.max - Math.min.apply(null, vals);
    var flat = span <= 8;                    /* 八位咬得很均匀 */
    var lowSec = r.dim[secKey] < 25;         /* 第二名太弱，不拼进标题 */
    var highLoad = DIMS.filter(function (d) { return r.dim[d] > 60; }).length >= 3;

    var band = r.index >= 78 ? '浓得化不开' : (r.index >= 58 ? '还热着' : (r.index >= 40 ? '在降温' : '基本释怀'));
    var nowline = '你的意难平指数是 ' + r.index + ' —— 旧友成分里最重的两位是 '
      + DIMNAME[mainKey] + '（' + r.dim[mainKey] + '）和 ' + DIMNAME[secKey] + '（' + r.dim[secKey] + '）。',
      flatline = '你的意难平指数是 ' + r.index + ' —— 八位旧友的票咬得非常近：说明你的走散方式不是一种，是每种都占了一点。',
      lowline = '你的意难平指数是 ' + r.index + ' —— 成分高度集中在 ' + DIMNAME[mainKey]
        + '（' + r.dim[mainKey] + '）一位身上，其余几位都还轻。';
    if (lowSec) nowline = lowline;
    if (flat) nowline = flatline;
    if (highLoad) nowline = '你的意难平指数是 ' + r.index + '，而且八位里有三位以上都在高位 —— 这已经不是"像谁"的问题，'
      + '是你把好几种走散的方式都攒在身上。先挑最响的那一个处理，别想一次全放下。';

    var comboTitle, comboBody;
    if (flat) {
      comboTitle = '八友均沾 · 观察室坐的是' + OBS[obsKey].name;
      comboBody = (comboText || '') + '（你的票投得很散：不是某一位特别重，是每一位都占了一点。先认下最像的那位，其余的慢慢来。）';
    } else {
      comboTitle = '你是' + DIMNAME[mainKey] + ' · 观察室坐的是' + OBS[obsKey].name;
      comboBody = comboText;
    }

    var title = flat ? '八友均沾' : DIMNAME[mainKey];

    return {
      scores: r.dim, raw: r.raw, hit: r.hit, index: r.index, order: order,
      obsScores: r.rdim, obsRaw: r.rraw, obsHit: r.rhit, obsOrder: rorder,
      obsKey: obsKey, obs: OBS[obsKey],
      mainKey: mainKey, secKey: secKey, highLoad: highLoad, lowSec: lowSec, flat: flat,
      typeKey: mainKey, T: QD.TYPES[mainKey], color: DIMCOLOR[mainKey],
      comboTitle: comboTitle, comboBody: comboBody, nowline: nowline, band: band,
      title: title
    };
  }

  /* ---------- 屏幕雷达图：SVG ---------- */
  function drawRadarSVG(scores) {
    var cx = 148, cy = 146, R = 88, LR = 112;
    var svg = '<svg viewBox="0 0 296 300" class="radar" role="img" aria-label="旧友成分雷达图">';
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
      var rr = R * Math.max(scores[d], 2) / 100;
      return (cx + rr * Math.cos(a)).toFixed(1) + ',' + (cy + rr * Math.sin(a)).toFixed(1);
    }).join(' ');
    svg += '<polygon points="' + dpts + '" fill="rgba(122,90,248,.20)" stroke="' + ACCENT + '" stroke-width="1.6" stroke-linejoin="round"/>';
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

  /* ---------- 长图雷达图：Canvas ---------- */
  function drawRadarCanvas(ctx, scores, W, H, opt) {
    opt = opt || {};
    var cx = W / 2, cy = H / 2 + 4, R = Math.min(W, H) * 0.30, LR = R + 66;
    var grid = opt.grid || '#e2e6ec';

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
      var rr = R * Math.max(scores[d], 2) / 100;
      var x = cx + rr * Math.cos(a), y = cy + rr * Math.sin(a);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.fillStyle = 'rgba(122,90,248,.18)';
    ctx.fill();
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 2.2;
    ctx.lineJoin = 'round';
    ctx.stroke();
    DIMS.forEach(function (d, i) {
      var a = (-90 + i * STEP) * Math.PI / 180;
      var rr = R * Math.max(scores[d], 2) / 100;
      ctx.beginPath();
      ctx.arc(cx + rr * Math.cos(a), cy + rr * Math.sin(a), 3.4, 0, Math.PI * 2);
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
