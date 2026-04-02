import { call } from '../../tauri-api.js';
import { showToast } from '../../components/toast.js';

let root = null;

export function init(container) {
  root = container;
  root.innerHTML = '';

  const style = document.createElement('style');
  style.textContent = css();
  root.appendChild(style);

  const wrap = el('div', { class: 'sql-parser-wrap' });

  // Header
  wrap.appendChild(el('h2', { text: 'SQL Table Parser' }));
  wrap.appendChild(el('p', { text: 'Extract table names and dictGet targets from SQL/DAG code' }));

  // Input
  const inputLabel = el('label', { text: 'SQL / Python code:', class: 'sql-label' });
  wrap.appendChild(inputLabel);

  const textarea = document.createElement('textarea');
  textarea.id = 'parser-input';
  textarea.className = 'sql-textarea';
  textarea.placeholder = 'Paste SQL or Python DAG code here...';
  textarea.rows = 12;
  wrap.appendChild(textarea);

  // Buttons row
  const btnRow = el('div', { class: 'sql-btn-row' });
  const parseBtn = el('button', { text: 'Parse Tables' });
  parseBtn.addEventListener('click', onParse);
  btnRow.appendChild(parseBtn);

  const clearBtn = el('button', { text: 'Clear', class: 'btn-secondary' });
  clearBtn.addEventListener('click', () => {
    textarea.value = '';
    document.getElementById('parser-output').textContent = '';
  });
  btnRow.appendChild(clearBtn);

  const copyBtn = el('button', { text: 'Copy Result', class: 'btn-secondary' });
  copyBtn.addEventListener('click', () => {
    const output = document.getElementById('parser-output');
    if (output.textContent) {
      navigator.clipboard.writeText(output.textContent);
      showToast('Copied to clipboard', 'success');
    }
  });
  btnRow.appendChild(copyBtn);
  wrap.appendChild(btnRow);

  // Output
  const outputLabel = el('label', { text: 'Result:', class: 'sql-label' });
  wrap.appendChild(outputLabel);

  const output = el('pre', { id: 'parser-output', class: 'sql-output' });
  wrap.appendChild(output);

  root.appendChild(wrap);
}

async function onParse() {
  const input = document.getElementById('parser-input');
  const output = document.getElementById('parser-output');
  const sql = input.value.trim();
  if (!sql) {
    showToast('Please enter SQL code', 'info');
    return;
  }
  try {
    const result = await call('parse_sql_tables', { sql });
    output.textContent = result || '(no tables found)';
  } catch (e) {
    showToast('Parse error: ' + e, 'error');
  }
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
.sql-parser-wrap {
  display: flex;
  flex-direction: column;
  gap: 8px;
  height: 100%;
}
.sql-label {
  font-weight: 600;
  font-size: 13px;
  color: var(--text-muted);
}
.sql-textarea {
  width: 100%;
  min-height: 150px;
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 13px;
  line-height: 1.5;
  resize: vertical;
}
.sql-btn-row {
  display: flex;
  gap: 8px;
}
.sql-output {
  flex: 1;
  min-height: 100px;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 12px;
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 13px;
  line-height: 1.5;
  overflow: auto;
  white-space: pre-wrap;
  color: var(--text);
  margin: 0;
}
`;
}
