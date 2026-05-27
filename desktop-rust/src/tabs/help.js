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
    shortcuts_desc: 'Store and quickly access text snippets. Two-panel layout with searchable list and tabbed detail view for Code, Description, Links, Note, and Related snippets. The left panel can sort snippets by name (A-Z) or modified date (newest first), and remembers the selected mode. The top strip can switch between colored tag filters and synced pinned snippet chips; snippets can be pinned from the detail header, renamed chips update automatically, and pinned chips can be reordered by drag-and-drop. The detail header can create, copy, preview, and revoke live public share links for snippets. The Markdown toolbar can upload server-optimized images or paste clipboard screenshots into snippet value or description and render them as Figure Cards in previews, mobile, and public share pages; desktop preview uses a native media fallback so server images display even when the WebView blocks remote image loading. Image upload errors open a persistent modal with copyable diagnostics for reporting failed uploads, processing, or previews. Optional tabs appear only when content exists; if only Code is available, the tab strip is hidden. Filter by colored tags (glob patterns). Key Cloud derives stable colored keys from underscore-separated snippet names, shows their frequency in a packed zoomable cloud with Fit, pan, adaptive labels, full-key tooltips, persistent cache, selectable Dense/Fast layout algorithms, and no-cache progress while the layout is rebuilt; clicking a key runs search for it while clearing the tag filter. Related ranks snippets by shared keys. Rendered Markdown code blocks have copy buttons, compact language headers, and tolerate leading spaces before triple-backtick fences. The editor toolbar can insert inline or fenced code blocks. Links open explicitly in the browser or a separate app window. Description is collapsed by default while editing to leave more room for code. Expandable card preview in the list. Markdown auto-rendering. Obsidian note integration. Copy values instantly with Enter.',

    notes_name: 'Notes',
    notes_desc: 'Organize notes in nested folders (tree view with arbitrary depth). Built-in Markdown editor with toolbar and live preview. The toolbar can upload server-optimized images, paste clipboard screenshots, and insert portable Markdown image links that render as Figure Cards on desktop, mobile, and public share pages; desktop preview uses a native media fallback so server images display even when the WebView blocks remote image loading. Image upload errors open a persistent modal with copyable diagnostics for reporting failed uploads, processing, or previews. Notes can be shared through live public links that can be created, copied, previewed, and revoked from desktop or mobile; creating a note link saves current editor content and syncs it first. Expandable card previews in the note list. Auto markdown rendering on open. Pin important notes to the top and reorder pinned note chips by drag-and-drop.',

    tasks_name: 'Tasks',
    tasks_desc: 'Personal task manager with hierarchical checkboxes (up to 3 levels), customizable categories and statuses with colors, draggable pinned chip strip, drag-and-drop card→dropdown to change category/status, checklist drag-and-drop that respects hidden completed items, persisted collapse state for checklist branches, inline keyboard editing (Enter/Tab/Shift+Tab), Markdown notes per task, Tracker link + auxiliary links, card background palette, completed items hidden by default, and 1-column, 2-column, and Focus view layouts. Focus view keeps filters and pinned chips visible, shows a searchable task index on the left, and opens the selected task on the right. Full sync with the server and mobile app.',

    sql_name: 'SQL Tools',
    sql_desc: 'A suite of SQL utilities with five sub-tools: Parser extracts table names from queries, Analyzer generates DDL analysis using templates, Macrosing wraps queries in Jinja macros, Formatter beautifies SQL code, and Obfuscator replaces sensitive values with placeholders.',

    superset_name: 'Superset',
    superset_desc: 'Tools for Apache Superset dashboards. Export extracts and processes ZIP archives, Validate checks report structure for errors, and SQL parses SQL queries from exported dashboard files.',

    commits_name: 'Commits',
    commits_desc: 'Build structured commit messages with customizable tags. Maintain a history of past commit messages for quick reuse. Manage commit tags from Settings.',

    settings_name: 'Settings',
    settings_desc: 'Configure sync, updates, display preferences, and per-tool options. Server-appointed admins see an additional Users / Limits tab for checking user activity and storage usage, then adjusting each user media quota and max upload size. Admin assignment is intentionally not available in the UI and is done only by a server-side command.',

    exec_name: 'Exec',
    exec_desc: 'Run shell commands organised into Groups. Each group has a Slack-style auto-letter icon (colour from name) and a count of commands. Drag the ⋮⋮ grip on a command card to move it between groups (drop on the left panel) or reorder within the same group; click the grip without dragging for a "Move to…" popover. Click the command name to edit it (the modal also has a Group dropdown). Per-card flat green Run-button on the left, Delete on the right. Group header has a ▶ Run all button — runs every command sequentially with a progress bar + per-command collapsible sections in the bottom console; fail-fast on first error, single Stop aborts the whole sequence. Per-command Shell selector: Host (cmd / sh) or WSL (Windows). WSL mode wraps the command in `wsl.exe [-d distro] -- bash -lc`, so SSH, rsync, git etc. use WSL\'s own ~/.ssh/config and keys. Distinct terminal-style aesthetic (JetBrains Mono throughout, phosphor-green accent on near-black, breadcrumb header).',

    search_name: 'Repo Search',
    search_desc: 'Search across local git repositories by filename (glob patterns), file content (uses ripgrep if available), or git history (commits and code changes). Add named colored repos, toggle which ones to search. Results grouped by file with context preview on click. Tab auto-unloads after configurable timeout.',

    vps_name: 'VPS Management',
    vps_desc: 'Monitor remote servers via SSH. Add named servers with color coding, grouped by environment. Every tile shows inline CPU / RAM / Disk progress bars and a freshness timestamp. Explicit ↻ refresh per tile (click no longer auto-fetches) avoids unwanted SSH connections. Detailed analysis opens a resizable modal with disk tree drill-down, top memory processes, and raw SSH output. Drag ⋮⋮ grip to move a server between environments. Test connection before saving. Supports custom SSH key files and ports.',

    whisper_name: 'Whisper Voice Input',
    whisper_desc: 'Local voice dictation via whisper.cpp sidecar. Onboarding installer picks from 6 ggml models (tiny → large-v3) with progress download + SHA256 verify. Lazy server lifecycle: 0 RAM at idle → warm-up on first record → auto-unload after 5 min. Floating always-on-top overlay shows mic level, timer, state from any focused window. Global hotkey (default Ctrl+Alt+Space, toggle). Configurable inject method: clipboard, clipboard+Ctrl+V with restore, or typed simulation. Optional rule-based cleanup (filler words, capitalize) + external LLM API post-processing (fail-soft). Bundled local LLM post-processing via llama.cpp sidecar — installs Gemma 3 (1B or 4B GGUF Q4) on demand, same lazy-warm pattern as Whisper; second combobox in the tab header switches the active Gemma model side-by-side with the Whisper one. The right pane has two tabs — `Whisper output` and `Post-processed` — and the post-processed text persists in the history DB. A unified status strip below the meta line shows `💭 Transcribing… X.Xs` while whisper is working and `✨ N% · K/M tok · X.Xs` with a fill-bar while Gemma is streaming. History of last 200 transcripts with copy/paste/type/delete. Per-machine settings. RU + EN.',

    // Hotkeys tab
    hotkey_show_hide: 'Show / hide main window',
    hotkey_escape: 'Hide window to system tray',
    hotkey_enter: 'Copy selected snippet and hide window',
    hotkey_arrows: 'Navigate snippet list',
    hotkey_tab_switch: 'Switch between tabs',
    hotkey_whisper: 'Whisper: start/stop voice recording (global)',

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
    shortcuts_desc: 'Храните и быстро используйте текстовые сниппеты. Двухпанельный интерфейс с поиском и детальным просмотром во вкладках Code, Description, Links, Note и Related. Левая панель умеет сортировать сниппеты по имени (A-Z) или по дате изменения (новые сверху) и запоминает выбранный режим. Верхняя панель переключается между цветными тегами и синхронизируемыми чипами закрепленных сниппетов; сниппет можно закрепить из детальной шапки, переименование автоматически обновляет чип, а порядок pinned-чипов меняется drag-and-drop. В детальной шапке можно создавать, копировать, открывать для проверки и отзывать живые публичные ссылки на сниппеты. Markdown toolbar умеет загружать оптимизированные на сервере изображения или вставлять скриншоты из буфера обмена в value/description сниппета и показывать их как Figure Card в предпросмотре, мобильном приложении и публичных страницах; десктопный предпросмотр использует native media fallback, чтобы серверные картинки отображались даже при блокировке remote image в WebView. Ошибки загрузки изображений открываются постоянной модалкой с копируемой диагностикой по upload, processing и preview. Дополнительные вкладки появляются только когда в них есть содержимое; если доступен только Code, строка вкладок скрыта. Фильтрация по цветным тегам (glob-паттерны). Key Cloud автоматически берёт стабильные цветные ключи из имён сниппетов, разделённых подчёркиваниями, показывает частотность в плотном масштабируемом облаке с Fit, перетаскиванием, адаптивными подписями, tooltip с полным ключом, persistent cache, выбором алгоритма Dense/Fast и progress bar при пересчёте без готового кэша; клик по ключу запускает поиск по нему и сбрасывает фильтр тегов. Related сортирует похожие сниппеты по общим ключам. В Markdown-блоках кода есть кнопка копирования, компактный header с языком и поддержка ведущих пробелов перед triple-backtick fence. Кнопка кода в редакторе умеет вставлять inline-код и fenced code block. Ссылки открываются явно: в браузере или в отдельном окне приложения. Description при редактировании по умолчанию свернут, чтобы оставить больше места для кода. Раскрываемые карточки для быстрого предпросмотра. Авто-рендеринг Markdown. Интеграция с Obsidian. Копирование по Enter.',

    notes_name: 'Заметки',
    notes_desc: 'Организуйте заметки во вложенных папках (древовидная структура). Встроенный Markdown-редактор с панелью инструментов и предпросмотром. Toolbar умеет загружать оптимизированные на сервере изображения, вставлять скриншоты из буфера обмена и добавлять переносимые Markdown-ссылки, которые отображаются как Figure Card на десктопе, мобильном приложении и публичных страницах; десктопный предпросмотр использует native media fallback, чтобы серверные картинки отображались даже при блокировке remote image в WebView. Ошибки загрузки изображений открываются постоянной модалкой с копируемой диагностикой по upload, processing и preview. Заметки можно публиковать через живые публичные ссылки, которые создаются, копируются, открываются для проверки и отзываются с десктопа или мобильного приложения; при создании ссылки десктоп сначала сохраняет текущий текст заметки и синхронизирует его. Раскрываемые карточки в списке заметок. Авто-рендеринг Markdown при открытии. Закрепление важных заметок и drag-and-drop порядок pinned-чипов.',

    tasks_name: 'Задачи',
    tasks_desc: 'Личный task-менеджер с иерархическими чекбоксами (до 3 уровней), настраиваемыми категориями и статусами с цветами, перетаскиваемой панелью чипов для запиненных задач, drag-and-drop карточки на dropdown для смены категории/статуса, drag-and-drop чекбоксов с учетом скрытых выполненных пунктов, сохранением свернутых веток чеклистов после OTA/перезапуска, inline-клавиатурой (Enter/Tab/Shift+Tab), Markdown-заметками, Tracker-ссылкой + вспомогательными ссылками, палитрой фона карточек, скрытием выполненных пунктов по умолчанию, 1-колоночным, 2-колоночным и Focus view layout-ами. Focus view оставляет фильтры и запиненные чипы сверху, показывает слева поиск по задачам, а справа открывает выбранную задачу. Полная синхронизация с сервером и мобильным приложением.',

    sql_name: 'SQL Инструменты',
    sql_desc: 'Набор SQL-утилит из пяти инструментов: Парсер извлекает имена таблиц из запросов, Анализатор генерирует анализ DDL по шаблонам, Макросинг оборачивает запросы в Jinja-макросы, Форматтер форматирует SQL-код, Обфускатор заменяет чувствительные данные заглушками.',

    superset_name: 'Superset',
    superset_desc: 'Инструменты для дашбордов Apache Superset. Экспорт извлекает и обрабатывает ZIP-архивы, Валидация проверяет структуру отчётов на ошибки, SQL разбирает SQL-запросы из экспортированных файлов дашбордов.',

    commits_name: 'Коммиты',
    commits_desc: 'Составляйте структурированные сообщения коммитов с настраиваемыми тегами. Ведите историю сообщений для быстрого повторного использования. Управляйте тегами коммитов в Настройках.',

    settings_name: 'Настройки',
    settings_desc: 'Настройка синхронизации, обновлений, внешнего вида и параметров отдельных инструментов. Администраторы, назначенные на сервере, видят дополнительную вкладку Users / Limits: там отображаются пользователи, последняя активность, использование хранилища, квота и максимальный размер загрузки. Назначение админов намеренно не доступно в UI и выполняется только серверной командой.',

    exec_name: 'Выполнение',
    exec_desc: 'Запускайте shell-команды, организованные в Группы (Groups). У каждой группы — авто-иконка в стиле Slack (буква + цвет, выводимый из имени) и счётчик команд. Тяните ⋮⋮ слева на карточке команды, чтобы перенести её в другую группу (drop на левую панель) или поменять порядок в пределах группы; клик по grip без перетаскивания открывает popover «Move to…». Клик по имени команды — редактирование (в модалке также есть dropdown «Группа»). Слева на карточке — плоская зелёная кнопка Run, справа — Delete. На хедере группы — кнопка ▶ Run all, последовательно прогоняет все команды с прогресс-баром и collapsible-секциями вывода в нижней консоли; fail-fast при первой ошибке, единственная Stop останавливает всю последовательность. У каждой команды свой selector Shell: Host (cmd / sh) или WSL (на Windows). В режиме WSL команда оборачивается в `wsl.exe [-d distro] -- bash -lc`, так что SSH, rsync, git и пр. используют ssh-конфиг и ключи из WSL. Отдельный терминальный стиль вкладки (JetBrains Mono всюду, phosphor-green акцент на почти-чёрном, breadcrumb сверху).',

    search_name: 'Поиск в репозиториях',
    search_desc: 'Поиск по локальным git-репозиториям: по имени файла (glob), по содержимому (ripgrep если установлен), по истории git (коммиты и изменения кода). Добавляйте именованные цветные репозитории, выбирайте в каких искать. Результаты группируются по файлу с превью контекста по клику. Вкладка выгружается из памяти при неиспользовании.',

    vps_name: 'Управление VPS',
    vps_desc: 'Мониторинг удалённых серверов по SSH. Именованные серверы с цветовым кодированием, группировка по окружениям. На каждой карточке inline-прогрессбары CPU / RAM / Disk + отметка свежести данных. Явный ↻ обновление на карточке (клик больше не фетчит сам — избегаем лишних SSH-коннектов). Детальный анализ открывает растягиваемую модалку с drill-down деревом диска, топом процессов по памяти и сырым SSH-выводом. Drag ⋮⋮ рукоятка — переносит сервер между окружениями. Тест подключения перед сохранением. Поддержка SSH-ключей и кастомных портов.',

    whisper_name: 'Голосовой ввод Whisper',
    whisper_desc: 'Локальное распознавание речи через whisper.cpp-sidecar. Онбординг с выбором из 6 ggml-моделей (tiny → large-v3), скачивание с прогрессом и проверкой SHA256. Умный lifecycle: 0 RAM в idle → прогрев при первой записи → авто-выгрузка через 5 мин без активности. Плавающий overlay (всегда поверх) показывает уровень микрофона, таймер и состояние из любого активного окна. Глобальный hotkey (по умолчанию Ctrl+Alt+Space, toggle). Настраиваемый метод вставки: clipboard, clipboard+Ctrl+V с восстановлением, или посимвольный набор. Опциональная чистка правилами (filler-слова, капитализация) + постобработка через внешний LLM API (fail-soft). Встроенная локальная LLM-постобработка через llama.cpp-sidecar — Gemma 3 (1B или 4B GGUF Q4) скачивается из Settings, тот же lazy-warm паттерн; второй комбобокс в шапке таба переключает активную Gemma-модель рядом с Whisper-моделью. Правая секция разбита на два таба — `Whisper output` и `Post-processed` — постобработанный текст сохраняется в истории. Под meta-строкой — единая статус-полоска: `💭 Transcribing… X.Xs` пока работает whisper и `✨ N% · K/M tok · X.Xs` с прогресс-баром во время стриминга Gemma. История последних 200 транскриптов с copy/paste/type/delete. Per-machine настройки. RU + EN.',

    // Hotkeys tab
    hotkey_show_hide: 'Показать / скрыть главное окно',
    hotkey_escape: 'Свернуть в системный трей',
    hotkey_enter: 'Скопировать выбранный сниппет и скрыть окно',
    hotkey_arrows: 'Навигация по списку сниппетов',
    hotkey_tab_switch: 'Переключение между вкладками',
    hotkey_whisper: 'Whisper: старт/стоп голосовой записи (глобально)',

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

