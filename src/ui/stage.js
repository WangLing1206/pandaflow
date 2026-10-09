/* ------------------------------------------------------------------
 * ui/stage.js — 舞台调度器
 *  ----------------------------------------------------------------
 *  舞台是「步骤专属的可视化画布」。调度器按 stage.kind 选择渲染器，
 *  kind 不变时复用 DOM（从而产生补间动画），kind 变化时重建并播放入场动画。
 * ------------------------------------------------------------------ */

import { el, clear, fmt, clamp } from '../core/utils.js';
import { makeStrip, makeSorter, makeReduce, makeChart, makeSortedBars, miniHist, svg } from './viz.js';

/* ------------------------------ 小工具 ------------------------------ */
const card = (k, v, sub, tone) => el('div', { class: 'card', data: { tone: tone || 'info' } }, [
  el('div', { class: 'card-k' }, [k]),
  el('div', { class: 'card-v' }, [v]),
  sub ? el('div', { class: 'card-sub' }, [sub]) : null,
]);

const pill = (t, cls = '') => el('span', { class: `pill ${cls}` }, [t]);

/**
 * 统计量的紧凑网格（2 行 × 3 列）。
 * 之前的竖排 6 行在 250px 高的舞台里会溢出并和下方内容叠在一起。
 */
const statGrid = (s, unit = '') => {
  if (!s || !Number.isFinite(s.mean)) {
    return el('div', { class: 'statgrid empty' }, [el('span', { class: 'sg-k' }, ['无可用数值统计'])]);
  }
  const cells = [
    ['count', String(s.n), ''],
    ['mean', fmt(s.mean), unit],
    ['std', fmt(s.std), ''],
    ['min', fmt(s.min), unit],
    ['50%', fmt(s.median), unit],
    ['max', fmt(s.max), unit],
  ];
  return el('div', { class: 'statgrid' }, cells.map(([k, v, u]) => el('div', { class: 'sg-cell' }, [
    el('span', { class: 'sg-k' }, [k]),
    el('span', { class: 'sg-v' }, [v + u]),
  ])));
};

/* ==================================================================
 * 各 kind 的渲染器
 * ================================================================== */
const R = {};

/* ------------------------- ★ 极值扫描 ------------------------- */
R.extremes = (host) => {
  let root = null, strip = null;
  return {
    update(p) {
      if (!root) {
        host.innerHTML = '';
        root = el('div', { class: 'st-flex' });
        root._stripHost = el('div', { class: 'st-grow', style: { minHeight: '70px' } });
        root._row1 = el('div', { class: 'cards-row', style: { flexWrap: 'nowrap', flex: 'none' } });
        root._note = el('div', { class: 'st-row', style: { flexWrap: 'wrap', flex: 'none' } });
        root.append(root._stripHost, root._row1, root._note);
        host.appendChild(root);
        strip = makeStrip(root._stripHost);
      }
      strip.update(p);

      const { challenger, verdict, minIdx, maxIdx, points } = p;
      const vMin = minIdx >= 0 ? points?.[minIdx]?.value : null;
      const vMax = maxIdx >= 0 ? points?.[maxIdx]?.value : null;
      const nMax = maxIdx >= 0 ? points?.[maxIdx]?.name : '';
      const nMin = minIdx >= 0 ? points?.[minIdx]?.name : '';

      /* 单行三卡：挑战者 / 当前最大 / 当前最小 —— 保证一屏放得下 */
      clear(root._row1);
      if (challenger && p.phase !== 'lock' && !p.target) {
        root._row1.appendChild(el('div', { class: 'challenger' }, [
          el('div', { class: 'challenger-label' }, ['挑战者 challenger']),
          el('div', { class: 'challenger-value' }, [fmt(challenger.value) + (p.unit || '')]),
          el('div', { class: 'challenger-name' }, [`${challenger.name} · 索引 ${challenger.i}`]),
        ]));
      }
      if (p.target) {
        root._row1.appendChild(el('div', { class: 'challenger', style: { borderStyle: 'solid', borderColor: 'rgba(255,107,138,.6)' } }, [
          el('div', { class: 'challenger-label', style: { color: 'var(--rose)' } }, ['即将删除 drop target']),
          el('div', { class: 'challenger-value', style: { color: '#ffb3c4' } }, [fmt(p.target.value) + (p.unit || '')]),
          el('div', { class: 'challenger-name' }, [`${p.target.name} · index ${p.target.i}`]),
        ]));
      }
      const mkChamp = (kind, v, nm, idx, changed) => el('div', { class: `champ ${kind}${changed ? ' justChanged' : ''}` }, [
        el('div', { class: 'champ-label' }, [kind === 'max' ? '当前最大值 champion' : '当前最小值 champion']),
        el('div', { class: 'champ-value' }, [v === null ? '—' : fmt(v) + (p.unit || '')]),
        el('div', { class: 'champ-name' }, [nm || '尚未建立', el('span', { class: 'champ-idx' }, [idx >= 0 ? `idx ${idx}` : ''])]),
      ]);
      root._row1.append(
        mkChamp('max', vMax, nMax, maxIdx, verdict === 'newMax' || verdict === 'newBoth'),
        mkChamp('min', vMin, nMin, minIdx, verdict === 'newMin' || verdict === 'newBoth'),
      );

      /* 注释行（含判定结论） */
      clear(root._note);
      if (verdict) {
        const map = {
          newMax: ['击败当前最大值 → 最大值易主', 'fail'],
          newMin: ['低于当前最小值 → 最小值易主', 'pass'],
          newBoth: ['同时改写最大值与最小值', 'fail'],
          none: ['未能改写任何一个擂主', 'hold'],
          aboutToDelete: ['该行已被 drop() 锁定', 'fail'],
          deleted: ['已摘除，索引留下断层', 'hold'],
          lock: ['扫描结束，两个极值已确定', 'pass'],
          reset: ['索引已重新编号', 'pass'],
        }[verdict] || [verdict, 'hold'];
        root._note.appendChild(el('div', { class: `verdict ${map[1]}` }, [
          el('span', {}, [map[1] === 'hold' ? '·' : (map[1] === 'pass' ? '✓' : '!')]),
          el('span', {}, [map[0]]),
        ]));
      }
      if (p.phase === 'intro' && p.summary) {
        root._note.append(...[
          pill(`n = ${p.summary.n}`, 'cyan'),
          pill(`mean = ${fmt(p.summary.mean)}`, ''),
          pill(`std = ${fmt(p.summary.std)}`, ''),
          pill(`极差 = ${fmt(p.summary.max - p.summary.min)}${p.unit || ''}`, 'gold'),
          pill('扫描尚未开始', ''),
        ]);
      } else if (p.phase === 'intro2') {
        root._note.append(pill('比较规则：' + (p.rule || ''), 'cyan'), pill('idxmax / idxmin 都只做一遍顺序扫描', ''));
      } else if (p.phase === 'scan' && p.progress) {
        const [a, b] = p.progress;
        root._note.append(
          pill(`扫描进度 ${a} / ${b}`, 'cyan'),
          pill(`已比较 ${Math.min(p.scannedUpTo + 1, p.total)} / ${p.total} 行`, ''),
          pill(p.verdict === 'none' ? '本步无易主' : '本步冠军易主', p.verdict && p.verdict !== 'none' ? 'gold' : ''),
        );
      } else if (p.phase === 'delete') {
        root._note.append(
          pill(`已删除 ${p.removedCount || 0} 行`, 'rose'),
          pill('注意索引断层：pandas 不会自动补位', ''),
        );
      } else if (p.phase === 'reset') {
        root._note.append(pill('reset_index(drop=True)', 'cyan'), pill('索引缝合完成', 'emerald'));
      } else if (p.phase === 'lock') {
        root._note.append(
          pill(p.markDelete ? `待删除索引 [${p.markDelete.join(', ')}]` : '两个极值已锁定', p.markDelete ? 'rose' : 'emerald'),
          pill('极值分散在不同位置 —— 必须完整扫描', ''),
        );
      }
    },
    destroy() { strip?.destroy(); },
  };
};

