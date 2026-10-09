/* ------------------------------------------------------------------
 * ui/charts.js — 多图表引擎
 *  ----------------------------------------------------------------
 *  14 种图表类型，全部手写 SVG。渲染采用「元素池」策略：
 *  同一类型下按序号复用已有节点，只更新几何属性，于是 CSS 过渡
 *  会把变化补间成动画 —— 这样图表就能随着分析动画实时演变。
 * ------------------------------------------------------------------ */

import { el, clear, fmt, clamp, quantile, median, mean, std } from '../core/utils.js';
import { pick, getLang, t } from '../i18n/index.js';
import {
  nums, boxStats, kde, ecdf, qqData, corrMatrix, pearson, groupBy,
} from '../core/stats.js';

const NS = 'http://www.w3.org/2000/svg';
export function svg(tag, attrs = {}, kids = []) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    n.setAttribute(k, v);
  }
  for (const c of [].concat(kids)) if (c) n.appendChild(c);
  return n;
}
const txt = (x, y, s, cls = 'axis-text', extra = {}) => {
  const n = svg('text', { x, y, class: cls, ...extra });
  n.textContent = s;
  return n;
};

/* 调色板：从 CSS 令牌读取，主题切换后自动跟随 */
function palette() {
  const cs = getComputedStyle(document.documentElement);
  const g = (n) => cs.getPropertyValue(n).trim();
  return {
    // 颜色统一挂在 color 下，供 P.color.xxx 访问
    color: {
      accent: g('--accent'), accent2: g('--accent-2'), ok: g('--ok'),
      warn: g('--warn'), max: g('--max'), min: g('--min'),
    },
    txt: g('--txt-1'), txt3: g('--txt-3'), line: g('--line-3'), grid: g('--grid'),
    panel: g('--panel-2'), bg: g('--bg-1'),
  };
}
const CAT = ['--accent', '--min', '--warn', '--max', '--ok', '--accent-2'];

/* ------------------------------ 元素池 ------------------------------ */
class Pool {
  constructor(parent, tag, cls, attrs = {}) {
    this.parent = parent; this.tag = tag; this.cls = cls; this.attrs = attrs; this.items = [];
  }
  take(i) {
    while (this.items.length <= i) {
      const n = svg(this.tag, { class: this.cls, ...this.attrs });
      this.parent.appendChild(n);
      this.items.push(n);
    }
    return this.items[i];
  }
  trim(n) { while (this.items.length > n) this.items.pop().remove(); }
  clear() { this.items.forEach((n) => n.remove()); this.items = []; }
}

/* ------------------------------ 尺寸 ------------------------------ */
const PAD = { l: 46, r: 18, t: 22, b: 34 };

function frame(host) {
  let root = host.querySelector(':scope > .chart-svg');
  if (!root) {
    root = el('div', { class: 'chart-svg', style: { position: 'absolute', inset: '0' } });
    host.appendChild(root);
  }
  const w = Math.max(220, host.clientWidth || 520);
  const h = Math.max(150, host.clientHeight || 260);
  return { root, w, h };
}

function ensureSvg(root, w, h) {
  let s = root.querySelector('svg');
  if (!s) {
    s = svg('svg', { viewBox: `0 0 ${w} ${h}`, width: w, height: h });
    root.appendChild(s);
  }
  s.setAttribute('viewBox', `0 0 ${w} ${h}`);
  s.setAttribute('width', w);
  s.setAttribute('height', h);
  let g = s.querySelector('g.g-root');
  if (!g) { g = svg('g', { class: 'g-root' }); s.appendChild(g); }
  return { s, g };
}

function axisLayer(g, w, h, xTitle, yTitle, P = palette()) {
  let a = g.querySelector('g.axes');
  if (!a) { a = svg('g', { class: 'axes' }); g.appendChild(a); }
  clear(a);
  a.appendChild(svg('line', { x1: PAD.l, y1: h - PAD.b, x2: w - PAD.r, y2: h - PAD.b, class: 'axis-line' }));
  a.appendChild(svg('line', { x1: PAD.l, y1: PAD.t, x2: PAD.l, y2: h - PAD.b, class: 'axis-line' }));
  if (xTitle) a.appendChild(txt(w - PAD.r, h - PAD.b + 22, xTitle, 'axis-title', { 'text-anchor': 'end' }));
  if (yTitle) a.appendChild(txt(PAD.l - 8, PAD.t - 8, yTitle, 'axis-title', { 'text-anchor': 'end' }));
  return a;
}

/** 在绘图区内画水平网格 + 数值刻度 */
function yGrid(a, w, h, lo, hi, n = 4, fmtFn = (v) => fmt(v)) {
  const plotH = h - PAD.t - PAD.b;
  for (let i = 0; i <= n; i++) {
    const v = lo + (hi - lo) * i / n;
    const y = PAD.t + plotH * (1 - i / n);
    a.appendChild(svg('line', { x1: PAD.l, y1: y, x2: w - PAD.r, y2: y, class: 'grid-line' }));
    a.appendChild(txt(PAD.l - 6, y + 3, fmtFn(v), 'axis-text', { 'text-anchor': 'end' }));
  }
}

function emptyState(root, msg) {
  root.innerHTML = '';
  root.appendChild(el('div', { class: 'empty-stage' }, [
    el('div', { class: 't' }, [msg || t('stage.noData')]),
    el('div', { class: 'h' }, [t('stage.noDataHint')]),
  ]));
}

/** 通用「整齐刻度」 */
function niceTicks(lo, hi, n = 5) {
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) return [lo, hi];
  const raw = (hi - lo) / n;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || 10 * mag;
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-6; v += step) out.push(Math.round(v / step) * step);
  return out.length >= 2 ? out : [lo, hi];
}

function extent(v, pad = 0.06) {
  const a = nums(v);
  if (!a.length) return [0, 1];
  let lo = Math.min(...a), hi = Math.max(...a);
  if (lo === hi) { lo -= 1; hi += 1; }
  const d = (hi - lo) * pad;
  return [lo - d, hi + d];
}

/* ==================================================================
 * 图表类型定义
 *  每个 chart 有：label（双语）、needs（需要哪些列）、draw(host, df, cfg)
 * ================================================================== */
