/* ------------------------------------------------------------------
 * ops/index.js — 操作注册表
 *  ----------------------------------------------------------------
 *  每个操作都声明：分组、说明、参数表单、对应 pandas 代码，
 *  以及一个 run(df, cfg) 函数，返回 { frames, result, summary }。
 * ------------------------------------------------------------------ */

import { Script, T, CODE } from '../frames.js';
import { fmt, isNA } from '../utils.js';
import { opDropExtremes, opClip, opNlargest } from './outliers.js';
import { opDropDuplicates, opDropna, opFillna } from './clean.js';
import { opSort, opQuery, opAssign, opAstype, opRename, opSample, opHeadTail, opDropColumns } from './transform.js';
import { opAgg, opDescribe, opInfo, opValueCounts, opGroupBy } from './stats.js';
import { opHist, opBar, opLine, opScatter, opBox } from './plots.js';
import { colSummary, statCards, assertNumeric } from './common.js';

/* ================================================================
 * 导出 / 管道总览
 * ================================================================ */
export function opExport(df, cfg = {}) {
  const history = cfg.history || [];
  const S = new Script(df, 'export');
  const original = cfg.original || df;
  S.code(CODE.tocsv());

  S.add({
    phase: '① 回顾整条管道',
    title: `从 ${original.nrow} × ${original.ncol} 到 ${df.nrow} × ${df.ncol}`,
    narration: `整个处理流程一共执行了 ${history.length} 个操作。数据从原始状态一路走到现在，每一步都是可追溯的 —— ` +
      `这正是「管道式清洗」的意义：不是一次魔法，而是一串透明的小变换。`,
    duration: 3200,
    tone: 'info',
    code: S.codeAt(0),
    table: S.table(T(df, {})),
    stage: { kind: 'pipeline', original, final: df, history },
    hud: [{ label: '步骤数', value: String(history.length), tone: 'cyan' },
      { label: 'shape', value: `${original.nrow}×${original.ncol} → ${df.nrow}×${df.ncol}`, tone: 'ok' }],
  });

  const numCols = df.columns.filter((c) => df.dtypes[c] === 'number');
  if (numCols.length) {
    const cards = numCols.slice(0, 4).map((c) => ({ col: c, s: colSummary(df, c), unit: df.meta?.unit?.[c] || '' }));
    S.add({
      phase: '② 最终数据体检',
      title: '清洗后的数据长什么样',
      narration: cards.map((o) => `${o.col}：均值 ${fmt(o.s.mean)}${o.unit}，标准差 ${fmt(o.s.std)}，范围 ${fmt(o.s.min)} ~ ${fmt(o.s.max)}`).join('；') +
        '。相比最初，数据的波动更小、分布更集中 —— 处理是有效的。',
      duration: 3400,
      tone: 'ok',
      code: S.codeAt(0),
      table: S.table(T(df, { cellState: (r, i, name) => (numCols.includes(name) ? 'best' : null) })),
      stage: { kind: 'summary', cards, shape: [df.nrow, df.ncol], originalShape: [original.nrow, original.ncol], history },
    });
  }

  S.add({
    phase: '③ 导出',
    title: 'df.to_csv("cleaned.csv", index=False)',
    narration: `分析结论必须落盘才算完成。index=False 表示不把行号写进文件（否则下次读入会多出一列 Unnamed: 0，这是新手最常见的坑）。` +
      `点击下方按钮即可把当前 DataFrame 下载为 CSV —— 整个过程没有离开浏览器。`,
    duration: 2800,
    tone: 'gold',
    final: true,
    code: S.codeAt(0),
    table: S.table(T(df, {})),
    stage: { kind: 'export', csv: df.toCSV(), rows: df.nrow, cols: df.ncol, history },
    hud: [{ label: '导出规模', value: `${df.nrow} 行 × ${df.ncol} 列`, tone: 'ok' }],
  });

  return { frames: S.frames, result: df, summary: `导出清洗结果（${df.nrow} 行）` };
}

/* ================================================================
 * 参数表单的通用片段
 * ================================================================ */
