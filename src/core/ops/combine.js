/* ------------------------------------------------------------------
 * ops/combine.js — 合并与重塑
 *  merge / concat / pivot_table / melt / crosstab
 * ------------------------------------------------------------------ */

import { Script, T, CODE } from '../frames.js';
import { L } from '../../i18n/index.js';
import { fmt, isNA } from '../utils.js';
import { makeSpec } from '../datasets.js';
import { ph, pickLabelCol, pickCategoryCol, unitOf, colSummary, assertNumeric, labelOf } from './kit.js';

const F = (S, o) => S.add({
  phase: o.p, title: o.t, narration: o.n,
  duration: o.d ?? 1500, tone: o.tone || 'info',
  code: S.codeAt(o.c ?? 0), table: o.tab, stage: o.st, hud: o.hud, final: o.final,
});

/** 找一个合适的连接键：优先城市/班级/ID 这类列 */
function pickJoinKey(df, other) {
  const common = df.columns.filter((c) => other.columns.includes(c));
  if (!common.length) return null;
  const prefs = ['城市', 'City', '班级', 'Class', '订单号', 'OrderID', '学号', 'StudentID', '品类', 'Category'];
  for (const p of prefs) if (common.includes(p)) return p;
  return common[0];
}

/* ================================================================
 * merge
 * ================================================================ */
