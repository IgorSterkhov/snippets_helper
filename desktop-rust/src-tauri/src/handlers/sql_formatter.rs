use regex::Regex;

/// ClickHouse functions with correct casing.
const CLICKHOUSE_FUNCTIONS: &[&str] = &[
    // Dict functions
    "dictGet",
    "dictGetOrDefault",
    "dictGetOrNull",
    "dictHas",
    "dictGetHierarchy",
    "dictIsIn",
    // Conditional
    "multiIf",
    // Date/time
    "toDate",
    "toDateTime",
    "toDateTime64",
    "toDateOrNull",
    "toDateTimeOrNull",
    "toStartOfDay",
    "toStartOfHour",
    "toStartOfMinute",
    "toStartOfMonth",
    "toStartOfQuarter",
    "toStartOfYear",
    "toStartOfWeek",
    "toMonday",
    "toYear",
    "toMonth",
    "toWeek",
    "toDayOfMonth",
    "toDayOfWeek",
    "toDayOfYear",
    "toHour",
    "toMinute",
    "toSecond",
    "toUnixTimestamp",
    "formatDateTime",
    "parseDateTimeBestEffort",
    "parseDateTime64BestEffort",
    "dateDiff",
    "dateAdd",
    "dateSub",
    "timeSlot",
    // Type conversion
    "toString",
    "toInt8",
    "toInt16",
    "toInt32",
    "toInt64",
    "toInt128",
    "toInt256",
    "toUInt8",
    "toUInt16",
    "toUInt32",
    "toUInt64",
    "toUInt128",
    "toUInt256",
    "toFloat32",
    "toFloat64",
    "toDecimal32",
    "toDecimal64",
    "toDecimal128",
    "toFixedString",
    "toUUID",
    "toIPv4",
    "toIPv6",
    "toIntervalSecond",
    "toIntervalMinute",
    "toIntervalHour",
    "toIntervalDay",
    "toIntervalWeek",
    "toIntervalMonth",
    "toIntervalQuarter",
    "toIntervalYear",
    "reinterpretAsInt8",
    "reinterpretAsInt16",
    "reinterpretAsInt32",
    "reinterpretAsInt64",
    "reinterpretAsUInt8",
    "reinterpretAsUInt16",
    "reinterpretAsUInt32",
    "reinterpretAsUInt64",
    "reinterpretAsFloat32",
    "reinterpretAsFloat64",
    "reinterpretAsString",
    "accurateCast",
    "accurateCastOrNull",
    // Aggregate
    "countIf",
    "sumIf",
    "avgIf",
    "minIf",
    "maxIf",
    "anyIf",
    "uniq",
    "uniqExact",
    "uniqCombined",
    "uniqCombined64",
    "uniqHLL12",
    "groupArray",
    "groupArrayInsertAt",
    "groupUniqArray",
    "groupBitAnd",
    "groupBitOr",
    "groupBitXor",
    "argMin",
    "argMax",
    "quantile",
    "quantiles",
    "quantileExact",
    "quantileTiming",
    "simpleLinearRegression",
    "stochasticLinearRegression",
    // String
    "replaceAll",
    "replaceOne",
    "replaceRegexpAll",
    "replaceRegexpOne",
    "splitByChar",
    "splitByString",
    "splitByRegexp",
    "arrayStringConcat",
    "extractAll",
    "extractAllGroups",
    "trimLeft",
    "trimRight",
    "trimBoth",
    "leftPad",
    "rightPad",
    "leftPadUTF8",
    "rightPadUTF8",
    "lowerUTF8",
    "upperUTF8",
    "reverseUTF8",
    "substringUTF8",
    "lengthUTF8",
    "positionUTF8",
    "positionCaseInsensitive",
    "positionCaseInsensitiveUTF8",
    "multiSearchFirstIndex",
    "multiSearchFirstPosition",
    "multiSearchAny",
    "multiMatchAny",
    "multiMatchAnyIndex",
    "multiFuzzyMatchAny",
    "normalizeQuery",
    "normalizedQueryHash",
    "encodeXMLComponent",
    "decodeXMLComponent",
    "extractURLParameter",
    "extractURLParameters",
    "extractURLParameterNames",
    "cutURLParameter",
    "cutToFirstSignificantSubdomain",
    "URLHierarchy",
    "URLPathHierarchy",
    // Array
    "arrayJoin",
    "arrayConcat",
    "arrayElement",
    "arrayPushBack",
    "arrayPushFront",
    "arrayPopBack",
    "arrayPopFront",
    "arraySlice",
    "arrayReverse",
    "arrayCompact",
    "arrayDistinct",
    "arrayEnumerate",
    "arrayEnumerateDense",
    "arrayEnumerateUniq",
    "arrayReduce",
    "arrayReduceInRanges",
    "arrayFilter",
    "arrayExists",
    "arrayAll",
    "arrayFirst",
    "arrayFirstIndex",
    "arraySum",
    "arrayAvg",
    "arrayCount",
    "arrayMin",
    "arrayMax",
    "arraySort",
    "arrayReverseSort",
    "arrayUniq",
    "arrayDifference",
    "hasAll",
    "hasAny",
    "hasSubstr",
    "indexOf",
    "arrayZip",
    // Null
    "ifNull",
    "nullIf",
    "assumeNotNull",
    "toNullable",
    "coalesce",
    "isNull",
    "isNotNull",
    // JSON
    "JSONExtract",
    "JSONExtractString",
    "JSONExtractInt",
    "JSONExtractFloat",
    "JSONExtractBool",
    "JSONExtractRaw",
    "JSONExtractArrayRaw",
    "JSONExtractKeysAndValues",
    "JSONHas",
    "JSONLength",
    "JSONType",
    "JSONExtractKeys",
    "simpleJSONExtractString",
    "simpleJSONExtractInt",
    "simpleJSONExtractFloat",
    "simpleJSONExtractBool",
    "simpleJSONExtractRaw",
    "simpleJSONHas",
    // Bit
    "bitAnd",
    "bitOr",
    "bitXor",
    "bitNot",
    "bitShiftLeft",
    "bitShiftRight",
    "bitRotateLeft",
    "bitRotateRight",
    "bitTest",
    "bitTestAll",
    "bitTestAny",
    "bitCount",
    "bitPositionsToArray",
    // Hash
    "cityHash64",
    "sipHash64",
    "sipHash128",
    "halfMD5",
    "farmHash64",
    "javaHash",
    "murmurHash2_32",
    "murmurHash2_64",
    "murmurHash3_32",
    "murmurHash3_64",
    "murmurHash3_128",
    "xxHash32",
    "xxHash64",
    // Geo
    "geoDistance",
    "greatCircleDistance",
    "greatCircleAngle",
    "pointInEllipses",
    "pointInPolygon",
    "geohashEncode",
    "geohashDecode",
    "geohashesInBox",
    "h3IsValid",
    "h3GetResolution",
    "h3EdgeAngle",
    "h3EdgeLengthM",
    // IP
    "IPv4NumToString",
    "IPv4StringToNum",
    "IPv4ToIPv6",
    "IPv6NumToString",
    "IPv6StringToNum",
    "isIPv4String",
    "isIPv6String",
    // Misc
    "runningDifference",
    "runningDifferenceStartingWithFirstValue",
    "runningAccumulate",
    "rowNumberInAllBlocks",
    "rowNumberInBlock",
    "formatRow",
    "formatRowNoNewline",
    "generateUUIDv4",
    "getMacro",
    "getSetting",
    "isFinite",
    "isInfinite",
    "isNaN",
    "toTypeName",
    "blockSize",
    "materialize",
    "ignore",
    "sleep",
    "sleepEachRow",
    "currentDatabase",
    "currentUser",
    "hostName",
    "uptime",
    "version",
    "throwIf",
    "identity",
];

