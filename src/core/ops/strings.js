/* ------------------------------------------------------------------
 * ops/strings.js — 字符串处理
 *  str.contains / str.replace / str.split / str.upper / str.len
 * ------------------------------------------------------------------ */

import { Script, T, CODE } from '../frames.js';
import { L } from '../../i18n/index.js';
import { ph, pickLabelCol, pickCategoryCol, labelOf } from './kit.js';

const F = (S, o) => S.add({
  phase: o.p, title: o.t, narration: o.n,
  duration: o.d ?? 1400, tone: o.tone || 'info',
  code: S.codeAt(o.c ?? 0), table: o.tab, stage: o.st, hud: o.hud, final: o.final,
});

/* ---------------- str.contains ---------------- */
export function opStrContains(df, cfg = {}) {
  const col = cfg.col || pickCategoryCol(df);
  const pat = cfg.pat ?? String(df.col(col)[0] ?? '');
  const labelCol = pickLabelCol(df);
  const S = new Script(df, 'str_contains');
  S.code(CODE.strContains({ col, pat }));
  const vals = df.col(col).map((v) => (v === null || v === undefined ? '' : String(v)));
  const mask = vals.map((v) => v.toLowerCase().includes(String(pat).toLowerCase()));
  const passN = mask.filter(Boolean).length;

  F(S, {
    p: ph('①', '子串匹配', 'Substring match'),
    t: L(`在「${col}」里查找 "${pat}"`, `Look for "${pat}" in "${col}"`),
    n: L('str 访问器是 pandas 的字符串命名空间：只有把它加在前面，pandas 才知道你要做的是「文本操作」而不是数值运算。contains 返回布尔序列，na=False 让缺失值直接判为 False，避免整列报错。',
      'The .str accessor is pandas\' string namespace: only with it does pandas know you mean text operations rather than arithmetic. contains returns a boolean Series, and na=False makes missing values count as False instead of raising.'),
    d: 2600, c: 0,
    tab: T(df, { rowState: (r, i) => (mask[i] ? 'keep' : 'dim'), cellState: (r, i, name) => (name === col ? (mask[i] ? 'best' : null) : null) }),
    st: {
      kind: 'mask', col, op: '⊃', value: pat, unit: '', labelCol, expr: `df["${col}"].str.contains("${pat}")`,
      cursor: df.nrow - 1, total: df.nrow,
      entries: df._rows.map((r, i) => ({ i, rid: r.rid, name: labelOf(df, labelCol, i), value: vals[i], pass: mask[i], evaluated: true, na: false })),
    },
    hud: [{ label: 'True', value: String(passN), tone: 'ok' }, { label: 'False', value: String(df.nrow - passN), tone: 'mute' }],
  });

  const result = df.filter((c, i) => mask[i]);
  S.use(result);
  F(S, {
    p: ph('②', '结果', 'Result'),
    t: L(`命中 ${passN} 行`, `${passN} rows matched`),
    n: L('contains 默认是「包含」而不是「等于」，所以短子串也能命中更长的文本。如果只想精确匹配，记得用 ^ 和 $ 锚定并传 regex=False。',
      'By default contains means "includes", not "equals", so a short substring also matches longer text. For exact matches, anchor with ^ and $ and pass regex=False.'),
    d: 2200, tone: 'ok', c: 0, final: true,
    tab: T(result, {}),
    st: { kind: 'compare', before: { shape: [df.nrow, df.ncol], stats: null }, after: { shape: [result.nrow, result.ncol], stats: null }, removed: [] },
    hud: [{ label: 'shape', value: `${df.nrow} → ${result.nrow} rows`, tone: 'ok' }],
  });
  return { frames: S.frames, result, summary: L(`str.contains("${pat}") 命中 ${passN} 行`, `str.contains("${pat}") matched ${passN} rows`) };
}

