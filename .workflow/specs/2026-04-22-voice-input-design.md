# Voice Input (Whisper) — Snippets Helper Desktop

## Обзор

Новая вкладка на левой панели десктопного приложения для локального голосового
ввода через Whisper. Пользователь диктует голосом, программа распознаёт
речь локально (без интернета) и вставляет результат в активное окно или
в буфер обмена. Работает из любого приложения по глобальному hotkey.

Цели: Windows (с/без GPU) и macOS M2+ (Metal из коробки).

## Требования и скоуп

**Включено в MVP:**
- Вкладка «Whisper» на левой панели (icon 🎤) — two-pane layout в стиле Shortcuts/Notes
- Онбординг при первом запуске: выбор и установка модели с прогрессом
- Триггер записи: глобальный hotkey + кнопка на вкладке (оба toggle-режим)
- Язык RU+EN (multilingual модели с language=auto)
- Floating overlay (правый нижний угол, независимое Tauri-окно) — всегда виден во время записи
- История транскриптов в SQLite (последние 200)
- Выбор микрофона в настройках
- Настраиваемый метод вставки: clipboard / clipboard+Ctrl+V / type-симуляция
- Лёгкая постобработка текста на Rust (filler-слова, capitalize) — опциональная
- Опциональная постобработка через внешний LLM API (поле для endpoint/key/prompt)
- Автодетекция GPU → скачивание CUDA/Metal/Vulkan-билдов whisper.cpp on-demand

**Вне MVP (YAGNI):**
- Streaming-транскрипт во время записи
- VAD (автоматический стоп по тишине)
- Push-to-talk (hold) режим
- Локальный LLM-sidecar (llama.cpp)
- Экспорт истории в файл
- Синхронизация истории между устройствами

## Архитектурные решения

**Движок распознавания:** whisper.cpp как sidecar-бинарь в server-mode
(локальный HTTP на random-порту, модель постоянно в RAM пока активна).

**Lifecycle whisper-server** — ленивый старт + idle-timeout выгрузка:
```
┌─ State ─────────┬─ RAM/VRAM ─┬─ Response ─┬─ Overlay ──────────────┐
│ idle            │ 0          │ —          │ скрыт                   │
│ warming up      │ грузится   │ —          │ "⏳ Loading model…"    │
│ ready           │ модель     │ ~200ms     │ скрыт (или компактный)  │
│ recording       │ модель     │ —          │ "🔴 REC 00:04" + level  │
│ transcribing    │ модель     │            │ "💭 Transcribing…"      │
│ idle-timer      │ модель     │ ~200ms     │ скрыт                   │
│ unloading       │ чистим     │ —          │ (ничего)                │
└─────────────────┴────────────┴────────────┴─────────────────────────┘
```
Переходы:
- `idle → warming`: первая запись спавнит `whisper-server --model <path> --port 127.0.0.1:<random>`, ждём "server is listening" из stderr (1–3с на medium)
- `warming → ready`: cpal-запись стартует **параллельно** с warm-up, буфер не теряется
- `ready → recording → transcribing`: cpal→WAV в памяти→`POST /inference`→транскрипт, сбрасываем idle-timer
- `ready → unloading → idle`: через **5 минут** (настраиваемо) без записей — SIGTERM серверу
- Есть кнопка **Unload now** для принудительной выгрузки (экономия VRAM/батареи)
- Crash whisper-server → auto-restart при следующей записи

**Audio capture:** нативный — Rust crate `cpal` (кросс-платформенный),
RMS уровня эмитится в overlay через Tauri-events ~20Hz.

**Формат аудио:** WAV 16kHz mono (стандарт для whisper.cpp), кодирование через `hound`.

**Вставка в активное окно:** arboard (уже в проекте) + enigo для симуляции
Ctrl+V/Cmd+V. Исходный clipboard сохраняется до вставки и восстанавливается
после.

