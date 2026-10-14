/* ==========================================================================
   DonetClassroom — frontend
   Runs in two modes:
     • server mode   — talks to the local Node backend (API key stays server-side)
     • standalone    — the single-file build; talks to providers directly
   ========================================================================== */
(() => {
'use strict';

const STANDALONE = Boolean(window.DONET_STANDALONE);
const IS_FILE = location.protocol === 'file:';
const MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const MOD = MAC ? '⌘' : 'Ctrl';

/* ─────────────────────────────────────────────────────────── embedded config */
/* For local testing only. Paste your API key here to auto-load on startup.  */
const EMBEDDED_CONFIG = {
  geminiKey: '', // paste your key from aistudio.google.com/apikey
  openrouterKey: '', // paste your key from openrouter.ai/keys
  ollamaHost: '',
};

/* ─────────────────────────────────────────────────────────── tiny helpers */

const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const $ = (sel, root = document) => root.querySelector(sel);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

function el(tag, attrs = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) {
    if (kid === null || kid === undefined || kid === false) continue;
    node.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return node;
}

function icon(name, cls = 'ico') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', cls);
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', '#i-' + name);
  svg.append(use);
  return svg;
}

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

function fmtTime(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function fmtDayGroup(ts) {
  const now = new Date(); const d = new Date(ts);
  const startOf = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(d)) / 86400000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return 'Previous 7 days';
  if (days < 30) return 'Previous 30 days';
  return d.toLocaleDateString([], { month: 'long', year: 'numeric' });
}

function fmtBytes(n) {
  if (!n) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0; let v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

function toast(message, kind = '') {
  const box = $('#toasts');
  const node = el('div', { class: 'toast ' + kind }, message);
  box.append(node);
  setTimeout(() => {
    node.style.transition = 'opacity .2s, transform .2s';
    node.style.opacity = '0'; node.style.transform = 'translateY(6px)';
    setTimeout(() => node.remove(), 220);
  }, kind === 'err' ? 5200 : 2800);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // clipboard API needs a secure context; fall back for file:// use
    const ta = el('textarea', { style: 'position:fixed;opacity:0' });
    ta.value = text; document.body.append(ta); ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
    return ok;
  }
}

function download(filename, content, type = 'application/json') {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: filename });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function confirmDialog(title, text, okLabel = 'Confirm') {
  return new Promise((resolve) => {
    const layer = $('#confirmModal');
    $('#confirmTitle').textContent = title;
    $('#confirmText').textContent = text;
    $('#confirmOk').textContent = okLabel;
    layer.hidden = false;
    const done = (v) => {
      layer.hidden = true;
      $('#confirmOk').onclick = null; $('#confirmCancel').onclick = null; layer.onclick = null;
      resolve(v);
    };
    $('#confirmOk').onclick = () => done(true);
    $('#confirmCancel').onclick = () => done(false);
    layer.onclick = (e) => { if (e.target === layer) done(false); };
    setTimeout(() => $('#confirmOk').focus(), 30);
  });
}

/* ───────────────────────────────────────────────── syntax highlighting */

const KEYWORDS = {
  javascript: 'await async break case catch class const continue debugger default delete do else export extends finally for from function get if import in instanceof let new of return set static super switch this throw try typeof var void while with yield true false null undefined',
  typescript: 'await async break case catch class const continue declare default delete do else enum export extends finally for from function if implements import in infer instanceof interface keyof let namespace new of private protected public readonly return static super switch this throw try type typeof var void while yield true false null undefined any string number boolean unknown never',
  python: 'and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield True False None self print',
  bash: 'if then else elif fi for while do done case esac function return export local source alias unset echo cd ls mkdir rm cp mv cat grep sed awk curl npm node git sudo brew chmod exit set',
  json: 'true false null',
  css: '',
  html: '',
  go: 'break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var nil true false',
  rust: 'as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self static struct super trait true type unsafe use where while',
  sql: 'select from where insert update delete create table alter drop join left right inner outer on group by order limit having as and or not null values into distinct',
  java: 'abstract boolean break byte case catch char class const continue default do double else enum extends final finally float for if implements import int interface long new package private protected public return short static super switch this throw throws try void while true false null',
};
const ALIASES = { js: 'javascript', jsx: 'javascript', mjs: 'javascript', ts: 'typescript', tsx: 'typescript', py: 'python', sh: 'bash', shell: 'bash', zsh: 'bash', console: 'bash', yml: 'yaml', md: 'markdown', golang: 'go', rs: 'rust', 'c++': 'cpp' };

function grammar(lang) {
  const kw = KEYWORDS[lang];
  if (lang === 'html' || lang === 'xml' || lang === 'svg') {
    return [
      ['com', /<!--[\s\S]*?-->/],
      ['str', /"[^"]*"|'[^']*'/],
      ['tag', /<\/?[A-Za-z][\w:-]*|\/?>/],
      ['attr', /\s[A-Za-z-]+(?==)/],
    ];
  }
  if (lang === 'css' || lang === 'scss' || lang === 'less') {
    return [
      ['com', /\/\*[\s\S]*?\*\//],
      ['str', /"[^"]*"|'[^']*'/],
      ['attr', /[-\w]+(?=\s*:)/],
      ['num', /#[0-9a-f]{3,8}\b|\b\d+(?:\.\d+)?(?:px|rem|em|%|vh|vw|s|ms|deg|fr)?\b/i],
      ['tag', /[.#][-\w]+|@[-\w]+/],
    ];
  }
  if (lang === 'json') {
    return [
      ['attr', /"(?:\\.|[^"\\])*"(?=\s*:)/],
      ['str', /"(?:\\.|[^"\\])*"/],
      ['num', /\b-?\d+(?:\.\d+)?(?:e[+-]?\d+)?\b/i],
      ['key', /\b(?:true|false|null)\b/],
    ];
  }
  if (lang === 'markdown') {
    return [
      ['key', /^#{1,6} .*$/m],
      ['str', /`[^`]*`/],
      ['fn', /\*\*[^*]+\*\*/],
    ];
  }
  if (!kw && kw !== '') return null;
  const rules = [
    ['com', lang === 'python' || lang === 'bash' || lang === 'yaml' ? /#[^\n]*/ : /\/\/[^\n]*|\/\*[\s\S]*?\*\//],
    ['str', /"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`/],
    ['num', /\b0x[\da-f]+\b|\b\d+(?:\.\d+)?(?:e[+-]?\d+)?\b/i],
  ];
  if (kw) rules.push(['key', new RegExp('\\b(?:' + kw.trim().split(/\s+/).join('|') + ')\\b')]);
  rules.push(['fn', /\b[A-Za-z_$][\w$]*(?=\s*\()/]);
  return rules;
}

/** Tokenise raw source and emit escaped, coloured HTML. Never injects markup. */
function highlight(code, lang) {
  const key = ALIASES[String(lang || '').toLowerCase()] || String(lang || '').toLowerCase();
  const rules = grammar(key);
  if (!rules) return escapeHtml(code);

  const master = new RegExp(rules.map(([, re]) => `(${re.source})`).join('|'), 'gmi');
  let out = '';
  let last = 0;
  let m;
  while ((m = master.exec(code)) !== null) {
    if (m.index > last) out += escapeHtml(code.slice(last, m.index));
    const groupIndex = m.slice(1).findIndex((g) => g !== undefined);
    const cls = rules[groupIndex] ? rules[groupIndex][0] : 'str';
    out += `<span class="tok-${cls}">${escapeHtml(m[0])}</span>`;
    last = m.index + m[0].length;
    if (m[0].length === 0) master.lastIndex++;
  }
  out += escapeHtml(code.slice(last));
  return out;
}

/* ────────────────────────────────────────────────────── markdown renderer */

const SAFE_SCHEME = /^(https?:\/\/|mailto:|\/|#|\.\/)/i;
const safeUrl = (u) => {
  const url = String(u).trim();
  if (!SAFE_SCHEME.test(url)) return null;
  if (/^\s*javascript:/i.test(url) || /^\s*data:/i.test(url) || /^\s*vbscript:/i.test(url)) return null;
  return url;
};

function inlineMd(text) {
  let s = escapeHtml(text);

  // protect inline code first so nothing else rewrites its contents
  const codes = [];
  s = s.replace(/`([^`\n]+)`/g, (_, c) => { codes.push(c); return `\u0001${codes.length - 1}\u0001`; });

  s = s
    .replace(/\*\*\*([^*\n]+)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^\w*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>')
    .replace(/(^|[^\w_])_([^_\n]+)_(?![\w_])/g, '$1<em>$2</em>')
    .replace(/~~([^~\n]+)~~/g, '<del>$1</del>');

  // images then links
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g, (m, alt, url) => {
    const safe = safeUrl(url);
    return safe ? `<img src="${safe}" alt="${alt}" loading="lazy">` : m;
  });
  s = s.replace(/\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g, (m, label, url) => {
    const safe = safeUrl(url);
    return safe ? `<a href="${safe}" target="_blank" rel="noopener noreferrer">${label || safe}</a>` : m;
  });
  s = s.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g,
    (m, pre, url) => `${pre}<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`);

  return s.replace(/\u0001(\d+)\u0001/g, (_, i) => `<code>${codes[i]}</code>`);
}

function codeBlockHtml(block, index) {
  const lang = (block.lang || '').toLowerCase();
  const label = lang || 'text';
  return (
    `<div class="code-block" data-code-index="${index}">` +
      `<div class="code-head"><span class="code-lang">${escapeHtml(label)}</span>` +
      `<button class="copy-btn" type="button" data-copy="${index}" aria-label="Copy code">` +
      `<svg class="ico ico-sm" aria-hidden="true"><use href="#i-copy"/></svg>Copy</button></div>` +
      `<pre><code>${highlight(block.code, lang)}</code></pre>` +
    '</div>'
  );
}

/** Markdown → HTML. Everything is escaped first; only our own tags survive. */
function renderMarkdown(src) {
  const fences = [];
  let text = String(src || '').replace(
    /```([^\n`]*)\n?([\s\S]*?)(?:\n?```|$)/g,
    (_, info, code) => {
      fences.push({ lang: (info || '').trim().split(/\s+/)[0], code: code.replace(/\n$/, '') });
      return `\n\u0000${fences.length - 1}\u0000\n`;
    }
  );

  const lines = text.split('\n');
  const out = [];
  let i = 0;

  const isBlockStart = (line) =>
    !line.trim() ||
    /^\u0000\d+\u0000$/.test(line) ||
    /^(#{1,6})\s/.test(line) ||
    /^\s*>/.test(line) ||
    /^\s*([-*+]|\d+[.)])\s+/.test(line) ||
    /^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(line);

  while (i < lines.length) {
    const line = lines[i];

    const ph = line.match(/^\u0000(\d+)\u0000$/);
    if (ph) { out.push(codeBlockHtml(fences[+ph[1]], +ph[1])); i++; continue; }

    if (!line.trim()) { i++; continue; }

    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) { out.push(`<h${h[1].length}>${inlineMd(h[2].replace(/\s+#+\s*$/, ''))}</h${h[1].length}>`); i++; continue; }

    if (/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(line)) { out.push('<hr>'); i++; continue; }

    // table: header row followed by a separator row
    if (line.includes('|') && /^\s*\|?[\s:|-]*-[\s:|-]*$/.test(lines[i + 1] || '')) {
      const cells = (row) => row.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim());
      const head = cells(line);
      i += 2;
      const body = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) { body.push(cells(lines[i])); i++; }
      out.push(
        '<table><thead><tr>' + head.map((c) => `<th>${inlineMd(c)}</th>`).join('') + '</tr></thead><tbody>' +
        body.map((r) => '<tr>' + head.map((_, ci) => `<td>${inlineMd(r[ci] || '')}</td>`).join('') + '</tr>').join('') +
        '</tbody></table>'
      );
      continue;
    }

    if (/^\s*>/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) { buf.push(lines[i].replace(/^\s*>\s?/, '')); i++; }
      out.push(`<blockquote>${renderMarkdown(buf.join('\n'))}</blockquote>`);
      continue;
    }

    if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*([-*+]|\d+[.)])\s+/.test(lines[i])) {
        const m = lines[i].match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
        const item = { indent: Math.floor(m[1].replace(/\t/g, '  ').length / 2), ordered: /\d/.test(m[2]), text: m[3] };
        i++;
        // continuation lines belong to the same item
        while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i]) && /^\s{2,}/.test(lines[i])) {
          item.text += '\n' + lines[i].trim(); i++;
        }
        items.push(item);
      }
      out.push(buildList(items, 0));
      continue;
    }

    const para = [];
    while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i])) { para.push(lines[i]); i++; }
    if (para.length) out.push(`<p>${inlineMd(para.join('\n')).replace(/\n/g, '<br>')}</p>`);
    else i++;
  }

  return out.join('\n');
}

/** Turn a flat list of {indent, ordered, text} into nested <ul>/<ol>. */
function buildList(items, start) {
  if (!items.length) return '';
  const level = items[start]?.indent ?? 0;
  const tag = items[start]?.ordered ? 'ol' : 'ul';
  let html = `<${tag}>`;
  let i = start;
  while (i < items.length && items[i].indent >= level) {
    if (items[i].indent > level) {
      const childStart = i;
      while (i < items.length && items[i].indent > level) i++;
      html = html.replace(/<\/li>$/, buildList(items.slice(childStart, i), 0) + '</li>');
      continue;
    }
    const body = items[i].text.includes('\n')
      ? inlineMd(items[i].text).replace(/\n/g, '<br>')
      : inlineMd(items[i].text);
    html += `<li>${body}</li>`;
    i++;
  }
  return html + `</${tag}>`;
}

/* ──────────────────────────────────────────────────── persistence helpers */

const memoryStore = new Map();
let storageWorks = true;

const LS = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) return memoryStore.has(key) ? memoryStore.get(key) : fallback;
      return JSON.parse(raw);
    } catch {
      return memoryStore.has(key) ? memoryStore.get(key) : fallback;
    }
  },
  set(key, value) {
    memoryStore.set(key, value);
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (err) {
      storageWorks = false;
      return false;
    }
  },
  del(key) {
    memoryStore.delete(key);
    try { localStorage.removeItem(key); } catch { /* ignore */ }
  },
};

const DEFAULT_SYSTEM_PROMPT =
  'You are DonetClassroom, a helpful AI assistant. Give accurate, clear, useful answers. ' +
  'When analyzing images, carefully inspect the provided image and explicitly distinguish ' +
  'visible facts from assumptions. Do not claim to see information that is not present.';

const DEFAULT_SETTINGS = {
  provider: 'auto',
  model: 'auto',
  temperature: 0.7,
  maxTokens: 2048,
  streaming: true,
  freeOnly: true,
  allowPaid: false,
  contextLimit: 'auto',
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  webSearch: false,

  ollamaUrl: 'http://localhost:11434',
  apiKey: '',
  geminiKey: '',
  rememberKey: false,

  theme: 'oled',
  enterToSend: true,
  showTimestamps: true,
  markdown: true,
  wrapCode: false,
  autoTitle: true,
  imageQuality: 'balanced',

  sidebarCollapsed: false,
  onboarded: false,
};

const settings = Object.assign({}, DEFAULT_SETTINGS, LS.get('donet.settings', {}));
// The API key is only ever persisted when the user opted in.
if (!settings.rememberKey) {
  settings.apiKey = LS.get('donet.session.key', '') || '';
  settings.geminiKey = settings.geminiKey || LS.get('donet.session.geminiKey', '') || '';
}
if (!settings.geminiKey && EMBEDDED_CONFIG.geminiKey) settings.geminiKey = EMBEDDED_CONFIG.geminiKey;
if (!settings.apiKey && EMBEDDED_CONFIG.openrouterKey) settings.apiKey = EMBEDDED_CONFIG.openrouterKey;
if (EMBEDDED_CONFIG.ollamaHost) settings.ollamaUrl = 'http://' + EMBEDDED_CONFIG.ollamaHost + ':11434';

function saveSettings() {
  const copy = Object.assign({}, settings);
  if (!settings.rememberKey) { copy.apiKey = ''; copy.geminiKey = ''; }
  LS.set('donet.settings', copy);
  if (settings.rememberKey) { LS.del('donet.session.key'); LS.del('donet.session.geminiKey'); }
  else {
    if (settings.apiKey) LS.set('donet.session.key', settings.apiKey);
    if (settings.geminiKey) LS.set('donet.session.geminiKey', settings.geminiKey);
  }
}

/* ───────────────────────────────────────────────────────── chat storage */

/** Server mode: chats live in data/chats/*.json via the backend. */
const ServerStore = {
  async list() {
    const res = await fetch('/api/chats');
    if (!res.ok) throw new Error('Could not load chats');
    return (await res.json()).chats || [];
  },
  async get(id) {
    const res = await fetch('/api/chats/' + encodeURIComponent(id));
    if (!res.ok) return null;
    return res.json();
  },
  async save(chat) {
    await fetch('/api/chats/' + encodeURIComponent(chat.id), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(chat),
    });
  },
  async remove(id) {
    await fetch('/api/chats/' + encodeURIComponent(id), { method: 'DELETE' });
  },
  async clear() {
    await fetch('/api/chats', { method: 'DELETE' });
  },
  async importChats(chats) {
    const res = await fetch('/api/chats/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chats }),
    });
    return (await res.json()).imported || 0;
  },
  async all() {
    const summaries = await this.list();
    const out = [];
    for (const s of summaries) {
      const chat = await this.get(s.id);
      if (chat) out.push(chat);
    }
    return out;
  },
};

