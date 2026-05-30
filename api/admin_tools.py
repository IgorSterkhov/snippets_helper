import argparse
import asyncio
from datetime import datetime

from sqlalchemy import select

from api.database import async_session
from api.models import TelegramChatBinding, User


def find_unique_user_by_prefix(users, prefix: str):
    matches = [u for u in users if (u.api_key or "").startswith(prefix)]
    if not matches:
        raise ValueError(f"No users found for api_key prefix {prefix!r}")
    if len(matches) > 1:
        raise ValueError(f"Multiple users found for api_key prefix {prefix!r}")
    return matches[0]


def parse_telegram_chat_id(value: str | int) -> int:
    raw = str(value).strip()
    if not raw:
        raise ValueError("telegram chat_id is required")
    try:
        return int(raw, 10)
    except ValueError as exc:
        raise ValueError(f"telegram chat_id must be an integer: {value!r}") from exc


async def make_admin_by_prefix(prefix: str) -> User:
    async with async_session() as db:
        result = await db.execute(select(User).where(User.api_key.like(f"{prefix}%")))
        user = find_unique_user_by_prefix(result.scalars().all(), prefix)
        user.is_admin = True
        await db.commit()
        await db.refresh(user)
        return user


async def bind_telegram_chat_by_prefix(prefix: str, chat_id: str | int):
    parsed_chat_id = parse_telegram_chat_id(chat_id)
    async with async_session() as db:
        result = await db.execute(select(User).where(User.api_key.like(f"{prefix}%")))
        user = find_unique_user_by_prefix(result.scalars().all(), prefix)
        binding = (
            await db.execute(
                select(TelegramChatBinding).where(
                    TelegramChatBinding.user_id == user.id,
                    TelegramChatBinding.chat_id == parsed_chat_id,
                )
            )
        ).scalar_one_or_none()
        now = datetime.utcnow()
        if binding is None:
            binding = TelegramChatBinding(
                chat_id=parsed_chat_id,
                user_id=user.id,
                is_active=True,
                updated_at=now,
            )
            db.add(binding)
        else:
            binding.user_id = user.id
            binding.is_active = True
            binding.updated_at = now
        await db.commit()
        await db.refresh(binding)
        return user, binding


async def _main():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="cmd", required=True)
    make_admin = sub.add_parser("make-admin")
    make_admin.add_argument("--api-key-prefix", required=True)
    bind_telegram = sub.add_parser("bind-telegram-chat")
    bind_telegram.add_argument("--api-key-prefix", required=True)
    bind_telegram.add_argument("--chat-id", required=True)
    args = parser.parse_args()

    if args.cmd == "make-admin":
        user = await make_admin_by_prefix(args.api_key_prefix)
        print(f"user_id={user.id}")
        print(f"name={user.name or ''}")
        print(f"api_key_prefix={user.api_key[:8]}")
        print(f"is_admin={user.is_admin}")
    elif args.cmd == "bind-telegram-chat":
        user, binding = await bind_telegram_chat_by_prefix(args.api_key_prefix, args.chat_id)
        print(f"user_id={user.id}")
        print(f"name={user.name or ''}")
        print(f"api_key_prefix={user.api_key[:8]}")
        print(f"chat_id={binding.chat_id}")
        print(f"is_active={binding.is_active}")


if __name__ == "__main__":
    asyncio.run(_main())
