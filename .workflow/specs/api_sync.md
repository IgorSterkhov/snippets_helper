# API Sync Service - Спецификация

## Описание
Серверный API для синхронизации данных между клиентами snippets_helper. Offline-first архитектура: приложение работает с локальной DuckDB, фоновая синхронизация с сервером каждые 60 секунд.

## Решения

| Аспект | Решение |
|--------|---------|
| Архитектура | Monorepo: `api/` + `sync/` + `shared/` в текущем репо |
| Сервер | FastAPI + PostgreSQL на VPS |
| Клиент | Offline-first, DuckDB остаётся основной БД |
| Синхронизация | Фоновый Thread + root.after(60000), batch push/pull |
| Конфликты | Last-write-wins по updated_at |
| Аутентификация | API key в заголовке Authorization |
| Деплой | Docker Compose (postgres + api + nginx) |
| Интервал sync | 60 секунд + ручной триггер |

## Синхронизируемые таблицы

| Таблица | Sync | Причина |
|---------|:----:|---------|
| shortcuts | да | основной контент |
| sql_table_analyzer_templates | да | общие шаблоны |
| sql_macrosing_templates | да | общие шаблоны |
| note_folders | да | основной контент |
| notes | да | основной контент |
| obfuscation_mappings | да | история обфускаций |
| commit_history | нет | привязана к локальному git |
| commit_tags | нет | machine-specific |
| superset_settings | нет | machine-specific |
| app_settings | нет | machine-specific |
| exec_categories | нет | machine-specific |
| exec_commands | нет | machine-specific |

## Структура проекта

```
snippets_helper/
├── api/                              # Серверная часть (деплоится на VPS)
│   ├── __init__.py
│   ├── main.py                       # FastAPI entrypoint
│   ├── config.py                     # Серверный конфиг
│   ├── database.py                   # PostgreSQL (SQLAlchemy async + asyncpg)
│   ├── models.py                     # ORM-модели
│   ├── schemas.py                    # Pydantic-схемы
│   ├── auth.py                       # API key middleware
│   ├── routes/
│   │   ├── __init__.py
│   │   ├── sync.py                   # Batch sync endpoints
│   │   └── auth.py                   # Регистрация
│   ├── requirements.txt
│   ├── Dockerfile
│   └── alembic/                      # Миграции PostgreSQL
│       ├── alembic.ini
│       ├── env.py
│       └── versions/
│           └── 001_initial.py
├── shared/
│   ├── __init__.py
│   └── sync_schema.py               # Определение синхронизируемых таблиц и полей
├── sync/                             # Клиентский sync engine
│   ├── __init__.py
│   ├── engine.py                     # SyncEngine (push/pull, таймер, конфликты)
│   ├── client.py                     # HTTP клиент (requests)
│   └── migration.py                  # Миграция DuckDB (добавление sync полей)
├── docker-compose.yml
├── nginx.conf
├── database.py                       # (существующий, модифицируется)
├── main.py                           # (существующий, модифицируется)
└── ...
```

## Изменения в локальной DuckDB

### Новые поля для синхронизируемых таблиц

Каждая из 6 синхронизируемых таблиц получает:

| Поле | Тип | Default | Назначение |
|------|-----|---------|------------|
| uuid | VARCHAR | uuid4() (Python) | Глобальный идентификатор |
| updated_at | TIMESTAMP | CURRENT_TIMESTAMP | Время последнего изменения |
| sync_status | VARCHAR | 'synced' | 'synced' / 'pending' / 'deleted' |
| user_id | VARCHAR | NULL | Владелец записи |

Примечание: `notes` уже имеет `updated_at`, добавляются только uuid, sync_status, user_id.

### Миграция существующих данных (sync/migration.py)

- Идемпотентная: безопасно запускать многократно
- ALTER TABLE ADD COLUMN для каждого нового поля
- Генерация UUID через Python uuid.uuid4() для существующих строк
- Все существующие записи получают sync_status='pending' (отправятся на сервер при первом sync)
- Запускается из _init_database() после создания таблиц

### Изменения в database.py

1. **threading.Lock** — для безопасного конкурентного доступа (UI thread + sync thread)
2. **INSERT/UPDATE** синхронизируемых таблиц → устанавливать sync_status='pending', updated_at=CURRENT_TIMESTAMP
3. **DELETE** синхронизируемых таблиц → soft-delete (sync_status='deleted') вместо физического удаления
4. **Рефакторинг save_sql_table_analyzer_templates()** — из delete-all/reinsert в upsert + soft-delete
5. **Новые методы:**

