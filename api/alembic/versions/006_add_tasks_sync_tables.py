"""add tasks sync tables

Revision ID: 006
Revises: 005
Create Date: 2026-05-23
"""
from alembic import op
import sqlalchemy as sa

revision = "006"
down_revision = "005"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "task_categories",
        sa.Column("uuid", sa.Uuid(), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("id", sa.Integer()),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("color", sa.String(), nullable=False, server_default="#8b949e"),
        sa.Column("sort_order", sa.Integer(), server_default="0"),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("is_deleted", sa.Boolean(), server_default=sa.text("false")),
    )
    op.create_index("idx_task_categories_user_updated", "task_categories", ["user_id", "updated_at"])

    op.create_table(
        "task_statuses",
        sa.Column("uuid", sa.Uuid(), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("id", sa.Integer()),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("color", sa.String(), nullable=False, server_default="#8b949e"),
        sa.Column("sort_order", sa.Integer(), server_default="0"),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("is_deleted", sa.Boolean(), server_default=sa.text("false")),
    )
    op.create_index("idx_task_statuses_user_updated", "task_statuses", ["user_id", "updated_at"])

    op.create_table(
        "tasks",
        sa.Column("uuid", sa.Uuid(), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("id", sa.Integer()),
        sa.Column("title", sa.String(), nullable=False),
        sa.Column("category_id", sa.Integer()),
        sa.Column("category_uuid", sa.Uuid()),
        sa.Column("status_id", sa.Integer()),
        sa.Column("status_uuid", sa.Uuid()),
        sa.Column("is_pinned", sa.Integer(), server_default="0"),
        sa.Column("bg_color", sa.String()),
        sa.Column("tracker_url", sa.Text()),
        sa.Column("notes_md", sa.Text(), server_default=""),
        sa.Column("sort_order", sa.Integer(), server_default="0"),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("is_deleted", sa.Boolean(), server_default=sa.text("false")),
    )
    op.create_index("idx_tasks_user_updated", "tasks", ["user_id", "updated_at"])

    op.create_table(
        "task_checkboxes",
        sa.Column("uuid", sa.Uuid(), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("id", sa.Integer()),
        sa.Column("task_id", sa.Integer()),
        sa.Column("task_uuid", sa.Uuid()),
        sa.Column("parent_id", sa.Integer()),
        sa.Column("parent_uuid", sa.Uuid()),
        sa.Column("text", sa.Text(), nullable=False, server_default=""),
        sa.Column("is_checked", sa.Integer(), server_default="0"),
        sa.Column("sort_order", sa.Integer(), server_default="0"),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("is_deleted", sa.Boolean(), server_default=sa.text("false")),
    )
    op.create_index("idx_task_checkboxes_user_updated", "task_checkboxes", ["user_id", "updated_at"])

    op.create_table(
        "task_links",
        sa.Column("uuid", sa.Uuid(), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("id", sa.Integer()),
        sa.Column("task_id", sa.Integer()),
        sa.Column("task_uuid", sa.Uuid()),
        sa.Column("url", sa.Text(), nullable=False, server_default=""),
        sa.Column("label", sa.Text()),
        sa.Column("sort_order", sa.Integer(), server_default="0"),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("is_deleted", sa.Boolean(), server_default=sa.text("false")),
    )
    op.create_index("idx_task_links_user_updated", "task_links", ["user_id", "updated_at"])


def downgrade():
    op.drop_index("idx_task_links_user_updated", table_name="task_links")
    op.drop_table("task_links")
    op.drop_index("idx_task_checkboxes_user_updated", table_name="task_checkboxes")
    op.drop_table("task_checkboxes")
    op.drop_index("idx_tasks_user_updated", table_name="tasks")
    op.drop_table("tasks")
    op.drop_index("idx_task_statuses_user_updated", table_name="task_statuses")
    op.drop_table("task_statuses")
    op.drop_index("idx_task_categories_user_updated", table_name="task_categories")
    op.drop_table("task_categories")
