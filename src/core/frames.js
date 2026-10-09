/* ------------------------------------------------------------------
 * frames.js — 帧脚本模型
 *  ----------------------------------------------------------------
 *  每个操作（op）都不是「直接返回结果」，而是生成一串「帧」（Frame）。
 *  每一帧都是完整快照（而不是增量），因此播放器可以任意反向拖动、
 *  跳转、变速，都能精确还原到那一刻的数据状态。
 *
 *  Frame = {
 *    phase, title, narration, duration, tone,
 *    code: { lines: [{text, active}] },
 *    table: TableState,
 *    stage: { kind, ...payload },
 *    hud: [{ label, value, tone }],
 *    final: boolean
 *  }
 *
 *  TableState = {
 *    columns: string[],
 *    index: string[],                       // 索引列显示文本（默认 0..n-1）
 *    rows: [{ rid, cells, state, marks }],  // 数组顺序 = 显示顺序
 *  }
 * ------------------------------------------------------------------ */

import { isNA } from './utils.js';

/* ------------------------- 表格状态构造 ------------------------- */

/**
 * 构造一帧的表格状态。
 *
 * 重要：所有回调都拿到「该行在 df 中的原始索引 origIdx」，而不是它在
 * 可见列表里的位置 pos。这样即使中间删了行、重排了序，我们仍然可以
 * 用 `i === maxIdx` 这样的原始索引去判断状态 —— 而且索引列显示的正是
 * pandas 真实索引（删除后留下的断层会如实地展示出来）。
 *
 * @param {DataFrame} df
 * @param {object} o
 *  - columns   显示哪些列（默认全部）
 *  - rowState  (row, origIdx, pos) => 'normal'|'dim'|'focus'|'keep'|'danger'|'ghost'
 *  - cellState (row, origIdx, name, colIdx, pos) => null | 'scan'|'champ-max'|'champ-min'
 *              | 'na'|'new'|'change'|'best'|'seen'|'focus'|'out'
 *  - order     自定义显示顺序（rid 数组）
 *  - index     (row, origIdx, pos) => 索引列文本（默认显示 origIdx）
 *  - include   仅包含这些 rid
 */
export function T(df, o = {}) {
  const columns = o.columns || df.columns;
  const colIdx = columns.map((c) => df.columns.indexOf(c));
  let entries = df._rows.map((r, i) => ({ r, i }));
  if (o.include) { const s = new Set(o.include); entries = entries.filter((e) => s.has(e.r.rid)); }
  if (o.order) {
    const map = new Map(entries.map((e) => [e.r.rid, e]));
    entries = o.order.map((rid) => map.get(rid)).filter(Boolean);
  }
  const rows = entries.map((e, pos) => {
    const cells = colIdx.map((ci) => e.r.cells[ci]);
    let marks = null;
    if (o.cellState) {
      for (let k = 0; k < columns.length; k++) {
        const st = o.cellState(e.r, e.i, columns[k], colIdx[k], pos);
        if (st) { marks ||= {}; marks[k] = st; }
      }
    }
    return {
      rid: e.r.rid,
      cells,
      state: o.rowState ? (o.rowState(e.r, e.i, pos) || 'normal') : 'normal',
      marks,
      label: o.index ? String(o.index(e.r, e.i, pos)) : String(e.i),
    };
  });
  return { columns, rows, dtypes: pick(dtypesOf(df), columns) };
}

function dtypesOf(df) { const o = {}; for (const c of df.columns) o[c] = df.dtypes[c]; return o; }
function pick(obj, keys) { const o = {}; for (const k of keys) o[k] = obj[k]; return o; }

/** 仅展示前 n 行 */
export function T_head(df, n, o = {}) {
  return T(df, { ...o, include: df._rows.slice(0, n).map((r) => r.rid) });
}

/* --------------------------- 帧构造器 --------------------------- */

export class Script {
  constructor(baseDf, opDef) {
    this.base = baseDf;
    this.op = opDef;
    this.frames = [];
    this._id = 0;
  }

  /**
   * 追加一帧
   * @param {object} f { phase, title, narration, duration, tone, code, table, stage, hud, final, stats }
   */
  add(f) {
    const frame = {
      id: `f${this._id++}`,
      phase: f.phase || '',
      title: f.title || '',
      narration: f.narration || '',
      duration: f.duration ?? 1200,
      tone: f.tone || 'info',           // info | ok | warn | danger | gold
      code: f.code || this._code,
      table: f.table || this._table || T(this.base),
      stage: f.stage || { kind: 'none' },
      hud: f.hud || [],
      note: f.note || null,
      final: !!f.final,
    };
    this.frames.push(frame);
    return frame;
  }

