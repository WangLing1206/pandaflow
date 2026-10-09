/* ------------------------------------------------------------------
 * ui/views.js — 分析视图面板
 *  ----------------------------------------------------------------
 *  五个视图：数据表 / 图表 / 统计 / 缺失值 / 相关性。
 *  关键点：所有视图都渲染「当前动画帧的 DataFrame」，因此动画每推进一步，
 *  图表、统计量、缺失地图都会跟着变 —— 这就是「与分析过程联动」。
 *  也可以点「锁定」把视图钉在某一帧上做对比。
 * ------------------------------------------------------------------ */

import { el, clear, fmt, clamp, mean, std, median, quantile } from '../core/utils.js';
import { t, pick } from '../i18n/index.js';
import { icon } from './icons.js';
import { DataFrameView } from './table.js';
import { CHART_TYPES, CHART_BY_ID } from './charts.js';
import { boxStats, skewness, kurtosis, corrMatrix, covMatrix, nums } from '../core/stats.js';

const TABS = [
  { id: 'table', icon: 'table', label: () => t('view.table') },
  { id: 'charts', icon: 'chart-hist', label: () => t('view.charts') },
  { id: 'stats', icon: 'sigma', label: () => t('view.stats') },
  { id: 'missing', icon: 'droplet', label: () => t('view.missing') },
  { id: 'corr', icon: 'grid', label: () => t('view.corr') },
];

/** 图表类型的自动列选择 */
export function autoChartCfg(df, type) {
  const numCols = df.columns.filter((c) => df.dtypes[c] === 'number');
  const objCols = df.columns.filter((c) => df.dtypes[c] !== 'number');
  const catCol = df.meta?.categoryCol && df.columns.includes(df.meta.categoryCol)
    ? df.meta.categoryCol
    : (objCols.find((c) => {
      const u = new Set(df.col(c).map((v) => String(v))).size;
      return u > 1 && u <= 15;
    }) || objCols[0] || df.columns[0]);
  const labelCol = df.meta?.labelCol && df.columns.includes(df.meta.labelCol) ? df.meta.labelCol : catCol;
  const need = CHART_BY_ID[type]?.needs || [];
  const cfg = { x: null, y: null, group: null, bins: null };
  if (type === 'scatter' || type === 'heatmap') {
    cfg.x = numCols[0]; cfg.y = numCols[1] || numCols[0];
  } else if (type === 'line' || type === 'area') {
    cfg.x = labelCol; cfg.y = numCols[0];
  } else if (type === 'bar' || type === 'pie') {
    cfg.x = catCol;
  } else if (type === 'groupedBar') {
    cfg.x = catCol;
    cfg.group = objCols.find((c) => c !== catCol) || catCol;
  } else {
    cfg.x = numCols[0];
  }
  return cfg;
}

export class ViewPanel {
  constructor(host) {
    this.host = host;
    this.active = 'table';
    this.chartType = 'hist';
    this.cfg = { x: null, y: null, group: null, bins: null };
    this.df = null;
    this.tableState = null;
    this.frozen = false;
    this.frozenDf = null;
    this._build();
  }

