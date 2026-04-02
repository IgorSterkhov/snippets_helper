use regex::Regex;

/// ClickHouse functions with correct casing.
const CLICKHOUSE_FUNCTIONS: &[&str] = &[
    // Dict functions
    "dictGet", "dictGetOrDefault", "dictGetOrNull", "dictHas",
    "dictGetHierarchy", "dictIsIn",
    // Conditional
    "multiIf",
    // Date/time
    "toDate", "toDateTime", "toDateTime64", "toDateOrNull", "toDateTimeOrNull",
    "toStartOfDay", "toStartOfHour", "toStartOfMinute", "toStartOfMonth",
    "toStartOfQuarter", "toStartOfYear", "toStartOfWeek", "toMonday",
    "toYear", "toMonth", "toWeek", "toDayOfMonth", "toDayOfWeek", "toDayOfYear",
    "toHour", "toMinute", "toSecond", "toUnixTimestamp",
    "formatDateTime", "parseDateTimeBestEffort", "parseDateTime64BestEffort",
    "dateDiff", "dateAdd", "dateSub", "timeSlot",
    // Type conversion
    "toString", "toInt8", "toInt16", "toInt32", "toInt64", "toInt128", "toInt256",
    "toUInt8", "toUInt16", "toUInt32", "toUInt64", "toUInt128", "toUInt256",
    "toFloat32", "toFloat64", "toDecimal32", "toDecimal64", "toDecimal128",
    "toFixedString", "toUUID", "toIPv4", "toIPv6",
    "toIntervalSecond", "toIntervalMinute", "toIntervalHour", "toIntervalDay",
    "toIntervalWeek", "toIntervalMonth", "toIntervalQuarter", "toIntervalYear",
    "reinterpretAsInt8", "reinterpretAsInt16", "reinterpretAsInt32", "reinterpretAsInt64",
    "reinterpretAsUInt8", "reinterpretAsUInt16", "reinterpretAsUInt32", "reinterpretAsUInt64",
    "reinterpretAsFloat32", "reinterpretAsFloat64", "reinterpretAsString",
    "accurateCast", "accurateCastOrNull",
    // Aggregate
    "countIf", "sumIf", "avgIf", "minIf", "maxIf", "anyIf",
    "uniq", "uniqExact", "uniqCombined", "uniqCombined64", "uniqHLL12",
    "groupArray", "groupArrayInsertAt", "groupUniqArray",
    "groupBitAnd", "groupBitOr", "groupBitXor",
    "argMin", "argMax",
    "quantile", "quantiles", "quantileExact", "quantileTiming",
    "simpleLinearRegression", "stochasticLinearRegression",
    // String
    "replaceAll", "replaceOne", "replaceRegexpAll", "replaceRegexpOne",
    "splitByChar", "splitByString", "splitByRegexp",
    "arrayStringConcat", "extractAll", "extractAllGroups",
    "trimLeft", "trimRight", "trimBoth",
    "leftPad", "rightPad", "leftPadUTF8", "rightPadUTF8",
    "lowerUTF8", "upperUTF8", "reverseUTF8",
    "substringUTF8", "lengthUTF8", "positionUTF8",
    "positionCaseInsensitive", "positionCaseInsensitiveUTF8",
    "multiSearchFirstIndex", "multiSearchFirstPosition", "multiSearchAny",
    "multiMatchAny", "multiMatchAnyIndex", "multiFuzzyMatchAny",
    "normalizeQuery", "normalizedQueryHash",
    "encodeXMLComponent", "decodeXMLComponent",
    "extractURLParameter", "extractURLParameters", "extractURLParameterNames",
    "cutURLParameter", "cutToFirstSignificantSubdomain",
    "URLHierarchy", "URLPathHierarchy",
    // Array
    "arrayJoin", "arrayConcat", "arrayElement", "arrayPushBack", "arrayPushFront",
    "arrayPopBack", "arrayPopFront", "arraySlice", "arrayReverse",
    "arrayCompact", "arrayDistinct", "arrayEnumerate", "arrayEnumerateDense",
    "arrayEnumerateUniq", "arrayReduce", "arrayReduceInRanges",
    "arrayFilter", "arrayExists", "arrayAll", "arrayFirst", "arrayFirstIndex",
    "arraySum", "arrayAvg", "arrayCount", "arrayMin", "arrayMax",
    "arraySort", "arrayReverseSort", "arrayUniq", "arrayDifference",
    "hasAll", "hasAny", "hasSubstr", "indexOf", "arrayZip",
    // Null
    "ifNull", "nullIf", "assumeNotNull", "toNullable", "coalesce", "isNull", "isNotNull",
    // JSON
    "JSONExtract", "JSONExtractString", "JSONExtractInt", "JSONExtractFloat",
    "JSONExtractBool", "JSONExtractRaw", "JSONExtractArrayRaw", "JSONExtractKeysAndValues",
    "JSONHas", "JSONLength", "JSONType", "JSONExtractKeys",
    "simpleJSONExtractString", "simpleJSONExtractInt", "simpleJSONExtractFloat",
    "simpleJSONExtractBool", "simpleJSONExtractRaw", "simpleJSONHas",
    // Bit
    "bitAnd", "bitOr", "bitXor", "bitNot", "bitShiftLeft", "bitShiftRight",
    "bitRotateLeft", "bitRotateRight", "bitTest", "bitTestAll", "bitTestAny",
    "bitCount", "bitPositionsToArray",
    // Hash
    "cityHash64", "sipHash64", "sipHash128", "halfMD5",
    "farmHash64", "javaHash",
    "murmurHash2_32", "murmurHash2_64", "murmurHash3_32", "murmurHash3_64",
    "murmurHash3_128", "xxHash32", "xxHash64",
    // Geo
    "geoDistance", "greatCircleDistance", "greatCircleAngle",
    "pointInEllipses", "pointInPolygon",
    "geohashEncode", "geohashDecode", "geohashesInBox",
    "h3IsValid", "h3GetResolution", "h3EdgeAngle", "h3EdgeLengthM",
    // IP
    "IPv4NumToString", "IPv4StringToNum", "IPv4ToIPv6",
    "IPv6NumToString", "IPv6StringToNum",
    "isIPv4String", "isIPv6String",
    // Misc
    "runningDifference", "runningDifferenceStartingWithFirstValue",
    "runningAccumulate",
    "rowNumberInAllBlocks", "rowNumberInBlock",
    "formatRow", "formatRowNoNewline",
    "generateUUIDv4",
    "getMacro", "getSetting",
    "isFinite", "isInfinite", "isNaN",
    "toTypeName", "blockSize", "materialize", "ignore",
    "sleep", "sleepEachRow",
    "currentDatabase", "currentUser", "hostName", "uptime", "version",
    "throwIf", "identity",
];

