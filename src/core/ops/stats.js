/* ------------------------------------------------------------------
 * ops/stats.js — 统计与聚合
 *  info / describe / agg / value_counts / groupby / corr
 * ------------------------------------------------------------------ */

import { Script, T, CODE } from '../frames.js';
import { L } from '../../i18n/index.js';
import { fmt, isNA, mean, median, std, sum } from '../utils.js';
import { ph, pickLabelCol, pickCategoryCol, unitOf, colSummary, labelOf } from './kit.js';

const F = (S, o) => S.add({
  phase: o.p, title: o.t, narration: o.n,
  duration: o.d ?? 1500, tone: o.tone || 'info',
  code: S.codeAt(o.c ?? 0), table: o.tab, stage: o.st, hud: o.hud, final: o.final,
});

const FN_LABEL = {
  mean: L('mean 均值', 'mean'), median: L('median 中位数', 'median'), std: L('std 标准差', 'std'),
  sum: L('sum 求和', 'sum'), min: L('min 最小值', 'min'), max: L('max 最大值', 'max'),
  count: L('count 计数', 'count'),
};
const fnLabel = (fn) => FN_LABEL[fn] || L(fn, fn);

/* ================================================================
 * info
 * ================================================================ */
export function opInfo(df) {
  const S = new Script(df, 'info');
  S.code(CODE.info());
  const info = df.info();
  const nulls = df.nullCounts();
  const totalNull = Object.values(nulls).reduce((a, b) => a + b, 0);

  F(S, {
    p: ph('①', '表的结构', 'The shape of the frame'),
    t: L(`${info.shape[0]} 行 × ${info.shape[1]} 列`, `${info.shape[0]} rows × ${info.shape[1]} columns`),
    n: L('info() 不关心数值是多少，只回答「这张表长什么样」：有多少行、每列是什么类型、有没有缺失、占多少内存。这是拿到任何数据集后的第一个动作。',
      'info() does not care what the values are — it answers what the frame looks like: row count, each column dtype, where the gaps are, how much memory it takes. It is the first thing you run on any dataset.'),
    d: 2600, c: 0,
    tab: T(df, {}),
    st: { kind: 'info', info, revealed: 0 },
    hud: [{ label: 'shape', value: `${info.shape[0]} × ${info.shape[1]}`, tone: 'cyan' },
      { label: 'missing', value: String(totalNull), tone: 'danger' }],
  });

  const CHUNK = 4;
  for (let i = 0; i < info.columns.length; i += CHUNK) {
    const end = Math.min(i + CHUNK, info.columns.length);
    const cols = info.columns.slice(i, end);
    F(S, {
      p: ph('②', '逐列检查', 'Column by column'),
      t: L(`第 ${i + 1}–${end} 个字段`, `Columns ${i + 1}–${end}`),
      n: cols.map((c) => L(`${c.name} 是 ${c.dtype}，非空 ${c.nonNull} 个${c.nulls ? `，缺失 ${c.nulls} 个 ⚠` : '，无缺失 ✓'}`,
        `${c.name} is ${c.dtype} with ${c.nonNull} non-null${c.nulls ? ` and ${c.nulls} missing ⚠` : ', none missing ✓'}`))
        .map((x) => (typeof x === 'object' ? x.zh : x)).join('；') + '。',
      d: 1100, tone: cols.some((c) => c.nulls) ? 'warn' : 'info', c: 0,
      tab: T(df, { cellState: (r, k, name) => (cols.some((c) => c.name === name) ? 'focus' : 'dim') }),
      st: { kind: 'info', info, revealed: end },
      hud: [{ label: 'checked', value: `${end}/${info.columns.length}`, tone: 'cyan' }],
    });
  }

  F(S, {
    p: ph('③', '结论', 'Conclusion'),
    t: totalNull ? L(`发现 ${totalNull} 个缺失值，需要清洗`, `${totalNull} missing cells — cleaning needed`) : L('数据完整，可以直接分析', 'Data is complete, ready to analyse'),
    n: totalNull
      ? L('info() 的价值就在于：它在你还不知道要做什么分析之前，就先把「哪里有问题」标了出来。下一步自然就是决定 dropna 还是 fillna。',
        'The value of info() is that it flags the problems before you even know what analysis you want. The natural next step is choosing between dropna and fillna.')
      : L('所有字段都没有缺失，类型也符合预期，可以放心进入下一步。',
        'No column has gaps and every dtype is as expected — safe to continue.'),
    d: 2600, tone: totalNull ? 'warn' : 'ok', c: 0, final: true,
    tab: T(df, { cellState: (r, i, name) => (nulls[name] ? 'na' : null) }),
    st: { kind: 'info', info, revealed: info.columns.length, done: true },
    hud: [{ label: 'dtypes', value: String(new Set(info.columns.map((c) => c.dtype)).size), tone: 'mute' },
      { label: 'missing', value: String(totalNull), tone: totalNull ? 'danger' : 'ok' }],
  });

  return { frames: S.frames, result: df, summary: L(`info() 结构概览（${totalNull} 个缺失值）`, `info() overview (${totalNull} missing)`) };
}

