import re
import json
import csv
from typing import Dict, List, Set, Tuple
from datetime import datetime


# SQL keywords and types to exclude from columns
SQL_KEYWORDS = {
    # SQL standard keywords
    'select', 'from', 'where', 'and', 'or', 'as', 'on', 'join', 'left', 'right',
    'inner', 'outer', 'full', 'cross', 'group', 'by', 'order', 'having', 'limit',
    'offset', 'union', 'all', 'distinct', 'case', 'when', 'then', 'else', 'end',
    'null', 'true', 'false', 'not', 'in', 'between', 'like', 'is', 'exists',
    'insert', 'update', 'delete', 'create', 'alter', 'drop', 'table', 'index',
    'primary', 'key', 'foreign', 'references', 'constraint', 'default', 'values',
    'set', 'into', 'partition', 'using', 'over', 'window', 'rows', 'range',
    'preceding', 'following', 'current', 'row', 'unbounded', 'asc', 'desc',
    'nulls', 'first', 'last', 'with', 'recursive', 'materialized', 'view',
    'if', 'else', 'cast', 'convert', 'coalesce', 'nullif', 'global', 'local',
    'temporary', 'temp', 'final', 'sample', 'prewhere', 'array', 'tuple',
}

# ClickHouse type patterns (regex)
CLICKHOUSE_TYPE_PATTERN = re.compile(
    r'^(U?Int(8|16|32|64|128|256)|Float(32|64)|Decimal\d*|'
    r'Date(Time(64)?)?|String|FixedString|UUID|Bool|IPv[46]|'
    r'Enum\d*|Array|Tuple|Map|Nullable|LowCardinality|'
    r'SimpleAggregateFunction|AggregateFunction)$',
    re.IGNORECASE
)


def _remove_python_imports(code: str) -> str:
    """
    Remove Python import lines from code to avoid false positives.
    Removes lines starting with 'from X import' or 'import X'.
    """
    lines = code.split('\n')
    filtered_lines = []
    for line in lines:
        stripped = line.strip()
        # Skip Python import lines
        if stripped.startswith('from ') and ' import ' in stripped:
            continue
        if stripped.startswith('import '):
            continue
        filtered_lines.append(line)
    return '\n'.join(filtered_lines)


def _is_sql_keyword_or_type(name: str) -> bool:
    """Check if name is SQL keyword, ClickHouse type, or Python constant."""
    # SQL keywords
    if name.lower() in SQL_KEYWORDS:
        return True
    # ClickHouse types
    if CLICKHOUSE_TYPE_PATTERN.match(name):
        return True
    # Python constants (UPPER_SNAKE_CASE like CLEAR_MANUAL, TABLE_NAME etc.)
    if re.match(r'^[A-Z][A-Z0-9_]*$', name) and len(name) > 2:
        return True
    return False