/** Standalone mode: chats live in localStorage (with a memory fallback). */
const LocalStore = {
  key: 'donet.chats',
  _read() { return LS.get(this.key, {}) || {}; },
  _write(map) {
    if (LS.set(this.key, map)) return true;
    // Out of quota: drop images from the oldest chats and try once more.
    const trimmed = JSON.parse(JSON.stringify(map));
    const ids = Object.keys(trimmed).sort((a, b) => (trimmed[a].updatedAt || 0) - (trimmed[b].updatedAt || 0));
    for (const id of ids) {
      for (const msg of trimmed[id].messages || []) {
        if (msg.images?.length) { msg.images = []; msg.imagesDropped = true; }
      }
      if (LS.set(this.key, trimmed)) {
        toast('Storage was full — older images were removed from history.', 'err');
        return true;
      }
    }
    toast('Browser storage is full. This chat is kept in memory only.', 'err');
    return false;
  },
  async list() {
    const map = this._read();
    return Object.values(map)
      .map((c) => ({
        id: c.id, title: c.title, createdAt: c.createdAt, updatedAt: c.updatedAt,
        messageCount: (c.messages || []).length,
        preview: (c.messages || []).find((m) => m.role === 'user')?.text?.slice(0, 120) || '',
      }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  },
  async get(id) { return this._read()[id] || null; },
  async save(chat) { const map = this._read(); map[chat.id] = chat; this._write(map); },
  async remove(id) { const map = this._read(); delete map[id]; this._write(map); },
  async clear() { this._write({}); },
  async importChats(chats) {
    const map = this._read();
    let n = 0;
    for (const chat of chats) {
      if (!chat || !Array.isArray(chat.messages)) continue;
      const id = chat.id && !map[chat.id] ? chat.id : uid();
      map[id] = {
        id, title: chat.title || 'Imported chat',
        createdAt: chat.createdAt || Date.now(), updatedAt: chat.updatedAt || Date.now(),
        messages: chat.messages,
      };
      n++;
    }
    this._write(map);
    return n;
  },
  async all() { return Object.values(this._read()); },
};

const Store = STANDALONE ? LocalStore : ServerStore;

/* ──────────────────────────────────────────────────────────── SSE reader */

async function readSSE(response, onEvent, signal) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let eventName = 'message';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let nl;
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl).replace(/\r$/, '');
        buffer = buffer.slice(nl + 1);
        if (line === '') { eventName = 'message'; continue; }
        if (line.startsWith(':')) continue;
        if (line.startsWith('event:')) { eventName = line.slice(6).trim(); continue; }
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (payload === '[DONE]') { onEvent('done-marker', null); continue; }
        try { onEvent(eventName, JSON.parse(payload)); } catch { /* partial json */ }
      }
    }
  } catch (err) {
    if (!signal?.aborted) throw err;
  }
}

/* ───────────────────────────────────────────────────── provider adapters */

const VISION_HINTS = ['llava', 'bakllava', 'moondream', 'minicpm-v', 'llama3.2-vision', 'llama-3.2-vision',
  'llama4', 'qwen2-vl', 'qwen2.5vl', 'qwen2.5-vl', 'qwen3-vl', 'gemma3', 'mistral-small3',
  'granite3.2-vision', 'internvl', 'pixtral', 'cogvlm'];
const VISION_EXCLUDE = ['gemma3n', 'gemma3:1b'];
const guessVision = (name) => {
  const n = String(name || '').toLowerCase();
  if (VISION_EXCLUDE.some((x) => n.includes(x))) return false;
  return VISION_HINTS.some((x) => n.includes(x));
};

const isFreePricing = (pricing) => {
  if (!pricing || typeof pricing !== 'object') return false;
  const fields = ['prompt', 'completion', 'image', 'request', 'input_cache_read', 'input_cache_write'];
  let sawNumber = false;
  for (const f of fields) {
    if (pricing[f] === undefined || pricing[f] === null || pricing[f] === '') continue;
    const v = Number(pricing[f]);
    if (!Number.isFinite(v) || v !== 0) return false;
    sawNumber = true;
  }
  return sawNumber;
};

async function withTimeout(promiseFactory, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try { return await promiseFactory(ctrl.signal); }
  finally { clearTimeout(timer); }
}

/** Talks to the Node backend. The OpenRouter key never reaches the browser. */
const ServerProviders = {
  async status() {
    const res = await fetch('/api/status');
    return res.json();
  },
  async models({ refresh = false } = {}) {
    const res = await fetch('/api/models' + (refresh ? '?refresh=1' : ''));
    return res.json();
  },
  async testKey() {
    const res = await fetch('/api/openrouter/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    return res.json();
  },
  async chat(payload, handlers, signal) {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Request failed' }));
      handlers.onError(err);
      return;
    }
    await readSSE(res, (name, data) => {
      if (name === 'meta') handlers.onMeta(data);
      else if (name === 'delta') handlers.onDelta(data.text);
      else if (name === 'reasoning') handlers.onReasoning(data.text);
      else if (name === 'done') handlers.onDone(data);
      else if (name === 'error') handlers.onError({ error: data.message || 'Provider error' });
    }, signal);
  },
};

/** Standalone build: the browser calls Ollama and OpenRouter directly. */
const DirectProviders = {
  ollamaBase: () => String(settings.ollamaUrl || 'http://localhost:11434').replace(/\/+$/, ''),
  orBase: 'https://openrouter.ai/api/v1',
  geminiBase: 'https://generativelanguage.googleapis.com/v1beta',

  /* Curated Gemini line-up. Verified live against the models endpoint. */
  geminiCatalogue() {
    const mk = (id, name, ctx, desc) => ({
      id, name, provider: 'gemini', free: true, vision: true, context: ctx,
      pricing: { prompt: '0', completion: '0' }, description: desc,
    });
    return [
      mk('gemini-flash-latest', 'Gemini Flash (latest)', 1048576, 'Always points at the current Flash release. Fast, multimodal, best default.'),
      mk('gemini-2.5-flash', 'Gemini 2.5 Flash', 1048576, 'Stable mid-size multimodal model.'),
      mk('gemini-2.5-pro', 'Gemini 2.5 Pro', 1048576, 'Most capable stable model. Slower, better reasoning.'),
      mk('gemini-pro-latest', 'Gemini Pro (latest)', 1048576, 'Always points at the current Pro release.'),
      mk('gemini-flash-lite-latest', 'Gemini Flash Lite', 1048576, 'Lightest and fastest. Good for quick questions.'),
    ];
  },

  async status() {
    const out = { ollama: { online: false, url: this.ollamaBase() }, openrouter: { configured: Boolean(settings.apiKey) }, gemini: { configured: Boolean(settings.geminiKey) }, freeOnly: settings.freeOnly };
    try {
      const res = await withTimeout((sig) => fetch(this.ollamaBase() + '/api/tags', { signal: sig }), 2500);
      if (res.ok) {
        const data = await res.json();
        out.ollama = { online: true, modelCount: (data.models || []).length, url: this.ollamaBase() };
      }
    } catch {
      out.ollama.error = IS_FILE
        ? 'Ollama is unreachable from a file:// page unless OLLAMA_ORIGINS allows it.'
        : 'Ollama is not reachable';
    }
    if (settings.apiKey) {
      const check = await this.testKey();
      Object.assign(out.openrouter, check);
    }
    if (settings.geminiKey) {
      const g = await this.testGeminiKey();
      Object.assign(out.gemini, g);
    }
    return out;
  },

  async models({ refresh = false } = {}) {
    const out = { ollama: [], openrouter: [], gemini: [], errors: {} };
    if (settings.geminiKey) out.gemini = this.geminiCatalogue();
    else out.errors.gemini = 'No Gemini API key saved';

    try {
      const res = await withTimeout((sig) => fetch(this.ollamaBase() + '/api/tags', { signal: sig }), 5000);
      if (!res.ok) throw new Error('bad status');
      const data = await res.json();
      out.ollama = await Promise.all((data.models || []).map(async (m) => {
        let vision = guessVision(m.name);
        let context = null;
        try {
          const show = await withTimeout((sig) => fetch(this.ollamaBase() + '/api/show', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: m.name }), signal: sig,
          }), 6000);
          if (show.ok) {
            const info = await show.json();
            if (Array.isArray(info.capabilities)) vision = info.capabilities.includes('vision');
            const key = Object.keys(info.model_info || {}).find((k) => k.endsWith('.context_length'));
            if (key) context = Number(info.model_info[key]) || null;
          }
        } catch { /* keep heuristic */ }
        return {
          id: m.name, name: m.name, provider: 'ollama', free: true, vision, context,
          sizeBytes: m.size || null, parameterSize: m.details?.parameter_size || null,
          quantization: m.details?.quantization_level || null,
        };
      }));
      out.ollama.sort((a, b) => a.name.localeCompare(b.name));
    } catch {
      out.errors.ollama = 'Local AI offline';
    }

    if (!refresh && this._catalogue && Date.now() - this._catalogueAt < 10 * 60 * 1000) {
      out.openrouter = this._catalogue;
    } else {
      try {
        const res = await withTimeout((sig) => fetch(this.orBase + '/models', { signal: sig }), 15000);
        if (!res.ok) throw new Error('models ' + res.status);
        const data = await res.json();
        const models = (data.data || []).map((m) => ({
          id: m.id, name: m.name || m.id, provider: 'openrouter',
          free: isFreePricing(m.pricing),
          vision: (m.architecture?.input_modalities || []).includes('image'),
          context: m.context_length || m.top_provider?.context_length || null,
          pricing: { prompt: m.pricing?.prompt ?? null, completion: m.pricing?.completion ?? null },
          description: m.description ? String(m.description).slice(0, 240) : '',
          reasoning: Boolean(m.supported_parameters?.includes('reasoning')),
        }));
        models.unshift({
          id: 'openrouter/auto', name: 'Free Router (auto-pick)', provider: 'openrouter', router: true,
          free: true, vision: true, context: null, pricing: { prompt: '0', completion: '0' },
          description: 'Lets OpenRouter pick a currently available model. Subject to live rate limits.',
        });
        this._catalogue = models;
        this._catalogueAt = Date.now();
        out.openrouter = models;
      } catch (err) {
        out.errors.openrouter = 'Could not reach OpenRouter';
      }
    }
    return out;
  },

  async testGeminiKey(key) {
    const apiKey = (key || settings.geminiKey || '').trim();
    if (!apiKey) return { ok: false, error: 'No Gemini API key saved.' };
    try {
      const res = await withTimeout((sig) => fetch(
        this.geminiBase + '/models', { headers: { 'x-goog-api-key': apiKey }, signal: sig }), 10000);
      if (res.status === 400 || res.status === 401 || res.status === 403) {
        return { ok: false, error: 'That Gemini key was rejected (' + res.status + ').' };
      }
      if (!res.ok) return { ok: false, error: 'Gemini replied ' + res.status };
      const data = await res.json();
      const n = (data.models || []).length;
      return { ok: true, label: n + ' models available' };
    } catch {
      return { ok: false, error: 'Network error reaching Gemini.' };
    }
  },

  /* OpenAI-shaped messages -> Gemini generateContent body. */
  toGeminiBody(payload) {
    const contents = [];
    let systemText = '';
    for (const m of payload.messages) {
      if (m.role === 'system') {
        systemText += (systemText ? '\n\n' : '') + (typeof m.content === 'string' ? m.content : '');
        continue;
      }
      const parts = [];
      if (typeof m.content === 'string') {
        if (m.content) parts.push({ text: m.content });
      } else if (Array.isArray(m.content)) {
        for (const p of m.content) {
          if (p.type === 'text' && p.text) parts.push({ text: p.text });
          else if (p.type === 'image_url') {
            const url = p.image_url && p.image_url.url ? p.image_url.url : '';
            const match = /^data:([^;]+);base64,(.*)$/.exec(url);
            if (match) parts.push({ inlineData: { mimeType: match[1], data: match[2] } });
          }
        }
      }
      if (!parts.length) continue;
      contents.push({ role: m.role === 'assistant' ? 'model' : 'user', parts });
    }
    const body = { contents };
    if (systemText) body.systemInstruction = { parts: [{ text: systemText }] };
    const gen = {};
    if (payload.temperature !== undefined) gen.temperature = payload.temperature;
    if (payload.maxTokens) gen.maxOutputTokens = payload.maxTokens;
    if (Object.keys(gen).length) body.generationConfig = gen;
    return body;
  },

  async testKey(key) {
    const apiKey = (key || settings.apiKey || '').trim();
    if (!apiKey) return { ok: false, error: 'No API key saved.' };
    try {
      const res = await withTimeout((sig) => fetch(this.orBase + '/auth/key', {
        headers: { Authorization: 'Bearer ' + apiKey }, signal: sig,
      }), 10000);
      if (res.status === 401) return { ok: false, error: 'That API key was rejected (401).' };
      if (!res.ok) return { ok: false, error: 'OpenRouter replied ' + res.status };
      const data = (await res.json()).data || {};
      return { ok: true, label: data.label || null, isFreeTier: data.is_free_tier ?? null, usage: data.usage ?? null, limit: data.limit ?? null };
    } catch {
      return { ok: false, error: 'Network error reaching OpenRouter.' };
    }
  },

  async chat(payload, handlers, signal) {
    const wantsVision = payload.messages.some(
      (m) => Array.isArray(m.content) && m.content.some((p) => p.type === 'image_url')
    );
    const catalogue = await this.models({}).catch(() => ({ ollama: [], openrouter: [] }));
    let provider = payload.provider;
    let model = payload.model && payload.model !== 'auto' ? payload.model : null;
    let info = null;
    let note = null;

    if (provider === 'auto') {
      const localPick = wantsVision
        ? catalogue.ollama.find((m) => m.vision)
        : catalogue.ollama.find((m) => m.id === model) || catalogue.ollama[0];
      if (localPick) {
        provider = 'ollama'; model = localPick.id; info = localPick;
        note = wantsVision ? 'Auto → local vision model' : 'Auto → local model';
      } else if (settings.geminiKey) {
        provider = 'gemini'; model = null;
        note = wantsVision ? 'Auto → Gemini (no local vision model)' : 'Auto → Gemini (no local models)';
      } else {
        provider = 'openrouter'; model = null;
        note = wantsVision ? 'Auto → cloud (no local vision model)' : 'Auto → cloud (no local models)';
      }
    }

    if (provider === 'ollama') {
      if (!catalogue.ollama.length) {
        return handlers.onError({
          error: 'Local AI offline',
          detail: "Couldn't connect to Ollama.\n\nMake sure Ollama is running and try again.\nEndpoint: " + this.ollamaBase(),
          code: 'OLLAMA_OFFLINE',
        });
      }
      info = catalogue.ollama.find((m) => m.id === model) || (wantsVision ? catalogue.ollama.find((m) => m.vision) : null) || catalogue.ollama[0];
      model = info.id;
      if (wantsVision && !info.vision) {
        return handlers.onError({ error: "Selected model doesn't support image understanding. Choose a vision model.", code: 'MODEL_NO_VISION' });
      }
    }

    if (provider === 'gemini') {
      if (!settings.geminiKey) {
        return handlers.onError({
          error: 'No Gemini API key saved.',
          detail: 'Open Settings → Cloud and paste your key. Get one free at ai.google.dev',
          code: 'NO_API_KEY',
        });
      }
      const list = (catalogue.gemini && catalogue.gemini.length) ? catalogue.gemini : this.geminiCatalogue();
      info = list.find((m) => m.id === model) || null;
      if (!model || !info) { info = list[0]; model = info.id; }
    }

    if (provider === 'openrouter') {
      if (!settings.apiKey) {
        return handlers.onError({
          error: 'No OpenRouter API key saved.',
          detail: 'Open Settings → Cloud and paste your key. Free keys work fine.',
          code: 'NO_API_KEY',
        });
      }
      if (!model) {
        const free = catalogue.openrouter.filter((m) => m.free && !m.router);
        const pick = wantsVision ? free.find((m) => m.vision) : free[0];
        model = pick ? pick.id : 'openrouter/auto';
      }
      info = catalogue.openrouter.find((m) => m.id === model) || null;

      if (payload.freeOnly) {
        if (!info) {
          return handlers.onError({
            error: 'Unknown model — refusing to send it while Free-only mode is on.',
            detail: `"${model}" is not in OpenRouter's live catalogue, so its price cannot be verified.`,
            code: 'MODEL_UNVERIFIED',
          });
        }
        if (!info.free) {
          return handlers.onError({
            error: 'That model is not free right now — request blocked.',
            detail: `"${model}" currently charges ${info.pricing?.prompt}/token in and ${info.pricing?.completion}/token out.\n\nPick a free model, or turn off "Only use free models" in Settings.`,
            code: 'PAID_MODEL_BLOCKED',
          });
        }
      } else if (info && !info.free && !payload.allowPaid) {
        return handlers.onError({ error: 'Paid model requires explicit confirmation.', detail: 'Enable "Allow paid models" in Settings.', code: 'PAID_NEEDS_CONFIRM' });
      }
      if (wantsVision && info && !info.vision && !info.router) {
        return handlers.onError({ error: "Selected model doesn't support image understanding. Choose a vision model.", code: 'MODEL_NO_VISION' });
      }
    }

    handlers.onMeta({
      provider, model, note,
      vision: Boolean(info?.vision),
      free: provider === 'ollama' ? true : Boolean(info?.free),
      context: info?.context || null,
    });

    const streaming = payload.stream !== false;
    const url = provider === 'ollama'
      ? this.ollamaBase() + '/v1/chat/completions'
      : provider === 'gemini'
      ? this.geminiBase + '/models/' + encodeURIComponent(model) + ':' +
        (streaming ? 'streamGenerateContent?alt=sse' : 'generateContent')
      : this.orBase + '/chat/completions';
    const headers = { 'Content-Type': 'application/json' };
    if (provider === 'gemini') headers['x-goog-api-key'] = settings.geminiKey;
    if (provider === 'openrouter') {
      headers.Authorization = 'Bearer ' + settings.apiKey;
      headers['HTTP-Referer'] = location.origin.startsWith('http') ? location.origin : 'https://donetclassroom.local';
      headers['X-Title'] = 'DonetClassroom';
    }

    let res;
    try {
      const body = provider === 'gemini'
        ? this.toGeminiBody(payload)
        : {
            model,
            messages: payload.messages,
            stream: streaming,
            ...(payload.temperature !== undefined ? { temperature: payload.temperature } : {}),
            ...(payload.maxTokens ? { max_tokens: payload.maxTokens } : {}),
          };
      res = await fetch(url, { method: 'POST', headers, signal, body: JSON.stringify(body) });
    } catch (err) {
      if (signal?.aborted) return;
      return handlers.onError(provider === 'ollama'
        ? {
            error: "Couldn't connect to Ollama.",
            detail: 'Make sure Ollama is running and try again.\nEndpoint: ' + this.ollamaBase() +
              (IS_FILE || location.origin.startsWith('http')
                ? '\n\nIf Ollama is running, it may be refusing this page\'s origin. Start it with:\n  OLLAMA_ORIGINS="*" ollama serve'
                : ''),
            code: 'OLLAMA_OFFLINE',
          }
        : provider === 'gemini'
        ? {
            error: 'Gemini request failed.',
            detail: 'Check:\n• API key is valid\n• Internet connection\n• generativelanguage.googleapis.com is not blocked',
          }
        : {
            error: 'OpenRouter request failed.',
            detail: 'Check:\n• API key\n• Internet connection\n• Free-model availability\n• Rate limits',
          });
    }

    if (!res.ok) {
      let detail = '';
      try { const j = await res.json(); detail = j.error?.message || j.error || ''; } catch { detail = ''; }
      const friendly = provider === 'ollama'
        ? `The local model "${model}" could not run.\n\n${detail || 'Ollama returned ' + res.status}`
        : provider === 'gemini'
        ? (res.status === 400 || res.status === 401 || res.status === 403
            ? `Gemini rejected the request (${res.status}).\n\n${detail || 'Check your API key in Settings \→ Cloud.'}`
            : res.status === 429
            ? 'Rate limited by Gemini (429). The free tier shares a limited pool \u2014 wait a moment and try again.'
            : res.status === 503
            ? `"${model}" is busy right now (503).\n\nGoogle reports high demand on this model. Try again in a moment, or pick another Gemini model.`
            : `Gemini returned ${res.status}.${detail ? '\n\n' + detail : ''}`)
        : res.status === 401 ? 'OpenRouter rejected the API key (401).'
        : res.status === 402 ? 'This request needs credits (402). Pick a free model.'
        : res.status === 429 ? 'Rate limited by OpenRouter (429). Free models share a limited pool — wait a moment or pick another free model.'
        : `OpenRouter request failed.\n\nCheck:\n• API key\n• Internet connection\n• Free-model availability\n• Rate limits${detail ? '\n\nProvider said: ' + detail : ''}`;
      const label = provider === 'ollama' ? 'Local model error'
        : provider === 'gemini' ? 'Gemini request failed'
        : 'OpenRouter request failed';
      return handlers.onError({ error: label, detail: friendly });
    }

    if (!streaming) {
      const data = await res.json();
      if (provider === 'gemini') {
        const parts = data.candidates?.[0]?.content?.parts || [];
        const text = parts.map((p) => p.text || '').join('');
        if (text) handlers.onDelta(text);
        return handlers.onDone({
          provider, model: data.modelVersion || model,
          usage: data.usageMetadata || null,
          finishReason: data.candidates?.[0]?.finishReason || null,
        });
      }
      const text = data.choices?.[0]?.message?.content || '';
      handlers.onDelta(text);
      return handlers.onDone({ provider, model: data.model || model, usage: data.usage });
    }

    let usage = null; let finish = null; let resolved = model;
    await readSSE(res, (_name, data) => {
      if (!data) return;
      if (data.error) { handlers.onError({ error: data.error.message || 'Provider error' }); return; }

      if (provider === 'gemini') {
        const cand = data.candidates?.[0];
        /* A part can carry a thoughtSignature with empty text - skip those. */
        for (const part of (cand?.content?.parts || [])) {
          if (typeof part.text === 'string' && part.text) handlers.onDelta(part.text);
        }
        if (cand?.finishReason) finish = cand.finishReason;
        if (data.usageMetadata) usage = data.usageMetadata;
        if (data.modelVersion) resolved = data.modelVersion;
        return;
      }

      const choice = data.choices?.[0];
      const delta = choice?.delta || {};
      if (typeof delta.content === 'string' && delta.content) handlers.onDelta(delta.content);
      if (typeof delta.reasoning === 'string' && delta.reasoning) handlers.onReasoning(delta.reasoning);
      if (choice?.finish_reason) finish = choice.finish_reason;
      if (data.usage) usage = data.usage;
      if (data.model) resolved = data.model;
    }, signal);

    handlers.onDone({ provider, model: resolved, usage, finishReason: finish });
  },
};

