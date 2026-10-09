import { chromium } from 'playwright';
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1680, height: 1000 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await page.goto('https://wangling1206.github.io/pandaflow/index.html', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => !!window.__PF__, null, { timeout: 40000 });
await page.waitForTimeout(2000);
await page.click('#bootStart'); await page.waitForTimeout(600);
const r = await page.evaluate(() => {
  const { getOp, runOp, state, autoParams, viewPanel } = window.__PF__;
  const ids = [...document.querySelectorAll('.op-item')].map((n) => n.dataset.op);
  let ok = 0, fail = [];
  for (const id of ids) {
    const op = getOp(id); state.df = state.original; state.history = [];
    try { runOp(op, autoParams(op, state.df)); ok++; } catch (e) { fail.push(id + ': ' + e.message); }
  }
  viewPanel.active = 'charts'; viewPanel.chartType = 'violin'; viewPanel.cfg = {}; viewPanel.refresh();
  return { total: ids.length, ok, fail, cols: state.df.columns.length };
});
console.log(`线上: ${r.ok}/${r.total} 操作通过, 失败: ${r.fail.join(' | ') || '无'}`);
console.log('errors:', errs.length ? [...new Set(errs)].slice(0,5).join('\n') : '(none)');
await browser.close();
