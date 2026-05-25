# Admin Limits And Image Attachments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add admin-managed storage limits first, then image uploads/rendering for Notes and Snippets with server-side optimization and Figure Card presentation.

**Architecture:** Admin and media are dedicated API surfaces, not part of generic sync. Public media binaries are stored as files under `/opt/isterapp/uploads/snippets-media/<variant_public_token>.webp`, while note/snippet text stores portable Markdown image references to selected variant tokens such as `https://ister-app.ru/snippets-media/<variant_public_token>.webp`. Desktop Settings manages user storage limits only for server-appointed admins; admin assignment is command-only on the server. Upload optimization is canonical on the server.

**Tech Stack:** FastAPI, SQLAlchemy/Alembic, Postgres, Tauri/Rust commands, vanilla desktop JS, React Native, pytest/Jest/CDP smoke tests, Pillow for image processing.

---

## Scope And Execution Order

Implement in two independently shippable phases:

1. **Phase 1: Admin Users & Storage Limits**
   - Adds admin state and user limits.
   - Adds admin API and desktop Settings UI.
   - Adds server-side `make-admin` command.
   - Deploys and assigns production admin by prefix `f33d8ddd`.

2. **Phase 2: Images In Notes/Snippets**
   - Adds media storage, upload, optimization, progress polling, and Figure Card rendering.
   - Uses Phase 1 limits for enforcement.

Do not start Phase 2 until Phase 1 tests pass and production admin assignment is verified.

## File Map

### API/Admin

- Modify `api/models.py`: add user fields and media models.
- Modify `api/schemas.py`: admin and media request/response schemas.
- Modify `api/auth.py`: last-seen throttle and admin dependency.
- Create `api/routes/admin.py`: admin API.
- Create `api/admin_tools.py`: server-side admin assignment command.
- Modify `api/main.py`: include admin/media routers.
- Modify `docker-compose.yml`: persistently mount media storage into the API container.
- Create `api/alembic/versions/009_add_admin_user_limits.py`.
- Create `api/alembic/versions/010_add_media_assets.py`.
- Create `tests/api/run.sh`: API unit test venv runner with API dependencies.
- Create `tests/api/requirements.txt`.
- Create `tests/api/test_admin_tools.py`.
- Create `tests/post_release/test_admin_contract.py`.

### API/Media

- Create `api/media_utils.py`: validation, token generation, safe paths, quota helpers.
- Create `api/image_processing.py`: Pillow-based variant generation.
- Create `api/routes/media.py`: upload/job/select/delete endpoints.
- Modify `api/share_utils.py`: render Markdown images as Figure Cards in public pages.
- Modify `api/routes/share_links.py`: include media-aware rendering.
- Modify `api/requirements.txt`: add `Pillow` and `python-multipart`.
- Create `tests/api/test_media_utils.py`.
- Create `tests/api/test_image_processing.py`.
- Create `tests/post_release/test_media_contract.py`.

### Desktop

- Modify `desktop-rust/src-tauri/src/commands/sync_cmd.rs` or add `desktop-rust/src-tauri/src/commands/admin.rs`: admin HTTP bridge.
- Create `desktop-rust/src-tauri/src/commands/media.rs`: native file picker/upload bridge with progress events.
- Modify `desktop-rust/src-tauri/src/commands/mod.rs` and `desktop-rust/src-tauri/src/lib.rs`: register admin/media commands if native bridge is added.
- Modify `desktop-rust/src-tauri/src/commands/share_links.rs` patterns only if shared API URL helpers are extracted.
- Modify `desktop-rust/src/tabs/settings.js`: admin Users/Limits section.
- Modify `desktop-rust/src/dev-mock.js`: admin/media mocks.
- Modify `desktop-rust/src/dev-test.py`: admin Settings and media modal smoke.
- Modify `desktop-rust/src/components/md-toolbar.js`: image button opens upload modal.
- Create `desktop-rust/src/components/image-upload-modal.js`.
- Modify `desktop-rust/src/tabs/notes.js` and `desktop-rust/src/tabs/shortcuts.js`: Figure Card rendering hooks.
- Modify `desktop-rust/src/styles.css`: Figure Card and modal CSS.
- Update `desktop-rust/src/tabs/help.js`, `desktop-rust/src/release-history.md`, and `desktop-rust/CHANGELOG.md` before release.

### Mobile

- Modify `mobile/src/screens/Notes/NoteEditorScreen.js`: safe Figure Card rendering in Markdown preview.
- Modify `mobile/src/screens/Snippets/SnippetDetailScreen.js`: render snippet value/description image Markdown safely.
- Modify `mobile/src/api/endpoints.js`: media endpoints if mobile upload is included.
- Create or modify mobile tests under `mobile/__tests__/`.
- Update `mobile/RELEASES.md` only if the release procedure changes.

