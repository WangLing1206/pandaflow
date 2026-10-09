/* ------------------------------------------------------------------
 * ops/transform.js — 数据变换
 *  · sort_values  排序（插入排序的可视化过程）
 *  · query        条件筛选（布尔掩码）
 *  · astype       类型转换
 *  · assign       新增计算列
 *  · rename       重命名列
 *  · sample       随机抽样
 *  · head / tail  截取
 * ------------------------------------------------------------------ */

import { Script, T, CODE } from '../frames.js';
import { isNA, fmt } from '../utils.js';
import { cmpValues } from '../dataframe.js';
import { pickLabelCol, labelOf, unitOf, colSummary, domain } from './common.js';

/* ================================================================
 * 排序
 * ================================================================ */
export function opSort(df, cfg = {}) {
  const by = cfg.by || df.columns.find((c) => df.dtypes[c] === 'number');
  const asc = cfg.asc !== false;
  const unit = unitOf(df, by);
  const labelCol = pickLabelCol(df);
  const S = new Script(df, 'sort_values');
  S.code(CODE.sort({ by, asc }));

  const vals = df.col(by);

  /* 插入排序：记录每一步之后的数组状态（用位置索引序列表示） */
  const order = df._rows.map((_, i) => i);
  const snapshots = [];
  const cmps = [];
  let totalCmp = 0;

  // 先做一遍插入排序，记录快照
  const arr = order.slice();
  snapshots.push({ arr: arr.slice(), sortedUpTo: 0, key: null, cmp: 0, moved: 0 });
  for (let i = 1; i < arr.length; i++) {
    const key = arr[i];
    let j = i - 1;
    let moved = 0;
    while (j >= 0 && (cmpValues(vals[arr[j]], vals[key]) * (asc ? 1 : -1)) > 0) {
      arr[j + 1] = arr[j];
      j--; moved++; totalCmp++;
    }
    arr[j + 1] = key;
    totalCmp++;
    cmps.push({ i, key, moved, cmp: vals[key], sortedUpTo: i });
    snapshots.push({ arr: arr.slice(), sortedUpTo: i, key, moved, cmp: totalCmp });
  }

  /* 把 38 步压缩成有节奏的镜头：每帧推进若干元素 */
  const STEPS = 12;
  const stride = Math.max(1, Math.ceil((snapshots.length - 1) / STEPS));
  const picks = [];
  for (let k = 1; k < snapshots.length; k += stride) picks.push(snapshots[k]);
  if (picks[picks.length - 1] !== snapshots[snapshots.length - 1]) picks.push(snapshots[snapshots.length - 1]);

  const sortStage = (snap, extra = {}) => ({
    kind: 'sort',
    by, asc, unit, labelCol,
    sortedUpTo: snap.sortedUpTo,
    total: df.nrow,
    cursor: snap.key,
    items: snap.arr.map((orig, pos) => ({
      pos, orig, rid: df._rows[orig].rid,
      name: labelOf(df, labelCol, orig),
      value: vals[orig],
      t: typeof vals[orig] === 'number' ? (vals[orig] - dom.min) / (dom.max - dom.min) : 0.5,
      sorted: pos <= snap.sortedUpTo,
      isKey: orig === snap.key,
    })),
    ...extra,
  });
  const dom = domain(vals);

  S.add({
    phase: '① 确定排序键',
    title: `按 ${by} ${asc ? '升序' : '降序'} 排列`,
    narration: `sort_values 不会修改数据本身，只是重新排列行的顺序。排序键是 ${by} 列，温度计上的圆点代表每一行。` +
      `算法的做法是：维护一个「已排好序的左侧区」，从左到右把每个新元素插进正确的位置。`,
    duration: 3000,
    tone: 'info',
    code: S.codeAt(0),
    table: S.table(T(df, { cellState: (r, i, name) => (name === by ? 'focus' : null) })),
    stage: sortStage(snapshots[0]),
    hud: [{ label: '排序键', value: by, tone: 'cyan' }, { label: '方向', value: asc ? 'ascending' : 'descending', tone: 'mute' }],
  });

  picks.forEach((snap, n) => {
    const keyIdx = snap.key;
    const v = vals[keyIdx];
    const moved = snap.moved;
    S.add({
      phase: '② 插入排序',
      title: moved > 0
        ? `${labelOf(df, labelCol, keyIdx)} 向前移动了 ${moved} 位`
        : `${labelOf(df, labelCol, keyIdx)} 已在本位，无需移动`,
      narration: moved > 0
        ? `取出 ${by}=${fmt(v)}${unit}，它比左边 ${moved} 个元素都${asc ? '小' : '大'}，因此这些元素依次向右让位，` +
          `直到 ${fmt(v)} 找到第一个不${asc ? '小于' : '大于'}它的位置插进去。已排序区扩展到前 ${snap.sortedUpTo + 1} 个。`
        : `${by}=${fmt(v)}${unit} 恰好不小于左边任何一个元素，原地不动。已排序区扩展到前 ${snap.sortedUpTo + 1} 个。`,
      duration: moved > 0 ? 1450 : 1000,
      tone: moved > 0 ? 'gold' : 'info',
      code: S.codeAt(0),
      table: S.table(T(df, {
        order: snap.arr.map((i) => df._rows[i].rid),
        rowState: (r, i) => (i === keyIdx ? 'focus' : (snap.arr.indexOf(i) <= snap.sortedUpTo ? 'keep' : 'normal')),
        cellState: (r, i, name) => (name === by ? (i === keyIdx ? 'scan' : 'seen') : null),
      })),
      stage: sortStage(snap),
      hud: [
        { label: '已排序', value: `${snap.sortedUpTo + 1}/${df.nrow}`, tone: 'ok' },
        { label: '比较次数', value: String(snap.cmp), tone: 'mute' },
      ],
    });
  });

  const result = df.sortValues(by, asc);
  const s = colSummary(result, by);
  const numeric = df.dtypes[by] === 'number' && s.n > 0;
  const first = result.col(by)[0], last = result.col(by)[result.nrow - 1];
  S.add({
    phase: '③ 结果',
    title: `${by} 已经单调${asc ? '递增' : '递减'}`,
    narration: numeric
      ? `整列现在完全有序：${fmt(asc ? s.min : s.max)}${unit} 在最上面，${fmt(asc ? s.max : s.min)}${unit} 在最下面。` +
        `有序之后，取 Top-N、找中位数、绘制累计曲线都会变得非常直接。`
      : `整列现在完全有序：${fmt(first)} 在最上面，${fmt(last)} 在最下面。字符串列按字典序排列，` +
        `这让「按班级/城市归拢数据」变得直观。`,
    duration: 2600,
    tone: 'ok',
    final: true,
    code: S.codeAt(1),
    table: S.table(T(result, { cellState: (r, i, name) => (name === by ? 'best' : null) })),
    stage: numeric
      ? { kind: 'sortedbars', by, unit, labelCol, values: result.col(by), labels: result._rows.map((r, i) => labelOf(result, labelCol, i)) }
      : { kind: 'compare', title: `按 ${by} 排序`, before: { shape: [df.nrow, df.ncol], stats: null }, after: { shape: [result.nrow, result.ncol], stats: null }, removed: [] },
    hud: numeric
      ? [{ label: 'min', value: fmt(asc ? s.min : s.max) + unit, tone: 'violet' },
        { label: 'max', value: fmt(asc ? s.max : s.min) + unit, tone: 'rose' },
        { label: '比较次数', value: String(totalCmp), tone: 'mute' }]
      : [{ label: '首行', value: fmt(first), tone: 'cyan' }, { label: '末行', value: fmt(last), tone: 'cyan' },
        { label: '比较次数', value: String(totalCmp), tone: 'mute' }],
  });

  return { frames: S.frames, result, summary: `按 ${by} ${asc ? '升序' : '降序'} 排序` };
}