const Providers = STANDALONE ? DirectProviders : ServerProviders;

/* ────────────────────────────────────────────────────────────────── state */

const state = {
  chats: [],                 // sidebar summaries
  current: null,             // { id, title, createdAt, updatedAt, messages: [] }
  models: { ollama: [], openrouter: [], gemini: [], errors: {} },
  status: null,
  attachments: [],           // { id, dataUrl, name, kind }
  stream: null,              // active generation
  temporary: false,
  serverConfig: null,
  stickToBottom: true,
};

const dom = {};
const ids = ['app', 'sidebar', 'messages', 'messagesWrap', 'welcome', 'suggestions', 'input', 'composer',
  'sendBtn', 'stopBtn', 'attachments', 'chatList', 'chatTitle', 'modelBtn', 'modelBtnText', 'modelDot',
  'statusDot', 'statusLabel', 'statusSub', 'pillDot', 'pillText', 'composerNotice', 'footProvider',
  'fileInput', 'dropOverlay', 'scrollBottomBtn', 'toasts', 'fabPanel', 'fabGrid', 'fabBtn'];
for (const id of ids) dom[id] = document.getElementById(id);

/* ─────────────────────────────────────────────────────── message helpers */

function makeMessage(role, fields = {}) {
  return { id: uid(), role, text: '', images: [], ts: Date.now(), ...fields };
}

/** Extra context the user asked us to mention (shortcut "AI reference" flag). */
function referenceNote() {
  const refs = (LS.get('donet.shortcuts', []) || []).filter((s) => s.enabled !== false && s.reference && s.url);
  if (!refs.length) return '';
  return (
    '\n\nThe user keeps these sites as reference sources: ' +
    refs.map((r) => `${r.name} (${r.url})`).join(', ') +
    '. You cannot browse them — do not invent their contents. Mention them only when genuinely relevant.'
  );
}

/**
 * Web search via Wikipedia's public API: free, no key, and it allows browser
 * requests (origin=*). Returns up to `limit` {title, url, extract}; [] on failure.
 */
async function searchWikipedia(query, limit = 3) {
  const params = new URLSearchParams({
    action: 'query', generator: 'search', gsrsearch: query.slice(0, 300), gsrlimit: String(limit),
    prop: 'extracts|info', exintro: '1', explaintext: '1', exsentences: '6', inprop: 'url',
    format: 'json', origin: '*',
  });
  try {
    const res = await withTimeout((sig) => fetch('https://en.wikipedia.org/w/api.php?' + params, { signal: sig }), 8000);
    if (!res.ok) return [];
    const pages = Object.values((await res.json()).query?.pages || {});
    return pages
      .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
      .filter((p) => p.extract)
      .map((p) => ({ title: p.title, url: p.fullurl, extract: p.extract.slice(0, 1500) }));
  } catch {
    return [];
  }
}

function searchNote(results) {
  if (!results?.length) return '';
  return (
    '\n\nWeb search results (Wikipedia) for the user\'s latest message:\n' +
    results.map((r, i) => `[${i + 1}] ${r.title} — ${r.url}\n${r.extract}`).join('\n\n') +
    '\n\nUse these when they help, cite them as markdown links like [Title](url), and say so ' +
    'plainly if they do not answer the question. Do not invent sources.'
  );
}

function toApiMessages(messages, searchResults) {
  const out = [];
  const system = String(settings.systemPrompt || '').trim();
  const extra = referenceNote() + searchNote(searchResults);
  if (system || extra) out.push({ role: 'system', content: (system + extra).trim() });

  for (const m of messages) {
    if (m.error || m.pending) continue;
    if (m.role === 'user') {
      if (m.images?.length) {
        const parts = [];
        if (m.text) parts.push({ type: 'text', text: m.text });
        for (const url of m.images) parts.push({ type: 'image_url', image_url: { url } });
        out.push({ role: 'user', content: parts });
      } else if (m.text) {
        out.push({ role: 'user', content: m.text });
      }
    } else if (m.role === 'assistant' && m.text) {
      out.push({ role: 'assistant', content: m.text });
    }
  }
  return out;
}

const hasImages = (messages) => messages.some((m) => m.role === 'user' && m.images?.length);

/* ───────────────────────────────────────────────────────────── rendering */

function providerLabel(msg) {
  if (!msg.model) return null;
  const short = String(msg.model).split('/').pop();
  return { short, local: msg.provider === 'ollama' };
}

function buildMessageNode(msg) {
  const node = el('div', { class: 'msg ' + msg.role, dataset: { id: msg.id } });

  if (msg.role === 'user') {
    if (msg.images?.length) {
      const strip = el('div', { class: 'msg-images' });
      for (const src of msg.images) {
        strip.append(el('img', { src, alt: 'Attached image', loading: 'lazy', onclick: () => lightbox(src) }));
      }
      node.append(strip);
    }
    if (msg.imagesDropped) node.append(el('div', { class: 'msg-head' }, 'Images removed to free storage'));
    if (msg.text) node.append(el('div', { class: 'bubble' }, msg.text));

    const foot = el('div', { class: 'msg-head', style: 'justify-content:flex-end' });
    const actions = el('div', { class: 'msg-actions' });
    actions.append(iconButton('copy', 'Copy message', async (btn) => {
      if (await copyText(msg.text)) flashCopied(btn);
    }));
    actions.append(iconButton('edit', 'Edit and resend', () => startEdit(msg.id)));
    foot.append(actions);
    if (settings.showTimestamps) foot.append(el('span', {}, fmtTime(msg.ts)));
    node.append(foot);
    return node;
  }

  // assistant
  const head = el('div', { class: 'msg-head' });
  const label = providerLabel(msg);
  if (label) {
    const badge = el('span', { class: 'badge' });
    badge.append(el('span', { class: 'dot', dataset: { state: label.local ? 'local' : 'cloud' } }));
    badge.append(document.createTextNode(label.short));
    head.append(badge);
  }
  if (settings.showTimestamps && msg.ts) head.append(el('span', {}, fmtTime(msg.ts)));
  if (msg.note) head.append(el('span', { class: 'muted' }, msg.note));
  node.append(head);

  const body = el('div', { class: 'bubble' });

  if (msg.reasoning) body.append(buildReasoning(msg.reasoning));

  if (msg.error) {
    const box = el('div', { class: 'msg-error' });
    box.append(el('strong', {}, msg.error.title || 'Something went wrong'));
    box.append(document.createTextNode(msg.error.detail || ''));
    const row = el('div', { class: 'row gap', style: 'margin-top:10px' });
    row.append(el('button', { class: 'btn small', onclick: () => regenerate(msg.id) }, 'Try again'));
    if (msg.error.code === 'MODEL_NO_VISION' || msg.error.code === 'NO_API_KEY' || msg.error.code === 'PAID_MODEL_BLOCKED') {
      row.append(el('button', { class: 'btn small ghost', onclick: () => openModelPicker() }, 'Choose model'));
    }
    if (msg.error.code === 'OLLAMA_OFFLINE') {
      row.append(el('button', { class: 'btn small ghost', onclick: () => openSettings('local') }, 'Start Ollama'));
    }
    box.append(row);
    body.append(box);
  } else {
    const content = el('div', { class: 'md' + (settings.wrapCode ? ' wrap-code' : '') });
    if (settings.markdown) content.innerHTML = renderMarkdown(msg.text);
    else content.textContent = msg.text;
    body.append(content);
  }
  node.append(body);

  if (!msg.error) {
    const actions = el('div', { class: 'msg-actions' });
    actions.append(iconButton('copy', 'Copy response', async (btn) => {
      if (await copyText(msg.text)) flashCopied(btn);
    }));
    actions.append(iconButton('refresh', 'Regenerate response', () => regenerate(msg.id)));
    const up = iconButton('thumb-up', 'Good response', (btn) => rate(msg, 'up', btn));
    const down = iconButton('thumb-down', 'Bad response', (btn) => rate(msg, 'down', btn));
    if (msg.feedback === 'up') up.classList.add('on');
    if (msg.feedback === 'down') down.classList.add('on');
    actions.append(up, down);
    node.append(actions);
  }

  return node;
}

function buildReasoning(text) {
  const details = el('details', { class: 'reasoning' });
  details.append(el('summary', {}, 'Thinking'));
  details.append(el('div', { class: 'reasoning-body' }, text));
  return details;
}

function iconButton(name, label, onClick) {
  const btn = el('button', { class: 'icon-btn', type: 'button', title: label, 'aria-label': label });
  btn.append(icon(name, 'ico ico-sm'));
  btn.addEventListener('click', () => onClick(btn));
  return btn;
}

function flashCopied(btn) {
  const original = btn.innerHTML;
  btn.innerHTML = '';
  btn.append(icon('check', 'ico ico-sm'));
  btn.classList.add('on');
  setTimeout(() => { btn.innerHTML = original; btn.classList.remove('on'); }, 1300);
}

function rate(msg, value, btn) {
  msg.feedback = msg.feedback === value ? null : value;   // local only — nothing is sent anywhere
  const row = btn.parentElement;
  row.querySelectorAll('.icon-btn').forEach((b) => b.classList.remove('on'));
  if (msg.feedback) btn.classList.add('on');
  persist();
}

function lightbox(src) {
  const layer = el('div', { class: 'lightbox', onclick: () => layer.remove() });
  layer.append(el('img', { src, alt: 'Attached image' }));
  document.body.append(layer);
  const onKey = (e) => { if (e.key === 'Escape') { layer.remove(); document.removeEventListener('keydown', onKey); } };
  document.addEventListener('keydown', onKey);
}

function renderMessages() {
  dom.messages.replaceChildren();
  const messages = state.current?.messages || [];
  const frag = document.createDocumentFragment();
  for (const msg of messages) frag.append(buildMessageNode(msg));
  dom.messages.append(frag);
  dom.welcome.hidden = messages.length > 0;
  scrollToBottom(true);
}

function appendMessage(msg) {
  dom.welcome.hidden = true;
  const node = buildMessageNode(msg);
  dom.messages.append(node);
  scrollToBottom();
  return node;
}

function replaceMessageNode(msg) {
  const old = dom.messages.querySelector(`[data-id="${msg.id}"]`);
  if (!old) return appendMessage(msg);
  const node = buildMessageNode(msg);
  old.replaceWith(node);
  return node;
}

function scrollToBottom(force = false) {
  if (!force && !state.stickToBottom) return;
  const wrap = dom.messagesWrap;
  const jump = () => { wrap.scrollTop = wrap.scrollHeight; };
  if (!force) return void requestAnimationFrame(jump);

  // Forced jumps must not animate — a smooth scroll can be interrupted by
  // layout that lands after the call (code blocks, images, late fonts).
  wrap.style.scrollBehavior = 'auto';
  jump();
  requestAnimationFrame(jump);
  setTimeout(() => { jump(); wrap.style.scrollBehavior = ''; }, 60);
}

dom.messagesWrap.addEventListener('scroll', () => {
  const wrap = dom.messagesWrap;
  const distance = wrap.scrollHeight - wrap.scrollTop - wrap.clientHeight;
  state.stickToBottom = distance < 130;
  dom.scrollBottomBtn.hidden = distance < 260;
}, { passive: true });

dom.scrollBottomBtn.addEventListener('click', () => { state.stickToBottom = true; scrollToBottom(true); });

/* copy buttons inside rendered code blocks (event delegation) */
dom.messages.addEventListener('click', (e) => {
  const btn = e.target.closest('.copy-btn');
  if (!btn) return;
  const pre = btn.closest('.code-block')?.querySelector('code');
  if (!pre) return;
  copyText(pre.textContent).then((ok) => {
    if (!ok) return toast('Could not copy', 'err');
    btn.classList.add('done');
    const label = btn.lastChild;
    if (label && label.nodeType === 3) label.textContent = 'Copied';
    setTimeout(() => { btn.classList.remove('done'); if (label && label.nodeType === 3) label.textContent = 'Copy'; }, 1400);
  });
});

/* ──────────────────────────────────────────────────── chat lifecycle */

async function persistChat(chat) {
  if (!chat || state.temporary || !chat.messages.length) return;
  chat.updatedAt = Date.now();
  try {
    await Store.save(chat);
    await refreshSidebar();
  } catch {
    toast('Could not save this chat.', 'err');
  }
}

const persist = debounce(() => persistChat(state.current), 350);

