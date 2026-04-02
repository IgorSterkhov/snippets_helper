/// Analyze DDL to generate SELECT queries for data exploration.
/// Ported from Python _on_sql_table_analyze.

/// Extract table name from CREATE TABLE DDL.
pub fn extract_table_name(ddl: &str) -> Option<String> {
    let lowered = ddl.to_lowercase();
    let create_idx = lowered.find("create table")?;
    let after_create = &ddl[create_idx..];
    let tokens: Vec<&str> = after_create.split_whitespace().collect();
    if tokens.len() < 3 {
        return None;
    }

    // Handle "CREATE TABLE IF NOT EXISTS name"
    let table_token_index = if tokens.get(2).map(|t| t.to_lowercase()) == Some("if".into()) {
        if tokens.len() > 5 { 5 } else { return None; }
    } else {
        2
    };

    tokens
        .get(table_token_index)
        .map(|t| t.trim_matches(|c| c == '`' || c == '"').to_string())
}

/// Extract field names from DDL column definitions.
pub fn extract_fields(ddl: &str) -> Vec<String> {
    let open_idx = match ddl.find('(') {
        Some(i) => i,
        None => return vec![],
    };
    let close_idx = match find_matching_paren(ddl, open_idx) {
        Some(i) => i,
        None => return vec![],
    };

    let columns_block = &ddl[open_idx + 1..close_idx];
    let parts = split_columns_block(columns_block);

    let skip_tokens = [
        "PRIMARY", "INDEX", "CONSTRAINT", "KEY",
        "ORDER", "PARTITION", "SETTINGS",
        "TTL", "UNIQUE", "PROJECTION",
    ];

    let mut fields = Vec::new();
    for part in parts {
        let cleaned = part.trim();
        if cleaned.is_empty() {
            continue;
        }
        if let Some(first_token) = cleaned.split_whitespace().next() {
            let token_clean = first_token.trim_matches(|c| c == '`' || c == '"');
            if skip_tokens.iter().any(|s| s.eq_ignore_ascii_case(token_clean)) {
                continue;
            }
            fields.push(token_clean.to_string());
        }
    }
    fields
}

fn find_matching_paren(text: &str, open_index: usize) -> Option<usize> {
    let mut depth = 0i32;
    for (i, ch) in text[open_index..].char_indices() {
        match ch {
            '(' => depth += 1,
            ')' => {
                depth -= 1;
                if depth == 0 {
                    return Some(open_index + i);
                }
            }
            _ => {}
        }
    }
    None
}

fn split_columns_block(block: &str) -> Vec<String> {
    let mut parts = Vec::new();
    let mut current = String::new();
    let mut depth = 0i32;
    for ch in block.chars() {
        match ch {
            '(' => {
                depth += 1;
                current.push(ch);
            }
            ')' => {
                depth -= 1;
                current.push(ch);
            }
            ',' if depth == 0 => {
                let part = current.trim().to_string();
                if !part.is_empty() {
                    parts.push(part);
                }
                current.clear();
            }
            _ => current.push(ch),
        }
    }
    let last = current.trim().to_string();
    if !last.is_empty() {
        parts.push(last);
    }
    parts
}

/// Build the total rows + max row_version query.
fn build_total_and_max_query(table_name: &str, row_version_field: &str, where_clause: &str) -> String {
    format!(
        "SELECT\n    count() AS total_rows\n  , max({rv}) AS max_{rv}\nFROM {tbl}\n{whr}\n;",
        rv = row_version_field,
        tbl = table_name,
        whr = where_clause,
    )
}

/// Build the field counts query with percentages.
fn build_field_counts_query(
    table_name: &str,
    fields: &[String],
    where_clause: &str,
    format_vertical: bool,
) -> String {
    let mut lines = vec!["SELECT".to_string(), "    count() AS total_rows".to_string()];
    for field in fields {
        lines.push(format!("  , count({field}) AS cnt_{field}"));
        lines.push(format!(
            "  , round(100.0 * count({field}) / nullif(count(), 0), 2) AS pct_{field}"
        ));
    }
    lines.push(format!("FROM {table_name}"));
    lines.push(where_clause.to_string());
    if format_vertical {
        lines.push("FORMAT Vertical".to_string());
    }
    lines.push(";".to_string());
    lines.join("\n")
}