/* ================================================================
 * 条件筛选 query
 * ================================================================ */
export function opQuery(df, cfg = {}) {
  const col = cfg.col || df.columns.find((c) => df.dtypes[c] === 'number');
  const op = cfg.op || '>';
  const value = cfg.value ?? Math.round(colSummary(df, col).mean);
  const unit = unitOf(df, col);
  const labelCol = pickLabelCol(df);
  const S = new Script(df, 'query');

  const test = (v) => {
    if (typeof v !== 'number' || !Number.isFinite(v)) return false;
    switch (op) {
      case '>': return v > value;
      case '>=': return v >= value;
      case '<': return v < value;
      case '<=': return v <= value;
      case '==': return v === value;
      case '!=': return v !== value;
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
    kind: 'mask', col, op, value, unit, labelCol, expr,
    cursor, total: df.nrow,
    entries: df._rows.map((r, i) => ({
      i, rid: r.rid, name: labelOf(df, labelCol, i), value: values[i],
      pass: mask[i] || false, evaluated: cursor < 0 ? false : i <= cursor,
      na: isNA(values[i]),
    })),
    ...extra,
  });

  S.add({
    phase: '① 把条件翻译成掩码',
    title: `条件：${expr}`,
    narration: `pandas 的筛选分两步走，第一步是「翻译」：把条件作用到整列上，得到一个与行数等长的 True/False 序列，称为布尔掩码。` +
      `它只是判断，还没有动数据。`,
    duration: 3200,
    tone: 'info',
    code: S.codeAt(0),
    table: S.table(T(df, { cellState: (r, i, name) => (name === col ? 'focus' : null) })),
    stage: maskStage(-1),
    hud: [{ label: 'shape', value: `${df.nrow} × ${df.ncol}`, tone: 'mute' }, { label: '条件', value: expr, tone: 'cyan' }],
  });

  /* 逐批判定 */
  const CHUNK = 6;
  let i = 0;
  while (i < df.nrow) {
    const end = Math.min(i + CHUNK, df.nrow);
    const nPass = mask.slice(i, end).filter(Boolean).length;
    S.add({
      phase: '② 逐行判定',
      title: `第 ${i + 1}–${end} 行：${nPass} 个 True / ${end - i - nPass} 个 False`,
      narration: `把这一段的值逐个与 ${fmt(value)}${unit} 比较：` +
        (nPass ? `命中 ${mask.slice(i, end).map((p, k) => (p ? labelOf(df, labelCol, i + k) : null)).filter(Boolean).join('、')}。` : '本段全部不满足条件。') +
        `注意判定结果只写在掩码里，原表纹丝不动。`,
      duration: 1150,
      tone: nPass ? 'ok' : 'mute',
      code: S.codeAt(1),
      table: S.table(T(df, {
        rowState: (r, j) => (j >= i && j < end ? 'focus' : (j < i ? (mask[j] ? 'keep' : 'dim') : 'normal')),
        cellState: (r, j, name) => (name === col ? (mask[j] ? 'best' : 'dim') : null),
      })),
      stage: maskStage(end - 1),
      hud: [{ label: '已判定', value: `${end}/${df.nrow}`, tone: 'cyan' }, { label: 'True', value: String(mask.slice(0, end).filter(Boolean).length), tone: 'ok' }],
    });
    i = end;
  }

  S.add({
    phase: '③ 按掩码取行',
    title: `${passN} 个 True · ${df.nrow - passN} 个 False`,
    narration: `掩码计算完毕：${passN} 行为 True，保留；${df.nrow - passN} 行为 False，被丢弃。` +
      `df[mask] 就是「拿着这张名单去点名」，True 的行留下，False 的行离开。`,
    duration: 2400,
    tone: 'ok',
    code: S.codeAt(2),
    table: S.table(T(df, {
      rowState: (r, j) => (mask[j] ? 'keep' : 'danger'),
      cellState: (r, j, name) => (name === col ? (mask[j] ? 'best' : 'dim') : null),
    })),
    stage: maskStage(df.nrow - 1, { marking: true }),
  });

  const result = df.filter((cells) => test(cells[ci]));
  S.add({
    phase: '④ 结果',
    title: `筛选完成 · ${df.nrow} 行 → ${result.nrow} 行`,
    narration: `结果表里只剩下满足 ${expr} 的 ${result.nrow} 行。索引保留了原表中的编号（断层是正常的），` +
      `若要连续编号记得 reset_index。`,
    duration: 2600,
    tone: 'ok',
    final: true,
    code: S.codeAt(2),
    table: S.table(T(result, { cellState: (r, i, name) => (name === col ? 'best' : null) })),
    stage: {
      kind: 'compare', title: `query · ${expr}`, col, unit,
      before: { shape: [df.nrow, df.ncol], stats: colSummary(df, col), hist: df.hist(col, 12) },
      after: { shape: [result.nrow, result.ncol], stats: colSummary(result, col), hist: result.hist(col, 12) },
      removed: [],
    },
    hud: [{ label: '保留率', value: `${(result.nrow / df.nrow * 100).toFixed(0)}%`, tone: 'ok' },
      { label: 'shape', value: `${df.nrow}×${df.ncol} → ${result.nrow}×${result.ncol}`, tone: 'ok' }],
  });

  return { frames: S.frames, result, summary: `筛选 ${expr}` };
}

