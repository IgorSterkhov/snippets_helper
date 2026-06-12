# Frontend Patterns

Reusable UI patterns used across the Snippets Helper desktop app.
When adding similar UI behaviour, consult this file first and update
the relevant section after implementation.

---

## §1 CSS-variable-driven font-size setting

**Used in:** Exec tab (command/group name size), Tasks tab (checkbox font size)

**Pattern:**
1. Define a CSS custom property on a root/container element, with a sensible default:
   ```css
   .my-tab { --my-element-size: 13px; }
   .my-element { font-size: var(--my-element-size, 13px); }
   ```
2. On tab init, load the persisted value from the backend and apply it:
   ```js
   const v = await call('get_setting', { key: 'my_key' });
   if (v) root.style.setProperty('--my-element-size', v + 'px');
   ```
3. Provide a gear button (⚙) in the tab header that opens a settings modal.
4. Modal contains a range slider (10–20 px) with live preview:
   ```js
   slider.addEventListener('input', () => {
     root.style.setProperty('--my-element-size', slider.value + 'px');
   });
   ```
5. On Confirm: persist via `call('set_setting', { key, value: String(n) })`,
   show success toast. On failure: show error toast.
6. On Cancel: revert CSS variable to the value captured before the modal opened.

**Storage key convention:** dot-separated: `tab_name.element_name_font_size`
(e.g. `exec.cmd_name_font_size`, `tasks.checkbox_font_size`).

---

## §2 Pointer-based DnD with slot placeholder + FLIP

**Used in:** Exec tab (command cards, already implemented), Tasks tab (checkbox rows, pinned chips), Snippets tag and pinned chips, Notes pinned chips

**Pattern:**
1. Use Pointer Events API, NOT HTML5 Drag and Drop (broken in Tauri WebView2).
2. On `pointerdown` on a grip handle:
   - Clone the source element into a floating **ghost** (`position: fixed`, follows cursor).
   - Hide the source (`display: none`).
   - Insert a **placeholder** `<div>` of the source's exact height at the source's
     DOM position. Style: dashed border in `--accent` color, `pointer-events: none`.
3. On `pointermove`:
   - Float the ghost under the cursor.
   - **Relaxed drop zone:** any pixel inside the list container's bounding box
     (`getBoundingClientRect()`) counts as a valid reorder target. Not limited to
     exact card/row boundaries.
   - Determine placeholder position: iterate peers, compare cursor Y vs each peer's
     vertical midline. Cursor above midline → placeholder before that peer.
     Cursor below all midlines → placeholder at end.
4. **FLIP animation** when moving the placeholder:
   - **F**irst: capture `getBoundingClientRect().top` for all tracked elements
     (placeholder + every visible peer).
   - **L**ast: `list.insertBefore(placeholder, newPosition)`.
   - **I**nvert: for each moved element, set `transform: translateY(oldTop - newTop)`
     with `transition: none`, then force a reflow (`void el.offsetHeight`).
   - **P**lay: `transition: transform 180ms ease; transform: ''`.
5. On `pointerup`:
   - Derive the new ID order from the final DOM state.
   - Call the backend with `orderedIds`.
   - Cleanup: remove ghost, remove placeholder, restore source visibility,
     clear all FLIP transforms.

If a list can hide rows while keeping them in storage, do not rebuild the
persisted hierarchy from visible `orderedIds` alone. Carry the visible
previous/next drop context into the commit step, choose the parent from the
visible slot (prefer the next visible row when dropping before it), and
renormalize the full sibling bucket including hidden rows. Hidden rows should
preserve relative order, but must not become implicit drop targets or parents.

**Z-index:** ghost at 10000, placeholder inherits normal flow.

**Wrapped flex chips:** for chip strips using `flex-wrap`, use a same-size
slot placeholder and compute the target in two dimensions:

- group peer rects into visual rows by `top` within a small tolerance;
- select the first row whose bottom is below the pointer Y;
- within that row, insert before the first chip whose horizontal midpoint is
  to the right of the pointer X;
- when dropping after the row's last chip, insert before the next row's first
  DOM peer or append at the end;
- animate both X and Y deltas in the FLIP step with
  `transform: translate(dx, dy)`.

