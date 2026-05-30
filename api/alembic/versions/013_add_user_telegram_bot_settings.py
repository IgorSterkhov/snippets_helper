"""add user telegram bot settings

Revision ID: 013
Revises: 012
Create Date: 2026-05-30
"""

from alembic import op
import sqlalchemy as sa


revision = "013"
down_revision = "012"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("users", sa.Column("telegram_bot_token", sa.Text(), nullable=True))
    op.add_column("users", sa.Column("telegram_bot_updated_at", sa.DateTime(), nullable=True))

    op.drop_constraint("telegram_chat_bindings_pkey", "telegram_chat_bindings", type_="primary")
    op.create_primary_key(
        "pk_telegram_chat_bindings",
        "telegram_chat_bindings",
        ["user_id", "chat_id"],
    )

    op.add_column(
        "telegram_processed_messages",
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=True),
    )
    op.drop_constraint(
        "uq_telegram_processed_chat_message",
        "telegram_processed_messages",
        type_="unique",
    )
    op.create_unique_constraint(
        "uq_telegram_processed_user_chat_message",
        "telegram_processed_messages",
        ["user_id", "chat_id", "message_id"],
    )
    op.create_index(
        "idx_telegram_processed_user_update",
        "telegram_processed_messages",
        ["user_id", "update_id"],
    )


def downgrade():
    op.drop_index("idx_telegram_processed_user_update", table_name="telegram_processed_messages")
    op.drop_constraint(
        "uq_telegram_processed_user_chat_message",
        "telegram_processed_messages",
        type_="unique",
    )
    op.create_unique_constraint(
        "uq_telegram_processed_chat_message",
        "telegram_processed_messages",
        ["chat_id", "message_id"],
    )
    op.drop_column("telegram_processed_messages", "user_id")

    op.drop_constraint("pk_telegram_chat_bindings", "telegram_chat_bindings", type_="primary")
    op.create_primary_key(
        "telegram_chat_bindings_pkey",
        "telegram_chat_bindings",
        ["chat_id"],
    )

    op.drop_column("users", "telegram_bot_updated_at")
    op.drop_column("users", "telegram_bot_token")