---

## Task 0: API Unit Test Runner

**Files:**
- Create: `tests/api/requirements.txt`
- Create: `tests/api/run.sh`

- [ ] **Step 1: Add API test requirements**

Create `tests/api/requirements.txt`:

```text
-r ../../api/requirements.txt
pytest>=8.0.0
```

- [ ] **Step 2: Add runner**

Create `tests/api/run.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
VENV="$ROOT/tests/api/.venv"

if [ ! -x "$VENV/bin/python" ]; then
  python3 -m venv "$VENV"
fi

if [ "$#" -eq 0 ]; then
  set -- tests/api
fi

"$VENV/bin/python" -m pip install -q -r "$ROOT/tests/api/requirements.txt"
cd "$ROOT"
"$VENV/bin/python" -m pytest "$@"
```

Make it executable.

- [ ] **Step 3: Verify runner can collect tests**

```bash
bash tests/api/run.sh tests/api -q
```

Existing API tests should pass or fail only for known existing issues, not for
missing FastAPI/SQLAlchemy imports.

- [ ] **Step 4: Commit**

```bash
git add tests/api/requirements.txt tests/api/run.sh
git commit -m "add api test runner"
```

## Phase 1: Admin Users & Storage Limits

### Task 1: API Migration And User Model

**Files:**
- Modify: `api/models.py`
- Create: `api/alembic/versions/009_add_admin_user_limits.py`
- Modify: `api/schemas.py`

- [ ] **Step 1: Add failing schema/model assertions**

Create `tests/api/test_admin_user_model.py`:

```python
from api.models import User


def test_user_model_has_admin_and_limit_columns():
    columns = User.__table__.columns
    assert "is_admin" in columns
    assert "last_seen_at" in columns
    assert "media_quota_bytes" in columns
    assert "media_max_upload_bytes" in columns
```

- [ ] **Step 2: Run model test and verify RED**

Run:

```bash
bash tests/api/run.sh tests/api/test_admin_user_model.py -q
```

Expected: fail because the columns do not exist.

- [ ] **Step 3: Implement model fields**

In `api/models.py`, extend `User`:

```python
    is_admin: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default=text("false"))
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime)
    media_quota_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False, default=1073741824, server_default="1073741824")
    media_max_upload_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False, default=20971520, server_default="20971520")
```

Import `BigInteger` from SQLAlchemy in `api/models.py`.

- [ ] **Step 4: Add Alembic migration**

Create `api/alembic/versions/009_add_admin_user_limits.py`:

```python
"""add admin user limits

Revision ID: 009
Revises: 008
Create Date: 2026-05-25
"""

from alembic import op
import sqlalchemy as sa


revision = "009"
down_revision = "008"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("users", sa.Column("is_admin", sa.Boolean(), nullable=False, server_default=sa.text("false")))
    op.add_column("users", sa.Column("last_seen_at", sa.DateTime(), nullable=True))
    op.add_column("users", sa.Column("media_quota_bytes", sa.BigInteger(), nullable=False, server_default="1073741824"))
    op.add_column("users", sa.Column("media_max_upload_bytes", sa.BigInteger(), nullable=False, server_default="20971520"))


def downgrade():
    op.drop_column("users", "media_max_upload_bytes")
    op.drop_column("users", "media_quota_bytes")
    op.drop_column("users", "last_seen_at")
    op.drop_column("users", "is_admin")
```

- [ ] **Step 5: Add schemas**

Add to `api/schemas.py`:

```python
class AdminMeResponse(BaseModel):
    user_id: str
    name: Optional[str]
    is_admin: bool
    media_quota_bytes: int
    media_max_upload_bytes: int
    media_used_bytes: int = 0


class AdminUserSummary(BaseModel):
    user_id: str
    name: Optional[str]
    created_at: datetime
    last_seen_at: Optional[datetime] = None
    is_admin: bool
    media_quota_bytes: int
    media_max_upload_bytes: int
    media_used_bytes: int = 0


class AdminUserLimitsRequest(BaseModel):
    media_quota_bytes: int
    media_max_upload_bytes: int
```

- [ ] **Step 6: Run unit checks**

Run:

```bash
bash tests/api/run.sh tests/api/test_admin_user_model.py -q
python3 -m py_compile api/models.py api/schemas.py api/alembic/versions/009_add_admin_user_limits.py
```

Expected: tests pass and py_compile exits 0.

- [ ] **Step 7: Commit**

```bash
git add api/models.py api/schemas.py api/alembic/versions/009_add_admin_user_limits.py tests/api/test_admin_user_model.py
git commit -m "add admin user limits model"
```

### Task 2: Auth Last-Seen And Admin Dependencies

