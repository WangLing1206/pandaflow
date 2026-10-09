/* ------------------------------------------------------------------
 * ops/transform.js — 变换 / 选择 / 序列运算
 *  排序、筛选、新增列、类型、重命名、抽样、切片、删列
 *  loc / iloc / set_index / select_dtypes / insert / pop / isin
 *  shift / diff / pct_change / cumsum / rolling / rank / cut / where / apply
 * ------------------------------------------------------------------ */

import { Script, T, CODE } from '../frames.js';
import { L } from '../../i18n/index.js';
import { fmt, isNA } from '../utils.js';
import { cmpValues } from '../dataframe.js';
import { ph, pickLabelCol, pickCategoryCol, unitOf, colSummary, domain, assertNumeric, labelOf } from './kit.js';

/* 减少样板代码的小工具 */
const F = (S, o) => S.add({
  phase: o.p, title: o.t, narration: o.n,
  duration: o.d ?? 1400, tone: o.tone || 'info',
  code: S.codeAt(o.c ?? 0), table: o.tab, stage: o.st, hud: o.hud, final: o.final,
});

/* ================================================================
 * sort_values
 * ================================================================ */
export function opSort(df, cfg = {}) {
  const by = cfg.by || df.columns.find((c) => df.dtypes[c] === 'number');
  const asc = cfg.asc !== false;
  const unit = unitOf(df, by);
  const labelCol = pickLabelCol(df);
  const S = new Script(df, 'sort_values');
  S.code(CODE.sort({ by, asc }));
  const vals = df.col(by);

  const arr = df._rows.map((_, i) => i);
  const snapshots = [{ arr: arr.slice(), sortedUpTo: 0, key: null, cmp: 0, moved: 0 }];
  let totalCmp = 0;
  for (let i = 1; i < arr.length; i++) {
    const key = arr[i];
    let j = i - 1, moved = 0;
    while (j >= 0 && (cmpValues(vals[arr[j]], vals[key]) * (asc ? 1 : -1)) > 0) {
      arr[j + 1] = arr[j]; j--; moved++; totalCmp++;
    }
    arr[j + 1] = key; totalCmp++;
    snapshots.push({ arr: arr.slice(), sortedUpTo: i, key, moved, cmp: totalCmp });
  }
  const STEPS = 12;
  const stride = Math.max(1, Math.ceil((snapshots.length - 1) / STEPS));
  const picks = [];
  for (let k = 1; k < snapshots.length; k += stride) picks.push(snapshots[k]);
  if (picks[picks.length - 1] !== snapshots[snapshots.length - 1]) picks.push(snapshots[snapshots.length - 1]);
  const dom = domain(vals);

  const sortStage = (snap) => ({
    kind: 'sort', by, asc, unit, labelCol,
    sortedUpTo: snap.sortedUpTo, total: df.nrow, cursor: snap.key,
    items: snap.arr.map((orig, pos) => ({
      pos, orig, rid: df._rows[orig].rid, name: labelOf(df, labelCol, orig), value: vals[orig],
      t: typeof vals[orig] === 'number' ? (vals[orig] - dom.min) / (dom.max - dom.min) : 0.5,
      sorted: pos <= snap.sortedUpTo, isKey: orig === snap.key,
    })),
  });

  F(S, {
    p: ph('①', '确定排序键', 'Pick the sort key'),
    t: L(`按 ${by} ${asc ? '升序' : '降序'} 排列`, `Sort by ${by} ${asc ? 'ascending' : 'descending'}`),
    n: L(`sort_values 不会修改数据本身，只是重新排列行的顺序。排序键是 ${by} 列。算法的做法是：维护一个「已排好序的左侧区」，从左到右把每个新元素插进正确的位置。`,
      `sort_values does not change the data, only the row order. The key is ${by}. The algorithm keeps a sorted region on the left and inserts each new element into its correct place.`),
    d: 2800, c: 0,
    tab: T(df, { cellState: (r, i, name) => (name === by ? 'focus' : null) }),
    st: sortStage(snapshots[0]),
    hud: [{ label: L('排序键', 'key'), value: by, tone: 'cyan' }, { label: L('方向', 'order'), value: asc ? 'ascending' : 'descending', tone: 'mute' }],
  });

  picks.forEach((snap) => {
    const keyIdx = snap.key;
    const v = vals[keyIdx], moved = snap.moved;
    F(S, {
      p: ph('②', '插入排序', 'Insertion sort'),
      t: moved > 0 ? L(`${labelOf(df, labelCol, keyIdx)} 向前移动了 ${moved} 位`, `${labelOf(df, labelCol, keyIdx)} moves forward ${moved} place${moved > 1 ? 's' : ''}`)
        : L(`${labelOf(df, labelCol, keyIdx)} 已在本位，无需移动`, `${labelOf(df, labelCol, keyIdx)} is already in place`),
      n: moved > 0
        ? L(`取出 ${by}=${fmt(v)}${unit}，它比左边 ${moved} 个元素都${asc ? '小' : '大'}，因此这些元素依次向右让位，直到 ${fmt(v)} 找到位置插进去。已排序区扩展到前 ${snap.sortedUpTo + 1} 个。`,
          `Take ${by}=${fmt(v)}${unit}; it is ${asc ? 'smaller' : 'larger'} than the ${moved} element${moved > 1 ? 's' : ''} to its left, so they shift right until ${fmt(v)} finds its slot. The sorted region grows to ${snap.sortedUpTo + 1}.`)
        : L(`${by}=${fmt(v)}${unit} 恰好不小于左边任何一个元素，原地不动。已排序区扩展到前 ${snap.sortedUpTo + 1} 个。`,
          `${by}=${fmt(v)}${unit} is already in order relative to its left neighbour, so it stays. The sorted region grows to ${snap.sortedUpTo + 1}.`),
      d: moved > 0 ? 1300 : 900, tone: moved > 0 ? 'gold' : 'info',
      tab: T(df, {
        order: snap.arr.map((i) => df._rows[i].rid),
        rowState: (r, i) => (i === keyIdx ? 'focus' : (snap.arr.indexOf(i) <= snap.sortedUpTo ? 'keep' : 'normal')),
        cellState: (r, i, name) => (name === by ? (i === keyIdx ? 'scan' : 'seen') : null),
      }),
      st: sortStage(snap),
      hud: [{ label: L('已排序', 'sorted'), value: `${snap.sortedUpTo + 1}/${df.nrow}`, tone: 'ok' },
        { label: L('比较次数', 'comparisons'), value: String(snap.cmp), tone: 'mute' }],
    });
  });

  const result = df.sortValues(by, asc);
  S.use(result);
  const s = colSummary(result, by);
  const numeric = df.dtypes[by] === 'number' && s.n > 0;
  const first = result.col(by)[0], last = result.col(by)[result.nrow - 1];
  F(S, {
    p: ph('③', '结果', 'Result'),
    t: L(`${by} 已经单调${asc ? '递增' : '递减'}`, `${by} is now monotonic ${asc ? 'increasing' : 'decreasing'}`),
    n: numeric
      ? L(`整列现在完全有序：${fmt(asc ? s.min : s.max)}${unit} 在最上面，${fmt(asc ? s.max : s.min)}${unit} 在最下面。有序之后，取 Top-N、找中位数、绘制累计曲线都会变得非常直接。`,
        `The column is fully ordered: ${fmt(asc ? s.min : s.max)}${unit} at the top, ${fmt(asc ? s.max : s.min)}${unit} at the bottom. Once sorted, Top-N, medians and cumulative curves all become trivial.`)
      : L(`整列现在完全有序：${fmt(first)} 在最上面，${fmt(last)} 在最下面。字符串列按字典序排列，这让「按类别归拢数据」变得直观。`,
        `The column is fully ordered: ${fmt(first)} first, ${fmt(last)} last. String columns sort lexicographically, which makes grouping by category obvious.`),
    d: 2400, tone: 'ok', c: 1, final: true,
    tab: T(result, { cellState: (r, i, name) => (name === by ? 'best' : null) }),
    st: numeric
      ? { kind: 'sortedbars', by, unit, labelCol, values: result.col(by), labels: result._rows.map((r, i) => labelOf(result, labelCol, i)) }
      : { kind: 'compare', before: { shape: [df.nrow, df.ncol], stats: null }, after: { shape: [result.nrow, result.ncol], stats: null }, removed: [] },
    hud: numeric
      ? [{ label: 'min', value: fmt(asc ? s.min : s.max) + unit, tone: 'cyan' },
        { label: 'max', value: fmt(asc ? s.max : s.min) + unit, tone: 'rose' },
        { label: L('比较次数', 'comparisons'), value: String(totalCmp), tone: 'mute' }]
      : [{ label: L('首行', 'first'), value: fmt(first), tone: 'cyan' }, { label: L('末行', 'last'), value: fmt(last), tone: 'cyan' }],
  });

  return { frames: S.frames, result, summary: L(`按 ${by} ${asc ? '升序' : '降序'}排序`, `Sorted by ${by} ${asc ? 'asc' : 'desc'}`) };
}

/* ================================================================
 * sort_index
 * ================================================================ */
export function opSortIndex(df) {
  const S = new Script(df, 'sort_index');
  S.code(CODE.sortIndex());
  F(S, {
    p: ph('①', '索引排序', 'Sort by index'),
    t: L('按索引值重新排列行', 'Reorder rows by index value'),
    n: L('sort_index 排的是索引而不是数据。当前索引是 0…N-1 的自然顺序，所以结果与原来一致 —— 但在做过筛选、删除、拼接之后，索引往往是乱序的，这时它就能把行「拉回」原始顺序。',
      'sort_index sorts by the index rather than the data. The index here is the natural 0…N-1 sequence, so nothing moves — but after filtering, dropping or concatenating the index is usually scrambled, and this puts rows back in order.'),
    d: 2600, c: 0,
    tab: T(df, { cellState: (r, i, name) => (name === df.columns[0] ? 'focus' : null) }),
    st: { kind: 'slice', mode: 'head', n: Math.min(df.nrow, 12), total: df.nrow, cursor: -1, done: true, labelCol: pickLabelCol(df), names: df._rows.map((r, i) => labelOf(df, pickLabelCol(df), i)) },
  });
  F(S, {
    p: ph('②', '结果', 'Result'),
    t: L('索引回到升序', 'Index is ascending again'),
    n: L('排序后每一行的相对顺序与索引值一致，后续用 iloc 按位置取值就不会错位。',
      'Rows now follow index order, so positional iloc access can no longer be off by one.'),
    d: 2000, tone: 'ok', c: 1, final: true,
    tab: T(df, {}),
    st: { kind: 'compare', before: { shape: [df.nrow, df.ncol], stats: null }, after: { shape: [df.nrow, df.ncol], stats: null }, removed: [] },
  });
  return { frames: S.frames, result: df, summary: L('按索引排序', 'Sorted by index') };
}

