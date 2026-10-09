/* ------------------------------------------------------------------
 * ui/viz.js — 基于 SVG / DOM 的可视化渲染器
 *  ----------------------------------------------------------------
 *  每个 makeXxx(host, payload) 返回 { update(payload) }，
 *  同一个舞台卸载前一直复用同一批 DOM 元素，因此状态变化会被
 *  CSS 过渡自然地补间成动画。
 * ------------------------------------------------------------------ */

import { el, clear, fmt, clamp, histogram, quantile, median } from '../core/utils.js';

/** 在 [lo, hi] 里取 n 个「整齐」的刻度值（1/2/2.5/5/10 的整数倍） */
export function niceTicks(lo, hi, n = 5) {
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) return [lo, hi];
  const raw = (hi - lo) / n;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || 10 * mag;
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 0.001; v += step) {
    out.push(Math.round(v / step) * step);
  }
  if (out.length < 2) return [lo, hi];
  return out;
}

const NS = 'http://www.w3.org/2000/svg';
export function svg(tag, attrs = {}, children = []) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2).toLowerCase(), v);
    else n.setAttribute(k, v);
  }
  for (const c of [].concat(children)) if (c) n.appendChild(c);
  return n;
}
export function txt(x, y, s, cls = 'axis-text', extra = {}) {
  const t = svg('text', { x, y, class: cls, ...extra });
  t.textContent = s;
  return t;
}

/* ================================================================
 * 1. 点阵条 strip —— 一维数值分布 + 扫描指针
 * ================================================================ */
export function makeStrip(host) {
  let c = null;
  const pad = 34;
  return {
    update(p) {
      if (!c) {
        host.innerHTML = '';
        c = el('div', { class: 'strip' });
        c._axis = el('div', { class: 'strip-axis' });
        c._dots = el('div', { style: { position: 'absolute', inset: '0' } });
        c._scan = el('div', { class: 'strip-scanline', style: { opacity: 0 } });
        c._base = el('div', { class: 'strip-baseline' });
        c.append(c._axis, c._dots, c._scan, c._base);
        host.appendChild(c);
        c._map = new Map();
        host._ro = new ResizeObserver(() => this.update(this._p));
        host._ro.observe(host);
      }
      this._p = p;
      const W = Math.max(120, c.clientWidth || host.clientWidth || 600);
      const inner = W - pad * 2;
      const xOf = (t) => pad + t * inner;

      // 刻度：取「整数好看值」，避免 51.4 / 68.5 这种读不出来的数字
      const ticks = niceTicks(p.dom.min, p.dom.max, 5);
      const tOf = (v) => (v - p.dom.min) / (p.dom.max - p.dom.min);
      if (!c._ticks || c._ticks.length !== ticks.length) {
        c._base.innerHTML = '';
        c._ticks = ticks.map(() => {
          const tk = el('div', { class: 'strip-tick' });
          c._base.appendChild(tk);
          return tk;
        });
      }
      c._ticks.forEach((tk, i) => { tk.style.left = xOf(tOf(ticks[i])) + 'px'; tk.textContent = fmt(ticks[i]); });

      const seen = new Set();
      (p.points || []).forEach((pt) => {
        seen.add(pt.i);
        let d = c._map.get(pt.i);
        if (!d) {
          d = el('div', { class: 'strip-pt', style: { left: xOf(pt.t) + 'px' } });
          c._dots.appendChild(d);
          c._map.set(pt.i, d);
        }
        // 注意：状态类必须加 pt- 前缀，否则会和竞技场卡片的 .challenger / .min / .max 撞名
        d.className = 'strip-pt' + (pt.status && pt.status !== 'unseen' ? ' pt-' + pt.status : '');
        d.style.left = xOf(pt.t) + 'px';
        d.title = `${pt.name ?? '#' + pt.i} = ${fmt(pt.value)}`;
      });
      for (const [i, d] of c._map) if (!seen.has(i)) { d.remove(); c._map.delete(i); }

      // 扫描线
      if (p.cursor >= 0 && p.points?.[p.cursor]) {
        c._scan.style.opacity = '1';
        c._scan.style.left = xOf(p.points[p.cursor].t) + 'px';
      } else c._scan.style.opacity = p.phase === 'reset' ? '0' : '0';

      // 冠军标高
      c._tags?.forEach((t) => t.remove());
      c._tags = [];
      const addTag = (kind, pt, label) => {
        const tag = el('div', { class: `strip-tag ${kind}`, style: { left: xOf(pt.t) + 'px' } }, [label]);
        c.appendChild(tag); c._tags.push(tag);
      };
      const maxPt = p.maxIdx >= 0 ? p.points?.[p.maxIdx] : null;
      const minPt = p.minIdx >= 0 ? p.points?.[p.minIdx] : null;
      if (maxPt && maxPt.status !== 'removed') addTag('max', maxPt, `max ${fmt(maxPt.value)}`);
      if (minPt && minPt.status !== 'removed') addTag('min', minPt, `min ${fmt(minPt.value)}`);
    },
    destroy() { host._ro?.disconnect(); },
  };
}

