# AI Agent Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a server-managed DeepSeek AI gateway, server-side Telegram bot support, and desktop/mobile AI modules that can answer or execute safe Tasks/Notes/Snippets commands.

**Architecture:** Build a shared AI command schema and validation layer first, then expose it through API routes. Desktop and mobile call the API for AI planning and execute UI navigation/local writes on-device. Telegram is deny-by-default, maps each authorized chat to one app user, and executes safe data mutations server-side so devices receive changes through sync.

**Tech Stack:** FastAPI + SQLAlchemy async server, DeepSeek OpenAI-compatible chat completions, Telegram Bot API, Tauri desktop frontend/native commands, React Native mobile app, existing sync tables and repositories.

---

## Phase 1: Server AI Gateway And Command Schema

### Task 1: Add Server Configuration

**Files:**
- Modify: `api/config.py`

- [x] **Step 1: Add config constants**

Add:

```python
DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY", "")
DEEPSEEK_BASE_URL = os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com").rstrip("/")
DEEPSEEK_MODEL = os.getenv("DEEPSEEK_MODEL", "deepseek-chat")
DEEPSEEK_TIMEOUT_SECONDS = float(os.getenv("DEEPSEEK_TIMEOUT_SECONDS", "30"))

TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_ALLOWED_CHAT_IDS = {
    x.strip()
    for x in os.getenv("TELEGRAM_ALLOWED_CHAT_IDS", "").split(",")
    if x.strip()
}
```

- [x] **Step 2: Syntax check**

Run:

```bash
python3 -m py_compile api/config.py
```

Expected: exit 0.

### Task 2: Define AI Schemas

**Files:**
- Modify: `api/schemas.py`

- [x] **Step 1: Add Pydantic models**

Add models for:

```python
class AiContext(BaseModel):
    module: Optional[str] = None
    current_task_uuid: Optional[str] = None
    current_note_uuid: Optional[str] = None
    current_snippet_uuid: Optional[str] = None
    recent_task_uuid: Optional[str] = None
    locale: Optional[str] = None


class AiChatRequest(BaseModel):
    mode: str = "command"
    channel: str = "client"
    message: str
    context: AiContext = AiContext()


class AiCommandCall(BaseModel):
    name: str
    args: dict = {}


class AiCommandResult(BaseModel):
    name: str
    args: dict = {}
    status: str
    message: str
    item_type: Optional[str] = None
    item_uuid: Optional[str] = None
    choices: list[dict] = []


class AiChatResponse(BaseModel):
    mode: str
    reply: str
    commands: list[AiCommandCall] = []
    results: list[AiCommandResult] = []
```

- [x] **Step 2: Validate schema import**

Run:

```bash
python3 -m py_compile api/schemas.py
```

Expected: exit 0.

### Task 3: Add AI Command Catalog

**Files:**
- Create: `api/ai_commands.py`

- [x] **Step 1: Implement command definitions**

Create a module that exposes:

- `AI_COMMAND_NAMES`;
- `deepseek_tools()`;
- `validate_command_call(call: dict) -> AiCommandCall`.

The first tool schemas must include only:

- `search_tasks`;
- `open_task`;
- `add_task_checkbox`;
- `complete_task_checkbox`;
- `create_task`;
- `search_notes`;
- `open_note`;
- `search_snippets`;
- `open_snippet`.

- [x] **Step 2: Unit-level smoke**

Run:

```bash
python3 -m py_compile api/ai_commands.py
```

Expected: exit 0.

### Task 4: Add DeepSeek Client

**Files:**
- Create: `api/deepseek_client.py`
- Modify: `api/requirements.txt`

- [x] **Step 1: Ensure HTTP client dependency**

If `httpx` is missing, add:

```text
httpx>=0.27.0
```

- [x] **Step 2: Implement request wrapper**

Create `DeepSeekClient` with:

- constructor from config;
- `chat(message, context, tools)` method;
- timeout handling;
- clear error messages when API key is missing;
- parser for `message.content` and `message.tool_calls`.

- [x] **Step 3: Mockable boundary**

Make the client accept an optional async HTTP client/session so tests can stub
DeepSeek without network.

### Task 5: Add Server-Side Search And Mutation Runtime

**Files:**
- Create: `api/ai_runtime.py`

- [x] **Step 1: Implement search helpers**

Search by `ilike` over:

- tasks: `Task.title`;
- notes: `Note.title`, `Note.content`;
- snippets: `Shortcut.name`, `Shortcut.value`, `Shortcut.description`.

Limit each result set to 5 candidates.

- [x] **Step 2: Implement command executor**

Implement `execute_command(db, user, command, context)` for the first command
set. Rules:

- one strong match executes;
- zero matches returns `status="failed"`;
- multiple matches returns `status="needs_clarification"` with choices;
- task checkbox writes use `task_uuid`, not local integer IDs;
- every write sets `updated_at = datetime.utcnow()`;
- no destructive commands.

- [x] **Step 3: Compile**

Run:

```bash
python3 -m py_compile api/ai_runtime.py
```

Expected: exit 0.

### Task 6: Add AI API Route

**Files:**
- Create: `api/routes/ai.py`
- Modify: `api/main.py`

- [x] **Step 1: Add route**

Add:

```python
router = APIRouter(prefix="/ai", tags=["ai"])

@router.post("/chat", response_model=AiChatResponse)
async def ai_chat(...):
    ...
```

Behavior:

- authenticate with existing API key dependency;
- build bounded context using local server search when needed;
- call DeepSeek with tool schemas;
- validate returned tool calls;
- for `channel="client"` requests, return validated commands without mutating
  server data;
- for `channel="telegram"` requests, execute safe commands server-side after the
  Telegram chat has been mapped to a user;
- return reply + command plan/execution log.

- [x] **Step 2: Register router**

In `api/main.py` import and include `ai.router` under `/v1`.

### Task 7: Add API Tests

**Files:**
- Create: `tests/api/test_ai_runtime.py` or use the existing server test layout if one exists after inspection.

- [x] **Step 1: Test command validation**

Cover:

- valid `open_task`;
- invalid unknown command rejected;
- destructive command not accepted.

- [x] **Step 2: Test runtime ambiguity**

Seed two tasks with similar names and assert `needs_clarification`.

- [x] **Step 3: Test create task with checkboxes**

Assert rows are created with UUID relationships and updated timestamps.

## Phase 2: Desktop AI Module

### Task 8: Add Desktop AI Tab Shell

**Files:**
- Modify: `desktop-rust/src/main.js`
- Create: `desktop-rust/src/tabs/ai/ai-main.js`
- Create: `desktop-rust/src/tabs/ai/ai-css.js`
- Modify: `desktop-rust/src/dev-mock.js`
- Modify: `desktop-rust/src/dev-test.py`

- [x] **Step 1: Add failing browser test**

In `dev-test.py`, add a smoke test that clicks the AI tab and asserts:

- mode selector exists;
- text input exists;
- Send button exists;
- execution log exists.

- [x] **Step 2: Implement AI tab shell**

Add `AI` to `TABS` and render a compact dark operational layout.

- [x] **Step 3: Add mock route**

In `dev-mock.js`, mock `ai_chat` or the API client boundary used by the tab.

### Task 9: Add Desktop AI API Client

**Files:**
- Create: `desktop-rust/src/tabs/ai/ai-api.js`
- Modify: `desktop-rust/src/tabs/ai/ai-main.js`
- Create: `desktop-rust/src-tauri/src/commands/ai.rs`
- Modify: `desktop-rust/src-tauri/src/commands/mod.rs`
- Modify: `desktop-rust/src-tauri/src/lib.rs`

- [x] **Step 1: Reuse sync settings**