**Files:**
- Modify: `api/auth.py`
- Test: `tests/api/test_auth_admin.py`

- [ ] **Step 1: Write failing tests for dependency helpers**

Create `tests/api/test_auth_admin.py`:

```python
from datetime import datetime, timedelta

from api.auth import should_touch_last_seen


def test_should_touch_last_seen_when_missing():
    assert should_touch_last_seen(None, now=datetime(2026, 5, 25, 12, 0, 0))


def test_should_not_touch_last_seen_inside_throttle_window():
    last = datetime(2026, 5, 25, 11, 56, 0)
    assert not should_touch_last_seen(last, now=datetime(2026, 5, 25, 12, 0, 0))


def test_should_touch_last_seen_after_throttle_window():
    last = datetime(2026, 5, 25, 11, 49, 0)
    assert should_touch_last_seen(last, now=datetime(2026, 5, 25, 12, 0, 0))
```

- [ ] **Step 2: Run tests and verify RED**

```bash
bash tests/api/run.sh tests/api/test_auth_admin.py -q
```

Expected: fail because `should_touch_last_seen` is missing.

- [ ] **Step 3: Implement helpers**

In `api/auth.py`, add:

```python
from datetime import datetime, timedelta

LAST_SEEN_TOUCH_INTERVAL = timedelta(minutes=5)


def should_touch_last_seen(last_seen_at: datetime | None, now: datetime | None = None) -> bool:
    now = now or datetime.utcnow()
    if last_seen_at is None:
        return True
    return now - last_seen_at >= LAST_SEEN_TOUCH_INTERVAL
```

Add an admin dependency:

```python
async def get_current_admin(user: User = Depends(get_current_user)) -> User:
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="admin required")
    return user
```

Update `get_current_user` after loading the user:

```python
    if should_touch_last_seen(user.last_seen_at):
        user.last_seen_at = datetime.utcnow()
        await db.commit()
        await db.refresh(user)
```

- [ ] **Step 4: Run tests**

```bash
bash tests/api/run.sh tests/api/test_auth_admin.py -q
python3 -m py_compile api/auth.py
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add api/auth.py tests/api/test_auth_admin.py
git commit -m "add admin auth helpers"
```

### Task 3: Admin Routes And Server Command

**Files:**
- Create: `api/routes/admin.py`
- Create: `api/admin_tools.py`
- Modify: `api/main.py`
- Test: `tests/api/test_admin_tools.py`
- Test: `tests/post_release/test_admin_contract.py`

- [ ] **Step 1: Write admin command tests**

Create `tests/api/test_admin_tools.py`:

```python
from types import SimpleNamespace

import pytest

from api.admin_tools import find_unique_user_by_prefix


def test_find_unique_user_by_prefix_requires_one_match():
    user = SimpleNamespace(api_key="abcdef123", name="u")
    assert find_unique_user_by_prefix([user], "abcdef") is user


def test_find_unique_user_by_prefix_fails_zero_matches():
    with pytest.raises(ValueError, match="No users"):
        find_unique_user_by_prefix([], "abcdef")


def test_find_unique_user_by_prefix_fails_multiple_matches():
    users = [
        SimpleNamespace(api_key="abcdef123"),
        SimpleNamespace(api_key="abcdef999"),
    ]
    with pytest.raises(ValueError, match="Multiple users"):
        find_unique_user_by_prefix(users, "abcdef")
```

- [ ] **Step 2: Verify command tests RED**

```bash
bash tests/api/run.sh tests/api/test_admin_tools.py -q
```

Expected: fail because `api.admin_tools` is missing.

- [ ] **Step 3: Implement `api/admin_tools.py`**

Implement:

```python
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
```

- [ ] **Step 4: Implement admin routes**

Create `api/routes/admin.py`:

```python
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.auth import get_current_admin, get_current_user
from api.database import get_db
from api.models import User
from api.schemas import AdminMeResponse, AdminUserLimitsRequest, AdminUserSummary

router = APIRouter(prefix="/admin", tags=["admin"])


async def media_used_bytes(db: AsyncSession, user_id) -> int:
    return 0


async def user_summary(db: AsyncSession, user: User) -> AdminUserSummary:
    return AdminUserSummary(
        user_id=str(user.id),
        name=user.name,
        created_at=user.created_at,
        last_seen_at=user.last_seen_at,
        is_admin=user.is_admin,
        media_quota_bytes=user.media_quota_bytes,
        media_max_upload_bytes=user.media_max_upload_bytes,
        media_used_bytes=await media_used_bytes(db, user.id),
    )


@router.get("/me", response_model=AdminMeResponse)
async def admin_me(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return AdminMeResponse(
        user_id=str(user.id),
        name=user.name,
        is_admin=user.is_admin,
        media_quota_bytes=user.media_quota_bytes,
        media_max_upload_bytes=user.media_max_upload_bytes,
        media_used_bytes=await media_used_bytes(db, user.id),
    )


@router.get("/users", response_model=list[AdminUserSummary])
async def list_users(_admin: User = Depends(get_current_admin), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).order_by(User.last_seen_at.desc().nulls_last(), User.created_at.desc()))
    return [await user_summary(db, u) for u in result.scalars().all()]


@router.patch("/users/{user_id}/limits", response_model=AdminUserSummary)
async def update_user_limits(
    user_id: str,
    req: AdminUserLimitsRequest,
    _admin: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    if req.media_quota_bytes <= 0 or req.media_max_upload_bytes <= 0:
        raise HTTPException(status_code=400, detail="limits must be positive")
    if req.media_max_upload_bytes > req.media_quota_bytes:
        raise HTTPException(status_code=400, detail="max upload cannot exceed quota")
    user = await db.get(User, UUID(user_id))
    if not user:
        raise HTTPException(status_code=404, detail="user not found")
    user.media_quota_bytes = req.media_quota_bytes
    user.media_max_upload_bytes = req.media_max_upload_bytes
    await db.commit()
    await db.refresh(user)
    return await user_summary(db, user)
```

Modify `api/main.py`:

```python
from api.routes import admin, auth, share_links, sync

app.include_router(admin.router, prefix="/v1")
```

- [ ] **Step 5: Add post-release admin contract smoke**

Create `tests/post_release/test_admin_contract.py`:

```python
def test_admin_me_available_for_authenticated_user(api_client):
    status, data = api_client.request_json("GET", "/v1/admin/me")
    assert status == 200, data
    assert data["is_admin"] is False
    assert data["media_quota_bytes"] >= data["media_max_upload_bytes"] > 0


def test_non_admin_cannot_list_users(api_client):
    status, data = api_client.request_json("GET", "/v1/admin/users")
    assert status == 403, data
```

- [ ] **Step 6: Run checks**

```bash
bash tests/api/run.sh tests/api/test_admin_tools.py -q
python3 -m py_compile api/routes/admin.py api/admin_tools.py api/main.py
```

Expected: pass.

- [ ] **Step 7: Commit**

```bash
git add api/routes/admin.py api/admin_tools.py api/main.py tests/api/test_admin_tools.py tests/post_release/test_admin_contract.py
git commit -m "add admin user api"
```

### Task 4: Desktop Settings Admin UI

**Files:**
- Modify: `desktop-rust/src-tauri/src/commands/sync_cmd.rs` or create `desktop-rust/src-tauri/src/commands/admin.rs`
- Modify: `desktop-rust/src-tauri/src/commands/mod.rs`
- Modify: `desktop-rust/src-tauri/src/lib.rs`
- Modify: `desktop-rust/src/tabs/settings.js`
- Modify: `desktop-rust/src/dev-mock.js`
- Modify: `desktop-rust/src/dev-test.py`

- [ ] **Step 1: Decide bridge shape**

If using frontend `fetch` directly would expose stored API key handling in JS,
use native Tauri commands. Prefer native commands for consistency with share
links:

```rust
get_admin_me() -> AdminMe
list_admin_users() -> Vec<AdminUser>
update_admin_user_limits(user_id, media_quota_bytes, media_max_upload_bytes) -> AdminUser
```

- [ ] **Step 2: Add failing browser smoke**

In `desktop-rust/src/dev-test.py`, add a test that:

- opens Settings;
- with mock `adminMe.is_admin=false`, asserts `Users / Limits` is not visible;
- flips mock admin state to true;
- reloads Settings;
- asserts `Users / Limits` is visible;
- asserts a mocked user row and quota text render.

Expected failing output before implementation: admin section missing.

- [ ] **Step 3: Add dev mock commands**

In `desktop-rust/src/dev-mock.js`, add mocked handlers:

```js
async get_admin_me() {
  return { user_id: 'admin-user', name: 'Admin', is_admin: true, media_quota_bytes: 1073741824, media_max_upload_bytes: 20971520, media_used_bytes: 1024 * 1024 * 12 };
},
async list_admin_users() {
  return [
    { user_id: 'admin-user', name: 'Admin', created_at: new Date().toISOString(), last_seen_at: new Date().toISOString(), is_admin: true, media_quota_bytes: 1073741824, media_max_upload_bytes: 20971520, media_used_bytes: 1024 * 1024 * 12 },
    { user_id: 'regular-user', name: 'Phone', created_at: new Date().toISOString(), last_seen_at: null, is_admin: false, media_quota_bytes: 1073741824, media_max_upload_bytes: 20971520, media_used_bytes: 0 },
  ];
},
async update_admin_user_limits({ userId, mediaQuotaBytes, mediaMaxUploadBytes }) {
  return { user_id: userId, name: 'Updated', created_at: new Date().toISOString(), last_seen_at: new Date().toISOString(), is_admin: false, media_quota_bytes: mediaQuotaBytes, media_max_upload_bytes: mediaMaxUploadBytes, media_used_bytes: 0 };
},
```

