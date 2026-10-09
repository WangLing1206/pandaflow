/* ------------------------------------------------------------------
 * dataframe-extra.js — DataFrame 的进阶方法
 *  ----------------------------------------------------------------
 *  以原型扩展的方式补齐 pandas 的主要 API：
 *  选择/索引、类型筛选、插入弹出、合并重塑、序列运算、窗口、字符串。
 *  拆成单独文件是为了让 dataframe.js 保持可读。
 * ------------------------------------------------------------------ */

import { DataFrame, inferDtype, cmpValues } from './dataframe.js';
import { isNA, mean, median, std, sum, quantile, histogram } from './utils.js';
import { pearson } from './stats.js';

const P = DataFrame.prototype;

/* ============================ 选择与索引 ============================ */

/** 按标签取子集（行索引区间 + 列名） */
P.loc = function (rowLabels, colNames) {
  const cols = colNames && colNames.length ? colNames.filter((c) => this.columns.includes(c)) : this.columns.slice();
  const idxs = (Array.isArray(rowLabels) ? rowLabels : [rowLabels])
    .filter((i) => Number.isInteger(i) && i >= 0 && i < this.nrow);
  return this._subsetRows(cols, idxs);
};

/** 按位置取子集（行区间 + 列区间） */
P.iloc = function (r0, r1, c0, c1) {
  const rows = [];
  for (let i = Math.max(0, r0); i < Math.min(this.nrow, r1); i++) rows.push(i);
  const cols = [];
  for (let c = Math.max(0, c0); c < Math.min(this.ncol, c1); c++) cols.push(this.columns[c]);
  return this._subsetRows(cols.length ? cols : this.columns.slice(), rows);
};

P._subsetRows = function (cols, idxs) {
  const src = cols.map((c) => this.columns.indexOf(c));
  const dtypes = {}; cols.forEach((c, i) => { dtypes[c] = this.dtypes[this.columns[src[i]]]; });
  return DataFrame.fromRows(cols,
    idxs.map((i) => ({ rid: this._rows[i].rid, cells: src.map((c) => this._rows[i].cells[c]) })),
    { dtypes, meta: this.meta, source: this.source, name: this.name });
};

/** 按 dtype 选列 */
P.selectDtypes = function (dtype) {
  const want = Array.isArray(dtype) ? dtype : [dtype];
  const cols = this.columns.filter((c) => {
    const d = this.dtypes[c];
    return want.some((w) => (w === 'number' ? d === 'number' || d === 'int64'
      : w === 'object' ? d === 'object' : w === 'bool' ? d === 'bool' : d === w));
  });
  return this._subsetRows(cols.length ? cols : [this.columns[0]], this._rows.map((_, i) => i));
};

/** 设置索引（这里把该列移到最前并作为索引列标记） */
P.setIndex = function (colName) {
  if (!this.columns.includes(colName)) return this.clone();
  const rest = this.columns.filter((c) => c !== colName);
  const df = this._subsetRows([colName, ...rest], this._rows.map((_, i) => i));
  df.indexCol = colName;
  return df;
};

/** 插入一列到指定位置 */
P.insert = function (pos, name, fn) {
  const base = this.assign(name, fn);
  const cols = base.columns.slice();
  const last = cols.pop();
  cols.splice(Math.max(0, Math.min(pos, cols.length)), 0, last);
  return base._subsetRows(cols, base._rows.map((_, i) => i));
};

/** 弹出一列：返回 { series, df } */
P.popCol = function (colName) {
  return { series: this.col(colName), df: this.dropColumns([colName]) };
};

/** 成员判断筛选 */
P.isin = function (colName, values) {
  const set = new Set(values.map(String));
  const ci = this.colIndex(colName);
  return this.filter((cells) => set.has(String(cells[ci])));
};

/* ============================ 合并与重塑 ============================ */

/**
 * 表连接。on 为连接键列名（两边同名）。
 * how: inner | left | right | outer
 */
