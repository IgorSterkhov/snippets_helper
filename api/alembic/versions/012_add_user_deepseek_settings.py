"""add user deepseek settings

Revision ID: 012
Revises: 011
Create Date: 2026-05-29
"""

from alembic import op
import sqlalchemy as sa


revision = "012"
down_revision = "011"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("users", sa.Column("deepseek_api_key", sa.Text(), nullable=True))
    op.add_column("users", sa.Column("deepseek_updated_at", sa.DateTime(), nullable=True))


def downgrade():
    op.drop_column("users", "deepseek_updated_at")
    op.drop_column("users", "deepseek_api_key")
