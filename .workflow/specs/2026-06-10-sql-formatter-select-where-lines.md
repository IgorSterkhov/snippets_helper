# SQL Formatter: SELECT and WHERE Line Breaks

## Goal

Improve the SQL module formatter so formatted queries are easier to read:

- `SELECT` expressions must be split onto separate lines, one field or top-level expression per line.
- `WHERE`, `PREWHERE`, and `HAVING` conditions must be split onto separate
  lines at top-level logical operators.

## Expected Behavior

For input like:

```sql
select a, b, sum(x + y) as total from t where status = 'ok' and dt >= today() - 7 or id in (1, 2)
```

`Format SQL` should output:

```sql
SELECT
    a,
    b,
    sum(x + y) AS total
FROM t
WHERE
    status = 'ok'
    AND dt >= today() - 7
    OR id IN (1, 2)
```

## Constraints

- Do not split commas inside function calls, tuples, arrays, quoted strings, or Jinja placeholders.
- Do not split `AND` inside string literals or the `BETWEEN ... AND ...` expression.
- Do not detect SQL clauses inside string literals or comments.
- Do not change keyword-looking words inside string literals or comments when
  applying UPPER/lower keyword casing.
- Preserve existing keyword casing option and ClickHouse function case restoration.
- Keep the change limited to SQL Formatter behavior; do not change parser/analyzer/obfuscator logic.

## Release Impact

This is a desktop user-facing formatter fix implemented in native Rust code, so it should ship as a patch `v*` desktop release.
