# Tasks UX Improvements — Design Spec

**Date:** 2026-04-28
**Status:** approved (rev 2)
**Scope:** `desktop-rust/src/tabs/tasks/` (4 files) + new `FRONTEND_PATTERNS.md`

---

## 1. Font-size Settings UI

**Current state:** CSS variable `--task-cb-font-size` exists, loaded from `get_setting('tasks_checkbox_font_size')`. No user-facing UI to change it.

**Change:** Add a gear button (⚙) in `.tasks-header` next to the help button. Opens a modal "Tasks — display settings" with:

- Slider "Checkbox font size" — range 10–20px, default 13px. Changes apply immediately via `--task-cb-font-size` on `document.documentElement`
- Existing setting `tasks_card_max_checkboxes` (3–20, default 10) — also included here
- On Confirm: persist both via `set_setting`, show toast "Saved". On failure: show toast with error.
- On Cancel: revert to initial values (capture current values on modal open, re-apply on close)

**Pattern extracted to `FRONTEND_PATTERNS.md` §1 — "CSS-variable-driven font-size setting":**
1. Define CSS variable on a root/container element (e.g. `--task-cb-font-size: 13px`)
2. Reference it in component styles (`font-size: var(--task-cb-font-size, 13px)`)
3. Load persisted value on init via `get_setting` → `element.style.setProperty(...)`
4. Provide a range slider (10–20px) in a settings modal
5. Apply live on slider input; persist on Confirm; revert on Cancel

---

## 2. Tab / Shift+Tab Focus Preservation

**Current behavior:** `keydown` handler in `card.js:274` calls `nestUnderPrev` or `outdent`, which call `ctx.onTaskReload` → full `renderTaskList()`. The DOM is destroyed and rebuilt, so focus is lost.

**Fix:**
1. Before operation: `await commit()` (already called at card.js:305/308 — ensures edited text is saved to DB before the nest/outdent operation)
2. Save `const savedId = node.id`
3. Execute nest/outdent (which triggers reload → full re-render)
4. After reload, in a `setTimeout(30)`: find `[data-cb-id="${savedId}"] .tcb-text[contenteditable]`, focus it, restore caret to end. Same pattern already used for Enter key (card.js:287–299).

---

## 3. Delete — Focus Moves Up

**Current behavior:** Backspace on empty text deletes the checkbox, reloads list, focus lost.

**Fix — focus target selection (in priority order):**
1. Previous sibling in visual DOM order (same parent, sort_order - 1)
2. Parent checkbox (node.parent_id) — if no previous sibling
3. Next sibling — if no parent and no previous sibling (edge case: first root item)
4. "+ Add item…" button — if no other target exists (edge case: only item in list)
5. Execute delete → reload
6. After reload: focus `[data-cb-id="${fallbackId}"] .tcb-text` (or `[data-cb-id="${fallbackId}"]` for non-text fallback), caret at end

---

## 4. Card Overlap Fix

**Symptom:** Large task cards (many checkboxes / expanded editor) can visually overlap adjacent cards.

**Root cause analysis:**
- `.task-card` has `overflow: hidden` — correct, prevents content bleed
- `.task-card-body` has `max-height` + `overflow-y: auto` — collapsed cards scroll internally
- In 2-col grid mode, grid items may not stretch correctly if card content is taller than grid row

**Fix:**
1. Add `min-height: 0` to `.task-card` (CSS grid safety — prevents grid from sizing cards by their content minimum)
2. Ensure `.task-card.expanded` has `height: auto` and no max constraints
3. Verify `.tasks-cards-scroll.two-col` uses `align-items: start` (already present — css.js line 138)
4. Add `contain: layout style` to `.task-card` to prevent paint overlap during transitions
   - **Testing note:** verify open dropdown menus and expanded cards in 2-column mode are not clipped by the new contain property

---

## 5. DnD — Slot Placeholder + FLIP + Relaxed Drop Zone

**Scope:** Applies to **checkbox DnD only** (`kind='checkbox'`). Card DnD (`kind='card'`) keeps the existing insertion-line model — it already handles dropdown-drop for category/status change and works well for card reordering.

### 5a. Slot placeholder instead of insertion line
- On drag start: clone source → floating ghost; hide source (`display:none`); insert a **placeholder div** of source's height (dashed border, `--accent` color) at source's DOM position
- During drag: move placeholder between peers based on cursor Y vs each peer's vertical midline
- On drop: source replaces placeholder position; derive new order from DOM

### 5b. FLIP animations
- Before moving placeholder: capture `getBoundingClientRect().top` for all tracked elements (peers + placeholder)
- Move placeholder to new DOM position
- For each moved element: compute delta = oldTop − newTop; set `transform: translateY(delta)` with `transition: none`; force reflow; then `transition: transform 180ms ease; transform: ''`
- Cleanup: remove transforms after transition ends

### 5c. Relaxed drop zone
- Any cursor position inside the checkbox list container (`.task-card-body` / `.task-editor-cb-area`) counts as reorder zone
- Cursor in upper half of a peer row → placeholder goes above; lower half → below
- Gaps between rows and empty space at the end work

### 5d. Nesting via horizontal offset (preserved from current DnD)
- After the placeholder is positioned, on drop: measure `deltaX = e.clientX - active.startX`
- If `deltaX > 30px` and a row exists above the drop position → nest the dragged item under that row (set `parent_id = prevRow.id`)
- Depth validation: if `depth(prevRow) + 1 > 3`, show toast "Max nesting depth is 3", revert to flat position (same parent as the row above)
- If `deltaX <= 30px` → inherit parent from the row visually above (standard sibling reorder)

