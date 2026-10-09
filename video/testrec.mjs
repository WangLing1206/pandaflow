import { readdirSync, rmSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const HERE = dirname(fileURLToPath(import.meta.url));
const require_ = createRequire(join(HERE, '..', 'tools', 'noop.js'));
const { chromium } = require_('playwright');
rmSync(join(HERE, 'test'), { recursive: true, force: true });
mkdirSync(join(HERE, 'test'), { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: false,
  args: ['--window-size=1600,990', '--window-position=0,0', '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
    '--disable-features=CalculateNativeWinOcclusion'] });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1,
  recordVideo: { dir: join(HERE, 'test'), size: { width: 1600, height: 900 } } });
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:8777/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!window.__PF__);
await page.waitForTimeout(1200);
await page.click('#bootStart');
await page.waitForTimeout(500);
await page.evaluate(() => { const { getOp, runOp, state, autoParams } = window.__PF__;
  runOp(getOp('drop_extremes'), { col: state.df.columns[4], mode: 'both' }); });
await page.waitForTimeout(6000);
await page.evaluate(() => { const v = window.__PF__.viewPanel; v.active = 'charts'; v.chartType = 'violin'; v.cfg = {}; v.refresh(); });
await page.waitForTimeout(4000);
await ctx.close(); await browser.close();
console.log('test video:', readdirSync(join(HERE, 'test')).join(','));
