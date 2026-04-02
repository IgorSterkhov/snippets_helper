# Keyboard Helper — Rust Edition

Полное переписывание десктопного приложения Keyboard Helper с Python/Tkinter на Rust/Tauri.
Работает параллельно с Python-версией как отдельное приложение.

## Мотивация

- Высокое потребление батареи на macOS из-за pynput (глобальный keyboard hook)
- Устаревший внешний вид Tkinter
- Возможность получить нативную производительность и минимальный расход ресурсов

## Архитектура

### Стек

- **Backend:** Rust (Tauri v2)
- **Frontend:** HTML/CSS/JS (Vanilla, без фреймворков)
- **БД:** SQLite (rusqlite)
- **HTTP:** reqwest (синхронизация)
- **UI:** WebView (системный, встроенный в Tauri)

### Компоненты

```
Tauri App
├── Rust Backend
│   ├── Native Hotkey (OS API)
│   ├── SQLite (rusqlite)
│   ├── Sync Client (reqwest)
│   ├── Clipboard
│   ├── System Tray
│   ├── SQL Handlers (parser, formatter, obfuscator)
│   ├── Exec (subprocess)
│   └── Autostart
├── WebView Frontend (HTML/CSS/JS)
│   ├── Shortcuts (сниппеты)
│   ├── Notes (markdown с превью)
│   ├── SQL Tools (5 под-вкладок)
│   ├── Superset (3 под-вкладки)
│   ├── Commits (построитель коммит-сообщений)
│   └── Exec (запуск команд)
└── IPC (Tauri invoke commands)
```

### Взаимодействие

Frontend вызывает Rust-команды через `window.__TAURI__.invoke()`. Каждый модуль (вкладка) имеет соответствующий набор команд в `src/commands/`.

## Структура проекта

### Rust backend (`src-tauri/`)

```
src/
├── main.rs                 — точка входа Tauri
├── lib.rs                  — регистрация команд
├── db/
│   ├── mod.rs              — подключение, миграции
│   ├── models.rs           — структуры данных
│   └── queries.rs          — CRUD-операции
├── commands/               — Tauri IPC commands
│   ├── shortcuts.rs
│   ├── notes.rs
│   ├── sql_tools.rs
│   ├── superset.rs
│   ├── commits.rs
│   ├── exec.rs
│   └── settings.rs
├── sync/
│   ├── client.rs           — HTTP push/pull (reqwest)
│   └── schema.rs           — таблицы для синхронизации
├── handlers/
│   ├── sql_parser.rs       — извлечение таблиц из SQL
│   ├── sql_formatter.rs    — форматирование SQL
│   └── sql_obfuscator.rs   — обфускация SQL
├── hotkey/
│   ├── mod.rs              — абстракция + выбор стратегии
│   ├── native.rs           — OS API (энергоэффективный)
│   └── polling.rs          — fallback (double shift и т.д.)
├── tray.rs                 — системный трей
├── clipboard.rs            — работа с буфером обмена
└── autostart.rs            — автозапуск (LaunchAgent на macOS, Start Menu на Windows)
```

### Web frontend (`src/`)

```
src/
├── index.html              — точка входа
├── main.js                 — инициализация, роутинг вкладок
├── styles.css              — глобальные стили, тёмная тема
├── tauri-api.js            — обёртка над invoke()
├── tabs/                   — ленивая загрузка
│   ├── shortcuts.js / .html
│   ├── notes.js / .html
│   ├── sql/
│   │   ├── sql-main.js     — контейнер + ленивая загрузка под-вкладок
│   │   ├── parser.js
│   │   ├── analyzer.js
│   │   ├── macrosing.js
│   │   ├── formatter.js
│   │   └── obfuscator.js
│   ├── superset/
│   │   ├── superset-main.js — контейнер + ленивая загрузка
│   │   ├── export.js
│   │   ├── validate.js
│   │   └── sql.js
│   ├── commits.js / .html
│   └── exec.js / .html
└── components/             — переиспользуемые
    ├── search-bar.js
    ├── tab-container.js
    ├── modal.js
    └── toast.js
```

## Ленивая загрузка вкладок

1. При запуске создаётся только оболочка с названиями вкладок
2. Активная вкладка (последняя использованная, из app_settings) загружается сразу
3. Остальные вкладки загружаются при первом клике (HTML + JS + данные из БД)
4. Загруженная вкладка кешируется в DOM до закрытия окна
5. Вложенные вкладки (SQL: 5 под-вкладок, Superset: 3 под-вкладки) — та же логика: при клике на родительскую загружается контейнер, дочерние по клику

## Описание модулей (вкладок)

### Shortcuts (сниппеты)

- Список сниппетов с полями: name, value, description
- Поиск по name
- Клик / Enter — копирует value в буфер обмена и закрывает окно
- CRUD: добавление, редактирование, удаление

### Notes (заметки)

- Древовидная структура: папки (`note_folders`) → заметки (`notes`)
- Редактор markdown с превью (WebView рендерит markdown нативно через JS-библиотеку)
- CRUD для папок и заметок

### SQL Tools (5 под-вкладок)

- **Parser** — извлечение имён таблиц из SQL-кода (SELECT, INSERT, JOIN, CTE и т.д.)
- **Table Analyzer** — генерация SELECT-запросов из ClickHouse DDL. Использует сохранённые шаблоны (`sql_table_analyzer_templates`)
- **Macrosing** — генерация вариаций SQL с подстановкой плейсхолдеров. Использует шаблоны (`sql_macrosing_templates`)
- **Format SQL** — форматирование SQL с поддержкой Jinja2-синтаксиса и кастомных ClickHouse-функций
- **Obfuscation** — анонимизация имён таблиц и колонок в SQL. Сохраняет маппинги (`obfuscation_mappings`) для консистентности