```python
def get_pending_changes(self, table_name: str) -> List[Dict]
def mark_as_synced(self, table_name: str, uuids: List[str])
def upsert_from_server(self, table_name: str, rows: List[Dict])
def purge_deleted(self, table_name: str, uuids: List[str])
```

## Серверная БД (PostgreSQL)

```sql
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    api_key VARCHAR(64) UNIQUE NOT NULL,
    name VARCHAR(255),
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE shortcuts (
    uuid UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    id INTEGER,
    name VARCHAR NOT NULL,
    value TEXT NOT NULL,
    description TEXT,
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    is_deleted BOOLEAN DEFAULT FALSE
);

CREATE TABLE sql_table_analyzer_templates (
    uuid UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    id INTEGER,
    template_text TEXT NOT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    is_deleted BOOLEAN DEFAULT FALSE
);

CREATE TABLE sql_macrosing_templates (
    uuid UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    id INTEGER,
    template_name VARCHAR NOT NULL,
    template_text TEXT NOT NULL,
    placeholders_config TEXT NOT NULL,
    combination_mode VARCHAR NOT NULL DEFAULT 'cartesian',
    separator VARCHAR NOT NULL DEFAULT E';\n',
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    is_deleted BOOLEAN DEFAULT FALSE
);

CREATE TABLE note_folders (
    uuid UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    id INTEGER,
    name VARCHAR NOT NULL,
    sort_order INTEGER DEFAULT 0,
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    is_deleted BOOLEAN DEFAULT FALSE
);

CREATE TABLE notes (
    uuid UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    id INTEGER,
    folder_id INTEGER,
    folder_uuid UUID,
    title VARCHAR NOT NULL,
    content TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    is_pinned INTEGER DEFAULT 0,
    is_deleted BOOLEAN DEFAULT FALSE
);

CREATE TABLE obfuscation_mappings (
    uuid UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    id INTEGER,
    session_name VARCHAR NOT NULL,
    entity_type VARCHAR NOT NULL,
    original_value VARCHAR NOT NULL,
    obfuscated_value VARCHAR NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    is_deleted BOOLEAN DEFAULT FALSE
);
```

Индексы: `CREATE INDEX idx_{table}_user_updated ON {table}(user_id, updated_at)` для всех таблиц.

## API Endpoints

Префикс: `/api/v1/`

### Auth

| Method | Path | Описание |
|--------|------|----------|
| POST | /auth/register | Регистрация, возвращает {user_id, api_key} |
| GET | /auth/me | Проверка API key, информация о пользователе |

### Sync (batch)

| Method | Path | Описание |
|--------|------|----------|
| POST | /sync/push | Отправка локальных изменений на сервер |
| POST | /sync/pull | Получение изменений с сервера с момента last_sync_at |
| GET | /health | Health check |

### POST /sync/push

Request:
```json
{
  "changes": {
    "shortcuts": [
      {"uuid": "...", "id": 1, "name": "...", "value": "...", "description": "...", "updated_at": "2026-03-10T12:00:00", "is_deleted": false}
    ],
    "notes": [...],
    ...
  }
}
```

Response:
```json
{
  "status": "ok",
  "accepted": 15,
  "conflicts": [
    {"table": "shortcuts", "uuid": "...", "server_updated_at": "...", "resolution": "server_wins"}
  ]
}
```

### POST /sync/pull

Request:
```json
{
  "last_sync_at": "2026-03-10T11:00:00"
}
```

Response:
```json
{
  "changes": {
    "shortcuts": [...],
    "notes": [...],
    ...
  },
  "server_time": "2026-03-10T12:01:00"
}
```

## Sync Engine (sync/engine.py)

### Архитектура

```
┌──────────────────────────────────────┐
│ KeyboardHelper (main thread, tkinter)│
│                                      │
│  root.after(60000) ──► trigger_sync  │
│                          │           │
│                          ▼           │
│  Thread(daemon=True) ► _do_sync()   │
│    ├── _push()  → POST /sync/push   │
│    ├── _pull()  → POST /sync/pull   │
│    └── root.after(0) → UI update    │
└──────────────────────────────────────┘
```

### Push логика

1. Запросить все записи с sync_status='pending' или 'deleted' из 6 таблиц
2. Отправить batch POST /sync/push
3. Успех → mark_as_synced() для принятых записей
4. Для deleted записей, подтверждённых сервером → purge_deleted() (физическое удаление)
5. Конфликты → если server wins, оставить как есть (pull перезапишет)

