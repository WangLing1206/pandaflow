/* ------------------------------------------------------------------
 * record2.mjs — 录制演示视频（自采帧版本）
 *  ----------------------------------------------------------------
 *  为什么不用 Playwright 的 recordVideo：
 *  Chrome 的 Page.startScreencast 在 headless 下会被节流，页面不重绘时
 *  就不再发帧，录出来常常是「卡在加载界面」的一张静止画面。
 *
 *  这里的做法：用 CDP 的 Page.captureScreenshot 主动逐帧抓图 ——
 *  它每次都强制重新渲染，所以不可能卡住。抓到的帧带时间戳，
 *  最后按固定帧率重采样，用 ffmpeg 按每帧时长拼成视频。
 * ------------------------------------------------------------------ */

import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const require_ = createRequire(join(HERE, '..', 'tools', 'noop.js'));
const { chromium } = require_('playwright');

const URL_ = process.env.URL || 'http://127.0.0.1:8777/index.html';
const W = 1600, H = 900;
const FPS = 5;                       // 输出帧率
const CAPTURE_FPS = 7;               // 抓帧速率（略高于输出即可）
const GAP = 0.45;
const FFMPEG = process.env.FFMPEG ||
  'C:/Users/wang1/AppData/Roaming/Python/Python313/site-packages/imageio_ffmpeg/binaries/ffmpeg-win-x86_64-v7.1.exe';

/* ---------------------- 旁白时长 ---------------------- */
const manifest = JSON.parse(readFileSync(join(HERE, 'audio', 'manifest.json'), 'utf8').replace(/^\uFEFF/, ''));
const dur = {};
for (const m of manifest) {
  const r = spawnSync(FFMPEG, ['-i', m.file, '-f', 'null', '-'], { encoding: 'utf8' });
  const times = [...String(r.stderr || '').matchAll(/time=(\d+):(\d+):([\d.]+)/g)];
  const last = times[times.length - 1];
  dur[m.id] = last ? (+last[1]) * 3600 + (+last[2]) * 60 + parseFloat(last[3]) : 0;
  if (!dur[m.id]) throw new Error('cannot read duration: ' + m.file);
}

/* ====================== 时间轴（由 _timeline.js 提供） ====================== */
let TL = [];
let cursor = 0;
const segStart = {};
for (const m of manifest) { segStart[m.id] = cursor; cursor += dur[m.id] + GAP; }
const TOTAL = cursor - GAP;
const at = (seg, t, code, note = '') => TL.push({ t: segStart[seg] + t, code, note, seg, kind: 'page' });
const mouse = (seg, t, fx, fy, note = '') =>
  TL.push({ t: segStart[seg] + t, fx, fy, note, seg, kind: 'mouse' });

/* TIMELINE_BEGIN */
/* --- s1 开场：片头卡 → 主界面 --- */
at('s1', 8.0, `document.getElementById('bootStart').click()`, '关闭启动卡');
mouse('s1', 12, 0.07, 0.30, '悬停左栏');
mouse('s1', 17, 0.36, 0.30, '悬停舞台');
mouse('s1', 22, 0.50, 0.65, '悬停视图');
mouse('s1', 27, 0.88, 0.40, '悬停检查器');

/* --- s2 整体介绍 --- */
at('s2', 0.8, `openGroup('清洗')`, '展开清洗分组');
at('s2', 4.0, `openGroup('合并与重塑')`, '展开合并分组');
at('s2', 8.0, `view('table')`, '切到数据表');
mouse('s2', 10.5, 0.22, 0.45, '左栏：操作库');
mouse('s2', 15.0, 0.42, 0.22, '中上：舞台');
at('s2', 20.0, `view('stats')`, '切到统计视图');
mouse('s2', 22.0, 0.50, 0.62, '中下：分析视图');
at('s2', 26.0, `view('missing')`, '切到缺失值视图');
mouse('s2', 29.0, 0.88, 0.42, '右侧：检查器');

/* --- s3 双语与主题 --- */
at('s3', 1.0, `switchLang()`, '切到英文');
at('s3', 12.0, `switchTheme()`, '切到浅色主题');
at('s3', 21.5, `switchLang()`, '切回中文');
at('s3', 26.0, `switchTheme()`, '切回深色主题');

/* --- s4 旗舰演示 --- */
at('s4', 0.4, `view('table'); run('drop_extremes', {col:0, mode:'both'}, 1, 0)`, '第 0 帧');
at('s4', 10.0, `seek(1)`, '比较规则');
at('s4', 17.5, `playAt(2, 0.95)`, '开始扫描');
at('s4', 38.0, `pauseAt('lock')`, '锁定极值');
at('s4', 44.0, `playAt('delete', 1.05)`, '执行删除');
at('s4', 51.5, `pauseAt('deleteEnd')`, '索引断层');
at('s4', 55.5, `seekAt('reset')`, 'reset_index');
at('s4', 58.5, `seekAt('final')`, '结果对比');

