# AI Agent Control

## Goal

Add an AI control layer that lets the user ask, by text or voice, for help with
Tasks, Notes, and Snippets. The AI can either answer in an AI tab or return
strict application commands that the app validates and executes.

Confirmed decisions:

- DeepSeek token is server-managed.
- Telegram bot is server-side.
- Low-risk commands auto-execute and are shown in an execution log.

## Core Principle

The AI model never writes directly to the database and never receives raw DB
write access.

The model receives:

- a compact description of the app data model;
- the current UI context;
- a bounded set of locally/server-side searched candidates;
- a strict list of supported tools/commands.

The app/server receives from the AI:

- a chat response for the AI tab; or
- structured tool calls / commands that match a strict schema.

The app/server then validates and executes those commands through existing
application APIs and repositories.

## Supported Interaction Modes

### Chat Mode

The user asks a question and the AI answers in the AI module.

Examples:

- "Что у меня есть по задаче Аптека?"
- "Найди сниппет про rsync и объясни что он делает."

### Command Mode

The user asks the AI to operate the app.

Examples:

- "Покажи задачу Аптека."
- "Покажи заметку про отпуск."
- "Покажи сниппет по ssh."
- "Покажи задачу Аптека и добавь туда пункт купить аспирин."
- "Добавь в эту задачу пункт купить аспирин."
- "Отметь в этой задаче пункт купить аспирин выполненным."
- "Добавь новую задачу Аптека с пунктами купить аспирин, проверить рецепт."

## Command Safety

Low-risk commands auto-execute:

- search;
- open/show item;
- add task;
- add checkbox;
- mark checkbox completed.

Commands that must require explicit confirmation in a later pass:

- delete;
- bulk update;
- bulk complete;
- moving/reordering many rows;
- sharing/revoking public links;
- changing sync/server settings.

The first release must not expose destructive commands to the AI command schema.

## Execution Ownership

AI planning and command execution are separated by channel.

Desktop/mobile:

- call the server AI gateway for interpretation and validated command planning;
- receive `commands` plus `results` describing what the app should do;
- execute UI navigation and local writes on the device through existing local
  repositories/commands;
- then sync normally.

Telegram:

- calls the same AI planning layer on the server;
- executes safe data mutations server-side through the server command runtime;
- never navigates desktop/mobile UI;
- relies on normal sync for devices to receive the changes.

The server AI route for desktop/mobile must not auto-create local user data
unless the request explicitly declares a server-executed channel such as
Telegram. This avoids duplicate UUIDs and sync conflicts where the server and
client both execute the same `create_task` or `add_task_checkbox` command.

## AI Command Schema

The first command set:

- `search_tasks(query: string)`;
- `open_task(task_uuid?: string, query?: string)`;
- `add_task_checkbox(task_uuid?: string, task_ref?: "current", text: string)`;
- `complete_task_checkbox(task_uuid?: string, task_ref?: "current", checkbox_uuid?: string, query?: string)`;
- `create_task(title: string, checkboxes?: string[])`;
- `search_notes(query: string)`;
- `open_note(note_uuid?: string, query?: string)`;
- `search_snippets(query: string)`;
- `open_snippet(snippet_uuid?: string, query?: string)`.

Every command result must be logged as:

- command name;
- arguments;
- status: `executed`, `needs_clarification`, `failed`;
- short human-readable result;
- referenced item UUIDs where applicable.

## Ambiguity Handling

If search returns:

- zero candidates: respond with "not found" and do not mutate data;
- one strong candidate: execute;
- multiple plausible candidates: ask for clarification and show choices.

The model is allowed to ask a clarification question, but the app must make the
final decision about whether a command is executable.

## Current Context

The AI context must include:

- current module: tasks, notes, snippets, or ai;
- currently selected task/note/snippet UUID and title/name when available;
- recent command target, so "эту задачу" can refer to the last opened task;
- language preference inferred from user prompt / app locale.

## DeepSeek Integration

Use the DeepSeek OpenAI-compatible chat completions API from the server.

Server configuration:

