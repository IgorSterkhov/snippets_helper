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

  try {
    const [formatted, error] = await call('format_sql', { sql: input, keywordsUpper });
    output.textContent = formatted;
    if (error) {
      showToast('Warning: ' + error, 'info');
    }
  } catch (e) {
    showToast('Format error: ' + e, 'error');
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
