/* ------------------------------------------------------------------
 * record.mjs — 录制演示视频
 *  ----------------------------------------------------------------
 *  思路：旁白音频是按段生成的，每段的时长已知；于是把「界面动作」
 *  也排到同一条时间轴上（段内绝对秒数），录制时用绝对时钟调度，
 *  动作耗时造成的漂移会自动被下一拍的等待修正。
 *  最后用 ffmpeg 把 webm 视频 + 拼接好的 wav 旁白合成 mp4。
 * ------------------------------------------------------------------ */

import { readFileSync, readdirSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));

// playwright 装在 tools/ 下（视频与测试脚本共用），这里显式解析
const require_ = createRequire(join(HERE, '..', 'tools', 'noop.js'));
const { chromium } = require_('playwright');
const URL_ = process.env.URL || 'http://127.0.0.1:8777/index.html';
const W = 1920, H = 1080;
const GAP = 0.45;                 // 段间留白（秒）

const FFMPEG = process.env.FFMPEG ||
  'C:/Users/wang1/AppData/Roaming/Python/Python313/site-packages/imageio_ffmpeg/binaries/ffmpeg-win-x86_64-v7.1.exe';

/* ---------------------- 读取旁白时长 ---------------------- */
// PowerShell 写出的 UTF-8 带 BOM，读的时候要剥掉
const manifest = JSON.parse(readFileSync(join(HERE, 'audio', 'manifest.json'), 'utf8').replace(/^﻿/, ''));
const dur = {};
for (const m of manifest) {
  const r = spawnSync(FFMPEG, ['-i', m.file, '-f', 'null', '-'], { encoding: 'utf8' });
  const times = [...String(r.stderr || '').matchAll(/time=(\d+):(\d+):([\d.]+)/g)];
  const last = times[times.length - 1];
  dur[m.id] = last ? (+last[1]) * 3600 + (+last[2]) * 60 + parseFloat(last[3]) : 0;
  if (!dur[m.id]) throw new Error('无法读取音频时长: ' + m.file);
}

/* ---------------------- 时间轴 ---------------------- */
// 每段：segments 内的秒数 → 动作。动作由 __PF__ 暴露的 API 执行。
const TL = [];
let cursor = 0;
const segStart = {};
for (const m of manifest) { segStart[m.id] = cursor; cursor += dur[m.id] + GAP; }
const TOTAL = cursor - GAP;

const at = (seg, t, code, note = '') => TL.push({ t: segStart[seg] + t, code, note, seg, kind: 'page' });
/** 鼠标必须由 Playwright 真实移动，合成事件无法触发 CSS :hover */
const mouse = (seg, t, fx, fy, note = '') =>
  TL.push({ t: segStart[seg] + t, fx, fy, note, seg, kind: 'mouse' });

/* --- s1 开场：片头卡 → 主界面 --- */
at('s1', 8.2, `document.getElementById('bootStart').click()`, '关闭启动卡');
mouse('s1', 12, 0.06, 0.30, '悬停左栏');
mouse('s1', 16, 0.34, 0.30, '悬停舞台');
mouse('s1', 21, 0.55, 0.55, '悬停数据表');
mouse('s1', 26, 0.86, 0.40, '悬停检查器');

/* --- s2 界面导览 --- */
at('s2', 1.0, `openGroup('可视化')`, '展开可视化分组');
mouse('s2', 4.0, 0.08, 0.35, '左栏：操作库');
mouse('s2', 9.0, 0.42, 0.22, '中上：舞台');
mouse('s2', 14.5, 0.50, 0.62, '中下：数据表');
mouse('s2', 21.0, 0.87, 0.42, '右侧：检查器');
mouse('s2', 25.5, 0.50, 0.62, '回到数据表');

/* --- s3 结构概览 --- */
at('s3', 0.4, `run('info', null, 0.7)`, '运行 info');
at('s3', 20.5, `pause()`, '停在结果帧');

/* --- s4 旗舰演示 --- */
at('s4', 0.4, `run('drop_extremes', {col:'数学',mode:'both'}, 1, 0)`, '第 0 帧：明确目标');
at('s4', 11.0, `seek(1)`, '第 1 帧：比较规则');
at('s4', 19.0, `playAt(2, 0.92)`, '开始逐行扫描');
at('s4', 40.5, `pauseAt('lock')`, '停在锁定帧');
at('s4', 47.0, `playAt('delete', 1.05)`, '播放删除过程');
at('s4', 55.5, `pauseAt('deleteEnd')`, '停在索引断层');
at('s4', 60.0, `seekAt('reset')`, 'reset_index');
at('s4', 63.0, `seekAt('final')`, '结果对比');

