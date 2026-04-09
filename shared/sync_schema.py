"""
Definition of syncable tables and their data fields.
Used by both client (sync engine) and server (API) to ensure consistency.
"""

# Fields added to every synced table in local DuckDB
SYNC_FIELDS = ['uuid', 'updated_at', 'sync_status', 'user_id']

# Syncable tables and their original data fields (excluding sync fields)
SYNCED_TABLES = {
    'shortcuts': {
        'data_fields': ['id', 'name', 'value', 'description', 'links', 'obsidian_note'],
        'pk': 'id',
    },
    'sql_table_analyzer_templates': {
        'data_fields': ['id', 'template_text'],
        'pk': 'id',
    },
    'sql_macrosing_templates': {
        'data_fields': ['id', 'template_name', 'template_text', 'placeholders_config',
                        'combination_mode', 'separator'],
        'pk': 'id',
    },
    'note_folders': {
        'data_fields': ['id', 'name', 'sort_order', 'parent_id'],
        'pk': 'id',
    },
    'notes': {
        'data_fields': ['id', 'folder_id', 'title', 'content', 'created_at',
                        'is_pinned'],
        'pk': 'id',
    },
    'obfuscation_mappings': {
        'data_fields': ['id', 'session_name', 'entity_type', 'original_value',
                        'obfuscated_value', 'created_at'],
        'pk': 'id',
    },
    'snippet_tags': {
        'data_fields': ['id', 'name', 'patterns', 'color', 'sort_order'],
        'pk': 'id',
    },
}
