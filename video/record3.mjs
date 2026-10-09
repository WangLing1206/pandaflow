/* ------------------------------------------------------------------
 * record3.mjs — 分段录制演示视频
 *  ----------------------------------------------------------------
 *  实测：单次连续录制约 30–60s 稳定，超过 1–2 分钟后 Chrome 会停止
 *  更新 surface（无论 screencast 还是 captureScreenshot 都只拿到旧帧）。
 *  所以这里按「旁白段落」切分成若干 40–90 秒的小段，每段独立开一个
 *  浏览器录制，各自与对应的旁白片段合成，最后拼接成完整视频。
 * ------------------------------------------------------------------ */

import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const require_ = createRequire(join(HERE, '..', 'tools', 'noop.js'));
const { chromium } = require_('playwright');

const URL_ = process.env.URL || 'http://127.0.0.1:8777/index.html';
const W = 1600, H = 900, FPS = 6, GAP = 0.45;
const FFMPEG = process.env.FFMPEG ||
  'C:/Users/wang1/AppData/Roaming/Python/Python313/site-packages/imageio_ffmpeg/binaries/ffmpeg-win-x86_64-v7.1.exe';
const OUT = join(HERE, '..', 'deliverables');
const WORK = join(HERE, 'parts');

/* ---------------------- 旁白 ---------------------- */
const manifest = JSON.parse(readFileSync(join(HERE, 'audio', 'manifest.json'), 'utf8').replace(/^\uFEFF/, ''));
const durOf = (f) => {
  const r = spawnSync(FFMPEG, ['-i', f, '-f', 'null', '-'], { encoding: 'utf8' });
  const m = [...String(r.stderr || '').matchAll(/time=(\d+):(\d+):([\d.]+)/g)].pop();
  return m ? (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]) : 0;
};
const dur = {};
for (const m of manifest) dur[m.id] = durOf(m.file);
const segStart = {};
let cur = 0;
for (const m of manifest) { segStart[m.id] = cur; cur += dur[m.id] + GAP; }
const TOTAL = cur - GAP;

/* 分段：每段包含若干旁白段落，时长控制在 ~90s 以内 */
const CHUNKS = [['s1', 's2', 's3'], ['s4'], ['s5'], ['s6', 's7'], ['s8']];
for (const c of CHUNKS) {
  const len = c.reduce((a, id) => a + dur[id] + GAP, 0) - GAP;
  if (len > 95) console.warn(`chunk ${c.join('+')} is ${len.toFixed(0)}s — may be unstable`);
}

/* ---------------------- 时间轴 ---------------------- */
const TL = [];
const at = (seg, t, code) => TL.push({ t: segStart[seg] + t, code, kind: 'page', seg });
const mouse = (seg, t, fx, fy) => TL.push({ t: segStart[seg] + t, fx, fy, kind: 'mouse', seg });

at('s1', 3.0, `noop()`);
mouse('s1', 12, 0.07, 0.30); mouse('s1', 18, 0.36, 0.28);
mouse('s1', 23, 0.50, 0.65); mouse('s1', 27, 0.88, 0.40);

at('s2', 0.8, `openGroup('清洗')`); at('s2', 4.0, `openGroup('合并与重塑')`);
at('s2', 8.0, `view('table')`);
mouse('s2', 10.5, 0.22, 0.45); mouse('s2', 15.0, 0.42, 0.24);
at('s2', 20.0, `view('stats')`); mouse('s2', 22.5, 0.50, 0.62);
at('s2', 26.5, `view('missing')`); mouse('s2', 29.5, 0.88, 0.42);

at('s3', 1.0, `switchLang()`); at('s3', 13.0, `switchTheme()`);
at('s3', 22.0, `switchLang()`); at('s3', 26.0, `switchTheme()`);

at('s4', 0.4, `view('table'); run('drop_extremes', {col:0, mode:'both'}, 1, 0)`);
at('s4', 10.0, `seek(1)`); at('s4', 17.5, `playAt(2, 0.95)`);
at('s4', 38.0, `pauseAt('lock')`); at('s4', 44.0, `playAt('delete', 1.05)`);
at('s4', 51.5, `pauseAt('deleteEnd')`); at('s4', 55.5, `seekAt('reset')`);
at('s4', 58.5, `seekAt('final')`);

at('s5', 0.4, `view('charts', 'violin')`); at('s5', 6.0, `view('charts', 'box')`);
at('s5', 11.0, `view('charts', 'hist')`); at('s5', 16.0, `view('charts', 'strip')`);
at('s5', 21.0, `view('charts', 'density')`); at('s5', 26.0, `view('charts', 'ecdf')`);
at('s5', 31.0, `view('charts', 'qq')`); at('s5', 35.0, `view('charts', 'scatter')`);

