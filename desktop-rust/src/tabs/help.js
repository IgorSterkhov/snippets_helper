import { call } from '../tauri-api.js';

// ── i18n ─────────────────────────────────────────────────────

const i18n = {
  en: {
    modal_title: 'Help',
    features_title: 'Features',
    hotkeys_title: 'Hotkeys',
    changelog_title: 'Changelog',

    // Features tab
    shortcuts_name: 'Shortcuts',
    shortcuts_desc: 'Store and quickly access text snippets. Two-panel layout with searchable list and detail view. Filter by colored tags (glob patterns). Attach links with embedded Web viewer. Expandable card preview in the list. Markdown auto-rendering. Obsidian note integration. Copy values instantly with Enter.',

    notes_name: 'Notes',
    notes_desc: 'Organize notes in nested folders (tree view with arbitrary depth). Built-in Markdown editor with toolbar and live preview. Expandable card previews in the note list. Auto markdown rendering on open. Pin important notes to the top.',

    sql_name: 'SQL Tools',
    sql_desc: 'A suite of SQL utilities with five sub-tools: Parser extracts table names from queries, Analyzer generates DDL analysis using templates, Macrosing wraps queries in Jinja macros, Formatter beautifies SQL code, and Obfuscator replaces sensitive values with placeholders.',

    superset_name: 'Superset',
    superset_desc: 'Tools for Apache Superset dashboards. Export extracts and processes ZIP archives, Validate checks report structure for errors, and SQL parses SQL queries from exported dashboard files.',

    commits_name: 'Commits',
    commits_desc: 'Build structured commit messages with customizable tags. Maintain a history of past commit messages for quick reuse. Manage commit tags from Settings.',

    exec_name: 'Exec',
    exec_desc: 'Run shell commands organized by categories. Create command groups, add frequently used commands, and execute them as subprocesses directly from the app. View real-time output and stop running processes.',

    search_name: 'Repo Search',
    search_desc: 'Search across local git repositories by filename (glob patterns), file content (uses ripgrep if available), or git history (commits and code changes). Add named colored repos, toggle which ones to search. Results grouped by file with context preview on click. Tab auto-unloads after configurable timeout.',

    // Hotkeys tab
    hotkey_show_hide: 'Show / hide main window',
    hotkey_escape: 'Hide window to system tray',
    hotkey_enter: 'Copy selected snippet and hide window',
    hotkey_arrows: 'Navigate snippet list',
    hotkey_tab_switch: 'Switch between tabs',

    // Changelog
    changelog_loading: 'Loading changelog...',
    changelog_error: 'Failed to load changelog.',
  },
  ru: {
    modal_title: 'Справка',
    features_title: 'Функции',
    hotkeys_title: 'Горячие клавиши',
    changelog_title: 'История изменений',

    // Features tab
    shortcuts_name: 'Сниппеты',
    shortcuts_desc: 'Храните и быстро используйте текстовые сниппеты. Двухпанельный интерфейс с поиском и детальным просмотром. Фильтрация по цветным тегам (glob-паттерны). Ссылки со встроенным Web-просмотром. Раскрываемые карточки для быстрого предпросмотра. Авто-рендеринг Markdown. Интеграция с Obsidian. Копирование по Enter.',

    notes_name: 'Заметки',
    notes_desc: 'Организуйте заметки во вложенных папках (древовидная структура). Встроенный Markdown-редактор с панелью инструментов и предпросмотром. Раскрываемые карточки в списке заметок. Авто-рендеринг Markdown при открытии. Закрепление важных заметок.',

    sql_name: 'SQL Инструменты',
    sql_desc: 'Набор SQL-утилит из пяти инструментов: Парсер извлекает имена таблиц из запросов, Анализатор генерирует анализ DDL по шаблонам, Макросинг оборачивает запросы в Jinja-макросы, Форматтер форматирует SQL-код, Обфускатор заменяет чувствительные данные заглушками.',

    superset_name: 'Superset',
    superset_desc: 'Инструменты для дашбордов Apache Superset. Экспорт извлекает и обрабатывает ZIP-архивы, Валидация проверяет структуру отчётов на ошибки, SQL разбирает SQL-запросы из экспортированных файлов дашбордов.',

    commits_name: 'Коммиты',
    commits_desc: 'Составляйте структурированные сообщения коммитов с настраиваемыми тегами. Ведите историю сообщений для быстрого повторного использования. Управляйте тегами коммитов в Настройках.',

    exec_name: 'Выполнение',
    exec_desc: 'Запускайте shell-команды, организованные по категориям. Создавайте группы команд, добавляйте часто используемые команды и выполняйте их как подпроцессы прямо из приложения. Просмотр вывода в реальном времени и остановка запущенных процессов.',

    search_name: 'Поиск в репозиториях',
    search_desc: 'Поиск по локальным git-репозиториям: по имени файла (glob), по содержимому (ripgrep если установлен), по истории git (коммиты и изменения кода). Добавляйте именованные цветные репозитории, выбирайте в каких искать. Результаты группируются по файлу с превью контекста по клику. Вкладка выгружается из памяти при неиспользовании.',

    // Hotkeys tab
    hotkey_show_hide: 'Показать / скрыть главное окно',
    hotkey_escape: 'Свернуть в системный трей',
    hotkey_enter: 'Скопировать выбранный сниппет и скрыть окно',
    hotkey_arrows: 'Навигация по списку сниппетов',
    hotkey_tab_switch: 'Переключение между вкладками',

    // Changelog
    changelog_loading: 'Загрузка истории изменений...',
    changelog_error: 'Не удалось загрузить историю изменений.',
  }
};