Use existing server base URL and API key settings through a native Tauri
`ai_chat` proxy. Do not store DeepSeek token on desktop. The native proxy must
force `channel="client"` before sending to the server.

- [x] **Step 2: Implement send**

Post to `/v1/ai/chat` with:

- mode;
- message;
- current module/context;
- current selected UUIDs where available.

### Task 10: Add Desktop Command Dispatcher

**Files:**
- Create: `desktop-rust/src/tabs/ai/ai-dispatcher.js`
- Modify: Tasks/Notes/Snippets modules only where needed to expose lightweight
  open/select helpers.

- [x] **Step 1: Add navigation bus**

Create browser custom events:

- `ai:activate-tab`;
- `ai:tasks-open`;
- `ai:notes-open`;
- `ai:notes-search`;
- `ai:snippets-open`;
- `ai:snippets-search`.

- [x] **Step 2: Wire modules**

Tasks, Notes, and Snippets listen for events and reuse existing list/detail
loading code to open the target item.

- [x] **Step 3: Test**

Add browser smoke tests for:

- AI response with `open_task` switches to Tasks and opens the task;
- AI response with `add_task_checkbox` adds a checkbox to current task;
- AI response with `create_task` creates a task, opens it, and adds optional
  root checkboxes.

### Task 11: Desktop Voice To AI

**Files:**
- Modify: `desktop-rust/src/tabs/ai/ai-main.js`
- Reuse existing `desktop-rust/src/tabs/whisper/*` APIs where possible.

- [x] **Step 1: Add microphone button**

Desktop microphone button should invoke existing local/Deepgram transcription
flow where available, then place transcript into the AI input and optionally
send it.

- [x] **Step 2: Fallback**

If no voice engine is configured, show a persistent error/dialog or inline
message explaining that Whisper/Deepgram must be configured.

## Phase 3: Mobile AI Tab

### Task 12: Add Mobile AI Navigation

**Files:**
- Modify: `mobile/src/navigation/AppNavigator.js`
- Create: `mobile/src/screens/AI/AIScreen.js`
- Create: `mobile/src/api/ai.js`

- [x] **Step 1: Add failing Jest/snapshot-level test if current mobile test setup supports navigation tests**

If no suitable navigation test harness exists, add isolated tests for the AI API
client and command dispatcher instead.

- [x] **Step 2: Add AI tab**

Add `AI` to bottom tabs with dark-theme compatible UI.

### Task 13: Mobile AI API Client And Dispatcher

**Files:**
- Create: `mobile/src/ai/commandDispatcher.js`
- Modify: `mobile/src/screens/AI/AIScreen.js`

- [x] **Step 1: Implement client**

Call `/v1/ai/chat` through existing API client.

- [x] **Step 2: Implement local command execution**

Commands:

- `open_task` -> navigate to `TaskEditor`;
- `open_note` -> navigate to `NoteEditor`;
- `open_snippet` -> navigate to `SnippetDetail`;
- `add_task_checkbox` -> write through `taskRepo`;
- `complete_task_checkbox` -> write through `taskRepo`;
- `create_task` -> write through `taskRepo`.

- [x] **Step 3: Trigger sync**

After writes, call existing sync service or mark changes so the existing sync
cycle pushes them.

### Task 14: Mobile Voice Input Decision

**Files:**
- Inspect and then modify `mobile/package.json`, `mobile/android/**`, and
  `mobile/src/screens/AI/AIScreen.js` only if native audio capture is needed.

- [ ] **Step 1: Choose implementation after inspection**

If an existing speech/audio module is not available, add a native-capable speech
or recording dependency and Android microphone permission. This makes the mobile
release an APK release.

- [ ] **Step 2: Implement press-to-record**

Send transcript text into the AI input and let the user send or auto-send based
on a local setting.

## Phase 4: Telegram Bot

### Task 15: Add Telegram Authorization And Idempotency

**Files:**
- Modify: `api/models.py`
- Create migration: `api/alembic/versions/011_add_telegram_ai_tables.py`