/* ================================================================
 * 新增计算列 assign
 * ================================================================ */
export function opAssign(df, cfg = {}) {
  const labelCol = pickLabelCol(df);
  const numCols = df.columns.filter((c) => df.dtypes[c] === 'number');
  const a = cfg.a || numCols[0], b = cfg.b || numCols[1];
  const name = cfg.name || `${a}_占比`;
  const S = new Script(df, 'assign');

  const formula = `${a} / (${a} + ${b}) * 100`;
  S.code(CODE.assign({ name, expr: `df["${a}"] / (df["${a}"] + df["${b}"]) * 100` }));

  const ai = df.columns.indexOf(a), bi = df.columns.indexOf(b);
  const computed = df._rows.map((r) => {
    const x = r.cells[ai], y = r.cells[bi];
    if (typeof x !== 'number' || typeof y !== 'number' || x + y === 0) return null;
    return Math.round((x / (x + y) * 100) * 100) / 100;
  });

  const formulaStage = (cursor, extra = {}) => ({
    kind: 'formula',
    name, formula,
    a, b,
    cursor, total: df.nrow,
    entries: df._rows.map((r, i) => ({
      i, rid: r.rid, name: labelOf(df, labelCol, i),
      x: r.cells[ai], y: r.cells[bi],
      out: computed[i],
      done: cursor < 0 ? false : i <= cursor,
    })),
    ...extra,
  });

  S.add({
    phase: '① 定义计算规则',
    title: `新增列「${name}」`,
    narration: `pandas 里新增列不需要建表，直接赋值即可。右边这条表达式会对 ${df.columns.indexOf(a) >= 0 ? a : a} 列的每一个元素执行 —— ` +
      `${a} 占 (${a}+${b}) 的百分比。注意：表达式是「逐元素」运算，不是对整个列算一次。`,
    duration: 3200,
    tone: 'info',
    code: S.codeAt(0),
    table: S.table(T(df, { cellState: (r, i, x) => (x === a || x === b ? 'focus' : null) })),
    stage: formulaStage(-1),
    hud: [{ label: '新列', value: name, tone: 'gold' }, { label: 'shape', value: `${df.nrow} × ${df.ncol} → ${df.nrow} × ${df.ncol + 1}`, tone: 'ok' }],
  });

  const CHUNK = 5;
  let i = 0;
  while (i < df.nrow) {
    const end = Math.min(i + CHUNK, df.nrow);
    const sample = [];
    for (let k = i; k < Math.min(i + 2, end); k++) {
      if (computed[k] !== null) sample.push(`${computed[k]}`);
    }
    S.add({
      phase: '② 逐元素求值',
      title: `第 ${i + 1}–${end} 行 · 计算新列`,
      narration: `对这一段每一行套用公式：${a} ÷ (${a} + ${b}) × 100` +
        (sample.length ? `，例如得到 ${sample.join('、')}` : '') + `。新列在表格最右侧逐格生长出来。`,
      duration: 1100,
      tone: 'info',
      code: S.codeAt(0),
      table: S.table(T(df, {
        columns: df.columns.concat([name]),
        rowState: (r, j) => (j >= i && j < end ? 'focus' : (j < i ? 'dim' : 'normal')),
        cellState: (r, j, nm) => (nm === name ? (j < end ? 'new' : null) : null),
      })),
      stage: formulaStage(end - 1),
    });
    i = end;
  }

  const result = df.assign(name, (cells) => {
    const x = cells[ai], y = cells[bi];
    if (typeof x !== 'number' || typeof y !== 'number' || x + y === 0) return null;
    return Math.round((x / (x + y) * 100) * 100) / 100;
  });
  const rs = colSummary(result, name);

  S.add({
    phase: '③ 结果',
    title: `新列「${name}」已就位`,
    narration: `表格从 ${df.ncol} 列变成 ${result.ncol} 列，行数一条没少。新列可以直接参与后续的排序、筛选、分组 —— ` +
      `这就是「特征工程」在 pandas 里最朴素的样子。`,
    duration: 2800,
    tone: 'ok',
    final: true,
    code: S.codeAt(0),
    table: S.table(T(result, { cellState: (r, i, nm) => (nm === name ? 'new' : null) })),
    stage: {
      kind: 'compare', title: `新增列 · ${name}`, col: name, unit: '%',
      before: { shape: [df.nrow, df.ncol], stats: null },
      after: { shape: [result.nrow, result.ncol], stats: rs, hist: result.hist(name, 12) },
      removed: [],
    },
    hud: [{ label: 'mean', value: fmt(rs.mean) + '%', tone: 'cyan' }, { label: 'std', value: fmt(rs.std), tone: 'mute' },
      { label: 'shape', value: `${df.ncol} → ${result.ncol} 列`, tone: 'ok' }],
  });

  return { frames: S.frames, result, summary: `新增计算列 ${name}` };
}