P.merge = function (other, on, how = 'inner') {
  const li = this.columns.indexOf(on), ri = other.columns.indexOf(on);
  if (li < 0 || ri < 0) throw new Error(`merge key "${on}" not found in both frames`);
  const rightCols = other.columns.filter((c) => c !== on);
  const cols = [...this.columns, ...rightCols];
  const dtypes = { ...this.dtypes };
  rightCols.forEach((c) => { dtypes[c] = other.dtypes[c]; });

  const rIdx = new Map();
  other._rows.forEach((r) => {
    const k = isNA(r.cells[ri]) ? '\u0000NA' : String(r.cells[ri]);
    if (!rIdx.has(k)) rIdx.set(k, []);
    rIdx.get(k).push(r);
  });
  const lIdx = new Map();
  this._rows.forEach((r) => {
    const k = isNA(r.cells[li]) ? '\u0000NA' : String(r.cells[li]);
    if (!lIdx.has(k)) lIdx.set(k, []);
    lIdx.get(k).push(r);
  });

  const rows = [];
  const matchedRight = new Set();
  if (how === 'inner' || how === 'left' || how === 'outer') {
    for (const r of this._rows) {
      const k = isNA(r.cells[li]) ? '\u0000NA' : String(r.cells[li]);
      const hits = rIdx.get(k) || [];
      if (!hits.length) {
        if (how === 'left' || how === 'outer') rows.push({ rid: r.rid, cells: [...r.cells, ...rightCols.map(() => null)], _m: 'left' });
      } else {
        hits.forEach((h) => {
          matchedRight.add(h.rid);
          rows.push({ rid: r.rid, cells: [...r.cells, ...rightCols.map((c) => h.cells[other.columns.indexOf(c)])], _m: 'both' });
        });
      }
    }
  }
  if (how === 'right' || how === 'outer') {
    for (const h of other._rows) {
      const k = isNA(h.cells[ri]) ? '\u0000NA' : String(h.cells[ri]);
      if (lIdx.has(k) && how === 'right') continue;   // right 已在上面的循环里按左表配对处理
      if (matchedRight.has(h.rid) && how === 'outer') continue;
      rows.push({ rid: h.rid, cells: [...this.columns.map(() => null), ...rightCols.map((c) => h.cells[other.columns.indexOf(c)])], _m: 'right' });
      if (on) rows[rows.length - 1].cells[li] = h.cells[ri];
    }
  }
  // right join 需要按右表顺序重建
  if (how === 'right') {
    rows.length = 0;
    for (const h of other._rows) {
      const k = isNA(h.cells[ri]) ? '\u0000NA' : String(h.cells[ri]);
      const hits = lIdx.get(k) || [];
      if (!hits.length) rows.push({ rid: h.rid, cells: [...this.columns.map(() => null), ...rightCols.map((c) => h.cells[other.columns.indexOf(c)])] });
      else hits.forEach((r) => rows.push({ rid: r.rid, cells: [...r.cells, ...rightCols.map((c) => h.cells[other.columns.indexOf(c)])] }));
      if (rows.length) rows[rows.length - 1].cells[li] = h.cells[ri];
    }
  }

  const df = DataFrame.fromRows(cols, rows, { dtypes, name: `${this.name}_merged`, source: `merge(on="${on}", how="${how}")`, meta: { ...this.meta, title: `${on} merge`, builtin: false } });
  df.mergeInfo = { how, on, rows };
  return df;
};

/** 纵向堆叠 */
P.concat = function (other) {
  const cols = this.columns.slice();
  const rows = this._rows.map((r) => ({ rid: r.rid, cells: r.cells.slice() }));
  other._rows.forEach((r) => {
    rows.push({ rid: r.rid, cells: cols.map((c) => (other.columns.includes(c) ? r.cells[other.columns.indexOf(c)] : null)) });
  });
  const df = DataFrame.fromRows(cols, rows, { dtypes: this.dtypes, name: this.name, meta: this.meta, source: 'concat(axis=0)' });
  df.concatFrom = this.nrow;
  return df;
};