/* ================================================================
 * 2. 排序舞台 —— 数值条按位置重排
 * ================================================================ */
export function makeSorter(host) {
  let wrap = null; const map = new Map();
  return {
    update(p) {
      if (!wrap) {
        host.innerHTML = '';
        wrap = el('div', { class: 'sorter' });
        wrap._bars = el('div', { class: 'sorter-bars' });
        wrap._foot = el('div', { class: 'sorter-foot' });
        wrap.append(wrap._bars, wrap._foot);
        host.appendChild(wrap);
      }
      const n = p.items.length || 1;
      const W = 100 / n;
      const seen = new Set();
      p.items.forEach((it) => {
        seen.add(it.rid);
        let b = map.get(it.rid);
        if (!b) {
          b = el('i', { class: 'sorter-bar' });
          b._label = el('span', { class: 'sorter-bar-label' });
          b.appendChild(b._label);
          wrap._bars.appendChild(b);
          map.set(it.rid, b);
        }
        b.style.left = (it.pos * W) + '%';
        b.style.width = `calc(${W}% - 2px)`;
        b.style.height = clamp((Number.isFinite(it.t) ? it.t : 0) * 100, 3, 100) + '%';
        b.className = 'sorter-bar' + (it.isKey ? ' key' : it.sorted ? ' sorted' : '');
        b._label.textContent = it.pos % 2 === 0 || n <= 16 ? fmt(it.value) : '';
      });
      for (const [rid, b] of map) if (!seen.has(rid)) { b.remove(); map.delete(rid); }

      wrap._foot.innerHTML = '';
      wrap._foot.append(
        el('span', { class: 'pill cyan' }, [`已排序区 ${p.sortedUpTo + 1} / ${p.total}`]),
        el('span', { class: 'pill' }, [p.asc ? '↑ 升序' : '↓ 降序']),
        el('span', { class: 'pill gold' }, [`当前元素 ${fmt(p.items.find((i) => i.isKey)?.value ?? '—')}`]),
      );
    },
    destroy() { },
  };
}

/* ================================================================
 * 3. 归约舞台 —— 累加器
 * ================================================================ */