/* ------------------------- 前后对比 ------------------------- */
R.compare = (host) => {
  let root = null;
  return {
    update(p) {
      if (!root) {
        host.innerHTML = '';
        root = el('div', { class: 'st-flex' });
        host.appendChild(root);
      }
      const unit = p.unit || '';
      const side = (o, cls) => el('div', { class: `cmp-side ${cls}` }, [
        el('div', { class: 'st-row', style: { gap: '8px' } }, [
          el('span', { class: 'pill ' + (cls === 'after' ? 'emerald' : '') }, [cls === 'after' ? '处理后 after' : '处理前 before']),
          el('span', { class: 'cmp-shape' }, [`${o.shape[0]} × ${o.shape[1]}`]),
        ]),
        o.hist ? miniHist(o.hist) : el('div', { class: 'cmp-hist' }),
        statGrid(o.stats, unit),
      ]);
      const arrow = el('div', { class: 'cmp-arrow' }, [
        svg('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.6 }, [
          svg('path', { d: 'M4 12h15M13 6l6 6-6 6', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }),
        ]),
      ]);
      root.innerHTML = '';
      root.appendChild(el('div', { class: 'cmp' }, [side(p.before, 'before'), arrow, side(p.after, 'after')]));

      if (p.statsDelta) {
        root.appendChild(el('div', { class: 'st-row' }, p.statsDelta.map((d) => pill(d, 'gold'))));
      }
      const removed = (p.removed || []).filter((r) => r);
      if (removed.length) {
        const list = el('div', { class: 'rm-strip' });
        removed.slice(0, 8).forEach((r, i) => {
          const kindLabel = { max: '最大值', min: '最小值', na: '缺失值', dup: '重复行' }[r.kind] || '已处理';
          list.appendChild(el('div', { class: 'rm-item', style: { animationDelay: (i * 70) + 'ms' } }, [
            el('span', { class: 'pill rose' }, [kindLabel]),
            el('span', { class: 'n' }, [`索引 ${r.i}`, r.name ? ` · ${r.name}` : '']),
            el('span', { class: 'v' }, [fmt(r.value) + (r.clamped !== undefined ? ` → ${fmt(r.clamped)}` : '')]),
          ]));
        });
        if (removed.length > 8) list.appendChild(el('div', { class: 'rm-item' }, [el('span', { class: 'n' }, [`… 共 ${removed.length} 项`])]));
        root.appendChild(list);
      }
    },
    destroy() { },
  };
};

/* ------------------------- clip 区间 ------------------------- */
R.range = (host) => {
  let root = null, strip = null;
  return {
    update(p) {
      if (!root) {
        host.innerHTML = '';
        root = el('div', { class: 'st-flex' });
        root._h = el('div', { class: 'st-grow', style: { minHeight: '86px' } });
        root._note = el('div', { class: 'st-row', style: { flexWrap: 'wrap' } });
        root.append(root._h, root._note);
        host.appendChild(root);
        strip = makeStrip(root._h);
      }
      strip.update({
        dom: p.dom, points: p.points, cursor: -1, minIdx: -1, maxIdx: -1, phase: 'range',
      });
      clear(root._note);
      root._note.append(
        pill(p.label, 'cyan'),
        pill(`允许区间下界 ${fmt(p.lo)}`, 'violet'),
        pill(`上界 ${fmt(p.hi)}`, 'rose'),
        pill(`${(p.points || []).filter((x) => x.status === 'out').length} 个值越界`, 'gold'),
      );
    },
    destroy() { strip?.destroy(); },
  };
};