  /* ------------------------------ 骨架 ------------------------------ */
  _build() {
    const h = this.host;
    h.innerHTML = '';

    this.tabBar = el('div', { class: 'view-tabs' });
    h.appendChild(this.tabBar);

    this.ctlBar = el('div', { class: 'view-bar' });
    h.appendChild(this.ctlBar);

    this.body = el('div', { class: 'view-body' });
    h.appendChild(this.body);

    // 各视图容器
    this.panes = {};
    TABS.forEach((tb) => {
      const pane = el('div', { class: 'view-pane', data: { pane: tb.id } });
      pane.style.display = 'none';
      this.body.appendChild(pane);
      this.panes[tb.id] = pane;
    });

    // 数据表视图
    const tp = this.panes.table;
    tp.classList.add('scroll');
    this.dfHead = el('div', { class: 'df-head' });
    this.dfViewHost = el('div', { style: { display: 'flex', flex: '1 1 auto', minHeight: '0' } });
    this.dfFoot = el('div', { class: 'df-foot' });
    tp.append(this.dfHead, this.dfViewHost, this.dfFoot);
    tp.style.display = 'flex';
    this.dfView = new DataFrameView(this.dfViewHost);
    this.dfView.bindScroll();

    // 图表视图
    this.chartHost = el('div', { class: 'chart-host' });
    this.panes.charts.appendChild(this.chartHost);

    // 统计视图
    this.statHost = el('div', { style: { flex: '1 1 auto', minHeight: '0', overflow: 'auto' } });
    this.panes.stats.appendChild(this.statHost);

    // 缺失值视图
    this.missHost = el('div', { style: { flex: '1 1 auto', minHeight: '0', overflow: 'auto' } });
    this.panes.missing.appendChild(this.missHost);

    // 相关性视图
    this.corrHost = el('div', { class: 'chart-host' });
    this.panes.corr.appendChild(this.corrHost);

    this._renderTabs();
  }

  /* ------------------------------ 标签栏 ------------------------------ */
  _renderTabs() {
    clear(this.tabBar);
    TABS.forEach((tb) => {
      const b = el('button', {
        class: 'view-tab' + (this.active === tb.id ? ' on' : ''),
        onclick: () => { this.active = tb.id; this._renderTabs(); this._renderControls(); this._renderPanes(); },
      }, [icon(tb.icon, 13), el('span', {}, [tb.label()])]);
      if (tb.id === 'charts') b.appendChild(el('span', { class: 'cnt' }, [String(CHART_TYPES.length)]));
      this.tabBar.appendChild(b);
    });
    const live = el('div', {
      class: 'view-live' + (this.frozen ? '' : ' on'),
      title: this.frozen ? t('view.unfreeze') : t('view.freeze'),
      onclick: () => { this.toggleFreeze(); },
      style: { cursor: 'pointer' },
    }, [
      el('span', { class: 'dot' }),
      el('span', {}, [this.frozen ? t('view.frozen') : t('view.linked')]),
    ]);
    this.tabBar.appendChild(live);
  }

  toggleFreeze() {
    this.frozen = !this.frozen;
    if (this.frozen) this.frozenDf = this.df;
    this._renderTabs();
    this._renderPanes();
  }

  /* ------------------------------ 控制条 ------------------------------ */
  _renderControls() {
    clear(this.ctlBar);
    const df = this.currentDf();
    if (!df) { this.ctlBar.style.display = 'none'; return; }
    this.ctlBar.style.display = '';

    if (this.active === 'charts') {
      // 图表类型
      const types = el('div', { class: 'ctypes' });
      CHART_TYPES.forEach((ct) => {
        const label = t('chart.' + ct.id);
        types.appendChild(el('button', {
          class: 'ctype' + (this.chartType === ct.id ? ' on' : ''),
          onclick: () => { this.chartType = ct.id; this.cfg = autoChartCfg(df, ct.id); this._renderControls(); this._renderPanes(); },
        }, [label]));
      });
      this.ctlBar.appendChild(el('div', { class: 'grp' }, [el('span', { class: 'lab' }, [t('view.charts')]), types]));

      const need = CHART_BY_ID[this.chartType]?.needs || [];
      const numCols = df.columns.filter((c) => df.dtypes[c] === 'number');
      const anyCols = df.columns;
      if (need.includes('num') || need.includes('num2')) {
        this.ctlBar.appendChild(el('span', { class: 'divider' }));
        this.ctlBar.appendChild(this._sel(t('view.x'), numCols, this.cfg.x, (v) => { this.cfg.x = v; this._renderPanes(); }));
      }
      if (need.includes('num2')) {
        this.ctlBar.appendChild(this._sel(t('view.y'), numCols, this.cfg.y, (v) => { this.cfg.y = v; this._renderPanes(); }));
      }
      if (need.includes('any') || need.includes('any2')) {
        this.ctlBar.appendChild(el('span', { class: 'divider' }));
        this.ctlBar.appendChild(this._sel(t('view.x'), anyCols, this.cfg.x, (v) => { this.cfg.x = v; this._renderPanes(); }));
      }
      if (need.includes('any2')) {
        this.ctlBar.appendChild(this._sel(t('view.group'), anyCols, this.cfg.group, (v) => { this.cfg.group = v; this._renderPanes(); }));
      }
      if (this.chartType === 'hist') {
        this.ctlBar.appendChild(el('span', { class: 'divider' }));
        const inp = el('input', { class: 'inp', type: 'number', min: 3, max: 40, value: this.cfg.bins || '' , placeholder: t('view.bins') });
        inp.style.width = '64px';
        inp.addEventListener('input', () => { this.cfg.bins = inp.value ? Number(inp.value) : null; this._renderPanes(); });
        this.ctlBar.appendChild(el('div', { class: 'grp' }, [el('span', { class: 'lab' }, [t('view.bins')]), inp]));
      }
      if (this.chartType === 'box' || this.chartType === 'violin' || this.chartType === 'strip' || this.chartType === 'density') {
        this.ctlBar.appendChild(el('span', { class: 'divider' }));
        this.ctlBar.appendChild(this._sel(t('view.group'), [''].concat(df.columns), this.cfg.group || '', (v) => { this.cfg.group = v || null; this._renderPanes(); }));
      }
    } else if (this.active === 'stats') {
      this.ctlBar.appendChild(el('span', { class: 'lab' }, [
        `${df.columns.filter((c) => df.dtypes[c] === 'number').length} ${t('insp.numeric')} · ${df.nrow} ${t('insp.rows')}`,
      ]));
    } else if (this.active === 'missing') {
      const total = Object.values(df.nullCounts()).reduce((a, b) => a + b, 0);
      this.ctlBar.appendChild(el('span', { class: 'lab' }, [
        `${t('insp.missing')} ${total} / ${df.nrow * df.ncol}`,
      ]));
    } else if (this.active === 'corr') {
      this.ctlBar.appendChild(el('span', { class: 'lab' }, [t('chart.heatmap')]));
    }
  }

  _sel(label, cols, val, onChange) {
    const s = el('select', { class: 'sel' });
    cols.forEach((c) => {
      const o = el('option', { value: c }, [c === '' ? '—' : c]);
      if (c === val) o.selected = true;
      s.appendChild(o);
    });
    s.addEventListener('change', () => onChange(s.value));
    return el('div', { class: 'grp' }, [el('span', { class: 'lab' }, [label]), s]);
  }

  /* ------------------------------ 数据 ------------------------------ */
  currentDf() { return this.frozen && this.frozenDf ? this.frozenDf : this.df; }

  /** 由 main 调用：传入当前帧的数据与表格状态 */
  update(df, tableState) {
    this.df = df;
    this.tableState = tableState;
    if (!this.frozen) this._renderPanes();
    else this._renderPanes();   // 冻结时用 frozenDf，但表格仍跟随
  }

  /** 语言或主题变化时全量重绘 */
  refresh() {
    this._renderTabs();
    this._renderControls();
    this._renderPanes();
  }

  _renderPanes() {
    TABS.forEach((tb) => {
      this.panes[tb.id].style.display = tb.id === this.active ? (tb.id === 'table' ? 'flex' : 'flex') : 'none';
    });
    this._renderControls();
    const df = this.currentDf();
    if (!df) return;
    switch (this.active) {
      case 'table': this._renderTable(); break;
      case 'charts': this._renderChart(df); break;
      case 'stats': this._renderStats(df); break;
      case 'missing': this._renderMissing(df); break;
      case 'corr': this._renderCorr(df); break;
    }
  }

