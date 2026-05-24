"""add pinned shortcuts and note pinned order

Revision ID: 007
Revises: 006
Create Date: 2026-05-24
"""
from alembic import op
import sqlalchemy as sa

revision = "007"
down_revision = "006"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("shortcuts", sa.Column("is_pinned", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("shortcuts", sa.Column("pinned_sort_order", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("notes", sa.Column("pinned_sort_order", sa.Integer(), nullable=False, server_default="0"))


def downgrade():
    op.drop_column("notes", "pinned_sort_order")
    op.drop_column("shortcuts", "pinned_sort_order")
    op.drop_column("shortcuts", "is_pinned")
