# Snippets Helper API — Deploy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Завершить доработку API и развернуть его на сервере 109.172.85.124 рядом с IsterApp.

**Architecture:** Snippets Helper API (FastAPI, 1 worker, порт 8001) подключается к существующей Docker-сети IsterApp (`backend_default`), использует общий PostgreSQL (отдельная БД `snippets_sync`) и общий Nginx (location `/snippets-api/`). HTTPS через self-signed сертификат.

**Tech Stack:** FastAPI, SQLAlchemy async, asyncpg, PostgreSQL 16, Alembic, Docker Compose, Nginx, self-signed TLS

**Spec:** `.workflow/specs/api_sync.md`

---

### Task 1: Адаптировать API prefix для работы за reverse proxy

Сейчас API использует prefix `/api/v1`, но за nginx с `location /snippets-api/` клиент будет обращаться к `/snippets-api/v1/...`. Nginx стрипает `/snippets-api/` и передаёт `/v1/...` на бэкенд. Значит prefix нужно поменять на `/v1`.

**Files:**
- Modify: `api/main.py`

- [ ] **Step 1: Обновить prefix роутеров и health endpoint**

В `api/main.py` заменить `/api/v1` на `/v1`:

```python
from fastapi import FastAPI
from api.routes import auth, sync

app = FastAPI(title="Snippets Helper Sync API", version="1.0.0")

app.include_router(auth.router, prefix="/v1")
app.include_router(sync.router, prefix="/v1")


@app.get("/v1/health")
async def health():
    return {"status": "ok"}
```

- [ ] **Step 2: Обновить порт в конфиге**

В `api/config.py` изменить дефолтный порт на 8001:

```python
API_PORT = int(os.getenv("API_PORT", "8001"))
```

- [ ] **Step 3: Commit**

```bash
git add api/main.py api/config.py
git commit -m "api: change prefix to /v1, port to 8001"
```

---

### Task 2: Переписать docker-compose.yml для совместного размещения

Текущий `docker-compose.yml` содержит свои postgres и nginx. Нужно убрать их и подключиться к сети IsterApp.

**Files:**
- Modify: `docker-compose.yml`
- Modify: `api/Dockerfile`

- [ ] **Step 1: Переписать docker-compose.yml**

```yaml
services:
  migrate:
    build:
      context: .
      dockerfile: api/Dockerfile
    container_name: snippets_migrate
    command: ["python", "-m", "alembic", "-c", "api/alembic/alembic.ini", "upgrade", "head"]
    environment:
      DATABASE_URL: postgresql+asyncpg://snippets_sync:${POSTGRES_PASSWORD}@isterapp_db:5432/snippets_sync
    networks:
      - isterapp_net
    restart: "no"

  api:
    build:
      context: .
      dockerfile: api/Dockerfile
    container_name: snippets_api
    environment:
      DATABASE_URL: postgresql+asyncpg://snippets_sync:${POSTGRES_PASSWORD}@isterapp_db:5432/snippets_sync
      SECRET_KEY: ${SECRET_KEY:-change-me-in-production}
    expose:
      - "8001"
    networks:
      - isterapp_net
    depends_on:
      migrate:
        condition: service_completed_successfully
    restart: unless-stopped

networks:
  isterapp_net:
    external: true
    name: backend_default
```

- [ ] **Step 2: Обновить Dockerfile — порт 8001, 1 worker**

```dockerfile
FROM python:3.11-slim

WORKDIR /app

COPY api/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY api/ ./api/
COPY shared/ ./shared/

CMD ["uvicorn", "api.main:app", "--host", "0.0.0.0", "--port", "8001", "--workers", "1"]
```

- [ ] **Step 3: Создать .env.production.example для сервера**

Создать файл `.env.production.example`:

```
POSTGRES_PASSWORD=CHANGE_ME
SECRET_KEY=CHANGE_ME
```

- [ ] **Step 4: Commit**

```bash
git add docker-compose.yml api/Dockerfile .env.production.example
git commit -m "docker: adapt for co-deployment with IsterApp"
```

---

### Task 3: Удалить старый nginx.conf

Файл `nginx.conf` в корне проекта больше не нужен — nginx управляется из IsterApp.

**Files:**
- Delete: `nginx.conf`

- [ ] **Step 1: Удалить nginx.conf**

```bash
git rm nginx.conf
```

- [ ] **Step 2: Commit**

```bash
git commit -m "remove standalone nginx.conf"
```

---

### Task 4: Добавить поддержку self-signed сертификата в sync клиент

`sync/client.py` должен поддерживать переменную `SYNC_CA_CERT` для указания пути к `.crt` файлу.

**Files:**
- Modify: `sync/client.py`
- Modify: `.env.example`

- [ ] **Step 1: Обновить SyncClient — добавить параметр verify**