For simple wrapped chip strips outside Tasks, prefer
`desktop-rust/src/components/wrapped-chip-dnd.js` so click suppression,
same-size placeholders, two-dimensional target calculation, and FLIP cleanup
stay consistent across tabs.

### Nested tree rows

**Used in:** Notes folder tree

For nested tree drag-and-drop, use the same Pointer Events foundation, with a
tree-specific drop model:

- Start dragging only from a fixed grip zone, so normal row clicks remain
  selection actions.
- Render the tree as flat visible rows with `data-id`, `data-parent-id`, and
  `data-depth`.
- Keep row height stable: reserve fixed zones for grip, disclosure arrow, icon,
  label, optional metadata, and actions. Reveal actions with
  `opacity`/`pointer-events`, not layout-changing `display: none`.
- Split the target row vertically into `before`, `inside`, and `after` zones.
  `inside` highlights the target row; `before`/`after` use an insertion line.
- For `after` on an expanded node, place the line after the whole visible
  branch. Convert that visual slot to the next visible sibling's id, not to a
  descendant id.
- Backend commit must be atomic and validate cycles. The UI may prevent obvious
  invalid drops, but the backend remains the source of truth.

### Resizable split panes

**Used in:** Notes folder tree

For split panes that users can resize, keep the behavior local and predictable:

- Store the width in an existing app setting with a dotted per-feature key
  such as `notes.folder_tree_width`.
- Keep the current visual width as the default so adding resize does not shift
  the layout for existing users.
- Normalize persisted values before applying them: parse as integer, reject
  empty/NaN/non-finite values, clamp to the supported min/max range, and fall
  back to the default for invalid values.
- Apply width through a CSS custom property on the tab root/container rather
  than rewriting multiple inline styles.
- Use a narrow Pointer Events divider with `col-resize`; update width live on
  `pointermove`, persist only on drag end, and clean up document listeners,
  cursor overrides, and selection locks on both `pointerup` and
  `pointercancel`.

---

## §3 Sidebar module groups

**Used in:** Main sidebar DEV group

When grouping main sidebar modules:

- Keep every real module as a normal tab with its own panel id and
  `TabContainer.buttons[tabId]` entry. Grouping is a rendering concern, not a
  replacement for tab identity.
- Do not give group buttons `.tab-btn.active`; existing code and tests use
  `.tab-btn.active` as the active real module. Use separate classes such as
  `.expanded` and `.has-active-child`.
- Put group expand/collapse in `TabContainer.activate()` so direct clicks,
  restored last tab, Ctrl+Tab, AI navigation, and other programmatic activation
  all produce the same sidebar state.
- A manually expanded group may stay open while no other module is activated,
  but switching to any non-group child should collapse it.
- Hidden child buttons should not be mouse or keyboard targets while collapsed:
  use `pointer-events: none`, `aria-hidden`, and `tabIndex = -1`.
- Keep child buttons in the DOM with their usual `data-tab-id` selectors so
  tests, Ctrl+Tab, and command-driven navigation can still activate them.

---

## §4 Frontend testing

**Before committing any frontend change**, run these checks. All three must pass.

### 4a. `node --check` — syntax validation

Catches syntax errors (missing brackets, stray commas, etc.) instantly without executing code.

```bash
node --check path/to/file.js && echo "OK"
```

Run on every changed JS file. No runtime required, no imports resolved — pure parse check.

### 4b. Duplicate export detection

ES modules reject duplicate exports of the same name, but `node --check` does NOT catch this (it only parses). The symptom: tab loader catches the error and shows "Failed to load tab", which masks the real cause.

**Check:** after adding a new `export function` or `export const`, verify no other export of that name exists:

```bash
grep -n "export.*\<NAME\>" file.js
```

If both a standalone `export function NAME()` and a list `export { ..., NAME, ... }` exist → remove one. Prefer the list export; keep function declarations plain (no `export` keyword on the declaration).

**Example — wrong (duplicate):**
```js
export function resetCollapseState() { ... }   // line 14
export { loadCheckboxes, isCollapsed, resetCollapseState };  // line 580 — DUPLICATE
```

**Example — correct:**
```js
function resetCollapseState() { ... }           // line 14 — plain function
export { loadCheckboxes, isCollapsed, resetCollapseState };  // line 580 — only export
```

### 4c. `dev-test.py` — integration test suite