/* ------------------------- Top-N 榜单 ------------------------- */
R.rank = (host) => {
  let root = null, strip = null;
  return {
    update(p) {
      if (!root) {
        host.innerHTML = '';
        root = el('div', { class: 'st-split' });
        root._l = el('div', { class: 'st-col' });
        root._h = el('div', { class: 'st-grow' });
        root._l.append(root._h);
        root._r = el('div', { class: 'st-col' });
        root._list = el('div', { class: 'rank-list' });
        root._r.append(el('div', { class: 'card-k' }, [`${p.col} Top-${p.n}`]), root._list);
        root.append(root._l, root._r);
        host.appendChild(root);
        strip = makeStrip(root._h);
      }
      if (p.points && p.points.length) strip.update({ dom: p.dom, points: p.points, cursor: -1, minIdx: -1, maxIdx: -1, phase: 'scan' });
      clear(root._list);
      (p.ranked || []).forEach((o, i) => {
        root._list.appendChild(el('div', { class: 'rank-item' + (i === 0 ? ' top' : ''), style: { animationDelay: (i * 60) + 'ms' } }, [
          el('span', { class: 'rank-no' }, [String(i + 1)]),
          el('span', { class: 'rank-name' }, [`索引 ${o.i} · ${o.name || ''}`]),
          el('span', { class: 'rank-val' }, [fmt(o.v) + (p.unit || '')]),
        ]));
      });
      if (p.threshold !== undefined) {
        root._list.appendChild(el('div', { class: 'st-row', style: { marginTop: '6px' } }, [
          pill(`入榜门槛 ${fmt(p.threshold)}${p.unit || ''}`, 'gold'),
        ]));
      }
    },
    destroy() { strip?.destroy(); },
  };
};

/* ------------------------- 缺失值热力图 ------------------------- */
R.nullmap = (host) => {
  let root = null;
  return {
    update(p) {
      if (!root) {
        host.innerHTML = '';
        root = el('div', { class: 'st-flex' });
        root._grid = el('div', { class: 'nullmap' });
        root._note = el('div', { class: 'st-row', style: { flexWrap: 'wrap' } });
        root.append(root._grid, root._note);
        host.appendChild(root);
      }
      clear(root._grid);
      p.columns.forEach((col, ci) => {
        const row = el('div', { class: 'nm-row' + (col.nulls && col.nulls > 0 ? ' has' : '') + (p.subset && !p.subset.includes(col.name) ? ' skip' : '') }, [
          el('div', { class: 'nm-label', title: col.name }, [col.name]),
          el('div', { class: 'nm-cells' }, col.cells.map((isNull, i) => el('i', {
            class: 'nm-cell' + (isNull ? ' na' : '') + (p.cursor === i ? ' cur' : '') + (p.kept !== undefined && i < p.kept ? ' kept' : ''),
            style: { animationDelay: `${Math.min(i * 8, 400)}ms` },
          }))),
          el('div', { class: 'nm-count' }, [col.nulls ? String(col.nulls) : '—']),
        ]);
        root._grid.appendChild(row);
      });
      clear(root._note);
      if (p.explain) root._note.append(pill('how="any"：任一字段缺失即整行丢弃', 'rose'));
      if (p.collapsed) root._note.append(pill(`删除完成 · 保留 ${p.kept} 行`, 'emerald'));
      if (p.done) root._note.append(
        pill(`行数 ${p.kept}`, 'emerald'),
        ...p.columns.map((c) => pill(`${c.name}: ${(p.afterNulls?.[c.name] ?? 0)} 缺失`, (p.afterNulls?.[c.name] ?? 0) ? 'rose' : '')),
      );
      if (!p.explain && !p.collapsed && !p.done) {
        root._note.append(
          pill(`每列缺失数见右侧`, 'cyan'),
          pill(`${p.badRows?.length ?? 0} 行将被整行删除`, 'rose'),
        );
      }
    },
    destroy() { },
  };
};

/* ------------------------- 填充列 ------------------------- */
R.fillcol = (host) => {
  let root = null;
  return {
    update(p) {
      if (!root) {
        host.innerHTML = '';
        root = el('div', { class: 'st-flex' });
        root._grid = el('div', { class: 'fillgrid' });
        root._note = el('div', { class: 'st-row', style: { flexWrap: 'wrap' } });
        root.append(root._grid, root._note);
        host.appendChild(root);
      }
      const max = Math.max(1, ...p.entries.map((e) => (typeof e.value === 'number' ? e.value : 0)));
      root._grid.innerHTML = '';
      p.entries.forEach((e) => {
        const filled = e.fill !== null && e.fill !== undefined;
        const cur = p.cursor === e.i;
        const node = el('div', {
          class: 'fg-item' + (e.na ? ' na' : '') + (filled ? ' filled' : '') + (cur ? ' cur' : ''),
        }, [
          el('div', { class: 'fg-name' }, [e.name]),
          el('div', { class: 'fg-bar' }, [el('i', { style: { width: filled ? clamp(e.fill / max * 100, 6, 100) + '%' : '0%' } })]),
          el('div', { class: 'fg-val' }, [e.na && !filled ? 'NaN' : fmt(filled ? e.fill : e.value)]),
        ]);
        root._grid.appendChild(node);
      });
      clear(root._note);
      root._note.append(
        pill(`待填充 ${p.missIdx.length} 处`, 'gold'),
        pill(`策略：${p.repr}`, 'cyan'),
        pill(`已完成 ${Object.keys(p.fillMap).length}`, filled2(p.fillMap) ? 'emerald' : ''),
      );
      function filled2(m) { return Object.keys(m).length > 0; }
    },
    destroy() { },
  };
};

