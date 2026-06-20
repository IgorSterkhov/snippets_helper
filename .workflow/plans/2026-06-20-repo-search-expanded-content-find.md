# Repo Search Expanded Content Find Plan

1. Inspect current `Repo Search` content render and fullscreen expanded file
   flow.
2. Add state helpers to resolve the content query and original match lines for
   a file path. Capture the last successful content-search query separately
   from the current search input so edited input text does not change an
   already produced result's initial expanded search.
3. Replace expanded file rendering with line-based DOM rendering:
   - line number column;
   - code text;
   - match line marker;
   - active match marker.
4. Add local find toolbar to the expanded header:
   - search input;
   - previous/next buttons;
   - `current / total` counter;
   - `Open in editor`;
   - `Copy path`;
   - `Collapse`.
   Reset/clamp active match state on query changes; disable navigation at zero
   matches and make `Open in editor` fall back to line 1 when there is no active
   match.
5. Keep highlight.js available where practical, but prioritize reliable search
   markup and line-level match styling over whole-file syntax HTML.
6. Add browser regression coverage for expanded content search:
   - content search produces a result;
   - expanded view opens;
   - initial query is prefilled;
   - match lines are highlighted;
   - changing local query updates highlights;
   - next/previous navigation changes active line;
   - expanded action buttons exist;
   - `open_in_editor` receives the active line;
   - zero-match state disables navigation and falls back to line 1.
7. Update module help and release history/changelog.
8. Run checks: `node --check`, `python3 dev-test.py`, `cargo check`,
   `git diff --check`.
9. Commit and publish frontend-only release.