function newChat({ silent = false } = {}) {
  state.current = { id: uid(), title: 'New chat', createdAt: Date.now(), updatedAt: Date.now(), messages: [] };
  dom.chatTitle.textContent = state.temporary ? 'Temporary chat' : 'New chat';
  renderMessages();
  renderSidebar();
  clearAttachments();
  hideNotice();
  if (!silent) dom.input.focus();
}

async function loadChat(id) {
  stopGeneration();
  const chat = await Store.get(id);
  if (!chat) return toast('That chat could not be opened.', 'err');
  state.current = chat;
  state.temporary = false;
  updateTemporaryButton();
  dom.chatTitle.textContent = chat.title || 'New chat';
  renderMessages();
  renderSidebar();
  closeDrawer();
}

function autoTitle(chat = state.current) {
  if (!settings.autoTitle || !chat) return;
  if (chat.title && chat.title !== 'New chat') return;
  const first = chat.messages.find((m) => m.role === 'user');
  if (!first) return;
  let title = (first.text || (first.images?.length ? 'Image question' : '')).trim().replace(/\s+/g, ' ');
  if (!title) return;
  if (title.length > 46) title = title.slice(0, 46).replace(/\s+\S*$/, '') + '…';
  chat.title = title;
  if (state.current === chat) dom.chatTitle.textContent = title;
}

/* ───────────────────────────────────────────────────────────── sending */

function currentModelInfo() {
  const provider = settings.provider;
  const id = settings.model;
  if (id === 'auto') return null;
  const list = provider === 'ollama' ? state.models.ollama
    : provider === 'openrouter' ? state.models.openrouter
    : provider === 'gemini' ? state.models.gemini
    : [...state.models.ollama, ...state.models.gemini, ...state.models.openrouter];
  return list.find((m) => m.id === id) || null;
}

/** Blocks sending an image to a text-only model before anything leaves the app. */
function visionGuard() {
  if (!state.attachments.length) return true;
  const info = currentModelInfo();
  if (settings.provider === 'auto' || !info) return true;   // resolver picks a vision model
  if (info.vision) return true;
  showNotice(
    "Selected model doesn't support image understanding. Choose a vision model.",
    'warn',
    { label: 'Choose model', action: openModelPicker }
  );
  return false;
}

async function send(text) {
  if (state.stream) return;
  const value = (text !== undefined ? text : dom.input.value).trim();
  const images = state.attachments.map((a) => a.dataUrl);
  if (!value && !images.length) return;
  if (!visionGuard()) return;

  hideNotice();
  if (!state.current) newChat({ silent: true });

  const userMsg = makeMessage('user', { text: value, images });
  state.current.messages.push(userMsg);
  appendMessage(userMsg);

  dom.input.value = '';
  autoGrow();
  clearAttachments();
  autoTitle();
  updateSendButton();
  state.stickToBottom = true;

  await runCompletion();
}

/** Streams one assistant turn for the current message list. */
async function runCompletion() {
  const chat = state.current;                      // the turn belongs to THIS chat,
  const assistant = makeMessage('assistant', { text: '', pending: true });
  chat.messages.push(assistant);
  const node = appendMessage(assistant);
  const body = node.querySelector('.md');
  const caret = el('span', { class: 'caret' });
  body.append(caret);

  const controller = new AbortController();
  let buffer = '';
  let reasoningBuffer = '';
  let lastPaint = 0;
  let paintTimer = null;
  let reasoningNode = null;

  const paint = () => {
    paintTimer = null;
    lastPaint = Date.now();
    if (state.current !== chat) return;            // user moved on; stop touching the DOM
    if (settings.markdown) body.innerHTML = renderMarkdown(buffer);
    else body.textContent = buffer;
    body.append(caret);
    scrollToBottom();
  };

  const schedulePaint = () => {
    if (paintTimer) return;
    const wait = Math.max(0, 70 - (Date.now() - lastPaint));
    paintTimer = setTimeout(paint, wait);
  };

  state.stream = { controller, assistant, node, stop: () => controller.abort() };
  setGenerating(true);

  const handlers = {
    onMeta: (meta) => {
      assistant.provider = meta.provider;
      assistant.model = meta.model;
      assistant.note = meta.note || null;
      const head = node.querySelector('.msg-head');
      if (head) {
        head.replaceChildren();
        const badge = el('span', { class: 'badge' });
        badge.append(el('span', { class: 'dot', dataset: { state: meta.provider === 'ollama' ? 'local' : 'cloud' } }));
        badge.append(document.createTextNode(String(meta.model).split('/').pop()));
        head.append(badge);
        if (meta.trimmed) head.append(el('span', { class: 'muted', title: 'Older messages were left out to fit the context window' }, 'context trimmed'));
        if (meta.note) head.append(el('span', { class: 'muted' }, meta.note));
        if (settings.webSearch) {
          const n = assistant.sources?.length || 0;
          head.append(el('span', { class: 'muted', title: (assistant.sources || []).map((s) => s.title).join('\n') },
            n ? `searched the web · ${n} source${n === 1 ? '' : 's'}` : 'web search found nothing'));
        }
      }
      updateFooterProvider(meta);
    },
    onDelta: (chunk) => { buffer += chunk; schedulePaint(); },
    onReasoning: (chunk) => {
      reasoningBuffer += chunk;
      if (!reasoningNode) {
        reasoningNode = buildReasoning('');
        body.parentElement.insertBefore(reasoningNode, body);
      }
      reasoningNode.querySelector('.reasoning-body').textContent = reasoningBuffer;
    },
    onDone: (info) => {
      if (info?.model) assistant.model = info.model;
      assistant.usage = info?.usage || null;
      assistant.finishReason = info?.finishReason || null;
    },
    onError: (err) => {
      assistant.error = {
        title: err.error || 'Request failed',
        detail: err.detail || (err.code === 'MODEL_NO_VISION' ? '' : 'No further detail was provided.'),
        code: err.code,
      };
    },
  };

  let searchResults = [];
  if (settings.webSearch) {
    const lastUser = [...chat.messages].reverse().find((m) => m.role === 'user' && m.text);
    if (lastUser) {
      const head = node.querySelector('.msg-head');
      if (head) head.append(el('span', { class: 'muted' }, 'searching the web…'));
      searchResults = await searchWikipedia(lastUser.text);
      assistant.sources = searchResults.map(({ title, url }) => ({ title, url }));
    }
  }

  try {
    await Providers.chat({
      provider: settings.provider,
      model: settings.model,
      messages: toApiMessages(chat.messages.filter((m) => m.id !== assistant.id), searchResults),
      temperature: settings.temperature,
      maxTokens: settings.maxTokens,
      stream: settings.streaming,
      freeOnly: settings.freeOnly,
      allowPaid: settings.allowPaid,
      contextLimit: settings.contextLimit,
    }, handlers, controller.signal);
  } catch (err) {
    if (!controller.signal.aborted) {
      assistant.error = { title: 'Request failed', detail: err.message || String(err) };
    }
  }

  if (paintTimer) clearTimeout(paintTimer);
  assistant.text = buffer;
  assistant.reasoning = reasoningBuffer || null;
  assistant.pending = false;
  if (controller.signal.aborted && !assistant.text && !assistant.error) {
    assistant.text = '_Stopped._';
  }
  if (!assistant.text && !assistant.error) {
    assistant.error = {
      title: 'Empty response',
      detail: 'The model returned nothing. Try again, or pick a different model.',
    };
  }

  state.stream = null;
  setGenerating(false);
  // the user may have switched chats while this was streaming
  if (state.current === chat) {
    replaceMessageNode(assistant);
    scrollToBottom();
  }
  autoTitle(chat);
  persistChat(chat);
}

function stopGeneration() {
  if (state.stream) state.stream.stop();
}

async function regenerate(messageId) {
  if (state.stream) return;
  const messages = state.current?.messages || [];
  const index = messages.findIndex((m) => m.id === messageId);
  if (index === -1) return;
  // drop the target assistant turn and everything after it
  state.current.messages = messages.slice(0, index);
  renderMessages();
  await runCompletion();
}

function startEdit(messageId) {
  const messages = state.current?.messages || [];
  const index = messages.findIndex((m) => m.id === messageId);
  if (index === -1) return;
  const msg = messages[index];
  dom.input.value = msg.text;
  autoGrow();
  dom.input.focus();
  state.current.messages = messages.slice(0, index);
  renderMessages();
  updateSendButton();
  toast('Edit your message, then press Enter to resend.');
}

function setGenerating(on) {
  dom.sendBtn.hidden = on;
  dom.stopBtn.hidden = !on;
  dom.input.setAttribute('aria-busy', on ? 'true' : 'false');
}

/* ────────────────────────────────────────────────────────────── composer */

function autoGrow() {
  const ta = dom.input;
  if (!ta.value) { ta.style.height = ''; return; }   // empty: let the single-row CSS height stand
  ta.style.height = 'auto';
  ta.style.height = Math.min(ta.scrollHeight, 220) + 'px';
}

function updateSendButton() {
  dom.sendBtn.disabled = !dom.input.value.trim() && !state.attachments.length;
}

dom.input.addEventListener('input', () => { autoGrow(); updateSendButton(); });

dom.input.addEventListener('keydown', (e) => {
  const isEnter = e.key === 'Enter';
  if (!isEnter) return;
  if (e.isComposing) return;
  if (settings.enterToSend) {
    if (e.shiftKey) return;                       // newline
    e.preventDefault();
    dom.composer.requestSubmit();
  } else if (e.metaKey || e.ctrlKey) {
    e.preventDefault();
    dom.composer.requestSubmit();
  }
});

dom.composer.addEventListener('submit', (e) => { e.preventDefault(); send(); });
dom.stopBtn.addEventListener('click', stopGeneration);

/* ─────────────────────────────────────────────────────── image handling */

const QUALITY_TIERS = {
  auto: { max: 1400, q: 0.85 },
  high: { max: 2048, q: 0.92 },
  balanced: { max: 1280, q: 0.85 },
  low: { max: 800, q: 0.7 },
};

const loadImage = (src) => new Promise((resolve, reject) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = () => reject(new Error('Could not read that image'));
  img.src = src;
});

const readFile = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = () => reject(new Error('Could not read that file'));
  reader.readAsDataURL(file);
});

/** Resize/recompress so a 4K screenshot doesn't become a 12 MB request. */
async function optimizeImage(dataUrl, mime) {
  if (mime === 'image/gif') return { dataUrl, note: 'GIF' };          // keep animation intact
  const tier = QUALITY_TIERS[settings.imageQuality] || QUALITY_TIERS.balanced;
  let img;
  try { img = await loadImage(dataUrl); } catch { return { dataUrl }; }

  const approxBytes = Math.ceil(dataUrl.length * 0.75);
  const scale = Math.min(1, tier.max / Math.max(img.width, img.height));
  if (scale === 1 && approxBytes < 500 * 1024) return { dataUrl, width: img.width, height: img.height };

  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const canvas = el('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = '#ffffff';                                          // JPEG has no alpha
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);

  let out;
  try { out = canvas.toDataURL('image/jpeg', tier.q); } catch { return { dataUrl, width: img.width, height: img.height }; }
  const useOptimised = out.length < dataUrl.length || scale < 1;
  return { dataUrl: useOptimised ? out : dataUrl, width: w, height: h };
}

async function addImageFiles(files) {
  const list = Array.from(files || []).filter((f) => /^image\/(png|jpeg|jpg|webp|gif)$/i.test(f.type));
  if (!list.length) {
    if (files?.length) toast('Only PNG, JPG, WEBP and GIF images are supported.', 'err');
    return;
  }
  for (const file of list.slice(0, 6)) {
    if (state.attachments.length >= 6) { toast('Up to 6 images per message.'); break; }
    if (file.size > 20 * 1024 * 1024) { toast(`${file.name} is larger than 20 MB.`, 'err'); continue; }
    try {
      const raw = await readFile(file);
      const optimised = await optimizeImage(raw, file.type);
      state.attachments.push({
        id: uid(), dataUrl: optimised.dataUrl, name: file.name,
        kind: optimised.note || (optimised.width ? `${optimised.width}×${optimised.height}` : 'image'),
      });
    } catch (err) {
      toast(err.message || 'Could not attach that image.', 'err');
    }
  }
  renderAttachments();
  checkVisionHint();
}

function renderAttachments() {
  const box = dom.attachments;
  box.replaceChildren();
  box.hidden = state.attachments.length === 0;
  for (const att of state.attachments) {
    const item = el('div', { class: 'attach-item', title: att.name });
    item.append(el('img', { src: att.dataUrl, alt: att.name, onclick: () => lightbox(att.dataUrl) }));
    const remove = el('button', { class: 'remove', type: 'button', 'aria-label': `Remove ${att.name}` });
    remove.append(icon('x', 'ico'));
    remove.addEventListener('click', () => {
      state.attachments = state.attachments.filter((a) => a.id !== att.id);
      renderAttachments();
      updateSendButton();
      checkVisionHint();
    });
    item.append(remove);
    if (att.kind) item.append(el('span', { class: 'tag' }, att.kind));
    box.append(item);
  }
  updateSendButton();
}

function clearAttachments() {
  state.attachments = [];
  renderAttachments();
  hideNotice();
}

/** Warn as soon as an image is attached to a text-only model. */
function checkVisionHint() {
  if (!state.attachments.length) return hideNotice();
  const info = currentModelInfo();
  if (settings.provider !== 'auto' && info && !info.vision) {
    showNotice("Selected model doesn't support image understanding. Choose a vision model.", 'warn',
      { label: 'Choose model', action: openModelPicker });
  } else {
    hideNotice();
  }
}

$('#attachBtn').addEventListener('click', () => dom.fileInput.click());
dom.fileInput.addEventListener('change', () => { addImageFiles(dom.fileInput.files); dom.fileInput.value = ''; });

/* paste images straight from the clipboard */
dom.input.addEventListener('paste', (e) => {
  const files = Array.from(e.clipboardData?.files || []);
  if (files.length) { e.preventDefault(); addImageFiles(files); }
});

/* drag and drop anywhere over the chat area */
let dragDepth = 0;
window.addEventListener('dragenter', (e) => {
  if (!e.dataTransfer?.types?.includes('Files')) return;
  dragDepth++;
  dom.dropOverlay.hidden = false;
});
window.addEventListener('dragover', (e) => { if (!dom.dropOverlay.hidden) e.preventDefault(); });
window.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) dom.dropOverlay.hidden = true; });
window.addEventListener('drop', (e) => {
  if (!e.dataTransfer?.files?.length) return;
  e.preventDefault();
  dragDepth = 0;
  dom.dropOverlay.hidden = true;
  addImageFiles(e.dataTransfer.files);
});

/* ───────────────────────────────────────────────────────────── screenshot */

async function takeScreenshot() {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    showNotice("Screenshot capture isn't available in this browser. Upload a screenshot instead.", 'warn',
      { label: 'Upload image', action: () => dom.fileInput.click() });
    return;
  }
  let stream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 1 },
      audio: false,
      preferCurrentTab: false,
    });
  } catch (err) {
    if (err?.name === 'NotAllowedError') return;                       // user cancelled the picker
    showNotice("Screenshot capture isn't available in this browser. Upload a screenshot instead.", 'warn',
      { label: 'Upload image', action: () => dom.fileInput.click() });
    return;
  }

  try {
    const video = el('video', { autoplay: true, muted: true, playsinline: true });
    video.srcObject = stream;
    await video.play();
    await new Promise((resolve) => {
      if (video.readyState >= 2 && video.videoWidth) return resolve();
      video.onloadeddata = resolve;
      setTimeout(resolve, 900);
    });
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

    const canvas = el('canvas');
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    video.pause();
    video.srcObject = null;

    const raw = canvas.toDataURL('image/png');
    const optimised = await optimizeImage(raw, 'image/png');
    state.attachments.push({
      id: uid(), dataUrl: optimised.dataUrl, name: 'screenshot.png',
      kind: optimised.width ? `${optimised.width}×${optimised.height}` : 'screenshot',
    });
    renderAttachments();
    checkVisionHint();
    dom.input.focus();
    toast('Screenshot attached');
  } catch (err) {
    toast('Could not capture the screen.', 'err');
  } finally {
    stream.getTracks().forEach((t) => t.stop());
  }
}

$('#screenshotBtn').addEventListener('click', takeScreenshot);

function syncWebSearchBtn() {
  const btn = $('#webSearchBtn');
  btn.setAttribute('aria-pressed', settings.webSearch ? 'true' : 'false');
  btn.title = settings.webSearch ? 'Web search on (Wikipedia) — click to turn off' : 'Web search off — click to search Wikipedia with each message';
}
$('#webSearchBtn').addEventListener('click', () => {
  settings.webSearch = !settings.webSearch;
  saveSettings();
  syncWebSearchBtn();
  toast(settings.webSearch ? 'Web search on' : 'Web search off');
});
syncWebSearchBtn();

/* ───────────────────────────────────────────────────── composer notices */

function showNotice(text, kind = '', action = null) {
  const box = dom.composerNotice;
  box.className = 'notice ' + kind;
  box.replaceChildren(document.createTextNode(text));
  if (action) {
    box.append(el('button', { class: 'btn small ghost', onclick: action.action }, action.label));
  }
  box.hidden = false;
}
function hideNotice() { dom.composerNotice.hidden = true; }

/* ─────────────────────────────────────────────────────── small popup menu */