/// SQL keywords for case conversion.
const SQL_KEYWORDS: &[&str] = &[
    "select",
    "from",
    "where",
    "and",
    "or",
    "not",
    "in",
    "is",
    "null",
    "as",
    "on",
    "join",
    "left",
    "right",
    "inner",
    "outer",
    "full",
    "cross",
    "group",
    "by",
    "order",
    "having",
    "limit",
    "offset",
    "union",
    "all",
    "distinct",
    "case",
    "when",
    "then",
    "else",
    "end",
    "cast",
    "between",
    "like",
    "ilike",
    "exists",
    "any",
    "with",
    "recursive",
    "insert",
    "into",
    "values",
    "update",
    "set",
    "delete",
    "create",
    "table",
    "view",
    "index",
    "drop",
    "alter",
    "add",
    "column",
    "primary",
    "key",
    "foreign",
    "references",
    "asc",
    "desc",
    "nulls",
    "first",
    "last",
    "over",
    "partition",
    "row",
    "rows",
    "range",
    "unbounded",
    "preceding",
    "following",
    "current",
    "interval",
    "true",
    "false",
    "using",
    "natural",
    "except",
    "intersect",
    "global",
    "prewhere",
    "sample",
    "array",
    "final",
    "format",
    "settings",
];

/// SQL keywords that start new clauses (for line-break formatting).
const CLAUSE_KEYWORDS: &[&str] = &[
    "select",
    "from",
    "where",
    "join",
    "left join",
    "right join",
    "inner join",
    "outer join",
    "full join",
    "cross join",
    "full outer join",
    "left outer join",
    "right outer join",
    "group by",
    "order by",
    "having",
    "limit",
    "offset",
    "union",
    "union all",
    "except",
    "intersect",
    "insert into",
    "values",
    "set",
    "on",
    "prewhere",
    "sample",
    "final",
    "format",
    "settings",
    "with",
];

