# Sync Client: Audit + Fixes + Settings UI

## Scope

Аудит и исправление sync-слоя десктопного клиента (код написан AI, не тестировался).
Добавление вкладки Sync Settings в UI.

## Архитектура

Offline-first: каждый клиент работает с локальной DuckDB, API — хаб синхронизации.
Несколько устройств синхронизируются через сервер.

```
UI (Tkinter) ──> database.py (Lock) <── SyncEngine (daemon thread)
                                              │
                                        SyncClient (HTTP)
                                              │
                                         API Server
```

## Конфликты

Last-write-wins по `updated_at` (UTC). Все timestamp'ы хранятся и передаются в UTC.

## Триггер sync

Только по таймеру (SYNC_INTERVAL_SECONDS, по умолчанию 60 сек).
Цикл: push pending → pull new → update last_sync_at → sleep.

## Критические баги (найдены при аудите)

1. `datetime.now()` вместо UTC — ломает LWW между устройствами в разных часовых поясах
2. Сравнение дат через строки `str(local_updated) > str(row['updated_at'])` — LWW не работает
3. Миграция DuckDB: `DEFAULT CURRENT_TIMESTAMP` как строковый литерал
4. Гонка UI/sync: запись может измениться пока идёт push, mark_as_synced затрёт новое изменение
5. fk_uuid_map ссылается на несуществующее поле `folder_uuid`
6. `register()` отправляет невалидный Bearer-токен
7. Нет валидации ответа API после push
8. sync_status='synced' для существующих записей при миграции (должен быть 'pending')

## Исправления по файлам

### database.py (sync-методы)

- `upsert_from_server()`: парсинг дат через `datetime.fromisoformat()` вместо строкового сравнения
- `get_pending_changes()`: всегда включать uuid и updated_at в выборку; сериализация datetime → ISO с UTC
- `mark_as_synced()`: добавить условие `AND updated_at = ?` для защиты от гонки
- Все CRUD-методы: `CURRENT_TIMESTAMP` → явный параметр `datetime.now(timezone.utc).isoformat()`
- `purge_deleted()`: без изменений

### sync/engine.py (переписать, упростить)

- Daemon thread с `time.sleep(1)` в цикле (проверка `_running` каждую секунду)
- Нет `root.after()` для планирования — только для UI callback
- Методы: `start()`, `stop()`, `_loop()`, `_do_sync()`, `_push()`, `_pull()`
- `on_status(status, detail)` callback → UI обновляет лейбл через `root.after(0, ...)`
- `last_sync_at` хранится в app_settings, обновляется только после успешного pull

### sync/migration.py

- Тип `updated_at` остаётся TIMESTAMP, значения пишем из Python в UTC
- Бэкфилл `updated_at`: `UPDATE ... SET updated_at = NOW() WHERE updated_at IS NULL`
- Бэкфилл `sync_status`: `'pending'` вместо `'synced'` для существующих записей
- Бэкфилл `uuid`: `uuid()` функция DuckDB для строк без uuid

### shared/sync_schema.py

- Убрать `fk_uuid_map` — folder_uuid уже существует как колонка
- Дополнить `data_fields` недостающими полями (is_pinned, created_at и т.д.)

### sync/client.py

- `register()`: запрос без заголовка Authorization (новый пользователь не имеет ключа)
- Остальное без изменений (код проверен при тестировании API)

## UI: вкладка Sync Settings

Новый таб в ttk.Notebook.

Элементы:
- Server URL (text input)
- CA Cert path (text input + file picker button)
- Registration: Name input + Register button
- API Key input (заполняется автоматически после регистрации или вручную)
- Enable sync checkbox
- Interval input (секунды)
- Status label с индикатором (ok/syncing/error)
- Save Settings button

Поведение:
- Настройки хранятся в app_settings таблице DuckDB (ключ-значение)
- .env переменные — fallback для первичной настройки; после Save Settings — из БД
- Register вызывает client.register(name), api_key вписывается автоматически
- Save Settings: если sync вкл + URL + key → запускает SyncEngine; если выкл → останавливает
- При старте приложения: читаем из app_settings, если sync enabled → запускаем автоматически

## Что НЕ входит в scope

- Retry/backoff логика
- Sync по событию (при изменении данных)
- Кнопка "Sync now"
- Детальный лог sync-операций в UI
