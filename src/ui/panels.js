/* ------------------------------------------------------------------
 * ui/panels.js — 侧栏 / 抽屉 / 提示 等界面模块
 * ------------------------------------------------------------------ */

import { el, clear, fmt } from '../core/utils.js';
import { icon } from './icons.js';
import { OP_GROUPS, autoParams } from '../core/ops/index.js';
import { BUILTIN_DATASETS } from '../core/datasets.js';

/* ============================== 提示 ============================== */
let toastHost = null;
export function toast(msg, type = 'ok', ms = 2600) {
  if (!toastHost) {
    toastHost = el('div', { class: 'toasts' });
    document.body.appendChild(toastHost);
  }
  const ic = { ok: 'check', warn: 'alert', err: 'x', info: 'info' }[type] || 'info';
  const node = el('div', { class: `toast ${type}` }, [icon(ic, 15), el('span', {}, [msg])]);
  toastHost.appendChild(node);
  // 最多同时显示 3 条，多了就把最早的挤掉
  while (toastHost.children.length > 3) {
    const old = toastHost.firstElementChild;
    old.classList.add('out');
    setTimeout(() => old.remove(), 320);
    toastHost.removeChild(old);
  }
  setTimeout(() => {
    node.classList.add('out');
    setTimeout(() => node.remove(), 320);
  }, ms);
}

/* ============================== 操作库 ============================== */
export function buildPalette(host, { onPick, activeId, df, ops }) {
  clear(host);
  const hasNum = !!df && df.columns.some((c) => df.dtypes[c] === 'number');
  const byGroup = (g) => (ops || []).filter((o) => o.group === g);
  const openState = host._open || (host._open = { 概览: true, 清洗: true, 变换: true, 统计: false, 可视化: false, 导出: false });

  OP_GROUPS.forEach((group) => {
    const groupOps = byGroup(group);
    if (!groupOps.length) return;
    const isOpen = !!openState[group];
    const list = el('div', { class: 'op-group-list' });
    groupOps.forEach((op) => {
      const disabled = op.needsNumeric && !hasNum;
      const item = el('div', {
        class: 'op-item' + (op.highlight ? ' highlight' : '') + (op.id === activeId ? ' active' : '')
          + (disabled ? ' disabled' : ''),
        data: { op: op.id },
        title: disabled ? '当前数据没有数值列，该操作不可用' : op.desc,
        onclick: () => onPick(op, disabled),
      }, [
        el('div', { class: 'op-icon' }, [icon(op.icon, 13)]),
        el('div', { class: 'op-body' }, [
          el('div', { class: 'op-name' }, [el('code', {}, [op.label])]),
          el('div', { class: 'op-desc' }, [op.desc]),
        ]),
        op.highlight ? el('div', { class: 'op-star' }, ['★']) : null,
        disabled ? el('div', { class: 'op-na' }, ['不可用']) : null,
      ]);
      list.appendChild(item);
    });
    if (!isOpen) list.style.display = 'none';

    const head = el('div', { class: 'op-group-head', onclick: () => {
      openState[group] = !openState[group];
      list.style.display = openState[group] ? '' : 'none';
      wrap.classList.toggle('open', openState[group]);
    } }, [
      el('div', { class: 'op-group-chev' }, [icon('chevron', 12)]),
      el('div', { class: 'op-group-name' }, [group]),
      el('div', { class: 'op-group-count' }, [String(groupOps.length)]),
    ]);
    const wrap = el('div', { class: 'op-group' + (isOpen ? ' open' : '') }, [head, list]);
    host.appendChild(wrap);
  });
}

/* ============================== 管道 ============================== */
export function renderPipeline(host, steps, activeIndex, onSelect) {
  clear(host);
  if (!steps.length) {
    host.appendChild(el('div', { class: 'pipe-empty' }, [
      '还没有任何处理步骤',
      el('br'),
      '每次运行操作都会在这里留下可回放的记录',
    ]));
    return;
  }
  steps.forEach((s, i) => {
    host.appendChild(el('div', {
      class: 'pipe-step' + (i === activeIndex ? ' active' : (i < activeIndex ? ' done' : '')),
      style: { animationDelay: (i * 40) + 'ms' },
      onclick: () => onSelect(i),
      title: s.summary,
    }, [
      el('span', { class: 'pipe-n' }, [String(i + 1)]),
      el('span', { class: 'pipe-label' }, [s.label]),
      el('span', { class: 'pipe-delta' }, [s.delta || '']),
    ]));
  });
}

