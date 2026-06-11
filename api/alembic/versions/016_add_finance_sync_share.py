"""add finance sync share

Revision ID: 016
Revises: 015
Create Date: 2026-06-11
"""

from alembic import op
import sqlalchemy as sa


revision = "016"
down_revision = "015"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "finance_plans",
        sa.Column("uuid", sa.Uuid(), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("id", sa.Integer()),
        sa.Column("name", sa.String(), nullable=False, server_default=""),
        sa.Column("currency", sa.String(), nullable=False, server_default="RUB"),
        sa.Column("kind", sa.String(), nullable=False, server_default="monthly"),
        sa.Column("sort_order", sa.Integer(), server_default="0"),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("is_deleted", sa.Boolean(), server_default=sa.text("false")),
        sa.CheckConstraint(
            "kind IN ('monthly', 'project', 'one_time', 'general')",
            name="ck_finance_plans_kind",
        ),
    )
    op.create_index(
        "idx_finance_plans_user_updated",
        "finance_plans",
        ["user_id", "updated_at"],
    )

    op.create_table(
        "finance_items",
        sa.Column("uuid", sa.Uuid(), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("id", sa.Integer()),
        sa.Column("plan_id", sa.Integer()),
        sa.Column("plan_uuid", sa.Uuid()),
        sa.Column("parent_id", sa.Integer()),
        sa.Column("parent_uuid", sa.Uuid()),
        sa.Column("name", sa.String(), nullable=False, server_default=""),
        sa.Column("amount_cents", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("due_day", sa.Integer()),
        sa.Column("due_date", sa.String(length=10)),
        sa.Column("note", sa.Text(), nullable=False, server_default=""),
        sa.Column("sort_order", sa.Integer(), server_default="0"),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("is_deleted", sa.Boolean(), server_default=sa.text("false")),
        sa.CheckConstraint("amount_cents >= 0", name="ck_finance_items_amount_non_negative"),
        sa.CheckConstraint(
            "due_day IS NULL OR (due_day >= 1 AND due_day <= 31)",
            name="ck_finance_items_due_day",
        ),
    )
    op.create_index(
        "idx_finance_items_user_updated",
        "finance_items",
        ["user_id", "updated_at"],
    )
    op.create_index(
        "idx_finance_items_plan",
        "finance_items",
        ["user_id", "plan_uuid", "parent_uuid", "sort_order"],
    )

    op.drop_constraint("ck_share_links_item_type", "share_links", type_="check")
    op.create_check_constraint(
        "ck_share_links_item_type",
        "share_links",
        "item_type IN ('note', 'shortcut', 'finance_plan')",
    )


def downgrade():
    op.drop_constraint("ck_share_links_item_type", "share_links", type_="check")
    op.create_check_constraint(
        "ck_share_links_item_type",
        "share_links",
        "item_type IN ('note', 'shortcut')",
    )

    op.drop_index("idx_finance_items_plan", table_name="finance_items")
    op.drop_index("idx_finance_items_user_updated", table_name="finance_items")
    op.drop_table("finance_items")
    op.drop_index("idx_finance_plans_user_updated", table_name="finance_plans")
    op.drop_table("finance_plans")
