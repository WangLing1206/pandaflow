/* ------------------------------------------------------------------
 * ui/table.js — 会动起来的 DataFrame 表格
 *  ----------------------------------------------------------------
 *  关键实现：所有行都是绝对定位，纵向位置靠 transform: translateY 表达。
 *  因此「行重排」只需要改 transform，浏览器就会自动补间；
 *  「行消失」是一个退场动画；「新行出现」是入场动画。
 *  由于 rid 稳定，同一个 rid 的行在整条管道里始终是同一个 DOM 节点。
 * ------------------------------------------------------------------ */

import { el, clear } from '../core/utils.js';

const ROW_H = 33;
const IDX_W = 54;

function colWidth(name, dtype) {
  if (dtype === 'number') return 106;
  const len = String(name).length;
  if (len <= 2) return 104;
  if (len <= 4) return 118;
  if (len <= 6) return 136;
  return 156;
}

export class DataFrameView {
  constructor(root) {
    this.root = root;
    this.rows = new Map();          // rid -> { node, cells: [], label, markSig }
    this.lastOrder = [];
    this.lastLabel = {};
    this.colKey = '';
    this._leaving = new Set();
    this._scrollLock = 0;

    this.viewport = el('div', { class: 'df-viewport' });
    this.grid = el('div', { class: 'df-grid' });
    this.header = el('div', { class: 'df-header' });
    this.body = el('div', { class: 'df-rows' });
    this.grid.append(this.header, this.body);
    this.viewport.append(this.grid);
    root.append(this.viewport);
  }

  /** 供外部在用户手动滚动时暂停自动跟随 */
  bindScroll() {
    this.viewport.addEventListener('wheel', () => { this._scrollLock = performance.now() + 2600; }, { passive: true });
    this.viewport.addEventListener('touchmove', () => { this._scrollLock = performance.now() + 2600; }, { passive: true });
  }

  render(t, opts = {}) {
    const cols = t.columns;
    const key = cols.join('\u0001');
    if (key !== this.colKey) { this._buildHeader(t); this.colKey = key; }

    const seen = new Set();
    const order = [];
    let entering = false;

    t.rows.forEach((r, pos) => {
      seen.add(r.rid);
      order.push(r.rid);
      let rec = this.rows.get(r.rid);
      if (!rec) {
        rec = this._createRow(r, pos, t);
        this.rows.set(r.rid, rec);
        this.body.appendChild(rec.node);
        entering = true;
      }
      this._updateRow(rec, r, pos, t);
    });

    // 退场
    for (const [rid, rec] of this.rows) {
      if (seen.has(rid)) continue;
      this.rows.delete(rid);
      this._leaving.add(rid);
      rec.node.classList.add('leaving');
      setTimeout(() => { rec.node.remove(); this._leaving.delete(rid); }, 460);
    }

    this.body.style.height = Math.max(0, t.rows.length * ROW_H) + 'px';
    this.lastOrder = order;

    if (opts.autoScroll !== false) this._follow(t);
    return { entering };
  }

  /* --------------------------- 表头 --------------------------- */
  _buildHeader(t) {
    clear(this.header);
    const wid = [IDX_W, ...t.columns.map((c) => colWidth(c, t.dtypes?.[c]))];
    const tpl = wid.map((w) => `${w}px`).join(' ');
    this.grid.style.setProperty('--cols', tpl);
    this.grid.style.minWidth = wid.reduce((a, b) => a + b, 0) + 'px';
    this.header.style.gridTemplateColumns = tpl;
    this.body.style.width = '100%';

    this.header.appendChild(el('div', { class: 'df-header-cell idx' }, ['#']));
    t.columns.forEach((c, i) => {
      const dt = t.dtypes?.[c] || 'object';
      const label = { number: 'float64', object: 'object', bool: 'bool', int64: 'int64' }[dt] || dt;
      const cell = el('div', { class: 'df-header-cell', data: { col: c } }, [
        el('div', { class: 'df-col-name', title: c }, [c]),
        el('div', { class: 'df-col-dtype' }, [label]),
      ]);
      if (t._newCols?.includes(c)) cell.classList.add('new-col');
      this.header.appendChild(cell);
    });
    this._headerCols = t.columns;
  }

  _hlHeader(cols) {
    const set = new Set(cols.filter(Boolean));
    for (const node of this.header.querySelectorAll('.df-header-cell[data-col]')) {
      node.classList.toggle('hl', set.has(node.dataset.col));
    }
  }

