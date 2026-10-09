/* ------------------------------------------------------------------
 * main.js — 应用装配
 *  ----------------------------------------------------------------
 *  职责：状态管理、操作执行、帧渲染、语言与主题切换、一键演示。
 *  语言切换会重放整条管道（操作是纯函数，结果完全一致），
 *  这样列名、解说、代码片段、图表标签会全部同步成新语言。
 * ------------------------------------------------------------------ */

import './core/dataframe-extra.js';           // 挂载 DataFrame 的进阶方法

import { el, clear, fmt, clamp, sleep, nextFrame } from './core/utils.js';
import { makeDefaultDataset, makeSpec, specById } from './core/datasets.js';
import { parseCSV } from './core/csv.js';
import { OPS, OP_GROUPS, GROUP_LABEL, getOp, autoParams } from './core/ops/index.js';
import { L, pick, getLang, setLang, t, onLangChange, initLang } from './i18n/index.js';
import { Player } from './ui/player.js';
import { Stage } from './ui/stage.js';
import { ViewPanel } from './ui/views.js';
import { icon } from './ui/icons.js';
import {
  toast, buildPalette, renderPipeline, renderDatasetCard, renderStatTable,
  openOpDrawer, openImportDrawer, renderMiniChart, injectCSVParser,
} from './ui/panels.js';

/* ============================== 主题 ============================== */
const THEME_KEY = 'pandaflow.theme';
function initTheme() {
  let th = 'dark';
  try { th = localStorage.getItem(THEME_KEY) || 'dark'; } catch { /* ignore */ }
  document.documentElement.setAttribute('data-theme', th);
  return th;
}
function applyTheme(th) {
  document.documentElement.setAttribute('data-theme', th);
  try { localStorage.setItem(THEME_KEY, th); } catch { /* ignore */ }
}

/* ============================== 状态 ============================== */
const state = {
  theme: 'dark',
  specId: 'student',
  original: null,
  df: null,
  history: [],
  activeStep: -1,
  currentFrame: null,
  autoRun: null,
  activeOpId: null,
};

initLang();
state.theme = initTheme();
state.original = makeDefaultDataset();
state.df = state.original;
injectCSVParser(parseCSV);

/* ============================== DOM ============================== */
const $ = (id) => document.getElementById(id);
const stage = new Stage($('stage'));
stage.onPick = (opId) => { const op = getOp(opId); if (op) pickOp(op); };
const viewPanel = new ViewPanel($('viewPanel'));
const player = new Player();

/* ============================== 启动 ============================== */
function boot() {
  applyStaticI18n();
  $('opCount').textContent = t('side.ops', { n: OPS.length });
  renderAll();
  renderPipelinePanel();
  stage.render({ kind: 'none' });
  refreshPalette();

  const speeds = [0.5, 1, 1.5, 2, 3];
  $('tpSpeed').innerHTML = '';
  speeds.forEach((sp) => {
    const b = el('button', {
      class: 'speed-pill' + (sp === 1 ? ' on' : ''),
      onclick: () => {
        player.setSpeed(sp);
        [...$('tpSpeed').children].forEach((n) => n.classList.toggle('on', n === b));
      },
    }, [sp + '×']);
    $('tpSpeed').appendChild(b);
  });
}

