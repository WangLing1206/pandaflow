import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const URL = process.env.URL || 'http://127.0.0.1:8777/index.html';
mkdirSync('shots', { recursive: true });
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1680, height: 1000 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(`[error] ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => !!window.__PF__, null, { timeout: 30000 });
await page.waitForTimeout(2000);
await page.screenshot({ path: 'shots/00-boot.png' });
await page.click('#bootStart');
await page.waitForTimeout(800);
await page.screenshot({ path: 'shots/01-main.png' });
const res = await page.evaluate(() => {
  const { getOp, runOp, state, autoParams } = window.__PF__;
  const ids = [...document.querySelectorAll('.op-item')].map((n) => n.dataset.op);
  const out = [];
  for (const id of ids) {
    const op = getOp(id);
    state.df = state.original; state.history = [];
    try {
      runOp(op, autoParams(op, state.df));
      const h = state.history[state.history.length - 1];
      out.push({ id, ok: true, f: h?.frames.length, s: h?.summary?.zh || '' });
    } catch (e) { out.push({ id, ok: false, e: String(e && e.message || e) }); }
  }
  return out;
});
let bad = 0;
for (const r of res) { if (r.ok) console.log(` OK  ${r.id.padEnd(18)} frames=${String(r.f).padStart(3)}  ${r.s}`); else { bad++; console.log(` XX  ${r.id.padEnd(18)} ${r.e}`); } }
console.log(`\n${res.length - bad}/${res.length} passed`);
console.log('\n=== console errors ===');
console.log([...new Set(errors)].slice(0, 25).join('\n') || '(none)');
await browser.close();
