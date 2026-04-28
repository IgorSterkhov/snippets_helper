# Tasks UX Improvements — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve Tasks tab UX across 6 areas: font-size settings, focus management, card overlap, DnD slot+FLIP, and checkbox collapse.

**Architecture:** All changes are frontend-only (`desktop-rust/src/tabs/tasks/`). No backend/DB changes. DnD and font-size patterns are extracted to a new `FRONTEND_PATTERNS.md` for project-wide reuse, referenced from CLAUDE.md §16.

**Tech Stack:** Vanilla JS (Tauri WebView2), CSS variables, Pointer Events API, FLIP animations

**Spec:** `.workflow/specs/2026-04-28-tasks-ux-improvements-design.md`

---

## File Structure

| File | Role | Change Type |
|------|------|-------------|
| `desktop-rust/src/tabs/tasks/index.js` | Tab shell, layout, state, settings modal | Modify (~60 lines added) |
| `desktop-rust/src/tabs/tasks/card.js` | Card rendering, checkbox rendering, collapse logic | Modify (~120 lines added/changed) |
| `desktop-rust/src/tabs/tasks/dnd.js` | Pointer-based DnD for cards + checkboxes | Modify (~80 lines changed) |
| `desktop-rust/src/tabs/tasks/tasks-css.js` | Scoped CSS template | Modify (~40 lines added) |
| `FRONTEND_PATTERNS.md` | Project-wide UI pattern documentation | Create |
| `CLAUDE.md` | Add §16 referencing FRONTEND_PATTERNS.md | Modify (2 lines) |

---

## Chunk 1: FRONTEND_PATTERNS.md + CLAUDE.md

### Task 1.1: Create FRONTEND_PATTERNS.md

**Files:**
- Create: `FRONTEND_PATTERNS.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Create FRONTEND_PATTERNS.md with §1 (Font-size settings)**

Write:

```markdown
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
```

- [ ] **Step 2: Add §16 to CLAUDE.md**

Append after the last rule (after §15 text):

```markdown
16. **UI-паттерны документированы в `FRONTEND_PATTERNS.md`.** При добавлении
    нового UI-поведения (настройки шрифта через CSS-переменные, DnD с
    плейсхолдером и FLIP-анимациями, и т.п.) — обновить соответствующие
    секции в `FRONTEND_PATTERNS.md`, чтобы паттерн был доступен для всех
    вкладок проекта.
