# Snippet Key Cloud Spec

## Requirement

Add automatic snippet keys derived from snippet names. A name like
`bash_cd_guide` yields keys `bash`, `cd`, and `guide`.

The Snippets module must show:

- a separate `Key Cloud` modal with all keys across snippets;
- circle-like key bubbles whose size reflects how many snippets contain the key;
- a `Related` detail tab for the selected snippet;
- related snippets sorted by most shared keys, then alphabetically;
- stable automatic key colors.

## Approved Design

Use the selected D layout for the first release, then upgrade the cloud layout
to the selected C visual treatment:

- Add a `Key Cloud` button in the Snippets header, next to search/add.
- Open the cloud in a separate modal.
- Arrange bubbles as an organic packed cloud: larger keys are placed near the
  center, smaller keys are pushed outward, and empty space between bubbles is
  minimized. Bubbles must not visually overlap; the packing algorithm should
  reject colliding positions instead of relying only on fixed-iteration
  relaxation. Dense clouds with hundreds of keys should use spatial indexing
  and bounded candidate generation so the modal opens interactively.
- Provide a layout algorithm setting in the Key Cloud modal. `Dense` is the
  default and uses a slower tangent/ring placement that keeps bubbles touching
  with no visible gaps. `Fast` remains available for very large clouds where
  lower build time is more important than maximum packing density.
- Bubble diameter must make count differences obvious. Keep a readable minimum
  size for one-snippet keys and scale larger keys clearly above it.
- The cloud supports mouse-wheel zoom, drag-to-pan, explicit zoom in/out
  buttons, and `Fit`.
- Bubble text size adapts to bubble diameter and key length. If text is still
  truncated, hover shows a tooltip with the full key and snippet count.
- The cloud layout is cached persistently in the frontend. Opening the modal
  should use a valid cached layout immediately. If no valid cache is available,
  the modal opens immediately with a progress bar while the dense layout is
  calculated in small background chunks. Cache entries are tied to both the
  snippet fingerprint and the selected layout algorithm.
- Cache invalidation is based on a fingerprint of snippet ids, names, and
  update timestamps. Editing, creating, or deleting snippets marks the cache
  stale; the next background pass rebuilds only the derived key index
  incrementally where possible and then refreshes the layout cache.
- Clicking a key bubble closes the modal, writes the key into the Snippets
  search field, clears any selected manual tag, and runs search immediately.
- Add a `Related` tab in the selected snippet detail view when related snippets
  exist.
- Keep manual snippet tags and automatic keys visually separate.

## Data Model

No database or server changes for this iteration.

Keys are derived on the frontend from `shortcut.name` every time snippets are
loaded. This keeps the feature eligible for a frontend-only release.

Rules:

- split `name` by `_`;
- trim each part;
- lowercase keys;
- ignore empty parts and parts containing whitespace;
- de-duplicate keys within one snippet.

Color is deterministic from the key text using a fixed expanded palette. No
color table is stored; the same key text maps to the same color as long as the
palette and hash function stay unchanged.

## Related Tab

For the selected snippet:

- compute its keys;
- compare against all loaded snippets, not only the current filtered list;
- exclude the selected snippet itself;
- include snippets with at least one shared key;
- show snippet name in the left column;
- show shared keys in the right column as colored pills;
- sort by shared-key count descending, then snippet name ascending.

## Release Scope

Frontend-only desktop change. Do not add Tauri commands, migrations, API fields,
or server changes.