/// Protect Jinja2 templates from being formatted.
/// Replaces {{ }}, {% %}, {# #} with placeholders, returns the list of originals.
fn protect_jinja(sql: &str) -> (String, Vec<String>) {
    let re = Regex::new(r"(\{\{.*?\}\}|\{%.*?%\}|\{#.*?#\})").unwrap();
    let mut placeholders = Vec::new();
    let result = re.replace_all(sql, |caps: &regex::Captures| {
        let idx = placeholders.len();
        placeholders.push(caps[0].to_string());
        format!("__JINJA_{idx}__")
    });
    (result.to_string(), placeholders)
}

/// Restore Jinja2 templates from placeholders.
fn restore_jinja(sql: &str, placeholders: &[String]) -> String {
    let mut result = sql.to_string();
    for (i, original) in placeholders.iter().enumerate() {
        result = result.replace(&format!("__JINJA_{i}__"), original);
    }
    result
}

fn is_word_start(ch: char) -> bool {
    ch.is_ascii_alphabetic() || ch == '_'
}

fn is_word_char(ch: char) -> bool {
    ch.is_ascii_alphanumeric() || ch == '_'
}

fn is_clause_boundary(rest: &str) -> bool {
    rest.chars().next().map_or(true, |ch| !is_word_char(ch))
}

fn strip_leading_keyword<'a>(line: &'a str, keyword: &str) -> Option<(&'a str, &'a str)> {
    let trimmed = line.trim_start();
    let keyword_len = keyword.len();
    if trimmed.len() < keyword_len {
        return None;
    }
    let head = trimmed.get(..keyword_len)?;
    if !head.eq_ignore_ascii_case(keyword) {
        return None;
    }
    let rest = &trimmed[keyword_len..];
    if !is_clause_boundary(rest) {
        return None;
    }
    Some((head, rest.trim_start()))
}

fn advance_quoted(sql: &str, start: usize, quote: char) -> usize {
    let mut i = start + quote.len_utf8();
    while i < sql.len() {
        let ch = sql[i..].chars().next().unwrap();
        let next_i = i + ch.len_utf8();
        if ch == '\\' {
            if next_i < sql.len() {
                let escaped = sql[next_i..].chars().next().unwrap();
                i = next_i + escaped.len_utf8();
            } else {
                i = next_i;
            }
            continue;
        }
        if ch == quote {
            if next_i < sql.len() && sql[next_i..].starts_with(quote) {
                i = next_i + quote.len_utf8();
                continue;
            }
            return next_i;
        }
        i = next_i;
    }
    sql.len()
}

fn advance_line_comment(sql: &str, start: usize) -> usize {
    match sql[start..].find('\n') {
        Some(offset) => start + offset + 1,
        None => sql.len(),
    }
}

fn advance_block_comment(sql: &str, start: usize) -> usize {
    match sql[start + 2..].find("*/") {
        Some(offset) => start + 2 + offset + 2,
        None => sql.len(),
    }
}

