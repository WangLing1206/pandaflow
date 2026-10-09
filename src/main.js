/* ------------------------------------------------------------------
 * main.js — 应用装配
 * ------------------------------------------------------------------ */

import { el, clear, fmt, clamp, sleep, nextFrame } from './core/utils.js';
import { makeDefaultDataset } from './core/datasets.js';
import { parseCSV } from './core/csv.js';
import { OPS, getOp, autoParams } from './core/ops/index.js';
import { Player } from './ui/player.js';
import { DataFrameView } from './ui/table.js';
import { Stage } from './ui/stage.js';
import { icon } from './ui/icons.js';
import {
  toast, buildPalette, renderPipeline, renderDatasetCard,
  renderStatTable, openOpDrawer, openImportDrawer, renderMiniChart, injectCSVParser,
} from './ui/panels.js';

/* ============================== 状态 ============================== */
const state = {
  dsId: 'student',
  original: makeDefaultDataset(),
  df: null,
  history: [],          // { opId, label, cfg, summary, frames, delta, shapeBefore, shapeAfter }
  activeStep: -1,
  currentFrame: null,
  autoRun: null,        // 一键演示的剩余队列
  activeOpId: null,
};

injectCSVParser(parseCSV);

/* ============================== DOM ============================== */
const $ = (id) => document.getElementById(id);
const stage = new Stage($('stage'));
stage.onPick = (opId) => { const op = getOp(opId); if (op) pickOp(op); };
const tableView = new DataFrameView($('dfView'));
tableView.bindScroll();
const player = new Player();

/* ============================== 初始化 ============================== */
function boot() {
  state.df = state.original;
  $('opCount').textContent = `${OPS.length} 个操作`;
  renderAll();
  renderPipelinePanel();
  renderIdleTable();
  stage.render({ kind: 'none' });
  renderTableFoot();

  $('tpSpeed').innerHTML = '';
  [0.5, 1, 1.5, 2, 3].forEach((s) => {
    const b = el('button', { class: 'speed-pill' + (s === 1 ? ' on' : ''), onclick: () => {
      player.setSpeed(s);
      [...$('tpSpeed').children].forEach((n) => n.classList.toggle('on', n === b));
    } }, [s + '×']);
    $('tpSpeed').appendChild(b);
  });
}

function renderAll() {
  const df = state.df;
  $('dsName').textContent = df.meta?.title || df.name;
  $('dsMeta').textContent = `${df.nrow} × ${df.ncol}`;
  $('dfShape').textContent = `${df.nrow} 行 × ${df.ncol} 列`;
  $('dfSrc').textContent = df.source || '';
  $('dfVar').textContent = df.name === 'df' ? 'df' : `df  ·  ${df.meta?.title || df.name}`;
  buildPalette($('palette'), { onPick: pickOp, activeId: state.activeOpId, df, ops: OPS });
  renderDatasetCard($('inspDataset'), df, state.original);
  renderStatTable($('inspStats'), df);
  refreshChartCols();
}

/** 空闲态（没有正在播放的帧）时，表格直接展示当前 df */
function renderIdleTable() {
  const df = state.df;
  tableView.render({
    columns: df.columns,
    dtypes: df.dtypes,
    rows: df._rows.map((r, i) => ({ rid: r.rid, cells: r.cells.slice(), state: 'normal', label: String(i) })),
  });
}

/** 表格底部信息条 */
function renderTableFoot() {
  const df = state.df;
  const nulls = df.nullCounts();
  const totalNull = Object.values(nulls).reduce((a, b) => a + b, 0);
  const numCols = df.columns.filter((c) => df.dtypes[c] === 'number');
  const foot = $('dfFoot');
  foot.innerHTML = '';
  const item = (k, v, tone) => el('span', {}, [
    el('span', { class: 'k' }, [k + ' ']),
    el('b', { style: tone ? { color: tone } : null }, [v]),
  ]);
  foot.append(
    item('shape', `${df.nrow} × ${df.ncol}`),
    item('dtypes', `${new Set(df.columns.map((c) => df.dtypes[c])).size} 种`),
    item('数值列', String(numCols.length)),
    item('缺失', String(totalNull), totalNull ? 'var(--rose)' : 'var(--emerald)'),
    el('span', { class: 'st-grow', style: { flex: '1' } }),
    el('span', { class: 'k' }, ['索引 ' + (df.nrow ? `0 … ${df.nrow - 1}` : '空')]),
  );
}

function refreshChartCols() {
  const sel = $('chartCol');
  const numCols = state.df.columns.filter((c) => state.df.dtypes[c] === 'number');
  const prev = sel.value;
  clear(sel);
  numCols.forEach((c) => sel.appendChild(el('option', { value: c }, [c])));
  if (numCols.includes(prev)) sel.value = prev;
  sel.onchange = () => renderMiniChart($('inspChart'), state.df, sel.value);
  renderMiniChart($('inspChart'), state.df, sel.value || numCols[0]);
}

