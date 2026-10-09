/* ------------------------------------------------------------------
 * utils.js — 通用工具函数
 * 数字格式化 / 随机数 / 补间 / DOM 辅助
 * ------------------------------------------------------------------ */

/** 判断是否为“缺失值”，语义对齐 pandas 的 NaN / None / NaT */
export function isNA(v) {
  return v === null || v === undefined || v === '' ||
    (typeof v === 'number' && Number.isNaN(v));
}

/** 是否为数值（含可解析的数值字符串） */
export function isNum(v) {
  if (isNA(v)) return false;
  if (typeof v === 'number') return Number.isFinite(v);
  if (typeof v === 'boolean') return false;
  if (typeof v === 'string') return v.trim() !== '' && Number.isFinite(Number(v));
  return false;
}

/** 转为数值 */
export function toNum(v) {
  if (typeof v === 'number') return v;
  return Number(String(v).trim());
}

/** 数值格式化：最多保留 n 位小数，去掉多余的 0 */
export function fmt(v, n = 2) {
  if (isNA(v)) return 'NaN';
  if (typeof v === 'boolean') return v ? 'True' : 'False';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return 'NaN';
    if (Number.isInteger(v)) return String(v);
    const s = v.toFixed(n);
    return s.replace(/0+$/, '').replace(/\.$/, '');
  }
  return String(v);
}

/** 固定位数格式化（表格里对齐用） */
export function fmtFixed(v, n = 2) {
  if (isNA(v)) return 'NaN';
  if (typeof v === 'number' && Number.isFinite(v)) {
    return Number.isInteger(v) ? String(v) : v.toFixed(n);
  }
  return String(v);
}

/** 精简数字：12345 -> 12.3k */
export function fmtCompact(v) {
  if (isNA(v) || typeof v !== 'number') return fmt(v);
  const a = Math.abs(v);
  if (a >= 1e8) return (v / 1e8).toFixed(2) + '亿';
  if (a >= 1e4) return (v / 1e4).toFixed(2) + '万';
  return fmt(v);
}

/** 可复现的伪随机数（mulberry32） */
export function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------ 数学 ------------------------------ */

export const sum = (a) => a.reduce((s, x) => s + x, 0);
export const mean = (a) => (a.length ? sum(a) / a.length : NaN);

export function median(a) {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** 样本标准差，ddof=1，与 pandas .std() 默认一致 */
export function std(a, ddof = 1) {
  const n = a.length;
  if (n <= ddof) return NaN;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (n - ddof));
}

/** pandas 默认的线性插值分位数 */
export function quantile(a, q) {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  if (s.length === 1) return s[0];
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  if (lo === hi) return s[lo];
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

/** 直方图分箱（Freedman–Diaconis 兜底 Sturges） */
export function histogram(values, bins) {
  const vs = values.filter((v) => typeof v === 'number' && Number.isFinite(v));
  if (!vs.length) return { counts: [], edges: [], min: 0, max: 0, width: 1, k: 0 };
  const min = Math.min(...vs), max = Math.max(...vs);
  let k = bins;
  if (!k) {
    const q1 = quantile(vs, 0.25), q3 = quantile(vs, 0.75);
    const iqr = q3 - q1;
    k = iqr > 0 ? Math.ceil((max - min) / (2 * iqr / Math.cbrt(vs.length))) : Math.ceil(Math.log2(vs.length) + 1);
    k = Math.max(5, Math.min(20, k || 8));
  }
  const width = (max - min) / k || 1;
  const edges = Array.from({ length: k + 1 }, (_, i) => min + i * width);
  const counts = new Array(k).fill(0);
  for (const v of vs) {
    let i = Math.floor((v - min) / width);
    if (i >= k) i = k - 1;
    if (i < 0) i = 0;
    counts[i]++;
  }
  return { counts, edges, min, max, width, k };
}

/* ------------------------------ 补间 ------------------------------ */

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;

/** 缓动函数集合 */
export const ease = {
  linear: (t) => t,
  inOut: (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2),
  out: (t) => 1 - (1 - t) ** 3,
  outQuint: (t) => 1 - (1 - t) ** 5,
  inOutQuint: (t) => (t < 0.5 ? 16 * t ** 5 : 1 - (-2 * t + 2) ** 5 / 2),
  back: (t) => { const c = 1.70158; return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2; },
  elastic: (t) => t === 0 || t === 1 ? t : -(2 ** (10 * t - 10)) * Math.sin((t * 10 - 10.75) * (2 * Math.PI / 3)),
};

/* ------------------------------- DOM ------------------------------ */

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'data' && typeof v === 'object') for (const [dk, dv] of Object.entries(v)) node.dataset[dk] = dv;
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of [].concat(children)) {
    if (c === null || c === undefined || c === false) continue;
    node.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
  return node;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

/** 在下一帧执行（等待样式生效后再加类名，触发 transition） */
export function nextFrame(fn) { requestAnimationFrame(() => requestAnimationFrame(fn)); }

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 数字滚动动画 */
export function countUp(node, from, to, dur, format = (v) => fmt(v), onDone) {
  const t0 = performance.now();
  (function tick(now) {
    const t = clamp((now - t0) / dur, 0, 1);
    node.textContent = format(lerp(from, to, ease.outQuint(t)));
    if (t < 1) node._raf = requestAnimationFrame(tick);
    else { node.textContent = format(to); onDone?.(); }
  })(performance.now());
}
