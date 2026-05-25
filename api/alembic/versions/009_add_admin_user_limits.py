"""add admin user limits

Revision ID: 009
Revises: 008
Create Date: 2026-05-25
"""

from alembic import op
import sqlalchemy as sa


revision = "009"
down_revision = "008"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "users",
        sa.Column("is_admin", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.add_column("users", sa.Column("last_seen_at", sa.DateTime(), nullable=True))
    op.add_column(
        "users",
        sa.Column(
            "media_quota_bytes",
            sa.BigInteger(),
            nullable=False,
            server_default="1073741824",
        ),
    )
    op.add_column(
        "users",
        sa.Column(
            "media_max_upload_bytes",
            sa.BigInteger(),
            nullable=False,
            server_default="20971520",
        ),
    )


def downgrade():
    op.drop_column("users", "media_max_upload_bytes")
    op.drop_column("users", "media_quota_bytes")
    op.drop_column("users", "last_seen_at")
    op.drop_column("users", "is_admin")
