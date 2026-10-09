/* ------------------------------------------------------------------
 * ops/plots.js — 可视化绘图
 *  · hist      直方图（分箱过程可视化）
 *  · bar       柱状图（频次 / 聚合值）
 *  · line      折线图（逐点绘制）
 *  · scatter   散点图（点飞入坐标系）
 *  · box       箱线图（五数概括 + 离群点自动识别）
 * ------------------------------------------------------------------ */

import { Script, T, CODE } from '../frames.js';
import { isNA, fmt, mean, median, std, quantile, sum, histogram } from '../utils.js';
import { pickLabelCol, labelOf, unitOf, colSummary, domain } from './common.js';

/* ================================================================
 * 直方图
 * ================================================================ */
export function opHist(df, cfg = {}) {
  const col = cfg.col || df.columns.find((c) => df.dtypes[c] === 'number');
  const unit = unitOf(df, col);
  const S = new Script(df, 'hist');
  const values = df.col(col);
  const nums = values.filter((v) => typeof v === 'number' && Number.isFinite(v));

  // 先按 Sturges 定箱数，方便讲解
  const nbins = cfg.bins || Math.max(6, Math.min(14, Math.ceil(Math.log2(nums.length) + 1)));
  const H = histogram(nums, nbins);
  S.code(CODE.hist({ col, bins: nbins }));

  const emptyBins = () => H.counts.map(() => 0);
  const stage = (counts, extra = {}) => ({
    kind: 'chart', type: 'hist', col, unit,
    labels: H.edges.slice(0, -1).map((e, i) => `${fmt(e)}–${fmt(H.edges[i + 1])}`),
    counts, edges: H.edges, maxCount: Math.max(...H.counts, 1),
    ...extra,
  });

  S.add({
    phase: '① 分箱',
    title: `${col} 的取值范围 ${fmt(H.min)} ~ ${fmt(H.max)}`,
    narration: `直方图回答的是「数据都集中在哪些区间」。做法是把整个值域等分成若干「箱」，` +
      `宽度 = (${fmt(H.max)} − ${fmt(H.min)}) ÷ ${nbins} ≈ ${fmt(H.width)}${unit}，然后统计每个箱里落了多少个数据点。`,
    duration: 3200,
    tone: 'info',
    code: S.codeAt(0),
    table: S.table(T(df, { rowState: () => 'dim', cellState: (r, i, name) => (name === col ? 'focus' : null) })),
    stage: stage(emptyBins(), { edges: H.edges, showEdges: true }),
    hud: [{ label: 'bins', value: String(nbins), tone: 'cyan' }, { label: '箱宽', value: fmt(H.width) + unit, tone: 'mute' }],
  });

  /* 逐行投箱 */
  const CHUNK = 4;
  const counts = emptyBins();
  const perBin = H.counts.map(() => []);
  for (let i = 0; i < values.length; i += CHUNK) {
    const end = Math.min(i + CHUNK, values.length);
    const hits = [];
    for (let k = i; k < end; k++) {
      const v = values[k];
      if (typeof v !== 'number' || !Number.isFinite(v)) continue;
      let bi = Math.floor((v - H.min) / H.width);
      if (bi >= nbins) bi = nbins - 1;
      if (bi < 0) bi = 0;
      counts[bi]++; perBin[bi].push(k); hits.push({ v, bi });
    }
    const lead = hits.find((h) => !H.counts.slice(0, h.bi).every(() => true)) || hits[0];
    S.add({
      phase: '② 逐行投箱',
      title: hits.length ? `${hits.map((h) => fmt(h.v)).slice(0, 3).join('、')}${hits.length > 3 ? ' …' : ''} 落入第 ${[...new Set(hits.map((h) => h.bi + 1))].join('、')} 箱` : `第 ${i + 1}–${end} 行为缺失值，跳过`,
      narration: hits.length
        ? `判断一个值属于哪个箱，只需做一次除法：⌊(x − ${fmt(H.min)}) / ${fmt(H.width)}⌋。` +
          `例如 ${fmt(hits[0].v)} → 第 ${hits[0].bi + 1} 箱。每投入一个点，对应柱子的高度就长一格。`
        : `缺失值不参与分箱统计。`,
      duration: 950,
      tone: 'info',
      code: S.codeAt(0),
      table: S.table(T(df, {
        rowState: (r, j) => (j >= i && j < end ? 'focus' : 'dim'),
        cellState: (r, j, name) => (name === col ? (j < end ? 'seen' : null) : null),
      })),
      stage: stage(counts.slice(), { cursor: end - 1 }),
      hud: [{ label: '已投箱', value: `${end}/${values.length}`, tone: 'cyan' },
        { label: '最高柱', value: String(Math.max(...counts)), tone: 'gold' }],
    });
  }

  const peak = H.counts.indexOf(Math.max(...H.counts));
  S.add({
    phase: '③ 结果',
    title: `分布形态：峰值出现在 ${fmt(H.edges[peak])}–${fmt(H.edges[peak + 1])}${unit}`,
    narration: `直方图把「一列数字」变成了「一个形状」。${H.counts[peak]} 个数据点挤在第 ${peak + 1} 箱（${fmt(H.edges[peak])}–${fmt(H.edges[peak + 1])}${unit}），` +
      `而两端的柱子明显偏低 —— 这些低矮的柱子告诉你极端值在哪里，也告诉你均值会被往哪个方向拽。`,
    duration: 3400,
    tone: 'ok',
    final: true,
    code: S.codeAt(0),
    table: S.table(T(df, { rowState: () => 'dim', cellState: (r, i, name) => (name === col ? 'seen' : null) })),
    stage: stage(H.counts.slice(), { done: true, peak }),
    hud: [{ label: 'n', value: String(nums.length), tone: 'cyan' }, { label: 'mean', value: fmt(mean(nums)), tone: 'gold' },
      { label: 'std', value: fmt(std(nums, 1)), tone: 'mute' }],
  });

  return { frames: S.frames, result: df, summary: `${col} 直方图（${nbins} 箱）` };
}