fn top_level_depth_is_zero(paren_depth: i32, bracket_depth: i32, brace_depth: i32) -> bool {
    paren_depth == 0 && bracket_depth == 0 && brace_depth == 0
}

fn ends_with_whitespace_separator(value: &str) -> bool {
    value
        .chars()
        .last()
        .map_or(false, |ch| ch == ' ' || ch == '\n' || ch == '\t')
}

fn normalize_sql_whitespace(sql: &str) -> String {
    let sql = sql.trim();
    let mut out = String::new();
    let mut pending_space = false;
    let mut i = 0;

    while i < sql.len() {
        if sql[i..].starts_with("--") {
            if pending_space && !out.is_empty() && !ends_with_whitespace_separator(&out) {
                out.push(' ');
            }
            pending_space = false;
            let end = advance_line_comment(sql, i);
            out.push_str(&sql[i..end]);
            i = end;
            continue;
        }
        if sql[i..].starts_with("/*") {
            if pending_space && !out.is_empty() && !ends_with_whitespace_separator(&out) {
                out.push(' ');
            }
            pending_space = false;
            let end = advance_block_comment(sql, i);
            out.push_str(&sql[i..end]);
            i = end;
            continue;
        }

        let ch = sql[i..].chars().next().unwrap();
        let next_i = i + ch.len_utf8();
        match ch {
            '\'' | '"' | '`' => {
                if pending_space && !out.is_empty() && !ends_with_whitespace_separator(&out) {
                    out.push(' ');
                }
                pending_space = false;
                let end = advance_quoted(sql, i, ch);
                out.push_str(&sql[i..end]);
                i = end;
                continue;
            }
            _ if ch.is_whitespace() => {
                pending_space = true;
            }
            _ => {
                if pending_space && !out.is_empty() && !ends_with_whitespace_separator(&out) {
                    out.push(' ');
                }
                pending_space = false;
                out.push(ch);
            }
        }
        i = next_i;
    }

    out.trim().to_string()
}

fn previous_char(sql: &str, idx: usize) -> Option<char> {
    sql.get(..idx)?.chars().next_back()
}

fn match_clause_keyword(sql: &str, start: usize, keywords: &[&str]) -> Option<usize> {
    if previous_char(sql, start).map_or(false, is_word_char) {
        return None;
    }

    let rest = &sql[start..];
    for keyword in keywords {
        let keyword_len = keyword.len();
        let Some(candidate) = rest.get(..keyword_len) else {
            continue;
        };
        if candidate.eq_ignore_ascii_case(keyword) && is_clause_boundary(&rest[keyword_len..]) {
            return Some(keyword_len);
        }
    }
    None
}

fn insert_clause_breaks(sql: &str) -> String {
    let mut sorted_kw: Vec<&str> = CLAUSE_KEYWORDS.to_vec();
    sorted_kw.sort_by(|a, b| b.len().cmp(&a.len()));

    let mut result = String::new();
    let mut last = 0;
    let mut i = 0;

    while i < sql.len() {
        if sql[i..].starts_with("--") {
            i = advance_line_comment(sql, i);
            continue;
        }
        if sql[i..].starts_with("/*") {
            i = advance_block_comment(sql, i);
            continue;
        }

        let ch = sql[i..].chars().next().unwrap();
        let next_i = i + ch.len_utf8();
        if matches!(ch, '\'' | '"' | '`') {
            i = advance_quoted(sql, i, ch);
            continue;
        }

        if is_word_start(ch) {
            if let Some(keyword_len) = match_clause_keyword(sql, i, &sorted_kw) {
                let before = sql[last..i].trim_end();
                if !before.is_empty() {
                    result.push_str(before);
                }
                if !result.is_empty() && !result.ends_with('\n') {
                    result.push('\n');
                }
                result.push_str(&sql[i..i + keyword_len]);
                last = i + keyword_len;
                i = last;
                continue;
            }
        }

        i = next_i;
    }

    if last < sql.len() {
        result.push_str(&sql[last..]);
    }
    result
}