export const CHART_TYPES = [
  { id: 'hist', needs: ['num'], draw: drawHist },
  { id: 'box', needs: ['num'], draw: drawBox },
  { id: 'violin', needs: ['num'], draw: drawViolin },
  { id: 'strip', needs: ['num'], draw: drawStrip },
  { id: 'density', needs: ['num'], draw: drawDensity },
  { id: 'ecdf', needs: ['num'], draw: drawEcdf },
  { id: 'qq', needs: ['num'], draw: drawQQ },
  { id: 'line', needs: ['num', 'any'], draw: drawLine },
  { id: 'area', needs: ['num', 'any'], draw: drawArea },
  { id: 'scatter', needs: ['num2'], draw: drawScatter },
  { id: 'bar', needs: ['any'], draw: drawBar },
  { id: 'groupedBar', needs: ['any2'], draw: drawGroupedBar },
  { id: 'pie', needs: ['any'], draw: drawPie },
  { id: 'heatmap', needs: ['num'], draw: drawHeatmap },
];

export const CHART_BY_ID = Object.fromEntries(CHART_TYPES.map((c) => [c.id, c]));

/* ------------------------------ 直方图 ------------------------------ */
function drawHist(host, df, cfg) {
  const { root, w, h } = frame(host);
  const v = nums(df.col(cfg.x));
  if (!v.length) return emptyState(root, `${cfg.x} — ${t('common.noNumeric')}`);
  const P = palette();
  const { s, g } = ensureSvg(root, w, h);
  const bins = cfg.bins || Math.max(6, Math.min(18, Math.ceil(Math.log2(v.length) + 1)));
  const lo = Math.min(...v), hi = Math.max(...v);
  const width = (hi - lo) / bins || 1;
  const counts = new Array(bins).fill(0);
  v.forEach((x) => { let i = Math.floor((x - lo) / width); if (i >= bins) i = bins - 1; if (i < 0) i = 0; counts[i]++; });
  const maxC = Math.max(...counts, 1);
  const a = axisLayer(g, w, h, cfg.x, t('common.count'), P);
  yGrid(a, w, h, 0, maxC, 4, (x) => String(Math.round(x)));
  const plotH = h - PAD.t - PAD.b, plotW = w - PAD.l - PAD.r;
  const bw = plotW / bins;
  const baseY = h - PAD.b;
  const pool = g._barPool || (g._barPool = new Pool(g, 'rect', 'bar-rect', { rx: 3 }));
  counts.forEach((c, i) => {
    const x = PAD.l + i * bw + bw * 0.1;
    const r = pool.take(i);
    const bh = plotH * (c / maxC);
    r.setAttribute('x', x);
    r.setAttribute('y', baseY - plotH);
    r.setAttribute('width', Math.max(1, bw * 0.8));
    r.setAttribute('height', plotH);
    r.setAttribute('fill', c === maxC ? P.color.warn : P.color.accent);
    r.setAttribute('opacity', c === 0 ? 0.18 : 0.82);
    r.style.transformOrigin = `${x + bw * 0.4}px ${baseY}px`;
    r.style.transform = `scaleY(${Math.max(0.001, bh / plotH)})`;
    r.style.transition = 'transform .5s cubic-bezier(.16,1,.3,1), fill .35s, opacity .35s';
  });
  pool.trim(counts.length);
  // 轴标签
  let lab = g.querySelector('g.xlab');
  if (!lab) { lab = svg('g', { class: 'xlab' }); g.appendChild(lab); }
  clear(lab);
  const step = Math.ceil(bins / 9);
  for (let i = 0; i < bins; i += step) {
    lab.appendChild(txt(PAD.l + i * bw + bw / 2, baseY + 14, fmt(lo + i * width, 1), 'axis-text', { 'text-anchor': 'middle' }));
  }
  g._barPool = pool;
  markNote(host, [
    ['bins', String(bins)], ['n', String(v.length)],
    ['x̄', fmt(mean(v))], ['σ', fmt(std(v, 1))],
  ]);
}

/* ------------------------------ 箱线图 ------------------------------ */
function drawBox(host, df, cfg) {
  const { root, w, h } = frame(host);
  const v = df.col(cfg.x);
  const b = boxStats(v);
  if (!b) return emptyState(root, `${cfg.x} — ${t('common.noNumeric')}`);
  const P = palette();
  const { s, g } = ensureSvg(root, w, h);
  const lo = Math.min(b.min, b.loF), hi = Math.max(b.max, b.hiF);
  const Y = (x) => PAD.t + (1 - (x - lo) / ((hi - lo) || 1)) * (h - PAD.t - PAD.b);
  const a = axisLayer(g, w, h, '', cfg.x, P);
  for (const tv of niceTicks(lo, hi, 6)) {
    a.appendChild(svg('line', { x1: PAD.l, y1: Y(tv), x2: w - PAD.r, y2: Y(tv), class: 'grid-line' }));
    a.appendChild(txt(PAD.l - 6, Y(tv) + 3, fmt(tv), 'axis-text', { 'text-anchor': 'end' }));
  }
  const groups = cfg.group ? groupBy(df, cfg.group) : null;
  const keys = groups ? [...groups.keys()] : ['—'];
  const plotW = w - PAD.l - PAD.r;
  const slot = plotW / Math.max(1, keys.length);
  const bw = Math.min(76, slot * 0.5);
  g._boxNodes = g._boxNodes || [];
  g._boxNodes.forEach((n) => n.remove());
  g._boxNodes = [];
  keys.forEach((k, ki) => {
    const rows = groups ? groups.get(k) : df._rows.map((_, i) => i);
    const vals = rows.map((i) => df._rows[i].cells[df.columns.indexOf(cfg.x)]);
    const bs = boxStats(vals);
    if (!bs) return;
    const cx = PAD.l + slot * (ki + 0.5);
    const color = P.color[CAT[ki % CAT.length]] || P.color.accent;
    const parts = [];
    parts.push(svg('line', { x1: cx, y1: Y(bs.q3), x2: cx, y2: Y(bs.wLo), stroke: color, 'stroke-width': 1.4, opacity: 0.5, 'stroke-dasharray': '3 3' }));
    parts.push(svg('line', { x1: cx, y1: Y(bs.q1), x2: cx, y2: Y(bs.wHi), stroke: color, 'stroke-width': 1.4, opacity: 0.5, 'stroke-dasharray': '3 3' }));
    parts.push(svg('line', { x1: cx - bw / 2, y1: Y(bs.wLo), x2: cx + bw / 2, y2: Y(bs.wLo), stroke: color, 'stroke-width': 2 }));
    parts.push(svg('line', { x1: cx - bw / 2, y1: Y(bs.wHi), x2: cx + bw / 2, y2: Y(bs.wHi), stroke: color, 'stroke-width': 2 }));
    parts.push(svg('rect', {
      x: cx - bw / 2, y: Y(bs.q3), width: bw, height: Math.max(2, Y(bs.q1) - Y(bs.q3)),
      rx: 3, fill: color, 'fill-opacity': 0.16, stroke: color, 'stroke-width': 1.3,
      style: 'transition: all .5s cubic-bezier(.16,1,.3,1)',
    }));
    parts.push(svg('line', { x1: cx - bw / 2, y1: Y(bs.q2), x2: cx + bw / 2, y2: Y(bs.q2), stroke: P.color.warn, 'stroke-width': 2.4 }));
    bs.outliers.forEach((o) => parts.push(svg('circle', { cx: cx + (Math.random() - 0.5) * bw * 0.5, cy: Y(o), r: 3.4, fill: P.color.max, opacity: 0.9 })));
    if (keys.length > 1) parts.push(txt(cx, h - PAD.b + 14, String(k).slice(0, 8), 'axis-text', { 'text-anchor': 'middle' }));
    parts.push(txt(cx - bw / 2 - 5, Y(bs.q3) - 3, `Q3 ${fmt(bs.q3)}`, 'axis-text', { 'text-anchor': 'end' }));
    parts.push(txt(cx - bw / 2 - 5, Y(bs.q2) + 3, `M ${fmt(bs.q2)}`, 'axis-text', { 'text-anchor': 'end', style: `fill:${P.color.warn}` }));
    parts.push(txt(cx - bw / 2 - 5, Y(bs.q1) + 10, `Q1 ${fmt(bs.q1)}`, 'axis-text', { 'text-anchor': 'end' }));
    parts.forEach((n) => { g.appendChild(n); g._boxNodes.push(n); });
  });
  markNote(host, [
    ['Q1', fmt(b.q1)], ['median', fmt(b.q2)], ['Q3', fmt(b.q3)],
    ['IQR', fmt(b.iqr)], ['outliers', String(b.outliers.length)],
  ]);
}