/* ================================================================
 * 柱状图
 * ================================================================ */
export function opBar(df, cfg = {}) {
  const x = cfg.x || df.columns.find((c) => df.dtypes[c] !== 'number') || df.columns[0];
  const aggFn = cfg.fn || 'count';
  const unit = aggFn === 'count' ? '条' : (df.meta?.unit?.[cfg.y] || '');
  const S = new Script(df, 'plot.bar');

  const keys = [...new Set(df.col(x).map((v) => (isNA(v) ? 'NaN' : String(v))))];
  const groups = keys.map((k) => ({ k, items: [] }));
  const gmap = new Map(groups.map((g) => [g.k, g]));
  df._rows.forEach((r, i) => {
    const k = isNA(r.cells[df.columns.indexOf(x)]) ? 'NaN' : String(r.cells[df.columns.indexOf(x)]);
    gmap.get(k).items.push(i);
  });
  const bars = groups.map((g) => ({
    key: g.k,
    value: aggFn === 'count' ? g.items.length : NaN,
    count: g.items.length,
  }));
  const maxVal = Math.max(...bars.map((b) => b.value), 1);

  S.add({
    phase: '① 分组计数',
    title: `按 ${x} 统计${aggFn === 'count' ? '数量' : aggFn}`,
    narration: `柱状图适合比较「类别之间」。${x} 共有 ${keys.length} 个不同取值，每一个都会得到一根柱子，` +
      `柱高就是这一类的${aggFn === 'count' ? '记录条数' : '聚合值'}。`,
    duration: 3000,
    tone: 'info',
    code: S.codeAt(0),
    table: S.table(T(df, { rowState: () => 'dim', cellState: (r, i, name) => (name === x ? 'focus' : null) })),
    stage: { kind: 'chart', type: 'bar', x, unit, bars: bars.map((b) => ({ ...b, value: 0 })), maxVal, keys },
  });

  /* 逐类生长 */
  for (let i = 0; i < bars.length; i++) {
    S.add({
      phase: '② 逐柱生长',
      title: `${bars[i].key}：${bars[i].value}${unit}`,
      narration: `把所有 ${x} = ${bars[i].key} 的行筛出来，一共 ${bars[i].count} 条，柱子的高度随之定格在 ${bars[i].value}${unit}。` +
        (i === bars.findIndex((b) => b.value === maxVal) ? ` 这是最高的一根 —— 也是占比最大的一类。` : ''),
      duration: 1050,
      tone: 'info',
      code: S.codeAt(0),
      table: S.table(T(df, {
        rowState: (r, j) => (String(r.cells[df.columns.indexOf(x)]) === bars[i].key ? 'focus' : 'dim'),
        cellState: (r, j, name) => (name === x && String(r.cells[df.columns.indexOf(x)]) === bars[i].key ? 'best' : null),
      })),
      stage: { kind: 'chart', type: 'bar', x, unit, maxVal, keys, bars: bars.map((b, k) => ({ ...b, value: k <= i ? b.value : 0 })), cursor: i },
      hud: [{ label: '已绘制', value: `${i + 1}/${bars.length}`, tone: 'cyan' }],
    });
  }

  S.add({
    phase: '③ 结果',
    title: `最高：${bars.reduce((a, b) => (b.value > a.value ? b : a)).key}`,
    narration: `柱子全部就位。类别之间的差异一眼可见。${keys.length > 6 ? `注意类别较多时（当前 ${keys.length} 类），柱状图会变得拥挤 —— 这时应该考虑先合并长尾类别。` : ''}`,
    duration: 2800,
    tone: 'ok',
    final: true,
    code: S.codeAt(0),
    table: S.table(T(df, { rowState: () => 'dim' })),
    stage: { kind: 'chart', type: 'bar', x, unit, bars, maxVal, keys, done: true },
    hud: [{ label: '类别数', value: String(bars.length), tone: 'cyan' }, { label: '总计', value: String(sum(bars.map((b) => b.value))), tone: 'ok' }],
  });

  return { frames: S.frames, result: df, summary: `${x} 频次柱状图` };
}

