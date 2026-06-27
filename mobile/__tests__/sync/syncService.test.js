import { performFullPullFromServer, performSync } from '../../src/sync/syncService';
import * as endpoints from '../../src/api/endpoints';
import * as snippetRepo from '../../src/db/snippetRepo';
import * as noteRepo from '../../src/db/noteRepo';
import * as taskRepo from '../../src/db/taskRepo';
import * as financeRepo from '../../src/db/financeRepo';
import * as syncMeta from '../../src/db/syncMetaRepo';
import { getDB } from '../../src/db/database';

jest.mock('../../src/api/endpoints');
jest.mock('../../src/db/snippetRepo');
jest.mock('../../src/db/noteRepo');
jest.mock('../../src/db/taskRepo');
jest.mock('../../src/db/financeRepo');
jest.mock('../../src/db/syncMetaRepo');
jest.mock('../../src/db/database', () => ({
  getDB: jest.fn(),
}));

describe('syncService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getDB.mockReturnValue({
      transaction: jest.fn((callback, error, success) => {
        callback({ executeSql: jest.fn() });
        if (success) success();
      }),
    });
    snippetRepo.buildUpsertSnippet.mockImplementation((row) => ({ sql: 'upsert shortcut', params: [row.uuid] }));
    snippetRepo.buildUpsertTag.mockImplementation((row) => ({ sql: 'upsert tag', params: [row.uuid] }));
    noteRepo.buildUpsertNote.mockImplementation((row) => ({ sql: 'upsert note', params: [row.uuid] }));
    noteRepo.buildUpsertFolder.mockImplementation((row) => ({ sql: 'upsert folder', params: [row.uuid] }));
    taskRepo.buildUpsertTaskCategory.mockImplementation((row) => ({ sql: 'upsert task category', params: [row.uuid] }));
    taskRepo.buildUpsertTaskStatus.mockImplementation((row) => ({ sql: 'upsert task status', params: [row.uuid] }));
    taskRepo.buildUpsertTask.mockImplementation((row) => ({ sql: 'upsert task', params: [row.uuid] }));
    taskRepo.buildUpsertTaskCheckbox.mockImplementation((row) => ({ sql: 'upsert task checkbox', params: [row.uuid] }));
    taskRepo.buildUpsertTaskLink.mockImplementation((row) => ({ sql: 'upsert task link', params: [row.uuid] }));
    financeRepo.buildUpsertFinancePlan.mockImplementation((row) => ({ sql: 'upsert finance plan', params: [row.uuid] }));
    financeRepo.buildUpsertFinanceItem.mockImplementation((row) => ({ sql: 'upsert finance item', params: [row.uuid] }));
    financeRepo.buildUpsertFinanceTransaction.mockImplementation((row) => ({ sql: 'upsert finance transaction', params: [row.uuid] }));
    financeRepo.buildUpsertFinanceMappingRule.mockImplementation((row) => ({ sql: 'upsert finance mapping rule', params: [row.uuid] }));
    financeRepo.buildUpsertFinanceTransactionAllocation.mockImplementation((row) => ({ sql: 'upsert finance allocation', params: [row.uuid] }));
    taskRepo.getModifiedTaskCategoriesSince.mockResolvedValue([]);
    taskRepo.getModifiedTaskStatusesSince.mockResolvedValue([]);
    taskRepo.getModifiedTasksSince.mockResolvedValue([]);
    taskRepo.getModifiedTaskCheckboxesSince.mockResolvedValue([]);
    taskRepo.getModifiedTaskLinksSince.mockResolvedValue([]);
    financeRepo.getModifiedFinancePlansSince.mockResolvedValue([]);
    financeRepo.getModifiedFinanceItemsSince.mockResolvedValue([]);
    financeRepo.getModifiedFinanceTransactionsSince.mockResolvedValue([]);
    financeRepo.getModifiedFinanceMappingRulesSince.mockResolvedValue([]);
    financeRepo.getModifiedFinanceTransactionAllocationsSince.mockResolvedValue([]);
    syncMeta.setLastSyncDebug.mockResolvedValue(undefined);
  });

  test('pull applies server changes to local DB', async () => {
    syncMeta.getLastSyncAt.mockResolvedValue(null);
    endpoints.syncPull.mockResolvedValue({
      changes: {
        shortcuts: [{ uuid: 's1', name: 'test', value: 'val', updated_at: '2026-01-01', is_deleted: false }],
        notes: [],
        note_folders: [],
        snippet_tags: [],
      },
      server_time: '2026-01-01T12:00:00',
    });
    endpoints.syncPush.mockResolvedValue({ status: 'ok', accepted: 0, conflicts: [] });
    snippetRepo.getModifiedSnippetsSince.mockResolvedValue([]);
    snippetRepo.getModifiedTagsSince.mockResolvedValue([]);
    noteRepo.getModifiedNotesSince.mockResolvedValue([]);
    noteRepo.getModifiedFoldersSince.mockResolvedValue([]);

    await performSync();

    expect(snippetRepo.buildUpsertSnippet).toHaveBeenCalledWith(
      expect.objectContaining({ uuid: 's1', name: 'test' }),
    );
    expect(syncMeta.setLastSyncAt).toHaveBeenCalledWith('2026-01-01T12:00:00');
  });

  test('push sends local changes to server', async () => {
    syncMeta.getLastSyncAt.mockResolvedValue('2026-01-01');
    endpoints.syncPull.mockResolvedValue({ changes: {}, server_time: '2026-01-02' });
    snippetRepo.getModifiedSnippetsSince.mockResolvedValue([
      { uuid: 's2', name: 'local', value: 'v', updated_at: '2026-01-01T06:00:00', is_deleted: 0 },
    ]);
    snippetRepo.getModifiedTagsSince.mockResolvedValue([]);
    noteRepo.getModifiedNotesSince.mockResolvedValue([]);
    noteRepo.getModifiedFoldersSince.mockResolvedValue([]);
    endpoints.syncPush.mockResolvedValue({ status: 'ok', accepted: 1, conflicts: [] });

    await performSync();

    expect(endpoints.syncPush).toHaveBeenCalledWith(
      expect.objectContaining({
        shortcuts: expect.arrayContaining([expect.objectContaining({ uuid: 's2' })]),
      }),
    );
  });

  test('sync includes task tables in pull and push', async () => {
    syncMeta.getLastSyncAt.mockResolvedValue('2026-05-23T09:00:00');
    endpoints.syncPull.mockResolvedValue({
      changes: {
        task_categories: [{ uuid: 'cat-1', name: 'Work', updated_at: '2026-05-23T10:00:00', is_deleted: false }],
        task_statuses: [],
        tasks: [{ uuid: 'task-1', title: 'Task', updated_at: '2026-05-23T10:00:00', is_deleted: false }],
        task_checkboxes: [],
        task_links: [],
      },
      server_time: '2026-05-23T10:00:00',
    });
    snippetRepo.getModifiedSnippetsSince.mockResolvedValue([]);
    snippetRepo.getModifiedTagsSince.mockResolvedValue([]);
    noteRepo.getModifiedNotesSince.mockResolvedValue([]);
    noteRepo.getModifiedFoldersSince.mockResolvedValue([]);
    taskRepo.getModifiedTasksSince.mockResolvedValue([
      { uuid: 'task-local', title: 'Local', updated_at: '2026-05-23T09:30:00' },
    ]);
    endpoints.syncPush.mockResolvedValue({ status: 'ok', accepted: 1, conflicts: [] });

    await performSync();

    expect(taskRepo.buildUpsertTaskCategory).toHaveBeenCalledWith(
      expect.objectContaining({ uuid: 'cat-1' }),
    );
    expect(taskRepo.buildUpsertTask).toHaveBeenCalledWith(
      expect.objectContaining({ uuid: 'task-1' }),
    );
    expect(endpoints.syncPush).toHaveBeenCalledWith(
      expect.objectContaining({
        tasks: expect.arrayContaining([expect.objectContaining({ uuid: 'task-local' })]),
      }),
    );
  });

  test('sync includes finance tables in pull and push', async () => {
    syncMeta.getLastSyncAt.mockResolvedValue('2026-06-11T09:00:00');
    endpoints.syncPull.mockResolvedValue({
      changes: {
        finance_plans: [{ uuid: 'plan-1', name: 'Budget', currency: 'RUB', kind: 'monthly', updated_at: '2026-06-11T10:00:00', is_deleted: false }],
        finance_items: [{ uuid: 'item-1', plan_uuid: 'plan-1', name: 'Hosting', amount_cents: 1000, updated_at: '2026-06-11T10:00:00', is_deleted: false }],
        finance_transactions: [{ uuid: 'tx-1', source_fingerprint: 'fp-1', payment_date: '2026-04-30', amount_cents: -19000, updated_at: '2026-06-11T10:00:00', is_deleted: false }],
        finance_mapping_rules: [{ uuid: 'rule-1', name: 'Mobile', target_plan_uuid: 'plan-1', target_item_uuid: 'item-1', conditions_json: '[]', updated_at: '2026-06-11T10:00:00', is_deleted: false }],
        finance_transaction_allocations: [{ uuid: 'allocation-1', transaction_uuid: 'tx-1', plan_uuid: 'plan-1', item_uuid: 'item-1', updated_at: '2026-06-11T10:00:00', is_deleted: false }],
      },
      server_time: '2026-06-11T10:00:00',
    });
    snippetRepo.getModifiedSnippetsSince.mockResolvedValue([]);
    snippetRepo.getModifiedTagsSince.mockResolvedValue([]);
    noteRepo.getModifiedNotesSince.mockResolvedValue([]);
    noteRepo.getModifiedFoldersSince.mockResolvedValue([]);
    financeRepo.getModifiedFinancePlansSince.mockResolvedValue([
      { uuid: 'plan-local', name: 'Local', updated_at: '2026-06-11T09:30:00' },
    ]);
    financeRepo.getModifiedFinanceItemsSince.mockResolvedValue([
      { uuid: 'item-local', plan_uuid: 'plan-local', name: 'Local item', updated_at: '2026-06-11T09:31:00' },
    ]);
    financeRepo.getModifiedFinanceTransactionsSince.mockResolvedValue([
      { uuid: 'tx-local', source_fingerprint: 'fp-local', amount_cents: -1200, updated_at: '2026-06-11T09:32:00' },
    ]);
    financeRepo.getModifiedFinanceMappingRulesSince.mockResolvedValue([
      { uuid: 'rule-local', target_plan_uuid: 'plan-local', target_item_uuid: 'item-local', updated_at: '2026-06-11T09:33:00' },
    ]);
    financeRepo.getModifiedFinanceTransactionAllocationsSince.mockResolvedValue([
      { uuid: 'allocation-local', transaction_uuid: 'tx-local', plan_uuid: 'plan-local', item_uuid: 'item-local', updated_at: '2026-06-11T09:34:00' },
    ]);
    endpoints.syncPush.mockResolvedValue({ status: 'ok', accepted: 2, conflicts: [] });

    await performSync();

    expect(financeRepo.buildUpsertFinancePlan).toHaveBeenCalledWith(
      expect.objectContaining({ uuid: 'plan-1' }),
    );
    expect(financeRepo.buildUpsertFinanceItem).toHaveBeenCalledWith(
      expect.objectContaining({ uuid: 'item-1', plan_uuid: 'plan-1' }),
    );
    expect(financeRepo.buildUpsertFinanceTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ uuid: 'tx-1' }),
    );
    expect(financeRepo.buildUpsertFinanceMappingRule).toHaveBeenCalledWith(
      expect.objectContaining({ uuid: 'rule-1', target_plan_uuid: 'plan-1' }),
    );
    expect(financeRepo.buildUpsertFinanceTransactionAllocation).toHaveBeenCalledWith(
      expect.objectContaining({ uuid: 'allocation-1', transaction_uuid: 'tx-1', plan_uuid: 'plan-1' }),
    );
    expect(endpoints.syncPush).toHaveBeenCalledWith(
      expect.objectContaining({
        finance_plans: expect.arrayContaining([expect.objectContaining({ uuid: 'plan-local' })]),
        finance_items: expect.arrayContaining([expect.objectContaining({ uuid: 'item-local' })]),
        finance_transactions: expect.arrayContaining([expect.objectContaining({ uuid: 'tx-local' })]),
        finance_mapping_rules: expect.arrayContaining([expect.objectContaining({ uuid: 'rule-local' })]),
        finance_transaction_allocations: expect.arrayContaining([expect.objectContaining({ uuid: 'allocation-local' })]),
      }),
    );
  });

  test('pull skips task child rows without task_uuid', async () => {
    syncMeta.getLastSyncAt.mockResolvedValue(null);
    endpoints.syncPull.mockResolvedValue({
      changes: {
        tasks: [{ uuid: 'task-1', title: 'Task', updated_at: '2026-05-23T10:00:00', is_deleted: false }],
        task_checkboxes: [
          { uuid: 'checkbox-valid', task_uuid: 'task-1', text: 'valid', updated_at: '2026-05-23T10:00:00' },
          { uuid: 'checkbox-invalid', task_uuid: null, text: 'invalid', updated_at: '2026-05-23T10:00:00' },
        ],
        task_links: [
          { uuid: 'link-valid', task_uuid: 'task-1', url: 'https://example.invalid', updated_at: '2026-05-23T10:00:00' },
          { uuid: 'link-invalid', task_uuid: null, url: 'https://example.invalid', updated_at: '2026-05-23T10:00:00' },
        ],
      },
      server_time: '2026-05-23T10:00:00',
    });
    snippetRepo.getModifiedSnippetsSince.mockResolvedValue([]);
    snippetRepo.getModifiedTagsSince.mockResolvedValue([]);
    noteRepo.getModifiedNotesSince.mockResolvedValue([]);
    noteRepo.getModifiedFoldersSince.mockResolvedValue([]);
    endpoints.syncPush.mockResolvedValue({ status: 'ok', accepted: 0, conflicts: [] });

    await performSync();

    expect(taskRepo.buildUpsertTaskCheckbox).toHaveBeenCalledTimes(1);
    expect(taskRepo.buildUpsertTaskCheckbox).toHaveBeenCalledWith(
      expect.objectContaining({ uuid: 'checkbox-valid' }),
    );
    expect(taskRepo.buildUpsertTaskLink).toHaveBeenCalledTimes(1);
    expect(taskRepo.buildUpsertTaskLink).toHaveBeenCalledWith(
      expect.objectContaining({ uuid: 'link-valid' }),
    );
  });

  test('pull skips finance items without plan_uuid', async () => {
    syncMeta.getLastSyncAt.mockResolvedValue(null);
    endpoints.syncPull.mockResolvedValue({
      changes: {
        finance_plans: [{ uuid: 'plan-1', name: 'Budget', updated_at: '2026-06-11T10:00:00' }],
        finance_items: [
          { uuid: 'item-valid', plan_uuid: 'plan-1', name: 'valid', updated_at: '2026-06-11T10:00:00' },
          { uuid: 'item-invalid', plan_uuid: null, name: 'invalid', updated_at: '2026-06-11T10:00:00' },
        ],
      },
      server_time: '2026-06-11T10:00:00',
    });
    snippetRepo.getModifiedSnippetsSince.mockResolvedValue([]);
    snippetRepo.getModifiedTagsSince.mockResolvedValue([]);
    noteRepo.getModifiedNotesSince.mockResolvedValue([]);
    noteRepo.getModifiedFoldersSince.mockResolvedValue([]);
    endpoints.syncPush.mockResolvedValue({ status: 'ok', accepted: 0, conflicts: [] });

    await performSync();

    expect(financeRepo.buildUpsertFinanceItem).toHaveBeenCalledTimes(1);
    expect(financeRepo.buildUpsertFinanceItem).toHaveBeenCalledWith(
      expect.objectContaining({ uuid: 'item-valid' }),
    );
  });

  test('pull skips finance fact relation rows without required UUID relations', async () => {
    syncMeta.getLastSyncAt.mockResolvedValue(null);
    endpoints.syncPull.mockResolvedValue({
      changes: {
        finance_transactions: [
          { uuid: 'tx-valid', source_fingerprint: 'fp-1', updated_at: '2026-06-11T10:00:00' },
        ],
        finance_mapping_rules: [
          { uuid: 'rule-valid', target_plan_uuid: 'plan-1', updated_at: '2026-06-11T10:00:00' },
          { uuid: 'rule-invalid', target_plan_uuid: null, updated_at: '2026-06-11T10:00:00' },
        ],
        finance_transaction_allocations: [
          { uuid: 'allocation-valid', transaction_uuid: 'tx-valid', plan_uuid: 'plan-1', updated_at: '2026-06-11T10:00:00' },
          { uuid: 'allocation-invalid-tx', transaction_uuid: null, plan_uuid: 'plan-1', updated_at: '2026-06-11T10:00:00' },
          { uuid: 'allocation-invalid-plan', transaction_uuid: 'tx-valid', plan_uuid: null, updated_at: '2026-06-11T10:00:00' },
        ],
      },
      server_time: '2026-06-11T10:00:00',
    });
    snippetRepo.getModifiedSnippetsSince.mockResolvedValue([]);
    snippetRepo.getModifiedTagsSince.mockResolvedValue([]);
    noteRepo.getModifiedNotesSince.mockResolvedValue([]);
    noteRepo.getModifiedFoldersSince.mockResolvedValue([]);
    endpoints.syncPush.mockResolvedValue({ status: 'ok', accepted: 0, conflicts: [] });

    await performSync();

    expect(financeRepo.buildUpsertFinanceTransaction).toHaveBeenCalledTimes(1);
    expect(financeRepo.buildUpsertFinanceMappingRule).toHaveBeenCalledTimes(1);
    expect(financeRepo.buildUpsertFinanceMappingRule).toHaveBeenCalledWith(
      expect.objectContaining({ uuid: 'rule-valid' }),
    );
    expect(financeRepo.buildUpsertFinanceTransactionAllocation).toHaveBeenCalledTimes(1);
    expect(financeRepo.buildUpsertFinanceTransactionAllocation).toHaveBeenCalledWith(
      expect.objectContaining({ uuid: 'allocation-valid' }),
    );
  });

  test('push sends new finance rules before allocations that reference them', async () => {
    syncMeta.getLastSyncAt.mockResolvedValue('2026-06-27T09:00:00');
    endpoints.syncPull.mockResolvedValue({ changes: {}, server_time: '2026-06-27T10:00:00' });
    snippetRepo.getModifiedSnippetsSince.mockResolvedValue([]);
    snippetRepo.getModifiedTagsSince.mockResolvedValue([]);
    noteRepo.getModifiedNotesSince.mockResolvedValue([]);
    noteRepo.getModifiedFoldersSince.mockResolvedValue([]);
    financeRepo.getModifiedFinanceMappingRulesSince.mockResolvedValue([
      { uuid: 'rule-new', target_plan_uuid: 'plan-1', target_item_uuid: 'item-1', updated_at: '2026-06-27T09:10:00' },
    ]);
    financeRepo.getModifiedFinanceTransactionAllocationsSince.mockResolvedValue([
      {
        uuid: 'allocation-new',
        transaction_uuid: 'tx-1',
        plan_uuid: 'plan-1',
        item_uuid: 'item-1',
        rule_uuid: 'rule-new',
        updated_at: '2026-06-27T09:11:00',
      },
    ]);
    endpoints.syncPush.mockResolvedValue({ status: 'ok', accepted: 2, conflicts: [] });

    await performSync();

    const pushed = endpoints.syncPush.mock.calls[0][0];
    expect(Object.keys(pushed)).toEqual([
      'finance_mapping_rules',
      'finance_transaction_allocations',
    ]);
    expect(pushed.finance_transaction_allocations[0]).toEqual(
      expect.objectContaining({ rule_uuid: 'rule-new' }),
    );
  });

  test('sync clears dirty finance allocations only after server accepts them', async () => {
    syncMeta.getLastSyncAt.mockResolvedValue('2026-06-27T12:00:00');
    endpoints.syncPull.mockResolvedValue({ changes: {}, server_time: '2026-06-27T12:30:00' });
    snippetRepo.getModifiedSnippetsSince.mockResolvedValue([]);
    snippetRepo.getModifiedTagsSince.mockResolvedValue([]);
    noteRepo.getModifiedNotesSince.mockResolvedValue([]);
    noteRepo.getModifiedFoldersSince.mockResolvedValue([]);
    financeRepo.getModifiedFinanceTransactionAllocationsSince.mockResolvedValue([
      {
        uuid: 'allocation-dirty',
        transaction_uuid: 'tx-boosty',
        plan_uuid: 'plan-regular',
        item_uuid: 'item-subscriptions',
        updated_at: '2026-06-27T11:59:00',
        sync_dirty: 1,
      },
    ]);
    endpoints.syncPush.mockResolvedValue({
      status: 'ok',
      accepted: 1,
      accepted_uuids: { finance_transaction_allocations: ['allocation-dirty'] },
      rejected_uuids: {},
      conflicts: [],
    });

    await performSync();

    expect(endpoints.syncPush).toHaveBeenCalledWith(
      expect.objectContaining({
        finance_transaction_allocations: [
          expect.objectContaining({ uuid: 'allocation-dirty', sync_dirty: 1 }),
        ],
      }),
    );
    expect(financeRepo.clearSyncedFinanceRows).toHaveBeenCalledWith('finance_transaction_allocations', ['allocation-dirty']);
  });

  test('sync marks accepted finance rows synced for every finance table', async () => {
    syncMeta.getLastSyncAt.mockResolvedValue('2026-06-27T12:00:00');
    endpoints.syncPull.mockResolvedValue({ changes: {}, server_time: '2026-06-27T12:30:00' });
    snippetRepo.getModifiedSnippetsSince.mockResolvedValue([]);
    snippetRepo.getModifiedTagsSince.mockResolvedValue([]);
    noteRepo.getModifiedNotesSince.mockResolvedValue([]);
    noteRepo.getModifiedFoldersSince.mockResolvedValue([]);
    financeRepo.getModifiedFinancePlansSince.mockResolvedValue([
      { uuid: 'plan-pending', sync_status: 'pending', updated_at: '2026-06-27T11:00:00' },
    ]);
    financeRepo.getModifiedFinanceItemsSince.mockResolvedValue([
      { uuid: 'item-pending', plan_uuid: 'plan-pending', sync_status: 'pending', updated_at: '2026-06-27T11:01:00' },
    ]);
    financeRepo.getModifiedFinanceTransactionsSince.mockResolvedValue([
      { uuid: 'tx-pending', sync_status: 'pending', updated_at: '2026-06-27T11:02:00' },
    ]);
    financeRepo.getModifiedFinanceMappingRulesSince.mockResolvedValue([
      { uuid: 'rule-pending', target_plan_uuid: 'plan-pending', sync_status: 'pending', updated_at: '2026-06-27T11:03:00' },
    ]);
    financeRepo.getModifiedFinanceTransactionAllocationsSince.mockResolvedValue([
      {
        uuid: 'allocation-pending',
        transaction_uuid: 'tx-pending',
        plan_uuid: 'plan-pending',
        item_uuid: 'item-pending',
        sync_status: 'pending',
        updated_at: '2026-06-27T11:04:00',
      },
    ]);
    endpoints.syncPush.mockResolvedValue({
      status: 'ok',
      accepted: 5,
      accepted_uuids: {
        finance_plans: ['plan-pending'],
        finance_items: ['item-pending'],
        finance_transactions: ['tx-pending'],
        finance_mapping_rules: ['rule-pending'],
        finance_transaction_allocations: ['allocation-pending'],
      },
      rejected_uuids: {},
      conflicts: [],
    });

    await performSync();

    expect(financeRepo.clearSyncedFinanceRows).toHaveBeenCalledWith('finance_plans', ['plan-pending']);
    expect(financeRepo.clearSyncedFinanceRows).toHaveBeenCalledWith('finance_items', ['item-pending']);
    expect(financeRepo.clearSyncedFinanceRows).toHaveBeenCalledWith('finance_transactions', ['tx-pending']);
    expect(financeRepo.clearSyncedFinanceRows).toHaveBeenCalledWith('finance_mapping_rules', ['rule-pending']);
    expect(financeRepo.clearSyncedFinanceRows).toHaveBeenCalledWith('finance_transaction_allocations', ['allocation-pending']);
  });

  test('full pull does not push rows that were just pulled', async () => {
    syncMeta.getLastSyncAt.mockResolvedValue(null);
    endpoints.syncPull.mockResolvedValue({
      changes: {
        shortcuts: [
          { uuid: 's-pulled', name: 'server', value: 'v', updated_at: '2026-06-27T10:00:00', is_deleted: false },
        ],
        finance_transactions: [
          { uuid: 'tx-pulled', source_fingerprint: 'fp-1', amount_cents: -19000, updated_at: '2026-06-27T10:01:00', is_deleted: false },
        ],
      },
      server_time: '2026-06-27T09:59:30',
    });
    snippetRepo.getModifiedSnippetsSince.mockResolvedValue([
      { uuid: 's-pulled', name: 'server', value: 'v', updated_at: '2026-06-27T10:00:00', is_deleted: 0 },
    ]);
    snippetRepo.getModifiedTagsSince.mockResolvedValue([]);
    noteRepo.getModifiedNotesSince.mockResolvedValue([]);
    noteRepo.getModifiedFoldersSince.mockResolvedValue([]);
    financeRepo.getModifiedFinanceTransactionsSince.mockResolvedValue([
      { uuid: 'tx-pulled', source_fingerprint: 'fp-1', amount_cents: -19000, updated_at: '2026-06-27T10:01:00', is_deleted: 0 },
    ]);
    endpoints.syncPush.mockResolvedValue({ status: 'ok', accepted: 0, conflicts: [] });

    await performSync();

    expect(endpoints.syncPush).not.toHaveBeenCalled();
    expect(syncMeta.setLastSyncAt).toHaveBeenCalledWith('2026-06-27T10:01:00');
    expect(syncMeta.setLastSyncDebug).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'ok',
        pulled_counts: expect.objectContaining({ shortcuts: 1, finance_transactions: 1 }),
        pushed_counts: {},
      }),
    );
  });

  test('sync surfaces rejected rows and conflicts in diagnostics', async () => {
    syncMeta.getLastSyncAt.mockResolvedValue('2026-06-27T09:00:00');
    endpoints.syncPull.mockResolvedValue({ changes: {}, server_time: '2026-06-27T10:00:00' });
    snippetRepo.getModifiedSnippetsSince.mockResolvedValue([
      { uuid: 's-local', name: 'local', value: 'v', updated_at: '2026-06-27T09:30:00', is_deleted: 0 },
    ]);
    snippetRepo.getModifiedTagsSince.mockResolvedValue([]);
    noteRepo.getModifiedNotesSince.mockResolvedValue([]);
    noteRepo.getModifiedFoldersSince.mockResolvedValue([]);
    endpoints.syncPush.mockResolvedValue({
      status: 'ok',
      accepted: 0,
      rejected_uuids: { shortcuts: ['s-local'] },
      conflicts: [{ table: 'shortcuts', uuid: 's-local', resolution: 'server_wins' }],
    });

    await expect(performSync()).rejects.toThrow(/rejected/i);

    expect(syncMeta.setLastSyncDebug).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'warning',
        rejected_uuids: { shortcuts: ['s-local'] },
        conflicts: [{ table: 'shortcuts', uuid: 's-local', resolution: 'server_wins' }],
      }),
    );
  });

  test('forced full pull downloads server rows without pushing local rows', async () => {
    syncMeta.getLastSyncAt.mockResolvedValue('2026-06-27T09:00:00');
    endpoints.syncPull.mockResolvedValue({
      changes: {
        finance_transactions: [
          { uuid: 'tx-server', source_fingerprint: 'fp-server', amount_cents: -19000, updated_at: '2026-06-27T12:15:00', is_deleted: false },
        ],
      },
      server_time: '2026-06-27T12:14:30',
    });
    snippetRepo.getModifiedSnippetsSince.mockResolvedValue([]);
    snippetRepo.getModifiedTagsSince.mockResolvedValue([]);
    noteRepo.getModifiedNotesSince.mockResolvedValue([]);
    noteRepo.getModifiedFoldersSince.mockResolvedValue([]);

    await performFullPullFromServer();

    expect(endpoints.syncPull).toHaveBeenCalledWith(null);
    expect(endpoints.syncPush).not.toHaveBeenCalled();
    expect(financeRepo.buildUpsertFinanceTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ uuid: 'tx-server' }),
    );
    expect(syncMeta.setLastSyncAt).toHaveBeenCalledWith('2026-06-27T12:15:00');
    expect(syncMeta.setLastSyncDebug).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'ok',
        forced_full_pull: true,
        pulled_counts: { finance_transactions: 1 },
        pushed_counts: {},
      }),
    );
  });

  test('forced full pull refuses to run while local changes are pending', async () => {
    syncMeta.getLastSyncAt.mockResolvedValue('2026-06-27T09:00:00');
    snippetRepo.getModifiedSnippetsSince.mockResolvedValue([
      { uuid: 'local-snippet', updated_at: '2026-06-27T10:00:00' },
    ]);
    snippetRepo.getModifiedTagsSince.mockResolvedValue([]);
    noteRepo.getModifiedNotesSince.mockResolvedValue([]);
    noteRepo.getModifiedFoldersSince.mockResolvedValue([]);

    await expect(performFullPullFromServer()).rejects.toThrow(/pending local changes/i);

    expect(endpoints.syncPull).not.toHaveBeenCalled();
    expect(endpoints.syncPush).not.toHaveBeenCalled();
  });
});
