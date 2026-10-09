/* ------------------------------------------------------------------
 * dataframe.js — 一个轻量的 pandas 语义 DataFrame 实现
 *  ----------------------------------------------------------------
 *  说明：本项目的目标之一是「不调用任何现成表格库」，
 *  因此这里从零实现 pandas 的核心数据结构与统计方法，
 *  javascript 端复现 pandas 的默认行为（ddof=1、线性插值分位数等）。
 * ------------------------------------------------------------------ */

import { isNA, isNum, toNum, mean, median, std, quantile, sum, histogram, fmt } from './utils.js';

let RID = 1;
export const nextRid = () => RID++;

/**
 * 推断一列的 dtype，语义对齐 pandas。
 * 注意：这里对数值的判定是严格的（必须是真正的 number 值）。
 * CSV 解析阶段已经把可转换的字符串转成了 number，所以读进来的
 * 数值列会被正确识别；而像「学号 20240101」这种带前导 0 风险的
 * 标识符会保留为字符串 —— 这样 dtypes 与列里真实的值永远一致，
 * 不会出现「声明是 float64 却取不到数值」的情况。
 */
export function inferDtype(values) {
  const nn = values.filter((v) => !isNA(v));
  if (!nn.length) return 'object';
  if (nn.every((v) => typeof v === 'boolean')) return 'bool';
  if (nn.every((v) => typeof v === 'number' && Number.isFinite(v))) return 'number';
  return 'object';
}

export const DTYPE_LABEL = {
  number: 'float64',
  object: 'object',
  bool: 'bool',
  int64: 'int64',
};

export class DataFrame {
  /**
   * @param {string[]} columns 列名
   * @param {Array<any[]>} rows 二维数组，行顺序即索引顺序
   * @param {object} opts { dtypes: {col: dtype}, name, meta }
   */
  constructor(columns, rows, opts = {}) {
    this.columns = columns.slice();
    this._rows = rows.map((r) => ({ rid: nextRid(), cells: r.slice() }));
    this.name = opts.name || 'df';
    this.source = opts.source || null;   // 数据来源说明
    this.dtypes = {};
    for (let c = 0; c < this.columns.length; c++) {
      const col = this.columns[c];
      this.dtypes[col] = opts.dtypes?.[col] || inferDtype(this._rows.map((r) => r.cells[c]));
    }
    // 附加的展示元信息（例如某列的单位）
    this.meta = opts.meta || {};
  }

  /* --------------------------- 基本属性 --------------------------- */

  get shape() { return [this._rows.length, this.columns.length]; }
  get index() { return this._rows.map((_, i) => i); }
  get nrow() { return this._rows.length; }
  get ncol() { return this.columns.length; }

  colIndex(name) {
    const i = this.columns.indexOf(name);
    if (i < 0) throw new Error(`KeyError: '${name}'`);
    return i;
  }

  /** 取一列的值数组 */
  col(name) {
    const i = this.colIndex(name);
    return this._rows.map((r) => r.cells[i]);
  }

  /** 取一列中的数值（自动排除缺失） */
  numCol(name) {
    return this.col(name).filter((v) => typeof v === 'number' && Number.isFinite(v));
  }

  /** 深度克隆（保留 rid，用于动画身份连续） */
  clone(opts = {}) {
    const df = new DataFrame(this.columns, [], {
      dtypes: this.dtypes, name: opts.name || this.name, meta: this.meta,
      source: this.source,
    });
    df._rows = this._rows.map((r) => ({ rid: r.rid, cells: r.cells.slice() }));
    return df;
  }

  /** 从「行对象」构造，保留 rid */
  static fromRows(columns, rows, opts = {}) {
    const df = new DataFrame(columns, [], opts);
    df._rows = rows.map((r) => ({ rid: r.rid ?? nextRid(), cells: r.cells.slice() }));
    for (const c of columns) if (!opts.dtypes?.[c]) df.dtypes[c] = inferDtype(df.col(c));
    return df;
  }

  /* --------------------------- 缺失值 ----------------------------- */

  /** 与 pandas .isnull() 对齐的布尔框 */
  isnull() {
    const out = {};
    for (const c of this.columns) out[c] = this._rows.map((r) => isNA(r.cells[this.colIndex(c)]));
    return out;
  }