def extract_entities(code: str) -> Dict[str, Set[str]]:
    """
    Extract all entities from SQL/DAG code.
    Returns dict with sets of found entities by category.
    """
    entities = {
        'schemas': set(),
        'tables': set(),      # includes dictGet targets
        'columns': set(),
        'dag_ids': set(),
        'task_ids': set(),
        'literals': set(),
        'variables': set()    # Python variables (name=value pairs)
    }

    # Remove Python imports before parsing
    code_cleaned = _remove_python_imports(code)

    # Pattern for schema.table from FROM/JOIN (with negative lookahead for 'import')
    pattern_from_join = r'(?:from|join)\s+([a-zA-Z_][a-zA-Z0-9_]*)\.([a-zA-Z_][a-zA-Z0-9_]*)(?!\s+import)'
    matches = re.findall(pattern_from_join, code_cleaned, re.IGNORECASE)
    for schema, table in matches:
        entities['schemas'].add(schema)
        entities['tables'].add(f"{schema}.{table}")

    # Pattern for dictGet('schema.dict')
    pattern_dictget = r"dictGet\s*\(\s*['\"]([a-zA-Z_][a-zA-Z0-9_]*)\.([a-zA-Z_][a-zA-Z0-9_]*)['\"]"
    matches = re.findall(pattern_dictget, code_cleaned, re.IGNORECASE)
    for schema, dict_name in matches:
        entities['schemas'].add(schema)
        entities['tables'].add(f"{schema}.{dict_name}")

    # Pattern for columns from SELECT (only explicit columns)
    pattern_select = r'SELECT\s+(.*?)\s+FROM'
    select_matches = re.findall(pattern_select, code_cleaned, re.IGNORECASE | re.DOTALL)
    for select_clause in select_matches:
        # Remove DISTINCT/ALL/TOP from the beginning
        select_clause = re.sub(r'^\s*(DISTINCT|ALL|TOP\s+\d+)\s+', '', select_clause, flags=re.IGNORECASE)
        # Split by comma, handle aliases
        parts = select_clause.split(',')
        for part in parts:
            part = part.strip()
            # Skip * and complex expressions
            if '*' in part or '(' in part:
                continue
            # Handle alias: col AS alias or col alias
            col_match = re.match(r'^([a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)?)(?:\s+(?:AS\s+)?[a-zA-Z_][a-zA-Z0-9_]*)?$', part, re.IGNORECASE)
            if col_match:
                col = col_match.group(1)
                # If has table prefix (t.column), take only column name
                if '.' in col:
                    col = col.split('.')[-1]
                # Skip SQL keywords, ClickHouse types, and Python constants
                if not _is_sql_keyword_or_type(col):
                    entities['columns'].add(col)

    # Pattern for dag_id
    pattern_dag_id = r"dag_id\s*=\s*['\"]([^'\"]+)['\"]"
    matches = re.findall(pattern_dag_id, code_cleaned, re.IGNORECASE)
    entities['dag_ids'].update(matches)

    # Pattern for task_id
    pattern_task_id = r"task_id\s*=\s*['\"]([^'\"]+)['\"]"
    matches = re.findall(pattern_task_id, code_cleaned, re.IGNORECASE)
    entities['task_ids'].update(matches)

    # Pattern for string literals (length > 3)
    pattern_literals = r"'([^']{4,})'"
    matches = re.findall(pattern_literals, code_cleaned)
    for lit in matches:
        if _is_meaningful_literal(lit):
            entities['literals'].add(lit)

    # Pattern for Python variables
    # First, remove multiline strings content to avoid false positives
    code_no_multiline = re.sub(r'""".*?"""', '""""""', code_cleaned, flags=re.DOTALL)
    code_no_multiline = re.sub(r"'''.*?'''", "''''''", code_no_multiline, flags=re.DOTALL)

    # 1. String assignments: var_name = "value" or var_name = 'value'
    # Capture the quote type to preserve it
    pattern_str_assign = r'([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(["\'])([^"\']+)\2'
    matches = re.findall(pattern_str_assign, code_no_multiline)
    for var_name, quote, var_value in matches:
        # Skip short variable names and common temp vars
        if len(var_name) > 2 and var_name.lower() not in ('dag', 'sql', 'tmp', 'var', 'val', 'key', 'row'):
            # Skip dag_id and task_id (already handled separately)
            if var_name.lower() not in ('dag_id', 'task_id'):
                # Format: name|quote|value (use | as separator since = can be in value)
                entities['variables'].add(f"{var_name}|{quote}|{var_value}")

    # 2. UPPER_CASE constants: CONST_NAME = "value"
    pattern_const = r'([A-Z][A-Z0-9_]*)\s*=\s*(["\'])([^"\']+)\2'
    matches = re.findall(pattern_const, code_no_multiline)
    for var_name, quote, var_value in matches:
        if len(var_name) > 2:
            entities['variables'].add(f"{var_name}|{quote}|{var_value}")

    # 3. Multiline string assignments: var = """...""" or var = '''...'''
    # Parse from original code_cleaned (not code_no_multiline)
    # For multiline, only obfuscate the variable NAME, not the value
    pattern_multiline = r'([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*"""(.*?)"""'
    matches = re.findall(pattern_multiline, code_cleaned, re.DOTALL)
    for var_name, var_value in matches:
        if len(var_name) > 2 and var_value.strip():
            # Store preview for display, mark as multiline with triple quotes
            preview = var_value.strip()[:50].replace('\n', ' ')
            if len(var_value) > 50:
                preview += '...'
            # Use special marker for multiline: name|"""|preview
            entities['variables'].add(f"{var_name}|\"\"\"|{preview}")

    # Also check triple single quotes
    pattern_multiline_sq = r"([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*'''(.*?)'''"
    matches = re.findall(pattern_multiline_sq, code_cleaned, re.DOTALL)
    for var_name, var_value in matches:
        if len(var_name) > 2 and var_value.strip():
            preview = var_value.strip()[:50].replace('\n', ' ')
            if len(var_value) > 50:
                preview += '...'
            entities['variables'].add(f"{var_name}|'''|{preview}")

    return entities


def _is_meaningful_literal(value: str) -> bool:
    """
    Filter out dates, LIKE patterns, numbers, and SQL keywords.
    """
    # Skip dates (YYYY-MM-DD, DD.MM.YYYY, etc.)
    if re.match(r'^\d{4}-\d{2}-\d{2}', value):
        return False
    if re.match(r'^\d{2}\.\d{2}\.\d{4}', value):
        return False

    # Skip LIKE patterns
    if '%' in value or '_' in value:
        return False

    # Skip pure numbers
    if re.match(r'^\d+$', value):
        return False

    # Skip SQL keywords
    sql_keywords = {'null', 'true', 'false', 'none', 'asc', 'desc'}
    if value.lower() in sql_keywords:
        return False

    # Skip datetime-like strings
    if re.match(r'^\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}', value):
        return False

    return True


