import { call } from '../../tauri-api.js';
import { showToast } from '../../components/toast.js';
import { showModal } from '../../components/modal.js';

let root = null;
let templates = [];
let placeholderWidgets = {};

export function init(container) {
  root = container;
  root.innerHTML = '';

  const style = document.createElement('style');
  style.textContent = css();
  root.appendChild(style);

  const wrap = el('div', { class: 'sql-macrosing-wrap' });

  wrap.appendChild(el('h2', { text: 'SQL Macrosing' }));
  wrap.appendChild(el('p', { text: 'Generate SQL variations from a template with placeholders' }));

  // Templates row
  const tplRow = el('div', { class: 'sql-tpl-row' });
  tplRow.appendChild(el('label', { text: 'Template:', class: 'sql-label' }));

  const tplSelect = document.createElement('select');
  tplSelect.id = 'macrosing-template-select';
  tplSelect.style.flex = '1';
  tplSelect.addEventListener('change', onTemplateSelected);
  tplRow.appendChild(tplSelect);

  const saveTplBtn = el('button', { text: 'Save', style: 'font-size:12px;padding:4px 10px' });
  saveTplBtn.addEventListener('click', onSaveTemplate);
  tplRow.appendChild(saveTplBtn);

  const delTplBtn = el('button', { text: 'Delete', class: 'btn-danger', style: 'font-size:12px;padding:4px 10px' });
  delTplBtn.addEventListener('click', onDeleteTemplate);
  tplRow.appendChild(delTplBtn);

  wrap.appendChild(tplRow);

  // SQL template
  wrap.appendChild(el('label', { text: 'SQL Template (use {{placeholder}}):', class: 'sql-label' }));
  const sqlTA = document.createElement('textarea');
  sqlTA.id = 'macrosing-sql';
  sqlTA.className = 'sql-textarea';
  sqlTA.placeholder = 'SELECT * FROM {{schema}}.{{table}} WHERE date = \'{{date}}\'';
  sqlTA.rows = 5;
  sqlTA.addEventListener('input', refreshPlaceholders);
  wrap.appendChild(sqlTA);

  // Placeholders section
  const phHeader = el('div', { class: 'sql-tpl-header' });
  phHeader.appendChild(el('label', { text: 'Placeholders:', class: 'sql-label' }));
  const refreshBtn = el('button', { text: 'Refresh', class: 'btn-secondary', style: 'font-size:12px;padding:4px 10px' });
  refreshBtn.addEventListener('click', refreshPlaceholders);
  phHeader.appendChild(refreshBtn);
  wrap.appendChild(phHeader);

  const phContainer = el('div', { id: 'macrosing-placeholders', class: 'sql-ph-container' });
  wrap.appendChild(phContainer);

  // Options row
  const optRow = el('div', { class: 'sql-opt-row' });

  optRow.appendChild(el('label', { text: 'Combination:', class: 'sql-label' }));
  const modeSelect = document.createElement('select');
  modeSelect.id = 'macrosing-mode';
  const optCart = document.createElement('option');
  optCart.value = 'cartesian'; optCart.text = 'Cartesian';
  const optZip = document.createElement('option');
  optZip.value = 'zip'; optZip.text = 'Zip';
  modeSelect.appendChild(optCart);
  modeSelect.appendChild(optZip);
  optRow.appendChild(modeSelect);

  optRow.appendChild(el('label', { text: 'Separator:', class: 'sql-label', style: 'margin-left:16px' }));
  const sepInput = document.createElement('input');
  sepInput.id = 'macrosing-separator';
  sepInput.value = ';\\n';
  sepInput.style.width = '80px';
  optRow.appendChild(sepInput);

  wrap.appendChild(optRow);

  // Generate button
  const btnRow = el('div', { class: 'sql-btn-row' });
  const genBtn = el('button', { text: 'Generate SQL' });
  genBtn.addEventListener('click', onGenerate);
  btnRow.appendChild(genBtn);

  const copyBtn = el('button', { text: 'Copy Result', class: 'btn-secondary' });
  copyBtn.addEventListener('click', () => {
    const output = document.getElementById('macrosing-output');
    if (output.textContent) {
      navigator.clipboard.writeText(output.textContent);
      showToast('Copied to clipboard', 'success');
    }
  });
  btnRow.appendChild(copyBtn);
  wrap.appendChild(btnRow);

  // Output
  wrap.appendChild(el('label', { text: 'Result:', class: 'sql-label' }));
  const output = el('pre', { id: 'macrosing-output', class: 'sql-output' });
  wrap.appendChild(output);

  root.appendChild(wrap);
  loadTemplates();
}

async function loadTemplates() {
  try {
    templates = await call('list_macrosing_templates');
    renderTemplateSelect();
  } catch (e) {
    showToast('Failed to load templates: ' + e, 'error');
  }
}