### Pull логика

1. Прочитать last_sync_at из app_settings
2. POST /sync/pull с last_sync_at
3. Для каждой записи из ответа:
   - Нет локально → INSERT с sync_status='synced'
   - Есть, sync_status='synced' → UPDATE (сервер авторитетен)
   - Есть, sync_status='pending' → сравнить updated_at (last-write-wins)
   - is_deleted=true на сервере → удалить локально
4. Обновить last_sync_at = server_time

### Обработка ошибок

- Сервер недоступен → лог, статус "offline", повтор на следующем цикле
- Auth ошибка (401) → остановить sync, показать "Invalid API key"
- Большие payload (>1000 записей) → чанки по 500

### notes.folder_id across devices

- При push: клиент включает folder_uuid (по folder_id → uuid из note_folders)
- При pull: клиент резолвит folder_uuid → локальный folder_id

## Конфигурация

### .env клиента (новые поля, опциональные)

```
SYNC_API_URL=https://your-vps.example.com/api/v1
SYNC_API_KEY=
SYNC_USER_ID=
SYNC_ENABLED=0
SYNC_INTERVAL_SECONDS=60
```

### .env сервера

```
DATABASE_URL=postgresql+asyncpg://snippets_sync:password@postgres:5432/snippets_sync
SECRET_KEY=your-secret-key
API_HOST=0.0.0.0
API_PORT=8000
```

### requirements.txt клиента (добавить)

```
requests>=2.31.0
```

### api/requirements.txt (новый)

```
fastapi>=0.104.0
uvicorn>=0.24.0
sqlalchemy[asyncio]>=2.0.0
asyncpg>=0.29.0
pydantic>=2.5.0
python-dotenv>=1.0.0
alembic>=1.13.0
```

## Деплой (VPS 109.172.85.124)

### Совместное размещение с IsterApp

На сервере уже развёрнут бэкенд IsterApp (FastAPI + PostgreSQL + Nginx + Telegram-бот).
Snippets Helper API размещается рядом, переиспользуя общие ресурсы:

```
nginx (:80, :443 self-signed)
  ├── /api/v1/*           → isterapp_api (:8000)
  ├── /releases/, /uploads/
  ├── /snippets-api/*     → snippets_api (:8001)   ← НОВОЕ
  └── всё остальное       → isterapp_api
                ↓
          PostgreSQL (общий инстанс)
            ├── DB: isterapp
            └── DB: snippets_sync                    ← НОВОЕ
```

### Принципы совмещения

| Ресурс | Решение |
|--------|---------|
| PostgreSQL | Общий инстанс (`isterapp_db`), отдельная БД `snippets_sync`, отдельный юзер `snippets_sync` |
| Nginx | Общий (`isterapp_nginx`), добавляем `location /snippets-api/` + self-signed HTTPS на :443 |
| Docker network | snippets_api подключается к сети `backend_default` (сеть IsterApp) |
| Файловая система | Репозиторий в `/opt/snippets_helper/`, отдельно от `/opt/isterapp/` |
| Порты | snippets_api слушает :8001 (внутренний, не экспортируется наружу) |

### docker-compose.yml (snippets_helper)

Сервисы:
- **api**: FastAPI, 1 worker, порт 8001 (внутренний), подключён к сети `backend_default`
- **migrate**: Alembic миграции, запускается перед api

Не включает postgres и nginx — используются от IsterApp.

### Nginx — обновление конфига IsterApp

Добавить в `/opt/isterapp/backend/nginx/conf.d/isterapp.conf`:
- `location /snippets-api/` → `proxy_pass http://snippets_api:8001/`
- Self-signed сертификат для HTTPS на :443
- Порт 443 в `docker-compose.prod.yml` IsterApp

### PostgreSQL — создание БД

```sql
CREATE USER snippets_sync WITH PASSWORD '...';
CREATE DATABASE snippets_sync OWNER snippets_sync;
```

### api/Dockerfile

```dockerfile
FROM python:3.11-slim
WORKDIR /app
COPY api/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY api/ ./api/
COPY shared/ ./shared/
CMD ["uvicorn", "api.main:app", "--host", "0.0.0.0", "--port", "8001", "--workers", "1"]
```

### HTTPS (self-signed)

