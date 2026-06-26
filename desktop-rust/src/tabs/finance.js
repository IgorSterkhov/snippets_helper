import { call } from '../tauri-api.js';
import { showModal } from '../components/modal.js';
import { openShareLinkModal } from '../components/share-link-modal.js';
import { showToast } from '../components/toast.js';
import { showErrorDialog } from '../components/error-dialog.js';

const COLLAPSE_KEY = 'finance.collapsed.items';
const FINANCE_DISPLAY_SETTINGS = {
  strongColor: 'finance.level_band_strong_color',
  mediumColor: 'finance.level_band_medium_color',
  softColor: 'finance.level_band_soft_color',
  fillOrder: 'finance.level_band_fill_order',
};
const DEFAULT_FINANCE_DISPLAY = {
  strongColor: '#267f95',
  mediumColor: '#216a7d',
  softColor: '#1b5364',
  fillOrder: 'strong_first',
};
const FINANCE_FILL_ORDERS = new Set(['strong_first', 'soft_first']);
const FINANCE_HEADER_AUTOSAVE_DELAY_MS = 650;
const FINANCE_PLACEHOLDER_ITEM_NAME = 'Untitled item';
const CALENDAR_MONTHS_KEY_PREFIX = 'finance.calendar.months.';
const CALENDAR_SHOW_OLD_KEY = 'finance.calendar.show_old_months';
const PLAN_KINDS = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'project', label: 'Project' },
  { value: 'one_time', label: 'One-time' },
  { value: 'general', label: 'General' },
];
const PLAN_KIND_LABELS = Object.fromEntries(PLAN_KINDS.map((kind) => [kind.value, kind.label]));

let rootEl = null;
let financeViewHistoryListenerInstalled = false;
let state = {
  plans: [],
  items: [],
  allItems: [],
  payments: [],
  transactions: [],
  allocations: [],
  mappingRules: [],
  activePlanId: null,
  activeMode: 'lists',
  activeView: 'structure',
  factsFilter: 'all',
  factsDateMode: 'all',
  factsDate: '',
  factsDateFrom: '',
  factsDateTo: '',
  factsMonth: '',
  factsYear: '',
  calendarShowOldMonths: false,
  collapsed: new Set(),
  itemDrag: null,
  planDrag: null,
  display: { ...DEFAULT_FINANCE_DISPLAY },
  headerSaveTimer: null,
};

let stylesInjected = false;

function injectStyles() {
  if (stylesInjected) return;
  stylesInjected = true;
  const style = document.createElement('style');
  style.textContent = `
.finance-tab {
  height: 100%;
  display: flex;
  flex-direction: column;
  color: var(--text);
  --finance-band-strong-color: ${DEFAULT_FINANCE_DISPLAY.strongColor};
  --finance-band-medium-color: ${DEFAULT_FINANCE_DISPLAY.mediumColor};
  --finance-band-soft-color: ${DEFAULT_FINANCE_DISPLAY.softColor};
  --finance-band-strong-bg: hsl(192 53% 24%);
  --finance-band-strong-bg-soft: hsl(192 44% 17%);
  --finance-band-strong-border: hsl(192 53% 42%);
  --finance-band-medium-bg: hsl(193 52% 21%);
  --finance-band-medium-bg-soft: hsl(193 44% 15%);
  --finance-band-medium-border: hsl(193 52% 36%);
  --finance-band-soft-bg: hsl(194 47% 18%);
  --finance-band-soft-bg-soft: hsl(194 39% 13%);
  --finance-band-soft-border: hsl(194 47% 30%);
  --finance-row-hover: var(--bg-tertiary);
}
.finance-shell {
  flex: 1;
  min-height: 0;
  display: flex;
  background: var(--bg-primary);
}
.finance-sidebar {
  width: 264px;
  min-width: 220px;
  border-right: 1px solid var(--border);
  background: color-mix(in srgb, var(--bg-secondary) 72%, transparent);
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.finance-facts-sidebar {
  width: 244px;
  min-width: 220px;
  background:
    linear-gradient(180deg, color-mix(in srgb, #20333c 20%, transparent), transparent 170px),
    color-mix(in srgb, var(--bg-secondary) 70%, var(--bg-primary));
}
.finance-side-header,
.finance-main-header {
  min-height: 52px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.finance-main-header-plan {
  min-height: 50px;
  padding: 8px 12px;
  background: linear-gradient(180deg, color-mix(in srgb, var(--bg-secondary) 78%, transparent), var(--bg-primary));
}
.finance-title {
  font-size: 15px;
  font-weight: 650;
  letter-spacing: 0;
}
.finance-side-actions,
.finance-header-actions,
.finance-row-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}
.finance-icon-btn,
.finance-small-btn {
  min-width: 28px;
  height: 26px;
  padding: 0 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-primary);
  color: var(--text);
  cursor: pointer;
  font-size: 12px;
}
.finance-icon-btn:hover,
.finance-small-btn:hover {
  border-color: var(--accent);
}
.finance-primary-btn {
  border-color: color-mix(in srgb, var(--accent) 52%, var(--border));
  background: color-mix(in srgb, var(--accent) 14%, var(--bg-primary));
  font-weight: 650;
}
.finance-plan-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 8px;
}
.finance-filter-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 10px;
}
.finance-filter-section {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: color-mix(in srgb, var(--bg-primary) 72%, transparent);
  padding: 10px;
  margin-bottom: 10px;
}
.finance-filter-title {
  color: var(--text);
  font-size: 12px;
  font-weight: 750;
  margin-bottom: 8px;
}
.finance-filter-help {
  color: var(--text-muted);
  font-size: 11px;
  line-height: 1.4;
}
.finance-filter-field {
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin-top: 8px;
}
.finance-filter-field label {
  color: var(--text-muted);
  font-size: 11px;
}
.finance-filter-field input,
.finance-filter-field select {
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  height: 26px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-primary);
  color: var(--text);
  padding: 2px 7px;
  font-size: 12px;
}
.finance-filter-count {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 8px;
  align-items: baseline;
  color: var(--text-muted);
  font-size: 11px;
}
.finance-filter-count strong {
  color: var(--text);
  font-size: 16px;
  font-variant-numeric: tabular-nums;
}
.finance-month-picker-field,
.finance-tree-select {
  position: relative;
}
.finance-month-picker-trigger,
.finance-tree-select-trigger {
  width: 100%;
  min-width: 0;
  height: 28px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-primary);
  color: var(--text);
  padding: 2px 8px;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;
  gap: 8px;
}
.finance-month-picker-trigger:hover,
.finance-tree-select-trigger:hover {
  border-color: var(--accent);
}
.finance-month-picker-trigger::after,
.finance-tree-select-trigger::after {
  content: "⌄";
  color: var(--text-muted);
  font-size: 12px;
}
.finance-month-popover,
.finance-tree-select-menu {
  position: absolute;
  left: 0;
  top: calc(100% + 5px);
  z-index: 1200;
  width: min(280px, calc(100vw - 40px));
  border: 1px solid color-mix(in srgb, var(--accent) 26%, var(--border));
  border-radius: 8px;
  background: color-mix(in srgb, var(--bg-secondary) 94%, var(--bg-primary));
  box-shadow: 0 14px 34px rgba(0, 0, 0, 0.34);
  padding: 8px;
}
.finance-month-picker-head {
  display: grid;
  grid-template-columns: 30px 1fr 30px;
  align-items: center;
  gap: 6px;
  margin-bottom: 7px;
}
.finance-month-picker-head strong {
  text-align: center;
  font-size: 12px;
}
.finance-month-picker-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 5px;
}
.finance-month-option,
.finance-tree-select-option {
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--text);
  cursor: pointer;
  font-size: 12px;
}
.finance-month-option {
  height: 28px;
}
.finance-month-option:hover,
.finance-month-option.active {
  border-color: color-mix(in srgb, var(--accent) 48%, var(--border));
  background: color-mix(in srgb, var(--accent) 16%, var(--bg-primary));
}
.finance-tree-select-menu {
  width: min(360px, calc(100vw - 40px));
  max-height: 300px;
  overflow-y: auto;
}
.finance-tree-select-option {
  width: 100%;
  min-height: 28px;
  padding: 4px 8px 4px calc(8px + var(--depth, 0) * 16px);
  text-align: left;
  display: grid;
  grid-template-columns: auto 1fr;
  align-items: center;
  gap: 7px;
}
.finance-tree-select-option:hover {
  border-color: color-mix(in srgb, var(--accent) 44%, var(--border));
  background: color-mix(in srgb, var(--accent) 13%, var(--bg-primary));
}
.finance-tree-select-option.group {
  color: var(--text-muted);
  cursor: default;
  font-weight: 700;
}
.finance-tree-select-option.group:hover {
  border-color: transparent;
  background: transparent;
}
.finance-tree-select-option.selected {
  border-color: color-mix(in srgb, var(--accent) 56%, var(--border));
  background: color-mix(in srgb, var(--accent) 18%, var(--bg-primary));
}
.finance-tree-select-marker {
  width: 14px;
  color: var(--text-muted);
  text-align: center;
}
.finance-tree-select-empty {
  color: var(--text-muted);
  font-size: 12px;
  padding: 8px;
}
.finance-plan-card {
  display: grid;
  grid-template-columns: 20px 1fr auto;
  align-items: center;
  gap: 8px;
  min-height: 42px;
  padding: 7px 8px;
  border: 1px solid transparent;
  border-radius: 7px;
  cursor: pointer;
}
.finance-plan-card:hover {
  background: var(--finance-row-hover);
}
.finance-plan-card.active {
  background: color-mix(in srgb, var(--accent) 18%, var(--bg-secondary));
  border-color: color-mix(in srgb, var(--accent) 48%, var(--border));
}
.finance-plan-card.dimmed {
  opacity: 0.72;
}
.finance-plan-grip,
.finance-row-grip {
  width: 18px;
  height: 24px;
  border: 0;
  background: transparent;
  color: var(--text-muted);
  cursor: grab;
  padding: 0;
  line-height: 1;
}
.finance-plan-name {
  min-width: 0;
  font-size: 13px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.finance-plan-currency {
  color: var(--text-muted);
  font-size: 11px;
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 2px 6px;
}
.finance-plan-meta {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 5px;
}
.finance-plan-kind {
  color: var(--text-muted);
  font-size: 11px;
  border: 1px solid color-mix(in srgb, var(--accent) 36%, var(--border));
  border-radius: 999px;
  padding: 2px 6px;
}
.finance-main {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.finance-mode-bar {
  min-height: 38px;
  padding: 6px 12px;
  border-bottom: 1px solid var(--border);
  background: color-mix(in srgb, var(--bg-secondary) 70%, var(--bg-primary));
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.finance-plan-edit {
  display: grid;
  grid-template-columns: minmax(220px, 1fr) 74px 122px 58px;
  gap: 7px;
  align-items: center;
  min-width: 0;
  flex: 1;
  max-width: 740px;
}
.finance-input,
.finance-money-input,
.finance-note-input,
.finance-date-input,
.finance-select {
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-primary);
  color: var(--text);
  height: 24px;
  padding: 2px 7px;
  font-size: 12px;
}
.finance-plan-edit .finance-input,
.finance-plan-edit .finance-select {
  background: color-mix(in srgb, var(--bg-secondary) 76%, var(--bg-primary));
}
.finance-plan-edit .finance-name-input {
  height: 28px;
  font-size: 14px;
  font-weight: 750;
}
.finance-select {
  padding-right: 24px;
}
.finance-autosave-status {
  min-width: 54px;
  color: var(--text-muted);
  font-size: 11px;
  text-align: right;
  white-space: nowrap;
}
.finance-autosave-status.saving {
  color: var(--accent-hover);
}
.finance-autosave-status.failed {
  color: var(--danger);
}
.finance-row .finance-input,
.finance-row .finance-money-input,
.finance-row .finance-note-input,
.finance-row .finance-date-input {
  background: transparent;
  border-color: transparent;
}
.finance-row:hover .finance-input,
.finance-row:hover .finance-money-input,
.finance-row:hover .finance-note-input,
.finance-row:hover .finance-date-input {
  background: rgba(13, 17, 23, 0.14);
  border-color: rgba(201, 209, 217, 0.12);
}
.finance-row .finance-input:focus,
.finance-row .finance-money-input:focus,
.finance-row .finance-note-input:focus,
.finance-row .finance-date-input:focus {
  outline: none;
  background: rgba(13, 17, 23, 0.34);
  border-color: var(--accent);
}
.finance-summary {
  display: grid;
  grid-template-columns: repeat(3, minmax(120px, 1fr));
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
}
.finance-facts-summary {
  grid-template-columns: repeat(4, minmax(112px, 1fr));
}
.finance-stat {
  border: 1px solid var(--border);
  border-radius: 7px;
  padding: 7px 10px;
  background: var(--bg-secondary);
}
.finance-stat-label {
  color: var(--text-muted);
  font-size: 11px;
  margin-bottom: 4px;
}
.finance-stat-value {
  font-size: 16px;
  font-weight: 700;
}
.finance-view-bar {
  min-height: 38px;
  padding: 6px 12px;
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  background: color-mix(in srgb, var(--bg-primary) 78%, var(--bg-secondary));
}
.finance-segment {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 2px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--bg-secondary);
}
.finance-segment-btn {
  height: 26px;
  min-width: 78px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 12px;
  font-weight: 650;
}
.finance-segment-btn.active {
  background: color-mix(in srgb, var(--accent) 18%, var(--bg-primary));
  color: var(--text);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 38%, transparent);
}
.finance-calendar-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}
.finance-calendar-status {
  color: var(--text-muted);
  font-size: 11px;
  white-space: nowrap;
}
.finance-table-wrap {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 8px 10px 12px;
}
.finance-facts-header {
  min-height: 50px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  background: linear-gradient(180deg, color-mix(in srgb, var(--bg-secondary) 74%, transparent), var(--bg-primary));
}
.finance-facts-kicker {
  color: var(--text-muted);
  font-size: 11px;
  margin-top: 2px;
}
.finance-facts-actions,
.finance-facts-filter {
  display: flex;
  align-items: center;
  gap: 6px;
}
.finance-facts-table {
  min-width: 980px;
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
  background: var(--bg-primary);
}
.finance-facts-head,
.finance-fact-row {
  display: grid;
  grid-template-columns: 92px minmax(220px, 1.4fr) minmax(130px, .8fr) 112px minmax(200px, 1fr) 96px 78px;
  align-items: center;
}
.finance-facts-head {
  min-height: 30px;
  color: var(--text-muted);
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border);
  font-size: 11px;
  text-transform: uppercase;
}
.finance-facts-head > div,
.finance-fact-row > div {
  min-width: 0;
  padding: 5px 8px;
}
.finance-fact-row {
  min-height: 34px;
  border-bottom: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
  font-size: 12px;
}
.finance-fact-row:last-child {
  border-bottom: 0;
}
.finance-fact-row:hover {
  background: var(--finance-row-hover);
}
.finance-fact-description,
.finance-fact-bank,
.finance-fact-target {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.finance-fact-date {
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}
.finance-fact-money {
  font-weight: 760;
  text-align: right;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.finance-fact-money.expense {
  color: #ffb4a8;
}
.finance-fact-money.income {
  color: #8dd9a8;
}
.finance-fact-state {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 100%;
  padding: 2px 7px;
  border: 1px solid var(--border);
  border-radius: 999px;
  color: var(--text-muted);
  background: var(--bg-secondary);
  font-size: 11px;
  white-space: nowrap;
}
.finance-fact-state.mapped {
  color: var(--text);
  border-color: color-mix(in srgb, var(--accent) 44%, var(--border));
  background: color-mix(in srgb, var(--accent) 12%, var(--bg-secondary));
}
.finance-fact-state.locked {
  border-color: color-mix(in srgb, #f2cc60 52%, var(--border));
}
.finance-fact-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 4px;
}
.finance-modal-grid {
  display: grid;
  grid-template-columns: 144px minmax(220px, 1fr);
  gap: 10px 12px;
  align-items: center;
  min-width: min(620px, 76vw);
}
.finance-modal-grid label {
  color: var(--text-muted);
  font-size: 12px;
}
.finance-modal-grid input,
.finance-modal-grid select {
  min-width: 0;
}
.finance-modal-note {
  grid-column: 1 / -1;
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.45;
}
.finance-import-preview {
  display: grid;
  grid-template-columns: repeat(2, minmax(160px, 1fr));
  gap: 8px;
  min-width: min(520px, 74vw);
}
.finance-import-preview div {
  border: 1px solid var(--border);
  border-radius: 7px;
  padding: 8px 10px;
  background: var(--bg-secondary);
}
.finance-import-preview span {
  display: block;
  color: var(--text-muted);
  font-size: 11px;
}
.finance-import-preview strong {
  display: block;
  margin-top: 3px;
  color: var(--text);
  font-size: 15px;
}
.finance-tree {
  min-width: 900px;
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
  background: var(--bg-primary);
}
.finance-table-head,
.finance-row {
  display: grid;
  grid-template-columns: 24px 28px minmax(200px, 1.6fr) 118px 108px 130px minmax(140px, 1fr) 74px;
  align-items: center;
  gap: 0;
}
.finance-table-head {
  min-height: 30px;
  color: var(--text-muted);
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border);
  font-size: 11px;
  text-transform: uppercase;
}
.finance-table-head > div,
.finance-row > div {
  padding: 0 6px;
}
.finance-row {
  min-height: 32px;
  border-bottom: 1px solid color-mix(in srgb, var(--border) 72%, transparent);
  position: relative;
}
.finance-row.finance-band-slot-0 {
  background: linear-gradient(
    90deg,
    var(--finance-band-strong-bg),
    var(--finance-band-strong-bg-soft)
  );
  border-bottom-color: var(--finance-band-strong-border);
}
.finance-row.finance-band-slot-1 {
  background: linear-gradient(
    90deg,
    var(--finance-band-medium-bg),
    var(--finance-band-medium-bg-soft)
  );
  border-bottom-color: var(--finance-band-medium-border);
}
.finance-row.finance-band-slot-2 {
  background: linear-gradient(
    90deg,
    var(--finance-band-soft-bg),
    var(--finance-band-soft-bg-soft)
  );
  border-bottom-color: var(--finance-band-soft-border);
}
.finance-row:last-child {
  border-bottom: 0;
}
.finance-row:hover {
  background-color: var(--finance-row-hover);
}
.finance-row.drop-before::before,
.finance-row.drop-after::after {
  content: '';
  position: absolute;
  left: 8px;
  right: 8px;
  height: 2px;
  background: var(--accent);
  border-radius: 999px;
  z-index: 2;
}
.finance-row.drop-before::before { top: -1px; }
.finance-row.drop-after::after { bottom: -1px; }
.finance-row.drop-inside {
  outline: 1px solid var(--accent);
  outline-offset: -3px;
  background: color-mix(in srgb, var(--accent) 12%, var(--bg-primary));
}
.finance-toggle {
  width: 22px;
  height: 22px;
  border: 0;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
}
.finance-row .finance-row-grip {
  height: 22px;
}
.finance-row .finance-icon-btn {
  min-width: 24px;
  height: 24px;
  padding: 0 6px;
}
.finance-toggle:disabled {
  cursor: default;
  opacity: 0;
}
.finance-name-cell {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.finance-depth-pad {
  flex: 0 0 auto;
}
.finance-total {
  font-size: 12px;
  font-weight: 650;
  white-space: nowrap;
  color: var(--text);
}
.finance-group-row .finance-name-input {
  font-weight: 700;
}
.finance-group-row .finance-total {
  color: var(--finance-band-strong-color);
  font-weight: 780;
}
.finance-group-row[data-depth="0"] .finance-name-input {
  font-size: 13px;
}
.finance-day-field {
  display: grid;
  grid-template-columns: minmax(44px, 1fr) auto;
  align-items: center;
  gap: 4px;
}
.finance-day-field .finance-date-input {
  text-align: right;
}
.finance-day-suffix {
  color: var(--text-muted);
  font-size: 12px;
}
.finance-empty {
  padding: 28px;
  text-align: center;
  color: var(--text-muted);
  border: 1px dashed var(--border);
  border-radius: 8px;
}
.finance-drag-ghost {
  position: fixed;
  z-index: 10000;
  pointer-events: none;
  opacity: 0.92;
  background: var(--bg-secondary);
  border: 1px solid var(--accent);
  border-radius: 7px;
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.35);
}
.finance-plan-placeholder {
  min-height: 42px;
  border: 1px dashed var(--accent);
  border-radius: 7px;
  margin: 0 0 2px;
}
.finance-settings-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: min(520px, 74vw);
}
.finance-settings-grid {
  display: grid;
  grid-template-columns: 1fr 92px;
  gap: 10px;
  align-items: center;
}
.finance-settings-label {
  color: var(--text);
  font-size: 12px;
}
.finance-settings-help {
  color: var(--text-muted);
  font-size: 11px;
  line-height: 1.4;
}
.finance-color-input {
  width: 100%;
  height: 30px;
  padding: 0;
}
.finance-settings-preview {
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
  background: var(--bg-primary);
}
.finance-preview-row {
  display: grid;
  grid-template-columns: minmax(180px, 1fr) 112px;
  align-items: center;
  min-height: 30px;
  padding: 0 10px;
  border-bottom: 1px solid color-mix(in srgb, var(--border) 72%, transparent);
  font-size: 12px;
}
.finance-preview-row:last-child {
  border-bottom: 0;
}
.finance-preview-row.finance-band-slot-0 {
  background: linear-gradient(
    90deg,
    var(--finance-band-strong-bg),
    var(--finance-band-strong-bg-soft)
  );
}
.finance-preview-row.finance-band-slot-1 {
  background: linear-gradient(
    90deg,
    var(--finance-band-medium-bg),
    var(--finance-band-medium-bg-soft)
  );
}
.finance-preview-row.finance-band-slot-2 {
  background: linear-gradient(
    90deg,
    var(--finance-band-soft-bg),
    var(--finance-band-soft-bg-soft)
  );
}
.finance-preview-total {
  text-align: right;
  font-variant-numeric: tabular-nums;
  font-weight: 700;
}
.finance-calendar-tree {
  min-width: 820px;
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
  background: var(--bg-primary);
}
.finance-calendar-head,
.finance-calendar-row {
  display: grid;
  align-items: stretch;
}
.finance-calendar-head {
  min-height: 32px;
  color: var(--text-muted);
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border);
  font-size: 11px;
  text-transform: uppercase;
}
.finance-calendar-row {
  min-height: 32px;
  border-bottom: 1px solid color-mix(in srgb, var(--border) 72%, transparent);
}
.finance-calendar-row:last-child {
  border-bottom: 0;
}
.finance-calendar-row.finance-band-slot-0 {
  background: linear-gradient(90deg, var(--finance-band-strong-bg), var(--finance-band-strong-bg-soft));
  border-bottom-color: var(--finance-band-strong-border);
}
.finance-calendar-row.finance-band-slot-1 {
  background: linear-gradient(90deg, var(--finance-band-medium-bg), var(--finance-band-medium-bg-soft));
  border-bottom-color: var(--finance-band-medium-border);
}
.finance-calendar-row.finance-band-slot-2 {
  background: linear-gradient(90deg, var(--finance-band-soft-bg), var(--finance-band-soft-bg-soft));
  border-bottom-color: var(--finance-band-soft-border);
}
.finance-calendar-head > div,
.finance-calendar-row > div {
  min-width: 0;
  padding: 4px 6px;
  border-right: 1px solid color-mix(in srgb, var(--border) 68%, transparent);
}
.finance-calendar-head > div:last-child,
.finance-calendar-row > div:last-child {
  border-right: 0;
}
.finance-calendar-name {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.finance-calendar-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  font-weight: 650;
}
.finance-calendar-terminal .finance-calendar-label {
  font-weight: 500;
}
.finance-calendar-date {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.finance-calendar-terminal .finance-calendar-date {
  color: var(--text);
}
.finance-payment-cell {
  display: grid;
  grid-template-columns: 18px minmax(58px, 1fr);
  align-items: center;
  gap: 5px;
}
.finance-payment-cell input[type="checkbox"] {
  width: 14px;
  height: 14px;
  margin: 0;
}
.finance-payment-amount {
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  height: 23px;
  border: 1px solid transparent;
  border-radius: 5px;
  background: rgba(13, 17, 23, 0.16);
  color: var(--text);
  padding: 1px 5px;
  font-size: 12px;
  text-align: right;
}
.finance-payment-amount:focus {
  outline: none;
  border-color: var(--accent);
  background: rgba(13, 17, 23, 0.36);
}
.finance-calendar-total {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  font-size: 12px;
  font-weight: 760;
  font-variant-numeric: tabular-nums;
  color: var(--text);
}
`;
  document.head.appendChild(style);
}