- `DEEPSEEK_API_KEY`;
- `DEEPSEEK_BASE_URL`, default `https://api.deepseek.com`;
- `DEEPSEEK_MODEL`, default configurable, initially `deepseek-chat`;
- request timeout and max context limits.

The server should prefer tool/function calling with strict schemas for command
mode. If a model response cannot be parsed or validated, it must be treated as a
chat answer or a failed AI request, not as an executable command.

## Telegram Integration

Telegram bot is server-side.

Server configuration:

- `TELEGRAM_BOT_TOKEN`;
- optional allowed user/chat IDs;
- polling endpoint/worker for initial release, webhook can be a later
  deployment improvement.

Telegram behavior:

- incoming text goes through the same AI command runtime;
- server-side commands mutate synced server tables;
- desktop/mobile receive changes through existing sync;
- Telegram replies with the command execution summary.

Telegram does not control desktop/mobile UI navigation directly; it operates on
server data. UI navigation remains local to desktop/mobile AI tabs.

Telegram security is deny-by-default:

- a Telegram chat cannot execute commands until it is mapped to exactly one app
  `User`;
- the first implementation may use an admin-managed durable chat-id-to-user
  mapping table or a mandatory allow-list plus single-user binding;
- unknown chats receive an authorization error and no AI request is sent;
- update/message IDs must be persisted or deduplicated so bot restarts do not
  replay write commands.

## Desktop UX

Add an `AI` module to the left sidebar.

Desktop AI module:

- dark, compact operational layout matching existing desktop style;
- mode selector: `Chat` / `Command`;
- text input;
- send button;
- microphone button using existing Whisper/Deepgram transcription pipeline when
  possible;
- transcript/result panel;
- execution log panel;
- settings entry showing server-managed DeepSeek status, not the raw token.

Desktop command execution:

- `open_task` switches to Tasks and opens the task;
- `open_note` switches to Notes and opens the note;
- `open_snippet` switches to Snippets and opens the snippet;
- `create_task` creates a local task and opens it;
- `add_task_checkbox` and `complete_task_checkbox` update local SQLite through
  existing commands and trigger normal sync.

## Mobile UX

Add an `AI` tab to the bottom navigation.

Mobile AI screen:

- dark theme compatible with existing `ThemeContext`;
- mode selector: `Chat` / `Command`;
- text input;
- send button;
- microphone button;
- response area;
- execution log / last actions area.

Mobile command execution:

- `open_task` navigates to `TaskEditor`;
- `open_note` navigates to `NoteEditor`;
- `open_snippet` navigates to `SnippetDetail`;
- writes use existing local repos and sync metadata.

Mobile voice input may require a native audio dependency and Android
permissions. If so, the first mobile AI release is an APK release, not an OTA.

## Server-Side Data Operations For Telegram

The server-side command runtime must be able to:

- search tasks/notes/snippets for the authenticated user;
- create tasks;
- create task checkboxes with `task_uuid`;
- mark task checkboxes checked;
- update `updated_at` so sync clients pull the changes;
- avoid local integer IDs where UUID relations exist.

## Security And Privacy

- DeepSeek token is never sent to clients.
- Telegram bot token is never sent to clients.
- The AI receives only bounded search results and current context, not the full
  database by default.
- API keys identify the user for desktop/mobile AI calls.
- Telegram users must be mapped or allow-listed before commands are executed.
- The execution log must not expose secrets.

## Out Of Scope For First Release

- Destructive AI commands.
- Bulk editing.
- Arbitrary SQL/DB access by AI.
- Autonomous background actions without a user prompt.
- AI access to public share-link creation/revocation.
- Multi-provider abstraction beyond a narrow provider boundary for DeepSeek.
- Aggressive streaming tool execution. Streaming chat can be added only after
  basic request/response is stable.

## Release Expectations

This feature touches:

- API/server routes and config;
- desktop native/API surface if new Tauri commands are needed;
- desktop frontend;
- mobile JS and possibly mobile native permissions/dependencies;
- release history/help for both desktop and mobile as applicable.

Desktop native changes require a `v*` release. Mobile native changes require an
APK release. JS-only mobile changes can use the existing OTA flow.