const numericCol = (label = '目标列', key = 'col') => ({
  key, type: 'column', filter: 'number', label, required: true,
});
const anyCol = (label = '字段', key = 'col') => ({
  key, type: 'column', filter: 'any', label, required: true,
});
const aggSelect = (key = 'fn', label = '统计函数', def = 'mean') => ({
  key, type: 'select', label, default: def,
  options: [
    { v: 'mean', l: 'mean · 均值' }, { v: 'median', l: 'median · 中位数' },
    { v: 'std', l: 'std · 标准差' }, { v: 'sum', l: 'sum · 求和' },
    { v: 'min', l: 'min · 最小值' }, { v: 'max', l: 'max · 最大值' },
  ],
});

/* ================================================================
 * 注册表
 * ================================================================ */
export const OPS = [
  /* ---------------- 概览 ---------------- */
  {
    id: 'info', group: '概览', label: 'info', icon: 'info',
    desc: '查看行列数、每列类型与缺失情况',
    pandas: 'df.info()',
    params: [],
    run: (df) => opInfo(df),
  },
  {
    id: 'describe', group: '概览', label: 'describe', icon: 'sigma',
    desc: '八项描述性统计逐项揭示',
    pandas: 'df.describe()',
    params: [],
    needsNumeric: true,
    run: (df) => { assertNumeric(df, df.columns.find((c) => df.dtypes[c] === 'number'), 'describe'); return opDescribe(df); },
  },
  {
    id: 'head', group: '概览', label: 'head', icon: 'eye',
    desc: '预览前 n 行',
    pandas: 'df.head(n)',
    params: [{ key: 'n', type: 'number', label: '行数 n', default: 8, min: 1, max: 40 }],
    run: (df, c) => opHeadTail(df, { n: c.n, tail: false }),
  },
  {
    id: 'tail', group: '概览', label: 'tail', icon: 'eye-off',
    desc: '预览末尾 n 行',
    pandas: 'df.tail(n)',
    params: [{ key: 'n', type: 'number', label: '行数 n', default: 8, min: 1, max: 40 }],
    run: (df, c) => opHeadTail(df, { n: c.n, tail: true }),
  },

  /* ---------------- 清洗 ---------------- */
  {
    id: 'drop_extremes', group: '清洗', label: '去除最大最小值', icon: 'target',
    desc: '★ 旗舰演示：完整还原 idxmax / idxmin 的扫描与删除过程',
    pandas: 'df.drop(index=[idxmax, idxmin])',
    highlight: true,
    params: [
      numericCol('目标列'),
      {
        key: 'mode', type: 'select', label: '删除范围', default: 'both',
        options: [{ v: 'both', l: '最大值 + 最小值' }, { v: 'max', l: '仅最大值' }, { v: 'min', l: '仅最小值' }],
      },
    ],
    needsNumeric: true,
    run: (df, c) => { assertNumeric(df, c.col, '去除极值'); return opDropExtremes(df, c); },
  },
  {
    id: 'drop_duplicates', group: '清洗', label: 'drop_duplicates', icon: 'copy',
    desc: '按行指纹检测并删除重复记录',
    pandas: 'df.drop_duplicates()',
    params: [
      { key: 'subset', type: 'columns', filter: 'any', label: '参与判重的字段（留空 = 全部）', optional: true },
    ],
    auto: () => ({ subset: [] }),
    run: (df, c) => opDropDuplicates(df, { subset: c.subset }),
  },
  {
    id: 'dropna', group: '清洗', label: 'dropna', icon: 'trash',
    desc: '删除含有缺失值的整行',
    pandas: 'df.dropna(axis=0, how="any")',
    params: [
      { key: 'subset', type: 'columns', filter: 'any', label: '检查哪些字段（留空 = 全部）', optional: true },
    ],
    auto: () => ({ subset: [] }),
    run: (df, c) => opDropna(df, { subset: c.subset }),
  },
  {
    id: 'fillna', group: '清洗', label: 'fillna', icon: 'droplet',
    desc: '用均值 / 中位数 / 前值填补缺失',
    pandas: 'df[col].fillna(value)',
    params: [
      { key: 'col', type: 'column', filter: 'any', label: '目标列', required: true },
      {
        key: 'strategy', type: 'select', label: '填充策略', default: 'mean',
        options: [
          { v: 'mean', l: '列均值 mean' }, { v: 'median', l: '列中位数 median' },
          { v: 'ffill', l: '前向填充 ffill' }, { v: 'zero', l: '常量 0' },
        ],
      },
    ],
    auto: (df) => ({ col: nullestCol(df) || df.columns[0] }),
    run: (df, c) => opFillna(df, { col: c.col, strategy: c.strategy === 'zero' ? 'value' : c.strategy, value: c.strategy === 'zero' ? 0 : undefined }),
  },
  {
    id: 'clip', group: '清洗', label: 'clip 截断', icon: 'scissors',
    desc: '用 IQR 法则把越界值压回边界（不删行）',
    pandas: 'df[col].clip(lower, upper)',
    params: [numericCol('目标列')],
    needsNumeric: true,
    run: (df, c) => { assertNumeric(df, c.col, 'clip 截断'); return opClip(df, c); },
  },

  /* ---------------- 变换 ---------------- */
  {
    id: 'sort_values', group: '变换', label: 'sort_values', icon: 'sort',
    desc: '按某列排序，逐行搬移可视化',
    pandas: 'df.sort_values(by=col)',
    params: [
      anyCol('排序键'),
      {
        key: 'asc', type: 'select', label: '方向', default: 'asc',
        options: [{ v: 'asc', l: '升序 ascending' }, { v: 'desc', l: '降序 descending' }],
      },
    ],
    auto: (df) => ({ col: df.columns.find((c) => df.dtypes[c] === 'number') || df.columns[0] }),
    run: (df, c) => opSort(df, { by: c.col, asc: c.asc !== 'desc' }),
  },
  {
    id: 'query', group: '变换', label: 'query 筛选', icon: 'filter',
    desc: '生成布尔掩码，按条件保留行',
    pandas: 'df[df[col] > v]',
    params: [
      numericCol('判断依据'),
      {
        key: 'op', type: 'select', label: '运算符', default: '>',
        options: [{ v: '>', l: '>' }, { v: '>=', l: '>=' }, { v: '<', l: '<' }, { v: '<=', l: '<=' }, { v: '==', l: '==' }, { v: '!=', l: '!=' }],
      },
      { key: 'value', type: 'number', label: '阈值', default: null, hint: '留空则自动取该列均值', step: 'any' },
    ],
    needsNumeric: true,
    run: (df, c) => { assertNumeric(df, c.col, 'query 筛选'); return opQuery(df, c); },
  },
  {
    id: 'assign', group: '变换', label: '新增计算列', icon: 'plus',
    desc: '用表达式逐元素计算出一列新数据',
    pandas: 'df["new"] = expr',
    params: [
      { key: 'a', type: 'column', filter: 'number', label: '分子列 A', required: true },
      { key: 'b', type: 'column', filter: 'number', label: '分母列 B', required: true },
      { key: 'name', type: 'text', label: '新列名', default: '', hint: '留空自动命名' },
    ],
    needsNumeric: true,
    auto: (df) => {
      const nums = df.columns.filter((x) => df.dtypes[x] === 'number');
      return { a: nums[0], b: nums[1] || nums[0] };
    },
    run: (df, c) => { assertNumeric(df, c.a, '新增计算列'); assertNumeric(df, c.b, '新增计算列'); return opAssign(df, c); },
  },
  {
    id: 'astype', group: '变换', label: 'astype', icon: 'swap',
    desc: '转换列的数据类型',
    pandas: 'df[col].astype(dtype)',
    params: [
      anyCol('目标列'),
      {
        key: 'dtype', type: 'select', label: '目标类型', default: 'float64',
        options: [{ v: 'float64', l: 'float64 · 浮点数' }, { v: 'int64', l: 'int64 · 整数' }, { v: 'string', l: 'object · 字符串' }],
      },
    ],
    run: (df, c) => opAstype(df, c),
  },
  {
    id: 'rename', group: '变换', label: 'rename', icon: 'tag',
    desc: '重命名列（只改名字不改数据）',
    pandas: 'df.rename(columns={...})',
    params: [{ key: 'map', type: 'rename', label: '重命名映射', required: true }],
    auto: (df) => {
      const map = {};
      df.columns.slice(0, 2).forEach((c, i) => { map[c] = ['col_a', 'col_b'][i] || `col_${i + 1}`; });
      return { map };
    },
    run: (df, c) => opRename(df, c),
  },
  {
    id: 'sample', group: '变换', label: 'sample', icon: 'shuffle',
    desc: '可复现的随机抽样',
    pandas: 'df.sample(n, random_state=42)',
    params: [
      { key: 'n', type: 'number', label: '样本量 n', default: 10, min: 1, max: 40 },
      { key: 'seed', type: 'number', label: 'random_state', default: 42 },
    ],
    run: (df, c) => opSample(df, c),
  },
  {
    id: 'nlargest', group: '变换', label: 'nlargest', icon: 'trophy',
    desc: '取某列最大的 n 行（Top-N 榜单）',
    pandas: 'df.nlargest(n, col)',
    params: [numericCol('排名依据'), { key: 'n', type: 'number', label: '取前 n 名', default: 5, min: 1, max: 20 }],
    needsNumeric: true,
    run: (df, c) => { assertNumeric(df, c.col, 'nlargest'); return opNlargest(df, c); },
  },
  {
    id: 'drop', group: '变换', label: '删除列', icon: 'minus',
    desc: '纵向减列，行数不变',
    pandas: 'df.drop(columns=[...])',
    params: [{ key: 'columns', type: 'columns', filter: 'any', label: '要删除的列', required: true }],
    auto: (df) => ({ columns: [df.columns[df.columns.length - 1]] }),
    run: (df, c) => opDropColumns(df, c),
  },

  /* ---------------- 统计 ---------------- */
  {
    id: 'agg', group: '统计', label: '列聚合', icon: 'calculator',
    desc: '均值 / 中位数 / 标准差 / 求和 的逐步演算',
    pandas: 'df[col].mean()',
    params: [numericCol('目标列'), aggSelect('fn', '统计函数', 'mean')],
    needsNumeric: true,
    run: (df, c) => { assertNumeric(df, c.col, '列聚合'); return opAgg(df, c); },
  },
  {
    id: 'value_counts', group: '统计', label: 'value_counts', icon: 'chart-bar',
    desc: '每个取值出现了多少次',
    pandas: 'df[col].value_counts()',
    params: [anyCol('统计字段')],
    auto: (df) => ({ col: categoryCol(df) || df.columns[0] }),
    run: (df, c) => opValueCounts(df, c),
  },
  {
    id: 'groupby', group: '统计', label: 'groupby', icon: 'layers',
    desc: '分组 → 计算 → 合并，数据飞入桶中',
    pandas: 'df.groupby(by).agg(...)',
    params: [
      anyCol('分组键', 'by'),
      numericCol('聚合列', 'target'),
      aggSelect('fn', '组内计算', 'mean'),
    ],
    needsNumeric: true,
    auto: (df) => {
      const by = categoryCol(df) || labelCol(df);
      const target = df.columns.find((c) => df.dtypes[c] === 'number' && c !== by);
      return { by, target };
    },
    run: (df, c) => { assertNumeric(df, c.target, '分组聚合'); return opGroupBy(df, c); },
  },

  /* ---------------- 可视化 ---------------- */
  {
    id: 'hist', group: '可视化', label: '直方图', icon: 'chart-hist',
    desc: '数据落进箱子，分布形态一点点长出来',
    pandas: 'df[col].plot.hist()',
    params: [numericCol('目标列')],
    needsNumeric: true,
    run: (df, c) => { assertNumeric(df, c.col, '直方图'); return opHist(df, c); },
  },
  {
    id: 'bar', group: '可视化', label: '柱状图', icon: 'chart-bar',
    desc: '按类别比较数量',
    pandas: 'df[x].value_counts().plot.bar()',
    params: [anyCol('分类轴 x')],
    auto: (df) => ({ x: categoryCol(df) || df.columns[0] }),
    run: (df, c) => opBar(df, c),
  },
  {
    id: 'line', group: '可视化', label: '折线图', icon: 'chart-line',
    desc: '逐点绘制，看趋势如何形成',
    pandas: 'df.plot.line(x, y)',
    params: [numericCol('纵轴 y', 'y'), { key: 'x', type: 'column', filter: 'any', label: '横轴 x', optional: true }],
    needsNumeric: true,
    auto: (df) => ({ x: labelCol(df) }),
    run: (df, c) => { assertNumeric(df, c.y, '折线图'); return opLine(df, c); },
  },
  {
    id: 'scatter', group: '可视化', label: '散点图', icon: 'scatter',
    desc: '两个变量的关系与相关系数',
    pandas: 'df.plot.scatter(x, y)',
    params: [
      { key: 'x', type: 'column', filter: 'number', label: '横轴 x', required: true },
      { key: 'y', type: 'column', filter: 'number', label: '纵轴 y', required: true },
    ],
    needsNumeric: true,
    auto: (df) => {
      const nums = df.columns.filter((x) => df.dtypes[x] === 'number');
      return { x: nums[0], y: nums[1] || nums[0] };
    },
    run: (df, c) => { assertNumeric(df, c.x, '散点图'); assertNumeric(df, c.y, '散点图'); return opScatter(df, c); },
  },
  {
    id: 'box', group: '可视化', label: '箱线图', icon: 'box',
    desc: '五数概括 + 自动识别离群点',
    pandas: 'df[col].plot.box()',
    params: [numericCol('目标列')],
    needsNumeric: true,
    run: (df, c) => { assertNumeric(df, c.col, '箱线图'); return opBox(df, c); },
  },

  /* ---------------- 导出 ---------------- */
  {
    id: 'export', group: '导出', label: '导出 & 总览', icon: 'download',
    desc: '回顾整条管道并下载 CSV',
    pandas: 'df.to_csv("cleaned.csv")',
    params: [],
    run: (df, c) => opExport(df, c),
  },
];