export function opMerge(df, cfg = {}) {
  // 优先找「与当前表共享连接键」的内置表；找不到就用 orders ⋈ region 这对经典组合
  const candidates = ['region', 'orders', 'student', 'weather'].filter((id) => id !== df.meta?.specId);
  let left = df, right = null, on = null;
  for (const id of candidates) {
    const cand = makeSpec(id);
    const key = pickJoinKey(df, cand);
    if (key) { right = cand; on = key; break; }
  }
  if (!right) {
    left = makeSpec('orders');
    right = makeSpec('region');
    on = pickJoinKey(left, right);
  }
  const other = right;
  if (cfg.on && left.columns.includes(cfg.on) && other.columns.includes(cfg.on)) on = cfg.on;
  if (!on) throw new Error('merge needs a shared key column');
  const df0 = left;
  df = left;
  const how = cfg.how || 'left';

  const S = new Script(df, 'merge');
  S.code(CODE.merge({ on, how }));

  const li = df.columns.indexOf(on), ri = other.columns.indexOf(on);
  const leftKeys = df.col(on).map((v) => (isNA(v) ? 'NaN' : String(v)));
  const rightKeys = other.col(on).map((v) => (isNA(v) ? 'NaN' : String(v)));
  const rightSet = new Set(rightKeys);
  const matched = leftKeys.map((k) => rightSet.has(k));
  const nMatch = matched.filter(Boolean).length;

  const mergeStage = (cursor, extra = {}) => ({
    kind: 'merge', on, how, cursor, total: df.nrow,
    left: df._rows.map((r, i) => ({
      i, rid: r.rid, key: leftKeys[i], name: labelOf(df, pickLabelCol(df), i), matched: matched[i],
    })),
    right: other._rows.map((r, i) => ({
      i, rid: r.rid, key: rightKeys[i],
      name: other._rows[i].cells[other.columns.indexOf(other.meta?.labelCol && other.columns.includes(other.meta.labelCol) ? other.meta.labelCol : other.columns[0])],
      used: false,
    })),
    ...extra,
  });

  F(S, {
    p: ph('①', '连接的语义', 'What a join means'),
    t: L(`按「${on}」把两张表连接起来`, `Join two frames on "${on}"`),
    n: L(`merge 是横向合并：左表提供明细，右表提供「查表信息」。连接键是 ${on}，左表 ${df.nrow} 行、右表 ${other.nrow} 行。how 参数决定「匹配不上的键怎么处理」，这是 join 的全部难点。`,
      `merge is a horizontal join: the left frame holds detail, the right supplies lookup data. The key is ${on}; the left has ${df.nrow} rows, the right ${other.nrow}. The how parameter decides what happens to unmatched keys — that is the whole difficulty of joins.`),
    d: 2800, c: 0,
    tab: T(df, { cellState: (r, i, name) => (name === on ? 'focus' : null) }),
    st: mergeStage(-1),
    hud: [{ label: L('左表', 'left'), value: `${df.nrow} × ${df.ncol}`, tone: 'cyan' },
      { label: L('右表', 'right'), value: `${other.nrow} × ${other.ncol}`, tone: 'mute' },
      { label: 'how', value: how, tone: 'gold' }],
  });

  F(S, {
    p: ph('②', '匹配键', 'Match the keys'),
    t: L(`${nMatch} / ${df.nrow} 个键在右表里找到了对应`, `${nMatch} of ${df.nrow} keys found a match`),
    n: L(`逐行拿左表的 ${on} 去右表里查找。找到的键会「吸收」右表的那一行信息；找不到的键，就是 how 参数要决定命运的地方。`,
      `Each left-hand ${on} is looked up in the right frame. A hit absorbs that right row's fields; a miss is exactly what the how parameter decides about.`),
    d: 2600, tone: nMatch === df.nrow ? 'ok' : 'warn', c: 1,
    tab: T(df, {
      rowState: (r, i) => (matched[i] ? 'keep' : 'danger'),
      cellState: (r, i, name) => (name === on ? (matched[i] ? 'best' : 'dup') : null),
    }),
    st: mergeStage(df.nrow - 1),
    hud: [{ label: L('命中', 'matched'), value: String(nMatch), tone: 'ok' },
      { label: L('未命中', 'unmatched'), value: String(df.nrow - nMatch), tone: 'danger' }],
  });

  const howExplain = {
    inner: L('inner 只保留两边都能匹配上的键 —— 结果是「交集」。', 'inner keeps only keys present on both sides — the intersection.'),
    left: L('left 保留左表全部行；右表匹配不上时填 NaN —— 这是最常用的连接方式。', 'left keeps every left row, filling NaN when the right has no match — the most common join.'),
    right: L('right 保留右表全部行，左表匹配不上时填 NaN。', 'right keeps every right row, filling NaN when the left has no match.'),
    outer: L('outer 两边都保留，缺失的一侧填 NaN —— 结果是「并集」。', 'outer keeps both sides, filling NaN where either is missing — the union.'),
  };
  F(S, {
    p: ph('③', 'how 的四种选择', 'The four how options'),
    t: L(`how="${how}" · ${how === 'inner' ? '交集' : how === 'outer' ? '并集' : how === 'left' ? '以左表为准' : '以右表为准'}`,
      `how="${how}" · ${how === 'inner' ? 'intersection' : how === 'outer' ? 'union' : how === 'left' ? 'left-driven' : 'right-driven'}`),
    n: L(`${howExplain[how]}换一个 how 值，结果的行数会完全不同 —— 所以连接之后一定要检查行数，这是数据分析里最容易出错的地方之一。`,
      `${howExplain[how]} Change how and the row count changes completely — always check the shape after a join. It is one of the easiest places in data analysis to go wrong.`),
    d: 2800, tone: 'warn', c: 0,
    tab: T(df, { cellState: (r, i, name) => (name === on ? 'focus' : null) }),
    st: mergeStage(-1, { howPanel: true }),
    hud: [{ label: 'inner', value: String(leftKeys.filter((k) => rightSet.has(k)).length), tone: 'mute' },
      { label: 'left', value: String(df.nrow), tone: 'cyan' },
      { label: 'outer', value: String(new Set([...leftKeys, ...rightKeys]).size), tone: 'gold' }],
  });

  const result = df.merge(other, on, how);
  S.use(result);
  const grew = result.ncol - df.ncol;
  F(S, {
    p: ph('④', '结果', 'Result'),
    t: L(`${df.nrow} 行 × ${df.ncol} 列 → ${result.nrow} 行 × ${result.ncol} 列`, `${df.nrow}×${df.ncol} → ${result.nrow}×${result.ncol}`),
    n: L(`左表被「加宽」了 ${grew} 列（来自右表的 ${other.columns.filter((c) => c !== on).join('、')}）。注意行数可能变化：一个键在右表里有多行时，匹配结果会展开成多行 —— 这叫笛卡尔放大，是 join 最常见的陷阱。`,
      `The left frame gained ${grew} column${grew > 1 ? 's' : ''} (${other.columns.filter((c) => c !== on).join(', ')} from the right). Note the row count can change: when a key appears several times on the right, the match expands into several rows — Cartesian blow-up, the classic join trap.`),
    d: 3000, tone: 'ok', c: 1, final: true,
    tab: T(result, { cellState: (r, i, name) => (name === on ? 'best' : other.columns.includes(name) ? 'new' : null) }),
    st: {
      kind: 'compare', title: L(`merge(on="${on}", how="${how}")`, `merge(on="${on}", how="${how}")`),
      before: { shape: [df.nrow, df.ncol], stats: null },
      after: { shape: [result.nrow, result.ncol], stats: null },
      removed: [],
    },
    hud: [{ label: 'shape', value: `${df.nrow}×${df.ncol} → ${result.nrow}×${result.ncol}`, tone: 'ok' },
      { label: L('新增列', 'new cols'), value: String(grew), tone: 'gold' }],
  });

  return { frames: S.frames, result, summary: L(`按 ${on} 做 ${how} 连接（${df.nrow}→${result.nrow} 行）`, `${how} merge on ${on} (${df.nrow}→${result.nrow} rows)`) };
}

