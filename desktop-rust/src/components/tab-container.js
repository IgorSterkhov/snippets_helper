/**
 * Render a tab icon. Supports:
 *   - plain emoji/text  →  "🔖"
 *   - Simple Icons logo →  "logo:apachesuperset" (must exist under icons/logos/<slug>.svg)
 */
function renderTabIcon(icon) {
  const raw = icon || '';
  if (raw.startsWith('logo:')) {
    const slug = raw.slice(5).replace(/[^a-z0-9-]/gi, '');
    const style = [
      'display:inline-block',
      'width:1em','height:1em',
      'vertical-align:middle',
      'background-color:currentColor',
      `mask-image:url(icons/logos/${slug}.svg)`,
      'mask-size:contain','mask-repeat:no-repeat','mask-position:center',
      `-webkit-mask-image:url(icons/logos/${slug}.svg)`,
      '-webkit-mask-size:contain','-webkit-mask-repeat:no-repeat','-webkit-mask-position:center',
    ].join(';');
    return `<span class="tab-icon tab-icon-logo" style="${style}"></span>`;
  }
  return `<span class="tab-icon">${raw}</span>`;
}

export class TabContainer {
  constructor(containerEl, tabs, options = {}) {
    this.tabs = tabs;
    this.groups = options.groups || [];
    this.loadedTabs = new Set();
    this.activeTabId = null;
    this.panels = {};
    this.buttons = {};
    this.groupButtons = {};
    this.groupChildren = {};
    this.groupExpanded = {};
    this.childToGroup = {};
    for (const group of this.groups) {
      this.groupExpanded[group.id] = false;
      for (const tabId of group.childIds || []) {
        this.childToGroup[tabId] = group.id;
      }
    }

    // Create tab bar (vertical sidebar)
    this.tabBar = document.createElement('div');
    this.tabBar.className = 'tab-bar';

    // Create content area
    this.contentArea = document.createElement('div');
    this.contentArea.className = 'tab-content';

    // Build tab buttons and panels
    const renderedGroups = new Set();
    for (const tab of tabs) {
      const groupId = this.childToGroup[tab.id];
      if (groupId) {
        if (!renderedGroups.has(groupId)) {
          const group = this.groups.find(g => g.id === groupId);
          if (group) this.createGroup(group);
          renderedGroups.add(groupId);
        }
      } else {
        const btn = this.createTabButton(tab);
        this.tabBar.appendChild(btn);
      }

      // Panel
      const panel = document.createElement('div');
      panel.className = 'tab-panel';
      panel.id = `panel-${tab.id}`;
      panel.style.display = 'none';
      panel.innerHTML = '<div class="loading">Loading...</div>';
      this.contentArea.appendChild(panel);
      this.panels[tab.id] = panel;
    }

    containerEl.appendChild(this.tabBar);
    containerEl.appendChild(this.contentArea);
    this.applyGroupStates();
  }

  createTabButton(tab, extraClass = '') {
    const btn = document.createElement('button');
    btn.className = `tab-btn${extraClass ? ' ' + extraClass : ''}`;
    btn.dataset.tabId = tab.id;
    const iconHtml = renderTabIcon(tab.icon);
    btn.innerHTML = `${iconHtml}<span class="tab-label">${tab.label}</span>`;
    btn.addEventListener('click', () => this.activate(tab.id));
    this.buttons[tab.id] = btn;
    return btn;
  }

  createGroup(group) {
    const wrap = document.createElement('div');
    wrap.className = 'tab-group';
    wrap.dataset.groupId = group.id;

    const btn = document.createElement('button');
    btn.className = 'tab-btn tab-group-btn';
    btn.dataset.groupId = group.id;
    btn.innerHTML = `${renderTabIcon(group.icon)}<span class="tab-label">${group.label}</span>`;
    btn.addEventListener('click', () => this.toggleGroup(group.id));
    wrap.appendChild(btn);
    this.groupButtons[group.id] = btn;

    const children = document.createElement('div');
    children.className = 'tab-group-children';
    for (const tabId of group.childIds || []) {
      const tab = this.tabs.find(t => t.id === tabId);
      if (!tab) continue;
      children.appendChild(this.createTabButton(tab, 'tab-group-child'));
    }
    wrap.appendChild(children);
    this.groupChildren[group.id] = children;
    this.tabBar.appendChild(wrap);
  }

  toggleGroup(groupId) {
    const group = this.groups.find(g => g.id === groupId);
    if (!group) return;
    if ((group.childIds || []).includes(this.activeTabId)) {
      this.groupExpanded[groupId] = true;
    } else {
      this.groupExpanded[groupId] = !this.groupExpanded[groupId];
    }
    this.applyGroupStates();
  }

  applyGroupStates() {
    for (const group of this.groups) {
      const hasActiveChild = (group.childIds || []).includes(this.activeTabId);
      const expanded = hasActiveChild || !!this.groupExpanded[group.id];
      const btn = this.groupButtons[group.id];
      const children = this.groupChildren[group.id];
      if (btn) {
        btn.classList.toggle('has-active-child', hasActiveChild);
        btn.classList.toggle('expanded', expanded);
        btn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
      }
      if (children) {
        children.classList.toggle('expanded', expanded);
        children.setAttribute('aria-hidden', expanded ? 'false' : 'true');
        for (const childButton of children.querySelectorAll('.tab-btn')) {
          childButton.tabIndex = expanded ? 0 : -1;
        }
      }
    }
  }

  async activate(tabId) {
    const tab = this.tabs.find(t => t.id === tabId);
    if (!tab) return;

    // Hide current panel
    if (this.activeTabId && this.panels[this.activeTabId]) {
      this.panels[this.activeTabId].style.display = 'none';
    }

    // Deactivate all buttons
    for (const btn of Object.values(this.buttons)) {
      btn.classList.remove('active');
    }

    // Activate target
    this.buttons[tabId].classList.add('active');
    this.panels[tabId].style.display = '';
    this.activeTabId = tabId;
    for (const group of this.groups) {
      if ((group.childIds || []).includes(tabId)) {
        this.groupExpanded[group.id] = true;
      } else {
        this.groupExpanded[group.id] = false;
      }
    }
    this.applyGroupStates();

    // Lazy-load if first time
    if (!this.loadedTabs.has(tabId)) {
      this.loadedTabs.add(tabId);
      try {
        await tab.loader(this.panels[tabId]);
      } catch (err) {
        console.error(`Failed to load tab "${tabId}":`, err);
        this.panels[tabId].innerHTML = `<div class="loading">Failed to load tab</div>`;
      }
    }
  }
}