/* ------------------------------ 小提琴图 ------------------------------ */
function drawViolin(host, df, cfg) {
  const { root, w, h } = frame(host);
  const v = nums(df.col(cfg.x));
  if (v.length < 3) return emptyState(root, `${cfg.x} — ${t('common.noNumeric')}`);
  const P = palette();
  const { s, g } = ensureSvg(root, w, h);
  const groups = cfg.group ? groupBy(df, cfg.group) : null;
  const keys = groups ? [...groups.keys()] : ['—'];
  const lo = Math.min(...v), hi = Math.max(...v);
  const Y = (x) => PAD.t + (1 - (x - lo) / ((hi - lo) || 1)) * (h - PAD.t - PAD.b);
  const a = axisLayer(g, w, h, '', cfg.x, P);
  for (const tv of niceTicks(lo, hi, 6)) {
    a.appendChild(svg('line', { x1: PAD.l, y1: Y(tv), x2: w - PAD.r, y2: Y(tv), class: 'grid-line' }));
    a.appendChild(txt(PAD.l - 6, Y(tv) + 3, fmt(tv), 'axis-text', { 'text-anchor': 'end' }));
  }
  g._boxNodes = g._boxNodes || [];
  g._boxNodes.forEach((n) => n.remove());
  g._boxNodes = [];
  const plotW = w - PAD.l - PAD.r;
  const slot = plotW / Math.max(1, keys.length);
  const half = Math.min(52, slot * 0.34);
  keys.forEach((k, ki) => {
    const rows = groups ? groups.get(k) : df._rows.map((_, i) => i);
    const vals = nums(rows.map((i) => df._rows[i].cells[df.columns.indexOf(cfg.x)]));
    if (vals.length < 3) return;
    const kd = kde(vals, 48);
    const cx = PAD.l + slot * (ki + 0.5);
    const color = P.color[CAT[ki % CAT.length]] || P.color.accent;
    const maxY = Math.max(...kd.ys) || 1;
    const right = kd.xs.map((x, i) => `${cx + (kd.ys[i] / maxY) * half},${Y(x)}`);
    const left = kd.xs.slice().reverse().map((x, i) => `${cx - (kd.ys[kd.xs.length - 1 - i] / maxY) * half},${Y(x)}`);
    const d = `M${right.join(' L')} L${left.join(' L')} Z`;
    const parts = [];
    parts.push(svg('path', { d, fill: color, 'fill-opacity': 0.18, stroke: color, 'stroke-width': 1.3, style: 'transition: all .5s cubic-bezier(.16,1,.3,1)' }));
    const bs = boxStats(vals);
    parts.push(svg('line', { x1: cx - half * 0.22, y1: Y(bs.q1), x2: cx + half * 0.22, y2: Y(bs.q1), stroke: color, 'stroke-width': 1.6 }));
    parts.push(svg('line', { x1: cx - half * 0.22, y1: Y(bs.q3), x2: cx + half * 0.22, y2: Y(bs.q3), stroke: color, 'stroke-width': 1.6 }));
    parts.push(svg('line', { x1: cx, y1: Y(bs.q1), x2: cx, y2: Y(bs.q3), stroke: color, 'stroke-width': 1.6 }));
    parts.push(svg('circle', { cx, cy: Y(bs.q2), r: 3.2, fill: P.color.warn }));
    if (keys.length > 1) parts.push(txt(cx, h - PAD.b + 14, String(k).slice(0, 8), 'axis-text', { 'text-anchor': 'middle' }));
    parts.forEach((n) => { g.appendChild(n); g._boxNodes.push(n); });
  });
  markNote(host, [['kernel', 'gaussian'], ['bandwidth', 'Silverman'], ['n', String(v.length)]]);
}

