import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import FinanceScreen from '../../src/screens/Finance/FinanceScreen';
import * as financeRepo from '../../src/db/financeRepo';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn().mockResolvedValue(null),
  setItem: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (callback) => {
    const ReactMock = require('react');
    ReactMock.useEffect(() => callback(), [callback]);
  },
}));

jest.mock('../../src/theme/ThemeContext', () => ({
  useTheme: () => ({
    colors: {
      bg: '#111111',
      bgSecondary: '#181818',
      bgTertiary: '#222222',
      card: '#1f1f1f',
      border: '#333333',
      text: '#eeeeee',
      textSecondary: '#bbbbbb',
      textMuted: '#888888',
      primary: '#2f81f7',
      primaryLight: '#2f81f733',
      danger: '#f85149',
      success: '#30d158',
    },
  }),
}));

jest.mock('../../src/components/ShareLinkSheet', () => () => null);
jest.mock('../../src/components/SyncStatusBar', () => () => null);

jest.mock('../../src/sync/syncService', () => ({
  notifyLocalChange: jest.fn(),
  performSync: jest.fn().mockResolvedValue(undefined),
  subscribeSyncStatus: jest.fn(() => jest.fn()),
}));

jest.mock('../../src/lib/uuid', () => ({
  uuidv4: jest.fn(() => 'uuid-new'),
}));

jest.mock('../../src/db/financeRepo', () => ({
  FINANCE_PLAN_KINDS: ['monthly', 'project', 'one_time', 'general'],
  computeFinanceTotals: jest.fn(() => ({ grandTotal: 50000, totals: new Map([['item-1', 50000]]) })),
  deleteFinanceItem: jest.fn(),
  deleteFinancePlan: jest.fn(),
  financeBandSlotForDepth: jest.fn(() => null),
  flattenFinanceTree: jest.fn(() => []),
  getAllFinanceItems: jest.fn().mockResolvedValue([
    { uuid: 'item-1', id: 10, plan_uuid: 'plan-1', parent_uuid: null, name: 'Подписки', amount_cents: 50000, is_deleted: 0 },
    { uuid: 'item-2', id: 11, plan_uuid: 'plan-1', parent_uuid: 'item-1', name: 'Boosty', amount_cents: 50000, is_deleted: 0 },
  ]),
  getFinanceItemMoveAvailability: jest.fn(() => ({ up: false, down: false, left: false, right: false })),
  getFinanceItems: jest.fn().mockResolvedValue([
    { uuid: 'item-1', id: 10, plan_uuid: 'plan-1', parent_uuid: null, name: 'Подписки', amount_cents: 50000, is_deleted: 0 },
    { uuid: 'item-2', id: 11, plan_uuid: 'plan-1', parent_uuid: 'item-1', name: 'Boosty', amount_cents: 50000, is_deleted: 0 },
  ]),
  getFinanceMappingRules: jest.fn().mockResolvedValue([]),
  getFinancePlans: jest.fn().mockResolvedValue([
    { uuid: 'plan-1', id: 1, name: 'Regular monthly', currency: 'RUB', kind: 'monthly', is_deleted: 0 },
  ]),
  getFinanceTransactionAllocations: jest.fn().mockResolvedValue([
    {
      uuid: 'allocation-1',
      id: 200,
      transaction_uuid: 'tx-1',
      transaction_id: 100,
      plan_uuid: 'plan-1',
      plan_id: 1,
      item_uuid: 'item-1',
      item_id: 10,
      is_active: 1,
      is_deleted: 0,
    },
  ]),
  getFinanceTransactions: jest.fn().mockResolvedValue([
    {
      uuid: 'tx-1',
      id: 100,
      payment_date: '2026-04-30',
      operation_at: '2026-04-30 21:14:16',
      amount_cents: -19000,
      currency: 'RUB',
      bank_category: 'Мобильная связь',
      mcc: '',
      card_mask: '*8907',
      description: 'Т-Мобайл +7 995 644-94-38',
      rules_locked: 0,
      is_deleted: 0,
    },
  ]),
  getNextFinanceItemSortOrder: jest.fn().mockResolvedValue(1),
  getNextFinancePlanSortOrder: jest.fn().mockResolvedValue(1),
  maxFinanceTreeDepth: jest.fn(() => 0),
  moveFinanceItemInTree: jest.fn(),
  upsertFinanceItem: jest.fn(),
  upsertFinanceItems: jest.fn(),
  upsertFinancePlan: jest.fn(),
  createFinanceMappingRule: jest.fn().mockResolvedValue({ appliedCount: 0, rule: { uuid: 'rule-new' } }),
  updateFinanceMappingRule: jest.fn().mockResolvedValue({ rule: { uuid: 'rule-taxi' }, appliedCount: 0 }),
  createFinanceTransactionAllocation: jest.fn().mockResolvedValue({ uuid: 'allocation-new' }),
}));

