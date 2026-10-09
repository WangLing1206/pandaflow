/* ------------------------------------------------------------------
 * ops/index.js — 操作注册表
 *  ----------------------------------------------------------------
 *  每个操作声明：分组、双语名称与说明、参数表单、对应 pandas 代码、
 *  以及 run(df, cfg) → { frames, result, summary }。
 *  覆盖 pandas 的主要能力面：概览 / 选择索引 / 清洗 / 变换 /
 *  序列运算 / 合并重塑 / 统计聚合 / 可视化 / 导出。
 * ------------------------------------------------------------------ */

import { Script, T, CODE } from '../frames.js';
import { L, t } from '../../i18n/index.js';
import { fmt } from '../utils.js';
import { makeSpec } from '../datasets.js';
import { colSummary, pickCategoryCol, pickLabelCol, nullestCol } from './kit.js';

import {
  opDropDuplicates, opDuplicated, opDropna, opFillna, opInterpolate,
  opDropExtremes, opClip, opNlargest, opNsmallest,
} from './clean.js';
import {
  opSort, opSortIndex, opQuery, opAssign, opAstype, opRename, opSample,
  opHeadTail, opDropColumns, opLoc, opIloc, opSetIndex, opResetIndex,
  opSelectDtypes, opInsert, opPop, opIsin,
  opShift, opDiff, opPctChange, opCumsum, opRolling, opRank, opCut, opWhere, opApply,
} from './transform.js';
import { opMerge, opConcat, opPivot, opMelt, opCrosstab } from './combine.js';
import { opInfo, opDescribe, opAgg, opValueCounts, opGroupBy, opCorr } from './stats.js';
import { opHist, opBar, opLine, opScatter, opBox, opHeatmap } from './plots.js';
import { opStrContains, opStrReplace, opStrSplit, opStrUpper, opStrLen } from './strings.js';

/* ================================================================
 * 导出 / 管道总览
 * ================================================================ */
export function opExport(df, cfg = {}) {
  const history = cfg.history || [];
  const original = cfg.original || df;
  const S = new Script(df, 'export');
  S.code(CODE.tocsv());

  S.add({
    phase: L('① 回顾整条管道', '① Review the pipeline'),
    title: L(`从 ${original.nrow} × ${original.ncol} 到 ${df.nrow} × ${df.ncol}`,
      `${original.nrow} × ${original.ncol} → ${df.nrow} × ${df.ncol}`),
    narration: L(`整个处理流程一共执行了 ${history.length} 个操作。数据从原始状态一路走到现在，每一步都是可追溯的 —— 这正是「管道式清洗」的意义：不是一次魔法，而是一串透明的小变换。`,
      `The whole flow ran ${history.length} operations. The data went from raw to now with every step traceable — the point of pipeline-style cleaning: not one magic trick, but a chain of transparent small transformations.`),
    duration: 3000, tone: 'info', code: S.codeAt(0),
    table: T(df, {}),
    stage: { kind: 'pipeline', original, final: df, history },
    hud: [{ label: L('步骤数', 'steps'), value: String(history.length), tone: 'cyan' },
      { label: 'shape', value: `${original.nrow}×${original.ncol} → ${df.nrow}×${df.ncol}`, tone: 'ok' }],
  });

  const numCols = df.columns.filter((c) => df.dtypes[c] === 'number');
  if (numCols.length) {
    const cards = numCols.slice(0, 4).map((c) => ({ col: c, s: colSummary(df, c), unit: df.meta?.unit?.[c] || '' }));
    S.add({
      phase: L('② 最终数据体检', '② Health check'),
      title: L('清洗后的数据长什么样', 'What the cleaned data looks like'),
      narration: L(cards.map((o) => `${o.col}：均值 ${fmt(o.s.mean)}${o.unit}，标准差 ${fmt(o.s.std)}，范围 ${fmt(o.s.min)} ~ ${fmt(o.s.max)}`).join('；') +
        '。相比最初，数据的波动更小、分布更集中 —— 处理是有效的。',
        cards.map((o) => `${o.col}: mean ${fmt(o.s.mean)}${o.unit}, std ${fmt(o.s.std)}, range ${fmt(o.s.min)}–${fmt(o.s.max)}`).join('; ') +
        '. Compared with the raw data the spread is smaller and the distribution tighter — the cleaning worked.'),
      duration: 3200, tone: 'ok', code: S.codeAt(0),
      table: T(df, { cellState: (r, i, name) => (numCols.includes(name) ? 'best' : null) }),
      stage: { kind: 'summary', cards, shape: [df.nrow, df.ncol], originalShape: [original.nrow, original.ncol], history },
    });
  }

  S.add({
    phase: L('③ 导出', '③ Export'),
    title: 'df.to_csv("cleaned.csv", index=False)',
    narration: L('分析结论必须落盘才算完成。index=False 表示不把行号写进文件（否则下次读入会多出一列 Unnamed: 0，这是新手最常见的坑）。点击下方按钮即可把当前 DataFrame 下载为 CSV —— 整个过程没有离开浏览器。',
      'Analysis is only finished when it is written down. index=False keeps the row numbers out of the file (otherwise the next read adds an Unnamed: 0 column — the most common beginner trap). Click below to download the current DataFrame as CSV — all without leaving the browser.'),
    duration: 2600, tone: 'gold', final: true, code: S.codeAt(0),
    table: T(df, {}),
    stage: { kind: 'export', csv: df.toCSV(), rows: df.nrow, cols: df.ncol, history },
    hud: [{ label: L('导出规模', 'size'), value: `${df.nrow} × ${df.ncol}`, tone: 'ok' }],
  });

  return { frames: S.frames, result: df, summary: L(`导出清洗结果（${df.nrow} 行）`, `Export cleaned data (${df.nrow} rows)`) };
}