export const OP_GROUPS = ['概览', '清洗', '变换', '统计', '可视化', '导出'];

export function getOp(id) { return OPS.find((o) => o.id === id); }

/** 低基数分类列：取值个数在 2..15 之间的非数值列，最适合做分组/频次 */
function categoryCol(df) {
  let best = null, bestN = Infinity;
  for (const c of df.columns) {
    if (df.dtypes[c] === 'number') continue;
    const n = new Set(df.col(c).filter((v) => v !== null && v !== undefined)).size;
    if (n > 1 && n <= 15 && n < bestN) { best = c; bestN = n; }
  }
  return best;
}

/** 缺得最多的列 */
function nullestCol(df) {
  const counts = df.nullCounts();
  let best = null, bestN = 0;
  for (const c of df.columns) if (counts[c] > bestN) { best = c; bestN = counts[c]; }
  return best;
}

/** 人话标签列（姓名 / 城市 / 日期 …） */
function labelCol(df) {
  const prefs = ['姓名', '名称', '城市', '订单号', '商品', '日期', '地区', '门店'];
  for (const p of prefs) if (df.columns.includes(p)) return p;
  return df.columns.find((c) => df.dtypes[c] !== 'number') || df.columns[0];
}

/** 为一组列生成「自动参数」，让用户不选也能跑 */
export function autoParams(op, df) {
  const out = {};
  for (const p of op.params || []) {
    if (p.type === 'column') {
      const pool = df.columns.filter((c) => (p.filter === 'number' ? df.dtypes[c] === 'number' : true));
      // 找不到符合条件的列时留空，让 assertNumeric 给出可读的提示，
      // 而不是悄悄挑一个不相干的列然后算出 NaN
      out[p.key] = pool.length ? pool[0] : undefined;
    } else if (p.type === 'columns') {
      out[p.key] = [];
    } else if (p.type === 'select') {
      out[p.key] = p.default;
    } else if (p.type === 'number') {
      out[p.key] = p.default;
    } else if (p.type === 'text') {
      out[p.key] = p.default || '';
    } else if (p.type === 'rename') {
      out[p.key] = {};
    }
  }
  if (typeof op.auto === 'function') Object.assign(out, op.auto(df, out) || {});
  return out;
}

export { categoryCol, nullestCol, labelCol };
