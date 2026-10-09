import { chromium } from 'playwright';
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1680, height: 1000 } });
await page.goto('http://127.0.0.1:8777/index.html', { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);
await page.click('#bootStart');
await page.waitForTimeout(500);
await page.evaluate(() => window.__PF__.runOp(window.__PF__.getOp('drop_extremes'), { col: '数学', mode: 'both' }));
await page.waitForTimeout(200);
await page.evaluate(() => window.__PF__.player.pause());
await page.evaluate(() => window.__PF__.player.seek(8));
await page.waitForTimeout(800);

const info = await page.evaluate(() => {
  const out = {};
  const strip = document.querySelector('.strip');
  out.stripBox = strip ? { w: strip.clientWidth, h: strip.clientHeight } : null;
  const pts = [...document.querySelectorAll('.strip-pt')].slice(0, 3);
  out.points = pts.map((n) => {
    const cs = getComputedStyle(n);
    const r = n.getBoundingClientRect();
    return { cls: n.className, left: cs.left, w: cs.width, h: cs.height, rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)], transform: cs.transform, borderRadius: cs.borderRadius };
  });
  const tags = [...document.querySelectorAll('.strip-tag')];
  out.tags = tags.map((n) => { const r = n.getBoundingClientRect(); return { cls: n.className, rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)], text: n.textContent }; });
  const canvas = document.querySelector('.stage-canvas');
  out.canvas = canvas ? { h: canvas.clientHeight, scrollH: canvas.scrollHeight } : null;
  const body = document.querySelector('.stage-body');
  out.stageBody = body ? { h: body.clientHeight, scrollH: body.scrollHeight } : null;
  out.stagePanel = document.querySelector('.stage-panel')?.clientHeight;
  out.tablePanel = document.querySelector('.table-panel')?.clientHeight;
  out.rows = document.querySelectorAll('.df-row').length;
  return out;
});
console.log(JSON.stringify(info, null, 2));
await browser.close();
