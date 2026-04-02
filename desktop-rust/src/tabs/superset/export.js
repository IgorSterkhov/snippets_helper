import { call } from '../../tauri-api.js';
import { showToast } from '../../components/toast.js';

let root = null;

export function init(container) {
  root = container;
  root.innerHTML = '';

  const style = document.createElement('style');
  style.textContent = css();
  root.appendChild(style);

  const wrap = el('div', { class: 'ss-export-wrap' });

  wrap.appendChild(el('h2', { text: 'Export Report' }));
  wrap.appendChild(el('p', { text: 'Extract file list from a Superset export zip' }));

  // File path input
  const inputLabel = el('label', { text: 'Zip file path:', class: 'ss-label' });
  wrap.appendChild(inputLabel);

  const pathInput = document.createElement('input');
  pathInput.id = 'ss-export-path';
  pathInput.className = 'ss-input';
  pathInput.placeholder = '/path/to/superset_export.zip';
  wrap.appendChild(pathInput);

  // Button row
  const btnRow = el('div', { class: 'ss-btn-row' });
  const extractBtn = el('button', { text: 'Extract' });
  extractBtn.addEventListener('click', onExtract);
  btnRow.appendChild(extractBtn);

  const clearBtn = el('button', { text: 'Clear', class: 'btn-secondary' });
  clearBtn.addEventListener('click', () => {
    pathInput.value = '';
    document.getElementById('ss-export-output').textContent = '';
  });
  btnRow.appendChild(clearBtn);
  wrap.appendChild(btnRow);

  // Output
  wrap.appendChild(el('label', { text: 'Files in archive:', class: 'ss-label' }));
  const output = el('pre', { id: 'ss-export-output', class: 'ss-output' });
  wrap.appendChild(output);

  root.appendChild(wrap);
}

async function onExtract() {
  const pathInput = document.getElementById('ss-export-path');
  const output = document.getElementById('ss-export-output');
  const path = pathInput.value.trim();
  if (!path) {
    showToast('Please enter a file path', 'info');
    return;
  }
  try {
    const files = await call('extract_superset_zip', { path });
    output.textContent = files.length
      ? files.join('\n')
      : '(empty archive)';
    showToast(`Found ${files.length} files`, 'success');
  } catch (e) {
    showToast('Extract error: ' + e, 'error');
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
.ss-export-wrap {
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
.ss-input {
  width: 100%;
  padding: 8px 12px;
  font-size: 13px;
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