/* ================================================================
 * concat
 * ================================================================ */
export function opConcat(df) {
  const S = new Script(df, 'concat');
  S.code(CODE.concat());
  const half = Math.ceil(df.nrow / 2);
  const top = df.head(half);
  const bottom = df.tail(df.nrow - half);
  const result = top.concat(bottom);

  F(S, {
    p: ph('①', '纵向堆叠', 'Stack vertically'),
    t: L(`把表拆成上下两半，再拼回去`, `Split into two halves and stack them back`),
    n: L('concat(axis=0) 是纵向拼接：把多张「列结构相同」的表上下摞起来。它不做匹配、不做对齐，只是把行接在一起 —— 这正是它比 merge 快得多的原因。',
      'concat(axis=0) stacks vertically: several frames with the same columns are piled one under another. There is no matching and no aligning, only appending rows — which is why it is far faster than merge.'),
    d: 2600, c: 0,
    tab: T(df, { rowState: (r, i) => (i < half ? 'focus' : 'dim') }),
    st: {
      kind: 'slice', mode: 'head', n: half, total: df.nrow, cursor: -1, done: true,
      labelCol: pickLabelCol(df), names: df._rows.map((r, i) => labelOf(df, pickLabelCol(df), i)),
    },
    hud: [{ label: L('上半', 'top'), value: `${top.nrow} × ${top.ncol}`, tone: 'cyan' },
      { label: L('下半', 'bottom'), value: `${bottom.nrow} × ${bottom.ncol}`, tone: 'mute' }],
  });

  S.use(result);
  F(S, {
    p: ph('②', '结果', 'Result'),
    t: L(`${top.nrow} + ${bottom.nrow} = ${result.nrow} 行`, `${top.nrow} + ${bottom.nrow} = ${result.nrow} rows`),
    n: L(`行数正好是两段之和，列数不变。ignore_index=True 会把索引重新编号 —— 否则拼接后的索引会重复出现 0…N-1 两次，后续按索引取值就会出错。`,
      `The row count is exactly the sum, columns unchanged. ignore_index=True renumbers the index — otherwise 0…N-1 appears twice after the concat and index-based access breaks.`),
    d: 2600, tone: 'ok', c: 0, final: true,
    tab: T(result, { rowState: (r, i) => (i < top.nrow ? 'normal' : 'keep') }),
    st: {
      kind: 'compare', title: 'concat(axis=0)',
      before: { shape: [df.nrow, df.ncol], stats: null },
      after: { shape: [result.nrow, result.ncol], stats: null },
      removed: [],
    },
    hud: [{ label: 'shape', value: `${df.nrow} → ${result.nrow} rows`, tone: 'ok' }],
  });

  return { frames: S.frames, result, summary: L(`纵向拼接为 ${result.nrow} 行`, `Concatenated to ${result.nrow} rows`) };
}

/* ================================================================
 * pivot_table
 * ================================================================ */