at('s6', 0.4, `reset(); view('table'); run('drop_duplicates', null, 2.4)`);
at('s6', 13.0, `reset(); run('dropna', null, 2.6)`);
at('s6', 23.0, `reset(); run('merge', null, 1.6)`);
at('s6', 31.0, `reset(); run('pivot_table', null, 1.8)`);

at('s7', 0.4, `reset(); run('rolling', null, 2.0)`);
at('s7', 7.0, `reset(); run('diff', null, 2.2)`);
at('s7', 13.0, `reset(); run('cut', null, 2.2)`);
at('s7', 19.0, `reset(); run('groupby', null, 2.0)`);
at('s7', 25.0, `reset(); run('agg', null, 2.4)`);
at('s7', 30.0, `pause()`);

at('s8', 0.4, `reset(); openImport()`);
mouse('s8', 3.5, 0.88, 0.38); mouse('s8', 7.0, 0.88, 0.62);
at('s8', 11.0, `loadDataset('orders')`); at('s8', 14.0, `loadDataset('weather')`);
at('s8', 17.0, `loadDataset('student')`); at('s8', 19.5, `buildPipeline()`);
at('s8', 22.0, `run('export', null, 1.4)`); at('s8', 29.5, `seekAt('final')`);
at('s8', 32.0, `endCard()`);

/* ---------------------- 注入脚本 ---------------------- */
const INJECT = readFileSync(join(HERE, 'inject.js'), 'utf8');
const ACTIONS_SRC = readFileSync(join(HERE, '_actions.js'), 'utf8');
const ANIM_CSS = readFileSync(join(HERE, '_css.txt'), 'utf8');

/* ---------------------- 逐段录制 ---------------------- */
rmSync(WORK, { recursive: true, force: true });
mkdirSync(WORK, { recursive: true });
mkdirSync(OUT, { recursive: true });

const partFiles = [];

