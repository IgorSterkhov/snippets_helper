# AI Agent Settings And Versioning Spec

## Goal

Make the AI module understandable and configurable from inside the AI tab, and
make release version bumps explicit so large user-facing features are not
published as patch-looking hotfixes.

This pass adds:

- an AI tab gear button that opens agent settings;
- per-user custom AI instructions stored on the sync API server;
- a capabilities view that shows which app tools the agent can use and which
  context fields it receives;
- a safe prompt preview flow that asks DeepSeek for a plan but does not execute
  any app command;
- a Telegram-specific "show task" behavior where "покажи задачу" returns task
  details and checkbox hierarchy as a bot message;
- project rules for choosing patch/minor/major desktop versions.

## Current Context

The AI layer already has:

- server-managed per-user DeepSeek and Telegram tokens;
- `POST /v1/ai/chat`;
- strict DeepSeek tool schemas in `api/ai_commands.py`;
- command execution for desktop-local actions and Telegram server-side actions;
- a compact AI desktop tab with Chat/Command, voice input, response panel, and
  execution log.

The current limitations are:

- the hardcoded prompt is not visible or adjustable by the user;
- the app does not expose the agent tool catalog in the UI;
- testing a prompt can accidentally execute commands if the user uses Command
  mode directly;
- in Telegram, "show task" currently maps to an open/show command, which is
  meaningful for desktop navigation but not for a chat bot;
- release documentation explains `v*` vs `f-*`, but not when semver minor or
  major bumps are required.

## Product Decisions

- General Settings -> AI remains minimal and only manages provider credentials,
  balance, usage link, and Telegram pairing.
- Advanced agent behavior lives inside the AI module behind a gear icon.
- Core safety instructions are immutable. The user may add custom instructions,
  but cannot remove restrictions such as no deletion, no bulk edits, no UUID
  invention, and no execution without supported tool calls.
- Custom instructions are per sync API user, because DeepSeek and Telegram
  credentials are already per user and Telegram runs on the server.
- The capabilities view is generated from server-side tool definitions. It is a
  read-only diagnostic/explanation surface, not a second hand-written copy.
- Prompt preview is a dry-run AI call. It may spend DeepSeek tokens, but it
  must not mutate app data and must not navigate the desktop UI.
- Telegram "show task" means "send a readable task summary with properties and
  checkbox tree back to the chat." Desktop `open_task` keeps its current
  navigation behavior.

## API Contract

`GET /v1/ai/agent-settings`

- returns `custom_instructions`, `updated_at`, and a `core_instructions`
  read-only text;
- never returns provider tokens.

`PUT /v1/ai/agent-settings`

- stores trimmed `custom_instructions`;
- accepts an empty string to clear custom instructions;
- caps the stored text to a moderate length so the system prompt cannot become
  unbounded.

`GET /v1/ai/capabilities`

- returns the command catalog derived from `deepseek_tools()`;
- returns current context field names and descriptions;
- returns immutable safety rules and Telegram behavior notes.

`POST /v1/ai/preview`

- requires the current user's DeepSeek key;
- accepts the same message/mode/context shape as chat;
- calls DeepSeek with the same prompt and tool schema;
- returns `reply` and `commands`;
- never executes returned commands, regardless of channel or mode.

`POST /v1/ai/chat`

- uses the same prompt builder, now composed from immutable core instructions,
  optional user custom instructions, context, capabilities, and channel notes.

## AI Tool Changes

Add one server/app tool:

- `show_task(task_uuid?: string, query?: string)`.

Desktop behavior:

- `show_task` may be treated the same as `open_task`, because the useful local
  action is to navigate to the task.

Telegram behavior:

- resolves the task by UUID or query;
- returns a message containing task title, category/status when known, tracker
  URL/notes hint when present, and all non-deleted checkboxes in hierarchy
  order;
- renders checked checkboxes distinctly from unchecked ones using plain text
  markers that are safe for Telegram messages;
- does not mutate data.

## Desktop UX

The AI tab header gets a small gear icon next to the existing help button.

The modal title is "AI Agent Settings" and contains three compact sections:

- Instructions: a textarea for custom user instructions, Reset, Save.
- Capabilities: read-only lists of supported tools, context fields, and safety
  rules from the server.
- Test Prompt: textarea, Preview button, reply area, and planned command list.

Error handling in this modal uses the existing copyable error dialog rather than
only a disappearing toast.

The design stays dark, compact, and operational. The modal is a tool surface,
not a marketing page.

## Versioning Rules

Desktop releases use semver intent:

- Patch (`X.Y.Z+1`): bug fixes, small UI adjustments, copy changes, or narrow
  behavior fixes that do not add a new user workflow or IPC/API surface.
- Minor (`X.Y+1.0`): new modules, new visible workflows, new provider
  integrations, new API/Tauri command surface, synced data features, or
  substantial cross-module behavior.
- Major (`X+1.0.0`): incompatible local DB/API/sync protocol changes, breaking
  migrations, removed workflows, or changes that require explicit user data
  migration planning.

Tag channel is still separate from semver intent:

- `f-*` is only for frontend-only OTA changes with no native IPC change.
- `vX.Y.Z` is required for native/Rust changes, new Tauri commands, dependency
  changes, or any semver bump that should produce installers.

For this pass, the correct release is `v1.4.0`: it adds new API endpoints,
new Tauri commands, AI agent configuration UI, and a new Telegram behavior.

## Testing

API tests cover:

- custom instructions save/clear and non-secret response;
- prompt builder includes custom instructions but preserves immutable safety;
- capabilities are generated from the tool catalog;
- preview returns commands without executing them;
- `show_task` resolves a task and formats nested checkboxes for Telegram.

Desktop tests cover:

- AI gear button opens the settings modal;
- instructions can be saved and reset through the browser mock;
- capabilities render at least one known tool and one safety rule;
- preview renders a planned command without executing local actions.

Release verification covers:

- API suite;
- changed JS syntax checks;
- browser smoke tests;
- Rust `cargo check`;
- Help/release-history/changelog gates;
- `v1.4.0` GitHub Actions assets and manifest.
