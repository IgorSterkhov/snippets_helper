import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import FinanceScreen from '../../src/screens/Finance/FinanceScreen';

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
  ]),
  getFinanceItemMoveAvailability: jest.fn(() => ({ up: false, down: false, left: false, right: false })),
  getFinanceItems: jest.fn().mockResolvedValue([
    { uuid: 'item-1', id: 10, plan_uuid: 'plan-1', parent_uuid: null, name: 'Подписки', amount_cents: 50000, is_deleted: 0 },
  ]),
  getFinanceMappingRules: jest.fn().mockResolvedValue([]),
  getFinancePlans: jest.fn().mockResolvedValue([
    { uuid: 'plan-1', id: 1, name: 'Regular monthly', currency: 'RUB', kind: 'monthly', is_deleted: 0 },
  ]),
  getFinanceTransactionAllocations: jest.fn().mockResolvedValue([]),
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
  createFinanceTransactionAllocation: jest.fn().mockResolvedValue({ uuid: 'allocation-new' }),
}));

describe('FinanceScreen facts mode', () => {
  test('renders synced facts and opens mapping sheet', async () => {
    const screen = render(<FinanceScreen />);

    await waitFor(() => expect(screen.getByText('Facts')).toBeTruthy());
    fireEvent.press(screen.getByText('Facts'));

    await waitFor(() => expect(screen.getByText('Т-Мобайл +7 995 644-94-38')).toBeTruthy());
    expect(screen.getAllByText('Unmapped').length).toBeGreaterThan(0);

    fireEvent.press(screen.getByText('Map'));
    await waitFor(() => expect(screen.getByText('Map finance fact')).toBeTruthy());
  });
});