/* ------------------------- 行指纹 ------------------------- */
R.fingerprint = (host) => {
  let root = null;
  return {
    update(p) {
      if (!root) {
        host.innerHTML = '';
        root = el('div', { class: 'st-flex' });
        root._grid = el('div', { class: 'fg-print' });
        root._note = el('div', { class: 'st-row', style: { flexWrap: 'wrap' } });
        root.append(root._grid, root._note);
        host.appendChild(root);
      }
      root._grid.innerHTML = '';
      p.entries.forEach((e) => {
        root._grid.appendChild(el('div', {
          class: 'fp-chip' + (e.checked ? ' checked' : '') + (e.duplicate ? ' dup' : ''),
          style: { animationDelay: `${Math.min(e.i * 14, 700)}ms` },
          title: `${e.name} · 指纹 ${e.hash}${e.duplicate ? `（与索引 ${e.originIdx} 相同）` : ''}`,
        }, [
          el('span', { class: 'fp-h' }, [e.hash]),
          el('span', { class: 'fp-n' }, [e.name]),
          e.duplicate ? el('span', { class: 'fp-x' }, [`= #${e.originIdx}`]) : null,
        ]));
      });
      clear(root._note);
      root._note.append(
        pill(`判重字段：${(p.subset || []).length === 9 ? '全部' : (p.subset || []).join('+')}`, 'cyan'),
        pill(`已计算指纹 ${p.seenCount} / ${p.total}`, ''),
        pill(`重复 ${p.entries.filter((e) => e.duplicate).length} 行`, 'rose'),
      );
      if (p.collapsed) root._note.append(pill(`去重后保留 ${p.kept} 行`, 'emerald'));
    },
    destroy() { },
  };
};

/* ------------------------- 并排对照 ------------------------- */
R.sidebyside = (host) => {
  let root = null;
  return {
    update(p) {
      host.innerHTML = '';
      const col = (o, cls) => el('div', { class: 'sbs-col' }, [
        el('div', { class: 'sbs-head' }, [o.title]),
        el('div', { class: `sbs-sub ${cls}` }, [o.sub]),
        ...p.columns.map((c, i) => el('div', { class: 'sbs-row' + (cls === 'drop' ? ' same' : ''), style: { animationDelay: (i * 50) + 'ms' } }, [
          el('span', { class: 'k' }, [c]),
          el('span', { class: 'v' }, [fmt(o.cells[i])]),
        ])),
      ]);
      host.appendChild(el('div', { class: 'sbs' }, [col(p.a, 'keep'), col(p.b, 'drop')]));
      root = true;
    },
    destroy() { },
  };
};

/* ------------------------- 布尔掩码 ------------------------- */
R.mask = (host) => {
  let root = null;
  return {
    update(p) {
      if (!root) {
        host.innerHTML = '';
        root = el('div', { class: 'st-flex' });
        root._top = el('div', { class: 'mask-head' });
        root._grid = el('div', { class: 'chipgrid', style: { flex: '1' } });
        root.append(root._top, root._grid);
        host.appendChild(root);
      }
      root._top.innerHTML = '';
      root._top.append(
        el('span', { class: 'fx-term' }, [p.col]),
        el('span', { class: 'fx-op' }, [p.op]),
        el('span', { class: 'fx-term hot' }, [fmt(p.value) + (p.unit || '')]),
        el('span', { class: 'fx-eq' }, ['→']),
        el('span', { class: 'fx-out' }, ['mask']),
      );
      root._grid.innerHTML = '';
      p.entries.forEach((e) => {
        const cls = e.evaluated ? (e.pass ? 't' : 'f') : '';
        root._grid.appendChild(el('div', {
          class: `cg-cell ${cls}` + (p.cursor === e.i ? ' hot' : ''),
          style: { animationDelay: `${Math.min(e.i * 12, 500)}ms` },
        }, [`${e.name} ${fmt(e.value)} ${e.evaluated ? (e.pass ? '✓' : '✗') : ''}`]));
      });
    },
    destroy() { },
  };
};

/* ------------------------- 公式演算 ------------------------- */
R.formula = (host) => {
  let root = null;
  return {
    update(p) {
      if (!root) {
        host.innerHTML = '';
        root = el('div', { class: 'st-flex' });
        root._fx = el('div', { class: 'formula-box' });
        root._grid = el('div', { class: 'chipgrid', style: { flex: '1' } });
        root.append(root._fx, root._grid);
        host.appendChild(root);
      }
      root._fx.innerHTML = '';
      const cur = p.entries[p.cursor];
      root._fx.append(
        el('span', { class: 'fx-term' }, [`df["${p.a}"]`]),
        el('span', { class: 'fx-op' }, ['/']),
        el('span', { class: 'fx-op' }, ['(']),
        el('span', { class: 'fx-term' }, [`df["${p.a}"]`]),
        el('span', { class: 'fx-op' }, ['+']),
        el('span', { class: 'fx-term' }, [`df["${p.b}"]`]),
        el('span', { class: 'fx-op' }, [')']),
        el('span', { class: 'fx-op' }, ['*']),
        el('span', { class: 'fx-term' }, ['100']),
        el('span', { class: 'fx-eq' }, ['→']),
        el('span', { class: 'fx-out' }, [cur && cur.out !== null ? fmt(cur.out) : '…']),
      );
      root._grid.innerHTML = '';
      p.entries.forEach((e) => {
        root._grid.appendChild(el('div', {
          class: 'cg-cell' + (e.done ? ' t' : '') + (p.cursor === e.i ? ' hot' : ''),
          style: { animationDelay: `${Math.min(e.i * 12, 420)}ms` },
        }, [`${e.name} → ${e.out === null ? 'NaN' : fmt(e.out)}`]));
      });
    },
    destroy() { },
  };
};