/** 透视表 */
P.pivotTable = function (indexCol, columnsCol, valuesCol, aggFn = 'mean') {
  const ii = this.columns.indexOf(indexCol), ci = this.columns.indexOf(columnsCol), vi = this.columns.indexOf(valuesCol);
  if (ii < 0 || ci < 0 || vi < 0) throw new Error('pivot_table: column not found');
  const rowKeys = [], colKeys = [];
  const cells = new Map();
  this._rows.forEach((r) => {
    const rk = isNA(r.cells[ii]) ? 'NaN' : String(r.cells[ii]);
    const ck = isNA(r.cells[ci]) ? 'NaN' : String(r.cells[ci]);
    if (!rowKeys.includes(rk)) rowKeys.push(rk);
    if (!colKeys.includes(ck)) colKeys.push(ck);
    const key = `${rk}\u0001${ck}`;
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(r.cells[vi]);
  });
  const agg = (arr) => {
    const ns = arr.filter((v) => typeof v === 'number' && Number.isFinite(v));
    switch (aggFn) {
      case 'sum': return ns.length ? sum(ns) : null;
      case 'count': return arr.filter((v) => !isNA(v)).length;
      case 'median': return ns.length ? median(ns) : null;
      case 'min': return ns.length ? Math.min(...ns) : null;
      case 'max': return ns.length ? Math.max(...ns) : null;
      default: return ns.length ? mean(ns) : null;
    }
  };
  const cols = [indexCol, ...colKeys];
  const rows = rowKeys.map((rk) => [rk, ...colKeys.map((ck) => {
    const arr = cells.get(`${rk}\u0001${ck}`);
    if (!arr) return null;
    const v = agg(arr);
    return typeof v === 'number' ? Math.round(v * 100) / 100 : v;
  })]);
  const df = new DataFrame(cols, rows, {
    name: `${this.name}_pivot`,
    source: `pivot_table(index="${indexCol}", columns="${columnsCol}", values="${valuesCol}", aggfunc="${aggFn}")`,
    meta: { title: `${indexCol} × ${columnsCol}`, builtin: false, unit: this.meta?.unit ? { } : {} },
  });
  df.pivotInfo = { rowKeys, colKeys, indexCol, columnsCol, valuesCol, aggFn, cells };
  return df;
};

/** 宽表转长表 */
P.melt = function (idVars, varName = 'variable', valueName = 'value') {
  const ids = (idVars && idVars.length ? idVars : this.columns.filter((c) => this.dtypes[c] !== 'number')).slice();
  const valueCols = this.columns.filter((c) => !ids.includes(c));
  const cols = [...ids, varName, valueName];
  const rows = [];
  const rid = (i, c) => this._rows[i].rid * 1000 + c;
  this._rows.forEach((r, i) => {
    valueCols.forEach((vc, k) => {
      rows.push({
        rid: rid(i, k),
        cells: [...ids.map((c) => r.cells[this.columns.indexOf(c)]), vc, r.cells[this.columns.indexOf(vc)]],
      });
    });
  });
  const df = DataFrame.fromRows(cols, rows, {
    name: `${this.name}_melt`,
    source: `melt(id_vars=${JSON.stringify(ids)})`,
    meta: { title: 'long format', builtin: false },
  });
  df.meltInfo = { idVars: ids, valueCols, sourceRows: this.nrow };
  return df;
};