fn split_top_level_commas(sql: &str) -> Vec<String> {
    let mut parts = Vec::new();
    let mut start = 0;
    let mut paren_depth = 0;
    let mut bracket_depth = 0;
    let mut brace_depth = 0;
    let mut i = 0;

    while i < sql.len() {
        if sql[i..].starts_with("--") {
            i = advance_line_comment(sql, i);
            continue;
        }
        if sql[i..].starts_with("/*") {
            i = advance_block_comment(sql, i);
            continue;
        }

        let ch = sql[i..].chars().next().unwrap();
        let next_i = i + ch.len_utf8();
        match ch {
            '\'' | '"' | '`' => {
                i = advance_quoted(sql, i, ch);
                continue;
            }
            '(' => paren_depth += 1,
            ')' => paren_depth = (paren_depth - 1).max(0),
            '[' => bracket_depth += 1,
            ']' => bracket_depth = (bracket_depth - 1).max(0),
            '{' => brace_depth += 1,
            '}' => brace_depth = (brace_depth - 1).max(0),
            ',' if top_level_depth_is_zero(paren_depth, bracket_depth, brace_depth) => {
                let item = sql[start..i].trim();
                if !item.is_empty() {
                    parts.push(item.to_string());
                }
                start = next_i;
            }
            _ => {}
        }
        i = next_i;
    }

    let tail = sql[start..].trim();
    if !tail.is_empty() {
        parts.push(tail.to_string());
    }
    parts
}

fn split_top_level_logical_conditions(sql: &str) -> Vec<String> {
    let mut parts = Vec::new();
    let mut start = 0;
    let mut paren_depth = 0;
    let mut bracket_depth = 0;
    let mut brace_depth = 0;
    let mut between_waiting_for_and = false;
    let mut i = 0;

    while i < sql.len() {
        if sql[i..].starts_with("--") {
            i = advance_line_comment(sql, i);
            continue;
        }
        if sql[i..].starts_with("/*") {
            i = advance_block_comment(sql, i);
            continue;
        }

        let ch = sql[i..].chars().next().unwrap();
        let next_i = i + ch.len_utf8();
        match ch {
            '\'' | '"' | '`' => {
                i = advance_quoted(sql, i, ch);
                continue;
            }
            '(' => paren_depth += 1,
            ')' => paren_depth = (paren_depth - 1).max(0),
            '[' => bracket_depth += 1,
            ']' => bracket_depth = (bracket_depth - 1).max(0),
            '{' => brace_depth += 1,
            '}' => brace_depth = (brace_depth - 1).max(0),
            _ => {}
        }

        if top_level_depth_is_zero(paren_depth, bracket_depth, brace_depth) && is_word_start(ch) {
            let word_start = i;
            let mut word_end = next_i;
            while word_end < sql.len() {
                let next_ch = sql[word_end..].chars().next().unwrap();
                if !is_word_char(next_ch) {
                    break;
                }
                word_end += next_ch.len_utf8();
            }
            let word = &sql[word_start..word_end];
            if word.eq_ignore_ascii_case("between") {
                between_waiting_for_and = true;
            } else if word.eq_ignore_ascii_case("and") || word.eq_ignore_ascii_case("or") {
                if word.eq_ignore_ascii_case("and") && between_waiting_for_and {
                    between_waiting_for_and = false;
                } else {
                    let condition = sql[start..word_start].trim();
                    if !condition.is_empty() {
                        parts.push(condition.to_string());
                    }
                    start = word_start;
                    between_waiting_for_and = false;
                }
            }
            i = word_end;
            continue;
        }

        i = next_i;
    }

    let tail = sql[start..].trim();
    if !tail.is_empty() {
        parts.push(tail.to_string());
    }
    parts
}

fn expand_select_line(line: &str) -> Option<Vec<String>> {
    let (keyword, mut rest) = strip_leading_keyword(line, "select")?;
    if rest.is_empty() {
        return None;
    }

    let mut header = keyword.to_string();
    for modifier in ["distinct", "all"] {
        if let Some((matched, after_modifier)) = strip_leading_keyword(rest, modifier) {
            header.push(' ');
            header.push_str(matched);
            rest = after_modifier;
            break;
        }
    }

    if rest.is_empty() {
        return None;
    }

    let items = split_top_level_commas(rest);
    if items.is_empty() {
        return None;
    }

    let mut lines = Vec::with_capacity(items.len() + 1);
    lines.push(header);
    for (idx, item) in items.iter().enumerate() {
        let suffix = if idx + 1 < items.len() { "," } else { "" };
        lines.push(format!("    {item}{suffix}"));
    }
    Some(lines)
}

