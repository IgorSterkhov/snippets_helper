import { call } from '../../tauri-api.js';
import { showToast } from '../../components/toast.js';

let root = null;

export function init(container) {
  root = container;
  root.innerHTML = '';

  const style = document.createElement('style');
  style.textContent = css();
  root.appendChild(style);

  const wrap = el('div', { class: 'ss-sql-wrap' });

  wrap.appendChild(el('h2', { text: 'Superset SQL Extractor' }));
  wrap.appendChild(el('p', { text: 'Extract SQL from Superset YAML dataset content' }));

  // YAML content textarea
  const inputLabel = el('label', { text: 'YAML content:', class: 'ss-label' });
  wrap.appendChild(inputLabel);

  const textarea = document.createElement('textarea');
  textarea.id = 'ss-sql-input';
  textarea.className = 'ss-textarea';
  textarea.placeholder = 'Paste Superset dataset YAML content here...';
  textarea.rows = 10;
  wrap.appendChild(textarea);

  // Button row
  const btnRow = el('div', { class: 'ss-btn-row' });
  const parseBtn = el('button', { text: 'Parse SQL' });
  parseBtn.addEventListener('click', onParse);
  btnRow.appendChild(parseBtn);

  const clearBtn = el('button', { text: 'Clear', class: 'btn-secondary' });
  clearBtn.addEventListener('click', () => {
    textarea.value = '';
    document.getElementById('ss-sql-output').textContent = '';
  });
  btnRow.appendChild(clearBtn);

  const copyBtn = el('button', { text: 'Copy SQL', class: 'btn-secondary' });
  copyBtn.addEventListener('click', () => {
    const output = document.getElementById('ss-sql-output');
    if (output.textContent) {
      navigator.clipboard.writeText(output.textContent);
      showToast('Copied to clipboard', 'success');
    }
  });
  btnRow.appendChild(copyBtn);
  wrap.appendChild(btnRow);

  // Output
  wrap.appendChild(el('label', { text: 'Extracted SQL:', class: 'ss-label' }));
  const output = el('pre', { id: 'ss-sql-output', class: 'ss-output' });
  wrap.appendChild(output);

  root.appendChild(wrap);
}

async function onParse() {
  const textarea = document.getElementById('ss-sql-input');
  const output = document.getElementById('ss-sql-output');
  const yamlContent = textarea.value.trim();
  if (!yamlContent) {
    showToast('Please enter YAML content', 'info');
    return;
  }
  try {
    const sql = await call('parse_superset_sql', { yamlContent });
    output.textContent = sql;
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
.ss-sql-wrap {
  display: flex;
  flex-direction: column;
  gap: 8px;
  height: 100%;
}
.ss-label {
  font-weight: 600;
  font-size: 13px;
  color: var(--text-muted);
}
.ss-textarea {
  width: 100%;
  min-height: 150px;
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 13px;
  line-height: 1.5;
  resize: vertical;
}
.ss-btn-row {
  display: flex;
  gap: 8px;
}
.ss-output {
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