  /** 设定后续帧默认使用的代码块 */
  code(lines, active = -1) {
    const arr = (Array.isArray(lines) ? lines : String(lines).split('\n')).map((t, i) => ({ text: t, active: i === active }));
    this._code = { lines: arr };
    return this;
  }

  /** 高亮代码中第 i 行 */
  codeAt(i) {
    if (!this._code) return undefined;
    return { lines: this._code.lines.map((l, k) => ({ ...l, active: k === i })) };
  }

  table(t) { this._table = t; return t; }
  get length() { return this.frames.length; }
}

/* --------------------------- 常用代码片段 --------------------------- */

export const CODE = {
  read: (name) => [`import pandas as pd`, `df = pd.read_csv("${name}")`],
  head: (n) => [`df.head(${n})`],
  tail: (n) => [`df.tail(${n})`],
  info: () => [`df.info()`],
  describe: (cols) => [`df.describe()`],
  isnull: () => [`# 每个字段的缺失数量`, `df.isnull().sum()`],
  dropna: () => [
    `# axis=0 按行删除，任意字段缺失即丢弃`,
    `df = df.dropna(axis=0, how="any")`,
    `df = df.reset_index(drop=True)`,
  ],
  fillna: (v) => [`df["${v.col}"] = df["${v.col}"].fillna(${v.repr})`],
  dropDup: (subset) => [
    `# subset 指定判重字段，keep="first" 保留首次出现`,
    `df = df.drop_duplicates(subset=${subset}, keep="first")`,
    `df = df.reset_index(drop=True)`,
  ],
  extremes: (col) => [
    `# ① 先定位两个极端值所在的行`,
    `i_max = df["${col}"].idxmax()`,
    `i_min = df["${col}"].idxmin()`,
    `v_max, v_min = df.loc[i_max, "${col}"], df.loc[i_min, "${col}"]`,
    ``,
    `# ② 再按索引删除这两行`,
    `df = df.drop(index=[i_max, i_min])`,
    `df = df.reset_index(drop=True)`,
  ],
  clip: (c) => [`df["${c.col}"] = df["${c.col}"].clip(${c.lo}, ${c.hi})`],
  sort: (c) => [`df = df.sort_values(by="${c.by}", ascending=${c.asc ? 'True' : 'False'})`, `df = df.reset_index(drop=True)`],
  query: (e) => [`# 布尔索引：先算出一个 True/False 序列，再按它取行`, `mask = df.eval("${e}")`, `df = df[mask].reset_index(drop=True)`],
  astype: (c) => [`df["${c.col}"] = df["${c.col}"].astype("${c.dtype}")`],
  assign: (c) => [`df["${c.name}"] = ${c.expr}`],
  rename: (m) => [`df = df.rename(columns=${m})`],
  sample: (n) => [`df = df.sample(n=${n}, random_state=42).reset_index(drop=True)`],
  nlargest: (c) => [`df = df.nlargest(${c.n}, "${c.by}").reset_index(drop=True)`],
  vc: (c) => [`df["${c}"].value_counts()`],
  groupby: (c) => [
    `g = df.groupby("${c.by}")`,
    `df = g.agg(${c.spec})`,
  ],
  agg: (c) => [`df["${c.col}"].${c.fn}()`],
  hist: (c) => [`df["${c.col}"].plot.hist(bins=${c.bins})`],
  bar: (c) => [`df.set_index("${c.x}")["${c.y}"].plot.bar()`],
  line: (c) => [`df.plot.line(x="${c.x}", y="${c.y}")`],
  scatter: (c) => [`df.plot.scatter(x="${c.x}", y="${c.y}")`],
  box: (c) => [`df[["${c.cols.join('", "')}"]].plot.box()`],
  tocsv: () => [`df.to_csv("cleaned.csv", index=False)`],
  dropcol: (c) => [`df = df.drop(columns=${JSON.stringify(c)})`],
};

/* --------------------------- 通用工具 --------------------------- */

/** 目标行集合的舞台“点阵”数据 */
export function dotStrip(df, col, opts = {}) {
  const vals = df.col(col);
  const nums = vals.filter((v) => typeof v === 'number' && Number.isFinite(v));
  const min = opts.min ?? (nums.length ? Math.min(...nums) : 0);
  const max = opts.max ?? (nums.length ? Math.max(...nums) : 1);
  return vals.map((v, i) => ({
    i,
    rid: df._rows[i].rid,
    value: v,
    na: isNA(v),
    t: typeof v === 'number' && max > min ? (v - min) / (max - min) : 0.5,
  }));
}

/** 把一组帧的时长整体缩放 */
export function scaleDuration(script, factor) {
  for (const f of script.frames) f.duration = Math.round(f.duration * factor);
  return script;
}

export const TONE = {
  info: 'info', ok: 'ok', warn: 'warn', danger: 'danger', gold: 'gold', mute: 'mute',
};