```python
"""HTTP client for communicating with the Snippets Helper Sync API."""
import os
import requests
from typing import Optional


class SyncClient:
    def __init__(self, api_url: str, api_key: str, timeout: int = 30):
        self.api_url = api_url.rstrip("/")
        self.timeout = timeout
        self.session = requests.Session()
        self.session.headers.update({
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        })
        # Support self-signed certificates via SYNC_CA_CERT env var
        ca_cert = os.getenv("SYNC_CA_CERT")
        if ca_cert and os.path.isfile(ca_cert):
            self.session.verify = ca_cert

    def health(self) -> bool:
        """Check if server is reachable."""
        try:
            r = self.session.get(f"{self.api_url}/health", timeout=5)
            return r.status_code == 200
        except Exception:
            return False

    def register(self, name: str) -> dict:
        """Register a new user. Returns {user_id, api_key, name}."""
        r = self.session.post(
            f"{self.api_url}/auth/register",
            json={"name": name},
            timeout=self.timeout,
        )
        r.raise_for_status()
        return r.json()

    def check_auth(self) -> Optional[dict]:
        """Verify API key. Returns user info or None."""
        try:
            r = self.session.get(f"{self.api_url}/auth/me", timeout=self.timeout)
            if r.status_code == 200:
                return r.json()
            return None
        except Exception:
            return None

    def push(self, changes: dict) -> dict:
        """Push local changes to server."""
        r = self.session.post(
            f"{self.api_url}/sync/push",
            json={"changes": changes},
            timeout=self.timeout,
        )
        r.raise_for_status()
        return r.json()

    def pull(self, last_sync_at: Optional[str] = None) -> dict:
        """Pull changes from server since last_sync_at."""
        r = self.session.post(
            f"{self.api_url}/sync/pull",
            json={"last_sync_at": last_sync_at},
            timeout=self.timeout,
        )
        r.raise_for_status()
        return r.json()
```

- [ ] **Step 2: Обновить .env.example**

```
DUCKDB_PATH="path/to/your/duckdb"

# Sync settings (optional, leave empty to disable sync)
SYNC_API_URL=
SYNC_API_KEY=
SYNC_USER_ID=
SYNC_ENABLED=0
SYNC_INTERVAL_SECONDS=60

# Path to self-signed certificate (optional, for HTTPS with self-signed cert)
SYNC_CA_CERT=
```

- [ ] **Step 3: Commit**

```bash
git add sync/client.py .env.example
git commit -m "sync: add self-signed cert support via SYNC_CA_CERT"
```

---

### Task 5: Обновить backup скрипт под общий PostgreSQL

Скрипт `scripts/backup_pg.sh` ссылается на контейнер `snippets_helper-postgres-1`, но теперь PostgreSQL — это `isterapp_db`.

**Files:**
- Modify: `scripts/backup_pg.sh`

- [ ] **Step 1: Обновить backup скрипт**

```bash
#!/bin/bash
# PostgreSQL backup script for snippets_sync
# Add to cron: 0 3 * * * /opt/snippets_helper/scripts/backup_pg.sh

BACKUP_DIR="/opt/snippets_helper/backups"
CONTAINER="isterapp_db"
DB_NAME="snippets_sync"
DB_USER="snippets_sync"
DATE=$(date +%Y%m%d_%H%M%S)
KEEP_DAYS=7

mkdir -p "$BACKUP_DIR"

# Create backup
docker exec "$CONTAINER" pg_dump -U "$DB_USER" "$DB_NAME" | gzip > "$BACKUP_DIR/backup_${DATE}.sql.gz"

# Remove old backups
find "$BACKUP_DIR" -name "backup_*.sql.gz" -mtime +$KEEP_DAYS -delete

echo "Backup completed: backup_${DATE}.sql.gz"
```

- [ ] **Step 2: Commit**

```bash
git add scripts/backup_pg.sh
git commit -m "backup: update for shared PostgreSQL container"
```

---

### Task 6: Закоммитить все оставшиеся незакоммиченные изменения

По git status есть незакоммиченные файлы: изменения в `database.py`, `main.py`, `requirements.txt`, `TASKS/SH-TASK-1.md`, и новые директории `api/`, `shared/`, `sync/`, `scripts/`.

**Files:**
- All uncommitted changes

- [ ] **Step 1: Проверить git status**

```bash
git status
```

- [ ] **Step 2: Добавить все новые и изменённые файлы**

```bash
git add api/ shared/ sync/ scripts/ database.py main.py requirements.txt .env.example TASKS/SH-TASK-1.md .workflow/
```

- [ ] **Step 3: Commit**

```bash
git commit -m "add sync API, client engine, and deployment configs"
```

- [ ] **Step 4: Push в remote**

```bash
git push origin main
```

---