function popupMenu(anchor, items) {
  $$('.menu').forEach((m) => m.remove());
  const menu = el('div', { class: 'menu', role: 'menu' });
  for (const item of items) {
    if (item === '-') { menu.append(el('div', { class: 'menu-sep' })); continue; }
    const btn = el('button', { class: 'menu-item' + (item.danger ? ' danger' : ''), role: 'menuitem', type: 'button' });
    if (item.icon) btn.append(icon(item.icon, 'ico ico-sm'));
    btn.append(document.createTextNode(item.label));
    btn.addEventListener('click', (e) => { e.stopPropagation(); menu.remove(); item.action(); });
    menu.append(btn);
  }
  document.body.append(menu);
  const rect = anchor.getBoundingClientRect();
  const width = menu.offsetWidth;
  menu.style.left = Math.min(rect.left, window.innerWidth - width - 10) + 'px';
  const top = rect.bottom + 6;
  menu.style.top = (top + menu.offsetHeight > window.innerHeight - 10 ? rect.top - menu.offsetHeight - 6 : top) + 'px';

  const close = (e) => {
    if (menu.contains(e.target)) return;
    menu.remove();
    document.removeEventListener('mousedown', close);
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => { if (e.key === 'Escape') close({ target: document.body }); };
  setTimeout(() => {
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
  }, 0);
}

/* ──────────────────────────────────────────────────────────────── sidebar */

async function refreshSidebar() {
  try {
    state.chats = await Store.list();
  } catch {
    state.chats = [];
  }
  renderSidebar();
}

function renderSidebar() {
  const list = dom.chatList;
  list.replaceChildren();

  if (!state.chats.length) {
    list.append(el('p', { class: 'empty-history' }, 'No chats yet.\nStart one below.'));
    return;
  }

  let currentGroup = null;
  for (const chat of state.chats) {
    const group = fmtDayGroup(chat.updatedAt || chat.createdAt || Date.now());
    if (group !== currentGroup) {
      currentGroup = group;
      list.append(el('div', { class: 'chat-group-label' }, group));
    }

    const active = state.current?.id === chat.id;
    const item = el('div', {
      class: 'chat-item' + (active ? ' active' : ''),
      dataset: { id: chat.id },
      tabindex: '0',
      role: 'button',
      title: chat.title,
    });
    item.append(el('span', { class: 'chat-item-title' }, chat.title || 'New chat'));

    const actions = el('div', { class: 'chat-item-actions' });
    const more = iconButton('drag', 'Chat options', (btn) => {
      popupMenu(btn, [
        { label: 'Rename', icon: 'edit', action: () => renameInline(item, chat) },
        { label: 'Duplicate', icon: 'copy', action: () => duplicateChat(chat.id) },
        { label: 'Export as Markdown', icon: 'download', action: () => exportChat(chat.id, 'md') },
        { label: 'Export as JSON', icon: 'download', action: () => exportChat(chat.id, 'json') },
        { label: 'Export as text', icon: 'download', action: () => exportChat(chat.id, 'txt') },
        '-',
        { label: 'Delete', icon: 'trash', danger: true, action: () => deleteChat(chat.id, chat.title) },
      ]);
    });
    actions.append(more);
    item.append(actions);

    item.addEventListener('click', (e) => {
      if (e.target.closest('.chat-item-actions') || e.target.closest('input')) return;
      loadChat(chat.id);
    });
    item.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); loadChat(chat.id); }
    });
    list.append(item);
  }
}

function renameInline(item, chat) {
  const titleEl = item.querySelector('.chat-item-title');
  const input = el('input', { class: 'rename', value: chat.title || '', 'aria-label': 'Chat name' });
  titleEl.replaceWith(input);
  input.focus(); input.select();

  const commit = async (save) => {
    const value = input.value.trim();
    input.replaceWith(titleEl);
    if (!save || !value || value === chat.title) return;
    const full = await Store.get(chat.id);
    if (!full) return;
    full.title = value.slice(0, 200);
    await Store.save(full);
    if (state.current?.id === chat.id) {
      state.current.title = full.title;
      dom.chatTitle.textContent = full.title;
    }
    refreshSidebar();
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commit(true); }
    if (e.key === 'Escape') { e.preventDefault(); commit(false); }
  });
  input.addEventListener('blur', () => commit(true));
}

async function duplicateChat(id) {
  const chat = await Store.get(id);
  if (!chat) return;
  const copy = {
    ...chat,
    id: uid(),
    title: (chat.title || 'Chat') + ' (copy)',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: chat.messages.map((m) => ({ ...m, id: uid() })),
  };
  await Store.save(copy);
  await refreshSidebar();
  toast('Chat duplicated');
}

async function deleteChat(id, title) {
  const ok = await confirmDialog('Delete chat?', `"${title || 'This chat'}" will be permanently removed.`, 'Delete');
  if (!ok) return;
  await Store.remove(id);
  if (state.current?.id === id) newChat({ silent: true });
  await refreshSidebar();
  toast('Chat deleted');
}

/* ───────────────────────────────────────────────────────────────── export */

function chatToMarkdown(chat) {
  const lines = [`# ${chat.title || 'Chat'}`, '', `_Exported from DonetClassroom · ${new Date(chat.updatedAt || Date.now()).toLocaleString()}_`, ''];
  for (const m of chat.messages || []) {
    if (m.role === 'user') {
      lines.push('## You', '');
      if (m.images?.length) lines.push(`_[${m.images.length} image${m.images.length === 1 ? '' : 's'} attached]_`, '');
      lines.push(m.text || '', '');
    } else {
      lines.push(`## DonetClassroom${m.model ? ` · ${m.model}` : ''}`, '');
      lines.push(m.error ? `> ${m.error.title}` : m.text || '', '');
    }
  }
  return lines.join('\n');
}

function chatToText(chat) {
  const lines = [chat.title || 'Chat', '='.repeat((chat.title || 'Chat').length), ''];
  for (const m of chat.messages || []) {
    lines.push(m.role === 'user' ? 'YOU:' : `AI${m.model ? ` (${m.model})` : ''}:`);
    if (m.images?.length) lines.push(`[${m.images.length} image(s) attached]`);
    lines.push(m.error ? m.error.title : m.text || '', '');
  }
  return lines.join('\n');
}

async function exportChat(id, format) {
  const chat = await Store.get(id);
  if (!chat) return toast('Chat not found.', 'err');
  const safeName = (chat.title || 'chat').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 50) || 'chat';
  if (format === 'json') download(`${safeName}.json`, JSON.stringify(chat, null, 2), 'application/json');
  else if (format === 'md') download(`${safeName}.md`, chatToMarkdown(chat), 'text/markdown');
  else download(`${safeName}.txt`, chatToText(chat), 'text/plain');
  toast('Exported');
}

async function exportAll() {
  const chats = await Store.all();
  if (!chats.length) return toast('There are no chats to export.');
  download(`donetclassroom-chats-${new Date().toISOString().slice(0, 10)}.json`,
    JSON.stringify({ app: 'DonetClassroom', version: 1, exportedAt: Date.now(), chats }, null, 2));
  toast(`Exported ${chats.length} chat${chats.length === 1 ? '' : 's'}`);
}

function importChatsFromFile() {
  const picker = el('input', { type: 'file', accept: 'application/json,.json' });
  picker.addEventListener('change', async () => {
    const file = picker.files?.[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const chats = Array.isArray(data) ? data : data.chats;
      if (!Array.isArray(chats)) throw new Error('That file does not contain chats.');
      const n = await Store.importChats(chats);
      await refreshSidebar();
      toast(`Imported ${n} chat${n === 1 ? '' : 's'}`, 'ok');
    } catch (err) {
      toast(err.message || 'Could not import that file.', 'err');
    }
  });
  picker.click();
}

/* ───────────────────────────────────────────────────────── search palette */

let deepCache = { at: 0, chats: [] };

function openPalette() {
  const layer = $('#palette');
  layer.hidden = false;
  const input = $('#paletteInput');
  input.value = '';
  renderPaletteResults('');
  setTimeout(() => input.focus(), 20);

  if (Date.now() - deepCache.at > 30000) {
    Store.all().then((chats) => {
      deepCache = { at: Date.now(), chats };
      if (!layer.hidden) renderPaletteResults(input.value);
    }).catch(() => {});
  }
}

function closePalette() { $('#palette').hidden = true; }

function highlightMatch(text, query) {
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return escapeHtml(text.slice(0, 100));
  const start = Math.max(0, idx - 30);
  return (start > 0 ? '…' : '') +
    escapeHtml(text.slice(start, idx)) +
    '<mark>' + escapeHtml(text.slice(idx, idx + query.length)) + '</mark>' +
    escapeHtml(text.slice(idx + query.length, idx + query.length + 60));
}

function renderPaletteResults(query) {
  const box = $('#paletteResults');
  box.replaceChildren();
  const q = query.trim().toLowerCase();

  const rows = [];
  if (!q) {
    for (const chat of state.chats.slice(0, 12)) {
      rows.push({ id: chat.id, title: chat.title, sub: chat.preview || `${chat.messageCount} messages` });
    }
  } else {
    for (const chat of state.chats) {
      if ((chat.title || '').toLowerCase().includes(q)) {
        rows.push({ id: chat.id, title: chat.title, sub: chat.preview || '', match: chat.title });
      }
    }
    for (const chat of deepCache.chats) {
      if (rows.some((r) => r.id === chat.id)) continue;
      const hit = (chat.messages || []).find((m) => (m.text || '').toLowerCase().includes(q));
      if (hit) rows.push({ id: chat.id, title: chat.title, sub: hit.text, match: hit.text });
    }
  }

  if (!rows.length) {
    box.append(el('p', { class: 'p-empty' }, q ? 'No chats matched.' : 'No chats yet.'));
    return;
  }

  rows.slice(0, 40).forEach((row, i) => {
    const btn = el('button', { class: 'p-result' + (i === 0 ? ' sel' : ''), type: 'button', dataset: { id: row.id } });
    btn.append(el('b', {}, row.title || 'New chat'));
    const sub = el('span');
    sub.innerHTML = q && row.match ? highlightMatch(row.match, q) : escapeHtml((row.sub || '').slice(0, 100));
    btn.append(sub);
    btn.addEventListener('click', () => { closePalette(); loadChat(row.id); });
    box.append(btn);
  });
}

$('#paletteInput').addEventListener('input', (e) => renderPaletteResults(e.target.value));
$('#paletteInput').addEventListener('keydown', (e) => {
  const results = $('#paletteResults .p-result');
  const current = results.findIndex((r) => r.classList.contains('sel'));
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    if (!results.length) return;
    const next = e.key === 'ArrowDown'
      ? Math.min(results.length - 1, current + 1)
      : Math.max(0, current - 1);
    results.forEach((r) => r.classList.remove('sel'));
    results[next].classList.add('sel');
    results[next].scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'Enter') {
    e.preventDefault();
    (results[Math.max(0, current)] || {}).click?.();
  } else if (e.key === 'Escape') {
    closePalette();
  }
});
$('#palette').addEventListener('click', (e) => { if (e.target.id === 'palette') closePalette(); });

/* ───────────────────────────────────────────────────────── model picker */

let modelFilter = 'all';

const FAST_HINTS = ['flash', 'mini', 'lite', 'small', 'instant', 'nano', 'turbo', 'haiku', '1b', '2b', '3b', '4b', '0.5b', '1.5b', '7b', '8b'];
const looksFast = (m) => {
  if (m.provider === 'ollama') {
    const p = parseFloat(m.parameterSize) || 0;
    return p > 0 ? p <= 4000 || /^\d+(\.\d+)?M$/.test(m.parameterSize || '') : FAST_HINTS.some((h) => m.id.toLowerCase().includes(h));
  }
  return FAST_HINTS.some((h) => m.id.toLowerCase().includes(h));
};

function passesFilter(m) {
  if (modelFilter === 'free') return m.free;
  if (modelFilter === 'vision') return m.vision;
  if (modelFilter === 'reasoning') return m.reasoning || /think|reason|r1|o[1-4]\b/i.test(m.id);
  if (modelFilter === 'fast') return looksFast(m);
  return true;
}

function openModelPicker() {
  $('#modelPopover').hidden = false;
  syncModelControls();
  renderModelList();
  setTimeout(() => $('#modelSearch').focus(), 30);
  if (!state.models.ollama.length && !state.models.openrouter.length && !state.models.gemini.length) refreshModels();
}
function closeModelPicker() { $('#modelPopover').hidden = true; }

function syncModelControls() {
  $$('#modelPopover .seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.provider === settings.provider));
  $$('#modelFilters .chip').forEach((b) => b.classList.toggle('active', b.dataset.filter === modelFilter));
}

function modelRow(m, { isAuto = false } = {}) {
  const selected = isAuto
    ? settings.model === 'auto' && settings.provider === (m?.providerScope || settings.provider)
    : settings.model === m.id;

  const row = el('button', { class: 'model-row' + (selected ? ' active' : ''), type: 'button', role: 'option', 'aria-selected': selected ? 'true' : 'false' });
  const main = el('div', { class: 'mr-main' });

  if (isAuto) {
    main.append(el('div', { class: 'mr-name' }, 'Auto — pick the best available'));
    const meta = el('div', { class: 'mr-meta' });
    meta.append(el('span', { class: 'tag free' }, 'always free-first'));
    main.append(meta);
    row.append(main, icon('check', 'ico ico-sm mr-check'));
    row.addEventListener('click', () => { setModel(m?.providerScope || 'auto', 'auto'); });
    return row;
  }

  main.append(el('div', { class: 'mr-name' }, m.name || m.id));
  const meta = el('div', { class: 'mr-meta' });
  meta.append(el('span', { class: 'tag ' + (m.free ? 'free' : 'paid') }, m.free ? 'free' : 'paid'));
  if (m.vision) meta.append(el('span', { class: 'tag vision' }, 'vision'));
  if (m.reasoning) meta.append(el('span', { class: 'tag' }, 'reasoning'));
  if (m.context) meta.append(el('span', { class: 'tag' }, `${Math.round(m.context / 1000)}k ctx`));
  if (m.parameterSize) meta.append(el('span', { class: 'tag' }, m.parameterSize));
  if (m.sizeBytes) meta.append(el('span', { class: 'tag' }, fmtBytes(m.sizeBytes)));
  main.append(meta);

  row.append(main, icon('check', 'ico ico-sm mr-check'));
  row.addEventListener('click', () => selectModel(m));
  return row;
}

async function selectModel(m) {
  if (!m.free) {
    if (settings.freeOnly) {
      toast('Free-only mode is on — paid models are blocked. Turn it off in Settings to select this.', 'err');
      return;
    }
    if (!settings.allowPaid) {
      toast('Enable "Allow paid models" in Settings first.', 'err');
      return;
    }
    const ok = await confirmDialog(
      'Use a paid model?',
      `${m.name || m.id} charges ${m.pricing?.prompt} per prompt token and ${m.pricing?.completion} per completion token. ` +
      'This will spend real money on your OpenRouter account.',
      'Use paid model'
    );
    if (!ok) return;
  }
  setModel(m.provider, m.id);
}

function setModel(provider, model) {
  settings.provider = provider;
  settings.model = model;
  saveSettings();
  syncModelControls();
  renderModelList();
  updateModelButton();
  checkVisionHint();
  closeModelPicker();
}

function renderModelList() {
  const box = $('#modelList');
  box.replaceChildren();
  const query = $('#modelSearch').value.trim().toLowerCase();
  const provider = settings.provider;
  const note = $('#modelFootNote');

  const matches = (m) => passesFilter(m) && (!query || (m.id + ' ' + (m.name || '')).toLowerCase().includes(query));

  if (provider === 'auto') {
    box.append(el('div', { class: 'model-group' }, 'Automatic'));
    box.append(modelRow({ providerScope: 'auto' }, { isAuto: true }));
    box.append(el('p', { class: 'model-empty', style: 'text-align:left;padding:6px 10px 12px' },
      'Auto prefers your local Ollama model, switches to a free cloud model when local is unavailable, and picks a vision model when you attach an image.'));
  }

  if (provider === 'auto' || provider === 'ollama') {
    const local = state.models.ollama.filter(matches);
    box.append(el('div', { class: 'model-group' }, [icon('cpu', 'ico ico-sm'), 'Local — Ollama']));
    if (provider === 'ollama') box.append(modelRow({ providerScope: 'ollama' }, { isAuto: true }));
    if (!state.models.ollama.length) {
      const msg = state.models.errors?.ollama
        ? 'Local AI offline. Start Ollama, then Refresh.'
        : 'No local models found.\nInstall a model with Ollama, then click Refresh.';
      box.append(el('p', { class: 'model-empty' }, msg));
    } else if (!local.length) {
      box.append(el('p', { class: 'model-empty' }, 'No local models match this filter.'));
    } else {
      for (const m of local) box.append(modelRow(m));
    }
  }

  if (provider === 'auto' || provider === 'gemini') {
    const gem = (state.models.gemini || []).filter(matches);
    box.append(el('div', { class: 'model-group' }, [icon('cloud', 'ico ico-sm'), 'Cloud — Google Gemini']));
    if (provider === 'gemini') box.append(modelRow({ providerScope: 'gemini' }, { isAuto: true }));
    if (state.models.errors?.gemini) {
      box.append(el('p', { class: 'model-empty' }, state.models.errors.gemini + '.\nOpen Settings → Cloud to add one.'));
    } else if (!gem.length) {
      box.append(el('p', { class: 'model-empty' }, 'No Gemini models match this filter.'));
    } else {
      for (const m of gem) box.append(modelRow(m));
    }
  }

  if (provider === 'auto' || provider === 'openrouter') {
    const cloud = state.models.openrouter.filter(matches);
    const free = cloud.filter((m) => m.free);
    const paid = cloud.filter((m) => !m.free);
    box.append(el('div', { class: 'model-group' }, [icon('cloud', 'ico ico-sm'), 'Free cloud — OpenRouter']));
    if (provider === 'openrouter') box.append(modelRow({ providerScope: 'openrouter' }, { isAuto: true }));

    if (state.models.errors?.openrouter) {
      box.append(el('p', { class: 'model-empty' }, state.models.errors.openrouter));
    } else if (!free.length) {
      box.append(el('p', { class: 'model-empty' }, 'No free models match this filter right now.'));
    } else {
      for (const m of free.slice(0, 120)) box.append(modelRow(m));
    }

    if (!settings.freeOnly && paid.length) {
      box.append(el('div', { class: 'model-group' }, 'Paid — needs confirmation'));
      for (const m of paid.slice(0, 60)) box.append(modelRow(m));
    }
  }

  const freeCount = state.models.openrouter.filter((m) => m.free).length;
  note.textContent = settings.freeOnly
    ? `Free-only ON · ${freeCount} free cloud model${freeCount === 1 ? '' : 's'} right now`
    : `Free-only OFF · ${freeCount} free of ${state.models.openrouter.length}`;
}

async function refreshModels({ force = false } = {}) {
  const btn = $('#refreshModelsBtn');
  btn.disabled = true;
  try {
    state.models = await Providers.models({ refresh: force });
  } catch {
    toast('Could not refresh models.', 'err');
  } finally {
    btn.disabled = false;
  }
  renderModelList();
  updateModelButton();
  return state.models;
}

$('#modelBtn').addEventListener('click', openModelPicker);
$('#providerPill').addEventListener('click', openModelPicker);
$('#modelCloseBtn').addEventListener('click', closeModelPicker);
$('#modelPopover').addEventListener('click', (e) => { if (e.target.id === 'modelPopover') closeModelPicker(); });
$('#modelSearch').addEventListener('input', renderModelList);
$('#refreshModelsBtn').addEventListener('click', () => refreshModels({ force: true }));
$$('#modelPopover .seg-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    settings.provider = btn.dataset.provider;
    if (settings.provider !== 'auto') {
      const list = settings.provider === 'ollama' ? state.models.ollama
        : settings.provider === 'gemini' ? state.models.gemini
        : state.models.openrouter;
      if (!list.some((m) => m.id === settings.model)) settings.model = 'auto';
    } else {
      settings.model = 'auto';
    }
    saveSettings();
    syncModelControls();
    renderModelList();
    updateModelButton();
    checkVisionHint();
  });
});
$$('#modelFilters .chip').forEach((chip) => {
  chip.addEventListener('click', () => { modelFilter = chip.dataset.filter; syncModelControls(); renderModelList(); });
});

