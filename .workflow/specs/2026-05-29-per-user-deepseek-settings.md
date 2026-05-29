# Per-User DeepSeek Settings

## Goal

Move DeepSeek credentials from a server-global deployment secret to a per-user
server-side setting managed from the desktop Settings modal.

## Confirmed Decisions

- DeepSeek API key is per app user, not global for the whole API server.
- Desktop Settings is the first management UI.
- The raw key is sent only when saving/replacing it and is never returned to
  desktop, mobile, Telegram, logs, or sync payloads.
- Telegram AI uses the DeepSeek key of the app user bound to the Telegram chat.
- `DEEPSEEK_BASE_URL`, `DEEPSEEK_MODEL`, and timeout remain server defaults for
  now.

## Server Behavior

- Add nullable `users.deepseek_api_key` and `users.deepseek_updated_at`.
- Add authenticated endpoints:
  - `GET /v1/ai/provider-settings` returns whether DeepSeek is configured.
  - `PUT /v1/ai/provider-settings` stores/replaces the current user's key.
  - `DELETE /v1/ai/provider-settings` clears the current user's key.
- `POST /v1/ai/chat` must reject requests with HTTP 400 if the current user has
  no DeepSeek key configured.
- DeepSeek calls must be constructed with the current user's key, not
  `DEEPSEEK_API_KEY`.
- Existing global DeepSeek env support can stay inside the low-level client for
  tests and future admin defaults, but public AI and Telegram runtime must pass
  an explicit per-user key.

## Desktop UX

- Add `AI` to Settings sub-tabs.
- Show status: configured / not configured and last update timestamp if present.
- Show a password input for a new DeepSeek API key. The saved key is never
  prefilled.
- Actions:
  - `Save` stores/replaces the key on the server.
  - `Clear` removes the saved key.
  - `Refresh` reloads status.
- The tab uses the existing Sync API URL/key settings for authentication. If
  sync is not configured, show the backend error in the same compact settings
  style.

## Non-Goals

- No per-user Telegram bot token in this pass.
- No mobile UI for editing the DeepSeek key in this pass.
- No sync table for the secret.
- No encryption-at-rest change in this pass; the immediate security boundary is
  that the key is stored server-side and is never returned through API responses.

## Release Impact

This adds new Tauri commands, so it must ship as a full `v*` desktop release,
not a frontend-only `f-*` OTA.
