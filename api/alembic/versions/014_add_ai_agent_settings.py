"""add ai agent settings

Revision ID: 014
Revises: 013
Create Date: 2026-05-30
"""

from alembic import op
import sqlalchemy as sa


revision = "014"
down_revision = "013"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("users", sa.Column("ai_custom_instructions", sa.Text(), nullable=True))
    op.add_column("users", sa.Column("ai_custom_instructions_updated_at", sa.DateTime(), nullable=True))


def downgrade():
    op.drop_column("users", "ai_custom_instructions_updated_at")
    op.drop_column("users", "ai_custom_instructions")