### 5e. Updated DnD callback surface
The existing `installTaskDnd` callbacks remain unchanged for card DnD (`onTaskReorderCommit`, `onTaskMetaChange`). For checkbox DnD, the existing `onCheckboxReorderCommit(taskId, draggedId, orderedIds, nestUnder)` callback is reused as-is — the new DnD derives the same parameters from the placeholder position instead of the insertion line.

### 5f. CSS additions
```css
.task-dnd-placeholder {
  border: 2px dashed var(--accent);
  border-radius: 4px;
  opacity: 0.5;
  pointer-events: none;
  flex-shrink: 0;
}
```

**Pattern extracted to `FRONTEND_PATTERNS.md` §2 — "Pointer-based DnD with slot placeholder + FLIP":**
1. Use pointer events (not HTML5 DnD) for Tauri WebView2 compat
2. On drag: ghost follows cursor; source hidden; real placeholder holds the slot
3. Drop zone: entire list container bounding box, cursor-Y vs peer midline
4. FLIP: capture old positions → DOM reorder → inverse transform → animate to identity (180ms ease)
5. On drop: derive order from DOM, pass to backend

---

## 6. Checkbox Collapse (Variant C — Pills + Indent)

### 6a. Visual design
- Collapsed parent: subtle background pill (`rgba(56,139,253,0.08)`), rounded 4px
- Arrow `▶` (collapsed) / `▼` (expanded) — sits left of checkbox, clickable
- Counter badge: `3/10` in a pill (`background: var(--bg-tertiary); border-radius: 8px; padding: 1px 7px; font-size: 11px`)
  - Numerator = checked descendants (recursive, all levels)
  - Denominator = total descendants (recursive, all levels, regardless of their own collapse state)
- Children: simple indent (existing `.depth-1/2/3`), no guide lines
- Transition: children fade + slide up over 150ms on collapse

### 6b. Interaction
- Click arrow → toggle collapse for that node only
- Ctrl+Click on checkbox text → recursive collapse/expand all descendants
- Collapse state: stored in-memory only (Map of `cbId → boolean`), not persisted. Reset when `init()` is called on tab re-entry.

### 6c. Edge cases
- **Add item under collapsed parent:** "+ Add item…" always adds at root level (parent_id=null). Adding inside a collapsed parent would be invisible, which is confusing. Users can drag items into the collapsed subtree after expanding.
- **Tab to nest under collapsed parent:** If the previous sibling (the nest target) is collapsed, nesting under it still occurs (parent_id = collapsedNode.id). The parent is NOT auto-expanded — the user will see the item disappear into the collapsed subtree. This is consistent with how file-tree DnD works.
- **Drag onto collapsed parent:** Dropping above/below a collapsed parent's row places the dragged item as a sibling (above/below the collapsed block). To nest inside a collapsed parent, the user must first expand it. This avoids accidentally burying items.
- **Delete of collapsed parent:** All children are deleted (existing cascade behavior in DB). Counter badge disappears with the parent.

### 6d. Data model
- `collapsedNodes: Map<number, boolean>` — module-level in `card.js`, reset in `init()`
- `isCollapsed(id): boolean` — check Map (default false = expanded)
- `toggleCollapse(id): void` — flip Map entry
- `collapseRecursive(id, collapsed, items): void` — for Ctrl+Click, walk subtree via parent_id

### 6e. Rendering
- `renderNode()` in `card.js:193` already recurses children. Add: if `isCollapsed(node.id)`, skip children rendering and show counter badge.
- Counter: compute `checkedCount` / `totalCount` by walking the flat `items` array filtered by ancestor chain containing `node.id` (or by walking the tree built from `byId`).

---

## 7. FRONTEND_PATTERNS.md

New file at repo root. Contents:

- **§1:** CSS-variable-driven font-size setting — used in Exec (cmd/group name size) and Tasks (checkbox font size)
- **§2:** Pointer-based DnD with slot placeholder + FLIP — used in Exec (command card DnD) and Tasks (checkbox DnD)

Reference from `CLAUDE.md`: add `16. UI-паттерны документированы в FRONTEND_PATTERNS.md. При добавлении нового UI-поведения (настройки шрифта, DnD, анимации) — обновить соответствующие секции.`

---

## Files Changed

| File | Changes |
|------|---------|
| `tabs/tasks/index.js` | Gear button + settings modal |
| `tabs/tasks/card.js` | Focus preservation (Tab/Shift+Tab/Delete); collapse rendering + toggle logic; collapse state Map |
| `tabs/tasks/dnd.js` | Slot placeholder + FLIP + relaxed drop zone for checkbox kind; preserve nesting via horizontal offset |
| `tabs/tasks/tasks-css.js` | Placeholder CSS; collapse styles (pill, arrow, counter, transition); card overlap fixes |
| `FRONTEND_PATTERNS.md` | New file — 2 documented patterns |
| `CLAUDE.md` | Add §16 referencing FRONTEND_PATTERNS.md |

**Removed from scope:** `editor.js` — collapse state is module-level in `card.js`, accessible to `renderCheckboxes()` without changes to editor.

**Out of scope:** Backend changes (all features use existing Tauri commands). No DB migration needed.