```

- [ ] **Step 3: Commit**

```bash
git add FRONTEND_PATTERNS.md CLAUDE.md
git commit -m "docs: FRONTEND_PATTERNS.md + CLAUDE.md §16 — font-size + DnD patterns"
```

---

## Chunk 2: Font-size Settings UI

### Task 2.1: Add gear button to tasks header

**Files:**
- Modify: `desktop-rust/src/tabs/tasks/index.js` — `buildLayout()` function (~lines 90–141)

- [ ] **Step 1: Add gear button next to help button in `buildLayout`**

At line 96 (after `header.appendChild(helpButton(...))`), add:

```js
// Settings gear button
const gearBtn = document.createElement('button');
gearBtn.className = 'task-icon-btn';
gearBtn.title = 'Display settings';
gearBtn.textContent = '⚙';
gearBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  openTasksSettings();
});
header.appendChild(gearBtn);
```

- [ ] **Step 2: Write `openTasksSettings()` function**

Add after `onToggleLayout()` (after line 346):

```js
async function openTasksSettings() {
  // Read current values
  const root = document.documentElement;
  const currentCbFont = parseInt(
    getComputedStyle(root).getPropertyValue('--task-cb-font-size')
  ) || 13;

  let currentMaxItems = 10;
  try {
    const s = await call('get_setting', { key: 'tasks_card_max_checkboxes' });
    if (s) currentMaxItems = Math.max(3, parseInt(s, 10) || 10);
  } catch { /* default */ }

  const body = document.createElement('div');
  body.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:14px">
      <div>
        <label style="display:flex;justify-content:space-between;align-items:baseline;color:var(--text)">
          <span>Checkbox font size</span>
          <span id="tasks-set-cb-val" style="font-family:'JetBrains Mono',monospace;color:var(--text-muted)">${currentCbFont}px</span>
        </label>
        <input id="tasks-set-cb" type="range" min="10" max="20" value="${currentCbFont}" style="width:100%;margin-top:4px" />
      </div>
      <div>
        <label style="display:flex;justify-content:space-between;align-items:baseline;color:var(--text)">
          <span>Max visible checkboxes (collapsed card)</span>
          <span id="tasks-set-max-val" style="font-family:'JetBrains Mono',monospace;color:var(--text-muted)">${currentMaxItems}</span>
        </label>
        <input id="tasks-set-max" type="range" min="3" max="20" value="${currentMaxItems}" style="width:100%;margin-top:4px" />
      </div>
      <div style="font-size:11px;color:var(--text-muted);font-style:italic">
        Changes apply immediately and persist across sessions.
      </div>
    </div>
  `;

  const cbSlider = body.querySelector('#tasks-set-cb');
  const cbVal = body.querySelector('#tasks-set-cb-val');
  const maxSlider = body.querySelector('#tasks-set-max');
  const maxVal = body.querySelector('#tasks-set-max-val');
  const initialCb = currentCbFont;
  const initialMax = currentMaxItems;

  cbSlider.addEventListener('input', () => {
    cbVal.textContent = cbSlider.value + 'px';
    root.style.setProperty('--task-cb-font-size', cbSlider.value + 'px');
  });
  maxSlider.addEventListener('input', () => {
    maxVal.textContent = maxSlider.value;
    // Live-update max-height on visible collapsed card bodies
    for (const bodyEl of document.querySelectorAll('.task-card-body')) {
      bodyEl.style.maxHeight = (parseInt(maxSlider.value) * 26 + 12) + 'px';
    }
  });

  showModal({
    title: 'Tasks — display settings',
    body,
    onConfirm: async () => {
      const cb = parseInt(cbSlider.value);
      const mx = parseInt(maxSlider.value);
      try {
        await call('set_setting', { key: 'tasks_checkbox_font_size', value: String(cb) });
        await call('set_setting', { key: 'tasks_card_max_checkboxes', value: String(mx) });
        root.style.setProperty('--task-cb-font-size', cb + 'px');
        showToast('Saved', 'success');
      } catch (e) {
        showToast('Failed to save: ' + e, 'error');
      }
    },
    onCancel: () => {
      root.style.setProperty('--task-cb-font-size', initialCb + 'px');
      for (const bodyEl of document.querySelectorAll('.task-card-body')) {
        bodyEl.style.maxHeight = (initialMax * 26 + 12) + 'px';
      }
    },
  });
}
```

The `showModal` import is already at top of `tasks-css.js` via `editor.js`. Verify `showModal` is imported in `index.js` — if not, add `import { showModal } from '../../components/modal.js';` at the top.

- [ ] **Step 3: Verify `showModal` import in index.js**

Read `index.js` line 1-9. If `showModal` is not imported, add:

```js
import { showModal } from '../../components/modal.js';
```

(It may already be transitively available but explicit import is safer.)

- [ ] **Step 4: Commit**

```bash
git add desktop-rust/src/tabs/tasks/index.js
git commit -m "feat: tasks display settings modal — checkbox font size + max visible"
```

---

## Chunk 3: Focus Fixes (Tab/Shift+Tab + Delete)

### Task 3.1: Preserve focus after Tab/Shift+Tab indentation change

**Files:**
- Modify: `desktop-rust/src/tabs/tasks/card.js` — `buildCheckboxRow()` keydown handler (~lines 303–310)

- [ ] **Step 1: Modify Tab handler in keydown listener**

Replace lines 303–310 (the Tab and Shift+Tab branches) with:

```js
} else if (e.key === 'Tab' && !e.shiftKey) {
  e.preventDefault();
  await commit();
  const savedId = node.id;
  await nestUnderPrev(task, node, ctx);
  // nestUnderPrev triggers ctx.onTaskReload → DOM rebuild; restore focus
  setTimeout(() => {
    const el = document.querySelector(`[data-cb-id="${savedId}"] .tcb-text[contenteditable="true"]`);
    if (el) {
      el.focus();
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }, 30);
} else if (e.key === 'Tab' && e.shiftKey) {
  e.preventDefault();
  await commit();
  const savedId = node.id;
  await outdent(task, node, ctx);
  setTimeout(() => {
    const el = document.querySelector(`[data-cb-id="${savedId}"] .tcb-text[contenteditable="true"]`);
    if (el) {
      el.focus();
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }, 30);
}
```

- [ ] **Step 2: Commit**

```bash
git add desktop-rust/src/tabs/tasks/card.js
git commit -m "fix: preserve focus after Tab/Shift+Tab indent change in checkboxes"
```

### Task 3.2: Focus moves up after checkbox delete

**Files:**
- Modify: `desktop-rust/src/tabs/tasks/card.js` — Backspace handler (~lines 311–320)

- [ ] **Step 1: Modify Backspace handler to find and restore fallback focus**

Replace lines 311–320 with:

```js
} else if (e.key === 'Backspace' && readText() === '') {
  e.preventDefault();
  // Find fallback focus target before deletion
  const row = textEl.closest('.tcb-item');
  const container = row ? row.parentElement : null;
  let fallbackId = null;
  if (container) {
    const rows = Array.from(container.querySelectorAll(':scope > .tcb-item'));
    const idx = rows.indexOf(row);
    if (idx > 0) {
      fallbackId = Number(rows[idx - 1].dataset.cbId);
    } else if (node.parent_id != null) {
      fallbackId = node.parent_id;
    } else if (idx < rows.length - 1) {
      fallbackId = Number(rows[idx + 1].dataset.cbId);
    }
  }
  try {
    await call('delete_task_checkbox', { id: node.id });
    invalidateCheckboxCache(task.id);
    ctx.onTaskReload && ctx.onTaskReload();
    // Restore focus after DOM rebuild
    if (fallbackId != null) {
      setTimeout(() => {
        const el = document.querySelector(`[data-cb-id="${fallbackId}"] .tcb-text[contenteditable="true"]`)
                || document.querySelector(`[data-cb-id="${fallbackId}"]`);
        if (el) {
          if (el.contentEditable === 'true') {
            el.focus();
            const range = document.createRange();
            range.selectNodeContents(el);
            range.collapse(false);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
          } else {
            el.scrollIntoView({ block: 'center' });
          }
        }
      }, 30);
    }
  } catch (err) {
    showToast('Delete failed: ' + err, 'error');
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add desktop-rust/src/tabs/tasks/card.js
git commit -m "fix: move focus to previous item after checkbox delete"
```

---

## Chunk 4: Card Overlap Fix

### Task 4.1: Fix CSS to prevent card overlap

**Files:**
- Modify: `desktop-rust/src/tabs/tasks/tasks-css.js` — `.task-card` rule (~lines 147–158)

- [ ] **Step 1: Add CSS fixes to `.task-card`**

Modify the `.task-card` block (lines 147–155) — add `min-height: 0`, `contain: layout style`, and `height: auto`. Keep the existing sub-rules (lines 156–158: `.task-card:hover`, `.task-card.expanded`, `.task-card.dragging`) unchanged.

The resulting block should read:

```css
.task-card {
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
  transition: border-color 0.15s;
  position: relative;
  min-height: 0;            /* CSS grid safety — prevents grid blowout */
  contain: layout style;    /* prevent paint overlap between cards */
  height: auto;             /* let content determine height, no constraints */
}
.task-card:hover { border-color: var(--text-muted); }
.task-card.expanded { border-color: var(--accent); }
.task-card.dragging { opacity: 0.45; }
```

Use Edit to add the three new properties to the existing `.task-card` block (lines 148–154). Do NOT delete the sub-rules at lines 156–158.

- [ ] **Step 2: Verify two-col grid alignment**

Check that `.tasks-cards-scroll.two-col` has `align-items: start` (should be at ~line 138 in tasks-css.js). This is already present — confirm with grep:

```bash
grep "align-items: start" desktop-rust/src/tabs/tasks/tasks-css.js
```

- [ ] **Step 3: Commit**

```bash
git add desktop-rust/src/tabs/tasks/tasks-css.js
git commit -m "fix: prevent task card overlap with min-height:0 + contain:layout"
```

---

## Chunk 5: DnD Rewrite — Slot Placeholder + FLIP + Relaxed Zone

### Task 5.1: Add DnD placeholder CSS

**Files:**
- Modify: `desktop-rust/src/tabs/tasks/tasks-css.js` — DnD section (~lines 400–425)

- [ ] **Step 1: Add placeholder CSS (keep insertion-line for card DnD)**

The existing `.task-dnd-insertion-line` styles (lines 412–425) are for **card DnD** and must be **kept as-is**. Add the new placeholder CSS for checkbox DnD after the two-col insertion-line variant (after line 425):

```css
/* Checkbox DnD placeholder — dashed slot showing where the dragged row will land.
   Height set inline to match source row. */
.task-dnd-placeholder {
  border: 2px dashed var(--accent);
  border-radius: 4px;
  opacity: 0.5;
  pointer-events: none;
  flex-shrink: 0;
  background: rgba(56, 139, 253, 0.04);
}
```

No CSS blocks should be removed — only this new block added.

- [ ] **Step 2: Commit**

```bash
git add desktop-rust/src/tabs/tasks/tasks-css.js
git commit -m "feat: add DnD placeholder CSS for checkbox slot"
```

### Task 5.2: Rewrite checkbox DnD in dnd.js

**Files:**
- Modify: `desktop-rust/src/tabs/tasks/dnd.js` — checkbox drag path in `startDrag`, `onPointerMove`, `onPointerUp`, `cleanup`

**Strategy:** Keep card DnD (`kind='card'`) completely unchanged. Add parallel logic for checkbox DnD using placeholder+FLIP. The key functions to modify:

- `startDrag` (line 80): for checkbox kind, create placeholder, hide source
- `onPointerMove` (line 125): for checkbox kind, use relaxed zone detection + `updateCheckboxPlaceholder`
- `cleanup` (line 287): handle placeholder removal for checkbox kind

- [ ] **Step 1: Update `active` fields comment for new placeholder field**

Update the `active` fields comment (lines 33–43) to include the new checkbox-specific fields:

```
//   placeholder      — real DOM element holding source's slot during drag (checkbox only)
//   sourceHidden     — whether source has display:none applied
```

- [ ] **Step 2: Modify `startDrag` — create placeholder for checkbox kind**

After line 108 (`: source.parentElement;`), add placeholder creation for checkboxes:

```js
// Checkbox mode: build placeholder, hide source
if (kind === 'checkbox') {
  const placeholder = document.createElement('div');
  placeholder.className = 'task-dnd-placeholder';
  placeholder.style.height = rect.height + 'px';
  source.parentElement.insertBefore(placeholder, source);
  source.style.display = 'none';
  active = {
    kind, handle, source, listEl,
    offsetX: e.clientX - rect.left,
    offsetY: e.clientY - rect.top,
    ghost,
    line: null,
    placeholder,          // checkbox only
    sourceHidden: true,   // checkbox only
    insertBefore: null,
    hoverDropdownEl: null,
    hoverTimer: null,
    mode: 'reorder',
    dropdownItem: null,
    startX: e.clientX,
  };
  return;
}
```

Note: the existing `active = {...}` assignment at lines 110–122 remains for `kind='card'`. The new block above returns early for checkboxes.

- [ ] **Step 3: Modify `onPointerMove` — relaxed drop zone for checkbox**

In `onPointerMove` (line 125), after the card-mode dropdown logic (the `if (active.kind === 'card' && under)` block at line 137) and before the reorder mode section at line 172, add:

```js
// ── Checkbox mode — relaxed drop zone ─────────────────────────
if (active.kind === 'checkbox') {
  // Relaxed drop zone: any pixel inside the list container bounding box.
  const listEl = active.listEl;
  if (!listEl) return;
  const lr = listEl.getBoundingClientRect();
  const insideList = e.clientX >= lr.left && e.clientX <= lr.right
                  && e.clientY >= lr.top  && e.clientY <= lr.bottom;
  if (insideList) {
    active.mode = 'reorder';
    if (active.placeholder) active.placeholder.style.display = '';
    updateCheckboxPlaceholder(e);
  } else {
    active.mode = null;
    if (active.placeholder) active.placeholder.style.display = 'none';
  }
  return;
}
```

- [ ] **Step 4: Add `updateCheckboxPlaceholder` function**

Add after `updateInsertionLine` (after line 202):

```js
function updateCheckboxPlaceholder(e) {
  const listEl = active.listEl;
  const ph = active.placeholder;
  if (!listEl || !ph) return;

  const peers = Array.from(listEl.querySelectorAll(':scope > .tcb-item'))
    .filter(el => el !== active.source);

  const cursorY = e.clientY;
  let beforeEl = null;
  for (const peer of peers) {
    const r = peer.getBoundingClientRect();
    const mid = r.top + r.height / 2;
    if (cursorY < mid) { beforeEl = peer; break; }
  }

  // Already in the right slot?
  if (beforeEl === ph.nextElementSibling) return;
  if (beforeEl === null && ph === listEl.lastElementChild) return;

  // FLIP step 1: capture old positions
  const tracked = [...peers, ph];
  const oldTops = new Map();
  for (const el of tracked) {
    oldTops.set(el, el.getBoundingClientRect().top);
  }

  // Reorder placeholder
  listEl.insertBefore(ph, beforeEl);

  // FLIP step 2: animate to new positions
  for (const el of tracked) {
    const oldTop = oldTops.get(el);
    const newTop = el.getBoundingClientRect().top;
    const delta = oldTop - newTop;
    if (delta === 0) continue;
    el.style.transition = 'none';
    el.style.transform = `translateY(${delta}px)`;
    void el.offsetHeight;  // force reflow
    el.style.transition = `transform 180ms ease`;
    el.style.transform = '';
  }
}
```

- [ ] **Step 5: Modify `onPointerUp` — derive order from placeholder position**

In `onPointerUp` (line 234), replace the checkbox section (the `else` block at lines 262–283) with:

```js
} else {
  // checkbox — derive order from placeholder position
  if (active.mode !== 'reorder') return;
  const taskCard = active.source.closest('.task-card');
  const taskId = taskCard ? Number(taskCard.dataset.taskId) : null;
  if (taskId == null) return;

  const listEl = active.listEl;
  if (!listEl || !active.source || !active.placeholder) return;

  // Restore source where placeholder sits; remove placeholder
  listEl.insertBefore(active.source, active.placeholder);
  active.placeholder.remove();
  active.placeholder = null;

  // Determine nest target: the row immediately above the dropped position.
  // Do NOT nest into collapsed parents (spec §6c: user must expand first).
  const rowsInOrder = Array.from(listEl.querySelectorAll(':scope > .tcb-item'));
  const myIdx = rowsInOrder.indexOf(active.source);
  const prevRow = myIdx > 0 ? rowsInOrder[myIdx - 1] : null;
  const deltaX = e.clientX - active.startX;
  let nestUnder = null;
  if (prevRow && deltaX > NEST_THRESHOLD_PX) {
    const prevId = Number(prevRow.dataset.cbId);
    // Only nest if the target parent is NOT collapsed
    if (!isCollapsed(prevId)) {
      nestUnder = prevId;
    }
  }
  const draggedId = Number(active.source.dataset.cbId);
  const orderedIds = rowsInOrder.map(el => Number(el.dataset.cbId));
  await onCheckboxReorderCommit(taskId, draggedId, orderedIds, nestUnder);
}
```

- [ ] **Step 6: Modify `cleanup` — handle checkbox placeholder**

In `cleanup` (line 287), update to handle placeholder:

```js
function cleanup() {
  if (!active) return;
  if (active.ghost && active.ghost.parentNode) active.ghost.remove();
  if (active.placeholder && active.placeholder.parentNode) {
    // If source is still hidden, restore it before removing placeholder
    if (active.sourceHidden && active.source) {
      active.placeholder.parentNode.insertBefore(active.source, active.placeholder);
    }
    active.placeholder.remove();
  }
  if (active.line && active.line.parentNode) active.line.remove();
  if (active.source) {
    active.source.classList.remove('task-dnd-source');
    if (active.sourceHidden) {
      active.source.style.display = '';
    }
  }
  // Wipe FLIP transforms on checkbox peers
  if (active.listEl && active.kind === 'checkbox') {
    for (const el of active.listEl.querySelectorAll(':scope > .tcb-item')) {
      el.style.transition = '';
      el.style.transform = '';
    }
  }
  if (active.hoverTimer) clearTimeout(active.hoverTimer);
  clearDropdownHighlight();
  active = null;
}
```

- [ ] **Step 7: Commit**

```bash
git add desktop-rust/src/tabs/tasks/dnd.js
git commit -m "feat: checkbox DnD — slot placeholder + FLIP animations + relaxed drop zone"
```

---

## Chunk 6: Checkbox Collapse

### Task 6.1: Add collapse state and arrow toggle to card.js

**Files:**
- Modify: `desktop-rust/src/tabs/tasks/card.js` — add module-level state, modify `buildCheckboxRow`, modify `renderCheckboxes`/`renderNode`
- Modify: `desktop-rust/src/tabs/tasks/tasks-css.js` — collapse styles

- [ ] **Step 1: Add module-level collapse state to card.js**

At the top of `card.js`, after the `checkboxCache` Map (line 9), add:

```js
// Collapse state for checkbox rows. In-memory only; reset on tab re-entry
// via resetCollapseState() called from index.js:init().
const collapsedNodes = new Map();
export function resetCollapseState() {
  collapsedNodes.clear();
}
```

- [ ] **Step 1b: Wire `resetCollapseState()` in index.js:init()**

In `index.js`, add import:

```js
import { resetCollapseState } from './card.js';
```

In the `init()` function, call it before `renderAll()`:

```js
resetCollapseState();
```

Place the call right before `renderAll()` (around line 67).

- [ ] **Step 1c: Import `isCollapsed` in dnd.js for nesting guard**

In `dnd.js`, add import at top:

```js
import { isCollapsed } from './card.js';  // eslint-disable-line
```

(This import doesn't exist yet — it's exported in Step 3 below. Add it after Step 3 creates the export.)

- [ ] **Step 2: Add arrow element to `buildCheckboxRow` (only for parent nodes)**

In `buildCheckboxRow` (line 215), after the drag handle (line 226: `row.appendChild(handle);`) and before the checkbox input (line 229: `const cb = document.createElement('input');`), add:

```js
// Collapse/expand arrow — only for nodes that have children
if (node.children && node.children.length > 0) {
  const arrow = el('span', { class: 'tcb-arrow' });
  arrow.textContent = '▶';  // default; updated in renderNode
  arrow.title = 'Click to collapse/expand children. Ctrl+Click text for recursive.';
  arrow.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleCollapse(node.id);
    ctx.onTaskReload && ctx.onTaskReload();
  });
  row.appendChild(arrow);
} else {
  // Spacer so text aligns for leaf nodes
  const spacer = el('span', { class: 'tcb-arrow', style: 'visibility:hidden' });
  row.appendChild(spacer);
}
```

- [ ] **Step 3: Add collapse utility functions**

Add after the `loadCheckboxes` function (after line 416):

```js
export function isCollapsed(id) {
  return collapsedNodes.get(id) === true;
}

function toggleCollapse(id) {
  if (collapsedNodes.get(id)) {
    collapsedNodes.delete(id);
  } else {
    collapsedNodes.set(id, true);
  }
}

function collapseRecursive(id, collapsed, items) {
  // Walk subtree: find all descendants via parent_id and set their collapse state
  const children = items.filter(x => x.parent_id === id);
  collapsedNodes.set(id, collapsed);
  for (const child of children) {
    collapseRecursive(child.id, collapsed, items);
  }
}

function countDescendants(id, items) {
  // Returns { checked: number, total: number } for all recursive descendants
  const byParent = new Map();
  for (const it of items) {
    const pid = it.parent_id;
    if (pid == null) continue;
    if (!byParent.has(pid)) byParent.set(pid, []);
    byParent.get(pid).push(it);
  }
  let checked = 0, total = 0;
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop();
    const kids = byParent.get(cur);
    if (!kids) continue;
    for (const k of kids) {
      total++;
      if (k.is_checked) checked++;
      stack.push(k.id);
    }
  }
  return { checked, total };
}
```

Also update the existing export at the bottom of card.js (`export { loadCheckboxes };`) to:
```js
export { loadCheckboxes, isCollapsed, resetCollapseState };
```

- [ ] **Step 4: Modify `renderNode` in `renderCheckboxes` — skip collapsed children**

In `renderCheckboxes` (line 175), modify the `renderNode` function (lines 193–196):

Replace:

```js
function renderNode(node, depth) {
  target.appendChild(buildCheckboxRow(node, task, ctx, depth, { editable }));
  for (const c of node.children) renderNode(c, depth + 1);
}
```

With:

```js
function renderNode(node, depth) {
  const row = buildCheckboxRow(node, task, ctx, depth, { editable });

  // Update arrow based on collapse state
  const arrow = row.querySelector('.tcb-arrow');
  const collapsed = isCollapsed(node.id);
  if (arrow) {
    arrow.textContent = collapsed ? '▶' : '▼';
  }
  // Highlight collapsed parents
  if (collapsed && node.children.length > 0) {
    row.classList.add('collapsed-parent');
    // Counter badge
    const { checked, total } = countDescendants(node.id, items);
    const badge = el('span', { class: 'tcb-collapse-counter' });
    badge.textContent = `${checked}/${total}`;
    row.appendChild(badge);
  }

  target.appendChild(row);

  if (!collapsed) {
    for (const c of node.children) renderNode(c, depth + 1);
  }
}
```

- [ ] **Step 5: Add Ctrl+Click handler for recursive collapse**

In `buildCheckboxRow`, after the `textEl.addEventListener('blur', commit);` line (271), add:

```js
// Ctrl+Click on text = recursive collapse/expand all descendants
textEl.addEventListener('click', async (e) => {
  if (e.ctrlKey || e.metaKey) {
    e.preventDefault();
    const items = await loadCheckboxes(task.id);
    const collapsed = !isCollapsed(node.id);
    collapseRecursive(node.id, collapsed, items);
    ctx.onTaskReload && ctx.onTaskReload();
  }
});
```

- [ ] **Step 6: Add collapse CSS to tasks-css.js**

In `tasksCSS()` return string, add after the `.tcb-add` block (~line 278):

```css
/* Collapse arrow */
.tcb-arrow {
  width: 16px;
  height: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 9px;
  color: var(--text-muted);
  cursor: pointer;
  flex-shrink: 0;
  user-select: none;
  transition: transform 0.12s;
}
.tcb-arrow:hover { color: var(--text); }

/* Collapsed parent — subtle background pill */
.tcb-item.collapsed-parent {
  background: rgba(56, 139, 253, 0.08);
  border-radius: 4px;
}

/* Counter badge: "3/10" */
.tcb-collapse-counter {
  background: var(--bg-tertiary);
  color: var(--text-muted);
  border-radius: 8px;
  padding: 1px 7px;
  font-size: 11px;
  margin-left: auto;
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
}

/* Collapse/expand child transition */
.tcb-item.depth-1,
.tcb-item.depth-2,
.tcb-item.depth-3 {
  transition: opacity 150ms ease, transform 150ms ease;
}
```

- [ ] **Step 7: Commit**

```bash
git add desktop-rust/src/tabs/tasks/card.js desktop-rust/src/tabs/tasks/tasks-css.js
git commit -m "feat: checkbox collapse — arrow toggle, counter badge, Ctrl+Click recursive"
```

---

## Chunk 7: Final Verification

### Task 7.1: Run frontend tests and cargo check

**Files:** None (verification only)

- [ ] **Step 1: Run frontend tests**

```bash
cd desktop-rust/src && python3 dev-test.py
```

Expected: all tests PASS.

- [ ] **Step 2: Run cargo check**

```bash
cd desktop-rust/src-tauri && cargo check
```

Expected: no errors (no Rust changes, but verify nothing broke).

- [ ] **Step 3: Manual smoke test checklist**

1. Open Tasks tab — header shows gear button ⚙ next to help
2. Click gear → modal with two sliders opens
3. Move "Checkbox font size" slider → text in checkboxes resizes live
4. Click Confirm → setting persists after tab switch
5. Open a task card with checkboxes — type text, press Tab → focus stays in the newly indented row
6. Shift+Tab → focus stays after outdent
7. Create checkbox, type nothing, press Backspace → row deletes, focus moves to above row
8. Create many checkboxes in a card → card does not overlap the next card in the list
9. Drag a checkbox by its ⋮⋮ grip → ghost follows cursor, dashed placeholder slot appears, peers animate via FLIP
10. Drag checkbox slightly to the right (deltaX > 30px) and drop → nests under previous row
11. Click ▶ arrow on a parent checkbox → children collapse, counter badge "3/10" shows
12. Click ▼ → children expand
13. Ctrl+Click on checkbox text → all descendants collapse/expand recursively

- [ ] **Step 4: Create release tag**

This is a frontend-only change (no Rust/IPC changes) → use `f-*` tag per CLAUDE.md §12 and RELEASES.md §1:

```bash
TAG="f-$(date +%Y%m%d)-3"   # -3 because f-20260428-2 already exists (tags 1 and 2 taken today)
git tag "$TAG"
git push
git push origin "$TAG"
```
