/* ------------------------------------------------------------------
 * ops/stats.js — 统计与聚合
 *  · agg            单列归约（mean / median / std / sum / …）的逐步演算
 *  · describe       八项描述性统计逐项揭示
 *  · info           结构概览
 *  · value_counts   频次统计
 *  · groupby        分组聚合（数据飞入桶中）
 * ------------------------------------------------------------------ */

import { Script, T, CODE } from '../frames.js';
import { isNA, fmt, mean, median, std, sum } from '../utils.js';
import { pickLabelCol, labelOf, unitOf, colSummary, domain, statCards } from './common.js';

const FN_LABEL = {
  mean: 'mean 均值', median: 'median 中位数', std: 'std 标准差', sum: 'sum 求和',
  min: 'min 最小值', max: 'max 最大值', count: 'count 计数', nunique: 'nunique 唯一值个数',
  var: 'var 方差', quantile: 'quantile 分位数',
};

/* ================================================================
 * 单列归约：把 n 个值「折叠」成一个数
 * ================================================================ */
export function opAgg(df, cfg = {}) {
  const col = cfg.col || df.columns.find((c) => df.dtypes[c] === 'number');
  const fn = cfg.fn || 'mean';
  const unit = unitOf(df, col);
  const labelCol = pickLabelCol(df);
  const S = new Script(df, 'agg');
  S.code(CODE.agg({ col, fn }));

  const values = df.col(col);
  const valid = values.map((v) => typeof v === 'number' && Number.isFinite(v));
  const nums = values.filter((v) => typeof v === 'number' && Number.isFinite(v));
  const dom = domain(nums);
  const n = nums.length;
  const total = sum(nums);
  const m = mean(nums);
  const med = median(nums);
  const sd = std(nums, 1);

  let result;
  switch (fn) {
    case 'sum': result = total; break;
    case 'median': result = med; break;
    case 'std': result = sd; break;
    case 'var': result = sd ** 2; break;
    case 'min': result = Math.min(...nums); break;
    case 'max': result = Math.max(...nums); break;
    case 'count': result = n; break;
    default: result = m;
  }

  const stageBase = (cursor, extra = {}) => ({
    kind: 'reduce', col, unit, fn, labelCol, dom,
    cursor, total: values.length, validN: n,
    entries: values.map((v, i) => ({
      i, name: labelOf(df, labelCol, i), value: v,
      t: valid[i] ? (v - dom.min) / (dom.max - dom.min) : 0.5,
      na: !valid[i],
      consumed: cursor < 0 ? false : i <= cursor,
    })),
    runningSum: 0, runningCount: 0,
    ...extra,
  });

  S.add({
    phase: '① 目标',
    title: `${col}.${fn}() —— 把 ${n} 个值折叠成 1 个`,
    narration: `归约（reduce）的本质是：遍历整列，把 n 个数字压缩成一个结论。${FN_LABEL[fn]} 在 pandas 里只需要一句 ${col}.${fn}()，` +
      `但这一句话背后发生了什么，才是真正值得看的。`,
    duration: 3000,
    tone: 'info',
    code: S.codeAt(0),
    table: S.table(T(df, { rowState: () => 'dim', cellState: (r, i, name) => (name === col ? 'focus' : null) })),
    stage: stageBase(-1),
    hud: [{ label: '样本量 n', value: String(n), tone: 'cyan' }, { label: '缺失', value: String(values.length - n), tone: 'mute' }],
  });

  if (fn === 'sum' || fn === 'mean') {
    /* ---- 累加过程 ---- */
    let acc = 0, cnt = 0;
    const CHUNK = 4;
    for (let i = 0; i < values.length; i += CHUNK) {
      const end = Math.min(i + CHUNK, values.length);
      const seg = [];
      for (let k = i; k < end; k++) if (valid[k]) { acc += values[k]; cnt++; seg.push(values[k]); }
      S.add({
        phase: '② 逐个累加',
        title: `累加到 ${fmt(acc)}`,
        narration: seg.length
          ? `把第 ${i + 1}–${end} 行纳入累加器：+${seg.map(fmt).join(' + ')} → 当前累计 ${fmt(acc)}${unit}（已处理 ${cnt} 个有效值）。` +
            `注意 NaN 会被自动跳过，不参与计算 —— 这正是 pandas 的默认行为（skipna=True）。`
          : `第 ${i + 1}–${end} 行全部缺失，累加器数值保持不变。`,
        duration: 900,
        tone: 'info',
        code: S.codeAt(0),
        table: S.table(T(df, {
          rowState: (r, j) => (j >= i && j < end ? 'focus' : (j < i ? (valid[j] ? 'keep' : 'dim') : 'dim')),
          cellState: (r, j, name) => (name === col ? (j < end ? (valid[j] ? 'seen' : 'na') : null) : null),
        })),
        stage: stageBase(end - 1, {
          runningSum: acc, runningCount: cnt,
          display: fn === 'sum' ? acc : acc / (cnt || 1),
          displayLabel: fn === 'sum' ? '累加器 Σx' : '当前均值 Σx / n',
        }),
        hud: [{ label: 'Σx', value: fmt(acc), tone: 'gold' }, { label: 'n', value: String(cnt), tone: 'cyan' },
          { label: fn === 'sum' ? 'sum' : '当前 mean', value: fmt(fn === 'sum' ? acc : acc / (cnt || 1)), tone: 'ok' }],
      });
    }

    if (fn === 'mean') {
      S.add({
        phase: '③ 除以样本量',
        title: `${fmt(acc)} ÷ ${n} = ${fmt(m)}`,
        narration: `累加器里是全部有效值的和 ${fmt(acc)}。除以有效样本数 ${n}，就得到均值 ${fmt(m)}${unit}。` +
          `这也是为什么缺失值会让均值「失真」：分母变了，分子却没变。`,
        duration: 2600,
        tone: 'gold',
        code: S.codeAt(0),
        table: S.table(T(df, { rowState: () => 'dim', cellState: (r, i, name) => (name === col ? 'seen' : null) })),
        stage: stageBase(values.length - 1, { runningSum: acc, runningCount: n, display: m, displayLabel: 'Σx / n = mean', final: true }),
        hud: [{ label: 'Σx', value: fmt(acc), tone: 'gold' }, { label: 'n', value: String(n), tone: 'cyan' }, { label: 'mean', value: fmt(m) + unit, tone: 'ok' }],
      });
    }
  } else if (fn === 'std' || fn === 'var') {
    /* ---- 两遍扫描：先均值，再偏差平方 ---- */
    S.add({
      phase: '② 第一遍：求均值',
      title: `第一遍扫描：先求出均值 ${fmt(m)}`,
      narration: `标准差衡量的是「数据离均值有多远」。所以第一步必须先知道均值在哪 —— 这是第一遍扫描，得到 ${fmt(m)}${unit}。`,
      duration: 2400,
      tone: 'info',
      code: S.codeAt(0),
      table: S.table(T(df, { rowState: () => 'dim', cellState: (r, i, name) => (name === col ? 'seen' : null) })),
      stage: stageBase(values.length - 1, { runningSum: total, runningCount: n, display: m, displayLabel: '第一遍 · mean' }),
    });

    let accSq = 0, cnt = 0;
    const CHUNK = 4;
    for (let i = 0; i < values.length; i += CHUNK) {
      const end = Math.min(i + CHUNK, values.length);
      for (let k = i; k < end; k++) if (valid[k]) { accSq += (values[k] - m) ** 2; cnt++; }
      S.add({
        phase: '③ 第二遍：偏差平方累加',
        title: `Σ(x − x̄)² = ${fmt(accSq)}`,
        narration: `把第 ${i + 1}–${end} 行的值减去均值 ${fmt(m)}，再平方（平方是为了让正负偏差都算作「距离」而不互相抵消），累加进 Σ(x−x̄)²。`,
        duration: 900,
        tone: 'info',
        code: S.codeAt(0),
        table: S.table(T(df, {
          rowState: (r, j) => (j >= i && j < end ? 'focus' : 'dim'),
          cellState: (r, j, name) => (name === col ? (j < end ? 'seen' : null) : null),
        })),
        stage: stageBase(end - 1, {
          runningSum: accSq, runningCount: cnt, display: accSq, displayLabel: 'Σ(x − x̄)²',
          devMode: true, center: m,
        }),
        hud: [{ label: 'Σ(x−x̄)²', value: fmt(accSq), tone: 'gold' }, { label: 'n−1', value: String(Math.max(0, n - 1)), tone: 'cyan' },
          { label: '当前 std', value: fmt(Math.sqrt(accSq / Math.max(1, n - 1))), tone: 'ok' }],
      });
    }

    S.add({
      phase: '④ 开方',
      title: `σ = √(${fmt(accSq)} / ${n - 1}) = ${fmt(sd)}`,
      narration: `除以 n−1（贝塞尔校正，让样本标准差成为总体标准差的无偏估计），再开平方，得到 ${fmt(sd)}${unit}。` +
        `pandas 的 .std() 默认就是这个 ddof=1 的版本，而 numpy 默认是 ddof=0 —— 这个差异经常让两组结果对不上。`,
      duration: 3000,
      tone: 'gold',
      code: S.codeAt(0),
      table: S.table(T(df, { rowState: () => 'dim', cellState: (r, i, name) => (name === col ? 'seen' : null) })),
      stage: stageBase(values.length - 1, { runningSum: accSq, runningCount: n, display: sd, displayLabel: 'std', final: true, devMode: true, center: m }),
      hud: [{ label: 'Σ(x−x̄)²', value: fmt(accSq), tone: 'gold' }, { label: 'ddof', value: '1', tone: 'mute' }, { label: 'std', value: fmt(sd) + unit, tone: 'ok' }],
    });
  } else if (fn === 'median') {
    const sorted = nums.slice().sort((a, b) => a - b);
    const mid = n >> 1;
    S.add({
      phase: '② 排序',
      title: '中位数要求数据有序',
      narration: `中位数是「排在正中间的那个数」，所以必须先排序。排序后落在第 ${mid}${n % 2 ? '' : ' 与第 ' + (mid + 1)} 位的值，就是中位数。`,
      duration: 2600,
      tone: 'info',
      code: S.codeAt(0),
      table: S.table(T(df, { rowState: () => 'dim', cellState: (r, i, name) => (name === col ? 'seen' : null) })),
      stage: { kind: 'sortedbars', by: col, unit, labelCol, values: sorted, labels: sorted.map((v, i) => `#${i}`), highlight: n % 2 ? [mid] : [mid - 1, mid], median: med, title: `${col} 升序排列，标出正中位置` },
    });
    S.add({
      phase: '③ 取中位',
      title: n % 2 ? `第 ${mid + 1} 位 = ${fmt(med)}` : `第 ${mid} 与 ${mid + 1} 位的平均 = ${fmt(med)}`,
      narration: n % 2
        ? `样本量 ${n} 是奇数，正中位置只有一个值：${fmt(med)}${unit}。`
        : `样本量 ${n} 是偶数，正中有两个值 ${fmt(sorted[mid - 1])} 与 ${fmt(sorted[mid])}，取它们的平均得到 ${fmt(med)}${unit}。`,
      duration: 2600,
      tone: 'gold',
      code: S.codeAt(0),
      table: S.table(T(df, { rowState: () => 'dim', cellState: (r, i, name) => (name === col ? 'seen' : null) })),
      stage: { kind: 'sortedbars', by: col, unit, labelCol, values: sorted, labels: sorted.map((v, i) => `#${i}`), highlight: n % 2 ? [mid] : [mid - 1, mid], median: med, done: true, title: `中位数 = ${fmt(med)}${unit}` },
      hud: [{ label: 'median', value: fmt(med) + unit, tone: 'ok' }, { label: 'mean', value: fmt(m) + unit, tone: 'mute' }],
    });
  } else {
    /* min / max / count —— 简单说明 */
    S.add({
      phase: '② 扫描',
      title: `${FN_LABEL[fn]} = ${fmt(result)}`,
      narration: `pandas 会完整扫过这一列的 ${n} 个有效值，逐个比较并保留${
        fn === 'min' ? '最小的那个' : fn === 'max' ? '最大的那个' : '计数'}，最终得到 ${fmt(result)}${fn === 'count' ? '' : unit}。`,
      duration: 2400,
      tone: 'info',
      code: S.codeAt(0),
      table: S.table(T(df, {
        rowState: () => 'dim',
        cellState: (r, i, name) => {
          if (name !== col) return null;
          if (fn === 'min' && values[i] === result) return 'champ-min';
          if (fn === 'max' && values[i] === result) return 'champ-max';
          return 'seen';
        },
      })),
      stage: stageBase(values.length - 1, { display: result, displayLabel: fn, final: false }),
    });
  }

  const s = colSummary(df, col);
  S.add({
    phase: '⑤ 结果',
    title: `${col}.${fn}() = ${fmt(result)}${fn === 'count' ? '' : unit}`,
    narration: `回到最初的问题：这一列的整体水平是多少？答案是 ${fmt(result)}${fn === 'count' ? '' : unit}。` +
      `但它只是一个数字 —— 真正理解数据还需要标准差 ${fmt(s.std)} 和分布形态来佐证（见右侧 describe 面板）。`,
    duration: 3000,
    tone: 'ok',
    final: true,
    code: S.codeAt(0),
    table: S.table(T(df, { cellState: (r, i, name) => (name === col ? 'best' : null) })),
    stage: { kind: 'statcard', col, unit, fn, result, label: FN_LABEL[fn], summary: s, cards: statCards(s, unit) },
    hud: [{ label: FN_LABEL[fn], value: fmt(result) + (fn === 'count' ? '' : unit), tone: 'ok' },
      { label: 'n', value: String(n), tone: 'cyan' }],
  });

  return { frames: S.frames, result: df, summary: `${col}.${fn}() = ${fmt(result)}`, value: result };
}