/* ============================== 运行操作 ============================== */
function pickOp(op, disabled) {
  if (disabled || (op.needsNumeric && !state.df.columns.some((c) => state.df.dtypes[c] === 'number'))) {
    toast(`「${op.label}」需要数值列，当前数据里没有可用的数值字段`, 'warn', 3400);
    return;
  }
  state.activeOpId = op.id;
  buildPalette($('palette'), { onPick: pickOp, activeId: op.id, df: state.df, ops: OPS });
  openOpDrawer(op, state.df, {
    onRun: (o, cfg) => runOp(o, cfg),
  });
}

function runOp(op, cfg) {
  let out;
  try {
    out = op.run(state.df, { ...cfg, history: state.history, original: state.original });
  } catch (e) {
    console.error(e);
    toast(`「${op.label}」执行失败：${e.message}`, 'err', 4200);
    return;
  }
  if (!out || !out.frames?.length) { toast('该操作没有产生可演示的步骤', 'warn'); return; }

  const before = state.df;
  const after = out.result || before;
  const delta = before.nrow !== after.nrow || before.ncol !== after.ncol
    ? `${before.nrow}×${before.ncol}→${after.nrow}×${after.ncol}`
    : `${after.nrow}行`;

  state.history.push({
    opId: op.id, label: op.label, cfg, summary: out.summary,
    frames: out.frames, delta,
    shapeBefore: [before.nrow, before.ncol],
    shapeAfter: [after.nrow, after.ncol],
    dfBefore: before,
  });
  state.df = after;
  state.activeStep = state.history.length - 1;

  renderAll();
  renderPipelinePanel();
  renderTableFoot();
  player.load(out.frames);
  player.play();
  toast(`${op.label} · ${out.summary}`, 'ok');
}

/* 撤销：从原始数据重放剩余步骤 */
function undo() {
  if (!state.history.length) { toast('没有可撤销的步骤', 'warn'); return; }
  state.history.pop();
  state.df = state.original;
  for (const h of state.history) {
    const op = getOp(h.opId);
    try { state.df = op.run(state.df, { ...h.cfg, history: [], original: state.original }).result || state.df; }
    catch (e) { console.error('replay failed', h.opId, e); }
  }
  state.activeStep = state.history.length - 1;
  renderAll();
  renderPipelinePanel();
  renderTableFoot();
  if (state.history.length) replayStep(state.activeStep);
  else { player.load([]); stage.render({ kind: 'none' }); renderIdleTable(); setNarration('已恢复到上一步之前的状态。'); }
  toast('已撤销上一步', 'ok');
}

function resetData() {
  state.df = state.original;
  state.history = [];
  state.activeStep = -1;
  player.load([]);
  renderAll();
  renderPipelinePanel();
  renderIdleTable();
  stage.render({ kind: 'none' });
  renderTableFoot();
  setNarration('已恢复到原始数据集。');
  $('stPhase').textContent = '就绪';
  $('stTitle').textContent = '选择左侧任意操作，开始逐步演示';
  $('stHud').innerHTML = '';
  setCode(null);
  toast('数据集已重置', 'ok');
}

function renderPipelinePanel() {
  renderPipeline($('pipeline'), state.history, state.activeStep, (i) => replayStep(i));
  $('pipeCount').textContent = String(state.history.length);
}

function replayStep(i) {
  const h = state.history[i];
  if (!h) return;
  state.activeStep = i;
  renderPipelinePanel();
  player.load(h.frames);
  player.play();
}

/* ============================== 帧渲染 ============================== */
player.onFrame = (frame) => {
  if (!frame) return;
  state.currentFrame = frame;
  renderFrame(frame);
};

player.onState = (s) => {
  const isPlaying = player.playing;
  $('tpPlayIcon').innerHTML = isPlaying
    ? '<path d="M8 4v16M16 4v16"/>'
    : '<path d="M7 4l12 8-12 8V4z"/>';
  $('tpPlay').classList.toggle('playing', isPlaying);
  $('tpStep').textContent = String(player.index + 1);
  $('tpTotal').textContent = String(player.total);
  if (s === 'end') onSequenceEnd();
};

