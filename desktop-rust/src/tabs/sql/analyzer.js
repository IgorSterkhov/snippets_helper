import { call } from '../../tauri-api.js';
import { showToast } from '../../components/toast.js';
import { showModal } from '../../components/modal.js';
import { helpButton } from './sql-help.js';
import { ANALYZER_HELP_HTML } from './help-content.js';

let root = null;
let templates = [];

export function init(container) {
  root = container;
  root.innerHTML = '';

  const style = document.createElement('style');
  style.textContent = css();
  root.appendChild(style);

  const wrap = el('div', { class: 'sql-analyzer-wrap' });

  const hdr = el('div', { class: 'sql-help-header' });
  hdr.appendChild(el('h2', { text: 'Table Analyzer' }));
  hdr.appendChild(helpButton('Table Analyzer — справка', ANALYZER_HELP_HTML));
  wrap.appendChild(hdr);
  wrap.appendChild(el('p', { text: 'Generate SELECT queries from ClickHouse DDL' }));

  // DDL input
  wrap.appendChild(el('label', { text: 'DDL (ClickHouse CREATE TABLE):', class: 'sql-label' }));
  const ddlTA = document.createElement('textarea');
  ddlTA.id = 'analyzer-ddl';
  ddlTA.className = 'sql-textarea';
  ddlTA.placeholder = 'Paste CREATE TABLE DDL here...';
  ddlTA.rows = 8;
  wrap.appendChild(ddlTA);

  // Filter
  wrap.appendChild(el('label', { text: 'Filter (WHERE ...):', class: 'sql-label' }));
  const filterInput = document.createElement('input');
  filterInput.id = 'analyzer-filter';
  filterInput.value = 'WHERE True';
  filterInput.style.width = '100%';
  wrap.appendChild(filterInput);

  // Row version field
  wrap.appendChild(el('label', { text: 'Field for row_version:', class: 'sql-label' }));
  const rvInput = document.createElement('input');
  rvInput.id = 'analyzer-rv';
  rvInput.value = 'row_version';
  rvInput.style.width = '100%';
  wrap.appendChild(rvInput);

  // Format vertical checkbox
  const fvRow = el('div', { class: 'sql-checkbox-row' });
  const fvCb = document.createElement('input');
  fvCb.type = 'checkbox';
  fvCb.id = 'analyzer-fv';
  fvCb.checked = true;
  fvRow.appendChild(fvCb);
  fvRow.appendChild(el('label', { text: 'FORMAT Vertical', style: 'cursor:pointer' }));
  fvRow.querySelector('label').setAttribute('for', 'analyzer-fv');
  wrap.appendChild(fvRow);

  // Templates section
  const tplHeader = el('div', { class: 'sql-tpl-header' });
  tplHeader.appendChild(el('label', { text: 'Analyzer Templates:', class: 'sql-label' }));
  const addTplBtn = el('button', { text: '+ Add', class: 'btn-secondary', style: 'font-size:12px;padding:4px 10px' });
  addTplBtn.addEventListener('click', onAddTemplate);
  tplHeader.appendChild(addTplBtn);
  wrap.appendChild(tplHeader);

  const tplList = el('div', { id: 'analyzer-templates', class: 'sql-tpl-list' });
  wrap.appendChild(tplList);

  // Buttons
  const btnRow = el('div', { class: 'sql-btn-row' });
  const analyzeBtn = el('button', { text: 'Analyze DDL' });
  analyzeBtn.addEventListener('click', onAnalyze);
  btnRow.appendChild(analyzeBtn);

  const copyBtn = el('button', { text: 'Copy Result', class: 'btn-secondary' });
  copyBtn.addEventListener('click', () => {
    const output = document.getElementById('analyzer-output');
    if (output.textContent) {
      navigator.clipboard.writeText(output.textContent);
      showToast('Copied to clipboard', 'success');
    }
  });
  btnRow.appendChild(copyBtn);
  wrap.appendChild(btnRow);

  // Output
  wrap.appendChild(el('label', { text: 'Result:', class: 'sql-label' }));
  const output = el('pre', { id: 'analyzer-output', class: 'sql-output' });
  wrap.appendChild(output);

  root.appendChild(wrap);
  loadTemplates();
}