/* ================================================================
 * describe —— 描述性统计
 * ================================================================ */
export function opDescribe(df, cfg = {}) {
  const cols = cfg.columns || df.columns.filter((c) => df.dtypes[c] === 'number');
  const S = new Script(df, 'describe');
  S.code(CODE.describe());

  const desc = df.describe();
  const rows = desc.index;

  S.add({
    phase: '① 一句话看懂一列',
    title: `describe() 会一次性给出 ${rows.length} 项统计`,
    narration: `面对一列数字，人眼只能看出「大概」。describe() 用 ${rows.length} 个指标把它讲清楚：` +
      `count 有多少有效值、mean 平均水平、std 波动大小、min/max 边界，以及 25%/50%/75% 三个分位点如何切分数据。`,
    duration: 3200,
    tone: 'info',
    code: S.codeAt(0),
    table: S.table(T(df, { cellState: (r, i, name) => (cols.includes(name) ? 'focus' : 'dim') })),
    stage: { kind: 'describe', cols, rows, data: {}, revealed: [] },
    hud: [{ label: '数值列', value: String(cols.length), tone: 'cyan' }, { label: '指标', value: String(rows.length), tone: 'mute' }],
  });

  const expl = {
    count: '有多少个非缺失值 —— 先看它，才知道这列的样本量够不够。',
    mean: '算术平均：Σx / n。对极端值敏感，一个离群点就能把它拽走。',
    std: '样本标准差（ddof=1）：数据围绕均值波动的典型幅度。',
    min: '最小值。配合 max 就能看出数据的整体跨度。',
    '25%': '第一四分位数 Q1：25% 的数据小于它。分位数不受极端值影响，比均值更「抗造」。',
    '50%': '中位数 Q2：正中间的值。当 mean 与 50% 差距很大时，说明分布是偏斜的。',
    '75%': '第三四分位数 Q3：75% 的数据小于它。Q3 − Q1 就是 IQR，离群值检测的基础。',
    max: '最大值。max 与 75% 之间的巨大空隙，往往就是离群值藏身之处。',
  };

  rows.forEach((r, k) => {
    S.add({
      phase: '② 逐项揭示',
      title: `${r} · ${expl[r].split('：')[0].split('。')[0]}`,
      narration: expl[r],
      duration: 1900,
      tone: k === rows.length - 1 ? 'gold' : 'info',
      code: S.codeAt(0),
      table: S.table(T(df, { cellState: (r2, i, name) => (cols.includes(name) ? 'focus' : 'dim') })),
      stage: { kind: 'describe', cols, rows, data: desc.data, revealed: rows.slice(0, k + 1), active: r, unit: df.meta?.unit || {} },
      hud: [{ label: '已揭示', value: `${k + 1}/${rows.length}`, tone: 'cyan' }],
    });
  });

  const main = cols[0];
  S.add({
    phase: '③ 结果',
    title: '一张表读懂全部数值字段',
    narration: `对比不同列的 std 与 IQR，可以立刻判断哪一列波动最大。` +
      `这也是为什么在真正画图之前，老手都会先跑一次 describe —— 它决定了后面该关注什么。`,
    duration: 3000,
    tone: 'ok',
    final: true,
    code: S.codeAt(0),
    table: S.table(T(df, { cellState: (r, i, name) => (cols.includes(name) ? 'best' : 'dim') })),
    stage: { kind: 'describe', cols, rows, data: desc.data, revealed: rows, unit: df.meta?.unit || {}, done: true },
    hud: [{ label: 'shape', value: `${df.nrow} × ${df.ncol}`, tone: 'mute' }, { label: '数值列', value: String(cols.length), tone: 'ok' }],
  });

  return { frames: S.frames, result: df, summary: `describe() 摘要（${cols.length} 个数值列）` };
}

