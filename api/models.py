import uuid as uuid_mod
from datetime import datetime
from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    Uuid,
    text,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid_mod.UUID] = mapped_column(Uuid, primary_key=True, default=uuid_mod.uuid4)
    api_key: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    name: Mapped[str | None] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    is_admin: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        server_default=text("false"),
    )
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime)
    media_quota_bytes: Mapped[int] = mapped_column(
        BigInteger,
        nullable=False,
        default=1073741824,
        server_default="1073741824",
    )
    media_max_upload_bytes: Mapped[int] = mapped_column(
        BigInteger,
        nullable=False,
        default=20971520,
        server_default="20971520",
    )
    deepseek_api_key: Mapped[str | None] = mapped_column(Text)
    deepseek_updated_at: Mapped[datetime | None] = mapped_column(DateTime)
    telegram_bot_token: Mapped[str | None] = mapped_column(Text)
    telegram_bot_updated_at: Mapped[datetime | None] = mapped_column(DateTime)
    ai_custom_instructions: Mapped[str | None] = mapped_column(Text)
    ai_custom_instructions_updated_at: Mapped[datetime | None] = mapped_column(DateTime)
    telegraph_access_token: Mapped[str | None] = mapped_column(Text)
    telegraph_short_name: Mapped[str | None] = mapped_column(String(32))
    telegraph_author_name: Mapped[str | None] = mapped_column(String(128))
    telegraph_author_url: Mapped[str | None] = mapped_column(String(512))
    telegraph_updated_at: Mapped[datetime | None] = mapped_column(DateTime)


class Shortcut(Base):
    __tablename__ = "shortcuts"

    uuid: Mapped[uuid_mod.UUID] = mapped_column(Uuid, primary_key=True, default=uuid_mod.uuid4)
    user_id: Mapped[uuid_mod.UUID] = mapped_column(Uuid, ForeignKey("users.id"), nullable=False)
    id: Mapped[int | None] = mapped_column(Integer)
    name: Mapped[str] = mapped_column(String, nullable=False)
    value: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    links: Mapped[str | None] = mapped_column(Text, default="[]")
    obsidian_note: Mapped[str | None] = mapped_column(Text, default="")
    is_pinned: Mapped[int] = mapped_column(Integer, default=0)
    pinned_sort_order: Mapped[int] = mapped_column(Integer, default=0)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False)

    __table_args__ = (Index("idx_shortcuts_user_updated", "user_id", "updated_at"),)


class SqlTableAnalyzerTemplate(Base):
    __tablename__ = "sql_table_analyzer_templates"

    uuid: Mapped[uuid_mod.UUID] = mapped_column(Uuid, primary_key=True, default=uuid_mod.uuid4)
    user_id: Mapped[uuid_mod.UUID] = mapped_column(Uuid, ForeignKey("users.id"), nullable=False)
    id: Mapped[int | None] = mapped_column(Integer)
    template_text: Mapped[str] = mapped_column(Text, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False)

    __table_args__ = (Index("idx_sql_tpl_user_updated", "user_id", "updated_at"),)


class SqlMacrosingTemplate(Base):
    __tablename__ = "sql_macrosing_templates"

    uuid: Mapped[uuid_mod.UUID] = mapped_column(Uuid, primary_key=True, default=uuid_mod.uuid4)
    user_id: Mapped[uuid_mod.UUID] = mapped_column(Uuid, ForeignKey("users.id"), nullable=False)
    id: Mapped[int | None] = mapped_column(Integer)
    template_name: Mapped[str] = mapped_column(String, nullable=False)
    template_text: Mapped[str] = mapped_column(Text, nullable=False)
    placeholders_config: Mapped[str] = mapped_column(Text, nullable=False)
    combination_mode: Mapped[str] = mapped_column(String, nullable=False, default="cartesian")
    separator: Mapped[str] = mapped_column(String, nullable=False, default=";\n")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False)

    __table_args__ = (Index("idx_macro_tpl_user_updated", "user_id", "updated_at"),)


class NoteFolder(Base):
    __tablename__ = "note_folders"

    uuid: Mapped[uuid_mod.UUID] = mapped_column(Uuid, primary_key=True, default=uuid_mod.uuid4)
    user_id: Mapped[uuid_mod.UUID] = mapped_column(Uuid, ForeignKey("users.id"), nullable=False)
    id: Mapped[int | None] = mapped_column(Integer)
    name: Mapped[str] = mapped_column(String, nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    parent_id: Mapped[int | None] = mapped_column(Integer, default=None)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False)

    __table_args__ = (Index("idx_note_folders_user_updated", "user_id", "updated_at"),)


