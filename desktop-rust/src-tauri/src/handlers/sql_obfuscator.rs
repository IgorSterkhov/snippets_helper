use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeSet, HashMap};

/// A single mapping entry from original to obfuscated name.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ObfuscationEntry {
    pub entity_type: String,
    pub original_value: String,
    pub obfuscated_value: String,
    pub enabled: bool,
}

/// SQL keywords to exclude from column detection.
const SQL_KEYWORDS: &[&str] = &[
    "select", "from", "where", "and", "or", "as", "on", "join", "left", "right",
    "inner", "outer", "full", "cross", "group", "by", "order", "having", "limit",
    "offset", "union", "all", "distinct", "case", "when", "then", "else", "end",
    "null", "true", "false", "not", "in", "between", "like", "is", "exists",
    "insert", "update", "delete", "create", "alter", "drop", "table", "index",
    "primary", "key", "foreign", "references", "constraint", "default", "values",
    "set", "into", "partition", "using", "over", "window", "rows", "range",
    "preceding", "following", "current", "row", "unbounded", "asc", "desc",
    "nulls", "first", "last", "with", "recursive", "materialized", "view",
    "if", "cast", "convert", "coalesce", "nullif", "global", "local",
    "temporary", "temp", "final", "sample", "prewhere", "array", "tuple",
];

fn is_sql_keyword(word: &str) -> bool {
    SQL_KEYWORDS.contains(&word.to_lowercase().as_str())
}