  /* ------------------------------ 数据表 ------------------------------ */
  _renderTable() {
    const df = this.df;
    if (!df) return;
    const st = this.tableState;
    clear(this.dfHead);
    this.dfHead.append(
      el('span', { class: 'df-var' }, ['df']),
      el('span', { class: 'df-shape' }, [`${df.nrow} × ${df.ncol}`]),
      el('span', { class: 'df-src' }, [df.source || '']),
      el('span', { class: 'badge accent' }, ['DataFrame']),
    );
    if (st) this.dfView.render(st);
    else {
      this.dfView.render({
        columns: df.columns, dtypes: df.dtypes,
        rows: df._rows.map((r, i) => ({ rid: r.rid, cells: r.cells.slice(), state: 'normal', label: String(i) })),
      });
    }
    clear(this.dfFoot);
    const nulls = df.nullCounts();
    const total = Object.values(nulls).reduce((a, b) => a + b, 0);
    const numCols = df.columns.filter((c) => df.dtypes[c] === 'number');
    const item = (k, v, tone) => el('span', {}, [
      el('span', { style: { color: 'var(--txt-3)' } }, [k + ' ']),
      el('b', { style: tone ? { color: tone } : null }, [v]),
    ]);
    this.dfFoot.append(
      item('shape', `${df.nrow} × ${df.ncol}`),
      item('dtypes', `${new Set(df.columns.map((c) => df.dtypes[c])).size}`),
      item(t('insp.numeric'), String(numCols.length)),
      item(t('insp.missing'), String(total), total ? 'var(--max)' : 'var(--ok)'),
      el('span', { class: 'grow' }),
      el('span', { style: { color: 'var(--txt-3)' } }, [`${t('common.index')} 0 … ${Math.max(0, df.nrow - 1)}`]),
    );
  }

  /* ------------------------------ 图表 ------------------------------ */
  _renderChart(df) {
    clear(this.chartHost);
    const ct = CHART_BY_ID[this.chartType];
    if (!ct) return;
    const cfg = this.cfg;
    const need = ct.needs || [];
    const numCols = df.columns.filter((c) => df.dtypes[c] === 'number');
    if ((need.includes('num') || need.includes('num2')) && !numCols.length) {
      this.chartHost.appendChild(el('div', { class: 'empty-stage' }, [
        el('div', { class: 't' }, [t('common.noNumeric')]),
        el('div', { class: 'h' }, [t('stage.noDataHint')]),
      ]));
      return;
    }
    if (!cfg.x) this.cfg = Object.assign(cfg, autoChartCfg(df, this.chartType));
    if (need.includes('num') && df.dtypes[cfg.x] !== 'number') this.cfg.x = numCols[0];
    if (need.includes('num2') && df.dtypes[cfg.y] !== 'number') this.cfg.y = numCols[1] || numCols[0];
    if (need.includes('any') && cfg.x === null) this.cfg.x = autoChartCfg(df, this.chartType).x;
    if (need.includes('any2') && !cfg.group) this.cfg.group = autoChartCfg(df, this.chartType).group;

    const host = el('div', { style: { position: 'absolute', inset: '0', display: 'flex', flexDirection: 'column' } });
    this.chartHost.appendChild(host);
    const plot = el('div', { class: 'chart-host', style: { position: 'relative', flex: '1 1 auto', minHeight: '0' } });
    host.appendChild(plot);
    try {
      ct.draw(plot, df, this.cfg);
    } catch (e) {
      console.error('[chart]', this.chartType, e);
      plot.innerHTML = '';
      plot.appendChild(el('div', { class: 'empty-stage' }, [el('div', { class: 't' }, [String(e.message || e)])]));
    }
  }