/* ------------------------- 类型转换 ------------------------- */
R.dtype = (host) => {
  let root = null;
  return {
    update(p) {
      if (!root) {
        host.innerHTML = '';
        root = el('div', { class: 'st-flex' });
        root._top = el('div', { class: 'st-row', style: { justifyContent: 'center' } });
        root._grid = el('div', { class: 'chipgrid', style: { flex: '1' } });
        root.append(root._top, root._grid);
        host.appendChild(root);
      }
      root._top.innerHTML = '';
      root._top.append(
        el('span', { class: 'pill' }, [p.col]),
        el('span', { class: 'fx-term' }, [p.from]),
        el('span', { class: 'fx-eq' }, ['→']),
        el('span', { class: 'fx-term hot' }, [p.to]),
      );
      root._grid.innerHTML = '';
      p.entries.forEach((e) => {
        root._grid.appendChild(el('div', {
          class: 'cg-cell' + (e.done ? ' t' : ''),
          style: { animationDelay: `${Math.min(e.i * 12, 420)}ms` },
        }, [`${fmt(e.before)} → ${fmt(e.after)}`]));
      });
    },
    destroy() { },
  };
};

/* ------------------------- 重命名 ------------------------- */
R.rename = (host) => {
  let root = null;
  return {
    update(p) {
      if (!root) {
        host.innerHTML = '';
        root = el('div', { class: 'st-flex', style: { justifyContent: 'center' } });
        root._list = el('div', { class: 'rename-view' });
        root.appendChild(root._list);
        host.appendChild(root);
      }
      root._list.innerHTML = '';
      p.pairs.forEach((pr) => {
        root._list.appendChild(el('div', { class: 'rename-pair' + (pr.done ? ' done' : '') }, [
          el('span', { class: 'rp-from' }, [pr.from]),
          el('span', { class: 'rp-arrow' }, ['→']),
          el('span', { class: 'rp-to' }, [pr.to]),
        ]));
      });
      root._list.appendChild(el('div', { class: 'st-row' }, [
        pill('列名变了，数据一个字节都没动', 'cyan'),
      ]));
    },
    destroy() { },
  };
};

/* ------------------------- 抽样 / 截取 / 删列 ------------------------- */
R.sample = (host) => {
  let root = null;
  return {
    update(p) {
      if (!root) {
        host.innerHTML = '';
        root = el('div', { class: 'st-flex' });
        root._grid = el('div', { class: 'chipgrid', style: { flex: '1' } });
        root._note = el('div', { class: 'st-row', style: { flexWrap: 'wrap' } });
        root.append(root._grid, root._note);
        host.appendChild(root);
      }
      root._grid.innerHTML = '';
      p.entries.forEach((e) => {
        root._grid.appendChild(el('div', {
          class: 'cg-cell' + (e.revealed ? ' champMax' : e.picked && !e.revealed ? ' dup' : '')
            + (p.cursor === e.i ? ' hot' : ''),
          style: { animationDelay: `${Math.min(e.i * 12, 480)}ms` },
        }, [`${e.name}${e.revealed ? ' ✓' : ''}`]));
      });
      clear(root._note);
      root._note.append(
        pill(`sample n = ${p.n}`, 'cyan'),
        pill(`random_state = ${p.seed}`, ''),
        pill(`已抽中 ${p.entries.filter((e) => e.revealed).length}`, 'gold'),
      );
    },
    destroy() { },
  };
};

R.slice = (host) => {
  let root = null;
  return {
    update(p) {
      if (!root) {
        host.innerHTML = '';
        root = el('div', { class: 'st-flex', style: { justifyContent: 'center' } });
        root._map = el('div', { class: 'slicemap' });
        root._note = el('div', { class: 'st-row', style: { justifyContent: 'center', flexWrap: 'wrap' } });
        root.append(root._map, root._note);
        host.appendChild(root);
      }
      root._map.innerHTML = '';
      const isTail = p.mode === 'tail';
      p.names.forEach((nm, i) => {
        const inRange = isTail ? i >= p.names.length - p.n : i < p.n;
        root._map.appendChild(el('i', {
          class: 'slice-cell' + (inRange ? ' in' : '') + (p.cursor === i ? ' cur' : ''),
          style: { animationDelay: `${Math.min(i * 18, 500)}ms` },
          title: `${i} · ${nm}`,
        }));
      });
      clear(root._note);
      root._note.append(
        pill(`${isTail ? 'tail' : 'head'}(${p.n})`, 'cyan'),
        pill(`保留 ${isTail ? `索引 ${p.total - p.n}–${p.total - 1}` : `索引 0–${p.n - 1}`}`, 'emerald'),
        pill(`${p.total - p.n} 行不显示（但未删除）`, ''),
      );
    },
    destroy() { },
  };
};

R.dropcols = (host) => {
  let root = null;
  return {
    update(p) {
      if (!root) {
        host.innerHTML = '';
        root = el('div', { class: 'st-flex', style: { justifyContent: 'center' } });
        root._row = el('div', { class: 'colstrip' });
        root._note = el('div', { class: 'st-row', style: { justifyContent: 'center', flexWrap: 'wrap' } });
        root.append(root._row, root._note);
        host.appendChild(root);
      }
      root._row.innerHTML = '';
      const all = p.removed || [];
      // 用「列块」表示：先显示命中列，再显示保留列
      const hit = Math.max(3, all.length);
      for (let i = 0; i < hit; i++) {
        root._row.appendChild(el('i', { class: 'col-block hit' + (p.done ? ' gone' : ''), style: { animationDelay: (i * 70) + 'ms' } }, [all[i] || '']));
      }
      for (let i = 0; i < 4; i++) root._row.appendChild(el('i', { class: 'col-block' }, ['']));
      clear(root._note);
      root._note.append(
        pill(`删除 ${all.length} 列：${all.join('、')}`, 'rose'),
        pill('行数完全不变（与 dropna 相反的方向）', 'cyan'),
      );
    },
    destroy() { },
  };
};

