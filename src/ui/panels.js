/* ------------------------------------------------------------------
 * ui/panels.js — 侧栏 / 抽屉 / 提示 等界面模块（全双语）
 * ------------------------------------------------------------------ */

import { el, clear, fmt } from '../core/utils.js';
import { L, pick, getLang, t } from '../i18n/index.js';
import { icon } from './icons.js';
import { autoParams } from '../core/ops/index.js';
import { BUILTIN_DATASETS } from '../core/datasets.js';

/* ============================== 提示 ============================== */
let toastHost = null;
export function toast(msg, type = 'ok', ms = 2600) {
  if (!toastHost || !toastHost.isConnected) {
    toastHost = el('div', { class: 'toasts' });
    document.body.appendChild(toastHost);
  }
  const ic = { ok: 'check', warn: 'alert', err: 'x', info: 'info' }[type] || 'info';
  const node = el('div', { class: `toast ${type}` }, [icon(ic, 14), el('span', {}, [pick(msg)])]);
  toastHost.appendChild(node);
  while (toastHost.children.length > 3) {
    const old = toastHost.firstElementChild;
    old.classList.add('out');
    setTimeout(() => old.remove(), 300);
    toastHost.removeChild(old);
  }
  setTimeout(() => {
    node.classList.add('out');
    setTimeout(() => node.remove(), 300);
  }, ms);
}

/* ============================== 操作库 ============================== */
export function buildPalette(host, { onPick, activeId, df, ops, groups, groupLabel }) {
  const openState = host._open || (host._open = {});
  const hasNum = !!df && df.columns.some((c) => df.dtypes[c] === 'number');
  clear(host);

  (groups || []).forEach((g) => {
    const list = (ops || []).filter((o) => o.group === g);
    if (!list.length) return;
    if (openState[g] === undefined) openState[g] = ['overview', 'clean'].includes(g);
    const isOpen = !!openState[g];

    const listNode = el('div', { class: 'op-group-list' });
    list.forEach((op) => {
      const disabled = op.needsNumeric && !hasNum;
      listNode.appendChild(el('div', {
        class: 'op-item' + (op.highlight ? ' highlight' : '') + (op.id === activeId ? ' active' : '') + (disabled ? ' disabled' : ''),
        data: { op: op.id },
        title: disabled ? t('side.needsNumeric') : pick(op.desc),
        onclick: () => onPick(op, disabled),
      }, [
        el('div', { class: 'op-icon' }, [icon(op.icon, 12)]),
        el('div', { class: 'op-body' }, [
          el('div', { class: 'op-name' }, [el('code', {}, [pick(op.label)])]),
          el('div', { class: 'op-desc' }, [pick(op.desc)]),
        ]),
        op.highlight ? el('div', { class: 'op-star' }, ['★']) : null,
        disabled ? el('div', { class: 'op-na' }, [t('side.unavailable')]) : null,
      ]));
    });
    if (!isOpen) listNode.style.display = 'none';

    const head = el('div', {
      class: 'op-group-head',
      onclick: () => {
        openState[g] = !openState[g];
        listNode.style.display = openState[g] ? '' : 'none';
        wrap.classList.toggle('open', openState[g]);
      },
    }, [
      el('div', { class: 'op-group-chev' }, [icon('chevron', 11)]),
      el('div', { class: 'op-group-name' }, [pick(groupLabel[g])]),
      el('div', { class: 'op-group-count' }, [String(list.length)]),
    ]);
    const wrap = el('div', { class: 'op-group' + (isOpen ? ' open' : '') }, [head, listNode]);
    host.appendChild(wrap);
  });
}

