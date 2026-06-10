# Notes Folder Tree DnD Plan

1. Add `move_note_folder` in Rust:
   - command signature receives `id`, `parent_id`, and `before_id`;
   - DB query uses a transaction;
   - reject moving into self or descendant;
   - normalize old and new sibling sort order;
   - set `updated_at` and `sync_status = 'pending'` for changed folder rows.
2. Update command registration and browser mock.
3. Refactor Notes folder rendering:
   - generate flat visible tree rows with depth metadata;
   - reserve fixed row zones for grip, arrow, icon, title, badge, actions;
   - remove hover layout shifts.
4. Add pointer-based DnD for folder rows:
   - ghost clone follows cursor;
   - line placeholder for before/after;
   - target highlight for inside;
   - auto-expand target on inside drop;
   - suppress click after drag.
5. Save reusable prompt for nested tree DnD under `.workflow/prompts/`.
6. Update Help/release history and `FRONTEND_PATTERNS.md` if a reusable tree pattern is added.
7. Verify with targeted Rust tests, JS syntax checks, and desktop smoke tests where practical.
8. Release as desktop patch `v1.9.3`.