/** 顶栏 / 启动卡等静态文案 */
function applyStaticI18n() {
  const set = (id, v) => { const n = $(id); if (n) n.textContent = v; };
  set('libTitle', t('side.library'));
  set('pipeTitle', t('side.pipeline'));
  set('inspDatasetTitle', t('insp.dataset'));
  set('inspStatsTitle', t('insp.describe'));
  set('inspDistTitle', t('insp.dist'));
  set('inspDistCol', t('view.cols'));
  set('statHint', t('insp.followsData'));
  set('codeTitle', t('drawer.pandas'));
  set('btnImport', t('top.import'));
  set('btnDemoLabel', t('top.demo'));
  set('btnUndoLabel', t('top.undo'));
  set('btnResetLabel', t('top.reset'));
  set('tpFrames', t('tp.frames'));
  set('tpSpeedLabel', t('tp.speed'));
  $('dsChip').title = t('top.import');
  $('btnLeft').title = t('top.collapseLeft');
  $('btnRight').title = t('top.collapseRight');
  $('btnTheme').title = t('top.theme');
  $('btnLang').title = t('top.lang');
  $('tpPlay').title = t('tp.play');
  $('tpPrev').title = t('tp.prev');
  $('tpNext').title = t('tp.next');
  $('tpFirst').title = t('tp.first');
  $('tpLast').title = t('tp.last');

  // 主题按钮
  $('themeIcon').innerHTML = '';
  $('themeIcon').appendChild(icon(state.theme === 'dark' ? 'sun' : 'moon', 13));
  set('themeLabel', state.theme === 'dark' ? t('top.light') : t('top.dark'));
  set('langLabel', getLang() === 'zh' ? 'EN' : '中文');

  // 启动卡（关闭后这些节点已被移除，必须判空）
  const bootSub = $('bootSub');
  if (bootSub) {
    set('bootTitle', getLang() === 'zh' ? '熊猫数据流 PandaFlow' : 'PandaFlow');
    bootSub.innerHTML = getLang() === 'zh'
      ? '把 pandas 的每一次数据处理，拆解成看得见的每一步。<br>数据分析功能完整 · 中英双语 · 明暗主题 · 图表与动画实时联动。'
      : 'Every pandas operation broken into visible steps.<br>Full analysis toolkit · bilingual · light &amp; dark · charts linked to the animation.';
    const feats = $('bootFeats');
    feats.innerHTML = '';
    [t('side.ops', { n: OPS.length }), 'ZH / EN', 'Light / Dark', '14 charts'].forEach((x) => {
      feats.appendChild(el('span', { class: 'pill accent' }, [x]));
    });
    set('bootStart', getLang() === 'zh' ? '开始探索' : 'Start exploring');
    set('bootDemoLabel', t('top.demo'));
  }
}

function refreshPalette() {
  buildPalette($('palette'), { onPick: pickOp, activeId: state.activeOpId, df: state.df, ops: OPS, groups: OP_GROUPS, groupLabel: GROUP_LABEL });
}

function renderAll() {
  const df = state.df;
  $('dsName').textContent = df.meta?.title || df.name;
  $('dsMeta').textContent = `${df.nrow} × ${df.ncol}`;
  refreshPalette();
  renderDatasetCard($('inspDataset'), df, state.original);
  renderStatTable($('inspStats'), df);
  refreshChartCols();
  viewPanel.update(df, null);
  viewPanel.refresh();
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
    toast(t('side.needsNumeric'), 'warn', 3200);
    return;
  }
  state.activeOpId = op.id;
  refreshPalette();
  openOpDrawer(op, state.df, { onRun: (o, cfg) => runOp(o, cfg) });
}

function runOp(op, cfg) {
  let out;
  try {
    if (op.needsNumeric && !state.df.columns.some((c) => state.df.dtypes[c] === 'number')) {
      throw new Error(t('common.noNumeric'));
    }
    out = op.run(state.df, { ...cfg, history: state.history, original: state.original });
  } catch (e) {
    console.error(e);
    toast(t('toast.runFailed', { label: pick(op.label), msg: e.message }), 'err', 4200);
    return null;
  }
  if (!out || !out.frames?.length) { toast(t('toast.noFrames'), 'warn'); return null; }

  const before = state.df;
  const after = out.result || before;
  const delta = before.nrow !== after.nrow || before.ncol !== after.ncol
    ? `${before.nrow}×${before.ncol}→${after.nrow}×${after.ncol}`
    : `${after.nrow}r`;

  state.history.push({
    opId: op.id, cfg, frames: out.frames, summary: out.summary, delta,
    label: pick(op.label),
    shapeBefore: [before.nrow, before.ncol],
    shapeAfter: [after.nrow, after.ncol],
  });
  state.df = after;
  state.activeStep = state.history.length - 1;

  renderAll();
  renderPipelinePanel();
  player.load(out.frames);
  player.play();
  toast(`${pick(op.label)} · ${pick(out.summary)}`, 'ok');
  return out;
}

/** 把配置里出现的旧列名替换成新列名（列顺序在两门语言间是一致的） */
function remapCfg(cfg, map) {
  const walk = (v) => {
    if (typeof v === 'string') return map.get(v) ?? v;
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) {
      const o = {};
      for (const [k, x] of Object.entries(v)) o[k] = walk(x);
      return o;
    }
    return v;
  };
  return walk(cfg);
}

