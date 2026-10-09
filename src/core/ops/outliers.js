/* ------------------------------------------------------------------
 * ops/outliers.js — 离群值处理（本项目的旗舰演示）
 *  · drop_extremes  去除最大值与最小值（含完整扫描推理过程）
 *  · clip           上下截断
 *  · nlargest       取 Top-N
 * ------------------------------------------------------------------ */

import { Script, T, CODE } from '../frames.js';
import { isNA, fmt, histogram } from '../utils.js';
import { pickLabelCol, labelOf, unitOf, colSummary, domain } from './common.js';

/* ================================================================
 * 扫描计划：把 38 个元素编排成有节奏的镜头序列
 *  · 开头 3 个元素单独成帧（让观众看懂比较规则）
 *  · 中间批量快扫，但「冠军易主」的元素一定单独成帧（高潮时刻）
 *  · 结尾 3 个元素单独成帧（做最后确认）
 * ================================================================ */
function buildScanSteps(values, valid) {
  const n = values.length;
  // 先模拟一遍，找出所有会让冠军易主的位置
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
    const solo = changeAt.has(k) || warmup.has(k) || cooldown.has(k);
    if (solo) { flush(); steps.push({ kind: 'one', idx: [k] }); }
    else {
      cur.push(k);
      if (cur.length >= BATCH) flush();
    }
  }
  flush();
  return steps;
}

/* ================================================================
 * 去除最大值与最小值
 * ================================================================ */
