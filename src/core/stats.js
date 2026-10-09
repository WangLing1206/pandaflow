/* ------------------------------------------------------------------
 * stats.js — 供图表使用的统计计算
 *  核密度估计 / 经验分布 / 相关系数 / 分位数 / 离群点检测
 * ------------------------------------------------------------------ */

import { mean, std, quantile, isNA } from './utils.js';

/** 取一列里的有效数值 */
export const nums = (arr) => arr.filter((v) => typeof v === 'number' && Number.isFinite(v));

/** 皮尔逊相关系数 */
export function pearson(a, b) {
  const n = Math.min(a.length, b.length);
  let sa = 0, sb = 0, m = 0;
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(a[i]) || !Number.isFinite(b[i])) continue;
    sa += a[i]; sb += b[i]; m++;
  }
  if (m < 2) return NaN;
  const ma = sa / m, mb = sb / m;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(a[i]) || !Number.isFinite(b[i])) continue;
    const dx = a[i] - ma, dy = b[i] - mb;
    sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
  }
  const d = Math.sqrt(sxx * syy);
  return d === 0 ? NaN : sxy / d;
}

/** 相关系数矩阵 */
export function corrMatrix(df, cols) {
  const data = cols.map((c) => df.col(c).map((v) => (typeof v === 'number' ? v : NaN)));
  return cols.map((_, i) => cols.map((__, j) => (i === j ? 1 : pearson(data[i], data[j]))));
}

/** 协方差矩阵（样本，ddof=1） */
export function covMatrix(df, cols) {
  const data = cols.map((c) => df.col(c).map((v) => (typeof v === 'number' ? v : NaN)));
  return cols.map((_, i) => cols.map((__, j) => {
    const n = data[i].length;
    const pairs = [];
    for (let k = 0; k < n; k++) if (Number.isFinite(data[i][k]) && Number.isFinite(data[j][k])) pairs.push(k);
    if (pairs.length < 2) return NaN;
    const mi = mean(pairs.map((k) => data[i][k]));
    const mj = mean(pairs.map((k) => data[j][k]));
    return pairs.reduce((s, k) => s + (data[i][k] - mi) * (data[j][k] - mj), 0) / (pairs.length - 1);
  }));
}

/** 高斯核密度估计；带宽用 Silverman 规则 */
export function kde(values, steps = 64) {
  const v = nums(values);
  if (v.length < 2) return { xs: [], ys: [], bw: 0 };
  const n = v.length;
  const s = std(v, 1);
  const q1 = quantile(v, 0.25), q3 = quantile(v, 0.75);
  const iqr = q3 - q1;
  let bw = 0.9 * Math.min(s, iqr / 1.34) * Math.pow(n, -0.2);
  if (!Number.isFinite(bw) || bw <= 0) bw = (s || 1) * Math.pow(n, -0.2) || 0.5;
  const lo = Math.min(...v) - 3 * bw;
  const hi = Math.max(...v) + 3 * bw;
  const xs = Array.from({ length: steps }, (_, i) => lo + (hi - lo) * i / (steps - 1));
  const inv = 1 / (n * bw * Math.sqrt(2 * Math.PI));
  const ys = xs.map((x) => inv * v.reduce((acc, vi) => acc + Math.exp(-0.5 * ((x - vi) / bw) ** 2), 0));
  return { xs, ys, bw, lo, hi };
}

/** 经验累积分布 */
export function ecdf(values) {
  const v = nums(values).sort((a, b) => a - b);
  const n = v.length;
  return v.map((x, i) => ({ x, y: (i + 1) / n }));
}

/** 正态分位数（Acklam 有理逼近） */
export function normInv(p) {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02,
    1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
  const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02,
    6.680131188771972e+01, -1.328068155288572e+01];
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00,
    -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
  const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
  const pl = 0.02425;
  let q, r;
  if (p < pl) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - pl) {
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  q = p - 0.5; r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

/** Q-Q 图数据：样本分位数 vs 正态分位数 */
export function qqData(values) {
  const v = nums(values).sort((a, b) => a - b);
  const n = v.length;
  if (n < 3) return { points: [], slope: 1, intercept: 0 };
  const m = mean(v), s = std(v, 1) || 1;
  const points = v.map((x, i) => {
    const p = (i + 0.5) / n;
    return { x: m + s * normInv(p), y: x };
  });
  return { points, slope: s, intercept: m - s * m, mean: m, std: s };
}

/** 五数概括 + IQR 离群点 */
export function boxStats(values) {
  const v = nums(values).sort((a, b) => a - b);
  if (!v.length) return null;
  const q1 = quantile(v, 0.25), q2 = quantile(v, 0.5), q3 = quantile(v, 0.75);
  const iqr = q3 - q1;
  const loF = q1 - 1.5 * iqr, hiF = q3 + 1.5 * iqr;
  const inl = v.filter((x) => x >= loF && x <= hiF);
  return {
    q1, q2, q3, iqr, loF, hiF,
    wLo: inl.length ? Math.min(...inl) : v[0],
    wHi: inl.length ? Math.max(...inl) : v[v.length - 1],
    outliers: v.filter((x) => x < loF || x > hiF),
    min: v[0], max: v[v.length - 1], n: v.length,
    mean: mean(v),
  };
}

/** 偏度 / 峰度（与 pandas 一致：Fisher 峰度、样本校正偏度） */
export function skewness(values) {
  const v = nums(values);
  const n = v.length;
  if (n < 3) return NaN;
  const m = mean(v), s = std(v, 1);
  if (!s) return 0;
  return (n / ((n - 1) * (n - 2))) * v.reduce((a, x) => a + ((x - m) / s) ** 3, 0);
}

export function kurtosis(values) {
  const v = nums(values);
  const n = v.length;
  if (n < 4) return NaN;
  const m = mean(v), s = std(v, 1);
  if (!s) return 0;
  const g2 = v.reduce((a, x) => a + ((x - m) / s) ** 4, 0) * n * (n + 1) / ((n - 1) * (n - 2) * (n - 3));
  return g2 - 3 * (n - 1) ** 2 / ((n - 2) * (n - 3));
}

/** 分组：按某列把行分到若干组 */
export function groupBy(df, byCol) {
  if (!byCol) return null;
  const ci = df.columns.indexOf(byCol);
  if (ci < 0) return null;
  const map = new Map();
  df._rows.forEach((r, i) => {
    const v = r.cells[ci];
    const k = isNA(v) ? 'NaN' : String(v);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(i);
  });
  return map;
}
