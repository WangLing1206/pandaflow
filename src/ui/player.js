/* ------------------------------------------------------------------
 * player.js — 帧播放器
 *  ----------------------------------------------------------------
 *  因为每一帧都是完整快照，播放器只负责「什么时候切到下一帧」，
 *  所以拖动进度条、单步前后、变速都是天然支持的。
 * ------------------------------------------------------------------ */

import { clamp } from '../core/utils.js';

export class Player {
  constructor() {
    this.frames = [];
    this.index = -1;
    this.playing = false;
    this.speed = 1;
    this._timer = null;
    this._t0 = 0;
    this.onFrame = null;     // (frame, index, meta)
    this.onState = null;     // ('play'|'pause'|'end'|'seek')
    this.loop = false;
  }

  load(frames) {
    this.stop();
    this.frames = frames || [];
    this.index = -1;
    if (this.frames.length) this.seek(0, 'load');
    this.onState?.('load');
  }

  get current() { return this.frames[this.index] || null; }
  get total() { return this.frames.length; }
  get atEnd() { return this.index >= this.frames.length - 1; }
  get progress() { return this.frames.length <= 1 ? 1 : this.index / (this.frames.length - 1); }

  seek(i, reason = 'seek') {
    const n = clamp(Math.round(i), 0, Math.max(0, this.frames.length - 1));
    if (n === this.index) { this.onFrame?.(this.current, this.index, { reason }); return; }
    const dir = n > this.index ? 1 : -1;
    this.index = n;
    this.onFrame?.(this.current, this.index, { reason, dir });
    this.onState?.(reason);
  }

  next() {
    if (this.atEnd) { this.pause(); this.onState?.('end'); return false; }
    this.seek(this.index + 1, 'step');
    return true;
  }

  prev() {
    if (this.index <= 0) return false;
    this.seek(this.index - 1, 'step');
    return true;
  }

  play() {
    if (!this.frames.length) return;
    if (this.atEnd) this.seek(0, 'restart');
    this.playing = true;
    this.onState?.('play');
    this._schedule();
  }

  pause() {
    this.playing = false;
    clearTimeout(this._timer);
    this._timer = null;
    this.onState?.('pause');
  }

  stop() { this.playing = false; clearTimeout(this._timer); this._timer = null; }

  toggle() { this.playing ? this.pause() : this.play(); }

  setSpeed(s) {
    this.speed = s;
    if (this.playing) { clearTimeout(this._timer); this._schedule(); }
  }

  _schedule() {
    clearTimeout(this._timer);
    if (!this.playing) return;
    const f = this.current;
    const dur = Math.max(120, (f?.duration ?? 1000) / this.speed);
    this._timer = setTimeout(() => {
      if (!this.playing) return;
      if (this.atEnd) {
        if (this.loop) { this.seek(0, 'loop'); this._schedule(); }
        else { this.playing = false; this.onState?.('end'); }
        return;
      }
      this.index++;
      this.onFrame?.(this.current, this.index, { reason: 'tick', dir: 1 });
      this.onState?.('tick');
      this._schedule();
    }, dur);
  }
}
