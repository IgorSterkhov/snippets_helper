// Help text for SQL sub-tabs — plain HTML strings rendered inside the
// shared help modal. Kept separate from UI code to keep each tab file lean.

// ─────────────────────────── Table Analyzer ───────────────────────────

export const ANALYZER_HELP_HTML = `
<p><strong>Table Analyzer</strong> — генератор готовых SELECT-запросов для
быстрого исследования ClickHouse-таблицы по её DDL. Вставил CREATE&nbsp;TABLE,
нажал Analyze — получил пачку SQL для оценки объёма, заполненности полей
и произвольных метрик (uniques, max, min и т.п.).</p>

<h4>Что попадает в результат</h4>
<ol>
  <li><strong>Total rows + max row_version</strong> — сколько строк подходит
      под фильтр и максимум по полю версии. Сразу видно объём и свежесть.</li>
  <li><strong>Counts per field</strong> — для каждого поля
      <code>count(field)</code> и процент не-NULL от общего числа.
      Помогает найти пустые/редко заполненные колонки.</li>
  <li><strong>Template-based queries</strong> — твои шаблоны, раскрученные
      по всем полям таблицы (row_version пропускается).</li>
</ol>

<h4>Поля формы</h4>
<ul>
  <li><strong>DDL</strong> — CREATE&nbsp;TABLE ClickHouse.
      <code>IF&nbsp;NOT&nbsp;EXISTS</code>, <code>ENGINE</code>,
      <code>PARTITION&nbsp;BY</code> и пр. — можно оставить.</li>
  <li><strong>Filter</strong> — обязателен, должен начинаться с
      <code>WHERE</code>. Чаще всего <code>WHERE&nbsp;True</code> или
      <code>WHERE&nbsp;dt&nbsp;&gt;=&nbsp;today()&nbsp;-&nbsp;7</code>.</li>
  <li><strong>Field for row_version</strong> — имя поля-версии строки
      (по умолчанию <code>row_version</code>). Участвует в запросе №1
      и пропускается в шаблонах.</li>
  <li><strong>FORMAT Vertical</strong> — добавляет
      <code>FORMAT&nbsp;Vertical</code> в конец запросов (удобно смотреть
      в <code>clickhouse-client</code>, когда колонок много).</li>
  <li><strong>Analyzer Templates</strong> — сохраняемые шаблоны выражений.
      Добавляются через <strong>+&nbsp;Add</strong>, хранятся в БД приложения,
      доступны во всех сессиях.</li>
</ul>

<h4>Синтаксис шаблонов</h4>
<ul>
  <li><code>&lt;field&gt;</code> — подставляется имя каждой колонки по очереди.</li>
  <li><code>&lt;field_for_row_version&gt;</code> — подставляется имя row-version-поля.</li>
</ul>
<p>Примеры выражений:</p>
<ul>
  <li><code>count(distinct &lt;field&gt;) AS uniq_&lt;field&gt;</code> — уникальные значения</li>
  <li><code>max(&lt;field&gt;) AS max_&lt;field&gt;</code> — максимум</li>
  <li><code>argMax(&lt;field&gt;, &lt;field_for_row_version&gt;) AS last_&lt;field&gt;</code> — последнее значение</li>
</ul>

<hr />

<h4>Пример</h4>

<h5>DDL на входе</h5>
<pre><code>CREATE TABLE db.users (
  id Int64,
  name String,
  email String,
  row_version Int64
) ENGINE = MergeTree() ORDER BY id</code></pre>

<h5>Filter</h5>
<pre><code>WHERE True</code></pre>

<h5>Шаблон</h5>
<pre><code>count(distinct &lt;field&gt;) AS uniq_&lt;field&gt;</code></pre>

<h5>Результат</h5>
<pre><code>-- 1) Total rows and max row_version
SELECT
    count() AS total_rows
  , max(row_version) AS max_row_version
FROM db.users
WHERE True
;

-- 2) Counts per field with percentage from total
SELECT
    count() AS total_rows
  , count(id)    AS cnt_id
  , round(100.0 * count(id)    / nullif(count(), 0), 2) AS pct_id
  , count(name)  AS cnt_name
  , round(100.0 * count(name)  / nullif(count(), 0), 2) AS pct_name
  , count(email) AS cnt_email
  , round(100.0 * count(email) / nullif(count(), 0), 2) AS pct_email
FROM db.users
WHERE True
FORMAT Vertical
;

-- 3) Template-based queries
-- Template: count(distinct &lt;field&gt;) AS uniq_&lt;field&gt;
SELECT
    count(distinct id)    AS uniq_id
  , count(distinct name)  AS uniq_name
  , count(distinct email) AS uniq_email
FROM db.users
WHERE True
FORMAT Vertical
;</code></pre>
`;