/* ─────────────────────────────────────────────────────────────── status */

function modelShortName() {
  if (settings.model === 'auto') {
    return settings.provider === 'ollama' ? 'Auto · Local'
      : settings.provider === 'openrouter' ? 'Auto · Cloud'
      : 'Auto';
  }
  return String(settings.model).split('/').pop();
}

function activeDotState() {
  const s = state.status;
  if (!s) return 'checking';
  if (settings.provider === 'ollama') return s.ollama?.online ? 'local' : 'offline';
  if (settings.provider === 'openrouter') return s.openrouter?.configured ? 'cloud' : 'offline';
  if (s.ollama?.online) return 'local';
  if (s.openrouter?.configured) return 'cloud';
  return 'offline';
}

function updateModelButton() {
  const dotState = activeDotState();
  dom.modelBtnText.textContent = modelShortName();
  dom.modelDot.dataset.state = dotState;
  dom.pillText.textContent = modelShortName();
  dom.pillDot.dataset.state = dotState;
}

function updateFooterProvider(meta) {
  if (!meta) return;
  const bits = [meta.provider === 'ollama' ? '● LOCAL' : '● CLOUD', String(meta.model).split('/').pop()];
  if (meta.free) bits.push('free');
  dom.footProvider.textContent = bits.join(' · ');
}

async function refreshStatus() {
  try {
    state.status = await Providers.status();
  } catch {
    state.status = { ollama: { online: false }, openrouter: { configured: false }, gemini: { configured: false } };
  }
  const s = state.status;
  const dotState = activeDotState();
  dom.statusDot.dataset.state = dotState;

  /* Honour an explicit provider choice; only fall back to precedence on Auto. */
  const chosen = settings.provider;
  const showLocal = chosen === 'ollama' || (chosen === 'auto' && s.ollama?.online);
  const showGemini = chosen === 'gemini' || (chosen === 'auto' && !s.ollama?.online && s.gemini?.configured);
  const showOR = chosen === 'openrouter' || (chosen === 'auto' && !s.ollama?.online && !s.gemini?.configured && s.openrouter?.configured);

  if (showLocal && s.ollama?.online) {
    dom.statusLabel.textContent = 'Local Ollama';
    dom.statusSub.textContent = `${s.ollama.modelCount || 0} model${s.ollama.modelCount === 1 ? '' : 's'} · private`;
  } else if (showLocal) {
    dom.statusLabel.textContent = 'Local AI offline';
    dom.statusSub.textContent = s.ollama?.error || 'Start Ollama, then refresh';
  } else if (showGemini) {
    dom.statusLabel.textContent = 'Google Gemini';
    dom.statusSub.textContent = !s.gemini?.configured ? 'No API key saved'
      : s.gemini.ok === false ? (s.gemini.error || 'Key problem')
      : 'Connected · free tier';
  } else if (showOR) {
    dom.statusLabel.textContent = 'Free cloud';
    dom.statusSub.textContent = !s.openrouter?.configured ? 'No API key saved'
      : s.openrouter.ok === false ? (s.openrouter.error || 'Key problem')
      : 'OpenRouter connected';
  } else {
    dom.statusLabel.textContent = 'No provider yet';
    dom.statusSub.textContent = 'Start Ollama or add a key';
  }

  updateModelButton();

  const zeroProviders = !s.ollama?.online && !s.openrouter?.configured && !s.gemini?.configured;
  if (zeroProviders) {
    showNotice('No AI provider is available yet. Start Ollama, or add a free Gemini key.', 'warn',
      { label: 'Set up', action: () => openSettings('cloud') });
  }
  dom.footProvider.textContent = (showLocal && s.ollama?.online) ? '● LOCAL · runs on your Mac · $0'
    : showGemini ? '● CLOUD · Google Gemini · free tier'
    : showOR ? '● CLOUD · free models only'
    : s.ollama?.online ? '● LOCAL · runs on your Mac · $0'
    : '○ OFFLINE · no provider available';
}

/* ────────────────────────────────────────────────────────────── settings */

const RECOMMENDED = [
  { tier: 'FAST', blurb: 'Small model, best for older hardware.', models: [
    { name: 'qwen2.5:0.5b', size: '~400 MB', ram: '2 GB+', note: 'Tiny. Instant replies, basic reasoning.' },
    { name: 'llama3.2:1b', size: '~1.3 GB', ram: '4 GB+', note: 'Good all-round tiny model.' },
    { name: 'qwen2.5:1.5b', size: '~1 GB', ram: '4 GB+', note: 'Stronger than its size suggests.' },
  ] },
  { tier: 'BALANCED', blurb: 'Better reasoning but slower.', models: [
    { name: 'llama3.2:3b', size: '~2 GB', ram: '8 GB+', note: 'Solid default if you have the RAM.' },
    { name: 'qwen2.5:3b', size: '~1.9 GB', ram: '8 GB+', note: 'Strong at code and structured output.' },
    { name: 'phi3:mini', size: '~2.2 GB', ram: '8 GB+', note: 'Compact reasoning model.' },
  ] },
  { tier: 'VISION', blurb: 'Model capable of understanding images.', models: [
    { name: 'moondream', size: '~1.7 GB', ram: '4 GB+', note: 'Smallest practical vision model.' },
    { name: 'llava:7b', size: '~4.7 GB', ram: '8 GB+', note: 'Classic image understanding model.' },
    { name: 'llama3.2-vision:11b', size: '~7.9 GB', ram: '16 GB+', note: 'Best quality, needs real RAM.' },
  ] },
  { tier: 'ADVANCED', blurb: 'Large model, only recommended when enough RAM is available.', models: [
    { name: 'qwen2.5:7b', size: '~4.7 GB', ram: '16 GB+', note: 'Noticeably smarter, noticeably slower.' },
    { name: 'llama3.1:8b', size: '~4.9 GB', ram: '16 GB+', note: 'General purpose workhorse.' },
  ] },
];

const SHORTCUT_KEYS = [
  [`${MOD} K`, 'Search chats'],
  [`${MOD} N`, 'New chat'],
  [`${MOD} /`, 'Focus the composer'],
  [`${MOD} B`, 'Toggle the sidebar'],
  ['Escape', 'Stop generating / close dialogs'],
  [`${MOD} ⇧ S`, 'Take a screenshot'],
  [`${MOD} ⇧ U`, 'Upload an image'],
  ['Enter', 'Send message'],
  ['Shift Enter', 'New line'],
];

function setRow(label, hint, control, opts = {}) {
  const row = el('div', { class: 'set-row' + (opts.stack ? ' stack' : '') });
  const main = el('div', { class: 'set-main' });
  main.append(el('div', { class: 'set-label' }, label));
  if (hint) main.append(el('div', { class: 'set-hint' }, hint));
  row.append(main);
  if (control) row.append(opts.stack ? control : el('div', { class: 'set-control' }, control));
  return row;
}

function switchControl(checked, onChange) {
  const wrap = el('label', { class: 'switch' });
  const input = el('input', { type: 'checkbox', checked: checked ? true : undefined });
  input.addEventListener('change', () => onChange(input.checked, input));
  wrap.append(input, el('span', { class: 'track' }));
  return wrap;
}

function selectControl(options, value, onChange) {
  const sel = el('select');
  for (const [val, label] of options) {
    sel.append(el('option', { value: val, selected: String(val) === String(value) ? true : undefined }, label));
  }
  sel.addEventListener('change', () => onChange(sel.value));
  return sel;
}

function group(title, ...rows) {
  const g = el('div', { class: 'set-group' });
  if (title) g.append(el('h3', {}, title));
  for (const row of rows.flat()) if (row) g.append(row);
  return g;
}

function openSettings(tab = 'ai') {
  $('#settingsModal').hidden = false;
  showSettingsTab(tab);
}
function closeSettings() { $('#settingsModal').hidden = true; }

function showSettingsTab(tab) {
  $$('#settingsNav .s-nav').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  const pane = $('#settingsPanes');
  pane.replaceChildren(buildSettingsPane(tab));
  pane.scrollTop = 0;
}