fn expand_condition_line(line: &str, keyword: &str) -> Option<Vec<String>> {
    let (matched_keyword, rest) = strip_leading_keyword(line, keyword)?;
    if rest.is_empty() {
        return None;
    }

    let conditions = split_top_level_logical_conditions(rest);
    if conditions.is_empty() {
        return None;
    }

    let mut lines = Vec::with_capacity(conditions.len() + 1);
    lines.push(matched_keyword.to_string());
    for condition in conditions {
        lines.push(format!("    {condition}"));
    }
    Some(lines)
}

fn expand_clause_bodies(sql: &str) -> String {
    let mut out = Vec::new();
    for line in sql.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if let Some(lines) = expand_select_line(trimmed) {
            out.extend(lines);
            continue;
        }
        let mut expanded = None;
        for keyword in ["where", "prewhere", "having"] {
            if let Some(lines) = expand_condition_line(trimmed, keyword) {
                expanded = Some(lines);
                break;
            }
        }
        if let Some(lines) = expanded {
            out.extend(lines);
        } else {
            out.push(trimmed.to_string());
        }
    }
    out.join("\n")
}

/// Basic SQL formatting: add line breaks before clause keywords and indent.
fn basic_format(sql: &str) -> String {
    let normalized = normalize_sql_whitespace(sql);
    let clauses = insert_clause_breaks(&normalized);
    expand_clause_bodies(&clauses)
}

fn transform_code_segments<F>(sql: &str, mut transform: F) -> String
where
    F: FnMut(&str) -> String,
{
    let mut out = String::new();
    let mut code_start = 0;
    let mut i = 0;

    while i < sql.len() {
        let skip_end = if sql[i..].starts_with("--") {
            Some(advance_line_comment(sql, i))
        } else if sql[i..].starts_with("/*") {
            Some(advance_block_comment(sql, i))
        } else {
            let ch = sql[i..].chars().next().unwrap();
            if matches!(ch, '\'' | '"' | '`') {
                Some(advance_quoted(sql, i, ch))
            } else {
                None
            }
        };

        if let Some(end) = skip_end {
            if code_start < i {
                out.push_str(&transform(&sql[code_start..i]));
            }
            out.push_str(&sql[i..end]);
            i = end;
            code_start = i;
            continue;
        }

        let ch = sql[i..].chars().next().unwrap();
        i += ch.len_utf8();
    }

    if code_start < sql.len() {
        out.push_str(&transform(&sql[code_start..]));
    }
    out
}

fn apply_keyword_case_to_code(sql: &str, upper: bool) -> String {
    let re = Regex::new(r"\b([a-zA-Z_]+)\b").unwrap();
    re.replace_all(sql, |caps: &regex::Captures| {
        let word = &caps[1];
        if SQL_KEYWORDS.contains(&word.to_lowercase().as_str()) {
            if upper {
                word.to_uppercase()
            } else {
                word.to_lowercase()
            }
        } else {
            word.to_string()
        }
    })
    .to_string()
}

/// Convert SQL keywords to UPPER case while preserving non-keywords.
fn keywords_to_upper(sql: &str) -> String {
    transform_code_segments(sql, |code| apply_keyword_case_to_code(code, true))
}

/// Convert SQL keywords to lower case while preserving non-keywords.
fn keywords_to_lower(sql: &str) -> String {
    transform_code_segments(sql, |code| apply_keyword_case_to_code(code, false))
}

/// Restore ClickHouse function names to their correct camelCase form.
fn restore_function_case(sql: &str) -> String {
    let re = Regex::new(r"\b([a-zA-Z_][a-zA-Z0-9_]*)\s*\(").unwrap();
    transform_code_segments(sql, |code| {
        re.replace_all(code, |caps: &regex::Captures| {
            let func_name = &caps[1];
            for ch_func in CLICKHOUSE_FUNCTIONS {
                if ch_func.eq_ignore_ascii_case(func_name) {
                    return format!("{ch_func}(");
                }
            }
            caps[0].to_string()
        })
        .to_string()
    })
}