  /** 缺失值统计 */
  nullCounts() {
    const out = {};
    for (let c = 0; c < this.columns.length; c++) {
      out[this.columns[c]] = this._rows.reduce((s, r) => s + (isNA(r.cells[c]) ? 1 : 0), 0);
    }
    return out;
  }

  nonNullCount(col) { return this.col(col).filter((v) => !isNA(v)).length; }

  /* --------------------------- 统计方法 --------------------------- */

  /** describe()，与 pandas 输出对齐 */
  describe() {
    const numCols = this.columns.filter((c) => this.dtypes[c] === 'number');
    const stats = ['count', 'mean', 'std', 'min', '25%', '50%', '75%', 'max'];
    const out = { index: stats, columns: numCols, data: {} };
    for (const c of numCols) {
      const vals = this.col(c);
      const nn = vals.filter((v) => typeof v === 'number' && Number.isFinite(v));
      out.data[c] = {
        count: nn.length,
        mean: mean(nn),
        std: std(nn, 1),
        min: nn.length ? Math.min(...nn) : NaN,
        '25%': quantile(nn, 0.25),
        '50%': quantile(nn, 0.5),
        '75%': quantile(nn, 0.75),
        max: nn.length ? Math.max(...nn) : NaN,
      };
    }
    return out;
  }

  /** 单列聚合，func 为 'mean' | 'median' | 'std' | 'sum' | 'min' | 'max' | 'count' | fn */
  agg(name, func = 'mean') {
    const vals = this.col(name).filter((v) => typeof v === 'number' && Number.isFinite(v));
    switch (func) {
      case 'count': return this.nonNullCount(name);
      case 'mean': return mean(vals);
      case 'median': return median(vals);
      case 'std': return std(vals, 1);
      case 'var': return std(vals, 1) ** 2;
      case 'sum': return sum(vals);
      case 'min': return vals.length ? Math.min(...vals) : NaN;
      case 'max': return vals.length ? Math.max(...vals) : NaN;
      case 'nunique': return new Set(this.col(name).filter((v) => !isNA(v)).map(String)).size;
      case 'quantile': return quantile(vals, 0.5);
      default: return typeof func === 'function' ? func(vals) : NaN;
    }
  }

  /** info() 结构 */
  info() {
    const nulls = this.nullCounts();
    return {
      shape: this.shape,
      columns: this.columns.map((c) => ({
        name: c,
        dtype: DTYPE_LABEL[this.dtypes[c]] || this.dtypes[c],
        nonNull: this.nonNullCount(c),
        nulls: nulls[c],
      })),
    };
  }

  /* --------------------------- 变换方法 --------------------------- */

  head(n = 5) { const df = this._slice(0, n); df.name = `${this.name}.head(${n})`; return df; }
  tail(n = 5) { const df = this._slice(Math.max(0, this.nrow - n), this.nrow); df.name = `${this.name}.tail(${n})`; return df; }

  _slice(a, b) {
    return DataFrame.fromRows(this.columns, this._rows.slice(a, b).map((r) => ({ rid: r.rid, cells: r.cells })), {
      dtypes: this.dtypes, meta: this.meta, source: this.source,
    });
  }

  /** 选择行子集（按谓词），保留 rid */
  filter(pred) {
    return DataFrame.fromRows(this.columns,
      this._rows.filter((r, i) => pred(r.cells, i)).map((r) => ({ rid: r.rid, cells: r.cells })),
      { dtypes: this.dtypes, meta: this.meta, source: this.source });
  }

  /** 删除指定 rid 的行 */
  dropRids(rids) {
    const s = new Set(rids);
    return DataFrame.fromRows(this.columns,
      this._rows.filter((r) => !s.has(r.rid)).map((r) => ({ rid: r.rid, cells: r.cells })),
      { dtypes: this.dtypes, meta: this.meta, source: this.source });
  }

  dropna(subset = null) {
    const cols = subset || this.columns;
    const idx = cols.map((c) => this.colIndex(c));
    return this.filter((cells) => !idx.some((i) => isNA(cells[i])));
  }