- [ ] **Step 4: Implement Settings section**

In `desktop-rust/src/tabs/settings.js`:

- load `get_admin_me` during Settings render;
- if not admin, do not render the section;
- if admin, render `Users / Limits`;
- render compact table/list rows;
- show admin state as a read-only badge;
- add edit controls for quota and max upload;
- call update commands;
- show toasts on success/error.

- [ ] **Step 5: Implement native commands if used**

Add Rust bridge following `share_links.rs` URL/auth patterns. Use
`state.lock_recover()` when reading settings.

- [ ] **Step 6: Run desktop checks**

```bash
node --check desktop-rust/src/tabs/settings.js
node --check desktop-rust/src/dev-mock.js
cd desktop-rust/src && python3 dev-test.py
cd ../src-tauri && /home/aster/.cargo/bin/cargo check
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add desktop-rust/src-tauri/src/commands/admin.rs desktop-rust/src-tauri/src/commands/mod.rs desktop-rust/src-tauri/src/lib.rs desktop-rust/src/tabs/settings.js desktop-rust/src/dev-mock.js desktop-rust/src/dev-test.py
git commit -m "add admin settings UI"
```

If no Rust command file was created, omit it from `git add`.

### Task 5: Phase 1 Release And Production Admin Assignment

**Files:**
- Modify: `desktop-rust/src-tauri/Cargo.toml`
- Modify: `desktop-rust/src-tauri/tauri.conf.json`
- Modify: `desktop-rust/src-tauri/Cargo.lock`
- Modify: `desktop-rust/CHANGELOG.md`
- Modify: `desktop-rust/src/release-history.md`
- Modify: `desktop-rust/src/tabs/help.js`

- [ ] **Step 1: Update help and release history**

Document:

- admin Users/Limits Settings section;
- storage quota management;
- server-side admin assignment is not available in UI.

- [ ] **Step 2: Bump desktop native version**

Because new Tauri commands are likely added, cut full release:

- `1.3.32` -> `1.3.33` unless another release happened first.

- [ ] **Step 3: Run required checks**

```bash
cd desktop-rust/src-tauri && /home/aster/.cargo/bin/cargo check
cd ../src && python3 dev-test.py
python3 -m py_compile api/models.py api/auth.py api/routes/admin.py api/admin_tools.py
bash tests/api/run.sh tests/api/test_admin_user_model.py tests/api/test_auth_admin.py tests/api/test_admin_tools.py -q
```

- [ ] **Step 4: Commit release prep**

```bash
git add desktop-rust/src-tauri/Cargo.toml desktop-rust/src-tauri/tauri.conf.json desktop-rust/src-tauri/Cargo.lock desktop-rust/CHANGELOG.md desktop-rust/src/release-history.md desktop-rust/src/tabs/help.js
git commit -m "prepare admin limits release (v1.3.33)"
```

- [ ] **Step 5: Push, tag, deploy API**

```bash
git push
git tag v1.3.33
git push origin v1.3.33
ssh snippets-api 'cd /opt/snippets_helper && git pull --ff-only && docker-compose up --build -d'
```

If docker-compose v1 hits `KeyError: ContainerConfig`, remove only stale stopped
`snippets_api` / `snippets_migrate` containers and rerun.

- [ ] **Step 6: Assign production admin**

```bash
ssh snippets-api 'cd /opt/snippets_helper && docker-compose exec -T api python -m api.admin_tools make-admin --api-key-prefix f33d8ddd'
```

Expected output includes:

```text
api_key_prefix=f33d8ddd
is_admin=True
```

- [ ] **Step 7: Post-release smoke**

```bash
POST_RELEASE_API_BASE_URL=https://ister-app.ru/snippets-api \
POST_RELEASE_REGISTER_USER=1 \
POST_RELEASE_DESKTOP_TAG=v1.3.33 \
POST_RELEASE_MOBILE_VERSION=1.0.18 \
bash tests/post_release/run.sh -q
```

Expected: all post-release smoke tests pass.

---

## Phase 2: Images In Notes/Snippets

### Task 6: Media Data Model And Utilities

**Files:**
- Modify: `api/models.py`
- Create: `api/alembic/versions/010_add_media_assets.py`
- Create: `api/media_utils.py`
- Test: `tests/api/test_media_utils.py`

- [ ] **Step 1: Write media utility tests**

Create tests for:

- public token contains only URL-safe chars;
- safe storage path stays under media root;
- quota remaining calculation rejects over-quota writes.

- [ ] **Step 2: Implement media models**

Add `MediaAsset` and `MediaAssetVariant` using snake_case fields from the spec.
Do not put a public URL token on `media_assets`; store `public_token` on each
`media_asset_variants` row so public URLs expose only the selected variant.

- [ ] **Step 3: Add Alembic migration**

Create `media_assets` and `media_asset_variants` tables with indexes:

- `(user_id, created_at)`
- unique `(public_token)` on `media_asset_variants`
- `(asset_uuid, variant)` unique.

Use this Alembic chain:

```python
revision = "010"
down_revision = "009"
branch_labels = None
depends_on = None
```

- [ ] **Step 4: Implement utilities**

`api/media_utils.py` should provide:

```python
generate_media_token()
safe_media_path(root, variant_public_token, extension)
validate_quota(max_upload, quota, used, incoming_bytes)
```

`safe_media_path` must produce a direct static-file path:

```text
/opt/isterapp/uploads/snippets-media/<variant_public_token>.webp
```

Do not require DB lookup for public media serving in the first implementation.

- [ ] **Step 5: Run checks and commit**

```bash
bash tests/api/run.sh tests/api/test_media_utils.py -q
python3 -m py_compile api/media_utils.py api/models.py api/alembic/versions/010_add_media_assets.py
git add api/models.py api/alembic/versions/010_add_media_assets.py api/media_utils.py tests/api/test_media_utils.py
git commit -m "add media asset model"
```

### Task 7: Server-Side Image Processing

**Files:**
- Modify: `api/requirements.txt`
- Create: `api/image_processing.py`
- Test: `tests/api/test_image_processing.py`

- [ ] **Step 1: Add dependencies**

Add to `api/requirements.txt`:

```text
Pillow>=10.0.0
python-multipart>=0.0.9
```

- [ ] **Step 2: Write image processing tests**

Use an in-memory generated PNG via Pillow. Verify:

- variants are generated;
- metadata includes width, height, bytes, sha256;
- invalid bytes are rejected.

- [ ] **Step 3: Implement variants**

`api/image_processing.py` should generate:

- `small`: max width 960, quality around 68;
- `balanced`: max width 1600, quality around 76;
- `readable`: max width 2200, quality around 88;
- `original`: original decoded and metadata-stripped where possible.

- [ ] **Step 4: Run checks and commit**

```bash
bash tests/api/run.sh tests/api/test_image_processing.py -q
python3 -m py_compile api/image_processing.py
git add api/requirements.txt api/image_processing.py tests/api/test_image_processing.py
git commit -m "add server image processing"
```

### Task 8: Media API Upload, Job Status, Select, Delete

**Files:**
- Create: `api/routes/media.py`
- Modify: `api/main.py`
- Modify: `api/routes/admin.py`
- Modify: `docker-compose.yml`
- Test: `tests/post_release/test_media_contract.py`

- [ ] **Step 1: Add media routes**

Implement:

- `POST /v1/media/uploads`
- `GET /v1/media/jobs/{job_id}`
- `POST /v1/media/assets/{asset_uuid}/select`
- `DELETE /v1/media/assets/{asset_uuid}`

`POST /v1/media/uploads` should save the accepted upload, create a media job,
return `job_id` immediately, and process variants in a background task. The
client polls `GET /v1/media/jobs/{job_id}` for `queued`, `processing`, `ready`,
or `failed` status and step progress. Do not block the upload response for the
whole optimization pass.

Quota enforcement must happen under a database transaction with a per-user row
lock or PostgreSQL advisory lock. The route must not simply calculate usage
before processing and commit later without locking, because concurrent uploads
could exceed quota.

Public Markdown URLs must use the selected variant token only:

```text
https://ister-app.ru/snippets-media/<variant_public_token>.webp
```

- [ ] **Step 2: Update admin media usage**

Replace `media_used_bytes()` in `api/routes/admin.py` with a sum over
non-deleted `media_asset_variants.size_bytes`.

- [ ] **Step 3: Add persistent media volume**

Modify `docker-compose.yml` API service:

```yaml
volumes:
  - /opt/isterapp/uploads/snippets-media:/opt/isterapp/uploads/snippets-media
```

The path must match the media root used by `api/media_utils.py`.

- [ ] **Step 4: Add live smoke**

Create `tests/post_release/test_media_contract.py` that:

- registers a user;
- checks `/v1/admin/me` limits;
- uploads a tiny PNG;
- verifies variants;
- selects `balanced`;
- verifies returned Markdown URL;
- deletes the asset.

- [ ] **Step 5: Run checks and commit**

