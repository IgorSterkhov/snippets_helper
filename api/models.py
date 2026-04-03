import uuid as uuid_mod
from datetime import datetime
from sqlalchemy import String, Text, Integer, Boolean, DateTime, ForeignKey, Index, Uuid
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid_mod.UUID] = mapped_column(Uuid, primary_key=True, default=uuid_mod.uuid4)
    api_key: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    name: Mapped[str | None] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class Shortcut(Base):
    __tablename__ = "shortcuts"

    uuid: Mapped[uuid_mod.UUID] = mapped_column(Uuid, primary_key=True, default=uuid_mod.uuid4)
    user_id: Mapped[uuid_mod.UUID] = mapped_column(Uuid, ForeignKey("users.id"), nullable=False)
    id: Mapped[int | None] = mapped_column(Integer)
    name: Mapped[str] = mapped_column(String, nullable=False)
    value: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    links: Mapped[str | None] = mapped_column(Text, default="[]")
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


# Map table names to ORM models (used by sync routes)
TABLE_MODELS = {
    "shortcuts": Shortcut,
    "sql_table_analyzer_templates": SqlTableAnalyzerTemplate,
    "sql_macrosing_templates": SqlMacrosingTemplate,
    "note_folders": NoteFolder,
    "notes": Note,
    "obfuscation_mappings": ObfuscationMapping,
}
