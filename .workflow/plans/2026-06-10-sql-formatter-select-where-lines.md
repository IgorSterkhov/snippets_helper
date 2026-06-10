# SQL Formatter SELECT/WHERE Line Breaks Plan

1. Add helper functions in `sql_formatter.rs` for top-level splitting while respecting quotes, comments, brackets, parentheses, and `BETWEEN`.
2. Harden `basic_format` so clause detection and whitespace normalization skip strings and comments before expanding clause bodies.
3. Expand the output of `basic_format` so `SELECT` lists and `WHERE` / `PREWHERE` / `HAVING` conditions are rendered across multiple indented lines.
4. Apply keyword casing only to SQL code segments, preserving string literals and comments.
5. Add Rust unit tests for:
   - multi-field `SELECT`;
   - `WHERE` split by `AND` / `OR`;
   - commas inside functions/strings;
   - `BETWEEN ... AND ...` staying on one line;
   - strings/comments not being split or case-converted.
6. Update SQL Formatter help and release history:
   - `desktop-rust/src/tabs/sql/help-content.js`;
   - `desktop-rust/src/tabs/help.js` if the top-level Help description changes;
   - `desktop-rust/src/release-history.md`;
   - `desktop-rust/CHANGELOG.md`.
7. Run `cargo test sql_formatter`, `cargo check`, and `python3 dev-test.py` from `desktop-rust/src`.
8. Release as desktop patch `v1.9.2` if verification passes.