/* ================================================================
 * info —— 结构概览
 * ================================================================ */
export function opInfo(df) {
  const S = new Script(df, 'info');
  S.code(CODE.info());
  const info = df.info();
  const nulls = df.nullCounts();
  const totalNull = Object.values(nulls).reduce((a, b) => a + b, 0);

  S.add({
    phase: '① 表的结构',
    title: `${info.shape[0]} 行 × ${info.shape[1]} 列`,
    narration: `info() 不关心数值是多少，只回答「这张表长什么样」：有多少行、每列是什么类型、有没有缺失、占多少内存。` +
      `这是拿到任何数据集后的第一个动作。`,
    duration: 3000,
    tone: 'info',
    code: S.codeAt(0),
    table: S.table(T(df, {})),
    stage: { kind: 'info', info, revealed: 0 },
    hud: [{ label: 'shape', value: `${info.shape[0]} × ${info.shape[1]}`, tone: 'cyan' }, { label: '缺失总数', value: String(totalNull), tone: 'danger' }],
  });

  const CHUNK = 4;
  for (let i = 0; i < info.columns.length; i += CHUNK) {
    const end = Math.min(i + CHUNK, info.columns.length);
    const cols = info.columns.slice(i, end);
    S.add({
      phase: '② 逐列检查',
      title: `第 ${i + 1}–${end} 个字段`,
      narration: cols.map((c) => `${c.name} 是 ${c.dtype}，非空 ${c.nonNull} 个${c.nulls ? `，缺失 ${c.nulls} 个 ⚠` : '，无缺失 ✓'}`).join('；') + '。',
      duration: 1300,
      tone: cols.some((c) => c.nulls) ? 'warn' : 'info',
      code: S.codeAt(0),
      table: S.table(T(df, { cellState: (r, k, name) => (cols.some((c) => c.name === name) ? 'focus' : 'dim') })),
      stage: { kind: 'info', info, revealed: end },
      hud: [{ label: '已检查', value: `${end}/${info.columns.length}`, tone: 'cyan' }],
    });
  }

  S.add({
    phase: '③ 结论',
    title: totalNull ? `发现 ${totalNull} 个缺失值，需要清洗` : '数据完整，可以直接分析',
    narration: totalNull
      ? `info() 的价值就在于：它在你还不知道要做什么分析之前，就先把「哪里有问题」标了出来。下一步自然就是决定 dropna 还是 fillna。`
      : `所有字段都没有缺失，类型也符合预期，可以放心进入下一步。`,
    duration: 2800,
    tone: totalNull ? 'warn' : 'ok',
    final: true,
    code: S.codeAt(0),
    table: S.table(T(df, { cellState: (r, i, name) => (nulls[name] ? 'na' : null) })),
    stage: { kind: 'info', info, revealed: info.columns.length, done: true },
    hud: [{ label: 'dtypes', value: `${new Set(info.columns.map((c) => c.dtype)).size} 种`, tone: 'mute' },
      { label: '缺失', value: String(totalNull), tone: totalNull ? 'danger' : 'ok' }],
  });

  return { frames: S.frames, result: df, summary: `info() 结构概览（${totalNull} 个缺失值）` };
}