/* ============================== 检查器 ============================== */
export function renderDatasetCard(host, df, original) {
  clear(host);
  const meta = df.meta || {};
  const nulls = df.nullCounts();
  const totalNull = Object.values(nulls).reduce((a, b) => a + b, 0);
  const numCols = df.columns.filter((c) => df.dtypes[c] === 'number');
  const changed = original && (original.nrow !== df.nrow || original.ncol !== df.ncol);

  host.appendChild(el('div', { class: 'ds-card' }, [
    el('div', { class: 'ds-title' }, [meta.title || df.name]),
    el('div', { class: 'ds-sub' }, [meta.subtitle || df.source || '']),
    el('div', { class: 'ds-badges' }, [
      el('span', { class: 'badge cyan' }, [el('b', {}, [String(df.nrow)]), ' 行']),
      el('span', { class: 'badge cyan' }, [el('b', {}, [String(df.ncol)]), ' 列']),
      el('span', { class: 'badge' }, [el('b', {}, [String(numCols.length)]), ' 数值列']),
      totalNull
        ? el('span', { class: 'badge rose' }, [el('b', {}, [String(totalNull)]), ' 缺失'])
        : el('span', { class: 'badge emerald' }, ['无缺失']),
      changed ? el('span', { class: 'badge' }, [`原始 ${original.nrow}×${original.ncol}`]) : null,
    ]),
    meta.dict ? el('div', { class: 'ds-dict' }, Object.entries(meta.dict).map(([k, v]) =>
      el('div', { class: 'ds-dict-row' }, [el('span', { class: 'k' }, [k]), el('span', { class: 'v' }, [v])])
    )) : null,
  ]));
}

export function renderStatTable(host, df) {
  clear(host);
  const cols = df.columns.filter((c) => df.dtypes[c] === 'number');
  if (!cols.length) {
    host.appendChild(el('div', { class: 'pipe-empty' }, ['当前数据没有数值列']));
    return;
  }
  const desc = df.describe();
  const tb = el('table', { class: 'stat-table' });
  tb.appendChild(el('thead', {}, [el('tr', {}, [
    el('th', {}, ['']), ...cols.map((c) => el('th', {}, [c])),
  ])]));
  const body = el('tbody');
  desc.index.forEach((r) => {
    body.appendChild(el('tr', {}, [
      el('td', {}, [r]),
      ...cols.map((c) => {
        const v = desc.data[c][r];
        return el('td', { class: r === 'mean' ? 'hi' : '' }, [r === 'count' ? String(v) : fmt(v, 2)]);
      }),
    ]));
  });
  tb.appendChild(body);
  host.appendChild(tb);
}