Runs the app through a headless browser mock (Chromium via CDP) with mocked Tauri backend. Covers tab loading, modal interactions, and core user flows.

```bash
cd desktop-rust/src && python3 dev-test.py
# Expected: === N/N passed ===
```

If any test fails — debug before committing. The test uses `desktop-rust/src/dev-mock.js` which registers all Tauri command stubs; new commands need a corresponding mock entry there.

### 4d. CI monitoring after release tag

After pushing a release tag (`f-*` or `v*`), the CI workflow triggers automatically. Monitor it and report the result — do NOT assume it succeeded.

```bash
# Find the run for the new tag
gh run list --limit=3 --json status,databaseId,headBranch,conclusion

# Watch it to completion
gh run watch <run_id> --exit-status &

# When done: verify assets on the tag page
curl -sL https://github.com/IgorSterkhov/snippets_helper/releases/download/<TAG>/frontend-version.json
```

For `f-*` releases: 3 assets expected (frontend zip, `frontend-version.json`, `latest.json`). For `v*` releases: 5–7 assets. If CI fails or assets are missing — investigate before reporting success to the user.

---

## §5 Two-column layout — avoid CSS Grid in Tauri WebView2

**Used in:** Tasks tab (two-col card layout)

**Problem:** CSS Grid with `grid-template-columns: 1fr 1fr` causes card overlap in Tauri WebView2. Three root causes were found:

1. **`overflow: hidden` on grid items creates a new Block Formatting Context** — WebView2 miscalculates grid row heights when items have BFCs. **Fix:** use `clip-path: inset(0 round 8px)` instead of `overflow: hidden` + `border-radius`.

2. **Asynchronous content loading (`.then()`)** — cards enter the DOM with placeholder `…` (short), grid calculates row height, then `.then()` fires and card grows, but grid already locked the row height. **Fix:** render synchronously when data is in cache; preload data before DOM insertion.

3. **`min-height: 0` on grid items** — removes the default `min-height: auto` protection, allowing items to shrink below content height. **Fix:** remove `min-height: 0` (use `flex-shrink: 0` for flex context instead).

4. **`gap` in grid can be unreliable in WebView2** — use `margin-bottom` on items as a fallback.

**Recommended approach for two-column layouts in this app:**

- Use two side-by-side flex columns (`.tasks-col`), distribute items to the shorter column by comparing `getBoundingClientRect().height`. This gives tight packing without grid's row-height issues.
- CSS: `display: flex; gap: 10px; align-items: flex-start` on the container, each column is `flex: 1; display: flex; flex-direction: column`.
- JS: after appending each card, append the next one to the column with lower height.
- Preload async data to cache before DOM insertion so cards render synchronously at their final height.

---

## §6 Markdown code block rendering

**Used in:** Snippets tab rendered Code, Description, and Obsidian Note views.

