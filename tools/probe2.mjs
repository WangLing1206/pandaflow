import { chromium } from 'playwright';
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1680, height: 1000 } });
await page.goto('http://127.0.0.1:8777/index.html', { waitUntil: 'networkidle' });
await page.waitForTimeout(1800);
await page.click('#bootStart');
await page.waitForTimeout(400);
await page.evaluate(() => window.__PF__.runOp(window.__PF__.getOp('drop_extremes'), { col: '数学', mode: 'both' }));
await page.waitForTimeout(200);
await page.evaluate(() => { window.__PF__.player.pause(); window.__PF__.player.seek(8); });
await page.waitForTimeout(1400);

const info = await page.evaluate(() => {
  const strip = document.querySelector('.strip');
  const sr = strip.getBoundingClientRect();
  const out = { stripRect: [Math.round(sr.x), Math.round(sr.y), Math.round(sr.width), Math.round(sr.height)], big: [], all: [] };
  // 找出 strip 内所有尺寸异常的元素
  for (const n of strip.querySelectorAll('*')) {
    const r = n.getBoundingClientRect();
    if (r.width > 40 || r.height > 40) {
      const cs = getComputedStyle(n);
      out.big.push({
        cls: n.className, tag: n.tagName, text: (n.textContent || '').slice(0, 20),
        rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
        w: cs.width, h: cs.height, transform: cs.transform, shadow: cs.boxShadow, bg: cs.background.slice(0, 90),
      });
    }
  }
  const counts = {};
  for (const n of strip.querySelectorAll('.strip-pt')) {
    counts[n.className] = (counts[n.className] || 0) + 1;
  }
  out.pointClasses = counts;
  const ch = strip.querySelector('.strip-pt.challenger');
  if (ch) {
    const cs = getComputedStyle(ch);
    out.challenger = { w: cs.width, h: cs.height, transform: cs.transform, shadow: cs.boxShadow, rect: (() => { const r = ch.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]; })() };
  }
  return out;
});
console.log(JSON.stringify(info, null, 2));
await browser.close();