export function opPivot(df, cfg = {}) {
  const indexCol = cfg.index || pickCategoryCol(df);
  const numCols = df.columns.filter((c) => df.dtypes[c] === 'number');
  const valueCol = cfg.values || numCols[0];
  const colCol = cfg.columns && df.columns.includes(cfg.columns) && cfg.columns !== indexCol
    ? cfg.columns
    : (df.columns.filter((c) => c !== indexCol && c !== valueCol && df.dtypes[c] !== 'number')[0] || indexCol);
  const fn = cfg.fn || 'mean';

  const S = new Script(df, 'pivot_table');
  S.code(CODE.pivot({ index: indexCol, columns: colCol, values: valueCol, fn }));

  const ii = df.columns.indexOf(indexCol), ci = df.columns.indexOf(colCol), vi = df.columns.indexOf(valueCol);
  const rowKeys = [], colKeys = [];
  const cells = new Map();
  df._rows.forEach((r) => {
    const rk = isNA(r.cells[ii]) ? 'NaN' : String(r.cells[ii]);
    const ck = isNA(r.cells[ci]) ? 'NaN' : String(r.cells[ci]);
    if (!rowKeys.includes(rk)) rowKeys.push(rk);
    if (!colKeys.includes(ck)) colKeys.push(ck);
    const k = `${rk}\u0001${ck}`;
    if (!cells.has(k)) cells.set(k, []);
    cells.get(k).push(r.cells[vi]);
  });

  const pivotStage = (cursor, extra = {}) => ({
    kind: 'pivot', indexCol, colCol, valueCol, fn, cursor, total: df.nrow,
    rowKeys, colKeys,
    cells: Object.fromEntries([...cells.entries()].map(([k, arr]) => {
      const [rk, ck] = k.split('\u0001');
      const ns = arr.filter((v) => typeof v === 'number' && Number.isFinite(v));
      const agg = fn === 'count' ? arr.length : fn === 'sum' ? ns.reduce((a, b) => a + b, 0)
        : fn === 'max' ? (ns.length ? Math.max(...ns) : null)
          : fn === 'min' ? (ns.length ? Math.min(...ns) : null)
            : ns.length ? ns.reduce((a, b) => a + b, 0) / ns.length : null;
      return [k, { rk, ck, values: arr, agg: typeof agg === 'number' ? Math.round(agg * 100) / 100 : agg }];
    })),
    ...extra,
  });

  F(S, {
    p: ph('①', '三维数据压成二维', 'Fold three dimensions into two'),
    t: L(`index = ${indexCol}，columns = ${colCol}，values = ${valueCol}`, `index = ${indexCol}, columns = ${colCol}, values = ${valueCol}`),
    n: L(`透视表解决的是一个很具体的问题：数据是「长」的（每行一个观测），但你想看的是「交叉汇总」。pivot_table 把 ${indexCol} 放到行、${colCol} 放到列，${valueCol} 填进格子，重叠的地方用 ${fn} 聚合。`,
      `A pivot table answers one concrete need: the data is long (one observation per row) but you want a cross-tabulation. pivot_table puts ${indexCol} on rows, ${colCol} on columns, ${valueCol} into the cells, and aggregates overlaps with ${fn}.`),
    d: 3000, c: 0,
    tab: T(df, { cellState: (r, i, name) => ([indexCol, colCol, valueCol].includes(name) ? 'focus' : 'dim') }),
    st: pivotStage(-1),
    hud: [{ label: L('行键', 'rows'), value: String(rowKeys.length), tone: 'cyan' },
      { label: L('列键', 'cols'), value: String(colKeys.length), tone: 'mute' },
      { label: 'aggfunc', value: fn, tone: 'gold' }],
  });

  F(S, {
    p: ph('②', '逐格聚合', 'Aggregate each cell'),
    t: L(`${rowKeys.length} × ${colKeys.length} = ${rowKeys.length * colKeys.length} 个格子`, `${rowKeys.length} × ${colKeys.length} = ${rowKeys.length * colKeys.length} cells`),
    n: L(`每个格子收集「同时满足行键和列键」的那些行，再对 ${valueCol} 做 ${fn}。空格子表示这个组合在原数据里根本不存在 —— 它会被填成 NaN，而不是 0，这个区别很重要。`,
      `Each cell collects the rows matching both its row key and its column key, then applies ${fn} to ${valueCol}. An empty cell means that combination never occurs in the raw data — it becomes NaN, not 0, and that distinction matters.`),
    d: 2800, tone: 'info', c: 1,
    tab: T(df, { cellState: (r, i, name) => ([indexCol, colCol, valueCol].includes(name) ? 'focus' : 'dim') }),
    st: pivotStage(df.nrow - 1, { computed: true }),
  });

  const result = df.pivotTable(indexCol, colCol, valueCol, fn);
  S.use(result);
  F(S, {
    p: ph('③', '结果', 'Result'),
    t: L(`${df.nrow} 行明细 → ${result.nrow} × ${result.ncol} 汇总`, `${df.nrow} detail rows → ${result.nrow} × ${result.ncol} summary`),
    n: L(`明细被压缩成一张交叉表：行是 ${indexCol} 的取值，列是 ${colCol} 的取值，格子里是 ${valueCol} 的 ${fn}。这张表本身就是最好的分组柱状图素材。`,
      `The detail collapses into a cross-tab: rows are ${indexCol} values, columns are ${colCol} values, cells hold the ${fn} of ${valueCol}. This table is itself ideal material for a grouped bar chart.`),
    d: 3000, tone: 'ok', c: 1, final: true,
    tab: T(result, { cellState: (r, i, name) => (name === indexCol ? null : 'best') }),
    st: pivotStage(df.nrow - 1, { computed: true, done: true }),
    hud: [{ label: 'shape', value: `${df.nrow}×${df.ncol} → ${result.nrow}×${result.ncol}`, tone: 'ok' }],
  });

  return { frames: S.frames, result, summary: L(`透视：${indexCol} × ${colCol} → ${valueCol}.${fn}`, `Pivot: ${indexCol} × ${colCol} → ${fn}(${valueCol})`) };
}