for (let ci = 0; ci < CHUNKS.length; ci++) {
  const segs = CHUNKS[ci];
  const tStart = segStart[segs[0]];
  const tEnd = segStart[segs[segs.length - 1]] + dur[segs[segs.length - 1]];
  const len = tEnd - tStart;
  const events = TL.filter((e) => e.t >= tStart && e.t < tEnd);

  console.log(`\n[${ci + 1}/${CHUNKS.length}] ${segs.join('+')}  ${len.toFixed(1)}s  (${events.length} actions)`);

  const frames = join(WORK, `f${ci}`);
  mkdirSync(frames, { recursive: true });

  const browser = await chromium.launch({
    channel: 'chrome',
    args: ['--force-device-scale-factor=1', '--hide-scrollbars', '--disable-lcd-text',
      '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
  });
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await page.goto(URL_, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => !!window.__PF__, null, { timeout: 30000 });
  await page.evaluate('(() => {' + INJECT + '})()');
  await page.addStyleTag({ content: ANIM_CSS });
  await page.evaluate(() => { const d = document.createElement('div'); d.id = '__rec_anim__'; document.body.appendChild(d); });
  // 每一段都是全新页面，启动卡必须在这一段开始时先关掉；
  // 只有第 1 段的动作表里有这个动作，其余段会一直盖着启动卡（这就是之前「卡在加载界面」的真凶）
  await page.evaluate(() => { const b = document.getElementById('bootStart'); if (b) b.click(); });
  await page.waitForTimeout(900);

  let capturing = true, n = 0;
  const shots = [];
  const t0 = Date.now();
  const interval = 1000 / 7;
  const cap = (async () => {
    let next = t0;
    while (capturing) {
      const w = next - Date.now();
      if (w > 0) await page.waitForTimeout(w);
      next += interval;
      const t = (Date.now() - t0) / 1000;
      try {
        const { data } = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 82, fromSurface: true });
        const file = join(frames, `f${String(n++).padStart(5, '0')}.jpg`);
        writeFileSync(file, Buffer.from(data, 'base64'));
        shots.push({ t, file });
      } catch { if (!capturing) break; }
    }
  })();

  for (const ev of events) {
    const w = (ev.t - tStart) * 1000 - (Date.now() - t0);
    if (w > 0) await page.waitForTimeout(w);
    try {
      if (ev.kind === 'mouse') await page.mouse.move(Math.round(ev.fx * W), Math.round(ev.fy * H), { steps: 10 });
      else await page.evaluate(ACTIONS_SRC, ev.code);
    } catch (e) { console.error('  action failed:', ev.code, '|', e.message); }
  }
  // 必须让录制覆盖整段时长，否则旁白会被 -shortest 截断
  const elapsed = (Date.now() - t0) / 1000;
  const remain = Math.max(0, (len - elapsed + 0.8) * 1000);
  if (remain > 0) await page.waitForTimeout(remain);
  const videoLen = (Date.now() - t0) / 1000;
  capturing = false;
  await cap;
  await ctx.close();
  await browser.close();
  console.log('  captured ' + shots.length + ' frames over ' + videoLen.toFixed(1) + 's');

  // 偶发：CDP 会话中断导致只抓到个位数帧 —— 直接重录这一段
  if (shots.length < 20) {
    console.error('  too few frames, retrying this chunk');
    await ctx.close(); await browser.close();
    ci--; continue;
  }

  /* 重采样成固定帧率 */
  const N = Math.max(1, Math.round(videoLen * FPS));
  const list = join(frames, 'list.txt');
  const lines = [];
  let si = 0;
  for (let i = 0; i < N; i++) {
    const target = i / FPS;
    while (si + 1 < shots.length && shots[si + 1].t <= target) si++;
    lines.push(`file '${shots[si].file.replace(/\\/g, '/')}'`, `duration ${(1 / FPS).toFixed(6)}`);
  }
  lines.push(`file '${shots[shots.length - 1].file.replace(/\\/g, '/')}'`);
  writeFileSync(list, lines.join('\n') + '\n', 'utf8');
  const silent = join(frames, 'v.mp4');
  const rv = spawnSync(FFMPEG, ['-y', '-f', 'concat', '-safe', '0', '-i', list,
    '-vf', `fps=${FPS},format=yuv420p`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', silent], { encoding: 'utf8' });
  if (rv.status !== 0) { console.error(String(rv.stderr).slice(-800)); throw new Error('assembly failed'); }

  /* 该段的音频：前置静音 + 段落 + 段间留白 */
  const lead = join(frames, 'lead.wav');
  spawnSync(FFMPEG, ['-y', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono',
    '-t', videoLen.toFixed(3), '-c:a', 'pcm_s16le', lead], { encoding: 'utf8' });
  const gapF = join(frames, 'gap.wav');
  spawnSync(FFMPEG, ['-y', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono',
    '-t', GAP.toFixed(3), '-c:a', 'pcm_s16le', gapF], { encoding: 'utf8' });
  const norm = [];
  for (const id of segs) {
    const m = manifest.find((x) => x.id === id);
    const d = join(frames, `n_${id}.wav`);
    spawnSync(FFMPEG, ['-y', '-i', m.file, '-ar', '44100', '-ac', '1', '-c:a', 'pcm_s16le', d], { encoding: 'utf8' });
    norm.push(d);
  }
  const parts = [lead];
  norm.forEach((p, i) => { parts.push(p); if (i < norm.length - 1) parts.push(gapF); });
  const aIn = [];
  parts.forEach((p) => aIn.push('-i', p));
  const filt = parts.map((_, i) => `[${i}:a]`).join('') + `concat=n=${parts.length}:v=0:a=1[o]`;
  const audio = join(frames, 'a.wav');
  const ra = spawnSync(FFMPEG, ['-y', ...aIn, '-filter_complex', filt, '-map', '[o]',
    '-ar', '44100', '-ac', '1', '-c:a', 'pcm_s16le', audio], { encoding: 'utf8' });
  if (ra.status !== 0) { console.error(String(ra.stderr).slice(-600)); throw new Error('audio failed'); }

  /* 本段 mp4（暂不加字幕，最后统一烧） */
  const part = join(WORK, `p${ci}.mp4`);
  const rp = spawnSync(FFMPEG, ['-y', '-i', silent, '-i', audio,
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '22', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '160k', '-ar', '44100', '-shortest', part], { encoding: 'utf8' });
  if (rp.status !== 0) { console.error(String(rp.stderr).slice(-800)); throw new Error('mux failed'); }
  partFiles.push(part);
  console.log(`  → ${part}`);
}

/* ---------------------- 拼接 + 烧字幕 ---------------------- */
const cl = join(WORK, 'concat.txt');
writeFileSync(cl, partFiles.map((p) => `file '${p.replace(/\\/g, '/')}'`).join('\n') + '\n', 'utf8');

const final = join(OUT, 'PandaFlow-演示视频.mp4');
const srt = join(HERE, 'narration.srt');
const style = 'FontName=Microsoft YaHei,FontSize=20,PrimaryColour=&H00FFFFFF,OutlineColour=&H64000000,'
  + 'BorderStyle=3,Outline=1,Shadow=0,BackColour=&HA0000000,MarginV=26,Alignment=2';
const rf = spawnSync(FFMPEG, ['-y', '-f', 'concat', '-safe', '0', '-i', cl,
  '-vf', `subtitles=narration.srt:force_style='${style}'`,
  '-c:v', 'libx264', '-preset', 'medium', '-crf', '24', '-pix_fmt', 'yuv420p',
  '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', final],
  { encoding: 'utf8', cwd: HERE });
if (rf.status !== 0) { console.error(String(rf.stderr).slice(-1500)); throw new Error('final concat failed'); }
console.log(`\n完成: ${final}  ${durOf(final).toFixed(1)}s`);