export function opDropExtremes(df, cfg = {}) {
  const col = cfg.col || df.columns.find((c) => df.dtypes[c] === 'number');
  const mode = cfg.mode || 'both';              // both | max | min
  const unit = unitOf(df, col);
  const labelCol = pickLabelCol(df);
  const values = df.col(col);
  const valid = values.map((v) => typeof v === 'number' && Number.isFinite(v));
  const dom = domain(values);

  const S = new Script(df, 'drop_extremes');
  const doMax = mode !== 'min', doMin = mode !== 'max';
  const s0 = colSummary(df, col);

  const baseStage = (extra = {}) => ({
    kind: 'extremes', col, unit, labelCol,
    dom,
    total: values.length,
    ...extra,
  });

  const points = (over = {}) => values.map((v, i) => ({
    i,
    rid: df._rows[i].rid,
    name: labelOf(df, labelCol, i),
    value: v,
    na: isNA(v),
    t: valid[i] ? (v - dom.min) / (dom.max - dom.min) : 0.5,
    status: 'unseen',
    ...(over[i] || {}),
  }));

  const colHighlight = (state) => (r, i, name) => (name === col ? state : null);

  /* ---------------- ① 目标确认 ---------------- */
  S.code(CODE.extremes(col));
  S.add({
    phase: '① 明确目标',
    title: `锁定「${col}」列`,
    narration: `清洗的第一步不是急着删数据，而是先看清它。${col} 列共 ${values.length} 个值，` +
      `极差高达 ${fmt(s0.max - s0.min)}${unit}，其中必然藏着需要处理的极端值。`,
    duration: 2200,
    tone: 'info',
    code: S.codeAt(0),
    table: S.table(T(df, { cellState: colHighlight('focus') })),
    stage: baseStage({ phase: 'intro', points: points(), cursor: -1, scannedUpTo: -1, minIdx: -1, maxIdx: -1, challenger: null, verdict: null, summary: s0 }),
    hud: [{ label: 'shape', value: `${df.nrow} × ${df.ncol}`, tone: 'mute' },
      { label: 'max', value: fmt(s0.max) + unit, tone: 'rose' },
      { label: 'min', value: fmt(s0.min) + unit, tone: 'violet' },
      { label: '极差', value: fmt(s0.max - s0.min) + unit, tone: 'amber' }],
  });

  S.add({
    phase: '① 明确目标',
    title: doMax && doMin ? '要删除的是两个「端点」' : (doMax ? '要删除的是最大值' : '要删除的是最小值'),
    narration: doMax && doMin
      ? `pandas 用 idxmax() 与 idxmin() 定位两端。它们不会凭空知道极值在哪 —— 必须从第一行开始逐行比较。下面就是这一次比较的全过程。`
      : `pandas 用 ${doMax ? 'idxmax()' : 'idxmin()'} 定位端点，它必须从第一行开始逐行比较。下面是完整过程。`,
    duration: 2400,
    tone: 'info',
    code: S.codeAt(doMax && doMin ? 1 : (doMax ? 1 : 2)),
    table: S.table(T(df, { cellState: colHighlight('focus') })),
    stage: baseStage({
      phase: 'intro2', points: points(), cursor: -1, scannedUpTo: -1, minIdx: -1, maxIdx: -1,
      challenger: null, verdict: null, summary: s0,
      rule: doMax && doMin ? 'v > 当前最大 → 更新最大；v < 当前最小 → 更新最小' : (doMax ? 'v > 当前最大 → 更新最大' : 'v < 当前最小 → 更新最小'),
    }),
  });

  /* ---------------- ② 扫描 ---------------- */
  const plan = buildScanSteps(values, valid);

  let minIdx = -1, maxIdx = -1;
  let scannedUpTo = -1;

  /**
   * @param cursor        当前指针位置
   * @param batchSet      本步涉及的索引集合
   * @param primary       本步的「主角」（唯一一个用高亮发光样式，避免批量时糊成一片光斑）
   */
  const buildPoints = (cursor, batchSet, primary) => values.map((v, i) => {
    let status = 'unseen';
    if (i <= scannedUpTo) status = 'seen';
    if (!valid[i]) status = 'na';
    if (i === minIdx && i === maxIdx) status = 'both';
    else if (i === maxIdx) status = 'max';
    else if (i === minIdx) status = 'min';
    if (batchSet && batchSet.has(i)) status = i === primary ? 'challenger' : 'batch';
    return {
      i, rid: df._rows[i].rid, name: labelOf(df, labelCol, i),
      value: v, na: isNA(v), status,
      t: valid[i] ? (v - dom.min) / (dom.max - dom.min) : 0.5,
    };
  });

  // 索引高亮：已扫描过的行淡出，当前行聚焦
  const rowStateFor = (cursor, challengerSet) => (r, i) => {
    if (challengerSet && challengerSet.has(i)) return 'focus';
    if (i === cursor) return 'focus';
    if (i <= scannedUpTo) return 'dim';
    return 'normal';
  };

  plan.forEach((step, si) => {
    const idxs = step.idx;
    const isNa = step.kind === 'na';
    const cursors = idxs;
    const last = idxs[idxs.length - 1];
    const challengerSet = new Set(idxs);
    let verdict = null;              // 'newMax' | 'newMin' | 'newBoth' | 'none'
    const detail = [];

    // 逐个推进状态
    for (const k of idxs) {
      if (!valid[k]) { detail.push({ k, na: true }); continue; }
      const v = values[k];
      let hit = null;
      if (doMax && (maxIdx === -1 || v > values[maxIdx])) { maxIdx = k; hit = 'newMax'; }
      if (doMin && (minIdx === -1 || v < values[minIdx])) { minIdx = k; hit = hit === 'newMax' ? 'newBoth' : 'newMin'; }
      if (hit) verdict = hit;
      detail.push({ k, v, hit });
    }
    scannedUpTo = Math.max(scannedUpTo, last);

    /* --- 解说文本 --- */
    let narration, title, tone = 'info';
    if (isNa) {
      narration = `第 ${idxs[0] + 1} 行 ${labelOf(df, labelCol, idxs[0])} 的 ${col} 缺失（NaN），无法参与比较，直接跳过。`;
      title = `跳过缺失值 · 第 ${idxs[0] + 1} 行`;
      tone = 'mute';
    } else if (step.kind === 'one') {
      const k = idxs[0], v = values[k];
      const nm = labelOf(df, labelCol, k);
      const cm = maxIdx >= 0 ? values[maxIdx] : null;
      const cn = minIdx >= 0 ? values[minIdx] : null;
      if (verdict === 'newBoth') {
        narration = `${nm} 的 ${col} = ${fmt(v)}。它同时超过当前最大值 ${fmt(cm)} 且低于当前最小值 ${fmt(cn)} —— 两顶冠冕同时易主。`;
        tone = 'gold';
      } else if (verdict === 'newMax') {
        narration = `${nm} 的 ${col} = ${fmt(v)} > 当前最大值 ${fmt(cm)} → 最大值易主，${fmt(v)} 成为新的擂台擂主。`;
        tone = 'danger';
      } else if (verdict === 'newMin') {
        narration = `${nm} 的 ${col} = ${fmt(v)} < 当前最小值 ${fmt(cn)} → 最小值易主，${fmt(v)} 成为新的擂主。`;
        tone = 'violet';
      } else {
        narration = `${nm} 的 ${col} = ${fmt(v)}。与最大值 ${fmt(cm)} 比：${fmt(v)} ≤ ${fmt(cm)} 不构成威胁；` +
          `与最小值 ${fmt(cn)} 比：${fmt(v)} ≥ ${fmt(cn)} 同样安全 → 两个擂主都不变。`;
      }
      title = `第 ${k + 1} 行 · ${nm}`;
    } else {
      const k0 = idxs[0], k1 = idxs[idxs.length - 1];
      const seg = idxs.map((k) => fmt(values[k])).join('、');
      const cm = maxIdx >= 0 ? values[maxIdx] : null;
      const cn = minIdx >= 0 ? values[minIdx] : null;
      if (verdict) {
        narration = `第 ${k0 + 1}–${k1 + 1} 行连续比较（${seg}）：其中出现新擂主，${verdict === 'newMin' ? '最小值' : '最大值'}被改写。`;
        tone = verdict === 'newMin' ? 'violet' : 'danger';
      } else {
        narration = `第 ${k0 + 1}–${k1 + 1} 行快速扫过（${seg}）：全部落在 [${fmt(cn)}, ${fmt(cm)}] 区间内，无人挑战成功。`;
      }
      title = `第 ${k0 + 1}–${k1 + 1} 行 · 批量比较`;
    }

    S.add({
      phase: '② 逐行扫描 · 寻找极值',
      title,
      narration,
      duration: isNa ? 700 : (step.kind === 'one' ? (verdict ? 1700 : 1250) : 950),
      tone,
      code: S.codeAt(0),
      table: S.table(T(df, {
        rowState: rowStateFor(last, challengerSet),
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
        phase: 'scan',
        points: buildPoints(last, challengerSet, last),
        cursor: last,
        scannedUpTo,
        minIdx, maxIdx,
        challenger: valid[last] ? { i: last, value: values[last], name: labelOf(df, labelCol, last) } : null,
        verdict,
        progress: [si, plan.length],
      }),
      hud: [
        { label: '已比较', value: `${Math.min(scannedUpTo + 1, values.length)} / ${values.length}`, tone: 'cyan' },
        { label: '当前最大', value: maxIdx >= 0 ? fmt(values[maxIdx]) + unit : '—', tone: 'rose' },
        { label: '当前最小', value: minIdx >= 0 ? fmt(values[minIdx]) + unit : '—', tone: 'violet' },
      ],
    });
  });

  /* ---------------- ③ 锁定极值 ---------------- */
  const vMax = maxIdx >= 0 ? values[maxIdx] : null;
  const vMin = minIdx >= 0 ? values[minIdx] : null;
  const nMx = maxIdx >= 0 ? labelOf(df, labelCol, maxIdx) : '';
  const nMn = minIdx >= 0 ? labelOf(df, labelCol, minIdx) : '';

  S.add({
    phase: '③ 锁定极值',
    title: '扫描结束 · 两顶冠冕尘埃落定',
    narration: doMax && doMin
      ? `全部 ${values.length} 个值比较完毕。最大值 ${fmt(vMax)}（${nMx} · 第 ${maxIdx + 1} 行），最小值 ${fmt(vMin)}（${nMn} · 第 ${minIdx + 1} 行）。`
      : `扫描完毕，目标值 ${fmt(doMax ? vMax : vMin)} 位于第 ${(doMax ? maxIdx : minIdx) + 1} 行。`,
    duration: 2600,
    tone: 'gold',
    code: S.codeAt(1),
    table: S.table(T(df, {
      rowState: (r, i) => (i === maxIdx || i === minIdx) ? 'focus' : 'dim',
      cellState: (r, i, name) => name !== col ? null
        : i === maxIdx ? 'champ-max' : i === minIdx ? 'champ-min' : 'seen',
      index: (r, i) => `${i}`,
    })),
    stage: baseStage({
      phase: 'lock', points: buildPoints(-1, null, -1), cursor: -1, scannedUpTo,
      minIdx, maxIdx, challenger: null, verdict: 'lock', summary: s0,
      champions: [
        doMax ? { kind: 'max', i: maxIdx, value: vMax, name: nMx, idxLabel: maxIdx } : null,
        doMin ? { kind: 'min', i: minIdx, value: vMin, name: nMn, idxLabel: minIdx } : null,
      ].filter(Boolean),
    }),
    hud: [
      { label: 'idxmax()', value: String(maxIdx), tone: 'rose' },
      { label: 'idxmin()', value: String(minIdx), tone: 'violet' },
    ],
  });

  S.add({
    phase: '③ 锁定极值',
    title: '两行「极值」被标记出来了',
    narration: `注意它们分散在表格的不同位置 —— 极值从不扎堆，这正是必须完整扫描的原因。` +
      `另外，当出现并列极值时 pandas 会取第一次出现的位置，这里没有并列，可以放心删除。`,
    duration: 2300,
    tone: 'warn',
    code: S.codeAt(2),
    table: S.table(T(df, {
      rowState: (r, i) => (i === maxIdx || i === minIdx) ? 'danger' : 'dim',
      cellState: (r, i, name) => name !== col ? null
        : i === maxIdx ? 'champ-max' : i === minIdx ? 'champ-min' : 'seen',
    })),
    stage: baseStage({
      phase: 'lock', points: buildPoints(-1, null, -1), cursor: -1, scannedUpTo,
      minIdx, maxIdx, challenger: null, verdict: 'lock',
      champions: [
        doMax ? { kind: 'max', i: maxIdx, value: vMax, name: nMx, idxLabel: maxIdx } : null,
        doMin ? { kind: 'min', i: minIdx, value: vMin, name: nMn, idxLabel: minIdx } : null,
      ].filter(Boolean),
      markDelete: [maxIdx, minIdx].filter((i) => i >= 0),
    }),
    hud: [
      { label: '待删除行', value: [maxIdx, minIdx].filter((i) => i >= 0).join(' , '), tone: 'danger' },
      { label: '删除后行数', value: String(df.nrow - [maxIdx, minIdx].filter((i) => i >= 0).length), tone: 'ok' },
    ],
  });

  /* ---------------- ④ 删除 ---------------- */
  const killList = (doMax ? [maxIdx] : []).concat(doMin ? [minIdx] : []).filter((i) => i >= 0)
    .sort((a, b) => a - b);
  const removed = [];

  // 已被删除的行索引（用于让表格里这些行「消失」）
  const gone = new Set();

  killList.forEach((k) => {
    const isMax = k === maxIdx;
    const v = values[k], nm = labelOf(df, labelCol, k);

    // --- 第 1 拍：目标行被标记为危险，还没删 ---
    S.add({
      phase: '④ 执行删除',
      title: `索引 ${k} · 第 ${k + 1} 行即将被摘除`,
      narration: `${isMax ? '最大值' : '最小值'} ${fmt(v)}${unit}（${nm}）位于索引 ${k}。` +
        `drop(index=[${k}]) 是「整行删除」—— 连同这一行里其他本来正常的数据（${df.columns.length} 个字段）一起丢掉。这就是为什么删除离群值必须谨慎。`,
      duration: 2100,
      tone: 'danger',
      code: S.codeAt(4),
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
        cursor: k, minIdx, maxIdx, challenger: { i: k, value: v, name: nm },
        verdict: 'aboutToDelete',
        target: { i: k, value: v, name: nm, kind: isMax ? 'max' : 'min' },
      }),
      hud: [
        { label: 'drop 目标', value: `index=[${k}]`, tone: 'danger' },
        { label: '整行字段数', value: String(df.columns.length), tone: 'warn' },
      ],
    });

    // --- 第 2 拍：行消失，下方整体上移 ---
    gone.add(k);
    removed.push({ i: k, value: v, name: nm, kind: isMax ? 'max' : 'min' });
    const after = df.nrow - removed.length;

    S.add({
      phase: '④ 执行删除',
      title: `索引 ${k} 已消失 · 剩余 ${after} 行`,
      narration: `注意索引列：${k} 被跳过了，后面的行号没有自动补位 —— pandas 保留了这个「断层」，` +
        `所以下一步必须 reset_index。`,
      duration: 1900,
      tone: 'warn',
      code: S.codeAt(4),
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
        cursor: k, minIdx, maxIdx, challenger: null, verdict: 'deleted',
        removedCount: removed.length,
      }),
      hud: [
        { label: 'shape', value: `${df.nrow} × ${df.ncol}`, tone: 'mute' },
        { label: '当前行数', value: String(after), tone: 'ok' },
        { label: '索引断层', value: `缺失 ${[...gone].join(', ')}`, tone: 'warn' },
      ],
    });
  });

  /* ---------------- ⑤ 重置索引 ---------------- */
  const result = df.dropRids(killList.map((i) => df._rows[i].rid)).resetIndex();

  S.add({
    phase: '⑤ 重置索引',
    title: 'reset_index(drop=True) · 缝合断层',
    narration: `删除留下的索引断层会让后续的 loc / iloc 产生歧义，所以 pandas 的标准动作是立刻重置索引，把 0…${result.nrow - 1} 重新编号。`,
    duration: 2000,
    tone: 'info',
    code: S.codeAt(5),
    table: S.table(T(result, { index: (r, i) => i })),
    stage: baseStage({
      phase: 'reset',
      points: values.map((v2, i) => ({
        i, rid: df._rows[i].rid, name: labelOf(df, labelCol, i), value: v2, na: isNA(v2),
        t: valid[i] ? (v2 - dom.min) / (dom.max - dom.min) : 0.5,
        status: killList.includes(i) ? 'removed' : 'seen',
      })),
      cursor: -1, minIdx, maxIdx, challenger: null, verdict: 'reset',
      removedCount: killList.length,
    }),
  });

  /* ---------------- ⑥ 结果对比 ---------------- */
  const s1 = colSummary(result, col);
  S.add({
    phase: '⑥ 结果',
    title: '清洗完成 · 分布回到正常区间',
    narration: `极值清除后，${col} 的均值从 ${fmt(s0.mean)} 变为 ${fmt(s1.mean)}，` +
      `极差由 ${fmt(s0.max - s0.min)} 收窄到 ${fmt(s1.max - s1.min)}。箱线图与直方图的形态也会明显更集中 —— 这正是离群值处理的意义。`,
    duration: 3200,
    tone: 'ok',
    final: true,
    code: S.codeAt(6),
    table: S.table(T(result, {
      cellState: (r, i, name) => (name === col ? 'best' : null),
      index: (r, i) => i,
    })),
    stage: {
      kind: 'compare',
      title: `去除${doMax && doMin ? '最大值与最小值' : (doMax ? '最大值' : '最小值')} · ${col}`,
      unit,
      before: { shape: [df.nrow, df.ncol], stats: s0, hist: histogram(df.numCol(col), 12) },
      after: { shape: [result.nrow, result.ncol], stats: s1, hist: histogram(result.numCol(col), 12) },
      removed,
      col,
    },
    hud: [
      { label: 'shape', value: `${df.nrow}×${df.ncol} → ${result.nrow}×${result.ncol}`, tone: 'ok' },
      { label: 'mean', value: `${fmt(s0.mean)} → ${fmt(s1.mean)}`, tone: 'cyan' },
      { label: '极差', value: `${fmt(s0.max - s0.min)} → ${fmt(s1.max - s1.min)}`, tone: 'amber' },
    ],
  });

  return { frames: S.frames, result, summary: `去除 ${col} 的极值（删除 ${killList.length} 行）` };
}