class Note(Base):
    __tablename__ = "notes"

    uuid: Mapped[uuid_mod.UUID] = mapped_column(Uuid, primary_key=True, default=uuid_mod.uuid4)
    user_id: Mapped[uuid_mod.UUID] = mapped_column(Uuid, ForeignKey("users.id"), nullable=False)
    id: Mapped[int | None] = mapped_column(Integer)
    folder_id: Mapped[int | None] = mapped_column(Integer)
    folder_uuid: Mapped[uuid_mod.UUID | None] = mapped_column(Uuid)
    title: Mapped[str] = mapped_column(String, nullable=False)
    content: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime | None] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)
    is_pinned: Mapped[int] = mapped_column(Integer, default=0)
    pinned_sort_order: Mapped[int] = mapped_column(Integer, default=0)
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False)

    __table_args__ = (Index("idx_notes_user_updated", "user_id", "updated_at"),)


class ObfuscationMapping(Base):
    __tablename__ = "obfuscation_mappings"

    uuid: Mapped[uuid_mod.UUID] = mapped_column(Uuid, primary_key=True, default=uuid_mod.uuid4)
    user_id: Mapped[uuid_mod.UUID] = mapped_column(Uuid, ForeignKey("users.id"), nullable=False)
    id: Mapped[int | None] = mapped_column(Integer)
    session_name: Mapped[str] = mapped_column(String, nullable=False)
    entity_type: Mapped[str] = mapped_column(String, nullable=False)
    original_value: Mapped[str] = mapped_column(String, nullable=False)
    obfuscated_value: Mapped[str] = mapped_column(String, nullable=False)
    created_at: Mapped[datetime | None] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False)

    __table_args__ = (Index("idx_obfuscation_user_updated", "user_id", "updated_at"),)


class SnippetTag(Base):
    __tablename__ = "snippet_tags"

    uuid: Mapped[uuid_mod.UUID] = mapped_column(Uuid, primary_key=True, default=uuid_mod.uuid4)
    user_id: Mapped[uuid_mod.UUID] = mapped_column(Uuid, ForeignKey("users.id"), nullable=False)
    id: Mapped[int | None] = mapped_column(Integer)
    name: Mapped[str] = mapped_column(String, nullable=False)
    patterns: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    color: Mapped[str] = mapped_column(String, nullable=False, default="#388bfd")
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False)

    __table_args__ = (Index("idx_snippet_tags_user_updated", "user_id", "updated_at"),)


class TaskCategory(Base):
    __tablename__ = "task_categories"

    uuid: Mapped[uuid_mod.UUID] = mapped_column(Uuid, primary_key=True, default=uuid_mod.uuid4)
    user_id: Mapped[uuid_mod.UUID] = mapped_column(Uuid, ForeignKey("users.id"), nullable=False)
    id: Mapped[int | None] = mapped_column(Integer)
    name: Mapped[str] = mapped_column(String, nullable=False)
    color: Mapped[str] = mapped_column(String, nullable=False, default="#8b949e")
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime | None] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False)

    __table_args__ = (Index("idx_task_categories_user_updated", "user_id", "updated_at"),)


class TaskStatus(Base):
    __tablename__ = "task_statuses"

    uuid: Mapped[uuid_mod.UUID] = mapped_column(Uuid, primary_key=True, default=uuid_mod.uuid4)
    user_id: Mapped[uuid_mod.UUID] = mapped_column(Uuid, ForeignKey("users.id"), nullable=False)
    id: Mapped[int | None] = mapped_column(Integer)
    name: Mapped[str] = mapped_column(String, nullable=False)
    color: Mapped[str] = mapped_column(String, nullable=False, default="#8b949e")
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime | None] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False)

    __table_args__ = (Index("idx_task_statuses_user_updated", "user_id", "updated_at"),)


class Task(Base):
    __tablename__ = "tasks"

    uuid: Mapped[uuid_mod.UUID] = mapped_column(Uuid, primary_key=True, default=uuid_mod.uuid4)
    user_id: Mapped[uuid_mod.UUID] = mapped_column(Uuid, ForeignKey("users.id"), nullable=False)
    id: Mapped[int | None] = mapped_column(Integer)
    title: Mapped[str] = mapped_column(String, nullable=False)
    category_id: Mapped[int | None] = mapped_column(Integer)
    category_uuid: Mapped[uuid_mod.UUID | None] = mapped_column(Uuid)
    status_id: Mapped[int | None] = mapped_column(Integer)
    status_uuid: Mapped[uuid_mod.UUID | None] = mapped_column(Uuid)
    is_pinned: Mapped[int] = mapped_column(Integer, default=0)
    bg_color: Mapped[str | None] = mapped_column(String)
    tracker_url: Mapped[str | None] = mapped_column(Text)
    notes_md: Mapped[str] = mapped_column(Text, default="")
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime | None] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False)

    __table_args__ = (Index("idx_tasks_user_updated", "user_id", "updated_at"),)


