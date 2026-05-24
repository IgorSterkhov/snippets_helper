"""add share links

Revision ID: 008
Revises: 007
Create Date: 2026-05-24
"""

from alembic import op
import sqlalchemy as sa


revision = "008"
down_revision = "007"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "share_links",
        sa.Column("token", sa.String(length=96), primary_key=True),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("item_type", sa.String(length=20), nullable=False),
        sa.Column("item_uuid", sa.Uuid(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("revoked_at", sa.DateTime(), nullable=True),
        sa.CheckConstraint("item_type IN ('note', 'shortcut')", name="ck_share_links_item_type"),
    )
    op.create_index("idx_share_links_token", "share_links", ["token"])
    op.create_index("idx_share_links_owner_item", "share_links", ["user_id", "item_type", "item_uuid"])
    op.create_index(
        "uq_share_links_active_owner_item",
        "share_links",
        ["user_id", "item_type", "item_uuid"],
        unique=True,
        postgresql_where=sa.text("is_active = true"),
    )


def downgrade():
    op.drop_index("uq_share_links_active_owner_item", table_name="share_links")
    op.drop_index("idx_share_links_owner_item", table_name="share_links")
    op.drop_index("idx_share_links_token", table_name="share_links")
    op.drop_table("share_links")
