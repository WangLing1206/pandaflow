/* ------------------------------------------------------------------
 * ops/plots.js — 可视化操作
 *  这些操作的「主角」就是右侧的图表视图：动画每推进一步，
 *  图表里的分布/箱线/散点也会跟着变，形成图与数据的联动。
 *  hist / bar / line / scatter / box / heatmap
 * ------------------------------------------------------------------ */

import { Script, T, CODE } from '../frames.js';
import { L } from '../../i18n/index.js';
import { fmt, isNA, mean, std, sum, histogram } from '../utils.js';
import { boxStats } from '../stats.js';
import { ph, pickLabelCol, pickCategoryCol, unitOf, domain, labelOf } from './kit.js';

const F = (S, o) => S.add({
  phase: o.p, title: o.t, narration: o.n,
  duration: o.d ?? 1500, tone: o.tone || 'info',
  code: S.codeAt(o.c ?? 0), table: o.tab, stage: o.st, hud: o.hud, final: o.final,
});

/** 图表类操作共用的收尾提示：指向右侧视图 */
const hintZh = '右侧「图表」视图会同步显示这张图，并且可以随时切换成箱线图、小提琴图、散点图等 14 种呈现方式。';
const hintEn = 'The Charts view on the right shows this plot and can switch to any of 14 presentations — box, violin, scatter and more.';

/* ================================================================
 * 直方图
 * ================================================================ */
