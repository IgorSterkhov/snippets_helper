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

**Used in:** Exec tab (command cards, already implemented), Tasks tab (checkbox rows, this plan)

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

**Z-index:** ghost at 10000, placeholder inherits normal flow.

---

## §3 Frontend testing

**Before committing any frontend change**, run these checks. All three must pass.

### 3a. `node --check` — syntax validation

Catches syntax errors (missing brackets, stray commas, etc.) instantly without executing code.

```bash
node --check path/to/file.js && echo "OK"
```

Run on every changed JS file. No runtime required, no imports resolved — pure parse check.

### 3b. Duplicate export detection

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

### 3c. `dev-test.py` — integration test suite

Runs the app through a headless browser mock (Chromium via CDP) with mocked Tauri backend. Covers tab loading, modal interactions, and core user flows.

```bash
cd desktop-rust/src && python3 dev-test.py
# Expected: === N/N passed ===
```

If any test fails — debug before committing. The test uses `desktop-rust/src/dev-mock.js` which registers all Tauri command stubs; new commands need a corresponding mock entry there.
