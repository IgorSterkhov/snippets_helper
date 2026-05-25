"""add media assets

Revision ID: 010
Revises: 009
Create Date: 2026-05-25
"""

from alembic import op
import sqlalchemy as sa


revision = "010"
down_revision = "009"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "media_assets",
        sa.Column("uuid", sa.Uuid(), primary_key=True),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("original_file_name", sa.Text(), nullable=False),
        sa.Column("selected_variant", sa.String(), nullable=False, server_default="balanced"),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.create_index("idx_media_assets_user_created", "media_assets", ["user_id", "created_at"])
    op.create_table(
        "media_asset_variants",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("asset_uuid", sa.Uuid(), sa.ForeignKey("media_assets.uuid"), nullable=False),
        sa.Column("variant", sa.String(), nullable=False),
        sa.Column("public_token", sa.String(length=96), nullable=False),
        sa.Column("storage_path", sa.Text(), nullable=False),
        sa.Column("mime_type", sa.String(), nullable=False),
        sa.Column("size_bytes", sa.BigInteger(), nullable=False),
        sa.Column("width", sa.Integer(), nullable=False),
        sa.Column("height", sa.Integer(), nullable=False),
        sa.Column("sha256", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )
    op.create_index(
        "idx_media_asset_variants_public_token",
        "media_asset_variants",
        ["public_token"],
        unique=True,
    )
    op.create_index(
        "uq_media_asset_variants_asset_variant",
        "media_asset_variants",
        ["asset_uuid", "variant"],
        unique=True,
    )


def downgrade():
    op.drop_index("uq_media_asset_variants_asset_variant", table_name="media_asset_variants")
    op.drop_index("idx_media_asset_variants_public_token", table_name="media_asset_variants")
    op.drop_table("media_asset_variants")
    op.drop_index("idx_media_assets_user_created", table_name="media_assets")
    op.drop_table("media_assets")