/* --- s5 清洗操作族 --- */
at('s5', 0.4, `reset(); run('drop_duplicates', null, 1.9)`, '重复行检测');
at('s5', 12.5, `reset(); run('dropna', null, 2.0)`, '缺失值热力图');
at('s5', 22.5, `reset(); run('fillna', null, 1.6)`, '缺失值填充');
at('s5', 27.0, `pause()`, '停住');

/* --- s6 变换与统计 --- */
at('s6', 0.4, `reset(); run('sort_values', null, 1.5)`, '插入排序');
at('s6', 12.4, `reset(); run('groupby', null, 2.2)`, '分组聚合');
at('s6', 22.0, `reset(); run('agg', null, 1.8)`, '累加器求均值');
at('s6', 30.8, `pause()`, '停住');

/* --- s7 可视化 --- */
at('s7', 0.4, `reset(); run('hist', null, 1.4)`, '直方图分箱');
at('s7', 11.4, `reset(); run('box', null, 1.5)`, '箱线图与离群点');
at('s7', 24.5, `pause()`, '停住');

/* --- s8 导入导出与总结 --- */
at('s8', 0.4, `reset(); openImport()`, '打开数据集面板');
mouse('s8', 4.0, 0.88, 0.38, '悬停内置数据集');
mouse('s8', 8.0, 0.88, 0.62, '悬停导入区');
at('s8', 12.6, `loadDataset('orders')`, '切换到电商订单');
at('s8', 15.6, `loadDataset('weather')`, '切换到城市气温');
at('s8', 18.6, `loadDataset('student')`, '切回成绩单');
at('s8', 21.0, `buildPipeline()`, '静默构建一条管道');
at('s8', 23.5, `run('export', null, 1.25)`, '导出总览');
at('s8', 33.0, `seekAt('final')`, '导出卡片');
at('s8', 37.2, `endCard()`, '片尾卡');

TL.sort((a, b) => a.t - b.t);

/* ---------------------- 录制 ---------------------- */
rmSync(join(HERE, 'raw'), { recursive: true, force: true });
mkdirSync(join(HERE, 'raw'), { recursive: true });

const browser = await chromium.launch({
  channel: 'chrome',
  args: ['--force-device-scale-factor=1', '--hide-scrollbars', '--disable-lcd-text'],
});
const tVideo0 = Date.now();          // 视频从 context 创建（首个页面）开始计时
const ctx = await browser.newContext({
  viewport: { width: W, height: H },
  deviceScaleFactor: 1,
  recordVideo: { dir: join(HERE, 'raw'), size: { width: W, height: H } },
});

/* ------------------------------------------------------------------
 * 页面内动作表。字符串形式的动作名 → 真实函数。
 * 单个调用走「解析参数」路径；含分号的复合语句（如 reset(); run(...)）
 * 走 eval 路径，此时动作名会作为函数参数注入。
 * ------------------------------------------------------------------ */
