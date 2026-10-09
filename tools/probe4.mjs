import { chromium } from 'playwright';
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1680, height: 1000 } });
await page.goto('http://127.0.0.1:8777/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!window.__PF__);
await page.waitForTimeout(1500);
await page.click('#bootStart');
await page.waitForTimeout(500);
const stack = await page.evaluate(() => {
  const { getOp, state, runOp } = window.__PF__;
  const op = getOp('groupby');
  try {
    runOp(op, { by: '班级', target: '数学', fn: 'mean' });
    return 'no throw';
  } catch (e) {
    return e.stack || String(e);
  }
});
console.log(stack);
await browser.close();