/* ================================================================
 * 类型转换 astype
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
  const from = df.dtypes[col], to = target;

  S.add({
    phase: '① 为什么要换类型',
    title: `${col}：${from} → ${to}`,
    narration: `dtype 决定了 pandas 能对这一列做什么。` +
      (to === 'string' || to === 'object'
        ? `转成 object 后，它就不再参与数值运算，而是作为分类标签使用 —— 比如用于 groupby 分组。`
        : `转成数值后，它才能被求和、求均值、参与计算。常见场景是从 CSV 读进来的「带单位数字」需要洗成纯数字。`),
    duration: 3000,
    tone: 'info',
    code: S.codeAt(0),
    table: S.table(T(df, { cellState: (r, i, name) => (name === col ? 'focus' : null) })),
    stage: { kind: 'dtype', col, from, to, cursor: -1, entries: df._rows.map((r, i) => ({ i, name: labelOf(df, labelCol, i), before: r.cells[ci], after: convert(r.cells[ci]), done: false })) },
  });

  const CHUNK = 6;
  let i = 0;
  while (i < df.nrow) {
    const end = Math.min(i + CHUNK, df.nrow);
    S.add({
      phase: '② 逐值转换',
      title: `第 ${i + 1}–${end} 行完成转换`,
      narration: `每个值按类型规则重新解释并写回：` +
        df._rows.slice(i, end).slice(0, 3).map((r) => `${fmt(r.cells[ci])} → ${fmt(convert(r.cells[ci]))}`).join('，') + ` …` +
        `转换只改变解释方式，不改变可见内容（除非发生截断）。`,
      duration: 1000,
      tone: 'info',
      code: S.codeAt(0),
      table: S.table(T(df, {
        rowState: (r, j) => (j >= i && j < end ? 'focus' : (j < i ? 'dim' : 'normal')),
        cellState: (r, j, name) => (name === col && j < end ? 'change' : null),
      })),
      stage: { kind: 'dtype', col, from, to, cursor: end - 1, entries: df._rows.map((r, k) => ({ i: k, name: labelOf(df, labelCol, k), before: r.cells[ci], after: convert(r.cells[ci]), done: k < end })) },
    });
    i = end;
  }

  const result = df.astype(col, target);
  S.add({
    phase: '③ 结果',
    title: `${col} 现在是 ${target}`,
    narration: `df["${col}"].dtype 已经变为 ${target}。在真实项目里，这一步常常决定了后面 groupby 能不能正确分组、数学运算会不会报错。`,
    duration: 2400,
    tone: 'ok',
    final: true,
    code: S.codeAt(0),
    table: S.table(T(result, { cellState: (r, i, name) => (name === col ? 'new' : null) })),
    stage: { kind: 'dtype', col, from, to, cursor: df.nrow - 1, done: true, entries: result._rows.map((r, k) => ({ i: k, name: labelOf(result, labelCol, k), before: df._rows[k].cells[ci], after: r.cells[ci], done: true })) },
    hud: [{ label: 'dtype', value: `${from} → ${to}`, tone: 'ok' }],
  });

  return { frames: S.frames, result, summary: `将 ${col} 转换为 ${to}` };
}

/* ================================================================
 * 重命名列
 * ================================================================ */