// ── Helpers ──────────────────────────────────────────────────

function el(tag, opts = {}) {
  const e = document.createElement(tag);
  if (opts.class) e.className = opts.class;
  if (opts.text) e.textContent = opts.text;
  if (opts.style) e.setAttribute('style', opts.style);
  if (opts.html) e.innerHTML = opts.html;
  return e;
}

async function getLang() {
  try {
    const lang = await call('get_setting', { key: 'ui_language' });
    return (lang === 'ru') ? 'ru' : 'en';
  } catch {
    return 'en';
  }
}

function t(lang, key) {
  return (i18n[lang] && i18n[lang][key]) || i18n.en[key] || key;
}

// ── Styles ───────────────────────────────────────────────────

let stylesInjected = false;

function injectHelpStyles() {
  if (stylesInjected) return;
  stylesInjected = true;

  const style = document.createElement('style');
  style.textContent = `
.help-modal {
  max-width: 680px;
  width: 95%;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  padding: 0;
}
.help-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px 12px;
  border-bottom: 1px solid var(--border);
}
.help-header h3 { margin: 0; }
.help-close-btn {
  padding: 4px 10px;
  min-width: auto;
  font-size: 14px;
}
.help-tab-strip {
  display: flex;
  gap: 0;
  border-bottom: 1px solid var(--border);
  padding: 0 12px;
}
.help-tab-btn {
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  color: var(--text-muted);
  padding: 10px 14px;
  font-size: 13px;
  cursor: pointer;
  white-space: nowrap;
  border-radius: 0;
  transition: color 0.15s, border-color 0.15s;
}
.help-tab-btn:hover {
  color: var(--text);
  background: transparent;
}
.help-tab-btn.active {
  color: var(--accent);
  border-bottom-color: var(--accent);
  background: transparent;
}
.help-body {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
}
.help-feature {
  margin-bottom: 16px;
}
.help-feature-name {
  font-weight: 600;
  font-size: 14px;
  color: var(--text);
  margin-bottom: 4px;
}
.help-feature-desc {
  font-size: 13px;
  color: var(--text-muted);
  line-height: 1.5;
}
.help-hotkey-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 10px;
  font-size: 13px;
}
.help-hotkey-key {
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 4px 10px;
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 12px;
  color: var(--accent);
  white-space: nowrap;
  min-width: 160px;
  text-align: center;
}
.help-hotkey-desc {
  color: var(--text-muted);
}
.help-changelog {
  font-size: 13px;
  color: var(--text-muted);
  line-height: 1.6;
  white-space: pre-wrap;
  font-family: inherit;
}
.help-changelog h2, .help-changelog h3 {
  color: var(--text);
  font-size: 14px;
  margin: 16px 0 6px 0;
}
.help-changelog h2:first-child, .help-changelog h3:first-child {
  margin-top: 0;
}
.help-changelog ul {
  margin: 4px 0;
  padding-left: 20px;
}
.help-changelog li {
  margin-bottom: 2px;
}
`;
  document.head.appendChild(style);
}

// ── Tab renderers ────────────────────────────────────────────