/* ---------------- str.replace ---------------- */
export function opStrReplace(df, cfg = {}) {
  const col = cfg.col || pickCategoryCol(df);
  const from = cfg.from ?? '';
  const to = cfg.to ?? '';
  const labelCol = pickLabelCol(df);
  const S = new Script(df, 'str_replace');
  S.code(CODE.strReplace({ col, from, to }));
  const before = df.col(col);
  const after = before.map((v) => (v === null || v === undefined ? v : String(v).split(String(from)).join(String(to))));
  const changed = before.map((v, i) => String(v) !== String(after[i]));
  const nChanged = changed.filter(Boolean).length;

  const stage = () => ({
    kind: 'formula', name: col, a: col, b: col, cursor: df.nrow - 1, total: df.nrow,
    entries: df._rows.map((r, i) => ({ i, rid: r.rid, name: labelOf(df, labelCol, i), x: before[i], y: null, out: after[i], done: true })),
  });

  F(S, {
    p: ph('①', '批量替换', 'Bulk replace'),
    t: L(`把「${from}」替换成「${to}」`, `Replace "${from}" with "${to}"`),
    n: L('str.replace 默认按「正则」解释查找内容。想按字面量替换时记得传 regex=False —— 否则 . 或 * 这类字符会被当成正则元字符，这是字符串清洗最常见的坑。',
      'str.replace interprets the pattern as a regex by default. Pass regex=False for literal replacement — otherwise characters like . or * are treated as regex metacharacters, the classic string-cleaning trap.'),
    d: 2600, c: 0,
    tab: T(df, { rowState: (r, i) => (changed[i] ? 'focus' : 'dim'), cellState: (r, i, name) => (name === col ? (changed[i] ? 'scan' : null) : null) }),
    st: stage(),
    hud: [{ label: L('命中', 'changed'), value: `${nChanged} / ${df.nrow}`, tone: 'gold' }],
  });

  const result = df.strOps.replace(df, col, from, to);
  S.use(result);
  F(S, {
    p: ph('②', '结果', 'Result'),
    t: L(`${nChanged} 个单元格被改写`, `${nChanged} cells rewritten`),
    n: L('替换只改内容，不改结构：行数与列数都不变。字符串清洗通常是「先 replace 统一写法，再 astype 转成正确类型」这两步连用。',
      'Replacement changes content, not structure: the shape is identical. String cleaning usually pairs replace (normalise the spelling) with astype (cast to the right type).'),
    d: 2400, tone: 'ok', c: 0, final: true,
    tab: T(result, { cellState: (r, i, name) => (name === col && changed[i] ? 'change' : null) }),
    st: stage(),
    hud: [{ label: 'shape', value: `${result.nrow} × ${result.ncol}`, tone: 'ok' }],
  });
  return { frames: S.frames, result, summary: L(`str.replace("${from}" → "${to}")，改写 ${nChanged} 个单元格`, `str.replace("${from}" → "${to}"), ${nChanged} cells`) };
}

/* ---------------- str.split ---------------- */
export function opStrSplit(df, cfg = {}) {
  const col = cfg.col || pickLabelCol(df);
  const sep = cfg.sep || '-';
  const aName = `${col}_part1`;
  const bName = `${col}_part2`;
  const labelCol = pickLabelCol(df);
  const S = new Script(df, 'str_split');
  S.code(CODE.strSplit({ col, sep, a: aName, b: bName }));
  const ci = df.columns.indexOf(col);
  const parts = df.col(col).map((v) => {
    if (v === null || v === undefined) return [null, null];
    const p = String(v).split(sep);
    return [p[0] ?? null, p.length > 1 ? p.slice(1).join(sep) : null];
  });
  const stage = () => ({
    kind: 'formula', name: `${aName} / ${bName}`, a: col, b: col, cursor: df.nrow - 1, total: df.nrow,
    entries: df._rows.map((r, i) => ({ i, rid: r.rid, name: labelOf(df, labelCol, i), x: r.cells[ci], y: null, out: parts[i][1] ?? parts[i][0], done: true })),
  });

  F(S, {
    p: ph('①', '拆分', 'Split'),
    t: L(`按 "${sep}" 把「${col}」拆成两列`, `Split "${col}" on "${sep}" into two columns`),
    n: L('str.split 把一个字符串列拆成多个部分。expand=True 是关键：它让结果展开成多列而不是一个列表，可以直接赋值给两个新列。常见用途是把「城市-区域」这类组合字段拆开。',
      'str.split breaks a string column into parts. expand=True is the key: it expands the result into separate columns rather than a list, so it can be assigned straight to two new columns. The usual case is splitting a combined field such as "city-region".'),
    d: 2600, c: 0,
    tab: T(df, { cellState: (r, i, name) => (name === col ? 'focus' : null) }),
    st: stage(),
    hud: [{ label: L('新列', 'new cols'), value: '2', tone: 'gold' }],
  });

  const result = df.strOps.split(df, col, sep, aName, bName);
  S.use(result);
  F(S, {
    p: ph('②', '结果', 'Result'),
    t: L(`新增 2 列：${aName}、${bName}`, `Two new columns: ${aName}, ${bName}`),
    n: L('列数 +2，行数不变。拆出来的部分常常需要再 astype 转成数值（比如 "2024-03" 拆出年份后要当数字用）。',
      'Two more columns, same row count. The pieces often need an astype afterwards (splitting "2024-03" into a year you then want as a number).'),
    d: 2400, tone: 'ok', c: 0, final: true,
    tab: T(result, { cellState: (r, i, name) => ([aName, bName].includes(name) ? 'new' : null) }),
    st: stage(),
    hud: [{ label: 'shape', value: `${df.ncol} → ${result.ncol} cols`, tone: 'ok' }],
  });
  return { frames: S.frames, result, summary: L(`str.split("${sep}") 拆出 2 列`, `str.split("${sep}") into 2 columns`) };
}