/* ================================================================
 * value_counts —— 频次统计
 * ================================================================ */
export function opValueCounts(df, cfg = {}) {
  const col = cfg.col || df.columns.find((c) => df.dtypes[c] !== 'number') || df.columns[0];
  const S = new Script(df, 'value_counts');
  S.code(CODE.vc(col));
  const vc = df.valueCounts(col);
  const values = df.col(col);
  const ci = df.columns.indexOf(col);
  const keys = vc.map(([k]) => k);

  const stage = (cursor, extra = {}) => {
    const counts = {};
    keys.forEach((k) => counts[k] = 0);
    for (let i = 0; i <= cursor && i < values.length; i++) {
      const k = isNA(values[i]) ? 'NaN' : String(values[i]);
      counts[k] = (counts[k] || 0) + 1;
    }
    return {
      kind: 'tally', col, cursor, total: values.length, keys,
      counts,
      entries: values.map((v, i) => ({ i, key: isNA(v) ? 'NaN' : String(v), na: isNA(v), counted: i <= cursor })),
      sorted: vc.map(([k, c]) => ({ key: k, count: c })),
      maxCount: Math.max(...vc.map(([, c]) => c), 1),
      ...extra,
    };
  };

  S.add({
    phase: '① 归类',
    title: `${col} 有多少种取值？各出现几次？`,
    narration: `value_counts() 回答的是「分布」问题：不看数值大小，只看每一类出现了多少次。` +
      `它内部就是一个哈希表 —— 遍历整列，遇到已有的键就把计数加一，遇到新的键就建立一条记录。`,
    duration: 3200,
    tone: 'info',
    code: S.codeAt(0),
    table: S.table(T(df, { rowState: () => 'dim', cellState: (r, i, name) => (name === col ? 'focus' : null) })),
    stage: stage(-1),
    hud: [{ label: '类别数', value: String(vc.length), tone: 'cyan' }, { label: '总记录', value: String(df.nrow), tone: 'mute' }],
  });

  const CHUNK = 5;
  for (let i = 0; i < values.length; i += CHUNK) {
    const end = Math.min(i + CHUNK, values.length);
    const seg = values.slice(i, end).map((v) => isNA(v) ? 'NaN' : String(v));
    S.add({
      phase: '② 投递计数',
      title: `第 ${i + 1}–${end} 行依次入桶`,
      narration: `把 ${seg.join('、')} 分别投入对应的桶中，每投一次桶里的计数加一。桶的数量即为该取值的频数。`,
      duration: 1000,
      tone: 'info',
      code: S.codeAt(0),
      table: S.table(T(df, {
        rowState: (r, j) => (j >= i && j < end ? 'focus' : (j < i ? 'dim' : 'dim')),
        cellState: (r, j, name) => (name === col ? (j < end ? 'seen' : null) : null),
      })),
      stage: stage(end - 1),
      hud: [{ label: '已归类', value: `${end}/${values.length}`, tone: 'cyan' }],
    });
  }

  S.add({
    phase: '③ 结果',
    title: `${vc.length} 个类别，最多的是「${vc[0][0]}」(${vc[0][1]} 次)`,
    narration: `pandas 默认按频数降序排列，所以第一行就是出现最多的类别。` +
      `占比最高的一项占到 ${(vc[0][1] / df.nrow * 100).toFixed(1)}% —— 如果某一类占绝对多数，说明这一列的区分度很低，做分组特征意义不大。`,
    duration: 3000,
    tone: 'ok',
    final: true,
    code: S.codeAt(0),
    table: S.table(T(df, { rowState: () => 'dim', cellState: (r, i, name) => (name === col ? 'seen' : null) })),
    stage: stage(values.length - 1, { done: true, sorted: true }),
    hud: [{ label: '最大频数', value: `${vc[0][1]}`, tone: 'ok' }, { label: '类别数', value: String(vc.length), tone: 'cyan' }],
  });

  return { frames: S.frames, result: df, summary: `${col} 的频次分布（${vc.length} 类）` };
}

