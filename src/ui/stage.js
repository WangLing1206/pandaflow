/* ------------------------------------------------------------------
 * ui/stage.js — 舞台调度器
 *  ----------------------------------------------------------------
 *  按 stage.kind 选择渲染器；kind 不变时复用 DOM（产生补间动画），
 *  kind 变化时重建并播放入场动画。
 *  payload 里的双语字段已由 main.js 解析成当前语言，这里只负责画。
 * ------------------------------------------------------------------ */

import { el, clear, fmt, clamp } from '../core/utils.js';
import { L, pick, t } from '../i18n/index.js';
import { makeStrip, makeSorter, makeReduce, makeChart, makeSortedBars, miniHist, svg } from './viz.js';

/* ------------------------------ 小工具 ------------------------------ */
const pill = (txt, cls = '') => el('span', { class: `pill ${cls}` }, [txt]);
const card = (k, v, sub, tone) => el('div', { class: 'card', data: { tone: tone || 'info' } }, [
  el('div', { class: 'card-k' }, [k]),
  el('div', { class: 'card-v' }, [v]),
  sub ? el('div', { class: 'card-sub' }, [sub]) : null,
]);

const statGrid = (s, unit = '') => {
  if (!s || !Number.isFinite(s.mean)) {
    return el('div', { class: 'statgrid empty' }, [el('span', { class: 'sg-k' }, [t('view.empty')])]);
  }
  const cells = [
    ['count', String(s.n), ''], ['mean', fmt(s.mean), unit], ['std', fmt(s.std), ''],
    ['min', fmt(s.min), unit], ['50%', fmt(s.median), unit], ['max', fmt(s.max), unit],
  ];
  return el('div', { class: 'statgrid' }, cells.map(([k, v, u]) => el('div', { class: 'sg-cell' }, [
    el('span', { class: 'sg-k' }, [k]), el('span', { class: 'sg-v' }, [v + u]),
  ])));
};

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

      clear(root._row1);
      if (challenger && p.phase !== 'lock' && !p.target) {
        root._row1.appendChild(el('div', { class: 'challenger' }, [
          el('div', { class: 'challenger-label' }, [L('挑战者', 'challenger').zh]),
          el('div', { class: 'challenger-value' }, [fmt(challenger.value) + (p.unit || '')]),
          el('div', { class: 'challenger-name' }, [`${challenger.name} · #${challenger.i}`]),
        ]));
      }
      if (p.target) {
        root._row1.appendChild(el('div', { class: 'challenger', style: { borderStyle: 'solid', borderColor: 'var(--max)' } }, [
          el('div', { class: 'challenger-label' }, [L('即将删除', 'drop target').zh]),
          el('div', { class: 'challenger-value' }, [fmt(p.target.value) + (p.unit || '')]),
          el('div', { class: 'challenger-name' }, [`${p.target.name} · index ${p.target.i}`]),
        ]));
      }
      const mkChamp = (kind, v, nm, idx, changed) => el('div', { class: `champ ${kind}${changed ? ' justChanged' : ''}` }, [
        el('div', { class: 'champ-label' }, [kind === 'max' ? L('当前最大值', 'current max').zh : L('当前最小值', 'current min').zh]),
        el('div', { class: 'champ-value' }, [v === null ? '—' : fmt(v) + (p.unit || '')]),
        el('div', { class: 'champ-name' }, [nm || '—', el('span', { class: 'champ-idx' }, [idx >= 0 ? `idx ${idx}` : ''])]),
      ]);
      root._row1.append(
        mkChamp('max', vMax, maxIdx >= 0 ? points?.[maxIdx]?.name : '', maxIdx, verdict === 'newMax' || verdict === 'newBoth'),
        mkChamp('min', vMin, minIdx >= 0 ? points?.[minIdx]?.name : '', minIdx, verdict === 'newMin' || verdict === 'newBoth'),
      );

      clear(root._note);
      if (verdict) {
        const map = {
          newMax: [L('击败当前最大值 → 最大值易主', 'beats the max → new champion'), 'fail'],
          newMin: [L('低于当前最小值 → 最小值易主', 'undercuts the min → new champion'), 'pass'],
          newBoth: [L('同时改写最大值与最小值', 'rewrites both champions'), 'fail'],
          none: [L('未能改写任何一个擂主', 'neither champion moves'), 'hold'],
          aboutToDelete: [L('该行已被 drop() 锁定', 'locked by drop()'), 'fail'],
          deleted: [L('已摘除，索引留下断层', 'removed, index gap remains'), 'hold'],
          lock: [L('扫描结束，两个极值已确定', 'scan complete, both extremes found'), 'pass'],
          reset: [L('索引已重新编号', 'index renumbered'), 'pass'],
        }[verdict] || [verdict, 'hold'];
        root._note.appendChild(el('div', { class: `verdict ${map[1]}` }, [
          el('span', {}, [map[1] === 'hold' ? '·' : (map[1] === 'pass' ? '✓' : '!')]),
          el('span', {}, [map[0]]),
        ]));
      }
      if (p.phase === 'intro' && p.summary) {
        root._note.append(pill(`n = ${p.summary.n}`, 'cyan'), pill(`mean = ${fmt(p.summary.mean)}`),
          pill(`std = ${fmt(p.summary.std)}`), pill(`range = ${fmt(p.summary.max - p.summary.min)}${p.unit || ''}`, 'gold'));
      } else if (p.phase === 'intro2') {
        root._note.append(pill(p.rule, 'cyan'));
      } else if (p.phase === 'scan' && p.progress) {
        root._note.append(
          pill(`${p.progress[0]} / ${p.progress[1]}`, 'cyan'),
          pill(`${Math.min(p.scannedUpTo + 1, p.total)} / ${p.total}`, ''),
        );
      } else if (p.phase === 'delete') {
        root._note.append(pill(L(`已删除 ${p.removedCount || 0} 行`, `${p.removedCount || 0} removed`).zh, 'rose'),
          pill(L('索引不会自动补位', 'pandas keeps the index gap').zh));
      } else if (p.phase === 'reset') {
        root._note.append(pill('reset_index(drop=True)', 'cyan'), pill(L('索引缝合完成', 'index stitched').zh, 'emerald'));
      } else if (p.phase === 'lock') {
        root._note.append(pill(p.markDelete ? `drop [${p.markDelete.join(', ')}]` : L('两个极值已锁定', 'both extremes locked').zh, p.markDelete ? 'rose' : 'emerald'));
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
      if (!root) { host.innerHTML = ''; root = el('div', { class: 'st-flex' }); host.appendChild(root); }
      const unit = p.unit || '';
      const side = (o, cls) => el('div', { class: `cmp-side ${cls}` }, [
        el('div', { class: 'st-row', style: { gap: '8px' } }, [
          el('span', { class: 'pill ' + (cls === 'after' ? 'emerald' : '') }, [cls === 'after' ? t('common.after') : t('common.before')]),
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
      const removed = (p.removed || []).filter(Boolean);
      if (removed.length) {
        const list = el('div', { class: 'rm-strip' });
        removed.slice(0, 8).forEach((r, i) => {
          const kindLabel = { max: L('最大值', 'max').zh, min: L('最小值', 'min').zh, na: L('缺失', 'NaN').zh, dup: L('重复行', 'duplicate').zh }[r.kind] || '';
          list.appendChild(el('div', { class: 'rm-item', style: { animationDelay: (i * 60) + 'ms' } }, [
            el('span', { class: 'pill rose' }, [kindLabel]),
            el('span', { class: 'n' }, [`#${r.i}`, r.name ? ` · ${r.name}` : '']),
            el('span', { class: 'v' }, [fmt(r.value) + (r.clamped !== undefined ? ` → ${fmt(r.clamped)}` : '')]),
          ]));
        });
        if (removed.length > 8) list.appendChild(el('div', { class: 'rm-item' }, [el('span', { class: 'n' }, [`… ${removed.length}`])]));
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
        root._h = el('div', { class: 'st-grow', style: { minHeight: '70px' } });
        root._note = el('div', { class: 'st-row', style: { flexWrap: 'wrap' } });
        root.append(root._h, root._note);
        host.appendChild(root);
        strip = makeStrip(root._h);
      }
      strip.update({ dom: p.dom, points: p.points, cursor: -1, minIdx: -1, maxIdx: -1, phase: 'range' });
      clear(root._note);
      root._note.append(pill(p.label, 'cyan'),
        pill(`${fmt(p.lo)}`, 'cyan'), pill(`${fmt(p.hi)}`, 'rose'),
        pill(L(`${(p.points || []).filter((x) => x.status === 'out').length} 个越界值`, `${(p.points || []).filter((x) => x.status === 'out').length} out of range`).zh, 'gold'));
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
        root._r.append(el('div', { class: 'card-k' }, [`${p.col} · ${p.largest ? 'Top' : 'Bottom'}-${p.n}`]), root._list);
        root.append(root._l, root._r);
        host.appendChild(root);
        strip = makeStrip(root._h);
      }
      if (p.points && p.points.length) strip.update({ dom: p.dom, points: p.points, cursor: -1, minIdx: -1, maxIdx: -1, phase: 'scan' });
      clear(root._list);
      (p.ranked || []).forEach((o, i) => {
        root._list.appendChild(el('div', { class: 'rank-item' + (i === 0 ? ' top' : ''), style: { animationDelay: (i * 55) + 'ms' } }, [
          el('span', { class: 'rank-no' }, [String(i + 1)]),
          el('span', { class: 'rank-name' }, [`#${o.i} · ${o.name || ''}`]),
          el('span', { class: 'rank-val' }, [fmt(o.v) + (p.unit || '')]),
        ]));
      });
      if (p.threshold !== undefined) {
        root._list.appendChild(el('div', { class: 'st-row', style: { marginTop: '5px' } }, [
          pill(`${L('门槛', 'threshold').zh} ${fmt(p.threshold)}${p.unit || ''}`, 'gold'),
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
      p.columns.forEach((col) => {
        root._grid.appendChild(el('div', {
          class: 'nm-row' + (col.nulls ? ' has' : '') + (p.subset && !p.subset.includes(col.name) ? ' skip' : ''),
        }, [
          el('div', { class: 'nm-label', title: col.name }, [col.name]),
          el('div', { class: 'nm-cells' }, col.cells.map((isNull, i) => el('i', {
            class: 'nm-cell' + (isNull ? ' na' : '') + (p.cursor === i ? ' cur' : ''),
            style: { animationDelay: `${Math.min(i * 7, 350)}ms` },
          }))),
          el('div', { class: 'nm-count' }, [col.nulls ? String(col.nulls) : '—']),
        ]));
      });
      clear(root._note);
      if (p.explain) root._note.append(pill('how="any"', 'rose'), pill(L('任一字段缺失即整行丢弃', 'any missing field drops the row').zh));
      if (p.collapsed) root._note.append(pill(L(`保留 ${p.kept} 行`, `${p.kept} rows kept`).zh, 'emerald'));
      if (p.done) root._note.append(pill(L(`行数 ${p.kept}`, `${p.kept} rows`).zh, 'emerald'));
      if (!p.explain && !p.collapsed && !p.done) {
        root._note.append(pill(`${L('待删除', 'to drop').zh} ${p.badRows?.length ?? 0}`, 'rose'));
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
        root._grid.appendChild(el('div', {
          class: 'fg-item' + (e.na ? ' na' : '') + (filled ? ' filled' : '') + (p.cursor === e.i ? ' cur' : ''),
        }, [
          el('div', { class: 'fg-name' }, [e.name]),
          el('div', { class: 'fg-bar' }, [el('i', { style: { width: filled ? clamp(e.fill / max * 100, 6, 100) + '%' : '0%' } })]),
          el('div', { class: 'fg-val' }, [e.na && !filled ? 'NaN' : fmt(filled ? e.fill : e.value)]),
        ]));
      });
      clear(root._note);
      root._note.append(
        pill(`${L('待填充', 'to fill').zh} ${p.missIdx.length}`, 'gold'),
        pill(p.repr, 'cyan'),
        pill(`${L('已完成', 'done').zh} ${Object.keys(p.fillMap).length}`, Object.keys(p.fillMap).length ? 'emerald' : ''),
      );
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
          style: { animationDelay: `${Math.min(e.i * 12, 600)}ms` },
          title: `${e.name} · ${e.hash}${e.duplicate ? ` = #${e.originIdx}` : ''}`,
        }, [
          el('span', { class: 'fp-h' }, [e.hash]),
          el('span', { class: 'fp-n' }, [e.name]),
          e.duplicate ? el('span', { class: 'fp-x' }, [`= #${e.originIdx}`]) : null,
        ]));
      });
      clear(root._note);
      root._note.append(
        pill(`${L('判重字段', 'subset').zh} ${(p.subset || []).length}`, 'cyan'),
        pill(`${p.seenCount} / ${p.total}`, ''),
        pill(`${L('重复', 'dupes').zh} ${p.entries.filter((e) => e.duplicate).length}`, 'rose'),
      );
      if (p.collapsed) root._note.append(pill(`${L('保留', 'kept').zh} ${p.kept}`, 'emerald'));
    },
    destroy() { },
  };
};