- [x] **Step 1: Add durable mapping and processed-message models**

Add tables:

- `telegram_chat_bindings`: `chat_id` primary/unique, `user_id`, `created_at`,
  `updated_at`, `is_active`;
- `telegram_processed_messages`: `chat_id`, `message_id`, `update_id`,
  `created_at`, unique on `(chat_id, message_id)`.

- [x] **Step 2: Migration**

Create Alembic migration with snake_case names and indexes.

- [x] **Step 3: Tests**

Add tests proving:

- unknown chat is denied before DeepSeek is called;
- repeated `(chat_id, message_id)` does not execute a write twice.

### Task 16: Add Telegram Bot Module

**Files:**
- Create: `api/telegram_bot.py`
- Modify: `api/config.py`

- [x] **Step 1: Implement polling worker**

Use Telegram `getUpdates` with durable offset/message tracking. Deny unknown
chats before calling DeepSeek. Resolve every accepted chat to exactly one app
`User` before calling server-side command execution.

- [x] **Step 2: Implement replies**

Use `sendMessage` with command execution summary.

### Task 17: Add Telegram Admin/Runtime Control

**Files:**
- Create: `api/routes/telegram.py`
- Modify: `api/main.py`

- [x] **Step 1: Add health/status endpoints**

Expose admin-only status:

- configured/not configured;
- last update ID;
- last error;
- polling enabled state.

- [x] **Step 2: Start polling safely**

Do not start polling automatically in test mode. For production, either start
from app lifespan when token is configured or run via a separate process
command.

## Phase 5: Docs, Help, Releases

### Task 18: Desktop Help And Release

**Files:**
- Modify: `desktop-rust/src/tabs/help.js`
- Modify: `desktop-rust/src/release-history.md`
- Modify: `desktop-rust/CHANGELOG.md`

- [ ] **Step 1: Update Help**

Document AI tab, DeepSeek server-managed token, command mode, and Telegram
server bot.

- [ ] **Step 2: Release type**

If desktop native commands changed, bump native version and publish `v*`. If
desktop only changed frontend and API/mobile are released separately, publish
`f-*` only for desktop frontend changes.

### Task 19: Mobile Release

**Files:**
- Modify: `mobile/package.json`
- Possibly modify: `mobile/android/**`

- [ ] **Step 1: Determine release type**

If mobile voice adds permissions/dependencies, cut APK release. If AI tab is JS
only, cut mobile OTA.

- [ ] **Step 2: Run mobile checks**

Run:

```bash
cd mobile && npm test
```

Expected: existing tests pass plus new AI tests.

### Task 20: End-To-End Smoke

**Files:**
- Add tests under the existing `tests/post_release/` harness if suitable.

- [ ] **Step 1: API smoke**

Post `/v1/ai/chat` with a mocked DeepSeek response and assert command log.

- [ ] **Step 2: Desktop smoke**

Open AI tab, send mocked command response, assert Tasks opens target task.

- [ ] **Step 3: Mobile manual smoke**

After mobile release, verify:

- AI tab opens;
- text command can open a task;
- command can add a checkbox;
- sync propagates change to desktop.

## Reviewer Checklist

- DeepSeek token must never be stored on desktop/mobile.
- Telegram token must never be stored on desktop/mobile.
- Telegram chat execution must be deny-by-default and mapped to one app user
  before DeepSeek or command execution runs.
- Telegram update/message IDs must be durable/idempotent for write commands.
- Desktop/mobile `/v1/ai/chat` requests must not cause server-side writes;
  they receive validated commands and execute locally.
- AI must not get destructive command schemas in the first release.
- Server-side Telegram writes must use UUID relationships so mobile sync pulls
  task checkboxes correctly.
- Mobile voice changes must be classified correctly as APK vs OTA.
- Desktop native command additions must be classified correctly as `v*` vs
  `f-*`.
- Ambiguous search must not mutate data.