/* ============================== 配置抽屉 ============================== */
export function openOpDrawer(op, df, { onRun, onClose }) {
  const mask = el('div', { class: 'drawer-mask' });
  const drawer = el('div', { class: 'drawer' });
  const state = autoParams(op, df);

  const head = el('div', { class: 'drawer-head' }, [
    el('div', { class: 'drawer-icon' }, [icon(op.icon, 17)]),
    el('div', { class: 'st-grow' }, [
      el('div', { class: 'drawer-title' }, [op.label]),
      el('div', { class: 'drawer-desc' }, [op.desc]),
    ]),
    el('button', { class: 'btn ghost icon sm', onclick: close }, [icon('x', 14)]),
  ]);

  const body = el('div', { class: 'drawer-body' });
  const errors = {};

  (op.params || []).forEach((p) => {
    const field = el('div', { class: 'field' });
    field.appendChild(el('div', { class: 'field-label' }, [
      p.label,
      p.required ? el('span', { class: 'req' }, ['*']) : null,
    ]));
    let ctrl;
    if (p.type === 'column') ctrl = columnPicker(df, p, state, () => validate());
    else if (p.type === 'columns') ctrl = multiPicker(df, p, state);
    else if (p.type === 'select') ctrl = selectCtrl(p, state);
    else if (p.type === 'number') ctrl = numberCtrl(p, state);
    else if (p.type === 'text') ctrl = textCtrl(p, state);
    else if (p.type === 'rename') ctrl = renameCtrl(df, p, state);
    field.appendChild(ctrl);
    if (p.hint) field.appendChild(el('div', { class: 'field-hint' }, [p.hint]));
    const errNode = el('div', { class: 'field-error', style: { display: 'none' } });
    field.appendChild(errNode);
    errors[p.key] = errNode;
    body.appendChild(field);
  });

  if (!(op.params || []).length) {
    body.appendChild(el('div', { class: 'field-hint' }, ['该操作无需参数，直接运行即可。']));
  }

  const runBtn = el('button', { class: 'btn primary', onclick: () => doRun() }, [icon('play', 13), '运行并演示']);
  const foot = el('div', { class: 'drawer-foot' }, [
    el('span', { class: 'grow' }),
    el('button', { class: 'btn ghost', onclick: close }, ['取消']),
    runBtn,
  ]);

  drawer.append(head, el('div', { class: 'drawer-pandas' }, [op.pandas]), body, foot);
  document.body.append(mask, drawer);
  requestAnimationFrame(() => { mask.classList.add('on'); drawer.classList.add('on'); });

  function validate() {
    let ok = true;
    for (const p of op.params || []) {
      if (!p.required) continue;
      const v = state[p.key];
      const bad = v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length) ||
        (p.type === 'rename' && (!v || !Object.keys(v).length));
      errors[p.key].style.display = bad ? '' : 'none';
      errors[p.key].textContent = bad ? `请填写「${p.label}」` : '';
      if (bad) ok = false;
    }
    return ok;
  }

  function doRun() {
    if (!validate()) return;
    close();
    onRun(op, state);
  }

  function close() {
    mask.classList.remove('on');
    drawer.classList.remove('on');
    setTimeout(() => { mask.remove(); drawer.remove(); }, 440);
  }
  mask.addEventListener('click', close);
  document.addEventListener('keydown', function esc(e) {
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); }
  });
  setTimeout(() => validate(), 60);
}

/* ------------------------- 表单控件 ------------------------- */
function columnPicker(df, p, state, onChange) {
  const pool = df.columns.filter((c) => (p.filter === 'number' ? df.dtypes[c] === 'number' : true));
  if (!pool.length) return el('div', { class: 'field-hint' }, ['没有符合条件的列']);
  if (!pool.includes(state[p.key])) state[p.key] = pool[0];
  const wrap = el('div', { class: 'chip-picker' });
  pool.forEach((c) => {
    const on = () => state[p.key] === c;
    const chip = el('div', { class: 'chip' + (on() ? ' on' : ''), onclick: () => {
      state[p.key] = c;
      [...wrap.children].forEach((n) => n.classList.toggle('on', n.dataset.c === c));
      onChange?.();
    }, data: { c } }, [
      c,
      el('span', { class: 't' }, [df.dtypes[c] === 'number' ? 'num' : 'obj']),
    ]);
    wrap.appendChild(chip);
  });
  return wrap;
}

function multiPicker(df, p, state) {
  if (!Array.isArray(state[p.key])) state[p.key] = [];
  const wrap = el('div', { class: 'chip-picker' });
  df.columns.forEach((c) => {
    const chip = el('div', {
      class: 'chip' + (state[p.key].includes(c) ? ' on' : ''),
      onclick: () => {
        const i = state[p.key].indexOf(c);
        if (i >= 0) state[p.key].splice(i, 1); else state[p.key].push(c);
        chip.classList.toggle('on');
      },
    }, [c]);
    wrap.appendChild(chip);
  });
  return wrap;
}

