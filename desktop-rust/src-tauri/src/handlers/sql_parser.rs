use regex::Regex;
use std::collections::BTreeSet;

/// Extract table names and dictGet targets from SQL code.
/// Ported from Python sql_parser.py.
pub fn parse_sql(sql: &str) -> String {
    // Remove Python import lines to avoid false positives
    let cleaned: String = sql
        .lines()
        .filter(|line| {
            let trimmed = line.trim();
            !(trimmed.starts_with("from ") && trimmed.contains(" import "))
                && !trimmed.starts_with("import ")
        })
        .collect::<Vec<_>>()
        .join("\n");

    let pattern_from_join = Regex::new(
        r"(?i)\b(?:from|join|insert\s+into|truncate(?:\s+table)?)\s+([a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z0-9_]+)+)"
    ).unwrap();

    let pattern_dictget = Regex::new(
        r"(?i)dictGet\('([^']*\.[^']*)'"
    ).unwrap();

    let mut unique_tables = BTreeSet::new();
    let mut unique_dicts = BTreeSet::new();

    for cap in pattern_from_join.captures_iter(&cleaned) {
        if let Some(m) = cap.get(1) {
            unique_tables.insert(m.as_str().to_string());
        }
    }

    for cap in pattern_dictget.captures_iter(&cleaned) {
        if let Some(m) = cap.get(1) {
            unique_dicts.insert(m.as_str().to_string());
        }
    }

    let mut result = String::new();

    if !unique_tables.is_empty() || !unique_dicts.is_empty() {
        let all: BTreeSet<_> = unique_tables.iter().chain(unique_dicts.iter()).collect();
        result.push_str(&format!("Matches found: {:?}", all));
    }

    if !unique_tables.is_empty() {
        result.push_str("\n\n# Tables:\n");
        for t in &unique_tables {
            result.push_str(t);
            result.push('\n');
        }
    }

    if !unique_dicts.is_empty() {
        result.push_str("\n# Dicts:\n");
        for d in &unique_dicts {
            result.push_str(d);
            result.push('\n');
        }
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_simple_select() {
        let result = parse_sql("SELECT * FROM db.table1 JOIN db.table2 ON t1.id = t2.id");
        assert!(result.contains("db.table1"), "Should find db.table1");
        assert!(result.contains("db.table2"), "Should find db.table2");
    }

    #[test]
    fn test_parse_insert_into() {
        let result = parse_sql("INSERT INTO schema1.target_table SELECT * FROM schema2.source");
        assert!(result.contains("schema1.target_table"));
        assert!(result.contains("schema2.source"));
    }

    #[test]
    fn test_parse_dictget() {
        let result = parse_sql("SELECT dictGet('db.my_dict', 'col', id) FROM db.some_table");
        assert!(result.contains("db.my_dict"), "Should find dictGet target");
        assert!(result.contains("db.some_table"), "Should find FROM table");
        assert!(result.contains("# Dicts:"), "Should have Dicts section");
    }

    #[test]
    fn test_parse_truncate() {
        let result = parse_sql("TRUNCATE TABLE db.old_table");
        assert!(result.contains("db.old_table"));
    }

    #[test]
    fn test_filters_python_imports() {
        let sql = "from module import something\nSELECT * FROM db.real_table";
        let result = parse_sql(sql);
        assert!(result.contains("db.real_table"));
        // Should not pick up "module" as a table
        assert!(!result.contains("module"));
    }

    #[test]
    fn test_empty_input() {
        let result = parse_sql("");
        assert!(result.is_empty());
    }

    #[test]
    fn test_no_tables() {
        let result = parse_sql("SELECT 1 + 2");
        assert!(result.is_empty());
    }

    #[test]
    fn test_case_insensitive() {
        let result = parse_sql("select * FROM Db.Table1 join Db.Table2 on x=y");
        assert!(result.contains("Db.Table1"));
        assert!(result.contains("Db.Table2"));
    }

    #[test]
    fn test_multiple_joins() {
        let sql = "SELECT * FROM a.t1 LEFT JOIN b.t2 ON x INNER JOIN c.t3 ON y RIGHT JOIN d.t4 ON z";
        let result = parse_sql(sql);
        assert!(result.contains("a.t1"));
        assert!(result.contains("b.t2"));
        assert!(result.contains("c.t3"));
        assert!(result.contains("d.t4"));
    }
}
