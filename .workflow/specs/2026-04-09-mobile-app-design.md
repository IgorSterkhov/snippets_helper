# Mobile App — Snippets Helper

## Обзор

Мобильное Android-приложение на React Native с модулями Сниппетов и Заметок.
Полная офлайн-работа с синхронизацией через существующий API.
Self-hosted OTA-обновления JS-бандла без необходимости скачивать APK.

## Требования

- **Платформа:** Android
- **Фреймворк:** React Native
- **Модули:** Сниппеты (shortcuts + snippet_tags), Заметки (notes + note_folders)
- **Авторизация:** API-ключ (ручной ввод + QR-сканер), Fingerprint для быстрого входа
- **Офлайн:** полный — локальная SQLite + синхронизация при появлении сети
- **Обновления:** self-hosted OTA через `react-native-ota-hot-update`
- **Распространение:** APK-файл (без Google Play)
- **Тема:** светлая + тёмная, переключатель в настройках
- **Push-уведомления:** FCM заготовка (активация позже)

## Структура проекта

```
mobile/
├── src/
│   ├── api/              # HTTP-клиент, эндпоинты
│   ├── auth/             # Авторизация, fingerprint, QR
│   ├── db/               # SQLite схема, миграции, CRUD
│   ├── sync/             # Push/pull логика
│   ├── screens/
│   │   ├── Snippets/     # Список + детали + редактор
│   │   ├── Notes/        # Папки + заметки + редактор
│   │   ├── Settings/     # API-ключ, тема, about
│   │   └── Auth/         # Ввод ключа / QR-сканер
│   ├── components/       # Общие компоненты (SearchBar, Toast и т.д.)
│   ├── theme/            # Светлая/тёмная тема
│   ├── updater/          # OTA-обновления
│   └── navigation/       # Навигация (табы)
├── android/
└── package.json
```

## Навигация

Нижние табы:
- **Snippets** — список сниппетов с поиском и фильтрацией по тегам
- **Notes** — дерево папок + заметки с markdown-превью
- **Settings** — API-ключ, тема, обновления, fingerprint

## Локальная БД (SQLite)

Таблицы зеркалят серверные модели (см. `api/models.py`):

### shortcuts
- uuid, name, value, description, links, obsidian_note, updated_at, is_deleted

### notes
- uuid, folder_uuid, title, content, created_at, updated_at, is_pinned, is_deleted

### note_folders
- uuid, name, sort_order, parent_id, updated_at, is_deleted

### snippet_tags
- uuid, name, patterns, color, sort_order, updated_at, is_deleted

### sync_meta
- last_sync_at — timestamp последней успешной синхронизации

## Синхронизация

Используем существующий API: `POST /v1/sync/push`, `POST /v1/sync/pull`.

### Flow
1. Приложение открывается / возвращается из фона / появляется сеть
2. Pull — запрос изменений с сервера (last_sync_at)
3. Применить полученные изменения к локальной SQLite
4. Push — отправить локальные изменения на сервер
5. Обновить last_sync_at

### Разрешение конфликтов
- Last-write-wins (как в десктопе)

### Триггеры синка
- Запуск приложения
- Возврат из фона
- Появление сети (Network listener)
- Pull-to-refresh (ручной)

## Авторизация

### Первый вход
- Экран с двумя вариантами: ввод API-ключа вручную / QR-сканер
- QR-код генерируется в десктопном приложении (Settings)

### Хранение ключа
- API-ключ сохраняется в Android Keystore (шифрованное хранилище)

### Fingerprint
- После первого входа — опция включить биометрию в Settings
- При следующих запусках — fingerprint вместо ввода ключа
- Библиотека: `react-native-biometrics`

## OTA-обновления

### Библиотека
- `react-native-ota-hot-update`

### Хостинг бандлов
- Сервер: 109.172.85.124 (тот же что API)
- Файлы: `/updates/latest.json` + `/updates/bundle-{version}.zip`

### API для проверки обновлений
- Эндпоинт (или статический JSON): возвращает текущую версию + URL бандла

### Flow обновления
1. Проверка при запуске приложения
2. Если есть новая версия — баннер "Доступно обновление v{X.Y.Z}"
3. Кнопка "Обновить" → прогресс-бар скачивания
4. Распаковка в internal storage
5. Перезапуск приложения с новым бандлом

## Push-уведомления (FCM)

- Firebase SDK включён в APK
- При запуске регистрируется FCM-токен
- Обработчик входящих уведомлений — заглушка
- Активация и использование — в будущем по необходимости

## Тема

- Две темы: светлая и тёмная
- Переключатель в Settings
- Выбор сохраняется в AsyncStorage
- Визуальный стиль приближен к десктопному приложению

## Ключевые библиотеки

- `react-native` — фреймворк
- `react-native-sqlite-storage` — локальная БД
- `react-native-biometrics` — fingerprint
- `react-native-camera` (или `react-native-vision-camera`) — QR-сканер
- `react-native-ota-hot-update` — OTA-обновления
- `@react-native-firebase/messaging` — FCM
- `@react-navigation/bottom-tabs` — навигация
- `react-native-markdown-display` — рендер markdown