/* ================================================================
 * clip —— 上下截断
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

  const pts = (over = {}) => values.map((v, i) => ({
    i, rid: df._rows[i].rid, name: labelOf(df, labelCol, i), value: v, na: isNA(v),
    t: typeof v === 'number' ? (v - dom.min) / (dom.max - dom.min) : 0.5,
    status: typeof v === 'number' && (v < lo || v > hi) ? 'out' : 'seen',
    ...(over[i] || {}),
  }));

  S.add({
    phase: '① 计算边界',
    title: `用 IQR 法则算出允许区间 [${fmt(lo)}, ${fmt(hi)}]`,
    narration: `离群值不一定要删除。当数据本身珍贵时，pandas 更常用 clip() 把越界值「压」回边界：` +
      `Q1 − 1.5×IQR = ${fmt(lo)}，Q3 + 1.5×IQR = ${fmt(hi)}。落在区间外的值会被改写成边界值，行数保持不变。`,
    duration: 2800, tone: 'info', code: S.codeAt(0),
    table: S.table(T(df, { cellState: (r, i, name) => (name === col && (r.cells[df.columns.indexOf(col)] < lo || r.cells[df.columns.indexOf(col)] > hi)) ? 'na' : null })),
    stage: {
      kind: 'range', col, unit, dom, lo, hi, points: pts(),
      label: `允许区间 [${fmt(lo)}, ${fmt(hi)}]${unit}`,
    },
    hud: [{ label: 'Q1', value: fmt(s0.q1), tone: 'mute' }, { label: 'IQR', value: fmt(s0.q3 - s0.q1), tone: 'mute' },
      { label: '下界', value: fmt(lo), tone: 'violet' }, { label: '上界', value: fmt(hi), tone: 'rose' }],
  });

  const outIdx = values.map((v, i) => (typeof v === 'number' && (v < lo || v > hi) ? i : -1)).filter((i) => i >= 0);

  S.add({
    phase: '② 识别越界值',
    title: `共 ${outIdx.length} 个值越界`,
    narration: outIdx.length
      ? `它们将被「推」回边界：低于 ${fmt(lo)} 的抬升到 ${fmt(lo)}，高于 ${fmt(hi)} 的压低到 ${fmt(hi)}。注意没有一行被删除。`
      : `没有值越界，clip 不会改变任何数据。`,
    duration: 2000, tone: outIdx.length ? 'warn' : 'ok', code: S.codeAt(0),
    table: S.table(T(df, { rowState: (r, i) => (outIdx.includes(i) ? 'focus' : 'dim'), cellState: (r, i, name) => (name === col && outIdx.includes(i)) ? 'na' : null })),
    stage: { kind: 'range', col, unit, dom, lo, hi, points: pts(), label: `越界值将被压回边界` },
  });

  const result = df.clip(col, lo, hi);
  const s1 = colSummary(result, col);

  S.add({
    phase: '③ 结果',
    title: '越界值归位 · 分布瞬间收紧',
    narration: `clip() 是「无损清洗」：形状不变，但极差从 ${fmt(s0.max - s0.min)} 收窄到 ${fmt(s1.max - s1.min)}，` +
      `标准差从 ${fmt(s0.std)} 降到 ${fmt(s1.std)}。之后的模型与图表都不再被极端值带偏。`,
    duration: 3000, tone: 'ok', final: true, code: S.codeAt(0),
    table: S.table(T(result, { cellState: (r, i, name) => (name === col && outIdx.includes(i)) ? 'change' : null })),
    stage: {
      kind: 'compare', title: `clip · ${col}`, unit, col,
      before: { shape: [df.nrow, df.ncol], stats: s0, hist: histogram(df.numCol(col), 12) },
      after: { shape: [result.nrow, result.ncol], stats: s1, hist: histogram(result.numCol(col), 12) },
      removed: outIdx.map((i) => ({ i, name: labelOf(df, labelCol, i), value: values[i], kind: values[i] > hi ? 'max' : 'min', clamped: values[i] > hi ? hi : lo })),
    },
    hud: [{ label: 'std', value: `${fmt(s0.std)} → ${fmt(s1.std)}`, tone: 'ok' },
      { label: '极差', value: `${fmt(s0.max - s0.min)} → ${fmt(s1.max - s1.min)}`, tone: 'amber' }],
  });

  return { frames: S.frames, result, summary: `将 ${col} 截断到 [${fmt(lo)}, ${fmt(hi)}]` };
}

/* ================================================================
 * nlargest —— 取 Top-N（堆排演示）
 * ================================================================ */
