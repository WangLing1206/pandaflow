/* ------------------------------------------------------------------
 * ops/common.js — 操作实现之间共享的小工具
 * ------------------------------------------------------------------ */

import { isNA, fmt, mean, std, quantile, median } from '../utils.js';

/** 找一列“人话标签”，用于舞台上显示某一行是谁 */
export function pickLabelCol(df) {
  const prefs = ['姓名', '名称', '城市', '订单号', '商品', '门店', '产品', '地区', '日期', '编号', '学号'];
  for (const p of prefs) if (df.columns.includes(p)) return p;
  // 退而求其次：第一个非数值列
  const obj = df.columns.find((c) => df.dtypes[c] !== 'number');
  return obj || df.columns[0];
}

/** 一列的展示单位 */
export function unitOf(df, col) {
  return df.meta?.unit?.[col] || '';
}

/** 单行标签文本 */
export function labelOf(df, labelCol, i) {
  if (!labelCol) return `#${i}`;
  const ci = df.columns.indexOf(labelCol);
  const v = df._rows[i]?.cells[ci];
  return isNA(v) ? `#${i}` : `${v}`;
}

/**
 * 校验「这一列必须是数值列」。把这些失败变成可读的提示，
 * 而不是让 NaN 一路流到 SVG 属性里变成难懂的报错。
 */
export function assertNumeric(df, col, what = '该操作') {
  if (!col) throw new Error(`${what}需要选择一个数值列，但当前数据里没有可用的数值列`);
  if (df.dtypes[col] !== 'number') {
    throw new Error(`「${col}」的 dtype 是 ${df.dtypes[col]}，不是数值列 —— ${what}需要数值型字段`);
  }
  if (!df.numCol(col).length) throw new Error(`「${col}」里没有任何有效数值，无法参与计算`);
  return true;
}

/** 数值列的统计摘要（空列返回 NaN 摘要而不是 null，避免调用方解构崩溃） */
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

/** 舞台上的统计卡片组 */
export function statCards(s, unit = '') {
  if (!s) return [];
  const u = unit ? ` ${unit}` : '';
  return [
    { label: 'count', value: String(s.n), tone: 'mute' },
    { label: 'mean', value: fmt(s.mean), tone: 'cyan', suffix: u },
    { label: 'std', value: fmt(s.std), tone: 'cyan', suffix: u },
    { label: 'min', value: fmt(s.min), tone: 'violet', suffix: u },
    { label: '50%', value: fmt(s.median), tone: 'amber', suffix: u },
    { label: 'max', value: fmt(s.max), tone: 'rose', suffix: u },
  ];
}

/** 帧的 HUD 指标 */
export function shapeHud(df, extra = []) {
  return [
    { label: 'shape', value: `${df.nrow} × ${df.ncol}`, tone: 'mute' },
    { label: 'rows', value: String(df.nrow), tone: 'cyan' },
    ...extra,
  ];
}

/** 生成“把一批行标记为某状态”的辅助函数 */
export function markRows(states) {
  return new Set(Object.entries(states).filter(([, v]) => v).map(([k]) => Number(k)));
}

/** 数值域：给舞台坐标系用，留 6% 余量 */
export function domain(values, pad = 0.06) {
  const nums = values.filter((v) => typeof v === 'number' && Number.isFinite(v));
  if (!nums.length) return { min: 0, max: 1 };
  let min = Math.min(...nums), max = Math.max(...nums);
  if (min === max) { min -= 1; max += 1; }
  const d = (max - min) * pad;
  return { min: min - d, max: max + d };
}

/** 差异描述，用于“结果对比” */
export function diffLine(before, after, unit = '') {
  const d = after - before;
  const sign = d > 0 ? '+' : '';
  return `${fmt(before)}${unit} → ${fmt(after)}${unit}  (${sign}${fmt(d)})`;
}