function normalizeId(value) {
  return value == null ? null : Number(value);
}

function planId(plan) {
  return normalizeId(plan?.id);
}

function itemId(item) {
  return normalizeId(item?.id);
}

function transactionId(transaction) {
  return normalizeId(transaction?.id);
}

function allocationId(allocation) {
  return normalizeId(allocation?.id);
}

function ruleId(rule) {
  return normalizeId(rule?.id);
}

function currencyOfActivePlan() {
  return state.plans.find((plan) => planId(plan) === state.activePlanId)?.currency || 'RUB';
}

function activePlan() {
  return state.plans.find((plan) => planId(plan) === state.activePlanId) || null;
}

function activePlanKind() {
  const kind = state.plans.find((plan) => planId(plan) === state.activePlanId)?.kind;
  return PLAN_KIND_LABELS[kind] ? kind : 'monthly';
}

function planKindLabel(kind) {
  return PLAN_KIND_LABELS[kind] || PLAN_KIND_LABELS.monthly;
}

function planName(id) {
  const normalized = normalizeId(id);
  return state.plans.find((plan) => planId(plan) === normalized)?.name || 'Unmapped';
}

function itemName(id) {
  const normalized = normalizeId(id);
  return (state.allItems || state.items).find((item) => itemId(item) === normalized)?.name || '';
}

function allocationMap() {
  const map = new Map();
  for (const allocation of state.allocations || []) {
    if (allocation?.is_active === false || allocation?.is_deleted === true) continue;
    const txId = normalizeId(allocation.transaction_id);
    if (txId != null && !map.has(txId)) map.set(txId, allocation);
  }
  return map;
}