export function opNlargest(df, cfg = {}) {
  const col = cfg.col || df.columns.find((c) => df.dtypes[c] === 'number');
  const n = cfg.n || 5;
  const unit = unitOf(df, col);
  const labelCol = pickLabelCol(df);
  const values = df.col(col);
  const dom = domain(values);

  const S = new Script(df, 'nlargest');
  S.code(CODE.nlargest({ n, by: col }));

  const ranked = values
    .map((v, i) => ({ v, i }))
    .filter((o) => typeof o.v === 'number' && Number.isFinite(o.v))
    .sort((a, b) => b.v - a.v)
    .slice(0, n);
  const topSet = new Set(ranked.map((o) => o.i));

  S.add({
    phase: '① 设定',
    title: `按 ${col} 取前 ${n} 名`,
    narration: `nlargest(${n}, "${col}") 内部维护一个大小为 ${n} 的最小堆：` +
      `堆里永远是「目前见过的最好的 ${n} 个」，任何一个新值只要能挤掉堆顶，就会把堆顶替换出去。`,
    duration: 2600, tone: 'info', code: S.codeAt(0),
    table: S.table(T(df, { cellState: (r, i, name) => (name === col ? 'seen' : null) })),
    stage: { kind: 'rank', col, unit, n, dom, points: values.map((v, i) => ({ i, name: labelOf(df, labelCol, i), value: v, t: (v - dom.min) / (dom.max - dom.min), status: 'unseen' })), ranked: [] },
  });

  const rows = [];
  ranked.forEach((o, k) => {
    rows.push(o);
    S.add({
      phase: '② 堆内维护',
      title: `第 ${k + 1} 名 · ${labelOf(df, labelCol, o.i)}`,
      narration: `${fmt(o.v)}${unit} 进入榜单，当前 Top-${n} 门槛已经抬升到 ${fmt(rows[rows.length - 1].v)}${unit}。` +
        (k === n - 1 ? ` 榜单已满，之后任何值必须超过 ${fmt(o.v)}${unit} 才有资格进榜。` : ''),
      duration: k === n - 1 ? 1900 : 1300,
      tone: k === 0 ? 'gold' : 'info',
      code: S.codeAt(0),
      table: S.table(T(df, { rowState: (r, i) => (topSet.has(i) ? 'focus' : 'dim'), cellState: (r, i, name) => (name === col && topSet.has(i)) ? 'best' : null })),
      stage: {
        kind: 'rank', col, unit, n, dom,
        points: values.map((v, i) => ({
          i, name: labelOf(df, labelCol, i), value: v,
          t: (typeof v === 'number' ? (v - dom.min) / (dom.max - dom.min) : 0.5),
          status: rows.some((o2) => o2.i === i) ? 'in' : (values[i] > rows[rows.length - 1].v ? 'cand' : 'unseen'),
        })),
        ranked: rows.slice(),
        threshold: rows[rows.length - 1].v,
      },
      hud: [{ label: 'Top-N 门槛', value: fmt(rows[rows.length - 1].v) + unit, tone: 'amber' }, { label: '已入榜', value: `${rows.length}/${n}`, tone: 'cyan' }],
    });
  });

  const order = ranked.map((o) => df._rows[o.i].rid);
  const result = df.filter((c, i) => topSet.has(i));

  S.add({
    phase: '③ 结果',
    title: `Top-${n} 榜单`,
    narration: `最终结果只保留了 ${n} 行，并且已经按 ${col} 降序排列 —— 这就是榜单的样子。`,
    duration: 2400, tone: 'ok', final: true, code: S.codeAt(0),
    table: S.table(T(result, { index: (r, i) => `${i}`, cellState: (r, i, name) => (name === col ? 'best' : null) })),
    stage: { kind: 'rank', col, unit, n, dom, done: true, points: [], ranked: rows.slice(), threshold: rows[rows.length - 1].v },
  });

  return { frames: S.frames, result, summary: `按 ${col} 取前 ${n} 名` };
}