/* ================================================================
 * query
 * ================================================================ */
export function opQuery(df, cfg = {}) {
  const col = cfg.col || df.columns.find((c) => df.dtypes[c] === 'number');
  const op = cfg.op || '>';
  const s0 = colSummary(df, col);
  const value = cfg.value ?? Math.round(s0.mean);
  const unit = unitOf(df, col);
  const labelCol = pickLabelCol(df);
  const S = new Script(df, 'query');

  const test = (v) => {
    if (typeof v !== 'number' || !Number.isFinite(v)) return false;
    switch (op) {
      case '>': return v > value; case '>=': return v >= value;
      case '<': return v < value; case '<=': return v <= value;
      case '==': return v === value; case '!=': return v !== value;
      default: return false;
    }
  };
  const expr = `${col} ${op} ${fmt(value)}`;
  S.code(CODE.query(expr));
  const values = df.col(col);
  const mask = values.map(test);
  const ci = df.columns.indexOf(col);
  const passN = mask.filter(Boolean).length;

  const maskStage = (cursor, extra = {}) => ({
    kind: 'mask', col, op, value, unit, labelCol, expr, cursor, total: df.nrow,
    entries: df._rows.map((r, i) => ({
      i, rid: r.rid, name: labelOf(df, labelCol, i), value: values[i],
      pass: mask[i] || false, evaluated: cursor < 0 ? false : i <= cursor, na: isNA(values[i]),
    })),
    ...extra,
  });

  F(S, {
    p: ph('①', '把条件翻译成掩码', 'Turn the condition into a mask'),
    t: L(`条件：${expr}`, `Condition: ${expr}`),
    n: L('pandas 的筛选分两步走。第一步是「翻译」：把条件作用到整列上，得到一个与行数等长的 True/False 序列，称为布尔掩码。它只是判断，还没有动数据。',
      'Filtering happens in two steps. First, translation: apply the condition to the whole column to get a True/False sequence as long as the frame — a boolean mask. It only judges; nothing has moved yet.'),
    d: 2800, c: 0,
    tab: T(df, { cellState: (r, i, name) => (name === col ? 'focus' : null) }),
    st: maskStage(-1),
    hud: [{ label: 'shape', value: `${df.nrow} × ${df.ncol}`, tone: 'mute' }, { label: 'expr', value: expr, tone: 'cyan' }],
  });

  const CHUNK = 6;
  for (let i = 0; i < df.nrow; i += CHUNK) {
    const end = Math.min(i + CHUNK, df.nrow);
    const nPass = mask.slice(i, end).filter(Boolean).length;
    F(S, {
      p: ph('②', '逐行判定', 'Judge row by row'),
      t: L(`第 ${i + 1}–${end} 行：${nPass} 个 True / ${end - i - nPass} 个 False`, `Rows ${i + 1}–${end}: ${nPass} True / ${end - i - nPass} False`),
      n: L(`把这一段的值逐个与 ${fmt(value)}${unit} 比较：${nPass ? `命中 ${mask.slice(i, end).map((p, k) => (p ? labelOf(df, labelCol, i + k) : null)).filter(Boolean).join('、')}。` : '本段全部不满足条件。'}判定结果只写在掩码里，原表纹丝不动。`,
        `Compare each value here against ${fmt(value)}${unit}: ${nPass ? `${mask.slice(i, end).map((p, k) => (p ? labelOf(df, labelCol, i + k) : null)).filter(Boolean).join(', ')} pass.` : 'none pass in this block.'} The verdict lives only in the mask — the frame is untouched.`),
      d: 1000, tone: nPass ? 'ok' : 'mute', c: 1,
      tab: T(df, {
        rowState: (r, j) => (j >= i && j < end ? 'focus' : (j < i ? (mask[j] ? 'keep' : 'dim') : 'normal')),
        cellState: (r, j, name) => (name === col ? (mask[j] ? 'best' : 'dim') : null),
      }),
      st: maskStage(end - 1),
      hud: [{ label: 'checked', value: `${end}/${df.nrow}`, tone: 'cyan' }, { label: 'True', value: String(mask.slice(0, end).filter(Boolean).length), tone: 'ok' }],
    });
  }

  F(S, {
    p: ph('③', '按掩码取行', 'Select with the mask'),
    t: L(`${passN} 个 True · ${df.nrow - passN} 个 False`, `${passN} True · ${df.nrow - passN} False`),
    n: L(`掩码计算完毕：${passN} 行为 True 保留，${df.nrow - passN} 行为 False 丢弃。df[mask] 就是「拿着这张名单去点名」。`,
      `The mask is ready: ${passN} rows are True and stay, ${df.nrow - passN} are False and go. df[mask] is just roll-call with that list.`),
    d: 2200, tone: 'ok', c: 2,
    tab: T(df, { rowState: (r, j) => (mask[j] ? 'keep' : 'danger'), cellState: (r, j, name) => (name === col ? (mask[j] ? 'best' : 'dim') : null) }),
    st: maskStage(df.nrow - 1, { marking: true }),
  });

  const result = df.filter((cells) => test(cells[ci]));
  S.use(result);
  F(S, {
    p: ph('④', '结果', 'Result'),
    t: L(`筛选完成 · ${df.nrow} 行 → ${result.nrow} 行`, `Filtered · ${df.nrow} rows → ${result.nrow}`),
    n: L(`结果表里只剩下满足 ${expr} 的 ${result.nrow} 行。索引保留了原表中的编号（断层是正常的），若要连续编号记得 reset_index。`,
      `Only the ${result.nrow} rows satisfying ${expr} remain. The index keeps the original numbering (gaps are expected); call reset_index if you want it continuous.`),
    d: 2400, tone: 'ok', c: 2, final: true,
    tab: T(result, { cellState: (r, i, name) => (name === col ? 'best' : null) }),
    st: {
      kind: 'compare', title: L(`query · ${expr}`, `query · ${expr}`), col, unit,
      before: { shape: [df.nrow, df.ncol], stats: colSummary(df, col), hist: df.hist(col, 12) },
      after: { shape: [result.nrow, result.ncol], stats: colSummary(result, col), hist: result.hist(col, 12) },
      removed: [],
    },
    hud: [{ label: L('保留率', 'kept'), value: `${(result.nrow / df.nrow * 100).toFixed(0)}%`, tone: 'ok' },
      { label: 'shape', value: `${df.nrow}×${df.ncol} → ${result.nrow}×${result.ncol}`, tone: 'ok' }],
  });

  return { frames: S.frames, result, summary: L(`筛选 ${expr}`, `Filtered ${expr}`) };
}

/* ================================================================
 * assign —— 新增计算列
 * ================================================================ */
export function opAssign(df, cfg = {}) {
  const labelCol = pickLabelCol(df);
  const numCols = df.columns.filter((c) => df.dtypes[c] === 'number');
  const a = cfg.a || numCols[0], b = cfg.b || numCols[1] || numCols[0];
  const name = cfg.name || `${a}_ratio`;
  const S = new Script(df, 'assign');
  S.code(CODE.assign({ name, expr: `df["${a}"] / (df["${a}"] + df["${b}"]) * 100` }));
  const ai = df.columns.indexOf(a), bi = df.columns.indexOf(b);
  const computed = df._rows.map((r) => {
    const x = r.cells[ai], y = r.cells[bi];
    if (typeof x !== 'number' || typeof y !== 'number' || x + y === 0) return null;
    return Math.round((x / (x + y) * 100) * 100) / 100;
  });
  const stage = (cursor) => ({
    kind: 'formula', name, a, b, cursor, total: df.nrow,
    entries: df._rows.map((r, i) => ({
      i, rid: r.rid, name: labelOf(df, labelCol, i),
      x: r.cells[ai], y: r.cells[bi], out: computed[i], done: cursor < 0 ? false : i <= cursor,
    })),
  });

  F(S, {
    p: ph('①', '定义计算规则', 'Define the rule'),
    t: L(`新增列「${name}」`, `New column "${name}"`),
    n: L(`pandas 里新增列不需要建表，直接赋值即可。右边的表达式会对 ${a} 列的每一个元素执行 —— ${a} 占 (${a}+${b}) 的百分比。注意表达式是「逐元素」运算，不是对整个列算一次。`,
      `Adding a column in pandas needs no schema change — just assign. The expression on the right runs for every element of ${a}: its share of (${a}+${b}). Note this is element-wise, not one calculation for the whole column.`),
    d: 2800, c: 0,
    tab: T(df, { cellState: (r, i, x) => (x === a || x === b ? 'focus' : null) }),
    st: stage(-1),
    hud: [{ label: L('新列', 'new col'), value: name, tone: 'gold' },
      { label: 'shape', value: `${df.nrow} × ${df.ncol} → ${df.nrow} × ${df.ncol + 1}`, tone: 'ok' }],
  });

  const CHUNK = 5;
  for (let i = 0; i < df.nrow; i += CHUNK) {
    const end = Math.min(i + CHUNK, df.nrow);
    const sample = [];
    for (let k = i; k < Math.min(i + 2, end); k++) if (computed[k] !== null) sample.push(`${computed[k]}`);
    F(S, {
      p: ph('②', '逐元素求值', 'Evaluate element-wise'),
      t: L(`第 ${i + 1}–${end} 行 · 计算新列`, `Rows ${i + 1}–${end} · compute`),
      n: L(`对这一段每一行套用公式：${a} ÷ (${a} + ${b}) × 100${sample.length ? `，例如得到 ${sample.join('、')}` : ''}。新列在表格最右侧逐格生长出来。`,
        `Apply the formula to each row here: ${a} ÷ (${a} + ${b}) × 100${sample.length ? `, giving ${sample.join(', ')}` : ''}. The new column grows cell by cell at the right edge.`),
      d: 1000, c: 0,
      tab: T(df, {
        columns: df.columns.concat([name]),
        rowState: (r, j) => (j >= i && j < end ? 'focus' : (j < i ? 'dim' : 'normal')),
        cellState: (r, j, nm) => (nm === name ? (j < end ? 'new' : null) : null),
      }),
      st: stage(end - 1),
    });
  }

  const result = df.assign(name, (cells) => {
    const x = cells[ai], y = cells[bi];
    if (typeof x !== 'number' || typeof y !== 'number' || x + y === 0) return null;
    return Math.round((x / (x + y) * 100) * 100) / 100;
  });
  S.use(result);
  const rs = colSummary(result, name);
  F(S, {
    p: ph('③', '结果', 'Result'),
    t: L(`新列「${name}」已就位`, `"${name}" is in place`),
    n: L(`表格从 ${df.ncol} 列变成 ${result.ncol} 列，行数一条没少。新列可以直接参与后续的排序、筛选、分组 —— 这就是「特征工程」在 pandas 里最朴素的样子。`,
      `The frame goes from ${df.ncol} to ${result.ncol} columns with no rows lost. The new column can be sorted, filtered and grouped immediately — this is feature engineering in its plainest pandas form.`),
    d: 2600, tone: 'ok', c: 0, final: true,
    tab: T(result, { cellState: (r, i, nm) => (nm === name ? 'new' : null) }),
    st: { kind: 'compare', title: L(`新增列 · ${name}`, `New column · ${name}`), col: name, unit: '%', before: { shape: [df.nrow, df.ncol], stats: null }, after: { shape: [result.nrow, result.ncol], stats: rs, hist: result.hist(name, 12) }, removed: [] },
    hud: [{ label: 'mean', value: fmt(rs.mean) + '%', tone: 'cyan' }, { label: 'std', value: fmt(rs.std), tone: 'mute' },
      { label: 'shape', value: `${df.ncol} → ${result.ncol} cols`, tone: 'ok' }],
  });

  return { frames: S.frames, result, summary: L(`新增计算列 ${name}`, `Added computed column ${name}`) };
}

