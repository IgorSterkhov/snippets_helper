"""add telegram ai tables

Revision ID: 011
Revises: 010
Create Date: 2026-05-29
"""

from alembic import op
import sqlalchemy as sa


revision = "011"
down_revision = "010"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "telegram_chat_bindings",
        sa.Column("chat_id", sa.BigInteger(), primary_key=True),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
    )
    op.create_index("idx_telegram_chat_bindings_user", "telegram_chat_bindings", ["user_id"])
    op.create_index("idx_telegram_chat_bindings_active", "telegram_chat_bindings", ["is_active"])

    op.create_table(
        "telegram_processed_messages",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("chat_id", sa.BigInteger(), nullable=False),
        sa.Column("message_id", sa.BigInteger(), nullable=False),
        sa.Column("update_id", sa.BigInteger(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("chat_id", "message_id", name="uq_telegram_processed_chat_message"),
    )
    op.create_index("idx_telegram_processed_update", "telegram_processed_messages", ["update_id"])


def downgrade():
    op.drop_index("idx_telegram_processed_update", table_name="telegram_processed_messages")
    op.drop_table("telegram_processed_messages")
    op.drop_index("idx_telegram_chat_bindings_active", table_name="telegram_chat_bindings")
    op.drop_index("idx_telegram_chat_bindings_user", table_name="telegram_chat_bindings")
    op.drop_table("telegram_chat_bindings")