// ───────────────────────────── Macrosing ──────────────────────────────

export const MACROSING_HELP_HTML = `
<p><strong>SQL Macrosing</strong> — размножает SQL-шаблон по значениям
плейсхолдеров. Удобно когда надо сгенерировать кучу похожих запросов:
по списку таблиц, диапазону дат, перебору схем и т.п.</p>

<h4>Как устроено</h4>
<ol>
  <li>В шаблоне пиши плейсхолдеры в виде <code>{{имя}}</code>.</li>
  <li>Для каждого найденного плейсхолдера появится строка настройки.</li>
  <li>Укажи тип значения и сами значения.</li>
  <li>Выбери режим комбинирования и разделитель запросов.</li>
  <li>Нажми <strong>Generate SQL</strong>.</li>
</ol>

<h4>Типы плейсхолдеров</h4>
<ul>
  <li><strong>static</strong> — одно значение, подставляется как есть во все вхождения.</li>
  <li><strong>list</strong> — список значений через запятую
      (<code>val1, val2, val3</code>). Каждое значение даёт вариант запроса.</li>
  <li><strong>range</strong> — числовой диапазон:
      <em>Start / End / Step / Format</em>. <code>Format</code> —
      Python-style <code>{}</code> для форматирования числа
      (например <code>2024-{:02d}-01</code> → <code>2024-01-01</code>,
      <code>2024-02-01</code>, ...).</li>
</ul>

<h4>Режимы комбинирования</h4>
<ul>
  <li><strong>Cartesian</strong> — все сочетания значений.
      Если <code>{{a}}</code> = [1,2], <code>{{b}}</code> = [x,y] → <em>4 запроса</em>.</li>
  <li><strong>Zip</strong> — значения спариваются по индексу.
      Требуется одинаковая длина списков.
      [1,2] + [x,y] → <em>2 запроса</em> (1,x) и (2,y).</li>
</ul>

<h4>Разделитель</h4>
<p>Строка между сгенерированными запросами. По умолчанию
<code>;\\n</code> (точка с запятой + перевод строки). Экранируй переводы
как <code>\\n</code>, табы как <code>\\t</code>.</p>

<h4>Сохранение шаблонов</h4>
<p>Кнопка <strong>Save</strong> сохраняет текущий шаблон + конфиг плейсхолдеров
+ режим + разделитель под введённым именем. Кнопка <strong>Delete</strong>
удаляет выбранный шаблон. Сохранённые шаблоны подтягиваются при запуске.</p>

<hr />

<h4>Пример 1 — cartesian</h4>

<h5>Шаблон</h5>
<pre><code>SELECT * FROM {{schema}}.users WHERE dt = '{{dt}}';</code></pre>

<h5>Плейсхолдеры</h5>
<ul>
  <li><code>{{schema}}</code> — list — <code>staging, prod</code></li>
  <li><code>{{dt}}</code> — list — <code>2024-01-01, 2024-01-02</code></li>
</ul>

<h5>Режим</h5>
<p>Cartesian, separator <code>;\\n</code></p>

<h5>Результат (4 запроса)</h5>
<pre><code>SELECT * FROM staging.users WHERE dt = '2024-01-01';
SELECT * FROM staging.users WHERE dt = '2024-01-02';
SELECT * FROM prod.users WHERE dt = '2024-01-01';
SELECT * FROM prod.users WHERE dt = '2024-01-02';</code></pre>

<h4>Пример 2 — range</h4>

<h5>Шаблон</h5>
<pre><code>ALTER TABLE events DROP PARTITION '{{dt}}';</code></pre>

<h5>Плейсхолдер <code>{{dt}}</code> — range</h5>
<ul>
  <li>Start: <code>1</code>, End: <code>3</code>, Step: <code>1</code></li>
  <li>Format: <code>2024-{:02d}-01</code></li>
</ul>

<h5>Результат</h5>
<pre><code>ALTER TABLE events DROP PARTITION '2024-01-01';
ALTER TABLE events DROP PARTITION '2024-02-01';
ALTER TABLE events DROP PARTITION '2024-03-01';</code></pre>
`;