/* ================================================================
 * melt
 * ================================================================ */
export function opMelt(df, cfg = {}) {
  const numCols = df.columns.filter((c) => df.dtypes[c] === 'number');
  const idVars = cfg.idVars && cfg.idVars.length ? cfg.idVars.filter((c) => df.columns.includes(c))
    : [pickLabelCol(df)].filter(Boolean);
  const valueCols = df.columns.filter((c) => !idVars.includes(c) && df.dtypes[c] === 'number').slice(0, 4);
  const S = new Script(df, 'melt');
  S.code(CODE.melt({ idVars }));

  F(S, {
    p: ph('①', '宽表的问题', 'The problem with wide data'),
    t: L(`把 ${valueCols.join('、')} 四列「融化」成两列`, `Melt ${valueCols.join(', ')} into two columns`),
    n: L(`宽表（每列一个变量）适合人看，但不适合机器分析：想画「四个科目的分布对比」，你得写四次代码。melt 把「列名」变成「一个变量的取值」，于是所有科目落在同一列里，一次就能画完。`,
      `Wide data (one column per variable) is easy for humans but awkward for machines: comparing four subjects means writing the same code four times. melt turns column names into values of a single variable, so all subjects land in one column and one chart covers them all.`),
    d: 3000, c: 0,
    tab: T(df, { columns: [...idVars, ...valueCols], cellState: (r, i, name) => (valueCols.includes(name) ? 'focus' : null) }),
    st: {
      kind: 'rename',
      pairs: valueCols.map((c) => ({ from: c, to: L('variable / value', 'variable / value'), done: false })),
    },
    hud: [{ label: L('保留列', 'id_vars'), value: idVars.join(', ') || '—', tone: 'cyan' },
      { label: L('融化列', 'value_vars'), value: String(valueCols.length), tone: 'gold' }],
  });

  const result = df.melt(idVars, 'variable', 'value');
  S.use(result);
  F(S, {
    p: ph('②', '结果', 'Result'),
    t: L(`${df.nrow} 行 × ${df.ncol} 列 → ${result.nrow} 行 × ${result.ncol} 列`, `${df.nrow}×${df.ncol} → ${result.nrow}×${result.ncol}`),
    n: L(`行数变成了原来的 ${valueCols.length} 倍（每行被复制 ${valueCols.length} 次，每次只保留一个变量的值）。列数反而变少了 —— 这就是「宽表转长表」：行变多、列变少，但信息总量完全一样。`,
      `The row count multiplied by ${valueCols.length} (each row is duplicated once per variable, keeping one value each time) while the column count fell. That is wide-to-long: more rows, fewer columns, identical information.`),
    d: 3000, tone: 'ok', c: 0, final: true,
    tab: T(result, {}),
    st: {
      kind: 'compare', title: 'melt()',
      before: { shape: [df.nrow, df.ncol], stats: null },
      after: { shape: [result.nrow, result.ncol], stats: null },
      removed: [],
    },
    hud: [{ label: 'shape', value: `${df.nrow}×${df.ncol} → ${result.nrow}×${result.ncol}`, tone: 'ok' },
      { label: L('放大倍数', 'multiplier'), value: `${valueCols.length}×`, tone: 'gold' }],
  });

  return { frames: S.frames, result, summary: L(`melt 宽表转长表（${result.nrow} 行）`, `Melted to long format (${result.nrow} rows)`) };
}