export function opHist(df, cfg = {}) {
  const col = cfg.col || df.columns.find((c) => df.dtypes[c] === 'number');
  const unit = unitOf(df, col);
  const S = new Script(df, 'hist');
  const values = df.col(col);
  const ns = values.filter((v) => typeof v === 'number' && Number.isFinite(v));
  const nbins = cfg.bins || Math.max(6, Math.min(14, Math.ceil(Math.log2(ns.length) + 1)));
  const H = histogram(ns, nbins);
  S.code(CODE.hist({ col, bins: nbins }));

  const emptyBins = () => H.counts.map(() => 0);
  const stage = (counts, extra = {}) => ({
    kind: 'chart', type: 'hist', col, unit,
    labels: H.edges.slice(0, -1).map((e, i) => `${fmt(e)}–${fmt(H.edges[i + 1])}`),
    counts, edges: H.edges, maxCount: Math.max(...H.counts, 1), ...extra,
  });

  F(S, {
    p: ph('①', '分箱', 'Binning'),
    t: L(`${col} 的取值范围 ${fmt(H.min)} ~ ${fmt(H.max)}`, `${col} spans ${fmt(H.min)} – ${fmt(H.max)}`),
    n: L(`直方图回答的是「数据都集中在哪些区间」。做法是把整个值域等分成若干「箱」，宽度 = (${fmt(H.max)} − ${fmt(H.min)}) ÷ ${nbins} ≈ ${fmt(H.width)}${unit}，然后统计每个箱里落了多少个数据点。`,
      `A histogram answers where the data clusters. The range is split into equal-width bins of (${fmt(H.max)} − ${fmt(H.min)}) ÷ ${nbins} ≈ ${fmt(H.width)}${unit}, then each bin is counted.`),
    d: 2800, c: 0,
    tab: T(df, { rowState: () => 'dim', cellState: (r, i, name) => (name === col ? 'focus' : null) }),
    st: stage(emptyBins(), { showEdges: true }),
    hud: [{ label: 'bins', value: String(nbins), tone: 'cyan' }, { label: L('箱宽', 'width'), value: fmt(H.width) + unit, tone: 'mute' }],
  });

  const CHUNK = 4;
  const counts = emptyBins();
  for (let i = 0; i < values.length; i += CHUNK) {
    const end = Math.min(i + CHUNK, values.length);
    const hits = [];
    for (let k = i; k < end; k++) {
      const v = values[k];
      if (typeof v !== 'number' || !Number.isFinite(v)) continue;
      let bi = Math.floor((v - H.min) / H.width);
      if (bi >= nbins) bi = nbins - 1;
      if (bi < 0) bi = 0;
      counts[bi]++;
      hits.push({ v, bi });
    }
    F(S, {
      p: ph('②', '逐行投箱', 'Drop into bins'),
      t: hits.length
        ? L(`${hits.map((h) => fmt(h.v)).slice(0, 3).join('、')}${hits.length > 3 ? ' …' : ''} 落入第 ${[...new Set(hits.map((h) => h.bi + 1))].join('、')} 箱`,
          `${hits.map((h) => fmt(h.v)).slice(0, 3).join(', ')}${hits.length > 3 ? ' …' : ''} → bin ${[...new Set(hits.map((h) => h.bi + 1))].join(', ')}`)
        : L(`第 ${i + 1}–${end} 行为缺失值，跳过`, `Rows ${i + 1}–${end} are missing, skipped`),
      n: hits.length
        ? L(`判断一个值属于哪个箱，只需做一次除法：⌊(x − ${fmt(H.min)}) / ${fmt(H.width)}⌋。例如 ${fmt(hits[0].v)} → 第 ${hits[0].bi + 1} 箱。每投入一个点，对应柱子的高度就长一格。`,
          `Deciding a bin takes one division: ⌊(x − ${fmt(H.min)}) / ${fmt(H.width)}⌋. For example ${fmt(hits[0].v)} → bin ${hits[0].bi + 1}. Every point dropped in raises that bar by one.`)
        : L('缺失值不参与分箱统计。', 'Missing values take no part in binning.'),
      d: 900, c: 0,
      tab: T(df, { rowState: (r, j) => (j >= i && j < end ? 'focus' : 'dim'), cellState: (r, j, name) => (name === col ? (j < end ? 'seen' : null) : null) }),
      st: stage(counts.slice(), { cursor: end - 1 }),
      hud: [{ label: 'binned', value: `${end}/${values.length}`, tone: 'cyan' },
        { label: L('最高柱', 'peak'), value: String(Math.max(...counts)), tone: 'gold' }],
    });
  }

  const peak = H.counts.indexOf(Math.max(...H.counts));
  F(S, {
    p: ph('③', '结果', 'Result'),
    t: L(`峰值出现在 ${fmt(H.edges[peak])}–${fmt(H.edges[peak + 1])}${unit}`, `Peak at ${fmt(H.edges[peak])}–${fmt(H.edges[peak + 1])}${unit}`),
    n: L(`直方图把「一列数字」变成了「一个形状」。${H.counts[peak]} 个数据点挤在第 ${peak + 1} 箱，而两端的柱子明显偏低 —— 这些低矮的柱子告诉你极端值在哪里，也告诉你均值会被往哪个方向拽。${hintZh}`,
      `A histogram turns a column of numbers into a shape. ${H.counts[peak]} points crowd into bin ${peak + 1} while the end bins stay low — those short bars show where the extremes are and which way the mean is being pulled. ${hintEn}`),
    d: 3000, tone: 'ok', c: 0, final: true,
    tab: T(df, { rowState: () => 'dim', cellState: (r, i, name) => (name === col ? 'seen' : null) }),
    st: stage(H.counts.slice(), { done: true, peak }),
    hud: [{ label: 'n', value: String(ns.length), tone: 'cyan' }, { label: 'mean', value: fmt(mean(ns)), tone: 'gold' },
      { label: 'std', value: fmt(std(ns, 1)), tone: 'mute' }],
  });

  return { frames: S.frames, result: df, summary: L(`${col} 直方图（${nbins} 箱）`, `Histogram of ${col} (${nbins} bins)`) };
}

/* ================================================================
 * 柱状图
 * ================================================================ */