export function opRename(df, cfg = {}) {
  const S = new Script(df, 'rename');
  const map = cfg.map || {};
  const entries = Object.entries(map);
  S.code(CODE.rename(JSON.stringify(map)));

  S.add({
    phase: '① 设定映射',
    title: `重命名 ${entries.length} 个字段`,
    narration: `原始列名往往带有空格、括号、中文单位，直接写代码容易出错。rename 用字典做一次性替换：${entries.map(([k, v]) => `${k} → ${v}`).join('，')}。`,
    duration: 2600,
    tone: 'info',
    code: S.codeAt(0),
    table: S.table(T(df, { cellState: (r, i, name) => (map[name] ? 'focus' : null) })),
    stage: { kind: 'rename', pairs: entries.map(([k, v]) => ({ from: k, to: v, done: false })) },
  });

  entries.forEach(([k, v], n) => {
    S.add({
      phase: '② 逐个替换',
      title: `${k} → ${v}`,
      narration: `列名被改写为「${v}」。注意：rename 只改名字，列里的数据一个字节都没动。`,
      duration: 950,
      tone: 'gold',
      code: S.codeAt(0),
      table: S.table(T(df, {
        columns: df.columns.map((c) => (c === k ? v : (entries.slice(0, n).some(([kk, vv]) => kk === c) ? map[c] : c))),
        cellState: (r, i, name) => (name === v ? 'new' : null),
      })),
      stage: { kind: 'rename', pairs: entries.map(([kk, vv], m) => ({ from: kk, to: vv, done: m <= n })) },
    });
  });

  const result = df.rename(map);
  S.add({
    phase: '③ 结果',
    title: '列名焕然一新，数据原封不动',
    narration: `现在可以用 df.${Object.values(map)[0] || 'new_name'} 直接访问这一列了。规范化的列名是让后续管道可维护的关键一步。`,
    duration: 2400,
    tone: 'ok',
    final: true,
    code: S.codeAt(0),
    table: S.table(T(result, { cellState: (r, i, name) => (Object.values(map).includes(name) ? 'new' : null) })),
    stage: { kind: 'rename', pairs: entries.map(([k, v]) => ({ from: k, to: v, done: true })), done: true },
    hud: [{ label: 'shape', value: `${result.nrow} × ${result.ncol}`, tone: 'ok' }],
  });

  return { frames: S.frames, result, summary: `重命名 ${entries.length} 个字段` };
}

