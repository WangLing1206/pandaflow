/* ------------------------------------------------------------------
 * ops/clean.js — 数据清洗
 *  · drop_duplicates   重复行检测与删除（行指纹比对）
 *  · dropna            缺失值整行删除
 *  · fillna            缺失值填充
 * ------------------------------------------------------------------ */

import { Script, T, CODE } from '../frames.js';
import { isNA, fmt, mean, median } from '../utils.js';
import { pickLabelCol, labelOf, unitOf, colSummary } from './common.js';

/* ================================================================
 * 重复行检测与删除
 * ================================================================ */
export function opDropDuplicates(df, cfg = {}) {
  const subset = cfg.subset && cfg.subset.length ? cfg.subset : df.columns.slice();
  const labelCol = pickLabelCol(df);
  const S = new Script(df, 'drop_duplicates');
  S.code(CODE.dropDup(JSON.stringify(subset)));

  // 逐行计算指纹（与 pandas 判重逻辑一致：比较被选中的字段）
  const fps = df._rows.map((r) => df.fingerprint(r, subset));
  const firstSeen = new Map();
  const dupRids = [];
  const dupPairs = [];
  df._rows.forEach((r, i) => {
    const fp = fps[i];
    if (firstSeen.has(fp)) { dupRids.push(r.rid); dupPairs.push({ dup: i, origin: firstSeen.get(fp) }); }
    else firstSeen.set(fp, i);
  });

  /* 舞台：指纹指纹条 —— 每一行显示一个短哈希 */
  const shortHash = (fp) => {
    let h = 2166136261;
    for (let i = 0; i < fp.length; i++) { h ^= fp.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(16).padStart(8, '0').slice(0, 6);
  };

  const fpStage = (cursor, seenCount, extra = {}) => ({
    kind: 'fingerprint',
    col: labelCol,
    total: df.nrow,
    cursor,
    seenCount,
    entries: df._rows.map((r, i) => ({
      i, rid: r.rid, name: labelOf(df, labelCol, i), hash: shortHash(fps[i]),
      duplicate: dupRids.includes(r.rid),
      originIdx: dupPairs.find((p) => p.dup === i)?.origin ?? -1,
      checked: i < seenCount,
    })),
    subset,
    ...extra,
  });

  S.add({
    phase: '① 判重依据',
    title: `按 ${subset.length === df.columns.length ? '全部字段' : subset.join(' + ')} 判定重复`,
    narration: `pandas 判断「两行是否相同」的方法很直白：把参与判重的字段按顺序拼成一条字符串（行指纹），` +
      `再放进哈希表里找有没有出现过。${subset.length === df.columns.length ? '这里未指定 subset，所以全部字段都参与比对。' : `这里指定 subset=${JSON.stringify(subset)}，其余字段不参与判重。`}`,
    duration: 3000,
    tone: 'info',
    code: S.codeAt(0),
    table: S.table(T(df, { cellState: (r, i, name) => (subset.includes(name) ? 'focus' : 'dim') })),
    stage: fpStage(-1, 0),
    hud: [{ label: 'shape', value: `${df.nrow} × ${df.ncol}`, tone: 'mute' },
      { label: '判重字段', value: String(subset.length), tone: 'cyan' }],
  });

  /* 逐行比对：每次展示 4 行，节奏均匀 */
  const CHUNK = 4;
  let i = 0;
  let found = 0;
  while (i < df.nrow) {
    const end = Math.min(i + CHUNK, df.nrow);
    const inChunk = [];
    for (let k = i; k < end; k++) {
      const isDup = dupRids.includes(df._rows[k].rid);
      if (isDup) { found++; inChunk.push({ k, dup: true, origin: dupPairs.find((p) => p.dup === k).origin }); }
    }
    const names = [];
    for (let k = i; k < end; k++) names.push(labelOf(df, labelCol, k));
    const dupNames = inChunk.map((o) => labelOf(df, labelCol, o.k));

    S.add({
      phase: '② 逐行计算指纹',
      title: `第 ${i + 1}–${end} 行 · 计算行指纹`,
      narration: inChunk.length
        ? `第 ${inChunk.map((o) => o.k + 1).join('、')} 行的指纹与前面第 ${inChunk.map((o) => o.origin + 1).join('、')} 行完全一致 ` +
          `（都是 ${inChunk[0] ? shortHash(fps[inChunk[0].k]) : ''}）→ 判定为重复行，${dupNames.join('、')} 是同一份记录被录入了两次。`
        : `第 ${i + 1}–${end} 行（${names.join('、')}）的指纹都是全新的，此前从未出现 → 全部保留。`,
      duration: inChunk.length ? 1800 : 900,
      tone: inChunk.length ? 'danger' : 'info',
      code: S.codeAt(0),
      table: S.table(T(df, {
        rowState: (r, j) => (j >= i && j < end ? 'focus' : (j < i ? 'dim' : 'normal')),
        cellState: (r, j, name) => (dupRids.includes(r.rid) ? 'dup' : null),
      })),
      stage: fpStage(end - 1, end),
      hud: [
        { label: '已比对', value: `${end} / ${df.nrow}`, tone: 'cyan' },
        { label: '发现重复', value: String(found), tone: 'danger' },
      ],
    });
    i = end;
  }

  /* 并排对比：把重复行与原行放在一起 */
  if (dupPairs.length) {
    const p = dupPairs[0];
    const cols = subset.slice(0, Math.min(6, subset.length));
    S.add({
      phase: '③ 逐字段核对',
      title: `第 ${p.dup + 1} 行 vs 第 ${p.origin + 1} 行`,
      narration: `逐字段对照：${cols.join('、')} 全部相同 —— 表里看不到任何差别。` +
        `如果是「同一学生被录入两次」，它会同时抬高样本量、拉低平均分的可信度，必须去重。`,
      duration: 3000,
      tone: 'danger',
      code: S.codeAt(0),
      table: S.table(T(df, { columns: df.columns, rowState: (r, j) => (j === p.dup || j === p.origin ? 'focus' : 'dim') })),
      stage: {
        kind: 'sidebyside',
        columns: cols,
        a: { title: `索引 ${p.origin}`, sub: `${labelOf(df, labelCol, p.origin)}（首次出现 · 保留）`, cells: cols.map((c) => df._rows[p.origin].cells[df.columns.indexOf(c)]) },
        b: { title: `索引 ${p.dup}`, sub: `${labelOf(df, labelCol, p.dup)}（重复出现 · 删除）`, cells: cols.map((c) => df._rows[p.dup].cells[df.columns.indexOf(c)]) },
      },
    });
  }

  /* 删除重复行 */
  const result = df.dropDuplicates(subset, 'first');
  const keepRids = new Set(result._rows.map((r) => r.rid));

  S.add({
    phase: '④ 删除重复',
    title: `标记 ${dupRids.length} 行为待删除`,
    narration: `keep="first" 表示保留第一次出现的记录，后面所有指纹相同的行都被标记。准备执行删除。`,
    duration: 1800,
    tone: 'danger',
    code: S.codeAt(1),
    table: S.table(T(df, {
      rowState: (r) => (keepRids.has(r.rid) ? 'dim' : 'danger'),
      cellState: (r) => (dupRids.includes(r.rid) ? 'dup' : null),
    })),
    stage: fpStage(df.nrow - 1, df.nrow, { marking: true }),
  });

  S.add({
    phase: '④ 删除重复',
    title: `删除完成 · ${df.nrow} 行 → ${result.nrow} 行`,
    narration: `重复行被摘除，索引再次出现断层，需要 reset_index 缝合。`,
    duration: 2000,
    tone: 'warn',
    code: S.codeAt(2),
    table: S.table(T(result, { rowState: () => 'normal' })),
    stage: fpStage(df.nrow - 1, df.nrow, { collapsed: true, kept: result.nrow }),
    hud: [{ label: 'shape', value: `${df.nrow}×${df.ncol} → ${result.nrow}×${df.ncol}`, tone: 'ok' },
      { label: '删除', value: `${dupRids.length} 行`, tone: 'danger' }],
  });

  S.add({
    phase: '⑤ 结果',
    title: '每条记录现在都是唯一的',
    narration: `去重后共有 ${result.nrow} 条唯一记录。${labelCol} 字段不再有重复值 —— 这是后续任何统计都成立的前提。`,
    duration: 2400,
    tone: 'ok',
    final: true,
    code: S.codeAt(2),
    table: S.table(T(result, { cellState: (r) => null })),
    stage: {
      kind: 'compare',
      title: '去重前后',
      before: { shape: [df.nrow, df.ncol], stats: null },
      after: { shape: [result.nrow, result.ncol], stats: null },
      removed: dupPairs.map((p) => ({ i: p.dup, name: labelOf(df, labelCol, p.dup), value: `= 索引 ${p.origin}`, kind: 'dup' })),
    },
    hud: [{ label: '唯一记录', value: `${result.nrow} / ${df.nrow}`, tone: 'ok' }],
  });

  return { frames: S.frames, result, summary: `删除 ${dupRids.length} 条重复记录` };
}

/* ================================================================
 * 缺失值：整行删除 dropna
 * ================================================================ */
export function opDropna(df, cfg = {}) {
  const labelCol = pickLabelCol(df);
  const subset = cfg.subset && cfg.subset.length ? cfg.subset : df.columns.slice();
  const S = new Script(df, 'dropna');
  S.code(CODE.dropna());

  const subIdx = subset.map((c) => df.columns.indexOf(c));
  const badRows = [];
  df._rows.forEach((r, i) => { if (subIdx.some((ci) => isNA(r.cells[ci]))) badRows.push(i); });
  const badSet = new Set(badRows);
  const nulls = df.nullCounts();
  const totalNull = Object.values(nulls).reduce((a, b) => a + b, 0);

  const nullMap = (cursor, extra = {}) => ({
    kind: 'nullmap',
    columns: df.columns.map((c) => ({ name: c, cells: df.col(c).map(isNA), nulls: nulls[c] })),
    total: df.nrow,
    cursor,
    badRows,
    subset,
    ...extra,
  });

  S.add({
    phase: '① 先看清缺失',
    title: `全表共 ${totalNull} 个缺失值，分布在 ${Object.values(nulls).filter((v) => v > 0).length} 个字段`,
    narration: `处理缺失之前先量化：isnull().sum() 给出每个字段的缺失数量。` +
      `下图每一列代表一个字段，每个小格代表一行 —— 亮起的格子就是缺失位置。`,
    duration: 3000,
    tone: 'info',
    code: [`df.isnull().sum()`],
    table: S.table(T(df, { cellState: (r, i, name) => (isNA(r.cells[df.columns.indexOf(name)]) ? 'na' : null) })),
    stage: nullMap(-1),
    hud: [{ label: '缺失总数', value: String(totalNull), tone: 'danger' },
      { label: '受影响字段', value: String(Object.values(nulls).filter((v) => v > 0).length), tone: 'warn' }],
  });

  S.add({
    phase: '① 先看清缺失',
    title: `dropna 的判据：一行只要有任何缺失，整行丢弃`,
    narration: `相当于 how="any"：${df.columns.length} 个字段里，只要有一个是 NaN，这一行就无法参与后续计算，被整体丢弃。` +
      `代价是要损失 ${badRows.length} 行数据 —— 如果数据珍贵，应该改用 fillna。`,
    duration: 2600,
    tone: 'warn',
    code: S.codeAt(0),
    table: S.table(T(df, {
      cellState: (r, i, name) => (isNA(r.cells[df.columns.indexOf(name)]) ? 'na' : null),
    })),
    stage: nullMap(-1, { explain: true }),
  });

  /* 逐行判定 */
  let i = 0;
  const CHUNK = 3;
  while (i < df.nrow) {
    const end = Math.min(i + CHUNK, df.nrow);
    const hits = [];
    for (let k = i; k < end; k++) if (badSet.has(k)) hits.push(k);
    const names = [];
    for (let k = i; k < end; k++) names.push(labelOf(df, labelCol, k));

    S.add({
      phase: '② 逐行判定',
      title: hits.length ? `第 ${hits.map((k) => k + 1).join('、')} 行含缺失 → 丢弃` : `第 ${i + 1}–${end} 行 · 完整保留`,
      narration: hits.length
        ? `${hits.map((k) => `${labelOf(df, labelCol, k)} 的 ${subset.filter((c) => isNA(df._rows[k].cells[df.columns.indexOf(c)])).join('、')} 缺失`).join('；')} → 这些整行都会被摘除。`
        : `第 ${i + 1}–${end} 行（${names.join('、')}）所有字段都完整，安全保留。`,
      duration: hits.length ? 1500 : 800,
      tone: hits.length ? 'danger' : 'info',
      code: S.codeAt(0),
      table: S.table(T(df, {
        rowState: (r, j) => (j >= i && j < end ? 'focus' : (j < i ? (badSet.has(j) ? 'danger' : 'dim') : 'normal')),
        cellState: (r, j, name) => (isNA(r.cells[df.columns.indexOf(name)]) ? 'na' : null),
      })),
      stage: nullMap(end - 1),
      hud: [{ label: '已检查', value: `${end}/${df.nrow}`, tone: 'cyan' },
        { label: '待删除', value: String(badRows.filter((k) => k < end).length), tone: 'danger' }],
    });
    i = end;
  }

  const result = df.dropna(subset);

  S.add({
    phase: '③ 执行删除',
    title: `摘除 ${badRows.length} 行 · 剩下 ${result.nrow} 行`,
    narration: `所有含缺失的行被一次性移除。注意这些行里本来完好的数据也一起丢了 —— 这就是 dropna 的代价。`,
    duration: 2200,
    tone: 'warn',
    code: S.codeAt(1),
    table: S.table(T(result, {})),
    stage: nullMap(-1, { collapsed: true, kept: result.nrow }),
    hud: [{ label: 'shape', value: `${df.nrow}×${df.ncol} → ${result.nrow}×${df.ncol}`, tone: 'ok' }],
  });

  const remaining = result.nullCounts();
  S.add({
    phase: '④ 结果',
    title: '缺失值清零',
    narration: `现在每一列的非空计数都等于 ${result.nrow}。数据表「干净」了，可以放心进入统计与建模。`,
    duration: 2600,
    tone: 'ok',
    final: true,
    code: S.codeAt(2),
    table: S.table(T(result, {})),
    stage: nullMap(-1, { done: true, kept: result.nrow, afterNulls: remaining }),
    hud: [{ label: '缺失总数', value: `${totalNull} → 0`, tone: 'ok' },
      { label: '损失行数', value: `${badRows.length}（${(badRows.length / df.nrow * 100).toFixed(1)}%）`, tone: 'warn' }],
  });

  return { frames: S.frames, result, summary: `删除含缺失值的 ${badRows.length} 行` };
}

/* ================================================================
 * 缺失值：填充 fillna
 * ================================================================ */
export function opFillna(df, cfg = {}) {
  const col = cfg.col || df.columns.find((c) => df.nullCounts()[c] > 0) || df.columns[0];
  const strategy = cfg.strategy || 'mean';         // mean | median | ffill | value
  const unit = unitOf(df, col);
  const labelCol = pickLabelCol(df);
  const S = new Script(df, 'fillna');

  const values = df.col(col);
  const ci = df.columns.indexOf(col);
  const missIdx = values.map((v, i) => (isNA(v) ? i : -1)).filter((i) => i >= 0);
  const nums = values.filter((v) => typeof v === 'number' && Number.isFinite(v));

  let fillValue = cfg.value;
  let repr;
  if (strategy === 'mean') { fillValue = Math.round(mean(nums) * 100) / 100; repr = `${fmt(fillValue)}  # 列均值`; }
  else if (strategy === 'median') { fillValue = Math.round(median(nums) * 100) / 100; repr = `${fmt(fillValue)}  # 列中位数`; }
  else if (strategy === 'ffill') { repr = `method="ffill"`; }
  else { repr = fmt(fillValue); }

  S.code(CODE.fillna({ col, repr }));

  const fillMap = {};
  if (strategy === 'ffill') {
    let last = null;
    values.forEach((v, i) => {
      if (isNA(v)) { if (last !== null) fillMap[i] = last; }
      else last = v;
    });
  } else {
    missIdx.forEach((i) => { fillMap[i] = fillValue; });
  }

  const strategyName = { mean: '列均值', median: '列中位数', ffill: '前向填充（用上一个有效值）', value: '指定常量' }[strategy] || strategy;

  S.add({
    phase: '① 选择策略',
    title: `${col} 列有 ${missIdx.length} 处缺失 · 采用「${strategyName}」`,
    narration: `删除会丢掉整行，填充只修补空格。选择策略要考虑数据语义：` +
      (strategy === 'ffill'
        ? `对有序数据（如时间序列）用前向填充 ffill 最自然 —— 用上一个观测值顶替空缺。`
        : `对数值型字段用${strategyName}（${repr.split('#')[0].trim()}）最稳妥，它能保持列的整体分布位置不变。`),
    duration: 3000,
    tone: 'info',
    code: S.codeAt(0),
    table: S.table(T(df, { rowState: (r, i) => (missIdx.includes(i) ? 'focus' : 'dim'), cellState: (r, i, name) => (name === col && isNA(r.cells[ci]) ? 'na' : null) })),
    stage: { kind: 'fillcol', col, unit, labelCol, cursor: -1, missIdx, fillMap: {}, entries: values.map((v, i) => ({ i, name: labelOf(df, labelCol, i), value: v, na: isNA(v), fill: null })), repr },
    hud: [{ label: '缺失', value: String(missIdx.length), tone: 'danger' },
      { label: '填充值', value: repr.split('#')[0].trim(), tone: 'cyan' }],
  });

  const doneMap = {};
  missIdx.forEach((k, n) => {
    doneMap[k] = fillMap[k];
    S.add({
      phase: '② 逐个填充',
      title: `第 ${k + 1} 行 · ${labelOf(df, labelCol, k)}`,
      narration: strategy === 'ffill'
        ? `第 ${k + 1} 行 ${col} 缺失 → 采用它上方最近的有效值 ${fmt(fillMap[k])}${unit}。`
        : `第 ${k + 1} 行 ${col} 缺失 → 写入${strategyName} ${fmt(fillMap[k])}${unit}。原始数据不变，只是把这个空位补上。`,
      duration: 1150,
      tone: 'gold',
      code: S.codeAt(0),
      table: S.table(T(df, {
        rowState: (r, i) => (i === k ? 'focus' : 'dim'),
        cellState: (r, i, name) => {
          if (name !== col) return null;
          if (i === k) return 'filling';
          if (doneMap[i] !== undefined) return 'filled';
          if (isNA(values[i])) return 'na';
          return null;
        },
      })),
      stage: {
        kind: 'fillcol', col, unit, labelCol, cursor: k, missIdx, fillMap: doneMap, repr,
        entries: values.map((v, i) => ({ i, name: labelOf(df, labelCol, i), value: v, na: isNA(v), fill: doneMap[i] ?? null })),
      },
      hud: [{ label: '已填充', value: `${n + 1} / ${missIdx.length}`, tone: 'gold' }],
    });
  });

  const result = df.fillna(strategy === 'ffill' ? { method: 'ffill' } : fillValue, [col]);
  S.add({
    phase: '③ 结果',
    title: `${col} 列补全完成`,
    narration: `行数保持不变（${result.nrow} 行），但缺失值从 ${missIdx.length} 降到 0。` +
      (strategy === 'mean' || strategy === 'median' ? `注意：填充会略微压缩方差（均值填得越多，分布越向中心靠拢），这是用完整性换取的代价。` : ''),
    duration: 2800,
    tone: 'ok',
    final: true,
    code: S.codeAt(0),
    table: S.table(T(result, { cellState: (r, i, name) => (name === col && doneMap[i] !== undefined ? 'filled' : null) })),
    stage: {
      kind: 'compare', title: `fillna · ${col}`, col, unit,
      before: { shape: [df.nrow, df.ncol], stats: colSummary(df, col) },
      after: { shape: [result.nrow, result.ncol], stats: colSummary(result, col) },
      removed: missIdx.map((i) => ({ i, name: labelOf(df, labelCol, i), value: 'NaN', kind: 'na', clamped: doneMap[i] })),
    },
    hud: [{ label: 'shape', value: `${df.nrow}×${df.ncol} → ${result.nrow}×${result.ncol}`, tone: 'ok' },
      { label: '缺失', value: `${missIdx.length} → 0`, tone: 'ok' }],
  });

  return { frames: S.frames, result, summary: `用${strategyName}填充 ${col} 的 ${missIdx.length} 处缺失` };
}
