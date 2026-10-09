/* 为每个操作抓取一张「最有代表性」的帧截图 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const OUT = 'gallery';
mkdirSync(OUT, { recursive: true });

const CASES = [
  ['info', null, 0.5],
  ['describe', null, 0.6],
  ['drop_duplicates', null, 0.45],
  ['dropna', null, 0.5],
  ['fillna', null, 0.6],
  ['clip', null, 0.75],
  ['sort_values', null, 0.55],
  ['query', null, 0.55],
  ['assign', null, 0.6],
  ['astype', null, 0.6],
  ['rename', null, 0.6],
  ['sample', null, 0.6],
  ['nlargest', null, 0.6],
  ['drop', null, 0.7],
  ['agg', null, 0.6],
  ['value_counts', null, 0.6],
  ['groupby', null, 0.62],
  ['hist', null, 0.6],
  ['bar', null, 0.6],
  ['line', null, 0.6],
  ['scatter', null, 0.95],
  ['box', null, 0.62],
  ['export', null, 0.9],
];

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1680, height: 1000 } });
await page.goto('http://127.0.0.1:8777/index.html', { waitUntil: 'networkidle' });
await page.waitForTimeout(1800);
await page.click('#bootStart');
await page.waitForTimeout(400);

for (const [id, cfg, frac] of CASES) {
  await page.evaluate(() => document.getElementById('btnReset').click());
  await page.waitForTimeout(160);
  const total = await page.evaluate(async ([id, cfg]) => {
    const { getOp, runOp } = window.__PF__;
    const mod = await import('/src/core/ops/index.js');
    const op = getOp(id);
    runOp(op, cfg || mod.autoParams(op, window.__PF__.state.df));
    window.__PF__.player.pause();
    return window.__PF__.player.total;
  }, [id, cfg]);
  const k = Math.min(total - 1, Math.max(0, Math.round((total - 1) * frac)));
  await page.evaluate((i) => window.__PF__.player.seek(i), k);
  await page.waitForTimeout(760);
  await page.screenshot({ path: `${OUT}/${id}.png` });
  console.log(`${id.padEnd(18)} frames=${total} shot@${k}`);
}
await browser.close();