/* ============================== 管道 ============================== */
export function renderPipeline(host, steps, activeIndex, onSelect) {
  clear(host);
  if (!steps.length) {
    host.appendChild(el('div', { class: 'pipe-empty' }, [
      t('side.pipelineEmpty'), el('br'), t('side.pipelineHint'),
    ]));
    return;
  }
  steps.forEach((s, i) => {
    host.appendChild(el('div', {
      class: 'pipe-step' + (i === activeIndex ? ' active' : (i < activeIndex ? ' done' : '')),
      style: { animationDelay: (i * 35) + 'ms' },
      onclick: () => onSelect(i),
      title: pick(s.summary),
    }, [
      el('span', { class: 'pipe-n' }, [String(i + 1)]),
      el('span', { class: 'pipe-label' }, [pick(s.label)]),
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
    el('div', { class: 'ds-title' }, [pick(meta.title) || df.name]),
    el('div', { class: 'ds-sub' }, [pick(meta.subtitle) || pick(df.source) || '']),
    el('div', { class: 'ds-badges' }, [
      el('span', { class: 'badge cyan' }, [el('b', {}, [String(df.nrow)]), ` ${t('insp.rows')}`]),
      el('span', { class: 'badge cyan' }, [el('b', {}, [String(df.ncol)]), ` ${t('insp.cols')}`]),
      el('span', { class: 'badge' }, [el('b', {}, [String(numCols.length)]), ` ${t('insp.numeric')}`]),
      totalNull
        ? el('span', { class: 'badge rose' }, [el('b', {}, [String(totalNull)]), ` ${t('insp.missing')}`])
        : el('span', { class: 'badge emerald' }, [t('insp.noMissing')]),
      changed ? el('span', { class: 'badge' }, [t('insp.original', { r: original.nrow, c: original.ncol })]) : null,
    ]),
    meta.dict ? el('div', { class: 'ds-dict' }, Object.entries(meta.dict).map(([k, v]) =>
      el('div', { class: 'ds-dict-row' }, [el('span', { class: 'k' }, [k]), el('span', { class: 'v' }, [pick(v)])])
    )) : null,
  ]));
}

export function renderStatTable(host, df) {
  clear(host);
  const cols = df.columns.filter((c) => df.dtypes[c] === 'number');
  if (!cols.length) {
    host.appendChild(el('div', { class: 'pipe-empty' }, [t('common.noNumeric')]));
    return;
  }
  const desc = df.describe();
  const tb = el('table', { class: 'stat-table' });
  tb.appendChild(el('thead', {}, [el('tr', {}, [el('th', {}, ['']), ...cols.map((c) => el('th', {}, [c]))])]));
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
export function openOpDrawer(op, df, { onRun }) {
  const mask = el('div', { class: 'drawer-mask' });
  const drawer = el('div', { class: 'drawer' });
  const state = autoParams(op, df);
  const errors = {};

  const head = el('div', { class: 'drawer-head' }, [
    el('div', { class: 'drawer-icon' }, [icon(op.icon, 16)]),
    el('div', { class: 'grow' }, [
      el('div', { class: 'drawer-title' }, [pick(op.label)]),
      el('div', { class: 'drawer-desc' }, [pick(op.desc)]),
    ]),
    el('button', { class: 'btn ghost icon sm', onclick: close }, [icon('x', 14)]),
  ]);

  const body = el('div', { class: 'drawer-body' });
  (op.params || []).forEach((p) => {
    const field = el('div', { class: 'field' });
    field.appendChild(el('div', { class: 'field-label' }, [
      pick(p.label), p.required ? el('span', { class: 'req' }, ['*']) : null,
    ]));
    let ctrl;
    if (p.type === 'column') ctrl = columnPicker(df, p, state, validate);
    else if (p.type === 'columns') ctrl = multiPicker(df, p, state);
    else if (p.type === 'select') ctrl = selectCtrl(p, state);
    else if (p.type === 'number') ctrl = numberCtrl(p, state);
    else if (p.type === 'text') ctrl = textCtrl(p, state);
    else if (p.type === 'rename') ctrl = renameCtrl(df, p, state);
    field.appendChild(ctrl);
    if (p.hint) field.appendChild(el('div', { class: 'field-hint' }, [pick(p.hint)]));
    const errNode = el('div', { class: 'field-error', style: { display: 'none' } });
    field.appendChild(errNode);
    errors[p.key] = errNode;
    body.appendChild(field);
  });
  if (!(op.params || []).length) {
    body.appendChild(el('div', { class: 'field-hint' }, [t('drawer.noParams')]));
  }

  const foot = el('div', { class: 'drawer-foot' }, [
    el('span', { class: 'grow' }),
    el('button', { class: 'btn ghost', onclick: close }, [t('drawer.cancel')]),
    el('button', { class: 'btn primary', onclick: () => { if (validate()) { close(); onRun(op, state); } } },
      [icon('play', 13), t('drawer.run')]),
  ]);

  drawer.append(head, el('div', { class: 'drawer-pandas' }, [op.pandas]), body, foot);
  document.body.append(mask, drawer);
  requestAnimationFrame(() => { mask.classList.add('on'); drawer.classList.add('on'); });

  function validate() {
    let ok = true;
    for (const p of op.params || []) {
      if (!p.required) continue;
      const v = state[p.key];
      const bad = v === undefined || v === null || v === '' ||
        (Array.isArray(v) && !v.length) ||
        (p.type === 'rename' && (!v || !Object.keys(v).length));
      errors[p.key].style.display = bad ? '' : 'none';
      errors[p.key].textContent = bad ? t('drawer.required', { label: pick(p.label) }) : '';
      if (bad) ok = false;
    }
    return ok;
  }

  function close() {
    mask.classList.remove('on');
    drawer.classList.remove('on');
    setTimeout(() => { mask.remove(); drawer.remove(); }, 380);
  }
  mask.addEventListener('click', close);
  document.addEventListener('keydown', function esc(e) {
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); }
  });
  setTimeout(validate, 50);
}

function columnPicker(df, p, state, onChange) {
  const pool = df.columns.filter((c) => (p.filter === 'number' ? df.dtypes[c] === 'number' : true));
  if (!pool.length) return el('div', { class: 'field-hint' }, [t('common.noNumeric')]);
  if (!pool.includes(state[p.key])) state[p.key] = pool[0];
  const wrap = el('div', { class: 'chip-picker' });
  pool.forEach((c) => {
    wrap.appendChild(el('div', {
      class: 'chip' + (state[p.key] === c ? ' on' : ''),
      data: { c },
      onclick: () => {
        state[p.key] = c;
        [...wrap.children].forEach((n) => n.classList.toggle('on', n.dataset.c === c));
        onChange?.();
      },
    }, [c, el('span', { class: 't' }, [df.dtypes[c] === 'number' ? 'num' : 'obj'])]));
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
    const opt = el('option', { value: o.v }, [pick(o.l)]);
    if (String(state[p.key]) === String(o.v)) opt.selected = true;
    s.appendChild(opt);
  });
  s.addEventListener('change', () => { state[p.key] = s.value; });
  return s;
}

function numberCtrl(p, state) {
  const i = el('input', {
    class: 'inp', type: 'number',
    placeholder: p.hint ? pick(p.hint) : '',
    value: state[p.key] === null || state[p.key] === undefined ? '' : state[p.key],
    min: p.min, max: p.max,
  });
  i.addEventListener('input', () => { state[p.key] = i.value === '' ? null : Number(i.value); });
  return i;
}

function textCtrl(p, state) {
  const i = el('input', { class: 'inp', type: 'text', value: state[p.key] || '', placeholder: t('drawer.autoName') });
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
      el('span', { class: 'pill' }, [c]), el('span', { class: 'arrow' }, ['→']), inp,
    ]));
  });
  return wrap;
}