/* ================================================================
 * astype
 * ================================================================ */
export function opAstype(df, cfg = {}) {
  const col = cfg.col || pickLabelCol(df) || df.columns[0];
  const target = cfg.dtype || (df.dtypes[col] === 'number' ? 'string' : 'float64');
  const labelCol = pickLabelCol(df);
  const S = new Script(df, 'astype');
  S.code(CODE.astype({ col, dtype: target }));
  const ci = df.columns.indexOf(col);
  const convert = (v) => {
    if (isNA(v)) return null;
    if (target === 'string' || target === 'object') return String(v);
    if (target === 'int64') return Math.trunc(Number(v));
    return Number(v);
  };
  const from = df.dtypes[col];
  const stage = (cursor, done) => ({
    kind: 'dtype', col, from, to: target, cursor,
    entries: df._rows.map((r, i) => ({ i, name: labelOf(df, labelCol, i), before: r.cells[ci], after: convert(r.cells[ci]), done })),
  });

  F(S, {
    p: ph('①', '为什么要换类型', 'Why change dtype'),
    t: L(`${col}：${from} → ${target}`, `${col}: ${from} → ${target}`),
    n: (target === 'string' || target === 'object')
      ? L('dtype 决定了 pandas 能对这一列做什么。转成 object 后它就不再参与数值运算，而是作为分类标签使用 —— 比如用于 groupby 分组。',
        'dtype decides what pandas can do with a column. As object it stops taking part in arithmetic and becomes a category label — the thing you group by.')
      : L('dtype 决定了 pandas 能对这一列做什么。转成数值后，它才能被求和、求均值、参与计算。常见场景是从 CSV 读进来的「带单位数字」需要洗成纯数字。',
        'dtype decides what pandas can do with a column. Only as a number can it be summed, averaged and computed on. The classic case: numbers read from CSV that still carry units.'),
    d: 2600, c: 0,
    tab: T(df, { cellState: (r, i, name) => (name === col ? 'focus' : null) }),
    st: stage(-1, false),
  });

  const CHUNK = 6;
  for (let i = 0; i < df.nrow; i += CHUNK) {
    const end = Math.min(i + CHUNK, df.nrow);
    F(S, {
      p: ph('②', '逐值转换', 'Convert each value'),
      t: L(`第 ${i + 1}–${end} 行完成转换`, `Rows ${i + 1}–${end} converted`),
      n: L(`每个值按类型规则重新解释并写回：${df._rows.slice(i, end).slice(0, 3).map((r) => `${fmt(r.cells[ci])} → ${fmt(convert(r.cells[ci]))}`).join('，')} … 转换只改变解释方式，不改变可见内容（除非发生截断）。`,
        `Each value is reinterpreted and written back: ${df._rows.slice(i, end).slice(0, 3).map((r) => `${fmt(r.cells[ci])} → ${fmt(convert(r.cells[ci]))}`).join(', ')} … Only the interpretation changes, not the visible content (unless truncation occurs).`),
      d: 950, c: 0,
      tab: T(df, {
        rowState: (r, j) => (j >= i && j < end ? 'focus' : (j < i ? 'dim' : 'normal')),
        cellState: (r, j, name) => (name === col && j < end ? 'change' : null),
      }),
      st: stage(end - 1, false),
    });
  }

  const result = df.astype(col, target);
  S.use(result);
  F(S, {
    p: ph('③', '结果', 'Result'),
    t: L(`${col} 现在是 ${target}`, `${col} is now ${target}`),
    n: L(`df["${col}"].dtype 已经变为 ${target}。在真实项目里，这一步常常决定了后面 groupby 能不能正确分组、数学运算会不会报错。`,
      `df["${col}"].dtype is now ${target}. In real projects this single step decides whether groupby groups correctly and whether arithmetic raises.`),
    d: 2200, tone: 'ok', c: 0, final: true,
    tab: T(result, { cellState: (r, i, name) => (name === col ? 'new' : null) }),
    st: stage(df.nrow - 1, true),
    hud: [{ label: 'dtype', value: `${from} → ${target}`, tone: 'ok' }],
  });

  return { frames: S.frames, result, summary: L(`将 ${col} 转换为 ${target}`, `Cast ${col} to ${target}`) };
}

/* ================================================================
 * rename
 * ================================================================ */
export function opRename(df, cfg = {}) {
  const S = new Script(df, 'rename');
  const map = cfg.map || {};
  const entries = Object.entries(map).filter(([k, v]) => k && v);
  if (!entries.length) throw new Error('rename needs at least one column mapping');
  S.code(CODE.rename(JSON.stringify(map)));
  F(S, {
    p: ph('①', '设定映射', 'Set the mapping'),
    t: L(`重命名 ${entries.length} 个字段`, `Rename ${entries.length} column${entries.length > 1 ? 's' : ''}`),
    n: L(`原始列名往往带有空格、括号、中文单位，直接写代码容易出错。rename 用字典做一次性替换：${entries.map(([k, v]) => `${k} → ${v}`).join('，')}。`,
      `Raw column names often carry spaces, brackets or units, which makes code brittle. rename takes a dict and swaps them in one go: ${entries.map(([k, v]) => `${k} → ${v}`).join(', ')}.`),
    d: 2400, c: 0,
    tab: T(df, { cellState: (r, i, name) => (map[name] ? 'focus' : null) }),
    st: { kind: 'rename', pairs: entries.map(([k, v]) => ({ from: k, to: v, done: false })) },
  });
  entries.forEach(([k, v], n) => {
    F(S, {
      p: ph('②', '逐个替换', 'Replace one by one'),
      t: L(`${k} → ${v}`, `${k} → ${v}`),
      n: L(`列名被改写为「${v}」。注意 rename 只改名字，列里的数据一个字节都没动。`,
        `The column is renamed to "${v}". rename touches only the name — not a single value changes.`),
      d: 850, tone: 'gold', c: 0,
      tab: T(df, {
        columns: df.columns.map((c) => (c === k ? v : (entries.slice(0, n).some(([kk]) => kk === c) ? map[c] : c))),
        cellState: (r, i, name) => (name === v ? 'new' : null),
      }),
      st: { kind: 'rename', pairs: entries.map(([kk, vv], m) => ({ from: kk, to: vv, done: m <= n })) },
    });
  });
  const result = df.rename(map);
  S.use(result);
  F(S, {
    p: ph('③', '结果', 'Result'),
    t: L('列名焕然一新，数据原封不动', 'New names, identical data'),
    n: L(`现在可以用 df["${entries[0][1]}"] 直接访问这一列了。规范化的列名是让后续管道可维护的关键一步。`,
      `You can now reach the column as df["${entries[0][1]}"]. Normalised names are what keeps a pipeline maintainable.`),
    d: 2200, tone: 'ok', c: 0, final: true,
    tab: T(result, { cellState: (r, i, name) => (entries.some(([, v]) => v === name) ? 'new' : null) }),
    st: { kind: 'rename', pairs: entries.map(([k, v]) => ({ from: k, to: v, done: true })), done: true },
    hud: [{ label: 'shape', value: `${result.nrow} × ${result.ncol}`, tone: 'ok' }],
  });
  return { frames: S.frames, result, summary: L(`重命名 ${entries.length} 个字段`, `Renamed ${entries.length} columns`) };
}

/* ================================================================
 * sample
 * ================================================================ */
