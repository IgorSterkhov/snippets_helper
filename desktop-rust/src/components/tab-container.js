export class TabContainer {
  constructor(containerEl, tabs) {
    this.tabs = tabs;
    this.loadedTabs = new Set();
    this.activeTabId = null;
    this.panels = {};
    this.buttons = {};

    // Create tab bar (vertical sidebar)
    this.tabBar = document.createElement('div');
    this.tabBar.className = 'tab-bar';

    // Create content area
    this.contentArea = document.createElement('div');
    this.contentArea.className = 'tab-content';

    // Build tab buttons and panels
    for (const tab of tabs) {
      // Button
      const btn = document.createElement('button');
      btn.className = 'tab-btn';
      btn.dataset.tabId = tab.id;
      btn.innerHTML = `<span class="tab-icon">${tab.icon}</span><span class="tab-label">${tab.label}</span>`;
      btn.addEventListener('click', () => this.activate(tab.id));
      this.tabBar.appendChild(btn);
      this.buttons[tab.id] = btn;

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