**Упаковка whisper.cpp:**
- CPU-бинарь предбандлен в `src-tauri/binaries/` как Tauri `externalBin`
  (~3 МБ Windows, ~2 МБ macOS Metal-built — работает и на CPU fallback)
- GPU-билды (Windows CUDA, Vulkan) — опциональны, скачиваются в
  `app_data_dir/whisper-bin/` при первом запуске если `gpu_detect` нашёл GPU
- Модели **не** предбандлятся — пользователь ставит через onboarding

## UI

### Вкладка Whisper (two-pane)

Паттерн Shortcuts/Notes:
- **Header** (flex-shrink:0): название, chip-индикатор состояния
  (○ idle / ⏳ warming / ● ready / 🔴 recording + timer / 💭 transcribing),
  справа — кнопка Record/Stop, иконка ⚙ (settings)
- **Left pane (~40%)**: список истории, кликабельные карточки (preview + timestamp)
- **Right pane (flex:1)**: активный/выбранный транскрипт в textarea,
  кнопки снизу: Copy · Paste · Edit · Re-transcribe · Delete

Состояние активной вкладки зеркалирует overlay — если overlay показывает
"recording", то и на вкладке в left pane сверху появляется live-запись.

### Floating overlay

Отдельное Tauri-окно (`WebviewWindow`), 260×90px, правый нижний угол (настраиваемо), перетаскиваемое:
- Без декораций, прозрачный фон, always-on-top
- `skip_taskbar=true` (Windows), `LSUIElement=true` (macOS)
- Состояния: **warming** (spinner + «Loading model…») → **recording**
  (красная точка + таймер + live-волны RMS + кнопка Stop) → **transcribing**
  (прогресс-бар) → **done** (зелёная галка + превью + word count, 1с и
  скрывается)
- Кнопка ✕ — cancel recording без вставки
- Позиция запоминается в settings
- Опция «скрывать overlay когда вкладка Whisper в фокусе» (дефолт: **не** скрывать)

### Onboarding (первый запуск)

Показывается, когда в SQLite нет установленных моделей. Экран с 6 карточками
моделей:
| Модель | Размер | RU качество | Заметка |
|---|---|---|---|
| tiny | 77 MB | ★☆☆☆☆ | «Плохо для русского» |
| base | 148 MB | ★★☆☆☆ | «Слабо для русского» |
| small | 466 MB | ★★★★☆ | **рекомендую** — «Оптимум для RU+EN» |
| medium | 1.5 GB | ★★★★★ | «Лучшее качество, если есть RAM» |
| large-v3 | 2.9 GB | ★★★★★+ | «Только с GPU» |
| large-v3-q5 | 1.1 GB | ★★★★★ | «Q5 квантизация — best tradeoff» |

Плашка «Система определила: Apple M2 Pro, 16 GB RAM, Metal доступен.
Лучший выбор — small или large-v3-q5».

Загрузка: progress-bar с байтами/скоростью/ETA + SHA256-чексам в конце. После
первой установки — переход на two-pane layout.

### Настройки (Settings-модалка)

- **Модели:** список установленных + кнопка «Add model» (тот же каталог); выбор
  «default»; кнопки delete/unload-now
- **Микрофон:** dropdown input-устройств
- **Hotkey:** дефолт `Ctrl+Alt+Space`, настраивается
- **Метод вставки:** clipboard / clipboard+auto-paste / type
- **Idle-timeout:** дефолт 5 минут (slider 1–30)
- **Overlay:** позиция (corner), «скрывать при активной вкладке»
- **Постобработка:**
  - Чекбокс «Лёгкие правила» (filler-слова, capitalize первой буквы)
  - Чекбокс «Внешний LLM API» + поля endpoint/api-key/prompt
- **История:** кнопка «Clear all»

## Структура файлов

### Фронт (`desktop-rust/src/`)

```
tabs/whisper/
├── whisper-main.js          # export init(container) — entry
├── whisper-tab.js           # two-pane layout (история + transcript)
├── whisper-onboarding.js    # first-run экран выбора модели
├── whisper-settings.js      # модалка настроек
├── whisper-overlay.html     # загружается в отдельном WebviewWindow
└── whisper-api.js           # обёртки над call('whisper_*', ...)
```