export function opSample(df, cfg = {}) {
  const n = Math.min(cfg.n || Math.max(5, Math.round(df.nrow * 0.3)), df.nrow);
  const seed = cfg.seed ?? 42;
  const labelCol = pickLabelCol(df);
  const S = new Script(df, 'sample');
  S.code(CODE.sample(n));
  const picked = [];
  {
    const arr = df._rows.map((_, i) => i);
    let s = seed >>> 0;
    const rand = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
    for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
    picked.push(...arr.slice(0, n));
  }
  const pickSet = new Set(picked);
  const stage = (cursor, extra = {}) => ({
    kind: 'sample', n, seed, labelCol, cursor, total: df.nrow,
    entries: df._rows.map((r, i) => ({
      i, rid: r.rid, name: labelOf(df, labelCol, i),
      picked: pickSet.has(i), revealed: cursor < 0 ? false : picked.indexOf(i) <= cursor && pickSet.has(i),
      order: picked.indexOf(i),
    })),
    ...extra,
  });

  F(S, {
    p: ph('①', '抽样的意义', 'Why sample'),
    t: L(`从 ${df.nrow} 行中随机抽取 ${n} 行`, `Draw ${n} of ${df.nrow} rows at random`),
    n: L(`数据太大时，先抽样观察比全量分析更高效；抽样也用于交叉验证划分。random_state=${seed} 表示随机种子固定，同一份数据每次抽出的结果都一样 —— 这是让实验可复现的关键。`,
      `With large data, inspecting a sample beats analysing everything; sampling also builds cross-validation splits. random_state=${seed} fixes the seed so the same data always yields the same sample — the key to reproducible experiments.`),
    d: 2800, c: 0,
    tab: T(df, { rowState: () => 'dim' }),
    st: stage(-1),
    hud: [{ label: 'n', value: String(n), tone: 'cyan' }, { label: 'random_state', value: String(seed), tone: 'mute' }],
  });

  const CHUNK = 3;
  for (let c = 0; c < picked.length; c += CHUNK) {
    const end = Math.min(c + CHUNK, picked.length);
    const names = picked.slice(c, end).map((i) => labelOf(df, labelCol, i));
    F(S, {
      p: ph('②', '逐个抽取', 'Draw one by one'),
      t: L(`第 ${c + 1}–${end} 个样本：${names.join('、')}`, `Samples ${c + 1}–${end}: ${names.join(', ')}`),
      n: L(`随机数发生器依次命中这些行。被抽中的行立即高亮 —— 每一行被选中的概率都是均等的 ${(n / df.nrow * 100).toFixed(1)}%。`,
        `The random generator lands on these rows in turn. They light up immediately — every row has the same ${(n / df.nrow * 100).toFixed(1)}% chance.`),
      d: 1000, tone: 'gold', c: 0,
      tab: T(df, { rowState: (r, i) => (pickSet.has(i) ? (picked.indexOf(i) < end ? 'keep' : 'dim') : 'dim') }),
      st: stage(end - 1),
      hud: [{ label: 'drawn', value: `${end}/${n}`, tone: 'cyan' }],
    });
  }

  const result = df.filter((c, i) => pickSet.has(i));
  S.use(result);
  F(S, {
    p: ph('③', '结果', 'Result'),
    t: L(`抽样完成 · ${n} 行样本`, `Sampled · ${n} rows`),
    n: L(`未抽中的行被丢弃。样本量只有原来的 ${(n / df.nrow * 100).toFixed(0)}%，但统计特征（均值、分布形态）与总体基本一致 —— 这正是抽样有价值的原因。`,
      `Unpicked rows are dropped. The sample is only ${(n / df.nrow * 100).toFixed(0)}% of the whole, yet its statistics (mean, shape) track the population closely — that is why sampling works.`),
    d: 2400, tone: 'ok', c: 0, final: true,
    tab: T(result, {}),
    st: stage(n - 1, { done: true }),
    hud: [{ label: 'shape', value: `${df.nrow}×${df.ncol} → ${result.nrow}×${result.ncol}`, tone: 'ok' }],
  });
  return { frames: S.frames, result, summary: L(`随机抽取 ${n} 行（seed=${seed}）`, `Sampled ${n} rows (seed=${seed})`) };
}

/* ================================================================
 * head / tail
 * ================================================================ */
export function opHeadTail(df, cfg = {}) {
  const n = Math.min(cfg.n || 5, df.nrow);
  const isTail = cfg.tail === true;
  const S = new Script(df, isTail ? 'tail' : 'head');
  S.code(isTail ? CODE.tail(n) : CODE.head(n));
  const keepFrom = isTail ? df.nrow - n : 0;
  const keepTo = isTail ? df.nrow : n;
  const labelCol = pickLabelCol(df);
  const sliceStage = (cursor, extra = {}) => ({
    kind: 'slice', mode: isTail ? 'tail' : 'head', n, total: df.nrow, cursor, labelCol,
    names: df._rows.map((r, i) => labelOf(df, labelCol, i)), ...extra,
  });

  F(S, {
    p: ph('①', '快速预览', 'Quick preview'),
    t: L(`${isTail ? 'tail' : 'head'}(${n}) · 只看${isTail ? '末尾' : '开头'} ${n} 行`, `${isTail ? 'tail' : 'head'}(${n}) · just the ${isTail ? 'last' : 'first'} ${n} rows`),
    n: L(`拿到新数据集的第一件事永远是「先看一眼」。${isTail ? 'tail' : 'head'}(${n}) 不等价于分析，它只是确认：列名对不对、数值有没有单位混入、缺失值长什么样。这一步能避免后面 90% 的返工。`,
      `The first thing you do with any new dataset is look at it. ${isTail ? 'tail' : 'head'}(${n}) is not analysis — it confirms the column names, whether units leaked into numbers, and what the gaps look like. It prevents 90% of later rework.`),
    d: 2600, c: 0,
    tab: T(df, {}),
    st: sliceStage(-1),
  });

  F(S, {
    p: ph('②', '标出截取区间', 'Mark the slice'),
    t: L(`${isTail ? '最后' : '前'} ${n} 行被选中`, `The ${isTail ? 'last' : 'first'} ${n} rows are selected`),
    n: L(`索引 ${keepFrom}–${keepTo - 1} 共 ${n} 行会被保留，其余 ${df.nrow - n} 行进入预览之外的「未显示」状态 —— 注意它们并没有被删除。`,
      `Index ${keepFrom}–${keepTo - 1} (${n} rows) will be kept; the other ${df.nrow - n} become "not shown" — note they are not deleted.`),
    d: 2000, tone: 'gold', c: 0,
    tab: T(df, { rowState: (r, i) => (i >= keepFrom && i < keepTo ? 'focus' : 'dim') }),
    st: sliceStage(keepTo - 1),
    hud: [{ label: L('保留', 'kept'), value: `${n}`, tone: 'ok' }, { label: L('未显示', 'hidden'), value: `${df.nrow - n}`, tone: 'mute' }],
  });

  const result = isTail ? df.tail(n) : df.head(n);
  S.use(result);
  F(S, {
    p: ph('③', '结果', 'Result'),
    t: L(`预览：${result.nrow} 行 × ${result.ncol} 列`, `Preview: ${result.nrow} × ${result.ncol}`),
    n: L(`这就是 head/tail 的返回物 —— 一个只有 ${n} 行的新 DataFrame。它是副本，修改它不会影响原始 df。`,
      `This is what head/tail returns: a new DataFrame of just ${n} rows. It is a copy — editing it leaves the original df alone.`),
    d: 2200, tone: 'ok', c: 0, final: true,
    tab: T(result, {}),
    st: sliceStage(-1, { done: true }),
    hud: [{ label: 'shape', value: `${df.nrow}×${df.ncol} → ${result.nrow}×${result.ncol}`, tone: 'ok' }],
  });
  return { frames: S.frames, result, summary: L(`${isTail ? 'tail' : 'head'}(${n}) 预览`, `${isTail ? 'tail' : 'head'}(${n}) preview`) };
}

/* ================================================================
 * drop columns
 * ================================================================ */
export function opDropColumns(df, cfg = {}) {
  const names = (cfg.columns && cfg.columns.length) ? cfg.columns : [df.columns[df.columns.length - 1]];
  const S = new Script(df, 'drop');
  S.code(CODE.dropcol(names));
  F(S, {
    p: ph('①', '确定要删的列', 'Choose the columns'),
    t: L(`删除字段：${names.join('、')}`, `Drop columns: ${names.join(', ')}`),
    n: L('有些列对分析毫无贡献（常量列、重复列、隐私字段），留着只会增加噪声与内存。drop(columns=[...]) 是纵向的减法。',
      'Some columns contribute nothing — constants, duplicates, private fields. Keeping them only adds noise and memory. drop(columns=[...]) is subtraction along the width.'),
    d: 2200, c: 0,
    tab: T(df, { cellState: (r, i, name) => (names.includes(name) ? 'danger' : null) }),
    st: { kind: 'dropcols', names, total: df.columns.length, removed: [] },
  });
  const result = df.dropColumns(names);
  S.use(result);
  F(S, {
    p: ph('②', '整列摘除', 'Remove the columns'),
    t: L(`列数 ${df.ncol} → ${result.ncol}`, `${df.ncol} → ${result.ncol} columns`),
    n: L('注意与 dropna 的区别：drop(columns=...) 减的是「宽」，dropna 减的是「高」。行数完全不变。',
      'Contrast with dropna: drop(columns=...) reduces width, dropna reduces height. Row count is untouched.'),
    d: 1800, tone: 'warn', c: 0,
    tab: T(result, {}),
    st: { kind: 'dropcols', names, total: result.ncol, removed: names, done: true },
    hud: [{ label: 'shape', value: `${df.nrow}×${df.ncol} → ${result.nrow}×${result.ncol}`, tone: 'ok' }],
  });
  F(S, {
    p: ph('③', '结果', 'Result'),
    t: L('表变窄了，行一条没少', 'Narrower, same height'),
    n: L(`现在有 ${result.ncol} 个字段，剩下的列全部是分析真正用得到的。`,
      `${result.ncol} columns remain — all of them actually used by the analysis.`),
    d: 2000, tone: 'ok', c: 0, final: true,
    tab: T(result, {}),
    st: { kind: 'dropcols', names, total: result.ncol, removed: names, done: true },
    hud: [{ label: 'shape', value: `${result.nrow} × ${result.ncol}`, tone: 'ok' }],
  });
  return { frames: S.frames, result, summary: L(`删除字段 ${names.join('、')}`, `Dropped ${names.join(', ')}`) };
}

/* ================================================================
 * loc / iloc —— 定位取子集
 * ================================================================ */
