// Shared help modal for SQL sub-tabs. One-button ("Close") info modal with
// wide content area, scrollable body, Ctrl+wheel zoom, and styling for
// nested <pre>, <code>, lists and headings.

const FONT_STORAGE_KEY = 'sql-help-font-size';
const MIN_FONT = 10;
const MAX_FONT = 28;
const DEFAULT_FONT = 13;

function getStoredFontSize() {
  const v = parseInt(localStorage.getItem(FONT_STORAGE_KEY), 10);
  if (!Number.isFinite(v) || v < MIN_FONT || v > MAX_FONT) return DEFAULT_FONT;
  return v;
}

function setStoredFontSize(v) {
  try { localStorage.setItem(FONT_STORAGE_KEY, String(v)); } catch {}
}

export function showSqlHelp(title, innerHtml) {
  ensureCss();

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay sql-help-overlay';

  const modal = document.createElement('div');
  modal.className = 'modal sql-help-modal';

  const titleEl = document.createElement('h3');
  titleEl.textContent = title;
  modal.appendChild(titleEl);

  const body = document.createElement('div');
  body.className = 'modal-body sql-help-body';
  body.innerHTML = innerHtml;
  body.style.fontSize = getStoredFontSize() + 'px';
  modal.appendChild(body);

  const actions = document.createElement('div');
  actions.className = 'modal-actions';

  const zoomHint = document.createElement('span');
  zoomHint.className = 'sql-help-zoom-hint';
  zoomHint.textContent = 'Ctrl + \u{1F5B1} — zoom';
  actions.appendChild(zoomHint);

  const closeBtn = document.createElement('button');
  closeBtn.textContent = 'Close';
  actions.appendChild(closeBtn);
  modal.appendChild(actions);

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  modal.addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    let size = parseInt(body.style.fontSize, 10) || DEFAULT_FONT;
    size += e.deltaY < 0 ? 1 : -1;
    size = Math.max(MIN_FONT, Math.min(MAX_FONT, size));
    body.style.fontSize = size + 'px';
    setStoredFontSize(size);
  }, { passive: false });

  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  };
  function onKey(e) { if (e.key === 'Escape') close(); }
  closeBtn.addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', onKey);
}

/**
 * Render a "?" help button that opens the given help content on click.
 * Returns the button element for appending next to the tab header.
 */
export function helpButton(title, innerHtml) {
  const b = document.createElement('button');
  b.className = 'sql-help-btn';
  b.type = 'button';
  b.textContent = '?';
  b.title = 'Show help';
  b.setAttribute('aria-label', 'Show help');
  b.addEventListener('click', () => showSqlHelp(title, innerHtml));
  return b;
}

function ensureCss() {
  if (document.getElementById('sql-help-css')) return;
  const s = document.createElement('style');
  s.id = 'sql-help-css';
  s.textContent = `
.sql-help-modal {
  max-width: 820px; width: 92%;
  max-height: 85vh;
  display: flex; flex-direction: column;
  padding: 20px 22px;
}
.sql-help-modal h3 { margin: 0 0 12px; }
.sql-help-body {
  flex: 1; overflow: auto;
  font-size: 13px; line-height: 1.55;
  color: var(--text);
  padding-right: 6px;
}
.sql-help-body h4 {
  margin: 16px 0 6px; color: var(--accent);
  font-size: 14px; font-weight: 600;
}
.sql-help-body h5 {
  margin: 12px 0 4px; color: var(--text-muted);
  font-size: 13px; font-weight: 600;
}
.sql-help-body p { margin: 6px 0; }
.sql-help-body ul, .sql-help-body ol { margin: 6px 0; padding-left: 22px; }
.sql-help-body li { margin: 3px 0; }
.sql-help-body code {
  background: var(--bg-secondary);
  padding: 1px 5px; border-radius: 3px;
  font-family: 'Consolas','Monaco',monospace; font-size: 12px;
}
.sql-help-body pre {
  background: var(--bg-secondary);
  border: 1px solid var(--border); border-radius: 4px;
  padding: 10px 12px; overflow: auto;
  margin: 8px 0;
  font-size: 12px; line-height: 1.45;
  color: var(--text);
  white-space: pre;
  font-family: 'Consolas','Monaco',monospace;
}
.sql-help-body pre code {
  background: transparent; padding: 0; border-radius: 0;
  font-size: inherit; font-family: inherit;
}
.sql-help-body strong { color: var(--text); }
.sql-help-body hr {
  border: none; border-top: 1px solid var(--border); margin: 14px 0;
}
.sql-help-btn {
  width: 24px; height: 24px; min-width: 0; padding: 0;
  border-radius: 50%;
  background: transparent;
  border: 1px solid var(--border);
  color: var(--text-muted);
  font-size: 13px; font-weight: 600;
  cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
  line-height: 1;
  transition: color 0.15s, border-color 0.15s, background 0.15s;
}
.sql-help-btn:hover {
  color: var(--accent, #3b82f6);
  border-color: var(--accent, #3b82f6);
  background: rgba(59, 130, 246, 0.08);
}
.sql-help-header {
  display: flex; align-items: center; gap: 10px;
}
.sql-help-header h2 { margin: 0; }
.sql-help-modal .modal-actions {
  justify-content: space-between;
  align-items: center;
}
.sql-help-zoom-hint {
  color: var(--text-muted);
  font-size: 11px;
  user-select: none;
}
`;
  document.head.appendChild(s);
}
