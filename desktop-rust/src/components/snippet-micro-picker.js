import { call } from '../tauri-api.js';

let snippets = [];
let filtered = [];
let selectedIndex = 0;
let inputEl = null;
let listEl = null;
let previewEl = null;
let statusEl = null;

export async function init(container) {
  document.body.classList.add('snippet-micro-picker-window');
  container.innerHTML = '';
  container.className = 'snippet-micro-picker-root';

  const shell = document.createElement('div');
  shell.className = 'snippet-micro-picker';

  const header = document.createElement('div');
  header.className = 'snippet-micro-picker-header';
  const title = document.createElement('div');
  title.className = 'snippet-micro-picker-title';
  title.textContent = 'Code Snippets';
  header.appendChild(title);
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'snippet-micro-picker-close';
  close.textContent = 'x';
  close.title = 'Close';
  close.addEventListener('click', closePicker);
  header.appendChild(close);
  shell.appendChild(header);

  inputEl = document.createElement('input');
  inputEl.className = 'snippet-micro-picker-input';
  inputEl.type = 'text';
  inputEl.placeholder = 'Type to search code_ snippets...';
  inputEl.autocomplete = 'off';
  inputEl.spellcheck = false;
  inputEl.addEventListener('input', () => {
    selectedIndex = 0;
    renderResults();
  });
  inputEl.addEventListener('keydown', onInputKeydown);
  shell.appendChild(inputEl);

  const body = document.createElement('div');
  body.className = 'snippet-micro-picker-body';
  listEl = document.createElement('div');
  listEl.className = 'snippet-micro-picker-list';
  previewEl = document.createElement('pre');
  previewEl.className = 'snippet-micro-picker-preview';
  body.appendChild(listEl);
  body.appendChild(previewEl);
  shell.appendChild(body);

  statusEl = document.createElement('div');
  statusEl.className = 'snippet-micro-picker-status';
  statusEl.textContent = 'Enter inserts. Escape closes. Arrow keys select.';
  shell.appendChild(statusEl);

  container.appendChild(shell);

  await loadSnippets();
  renderResults();
  setTimeout(() => inputEl?.focus(), 0);
}

async function loadSnippets() {
  try {
    const all = await call('list_shortcuts');
    snippets = (Array.isArray(all) ? all : [])
      .filter(item => String(item?.name || '').toLowerCase().startsWith('code_'))
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  } catch (err) {
    snippets = [];
    setStatus('Failed to load snippets: ' + err, true);
  }
}

function tokens(query) {
  return String(query || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
}

function matches(snippet, queryTokens) {
  if (!queryTokens.length) return true;
  const haystack = [
    snippet?.name,
    snippet?.description,
    snippet?.value,
  ].map(value => String(value || '').toLowerCase()).join('\n');
  return queryTokens.every(token => haystack.includes(token));
}

function renderResults() {
  const queryTokens = tokens(inputEl?.value || '');
  filtered = snippets.filter(snippet => matches(snippet, queryTokens)).slice(0, 40);
  if (selectedIndex >= filtered.length) selectedIndex = Math.max(0, filtered.length - 1);
  listEl.innerHTML = '';

  if (!filtered.length) {
    const empty = document.createElement('div');
    empty.className = 'snippet-micro-picker-empty';
    empty.textContent = snippets.length
      ? 'No matching code snippets'
      : 'No snippets with code_ prefix';
    listEl.appendChild(empty);
    renderPreview(null);
    return;
  }

  filtered.forEach((snippet, index) => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'snippet-micro-picker-row' + (index === selectedIndex ? ' active' : '');
    row.dataset.index = String(index);

    const name = document.createElement('span');
    name.className = 'snippet-micro-picker-row-name';
    name.textContent = snippet.name || '(untitled)';
    row.appendChild(name);

    const meta = document.createElement('span');
    meta.className = 'snippet-micro-picker-row-meta';
    meta.textContent = snippet.description ? snippet.description.split('\n')[0] : '';
    row.appendChild(meta);

    row.addEventListener('mouseenter', () => {
      selectedIndex = index;
      renderResults();
    });
    row.addEventListener('click', () => insertSelected());
    listEl.appendChild(row);
  });

  renderPreview(filtered[selectedIndex]);
}

function renderPreview(snippet) {
  if (!snippet) {
    previewEl.textContent = '';
    return;
  }
  previewEl.textContent = snippet.value || '';
}

function moveSelection(delta) {
  if (!filtered.length) return;
  selectedIndex = (selectedIndex + delta + filtered.length) % filtered.length;
  renderResults();
  const active = listEl.querySelector('.snippet-micro-picker-row.active');
  active?.scrollIntoView({ block: 'nearest' });
}

function onInputKeydown(event) {
  if (event.key === 'Escape') {
    event.preventDefault();
    closePicker();
    return;
  }
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    moveSelection(1);
    return;
  }
  if (event.key === 'ArrowUp') {
    event.preventDefault();
    moveSelection(-1);
    return;
  }
  if (event.key === 'Enter') {
    event.preventDefault();
    insertSelected();
  }
}

async function insertSelected() {
  const snippet = filtered[selectedIndex];
  if (!snippet) return;
  setStatus('Inserting...', false);
  try {
    const result = await call('insert_snippet_micro_picker_text', { text: snippet.value || '' });
    if (result?.method === 'copy') {
      setStatus(result.message || 'Snippet copied. Paste manually.', false);
      inputEl?.focus();
      return;
    }
    setStatus(result?.message || 'Inserted', false);
  } catch (err) {
    setStatus('Insert failed: ' + err, true);
  }
}

async function closePicker() {
  try {
    await call('close_snippet_micro_picker');
  } catch {
    window.close();
  }
}

function setStatus(message, isError) {
  if (!statusEl) return;
  statusEl.textContent = message;
  statusEl.dataset.error = isError ? '1' : '0';
}