```bash
python3 -m py_compile api/routes/media.py api/main.py api/routes/admin.py
POST_RELEASE_API_BASE_URL=http://localhost:8001 POST_RELEASE_API_KEY=dummy bash tests/post_release/run.sh tests/post_release/test_media_contract.py -q
git add api/routes/media.py api/main.py api/routes/admin.py docker-compose.yml tests/post_release/test_media_contract.py
git commit -m "add media upload api"
```

Use the local smoke command only when a local API is running; otherwise run
unit tests now and production smoke after deploy.

### Task 9: Desktop Figure Card Rendering And Upload Modal

**Files:**
- Create: `desktop-rust/src-tauri/src/commands/media.rs`
- Modify: `desktop-rust/src-tauri/src/commands/mod.rs`
- Modify: `desktop-rust/src-tauri/src/lib.rs`
- Modify: `desktop-rust/src/components/md-toolbar.js`
- Create: `desktop-rust/src/components/image-upload-modal.js`
- Modify: `desktop-rust/src/tabs/notes.js`
- Modify: `desktop-rust/src/tabs/shortcuts.js`
- Modify: `desktop-rust/src/styles.css`
- Modify: `desktop-rust/src/dev-mock.js`
- Modify: `desktop-rust/src/dev-test.py`

- [ ] **Step 1: Add smoke tests**

Add CDP smoke tests for:

- opening image modal from Notes toolbar;
- progress states render;
- selecting `Readable` and opening 100% preview;
- inserting Figure Card Markdown at cursor;
- preview shows `.markdown-figure-card`.

- [ ] **Step 2: Create modal**

`image-upload-modal.js` renders:

- presets: Small/Balanced/Readable/Original;
- advanced quality controls;
- upload/server/preview progress states;
- fit preview and click-to-100% preview;
- insert/cancel actions.

- [ ] **Step 3: Add native upload bridge**

Use Tauri native commands rather than browser `fetch`, so stored API key
handling remains in Rust and upload progress is reliable in WebView2:

```rust
pick_media_file() -> Option<String>
start_media_upload(file_path, requested_variants) -> MediaUploadStarted
get_media_job(job_id) -> MediaJobStatus
select_media_variant(asset_uuid, variant) -> MediaSelectResponse
```

`start_media_upload` uses `reqwest` multipart/stream upload and emits window
events:

- `media-upload-progress` with uploaded/total bytes;
- `media-processing-progress` when server processing lasts longer than 1s;
- `media-preview-progress` when preview metadata/bytes are being fetched.

Use existing `tauri-plugin-dialog` for file picking and existing API URL/API
key settings patterns from share links. Register commands in `commands/mod.rs`
and `lib.rs`, and mirror them in `desktop-rust/src/dev-mock.js`.

- [ ] **Step 4: Integrate toolbar**

Change image toolbar button from prompt-based URL insertion to modal-based
upload insertion. Preserve external URL insertion only if user chooses a URL
mode in the modal.

- [ ] **Step 5: Render Figure Cards**

Post-process Markdown-rendered images in Notes and Snippets:

- wrap images in `.markdown-figure-card`;
- show caption from `alt`;
- add compact metadata/action row only where data exists.

- [ ] **Step 6: Run checks and commit**

```bash
node --check desktop-rust/src/components/md-toolbar.js
node --check desktop-rust/src/components/image-upload-modal.js
node --check desktop-rust/src/tabs/notes.js
node --check desktop-rust/src/tabs/shortcuts.js
node --check desktop-rust/src/dev-mock.js
cd desktop-rust/src && python3 dev-test.py
cd ../src-tauri && /home/aster/.cargo/bin/cargo check
git add desktop-rust/src-tauri/src/commands/media.rs desktop-rust/src-tauri/src/commands/mod.rs desktop-rust/src-tauri/src/lib.rs desktop-rust/src/components/md-toolbar.js desktop-rust/src/components/image-upload-modal.js desktop-rust/src/tabs/notes.js desktop-rust/src/tabs/shortcuts.js desktop-rust/src/styles.css desktop-rust/src/dev-mock.js desktop-rust/src/dev-test.py
git commit -m "add desktop image figure cards"
```

### Task 10: Mobile Safe Rendering

**Files:**
- Modify: `mobile/src/screens/Notes/NoteEditorScreen.js`
- Modify: `mobile/src/screens/Snippets/SnippetDetailScreen.js`
- Test: `mobile/__tests__/imageMarkdown.test.js`

- [ ] **Step 1: Add mobile rendering test**

Test that Markdown with `![caption](https://ister-app.ru/snippets-media/variant-token.webp)`
renders without throwing and preserves caption text.

- [ ] **Step 2: Add Markdown image styles**

In note and snippet preview components, style image render rules to match a
compact Figure Card as much as `react-native-markdown-display` allows.

