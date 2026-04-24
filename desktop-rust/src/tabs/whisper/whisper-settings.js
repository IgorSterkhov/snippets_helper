import { whisperApi } from './whisper-api.js';

export async function openSettingsModal() {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-overlay';
  backdrop.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:999;display:flex;align-items:center;justify-content:center';

  const modal = document.createElement('div');
  modal.style.cssText = 'background:var(--bg,#0d1117);border:1px solid var(--border,#30363d);border-radius:8px;width:min(560px,90vw);max-height:90vh;overflow:auto;display:flex;flex-direction:column';
  backdrop.appendChild(modal);

  modal.innerHTML = `
    <div style="padding:12px 16px;border-bottom:1px solid var(--border,#30363d);display:flex;align-items:center">
      <h3 style="margin:0;font-size:14px">Настройки Whisper</h3>
      <button id="close-btn" style="margin-left:auto;background:transparent;border:0;color:var(--text-muted,#8b949e);font-size:16px;cursor:pointer">✕</button>
    </div>
    <div id="content" style="padding:16px;display:flex;flex-direction:column;gap:14px;font-size:13px;color:var(--text,#c9d1d9)"></div>
    <div style="padding:10px 16px;border-top:1px solid var(--border,#30363d);display:flex;justify-content:flex-end;gap:8px">
      <button id="save-btn" style="padding:6px 14px;background:var(--accent,#388bfd);color:#fff;border:0;border-radius:4px;cursor:pointer">Сохранить</button>
    </div>
  `;

  document.body.appendChild(backdrop);
  const content = modal.querySelector('#content');

  const [mics, models, settingsRaw] = await Promise.all([
    whisperApi.listMics(),
    whisperApi.listModels(),
    loadAllSettings(),
  ]);
  const s = settingsRaw;

  content.appendChild(section('Микрофон', micSelect(mics, s['whisper.mic_device'] || '')));
  content.appendChild(section('Модель по умолчанию', modelSelect(models, s['whisper.default_model'] || '')));
  content.appendChild(section('Язык', langSelect(s['whisper.language'] || 'auto')));
  content.appendChild(section('Hotkey', textInput('hotkey', s['whisper.hotkey'] || 'Ctrl+Alt+Space', 'напр. Ctrl+Alt+Space')));
  content.appendChild(section('Метод вставки', injectRadio(s['whisper.inject_method'] || 'paste')));
  content.appendChild(section('Idle timeout (сек)', numInput('idle_timeout_sec', s['whisper.idle_timeout_sec'] || '300', 60, 1800, 30)));
  content.appendChild(section('Постобработка', checkbox('postprocess_rules', (s['whisper.postprocess_rules'] || 'true') === 'true', 'Лёгкие правила (убрать «эээ», заглавная буква)')));
  content.appendChild(llmBlock(s));
  content.appendChild(section('Overlay', overlayBlock(s)));

  modal.querySelector('#close-btn').onclick = () => backdrop.remove();
  modal.querySelector('#save-btn').onclick = async () => {
    const formValues = collect(modal);
    for (const [key, value] of Object.entries(formValues)) {
      await whisperApi.setSetting(key, value);
    }
    backdrop.remove();
    window.dispatchEvent(new CustomEvent('whisper:settings-changed'));
  };
}

async function loadAllSettings() {
  const keys = [
    'whisper.hotkey','whisper.mic_device','whisper.default_model','whisper.idle_timeout_sec',
    'whisper.inject_method','whisper.postprocess_rules','whisper.llm_enabled',
    'whisper.llm_endpoint','whisper.llm_api_key','whisper.llm_model','whisper.llm_prompt',
    'whisper.overlay_position','whisper.overlay_hide_on_tab','whisper.language',
  ];
  const result = {};
  for (const k of keys) {
    try { result[k] = await whisperApi.getSetting(k); } catch { result[k] = null; }
  }
  return result;
}

function section(label, node) {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;flex-direction:column;gap:4px';
  const lbl = document.createElement('div');
  lbl.textContent = label;
  lbl.style.cssText = 'color:var(--text-muted,#8b949e);font-size:11px;text-transform:uppercase;letter-spacing:.5px';
  wrap.appendChild(lbl);
  wrap.appendChild(node);
  return wrap;
}

function micSelect(mics, current) {
  const sel = document.createElement('select');
  sel.dataset.key = 'whisper.mic_device';
  sel.innerHTML = `<option value="">(системный по умолчанию)</option>` + mics.map(m =>
    `<option value="${escapeAttr(m.name)}" ${m.name === current ? 'selected' : ''}>${escapeHtml(m.name)}${m.is_default ? ' (default)' : ''}</option>`
  ).join('');
  stylizeInput(sel);
  return sel;
}

