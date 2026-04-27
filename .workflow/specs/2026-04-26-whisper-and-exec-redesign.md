# Whisper post-process UX & Exec card redesign

**Date**: 2026-04-26
**Release target**: `v-*` (новая колонка БД + новые `#[tauri::command]`'ы)
**Files affected (frontend)**: `desktop-rust/src/tabs/whisper/whisper-tab.js`, `whisper-settings.js`, `gemma-api.js`, `whisper-api.js`, `desktop-rust/src/tabs/exec.js`, `desktop-rust/src/tabs/help.js`, `desktop-rust/CHANGELOG.md`
**Files affected (backend)**: `desktop-rust/src-tauri/src/commands/whisper.rs`, `commands/gemma.rs`, `gemma/server.rs`, `gemma/service.rs`, `whisper/service.rs`, `db/migrations.rs` (или эквивалент), `whisper/history.rs` (там, где `WhisperHistory`).

---

## 1. Whisper-таб: Gemma-комбобокс, статус, табы результата

### 1.1 Header: второй комбобокс — Gemma-модель

Сейчас (`whisper-tab.js:22`) в шапке один селект `#model-select` (Whisper-модели). Добавляется второй селект **справа от него**.

**Раскладка шапки слева → направо**:
```
🎤 Whisper [● ready]  Whisper:[base.q5 ·default]  Gemma:[gemma-3-4b ·default]   [✕ Cancel] [🎤 Record] [⚙]
```

**Поведение `#gemma-model-select`**:
- Загрузка: `gemmaApi.listModels()` (как `refreshModelSelect` для whisper). Текущий выбор — модель с `is_default=true`.
- Onchange: `gemmaApi.setDefaultModel(name)` + `gemmaApi.unloadNow()` + toast `Gemma: <name>`. Зеркало whisper-флоу из `whisper-tab.js:216-244`.
- Lock-conditions: `disabled` пока `gemma.state ∈ {warming, busy, unloading}` (по событию `gemma:state-changed`).
- Lock на whisper-операциях **не нужен** — gemma и whisper независимы (whisper освобождает GPU/CPU до post-process).
- Ширина: тот же `max-width:240px` что и whisper-селект.

**Пустое состояние** (нет установленных Gemma-моделей):
- Один пункт с `value=""`: `(no models — open Settings)`.
- Селект **enabled** (чтобы кликалось), но `onchange` при выборе этого пункта вместо `setDefaultModel` вызывает `openSettingsModal({ scrollTo: 'gemma' })`.
- В `whisper-settings.js`: добавляется DOM-якорь `data-anchor="gemma"` на блоке `gemmaBlock(...)` (строка 363). После рендера модалки, если `openSettingsModal` получил `{ scrollTo: 'gemma' }`, делает `block.scrollIntoView({ block: 'start' })` + временное обведение рамкой 1.2s (плавная подсветка `box-shadow: 0 0 0 2px var(--accent)`).

**Уход в idle** (после `gemmaApi.unloadNow()` или idle-timeout): селект **не сбрасывается** — он показывает выбранную *default*-модель, не «активную в сервисе». В отличие от whisper-комбобокса, который синхронизируется с `state.model` события (потому что там «warmed model» — это и есть «default»).

### 1.2 Правая секция: 2 таба

Сейчас правая секция = `<textarea>` + `meta` + actions. Перерисовываем как:

```
┌──────────────────────────────┐
│ [Whisper output] [Post-proc·]│  ← таб-бар (28px high)
├──────────────────────────────┤
│ <textarea>                   │
│  ...                         │  ← активный таб
│                              │
├──────────────────────────────┤
│ <meta-line>                  │
├──────────────────────────────┤
│ <progress-strip>             │  ← виден только во время whisper или gemma processing
├──────────────────────────────┤
│ [📋 Copy] [⎘ Paste] [Type]   │
│ [✨ Post-process] [🗑 Delete] │
└──────────────────────────────┘
```

**Таб-бар**:
- Два таба: `Whisper output` и `Post-processed`.
- Активный таб: `border-bottom: 2px solid var(--accent)`, `color: var(--text)`.
- Неактивный: `color: var(--text-muted)`, hover → `color: var(--text)`.
- Индикатор `●` справа от лейбла `Post-processed`, если у текущей записи `postprocessed_text` непустой. Цвет — `var(--green)`.
- Default-active при выборе записи: всегда `Whisper output`.
- После успешного post-process: автоматически переключается на `Post-processed` + toast `Post-processed`.

**Tab `Whisper output`**:
- Textarea с `h.text` — редактируемое (как сейчас, 1:1).

**Tab `Post-processed`**:
- Textarea с `h.postprocessed_text || ''` — редактируемое.
- Если `postprocessed_text` пуст и в данный момент **не идёт** обработка: textarea показывает плейсхолдер «Post-process не запускался. Перейдите в Whisper output и нажмите ✨ Post-process.» (через `placeholder` — стандартный механизм).
- Изменения текста на этом табе **не сохраняются обратно в БД** (сейчас и whisper-textarea не синхронизируется с БД на blur — обновляется только сама запись `h.text` в `state.history`, но не пишется обратно). Поведение оставляем согласованным с уже существующим whisper-output: правки локально в textarea для последующего Copy/Paste/Type, но не для перезаписи истории.

**Action-row (общая)**:
- `📋 Copy` / `⎘ Paste` / `Type` — действуют на **активный textarea** (читают через ссылку на текущий видимый элемент).
- `✨ Post-process` — disabled на табе `Post-processed`. На табе `Whisper output` — активна, читает `whisperTextarea.value.trim()`.
- `🗑 Delete` — удаляет всю запись из истории (без изменений).

**Meta-line** (`Whisper output`-tab only): как сейчас — `formatRelativeTime · model_name · language · duration · transcribe_ms · perf · injected_to`. На табе `Post-processed` meta скрыта (она про процесс распознавания, не пост-обработки).

### 1.3 Прогресс: статус-полоска

Полоска появляется **между meta-line и action-row** (или, если `meta-line` нет — перед action-row). Высота 26px, padding `4px 12px`, font-size 11px, цвет `var(--text-muted)`. Border-top + border-bottom 1px по `var(--border)`.

**Скрыта** когда:
- Whisper-state ∈ {idle, ready, recording, warming} И Gemma-state ∈ {idle, ready, unloading}.
- Все остальные случаи показывают одну полоску. Если оба заняты одновременно — приоритет у того, кого пользователь триггернул последним (на практике одновременно не бывает — whisper освобождает loop до перехода в `transcribing`, gemma запускается только по клику Post-process).

**Whisper transcribing** (state-event `whisper:state-changed` → `transcribing`):
- Layout: `[spinner-icon] 💭 Transcribing… <elapsed>`
- Spinner: CSS-anim `transform: rotate(360deg) infinite 1s`. Текст растёт в реальном времени по таймеру `setInterval(100ms)`, отображая `elapsed = (now - startedAt)/1000` с одним знаком после запятой (`3.2s`).
- Никаких %, никаких токенов, никакой fill-полосы.
- При выходе из `transcribing` — таймер очищается, полоска скрывается.

**Gemma post-process** (новое событие `gemma:postprocess-progress`):
- Layout: `[fill-bar 0..100%] ✨ <pct>% · <tok_done>/<n_predict> tok · <elapsed>`
- Fill-bar: CSS-div ширины `pct%`, цвет `var(--accent)` с прозрачностью `0.18`, абсолютно спозиционирован за текстом (текст рендерится поверх).
- При `done=true` событии: bar заливается до 100%, через 400ms полоска скрывается.

### 1.4 Backend: streaming Gemma

Текущий `gemma::server::complete()` использует `"stream": false` (`server.rs:101`). Нужно переключить на streaming-парсинг:

**`gemma::server::complete_stream()`** — новый метод, либо рефакторинг `complete()`:

```rust
pub async fn complete_stream<F>(
    &self,
    prompt: &str,
    n_predict: i32,
    mut on_progress: F,
) -> Result<String, String>
where F: FnMut(usize, i32, u64) // (tokens_done, n_predict, elapsed_ms)
```

- POST `/completion` с `"stream": true`.
- Ответ — SSE-поток: каждая строка `data: {json}\n\n`. JSON содержит инкрементальный `content` (один или несколько токенов) и поля `stop`/`stopped_eos`/`stopped_limit` на финальном чанке.
- Парсим chunked-body вручную (`reqwest::Response::bytes_stream()`, разбиваем на строки, для каждой `data: ...` парсим JSON, аккумулируем `content`).
- Для каждого чанка вызываем `on_progress(tokens_done, n_predict, elapsed_ms)`. Throttle: эмитим не чаще чем раз в **80ms** или каждые **8 токенов** (что наступит раньше) — иначе фронт заваливается событиями.
- Возвращаем полный аккумулированный текст.

**`GemmaService::postprocess_with_progress()`** (или модификация `postprocess()`):

```rust
pub async fn postprocess(&self, text: &str) -> Result<String, String> {
    // ... ensure_ready as now ...
    let app = self.app.clone();
    let started = Instant::now();
    let result = server.complete_stream(&prompt, budget, |done, total, elapsed| {
        let _ = app.emit("gemma:postprocess-progress", serde_json::json!({
            "tokens_done": done,
            "n_predict": total,
            "elapsed_ms": elapsed,
            "done": false,
        }));
    }).await;
    let _ = self.app.emit("gemma:postprocess-progress", serde_json::json!({
        "tokens_done": 0, "n_predict": 0, "elapsed_ms": started.elapsed().as_millis(),
        "done": true,
    }));
    // ... sanitize + return
}
```

Команда `gemma_postprocess` остаётся прежней (`text -> Result<String>`). Эмиты — побочный эффект.

### 1.5 БД: миграция + сохранение результата

**Миграция** (новый файл миграции, идущий после последнего существующего):
```sql
ALTER TABLE whisper_history ADD COLUMN postprocessed_text TEXT;
```
Колонка NULLable, по умолчанию NULL. Старые записи остаются с NULL — для них таб `Post-processed` показывает плейсхолдер.

**Rust struct `WhisperHistory`**: добавить поле
```rust
pub postprocessed_text: Option<String>,
```
с `#[serde(rename_all = "snake_case")]` или явным `#[serde(rename = "postprocessed_text")]`. SELECT-ы в `get_whisper_history`, `delete_whisper_history` и пр. обновляются — добавляем колонку.

**Новая команда** `update_whisper_history_postprocessed`:
```rust
#[tauri::command]
pub async fn update_whisper_history_postprocessed(
    state: State<'_, DbState>,
    id: i64,
    text: String,
) -> Result<(), String> {
    let conn = state.lock_recover()?;
    conn.execute(
        "UPDATE whisper_history SET postprocessed_text = ?1 WHERE id = ?2",
        rusqlite::params![text, id],
    ).map_err(|e| e.to_string())?;
    Ok(())
}
```
Использует `lock_recover` (CLAUDE.md §11). Регистрируется в `lib.rs` invoke-handler.

**UI flow после `gemmaApi.postprocess(src)` success**:
```js
const cleaned = await gemmaApi.postprocess(src);
await whisperApi.updateHistoryPostprocessed(h.id, cleaned);  // new
postprocessedTextarea.value = cleaned;
h.postprocessed_text = cleaned;             // local state
state.history[idx].postprocessed_text = cleaned;
switchTab('postprocessed');
toast('Post-processed');
```

Если приложение упадёт между `postprocess` и `updateHistoryPostprocessed` — результат теряется (пользователь увидит на свежем старте таб пустой). Для post-process это приемлемо (можно перезапустить).

### 1.6 Передача `historyId` в backend? — Нет

Решение: `gemma_postprocess` остаётся stateless. UI отвечает за персистентность. Plus: пользователь может «играться» с post-process на ещё не сохранённой записи или править руками — backend не должен лезть в БД.

### 1.7 Запрет post-process на пустом тексте — без изменений

Существующая проверка `if (!src) { toast('Nothing to post-process', { kind: 'warn' }); return; }` (строка 364) сохраняется.

---

## 2. Exec-модуль: редизайн карточки команды

### 2.1 Текущая карточка (для контраста)

```html
<div class="exec-cmd-card">
  <div class="exec-cmd-header">
    <strong>Name</strong> [WSL]
    <div class="cmd-actions">
      <button>Run</button>
      <button>✎</button>
      <button>✕</button>
    </div>
  </div>
  <div class="exec-cmd-desc">Description...</div>
  <code class="exec-cmd-code">echo hello</code>
</div>
```

### 2.2 Новая карточка

```html
<div class="exec-cmd-card">
  <button class="exec-cmd-run" aria-label="Run Name" title="Run Name">
    <svg ...><!-- octagon stroke + ▶ fill --></svg>
  </button>
  <div class="exec-cmd-body">
    <div class="exec-cmd-header">
      <span class="exec-cmd-name" role="button" tabindex="0">Name</span>
      [WSL]
    </div>
    <div class="exec-cmd-desc">Description...</div>
    <code class="exec-cmd-code">echo hello</code>
  </div>
  <div class="exec-cmd-actions">
    <button class="btn-icon btn-icon-danger" title="Delete">✕</button>
  </div>
</div>
```

### 2.3 CSS (изменения в `css()` функции `exec.js`)

```css
.exec-cmd-card {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  background: var(--bg-secondary);
  border-radius: 6px;
  padding: 10px 12px;
  border-left: 3px solid transparent;
  transition: border-color 0.15s;
}
.exec-cmd-card:hover { border-left-color: var(--accent); }

.exec-cmd-run {
  width: 32px;
  height: 32px;
  flex-shrink: 0;
  background: rgba(63, 185, 80, 0.10);                /* var(--green) translucent */
  border: 1px solid var(--green, #3fb950);
  cursor: pointer;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  /* octagon — square with chamfered corners */
  clip-path: polygon(20% 0%, 80% 0%, 100% 20%, 100% 80%, 80% 100%, 20% 100%, 0% 80%, 0% 20%);
  transition: background 0.15s, transform 0.1s;
}
.exec-cmd-run:hover { background: rgba(63, 185, 80, 0.22); }
.exec-cmd-run:active { transform: scale(0.94); }
.exec-cmd-run svg { width: 14px; height: 14px; fill: var(--green, #3fb950); }
.exec-cmd-run:disabled { opacity: 0.4; cursor: not-allowed; }

.exec-cmd-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.exec-cmd-header { display: flex; align-items: center; gap: 8px; }
.exec-cmd-name {
  font-weight: 600;
  cursor: pointer;
  color: var(--text);
  transition: color 0.12s;
}
.exec-cmd-name:hover { color: var(--accent); text-decoration: underline; }
.exec-cmd-name:focus { outline: 1px solid var(--accent); outline-offset: 2px; }

.exec-cmd-actions { flex-shrink: 0; }
```

Старые правила `.exec-cmd-header { ...justify-content: space-between... }` и `.cmd-actions` удаляются / заменяются.

### 2.4 SVG треугольника (inline в `exec.js`)

```js
const RUN_ICON_SVG = '<svg viewBox="0 0 12 12" aria-hidden="true"><polygon points="3,2 10,6 3,10"/></svg>';
```

`viewBox 0 0 12 12`, треугольник смотрит вправо. `fill` берётся из CSS `.exec-cmd-run svg`.

### 2.5 JS-изменения (`renderCommands()` — `exec.js:214-260`)

```js
function renderCommands() {
  // ... no change for empty state ...
  for (const cmd of commands) {
    const card = el('div', { class: 'exec-cmd-card' });

    // Run button (left)
    const runBtn = el('button', { class: 'exec-cmd-run', title: `Run ${cmd.name}` });
    runBtn.setAttribute('aria-label', `Run ${cmd.name}`);
    runBtn.innerHTML = RUN_ICON_SVG;
    runBtn.addEventListener('click', () => onRunCommand(cmd));
    card.appendChild(runBtn);

    // Body (center)
    const body = el('div', { class: 'exec-cmd-body' });
    const header = el('div', { class: 'exec-cmd-header' });
    const nameEl = el('span', { text: cmd.name, class: 'exec-cmd-name' });
    nameEl.setAttribute('role', 'button');
    nameEl.setAttribute('tabindex', '0');
    nameEl.addEventListener('click', () => onEditCommand(cmd));
    nameEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onEditCommand(cmd); }
    });
    header.appendChild(nameEl);
    if (cmd.shell === 'wsl') {
      const label = cmd.wsl_distro ? `WSL · ${cmd.wsl_distro}` : 'WSL';
      const badge = el('span', { text: label });
      badge.style.cssText = 'padding:1px 7px;background:rgba(56,139,253,0.12);border:1px solid rgba(56,139,253,0.35);color:var(--accent);border-radius:10px;font-size:10px;font-weight:500';
      header.appendChild(badge);
    }
    body.appendChild(header);
    if (cmd.description) body.appendChild(el('div', { text: cmd.description, class: 'exec-cmd-desc' }));
    body.appendChild(el('code', { text: cmd.command, class: 'exec-cmd-code' }));
    card.appendChild(body);

    // Delete (right)
    const actions = el('div', { class: 'exec-cmd-actions' });
    const delBtn = el('button', { text: '✕', class: 'btn-icon btn-icon-danger', title: 'Delete' });
    delBtn.addEventListener('click', () => onDeleteCommand(cmd));
    actions.appendChild(delBtn);
    card.appendChild(actions);

    list.appendChild(card);
  }
}
```

Удаляются: `editBtn` целиком, кнопка `Run` как text-button. `cmd-actions` отдельный класс остаётся для delete-only.

### 2.6 Без изменений

- Backend, БД, state-machine исполнения (`run_command`, `stop_command`).
- Sort-order, `hide_after_run`, `shell`, `wsl_distro`.
- Категории, форма редактирования (`buildCommandForm`/`readCommandForm`).
- Console внизу.

---

## 3. Help / Changelog (CLAUDE.md §9)

**`desktop-rust/src/tabs/help.js`** — обновить i18n словари `en` / `ru`:

- В секции *Features* (Whisper):
  - RU: «Постобработка через локальную Gemma-модель: выберите модель в шапке таба, нажмите ✨ Post-process. Прогресс-бар показывает % генерации и количество токенов. Результат сохраняется в БД в отдельном табе „Post-processed“.»
  - EN: same.
- В секции *Features* (Exec): добавить про новый дизайн карточки — большая Run-кнопка слева, клик по имени открывает редактирование.

**`desktop-rust/CHANGELOG.md`** — новая секция сверху:
```
## vX.Y.Z (2026-04-26)
- Whisper: Gemma-комбобокс в шапке таба для быстрого переключения моделей пост-обработки.
- Whisper: правая секция разбита на табы «Whisper output» / «Post-processed»; результат пост-обработки сохраняется в истории.
- Whisper: статус-полоска прогресса — elapsed-таймер для распознавания, % + токены для пост-обработки.
- Exec: редизайн карточки — большая Run-кнопка (octagon, зелёный ▶) слева, клик по имени открывает редактирование, edit-кнопка убрана.
- DB: миграция — новая колонка `whisper_history.postprocessed_text`.
```

Конкретный номер версии (`vX.Y.Z`) определяется из текущего `desktop-rust/src-tauri/Cargo.toml` + bump minor. Берётся в момент релиза, не сейчас.

---

## 4. Релиз и ревью

- **Релиз `v-*`** — бандлится фронтенд + нативка (CLAUDE.md §12). `f-*` OTA не подходит: миграция БД + новые `#[tauri::command]`'ы + новое emit-event.
- **Перед мержем** — review через subagent на opus max-effort (CLAUDE.md §13) с фокусом:
  - SSE-парсер `complete_stream` (что если строка `data: ...` пришла кусками между чанками HTTP?),
  - throttle прогресс-эмитов (race между throttle-stub и финальным `done=true`),
  - migration idempotency (повторный запуск миграции на уже мигрированной БД),
  - `lock_recover()` использование в новом `update_whisper_history_postprocessed`,
  - UTF-8 safety в любых обрезках текста (CLAUDE.md §10) — постобработанный текст содержит кириллицу.

---

## 5. Out-of-scope (не делаем сейчас)

- **Реальный whisper-прогресс** через патч sidecar (`--print-progress` + stderr-парсинг): отдельная задача, требует rebuild whisper-server в CI и решения вопроса буферизации stderr на Windows.
- **Кнопка `↻ Re-process`** на табе `Post-processed`: для повторной обработки пользователь возвращается на «Whisper output» и нажимает `✨ Post-process` — результат перезапишется.
- **Редактирование `postprocessed_text` с автосохранением**: текущая логика whisper-output тоже не пишет правки textarea обратно в БД. Согласованно остаётся локальной.
- **Streaming визуализации текста** в табе `Post-processed` (как у ChatGPT — текст по токенам появляется): сложнее (нужен UI-state на partial-buffer), для голос-постпроцессинга малой длины не критично — статус-полоски хватает.
