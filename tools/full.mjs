import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const OUT = 'full'; mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1680, height: 1000 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(`[error] ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
await page.goto('http://127.0.0.1:8777/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!window.__PF__);
await page.waitForTimeout(1800);
await page.click('#bootStart'); await page.waitForTimeout(700);

// 1. 各视图 + 各图表类型（中文）
const r1 = await page.evaluate(async () => {
  const { getOp, runOp, state, autoParams, viewPanel } = window.__PF__;
  runOp(getOp('hist'), autoParams(getOp('hist'), state.df));
  window.__PF__.player.pause(); window.__PF__.player.seek(window.__PF__.player.frames.length - 1);
  const out = [];
  for (const tab of ['table', 'charts', 'stats', 'missing', 'corr']) {
    viewPanel.active = tab; viewPanel.refresh();
    await new Promise((r) => setTimeout(r, 120));
    out.push(`tab:${tab} ok=${viewPanel.panes[tab].children.length > 0}`);
  }
  const types = [];
  viewPanel.active = 'charts';
  for (const ct of ['hist','box','violin','strip','density','ecdf','qq','line','area','scatter','bar','groupedBar','pie','heatmap']) {
    viewPanel.chartType = ct;
    viewPanel.cfg = {};
    try { viewPanel.refresh(); await new Promise((r) => setTimeout(r, 80)); types.push(`${ct}:ok`); }
    catch (e) { types.push(`${ct}:FAIL ${e.message}`); }
  }
  return { views: out, types };
});
console.log('视图:', r1.views.join('  '));
console.log('图表:', r1.types.join('  '));

// 2. 切换语言
await page.click('#btnLang'); await page.waitForTimeout(1200);
await page.screenshot({ path: `${OUT}/en-dark.png` });
const en = await page.evaluate(() => {
  const { state } = window.__PF__;
  return { cols: state.df.columns.slice(0, 5), rows: state.df.nrow, first: state.df._rows[0].cells.slice(0, 3) };
});
console.log('EN columns:', en.cols, 'rows', en.rows, 'row0', en.first);

// 3. 切换主题（英文浅色）
await page.click('#btnTheme'); await page.waitForTimeout(700);
await page.screenshot({ path: `${OUT}/en-light.png` });

// 4. 回到中文浅色 + 跑旗舰
await page.click('#btnLang'); await page.waitForTimeout(900);
const zh = await page.evaluate(() => window.__PF__.state.df.columns.slice(0, 4));
console.log('ZH columns:', zh);
await page.evaluate(() => {
  const { getOp, runOp, state, player } = window.__PF__;
  runOp(getOp('drop_extremes'), { col: state.df.columns.includes('数学') ? '数学' : state.df.columns[4], mode: 'both' });
  player.pause(); player.seek(10);
});
await page.waitForTimeout(900);
await page.screenshot({ path: `${OUT}/zh-light-flagship.png` });

// 5. 回到深色，看图表联动
await page.click('#btnTheme'); await page.waitForTimeout(600);
await page.evaluate(() => { const v = window.__PF__.viewPanel; v.active = 'charts'; v.chartType = 'violin'; v.cfg = {}; v.refresh(); });
await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT}/zh-dark-violin.png` });

console.log('\n=== errors ===');
console.log([...new Set(errors)].slice(0, 20).join('\n') || '(none)');
await browser.close();