function selectCtrl(p, state) {
  const s = el('select', { class: 'sel' });
  (p.options || []).forEach((o) => {
    const opt = el('option', { value: o.v }, [o.l]);
    if (String(state[p.key]) === String(o.v)) opt.selected = true;
    s.appendChild(opt);
  });
  s.addEventListener('change', () => { state[p.key] = s.value; });
  return s;
}

function numberCtrl(p, state) {
  const i = el('input', {
    class: 'inp', type: 'number',
    placeholder: p.hint ? '自动' : '',
    value: state[p.key] === null || state[p.key] === undefined ? '' : state[p.key],
    min: p.min, max: p.max,
  });
  i.addEventListener('input', () => {
    state[p.key] = i.value === '' ? null : Number(i.value);
  });
  return i;
}

function textCtrl(p, state) {
  const i = el('input', { class: 'inp', type: 'text', value: state[p.key] || '', placeholder: '自动命名' });
  i.addEventListener('input', () => { state[p.key] = i.value; });
  return i;
}

function renameCtrl(df, p, state) {
  const wrap = el('div', { class: 'rename-list' });
  df.columns.forEach((c) => {
    const inp = el('input', { class: 'inp', type: 'text', placeholder: c, value: state[p.key]?.[c] || '' });
    inp.addEventListener('input', () => {
      state[p.key] = state[p.key] || {};
      if (inp.value.trim()) state[p.key][c] = inp.value.trim();
      else delete state[p.key][c];
    });
    wrap.appendChild(el('div', { class: 'rename-row' }, [
      el('span', { class: 'pill' }, [c]),
      el('span', { class: 'arrow' }, ['→']),
      inp,
      el('span'),
    ]));
  });
  return wrap;
}

/* ============================== 导入抽屉 ============================== */
export function openImportDrawer(current, { onLoad, onClose }) {
  const mask = el('div', { class: 'drawer-mask' });
  const drawer = el('div', { class: 'drawer' });

  const head = el('div', { class: 'drawer-head' }, [
    el('div', { class: 'drawer-icon' }, [icon('database', 17)]),
    el('div', { class: 'st-grow' }, [
      el('div', { class: 'drawer-title' }, ['数据集']),
      el('div', { class: 'drawer-desc' }, ['使用内置数据集，或导入你自己的 CSV / TSV / JSON']),
    ]),
    el('button', { class: 'btn ghost icon sm', onclick: close }, [icon('x', 14)]),
  ]);

  const body = el('div', { class: 'drawer-body' });

  // 内置数据集
  body.appendChild(el('div', { class: 'field-label' }, ['内置数据集']));
  const list = el('div', { style: { display: 'grid', gap: '7px' } });
  BUILTIN_DATASETS.forEach((d) => {
    list.appendChild(el('button', {
      class: 'ds-option' + (current === d.id ? ' on' : ''),
      onclick: () => { close(); onLoad(d.make(), d.label); },
    }, [
      el('div', { class: 'ic' }, [icon('table', 14)]),
      el('div', { class: 'st-grow' }, [
        el('div', { class: 't' }, [d.label]),
        el('div', { class: 'h' }, [d.hint]),
      ]),
      current === d.id ? icon('check', 15) : null,
    ]));
  });
  body.appendChild(list);

  // 文件导入
  body.appendChild(el('div', { class: 'field-label', style: { marginTop: '8px' } }, ['导入文件']));
  const fileInput = el('input', { type: 'file', accept: '.csv,.tsv,.txt,.json', style: { display: 'none' } });
  const dz = el('div', { class: 'dropzone', onclick: () => fileInput.click() }, [
    icon('upload', 26),
    el('div', { class: 'dropzone-title' }, ['点击选择，或把文件拖到这里']),
    el('div', { class: 'dropzone-sub' }, ['支持 .csv / .tsv / .txt / .json　·　自动识别分隔符与列类型　·　全程在浏览器本地解析']),
  ]);
  dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('over'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('over'));
  dz.addEventListener('drop', (e) => {
    e.preventDefault(); dz.classList.remove('over');
    const f = e.dataTransfer.files?.[0];
    if (f) handleFile(f);
  });
  fileInput.addEventListener('change', () => { if (fileInput.files?.[0]) handleFile(fileInput.files[0]); });
  body.append(dz, fileInput);

  // 粘贴
  body.appendChild(el('div', { class: 'field-label', style: { marginTop: '8px' } }, ['或直接粘贴 CSV 文本']));
  const ta = el('textarea', { class: 'paste', placeholder: '姓名,数学,英语\n张三,88,92\n李四,76,85' });
  const pasteBtn = el('button', { class: 'btn', style: { marginTop: '7px' }, onclick: () => {
    const text = ta.value.trim();
    if (!text) { toast('先粘贴一些 CSV 文本', 'warn'); return; }
    try {
      const { df, warnings } = parseText(text);
      close();
      onLoad(df, '粘贴导入');
      warnings.forEach((w) => toast(w, 'warn'));
    } catch (e) { toast('解析失败：' + e.message, 'err'); }
  } }, [icon('check', 13), '解析并加载']);
  body.append(ta, pasteBtn);

  const foot = el('div', { class: 'drawer-foot' }, [
    el('span', { class: 'grow' }),
    el('button', { class: 'btn ghost', onclick: close }, ['关闭']),
  ]);

  drawer.append(head, body, foot);
  document.body.append(mask, drawer);
  requestAnimationFrame(() => { mask.classList.add('on'); drawer.classList.add('on'); });

  async function handleFile(file) {
    try {
      const { readFile } = await import('../core/csv.js');
      const { df, warnings } = await readFile(file);
      close();
      onLoad(df, file.name);
      warnings.forEach((w) => toast(w, 'warn'));
    } catch (e) {
      toast('导入失败：' + e.message, 'err');
    }
  }

  function close() {
    mask.classList.remove('on');
    drawer.classList.remove('on');
    setTimeout(() => { mask.remove(); drawer.remove(); }, 440);
  }
  mask.addEventListener('click', close);
}

