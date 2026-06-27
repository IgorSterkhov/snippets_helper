import {
  applyFinanceMappingRule,
  buildUpsertFinanceTransaction,
  buildUpsertFinanceTransactionAllocation,
  buildUpsertFinanceItem,
  buildUpsertFinanceMappingRule,
  buildUpsertFinancePlan,
  clearSyncedFinanceRows,
  clearSyncedFinanceTransactionAllocations,
  computeFinanceTotals,
  createFinanceMappingRule,
  createFinanceTransactionAllocation,
  deleteFinancePlan,
  financeBandSlotForDepth,
  flattenFinanceTree,
  getFinanceItemMoveAvailability,
  getModifiedFinanceItemsSince,
  getModifiedFinancePlansSince,
  getModifiedFinanceTransactionAllocationsSince,
  maxFinanceTreeDepth,
  moveFinanceItemInTree,
} from '../../src/db/financeRepo';
import { getDB } from '../../src/db/database';

jest.mock('../../src/db/database');

describe('financeRepo', () => {
  const mockExecuteSql = jest.fn();
  const mockTx = { executeSql: mockExecuteSql };

  beforeEach(() => {
    jest.clearAllMocks();
    getDB.mockReturnValue({
      transaction: jest.fn((cb) => cb(mockTx)),
    });
    mockExecuteSql.mockImplementation((sql, params, success) => {
      if (success) success(mockTx, { rows: { length: 0, item: () => ({}) } });
    });
  });

  test('builders write Finance UUID relationships', () => {
    const plan = buildUpsertFinancePlan({
      uuid: 'plan-1',
      id: 42,
      name: 'Budget',
      currency: 'rub',
      kind: 'project',
      updated_at: '2026-06-11T10:00:00',
    });
    expect(plan.sql).toContain('finance_plans');
    expect(plan.params).toEqual(expect.arrayContaining(['plan-1', 42, 'Budget', 'RUB', 'project']));

    const item = buildUpsertFinanceItem({
      uuid: 'item-1',
      plan_uuid: 'plan-1',
      parent_uuid: 'parent-1',
      name: 'Hosting',
      amount_cents: 129900,
      due_day: 12,
      updated_at: '2026-06-11T10:00:00',
    });
    expect(item.sql).toContain('finance_items');
    expect(item.params).toEqual(expect.arrayContaining(['item-1', 'plan-1', 'parent-1', 'Hosting', 129900, 12]));

    const transaction = buildUpsertFinanceTransaction({
      uuid: 'tx-1',
      source: 'tbank_csv',
      source_fingerprint: 'fingerprint-1',
      payment_date: '2026-04-30',
      amount_cents: -19000,
      description: 'Т-Мобайл',
      updated_at: '2026-06-11T10:00:00',
    });
    expect(transaction.sql).toContain('finance_transactions');
    expect(transaction.params).toEqual(expect.arrayContaining(['tx-1', 'fingerprint-1', -19000, 'Т-Мобайл']));

    const rule = buildUpsertFinanceMappingRule({
      uuid: 'rule-1',
      name: 'Mobile',
      target_plan_uuid: 'plan-1',
      target_item_uuid: 'item-1',
      conditions_json: '[{"field":"description","op":"contains","value":"Т-Мобайл"}]',
      updated_at: '2026-06-11T10:00:00',
    });
    expect(rule.sql).toContain('finance_mapping_rules');
    expect(rule.params).toEqual(expect.arrayContaining(['rule-1', 'Mobile', 'plan-1', 'item-1']));

    const allocation = buildUpsertFinanceTransactionAllocation({
      uuid: 'allocation-1',
      transaction_uuid: 'tx-1',
      plan_uuid: 'plan-1',
      item_uuid: 'item-1',
      rule_uuid: 'rule-1',
      assigned_by: 'rule',
      updated_at: '2026-06-11T10:00:00',
    });
    expect(allocation.sql).toContain('finance_transaction_allocations');
    expect(allocation.params).toEqual(expect.arrayContaining(['allocation-1', 'tx-1', 'plan-1', 'item-1', 'rule-1']));
    expect(allocation.sql).toContain('sync_dirty');
    expect(allocation.sql).toContain('sync_status');
    expect(allocation.params[allocation.params.length - 2]).toBe(0);
    expect(allocation.params[allocation.params.length - 1]).toBe('synced');
  });

  test('pulled finance upserts preserve local pending rows', () => {
    const plan = buildUpsertFinancePlan({
      uuid: 'plan-1',
      name: 'Server plan',
      updated_at: '2026-06-27T12:00:00',
      __preserve_pending_sync_status: true,
    });
    const item = buildUpsertFinanceItem({
      uuid: 'item-1',
      plan_uuid: 'plan-1',
      name: 'Server item',
      updated_at: '2026-06-27T12:00:00',
      __preserve_pending_sync_status: true,
    });
    const allocation = buildUpsertFinanceTransactionAllocation({
      uuid: 'allocation-1',
      transaction_uuid: 'tx-1',
      plan_uuid: 'plan-1',
      updated_at: '2026-06-27T12:00:00',
      __preserve_pending_sync_status: true,
    });

    for (const built of [plan, item, allocation]) {
      expect(built.sql).toContain('ON CONFLICT(uuid) DO UPDATE');
      expect(built.sql).toContain("sync_status NOT IN ('pending', 'deleted')");
    }
  });

  test('flattenFinanceTree returns depth-first hierarchy and totals', () => {
    const rows = [
      { uuid: 'child-2', plan_uuid: 'plan', parent_uuid: 'root', name: 'B', amount_cents: 200, sort_order: 1, is_deleted: 0 },
      { uuid: 'root', plan_uuid: 'plan', parent_uuid: null, name: 'Root', amount_cents: 1000, sort_order: 0, is_deleted: 0 },
      { uuid: 'grand', plan_uuid: 'plan', parent_uuid: 'child-1', name: 'AA', amount_cents: 50, sort_order: 0, is_deleted: 0 },
      { uuid: 'child-1', plan_uuid: 'plan', parent_uuid: 'root', name: 'A', amount_cents: 300, sort_order: 0, is_deleted: 0 },
    ];

    expect(flattenFinanceTree(rows).map(({ item, depth }) => [item.uuid, depth])).toEqual([
      ['root', 0],
      ['child-1', 1],
      ['grand', 2],
      ['child-2', 1],
    ]);

    const totals = computeFinanceTotals(rows);
    expect(totals.grandTotal).toBe(1550);
    expect(totals.totals.get('root')).toBe(1550);
    expect(totals.totals.get('child-1')).toBe(350);
  });

  test('moveFinanceItemInTree moves, indents, and outdents rows', () => {
    const rows = [
      { uuid: 'a', plan_uuid: 'plan', parent_uuid: null, name: 'A', sort_order: 0, is_deleted: 0 },
      { uuid: 'b', plan_uuid: 'plan', parent_uuid: null, name: 'B', sort_order: 1, is_deleted: 0 },
      { uuid: 'c', plan_uuid: 'plan', parent_uuid: null, name: 'C', sort_order: 2, is_deleted: 0 },
    ];

    expect(getFinanceItemMoveAvailability(rows, 'b')).toEqual({
      up: true,
      down: true,
      left: false,
      right: true,
    });

    const indented = moveFinanceItemInTree(rows, 'b', 'right', '2026-06-11T12:00:00');
    expect(flattenFinanceTree(indented.items).map(({ item, depth }) => [item.uuid, depth])).toEqual([
      ['a', 0],
      ['b', 1],
      ['c', 0],
    ]);
    expect(indented.changed).toEqual(expect.arrayContaining([
      expect.objectContaining({ uuid: 'b', parent_uuid: 'a', sort_order: 0 }),
    ]));

    const outdented = moveFinanceItemInTree(indented.items, 'b', 'left', '2026-06-11T12:01:00');
    expect(flattenFinanceTree(outdented.items).map(({ item, depth }) => [item.uuid, depth])).toEqual([
      ['a', 0],
      ['b', 0],
      ['c', 0],
    ]);
  });

  test('band slots keep deepest visible depth neutral', () => {
    expect(financeBandSlotForDepth(0, 0, 'soft_first')).toBeNull();
    expect(financeBandSlotForDepth(0, 1, 'soft_first')).toBe(2);
    expect(financeBandSlotForDepth(1, 1, 'soft_first')).toBeNull();
    expect(financeBandSlotForDepth(0, 2, 'soft_first')).toBe(1);
    expect(financeBandSlotForDepth(1, 2, 'soft_first')).toBe(2);
    expect(financeBandSlotForDepth(2, 2, 'soft_first')).toBeNull();
  });

  test('band slots use full tree depth when rows are collapsed', () => {
    const rows = [
      { uuid: 'root', plan_uuid: 'plan', parent_uuid: null, name: 'Root', sort_order: 0, is_deleted: 0 },
      { uuid: 'child', plan_uuid: 'plan', parent_uuid: 'root', name: 'Child', sort_order: 0, is_deleted: 0 },
      { uuid: 'grand', plan_uuid: 'plan', parent_uuid: 'child', name: 'Grand', sort_order: 0, is_deleted: 0 },
    ];
    const collapsed = flattenFinanceTree(rows, { collapsedIds: new Set(['root']) });

    expect(collapsed.map(({ item, depth }) => [item.uuid, depth])).toEqual([['root', 0]]);
    expect(maxFinanceTreeDepth(rows)).toBe(2);
    expect(financeBandSlotForDepth(collapsed[0].depth, maxFinanceTreeDepth(rows), 'soft_first')).toBe(1);
  });

  test('deleteFinancePlan soft deletes plan and all items by plan_uuid', async () => {
    await deleteFinancePlan('plan-1');

    expect(mockExecuteSql).toHaveBeenCalledWith(
      'UPDATE finance_plans SET is_deleted = 1, updated_at = ?, sync_status = ? WHERE uuid = ?',
      [expect.any(String), 'deleted', 'plan-1'],
      expect.any(Function),
      expect.any(Function),
    );
    expect(mockExecuteSql).toHaveBeenCalledWith(
      'UPDATE finance_items SET is_deleted = 1, updated_at = ?, sync_status = ? WHERE plan_uuid = ?',
      [expect.any(String), 'deleted', 'plan-1'],
      expect.any(Function),
      expect.any(Function),
    );
  });

  test('pending finance rows are selected even when older than sync cursor', async () => {
    await getModifiedFinancePlansSince('2026-06-27T12:00:00');
    await getModifiedFinanceItemsSince('2026-06-27T12:00:00');
    await getModifiedFinanceTransactionAllocationsSince('2026-06-27T12:00:00');

    const sqls = mockExecuteSql.mock.calls.map((call) => String(call[0]));
    expect(sqls[0]).toContain("sync_status IN ('pending', 'deleted')");
    expect(sqls[1]).toContain("sync_status IN ('pending', 'deleted')");
    expect(sqls[2]).toContain("sync_status IN ('pending', 'deleted')");
    expect(sqls[2]).toContain('sync_dirty = 1');
    expect(mockExecuteSql.mock.calls[0][1]).toEqual(['2026-06-27T12:00:00']);
    expect(mockExecuteSql.mock.calls[1][1]).toEqual(['2026-06-27T12:00:00']);
    expect(mockExecuteSql.mock.calls[2][1]).toEqual(['2026-06-27T12:00:00']);
  });

  test('createFinanceTransactionAllocation writes UUID relations and locks rules when requested', async () => {
    await createFinanceTransactionAllocation({
      transaction: { uuid: 'tx-1', id: 11 },
      plan: { uuid: 'plan-1', id: 22 },
      item: { uuid: 'item-1', id: 33 },
      rulesLocked: true,
    });

    expect(mockExecuteSql).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE finance_transaction_allocations'),
      [expect.any(String), 'tx-1'],
      expect.any(Function),
      expect.any(Function),
    );
    expect(mockExecuteSql.mock.calls[0][0]).toContain('sync_dirty = 1');
    expect(mockExecuteSql.mock.calls[0][0]).toContain("sync_status = 'pending'");
    expect(mockExecuteSql).toHaveBeenCalledWith(
      expect.stringContaining('finance_transaction_allocations'),
      expect.arrayContaining(['tx-1', 'plan-1', 'item-1', 'manual']),
      expect.any(Function),
      expect.any(Function),
    );
    const allocationInsertCall = mockExecuteSql.mock.calls.find((call) => String(call[0]).includes('INSERT OR REPLACE INTO finance_transaction_allocations'));
    expect(allocationInsertCall[0]).toContain('sync_dirty');
    expect(allocationInsertCall[0]).toContain('sync_status');
    expect(allocationInsertCall[1][allocationInsertCall[1].length - 2]).toBe(1);
    expect(allocationInsertCall[1][allocationInsertCall[1].length - 1]).toBe('pending');
    expect(mockExecuteSql).toHaveBeenCalledWith(
      'UPDATE finance_transactions SET rules_locked = ?, updated_at = ?, sync_status = ? WHERE uuid = ?',
      [1, expect.any(String), 'pending', 'tx-1'],
      expect.any(Function),
      expect.any(Function),
    );
  });

  test('clearSyncedFinanceRows marks accepted finance rows synced', async () => {
    await clearSyncedFinanceRows('finance_transaction_allocations', ['allocation-1', 'allocation-2']);

    expect(mockExecuteSql).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE finance_transaction_allocations'),
      ['allocation-1', 'allocation-2'],
      expect.any(Function),
      expect.any(Function),
    );
    expect(mockExecuteSql.mock.calls[0][0]).toContain('sync_dirty = 0');
    expect(mockExecuteSql.mock.calls[0][0]).toContain("sync_status = 'synced'");
    expect(mockExecuteSql.mock.calls[0][0]).toContain('uuid IN (?, ?)');
  });

  test('clearSyncedFinanceTransactionAllocations remains a compatibility wrapper', async () => {
    await clearSyncedFinanceTransactionAllocations(['allocation-1']);

    expect(mockExecuteSql.mock.calls[0][0]).toContain('sync_status');
    expect(mockExecuteSql.mock.calls[0][0]).toContain('sync_dirty');
  });

  test('applyFinanceMappingRule maps matching unlocked facts only', async () => {
    mockExecuteSql.mockImplementation((sql, params, success) => {
      let rows = [];
      if (String(sql).includes('FROM finance_transactions')) {
        rows = [
          {
            uuid: 'tx-match',
            description: 'Яндекс Такси',
            bank_category: 'Такси',
            amount_cents: -50600,
            rules_locked: 0,
            is_deleted: 0,
          },
          {
            uuid: 'tx-locked',
            description: 'Яндекс Такси',
            bank_category: 'Такси',
            amount_cents: -23900,
            rules_locked: 1,
            is_deleted: 0,
          },
        ];
      } else if (String(sql).includes('FROM finance_transaction_allocations')) {
        rows = [];
      }
      if (success) {
        success(mockTx, {
          rows: {
            length: rows.length,
            item: (index) => rows[index],
          },
        });
      }
    });

    const count = await applyFinanceMappingRule({
      uuid: 'rule-1',
      id: 7,
      is_enabled: 1,
      match_mode: 'all',
      target_plan_uuid: 'plan-1',
      target_plan_id: 22,
      target_item_uuid: 'item-1',
      target_item_id: 33,
      conditions_json: JSON.stringify([
        { field: 'bank_category', op: 'contains', value: 'Такси' },
        { field: 'direction', op: 'equals', value: 'expense' },
      ]),
    });

    expect(count).toBe(1);
    expect(mockExecuteSql).toHaveBeenCalledWith(
      expect.stringContaining('finance_transaction_allocations'),
      expect.arrayContaining(['tx-match', 'plan-1', 'item-1', 'rule']),
      expect.any(Function),
      expect.any(Function),
    );
  });

  test('finance rules support desktop-shaped amount range conditions', async () => {
    mockExecuteSql.mockImplementation((sql, params, success) => {
      let rows = [];
      if (String(sql).includes('FROM finance_transactions')) {
        rows = [
          {
            uuid: 'tx-in-range',
            description: 'Taxi',
            bank_category: 'Такси',
            amount_cents: -50600,
            rules_locked: 0,
            is_deleted: 0,
          },
          {
            uuid: 'tx-out-of-range',
            description: 'Taxi',
            bank_category: 'Такси',
            amount_cents: -250000,
            rules_locked: 0,
            is_deleted: 0,
          },
        ];
      } else if (String(sql).includes('FROM finance_transaction_allocations')) {
        rows = [];
      }
      if (success) {
        success(mockTx, {
          rows: {
            length: rows.length,
            item: (index) => rows[index],
          },
        });
      }
    });

    const count = await applyFinanceMappingRule({
      uuid: 'rule-amount',
      is_enabled: 1,
      match_mode: 'all',
      target_plan_uuid: 'plan-1',
      target_item_uuid: 'item-1',
      conditions_json: JSON.stringify([
        { field: 'amount_cents', op: 'gte', value: '-1000' },
        { field: 'amount_cents', op: 'lte', value: '-100' },
      ]),
    });

    expect(count).toBe(1);
    expect(mockExecuteSql).toHaveBeenCalledWith(
      expect.stringContaining('finance_transaction_allocations'),
      expect.arrayContaining(['tx-in-range', 'plan-1', 'item-1', 'rule']),
      expect.any(Function),
      expect.any(Function),
    );
  });

  test('createFinanceMappingRule can apply the new rule to existing facts', async () => {
    mockExecuteSql.mockImplementation((sql, params, success) => {
      let rows = [];
      if (String(sql).includes('FROM finance_transactions')) {
        rows = [
          {
            uuid: 'tx-1',
            description: 'Boosty.to',
            bank_category: 'Цифровые товары',
            amount_cents: -50000,
            rules_locked: 0,
            is_deleted: 0,
          },
        ];
      } else if (String(sql).includes('FROM finance_transaction_allocations')) {
        rows = [];
      }
      if (success) {
        success(mockTx, {
          rows: {
            length: rows.length,
            item: (index) => rows[index],
          },
        });
      }
    });

    const result = await createFinanceMappingRule({
      name: 'Digital subscriptions',
      targetPlan: { uuid: 'plan-1', id: 22 },
      targetItem: { uuid: 'item-1', id: 33 },
      conditions: [{ field: 'bank_category', op: 'contains', value: 'Цифровые товары' }],
      applyExisting: true,
    });

    expect(result.appliedCount).toBe(1);
    expect(mockExecuteSql).toHaveBeenCalledWith(
      expect.stringContaining('finance_mapping_rules'),
      expect.arrayContaining(['Digital subscriptions', 'plan-1', 'item-1']),
      expect.any(Function),
      expect.any(Function),
    );
  });
});