/* ================================================================
 * describe
 * ================================================================ */
export function opDescribe(df) {
  const cols = df.columns.filter((c) => df.dtypes[c] === 'number');
  const S = new Script(df, 'describe');
  S.code(CODE.describe());
  const desc = df.describe();
  const rows = desc.index;

  const EXPL = {
    count: L('有多少个非缺失值 —— 先看它，才知道这列的样本量够不够。', 'How many non-null values — check this first to know whether the sample is big enough.'),
    mean: L('算术平均：Σx / n。对极端值敏感，一个离群点就能把它拽走。', 'Arithmetic mean, Σx / n. Sensitive to extremes: one outlier can drag it away.'),
    std: L('样本标准差（ddof=1）：数据围绕均值波动的典型幅度。', 'Sample standard deviation (ddof=1): the typical spread around the mean.'),
    min: L('最小值。配合 max 就能看出数据的整体跨度。', 'The minimum. Together with max it gives the overall span.'),
    '25%': L('第一四分位数 Q1：25% 的数据小于它。分位数不受极端值影响，比均值更「抗造」。', 'First quartile Q1: 25% of values fall below it. Quantiles ignore extremes, so they are far more robust than the mean.'),
    '50%': L('中位数 Q2：正中间的值。当 mean 与 50% 差距很大时，说明分布是偏斜的。', 'Median Q2: the middle value. A large gap between mean and 50% means the distribution is skewed.'),
    '75%': L('第三四分位数 Q3：75% 的数据小于它。Q3 − Q1 就是 IQR，离群值检测的基础。', 'Third quartile Q3: 75% of values fall below it. Q3 − Q1 is the IQR, the basis of outlier detection.'),
    max: L('最大值。max 与 75% 之间的巨大空隙，往往就是离群值藏身之处。', 'The maximum. A large gap between 75% and max is usually where outliers hide.'),
  };

  F(S, {
    p: ph('①', '一句话看懂一列', 'Understand a column at a glance'),
    t: L(`describe() 会一次性给出 ${rows.length} 项统计`, `describe() returns ${rows.length} statistics at once`),
    n: L(`面对一列数字，人眼只能看出「大概」。describe() 用 ${rows.length} 个指标把它讲清楚：count 有多少有效值、mean 平均水平、std 波动大小、min/max 边界，以及 25%/50%/75% 三个分位点如何切分数据。`,
      `Looking at a column of numbers, the eye only sees "roughly". describe() explains it with ${rows.length} numbers: count of valid values, mean level, std spread, min/max bounds, and how the 25/50/75 quantiles slice the data.`),
    d: 2800, c: 0,
    tab: T(df, { cellState: (r, i, name) => (cols.includes(name) ? 'focus' : 'dim') }),
    st: { kind: 'describe', cols, rows, data: {}, revealed: [] },
    hud: [{ label: L('数值列', 'numeric'), value: String(cols.length), tone: 'cyan' },
      { label: L('指标', 'stats'), value: String(rows.length), tone: 'mute' }],
  });

  rows.forEach((r, k) => {
    F(S, {
      p: ph('②', '逐项揭示', 'Reveal one by one'),
      t: `${r}`,
      n: EXPL[r],
      d: 1600, tone: k === rows.length - 1 ? 'gold' : 'info', c: 0,
      tab: T(df, { cellState: (r2, i, name) => (cols.includes(name) ? 'focus' : 'dim') }),
      st: { kind: 'describe', cols, rows, data: desc.data, revealed: rows.slice(0, k + 1), active: r, unit: df.meta?.unit || {} },
      hud: [{ label: L('已揭示', 'revealed'), value: `${k + 1}/${rows.length}`, tone: 'cyan' }],
    });
  });

  F(S, {
    p: ph('③', '结果', 'Result'),
    t: L('一张表读懂全部数值字段', 'One table, every numeric column'),
    n: L('对比不同列的 std 与 IQR，可以立刻判断哪一列波动最大。这也是为什么在真正画图之前，老手都会先跑一次 describe —— 它决定了后面该关注什么。',
      'Comparing std and IQR across columns immediately shows which one varies most. This is why experienced analysts always run describe before plotting — it decides what to look at next.'),
    d: 2800, tone: 'ok', c: 0, final: true,
    tab: T(df, { cellState: (r, i, name) => (cols.includes(name) ? 'best' : 'dim') }),
    st: { kind: 'describe', cols, rows, data: desc.data, revealed: rows, unit: df.meta?.unit || {}, done: true },
    hud: [{ label: 'shape', value: `${df.nrow} × ${df.ncol}`, tone: 'mute' }, { label: L('数值列', 'numeric'), value: String(cols.length), tone: 'ok' }],
  });

  return { frames: S.frames, result: df, summary: L(`describe() 摘要（${cols.length} 个数值列）`, `describe() summary (${cols.length} numeric columns)`) };
}

