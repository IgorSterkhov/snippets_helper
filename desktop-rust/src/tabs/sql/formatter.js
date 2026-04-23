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
  wrap.appendChild(output);

  root.appendChild(wrap);
}

async function onFormat() {
  const input = document.getElementById('fmt-input').value.trim();
  const output = document.getElementById('fmt-output');
  if (!input) {
    showToast('Please enter SQL', 'info');
    return;
  }

  const keywordsUpper = document.getElementById('kw-upper').checked;
  const alignDdl = document.getElementById('fmt-ddl').checked;

  try {
    let result = input;
    if (alignDdl) {
      const aligned = alignDdlColumns(input);
      if (aligned == null) {
        showToast('DDL alignment: could not detect CREATE TABLE — falling back to normal format', 'info');
      } else {
        result = aligned;
      }
    }
    // Still run the SQL formatter for keyword case, unless DDL-only and user
    // doesn't want more processing. We always run it — it's idempotent on
    // already-formatted DDL and lets keyword case apply to the CREATE line.
    const [formatted, error] = await call('format_sql', { sql: result, keywordsUpper });
    output.textContent = formatted;
    if (error) showToast('Warning: ' + error, 'info');
  } catch (e) {
    showToast('Format error: ' + e, 'error');
  }
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
  padding: 12px; font-family: 'Consolas','Monaco',monospace; font-size: 13px;
  line-height: 1.5; overflow: auto; white-space: pre-wrap; color: var(--text); margin: 0;
}
`;
}