export function opBar(df, cfg = {}) {
  const x = cfg.x || pickCategoryCol(df);
  const S = new Script(df, 'plot.bar');
  const keys = [...new Set(df.col(x).map((v) => (isNA(v) ? 'NaN' : String(v))))];
  const ci = df.columns.indexOf(x);
  const bars = keys.map((k) => ({ key: k, value: 0 }));
  const bmap = new Map(bars.map((b) => [b.key, b]));
  df._rows.forEach((r) => {
    const k = isNA(r.cells[ci]) ? 'NaN' : String(r.cells[ci]);
    bmap.get(k).value++;
  });
  const maxVal = Math.max(...bars.map((b) => b.value), 1);
  const unit = '';

  F(S, {
    p: ph('①', '分组计数', 'Count by category'),
    t: L(`按 ${x} 统计数量`, `Count rows per ${x}`),
    n: L(`柱状图适合比较「类别之间」。${x} 共有 ${keys.length} 个不同取值，每一个都会得到一根柱子，柱高就是这一类的记录条数。`,
      `Bar charts compare categories. ${x} has ${keys.length} distinct values, each getting a bar whose height is that category's row count.`),
    d: 2600, c: 0,
    tab: T(df, { rowState: () => 'dim', cellState: (r, i, name) => (name === x ? 'focus' : null) }),
    st: { kind: 'chart', type: 'bar', x, unit, bars: bars.map((b) => ({ ...b, value: 0 })), maxVal, keys },
  });

  for (let i = 0; i < bars.length; i++) {
    F(S, {
      p: ph('②', '逐柱生长', 'Bars grow'),
      t: L(`${bars[i].key}：${bars[i].value} 条`, `${bars[i].key}: ${bars[i].value} rows`),
      n: L(`把所有 ${x} = ${bars[i].key} 的行筛出来，一共 ${bars[i].value} 条，柱子的高度随之定格在 ${bars[i].value}。${bars[i].value === maxVal ? ' 这是最高的一根 —— 也是占比最大的一类。' : ''}`,
        `Select every row with ${x} = ${bars[i].key} — ${bars[i].value} of them — and the bar settles at ${bars[i].value}.${bars[i].value === maxVal ? ' This is the tallest bar, the largest category.' : ''}`),
      d: 950, c: 0,
      tab: T(df, { rowState: (r) => (String(r.cells[ci]) === bars[i].key ? 'focus' : 'dim'), cellState: (r, j, name) => (name === x && String(r.cells[ci]) === bars[i].key ? 'best' : null) }),
      st: { kind: 'chart', type: 'bar', x, unit, maxVal, keys, bars: bars.map((b, k) => ({ ...b, value: k <= i ? b.value : 0 })), cursor: i },
      hud: [{ label: 'drawn', value: `${i + 1}/${bars.length}`, tone: 'cyan' }],
    });
  }

  const top = bars.reduce((a, b) => (b.value > a.value ? b : a));
  F(S, {
    p: ph('③', '结果', 'Result'),
    t: L(`最高：${top.key}`, `Tallest: ${top.key}`),
    n: L(`柱子全部就位，类别之间的差异一眼可见。${keys.length > 6 ? `注意类别较多时（当前 ${keys.length} 类），柱状图会变得拥挤 —— 这时应该考虑先合并长尾类别。` : ''}${hintZh}`,
      `All bars are up and the differences are obvious at a glance.${keys.length > 6 ? ` With ${keys.length} categories the chart gets crowded — consider merging the long tail first.` : ''} ${hintEn}`),
    d: 2600, tone: 'ok', c: 0, final: true,
    tab: T(df, { rowState: () => 'dim' }),
    st: { kind: 'chart', type: 'bar', x, unit, bars, maxVal, keys, done: true },
    hud: [{ label: L('类别数', 'categories'), value: String(bars.length), tone: 'cyan' },
      { label: 'total', value: String(sum(bars.map((b) => b.value))), tone: 'ok' }],
  });

  return { frames: S.frames, result: df, summary: L(`${x} 频次柱状图`, `Bar chart of ${x}`) };
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
  const yi = df.columns.indexOf(y);
  const pts = df._rows.map((r, i) => ({
    i, x: labelOf(df, x, i), y: r.cells[yi],
    t: typeof r.cells[yi] === 'number' ? (r.cells[yi] - dom.min) / (dom.max - dom.min) : null,
  }));

  F(S, {
    p: ph('①', '坐标系', 'Coordinate system'),
    t: L(`${x} → ${y} 的走势`, `${y} over ${x}`),
    n: L(`折线图强调「顺序」。横轴是 ${x}，纵轴是 ${y}，${df.nrow} 个数据点会按行的顺序依次连线。纵轴范围 ${fmt(dom.min)} ~ ${fmt(dom.max)}${unit} 由数据自动确定。`,
      `Line charts emphasise order. The x axis is ${x}, the y axis ${y}, and the ${df.nrow} points connect in row order. The y range ${fmt(dom.min)} – ${fmt(dom.max)}${unit} comes straight from the data.`),
    d: 2600, c: 0,
    tab: T(df, { rowState: () => 'dim', cellState: (r, i, name) => (name === y ? 'focus' : null) }),
    st: { kind: 'chart', type: 'line', x, y, unit, dom, points: pts, progress: 0 },
  });

  const CHUNK = 3;
  for (let i = 0; i < pts.length; i += CHUNK) {
    const end = Math.min(i + CHUNK, pts.length);
    F(S, {
      p: ph('②', '逐点绘制', 'Draw point by point'),
      t: L(`绘制到第 ${end} 个点`, `Drawn up to point ${end}`),
      n: L(`第 ${i + 1}–${end} 个点落位并连上折线：${pts.slice(i, end).map((p) => `${p.x}=${fmt(p.y)}`).join('，')}。折线的斜率变化就是「趋势」本身 —— 上升、下降、还是原地徘徊。`,
        `Points ${i + 1}–${end} land and connect: ${pts.slice(i, end).map((p) => `${p.x}=${fmt(p.y)}`).join(', ')}. The changing slope is the trend itself — rising, falling, or flat.`),
      d: 900, c: 0,
      tab: T(df, { rowState: (r, j) => (j >= i && j < end ? 'focus' : 'dim'), cellState: (r, j, name) => (name === y ? (j < end ? 'seen' : null) : null) }),
      st: { kind: 'chart', type: 'line', x, y, unit, dom, points: pts, progress: end },
      hud: [{ label: 'drawn', value: `${end}/${pts.length}`, tone: 'cyan' }],
    });
  }

  F(S, {
    p: ph('③', '结果', 'Result'),
    t: L(`完整曲线 · ${pts.length} 个数据点`, `Full curve · ${pts.length} points`),
    n: L(`整条曲线连成了。趋势、周期性、突变点都在这一条线上。如果它是时间序列，下一步通常就是寻找规律或者预测未来。${hintZh}`,
      `The curve is complete. Trend, cycles and sudden jumps are all visible in one line. For a time series the next step is usually finding the pattern or forecasting. ${hintEn}`),
    d: 2600, tone: 'ok', c: 0, final: true,
    tab: T(df, { rowState: () => 'dim', cellState: (r, i, name) => (name === y ? 'seen' : null) }),
    st: { kind: 'chart', type: 'line', x, y, unit, dom, points: pts, progress: pts.length, done: true },
    hud: [{ label: 'min', value: fmt(Math.min(...ys)) + unit, tone: 'cyan' },
      { label: 'max', value: fmt(Math.max(...ys)) + unit, tone: 'rose' }],
  });

  return { frames: S.frames, result: df, summary: L(`${y} 随 ${x} 的折线图`, `Line chart of ${y} over ${x}`) };
}