function buildSettingsPane(tab) {
  const frag = document.createDocumentFragment();

  if (tab === 'ai') {
    frag.append(group('Provider & model',
      setRow('Provider', 'Auto prefers local, then free cloud.',
        selectControl([['auto', 'Auto'], ['ollama', 'Local — Ollama'], ['gemini', 'Cloud — Google Gemini'], ['openrouter', 'Cloud — OpenRouter']], settings.provider, (v) => {
          settings.provider = v; settings.model = 'auto'; saveSettings(); updateModelButton(); showSettingsTab('ai');
        })),
      setRow('Model', modelShortName(),
        el('button', { class: 'btn ghost small', onclick: () => { closeSettings(); openModelPicker(); } }, 'Choose model')),
    ));

    const tempValue = el('span', { class: 'mono' }, String(settings.temperature));
    const tempInput = el('input', { type: 'range', min: '0', max: '2', step: '0.1', value: String(settings.temperature) });
    tempInput.addEventListener('input', () => {
      settings.temperature = Number(tempInput.value);
      tempValue.textContent = tempInput.value;
      saveSettings();
    });

    const maxTokens = el('input', { type: 'number', min: '64', max: '32000', step: '64', value: String(settings.maxTokens) });
    maxTokens.addEventListener('change', () => {
      settings.maxTokens = clamp(Number(maxTokens.value) || 2048, 64, 32000);
      maxTokens.value = String(settings.maxTokens);
      saveSettings();
    });

    frag.append(group('Generation',
      setRow('Temperature', 'Lower is more focused, higher is more creative.', el('div', { class: 'row gap' }, tempInput, tempValue)),
      setRow('Max tokens', 'Upper limit on the length of each reply.', maxTokens),
      setRow('Stream responses', 'Show text as it is generated.', switchControl(settings.streaming, (v) => { settings.streaming = v; saveSettings(); })),
      setRow('Context length', 'Automatic uses the model’s own window and trims the oldest turns.',
        selectControl([['auto', 'Automatic'], [4096, '4k'], [8192, '8k'], [16384, '16k'], [32768, '32k']], settings.contextLimit, (v) => {
          settings.contextLimit = v === 'auto' ? 'auto' : Number(v); saveSettings();
        })),
    ));

    const paidRow = setRow('Allow paid models', 'Off by default. Paid models always need a second confirmation.',
      switchControl(settings.allowPaid, async (v, input) => {
        if (v) {
          const ok = await confirmDialog('Allow paid models?',
            'DonetClassroom will let you select models that charge your OpenRouter account. You will still be asked to confirm each paid model.',
            'Allow');
          if (!ok) { input.checked = false; return; }
          settings.freeOnly = false;
        }
        settings.allowPaid = v;
        saveSettings();
        showSettingsTab('ai');
      }));

    frag.append(group('Zero-cost protection',
      setRow('Only use free models', 'Blocks any model that currently has non-zero pricing. Prices are read live from the provider.',
        switchControl(settings.freeOnly, async (v, input) => {
          if (!v) {
            const ok = await confirmDialog('Turn off free-only mode?',
              'Paid models could then be selected, which can cost real money on your OpenRouter account. Paid models still require a separate confirmation.',
              'Turn off');
            if (!ok) { input.checked = true; return; }
          } else {
            settings.allowPaid = false;
          }
          settings.freeOnly = v;
          saveSettings();
          renderModelList();
          showSettingsTab('ai');
        })),
      paidRow,
      el('div', { class: 'callout' + (settings.freeOnly ? '' : ' warn') },
        settings.freeOnly
          ? 'Protection is ON. Local models are always free. Cloud models are checked against live pricing before every request.'
          : 'Protection is OFF. Paid models can be selected and will spend money on your OpenRouter account.'),
    ));

    const sysPrompt = el('textarea', { class: 'field', rows: '5' });
    sysPrompt.value = settings.systemPrompt;
    sysPrompt.addEventListener('change', () => { settings.systemPrompt = sysPrompt.value; saveSettings(); });
    frag.append(group('Advanced',
      setRow('System prompt', 'Sent at the start of every conversation.', sysPrompt, { stack: true }),
      el('div', { class: 'row end gap mt' },
        el('button', { class: 'btn ghost small', onclick: () => { settings.systemPrompt = DEFAULT_SYSTEM_PROMPT; saveSettings(); showSettingsTab('ai'); } }, 'Reset to default')),
    ));
  }

  if (tab === 'local') {
    const online = state.status?.ollama?.online;
    const statusLine = el('div', { class: 'status-line' },
      el('span', { class: 'dot', dataset: { state: online ? 'local' : 'offline' } }),
      el('span', {}, online
        ? `Connected · ${state.status.ollama.modelCount || 0} model(s) installed`
        : 'Local AI offline'));

    const endpoint = el('input', { type: 'url', value: STANDALONE ? settings.ollamaUrl : (state.serverConfig?.ollamaUrl || settings.ollamaUrl) });
    if (!STANDALONE) { endpoint.disabled = true; endpoint.title = 'Set OLLAMA_URL in your .env file'; }
    endpoint.addEventListener('change', () => {
      settings.ollamaUrl = endpoint.value.trim().replace(/\/+$/, '') || 'http://localhost:11434';
      saveSettings(); refreshStatus(); refreshModels({ force: true });
    });

    frag.append(group('Connection',
      setRow('Ollama endpoint', STANDALONE ? 'Where your local Ollama daemon listens.' : 'Configured by OLLAMA_URL in .env.', endpoint, { stack: true }),
      statusLine,
      el('div', { class: 'row gap' },
        el('button', { class: 'btn ghost small', onclick: async (e) => { e.target.disabled = true; await refreshStatus(); await refreshModels({ force: true }); e.target.disabled = false; showSettingsTab('local'); } }, 'Test connection'),
        el('button', { class: 'btn ghost small', onclick: async () => { await refreshModels({ force: true }); showSettingsTab('local'); toast('Models refreshed'); } }, 'Refresh models')),
      online ? null : el('div', { class: 'callout mt' },
        'Start Ollama, then test again:\n1. Install — brew install ollama (or ollama.com/download)\n2. Start — ollama serve\n3. Add a model — ollama pull qwen2.5:0.5b'),
    ));

    const installed = new Set(state.models.ollama.map((m) => m.id));
    const recBox = el('div', {});
    for (const tier of (state.serverConfig?.recommendedModels || RECOMMENDED)) {
      const section = el('div', { class: 'rec-tier' });
      section.append(el('h4', {}, tier.tier));
      section.append(el('p', { class: 'blurb' }, tier.blurb));
      for (const m of tier.models) {
        // exact tag match only — qwen2.5:0.5b being present does not mean qwen2.5:7b is
        const isInstalled = installed.has(m.name) || installed.has(m.name + ':latest');
        const row = el('div', { class: 'rec-model' + (isInstalled ? ' installed' : '') });
        const main = el('div', { class: 'rm-main' });
        main.append(el('div', { class: 'rm-name' }, m.name));
        main.append(el('div', { class: 'rm-note' }, `${m.note} · needs ${m.ram} RAM`));
        row.append(main);
        row.append(el('span', { class: 'rm-size' }, m.size));
        row.append(el('button', {
          class: 'btn ghost small',
          title: 'Copy the install command',
          onclick: async (e) => { if (await copyText(`ollama pull ${m.name}`)) { e.target.textContent = 'Copied'; setTimeout(() => { e.target.textContent = isInstalled ? 'Installed' : 'Copy'; }, 1200); } },
        }, isInstalled ? 'Installed' : 'Copy'));
        section.append(row);
      }
      recBox.append(section);
    }

    frag.append(group('Recommended local models',
      el('div', { class: 'callout warn' },
        'Local speed depends heavily on your RAM and CPU. On an older Mac (for example a 2014 Mac mini) start with a FAST model — larger models may run, but slowly. DonetClassroom never downloads a model for you; copy the command and run it yourself.'),
      recBox));
  }

  if (tab === 'cloud') {
    const or = state.status?.openrouter || {};
    const statusLine = el('div', { class: 'status-line' },
      el('span', { class: 'dot', dataset: { state: or.ok ? 'cloud' : 'offline' } }),
      el('span', {}, or.ok ? `Connected${or.label ? ' · ' + or.label : ''}` : (or.error || 'Not connected')));

    if (STANDALONE) {
      const gm = state.status?.gemini || {};
      const gStatus = el('div', { class: 'status-line' },
        el('span', { class: 'dot', dataset: { state: gm.ok ? 'cloud' : 'offline' } }),
        el('span', {}, gm.ok ? `Connected${gm.label ? ' · ' + gm.label : ''}` : (gm.error || 'Not connected')));

      const gKeyInput = el('input', { type: 'password', value: settings.geminiKey || '',
        placeholder: 'AIza… or AQ.…', autocomplete: 'off', spellcheck: 'false' });
      gKeyInput.addEventListener('change', () => {
        settings.geminiKey = gKeyInput.value.trim();
        saveSettings();
        refreshStatus();
      });

      frag.append(group('Google Gemini',
        setRow('API key', 'Create one free at aistudio.google.com/apikey', gKeyInput, { stack: true }),
        el('div', { class: 'callout' },
          'Gemini has a free tier with generous limits. It is served from generativelanguage.googleapis.com, a different domain to OpenRouter — useful when one of them is blocked on your network.'),
        gStatus,
        el('div', { class: 'row gap' },
          el('button', { class: 'btn ghost small', onclick: async (e) => {
            e.target.disabled = true;
            await refreshStatus();
            e.target.disabled = false;
            showSettingsTab('cloud');
          } }, 'Test connection'),
          el('button', { class: 'btn ghost small', onclick: () => {
            settings.geminiKey = '';
            LS.del('donet.session.geminiKey');
            saveSettings();
            refreshStatus();
            showSettingsTab('cloud');
            toast('Gemini key cleared');
          } }, 'Clear key')),
      ));

      const keyInput = el('input', { type: 'password', value: settings.apiKey || '', placeholder: 'sk-or-v1-…', autocomplete: 'off', spellcheck: 'false' });
      keyInput.addEventListener('change', () => { settings.apiKey = keyInput.value.trim(); saveSettings(); refreshStatus(); });
      frag.append(group('OpenRouter',
        setRow('API key', 'Create one free at openrouter.ai/keys', keyInput, { stack: true }),
        setRow('Remember API key', 'Stores the key in this browser’s localStorage.',
          switchControl(settings.rememberKey, (v) => { settings.rememberKey = v; saveSettings(); })),
        el('div', { class: 'callout warn' },
          'Browser-only API keys can be exposed to anyone who has access to this browser or source code. For private use, this is acceptable; for public deployment, use a backend.'),
        statusLine,
        el('div', { class: 'row gap' },
          el('button', { class: 'btn ghost small', onclick: async (e) => { e.target.disabled = true; await refreshStatus(); e.target.disabled = false; showSettingsTab('cloud'); } }, 'Test connection'),
          el('button', { class: 'btn ghost small', onclick: () => { settings.apiKey = ''; settings.rememberKey = false; LS.del('donet.session.key'); saveSettings(); refreshStatus(); showSettingsTab('cloud'); toast('API key cleared'); } }, 'Clear key')),
      ));
    } else {
      const gm = state.status?.gemini || {};
      frag.append(group('Google Gemini',
        el('div', { class: 'callout' },
          state.serverConfig?.hasGeminiKey
            ? 'A Gemini key is loaded from your .env file. It stays on the server and is never sent to this page.'
            : 'No Gemini key configured.\n\n1. Create a free key at aistudio.google.com/apikey\n2. Put GEMINI_API_KEY=… in your .env file\n3. Restart DonetClassroom'),
        el('div', { class: 'status-line' },
          el('span', { class: 'dot', dataset: { state: gm.ok ? 'cloud' : 'offline' } }),
          el('span', {}, gm.ok ? 'Connected' : (gm.error || 'Not connected'))),
      ));
      frag.append(group('OpenRouter',
        el('div', { class: 'callout' },
          state.serverConfig?.hasOpenRouterKey
            ? 'An API key is loaded from your .env file. It stays on the server and is never sent to this page.'
            : 'No API key configured.\n\n1. Create a free key at openrouter.ai/keys\n2. Put OPENROUTER_API_KEY=… in your .env file\n3. Restart DonetClassroom'),
        statusLine,
        el('div', { class: 'row gap' },
          el('button', { class: 'btn ghost small', onclick: async (e) => { e.target.disabled = true; await refreshStatus(); e.target.disabled = false; showSettingsTab('cloud'); } }, 'Test connection')),
      ));
    }

    frag.append(group('Free-model protection',
      el('div', { class: 'callout' },
        'DonetClassroom reads live pricing from OpenRouter and treats a model as free only when every price it reports is zero. Free-model availability and rate limits are set by the provider and can change at any time.'),
      setRow('Only use free models', 'Same switch as the AI tab — repeated here because it protects your wallet.',
        switchControl(settings.freeOnly, async (v, input) => {
          if (!v) {
            const ok = await confirmDialog('Turn off free-only mode?', 'Paid models could then be selected, which can cost real money.', 'Turn off');
            if (!ok) { input.checked = true; return; }
          }
          settings.freeOnly = v; if (v) settings.allowPaid = false; saveSettings(); renderModelList();
        })),
    ));
  }

  if (tab === 'appearance') {
    frag.append(group('Theme',
      setRow('Black level', 'DonetClassroom is designed for OLED black. No bright themes.',
        selectControl([['oled', 'OLED Black (default)'], ['pure', 'Pure Black'], ['dim', 'Dim Black']], settings.theme, (v) => {
          settings.theme = v; document.documentElement.dataset.theme = v; saveSettings();
        })),
      setRow('Show timestamps', 'Display the time next to each message.',
        switchControl(settings.showTimestamps, (v) => { settings.showTimestamps = v; saveSettings(); renderMessages(); })),
    ));
    frag.append(group('Images',
      setRow('Image quality', 'Images are resized before sending. Lower uses less bandwidth and fewer tokens.',
        selectControl([['auto', 'Auto'], ['high', 'High'], ['balanced', 'Balanced (default)'], ['low', 'Low']], settings.imageQuality, (v) => {
          settings.imageQuality = v; saveSettings();
        })),
    ));
  }

  if (tab === 'chat') {
    frag.append(group('Composing',
      setRow('Enter to send', 'When off, use ' + MOD + ' Enter to send and Enter for a new line.',
        switchControl(settings.enterToSend, (v) => { settings.enterToSend = v; saveSettings(); })),
      setRow('Auto-generate titles', 'Names each chat from your first message. Costs nothing — it is done locally.',
        switchControl(settings.autoTitle, (v) => { settings.autoTitle = v; saveSettings(); })),
    ));
    frag.append(group('Rendering',
      setRow('Render markdown', 'Headings, lists, tables and code blocks.',
        switchControl(settings.markdown, (v) => { settings.markdown = v; saveSettings(); renderMessages(); })),
      setRow('Wrap long code lines', 'Wrap instead of scrolling code blocks sideways.',
        switchControl(settings.wrapCode, (v) => { settings.wrapCode = v; saveSettings(); renderMessages(); })),
    ));
  }

  if (tab === 'data') {
    frag.append(group('Your conversations',
      el('div', { class: 'callout' }, STANDALONE
        ? 'Chats are stored in this browser only (localStorage). Clearing site data deletes them.'
        : 'Chats are stored as plain JSON files in data/chats on this machine. Nothing is uploaded.'),
      setRow('Export all chats', 'Download every conversation as one JSON file.',
        el('button', { class: 'btn ghost small', onclick: exportAll }, 'Export')),
      setRow('Import chats', 'Load a previously exported JSON file.',
        el('button', { class: 'btn ghost small', onclick: importChatsFromFile }, 'Import')),
      setRow('Delete all chats', 'Permanently removes every conversation.',
        el('button', { class: 'btn danger small', onclick: async () => {
          const ok = await confirmDialog('Delete all chats?', 'Every conversation will be permanently removed. This cannot be undone.', 'Delete all');
          if (!ok) return;
          await Store.clear(); newChat({ silent: true }); await refreshSidebar(); toast('All chats deleted');
        } }, 'Delete all')),
    ));
    frag.append(group('Keys & local data',
      setRow('Clear API keys', STANDALONE ? 'Removes the OpenRouter and Gemini keys from this browser.' : 'The key lives in your .env file — edit that file to change it.',
        el('button', { class: 'btn ghost small', disabled: !STANDALONE ? true : undefined, onclick: () => {
          settings.apiKey = ''; settings.geminiKey = ''; settings.rememberKey = false; LS.del('donet.session.key'); LS.del('donet.session.geminiKey'); saveSettings(); refreshStatus(); toast('API keys cleared');
        } }, 'Clear keys')),
      setRow('Reset settings', 'Restores defaults. Chats are not touched.',
        el('button', { class: 'btn ghost small', onclick: async () => {
          const ok = await confirmDialog('Reset settings?', 'All preferences return to their defaults.', 'Reset');
          if (!ok) return;
          Object.assign(settings, DEFAULT_SETTINGS);
          saveSettings(); applyTheme(); updateModelButton(); showSettingsTab('data'); toast('Settings reset');
        } }, 'Reset')),
      storageWorks ? null : el('div', { class: 'callout warn' }, 'This browser is blocking local storage, so settings and chats will not survive a reload.'),
    ));
  }

  if (tab === 'keys') {
    const list = el('div', {});
    for (const [key, label] of SHORTCUT_KEYS) {
      const row = el('div', { class: 'set-row' });
      row.append(el('div', { class: 'set-main' }, el('div', { class: 'set-label' }, label)));
      row.append(el('div', { class: 'set-control' }, el('span', { class: 'mono' }, key)));
      list.append(row);
    }
    frag.append(group('Keyboard shortcuts', list));
  }

  if (tab === 'about') {
    frag.append(group('DonetClassroom',
      el('div', { class: 'callout' },
        'A private AI classroom. Local first through Ollama, free cloud models through OpenRouter, and a hard stop in front of anything that costs money.'),
      setRow('Version', '2.0.0 · ' + (STANDALONE ? 'single-file build' : 'server build'), null),
      setRow('Privacy', 'No analytics, no telemetry, no tracking. Ratings on messages stay on this device.', null),
      setRow('Web search', 'Searches Wikipedia (free, no key) with each message and gives the model the top results to cite. Your message text is sent to wikipedia.org.',
        switchControl(settings.webSearch, (v) => { settings.webSearch = v; saveSettings(); syncWebSearchBtn(); })),
    ));
  }

  return frag;
}

$('#settingsBtn').addEventListener('click', () => openSettings('ai'));
$('#settingsCloseBtn').addEventListener('click', closeSettings);
$('#settingsModal').addEventListener('click', (e) => { if (e.target.id === 'settingsModal') closeSettings(); });
$$('#settingsNav .s-nav').forEach((btn) => btn.addEventListener('click', () => showSettingsTab(btn.dataset.tab)));
$('#statusRow').addEventListener('click', () => openSettings(state.status?.ollama?.online ? 'ai' : 'local'));

function applyTheme() { document.documentElement.dataset.theme = settings.theme || 'oled'; }

/* ────────────────────────────────────────────────────────────── shortcuts */

const MAX_SHORTCUTS = 4;
const DEFAULT_SHORTCUTS = [
  { name: 'Google', url: 'https://google.com' },
  { name: 'YouTube', url: 'https://youtube.com' },
  { name: 'GitHub', url: 'https://github.com' },
  { name: 'Wikipedia', url: 'https://wikipedia.org' },
];

function loadShortcuts() {
  let list = LS.get('donet.shortcuts', null);
  if (!Array.isArray(list)) {
    list = DEFAULT_SHORTCUTS.map((s) => ({ id: uid(), ...s, icon: { type: 'favicon', value: '' }, enabled: true, reference: false }));
    LS.set('donet.shortcuts', list);
  }
  return list.slice(0, MAX_SHORTCUTS);
}
function saveShortcuts(list) { LS.set('donet.shortcuts', list.slice(0, MAX_SHORTCUTS)); }

/** Only ever open http(s). Anything else (javascript:, data:) is rejected. */
function normalizeUrl(raw) {
  let value = String(raw || '').trim();
  if (!value) return null;
  if (!/^[a-z][\w+.-]*:/i.test(value)) value = 'https://' + value;
  let url;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  return url.href;
}

function shortcutIconNode(sc) {
  const box = el('span', { class: 'sc-icon' });
  const icon0 = sc.icon || {};
  const letter = (sc.name || '?').trim().charAt(0).toUpperCase() || '?';

  if (icon0.type === 'emoji' && icon0.value) { box.textContent = icon0.value; return box; }
  if (icon0.type === 'image' && String(icon0.value || '').startsWith('data:image/')) {
    box.append(el('img', { src: icon0.value, alt: '' }));
    return box;
  }
  const url = normalizeUrl(sc.url);
  if (url) {
    // The site's own favicon — no third-party lookup service is contacted.
    const img = el('img', { src: new URL('/favicon.ico', url).href, alt: '', loading: 'lazy' });
    img.addEventListener('error', () => { img.remove(); box.textContent = letter; });
    box.append(img);
    return box;
  }
  box.textContent = letter;
  return box;
}

function renderShortcutGrid() {
  const grid = dom.fabGrid;
  grid.replaceChildren();
  const list = loadShortcuts().filter((s) => s.enabled !== false && normalizeUrl(s.url));
  if (!list.length) {
    grid.append(el('p', { class: 'fab-empty' }, 'No shortcuts yet.'));
    return;
  }
  for (const sc of list) {
    const link = el('a', {
      class: 'fab-link', href: normalizeUrl(sc.url), target: '_blank', rel: 'noopener noreferrer',
      title: sc.name + ' — ' + normalizeUrl(sc.url),
    });
    link.append(shortcutIconNode(sc));
    link.append(el('span', {}, sc.name || 'Link'));
    grid.append(link);
  }
}

function toggleFab(force) {
  const panel = dom.fabPanel;
  const open = force !== undefined ? force : panel.hidden;
  panel.hidden = !open;
  dom.fabBtn.classList.toggle('open', open);
  if (open) renderShortcutGrid();
}

dom.fabBtn.addEventListener('click', () => toggleFab());
$('#fabBtnMobile').addEventListener('click', () => toggleFab());
$('#fabEditBtn').addEventListener('click', () => { toggleFab(false); openShortcutEditor(); });
document.addEventListener('click', (e) => {
  if (dom.fabPanel.hidden) return;
  if (dom.fabPanel.contains(e.target) || dom.fabBtn.contains(e.target) || e.target.closest('#fabBtnMobile')) return;
  toggleFab(false);
});

function openShortcutEditor() { $('#shortcutModal').hidden = false; renderShortcutEditor(); }
function closeShortcutEditor() { $('#shortcutModal').hidden = true; renderShortcutGrid(); }