/* ================================================================
 * 单列归约
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
  const ns = values.filter((v) => typeof v === 'number' && Number.isFinite(v));
  const n = ns.length;
  const total = sum(ns), m = mean(ns), med = median(ns), sd = std(ns, 1);
  const lo = Math.min(...ns), hi = Math.max(...ns);

  let result;
  switch (fn) {
    case 'sum': result = total; break;
    case 'median': result = med; break;
    case 'std': result = sd; break;
    case 'min': result = lo; break;
    case 'max': result = hi; break;
    case 'count': result = n; break;
    default: result = m;
  }

  const stage = (cursor, extra = {}) => ({
    kind: 'reduce', col, unit, fn, labelCol, dom: { min: lo, max: hi },
    cursor, total: values.length, validN: n,
    entries: values.map((v, i) => ({
      i, name: labelOf(df, labelCol, i), value: v,
      t: valid[i] ? (v - lo) / ((hi - lo) || 1) : 0.5,
      na: !valid[i], consumed: cursor < 0 ? false : i <= cursor,
    })),
    runningSum: 0, runningCount: 0, ...extra,
  });

  F(S, {
    p: ph('①', '目标', 'Goal'),
    t: L(`${col}.${fn}() —— 把 ${n} 个值折叠成 1 个`, `${col}.${fn}() — fold ${n} values into 1`),
    n: L(`归约（reduce）的本质是：遍历整列，把 n 个数字压缩成一个结论。${fnLabel(fn).zh} 在 pandas 里只需要一句 ${col}.${fn}()，但这一句话背后发生了什么，才是真正值得看的。`,
      `Reduction means walking the column and compressing n numbers into one conclusion. In pandas this is just ${col}.${fn}() — but what happens behind that one line is what is worth watching.`),
    d: 2600, c: 0,
    tab: T(df, { rowState: () => 'dim', cellState: (r, i, name) => (name === col ? 'focus' : null) }),
    st: stage(-1),
    hud: [{ label: 'n', value: String(n), tone: 'cyan' }, { label: 'NaN', value: String(values.length - n), tone: 'mute' }],
  });

  if (fn === 'sum' || fn === 'mean') {
    let acc = 0, cnt = 0;
    const CHUNK = 4;
    for (let i = 0; i < values.length; i += CHUNK) {
      const end = Math.min(i + CHUNK, values.length);
      const seg = [];
      for (let k = i; k < end; k++) if (valid[k]) { acc += values[k]; cnt++; seg.push(values[k]); }
      F(S, {
        p: ph('②', '逐个累加', 'Accumulate'),
        t: L(`累加到 ${fmt(acc)}`, `Running total ${fmt(acc)}`),
        n: seg.length
          ? L(`把第 ${i + 1}–${end} 行纳入累加器：+${seg.map(fmt).join(' + ')} → 当前累计 ${fmt(acc)}${unit}（已处理 ${cnt} 个有效值）。注意 NaN 会被自动跳过，不参与计算 —— 这正是 pandas 的默认行为（skipna=True）。`,
            `Add rows ${i + 1}–${end}: +${seg.map(fmt).join(' + ')} → running total ${fmt(acc)}${unit} (${cnt} valid values so far). NaN is skipped automatically — pandas defaults to skipna=True.`)
          : L(`第 ${i + 1}–${end} 行全部缺失，累加器数值保持不变。`, `Rows ${i + 1}–${end} are all missing; the accumulator is unchanged.`),
        d: 850, c: 0,
        tab: T(df, {
          rowState: (r, j) => (j >= i && j < end ? 'focus' : 'dim'),
          cellState: (r, j, name) => (name === col ? (j < end ? (valid[j] ? 'seen' : 'na') : null) : null),
        }),
        st: stage(end - 1, {
          runningSum: acc, runningCount: cnt,
          display: fn === 'sum' ? acc : acc / (cnt || 1),
          displayLabel: fn === 'sum' ? L('累加器 Σx', 'accumulator Σx') : L('当前均值 Σx / n', 'running mean Σx / n'),
        }),
        hud: [{ label: 'Σx', value: fmt(acc), tone: 'gold' }, { label: 'n', value: String(cnt), tone: 'cyan' }],
      });
    }
    if (fn === 'mean') {
      F(S, {
        p: ph('③', '除以样本量', 'Divide by n'),
        t: L(`${fmt(acc)} ÷ ${n} = ${fmt(m)}`, `${fmt(acc)} ÷ ${n} = ${fmt(m)}`),
        n: L(`累加器里是全部有效值的和 ${fmt(acc)}。除以有效样本数 ${n}，就得到均值 ${fmt(m)}${unit}。这也是为什么缺失值会让均值「失真」：分母变了，分子却没变。`,
          `The accumulator holds the sum of every valid value, ${fmt(acc)}. Divide by the valid count ${n} to get the mean ${fmt(m)}${unit}. This is also why missing values distort a mean: the denominator changed while the numerator did not.`),
        d: 2400, tone: 'gold', c: 0,
        tab: T(df, { rowState: () => 'dim', cellState: (r, i, name) => (name === col ? 'seen' : null) }),
        st: stage(values.length - 1, { runningSum: acc, runningCount: n, display: m, displayLabel: 'Σx / n = mean', final: true }),
        hud: [{ label: 'Σx', value: fmt(acc), tone: 'gold' }, { label: 'n', value: String(n), tone: 'cyan' }, { label: 'mean', value: fmt(m) + unit, tone: 'ok' }],
      });
    }
  } else if (fn === 'std') {
    F(S, {
      p: ph('②', '第一遍：求均值', 'Pass 1: the mean'),
      t: L(`第一遍扫描：先求出均值 ${fmt(m)}`, `First pass: mean = ${fmt(m)}`),
      n: L('标准差衡量的是「数据离均值有多远」。所以第一步必须先知道均值在哪 —— 这是第一遍扫描。',
        'Standard deviation measures how far values sit from the mean, so the first pass must establish where the mean is.'),
      d: 2200, c: 0,
      tab: T(df, { rowState: () => 'dim', cellState: (r, i, name) => (name === col ? 'seen' : null) }),
      st: stage(values.length - 1, { runningSum: total, runningCount: n, display: m, displayLabel: L('第一遍 · mean', 'pass 1 · mean') }),
    });
    let accSq = 0, cnt = 0;
    const CHUNK = 4;
    for (let i = 0; i < values.length; i += CHUNK) {
      const end = Math.min(i + CHUNK, values.length);
      for (let k = i; k < end; k++) if (valid[k]) { accSq += (values[k] - m) ** 2; cnt++; }
      F(S, {
        p: ph('③', '第二遍：偏差平方累加', 'Pass 2: sum of squares'),
        t: L(`Σ(x − x̄)² = ${fmt(accSq)}`, `Σ(x − x̄)² = ${fmt(accSq)}`),
        n: L(`把第 ${i + 1}–${end} 行的值减去均值 ${fmt(m)}，再平方（平方是为了让正负偏差都算作「距离」而不互相抵消），累加进 Σ(x−x̄)²。`,
          `Subtract the mean ${fmt(m)} from rows ${i + 1}–${end}, square it (squaring stops positive and negative deviations cancelling), and add to Σ(x−x̄)².`),
        d: 850, c: 0,
        tab: T(df, { rowState: (r, j) => (j >= i && j < end ? 'focus' : 'dim'), cellState: (r, j, name) => (name === col ? (j < end ? 'seen' : null) : null) }),
        st: stage(end - 1, { runningSum: accSq, runningCount: cnt, display: accSq, displayLabel: 'Σ(x − x̄)²', devMode: true, center: m }),
        hud: [{ label: 'Σ(x−x̄)²', value: fmt(accSq), tone: 'gold' },
          { label: 'n−1', value: String(Math.max(0, n - 1)), tone: 'cyan' },
          { label: 'std', value: fmt(Math.sqrt(accSq / Math.max(1, n - 1))), tone: 'ok' }],
      });
    }
    F(S, {
      p: ph('④', '开方', 'Square root'),
      t: L(`σ = √(${fmt(accSq)} / ${n - 1}) = ${fmt(sd)}`, `σ = √(${fmt(accSq)} / ${n - 1}) = ${fmt(sd)}`),
      n: L(`除以 n−1（贝塞尔校正，让样本标准差成为总体标准差的无偏估计），再开平方，得到 ${fmt(sd)}${unit}。pandas 的 .std() 默认就是这个 ddof=1 的版本，而 numpy 默认是 ddof=0 —— 这个差异经常让两组结果对不上。`,
        `Divide by n−1 (Bessel's correction, making the sample standard deviation an unbiased estimator of the population one) and take the square root: ${fmt(sd)}${unit}. pandas .std() defaults to ddof=1 while numpy defaults to ddof=0 — that mismatch is a classic source of "why don't these numbers agree?".`),
      d: 2800, tone: 'gold', c: 0,
      tab: T(df, { rowState: () => 'dim', cellState: (r, i, name) => (name === col ? 'seen' : null) }),
      st: stage(values.length - 1, { runningSum: accSq, runningCount: n, display: sd, displayLabel: 'std', final: true, devMode: true, center: m }),
      hud: [{ label: 'Σ(x−x̄)²', value: fmt(accSq), tone: 'gold' }, { label: 'ddof', value: '1', tone: 'mute' }, { label: 'std', value: fmt(sd) + unit, tone: 'ok' }],
    });
  } else if (fn === 'median') {
    const sorted = ns.slice().sort((a, b) => a - b);
    const mid = n >> 1;
    F(S, {
      p: ph('②', '排序', 'Sort'),
      t: L('中位数要求数据有序', 'The median needs order'),
      n: L(`中位数是「排在正中间的那个数」，所以必须先排序。排序后落在正中间位置的值就是中位数。`,
        `The median is the value in the middle, so the data must be sorted first. The value at the middle position is the median.`),
      d: 2400, c: 0,
      tab: T(df, { rowState: () => 'dim', cellState: (r, i, name) => (name === col ? 'seen' : null) }),
      st: { kind: 'sortedbars', by: col, unit, labelCol, values: sorted, labels: sorted.map((v, i) => `#${i}`), highlight: n % 2 ? [mid] : [mid - 1, mid], median: med, title: L(`${col} 升序排列，标出正中位置`, `${col} sorted, middle highlighted`) },
    });
    F(S, {
      p: ph('③', '取中位', 'Take the middle'),
      t: n % 2 ? L(`第 ${mid + 1} 位 = ${fmt(med)}`, `Position ${mid + 1} = ${fmt(med)}`) : L(`中间两位的平均 = ${fmt(med)}`, `Mean of the two middle values = ${fmt(med)}`),
      n: n % 2
        ? L(`样本量 ${n} 是奇数，正中位置只有一个值：${fmt(med)}${unit}。`, `With ${n} samples (odd) there is a single middle value: ${fmt(med)}${unit}.`)
        : L(`样本量 ${n} 是偶数，正中有两个值 ${fmt(sorted[mid - 1])} 与 ${fmt(sorted[mid])}，取它们的平均得到 ${fmt(med)}${unit}。`,
          `With ${n} samples (even) there are two middle values, ${fmt(sorted[mid - 1])} and ${fmt(sorted[mid])}; their average is ${fmt(med)}${unit}.`),
      d: 2400, tone: 'gold', c: 0,
      tab: T(df, { rowState: () => 'dim', cellState: (r, i, name) => (name === col ? 'seen' : null) }),
      st: { kind: 'sortedbars', by: col, unit, labelCol, values: sorted, labels: sorted.map((v, i) => `#${i}`), highlight: n % 2 ? [mid] : [mid - 1, mid], median: med, done: true, title: L(`中位数 = ${fmt(med)}${unit}`, `median = ${fmt(med)}${unit}`) },
      hud: [{ label: 'median', value: fmt(med) + unit, tone: 'ok' }, { label: 'mean', value: fmt(m) + unit, tone: 'mute' }],
    });
  } else {
    F(S, {
      p: ph('②', '扫描', 'Scan'),
      t: L(`${fn} = ${fmt(result)}`, `${fn} = ${fmt(result)}`),
      n: L(`pandas 会完整扫过这一列的 ${n} 个有效值，逐个比较并保留${fn === 'min' ? '最小的那个' : fn === 'max' ? '最大的那个' : '计数'}，最终得到 ${fmt(result)}${fn === 'count' ? '' : unit}。`,
        `pandas walks all ${n} valid values, comparing and keeping ${fn === 'min' ? 'the smallest' : fn === 'max' ? 'the largest' : 'the count'}, ending at ${fmt(result)}${fn === 'count' ? '' : unit}.`),
      d: 2200, c: 0,
      tab: T(df, {
        rowState: () => 'dim',
        cellState: (r, i, name) => {
          if (name !== col) return null;
          if (fn === 'min' && values[i] === result) return 'champ-min';
          if (fn === 'max' && values[i] === result) return 'champ-max';
          return 'seen';
        },
      }),
      st: stage(values.length - 1, { display: result, displayLabel: fn }),
    });
  }

  const s = colSummary(df, col);
  F(S, {
    p: ph('⑤', '结果', 'Result'),
    t: L(`${col}.${fn}() = ${fmt(result)}${fn === 'count' ? '' : unit}`, `${col}.${fn}() = ${fmt(result)}${fn === 'count' ? '' : unit}`),
    n: L(`回到最初的问题：这一列的整体水平是多少？答案是 ${fmt(result)}${fn === 'count' ? '' : unit}。但它只是一个数字 —— 真正理解数据还需要标准差 ${fmt(s.std)} 和分布形态来佐证（见下方「统计」与「图表」视图）。`,
      `Back to the original question: what is the overall level of this column? ${fmt(result)}${fn === 'count' ? '' : unit}. But that is only one number — understanding it needs the standard deviation ${fmt(s.std)} and the distribution shape (see the Stats and Charts views below).`),
    d: 2800, tone: 'ok', c: 0, final: true,
    tab: T(df, { cellState: (r, i, name) => (name === col ? 'best' : null) }),
    st: { kind: 'statcard', col, unit, fn, result, label: fnLabel(fn), summary: s },
    hud: [{ label: fn, value: fmt(result) + (fn === 'count' ? '' : unit), tone: 'ok' }, { label: 'n', value: String(n), tone: 'cyan' }],
  });

  return { frames: S.frames, result: df, summary: L(`${col}.${fn}() = ${fmt(result)}`, `${col}.${fn}() = ${fmt(result)}`) };
}

/* ================================================================
 * value_counts
 * ================================================================ */