/* ================================================================
 * 参数表单片段
 * ================================================================ */
const numCol = (label, key = 'col', labelEn) => ({ key, type: 'column', filter: 'number', label: L(label, labelEn || label), required: true });
const anyCol = (label, key = 'col', labelEn) => ({ key, type: 'column', filter: 'any', label: L(label, labelEn || label), required: true });
const aggSel = (key = 'fn', label = '统计函数', def = 'mean') => ({
  key, type: 'select', label: L(label, key === 'fn' ? 'Aggregation' : label), default: def,
  options: [
    { v: 'mean', l: L('mean · 均值', 'mean') }, { v: 'median', l: L('median · 中位数', 'median') },
    { v: 'std', l: L('std · 标准差', 'std') }, { v: 'sum', l: L('sum · 求和', 'sum') },
    { v: 'min', l: L('min · 最小值', 'min') }, { v: 'max', l: L('max · 最大值', 'max') },
    { v: 'count', l: L('count · 计数', 'count') },
  ],
});
const sel = (key, label, def, options) => ({ key, type: 'select', label, default: def, options });

/* ================================================================
 * 注册表
 * ================================================================ */
export const OPS = [
  /* ---------------- 概览 ---------------- */
  { id: 'info', group: 'overview', icon: 'info', label: L('info', 'info'),
    desc: L('查看行列数、每列类型与缺失情况', 'Row/column counts, dtypes and missing values'),
    pandas: 'df.info()', params: [], run: (df) => opInfo(df) },
  { id: 'describe', group: 'overview', icon: 'sigma', label: L('describe', 'describe'),
    desc: L('八项描述性统计逐项揭示', 'Eight descriptive statistics, revealed one by one'),
    pandas: 'df.describe()', params: [], needsNumeric: true,
    run: (df) => opDescribe(df) },
  { id: 'head', group: 'overview', icon: 'eye', label: L('head', 'head'),
    desc: L('预览前 n 行', 'Preview the first n rows'),
    pandas: 'df.head(n)', params: [{ key: 'n', type: 'number', label: L('行数 n', 'Rows n'), default: 8, min: 1, max: 60 }],
    run: (df, c) => opHeadTail(df, { n: c.n, tail: false }) },
  { id: 'tail', group: 'overview', icon: 'eye-off', label: L('tail', 'tail'),
    desc: L('预览末尾 n 行', 'Preview the last n rows'),
    pandas: 'df.tail(n)', params: [{ key: 'n', type: 'number', label: L('行数 n', 'Rows n'), default: 8, min: 1, max: 60 }],
    run: (df, c) => opHeadTail(df, { n: c.n, tail: true }) },
  { id: 'corr', group: 'overview', icon: 'grid', label: L('corr 相关矩阵', 'corr'),
    desc: L('所有数值列两两相关系数', 'Pairwise correlation of every numeric column'),
    pandas: 'df.corr()', params: [], needsNumeric: true,
    run: (df) => opCorr(df) },

  /* ---------------- 选择与索引 ---------------- */
  { id: 'loc', group: 'select', icon: 'filter', label: L('loc 标签选择', 'loc'),
    desc: L('按索引标签与列名取子集', 'Subset by index label and column name'),
    pandas: 'df.loc[rows, cols]',
    params: [
      { key: 'r0', type: 'number', label: L('起始索引', 'Start row'), default: 5, min: 0 },
      { key: 'r1', type: 'number', label: L('结束索引（含）', 'End row (inclusive)'), default: 10, min: 1 },
      { key: 'cols', type: 'columns', filter: 'any', label: L('选择的列（留空 = 前 4 列）', 'Columns (empty = first 4)'), optional: true },
    ],
    run: (df, c) => opLoc(df, c) },
  { id: 'iloc', group: 'select', icon: 'sliders', label: L('iloc 位置选择', 'iloc'),
    desc: L('按位置区间取子集（半开区间）', 'Subset by position (half-open range)'),
    pandas: 'df.iloc[r0:r1, c0:c1]',
    params: [
      { key: 'r0', type: 'number', label: L('起始行', 'Start row'), default: 0, min: 0 },
      { key: 'r1', type: 'number', label: L('结束行（不含）', 'End row (exclusive)'), default: 6, min: 1 },
      { key: 'c0', type: 'number', label: L('起始列', 'Start col'), default: 0, min: 0 },
      { key: 'c1', type: 'number', label: L('结束列（不含）', 'End col (exclusive)'), default: 3, min: 1 },
    ],
    run: (df, c) => opIloc(df, c) },
  { id: 'set_index', group: 'select', icon: 'tag', label: L('set_index', 'set_index'),
    desc: L('把某列提升为索引', 'Promote a column to the index'),
    pandas: 'df.set_index(col)', params: [anyCol('索引列', 'col', 'Index column')],
    run: (df, c) => opSetIndex(df, c) },
  { id: 'reset_index', group: 'select', icon: 'refresh', label: L('reset_index', 'reset_index'),
    desc: L('把索引重新编号为 0…N-1', 'Renumber the index to 0…N-1'),
    pandas: 'df.reset_index(drop=True)', params: [],
    run: (df) => opResetIndex(df) },
  { id: 'select_dtypes', group: 'select', icon: 'type', label: L('select_dtypes', 'select_dtypes'),
    desc: L('按数据类型成批筛选列', 'Filter columns in bulk by dtype'),
    pandas: 'df.select_dtypes(include=[...])',
    params: [sel('dtype', L('保留类型', 'Keep dtype'), 'number', [
      { v: 'number', l: L('数值列 number', 'numeric') },
      { v: 'object', l: L('非数值列 object', 'non-numeric') },
    ])],
    run: (df, c) => opSelectDtypes(df, c) },
  { id: 'insert', group: 'select', icon: 'plus', label: L('insert 插入列', 'insert'),
    desc: L('在指定位置插入一列', 'Insert a column at a chosen position'),
    pandas: 'df.insert(pos, name, value)',
    params: [numCol('来源列', 'src', 'Source column'),
      { key: 'name', type: 'text', label: L('新列名', 'New column name'), default: '' },
      { key: 'pos', type: 'number', label: L('插入位置', 'Position'), default: 0, min: 0 }],
    auto: (df) => { const n = df.columns.find((c) => df.dtypes[c] === 'number'); return { src: n, name: `${n}_x2` }; },
    run: (df, c) => opInsert(df, c) },
  { id: 'pop', group: 'select', icon: 'minus', label: L('pop 弹出列', 'pop'),
    desc: L('删除列并同时把它作为 Series 返回', 'Remove a column and return it as a Series'),
    pandas: 's = df.pop(col)', params: [anyCol('要弹出的列', 'col', 'Column to pop')],
    run: (df, c) => opPop(df, c) },
  { id: 'isin', group: 'select', icon: 'check', label: L('isin 成员判断', 'isin'),
    desc: L('筛选取值落在给定集合内的行', 'Keep rows whose value is in a given set'),
    pandas: 'df[df[col].isin([...])]',
    params: [anyCol('判断字段', 'col', 'Column'), { key: 'values', type: 'columns', filter: 'any', label: L('目标集合（留空 = 前 2 个取值）', 'Value set (empty = first 2)'), optional: true }],
    auto: (df) => ({ col: pickCategoryCol(df) }),
    run: (df, c) => opIsin(df, c) },

  /* ---------------- 清洗 ---------------- */
  { id: 'drop_extremes', group: 'clean', icon: 'target', label: L('去除最大最小值', 'Drop min & max'),
    desc: L('★ 旗舰演示：完整还原 idxmax / idxmin 的扫描与删除过程', '★ Flagship: the full idxmax/idxmin scan and drop'),
    pandas: 'df.drop(index=[idxmax, idxmin])', highlight: true, needsNumeric: true,
    params: [numCol('目标列', 'col', 'Target column'),
      sel('mode', L('删除范围', 'Scope'), 'both', [
        { v: 'both', l: L('最大值 + 最小值', 'max + min') },
        { v: 'max', l: L('仅最大值', 'max only') },
        { v: 'min', l: L('仅最小值', 'min only') },
      ])],
    auto: (df) => ({ col: df.columns.find((c) => df.dtypes[c] === 'number') }),
    run: (df, c) => opDropExtremes(df, c) },
  { id: 'drop_duplicates', group: 'clean', icon: 'copy', label: L('drop_duplicates', 'drop_duplicates'),
    desc: L('按行指纹检测并删除重复记录', 'Detect and drop duplicate rows via fingerprints'),
    pandas: 'df.drop_duplicates()',
    params: [{ key: 'subset', type: 'columns', filter: 'any', label: L('参与判重的字段（留空 = 全部）', 'Subset (empty = all)'), optional: true }],
    auto: () => ({ subset: [] }), run: (df, c) => opDropDuplicates(df, { subset: c.subset }) },
  { id: 'duplicated', group: 'clean', icon: 'copy', label: L('duplicated 标记', 'duplicated'),
    desc: L('只标记重复行，不删除', 'Flag duplicate rows without removing them'),
    pandas: 'df.duplicated()',
    params: [{ key: 'subset', type: 'columns', filter: 'any', label: L('参与判重的字段（留空 = 全部）', 'Subset (empty = all)'), optional: true }],
    auto: () => ({ subset: [] }), run: (df, c) => opDuplicated(df, { subset: c.subset }) },
  { id: 'dropna', group: 'clean', icon: 'trash', label: L('dropna', 'dropna'),
    desc: L('删除含有缺失值的整行', 'Drop whole rows containing missing values'),
    pandas: 'df.dropna(axis=0, how="any")',
    params: [{ key: 'subset', type: 'columns', filter: 'any', label: L('检查哪些字段（留空 = 全部）', 'Check which columns (empty = all)'), optional: true }],
    auto: () => ({ subset: [] }), run: (df, c) => opDropna(df, { subset: c.subset }) },
  { id: 'fillna', group: 'clean', icon: 'droplet', label: L('fillna', 'fillna'),
    desc: L('用均值 / 中位数 / 前值填补缺失', 'Fill gaps with mean, median or the previous value'),
    pandas: 'df[col].fillna(value)',
    params: [anyCol('目标列', 'col', 'Target column'),
      sel('strategy', L('填充策略', 'Strategy'), 'mean', [
        { v: 'mean', l: L('列均值 mean', 'column mean') },
        { v: 'median', l: L('列中位数 median', 'column median') },
        { v: 'ffill', l: L('前向填充 ffill', 'forward fill') },
        { v: 'zero', l: L('常量 0', 'constant 0') },
      ])],
    auto: (df) => ({ col: nullestCol(df) }),
    run: (df, c) => opFillna(df, { col: c.col, strategy: c.strategy }) },
  { id: 'interpolate', group: 'clean', icon: 'trending', label: L('interpolate 插值', 'interpolate'),
    desc: L('线性插值，按趋势补缺失', 'Linear interpolation along the trend'),
    pandas: 'df[col].interpolate(method="linear")',
    params: [anyCol('目标列', 'col', 'Target column')],
    auto: (df) => ({ col: nullestCol(df) }),
    run: (df, c) => opInterpolate(df, c) },
  { id: 'clip', group: 'clean', icon: 'scissors', label: L('clip 截断', 'clip'),
    desc: L('用 IQR 法则把越界值压回边界（不删行）', 'Clamp out-of-range values with the IQR rule'),
    pandas: 'df[col].clip(lower, upper)', needsNumeric: true,
    params: [numCol('目标列', 'col', 'Target column')],
    auto: (df) => ({ col: df.columns.find((c) => df.dtypes[c] === 'number') }),
    run: (df, c) => opClip(df, c) },

  /* ---------------- 变换 ---------------- */
  { id: 'sort_values', group: 'transform', icon: 'sort', label: L('sort_values', 'sort_values'),
    desc: L('按某列排序，逐行搬移可视化', 'Sort by a column with row-by-row motion'),
    pandas: 'df.sort_values(by=col)',
    params: [anyCol('排序键', 'col', 'Sort key'),
      sel('asc', L('方向', 'Order'), 'asc', [{ v: 'asc', l: L('升序 ascending', 'ascending') }, { v: 'desc', l: L('降序 descending', 'descending') }])],
    auto: (df) => ({ col: df.columns.find((c) => df.dtypes[c] === 'number') }),
    run: (df, c) => opSort(df, { by: c.col, asc: c.asc !== 'desc' }) },
  { id: 'sort_index', group: 'transform', icon: 'sort', label: L('sort_index', 'sort_index'),
    desc: L('按索引值重新排列行', 'Reorder rows by index value'),
    pandas: 'df.sort_index()', params: [], run: (df) => opSortIndex(df) },
  { id: 'query', group: 'transform', icon: 'filter', label: L('query 筛选', 'query'),
    desc: L('生成布尔掩码，按条件保留行', 'Build a boolean mask and keep matching rows'),
    pandas: 'df[df[col] > v]', needsNumeric: true,
    params: [numCol('判断依据', 'col', 'Column'),
      sel('op', L('运算符', 'Operator'), '>', ['>', '>=', '<', '<=', '==', '!='].map((v) => ({ v, l: v }))),
      { key: 'value', type: 'number', label: L('阈值', 'Threshold'), default: null, hint: L('留空则自动取该列均值', 'empty = column mean') }],
    auto: (df) => ({ col: df.columns.find((c) => df.dtypes[c] === 'number') }),
    run: (df, c) => opQuery(df, c) },
  { id: 'assign', group: 'transform', icon: 'plus', label: L('新增计算列', 'assign'),
    desc: L('用表达式逐元素计算出一列新数据', 'Compute a new column element-wise'),
    pandas: 'df["new"] = expr', needsNumeric: true,
    params: [numCol('分子列 A', 'a', 'Numerator A'), numCol('分母列 B', 'b', 'Denominator B'),
      { key: 'name', type: 'text', label: L('新列名', 'New column name'), default: '' }],
    auto: (df) => { const n = df.columns.filter((c) => df.dtypes[c] === 'number'); return { a: n[0], b: n[1] || n[0] }; },
    run: (df, c) => opAssign(df, c) },
  { id: 'astype', group: 'transform', icon: 'swap', label: L('astype', 'astype'),
    desc: L('转换列的数据类型', 'Cast a column to another dtype'),
    pandas: 'df[col].astype(dtype)',
    params: [anyCol('目标列', 'col', 'Column'),
      sel('dtype', L('目标类型', 'Target dtype'), 'float64', [
        { v: 'float64', l: 'float64' }, { v: 'int64', l: 'int64' }, { v: 'string', l: L('object · 字符串', 'object · string') }])],
    run: (df, c) => opAstype(df, c) },
  { id: 'rename', group: 'transform', icon: 'tag', label: L('rename', 'rename'),
    desc: L('重命名列（只改名字不改数据）', 'Rename columns — names only, data untouched'),
    pandas: 'df.rename(columns={...})',
    params: [{ key: 'map', type: 'rename', label: L('重命名映射', 'Rename mapping'), required: true }],
    auto: (df) => ({ map: df.columns.slice(0, 2).reduce((m, c, i) => ({ ...m, [c]: `col_${String.fromCharCode(97 + i)}` }), {}) }),
    run: (df, c) => opRename(df, c) },
  { id: 'sample', group: 'transform', icon: 'shuffle', label: L('sample', 'sample'),
    desc: L('可复现的随机抽样', 'Reproducible random sampling'),
    pandas: 'df.sample(n, random_state=42)',
    params: [{ key: 'n', type: 'number', label: L('样本量 n', 'Sample size n'), default: 10, min: 1 },
      { key: 'seed', type: 'number', label: 'random_state', default: 42 }],
    run: (df, c) => opSample(df, c) },
  { id: 'nlargest', group: 'transform', icon: 'trophy', label: L('nlargest', 'nlargest'),
    desc: L('取某列最大的 n 行（Top-N 榜单）', 'Take the n largest rows by a column'),
    pandas: 'df.nlargest(n, col)', needsNumeric: true,
    params: [numCol('排名依据', 'col', 'Rank by'), { key: 'n', type: 'number', label: L('取前 n 名', 'Top n'), default: 5, min: 1, max: 30 }],
    auto: (df) => ({ col: df.columns.find((c) => df.dtypes[c] === 'number') }),
    run: (df, c) => opNlargest(df, c) },
  { id: 'nsmallest', group: 'transform', icon: 'trophy', label: L('nsmallest', 'nsmallest'),
    desc: L('取某列最小的 n 行', 'Take the n smallest rows by a column'),
    pandas: 'df.nsmallest(n, col)', needsNumeric: true,
    params: [numCol('排名依据', 'col', 'Rank by'), { key: 'n', type: 'number', label: L('取前 n 名', 'Bottom n'), default: 5, min: 1, max: 30 }],
    auto: (df) => ({ col: df.columns.find((c) => df.dtypes[c] === 'number') }),
    run: (df, c) => opNsmallest(df, c) },
  { id: 'drop', group: 'transform', icon: 'minus', label: L('删除列', 'drop columns'),
    desc: L('纵向减列，行数不变', 'Subtract along the width; rows unchanged'),
    pandas: 'df.drop(columns=[...])',
    params: [{ key: 'columns', type: 'columns', filter: 'any', label: L('要删除的列', 'Columns to drop'), required: true }],
    auto: (df) => ({ columns: [df.columns[df.columns.length - 1]] }),
    run: (df, c) => opDropColumns(df, c) },

  /* ---------------- 序列运算 ---------------- */
  { id: 'shift', group: 'series', icon: 'skip-fwd', label: L('shift 平移', 'shift'),
    desc: L('整列向下平移，腾出的位置填 NaN', 'Shift the column down, leaving NaN behind'),
    pandas: 'df[col].shift(n)', needsNumeric: true,
    params: [numCol('目标列', 'col', 'Column'), { key: 'periods', type: 'number', label: L('平移行数', 'Periods'), default: 1, min: 1, max: 10 }],
    auto: (df) => ({ col: df.columns.find((c) => df.dtypes[c] === 'number') }),
    run: (df, c) => opShift(df, c) },
  { id: 'diff', group: 'series', icon: 'trending', label: L('diff 差分', 'diff'),
    desc: L('本行减上一行，看变化量', 'This row minus the previous — the change'),
    pandas: 'df[col].diff()', needsNumeric: true,
    params: [numCol('目标列', 'col', 'Column'), { key: 'periods', type: 'number', label: L('间隔', 'Lag'), default: 1, min: 1, max: 10 }],
    auto: (df) => ({ col: df.columns.find((c) => df.dtypes[c] === 'number') }),
    run: (df, c) => opDiff(df, c) },
  { id: 'pct_change', group: 'series', icon: 'trending', label: L('pct_change 变化率', 'pct_change'),
    desc: L('环比变化百分比', 'Percentage change versus the previous row'),
    pandas: 'df[col].pct_change()', needsNumeric: true,
    params: [numCol('目标列', 'col', 'Column')],
    auto: (df) => ({ col: df.columns.find((c) => df.dtypes[c] === 'number') }),
    run: (df, c) => opPctChange(df, c) },
  { id: 'cumsum', group: 'series', icon: 'chart-line', label: L('cumsum 累加', 'cumsum'),
    desc: L('累计求和，看「前 N 名贡献了多少」', 'Running total — how much the top N contribute'),
    pandas: 'df[col].cumsum()', needsNumeric: true,
    params: [numCol('目标列', 'col', 'Column')],
    auto: (df) => ({ col: df.columns.find((c) => df.dtypes[c] === 'number') }),
    run: (df, c) => opCumsum(df, c) },
  { id: 'rolling', group: 'series', icon: 'chart-line', label: L('rolling 滑动窗口', 'rolling'),
    desc: L('窗口滑动求均值，抹掉噪声看趋势', 'Sliding-window mean to smooth noise'),
    pandas: 'df[col].rolling(w).mean()', needsNumeric: true,
    params: [numCol('目标列', 'col', 'Column'), { key: 'window', type: 'number', label: L('窗口宽度', 'Window'), default: 3, min: 2, max: 20 }],
    auto: (df) => ({ col: df.columns.find((c) => df.dtypes[c] === 'number') }),
    run: (df, c) => opRolling(df, c) },
  { id: 'rank', group: 'series', icon: 'trophy', label: L('rank 排名', 'rank'),
    desc: L('把数值翻译成名次，不改变行序', 'Turn values into ranks without reordering rows'),
    pandas: 'df[col].rank()', needsNumeric: true,
    params: [numCol('目标列', 'col', 'Column'),
      sel('asc', L('方向', 'Order'), 'asc', [{ v: 'asc', l: L('升序', 'ascending') }, { v: 'desc', l: L('降序', 'descending') }])],
    auto: (df) => ({ col: df.columns.find((c) => df.dtypes[c] === 'number') }),
    run: (df, c) => opRank(df, c) },
  { id: 'cut', group: 'series', icon: 'ruler', label: L('cut / qcut 分箱', 'cut / qcut'),
    desc: L('把连续数值离散成区间标签', 'Discretise continuous values into bins'),
    pandas: 'pd.cut(df[col], bins)', needsNumeric: true,
    params: [numCol('目标列', 'col', 'Column'),
      sel('mode', L('切分方式', 'Method'), 'cut', [
        { v: 'cut', l: L('cut · 等宽', 'cut · equal width') },
        { v: 'qcut', l: L('qcut · 等频', 'qcut · equal frequency') }]),
      { key: 'bins', type: 'number', label: L('箱数', 'Bins'), default: 4, min: 2, max: 10 }],
    auto: (df) => ({ col: df.columns.find((c) => df.dtypes[c] === 'number') }),
    run: (df, c) => opCut(df, c) },
  { id: 'where', group: 'series', icon: 'wand', label: L('where 条件替换', 'where'),
    desc: L('保留满足条件的值，其余替换', 'Keep values meeting a condition, replace the rest'),
    pandas: 'df[col].where(cond, other)', needsNumeric: true,
    params: [numCol('目标列', 'col', 'Column'),
      { key: 'value', type: 'number', label: L('阈值', 'Threshold'), default: null, hint: L('留空则取 Q1', 'empty = Q1') },
      { key: 'other', type: 'number', label: L('替换值', 'Replace with'), default: 0 }],
    auto: (df) => ({ col: df.columns.find((c) => df.dtypes[c] === 'number') }),
    run: (df, c) => opWhere(df, c) },
  { id: 'apply', group: 'series', icon: 'wand', label: L('apply 逐元素', 'apply'),
    desc: L('对每个元素调用一次函数', 'Call a function once per element'),
    pandas: 'df[col].apply(fn)', needsNumeric: true,
    params: [numCol('目标列', 'col', 'Column'),
      { key: 'decimals', type: 'number', label: L('保留小数位', 'Decimals'), default: 0, min: 0, max: 4 }],
    auto: (df) => ({ col: df.columns.find((c) => df.dtypes[c] === 'number') }),
    run: (df, c) => opApply(df, c) },

  /* ---------------- 字符串 ---------------- */
  { id: 'str_contains', group: 'strings', icon: 'code', label: L('str.contains', 'str.contains'),
    desc: L('按子串筛选文本行', 'Filter text rows by substring'),
    pandas: 'df[df[col].str.contains(pat)]',
    params: [anyCol('文本列', 'col', 'Text column'), { key: 'pat', type: 'text', label: L('匹配内容', 'Pattern'), default: '' }],
    auto: (df) => {
      const c = pickCategoryCol(df);
      const v = String(df.col(c)[0] ?? '');
      return { col: c, pat: v.slice(0, 1) };
    },
    run: (df, c) => opStrContains(df, c) },
  { id: 'str_replace', group: 'strings', icon: 'swap', label: L('str.replace', 'str.replace'),
    desc: L('批量替换文本内容', 'Bulk-replace text content'),
    pandas: 'df[col].str.replace(a, b)',
    params: [anyCol('文本列', 'col', 'Text column'),
      { key: 'from', type: 'text', label: L('查找', 'Find'), default: '' },
      { key: 'to', type: 'text', label: L('替换为', 'Replace with'), default: '' }],
    auto: (df) => { const c = pickCategoryCol(df); const v = String(df.col(c)[0] ?? ''); return { col: c, from: v.slice(0, 1), to: v.slice(0, 1).toUpperCase() }; },
    run: (df, c) => opStrReplace(df, c) },
  { id: 'str_split', group: 'strings', icon: 'scissors', label: L('str.split 拆分', 'str.split'),
    desc: L('按分隔符把一列拆成两列', 'Split one column into two by a separator'),
    pandas: 'df[col].str.split(sep, expand=True)',
    params: [anyCol('文本列', 'col', 'Text column'), { key: 'sep', type: 'text', label: L('分隔符', 'Separator'), default: '-' }],
    auto: (df) => {
      const cand = df.columns.find((c) => df.dtypes[c] !== 'number' && df.col(c).some((v) => typeof v === 'string' && /[-_ ]/.test(v)));
      return { col: cand || pickLabelCol(df), sep: '-' };
    },
    run: (df, c) => opStrSplit(df, c) },
  { id: 'str_upper', group: 'strings', icon: 'type', label: L('str.upper', 'str.upper'),
    desc: L('统一转成大写（规范化）', 'Normalise text to upper case'),
    pandas: 'df[col].str.upper()', params: [anyCol('文本列', 'col', 'Text column')],
    auto: (df) => ({ col: df.columns.find((c) => df.dtypes[c] !== 'number') }),
    run: (df, c) => opStrUpper(df, c) },
  { id: 'str_len', group: 'strings', icon: 'ruler', label: L('str.len 长度', 'str.len'),
    desc: L('新增一列：文本长度', 'Add a column with the text length'),
    pandas: 'df[col].str.len()', params: [anyCol('文本列', 'col', 'Text column')],
    auto: (df) => ({ col: pickLabelCol(df) }),
    run: (df, c) => opStrLen(df, c) },

  /* ---------------- 合并与重塑 ---------------- */
  { id: 'merge', group: 'combine', icon: 'merge', label: L('merge 连接', 'merge'),
    desc: L('★ 按连接键把两张表拼在一起（inner/left/right/outer）', '★ Join two frames on a key (inner/left/right/outer)'),
    pandas: 'df.merge(other, on, how)', highlight: true,
    params: [
      sel('how', L('连接方式', 'How'), 'left', [
        { v: 'left', l: L('left · 保留左表', 'left') }, { v: 'inner', l: L('inner · 交集', 'inner') },
        { v: 'right', l: L('right · 保留右表', 'right') }, { v: 'outer', l: L('outer · 并集', 'outer') },
      ]),
      { key: 'on', type: 'text', label: L('连接键（留空自动选择）', 'Key (auto if empty)'), default: '' },
    ],
    auto: (df) => {
      const other = makeSpec('region');
      const common = df.columns.filter((c) => other.columns.includes(c));
      const prefs = ['城市', 'City', '班级', 'Class', '订单号', 'OrderID', '学号', 'StudentID'];
      return { on: prefs.find((p) => common.includes(p)) || common[0] || '' };
    },
    run: (df, c) => opMerge(df, { ...c, on: c.on || undefined }) },
  { id: 'concat', group: 'combine', icon: 'layers', label: L('concat 拼接', 'concat'),
    desc: L('纵向堆叠，把行接在一起', 'Stack vertically, appending rows'),
    pandas: 'pd.concat([df, other], axis=0)', params: [],
    run: (df) => opConcat(df) },
  { id: 'pivot_table', group: 'combine', icon: 'pivot', label: L('pivot_table 透视', 'pivot_table'),
    desc: L('★ 行列交叉汇总，把长表压成交叉表', '★ Cross-tabulate long data into a matrix'),
    pandas: 'df.pivot_table(index, columns, values, aggfunc)', highlight: true, needsNumeric: true,
    params: [anyCol('行 index', 'index', 'index'), anyCol('列 columns', 'columns', 'columns'),
      numCol('值 values', 'values', 'values'), aggSel('fn', '聚合函数', 'mean')],
    auto: (df) => {
      const cat = pickCategoryCol(df);
      const num = df.columns.find((c) => df.dtypes[c] === 'number');
      const other = df.columns.find((c) => c !== cat && c !== num && df.dtypes[c] !== 'number');
      return { index: cat, columns: other || cat, values: num };
    },
    run: (df, c) => opPivot(df, c) },
  { id: 'melt', group: 'combine', icon: 'shuffle', label: L('melt 宽转长', 'melt'),
    desc: L('把多列「融化」成 变量/值 两列', 'Melt several columns into variable/value pairs'),
    pandas: 'df.melt(id_vars=[...])',
    params: [{ key: 'idVars', type: 'columns', filter: 'any', label: L('保留列 id_vars（留空 = 标签列）', 'id_vars (empty = label column)'), optional: true }],
    auto: (df) => ({ idVars: [pickLabelCol(df)] }),
    run: (df, c) => opMelt(df, c) },
  { id: 'crosstab', group: 'combine', icon: 'grid', label: L('crosstab 交叉表', 'crosstab'),
    desc: L('两个分类变量的交叉计数', 'Cross-count two categorical variables'),
    pandas: 'pd.crosstab(a, b)',
    params: [anyCol('行变量', 'a', 'Row variable'), anyCol('列变量', 'b', 'Column variable')],
    auto: (df) => {
      const objs = df.columns.filter((c) => df.dtypes[c] !== 'number');
      return { a: objs[0], b: objs[1] || objs[0] };
    },
    run: (df, c) => opCrosstab(df, c) },

  /* ---------------- 统计 ---------------- */
  { id: 'agg', group: 'stats', icon: 'calculator', label: L('列聚合', 'aggregate'),
    desc: L('均值 / 中位数 / 标准差 / 求和 的逐步演算', 'Step-by-step mean, median, std, sum'),
    pandas: 'df[col].mean()', needsNumeric: true,
    params: [numCol('目标列', 'col', 'Column'), aggSel('fn', '统计函数', 'mean')],
    auto: (df) => ({ col: df.columns.find((c) => df.dtypes[c] === 'number') }),
    run: (df, c) => opAgg(df, c) },
  { id: 'value_counts', group: 'stats', icon: 'chart-bar', label: L('value_counts', 'value_counts'),
    desc: L('每个取值出现了多少次', 'How often each value appears'),
    pandas: 'df[col].value_counts()',
    params: [anyCol('统计字段', 'col', 'Column'),
      sel('normalize', L('输出形式', 'Output'), 'count', [
        { v: 'count', l: L('绝对数量 count', 'raw counts') },
        { v: 'norm', l: L('占比 normalize=True', 'proportions') }])],
    auto: (df) => ({ col: pickCategoryCol(df) }),
    run: (df, c) => opValueCounts(df, { col: c.col, normalize: c.normalize === 'norm' }) },
  { id: 'groupby', group: 'stats', icon: 'layers', label: L('groupby', 'groupby'),
    desc: L('★ 分组 → 计算 → 合并，数据飞入桶中', '★ Split · apply · combine, rows flying into buckets'),
    pandas: 'df.groupby(by).agg(...)', highlight: true, needsNumeric: true,
    params: [anyCol('分组键', 'by', 'Group key'), numCol('聚合列', 'target', 'Target'), aggSel('fn', '组内计算', 'mean')],
    auto: (df) => {
      const by = pickCategoryCol(df);
      return { by, target: df.columns.find((c) => df.dtypes[c] === 'number' && c !== by) };
    },
    run: (df, c) => opGroupBy(df, c) },

  /* ---------------- 可视化 ---------------- */
  { id: 'hist', group: 'plots', icon: 'chart-hist', label: L('直方图', 'Histogram'),
    desc: L('数据落进箱子，分布形态一点点长出来', 'Data drops into bins and the shape emerges'),
    pandas: 'df[col].plot.hist()', needsNumeric: true,
    params: [numCol('目标列', 'col', 'Column')],
    auto: (df) => ({ col: df.columns.find((c) => df.dtypes[c] === 'number') }),
    run: (df, c) => opHist(df, c) },
  { id: 'bar', group: 'plots', icon: 'chart-bar', label: L('柱状图', 'Bar chart'),
    desc: L('按类别比较数量', 'Compare counts across categories'),
    pandas: 'df[x].value_counts().plot.bar()',
    params: [anyCol('分类轴 x', 'x', 'Category axis')],
    auto: (df) => ({ x: pickCategoryCol(df) }),
    run: (df, c) => opBar(df, c) },
  { id: 'line', group: 'plots', icon: 'chart-line', label: L('折线图', 'Line chart'),
    desc: L('逐点绘制，看趋势如何形成', 'Draw point by point and watch the trend form'),
    pandas: 'df.plot.line(x, y)', needsNumeric: true,
    params: [numCol('纵轴 y', 'y', 'Y axis'), { key: 'x', type: 'column', filter: 'any', label: L('横轴 x', 'X axis'), optional: true }],
    auto: (df) => ({ y: df.columns.find((c) => df.dtypes[c] === 'number'), x: pickLabelCol(df) }),
    run: (df, c) => opLine(df, c) },
  { id: 'scatter', group: 'plots', icon: 'scatter', label: L('散点图', 'Scatter plot'),
    desc: L('两个变量的关系与相关系数', 'Relationship between two variables plus r'),
    pandas: 'df.plot.scatter(x, y)', needsNumeric: true,
    params: [numCol('横轴 x', 'x', 'X axis'), numCol('纵轴 y', 'y', 'Y axis')],
    auto: (df) => { const n = df.columns.filter((c) => df.dtypes[c] === 'number'); return { x: n[0], y: n[1] || n[0] }; },
    run: (df, c) => opScatter(df, c) },
  { id: 'box', group: 'plots', icon: 'box', label: L('箱线图', 'Box plot'),
    desc: L('五数概括 + 自动识别离群点', 'Five-number summary plus automatic outlier detection'),
    pandas: 'df[col].plot.box()', needsNumeric: true,
    params: [numCol('目标列', 'col', 'Column')],
    auto: (df) => ({ col: df.columns.find((c) => df.dtypes[c] === 'number') }),
    run: (df, c) => opBox(df, c) },
  { id: 'heatmap', group: 'plots', icon: 'grid', label: L('相关热力图', 'Correlation heatmap'),
    desc: L('所有数值列两两相关的颜色矩阵', 'Colour matrix of all pairwise correlations'),
    pandas: 'df.corr()', needsNumeric: true, params: [],
    run: (df) => opHeatmap(df) },

  /* ---------------- 导出 ---------------- */
  { id: 'export', group: 'export', icon: 'download', label: L('导出 & 总览', 'Export & review'),
    desc: L('回顾整条管道并下载 CSV', 'Review the whole pipeline and download CSV'),
    pandas: 'df.to_csv("cleaned.csv")', params: [],
    run: (df, c) => opExport(df, c) },
];

