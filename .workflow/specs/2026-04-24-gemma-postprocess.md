# Gemma post-processing for Whisper — статус и план

**Last update:** 2026-04-24
**Owner:** user + Claude

## Что это

Локальный LLM-pipeline для post-processing Whisper-транскриптов:
вместо внешнего API (Ollama, OpenAI, Anthropic) — bundled `llama-server`
sidecar из llama.cpp, прямо в инсталлере приложения. Никаких
зависимостей на хостовую машину кроме CPU (или Metal на Mac).

## Статус по фазам

### ✅ Фаза 1 — infrastructure + manual post-process (v1.3.19, готов)

Реализовано и зарелижено **2026-04-24**:

- **CI**: новый build-step — `ggml-org/llama.cpp` из source, pinned at
  `LLAMA_CPP_VERSION=b8920`. Build flags:
  `-DLLAMA_BUILD_SERVER=ON -DBUILD_SHARED_LIBS=OFF -DLLAMA_CURL=OFF`,
  на Mac добавлен `-DGGML_METAL=ON`. Статическая сборка → один бинарник
  без .dll/.dylib компаньонов. **CPU-only**, без CUDA (осознанный выбор
  D1 из спеки — CUDA-сборка +150MB + driver dep, а у юзеров разные GPU).

- **Tauri bundle**: `binaries/llama-server-<triple>` рядом с
  `whisper-server`. `externalBin` в `tauri.conf.json` содержит оба.
  Linux dev имеет stub-sh (gitignored через `binaries/*`).

- **Rust backend** (`src-tauri/src/gemma/`):
  - `catalog.rs` — два GGUF:
    - `gemma-3-4b-it-Q4_K_M` (2.5GB, recommended, RU★★★★★)
    - `gemma-3-1b-it-Q4_K_M` (806MB, RU★★★, для слабых машин)
    - Source: `ggml-org/gemma-3-*b-it-GGUF` на HuggingFace
  - `models.rs` — download с progress events, SHA256 verify
  - `server.rs` — spawn llama-server, 180s TCP-probe readiness
    (mmap+load 4B weights медленный на cold CPU), `/completion`
    endpoint (НЕ OpenAI-compatible `/v1/chat/completions` — проще
    и работает со всеми gguf без привязки к chat-template)
  - `postprocess.rs` — Gemma-3 chat-format prompt
    (`<start_of_turn>user ... <end_of_turn><start_of_turn>model`),
    output sanitizer. **Char-based truncation** (CLAUDE.md §10) —
    tests уже спас один раз на `«мир»`.
  - `service.rs` — lazy warm + 5-min idle unload +
    `set_default_model` с eviction warmed server

- **Commands** (в `commands/gemma.rs`, 7 штук):
  `gemma_list_catalog`, `gemma_list_models`, `gemma_install_model`,
  `gemma_delete_model`, `gemma_set_default_model`, `gemma_postprocess`,
  `gemma_unload_now`. Все зарегистрированы в `lib.rs` invoke_handler.

- **Lifecycle**:
  - `setup()` — `app.manage(GemmaService::new(...))`
  - `RunEvent::Exit` — `gsvc.shutdown_blocking()` (kill-child
    синхронный, ждать нельзя в exit)
  - NSIS pre-install hook — `taskkill /F /T /IM llama-server.exe`
    (auto-update file-lock defense)

- **Frontend**:
  - `src/tabs/whisper/gemma-api.js` — тонкая обёртка
  - `whisper-settings.js` — блок «Gemma post-processing (local LLM)»:
    список installed моделей с Install/Make default/Delete,
    mini catalog-picker с inline progress bar
  - `whisper-tab.js` detail-view — кнопка **«✨ Post-process»** рядом
    с Copy/Paste/Type/Delete. Переписывает textarea на месте,
    первый запуск warms ~30-60с, дальше reuse

- **help.js** — обновлён whisper_desc (EN+RU) с упоминанием Gemma
- **CHANGELOG.md** — секция v1.3.19

**Тесты:** 131/131 passing (+10 новых gemma).