Плюс одна строка в `main.js:15` (массив TABS):
```javascript
{ id: 'whisper', label: 'Whisper', icon: '🎤',
  loader: (el) => import('./tabs/whisper/whisper-main.js').then(m => m.init(el)) },
```

### Rust (`desktop-rust/src-tauri/src/`)

```
commands/
└── whisper.rs               # Tauri invoke handlers

whisper/
├── mod.rs                   # pub-фасад, WhisperState в AppState
├── service.rs               # WhisperService — lifecycle + idle-timer
├── server.rs                # спавн/мониторинг whisper-server, выбор порта
├── audio.rs                 # cpal capture, буфер PCM, RMS
├── models.rs                # каталог моделей, download + verify (sha256)
├── gpu_detect.rs            # определение CUDA/Metal/CPU
├── bin_manager.rs           # whisper.cpp-бинари: bundled CPU + GPU on demand
├── postprocess.rs           # правила чистки + опц. LLM-вызов
├── inject.rs                # enigo Ctrl+V/Cmd+V, сохранение clipboard
└── events.rs                # типы Tauri-events
```

### Новые зависимости в `Cargo.toml`

- `cpal = "0.15"` — audio capture
- `hound = "3.5"` — WAV encoding
- `enigo = "0.2"` — keyboard simulation

### Конфигурация Tauri

В `tauri.conf.json`:
- Добавить whisper-overlay как второе окно (`windows[]`, `decorations:false`,
  `transparent:true`, `alwaysOnTop:true`, `skipTaskbar:true`, `resizable:false`,
  `visible:false` — показывается программно)
- `externalBin` для whisper-server: `binaries/whisper-server-${target}`

## Tauri-команды

| Команда | Назначение |
|---|---|
| `whisper_list_models` | установленные модели из SQLite |
| `whisper_list_catalog` | доступные для загрузки (hardcoded manifest + sha256) |
| `whisper_install_model(name)` | скачать с HF, verify sha, записать в БД; эмитит `whisper:model-download` |
| `whisper_delete_model(name)` | удалить файл + запись |
| `whisper_set_default_model(name)` | `is_default=1` |
| `whisper_list_mics` | input-устройства из cpal |
| `whisper_start_recording` | cpal-capture; lazy-стартует whisper-server если idle |
| `whisper_stop_recording` | транскрипт (после postprocess); эмитит `whisper:transcribed` |
| `whisper_cancel_recording` | отмена (✕ в overlay) |
| `whisper_unload_now` | SIGTERM whisper-server |
| `whisper_inject_text(text, method)` | copy/paste/type |
| `whisper_get_history(limit)` | последние N записей |
| `whisper_delete_history(id?)` | одну или все |
| `whisper_gpu_info` | `{cuda:bool, metal:bool, vram_mb:u32}` |
| `whisper_detect_whisper_bin` | установлен ли CUDA/Metal-билд, dl-URL если нет |

## Tauri-events (Rust → фронт)

- `whisper:state-changed` `{state}` — переходы lifecycle
- `whisper:level` `{rms: 0.0..1.0}` — ~20Hz для overlay
- `whisper:model-download` `{model, bytes_done, bytes_total, speed_bps}`
- `whisper:transcribed` `{text, duration_ms, model}` (после postprocess)
- `whisper:error` `{code, message}`

## Схема SQLite

Новые миграции в `db/migrations/`:

```sql
-- Каталог скачанных моделей
CREATE TABLE whisper_models (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT NOT NULL UNIQUE,        -- 'ggml-small', 'ggml-large-v3-q5_0', ...
    display_name TEXT NOT NULL,               -- 'small multilingual'
    file_path    TEXT NOT NULL,
    size_bytes   INTEGER NOT NULL,
    sha256       TEXT NOT NULL,
    is_default   INTEGER NOT NULL DEFAULT 0,
    installed_at INTEGER NOT NULL
);

-- История транскриптов
CREATE TABLE whisper_history (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    text           TEXT NOT NULL,
    text_raw       TEXT,                      -- до postprocess (nullable)
    model_name     TEXT NOT NULL,
    duration_ms    INTEGER NOT NULL,          -- длина аудио
    transcribe_ms  INTEGER NOT NULL,          -- сколько длился whisper
    language       TEXT,
    injected_to    TEXT,                      -- 'clipboard'|'paste'|'type'|null
    created_at     INTEGER NOT NULL
);
CREATE INDEX idx_whisper_history_created ON whisper_history(created_at DESC);
-- Храним последние 200; при новой записи TRIM старые.
```

Настройки — в существующую таблицу `settings` (key/value):
```
whisper.hotkey                 = "Ctrl+Alt+Space"
whisper.mic_device             = ""  (пусто = default OS)
whisper.default_model          = "ggml-small"
whisper.idle_timeout_sec       = 300
whisper.inject_method          = "paste"  # copy|paste|type
whisper.llm_enabled            = "false"
whisper.llm_endpoint           = ""
whisper.llm_api_key            = ""
whisper.llm_prompt             = "Почисти от filler-слов, исправь пунктуацию."
whisper.overlay_position       = "bottom-right"
whisper.overlay_hide_on_tab    = "false"
whisper.postprocess_rules      = "true"
```

## Обработка ошибок

| Ошибка | Где | Реакция |
|---|---|---|
| Нет разрешения на микрофон (macOS TCC) | cpal init | toast «Дайте доступ → System Settings» + deep-link |
| Нет моделей | `start_recording` на пустой БД | переключить на onboarding-экран |
| HF timeout при загрузке | models.rs | кнопка «Retry», частичный download удаляем |
| SHA256 mismatch | models.rs | удалить файл, показать ошибку (MITM/обрыв) |
| whisper-server crash | service.rs (мониторим exit-code) | auto-restart при следующей записи + toast |
| Запись нажата во время warming | service.rs | буферим аудио в cpal, ждём ready — не теряется |
| Пустой транскрипт (тишина) | после /inference | toast «Ничего не распознано», не вставляем |
| Accessibility не выдано (macOS, для Cmd+V) | enigo Err | fallback в copy-only, подсказка |
| Hotkey занят другим приложением | регистрация | toast «Измените hotkey», вкладка остаётся рабочей |
| LLM API ошибка / rate-limit | postprocess | fallback на сырой whisper, warning-toast |
| Модель удалена из FS извне | start_recording | `installed=false` в БД, предложение переустановить |

## Тестирование

**Dev-mock для фронта** (`src/dev-mock.js`): стабы `whisper_*` команд, чтобы
вкладка открывалась в браузере без Tauri (через `python3 -m http.server 8000`).
Это основной режим UI-итерации — экономит минуты native-сборки.

**Smoke-тесты** (`dev-test.py`, перед каждым тэгом): открывается вкладка,
рендерится onboarding, открывается settings, элементы кликабельны.

**Rust unit-тесты:**
- `whisper::models::test_verify_sha256` — test-bin + ожидаемый hash
- `whisper::audio::test_wav_encoding` — write N samples, decode, проверить длину/rate
- `whisper::service::test_state_transitions` — mock-сервером проверить переходы
- `whisper::postprocess::test_filler_removal` — табличные тесты («эээ привет» → «Привет»)
- `whisper::inject::test_clipboard_restore` — сохранение/восстановление clipboard

**Manual integration checklist** (дополнить в `desktop-rust/RELEASES.md`):
- [ ] macOS: mic permission prompt на первой записи
- [ ] macOS: accessibility prompt на первой авто-вставке
- [ ] Первая запись → warming visible → transcript
- [ ] Idle-timeout через 5 мин → `ps | grep whisper-server` пусто
- [ ] Hotkey из другого окна → overlay → вставка в фокусное окно
- [ ] Unload now → мгновенный SIGTERM