function renderTemplateSelect() {
  const select = document.getElementById('macrosing-template-select');
  if (!select) return;
  select.innerHTML = '<option value="">-- Select template --</option>';
  for (const t of templates) {
    const opt = document.createElement('option');
    opt.value = String(t.id);
    opt.textContent = t.template_name;
    select.appendChild(opt);
  }
}

function onTemplateSelected() {
  const select = document.getElementById('macrosing-template-select');
  const id = parseInt(select.value);
  if (!id) return;
  const tpl = templates.find(t => t.id === id);
  if (!tpl) return;

  document.getElementById('macrosing-sql').value = tpl.template_text;
  document.getElementById('macrosing-mode').value = tpl.combination_mode || 'cartesian';
  document.getElementById('macrosing-separator').value = tpl.separator || ';\\n';

  // Load placeholders from saved config
  try {
    const config = JSON.parse(tpl.placeholders_config || '{}');
    loadPlaceholdersFromConfig(config);
  } catch (_) {
    refreshPlaceholders();
  }
}

async function onSaveTemplate() {
  const select = document.getElementById('macrosing-template-select');
  const sqlText = document.getElementById('macrosing-sql').value.trim();
  const mode = document.getElementById('macrosing-mode').value;
  const separator = document.getElementById('macrosing-separator').value;
  const config = collectPlaceholdersConfig();

  let name = '';
  const existingId = parseInt(select.value);
  if (existingId) {
    const existing = templates.find(t => t.id === existingId);
    name = existing ? existing.template_name : '';
  }

  if (!name) {
    const body = document.createElement('div');
    body.innerHTML = '<label style="display:block;margin-bottom:6px;color:var(--text)">Template name:</label>';
    const input = document.createElement('input');
    input.style.width = '100%';
    input.placeholder = 'My template';
    body.appendChild(input);

    try {
      await showModal({
        title: 'Save Template',
        body,
        onConfirm: () => {
          name = input.value.trim();
          if (!name) throw new Error('Name required');
        },
      });
    } catch (_) { return; }
  }

  try {
    if (existingId) {
      await call('update_macrosing_template', {
        id: existingId,
        templateName: name,
        templateText: sqlText,
        placeholdersConfig: JSON.stringify(config),
        combinationMode: mode,
        separator,
      });
      showToast('Template updated', 'success');
    } else {
      await call('create_macrosing_template', {
        templateName: name,
        templateText: sqlText,
        placeholdersConfig: JSON.stringify(config),
        combinationMode: mode,
        separator,
      });
      showToast('Template saved', 'success');
    }
    await loadTemplates();
  } catch (e) {
    showToast('Failed to save: ' + e, 'error');
  }
}

async function onDeleteTemplate() {
  const select = document.getElementById('macrosing-template-select');
  const id = parseInt(select.value);
  if (!id) { showToast('Select a template first', 'info'); return; }

  try {
    await showModal({
      title: 'Delete Template',
      body: 'Delete this macrosing template?',
      onConfirm: async () => {
        await call('delete_macrosing_template', { id });
        showToast('Template deleted', 'success');
      },
    });
    document.getElementById('macrosing-sql').value = '';
    await loadTemplates();
    refreshPlaceholders();
  } catch (_) { /* cancelled */ }
}

function extractPlaceholders(sql) {
  const re = /\{\{(\w+)\}\}/g;
  const seen = [];
  let m;
  while ((m = re.exec(sql)) !== null) {
    if (!seen.includes(m[1])) seen.push(m[1]);
  }
  return seen;
}

function refreshPlaceholders() {
  const sql = document.getElementById('macrosing-sql').value;
  const names = extractPlaceholders(sql);
  const oldConfig = collectPlaceholdersConfig();
  buildPlaceholderWidgets(names, oldConfig);
}

function loadPlaceholdersFromConfig(config) {
  // Config keys are like "{{name}}"
  const names = [];
  const normalizedConfig = {};
  for (const [key, val] of Object.entries(config)) {
    const name = key.replace(/^\{\{|\}\}$/g, '');
    names.push(name);
    normalizedConfig[`{{${name}}}`] = val;
  }
  // Also extract from SQL
  const sql = document.getElementById('macrosing-sql').value;
  for (const n of extractPlaceholders(sql)) {
    if (!names.includes(n)) names.push(n);
  }
  buildPlaceholderWidgets(names, normalizedConfig);
}

function buildPlaceholderWidgets(names, existingConfig = {}) {
  const container = document.getElementById('macrosing-placeholders');
  if (!container) return;
  container.innerHTML = '';
  placeholderWidgets = {};

  for (const name of names) {
    const key = `{{${name}}}`;
    const existing = existingConfig[key] || {};

    const row = el('div', { class: 'sql-ph-row' });
    row.appendChild(el('label', { text: key + ':', style: 'width:120px;font-size:12px;font-family:monospace' }));

    const typeSelect = document.createElement('select');
    typeSelect.style.width = '80px';
    for (const t of ['static', 'list', 'range']) {
      const opt = document.createElement('option');
      opt.value = t; opt.text = t;
      typeSelect.appendChild(opt);
    }
    typeSelect.value = existing.type || 'static';
    row.appendChild(typeSelect);

    const fieldsDiv = el('div', { class: 'sql-ph-fields', style: 'flex:1' });
    row.appendChild(fieldsDiv);

    container.appendChild(row);

    const widget = { typeSelect, fieldsDiv, name };
    placeholderWidgets[name] = widget;

    typeSelect.addEventListener('change', () => buildFields(name));
    buildFields(name, existing);
  }
}