function renderFrame(f) {
  // 舞台
  $('stHead').dataset.tone = f.tone || 'info';
  $('narr').dataset.tone = f.tone || 'info';
  $('stPhase').textContent = f.phase || '';
  $('stTitle').textContent = f.title || '';
  $('stHud').innerHTML = '';
  (f.hud || []).forEach((h) => {
    $('stHud').appendChild(el('div', { class: 'hud', data: { tone: h.tone || 'info' } }, [
      el('span', { class: 'k' }, [h.label]),
      el('span', { class: 'v' }, [h.value]),
    ]));
  });

  stage.render(f.stage);
  tableView.render(f.table);
  setNarration(f.narration, f.duration);
  setCode(f.code);

  // 进度条
  const p = player.total <= 1 ? 1 : player.index / (player.total - 1);
  $('tpFill').style.width = (p * 100) + '%';
  $('tpStep').textContent = String(player.index + 1);
  $('tpTotal').textContent = String(player.total);

  // 进度条上的“关键时刻”标记
  const marks = $('tpMarks');
  if (marks.dataset.for !== String(player.total)) {
    marks.dataset.for = String(player.total);
    marks.innerHTML = '';
    player.frames.forEach((fr, i) => {
      if (!['gold', 'danger'].includes(fr.tone)) return;
      marks.appendChild(el('div', {
        class: 'tp-mark' + (fr.tone === 'gold' ? ' gold' : ''),
        style: { left: (player.total <= 1 ? 0 : i / (player.total - 1) * 100) + '%' },
        title: fr.title,
      }));
    });
  }
}

/* 解说：按句渐进揭示 */
let narrTimer = null;
function setNarration(text, duration = 1200) {
  const host = $('narrText');
  clearTimeout(narrTimer);
  if (!text) { host.innerHTML = ''; return; }
  const parts = String(text).split(/(?<=[。；！？])/).filter((s) => s.trim());
  const step = clamp((duration || 1200) * 0.42 / Math.max(1, parts.length), 70, 320);
  host.innerHTML = '';
  parts.forEach((s, i) => {
    const span = el('span', { html: mark(s) + (i === parts.length - 1 ? '<span class="caret"></span>' : '') });
    span.style.display = 'inline';
    span.style.animation = `fadeUp .42s cubic-bezier(.16,1,.3,1) both`;
    span.style.animationDelay = (i * step) + 'ms';
    host.appendChild(span);
  });
}

const KW = /(?<![\w.])(df\.\w+|idxmax|idxmin|dropna|fillna|drop_duplicates|groupby|describe|value_counts|sort_values|reset_index|astype|nlargest|clip|drop|sample|head|tail|info|query|assign|rename|to_csv|isnull|sum|mean|median|std|min|max|NaN|True|False|reset_index|axis|subset|keep|ascending|random_state|skipna|ddof|IQR|Q1|Q3)(?![\w])/g;
function mark(t) {
  return String(t)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/(?<![\w.])(-?\d+(?:\.\d+)?%?)(?![\w])/g, '<span class="num-hl">$1</span>')
    .replace(KW, '<b>$1</b>');
}

/* 代码面板 */
function setCode(code) {
  const body = $('codeBody');
  if (!code || !code.lines?.length) {
    body.innerHTML = '';
    body.appendChild(el('div', { class: 'code-line' }, [
      el('span', { class: 'code-ln' }, ['1']),
      el('span', { class: 'code-tx code-cm' }, ['# 选择操作后，这里会同步高亮对应的 pandas 代码']),
    ]));
    return;
  }
  const sig = code.lines.map((l) => l.text + (l.active ? '|1' : '|0')).join('\n');
  if (body.dataset.sig === sig) return;
  body.dataset.sig = sig;
  body.innerHTML = '';
  let activeNode = null;
  code.lines.forEach((l, i) => {
    const isComment = /^\s*#/.test(l.text);
    const node = el('div', { class: 'code-line' + (l.active ? ' active' : '') }, [
      el('span', { class: 'code-ln' }, [String(i + 1)]),
      el('span', { class: 'code-tx' + (isComment ? ' code-cm' : ''), html: pyHL(l.text) }),
    ]);
    if (l.active) activeNode = node;
    body.appendChild(node);
  });
  // 让当前高亮的代码行始终可见
  if (activeNode) {
    const top = activeNode.offsetTop - body.clientHeight / 2 + activeNode.clientHeight / 2;
    body.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
  }
}

function pyHL(t) {
  let s = String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  if (/^\s*#/.test(t)) return s;
  s = s.replace(/(&quot;|")([^"]*)(\1)/g, '<span class="code-str">"$2"</span>');
  s = s.replace(/(?<![\w.])(-?\d+(?:\.\d+)?)(?![\w])/g, '<span class="code-num">$1</span>');
  s = s.replace(/(?<![\w.])(import|as|True|False|None|and|or|not|in)(?![\w])/g, '<span class="code-kw">$1</span>');
  return s;
}

