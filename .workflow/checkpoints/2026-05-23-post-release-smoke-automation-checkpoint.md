# Checkpoint: Post-Release Smoke Automation

Date: 2026-05-23
Context: forked conversation from the main Tasks sync release thread
Commit status: not committed

## Goal

Added the first post-release automation layer for the Tasks sync release.
This phase intentionally excludes UI E2E for mobile and desktop.

## Scope Implemented

New pytest-based smoke suite under `tests/post_release/`:

- `tests/post_release/requirements.txt`
- `tests/post_release/run.sh`
- `tests/post_release/conftest.py`
- `tests/post_release/test_api_health.py`
- `tests/post_release/test_tasks_sync_contract.py`
- `tests/post_release/test_release_manifests.py`

Workflow docs added/updated:

- `.workflow/specs/2026-05-23-post-release-smoke-automation.md`
- `.workflow/plans/2026-05-23-post-release-smoke-automation.md`

Repo ignore updated:

- `.gitignore` now ignores `tests/post_release/.venv/`.

## Design Decisions

- Do not migrate old tests.
- Do not add mobile or desktop UI E2E in this phase.
- Keep the new smoke layer isolated in `tests/post_release/`.
- Use pytest for clear fixtures/assertions and future CI compatibility.
- Use only public HTTP endpoints:
  - API health: `/v1/health`
  - sync contract: `/v1/sync/push`, `/v1/sync/pull`
  - registration when needed: `/v1/auth/register`
  - GitHub Releases API
  - mobile OTA manifest/bundle URLs
- Use production API base URL with the reverse-proxy path:
  - `https://ister-app.ru/snippets-api`
  - not plain `https://ister-app.ru`
- Keep a persistent local venv at `tests/post_release/.venv/` because releases
  and smoke runs happen frequently.

## Runner

Main command after release:

```bash
POST_RELEASE_API_BASE_URL=https://ister-app.ru/snippets-api \
POST_RELEASE_REGISTER_USER=1 \
POST_RELEASE_DESKTOP_TAG=v1.3.28 \
POST_RELEASE_MOBILE_VERSION=1.0.6 \
bash tests/post_release/run.sh -q
```

Runner behavior:

- creates `tests/post_release/.venv` if missing;
- installs dependencies from `tests/post_release/requirements.txt`;
- stores a requirements hash in `.venv/.requirements.sha256`;
- does not rerun `pip install` on each launch unless requirements change;
- supports forced reinstall with `POST_RELEASE_SMOKE_REINSTALL=1`;
- supports pytest arguments, including partial test paths.

## Tests Added

### `test_api_health.py`

- Verifies `GET /v1/health` returns HTTP 200 and `{"status": "ok"}`.
- Uses unauthenticated `base_api_client`.
- Requires only `POST_RELEASE_API_BASE_URL`.

### `test_tasks_sync_contract.py`

- Pushes and pulls:
  - `task_categories`
  - `task_statuses`
  - `tasks`
  - `task_checkboxes`
  - `task_links`
- Asserts UUID relationship preservation:
  - `tasks.category_uuid`
  - `tasks.status_uuid`
  - `task_checkboxes.task_uuid`
  - `task_checkboxes.parent_uuid`
  - `task_links.task_uuid`
- Verifies soft delete propagation.
- Verifies last-write-wins conflict behavior.
- Uses `POST_RELEASE_API_KEY` or disposable registration with
  `POST_RELEASE_REGISTER_USER=1`.

### `test_release_manifests.py`

- Desktop release smoke:
  - fetches GitHub release by `POST_RELEASE_DESKTOP_TAG`;
  - asserts `frontend-version.json`;
  - asserts `latest.json`;
  - for `v*` tags, asserts at least one native desktop artifact;
  - fetches `frontend-version.json` and validates `version` and `url`.
- Mobile OTA smoke:
  - fetches `POST_RELEASE_MOBILE_MANIFEST_URL`, default
    `https://ister-app.ru/snippets-updates/latest.json`;
  - asserts version equals `POST_RELEASE_MOBILE_VERSION`;
  - asserts `bundle_url` exists and responds with HTTP 200 or 206.

## Verification Run

Passed:

```bash
python3 -m py_compile tests/post_release/conftest.py \
  tests/post_release/test_api_health.py \
  tests/post_release/test_tasks_sync_contract.py \
  tests/post_release/test_release_manifests.py
```

Passed:

```bash
bash -n tests/post_release/run.sh
```

Passed after bootstrapping `tests/post_release/.venv`:

```bash
bash tests/post_release/run.sh -q -rs
```

Result:

```text
5 skipped
```

This is expected without post-release env vars.

Passed:

```bash
POST_RELEASE_DESKTOP_TAG=v1.3.27 \
bash tests/post_release/run.sh tests/post_release/test_release_manifests.py::test_desktop_release_manifest_assets -q
```

Passed:

```bash
POST_RELEASE_MOBILE_VERSION=1.0.5 \
bash tests/post_release/run.sh tests/post_release/test_release_manifests.py::test_mobile_ota_manifest -q
```

Passed:

```bash
POST_RELEASE_API_BASE_URL=https://ister-app.ru/snippets-api \
bash tests/post_release/run.sh tests/post_release/test_api_health.py -q
```

Passed:

```bash
git diff --check
```

Verified:

```bash
git check-ignore -v tests/post_release/.venv/bin/python \
  tests/post_release/.venv/.requirements.sha256
```

Output confirmed `.gitignore` ignores `tests/post_release/.venv/`.

## Not Run Yet

Full post-release smoke was not run:

```bash
POST_RELEASE_API_BASE_URL=https://ister-app.ru/snippets-api \
POST_RELEASE_REGISTER_USER=1 \
POST_RELEASE_DESKTOP_TAG=v1.3.28 \
POST_RELEASE_MOBILE_VERSION=1.0.6 \
bash tests/post_release/run.sh -q
```

Reason: full sync-contract smoke creates a disposable user and rows through the
deployed API. It should run only after:

1. API migration/deploy is complete.
2. Desktop `v*` release tag exists.
3. Mobile OTA manifest has the expected version.

## Current Git State Relevant to This Fork

New/modified smoke automation files:

- `.gitignore`
- `.workflow/specs/2026-05-23-post-release-smoke-automation.md`
- `.workflow/plans/2026-05-23-post-release-smoke-automation.md`
- `.workflow/checkpoints/2026-05-23-post-release-smoke-automation-checkpoint.md`
- `tests/post_release/requirements.txt`
- `tests/post_release/run.sh`
- `tests/post_release/conftest.py`
- `tests/post_release/test_api_health.py`
- `tests/post_release/test_tasks_sync_contract.py`
- `tests/post_release/test_release_manifests.py`

Other uncommitted Tasks sync implementation files from the main thread still
exist in the same working tree and were not changed by the smoke automation
work except for shared git status visibility.

## Prompt for Main Session

Use this prompt when returning to the main session:

```text
Я вернулся из fork-сессии, где был реализован первый этап post-release smoke automation для Tasks sync release. UI E2E для mobile/desktop не делали.

В fork-сессии добавлены:
- `.workflow/specs/2026-05-23-post-release-smoke-automation.md`
- `.workflow/plans/2026-05-23-post-release-smoke-automation.md`
- `.workflow/checkpoints/2026-05-23-post-release-smoke-automation-checkpoint.md`
- `tests/post_release/requirements.txt`
- `tests/post_release/run.sh`
- `tests/post_release/conftest.py`
- `tests/post_release/test_api_health.py`
- `tests/post_release/test_tasks_sync_contract.py`
- `tests/post_release/test_release_manifests.py`
- `.gitignore` обновлен: добавлен ignore для `tests/post_release/.venv/`.

Ключевые решения:
- старые Jest/cargo/dev-test тесты не мигрировали;
- новый слой изолирован в `tests/post_release/`;
- основной запуск идет через постоянный venv рядом с тестами:
  `bash tests/post_release/run.sh -q`;
- production API base URL должен быть `https://ister-app.ru/snippets-api`;
- full smoke после релиза:
  `POST_RELEASE_API_BASE_URL=https://ister-app.ru/snippets-api POST_RELEASE_REGISTER_USER=1 POST_RELEASE_DESKTOP_TAG=v1.3.28 POST_RELEASE_MOBILE_VERSION=1.0.6 bash tests/post_release/run.sh -q`.

Проверки в fork-сессии:
- `python3 -m py_compile ...` по всем post_release `.py` файлам прошел;
- `bash -n tests/post_release/run.sh` прошел;
- `bash tests/post_release/run.sh -q -rs` прошел: 5 skipped без env, ожидаемо;
- desktop release manifest smoke прошел на существующем `v1.3.27`;
- mobile OTA manifest smoke прошел на текущем `1.0.5`;
- API health smoke прошел на `https://ister-app.ru/snippets-api`;
- `git diff --check` прошел;
- проверено, что `tests/post_release/.venv/` игнорируется git.

Полный `test_tasks_sync_contract.py` еще не запускался намеренно: он создает disposable user/rows и должен выполняться только после API migration/deploy, desktop tag и mobile OTA manifest.

Нужно в основной сессии продолжить релизный поток Tasks sync, учитывать новый smoke layer как post-release step, и не запускать UI E2E в этом этапе.
```
