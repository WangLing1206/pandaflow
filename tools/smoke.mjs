/* 冒烟测试：每个操作都在「干净数据集」上单独跑一遍，然后跑一次链式管道 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const URL = process.env.URL || 'http://127.0.0.1:8777/index.html';
const OUT = 'shots';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1680, height: 1000 } });

const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(`[error] ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(2300);
await page.screenshot({ path: `${OUT}/00-boot.png` });
await page.click('#bootStart');
await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT}/01-main.png` });

const ids = await page.evaluate(() => [...document.querySelectorAll('.op-item')].map((n) => n.dataset.op));
console.log(`发现 ${ids.length} 个操作\n`);

const results = await page.evaluate(async (ids) => {
  const { getOp, runOp, state } = window.__PF__;
  const mod = await import('/src/core/ops/index.js');
  const out = [];
  for (const id of ids) {
    const op = getOp(id);
    state.df = state.original;
    state.history = [];
    try {
      const cfg = mod.autoParams(op, state.df);
      runOp(op, cfg);
      const h = state.history[state.history.length - 1];
      out.push({ id, ok: true, frames: h?.frames.length, summary: h?.summary });
    } catch (e) {
      out.push({ id, ok: false, err: String((e && e.message) || e) });
    }
  }
  return out;
}, ids);

let bad = 0;
for (const r of results) {
  if (r.ok) console.log(`  OK  ${r.id.padEnd(18)} frames=${String(r.frames).padStart(3)}  ${r.summary || ''}`);
  else { bad++; console.log(`  XX  ${r.id.padEnd(18)} ${r.err}`); }
}
console.log(`\n${results.length - bad}/${results.length} 通过`);

/* 链式管道 */
await page.evaluate(() => document.getElementById('btnReset').click());
await page.waitForTimeout(400);
const chain = await page.evaluate(async () => {
  const { getOp, runOp, state } = window.__PF__;
  const mod = await import('/src/core/ops/index.js');
  const script = [
    { op: 'info' }, { op: 'drop_duplicates' },
    { op: 'drop_extremes', cfg: { col: '数学', mode: 'both' } },
    { op: 'fillna', cfg: { col: '英语', strategy: 'mean' } },
    { op: 'describe' }, { op: 'hist', cfg: { col: '数学' } },
    { op: 'groupby', cfg: { by: '班级', target: '数学', fn: 'mean' } },
    { op: 'export' },
  ];
  const log = [];
  for (const st of script) {
    const op = getOp(st.op);
    const cfg = st.cfg || mod.autoParams(op, state.df);
    try {
      runOp(op, cfg);
      log.push(`${op.label} -> ${state.df.nrow}x${state.df.ncol}`);
    } catch (e) { log.push(`FAIL ${op.label}: ${e.message}`); }
  }
  return log;
});
console.log('\n链式管道:');
chain.forEach((l) => console.log('  ', l));

/* 逐帧截取旗舰演示 */
await page.evaluate(() => document.getElementById('btnReset').click());
await page.waitForTimeout(500);
await page.evaluate(() => {
  const { getOp, runOp } = window.__PF__;
  runOp(getOp('drop_extremes'), { col: '数学', mode: 'both' });
});
await page.waitForTimeout(300);
await page.evaluate(() => window.__PF__.player.pause());
const total = await page.evaluate(() => window.__PF__.player.total);
console.log(`\ndrop_extremes 总帧数: ${total}`);
const picks = [0, 1, 2, 4, 8, 13, total - 7, total - 5, total - 3, total - 2, total - 1];
for (const i of picks) {
  if (i < 0 || i >= total) continue;
  await page.evaluate((k) => window.__PF__.player.seek(k), i);
  await page.waitForTimeout(780);
  await page.screenshot({ path: `${OUT}/ex-${String(i).padStart(2, '0')}.png` });
}

console.log('\n=== 控制台错误 ===');
const uniq = [...new Set(errors)];
console.log(uniq.length ? uniq.slice(0, 30).join('\n') : '(无)');

await browser.close();
