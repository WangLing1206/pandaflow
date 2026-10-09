/* ------------------------------------------------------------------
 * ops/kit.js — 操作实现的共用工具
 * ------------------------------------------------------------------ */

import { L, pick, getLang, t } from '../../i18n/index.js';
import { fmt, isNA, mean, median, std, quantile, sum } from '../utils.js';
import { Script, T } from '../frames.js';

export { L, pick, getLang, t, fmt, isNA, Script, T };

/** 阶段标题：① 中文 / ① English */
export const ph = (n, zh, en) => L(`${n} ${zh}`, `${n} ${en}`);

/** 找一列「人话标签」，用于舞台上显示某一行是谁 */
export function pickLabelCol(df) {
  if (df.meta?.labelCol && df.columns.includes(df.meta.labelCol)) return df.meta.labelCol;
  const prefs = ['姓名', '名称', '城市', '订单号', '商品', '门店', '产品', '地区', '日期', '编号',
    'Name', 'City', 'OrderID', 'Product', 'Region', 'Date'];
  for (const p of prefs) if (df.columns.includes(p)) return p;
  const obj = df.columns.find((c) => df.dtypes[c] !== 'number');
  return obj || df.columns[0];
}

/** 优先使用的分组列 */
export function pickCategoryCol(df) {
  if (df.meta?.categoryCol && df.columns.includes(df.meta.categoryCol)) return df.meta.categoryCol;
  let best = null, bestN = Infinity;
  for (const c of df.columns) {
    if (df.dtypes[c] === 'number') continue;
    const n = new Set(df.col(c).map(String)).size;
    if (n > 1 && n <= 15 && n < bestN) { best = c; bestN = n; }
  }
  return best || df.columns.find((c) => df.dtypes[c] !== 'number') || df.columns[0];
}

/** 缺得最多的列 */
export function nullestCol(df) {
  const counts = df.nullCounts();
  let best = df.columns[0], bestN = 0;
  for (const c of df.columns) if (counts[c] > bestN) { best = c; bestN = counts[c]; }
  return best;
}

export function unitOf(df, col) { return df.meta?.unit?.[col] || ''; }

export function labelOf(df, labelCol, i) {
  if (!labelCol) return `#${i}`;
  const ci = df.columns.indexOf(labelCol);
  const v = df._rows[i]?.cells[ci];
  return isNA(v) ? `#${i}` : `${v}`;
}

/** 数值列的统计摘要 */
export function colSummary(df, col) {
  const vals = df.col(col).filter((v) => typeof v === 'number' && Number.isFinite(v));
  if (!vals.length) return { n: 0, min: NaN, max: NaN, mean: NaN, median: NaN, std: NaN, q1: NaN, q3: NaN };
  return {
    n: vals.length,
    min: Math.min(...vals),
    max: Math.max(...vals),
    mean: mean(vals),
    median: median(vals),
    std: std(vals, 1),
    q1: quantile(vals, 0.25),
    q3: quantile(vals, 0.75),
  };
}

/**
 * 校验「这一列必须是数值列」。把这些失败变成可读的提示，
 * 而不是让 NaN 一路流到 SVG 属性里变成难懂的报错。
 */
export function assertNumeric(df, col, what = 'This operation') {
  if (!col) throw new Error(`${what} needs a numeric column, but the current data has none`);
  if (df.dtypes[col] !== 'number') {
    throw new Error(`"${col}" has dtype ${df.dtypes[col]}, not numeric — ${what} requires numeric fields`);
  }
  if (!df.numCol(col).length) throw new Error(`"${col}" contains no valid numbers`);
  return true;
}

/** 数值域：给舞台坐标系用，留 6% 余量 */
export function domain(values, pad = 0.06) {
  const ns = values.filter((v) => typeof v === 'number' && Number.isFinite(v));
  if (!ns.length) return { min: 0, max: 1 };
  let min = Math.min(...ns), max = Math.max(...ns);
  if (min === max) { min -= 1; max += 1; }
  const d = (max - min) * pad;
  return { min: min - d, max: max + d };
}

/** 通用「n 行 × m 列」标签 */
export const shapeStr = (df) => `${df.nrow} × ${df.ncol}`;

/** 结果帧通用的对比 payload */
export function comparePayload(before, after, extra = {}) {
  return {
    kind: 'compare',
    before: { shape: [before.nrow, before.ncol], stats: null },
    after: { shape: [after.nrow, after.ncol], stats: null },
    removed: [],
    ...extra,
  };
}

/** 行状态集合工具 */
export const inSet = (s) => (arr) => arr.some((x) => s.has(x));
