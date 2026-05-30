# AI Provider Balance And Telegram Settings Spec

## Goal

Add per-user AI provider management to the desktop app and API:

- show DeepSeek balance for the current sync API user;
- open the DeepSeek usage cabinet at `https://platform.deepseek.com/usage`;
- store a Telegram bot token per sync API user, managed from desktop Settings;
- expand Help and the AI tab with practical guidance for AI and Telegram usage.

## Decisions

- DeepSeek balance is checked by the server, not by desktop. Desktop calls the
  sync API, and the API uses the current user's stored DeepSeek key.
- Saved secrets are never returned to clients. Settings responses expose only
  configured flags and update timestamps.
- Telegram bot token is per-user only. The old server-global
  `TELEGRAM_BOT_TOKEN` mechanism is removed and must not be used as fallback.
- Telegram chat authorization remains deny-by-default. A bot token alone does
  not authorize arbitrary chats; chats still need explicit server-side binding
  to a sync API user.
- Telegram processed update offsets must be user-scoped so two different bot
  tokens cannot interfere with each other's update stream.
- The AI tab help is an in-tab help modal, consistent with other compact tool
  help patterns, and the global Help feature list is updated as the release gate.

## API Contract

`GET /v1/ai/provider-settings`

- returns `deepseek_configured`, `deepseek_updated_at`,
  `telegram_bot_configured`, and `telegram_bot_updated_at`;
- never returns either token.

`PUT /v1/ai/provider-settings`

- keeps the existing DeepSeek key save contract for desktop compatibility.

`DELETE /v1/ai/provider-settings`

- keeps the existing DeepSeek key clear contract.

`GET /v1/ai/provider-balance`

- requires the current user to have a DeepSeek key;
- calls DeepSeek `GET /user/balance`;
- returns `is_available` plus `balance_infos` with `currency`,
  `total_balance`, `granted_balance`, and `topped_up_balance`;
- maps DeepSeek/network failures to a 502 with a readable message.

`PUT /v1/ai/provider-settings/telegram-bot`

- stores a trimmed Telegram bot token for the current user.

`DELETE /v1/ai/provider-settings/telegram-bot`

- clears the current user's Telegram bot token.

`GET /v1/telegram/my/status` and `POST /v1/telegram/my/poll-once`

- use the current user's Telegram bot token;
- are non-admin endpoints;
- preserve the existing deny-by-default chat binding behavior.

## Desktop UX

Settings -> AI contains two provider blocks:

- DeepSeek: configured status, password input, Save/Clear/Refresh, Check
  balance, and Open usage cabinet.
- Telegram Bot: configured status, password input, Save/Clear/Refresh, and a
  short note that the token comes from BotFather and chat binding is currently a
  server-side command.

The DeepSeek balance UI shows:

- unavailable/not configured state;
- available/unavailable state from DeepSeek;
- one compact row per currency with total, granted, and topped-up balances.

The AI tab header gets a compact help button. The help modal explains:

- Chat mode vs Command mode;
- what commands can currently do;
- how voice prompts enter the text box;
- how Telegram bot execution differs from desktop local command execution;
- example prompts for opening, creating, adding, and completing task items;
- where to configure DeepSeek and Telegram keys.
- The AI tab voice control has an explicit provider selector. `Whisper` uses
  the local recording path; `Deepgram` uses the configured Deepgram live
  transcription key from Whisper settings and inserts the stopped transcript
  into the AI prompt.
- Command mode may run one follow-up AI turn after a pure search result when
  the original request clearly asks for a mutation. This lets requests such as
  "in task Аптека mark checkbox Купить уголь done" continue from a found task
  to the actual checkbox command without the user repeating the request.

## Compatibility And Release Notes

- This is a full desktop release because new Tauri commands are added.
- Existing server-global Telegram tokens are intentionally ignored after this
  release; users must save their own Telegram bot token in Settings -> AI.
- Existing DeepSeek settings keep working because the old DeepSeek
  save/clear/get command names and API paths are preserved.
- Help, `desktop-rust/src/release-history.md`, and
  `desktop-rust/CHANGELOG.md` must mention the new Settings and help behavior.
