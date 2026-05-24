# Main Branch Return Prompt

Вернулся из форка по багу sync состояния `task_checkboxes` mobile -> desktop.

Нужно принять состояние `main` после коммита:

```text
a443528 Fix task checkbox sync state
```

Что было исправлено:

1. Desktop:
   - Root cause: после pull sync SQLite уже получал обновленные `task_checkboxes`, но открытая вкладка Tasks держала старый in-memory checkbox cache.
   - Добавлено событие `snippets:sync-complete` в `desktop-rust/src/components/status-bar.js`.
   - `desktop-rust/src/tabs/tasks/index.js` слушает событие и при изменениях в `task_*` таблицах делает `invalidateAllCheckboxCache()` + `reloadAll()`.
   - Добавлен regression smoke `T16b Tasks refresh after sync pull` в `desktop-rust/src/dev-test.py`.

2. Mobile:
   - Root cause/risk: тап по чекбоксу в TaskEditor менял только React state и попадал в SQLite только после `Сохранить`.
   - Добавлен `setTaskCheckboxChecked()` в `mobile/src/db/taskRepo.js`.
   - `TaskEditorScreen` теперь для существующих задач сразу пишет checkbox state в SQLite и вызывает `notifyLocalChange()`.
   - Добавлен unit test на immediate persist.

Релизы уже сделаны:

- Desktop frontend OTA: `f-20260524-1`
  - GitHub Actions: success
  - frontend manifest: `1.3.29-fa443528`
  - assets uploaded: frontend zip, `frontend-version.json`, `latest.json`
- Mobile OTA: `1.0.14`
  - latest.json: `https://ister-app.ru/snippets-updates/latest.json`
  - bundle: `https://ister-app.ru/snippets-updates/bundle-1.0.14.zip`

Проверки уже прошли:

```bash
node --check <changed desktop/mobile JS files>
cd desktop-rust/src && python3 dev-test.py
cd mobile && npm test
POST_RELEASE_API_BASE_URL=https://ister-app.ru/snippets-api POST_RELEASE_REGISTER_USER=1 POST_RELEASE_DESKTOP_TAG=f-20260524-1 POST_RELEASE_MOBILE_VERSION=1.0.14 bash tests/post_release/run.sh -q
```

Результаты:

- `desktop-rust/src/dev-test.py` -> `27/27 passed`
- `mobile npm test` -> `37 passed`
- post-release smoke -> `6 passed`

Важный UX caveat:

- Если в desktop включено скрытие выполненных чекбоксов, отмеченный после sync пункт может не показать галочку, а исчезнуть. Для визуальной проверки галочки надо выключить hide completed через иконку глаза в карточке задачи.

Дальше в основной ветке:

1. Подтянуть latest `origin/main`.
2. Убедиться, что HEAD содержит `a443528`.
3. Продолжать следующий проход по мобильному приложению уже поверх этого состояния.