async function loadChangelogMarkdown() {
  try {
    const url = new URL('../release-history.md', import.meta.url);
    const response = await fetch(url, { cache: 'no-store' });
    if (response.ok) {
      const md = (await response.text()).trim();
      if (md) return md;
    }
  } catch {
    // Older bundles do not have the frontend-owned release history asset.
  }

  return await call('get_changelog');
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
    { name: t(lang, 'tasks_name'),     desc: t(lang, 'tasks_desc') },
    { name: t(lang, 'sql_name'),       desc: t(lang, 'sql_desc') },
    { name: t(lang, 'superset_name'),  desc: t(lang, 'superset_desc') },
    { name: t(lang, 'commits_name'),   desc: t(lang, 'commits_desc') },
    { name: t(lang, 'settings_name'),  desc: t(lang, 'settings_desc') },
    { name: t(lang, 'exec_name'),      desc: t(lang, 'exec_desc') },
    { name: t(lang, 'search_name'),    desc: t(lang, 'search_desc') },
    { name: t(lang, 'vps_name'),       desc: t(lang, 'vps_desc') },
    { name: t(lang, 'whisper_name'),   desc: t(lang, 'whisper_desc') },
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
    { key: 'Ctrl+Alt+Space',            desc: t(lang, 'hotkey_whisper') },
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
    const md = await loadChangelogMarkdown();
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