export function makeReduce(host) {
  let wrap = null;
  return {
    update(p) {
      if (!wrap || wrap._fn !== p.fn) {
        host.innerHTML = '';
        // 左侧固定宽度放累加器，右侧把剩余空间全部给「点阵 + 数值芯片」
        wrap = el('div', { class: 'st-split', style: { gridTemplateColumns: '272px minmax(0, 1fr)' } });
        wrap._fn = p.fn;
        wrap._left = el('div', { class: 'st-col', style: { justifyContent: 'center', alignItems: 'center' } });
        wrap._right = el('div', { class: 'st-col' });
        wrap.append(wrap._left, wrap._right);
        host.appendChild(wrap);
        wrap._stripHost = el('div', { style: { minHeight: '70px', flex: 'none' } });
        wrap._strip = makeStrip(wrap._stripHost);
        wrap._right.append(wrap._stripHost);
        wrap._vals = el('div', { class: 'chipgrid', style: { flex: '1 1 auto', minHeight: '0' } });
        wrap._right.append(wrap._vals);
        wrap._acc = el('div', { class: 'acc', style: { width: '100%' } });
        wrap._accK = el('div', { class: 'acc-k' });
        wrap._accV = el('div', { class: 'acc-v' });
        wrap._acc.append(wrap._accK, wrap._accV);
        wrap._meta = el('div', { class: 'st-row', style: { flexWrap: 'wrap', justifyContent: 'center' } });
        wrap._left.append(wrap._acc, wrap._meta);
        wrap._cells = new Map();
      }
      const dom = { min: p.dom.min - (p.dom.max - p.dom.min) * 0.08, max: p.dom.max + (p.dom.max - p.dom.min) * 0.08 };
      wrap._strip.update({
        dom,
        points: p.entries.map((e) => ({ i: e.i, t: e.t, value: e.value, name: e.name, status: e.consumed ? (e.na ? 'na' : 'seen') : 'unseen' })),
        cursor: p.cursor, minIdx: -1, maxIdx: -1, phase: 'scan',
      });
      // 右侧数值芯片
      const seen = new Set();
      p.entries.forEach((e) => {
        seen.add(e.i);
        let c = wrap._cells.get(e.i);
        if (!c) {
          c = el('div', { class: 'cg-cell' });
          wrap._vals.appendChild(c);
          wrap._cells.set(e.i, c);
        }
        c.textContent = `${e.name} ${fmt(e.value)}`;
        c.className = 'cg-cell' + (e.na ? ' f' : e.consumed ? ' t' : '');
      });
      for (const [i, c] of wrap._cells) if (!seen.has(i)) { c.remove(); wrap._cells.delete(i); }

      wrap._accK.textContent = p.displayLabel || (p.fn === 'sum' ? '累加器 Σx' : '结果');
      wrap._accV.textContent = p.display !== undefined ? fmt(p.display) : fmt(p.runningSum);
      wrap._acc.classList.toggle('final', !!p.final);
      wrap._meta.innerHTML = '';
      wrap._meta.append(
        el('span', { class: 'pill cyan' }, [`Σx = ${fmt(p.runningSum)}`]),
        el('span', { class: 'pill' }, [`n = ${p.runningCount}`]),
        el('span', { class: 'pill gold' }, [`已处理 ${Math.max(0, p.cursor + 1)} / ${p.total || p.entries.length}`]),
      );
    },
    destroy() { },
  };
}

/* ================================================================
 * 4. 通用图表 —— hist / bar / line / scatter / box
 * ================================================================ */