/* ================================================================
 * 折线图
 * ================================================================ */
export function opLine(df, cfg = {}) {
  const y = cfg.y || df.columns.find((c) => df.dtypes[c] === 'number');
  const x = cfg.x || pickLabelCol(df);
  const unit = unitOf(df, y);
  const S = new Script(df, 'plot.line');
  S.code(CODE.line({ x, y }));

  const ys = df.numCol(y);
  const dom = domain(ys);
  const pts = df._rows.map((r, i) => ({
    i, x: labelOf(df, x, i),
    y: r.cells[df.columns.indexOf(y)],
    t: (typeof r.cells[df.columns.indexOf(y)] === 'number') ? (r.cells[df.columns.indexOf(y)] - dom.min) / (dom.max - dom.min) : null,
  }));

  S.add({
    phase: '① 坐标系',
    title: `${x} → ${y} 的走势`,
    narration: `折线图强调「顺序」。横轴是 ${x}，纵轴是 ${y}，${df.nrow} 个数据点会按行的顺序依次连线。` +
      `纵轴范围 ${fmt(dom.min)} ~ ${fmt(dom.max)}${unit} 由数据自动确定。`,
    duration: 2800,
    tone: 'info',
    code: S.codeAt(0),
    table: S.table(T(df, { rowState: () => 'dim', cellState: (r, i, name) => (name === y ? 'focus' : null) })),
    stage: { kind: 'chart', type: 'line', x, y, unit, dom, points: pts, progress: 0 },
  });

  const CHUNK = 3;
  for (let i = 0; i < pts.length; i += CHUNK) {
    const end = Math.min(i + CHUNK, pts.length);
    S.add({
      phase: '② 逐点绘制',
      title: `绘制到第 ${end} 个点`,
      narration: `第 ${i + 1}–${end} 个点落位并连上折线：${pts.slice(i, end).map((p) => `${p.x}=${fmt(p.y)}`).join('，')}。` +
        `折线的斜率变化就是「趋势」本身 —— 上升、下降、还是原地徘徊。`,
      duration: 950,
      tone: 'info',
      code: S.codeAt(0),
      table: S.table(T(df, {
        rowState: (r, j) => (j >= i && j < end ? 'focus' : 'dim'),
        cellState: (r, j, name) => (name === y ? (j < end ? 'seen' : null) : null),
      })),
      stage: { kind: 'chart', type: 'line', x, y, unit, dom, points: pts, progress: end },
      hud: [{ label: '已绘制', value: `${end}/${pts.length}`, tone: 'cyan' }],
    });
  }

  S.add({
    phase: '③ 结果',
    title: `完整曲线 · ${pts.length} 个数据点`,
    narration: `整条曲线连成了。趋势、周期性、突变点都在这一条线上。` +
      `如果它是时间序列，下一步通常就是寻找规律或者预测未来。`,
    duration: 2800,
    tone: 'ok',
    final: true,
    code: S.codeAt(0),
    table: S.table(T(df, { rowState: () => 'dim', cellState: (r, i, name) => (name === y ? 'seen' : null) })),
    stage: { kind: 'chart', type: 'line', x, y, unit, dom, points: pts, progress: pts.length, done: true },
    hud: [{ label: 'min', value: fmt(Math.min(...ys)) + unit, tone: 'violet' }, { label: 'max', value: fmt(Math.max(...ys)) + unit, tone: 'rose' }],
  });

  return { frames: S.frames, result: df, summary: `${y} 随 ${x} 的折线图` };
}

