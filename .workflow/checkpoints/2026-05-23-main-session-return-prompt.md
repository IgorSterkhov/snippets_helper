# Prompt for Main Session

```text
Я вернулся из fork-сессии, где был реализован первый этап post-release smoke automation для Tasks sync release. UI E2E для mobile/desktop не делали.

Добавлены:
- `.workflow/specs/2026-05-23-post-release-smoke-automation.md`
- `.workflow/plans/2026-05-23-post-release-smoke-automation.md`
- `.workflow/checkpoints/2026-05-23-post-release-smoke-automation-checkpoint.md`
- `tests/post_release/requirements.txt`
- `tests/post_release/run.sh`
- `tests/post_release/conftest.py`
- `tests/post_release/test_api_health.py`
- `tests/post_release/test_tasks_sync_contract.py`
- `tests/post_release/test_release_manifests.py`
- `.gitignore`: добавлен ignore для `tests/post_release/.venv/`.

Ключевые решения:
- старые Jest/cargo/dev-test тесты не мигрировали;
- новый слой изолирован в `tests/post_release/`;
- основной запуск через постоянный venv рядом с тестами:
  `bash tests/post_release/run.sh -q`;
- production API base URL: `https://ister-app.ru/snippets-api`;
- full smoke после релиза:
  `POST_RELEASE_API_BASE_URL=https://ister-app.ru/snippets-api POST_RELEASE_REGISTER_USER=1 POST_RELEASE_DESKTOP_TAG=v1.3.28 POST_RELEASE_MOBILE_VERSION=1.0.6 bash tests/post_release/run.sh -q`.

Проверки в fork-сессии:
- `python3 -m py_compile ...` по всем post_release `.py` прошел;
- `bash -n tests/post_release/run.sh` прошел;
- `bash tests/post_release/run.sh -q -rs` прошел: 5 skipped без env, ожидаемо;
- desktop release manifest smoke прошел на `v1.3.27`;
- mobile OTA manifest smoke прошел на `1.0.5`;
- API health smoke прошел на `https://ister-app.ru/snippets-api`;
- `git diff --check` прошел;
- `tests/post_release/.venv/` игнорируется git.

Полный `test_tasks_sync_contract.py` еще не запускался намеренно: он создает disposable user/rows и должен выполняться только после API migration/deploy, desktop tag и mobile OTA manifest.

Нужно продолжить релизный поток Tasks sync, учитывать новый smoke layer как post-release step, и не запускать UI E2E в этом этапе.
```