/** 交叉表 */
P.crosstab = function (a, b) {
  const ai = this.columns.indexOf(a), bi = this.columns.indexOf(b);
  const rowKeys = [], colKeys = [];
  const m = new Map();
  this._rows.forEach((r) => {
    const rk = isNA(r.cells[ai]) ? 'NaN' : String(r.cells[ai]);
    const ck = isNA(r.cells[bi]) ? 'NaN' : String(r.cells[bi]);
    if (!rowKeys.includes(rk)) rowKeys.push(rk);
    if (!colKeys.includes(ck)) colKeys.push(ck);
    const k = `${rk}\u0001${ck}`;
    m.set(k, (m.get(k) || 0) + 1);
  });
  const rows = rowKeys.map((rk) => [rk, ...colKeys.map((ck) => m.get(`${rk}\u0001${ck}`) || 0)]);
  const df = new DataFrame([a, ...colKeys], rows, {
    name: `${this.name}_crosstab`, source: `pd.crosstab(df["${a}"], df["${b}"])`,
    meta: { title: `${a} × ${b}`, builtin: false },
  });
  df.crosstabInfo = { rowKeys, colKeys, a, b, m };
  return df;
};

/* ============================ 序列运算 ============================ */

P.rank = function (colName, asc = true, method = 'min') {
  const vals = this.col(colName);
  const order = vals.map((v, i) => ({ v, i })).filter((o) => typeof o.v === 'number' && Number.isFinite(o.v))
    .sort((a, b) => (asc ? a.v - b.v : b.v - a.v));
  const ranks = new Map();
  let k = 0;
  while (k < order.length) {
    let j = k;
    while (j + 1 < order.length && order[j + 1].v === order[k].v) j++;
    const avg = (k + j) / 2 + 1;
    const r = method === 'min' ? k + 1 : method === 'max' ? j + 1 : method === 'dense' ? NaN : avg;
    for (let x = k; x <= j; x++) ranks.set(order[x].i, r);
    k = j + 1;
  }
  let dense = 0, lastV = null;
  order.forEach((o, i) => {
    if (lastV === null || o.v !== lastV) dense++;
    lastV = o.v;
    if (method === 'dense') ranks.set(o.i, dense);
  });
  return this.assign(`${colName}_rank`, (cells, i) => ranks.has(i) ? ranks.get(i) : null);
};

P.shift = function (colName, periods = 1, newName) {
  const ci = this.colIndex(colName);
  const name = newName || `${colName}_shift${periods}`;
  return this.assign(name, (cells, i) => {
    const j = i - periods;
    return j >= 0 && j < this.nrow ? this._rows[j].cells[ci] : null;
  });
};

P.diff = function (colName, periods = 1, newName) {
  const ci = this.colIndex(colName);
  const name = newName || `${colName}_diff`;
  return this.assign(name, (cells, i) => {
    const j = i - periods;
    if (j < 0 || j >= this.nrow) return null;
    const a = cells[ci], b = this._rows[j].cells[ci];
    if (typeof a !== 'number' || typeof b !== 'number') return null;
    return Math.round((a - b) * 1e6) / 1e6;
  });
};

P.pctChange = function (colName, newName) {
  const ci = this.colIndex(colName);
  const name = newName || `${colName}_pct`;
  return this.assign(name, (cells, i) => {
    const j = i - 1;
    if (j < 0) return null;
    const a = cells[ci], b = this._rows[j].cells[ci];
    if (typeof a !== 'number' || typeof b !== 'number' || b === 0) return null;
    return Math.round((a - b) / b * 10000) / 100;
  });
};

P.cumsum = function (colName, newName) {
  const ci = this.colIndex(colName);
  const name = newName || `${colName}_cumsum`;
  let acc = 0;
  return this.assign(name, (cells) => {
    const v = cells[ci];
    if (typeof v === 'number' && Number.isFinite(v)) acc += v;
    return Math.round(acc * 1e6) / 1e6;
  });
};

P.cummax = function (colName, newName) {
  const ci = this.colIndex(colName);
  const name = newName || `${colName}_cummax`;
  let best = null;
  return this.assign(name, (cells) => {
    const v = cells[ci];
    if (typeof v === 'number' && Number.isFinite(v)) best = best === null ? v : Math.max(best, v);
    return best;
  });
};