// ──────────────────────────── Obfuscator ──────────────────────────────

export const OBFUSCATOR_HELP_HTML = `
<p><strong>SQL Obfuscator</strong> — превращает SQL или Python-DAG в
обезличенный вариант: имена таблиц, колонок и переменных заменяются на
обобщённые алиасы (<code>t1</code>, <code>t2</code>, <code>c1</code>, ...).
Нужно когда хочешь показать структуру запроса в чате/гисте/Stack Overflow,
но не светить реальные имена.</p>

<h4>Рабочий процесс</h4>
<ol>
  <li>Вставь код в поле ввода.</li>
  <li>Нажми <strong>Extract&nbsp;&amp;&nbsp;Obfuscate</strong> — первый проход:
      находим идентификаторы, строим маппинг, печатаем обезличенный результат.</li>
  <li>Под кнопками появится таблица <strong>Mappings</strong>,
      сгруппированная по типам (TABLE, COLUMN, VARIABLE, ...).
      Слева — оригинальное значение (красным), справа — обезличенное (зелёным).</li>
  <li>Сняв галочку у строки, можно вернуть оригинальное имя — полезно
      оставить читаемыми общеизвестные слова (<code>date</code>, <code>id</code>).</li>
  <li>Нажми <strong>Re-apply&nbsp;Mappings</strong> — повторная обфускация
      с учётом выключенных/изменённых маппингов.</li>
</ol>

<h4>Кнопки</h4>
<ul>
  <li><strong>Extract &amp; Obfuscate</strong> — первый проход:
      сбрасывает прошлые маппинги и строит новые.</li>
  <li><strong>Re-apply Mappings</strong> — применяет текущие
      (возможно отредактированные) маппинги. <em>Extract</em> перед этим
      обязателен хотя бы один раз.</li>
  <li><strong>Clear</strong> — очищает всё: ввод, вывод, маппинги.</li>
  <li><strong>Copy Result</strong> — копирует обезличенный SQL в буфер.</li>
  <li><strong>Toggle all</strong> — включить/выключить все маппинги разом.</li>
</ul>

<h4>Что обфускатор трогает и что нет</h4>
<ul>
  <li><strong>Трогает:</strong> имена таблиц (<code>schema.table</code>),
      имена колонок в <code>SELECT</code> / <code>WHERE</code> / <code>JOIN ON</code>,
      переменные в Python (для DAG-кода).</li>
  <li><strong>Не трогает:</strong> ключевые слова SQL
      (<code>SELECT</code>, <code>FROM</code>, <code>WHERE</code>...),
      строковые литералы (<code>'foo'</code>), числа,
      встроенные функции (<code>count</code>, <code>sum</code>, <code>date_trunc</code>...).</li>
</ul>

<hr />

<h4>Пример — SQL</h4>

<h5>Вход</h5>
<pre><code>SELECT u.user_id, u.email, o.order_total
FROM analytics.users AS u
JOIN analytics.orders AS o ON u.user_id = o.user_id
WHERE u.signup_dt &gt;= '2024-01-01';</code></pre>

<h5>После Extract &amp; Obfuscate</h5>
<pre><code>SELECT t1.c1, t1.c2, t2.c3
FROM s1.t1 AS t1
JOIN s1.t2 AS t2 ON t1.c1 = t2.c1
WHERE t1.c4 &gt;= '2024-01-01';</code></pre>

<h5>Mappings</h5>
<pre><code>SCHEMA:   analytics   →  s1
TABLE:    users       →  t1
TABLE:    orders      →  t2
COLUMN:   user_id     →  c1
COLUMN:   email       →  c2
COLUMN:   order_total →  c3
COLUMN:   signup_dt   →  c4</code></pre>

<h5>Хочешь оставить <code>user_id</code> читаемым?</h5>
<p>Сними галочку у строки <code>user_id → c1</code> и нажми
<strong>Re-apply&nbsp;Mappings</strong>. В результате <code>c1</code>
вернётся в <code>user_id</code>, остальное останется обезличенным.</p>
`;
