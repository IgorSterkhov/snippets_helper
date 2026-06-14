# Finance Row Editing Polish Plan

## Steps

1. Add Finance viewport snapshot/restore helpers for `.finance-table-wrap`,
   active row id, active field, and selection offsets.
2. Use the snapshot around row saves that reload Finance data.
3. Extend Finance name focusing so callers can select placeholder text, and
   apply it after keyboard-created rows are saved/indented.
4. Add CDP smoke tests for scroll preservation, restored focus on the same
   amount field, and placeholder selection. Because the browser mock turns
   empty create names into `New item`, explicitly force the keyboard-created
   row name empty before pressing Tab so the test exercises the `Untitled item`
   save path.
5. Run `node --check`, `python3 -m py_compile`, `python3 dev-test.py`, and
   `git diff --check`.
6. Update `desktop-rust/src/release-history.md` and `desktop-rust/CHANGELOG.md`
   with the chosen `f-*` tag before tagging.
7. If only desktop frontend files changed, publish a frontend-only `f-*` OTA
   and verify GitHub Actions plus the tag-specific `frontend-version.json`.