/* ================================================================
 * 散点图
 * ================================================================ */
export function opScatter(df, cfg = {}) {
  const numCols = df.columns.filter((c) => df.dtypes[c] === 'number');
  const x = cfg.x || numCols[0], y = cfg.y || numCols[1] || numCols[0];
  const labelCol = pickLabelCol(df);
  const S = new Script(df, 'plot.scatter');
  S.code(CODE.scatter({ x, y }));

  const xi = df.columns.indexOf(x), yi = df.columns.indexOf(y);
  const dx = domain(df.numCol(x)), dy = domain(df.numCol(y));
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
  const mx = mean(okPts.map((p) => p.x)), my = mean(okPts.map((p) => p.y));
  let sxy = 0, sxx = 0, syy = 0;
  okPts.forEach((p) => { sxy += (p.x - mx) * (p.y - my); sxx += (p.x - mx) ** 2; syy += (p.y - my) ** 2; });
  const r = sxy / Math.sqrt(sxx * syy || 1);

  F(S, {
    p: ph('①', '两个变量', 'Two variables'),
    t: L(`${x} 与 ${y} 之间有关系吗？`, `Is there a relationship between ${x} and ${y}?`),
    n: L(`散点图是探索「两个数值列之间关系」的标准工具。横轴 ${x}，纵轴 ${y}，每一行数据变成一个点。如果点云呈现某种走向，说明两者相关。`,
      `A scatter plot is the standard tool for exploring the relationship between two numeric columns. The x axis is ${x}, the y axis ${y}, and each row becomes a point. If the cloud has a direction, they are related.`),
    d: 2800, c: 0,
    tab: T(df, { rowState: () => 'dim', cellState: (r2, i, name) => (name === x || name === y ? 'focus' : null) }),
    st: { kind: 'chart', type: 'scatter', x, y, dom: { x: dx, y: dy }, points: pts, progress: 0 },
  });

  const CHUNK = 3;
  for (let i = 0; i < pts.length; i += CHUNK) {
    const end = Math.min(i + CHUNK, pts.length);
    F(S, {
      p: ph('②', '逐点落位', 'Points land'),
      t: L(`已落位 ${end} / ${pts.length} 个点`, `${end} / ${pts.length} points placed`),
      n: L(`每一行数据被读到 (${x}, ${y}) 这对坐标上：${pts.slice(i, end).filter((p) => p.ok).map((p) => `${p.name}(${fmt(p.x)}, ${fmt(p.y)})`).join('、') || '（本段含缺失值，无法定位）'}。`,
        `Each row is read onto the (${x}, ${y}) pair: ${pts.slice(i, end).filter((p) => p.ok).map((p) => `${p.name}(${fmt(p.x)}, ${fmt(p.y)})`).join(', ') || '(missing values in this block)'}.`),
      d: 850, c: 0,
      tab: T(df, { rowState: (r2, j) => (j >= i && j < end ? 'focus' : 'dim'), cellState: (r2, j, name) => (name === x || name === y ? (j < end ? 'seen' : null) : null) }),
      st: { kind: 'chart', type: 'scatter', x, y, dom: { x: dx, y: dy }, points: pts, progress: end },
      hud: [{ label: 'placed', value: `${end}/${pts.length}`, tone: 'cyan' }],
    });
  }

  const ar = Math.abs(r);
  F(S, {
    p: ph('③', '结果', 'Result'),
    t: L(`相关系数 r = ${fmt(r, 3)}`, `Correlation r = ${fmt(r, 3)}`),
    n: L(`点云的整体走向可以用皮尔逊相关系数定量描述：r = ${fmt(r, 3)}。${ar > 0.7 ? '这是一个较强的线性关系。' : ar > 0.4 ? '存在中等强度的线性关系。' : '线性关系较弱 —— 但请注意，r 接近 0 只说明「没有线性关系」，不代表完全无关（可能是曲线关系）。'} 另外，图中的离群点会显著影响 r 的取值。${hintZh}`,
      `The overall direction of the cloud is quantified by the Pearson coefficient: r = ${fmt(r, 3)}. ${ar > 0.7 ? 'That is a fairly strong linear relationship.' : ar > 0.4 ? 'There is a moderate linear relationship.' : 'The linear relationship is weak — but note that r near 0 only means no linear relation, not no relation at all (it could be curved).'} Outliers in the plot also strongly affect r. ${hintEn}`),
    d: 3000, tone: 'ok', c: 0, final: true,
    tab: T(df, { rowState: () => 'dim', cellState: (r2, i, name) => (name === x || name === y ? 'seen' : null) }),
    st: { kind: 'chart', type: 'scatter', x, y, dom: { x: dx, y: dy }, points: pts, progress: pts.length, done: true, r },
    hud: [{ label: 'r', value: fmt(r, 3), tone: ar > 0.5 ? 'ok' : 'warn' }, { label: 'n', value: String(okPts.length), tone: 'cyan' }],
  });

  return { frames: S.frames, result: df, summary: L(`${x} vs ${y} 散点图（r=${fmt(r, 3)}）`, `Scatter ${x} vs ${y} (r=${fmt(r, 3)})`) };
}