  /* ------------------------------ 统计 ------------------------------ */
  _renderStats(df) {
    clear(this.statHost);
    const numCols = df.columns.filter((c) => df.dtypes[c] === 'number');
    if (!numCols.length) {
      this.statHost.appendChild(el('div', { class: 'empty-stage' }, [el('div', { class: 't' }, [t('common.noNumeric')])]));
      return;
    }
    // 概览卡片
    const cards = el('div', { class: 'stat-cards' });
    const allNums = numCols.flatMap((c) => nums(df.col(c)));
    const gmean = mean(allNums), gstd = std(allNums, 1);
    const global = el('div', { class: 'stat-card', style: { borderColor: 'var(--accent-line)' } }, [
      el('div', { class: 'sc-name' }, [el('span', {}, ['ALL']), el('span', { class: 'dt' }, [`${numCols.length} cols`])]),
      ...[['n', String(allNums.length)], ['mean', fmt(gmean)], ['std', fmt(gstd)],
        ['min', fmt(Math.min(...allNums))], ['max', fmt(Math.max(...allNums))]].map(([k, v]) =>
        el('div', { class: 'sc-row' }, [el('span', { class: 'k' }, [k]), el('span', { class: 'v' }, [v])])),
    ]);
    cards.appendChild(global);
    numCols.forEach((c) => {
      const v = nums(df.col(c));
      const b = boxStats(v);
      const unit = df.meta?.unit?.[c] || '';
      const miss = df.col(c).filter((x) => x === null || x === undefined).length;
      cards.appendChild(el('div', { class: 'stat-card' }, [
        el('div', { class: 'sc-name' }, [el('span', {}, [c]), el('span', { class: 'dt' }, ['float64'])]),
        ...[
          ['count', `${b.n}${miss ? ` (−${miss})` : ''}`],
          ['mean', fmt(b.mean) + unit],
          ['std', fmt(std(v, 1))],
          ['min', fmt(b.min) + unit],
          ['25%', fmt(b.q1)],
          ['50%', fmt(b.q2)],
          ['75%', fmt(b.q3)],
          ['max', fmt(b.max) + unit],
          ['IQR', fmt(b.iqr)],
          ['skew', fmt(skewness(v))],
          ['kurt', fmt(kurtosis(v))],
          ['outliers', String(b.outliers.length)],
        ].map(([k, val]) => el('div', { class: 'sc-row' }, [el('span', { class: 'k' }, [k]), el('span', { class: 'v' }, [val])])),
        el('div', { class: 'sc-bar' }, [el('i', { style: { width: clamp(b.q3 / (b.max || 1) * 100, 4, 100) + '%' } })]),
      ]));
    });
    this.statHost.appendChild(cards);
  }