/* ------------------------------ 点阵图 ------------------------------ */
function drawStrip(host, df, cfg) {
  const { root, w, h } = frame(host);
  const col = cfg.x, ci = df.columns.indexOf(col);
  const v = df.col(col);
  if (!nums(v).length) return emptyState(root, `${col} — ${t('common.noNumeric')}`);
  const P = palette();
  const { s, g } = ensureSvg(root, w, h);
  const groups = cfg.group ? groupBy(df, cfg.group) : null;
  const keys = groups ? [...groups.keys()] : ['—'];
  const [lo, hi] = extent(v, 0.05);
  const X = (x) => PAD.l + ((x - lo) / (hi - lo)) * (w - PAD.l - PAD.r);
  const a = axisLayer(g, w, h, col, cfg.group || '', P);
  for (const tv of niceTicks(lo, hi, 6)) {
    a.appendChild(svg('line', { x1: X(tv), y1: PAD.t, x2: X(tv), y2: h - PAD.b, class: 'grid-line' }));
    a.appendChild(txt(X(tv), h - PAD.b + 14, fmt(tv), 'axis-text', { 'text-anchor': 'middle' }));
  }
  const rowsH = h - PAD.t - PAD.b;
  const rowH = rowsH / Math.max(1, keys.length);
  g._boxNodes = g._boxNodes || [];
  g._boxNodes.forEach((n) => n.remove());
  g._boxNodes = [];
  keys.forEach((k, ki) => {
    const rows = groups ? groups.get(k) : df._rows.map((_, i) => i);
    const cy = PAD.t + rowH * (ki + 0.5);
    const color = P.color[CAT[ki % CAT.length]] || P.color.accent;
    if (keys.length > 1) {
      const lab = txt(PAD.l - 6, cy + 3, String(k).slice(0, 9), 'axis-text', { 'text-anchor': 'end' });
      g.appendChild(lab); g._boxNodes.push(lab);
      g.appendChild(svg('line', { x1: PAD.l, y1: cy + rowH / 2 - 2, x2: w - PAD.r, y2: cy + rowH / 2 - 2, class: 'grid-line' }));
    }
    // 蜂群式抖动：同一 x 上多个点上下错开
    const buckets = new Map();
    rows.forEach((i) => {
      const val = df._rows[i].cells[ci];
      if (typeof val !== 'number' || !Number.isFinite(val)) return;
      const key = Math.round(X(val) / 5);
      buckets.set(key, (buckets.get(key) || 0) + 1);
      const n = buckets.get(key);
      const dir = n % 2 ? 1 : -1;
      const off = Math.ceil(n / 2) * 5.5 * dir;
      const cyy = clamp(cy + off, PAD.t + 4, h - PAD.b - 4);
      const c = svg('circle', {
        cx: X(val), cy: cyy, r: 3.4, fill: color, 'fill-opacity': 0.62,
        stroke: color, 'stroke-width': 0.9, style: 'transition: all .45s cubic-bezier(.16,1,.3,1)',
      }, [svg('title', {}, [])]);
      c.querySelector('title').textContent = fmt(val);
      g.appendChild(c); g._boxNodes.push(c);
    });
  });
  markNote(host, [['n', String(nums(v).length)], ['groups', String(keys.length)], ['jitter', 'swarm']]);
}

/* ------------------------------ 密度曲线 ------------------------------ */
function drawDensity(host, df, cfg) {
  const { root, w, h } = frame(host);
  const v = nums(df.col(cfg.x));
  if (v.length < 3) return emptyState(root, `${cfg.x} — ${t('common.noNumeric')}`);
  const P = palette();
  const { s, g } = ensureSvg(root, w, h);
  const groups = cfg.group ? groupBy(df, cfg.group) : null;
  const keys = groups ? [...groups.keys()] : ['—'];
  const all = keys.map((k) => (groups ? nums(groups.get(k).map((i) => df._rows[i].cells[df.columns.indexOf(cfg.x)])) : v));
  const kds = all.map((a) => kde(a, 64));
  const maxY = Math.max(...kds.flatMap((kd) => kd.ys), 1e-9);
  const lo = Math.min(...kds.map((kd) => kd.lo)), hi = Math.max(...kds.map((kd) => kd.hi));
  const X = (x) => PAD.l + ((x - lo) / ((hi - lo) || 1)) * (w - PAD.l - PAD.r);
  const Y = (y) => h - PAD.b - (y / maxY) * (h - PAD.t - PAD.b);
  const a = axisLayer(g, w, h, cfg.x, 'density', P);
  for (let i = 0; i <= 4; i++) {
    const y = PAD.t + (h - PAD.t - PAD.b) * (1 - i / 4);
    a.appendChild(svg('line', { x1: PAD.l, y1: y, x2: w - PAD.r, y2: y, class: 'grid-line' }));
    a.appendChild(txt(PAD.l - 6, y + 3, fmt(maxY * i / 4, 3), 'axis-text', { 'text-anchor': 'end' }));
  }
  for (const tv of niceTicks(lo, hi, 6)) a.appendChild(txt(X(tv), h - PAD.b + 14, fmt(tv), 'axis-text', { 'text-anchor': 'middle' }));
  g._boxNodes = g._boxNodes || [];
  g._boxNodes.forEach((n) => n.remove());
  g._boxNodes = [];
  kds.forEach((kd, ki) => {
    const color = P.color[CAT[ki % CAT.length]] || P.color.accent;
    const d = kd.xs.map((x, i) => `${i ? 'L' : 'M'}${X(x).toFixed(1)},${Y(kd.ys[i]).toFixed(1)}`).join(' ');
    const area = `${d} L${X(kd.xs[kd.xs.length - 1])},${h - PAD.b} L${X(kd.xs[0])},${h - PAD.b} Z`;
    const p1 = svg('path', { d: area, fill: color, 'fill-opacity': 0.12, stroke: 'none' });
    const p2 = svg('path', { d, fill: 'none', stroke: color, 'stroke-width': 2, 'stroke-linejoin': 'round' });
    g.appendChild(p1); g.appendChild(p2);
    g._boxNodes.push(p1, p2);
    if (keys.length > 1) {
      const lab = txt(X(kd.xs[Math.floor(kd.xs.length / 2)]), Y(Math.max(...kd.ys)) - 5, String(k), 'axis-text', { 'text-anchor': 'middle', style: `fill:${color}` });
      g.appendChild(lab); g._boxNodes.push(lab);
    }
  });
  markNote(host, [['bandwidth', fmt(kds[0].bw, 3)], ['groups', String(keys.length)], ['n', String(v.length)]]);
}

