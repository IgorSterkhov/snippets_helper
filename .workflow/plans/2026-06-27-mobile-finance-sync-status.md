# Mobile Finance Sync Status Plan

1. Add regression tests proving that pending Finance rows are selected for
   push regardless of `updated_at`, and accepted rows are marked synced for all
   Finance sync tables.
2. Add mobile DB migration and create-table columns for `sync_status`, with a
   one-time conversion from old allocation `sync_dirty` rows to pending status.
3. Update Finance repository builders and local mutation paths so pulled rows
   default to `synced`, local edits default to `pending`, and local deletes
   become `deleted`. Mutation paths: `upsertFinancePlan`,
   `deleteFinancePlan`, `upsertFinanceItem`, `deleteFinanceItem`,
   `createFinanceTransactionAllocation`, `setFinanceTransactionRulesLocked`,
   and `createFinanceMappingRule`.
4. Add guarded Finance pull upserts so pulled rows do not replace local
   `pending` or `deleted` rows before push.
5. Update mobile sync service to clear accepted Finance rows through a
   table-whitelisted helper.
6. Run focused mobile Jest tests, bump mobile OTA version, commit, publish OTA,
   and verify the update manifest.
