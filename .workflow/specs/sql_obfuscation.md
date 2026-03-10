# SQL Obfuscation - Спецификация

## Описание
Функционал обфускации SQL запросов и DAG-файлов Airflow. Позволяет заменять названия таблиц, схем, колонок, DAG/Task ID и литералов на обезличенные значения.

## Решения

| Аспект | Решение |
|--------|---------|
| Генерация имён | Последовательная (`obj_001`, `sch_001`, `col_001`...) |
| Схема | Обфусцируется отдельно |
| Таблицы/словари | Общий префикс `obj_` |
| История | БД + экспорт JSON/CSV |
| Колонки | Только из SELECT |
| Литералы | Фильтровать даты, LIKE-паттерны, числа |
| Имя сессии | Автогенерация (`session_YYYY-MM-DD_HH-MM`) |
| Загрузка маппинга | В таблицу соответствий → применить вручную |

## Структура файлов

```
handlers/
├── sql_parser.py          (существующий)
└── sql_obfuscator.py      (новый — логика парсинга и замены)

main.py                    (добавить вкладку Obfuscation)
database.py                (добавить методы для obfuscation_mappings)
```

## Таблица БД

```sql
CREATE TABLE obfuscation_mappings (
    id INTEGER PRIMARY KEY,
    session_name VARCHAR NOT NULL,
    entity_type VARCHAR NOT NULL,  -- schema/table/column/dag/task/literal
    original_value VARCHAR NOT NULL,
    obfuscated_value VARCHAR NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

## Модуль sql_obfuscator.py

### Функции

| Функция | Описание |
|---------|----------|
| `extract_entities(code: str)` | Возвращает dict с найденными сущностями по категориям |
| `generate_obfuscated_names(entities: dict)` | Генерирует замены (obj_001, col_001...) |
| `apply_replacements(code: str, mappings: list)` | Применяет замены к тексту |
| `export_to_json(mappings, filepath)` | Экспорт в JSON |
| `export_to_csv(mappings, filepath)` | Экспорт в CSV |
| `load_from_file(filepath)` | Загрузка маппинга из файла |

### Паттерны парсинга

| Сущность | Regex | Результат |
|----------|-------|-----------|
| Схема+таблица | `(?:from\|join)\s+(\w+)\.(\w+)` | schema, table отдельно |
| Словари | `dictGet\('(\w+)\.(\w+)'` | schema, dict отдельно |
| Колонки | `SELECT\s+(.+?)\s+FROM` → split по `,` | список колонок |
| DAG ID | `dag_id\s*=\s*['"]([^'"]+)['"]` | имя DAG |
| Task ID | `task_id\s*=\s*['"]([^'"]+)['"]` | имя task |
| Литералы | `'([^']{4,})'` + фильтрация | строки > 3 символов |

### Фильтрация литералов (исключаем)
- Даты: `\d{4}-\d{2}-\d{2}`
- LIKE-паттерны: содержат `%` или `_`
- Числа в кавычках: `^\d+$`
- SQL keywords: `NULL`, `TRUE`, `FALSE`

## UI

Новая подвкладка "Obfuscation" на вкладке SQL.

### Компоненты
- Input: tk.Text для исходного кода
- Кнопка "Найти сущности"
- LabelFrame'ы со scrollable списками для каждой категории (Checkbutton + Entry)
- Кнопка "Применить замены"
- Menubutton "Сохранить" (В БД / JSON / CSV)
- Output: tk.Text (readonly) для результата
- Кнопки "Copy" и "Загрузить маппинг"

## Методы database.py

```python
def save_obfuscation_mapping(self, session_name, mappings: list[dict])
def get_obfuscation_sessions(self) -> list[str]
def get_obfuscation_mapping(self, session_name) -> list[dict]
def delete_obfuscation_session(self, session_name)
```
