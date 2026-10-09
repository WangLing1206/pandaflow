/* ------------------------------------------------------------------
 * csv.js — CSV / TSV 解析与序列化
 * 支持：引号包裹、转义引号、自定义分隔符、表头检测、类型推断
 * ------------------------------------------------------------------ */

import { DataFrame, inferDtype } from './dataframe.js';
import { isNum } from './utils.js';

/** 逐字符解析，正确处理引号内的换行与逗号 */
function splitRecords(text, delim) {
  const rows = [];
  let row = [], field = '', inQuote = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuote) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuote = false;
      } else field += ch;
    } else if (ch === '"') {
      inQuote = true;
    } else if (ch === delim) {
      row.push(field); field = '';
    } else if (ch === '\n') {
      row.push(field); field = '';
      rows.push(row); row = [];
    } else if (ch === '\r') {
      // 忽略，等 \n
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/** 猜测分隔符 */
function guessDelim(text) {
  const sample = text.split('\n').slice(0, 6).join('\n');
  const cands = [',', '\t', ';', '|'];
  let best = ',', bestScore = -1;
  for (const d of cands) {
    const rows = splitRecords(sample, d);
    if (!rows.length) continue;
    const widths = rows.map((r) => r.length);
    const avg = widths.reduce((a, b) => a + b, 0) / widths.length;
    const consistent = widths.every((w) => w === widths[0]) ? 1.6 : 1;
    const score = avg * consistent;
    if (score > bestScore) { bestScore = score; best = d; }
  }
  return best;
}

/** 把字符串转换为合适的 JS 值（对齐 pandas 的 read_csv 类型推断） */
function coerce(s) {
  const t = s.trim();
  if (t === '' || t === 'NA' || t === 'NaN' || t === 'null' || t === 'NULL' || t === 'None' || t === '-') return null;
  if (t === 'True' || t === 'true') return true;
  if (t === 'False' || t === 'false') return false;
  if (isNum(t)) {
    const n = Number(t);
    // 保留前导 0 的字符串（如学号 "007"）不转数值
    if (/^-?0\d/.test(t)) return t;
    return n;
  }
  return s;
}

/**
 * 解析 CSV 文本为 DataFrame
 * @returns {{ df: DataFrame, warnings: string[] }}
 */
export function parseCSV(text, opts = {}) {
  const warnings = [];
  let t = text.replace(/^\uFEFF/, '');   // 去 BOM
  if (!t.trim()) throw new Error('文件内容为空');

  const delim = opts.delim || guessDelim(t);
  const rows = splitRecords(t, delim);
  while (rows.length && rows[rows.length - 1].every((c) => c.trim() === '')) rows.pop();
  if (rows.length < 2) throw new Error('至少需要一行表头与一行数据');

  const header = rows[0].map((h, i) => {
    const name = h.trim() || `Unnamed: ${i}`;
    return name;
  });
  // 重名列去重（pandas 会加 .1 后缀）
  const seen = new Map();
  const columns = header.map((h) => {
    if (!seen.has(h)) { seen.set(h, 1); return h; }
    const n = seen.get(h); seen.set(h, n + 1);
    return `${h}.${n}`;
  });

  const body = rows.slice(1);
  const ragged = body.filter((r) => r.length !== columns.length).length;
  if (ragged) warnings.push(`${ragged} 行的字段数与表头不一致，已自动补齐 / 截断`);

  const data = body.map((r) => {
    const out = new Array(columns.length).fill(null);
    for (let i = 0; i < columns.length; i++) out[i] = i < r.length ? coerce(r[i]) : null;
    return out;
  });

  const dtypes = {};
  for (let c = 0; c < columns.length; c++) {
    dtypes[columns[c]] = inferDtype(data.map((r) => r[c]));
  }

  const df = new DataFrame(columns, data, {
    dtypes,
    name: opts.name || 'df',
    source: opts.source || '用户导入',
  });
  return { df, warnings, delim };
}

/** 从 File / Blob 读取 */
export function readFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const isJSON = /\.json$/i.test(file.name);
        if (isJSON) {
          resolve(parseJSON(reader.result, { name: file.name }));
        } else {
          const r = parseCSV(String(reader.result), { name: file.name, source: file.name });
          resolve(r);
        }
      } catch (e) { reject(e); }
    };
    reader.onerror = () => reject(new Error('文件读取失败'));
    reader.readAsText(file, 'utf-8');
  });
}

/** 支持 JSON 数组（记录导向）导入 */
export function parseJSON(text, opts = {}) {
  const obj = JSON.parse(text);
  const arr = Array.isArray(obj) ? obj : (obj.data || obj.rows || null);
  if (!Array.isArray(arr) || !arr.length) throw new Error('JSON 需要是对象数组');
  const columns = [...new Set(arr.flatMap((o) => Object.keys(o)))];
  const data = arr.map((o) => columns.map((c) => {
    const v = o[c];
    if (v === undefined || v === null) return null;
    if (typeof v === 'number' || typeof v === 'boolean') return v;
    return coerce(String(v));
  }));
  const dtypes = {};
  for (let c = 0; c < columns.length; c++) dtypes[columns[c]] = inferDtype(data.map((r) => r[c]));
  return { df: new DataFrame(columns, data, { dtypes, name: opts.name || 'df', source: opts.source || 'JSON' }), warnings: [] };
}