export function opValueCounts(df, cfg = {}) {
  const col = cfg.col || pickCategoryCol(df);
  const normalize = cfg.normalize === true;
  const S = new Script(df, normalize ? 'value_counts_norm' : 'value_counts');
  S.code(CODE[normalize ? 'vcNorm' : 'vc'](col));
  const vc = df.valueCounts(col);
  const values = df.col(col);
  const keys = vc.map(([k]) => k);

  const stage = (cursor, extra = {}) => {
    const counts = {};
    keys.forEach((k) => counts[k] = 0);
    for (let i = 0; i <= cursor && i < values.length; i++) {
      const k = isNA(values[i]) ? 'NaN' : String(values[i]);
      counts[k] = (counts[k] || 0) + 1;
    }
    return {
      kind: 'tally', col, cursor, total: values.length, keys, counts, normalize,
      entries: values.map((v, i) => ({ i, key: isNA(v) ? 'NaN' : String(v), na: isNA(v), counted: i <= cursor })),
      sorted: vc.map(([k, c]) => ({ key: k, count: c })),
      maxCount: Math.max(...vc.map(([, c]) => c), 1), ...extra,
    };
  };

  F(S, {
    p: ph('①', '归类', 'Tally'),
    t: L(`${col} 有多少种取值？各出现几次？`, `How many distinct ${col} values, and how often?`),
    n: L('value_counts() 回答的是「分布」问题：不看数值大小，只看每一类出现了多少次。它内部就是一个哈希表 —— 遍历整列，遇到已有的键就把计数加一，遇到新的键就建立一条记录。',
      'value_counts() answers a distribution question: not how big the values are, but how often each category appears. Internally it is a hash table — walk the column, bump the counter for a known key, create a record for a new one.'),
    d: 2800, c: 0,
    tab: T(df, { rowState: () => 'dim', cellState: (r, i, name) => (name === col ? 'focus' : null) }),
    st: stage(-1),
    hud: [{ label: L('类别数', 'categories'), value: String(vc.length), tone: 'cyan' }, { label: 'n', value: String(df.nrow), tone: 'mute' }],
  });

  const CHUNK = 5;
  for (let i = 0; i < values.length; i += CHUNK) {
    const end = Math.min(i + CHUNK, values.length);
    const seg = values.slice(i, end).map((v) => (isNA(v) ? 'NaN' : String(v)));
    F(S, {
      p: ph('②', '投递计数', 'Count them in'),
      t: L(`第 ${i + 1}–${end} 行依次入桶`, `Rows ${i + 1}–${end} drop into buckets`),
      n: L(`把 ${seg.join('、')} 分别投入对应的桶中，每投一次桶里的计数加一。桶的数量即为该取值的频数。`,
        `${seg.join(', ')} each drop into their bucket, bumping the count. The bucket size is that category's frequency.`),
      d: 900, c: 0,
      tab: T(df, { rowState: (r, j) => (j >= i && j < end ? 'focus' : 'dim'), cellState: (r, j, name) => (name === col ? (j < end ? 'seen' : null) : null) }),
      st: stage(end - 1),
      hud: [{ label: 'counted', value: `${end}/${values.length}`, tone: 'cyan' }],
    });
  }

  const top = vc[0];
  const total = df.nrow;
  F(S, {
    p: ph('③', '结果', 'Result'),
    t: normalize
      ? L(`${vc.length} 个类别，最高占比 ${(top[1] / total * 100).toFixed(1)}%`, `${vc.length} categories, top share ${(top[1] / total * 100).toFixed(1)}%`)
      : L(`${vc.length} 个类别，最多的是「${top[0]}」(${top[1]} 次)`, `${vc.length} categories, most common "${top[0]}" (${top[1]})`),
    n: normalize
      ? L('normalize=True 把计数换成了占比：每一类的比例加起来正好是 100%。比较不同规模的数据集时，占比比绝对数量更有意义。',
        'normalize=True turns counts into proportions that sum to 100%. When comparing datasets of different sizes, proportions mean far more than raw counts.')
      : L(`pandas 默认按频数降序排列，所以第一行就是出现最多的类别。占比最高的一项占到 ${(top[1] / total * 100).toFixed(1)}% —— 如果某一类占绝对多数，说明这一列的区分度很低，做分组特征意义不大。`,
        `pandas sorts by frequency descending, so the first row is the most common category. The top one takes ${(top[1] / total * 100).toFixed(1)}% — when one category dominates, the column has little discriminating power and makes a poor grouping feature.`),
    d: 2800, tone: 'ok', c: 0, final: true,
    tab: T(df, { rowState: () => 'dim', cellState: (r, i, name) => (name === col ? 'seen' : null) }),
    st: stage(values.length - 1, { done: true, sorted: true }),
    hud: [{ label: L('最大频数', 'max count'), value: String(top[1]), tone: 'ok' },
      { label: L('类别数', 'categories'), value: String(vc.length), tone: 'cyan' }],
  });

  return { frames: S.frames, result: df, summary: L(`${col} 的频次分布（${vc.length} 类）`, `Frequency of ${col} (${vc.length} categories)`) };
}

