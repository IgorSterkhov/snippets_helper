# Sidebar Colored Icons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Заменить монохромные значки Finance, DEV, SQL и Superset в основном сайдбаре на утверждённые цветные SVG-глифы B1 без изменения навигационного поведения.

**Architecture:** Исходное поле `icon` остаётся строковым для view history и других потребителей. `TabContainer` использует отдельные `sidebarIcon`/`sidebarIconTone`; `outline:` получает фиксированную геометрию, а legacy `logo:` сохраняет размер 1em и может получить только tone-класс.

**Tech Stack:** Vanilla JavaScript ES modules, CSS masks, SVG assets, Python CDP smoke tests.

**Spec:** `.workflow/specs/2026-08-30-sidebar-colored-icons.md`

## Global Constraints

- Реализовать B1 Clean color без плиток, фоновых контейнеров, рамок, тени и свечения.
- Сохранить сайдбар 48 px, кнопки 48×48 px и штатный active-state.
- Не менять Rust/Tauri/IPC surface.
- `.workflow/scr/Screenshot_2.png` использовать только как пользовательский визуальный референс и не stage автоматически.
- Не менять и не stage удаление `.workflow/Screenshot_1.png` и `.workflow/scr/Screenshot_1.png`.
- Проверить untracked spec/plan/SVG отдельно; обычный `git diff` их не показывает.
- Перед завершением выполнить `node --check`, полный `dev-test.py`, визуальный smoke и `git diff --check`.

---

### Task 1: TDD-реализация B1 sidebar icons

**Files:**
- Create: `desktop-rust/src/icons/sidebar/finance.svg`
- Create: `desktop-rust/src/icons/sidebar/dev.svg`
- Create: `desktop-rust/src/icons/sidebar/sql.svg`
- Modify: `desktop-rust/src/dev-test.py`
- Modify: `desktop-rust/src/main.js`
- Modify: `desktop-rust/src/components/tab-container.js`
- Modify: `desktop-rust/src/styles.css`
- Modify: `FRONTEND_PATTERNS.md`

**Interfaces:**
- Consumes: `tab.sidebarIcon`, `tab.sidebarIconTone`, `group.sidebarIcon`, `group.sidebarIconTone`.
- Produces: `renderTabIcon(icon, tone)`, `.tab-icon-vector`, `.tab-icon-outline`, сохранённый `.tab-icon-logo`, tone-классы и три stroke-only SVG.

- [ ] **Step 1: Добавить падающий CDP-тест видимого поведения**

После T2 в `dev-test.py` добавить `t2_sidebar_colored_outline_icons`. Тест должен:

1. Кликнуть `.tab-group-btn[data-group-id="dev"]` и дождаться `.tab-group-children.expanded`, `aria-hidden="false"` и opacity `1`.
2. Для Finance/DEV/SQL/Superset прочитать реальный элемент и computed styles:
   - Finance: `[data-tab-id="finance"] .tab-icon-outline`;
   - DEV: `[data-group-id="dev"] .tab-icon-outline`;
   - SQL: `[data-tab-id="sql"] .tab-icon-outline`;
   - Superset: `[data-tab-id="superset"] .tab-icon-logo.tab-icon-tone-superset`.
3. Проверить literal-ожидания:

```python
expected = {
    'finance': ('rgb(86, 211, 100)', 'icons/sidebar/finance.svg'),
    'dev': ('rgb(188, 140, 255)', 'icons/sidebar/dev.svg'),
    'sql': ('rgb(88, 166, 255)', 'icons/sidebar/sql.svg'),
    'superset': ('rgb(255, 123, 84)', 'icons/logos/apachesuperset.svg'),
}
```

Для каждого элемента assert-ить: ненулевые `getBoundingClientRect().width/height`, `display != 'none'`, `visibility == 'visible'`, `opacity == '1'`, `color` равен ожидаемому, `backgroundColor == color`, `maskImage` содержит ожидаемый asset, `borderTopWidth == '0px'`, `borderRadius == '0px'`, `paddingTop == '0px'`, `filter == 'none'`, `boxShadow == 'none'`.

4. Через `fetch()` загрузить все четыре asset URL, проверить HTTP OK и наличие корневого `<svg>` через `DOMParser(..., 'image/svg+xml')` без `parsererror`.
5. Проверить ClickHouse regression:

