# Finance Facts sync recovery, search, and compact mobile view

## Plan

1. Add mobile tests proving Finance transaction allocations can be marked dirty
   and cleared after `accepted_uuids`.
2. Add a mobile SQLite `sync_dirty` column for
   `finance_transaction_allocations`; mark active existing allocations dirty
   once during migration.
3. Mark local manual/rule allocation changes dirty, include dirty rows in push
   candidates, and clear dirty only after successful server acceptance.
4. Add Desktop Finance Facts search state, search helpers, and a header search
   input that refreshes only the facts summary/table.
5. Resolve Finance allocation labels by numeric IDs or UUIDs so desktop can
   display/search mappings that originated on mobile.
6. Add Mobile Finance Facts `Cards / Compact` layout state, persist it with
   `AsyncStorage`, and render compact one-line fact rows for wide screens.
7. Verify with desktop JS syntax check, mobile Finance/sync Jest tests, and a
   Babel parse of the changed mobile Finance screen.