/* ================================================================
 * 随机抽样
 * ================================================================ */
export function opSample(df, cfg = {}) {
  const n = cfg.n || Math.max(5, Math.round(df.nrow * 0.3));
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

  const sampleStage = (cursor, extra = {}) => ({
    kind: 'sample', n, seed, labelCol, cursor, total: df.nrow,
    entries: df._rows.map((r, i) => ({
      i, rid: r.rid, name: labelOf(df, labelCol, i),
      picked: pickSet.has(i), revealed: cursor < 0 ? false : picked.indexOf(i) <= cursor && pickSet.has(i),
      order: picked.indexOf(i),
    })),
    ...extra,
  });

  S.add({
    phase: '① 抽样的意义',
    title: `从 ${df.nrow} 行中随机抽取 ${n} 行`,
    narration: `数据太大时，先抽样观察比全量分析更高效；抽样也用于交叉验证划分。` +
      `random_state=${seed} 表示「随机种子固定」，同一份数据每次抽出的结果都一样 —— 这是让实验可复现的关键。`,
    duration: 3000,
    tone: 'info',
    code: S.codeAt(0),
    table: S.table(T(df, { rowState: () => 'dim' })),
    stage: sampleStage(-1),
    hud: [{ label: 'sample n', value: String(n), tone: 'cyan' }, { label: 'random_state', value: String(seed), tone: 'mute' }],
  });

  const CHUNK = 3;
  for (let c = 0; c < picked.length; c += CHUNK) {
    const end = Math.min(c + CHUNK, picked.length);
    const names = picked.slice(c, end).map((i) => labelOf(df, labelCol, i));
    S.add({
      phase: '② 逐个抽取',
      title: `第 ${c + 1}–${end} 个样本：${names.join('、')}`,
      narration: `随机数发生器依次命中这些行。被抽中的行立即高亮 —— 每一行被选中的概率都是均等的 ${(n / df.nrow * 100).toFixed(1)}%。`,
      duration: 1150,
      tone: 'gold',
      code: S.codeAt(0),
      table: S.table(T(df, {
        rowState: (r, i) => (pickSet.has(i) ? (picked.indexOf(i) < end ? 'keep' : 'dim') : 'dim'),
      })),
      stage: sampleStage(end - 1),
      hud: [{ label: '已抽取', value: `${end}/${n}`, tone: 'cyan' }],
    });
  }

  const result = df.filter((c, i) => pickSet.has(i));

  S.add({
    phase: '③ 结果',
    title: `抽样完成 · ${n} 行样本`,
    narration: `未抽中的行被丢弃。样本量只有原来的 ${(n / df.nrow * 100).toFixed(0)}%，但统计特征（均值、分布形态）与总体基本一致 —— 这正是抽样有价值的原因。`,
    duration: 2600,
    tone: 'ok',
    final: true,
    code: S.codeAt(0),
    table: S.table(T(result, {})),
    stage: sampleStage(n - 1, { done: true }),
    hud: [{ label: 'shape', value: `${df.nrow}×${df.ncol} → ${result.nrow}×${result.ncol}`, tone: 'ok' }],
  });

  return { frames: S.frames, result, summary: `随机抽取 ${n} 行（seed=${seed}）` };
}

