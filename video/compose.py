# -*- coding: utf-8 -*-
"""
compose.py — 合成最终演示视频

1) 把 8 段旁白按时间轴拼起来（前置 OFFSET 静音 + 段间留白）
2) 按各段时长把旁白文本切成字幕，生成 SRT
3) ffmpeg 合成：webm 视频 + 拼接音频 + 烧入字幕 → mp4
"""
import io
import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
FFMPEG = os.environ.get(
    'FFMPEG',
    r'C:/Users/wang1/AppData/Roaming/Python/Python313/site-packages/imageio_ffmpeg/binaries/ffmpeg-win-x86_64-v7.1.exe')
GAP = 0.45
OUT_DIR = os.path.join(HERE, '..', 'deliverables')


def run(args, **kw):
    return subprocess.run([FFMPEG] + args, capture_output=True, text=True,
                          encoding='utf-8', errors='ignore', **kw)


def duration(path):
    r = run(['-i', path, '-f', 'null', '-'])
    times = re.findall(r'time=(\d+):(\d+):([\d.]+)', r.stderr or '')
    if not times:
        raise RuntimeError('cannot read duration: ' + path)
    h, m, s = times[-1]
    return int(h) * 3600 + int(m) * 60 + float(s)


def hhmmss(t, sep=','):
    h = int(t // 3600)
    m = int((t % 3600) // 60)
    s = t % 60
    return ('%02d:%02d:%06.3f' % (h, m, s)).replace('.', sep)


# ------------------------------------------------------------------ 1. 时长
manifest = json.load(io.open(os.path.join(HERE, 'audio', 'manifest.json'), encoding='utf-8-sig'))
segs = json.load(io.open(os.path.join(HERE, 'segments.json'), encoding='utf-8'))
text_of = {s['id']: s['text'] for s in segs}

durs = {}
for m in manifest:
    durs[m['id']] = duration(m['file'])

offset_info = json.load(io.open(os.path.join(HERE, 'raw', 'offset.json'), encoding='utf-8'))
LEAD = round(offset_info['OFFSET'], 3)

webm = [f for f in os.listdir(os.path.join(HERE, 'raw')) if f.endswith('.webm')]
if not webm:
    sys.exit('raw/*.webm 不存在，请先运行 record.mjs')
video = os.path.join(HERE, 'raw', webm[0])
v_dur = duration(video)

print('旁白各段时长:')
starts, cursor = {}, LEAD
for m in manifest:
    starts[m['id']] = cursor
    print('  %s  %6.2fs  起点 %7.2fs' % (m['id'], durs[m['id']], cursor))
    cursor += durs[m['id']] + GAP
audio_end = cursor - GAP
print('旁白总长 %.2fs，视频总长 %.2fs，前置静音 %.2fs' % (audio_end - LEAD, v_dur, LEAD))

# ------------------------------------------------------------------ 2. 拼接音频
work = os.path.join(HERE, 'build')
os.makedirs(work, exist_ok=True)


RATE = 44100


def make_silence(seconds, path):
    run(['-y', '-f', 'lavfi', '-i', 'anullsrc=r=%d:cl=mono' % RATE,
         '-t', '%.3f' % seconds, '-c:a', 'pcm_s16le', path])


def normalize(src, dst):
    """统一到 44.1kHz 单声道，否则 concat 解复用器会因格式不一致而截断"""
    r = run(['-y', '-i', src, '-ar', str(RATE), '-ac', '1',
             '-c:a', 'pcm_s16le', dst])
    if r.returncode != 0:
        raise RuntimeError('归一化失败 ' + src + '\n' + (r.stderr or '')[-800:])
    return dst


def wav_rate(path):
    import wave
    with wave.open(path) as w:
        return w.getframerate()


def ensure_silence(seconds, name):
    """时长或采样率任一不符就重新生成 —— 只比对时长会漏掉采样率变化"""
    path = os.path.join(work, name)
    ok = os.path.exists(path) and abs(duration(path) - seconds) < 0.01 and wav_rate(path) == RATE
    if not ok:
        make_silence(seconds, path)
    return path


lead = ensure_silence(LEAD, 'lead.wav')
gap = ensure_silence(GAP, 'gap.wav')
tail = ensure_silence(max(0.5, v_dur - audio_end + 1.5), 'tail.wav')

# 先统一采样率再拼接：SAPI 输出是 22050Hz，和静音段的 44100Hz 不一致
norm = []
for m in manifest:
    dst = os.path.join(work, 'n_' + m['id'] + '.wav')
    normalize(m['file'], dst)
    norm.append(dst)

parts = [lead]
for i, p_ in enumerate(norm):
    parts.append(p_)
    parts.append(gap if i < len(norm) - 1 else tail)

listfile = os.path.join(work, 'concat.txt')
with io.open(listfile, 'w', encoding='utf-8') as f:
    for p in parts:
        f.write("file '%s'\n" % p.replace('\\', '/'))

narration = os.path.join(work, 'narration.wav')
r = run(['-y', '-f', 'concat', '-safe', '0', '-i', listfile, '-c:a', 'pcm_s16le', narration])
if r.returncode != 0:
    sys.exit('拼接音频失败:\n' + (r.stderr or '')[-1500:])
print('拼接后的旁白: %.2fs' % duration(narration))

# ------------------------------------------------------------------ 3. 字幕
MAXLEN = 26


def split_cues(text, budget):
    """按标点切句，再按长度合并；时间按字符数比例分配"""
    parts = [p for p in re.split(r'(?<=[。；！？])', text) if p.strip()]
    cues, cur = [], ''
    for p in parts:
        if len(cur) + len(p) <= MAXLEN or not cur:
            cur += p
        else:
            cues.append(cur)
            cur = p
    if cur:
        cues.append(cur)
    total = sum(len(c) for c in cues) or 1
    out, t = [], 0.0
    for c in cues:
        d = budget * len(c) / total
        out.append((t, t + d, c))
        t += d
    return out


srt_lines = []
idx = 0
for m in manifest:
    base = starts[m['id']]
    for (a, b, txt) in split_cues(text_of[m['id']], durs[m['id']] - 0.25):
        idx += 1
        srt_lines.append('%d\n%s --> %s\n%s\n' % (
            idx, hhmmss(base + a), hhmmss(base + b), txt))

srt_path = os.path.join(work, 'narration.srt')
io.open(srt_path, 'w', encoding='utf-8').write('\n'.join(srt_lines))
print('生成字幕 %d 条' % idx)

# ------------------------------------------------------------------ 4. 合成
os.makedirs(OUT_DIR, exist_ok=True)
final = os.path.join(OUT_DIR, 'PandaFlow-演示视频.mp4')

# 字幕样式：底部居中、半透明底、字号按 1080p 调
style = ('FontName=Microsoft YaHei,FontSize=20,PrimaryColour=&H00FFFFFF,'
         'OutlineColour=&H64000000,BorderStyle=3,Outline=1,Shadow=0,'
         'BackColour=&HA0000000,MarginV=26,Alignment=2')

vf = "subtitles=narration.srt:force_style='%s'" % style

cmd = ['-y', '-i', os.path.abspath(video), '-i', narration,
       '-vf', vf,
       '-c:v', 'libx264', '-preset', 'medium', '-crf', '24',
       '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-level', '4.1',
       '-c:a', 'aac', '-b:a', '160k', '-ar', '44100',
       '-movflags', '+faststart', '-shortest', os.path.abspath(final)]

print('正在编码（可能需要一两分钟）…')
r = subprocess.run([FFMPEG] + cmd, capture_output=True, text=True,
                   encoding='utf-8', errors='ignore', cwd=work)
if r.returncode != 0:
    print((r.stderr or '')[-2500:])
    sys.exit('编码失败')

print('\n完成: %s  (%.1f MB, %.1fs)' % (
    os.path.abspath(final), os.path.getsize(final) / 1024 / 1024, duration(final)))