const ACTIONS_SRC = `(code => {
  const { runOp, getOp, state, player } = window.__PF__;
  const R = window.__REC__;

  const autoCfg = (op, over) => {
    const c = {};
    for (const p of op.params || []) {
      if (p.type === 'column') {
        const pool = state.df.columns.filter((x) => (p.filter === 'number' ? state.df.dtypes[x] === 'number' : true));
        c[p.key] = (over && over[p.key]) || pool[0];
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
    pauseAt: (what) => {
      player.pause();
      const i = what === 'lock' ? R.lockIdx() : R.deleteEndIdx();
      if (i >= 0) player.seek(i);
    },
    seekAt: (what) => {
      player.pause();
      const i = what === 'reset' ? R.resetIdx() : R.finalIdx();
      if (i >= 0) player.seek(i);
    },
    run: (id, cfg, sp, seekTo) => {
      const op = getOp(id);
      runOp(op, cfg || autoCfg(op, id === 'drop_extremes' ? { col: '数学' } : null));
      player.pause();
      if (typeof seekTo === 'number') { player.seek(seekTo); player.setSpeed(sp || 1); }
      else { player.setSpeed(sp || 1); player.play(); }
    },
    reset: () => document.getElementById('btnReset').click(),
    openImport: () => document.getElementById('dsChip').click(),
    loadDataset: (id) => R.loadDataset(id),
    openGroup: (n) => R.openGroup(n),
    buildPipeline: () => {
      document.getElementById('btnReset').click();
      for (const id of ['drop_duplicates', 'drop_extremes']) {
        const op = getOp(id);
        runOp(op, autoCfg(op, id === 'drop_extremes' ? { col: '数学' } : null));
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

/* 注入录制辅助函数（不修改网站源码） */
const HELPERS = `
window.__REC__ = {
  hover(fx, fy) {
    const x = Math.round(fx * innerWidth), y = Math.round(fy * innerHeight);
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: x, clientY: y, bubbles: true }));
    const el = document.elementFromPoint(x, y);
    if (el) {
      for (const type of ['pointerover', 'mouseover', 'pointerenter', 'mouseenter', 'mousemove']) {
        el.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, bubbles: true }));
      }
    }
  },
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
  deleteIdx() { return this.frameIndex((f) => f.stage?.phase === 'delete'); },
  deleteEndIdx() {
    const f = window.__PF__.player.frames;
    let last = -1;
    f.forEach((x, i) => { if (x.stage?.phase === 'delete') last = i; });
    return last;
  },
  resetIdx() { return this.frameIndex((f) => f.stage?.phase === 'reset'); },
  finalIdx() { return window.__PF__.player.frames.length - 1; },
  loadDataset(id) {
    // 与「数据集」抽屉里的按钮一一对应
    const order = ['student', 'orders', 'weather'];
    const btns = [...document.querySelectorAll('.ds-option')];
    const i = order.indexOf(id);
    if (btns[i]) btns[i].click();
  },
  endCard() {
    const d = document.createElement('div');
    d.id = '__endcard__';
    d.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:9999', 'display:grid', 'place-items:center',
      'background:radial-gradient(60% 60% at 50% 45%, rgba(12,18,38,.96), rgba(3,5,12,.99))',
      'font-family:-apple-system,"Segoe UI","Microsoft YaHei",sans-serif',
      'opacity:0', 'transition:opacity .8s ease',
    ].join(';');
    d.innerHTML = \`
      <div style="text-align:center">
        <div style="width:78px;height:78px;margin:0 auto 26px;border-radius:24px;
          background:linear-gradient(140deg,#35e6dd,#a98bff 55%,#ff6b8a);
          display:grid;place-items:center;box-shadow:0 26px 70px -20px rgba(53,230,221,.85)">
          <svg viewBox="0 0 24 24" width="38" height="38" fill="none" stroke="#05121a"
               stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
            <path d="M7 19V6h5a4 4 0 010 8H7"/></svg>
        </div>
        <div style="font-size:38px;font-weight:700;color:#eef2ff;letter-spacing:-.5px">熊猫数据流 · PandaFlow</div>
        <div style="font-size:16px;color:#a9b5da;margin-top:14px;line-height:1.9">
          可视化数据分析全过程演示平台<br>
          从零实现的 pandas 语义 DataFrame · 26 个可回放操作 · 手写 SVG 图表
        </div>
        <div style="margin-top:30px;display:inline-flex;gap:12px;align-items:center;
          padding:12px 26px;border-radius:999px;border:1px solid rgba(53,230,221,.45);
          background:rgba(53,230,221,.1);color:#35e6dd;font-family:monospace;font-size:17px">
          wangling1206.github.io/pandaflow
        </div>
        <div style="font-size:14px;color:#6d7aa2;margin-top:26px">谢谢观看</div>
      </div>\`;
    document.body.appendChild(d);
    requestAnimationFrame(() => { d.style.opacity = '1'; });
  },
};
`;

const page = await ctx.newPage();
await page.goto(URL_, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => !!window.__PF__, null, { timeout: 30000 });
await page.addInitScript(HELPERS);           // 供后续导航使用（这里只加载一次）
await page.evaluate(HELPERS);
await page.waitForTimeout(600);

console.log(`准备完成。旁白总长 ${TOTAL.toFixed(1)}s = ${Math.floor(TOTAL / 60)}:${String(Math.round(TOTAL % 60)).padStart(2, '0')}`);

const t0 = Date.now();
const OFFSET = (t0 - tVideo0) / 1000;        // 视频起点比时间轴早多少秒

for (const ev of TL) {
  const wait = ev.t * 1000 - (Date.now() - t0);
  if (wait > 0) await page.waitForTimeout(wait);
  try {
    if (ev.kind === 'mouse') {
      await page.mouse.move(Math.round(ev.fx * W), Math.round(ev.fy * H), { steps: 14 });
      continue;
    }
    await page.evaluate(ACTIONS_SRC, ev.code);
  } catch (e) {
    console.error('action failed:', ev.code, '|', e.message);
  }
}

await page.waitForTimeout(1600);
await ctx.close();
await browser.close();

const webm = readdirSync(join(HERE, 'raw')).filter((f) => f.endsWith('.webm'));
console.log('录制的原始视频:', webm.join(', '));
writeFileSync(join(HERE, 'raw', 'offset.json'), JSON.stringify({ OFFSET, TOTAL }, null, 2));
console.log(`视频起点比时间轴早 ${OFFSET.toFixed(2)}s（需要在音频前面补这么多静音）`);