async function loadTemplates() {
  try {
    templates = await call('list_analyzer_templates');
    renderTemplates();
  } catch (e) {
    showToast('Failed to load templates: ' + e, 'error');
  }
}

function renderTemplates() {
  const list = document.getElementById('analyzer-templates');
  if (!list) return;
  list.innerHTML = '';
  if (templates.length === 0) {
    list.appendChild(el('span', { text: '(no templates)', style: 'color:var(--text-muted);font-size:12px' }));
    return;
  }
  for (const t of templates) {
    const item = el('div', { class: 'sql-tpl-item' });
    const text = el('code', { text: t.template_text, style: 'flex:1;font-size:12px' });
    item.appendChild(text);
    const delBtn = el('button', { text: '\u2715', class: 'btn-secondary', style: 'font-size:11px;padding:2px 8px;min-width:0' });
    delBtn.addEventListener('click', () => onDeleteTemplate(t.id));
    item.appendChild(delBtn);
    list.appendChild(item);
  }
}

async function onAddTemplate() {
  const body = document.createElement('div');
  body.innerHTML = '<label style="display:block;margin-bottom:6px;color:var(--text)">Template expression (use &lt;field&gt; and &lt;field_for_row_version&gt;):</label>';
  const input = document.createElement('input');
  input.style.width = '100%';
  input.placeholder = 'e.g. count(distinct <field>) AS uniq_<field>';
  body.appendChild(input);

  try {
    await showModal({
      title: 'Add Analyzer Template',
      body,
      onConfirm: async () => {
        const text = input.value.trim();
        if (!text) throw new Error('Template is required');
        await call('create_analyzer_template', { templateText: text });
        showToast('Template added', 'success');
      },
    });
    await loadTemplates();
  } catch (_) { /* cancelled */ }
}

async function onDeleteTemplate(id) {
  try {
    await showModal({
      title: 'Delete Template',
      body: 'Delete this analyzer template?',
      onConfirm: async () => {
        await call('delete_analyzer_template', { id });
        showToast('Template deleted', 'success');
      },
    });
    await loadTemplates();
  } catch (_) { /* cancelled */ }
}

async function onAnalyze() {
  const ddl = document.getElementById('analyzer-ddl').value.trim();
  const whereClause = document.getElementById('analyzer-filter').value.trim();
  const rowVersionField = document.getElementById('analyzer-rv').value.trim();
  const formatVertical = document.getElementById('analyzer-fv').checked;
  const output = document.getElementById('analyzer-output');

  const tplTexts = templates.map(t => t.template_text);

  try {
    const result = await call('analyze_ddl', {
      ddl, whereClause, rowVersionField, formatVertical, templates: tplTexts
    });
    output.textContent = result;
  } catch (e) {
    output.textContent = '';
    showToast(String(e), 'error');
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
.sql-analyzer-wrap {
  display: flex;
  flex-direction: column;
  gap: 8px;
  height: 100%;
}
.sql-label { font-weight: 600; font-size: 13px; color: var(--text-muted); }
.sql-textarea {
  width: 100%; min-height: 120px;
  font-family: 'Consolas','Monaco',monospace; font-size: 13px; line-height: 1.5; resize: vertical;
}
.sql-btn-row { display: flex; gap: 8px; }
.sql-output {
  flex: 1; min-height: 100px;
  background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 6px;
  padding: 12px; font-family: 'Consolas','Monaco',monospace; font-size: 13px;
  line-height: 1.5; overflow: auto; white-space: pre-wrap; color: var(--text); margin: 0;
}
.sql-checkbox-row { display: flex; align-items: center; gap: 6px; }
.sql-tpl-header { display: flex; justify-content: space-between; align-items: center; }
.sql-tpl-list { display: flex; flex-direction: column; gap: 4px; }
.sql-tpl-item {
  display: flex; align-items: center; gap: 8px;
  background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 4px; padding: 6px 10px;
}
`;
}