/* ---------------- str.upper ---------------- */
export function opStrUpper(df, cfg = {}) {
  const col = cfg.col || df.columns.find((c) => df.dtypes[c] !== 'number');
  const S = new Script(df, 'str_upper');
  S.code(CODE.strUpper({ col }));
  const ci = df.columns.indexOf(col);
  const before = df.col(col);
  const after = before.map((v) => (v === null || v === undefined ? v : String(v).toUpperCase()));
  const nChanged = before.filter((v, i) => String(v) !== String(after[i])).length;
  const stage = () => ({
    kind: 'formula', name: col, a: col, b: col, cursor: df.nrow - 1, total: df.nrow,
    entries: df._rows.map((r, i) => ({ i, rid: r.rid, name: labelOf(df, pickLabelCol(df), i), x: before[i], y: null, out: after[i], done: true })),
  });

  F(S, {
    p: ph('①', '大小写规范化', 'Case normalisation'),
    t: L(`把「${col}」统一成大写`, `Upper-case every value in "${col}"`),
    n: L('大小写不统一是文本数据的经典问题：同一个城市写成三种大小写，会被当成三个不同的类别，分组时直接算错。upper / lower / strip 这三个方法几乎出现在每一次真实的数据清洗里。',
      'Inconsistent casing is a classic text problem: one city written three ways counts as three categories and grouping silently goes wrong. upper / lower / strip appear in almost every real cleaning job.'),
    d: 2600, c: 0,
    tab: T(df, { rowState: (r, i) => (String(before[i]) !== String(after[i]) ? 'focus' : 'dim'), cellState: (r, i, name) => (name === col ? 'focus' : null) }),
    st: stage(),
    hud: [{ label: L('改动', 'changed'), value: String(nChanged), tone: 'gold' }],
  });

  const result = df.strOps.upper(df, col);
  S.use(result);
  F(S, {
    p: ph('②', '结果', 'Result'),
    t: L('文本已统一，类别数可能因此减少', 'Text normalised — the category count may now drop'),
    n: L('规范化之后再去 value_counts，你会发现类别数变少了 —— 那些本来只是写法不同的重复类别被合并了。这就是字符串清洗的价值。',
      'Run value_counts after normalising and the category count often falls: duplicates that differed only in spelling have merged. That is the value of string cleaning.'),
    d: 2400, tone: 'ok', c: 0, final: true,
    tab: T(result, { cellState: (r, i, name) => (name === col ? 'change' : null) }),
    st: { kind: 'compare', before: { shape: [df.nrow, df.ncol], stats: null }, after: { shape: [result.nrow, result.ncol], stats: null }, removed: [] },
    hud: [{ label: 'shape', value: `${result.nrow} × ${result.ncol}`, tone: 'ok' }],
  });
  return { frames: S.frames, result, summary: L(`str.upper() 规范化 ${col}`, `str.upper() on ${col}`) };
}

/* ---------------- str.len ---------------- */
export function opStrLen(df, cfg = {}) {
  const col = cfg.col || pickLabelCol(df);
  const name = `${col}_len`;
  const S = new Script(df, 'str_len');
  S.code(CODE.strLen({ col, name }));
  const ci = df.columns.indexOf(col);
  const lens = df.col(col).map((v) => (v === null || v === undefined ? null : String(v).length));

  F(S, {
    p: ph('①', '长度也是特征', 'Length is a feature'),
    t: L(`新增「${name}」：每个文本的字符数`, `Add "${name}": character count per value`),
    n: L('文本长度本身往往就是有用的特征：异常短或异常长的记录经常是脏数据（截断、重复粘贴、编码错误）。str.len 把它变成一列可统计、可筛选的数值。',
      'Text length is often a useful feature in itself: unusually short or long values are frequently dirty data (truncation, double paste, encoding errors). str.len turns it into a numeric column you can analyse and filter.'),
    d: 2600, c: 0,
    tab: T(df, { cellState: (r, i, nm) => (nm === col ? 'focus' : null) }),
    st: {
      kind: 'formula', name, a: col, b: col, cursor: df.nrow - 1, total: df.nrow,
      entries: df._rows.map((r, i) => ({ i, rid: r.rid, name: labelOf(df, pickLabelCol(df), i), x: r.cells[ci], y: null, out: lens[i], done: true })),
    },
    hud: [{ label: L('新列', 'new col'), value: name, tone: 'gold' }],
  });

  const result = df.strOps.len(df, col, name);
  S.use(result);
  F(S, {
    p: ph('②', '结果', 'Result'),
    t: L('列数 +1，行数不变', 'One more column, same rows'),
    n: L('现在可以对这个长度列做 describe 或画直方图：如果出现明显的双峰或长尾，就说明这一列里混着格式不一致的记录。',
      'You can now describe or histogram this length column: an obvious bimodal shape or long tail means the column mixes inconsistent formats.'),
    d: 2400, tone: 'ok', c: 0, final: true,
    tab: T(result, { cellState: (r, i, nm) => (nm === name ? 'new' : null) }),
    st: { kind: 'compare', title: name, col: name, unit: '', before: { shape: [df.nrow, df.ncol], stats: null }, after: { shape: [result.nrow, result.ncol], stats: null }, removed: [] },
    hud: [{ label: 'shape', value: `${df.ncol} → ${result.ncol} cols`, tone: 'ok' }],
  });
  return { frames: S.frames, result, summary: L(`新增文本长度列 ${name}`, `Added text-length column ${name}`) };
}