  /* --------------------------- 行 --------------------------- */
  _createRow(r, pos, t) {
    const tpl = this.grid.style.getPropertyValue('--cols');
    const node = el('div', {
      class: 'df-row entering',
      style: { gridTemplateColumns: tpl, transform: `translateY(${pos * ROW_H}px)`, '--y': `${pos * ROW_H}px` },
    });
    const cells = [el('div', { class: 'df-cell idx' }, [r.label])];
    for (let i = 0; i < t.columns.length; i++) {
      const dt = t.dtypes?.[t.columns[i]];
      cells.push(el('div', { class: 'df-cell' + (dt === 'number' ? '' : ' str') }, ['']));
    }
    cells.forEach((c) => node.appendChild(c));
    setTimeout(() => node.classList.remove('entering'), 560);
    return { node, cells, label: r.label, markSig: '', valueSig: '' };
  }

  _updateRow(rec, r, pos, t) {
    const y = pos * ROW_H;
    rec.node.style.transform = `translateY(${y}px)`;

    // 行状态
    const st = r.state || 'normal';
    if (rec.state !== st) {
      rec.node.className = 'df-row' + (st !== 'normal' ? ` s-${st}` : '');
      rec.state = st;
    }

    // 索引标签
    if (rec.label !== r.label) {
      rec.label = r.label;
      rec.cells[0].textContent = r.label;
      rec.cells[0].animate?.(
        [{ background: 'rgba(255,212,94,0.5)' }, { background: 'transparent' }],
        { duration: 700, easing: 'ease-out' }
      );
    }

    // 各列值
    const newMarkSig = r.marks ? Object.entries(r.marks).map(([k, v]) => `${k}:${v}`).join(',') : '';
    const values = [null, ...r.cells];
    for (let i = 0; i < values.length; i++) {
      const cell = rec.cells[i];
      if (!cell) continue;
      if (i > 0) {
        const v = values[i];
        const txt = v === null || v === undefined ? 'NaN' : String(v);
        if (cell.textContent !== txt) cell.textContent = txt;
        cell.classList.toggle('na', v === null || v === undefined);
        const dt = t.dtypes?.[t.columns[i - 1]];
        cell.classList.toggle('str', dt !== 'number');
      }
    }

    // 单元格标记
    if (newMarkSig !== rec.markSig) {
      for (let i = 1; i < rec.cells.length; i++) {
        const cell = rec.cells[i];
        const m = r.marks?.[i - 1];
        // 清掉旧标记但保留动画类（让动画自然结束）
        [...cell.classList].filter((c) => c.startsWith('m-') && c !== 'm-' + m).forEach((c) => {
          if (['m-filled', 'm-change', 'm-new', 'm-filling'].includes(c)) return;
          cell.classList.remove(c);
        });
        if (m) cell.classList.add('m-' + m);
      }
      rec.markSig = newMarkSig;
    }
    // 没有新标记时也要能清掉
    if (!r.marks) {
      for (let i = 1; i < rec.cells.length; i++) {
        [...rec.cells[i].classList].filter((c) => c.startsWith('m-') && !['m-filled', 'm-change', 'm-new'].includes(c))
          .forEach((c) => rec.cells[i].classList.remove(c));
      }
    }
  }

  /**
   * 自动跟随「活动行」滚动。
   * 优先级很重要：正在被处理的行（focus / 扫描中 / 填充中）永远优先于
   * 「之前被判为危险」的行 —— 否则在 dropna 这类操作里会一直停在早就
   * 处理过的旧行上，观众看不到当前正在发生什么。
   */
  _follow(t) {
    if (performance.now() < this._scrollLock) return;
    const HOT = ['scan', 'champ-max', 'champ-min', 'filling', 'change', 'new'];
    let target = null;
    for (let i = 0; i < t.rows.length; i++) {
      if (t.rows[i].state === 'focus') { target = i; break; }
    }
    if (target === null) {
      for (let i = 0; i < t.rows.length; i++) {
        const marks = t.rows[i].marks ? Object.values(t.rows[i].marks) : [];
        if (marks.some((m) => HOT.includes(m))) { target = i; break; }
      }
    }
    if (target === null) {
      for (let i = 0; i < t.rows.length; i++) {
        if (t.rows[i].state === 'danger') { target = i; break; }
      }
    }
    if (target === null || target === this._followTarget) return;
    this._followTarget = target;
    const y = target * ROW_H;
    const vp = this.viewport;
    const pad = 40;
    if (y < vp.scrollTop + pad || y + ROW_H > vp.scrollTop + vp.clientHeight - pad) {
      vp.scrollTo({ top: Math.max(0, y - vp.clientHeight / 2 + ROW_H / 2), behavior: 'smooth' });
    }
  }

  reset() {
    clear(this.body);
    this.rows.clear();
    this.colKey = '';
    this._followTarget = -1;
    delete this.grid.dataset;   // no-op
  }
}

export { ROW_H };