/* ================================================================
 * head / tail 截取
 * ================================================================ */
export function opHeadTail(df, cfg = {}) {
  const n = cfg.n || 5;
  const isTail = cfg.tail === true;
  const S = new Script(df, isTail ? 'tail' : 'head');
  S.code(isTail ? CODE.tail(n) : CODE.head(n));

  const keepFrom = isTail ? df.nrow - n : 0;
  const keepTo = isTail ? df.nrow : n;
  const labelCol = pickLabelCol(df);

  S.add({
    phase: '① 快速预览',
    title: `${isTail ? 'tail' : 'head'}(${n}) · 只看${isTail ? '末尾' : '开头'} ${n} 行`,
    narration: `拿到新数据集的第一件事永远是「先看一眼」。${isTail ? 'tail' : 'head'}(${n}) 不等价于分析，` +
      `它只是确认：列名对不对、数值有没有单位混入、缺失值长什么样。这一步能避免后面 90% 的返工。`,
    duration: 2800,
    tone: 'info',
    code: S.codeAt(0),
    table: S.table(T(df, { rowState: () => 'normal' })),
    stage: { kind: 'slice', mode: isTail ? 'tail' : 'head', n, total: df.nrow, cursor: -1, labelCol, names: df._rows.map((r, i) => labelOf(df, labelCol, i)) },
  });

  S.add({
    phase: '② 标出截取区间',
    title: `${isTail ? '最后' : '前'} ${n} 行被选中`,
    narration: `索引 ${keepFrom}–${keepTo - 1} 共 ${n} 行会被保留，其余 ${df.nrow - n} 行进入预览之外的「未显示」状态 —— 注意它们并没有被删除。`,
    duration: 2200,
    tone: 'gold',
    code: S.codeAt(0),
    table: S.table(T(df, { rowState: (r, i) => (i >= keepFrom && i < keepTo ? 'focus' : 'dim') })),
    stage: { kind: 'slice', mode: isTail ? 'tail' : 'head', n, total: df.nrow, cursor: keepTo - 1, labelCol, names: df._rows.map((r, i) => labelOf(df, labelCol, i)) },
    hud: [{ label: '保留', value: `${n} 行`, tone: 'ok' }, { label: '未显示', value: `${df.nrow - n} 行`, tone: 'mute' }],
  });

  const result = isTail ? df.tail(n) : df.head(n);
  S.add({
    phase: '③ 结果',
    title: `预览：${result.nrow} 行 × ${result.ncol} 列`,
    narration: `这就是 head/tail 的返回物 —— 一个只有 ${n} 行的新 DataFrame。它是副本，修改它不会影响原始 df。`,
    duration: 2400,
    tone: 'ok',
    final: true,
    code: S.codeAt(0),
    table: S.table(T(result, {})),
    stage: { kind: 'slice', mode: isTail ? 'tail' : 'head', n, total: df.nrow, cursor: -1, done: true, labelCol, names: result._rows.map((r, i) => labelOf(result, labelCol, i)) },
    hud: [{ label: 'shape', value: `${df.nrow}×${df.ncol} → ${result.nrow}×${result.ncol}`, tone: 'ok' }],
  });

  return { frames: S.frames, result, summary: `${isTail ? 'tail' : 'head'}(${n}) 预览` };
}