/** 滑动窗口聚合 */
P.rolling = function (colName, window = 3, aggFn = 'mean', newName) {
  const ci = this.colIndex(colName);
  const name = newName || `${colName}_roll${window}`;
  return this.assign(name, (cells, i) => {
    if (i < window - 1) return null;
    const win = [];
    for (let k = i - window + 1; k <= i; k++) {
      const v = this._rows[k].cells[ci];
      if (typeof v === 'number' && Number.isFinite(v)) win.push(v);
    }
    if (!win.length) return null;
    const r = aggFn === 'sum' ? sum(win) : aggFn === 'min' ? Math.min(...win)
      : aggFn === 'max' ? Math.max(...win) : aggFn === 'std' ? std(win, 1) : mean(win);
    return Math.round(r * 1e6) / 1e6;
  });
};

/** 条件替换：cond 为 true 时保留，否则替换为 other */
P.where = function (colName, pred, other) {
  const ci = this.colIndex(colName);
  const rows = this._rows.map((r, i) => {
    const cells = r.cells.slice();
    const v = cells[ci];
    const keep = pred(v, i);
    if (!keep) cells[ci] = typeof other === 'function' ? other(v, i) : other;
    return { rid: r.rid, cells };
  });
  return DataFrame.fromRows(this.columns, rows, { dtypes: this.dtypes, meta: this.meta, source: this.source });
};

/** 逐元素函数 */
P.apply = function (colName, fn, newName) {
  const ci = this.colIndex(colName);
  return this.assign(newName || `${colName}_applied`, (cells, i) => fn(cells[ci], i));
};

P.round = function (colName, decimals = 0) {
  const ci = this.colIndex(colName);
  const f = 10 ** decimals;
  const rows = this._rows.map((r) => {
    const cells = r.cells.slice();
    const v = cells[ci];
    if (typeof v === 'number' && Number.isFinite(v)) cells[ci] = Math.round(v * f) / f;
    return { rid: r.rid, cells };
  });
  return DataFrame.fromRows(this.columns, rows, { dtypes: this.dtypes, meta: this.meta, source: this.source });
};

P.abs = function (colName) {
  const ci = this.colIndex(colName);
  const rows = this._rows.map((r) => {
    const cells = r.cells.slice();
    if (typeof cells[ci] === 'number') cells[ci] = Math.abs(cells[ci]);
    return { rid: r.rid, cells };
  });
  return DataFrame.fromRows(this.columns, rows, { dtypes: this.dtypes, meta: this.meta, source: this.source });
};

/** 分箱离散化：mode = 'cut' 固定边界 / 'qcut' 等频 */
P.cut = function (colName, mode = 'cut', arg = 4, newName) {
  const ci = this.colIndex(colName);
  const ns = this.col(colName).filter((v) => typeof v === 'number' && Number.isFinite(v));
  const name = newName || `${colName}_bin`;
  let edges;
  if (mode === 'qcut') {
    edges = [];
    for (let i = 0; i <= arg; i++) edges.push(quantile(ns, i / arg));
    edges = [...new Set(edges)];
  } else {
    const lo = Math.min(...ns), hi = Math.max(...ns);
    const w = (hi - lo) / arg;
    edges = Array.from({ length: arg + 1 }, (_, i) => Math.round((lo + i * w) * 100) / 100);
  }
  const labels = edges.slice(0, -1).map((e, i) => `[${fmtEdge(e)}, ${fmtEdge(edges[i + 1])})`);
  const df = this.assign(name, (cells) => {
    const v = cells[ci];
    if (typeof v !== 'number' || !Number.isFinite(v)) return null;
    let i = 0;
    while (i < labels.length - 1 && v >= edges[i + 1]) i++;
    return labels[i];
  });
  df.cutInfo = { edges, labels, mode, arg, colName };
  return df;
};

function fmtEdge(v) {
  if (!Number.isFinite(v)) return String(v);
  return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100);
}

/* ============================ 字符串操作 ============================ */

