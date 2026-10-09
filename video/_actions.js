const ACTIONS_SRC = `(code => {
  const { runOp, getOp, state, player } = window.__PF__;
  const R = window.__REC__;
  const autoCfg = (op) => {
    const c = {};
    for (const p of op.params || []) {
      if (p.type === 'column') {
        const pool = state.df.columns.filter((x) => (p.filter === 'number' ? state.df.dtypes[x] === 'number' : true));
        c[p.key] = pool[0];
      } else if (p.type === 'columns') c[p.key] = [];
      else if (p.type === 'select') c[p.key] = p.default;
      else if (p.type === 'number') c[p.key] = p.default;
      else if (p.type === 'text') c[p.key] = p.default || '';
      else if (p.type === 'rename') c[p.key] = {};
    }
    return c;
  };
  const actions = {
    pause: () => player.pause(),
    seek: (i) => { player.pause(); player.seek(i); },
    playAt: (i, sp) => { player.pause(); player.seek(i); player.setSpeed(sp); player.play(); },
    pauseAt: (what) => { player.pause(); const i = what === 'lock' ? R.lockIdx() : R.deleteEndIdx(); if (i >= 0) player.seek(i); },
    seekAt: (what) => { player.pause(); const i = what === 'reset' ? R.resetIdx() : R.finalIdx(); if (i >= 0) player.seek(i); },
    run: (id, cfg, sp, seekTo) => {
      const op = getOp(id);
      let c = cfg || autoCfg(op);
      const numeric = state.df.columns.filter((x) => state.df.dtypes[x] === 'number');
      if (c && typeof c.col === 'number') c = { ...c, col: numeric[c.col] || numeric[0] };
      runOp(op, c);
      player.pause();
      if (typeof seekTo === 'number') { player.seek(seekTo); player.setSpeed(sp || 1); }
      else { player.setSpeed(sp || 1); player.play(); }
    },
    reset: () => document.getElementById('btnReset').click(),
    openImport: () => document.getElementById('dsChip').click(),
    loadDataset: (id) => R.loadDataset(id),
    openGroup: (n) => R.openGroup(n),
    view: (tab, chartType) => {
      const v = window.__PF__.viewPanel;
      v.active = tab;
      if (chartType) { v.chartType = chartType; v.cfg = {}; }
      v.refresh();
    },
    switchLang: () => document.getElementById('btnLang').click(),
    switchTheme: () => document.getElementById('btnTheme').click(),
    buildPipeline: () => {
      document.getElementById('btnReset').click();
      for (const id of ['drop_duplicates', 'drop_extremes']) {
        const op = getOp(id);
        const c = autoCfg(op);
        if (id === 'drop_extremes') c.col = state.df.columns.filter((x) => state.df.dtypes[x] === 'number')[0];
        runOp(op, c);
        player.pause();
        player.seek(player.frames.length - 1);
      }
      player.pause();
    },
    endCard: () => R.endCard(),
  };
  if (!code.includes(';') && /^[a-zA-Z]+\\(/.test(code)) {
    const m = code.match(/^([a-zA-Z]+)\\((.*)\\)$/);
    if (m && actions[m[1]]) {
      const args = m[2].trim() ? (new Function('return [' + m[2] + ']'))() : [];
      actions[m[1]](...args);
      return 'ok';
    }
  }
  const names = Object.keys(actions);
  new Function(...names, code)(...names.map((n) => actions[n]));
  return 'ok';
})`;
