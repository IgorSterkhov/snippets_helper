import {
  buildUpsertFinanceItem,
  buildUpsertFinancePlan,
  computeFinanceTotals,
  deleteFinancePlan,
  financeBandSlotForDepth,
  flattenFinanceTree,
  getFinanceItemMoveAvailability,
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

  test('deleteFinancePlan soft deletes plan and all items by plan_uuid', async () => {
    await deleteFinancePlan('plan-1');

    expect(mockExecuteSql).toHaveBeenCalledWith(
      'UPDATE finance_plans SET is_deleted = 1, updated_at = ? WHERE uuid = ?',
      [expect.any(String), 'plan-1'],
      expect.any(Function),
      expect.any(Function),
    );
    expect(mockExecuteSql).toHaveBeenCalledWith(
      'UPDATE finance_items SET is_deleted = 1, updated_at = ? WHERE plan_uuid = ?',
      [expect.any(String), 'plan-1'],
      expect.any(Function),
      expect.any(Function),
    );
  });
});