/* ------------------------- 并排对照 ------------------------- */
R.sidebyside = (host) => ({
  update(p) {
    host.innerHTML = '';
    const col = (o, cls) => el('div', { class: 'sbs-col' }, [
      el('div', { class: 'sbs-head' }, [o.title]),
      el('div', { class: `sbs-sub ${cls}` }, [o.sub]),
      ...p.columns.map((c, i) => el('div', { class: 'sbs-row' + (cls === 'drop' ? ' same' : ''), style: { animationDelay: (i * 45) + 'ms' } }, [
        el('span', { class: 'k' }, [c]), el('span', { class: 'v' }, [fmt(o.cells[i])]),
      ])),
    ]);
    host.appendChild(el('div', { class: 'sbs' }, [col(p.a, 'keep'), col(p.b, 'drop')]));
  },
  destroy() { },
});

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
        el('span', { class: 'fx-term hot' }, [`${p.value}${p.unit || ''}`]),
        el('span', { class: 'fx-eq' }, ['→']),
        el('span', { class: 'fx-out' }, ['mask']),
      );
      root._grid.innerHTML = '';
      p.entries.forEach((e) => {
        root._grid.appendChild(el('div', {
          class: `cg-cell ${e.evaluated ? (e.pass ? 't' : 'f') : ''}` + (p.cursor === e.i ? ' hot' : ''),
          style: { animationDelay: `${Math.min(e.i * 10, 400)}ms` },
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
      const cur = p.entries[p.cursor];
      root._fx.innerHTML = '';
      root._fx.append(
        el('span', { class: 'fx-term' }, [p.a]),
        el('span', { class: 'fx-eq' }, ['→']),
        el('span', { class: 'fx-out' }, [cur && cur.out !== null && cur.out !== undefined ? fmt(cur.out) : '…']),
        el('span', { class: 'fx-op' }, ['|']),
        el('span', { class: 'fx-term' }, [p.name]),
      );
      root._grid.innerHTML = '';
      p.entries.forEach((e) => {
        root._grid.appendChild(el('div', {
          class: 'cg-cell' + (e.done ? ' t' : '') + (p.cursor === e.i ? ' hot' : ''),
          style: { animationDelay: `${Math.min(e.i * 10, 360)}ms` },
        }, [`${e.name} → ${e.out === null || e.out === undefined ? 'NaN' : fmt(e.out)}`]));
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
          style: { animationDelay: `${Math.min(e.i * 10, 360)}ms` },
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
          class: 'cg-cell' + (e.revealed ? ' champMax' : (e.picked && !e.revealed ? ' dup' : '')) + (p.cursor === e.i ? ' hot' : ''),
          style: { animationDelay: `${Math.min(e.i * 10, 420)}ms` },
        }, [`${e.name}${e.revealed ? ' ✓' : ''}`]));
      });
      clear(root._note);
      root._note.append(
        pill(`n = ${p.n}`, 'cyan'), pill(`random_state = ${p.seed}`),
        pill(`${L('已抽中', 'drawn').zh} ${p.entries.filter((e) => e.revealed).length}`, 'gold'),
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
          style: { animationDelay: `${Math.min(i * 14, 420)}ms` },
          title: `${i} · ${nm}`,
        }));
      });
      clear(root._note);
      root._note.append(
        pill(`${isTail ? 'tail' : 'head'}(${p.n})`, 'cyan'),
        pill(isTail ? `${p.total - p.n}–${p.total - 1}` : `0–${p.n - 1}`, 'emerald'),
        pill(`${p.total - p.n} ${L('行未显示', 'rows hidden').zh}`),
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
      for (let i = 0; i < Math.max(3, all.length); i++) {
        root._row.appendChild(el('i', { class: 'col-block hit' + (p.done ? ' gone' : ''), style: { animationDelay: (i * 60) + 'ms' } }, [all[i] || '']));
      }
      for (let i = 0; i < 4; i++) root._row.appendChild(el('i', { class: 'col-block' }, ['']));
      clear(root._note);
      root._note.append(
        pill(`${L('删除', 'drop').zh} ${all.length} ${L('列', 'cols').zh}`, 'rose'),
        pill(L('行数完全不变', 'row count unchanged').zh, 'cyan'),
      );
    },
    destroy() { },
  };
};

