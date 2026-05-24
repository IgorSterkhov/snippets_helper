# Mobile Task Header Eye Toggle and Save Button — Requirement Spec

## Status

Approved by user on 2026-05-24 after visual review. Selected design: variant C
with a more expressive eye icon.

## Goal

Make the mobile task editor's checkbox visibility preference available directly
from the task editor header and make `Сохранить` look like a button instead of
a plain text link.

## Scope

Ship as a mobile OTA if only JavaScript/mobile files change.

In scope:

- Add an eye button to the task editor header, immediately left of
  `Сохранить`.
- The eye button toggles existing `tasks.hide_completed_checkboxes`.
- Use an expressive drawn eye icon:
  - normal eye when completed checkboxes are shown;
  - slashed eye when completed checkboxes are hidden.
- Keep the existing Settings switch synchronized because both controls use the
  same AsyncStorage key.
- Change `Сохранить` from link-like text to an outline pill button.

Out of scope:

- New settings keys.
- Server/API changes.
- Desktop changes.
- Native Android changes.

## Interaction Requirements

- Tapping the eye immediately updates the current editor view.
- Tapping the eye persists the preference locally.
- If persistence fails, restore the previous UI state and show an error alert.
- `Сохранить` remains disabled while saving and shows `Сохр…`.
- The header must fit on mobile width with the back button and centered title.

## Testing

Add unit coverage for toggling task preferences:

- `toggleTaskPreference(TASK_PREF_KEYS.hideDone, false)` stores `true` and
  returns `true`;
- `toggleTaskPreference(TASK_PREF_KEYS.hideDone, true)` stores `false` and
  returns `false`.

Run before OTA:

```bash
node --check mobile/src/screens/Tasks/taskPreferences.js
node --check mobile/src/screens/Tasks/TaskEditorScreen.js
cd mobile && npm test
```

Post-release smoke after OTA:

```bash
POST_RELEASE_API_BASE_URL=https://ister-app.ru/snippets-api \
POST_RELEASE_REGISTER_USER=1 \
POST_RELEASE_DESKTOP_TAG=f-20260524-1 \
POST_RELEASE_MOBILE_VERSION=1.0.16 \
bash tests/post_release/run.sh -q
```
