/* ------------------------------------------------------------------
 * i18n/dict.js — 界面文案字典（中 / 英一一对应）
 * ------------------------------------------------------------------ */

const L = (zh, en) => ({ zh, en });

export const DICT = {
  /* ---------- 品牌 ---------- */
  'brand.name': L('熊猫数据流', 'PandaFlow'),
  'brand.tagline': L('可视化数据分析全过程', 'Visual Data Analysis, Step by Step'),

  /* ---------- 顶栏 ---------- */
  'top.dataset': L('数据集', 'Dataset'),
  'top.import': L('切换 / 导入', 'Switch / Import'),
  'top.demo': L('一键演示', 'Auto Demo'),
  'top.undo': L('撤销', 'Undo'),
  'top.reset': L('重置', 'Reset'),
  'top.collapseLeft': L('折叠操作库', 'Collapse library'),
  'top.collapseRight': L('折叠检查器', 'Collapse inspector'),
  'top.theme': L('切换主题', 'Toggle theme'),
  'top.lang': L('切换语言', 'Switch language'),
  'top.dark': L('深色', 'Dark'),
  'top.light': L('浅色', 'Light'),

  /* ---------- 左栏 ---------- */
  'side.library': L('操作库', 'Operations'),
  'side.ops': L('{n} 个操作', '{n} operations'),
  'side.pipeline': L('处理管道', 'Pipeline'),
  'side.pipelineEmpty': L('还没有任何处理步骤', 'No steps yet'),
  'side.pipelineHint': L('每次运行操作都会在这里留下可回放的记录', 'Every run leaves a replayable record here'),
  'side.unavailable': L('不可用', 'N/A'),
  'side.needsNumeric': L('当前数据没有数值列，该操作不可用', 'No numeric column in the current data'),

  /* ---------- 舞台 ---------- */
  'stage.ready': L('就绪', 'Ready'),
  'stage.idleTitle': L('选择任意操作，逐步观看数据是怎样被处理的', 'Pick any operation and watch the data being processed'),
  'stage.idleSub': L(
    '每个 pandas 操作都会被拆解成一串可回放的帧 —— 扫描、判定、删除、重置索引，每一步都有解说与等价代码。',
    'Every pandas operation is broken into replayable frames — scanning, testing, dropping, re-indexing, each with narration and the equivalent code.'),
  'stage.readyTitle': L('选择左侧任意操作，开始逐步演示', 'Pick an operation on the left to begin'),
  'stage.star': L('★ 旗舰演示', '★ Flagship'),
  'stage.keys': L('快捷键', 'Shortcuts'),
  'stage.keyPlay': L('播放 / 暂停', 'Play / pause'),
  'stage.keyStep': L('单步前后', 'Step back / forward'),
  'stage.keyEnds': L('首帧 / 末帧', 'First / last frame'),
  'stage.noData': L('没有可绘制的数据', 'Nothing to plot'),
  'stage.noDataHint': L('当前列没有有效数值，或数据已被上一步过滤为空。', 'This column has no valid numbers, or the data was filtered to empty.'),

  /* ---------- 视图面板 ---------- */
  'view.title': L('分析视图', 'Analysis Views'),
  'view.table': L('数据表', 'Table'),
  'view.charts': L('图表', 'Charts'),
  'view.stats': L('统计', 'Stats'),
  'view.missing': L('缺失值', 'Missing'),
  'view.corr': L('相关性', 'Correlation'),
  'view.linkHint': L('视图随动画实时联动', 'Views follow the animation live'),
  'view.linked': L('已联动', 'Live'),
  'view.frozen': L('已锁定', 'Frozen'),
  'view.freeze': L('锁定当前帧', 'Freeze this frame'),
  'view.unfreeze': L('恢复联动', 'Resume live'),
  'view.cols': L('列', 'Columns'),
  'view.x': L('横轴', 'X'),
  'view.y': L('纵轴', 'Y'),
  'view.group': L('分组', 'Group'),
  'view.bins': L('分箱数', 'Bins'),
  'view.empty': L('当前视图暂无可用数据', 'No data available for this view'),

  /* ---------- 图表类型 ---------- */
  'chart.hist': L('直方图', 'Histogram'),
  'chart.box': L('箱线图', 'Box'),
  'chart.violin': L('小提琴图', 'Violin'),
  'chart.strip': L('点阵图', 'Strip'),
  'chart.line': L('折线图', 'Line'),
  'chart.area': L('面积图', 'Area'),
  'chart.bar': L('柱状图', 'Bar'),
  'chart.groupedBar': L('分组柱状图', 'Grouped Bar'),
  'chart.pie': L('环形图', 'Donut'),
  'chart.scatter': L('散点图', 'Scatter'),
  'chart.heatmap': L('相关热力图', 'Correlation Heatmap'),
  'chart.density': L('密度曲线', 'Density'),
  'chart.ecdf': L('累积分布', 'ECDF'),
  'chart.qq': L('Q-Q 图', 'Q-Q Plot'),

  /* ---------- 传输控制 ---------- */
  'tp.play': L('播放 / 暂停 (空格)', 'Play / pause (Space)'),
  'tp.prev': L('上一帧 (←)', 'Previous frame (←)'),
  'tp.next': L('下一帧 (→)', 'Next frame (→)'),
  'tp.first': L('回到第一帧 (Home)', 'First frame (Home)'),
  'tp.last': L('跳到最后一帧 (End)', 'Last frame (End)'),
  'tp.speed': L('速度', 'Speed'),
  'tp.frames': L('帧', 'frames'),

  /* ---------- 检查器 ---------- */
  'insp.dataset': L('数据集', 'Dataset'),
  'insp.rows': L('行', 'rows'),
  'insp.cols': L('列', 'cols'),
  'insp.numeric': L('数值列', 'numeric'),
  'insp.missing': L('缺失', 'missing'),
  'insp.noMissing': L('无缺失', 'no missing'),
  'insp.original': L('原始 {r}×{c}', 'original {r}×{c}'),
  'insp.dict': L('数据字典', 'Data dictionary'),
  'insp.describe': L('describe 实时摘要', 'Live describe()'),
  'insp.followsData': L('随数据变化', 'follows the data'),
  'insp.dist': L('分布速览', 'Distribution'),

  /* ---------- 抽屉 ---------- */
  'drawer.run': L('运行并演示', 'Run & animate'),
  'drawer.cancel': L('取消', 'Cancel'),
  'drawer.close': L('关闭', 'Close'),
  'drawer.pandas': L('pandas 等价代码', 'Equivalent pandas code'),
  'drawer.required': L('请填写「{label}」', 'Please provide "{label}"'),
  'drawer.noParams': L('该操作无需参数，直接运行即可。', 'No parameters needed — just run it.'),
  'drawer.autoName': L('自动命名', 'auto'),

  /* ---------- 导入 ---------- */
  'imp.title': L('数据集', 'Dataset'),
  'imp.desc': L('使用内置数据集，或导入你自己的 CSV / TSV / JSON', 'Use a built-in dataset, or import your own CSV / TSV / JSON'),
  'imp.builtin': L('内置数据集', 'Built-in datasets'),
  'imp.file': L('导入文件', 'Import a file'),
  'imp.drop': L('点击选择，或把文件拖到这里', 'Click to choose, or drop a file here'),
  'imp.dropSub': L('支持 .csv / .tsv / .txt / .json · 自动识别分隔符与列类型 · 全程在浏览器本地解析',
    'Supports .csv / .tsv / .txt / .json · auto-detects delimiter and types · parsed entirely in your browser'),
  'imp.paste': L('或直接粘贴 CSV 文本', 'Or paste CSV text'),
  'imp.parse': L('解析并加载', 'Parse & load'),
  'imp.pasteFirst': L('先粘贴一些 CSV 文本', 'Paste some CSV text first'),
  'imp.failed': L('导入失败：{msg}', 'Import failed: {msg}'),
  'imp.loaded': L('已加载 {name}（{r} × {c}）', 'Loaded {name} ({r} × {c})'),
  'imp.parsed': L('解析失败：{msg}', 'Parse failed: {msg}'),

  /* ---------- 通用 ---------- */
  'common.ok': L('完成', 'Done'),
  'common.index': L('索引', 'index'),
  'common.count': L('计数', 'count'),
  'common.mean': L('均值', 'mean'),
  'common.median': L('中位数', 'median'),
  'common.std': L('标准差', 'std'),
  'common.min': L('最小值', 'min'),
  'common.max': L('最大值', 'max'),
  'common.sum': L('求和', 'sum'),
  'common.nunique': L('唯一值', 'unique'),
  'common.shape': L('形状', 'shape'),
  'common.before': L('处理前 before', 'before'),
  'common.after': L('处理后 after', 'after'),
  'common.removed': L('已移除', 'Removed'),
  'common.kept': L('保留', 'Kept'),
  'common.rows': L('行', 'rows'),
  'common.colsShort': L('列', 'cols'),
  'common.nan': L('缺失', 'NaN'),
  'common.unit': L('单位', 'unit'),
  'common.noNumeric': L('当前数据没有数值列', 'No numeric columns in the current data'),

  /* ---------- 提示 ---------- */
  'toast.undone': L('已撤销上一步', 'Undid the last step'),
  'toast.nothingUndo': L('没有可撤销的步骤', 'Nothing to undo'),
  'toast.reset': L('数据集已重置', 'Dataset reset'),
  'toast.noFrames': L('该操作没有产生可演示的步骤', 'This operation produced no steps'),
  'toast.runFailed': L('「{label}」执行失败：{msg}', '"{label}" failed: {msg}'),
  'toast.autoStart': L('一键演示开始：完整走一遍数据分析流程', 'Auto demo started — a full analysis walkthrough'),
  'toast.autoEnd': L('演示结束 —— 已完整走完 {n} 个步骤', 'Demo finished — {n} steps completed'),
  'toast.exported': L('已导出 cleaned.csv', 'Exported cleaned.csv'),
  'toast.langSwitched': L('已切换到中文', 'Switched to English'),
  'toast.themeSwitched': L('已切换到{name}主题', 'Switched to {name} theme'),

  /* ---------- 代码面板 ---------- */
  'code.title': L('pandas 等价代码', 'Equivalent pandas'),
  'code.placeholder': L('# 选择操作后，这里会同步高亮对应的 pandas 代码',
    '# The matching pandas code will highlight here'),
  'code.export': L('下载 cleaned.csv', 'Download cleaned.csv'),
  'code.ready': L('准备导出', 'Ready to export'),
};