export function opLoc(df, cfg = {}) {
  const r0 = Math.max(0, Math.min(cfg.r0 ?? 5, df.nrow - 1));
  const r1 = Math.max(r0 + 1, Math.min(cfg.r1 ?? r0 + 6, df.nrow));
  const cols = (cfg.cols && cfg.cols.length) ? cfg.cols.filter((c) => df.columns.includes(c)) : df.columns.slice(0, Math.min(4, df.ncol));
  const S = new Script(df, 'loc');
  S.code(CODE.loc({ rows: `${r0}:${r1}`, cols }));
  const idxs = [];
  for (let i = r0; i < r1; i++) idxs.push(i);

  F(S, {
    p: ph('①', 'loc 按标签定位', 'loc selects by label'),
    t: L(`取索引 ${r0}–${r1 - 1} 的 ${cols.join('、')}`, `Rows at index ${r0}–${r1 - 1}, columns ${cols.join(', ')}`),
    n: L('loc 是「标签索引」：它的区间是闭区间（含右端点），而且认的是索引的值，不是位置。做过筛选之后索引会断号，这时 loc 依然能按真实索引取值。',
      'loc is label-based: its slice is inclusive on both ends and it addresses index values, not positions. After filtering leaves gaps in the index, loc still resolves the real labels.'),
    d: 2600, c: 0,
    tab: T(df, {
      columns: cols,
      rowState: (r, i) => (idxs.includes(i) ? 'focus' : 'dim'),
    }),
    st: {
      kind: 'slice', mode: 'head', n: r1, total: df.nrow, cursor: -1, done: true,
      labelCol: pickLabelCol(df), names: df._rows.map((r, i) => labelOf(df, pickLabelCol(df), i)),
    },
  });

  const result = df.loc(idxs, cols);
  S.use(result);
  F(S, {
    p: ph('②', '结果', 'Result'),
    t: L(`切出 ${result.nrow} × ${result.ncol} 的子表`, `Sub-frame of ${result.nrow} × ${result.ncol}`),
    n: L(`loc 返回的是视图语义的子集，索引原样保留（${r0}…${r1 - 1}）。这就是为什么之后常常要 reset_index —— 否则子表的索引和位置对不上。`,
      `loc returns a subset that keeps the original index (${r0}…${r1 - 1}). That is exactly why reset_index usually follows — otherwise labels and positions disagree.`),
    d: 2200, tone: 'ok', c: 0, final: true,
    tab: T(result, {}),
    st: { kind: 'compare', before: { shape: [df.nrow, df.ncol], stats: null }, after: { shape: [result.nrow, result.ncol], stats: null }, removed: [] },
    hud: [{ label: 'shape', value: `${df.nrow}×${df.ncol} → ${result.nrow}×${result.ncol}`, tone: 'ok' }],
  });
  return { frames: S.frames, result, summary: L(`loc 取索引 ${r0}:${r1}、列 ${cols.length} 个`, `loc rows ${r0}:${r1}, ${cols.length} columns`) };
}

export function opIloc(df, cfg = {}) {
  const r0 = Math.max(0, Math.min(cfg.r0 ?? 0, df.nrow - 1));
  const r1 = Math.max(r0 + 1, Math.min(cfg.r1 ?? 6, df.nrow));
  const c0 = Math.max(0, Math.min(cfg.c0 ?? 0, df.ncol - 1));
  const c1 = Math.max(c0 + 1, Math.min(cfg.c1 ?? 3, df.ncol));
  const S = new Script(df, 'iloc');
  S.code(CODE.iloc({ r0, r1, c0, c1 }));
  const cols = [];
  for (let c = c0; c < c1; c++) cols.push(df.columns[c]);
  const idxs = [];
  for (let i = r0; i < r1; i++) idxs.push(i);

  F(S, {
    p: ph('①', 'iloc 按位置定位', 'iloc selects by position'),
    t: L(`第 ${r0}–${r1 - 1} 行 × 第 ${c0}–${c1 - 1} 列`, `Rows ${r0}–${r1 - 1} × columns ${c0}–${c1 - 1}`),
    n: L('iloc 是「位置索引」：它只认第几行第几列，完全无视索引的值。而且它是半开区间 —— iloc[0:3] 取的是 0、1、2 三行，这一点和 loc 相反，也是新手最常踩的坑。',
      'iloc is positional: it addresses the nth row and nth column and ignores index values entirely. Its slice is half-open — iloc[0:3] gives rows 0, 1, 2 — the opposite of loc, and the most common beginner trap.'),
    d: 2800, c: 0,
    tab: T(df, {
      columns: cols,
      rowState: (r, i) => (idxs.includes(i) ? 'focus' : 'dim'),
    }),
    st: {
      kind: 'slice', mode: 'head', n: r1, total: df.nrow, cursor: -1, done: true,
      labelCol: pickLabelCol(df), names: df._rows.map((r, i) => labelOf(df, pickLabelCol(df), i)),
    },
    hud: [{ label: 'loc', value: L('闭区间', 'inclusive'), tone: 'cyan' }, { label: 'iloc', value: L('半开区间', 'half-open'), tone: 'gold' }],
  });

  const result = df.iloc(r0, r1, c0, c1);
  S.use(result);
  F(S, {
    p: ph('②', '结果', 'Result'),
    t: L(`切出 ${result.nrow} × ${result.ncol} 的子表`, `Sub-frame of ${result.nrow} × ${result.ncol}`),
    n: L('因为 iloc 只看位置，所以即使索引是乱的，取出来的永远是「第几行」的那几行 —— 这让它在循环里比 loc 更安全。',
      'Because iloc only sees position, it always returns the nth rows even when the index is scrambled — which makes it safer than loc inside loops.'),
    d: 2200, tone: 'ok', c: 0, final: true,
    tab: T(result, {}),
    st: { kind: 'compare', before: { shape: [df.nrow, df.ncol], stats: null }, after: { shape: [result.nrow, result.ncol], stats: null }, removed: [] },
    hud: [{ label: 'shape', value: `${df.nrow}×${df.ncol} → ${result.nrow}×${result.ncol}`, tone: 'ok' }],
  });
  return { frames: S.frames, result, summary: L(`iloc 取第 ${r0}:${r1} 行、第 ${c0}:${c1} 列`, `iloc rows ${r0}:${r1}, cols ${c0}:${c1}`) };
}

/* ================================================================
 * set_index / reset_index
 * ================================================================ */
export function opSetIndex(df, cfg = {}) {
  const col = cfg.col || pickLabelCol(df);
  const S = new Script(df, 'set_index');
  S.code(CODE.setIndex({ col }));
  F(S, {
    p: ph('①', '为什么要设索引', 'Why set an index'),
    t: L(`把「${col}」设为索引`, `Set "${col}" as the index`),
    n: L('默认索引只是 0…N-1 的行号，它不携带信息。把业务主键（学号、订单号、日期）设为索引之后，loc 就能用「有意义的键」取值，而不是靠猜第几行。',
      'The default index is just a row number 0…N-1 and carries no information. Promote a business key (ID, order number, date) to the index and loc can address rows by something meaningful instead of guessing positions.'),
    d: 2600, c: 0,
    tab: T(df, { cellState: (r, i, name) => (name === col ? 'focus' : null) }),
    st: { kind: 'rename', pairs: [{ from: L('行号 0…N-1', 'row number 0…N-1'), to: col, done: false }] },
  });
  const result = df.setIndex(col);
  S.use(result);
  F(S, {
    p: ph('②', '结果', 'Result'),
    t: L(`索引现在是「${col}」`, `The index is now "${col}"`),
    n: L('注意：列数没有减少（这一列仍然保留在表里），但 pandas 会把它标记为索引列，后续 reset_index 可以把它还原成普通列。',
      'Note the column count does not shrink — the column stays in the frame, but pandas marks it as the index, and reset_index can demote it back to a normal column.'),
    d: 2200, tone: 'ok', c: 0, final: true,
    tab: T(result, { cellState: (r, i, name) => (name === col ? 'new' : null) }),
    st: { kind: 'rename', pairs: [{ from: L('行号', 'row number'), to: col, done: true }], done: true },
    hud: [{ label: 'index', value: col, tone: 'ok' }],
  });
  return { frames: S.frames, result, summary: L(`将 ${col} 设为索引`, `Set ${col} as index`) };
}

export function opResetIndex(df) {
  const S = new Script(df, 'reset_index');
  S.code(CODE.resetIndex());
  F(S, {
    p: ph('①', '缝合索引', 'Stitch the index'),
    t: L(`当前索引：${df._rows.length ? `0…${df.nrow - 1}` : '空'}`, `Current index: 0…${Math.max(0, df.nrow - 1)}`),
    n: L('经过筛选、删除、拼接之后，索引往往带着断层。reset_index(drop=True) 把索引丢弃并重新编号 0…N-1，让「位置」和「标签」重新一致。',
      'After filtering, dropping or concatenating, the index usually carries gaps. reset_index(drop=True) discards it and renumbers 0…N-1 so position and label agree again.'),
    d: 2400, c: 0,
    tab: T(df, {}),
    st: {
      kind: 'slice', mode: 'head', n: Math.min(df.nrow, 16), total: df.nrow, cursor: -1, done: true,
      labelCol: pickLabelCol(df), names: df._rows.map((r, i) => labelOf(df, pickLabelCol(df), i)),
    },
  });
  F(S, {
    p: ph('②', '结果', 'Result'),
    t: L('索引连续，行数与列数都不变', 'Continuous index, same shape'),
    n: L('reset_index 只改索引，不改数据。它是「删除类操作」之后的标准收尾动作。',
      'reset_index changes only the index, never the data. It is the standard closing move after any dropping operation.'),
    d: 2000, tone: 'ok', c: 0, final: true,
    tab: T(df, {}),
    st: { kind: 'compare', before: { shape: [df.nrow, df.ncol], stats: null }, after: { shape: [df.nrow, df.ncol], stats: null }, removed: [] },
  });
  return { frames: S.frames, result: df, summary: L('重置索引为 0…N-1', 'Reset index to 0…N-1') };
}

/* ================================================================
 * select_dtypes
 * ================================================================ */