```python
clickhouse = await cdp.eval("""(() => {
  const el = document.querySelector('[data-tab-id="clickhouse-docs"] .tab-icon-logo');
  const style = getComputedStyle(el);
  return {
    width: style.width,
    height: style.height,
    maskImage: style.maskImage || style.webkitMaskImage,
    hasTone: [...el.classList].some(name => name.startsWith('tab-icon-tone-')),
  };
})()""")
assert clickhouse['width'] == '16px', clickhouse
assert clickhouse['height'] == '16px', clickhouse
assert 'icons/logos/clickhouse.svg' in clickhouse['maskImage'], clickhouse
assert clickhouse['hasTone'] is False, clickhouse
```

6. Активировать Finance и повторно проверить зелёный цвет и штатные значения:

```python
assert active == {
    'active': True,
    'backgroundColor': 'rgb(22, 27, 34)',
    'borderLeftColor': 'rgb(56, 139, 253)',
    'iconColor': 'rgb(86, 211, 100)',
}, active
```

7. Активировать SQL и проверить у DEV: `expanded == true`, `has-active-child == true`, `.active == false`, `aria-hidden == 'false'`; DEV icon остаётся видимым и borderless.
8. После клика Finance дождаться через `wait_until`, что history содержит Finance=`$`; только затем активировать SQL и дождаться SQL=`🗃`; только затем активировать Superset и дождаться Superset=`logo:apachesuperset`. Это обязательно, потому что click handler не await-ится снаружи, а запись создаётся после async loader. После трёх ожиданий проверить, что ни одна запись не начинается с `outline:`. Двумя Ctrl+Tab keydown показать `.view-history-switcher` и убедиться, что его текст не содержит `outline:`; keyup Control закрывает overlay.
9. Очистить созданные history entries через `window.__keyboardHelperViewHistory.length = 0`, вернуть Shortcuts.
10. Зарегистрировать сценарий как:

```python
await check('T2 sidebar colored outline icons', t2_sidebar_colored_outline_icons)
```

- [ ] **Step 2: Запустить suite и подтвердить RED**

Run:

```bash
cd desktop-rust/src
PYTHONPATH=/tmp/snippets-helper-websockets-20260830 python3 dev-test.py
```

Expected: новый T2 падает потому, что `.tab-icon-outline` отсутствует; исходные 89 сценариев остаются зелёными.

- [ ] **Step 3: Добавить stroke-only SVG assets**

`finance.svg`:

```svg
<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="#000" stroke-width="1.85" stroke-linecap="round">
  <path d="M12 3v18M16.2 7.1c-.9-.8-2.2-1.2-3.6-1.2-2.1 0-3.7 1.1-3.7 2.7 0 4.2 7.2 1.8 7.2 6.2 0 1.8-1.7 3-4.1 3-1.7 0-3.2-.6-4.2-1.6"/>
</svg>
```

`dev.svg`:

```svg
<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="#000" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round">
  <path d="m8 7-5 5 5 5M16 7l5 5-5 5M14 4l-4 16"/>
</svg>
```

`sql.svg`:

```svg
<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="#000" stroke-width="1.8">
  <ellipse cx="12" cy="5.5" rx="7.5" ry="3"/>
  <path d="M4.5 5.5v6c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-6M4.5 11.5v6c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-6"/>
</svg>
```

- [ ] **Step 4: Разделить outline geometry и legacy logo geometry**

В `tab-container.js` renderer должен сохранить plain text, для `outline:` выбрать `icons/sidebar/`, для `logo:` — `icons/logos/`, санитизировать slug/tone и вернуть:

```js
function renderTabIcon(icon, tone = '') {
  const raw = icon || '';
  let kind = '';
  let directory = '';
  let prefixLength = 0;
  if (raw.startsWith('outline:')) {
    kind = 'outline';
    directory = 'sidebar';
    prefixLength = 8;
  } else if (raw.startsWith('logo:')) {
    kind = 'logo';
    directory = 'logos';
    prefixLength = 5;
  }
  if (kind) {
    const slug = raw.slice(prefixLength).replace(/[^a-z0-9-]/gi, '');
    const safeTone = String(tone || '').replace(/[^a-z0-9-]/gi, '');
    const toneClass = safeTone ? ` tab-icon-tone-${safeTone}` : '';
    const asset = `icons/${directory}/${slug}.svg`;
    return `<span class="tab-icon tab-icon-vector tab-icon-${kind}${toneClass}" style="--tab-icon-mask:url(${asset})"></span>`;
  }
  return `<span class="tab-icon">${raw}</span>`;
}
```