/* ================================================================
 * groupby
 * ================================================================ */
export function opGroupBy(df, cfg = {}) {
  const by = cfg.by || pickCategoryCol(df);
  const target = cfg.target || df.columns.find((c) => c !== by && df.dtypes[c] === 'number');
  const fn = cfg.fn || 'mean';
  const unit = unitOf(df, target);
  const labelCol = pickLabelCol(df);
  const S = new Script(df, 'groupby');
  S.code(CODE.groupby({ by, spec: `{ "${target}": "${fn}" }` }));

  const keysRaw = df.col(by);
  const keys = [...new Set(keysRaw.map((v) => (isNA(v) ? 'NaN' : String(v))))];
  const ti = df.columns.indexOf(target);
  const buckets = keys.map((k) => ({ key: k, items: [] }));
  const bmap = new Map(buckets.map((b) => [b.key, b]));

  const numsOf = (b) => b.items.map((it) => it.value).filter((v) => typeof v === 'number' && Number.isFinite(v));
  const pickStat = (b) => {
    const ns = numsOf(b);
    switch (fn) {
      case 'count': return b.items.length;
      case 'sum': return sum(ns);
      case 'median': return median(ns);
      case 'std': return std(ns, 1);
      case 'min': return ns.length ? Math.min(...ns) : NaN;
      case 'max': return ns.length ? Math.max(...ns) : NaN;
      default: return mean(ns);
    }
  };

  const bStage = (cursor, extra = {}) => {
    const snap = buckets.map((b) => ({ key: b.key, items: b.items.map((it) => ({ ...it })), count: b.items.length }));
    snap.forEach((b) => {
      const ns = b.items.map((it) => it.value).filter((v) => typeof v === 'number' && Number.isFinite(v));
      b.mean = mean(ns); b.sum = sum(ns); b.nums = ns.length;
      b.std = std(ns, 1); b.median = median(ns);
      b.min = ns.length ? Math.min(...ns) : NaN; b.max = ns.length ? Math.max(...ns) : NaN;
    });
    return { kind: 'buckets', by, target, fn, unit, labelCol, cursor, total: df.nrow, buckets: snap, keys, ...extra };
  };

  F(S, {
    p: ph('①', '拆解：split-apply-combine', 'Split · apply · combine'),
    t: L(`按 ${by} 分组，对 ${target} 求 ${fn}`, `Group by ${by}, aggregate ${target} with ${fn}`),
    n: L(`groupby 的三步曲：split（按分组键把行拆开）→ apply（对每组分别计算）→ combine（把结果拼回一张表）。分组键是 ${by}，共 ${keys.length} 个取值，意味着会被拆成 ${keys.length} 个小组。`,
      `groupby has three acts: split (break rows apart by the key), apply (compute within each group), combine (stitch the results into one frame). The key is ${by} with ${keys.length} distinct values, so there will be ${keys.length} groups.`),
    d: 3000, c: 0,
    tab: T(df, { rowState: () => 'dim', cellState: (r, i, name) => (name === by ? 'focus' : name === target ? 'seen' : null) }),
    st: bStage(-1),
    hud: [{ label: L('分组数', 'groups'), value: String(keys.length), tone: 'cyan' },
      { label: L('组大小', 'sizes'), value: buckets.map((b) => b.items.length).slice(0, 5).join('/') || '—', tone: 'mute' }],
  });

  const CHUNK = 3;
  for (let i = 0; i < df.nrow; i += CHUNK) {
    const end = Math.min(i + CHUNK, df.nrow);
    const moved = [];
    for (let k = i; k < end; k++) {
      const key = isNA(keysRaw[k]) ? 'NaN' : String(keysRaw[k]);
      bmap.get(key).items.push({ i: k, name: labelOf(df, labelCol, k), value: df._rows[k].cells[ti] });
      moved.push(`${labelOf(df, labelCol, k)} → ${key}`);
    }
    F(S, {
      p: ph('②', 'split · 拆分组装', 'split · assign to groups'),
      t: L(`第 ${i + 1}–${end} 行飞入各自的组`, `Rows ${i + 1}–${end} fly into their groups`),
      n: L(`${moved.join('，')}。每一行都会被检查 ${by} 的值，然后投进对应的组。注意这不是删除行 —— 它只是给每行贴上组标签，行的总数不变。`,
        `${moved.join('; ')}. Each row has its ${by} inspected and is dropped into the matching group. This is not deletion — rows are merely tagged and the total never changes.`),
      d: 950, c: 0,
      tab: T(df, { rowState: (r, j) => (j >= i && j < end ? 'focus' : (j < end ? 'dim' : 'normal')), cellState: (r, j, name) => (name === by ? (j < end ? 'seen' : null) : null) }),
      st: bStage(end - 1),
      hud: [{ label: 'grouped', value: `${end}/${df.nrow}`, tone: 'cyan' }],
    });
  }

  F(S, {
    p: ph('③', 'apply · 组内计算', 'apply · compute within groups'),
    t: L(`对每个组分别求 ${fn}`, `Apply ${fn} to each group`),
    n: buckets.map((b) => `${b.key}: ${b.items.length} → ${fmt(pickStat(b))}${fn === 'count' ? '' : unit}`).join('  ·  ') +
      L('。每一组都独立计算，组与组之间互不影响。', '  Each group is computed independently.'),
    d: 3000, tone: 'gold', c: 0,
    tab: T(df, { rowState: () => 'dim', cellState: (r, i, name) => (name === by ? 'seen' : null) }),
    st: bStage(df.nrow - 1, { computed: true }),
  });

  const round2 = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : v);
  const outName = `${target}_${fn}`;
  const cols = [by, outName];
  const data = buckets.map((b) => [b.key, round2(pickStat(b))]);
  const result = new (df.constructor)(cols, data, {
    name: `${df.name}_grouped`,
    source: `df.groupby("${by}").agg({"${target}": "${fn}"})`,
    meta: { title: `${by} → ${fn}(${target})`, subtitle: L(`${buckets.length} 个分组`, `${buckets.length} groups`), unit: { [outName]: unit }, builtin: false },
  });
  S.use(result);
  F(S, {
    p: ph('④', 'combine · 拼回结果表', 'combine · assemble the result'),
    t: L(`${df.nrow} 行 → ${result.nrow} 行`, `${df.nrow} rows → ${result.nrow} rows`),
    n: L(`combine 把每组的一个数字拼成一张新表：${keys.length} 个组就是 ${result.nrow} 行。行数大幅减少但信息更浓缩 —— 这就是分组聚合的威力：把「${df.nrow} 条明细」变成「${result.nrow} 个结论」。`,
      `combine assembles one number per group into a new frame: ${keys.length} groups become ${result.nrow} rows. Far fewer rows, far denser information — the power of grouping: ${df.nrow} records become ${result.nrow} conclusions.`),
    d: 3000, tone: 'ok', c: 1, final: true,
    tab: T(result, { cellState: (r, i, name) => (name === outName ? 'best' : null) }),
    st: bStage(df.nrow - 1, { computed: true, combined: true }),
    hud: [{ label: 'shape', value: `${df.nrow}×${df.ncol} → ${result.nrow}×${result.ncol}`, tone: 'ok' },
      { label: L('分组数', 'groups'), value: String(result.nrow), tone: 'cyan' }],
  });

  return { frames: S.frames, result, summary: L(`按 ${by} 分组统计 ${target} 的 ${fn}`, `groupby(${by}).${fn}(${target})`) };
}