describe('FinanceScreen facts mode', () => {
  beforeEach(() => {
    financeRepo.getAllFinanceItems.mockResolvedValue([
      { uuid: 'item-1', id: 10, plan_uuid: 'plan-1', parent_uuid: null, name: 'Подписки', amount_cents: 50000, is_deleted: 0 },
      { uuid: 'item-2', id: 11, plan_uuid: 'plan-1', parent_uuid: 'item-1', name: 'Boosty', amount_cents: 50000, is_deleted: 0 },
    ]);
    financeRepo.getFinanceTransactionAllocations.mockResolvedValue([
      {
        uuid: 'allocation-1',
        id: 200,
        transaction_uuid: 'tx-1',
        transaction_id: 100,
        plan_uuid: 'plan-1',
        plan_id: 1,
        item_uuid: 'item-1',
        item_id: 10,
        is_active: 1,
        is_deleted: 0,
      },
    ]);
  });

  test('renders synced facts and opens mapping sheet', async () => {
    financeRepo.getFinanceTransactionAllocations.mockResolvedValue([]);
    const screen = render(<FinanceScreen />);

    await waitFor(() => expect(screen.getByText('Facts')).toBeTruthy());
    fireEvent.press(screen.getByText('Facts'));

    await waitFor(() => expect(screen.getByText('Т-Мобайл +7 995 644-94-38')).toBeTruthy());
    expect(screen.getAllByText('Unmapped').length).toBeGreaterThan(0);
    expect(screen.queryByText('Group target')).toBeNull();

    fireEvent.press(screen.getByText('Map'));
    await waitFor(() => expect(screen.getByText('Map finance fact')).toBeTruthy());
  });

  test('searches facts by any field', async () => {
    financeRepo.getFinanceTransactionAllocations.mockResolvedValue([]);
    const screen = render(<FinanceScreen />);

    await waitFor(() => expect(screen.getByText('Facts')).toBeTruthy());
    fireEvent.press(screen.getByText('Facts'));

    await waitFor(() => expect(screen.getByPlaceholderText('Search facts')).toBeTruthy());
    fireEvent.changeText(screen.getByPlaceholderText('Search facts'), 'boosty');

    await waitFor(() => expect(screen.getByText('No finance facts for this filter')).toBeTruthy());
  });

  test('marks facts mapped to group items', async () => {
    const screen = render(<FinanceScreen />);

    await waitFor(() => expect(screen.getByText('Facts')).toBeTruthy());
    fireEvent.press(screen.getByText('Facts'));

    await waitFor(() => expect(screen.getByText('Group target')).toBeTruthy());
    expect(screen.getAllByText('!').length).toBeGreaterThan(0);
    fireEvent.press(screen.getByText('Group target'));
    await waitFor(() => expect(screen.getByText('Т-Мобайл +7 995 644-94-38')).toBeTruthy());

    fireEvent.changeText(screen.getByPlaceholderText('Search facts'), 'not matching');
    await waitFor(() => expect(screen.getByText('Group target')).toBeTruthy());
    fireEvent.press(screen.getByText('Group target'));
    await waitFor(() => expect(screen.getByText('Т-Мобайл +7 995 644-94-38')).toBeTruthy());
    expect(screen.getByPlaceholderText('Search facts').props.value).toBe('');
  });

  test('edits existing mapping rule direction to any', async () => {
    financeRepo.getFinanceMappingRules.mockResolvedValue([
      {
        uuid: 'rule-taxi',
        id: 77,
        name: 'Taxi rule',
        is_enabled: 1,
        priority: 3,
        match_mode: 'all',
        conditions_json: JSON.stringify([
          { field: 'bank_category', op: 'contains', value: 'Такси' },
          { field: 'direction', op: 'equals', value: 'expense' },
        ]),
        target_plan_uuid: 'plan-1',
        target_plan_id: 1,
        target_item_uuid: 'item-2',
        target_item_id: 11,
      },
    ]);
    const screen = render(<FinanceScreen />);

    await waitFor(() => expect(screen.getByText('Facts')).toBeTruthy());
    fireEvent.press(screen.getByText('Facts'));
    await waitFor(() => expect(screen.getByText('Rules')).toBeTruthy());
    fireEvent.press(screen.getByText('Rules'));

    await waitFor(() => expect(screen.getByText('Finance mapping rules')).toBeTruthy());
    fireEvent.press(screen.getByText('Taxi rule'));
    fireEvent.press(screen.getAllByText('Any')[1]);
    fireEvent.press(screen.getByText('Save rule'));

    await waitFor(() => expect(financeRepo.updateFinanceMappingRule).toHaveBeenCalled());
    const payload = financeRepo.updateFinanceMappingRule.mock.calls[0][0];
    expect(payload.uuid).toBe('rule-taxi');
    expect(payload.conditions.some((condition) => condition.field === 'direction')).toBe(false);
    expect(payload.priority).toBe(3);
  });
});

describe('FinanceScreen lists mode', () => {
  beforeEach(() => {
    financeRepo.flattenFinanceTree.mockImplementation((items = []) => items.map((item) => ({
      item,
      depth: item.parent_uuid ? 1 : 0,
      hasChildren: false,
      hiddenDescendantCount: 0,
    })));
    financeRepo.getFinanceItems.mockResolvedValue([
      { uuid: 'item-1', id: 10, plan_uuid: 'plan-1', parent_uuid: null, name: 'Подписки', amount_cents: 50000, is_deleted: 0 },
    ]);
  });

  test('renders compact selected list header without visible delete icon', async () => {
    const screen = render(<FinanceScreen />);

    await waitFor(() => expect(screen.getByText('Regular monthly')).toBeTruthy());
    expect(screen.getByDisplayValue('RUB')).toBeTruthy();
    expect(screen.getByText('Monthly')).toBeTruthy();
    expect(screen.getByText('⋯')).toBeTruthy();
    expect(screen.queryByText('🗑')).toBeNull();
  });

  test('opens row editor immediately after adding a row', async () => {
    const screen = render(<FinanceScreen />);

    await waitFor(() => expect(screen.getByText('Добавить строку')).toBeTruthy());
    fireEvent.press(screen.getByText('Добавить строку'));

    await waitFor(() => expect(financeRepo.upsertFinanceItem).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText('Строка затрат')).toBeTruthy());
    expect(screen.getByPlaceholderText('Название')).toBeTruthy();
  });
});
