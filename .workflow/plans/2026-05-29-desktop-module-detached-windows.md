# Desktop Module Detached Windows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users right-click a main sidebar module and open that module in its own desktop window without the main left sidebar.

**Architecture:** Add a small native Tauri command that validates a module id, focuses an existing detached module window, or creates a new internal `khapp://localhost/index.html?standalone=1&module=...` window. Refactor the frontend boot path so the existing module registry can render either the normal sidebar shell or a single-module standalone shell.

**Tech Stack:** Tauri v2, Rust, vanilla JavaScript, shared `TabContainer`, CDP browser mock tests.

---

## Required Context

- Spec: `.workflow/specs/2026-05-29-desktop-module-detached-windows.md`
- Project rules: `CLAUDE.md`
- UI patterns: `FRONTEND_PATTERNS.md`
- Release rules: `desktop-rust/RELEASES.md`

This changes `desktop-rust/src-tauri/` and adds a Tauri command, so release as a full `v*` desktop release.

## File Map

Backend:

- Create `desktop-rust/src-tauri/src/commands/module_windows.rs`: module allowlist, label/title helpers, and `open_module_window`.
- Modify `desktop-rust/src-tauri/src/commands/mod.rs`: export the new command module.
- Modify `desktop-rust/src-tauri/src/lib.rs`: register `open_module_window`.
- Modify `desktop-rust/src-tauri/src/commands/ota.rs`: reload detached `module_*` windows during frontend OTA apply/revert/drop paths.

Frontend:

- Modify `desktop-rust/src/main.js`: share the module registry, add normal vs standalone boot, add sidebar context menu, and disable main-window-only Escape handling in standalone mode.
- Modify `desktop-rust/src/styles.css`: style the context menu and standalone panel state.
- Modify `desktop-rust/src/dev-mock.js`: mock `open_module_window` and record calls for CDP assertions.
- Modify `desktop-rust/src/dev-test.py`: add smoke coverage for right-click menu, native command call, standalone boot without sidebar/status bar, invalid standalone URLs, `last_active_tab`, and OTA reload contract.

Release/help:

- Modify `desktop-rust/src/tabs/help.js`: mention detachable module windows in Snippets/desktop app help text.
- Modify `desktop-rust/src/release-history.md`: add release note for the new `v*` tag.
- Modify `desktop-rust/CHANGELOG.md`: add release note for the new `v*` tag.

## Task 1: Backend Command Contract

**Files:**
- Create: `desktop-rust/src-tauri/src/commands/module_windows.rs`
- Modify: `desktop-rust/src-tauri/src/commands/mod.rs`
- Modify: `desktop-rust/src-tauri/src/lib.rs`
- Modify: `desktop-rust/src-tauri/src/commands/ota.rs`

- [ ] **Step 1: Write failing Rust tests**

Create `desktop-rust/src-tauri/src/commands/module_windows.rs` with tests first:

```rust
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ModuleWindowSpec {
    pub id: &'static str,
    pub label: &'static str,
    pub title: &'static str,
}

pub fn module_window_spec(module_id: &str) -> Option<ModuleWindowSpec> {
    match module_id {
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::module_window_spec;

    #[test]
    fn accepts_known_main_modules() {
        let snippets = module_window_spec("shortcuts").expect("shortcuts module");
        assert_eq!(snippets.label, "module_shortcuts");
        assert_eq!(snippets.title, "Snippets - Keyboard Helper");

        let tasks = module_window_spec("tasks").expect("tasks module");
        assert_eq!(tasks.label, "module_tasks");
        assert_eq!(tasks.title, "Tasks - Keyboard Helper");
    }

    #[test]
    fn rejects_settings_help_and_unknown_modules() {
        assert!(module_window_spec("settings").is_none());
        assert!(module_window_spec("help").is_none());
        assert!(module_window_spec("../tasks").is_none());
        assert!(module_window_spec("unknown").is_none());
    }
}
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
cd desktop-rust/src-tauri
cargo test module_window_spec --lib
```

Expected: `accepts_known_main_modules` fails because `module_window_spec("shortcuts")` returns `None`.

