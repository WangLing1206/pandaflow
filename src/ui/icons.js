/* ------------------------------------------------------------------
 * ui/icons.js — 线性图标集（24×24 stroke）
 * ------------------------------------------------------------------ */

const P = {
  info: 'M12 16v-4M12 8h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  sigma: 'M18 4H6l6 8-6 8h12',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z M12 15a3 3 0 100-6 3 3 0 000 6z',
  'eye-off': 'M3 3l18 18M10.6 6.2A9.9 9.9 0 0112 6c6.5 0 10 6 10 6a17 17 0 01-3.2 3.9M6.2 6.9A17 17 0 002 12s3.5 6 10 6c1.4 0 2.6-.3 3.7-.7M9.9 9.9a3 3 0 004.2 4.2',
  target: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 17a5 5 0 100-10 5 5 0 000 10zM12 13a1 1 0 100-2 1 1 0 000 2z',
  copy: 'M8 8V6a2 2 0 012-2h8a2 2 0 012 2v8a2 2 0 01-2 2h-2M6 8h8a2 2 0 012 2v8a2 2 0 01-2 2H6a2 2 0 01-2-2v-8a2 2 0 012-2z',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 002 2h6a2 2 0 002-2l1-12M9 7V5a2 2 0 012-2h2a2 2 0 012 2v2',
  droplet: 'M12 3s6 6.3 6 10.4A6 6 0 016 13.4C6 9.3 12 3 12 3z',
  scissors: 'M6 4l12 12M18 4L6 16M8 20a2.5 2.5 0 100-5 2.5 2.5 0 000 5zM16 20a2.5 2.5 0 100-5 2.5 2.5 0 000 5z',
  sort: 'M7 4v16M7 20l-3-3M7 4l3 3M17 20V4M17 4l3 3M17 20l-3-3',
  filter: 'M3 5h18l-7 8v6l-4 2v-8L3 5z',
  plus: 'M12 5v14M5 12h14',
  swap: 'M7 4l-4 4 4 4M3 8h14a4 4 0 014 4M17 20l4-4-4-4M21 16H7a4 4 0 01-4-4',
  tag: 'M20.6 13.4l-7.2 7.2a2 2 0 01-2.8 0l-7.2-7.2a2 2 0 01-.6-1.4V4a1 1 0 011-1h8a2 2 0 011.4.6l7.4 7.4a2 2 0 010 2.8zM7.5 7.5h.01',
  shuffle: 'M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5',
  trophy: 'M8 21h8M12 17v4M7 4h10v5a5 5 0 01-10 0V4zM7 6H4v2a3 3 0 003 3M17 6h3v2a3 3 0 01-3 3',
  minus: 'M5 12h14',
  calculator: 'M6 3h12a1 1 0 011 1v16a1 1 0 01-1 1H6a1 1 0 01-1-1V4a1 1 0 011-1zM9 7h6M8 11h.01M12 11h.01M16 11h.01M8 15h.01M12 15h.01M16 15h.01M8 19h8',
  'chart-bar': 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  'chart-hist': 'M4 20V9h3v11M10 20V4h3v16M16 20v-7h3v7M2 20h20',
  'chart-line': 'M3 3v18h18M7 15l4-5 3 3 5-7',
  scatter: 'M3 3v18h18M7 9h.01M11 15h.01M15 7h.01M18 12h.01M9 17h.01M14 11h.01',
  box: 'M3 3v18h18M8 6v12M8 9h9v6H8zM17 11h2',
  layers: 'M12 2l9 5-9 5-9-5 9-5zM3 12l9 5 9-5M3 17l9 5 9-5',
  download: 'M12 3v12M12 15l-4-4M12 15l4-4M4 19h16',
  upload: 'M12 21V9M12 9l-4 4M12 9l4 4M4 4h16',
  play: 'M7 4l12 8-12 8V4z',
  pause: 'M8 4v16M16 4v16',
  'skip-back': 'M18 4v16L6 12l12-8zM4 4v16',
  'skip-fwd': 'M6 4v16l12-8L6 4zM20 4v16',
  'step-back': 'M14 5l-7 7 7 7M19 5v14',
  'step-fwd': 'M10 5l7 7-7 7M5 5v14',
  chevron: 'M9 6l6 6-6 6',
  database: 'M12 8c4.4 0 8-1.1 8-2.5S16.4 3 12 3 4 4.1 4 5.5 7.6 8 12 8zM4 5.5v13C4 19.9 7.6 21 12 21s8-1.1 8-2.5v-13M4 12c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5',
  table: 'M3 5h18v14H3zM3 10h18M9 10v9M15 10v9',
  sparkles: 'M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15z',
  check: 'M20 6L9 17l-5-5',
  x: 'M18 6L6 18M6 6l12 12',
  alert: 'M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z',
  refresh: 'M21 12a9 9 0 11-3-6.7M21 4v5h-5',
  'arrow-right': 'M5 12h14M13 6l6 6-6 6',
  code: 'M16 18l6-6-6-6M8 6l-6 6 6 6',
  sliders: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6',
  file: 'M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zM14 2v6h6',
  wand: 'M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8L19 13M15 9h0M17.8 6.2L19 5M3 21l9-9M12.2 6.2L11 5',
  undo: 'M3 7v6h6M3 13a9 9 0 103-7.7L3 8',
  panelLeft: 'M3 5h18v14H3zM9 5v14',
  panelRight: 'M3 5h18v14H3zM15 5v14',
  maximize: 'M8 3H5a2 2 0 00-2 2v3M16 3h3a2 2 0 012 2v3M16 21h3a2 2 0 002-2v-3M8 21H5a2 2 0 01-2-2v-3',
  ruler: 'M3 15l12-12 6 6-12 12-6-6zM7 11l2 2M10 8l2 2M13 5l2 2',
};

/** 生成 SVG 图标节点 */
export function icon(name, size = 16, extraClass = '') {
  const d = P[name] || P.info;
  const ns = 'http://www.w3.org/2000/svg';
  const s = document.createElementNS(ns, 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('width', size);
  s.setAttribute('height', size);
  s.setAttribute('fill', 'none');
  s.setAttribute('stroke', 'currentColor');
  s.setAttribute('stroke-width', '1.8');
  s.setAttribute('stroke-linecap', 'round');
  s.setAttribute('stroke-linejoin', 'round');
  if (extraClass) s.setAttribute('class', extraClass);
  const p = document.createElementNS(ns, 'path');
  p.setAttribute('d', d);
  s.appendChild(p);
  return s;
}

export const ICON_NAMES = Object.keys(P);
