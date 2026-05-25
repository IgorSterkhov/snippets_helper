import argparse
import asyncio

from sqlalchemy import select

from api.database import async_session
from api.models import User


def find_unique_user_by_prefix(users, prefix: str):
    matches = [u for u in users if (u.api_key or "").startswith(prefix)]
    if not matches:
        raise ValueError(f"No users found for api_key prefix {prefix!r}")
    if len(matches) > 1:
        raise ValueError(f"Multiple users found for api_key prefix {prefix!r}")
    return matches[0]


async def make_admin_by_prefix(prefix: str) -> User:
    async with async_session() as db:
        result = await db.execute(select(User).where(User.api_key.like(f"{prefix}%")))
        user = find_unique_user_by_prefix(result.scalars().all(), prefix)
        user.is_admin = True
        await db.commit()
        await db.refresh(user)
        return user


async def _main():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="cmd", required=True)
    make_admin = sub.add_parser("make-admin")
    make_admin.add_argument("--api-key-prefix", required=True)
    args = parser.parse_args()

    if args.cmd == "make-admin":
        user = await make_admin_by_prefix(args.api_key_prefix)
        print(f"user_id={user.id}")
        print(f"name={user.name or ''}")
        print(f"api_key_prefix={user.api_key[:8]}")
        print(f"is_admin={user.is_admin}")


if __name__ == "__main__":
    asyncio.run(_main())
