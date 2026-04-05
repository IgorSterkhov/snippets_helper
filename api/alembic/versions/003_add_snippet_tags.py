"""add snippet_tags table

Revision ID: 003
Revises: 002
Create Date: 2026-04-02
"""
from alembic import op
import sqlalchemy as sa

revision = "003"
down_revision = "002"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('snippet_tags',
        sa.Column('uuid', sa.Uuid(), primary_key=True),
        sa.Column('user_id', sa.Uuid(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('id', sa.Integer()),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('patterns', sa.Text(), nullable=False, server_default='[]'),
        sa.Column('color', sa.String(), nullable=False, server_default='#388bfd'),
        sa.Column('sort_order', sa.Integer(), server_default='0'),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.Column('is_deleted', sa.Boolean(), server_default='false'),
    )
    op.create_index('idx_snippet_tags_user_updated', 'snippet_tags', ['user_id', 'updated_at'])


def downgrade():
    op.drop_index('idx_snippet_tags_user_updated', table_name='snippet_tags')
    op.drop_table('snippet_tags')