### Task 7: Создать БД и пользователя в PostgreSQL на сервере

Подключиться к существующему PostgreSQL (`isterapp_db`) и создать БД `snippets_sync` с отдельным пользователем.

- [ ] **Step 1: Создать пользователя и БД**

```bash
ssh root@109.172.85.124 "docker exec -i isterapp_db psql -U isterapp -d isterapp -c \"
CREATE USER snippets_sync WITH PASSWORD '<PASSWORD>';
CREATE DATABASE snippets_sync OWNER snippets_sync;
GRANT ALL PRIVILEGES ON DATABASE snippets_sync TO snippets_sync;
\""
```

Заменить `<PASSWORD>` на сгенерированный пароль.

- [ ] **Step 2: Проверить подключение**

```bash
ssh root@109.172.85.124 "docker exec -i isterapp_db psql -U snippets_sync -d snippets_sync -c 'SELECT 1;'"
```

Expected: `1` (одна строка)

---

### Task 8: Сгенерировать self-signed сертификат на сервере

- [ ] **Step 1: Создать директорию и сгенерировать сертификат**

```bash
ssh root@109.172.85.124 "mkdir -p /opt/ssl && openssl req -x509 -nodes -days 3650 -newkey rsa:2048 -keyout /opt/ssl/snippets.key -out /opt/ssl/snippets.crt -subj '/CN=109.172.85.124'"
```

- [ ] **Step 2: Проверить сертификат**

```bash
ssh root@109.172.85.124 "openssl x509 -in /opt/ssl/snippets.crt -noout -subject -dates"
```

Expected: `subject=CN = 109.172.85.124`, срок действия 10 лет.

---

### Task 9: Обновить nginx конфиг IsterApp — добавить /snippets-api/ и HTTPS

**Files на сервере:**
- Modify: `/opt/isterapp/backend/nginx/conf.d/isterapp.conf`

- [ ] **Step 1: Обновить nginx конфиг**

Заменить содержимое `/opt/isterapp/backend/nginx/conf.d/isterapp.conf`:

```nginx
server {
    listen 80;
    server_name _;

    add_header X-Content-Type-Options nosniff;
    add_header X-Frame-Options DENY;

    location /releases/ {
        alias /opt/isterapp/releases/;
        autoindex off;
        types {
            application/vnd.android.package-archive apk;
        }
    }

    location /uploads/ {
        alias /opt/isterapp/uploads/;
        autoindex off;
        expires 7d;
        add_header Cache-Control "public, immutable";
        types {
            image/jpeg jpg jpeg;
            image/png png;
        }
        default_type application/octet-stream;
    }

    client_max_body_size 10M;

    location /snippets-api/ {
        proxy_pass http://snippets_api:8001/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location / {
        proxy_pass http://api:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

server {
    listen 443 ssl;
    server_name _;

    ssl_certificate /opt/ssl/snippets.crt;
    ssl_certificate_key /opt/ssl/snippets.key;

    add_header X-Content-Type-Options nosniff;
    add_header X-Frame-Options DENY;

    client_max_body_size 10M;

    location /snippets-api/ {
        proxy_pass http://snippets_api:8001/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /releases/ {
        alias /opt/isterapp/releases/;
        autoindex off;
        types {
            application/vnd.android.package-archive apk;
        }
    }

    location /uploads/ {
        alias /opt/isterapp/uploads/;
        autoindex off;
        expires 7d;
        add_header Cache-Control "public, immutable";
        types {
            image/jpeg jpg jpeg;
            image/png png;
        }
        default_type application/octet-stream;
    }

    location / {
        proxy_pass http://api:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

---

### Task 10: Обновить IsterApp docker-compose.prod.yml — порт 443, SSL volumes

**Files на сервере:**
- Modify: `/opt/isterapp/backend/docker-compose.prod.yml`

- [ ] **Step 1: Добавить порт 443 и SSL volume в nginx сервис**

В секции `nginx` заменить:

```yaml
    ports:
      - "80:80"
```

на:

```yaml
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro
      - ./nginx/conf.d:/etc/nginx/conf.d:ro
      - /opt/isterapp/releases:/opt/isterapp/releases:ro
      - /opt/isterapp/uploads:/opt/isterapp/uploads:ro
      - /opt/ssl:/opt/ssl:ro