/* ------------------------- 统计表 ------------------------- */
R.describe = (host) => {
  let root = null;
  return {
    update(p) {
      if (!root) {
        host.innerHTML = '';
        root = el('div', { class: 'st-flex' });
        root._t = el('div', { class: 'tablewrap' });
        root.append(root._t);
        host.appendChild(root);
      }
      const rev = new Set(p.revealed || []);
      const tb = el('table', { class: 'd-table' });
      const thead = el('tr', {}, [el('th', {}, ['指标']), ...p.cols.map((c) => el('th', {}, [c]))]);
      tb.appendChild(el('thead', {}, [thead]));
      const tbody = el('tbody');
      p.rows.forEach((r) => {
        const on = rev.has(r);
        const tr = el('tr', { class: (on ? 'on' : '') + (p.active === r ? ' active' : '') }, [
          el('td', { class: 'rowlab' }, [r]),
          ...p.cols.map((c) => {
            const v = p.data?.[c]?.[r];
            const isCount = r === 'count';
            return el('td', {}, [v === undefined ? '·' : (isCount ? String(v) : fmt(v, 3))]);
          }),
        ]);
        tbody.appendChild(tr);
      });
      tb.appendChild(tbody);
      root._t.innerHTML = '';
      root._t.appendChild(tb);
    },
    destroy() { },
  };
};

R.info = (host) => {
  let root = null;
  return {
    update(p) {
      if (!root) {
        host.innerHTML = '';
        root = el('div', { class: 'st-flex' });
        root._t = el('div', { class: 'tablewrap' });
        root.append(root._t);
        host.appendChild(root);
      }
      const rows = p.info.columns.slice(0, p.revealed);
      const tb = el('table', { class: 'd-table' });
      tb.appendChild(el('thead', {}, [el('tr', {}, [
        el('th', {}, ['#']), el('th', {}, ['Column']), el('th', {}, ['Dtype']),
        el('th', {}, ['Non-Null']), el('th', {}, ['Null']),
      ])]));
      const tbody = el('tbody');
      p.info.columns.forEach((c, i) => {
        const on = i < p.revealed;
        tbody.appendChild(el('tr', { class: on ? 'on' : '' }, [
          el('td', { class: 'rowlab' }, [String(i)]),
          el('td', { style: { color: 'var(--cyan)', fontFamily: 'var(--mono)' } }, [c.name]),
          el('td', { class: 'mono' }, [c.dtype]),
          el('td', { class: 'mono' }, [`${c.nonNull} / ${p.info.shape[0]}`]),
          el('td', { class: 'mono' + (c.nulls ? ' warn' : '') }, [c.nulls ? `⚠ ${c.nulls}` : '—']),
        ]));
      });
      tb.appendChild(tbody);
      root._t.innerHTML = '';
      root._t.appendChild(tb);
    },
    destroy() { },
  };
};

/* ------------------------- 频次 / 桶 ------------------------- */
R.tally = (host) => {
  let root = null;
  return {
    update(p) {
      if (!root) {
        host.innerHTML = '';
        root = el('div', { class: 'st-flex' });
        root._bars = el('div', { class: 'bars', style: { flex: '1' } });
        root._note = el('div', { class: 'st-row', style: { flexWrap: 'wrap' } });
        root.append(root._bars, root._note);
        host.appendChild(root);
      }
      const max = p.maxCount || 1;
      root._bars.innerHTML = '';
      (p.sorted || []).forEach((s, i) => {
        const on = !p.cursor || p.cursor >= 0;
        root._bars.appendChild(el('div', { class: 'bar-row' }, [
          el('div', { class: 'bar-label', title: s.key }, [s.key]),
          el('div', { class: 'bar-track' }, [el('div', {
            class: 'bar-fill' + (i === 0 ? ' gold' : ''),
            style: { width: ((p.counts?.[s.key] ?? (p.cursor < 0 ? 0 : 0)) / max * 100) + '%', transitionDelay: (i * 40) + 'ms' },
          })]),
          el('div', { class: 'bar-val' }, [String(p.counts?.[s.key] ?? 0)]),
        ]));
      });
      clear(root._note);
      root._note.append(
        pill(`${p.col}`, 'cyan'),
        pill(`${p.keys.length} 个类别`, ''),
        pill(`已归类 ${Math.max(0, p.cursor + 1)} / ${p.total}`, 'gold'),
      );
    },
    destroy() { },
  };
};

