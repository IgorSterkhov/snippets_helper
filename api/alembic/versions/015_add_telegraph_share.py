"""add telegraph share

Revision ID: 015
Revises: 014
Create Date: 2026-06-09
"""

from alembic import op
import sqlalchemy as sa


revision = "015"
down_revision = "014"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("users", sa.Column("telegraph_access_token", sa.Text(), nullable=True))
    op.add_column("users", sa.Column("telegraph_short_name", sa.String(length=32), nullable=True))
    op.add_column("users", sa.Column("telegraph_author_name", sa.String(length=128), nullable=True))
    op.add_column("users", sa.Column("telegraph_author_url", sa.String(length=512), nullable=True))
    op.add_column("users", sa.Column("telegraph_updated_at", sa.DateTime(), nullable=True))

    op.create_table(
        "telegraph_pages",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("item_type", sa.String(length=20), nullable=False),
        sa.Column("item_uuid", sa.Uuid(), nullable=False),
        sa.Column("path", sa.String(length=255), nullable=False),
        sa.Column("url", sa.Text(), nullable=False),
        sa.Column("title", sa.String(length=256), nullable=False),
        sa.Column("content_hash", sa.String(length=64), nullable=False),
        sa.Column("views", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.Column("published_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint("item_type IN ('note', 'shortcut')", name="ck_telegraph_pages_item_type"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "item_type", "item_uuid", name="uq_telegraph_pages_owner_item"),
    )
    op.create_index(
        "idx_telegraph_pages_owner_item",
        "telegraph_pages",
        ["user_id", "item_type", "item_uuid"],
    )
    op.create_index(
        "idx_telegraph_pages_user_updated",
        "telegraph_pages",
        ["user_id", "updated_at"],
    )


def downgrade():
    op.drop_index("idx_telegraph_pages_user_updated", table_name="telegraph_pages")
    op.drop_index("idx_telegraph_pages_owner_item", table_name="telegraph_pages")
    op.drop_table("telegraph_pages")
    op.drop_column("users", "telegraph_updated_at")
    op.drop_column("users", "telegraph_author_url")
    op.drop_column("users", "telegraph_author_name")
    op.drop_column("users", "telegraph_short_name")
    op.drop_column("users", "telegraph_access_token")
