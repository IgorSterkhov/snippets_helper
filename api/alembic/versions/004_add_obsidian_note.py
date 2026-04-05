"""add obsidian_note column to shortcuts

Revision ID: 004
Revises: 003
Create Date: 2026-04-02
"""
from alembic import op
import sqlalchemy as sa

revision = "004"
down_revision = "003"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('shortcuts', sa.Column('obsidian_note', sa.Text(), nullable=True, server_default=''))


def downgrade():
    op.drop_column('shortcuts', 'obsidian_note')