function undo() {
  if (!state.history.length) { toast(t('toast.nothingUndo'), 'warn'); return; }
  state.history.pop();
  rebuild();
  toast(t('toast.undone'), 'ok');
}

/** 从原始数据重放剩余步骤 */
function rebuild() {
  state.df = state.original;
  const lang = getLang();
  for (const h of state.history) {
    const op = getOp(h.opId);
    try {
      const out = op.run(state.df, { ...h.cfg, history: [], original: state.original });
      state.df = out.result || state.df;
      h.frames = out.frames;                 // 帧也一并按当前语言重生成
      h.label = pick(op.label);
      h.summary = out.summary;
    } catch (e) { console.error('replay failed', h.opId, e); }
  }
  state.activeStep = state.history.length - 1;
  renderAll();
  renderPipelinePanel();
  if (state.history.length) replayStep(state.activeStep);
  else {
    player.load([]);
    stage.render({ kind: 'none' });
    setNarration('');
    $('stPhase').textContent = t('stage.ready');
    $('stTitle').textContent = t('stage.readyTitle');
    $('stHud').innerHTML = '';
    setCode(null);
  }
}

function resetData() {
  state.df = state.original;
  state.history = [];
  state.activeStep = -1;
  player.load([]);
  renderAll();
  renderPipelinePanel();
  stage.render({ kind: 'none' });
  setNarration('');
  $('stPhase').textContent = t('stage.ready');
  $('stTitle').textContent = t('stage.readyTitle');
  $('stHud').innerHTML = '';
  setCode(null);
  toast(t('toast.reset'), 'ok');
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
  const playing = player.playing;
  $('tpPlayIcon').innerHTML = playing
    ? '<path d="M8 4v16M16 4v16"/>'
    : '<path d="M7 4l12 8-12 8V4z"/>';
  $('tpPlay').classList.toggle('playing', playing);
  $('tpStep').textContent = String(player.index + 1);
  $('tpTotal').textContent = String(player.total);
  if (s === 'end') onSequenceEnd();
};

function renderFrame(f) {
  $('stHead').dataset.tone = f.tone || 'info';
  $('narr').dataset.tone = f.tone || 'info';
  $('stPhase').textContent = pick(f.phase);
  $('stTitle').textContent = pick(f.title);
  $('stHud').innerHTML = '';
  (f.hud || []).forEach((h) => {
    $('stHud').appendChild(el('div', { class: 'hud', data: { tone: h.tone || 'info' } }, [
      el('span', { class: 'k' }, [pick(h.label)]),
      el('span', { class: 'v' }, [pick(h.value)]),
    ]));
  });

  stage.render(localizeStage(f.stage));
  viewPanel.update(f.df || state.df, f.table);
  setNarration(pick(f.narration), f.duration);
  setCode(f.code);

  const p = player.total <= 1 ? 1 : player.index / (player.total - 1);
  $('tpFill').style.width = (p * 100) + '%';
  $('tpStep').textContent = String(player.index + 1);
  $('tpTotal').textContent = String(player.total);

  const marks = $('tpMarks');
  if (marks.dataset.for !== String(player.total)) {
    marks.dataset.for = String(player.total);
    marks.innerHTML = '';
    player.frames.forEach((fr, i) => {
      if (!['gold', 'danger'].includes(fr.tone)) return;
      marks.appendChild(el('div', {
        class: 'tp-mark' + (fr.tone === 'gold' ? ' gold' : ''),
        style: { left: (player.total <= 1 ? 0 : i / (player.total - 1) * 100) + '%' },
        title: pick(fr.title),
      }));
    });
  }
}

/** 舞台 payload 里的双语字段就地解析成当前语言 */
const SKIP_KEYS = new Set(['df', 'frames', 'history', 'original', 'final', 'table']);

