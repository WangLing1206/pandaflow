/* 针对线上部署地址的验证：加载、跑全部操作、截图 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const URL = process.env.URL || 'https://wangling1206.github.io/pandaflow/index.html';
mkdirSync('live', { recursive: true });

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1680, height: 1000 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(`[error] ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
page.on('response', (r) => { if (r.status() >= 400) errors.push(`[http ${r.status()}] ${r.url()}`); });

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(2500);
await page.screenshot({ path: 'live/00-boot.png' });
console.log('boot ok, __PF__ =', await page.evaluate(() => typeof window.__PF__));

await page.click('#bootStart');
await page.waitForTimeout(700);
await page.screenshot({ path: 'live/01-main.png' });

// 通过 UI 的方式跑一遍：直接用 __PF__ 暴露的 getOp/runOp（相对路径不再需要）
const res = await page.evaluate(() => {
  const { getOp, runOp, state } = window.__PF__;
  const ids = [...document.querySelectorAll('.op-item')].map((n) => n.dataset.op);
  const out = [];
  for (const id of ids) {
    const op = getOp(id);
    state.df = state.original;
    state.history = [];
    try {
      // autoParams 通过 op.params 的默认值构造
      const cfg = {};
      for (const p of op.params || []) {
        if (p.type === 'column') {
          const pool = state.df.columns.filter((c) => (p.filter === 'number' ? state.df.dtypes[c] === 'number' : true));
          cfg[p.key] = pool[0];
        } else if (p.type === 'columns') cfg[p.key] = [];
        else if (p.type === 'select') cfg[p.key] = p.default;
        else if (p.type === 'number') cfg[p.key] = p.default;
        else if (p.type === 'text') cfg[p.key] = p.default || '';
        else if (p.type === 'rename') cfg[p.key] = { [state.df.columns[0]]: 'col_a' };
      }
      runOp(op, cfg);
      out.push(`${id} OK frames=${state.history[state.history.length - 1]?.frames.length}`);
    } catch (e) { out.push(`${id} FAIL ${e.message}`); }
  }
  return out;
});
console.log(`\n线上 ${res.length} 个操作:`);
res.forEach((r) => console.log('  ', r));

// 线上跑一次旗舰演示并截图
await page.evaluate(() => document.getElementById('btnReset').click());
await page.waitForTimeout(300);
await page.evaluate(() => {
  const { getOp, runOp, player } = window.__PF__;
  runOp(getOp('drop_extremes'), { col: '数学', mode: 'both' });
  player.pause();
});
const total = await page.evaluate(() => window.__PF__.player.total);
for (const [i, name] of [[2, 'a-intro'], [6, 'b-scan'], [total - 8, 'c-lock'], [total - 6, 'd-delete'], [total - 1, 'e-result']]) {
  await page.evaluate((k) => window.__PF__.player.seek(k), i);
  await page.waitForTimeout(800);
  await page.screenshot({ path: `live/${name}.png` });
}

console.log('\n=== 线上控制台问题 ===');
console.log(errors.length ? [...new Set(errors)].slice(0, 20).join('\n') : '(无)');
await browser.close();