def generate_obfuscated_names(entities: Dict[str, Set[str]]) -> List[Dict]:
    """
    Generate obfuscated names for all entities.
    Returns list of mappings with structure:
    {
        'entity_type': str,
        'original_value': str,
        'obfuscated_value': str,
        'enabled': bool
    }
    """
    mappings = []
    counters = {
        'schema': 1,
        'table': 1,
        'column': 1,
        'dag': 1,
        'task': 1,
        'literal': 1,
        'variable': 1
    }

    # Map schemas first (needed for table obfuscation)
    schema_map = {}
    for schema in sorted(entities.get('schemas', [])):
        obf_name = f"sch_{counters['schema']:03d}"
        schema_map[schema] = obf_name
        mappings.append({
            'entity_type': 'schema',
            'original_value': schema,
            'obfuscated_value': obf_name,
            'enabled': True
        })
        counters['schema'] += 1

    # Tables (schema.table -> sch_XXX.obj_YYY)
    for table in sorted(entities.get('tables', [])):
        if '.' in table:
            schema, tbl_name = table.split('.', 1)
            obf_schema = schema_map.get(schema, schema)
            obf_table = f"obj_{counters['table']:03d}"
            obf_full = f"{obf_schema}.{obf_table}"
        else:
            obf_full = f"obj_{counters['table']:03d}"
        mappings.append({
            'entity_type': 'table',
            'original_value': table,
            'obfuscated_value': obf_full,
            'enabled': True
        })
        counters['table'] += 1

    # Columns
    for col in sorted(entities.get('columns', [])):
        obf_name = f"col_{counters['column']:03d}"
        mappings.append({
            'entity_type': 'column',
            'original_value': col,
            'obfuscated_value': obf_name,
            'enabled': True
        })
        counters['column'] += 1

    # DAG IDs
    for dag_id in sorted(entities.get('dag_ids', [])):
        obf_name = f"dag_{counters['dag']:03d}"
        mappings.append({
            'entity_type': 'dag',
            'original_value': dag_id,
            'obfuscated_value': obf_name,
            'enabled': True
        })
        counters['dag'] += 1

    # Task IDs
    for task_id in sorted(entities.get('task_ids', [])):
        obf_name = f"task_{counters['task']:03d}"
        mappings.append({
            'entity_type': 'task',
            'original_value': task_id,
            'obfuscated_value': obf_name,
            'enabled': True
        })
        counters['task'] += 1

    # Literals
    for lit in sorted(entities.get('literals', [])):
        obf_name = f"str_{counters['literal']:03d}"
        mappings.append({
            'entity_type': 'literal',
            'original_value': lit,
            'obfuscated_value': obf_name,
            'enabled': False  # Literals disabled by default
        })
        counters['literal'] += 1

    # Variables (format: "var_name|quote|value")
    for var_entry in sorted(entities.get('variables', [])):
        if '|' in var_entry:
            parts = var_entry.split('|', 2)
            if len(parts) == 3:
                var_name, quote, var_value = parts
                obf_var_name = f"var_{counters['variable']:03d}"

                # Check if multiline (triple quotes) - only obfuscate name
                is_multiline = quote in ('"""', "'''")

                if is_multiline:
                    # For multiline: only change variable name, keep value
                    # Display format: name = """preview..."""
                    display_orig = f"{var_name} = {quote}{var_value}{quote}"
                    display_obf = f"{obf_var_name} = {quote}(unchanged){quote}"
                    mappings.append({
                        'entity_type': 'variable',
                        'original_value': var_entry,
                        'original_display': display_orig,
                        'obfuscated_value': f"{obf_var_name}|{quote}|",  # Empty value = keep original
                        'obfuscated_display': display_obf,
                        'enabled': False
                    })
                else:
                    # For regular strings: obfuscate both name and value
                    obf_var_value = f"val_{counters['variable']:03d}"
                    display_orig = f"{var_name} = {quote}{var_value}{quote}"
                    display_obf = f"{obf_var_name} = {quote}{obf_var_value}{quote}"
                    mappings.append({
                        'entity_type': 'variable',
                        'original_value': var_entry,
                        'original_display': display_orig,
                        'obfuscated_value': f"{obf_var_name}|{quote}|{obf_var_value}",
                        'obfuscated_display': display_obf,
                        'enabled': False
                    })
                counters['variable'] += 1

    return mappings