/* ================================================================
 * 删除列
 * ================================================================ */
export function opDropColumns(df, cfg = {}) {
  const names = cfg.columns || [df.columns[df.columns.length - 1]];
  const S = new Script(df, 'drop');
  S.code(CODE.dropcol(names));

  S.add({
    phase: '① 确定要删的列',
    title: `删除字段：${names.join('、')}`,
    narration: `有些列对分析毫无贡献（常量列、重复列、隐私字段），留着只会增加噪声与内存。drop(columns=[...]) 是纵向的减法。`,
    duration: 2400,
    tone: 'info',
    code: S.codeAt(0),
    table: S.table(T(df, { cellState: (r, i, name) => (names.includes(name) ? 'danger' : null) })),
    stage: { kind: 'dropcols', cols: df.columns.length, title: '列被整列摘除', names, total: df.columns.length, removed: [] },
  });

  S.add({
    phase: '② 整列摘除',
    title: `列数 ${df.ncol} → ${df.ncol - names.length}`,
    narration: `注意与 dropna 的区别：drop(columns=...) 减的是「宽」，dropna 减的是「高」。行数完全不变。`,
    duration: 2000,
    tone: 'warn',
    code: S.codeAt(0),
    table: S.table(T(df.dropColumns(names), {})),
    stage: { kind: 'dropcols', names, total: df.columns.length, removed: names, done: true },
    hud: [{ label: 'shape', value: `${df.nrow}×${df.ncol} → ${df.nrow}×${df.ncol - names.length}`, tone: 'ok' }],
  });

  const result = df.dropColumns(names);
  S.add({
    phase: '③ 结果',
    title: '表变窄了，行一条没少',
    narration: `现在有 ${result.ncol} 个字段。剩下的列全部是分析真正用得到的。`,
    duration: 2200,
    tone: 'ok',
    final: true,
    code: S.codeAt(0),
    table: S.table(T(result, {})),
    stage: { kind: 'dropcols', names, total: result.ncol, removed: names, done: true },
    hud: [{ label: 'shape', value: `${result.nrow} × ${result.ncol}`, tone: 'ok' }],
  });

  return { frames: S.frames, result, summary: `删除字段 ${names.join('、')}` };
}