/* --- s5 图表联动 --- */
at('s5', 0.4, `view('charts', 'violin')`, '小提琴图');
at('s5', 6.0, `view('charts', 'box')`, '箱线图');
at('s5', 11.0, `view('charts', 'hist')`, '直方图');
at('s5', 16.0, `view('charts', 'strip')`, '点阵图');
at('s5', 21.0, `view('charts', 'density')`, '密度曲线');
at('s5', 26.0, `view('charts', 'ecdf')`, '累积分布');
at('s5', 31.0, `view('charts', 'qq')`, 'Q-Q 图');
at('s5', 35.5, `view('charts', 'scatter')`, '散点图');

/* --- s6 清洗与合并 --- */
at('s6', 0.4, `reset(); view('table'); run('drop_duplicates', null, 2.4)`, '重复行检测');
at('s6', 13.0, `reset(); run('dropna', null, 2.6)`, '缺失值热力图');
at('s6', 22.5, `reset(); run('merge', null, 1.6)`, '两表连接');
at('s6', 31.0, `reset(); run('pivot_table', null, 1.8)`, '透视表');

/* --- s7 序列运算与统计 --- */
at('s7', 0.4, `reset(); run('rolling', null, 2.0)`, '滑动窗口');
at('s7', 7.0, `reset(); run('diff', null, 2.2)`, '差分');
at('s7', 13.0, `reset(); run('cut', null, 2.2)`, '分箱');
at('s7', 19.0, `reset(); run('groupby', null, 2.0)`, '分组聚合');
at('s7', 25.0, `reset(); run('agg', null, 2.4)`, '累加器求均值');
at('s7', 30.0, `pause()`, '停住');

/* --- s8 导入导出与总结 --- */
at('s8', 0.4, `reset(); openImport()`, '打开数据集面板');
mouse('s8', 3.5, 0.88, 0.38, '悬停内置数据集');
mouse('s8', 7.0, 0.88, 0.62, '悬停导入区');
at('s8', 11.0, `loadDataset('orders')`, '切换到电商订单');
at('s8', 14.0, `loadDataset('weather')`, '切换到城市气温');
at('s8', 17.0, `loadDataset('student')`, '切回成绩单');
at('s8', 19.5, `buildPipeline()`, '静默构建管道');
at('s8', 22.0, `run('export', null, 1.4)`, '导出总览');
at('s8', 29.5, `seekAt('final')`, '导出卡片');
at('s8', 32.5, `endCard()`, '片尾卡');
/* TIMELINE_END */

TL.sort((a, b) => a.t - b.t);

/* ====================== 页面内动作表 ====================== */
const HELPERS = `
window.__REC__ = {
  openGroup(name) {
    const head = [...document.querySelectorAll('.op-group-head')]
      .find((n) => n.querySelector('.op-group-name')?.textContent.trim() === name);
    const wrap = head?.parentElement;
    if (wrap && !wrap.classList.contains('open')) head.click();
  },
  frameIndex(pred) {
    const f = window.__PF__.player.frames;
    for (let i = 0; i < f.length; i++) if (pred(f[i], i)) return i;
    return -1;
  },
  lockIdx() { return this.frameIndex((f) => f.stage?.verdict === 'lock'); },
  deleteEndIdx() {
    const f = window.__PF__.player.frames;
    let last = -1;
    f.forEach((x, i) => { if (x.stage?.phase === 'delete') last = i; });
    return last;
  },
  resetIdx() { return this.frameIndex((f) => f.stage?.phase === 'reset'); },
  finalIdx() { return window.__PF__.player.frames.length - 1; },
  loadDataset(id) {
    const order = ['student', 'orders', 'weather', 'region'];
    const i = order.indexOf(id);
    const btns = [...document.querySelectorAll('.ds-option')];
    if (btns[i]) btns[i].click();
  },
  endCard() {
    const d = document.createElement('div');
    d.style.cssText = ['position:fixed','inset:0','z-index:9999','display:grid','place-items:center',
      'background:var(--bg-0)','font-family:-apple-system,"Segoe UI","Microsoft YaHei",sans-serif',
      'opacity:0','transition:opacity .7s ease'].join(';');
    d.innerHTML = \`<div style="text-align:center">
      <div style="width:74px;height:74px;margin:0 auto 24px;border-radius:22px;
        background:linear-gradient(140deg,var(--accent),var(--accent-2));display:grid;place-items:center">
        <svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="var(--accent-ink)"
             stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M7 19V6h5a4 4 0 010 8H7"/></svg>
      </div>
      <div style="font-size:36px;font-weight:700;color:var(--txt-0);letter-spacing:-.5px">熊猫数据流 · PandaFlow</div>
      <div style="font-size:15px;color:var(--txt-1);margin-top:14px;line-height:1.9">
        可视化数据分析全过程演示平台<br>59 个可回放操作 · 14 种联动图表 · 中英双语 · 明暗主题
      </div>
      <div style="margin-top:28px;display:inline-flex;align-items:center;padding:11px 24px;border-radius:999px;
        border:1px solid var(--accent-line);background:var(--accent-soft);color:var(--accent);
        font-family:monospace;font-size:16px">wangling1206.github.io/pandaflow</div>
      <div style="font-size:13px;color:var(--txt-3);margin-top:24px">谢谢观看 · Thank you</div>
    </div>\`;
    document.body.appendChild(d);
    requestAnimationFrame(() => { d.style.opacity = '1'; });
  },
};
`;

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

/* ====================== 抓帧 ====================== */
const FRAMES = join(HERE, 'frames');
rmSync(FRAMES, { recursive: true, force: true });
mkdirSync(FRAMES, { recursive: true });

const browser = await chromium.launch({
  channel: 'chrome',
  args: ['--force-device-scale-factor=1', '--hide-scrollbars', '--disable-lcd-text',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows', '--disable-features=CalculateNativeWinOcclusion'],
});
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);

await page.goto(URL_, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => !!window.__PF__, null, { timeout: 30000 });
await page.evaluate(HELPERS);

/* 关键：headless Chrome 在没有动画时会停止合成，screencast / captureScreenshot
   都会一直返回同一张旧帧（表现为「卡在加载界面」）。这里注入一个几乎不可见的
   常驻动画元素，逼着合成器持续出帧。alpha 只有 0.5%，肉眼看不出来。 */
await page.addStyleTag({ content: `
  @keyframes __recShift { from { background-position: 0% 0; } to { background-position: 200% 0; } }
  #__rec_anim__ {
    position: fixed; inset: 0; pointer-events: none; z-index: 2147483647;
    background-image: linear-gradient(90deg, rgba(255,255,255,.004), rgba(255,255,255,.008));
    background-size: 200% 100%;
    animation: __recShift .5s linear infinite;
  }
` });
await page.evaluate(() => {
  const d = document.createElement('div');
  d.id = '__rec_anim__';
  document.body.appendChild(d);
});

await page.waitForTimeout(800);

console.log(`旁白总长 ${TOTAL.toFixed(1)}s = ${Math.floor(TOTAL / 60)}:${String(Math.round(TOTAL % 60)).padStart(2, '0')}`);
console.log(`抓帧 ${FPS} fps …`);

/* 抓帧循环与动作时间轴并行 */
let capturing = true;
let shot = 0;
const shots = [];                       // { t, file }
const t0 = Date.now();

const captureLoop = (async () => {
  const interval = 1000 / CAPTURE_FPS;
  let next = t0;
  while (capturing) {
    // 限速很关键：不加节流会以 ~40fps 疯狂重绘（backdrop-filter 很贵），
    // 跑一两分钟后 Chrome 就不再更新 surface，录出来还是静止画面。
    const wait = next - Date.now();
    if (wait > 0) await page.waitForTimeout(wait);
    next += interval;
    const t = (Date.now() - t0) / 1000;
    try {
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 82, fromSurface: true });
      const file = join(FRAMES, `f${String(shot++).padStart(6, '0')}.jpg`);
      writeFileSync(file, Buffer.from(data, 'base64'));
      shots.push({ t, file });
    } catch (e) {
      if (!capturing) break;
      console.error('capture failed:', e.message);
    }
  }
})();

/* 动作调度：绝对时钟，漂移自校正 */
for (const ev of TL) {
  const wait = ev.t * 1000 - (Date.now() - t0);
  if (wait > 0) await page.waitForTimeout(wait);
  try {
    if (ev.kind === 'mouse') {
      await page.mouse.move(Math.round(ev.fx * W), Math.round(ev.fy * H), { steps: 10 });
    } else {
      await page.evaluate(ACTIONS_SRC, ev.code);
    }
  } catch (e) {
    console.error('action failed:', ev.code, '|', e.message);
  }
}

await page.waitForTimeout(1800);
const videoLen = (Date.now() - t0) / 1000;
capturing = false;
await captureLoop;
await ctx.close();
await browser.close();

console.log(`抓帧完成：${shots.length} 张，覆盖 ${videoLen.toFixed(1)}s`);

/* ====================== 按固定帧率重采样 ====================== */
const N = Math.ceil(videoLen * FPS);
const listPath = join(FRAMES, 'list.txt');
const lines = [];
let si = 0;
for (let i = 0; i < N; i++) {
  const target = i / FPS;
  while (si + 1 < shots.length && shots[si + 1].t <= target) si++;
  lines.push(`file '${shots[si].file.replace(/\\/g, '/')}'`);
  lines.push(`duration ${(1 / FPS).toFixed(6)}`);
}
lines.push(`file '${shots[shots.length - 1].file.replace(/\\/g, '/')}'`);
writeFileSync(listPath, lines.join('\n') + '\n', 'utf8');

const silent = join(FRAMES, 'silent.mp4');
const r = spawnSync(FFMPEG, ['-y', '-f', 'concat', '-safe', '0', '-i', listPath,
  '-vf', `fps=${FPS},format=yuv420p`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', silent],
  { encoding: 'utf8' });
if (r.status !== 0) { console.error(String(r.stderr).slice(-1200)); throw new Error('frame assembly failed'); }

writeFileSync(join(HERE, 'raw', 'video.json'), JSON.stringify({ video: silent, len: videoLen, fps: FPS }, null, 2));
console.log('静音视频已生成:', silent, videoLen.toFixed(1) + 's');