export function opSelectDtypes(df, cfg = {}) {
  const dtype = cfg.dtype || 'number';
  const S = new Script(df, 'select_dtypes');
  S.code(CODE.selectDtypes({ dtype }));
  const keep = df.columns.filter((c) => (dtype === 'number' ? df.dtypes[c] === 'number' : df.dtypes[c] !== 'number'));
  F(S, {
    p: ph('①', '按类型筛选列', 'Filter columns by dtype'),
    t: L(`只保留 ${dtype === 'number' ? '数值列' : '非数值列'}`, `Keep only ${dtype === 'number' ? 'numeric' : 'non-numeric'} columns`),
    n: L('当表里有几十列时，一列一列挑太慢。select_dtypes 按「类型」成批筛选：include=["number"] 一次拿到所有数值列，用于后续的数值计算与统计。',
      'With dozens of columns, picking them one by one is slow. select_dtypes filters in bulk by type: include=["number"] grabs every numeric column at once, ready for arithmetic and statistics.'),
    d: 2400, c: 0,
    tab: T(df, { cellState: (r, i, name) => (keep.includes(name) ? 'focus' : 'dim') }),
    st: { kind: 'dropcols', names: df.columns.filter((c) => !keep.includes(c)), total: df.columns.length, removed: [] },
  });
  const result = df.selectDtypes(dtype);
  S.use(result);
  F(S, {
    p: ph('②', '结果', 'Result'),
    t: L(`留下 ${result.ncol} 列，去掉 ${df.ncol - result.ncol} 列`, `${result.ncol} kept, ${df.ncol - result.ncol} dropped`),
    n: L(`结果里只剩 ${result.ncol} 个${dtype === 'number' ? '数值' : '非数值'}字段，行数一条没变。注意它返回的是新表，原 df 不受影响。`,
      `Only ${result.ncol} ${dtype === 'number' ? 'numeric' : 'non-numeric'} fields remain and no rows changed. Note it returns a new frame — the original df is untouched.`),
    d: 2200, tone: 'ok', c: 0, final: true,
    tab: T(result, {}),
    st: { kind: 'dropcols', names: df.columns.filter((c) => !keep.includes(c)), total: result.ncol, removed: df.columns.filter((c) => !keep.includes(c)), done: true },
    hud: [{ label: 'shape', value: `${df.ncol} → ${result.ncol} cols`, tone: 'ok' }],
  });
  return { frames: S.frames, result, summary: L(`按类型筛出 ${result.ncol} 列`, `Kept ${result.ncol} columns by dtype`) };
}

/* ================================================================
 * insert / pop
 * ================================================================ */
export function opInsert(df, cfg = {}) {
  const numCols = df.columns.filter((c) => df.dtypes[c] === 'number');
  const src = cfg.src || numCols[0];
  const name = cfg.name || `${src}_x2`;
  const pos = cfg.pos ?? 0;
  const labelCol = pickLabelCol(df);
  const S = new Script(df, 'insert');
  S.code(CODE.insert({ pos, name, expr: `df["${src}"] * 2` }));
  const si = df.columns.indexOf(src);
  const computed = df._rows.map((r) => (typeof r.cells[si] === 'number' ? r.cells[si] * 2 : null));

  F(S, {
    p: ph('①', '在指定位置插入列', 'Insert at a position'),
    t: L(`在第 ${pos} 列位置插入「${name}」`, `Insert "${name}" at position ${pos}`),
    n: L('assign 只能把新列加到最右边；insert 可以指定插入位置，让列的顺序保持可读。它同样不改变行数。',
      'assign can only append to the far right; insert lets you choose the position so column order stays readable. It also leaves the row count alone.'),
    d: 2400, c: 0,
    tab: T(df, { cellState: (r, i, x) => (x === src ? 'focus' : null) }),
    st: { kind: 'formula', name, a: src, b: src, cursor: -1, total: df.nrow, entries: df._rows.map((r, i) => ({ i, rid: r.rid, name: labelOf(df, labelCol, i), x: r.cells[si], y: null, out: computed[i], done: false })) },
  });

  const result = df.insert(pos, name, (cells) => {
    const v = cells[si];
    return typeof v === 'number' ? Math.round(v * 2 * 100) / 100 : null;
  });
  S.use(result);
  F(S, {
    p: ph('②', '结果', 'Result'),
    t: L(`列数 ${df.ncol} → ${result.ncol}`, `${df.ncol} → ${result.ncol} columns`),
    n: L(`新列出现在第 ${pos} 个位置，行数依旧是 ${result.nrow}。用 loc 按列名取值时，列的顺序并不影响结果，但人读代码时会舒服很多。`,
      `The new column lands at position ${pos} and the row count is still ${result.nrow}. Column order does not change loc results, but it makes the code far easier to read.`),
    d: 2200, tone: 'ok', c: 0, final: true,
    tab: T(result, { cellState: (r, i, nm) => (nm === name ? 'new' : null) }),
    st: { kind: 'compare', before: { shape: [df.nrow, df.ncol], stats: null }, after: { shape: [result.nrow, result.ncol], stats: null }, removed: [] },
    hud: [{ label: 'shape', value: `${result.nrow} × ${result.ncol}`, tone: 'ok' }],
  });
  return { frames: S.frames, result, summary: L(`插入列 ${name}`, `Inserted column ${name}`) };
}

export function opPop(df, cfg = {}) {
  const col = cfg.col || df.columns[df.columns.length - 1];
  const S = new Script(df, 'pop');
  S.code(CODE.pop({ col }));
  const ci = df.columns.indexOf(col);
  F(S, {
    p: ph('①', 'pop 的特别之处', 'What makes pop special'),
    t: L(`弹出「${col}」`, `Pop "${col}"`),
    n: L('drop(columns=[...]) 只是把列丢掉，丢掉的东西就找不回来了。pop 不一样：它在删除的同时把这一列作为 Series 返回 —— 一举两得，常用于「把标签列取出来单独使用」。',
      'drop(columns=[...]) discards columns for good. pop is different: it removes the column and returns it as a Series at the same time — handy for pulling a label column out for separate use.'),
    d: 2600, c: 0,
    tab: T(df, { cellState: (r, i, name) => (name === col ? 'danger' : null) }),
    st: {
      kind: 'rank', col, unit: unitOf(df, col), n: Math.min(8, df.nrow), largest: true,
      dom: domain(df.col(col)),
      points: [],
      ranked: df.col(col).slice(0, 8).map((v, i) => ({ i, name: labelOf(df, pickLabelCol(df), i), v })),
      threshold: undefined,
    },
  });
  const popped = df.popCol(col);
  const result = popped.df;
  S.use(result);
  F(S, {
    p: ph('②', '结果', 'Result'),
    t: L(`表少了 1 列，同时拿到一个长度 ${popped.series.length} 的 Series`, `One column less, plus a Series of length ${popped.series.length}`),
    n: L(`列数从 ${df.ncol} 变成 ${result.ncol}，而弹出的数据（前 5 个值：${popped.series.slice(0, 5).map((v) => fmt(v)).join('、')}）现在作为一个独立的 Series 存在于变量里。`,
      `Columns go from ${df.ncol} to ${result.ncol}, and the popped data (first five: ${popped.series.slice(0, 5).map((v) => fmt(v)).join(', ')}) now lives in its own Series variable.`),
    d: 2400, tone: 'ok', c: 0, final: true,
    tab: T(result, {}),
    st: { kind: 'compare', before: { shape: [df.nrow, df.ncol], stats: null }, after: { shape: [result.nrow, result.ncol], stats: null }, removed: [] },
    hud: [{ label: 'shape', value: `${df.ncol} → ${result.ncol} cols`, tone: 'ok' }],
  });
  return { frames: S.frames, result, summary: L(`弹出列 ${col}`, `Popped column ${col}`) };
}

/* ================================================================
 * isin
 * ================================================================ */
export function opIsin(df, cfg = {}) {
  const col = cfg.col || pickCategoryCol(df);
  const ci = df.columns.indexOf(col);
  const uniq = [...new Set(df.col(col).map(String))];
  const values = (cfg.values && cfg.values.length) ? cfg.values : uniq.slice(0, Math.min(2, uniq.length));
  const labelCol = pickLabelCol(df);
  const S = new Script(df, 'isin');
  S.code(CODE.isin({ col, values }));
  const set = new Set(values.map(String));
  const mask = df._rows.map((r) => set.has(String(r.cells[ci])));
  const passN = mask.filter(Boolean).length;

  F(S, {
    p: ph('①', '成员判断', 'Membership test'),
    t: L(`${col} ∈ {${values.join('、')}}`, `${col} ∈ {${values.join(', ')}}`),
    n: L('isin 回答的是「这个值在不在给定的集合里」。它比写一长串 == 加 or 清楚得多，而且在类别很多时性能更好 —— 内部用的是集合查找。',
      'isin asks "is this value in the given set?". It beats a long chain of == or or, and scales better when there are many categories — internally it is a set lookup.'),
    d: 2600, c: 0,
    tab: T(df, {
      rowState: (r, i) => (mask[i] ? 'keep' : 'dim'),
      cellState: (r, i, name) => (name === col ? (mask[i] ? 'best' : null) : null),
    }),
    st: {
      kind: 'mask', col, op: '∈', value: values.join('/'), unit: '', labelCol, expr: `df["${col}"].isin(${JSON.stringify(values)})`,
      cursor: df.nrow - 1, total: df.nrow,
      entries: df._rows.map((r, i) => ({ i, rid: r.rid, name: labelOf(df, labelCol, i), value: r.cells[ci], pass: mask[i], evaluated: true, na: false })),
    },
    hud: [{ label: 'True', value: String(passN), tone: 'ok' }, { label: 'False', value: String(df.nrow - passN), tone: 'mute' }],
  });

  const result = df.isin(col, values);
  S.use(result);
  F(S, {
    p: ph('②', '结果', 'Result'),
    t: L(`筛出 ${result.nrow} 行`, `${result.nrow} rows selected`),
    n: L(`isin 通常和「筛选」连用：先按集合选出目标行，再做后续处理。它也可以配合 ~ 取反（不在集合里）。`,
      'isin usually pairs with filtering: select the target rows by set, then process. Negate it with ~ to get the rows outside the set.'),
    d: 2200, tone: 'ok', c: 0, final: true,
    tab: T(result, { cellState: (r, i, name) => (name === col ? 'best' : null) }),
    st: { kind: 'compare', before: { shape: [df.nrow, df.ncol], stats: null }, after: { shape: [result.nrow, result.ncol], stats: null }, removed: [] },
    hud: [{ label: 'shape', value: `${df.nrow}×${df.ncol} → ${result.nrow}×${result.ncol}`, tone: 'ok' }],
  });
  return { frames: S.frames, result, summary: L(`筛选 ${col} ∈ {${values.join('、')}}`, `Filtered ${col} ∈ {${values.join(', ')}}`) };
}