function renderShortcutEditor() {
  const box = $('#shortcutEditor');
  const list = loadShortcuts();
  box.replaceChildren();

  list.forEach((sc, index) => {
    const row = el('div', { class: 'sc-row', draggable: 'true', dataset: { index: String(index) } });

    const handle = el('span', { class: 'handle', title: 'Drag to reorder' });
    handle.append(icon('drag', 'ico ico-sm'));
    row.append(handle);

    const iconBtn = el('button', { class: 'sc-icon-pick', type: 'button', title: 'Change icon' });
    iconBtn.append(shortcutIconNode(sc));
    iconBtn.addEventListener('click', () => pickShortcutIcon(sc, list, iconBtn));
    row.append(iconBtn);

    const fields = el('div', { class: 'sc-fields' });
    const nameInput = el('input', { type: 'text', value: sc.name || '', placeholder: 'Name', 'aria-label': 'Shortcut name' });
    const urlInput = el('input', { type: 'url', value: sc.url || '', placeholder: 'https://example.com', 'aria-label': 'Shortcut URL' });
    nameInput.addEventListener('change', () => { sc.name = nameInput.value.slice(0, 24); saveShortcuts(list); renderShortcutEditor(); });
    urlInput.addEventListener('change', () => {
      const normalized = normalizeUrl(urlInput.value);
      if (!normalized) { toast('That link is not a valid http(s) URL.', 'err'); urlInput.value = sc.url || ''; return; }
      sc.url = normalized; saveShortcuts(list); renderShortcutEditor();
    });
    fields.append(nameInput, urlInput);
    row.append(fields);

    row.append(iconButton('trash', 'Delete shortcut', () => {
      const next = list.filter((s) => s.id !== sc.id);
      saveShortcuts(next); renderShortcutEditor();
    }));

    const opts = el('div', { class: 'sc-opts' });
    const enabled = el('label', {});
    const enabledBox = el('input', { type: 'checkbox', checked: sc.enabled !== false ? true : undefined });
    enabledBox.addEventListener('change', () => { sc.enabled = enabledBox.checked; saveShortcuts(list); });
    enabled.append(enabledBox, document.createTextNode('Enabled'));

    const ref = el('label', { title: 'Mentions this site to the model as a source you use. DonetClassroom does not read the page.' });
    const refBox = el('input', { type: 'checkbox', checked: sc.reference ? true : undefined });
    refBox.addEventListener('change', () => { sc.reference = refBox.checked; saveShortcuts(list); });
    ref.append(refBox, document.createTextNode('Use as AI reference'));

    opts.append(enabled, ref);

    const wrapper = el('div', {});
    wrapper.append(row, opts);
    box.append(wrapper);

    row.addEventListener('dragstart', (e) => { row.classList.add('dragging'); e.dataTransfer.setData('text/plain', String(index)); });
    row.addEventListener('dragend', () => row.classList.remove('dragging'));
    row.addEventListener('dragover', (e) => e.preventDefault());
    row.addEventListener('drop', (e) => {
      e.preventDefault();
      const from = Number(e.dataTransfer.getData('text/plain'));
      const to = index;
      if (Number.isNaN(from) || from === to) return;
      const moved = list.splice(from, 1)[0];
      list.splice(to, 0, moved);
      saveShortcuts(list);
      renderShortcutEditor();
    });
  });

  $('#addShortcutBtn').disabled = list.length >= MAX_SHORTCUTS;
  const limit = $('#shortcutEditor').parentElement.querySelector('.sc-limit');
  if (limit) limit.remove();
  $('#addShortcutBtn').insertAdjacentElement('afterend',
    el('p', { class: 'sc-limit mt' }, `${list.length} of ${MAX_SHORTCUTS} shortcuts used`));
}

function pickShortcutIcon(sc, list, anchor) {
  popupMenu(anchor || document.body, [
    { label: 'Use site favicon', icon: 'globe', action: () => { sc.icon = { type: 'favicon', value: '' }; saveShortcuts(list); renderShortcutEditor(); } },
    { label: 'Use an emoji', icon: 'sparkle', action: () => {
      const value = prompt('Enter one emoji or character:', sc.icon?.type === 'emoji' ? sc.icon.value : '📚');
      if (value === null) return;
      sc.icon = { type: 'emoji', value: Array.from(value.trim())[0] || '' };
      saveShortcuts(list); renderShortcutEditor();
    } },
    { label: 'Upload an image', icon: 'paperclip', action: () => {
      const picker = el('input', { type: 'file', accept: 'image/*' });
      picker.addEventListener('change', async () => {
        const file = picker.files?.[0];
        if (!file) return;
        try {
          const raw = await readFile(file);
          const img = await loadImage(raw);
          const canvas = el('canvas'); canvas.width = 64; canvas.height = 64;
          canvas.getContext('2d').drawImage(img, 0, 0, 64, 64);
          sc.icon = { type: 'image', value: canvas.toDataURL('image/png') };
          saveShortcuts(list); renderShortcutEditor();
        } catch { toast('Could not read that image.', 'err'); }
      });
      picker.click();
    } },
    { label: 'Default letter icon', icon: 'grid', action: () => { sc.icon = { type: 'letter', value: '' }; saveShortcuts(list); renderShortcutEditor(); } },
  ]);
}

$('#addShortcutBtn').addEventListener('click', () => {
  const list = loadShortcuts();
  if (list.length >= MAX_SHORTCUTS) return toast(`Maximum ${MAX_SHORTCUTS} shortcuts.`);
  list.push({ id: uid(), name: 'New link', url: 'https://', icon: { type: 'favicon', value: '' }, enabled: true, reference: false });
  saveShortcuts(list);
  renderShortcutEditor();
});
$('#shortcutsBtn').addEventListener('click', openShortcutEditor);
$('#shortcutCloseBtn').addEventListener('click', closeShortcutEditor);
$('#shortcutModal').addEventListener('click', (e) => { if (e.target.id === 'shortcutModal') closeShortcutEditor(); });

/* ─────────────────────────────────────────────────────────── prompt library */

const DEFAULT_PROMPTS = [
  { id: uid(), name: "Explain Like I'm 10", text: 'Explain this in simple language a 10-year-old could follow, with one everyday example:\n\n' },
  { id: uid(), name: 'Fix My Code', text: 'Find the bug in this code, explain what is wrong, and show the corrected version:\n\n' },
  { id: uid(), name: 'Summarize', text: 'Summarise the following in five bullet points, keeping the key numbers:\n\n' },
  { id: uid(), name: 'Study Mode', text: 'Act as a patient tutor. Ask me one question at a time about this topic, wait for my answer, then correct me:\n\n' },
  { id: uid(), name: 'Brainstorm', text: 'Give me 10 varied ideas for the following, ordered from safest to most ambitious:\n\n' },
  { id: uid(), name: 'Translate', text: 'Translate the following text into natural English, then list any phrases that were hard to translate:\n\n' },
];

const loadPrompts = () => LS.get('donet.prompts', null) || DEFAULT_PROMPTS;
const savePrompts = (list) => LS.set('donet.prompts', list);

function renderPrompts() {
  const box = $('#promptList');
  box.replaceChildren();
  const list = loadPrompts();
  if (!list.length) { box.append(el('p', { class: 'muted small' }, 'No saved prompts yet.')); return; }
  for (const p of list) {
    const item = el('div', { class: 'prompt-item' });
    const main = el('div', { class: 'pi-main', role: 'button', tabindex: '0' });
    main.append(el('div', { class: 'pi-name' }, p.name));
    main.append(el('div', { class: 'pi-text' }, p.text));
    const use = () => {
      $('#promptModal').hidden = true;
      dom.input.value = p.text + dom.input.value;
      autoGrow(); updateSendButton(); dom.input.focus();
      dom.input.setSelectionRange(dom.input.value.length, dom.input.value.length);
    };
    main.addEventListener('click', use);
    main.addEventListener('keydown', (e) => { if (e.key === 'Enter') use(); });
    item.append(main);
    item.append(iconButton('trash', 'Delete prompt', () => {
      savePrompts(loadPrompts().filter((x) => x.id !== p.id));
      renderPrompts();
    }));
    box.append(item);
  }
}

$('#promptsBtn').addEventListener('click', () => { $('#promptModal').hidden = false; renderPrompts(); });
$('#promptCloseBtn').addEventListener('click', () => { $('#promptModal').hidden = true; });
$('#promptModal').addEventListener('click', (e) => { if (e.target.id === 'promptModal') $('#promptModal').hidden = true; });
$('#savePromptBtn').addEventListener('click', () => {
  const name = $('#promptName').value.trim();
  const text = $('#promptText').value.trim();
  if (!name || !text) return toast('Give the prompt a name and some text.', 'err');
  const list = loadPrompts();
  list.push({ id: uid(), name: name.slice(0, 40), text });
  savePrompts(list);
  $('#promptName').value = ''; $('#promptText').value = '';
  renderPrompts();
  toast('Prompt saved', 'ok');
});

/* ──────────────────────────────────────────────────────── first-run wizard */

function openWizard() { $('#wizard').hidden = false; wizardStep1(); }
function closeWizard() {
  $('#wizard').hidden = true;
  settings.onboarded = true;
  saveSettings();
  dom.input.focus();
}

function wizardStep1() {
  const body = $('#wizardBody');
  body.replaceChildren();
  body.append(el('h2', {}, 'Welcome to DonetClassroom'));
  body.append(el('p', { class: 'w-sub' }, 'Your private AI classroom. Choose how you want to use AI — you can change this any time.'));

  const options = el('div', { class: 'w-options' });
  const option = (iconName, title, sub, provider) => {
    const btn = el('button', { class: 'w-option', type: 'button' });
    const box = el('span', { class: 'w-ico' }); box.append(icon(iconName));
    const main = el('span', {});
    main.append(el('b', {}, title), el('span', {}, sub));
    btn.append(box, main);
    btn.addEventListener('click', () => {
      settings.provider = provider; settings.model = 'auto'; saveSettings(); updateModelButton(); wizardStep2();
    });
    return btn;
  };
  options.append(option('cpu', 'Local AI', 'Runs on your Mac with Ollama. Fully private, no internet needed.', 'ollama'));
  options.append(option('cloud', 'Free cloud AI', 'Uses models that currently cost nothing on OpenRouter.', 'openrouter'));
  options.append(option('sparkle', 'Auto', 'Automatically choose the best available option.', 'auto'));
  body.append(options);
  body.append(el('div', { class: 'row end' }, el('button', { class: 'btn ghost small', onclick: closeWizard }, 'Skip')));
}

async function wizardStep2() {
  const body = $('#wizardBody');
  body.replaceChildren();
  body.append(el('h2', {}, 'Checking your setup'));
  body.append(el('p', { class: 'w-sub' }, 'Nothing is downloaded and nothing is sent anywhere during these checks.'));

  const rows = el('div', { class: 'w-check' });
  const mk = (label) => {
    const row = el('div', { class: 'status-line' });
    const dot = el('span', { class: 'dot', dataset: { state: 'checking' } });
    const text = el('span', {}, label + '…');
    row.append(dot, text);
    rows.append(row);
    return { dot, text };
  };
  const localRow = mk('Checking Ollama');
  const cloudRow = mk('Checking OpenRouter');
  const browserRow = mk('Checking browser capabilities');
  body.append(rows);

  const footer = el('div', { class: 'row end gap mt' });
  body.append(footer);

  await refreshStatus();
  const s = state.status || {};

  if (s.ollama?.online) {
    localRow.dot.dataset.state = 'local';
    localRow.text.textContent = `Ollama running · ${s.ollama.modelCount || 0} model(s) installed`;
  } else {
    localRow.dot.dataset.state = 'offline';
    localRow.text.textContent = 'Ollama not detected — start it with: ollama serve';
  }

  const models = await refreshModels({ force: false }).catch(() => state.models);
  const freeCount = (models.openrouter || []).filter((m) => m.free).length;
  if (s.openrouter?.ok) {
    cloudRow.dot.dataset.state = 'cloud';
    cloudRow.text.textContent = `OpenRouter connected · ${freeCount} free model(s) available now`;
  } else if (freeCount) {
    cloudRow.dot.dataset.state = 'offline';
    cloudRow.text.textContent = `No API key yet · ${freeCount} free model(s) would be available`;
  } else {
    cloudRow.dot.dataset.state = 'offline';
    cloudRow.text.textContent = s.openrouter?.error || 'OpenRouter not configured';
  }

  const canCapture = Boolean(navigator.mediaDevices?.getDisplayMedia);
  browserRow.dot.dataset.state = canCapture ? 'local' : 'offline';
  browserRow.text.textContent = canCapture
    ? 'Screenshots, image upload and local storage available'
    : 'Screen capture unavailable — you can still upload images';

  const localCount = (models.ollama || []).length;
  const summary = el('div', { class: 'callout mt' },
    s.ollama?.online && localCount
      ? `Ready to go. Local model "${models.ollama[0].id}" will answer by default — $0, fully private.`
      : s.ollama?.online && !localCount
        ? 'Ollama is running but has no models. Install one: ollama pull qwen2.5:0.5b'
        : s.openrouter?.ok
          ? 'Ready to go with free cloud models. Free availability and rate limits are set by the provider.'
          : 'No provider is ready yet. Start Ollama, or add a free OpenRouter key in Settings → Cloud.');
  body.insertBefore(summary, footer);

  if (!s.ollama?.online) {
    footer.append(el('button', { class: 'btn ghost small', onclick: () => { closeWizard(); openSettings('local'); } }, 'Local AI setup'));
  }
  if (!s.openrouter?.ok) {
    footer.append(el('button', { class: 'btn ghost small', onclick: () => { closeWizard(); openSettings('cloud'); } }, 'Cloud setup'));
  }
  footer.append(el('button', { class: 'btn small', onclick: closeWizard }, 'Start chatting'));
}

/* ───────────────────────────────────────────────────────── layout & misc */

function setSidebar(collapsed) {
  settings.sidebarCollapsed = collapsed;
  saveSettings();
  dom.app.classList.toggle('collapsed', collapsed);
  $('#expandBtn').hidden = !collapsed;
}
function toggleDrawer(open) {
  const isOpen = open !== undefined ? open : !dom.app.classList.contains('drawer-open');
  dom.app.classList.toggle('drawer-open', isOpen);
  $('#scrim').hidden = !isOpen;
}
function closeDrawer() { if (window.innerWidth <= 860) toggleDrawer(false); }

$('#collapseBtn').addEventListener('click', () => setSidebar(true));
$('#expandBtn').addEventListener('click', () => setSidebar(false));
$('#menuBtn').addEventListener('click', () => toggleDrawer());
$('#scrim').addEventListener('click', () => toggleDrawer(false));
$('#newChatBtn').addEventListener('click', () => { newChat(); closeDrawer(); });
$('#searchBtn').addEventListener('click', () => { openPalette(); closeDrawer(); });
$('#brandHome').addEventListener('click', (e) => { e.preventDefault(); newChat(); closeDrawer(); });

function updateTemporaryButton() {
  const btn = $('#tempChatBtn');
  btn.setAttribute('aria-pressed', state.temporary ? 'true' : 'false');
  btn.title = state.temporary ? 'Temporary chat — nothing is saved' : 'Start a temporary chat (not saved)';
}
$('#tempChatBtn').addEventListener('click', () => {
  state.temporary = !state.temporary;
  updateTemporaryButton();
  newChat();
  toast(state.temporary ? 'Temporary chat — this conversation will not be saved.' : 'Back to normal chats.');
});

dom.chatTitle.addEventListener('click', () => {
  if (!state.current) return;
  const value = prompt('Chat name:', state.current.title || 'New chat');
  if (value === null) return;
  state.current.title = value.trim().slice(0, 200) || 'New chat';
  dom.chatTitle.textContent = state.current.title;
  persist();
});

const SUGGESTIONS = [
  ['Explain a concept', 'Explain how HTTPS keeps a connection private, in plain language.'],
  ['Help with code', 'Review this function and tell me what could go wrong:\n\n'],
  ['Study a topic', 'Quiz me on the causes of the French Revolution, one question at a time.'],
  ['Look at an image', 'Attach a screenshot and ask what is wrong with it.'],
];

function renderSuggestions() {
  const box = dom.suggestions;
  box.replaceChildren();
  SUGGESTIONS.forEach(([title, text], i) => {
    const btn = el('button', { class: 'suggestion', type: 'button' });
    btn.append(el('b', {}, title));
    btn.append(el('span', {}, text.split('\n')[0]));
    btn.addEventListener('click', () => {
      if (i === 3) { dom.input.value = 'What is wrong with this screenshot?'; takeScreenshot(); }
      else dom.input.value = text;
      autoGrow(); updateSendButton(); dom.input.focus();
    });
    box.append(btn);
  });
}

/* ───────────────────────────────────────────────────── keyboard shortcuts */

document.addEventListener('keydown', (e) => {
  const mod = MAC ? e.metaKey : e.ctrlKey;
  const key = e.key.toLowerCase();

  if (e.key === 'Escape') {
    if (state.stream) { stopGeneration(); return; }
    const layers = ['#modelPopover', '#palette', '#settingsModal', '#shortcutModal', '#promptModal'];
    for (const sel of layers) {
      const node = $(sel);
      if (node && !node.hidden) { node.hidden = true; return; }
    }
    if (!dom.fabPanel.hidden) { toggleFab(false); return; }
    return;
  }

  if (!mod) return;

  if (e.shiftKey && key === 's') { e.preventDefault(); takeScreenshot(); return; }
  if (e.shiftKey && key === 'u') { e.preventDefault(); dom.fileInput.click(); return; }
  if (e.shiftKey) return;

  if (key === 'k') { e.preventDefault(); openPalette(); }
  else if (key === 'n') { e.preventDefault(); newChat(); }
  else if (key === '/') { e.preventDefault(); dom.input.focus(); }
  else if (key === 'b') { e.preventDefault(); window.innerWidth <= 860 ? toggleDrawer() : setSidebar(!settings.sidebarCollapsed); }
});

/* ───────────────────────────────────────────────────────────────── boot */

async function init() {
  applyTheme();
  setSidebar(Boolean(settings.sidebarCollapsed));
  updateTemporaryButton();
  renderSuggestions();
  renderShortcutGrid();
  autoGrow();
  updateSendButton();
  updateModelButton();

  if (!STANDALONE) {
    try {
      state.serverConfig = await (await fetch('/api/config')).json();
      if (state.serverConfig?.defaultSystemPrompt && settings.systemPrompt === DEFAULT_SYSTEM_PROMPT) {
        settings.systemPrompt = state.serverConfig.defaultSystemPrompt;
      }
    } catch { /* server config is optional */ }
  } else if (IS_FILE) {
    $('#welcomeSub').textContent =
      'Running straight from a file. If a provider cannot be reached, start the tiny local server included with this build.';
  }

  newChat({ silent: true });
  refreshSidebar();
  await refreshStatus();
  refreshModels().then(() => { updateModelButton(); });

  if (!settings.onboarded) openWizard();
  else dom.input.focus();
}

init();

/* expose a tiny surface for debugging without touching internals */
window.DonetClassroom = {
  version: '1.0.0',
  mode: STANDALONE ? 'standalone' : 'server',
  state,
  settings,
  renderMarkdown,
};

})();