- [ ] **Step 3: Run mobile tests and commit**

```bash
cd mobile && npm test -- --runInBand
git add mobile/src/screens/Notes/NoteEditorScreen.js mobile/src/screens/Snippets/SnippetDetailScreen.js mobile/__tests__/imageMarkdown.test.js
git commit -m "render image markdown on mobile"
```

### Task 11: Public Share Figure Cards

**Files:**
- Modify: `api/share_utils.py`
- Test: `tests/api/test_share_utils.py`
- Test: `tests/post_release/test_share_links_contract.py`

- [ ] **Step 1: Add tests**

Extend `tests/api/test_share_utils.py`:

- Markdown image in note content renders as a Figure Card;
- unsafe image URL schemes are not rendered as executable links;
- snippet public payload still excludes non-approved fields.

- [ ] **Step 2: Implement renderer**

Update public HTML rendering to:

- support Markdown image blocks;
- output Figure Card markup;
- preserve existing escaping rules;
- only allow `https://`, `http://`, and trusted `/snippets-media/` URLs.

- [ ] **Step 3: Extend live share smoke**

Add an image URL to shared note/snippet content and assert public HTML/JSON
does not fail. If HTML body inspection is added, keep it lightweight.

- [ ] **Step 4: Run checks and commit**

```bash
bash tests/api/run.sh tests/api/test_share_utils.py -q
python3 -m py_compile api/share_utils.py
git add api/share_utils.py tests/api/test_share_utils.py tests/post_release/test_share_links_contract.py
git commit -m "render share image figure cards"
```

### Task 12: Phase 2 Release

**Files:**
- Modify release/help files per actual touched desktop/mobile scope.

- [ ] **Step 1: Determine release type**

If Phase 2 added/changed desktop Tauri commands or mobile native dependencies:

- desktop: full `v*` release;
- mobile: APK if native dependency changed, otherwise OTA.

If only frontend desktop JS changed:

- desktop: `f-*` OTA.

If mobile changes are JS-only under `mobile/src/**`, use the OTA procedure from
`mobile/RELEASES.md`:

- bump `mobile/package.json` version;
- build Android bundle with `npx react-native bundle`;
- zip the top-level `output/` folder;
- upload to `/opt/isterapp/releases/snippets-updates/`;
- update `/opt/isterapp/releases/snippets-updates/latest.json`;
- verify `https://ister-app.ru/snippets-updates/latest.json`.

If a native mobile dependency, Android manifest, Gradle file, or permission
changes, ship an APK release instead of OTA.

- [ ] **Step 2: Run verification**

```bash
cd desktop-rust/src-tauri && /home/aster/.cargo/bin/cargo check
cd ../src && python3 dev-test.py
cd ../../mobile && npm test -- --runInBand
bash tests/api/run.sh tests/api -q
python3 -m py_compile api/models.py api/routes/admin.py api/routes/media.py api/media_utils.py api/image_processing.py api/share_utils.py
```

- [ ] **Step 3: Deploy API and server nginx/static route**

Ensure the host directory exists and the API container mounts it:

```bash
ssh snippets-api 'mkdir -p /opt/isterapp/uploads/snippets-media'
```

`docker-compose.yml` API service must include:

```yaml
volumes:
  - /opt/isterapp/uploads/snippets-media:/opt/isterapp/uploads/snippets-media
```

Ensure nginx has:

```nginx
location /snippets-media/ {
    alias /opt/isterapp/uploads/snippets-media/;
    autoindex off;
    try_files $uri =404;
}
```

Deploy API:

```bash
ssh snippets-api 'cd /opt/snippets_helper && git pull --ff-only && docker-compose up --build -d'
```

- [ ] **Step 4: Run post-release smoke**

```bash
POST_RELEASE_API_BASE_URL=https://ister-app.ru/snippets-api \
POST_RELEASE_REGISTER_USER=1 \
POST_RELEASE_DESKTOP_TAG=<desktop-tag> \
POST_RELEASE_MOBILE_VERSION=<mobile-version> \
bash tests/post_release/run.sh -q
```

Expected: all pass, including admin/media/share tests.

---

## Self-Review Checklist

- Spec coverage:
  - Admin model, API, command, Settings UI: Tasks 1-5.
  - Image storage, optimization, modal, progress, rendering, share: Tasks 6-12.
- Placeholder scan:
  - No unresolved `TBD`/`TODO` placeholders should remain.
  - Any command with `<desktop-tag>` or `<mobile-version>` is intentionally a release-time value in Task 12.
- Type consistency:
  - API uses snake_case JSON fields matching schemas.
  - Desktop JS command argument names should map to Tauri camelCase conventions if native commands are used.
  - Byte values use integer-like numeric values everywhere.
