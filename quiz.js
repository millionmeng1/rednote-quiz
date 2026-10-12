/* 计分 / 结果解析 / 雷达图（屏幕用 SVG，长图用 Canvas） */
(function (w) {
  'use strict';
  var QD = w.QD;
  var DIMS = QD.DIMS, DIMNAME = QD.DIMNAME, DIMCOLOR = QD.DIMCOLOR, TYPES = QD.TYPES, COMBOS = QD.COMBOS;

  /* ---------- 计分 ---------- */
  function computeScores(answers) {
    var raw = { A: 0, B: 0, C: 0, D: 0, E: 0, F: 0 };
    QD.QUESTIONS.forEach(function (q, i) { raw[q.d] += (answers[i] || 0); });
    var s = {};
    DIMS.forEach(function (d) { s[d] = Math.round((raw[d] - 3) / 12 * 100); });
    var vals = DIMS.map(function (d) { return s[d]; });
    var mean = vals.reduce(function (a, b) { return a + b; }, 0) / 6;
    var sorted = vals.slice().sort(function (a, b) { return b - a; });
    var top2 = (sorted[0] + sorted[1]) / 2;
    var index = Math.max(0, Math.min(100, Math.round(0.55 * top2 + 0.45 * mean)));
    return { dim: s, index: index, mean: mean, max: sorted[0] };
  }

  /* ---------- 结果解析 ---------- */
  function analyze(answers) {
    var r = computeScores(answers);
    var order = DIMS.slice().sort(function (a, b) {
      if (r.dim[b] !== r.dim[a]) return r.dim[b] - r.dim[a];
      return DIMS.indexOf(a) - DIMS.indexOf(b);
    });
    var mainKey = order[0], secKey = order[1];
    var allLow = r.max < 40 && r.mean < 30;
    var key = allLow ? 'G' : mainKey;
    var comboKey = [mainKey, secKey].sort().join('-');
    var comboText = COMBOS[comboKey] || '';
    var highLoad = DIMS.filter(function (d) { return r.dim[d] > 60; }).length >= 4;

    /* 副维度太低时不拼进标题，否则会出现「心累 × 角色累（0 分）」这种自相矛盾的读法 */
    var lowSec = r.dim[secKey] < 25;
    var vals = DIMS.map(function (d) { return r.dim[d]; });
    var span = r.max - Math.min.apply(null, vals);
    var flat = !allLow && span <= 6;   /* 六维几乎等高：疲惫是均匀铺开的 */

    var band = r.index < 25 ? '低' : (r.index < 45 ? '中低' : (r.index < 65 ? '中高' : '高'));
    var nowline = '你目前的整体疲劳处在「' + band + '」区间，最突出的两项是 '
      + DIMNAME[mainKey] + '(' + r.dim[mainKey] + ')' + ' 和 ' + DIMNAME[secKey] + '(' + r.dim[secKey] + ')。';
    if (lowSec && !allLow) {
      nowline = '你目前的整体疲劳处在「' + band + '」区间，疲惫高度集中在「' + DIMNAME[mainKey]
        + '」(' + r.dim[mainKey] + ') 一项，其余五项都还在低位。';
    }
    if (flat) {
      nowline = '你目前的整体疲劳处在「' + band + '」区间，但六个维度的分数非常接近——说明你的累不是来自某一件具体的事，而是各项负荷一起堆上来的。';
    }
    if (allLow) nowline = '六项指标全部处在低位，你现在属于资源比较充足的状态。';
    if (highLoad) nowline = '六项里有四项以上都在高位，这是全域高负荷状态。问题不在你怎么安排，而在你身上扛的东西太多了——现在该减量，不是提速。';

    var comboTitle = '', comboBody = '';
    if (flat) {
      comboTitle = '六维均衡 · 负荷全面铺开';
      comboBody = '你的六个维度分数几乎一样高。这种累的特点是「找不到一个可以怪的对象」——不是老板，不是某一件事，也不是某一个人。它更像是长期的总量问题：日程太满、角色太多、恢复时间被挤没了。对付它别从单点下手，要从「总量」下手：先砍掉一件事，再谈别的。';
    } else if (!allLow && !lowSec && comboText) {
      comboTitle = DIMNAME[mainKey] + ' × ' + DIMNAME[secKey];
      comboBody = comboText;
    } else if (!allLow) {
      comboTitle = '单点主导 · ' + DIMNAME[mainKey];
      comboBody = '你的疲惫高度集中在「' + DIMNAME[mainKey] + '」这一项，其余五项都还在低位。这种累其实来得更明确，也更好处理：你不需要减少总量，只需要针对这一处动手。';
    }

    var title = allLow ? '暂时低负荷'
      : (flat ? '全面铺开'
        : (lowSec ? DIMNAME[mainKey] : DIMNAME[mainKey] + ' × ' + DIMNAME[secKey]));

    return {
      scores: r.dim, index: r.index, order: order,
      mainKey: mainKey, secKey: secKey, allLow: allLow, highLoad: highLoad,
      lowSec: lowSec, flat: flat,
      typeKey: key, T: TYPES[key], color: DIMCOLOR[key],
      comboTitle: comboTitle, comboBody: comboBody, nowline: nowline, band: band,
      title: title
    };
  }

  /* ---------- 屏幕雷达图：SVG ---------- */
  function drawRadarSVG(scores) {
    var cx = 135, cy = 134, R = 86, LR = 108;
    var svg = '<svg viewBox="0 0 270 290" class="radar" role="img" aria-label="六维疲劳分布雷达图">';
    [0.25, 0.5, 0.75, 1].forEach(function (f) {
      var pts = DIMS.map(function (_, i) {
        var a = (-90 + i * 60) * Math.PI / 180;
        return (cx + R * f * Math.cos(a)).toFixed(1) + ',' + (cy + R * f * Math.sin(a)).toFixed(1);
      }).join(' ');
      svg += '<polygon points="' + pts + '" fill="none" stroke="#e5e8ee" stroke-width="0.6"/>';
    });
    DIMS.forEach(function (_, i) {
      var a = (-90 + i * 60) * Math.PI / 180;
      svg += '<line x1="' + cx + '" y1="' + cy + '" x2="' + (cx + R * Math.cos(a)).toFixed(1)
        + '" y2="' + (cy + R * Math.sin(a)).toFixed(1) + '" stroke="#e5e8ee" stroke-width="0.6"/>';
    });
    var dpts = DIMS.map(function (d, i) {
      var a = (-90 + i * 60) * Math.PI / 180;
      var r = R * Math.max(scores[d], 2) / 100;
      return (cx + r * Math.cos(a)).toFixed(1) + ',' + (cy + r * Math.sin(a)).toFixed(1);
    }).join(' ');
    svg += '<polygon points="' + dpts + '" fill="rgba(232,68,58,.22)" stroke="#e8443a" stroke-width="1.6" stroke-linejoin="round"/>';
    DIMS.forEach(function (d, i) {
      var a = (-90 + i * 60) * Math.PI / 180;
      var x = cx + LR * Math.cos(a), y = cy + LR * Math.sin(a);
      var anchor = (i === 0 || i === 3) ? 'middle' : (x > cx ? 'start' : 'end');
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
    var cx = W / 2, cy = H / 2 + 4, R = Math.min(W, H) * 0.30, LR = R + 62;
    var ink = opt.ink || '#1c2026', grid = opt.grid || '#e2e6ec';

    ctx.clearRect(0, 0, W, H);
    ctx.lineWidth = 1;
    [0.25, 0.5, 0.75, 1].forEach(function (f) {
      ctx.beginPath();
      DIMS.forEach(function (_, i) {
        var a = (-90 + i * 60) * Math.PI / 180;
        var x = cx + R * f * Math.cos(a), y = cy + R * f * Math.sin(a);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.closePath();
      ctx.strokeStyle = grid;
      ctx.stroke();
    });
    DIMS.forEach(function (_, i) {
      var a = (-90 + i * 60) * Math.PI / 180;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + R * Math.cos(a), cy + R * Math.sin(a));
      ctx.strokeStyle = grid;
      ctx.stroke();
    });
    ctx.beginPath();
    DIMS.forEach(function (d, i) {
      var a = (-90 + i * 60) * Math.PI / 180;
      var r = R * Math.max(scores[d], 2) / 100;
      var x = cx + r * Math.cos(a), y = cy + r * Math.sin(a);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.fillStyle = 'rgba(232,68,58,.20)';
    ctx.fill();
    ctx.strokeStyle = '#e8443a';
    ctx.lineWidth = 2.2;
    ctx.lineJoin = 'round';
    ctx.stroke();
    DIMS.forEach(function (d, i) {
      var a = (-90 + i * 60) * Math.PI / 180;
      var r = R * Math.max(scores[d], 2) / 100;
      ctx.beginPath();
      ctx.arc(cx + r * Math.cos(a), cy + r * Math.sin(a), 3.4, 0, Math.PI * 2);
      ctx.fillStyle = DIMCOLOR[d];
      ctx.fill();
    });
    DIMS.forEach(function (d, i) {
      var a = (-90 + i * 60) * Math.PI / 180;
      var x = cx + LR * Math.cos(a), y = cy + LR * Math.sin(a);
      var align = (i === 0 || i === 3) ? 'center' : (x > cx ? 'left' : 'right');
      ctx.textAlign = align;
      ctx.textBaseline = 'middle';
      ctx.font = '700 25px "PingFang SC","Microsoft YaHei",sans-serif';
      ctx.fillStyle = DIMCOLOR[d];
      ctx.fillText(DIMNAME[d], x, y - 15);
      ctx.font = '400 23px "PingFang SC","Microsoft YaHei",sans-serif';
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