function localizeStage(p, depth = 0) {
  if (!p || typeof p !== 'object' || depth > 6) return p;
  if (Array.isArray(p)) return p.map((x) => localizeStage(x, depth + 1));
  // 只处理「纯对象」：DataFrame / DOM 节点 / Map 等一律原样返回
  const proto = Object.getPrototypeOf(p);
  if (proto !== Object.prototype && proto !== null) return p;
  const out = {};
  for (const [k, v] of Object.entries(p)) {
    if (SKIP_KEYS.has(k)) { out[k] = v; continue; }
    if (v && typeof v === 'object' && !Array.isArray(v) &&
        (v.zh !== undefined || v.en !== undefined) && Object.getPrototypeOf(v) === Object.prototype) {
      out[k] = pick(v);
    } else if (v && typeof v === 'object') {
      out[k] = localizeStage(v, depth + 1);
    } else out[k] = v;
  }
  return out;
}

/* 解说：按句渐进揭示 */
let narrTimer = null;
function setNarration(text, duration = 1200) {
  const host = $('narrText');
  clearTimeout(narrTimer);
  if (!text) { host.innerHTML = ''; return; }
  const parts = String(text).split(/(?<=[。；！？.!?])\s*/).filter((s) => s.trim());
  const step = clamp((duration || 1200) * 0.4 / Math.max(1, parts.length), 60, 300);
  host.innerHTML = '';
  parts.forEach((s, i) => {
    const span = el('span', { html: mark(s) + (i === parts.length - 1 ? '<span class="caret"></span>' : '') });
    span.style.animation = 'fadeUp .4s cubic-bezier(.16,1,.3,1) both';
    span.style.animationDelay = (i * step) + 'ms';
    host.appendChild(span);
  });
}

const KW = /(?<![\w.])(df\.\w+|idxmax|idxmin|dropna|fillna|interpolate|drop_duplicates|duplicated|groupby|describe|value_counts|sort_values|sort_index|reset_index|astype|nlargest|nsmallest|clip|drop|sample|head|tail|info|query|assign|rename|to_csv|isnull|sum|mean|median|std|min|max|NaN|True|False|axis|subset|keep|ascending|random_state|skipna|ddof|IQR|Q1|Q3|loc|iloc|merge|concat|pivot_table|melt|crosstab|rolling|shift|diff|pct_change|cumsum|rank|qcut|cut|where|apply|str|contains|replace|split|upper|len|isin|select_dtypes|insert|pop|set_index|corr|cov|how|inner|left|right|outer)(?![\w])/g;

function mark(txt) {
  return String(txt)
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
      el('span', { class: 'code-tx code-cm' }, [t('code.placeholder')]),
    ]));
    body.dataset.sig = '';
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
function demoScript() {
  const df = state.original;
  const num = df.columns.find((c) => df.dtypes[c] === 'number');
  const cat = df.meta?.categoryCol || df.columns.find((c) => df.dtypes[c] !== 'number');
  return [
    { op: 'info' },
    { op: 'drop_duplicates' },
    { op: 'drop_extremes', cfg: { col: num, mode: 'both' } },
    { op: 'fillna', cfg: { col: df.columns.find((c) => Object.values(df.nullCounts())[df.columns.indexOf(c)] > 0) || num, strategy: 'mean' } },
    { op: 'describe' },
    { op: 'hist', cfg: { col: num } },
    { op: 'groupby', cfg: { by: cat, target: num, fn: 'mean' } },
    { op: 'export' },
  ];
}

function startAutoDemo() {
  resetData();
  state.autoRun = demoScript();
  player.setSpeed(2.5);
  if (![...$('tpSpeed').children].some((n) => n.textContent === '2.5×')) {
    const b = el('button', {
      class: 'speed-pill', onclick: () => {
        player.setSpeed(2.5);
        [...$('tpSpeed').children].forEach((n) => n.classList.toggle('on', n === b));
      },
    }, ['2.5×']);
    $('tpSpeed').appendChild(b);
  }
  [...$('tpSpeed').children].forEach((n) => n.classList.toggle('on', n.textContent === '2.5×'));
  toast(t('toast.autoStart'), 'ok', 3200);
  nextAutoStep();
}