/* ================================================================
 * 散点图
 * ================================================================ */
export function opScatter(df, cfg = {}) {
  const nums = df.columns.filter((c) => df.dtypes[c] === 'number');
  const x = cfg.x || nums[0], y = cfg.y || nums[1] || nums[0];
  const labelCol = pickLabelCol(df);
  const S = new Script(df, 'plot.scatter');
  S.code(CODE.scatter({ x, y }));

  const xi = df.columns.indexOf(x), yi = df.columns.indexOf(y);
  const xs = df.numCol(x), ys = df.numCol(y);
  const dx = domain(xs), dy = domain(ys);
  const pts = df._rows.map((r, i) => {
    const a = r.cells[xi], b = r.cells[yi];
    const ok = typeof a === 'number' && typeof b === 'number';
    return {
      i, name: labelOf(df, labelCol, i), x: a, y: b, ok,
      tx: ok ? (a - dx.min) / (dx.max - dx.min) : 0.5,
      ty: ok ? (b - dy.min) / (dy.max - dy.min) : 0.5,
    };
  });
  const okPts = pts.filter((p) => p.ok);

  // 皮尔逊相关系数，散点图最有价值的伴随指标
  const mx = mean(okPts.map((p) => p.x)), my = mean(okPts.map((p) => p.y));
  let sxy = 0, sxx = 0, syy = 0;
  okPts.forEach((p) => { sxy += (p.x - mx) * (p.y - my); sxx += (p.x - mx) ** 2; syy += (p.y - my) ** 2; });
  const r = sxy / Math.sqrt(sxx * syy || 1);

  S.add({
    phase: '① 两个变量',
    title: `${x} 与 ${y} 之间有关系吗？`,
    narration: `散点图是探索「两个数值列之间关系」的标准工具。横轴 ${x}，纵轴 ${y}，` +
      `每一行数据变成一个点。如果点云呈现某种走向，说明两者相关。`,
    duration: 3000,
    tone: 'info',
    code: S.codeAt(0),
    table: S.table(T(df, { rowState: () => 'dim', cellState: (r, i, name) => (name === x || name === y ? 'focus' : null) })),
    stage: { kind: 'chart', type: 'scatter', x, y, dom: { x: dx, y: dy }, points: pts, progress: 0 },
  });

  const CHUNK = 3;
  for (let i = 0; i < pts.length; i += CHUNK) {
    const end = Math.min(i + CHUNK, pts.length);
    S.add({
      phase: '② 逐点落位',
      title: `已落位 ${end} / ${pts.length} 个点`,
      narration: `每一行数据被读到 (${x}, ${y}) 这对坐标上。${pts.slice(i, end).filter((p) => p.ok).map((p) => `${p.name}(${fmt(p.x)}, ${fmt(p.y)})`).join('、') || '（本段含缺失值，无法定位）'}。`,
      duration: 900,
      tone: 'info',
      code: S.codeAt(0),
      table: S.table(T(df, {
        rowState: (r, j) => (j >= i && j < end ? 'focus' : 'dim'),
        cellState: (r, j, name) => (name === x || name === y ? (j < end ? 'seen' : null) : null),
      })),
      stage: { kind: 'chart', type: 'scatter', x, y, dom: { x: dx, y: dy }, points: pts, progress: end },
      hud: [{ label: '已落位', value: `${end}/${pts.length}`, tone: 'cyan' }],
    });
  }

  S.add({
    phase: '③ 结果',
    title: `相关系数 r = ${fmt(r, 3)}`,
    narration: `点云的整体走向可以用皮尔逊相关系数定量描述：r = ${fmt(r, 3)}。` +
      `${Math.abs(r) > 0.7 ? '这是一个较强的线性关系。' : Math.abs(r) > 0.4 ? '存在中等强度的线性关系。' : '线性关系较弱 —— 但请注意，r 接近 0 只说明「没有线性关系」，不代表完全无关（可能是曲线关系）。'}` +
      ` 另外，图中的离群点会显著影响 r 的取值。`,
    duration: 3400,
    tone: 'ok',
    final: true,
    code: S.codeAt(0),
    table: S.table(T(df, { rowState: () => 'dim', cellState: (r2, i, name) => (name === x || name === y ? 'seen' : null) })),
    stage: { kind: 'chart', type: 'scatter', x, y, dom: { x: dx, y: dy }, points: pts, progress: pts.length, done: true, r },
    hud: [{ label: 'r', value: fmt(r, 3), tone: Math.abs(r) > 0.5 ? 'ok' : 'warn' }, { label: 'n', value: String(okPts.length), tone: 'cyan' }],
  });

  return { frames: S.frames, result: df, summary: `${x} vs ${y} 散点图（r=${fmt(r, 3)}）` };
}

