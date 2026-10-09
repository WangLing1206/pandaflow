# -*- coding: utf-8 -*-
"""打包网站源代码（排除依赖、截图与构建产物）"""
import os
import zipfile

EXCLUDE_DIRS = {'.git', 'node_modules', 'shots', 'gallery', 'live',
                'deliverables', 'video', '__pycache__', 'dist', 'full', 'build'}
EXCLUDE_EXT = {'.zip', '.mp4', '.wav', '.pyc', '.webm', '.png', '.jpg'}

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'PandaFlow-源代码.zip')

count = 0
with zipfile.ZipFile(OUT, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = [d for d in dirnames if d not in EXCLUDE_DIRS]
        for fn in sorted(filenames):
            if os.path.splitext(fn)[1].lower() in EXCLUDE_EXT:
                continue
            full = os.path.join(dirpath, fn)
            rel = os.path.relpath(full, ROOT).replace(os.sep, '/')
            z.write(full, 'PandaFlow/' + rel)
            count += 1

size = os.path.getsize(OUT) / 1024
print('{}: {} 个文件, {:.1f} KB'.format(os.path.basename(OUT), count, size))
