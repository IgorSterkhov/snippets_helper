// Horizontal top tabs for SQL tools. Same visual idiom as Repo Search's
// Search/Manage inner tabs — centered under a border, accent underline on
// active. Replaces the earlier vertical TabContainer sidebar.

const TABS = [
  { id: 'parser',     label: 'Parser',     loader: () => import('./parser.js') },
  { id: 'analyzer',   label: 'Analyzer',   loader: () => import('./analyzer.js') },
  { id: 'macrosing',  label: 'Macrosing',  loader: () => import('./macrosing.js') },
  { id: 'formatter',  label: 'Format',     loader: () => import('./formatter.js') },
  { id: 'obfuscator', label: 'Obfuscate',  loader: () => import('./obfuscator.js') },
];

export function init(container) {
  container.innerHTML = '';

  const style = document.createElement('style');
  style.textContent = css();
  container.appendChild(style);

  const wrap = document.createElement('div');
  wrap.className = 'sql-wrap';
  container.appendChild(wrap);

  // Tab strip
  const strip = document.createElement('div');
  strip.className = 'sql-inner-tabs';
  wrap.appendChild(strip);

  // Content panels — one per tab, lazy-loaded.
  const panels = {};
  const loaded = new Set();
  let activeId = null;

  for (const tab of TABS) {
    const btn = document.createElement('button');
    btn.className = 'sql-inner-tab';
    btn.textContent = tab.label;
    btn.dataset.tabId = tab.id;
    btn.addEventListener('click', () => activate(tab.id));
    strip.appendChild(btn);

    const panel = document.createElement('div');
    panel.className = 'sql-inner-panel';
    panel.id = `sql-panel-${tab.id}`;
    panel.style.display = 'none';
    wrap.appendChild(panel);
    panels[tab.id] = panel;
  }

  async function activate(id) {
    if (activeId === id) return;
    for (const b of strip.querySelectorAll('.sql-inner-tab')) {
      b.classList.toggle('active', b.dataset.tabId === id);
    }
    for (const pid in panels) panels[pid].style.display = 'none';
    panels[id].style.display = '';
    activeId = id;
    if (!loaded.has(id)) {
      loaded.add(id);
      try {
        const mod = await TABS.find(t => t.id === id).loader();
        mod.init(panels[id]);
      } catch (e) {
        panels[id].innerHTML = `<div class="loading">Failed to load: ${e}</div>`;
      }
    }
  }

  activate('parser');
}

function css() {
  return `
.sql-wrap {
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
  overflow: hidden;
}
.sql-inner-tabs {
  display: flex;
  justify-content: center;
  gap: 6px;
  padding: 6px 12px 0;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.sql-inner-tab {
  padding: 8px 28px;
  font-size: 13px;
  font-weight: 500;
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  color: var(--text-muted);
  cursor: pointer;
  letter-spacing: 0.2px;
  transition: color 0.15s ease, border-color 0.15s ease;
}
.sql-inner-tab:hover:not(.active) { color: var(--text); }
.sql-inner-tab.active {
  color: var(--accent, #3b82f6);
  border-bottom-color: var(--accent, #3b82f6);
  font-weight: 600;
}
.sql-inner-panel {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 12px 16px;
}
`;
}