  /** 填充缺失值。value 为标量，或 {method:'ffill'|'bfill'} */
  fillna(value, subset = null) {
    const cols = subset || this.columns;
    const isIdx = new Set(cols.map((c) => this.colIndex(c)));
    const rows = this._rows.map((r) => ({ rid: r.rid, cells: r.cells.slice() }));
    if (value && value.method === 'ffill') {
      for (const ci of isIdx) {
        let last = null;
        for (const r of rows) {
          if (isNA(r.cells[ci])) { if (last !== null) r.cells[ci] = last; }
          else last = r.cells[ci];
        }
      }
    } else if (value && value.method === 'bfill') {
      for (const ci of isIdx) {
        let next = null;
        for (let i = rows.length - 1; i >= 0; i--) {
          if (isNA(rows[i].cells[ci])) { if (next !== null) rows[i].cells[ci] = next; }
          else next = rows[i].cells[ci];
        }
      }
    } else {
      const fill = typeof value === 'function' ? null : value;
      for (const r of rows) {
        for (const ci of isIdx) if (isNA(r.cells[ci])) r.cells[ci] = fill;
      }
    }
    return DataFrame.fromRows(this.columns, rows, { dtypes: this.dtypes, meta: this.meta, source: this.source });
  }

  /** 行指纹，用于去重比较 */
  fingerprint(r, cols) {
    return cols.map((c) => {
      const v = r.cells[this.colIndex(c)];
      return isNA(v) ? '\u0000NA' : (typeof v === 'number' ? String(Number(v.toFixed(10))) : String(v));
    }).join('\u0001');
  }

  dropDuplicates(subset = null, keep = 'first') {
    const cols = subset || this.columns;
    const seen = new Map();
    const keepRids = new Set();
    for (const r of this._rows) {
      const fp = this.fingerprint(r, cols);
      if (!seen.has(fp)) { seen.set(fp, r.rid); keepRids.add(r.rid); }
      else if (keep === 'last') { keepRids.delete(seen.get(fp)); seen.set(fp, r.rid); keepRids.add(r.rid); }
    }
    return DataFrame.fromRows(this.columns,
      this._rows.filter((r) => keepRids.has(r.rid)).map((r) => ({ rid: r.rid, cells: r.cells })),
      { dtypes: this.dtypes, meta: this.meta, source: this.source });
  }

  sortValues(by, ascending = true) {
    const ci = this.colIndex(by);
    const rows = this._rows.slice().sort((a, b) => cmpValues(a.cells[ci], b.cells[ci]) * (ascending ? 1 : -1));
    return DataFrame.fromRows(this.columns, rows.map((r) => ({ rid: r.rid, cells: r.cells })),
      { dtypes: this.dtypes, meta: this.meta, source: this.source });
  }

  /** 按表达式筛选（表达式为字符串，见 expr.js） */
  query(pred) {
    return this.filter(pred);
  }

  astype(colName, dtype) {
    const ci = this.colIndex(colName);
    const rows = this._rows.map((r) => ({ rid: r.rid, cells: r.cells.slice() }));
    for (const r of rows) {
      const v = r.cells[ci];
      if (isNA(v)) continue;
      if (dtype === 'string' || dtype === 'object') r.cells[ci] = String(v);
      else if (dtype === 'number' || dtype === 'float64') r.cells[ci] = toNum(v);
      else if (dtype === 'int64') r.cells[ci] = Math.trunc(toNum(v));
    }
    const df = DataFrame.fromRows(this.columns, rows, { dtypes: this.dtypes, meta: this.meta, source: this.source });
    df.dtypes[colName] = dtype === 'int64' ? 'int64' : dtype;
    return df;
  }

  /** 新增一列，fn 接收 (cells, i, df) */
  assign(name, fn) {
    const cols = this.columns.concat([name]);
    let dtypes = { ...this.dtypes };
    const rows = this._rows.map((r, i) => ({ rid: r.rid, cells: r.cells.concat([fn(r.cells, i, this)]) }));
    if (!dtypes[name]) dtypes[name] = inferDtype(rows.map((r) => r.cells[r.cells.length - 1]));
    return DataFrame.fromRows(cols, rows, { dtypes, meta: this.meta, source: this.source });
  }

