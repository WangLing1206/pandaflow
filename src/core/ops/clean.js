/* ------------------------------------------------------------------
 * ops/clean.js — 清洗与缺失值
 *  dropna / fillna / interpolate / drop_duplicates / duplicated
 *  drop_extremes ★ / clip / nlargest / nsmallest
 * ------------------------------------------------------------------ */

import { Script, T, CODE } from '../frames.js';
import { L } from '../../i18n/index.js';
import { fmt, isNA } from '../utils.js';
import { ph, pickLabelCol, pickCategoryCol, nullestCol, unitOf, colSummary, domain, assertNumeric, labelOf } from './kit.js';

/* ================================================================
 * 重复行检测与删除
 * ================================================================ */
export function opDropDuplicates(df, cfg = {}) {
  const subset = cfg.subset && cfg.subset.length ? cfg.subset : df.columns.slice();
  const labelCol = pickLabelCol(df);
  const S = new Script(df, 'drop_duplicates');
  S.code(CODE.dropDup(JSON.stringify(subset)));

  const fps = df._rows.map((r) => df.fingerprint(r, subset));
  const firstSeen = new Map();
  const dupRids = [];
  const dupPairs = [];
  df._rows.forEach((r, i) => {
    const fp = fps[i];
    if (firstSeen.has(fp)) { dupRids.push(r.rid); dupPairs.push({ dup: i, origin: firstSeen.get(fp) }); }
    else firstSeen.set(fp, i);
  });

  const shortHash = (fp) => {
    let h = 2166136261;
    for (let i = 0; i < fp.length; i++) { h ^= fp.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(16).padStart(8, '0').slice(0, 6);
  };
  const allCols = subset.length === df.columns.length;

  const fpStage = (cursor, seenCount, extra = {}) => ({
    kind: 'fingerprint', col: labelCol, total: df.nrow, cursor, seenCount,
    entries: df._rows.map((r, i) => ({
      i, rid: r.rid, name: labelOf(df, labelCol, i), hash: shortHash(fps[i]),
      duplicate: dupRids.includes(r.rid),
      originIdx: dupPairs.find((p) => p.dup === i)?.origin ?? -1,
      checked: i < seenCount,
    })),
    subset, ...extra,
  });

  S.add({
    phase: ph('①', '判重依据', 'The rule'),
    title: L(`按 ${allCols ? '全部字段' : subset.join(' + ')} 判定重复`,
      `Duplicates decided by ${allCols ? 'all columns' : subset.join(' + ')}`),
    narration: L(
      `pandas 判断两行是否相同的方法很直白：把参与判重的字段拼成一条字符串（行指纹），再放进哈希表里找有没有出现过。${allCols ? '这里没有指定 subset，所以全部字段都参与比对。' : `这里指定了 subset=${JSON.stringify(subset)}，其余字段不参与判重。`}`,
      `pandas decides "same row?" by concatenating the chosen columns into one string (a row fingerprint) and looking it up in a hash table. ${allCols ? 'No subset was given, so every column takes part.' : `Here subset=${JSON.stringify(subset)} is used — other columns are ignored.`}`),
    duration: 2800, tone: 'info', code: S.codeAt(0),
    table: S.table(T(df, { cellState: (r, i, name) => (subset.includes(name) ? 'focus' : 'dim') })),
    stage: fpStage(-1, 0),
    hud: [{ label: 'shape', value: `${df.nrow} × ${df.ncol}`, tone: 'mute' },
      { label: 'subset', value: String(subset.length), tone: 'cyan' }],
  });

  const CHUNK = 4;
  let i = 0, found = 0;
  while (i < df.nrow) {
    const end = Math.min(i + CHUNK, df.nrow);
    const inChunk = [];
    for (let k = i; k < end; k++) {
      if (dupRids.includes(df._rows[k].rid)) { found++; inChunk.push({ k, origin: dupPairs.find((p) => p.dup === k).origin }); }
    }
    const names = [];
    for (let k = i; k < end; k++) names.push(labelOf(df, labelCol, k));
    S.add({
      phase: ph('②', '逐行计算指纹', 'Fingerprint each row'),
      title: L(`第 ${i + 1}–${end} 行 · 计算行指纹`, `Rows ${i + 1}–${end} · compute fingerprints`),
      narration: inChunk.length
        ? L(`第 ${inChunk.map((o) => o.k + 1).join('、')} 行的指纹与前面第 ${inChunk.map((o) => o.origin + 1).join('、')} 行完全一致（都是 ${shortHash(fps[inChunk[0].k])}）→ 判定为重复行。`,
          `Rows ${inChunk.map((o) => o.k + 1).join(', ')} share the same fingerprint (${shortHash(fps[inChunk[0].k])}) as row${inChunk.length > 1 ? 's' : ''} ${inChunk.map((o) => o.origin + 1).join(', ')} → duplicates.`)
        : L(`第 ${i + 1}–${end} 行（${names.join('、')}）的指纹都是全新的，此前从未出现 → 全部保留。`,
          `Rows ${i + 1}–${end} (${names.join(', ')}) produce brand-new fingerprints → all kept.`),
      duration: inChunk.length ? 1600 : 850,
      tone: inChunk.length ? 'danger' : 'info',
      code: S.codeAt(0),
      table: S.table(T(df, {
        rowState: (r, j) => (j >= i && j < end ? 'focus' : (j < i ? 'dim' : 'normal')),
        cellState: (r) => (dupRids.includes(r.rid) ? 'dup' : null),
      })),
      stage: fpStage(end - 1, end),
      hud: [{ label: 'checked', value: `${end} / ${df.nrow}`, tone: 'cyan' },
        { label: 'dupes', value: String(found), tone: 'danger' }],
    });
    i = end;
  }

  if (dupPairs.length) {
    const p = dupPairs[0];
    const cols = subset.slice(0, Math.min(6, subset.length));
    S.add({
      phase: ph('③', '逐字段核对', 'Field by field'),
      title: L(`第 ${p.dup + 1} 行 vs 第 ${p.origin + 1} 行`, `Row ${p.dup + 1} vs row ${p.origin + 1}`),
      narration: L(`逐字段对照：${cols.join('、')} 全部相同 —— 表里看不到任何差别。同一份记录被录入了两次，它会同时抬高样本量、拉低统计的可信度，必须去重。`,
        `Comparing field by field: ${cols.join(', ')} are all identical — nothing distinguishes them in the table. One record was entered twice; it inflates the sample size and skews every statistic.`),
      duration: 2800, tone: 'danger', code: S.codeAt(0),
      table: S.table(T(df, { rowState: (r, j) => (j === p.dup || j === p.origin ? 'focus' : 'dim') })),
      stage: {
        kind: 'sidebyside', columns: cols,
        a: { title: `index ${p.origin}`, sub: L(`${labelOf(df, labelCol, p.origin)}（首次出现 · 保留）`, `${labelOf(df, labelCol, p.origin)} — first seen, kept`), cells: cols.map((c) => df._rows[p.origin].cells[df.columns.indexOf(c)]) },
        b: { title: `index ${p.dup}`, sub: L(`${labelOf(df, labelCol, p.dup)}（重复出现 · 删除）`, `${labelOf(df, labelCol, p.dup)} — duplicate, dropped`), cells: cols.map((c) => df._rows[p.dup].cells[df.columns.indexOf(c)]) },
      },
    });
  }

  const result = df.dropDuplicates(subset, 'first');
  const keepRids = new Set(result._rows.map((r) => r.rid));

  S.add({
    phase: ph('④', '删除重复', 'Drop duplicates'),
    title: L(`标记 ${dupRids.length} 行为待删除`, `${dupRids.length} row${dupRids.length > 1 ? 's' : ''} marked for removal`),
    narration: L('keep="first" 表示保留第一次出现的记录，后面所有指纹相同的行都被标记。准备执行删除。',
      'keep="first" keeps the earliest occurrence; every later row with the same fingerprint gets marked.'),
    duration: 1500, tone: 'danger', code: S.codeAt(1),
    table: S.table(T(df, { rowState: (r) => (keepRids.has(r.rid) ? 'dim' : 'danger'), cellState: (r) => (dupRids.includes(r.rid) ? 'dup' : null) })),
    stage: fpStage(df.nrow - 1, df.nrow, { marking: true }),
  });

  S.use(result);
  S.add({
    phase: ph('④', '删除重复', 'Drop duplicates'),
    title: L(`删除完成 · ${df.nrow} 行 → ${result.nrow} 行`, `Done · ${df.nrow} rows → ${result.nrow} rows`),
    narration: L('重复行被摘除，索引再次出现断层，需要 reset_index 缝合。',
      'The duplicate rows are gone; the index now has gaps, so reset_index stitches it back.'),
    duration: 1800, tone: 'warn', code: S.codeAt(2),
    table: S.table(T(result, { rowState: () => 'normal' })),
    stage: fpStage(df.nrow - 1, df.nrow, { collapsed: true, kept: result.nrow }),
    hud: [{ label: 'shape', value: `${df.nrow}×${df.ncol} → ${result.nrow}×${result.ncol}`, tone: 'ok' },
      { label: 'dropped', value: String(dupRids.length), tone: 'danger' }],
  });

  S.add({
    phase: ph('⑤', '结果', 'Result'),
    title: L('每条记录现在都是唯一的', 'Every record is now unique'),
    narration: L(`去重后共有 ${result.nrow} 条唯一记录，${labelCol} 字段不再有重复值 —— 这是后续任何统计都成立的前提。`,
      `${result.nrow} unique records remain, and ${labelCol} no longer repeats — the precondition for every later statistic.`),
    duration: 2200, tone: 'ok', final: true, code: S.codeAt(2),
    table: S.table(T(result, {})),
    stage: {
      kind: 'compare', title: L('去重前后', 'Before / after dedup'),
      before: { shape: [df.nrow, df.ncol], stats: null },
      after: { shape: [result.nrow, result.ncol], stats: null },
      removed: dupPairs.map((p) => ({ i: p.dup, name: labelOf(df, labelCol, p.dup), value: `= #${p.origin}`, kind: 'dup' })),
    },
    hud: [{ label: 'unique', value: `${result.nrow} / ${df.nrow}`, tone: 'ok' }],
  });

  return { frames: S.frames, result, summary: L(`删除 ${dupRids.length} 条重复记录`, `Dropped ${dupRids.length} duplicate rows`) };
}

/* ================================================================
 * duplicated —— 只标记不删除
 * ================================================================ */
export function opDuplicated(df, cfg = {}) {
  const subset = cfg.subset && cfg.subset.length ? cfg.subset : df.columns.slice();
  const labelCol = pickLabelCol(df);
  const S = new Script(df, 'duplicated');
  S.code([`# 返回一个布尔序列：该行是否重复出现`, `mask = df.duplicated(subset=${JSON.stringify(subset)}, keep="first")`, `df[mask]`]);

  const fps = df._rows.map((r) => df.fingerprint(r, subset));
  const seen = new Set();
  const flags = fps.map((fp) => { const d = seen.has(fp); seen.add(fp); return d; });
  const nDup = flags.filter(Boolean).length;

  S.add({
    phase: ph('①', 'duplicated 只做标记', 'duplicated only flags'),
    title: L('与 drop_duplicates 的区别：它不删除任何行', 'Unlike drop_duplicates, nothing is removed'),
    narration: L('duplicated() 返回一个与行数等长的布尔序列，标记哪些行是重复出现的。它常用于「先看看有多少重复」或者「把重复行筛出来人工核对」。',
      'duplicated() returns a boolean Series as long as the frame, flagging which rows repeat. Use it to count duplicates first, or to pull them out for manual review.'),
    duration: 2800, tone: 'info', code: S.codeAt(0),
    table: S.table(T(df, { cellState: (r, i, name) => (subset.includes(name) ? 'focus' : 'dim') })),
    stage: { kind: 'mask', col: L('duplicated', 'duplicated'), op: '==', value: 'True', unit: '', labelCol, expr: 'df.duplicated()', cursor: -1, total: df.nrow, entries: df._rows.map((r, i) => ({ i, rid: r.rid, name: labelOf(df, labelCol, i), value: '?', pass: false, evaluated: false, na: false })) },
  });

  const CHUNK = 6;
  for (let i = 0; i < df.nrow; i += CHUNK) {
    const end = Math.min(i + CHUNK, df.nrow);
    const hits = flags.slice(i, end).filter(Boolean).length;
    S.add({
      phase: ph('②', '逐行判定', 'Row by row'),
      title: L(`第 ${i + 1}–${end} 行：${hits} 个 True`, `Rows ${i + 1}–${end}: ${hits} True`),
      narration: hits
        ? L(`这一段里有 ${hits} 行的指纹此前已经出现过 → 标记为 True。`,
          `${hits} row${hits > 1 ? 's' : ''} in this block reuse an earlier fingerprint → True.`)
        : L('这一段的指纹全部是新的 → 标记为 False。', 'All fingerprints here are new → False.'),
      duration: 900, tone: hits ? 'danger' : 'info', code: S.codeAt(1),
      table: S.table(T(df, {
        rowState: (r, j) => (j >= i && j < end ? 'focus' : (j < i ? (flags[j] ? 'danger' : 'dim') : 'normal')),
        cellState: (r, j) => (flags[j] ? 'dup' : null),
      })),
      stage: {
        kind: 'mask', col: 'duplicated', op: '==', value: 'True', unit: '', labelCol, expr: 'df.duplicated()',
        cursor: end - 1, total: df.nrow,
        entries: df._rows.map((r, j) => ({ i: j, rid: r.rid, name: labelOf(df, labelCol, j), value: '?', pass: flags[j], evaluated: j < end, na: false })),
      },
      hud: [{ label: 'True', value: String(flags.slice(0, end).filter(Boolean).length), tone: 'danger' }],
    });
  }

  S.add({
    phase: ph('③', '结果', 'Result'),
    title: L(`${nDup} 行被标记为重复`, `${nDup} rows flagged as duplicates`),
    narration: L('注意行数完全没变 —— duplicated 是「只读」的。你可以用 df[mask] 把重复行单独取出来看。',
      'Row count is untouched — duplicated is read-only. Use df[mask] to extract just the duplicates.'),
    duration: 2200, tone: 'ok', final: true, code: S.codeAt(2),
    table: S.table(T(df, { rowState: (r, i) => (flags[i] ? 'danger' : 'normal'), cellState: (r, i) => (flags[i] ? 'dup' : null) })),
    stage: {
      kind: 'compare', title: L('duplicated 标记结果', 'duplicated() flags'),
      before: { shape: [df.nrow, df.ncol], stats: null },
      after: { shape: [nDup, df.ncol], stats: null },
      removed: [],
    },
    hud: [{ label: 'duplicated', value: `${nDup} / ${df.nrow}`, tone: 'warn' }],
  });

  return { frames: S.frames, result: df, summary: L(`标记 ${nDup} 行重复`, `Flagged ${nDup} duplicates`) };
}

/* ================================================================
 * dropna
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
  const affected = Object.values(nulls).filter((v) => v > 0).length;

  const nullMap = (cursor, extra = {}) => ({
    kind: 'nullmap',
    columns: df.columns.map((c) => ({ name: c, cells: df.col(c).map(isNA), nulls: nulls[c] })),
    total: df.nrow, cursor, badRows, subset, ...extra,
  });

  S.add({
    phase: ph('①', '先看清缺失', 'See the gaps first'),
    title: L(`全表共 ${totalNull} 个缺失值，分布在 ${affected} 个字段`, `${totalNull} missing cells across ${affected} columns`),
    narration: L('处理缺失之前先量化：isnull().sum() 给出每个字段的缺失数量。下图每一行代表一个字段，每个小格代表一行 —— 亮起的格子就是缺失位置。',
      'Quantify before you fix: isnull().sum() counts the gaps per column. Below, each row is a column and each cell is a row — lit cells are missing.'),
    duration: 2800, tone: 'info', code: ['df.isnull().sum()'],
    table: S.table(T(df, { cellState: (r, i, name) => (isNA(r.cells[df.columns.indexOf(name)]) ? 'na' : null) })),
    stage: nullMap(-1),
    hud: [{ label: 'missing', value: String(totalNull), tone: 'danger' },
      { label: 'columns', value: String(affected), tone: 'warn' }],
  });

  S.add({
    phase: ph('①', '先看清缺失', 'See the gaps first'),
    title: L('dropna 的判据：一行只要有任何缺失，整行丢弃', 'dropna: any missing cell drops the whole row'),
    narration: L(`相当于 how="any"：${df.columns.length} 个字段里只要有一个是 NaN，这一行就无法参与后续计算，被整体丢弃。代价是要损失 ${badRows.length} 行数据 —— 如果数据珍贵，应该改用 fillna。`,
      `This is how="any": if any of the ${df.columns.length} fields is NaN the row cannot be used and is dropped whole. The cost is ${badRows.length} rows — if data is precious, use fillna instead.`),
    duration: 2400, tone: 'warn', code: S.codeAt(0),
    table: S.table(T(df, { cellState: (r, i, name) => (isNA(r.cells[df.columns.indexOf(name)]) ? 'na' : null) })),
    stage: nullMap(-1, { explain: true }),
  });

  let i = 0;
  const CHUNK = 3;
  while (i < df.nrow) {
    const end = Math.min(i + CHUNK, df.nrow);
    const hits = [];
    for (let k = i; k < end; k++) if (badSet.has(k)) hits.push(k);
    const names = [];
    for (let k = i; k < end; k++) names.push(labelOf(df, labelCol, k));
    S.add({
      phase: ph('②', '逐行判定', 'Row by row'),
      title: hits.length ? L(`第 ${hits.map((k) => k + 1).join('、')} 行含缺失 → 丢弃`, `Row${hits.length > 1 ? 's' : ''} ${hits.map((k) => k + 1).join(', ')} have gaps → drop`) : L(`第 ${i + 1}–${end} 行 · 完整保留`, `Rows ${i + 1}–${end} · complete`),
      narration: hits.length
        ? L(`${hits.map((k) => `${labelOf(df, labelCol, k)} 的 ${subset.filter((c) => isNA(df._rows[k].cells[df.columns.indexOf(c)])).join('、')} 缺失`).join('；')} → 这些整行都会被摘除。`,
          `${hits.map((k) => `${labelOf(df, labelCol, k)} is missing ${subset.filter((c) => isNA(df._rows[k].cells[df.columns.indexOf(c)])).join(', ')}`).join('; ')} → these whole rows go.`)
        : L(`第 ${i + 1}–${end} 行（${names.join('、')}）所有字段都完整，安全保留。`,
          `Rows ${i + 1}–${end} (${names.join(', ')}) are complete — kept.`),
      duration: hits.length ? 1300 : 750,
      tone: hits.length ? 'danger' : 'info', code: S.codeAt(0),
      table: S.table(T(df, {
        rowState: (r, j) => (j >= i && j < end ? 'focus' : (j < i ? (badSet.has(j) ? 'danger' : 'dim') : 'normal')),
        cellState: (r, j, name) => (isNA(r.cells[df.columns.indexOf(name)]) ? 'na' : null),
      })),
      stage: nullMap(end - 1),
      hud: [{ label: 'checked', value: `${end}/${df.nrow}`, tone: 'cyan' },
        { label: 'to drop', value: String(badRows.filter((k) => k < end).length), tone: 'danger' }],
    });
    i = end;
  }

  const result = df.dropna(subset);
  S.use(result);
  S.add({
    phase: ph('③', '执行删除', 'Execute'),
    title: L(`摘除 ${badRows.length} 行 · 剩下 ${result.nrow} 行`, `${badRows.length} rows removed · ${result.nrow} left`),
    narration: L('所有含缺失的行被一次性移除。注意这些行里本来完好的数据也一起丢了 —— 这就是 dropna 的代价。',
      'Every row with a gap is removed at once. Note that the otherwise-fine values in those rows are lost too — that is the price of dropna.'),
    duration: 2000, tone: 'warn', code: S.codeAt(1),
    table: S.table(T(result, {})),
    stage: nullMap(-1, { collapsed: true, kept: result.nrow }),
    hud: [{ label: 'shape', value: `${df.nrow}×${df.ncol} → ${result.nrow}×${result.ncol}`, tone: 'ok' }],
  });

  const remaining = result.nullCounts();
  S.add({
    phase: ph('④', '结果', 'Result'),
    title: L('缺失值清零', 'Zero missing values'),
    narration: L(`现在每一列的非空计数都等于 ${result.nrow}。数据表「干净」了，可以放心进入统计与建模。`,
      `Every column now has ${result.nrow} non-null values. The frame is clean and ready for statistics.`),
    duration: 2400, tone: 'ok', final: true, code: S.codeAt(2),
    table: S.table(T(result, {})),
    stage: nullMap(-1, { done: true, kept: result.nrow, afterNulls: remaining }),
    hud: [{ label: 'missing', value: `${totalNull} → 0`, tone: 'ok' },
      { label: 'lost', value: `${badRows.length} (${(badRows.length / df.nrow * 100).toFixed(1)}%)`, tone: 'warn' }],
  });

  return { frames: S.frames, result, summary: L(`删除含缺失值的 ${badRows.length} 行`, `Dropped ${badRows.length} rows with missing values`) };
}

/* ================================================================
 * fillna
 * ================================================================ */
export function opFillna(df, cfg = {}) {
  const col = cfg.col || nullestCol(df);
  const strategy = cfg.strategy || 'mean';
  const unit = unitOf(df, col);
  const labelCol = pickLabelCol(df);
  const S = new Script(df, 'fillna');

  const values = df.col(col);
  const ci = df.columns.indexOf(col);
  const missIdx = values.map((v, i) => (isNA(v) ? i : -1)).filter((i) => i >= 0);
  const ns = values.filter((v) => typeof v === 'number' && Number.isFinite(v));

  let fillValue = cfg.value;
  let repr, strategyName;
  if (strategy === 'mean') {
    fillValue = Math.round(ns.reduce((a, b) => a + b, 0) / (ns.length || 1) * 100) / 100;
    repr = `${fmt(fillValue)}`; strategyName = L('列均值', 'column mean');
  } else if (strategy === 'median') {
    const s = ns.slice().sort((a, b) => a - b);
    fillValue = s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
    repr = `${fmt(fillValue)}`; strategyName = L('列中位数', 'column median');
  } else if (strategy === 'ffill') {
    repr = 'method="ffill"'; strategyName = L('前向填充（用上一个有效值）', 'forward fill (previous valid value)');
  } else if (strategy === 'zero') {
    fillValue = 0; repr = '0'; strategyName = L('常量 0', 'constant 0');
  } else {
    repr = fmt(fillValue); strategyName = L('指定常量', 'a constant');
  }

  S.code([`df["${col}"] = df["${col}"].fillna(${repr})`]);

  const fillMap = {};
  if (strategy === 'ffill') {
    let last = null;
    values.forEach((v, i) => { if (isNA(v)) { if (last !== null) fillMap[i] = last; } else last = v; });
  } else missIdx.forEach((i) => { fillMap[i] = fillValue; });

  const stage = (cursor, done, extra = {}) => ({
    kind: 'fillcol', col, unit, labelCol, cursor, missIdx, fillMap: done, repr,
    entries: values.map((v, i) => ({ i, name: labelOf(df, labelCol, i), value: v, na: isNA(v), fill: done[i] ?? null })),
    ...extra,
  });

  S.add({
    phase: ph('①', '选择策略', 'Pick a strategy'),
    title: L(`${col} 列有 ${missIdx.length} 处缺失 · 采用「${typeof strategyName === 'object' ? strategyName.zh : strategyName}」`,
      `${missIdx.length} gaps in "${col}" · using ${typeof strategyName === 'object' ? strategyName.en : strategyName}`),
    narration: L(`删除会丢掉整行，填充只修补空格。选择策略要考虑数据语义：${strategy === 'ffill' ? '对有序数据（如时间序列）用前向填充最自然 —— 用上一个观测值顶替空缺。' : '对数值型字段用均值或中位数最稳妥，它能保持列的整体分布位置不变。'}`,
      `Dropping loses whole rows; filling patches only the gaps. The right choice depends on meaning: ${strategy === 'ffill' ? 'for ordered data such as time series, forward fill is the natural choice — the previous observation carries forward.' : 'for numeric fields, the mean or median is safest: the overall location of the distribution stays put.'}`),
    duration: 2800, tone: 'info', code: S.codeAt(0),
    table: S.table(T(df, { rowState: (r, i) => (missIdx.includes(i) ? 'focus' : 'dim'), cellState: (r, i, name) => (name === col && isNA(r.cells[ci]) ? 'na' : null) })),
    stage: stage(-1, {}),
    hud: [{ label: 'missing', value: String(missIdx.length), tone: 'danger' },
      { label: 'fill', value: repr, tone: 'cyan' }],
  });

  const doneMap = {};
  missIdx.forEach((k, n) => {
    doneMap[k] = fillMap[k];
    S.add({
      phase: ph('②', '逐个填充', 'Fill one by one'),
      title: L(`第 ${k + 1} 行 · ${labelOf(df, labelCol, k)}`, `Row ${k + 1} · ${labelOf(df, labelCol, k)}`),
      narration: strategy === 'ffill'
        ? L(`第 ${k + 1} 行 ${col} 缺失 → 采用它上方最近的有效值 ${fmt(fillMap[k])}${unit}。`,
          `Row ${k + 1} has no ${col} → carry forward the nearest valid value above, ${fmt(fillMap[k])}${unit}.`)
        : L(`第 ${k + 1} 行 ${col} 缺失 → 写入${typeof strategyName === 'object' ? strategyName.zh : strategyName} ${fmt(fillMap[k])}${unit}。原始数据不变，只是把这个空位补上。`,
          `Row ${k + 1} has no ${col} → write ${typeof strategyName === 'object' ? strategyName.en : strategyName} ${fmt(fillMap[k])}${unit}. Nothing else changes; only the hole is filled.`),
      duration: 1000, tone: 'gold', code: S.codeAt(0),
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
      stage: stage(k, doneMap),
      hud: [{ label: 'filled', value: `${n + 1} / ${missIdx.length}`, tone: 'gold' }],
    });
  });

  const result = df.fillna(strategy === 'ffill' ? { method: 'ffill' } : fillValue, [col]);
  S.use(result);
  S.add({
    phase: ph('③', '结果', 'Result'),
    title: L(`${col} 列补全完成`, `${col} is complete`),
    narration: L(`行数保持不变（${result.nrow} 行），但缺失值从 ${missIdx.length} 降到 0。${strategy === 'mean' || strategy === 'median' ? '注意：填充会略微压缩方差 —— 用均值填得越多，分布越向中心靠拢，这是用完整性换来的代价。' : ''}`,
      `Row count is unchanged (${result.nrow}), but missing values went from ${missIdx.length} to 0.${strategy === 'mean' || strategy === 'median' ? ' Note that filling slightly compresses the variance: the more you impute the mean, the more the distribution pulls to the centre. Completeness has a price.' : ''}`),
    duration: 2600, tone: 'ok', final: true, code: S.codeAt(0),
    table: S.table(T(result, { cellState: (r, i, name) => (name === col && doneMap[i] !== undefined ? 'filled' : null) })),
    stage: {
      kind: 'compare', title: L(`fillna · ${col}`, `fillna · ${col}`), col, unit,
      before: { shape: [df.nrow, df.ncol], stats: colSummary(df, col), hist: df.hist(col, 12) },
      after: { shape: [result.nrow, result.ncol], stats: colSummary(result, col), hist: result.hist(col, 12) },
      removed: missIdx.map((i) => ({ i, name: labelOf(df, labelCol, i), value: 'NaN', kind: 'na', clamped: doneMap[i] })),
    },
    hud: [{ label: 'shape', value: `${df.nrow}×${df.ncol} → ${result.nrow}×${result.ncol}`, tone: 'ok' },
      { label: 'missing', value: `${missIdx.length} → 0`, tone: 'ok' }],
  });

  return { frames: S.frames, result, summary: L(`用${typeof strategyName === 'object' ? strategyName.zh : strategyName}填充 ${col} 的 ${missIdx.length} 处缺失`, `Filled ${missIdx.length} gaps in ${col} with the ${typeof strategyName === 'object' ? strategyName.en : strategyName}`) };
}

/* ================================================================
 * interpolate —— 线性插值
 * ================================================================ */
export function opInterpolate(df, cfg = {}) {
  const col = cfg.col || nullestCol(df);
  const unit = unitOf(df, col);
  const labelCol = pickLabelCol(df);
  const S = new Script(df, 'interpolate');
  S.code([`# 按索引顺序做线性插值`, `df["${col}"] = df["${col}"].interpolate(method="linear")`]);

  const values = df.col(col);
  const ci = df.columns.indexOf(col);
  const missIdx = values.map((v, i) => (isNA(v) ? i : -1)).filter((i) => i >= 0);

  // 对每一段连续缺失做线性插值
  const fillMap = {};
  let i = 0;
  while (i < values.length) {
    if (!isNA(values[i])) { i++; continue; }
    let j = i;
    while (j < values.length && isNA(values[j])) j++;
    const prev = i - 1 >= 0 && !isNA(values[i - 1]) ? values[i - 1] : null;
    const next = j < values.length && !isNA(values[j]) ? values[j] : null;
    const span = j - i + 1;
    for (let k = i; k < j; k++) {
      const t = (k - i + 1) / span;
      if (prev !== null && next !== null) fillMap[k] = Math.round((prev + (next - prev) * t) * 100) / 100;
      else if (prev !== null) fillMap[k] = prev;
      else if (next !== null) fillMap[k] = next;
    }
    i = j;
  }

  const stage = (cursor, done, extra = {}) => ({
    kind: 'fillcol', col, unit, labelCol, cursor, missIdx, fillMap: done, repr: 'linear',
    entries: values.map((v, k) => ({ i: k, name: labelOf(df, labelCol, k), value: v, na: isNA(v), fill: done[k] ?? null })),
    ...extra,
  });

  S.add({
    phase: ph('①', '为什么用插值', 'Why interpolate'),
    title: L(`${col} 有 ${missIdx.length} 处缺失`, `${missIdx.length} gaps in ${col}`),
    narration: L('均值填充会让所有缺失变成同一个数，抹掉局部趋势。interpolate 的做法是：在缺失点两侧找最近的有效值，按位置比例「连一条直线」算出中间的值 —— 对有序数据（时间序列、序列编号）更自然。',
      'Filling with the mean turns every gap into the same number and erases local trend. interpolate instead finds the nearest valid values on either side and reads off a straight line between them — far more natural for ordered data such as time series.'),
    duration: 3000, tone: 'info', code: S.codeAt(0),
    table: S.table(T(df, { rowState: (r, k) => (missIdx.includes(k) ? 'focus' : 'dim'), cellState: (r, k, name) => (name === col && isNA(r.cells[ci]) ? 'na' : null) })),
    stage: stage(-1, {}),
    hud: [{ label: 'missing', value: String(missIdx.length), tone: 'danger' }],
  });

  const doneMap = {};
  missIdx.forEach((k, n) => {
    doneMap[k] = fillMap[k];
    S.add({
      phase: ph('②', '按比例插值', 'Interpolate'),
      title: L(`第 ${k + 1} 行 → ${fmt(fillMap[k])}${unit}`, `Row ${k + 1} → ${fmt(fillMap[k])}${unit}`),
      narration: L(`第 ${k + 1} 行位于两个有效值之间，按它到两端的距离比例算出 ${fmt(fillMap[k])}${unit}。`,
        `Row ${k + 1} sits between two valid values; weighting by distance gives ${fmt(fillMap[k])}${unit}.`),
      duration: 1000, tone: 'gold', code: S.codeAt(0),
      table: S.table(T(df, {
        rowState: (r, k) => (k === k ? 'focus' : 'dim'),
        cellState: (r, k2, name) => {
          if (name !== col) return null;
          if (k2 === k) return 'filling';
          if (doneMap[k2] !== undefined) return 'filled';
          if (isNA(values[k2])) return 'na';
          return null;
        },
      })),
      stage: stage(k, doneMap),
      hud: [{ label: 'filled', value: `${n + 1} / ${missIdx.length}`, tone: 'gold' }],
    });
  });

  const result = df.fillna(null, []).clone();
  missIdx.forEach((k) => { result._rows[k].cells[ci] = fillMap[k]; });

  S.use(result);
  S.add({
    phase: ph('③', '结果', 'Result'),
    title: L('缺失被补成一条平滑的线', 'Gaps filled along a smooth line'),
    narration: L(`插值后行数不变，但缺失位置的值是按趋势推出来的，而不是一个固定的均值 —— 这让方差和趋势都保留得更好。`,
      `Row count is unchanged, but the filled values follow the trend instead of a fixed mean — variance and trend survive much better.`),
    duration: 2600, tone: 'ok', final: true, code: S.codeAt(0),
    table: S.table(T(result, { cellState: (r, k, name) => (name === col && doneMap[k] !== undefined ? 'filled' : null) })),
    stage: {
      kind: 'compare', title: L(`interpolate · ${col}`, `interpolate · ${col}`), col, unit,
      before: { shape: [df.nrow, df.ncol], stats: colSummary(df, col), hist: df.hist(col, 12) },
      after: { shape: [result.nrow, result.ncol], stats: colSummary(result, col), hist: result.hist(col, 12) },
      removed: missIdx.map((k) => ({ i: k, name: labelOf(df, labelCol, k), value: 'NaN', kind: 'na', clamped: doneMap[k] })),
    },
    hud: [{ label: 'missing', value: `${missIdx.length} → 0`, tone: 'ok' }],
  });

  return { frames: S.frames, result, summary: L(`线性插值填充 ${col} 的 ${missIdx.length} 处缺失`, `Interpolated ${missIdx.length} gaps in ${col}`) };
}

/* ================================================================
 * ★ 去除最大值与最小值
 * ================================================================ */
function buildScanSteps(values, valid) {
  const n = values.length;
  const changeAt = new Set();
  let minV = null, maxV = null;
  for (let k = 0; k < n; k++) {
    if (!valid[k]) continue;
    const v = values[k];
    if (maxV === null || v > maxV) { changeAt.add(k); maxV = v; }
    if (minV === null || v < minV) { changeAt.add(k); minV = v; }
  }
  const validIdx = [];
  for (let k = 0; k < n; k++) if (valid[k]) validIdx.push(k);
  const warmup = new Set(validIdx.slice(0, 3));
  const cooldown = new Set(validIdx.slice(-3));
  const BATCH = 5;
  const steps = [];
  let cur = [];
  const flush = () => { if (cur.length) { steps.push({ kind: cur.length === 1 ? 'one' : 'batch', idx: cur }); cur = []; } };
  for (let k = 0; k < n; k++) {
    if (!valid[k]) { flush(); steps.push({ kind: 'na', idx: [k] }); continue; }
    if (changeAt.has(k) || warmup.has(k) || cooldown.has(k)) { flush(); steps.push({ kind: 'one', idx: [k] }); }
    else { cur.push(k); if (cur.length >= BATCH) flush(); }
  }
  flush();
  return steps;
}

export function opDropExtremes(df, cfg = {}) {
  const col = cfg.col || df.columns.find((c) => df.dtypes[c] === 'number');
  const mode = cfg.mode || 'both';
  const unit = unitOf(df, col);
  const labelCol = pickLabelCol(df);
  const values = df.col(col);
  const valid = values.map((v) => typeof v === 'number' && Number.isFinite(v));
  const dom = domain(values);

  const S = new Script(df, 'drop_extremes');
  const doMax = mode !== 'min', doMin = mode !== 'max';
  const s0 = colSummary(df, col);

  const baseStage = (extra = {}) => ({ kind: 'extremes', col, unit, labelCol, dom, total: values.length, ...extra });

  let minIdx = -1, maxIdx = -1, scannedUpTo = -1;
  const buildPoints = (cursor, batchSet, primary) => values.map((v, i) => {
    let status = 'unseen';
    if (i <= scannedUpTo) status = 'seen';
    if (!valid[i]) status = 'na';
    if (i === minIdx && i === maxIdx) status = 'both';
    else if (i === maxIdx) status = 'max';
    else if (i === minIdx) status = 'min';
    if (batchSet && batchSet.has(i)) status = i === primary ? 'challenger' : 'batch';
    return {
      i, rid: df._rows[i].rid, name: labelOf(df, labelCol, i), value: v, na: isNA(v), status,
      t: valid[i] ? (v - dom.min) / (dom.max - dom.min) : 0.5,
    };
  });

  S.code(CODE.extremes(col));
  S.add({
    phase: ph('①', '明确目标', 'Set the goal'),
    title: L(`锁定「${col}」列`, `Focus on "${col}"`),
    narration: L(`清洗的第一步不是急着删数据，而是先看清它。${col} 列共 ${values.length} 个值，极差高达 ${fmt(s0.max - s0.min)}${unit}，其中必然藏着需要处理的极端值。`,
      `Cleaning starts with looking, not deleting. "${col}" holds ${values.length} values spanning ${fmt(s0.max - s0.min)}${unit} — extremes are hiding in there.`),
    duration: 2200, tone: 'info', code: S.codeAt(0),
    table: S.table(T(df, { cellState: (r, i, name) => (name === col ? 'focus' : null) })),
    stage: baseStage({ phase: 'intro', points: buildPoints(-1, null, -1), cursor: -1, scannedUpTo: -1, minIdx: -1, maxIdx: -1, challenger: null, verdict: null, summary: s0 }),
    hud: [{ label: 'shape', value: `${df.nrow} × ${df.ncol}`, tone: 'mute' },
      { label: 'max', value: fmt(s0.max) + unit, tone: 'rose' },
      { label: 'min', value: fmt(s0.min) + unit, tone: 'cyan' },
      { label: 'range', value: fmt(s0.max - s0.min) + unit, tone: 'gold' }],
  });

  S.add({
    phase: ph('①', '明确目标', 'Set the goal'),
    title: doMax && doMin ? L('要删除的是两个「端点」', 'Two endpoints will be dropped') : (doMax ? L('要删除的是最大值', 'The maximum will be dropped') : L('要删除的是最小值', 'The minimum will be dropped')),
    narration: doMax && doMin
      ? L('pandas 用 idxmax() 与 idxmin() 定位两端。它们不会凭空知道极值在哪 —— 必须从第一行开始逐行比较。下面就是这一次比较的全过程。',
        'pandas locates the ends with idxmax() and idxmin(). They cannot know where the extremes are — they must compare row by row from the top. What follows is that comparison, in full.')
      : L(`pandas 用 ${doMax ? 'idxmax()' : 'idxmin()'} 定位端点，它必须从第一行开始逐行比较。下面是完整过程。`,
        `pandas uses ${doMax ? 'idxmax()' : 'idxmin()'}, which must compare row by row from the top. Here is the full process.`),
    duration: 2200, tone: 'info', code: S.codeAt(doMax && doMin ? 1 : 1),
    table: S.table(T(df, { cellState: (r, i, name) => (name === col ? 'focus' : null) })),
    stage: baseStage({
      phase: 'intro2', points: buildPoints(-1, null, -1), cursor: -1, scannedUpTo: -1, minIdx: -1, maxIdx: -1,
      challenger: null, verdict: null, summary: s0,
      rule: doMax && doMin ? L('v > 当前最大 → 更新最大；v < 当前最小 → 更新最小', 'v > max so far → update max;  v < min so far → update min')
        : (doMax ? L('v > 当前最大 → 更新最大', 'v > max so far → update max') : L('v < 当前最小 → 更新最小', 'v < min so far → update min')),
    }),
  });

  const plan = buildScanSteps(values, valid);
  plan.forEach((step, si) => {
    const idxs = step.idx;
    const isNaStep = step.kind === 'na';
    const last = idxs[idxs.length - 1];
    const challengerSet = new Set(idxs);
    let verdict = null;
    for (const k of idxs) {
      if (!valid[k]) continue;
      const v = values[k];
      let hit = null;
      if (doMax && (maxIdx === -1 || v > values[maxIdx])) { maxIdx = k; hit = 'newMax'; }
      if (doMin && (minIdx === -1 || v < values[minIdx])) { minIdx = k; hit = hit === 'newMax' ? 'newBoth' : 'newMin'; }
      if (hit) verdict = hit;
    }
    scannedUpTo = Math.max(scannedUpTo, last);

    let narration, title, tone = 'info';
    if (isNaStep) {
      narration = L(`第 ${idxs[0] + 1} 行 ${labelOf(df, labelCol, idxs[0])} 的 ${col} 缺失（NaN），无法参与比较，直接跳过。`,
        `Row ${idxs[0] + 1} (${labelOf(df, labelCol, idxs[0])}) has no ${col} — NaN cannot be compared, so it is skipped.`);
      title = L(`跳过缺失值 · 第 ${idxs[0] + 1} 行`, `Skip NaN · row ${idxs[0] + 1}`);
      tone = 'mute';
    } else if (step.kind === 'one') {
      const k = idxs[0], v = values[k];
      const nm = labelOf(df, labelCol, k);
      const cm = maxIdx >= 0 ? values[maxIdx] : null;
      const cn = minIdx >= 0 ? values[minIdx] : null;
      if (verdict === 'newBoth') {
        narration = L(`${nm} 的 ${col} = ${fmt(v)}。它同时超过当前最大值 ${fmt(cm)} 且低于当前最小值 ${fmt(cn)} —— 两顶冠冕同时易主。`,
          `${nm}: ${col} = ${fmt(v)}. It beats the current max ${fmt(cm)} and undercuts the current min ${fmt(cn)} — both crowns change hands at once.`);
        tone = 'gold';
      } else if (verdict === 'newMax') {
        narration = L(`${nm} 的 ${col} = ${fmt(v)} > 当前最大值 ${fmt(cm)} → 最大值易主，${fmt(v)} 成为新的擂主。`,
          `${nm}: ${col} = ${fmt(v)} > current max ${fmt(cm)} → new champion at ${fmt(v)}.`);
        tone = 'danger';
      } else if (verdict === 'newMin') {
        narration = L(`${nm} 的 ${col} = ${fmt(v)} < 当前最小值 ${fmt(cn)} → 最小值易主，${fmt(v)} 成为新的擂主。`,
          `${nm}: ${col} = ${fmt(v)} < current min ${fmt(cn)} → new champion at ${fmt(v)}.`);
        tone = 'cyan';
      } else {
        narration = L(`${nm} 的 ${col} = ${fmt(v)}。与最大值 ${fmt(cm)} 比：${fmt(v)} ≤ ${fmt(cm)} 不构成威胁；与最小值 ${fmt(cn)} 比：${fmt(v)} ≥ ${fmt(cn)} 同样安全 → 两个擂主都不变。`,
          `${nm}: ${col} = ${fmt(v)}. Against the max ${fmt(cm)}: ${fmt(v)} ≤ ${fmt(cm)}, no threat. Against the min ${fmt(cn)}: ${fmt(v)} ≥ ${fmt(cn)}, equally safe → neither champion moves.`);
      }
      title = L(`第 ${k + 1} 行 · ${nm}`, `Row ${k + 1} · ${nm}`);
    } else {
      const k0 = idxs[0], k1 = idxs[idxs.length - 1];
      const seg = idxs.map((k) => fmt(values[k])).join(', ');
      const cm = maxIdx >= 0 ? values[maxIdx] : null;
      const cn = minIdx >= 0 ? values[minIdx] : null;
      if (verdict) {
        narration = L(`第 ${k0 + 1}–${k1 + 1} 行连续比较（${seg}）：其中出现新擂主，${verdict === 'newMin' ? '最小值' : '最大值'}被改写。`,
          `Rows ${k0 + 1}–${k1 + 1} compared in sequence (${seg}): a new champion appears and the ${verdict === 'newMin' ? 'minimum' : 'maximum'} is rewritten.`);
        tone = verdict === 'newMin' ? 'cyan' : 'danger';
      } else {
        narration = L(`第 ${k0 + 1}–${k1 + 1} 行快速扫过（${seg}）：全部落在 [${fmt(cn)}, ${fmt(cm)}] 区间内，无人挑战成功。`,
          `Rows ${k0 + 1}–${k1 + 1} swept quickly (${seg}): all fall inside [${fmt(cn)}, ${fmt(cm)}], nobody beats the champions.`);
      }
      title = L(`第 ${k0 + 1}–${k1 + 1} 行 · 批量比较`, `Rows ${k0 + 1}–${k1 + 1} · batch compare`);
    }

    S.add({
      phase: ph('②', '逐行扫描 · 寻找极值', 'Scan · find the extremes'),
      title, narration,
      duration: isNaStep ? 650 : (step.kind === 'one' ? (verdict ? 1500 : 1150) : 880),
      tone, code: S.codeAt(0),
      table: S.table(T(df, {
        rowState: (r, i) => (challengerSet.has(i) || i === last ? 'focus' : (i <= scannedUpTo ? 'dim' : 'normal')),
        cellState: (r, i, name) => {
          if (name !== col) return null;
          if (challengerSet.has(i)) return 'scan';
          if (i === maxIdx) return 'champ-max';
          if (i === minIdx) return 'champ-min';
          if (i <= scannedUpTo) return 'seen';
          return null;
        },
      })),
      stage: baseStage({
        phase: 'scan', points: buildPoints(last, challengerSet, last), cursor: last, scannedUpTo,
        minIdx, maxIdx,
        challenger: valid[last] ? { i: last, value: values[last], name: labelOf(df, labelCol, last) } : null,
        verdict, progress: [si, plan.length],
      }),
      hud: [
        { label: L('已比较', 'compared'), value: `${Math.min(scannedUpTo + 1, values.length)} / ${values.length}`, tone: 'cyan' },
        { label: L('当前最大', 'max'), value: maxIdx >= 0 ? fmt(values[maxIdx]) + unit : '—', tone: 'rose' },
        { label: L('当前最小', 'min'), value: minIdx >= 0 ? fmt(values[minIdx]) + unit : '—', tone: 'cyan' },
      ],
    });
  });

  const vMax = maxIdx >= 0 ? values[maxIdx] : null;
  const vMin = minIdx >= 0 ? values[minIdx] : null;
  const nMx = maxIdx >= 0 ? labelOf(df, labelCol, maxIdx) : '';
  const nMn = minIdx >= 0 ? labelOf(df, labelCol, minIdx) : '';
  const champions = [
    doMax ? { kind: 'max', i: maxIdx, value: vMax, name: nMx, idxLabel: maxIdx } : null,
    doMin ? { kind: 'min', i: minIdx, value: vMin, name: nMn, idxLabel: minIdx } : null,
  ].filter(Boolean);

  S.add({
    phase: ph('③', '锁定极值', 'Lock the extremes'),
    title: L('扫描结束 · 两顶冠冕尘埃落定', 'Scan complete · both champions settled'),
    narration: doMax && doMin
      ? L(`全部 ${values.length} 个值比较完毕。最大值 ${fmt(vMax)}（${nMx} · 第 ${maxIdx + 1} 行），最小值 ${fmt(vMin)}（${nMn} · 第 ${minIdx + 1} 行）。`,
        `All ${values.length} values compared. Max ${fmt(vMax)} (${nMx}, row ${maxIdx + 1}); min ${fmt(vMin)} (${nMn}, row ${minIdx + 1}).`)
      : L(`扫描完毕，目标值 ${fmt(doMax ? vMax : vMin)} 位于第 ${(doMax ? maxIdx : minIdx) + 1} 行。`,
        `Scan complete — the target ${fmt(doMax ? vMax : vMin)} sits at row ${(doMax ? maxIdx : minIdx) + 1}.`),
    duration: 2400, tone: 'gold', code: S.codeAt(1),
    table: S.table(T(df, {
      rowState: (r, i) => (i === maxIdx || i === minIdx ? 'focus' : 'dim'),
      cellState: (r, i, name) => name !== col ? null : i === maxIdx ? 'champ-max' : i === minIdx ? 'champ-min' : 'seen',
    })),
    stage: baseStage({ phase: 'lock', points: buildPoints(-1, null, -1), cursor: -1, scannedUpTo, minIdx, maxIdx, challenger: null, verdict: 'lock', summary: s0, champions }),
    hud: [{ label: 'idxmax()', value: String(maxIdx), tone: 'rose' }, { label: 'idxmin()', value: String(minIdx), tone: 'cyan' }],
  });

  S.add({
    phase: ph('③', '锁定极值', 'Lock the extremes'),
    title: L('两行「极值」被标记出来了', 'Two rows are now flagged'),
    narration: L('注意它们分散在表格的不同位置 —— 极值从不扎堆，这正是必须完整扫描的原因。另外，当出现并列极值时 pandas 会取第一次出现的位置，这里没有并列，可以放心删除。',
      'Note they sit far apart in the table — extremes never cluster, which is exactly why a full scan is required. When ties occur pandas keeps the first occurrence; there are none here, so removal is safe.'),
    duration: 2200, tone: 'warn', code: S.codeAt(2),
    table: S.table(T(df, {
      rowState: (r, i) => (i === maxIdx || i === minIdx ? 'danger' : 'dim'),
      cellState: (r, i, name) => name !== col ? null : i === maxIdx ? 'champ-max' : i === minIdx ? 'champ-min' : 'seen',
    })),
    stage: baseStage({ phase: 'lock', points: buildPoints(-1, null, -1), cursor: -1, scannedUpTo, minIdx, maxIdx, challenger: null, verdict: 'lock', champions, markDelete: [maxIdx, minIdx].filter((i) => i >= 0) }),
    hud: [{ label: L('待删除行', 'to drop'), value: [maxIdx, minIdx].filter((i) => i >= 0).join(' , '), tone: 'danger' },
      { label: L('删除后行数', 'rows after'), value: String(df.nrow - [maxIdx, minIdx].filter((i) => i >= 0).length), tone: 'ok' }],
  });

  /* ---- 删除 ---- */
  const killList = (doMax ? [maxIdx] : []).concat(doMin ? [minIdx] : []).filter((i) => i >= 0).sort((a, b) => a - b);
  const removed = [];
  const gone = new Set();

  killList.forEach((k) => {
    const isMax = k === maxIdx;
    const v = values[k], nm = labelOf(df, labelCol, k);
    const keptIdx = df._rows.map((_, i) => i).filter((i) => !gone.has(i));
    const midDf = df.dropRids([...gone].map((i) => df._rows[i].rid));

    S.add({
      phase: ph('④', '执行删除', 'Execute the drop'),
      title: L(`索引 ${k} · 第 ${k + 1} 行即将被摘除`, `index ${k} · row ${k + 1} is about to go`),
      narration: L(`${isMax ? '最大值' : '最小值'} ${fmt(v)}${unit}（${nm}）位于索引 ${k}。drop(index=[${k}]) 是「整行删除」—— 连同这一行里其他本来正常的数据（${df.columns.length} 个字段）一起丢掉。这就是为什么删除离群值必须谨慎。`,
        `The ${isMax ? 'maximum' : 'minimum'} ${fmt(v)}${unit} (${nm}) sits at index ${k}. drop(index=[${k}]) removes the whole row — all ${df.columns.length} fields go with it, including the ones that were perfectly fine. That is why dropping outliers deserves care.`),
      duration: 2000, tone: 'danger', code: S.codeAt(4),
      table: S.table(T(df, {
        include: df._rows.filter((r, i) => !gone.has(i)).map((r) => r.rid),
        rowState: (r, i) => (i === k ? 'danger' : 'dim'),
        cellState: (r, i, name) => (i === k ? (name === col ? 'champ-' + (isMax ? 'max' : 'min') : 'danger') : null),
      })),
      stage: baseStage({
        phase: 'delete',
        points: values.map((v2, i) => ({
          i, rid: df._rows[i].rid, name: labelOf(df, labelCol, i), value: v2, na: isNA(v2),
          t: valid[i] ? (v2 - dom.min) / (dom.max - dom.min) : 0.5,
          status: gone.has(i) ? 'removed' : (i === k ? (isMax ? 'max' : 'min') : 'seen'),
        })),
        cursor: k, minIdx, maxIdx, challenger: { i: k, value: v, name: nm }, verdict: 'aboutToDelete',
        target: { i: k, value: v, name: nm, kind: isMax ? 'max' : 'min' },
      }),
      hud: [{ label: 'drop', value: `index=[${k}]`, tone: 'danger' },
        { label: L('整行字段数', 'fields lost'), value: String(df.columns.length), tone: 'warn' }],
    });

    gone.add(k);
    removed.push({ i: k, value: v, name: nm, kind: isMax ? 'max' : 'min' });
    const after = df.nrow - removed.length;
    const partialDf = df.dropRids([...gone].map((i) => df._rows[i].rid));
    S.use(partialDf);

    S.add({
      phase: ph('④', '执行删除', 'Execute the drop'),
      title: L(`索引 ${k} 已消失 · 剩余 ${after} 行`, `index ${k} is gone · ${after} rows left`),
      narration: L(`注意索引列：${k} 被跳过了，后面的行号没有自动补位 —— pandas 保留了这个「断层」，所以下一步必须 reset_index。`,
        `Watch the index column: ${k} is skipped and later rows do not renumber. pandas keeps this gap, which is why reset_index must follow.`),
      duration: 1800, tone: 'warn', code: S.codeAt(4),
      table: S.table(T(df, {
        include: df._rows.filter((r, i) => !gone.has(i)).map((r) => r.rid),
        rowState: (r, i) => (killList.includes(i) && !gone.has(i) ? 'danger' : 'dim'),
        cellState: (r, i, name) => (name === col && (i === maxIdx || i === minIdx) ? (i === maxIdx ? 'champ-max' : 'champ-min') : null),
      })),
      stage: baseStage({
        phase: 'delete',
        points: values.map((v2, i) => ({
          i, rid: df._rows[i].rid, name: labelOf(df, labelCol, i), value: v2, na: isNA(v2),
          t: valid[i] ? (v2 - dom.min) / (dom.max - dom.min) : 0.5,
          status: gone.has(i) ? 'removed' : 'seen',
        })),
        cursor: k, minIdx, maxIdx, challenger: null, verdict: 'deleted', removedCount: removed.length,
      }),
      hud: [{ label: 'shape', value: `${df.nrow} × ${df.ncol}`, tone: 'mute' },
        { label: L('当前行数', 'rows now'), value: String(after), tone: 'ok' },
        { label: L('索引断层', 'gaps'), value: [...gone].join(', '), tone: 'warn' }],
    });
  });

  const result = df.dropRids(killList.map((i) => df._rows[i].rid)).resetIndex();
  S.use(result);

  S.add({
    phase: ph('⑤', '重置索引', 'Reset the index'),
    title: L('reset_index(drop=True) · 缝合断层', 'reset_index(drop=True) · stitch the gap'),
    narration: L(`删除留下的索引断层会让后续的 loc / iloc 产生歧义，所以 pandas 的标准动作是立刻重置索引，把 0…${result.nrow - 1} 重新编号。`,
      `Leftover index gaps make later loc/iloc ambiguous, so the standard move is to reset immediately, renumbering 0…${result.nrow - 1}.`),
    duration: 1900, tone: 'info', code: S.codeAt(5),
    table: S.table(T(result, {})),
    stage: baseStage({
      phase: 'reset',
      points: values.map((v2, i) => ({
        i, rid: df._rows[i].rid, name: labelOf(df, labelCol, i), value: v2, na: isNA(v2),
        t: valid[i] ? (v2 - dom.min) / (dom.max - dom.min) : 0.5,
        status: killList.includes(i) ? 'removed' : 'seen',
      })),
      cursor: -1, minIdx, maxIdx, challenger: null, verdict: 'reset', removedCount: killList.length,
    }),
  });

  const s1 = colSummary(result, col);
  S.add({
    phase: ph('⑥', '结果', 'Result'),
    title: L('清洗完成 · 分布回到正常区间', 'Done · the distribution tightens'),
    narration: L(`极值清除后，${col} 的均值从 ${fmt(s0.mean)} 变为 ${fmt(s1.mean)}，极差由 ${fmt(s0.max - s0.min)} 收窄到 ${fmt(s1.max - s1.min)}。直方图与箱线图的形态会明显更集中 —— 这正是离群值处理的意义。`,
      `With the extremes gone, the mean of ${col} moves from ${fmt(s0.mean)} to ${fmt(s1.mean)} and the range narrows from ${fmt(s0.max - s0.min)} to ${fmt(s1.max - s1.min)}. The histogram and box plot become visibly tighter — that is the point of outlier handling.`),
    duration: 3000, tone: 'ok', final: true, code: S.codeAt(6),
    table: S.table(T(result, { cellState: (r, i, name) => (name === col ? 'best' : null) })),
    stage: {
      kind: 'compare',
      title: L(`去除${doMax && doMin ? '最大值与最小值' : (doMax ? '最大值' : '最小值')} · ${col}`,
        `Remove ${doMax && doMin ? 'min & max' : (doMax ? 'max' : 'min')} · ${col}`),
      unit, col,
      before: { shape: [df.nrow, df.ncol], stats: s0, hist: df.hist(col, 12) },
      after: { shape: [result.nrow, result.ncol], stats: s1, hist: result.hist(col, 12) },
      removed,
    },
    hud: [{ label: 'shape', value: `${df.nrow}×${df.ncol} → ${result.nrow}×${result.ncol}`, tone: 'ok' },
      { label: 'mean', value: `${fmt(s0.mean)} → ${fmt(s1.mean)}`, tone: 'cyan' },
      { label: 'range', value: `${fmt(s0.max - s0.min)} → ${fmt(s1.max - s1.min)}`, tone: 'gold' }],
  });

  return {
    frames: S.frames, result,
    summary: L(`去除 ${col} 的极值（删除 ${killList.length} 行）`, `Removed ${col} extremes (${killList.length} rows dropped)`),
  };
}

/* ================================================================
 * clip
 * ================================================================ */
export function opClip(df, cfg = {}) {
  const col = cfg.col || df.columns.find((c) => df.dtypes[c] === 'number');
  const unit = unitOf(df, col);
  const labelCol = pickLabelCol(df);
  const s0 = colSummary(df, col);
  const lo = cfg.lo ?? Math.round((s0.q1 - 1.5 * (s0.q3 - s0.q1)) * 100) / 100;
  const hi = cfg.hi ?? Math.round((s0.q3 + 1.5 * (s0.q3 - s0.q1)) * 100) / 100;
  const values = df.col(col);
  const dom = domain(values);

  const S = new Script(df, 'clip');
  S.code(CODE.clip({ col, lo, hi }));

  const pts = () => values.map((v, i) => ({
    i, rid: df._rows[i].rid, name: labelOf(df, labelCol, i), value: v, na: isNA(v),
    t: typeof v === 'number' ? (v - dom.min) / (dom.max - dom.min) : 0.5,
    status: typeof v === 'number' && (v < lo || v > hi) ? 'out' : 'seen',
  }));
  const outIdx = values.map((v, i) => (typeof v === 'number' && (v < lo || v > hi) ? i : -1)).filter((i) => i >= 0);

  S.add({
    phase: ph('①', '计算边界', 'Compute the bounds'),
    title: L(`用 IQR 法则算出允许区间 [${fmt(lo)}, ${fmt(hi)}]`, `IQR rule gives the allowed range [${fmt(lo)}, ${fmt(hi)}]`),
    narration: L(`离群值不一定要删除。当数据本身珍贵时，pandas 更常用 clip() 把越界值「压」回边界：Q1 − 1.5×IQR = ${fmt(lo)}，Q3 + 1.5×IQR = ${fmt(hi)}。落在区间外的值会被改写成边界值，行数保持不变。`,
      `Outliers do not have to be deleted. When data is precious, clip() pushes out-of-range values back to the boundary: Q1 − 1.5×IQR = ${fmt(lo)}, Q3 + 1.5×IQR = ${fmt(hi)}. Values outside are rewritten to the bound and the row count never changes.`),
    duration: 2600, tone: 'info', code: S.codeAt(0),
    table: S.table(T(df, { cellState: (r, i, name) => (name === col && outIdx.includes(i) ? 'out' : null) })),
    stage: { kind: 'range', col, unit, dom, lo, hi, points: pts(), label: L(`允许区间 [${fmt(lo)}, ${fmt(hi)}]${unit}`, `Allowed range [${fmt(lo)}, ${fmt(hi)}]${unit}`) },
    hud: [{ label: 'Q1', value: fmt(s0.q1), tone: 'mute' }, { label: 'IQR', value: fmt(s0.q3 - s0.q1), tone: 'mute' },
      { label: 'lower', value: fmt(lo), tone: 'cyan' }, { label: 'upper', value: fmt(hi), tone: 'rose' }],
  });

  S.add({
    phase: ph('②', '识别越界值', 'Find the out-of-range values'),
    title: L(`共 ${outIdx.length} 个值越界`, `${outIdx.length} values are out of range`),
    narration: outIdx.length
      ? L(`它们将被「推」回边界：低于 ${fmt(lo)} 的抬升到 ${fmt(lo)}，高于 ${fmt(hi)} 的压低到 ${fmt(hi)}。注意没有一行被删除。`,
        `They will be pushed back: anything below ${fmt(lo)} rises to ${fmt(lo)}, anything above ${fmt(hi)} drops to ${fmt(hi)}. Not a single row is removed.`)
      : L('没有值越界，clip 不会改变任何数据。', 'Nothing is out of range — clip changes nothing.'),
    duration: 1800, tone: outIdx.length ? 'warn' : 'ok', code: S.codeAt(0),
    table: S.table(T(df, { rowState: (r, i) => (outIdx.includes(i) ? 'focus' : 'dim'), cellState: (r, i, name) => (name === col && outIdx.includes(i) ? 'out' : null) })),
    stage: { kind: 'range', col, unit, dom, lo, hi, points: pts(), label: L('越界值将被压回边界', 'Out-of-range values get pushed back') },
  });

  const result = df.clip(col, lo, hi);
  S.use(result);
  const s1 = colSummary(result, col);

  S.add({
    phase: ph('③', '结果', 'Result'),
    title: L('越界值归位 · 分布瞬间收紧', 'Values clamped · the spread tightens'),
    narration: L(`clip() 是「无损清洗」：形状不变，但极差从 ${fmt(s0.max - s0.min)} 收窄到 ${fmt(s1.max - s1.min)}，标准差从 ${fmt(s0.std)} 降到 ${fmt(s1.std)}。之后的模型与图表都不再被极端值带偏。`,
      `clip() is lossless cleaning: the shape is unchanged, but the range narrows from ${fmt(s0.max - s0.min)} to ${fmt(s1.max - s1.min)} and the standard deviation drops from ${fmt(s0.std)} to ${fmt(s1.std)}. Later models and charts stop being dragged around by extremes.`),
    duration: 2800, tone: 'ok', final: true, code: S.codeAt(0),
    table: S.table(T(result, { cellState: (r, i, name) => (name === col && outIdx.includes(i) ? 'change' : null) })),
    stage: {
      kind: 'compare', title: L(`clip · ${col}`, `clip · ${col}`), unit, col,
      before: { shape: [df.nrow, df.ncol], stats: s0, hist: df.hist(col, 12) },
      after: { shape: [result.nrow, result.ncol], stats: s1, hist: result.hist(col, 12) },
      removed: outIdx.map((i) => ({ i, name: labelOf(df, labelCol, i), value: values[i], kind: values[i] > hi ? 'max' : 'min', clamped: values[i] > hi ? hi : lo })),
    },
    hud: [{ label: 'std', value: `${fmt(s0.std)} → ${fmt(s1.std)}`, tone: 'ok' },
      { label: 'range', value: `${fmt(s0.max - s0.min)} → ${fmt(s1.max - s1.min)}`, tone: 'gold' }],
  });

  return { frames: S.frames, result, summary: L(`将 ${col} 截断到 [${fmt(lo)}, ${fmt(hi)}]`, `Clipped ${col} to [${fmt(lo)}, ${fmt(hi)}]`) };
}

/* ================================================================
 * nlargest / nsmallest
 * ================================================================ */
function topN(df, cfg, largest) {
  const col = cfg.col || df.columns.find((c) => df.dtypes[c] === 'number');
  const n = Math.min(cfg.n || 5, df.nrow);
  const unit = unitOf(df, col);
  const labelCol = pickLabelCol(df);
  const values = df.col(col);
  const dom = domain(values);
  const opId = largest ? 'nlargest' : 'nsmallest';

  const S = new Script(df, opId);
  S.code(CODE[opId]({ n, by: col }));

  const ranked = values
    .map((v, i) => ({ v, i }))
    .filter((o) => typeof o.v === 'number' && Number.isFinite(o.v))
    .sort((a, b) => (largest ? b.v - a.v : a.v - b.v))
    .slice(0, n);
  const topSet = new Set(ranked.map((o) => o.i));

  S.add({
    phase: ph('①', '设定', 'Setup'),
    title: L(`按 ${col} 取前 ${n} 名`, `Top ${n} by ${col}`),
    narration: largest
      ? L(`nlargest(${n}, "${col}") 内部维护一个大小为 ${n} 的最小堆：堆里永远是「目前见过的最好的 ${n} 个」，任何一个新值只要能挤掉堆顶，就会把堆顶替换出去。`,
        `nlargest(${n}, "${col}") maintains a min-heap of size ${n}: the heap always holds the best ${n} seen so far, and any new value that can beat the heap root replaces it.`)
      : L(`nsmallest(${n}, "${col}") 与 nlargest 对称：维护一个大小为 ${n} 的最大堆，只保留最小的 ${n} 个值。`,
        `nsmallest(${n}, "${col}") mirrors nlargest: it keeps a max-heap of size ${n} holding only the smallest values.`),
    duration: 2600, tone: 'info', code: S.codeAt(0),
    table: S.table(T(df, { cellState: (r, i, name) => (name === col ? 'seen' : null) })),
    stage: { kind: 'rank', col, unit, n, largest, dom, points: values.map((v, i) => ({ i, name: labelOf(df, labelCol, i), value: v, t: (v - dom.min) / (dom.max - dom.min), status: 'unseen' })), ranked: [] },
  });

  const rows = [];
  ranked.forEach((o, k) => {
    rows.push(o);
    S.add({
      phase: ph('②', '堆内维护', 'Maintain the heap'),
      title: L(`第 ${k + 1} 名 · ${labelOf(df, labelCol, o.i)}`, `#${k + 1} · ${labelOf(df, labelCol, o.i)}`),
      narration: L(`${fmt(o.v)}${unit} 进入榜单，当前 Top-${n} 门槛已经抬升到 ${fmt(rows[rows.length - 1].v)}${unit}。${k === n - 1 ? ` 榜单已满，之后任何值必须${largest ? '超过' : '低于'} ${fmt(o.v)}${unit} 才有资格进榜。` : ''}`,
        `${fmt(o.v)}${unit} enters the board; the Top-${n} threshold is now ${fmt(rows[rows.length - 1].v)}${unit}.${k === n - 1 ? ` The board is full — from here on a value must ${largest ? 'exceed' : 'fall below'} ${fmt(o.v)}${unit} to qualify.` : ''}`),
      duration: k === n - 1 ? 1700 : 1200,
      tone: k === 0 ? 'gold' : 'info', code: S.codeAt(0),
      table: S.table(T(df, { rowState: (r, i) => (topSet.has(i) ? 'focus' : 'dim'), cellState: (r, i, name) => (name === col && topSet.has(i) ? 'best' : null) })),
      stage: {
        kind: 'rank', col, unit, n, largest, dom,
        points: values.map((v, i) => ({
          i, name: labelOf(df, labelCol, i), value: v,
          t: (typeof v === 'number' ? (v - dom.min) / (dom.max - dom.min) : 0.5),
          status: rows.some((o2) => o2.i === i) ? 'in' : (largest ? v > rows[rows.length - 1].v : v < rows[rows.length - 1].v) ? 'cand' : 'unseen',
        })),
        ranked: rows.slice(), threshold: rows[rows.length - 1].v,
      },
      hud: [{ label: L('Top-N 门槛', 'threshold'), value: fmt(rows[rows.length - 1].v) + unit, tone: 'gold' },
        { label: L('已入榜', 'on board'), value: `${rows.length}/${n}`, tone: 'cyan' }],
    });
  });

  const result = df.filter((c, i) => topSet.has(i));
  S.use(result);
  S.add({
    phase: ph('③', '结果', 'Result'),
    title: L(`Top-${n} 榜单`, `Top-${n} board`),
    narration: L(`最终结果只保留了 ${n} 行，并且已经按 ${col} ${largest ? '降序' : '升序'}排列 —— 这就是榜单的样子。`,
      `Only ${n} rows survive, already ordered by ${col} ${largest ? 'descending' : 'ascending'} — that is the leaderboard.`),
    duration: 2200, tone: 'ok', final: true, code: S.codeAt(0),
    table: S.table(T(result, { cellState: (r, i, name) => (name === col ? 'best' : null) })),
    stage: { kind: 'rank', col, unit, n, largest, dom, done: true, points: [], ranked: rows.slice(), threshold: rows[rows.length - 1].v },
  });

  return { frames: S.frames, result, summary: L(`按 ${col} 取${largest ? '前' : '后'} ${n} 名`, `${largest ? 'Top' : 'Bottom'} ${n} by ${col}`) };
}

export const opNlargest = (df, cfg) => topN(df, cfg, true);
export const opNsmallest = (df, cfg) => topN(df, cfg, false);