- [ ] **Step 3: Implement allowlist and native command**

Replace the stub in `module_windows.rs` with:

```rust
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ModuleWindowSpec {
    pub id: &'static str,
    pub label: &'static str,
    pub title: &'static str,
}

pub fn module_window_spec(module_id: &str) -> Option<ModuleWindowSpec> {
    match module_id {
        "shortcuts" => Some(ModuleWindowSpec { id: "shortcuts", label: "module_shortcuts", title: "Snippets - Keyboard Helper" }),
        "notes" => Some(ModuleWindowSpec { id: "notes", label: "module_notes", title: "Notes - Keyboard Helper" }),
        "tasks" => Some(ModuleWindowSpec { id: "tasks", label: "module_tasks", title: "Tasks - Keyboard Helper" }),
        "sql" => Some(ModuleWindowSpec { id: "sql", label: "module_sql", title: "SQL - Keyboard Helper" }),
        "superset" => Some(ModuleWindowSpec { id: "superset", label: "module_superset", title: "Superset - Keyboard Helper" }),
        "commits" => Some(ModuleWindowSpec { id: "commits", label: "module_commits", title: "Commits - Keyboard Helper" }),
        "exec" => Some(ModuleWindowSpec { id: "exec", label: "module_exec", title: "Exec - Keyboard Helper" }),
        "repo-search" => Some(ModuleWindowSpec { id: "repo-search", label: "module_repo_search", title: "Search - Keyboard Helper" }),
        "vps" => Some(ModuleWindowSpec { id: "vps", label: "module_vps", title: "VPS - Keyboard Helper" }),
        "whisper" => Some(ModuleWindowSpec { id: "whisper", label: "module_whisper", title: "Whisper - Keyboard Helper" }),
        _ => None,
    }
}

#[tauri::command]
pub async fn open_module_window(app: tauri::AppHandle, module_id: String) -> Result<(), String> {
    let spec = module_window_spec(&module_id)
        .ok_or_else(|| format!("Unsupported module: {module_id}"))?;

if let Some(window) = app.get_webview_window(spec.label) {
        window.show().map_err(|e| e.to_string())?;
        window.unminimize().map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }

    let url = format!("khapp://localhost/index.html?standalone=1&module={}", spec.id);
    let parsed_url = url.parse::<tauri::Url>().map_err(|e| e.to_string())?;
    WebviewWindowBuilder::new(&app, spec.label, WebviewUrl::CustomProtocol(parsed_url))
        .title(spec.title)
        .inner_size(1100.0, 760.0)
        .min_inner_size(760.0, 480.0)
        .resizable(true)
        .decorations(true)
        .build()
        .map_err(|e| e.to_string())?;

    Ok(())
}
```

In `desktop-rust/src-tauri/src/commands/mod.rs`, add:

```rust
pub mod module_windows;
```

In `desktop-rust/src-tauri/src/lib.rs`, add to `tauri::generate_handler!`:

```rust
commands::module_windows::open_module_window,
```

- [ ] **Step 4: Reload detached windows during frontend OTA**

In `desktop-rust/src-tauri/src/commands/ota.rs`, change `reload_frontend_windows` so it iterates every WebView window and reloads labels `main`, `whisper-overlay`, and every label starting with `module_`:

```rust
fn reload_frontend_windows(app: &AppHandle) {
    for (label, window) in app.webview_windows() {
        if label == "main" || label == "whisper-overlay" || label.starts_with("module_") {
            let _ = window.reload();
        }
    }
}
```

Use `reload_frontend_windows(&app)` in `apply_frontend_update`, `revert_frontend`, `drop_frontend_override`, and the boot-watchdog rollback paths so detached windows cannot keep stale frontend documents.

- [ ] **Step 5: Run backend tests and cargo check**

Run:

```bash
cd desktop-rust/src-tauri
cargo test module_window_spec --lib
cargo check
```

Expected: if the filter matches no tests, rerun with `cargo test module_windows --lib`.
The module tests pass and `cargo check` exits 0.

