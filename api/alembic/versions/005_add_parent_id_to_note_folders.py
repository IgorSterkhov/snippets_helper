"""add parent_id column to note_folders

Revision ID: 005
Revises: 004
Create Date: 2026-04-02
"""
from alembic import op
import sqlalchemy as sa

revision = "005"
down_revision = "004"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('note_folders', sa.Column('parent_id', sa.Integer(), nullable=True))


def downgrade():
    op.drop_column('note_folders', 'parent_id')