/* ================================================================
 * 序列运算：shift / diff / pct_change / cumsum / rolling / rank / cut / where / apply / round
 * ================================================================ */
function seriesOp(opts) {
  return function (df, cfg = {}) {
    const col = cfg.col || df.columns.find((c) => df.dtypes[c] === 'number');
    const unit = unitOf(df, col);
    const labelCol = pickLabelCol(df);
    const S = new Script(df, opts.id);
    const ctx = opts.build(df, col, cfg, { unit, labelCol });
    S.code(CODE[opts.codeKey](ctx.codeArgs));

    const stage = (cursor, extra = {}) => ({
      kind: 'formula', name: ctx.name, a: col, b: col, cursor, total: df.nrow,
      entries: df._rows.map((r, i) => ({
        i, rid: r.rid, name: labelOf(df, labelCol, i),
        x: df._rows[i].cells[df.columns.indexOf(col)], y: null,
        out: ctx.values[i], done: cursor < 0 ? false : i <= cursor,
      })),
      ...extra,
    });

    F(S, {
      p: ph('①', '规则', 'The rule'),
      t: ctx.title, n: ctx.intro, d: 2800, c: 0,
      tab: T(df, { cellState: (r, i, name) => (name === col ? 'focus' : null) }),
      st: stage(-1),
      hud: ctx.hud || [],
    });

    const CHUNK = 5;
    for (let i = 0; i < df.nrow; i += CHUNK) {
      const end = Math.min(i + CHUNK, df.nrow);
      F(S, {
        p: ph('②', '逐行计算', 'Row by row'),
        t: L(`第 ${i + 1}–${end} 行`, `Rows ${i + 1}–${end}`),
        n: ctx.stepNarration(i, end),
        d: 950, c: 0,
        tab: T(df, {
          columns: df.columns.concat([ctx.name]),
          rowState: (r, j) => (j >= i && j < end ? 'focus' : (j < i ? 'dim' : 'normal')),
          cellState: (r, j, nm) => (nm === ctx.name ? (j < end ? 'new' : null) : null),
        }),
        st: stage(end - 1),
        hud: ctx.hud || [],
      });
    }

    const result = ctx.result;
    S.use(result);
    F(S, {
      p: ph('③', '结果', 'Result'),
      t: ctx.doneTitle, n: ctx.doneNarration, d: 2600, tone: 'ok', c: 0, final: true,
      tab: T(result, { cellState: (r, i, nm) => (nm === ctx.name ? 'new' : null) }),
      st: { kind: 'compare', title: ctx.name, col: ctx.name, unit: '', before: { shape: [df.nrow, df.ncol], stats: null }, after: { shape: [result.nrow, result.ncol], stats: colSummary(result, ctx.name), hist: result.hist(ctx.name, 12) }, removed: [] },
      hud: ctx.doneHud || [],
    });

    return { frames: S.frames, result, summary: ctx.summary };
  };
}

export const opShift = seriesOp({
  id: 'shift', codeKey: 'shift',
  build(df, col, cfg) {
    const periods = cfg.periods ?? 1;
    const name = `${col}_shift${periods}`;
    const values = df.col(col).map((v, i) => (i - periods >= 0 ? df.col(col)[i - periods] : null));
    return {
      name, values, codeArgs: { col, periods, name },
      title: L(`向下平移 ${periods} 行`, `Shift down by ${periods}`),
      intro: L('shift 把整列向下挪若干行，腾出来的位置填 NaN。它最常见的用途是「让今天的值和昨天的值出现在同一行」，从而可以逐行相减或比较。',
        'shift moves the column down by n rows and leaves NaN behind. Its most common use is putting today\'s value and yesterday\'s value on the same row so they can be compared or subtracted.'),
      stepNarration: (i, end) => L(`第 ${i + 1}–${end} 行取的是上方第 ${periods} 行的值；最前面 ${periods} 行没有上方的值，因此是 NaN。`,
        `Rows ${i + 1}–${end} take the value ${periods} row${periods > 1 ? 's' : ''} above; the first ${periods} rows have nothing above them and become NaN.`),
      doneTitle: L(`已生成「${name}」`, `"${name}" created`),
      doneNarration: L(`新列与原列错开 ${periods} 行，NaN 的数量正好是 ${periods} —— 这是 shift 的标志性特征。`,
        `The new column is offset by ${periods} row${periods > 1 ? 's' : ''}, with exactly ${periods} NaN at the top — the signature of shift.`),
      summary: L(`将 ${col} 平移 ${periods} 行`, `Shifted ${col} by ${periods}`),
      result: df.shift(col, periods),
    };
  },
});

export const opDiff = seriesOp({
  id: 'diff', codeKey: 'diff',
  build(df, col, cfg) {
    const periods = cfg.periods ?? 1;
    const name = `${col}_diff`;
    const src = df.col(col);
    const values = src.map((v, i) => {
      const j = i - periods;
      if (j < 0 || typeof v !== 'number' || typeof src[j] !== 'number') return null;
      return Math.round((v - src[j]) * 1e6) / 1e6;
    });
    return {
      name, values, codeArgs: { col, periods, name },
      title: L(`逐行差分（间隔 ${periods}）`, `Difference (lag ${periods})`),
      intro: L('diff 计算「本行减上一行」。原始数值的绝对大小常常没有意义，但它的变化量（增量、日环比）往往才是真正要看的东西。',
        'diff computes this row minus the previous row. Absolute levels often mean little; the change — growth, day-over-day movement — is usually what matters.'),
      stepNarration: (i, end) => L(`第 ${i + 1}–${end} 行：当前值减去上方第 ${periods} 行的值。第一行没有前值，结果为 NaN。`,
        `Rows ${i + 1}–${end}: current value minus the value ${periods} row${periods > 1 ? 's' : ''} above. The first row has no predecessor, so it is NaN.`),
      doneTitle: L(`差分列「${name}」已生成`, `Difference column "${name}" created`),
      doneNarration: L(`差分把「水平」变成了「变化」。正值表示上升、负值表示下降 —— 折线图上它对应的是斜率。`,
        'Differencing turns levels into changes: positive means rising, negative means falling — on a line chart it is the slope.'),
      summary: L(`对 ${col} 做差分`, `Differenced ${col}`),
      result: df.diff(col, periods),
    };
  },
});

export const opPctChange = seriesOp({
  id: 'pct_change', codeKey: 'pctChange',
  build(df, col) {
    const name = `${col}_pct`;
    const src = df.col(col);
    const values = src.map((v, i) => {
      const j = i - 1;
      if (j < 0 || typeof v !== 'number' || typeof src[j] !== 'number' || src[j] === 0) return null;
      return Math.round((v - src[j]) / src[j] * 10000) / 100;
    });
    return {
      name, values, codeArgs: { col, name },
      title: L('计算环比变化率', 'Percent change'),
      intro: L('pct_change 就是 (本期 − 上期) / 上期 × 100。与 diff 的区别在于它做了归一化：100 涨到 110 和 10 涨到 11 都是 +10%，可比性更强。',
        'pct_change is (this − previous) / previous × 100. Unlike diff it normalises: 100→110 and 10→11 are both +10%, which makes different scales comparable.'),
      stepNarration: (i, end) => L(`第 ${i + 1}–${end} 行：(当前 − 上一行) ÷ 上一行 × 100。分母为 0 或缺失时返回 NaN。`,
        `Rows ${i + 1}–${end}: (current − previous) ÷ previous × 100. A zero or missing denominator yields NaN.`),
      doneTitle: L(`变化率列「${name}」已生成`, `Change column "${name}" created`),
      doneNarration: L('结果以百分比表示：+5 表示比上一行高了 5%。用直方图看这一列，就能一眼找到「异常跳变」的那些行。',
        'The result is a percentage: +5 means 5% above the previous row. A histogram of this column immediately reveals the abnormal jumps.'),
      summary: L(`计算 ${col} 的变化率`, `Percent change of ${col}`),
      result: df.pctChange(col),
    };
  },
});

export const opCumsum = seriesOp({
  id: 'cumsum', codeKey: 'cumsum',
  build(df, col) {
    const name = `${col}_cumsum`;
    const src = df.col(col);
    let acc = 0;
    const values = src.map((v) => {
      if (typeof v === 'number' && Number.isFinite(v)) acc += v;
      return Math.round(acc * 1e6) / 1e6;
    });
    return {
      name, values, codeArgs: { col, name },
      title: L('累加求和', 'Cumulative sum'),
      intro: L('cumsum 把「每一行的值」变成「到这里为止的总和」。它天然适合回答「前 N 名贡献了多少」这类问题 —— 也是帕累托图（80/20 分析）的基础。',
        'cumsum turns each row value into the running total up to that row. It answers questions like "how much have the top N contributed" and underpins Pareto (80/20) analysis.'),
      stepNarration: (i, end) => L(`累加到第 ${end} 行：当前累计 ${fmt(values[end - 1])}。每加一个值，累计线上就抬高一格。`,
        `Accumulated through row ${end}: running total ${fmt(values[end - 1])}. Each new value lifts the cumulative curve one step.`),
      doneTitle: L(`累计列「${name}」已生成`, `Cumulative column "${name}" created`),
      doneNarration: L(`最后一行等于整列的 sum —— 这也是检查累加是否算对的快捷方法。折线图上它是一条单调上升的曲线。`,
        `The last row equals the column sum — a quick way to verify the accumulation. On a line chart it is a monotonically rising curve.`),
      summary: L(`对 ${col} 累加求和`, `Cumulative sum of ${col}`),
      result: df.cumsum(col),
    };
  },
});

