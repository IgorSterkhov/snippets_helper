# Требования к API для работы с базой данных Keyboard Helper

## Общее описание
Необходимо создать API для работы с базой данных DuckDB, которое будет обрабатывать все операции с записями (shortcuts). API должно быть реализовано с использованием FastAPI и обеспечивать следующие функции.

## Технические требования

### 1. База данных
- Использовать DuckDB в качестве базы данных
- Путь к базе данных должен быть настраиваемым через переменные окружения
- Структура таблицы shortcuts:
  ```sql
  CREATE TABLE shortcuts (
      id INTEGER PRIMARY KEY,
      name VARCHAR NOT NULL,
      value TEXT NOT NULL,
      description TEXT
  )
  ```

### 2. API Endpoints

#### 2.1 Получение всех записей
- **Endpoint**: GET /api/shortcuts
- **Описание**: Возвращает список всех записей
- **Ответ**: JSON массив объектов с полями id, name, value, description
- **Пример ответа**:
  ```json
  [
    {
      "id": 1,
      "name": "Example",
      "value": "Example value",
      "description": "Example description"
    }
  ]
  ```

#### 2.2 Получение записи по ID
- **Endpoint**: GET /api/shortcuts/{id}
- **Описание**: Возвращает запись по указанному ID
- **Параметры**: id (integer)
- **Ответ**: JSON объект с полями id, name, value, description
- **Ошибки**: 404 если запись не найдена

#### 2.3 Создание новой записи
- **Endpoint**: POST /api/shortcuts
- **Описание**: Создает новую запись
- **Тело запроса**: JSON объект с полями name, value, description
- **Ответ**: JSON объект созданной записи с полем id
- **Ошибки**: 400 при неверных данных

#### 2.4 Обновление записи
- **Endpoint**: PUT /api/shortcuts/{id}
- **Описание**: Обновляет существующую запись
- **Параметры**: id (integer)
- **Тело запроса**: JSON объект с полями name, value, description
- **Ответ**: JSON объект обновленной записи
- **Ошибки**: 404 если запись не найдена, 400 при неверных данных

#### 2.5 Удаление записи
- **Endpoint**: DELETE /api/shortcuts/{id}
- **Описание**: Удаляет запись по ID
- **Параметры**: id (integer)
- **Ответ**: 204 No Content при успешном удалении
- **Ошибки**: 404 если запись не найдена

### 3. Модели данных

#### ShortcutCreate
```python
class ShortcutCreate(BaseModel):
    name: str
    value: str
    description: str | None = None
```

#### ShortcutUpdate
```python
class ShortcutUpdate(BaseModel):
    name: str
    value: str
    description: str | None = None
```

#### ShortcutResponse
```python
class ShortcutResponse(BaseModel):
    id: int
    name: str
    value: str
    description: str | None = None
```

### 4. Обработка ошибок
- Все ошибки должны возвращаться в формате JSON
- Стандартные HTTP коды ошибок
- Структура ответа с ошибкой:
  ```json
  {
    "error": "Error message",
    "detail": "Detailed error description"
  }
  ```

### 5. Безопасность
- Добавить базовую аутентификацию
- Использовать HTTPS
- Валидация входных данных
- Обработка SQL-инъекций

### 6. Документация
- Автоматическая генерация Swagger/OpenAPI документации
- Описание всех endpoints
- Примеры запросов и ответов
- Описание моделей данных

### 7. Тестирование
- Unit тесты для всех endpoints
- Тесты валидации данных
- Тесты обработки ошибок
- Интеграционные тесты с базой данных

### 8. Логирование
- Логирование всех запросов
- Логирование ошибок
- Логирование операций с базой данных

### 9. Конфигурация
- Настройка через переменные окружения:
  - DUCKDB_PATH: путь к файлу базы данных
  - API_HOST: хост для запуска API
  - API_PORT: порт для запуска API
  - DEBUG: режим отладки
  - SECRET_KEY: ключ для аутентификации

### 10. Зависимости
- FastAPI
- DuckDB
- Python-dotenv
- Pydantic
- Uvicorn
- Pytest (для тестирования)

## Пример использования API

### Запуск сервера
```bash
uvicorn api.main:app --host 0.0.0.0 --port 8000
```

### Примеры запросов

#### Получение всех записей
```bash
curl -X GET "http://localhost:8000/api/shortcuts"
```

#### Создание новой записи
```bash
curl -X POST "http://localhost:8000/api/shortcuts" \
     -H "Content-Type: application/json" \
     -d '{"name": "New Shortcut", "value": "New Value", "description": "New Description"}'
```

#### Обновление записи
```bash
curl -X PUT "http://localhost:8000/api/shortcuts/1" \
     -H "Content-Type: application/json" \
     -d '{"name": "Updated Shortcut", "value": "Updated Value", "description": "Updated Description"}'
```

#### Удаление записи
```bash
curl -X DELETE "http://localhost:8000/api/shortcuts/1"
``` 