/* ================================================================
 * 箱线图
 * ================================================================ */
export function opBox(df, cfg = {}) {
  const col = cfg.col || df.columns.find((c) => df.dtypes[c] === 'number');
  const unit = unitOf(df, col);
  const labelCol = pickLabelCol(df);
  const S = new Script(df, 'plot.box');
  S.code(CODE.box({ cols: [col] }));

  const values = df.col(col);
  const nums = values.filter((v) => typeof v === 'number' && Number.isFinite(v));
  const q1 = quantile(nums, 0.25), q2 = median(nums), q3 = quantile(nums, 0.75);
  const iqr = q3 - q1;
  const loF = q1 - 1.5 * iqr, hiF = q3 + 1.5 * iqr;
  const inliers = nums.filter((v) => v >= loF && v <= hiF);
  const wLo = Math.min(...inliers), wHi = Math.max(...inliers);
  const outliers = values.map((v, i) => ({ v, i })).filter((o) => typeof o.v === 'number' && (o.v < loF || o.v > hiF));
  const dom = domain(nums);

  const boxData = (extra = {}) => ({
    kind: 'chart', type: 'box', col, unit, dom, labelCol,
    q1, q2, q3, loF, hiF, wLo, wHi,
    rug: values.filter((v) => typeof v === 'number' && Number.isFinite(v)),
    outliers: outliers.map((o) => ({ ...o, name: labelOf(df, labelCol, o.i) })),
    ...extra,
  });

  S.add({
    phase: '① 五数概括',
    title: `${col}：min / Q1 / 中位数 / Q3 / max`,
    narration: `箱线图把一列数字压缩成五个关键位置。先排序，然后取第 25%、50%、75% 三个分位点：` +
      `Q1 = ${fmt(q1)}，中位数 = ${fmt(q2)}，Q3 = ${fmt(q3)}${unit}。`,
    duration: 3400,
    tone: 'info',
    code: S.codeAt(0),
    table: S.table(T(df, { rowState: () => 'dim', cellState: (r, i, name) => (name === col ? 'focus' : null) })),
    stage: boxData({ step: 'quartiles' }),
    hud: [{ label: 'Q1', value: fmt(q1), tone: 'mute' }, { label: 'Q2', value: fmt(q2), tone: 'gold' }, { label: 'Q3', value: fmt(q3), tone: 'mute' }],
  });

  S.add({
    phase: '② 箱体与须',
    title: `IQR = ${fmt(iqr)} · 须的范围 [${fmt(wLo)}, ${fmt(wHi)}]`,
    narration: `中间那个盒子从 Q1 延伸到 Q3，它的高度就是 IQR = ${fmt(iqr)}${unit}，包含了中间 50% 的数据。` +
      `盒子越矮，说明数据越集中。须则延伸到「仍然正常」的最远点：下须 ${fmt(wLo)}，上须 ${fmt(wHi)}。`,
    duration: 3200,
    tone: 'info',
    code: S.codeAt(0),
    table: S.table(T(df, { rowState: () => 'dim', cellState: (r, i, name) => (name === col ? 'focus' : null) })),
    stage: boxData({ step: 'box' }),
    hud: [{ label: 'IQR', value: fmt(iqr), tone: 'cyan' }, { label: '下须', value: fmt(wLo), tone: 'mute' }, { label: '上须', value: fmt(wHi), tone: 'mute' }],
  });

  S.add({
    phase: '③ 离群点',
    title: `自动识别出 ${outliers.length} 个离群点`,
    narration: `界限规则：超出 [Q1 − 1.5×IQR, Q3 + 1.5×IQR] = [${fmt(loF)}, ${fmt(hiF)}] 的值被判为离群点，画成独立的圆点。` +
      `${outliers.length ? `这里有 ${outliers.length} 个：${outliers.map((o) => `${labelOf(df, labelCol, o.i)} 的 ${fmt(o.v)}`).join('、')}。` : '本例中没有离群点。'}` +
      ` 这正是箱线图最实用的地方 —— 它用一条规则替你把异常值标了出来，无需人眼扫描。`,
    duration: 3600,
    tone: outliers.length ? 'warn' : 'ok',
    code: S.codeAt(0),
    table: S.table(T(df, {
      rowState: (r, i) => (outliers.some((o) => o.i === i) ? 'danger' : 'dim'),
      cellState: (r, i, name) => (name === col && outliers.some((o) => o.i === i) ? 'champ-max' : null),
    })),
    stage: boxData({ step: 'outliers' }),
    hud: [{ label: '离群点', value: String(outliers.length), tone: 'danger' },
      { label: '下界', value: fmt(loF), tone: 'violet' }, { label: '上界', value: fmt(hiF), tone: 'rose' }],
  });

  S.add({
    phase: '④ 结果',
    title: outliers.length ? `清洗前先知道要删谁` : `${col} 分布干净`,
    narration: outliers.length
      ? `箱线图已经替我们锁定了 ${outliers.length} 个待处理的值。可以直接 drop，也可以用 clip 压回边界 —— 这就是「可视化驱动清洗」：先看图，再动手。`
      : `没有任何值越界，这一列的分布是健康的。`,
    duration: 3000,
    tone: 'ok',
    final: true,
    code: S.codeAt(0),
    table: S.table(T(df, {
      rowState: (r, i) => (outliers.some((o) => o.i === i) ? 'focus' : 'dim'),
      cellState: (r, i, name) => (name === col ? (outliers.some((o) => o.i === i) ? 'champ-max' : 'seen') : null),
    })),
    stage: boxData({ step: 'outliers', done: true }),
    hud: [{ label: '离群点', value: String(outliers.length), tone: outliers.length ? 'danger' : 'ok' },
      { label: 'Q1–Q3', value: `${fmt(q1)} ~ ${fmt(q3)}`, tone: 'cyan' }],
  });

  return { frames: S.frames, result: df, summary: `${col} 箱线图（${outliers.length} 个离群点）` };
}
