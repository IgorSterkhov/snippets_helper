import { call } from '../../tauri-api.js';
import { showToast } from '../../components/toast.js';

let root = null;

export function init(container) {
  root = container;
  root.innerHTML = '';

  const style = document.createElement('style');
  style.textContent = css();
  root.appendChild(style);

  const wrap = el('div', { class: 'sql-fmt-wrap' });

  wrap.appendChild(el('h2', { text: 'SQL Formatter' }));
  wrap.appendChild(el('p', { text: 'Format SQL with keyword case conversion (supports Jinja2 templates)' }));

  // Input
  wrap.appendChild(el('label', { text: 'SQL Input:', class: 'sql-label' }));
  const inputTA = document.createElement('textarea');
  inputTA.id = 'fmt-input';
  inputTA.className = 'sql-textarea';
  inputTA.placeholder = 'Paste SQL here...';
  inputTA.rows = 10;
  wrap.appendChild(inputTA);

  // Options row
  const optRow = el('div', { class: 'sql-opt-row' });

  optRow.appendChild(el('label', { text: 'Keywords:', class: 'sql-label' }));

  const upperRadio = document.createElement('input');
  upperRadio.type = 'radio'; upperRadio.name = 'kw-case'; upperRadio.id = 'kw-upper'; upperRadio.value = 'upper';
  upperRadio.checked = true;
  optRow.appendChild(upperRadio);
  optRow.appendChild(el('label', { text: 'UPPER', style: 'cursor:pointer' }));
  optRow.querySelector('label:last-child').setAttribute('for', 'kw-upper');

  const lowerRadio = document.createElement('input');
  lowerRadio.type = 'radio'; lowerRadio.name = 'kw-case'; lowerRadio.id = 'kw-lower'; lowerRadio.value = 'lower';
  optRow.appendChild(lowerRadio);
  const lowerLabel = el('label', { text: 'lower', style: 'cursor:pointer' });
  lowerLabel.setAttribute('for', 'kw-lower');
  optRow.appendChild(lowerLabel);

  // Separator + DDL alignment toggle
  const sep = document.createElement('span');
  sep.style.cssText = 'width:1px;height:16px;background:var(--border);margin:0 10px';
  optRow.appendChild(sep);

  const ddlCb = document.createElement('input');
  ddlCb.type = 'checkbox'; ddlCb.id = 'fmt-ddl';
  optRow.appendChild(ddlCb);
  const ddlLabel = el('label', { text: 'Align DDL columns', style: 'cursor:pointer' });
  ddlLabel.setAttribute('for', 'fmt-ddl');
  ddlLabel.title = 'Tabulate CREATE TABLE columns so name / type / comment line up on fixed vertical columns';
  optRow.appendChild(ddlLabel);

  wrap.appendChild(optRow);

  // Buttons
  const btnRow = el('div', { class: 'sql-btn-row' });

  const fmtBtn = el('button', { text: 'Format SQL' });
  fmtBtn.addEventListener('click', onFormat);
  btnRow.appendChild(fmtBtn);

  const clearBtn = el('button', { text: 'Clear', class: 'btn-secondary' });
  clearBtn.addEventListener('click', () => {
    document.getElementById('fmt-input').value = '';
    document.getElementById('fmt-output').textContent = '';
  });
  btnRow.appendChild(clearBtn);

  const copyBtn = el('button', { text: 'Copy Result', class: 'btn-secondary' });
  copyBtn.addEventListener('click', () => {
    const output = document.getElementById('fmt-output');
    if (output.textContent) {
      navigator.clipboard.writeText(output.textContent);
      showToast('Copied to clipboard', 'success');
    }
  });
  btnRow.appendChild(copyBtn);

  wrap.appendChild(btnRow);

  // Output
  wrap.appendChild(el('label', { text: 'Formatted SQL:', class: 'sql-label' }));
  const output = el('pre', { id: 'fmt-output', class: 'sql-output' });
  const outputCode = document.createElement('code');
  outputCode.id = 'fmt-output-code';
  outputCode.className = 'hljs language-sql';
  output.appendChild(outputCode);
  wrap.appendChild(output);

  root.appendChild(wrap);

  // Kick off highlight.js load in the background — first format will find it ready.
  ensureHighlight().catch(() => {});
}

async function onFormat() {
  const input = document.getElementById('fmt-input').value.trim();
  const outputCode = document.getElementById('fmt-output-code');
  if (!input) {
    showToast('Please enter SQL', 'info');
    return;
  }

  const keywordsUpper = document.getElementById('kw-upper').checked;
  const alignDdl = document.getElementById('fmt-ddl').checked;

  try {
    let finalSql;
    if (alignDdl) {
      const aligned = alignDdlColumns(input);
      if (aligned == null) {
        showToast('DDL alignment: CREATE TABLE not detected — using backend formatter', 'info');
        const [formatted, error] = await call('format_sql', { sql: input, keywordsUpper });
        finalSql = formatted;
        if (error) showToast('Warning: ' + error, 'info');
      } else {
        // Preserve the alignment — backend formatter would flatten it back
        // to a single line. Apply keyword case here instead.
        finalSql = applyKeywordCase(aligned, keywordsUpper);
      }
    } else {
      const [formatted, error] = await call('format_sql', { sql: input, keywordsUpper });
      finalSql = formatted;
      if (error) showToast('Warning: ' + error, 'info');
    }
    await renderHighlighted(outputCode, finalSql);
  } catch (e) {
    showToast('Format error: ' + e, 'error');
  }
}