def apply_replacements(code: str, mappings: List[Dict]) -> str:
    """
    Apply enabled replacements to code.
    Order: tables first (longer matches), then schemas, columns, etc.
    """
    result = code

    # Sort mappings: longer original values first to avoid partial replacements
    enabled_mappings = [m for m in mappings if m.get('enabled', True)]
    enabled_mappings.sort(key=lambda m: len(m['original_value']), reverse=True)

    # Group by type for ordered replacement
    by_type = {}
    for m in enabled_mappings:
        t = m['entity_type']
        if t not in by_type:
            by_type[t] = []
        by_type[t].append(m)

    # Replace tables first (full schema.table)
    for m in by_type.get('table', []):
        # Use word boundaries for table names
        pattern = re.escape(m['original_value'])
        result = re.sub(
            r'(?<![a-zA-Z0-9_])' + pattern + r'(?![a-zA-Z0-9_])',
            m['obfuscated_value'],
            result,
            flags=re.IGNORECASE
        )

    # Replace DAG IDs (in quotes)
    for m in by_type.get('dag', []):
        pattern = r"(dag_id\s*=\s*['\"])" + re.escape(m['original_value']) + r"(['\"])"
        result = re.sub(pattern, r'\1' + m['obfuscated_value'] + r'\2', result, flags=re.IGNORECASE)

    # Replace Task IDs (in quotes)
    for m in by_type.get('task', []):
        pattern = r"(task_id\s*=\s*['\"])" + re.escape(m['original_value']) + r"(['\"])"
        result = re.sub(pattern, r'\1' + m['obfuscated_value'] + r'\2', result, flags=re.IGNORECASE)

    # Replace columns (with word boundaries)
    for m in by_type.get('column', []):
        pattern = r'(?<![a-zA-Z0-9_])' + re.escape(m['original_value']) + r'(?![a-zA-Z0-9_])'
        result = re.sub(pattern, m['obfuscated_value'], result)

    # Replace literals (in quotes)
    for m in by_type.get('literal', []):
        pattern = r"'" + re.escape(m['original_value']) + r"'"
        result = re.sub(pattern, "'" + m['obfuscated_value'] + "'", result)

    # Replace variables (format: name|quote|value)
    for m in by_type.get('variable', []):
        orig = m['original_value']
        obf = m['obfuscated_value']
        if '|' in orig and '|' in obf:
            orig_parts = orig.split('|', 2)
            obf_parts = obf.split('|', 2)
            if len(orig_parts) == 3 and len(obf_parts) == 3:
                orig_name, orig_quote, orig_value = orig_parts
                obf_name, obf_quote, obf_value = obf_parts

                # Always replace variable name (with word boundaries)
                pattern = r'(?<![a-zA-Z0-9_])' + re.escape(orig_name) + r'(?![a-zA-Z0-9_])'
                result = re.sub(pattern, obf_name, result)

                # Replace value only if obf_value is not empty (not multiline)
                if obf_value:
                    # For single/double quoted strings - use re.sub for proper escaping
                    if orig_quote in ('"', "'"):
                        pattern = re.escape(orig_quote) + re.escape(orig_value) + re.escape(orig_quote)
                        replacement = orig_quote + obf_value + orig_quote
                        result = re.sub(pattern, replacement, result)

    return result


def generate_session_name() -> str:
    """Generate auto session name."""
    return datetime.now().strftime("session_%Y-%m-%d_%H-%M")


def export_to_json(mappings: List[Dict], filepath: str):
    """Export mappings to JSON file."""
    # Remove 'enabled' field for export
    export_data = [
        {
            'entity_type': m['entity_type'],
            'original_value': m['original_value'],
            'obfuscated_value': m['obfuscated_value']
        }
        for m in mappings if m.get('enabled', True)
    ]
    with open(filepath, 'w', encoding='utf-8') as f:
        json.dump(export_data, f, ensure_ascii=False, indent=2)


def export_to_csv(mappings: List[Dict], filepath: str):
    """Export mappings to CSV file."""
    with open(filepath, 'w', encoding='utf-8', newline='') as f:
        writer = csv.writer(f)
        writer.writerow(['entity_type', 'original_value', 'obfuscated_value'])
        for m in mappings:
            if m.get('enabled', True):
                writer.writerow([m['entity_type'], m['original_value'], m['obfuscated_value']])


def load_from_file(filepath: str) -> List[Dict]:
    """Load mappings from JSON or CSV file."""
    mappings = []

    if filepath.endswith('.json'):
        with open(filepath, 'r', encoding='utf-8') as f:
            data = json.load(f)
            for item in data:
                mappings.append({
                    'entity_type': item['entity_type'],
                    'original_value': item['original_value'],
                    'obfuscated_value': item['obfuscated_value'],
                    'enabled': True
                })
    elif filepath.endswith('.csv'):
        with open(filepath, 'r', encoding='utf-8') as f:
            reader = csv.DictReader(f)
            for row in reader:
                mappings.append({
                    'entity_type': row['entity_type'],
                    'original_value': row['original_value'],
                    'obfuscated_value': row['obfuscated_value'],
                    'enabled': True
                })

    return mappings