`createTabButton` и `createGroup` используют sidebar override, не заменяя `icon`:

```js
renderTabIcon(tab.sidebarIcon || tab.icon, tab.sidebarIconTone)
renderTabIcon(group.sidebarIcon || group.icon, group.sidebarIconTone)
```

- [ ] **Step 5: Подключить B1 metadata в `main.js`**

Finance/SQL/Superset сохраняют исходные `icon` и получают:

```js
sidebarIcon: 'outline:finance', sidebarIconTone: 'finance'
sidebarIcon: 'outline:sql', sidebarIconTone: 'sql'
sidebarIcon: 'logo:apachesuperset', sidebarIconTone: 'superset'
```

DEV group сохраняет `icon: '&lt;/&gt;'` и получает:

```js
sidebarIcon: 'outline:dev', sidebarIconTone: 'dev'
```

- [ ] **Step 6: Добавить CSS без изменения legacy logo size**

```css
.tab-icon-vector {
  display: inline-block;
  vertical-align: middle;
  padding: 0;
  border: 0;
  border-radius: 0;
  background-color: currentColor;
  mask-image: var(--tab-icon-mask);
  mask-size: contain;
  mask-repeat: no-repeat;
  mask-position: center;
  -webkit-mask-image: var(--tab-icon-mask);
  -webkit-mask-size: contain;
  -webkit-mask-repeat: no-repeat;
  -webkit-mask-position: center;
}
.tab-icon-logo { width: 1em; height: 1em; }
.tab-icon-outline { width: 20px; height: 20px; flex: 0 0 20px; }
.tab-icon-tone-finance { color: #56d364; }
.tab-icon-tone-dev { color: #bc8cff; }
.tab-icon-tone-sql { color: #58a6ff; }
.tab-icon-tone-superset { color: #ff7b54; }
.tab-group-btn .tab-icon.tab-icon-vector {
  padding: 0;
  border: 0;
  border-radius: 0;
}
.tab-group-child .tab-icon-outline {
  width: 18px;
  height: 18px;
  flex-basis: 18px;
}
```

Селектор reset имеет specificity выше существующего `.tab-group-btn .tab-icon`, поэтому удаление DEV frame не зависит от порядка правил.

- [ ] **Step 7: Документировать sidebar-only override**

В `FRONTEND_PATTERNS.md` §3 добавить правило: `icon` остаётся совместимым строковым значением; `sidebarIcon`/`sidebarIconTone` применяются только renderer-ом сайдбара; `outline:` assets лежат в `icons/sidebar/`; цвет применяется к глифу без контейнерного фона, рамки, скругления или свечения; `logo:` сохраняет 1em geometry.

- [ ] **Step 8: Подтвердить GREEN**

Run:

```bash
node --check desktop-rust/src/main.js
node --check desktop-rust/src/components/tab-container.js
cd desktop-rust/src
PYTHONPATH=/tmp/snippets-helper-websockets-20260830 python3 dev-test.py
```

Expected: оба JS-файла проходят syntax check, suite показывает `90/90 passed`.

---

### Task 2: Визуальная проверка и release decision gate

**Files:**
- Inspect: `.workflow/scr/Screenshot_2.png`
- Inspect/modify after release permission: `desktop-rust/src/tabs/help.js`
- Inspect/modify after release permission: `desktop-rust/src/release-history.md`
- Inspect/modify after release permission: `desktop-rust/CHANGELOG.md`

**Interfaces:**
- Consumes: готовый browser mock, текущую git ancestry и `desktop-rust/RELEASES.md`.
- Produces: визуально проверенный B1 diff; release channel только после отдельного lineage-аудита и разрешения пользователя.

- [ ] **Step 1: Провести browser visual smoke**

Открыть `desktop-rust/src/dev.html` в headless/real browser, снять screenshot при 100% масштабе и проверить: Finance active/inactive; DEV collapsed/expanded; SQL active; Superset и ClickHouse рядом; отсутствие плиток/рамок/свечения; стрелка DEV не пересекает glyph.

- [ ] **Step 2: Проверить task-related diff, включая untracked**

Run:

```bash
git status --short
git diff --check
git diff -- desktop-rust/src/main.js desktop-rust/src/components/tab-container.js desktop-rust/src/styles.css desktop-rust/src/dev-test.py FRONTEND_PATTERNS.md
sed -n '1,240p' desktop-rust/src/icons/sidebar/finance.svg desktop-rust/src/icons/sidebar/dev.svg desktop-rust/src/icons/sidebar/sql.svg
sed -n '1,240p' .workflow/specs/2026-08-30-sidebar-colored-icons.md
sed -n '1,380p' .workflow/plans/2026-08-30-sidebar-colored-icons.md
```

Expected: Screenshot 2 остаётся untracked reference; Screenshot 1 deletion/move не изменены; все untracked task-файлы просмотрены отдельно.

- [ ] **Step 3: Выполнить release lineage audit**

Run:

```bash
git merge-base --is-ancestor v1.24.2 HEAD
git merge-base --is-ancestor f-20260830-1 HEAD
git diff --name-status v1.24.2..HEAD -- desktop-rust/src-tauri desktop-rust/src .github/workflows/release-desktop.yml
git log --oneline --decorate --graph --all --max-count=30
```

Current expected result: `v1.24.2` является предком `main`; `f-20260830-1` не является; после native baseline есть `src-tauri` changes. Поэтому не создавать `f-*` с текущей `main` без отдельной безопасной frontend-линии. Для релиза из `main` обсудить patch `v*` и включённые native-изменения.

- [ ] **Step 4: Сообщить реализацию и запросить release permission**

Остановиться перед commit/tag/push: это shared-branch side effect, а worktree содержит несвязанные пользовательские файлы. Предложить варианты: полный patch `v*` из `main` после native checks или отдельно согласованная frontend-линия.

- [ ] **Step 5: После разрешения обновить release surfaces корректного канала**

- В `tabs/help.js` дополнить `sidebar_groups_desc` на английском и русском описанием постоянных цветов Finance/DEV/SQL/Superset; tag туда не добавлять.
- В `release-history.md` и `CHANGELOG.md` добавить точный выбранный tag; отдельно сверить опубликованность и историю бокового `f-20260830-1`, не переносить запись автоматически.
- Для `v*` обновить версии в `Cargo.toml` и `tauri.conf.json`, refresh `Cargo.lock` по `RELEASES.md`.

- [ ] **Step 6: После release-surface edits повторить полный gate**

Run:

```bash
node --check desktop-rust/src/main.js
node --check desktop-rust/src/components/tab-container.js
node --check desktop-rust/src/tabs/help.js
cd desktop-rust/src-tauri && cargo check
cd ../src && PYTHONPATH=/tmp/snippets-helper-websockets-20260830 python3 dev-test.py
# Main/full-patch path:
grep -F "v1.24.3" release-history.md
# Separately approved safe frontend-line path:
grep -F "f-20260830-2" release-history.md
cd ../..
git diff --check
git status --short
```

Выполнить только grep для выбранного канала.

- [ ] **Step 7: Выполнить path-scoped staging и проверить staged diff**

Для любого канала сначала добавить только общие task paths:

```bash
git add -- .workflow/specs/2026-08-30-sidebar-colored-icons.md .workflow/plans/2026-08-30-sidebar-colored-icons.md FRONTEND_PATTERNS.md desktop-rust/src/main.js desktop-rust/src/components/tab-container.js desktop-rust/src/styles.css desktop-rust/src/dev-test.py desktop-rust/src/icons/sidebar/finance.svg desktop-rust/src/icons/sidebar/dev.svg desktop-rust/src/icons/sidebar/sql.svg desktop-rust/src/tabs/help.js desktop-rust/src/release-history.md desktop-rust/CHANGELOG.md
```

Для согласованного `v1.24.3` дополнительно добавить только version files:

```bash
git add -- desktop-rust/src-tauri/Cargo.toml desktop-rust/src-tauri/tauri.conf.json desktop-rust/src-tauri/Cargo.lock
```

После staging и до commit выполнить:

```bash
git diff --cached --check
git diff --cached --name-status
```

Expected: Screenshot 1/2 paths отсутствуют; staged paths содержат только текущую задачу и согласованные release files.

- [ ] **Step 8: Commit/tag/push и CI verification только после разрешения**

Создать path-scoped однострочный commit, tag выбранного канала, push main/tag; дождаться GitHub Actions, проверить ожидаемое число assets и tag-specific `frontend-version.json`. Пользовательские screenshots не stage.