## Упаковка и CI

**Бандлинг whisper.cpp-бинарей:**
- В `desktop-rust/src-tauri/binaries/` кладём:
  - `whisper-server-x86_64-pc-windows-msvc.exe` (CPU, ~3 МБ)
  - `whisper-server-aarch64-apple-darwin` (Metal-built, ~2 МБ)
- Добавляем как `externalBin` в `tauri.conf.json` — Tauri копирует в resources при `tauri build`
- Скачиваем бинари из [ggerganov/whisper.cpp releases](https://github.com/ggerganov/whisper.cpp/releases)

**GPU-билды on demand:**
- При старте приложение вызывает `whisper_gpu_info` + `whisper_detect_whisper_bin`
- Если NVIDIA GPU + нет CUDA-билда локально → предлагает скачать (~50 МБ)
- Хранится в `app_data_dir/whisper-bin/whisper-server-cuda.exe`

**Модели:** не бандлим — пользователь сам ставит через onboarding с HuggingFace.

**Изменения в CI** (`.github/workflows/release-desktop.yml`):
- Добавить шаг перед `tauri build`: скачивание whisper.cpp-бинарей в
  `src-tauri/binaries/` для целевой платформы (Windows / macOS)
- Версия whisper.cpp фиксируется в отдельной константе/файле `WHISPER_CPP_VERSION`
- При `f-*` (frontend-only) тегах — не трогаем бинари

**RELEASES.md** дополнить:
- Секция «Обновление whisper.cpp»: как найти новый релиз, пересобрать бинари, как проверить
- Известные грабли: bundled vs downloaded GPU-билд, mic-permission и accessibility на macOS, порядок warm-up при холодном старте

## Нефункциональные требования

- **Privacy:** всё локально (whisper.cpp + модели). Только при включённом
  «Внешний LLM API» текст уходит в сеть — и только после явной настройки
  пользователя.
- **Resource usage в idle:** 0 (процесс whisper-server не запущен)
- **Первый транскрипт после idle:** 1–3с на warm-up + время записи + ~200мс
  на inference (для small); **последующие:** ~200мс от stop до вставки
- **Кросс-платформенность:** Windows 10+, macOS 12+ (Apple Silicon и Intel)

## Открытые вопросы / future work

- **Streaming transcription** — whisper.cpp умеет, но требует кардинально
  другого UX. Оставляем на v2.
- **VAD-autostop** — может быть добавлено как галочка «авто-стоп по 1.5с
  тишины». Зависит от выбранной VAD-библиотеки (Silero ONNX / webrtc-vad).
- **Push-to-talk (hold)** — возможен через rdev, но требует low-level keyboard
  listener, который есть в проекте для двойных Shift/Ctrl; вынесено из MVP.
- **Локальный LLM-sidecar** — `llama.cpp` + маленькая модель; добавить
  если внешний LLM окажется неудобен.
- **Поиск по истории** — когда записей станет >50 (пока не нужен).
- **Экспорт истории** — легко добавить, ждём запроса.

## Связь с существующими процессами

- **CLAUDE.md п.6:** этот spec в `.workflow/specs/`
- **CLAUDE.md п.7 и `desktop-rust/RELEASES.md`:** перед любыми изменениями в
  `src-tauri/` или workflow-файлах — перечитать RELEASES.md; дополнить его
  разделом про whisper-бинари и чек-лист
- **OTA frontend-only** (`f-*` теги): изменения только в `src/` не требуют
  native-сборки, применяются пользователям мгновенно. Это большое
  преимущество — UI-итерации идут быстро.
- **Существующий hotkey Alt+Space** главного приложения не конфликтует с
  дефолтом Ctrl+Alt+Space для Whisper. При желании пользователь сменит.
- **Автозапуск приложения** уже реализован (`autostart.rs`) — whisper-вкладка
  будет работать «из коробки» после входа в систему.