**Pattern:**
1. Before passing user Markdown to `marked(...)`, normalize only fence-marker
   lines so pasted indented fences still render as code blocks:
   ```js
   text.replace(/^[ \t]+(```[^\n\r]*)$/gm, '$1')
   ```
   Do not trim code content inside the fence.
2. After rendering, decorate every `<pre><code>` with a compact header:
   - language label from `code.className` such as `language-bash`;
   - `plain` when no language is present;
   - copy button on the right side of the header.
3. Copy from `code.textContent`, not from the whole `<pre>`, so the header label
   is never copied.
4. Use calm language groups rather than full syntax highlighting. Keep unknown
   languages readable with a neutral/accent dot.

**Verification:** browser smoke tests should cover an indented fenced block,
typed blocks such as `bash` and `sql`, an untyped `plain` block, and copy output.

---

## §7 Focus split view

**Used in:** Tasks tab Focus view

Use this pattern when an existing card/list module needs a focused single-item
editor without removing global filters.

- Keep global filters and pinned/shortcut chips above the split.
- Left pane is a compact index of the currently filtered items.
- Local search filters only the left pane's already-visible items.
- Right pane may render an item outside current filters when opened from a
  global chip; show a banner and an explicit action to adjust filters.
- In compact detail cards, remove inner card-body scrolling; let the right
  pane scroll so there is no blank area under a short capped card.
- Do not mix compact-index rows with card drag-and-drop unless a separate
  reorder design is approved.

---

## §8 Persisted local UI state

**Used in:** Tasks tab checkbox collapse state

Use this pattern for user-visible local UI preferences that should survive
frontend OTA WebView reloads and normal app restarts, but should not sync
between devices.

- Store the state via existing `get_setting` / `set_setting` commands with a
  namespaced key such as `tasks_collapsed_checkbox_ids`.
- Load the setting before the first render that depends on it.
- Persist after each user action that changes the state.
- Store compact JSON values for sets/lists, and tolerate invalid or stale data
  by falling back to defaults.
- Keep per-session transient state in memory only when losing it on OTA reload
  is acceptable.

---

## §9 Derived key chips and clouds

**Used in:** Snippets tab (Key Cloud, Related snippets)

Use this pattern when a module needs lightweight analytics from already-loaded
names or titles and does not need a persisted taxonomy.

- Derive keys in the frontend from the canonical display name.
- Keep the rule explicit and cheap. For Snippets: split by `_`, trim,
  lowercase, ignore empty/whitespace parts, and de-duplicate within one item.
- When a derived cloud layout is expensive, persist the finished layout with a
  schema version, source fingerprint, and selected algorithm. Show stale cached
  layout immediately, rebuild in small chunks, and invalidate the cache when
  either source data or algorithm changes.
- For packed circle clouds, keep a `Dense` algorithm available for visual
  quality and a `Fast` algorithm available for very large datasets. `Dense`
  should prefer tangent placements so each new bubble touches an existing
  bubble and visible gaps stay minimal.
- Use an expanded deterministic color palette for hashed keys. Avoid storing a
  color table unless users need manual color editing.
- Keep a separate unfiltered cache when related/analytics views must consider
  all items, not only the currently filtered list.
- Use deterministic color from key text (`hash(key) -> fixed palette`) instead
  of storing color state unless the user needs editable colors.
- For clouds, use an absolute-positioned packed layout instead of flex-wrap
  when relative frequency matters visually. Sort high-count keys first, keep the
  strongest keys near the center, and provide pan, wheel zoom, zoom buttons,
  and Fit when paths/labels may be too dense.
- Do not rely on a fixed number of physics/relaxation iterations to separate
  bubbles. Use collision-aware placement and keep a smoke test that checks
  rendered bubble rectangles for overlap on a dense cloud.
- Keep dense cloud placement bounded. A spatial hash plus spiral candidate
  generation avoids checking every candidate against every existing bubble and
  keeps hundreds of keys interactive.
- For expensive but deterministic cloud layouts, persist `{schema,
  fingerprint, items, nodes}` in frontend storage. On open, render a valid cache
  immediately; without a valid cache, open the modal first and build the layout
  in small async chunks with a visible progress bar.
- Scale bubble diameter from the raw count with a readable minimum, not only a
  square-root transform, when users need obvious differences between counts.
- Scale key label font by bubble diameter and key length. Also set a full text
  tooltip/title because small bubbles still need to remain compact.
- If key bubbles act as filters, make the action explicit in state: update the
  visible search input, clear incompatible manual filters, and reload the list.
- For related rows, sort by strongest match first, then alphabetically:
  shared-key count descending, name ascending.
- Keep derived keys visually separate from user-managed tags so automatic
  grouping does not look editable or synced.

---

## §10 Local list sort modes

**Used in:** Snippets tab left panel

Use this pattern when a list needs a lightweight local sort preference without
changing backend APIs.

- Keep backend commands responsible for fetching/searching/filtering. Apply the
  sort in the frontend after the current filtered list is loaded.
- Persist only the selected mode with `get_setting` / `set_setting`; do not
  sync view preferences between devices unless explicitly requested.
- Keep the existing default mode unchanged for users who never touch the
  control.
- When switching modes, capture the selected item id before sorting and restore
  the selected index after sorting if the item is still present.
- Use deterministic tie-breakers. For modified-date sorting, sort by
  `updated_at` descending, then fall back to the same name comparator as A-Z.

---

## §11 Persistent error diagnostics

**Used in:** Notes/Snippets image upload modal

Use this pattern when an error is actionable, hard to reproduce, or needs
technical context from the user.

- Use `desktop-rust/src/components/error-dialog.js` instead of a transient
  toast for upload, processing, sync, or preview failures that need reporting.
- Keep the user-facing message short, then put technical context into the
  scrollable details block.
- Include versions, IDs, server/job status, URLs or affected record IDs, failed
  step names, and the original exception text when available.
- Provide a `Copy error` button that copies the full message and details via
  the existing `copy_to_clipboard` command, with browser clipboard fallback.
- Keep success feedback inside the button label so it remains visible while
  the modal is open.

---

## §12 Sandboxed HTML Cards

**Used in:** Notes/Snippets Markdown previews and public share pages

Use this pattern when user content needs to include an interactive single-file
HTML artifact such as a generated presentation.

- Store a portable Markdown token, not raw HTML:
  `![html:Title](https://.../v1/media/html/<token>)`.
- Render only allowlisted API media URLs as HTML Cards. Never convert arbitrary
  `https://`, `data:`, or `blob:` URLs into iframes.
- Always use `<iframe sandbox="allow-scripts">` without `allow-same-origin`.
- The served HTML asset must also send restrictive CSP headers that block
  network fetches, external frames, workers, forms, object/embed content, and
  base URL changes.
- Keep raw HTML typed directly into Markdown escaped. The upload/card token is
  the only supported path for interactive HTML.
- Public share pages need a parent CSP with `frame-src 'self'` so Markdown
  cannot introduce third-party iframes.

---

## §13 External snapshot publishing

**Used in:** Notes/Snippets Telegra.ph publishing

Use this pattern when an item can be exported to a third-party public page:

- Treat external publishing as an explicit snapshot, not a replacement for the
  app's live `/share/<token>` link.
- Keep third-party access tokens server-side only. Desktop receives status,
  URL, path, timestamps, views, and content hash, never credentials.
- Put Publish/Update controls in the existing Share dialog as a separate
  section from live link controls.
- Save and sync the source item before publishing so the API exports current
  content.
- Show publish failures in the shared persistent error dialog with copyable
  diagnostics; do not rely on short-lived toast messages for third-party API
  failures.
- Convert content server-side with a strict allowlist for tags, attributes, and
  URL schemes. Interactive app-only cards should degrade to links.

---

## §14 Native media preview fallback

**Used in:** Notes/Snippets image upload modal, desktop Markdown Figure Cards

Use this pattern for server media URLs under `/snippets-media/`.

- Keep saved Markdown portable: store the public HTTPS media URL, not a
  `data:` URL.
- For desktop display, load snippets-media URLs through
  `get_media_preview_data_url` and set the rendered `<img>` source to the
  returned local `data:` URL.
- In upload preview flows, try the native fallback first for snippets-media
  URLs; do not wait for a potentially stuck WebView remote-image request.
- The native command must validate same-origin `/snippets-media/` URLs against
  the configured sync API origin before downloading, so it cannot be used as a
  generic URL fetcher.

---

## §15 Image upload variant preview

**Used in:** Notes/Snippets Markdown image upload modal

When a modal generates multiple image variants, keep the variant controls and
preview connected:

1. Default to `balanced`, but show a preview header with the current variant
   name and its position, e.g. `Balanced preview · 2 / 4`.
2. Keep preset buttons as direct selection controls.
3. Add compact previous/next buttons inside the preview header and support
   `ArrowLeft` / `ArrowRight` while the modal is open.
4. Navigate only among variants whose previews are loaded successfully.
5. Keep full-size preview on image click, using the same loaded preview source
   as the modal.

---

## §16 Contenteditable list boundary navigation

**Used in:** Tasks checkbox text rows

Use this pattern when a wrapped `contenteditable` list item should keep native
text editing inside the item but move focus between visible rows at hard text
boundaries.

- Let the browser handle ArrowUp/ArrowDown unless the selection is collapsed
  and the caret is at the absolute start or end of the text content.
- Determine the caret offset with a cloned `Range` over the current editable
  element; do not infer it from click position or stored text alone.
- Derive previous/next targets from the currently rendered row DOM in the same
  container. Hidden completed items, collapsed descendants, and filtered-out
  rows must not become keyboard focus targets.
- Call `preventDefault()` only when focus actually moves to a neighbor row.
  Boundary keys on the first or last visible row should remain no-ops.
- Place the caret explicitly after focusing the target row so WebView2 does not
  leave the selection on the old contenteditable element.

---

## §17 Ctrl+Tab recent view history

**Used in:** Main desktop shell, Snippets, Tasks, Notes

Use this pattern when a module has object-level views that should participate
in global `Ctrl+Tab` switching.

1. Install one shell-level controller with
   `installViewHistory({ tabContainer, tabs })`.
2. Modules publish the currently opened object through:
   ```js
   window.dispatchEvent(new CustomEvent('view-history:record', {
     detail: {
       key: `task:${task.uuid || task.id}`,
       moduleId: 'tasks',
       objectType: 'task',
       objectId: task.id,
       objectUuid: task.uuid || null,
       title: task.title || '(untitled)',
       label: 'Tasks',
       icon: '✅',
       detail: {},
     },
   }));
   ```
3. The shell dedupes by `key`, keeps an in-memory MRU list, and handles the
   global shortcut:
   - first `Ctrl+Tab` jumps immediately to the previous recent view;
   - repeated `Ctrl+Tab` in the same sequence shows the switcher overlay and
     cycles through the frozen snapshot;
   - `Ctrl+Shift+Tab` cycles backward.
4. Modules restore object views by listening for `view-history:open` and
   checking `event.detail.moduleId` before acting.
5. Do not record synthetic module entries for modules that have object-level
   records unless there is no meaningful object to restore; otherwise the MRU
   list gets polluted with same-tab placeholders.
6. The controller must ignore active `.modal-overlay` dialogs for the entire
   shortcut flow, not only for overlay rendering.

---

## §18 Tree-table row keyboard editing

**Used in:** Finance expense rows

Use this pattern when a nested tree table should edit like an outliner while
still using normal `<input>` fields for structured columns.

- Scope the outliner shortcuts to the primary text/name input only. Numeric,
  date, select, and note fields should keep normal form behavior unless the
  feature explicitly needs spreadsheet navigation.
- `Enter` creates a new sibling row with the same parent and places it directly
  after the current row among that parent's children.
- `Tab` nests the current row under the previous sibling when valid.
- `Shift+Tab` moves the row one level up, placing it after the former parent.
- `ArrowUp` / `ArrowDown` move focus between visible rendered rows only when
  `selectionStart`/`selectionEnd` are both at the absolute start or end of the
  input value.
- Save or validate the current row before structural commands. If validation
  fails, do not create or move rows.
- Reuse existing backend move commands where possible. Avoid adding a new IPC
  command just to express "create after" if the same result can be achieved by
  create plus existing atomic move/reorder logic.

---

## §19 Level-based tree row banding

**Used in:** Finance expense rows

Use this pattern when every tree row is the same underlying entity, but parent
rows should read like report subtotals.

- Derive subtotal typography from stored child count, including collapsed
  children. This keeps chevrons, parent totals, and subtotal emphasis stable.
- Derive background bands from visible hierarchy depth only, so sibling rows at
  the same depth look consistent whether they are terminal rows or subtotal
  rows.
- Treat depth as a zero-based visible index. If `maxVisibleDepthIndex` is `0`,
  apply no band. If it is `1`, band only depth `0`. If it is `2`, band depths
  `0` and `1`.
- Keep the deepest visible level neutral by default; this makes detail rows
  quieter and prevents every row from being tinted in shallow trees.
- For configurable colors, validate stored values as `#RRGGBB` and mix them
  with the app background in CSS (`color-mix(..., var(--bg))`) so user-selected
  opaque colors remain readable in dark mode.

---

## §20 Markdown Figure Image Viewer

**Used in:** Snippets and Notes Markdown previews

When Markdown images are rendered as Figure Cards:

- Build the viewer behavior in the shared Markdown figure enhancer, not in
  individual tabs, so Snippets and Notes stay consistent.
- Keep the saved media URL as the image identity/caption source, but display
  the native data-url preview fallback when remote media is blocked by WebView.
- Make both the image and a small overlay zoom button open the same viewer.
- Default to a fit-to-viewport mode, with an `Actual size` toggle for inspecting
  the optimized saved file at its natural dimensions.
- Use a transform-based viewport instead of scrollbars when interactive
  inspection is needed: `Ctrl + wheel` should zoom around the cursor, drag
  should pan the image, and Fit/Actual controls should reset both zoom and pan
  to predictable states.
- Use a normal modal overlay with Escape and backdrop close; the viewer body
  should keep overflow hidden and expose large images through pan/zoom instead
  of nested scrollbars.
