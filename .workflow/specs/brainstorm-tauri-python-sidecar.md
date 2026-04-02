# Отложенный вариант: Tauri + Python Sidecar

Наработки по варианту модернизации Keyboard Helper с Tauri + Python sidecar.
Решено отложить в пользу полного переписывания на Rust.

## Архитектура

- Tauri (Rust, ~200 строк) — нативная обёртка с WebView
- Python sidecar — вся бизнес-логика (database.py, sync/, handlers/, notes, exec)
- Общение через IPC (stdin/stdout, JSON)
- UI на HTML/CSS/JS
- Сборка Python-части через PyInstaller в standalone бинарник

## Что переписывалось бы

- UI: Tkinter → HTML/CSS/JS
- Хоткей: pynput → нативный Rust API
- Трей: pystray → Tauri built-in

## Что оставалось как есть

- database.py — DuckDB
- sync/ — синхронизация
- handlers/ — SQL-парсер, форматтер, обфускатор
- Логика notes, exec, commits, superset

## Решения по оптимизации (применимы к любому варианту)

- Синхронизация: только по открытию/закрытию окна (вместо каждых 60 сек)
- Ленивая загрузка вкладок: загружать только активную, остальные при переключении (включая вложенные)
- Хоткей: гибридный подход — нативный API на macOS, pynput на десктопе (опционально)