function renderFeatures(container, lang) {
  container.innerHTML = '';

  const features = [
    { name: t(lang, 'shortcuts_name'), desc: t(lang, 'shortcuts_desc') },
    { name: t(lang, 'notes_name'),     desc: t(lang, 'notes_desc') },
    { name: t(lang, 'sql_name'),       desc: t(lang, 'sql_desc') },
    { name: t(lang, 'superset_name'),  desc: t(lang, 'superset_desc') },
    { name: t(lang, 'commits_name'),   desc: t(lang, 'commits_desc') },
    { name: t(lang, 'exec_name'),      desc: t(lang, 'exec_desc') },
    { name: t(lang, 'search_name'),    desc: t(lang, 'search_desc') },
  ];

  for (const f of features) {
    const block = el('div', { class: 'help-feature' });
    block.appendChild(el('div', { class: 'help-feature-name', text: f.name }));
    block.appendChild(el('div', { class: 'help-feature-desc', text: f.desc }));
    container.appendChild(block);
  }
}

function renderHotkeys(container, lang) {
  container.innerHTML = '';

  const hotkeys = [
    { key: 'Alt + Space',              desc: t(lang, 'hotkey_show_hide') },
    { key: 'Escape',                   desc: t(lang, 'hotkey_escape') },
    { key: 'Enter',                    desc: t(lang, 'hotkey_enter') },
    { key: 'Arrow Up / Arrow Down',    desc: t(lang, 'hotkey_arrows') },
    { key: 'Ctrl+Tab / Ctrl+Shift+Tab', desc: t(lang, 'hotkey_tab_switch') },
  ];

  for (const h of hotkeys) {
    const row = el('div', { class: 'help-hotkey-row' });
    row.appendChild(el('span', { class: 'help-hotkey-key', text: h.key }));
    row.appendChild(el('span', { class: 'help-hotkey-desc', text: h.desc }));
    container.appendChild(row);
  }
}

async function renderChangelog(container, lang) {
  container.innerHTML = '';
  container.appendChild(el('div', { class: 'loading', text: t(lang, 'changelog_loading') }));

  try {
    const md = await call('get_changelog');
    container.innerHTML = '';

    // Simple markdown-to-HTML: headings, lists, bold, code
    const html = md
      .replace(/^### (.+)$/gm, '<h3>$1</h3>')
      .replace(/^## (.+)$/gm, '<h2>$1</h2>')
      .replace(/^# (.+)$/gm, '<h2>$1</h2>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/^- (.+)$/gm, '<li>$1</li>')
      .replace(/(<li>.*<\/li>\n?)+/gs, (m) => `<ul>${m}</ul>`)
      .replace(/\n{2,}/g, '<br>');

    const div = el('div', { class: 'help-changelog', html });
    container.appendChild(div);
  } catch (err) {
    container.innerHTML = '';
    container.appendChild(el('p', { text: t(lang, 'changelog_error') + ' ' + err }));
  }
}

// ── Main export ──────────────────────────────────────────────

export async function openHelpModal() {
  // Prevent duplicate modals
  if (document.querySelector('.help-overlay')) return;

  injectHelpStyles();

  const lang = await getLang();
  let activeTab = 'features';

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay help-overlay';

  const modal = document.createElement('div');
  modal.className = 'modal help-modal';

  // Header
  const header = el('div', { class: 'help-header' });
  header.appendChild(el('h3', { text: t(lang, 'modal_title') }));
  const closeBtn = el('button', { text: '\u2715', class: 'btn-secondary help-close-btn' });
  closeBtn.addEventListener('click', () => overlay.remove());
  header.appendChild(closeBtn);
  modal.appendChild(header);

  // Tab strip
  const tabs = [
    { id: 'features',  label: t(lang, 'features_title') },
    { id: 'hotkeys',   label: t(lang, 'hotkeys_title') },
    { id: 'changelog', label: t(lang, 'changelog_title') },
  ];

  const tabStrip = el('div', { class: 'help-tab-strip' });
  for (const tab of tabs) {
    const btn = el('button', {
      text: tab.label,
      class: 'help-tab-btn' + (tab.id === activeTab ? ' active' : ''),
    });
    btn.dataset.tabId = tab.id;
    btn.addEventListener('click', () => {
      activeTab = tab.id;
      tabStrip.querySelectorAll('.help-tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderTab(body, activeTab, lang);
    });
    tabStrip.appendChild(btn);
  }
  modal.appendChild(tabStrip);

  // Body
  const body = el('div', { class: 'help-body' });
  modal.appendChild(body);

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  // Close on overlay click
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });

  // Close on Escape
  function onKey(e) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      overlay.remove();
      document.removeEventListener('keydown', onKey, true);
    }
  }
  document.addEventListener('keydown', onKey, true);

  // Render initial tab
  renderTab(body, activeTab, lang);
}

function renderTab(container, tabId, lang) {
  switch (tabId) {
    case 'features':  renderFeatures(container, lang);  break;
    case 'hotkeys':   renderHotkeys(container, lang);   break;
    case 'changelog': renderChangelog(container, lang);  break;
  }
}