/* ================================================================
 * crosstab
 * ================================================================ */
export function opCrosstab(df, cfg = {}) {
  const objCols = df.columns.filter((c) => df.dtypes[c] !== 'number');
  const a = cfg.a && df.columns.includes(cfg.a) ? cfg.a : (pickCategoryCol(df) || objCols[0] || df.columns[0]);
  const b = cfg.b && df.columns.includes(cfg.b) && cfg.b !== a ? cfg.b
    : (objCols.find((c) => c !== a) || df.columns.find((c) => c !== a));
  const S = new Script(df, 'crosstab');
  S.code(CODE.crosstab({ a, b }));

  const ai = df.columns.indexOf(a), bi = df.columns.indexOf(b);
  const rowKeys = [], colKeys = [];
  const m = new Map();
  df._rows.forEach((r) => {
    const rk = isNA(r.cells[ai]) ? 'NaN' : String(r.cells[ai]);
    const ck = isNA(r.cells[bi]) ? 'NaN' : String(r.cells[bi]);
    if (!rowKeys.includes(rk)) rowKeys.push(rk);
    if (!colKeys.includes(ck)) colKeys.push(ck);
    const k = `${rk}\u0001${ck}`;
    m.set(k, (m.get(k) || 0) + 1);
  });

  F(S, {
    p: ph('①', '两个分类变量的交叉计数', 'Cross-count two categories'),
    t: L(`${a} × ${b}`, `${a} × ${b}`),
    n: L('crosstab 是「只数个数」的透视表。它不做聚合计算，只回答「同时属于这一行和这一列的样本有多少个」—— 卡方检验、列联表分析都从这里开始。',
      'crosstab is a pivot table that only counts. It performs no aggregation and answers one question: how many samples belong to both this row and this column. Contingency tables and chi-square tests start here.'),
    d: 2800, c: 0,
    tab: T(df, { cellState: (r, i, name) => ([a, b].includes(name) ? 'focus' : 'dim') }),
    st: { kind: 'pivot', indexCol: a, colCol: b, valueCol: L('计数', 'count'), fn: 'count', cursor: -1, total: df.nrow, rowKeys, colKeys, cells: {} },
    hud: [{ label: L('行', 'rows'), value: String(rowKeys.length), tone: 'cyan' },
      { label: L('列', 'cols'), value: String(colKeys.length), tone: 'mute' }],
  });

  const result = df.crosstab(a, b);
  S.use(result);
  const total = df.nrow;
  F(S, {
    p: ph('②', '结果', 'Result'),
    t: L(`${result.nrow} × ${result.ncol - 1} 的列联表`, `A ${result.nrow} × ${result.ncol - 1} contingency table`),
    n: L(`每个格子是计数，全部加起来等于 ${total}。如果某一行或某一列高度集中（比如一个格子占了 80%），说明这两个变量高度相关；如果分布均匀，则说明它们几乎独立。`,
      `Every cell is a count and they sum to ${total}. A row or column dominated by one cell (say 80%) signals a strong association between the two variables; an even spread signals near independence.`),
    d: 3000, tone: 'ok', c: 0, final: true,
    tab: T(result, { cellState: (r, i, name) => (name === a ? null : 'best') }),
    st: { kind: 'pivot', indexCol: a, colCol: b, valueCol: L('计数', 'count'), fn: 'count', cursor: df.nrow - 1, total: df.nrow, rowKeys, colKeys, cells: Object.fromEntries([...m.entries()].map(([k, c]) => {
      const [rk, ck] = k.split('\u0001');
      return [k, { rk, ck, values: [c], agg: c }];
    })), computed: true, done: true },
    hud: [{ label: 'total', value: String(total), tone: 'ok' }],
  });

  return { frames: S.frames, result, summary: L(`${a} × ${b} 交叉表`, `Crosstab ${a} × ${b}`) };
}