/* ============================== 导入抽屉 ============================== */
export function openImportDrawer(currentId, { onLoad }) {
  const mask = el('div', { class: 'drawer-mask' });
  const drawer = el('div', { class: 'drawer' });

  const head = el('div', { class: 'drawer-head' }, [
    el('div', { class: 'drawer-icon' }, [icon('database', 16)]),
    el('div', { class: 'grow' }, [
      el('div', { class: 'drawer-title' }, [t('imp.title')]),
      el('div', { class: 'drawer-desc' }, [t('imp.desc')]),
    ]),
    el('button', { class: 'btn ghost icon sm', onclick: close }, [icon('x', 14)]),
  ]);

  const body = el('div', { class: 'drawer-body' });

  body.appendChild(el('div', { class: 'field-label' }, [t('imp.builtin')]));
  const list = el('div', { style: { display: 'grid', gap: '6px' } });
  BUILTIN_DATASETS.forEach((d) => {
    list.appendChild(el('button', {
      class: 'ds-option' + (currentId === d.id ? ' on' : ''),
      onclick: () => { close(); onLoad(d.make(getLang()), pick(d.label), d.id); },
    }, [
      el('div', { class: 'ic' }, [icon('table', 13)]),
      el('div', { class: 'grow' }, [
        el('div', { class: 't' }, [pick(d.label)]),
        el('div', { class: 'h' }, [pick(d.hint)]),
      ]),
      currentId === d.id ? icon('check', 14) : null,
    ]));
  });
  body.appendChild(list);

  body.appendChild(el('div', { class: 'field-label', style: { marginTop: '8px' } }, [t('imp.file')]));
  const fileInput = el('input', { type: 'file', accept: '.csv,.tsv,.txt,.json', style: { display: 'none' } });
  const dz = el('div', { class: 'dropzone', onclick: () => fileInput.click() }, [
    icon('upload', 24),
    el('div', { class: 'dropzone-title' }, [t('imp.drop')]),
    el('div', { class: 'dropzone-sub' }, [t('imp.dropSub')]),
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

  body.appendChild(el('div', { class: 'field-label', style: { marginTop: '8px' } }, [t('imp.paste')]));
  const ta = el('textarea', { class: 'paste', placeholder: 'Name,Math,English\nChen Yu,88,92\nSu Wan,76,85' });
  body.append(ta, el('button', {
    class: 'btn', style: { marginTop: '6px' },
    onclick: () => {
      const text = ta.value.trim();
      if (!text) { toast(t('imp.pasteFirst'), 'warn'); return; }
      try {
        const { df, warnings } = parseCSV(text, { source: 'pasted' });
        close();
        onLoad(df, 'pasted CSV', null);
        warnings.forEach((w) => toast(w, 'warn'));
      } catch (e) { toast(t('imp.parsed', { msg: e.message }), 'err'); }
    },
  }, [icon('check', 13), t('imp.parse')]));

  drawer.append(head, body, el('div', { class: 'drawer-foot' }, [
    el('span', { class: 'grow' }),
    el('button', { class: 'btn ghost', onclick: close }, [t('drawer.close')]),
  ]));
  document.body.append(mask, drawer);
  requestAnimationFrame(() => { mask.classList.add('on'); drawer.classList.add('on'); });

  async function handleFile(file) {
    try {
      const { readFile } = await import('../core/csv.js');
      const { df, warnings } = await readFile(file);
      close();
      onLoad(df, file.name, null);
      warnings.forEach((w) => toast(w, 'warn'));
    } catch (e) {
      toast(t('imp.failed', { msg: e.message }), 'err');
    }
  }

  function close() {
    mask.classList.remove('on');
    drawer.classList.remove('on');
    setTimeout(() => { mask.remove(); drawer.remove(); }, 380);
  }
  mask.addEventListener('click', close);
}

let _parseCSV = null;
export function injectCSVParser(fn) { _parseCSV = fn; }
function parseCSV(text, opts) { return _parseCSV(text, opts); }

/* ============================== 迷你分布图 ============================== */
export function renderMiniChart(host, df, col) {
  clear(host);
  if (!col || df.dtypes[col] !== 'number') {
    host.appendChild(el('div', { class: 'field-hint', style: { padding: '10px 11px' } }, [t('view.empty')]));
    return;
  }
  const ns = df.numCol(col);
  if (!ns.length) {
    host.appendChild(el('div', { class: 'field-hint', style: { padding: '10px 11px' } }, [t('common.noNumeric')]));
    return;
  }
  const h = df.hist(col, 14);
  const max = Math.max(1, ...h.counts);
  const H = 56;
  const peak = h.counts.indexOf(Math.max(...h.counts));
  const box = el('div', { style: { display: 'flex', alignItems: 'flex-end', gap: '2px', height: H + 'px' } },
    h.counts.map((c, i) => el('i', {
      class: 'mh-bar' + (i === peak ? ' peak' : ''),
      title: `${fmt(h.edges[i])} – ${fmt(h.edges[i + 1])}：${c}`,
      style: { height: Math.max(2, c / max * H) + 'px', width: Math.max(1, 260 / h.counts.length - 2) + 'px' },
    })));
  host.appendChild(el('div', { class: 'mini-chart' }, [
    el('div', { class: 'st-row', style: { justifyContent: 'space-between', marginBottom: '5px' } }, [
      el('span', { class: 'pill cyan' }, [col]),
      el('span', { class: 'pill' }, [`n=${ns.length}  x̄=${fmt(ns.reduce((a, b) => a + b, 0) / ns.length)}`]),
    ]),
    box,
    el('div', { class: 'st-row', style: { justifyContent: 'space-between', marginTop: '4px' } }, [
      el('span', { class: 'field-hint' }, [fmt(h.min)]),
      el('span', { class: 'field-hint' }, [`${h.counts.length} bins`]),
      el('span', { class: 'field-hint' }, [fmt(h.max)]),
    ]),
  ]));
}