let _parseCSV = null;
function parseText(t) {
  // 同步解析（此处已加载模块）
  return _parseCSV(t, { source: '粘贴导入' });
}
export function injectCSVParser(fn) { _parseCSV = fn; }

/* ============================== 迷你图表 ============================== */
export function renderMiniChart(host, df, col) {
  clear(host);
  if (!col || df.dtypes[col] !== 'number') {
    host.appendChild(el('div', { class: 'field-hint', style: { padding: '10px 13px' } }, ['选择一个数值列查看分布']));
    return;
  }
  const nums = df.numCol(col);
  const h = df.hist(col, 14);
  const max = Math.max(1, ...h.counts);
  const W = 260, H = 60;
  const peak = h.counts.indexOf(Math.max(...h.counts));
  const bars = h.counts.map((c, i) => el('i', {
    class: 'mh-bar' + (i === peak ? ' peak' : ''),
    title: `${fmt(h.edges[i])} – ${fmt(h.edges[i + 1])}：${c} 个`,
    style: {
      height: Math.max(2, c / max * H) + 'px',
      width: Math.max(1, W / h.counts.length - 2) + 'px',
    },
  }));
  const box = el('div', { style: { display: 'flex', alignItems: 'flex-end', gap: '2px', height: H + 'px' } }, bars);
  host.appendChild(el('div', { class: 'mini-chart' }, [
    el('div', { class: 'st-row', style: { justifyContent: 'space-between', marginBottom: '6px' } }, [
      el('span', { class: 'pill cyan' }, [col]),
      el('span', { class: 'pill' }, [`n=${nums.length}　x̄=${fmt(nums.reduce((a, b) => a + b, 0) / (nums.length || 1))}`]),
    ]),
    box,
    el('div', { class: 'st-row', style: { justifyContent: 'space-between', marginTop: '5px' } }, [
      el('span', { class: 'field-hint' }, [fmt(h.min)]),
      el('span', { class: 'field-hint' }, [`${h.counts.length} 箱`]),
      el('span', { class: 'field-hint' }, [fmt(h.max)]),
    ]),
  ]));
}