### 🟡 Ожидает ручной проверки юзером

- [ ] Установка v1.3.19 `.exe` на Windows
- [ ] Settings → «+ Установить Gemma-модель…» → скачивание
      `gemma-3-4b-it-Q4_K_M` (2.5GB)
- [ ] SHA256 verify проходит (если mismatch — реально баг)
- [ ] `✨ Post-process` кнопка в detail-view карточки истории
      выдаёт осмысленный результат на русском voice-транскрипте
- [ ] Idle unload через 5 минут (kill llama-server процесса)
- [ ] Шатдаун приложения убирает llama-server.exe (`taskkill` или
      ручной `pskill`)

### 📋 Фаза 2 — auto-postprocess + UX (следующий релиз, не начинали)

План:

1. **Checkbox «Auto post-process»** в header Whisper-таба рядом с
   Record → если стоит, после `transcribed`-event автоматически
   дёргаем `gemma_postprocess(text)` и перезаписываем текст в
   истории + overlay
2. **Тот же checkbox в `whisper-overlay.html`** — синхронизируется
   с главным через общий setting `whisper.gemma_auto` + event
   `whisper:settings-changed`
3. **Dropdown Gemma-моделей в header** (как whisper-model dropdown
   из v1.3.18) — `setDefaultModel` + `unloadNow` на change
4. **Custom prompt template в Settings** — textarea с
   `{TEXT}`-placeholder, сохраняется в setting `whisper.gemma_prompt`,
   fallback на `DEFAULT_PROMPT` из postprocess.rs
5. Настройки `idle_timeout_sec` для gemma (сейчас жёстко 300с)

### 🔵 Фаза 3 — standalone LLM tab (на будущее)

- Отдельный таб «LLM» с chat-UI для произвольных запросов (не только
  post-process). User flow: ввёл сообщение → gemma_completion
  (новая команда, streaming через SSE event) → показывает ответ
- Разделение GemmaService → generic `LlamaService` с методом
  `complete_stream(prompt, on_token)` через
  reqwest `bytes_stream()` на llama-server `?stream=true` endpoint
- Model-switch без restart (llama-server позволяет смену через
  `/v1/models` при `--parallel`-mode) — optional

## Известные ограничения текущей реализации (Phase 1)

| # | Ограничение | Планируется |
|---|-------------|-------------|
| L1 | 180s timeout на spawn может не хватить для 4B на очень старом CPU | Увеличить до 300s в Phase 2 если жалобы |
| L2 | `--threads 4` жёстко — не адаптивно | В Phase 2 сделать `--threads $num_cpus::get()` |
| L3 | Нет progress-индикации во время inference (UI замирает 30-60с) | Добавить `gemma:progress`-event в Phase 2 через стриминг токенов |
| L4 | Нет fallback если llama-server упал посреди `/completion` | В Phase 2 — retry × 1 + понятная ошибка |
| L5 | `sanitize_output` трогает только guillemets/quotes — модель может писать преамбулу «Исправленный текст:\n...» | Добавить regex-strip типичных префиксов в `sanitize_output` |
| L6 | Нет теста на real-ish модели (только unit на prompt/sanitize) | В CI нет смысла — 2.5GB модель не скачаешь. Юзер-смоук-тест и всё. |

## Чеклист для возобновления работы

1. Проверить что v1.3.19 работает у юзера на практике (установка
   модели, post-process даёт осмысленный вывод)
2. Если Phase 1 ок — стартуем Phase 2, начиная с checkbox в header
   (самое простое)
3. Если есть проблемы — фиксим их поверх v1.3.19 как v1.3.20 или
   OTA, потом Phase 2

## Ссылки

- Релиз: https://github.com/IgorSterkhov/snippets_helper/releases/tag/v1.3.19
- HF models: https://huggingface.co/ggml-org/gemma-3-4b-it-GGUF,
  https://huggingface.co/ggml-org/gemma-3-1b-it-GGUF
- llama.cpp server docs:
  https://github.com/ggml-org/llama.cpp/blob/master/examples/server/README.md