/* ================================================================
 * corr
 * ================================================================ */
export function opCorr(df) {
  const cols = df.columns.filter((c) => df.dtypes[c] === 'number');
  if (cols.length < 2) throw new Error('corr needs at least two numeric columns');
  const S = new Script(df, 'corr');
  S.code(CODE.corr());
  const m = df.corr();

  F(S, {
    p: ph('①', '两两相关', 'Pairwise correlation'),
    t: L(`${cols.length} 个数值列 → ${cols.length * cols.length} 个相关系数`, `${cols.length} numeric columns → ${cols.length * cols.length} coefficients`),
    n: L('corr() 会为每一对数值列计算皮尔逊相关系数，排成一个方阵。对角线恒为 1（自己和自己的相关当然是 1），矩阵是对称的。',
      'corr() computes the Pearson coefficient for every pair of numeric columns and lays them out in a square matrix. The diagonal is always 1 (a column correlates perfectly with itself) and the matrix is symmetric.'),
    d: 2800, c: 0,
    tab: T(df, { cellState: (r, i, name) => (cols.includes(name) ? 'focus' : 'dim') }),
    st: { kind: 'chart', type: 'heatmap', col: cols[0] },
  });

  F(S, {
    p: ph('②', '结果', 'Result'),
    t: L('颜色越深，关系越强', 'Darker means stronger'),
    n: L('相关系数取值在 −1 到 1 之间：接近 1 是同向变化，接近 −1 是反向变化，接近 0 说明几乎没有线性关系。注意相关不等于因果 —— 它只描述「一起动」，不解释「谁导致谁」。',
      'The coefficient runs from −1 to 1: near 1 means they move together, near −1 means they move oppositely, near 0 means almost no linear relationship. Remember correlation is not causation — it describes moving together, not causing.'),
    d: 3000, tone: 'ok', c: 0, final: true,
    tab: T(m, { cellState: (r, i, name) => (i > 0 ? 'best' : null) }),
    st: { kind: 'chart', type: 'heatmap', col: cols[0] },
    hud: [{ label: L('矩阵', 'matrix'), value: `${cols.length} × ${cols.length}`, tone: 'ok' }],
  });

  return { frames: S.frames, result: df, summary: L(`${cols.length} 个数值列的相关系数矩阵`, `Correlation matrix of ${cols.length} columns`) };
}