async function renderHighlighted(codeEl, text) {
  await ensureHighlight();
  codeEl.textContent = text;
  try {
    codeEl.innerHTML = window.hljs.highlight(text, { language: 'sql', ignoreIllegals: true }).value;
  } catch {
    codeEl.textContent = text;
  }
}

// Apply SQL keyword case conversion while preserving string literals, quoted
// identifiers, and comments. Only a well-known list is changed.
const SQL_KEYWORDS = [
  'CREATE','OR','REPLACE','TEMPORARY','TEMP','TABLE','VIEW','MATERIALIZED','INDEX',
  'IF','NOT','EXISTS','COMMENT','DEFAULT','NULL','PRIMARY','KEY','UNIQUE','CONSTRAINT',
  'FOREIGN','REFERENCES','CHECK','ENGINE','CHARSET','COLLATE','AUTO_INCREMENT',
  'SELECT','FROM','WHERE','AND','OR','JOIN','LEFT','RIGHT','INNER','OUTER','FULL',
  'ON','USING','GROUP','BY','ORDER','HAVING','LIMIT','OFFSET',
  'INSERT','INTO','VALUES','UPDATE','SET','DELETE','DROP','ALTER','ADD','COLUMN',
  'CASE','WHEN','THEN','ELSE','END','AS','IN','IS','LIKE','ILIKE','BETWEEN',
  'UNION','INTERSECT','EXCEPT','ALL','DISTINCT','WITH','RECURSIVE','OVER','PARTITION',
  'CAST','COALESCE','ASC','DESC','TRUE','FALSE','BEGIN','COMMIT','ROLLBACK',
  'PRIMARY KEY','FOREIGN KEY',
];

function applyKeywordCase(sql, upper) {
  const transform = w => upper ? w.toUpperCase() : w.toLowerCase();
  // Build a single regex of word-boundaries. Longer phrases first so
  // "PRIMARY KEY" wins over standalone "KEY".
  const sorted = [...SQL_KEYWORDS].sort((a, b) => b.length - a.length);
  const pattern = new RegExp(
    '\\b(?:' + sorted.map(k => k.replace(/\s+/g, '\\s+')).join('|') + ')\\b',
    'gi'
  );
  // Walk segments — skip string/backtick/comment regions so we don't rewrite inside them.
  const segments = tokenizeSqlSegments(sql);
  return segments.map(seg => {
    if (seg.type === 'code') return seg.text.replace(pattern, transform);
    return seg.text;
  }).join('');
}

function tokenizeSqlSegments(s) {
  const out = [];
  let i = 0, codeStart = 0;
  while (i < s.length) {
    const c = s[i];
    const two = s.substr(i, 2);
    let openQuote = null;
    if (c === "'" || c === '"' || c === '`') openQuote = c;
    if (openQuote || two === '--' || two === '/*') {
      if (i > codeStart) out.push({ type: 'code', text: s.slice(codeStart, i) });
      let end;
      if (two === '--') {
        end = s.indexOf('\n', i);
        if (end < 0) end = s.length; else end += 1;
      } else if (two === '/*') {
        end = s.indexOf('*/', i + 2);
        if (end < 0) end = s.length; else end += 2;
      } else {
        end = i + 1;
        while (end < s.length) {
          if (s[end] === '\\') { end += 2; continue; }
          if (s[end] === openQuote) { end += 1; break; }
          end += 1;
        }
      }
      out.push({ type: 'skip', text: s.slice(i, end) });
      i = end;
      codeStart = i;
    } else {
      i++;
    }
  }
  if (codeStart < s.length) out.push({ type: 'code', text: s.slice(codeStart) });
  return out;
}

// ── highlight.js loader (shared with repo-search) ────────────
let _hljsLoaded = false;
async function ensureHighlight() {
  if (_hljsLoaded) return;
  await new Promise((ok, fail) => {
    if (window.hljs) { ok(); return; }
    const s = document.createElement('script');
    s.src = 'lib/highlight/highlight.min.js'; s.onload = ok; s.onerror = fail;
    document.head.appendChild(s);
  });
  if (!document.querySelector('link[href*="highlight/github-dark"]')) {
    const l = document.createElement('link');
    l.rel = 'stylesheet'; l.href = 'lib/highlight/github-dark.min.css';
    document.head.appendChild(l);
  }
  _hljsLoaded = true;
}