## Task 2: Frontend Context Menu and Standalone Shell

**Files:**
- Modify: `desktop-rust/src/main.js`
- Modify: `desktop-rust/src/styles.css`
- Modify: `desktop-rust/src/dev-mock.js`
- Modify: `desktop-rust/src/dev-test.py`

- [ ] **Step 1: Write failing browser mock tests**

In `desktop-rust/src/dev-test.py`, before the final summary, add:

```python
    # ── T27: Detached module windows ───────────────────────
    async def t27_detached_module_context_menu_and_standalone_boot():
        await cdp.send('Page.reload', ignoreCache=True)
        await wait_until(cdp, "!!document.querySelector('.tab-btn')", timeout=8)
        await wait_until(cdp, "!!window.__TAURI__ && !!window.__TAURI__.core", timeout=5)
        await cdp.eval("""(() => {
          const settings = JSON.parse(localStorage.getItem('mock.settings') || '{}');
          settings.last_active_tab = 'notes';
          localStorage.setItem('mock.settings', JSON.stringify(settings));
        })()""")

        await cdp.eval("window.__mockOpenedModuleWindows = []")
        await cdp.eval("""(() => {
          const btn = document.querySelector('.tab-btn[data-tab-id="tasks"]');
          btn.dispatchEvent(new MouseEvent('contextmenu', {
            bubbles: true, cancelable: true, clientX: 40, clientY: 120
          }));
        })()""")
        await wait_until(cdp, "!!document.querySelector('.module-context-menu')", timeout=3)
        menu_text = await cdp.eval("document.querySelector('.module-context-menu').textContent")
        assert 'Open in separate window' in menu_text, menu_text
        await cdp.eval("document.querySelector('.module-context-menu [data-action=\"open-module-window\"]').click()")
        opened = await wait_until(
            cdp,
            "window.__mockOpenedModuleWindows && window.__mockOpenedModuleWindows[0] === 'tasks'",
            timeout=3,
        )
        assert opened is True

        await cdp.send('Page.navigate', url=f'{TEST_URL}?standalone=1&module=tasks')
        await asyncio.sleep(0.8)
        await wait_until(cdp, "document.body.classList.contains('standalone-module-window')", timeout=8)
        has_sidebar = await cdp.eval("!!document.querySelector('.tab-bar')")
        assert has_sidebar is False, 'standalone window rendered the main sidebar'
        has_status_bar = await cdp.eval("!!document.querySelector('#status-bar')")
        assert has_status_bar is False, 'standalone window rendered main status bar'
        panel_id = await cdp.eval("document.querySelector('.tab-panel')?.id")
        assert panel_id == 'panel-tasks', panel_id
        has_task_text = await wait_until(
            cdp,
            "document.body.innerText.includes('Regular mock task') || document.body.innerText.includes('Tasks')",
            timeout=5,
        )
        assert has_task_text is True
        stored_tab = await cdp.eval(
            "JSON.parse(localStorage.getItem('mock.settings') || '{}').last_active_tab"
        )
        assert stored_tab == 'notes', f'standalone changed last_active_tab: {stored_tab!r}'

        await cdp.send('Page.navigate', url=f'{TEST_URL}?standalone=1&module=unknown')
        await asyncio.sleep(0.8)
        await wait_until(cdp, "document.body.classList.contains('standalone-module-window')", timeout=8)
        invalid_has_sidebar = await cdp.eval("!!document.querySelector('.tab-bar')")
        assert invalid_has_sidebar is False, 'invalid standalone URL rendered the main sidebar'
        invalid_text = await cdp.eval("document.body.innerText")
        assert 'Unsupported module window' in invalid_text, invalid_text

        await cdp.send('Page.navigate', url=TEST_URL)
        await asyncio.sleep(0.8)
        await wait_until(cdp, "!!document.querySelector('.tab-btn')", timeout=8)
        active_tab = await wait_until(
            cdp,
            "document.querySelector('.tab-btn.active')?.dataset.tabId",
            timeout=4,
        )
        assert active_tab == 'notes', f'main window did not keep last_active_tab: {active_tab!r}'
    await check('T27 Detached module windows', t27_detached_module_context_menu_and_standalone_boot)
```