/* ================================================================
 * 箱线图
 * ================================================================ */
export function opBox(df, cfg = {}) {
  const col = cfg.col || df.columns.find((c) => df.dtypes[c] === 'number');
  const unit = unitOf(df, col);
  const labelCol = pickLabelCol(df);
  const S = new Script(df, 'plot.box');
  S.code(CODE.box({ col }));

  const values = df.col(col);
  const ns = values.filter((v) => typeof v === 'number' && Number.isFinite(v));
  const b = boxStats(values);
  const dom = domain(ns);
  const outliers = values.map((v, i) => ({ v, i })).filter((o) => typeof o.v === 'number' && (o.v < b.loF || o.v > b.hiF));

  const boxData = (extra = {}) => ({
    kind: 'chart', type: 'box', col, unit, dom, labelCol,
    q1: b.q1, q2: b.q2, q3: b.q3, loF: b.loF, hiF: b.hiF, wLo: b.wLo, wHi: b.wHi,
    rug: ns,
    outliers: outliers.map((o) => ({ ...o, name: labelOf(df, labelCol, o.i) })),
    ...extra,
  });

  F(S, {
    p: ph('①', '五数概括', 'Five-number summary'),
    t: L(`${col}：min / Q1 / 中位数 / Q3 / max`, `${col}: min / Q1 / median / Q3 / max`),
    n: L(`箱线图把一列数字压缩成五个关键位置。先排序，然后取第 25%、50%、75% 三个分位点：Q1 = ${fmt(b.q1)}，中位数 = ${fmt(b.q2)}，Q3 = ${fmt(b.q3)}${unit}。`,
      `A box plot compresses a column into five key positions. Sort first, then read the 25th, 50th and 75th percentiles: Q1 = ${fmt(b.q1)}, median = ${fmt(b.q2)}, Q3 = ${fmt(b.q3)}${unit}.`),
    d: 3000, c: 0,
    tab: T(df, { rowState: () => 'dim', cellState: (r, i, name) => (name === col ? 'focus' : null) }),
    st: boxData({ step: 'quartiles' }),
    hud: [{ label: 'Q1', value: fmt(b.q1), tone: 'mute' }, { label: 'Q2', value: fmt(b.q2), tone: 'gold' }, { label: 'Q3', value: fmt(b.q3), tone: 'mute' }],
  });

  F(S, {
    p: ph('②', '箱体与须', 'Box and whiskers'),
    t: L(`IQR = ${fmt(b.iqr)} · 须的范围 [${fmt(b.wLo)}, ${fmt(b.wHi)}]`, `IQR = ${fmt(b.iqr)} · whiskers [${fmt(b.wLo)}, ${fmt(b.wHi)}]`),
    n: L(`中间那个盒子从 Q1 延伸到 Q3，它的高度就是 IQR = ${fmt(b.iqr)}${unit}，包含了中间 50% 的数据。盒子越矮，说明数据越集中。须则延伸到「仍然正常」的最远点：下须 ${fmt(b.wLo)}，上须 ${fmt(b.wHi)}。`,
      `The box runs from Q1 to Q3; its height is the IQR, ${fmt(b.iqr)}${unit}, covering the middle 50% of the data. A shorter box means tighter data. The whiskers reach the furthest still-normal points: ${fmt(b.wLo)} below, ${fmt(b.wHi)} above.`),
    d: 3000, c: 0,
    tab: T(df, { rowState: () => 'dim', cellState: (r, i, name) => (name === col ? 'focus' : null) }),
    st: boxData({ step: 'box' }),
    hud: [{ label: 'IQR', value: fmt(b.iqr), tone: 'cyan' }, { label: 'wLo', value: fmt(b.wLo), tone: 'mute' }, { label: 'wHi', value: fmt(b.wHi), tone: 'mute' }],
  });

  F(S, {
    p: ph('③', '离群点', 'Outliers'),
    t: L(`自动识别出 ${outliers.length} 个离群点`, `${outliers.length} outliers detected automatically`),
    n: L(`界限规则：超出 [Q1 − 1.5×IQR, Q3 + 1.5×IQR] = [${fmt(b.loF)}, ${fmt(b.hiF)}] 的值被判为离群点，画成独立的圆点。${outliers.length ? `这里有 ${outliers.length} 个：${outliers.map((o) => `${labelOf(df, labelCol, o.i)} 的 ${fmt(o.v)}`).join('、')}。` : '本例中没有离群点。'}这正是箱线图最实用的地方 —— 它用一条规则替你把异常值标了出来，无需人眼扫描。`,
      `The rule: anything outside [Q1 − 1.5×IQR, Q3 + 1.5×IQR] = [${fmt(b.loF)}, ${fmt(b.hiF)}] counts as an outlier and is drawn as a separate dot.${outliers.length ? ` Here there are ${outliers.length}: ${outliers.map((o) => `${labelOf(df, labelCol, o.i)} at ${fmt(o.v)}`).join(', ')}.` : ' None in this case.'} This is what makes box plots so practical — one rule flags the anomalies for you.`),
    d: 3400, tone: outliers.length ? 'warn' : 'ok', c: 0,
    tab: T(df, { rowState: (r, i) => (outliers.some((o) => o.i === i) ? 'danger' : 'dim'), cellState: (r, i, name) => (name === col && outliers.some((o) => o.i === i) ? 'champ-max' : null) }),
    st: boxData({ step: 'outliers' }),
    hud: [{ label: 'outliers', value: String(outliers.length), tone: 'danger' },
      { label: 'loF', value: fmt(b.loF), tone: 'cyan' }, { label: 'hiF', value: fmt(b.hiF), tone: 'rose' }],
  });

  F(S, {
    p: ph('④', '结果', 'Result'),
    t: outliers.length ? L('清洗前先知道要删谁', 'Know what to drop before dropping') : L(`${col} 分布干净`, `${col} is clean`),
    n: outliers.length
      ? L(`箱线图已经替我们锁定了 ${outliers.length} 个待处理的值。可以直接 drop，也可以用 clip 压回边界 —— 这就是「可视化驱动清洗」：先看图，再动手。${hintZh}`,
        `The box plot has already pinned down ${outliers.length} values to deal with. Drop them, or clip them back to the boundary — this is visualisation-driven cleaning: look first, then act. ${hintEn}`)
      : L(`没有任何值越界，这一列的分布是健康的。${hintZh}`, `Nothing is out of range; this column's distribution is healthy. ${hintEn}`),
    d: 2800, tone: 'ok', c: 0, final: true,
    tab: T(df, { rowState: (r, i) => (outliers.some((o) => o.i === i) ? 'focus' : 'dim'), cellState: (r, i, name) => (name === col ? (outliers.some((o) => o.i === i) ? 'champ-max' : 'seen') : null) }),
    st: boxData({ step: 'outliers', done: true }),
    hud: [{ label: 'outliers', value: String(outliers.length), tone: outliers.length ? 'danger' : 'ok' },
      { label: 'Q1–Q3', value: `${fmt(b.q1)} ~ ${fmt(b.q3)}`, tone: 'cyan' }],
  });

  return { frames: S.frames, result: df, summary: L(`${col} 箱线图（${outliers.length} 个离群点）`, `Box plot of ${col} (${outliers.length} outliers)`) };
}

