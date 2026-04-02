use std::io::Read;

/// Extract a Superset export zip file and return the list of file paths inside.
#[tauri::command]
pub fn extract_superset_zip(path: String) -> Result<Vec<String>, String> {
    let file = std::fs::File::open(&path).map_err(|e| format!("Cannot open file: {e}"))?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("Invalid zip: {e}"))?;

    let mut paths = Vec::new();
    for i in 0..archive.len() {
        let entry = archive.by_index(i).map_err(|e| format!("Zip entry error: {e}"))?;
        paths.push(entry.name().to_string());
    }
    Ok(paths)
}

/// Validate Superset YAML export files inside a zip.
/// Checks naming conventions and required fields.
/// Returns a list of warnings/errors.
#[tauri::command]
pub fn validate_superset_report(path: String) -> Result<Vec<String>, String> {
    let file = std::fs::File::open(&path).map_err(|e| format!("Cannot open file: {e}"))?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("Invalid zip: {e}"))?;

    let mut warnings: Vec<String> = Vec::new();

    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| format!("Zip entry error: {e}"))?;
        let name = entry.name().to_string();

        if !name.ends_with(".yaml") && !name.ends_with(".yml") {
            continue;
        }

        // Read content
        let mut content = String::new();
        if entry.read_to_string(&mut content).is_err() {
            warnings.push(format!("{name}: cannot read as UTF-8"));
            continue;
        }

        // Try to parse as YAML
        let doc: serde_yaml::Value = match serde_yaml::from_str(&content) {
            Ok(v) => v,
            Err(e) => {
                warnings.push(format!("{name}: invalid YAML - {e}"));
                continue;
            }
        };

        // Check naming conventions: file names should be snake_case
        let file_stem = std::path::Path::new(&name)
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("");
        if file_stem.contains(' ') || file_stem.contains('-') {
            warnings.push(format!("{name}: filename is not snake_case"));
        }

        // Check for required fields in dataset files
        if name.contains("dataset") || name.contains("datasets") {
            if let serde_yaml::Value::Mapping(ref map) = doc {
                if !map.contains_key(&serde_yaml::Value::String("table_name".to_string())) {
                    warnings.push(format!("{name}: missing 'table_name' field"));
                }
                if !map.contains_key(&serde_yaml::Value::String("sql".to_string())) {
                    // sql is optional but worth noting
                    warnings.push(format!("{name}: no 'sql' field (physical dataset)"));
                }
            }
        }

        // Check for required fields in chart files
        if name.contains("chart") || name.contains("charts") {
            if let serde_yaml::Value::Mapping(ref map) = doc {
                if !map.contains_key(&serde_yaml::Value::String("slice_name".to_string())) {
                    warnings.push(format!("{name}: missing 'slice_name' field"));
                }
                if !map.contains_key(&serde_yaml::Value::String("viz_type".to_string())) {
                    warnings.push(format!("{name}: missing 'viz_type' field"));
                }
            }
        }

        // Check for required fields in dashboard files
        if name.contains("dashboard") || name.contains("dashboards") {
            if let serde_yaml::Value::Mapping(ref map) = doc {
                if !map.contains_key(&serde_yaml::Value::String("dashboard_title".to_string())) {
                    warnings.push(format!("{name}: missing 'dashboard_title' field"));
                }
            }
        }
    }

    if warnings.is_empty() {
        warnings.push("All checks passed".to_string());
    }

    Ok(warnings)
}

/// Extract SQL from Superset YAML dataset content (look for `sql:` field).
#[tauri::command]
pub fn parse_superset_sql(yaml_content: String) -> Result<String, String> {
    let doc: serde_yaml::Value =
        serde_yaml::from_str(&yaml_content).map_err(|e| format!("Invalid YAML: {e}"))?;

    if let serde_yaml::Value::Mapping(ref map) = doc {
        if let Some(sql_val) = map.get(&serde_yaml::Value::String("sql".to_string())) {
            if let serde_yaml::Value::String(sql) = sql_val {
                return Ok(sql.clone());
            }
        }
    }

    Ok("(no sql field found)".to_string())
}