R.buckets = (host) => {
  let root = null;
  return {
    update(p) {
      if (!root) {
        host.innerHTML = '';
        root = el('div', { class: 'st-flex' });
        root._b = el('div', { class: 'buckets', style: { flex: '1' } });
        root._note = el('div', { class: 'st-row', style: { flexWrap: 'wrap' } });
        root.append(root._b, root._note);
        host.appendChild(root);
      }
      const prev = new Map([...root._b.children].map((n) => [n.dataset.key, n]));
      root._b.innerHTML = '';
      (p.buckets || []).forEach((b) => {
        const has = b.items.length > 0;
        const node = el('div', { class: 'bucket' + (has ? ' has' : ''), data: { key: b.key } }, [
          el('div', { class: 'bucket-head' }, [
            el('div', { class: 'bucket-key', title: b.key }, [b.key]),
            el('div', { class: 'bucket-n' }, [`${b.items.length} 行`]),
          ]),
          el('div', { class: 'bucket-body' }, b.items.map((it) => el('div', {
            class: 'bucket-chip', title: `${it.name} = ${fmt(it.value)}`,
          }, [`${it.name} ${fmt(it.value)}`]))),
          el('div', { class: 'bucket-foot' }, [
            el('div', { class: 'bucket-agg' + (p.computed ? '' : ' pending') }, [
              el('span', { class: 'k' }, [`${p.target}.${p.fn}`]),
              el('span', { class: 'v' }, [p.computed ? fmt(fnVal(b, p.fn)) + (p.unit || '') : '…']),
            ]),
          ]),
        ]);
        root._b.appendChild(node);
      });
      clear(root._note);
      root._note.append(
        pill(`分组键 ${p.by}`, 'cyan'),
        pill(`聚合 ${p.target}.${p.fn}()`, 'gold'),
        pill(`${p.by} 分为 ${p.keys.length} 组`, ''),
        p.computed ? pill('组内计算完成', 'emerald') : pill(`已飞入 ${Math.max(0, p.cursor + 1)} / ${p.total} 行`, ''),
      );
      function fnVal(b, fn) {
        const nums = b.items.map((it) => it.value).filter((v) => typeof v === 'number' && Number.isFinite(v));
        if (fn === 'count') return b.items.length;
        if (!nums.length) return NaN;
        if (fn === 'sum') return nums.reduce((a, c) => a + c, 0);
        if (fn === 'min') return Math.min(...nums);
        if (fn === 'max') return Math.max(...nums);
        const m = nums.reduce((a, c) => a + c, 0) / nums.length;
        if (fn === 'median') { const s = [...nums].sort((a, b2) => a - b2); const mid = s.length >> 1; return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2; }
        if (fn === 'std') return Math.sqrt(nums.reduce((a, c) => a + (c - m) ** 2, 0) / Math.max(1, nums.length - 1));
        return m;
      }
    },
    destroy() { },
  };
};

/* ------------------------- 单结果卡 ------------------------- */
R.statcard = (host) => {
  let root = null;
  return {
    update(p) {
      if (!root) {
        host.innerHTML = '';
        root = el('div', { class: 'st-flex', style: { justifyContent: 'center' } });
        root._big = el('div', { class: 'acc final', style: { minWidth: '220px', padding: '20px 26px' } });
        root._cards = el('div', { class: 'cards-row', style: { justifyContent: 'center' } });
        root.append(root._big, root._cards);
        host.appendChild(root);
      }
      root._big.innerHTML = '';
      root._big.append(
        el('div', { class: 'acc-k' }, [p.label || p.fn]),
        el('div', { class: 'acc-v', style: { fontSize: '38px' } }, [fmt(p.result) + (p.fn === 'count' ? '' : (p.unit || ''))]),
        el('div', { class: 'acc-k', style: { marginTop: '6px' } }, [`df["${p.col}"].${p.fn}()`]),
      );
      root._cards.innerHTML = '';
      (p.cards || []).forEach((c) => root._cards.appendChild(el('div', { class: 'card' }, [
        el('div', { class: 'card-k' }, [c.label]),
        el('div', { class: 'card-v', style: { fontSize: '17px' } }, [c.value + (c.suffix || '')]),
      ])));
    },
    destroy() { },
  };
};

R.sortedbars = (host) => {
  if (!host._sb) { host.innerHTML = ''; const w = el('div', { class: 'st-flex' }); host.appendChild(w); host._sb = makeSortedBars(w); }
  return host._sb;
};

R.chart = (host) => {
  if (!host._chart) { host._chart = makeChart(host); }
  return host._chart;
};

R.sort = (host) => {
  if (!host._sorter) { host.innerHTML = ''; host._sorter = makeSorter(host); }
  return host._sorter;
};

R.reduce = (host) => {
  if (!host._reduce) { host._reduce = makeReduce(host); }
  return host._reduce;
};

/* ------------------------- 管道总览 ------------------------- */
R.pipeline = (host) => {
  let root = null;
  return {
    update(p) {
      if (!root) {
        host.innerHTML = '';
        root = el('div', { class: 'st-flex' });
        root._flow = el('div', { class: 'pipeflow' });
        root._note = el('div', { class: 'st-row', style: { flexWrap: 'wrap' } });
        root.append(root._flow, root._note);
        host.appendChild(root);
      }
      root._flow.innerHTML = '';
      const mk = (label, sub, tone, icon) => el('div', { class: `pf-node ${tone}` }, [
        el('div', { class: 'pf-ic' }, [icon]),
        el('div', { class: 'pf-t' }, [label]),
        el('div', { class: 'pf-s' }, [sub]),
      ]);
      root._flow.appendChild(mk('read_csv', `${p.original.nrow} × ${p.original.ncol}`, 'start', '▤'));
      (p.history || []).slice(0, 8).forEach((h, i) => {
        root._flow.appendChild(el('div', { class: 'pf-arrow', style: { animationDelay: (i * 90) + 'ms' } }, ['→']));
        root._flow.appendChild(el('div', { class: 'pf-node step', style: { animationDelay: (i * 90) + 'ms' } }, [
          el('div', { class: 'pf-n' }, [String(i + 1)]),
          el('div', { class: 'pf-t' }, [h.label]),
          el('div', { class: 'pf-s' }, [h.delta || '']),
        ]));
      });
      root._flow.appendChild(el('div', { class: 'pf-arrow' }, ['→']));
      root._flow.appendChild(mk('to_csv', `${p.final.nrow} × ${p.final.ncol}`, 'end', '✓'));
      clear(root._note);
      root._note.append(
        pill(`共 ${p.history.length} 步处理`, 'cyan'),
        pill(`行数 ${p.original.nrow} → ${p.final.nrow}`, p.final.nrow < p.original.nrow ? 'emerald' : ''),
        pill(`列数 ${p.original.ncol} → ${p.final.ncol}`, ''),
      );
    },
    destroy() { },
  };
};