/* ================================================================
 * 相关热力图
 * ================================================================ */
export function opHeatmap(df) {
  const cols = df.columns.filter((c) => df.dtypes[c] === 'number');
  if (cols.length < 2) throw new Error('heatmap needs at least two numeric columns');
  const S = new Script(df, 'heatmap');
  S.code(CODE.corr());
  F(S, {
    p: ph('①', '一张图看完所有关系', 'All relationships in one image'),
    t: L(`${cols.length} × ${cols.length} 的相关矩阵`, `A ${cols.length} × ${cols.length} correlation matrix`),
    n: L('把相关系数矩阵画成热力图，就能一眼扫完所有变量两两之间的关系。深色格子是强相关，浅色格子是弱相关 —— 这比读一张全是数字的表快得多。',
      'Drawing the correlation matrix as a heatmap lets you scan every pairwise relationship at a glance. Dark cells are strong, pale cells weak — far faster than reading a table of numbers.'),
    d: 2800, c: 0,
    tab: T(df, { cellState: (r, i, name) => (cols.includes(name) ? 'focus' : 'dim') }),
    st: { kind: 'chart', type: 'heatmap', col: cols[0] },
  });
  F(S, {
    p: ph('②', '结果', 'Result'),
    t: L('对角线恒为 1，矩阵对称', 'Diagonal is 1, matrix is symmetric'),
    n: L('因为 i 与 j 的相关等于 j 与 i 的相关，矩阵沿对角线对称，所以只看上三角就够了。注意深色 ≠ 因果：它只说明两个变量一起变化。',
      'Since correlating i with j equals correlating j with i, the matrix is symmetric and only the upper triangle matters. And dark ≠ causal: it only means the two move together.'),
    d: 2800, tone: 'ok', c: 0, final: true,
    tab: T(df.corr(), { cellState: (r, i, name) => (i > 0 ? 'best' : null) }),
    st: { kind: 'chart', type: 'heatmap', col: cols[0] },
    hud: [{ label: L('矩阵', 'matrix'), value: `${cols.length} × ${cols.length}`, tone: 'ok' }],
  });
  return { frames: S.frames, result: df, summary: L(`${cols.length} 个数值列的相关热力图`, `Correlation heatmap of ${cols.length} columns`) };
}
