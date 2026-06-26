"""add finance facts

Revision ID: 018
Revises: 017
Create Date: 2026-06-26
"""

from alembic import op
import sqlalchemy as sa


revision = "018"
down_revision = "017"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "finance_import_batches",
        sa.Column("uuid", sa.Uuid(), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("id", sa.Integer()),
        sa.Column("source", sa.String(), nullable=False, server_default="tbank_csv"),
        sa.Column("file_name", sa.Text(), nullable=False, server_default=""),
        sa.Column("total_rows", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("imported_rows", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("duplicate_rows", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("error_rows", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("date_from", sa.String(length=10)),
        sa.Column("date_to", sa.String(length=10)),
        sa.Column("expense_total_cents", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("income_total_cents", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("currency", sa.String(), nullable=False, server_default="RUB"),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("is_deleted", sa.Boolean(), server_default=sa.text("false")),
    )
    op.create_index("idx_finance_import_batches_user_updated", "finance_import_batches", ["user_id", "updated_at"])
    op.create_index("idx_finance_import_batches_imported", "finance_import_batches", ["user_id", "created_at"])

    op.create_table(
        "finance_transactions",
        sa.Column("uuid", sa.Uuid(), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("id", sa.Integer()),
        sa.Column("source", sa.String(), nullable=False, server_default="tbank_csv"),
        sa.Column("source_fingerprint", sa.String(length=128), nullable=False),
        sa.Column("import_batch_id", sa.Integer()),
        sa.Column("import_batch_uuid", sa.Uuid()),
        sa.Column("operation_at", sa.String(length=19), nullable=False, server_default=""),
        sa.Column("payment_date", sa.String(length=10), nullable=False, server_default=""),
        sa.Column("card_mask", sa.String(), nullable=False, server_default=""),
        sa.Column("status", sa.String(), nullable=False, server_default=""),
        sa.Column("amount_cents", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("currency", sa.String(), nullable=False, server_default="RUB"),
        sa.Column("operation_amount_cents", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("operation_currency", sa.String(), nullable=False, server_default="RUB"),
        sa.Column("payment_amount_cents", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("payment_currency", sa.String(), nullable=False, server_default="RUB"),
        sa.Column("cashback_cents", sa.BigInteger()),
        sa.Column("bank_category", sa.String(), nullable=False, server_default=""),
        sa.Column("mcc", sa.String(), nullable=False, server_default=""),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("bonuses_cents", sa.BigInteger()),
        sa.Column("invest_rounding_cents", sa.BigInteger()),
        sa.Column("rounded_amount_cents", sa.BigInteger()),
        sa.Column("raw_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("rules_locked", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("is_deleted", sa.Boolean(), server_default=sa.text("false")),
        sa.UniqueConstraint("user_id", "source", "source_fingerprint", name="uq_finance_transactions_user_source_fingerprint"),
    )
    op.create_index("idx_finance_transactions_user_updated", "finance_transactions", ["user_id", "updated_at"])
    op.create_index("idx_finance_transactions_payment_date", "finance_transactions", ["user_id", "payment_date"])

    op.create_table(
        "finance_mapping_rules",
        sa.Column("uuid", sa.Uuid(), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("id", sa.Integer()),
        sa.Column("name", sa.String(), nullable=False, server_default=""),
        sa.Column("is_enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("priority", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("match_mode", sa.String(), nullable=False, server_default="all"),
        sa.Column("conditions_json", sa.Text(), nullable=False, server_default="[]"),
        sa.Column("target_plan_id", sa.Integer()),
        sa.Column("target_plan_uuid", sa.Uuid()),
        sa.Column("target_item_id", sa.Integer()),
        sa.Column("target_item_uuid", sa.Uuid()),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("is_deleted", sa.Boolean(), server_default=sa.text("false")),
        sa.CheckConstraint("match_mode IN ('all', 'any')", name="ck_finance_mapping_rules_match_mode"),
    )
    op.create_index("idx_finance_mapping_rules_user_updated", "finance_mapping_rules", ["user_id", "updated_at"])
    op.create_index("idx_finance_mapping_rules_sort", "finance_mapping_rules", ["user_id", "is_enabled", "priority"])

    op.create_table(
        "finance_transaction_allocations",
        sa.Column("uuid", sa.Uuid(), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("id", sa.Integer()),
        sa.Column("transaction_id", sa.Integer()),
        sa.Column("transaction_uuid", sa.Uuid()),
        sa.Column("plan_id", sa.Integer()),
        sa.Column("plan_uuid", sa.Uuid()),
        sa.Column("item_id", sa.Integer()),
        sa.Column("item_uuid", sa.Uuid()),
        sa.Column("assigned_by", sa.String(), nullable=False, server_default="manual"),
        sa.Column("rule_id", sa.Integer()),
        sa.Column("rule_uuid", sa.Uuid()),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("is_deleted", sa.Boolean(), server_default=sa.text("false")),
        sa.CheckConstraint("assigned_by IN ('manual', 'rule')", name="ck_finance_allocations_assigned_by"),
    )
    op.create_index("idx_finance_allocations_user_updated", "finance_transaction_allocations", ["user_id", "updated_at"])
    op.create_index(
        "idx_finance_allocations_plan_item",
        "finance_transaction_allocations",
        ["user_id", "plan_uuid", "item_uuid", "transaction_uuid"],
    )
    op.create_index(
        "idx_finance_allocations_one_active",
        "finance_transaction_allocations",
        ["user_id", "transaction_uuid"],
        unique=True,
        postgresql_where=sa.text("is_active = true AND is_deleted = false"),
    )


def downgrade():
    op.drop_index("idx_finance_allocations_one_active", table_name="finance_transaction_allocations")
    op.drop_index("idx_finance_allocations_plan_item", table_name="finance_transaction_allocations")
    op.drop_index("idx_finance_allocations_user_updated", table_name="finance_transaction_allocations")
    op.drop_table("finance_transaction_allocations")
    op.drop_index("idx_finance_mapping_rules_sort", table_name="finance_mapping_rules")
    op.drop_index("idx_finance_mapping_rules_user_updated", table_name="finance_mapping_rules")
    op.drop_table("finance_mapping_rules")
    op.drop_index("idx_finance_transactions_payment_date", table_name="finance_transactions")
    op.drop_index("idx_finance_transactions_user_updated", table_name="finance_transactions")
    op.drop_table("finance_transactions")
    op.drop_index("idx_finance_import_batches_imported", table_name="finance_import_batches")
    op.drop_index("idx_finance_import_batches_user_updated", table_name="finance_import_batches")
    op.drop_table("finance_import_batches")