In `desktop-rust/src/dev-mock.js`, do not add the mock yet for the RED run.

- [ ] **Step 2: Run browser tests and verify RED**

Run:

```bash
cd desktop-rust/src
python3 dev-test.py
```

Expected: T27 fails because no `.module-context-menu` is rendered and `open_module_window` is not mocked.

- [ ] **Step 3: Add frontend behavior**

In `desktop-rust/src/main.js`:

1. Keep the existing `TABS` registry.
2. Add:

```js
function getStandaloneRequest() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('standalone') !== '1') {
    return { standalone: false, moduleId: '', tab: null };
  }
  const moduleId = params.get('module') || '';
  const tab = TABS.find(t => t.id === moduleId) || null;
  return { standalone: true, moduleId, tab };
}

function closeModuleContextMenu() {
  document.querySelector('.module-context-menu')?.remove();
}

function showModuleContextMenu(event, tab) {
  event.preventDefault();
  closeModuleContextMenu();

  const menu = document.createElement('div');
  menu.className = 'module-context-menu';
  menu.innerHTML = '<button type="button" data-action="open-module-window">Open in separate window</button>';
  menu.querySelector('[data-action="open-module-window"]').addEventListener('click', async () => {
    closeModuleContextMenu();
    try {
      await call('open_module_window', { moduleId: tab.id });
    } catch (err) {
      showToast(`Failed to open module window: ${err}`, 'error');
    }
  });
  document.body.appendChild(menu);
  positionModuleContextMenu(menu, event);
}

async function mountStandaloneModule(app, request) {
  document.body.classList.add('standalone-module-window');
  app.innerHTML = '';
  const panel = document.createElement('div');
  panel.className = 'tab-panel standalone-module-panel';

  if (!request.tab) {
    panel.id = 'panel-standalone-error';
    panel.innerHTML = '<div class="loading">Unsupported module window</div>';
    app.appendChild(panel);
    setTimeout(() => call('confirm_frontend_boot').catch(() => {}), 5000);
    return;
  }

  panel.id = `panel-${request.moduleId}`;
  panel.innerHTML = '<div class="loading">Loading...</div>';
  app.appendChild(panel);
  try {
    await request.tab.loader(panel);
  } catch (err) {
    console.error(`Failed to load standalone module "${request.moduleId}":`, err);
    panel.innerHTML = '<div class="loading">Failed to load module</div>';
  }
  setTimeout(() => call('confirm_frontend_boot').catch(() => {}), 5000);
}
```

3. At the top of `main()`, set `const app = document.getElementById('app')` and compute `const standaloneRequest = getStandaloneRequest();`.
4. If `standaloneRequest.standalone` is true, call `await mountStandaloneModule(app, standaloneRequest); return;` before `checkFirstRun()`.
5. After normal `TabContainer` creation, attach context menu handlers:

```js
for (const tab of TABS) {
  const btn = tabContainer.buttons[tab.id];
  if (btn) btn.addEventListener('contextmenu', (event) => showModuleContextMenu(event, tab));
}
document.addEventListener('click', closeModuleContextMenu);
window.addEventListener('blur', closeModuleContextMenu);
```

6. In the Escape key handler, add:

```js
if (document.body.classList.contains('standalone-module-window')) return;
```

7. In `DOMContentLoaded` and the `visibilitychange` sync handler, call main-only side effects only when `getStandaloneRequest().standalone` is false. That means detached windows do not create the status bar, do not start update watchers, and do not run hidden sync timers.

In `desktop-rust/src/styles.css`, add:

```css
body.standalone-module-window #app {
  width: 100vw;
  height: 100vh;
}

.standalone-module-panel {
  width: 100%;
  height: 100%;
}

.module-context-menu {
  position: fixed;
  z-index: 10000;
  min-width: 190px;
  padding: 4px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-secondary);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.36);
}

.module-context-menu button {
  width: 100%;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--text);
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  padding: 7px 9px;
  text-align: left;
}

.module-context-menu button:hover {
  background: var(--bg-tertiary);
}
```