function buildFields(name, config = null) {
  const widget = placeholderWidgets[name];
  if (!widget) return;
  const { typeSelect, fieldsDiv } = widget;
  const type = typeSelect.value;
  fieldsDiv.innerHTML = '';

  if (!config) {
    // Try to get current values before clearing
    config = {};
  }

  if (type === 'static') {
    const input = document.createElement('input');
    input.placeholder = 'Value';
    input.value = config.value || '';
    input.style.width = '100%';
    fieldsDiv.appendChild(input);
    widget.valueInput = input;
  } else if (type === 'list') {
    const input = document.createElement('input');
    input.placeholder = 'val1, val2, val3';
    input.value = config.values || '';
    input.style.width = '100%';
    fieldsDiv.appendChild(input);
    widget.valuesInput = input;
  } else if (type === 'range') {
    const startInput = document.createElement('input');
    startInput.type = 'number'; startInput.placeholder = 'Start';
    startInput.value = config.start !== undefined ? config.start : '';
    startInput.style.width = '60px';

    const endInput = document.createElement('input');
    endInput.type = 'number'; endInput.placeholder = 'End';
    endInput.value = config.end !== undefined ? config.end : '';
    endInput.style.width = '60px';

    const stepInput = document.createElement('input');
    stepInput.type = 'number'; stepInput.placeholder = 'Step';
    stepInput.value = config.step !== undefined ? config.step : '1';
    stepInput.style.width = '60px';

    const fmtInput = document.createElement('input');
    fmtInput.placeholder = 'Format ({})';
    fmtInput.value = config.format || '';
    fmtInput.style.width = '100px';

    fieldsDiv.appendChild(startInput);
    fieldsDiv.appendChild(endInput);
    fieldsDiv.appendChild(stepInput);
    fieldsDiv.appendChild(fmtInput);

    widget.startInput = startInput;
    widget.endInput = endInput;
    widget.stepInput = stepInput;
    widget.fmtInput = fmtInput;
  }
}

function collectPlaceholdersConfig() {
  const config = {};
  for (const [name, widget] of Object.entries(placeholderWidgets)) {
    const key = `{{${name}}}`;
    const type = widget.typeSelect.value;
    const phConfig = { type };

    if (type === 'static' && widget.valueInput) {
      phConfig.value = widget.valueInput.value;
    } else if (type === 'list' && widget.valuesInput) {
      phConfig.values = widget.valuesInput.value;
    } else if (type === 'range') {
      phConfig.start = widget.startInput ? parseInt(widget.startInput.value) || 0 : 0;
      phConfig.end = widget.endInput ? parseInt(widget.endInput.value) || 0 : 0;
      phConfig.step = widget.stepInput ? parseInt(widget.stepInput.value) || 1 : 1;
      phConfig.format = widget.fmtInput ? widget.fmtInput.value : '';
    }

    config[key] = phConfig;
  }
  return config;
}

async function onGenerate() {
  const template = document.getElementById('macrosing-sql').value.trim();
  const mode = document.getElementById('macrosing-mode').value;
  const separator = document.getElementById('macrosing-separator').value;
  const output = document.getElementById('macrosing-output');

  if (!template) {
    showToast('Enter SQL template', 'info');
    return;
  }

  const config = collectPlaceholdersConfig();

  try {
    const result = await call('generate_macros', {
      template,
      placeholdersJson: JSON.stringify(config),
      mode,
      separator,
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
.sql-macrosing-wrap {
  display: flex; flex-direction: column; gap: 8px; height: 100%;
}
.sql-label { font-weight: 600; font-size: 13px; color: var(--text-muted); }
.sql-textarea {
  width: 100%; min-height: 80px;
  font-family: 'Consolas','Monaco',monospace; font-size: 13px; line-height: 1.5; resize: vertical;
}
.sql-btn-row { display: flex; gap: 8px; }
.sql-output {
  flex: 1; min-height: 100px;
  background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 6px;
  padding: 12px; font-family: 'Consolas','Monaco',monospace; font-size: 13px;
  line-height: 1.5; overflow: auto; white-space: pre-wrap; color: var(--text); margin: 0;
}
.sql-tpl-row {
  display: flex; align-items: center; gap: 8px;
}
.sql-tpl-header { display: flex; justify-content: space-between; align-items: center; }
.sql-opt-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.sql-ph-container { display: flex; flex-direction: column; gap: 6px; }
.sql-ph-row {
  display: flex; align-items: center; gap: 8px;
  background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 4px; padding: 6px 10px;
}
.sql-ph-fields { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
`;
}