### Superset (3 под-вкладки)

- **Export report** — извлечение и обработка zip-архивов экспорта Superset
- **Validate report** — валидация YAML-файлов и именования файлов в экспорте
- **SQL** — парсинг SQL из Superset YAML-датасетов

### Commits (построитель коммит-сообщений)

- Форма: task link, task ID, commit type, object category, object value, message
- Условные поля в зависимости от категории (report URLs, test DAG и т.д.)
- Генерация commit-сообщения и chat-сообщения с тегами и MR-ссылками
- История коммитов (`commit_history`) — сохранение/восстановление состояния формы
- Управление тегами (`commit_tags`)

### Exec (запуск команд)

- Категории команд (`exec_categories`) с сортировкой
- Команды (`exec_commands`) внутри категорий: name, command, description, sort_order, hide_after_run
- Запуск через subprocess с захватом stdout/stderr
- Кнопка остановки выполнения

## Настройки (Settings)

Окно настроек с вкладками:

- **General** — ширина/высота окна, выбор хоткея, размер шрифта UI, автозапуск
- **Shortcuts** — размер шрифта, ширина левой панели
- **SQL Table Analyzer** — формат вывода (вертикальный), управление шаблонами
- **Commits** — управление тегами
- **SQL Formatter** — список кастомных ClickHouse-функций
- **Sync** — URL сервера, CA-сертификат, API-ключ, регистрация, вкл/выкл

Настройки хранятся в `app_settings` (key-value, per machine).

## Схема данных (SQLite)

### Синхронизируемые таблицы

| Таблица | Назначение |
|---------|-----------|
| `shortcuts` | Сниппеты: name, value, description |
| `note_folders` | Папки для заметок |
| `notes` | Заметки (markdown) |
| `sql_table_analyzer_templates` | DDL-шаблоны для анализатора |
| `sql_macrosing_templates` | Шаблоны SQL-вариаций |
| `obfuscation_mappings` | Маппинги обфускации SQL |

Дополнительные поля в каждой sync-таблице:
- `uuid` TEXT UNIQUE — уникальный ID записи
- `updated_at` TIMESTAMP — время последнего изменения
- `sync_status` TEXT — 'synced' | 'pending' | 'deleted'
- `user_id` TEXT — идентификатор пользователя

### Локальные таблицы

| Таблица | Назначение |
|---------|-----------|
| `app_settings` | Настройки приложения (key-value, per machine) |
| `superset_settings` | Настройки Superset (per machine) |
| `commit_tags` | Теги для Git-коммитов |
| `commit_history` | История коммитов (task_link, task_id, commit_type, object_category, object_value, message, selected_tags, mr_link, test_report, prod_report, transfer_connect, test_dag, created_at, computer_id) |
| `exec_categories` | Категории команд (name, sort_order) |
| `exec_commands` | Команды (category_id, name, command, description, sort_order, hide_after_run) |

## Синхронизация

### Протокол

Используется существующий Sync API (FastAPI + PostgreSQL) без изменений:
- `POST /v1/sync/push` — отправить pending записи
- `POST /v1/sync/pull` — получить обновления (JSON body: `{"last_sync_at": timestamp}`)

API не различает Rust-клиент и Python-клиент — формат данных идентичный.

### Момент синхронизации

**Осознанное изменение** по сравнению с Python-версией (где sync loop работает каждые 60 сек):

1. **Окно открывается (хоткей):** push pending → pull свежие данные
2. **Пользователь работает:** изменения пишутся в SQLite с sync_status = 'pending'. Никаких фоновых запросов.
3. **Окно закрывается (Esc / hide):** push — отправляем все pending записи. Асинхронно, не блокируя закрытие.

Если push/pull не прошёл (нет сети) — записи остаются pending и отправятся при следующем открытии.

### Первый запуск

При первом запуске Rust-версии локальная SQLite БД пуста. Приложение выполняет полный pull с сервера для загрузки всех данных. Требуется настроенное подключение к Sync API (URL + API key).

## Хоткей

### Два режима

| Режим | Доступные комбинации | Реализация | Энергопотребление |
|-------|---------------------|------------|-------------------|
| `native` (default) | Alt+Space (default), Ctrl+Space, Ctrl+Shift+Space, Ctrl+` | OS API (RegisterHotKey / CGEvent) | Минимальное |
| `polling` | Double Shift, Double Ctrl | Keyboard hook (аналог pynput) | Повышенное |

Пользователь выбирает режим и комбинацию в настройках. Дефолтная комбинация Alt+Space отличается от Python-версии (Ctrl+Space) для бесконфликтной параллельной работы.

## Автозапуск

- **macOS:** LaunchAgent plist (`~/Library/LaunchAgents/`)
- **Windows:** ярлык в Start Menu / Startup
- Включается/выключается в настройках (General)

## Совместимость

- Разные дефолтные хоткеи для параллельной работы с Python-версией
- Общий Sync API — данные синхронизируются между обеими версиями
- Отдельная SQLite БД (данные загружаются из API при первом запуске)
- **Платформы:** macOS, Windows, Linux

## Обработка не-латинских раскладок

WebView (Chromium) обрабатывает Ctrl+C/V/X/A корректно вне зависимости от раскладки — дополнительная обработка не требуется (в отличие от Tkinter, где это приходилось фиксить вручную).

## Сборка

Один бинарник ~5-10 MB (Tauri). Установка через:
- .dmg (macOS)
- .msi (Windows)
- .deb / .AppImage (Linux)

## UI

- Современная тёмная тема
- Стиль вдохновлён GitHub Dark / VS Code
- Боковая навигация с иконками или горизонтальные вкладки (определится при имплементации)
- Поиск по name в Shortcuts