/* ------------------------- 合并 / 透视 ------------------------- */
R.merge = (host) => {
  let root = null;
  return {
    update(p) {
      if (!root) {
        host.innerHTML = '';
        root = el('div', { class: 'st-flex' });
        root._wrap = el('div', { class: 'mergewrap' });
        root._note = el('div', { class: 'st-row', style: { flexWrap: 'wrap' } });
        root.append(root._wrap, root._note);
        host.appendChild(root);
      }
      clear(root._wrap);
      const side = (rows, title, cls) => el('div', { class: 'merge-col' }, [
        el('div', { class: 'card-k' }, [title]),
        el('div', { class: 'merge-list' }, rows.map((r) => el('div', {
          class: 'merge-row' + (r.matched ? ' hit' : '') + (r.used ? ' used' : ''),
        }, [
          el('span', { class: 'k' }, [String(r.key)]),
          el('span', { class: 'n' }, [String(r.name ?? '')]),
          el('span', { class: 'b' }, [r.matched ? '✓' : '·']),
        ]))),
      ]);
      root._wrap.append(
        side(p.left, `${L('左表', 'left').zh} · ${p.on}`, 'l'),
        el('div', { class: 'merge-mid' }, [el('span', {}, ['⇄'])]),
        side(p.right, `${L('右表', 'right').zh} · ${p.on}`, 'r'),
      );
      clear(root._note);
      if (p.howPanel) {
        const rows = [
          ['inner', L('交集', 'intersection').zh, L('只保留两边都有的键', 'only keys on both sides').zh],
          ['left', L('以左表为准', 'left-driven').zh, L('右表缺失填 NaN', 'NaN where the right misses').zh],
          ['right', L('以右表为准', 'right-driven').zh, L('左表缺失填 NaN', 'NaN where the left misses').zh],
          ['outer', L('并集', 'union').zh, L('两边都保留', 'keep both sides').zh],
        ];
        root._note.append(...rows.map(([k, a, b]) => pill(`${k} · ${a} — ${b}`, k === p.how ? 'accent' : '')));
      } else {
        root._note.append(
          pill(`how="${p.how}"`, 'accent'),
          pill(`${L('左表', 'left').zh} ${p.left.length}`, 'cyan'),
          pill(`${L('右表', 'right').zh} ${p.right.length}`),
        );
      }
    },
    destroy() { },
  };
};

