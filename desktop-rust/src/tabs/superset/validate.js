import { call } from '../../tauri-api.js';
import { showToast } from '../../components/toast.js';

let root = null;

export function init(container) {
  root = container;
  root.innerHTML = '';

  const style = document.createElement('style');
  style.textContent = css();
  root.appendChild(style);

  const wrap = el('div', { class: 'ss-validate-wrap' });

  wrap.appendChild(el('h2', { text: 'Validate Report' }));
  wrap.appendChild(el('p', { text: 'Validate YAML files in a Superset export zip' }));

  // File path input
  const inputLabel = el('label', { text: 'Zip file path:', class: 'ss-label' });
  wrap.appendChild(inputLabel);

  const pathInput = document.createElement('input');
  pathInput.id = 'ss-validate-path';
  pathInput.className = 'ss-input';
  pathInput.placeholder = '/path/to/superset_export.zip';
  wrap.appendChild(pathInput);

  // Button row
  const btnRow = el('div', { class: 'ss-btn-row' });
  const validateBtn = el('button', { text: 'Validate' });
  validateBtn.addEventListener('click', onValidate);
  btnRow.appendChild(validateBtn);

  const clearBtn = el('button', { text: 'Clear', class: 'btn-secondary' });
  clearBtn.addEventListener('click', () => {
    pathInput.value = '';
    document.getElementById('ss-validate-output').textContent = '';
  });
  btnRow.appendChild(clearBtn);
  wrap.appendChild(btnRow);

  // Output
  wrap.appendChild(el('label', { text: 'Validation results:', class: 'ss-label' }));
  const output = el('pre', { id: 'ss-validate-output', class: 'ss-output' });
  wrap.appendChild(output);

  root.appendChild(wrap);
}

async function onValidate() {
  const pathInput = document.getElementById('ss-validate-path');
  const output = document.getElementById('ss-validate-output');
  const path = pathInput.value.trim();
  if (!path) {
    showToast('Please enter a file path', 'info');
    return;
  }
  try {
    const warnings = await call('validate_superset_report', { path });
    output.textContent = warnings.join('\n');
    showToast(`Validation complete: ${warnings.length} message(s)`, 'success');
  } catch (e) {
    showToast('Validation error: ' + e, 'error');
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
.ss-validate-wrap {
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