function modelSelect(models, current) {
  const sel = document.createElement('select');
  sel.dataset.key = 'whisper.default_model';
  sel.innerHTML = models.map(m =>
    `<option value="${escapeAttr(m.name)}" ${m.name === current || m.is_default ? 'selected' : ''}>${escapeHtml(m.display_name)}</option>`
  ).join('') || `<option value="">(нет установленных моделей)</option>`;
  stylizeInput(sel);
  return sel;
}

function langSelect(current) {
  const sel = document.createElement('select');
  sel.dataset.key = 'whisper.language';
  sel.innerHTML = ['auto','ru','en'].map(l =>
    `<option value="${l}" ${l === current ? 'selected' : ''}>${l}</option>`
  ).join('');
  stylizeInput(sel);
  return sel;
}

function textInput(shortKey, value, placeholder) {
  const inp = document.createElement('input');
  inp.type = 'text';
  inp.dataset.key = 'whisper.' + shortKey;
  inp.value = value;
  inp.placeholder = placeholder || '';
  stylizeInput(inp);
  return inp;
}

function numInput(shortKey, value, min, max, step) {
  const inp = document.createElement('input');
  inp.type = 'number';
  inp.dataset.key = 'whisper.' + shortKey;
  inp.min = String(min); inp.max = String(max); inp.step = String(step);
  inp.value = String(value);
  stylizeInput(inp);
  return inp;
}

function injectRadio(current) {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;gap:12px';
  for (const v of ['copy','paste','type']) {
    const lbl = document.createElement('label');
    lbl.style.cssText = 'display:flex;align-items:center;gap:4px;cursor:pointer';
    lbl.innerHTML = `<input type="radio" name="whisper.inject_method" value="${v}" ${v===current?'checked':''} data-key="whisper.inject_method"> <span>${v}</span>`;
    wrap.appendChild(lbl);
  }
  return wrap;
}

function checkbox(shortKey, checked, label) {
  const wrap = document.createElement('label');
  wrap.style.cssText = 'display:flex;align-items:center;gap:6px;cursor:pointer';
  wrap.innerHTML = `<input type="checkbox" data-key="whisper.${shortKey}" ${checked ? 'checked' : ''}> <span>${escapeHtml(label)}</span>`;
  return wrap;
}

function llmBlock(s) {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;flex-direction:column;gap:6px;padding:10px;border:1px dashed var(--border,#30363d);border-radius:4px';
  wrap.appendChild(checkbox('llm_enabled', (s['whisper.llm_enabled'] || 'false') === 'true', 'Постобработка через внешний LLM'));
  wrap.appendChild(textInput('llm_endpoint', s['whisper.llm_endpoint'] || '', 'https://api.openai.com/v1/chat/completions'));
  wrap.appendChild(textInput('llm_api_key', s['whisper.llm_api_key'] || '', 'API key'));
  wrap.appendChild(textInput('llm_model', s['whisper.llm_model'] || 'gpt-4o-mini', 'модель'));
  const prompt = document.createElement('textarea');
  prompt.dataset.key = 'whisper.llm_prompt';
  prompt.rows = 3;
  prompt.value = s['whisper.llm_prompt'] || 'Clean up filler words; fix punctuation. Keep language.';
  stylizeInput(prompt);
  wrap.appendChild(prompt);
  return wrap;
}

function overlayBlock(s) {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;flex-direction:column;gap:6px';
  const posSel = document.createElement('select');
  posSel.dataset.key = 'whisper.overlay_position';
  const current = s['whisper.overlay_position'] || 'bottom-right';
  posSel.innerHTML = ['bottom-right','bottom-left','top-right','top-left'].map(p =>
    `<option value="${p}" ${p===current?'selected':''}>${p}</option>`
  ).join('');
  stylizeInput(posSel);
  wrap.appendChild(posSel);
  wrap.appendChild(checkbox('overlay_hide_on_tab', (s['whisper.overlay_hide_on_tab'] || 'false') === 'true', 'Скрывать overlay когда вкладка Whisper активна'));
  return wrap;
}

function stylizeInput(el) {
  el.style.cssText = 'padding:6px 8px;background:var(--bg-secondary,#161b22);border:1px solid var(--border,#30363d);color:var(--text,#c9d1d9);border-radius:4px;font-size:13px;font-family:inherit';
}

function collect(root) {
  const out = {};
  root.querySelectorAll('[data-key]').forEach(el => {
    if (el.type === 'checkbox') out[el.dataset.key] = el.checked ? 'true' : 'false';
    else if (el.type === 'radio') { if (el.checked) out[el.dataset.key] = el.value; }
    else out[el.dataset.key] = el.value;
  });
  return out;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }
