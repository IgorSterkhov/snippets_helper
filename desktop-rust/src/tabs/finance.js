import { call } from '../tauri-api.js';
import { showModal } from '../components/modal.js';
import { showToast } from '../components/toast.js';

const COLLAPSE_KEY = 'finance.collapsed.items';
const PLAN_KINDS = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'project', label: 'Project' },
  { value: 'one_time', label: 'One-time' },
  { value: 'general', label: 'General' },
];
const PLAN_KIND_LABELS = Object.fromEntries(PLAN_KINDS.map((kind) => [kind.value, kind.label]));

let rootEl = null;
let state = {
  plans: [],
  items: [],
  activePlanId: null,
  collapsed: new Set(),
  itemDrag: null,
  planDrag: null,
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
}
.finance-shell {
  flex: 1;
  min-height: 0;
  display: flex;
  background: var(--bg);
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
  height: 28px;
  padding: 0 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
  color: var(--text);
  cursor: pointer;
  font-size: 12px;
}
.finance-icon-btn:hover,
.finance-small-btn:hover {
  border-color: var(--accent);
}
.finance-plan-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
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
  background: var(--bg-hover);
}
.finance-plan-card.active {
  background: color-mix(in srgb, var(--accent) 18%, var(--bg-secondary));
  border-color: color-mix(in srgb, var(--accent) 48%, var(--border));
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
.finance-plan-edit {
  display: grid;
  grid-template-columns: minmax(160px, 320px) 72px 120px auto;
  gap: 8px;
  align-items: center;
  min-width: 0;
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
  background: var(--bg);
  color: var(--text);
  height: 28px;
  padding: 4px 8px;
  font-size: 12px;
}
.finance-select {
  padding-right: 24px;
}
.finance-summary {
  display: grid;
  grid-template-columns: repeat(3, minmax(120px, 1fr));
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border);
}
.finance-stat {
  border: 1px solid var(--border);
  border-radius: 7px;
  padding: 8px 10px;
  background: var(--bg-secondary);
}
.finance-stat-label {
  color: var(--text-muted);
  font-size: 11px;
  margin-bottom: 4px;
}
.finance-stat-value {
  font-size: 17px;
  font-weight: 700;
}
.finance-table-wrap {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 10px 12px 14px;
}
.finance-tree {
  min-width: 900px;
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
  background: var(--bg);
}
.finance-table-head,
.finance-row {
  display: grid;
  grid-template-columns: 24px 28px minmax(200px, 1.6fr) 118px 108px 130px minmax(140px, 1fr) 74px;
  align-items: center;
  gap: 0;
}
.finance-table-head {
  min-height: 34px;
  color: var(--text-muted);
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border);
  font-size: 11px;
  text-transform: uppercase;
}
.finance-table-head > div,
.finance-row > div {
  padding: 0 8px;
}
.finance-row {
  min-height: 38px;
  border-bottom: 1px solid color-mix(in srgb, var(--border) 72%, transparent);
  position: relative;
}
.finance-row:last-child {
  border-bottom: 0;
}
.finance-row:hover {
  background: var(--bg-hover);
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
  background: color-mix(in srgb, var(--accent) 12%, var(--bg));
}
.finance-toggle {
  width: 22px;
  height: 24px;
  border: 0;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
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

function currencyOfActivePlan() {
  return state.plans.find((plan) => planId(plan) === state.activePlanId)?.currency || 'RUB';
}

function activePlanKind() {
  const kind = state.plans.find((plan) => planId(plan) === state.activePlanId)?.kind;
  return PLAN_KIND_LABELS[kind] ? kind : 'monthly';
}

function planKindLabel(kind) {
  return PLAN_KIND_LABELS[kind] || PLAN_KIND_LABELS.monthly;
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

function amountInputValue(amountCents) {
  const amount = (Number(amountCents) || 0) / 100;
  return amount ? String(amount).replace('.', ',') : '';
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
  state.items = await call('list_finance_items', { planId: state.activePlanId });
  render();
}

function render() {
  if (!rootEl) return;
  rootEl.innerHTML = '';
  rootEl.classList.add('finance-tab');

  const shell = document.createElement('div');
  shell.className = 'finance-shell';
  shell.appendChild(renderSidebar());
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

function renderPlanCard(plan) {
  const id = planId(plan);
  const card = document.createElement('div');
  card.className = 'finance-plan-card' + (id === state.activePlanId ? ' active' : '');
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
    await loadAll(id);
  });

  card.append(grip, name, meta);
  return card;
}

function renderMain() {
  const main = document.createElement('main');
  main.className = 'finance-main';
  const activePlan = state.plans.find((plan) => planId(plan) === state.activePlanId) || null;

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
  main.appendChild(renderTree(roots, children, totals));
  return main;
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

  const edit = document.createElement('div');
  edit.className = 'finance-plan-edit';
  const nameInput = document.createElement('input');
  nameInput.className = 'finance-input';
  nameInput.value = plan.name || '';
  nameInput.placeholder = 'Plan name';
  const currencyInput = document.createElement('input');
  currencyInput.className = 'finance-input';
  currencyInput.value = plan.currency || 'RUB';
  currencyInput.maxLength = 6;
  currencyInput.placeholder = 'RUB';
  const kindSelect = document.createElement('select');
  kindSelect.className = 'finance-select';
  for (const option of PLAN_KINDS) {
    const el = document.createElement('option');
    el.value = option.value;
    el.textContent = option.label;
    kindSelect.appendChild(el);
  }
  kindSelect.value = PLAN_KIND_LABELS[plan.kind] ? plan.kind : 'monthly';
  const saveBtn = document.createElement('button');
  saveBtn.className = 'finance-small-btn';
  saveBtn.type = 'button';
  saveBtn.textContent = 'Save';
  saveBtn.addEventListener('click', async () => {
    try {
      await call('update_finance_plan', {
        id: state.activePlanId,
        name: nameInput.value.trim() || 'Untitled list',
        currency: currencyInput.value.trim().toUpperCase() || 'RUB',
        kind: kindSelect.value,
      });
      showToast('Finance list saved', 'success');
      await loadAll(state.activePlanId);
    } catch (err) {
      showToast(`Failed to save list: ${err}`, 'error');
    }
  });
  edit.append(nameInput, currencyInput, kindSelect, saveBtn);

  const actions = document.createElement('div');
  actions.className = 'finance-header-actions';
  const addRow = document.createElement('button');
  addRow.className = 'finance-small-btn';
  addRow.type = 'button';
  addRow.textContent = '+ Row';
  addRow.addEventListener('click', () => createItem(null, false));
  const addGroup = document.createElement('button');
  addGroup.className = 'finance-small-btn';
  addGroup.type = 'button';
  addGroup.textContent = '+ Group';
  addGroup.addEventListener('click', () => createItem(null, true));
  const delPlan = document.createElement('button');
  delPlan.className = 'finance-small-btn';
  delPlan.type = 'button';
  delPlan.textContent = 'Del';
  delPlan.addEventListener('click', deleteActivePlan);
  actions.append(addRow, addGroup, delPlan);

  header.append(edit, actions);
  return header;
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

function renderTree(roots, children, totals) {
  const wrap = document.createElement('div');
  wrap.className = 'finance-table-wrap';
  if (!state.items.length) {
    const empty = document.createElement('div');
    empty.className = 'finance-empty';
    empty.textContent = 'No expense rows yet. Add a row or group.';
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
  for (const row of rows) {
    tree.appendChild(renderItemRow(row, children, totals));
  }
  wrap.appendChild(tree);
  return wrap;
}

function renderItemRow(row, children, totals) {
  const { item, depth } = row;
  const id = itemId(item);
  const childCount = (children.get(id) || []).length;
  const rowEl = document.createElement('div');
  rowEl.className = 'finance-row';
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
  addChild.addEventListener('click', () => createItem(id, false));
  const del = document.createElement('button');
  del.className = 'finance-icon-btn';
  del.type = 'button';
  del.title = 'Delete row';
  del.textContent = 'Del';
  del.addEventListener('click', () => deleteItem(id));
  actionCell.append(addChild, del);

  rowEl.append(gripCell, toggleCell, nameCell, amountCell, dateCell, totalCell, noteCell, actionCell);
  return rowEl;
}

async function createPlan() {
  try {
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

async function createItem(parentId, asGroup) {
  try {
    const created = await call('create_finance_item', {
      planId: state.activePlanId,
      parentId,
      name: asGroup ? 'New group' : 'New item',
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
    return;
  }
  let dueDay = rowEl.dataset.dueDay ? Number(rowEl.dataset.dueDay) : null;
  let dueDate = rowEl.dataset.dueDate || null;
  if (dueDayInput) {
    dueDay = parseDueDay(dueDayInput.value);
    if (dueDay === undefined) {
      showToast('Day must be between 1 and 31', 'error');
      return;
    }
  }
  if (dueDateInput) {
    dueDate = dueDateInput.value.trim() || null;
  }
  const note = noteInput?.value.trim() || '';
  try {
    await call('update_finance_item', { id, name, amountCents, dueDay, dueDate, note });
    await loadAll(state.activePlanId);
  } catch (err) {
    showToast(`Failed to save row: ${err}`, 'error');
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
  rootEl = container;
  rootEl.classList.add('finance-tab');
  rootEl.innerHTML = '<div class="loading">Loading finance...</div>';
  try {
    await loadAll();
  } catch (err) {
    rootEl.innerHTML = '';
    const error = document.createElement('div');
    error.className = 'loading';
    error.textContent = `Failed to load Finance: ${String(err)}`;
    rootEl.appendChild(error);
  }
}