/* ================================================================
 * groupby —— 分组聚合
 * ================================================================ */
export function opGroupBy(df, cfg = {}) {
  const by = cfg.by || df.columns.find((c) => df.dtypes[c] !== 'number');
  const target = cfg.target || df.columns.find((c) => c !== by && df.dtypes[c] === 'number');
  const fn = cfg.fn || 'mean';
  const unit = unitOf(df, target);
  const labelCol = pickLabelCol(df);
  const S = new Script(df, 'groupby');
  S.code(CODE.groupby({ by, spec: `{ "${target}": "${fn}" }` }));

  const keysRaw = df.col(by);
  const keys = [...new Set(keysRaw.map((v) => (isNA(v) ? 'NaN' : String(v))))];
  const bi = df.columns.indexOf(by), ti = df.columns.indexOf(target);
  const valAt = (i) => df._rows[i].cells[ti];

  const buckets = keys.map((k) => ({ key: k, items: [], values: [], mean: 0, count: 0, sum: 0, std: NaN }));
  const bmap = new Map(buckets.map((b) => [b.key, b]));

  /** 桶内有效数值。注意数据存在 items[].value 里，b.values 从未被写入过 */
  const numsOf = (b) => b.items.map((it) => it.value).filter((v) => typeof v === 'number' && Number.isFinite(v));

  const finalize = () => buckets.forEach((b) => {
    const nums = numsOf(b);
    b.count = b.items.length;
    b.sum = sum(nums);
    b.mean = mean(nums);
    b.median = median(nums);
    b.std = std(nums, 1);
    b.nums = nums.length;
  });

  /** 从桶里取出当前 fn 对应的统计量 */
  const pickStat = (b) => {
    const nums = numsOf(b);
    switch (fn) {
      case 'sum': return b.sum;
      case 'count': return b.count;
      case 'median': return median(nums);
      case 'std': return std(nums, 1);
      case 'min': return nums.length ? Math.min(...nums) : NaN;
      case 'max': return nums.length ? Math.max(...nums) : NaN;
      default: return mean(nums);
    }
  };

  const bStage = (cursor, extra = {}) => {
    const snap = buckets.map((b) => ({
      key: b.key,
      items: b.items.map((it) => ({ ...it })),
      count: b.items.length,
    }));
    snap.forEach((b) => {
      const nums = b.items.map((it) => it.value).filter((v) => typeof v === 'number' && Number.isFinite(v));
      b.mean = mean(nums); b.sum = sum(nums); b.nums = nums.length;
      b.std = std(nums, 1); b.median = median(nums);
    });
    return { kind: 'buckets', by, target, fn, unit, labelCol, cursor, total: df.nrow, buckets: snap, keys, ...extra };
  };

  S.add({
    phase: '① 拆解：split-apply-combine',
    title: `按 ${by} 分组，对 ${target} 求 ${FN_LABEL[fn] || fn}`,
    narration: `groupby 的三步曲：split（按分组键把行拆开）→ apply（对每组分别计算）→ combine（把结果拼回一张表）。` +
      `分组键是 ${by}，共 ${keys.length} 个取值，意味着会被拆成 ${keys.length} 个小组。`,
    duration: 3400,
    tone: 'info',
    code: S.codeAt(0),
    table: S.table(T(df, { rowState: () => 'dim', cellState: (r, i, name) => (name === by ? 'focus' : name === target ? 'seen' : null) })),
    stage: bStage(-1),
    hud: [{ label: '分组数', value: String(keys.length), tone: 'cyan' }, { label: '组大小', value: buckets.map((b) => b.count).slice(0, 6).join(' / ') + ' …', tone: 'mute' }],
  });

  /* split：逐行飞入桶 */
  let cursor = -1;
  const CHUNK = 3;
  let countSoFar = 0;
  while (countSoFar < df.nrow) {
    const end = Math.min(countSoFar + CHUNK, df.nrow);
    const moved = [];
    for (let i = countSoFar; i < end; i++) {
      const k = isNA(keysRaw[i]) ? 'NaN' : String(keysRaw[i]);
      const b = bmap.get(k);
      b.items.push({ i, name: labelOf(df, labelCol, i), value: valAt(i) });
      moved.push(`${labelOf(df, labelCol, i)} → ${k}`);
    }
    cursor = end - 1;
    S.add({
      phase: '② split · 拆分组装',
      title: `第 ${countSoFar + 1}–${end} 行飞入各自的组`,
      narration: `${moved.join('，')}。每一行都会被检查 ${by} 的值，然后投进对应的组。注意这不是删除行 —— 它只是给每行贴上组标签，行的总数不变。`,
      duration: 1000,
      tone: 'info',
      code: S.codeAt(0),
      table: S.table(T(df, {
        rowState: (r, i) => (i >= countSoFar && i < end ? 'focus' : (i < end ? 'dim' : 'normal')),
        cellState: (r, i, name) => (name === by ? (i < end ? 'seen' : null) : null),
      })),
      stage: bStage(cursor),
      hud: [{ label: '已分组', value: `${end}/${df.nrow}`, tone: 'cyan' }],
    });
    countSoFar = end;
  }

  finalize();

  S.add({
    phase: '③ apply · 组内计算',
    title: `对每个组分别求 ${FN_LABEL[fn] || fn}`,
    narration: buckets.map((b) => `${b.key} 组有 ${b.count} 个成员，${target} 的 ${fn} = ${fmt(pickStat(b))}${fn === 'count' ? '' : unit}`).join('；') +
      '。每一组都独立计算，组与组之间互不影响。',
    duration: 3200,
    tone: 'gold',
    code: S.codeAt(0),
    table: S.table(T(df, { rowState: () => 'dim', cellState: (r, i, name) => (name === by ? 'seen' : null) })),
    stage: bStage(df.nrow - 1, { computed: true }),
    hud: [{ label: '分组数', value: String(keys.length), tone: 'cyan' }],
  });

  /* combine：生成结果表 */
  const round2 = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : v);
  const outName = `${target}_${fn}`;
  const cols = [by, outName];
  const data = buckets.map((b) => [b.key, round2(pickStat(b))]);
  const result = new (df.constructor)(cols, data, {
    name: `${df.name}_grouped`,
    source: `df.groupby("${by}").agg({"${target}": "${fn}"})`,
    meta: {
      title: `${by} 分组 · ${target} 的 ${fn}`,
      subtitle: `${buckets.length} 个分组`,
      unit: { [outName]: unit },
    },
  });

  S.add({
    phase: '④ combine · 拼回结果表',
    title: `${df.nrow} 行 → ${result.nrow} 行`,
    narration: `combine 把每组的一个数字拼成一张新表：${keys.length} 个组，就是 ${result.nrow} 行。` +
      `行数大幅减少但信息更浓缩 —— 这就是分组聚合的威力：把「${df.nrow} 条明细」变成「${result.nrow} 个结论」。`,
    duration: 3000,
    tone: 'ok',
    final: true,
    code: S.codeAt(1),
    table: S.table(T(result, { cellState: (r, i, name) => (name === `${target}_${fn}` ? 'best' : null) })),
    stage: bStage(df.nrow - 1, { computed: true, combined: true }),
    hud: [{ label: 'shape', value: `${df.nrow}×${df.ncol} → ${result.nrow}×${result.ncol}`, tone: 'ok' },
      { label: '分组数', value: String(result.nrow), tone: 'cyan' }],
  });

  return { frames: S.frames, result, summary: `按 ${by} 分组统计 ${target} 的 ${fn}` };
}
