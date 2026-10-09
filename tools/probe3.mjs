import { chromium } from 'playwright';
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1680, height: 1000 } });
await page.goto('http://127.0.0.1:8777/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!window.__PF__);
await page.waitForTimeout(1500);
await page.click('#bootStart');
await page.waitForTimeout(500);
const info = await page.evaluate(() => {
  const { getOp, state } = window.__PF__;
  const op = getOp('groupby');
  const cfg = { by: '班级', target: '数学', fn: 'mean' };
  const out = op.run(state.df, cfg);
  const f = out.frames;
  const bad = [];
  f.forEach((fr, i) => {
    try {
      // 模拟 main.js 的 localizeStage
      const seen = new Set();
      const walk = (p, d) => {
        if (!p || typeof p !== 'object' || d > 6) return;
        if (seen.has(p)) return; seen.add(p);
        for (const [k, v] of Object.entries(p)) {
          if (v && typeof v === 'object' && !Array.isArray(v) && v.zh !== undefined) return;
          if (v && typeof v === 'object') walk(v, d + 1);
        }
      };
      walk(fr.stage, 0);
    } catch (e) { bad.push([i, String(e.message)]); }
  });
  // 找 stage 里的非节点值
  const f0 = f[0].stage;
  return {
    frames: f.length,
    stageKeys: Object.keys(f0),
    bucket0: f0.buckets ? { keys: Object.keys(f0.buckets[0]), items0: f0.buckets[0].items[0] } : null,
    bad,
  };
});
console.log(JSON.stringify(info, null, 2));
await browser.close();