export function makeChart(host) {
  let root = null, kind = '';
  const PAD = { l: 42, r: 16, t: 20, b: 30 };

  function mount(type) {
    host.innerHTML = '';
    root = el('div', { class: 'plot-wrap' });
    host.appendChild(root);
    kind = type;
  }

  function size() {
    const w = Math.max(200, root.clientWidth || host.clientWidth || 520);
    const h = Math.max(140, root.clientHeight || host.clientHeight || 240);
    return { w, h };
  }

  function axes(s, xTitle, yTitle) {
    const g = svg('g');
    g.appendChild(svg('line', { x1: PAD.l, y1: s.h - PAD.b, x2: s.w - PAD.r, y2: s.h - PAD.b, class: 'axis-line' }));
    g.appendChild(svg('line', { x1: PAD.l, y1: PAD.t, x2: PAD.l, y2: s.h - PAD.b, class: 'axis-line' }));
    if (xTitle) g.appendChild(txt(s.w - PAD.r, s.h - PAD.b + 20, xTitle, 'axis-title', { 'text-anchor': 'end' }));
    if (yTitle) g.appendChild(txt(PAD.l - 6, PAD.t - 6, yTitle, 'axis-title', { 'text-anchor': 'end' }));
    return g;
  }

  return {
    update(p) {
      if (!root || kind !== p.type) mount(p.type);
      const s = size();
      const g = [];
      // 箱线图没有 counts/bars/points，要单独认出来，否则会被误判成「空数据」
      if (!(p.counts?.length || p.bars?.length || p.points?.length || Number.isFinite(p.q1))) {
        root.innerHTML = '';
        root.appendChild(el('div', { class: 'empty-stage' }, [
          el('div', { class: 't' }, ['没有可绘制的数据']),
          el('div', { class: 'h' }, ['当前列没有有效数值，或数据已被上一步过滤为空。']),
        ]));
        return;
      }
      if (p.type === 'hist' || p.type === 'bar') {
        const items = p.type === 'hist'
          ? p.counts.map((c, i) => ({ label: p.labels[i], value: c }))
          : p.bars.map((b) => ({ label: b.key, value: b.value }));
        const maxV = Math.max(1, ...items.map((i) => (Number.isFinite(i.value) ? i.value : 0)));
        const iw = (s.w - PAD.l - PAD.r) / Math.max(1, items.length);
        const baseY = s.h - PAD.b;
        const plotH = s.h - PAD.t - PAD.b;
        g.push(axes(s, p.type === 'hist' ? `${p.col}${p.unit ? ' (' + p.unit + ')' : ''}` : p.x, p.type === 'hist' ? '频数' : '数量'));
        // 网格
        for (let i = 1; i <= 3; i++) {
          const y = PAD.t + plotH * (1 - i / 4);
          g.push(svg('line', { x1: PAD.l, y1: y, x2: s.w - PAD.r, y2: y, class: 'grid-line' }));
          g.push(txt(PAD.l - 6, y + 3, String(Math.round(maxV * i / 4)), 'axis-text', { 'text-anchor': 'end' }));
        }
        items.forEach((it, i) => {
          const h = Number.isFinite(it.value) ? plotH * (it.value / maxV) : 0;
          const x = PAD.l + i * iw + iw * 0.12;
          const bw = iw * 0.76;
          const peak = p.peak === i || it.value === maxV;
          g.push(svg('rect', {
            x, y: baseY - plotH, width: bw, height: plotH,
            rx: Math.min(4, bw / 3),
            class: 'bar-rect',
            fill: peak ? 'url(#gradGold)' : (p.done ? 'url(#gradCyan)' : 'url(#gradViolet)'),
            style: {
              transformOrigin: `${x}px ${baseY}px`,
              transform: `scaleY(${Math.max(0.001, h / plotH)})`,
              opacity: it.value === 0 ? 0.25 : 1,
            },
            'data-v': it.value,
          }));
          if (items.length <= 16 || i % 2 === 0) {
            g.push(txt(x + bw / 2, baseY + 14, String(it.label).slice(0, 7), 'axis-text', { 'text-anchor': 'middle' }));
          }
          if (it.value > 0) g.push(txt(x + bw / 2, baseY - h - 4, String(it.value), 'axis-text', { 'text-anchor': 'middle', style: 'fill:var(--txt-1);font-weight:600' }));
        });
      } else if (p.type === 'line') {
        const n = p.points.length;
        const plotW = s.w - PAD.l - PAD.r, plotH = s.h - PAD.t - PAD.b;
        const X = (i) => PAD.l + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
        const Y = (t) => PAD.t + (1 - t) * plotH;
        g.push(axes(s, p.x, p.y));
        for (let i = 1; i <= 3; i++) {
          const y = PAD.t + plotH * (1 - i / 4);
          g.push(svg('line', { x1: PAD.l, y1: y, x2: s.w - PAD.r, y2: y, class: 'grid-line' }));
          g.push(txt(PAD.l - 6, y + 3, fmt(p.dom.min + (p.dom.max - p.dom.min) * i / 4, 1), 'axis-text', { 'text-anchor': 'end' }));
        }
        const path = p.points.slice(0, p.progress)
          .filter((pt) => pt.t !== null && Number.isFinite(pt.t) && Number.isFinite(X(pt.i)))
          .map((pt, k) => `${k === 0 ? 'M' : 'L'}${X(pt.i).toFixed(1)},${Y(pt.t).toFixed(1)}`).join(' ');
        g.push(svg('path', { d: path, fill: 'none', stroke: 'url(#gradCyan)', 'stroke-width': 2.4, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
        g.push(svg('path', {
          d: path + (path ? ` L${X(p.progress - 1)},${s.h - PAD.b} L${X(0)},${s.h - PAD.b} Z` : ''),
          fill: 'url(#gradArea)', stroke: 'none', opacity: 0.5,
        }));
        p.points.forEach((pt, i) => {
          if (pt.t === null || !Number.isFinite(pt.t)) return;
          const on = i < p.progress;
          g.push(svg('circle', {
            cx: X(i), cy: Y(pt.t), r: on ? 3.4 : 0, fill: on ? '#35e6dd' : 'transparent',
            stroke: '#0a0f1f', 'stroke-width': 1.4,
            style: { transition: 'r .35s ease, cx .5s ease, cy .5s ease' },
          }));
        });
      } else if (p.type === 'scatter') {
        const plotW = s.w - PAD.l - PAD.r, plotH = s.h - PAD.t - PAD.b;
        const X = (t) => PAD.l + t * plotW;
        const Y = (t) => PAD.t + (1 - t) * plotH;
        g.push(axes(s, p.x, p.y));
        for (let i = 1; i <= 3; i++) {
          const y = PAD.t + plotH * (1 - i / 4);
          const x = PAD.l + plotW * i / 4;
          g.push(svg('line', { x1: PAD.l, y1: y, x2: s.w - PAD.r, y2: y, class: 'grid-line' }));
          g.push(svg('line', { x1: x, y1: PAD.t, x2: x, y2: s.h - PAD.b, class: 'grid-line' }));
          g.push(txt(PAD.l - 6, y + 3, fmt(p.dom.y.min + (p.dom.y.max - p.dom.y.min) * i / 4, 1), 'axis-text', { 'text-anchor': 'end' }));
        }
        p.points.forEach((pt, i) => {
          if (!pt.ok || !Number.isFinite(pt.tx) || !Number.isFinite(pt.ty)) return;
          const on = i < p.progress;
          g.push(svg('circle', {
            cx: X(pt.tx), cy: Y(pt.ty), r: on ? 5 : 0,
            fill: 'rgba(53,230,221,0.55)', stroke: '#35e6dd', 'stroke-width': 1.4,
            style: { transition: 'r .45s cubic-bezier(.34,1.56,.64,1)' },
          }, [svg('title', {}, [])]));
        });
      } else if (p.type === 'box') {
        const plotW = s.w - PAD.l - PAD.r, plotH = s.h - PAD.t - PAD.b;
        const lo = Number.isFinite(p.dom?.min) ? p.dom.min : 0;
        const hi = Number.isFinite(p.dom?.max) && p.dom.max > lo ? p.dom.max : lo + 1;
        if (![p.q1, p.q2, p.q3, p.wLo, p.wHi].every(Number.isFinite)) {
          root.innerHTML = '';
          root.appendChild(el('div', { class: 'empty-stage' }, [
            el('div', { class: 't' }, ['无法绘制箱线图']),
            el('div', { class: 'h' }, [`「${p.col}」的有效数值不足以计算四分位数。`]),
          ]));
          return;
        }
        const Y = (v) => PAD.t + (1 - (v - lo) / (hi - lo)) * plotH;
        const cx = PAD.l + plotW * 0.34;
        const bw = Math.min(124, plotW * 0.2);
        g.push(axes(s, '', p.col));
        // 数值刻度用「整齐值」，而不是带小数的坐标域端点
        for (const v of niceTicks(lo, hi, 6)) {
          const y = Y(v);
          g.push(svg('line', { x1: PAD.l, y1: y, x2: s.w - PAD.r, y2: y, class: 'grid-line' }));
          g.push(txt(PAD.l - 6, y + 3, fmt(v), 'axis-text', { 'text-anchor': 'end' }));
        }
        // 右侧「地毯图」：把每个原始数据点画成一个小刻度，一眼看清样本密度
        if (p.rug && p.rug.length) {
          const rx = cx + bw / 2 + 58;
          const jit = (i) => ((i % 7) - 3) * 5;
          p.rug.forEach((v, i) => {
            if (!Number.isFinite(v)) return;
            g.push(svg('circle', {
              cx: rx + jit(i), cy: Y(v), r: 3,
              fill: 'rgba(53,230,221,.42)', stroke: 'rgba(53,230,221,.75)', 'stroke-width': 1,
            }));
          });
          g.push(txt(rx, PAD.t - 6, `${p.col} 全部数据点`, 'axis-title', { 'text-anchor': 'middle', style: 'fill:var(--txt-3)' }));
        }
        const show = p.step !== 'quartiles';
        // 须
        if (show) {
          [['wLo', p.wLo], ['wHi', p.wHi]].forEach(([k, v]) => {
            g.push(svg('line', { x1: cx, y1: Y(p.q3), x2: cx, y2: Y(p.wLo), stroke: 'rgba(122,145,210,0.55)', 'stroke-width': 1.6, 'stroke-dasharray': '4 3' }));
            g.push(svg('line', { x1: cx, y1: Y(p.q1), x2: cx, y2: Y(p.wHi), stroke: 'rgba(122,145,210,0.55)', 'stroke-width': 1.6, 'stroke-dasharray': '4 3' }));
          });
          g.push(svg('line', { x1: cx - bw / 2, y1: Y(p.wLo), x2: cx + bw / 2, y2: Y(p.wLo), stroke: '#8b9ac4', 'stroke-width': 2 }));
          g.push(svg('line', { x1: cx - bw / 2, y1: Y(p.wHi), x2: cx + bw / 2, y2: Y(p.wHi), stroke: '#8b9ac4', 'stroke-width': 2 }));
          g.push(txt(cx + bw / 2 + 6, Y(p.wLo) + 3, `下须 ${fmt(p.wLo)}`, 'axis-text'));
          g.push(txt(cx + bw / 2 + 6, Y(p.wHi) + 3, `上须 ${fmt(p.wHi)}`, 'axis-text'));
        }
        // 箱体
        const yTop = Y(p.q3), yBot = Y(p.q1);
        g.push(svg('rect', {
          x: cx - bw / 2, y: yTop, width: bw, height: Math.max(2, yBot - yTop), rx: 4,
          fill: 'rgba(53,230,221,0.16)', stroke: 'rgba(53,230,221,0.7)', 'stroke-width': 1.4,
          style: { transition: 'all .6s cubic-bezier(.16,1,.3,1)' },
        }));
        g.push(svg('line', { x1: cx - bw / 2, y1: Y(p.q2), x2: cx + bw / 2, y2: Y(p.q2), stroke: '#ffd45e', 'stroke-width': 2.6, style: { transition: 'y1 .6s, y2 .6s' } }));
        g.push(txt(cx - bw / 2 - 6, yTop - 4, `Q3 ${fmt(p.q3)}`, 'axis-text', { 'text-anchor': 'end', style: 'fill:var(--txt-2)' }));
        g.push(txt(cx - bw / 2 - 6, Y(p.q2) + 3, `中位数 ${fmt(p.q2)}`, 'axis-text', { 'text-anchor': 'end', style: 'fill:var(--gold)' }));
        g.push(txt(cx - bw / 2 - 6, yBot + 11, `Q1 ${fmt(p.q1)}`, 'axis-text', { 'text-anchor': 'end', style: 'fill:var(--txt-2)' }));
        // IQR 标注
        g.push(svg('line', { x1: cx + bw / 2 + 10, y1: yTop, x2: cx + bw / 2 + 10, y2: yBot, stroke: 'rgba(169,139,255,0.7)', 'stroke-width': 1.4 }));
        g.push(txt(cx + bw / 2 + 15, (yTop + yBot) / 2 + 3, `IQR ${fmt(p.q3 - p.q1)}`, 'axis-text', { style: 'fill:var(--violet)' }));
        // 离群点
        if (p.step === 'outliers' || p.done) {
          (p.outliers || []).forEach((o, i) => {
            g.push(svg('circle', {
              cx: cx + (i % 2 ? -bw / 2 - 26 : -bw / 2 - 26), cy: Y(o.v), r: 5.5,
              fill: 'rgba(255,107,138,0.75)', stroke: '#ffb3c4', 'stroke-width': 1.4,
              style: { animation: 'champPop .8s cubic-bezier(.34,1.56,.64,1) both', animationDelay: (i * 90) + 'ms' },
            }, [svg('title', {}, [])]));
          });
          (p.outliers || []).forEach((o, i) => {
            g.push(txt(cx - bw / 2 - 38, Y(o.v) + 3, `${o.name} ${fmt(o.v)}`, 'axis-text', { 'text-anchor': 'end', style: 'fill:var(--rose)' }));
          });
        }
      }

      const root2 = svg('svg', { viewBox: `0 0 ${s.w} ${s.h}`, width: s.w, height: s.h }, [
        svg('defs', {}, [
          svg('linearGradient', { id: 'gradCyan', x1: '0', y1: '0', x2: '1', y2: '0' }, [
            svg('stop', { offset: '0%', 'stop-color': '#35e6dd' }), svg('stop', { offset: '100%', 'stop-color': '#a98bff' })]),
          svg('linearGradient', { id: 'gradViolet', x1: '0', y1: '0', x2: '0', y2: '1' }, [
            svg('stop', { offset: '0%', 'stop-color': '#a98bff' }), svg('stop', { offset: '100%', 'stop-color': 'rgba(109,79,214,0.55)' })]),
          svg('linearGradient', { id: 'gradGold', x1: '0', y1: '0', x2: '0', y2: '1' }, [
            svg('stop', { offset: '0%', 'stop-color': '#ffd45e' }), svg('stop', { offset: '100%', 'stop-color': 'rgba(255,194,71,0.5)' })]),
          svg('linearGradient', { id: 'gradArea', x1: '0', y1: '0', x2: '0', y2: '1' }, [
            svg('stop', { offset: '0%', 'stop-color': 'rgba(53,230,221,0.36)' }), svg('stop', { offset: '100%', 'stop-color': 'rgba(53,230,221,0)' })]),
        ]),
        ...g,
      ]);
      root.innerHTML = '';
      root.appendChild(root2);
      this._p = p;
    },
    destroy() { },
  };
}

/* ================================================================
 * 5. 排序后的竖条（sort_values / median 结果）
 * ================================================================ */
export function makeSortedBars(host) {
  let root = null;
  return {
    update(p) {
      if (!root) { host.innerHTML = ''; root = el('div', { class: 'st-flex' }); host.appendChild(root); root._title = el('div', { class: 'pill cyan' }); root._bars = el('div', { class: 'sorted-bars' }); root.append(root._title, root._bars); }
      root._title.textContent = p.title || `${p.by} 升序`;
      const vs = (p.values || []).filter((v) => typeof v === 'number' && Number.isFinite(v));
      if (!vs.length) { clear(root._bars); return; }
      const lo = Math.min(...vs), hi = Math.max(...vs);
      const max = Math.max(...vs.map(Math.abs)) || 1;
      const cur = root._bars.children.length;
      if (cur !== vs.length) {
        clear(root._bars);
        vs.forEach(() => root._bars.appendChild(el('i', { class: 'sb-bar' })));
      }
      [...root._bars.children].forEach((b, i) => {
        const h = ((vs[i] - lo) / (hi - lo || 1)) * 100;
        b.style.height = Math.max(2, h) + '%';
        b.style.background = (p.highlight || []).includes(i)
          ? 'linear-gradient(180deg, #ffd45e, rgba(255,194,71,.35))'
          : 'linear-gradient(180deg, rgba(53,230,221,.85), rgba(53,230,221,.25))';
        b.title = `${p.labels?.[i] ?? i} = ${fmt(vs[i])}`;
        b.style.transitionDelay = (i * 8) + 'ms';
      });
      if (p.median !== undefined) {
        root._title.textContent = (p.title || '') + `　中位数 = ${fmt(p.median)}`;
      }
    },
    destroy() { },
  };
}

/* ================================================================
 * 6. 分箱直方图（用于对比卡片里的小图）
 * ================================================================ */
export function miniHist(h, opts = {}) {
  const box = el('div', { class: 'cmp-hist' });
  const hs = h?.counts || [];
  const max = Math.max(1, ...hs);
  hs.forEach((c) => box.appendChild(el('i', { style: { height: (c / max * 100) + '%' } })));
  return box;
}
