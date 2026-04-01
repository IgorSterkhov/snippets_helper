"""Initial schema

Revision ID: 001
Revises:
Create Date: 2026-03-11
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "users",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("api_key", sa.String(64), unique=True, nullable=False),
        sa.Column("name", sa.String(255)),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now()),
    )

    # --- shortcuts ---
    op.create_table(
        "shortcuts",
        sa.Column("uuid", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("id", sa.Integer),
        sa.Column("name", sa.String, nullable=False),
        sa.Column("value", sa.Text, nullable=False),
        sa.Column("description", sa.Text),
        sa.Column("updated_at", sa.DateTime, nullable=False, server_default=sa.func.now()),
        sa.Column("is_deleted", sa.Boolean, server_default=sa.text("false")),
    )
    op.create_index("idx_shortcuts_user_updated", "shortcuts", ["user_id", "updated_at"])

    # --- sql_table_analyzer_templates ---
    op.create_table(
        "sql_table_analyzer_templates",
        sa.Column("uuid", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("id", sa.Integer),
        sa.Column("template_text", sa.Text, nullable=False),
        sa.Column("updated_at", sa.DateTime, nullable=False, server_default=sa.func.now()),
        sa.Column("is_deleted", sa.Boolean, server_default=sa.text("false")),
    )
    op.create_index("idx_sql_tpl_user_updated", "sql_table_analyzer_templates", ["user_id", "updated_at"])

    # --- sql_macrosing_templates ---
    op.create_table(
        "sql_macrosing_templates",
        sa.Column("uuid", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("id", sa.Integer),
        sa.Column("template_name", sa.String, nullable=False),
        sa.Column("template_text", sa.Text, nullable=False),
        sa.Column("placeholders_config", sa.Text, nullable=False),
        sa.Column("combination_mode", sa.String, nullable=False, server_default="cartesian"),
        sa.Column("separator", sa.String, nullable=False, server_default=sa.text("E';\\n'")),
        sa.Column("updated_at", sa.DateTime, nullable=False, server_default=sa.func.now()),
        sa.Column("is_deleted", sa.Boolean, server_default=sa.text("false")),
    )
    op.create_index("idx_macro_tpl_user_updated", "sql_macrosing_templates", ["user_id", "updated_at"])

    # --- note_folders ---
    op.create_table(
        "note_folders",
        sa.Column("uuid", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("id", sa.Integer),
        sa.Column("name", sa.String, nullable=False),
        sa.Column("sort_order", sa.Integer, server_default="0"),
        sa.Column("updated_at", sa.DateTime, nullable=False, server_default=sa.func.now()),
        sa.Column("is_deleted", sa.Boolean, server_default=sa.text("false")),
    )
    op.create_index("idx_note_folders_user_updated", "note_folders", ["user_id", "updated_at"])

    # --- notes ---
    op.create_table(
        "notes",
        sa.Column("uuid", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("id", sa.Integer),
        sa.Column("folder_id", sa.Integer),
        sa.Column("folder_uuid", UUID(as_uuid=True)),
        sa.Column("title", sa.String, nullable=False),
        sa.Column("content", sa.Text),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime, nullable=False, server_default=sa.func.now()),
        sa.Column("is_pinned", sa.Integer, server_default="0"),
        sa.Column("is_deleted", sa.Boolean, server_default=sa.text("false")),
    )
    op.create_index("idx_notes_user_updated", "notes", ["user_id", "updated_at"])

    # --- obfuscation_mappings ---
    op.create_table(
        "obfuscation_mappings",
        sa.Column("uuid", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("id", sa.Integer),
        sa.Column("session_name", sa.String, nullable=False),
        sa.Column("entity_type", sa.String, nullable=False),
        sa.Column("original_value", sa.String, nullable=False),
        sa.Column("obfuscated_value", sa.String, nullable=False),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime, nullable=False, server_default=sa.func.now()),
        sa.Column("is_deleted", sa.Boolean, server_default=sa.text("false")),
    )
    op.create_index("idx_obfuscation_user_updated", "obfuscation_mappings", ["user_id", "updated_at"])


def downgrade():
    op.drop_table("obfuscation_mappings")
    op.drop_table("notes")
    op.drop_table("note_folders")
    op.drop_table("sql_macrosing_templates")
    op.drop_table("sql_table_analyzer_templates")
    op.drop_table("shortcuts")
    op.drop_table("users")