/* ------------------------------ 累积分布 ------------------------------ */
function drawEcdf(host, df, cfg) {
  const { root, w, h } = frame(host);
  const v = nums(df.col(cfg.x));
  if (v.length < 2) return emptyState(root, `${cfg.x} — ${t('common.noNumeric')}`);
  const P = palette();
  const { s, g } = ensureSvg(root, w, h);
  const e = ecdf(v);
  const lo = Math.min(...v), hi = Math.max(...v);
  const X = (x) => PAD.l + ((x - lo) / ((hi - lo) || 1)) * (w - PAD.l - PAD.r);
  const Y = (y) => h - PAD.b - y * (h - PAD.t - PAD.b);
  const a = axisLayer(g, w, h, cfg.x, 'F(x)', P);
  for (let i = 0; i <= 4; i++) {
    const y = PAD.t + (h - PAD.t - PAD.b) * (1 - i / 4);
    a.appendChild(svg('line', { x1: PAD.l, y1: y, x2: w - PAD.r, y2: y, class: 'grid-line' }));
    a.appendChild(txt(PAD.l - 6, y + 3, fmt(i / 4, 2), 'axis-text', { 'text-anchor': 'end' }));
  }
  for (const tv of niceTicks(lo, hi, 6)) a.appendChild(txt(X(tv), h - PAD.b + 14, fmt(tv), 'axis-text', { 'text-anchor': 'middle' }));
  g._boxNodes = g._boxNodes || [];
  g._boxNodes.forEach((n) => n.remove());
  g._boxNodes = [];
  const d = e.map((p, i) => `${i ? 'L' : 'M'}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join(' ');
  const area = `${d} L${X(e[e.length - 1].x)},${h - PAD.b} L${X(e[0].x)},${h - PAD.b} Z`;
  const p1 = svg('path', { d: area, fill: P.color.accent, 'fill-opacity': 0.1 });
  const p2 = svg('path', { d, fill: 'none', stroke: P.color.accent, 'stroke-width': 2 });
  g.appendChild(p1); g.appendChild(p2); g._boxNodes.push(p1, p2);
  // 四分位参考线
  [[0.25, 'Q1'], [0.5, 'Q2'], [0.75, 'Q3']].forEach(([q, name]) => {
    const xq = quantile(v, q);
    const l1 = svg('line', { x1: X(xq), y1: Y(q), x2: X(xq), y2: h - PAD.b, stroke: P.color.warn, 'stroke-width': 1, 'stroke-dasharray': '3 3', opacity: 0.7 });
    const l2 = svg('line', { x1: PAD.l, y1: Y(q), x2: X(xq), y2: Y(q), stroke: P.color.warn, 'stroke-width': 1, 'stroke-dasharray': '3 3', opacity: 0.7 });
    const tx = txt(X(xq) + 3, Y(q) - 4, `${name} ${fmt(xq)}`, 'axis-text', { style: `fill:${P.color.warn}` });
    g.appendChild(l1); g.appendChild(l2); g.appendChild(tx);
    g._boxNodes.push(l1, l2, tx);
  });
  markNote(host, [['n', String(v.length)], ['min', fmt(lo)], ['max', fmt(hi)]]);
}

/* ------------------------------ Q-Q 图 ------------------------------ */
function drawQQ(host, df, cfg) {
  const { root, w, h } = frame(host);
  const v = nums(df.col(cfg.x));
  const q = qqData(v);
  if (q.points.length < 3) return emptyState(root, `${cfg.x} — ${t('common.noNumeric')}`);
  const P = palette();
  const { s, g } = ensureSvg(root, w, h);
  const xs = q.points.map((p) => p.x), ys = q.points.map((p) => p.y);
  const [xlo, xhi] = extent(xs, 0.05);
  const [ylo, yhi] = extent(ys, 0.05);
  const X = (x) => PAD.l + ((x - xlo) / (xhi - xlo)) * (w - PAD.l - PAD.r);
  const Y = (y) => h - PAD.b - ((y - ylo) / (yhi - ylo)) * (h - PAD.t - PAD.b);
  const a = axisLayer(g, w, h, t('chart.qq') + ' · theoretical', cfg.x + ' · sample', P);
  for (let i = 0; i <= 4; i++) {
    const y = PAD.t + (h - PAD.t - PAD.b) * (1 - i / 4);
    a.appendChild(svg('line', { x1: PAD.l, y1: y, x2: w - PAD.r, y2: y, class: 'grid-line' }));
    a.appendChild(txt(PAD.l - 6, y + 3, fmt(ylo + (yhi - ylo) * i / 4), 'axis-text', { 'text-anchor': 'end' }));
  }
  g._boxNodes = g._boxNodes || [];
  g._boxNodes.forEach((n) => n.remove());
  g._boxNodes = [];
  // 参考线 y = x（理论正态）
  const ref = svg('line', {
    x1: X(Math.max(xlo, ylo)), y1: Y(Math.max(xlo, ylo)),
    x2: X(Math.min(xhi, yhi)), y2: Y(Math.min(xhi, yhi)),
    stroke: P.color.warn, 'stroke-width': 1.4, 'stroke-dasharray': '5 4', opacity: 0.8,
  });
  g.appendChild(ref); g._boxNodes.push(ref);
  q.points.forEach((p) => {
    const c = svg('circle', { cx: X(p.x), cy: Y(p.y), r: 3.4, fill: P.color.accent, 'fill-opacity': 0.7 }, [svg('title', {}, [])]);
    c.querySelector('title').textContent = fmt(p.y);
    g.appendChild(c); g._boxNodes.push(c);
  });
  markNote(host, [['n', String(v.length)], ['x̄', fmt(q.mean)], ['σ', fmt(q.std)]]);
}

/* ------------------------------ 折线 / 面积 ------------------------------ */
function lineData(df, cfg) {
  const xi = df.columns.indexOf(cfg.x), yi = df.columns.indexOf(cfg.y);
  const pts = [];
  df._rows.forEach((r, i) => {
    const y = r.cells[yi];
    if (typeof y !== 'number' || !Number.isFinite(y)) return;
    pts.push({ i, label: r.cells[xi] === null ? 'NaN' : String(r.cells[xi]), y });
  });
  return pts;
}

function drawLine(host, df, cfg) { drawLineLike(host, df, cfg, false); }
function drawArea(host, df, cfg) { drawLineLike(host, df, cfg, true); }

function drawLineLike(host, df, cfg, area) {
  const { root, w, h } = frame(host);
  const pts = lineData(df, cfg);
  if (pts.length < 2) return emptyState(root, t('stage.noData'));
  const P = palette();
  const { s, g } = ensureSvg(root, w, h);
  const ys = pts.map((p) => p.y);
  const [lo, hi] = extent(ys, 0.08);
  const X = (k) => PAD.l + (k / (pts.length - 1)) * (w - PAD.l - PAD.r);
  const Y = (y) => h - PAD.b - ((y - lo) / (hi - lo)) * (h - PAD.t - PAD.b);
  const a = axisLayer(g, w, h, cfg.x, cfg.y, P);
  yGrid(a, w, h, lo, hi, 4, (v) => fmt(v, 1));
  g._boxNodes = g._boxNodes || [];
  g._boxNodes.forEach((n) => n.remove());
  g._boxNodes = [];
  const d = pts.map((p, k) => `${k ? 'L' : 'M'}${X(k).toFixed(1)},${Y(p.y).toFixed(1)}`).join(' ');
  if (area) {
    const ar = `${d} L${X(pts.length - 1)},${h - PAD.b} L${X(0)},${h - PAD.b} Z`;
    const arn = svg('path', { d: ar, fill: P.color.accent, 'fill-opacity': 0.14 });
    g.appendChild(arn); g._boxNodes.push(arn);
  }
  const path = svg('path', { d, fill: 'none', stroke: P.color.accent, 'stroke-width': 2.2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' });
  g.appendChild(path); g._boxNodes.push(path);
  const step = Math.max(1, Math.ceil(pts.length / 60));
  pts.forEach((p, k) => {
    if (k % step) return;
    const c = svg('circle', { cx: X(k), cy: Y(p.y), r: 2.6, fill: P.color.accent, 'fill-opacity': 0.8 }, [svg('title', {}, [])]);
    c.querySelector('title').textContent = `${p.label} · ${fmt(p.y)}`;
    g.appendChild(c); g._boxNodes.push(c);
  });
  // x 轴标签
  const lstep = Math.max(1, Math.ceil(pts.length / 8));
  pts.forEach((p, k) => {
    if (k % lstep) return;
    const tx = txt(X(k), h - PAD.b + 14, p.label.slice(0, 7), 'axis-text', { 'text-anchor': 'middle' });
    g.appendChild(tx); g._boxNodes.push(tx);
  });
  markNote(host, [
    ['n', String(pts.length)], ['min', fmt(Math.min(...ys), 1)], ['max', fmt(Math.max(...ys), 1)],
    ['Δ', fmt(Math.max(...ys) - Math.min(...ys), 1)],
  ]);
}

/* ------------------------------ 散点图 ------------------------------ */
function drawScatter(host, df, cfg) {
  const { root, w, h } = frame(host);
  const xi = df.columns.indexOf(cfg.x), yi = df.columns.indexOf(cfg.y);
  if (xi < 0 || yi < 0) return emptyState(root, t('stage.noData'));
  const P = palette();
  const { s, g } = ensureSvg(root, w, h);
  const groups = cfg.group ? groupBy(df, cfg.group) : null;
  const keys = groups ? [...groups.keys()] : ['—'];
  const pts = [];
  df._rows.forEach((r, i) => {
    const a = r.cells[xi], b = r.cells[yi];
    if (typeof a !== 'number' || typeof b !== 'number' || !Number.isFinite(a) || !Number.isFinite(b)) return;
    const gk = groups ? (r.cells[df.columns.indexOf(cfg.group)] === null ? 'NaN' : String(r.cells[df.columns.indexOf(cfg.group)])) : '—';
    pts.push({ i, x: a, y: b, gk });
  });
  if (pts.length < 2) return emptyState(root, t('stage.noData'));
  const [xlo, xhi] = extent(pts.map((p) => p.x), 0.08);
  const [ylo, yhi] = extent(pts.map((p) => p.y), 0.08);
  const X = (x) => PAD.l + ((x - xlo) / (xhi - xlo)) * (w - PAD.l - PAD.r);
  const Y = (y) => h - PAD.b - ((y - ylo) / (yhi - ylo)) * (h - PAD.t - PAD.b);
  const a = axisLayer(g, w, h, cfg.x, cfg.y, P);
  yGrid(a, w, h, ylo, yhi, 4, (v) => fmt(v, 1));
  for (const tv of niceTicks(xlo, xhi, 5)) a.appendChild(txt(X(tv), h - PAD.b + 14, fmt(tv, 1), 'axis-text', { 'text-anchor': 'middle' }));
  g._boxNodes = g._boxNodes || [];
  g._boxNodes.forEach((n) => n.remove());
  g._boxNodes = [];
  const r = pearson(pts.map((p) => p.x), pts.map((p) => p.y));
  keys.forEach((k, ki) => {
    const color = P.color[CAT[ki % CAT.length]] || P.color.accent;
    pts.filter((p) => p.gk === k).forEach((p) => {
      const c = svg('circle', {
        cx: X(p.x), cy: Y(p.y), r: 4.2, fill: color, 'fill-opacity': 0.6,
        stroke: color, 'stroke-width': 1, style: 'transition: all .45s cubic-bezier(.16,1,.3,1)',
      }, [svg('title', {}, [])]);
      c.querySelector('title').textContent = `(${fmt(p.x)}, ${fmt(p.y)})`;
      g.appendChild(c); g._boxNodes.push(c);
    });
  });
  // 回归线
  if (pts.length > 2 && Number.isFinite(r)) {
    const mx = mean(pts.map((p) => p.x)), my = mean(pts.map((p) => p.y));
    const sx = std(pts.map((p) => p.x), 1) || 1, sy = std(pts.map((p) => p.y), 1) || 1;
    const slope = r * sy / sx;
    const f = (x) => my + slope * (x - mx);
    const l = svg('line', {
      x1: X(xlo), y1: Y(f(xlo)), x2: X(xhi), y2: Y(f(xhi)),
      stroke: P.color.warn, 'stroke-width': 1.6, 'stroke-dasharray': '5 4', opacity: 0.85,
    });
    g.appendChild(l); g._boxNodes.push(l);
  }
  if (keys.length > 1) {
    const lg = el('div', { class: 'legend' }, keys.slice(0, 6).map((k, i) => el('div', { class: 'legend-item' }, [
      el('i', { style: { background: `var(${CAT[i % CAT.length]})` } }), String(k),
    ])));
    host.appendChild(lg);
  }
  markNote(host, [['n', String(pts.length)], ['r', fmt(r, 3)], ['r²', fmt(r * r, 3)]]);
}

/* ------------------------------ 柱状图 ------------------------------ */
function drawBar(host, df, cfg) {
  const { root, w, h } = frame(host);
  const ci = df.columns.indexOf(cfg.x);
  if (ci < 0) return emptyState(root, t('stage.noData'));
  const P = palette();
  const { s, g } = ensureSvg(root, w, h);
  const counts = new Map();
  df._rows.forEach((r) => {
    const v = r.cells[ci];
    const k = v === null || v === undefined ? 'NaN' : String(v);
    counts.set(k, (counts.get(k) || 0) + 1);
  });
  const items = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  if (!items.length) return emptyState(root, t('stage.noData'));
  const maxC = Math.max(...items.map((i) => i[1]), 1);
  const a = axisLayer(g, w, h, cfg.x, t('common.count'), P);
  yGrid(a, w, h, 0, maxC, 4, (v) => String(Math.round(v)));
  const plotW = w - PAD.l - PAD.r, plotH = h - PAD.t - PAD.b;
  const iw = plotW / items.length;
  const baseY = h - PAD.b;
  const pool = g._barPool || (g._barPool = new Pool(g, 'rect', 'bar-rect', { rx: 3 }));
  items.forEach((it, i) => {
    const r = pool.take(i);
    const x = PAD.l + i * iw + iw * 0.14;
    const bw = Math.max(1, iw * 0.72);
    const bh = plotH * (it[1] / maxC);
    r.setAttribute('x', x);
    r.setAttribute('y', baseY - plotH);
    r.setAttribute('width', bw);
    r.setAttribute('height', plotH);
    r.setAttribute('fill', it[1] === maxC ? P.color.warn : P.color.accent);
    r.setAttribute('opacity', 0.85);
    r.style.transformOrigin = `${x + bw / 2}px ${baseY}px`;
    r.style.transform = `scaleY(${Math.max(0.001, bh / plotH)})`;
    r.style.transition = 'transform .5s cubic-bezier(.16,1,.3,1), fill .3s';
  });
  pool.trim(items.length);
  let lab = g.querySelector('g.xlab');
  if (!lab) { lab = svg('g', { class: 'xlab' }); g.appendChild(lab); }
  clear(lab);
  const step = Math.max(1, Math.ceil(items.length / 10));
  items.forEach((it, i) => {
    if (i % step) return;
    lab.appendChild(txt(PAD.l + i * iw + iw / 2, baseY + 14, it[0].slice(0, 7), 'axis-text', { 'text-anchor': 'middle' }));
    lab.appendChild(txt(PAD.l + i * iw + iw / 2, baseY - plotH * (it[1] / maxC) - 4, String(it[1]), 'axis-text', { 'text-anchor': 'middle', style: `fill:${P.txt}` }));
  });
  g._barPool = pool;
  markNote(host, [['categories', String(items.length)], ['top', `${items[0][0]} (${items[0][1]})`]]);
}

/* ------------------------------ 分组柱状图 ------------------------------ */
function drawGroupedBar(host, df, cfg) {
  const { root, w, h } = frame(host);
  const xi = df.columns.indexOf(cfg.x), gi = df.columns.indexOf(cfg.group);
  if (xi < 0 || gi < 0) return emptyState(root, t('stage.noData'));
  const P = palette();
  const { s, g } = ensureSvg(root, w, h);
  const cats = new Map(), grps = new Set();
  df._rows.forEach((r) => {
    const c = r.cells[xi] === null ? 'NaN' : String(r.cells[xi]);
    const gk = r.cells[gi] === null ? 'NaN' : String(r.cells[gi]);
    grps.add(gk);
    if (!cats.has(c)) cats.set(c, new Map());
    cats.get(c).set(gk, (cats.get(c).get(gk) || 0) + 1);
  });
  const catList = [...cats.keys()];
  const grpList = [...grps];
  if (!catList.length) return emptyState(root, t('stage.noData'));
  let maxC = 1;
  cats.forEach((m) => m.forEach((v) => { maxC = Math.max(maxC, v); }));
  const a = axisLayer(g, w, h, cfg.x, t('common.count'), P);
  yGrid(a, w, h, 0, maxC, 4, (v) => String(Math.round(v)));
  const plotW = w - PAD.l - PAD.r, plotH = h - PAD.t - PAD.b, baseY = h - PAD.b;
  const iw = plotW / catList.length;
  const bw = Math.max(2, (iw * 0.72) / grpList.length);
  const pool = g._barPool || (g._barPool = new Pool(g, 'rect', 'bar-rect', { rx: 2 }));
  let k = 0;
  catList.forEach((c, i) => {
    grpList.forEach((gk, j) => {
      const v = cats.get(c).get(gk) || 0;
      const r = pool.take(k++);
      const x = PAD.l + i * iw + iw * 0.14 + j * bw;
      const bh = plotH * (v / maxC);
      r.setAttribute('x', x);
      r.setAttribute('y', baseY - plotH);
      r.setAttribute('width', Math.max(1, bw - 1));
      r.setAttribute('height', plotH);
      r.setAttribute('fill', P.color[CAT[j % CAT.length]] || P.color.accent);
      r.setAttribute('opacity', 0.85);
      r.style.transformOrigin = `${x + bw / 2}px ${baseY}px`;
      r.style.transform = `scaleY(${Math.max(0.001, bh / plotH)})`;
      r.style.transition = 'transform .5s cubic-bezier(.16,1,.3,1)';
    });
  });
  pool.trim(k);
  let lab = g.querySelector('g.xlab');
  if (!lab) { lab = svg('g', { class: 'xlab' }); g.appendChild(lab); }
  clear(lab);
  const step = Math.max(1, Math.ceil(catList.length / 9));
  catList.forEach((c, i) => {
    if (i % step) return;
    lab.appendChild(txt(PAD.l + i * iw + iw / 2, baseY + 14, c.slice(0, 7), 'axis-text', { 'text-anchor': 'middle' }));
  });
  g._barPool = pool;
  host.appendChild(el('div', { class: 'legend' }, grpList.slice(0, 6).map((gk, j) => el('div', { class: 'legend-item' }, [
    el('i', { style: { background: `var(${CAT[j % CAT.length]})` } }), gk,
  ]))));
  markNote(host, [['x', cfg.x], ['group', cfg.group], ['categories', String(catList.length)]]);
}

/* ------------------------------ 环形图 ------------------------------ */
function drawPie(host, df, cfg) {
  const { root, w, h } = frame(host);
  const ci = df.columns.indexOf(cfg.x);
  if (ci < 0) return emptyState(root, t('stage.noData'));
  const P = palette();
  const { s, g } = ensureSvg(root, w, h);
  const counts = new Map();
  df._rows.forEach((r) => {
    const v = r.cells[ci];
    const k = v === null || v === undefined ? 'NaN' : String(v);
    counts.set(k, (counts.get(k) || 0) + 1);
  });
  let items = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  if (items.length > 8) {
    const rest = items.slice(7).reduce((a, b) => a + b[1], 0);
    items = items.slice(0, 7).concat([['…', rest]]);
  }
  const total = items.reduce((a, b) => a + b[1], 0);
  if (!total) return emptyState(root, t('stage.noData'));
  g._boxNodes = g._boxNodes || [];
  g._boxNodes.forEach((n) => n.remove());
  g._boxNodes = [];
  const cx = w * 0.36, cy = h / 2 + 4;
  const R = Math.min(w * 0.3, h * 0.4);
  const r0 = R * 0.58;
  let ang = -Math.PI / 2;
  items.forEach((it, i) => {
    const frac = it[1] / total;
    const a0 = ang, a1 = ang + frac * Math.PI * 2;
    ang = a1;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const pt = (a, r) => `${(cx + Math.cos(a) * r).toFixed(1)},${(cy + Math.sin(a) * r).toFixed(1)}`;
    const d = `M${pt(a0, R)} A${R},${R} 0 ${large} 1 ${pt(a1, R)} L${pt(a1, r0)} A${r0},${r0} 0 ${large} 0 ${pt(a0, r0)} Z`;
    const path = svg('path', {
      d, fill: P.color[CAT[i % CAT.length]] || P.color.accent, 'fill-opacity': 0.82,
      stroke: P.bg, 'stroke-width': 1.5, style: 'transition: opacity .3s',
    }, [svg('title', {}, [])]);
    path.querySelector('title').textContent = `${it[0]}: ${it[1]} (${(frac * 100).toFixed(1)}%)`;
    g.appendChild(path); g._boxNodes.push(path);
    const mid = (a0 + a1) / 2;
    if (frac > 0.045) {
      const t1 = txt(cx + Math.cos(mid) * (R + r0) / 2, cy + Math.sin(mid) * (R + r0) / 2 + 3,
        `${(frac * 100).toFixed(0)}%`, 'axis-text', { 'text-anchor': 'middle', style: `fill:#fff;font-weight:700;font-size:10px` });
      g.appendChild(t1); g._boxNodes.push(t1);
    }
  });
  // 中心文字
  const t0 = txt(cx, cy - 2, String(total), 'axis-text', { 'text-anchor': 'middle', style: `fill:${P.txt};font-size:16px;font-weight:700;font-family:var(--mono)` });
  const t1 = txt(cx, cy + 13, cfg.x.slice(0, 10), 'axis-text', { 'text-anchor': 'middle', style: `fill:${P.txt3};font-size:9px` });
  g.appendChild(t0); g.appendChild(t1); g._boxNodes.push(t0, t1);
  host.appendChild(el('div', { class: 'legend', style: { flexDirection: 'column', gap: '4px', position: 'absolute', right: '16px', top: '50%', transform: 'translateY(-50%)' } },
    items.map((it, i) => el('div', { class: 'legend-item' }, [
      el('i', { style: { background: `var(${CAT[i % CAT.length]})` } }),
      `${it[0]}  ${it[1]} (${(it[1] / total * 100).toFixed(1)}%)`,
    ]))));
  markNote(host, [['categories', String(items.length)], ['total', String(total)]]);
}

