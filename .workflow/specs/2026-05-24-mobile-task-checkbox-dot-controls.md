# Mobile Task Checkbox Dot Controls — Requirement Spec

## Status

Approved by user on 2026-05-24.

## Goal

Improve mobile task checkbox hierarchy controls after OTA `1.0.12`.

This phase keeps the existing tree rendering and adds:

- a fixed left-edge dot handle for tree actions;
- collapse/expand of descendants;
- long-press action menu;
- delete via icon/action instead of the text `Del`;
- global mobile Tasks options for hiding completed checkboxes and wrapping
  checkbox text.

## Scope Split

### Phase 1, this spec

Ship as a mobile OTA if only JS/mobile files change.

In scope:

- Dot handle on the left edge of each checkbox row.
- Dot handles align on one vertical rail regardless of checkbox depth.
- Tap dot on a row with descendants collapses/expands that row's subtree.
- Long-press dot opens an action menu.
- Delete subtree is available from the action menu.
- Replace the visible `Del` text button with a trash icon/action.
- Add mobile Tasks settings:
  - hide completed checkboxes;
  - wrap checkbox text.
- Persist those settings locally on the mobile device.
- Preserve existing sync behavior and `parent_uuid` relationships.

### Phase 2, separate later spec/plan

Out of scope now:

- Drag-and-drop by dot handle.
- Reorder mode.
- Floating arrows `up/down/left/right/OK`.
- Changing `parent_uuid` or `sort_order` from mobile.
- Adding child checkbox from mobile action menu.

## Interaction Requirements

### Dot Handle

Each checkbox row has a touch target at the left edge of the checkbox block.
The visible element can be a dot. All dots are aligned on the same vertical
line. Checkbox depth is shown by indenting the content after the dot, not by
moving the dot itself.

Behavior:

- tap on a row with visible descendants: toggle collapsed/expanded;
- tap on a leaf row: no destructive action;
- long press: open action menu for the row.

Rows with children should be visually distinguishable from leaf rows. Collapsed
rows should also be visually distinguishable and show that descendants are
hidden.

### Collapse/Expand

Collapsed state is screen-local for this phase. It does not need to sync.

When a parent is collapsed:

- descendants are hidden;
- the parent row remains visible;
- a small count of hidden descendants may be shown.

Collapse/expand must work together with hide completed.

### Action Menu

Long press on the dot opens a simple menu.

Phase 1 menu items:

- `Expand` or `Collapse`, only when the row has descendants;
- `Delete`, destructive, marks the row and descendants deleted using existing
  subtree deletion behavior;
- `Cancel`.

The visible row should no longer show a text `Del` button. A trash icon can be
used inside the action menu or as a compact row action, but the primary visible
right-side text `Del` must be removed.

### Hide Completed

Add a mobile Tasks setting for hiding completed checkboxes.

Behavior:

- unchecked rows remain visible;
- checked leaf rows are hidden;
- checked parent rows remain visible if they have visible unchecked
  descendants, so the hierarchy does not lose context;
- a checked parent with no visible descendants is hidden.

This is a local mobile display setting and must not mutate task data.

### Wrap Text

Add a mobile Tasks setting for checkbox text wrapping.

Behavior:

- enabled: checkbox text can wrap to multiple lines;
- disabled: checkbox text remains one line with horizontal clipping/ellipsis
  behavior where React Native permits it.

This setting applies to the task editor checkbox text inputs.

## Persistence

Use local mobile storage for these preferences.

Recommended keys:

- `tasks.hide_completed_checkboxes`
- `tasks.wrap_checkbox_text`

Default values:

- hide completed: `false`;
- wrap text: `true`.

## Testing

Add unit coverage for the tree helper behavior:

- collapsed parent hides descendants and reports hidden count;
- hide completed hides checked leaves;
- hide completed keeps a checked parent if it has unchecked descendants.

Run before release:

```bash
cd mobile && npm test -- --runTestsByPath __tests__/db/taskRepo.test.js
```

```bash
cd mobile && npm test -- --runInBand
```

Post-release smoke after OTA:

```bash
POST_RELEASE_API_BASE_URL=https://ister-app.ru/snippets-api \
POST_RELEASE_REGISTER_USER=1 \
POST_RELEASE_DESKTOP_TAG=v1.3.29 \
POST_RELEASE_MOBILE_VERSION=1.0.13 \
bash tests/post_release/run.sh -q
```