function nextAutoStep() {
  if (!state.autoRun) return;
  const step = state.autoRun.shift();
  if (!step) {
    state.autoRun = null;
    player.setSpeed(1);
    [...$('tpSpeed').children].forEach((n) => n.classList.toggle('on', n.textContent === '1×'));
    toast(t('toast.autoEnd', { n: 8 }), 'ok', 4000);
    return;
  }
  const op = getOp(step.op);
  if (!op) { nextAutoStep(); return; }
  const cfg = step.cfg || autoParams(op, state.df);
  setTimeout(() => runOp(op, cfg), 650);
}

function onSequenceEnd() { if (state.autoRun) nextAutoStep(); }

/* ============================== 事件 ============================== */
$('dsChip').addEventListener('click', () => openImportDrawer(state.specId, {
  onLoad: (df, label, specId) => {
    state.original = df;
    state.df = df;
    state.history = [];
    state.activeStep = -1;
    state.specId = specId || null;
    player.load([]);
    renderAll();
    renderPipelinePanel();
    stage.render({ kind: 'none' });
    setNarration(getLang() === 'zh'
      ? `已加载「${label}」：${df.nrow} 行 × ${df.ncol} 列。从左侧操作库选一个操作开始逐步演示。`
      : `Loaded "${label}": ${df.nrow} rows × ${df.ncol} columns. Pick an operation on the left to begin.`);
    $('stPhase').textContent = t('stage.ready');
    $('stTitle').textContent = label;
    $('stHud').innerHTML = '';
    setCode(null);
    toast(t('imp.loaded', { name: label, r: df.nrow, c: df.ncol }), 'ok');
  },
}));

$('btnImport').addEventListener('click', () => $('dsChip').click());
$('btnReset').addEventListener('click', resetData);
$('btnUndo').addEventListener('click', undo);
$('btnDemo').addEventListener('click', startAutoDemo);

$('btnTheme').addEventListener('click', () => {
  state.theme = state.theme === 'dark' ? 'light' : 'dark';
  applyTheme(state.theme);
  applyStaticI18n();
  viewPanel.refresh();
  toast(t('toast.themeSwitched', { name: state.theme === 'dark' ? t('top.dark') : t('top.light') }), 'ok', 1800);
});

$('btnLang').addEventListener('click', () => {
  const next = getLang() === 'zh' ? 'en' : 'zh';
  setLang(next);
  applyStaticI18n();
  // 内置数据集重建为对应语言的列名；导入的数据保持原样
  if (state.specId) {
    const spec = specById(state.specId);
    if (spec) {
      const oldCols = state.original.columns.slice();
      const rebuilt = makeSpec(state.specId);
      const remap = new Map(oldCols.map((c, i) => [c, rebuilt.columns[i]]));
      // 管道里存的是上一门语言的列名，必须同步翻译，否则重放会 KeyError
      state.history.forEach((h) => { h.cfg = remapCfg(h.cfg, remap); });
      state.original = rebuilt;
    }
  }
  rebuild();
  toast(t('toast.langSwitched'), 'ok', 1800);
});

$('btnLeft').addEventListener('click', () => $('app').classList.toggle('collapse-left'));
$('btnRight').addEventListener('click', () => $('app').classList.toggle('collapse-right'));

$('tpPlay').addEventListener('click', () => player.toggle());
$('tpPrev').addEventListener('click', () => { player.pause(); player.prev(); });
$('tpNext').addEventListener('click', () => { player.pause(); player.next(); });
$('tpFirst').addEventListener('click', () => { player.pause(); player.seek(0); });
$('tpLast').addEventListener('click', () => { player.pause(); player.seek(player.total - 1); });

$('tpTrack').addEventListener('click', (e) => {
  const r = e.currentTarget.getBoundingClientRect();
  const ratio = clamp((e.clientX - r.left) / r.width, 0, 1);
  player.pause();
  player.seek(Math.round(ratio * (player.total - 1)));
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
  setTimeout(() => $('boot').remove(), 600);
});
$('bootDemo').addEventListener('click', () => {
  $('boot').classList.add('off');
  setTimeout(() => $('boot').remove(), 600);
  setTimeout(startAutoDemo, 400);
});

/* 语言变化时刷新依赖语言的 UI */
onLangChange(() => { applyStaticI18n(); viewPanel.refresh(); });

/* ============================== 启动 ============================== */
boot();
window.__PF__ = { state, player, stage, viewPanel, runOp, getOp, autoParams, setLang, applyTheme };