R.summary = (host) => {
  let root = null;
  return {
    update(p) {
      if (!root) {
        host.innerHTML = '';
        root = el('div', { class: 'st-flex', style: { justifyContent: 'center' } });
        root._cards = el('div', { class: 'cards-row' });
        root._note = el('div', { class: 'st-row', style: { justifyContent: 'center', flexWrap: 'wrap' } });
        root.append(root._cards, root._note);
        host.appendChild(root);
      }
      root._cards.innerHTML = '';
      (p.cards || []).forEach((c) => root._cards.appendChild(el('div', { class: 'card' }, [
        el('div', { class: 'card-k' }, [c.col]),
        el('div', { class: 'card-v', style: { fontSize: '16px' } }, [`x̄ ${fmt(c.s.mean)}${c.unit}`]),
        el('div', { class: 'card-sub' }, [`σ ${fmt(c.s.std)}　范围 ${fmt(c.s.min)} ~ ${fmt(c.s.max)}`]),
      ])));
      clear(root._note);
      root._note.append(
        pill(`shape ${p.shape[0]} × ${p.shape[1]}`, 'emerald'),
        pill(`原始 ${p.originalShape[0]} × ${p.originalShape[1]}`, ''),
      );
    },
    destroy() { },
  };
};

R.export = (host) => {
  let root = null;
  return {
    update(p) {
      if (!root) {
        host.innerHTML = '';
        root = el('div', { class: 'st-flex', style: { justifyContent: 'center', alignItems: 'center' } });
        root._box = el('div', { class: 'exportbox' });
        root.appendChild(root._box);
        host.appendChild(root);
      }
      root._box.innerHTML = '';
      root._box.append(
        el('div', { class: 'acc-k' }, ['准备导出']),
        el('div', { class: 'acc-v', style: { fontSize: '30px' } }, [`cleaned.csv`]),
        el('div', { class: 'st-row', style: { justifyContent: 'center', marginTop: '4px' } }, [
          pill(`${p.rows} 行 × ${p.cols} 列`, 'cyan'),
          pill(`${Math.max(1, Math.round(p.csv.length / 1024))} KB`, ''),
          pill(`${(p.history || []).length} 步管道`, 'gold'),
        ]),
        el('button', {
          class: 'btn primary', style: { marginTop: '12px' },
          onclick: () => {
            const blob = new Blob(['\uFEFF' + p.csv], { type: 'text/csv;charset=utf-8' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = 'cleaned.csv';
            a.click();
            setTimeout(() => URL.revokeObjectURL(a.href), 1000);
          },
        }, ['⤓ 下载 cleaned.csv']),
      );
    },
    destroy() { },
  };
};

const SUGGEST = [
  { id: 'drop_extremes', label: '去除最大最小值', hint: '看完整扫描推理', star: true },
  { id: 'drop_duplicates', label: 'drop_duplicates', hint: '行指纹判重' },
  { id: 'groupby', label: 'groupby', hint: '数据飞入桶中' },
  { id: 'hist', label: '直方图', hint: '分布逐格生长' },
];

R.none = (host) => ({
  update() {
    host.innerHTML = '';
    host.appendChild(el('div', { class: 'empty-stage' }, [
      el('div', { class: 'es-badge' }, ['舞台就绪']),
      el('div', { class: 'es-title' }, ['选择任意操作，逐步观看数据是怎样被处理的']),
      el('div', { class: 'es-sub' }, [
        '每个 pandas 操作都会被拆解成一串可回放的帧 —— 扫描、判定、删除、重置索引，每一步都有解说与等价代码。',
      ]),
      el('div', { class: 'es-cards' }, SUGGEST.map((s) => el('button', {
        class: 'es-card' + (s.star ? ' star' : ''),
        onclick: () => window.__PF__?.stage?.onPick?.(s.id),
      }, [
        el('div', { class: 'es-k' }, [s.hint]),
        el('div', { class: 'es-t' }, [s.label]),
        s.star ? el('div', { class: 'es-star' }, ['★ 旗舰演示']) : null,
      ]))),
      el('div', { class: 'es-keys' }, [
        el('span', { class: 'kbd' }, ['空格']), el('span', {}, ['播放 / 暂停']),
        el('span', { class: 'kbd' }, ['←']), el('span', { class: 'kbd' }, ['→']), el('span', {}, ['单步前后']),
        el('span', { class: 'kbd' }, ['Home']), el('span', { class: 'kbd' }, ['End']), el('span', {}, ['首帧 / 末帧']),
      ]),
    ]));
  },
  destroy() { },
});

/* ==================================================================
 * 调度器
 * ================================================================== */
export const STAGE_KINDS = Object.keys(R);

export class Stage {
  constructor(host) {
    this.host = host;
    this.kind = null;
    this.renderer = null;
    this.canvas = null;
  }

  render(p) {
    const kind = p?.kind || 'none';
    if (kind !== this.kind) {
      this.renderer?.destroy?.();
      this.host.innerHTML = '';
      this.canvas = el('div', { class: 'stage-canvas stage-enter' });
      this.host.appendChild(this.canvas);
      this.kind = kind;
      if (!R[kind] && kind !== 'none') {
        console.warn(`[stage] 没有为 kind="${kind}" 注册渲染器，已退化为空舞台`);
      }
      this.renderer = (R[kind] || R.none)(this.canvas, p);
      setTimeout(() => this.canvas?.classList.remove('stage-enter'), 620);
    }
    try {
      this.renderer.update(p);
    } catch (e) {
      console.error('[stage]', kind, e);
    }
  }

  clear() { this.render(null); }
}