/// SQL keywords for case conversion.
const SQL_KEYWORDS: &[&str] = &[
    "select", "from", "where", "and", "or", "not", "in", "is", "null",
    "as", "on", "join", "left", "right", "inner", "outer", "full", "cross",
    "group", "by", "order", "having", "limit", "offset", "union", "all",
    "distinct", "case", "when", "then", "else", "end", "cast", "between",
    "like", "ilike", "exists", "any", "with", "recursive", "insert", "into",
    "values", "update", "set", "delete", "create", "table", "view", "index",
    "drop", "alter", "add", "column", "primary", "key", "foreign", "references",
    "asc", "desc", "nulls", "first", "last", "over", "partition", "row", "rows",
    "range", "unbounded", "preceding", "following", "current", "interval",
    "true", "false", "using", "natural", "except", "intersect", "global",
    "prewhere", "sample", "array", "final", "format", "settings",
];

/// SQL keywords that start new clauses (for line-break formatting).
const CLAUSE_KEYWORDS: &[&str] = &[
    "select", "from", "where", "join", "left join", "right join",
    "inner join", "outer join", "full join", "cross join",
    "full outer join", "left outer join", "right outer join",
    "group by", "order by", "having", "limit", "offset",
    "union", "union all", "except", "intersect",
    "insert into", "values", "set", "on",
    "prewhere", "sample", "final", "format", "settings",
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

/// Basic SQL formatting: add line breaks before clause keywords and indent.
fn basic_format(sql: &str) -> String {
    // Normalize whitespace (collapse multiple spaces/newlines into one space)
    let re_ws = Regex::new(r"\s+").unwrap();
    let normalized = re_ws.replace_all(sql.trim(), " ").to_string();

    // Build a regex that matches clause keywords as whole words (case-insensitive)
    // Sort by length descending so longer matches take priority
    let mut sorted_kw: Vec<&str> = CLAUSE_KEYWORDS.to_vec();
    sorted_kw.sort_by(|a, b| b.len().cmp(&a.len()));

    let kw_pattern = sorted_kw
        .iter()
        .map(|kw| regex::escape(kw))
        .collect::<Vec<_>>()
        .join("|");
    let re_clause = Regex::new(&format!(r"(?i)\b({kw_pattern})\b")).unwrap();

    let mut result = String::new();
    let mut last = 0;

    for m in re_clause.find_iter(&normalized) {
        let before = &normalized[last..m.start()];
        if !before.is_empty() {
            result.push_str(before.trim_end());
        }
        if !result.is_empty() {
            result.push('\n');
        }
        result.push_str(m.as_str());
        last = m.end();
    }
    if last < normalized.len() {
        let rest = &normalized[last..];
        result.push_str(rest);
    }

    result
}

/// Convert SQL keywords to UPPER case while preserving non-keywords.
fn keywords_to_upper(sql: &str) -> String {
    let re = Regex::new(r"\b([a-zA-Z_]+)\b").unwrap();
    re.replace_all(sql, |caps: &regex::Captures| {
        let word = &caps[1];
        if SQL_KEYWORDS.contains(&word.to_lowercase().as_str()) {
            word.to_uppercase()
        } else {
            word.to_string()
        }
    })
    .to_string()
}

/// Convert SQL keywords to lower case while preserving non-keywords.
fn keywords_to_lower(sql: &str) -> String {
    let re = Regex::new(r"\b([a-zA-Z_]+)\b").unwrap();
    re.replace_all(sql, |caps: &regex::Captures| {
        let word = &caps[1];
        if SQL_KEYWORDS.contains(&word.to_lowercase().as_str()) {
            word.to_lowercase()
        } else {
            word.to_string()
        }
    })
    .to_string()
}

/// Restore ClickHouse function names to their correct camelCase form.
fn restore_function_case(sql: &str) -> String {
    let re = Regex::new(r"\b([a-zA-Z_][a-zA-Z0-9_]*)\s*\(").unwrap();
    re.replace_all(sql, |caps: &regex::Captures| {
        let func_name = &caps[1];
        for ch_func in CLICKHOUSE_FUNCTIONS {
            if ch_func.eq_ignore_ascii_case(func_name) {
                return format!("{ch_func}(");
            }
        }
        caps[0].to_string()
    })
    .to_string()
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
        assert!(result.contains("FROM"));
        assert!(result.contains("WHERE"));
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
        let (result, _) = format_sql("select todate(x), dictget('db.dict', 'col', id) from t", true);
        assert!(result.contains("toDate("));
        assert!(result.contains("dictGet("));
    }

    #[test]
    fn test_jinja_blocks_preserved() {
        let (result, _) = format_sql("select * from {{ table_name }} where x = {% if cond %}1{% endif %}", true);
        assert!(result.contains("{{ table_name }}"));
        assert!(result.contains("{% if cond %}"));
        assert!(result.contains("{% endif %}"));
    }

    #[test]
    fn test_empty_input() {
        let (result, err) = format_sql("", true);
        assert!(result.is_empty());
        assert!(err.is_none());
    }
}