  rename(mapping) {
    const cols = this.columns.map((c) => mapping[c] ?? c);
    const dtypes = {};
    this.columns.forEach((c, i) => { dtypes[cols[i]] = this.dtypes[c]; });
    const df = DataFrame.fromRows(cols, this._rows.map((r) => ({ rid: r.rid, cells: r.cells })),
      { dtypes, meta: this.meta, source: this.source });
    return df;
  }

  dropColumns(names) {
    const kill = new Set([].concat(names));
    const cols = this.columns.filter((c) => !kill.has(c));
    const idxs = this.columns.map((c, i) => (kill.has(c) ? -1 : i)).filter((i) => i >= 0);
    const dtypes = {}; cols.forEach((c, i) => dtypes[c] = this.dtypes[this.columns[idxs[i]]]);
    return DataFrame.fromRows(cols, this._rows.map((r) => ({ rid: r.rid, cells: idxs.map((i) => r.cells[i]) })),
      { dtypes, meta: this.meta, source: this.source });
  }

  /** 上下截断 */
  clip(colName, lo, hi) {
    const ci = this.colIndex(colName);
    const rows = this._rows.map((r) => {
      const cells = r.cells.slice();
      const v = cells[ci];
      if (typeof v === 'number') {
        if (lo !== null && lo !== undefined && v < lo) cells[ci] = lo;
        if (hi !== null && hi !== undefined && v > hi) cells[ci] = hi;
      }
      return { rid: r.rid, cells };
    });
    return DataFrame.fromRows(this.columns, rows, { dtypes: this.dtypes, meta: this.meta, source: this.source });
  }

  /** 值替换 */
  replace(colName, oldV, newV) {
    const ci = this.colIndex(colName);
    const rows = this._rows.map((r) => {
      const cells = r.cells.slice();
      if (String(cells[ci]) === String(oldV)) cells[ci] = newV;
      return { rid: r.rid, cells };
    });
    return DataFrame.fromRows(this.columns, rows, { dtypes: this.dtypes, meta: this.meta, source: this.source });
  }

  sample(n, seed = 42) {
    const arr = this._rows.slice();
    let s = seed >>> 0;
    const rand = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
    for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
    return DataFrame.fromRows(this.columns, arr.slice(0, n).map((r) => ({ rid: r.rid, cells: r.cells })),
      { dtypes: this.dtypes, meta: this.meta, source: this.source });
  }

  resetIndex() { return this.clone(); }

  /** value_counts，返回 [[值, 计数], ...] 按计数降序 */
  valueCounts(colName) {
    const vals = this.col(colName).filter((v) => !isNA(v));
    const map = new Map();
    for (const v of vals) { const k = String(v); map.set(k, (map.get(k) || 0) + 1); }
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }

  /** groupby().agg() —— 返回分组后的行与聚合结果 */
  groupAgg(byCol, aggSpec) {
    const bi = this.colIndex(byCol);
    const groups = new Map();
    for (const r of this._rows) {
      const k = isNA(r.cells[bi]) ? 'NaN' : String(r.cells[bi]);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(r);
    }
    return groups;
  }

  /** 直方图数据 */
  hist(colName, bins) { return histogram(this.col(colName), bins); }

  toCSV() {
    const esc = (v) => {
      if (isNA(v)) return '';
      const s = String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [this.columns.map(esc).join(',')];
    for (const r of this._rows) lines.push(r.cells.map(esc).join(','));
    return lines.join('\n');
  }

  /** 生成行快照数组，供帧序列使用 */
  snapshotRows() {
    return this._rows.map((r, i) => ({ rid: r.rid, pos: i, cells: r.cells.slice() }));
  }
}

/** 值比较：数值按数值，字符串按字典序，NA 永远排最后 */
export function cmpValues(a, b) {
  const na = isNA(a), nb = isNA(b);
  if (na && nb) return 0;
  if (na) return 1;
  if (nb) return -1;
  const num = typeof a === 'number' && typeof b === 'number';
  if (num) return a - b;
  return String(a).localeCompare(String(b), 'zh-CN');
}

/** 从二维数组构建 DataFrame（自动推断） */
export function fromArrays(columns, rows, opts) { return new DataFrame(columns, rows, opts); }

export { fmt };