/// Build queries from analyzer templates.
fn build_template_queries(
    table_name: &str,
    fields: &[String],
    row_version_field: &str,
    where_clause: &str,
    format_vertical: bool,
    templates: &[String],
) -> Vec<String> {
    let mut queries = Vec::new();
    for template in templates {
        let template = template.trim();
        if template.is_empty() {
            continue;
        }
        let selected_fields: Vec<_> = fields
            .iter()
            .filter(|f| f.as_str() != row_version_field)
            .collect();
        if selected_fields.is_empty() {
            continue;
        }
        queries.push(format!("-- Template: {template}"));
        queries.push("SELECT".to_string());
        for (i, field) in selected_fields.iter().enumerate() {
            let expression = template
                .replace("<field_for_row_version>", row_version_field)
                .replace("<field>", field);
            let expression = expression.trim_start_matches(',').trim();
            let prefix = if i == 0 { "    " } else { "  , " };
            queries.push(format!("{prefix}{expression}"));
        }
        queries.push(format!("FROM {table_name}"));
        queries.push(where_clause.to_string());
        if format_vertical {
            queries.push("FORMAT Vertical".to_string());
        }
        queries.push(";".to_string());
    }
    queries
}

/// Main analyze function: takes DDL, filter, row_version field and templates,
/// returns the generated SQL queries as a single string.
pub fn analyze_ddl(
    ddl: &str,
    where_clause: &str,
    row_version_field: &str,
    format_vertical: bool,
    templates: &[String],
) -> Result<String, String> {
    if ddl.trim().is_empty() {
        return Err("DDL is empty.".into());
    }
    if where_clause.trim().is_empty() {
        return Err("Filter is empty. Expected: WHERE ...".into());
    }
    if !where_clause.trim().to_lowercase().starts_with("where ") {
        return Err("Filter should start with WHERE.".into());
    }
    if row_version_field.trim().is_empty() {
        return Err("Field for row_version is empty.".into());
    }

    let table_name = extract_table_name(ddl)
        .ok_or("Could not detect table name in DDL.")?;
    let fields = extract_fields(ddl);
    if fields.is_empty() {
        return Err("Could not detect fields in DDL.".into());
    }

    let mut parts = Vec::new();
    parts.push("-- 1) Total rows and max row_version".to_string());
    parts.push(build_total_and_max_query(&table_name, row_version_field, where_clause));
    parts.push(String::new());
    parts.push("-- 2) Counts per field with percentage from total".to_string());
    parts.push(build_field_counts_query(&table_name, &fields, where_clause, format_vertical));

    let template_queries = build_template_queries(
        &table_name,
        &fields,
        row_version_field,
        where_clause,
        format_vertical,
        templates,
    );
    if !template_queries.is_empty() {
        parts.push(String::new());
        parts.push("-- 3) Template-based queries".to_string());
        parts.extend(template_queries);
    }

    Ok(parts.join("\n"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_table_name_simple() {
        let ddl = "CREATE TABLE mydb.users (id Int64, name String)";
        assert_eq!(extract_table_name(ddl), Some("mydb.users".into()));
    }

    #[test]
    fn test_extract_table_name_if_not_exists() {
        let ddl = "CREATE TABLE IF NOT EXISTS mydb.orders (id Int64)";
        assert_eq!(extract_table_name(ddl), Some("mydb.orders".into()));
    }

    #[test]
    fn test_extract_fields() {
        let ddl = "CREATE TABLE t (\n  id Int64,\n  name String,\n  age UInt8\n) ENGINE = MergeTree()";
        let fields = extract_fields(ddl);
        assert_eq!(fields, vec!["id", "name", "age"]);
    }

    #[test]
    fn test_extract_fields_skips_keywords() {
        let ddl = "CREATE TABLE t (\n  id Int64,\n  name String,\n  PRIMARY KEY (id)\n)";
        let fields = extract_fields(ddl);
        assert_eq!(fields, vec!["id", "name"]);
    }

    #[test]
    fn test_analyze_ddl_basic() {
        let ddl = "CREATE TABLE db.users (\n  id Int64,\n  name String,\n  row_version Int64\n)";
        let result = analyze_ddl(ddl, "WHERE True", "row_version", false, &[]);
        assert!(result.is_ok());
        let sql = result.unwrap();
        assert!(sql.contains("count()"));
        assert!(sql.contains("db.users"));
        assert!(sql.contains("max(row_version)"));
    }

    #[test]
    fn test_analyze_ddl_empty() {
        let result = analyze_ddl("", "WHERE True", "row_version", false, &[]);
        assert!(result.is_err());
    }

    #[test]
    fn test_analyze_with_templates() {
        let ddl = "CREATE TABLE db.t (id Int64, name String, row_version Int64)";
        let templates = vec!["count(distinct <field>) AS uniq_<field>".to_string()];
        let result = analyze_ddl(ddl, "WHERE True", "row_version", false, &templates).unwrap();
        assert!(result.contains("Template:"));
        assert!(result.contains("count(distinct id)"));
        assert!(result.contains("count(distinct name)"));
    }
}