R.pivot = (host) => {
  let root = null;
  return {
    update(p) {
      if (!root) {
        host.innerHTML = '';
        root = el('div', { class: 'st-flex' });
        root._grid = el('div', { class: 'pivotgrid' });
        root._note = el('div', { class: 'st-row', style: { flexWrap: 'wrap' } });
        root.append(root._grid, root._note);
        host.appendChild(root);
      }
      const cells = p.cells || {};
      const keyOf = (rk, ck) => `${rk}\u0001${ck}`;
      const maxAgg = Math.max(1, ...Object.values(cells).map((c) => (typeof c.agg === 'number' ? Math.abs(c.agg) : 0)));
      root._grid.innerHTML = '';
      const tbl = el('table', { class: 'pivot-table' });
      tbl.appendChild(el('tr', {}, [
        el('th', {}, [`${p.indexCol} \\ ${p.colCol}`]),
        ...p.colKeys.map((ck) => el('th', {}, [String(ck)])),
      ]));
      p.rowKeys.forEach((rk) => {
        tbl.appendChild(el('tr', {}, [
          el('th', { class: 'rowh' }, [String(rk)]),
          ...p.colKeys.map((ck) => {
            const c = cells[keyOf(rk, ck)];
            const v = c ? c.agg : null;
            const alpha = typeof v === 'number' ? 0.06 + 0.5 * (Math.abs(v) / maxAgg) : 0;
            return el('td', {
              class: 'pivot-cell' + (v === null ? ' empty' : ''),
              style: v !== null ? { background: `rgba(124,124,245,${alpha.toFixed(3)})` } : null,
              title: c ? `${rk} × ${ck}: ${c.values.map((x) => fmt(x)).join(', ')}` : '',
            }, [v === null ? '·' : fmt(v)]);
          }),
        ]));
      });
      root._grid.appendChild(tbl);
      clear(root._note);
      root._note.append(
        pill(`index = ${p.indexCol}`, 'accent'), pill(`columns = ${p.colCol}`, 'accent'),
        pill(`values = ${p.valueCol}`, 'accent'), pill(`aggfunc = ${p.fn}`, 'gold'),
        pill(`${p.rowKeys.length} × ${p.colKeys.length}`, 'cyan'),
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
      tb.appendChild(el('thead', {}, [el('tr', {}, [el('th', {}, ['']), ...p.cols.map((c) => el('th', {}, [c]))])]));
      const tbody = el('tbody');
      p.rows.forEach((r) => {
        const on = rev.has(r);
        tbody.appendChild(el('tr', { class: (on ? 'on' : '') + (p.active === r ? ' active' : '') }, [
          el('td', { class: 'rowlab' }, [r]),
          ...p.cols.map((c) => {
            const v = p.data?.[c]?.[r];
            return el('td', {}, [v === undefined ? '·' : (r === 'count' ? String(v) : fmt(v, 3))]);
          }),
        ]));
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
      const tb = el('table', { class: 'd-table' });
      tb.appendChild(el('thead', {}, [el('tr', {}, [
        el('th', {}, ['#']), el('th', {}, ['Column']), el('th', {}, ['Dtype']),
        el('th', {}, ['Non-Null']), el('th', {}, ['Null']),
      ])]));
      const tbody = el('tbody');
      p.info.columns.forEach((c, i) => {
        tbody.appendChild(el('tr', { class: i < p.revealed ? 'on' : '' }, [
          el('td', { class: 'rowlab' }, [String(i)]),
          el('td', { style: { color: 'var(--accent)', fontFamily: 'var(--mono)' } }, [c.name]),
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
      const total = p.total || 1;
      root._bars.innerHTML = '';
      (p.sorted || []).forEach((s, i) => {
        const c = p.counts?.[s.key] ?? 0;
        const val = p.normalize ? `${(c / total * 100).toFixed(1)}%` : String(c);
        root._bars.appendChild(el('div', { class: 'bar-row' }, [
          el('div', { class: 'bar-label', title: s.key }, [s.key]),
          el('div', { class: 'bar-track' }, [el('div', {
            class: 'bar-fill' + (i === 0 ? ' gold' : ''),
            style: { width: (c / max * 100) + '%', transitionDelay: (i * 35) + 'ms' },
          })]),
          el('div', { class: 'bar-val' }, [val]),
        ]));
      });
      clear(root._note);
      root._note.append(pill(p.col, 'cyan'), pill(`${p.keys.length} ${L('类', 'categories').zh}`),
        pill(`${Math.max(0, p.cursor + 1)} / ${p.total}`, 'gold'));
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
      root._b.innerHTML = '';
      const fnVal = (b) => {
        if (p.fn === 'count') return b.items.length;
        const ns = b.items.map((it) => it.value).filter((v) => typeof v === 'number' && Number.isFinite(v));
        if (!ns.length) return NaN;
        if (p.fn === 'sum') return ns.reduce((a, c) => a + c, 0);
        if (p.fn === 'min') return Math.min(...ns);
        if (p.fn === 'max') return Math.max(...ns);
        if (p.fn === 'median') { const s = [...ns].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
        const m = ns.reduce((a, c) => a + c, 0) / ns.length;
        if (p.fn === 'std') return Math.sqrt(ns.reduce((a, c) => a + (c - m) ** 2, 0) / Math.max(1, ns.length - 1));
        return m;
      };
      (p.buckets || []).forEach((b) => {
        root._b.appendChild(el('div', { class: 'bucket' + (b.items.length ? ' has' : '') }, [
          el('div', { class: 'bucket-head' }, [
            el('div', { class: 'bucket-key', title: b.key }, [String(b.key)]),
            el('div', { class: 'bucket-n' }, [`${b.items.length} ${L('行', 'rows').zh}`]),
          ]),
          el('div', { class: 'bucket-body' }, b.items.map((it) => el('div', {
            class: 'bucket-chip', title: `${it.name} = ${fmt(it.value)}`,
          }, [`${it.name} ${fmt(it.value)}`]))),
          el('div', { class: 'bucket-foot' }, [
            el('div', { class: 'bucket-agg' + (p.computed ? '' : ' pending') }, [
              el('span', { class: 'k' }, [`${p.target}.${p.fn}`]),
              el('span', { class: 'v' }, [p.computed ? fmt(fnVal(b)) + (p.unit || '') : '…']),
            ]),
          ]),
        ]));
      });
      clear(root._note);
      root._note.append(
        pill(`${L('分组键', 'key').zh} ${p.by}`, 'cyan'),
        pill(`${p.target}.${p.fn}()`, 'gold'),
        pill(`${p.keys.length} ${L('组', 'groups').zh}`),
        p.computed ? pill(L('组内计算完成', 'groups computed').zh, 'emerald') : pill(`${Math.max(0, p.cursor + 1)} / ${p.total}`, ''),
      );
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
        root._big = el('div', { class: 'acc final', style: { minWidth: '210px', padding: '18px 24px' } });
        root._cards = el('div', { class: 'cards-row', style: { justifyContent: 'center' } });
        root.append(root._big, root._cards);
        host.appendChild(root);
      }
      root._big.innerHTML = '';
      root._big.append(
        el('div', { class: 'acc-k' }, [p.label]),
        el('div', { class: 'acc-v', style: { fontSize: '34px' } }, [fmt(p.result) + (p.fn === 'count' ? '' : (p.unit || ''))]),
        el('div', { class: 'acc-k', style: { marginTop: '5px' } }, [`df["${p.col}"].${p.fn}()`]),
      );
      root._cards.innerHTML = '';
      const s = p.summary || {};
      [['mean', fmt(s.mean)], ['std', fmt(s.std)], ['min', fmt(s.min)], ['median', fmt(s.median)], ['max', fmt(s.max)]]
        .forEach(([k, v]) => root._cards.appendChild(el('div', { class: 'card' }, [
          el('div', { class: 'card-k' }, [k]),
          el('div', { class: 'card-v', style: { fontSize: '15px' } }, [v]),
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
  if (!host._chart) host._chart = makeChart(host);
  return host._chart;
};
R.sort = (host) => {
  if (!host._sorter) { host.innerHTML = ''; host._sorter = makeSorter(host); }
  return host._sorter;
};
R.reduce = (host) => {
  if (!host._reduce) host._reduce = makeReduce(host);
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
      root._flow.appendChild(el('div', { class: 'pf-node start' }, [
        el('div', { class: 'pf-ic' }, ['▤']),
        el('div', { class: 'pf-t' }, ['read_csv']),
        el('div', { class: 'pf-s' }, [`${p.original.nrow} × ${p.original.ncol}`]),
      ]));
      (p.history || []).slice(0, 8).forEach((h, i) => {
        root._flow.appendChild(el('div', { class: 'pf-arrow', style: { animationDelay: (i * 80) + 'ms' } }, ['→']));
        root._flow.appendChild(el('div', { class: 'pf-node step', style: { animationDelay: (i * 80) + 'ms' } }, [
          el('div', { class: 'pf-n' }, [String(i + 1)]),
          el('div', { class: 'pf-t' }, [pick(h.label)]),
          el('div', { class: 'pf-s' }, [h.delta || '']),
        ]));
      });
      root._flow.appendChild(el('div', { class: 'pf-arrow' }, ['→']));
      root._flow.appendChild(el('div', { class: 'pf-node end' }, [
        el('div', { class: 'pf-ic' }, ['✓']),
        el('div', { class: 'pf-t' }, ['to_csv']),
        el('div', { class: 'pf-s' }, [`${p.final.nrow} × ${p.final.ncol}`]),
      ]));
      clear(root._note);
      root._note.append(pill(`${p.history.length} ${L('步处理', 'steps').zh}`, 'cyan'),
        pill(`${p.original.nrow} → ${p.final.nrow} ${L('行', 'rows').zh}`, p.final.nrow < p.original.nrow ? 'emerald' : ''),
        pill(`${p.original.ncol} → ${p.final.ncol} ${L('列', 'cols').zh}`));
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
        el('div', { class: 'card-v', style: { fontSize: '15px' } }, [`x̄ ${fmt(c.s.mean)}${c.unit}`]),
        el('div', { class: 'card-sub' }, [`σ ${fmt(c.s.std)}  ·  ${fmt(c.s.min)} ~ ${fmt(c.s.max)}`]),
      ])));
      clear(root._note);
      root._note.append(pill(`${p.shape[0]} × ${p.shape[1]}`, 'emerald'),
        pill(`${L('原始', 'original').zh} ${p.originalShape[0]} × ${p.originalShape[1]}`));
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
        el('div', { class: 'acc-k' }, [t('code.ready')]),
        el('div', { class: 'acc-v', style: { fontSize: '28px', color: 'var(--ok)' } }, ['cleaned.csv']),
        el('div', { class: 'st-row', style: { justifyContent: 'center', marginTop: '4px' } }, [
          pill(`${p.rows} × ${p.cols}`, 'cyan'),
          pill(`${Math.max(1, Math.round(p.csv.length / 1024))} KB`),
          pill(`${(p.history || []).length} ${L('步管道', 'steps').zh}`, 'gold'),
        ]),
        el('button', {
          class: 'btn primary', style: { marginTop: '10px' },
          onclick: () => {
            const blob = new Blob(['\uFEFF' + p.csv], { type: 'text/csv;charset=utf-8' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = 'cleaned.csv';
            a.click();
            setTimeout(() => URL.revokeObjectURL(a.href), 1000);
          },
        }, ['⤓ ' + t('code.export')]),
      );
    },
    destroy() { },
  };
};

const SUGGEST = [
  { id: 'drop_extremes', hint: L('完整扫描推理', 'full scan reasoning'), star: true },
  { id: 'merge', hint: L('两表按 key 配对', 'join two frames'), star: true },
  { id: 'groupby', hint: L('数据飞入桶中', 'rows into buckets'), star: true },
  { id: 'pivot_table', hint: L('行列交叉汇总', 'cross-tabulate'), star: false },
];

R.none = (host) => ({
  update() {
    host.innerHTML = '';
    host.appendChild(el('div', { class: 'empty-stage' }, [
      el('div', { class: 'es-badge' }, [t('stage.ready')]),
      el('div', { class: 'es-title' }, [t('stage.idleTitle')]),
      el('div', { class: 'es-sub' }, [t('stage.idleSub')]),
      el('div', { class: 'es-cards' }, SUGGEST.map((s) => {
        const op = (window.__PF__?.getOp?.(s.id)) || null;
        return el('button', {
          class: 'es-card' + (s.star ? ' star' : ''),
          onclick: () => window.__PF__?.stage?.onPick?.(s.id),
        }, [
          el('div', { class: 'es-k' }, [pick(s.hint)]),
          el('div', { class: 'es-t' }, [op ? pick(op.label) : s.id]),
          s.star ? el('div', { class: 'es-star' }, ['★']) : null,
        ]);
      })),
      el('div', { class: 'es-keys' }, [
        el('span', { class: 'kbd' }, ['Space']), el('span', {}, [t('stage.keyPlay')]),
        el('span', { class: 'kbd' }, ['←']), el('span', { class: 'kbd' }, ['→']), el('span', {}, [t('stage.keyStep')]),
        el('span', { class: 'kbd' }, ['Home']), el('span', { class: 'kbd' }, ['End']), el('span', {}, [t('stage.keyEnds')]),
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
      if (!R[kind] && kind !== 'none') console.warn(`[stage] no renderer for kind="${kind}"`);
      this.renderer = (R[kind] || R.none)(this.canvas, p);
      setTimeout(() => this.canvas?.classList.remove('stage-enter'), 500);
    }
    try { this.renderer.update(p); } catch (e) { console.error('[stage]', kind, e); }
  }

  clear() { this.render(null); }
}