class TaskCheckbox(Base):
    __tablename__ = "task_checkboxes"

    uuid: Mapped[uuid_mod.UUID] = mapped_column(Uuid, primary_key=True, default=uuid_mod.uuid4)
    user_id: Mapped[uuid_mod.UUID] = mapped_column(Uuid, ForeignKey("users.id"), nullable=False)
    id: Mapped[int | None] = mapped_column(Integer)
    task_id: Mapped[int | None] = mapped_column(Integer)
    task_uuid: Mapped[uuid_mod.UUID | None] = mapped_column(Uuid)
    parent_id: Mapped[int | None] = mapped_column(Integer)
    parent_uuid: Mapped[uuid_mod.UUID | None] = mapped_column(Uuid)
    text: Mapped[str] = mapped_column(Text, nullable=False, default="")
    is_checked: Mapped[int] = mapped_column(Integer, default=0)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime | None] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False)

    __table_args__ = (Index("idx_task_checkboxes_user_updated", "user_id", "updated_at"),)


class TaskLink(Base):
    __tablename__ = "task_links"

    uuid: Mapped[uuid_mod.UUID] = mapped_column(Uuid, primary_key=True, default=uuid_mod.uuid4)
    user_id: Mapped[uuid_mod.UUID] = mapped_column(Uuid, ForeignKey("users.id"), nullable=False)
    id: Mapped[int | None] = mapped_column(Integer)
    task_id: Mapped[int | None] = mapped_column(Integer)
    task_uuid: Mapped[uuid_mod.UUID | None] = mapped_column(Uuid)
    url: Mapped[str] = mapped_column(Text, nullable=False, default="")
    label: Mapped[str | None] = mapped_column(Text)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime | None] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False)

    __table_args__ = (Index("idx_task_links_user_updated", "user_id", "updated_at"),)


class FinancePlan(Base):
    __tablename__ = "finance_plans"

    uuid: Mapped[uuid_mod.UUID] = mapped_column(Uuid, primary_key=True, default=uuid_mod.uuid4)
    user_id: Mapped[uuid_mod.UUID] = mapped_column(Uuid, ForeignKey("users.id"), nullable=False)
    id: Mapped[int | None] = mapped_column(Integer)
    name: Mapped[str] = mapped_column(String, nullable=False, default="")
    currency: Mapped[str] = mapped_column(String, nullable=False, default="RUB")
    kind: Mapped[str] = mapped_column(String, nullable=False, default="monthly")
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime | None] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False)

    __table_args__ = (
        CheckConstraint(
            "kind IN ('monthly', 'project', 'one_time', 'general')",
            name="ck_finance_plans_kind",
        ),
        Index("idx_finance_plans_user_updated", "user_id", "updated_at"),
    )


class FinanceItem(Base):
    __tablename__ = "finance_items"

    uuid: Mapped[uuid_mod.UUID] = mapped_column(Uuid, primary_key=True, default=uuid_mod.uuid4)
    user_id: Mapped[uuid_mod.UUID] = mapped_column(Uuid, ForeignKey("users.id"), nullable=False)
    id: Mapped[int | None] = mapped_column(Integer)
    plan_id: Mapped[int | None] = mapped_column(Integer)
    plan_uuid: Mapped[uuid_mod.UUID | None] = mapped_column(Uuid)
    parent_id: Mapped[int | None] = mapped_column(Integer)
    parent_uuid: Mapped[uuid_mod.UUID | None] = mapped_column(Uuid)
    name: Mapped[str] = mapped_column(String, nullable=False, default="")
    amount_cents: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    due_day: Mapped[int | None] = mapped_column(Integer)
    due_date: Mapped[str | None] = mapped_column(String(10))
    note: Mapped[str] = mapped_column(Text, nullable=False, default="")
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime | None] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False)

    __table_args__ = (
        CheckConstraint("amount_cents >= 0", name="ck_finance_items_amount_non_negative"),
        CheckConstraint(
            "due_day IS NULL OR (due_day >= 1 AND due_day <= 31)",
            name="ck_finance_items_due_day",
        ),
        Index("idx_finance_items_user_updated", "user_id", "updated_at"),
        Index("idx_finance_items_plan", "user_id", "plan_uuid", "parent_uuid", "sort_order"),
    )


