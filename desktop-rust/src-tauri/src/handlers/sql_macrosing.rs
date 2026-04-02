use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Placeholder configuration for a single placeholder.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlaceholderConfig {
    #[serde(rename = "type")]
    pub ph_type: String,    // "static", "list", "range"
    pub value: Option<String>,    // for "static": the single value
    pub values: Option<String>,   // for "list": comma-separated values
    pub start: Option<i64>,       // for "range"
    pub end: Option<i64>,         // for "range"
    pub step: Option<i64>,        // for "range"
    pub format: Option<String>,   // for "range": optional format string
}

/// Extract placeholder names ({{name}}) from a SQL template.
pub fn extract_placeholders(template: &str) -> Vec<String> {
    let re = Regex::new(r"\{\{(\w+)\}\}").unwrap();
    let mut seen = Vec::new();
    for cap in re.captures_iter(template) {
        let name = cap[1].to_string();
        if !seen.contains(&name) {
            seen.push(name);
        }
    }
    seen
}

/// Generate values for a single placeholder based on its config.
fn generate_placeholder_values(config: &PlaceholderConfig) -> Vec<String> {
    match config.ph_type.as_str() {
        "static" => {
            vec![config.value.clone().unwrap_or_default()]
        }
        "list" => {
            config
                .values
                .as_deref()
                .unwrap_or("")
                .split(',')
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect()
        }
        "range" => {
            let start = config.start.unwrap_or(0);
            let end = config.end.unwrap_or(0);
            let step = config.step.unwrap_or(1).max(1);
            let fmt = config.format.clone().unwrap_or_default();
            let mut vals = Vec::new();
            let mut i = start;
            while i <= end {
                if fmt.is_empty() {
                    vals.push(i.to_string());
                } else {
                    // Simple format: replace {} with the number
                    vals.push(fmt.replace("{}", &i.to_string()));
                }
                i += step;
            }
            vals
        }
        _ => vec![],
    }
}

/// Generate SQL variations from a template with placeholders.
///
/// `config` maps placeholder keys like "{{name}}" to their PlaceholderConfig.
/// `mode` is "cartesian" or "zip".
/// `separator` is the string to join generated queries (e.g., ";\n").
pub fn generate_macros(
    template: &str,
    config: &HashMap<String, PlaceholderConfig>,
    mode: &str,
    separator: &str,
) -> Result<String, String> {
    let placeholder_names = extract_placeholders(template);
    if placeholder_names.is_empty() {
        return Ok(template.to_string());
    }

    // Generate values for each placeholder
    let mut all_values: Vec<(String, Vec<String>)> = Vec::new();
    for name in &placeholder_names {
        let key = format!("{{{{{name}}}}}");
        let values = if let Some(cfg) = config.get(&key) {
            generate_placeholder_values(cfg)
        } else {
            // Try without braces
            if let Some(cfg) = config.get(name.as_str()) {
                generate_placeholder_values(cfg)
            } else {
                return Err(format!("No config for placeholder {{{{{name}}}}}"));
            }
        };
        if values.is_empty() {
            return Err(format!("Placeholder {{{{{name}}}}} has no values"));
        }
        all_values.push((key, values));
    }

    // Generate combinations
    let combinations = if mode == "zip" {
        generate_zip_combinations(&all_values)
    } else {
        generate_cartesian_combinations(&all_values)
    };

    // Apply each combination to the template
    let queries: Vec<String> = combinations
        .iter()
        .map(|combo| {
            let mut result = template.to_string();
            for (key, value) in combo {
                result = result.replace(key, value);
            }
            result
        })
        .collect();

    // Decode separator escape sequences
    let decoded_sep = separator
        .replace("\\n", "\n")
        .replace("\\t", "\t")
        .replace("\\r", "\r");

    Ok(queries.join(&decoded_sep))
}

fn generate_cartesian_combinations(
    all_values: &[(String, Vec<String>)],
) -> Vec<Vec<(String, String)>> {
    if all_values.is_empty() {
        return vec![vec![]];
    }

    let (ref key, ref values) = all_values[0];
    let rest = generate_cartesian_combinations(&all_values[1..]);
    let mut result = Vec::new();
    for val in values {
        for rest_combo in &rest {
            let mut combo = vec![(key.clone(), val.clone())];
            combo.extend(rest_combo.clone());
            result.push(combo);
        }
    }
    result
}

fn generate_zip_combinations(
    all_values: &[(String, Vec<String>)],
) -> Vec<Vec<(String, String)>> {
    if all_values.is_empty() {
        return vec![];
    }

    let max_len = all_values.iter().map(|(_, v)| v.len()).min().unwrap_or(0);
    let mut result = Vec::new();
    for i in 0..max_len {
        let combo: Vec<(String, String)> = all_values
            .iter()
            .map(|(key, values)| (key.clone(), values[i].clone()))
            .collect();
        result.push(combo);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_placeholders() {
        let result = extract_placeholders("SELECT * FROM {{schema}}.{{table}} WHERE {{col}} = 1");
        assert_eq!(result, vec!["schema", "table", "col"]);
    }

    #[test]
    fn test_extract_placeholders_dedup() {
        let result = extract_placeholders("{{a}} + {{b}} + {{a}}");
        assert_eq!(result, vec!["a", "b"]);
    }

    #[test]
    fn test_generate_static() {
        let mut config = HashMap::new();
        config.insert(
            "{{table}}".to_string(),
            PlaceholderConfig {
                ph_type: "static".into(),
                value: Some("users".into()),
                values: None,
                start: None,
                end: None,
                step: None,
                format: None,
            },
        );
        let result = generate_macros("SELECT * FROM {{table}}", &config, "cartesian", ";\n").unwrap();
        assert_eq!(result, "SELECT * FROM users");
    }

    #[test]
    fn test_generate_list_cartesian() {
        let mut config = HashMap::new();
        config.insert(
            "{{col}}".to_string(),
            PlaceholderConfig {
                ph_type: "list".into(),
                value: None,
                values: Some("a, b".into()),
                start: None,
                end: None,
                step: None,
                format: None,
            },
        );
        let result = generate_macros("SELECT {{col}} FROM t", &config, "cartesian", ";\n").unwrap();
        assert!(result.contains("SELECT a FROM t"));
        assert!(result.contains("SELECT b FROM t"));
    }

    #[test]
    fn test_generate_range() {
        let mut config = HashMap::new();
        config.insert(
            "{{n}}".to_string(),
            PlaceholderConfig {
                ph_type: "range".into(),
                value: None,
                values: None,
                start: Some(1),
                end: Some(3),
                step: Some(1),
                format: None,
            },
        );
        let result = generate_macros("SELECT {{n}}", &config, "cartesian", ";").unwrap();
        assert_eq!(result, "SELECT 1;SELECT 2;SELECT 3");
    }

    #[test]
    fn test_generate_zip() {
        let mut config = HashMap::new();
        config.insert(
            "{{a}}".to_string(),
            PlaceholderConfig {
                ph_type: "list".into(),
                value: None,
                values: Some("x, y".into()),
                start: None,
                end: None,
                step: None,
                format: None,
            },
        );
        config.insert(
            "{{b}}".to_string(),
            PlaceholderConfig {
                ph_type: "list".into(),
                value: None,
                values: Some("1, 2".into()),
                start: None,
                end: None,
                step: None,
                format: None,
            },
        );
        let result = generate_macros("{{a}}={{b}}", &config, "zip", ";").unwrap();
        assert_eq!(result, "x=1;y=2");
    }
}