/// Format SQL with basic indentation and keyword case conversion.
/// Returns (formatted_sql, optional_error_message).
pub fn format_sql(sql: &str, keywords_upper: bool) -> (String, Option<String>) {
    if sql.trim().is_empty() {
        return (String::new(), None);
    }

    // 1. Protect Jinja2 blocks
    let (protected, jinja_placeholders) = protect_jinja(sql);

    // 2. Basic formatting (line breaks before clauses)
    let formatted = basic_format(&protected);

    // 3. Keywords case
    let cased = if keywords_upper {
        keywords_to_upper(&formatted)
    } else {
        keywords_to_lower(&formatted)
    };

    // 4. Restore ClickHouse function case
    let with_functions = restore_function_case(&cased);

    // 5. Restore Jinja2 blocks
    let final_result = restore_jinja(&with_functions, &jinja_placeholders);

    (final_result, None)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_basic_format_keywords_upper() {
        let (result, err) = format_sql("select a, b from table1 where x = 1", true);
        assert!(err.is_none());
        assert!(result.contains("SELECT"));
        assert!(result.contains("    a,"));
        assert!(result.contains("    b"));
        assert!(result.contains("FROM"));
        assert!(result.contains("WHERE"));
        assert!(result.contains("    x = 1"));
    }

    #[test]
    fn test_basic_format_keywords_lower() {
        let (result, err) = format_sql("SELECT A, B FROM table1 WHERE x = 1", false);
        assert!(err.is_none());
        assert!(result.contains("select"));
        assert!(result.contains("from"));
        assert!(result.contains("where"));
    }

    #[test]
    fn test_clickhouse_function_case_preserved() {
        let (result, _) = format_sql(
            "select todate(x), dictget('db.dict', 'col', id) from t",
            true,
        );
        assert!(result.contains("toDate("));
        assert!(result.contains("dictGet("));
    }

    #[test]
    fn test_jinja_blocks_preserved() {
        let (result, _) = format_sql(
            "select * from {{ table_name }} where x = {% if cond %}1{% endif %}",
            true,
        );
        assert!(result.contains("{{ table_name }}"));
        assert!(result.contains("{% if cond %}"));
        assert!(result.contains("{% endif %}"));
    }

    #[test]
    fn test_select_and_where_are_split_by_top_level_expressions() {
        let (result, err) = format_sql(
            "select a, b, sum(x + y) as total from table1 where x = 1 and y = 2 or z in (1, 2)",
            true,
        );
        assert!(err.is_none());
        assert!(result.contains("SELECT\n    a,\n    b,\n    sum(x + y) AS total"));
        assert!(result.contains("WHERE\n    x = 1\n    AND y = 2\n    OR z IN (1, 2)"));
    }

    #[test]
    fn test_select_split_keeps_nested_commas_together() {
        let (result, err) = format_sql(
            "select concat(a, ',') as c, tuple(x, y) as pair from table1",
            true,
        );
        assert!(err.is_none());
        assert!(result.contains("    concat(a, ',') AS c,"));
        assert!(result.contains("    tuple(x, y) AS pair"));
    }

    #[test]
    fn test_where_split_keeps_between_and_nested_conditions_together() {
        let (result, err) = format_sql(
            "select * from table1 where id between 1 and 5 and (status = 'new' or status = 'ready') and active = 1",
            true,
        );
        assert!(err.is_none());
        assert!(result.contains("    id BETWEEN 1 AND 5"));
        assert!(result.contains("    AND (status = 'new' OR status = 'ready')"));
        assert!(result.contains("    AND active = 1"));
    }

    #[test]
    fn test_literals_and_comments_are_not_split_or_case_converted() {
        let (result, err) = format_sql(
            "select 'from x and y' as txt, id -- where comment and dictget(x)\nfrom table1 where note = 'a and b' and active = 1",
            true,
        );
        assert!(err.is_none());
        assert!(result.contains("'from x and y' AS txt"));
        assert!(result.contains("-- where comment and dictget(x)"));
        assert!(result.contains("    note = 'a and b'"));
        assert!(result.contains("    AND active = 1"));
        assert!(!result.contains("'from x AND y'"));
        assert!(!result.contains("-- WHERE comment AND dictGet(x)"));
    }

    #[test]
    fn test_empty_input() {
        let (result, err) = format_sql("", true);
        assert!(result.is_empty());
        assert!(err.is_none());
    }
}