  /* ------------------------------ 缺失值 ------------------------------ */
  _renderMissing(df) {
    clear(this.missHost);
    const nulls = df.nullCounts();
    const total = Object.values(nulls).reduce((a, b) => a + b, 0);
    const affected = Object.entries(nulls).filter(([, v]) => v > 0);
    const summary = el('div', { class: 'miss-summary' }, [
      el('span', { class: 'pill' }, [`${t('insp.missing')} ${total}`]),
      el('span', { class: 'pill ' + (total ? 'rose' : 'emerald') }, [`${affected.length} / ${df.ncol} ${t('view.cols')}`]),
      el('span', { class: 'pill' }, [`${df.nrow} × ${df.ncol}`]),
      el('span', { class: 'pill' }, [`${((1 - total / (df.nrow * df.ncol)) * 100).toFixed(1)}% complete`]),
    ]);
    this.missHost.appendChild(summary);
    const sorted = df.columns.slice().sort((a, b) => nulls[b] - nulls[a]);
    sorted.forEach((c) => {
      const cells = df.col(c).map((v) => v === null || v === undefined);
      this.missHost.appendChild(el('div', { class: 'miss-row' + (nulls[c] ? ' has' : '') }, [
        el('div', { class: 'miss-label', title: c }, [c]),
        el('div', { class: 'miss-track' }, cells.map((isN, i) => el('i', {
          class: 'miss-cell' + (isN ? ' na' : ''),
          title: `#${i}`,
          style: { transitionDelay: `${Math.min(i * 6, 400)}ms` },
        }))),
        el('div', { class: 'miss-val' }, [nulls[c] ? `${nulls[c]} / ${df.nrow}` : '—']),
      ]));
    });
    // 逐行缺失数分布
    const rowNulls = df._rows.map((r) => r.cells.filter((v) => v === null || v === undefined).length);
    const dist = new Map();
    rowNulls.forEach((n) => dist.set(n, (dist.get(n) || 0) + 1));
    const distBox = el('div', { style: { marginTop: '12px' } }, [
      el('div', { class: 'card-k', style: { marginBottom: '6px' } }, ['rows by missing count']),
      ...([...dist.entries()].sort((a, b) => a[0] - b[0]).map(([n, c]) => el('div', { class: 'bar-row' }, [
        el('div', { class: 'bar-label' }, [`${n} ${t('common.nan')}`]),
        el('div', { class: 'bar-track' }, [el('div', { class: 'bar-fill' + (n ? ' rose' : ' emerald'), style: { width: (c / df.nrow * 100) + '%' } })]),
        el('div', { class: 'bar-val' }, [String(c)]),
      ]))),
    ]);
    this.missHost.appendChild(distBox);
  }

  /* ------------------------------ 相关性 ------------------------------ */
  _renderCorr(df) {
    clear(this.corrHost);
    const cols = df.columns.filter((c) => df.dtypes[c] === 'number');
    if (cols.length < 2) {
      this.corrHost.appendChild(el('div', { class: 'empty-stage' }, [
        el('div', { class: 't' }, [t('view.corr')]),
        el('div', { class: 'h' }, [t('stage.noDataHint')]),
      ]));
      return;
    }
    const host = el('div', { style: { position: 'absolute', inset: '0', display: 'flex', flexDirection: 'column' } });
    this.corrHost.appendChild(host);
    const plot = el('div', { class: 'chart-host', style: { position: 'relative', flex: '1 1 auto', minHeight: '0' } });
    host.appendChild(plot);
    CHART_BY_ID.heatmap.draw(plot, df, { x: cols[0] });

    // 最强相关对
    const m = corrMatrix(df, cols);
    const pairs = [];
    cols.forEach((a, i) => cols.forEach((b, j) => {
      if (i < j && Number.isFinite(m[i][j])) pairs.push({ a, b, r: m[i][j] });
    }));
    pairs.sort((x, y) => Math.abs(y.r) - Math.abs(x.r));
    const cov = covMatrix(df, cols);
    const list = el('div', { style: { flex: 'none', marginTop: '8px', maxHeight: '40%', overflow: 'auto' } });
    list.appendChild(el('div', { class: 'card-k', style: { marginBottom: '5px' } }, ['strongest pairs · covariance']));
    pairs.slice(0, 6).forEach((p, i) => {
      const ci = cols.indexOf(p.a), cj = cols.indexOf(p.b);
      list.appendChild(el('div', { class: 'bar-row', style: { gridTemplateColumns: '150px 1fr 78px' } }, [
        el('div', { class: 'bar-label', title: `${p.a} × ${p.b}` }, [`${p.a.slice(0, 8)} × ${p.b.slice(0, 8)}`]),
        el('div', { class: 'bar-track' }, [el('div', {
          class: 'bar-fill' + (p.r >= 0 ? '' : ' rose'),
          style: { width: (Math.abs(p.r) * 100) + '%' },
        })]),
        el('div', { class: 'bar-val' }, [`${p.r >= 0 ? '+' : ''}${fmt(p.r, 3)}`]),
      ]));
    });
    host.appendChild(list);
  }
}
