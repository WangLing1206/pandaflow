window.__REC__ = {
  openGroup: function (name) {
    var heads = Array.prototype.slice.call(document.querySelectorAll('.op-group-head'));
    for (var i = 0; i < heads.length; i++) {
      var label = heads[i].querySelector('.op-group-name');
      if (label && label.textContent.trim() === name) {
        var wrap = heads[i].parentElement;
        if (wrap && wrap.className.indexOf('open') < 0) heads[i].click();
        return;
      }
    }
  },
  frameIndex: function (pred) {
    var f = window.__PF__.player.frames;
    for (var i = 0; i < f.length; i++) if (pred(f[i], i)) return i;
    return -1;
  },
  lockIdx: function () { return this.frameIndex(function (f) { return f.stage && f.stage.verdict === 'lock'; }); },
  deleteEndIdx: function () {
    var f = window.__PF__.player.frames, last = -1;
    for (var i = 0; i < f.length; i++) if (f[i].stage && f[i].stage.phase === 'delete') last = i;
    return last;
  },
  resetIdx: function () { return this.frameIndex(function (f) { return f.stage && f.stage.phase === 'reset'; }); },
  finalIdx: function () { return window.__PF__.player.frames.length - 1; },
  loadDataset: function (id) {
    var order = ['student', 'orders', 'weather', 'region'];
    var i = order.indexOf(id);
    var btns = Array.prototype.slice.call(document.querySelectorAll('.ds-option'));
    if (btns[i]) btns[i].click();
  },
  endCard: function () {
    var d = document.createElement('div');
    d.style.cssText = 'position:fixed;inset:0;z-index:9999;display:grid;place-items:center;'
      + 'background:var(--bg-0);font-family:-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;'
      + 'opacity:0;transition:opacity .7s ease';
    var logo = '<div style="width:74px;height:74px;margin:0 auto 24px;border-radius:22px;'
      + 'background:linear-gradient(140deg,var(--accent),var(--accent-2));display:grid;place-items:center">'
      + '<svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="var(--accent-ink)"'
      + ' stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M7 19V6h5a4 4 0 010 8H7"/></svg></div>';
    d.innerHTML = '<div style="text-align:center">' + logo
      + '<div style="font-size:36px;font-weight:700;color:var(--txt-0);letter-spacing:-.5px">熊猫数据流 · PandaFlow</div>'
      + '<div style="font-size:15px;color:var(--txt-1);margin-top:14px;line-height:1.9">'
      + '可视化数据分析全过程演示平台<br>59 个可回放操作 · 14 种联动图表 · 中英双语 · 明暗主题</div>'
      + '<div style="margin-top:28px;display:inline-flex;align-items:center;padding:11px 24px;border-radius:999px;'
      + 'border:1px solid var(--accent-line);background:var(--accent-soft);color:var(--accent);'
      + 'font-family:monospace;font-size:16px">wangling1206.github.io/pandaflow</div>'
      + '<div style="font-size:13px;color:var(--txt-3);margin-top:24px">谢谢观看 · Thank you</div></div>';
    document.body.appendChild(d);
    requestAnimationFrame(function () { d.style.opacity = '1'; });
  }
};