P.strOps = {
  contains(df, colName, pat) {
    const ci = df.colIndex(colName);
    return df.filter((cells) => !isNA(cells[ci]) && String(cells[ci]).toLowerCase().includes(String(pat).toLowerCase()));
  },
  replace(df, colName, from, to) {
    const ci = df.colIndex(colName);
    const rows = df._rows.map((r) => {
      const cells = r.cells.slice();
      if (!isNA(cells[ci])) cells[ci] = String(cells[ci]).split(String(from)).join(String(to));
      return { rid: r.rid, cells };
    });
    return DataFrame.fromRows(df.columns, rows, { dtypes: df.dtypes, meta: df.meta, source: df.source });
  },
  split(df, colName, sep, aName, bName) {
    const ci = df.colIndex(colName);
    let d = df.assign(aName, (cells) => {
      const v = cells[ci];
      if (isNA(v)) return null;
      const parts = String(v).split(sep);
      return parts[0] ?? null;
    });
    d = d.assign(bName, (cells) => {
      const v = cells[ci];
      if (isNA(v)) return null;
      const parts = String(v).split(sep);
      return parts.length > 1 ? parts.slice(1).join(sep) : null;
    });
    return d;
  },
  upper(df, colName) {
    const ci = df.colIndex(colName);
    const rows = df._rows.map((r) => {
      const cells = r.cells.slice();
      if (!isNA(cells[ci])) cells[ci] = String(cells[ci]).toUpperCase();
      return { rid: r.rid, cells };
    });
    return DataFrame.fromRows(df.columns, rows, { dtypes: df.dtypes, meta: df.meta, source: df.source });
  },
  len(df, colName, newName) {
    const ci = df.colIndex(colName);
    return df.assign(newName || `${colName}_len`, (cells) => (isNA(cells[ci]) ? null : String(cells[ci]).length));
  },
  strip(df, colName) {
    const ci = df.colIndex(colName);
    const rows = df._rows.map((r) => {
      const cells = r.cells.slice();
      if (!isNA(cells[ci])) cells[ci] = String(cells[ci]).trim();
      return { rid: r.rid, cells };
    });
    return DataFrame.fromRows(df.columns, rows, { dtypes: df.dtypes, meta: df.meta, source: df.source });
  },
};

/* ============================ 统计 ============================ */

/** 相关系数矩阵 */
P.corr = function () {
  const cols = this.columns.filter((c) => this.dtypes[c] === 'number');
  const data = cols.map((c) => this.col(c).map((v) => (typeof v === 'number' ? v : NaN)));
  const rows = cols.map((_, i) => cols.map((__, j) => {
    if (i === j) return 1;
    const v = pearson(data[i], data[j]);
    return Number.isFinite(v) ? Math.round(v * 10000) / 10000 : null;
  }));
  return new DataFrame([''] .concat(cols), cols.map((c, i) => [c, ...rows[i]]), {
    name: 'corr', source: 'df.corr()', meta: { title: 'correlation', builtin: false },
  });
};

/** 协方差矩阵（样本，ddof=1） */
P.cov = function () {
  const cols = this.columns.filter((c) => this.dtypes[c] === 'number');
  const data = cols.map((c) => this.col(c));
  const rows = cols.map((_, i) => cols.map((__, j) => {
    const pairs = [];
    for (let k = 0; k < data[i].length; k++) {
      if (typeof data[i][k] === 'number' && typeof data[j][k] === 'number') pairs.push(k);
    }
    if (pairs.length < 2) return null;
    const mi = mean(pairs.map((k) => data[i][k])), mj = mean(pairs.map((k) => data[j][k]));
    const v = pairs.reduce((s, k) => s + (data[i][k] - mi) * (data[j][k] - mj), 0) / (pairs.length - 1);
    return Math.round(v * 10000) / 10000;
  }));
  return new DataFrame([''].concat(cols), cols.map((c, i) => [c, ...rows[i]]), {
    name: 'cov', source: 'df.cov()', meta: { title: 'covariance', builtin: false },
  });
};

export { P as DataFrameProto };
