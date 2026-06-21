"""add finance payments

Revision ID: 017
Revises: 016
Create Date: 2026-06-21
"""

from alembic import op
import sqlalchemy as sa


revision = "017"
down_revision = "016"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "finance_payments",
        sa.Column("uuid", sa.Uuid(), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("id", sa.Integer()),
        sa.Column("plan_id", sa.Integer()),
        sa.Column("plan_uuid", sa.Uuid()),
        sa.Column("item_id", sa.Integer()),
        sa.Column("item_uuid", sa.Uuid()),
        sa.Column("month_key", sa.String(length=7), nullable=False),
        sa.Column("is_paid", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("paid_amount_cents", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("note", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("is_deleted", sa.Boolean(), server_default=sa.text("false")),
        sa.CheckConstraint(
            "paid_amount_cents >= 0",
            name="ck_finance_payments_amount_non_negative",
        ),
        sa.UniqueConstraint(
            "user_id",
            "item_uuid",
            "month_key",
            name="uq_finance_payments_user_item_month",
        ),
    )
    op.create_index(
        "idx_finance_payments_user_updated",
        "finance_payments",
        ["user_id", "updated_at"],
    )
    op.create_index(
        "idx_finance_payments_plan_month",
        "finance_payments",
        ["user_id", "plan_uuid", "month_key", "item_uuid"],
    )


def downgrade():
    op.drop_index("idx_finance_payments_plan_month", table_name="finance_payments")
    op.drop_index("idx_finance_payments_user_updated", table_name="finance_payments")
    op.drop_table("finance_payments")