function transactionMatchesDateFilter(transaction) {
  const date = String(transaction?.payment_date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return state.factsDateMode === 'all';
  if (state.factsDateMode === 'date') {
    return !state.factsDate || date === state.factsDate;
  }
  if (state.factsDateMode === 'range') {
    if (state.factsDateFrom && date < state.factsDateFrom) return false;
    if (state.factsDateTo && date > state.factsDateTo) return false;
    return true;
  }
  if (state.factsDateMode === 'month') {
    return !state.factsMonth || date.startsWith(`${state.factsMonth}-`);
  }
  if (state.factsDateMode === 'year') {
    return !state.factsYear || date.startsWith(`${state.factsYear}-`);
  }
  return true;
}

function factRows({ applyDateFilter = true } = {}) {
  const allocations = allocationMap();
  let rows = (state.transactions || []).map((transaction) => ({
    transaction,
    allocation: allocations.get(transactionId(transaction)) || null,
  }));
  if (state.factsFilter === 'unmapped') rows = rows.filter((row) => !row.allocation);
  if (state.factsFilter === 'locked') rows = rows.filter((row) => Boolean(row.transaction.rules_locked));
  if (applyDateFilter) rows = rows.filter((row) => transactionMatchesDateFilter(row.transaction));
  return rows.sort((a, b) =>
    String(b.transaction.payment_date || '').localeCompare(String(a.transaction.payment_date || ''))
    || String(b.transaction.operation_at || '').localeCompare(String(a.transaction.operation_at || ''))
    || transactionId(b.transaction) - transactionId(a.transaction)
  );
}

function factsDateFilterLabel() {
  if (state.factsDateMode === 'date') return state.factsDate ? formatFactDate(state.factsDate) : 'Exact date';
  if (state.factsDateMode === 'range') {
    const from = state.factsDateFrom ? formatFactDate(state.factsDateFrom) : 'start';
    const to = state.factsDateTo ? formatFactDate(state.factsDateTo) : 'end';
    return `${from} - ${to}`;
  }
  if (state.factsDateMode === 'month') return state.factsMonth || 'Month';
  if (state.factsDateMode === 'year') return state.factsYear || 'Year';
  return 'All dates';
}

function formatFactDate(value) {
  const text = String(value || '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const [year, month, day] = text.split('-');
    return `${day}.${month}.${year}`;
  }
  return text;
}

function parseRuleConditions(rule) {
  try {
    const parsed = JSON.parse(rule?.conditions_json || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function describeRuleConditions(rule) {
  const conditions = parseRuleConditions(rule);
  if (!conditions.length) return 'Any transaction';
  return conditions.map((condition) => {
    const field = String(condition.field || '').replace(/_/g, ' ');
    const op = String(condition.op || 'contains');
    const value = String(condition.value ?? '').trim();
    return `${field} ${op} ${value}`.trim();
  }).join(rule.match_mode === 'any' ? ' OR ' : ' AND ');
}

function makeRuleConditionsFromForm(body) {
  const conditions = [];
  const category = body.querySelector('[data-rule-field="category"]')?.value.trim();
  const description = body.querySelector('[data-rule-field="description"]')?.value.trim();
  const mcc = body.querySelector('[data-rule-field="mcc"]')?.value.trim();
  const direction = body.querySelector('[data-rule-field="direction"]')?.value;
  const minAmount = parseMoneyToSignedCents(body.querySelector('[data-rule-field="min-amount"]')?.value);
  const maxAmount = parseMoneyToSignedCents(body.querySelector('[data-rule-field="max-amount"]')?.value);
  if (category) conditions.push({ field: 'bank_category', op: 'contains', value: category });
  if (description) conditions.push({ field: 'description', op: 'contains', value: description });
  if (mcc) conditions.push({ field: 'mcc', op: 'equals', value: mcc });
  if (direction && direction !== 'any') conditions.push({ field: 'direction', op: 'exact', value: direction });
  if (minAmount != null) conditions.push({ field: 'amount_cents', op: 'gte', value: String(minAmount / 100) });
  if (maxAmount != null) conditions.push({ field: 'amount_cents', op: 'lte', value: String(maxAmount / 100) });
  return JSON.stringify(conditions);
}

function normalizeHexColor(value, fallback) {
  const text = String(value || '').trim();
  return /^#[0-9a-f]{6}$/i.test(text) ? text : fallback;
}

function normalizeFillOrder(value) {
  const text = String(value || '').trim();
  return FINANCE_FILL_ORDERS.has(text) ? text : DEFAULT_FINANCE_DISPLAY.fillOrder;
}

function normalizeFinanceDisplaySettings(raw = {}) {
  return {
    strongColor: normalizeHexColor(raw.strongColor, DEFAULT_FINANCE_DISPLAY.strongColor),
    mediumColor: normalizeHexColor(raw.mediumColor, DEFAULT_FINANCE_DISPLAY.mediumColor),
    softColor: normalizeHexColor(raw.softColor, DEFAULT_FINANCE_DISPLAY.softColor),
    fillOrder: normalizeFillOrder(raw.fillOrder),
  };
}

function rgbFromHex(hex) {
  const normalized = normalizeHexColor(hex, '#000000').slice(1);
  return {
    r: parseInt(normalized.slice(0, 2), 16),
    g: parseInt(normalized.slice(2, 4), 16),
    b: parseInt(normalized.slice(4, 6), 16),
  };
}

function hslFromHex(hex) {
  const { r, g, b } = rgbFromHex(hex);
  const r1 = r / 255;
  const g1 = g / 255;
  const b1 = b / 255;
  const max = Math.max(r1, g1, b1);
  const min = Math.min(r1, g1, b1);
  const lightness = (max + min) / 2;
  let hue = 0;
  let saturation = 0;
  if (max !== min) {
    const delta = max - min;
    saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
    if (max === r1) hue = (g1 - b1) / delta + (g1 < b1 ? 6 : 0);
    else if (max === g1) hue = (b1 - r1) / delta + 2;
    else hue = (r1 - g1) / delta + 4;
    hue *= 60;
  }
  return {
    h: Math.round(hue),
    s: Math.round(saturation * 100),
    l: Math.round(lightness * 100),
  };
}

function hslTintFromHex(hex, lightness, saturationScale = 0.9) {
  const { h, s } = hslFromHex(hex);
  const saturation = Math.max(36, Math.min(88, Math.round(s * saturationScale)));
  return `hsl(${h} ${saturation}% ${lightness}%)`;
}

async function loadFinanceDisplaySettings() {
  try {
    const [strongColor, mediumColor, softColor, fillOrder] = await Promise.all([
      call('get_setting', { key: FINANCE_DISPLAY_SETTINGS.strongColor }),
      call('get_setting', { key: FINANCE_DISPLAY_SETTINGS.mediumColor }),
      call('get_setting', { key: FINANCE_DISPLAY_SETTINGS.softColor }),
      call('get_setting', { key: FINANCE_DISPLAY_SETTINGS.fillOrder }),
    ]);
    state.display = normalizeFinanceDisplaySettings({
      strongColor,
      mediumColor,
      softColor,
      fillOrder,
    });
  } catch {
    state.display = { ...DEFAULT_FINANCE_DISPLAY };
  }
  applyFinanceDisplaySettings();
}

function applySettingsToElement(el, settings) {
  if (!el) return;
  el.style.setProperty('--finance-band-strong-color', settings.strongColor);
  el.style.setProperty('--finance-band-medium-color', settings.mediumColor);
  el.style.setProperty('--finance-band-soft-color', settings.softColor);
  el.style.setProperty('--finance-band-strong-bg', hslTintFromHex(settings.strongColor, 24));
  el.style.setProperty('--finance-band-strong-bg-soft', hslTintFromHex(settings.strongColor, 17, 0.75));
  el.style.setProperty('--finance-band-strong-border', hslTintFromHex(settings.strongColor, 42));
  el.style.setProperty('--finance-band-medium-bg', hslTintFromHex(settings.mediumColor, 21));
  el.style.setProperty('--finance-band-medium-bg-soft', hslTintFromHex(settings.mediumColor, 15, 0.75));
  el.style.setProperty('--finance-band-medium-border', hslTintFromHex(settings.mediumColor, 36));
  el.style.setProperty('--finance-band-soft-bg', hslTintFromHex(settings.softColor, 18));
  el.style.setProperty('--finance-band-soft-bg-soft', hslTintFromHex(settings.softColor, 13, 0.75));
  el.style.setProperty('--finance-band-soft-border', hslTintFromHex(settings.softColor, 30));
}

function applyFinanceDisplaySettings(settings = state.display) {
  applySettingsToElement(rootEl, settings);
}

function bandSlotForDepth(depth, maxDepth, display = state.display) {
  if (!Number.isFinite(depth) || !Number.isFinite(maxDepth) || maxDepth <= 0) return null;
  if (depth >= maxDepth) return null;
  if (display.fillOrder === 'soft_first') {
    const levelsAboveNeutral = maxDepth - depth;
    if (levelsAboveNeutral >= 3) return 0;
    if (levelsAboveNeutral === 2) return 1;
    return 2;
  }
  return Math.min(2, depth);
}

function formatMoney(amountCents, currency = 'RUB') {
  const amount = (Number(amountCents) || 0) / 100;
  try {
    return new Intl.NumberFormat('ru-RU', {
      style: 'currency',
      currency: currency || 'RUB',
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${amount.toLocaleString('ru-RU')} ${currency || ''}`.trim();
  }
}

function parseMoneyToCents(value) {
  const input = String(value || '').trim();
  if (input.includes('-')) return null;
  const raw = input
    .replace(/\s+/g, '')
    .replace(',', '.')
    .replace(/[^\d.]/g, '');
  if (!raw) return 0;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(parsed * 100);
}

function parseMoneyToSignedCents(value) {
  const input = String(value || '').trim();
  if (!input) return null;
  const sign = input.startsWith('-') ? -1 : 1;
  const raw = input
    .replace(/\s+/g, '')
    .replace(',', '.')
    .replace(/[^\d.]/g, '');
  if (!raw) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return null;
  return Math.round(parsed * 100) * sign;
}

function amountInputValue(amountCents) {
  const amount = (Number(amountCents) || 0) / 100;
  return amount ? String(amount).replace('.', ',') : '';
}

function monthKeyFromDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

function currentMonthKey() {
  return monthKeyFromDate(new Date());
}

function addMonths(monthKey, delta) {
  const [year, month] = String(monthKey || currentMonthKey()).split('-').map(Number);
  const date = new Date(Number.isFinite(year) ? year : new Date().getFullYear(), (Number.isFinite(month) ? month : 1) - 1 + delta, 1);
  return monthKeyFromDate(date);
}

function monthLabel(monthKey) {
  const [year, month] = String(monthKey || currentMonthKey()).split('-').map(Number);
  const date = new Date(year || new Date().getFullYear(), (month || 1) - 1, 1);
  try {
    const label = new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric' }).format(date);
    return label.charAt(0).toUpperCase() + label.slice(1);
  } catch {
    return monthKey;
  }
}

function calendarMonthsStorageKey(plan = activePlan()) {
  const stableId = plan?.uuid || state.activePlanId || 'default';
  return `${CALENDAR_MONTHS_KEY_PREFIX}${stableId}`;
}

function loadStoredCalendarMonths(plan = activePlan()) {
  try {
    const parsed = JSON.parse(localStorage.getItem(calendarMonthsStorageKey(plan)) || '[]');
    return Array.isArray(parsed)
      ? parsed.filter((value) => /^\d{4}-\d{2}$/.test(String(value)))
      : [];
  } catch {
    return [];
  }
}

function saveStoredCalendarMonths(months, plan = activePlan()) {
  const unique = [...new Set(months)].sort();
  localStorage.setItem(calendarMonthsStorageKey(plan), JSON.stringify(unique));
}

function loadCalendarUiState() {
  state.calendarShowOldMonths = localStorage.getItem(CALENDAR_SHOW_OLD_KEY) === '1';
}

function saveCalendarShowOldMonths() {
  localStorage.setItem(CALENDAR_SHOW_OLD_KEY, state.calendarShowOldMonths ? '1' : '0');
}

function dateInputValue(value) {
  const text = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
}

function parseDueDay(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (!/^\d{1,2}$/.test(raw)) return undefined;
  const day = Number(raw);
  if (!Number.isInteger(day) || day < 1 || day > 31) return undefined;
  return day;
}

function loadCollapsed() {
  try {
    const raw = localStorage.getItem(COLLAPSE_KEY);
    const values = raw ? JSON.parse(raw) : [];
    state.collapsed = new Set(values.map(Number).filter(Number.isFinite));
  } catch {
    state.collapsed = new Set();
  }
}

function saveCollapsed() {
  localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...state.collapsed]));
}

function buildTree(items) {
  const byId = new Map();
  const children = new Map();
  for (const item of items) {
    const id = itemId(item);
    if (id == null) continue;
    byId.set(id, item);
    children.set(id, []);
  }
  const roots = [];
  for (const item of items) {
    const parent = normalizeId(item.parent_id);
    if (parent != null && byId.has(parent)) {
      children.get(parent).push(item);
    } else {
      roots.push(item);
    }
  }
  const sortItems = (a, b) =>
    (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0)
    || String(a.name || '').localeCompare(String(b.name || ''))
    || itemId(a) - itemId(b);
  roots.sort(sortItems);
  for (const list of children.values()) list.sort(sortItems);
  return { roots, children };
}

function computeTotals(roots, children) {
  const totals = new Map();
  function visit(item) {
    const id = itemId(item);
    let total = Number(item.amount_cents) || 0;
    for (const child of children.get(id) || []) total += visit(child);
    totals.set(id, total);
    return total;
  }
  let grandTotal = 0;
  for (const root of roots) grandTotal += visit(root);
  return { totals, grandTotal };
}

function flattenVisible(roots, children) {
  const rows = [];
  function visit(item, depth) {
    const id = itemId(item);
    rows.push({ item, depth });
    if (state.collapsed.has(id)) return;
    for (const child of children.get(id) || []) visit(child, depth + 1);
  }
  for (const root of roots) visit(root, 0);
  return rows;
}

function maxTreeDepth(roots, children) {
  let maxDepth = 0;
  function visit(item, depth, stack = new Set()) {
    const id = itemId(item);
    if (id == null || stack.has(id)) return;
    maxDepth = Math.max(maxDepth, depth);
    const nextStack = new Set(stack);
    nextStack.add(id);
    for (const child of children.get(id) || []) visit(child, depth + 1, nextStack);
  }
  for (const root of roots) visit(root, 0);
  return maxDepth;
}

function isDescendant(sourceId, possibleDescendantId) {
  let current = state.items.find((item) => itemId(item) === possibleDescendantId);
  const seen = new Set();
  while (current) {
    const parentId = normalizeId(current.parent_id);
    if (parentId == null) return false;
    if (parentId === sourceId) return true;
    if (seen.has(parentId)) return false;
    seen.add(parentId);
    current = state.items.find((item) => itemId(item) === parentId);
  }
  return false;
}

async function loadAll(selectPlanId = state.activePlanId) {
  state.plans = await call('list_finance_plans');
  if (!state.plans.length) {
    const created = await call('create_finance_plan', {
      name: 'Regular payments',
      currency: 'RUB',
      kind: 'monthly',
    });
    state.plans = [created];
  }
  const wanted = normalizeId(selectPlanId);
  state.activePlanId = state.plans.some((plan) => planId(plan) === wanted)
    ? wanted
    : planId(state.plans[0]);
  const allItemLists = await Promise.all(
    state.plans.map((plan) => call('list_finance_items', { planId: planId(plan) }))
  );
  state.allItems = allItemLists.flat();
  state.items = state.allItems.filter((item) => normalizeId(item.plan_id) === state.activePlanId);
  [state.payments, state.transactions, state.allocations, state.mappingRules] = await Promise.all([
    call('list_finance_payments', { planId: state.activePlanId }),
    call('list_finance_transactions', { planId: null, unmappedOnly: false }),
    call('list_finance_transaction_allocations', { planId: null }),
    call('list_finance_mapping_rules'),
  ]);
  if (activePlanKind() !== 'monthly') state.activeView = 'structure';
  render();
}

function installFinanceViewHistoryListener() {
  if (financeViewHistoryListenerInstalled) return;
  financeViewHistoryListenerInstalled = true;
  window.addEventListener('view-history:open', (event) => {
    openFinanceViewTarget(event.detail || {}).catch((err) => {
      showToast(`Failed to open finance list: ${err}`, 'error');
    });
  });
}

async function openFinanceViewTarget(detail) {
  const moduleId = detail.moduleId || '';
  const objectType = detail.objectType || detail.type || '';
  if (moduleId && moduleId !== 'finance') return;
  if (objectType && objectType !== 'finance_plan' && objectType !== 'finance') return;

  let targetId = normalizeId(detail.objectId ?? detail.id);
  if (targetId == null && detail.objectUuid) {
    const plans = state.plans.length ? state.plans : await call('list_finance_plans');
    const matched = plans.find((plan) => plan.uuid === detail.objectUuid);
    targetId = planId(matched);
  }
  if (targetId != null) await loadAll(targetId);
}

function render() {
  if (!rootEl) return;
  rootEl.innerHTML = '';
  rootEl.classList.add('finance-tab');
  applyFinanceDisplaySettings();

  const shell = document.createElement('div');
  shell.className = 'finance-shell';
  shell.appendChild(state.activeMode === 'facts' ? renderFactsSidebar() : renderSidebar());
  shell.appendChild(renderMain());
  rootEl.appendChild(shell);
}

function renderSidebar() {
  const sidebar = document.createElement('aside');
  sidebar.className = 'finance-sidebar';

  const header = document.createElement('div');
  header.className = 'finance-side-header';
  const title = document.createElement('div');
  title.className = 'finance-title';
  title.textContent = 'Finance';
  const actions = document.createElement('div');
  actions.className = 'finance-side-actions';
  const addBtn = document.createElement('button');
  addBtn.className = 'finance-icon-btn';
  addBtn.type = 'button';
  addBtn.title = 'New list';
  addBtn.textContent = '+';
  addBtn.addEventListener('click', createPlan);
  actions.appendChild(addBtn);
  header.append(title, actions);
  sidebar.appendChild(header);

  const list = document.createElement('div');
  list.className = 'finance-plan-list';
  for (const plan of state.plans) {
    list.appendChild(renderPlanCard(plan));
  }
  sidebar.appendChild(list);
  return sidebar;
}

function renderFactsSidebar() {
  const sidebar = document.createElement('aside');
  sidebar.className = 'finance-sidebar finance-facts-sidebar';

  const header = document.createElement('div');
  header.className = 'finance-side-header';
  const titleWrap = document.createElement('div');
  const title = document.createElement('div');
  title.className = 'finance-title';
  title.textContent = 'Facts';
  const subtitle = document.createElement('div');
  subtitle.className = 'finance-facts-kicker';
  subtitle.textContent = 'Date filters';
  titleWrap.append(title, subtitle);
  const resetBtn = document.createElement('button');
  resetBtn.className = 'finance-small-btn';
  resetBtn.type = 'button';
  resetBtn.textContent = 'Reset';
  resetBtn.addEventListener('click', () => {
    state.factsDateMode = 'all';
    state.factsDate = '';
    state.factsDateFrom = '';
    state.factsDateTo = '';
    state.factsMonth = '';
    state.factsYear = '';
    render();
  });
  header.append(titleWrap, resetBtn);
  sidebar.appendChild(header);

  const body = document.createElement('div');
  body.className = 'finance-filter-list';

  const countSection = document.createElement('div');
  countSection.className = 'finance-filter-section';
  const visibleCount = factRows().length;
  const baseCount = factRows({ applyDateFilter: false }).length;
  const allCount = state.transactions.length;
  const count = document.createElement('div');
  count.className = 'finance-filter-count';
  const countLabel = document.createElement('span');
  countLabel.textContent = 'Visible facts';
  const countValue = document.createElement('strong');
  countValue.textContent = String(visibleCount);
  count.append(countLabel, countValue);
  const help = document.createElement('div');
  help.className = 'finance-filter-help';
  help.textContent = `${factsDateFilterLabel()} · ${baseCount} in status filter · ${allCount} total`;
  countSection.append(count, help);
  body.appendChild(countSection);

  const dateSection = document.createElement('div');
  dateSection.className = 'finance-filter-section';
  const sectionTitle = document.createElement('div');
  sectionTitle.className = 'finance-filter-title';
  sectionTitle.textContent = 'Payment date';
  dateSection.appendChild(sectionTitle);

  const modeField = document.createElement('div');
  modeField.className = 'finance-filter-field';
  const modeLabel = document.createElement('label');
  modeLabel.textContent = 'Filter';
  const modeSelect = document.createElement('select');
  [
    ['all', 'All dates'],
    ['date', 'Exact date'],
    ['range', 'Date range'],
    ['month', 'Month'],
    ['year', 'Year'],
  ].forEach(([value, label]) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    modeSelect.appendChild(option);
  });
  modeSelect.value = state.factsDateMode;
  modeSelect.addEventListener('change', () => {
    state.factsDateMode = modeSelect.value;
    render();
  });
  modeField.append(modeLabel, modeSelect);
  dateSection.appendChild(modeField);

  appendFactsDateInputs(dateSection);
  body.appendChild(dateSection);
  sidebar.appendChild(body);
  return sidebar;
}

function appendFactsDateInputs(container) {
  const addInput = (labelText, type, value, onInput) => {
    const field = document.createElement('div');
    field.className = 'finance-filter-field';
    const label = document.createElement('label');
    label.textContent = labelText;
    const input = document.createElement('input');
    input.type = type;
    input.value = value || '';
    input.addEventListener('input', () => {
      onInput(input.value);
    });
    input.addEventListener('change', () => {
      onInput(input.value);
      render();
    });
    field.append(label, input);
    container.appendChild(field);
  };

  if (state.factsDateMode === 'date') {
    addInput('Date', 'date', state.factsDate, (value) => {
      state.factsDate = value;
    });
  } else if (state.factsDateMode === 'range') {
    addInput('From', 'date', state.factsDateFrom, (value) => {
      state.factsDateFrom = value;
    });
    addInput('To', 'date', state.factsDateTo, (value) => {
      state.factsDateTo = value;
    });
  } else if (state.factsDateMode === 'month') {
    appendFactsMonthPicker(container);
  } else if (state.factsDateMode === 'year') {
    addInput('Year', 'number', state.factsYear, (value) => {
      state.factsYear = value.replace(/[^\d]/g, '').slice(0, 4);
    });
  } else {
    const help = document.createElement('div');
    help.className = 'finance-filter-help';
    help.textContent = 'Choose an exact date, range, month, or year for large bank exports.';
    container.appendChild(help);
  }
}

function appendFactsMonthPicker(container) {
  const field = document.createElement('div');
  field.className = 'finance-filter-field finance-month-picker-field';
  const label = document.createElement('label');
  label.textContent = 'Month';
  const trigger = document.createElement('button');
  trigger.className = 'finance-month-picker-trigger';
  trigger.type = 'button';
  trigger.textContent = state.factsMonth ? monthLabel(state.factsMonth) : 'Choose month';
  field.append(label, trigger);

  let openYear = Number(String(state.factsMonth || currentMonthKey()).slice(0, 4)) || new Date().getFullYear();
  const renderPicker = () => renderMonthPickerPopover(openYear, (nextYear) => {
    openYear = nextYear;
    const popover = field.querySelector('.finance-month-popover');
    if (popover) popover.replaceWith(renderPicker());
  });
  const openPicker = (event) => {
    event.preventDefault();
    event.stopPropagation();
    const existing = field.querySelector('.finance-month-popover');
    if (existing) {
      existing.remove();
      return;
    }
    field.appendChild(renderPicker());
  };
  field.addEventListener('click', openPicker);
  trigger.addEventListener('click', openPicker);
  container.appendChild(field);
}

function renderMonthPickerPopover(year, onYearChange) {
  const popover = document.createElement('div');
  popover.className = 'finance-month-popover';
  popover.addEventListener('click', (event) => event.stopPropagation());

  const head = document.createElement('div');
  head.className = 'finance-month-picker-head';
  const prev = document.createElement('button');
  prev.className = 'finance-icon-btn';
  prev.type = 'button';
  prev.textContent = '‹';
  prev.addEventListener('click', () => onYearChange(year - 1));
  const title = document.createElement('strong');
  title.textContent = String(year);
  const next = document.createElement('button');
  next.className = 'finance-icon-btn';
  next.type = 'button';
  next.textContent = '›';
  next.addEventListener('click', () => onYearChange(year + 1));
  head.append(prev, title, next);

  const grid = document.createElement('div');
  grid.className = 'finance-month-picker-grid';
  for (let month = 1; month <= 12; month += 1) {
    const monthKey = `${year}-${String(month).padStart(2, '0')}`;
    const btn = document.createElement('button');
    btn.className = 'finance-month-option' + (state.factsMonth === monthKey ? ' active' : '');
    btn.type = 'button';
    btn.dataset.month = monthKey;
    btn.textContent = new Intl.DateTimeFormat('ru-RU', { month: 'short' }).format(new Date(year, month - 1, 1));
    btn.addEventListener('click', () => {
      state.factsMonth = monthKey;
      render();
    });
    grid.appendChild(btn);
  }
  popover.append(head, grid);
  return popover;
}

function renderPlanCard(plan) {
  const id = planId(plan);
  const card = document.createElement('div');
  card.className = 'finance-plan-card'
    + (state.activeMode === 'lists' && id === state.activePlanId ? ' active' : '')
    + (state.activeMode === 'facts' ? ' dimmed' : '');
  card.dataset.id = String(id);

  const grip = document.createElement('button');
  grip.className = 'finance-plan-grip';
  grip.type = 'button';
  grip.title = 'Drag plan';
  grip.textContent = '::';
  grip.addEventListener('pointerdown', (event) => startPlanDrag(event, card));

  const name = document.createElement('div');
  name.className = 'finance-plan-name';
  name.textContent = plan.name || 'Untitled list';

  const meta = document.createElement('div');
  meta.className = 'finance-plan-meta';
  const kind = document.createElement('div');
  kind.className = 'finance-plan-kind';
  kind.textContent = planKindLabel(plan.kind);
  const currency = document.createElement('div');
  currency.className = 'finance-plan-currency';
  currency.textContent = plan.currency || 'RUB';
  meta.append(kind, currency);

  card.addEventListener('click', async (event) => {
    if (event.target.closest('.finance-plan-grip')) return;
    if (id === state.activePlanId) return;
    try {
      await saveActivePlanHeaderFromDom();
    } catch {
      return;
    }
    state.activeMode = 'lists';
    await loadAll(id);
  });

  card.append(grip, name, meta);
  return card;
}

function renderMain() {
  const main = document.createElement('main');
  main.className = 'finance-main';
  const activePlan = state.plans.find((plan) => planId(plan) === state.activePlanId) || null;

  main.appendChild(renderFinanceModeBar());
  if (state.activeMode === 'facts') {
    main.appendChild(renderFactsHeader());
    main.appendChild(renderFactsSummary());
    main.appendChild(renderFactsTable());
    return main;
  }

  main.appendChild(renderMainHeader(activePlan));

  if (!activePlan) {
    const empty = document.createElement('div');
    empty.className = 'finance-empty';
    empty.textContent = 'Create a finance list to start planning.';
    main.appendChild(empty);
    return main;
  }

  const { roots, children } = buildTree(state.items);
  const { totals, grandTotal } = computeTotals(roots, children);
  main.appendChild(renderSummary(grandTotal, activePlan.currency || 'RUB'));
  if (activePlanKind() === 'monthly') {
    main.appendChild(renderFinanceViewBar());
  } else {
    state.activeView = 'structure';
  }
  main.appendChild(
    state.activeView === 'calendar'
      ? renderPaymentCalendar(roots, children, activePlan)
      : renderTree(roots, children, totals)
  );
  return main;
}

function renderFinanceModeBar() {
  const bar = document.createElement('div');
  bar.className = 'finance-mode-bar';
  const segment = document.createElement('div');
  segment.className = 'finance-segment';
  [
    ['lists', 'Lists'],
    ['facts', 'Facts'],
  ].forEach(([mode, label]) => {
    const btn = document.createElement('button');
    btn.className = 'finance-segment-btn' + (state.activeMode === mode ? ' active' : '');
    btn.type = 'button';
    btn.textContent = label;
    btn.addEventListener('click', async () => {
      if (state.activeMode === mode) return;
      try {
        await saveActivePlanHeaderFromDom();
      } catch {
        return;
      }
      state.activeMode = mode;
      render();
    });
    segment.appendChild(btn);
  });
  const hint = document.createElement('div');
  hint.className = 'finance-calendar-status';
  hint.textContent = state.activeMode === 'facts'
    ? 'Imported bank operations and rule mapping'
    : 'Plans, structure, and payment calendar';
  bar.append(segment, hint);
  return bar;
}

function renderMainHeader(plan) {
  const header = document.createElement('div');
  header.className = 'finance-main-header';

  if (!plan) {
    const title = document.createElement('div');
    title.className = 'finance-title';
    title.textContent = 'Finance list';
    header.appendChild(title);
    return header;
  }
  header.classList.add('finance-main-header-plan');

  const edit = document.createElement('div');
  edit.className = 'finance-plan-edit';
  const nameInput = document.createElement('input');
  nameInput.className = 'finance-input finance-name-input';
  nameInput.dataset.planField = 'name';
  nameInput.value = plan.name || '';
  nameInput.placeholder = 'Plan name';
  const currencyInput = document.createElement('input');
  currencyInput.className = 'finance-input';
  currencyInput.dataset.planField = 'currency';
  currencyInput.value = plan.currency || 'RUB';
  currencyInput.maxLength = 6;
  currencyInput.placeholder = 'RUB';
  const kindSelect = document.createElement('select');
  kindSelect.className = 'finance-select';
  kindSelect.dataset.planField = 'kind';
  for (const option of PLAN_KINDS) {
    const el = document.createElement('option');
    el.value = option.value;
    el.textContent = option.label;
    kindSelect.appendChild(el);
  }
  kindSelect.value = PLAN_KIND_LABELS[plan.kind] ? plan.kind : 'monthly';
  const saveStatus = document.createElement('div');
  saveStatus.className = 'finance-autosave-status';
  saveStatus.dataset.financeAutosaveStatus = 'true';
  saveStatus.textContent = 'Saved';

  const bindHeaderTextSave = (input) => {
    input.addEventListener('input', () => {
      if (input === currencyInput) input.value = input.value.toUpperCase();
      scheduleActivePlanHeaderSave();
    });
    input.addEventListener('change', () => commitActivePlanHeader().catch(() => {}));
    input.addEventListener('blur', () => commitActivePlanHeader().catch(() => {}));
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        input.blur();
      }
    });
  };
  bindHeaderTextSave(nameInput);
  bindHeaderTextSave(currencyInput);
  kindSelect.addEventListener('change', () => commitActivePlanHeader({ reloadAfter: true }).catch(() => {}));

  edit.append(nameInput, currencyInput, kindSelect, saveStatus);

  const actions = document.createElement('div');
  actions.className = 'finance-header-actions';
  const settingsBtn = document.createElement('button');
  settingsBtn.className = 'finance-small-btn';
  settingsBtn.type = 'button';
  settingsBtn.title = 'Finance display settings';
  settingsBtn.textContent = '⚙';
  settingsBtn.addEventListener('click', openFinanceDisplaySettings);
  const shareBtn = document.createElement('button');
  shareBtn.className = 'finance-small-btn';
  shareBtn.type = 'button';
  shareBtn.title = 'Share public link';
  shareBtn.textContent = '🔗';
  shareBtn.addEventListener('click', () => shareActivePlan(plan));
  const addRow = document.createElement('button');
  addRow.className = 'finance-small-btn finance-primary-btn';
  addRow.type = 'button';
  addRow.textContent = '+ Row';
  addRow.addEventListener('click', () => createItem(null));
  const delPlan = document.createElement('button');
  delPlan.className = 'finance-small-btn';
  delPlan.type = 'button';
  delPlan.title = 'Delete finance list';
  delPlan.textContent = '🗑';
  delPlan.addEventListener('click', deleteActivePlan);
  actions.append(settingsBtn, shareBtn, addRow, delPlan);

  header.append(edit, actions);
  return header;
}

async function saveActivePlanHeaderFromDom() {
  if (!state.activePlanId || !rootEl) return null;
  if (!rootEl.querySelector('[data-plan-field="name"]')) {
    return state.plans.find((item) => planId(item) === state.activePlanId) || null;
  }
  clearFinanceHeaderSaveTimer();
  const draft = readActivePlanHeaderDraft();
  const plan = state.plans.find((item) => planId(item) === state.activePlanId) || {};
  if (
    String(plan.name || '') === draft.name
    && String(plan.currency || 'RUB') === draft.currency
    && (PLAN_KIND_LABELS[plan.kind] ? plan.kind : 'monthly') === draft.kind
  ) {
    setFinanceAutosaveStatus('saved');
    return { ...plan, ...draft };
  }
  setFinanceAutosaveStatus('saving');
  try {
    await call('update_finance_plan', {
      id: state.activePlanId,
      name: draft.name,
      currency: draft.currency,
      kind: draft.kind,
    });
  } catch (err) {
    setFinanceAutosaveStatus('failed');
    throw err;
  }
  const saved = { ...plan, ...draft };
  updateActivePlanLocal(saved);
  setFinanceAutosaveStatus('saved');
  return saved;
}

function clearFinanceHeaderSaveTimer() {
  if (state.headerSaveTimer) {
    clearTimeout(state.headerSaveTimer);
    state.headerSaveTimer = null;
  }
}

function setFinanceAutosaveStatus(status) {
  const el = rootEl?.querySelector('[data-finance-autosave-status]');
  if (!el) return;
  el.classList.toggle('saving', status === 'saving');
  el.classList.toggle('failed', status === 'failed');
  if (status === 'saving') el.textContent = 'Saving...';
  else if (status === 'failed') el.textContent = 'Failed';
  else if (status === 'editing') el.textContent = 'Editing';
  else el.textContent = 'Saved';
}

function readActivePlanHeaderDraft() {
  const nameInput = rootEl.querySelector('[data-plan-field="name"]');
  const currencyInput = rootEl.querySelector('[data-plan-field="currency"]');
  const kindSelect = rootEl.querySelector('[data-plan-field="kind"]');
  const name = nameInput?.value.trim() || 'Untitled list';
  const currency = currencyInput?.value.trim().toUpperCase() || 'RUB';
  const kind = kindSelect?.value || activePlanKind();
  return { name, currency, kind };
}

function updateActivePlanLocal(plan) {
  state.plans = state.plans.map((item) => (
    planId(item) === state.activePlanId ? { ...item, ...plan } : item
  ));
  const card = rootEl?.querySelector(`.finance-plan-card[data-id="${state.activePlanId}"]`);
  card?.querySelector('.finance-plan-name')?.replaceChildren(document.createTextNode(plan.name || 'Untitled list'));
  const currency = card?.querySelector('.finance-plan-currency');
  if (currency) currency.textContent = plan.currency || 'RUB';
  const kind = card?.querySelector('.finance-plan-kind');
  if (kind) kind.textContent = planKindLabel(plan.kind);
}

function scheduleActivePlanHeaderSave() {
  clearFinanceHeaderSaveTimer();
  setFinanceAutosaveStatus('editing');
  state.headerSaveTimer = setTimeout(async () => {
    try {
      await saveActivePlanHeaderFromDom();
    } catch (err) {
      setFinanceAutosaveStatus('failed');
      showToast(`Failed to save list: ${err}`, 'error');
    }
  }, FINANCE_HEADER_AUTOSAVE_DELAY_MS);
}

async function commitActivePlanHeader({ reloadAfter = false } = {}) {
  try {
    await saveActivePlanHeaderFromDom();
    if (reloadAfter) await loadAll(state.activePlanId);
  } catch (err) {
    setFinanceAutosaveStatus('failed');
    showToast(`Failed to save list: ${err}`, 'error');
    throw err;
  }
}

function financeDisplaySettingsFromModal(body) {
  return normalizeFinanceDisplaySettings({
    strongColor: body.querySelector('[data-finance-setting="strong-color"]')?.value,
    mediumColor: body.querySelector('[data-finance-setting="medium-color"]')?.value,
    softColor: body.querySelector('[data-finance-setting="soft-color"]')?.value,
    fillOrder: body.querySelector('[data-finance-setting="fill-order"]')?.value,
  });
}

function renderFinanceSettingsPreview(preview, settings) {
  if (!preview) return;
  applySettingsToElement(preview, settings);
  preview.innerHTML = '';
  const rows = [
    { depth: 0, maxDepth: 2, label: 'Housing', total: '96 500', group: true },
    { depth: 1, maxDepth: 2, label: 'Utilities', total: '14 500', group: true },
    { depth: 2, maxDepth: 2, label: 'Internet', total: '8 300', group: false },
  ];
  for (const row of rows) {
    const el = document.createElement('div');
    const classes = ['finance-preview-row'];
    const slot = bandSlotForDepth(row.depth, row.maxDepth, settings);
    if (slot != null) classes.push(`finance-band-slot-${slot}`);
    el.className = classes.join(' ');
    const name = document.createElement('div');
    name.style.paddingLeft = `${row.depth * 18}px`;
    name.style.fontWeight = row.group ? '700' : '500';
    name.textContent = row.label;
    const total = document.createElement('div');
    total.className = 'finance-preview-total';
    total.textContent = row.total;
    el.append(name, total);
    preview.appendChild(el);
  }
}

function openFinanceDisplaySettings() {
  const initial = { ...state.display };
  let draft = { ...state.display };
  const body = document.createElement('div');
  body.className = 'finance-settings-body';
  body.innerHTML = `
    <div class="finance-settings-help">
      Background fill is assigned by row depth, not by whether a row has children.
      The deepest visible level stays neutral. Strong First starts from the
      top level; Soft First assigns fills from the bottom up, so the last
      colored level is Soft.
    </div>
    <div class="finance-settings-grid">
      <label class="finance-settings-label" for="finance-band-strong">Strong fill</label>
      <input id="finance-band-strong" class="finance-color-input" data-finance-setting="strong-color" type="color" value="${draft.strongColor}">
      <label class="finance-settings-label" for="finance-band-medium">Medium fill</label>
      <input id="finance-band-medium" class="finance-color-input" data-finance-setting="medium-color" type="color" value="${draft.mediumColor}">
      <label class="finance-settings-label" for="finance-band-soft">Soft fill</label>
      <input id="finance-band-soft" class="finance-color-input" data-finance-setting="soft-color" type="color" value="${draft.softColor}">
      <label class="finance-settings-label" for="finance-band-order">Fill order</label>
      <select id="finance-band-order" data-finance-setting="fill-order">
        <option value="strong_first">Strong first</option>
        <option value="soft_first">Soft first</option>
      </select>
    </div>
    <div class="finance-settings-preview" aria-label="Finance level fill preview"></div>
  `;
  const orderSelect = body.querySelector('[data-finance-setting="fill-order"]');
  orderSelect.value = draft.fillOrder;
  const preview = body.querySelector('.finance-settings-preview');
  renderFinanceSettingsPreview(preview, draft);

  function applyDraft({ rerender = false } = {}) {
    draft = financeDisplaySettingsFromModal(body);
    state.display = { ...draft };
    applyFinanceDisplaySettings(draft);
    renderFinanceSettingsPreview(preview, draft);
    if (rerender) render();
  }

  for (const input of body.querySelectorAll('[data-finance-setting$="color"]')) {
    input.addEventListener('input', () => applyDraft());
  }
  orderSelect.addEventListener('change', () => applyDraft({ rerender: true }));

  showModal({
    title: 'Finance — display settings',
    body,
    onConfirm: async () => {
      draft = financeDisplaySettingsFromModal(body);
      await Promise.all([
        call('set_setting', { key: FINANCE_DISPLAY_SETTINGS.strongColor, value: draft.strongColor }),
        call('set_setting', { key: FINANCE_DISPLAY_SETTINGS.mediumColor, value: draft.mediumColor }),
        call('set_setting', { key: FINANCE_DISPLAY_SETTINGS.softColor, value: draft.softColor }),
        call('set_setting', { key: FINANCE_DISPLAY_SETTINGS.fillOrder, value: draft.fillOrder }),
      ]);
      state.display = { ...draft };
      applyFinanceDisplaySettings();
      render();
      showToast('Finance display settings saved', 'success');
    },
    onCancel: () => {
      state.display = { ...initial };
      applyFinanceDisplaySettings(initial);
      render();
    },
  }).catch((err) => {
    if (String(err?.message || err) !== 'cancelled') {
      showToast(`Failed to update display settings: ${err}`, 'error');
    }
  });
}

async function shareActivePlan(plan) {
  if (!plan?.uuid) {
    showToast('Sync this finance list before sharing', 'error');
    return;
  }
  try {
    const saved = await saveActivePlanHeaderFromDom();
    await call('trigger_sync');
    await loadAll(state.activePlanId);
    const active = state.plans.find((item) => planId(item) === state.activePlanId) || saved || plan;
    await openShareLinkModal({
      itemType: 'finance_plan',
      itemUuid: active.uuid || plan.uuid,
      title: active.name || plan.name || 'Finance list',
      onBeforeCreate: async () => {
        const current = await saveActivePlanHeaderFromDom();
        return {
          itemUuid: current?.uuid || active.uuid || plan.uuid,
          title: current?.name || active.name || plan.name || 'Finance list',
        };
      },
    });
  } catch (err) {
    showToast(`Failed to prepare share link: ${err}`, 'error');
  }
}

function renderSummary(total, currency) {
  const summary = document.createElement('div');
  summary.className = 'finance-summary';
  const stats = [
    ['Total', formatMoney(total, currency)],
    ['Rows', String(state.items.length)],
    ['Currency', currency || 'RUB'],
  ];
  for (const [label, value] of stats) {
    const card = document.createElement('div');
    card.className = 'finance-stat';
    const l = document.createElement('div');
    l.className = 'finance-stat-label';
    l.textContent = label;
    const v = document.createElement('div');
    v.className = 'finance-stat-value';
    v.textContent = value;
    card.append(l, v);
    summary.appendChild(card);
  }
  return summary;
}

function renderFinanceViewBar() {
  const bar = document.createElement('div');
  bar.className = 'finance-view-bar';

  const segment = document.createElement('div');
  segment.className = 'finance-segment';
  [
    ['structure', 'Structure'],
    ['calendar', 'Calendar'],
  ].forEach(([view, label]) => {
    const btn = document.createElement('button');
    btn.className = 'finance-segment-btn' + (state.activeView === view ? ' active' : '');
    btn.type = 'button';
    btn.textContent = label;
    btn.addEventListener('click', () => {
      state.activeView = view;
      render();
    });
    segment.appendChild(btn);
  });

  const actions = document.createElement('div');
  actions.className = 'finance-calendar-actions';
  if (state.activeView === 'calendar') {
    const status = document.createElement('span');
    status.className = 'finance-calendar-status';
    status.textContent = 'Payment facts';
    const oldBtn = document.createElement('button');
    oldBtn.className = 'finance-small-btn';
    oldBtn.type = 'button';
    oldBtn.title = 'Show or hide months before the current month';
    oldBtn.textContent = state.calendarShowOldMonths ? 'Hide old' : 'Show old';
    oldBtn.addEventListener('click', () => {
      state.calendarShowOldMonths = !state.calendarShowOldMonths;
      saveCalendarShowOldMonths();
      render();
    });
    const addMonthBtn = document.createElement('button');
    addMonthBtn.className = 'finance-small-btn finance-primary-btn';
    addMonthBtn.type = 'button';
    addMonthBtn.title = 'Add next month column';
    addMonthBtn.textContent = '+ Month';
    addMonthBtn.addEventListener('click', () => addCalendarMonthColumn());
    actions.append(status, oldBtn, addMonthBtn);
  }

  bar.append(segment, actions);
  return bar;
}

function renderFactsHeader() {
  const header = document.createElement('div');
  header.className = 'finance-facts-header';
  const text = document.createElement('div');
  const title = document.createElement('div');
  title.className = 'finance-title';
  title.textContent = 'Finance facts';
  const kicker = document.createElement('div');
  kicker.className = 'finance-facts-kicker';
  kicker.textContent = 'Import bank CSV files, map operations to finance lists, and lock manual assignments.';
  text.append(title, kicker);

  const actions = document.createElement('div');
  actions.className = 'finance-facts-actions';
  const filter = document.createElement('div');
  filter.className = 'finance-segment finance-facts-filter';
  [
    ['all', 'All'],
    ['unmapped', 'Unmapped'],
    ['locked', 'Locked'],
  ].forEach(([value, label]) => {
    const btn = document.createElement('button');
    btn.className = 'finance-segment-btn' + (state.factsFilter === value ? ' active' : '');
    btn.type = 'button';
    btn.textContent = label;
    btn.addEventListener('click', () => {
      state.factsFilter = value;
      render();
    });
    filter.appendChild(btn);
  });
  const importBtn = document.createElement('button');
  importBtn.className = 'finance-small-btn finance-primary-btn';
  importBtn.type = 'button';
  importBtn.textContent = 'Import CSV';
  importBtn.addEventListener('click', openFinanceImportFlow);
  const rulesBtn = document.createElement('button');
  rulesBtn.className = 'finance-small-btn';
  rulesBtn.type = 'button';
  rulesBtn.textContent = 'Rules';
  rulesBtn.addEventListener('click', openFinanceRulesModal);
  actions.append(filter, importBtn, rulesBtn);
  header.append(text, actions);
  return header;
}

function renderFactsSummary() {
  const summary = document.createElement('div');
  summary.className = 'finance-summary finance-facts-summary';
  const rows = factRows().map((row) => row.transaction);
  const allocations = allocationMap();
  const expense = rows
    .filter((row) => Number(row.amount_cents) < 0)
    .reduce((sum, row) => sum + Math.abs(Number(row.amount_cents) || 0), 0);
  const income = rows
    .filter((row) => Number(row.amount_cents) > 0)
    .reduce((sum, row) => sum + (Number(row.amount_cents) || 0), 0);
  const unmapped = rows.filter((row) => !allocations.has(transactionId(row))).length;
  [
    ['Expenses', formatMoney(expense, 'RUB')],
    ['Income / refunds', formatMoney(income, 'RUB')],
    ['Facts', String(rows.length)],
    ['Unmapped', String(unmapped)],
  ].forEach(([label, value]) => {
    const card = document.createElement('div');
    card.className = 'finance-stat';
    const l = document.createElement('div');
    l.className = 'finance-stat-label';
    l.textContent = label;
    const v = document.createElement('div');
    v.className = 'finance-stat-value';
    v.textContent = value;
    card.append(l, v);
    summary.appendChild(card);
  });
  return summary;
}

function renderFactsTable() {
  const wrap = document.createElement('div');
  wrap.className = 'finance-table-wrap';
  const rows = factRows();
  if (!rows.length) {
    const empty = document.createElement('div');
    empty.className = 'finance-empty';
    empty.textContent = state.factsFilter === 'all'
      ? 'No imported bank facts yet. Import a CSV file to start mapping.'
      : 'No facts match this filter.';
    wrap.appendChild(empty);
    return wrap;
  }
  const table = document.createElement('div');
  table.className = 'finance-facts-table';
  const head = document.createElement('div');
  head.className = 'finance-facts-head';
  ['Date', 'Description', 'Bank', 'Amount', 'Finance target', 'State', 'Actions'].forEach((label) => {
    const cell = document.createElement('div');
    cell.textContent = label;
    head.appendChild(cell);
  });
  table.appendChild(head);
  rows.forEach((row) => table.appendChild(renderFactRow(row.transaction, row.allocation)));
  wrap.appendChild(table);
  return wrap;
}

function renderFactRow(transaction, allocation) {
  const row = document.createElement('div');
  row.className = 'finance-fact-row';
  row.dataset.id = String(transactionId(transaction));

  const date = document.createElement('div');
  date.className = 'finance-fact-date';
  date.textContent = formatFactDate(transaction.payment_date);
  date.title = transaction.operation_at || transaction.payment_date || '';

  const description = document.createElement('div');
  description.className = 'finance-fact-description';
  description.textContent = transaction.description || '(no description)';
  description.title = transaction.description || '';

  const bank = document.createElement('div');
  bank.className = 'finance-fact-bank';
  bank.textContent = [transaction.bank_category, transaction.mcc].filter(Boolean).join(' · ') || 'Bank';
  bank.title = bank.textContent;

  const amount = document.createElement('div');
  amount.className = 'finance-fact-money ' + (Number(transaction.amount_cents) < 0 ? 'expense' : 'income');
  amount.textContent = formatMoney(transaction.amount_cents, transaction.currency || 'RUB');

  const target = document.createElement('div');
  target.className = 'finance-fact-target';
  if (allocation) {
    const parts = [planName(allocation.plan_id)];
    const item = itemName(allocation.item_id);
    if (item) parts.push(item);
    target.textContent = parts.join(' / ');
  } else {
    target.textContent = 'Unmapped';
  }
  target.title = target.textContent;

  const stateCell = document.createElement('div');
  const badge = document.createElement('span');
  badge.className = 'finance-fact-state'
    + (allocation ? ' mapped' : '')
    + (transaction.rules_locked ? ' locked' : '');
  badge.textContent = transaction.rules_locked
    ? (allocation ? 'Locked' : 'Locked unmapped')
    : (allocation ? 'Mapped' : 'Unmapped');
  stateCell.appendChild(badge);

  const actions = document.createElement('div');
  actions.className = 'finance-fact-actions';
  const mapBtn = document.createElement('button');
  mapBtn.className = 'finance-small-btn';
  mapBtn.type = 'button';
  mapBtn.textContent = allocation ? 'Edit' : 'Map';
  mapBtn.addEventListener('click', () => openFactAssignmentModal(transaction, allocation));
  const lockBtn = document.createElement('button');
  lockBtn.className = 'finance-icon-btn';
  lockBtn.type = 'button';
  lockBtn.title = transaction.rules_locked ? 'Unlock from mapping rules' : 'Lock from mapping rules';
  lockBtn.textContent = transaction.rules_locked ? '🔒' : '🔓';
  lockBtn.addEventListener('click', () => toggleFactLock(transaction));
  actions.append(mapBtn, lockBtn);

  row.append(date, description, bank, amount, target, stateCell, actions);
  return row;
}

function renderImportPreview(preview) {
  const body = document.createElement('div');
  body.className = 'finance-import-preview';
  const rows = [
    ['Rows', `${preview.total_rows ?? 0}`],
    ['New', `${preview.new_rows ?? 0}`],
    ['Duplicates', `${preview.duplicate_rows ?? 0}`],
    ['Range', [preview.date_from, preview.date_to].filter(Boolean).join(' - ') || 'No dates'],
    ['Expenses', formatMoney(preview.expense_total_cents || 0, preview.currencies?.[0] || 'RUB')],
    ['Income', formatMoney(preview.income_total_cents || 0, preview.currencies?.[0] || 'RUB')],
  ];
  for (const [label, value] of rows) {
    const card = document.createElement('div');
    const l = document.createElement('span');
    l.textContent = label;
    const v = document.createElement('strong');
    v.textContent = value;
    card.append(l, v);
    body.appendChild(card);
  }
  return body;
}

async function openFinanceImportFlow() {
  let path = '';
  let stage = 'pick';
  try {
    path = await call('pick_finance_csv_file');
    if (!path) return;
    stage = 'preview';
    const preview = await call('preview_finance_bank_csv', { path });
    await showModal({
      title: 'Import bank CSV',
      body: renderImportPreview(preview),
      confirmText: 'Import',
      onConfirm: async () => {
        try {
          stage = 'import';
          const result = await call('import_finance_bank_csv', { path });
          showToast(`Imported ${result.preview?.new_rows ?? 0} new fact(s), mapped ${result.mapped_rows ?? 0}`, 'success');
          await loadAll(state.activePlanId);
        } catch (err) {
          showFinanceImportError(err, { stage, path });
          return false;
        }
      },
    });
  } catch (err) {
    if (String(err?.message || err) !== 'cancelled') {
      showFinanceImportError(err, { stage, path });
    }
  }
}

function showFinanceImportError(err, { stage = 'import', path = '' } = {}) {
  const message = String(err?.message || err || 'Unknown import error');
  showErrorDialog({
    title: 'Finance import failed',
    message: 'The bank CSV could not be imported. The details include the parser context and raw CSV row when available.',
    details: {
      stage,
      path,
      error: message,
    },
    copyText: [
      'Finance import failed',
      `Stage: ${stage}`,
      path ? `File: ${path}` : '',
      message,
    ].filter(Boolean).join('\n\n'),
  });
}

function appendPlanOptions(select, selectedId = null) {
  select.innerHTML = '';
  for (const plan of state.plans) {
    const option = document.createElement('option');
    option.value = String(planId(plan));
    option.textContent = plan.name || 'Untitled list';
    select.appendChild(option);
  }
  if (selectedId != null) select.value = String(selectedId);
}

function appendItemOptions(select, planIdValue, selectedId = null, { includeNone = true } = {}) {
  select.innerHTML = '';
  if (includeNone) {
    const none = document.createElement('option');
    none.value = '';
    none.textContent = 'List only';
    select.appendChild(none);
  }
  for (const item of state.allItems || []) {
    if (normalizeId(item.plan_id) !== normalizeId(planIdValue)) continue;
    const option = document.createElement('option');
    option.value = String(itemId(item));
    option.textContent = item.name || FINANCE_PLACEHOLDER_ITEM_NAME;
    select.appendChild(option);
  }
  if (selectedId != null) select.value = String(selectedId);
}

function flattenFinanceItemsForPlan(planIdValue) {
  const planItems = (state.allItems || []).filter((item) => normalizeId(item.plan_id) === normalizeId(planIdValue));
  const { roots, children } = buildTree(planItems);
  const rows = [];
  function visit(item, depth, parents = []) {
    const id = itemId(item);
    const kids = children.get(id) || [];
    const label = item.name || FINANCE_PLACEHOLDER_ITEM_NAME;
    rows.push({
      item,
      id,
      depth,
      isTerminal: kids.length === 0,
      path: [...parents, label].join(' / '),
    });
    for (const child of kids) visit(child, depth + 1, [...parents, label]);
  }
  for (const root of roots) visit(root, 0, []);
  return rows;
}

function createFinanceItemTreeSelect({
  planIdValue,
  selectedId = null,
  dataRuleField = null,
  placeholder = 'Choose terminal item',
} = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'finance-tree-select';
  const value = document.createElement('input');
  value.type = 'hidden';
  value.className = 'finance-tree-select-value';
  if (dataRuleField) value.dataset.ruleField = dataRuleField;
  const trigger = document.createElement('button');
  trigger.className = 'finance-tree-select-trigger';
  trigger.type = 'button';
  wrap.append(trigger, value);

  let currentPlanId = normalizeId(planIdValue);
  let currentSelectedId = normalizeId(selectedId);

  const rows = () => flattenFinanceItemsForPlan(currentPlanId);
  const selectedRow = () => rows().find((row) => row.id === currentSelectedId && row.isTerminal) || null;
  const closeMenu = () => wrap.querySelector('.finance-tree-select-menu')?.remove();
  const sync = () => {
    const row = selectedRow();
    if (!row) currentSelectedId = null;
    value.value = currentSelectedId == null ? '' : String(currentSelectedId);
    trigger.textContent = row ? row.path : placeholder;
    trigger.title = row ? row.path : placeholder;
  };

  const openMenu = () => {
    const existing = wrap.querySelector('.finance-tree-select-menu');
    if (existing) {
      existing.remove();
      return;
    }
    const menu = document.createElement('div');
    menu.className = 'finance-tree-select-menu';
    const currentRows = rows();
    if (!currentRows.length) {
      const empty = document.createElement('div');
      empty.className = 'finance-tree-select-empty';
      empty.textContent = 'No finance items in this list';
      menu.appendChild(empty);
    }
    for (const row of currentRows) {
      const option = document.createElement('button');
      option.className = 'finance-tree-select-option'
        + (row.isTerminal ? '' : ' group')
        + (row.id === currentSelectedId ? ' selected' : '');
      option.type = 'button';
      option.dataset.itemId = String(row.id);
      option.style.setProperty('--depth', String(row.depth));
      option.setAttribute('aria-disabled', row.isTerminal ? 'false' : 'true');
      const marker = document.createElement('span');
      marker.className = 'finance-tree-select-marker';
      marker.textContent = row.isTerminal ? '•' : '▸';
      const text = document.createElement('span');
      text.textContent = row.item.name || FINANCE_PLACEHOLDER_ITEM_NAME;
      option.append(marker, text);
      option.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!row.isTerminal) return;
        currentSelectedId = row.id;
        closeMenu();
        sync();
      });
      menu.appendChild(option);
    }
    wrap.appendChild(menu);
  };

  trigger.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    openMenu();
  });
  wrap.addEventListener('click', (event) => event.stopPropagation());

  sync();
  return {
    element: wrap,
    value,
    getValue: () => (value.value ? Number(value.value) : null),
    setPlanId: (nextPlanId, nextSelectedId = null) => {
      currentPlanId = normalizeId(nextPlanId);
      currentSelectedId = normalizeId(nextSelectedId);
      closeMenu();
      sync();
    },
  };
}

function financeModalInput(type = 'text', value = '') {
  const input = document.createElement('input');
  input.className = 'finance-input';
  input.type = type;
  input.value = value == null ? '' : String(value);
  return input;
}

async function openFactAssignmentModal(transaction, allocation) {
  const body = document.createElement('div');
  body.className = 'finance-modal-grid';
  const description = document.createElement('div');
  description.className = 'finance-modal-note';
  description.textContent = `${formatFactDate(transaction.payment_date)} · ${transaction.description || 'No description'} · ${formatMoney(transaction.amount_cents, transaction.currency || 'RUB')}`;

  const planLabel = document.createElement('label');
  planLabel.textContent = 'Finance list';
  const planSelect = document.createElement('select');
  planSelect.className = 'finance-select';
  appendPlanOptions(planSelect, allocation?.plan_id || state.activePlanId);

  const itemLabel = document.createElement('label');
  itemLabel.textContent = 'Finance item';
  const itemSelect = createFinanceItemTreeSelect({
    planIdValue: Number(planSelect.value),
    selectedId: allocation?.item_id || null,
  });
  planSelect.addEventListener('change', () => itemSelect.setPlanId(Number(planSelect.value), null));

  const lockLabel = document.createElement('label');
  lockLabel.textContent = 'Rules lock';
  const lockWrap = document.createElement('label');
  lockWrap.className = 'finance-modal-note';
  const lock = document.createElement('input');
  lock.type = 'checkbox';
  lock.checked = Boolean(transaction.rules_locked);
  lockWrap.append(lock, document.createTextNode(' Keep this manual assignment unchanged when rules run'));

  body.append(description, planLabel, planSelect, itemLabel, itemSelect.element, lockLabel, lockWrap);
  try {
    await showModal({
      title: 'Map finance fact',
      body,
      confirmText: 'Save mapping',
      extraActions: [
        {
          text: 'Create rule from fact',
          className: 'btn-secondary',
          onClick: async () => {
            const targetItemId = itemSelect.getValue();
            if (targetItemId == null) throw new Error('Choose a terminal finance item before creating a rule');
            setTimeout(() => {
              openFinanceRulesModal({
                seedTransaction: transaction,
                targetPlanId: Number(planSelect.value),
                targetItemId,
                applyExisting: true,
              });
            }, 0);
          },
        },
      ],
      onConfirm: async () => {
        const targetItemId = itemSelect.getValue();
        if (targetItemId == null) throw new Error('Choose a terminal finance item');
        await call('assign_finance_transaction', {
          transactionId: transactionId(transaction),
          planId: Number(planSelect.value),
          itemId: targetItemId,
          rulesLocked: lock.checked,
        });
        await loadAll(state.activePlanId);
      },
    });
  } catch (err) {
    if (String(err?.message || err) !== 'cancelled') {
      showToast(`Failed to map fact: ${err}`, 'error');
    }
  }
}

async function toggleFactLock(transaction) {
  try {
    await call('set_finance_transaction_rules_locked', {
      transactionId: transactionId(transaction),
      rulesLocked: !transaction.rules_locked,
    });
    await loadAll(state.activePlanId);
  } catch (err) {
    showToast(`Failed to update fact lock: ${err}`, 'error');
  }
}

function renderExistingRulesList(body) {
  const rules = document.createElement('div');
  rules.className = 'finance-modal-note';
  if (!state.mappingRules.length) {
    rules.textContent = 'No rules yet. Create a rule below, then apply it to future imports or existing facts.';
    return rules;
  }
  rules.textContent = 'Existing rules';
  const list = document.createElement('div');
  list.style.display = 'grid';
  list.style.gap = '6px';
  list.style.marginTop = '8px';
  for (const rule of state.mappingRules) {
    const row = document.createElement('div');
    row.style.display = 'grid';
    row.style.gridTemplateColumns = '1fr auto auto';
    row.style.gap = '6px';
    row.style.alignItems = 'center';
    row.style.border = '1px solid var(--border)';
    row.style.borderRadius = '7px';
    row.style.padding = '7px 8px';
    const text = document.createElement('div');
    text.style.minWidth = '0';
    text.textContent = `${rule.is_enabled ? '' : '[off] '}${rule.name || 'Untitled rule'} → ${planName(rule.target_plan_id)}${itemName(rule.target_item_id) ? ` / ${itemName(rule.target_item_id)}` : ''}`;
    text.title = describeRuleConditions(rule);
    const apply = document.createElement('button');
    apply.className = 'finance-small-btn';
    apply.type = 'button';
    apply.textContent = 'Apply';
    apply.addEventListener('click', async () => {
      const count = await call('apply_finance_mapping_rule', { id: ruleId(rule), remapAssigned: false });
      showToast(`Rule applied to ${count} fact(s)`, 'success');
      await loadAll(state.activePlanId);
    });
    const del = document.createElement('button');
    del.className = 'finance-icon-btn';
    del.type = 'button';
    del.title = 'Delete rule';
    del.textContent = '🗑';
    del.addEventListener('click', async () => {
      await call('delete_finance_mapping_rule', { id: ruleId(rule) });
      showToast('Rule deleted', 'success');
      await loadAll(state.activePlanId);
      body.replaceChildren(renderRulesModalContent(body));
    });
    row.append(text, apply, del);
    list.appendChild(row);
  }
  rules.appendChild(list);
  return rules;
}

function ruleSeedName(seedTransaction) {
  if (!seedTransaction) return '';
  const parts = [seedTransaction.bank_category, seedTransaction.description]
    .map((part) => String(part || '').trim())
    .filter(Boolean);
  return parts.length ? parts.join(' · ') : 'New mapping rule';
}

function ruleDirectionFromTransaction(transaction) {
  const amount = Number(transaction?.amount_cents) || 0;
  if (amount < 0) return 'expense';
  if (amount > 0) return 'income';
  return 'any';
}

function renderRulesModalContent(containerRef = null, seed = {}) {
  const seedTransaction = seed.seedTransaction || null;
  const body = document.createElement('div');
  body.className = 'finance-modal-grid';
  body.appendChild(renderExistingRulesList(containerRef || body));

  const nameLabel = document.createElement('label');
  nameLabel.textContent = 'Rule name';
  const nameInput = financeModalInput('text', ruleSeedName(seedTransaction));
  nameInput.dataset.ruleField = 'name';
  nameInput.placeholder = 'Taxi to Regular payments';

  const enabledLabel = document.createElement('label');
  enabledLabel.textContent = 'Enabled';
  const enabled = document.createElement('input');
  enabled.type = 'checkbox';
  enabled.checked = true;
  enabled.dataset.ruleField = 'enabled';

  const priorityLabel = document.createElement('label');
  priorityLabel.textContent = 'Priority';
  const priority = financeModalInput('number', String((state.mappingRules?.length || 0) + 1));
  priority.dataset.ruleField = 'priority';

  const modeLabel = document.createElement('label');
  modeLabel.textContent = 'Match mode';
  const matchMode = document.createElement('select');
  matchMode.className = 'finance-select';
  matchMode.dataset.ruleField = 'match-mode';
  [['all', 'All conditions'], ['any', 'Any condition']].forEach(([value, label]) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    matchMode.appendChild(option);
  });

  const categoryLabel = document.createElement('label');
  categoryLabel.textContent = 'Bank category';
  const category = financeModalInput('text', seedTransaction?.bank_category || '');
  category.dataset.ruleField = 'category';
  category.placeholder = 'Такси';

  const descriptionLabel = document.createElement('label');
  descriptionLabel.textContent = 'Description contains';
  const description = financeModalInput('text', seedTransaction?.description || '');
  description.dataset.ruleField = 'description';
  description.placeholder = 'Яндекс';

  const mccLabel = document.createElement('label');
  mccLabel.textContent = 'MCC';
  const mcc = financeModalInput('text', seedTransaction?.mcc || '');
  mcc.dataset.ruleField = 'mcc';
  mcc.placeholder = '3990';

  const directionLabel = document.createElement('label');
  directionLabel.textContent = 'Direction';
  const direction = document.createElement('select');
  direction.className = 'finance-select';
  direction.dataset.ruleField = 'direction';
  [['any', 'Any'], ['expense', 'Expense'], ['income', 'Income/refund']].forEach(([value, label]) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    direction.appendChild(option);
  });
  direction.value = ruleDirectionFromTransaction(seedTransaction);

  const amountLabel = document.createElement('label');
  amountLabel.textContent = 'Amount range';
  const amountGrid = document.createElement('div');
  amountGrid.style.display = 'grid';
  amountGrid.style.gridTemplateColumns = '1fr 1fr';
  amountGrid.style.gap = '6px';
  const minAmount = financeModalInput('text', '');
  minAmount.dataset.ruleField = 'min-amount';
  minAmount.placeholder = 'from, e.g. -1000';
  const maxAmount = financeModalInput('text', '');
  maxAmount.dataset.ruleField = 'max-amount';
  maxAmount.placeholder = 'to, e.g. -100';
  amountGrid.append(minAmount, maxAmount);

  const planLabel = document.createElement('label');
  planLabel.textContent = 'Target list';
  const planSelect = document.createElement('select');
  planSelect.className = 'finance-select';
  planSelect.dataset.ruleField = 'plan-id';
  appendPlanOptions(planSelect, seed.targetPlanId || state.activePlanId);

  const itemLabel = document.createElement('label');
  itemLabel.textContent = 'Target item';
  const itemSelect = createFinanceItemTreeSelect({
    planIdValue: Number(planSelect.value),
    selectedId: seed.targetItemId || null,
    dataRuleField: 'item-id',
  });
  planSelect.addEventListener('change', () => itemSelect.setPlanId(Number(planSelect.value), null));

  const applyLabel = document.createElement('label');
  applyLabel.textContent = 'Apply now';
  const applyWrap = document.createElement('label');
  applyWrap.className = 'finance-modal-note';
  const applyExisting = document.createElement('input');
  applyExisting.type = 'checkbox';
  applyExisting.dataset.ruleField = 'apply-existing';
  applyExisting.checked = Boolean(seed.applyExisting);
  applyWrap.append(applyExisting, document.createTextNode(' Apply this rule to currently unmapped facts after saving'));

  const remapLabel = document.createElement('label');
  remapLabel.textContent = 'Remap assigned';
  const remapWrap = document.createElement('label');
  remapWrap.className = 'finance-modal-note';
  const remap = document.createElement('input');
  remap.type = 'checkbox';
  remap.dataset.ruleField = 'remap-assigned';
  remapWrap.append(remap, document.createTextNode(' Also remap already assigned unlocked facts'));

  body.append(
    nameLabel, nameInput,
    enabledLabel, enabled,
    priorityLabel, priority,
    modeLabel, matchMode,
    categoryLabel, category,
    descriptionLabel, description,
    mccLabel, mcc,
    directionLabel, direction,
    amountLabel, amountGrid,
    planLabel, planSelect,
    itemLabel, itemSelect.element,
    applyLabel, applyWrap,
    remapLabel, remapWrap,
  );
  return body;
}

async function openFinanceRulesModal(seed = {}) {
  const body = renderRulesModalContent(null, seed);
  try {
    await showModal({
      title: 'Finance mapping rules',
      body,
      confirmText: seed.seedTransaction ? 'Create and apply rule' : 'Create rule',
      onConfirm: async () => {
        const name = body.querySelector('[data-rule-field="name"]')?.value.trim() || 'New mapping rule';
        const targetItemValue = body.querySelector('[data-rule-field="item-id"]')?.value || '';
        if (!targetItemValue) throw new Error('Choose a terminal target item');
        const rule = await call('create_finance_mapping_rule', {
          name,
          isEnabled: body.querySelector('[data-rule-field="enabled"]')?.checked ?? true,
          priority: Number(body.querySelector('[data-rule-field="priority"]')?.value || 0),
          matchMode: body.querySelector('[data-rule-field="match-mode"]')?.value || 'all',
          conditionsJson: makeRuleConditionsFromForm(body),
          targetPlanId: Number(body.querySelector('[data-rule-field="plan-id"]')?.value),
          targetItemId: Number(targetItemValue),
        });
        if (body.querySelector('[data-rule-field="apply-existing"]')?.checked) {
          const count = await call('apply_finance_mapping_rule', {
            id: ruleId(rule),
            remapAssigned: Boolean(body.querySelector('[data-rule-field="remap-assigned"]')?.checked),
          });
          showToast(`Rule created and applied to ${count} fact(s)`, 'success');
        } else {
          showToast('Rule created', 'success');
        }
        await loadAll(state.activePlanId);
      },
    });
  } catch (err) {
    if (String(err?.message || err) !== 'cancelled') {
      showToast(`Failed to update rules: ${err}`, 'error');
    }
  }
}

function paymentMap() {
  const map = new Map();
  for (const payment of state.payments || []) {
    const item = normalizeId(payment.item_id);
    const month = String(payment.month_key || '');
    if (item != null && month) map.set(`${item}|${month}`, payment);
  }
  return map;
}

function knownCalendarMonths(plan = activePlan()) {
  const months = new Set([currentMonthKey(), addMonths(currentMonthKey(), 1), addMonths(currentMonthKey(), 2)]);
  for (const payment of state.payments || []) {
    if (/^\d{4}-\d{2}$/.test(String(payment.month_key || ''))) months.add(payment.month_key);
  }
  for (const month of loadStoredCalendarMonths(plan)) months.add(month);
  return [...months].sort();
}

function visibleCalendarMonths(plan = activePlan()) {
  const current = currentMonthKey();
  const months = knownCalendarMonths(plan);
  const visible = state.calendarShowOldMonths ? months : months.filter((month) => month >= current);
  return visible.length ? visible : [current];
}

function addCalendarMonthColumn() {
  const plan = activePlan();
  const months = knownCalendarMonths(plan);
  const next = addMonths(months[months.length - 1] || currentMonthKey(), 1);
  saveStoredCalendarMonths([...loadStoredCalendarMonths(plan), next], plan);
  render();
}

function terminalDescendantIds(item, children, cache = new Map()) {
  const id = itemId(item);
  if (cache.has(id)) return cache.get(id);
  const kids = children.get(id) || [];
  if (!kids.length) {
    cache.set(id, [id]);
    return [id];
  }
  const ids = kids.flatMap((child) => terminalDescendantIds(child, children, cache));
  cache.set(id, ids);
  return ids;
}

function paidTotalForMonth(item, monthKey, children, payments, cache) {
  const ids = terminalDescendantIds(item, children, cache);
  return ids.reduce((sum, id) => {
    const payment = payments.get(`${id}|${monthKey}`);
    return payment?.is_paid ? sum + (Number(payment.paid_amount_cents) || 0) : sum;
  }, 0);
}

function renderPaymentCalendar(roots, children, plan) {
  const wrap = document.createElement('div');
  wrap.className = 'finance-table-wrap';
  if (!state.items.length) {
    const empty = document.createElement('div');
    empty.className = 'finance-empty';
    empty.textContent = 'No expense rows yet. Add rows in Structure.';
    wrap.appendChild(empty);
    return wrap;
  }

  const months = visibleCalendarMonths(plan);
  const template = `minmax(260px, 1.6fr) 56px repeat(${months.length}, minmax(132px, 146px))`;
  const tree = document.createElement('div');
  tree.className = 'finance-calendar-tree';
  tree.style.minWidth = `${Math.max(820, 336 + months.length * 142)}px`;

  const head = document.createElement('div');
  head.className = 'finance-calendar-head';
  head.style.gridTemplateColumns = template;
  const first = document.createElement('div');
  first.textContent = 'Expense';
  const dateHead = document.createElement('div');
  dateHead.textContent = 'Date';
  dateHead.title = 'Planned day of month';
  head.append(first, dateHead);
  for (const month of months) {
    const cell = document.createElement('div');
    cell.textContent = monthLabel(month);
    head.appendChild(cell);
  }
  tree.appendChild(head);

  const rows = flattenVisible(roots, children);
  const maxDepth = maxTreeDepth(roots, children);
  const payments = paymentMap();
  const terminalCache = new Map();
  for (const row of rows) {
    tree.appendChild(renderCalendarRow(row, children, maxDepth, months, payments, terminalCache, template, plan));
  }
  wrap.appendChild(tree);
  return wrap;
}

function renderCalendarRow(row, children, maxDepth, months, payments, terminalCache, template, plan) {
  const { item, depth } = row;
  const id = itemId(item);
  const childCount = (children.get(id) || []).length;
  const rowEl = document.createElement('div');
  const classes = ['finance-calendar-row'];
  if (childCount === 0) classes.push('finance-calendar-terminal');
  else classes.push('finance-group-row');
  const bandSlot = bandSlotForDepth(depth, maxDepth);
  if (bandSlot != null) classes.push(`finance-band-slot-${bandSlot}`);
  rowEl.className = classes.join(' ');
  rowEl.style.gridTemplateColumns = template;
  rowEl.dataset.id = String(id);

  const nameCell = document.createElement('div');
  nameCell.className = 'finance-calendar-name';
  const toggle = document.createElement('button');
  toggle.className = 'finance-toggle';
  toggle.type = 'button';
  toggle.disabled = childCount === 0;
  toggle.textContent = childCount ? (state.collapsed.has(id) ? '>' : 'v') : '';
  toggle.addEventListener('click', () => {
    if (state.collapsed.has(id)) state.collapsed.delete(id);
    else state.collapsed.add(id);
    saveCollapsed();
    render();
  });
  const pad = document.createElement('span');
  pad.className = 'finance-depth-pad';
  pad.style.width = `${Math.min(depth, 8) * 18}px`;
  const label = document.createElement('span');
  label.className = 'finance-calendar-label';
  label.textContent = item.name || FINANCE_PLACEHOLDER_ITEM_NAME;
  nameCell.append(toggle, pad, label);
  rowEl.appendChild(nameCell);

  const dateCell = document.createElement('div');
  const date = document.createElement('div');
  date.className = 'finance-calendar-date';
  date.textContent = calendarDateLabel(item);
  date.title = item.due_day == null ? 'No planned day' : `Planned day: ${item.due_day}`;
  dateCell.appendChild(date);
  rowEl.appendChild(dateCell);

  for (const month of months) {
    if (childCount > 0) {
      const totalCell = document.createElement('div');
      const total = document.createElement('div');
      total.className = 'finance-calendar-total';
      total.textContent = formatMoney(paidTotalForMonth(item, month, children, payments, terminalCache), plan.currency || 'RUB');
      totalCell.appendChild(total);
      rowEl.appendChild(totalCell);
    } else {
      rowEl.appendChild(renderPaymentCell(item, month, payments.get(`${id}|${month}`), plan));
    }
  }
  return rowEl;
}

function calendarDateLabel(item) {
  const day = Number(item?.due_day);
  if (!Number.isInteger(day) || day < 1 || day > 31) return '';
  return String(day);
}

function renderPaymentCell(item, monthKey, payment, plan) {
  const cell = document.createElement('div');
  const wrap = document.createElement('div');
  wrap.className = 'finance-payment-cell';
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = Boolean(payment?.is_paid);
  checkbox.title = 'Paid';
  const amount = document.createElement('input');
  amount.className = 'finance-payment-amount';
  amount.inputMode = 'decimal';
  amount.value = amountInputValue(payment ? payment.paid_amount_cents : item.amount_cents);
  amount.placeholder = amountInputValue(item.amount_cents) || '0';
  amount.title = `Fact amount, ${plan.currency || 'RUB'}`;

  const save = () => savePaymentCell(item, monthKey, checkbox.checked, amount.value);
  checkbox.addEventListener('change', save);
  amount.addEventListener('change', save);
  amount.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      save();
    }
  });

  wrap.append(checkbox, amount);
  cell.appendChild(wrap);
  return cell;
}

async function savePaymentCell(item, monthKey, isPaid, amountValue) {
  const amountCents = parseMoneyToCents(amountValue);
  if (amountCents == null) {
    showToast('Payment amount must be non-negative', 'error');
    return;
  }
  const tableWrap = rootEl?.querySelector('.finance-table-wrap');
  const scrollTop = tableWrap?.scrollTop || 0;
  const scrollLeft = tableWrap?.scrollLeft || 0;
  try {
    const saved = await call('upsert_finance_payment', {
      planId: state.activePlanId,
      itemId: itemId(item),
      monthKey,
      isPaid,
      paidAmountCents: amountCents,
      note: '',
    });
    state.payments = [
      ...state.payments.filter((payment) => !(
        normalizeId(payment.item_id) === itemId(item)
        && String(payment.month_key) === monthKey
      )),
      saved,
    ];
    render();
    setTimeout(() => {
      const nextWrap = rootEl?.querySelector('.finance-table-wrap');
      if (nextWrap) {
        nextWrap.scrollTop = scrollTop;
        nextWrap.scrollLeft = scrollLeft;
      }
    }, 0);
  } catch (err) {
    showToast(`Failed to save payment: ${err}`, 'error');
  }
}

function renderTree(roots, children, totals) {
  const wrap = document.createElement('div');
  wrap.className = 'finance-table-wrap';
  if (!state.items.length) {
    const empty = document.createElement('div');
    empty.className = 'finance-empty';
    empty.textContent = 'No expense rows yet. Add a row.';
    wrap.appendChild(empty);
    return wrap;
  }

  const tree = document.createElement('div');
  tree.className = 'finance-tree';
  const head = document.createElement('div');
  head.className = 'finance-table-head';
  ['', '', 'Name', 'Amount', 'Date', 'Total', 'Note', 'Actions'].forEach((label) => {
    const cell = document.createElement('div');
    cell.textContent = label;
    head.appendChild(cell);
  });
  tree.appendChild(head);

  const rows = flattenVisible(roots, children);
  const maxDepth = maxTreeDepth(roots, children);
  for (const row of rows) {
    tree.appendChild(renderItemRow(row, children, totals, maxDepth));
  }
  wrap.appendChild(tree);
  return wrap;
}

function renderItemRow(row, children, totals, maxDepth) {
  const { item, depth } = row;
  const id = itemId(item);
  const childCount = (children.get(id) || []).length;
  const rowEl = document.createElement('div');
  const classes = ['finance-row'];
  if (childCount > 0) classes.push('finance-group-row');
  const bandSlot = bandSlotForDepth(depth, maxDepth);
  if (bandSlot != null) classes.push(`finance-band-slot-${bandSlot}`);
  rowEl.className = classes.join(' ');
  rowEl.dataset.id = String(id);
  rowEl.dataset.depth = String(depth);
  rowEl.dataset.parentId = item.parent_id == null ? '' : String(item.parent_id);
  rowEl.dataset.dueDay = item.due_day == null ? '' : String(item.due_day);
  rowEl.dataset.dueDate = item.due_date || '';

  const gripCell = document.createElement('div');
  const grip = document.createElement('button');
  grip.className = 'finance-row-grip';
  grip.type = 'button';
  grip.title = 'Drag row';
  grip.textContent = '::';
  grip.addEventListener('pointerdown', (event) => startItemDrag(event, rowEl));
  gripCell.appendChild(grip);

  const toggleCell = document.createElement('div');
  const toggle = document.createElement('button');
  toggle.className = 'finance-toggle';
  toggle.type = 'button';
  toggle.disabled = childCount === 0;
  toggle.textContent = childCount ? (state.collapsed.has(id) ? '>' : 'v') : '';
  toggle.addEventListener('click', () => {
    if (state.collapsed.has(id)) state.collapsed.delete(id);
    else state.collapsed.add(id);
    saveCollapsed();
    render();
  });
  toggleCell.appendChild(toggle);

  const nameCell = document.createElement('div');
  nameCell.className = 'finance-name-cell';
  const pad = document.createElement('span');
  pad.className = 'finance-depth-pad';
  pad.style.width = `${Math.min(depth, 8) * 18}px`;
  const nameInput = document.createElement('input');
  nameInput.className = 'finance-input';
  nameInput.dataset.field = 'name';
  nameInput.value = item.name || '';
  nameInput.placeholder = 'Expense item';
  nameInput.addEventListener('change', () => saveItemFromRow(rowEl));
  nameInput.addEventListener('keydown', (event) => onFinanceNameKeydown(event, rowEl));
  nameCell.append(pad, nameInput);

  const amountCell = document.createElement('div');
  const amountInput = document.createElement('input');
  amountInput.className = 'finance-money-input';
  amountInput.dataset.field = 'amount';
  amountInput.value = amountInputValue(item.amount_cents);
  amountInput.placeholder = '0';
  amountInput.inputMode = 'decimal';
  amountInput.min = '0';
  amountInput.addEventListener('change', () => saveItemFromRow(rowEl));
  amountInput.addEventListener('keydown', (event) => onFinanceValueKeydown(event, rowEl));
  amountCell.appendChild(amountInput);

  const dateCell = document.createElement('div');
  if (activePlanKind() === 'monthly') {
    const dayWrap = document.createElement('div');
    dayWrap.className = 'finance-day-field';
    const dayInput = document.createElement('input');
    dayInput.className = 'finance-date-input';
    dayInput.dataset.field = 'due-day';
    dayInput.value = item.due_day == null ? '' : String(item.due_day);
    dayInput.placeholder = 'Day';
    dayInput.inputMode = 'numeric';
    dayInput.maxLength = 2;
    dayInput.addEventListener('change', () => saveItemFromRow(rowEl));
    const suffix = document.createElement('span');
    suffix.className = 'finance-day-suffix';
    suffix.textContent = '-е';
    dayWrap.append(dayInput, suffix);
    dateCell.appendChild(dayWrap);
  } else {
    const dateInput = document.createElement('input');
    dateInput.className = 'finance-date-input';
    dateInput.dataset.field = 'due-date';
    dateInput.type = 'date';
    dateInput.value = dateInputValue(item.due_date);
    dateInput.addEventListener('change', () => saveItemFromRow(rowEl));
    dateCell.appendChild(dateInput);
  }

  const totalCell = document.createElement('div');
  totalCell.className = 'finance-total';
  totalCell.textContent = formatMoney(totals.get(id) || 0, currencyOfActivePlan());

  const noteCell = document.createElement('div');
  const noteInput = document.createElement('input');
  noteInput.className = 'finance-note-input';
  noteInput.dataset.field = 'note';
  noteInput.value = item.note || '';
  noteInput.placeholder = 'Note';
  noteInput.addEventListener('change', () => saveItemFromRow(rowEl));
  noteCell.appendChild(noteInput);

  const actionCell = document.createElement('div');
  actionCell.className = 'finance-row-actions';
  const addChild = document.createElement('button');
  addChild.className = 'finance-icon-btn';
  addChild.type = 'button';
  addChild.title = 'Add child row';
  addChild.textContent = '+';
  addChild.addEventListener('click', () => createItem(id));
  const del = document.createElement('button');
  del.className = 'finance-icon-btn';
  del.type = 'button';
  del.title = 'Delete row';
  del.textContent = '🗑';
  del.addEventListener('click', () => deleteItem(id));
  actionCell.append(addChild, del);

  rowEl.append(gripCell, toggleCell, nameCell, amountCell, dateCell, totalCell, noteCell, actionCell);
  return rowEl;
}

function sortedItemsForParent(parentId) {
  return state.items
    .filter((item) => normalizeId(item.parent_id) === normalizeId(parentId))
    .sort((a, b) =>
      (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0)
      || String(a.name || '').localeCompare(String(b.name || ''))
      || itemId(a) - itemId(b));
}

function captureFinanceViewport(rowEl = null) {
  const wrap = rootEl?.querySelector('.finance-table-wrap');
  const active = rootEl?.contains(document.activeElement) ? document.activeElement : null;
  const activeRow = active?.closest?.('.finance-row') || rowEl;
  const selectionStart = Number.isInteger(active?.selectionStart) ? active.selectionStart : null;
  const selectionEnd = Number.isInteger(active?.selectionEnd) ? active.selectionEnd : null;
  return {
    scrollTop: wrap?.scrollTop ?? 0,
    scrollLeft: wrap?.scrollLeft ?? 0,
    rowId: activeRow?.dataset?.id || rowEl?.dataset?.id || null,
    field: active?.dataset?.field || null,
    selectionStart,
    selectionEnd,
  };
}

function restoreFinanceViewport(snapshot) {
  if (!snapshot) return;
  setTimeout(() => {
    const wrap = rootEl?.querySelector('.finance-table-wrap');
    const input = snapshot.rowId && snapshot.field
      ? rootEl?.querySelector(`.finance-row[data-id="${snapshot.rowId}"] [data-field="${snapshot.field}"]`)
      : null;
    if (input) {
      input.focus?.({ preventScroll: true });
      if (snapshot.selectionStart != null && snapshot.selectionEnd != null) {
        try {
          input.setSelectionRange(snapshot.selectionStart, snapshot.selectionEnd);
        } catch {}
      }
    }
    if (wrap) {
      wrap.scrollTop = snapshot.scrollTop;
      wrap.scrollLeft = snapshot.scrollLeft;
    }
  }, 0);
}

function isFinancePlaceholderName(value) {
  return String(value || '').trim() === FINANCE_PLACEHOLDER_ITEM_NAME;
}

function focusFinanceRowName(id, options = {}) {
  const opts = typeof options === 'boolean' ? { atEnd: options } : options;
  setTimeout(() => {
    const input = rootEl?.querySelector(`.finance-row[data-id="${id}"] [data-field="name"]`);
    if (!input) return;
    input.focus({ preventScroll: true });
    if (opts.selectAll || (opts.selectPlaceholder && isFinancePlaceholderName(input.value))) {
      input.select?.();
      input.scrollIntoView?.({ block: 'nearest' });
      return;
    }
    const offset = opts.atEnd ? input.value.length : 0;
    try {
      input.setSelectionRange(offset, offset);
    } catch {
      input.select?.();
    }
    input.scrollIntoView?.({ block: 'nearest' });
  }, 0);
}

function focusFinanceNameNeighbor(input, direction) {
  const row = input.closest('.finance-row');
  if (!row || !rootEl) return false;
  const rows = [...rootEl.querySelectorAll('.finance-row')];
  const index = rows.indexOf(row);
  const target = rows[index + (direction === 'previous' ? -1 : 1)];
  const targetInput = target?.querySelector('[data-field="name"]');
  if (!targetInput) return false;
  targetInput.focus();
  try {
    targetInput.setSelectionRange(0, 0);
  } catch {
    targetInput.select?.();
  }
  return true;
}

async function createItemAfter(rowEl) {
  const currentId = Number(rowEl.dataset.id);
  const current = state.items.find((item) => itemId(item) === currentId);
  const parentId = current ? normalizeId(current.parent_id) : null;
  const created = await call('create_finance_item', {
    planId: state.activePlanId,
    parentId,
    name: '',
    amountCents: 0,
    dueDay: null,
    dueDate: null,
    note: '',
  });

  if (parentId != null) {
    state.collapsed.delete(Number(parentId));
    saveCollapsed();
  }

  if (current) {
    const siblings = sortedItemsForParent(parentId).filter((item) => itemId(item) !== itemId(created));
    const currentIndex = siblings.findIndex((item) => itemId(item) === currentId);
    const beforeId = currentIndex >= 0 ? itemId(siblings[currentIndex + 1]) : null;
    await call('move_finance_item', {
      id: itemId(created),
      parentId,
      beforeId,
    });
  }

  await loadAll(state.activePlanId);
  focusFinanceRowName(itemId(created), { selectAll: true });
}

async function indentFinanceItem(rowEl) {
  const id = Number(rowEl.dataset.id);
  const item = state.items.find((entry) => itemId(entry) === id);
  if (!item) return;
  const siblings = sortedItemsForParent(item.parent_id);
  const index = siblings.findIndex((entry) => itemId(entry) === id);
  if (index <= 0) return;
  const parent = siblings[index - 1];
  const parentId = itemId(parent);
  state.collapsed.delete(parentId);
  saveCollapsed();
  await call('move_finance_item', {
    id,
    parentId,
    beforeId: null,
  });
  await loadAll(state.activePlanId);
  focusFinanceRowName(id, { selectPlaceholder: true });
}

async function outdentFinanceItem(rowEl) {
  const id = Number(rowEl.dataset.id);
  const item = state.items.find((entry) => itemId(entry) === id);
  if (!item || item.parent_id == null) return;
  const parent = state.items.find((entry) => itemId(entry) === normalizeId(item.parent_id));
  const newParentId = parent ? normalizeId(parent.parent_id) : null;
  const parentSiblings = sortedItemsForParent(newParentId);
  const parentIndex = parentSiblings.findIndex((entry) => itemId(entry) === normalizeId(item.parent_id));
  const beforeId = parentIndex >= 0 ? itemId(parentSiblings[parentIndex + 1]) : null;
  await call('move_finance_item', {
    id,
    parentId: newParentId,
    beforeId,
  });
  await loadAll(state.activePlanId);
  focusFinanceRowName(id, { selectPlaceholder: true });
}

async function onFinanceNameKeydown(event, rowEl) {
  if (event.isComposing) return;
  const input = event.currentTarget;
  if (event.key === 'ArrowUp') {
    if (input.selectionStart === 0 && input.selectionEnd === 0 && focusFinanceNameNeighbor(input, 'previous')) {
      event.preventDefault();
    }
    return;
  }
  if (event.key === 'ArrowDown') {
    const end = input.value.length;
    if (input.selectionStart === end && input.selectionEnd === end && focusFinanceNameNeighbor(input, 'next')) {
      event.preventDefault();
    }
    return;
  }
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    if (!(await saveItemFromRow(rowEl))) return;
    await createItemAfter(rowEl);
    return;
  }
  if (event.key === 'Tab' && !event.shiftKey) {
    event.preventDefault();
    if (!(await saveItemFromRow(rowEl))) return;
    await indentFinanceItem(rowEl);
    return;
  }
  if (event.key === 'Tab' && event.shiftKey) {
    event.preventDefault();
    if (!(await saveItemFromRow(rowEl))) return;
    await outdentFinanceItem(rowEl);
  }
}

async function onFinanceValueKeydown(event, rowEl) {
  if (event.isComposing) return;
  if (event.key !== 'Enter' || event.shiftKey) return;
  event.preventDefault();
  await saveItemFromRow(rowEl);
}

async function createPlan() {
  try {
    await saveActivePlanHeaderFromDom();
    const plan = await call('create_finance_plan', {
      name: 'New list',
      currency: 'RUB',
      kind: 'general',
    });
    await loadAll(planId(plan));
  } catch (err) {
    showToast(`Failed to create list: ${err}`, 'error');
  }
}

async function deleteActivePlan() {
  const plan = state.plans.find((p) => planId(p) === state.activePlanId);
  if (!plan) return;
  if (state.plans.length <= 1) {
    showToast('Keep at least one finance list', 'error');
    return;
  }
  try {
    const body = document.createElement('div');
    body.textContent = `Delete "${plan.name || 'Untitled list'}" and all rows inside it?`;
    await showModal({
      title: 'Delete finance list',
      body,
      onConfirm: async () => {
        await call('delete_finance_plan', { id: state.activePlanId });
      },
    });
    await loadAll(null);
  } catch (err) {
    if (String(err?.message || err) !== 'cancelled') {
      showToast(`Failed to delete list: ${err}`, 'error');
    }
  }
}

async function createItem(parentId) {
  try {
    const created = await call('create_finance_item', {
      planId: state.activePlanId,
      parentId,
      name: 'New row',
      amountCents: 0,
      dueDay: null,
      dueDate: null,
      note: '',
    });
    if (parentId != null) {
      state.collapsed.delete(Number(parentId));
      saveCollapsed();
    }
    await loadAll(state.activePlanId);
    setTimeout(() => {
      const row = rootEl?.querySelector(`.finance-row[data-id="${created.id}"]`);
      row?.querySelector('.finance-input')?.focus();
      row?.querySelector('.finance-input')?.select();
    }, 0);
  } catch (err) {
    showToast(`Failed to create row: ${err}`, 'error');
  }
}

async function saveItemFromRow(rowEl) {
  const viewport = captureFinanceViewport(rowEl);
  const id = Number(rowEl.dataset.id);
  const nameInput = rowEl.querySelector('[data-field="name"]');
  const amountInput = rowEl.querySelector('[data-field="amount"]');
  const dueDayInput = rowEl.querySelector('[data-field="due-day"]');
  const dueDateInput = rowEl.querySelector('[data-field="due-date"]');
  const noteInput = rowEl.querySelector('[data-field="note"]');
  const name = nameInput?.value.trim() || 'Untitled item';
  const amountCents = parseMoneyToCents(amountInput?.value || '');
  if (amountCents == null) {
    showToast('Amount must be non-negative', 'error');
    return false;
  }
  let dueDay = rowEl.dataset.dueDay ? Number(rowEl.dataset.dueDay) : null;
  let dueDate = rowEl.dataset.dueDate || null;
  if (dueDayInput) {
    dueDay = parseDueDay(dueDayInput.value);
    if (dueDay === undefined) {
      showToast('Day must be between 1 and 31', 'error');
      return false;
    }
  }
  if (dueDateInput) {
    dueDate = dueDateInput.value.trim() || null;
  }
  const note = noteInput?.value.trim() || '';
  try {
    await call('update_finance_item', { id, name, amountCents, dueDay, dueDate, note });
    await loadAll(state.activePlanId);
    restoreFinanceViewport(viewport);
    return true;
  } catch (err) {
    showToast(`Failed to save row: ${err}`, 'error');
    return false;
  }
}

async function deleteItem(id) {
  try {
    await showModal({
      title: 'Delete finance row',
      body: 'Delete this row and all nested rows?',
      onConfirm: async () => {
        await call('delete_finance_item', { id });
      },
    });
    await loadAll(state.activePlanId);
  } catch (err) {
    if (String(err?.message || err) !== 'cancelled') {
      showToast(`Failed to delete row: ${err}`, 'error');
    }
  }
}

function clearItemDropClasses() {
  rootEl?.querySelectorAll('.finance-row.drop-before, .finance-row.drop-after, .finance-row.drop-inside')
    .forEach((row) => row.classList.remove('drop-before', 'drop-after', 'drop-inside'));
}

function startItemDrag(event, sourceRow) {
  if (event.button !== 0) return;
  event.preventDefault();
  const sourceId = Number(sourceRow.dataset.id);
  const ghost = sourceRow.cloneNode(true);
  ghost.className = 'finance-drag-ghost finance-row';
  ghost.style.width = `${sourceRow.getBoundingClientRect().width}px`;
  ghost.style.height = `${sourceRow.getBoundingClientRect().height}px`;
  document.body.appendChild(ghost);
  sourceRow.style.opacity = '0.35';
  state.itemDrag = { sourceId, sourceRow, ghost, drop: null };
  moveGhost(ghost, event.clientX, event.clientY);
  document.addEventListener('pointermove', onItemDragMove);
  document.addEventListener('pointerup', onItemDragEnd, { once: true });
}

function moveGhost(ghost, x, y) {
  ghost.style.left = `${x + 10}px`;
  ghost.style.top = `${y + 10}px`;
}

function onItemDragMove(event) {
  const drag = state.itemDrag;
  if (!drag) return;
  moveGhost(drag.ghost, event.clientX, event.clientY);
  clearItemDropClasses();
  drag.drop = null;

  const rows = [...rootEl.querySelectorAll('.finance-row')];
  const dropRows = rows.filter((row) => Number(row.dataset.id) !== drag.sourceId);
  const target = dropRows.find((row) => {
    const rect = row.getBoundingClientRect();
    return event.clientY >= rect.top && event.clientY <= rect.bottom;
  });
  if (!target) return;

  const targetId = Number(target.dataset.id);
  if (isDescendant(drag.sourceId, targetId)) return;
  const rect = target.getBoundingClientRect();
  const ratio = (event.clientY - rect.top) / Math.max(1, rect.height);
  let mode = 'inside';
  if (ratio < 0.28) mode = 'before';
  else if (ratio > 0.72) mode = 'after';
  target.classList.add(`drop-${mode}`);
  drag.drop = itemDropFromVisual(mode, target, dropRows);
}

function itemDropFromVisual(mode, target, rows) {
  const targetId = Number(target.dataset.id);
  const targetDepth = Number(target.dataset.depth) || 0;
  const targetParentId = target.dataset.parentId ? Number(target.dataset.parentId) : null;
  if (mode === 'inside') {
    return { parentId: targetId, beforeId: null, expandId: targetId };
  }
  if (mode === 'before') {
    return { parentId: targetParentId, beforeId: targetId, expandId: null };
  }

  const targetIndex = rows.indexOf(target);
  let afterIndex = targetIndex;
  while (afterIndex + 1 < rows.length && Number(rows[afterIndex + 1].dataset.depth) > targetDepth) {
    afterIndex += 1;
  }
  const next = rows[afterIndex + 1] || null;
  const nextBeforeId = next && Number(next.dataset.depth) === targetDepth
    ? Number(next.dataset.id)
    : null;
  return { parentId: targetParentId, beforeId: nextBeforeId, expandId: null };
}

async function onItemDragEnd() {
  const drag = state.itemDrag;
  if (!drag) return;
  document.removeEventListener('pointermove', onItemDragMove);
  clearItemDropClasses();
  drag.sourceRow.style.opacity = '';
  drag.ghost.remove();
  state.itemDrag = null;

  if (!drag.drop) return;
  if (drag.drop.beforeId === drag.sourceId) return;
  try {
    if (drag.drop.expandId != null) {
      state.collapsed.delete(drag.drop.expandId);
      saveCollapsed();
    }
    await call('move_finance_item', {
      id: drag.sourceId,
      parentId: drag.drop.parentId,
      beforeId: drag.drop.beforeId,
    });
    await loadAll(state.activePlanId);
  } catch (err) {
    showToast(`Failed to move row: ${err}`, 'error');
    await loadAll(state.activePlanId);
  }
}

function startPlanDrag(event, sourceCard) {
  if (event.button !== 0) return;
  event.preventDefault();
  const list = sourceCard.parentElement;
  const ghost = sourceCard.cloneNode(true);
  ghost.className = 'finance-drag-ghost finance-plan-card';
  ghost.style.width = `${sourceCard.getBoundingClientRect().width}px`;
  document.body.appendChild(ghost);
  const placeholder = document.createElement('div');
  placeholder.className = 'finance-plan-placeholder';
  list.insertBefore(placeholder, sourceCard.nextSibling);
  sourceCard.style.display = 'none';
  state.planDrag = { sourceCard, ghost, placeholder, list };
  moveGhost(ghost, event.clientX, event.clientY);
  document.addEventListener('pointermove', onPlanDragMove);
  document.addEventListener('pointerup', onPlanDragEnd, { once: true });
}

function onPlanDragMove(event) {
  const drag = state.planDrag;
  if (!drag) return;
  moveGhost(drag.ghost, event.clientX, event.clientY);
  const peers = [...drag.list.querySelectorAll('.finance-plan-card')]
    .filter((card) => card !== drag.sourceCard);
  let before = null;
  for (const peer of peers) {
    const rect = peer.getBoundingClientRect();
    if (event.clientY < rect.top + rect.height / 2) {
      before = peer;
      break;
    }
  }
  drag.list.insertBefore(drag.placeholder, before);
}

async function onPlanDragEnd() {
  const drag = state.planDrag;
  if (!drag) return;
  document.removeEventListener('pointermove', onPlanDragMove);
  drag.list.insertBefore(drag.sourceCard, drag.placeholder);
  drag.sourceCard.style.display = '';
  drag.placeholder.remove();
  drag.ghost.remove();
  state.planDrag = null;

  const ids = [...drag.list.querySelectorAll('.finance-plan-card')]
    .map((card) => Number(card.dataset.id))
    .filter(Number.isFinite);
  try {
    await call('reorder_finance_plans', { ids });
    await loadAll(state.activePlanId);
  } catch (err) {
    showToast(`Failed to reorder plans: ${err}`, 'error');
    await loadAll(state.activePlanId);
  }
}

export async function init(container) {
  injectStyles();
  loadCollapsed();
  loadCalendarUiState();
  installFinanceViewHistoryListener();
  rootEl = container;
  rootEl.classList.add('finance-tab');
  rootEl.innerHTML = '<div class="loading">Loading finance...</div>';
  try {
    await loadFinanceDisplaySettings();
    await loadAll();
  } catch (err) {
    rootEl.innerHTML = '';
    const error = document.createElement('div');
    error.className = 'loading';
    error.textContent = `Failed to load Finance: ${String(err)}`;
    rootEl.appendChild(error);
  }
}
