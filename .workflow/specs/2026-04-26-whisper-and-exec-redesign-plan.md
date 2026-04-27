# Implementation plan — Whisper post-process UX & Exec redesign

Spec: `2026-04-26-whisper-and-exec-redesign.md`. Order respects dependencies (backend → frontend → docs → verify). Each step lists exact files and verification.

## Phase 1 — Backend (DB + command)

### 1.1 Add `postprocessed_text` migration

**File**: `desktop-rust/src-tauri/src/db/mod.rs`
**Where**: после блока migrations v1.3.16 (~line 296), новая строка:
```rust
// Migration (v1.3.24): Whisper post-processed text persisted alongside raw transcript.
conn.execute_batch("ALTER TABLE whisper_history ADD COLUMN postprocessed_text TEXT").ok();
```
Идемпотентно (`.ok()` — повторный ALTER на уже добавленной колонке не падает).

### 1.2 Extend `WhisperHistoryRow`

**File**: `desktop-rust/src-tauri/src/db/queries.rs`

- Struct `WhisperHistoryRow` (~line 2326): добавить `pub postprocessed_text: Option<String>,`.
- `whisper_list_history` (~line 2370): расширить SELECT-список и `r.get(12)`.
- `whisper_insert_history` менять не нужно (postprocessed заполняется отдельно).

Так как struct с `serde::Serialize` — на фронте поле появится автоматически как `postprocessed_text` (snake_case оставляем — все остальные поля так же).

### 1.3 New command `whisper_set_postprocessed`

**File**: `desktop-rust/src-tauri/src/commands/whisper.rs`

```rust
#[tauri::command]
pub fn whisper_set_postprocessed(
    db: State<DbState>,
    id: i64,
    text: String,
) -> Result<(), String> {
    let conn = db.lock_recover();
    conn.execute(
        "UPDATE whisper_history SET postprocessed_text = ?1 WHERE id = ?2",
        rusqlite::params![text, id],
    ).map_err(|e| e.to_string())?;
    Ok(())
}
```

Регистрируем в `lib.rs` invoke-handler рядом с `whisper_delete_history`.

## Phase 2 — Backend (Gemma SSE)

### 2.1 SSE-парсер в `gemma::server::complete`

**File**: `desktop-rust/src-tauri/src/gemma/server.rs`

- Изменить сигнатуру `complete` на:
  ```rust
  pub async fn complete<F>(&self, prompt: &str, n_predict: i32, mut on_progress: F)
      -> Result<String, String>
  where F: FnMut(usize, i32, u64);
  ```
- В body — `"stream": true`, переключаем на `bytes_stream()` парсинг.
- Парсер: построчный буфер, разделитель `\n\n` для SSE-чанков. Для каждой строки `data: {json}` — парсим, аккумулируем `content`, считаем токены (1 chunk ≈ 1 токен; уточнение через `tokens_predicted` если приходит).
- Throttle: вызываем `on_progress` не чаще раза в 80мс или каждые 8 чанков (что раньше).

### 2.2 `GemmaService::postprocess` — эмит progress

**File**: `desktop-rust/src-tauri/src/gemma/service.rs`

- Перед вызовом `server.complete(...)` — `let started = Instant::now();`.
- Передаём closure: `let app = self.app.clone(); move |done, total, elapsed| { let _ = app.emit("gemma:postprocess-progress", json!({...})); }`.
- После `complete` (success или error) — финальный emit `{ done: true, ... }`.

### 2.3 Регистрация события на фронте

Не нужно — Tauri-events глобальные, фронт уже подписывается через `window.__TAURI__.event.listen`.

## Phase 3 — Frontend API wrappers

### 3.1 `whisper-api.js`

Добавить `setPostprocessed: (id, text) => call('whisper_set_postprocessed', { id, text })`.

### 3.2 `gemma-api.js`

В `EVENTS` добавить `postprocessProgress: 'gemma:postprocess-progress'`.

## Phase 4 — Frontend (whisper-tab.js)

Большая часть работы — реструктуризация `whisper-tab.js`.

### 4.1 Header: Gemma combobox

- В `header.innerHTML` добавить второй `<select id="gemma-model-select" title="Gemma post-processing model" style="...max-width:240px">` справа от whisper-селекта.
- Новые helper'ы: `refreshGemmaSelect()`, `onGemmaSelectChange()`.
- Подписка на `gemma:state-changed` для блокировки селекта во время `warming|busy|unloading`.

### 4.2 Right section: tabs

- Между `right` и `detail` появляется `tabBar` (28px) с двумя кнопками: `whisperTab` / `postTab`.
- Создаём два контейнера `whisperPane` / `postPane`, в каждом свой `<textarea>`. По умолчанию виден `whisperPane`.
- `setActiveTab(name)` — DOM-классы + `display:none/'flex'`.
- `renderDetail(h)` — обновляет оба textarea (`h.text` и `h.postprocessed_text || ''`), пересчитывает active-tab indicator (`●` если есть postprocessed).

### 4.3 Status strip