/**
 * Align columns inside a CREATE TABLE DDL on fixed vertical columns:
 *   name<pad> type<pad> rest
 * Returns null if the input doesn't look like a CREATE TABLE with a
 * parenthesised column list.
 */
function alignDdlColumns(sql) {
  // Find "CREATE TABLE …name… (" — column list opens at the first '(' after CREATE TABLE.
  const ctRe = /\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:TEMPORARY\s+)?TABLE\b[^\(]*\(/i;
  const m = ctRe.exec(sql);
  if (!m) return null;
  const openIdx = m.index + m[0].length - 1;   // position of '('
  // Find matching close paren, respecting nesting.
  let depth = 0, closeIdx = -1;
  let inStr = null;
  for (let i = openIdx; i < sql.length; i++) {
    const c = sql[i];
    if (inStr) {
      if (c === inStr && sql[i - 1] !== '\\') inStr = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { inStr = c; continue; }
    if (c === '(') depth++;
    else if (c === ')') {
      depth--;
      if (depth === 0) { closeIdx = i; break; }
    }
  }
  if (closeIdx < 0) return null;

  const before = sql.slice(0, openIdx + 1);
  const inner  = sql.slice(openIdx + 1, closeIdx);
  const after  = sql.slice(closeIdx);

  // Split inner on top-level commas (ignore commas inside parens/strings).
  const entries = splitTopLevel(inner, ',').map(s => s.trim()).filter(Boolean);
  if (!entries.length) return null;

  // Tokenise each entry → [name, type, rest]. Skip table-level constraints
  // (PRIMARY KEY, KEY, CONSTRAINT, ...) — leave them verbatim.
  const CONSTRAINT_PREFIXES = /^(primary\s+key|key|unique(\s+key)?|constraint|foreign\s+key|check|index|fulltext|spatial|partition\s+by|order\s+by|pk\s*\()/i;
  const parts = entries.map(e => {
    if (CONSTRAINT_PREFIXES.test(e)) return { kind: 'raw', text: e };
    return { kind: 'col', ...splitColumn(e) };
  });

  // Figure out column widths (only `col` rows contribute).
  const cols = parts.filter(p => p.kind === 'col');
  const nameW = Math.max(0, ...cols.map(c => c.name.length));
  const typeW = Math.max(0, ...cols.map(c => c.type.length));

  const pad = (s, n) => s + ' '.repeat(Math.max(0, n - s.length));
  const lines = parts.map(p => {
    if (p.kind === 'raw') return '    ' + p.text;
    const rest = p.rest ? ' ' + p.rest : '';
    return '    ' + pad(p.name, nameW) + ' ' + pad(p.type, typeW) + rest;
  });

  const reformatted = '\n' + lines.join(',\n') + '\n';
  return before + reformatted + after;
}

function splitTopLevel(s, sep) {
  const out = [];
  let depth = 0, start = 0, inStr = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (c === inStr && s[i - 1] !== '\\') inStr = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { inStr = c; continue; }
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (depth === 0 && c === sep) {
      out.push(s.slice(start, i));
      start = i + 1;
    }
  }
  out.push(s.slice(start));
  return out;
}

function splitColumn(entry) {
  // name  type  rest
  // "type" may include parenthesised params like Decimal(10, 2) or Nullable(Int32).
  const s = entry.trim();
  const m = /^(\S+)\s+(.*)$/.exec(s);
  if (!m) return { name: s, type: '', rest: '' };
  const name = m[1];
  const tail = m[2];

  // Collect type: one or more words until we hit a space (respecting parens).
  let i = 0, depth = 0;
  while (i < tail.length) {
    const c = tail[i];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === ' ' && depth === 0) break;
    i++;
  }
  const type = tail.slice(0, i);
  const rest = tail.slice(i).trim();
  return { name, type, rest };
}

function el(tag, opts = {}) {
  const e = document.createElement(tag);
  if (opts.class) e.className = opts.class;
  if (opts.text) e.textContent = opts.text;
  if (opts.id) e.id = opts.id;
  if (opts.style) e.setAttribute('style', opts.style);
  return e;
}

function css() {
  return `
.sql-fmt-wrap {
  display: flex; flex-direction: column; gap: 8px; height: 100%;
}
.sql-label { font-weight: 600; font-size: 13px; color: var(--text-muted); }
.sql-textarea {
  width: 100%; min-height: 150px;
  font-family: 'Consolas','Monaco',monospace; font-size: 13px; line-height: 1.5; resize: vertical;
}
.sql-btn-row { display: flex; gap: 8px; }
.sql-opt-row { display: flex; align-items: center; gap: 8px; }
.sql-output {
  flex: 1; min-height: 100px;
  background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 6px;
  padding: 12px; font-family: 'Consolas','Monaco','SF Mono',monospace; font-size: 13px;
  line-height: 1.5; overflow: auto; color: var(--text); margin: 0;
}
.sql-output code.hljs {
  background: transparent; padding: 0;
  font-family: inherit; font-size: inherit; line-height: inherit;
  white-space: pre;
}
`;
}
