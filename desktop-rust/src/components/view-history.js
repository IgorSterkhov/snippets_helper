const VIEW_HISTORY_LIMIT = 20;

function normalizeEntry(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const moduleId = String(raw.moduleId || '').trim();
  const key = String(raw.key || '').trim();
  if (!moduleId || !key) return null;
  return {
    key,
    moduleId,
    objectType: String(raw.objectType || raw.moduleId || 'module'),
    objectId: raw.objectId ?? null,
    objectUuid: raw.objectUuid || null,
    title: String(raw.title || raw.label || moduleId),
    label: String(raw.label || raw.title || moduleId),
    icon: String(raw.icon || ''),
    detail: raw.detail && typeof raw.detail === 'object' ? { ...raw.detail } : {},
  };
}

function isModalOpen() {
  return !!document.querySelector('.modal-overlay');
}

function isPlainCtrlTab(event) {
  return event.key === 'Tab' && event.ctrlKey && !event.altKey && !event.metaKey;
}

export function installViewHistory({ tabContainer, tabs }) {
  const tabMeta = new Map((tabs || []).map(tab => [tab.id, tab]));
  const entries = [];
  let overlay = null;
  let cycleSnapshot = [];
  let cycleIndex = -1;
  let ctrlSequenceActive = false;
  let suppressRecord = false;
  let disposed = false;

  function activeModuleId() {
    return tabContainer?.activeTabId || window.__keyboardHelperActiveTab || '';
  }

  function enrichEntry(entry) {
    const tab = tabMeta.get(entry.moduleId);
    return {
      ...entry,
      label: entry.label || tab?.label || entry.moduleId,
      icon: entry.icon || tab?.icon || '',
    };
  }

  function record(raw) {
    if (disposed || suppressRecord) return;
    const entry = normalizeEntry(raw);
    if (!entry) return;
    if (entry.moduleId !== activeModuleId()) return;
    const enriched = enrichEntry(entry);
    const existingIndex = entries.findIndex(item => item.key === enriched.key);
    if (existingIndex >= 0) entries.splice(existingIndex, 1);
    entries.unshift(enriched);
    if (entries.length > VIEW_HISTORY_LIMIT) entries.length = VIEW_HISTORY_LIMIT;
    window.__keyboardHelperViewHistory = entries;
  }

  function ensureModuleEntry(moduleId) {
    const tab = tabMeta.get(moduleId);
    if (!tab) return;
    record({
      key: `module:${moduleId}`,
      moduleId,
      objectType: 'module',
      objectId: null,
      title: tab.label || moduleId,
      label: tab.label || moduleId,
      icon: tab.icon || '',
      detail: {},
    });
  }

  function getCycleEntries() {
    return entries.slice(0, VIEW_HISTORY_LIMIT);
  }

  function closeOverlay() {
    overlay?.remove();
    overlay = null;
    cycleSnapshot = [];
    cycleIndex = -1;
  }

  function renderIcon(entry) {
    if (entry.icon && entry.icon.startsWith('logo:')) {
      const span = document.createElement('span');
      span.className = 'view-history-icon';
      span.textContent = entry.label.slice(0, 2).toUpperCase();
      return span;
    }
    const span = document.createElement('span');
    span.className = 'view-history-icon';
    span.textContent = entry.icon || entry.label.slice(0, 1).toUpperCase();
    return span;
  }

  function renderOverlay() {
    if (!cycleSnapshot.length || isModalOpen()) {
      closeOverlay();
      return;
    }
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = 'view-history-switcher';
      document.body.appendChild(overlay);
    }
    overlay.innerHTML = '';
    cycleSnapshot.forEach((entry, index) => {
      const item = document.createElement('div');
      item.className = 'view-history-item' + (index === cycleIndex ? ' active' : '');
      item.appendChild(renderIcon(entry));

      const text = document.createElement('span');
      text.className = 'view-history-title';
      text.textContent = entry.title || entry.label;
      item.appendChild(text);

      const label = document.createElement('span');
      label.className = 'view-history-label';
      label.textContent = entry.label || entry.moduleId;
      item.appendChild(label);

      overlay.appendChild(item);
    });
  }

  async function activateEntry(entry) {
    if (!entry || !tabContainer?.activate) return;
    suppressRecord = true;
    try {
      await tabContainer.activate(entry.moduleId);
      window.dispatchEvent(new CustomEvent('view-history:open', { detail: entry }));
    } finally {
      suppressRecord = false;
    }
    record(entry);
  }

  async function cycle(delta, { showSwitcher }) {
    if (!cycleSnapshot.length) {
      cycleSnapshot = getCycleEntries();
      cycleIndex = 0;
    }
    if (!cycleSnapshot.length) return;
    cycleIndex = (cycleIndex + delta + cycleSnapshot.length) % cycleSnapshot.length;
    if (showSwitcher) renderOverlay();
    await activateEntry(cycleSnapshot[cycleIndex]);
    if (showSwitcher) renderOverlay();
  }

  async function onKeydown(event) {
    if (!isPlainCtrlTab(event)) return;
    if (isModalOpen()) {
      event.preventDefault();
      event.stopPropagation();
      ctrlSequenceActive = false;
      closeOverlay();
      return;
    }
    event.preventDefault();
    event.stopPropagation();

    const showSwitcher = ctrlSequenceActive;
    ctrlSequenceActive = true;
    await cycle(event.shiftKey ? -1 : 1, { showSwitcher });
  }

  function onKeyup(event) {
    if (event.key === 'Control') {
      ctrlSequenceActive = false;
      closeOverlay();
    }
  }

  function onEscape(event) {
    if (event.key !== 'Escape' || !overlay) return;
    event.preventDefault();
    ctrlSequenceActive = false;
    closeOverlay();
  }

  function onBlur() {
    ctrlSequenceActive = false;
    closeOverlay();
  }

  function onRecord(event) {
    record(event.detail || {});
  }

  document.addEventListener('keydown', onKeydown, true);
  document.addEventListener('keyup', onKeyup, true);
  document.addEventListener('keydown', onEscape, true);
  window.addEventListener('blur', onBlur);
  window.addEventListener('view-history:record', onRecord);

  return {
    record,
    ensureModuleEntry,
    dispose() {
      disposed = true;
      closeOverlay();
      document.removeEventListener('keydown', onKeydown, true);
      document.removeEventListener('keyup', onKeyup, true);
      document.removeEventListener('keydown', onEscape, true);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('view-history:record', onRecord);
    },
  };
}
