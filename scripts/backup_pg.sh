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