/* ============================== 一键演示 ============================== */
const DEMO_SCRIPT = [
  { op: 'info' },
  { op: 'drop_duplicates' },
  { op: 'drop_extremes', cfg: { col: '数学', mode: 'both' } },
  { op: 'fillna', cfg: { col: '英语', strategy: 'mean' } },
  { op: 'describe' },
  { op: 'hist', cfg: { col: '数学' } },
  { op: 'groupby', cfg: { by: '班级', target: '数学', fn: 'mean' } },
  { op: 'export' },
];

function startAutoDemo() {
  resetData();
  state.autoRun = DEMO_SCRIPT.slice();
  player.setSpeed(2.5);
  [...$('tpSpeed').children].forEach((n) => n.classList.toggle('on', n.textContent === '2.5×'));
  if (![...$('tpSpeed').children].some((n) => n.textContent === '2.5×')) {
    const b = el('button', { class: 'speed-pill on', onclick: () => {
      player.setSpeed(2.5);
      [...$('tpSpeed').children].forEach((n) => n.classList.toggle('on', n === b));
    } }, ['2.5×']);
    $('tpSpeed').appendChild(b);
  }
  toast('一键演示开始：完整走一遍数据分析流程', 'ok', 3600);
  nextAutoStep();
}

function nextAutoStep() {
  if (!state.autoRun) return;
  const step = state.autoRun.shift();
  if (!step) {
    state.autoRun = null;
    player.setSpeed(1);
    toast('演示结束 —— 已完整走完 8 个步骤', 'ok', 4000);
    return;
  }
  const op = getOp(step.op);
  if (!op) { nextAutoStep(); return; }
  const cfg = step.cfg || autoParams(op, state.df);
  setTimeout(() => runOp(op, cfg), 700);
}

function onSequenceEnd() {
  if (state.autoRun) nextAutoStep();
}

/* ============================== 事件绑定 ============================== */
$('dsChip').addEventListener('click', () => openImportDrawer(state.dsId, {
  onLoad: (df, label) => {
    state.original = df;
    state.df = df;
    state.history = [];
    state.activeStep = -1;
    state.dsId = null;
    player.load([]);
    renderAll();
    renderPipelinePanel();
    renderTableFoot();
    renderIdleTable();
    stage.render({ kind: 'none' });
    setNarration(`已加载「${label}」：${df.nrow} 行 × ${df.ncol} 列。点击左侧任意操作开始逐步演示。`);
    $('stPhase').textContent = '数据已就绪';
    $('stTitle').textContent = `${label} · ${df.nrow} 行 × ${df.ncol} 列`;
    $('stHud').innerHTML = '';
    toast(`已加载 ${label}（${df.nrow} × ${df.ncol}）`, 'ok');
  },
}));

$('btnImport').addEventListener('click', () => $('dsChip').click());
$('btnReset').addEventListener('click', resetData);
$('btnUndo').addEventListener('click', undo);
$('btnDemo').addEventListener('click', startAutoDemo);

$('btnLeft').addEventListener('click', () => $('app').classList.toggle('collapse-left'));
$('btnRight').addEventListener('click', () => $('app').classList.toggle('collapse-right'));

$('tpPlay').addEventListener('click', () => player.toggle());
$('tpPrev').addEventListener('click', () => { player.pause(); player.prev(); });
$('tpNext').addEventListener('click', () => { player.pause(); player.next(); });
$('tpFirst').addEventListener('click', () => { player.pause(); player.seek(0); });
$('tpLast').addEventListener('click', () => { player.pause(); player.seek(player.total - 1); });

$('tpTrack').addEventListener('click', (e) => {
  const r = e.currentTarget.getBoundingClientRect();
  const t = clamp((e.clientX - r.left) / r.width, 0, 1);
  player.pause();
  player.seek(Math.round(t * (player.total - 1)));
});

document.addEventListener('keydown', (e) => {
  if (e.target.matches('input, textarea, select')) return;
  if (e.code === 'Space') { e.preventDefault(); player.toggle(); }
  else if (e.key === 'ArrowRight') { e.preventDefault(); player.pause(); player.next(); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); player.pause(); player.prev(); }
  else if (e.key === 'Home') { e.preventDefault(); player.pause(); player.seek(0); }
  else if (e.key === 'End') { e.preventDefault(); player.pause(); player.seek(player.total - 1); }
});

$('bootStart').addEventListener('click', () => {
  $('boot').classList.add('off');
  setTimeout(() => $('boot').remove(), 800);
});
$('bootDemo').addEventListener('click', () => {
  $('boot').classList.add('off');
  setTimeout(() => $('boot').remove(), 800);
  setTimeout(startAutoDemo, 500);
});

/* ============================== 启动 ============================== */
boot();
window.__PF__ = { state, player, stage, tableView, runOp, getOp };