export const OP_GROUPS = ['overview', 'select', 'clean', 'transform', 'series', 'strings', 'combine', 'stats', 'plots', 'export'];

export const GROUP_LABEL = {
  overview: L('概览', 'Overview'),
  select: L('选择与索引', 'Select & Index'),
  clean: L('清洗', 'Cleaning'),
  transform: L('变换', 'Transform'),
  series: L('序列运算', 'Series Ops'),
  strings: L('字符串', 'Strings'),
  combine: L('合并与重塑', 'Combine & Reshape'),
  stats: L('统计聚合', 'Statistics'),
  plots: L('可视化', 'Plots'),
  export: L('导出', 'Export'),
};

export function getOp(id) { return OPS.find((o) => o.id === id); }

/** 为一组列生成「自动参数」，让用户不选也能跑 */
export function autoParams(op, df) {
  const out = {};
  for (const p of op.params || []) {
    if (p.type === 'column') {
      const pool = df.columns.filter((c) => (p.filter === 'number' ? df.dtypes[c] === 'number' : true));
      out[p.key] = pool.length ? pool[0] : undefined;
    } else if (p.type === 'columns') out[p.key] = [];
    else if (p.type === 'select') out[p.key] = p.default;
    else if (p.type === 'number') out[p.key] = p.default;
    else if (p.type === 'text') out[p.key] = p.default || '';
    else if (p.type === 'rename') out[p.key] = {};
  }
  if (typeof op.auto === 'function') Object.assign(out, op.auto(df, out) || {});
  return out;
}
