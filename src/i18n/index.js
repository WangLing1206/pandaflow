/* ------------------------------------------------------------------
 * i18n/index.js — 中英双语基础设施
 *  ----------------------------------------------------------------
 *  设计要点：
 *  1) L(zh, en) 生成「双语字符串」对象 { zh, en }。所有面向用户的文本
 *     （解说、标题、阶段名、代码注释）都用它包起来，帧本身与语言无关，
 *     切换语言时只要重新 pick 一次即可。
 *  2) 帧是按语言生成的（因为代码片段里会用到列名），所以切换语言时
 *     重放整条管道 —— 操作是纯函数，重放结果完全一致。
 *  3) UI 文案走 t(key)，字典在 dict.js。
 * ------------------------------------------------------------------ */

export const LANGS = ['zh', 'en'];
export const LANG_LABEL = { zh: '中文', en: 'English' };

const STORE_KEY = 'pandaflow.lang';
let _lang = 'zh';

try {
  const saved = localStorage.getItem(STORE_KEY);
  if (saved && LANGS.includes(saved)) _lang = saved;
} catch { /* 隐私模式下忽略 */ }

const listeners = new Set();

export const getLang = () => _lang;
export const isZh = () => _lang === 'zh';

export function setLang(l) {
  if (!LANGS.includes(l) || l === _lang) return;
  _lang = l;
  try { localStorage.setItem(STORE_KEY, l); } catch { /* ignore */ }
  document.documentElement.setAttribute('lang', l === 'zh' ? 'zh-CN' : 'en');
  listeners.forEach((fn) => fn(l));
}

export function onLangChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

/* ------------------------------ 双语字符串 ------------------------------ */

/** 生成一个双语字符串 */
export const L = (zh, en) => ({ zh, en });

/** 取出当前（或指定）语言的那一份 */
export function pick(v, l = _lang) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  return v[l] ?? v.zh ?? v.en ?? '';
}

/** 语言相关选择：zhL(中, 英) 简写 */
export const lz = (zh, en) => (_lang === 'zh' ? zh : en);

/* ------------------------------ UI 字典 ------------------------------ */

import { DICT } from './dict.js';

/** 取 UI 文案；vars 用于 {name} 形式的插值 */
export function t(key, vars) {
  const entry = DICT[key];
  let s = entry ? pick(entry) : key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

/** 数字 / 日期等本地化格式 */
export function fmtNum(v, digits = 2) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return String(v);
  return v.toLocaleString(_lang === 'zh' ? 'zh-CN' : 'en-US', { maximumFractionDigits: digits });
}

export function initLang() {
  document.documentElement.setAttribute('lang', _lang === 'zh' ? 'zh-CN' : 'en');
}