export const opRolling = seriesOp({
  id: 'rolling', codeKey: 'rolling',
  build(df, col, cfg) {
    const window = Math.max(2, Math.min(cfg.window ?? 3, df.nrow));
    const name = `${col}_roll${window}`;
    const src = df.col(col);
    const values = src.map((v, i) => {
      if (i < window - 1) return null;
      const win = src.slice(i - window + 1, i + 1).filter((x) => typeof x === 'number' && Number.isFinite(x));
      if (!win.length) return null;
      return Math.round(win.reduce((a, b) => a + b, 0) / win.length * 1e6) / 1e6;
    });
    return {
      name, values, codeArgs: { col, window, name },
      title: L(`滑动窗口均值（窗口 = ${window}）`, `Rolling mean (window = ${window})`),
      intro: L('rolling 用一个固定宽度的「窗口」沿数据滑动，每滑一格就重新计算一次统计量。它的作用是抹掉噪声、突出趋势 —— 这是时间序列分析里最常用的平滑手段。',
        'rolling slides a fixed-width window along the data, recomputing the statistic at each step. It suppresses noise and surfaces trend — the workhorse smoother of time-series analysis.'),
      stepNarration: (i, end) => L(`窗口覆盖第 ${Math.max(1, i + 1 - window + 1)}–${end} 行，共 ${window} 个值，取平均得到 ${fmt(values[end - 1])}。前 ${window - 1} 行凑不满窗口，因此是 NaN。`,
        `The window covers rows ${Math.max(1, i + 1 - window + 1)}–${end} (${window} values); their mean is ${fmt(values[end - 1])}. The first ${window - 1} rows cannot fill a window, so they stay NaN.`),
      doneTitle: L(`平滑列「${name}」已生成`, `Smoothed column "${name}" created`),
      doneNarration: L(`窗口越大曲线越平滑、滞后越明显 —— 这是平滑的固有取舍。切换到「折线图」视图把原始列和窗口列画在一起，对比非常直观。`,
        `A wider window means a smoother curve and more lag — the inherent trade-off. Switch to the Line chart and plot the raw and rolling columns together; the contrast is striking.`),
      summary: L(`对 ${col} 做 ${window} 期滑动平均`, `${window}-period rolling mean of ${col}`),
      result: df.rolling(col, window, 'mean'),
    };
  },
});

export const opRank = seriesOp({
  id: 'rank', codeKey: 'rank',
  build(df, col, cfg) {
    const asc = cfg.asc !== false;
    const name = `${col}_rank`;
    const src = df.col(col);
    const order = src.map((v, i) => ({ v, i })).filter((o) => typeof o.v === 'number' && Number.isFinite(o.v))
      .sort((a, b) => (asc ? a.v - b.v : b.v - a.v));
    const ranks = new Map();
    let k = 0;
    while (k < order.length) {
      let j = k;
      while (j + 1 < order.length && order[j + 1].v === order[k].v) j++;
      for (let x = k; x <= j; x++) ranks.set(order[x].i, k + 1);
      k = j + 1;
    }
    const values = src.map((v, i) => (ranks.has(i) ? ranks.get(i) : null));
    return {
      name, values, codeArgs: { col, name, asc },
      title: L(`按 ${col} ${asc ? '升序' : '降序'}排名`, `Rank by ${col} ${asc ? 'ascending' : 'descending'}`),
      intro: L('rank 把「数值」翻译成「名次」。它比排序温和：不改变行的顺序，只新增一列名次。并列时 method="min" 让并列项共享较小的名次。',
        'rank translates values into positions. It is gentler than sorting: row order is untouched and a rank column is added. With method="min", ties share the smaller rank.'),
      stepNarration: (i, end) => L(`第 ${i + 1}–${end} 行按值大小得到名次。${col} 越大（升序时）名次越靠后。`,
        `Rows ${i + 1}–${end} receive ranks by value. With ascending order, a larger ${col} means a later rank.`),
      doneTitle: L(`名次列「${name}」已生成`, `Rank column "${name}" created`),
      doneNarration: L(`名次是 1…${df.nrow} 的整数（并列会跳号）。把它和原值放在一起，就能回答「这个值在全体里排第几」。`,
        `Ranks are integers 1…${df.nrow} (ties skip). Keeping them beside the raw value answers "where does this value stand?".`),
      summary: L(`对 ${col} 排名`, `Ranked ${col}`),
      result: df.rank(col, asc, 'min'),
    };
  },
});

export const opCut = seriesOp({
  id: 'cut', codeKey: 'cut',
  build(df, col, cfg) {
    const mode = cfg.mode || 'cut';
    const arg = cfg.bins ?? 4;
    const name = `${col}_bin`;
    const result = df.cut(col, mode, arg, name);
    const info = result.cutInfo;
    const src = df.col(col);
    const values = result.col(name);
    return {
      name, values, codeAt: 0,
      codeArgs: { col, name, mode, arg: mode === 'qcut' ? String(arg) : String(arg) },
      title: L(`把 ${col} 离散成 ${info.labels.length} 个区间`, `Discretise ${col} into ${info.labels.length} bins`),
      intro: mode === 'qcut'
        ? L('qcut 按「分位数」切分，每个箱里的样本数尽量相等 —— 适合把连续变量变成等频的分类标签。',
          'qcut splits on quantiles so each bin holds roughly the same number of samples — ideal for turning a continuous variable into an equal-frequency label.')
        : L('cut 按「固定边界」切分，每个箱的宽度相同 —— 适合有明确业务阈值的场景（比如 60 分及格线）。',
          'cut splits on fixed edges so every bin has the same width — ideal when business thresholds exist (a pass mark of 60, say).'),
      stepNarration: (i, end) => L(`第 ${i + 1}–${end} 行的 ${col} 值落入区间标签「${values[end - 1] ?? 'NaN'}」。`,
        `Rows ${i + 1}–${end}: ${col} falls into bin "${values[end - 1] ?? 'NaN'}".`),
      doneTitle: L(`区间列「${name}」已生成`, `Bin column "${name}" created`),
      doneNarration: L(`连续数值变成了 ${info.labels.length} 个类别标签，之后就能用 groupby 或柱状图直接按区间统计。`,
        `The continuous values became ${info.labels.length} category labels, ready for groupby or a bar chart.`),
      summary: L(`用 ${mode} 将 ${col} 离散为 ${info.labels.length} 个区间`, `${mode} split ${col} into ${info.labels.length} bins`),
      result,
    };
  },
});

export const opWhere = seriesOp({
  id: 'where', codeKey: 'where',
  build(df, col, cfg) {
    const q = colSummary(df, col);
    const threshold = cfg.value ?? Math.round(q.q1);
    const other = cfg.other ?? 0;
    const name = col;
    const src = df.col(col);
    const values = src.map((v) => (typeof v === 'number' && v >= threshold ? v : other));
    return {
      name, values, codeArgs: { col, cond: `df["${col}"] >= ${fmt(threshold)}`, other: fmt(other) },
      title: L(`把小于 ${fmt(threshold)} 的值替换为 ${fmt(other)}`, `Replace values below ${fmt(threshold)} with ${fmt(other)}`),
      intro: L('where 保留满足条件的值，把不满足的替换成指定内容。它和 mask 正好相反（mask 替换满足条件的）。相比布尔索引筛选，where 不删行，只是改值。',
        'where keeps values that satisfy the condition and replaces the rest. It is the mirror of mask (which replaces the ones that satisfy). Unlike boolean filtering, where never drops a row — it only rewrites.'),
      stepNarration: (i, end) => L(`第 ${i + 1}–${end} 行逐值判断：≥ ${fmt(threshold)} 就保留原值，否则写成 ${fmt(other)}。`,
        `Rows ${i + 1}–${end}: if the value is ≥ ${fmt(threshold)} it stays, otherwise it becomes ${fmt(other)}.`),
      doneTitle: L(`条件替换完成`, `Conditional replacement done`),
      doneNarration: L(`行数不变，但低值被统一「压平」了。这在把负数、异常小值统一处理成 0 时非常常用。`,
        'Row count is unchanged, but the low values are flattened. This is the usual move for turning negatives or stray small values into 0.'),
      summary: L(`where 条件替换 ${col}`, `where on ${col}`),
      result: df.where(col, (v) => typeof v === 'number' && v >= threshold, other),
    };
  },
});

export const opApply = seriesOp({
  id: 'apply', codeKey: 'apply',
  build(df, col, cfg) {
    const decimals = cfg.decimals ?? 0;
    const f = 10 ** decimals;
    const name = `${col}_rounded`;
    const src = df.col(col);
    const values = src.map((v) => (typeof v === 'number' ? Math.round(v * f) / f : null));
    return {
      name, values, codeArgs: { col, name, fn: `round(${decimals})` },
      title: L(`对每个元素套用函数：保留 ${decimals} 位小数`, `Apply per element: round to ${decimals} decimals`),
      intro: L('apply 是 pandas 的「逐元素函数调用」。它把整列拆成一个个值，分别送进你的函数，再把结果拼回一列 —— 灵活但比内置方法慢，能用向量化就用向量化。',
        'apply calls your function once per element: the column is split into values, each is passed in, and the results are stitched back. Flexible but slower than built-ins — prefer vectorised ops when you can.'),
      stepNarration: (i, end) => L(`第 ${i + 1}–${end} 行的值被送进函数，返回 ${values.slice(i, end).map((v) => fmt(v)).join('、')}。`,
        `Rows ${i + 1}–${end} go through the function and return ${values.slice(i, end).map((v) => fmt(v)).join(', ')}.`),
      doneTitle: L(`新列「${name}」已生成`, `"${name}" created`),
      doneNarration: L('注意 apply 的代价：每个元素都要跨一次函数调用边界，列很长时会明显变慢。这就是 pandas 里常说的「向量化优先」。',
        'Note the cost: every element crosses a function-call boundary, which gets slow on long columns. This is why pandas people say "vectorise first".'),
      summary: L(`apply 处理 ${col}`, `Applied to ${col}`),
      result: df.apply(col, (v) => (typeof v === 'number' ? Math.round(v * f) / f : v), name),
    };
  },
});