class ShareLink(Base):
    __tablename__ = "share_links"

    token: Mapped[str] = mapped_column(String(96), primary_key=True)
    user_id: Mapped[uuid_mod.UUID] = mapped_column(Uuid, ForeignKey("users.id"), nullable=False)
    item_type: Mapped[str] = mapped_column(String(20), nullable=False)
    item_uuid: Mapped[uuid_mod.UUID] = mapped_column(Uuid, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime)

    __table_args__ = (
        CheckConstraint(
            "item_type IN ('note', 'shortcut', 'finance_plan')",
            name="ck_share_links_item_type",
        ),
        Index("idx_share_links_token", "token"),
        Index("idx_share_links_owner_item", "user_id", "item_type", "item_uuid"),
        Index(
            "uq_share_links_active_owner_item",
            "user_id",
            "item_type",
            "item_uuid",
            unique=True,
            postgresql_where=text("is_active = true"),
        ),
    )


class TelegraphPage(Base):
    __tablename__ = "telegraph_pages"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    user_id: Mapped[uuid_mod.UUID] = mapped_column(Uuid, ForeignKey("users.id"), nullable=False)
    item_type: Mapped[str] = mapped_column(String(20), nullable=False)
    item_uuid: Mapped[uuid_mod.UUID] = mapped_column(Uuid, nullable=False)
    path: Mapped[str] = mapped_column(String(255), nullable=False)
    url: Mapped[str] = mapped_column(Text, nullable=False)
    title: Mapped[str] = mapped_column(String(256), nullable=False)
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    views: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)
    published_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)

    __table_args__ = (
        CheckConstraint("item_type IN ('note', 'shortcut')", name="ck_telegraph_pages_item_type"),
        Index("idx_telegraph_pages_owner_item", "user_id", "item_type", "item_uuid"),
        Index("idx_telegraph_pages_user_updated", "user_id", "updated_at"),
        UniqueConstraint("user_id", "item_type", "item_uuid", name="uq_telegraph_pages_owner_item"),
    )


class MediaAsset(Base):
    __tablename__ = "media_assets"

    uuid: Mapped[uuid_mod.UUID] = mapped_column(Uuid, primary_key=True, default=uuid_mod.uuid4)
    user_id: Mapped[uuid_mod.UUID] = mapped_column(Uuid, ForeignKey("users.id"), nullable=False)
    original_file_name: Mapped[str] = mapped_column(Text, nullable=False)
    selected_variant: Mapped[str] = mapped_column(String, nullable=False, default="balanced")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)
    is_deleted: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    __table_args__ = (Index("idx_media_assets_user_created", "user_id", "created_at"),)


class MediaAssetVariant(Base):
    __tablename__ = "media_asset_variants"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    asset_uuid: Mapped[uuid_mod.UUID] = mapped_column(
        Uuid,
        ForeignKey("media_assets.uuid"),
        nullable=False,
    )
    variant: Mapped[str] = mapped_column(String, nullable=False)
    public_token: Mapped[str] = mapped_column(String(96), unique=True, nullable=False)
    storage_path: Mapped[str] = mapped_column(Text, nullable=False)
    mime_type: Mapped[str] = mapped_column(String, nullable=False)
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    width: Mapped[int] = mapped_column(Integer, nullable=False)
    height: Mapped[int] = mapped_column(Integer, nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)

    __table_args__ = (
        Index("idx_media_asset_variants_public_token", "public_token", unique=True),
        Index("uq_media_asset_variants_asset_variant", "asset_uuid", "variant", unique=True),
    )


class TelegramChatBinding(Base):
    __tablename__ = "telegram_chat_bindings"

    chat_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    user_id: Mapped[uuid_mod.UUID] = mapped_column(Uuid, ForeignKey("users.id"), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)
    is_active: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=True,
        server_default=text("true"),
    )

    __table_args__ = (
        Index("idx_telegram_chat_bindings_user", "user_id"),
        Index("idx_telegram_chat_bindings_active", "is_active"),
    )


class TelegramProcessedMessage(Base):
    __tablename__ = "telegram_processed_messages"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    user_id: Mapped[uuid_mod.UUID | None] = mapped_column(Uuid, ForeignKey("users.id"))
    chat_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    message_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    update_id: Mapped[int | None] = mapped_column(BigInteger)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("user_id", "chat_id", "message_id", name="uq_telegram_processed_user_chat_message"),
        Index("idx_telegram_processed_update", "update_id"),
        Index("idx_telegram_processed_user_update", "user_id", "update_id"),
    )


# Map table names to ORM models (used by sync routes)
TABLE_MODELS = {
    "shortcuts": Shortcut,
    "sql_table_analyzer_templates": SqlTableAnalyzerTemplate,
    "sql_macrosing_templates": SqlMacrosingTemplate,
    "note_folders": NoteFolder,
    "notes": Note,
    "obfuscation_mappings": ObfuscationMapping,
    "snippet_tags": SnippetTag,
    "task_categories": TaskCategory,
    "task_statuses": TaskStatus,
    "tasks": Task,
    "task_checkboxes": TaskCheckbox,
    "task_links": TaskLink,
    "finance_plans": FinancePlan,
    "finance_items": FinanceItem,
}