```

Примечание: volume `/opt/ssl:/opt/ssl:ro` добавляется к уже существующим volumes.

- [ ] **Step 2: Перезапустить IsterApp nginx**

```bash
ssh root@109.172.85.124 "cd /opt/isterapp/backend && docker-compose -f docker-compose.prod.yml up -d nginx"
```

- [ ] **Step 3: Проверить что IsterApp по-прежнему работает**

```bash
ssh root@109.172.85.124 "curl -s http://localhost/api/v1/health"
```

Expected: `{"status":"ok"}` или аналогичный ответ от IsterApp.

---

### Task 11: Клонировать репозиторий и запустить snippets_helper API на сервере

- [ ] **Step 1: Клонировать репозиторий**

```bash
ssh root@109.172.85.124 "git clone <REPO_URL> /opt/snippets_helper"
```

Если репозиторий приватный — настроить SSH-ключ или токен.

- [ ] **Step 2: Создать .env файл на сервере**

```bash
ssh root@109.172.85.124 "cat > /opt/snippets_helper/.env << 'EOF'
POSTGRES_PASSWORD=<PASSWORD_FROM_TASK_7>
SECRET_KEY=$(openssl rand -hex 32)
EOF"
```

- [ ] **Step 3: Запустить docker-compose**

```bash
ssh root@109.172.85.124 "cd /opt/snippets_helper && docker-compose up --build -d"
```

- [ ] **Step 4: Проверить что контейнеры запустились**

```bash
ssh root@109.172.85.124 "docker ps --filter 'name=snippets' --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'"
```

Expected: `snippets_api` — Up, `snippets_migrate` — Exited (0).

---

### Task 12: Проверить что nginx видит snippets_api

После запуска snippets_api в сети `backend_default`, nginx должен уметь резолвить `snippets_api:8001`.

- [ ] **Step 1: Перезагрузить nginx чтобы подхватил новый upstream**

```bash
ssh root@109.172.85.124 "docker exec isterapp_nginx nginx -s reload"
```

- [ ] **Step 2: Тест health endpoint через nginx (HTTP)**

```bash
ssh root@109.172.85.124 "curl -s http://localhost/snippets-api/v1/health"
```

Expected: `{"status":"ok"}`

- [ ] **Step 3: Тест health endpoint через nginx (HTTPS)**

```bash
ssh root@109.172.85.124 "curl -sk https://localhost/snippets-api/v1/health"
```

Expected: `{"status":"ok"}`

- [ ] **Step 4: Тест с внешнего IP**

```bash
curl -sk https://109.172.85.124/snippets-api/v1/health
```

Expected: `{"status":"ok"}`

---

### Task 13: End-to-end тест API

- [ ] **Step 1: Регистрация пользователя**

```bash
curl -sk -X POST https://109.172.85.124/snippets-api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name": "test_user"}'
```

Expected: `{"user_id":"...","api_key":"...","name":"test_user"}`

Сохранить `api_key` из ответа.

- [ ] **Step 2: Проверка авторизации**

```bash
curl -sk https://109.172.85.124/snippets-api/v1/auth/me \
  -H "Authorization: Bearer <API_KEY>"
```

Expected: `{"user_id":"...","name":"test_user","created_at":"..."}`

- [ ] **Step 3: Push тестовых данных**

```bash
curl -sk -X POST https://109.172.85.124/snippets-api/v1/sync/push \
  -H "Authorization: Bearer <API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "changes": {
      "shortcuts": [{
        "uuid": "11111111-1111-1111-1111-111111111111",
        "id": 1,
        "name": "test shortcut",
        "value": "SELECT 1",
        "description": "test",
        "updated_at": "2026-04-01T12:00:00",
        "is_deleted": false
      }]
    }
  }'
```

Expected: `{"status":"ok","accepted":1,"conflicts":[]}`

- [ ] **Step 4: Pull данных**

```bash
curl -sk -X POST https://109.172.85.124/snippets-api/v1/sync/pull \
  -H "Authorization: Bearer <API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"last_sync_at": null}'
```

Expected: ответ содержит `shortcuts` с тестовой записью.

- [ ] **Step 5: Удалить тестового пользователя (опционально)**

```bash
ssh root@109.172.85.124 "docker exec -i isterapp_db psql -U snippets_sync -d snippets_sync -c \"DELETE FROM shortcuts; DELETE FROM users;\""
```

---

### Task 14: Настроить backup по cron

- [ ] **Step 1: Сделать скрипт исполняемым**

```bash
ssh root@109.172.85.124 "chmod +x /opt/snippets_helper/scripts/backup_pg.sh"
```

- [ ] **Step 2: Добавить в crontab**

```bash
ssh root@109.172.85.124 "(crontab -l 2>/dev/null; echo '0 3 * * * /opt/snippets_helper/scripts/backup_pg.sh >> /var/log/snippets_backup.log 2>&1') | crontab -"
```

- [ ] **Step 3: Тестовый запуск**

```bash
ssh root@109.172.85.124 "/opt/snippets_helper/scripts/backup_pg.sh"
```

Expected: `Backup completed: backup_YYYYMMDD_HHMMSS.sql.gz`

- [ ] **Step 4: Проверить файл бэкапа**

```bash
ssh root@109.172.85.124 "ls -lh /opt/snippets_helper/backups/"
```
