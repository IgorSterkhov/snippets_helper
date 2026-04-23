import { call } from '../../tauri-api.js';
import { showToast } from '../../components/toast.js';
import { helpButton } from './sql-help.js';
import { OBFUSCATOR_HELP_HTML } from './help-content.js';

let root = null;
let currentMappings = [];

export function init(container) {
  root = container;
  root.innerHTML = '';

  const style = document.createElement('style');
  style.textContent = css();
  root.appendChild(style);

  const wrap = el('div', { class: 'sql-obf-wrap' });

  const hdr = el('div', { class: 'sql-help-header' });
  hdr.appendChild(el('h2', { text: 'SQL Obfuscator' }));
  hdr.appendChild(helpButton('SQL Obfuscator — справка', OBFUSCATOR_HELP_HTML));
  wrap.appendChild(hdr);
  wrap.appendChild(el('p', { text: 'Replace table/column/variable names with generic aliases for safe sharing' }));

  // Input
  wrap.appendChild(el('label', { text: 'SQL / Python code:', class: 'sql-label' }));
  const inputTA = document.createElement('textarea');
  inputTA.id = 'obf-input';
  inputTA.className = 'sql-textarea';
  inputTA.placeholder = 'Paste SQL or DAG code here...';
  inputTA.rows = 10;
  wrap.appendChild(inputTA);

  // Buttons
  const btnRow = el('div', { class: 'sql-btn-row' });

  const extractBtn = el('button', { text: 'Extract & Obfuscate' });
  extractBtn.addEventListener('click', onExtract);
  btnRow.appendChild(extractBtn);

  const reapplyBtn = el('button', { text: 'Re-apply Mappings', class: 'btn-secondary' });
  reapplyBtn.addEventListener('click', onReapply);
  btnRow.appendChild(reapplyBtn);

  const clearBtn = el('button', { text: 'Clear', class: 'btn-secondary' });
  clearBtn.addEventListener('click', () => {
    document.getElementById('obf-input').value = '';
    document.getElementById('obf-output').textContent = '';
    currentMappings = [];
    renderMappings();
  });
  btnRow.appendChild(clearBtn);

  const copyBtn = el('button', { text: 'Copy Result', class: 'btn-secondary' });
  copyBtn.addEventListener('click', () => {
    const output = document.getElementById('obf-output');
    if (output.textContent) {
      navigator.clipboard.writeText(output.textContent);
      showToast('Copied to clipboard', 'success');
    }
  });
  btnRow.appendChild(copyBtn);

  wrap.appendChild(btnRow);

  // Mappings table
  const mapHeader = el('div', { class: 'sql-tpl-header' });
  mapHeader.appendChild(el('label', { text: 'Mappings:', class: 'sql-label' }));

  const toggleAllCb = document.createElement('input');
  toggleAllCb.type = 'checkbox';
  toggleAllCb.id = 'obf-toggle-all';
  toggleAllCb.checked = true;
  toggleAllCb.addEventListener('change', () => {
    currentMappings.forEach(m => m.enabled = toggleAllCb.checked);
    renderMappings();
  });
  const toggleLabel = el('label', { text: 'Toggle all', style: 'font-size:12px;cursor:pointer' });
  toggleLabel.setAttribute('for', 'obf-toggle-all');
  const toggleWrap = el('div', { style: 'display:flex;align-items:center;gap:4px' });
  toggleWrap.appendChild(toggleAllCb);
  toggleWrap.appendChild(toggleLabel);
  mapHeader.appendChild(toggleWrap);

  wrap.appendChild(mapHeader);

  const mapTable = el('div', { id: 'obf-mappings', class: 'sql-map-container' });
  wrap.appendChild(mapTable);

  // Output
  wrap.appendChild(el('label', { text: 'Obfuscated result:', class: 'sql-label' }));
  const output = el('pre', { id: 'obf-output', class: 'sql-output' });
  wrap.appendChild(output);

  root.appendChild(wrap);
}

async function onExtract() {
  const sql = document.getElementById('obf-input').value.trim();
  if (!sql) {
    showToast('Please enter code', 'info');
    return;
  }

  try {
    const result = await call('obfuscate_sql', { sql, mappingsJson: '' });
    currentMappings = result.mappings;
    document.getElementById('obf-output').textContent = result.obfuscated;
    renderMappings();
  } catch (e) {
    showToast('Obfuscation error: ' + e, 'error');
  }
}

async function onReapply() {
  const sql = document.getElementById('obf-input').value.trim();
  if (!sql) {
    showToast('Please enter code', 'info');
    return;
  }
  if (currentMappings.length === 0) {
    showToast('No mappings. Extract first.', 'info');
    return;
  }

  try {
    const result = await call('obfuscate_sql', {
      sql,
      mappingsJson: JSON.stringify(currentMappings),
    });
    document.getElementById('obf-output').textContent = result.obfuscated;
  } catch (e) {
    showToast('Re-apply error: ' + e, 'error');
  }
}

function renderMappings() {
  const container = document.getElementById('obf-mappings');
  if (!container) return;
  container.innerHTML = '';

  if (currentMappings.length === 0) {
    container.appendChild(el('span', { text: '(no mappings yet)', style: 'color:var(--text-muted);font-size:12px' }));
    return;
  }

  // Group by type
  const groups = {};
  for (const m of currentMappings) {
    if (!groups[m.entity_type]) groups[m.entity_type] = [];
    groups[m.entity_type].push(m);
  }

  for (const [type, items] of Object.entries(groups)) {
    const header = el('div', { text: type.toUpperCase(), style: 'font-weight:600;font-size:12px;color:var(--accent);margin-top:6px' });
    container.appendChild(header);

    for (let i = 0; i < items.length; i++) {
      const m = items[i];
      const row = el('div', { class: 'sql-map-row' });

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = m.enabled;
      cb.addEventListener('change', () => { m.enabled = cb.checked; });
      row.appendChild(cb);

      row.appendChild(el('code', { text: m.original_value, style: 'flex:1;font-size:12px;color:var(--danger)' }));
      row.appendChild(el('span', { text: '\u2192', style: 'color:var(--text-muted)' }));
      row.appendChild(el('code', { text: m.obfuscated_value, style: 'flex:1;font-size:12px;color:var(--success)' }));

      container.appendChild(row);
    }
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
.sql-obf-wrap {
  display: flex; flex-direction: column; gap: 8px; height: 100%;
}
.sql-label { font-weight: 600; font-size: 13px; color: var(--text-muted); }
.sql-textarea {
  width: 100%; min-height: 120px;
  font-family: 'Consolas','Monaco',monospace; font-size: 13px; line-height: 1.5; resize: vertical;
}
.sql-btn-row { display: flex; gap: 8px; flex-wrap: wrap; }
.sql-output {
  flex: 1; min-height: 100px;
  background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 6px;
  padding: 12px; font-family: 'Consolas','Monaco',monospace; font-size: 13px;
  line-height: 1.5; overflow: auto; white-space: pre-wrap; color: var(--text); margin: 0;
}
.sql-tpl-header { display: flex; justify-content: space-between; align-items: center; }
.sql-map-container {
  max-height: 200px; overflow-y: auto;
  background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 6px; padding: 8px;
}
.sql-map-row {
  display: flex; align-items: center; gap: 8px; padding: 3px 0;
  border-bottom: 1px solid var(--border);
}
.sql-map-row:last-child { border-bottom: none; }
`;
}
