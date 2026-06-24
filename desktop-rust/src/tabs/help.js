import { call } from '../tauri-api.js';

// ── i18n ─────────────────────────────────────────────────────

const i18n = {
  en: {
    modal_title: 'Help',
    features_title: 'Features',
    hotkeys_title: 'Hotkeys',
    changelog_title: 'Changelog',

    // Features tab
    detached_windows_name: 'Detached module windows',
    detached_windows_desc: 'Right-click a main sidebar module to open it in its own focused window without the main left sidebar. Each module has one detached window; opening it again brings that window back to the front.',
    sidebar_groups_name: 'Sidebar module groups',
    sidebar_groups_desc: 'Developer-oriented modules are grouped under the compact DEV sidebar button. SQL, Superset, Commits, Search, and ClickHouse expand below DEV when clicked or when one of them is active, including activation through Ctrl+Tab or app commands. Switching to another module collapses the group again.',
    view_history_name: 'Recent view switching',
    view_history_desc: 'Ctrl+Tab switches back to the previous recent view, such as the exact snippet, task, or note you had open. Press Ctrl+Tab repeatedly in the same sequence to show a compact switcher overlay and cycle through recent views; Ctrl+Shift+Tab cycles backward. The switcher ignores active modal dialogs.',
    html_cards_name: 'Sandbox HTML cards',
    html_cards_desc: 'Notes and Snippets can upload a single-file UTF-8 HTML artifact from the Markdown toolbar and insert it as a portable HTML Card token. Desktop previews and public share pages render the artifact in a sandboxed iframe with scripts allowed but same-origin access, external frames, network fetches, forms, workers, and object/embed content blocked by server CSP. Raw HTML typed directly into Markdown remains escaped.',
    telegraph_share_name: 'Telegra.ph publishing',
    telegraph_share_desc: 'The Share dialog can publish notes and snippets to Telegra.ph as Telegram-friendly snapshot pages. The server creates a per-user Telegra.ph account automatically, keeps the access token server-side, and lets the desktop copy/open or update the published page. Publishing requires outbound server access to Telegra.ph; failures open a persistent dialog with copyable diagnostics. Interactive HTML Cards degrade to safe links back to the sandboxed HTML asset.',

    shortcuts_name: 'Shortcuts',
    shortcuts_desc: 'Store and quickly access text snippets. Two-panel layout with searchable list and tabbed detail view for Code, Description, Links, Note, and Related snippets. The left panel can sort snippets by name (A-Z) or modified date (newest first), and remembers the selected mode. Search has a compact scope button for name-only or name/value/description search; spaces split queries into literal tokens matched in any order. Related navigation has Back, History, and Forward controls with a 10-item branch popover. The top strip has independent buttons for colored tag filters and synced pinned snippet chips, so both panels can be shown together; snippets can be pinned from the detail header, renamed chips update automatically, and tag/pinned chip order can be changed by drag-and-drop. The detail header can create, copy, preview, and revoke live public share links for snippets. Public snippet pages render Markdown-like value and description safely while preserving copyable plain-code snippets. The Markdown toolbar can upload server-optimized images or paste clipboard screenshots into snippet value or description and render them as Figure Cards in previews, mobile, and public share pages; desktop preview uses a native media fallback so server images display even when the WebView blocks remote image loading, and clicking a Figure Card image opens an interactive fit/actual-size viewer with Ctrl+wheel zoom and drag pan. The image preview shows the current variant name and supports previous/next buttons plus keyboard arrows. Image upload errors open a persistent modal with copyable diagnostics for reporting failed uploads, processing, or previews. Optional tabs appear only when content exists; if only Code is available, the tab strip is hidden. Filter by colored tags (glob patterns). Key Cloud derives stable colored keys from underscore-separated snippet names, shows their frequency in a packed zoomable cloud with Fit, pan, adaptive labels, full-key tooltips, persistent cache, selectable Dense/Fast layout algorithms, and no-cache progress while the layout is rebuilt; clicking a key runs search for it while clearing the tag filter. Related ranks snippets by shared keys. Rendered Markdown code blocks have copy buttons, compact language headers, and tolerate leading spaces before triple-backtick fences. The editor toolbar can insert inline or fenced code blocks, and the quote button toggles Markdown blockquotes on selected lines. The editor autosaves a local draft while typing, asks before discarding unsaved changes on Escape/Cancel, and can restore the draft when New/Edit is opened again. Links open explicitly in the browser or a separate app window. Description is collapsed by default while editing to leave more room for code. Expandable card preview in the list. Markdown auto-rendering. Obsidian note integration. Copy values instantly with Enter. Ctrl+Alt+K opens a compact code snippet picker for `code_` snippets and inserts the selected value into the previous external window on Windows, or copies it when focus restore is unavailable.',

    notes_name: 'Notes',
    notes_desc: 'Organize notes in nested folders (tree view with arbitrary depth). The folder tree uses stable file-explorer rows, supports drag-and-drop by the left grip to reorder folders or drop one folder onto another as a child, has a draggable divider for resizing the folder pane, and keeps folder actions in a right-click menu instead of reserving inline action-button space; the width is remembered on this device. Built-in Markdown editor with toolbar and live preview. The toolbar can upload server-optimized images, paste clipboard screenshots, toggle Markdown blockquotes, and insert portable Markdown image links that render as Figure Cards on desktop, mobile, and public share pages; desktop preview uses a native media fallback so server images display even when the WebView blocks remote image loading, and clicking a Figure Card image opens an interactive fit/actual-size viewer with Ctrl+wheel zoom and drag pan. The image preview shows the current variant name and supports previous/next buttons plus keyboard arrows. Image upload errors open a persistent modal with copyable diagnostics for reporting failed uploads, processing, or previews. Notes can be shared through live public links that can be created, copied, previewed, and revoked from desktop or mobile; creating a note link saves current editor content and syncs it first, and the public note page renders safe Markdown. Expandable card previews in the note list. Auto markdown rendering on open. Pin important notes to the top and reorder pinned note chips by drag-and-drop.',

    ai_name: 'AI Agent',
    ai_desc: 'Ask DeepSeek from a dedicated AI tab without storing provider tokens on desktop or mobile; each sync API user saves their own server-side DeepSeek key and Telegram bot token in Settings > AI, and saved secrets are never shown back in the app. Settings can check the current user DeepSeek balance, open the DeepSeek usage cabinet, show a Telegram pairing command, rely on server-side automatic polling for bot messages, force a Poll now refresh when needed, list bound chats, and unbind chats without server console access. Chat mode answers in the tab, while Command mode can open Tasks, Notes, and Snippets, create tasks, and add or complete task checkboxes through local app commands so normal sync propagates the changes. Command mode can make a short follow-up pass after search-only plans, so requests such as finding a task and marking one checkbox done can continue without asking again. The AI tab help button explains Chat vs Command mode, Telegram behavior, voice input, and example prompts. The AI tab gear opens Agent Settings with per-user custom instructions, generated tool/capability visibility, immutable safety rules, and prompt preview that shows the planned commands without executing them. Desktop voice prompts have a Voice selector for local Whisper, Deepgram, or Yandex SpeechKit live transcription; cloud providers use local Whisper settings keys/models and insert the stopped live transcript into the AI prompt. Mobile voice prompts use Android speech recognition and require the APK build with microphone permission. Telegram bot support is server-side, automatically polled, deny-by-default, uses the DeepSeek key and Telegram bot token of the paired app user, and replies to "show task" with task properties plus nested checkbox state.',

    tasks_name: 'Tasks',
    tasks_desc: 'Personal task manager with hierarchical checkboxes (up to 3 levels), customizable categories and statuses with colors, draggable pinned chip strip, drag-and-drop card→dropdown to change category/status, checklist drag-and-drop that respects hidden completed items, persisted collapse state for checklist branches, inline keyboard editing (Enter creates a same-level checkbox directly after the current item; Tab/Shift+Tab change nesting and Tab auto-expands a collapsed new parent; ArrowUp at the start and ArrowDown at the end move between visible checkbox rows), Markdown notes per task, Tracker link + auxiliary links, optional collapsed-card auxiliary link shelf with configurable marker/color and draggable link chips, card background palette, completed items hidden by default, and 1-column, 2-column, and Focus view layouts. Focus view keeps filters and pinned chips visible, shows a searchable task index on the left, and opens the selected task on the right. Full sync with the server and mobile app.',
    finance_name: 'Finance',
    finance_desc: 'Finance lists for recurring payments, projects, one-time estimates, and general planning. Create list cards, choose one currency and list type, and maintain a compact nested expense tree with direct amount, date, note, and aggregate total columns. The list name, currency, and type autosave from the header, with a small save status instead of a separate Save button. Monthly lists use a day-of-month date, while project, one-time, and general lists use full dates. Parent totals are calculated as the parent direct amount plus all descendant amounts. Lists and tree rows can be reordered by drag-and-drop; rows can also be nested by dropping into another row. Row names support task-like keyboard editing: Enter creates the next same-level row, Tab/Shift+Tab changes nesting, and ArrowUp/ArrowDown move between visible rows at text boundaries. Finance uses one row type: rows with children become subtotal rows automatically, while level-based soft background bands keep same-depth rows visually consistent even when branches are collapsed. Monthly lists also have a Calendar tab: it reuses the same hierarchy, keeps structure editing on the Structure tab, shows a narrow Date column with the planned day of month, and tracks per-month payment facts on terminal rows with a checkbox and editable actual amount. Group rows show paid descendant totals, old months can be hidden or shown, and new month columns can be appended from the calendar toolbar. The Finance header gear opens display settings for band colors and fill order: Strong First colors from the top down, while Soft First colors from the bottom up so the last colored level is Soft. Colors are converted into dark-theme row tints that preserve the selected hue instead of being mixed transparently into the dark background. Finance lists and payment facts sync through the API, and lists can be shared as live public links.',

    sql_name: 'SQL Tools',
    sql_desc: 'A suite of SQL utilities with five sub-tools: Parser extracts table names from queries, Analyzer generates DDL analysis using templates, Macrosing wraps queries in Jinja macros, Formatter beautifies SQL code, and Obfuscator replaces sensitive values with placeholders.',

    superset_name: 'Superset',
    superset_desc: 'Tools for Apache Superset dashboards. Export extracts and processes ZIP archives, Validate checks report structure for errors, and SQL parses SQL queries from exported dashboard files.',

    commits_name: 'Commits',
    commits_desc: 'Build structured commit messages with customizable tags. Maintain a history of past commit messages for quick reuse. Manage commit tags from Settings.',

    settings_name: 'Settings',
    settings_desc: 'Configure sync, updates, display preferences, provider tokens, and per-tool options in a fixed-height two-pane settings window with a left navigation rail so every section remains visible. The left navigation rail keeps labels left-aligned and scrolls internally when needed. Settings > Updates can check native/frontend updates, revert a frontend hot update, and clear WebView frontend cache before reloading if macOS keeps showing an old frontend. Settings > AI stores the current sync user DeepSeek key and Telegram bot token on the server, can check DeepSeek balance, opens the DeepSeek usage cabinet in the browser, and manages Telegram chat pairing from the desktop UI. Server-appointed admins see an additional Users / Limits tab for checking user activity and storage usage, then adjusting each user media quota and max upload size. Admin assignment is intentionally not available in the UI and is done only by a server-side command.',

    exec_name: 'Exec',
    exec_desc: 'Run shell commands organised into Groups. Each group has a Slack-style auto-letter icon (colour from name) and a count of commands. Drag the ⋮⋮ grip on a command card to move it between groups (drop on the left panel) or reorder within the same group; click the grip without dragging for a "Move to…" popover. Click the command name to edit it in the Command Composer: name/group first, a dedicated monospace command panel, then shell/runtime metadata. Use template can generate SSH, SCP, rsync, and Local copy commands; SCP and rsync templates support multiple source files through the native file picker, destination folder picking for local targets, manual remote paths, and quoted paths with spaces. Local copy generates either encoded Windows PowerShell `Copy-Item` or POSIX `cp` commands for copying several local files into one local folder; PowerShell copy treats copy errors as terminating errors instead of a misleading success exit code. Per-card flat green Run-button on the left, Delete on the right. Group header has a ▶ Run all button — runs every command sequentially with a progress bar + per-command collapsible sections in the bottom console; fail-fast on first error, single Stop aborts the whole sequence. Per-command Shell selector: Host (cmd / sh) or WSL (Windows). WSL mode wraps the command in `wsl.exe [-d distro] -- bash -lc`, so SSH, rsync, git etc. use WSL\'s own ~/.ssh/config and keys. Distinct terminal-style aesthetic (JetBrains Mono throughout, phosphor-green accent on near-black, breadcrumb header).',

    search_name: 'Repo Search',
    search_desc: 'Search across local git repositories by filename (glob patterns), file content (uses ripgrep if available), or git history. Git search checks both commit messages and changed patch lines, so code-only changes are discoverable. Add named colored repos, group them, toggle which ones to search, and use the scope badge to confirm whether search runs across All, one group, or Ungrouped. The module header has standard Help and Settings buttons; Settings opens a scrollable repository/settings modal instead of an inline Search-panel drawer. Group tabs and repository chips can be reordered by drag-and-drop; repository chips can still be dragged onto group tabs to move repos between groups. Results are grouped by file with context preview on click; expanded content results keep syntax highlighting and line highlights together, provide local in-file search with next/previous navigation plus Open in editor and Copy path actions, and include a History mode with commit date/author metadata and highlighted per-file diffs. Tab auto-unloads after configurable timeout.',
    clickhouse_name: 'ClickHouse Docs',
    clickhouse_desc: 'A local ClickHouse documentation browser in the DEV group. It now uses a Reference Console layout: hierarchical source navigation on the left, section-first reading in the center, and a local index rail with cache state, section/page counts, last update time, and update summary on the right. It stores official ClickHouse raw Markdown docs in the local SQLite database, discovers the full Russian documentation tree through the GitHub Trees API, and parses large pages into section/function blocks. The module opens by loading only the navigation tree through async IPC; if the local cache is slow, it shows a slow-load state while the rest of the app stays usable. Selecting a page opens a lightweight section index with metadata and excerpts only, expands the active page in the left navigation, and fetching/rendering the full Markdown body happens only after selecting one section. Search also works at section/function granularity so large pages return the relevant block instead of the whole article. The merged Update docs control refreshes the local cache, shows live percentage and source-page progress while updating, then collapses to the last update time; its details segment opens the full update summary on demand. Update log shows added, changed, removed, or failed docs sources from recent update runs.',

    vps_name: 'VPS Management',
    vps_desc: 'Monitor remote servers via SSH. Add named servers with color coding, grouped by environment. Every tile shows inline CPU / RAM / Disk progress bars and a freshness timestamp. Explicit ↻ refresh per tile (click no longer auto-fetches) avoids unwanted SSH connections. Detailed analysis opens a resizable modal with disk tree drill-down, top memory processes, and raw SSH output. Drag ⋮⋮ grip to move a server between environments. Test connection before saving. Supports custom SSH key files and ports, plus one-time import from Windows and Windows-readable WSL SSH config files; repeated imports skip existing server names.',

    whisper_name: 'Whisper Voice Input',
    whisper_desc: 'Local voice dictation via whisper.cpp sidecar. Onboarding installer picks from 6 ggml models (tiny → large-v3) with progress download + SHA256 verify. Lazy server lifecycle: 0 RAM at idle → warm-up on first record → auto-unload after 5 min. Floating always-on-top overlay is positioned with extra bottom clearance, shows mic level, timer, explicit Recording/Stopping state, a recent-words ticker, and clickable Stop/Cancel controls from any focused window; overlay state/events are explicitly delivered to its own window, the overlay remains hit-testable without stealing focus from the dictation target, the overlay boot script is standalone, and the hidden overlay WebView reloads after frontend updates/before display. Global hotkey (default Ctrl+Alt+Space, toggle) respects the selected recognition engine and Live dictate mode and ignores rapid repeat events. The header has a `Recognition` engine selector for local Whisper, Deepgram, or Yandex SpeechKit, plus a `Live dictate` checkbox that is enabled only for cloud engines. With Live off, cloud engines record local WAV and send it to Deepgram/Yandex batch recognition after Stop; with Live on, interim text appears in the tab and overlay and finalized chunks are pasted into the active app. If Yandex batch recognition is selected without Folder ID, the header shows a warning and the Record/hotkey error explains that Folder ID is required or Live dictate can be enabled for streaming. Deepgram can use punctuation/smart formatting, and SpeechKit can use configurable Russian-first normalization, literary punctuation, profanity filtering, and phone formatting; cloud API keys/models/options are stored locally in Whisper settings and are not synced. Configurable inject method: clipboard, clipboard+Ctrl+V with restore, or typed simulation. Optional rule-based cleanup (filler words, capitalize) + external LLM API post-processing (fail-soft). Bundled local LLM post-processing via llama.cpp sidecar — installs Gemma 3 (1B or 4B GGUF Q4) on demand, same lazy-warm pattern as Whisper; second combobox in the tab header switches the active Gemma model. The right pane has two tabs — `Whisper output` and `Post-processed` — and the post-processed text persists in the history DB. A unified status strip below the meta line shows `💭 Transcribing… X.Xs` while whisper is working and `✨ N% · K/M tok · X.Xs` with a fill-bar while Gemma is streaming. Whisper/cloud-provider failures open a persistent diagnostics modal with Copy error, and live paste on Windows uses a layout-independent Ctrl+V shortcut. History of last 200 transcripts with provider/model metadata plus copy/paste/type/delete. Per-machine settings. RU + EN.',
    speech_provider_setup_name: 'Cloud speech provider setup',
    speech_provider_setup_desc: 'Deepgram: sign in to https://console.deepgram.com, open the project selector, choose the project, then create a Project API Key in the API Keys section and paste it into Settings > Whisper > Deepgram API Key. Yandex SpeechKit: sign in to https://console.yandex.cloud or https://aistudio.yandex.ru, create or select a cloud/folder with billing enabled, create a service account, grant it the `ai.speechkit-stt.user` role, create an API key for that service account, then paste the key secret value into Settings > Whisper > Yandex SpeechKit. Use the secret value, usually `AQVN...`, not the key ID, usually `aje...`; if the creation dialog is already closed, create a new API key because Yandex does not show the secret again. Yandex batch file recognition requires Folder ID, the folder identifier shown on the Yandex Cloud folder page; copy it into Settings > Whisper > Yandex SpeechKit. For Russian dictation, start with language `ru-RU`, text normalization enabled, and Literary text / punctuation enabled. Settings also expose profanity filtering and phone number formatting; these options affect SpeechKit normalized results and are not applied by Yandex in language `auto`. Cloud speech keys are local desktop settings, are not synced, and are used when that cloud recognition engine is selected for batch or Live dictate.',

    // Hotkeys tab
    hotkey_show_hide: 'Show / hide main window',
    hotkey_escape: 'Hide window to system tray',
    hotkey_enter: 'Copy selected snippet and hide window',
    hotkey_arrows: 'Navigate snippet list',
    hotkey_tab_switch: 'Switch between recent snippets, tasks, notes, and module views',
    hotkey_whisper: 'Whisper: start/stop local or live dictation (global)',
    hotkey_micro_picker: 'Open compact code snippet picker for `code_` snippets (global)',

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
    detached_windows_name: 'Отдельные окна модулей',
    detached_windows_desc: 'Кликните правой кнопкой по модулю в левой панели, чтобы открыть его в отдельном окне без основной левой панели. Для каждого модуля открывается одно окно; повторное открытие выводит его на передний план.',
    sidebar_groups_name: 'Группы модулей в sidebar',
    sidebar_groups_desc: 'Developer-модули сгруппированы под компактной кнопкой DEV в левой панели. SQL, Superset, Commits, Search и ClickHouse раскрываются под DEV по клику или когда один из них активен, включая переход через Ctrl+Tab или команды приложения. При переходе в другой модуль группа снова сворачивается.',
    view_history_name: 'Переключение недавних представлений',
    view_history_desc: 'Ctrl+Tab возвращает к предыдущему недавнему представлению: конкретному сниппету, задаче или заметке. Повторные Ctrl+Tab в той же последовательности показывают компактный switcher и перебирают недавние представления; Ctrl+Shift+Tab идет назад. При открытых модальных окнах переключатель не срабатывает.',
    html_cards_name: 'Sandbox HTML-карточки',
    html_cards_desc: 'В заметки и сниппеты можно загрузить single-file UTF-8 HTML из Markdown toolbar и вставить его как переносимый HTML Card token. Десктопный предпросмотр и публичные share-страницы показывают артефакт в sandbox iframe: scripts разрешены, но same-origin доступ, внешние iframe, сетевые fetch-запросы, формы, workers и object/embed блокируются серверным CSP. Raw HTML, введенный прямо в Markdown, остается экранированным текстом.',
    telegraph_share_name: 'Публикация в Telegra.ph',
    telegraph_share_desc: 'В Share-диалоге можно публиковать заметки и сниппеты в Telegra.ph как snapshot-страницы, удобные для Telegram. Сервер автоматически создает per-user Telegra.ph account, хранит access token только на сервере, а desktop дает скопировать/открыть или обновить опубликованную страницу. Для публикации нужен исходящий доступ сервера к Telegra.ph; ошибки открываются постоянной модалкой с копируемой диагностикой. Интерактивные HTML Cards упрощаются до безопасной ссылки на sandboxed HTML asset.',

    shortcuts_name: 'Сниппеты',
    shortcuts_desc: 'Храните и быстро используйте текстовые сниппеты. Двухпанельный интерфейс с поиском и детальным просмотром во вкладках Code, Description, Links, Note и Related. Левая панель умеет сортировать сниппеты по имени (A-Z) или по дате изменения (новые сверху) и запоминает выбранный режим. У поиска есть компактная кнопка области: только название или название/value/description; пробелы разбивают запрос на буквальные токены, которые ищутся в любом порядке. В Related-навигации есть Back, History и Forward с popover ветки до 10 элементов. Верхняя панель имеет независимые кнопки для цветных тегов и синхронизируемых чипов закрепленных сниппетов, поэтому обе панели можно показывать вместе; сниппет можно закрепить из детальной шапки, переименование автоматически обновляет чип, а порядок тегов и pinned-чипов меняется drag-and-drop. В детальной шапке можно создавать, копировать, открывать для проверки и отзывать живые публичные ссылки на сниппеты. Публичные страницы сниппетов безопасно рендерят Markdown-похожий value/description, а plain-code сниппеты остаются в копируемом preformatted-блоке. Markdown toolbar умеет загружать оптимизированные на сервере изображения или вставлять скриншоты из буфера обмена в value/description сниппета и показывать их как Figure Card в предпросмотре, мобильном приложении и публичных страницах; десктопный предпросмотр использует native media fallback, чтобы серверные картинки отображались даже при блокировке remote image в WebView, а клик по Figure Card открывает интерактивный viewer с режимами Fit/Actual size, Ctrl+wheel zoom и перетаскиванием изображения мышью. В предпросмотре изображения показывается текущий вариант, есть кнопки назад/вперед и переключение клавишами стрелок. Ошибки загрузки изображений открываются постоянной модалкой с копируемой диагностикой по upload, processing и preview. Дополнительные вкладки появляются только когда в них есть содержимое; если доступен только Code, строка вкладок скрыта. Фильтрация по цветным тегам (glob-паттерны). Key Cloud автоматически берёт стабильные цветные ключи из имён сниппетов, разделённых подчёркиваниями, показывает частотность в плотном масштабируемом облаке с Fit, перетаскиванием, адаптивными подписями, tooltip с полным ключом, persistent cache, выбором алгоритма Dense/Fast и progress bar при пересчёте без готового кэша; клик по ключу запускает поиск по нему и сбрасывает фильтр тегов. Related сортирует похожие сниппеты по общим ключам. В Markdown-блоках кода есть кнопка копирования, компактный header с языком и поддержка ведущих пробелов перед triple-backtick fence. Кнопка кода в редакторе умеет вставлять inline-код и fenced code block, а кнопка цитаты переключает Markdown blockquote для выделенных строк. Редактор автосохраняет локальный черновик во время ввода, предупреждает перед сбросом несохраненных изменений по Escape/Cancel и умеет восстановить черновик при следующем New/Edit. Ссылки открываются явно: в браузере или в отдельном окне приложения. Description при редактировании по умолчанию свернут, чтобы оставить больше места для кода. Раскрываемые карточки для быстрого предпросмотра. Авто-рендеринг Markdown. Интеграция с Obsidian. Копирование по Enter. Ctrl+Alt+K открывает компактный picker для `code_` сниппетов и вставляет выбранное значение в предыдущее внешнее окно на Windows либо копирует его, если восстановление фокуса недоступно.',

    notes_name: 'Заметки',
    notes_desc: 'Организуйте заметки во вложенных папках (древовидная структура). Дерево папок использует стабильные строки в стиле file explorer, поддерживает drag-and-drop за левый grip для сортировки или вложения папок, имеет перетаскиваемый разделитель для изменения ширины панели папок и переносит действия папки в меню по правому клику вместо резервирования места под inline-кнопки; ширина запоминается на этом устройстве. Встроенный Markdown-редактор с панелью инструментов и предпросмотром. Toolbar умеет загружать оптимизированные на сервере изображения, вставлять скриншоты из буфера обмена, переключать Markdown-цитаты и добавлять переносимые Markdown-ссылки, которые отображаются как Figure Card на десктопе, мобильном приложении и публичных страницах; десктопный предпросмотр использует native media fallback, чтобы серверные картинки отображались даже при блокировке remote image в WebView, а клик по Figure Card открывает интерактивный viewer с режимами Fit/Actual size, Ctrl+wheel zoom и перетаскиванием изображения мышью. В предпросмотре изображения показывается текущий вариант, есть кнопки назад/вперед и переключение клавишами стрелок. Ошибки загрузки изображений открываются постоянной модалкой с копируемой диагностикой по upload, processing и preview. Заметки можно публиковать через живые публичные ссылки, которые создаются, копируются, открываются для проверки и отзываются с десктопа или мобильного приложения; при создании ссылки десктоп сначала сохраняет текущий текст заметки и синхронизирует его, а публичная страница заметки рендерит безопасный Markdown. Раскрываемые карточки в списке заметок. Авто-рендеринг Markdown при открытии. Закрепление важных заметок и drag-and-drop порядок pinned-чипов.',

    ai_name: 'AI Agent',
    ai_desc: 'Отдельная вкладка AI позволяет обращаться к DeepSeek без хранения provider-токенов на десктопе или мобильном устройстве: каждый пользователь sync API сохраняет свой серверный DeepSeek-ключ и токен Telegram-бота в Settings > AI, и приложение никогда не показывает сохраненные секреты обратно. В Settings можно проверить баланс DeepSeek текущего пользователя, открыть кабинет DeepSeek usage, увидеть Telegram pairing-команду, положиться на автоматический серверный опрос сообщений бота, вручную нажать Poll now при необходимости, посмотреть привязанные чаты и отвязать чат без серверной консоли. В режиме Chat агент отвечает во вкладке, а в режиме Command может открывать задачи, заметки и сниппеты, создавать задачи, добавлять или отмечать чекбоксы через локальные команды приложения, после чего обычная синхронизация разносит изменения. Command mode умеет делать короткий follow-up после чистого поиска, поэтому запросы вроде найти задачу и отметить в ней чекбокс выполненным могут продолжиться без повторной команды. Кнопка справки на вкладке AI объясняет Chat/Command, Telegram-бота, голосовой ввод и примеры запросов. Шестеренка на вкладке AI открывает Agent Settings: пользовательские инструкции для текущего sync-пользователя, видимость доступных tools/capabilities, неизменяемые safety rules и preview prompt, который показывает план команд без выполнения. Голосовые запросы на десктопе имеют selector Voice: локальный Whisper, Deepgram или Yandex SpeechKit live transcription; облачные провайдеры используют локальные настройки ключа/модели из Whisper settings и вставляют остановленную live-расшифровку в AI prompt. На мобильном используется Android speech recognition, поэтому нужна APK-сборка с разрешением на микрофон. Telegram-бот работает на сервере, автоматически опрашивается, по умолчанию запрещает неизвестные чаты, использует DeepSeek-ключ и Telegram-токен привязанного пользователя приложения, а на "покажи задачу" отвечает свойствами задачи и вложенным состоянием чекбоксов.',

    tasks_name: 'Задачи',
    tasks_desc: 'Личный task-менеджер с иерархическими чекбоксами (до 3 уровней), настраиваемыми категориями и статусами с цветами, перетаскиваемой панелью чипов для запиненных задач, drag-and-drop карточки на dropdown для смены категории/статуса, drag-and-drop чекбоксов с учетом скрытых выполненных пунктов, сохранением свернутых веток чеклистов после OTA/перезапуска, inline-клавиатурой (Enter создает чекбокс того же уровня сразу после текущего; Tab/Shift+Tab меняют вложенность, а Tab автоматически раскрывает свернутого нового родителя; ArrowUp в начале и ArrowDown в конце текста переходят между видимыми чекбоксами), Markdown-заметками, Tracker-ссылкой + вспомогательными ссылками, опциональной панелью вспомогательных ссылок в collapsed-карточках с настраиваемым маркером/цветом и draggable link-чипами, палитрой фона карточек, скрытием выполненных пунктов по умолчанию, 1-колоночным, 2-колоночным и Focus view layout-ами. Focus view оставляет фильтры и запиненные чипы сверху, показывает слева поиск по задачам, а справа открывает выбранную задачу. Полная синхронизация с сервером и мобильным приложением.',
    finance_name: 'Финансы',
    finance_desc: 'Финансовые списки для регулярных платежей, проектов, одноразовых смет и общего планирования. Создавайте карточки списков, задавайте валюту и тип списка, ведите компактное вложенное дерево расходов с колонками прямой суммы, даты, заметки и агрегированного итога. Название списка, валюта и тип автоматически сохраняются из верхней панели, с небольшим статусом сохранения вместо отдельной кнопки Save. В месячных списках дата задается днем месяца, а в проектных, одноразовых и общих списках используется полная дата. Итог родителя считается как собственная сумма родителя плюс суммы всех потомков. Списки и строки дерева можно менять местами drag-and-drop; строки также можно вкладывать друг в друга drop-ом внутрь другой строки. Названия строк поддерживают клавиатурное редактирование как в задачах: Enter создает следующую строку того же уровня, Tab/Shift+Tab меняют вложенность, ArrowUp/ArrowDown переходят между видимыми строками на границах текста. В Finance используется один тип строки: строки с потомками автоматически становятся строками итогов, а мягкие фоновые полосы по уровням делают строки одного уровня визуально одинаковыми даже при свернутых ветках. У месячных списков также есть вкладка Calendar: она использует ту же иерархию, оставляет редактирование структуры на вкладке Structure, показывает узкую колонку Date с плановым днем месяца и хранит факты оплат по месяцам на терминальных строках через чекбокс и редактируемую фактическую сумму. В групповых строках показываются оплаченные итоги потомков, старые месяцы можно скрывать или показывать, а новые колонки месяцев добавляются из панели календаря. Шестеренка в заголовке Finance открывает настройки цветов уровней и порядка заливки: Strong First красит сверху вниз, а Soft First снизу вверх, чтобы последний закрашенный уровень был Soft. Цвета преобразуются в темные оттенки для строк с сохранением выбранного hue, а не смешиваются прозрачностью с темным фоном. Финансовые списки и факты оплат синхронизируются через API, а списки могут шариться live public links.',

    sql_name: 'SQL Инструменты',
    sql_desc: 'Набор SQL-утилит из пяти инструментов: Парсер извлекает имена таблиц из запросов, Анализатор генерирует анализ DDL по шаблонам, Макросинг оборачивает запросы в Jinja-макросы, Форматтер форматирует SQL-код, Обфускатор заменяет чувствительные данные заглушками.',

    superset_name: 'Superset',
    superset_desc: 'Инструменты для дашбордов Apache Superset. Экспорт извлекает и обрабатывает ZIP-архивы, Валидация проверяет структуру отчётов на ошибки, SQL разбирает SQL-запросы из экспортированных файлов дашбордов.',

    commits_name: 'Коммиты',
    commits_desc: 'Составляйте структурированные сообщения коммитов с настраиваемыми тегами. Ведите историю сообщений для быстрого повторного использования. Управляйте тегами коммитов в Настройках.',

    settings_name: 'Настройки',
    settings_desc: 'Настройка синхронизации, обновлений, внешнего вида, provider-токенов и параметров отдельных инструментов в двухпанельном окне фиксированной высоты с левой навигацией, где все разделы остаются видимыми. Левая навигация выравнивает подписи по левому краю и прокручивается внутри панели, если пунктов становится слишком много. Settings > Updates умеет проверять native/frontend-обновления, откатывать frontend hot update и очищать WebView frontend cache перед перезагрузкой, если macOS продолжает показывать старый frontend. Settings > AI сохраняет DeepSeek-ключ и Telegram bot token текущего sync-пользователя на сервере, умеет проверять баланс DeepSeek, открывать кабинет DeepSeek usage и управлять привязкой Telegram-чата из desktop UI. Администраторы, назначенные на сервере, видят дополнительную вкладку Users / Limits: там отображаются пользователи, последняя активность, использование хранилища, квота и максимальный размер загрузки. Назначение админов намеренно не доступно в UI и выполняется только серверной командой.',

    exec_name: 'Выполнение',
    exec_desc: 'Запускайте shell-команды, организованные в Группы (Groups). У каждой группы — авто-иконка в стиле Slack (буква + цвет, выводимый из имени) и счётчик команд. Тяните ⋮⋮ слева на карточке команды, чтобы перенести её в другую группу (drop на левую панель) или поменять порядок в пределах группы; клик по grip без перетаскивания открывает popover «Move to…». Клик по имени команды открывает Command Composer: сначала имя/группа, затем отдельная моноширинная панель команды, ниже shell/runtime параметры. Use template генерирует SSH, SCP, rsync и Local copy; в SCP и rsync можно выбрать несколько локальных файлов через нативный file picker, выбрать локальную папку назначения, вручную ввести remote paths и сохранить корректное quoting для путей с пробелами. Local copy генерирует encoded Windows PowerShell `Copy-Item` или POSIX `cp` для копирования нескольких локальных файлов в одну локальную папку; PowerShell-копирование переводит ошибки копирования в terminating errors, а не в ложный успешный exit code. Слева на карточке — плоская зелёная кнопка Run, справа — Delete. На хедере группы — кнопка ▶ Run all, последовательно прогоняет все команды с прогресс-баром и collapsible-секциями вывода в нижней консоли; fail-fast при первой ошибке, единственная Stop останавливает всю последовательность. У каждой команды свой selector Shell: Host (cmd / sh) или WSL (на Windows). В режиме WSL команда оборачивается в `wsl.exe [-d distro] -- bash -lc`, так что SSH, rsync, git и пр. используют ssh-конфиг и ключи из WSL. Отдельный терминальный стиль вкладки (JetBrains Mono всюду, phosphor-green акцент на почти-чёрном, breadcrumb сверху).',

    search_name: 'Поиск в репозиториях',
    search_desc: 'Поиск по локальным git-репозиториям: по имени файла (glob), по содержимому (ripgrep если установлен), по истории git. Git-поиск проверяет и сообщения коммитов, и измененные строки патча, поэтому можно найти изменения кода без совпадения в тексте коммита. Добавляйте именованные цветные репозитории, группируйте их, выбирайте где искать и проверяйте scope badge: All, конкретная группа или Ungrouped. В header модуля есть стандартные кнопки справки и настроек; Settings открывает прокручиваемую модалку репозиториев/настроек вместо inline-панели внутри Search. Вкладки групп и чипы репозиториев можно менять местами drag-and-drop; чипы репозиториев по-прежнему можно перетаскивать на вкладку группы для переноса между группами. Результаты группируются по файлу с превью контекста по клику; expanded-режим результатов по содержимому совмещает подсветку синтаксиса и подсветку строк, дает локальный поиск внутри файла со стрелками перехода, Open in editor и Copy path, а также History-режим с датой/автором коммита и подсвеченными diff. Вкладка выгружается из памяти при неиспользовании.',
    clickhouse_name: 'Документация ClickHouse',
    clickhouse_desc: 'Локальный справочник ClickHouse в группе DEV. Теперь он оформлен как Reference Console: слева иерархическая навигация по источникам, в центре чтение по секциям, справа локальный индекс с состоянием кэша, счетчиками секций/страниц, временем последнего обновления и итогом последнего апдейта. Модуль хранит официальные raw Markdown документы ClickHouse в локальной SQLite базе, обнаруживает полное дерево русской документации через GitHub Trees API и разбивает большие страницы на секции/функции. При открытии модуль загружает только дерево навигации через async IPC; если локальный кэш читается медленно, показывается состояние долгой загрузки, а остальная часть приложения остается доступной. Выбор страницы открывает легкое оглавление только с метаданными и короткими выдержками, активная страница раскрывается в левой навигации, а полный Markdown body загружается и рендерится только после выбора одной секции. Поиск тоже работает на уровне секций/функций, поэтому большие страницы возвращают нужный блок, а не всю статью. Объединенный control Update docs обновляет локальный кэш, во время апдейта показывает процент и текущую/общую страницу источника, а после завершения сворачивается до времени последнего обновления; его сегмент деталей открывает полную сводку по запросу. Update log показывает добавленные, измененные, удаленные или неудачно загруженные источники последних обновлений.',

    vps_name: 'Управление VPS',
    vps_desc: 'Мониторинг удалённых серверов по SSH. Именованные серверы с цветовым кодированием, группировка по окружениям. На каждой карточке inline-прогрессбары CPU / RAM / Disk + отметка свежести данных. Явный ↻ обновление на карточке (клик больше не фетчит сам — избегаем лишних SSH-коннектов). Детальный анализ открывает растягиваемую модалку с drill-down деревом диска, топом процессов по памяти и сырым SSH-выводом. Drag ⋮⋮ рукоятка — переносит сервер между окружениями. Тест подключения перед сохранением. Поддержка SSH-ключей и кастомных портов, а также разовый импорт из Windows и Windows-readable WSL SSH config файлов; повторный импорт пропускает уже существующие имена серверов.',

    whisper_name: 'Голосовой ввод Whisper',
    whisper_desc: 'Локальное распознавание речи через whisper.cpp-sidecar. Онбординг с выбором из 6 ggml-моделей (tiny → large-v3), скачивание с прогрессом и проверкой SHA256. Умный lifecycle: 0 RAM в idle → прогрев при первой записи → авто-выгрузка через 5 мин без активности. Плавающий overlay (всегда поверх) размещается с дополнительным нижним отступом, показывает уровень микрофона, таймер, явные состояния Recording/Stopping, строку последних распознанных слов и кликабельные Stop/Cancel из любого активного окна; события состояния явно доставляются в отдельное окно overlay, само окно остается hit-testable без перехвата фокуса у окна диктовки, boot-скрипт overlay автономный, а hidden WebView overlay перезагружается после frontend updates и перед показом. Глобальный hotkey (по умолчанию Ctrl+Alt+Space, toggle) учитывает выбранный recognition engine и Live dictate mode и игнорирует быстрые повторные события. В шапке есть selector `Recognition` для локального Whisper, Deepgram или Yandex SpeechKit, плюс checkbox `Live dictate`, который активен только для облачных движков. При выключенном Live облачный движок записывает локальный WAV и после Stop отправляет его в Deepgram/Yandex batch recognition; при включенном Live interim-текст виден во вкладке и overlay, а в активное приложение вставляются только finalized chunks. Если выбран Yandex batch recognition без Folder ID, header показывает предупреждение, а ошибка Record/hotkey объясняет, что нужен Folder ID или можно включить Live dictate для streaming-режима. Deepgram умеет punctuation/smart formatting, а SpeechKit может использовать настраиваемую русскоязычную нормализацию, literary punctuation, profanity filter и phone formatting; API keys/model/options хранятся локально в настройках Whisper и не синхронизируются. Настраиваемый метод вставки: clipboard, clipboard+Ctrl+V с восстановлением, или посимвольный набор. Опциональная чистка правилами (filler-слова, капитализация) + постобработка через внешний LLM API (fail-soft). Встроенная локальная LLM-постобработка через llama.cpp-sidecar — Gemma 3 (1B или 4B GGUF Q4) скачивается из Settings, тот же lazy-warm паттерн; второй комбобокс в шапке таба переключает активную Gemma-модель. Правая секция разбита на два таба — `Whisper output` и `Post-processed` — постобработанный текст сохраняется в истории. Под meta-строкой — единая статус-полоска: `💭 Transcribing… X.Xs` пока работает whisper и `✨ N% · K/M tok · X.Xs` с прогресс-баром во время стриминга Gemma. Ошибки Whisper/cloud provider открываются в постоянной диагностической модалке с Copy error, а live-вставка на Windows использует независимый от раскладки Ctrl+V. История последних 200 транскриптов с provider/model metadata и copy/paste/type/delete. Per-machine настройки. RU + EN.',
    speech_provider_setup_name: 'Настройка облачного распознавания',
    speech_provider_setup_desc: 'Deepgram: войдите в https://console.deepgram.com, выберите проект, откройте раздел API Keys, создайте Project API Key и вставьте его в Settings > Whisper > Deepgram API Key. Yandex SpeechKit: войдите в https://console.yandex.cloud или https://aistudio.yandex.ru, создайте или выберите cloud/folder с включенным billing, создайте service account, выдайте ему роль `ai.speechkit-stt.user`, создайте API key для этого service account и вставьте в Settings > Whisper > Yandex SpeechKit именно secret value ключа. Нужен secret value, обычно `AQVN...`, а не key ID, обычно `aje...`; если окно создания уже закрыто, создайте новый API key, потому что Yandex больше не показывает secret повторно. Для batch-распознавания файлов Yandex нужен Folder ID: это идентификатор папки на странице folder в Yandex Cloud; скопируйте его в Settings > Whisper > Yandex SpeechKit. Для русской диктовки начните с языка `ru-RU`, включенной text normalization и включенного Literary text / punctuation. В Settings также доступны profanity filter и phone number formatting; эти опции влияют на normalized results SpeechKit и не применяются Яндексом при language `auto`. Ключи облачного распознавания хранятся локально на десктопе, не синхронизируются и используются когда выбран соответствующий cloud recognition engine для batch или Live dictate.',

    // Hotkeys tab
    hotkey_show_hide: 'Показать / скрыть главное окно',
    hotkey_escape: 'Свернуть в системный трей',
    hotkey_enter: 'Скопировать выбранный сниппет и скрыть окно',
    hotkey_arrows: 'Навигация по списку сниппетов',
    hotkey_tab_switch: 'Переключение между недавними сниппетами, задачами, заметками и модулями',
    hotkey_whisper: 'Whisper: старт/стоп локальной или live-диктовки (глобально)',
    hotkey_micro_picker: 'Открыть компактный picker для `code_` сниппетов (глобально)',

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
    { name: t(lang, 'detached_windows_name'), desc: t(lang, 'detached_windows_desc') },
    { name: t(lang, 'sidebar_groups_name'), desc: t(lang, 'sidebar_groups_desc') },
    { name: t(lang, 'view_history_name'), desc: t(lang, 'view_history_desc') },
    { name: t(lang, 'html_cards_name'), desc: t(lang, 'html_cards_desc') },
    { name: t(lang, 'telegraph_share_name'), desc: t(lang, 'telegraph_share_desc') },
    { name: t(lang, 'shortcuts_name'), desc: t(lang, 'shortcuts_desc') },
    { name: t(lang, 'notes_name'),     desc: t(lang, 'notes_desc') },
    { name: t(lang, 'ai_name'),        desc: t(lang, 'ai_desc') },
    { name: t(lang, 'tasks_name'),     desc: t(lang, 'tasks_desc') },
    { name: t(lang, 'finance_name'),   desc: t(lang, 'finance_desc') },
    { name: t(lang, 'sql_name'),       desc: t(lang, 'sql_desc') },
    { name: t(lang, 'superset_name'),  desc: t(lang, 'superset_desc') },
    { name: t(lang, 'commits_name'),   desc: t(lang, 'commits_desc') },
    { name: t(lang, 'settings_name'),  desc: t(lang, 'settings_desc') },
    { name: t(lang, 'exec_name'),      desc: t(lang, 'exec_desc') },
    { name: t(lang, 'search_name'),    desc: t(lang, 'search_desc') },
    { name: t(lang, 'clickhouse_name'), desc: t(lang, 'clickhouse_desc') },
    { name: t(lang, 'vps_name'),       desc: t(lang, 'vps_desc') },
    { name: t(lang, 'whisper_name'),   desc: t(lang, 'whisper_desc') },
    { name: t(lang, 'speech_provider_setup_name'), desc: t(lang, 'speech_provider_setup_desc') },
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
    { key: 'Ctrl+Alt+K',                desc: t(lang, 'hotkey_micro_picker') },
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
