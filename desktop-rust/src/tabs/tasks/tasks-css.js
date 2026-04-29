// Scoped CSS for the Tasks tab.

export function tasksCSS() {
  return `
.tasks-wrap {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

/* Pinned chips row */
.tasks-pinned-chips {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-bottom: 1px solid var(--border);
  flex-wrap: wrap;
  min-height: 36px;
}
.tasks-pinned-chips.empty { display: none; }

.tasks-pinned-chip {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 4px 12px 4px 8px;
  border: 1px solid var(--border); border-radius: 4px;
  font-size: 12px; font-weight: 600;
  background: transparent;
  color: var(--text);
  cursor: pointer;
  max-width: 240px;
  user-select: none;
}
.tasks-pinned-chip:hover { border-color: var(--text-muted); background: var(--bg-secondary); }
.tasks-pinned-chip-bar {
  width: 3px; height: 14px; border-radius: 2px; flex-shrink: 0;
}
.tasks-pinned-chip-label {
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

/* Filter row */
.tasks-filter-row {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
}
.tasks-filter-row .spacer { flex: 1; }
.tasks-filter-group { display: flex; align-items: center; gap: 6px; }
.tasks-filter-label { font-size: 12px; color: var(--text-muted); }

.tasks-dropdown {
  position: relative;
  display: inline-flex; align-items: center; gap: 6px;
  padding: 4px 10px 4px 8px;
  border: 1px solid var(--border); border-radius: 4px;
  background: var(--bg-secondary);
  cursor: pointer;
  font-size: 12px; font-weight: 500;
  min-width: 140px;
  user-select: none;
}
.tasks-dropdown:hover { border-color: var(--text-muted); }
.tasks-dropdown.drop-hover {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px rgba(56, 139, 253, 0.25);
}
.tasks-dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; flex-shrink: 0; }
.tasks-dropdown-chevron { margin-left: auto; opacity: 0.6; font-size: 10px; }
.tasks-dropdown-menu {
  position: absolute;
  top: calc(100% + 4px); left: 0;
  background: var(--bg-secondary);
  border: 1px solid var(--border); border-radius: 6px;
  min-width: 220px;
  padding: 4px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
  z-index: 100;
}
.tasks-dropdown-item {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 10px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
}
.tasks-dropdown-item:hover { background: var(--bg-tertiary); }
.tasks-dropdown-item.drop-target {
  outline: 2px solid var(--accent);
  background: rgba(56, 139, 253, 0.12);
}
.tasks-dropdown-item.selected { color: var(--accent); font-weight: 600; }
.tasks-dropdown-item .item-count { margin-left: auto; color: var(--text-muted); font-size: 11px; }
.tasks-dropdown-item.none-item {
  color: var(--text-muted);
  font-style: italic;
}
.tasks-dropdown-item.none-item .tasks-dot {
  background: transparent !important;
  border: 1px dashed var(--text-muted);
}

/* Layout toggle */
.tasks-layout-toggle {
  display: inline-flex; align-items: center; justify-content: center;
  width: 30px; height: 30px;
  border: 1px solid var(--border); border-radius: 4px;
  background: var(--bg-secondary);
  cursor: pointer;
  padding: 0;
  color: var(--text-muted);
}
.tasks-layout-toggle:hover { border-color: var(--text-muted); color: var(--text); }
.tasks-layout-toggle.active {
  border-color: var(--accent);
  color: var(--accent);
}
.tasks-layout-toggle svg { width: 16px; height: 16px; display: block; }

/* Cards scroll */
.tasks-cards-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
}
.tasks-cards-scroll.one-col {
  display: flex;
  flex-direction: column;
  gap: 0;                    /* cards use margin-bottom for spacing */
}
.tasks-cards-scroll.two-col {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0;                    /* margin-bottom on cards instead */
  align-items: start;
}
.tasks-empty {
  padding: 24px;
  color: var(--text-muted);
  font-style: italic;
  text-align: center;
}

/* Task card */
.task-card {
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
  transition: border-color 0.15s;
  position: relative;
  flex-shrink: 0;            /* prevent shrinking in flex column */
  height: auto;
  margin-bottom: 10px;       /* gap fallback — more reliable across WebView versions */
}
.task-card:last-child { margin-bottom: 0; }
.task-card:hover { border-color: var(--text-muted); }
.task-card.expanded { border-color: var(--accent); }
.task-card.dragging { opacity: 0.45; }

.task-card-head {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border);
}
.task-card-head.no-border { border-bottom: none; }

.task-drag-handle {
  color: var(--text-muted);
  cursor: grab;
  font-size: 14px;
  line-height: 1;
  padding: 2px 4px;
  user-select: none;
  touch-action: none;
}
.task-drag-handle:hover { color: var(--text); }
.task-drag-handle:active { cursor: grabbing; }

.task-title {
  flex: 1;
  font-weight: 600;
  font-size: 14px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.task-badge {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 1px 7px;
  border-radius: 10px;
  font-size: 10.5px; font-weight: 500;
  background: var(--bg-tertiary);
  border: 1px solid var(--border);
  color: var(--text);
  white-space: nowrap;
}
.task-badge .tasks-dot { width: 7px; height: 7px; }

.task-icon-btn {
  background: transparent; border: none; cursor: pointer;
  color: var(--text-muted); padding: 4px 6px; border-radius: 3px;
  font-size: 12px; line-height: 1;
}
.task-icon-btn:hover { color: var(--text); background: var(--bg-tertiary); }

.task-tracker-btn {
  color: var(--accent);
  text-decoration: none;
  font-size: 11px;
  font-weight: 500;
  padding: 2px 7px;
  border-radius: 3px;
  background: rgba(56, 139, 253, 0.1);
  border: 1px solid rgba(56, 139, 253, 0.3);
  white-space: nowrap;
}
.task-tracker-btn:hover { background: rgba(56, 139, 253, 0.2); }

.task-card-body {
  padding: 6px 0;
  overflow-y: auto;
}

.tcb-item {
  display: flex; align-items: center; gap: 5px;
  padding: 3px 10px 3px 0;
  /* Font-size is a root-level CSS variable so changing it in Settings
     immediately re-flows every checkbox row without re-render. */
  font-size: var(--task-cb-font-size, 13px);
  line-height: 1.4;
}
.tcb-item.depth-1 { padding-left: 24px; }
.tcb-item.depth-2 { padding-left: 48px; }
.tcb-item.depth-3 { padding-left: 72px; }
.tcb-handle {
  color: var(--text-muted);
  opacity: 0.4;
  font-size: 11px;
  padding: 2px 2px 2px 10px;
  cursor: grab;
  user-select: none;
  touch-action: none;
}
.tcb-item:hover .tcb-handle { opacity: 1; }
.tcb-item input[type="checkbox"] { accent-color: var(--accent); margin: 0; cursor: pointer; }
.tcb-text {
  flex: 1; color: var(--text);
  border: none; background: transparent; outline: none;
  font: inherit; padding: 0;
  /* contenteditable div — wrap long text instead of overflowing right. */
  white-space: pre-wrap;
  word-break: break-word;
  min-width: 0;
  /* Font-size can be overridden by Settings → Tasks "Checkbox font size"
     via the inline .tasks-cards-scroll[data-cb-font-size] attribute. */
}
.tcb-text.checked { color: var(--text-muted); text-decoration: line-through; }
.tcb-text[contenteditable="true"]:focus { outline: 1px solid var(--accent); outline-offset: 2px; border-radius: 2px; }
.tcb-item { flex-wrap: nowrap; align-items: flex-start; }
.tcb-item input[type="checkbox"] { margin-top: 3px; flex-shrink: 0; }
.tcb-handle { flex-shrink: 0; }
.tcb-delete {
  color: var(--text-muted); opacity: 0; cursor: pointer;
  font-size: 12px; padding: 0 6px;
  background: transparent; border: none;
}
.tcb-item:hover .tcb-delete { opacity: 0.7; }
.tcb-delete:hover { color: var(--danger); opacity: 1 !important; }

.tcb-add {
  display: flex; align-items: center; gap: 6px;
  padding: 4px 12px;
  color: var(--text-muted);
  opacity: 0.45;
  cursor: pointer;
  font-size: 12px; font-style: italic;
  user-select: none;
}
.tcb-add:hover { opacity: 1; color: var(--accent); }

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

/* Expanded editor */
.task-editor-body {
  padding: 12px;
  display: flex; flex-direction: column; gap: 14px;
}
.task-editor-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.task-editor-row.top { align-items: flex-start; }
.task-editor-label {
  font-size: 11px; color: var(--text-muted);
  text-transform: uppercase; letter-spacing: 0.4px;
  font-weight: 600; min-width: 80px;
}
.task-editor-title {
  background: var(--bg-tertiary);
  border: 1px solid var(--border);
  color: var(--text);
  padding: 6px 10px;
  border-radius: 4px;
  font-size: 15px; font-weight: 600;
  flex: 1;
  width: 100%;
  box-sizing: border-box;
}
.task-editor-input {
  background: var(--bg-tertiary);
  border: 1px solid var(--border);
  color: var(--text);
  padding: 5px 10px;
  border-radius: 4px;
  font-size: 12px;
  font-family: 'SF Mono', 'Consolas', monospace;
  flex: 1;
  box-sizing: border-box;
}
.task-editor-links {
  flex: 1; display: flex; flex-direction: column; gap: 4px;
}
.task-editor-link-row {
  display: flex; align-items: center; gap: 6px;
}
.task-editor-link-row .url-in { flex: 1; }
.task-editor-link-row .label-in { width: 140px; flex: 0 0 140px; }

.task-editor-palette {
  display: flex; gap: 6px; align-items: center;
}
.task-editor-swatch {
  width: 22px; height: 22px; border-radius: 4px;
  border: 2px solid transparent;
  cursor: pointer;
}
.task-editor-swatch.selected { border-color: var(--accent); }
.task-editor-swatch.clear {
  background: var(--bg-tertiary);
  position: relative;
}
.task-editor-swatch.clear::after {
  content: '∅';
  position: absolute; inset: 0;
  display: flex; align-items: center; justify-content: center;
  color: var(--text-muted); font-size: 14px; line-height: 1;
}
.task-editor-swatch.custom {
  background: repeating-conic-gradient(#f85149 0% 25%, #d29922 0% 50%, #3fb950 0% 75%, #388bfd 0% 100%) 50% / 10px 10px;
}

.task-editor-cb-area {
  background: var(--bg-tertiary);
  border-radius: 4px;
  padding: 6px 0;
}

.task-editor-notes-toolbar-wrap .md-toolbar {
  border-radius: 4px 4px 0 0;
}
.task-editor-notes {
  background: var(--bg-tertiary);
  border: 1px solid var(--border);
  color: var(--text);
  padding: 8px 10px;
  border-radius: 0 0 4px 4px;
  font-family: 'SF Mono', 'Consolas', monospace;
  font-size: 12px;
  width: 100%;
  min-height: 100px;
  box-sizing: border-box;
  resize: vertical;
  border-top: none;
}

.task-editor-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.task-editor-actions .spacer { flex: 1; }
.task-editor-btn {
  padding: 5px 12px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-tertiary);
  color: var(--text);
  cursor: pointer;
  font-size: 12px;
}
.task-editor-btn:hover { border-color: var(--text-muted); }
.task-editor-btn.primary {
  background: var(--accent);
  color: white;
  border-color: var(--accent);
}
.task-editor-btn.primary:hover { background: var(--accent-hover); }
.task-editor-btn.danger {
  background: transparent;
  color: var(--danger);
  border-color: rgba(248, 81, 73, 0.3);
}
.task-editor-btn.danger:hover { background: rgba(248, 81, 73, 0.1); }

/* DnD — floating clone follows the cursor; source stays in place dimmed; a
   blue insertion line shows the drop target in the list. */
.task-dnd-drag-clone {
  /* Most layout set inline at spawn-time; here just a subtle cursor hint. */
  cursor: grabbing !important;
  user-select: none;
}
.task-dnd-source {
  opacity: 0.35;
  transition: opacity 80ms ease;
  pointer-events: none;
}
.task-dnd-insertion-line {
  height: 3px;
  background: var(--accent);
  border-radius: 2px;
  margin: 3px 0;
  box-shadow: 0 0 0 1px rgba(56, 139, 253, 0.25);
  pointer-events: none;
  flex-shrink: 0;
}
/* In 2-col grid mode the insertion line needs to span both columns so it
   visually reads as a horizontal rule between rows. */
.tasks-cards-scroll.two-col .task-dnd-insertion-line {
  grid-column: 1 / -1;
}

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

/* Manage modal */
.tasks-manage-row {
  display: flex; align-items: center; gap: 8px;
  padding: 6px;
  border-radius: 4px;
  border: 1px solid var(--border);
  margin-bottom: 6px;
  background: var(--bg-secondary);
}
.tasks-manage-row .handle { cursor: grab; color: var(--text-muted); padding: 0 4px; user-select: none; }
.tasks-manage-row .dot-btn {
  width: 14px; height: 14px; border-radius: 50%;
  cursor: pointer; border: 1px solid var(--border);
  flex-shrink: 0;
}
.tasks-manage-row input[type="text"] {
  background: var(--bg-primary);
  border: 1px solid var(--border);
  color: var(--text);
  padding: 3px 8px;
  border-radius: 3px;
  font-size: 12px;
  flex: 1;
}
.tasks-manage-footer {
  display: flex;
  justify-content: space-between;
  margin-top: 12px;
}
.tasks-manage-modal {
  max-width: 560px;
}

/* Color palette popover */
.tasks-color-popover {
  position: absolute;
  background: var(--bg-primary);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
  z-index: 200;
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 6px;
}
.tasks-color-popover .sw {
  width: 22px; height: 22px;
  border-radius: 4px;
  cursor: pointer;
  border: 2px solid transparent;
}
.tasks-color-popover .sw:hover { border-color: var(--accent); }
.tasks-color-popover .sw.custom {
  background: repeating-conic-gradient(#f85149 0% 25%, #d29922 0% 50%, #3fb950 0% 75%, #388bfd 0% 100%) 50% / 10px 10px;
}

/* Task tab header */
.tasks-header {
  display: flex; align-items: center;
  padding: 10px 16px 0;
  gap: 10px;
}
.tasks-header h2 { margin: 0; font-size: 17px; }

/* Context menu (right-click manage) */
.tasks-ctx-menu {
  position: fixed;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 4px;
  min-width: 180px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
  z-index: 300;
  font-size: 12px;
}
.tasks-ctx-menu-item {
  padding: 6px 10px;
  border-radius: 3px;
  cursor: pointer;
  user-select: none;
}
.tasks-ctx-menu-item:hover { background: var(--bg-tertiary); }
`;
}

// Predefined color palettes
export const CATEGORY_COLORS = [
  '#388bfd', // blue
  '#3fb950', // green
  '#d29922', // amber
  '#f85149', // red
  '#a371f7', // purple
  '#ec6547', // orange
  '#db61a2', // pink
  '#8b949e', // grey
];

export const STATUS_COLORS = CATEGORY_COLORS;

// Card background tints (applied as rgba overlay over --bg-secondary).
export const CARD_BG_PALETTE = [
  { name: 'Default', value: null },
  { name: 'Blue',    value: '#1f3a5f' },
  { name: 'Amber',   value: '#3d2f0d' },
  { name: 'Green',   value: '#2d3f1b' },
  { name: 'Crimson', value: '#3a1f2d' },
  { name: 'Purple',  value: '#2d2a3d' },
];