```bash
openssl req -x509 -nodes -days 3650 -newkey rsa:2048 \
  -keyout /opt/ssl/snippets.key -out /opt/ssl/snippets.crt \
  -subj "/CN=109.172.85.124"
```

### Регистрация self-signed сертификата на клиенте

Чтобы клиентское приложение (и `requests` в Python) доверяло self-signed сертификату сервера,
его нужно добавить в системное хранилище доверенных корневых сертификатов.

Сертификат (`snippets.crt`) скачивается с сервера один раз:
```bash
scp root@109.172.85.124:/opt/ssl/snippets.crt ~/snippets.crt
```

#### Windows

1. **Через командную строку (от администратора):**
```cmd
certutil -addstore "Root" %USERPROFILE%\snippets.crt
```

2. **Через GUI:**
   - Двойной клик по `snippets.crt`
   - "Установить сертификат..." → "Локальный компьютер"
   - "Поместить все сертификаты в следующее хранилище" → "Доверенные корневые центры сертификации"
   - Готово

3. **Проверка:**
```cmd
certutil -verify %USERPROFILE%\snippets.crt
```

4. **Удаление (при необходимости):**
```cmd
certutil -delstore "Root" "109.172.85.124"
```

#### macOS

1. **Через терминал:**
```bash
sudo security add-trusted-cert -d -r trustRoot \
  -k /Library/Keychains/System.keychain ~/snippets.crt
```

2. **Через GUI:**
   - Двойной клик по `snippets.crt` → откроется Keychain Access
   - Сертификат появится в "System" keychain
   - Двойной клик по сертификату → раздел "Trust"
   - "When using this certificate" → "Always Trust"
   - Закрыть (потребует пароль)

3. **Проверка:**
```bash
security verify-cert -c ~/snippets.crt
```

4. **Удаление (при необходимости):**
```bash
sudo security delete-certificate -c "109.172.85.124" /Library/Keychains/System.keychain
```

#### Python requests (альтернатива без системной регистрации)

Если не хочется регистрировать сертификат в системе, можно указать путь к `.crt` файлу
напрямую в sync клиенте через переменную окружения:
```
SYNC_CA_CERT=C:\Users\username\snippets.crt
```
При этом `requests` будет использовать его через параметр `verify`:
```python
self.session.verify = os.getenv("SYNC_CA_CERT", True)
```

### Доступ клиента

```
https://109.172.85.124/snippets-api/v1/health
https://109.172.85.124/snippets-api/v1/auth/register
https://109.172.85.124/snippets-api/v1/sync/push
https://109.172.85.124/snippets-api/v1/sync/pull
```

### Деплой и обновление

```bash
cd /opt/snippets_helper
git pull origin main
docker-compose up --build -d
```

## Фазы реализации

### Phase 1: Локальная инфраструктура (код уже написан, нужна проверка)
- shared/sync_schema.py
- sync/migration.py
- Модификация database.py (sync поля, Lock, soft-delete, новые методы)
- Обновление .env
- **Тест**: приложение работает как раньше, sync поля заполняются

### Phase 2: API сервер (код уже написан, нужна проверка)
- api/ — FastAPI + SQLAlchemy + Alembic
- PostgreSQL схема
- Эндпоинты: push, pull, register, health
- Dockerfile + docker-compose
- **Тест**: API отвечает, тесты pytest + httpx проходят

### Phase 3: Sync engine (клиент, код уже написан, нужна проверка)
- sync/client.py — HTTP клиент
- sync/engine.py — SyncEngine с таймером
- Интеграция в main.py
- Sync status в UI
- **Тест**: данные синхронизируются между двумя клиентами

### Phase 4: Деплой на VPS
- Адаптация docker-compose.yml под совместное размещение с IsterApp
- Создание БД и юзера в общем PostgreSQL
- Обновление nginx конфига IsterApp (location + HTTPS)
- Self-signed сертификат
- Git clone на сервер + docker-compose up
- **Тест**: API доступен по https://109.172.85.124/snippets-api/v1/health

## Риски и решения

| Риск | Решение |
|------|---------|
| sql_table_analyzer_templates: delete-all/reinsert паттерн | Рефакторинг в upsert + soft-delete, сохранить порядок через id |
| DuckDB single-writer (UI + sync thread) | threading.Lock в Database class |
| notes.folder_id FK across devices | folder_uuid на сервере, резолвинг при pull |
| Первый sync с existing data | Миграция: uuid + sync_status='pending' → всё пушится |
| Soft-delete bloat | purge_deleted() после подтверждённого push |