In `desktop-rust/src/dev-mock.js`, add near `open_link_window`:

```js
async open_module_window({ moduleId }) {
  window.__mockOpenedModuleWindows = window.__mockOpenedModuleWindows || [];
  window.__mockOpenedModuleWindows.push(moduleId);
},
```

- [ ] **Step 4: Run browser tests**

Run:

```bash
cd desktop-rust/src
node --check main.js
node --check dev-mock.js
python3 dev-test.py
```

Expected: syntax checks pass and dev-test reports all tests passing.

## Task 3: Release Help and Changelog

**Files:**
- Modify: `desktop-rust/src/tabs/help.js`
- Modify: `desktop-rust/src/release-history.md`
- Modify: `desktop-rust/CHANGELOG.md`

- [ ] **Step 1: Update Help text**

In `desktop-rust/src/tabs/help.js`, update the English and Russian features text to mention:

```text
Right-click a main sidebar module to open it in its own focused window without the main sidebar.
```

Use the existing i18n object style and keep the text compact.

- [ ] **Step 2: Add release notes**

Add a new top entry in `desktop-rust/src/release-history.md` and `desktop-rust/CHANGELOG.md` for the next version after `v1.3.45`, using `v1.3.46` if no newer version is already present:

```markdown
## v1.3.46 (2026-05-29)

- Added detached module windows: right-click a main sidebar module to open it
  in its own window without the main sidebar.
```

- [ ] **Step 3: Validate release history syntax**

Run:

```bash
cd desktop-rust/src
node --check tabs/help.js
grep -F "v1.3.46" release-history.md
```

Expected: `node --check` exits 0 and `grep` prints the new release-history entry.

## Task 4: Full Verification and Release

**Files:**
- Modify during release: `desktop-rust/src-tauri/Cargo.toml`
- Modify during release: `desktop-rust/src-tauri/tauri.conf.json`
- Modify during release: `desktop-rust/src-tauri/Cargo.lock`

- [ ] **Step 1: Bump native version**

Set `desktop-rust/src-tauri/Cargo.toml` and `desktop-rust/src-tauri/tauri.conf.json` to `1.3.46`, unless a newer version is already present. Refresh `Cargo.lock` with `cargo check`.

- [ ] **Step 2: Run full desktop verification**

Run:

```bash
cd desktop-rust/src-tauri
cargo check
cargo test module_window_spec --lib
cd ../src
node --check main.js
node --check dev-mock.js
node --check tabs/help.js
python3 dev-test.py
```

Expected: all commands exit 0.

- [ ] **Step 3: Commit only task files**

Run:

```bash
git status --short
git add .workflow/specs/2026-05-29-desktop-module-detached-windows.md \
        .workflow/plans/2026-05-29-desktop-module-detached-windows.md \
        desktop-rust/src-tauri/src/commands/module_windows.rs \
        desktop-rust/src-tauri/src/commands/mod.rs \
        desktop-rust/src-tauri/src/lib.rs \
        desktop-rust/src-tauri/src/commands/ota.rs \
        desktop-rust/src-tauri/Cargo.toml \
        desktop-rust/src-tauri/Cargo.lock \
        desktop-rust/src-tauri/tauri.conf.json \
        desktop-rust/src/main.js \
        desktop-rust/src/styles.css \
        desktop-rust/src/dev-mock.js \
        desktop-rust/src/dev-test.py \
        desktop-rust/src/tabs/help.js \
        desktop-rust/src/release-history.md \
        desktop-rust/CHANGELOG.md
git commit -m "add detached module windows (v1.3.46)"
```

Do not add `.workflow/checkpoints/2026-05-29-whisper-overlay-checkpoint.md`; it is an existing untracked checkpoint outside this feature commit.

- [ ] **Step 4: Release**

Follow `desktop-rust/RELEASES.md` for a full release:

```bash
git push
git tag v1.3.46
git push origin v1.3.46
```

Then monitor GitHub Actions and verify release assets plus `frontend-version.json` for `v1.3.46`.