/* ------------------------------ 相关热力图 ------------------------------ */
function drawHeatmap(host, df, cfg) {
  const { root, w, h } = frame(host);
  const cols = df.columns.filter((c) => df.dtypes[c] === 'number');
  if (cols.length < 2) return emptyState(root, t('stage.noData'));
  const P = palette();
  const { s, g } = ensureSvg(root, w, h);
  const m = corrMatrix(df, cols);
  g._boxNodes = g._boxNodes || [];
  g._boxNodes.forEach((n) => n.remove());
  g._boxNodes = [];
  const n = cols.length;
  const cell = Math.min((w - PAD.l - PAD.r) / n, (h - PAD.t - PAD.b) / n, 56);
  const ox = PAD.l + 8, oy = PAD.t + 6;
  // 用实色 + fill-opacity 表达强度，比 color-mix 更可预测（浅色主题下不会变黑）
  const colorOf = (v) => (Number.isFinite(v) && v < 0 ? P.color.max : P.color.accent);
  const alphaOf = (v) => (Number.isFinite(v) ? 0.06 + 0.74 * Math.min(1, Math.abs(v)) : 0.05);
  cols.forEach((c, i) => {
    const t1 = txt(ox + i * cell + cell / 2, oy - 4, c.slice(0, 6), 'axis-text', { 'text-anchor': 'middle', style: `fill:${P.txt3};font-size:8.5px` });
    const t2 = txt(ox - 5, oy + i * cell + cell / 2 + 3, c.slice(0, 8), 'axis-text', { 'text-anchor': 'end', style: `fill:${P.txt3};font-size:8.5px` });
    g.appendChild(t1); g.appendChild(t2); g._boxNodes.push(t1, t2);
  });
  cols.forEach((_, i) => cols.forEach((__, j) => {
    const v = m[i][j];
    const r = svg('rect', {
      x: ox + j * cell + 1, y: oy + i * cell + 1,
      width: cell - 2, height: cell - 2, rx: 3,
      fill: colorOf(v), style: 'transition: fill .4s',
    }, [svg('title', {}, [])]);
    r.querySelector('title').textContent = `${cols[i]} × ${cols[j]} = ${fmt(v, 3)}`;
    g.appendChild(r); g._boxNodes.push(r);
    const tx = txt(ox + j * cell + cell / 2, oy + i * cell + cell / 2 + 3, fmt(v, 2),
      'axis-text', {
        'text-anchor': 'middle',
        style: `fill:${P.txt};font-size:9px;font-weight:600;opacity:${Number.isFinite(v) ? Math.min(1, 0.45 + Math.abs(v) * 0.75) : 0.4}`,
      });
    g.appendChild(tx); g._boxNodes.push(tx);
  }));
  // 找最强相关（非对角）
  let best = { v: 0 };
  cols.forEach((a, i) => cols.forEach((b, j) => {
    if (i < j && Math.abs(m[i][j]) > Math.abs(best.v)) best = { v: m[i][j], a, b };
  }));
  markNote(host, [
    ['columns', String(n)],
    best.a ? ['strongest', `${best.a} × ${best.b} = ${fmt(best.v, 3)}`] : ['', ''],
  ]);
}

/* ------------------------------ 注释条 ------------------------------ */
function markNote(host, pairs) {
  let note = host.querySelector(':scope > .chart-note');
  if (!note) { note = el('div', { class: 'chart-note' }); host.appendChild(note); }
  clear(note);
  pairs.filter(([k]) => k).forEach(([k, v]) => note.appendChild(el('span', { class: 'pill' }, [`${k} ${v}`])));
}

/** 清理上一次渲染留下的池子（切换类型时调用） */
export function resetChartHost(host) {
  clear(host);
}