- Новый DOM-элемент `<div id="status-strip">` между `actions` и `detail` (или внутри `right` после meta).
- `showWhisperElapsed(startedAtMs)` — запускает `setInterval(100ms)`, обновляет text `💭 Transcribing… X.Xs`.
- `showGemmaProgress({tokens_done, n_predict, elapsed_ms, done})` — рендерит fill-bar + текст. На `done` — fade-out через 400ms.
- Сброс через `hideStatusStrip()`.
- Подписка на `whisper:state-changed` — при `transcribing` запускает таймер, на других стейтах останавливает.
- Подписка на `gemma:postprocess-progress` — обновляет fill-bar.

### 4.4 Action-row

- Кнопки `Copy/Paste/Type` теперь читают активный textarea (refs `whisperTextarea` / `postTextarea`, плюс `getActiveTextarea()`).
- `Post-process` дизэйблится когда `activeTab === 'postprocessed'`.
- После успешного postprocess (когда `gemmaApi.postprocess` вернула):
  - `await whisperApi.setPostprocessed(h.id, cleaned)`
  - Обновить `h.postprocessed_text`, `state.history[idx]`.
  - `setActiveTab('postprocessed')`.
  - toast.

### 4.5 Empty Gemma state

Если `gemmaApi.listModels()` возвращает `[]`:
- Селект показывает один пункт `(no models — open Settings)`, value=`__open_settings__`.
- Onchange при выборе этого value: `openSettingsModal({ scrollTo: 'gemma' })` + сброс селекта.

## Phase 5 — Frontend (settings deeplink)

### 5.1 `whisper-settings.js`

- `openSettingsModal(opts = {})` — принимает `opts.scrollTo`.
- На `gemmaBlock(...)` — поставить `wrap.dataset.anchor = 'gemma'` или `wrap.id = 'gemma-anchor'`.
- После рендера контента, если `opts.scrollTo === 'gemma'` — `requestAnimationFrame` → `block.scrollIntoView({ block: 'start' })` + временный `outline: 2px solid var(--accent)` на 1.2s.

## Phase 6 — Frontend (exec.js)

### 6.1 `renderCommands` rewrite

См. спеку §2.5. Удаляются: edit-кнопка, text-кнопка `Run`. Добавляется: `.exec-cmd-run` + `.exec-cmd-body` + clickable `.exec-cmd-name`.

### 6.2 CSS rewrite

См. спеку §2.3. Удаляем старые `.exec-cmd-card` flex-direction-column и `.cmd-actions` гриппу.

### 6.3 SVG constant

`const RUN_ICON_SVG = '<svg viewBox="0 0 12 12" aria-hidden="true"><polygon points="3,2 10,6 3,10"/></svg>';`

## Phase 7 — Help / Changelog

### 7.1 `desktop-rust/src/tabs/help.js`

- Внутри объекта `i18n` (`en` и `ru`) — обновить секции *Features*: Whisper и Exec.
- Добавить новую запись *Changelog* в каждой локали (или обновить существующую).

### 7.2 `desktop-rust/CHANGELOG.md`

Новая секция сверху по образцу спеки §3.

Версия будет `v1.3.24` (текущая — `v1.3.23` по последнему коммиту в логе).

## Phase 8 — Verify

- `cargo check --manifest-path desktop-rust/src-tauri/Cargo.toml`
- `cargo test --manifest-path desktop-rust/src-tauri/Cargo.toml -p keyboard-helper -- gemma::server::tests gemma::postprocess::tests db::queries::whisper`
- Если есть unit-тесты на новые SSE-парсер — добавить (минимум: парсинг одной SSE-строки, парсинг чанка с `\n\n` в середине, финальный chunk с `stop:true`).
- Smoke-проверка через `cargo run --manifest-path desktop-rust/src-tauri/Cargo.toml --release` — но это долго; автономно ограничиваюсь `cargo check`. Отмечаю в финальном репорте, что UI smoke-test надо сделать пользователю.

## Phase 9 — Review & commit

- Перед коммитом — review через subagent на opus max-effort (CLAUDE.md §13): SSE-парсер, throttle, миграция, lock_recover, UTF-8.
- Один коммит, короткая подпись (CLAUDE.md §5): `whisper: gemma combobox + post-proc tabs + progress; exec: octagon run-btn + name-edit (v1.3.24)`.

## Risks / open questions

1. **SSE-парсер на reqwest::Response::bytes_stream()** — если `data: {json}\n\n` приходит разбитый между HTTP-чанками, нужно аккумулировать байты в буфер и искать `\n\n`. Тест на split.
2. **Gemma backend сейчас ожидает `"content"` в финальном response** (`server.rs:115`). При streaming финальный JSON-объект также содержит `content` (полный) или нет? — проверить экспериментально или собирать accumulated content из всех `data:`-строк (надёжнее).
3. **Throttle race** — последний `on_progress` может пройти позже final emit `done:true`. Решение: после полного цикла complete, делаем emit `done:true` гарантированно последним.
4. **`v1.3.24`-bump** — нужно обновить `desktop-rust/src-tauri/Cargo.toml` и `desktop-rust/src-tauri/tauri.conf.json` версии. Если этим занимается CI, не трогаю.