/// Remove Python import lines from code.
fn remove_python_imports(code: &str) -> String {
    code.lines()
        .filter(|line| {
            let trimmed = line.trim();
            !(trimmed.starts_with("from ") && trimmed.contains(" import "))
                && !trimmed.starts_with("import ")
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// Extract all entities (schemas, tables, columns, dag_ids, task_ids, literals) from SQL/DAG code.
pub fn extract_entities(code: &str) -> HashMap<String, BTreeSet<String>> {
    let mut entities: HashMap<String, BTreeSet<String>> = HashMap::new();
    entities.insert("schemas".into(), BTreeSet::new());
    entities.insert("tables".into(), BTreeSet::new());
    entities.insert("columns".into(), BTreeSet::new());
    entities.insert("dag_ids".into(), BTreeSet::new());
    entities.insert("task_ids".into(), BTreeSet::new());
    entities.insert("literals".into(), BTreeSet::new());

    let cleaned = remove_python_imports(code);

    // Pattern for schema.table from FROM/JOIN
    // Note: Python imports are already filtered by remove_python_imports, so no lookahead needed
    let re_from_join = Regex::new(
        r"(?i)\b(?:from|join)\s+([a-zA-Z_][a-zA-Z0-9_]*)\.([a-zA-Z_][a-zA-Z0-9_]*)"
    ).unwrap();
    for cap in re_from_join.captures_iter(&cleaned) {
        let schema = cap[1].to_string();
        let table = cap[2].to_string();
        entities.get_mut("schemas").unwrap().insert(schema.clone());
        entities.get_mut("tables").unwrap().insert(format!("{schema}.{table}"));
    }

    // Pattern for dictGet('schema.dict')
    let re_dictget = Regex::new(
        r#"(?i)dictGet\s*\(\s*['"]([a-zA-Z_][a-zA-Z0-9_]*)\.([a-zA-Z_][a-zA-Z0-9_]*)['"]"#
    ).unwrap();
    for cap in re_dictget.captures_iter(&cleaned) {
        let schema = cap[1].to_string();
        let dict_name = cap[2].to_string();
        entities.get_mut("schemas").unwrap().insert(schema.clone());
        entities.get_mut("tables").unwrap().insert(format!("{schema}.{dict_name}"));
    }

    // Pattern for columns from SELECT ... FROM
    let re_select = Regex::new(r"(?is)SELECT\s+(.*?)\s+FROM").unwrap();
    let re_col = Regex::new(
        r"(?i)^([a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)?)(?:\s+(?:AS\s+)?[a-zA-Z_][a-zA-Z0-9_]*)?$"
    ).unwrap();
    for cap in re_select.captures_iter(&cleaned) {
        let select_clause = &cap[1];
        // Remove DISTINCT/ALL/TOP from beginning
        let re_prefix = Regex::new(r"(?i)^\s*(DISTINCT|ALL|TOP\s+\d+)\s+").unwrap();
        let select_clause = re_prefix.replace(select_clause, "").to_string();
        for part in select_clause.split(',') {
            let part = part.trim();
            if part.contains('*') || part.contains('(') {
                continue;
            }
            if let Some(col_cap) = re_col.captures(part) {
                let mut col = col_cap[1].to_string();
                if col.contains('.') {
                    col = col.split('.').last().unwrap_or(&col).to_string();
                }
                if !is_sql_keyword(&col) && col.len() > 1 {
                    entities.get_mut("columns").unwrap().insert(col);
                }
            }
        }
    }

    // Pattern for dag_id
    let re_dag = Regex::new(r#"(?i)dag_id\s*=\s*['"]([^'"]+)['"]"#).unwrap();
    for cap in re_dag.captures_iter(&cleaned) {
        entities.get_mut("dag_ids").unwrap().insert(cap[1].to_string());
    }

    // Pattern for task_id
    let re_task = Regex::new(r#"(?i)task_id\s*=\s*['"]([^'"]+)['"]"#).unwrap();
    for cap in re_task.captures_iter(&cleaned) {
        entities.get_mut("task_ids").unwrap().insert(cap[1].to_string());
    }

    // Pattern for string literals (length > 3)
    let re_lit = Regex::new(r"'([^']{4,})'").unwrap();
    for cap in re_lit.captures_iter(&cleaned) {
        let lit = &cap[1];
        if is_meaningful_literal(lit) {
            entities.get_mut("literals").unwrap().insert(lit.to_string());
        }
    }

    entities
}

fn is_meaningful_literal(value: &str) -> bool {
    // Skip dates
    let re_date1 = Regex::new(r"^\d{4}-\d{2}-\d{2}").unwrap();
    let re_date2 = Regex::new(r"^\d{2}\.\d{2}\.\d{4}").unwrap();
    if re_date1.is_match(value) || re_date2.is_match(value) {
        return false;
    }
    // Skip LIKE patterns
    if value.contains('%') || value.contains('_') {
        return false;
    }
    // Skip pure numbers
    if value.chars().all(|c| c.is_ascii_digit()) {
        return false;
    }
    // Skip SQL constants
    let skip = ["null", "true", "false", "none", "asc", "desc"];
    if skip.contains(&value.to_lowercase().as_str()) {
        return false;
    }
    true
}

/// Generate obfuscated names for all extracted entities.
pub fn generate_obfuscated_names(entities: &HashMap<String, BTreeSet<String>>) -> Vec<ObfuscationEntry> {
    let mut mappings = Vec::new();
    let mut schema_counter = 1u32;
    let mut table_counter = 1u32;
    let mut col_counter = 1u32;
    let mut dag_counter = 1u32;
    let mut task_counter = 1u32;
    let mut literal_counter = 1u32;

    let empty = BTreeSet::new();

    // Schemas
    let mut schema_map: HashMap<String, String> = HashMap::new();
    for schema in entities.get("schemas").unwrap_or(&empty) {
        let obf = format!("sch_{schema_counter:03}");
        schema_map.insert(schema.clone(), obf.clone());
        mappings.push(ObfuscationEntry {
            entity_type: "schema".into(),
            original_value: schema.clone(),
            obfuscated_value: obf,
            enabled: true,
        });
        schema_counter += 1;
    }

    // Tables (schema.table -> sch_XXX.obj_YYY)
    for table in entities.get("tables").unwrap_or(&empty) {
        let obf = if table.contains('.') {
            let parts: Vec<&str> = table.splitn(2, '.').collect();
            let obf_schema = schema_map.get(parts[0]).cloned().unwrap_or_else(|| parts[0].to_string());
            format!("{obf_schema}.obj_{table_counter:03}")
        } else {
            format!("obj_{table_counter:03}")
        };
        mappings.push(ObfuscationEntry {
            entity_type: "table".into(),
            original_value: table.clone(),
            obfuscated_value: obf,
            enabled: true,
        });
        table_counter += 1;
    }

    // Columns
    for col in entities.get("columns").unwrap_or(&empty) {
        mappings.push(ObfuscationEntry {
            entity_type: "column".into(),
            original_value: col.clone(),
            obfuscated_value: format!("col_{col_counter:03}"),
            enabled: true,
        });
        col_counter += 1;
    }

    // DAG IDs
    for dag_id in entities.get("dag_ids").unwrap_or(&empty) {
        mappings.push(ObfuscationEntry {
            entity_type: "dag".into(),
            original_value: dag_id.clone(),
            obfuscated_value: format!("dag_{dag_counter:03}"),
            enabled: true,
        });
        dag_counter += 1;
    }

    // Task IDs
    for task_id in entities.get("task_ids").unwrap_or(&empty) {
        mappings.push(ObfuscationEntry {
            entity_type: "task".into(),
            original_value: task_id.clone(),
            obfuscated_value: format!("task_{task_counter:03}"),
            enabled: true,
        });
        task_counter += 1;
    }

    // Literals (disabled by default)
    for lit in entities.get("literals").unwrap_or(&empty) {
        mappings.push(ObfuscationEntry {
            entity_type: "literal".into(),
            original_value: lit.clone(),
            obfuscated_value: format!("str_{literal_counter:03}"),
            enabled: false,
        });
        literal_counter += 1;
    }

    mappings
}

/// Apply enabled replacements to code. Longer matches are replaced first.
pub fn apply_replacements(code: &str, mappings: &[ObfuscationEntry]) -> String {
    let mut result = code.to_string();

    // Sort: longer original values first to avoid partial replacements
    let mut enabled: Vec<_> = mappings.iter().filter(|m| m.enabled).collect();
    enabled.sort_by(|a, b| b.original_value.len().cmp(&a.original_value.len()));

    // Group by type
    let mut by_type: HashMap<&str, Vec<&&ObfuscationEntry>> = HashMap::new();
    for m in &enabled {
        by_type.entry(m.entity_type.as_str()).or_default().push(m);
    }

    // Replace tables first (schema.table — longest)
    for m in by_type.get("table").unwrap_or(&vec![]) {
        // Use \b for word boundary (works for schema.table since . is not a word char)
        let pattern = format!(
            r"(?i)\b{}\b",
            regex::escape(&m.original_value)
        );
        if let Ok(re) = Regex::new(&pattern) {
            result = re.replace_all(&result, m.obfuscated_value.as_str()).to_string();
        }
    }

    // Replace DAG IDs (in quotes)
    for m in by_type.get("dag").unwrap_or(&vec![]) {
        let pattern = format!(
            r#"(?i)(dag_id\s*=\s*['"]){}(['"])"#,
            regex::escape(&m.original_value)
        );
        if let Ok(re) = Regex::new(&pattern) {
            let replacement = format!("${{1}}{}${{2}}", m.obfuscated_value);
            result = re.replace_all(&result, replacement.as_str()).to_string();
        }
    }

    // Replace Task IDs (in quotes)
    for m in by_type.get("task").unwrap_or(&vec![]) {
        let pattern = format!(
            r#"(?i)(task_id\s*=\s*['"]){}(['"])"#,
            regex::escape(&m.original_value)
        );
        if let Ok(re) = Regex::new(&pattern) {
            let replacement = format!("${{1}}{}${{2}}", m.obfuscated_value);
            result = re.replace_all(&result, replacement.as_str()).to_string();
        }
    }

    // Replace columns (with word boundaries)
    for m in by_type.get("column").unwrap_or(&vec![]) {
        let pattern = format!(
            r"\b{}\b",
            regex::escape(&m.original_value)
        );
        if let Ok(re) = Regex::new(&pattern) {
            result = re.replace_all(&result, m.obfuscated_value.as_str()).to_string();
        }
    }

    // Replace literals (in quotes)
    for m in by_type.get("literal").unwrap_or(&vec![]) {
        let pattern = format!("'{}'", regex::escape(&m.original_value));
        if let Ok(re) = Regex::new(&pattern) {
            let replacement = format!("'{}'", m.obfuscated_value);
            result = re.replace_all(&result, replacement.as_str()).to_string();
        }
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_tables() {
        let entities = extract_entities("SELECT a FROM mydb.orders JOIN mydb.users ON x=y");
        let tables = entities.get("tables").unwrap();
        assert!(tables.contains("mydb.orders"));
        assert!(tables.contains("mydb.users"));
    }

    #[test]
    fn test_extract_dictget() {
        let entities = extract_entities("SELECT dictGet('mydb.my_dict', 'col', id) FROM mydb.t1");
        let tables = entities.get("tables").unwrap();
        assert!(tables.contains("mydb.my_dict"));
        assert!(tables.contains("mydb.t1"));
    }

    #[test]
    fn test_generate_obfuscated_names() {
        let entities = extract_entities("SELECT col1, col2 FROM schema1.table1 JOIN schema1.table2 ON x=y");
        let mappings = generate_obfuscated_names(&entities);
        assert!(!mappings.is_empty());
        // Should have schema, table, and column entries
        let types: BTreeSet<_> = mappings.iter().map(|m| m.entity_type.as_str()).collect();
        assert!(types.contains("schema"));
        assert!(types.contains("table"));
        assert!(types.contains("column"));
    }

    #[test]
    fn test_apply_replacements() {
        let code = "SELECT col1 FROM mydb.orders WHERE col1 > 0";
        let mappings = vec![
            ObfuscationEntry {
                entity_type: "table".into(),
                original_value: "mydb.orders".into(),
                obfuscated_value: "sch_001.obj_001".into(),
                enabled: true,
            },
            ObfuscationEntry {
                entity_type: "column".into(),
                original_value: "col1".into(),
                obfuscated_value: "col_001".into(),
                enabled: true,
            },
        ];
        let result = apply_replacements(code, &mappings);
        assert!(result.contains("sch_001.obj_001"));
        assert!(result.contains("col_001"));
        assert!(!result.contains("mydb.orders"));
    }

    #[test]
    fn test_python_imports_removed() {
        let code = "from module import func\nSELECT * FROM db.table1";
        let entities = extract_entities(code);
        let tables = entities.get("tables").unwrap();
        assert!(tables.contains("db.table1"));
        assert!(!tables.iter().any(|t| t.contains("module")));
    }
}
