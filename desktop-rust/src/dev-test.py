#!/usr/bin/env python3
"""CDP-based smoke test for the browser mock dev environment.

Launches a local python HTTP server + headless Chrome with remote debugging,
connects via Chrome DevTools Protocol, runs interactive scenarios, and prints
PASS/FAIL. Intended to run from repo root or this folder.
"""

import asyncio
import json
import os
import signal
import socket
import subprocess
import sys
import time
from contextlib import contextmanager

import websockets
from urllib.request import urlopen

SRC_DIR = os.path.dirname(os.path.abspath(__file__))
HTTP_PORT = 8765
CDP_PORT = 9222
TEST_URL = f"http://localhost:{HTTP_PORT}/dev.html"


def free_port(p):
    try:
        with socket.socket() as s: s.bind(('', p))
        return True
    except OSError:
        return False


@contextmanager
def http_server():
    # Ensure a clean port
    proc = subprocess.Popen(
        [sys.executable, '-m', 'http.server', str(HTTP_PORT)],
        cwd=SRC_DIR,
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        preexec_fn=os.setsid,
    )
    time.sleep(0.5)
    try:
        yield
    finally:
        os.killpg(os.getpgid(proc.pid), signal.SIGTERM)


@contextmanager
def chrome_cdp():
    user_data = f"/tmp/chrome-cdp-{os.getpid()}"
    proc = subprocess.Popen(
        [
            'google-chrome', '--headless=new', '--disable-gpu',
            f'--remote-debugging-port={CDP_PORT}',
            f'--user-data-dir={user_data}',
            '--no-first-run', '--no-default-browser-check',
            'about:blank',
        ],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        preexec_fn=os.setsid,
    )
    # Wait until port is listening
    for _ in range(40):
        try:
            urlopen(f'http://localhost:{CDP_PORT}/json/version', timeout=0.2).read()
            break
        except Exception:
            time.sleep(0.2)
    try:
        yield
    finally:
        os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
        subprocess.run(['rm', '-rf', user_data], check=False)


async def cdp_session():
    """Attach to the initial blank page target, navigate to TEST_URL."""
    pages = json.loads(urlopen(f'http://localhost:{CDP_PORT}/json').read())
    page = next((p for p in pages if p.get('type') == 'page'), None)
    if not page:
        raise RuntimeError('No page target available')
    ws = await websockets.connect(page['webSocketDebuggerUrl'], max_size=None)
    return ws


class CDP:
    def __init__(self, ws):
        self.ws = ws
        self._id = 0

    async def send(self, method, **params):
        self._id += 1
        msg_id = self._id
        await self.ws.send(json.dumps({'id': msg_id, 'method': method, 'params': params}))
        while True:
            raw = await self.ws.recv()
            msg = json.loads(raw)
            if msg.get('id') == msg_id:
                if 'error' in msg:
                    raise RuntimeError(f'{method}: {msg["error"]}')
                return msg.get('result', {})

    async def eval(self, expr, await_promise=True):
        r = await self.send(
            'Runtime.evaluate',
            expression=expr,
            returnByValue=True,
            awaitPromise=await_promise,
        )
        if r.get('exceptionDetails'):
            raise RuntimeError(str(r['exceptionDetails']))
        return r.get('result', {}).get('value')


async def wait_until(cdp, expr, timeout=5.0, interval=0.1):
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        try:
            last = await cdp.eval(expr)
            if last:
                return last
        except Exception as e:
            last = f'ERR: {e}'
        await asyncio.sleep(interval)
    raise TimeoutError(f'wait_until timeout for {expr!r}; last={last!r}')


# ── Test scenarios ─────────────────────────────────────────────

async def run_tests():
    ws = await cdp_session()
    cdp = CDP(ws)
    results = []

    # Navigate to the test URL and wait for load
    await cdp.send('Page.enable')
    await cdp.send(
        'Browser.grantPermissions',
        permissions=['clipboardReadWrite'],
        origin=f'http://localhost:{HTTP_PORT}',
    )
    await cdp.send('Page.navigate', url=TEST_URL)
    # Give page a beat to start loading
    await asyncio.sleep(0.8)

    async def check(name, fn):
        try:
            await fn()
            print(f'  PASS  {name}')
            results.append((name, True, None))
        except Exception as e:
            print(f'  FAIL  {name}: {e}')
            results.append((name, False, str(e)))

    # Wait for mock to initialize and app to render tabs
    await wait_until(cdp, "!!document.querySelector('.tab-btn')", timeout=8)
    await wait_until(cdp, "!!window.__TAURI__ && !!window.__TAURI__.core", timeout=5)

    async def close_modals():
        await cdp.eval("""(() => {
          [...document.querySelectorAll('.modal-overlay')].forEach(x => x.remove());
        })()""")

    async def open_shortcuts_tab():
        await close_modals()
        await cdp.eval("document.querySelector('.tab-btn[data-tab-id=\"shortcuts\"]').click()")
        await wait_until(cdp, "!!document.querySelector('#panel-shortcuts')", timeout=4)
        await wait_until(cdp, "document.body.innerText.includes('SELECT all')", timeout=5)

    # ── T1: mock handler count ───────────────────────────────
    async def t1():
        # Check that mock is installed
        ok = await cdp.eval(
            "typeof window.__TAURI__.core.invoke === 'function'"
        )
        assert ok, 'invoke function missing'
    await check('T1 mock installed', t1)

    # ── T2: status bar shows combined version ─────────────────
    async def t2():
        await wait_until(
            cdp,
            "(document.querySelector('.sb-update .sb-label')?.textContent || '').includes('f1')",
            timeout=8,
        )
        txt = await cdp.eval("document.querySelector('.sb-update .sb-label').textContent")
        assert 'v0.9.5-f1' in txt, f'got: {txt!r}'
    await check('T2 status bar shows v0.9.5-f1', t2)

    # ── T3: switch to Exec tab ────────────────────────────────
    async def t3():
        await cdp.eval(
            "document.querySelector('.tab-btn[data-tab-id=\"exec\"]').click()"
        )
        await wait_until(
            cdp,
            "!!document.querySelector('#exec-cat-list .cat-name')",
            timeout=4,
        )
        cats = await cdp.eval(
            "[...document.querySelectorAll('#exec-cat-list .cat-name')].map(x => x.textContent)"
        )
        assert 'System' in cats, f'got cats: {cats!r}'
    await check('T3 Exec tab renders categories', t3)

    # ── T4: add category via "+", empty name → error stays ────
    async def t4():
        await cdp.eval(
            "document.querySelector('#panel-exec .btn-small').click()"
        )
        await wait_until(cdp, "!!document.querySelector('.modal-overlay input#cat-name-input')")
        # Leave name empty, click Confirm
        await cdp.eval(
            "document.querySelector('.modal-overlay .modal-actions button:last-child').click()"
        )
        # Error text should appear
        await wait_until(
            cdp,
            "document.querySelector('.modal-overlay .modal-error')?.style.display !== 'none' && "
            "document.querySelector('.modal-overlay .modal-error')?.textContent.includes('required')",
            timeout=2,
        )
        # Modal still open
        still = await cdp.eval("!!document.querySelector('.modal-overlay')")
        assert still, 'modal should stay open'
    await check('T4 empty Confirm shows error, modal stays open', t4)

    # ── T5: fill name + Confirm → category appears ────────────
    async def t5():
        await cdp.eval(
            "const el=document.querySelector('#cat-name-input');"
            "el.value='CDPTest';"
            "el.dispatchEvent(new Event('input'));"
        )
        await cdp.eval(
            "document.querySelector('.modal-overlay .modal-actions button:last-child').click()"
        )
        await wait_until(
            cdp,
            "![...document.querySelectorAll('.modal-overlay')].length",
            timeout=3,
        )
        cats = await cdp.eval(
            "[...document.querySelectorAll('#exec-cat-list .cat-name')].map(x => x.textContent)"
        )
        assert 'CDPTest' in cats, f'cats: {cats!r}'
    await check('T5 Confirm with name creates category', t5)

    # ── T6: template picker opens from New Command modal ──────
    async def t6():
        await cdp.eval("document.getElementById('add-cmd-btn').click()")
        await wait_until(cdp, "!!document.querySelector('#cmd-tpl-btn')", timeout=3)
        await cdp.eval("document.getElementById('cmd-tpl-btn').click()")
        try:
            await wait_until(
                cdp,
                "document.querySelectorAll('.modal-overlay').length >= 2",
                timeout=4,
            )
        except TimeoutError:
            diag = await cdp.eval(
                "JSON.stringify({ overlays: document.querySelectorAll('.modal-overlay').length, "
                "radios: document.querySelectorAll('input[name=\"tpl-type\"]').length, "
                "html: (document.body.innerText || '').slice(-300) })"
            )
            raise RuntimeError(f'Template picker did not open. Diag: {diag}')
        await wait_until(
            cdp,
            "!!document.querySelector('input[name=\"tpl-type\"][value=\"scp\"]')",
            timeout=2,
        )
        # Pick SCP
        await cdp.eval(
            "const r=document.querySelector('input[name=\"tpl-type\"][value=\"scp\"]');"
            "r.checked=true; r.dispatchEvent(new Event('change'));"
        )
        # Confirm picker (topmost)
        await cdp.eval(
            "[...document.querySelectorAll('.modal-overlay')].pop()"
            ".querySelector('.modal-actions button:last-child').click()"
        )
        # SCP form should appear
        await wait_until(
            cdp,
            "!!document.getElementById('scp-src-path')",
            timeout=3,
        )
    await check('T6 template picker opens & SCP form loads', t6)

    # ── T7: SCP generation fills cmd textarea ─────────────────
    async def t7():
        await cdp.eval(
            "document.getElementById('scp-src-path').value='/tmp/src.txt';"
            "document.getElementById('scp-dst-path').value='/tmp/dst.txt';"
            "document.getElementById('scp-src-host').value='__local__';"
            # pick a non-local dst (first vps)
            "const sel=document.getElementById('scp-dst-host');"
            "const nonlocal=[...sel.options].find(o=>o.value!=='__local__');"
            "if(nonlocal) sel.value=nonlocal.value;"
        )
        await cdp.eval(
            "[...document.querySelectorAll('.modal-overlay')].pop()"
            ".querySelector('.modal-actions button:last-child').click()"
        )
        # Wait for SCP modal to close (only one overlay left: New Command)
        await wait_until(
            cdp, "document.querySelectorAll('.modal-overlay').length === 1",
            timeout=3,
        )
        cmd = await cdp.eval("document.getElementById('cmd-command').value")
        assert cmd.startswith('scp '), f'unexpected cmd: {cmd!r}'
        assert 'src.txt' in cmd and 'dst.txt' in cmd, cmd
    await check('T7 SCP template fills command textarea', t7)

    # ── T8: create group via mock ─────────────────────────────
    async def t8_create_group():
        result = await cdp.eval("""(async () => {
          const g = await window.__TAURI__.core.invoke('add_repo_group', { name: 'Databases', icon: '🗄', color: '#3b82f6' });
          const list = await window.__TAURI__.core.invoke('list_repo_groups');
          return { created: g, count: list.length, name: list[0]?.name };
        })()""")
        assert result['count'] == 1 and result['name'] == 'Databases', result
    await check('T8 create group via mock', t8_create_group)

    # ── T9: create group via UI (New Group modal) ─────────────
    async def t9_create_group_via_ui():
        # Navigate to Repo Search tab first
        await cdp.eval("document.querySelector('.tab-btn[data-tab-id=\"repo-search\"]').click()")
        await wait_until(cdp, "!!document.querySelector('.rs-tab-add')", timeout=5)
        await cdp.eval("document.querySelector('.rs-tab-add').click()")
        await wait_until(cdp, "!!document.querySelector('#g-name')", timeout=3)
        await cdp.eval("document.querySelector('#g-name').value='Airflow'; document.querySelector('#g-name').dispatchEvent(new Event('input'))")
        await cdp.eval("[...document.querySelectorAll('.modal-overlay')].pop().querySelector('.modal-actions button:last-child').click()")
        await wait_until(cdp, "[...document.querySelectorAll('.rs-tab')].some(b => b.textContent.includes('Airflow'))", timeout=3)
    await check('T9 create group via UI', t9_create_group_via_ui)

    # ── T10: remove_repo_group cascades repos to Ungrouped ────
    async def t10_remove_repo_group_cascade():
        setup = await cdp.eval("""(async () => {
          const g = await window.__TAURI__.core.invoke('add_repo_group', { name: 'CascadeGrp', icon: '', color: '#10b981' });
          await window.__TAURI__.core.invoke('add_repo', { name: 'cascade-repo', path: '/tmp/cascade-repo', color: '#fff', groupId: g.id });
          return g.id;
        })()""")
        await cdp.eval(f"window.__TAURI__.core.invoke('remove_repo_group', {{ id: {setup} }})")
        result = await cdp.eval("""(async () => {
          const repos = await window.__TAURI__.core.invoke('list_repos');
          const r = repos.find(x => x.name === 'cascade-repo');
          return { still_present: !!r, group_id: r?.group_id };
        })()""")
        assert result['still_present'] and result['group_id'] is None, result
    await check('T10 remove_repo_group cascades repos to Ungrouped', t10_remove_repo_group_cascade)

    async def t11_edit_repo_changes_group():
        await cdp.eval("""(async () => {
          await window.__TAURI__.core.invoke('add_repo', { name: 'test-repo', path: '/tmp/test-repo', color: '#fff', groupId: null });
          const g = await window.__TAURI__.core.invoke('add_repo_group', { name: 'TestGrp', icon: '', color: '#3b82f6' });
          await window.__TAURI__.core.invoke('update_repo', { oldName: 'test-repo', name: 'test-repo', path: '/tmp/test-repo', color: '#fff', groupId: g.id });
        })()""")
        result = await cdp.eval("""(async () => {
          const repos = await window.__TAURI__.core.invoke('list_repos');
          return repos.find(r => r.name === 'test-repo')?.group_id;
        })()""")
        assert isinstance(result, int), f'expected int, got {result!r}'
    await check('T11 update_repo changes group_id', t11_edit_repo_changes_group)

    # ── T12: delete active tab → fallback to All ──────────────
    async def t12_delete_active_tab_falls_back_to_all():
        gid = await cdp.eval("""(async () => {
          const g = await window.__TAURI__.core.invoke('add_repo_group', { name: 'Trash', icon: '', color: '#ef4444' });
          return g.id;
        })()""")
        # Refresh the tab strip so 'Trash' tab appears (mirrors what the UI does after add_repo_group)
        await cdp.eval("window.__rsRefreshAfterGroupDelete && window.__rsRefreshAfterGroupDelete()")
        await wait_until(cdp, "[...document.querySelectorAll('.rs-tab')].some(b => b.textContent.includes('Trash'))", timeout=3)
        # Activate the 'Trash' tab via click so activeTabId == gid
        await cdp.eval("""[...document.querySelectorAll('.rs-tab')].find(b => b.textContent.includes('Trash')).click()""")
        await wait_until(cdp, "[...document.querySelectorAll('.rs-tab.active')].some(b => b.textContent.includes('Trash'))", timeout=2)
        # Simulate the context-menu delete path: backend delete + UI reset
        await cdp.eval(f"""(async () => {{
          await window.__TAURI__.core.invoke('remove_repo_group', {{ id: {gid} }});
          // These two lines mirror what showGroupContextMenu's Delete handler does:
          // (mockable via the exposed hook)
          window.__rsRefreshAfterGroupDelete && window.__rsRefreshAfterGroupDelete();
        }})()""")
        # Wait a tick, then assert UI has 'All' active and 'Trash' is gone.
        await wait_until(cdp,
          "![...document.querySelectorAll('.rs-tab')].some(b => b.textContent.includes('Trash'))",
          timeout=3)
        active_label = await cdp.eval("document.querySelector('.rs-tab.active')?.textContent || ''")
        assert 'All' in active_label, f'expected All active, got {active_label!r}'
    await check('T12 delete active tab → fallback to All', t12_delete_active_tab_falls_back_to_all)

    # ── T13: Manage inner tab renders status table ────────────
    async def t13_manage_tab_renders():
        # Switch to repo-search tab
        await cdp.eval(
          'document.querySelector(\'.tab-btn[data-tab-id="repo-search"]\').click()'
        )
        await wait_until(cdp, "!!document.querySelector('.rs-inner-tab')", timeout=4)
        # Click the Manage inner tab
        await cdp.eval(
          "[...document.querySelectorAll('.rs-inner-tab')].find(b => b.textContent.includes('Manage')).click()"
        )
        # Expect at least one row
        await wait_until(
          cdp,
          "document.querySelectorAll('.rs-manage tbody tr').length >= 1",
          timeout=5,
        )
        rows = await cdp.eval(
          "[...document.querySelectorAll('.rs-manage tbody tr td:first-child')].map(td => td.textContent)"
        )
        assert 'snippets_helper' in rows or 'dags-core' in rows, rows
    await check('T13 Manage tab shows status table', t13_manage_tab_renders)

    # ── T14: expand/collapse file card ───────────────────────
    async def t14_expand_collapse_file_card():
        # Ensure we're on the Search inner tab
        await cdp.eval(
          "[...document.querySelectorAll('.rs-inner-tab')].find(b => b.textContent.includes('Search')).click()"
        )
        # The search results area is empty by default — we exercise the overlay directly
        # via the rs-fullscreen toggle elements: the test validates the DOM wiring,
        # since the actual expand button is only visible after a search.
        # Simulate a minimal expand/collapse by clicking any button with text 'Expand' if present;
        # otherwise skip gracefully by running a content search first.
        has_expand = await cdp.eval(
          "!!document.querySelector('[data-role=\"rs-expand\"]')"
        )
        if not has_expand:
          # Run a fake search so a result-card with Expand button appears.
          # Content search returns empty from mock; instead push a fake result via the UI shim:
          await cdp.eval("""(() => {
            // Render a fake file card manually in the results area
            const area = document.getElementById('rs-results');
            if (!area) return;
            area.innerHTML = `<div class="rs-file-card">
              <button data-role="rs-open" data-path="/tmp/sample.md" data-line="1">Open in editor</button>
              <button>Copy path</button>
              <button data-role="rs-expand" data-path="/tmp/sample.md">Expand ▸</button>
            </div>`;
          })()""")
        # Click expand
        await cdp.eval("document.querySelector('[data-role=\"rs-expand\"]').click()")
        await wait_until(cdp, "!!document.getElementById('rs-fullscreen-overlay')", timeout=3)
        # Click collapse
        await cdp.eval(
          "document.getElementById('rs-fullscreen-overlay').querySelector('[data-role=\"rs-collapse\"]').click()"
        )
        await wait_until(cdp, "!document.getElementById('rs-fullscreen-overlay')", timeout=3)
    await check('T14 expand/collapse file card', t14_expand_collapse_file_card)

    # ── T15: Tasks Pin updates pinned chip strip ─────────────
    async def t15_tasks_pin_updates_strip():
        await cdp.eval("document.querySelector('.tab-btn[data-tab-id=\"tasks\"]').click()")
        await wait_until(cdp, "!!document.querySelector('#tasks-pinned')", timeout=5)
        await wait_until(
            cdp,
            "[...document.querySelectorAll('#tasks-pinned .tasks-pinned-chip-label')]"
            ".some(x => x.textContent.includes('Pinned mock task'))",
            timeout=4,
        )

        await cdp.eval(
            "[...document.querySelectorAll('.task-title')]"
            ".find(x => x.textContent.includes('Pinned mock task')).click()"
        )
        await wait_until(
            cdp,
            "[...document.querySelectorAll('.task-editor-btn')]"
            ".some(x => x.textContent.includes('Pinned'))",
            timeout=3,
        )
        await cdp.eval(
            "[...document.querySelectorAll('.task-editor-btn')]"
            ".find(x => x.textContent.includes('Pinned')).click()"
        )
        await wait_until(
            cdp,
            "![...document.querySelectorAll('#tasks-pinned .tasks-pinned-chip-label')]"
            ".some(x => x.textContent.includes('Pinned mock task'))",
            timeout=3,
        )

        await cdp.eval(
            "[...document.querySelectorAll('.task-title')]"
            ".find(x => x.textContent.includes('Regular mock task')).click()"
        )
        await wait_until(
            cdp,
            "[...document.querySelectorAll('.task-editor-btn')]"
            ".some(x => x.textContent.trim().endsWith('Pin'))",
            timeout=3,
        )
        await cdp.eval(
            "[...document.querySelectorAll('.task-editor-btn')]"
            ".find(x => x.textContent.trim().endsWith('Pin')).click()"
        )
        await wait_until(
            cdp,
            "[...document.querySelectorAll('#tasks-pinned .tasks-pinned-chip-label')]"
            ".some(x => x.textContent.includes('Regular mock task'))",
            timeout=3,
        )
    await check('T15 Tasks Pin updates pinned strip', t15_tasks_pin_updates_strip)

    # ── T16: Tasks Focus view layout/search/outside pinned ──
    async def t16_tasks_focus_view_layout_search_and_outside_pin():
        await cdp.eval("document.querySelector('.tab-btn[data-tab-id=\"tasks\"]').click()")
        await wait_until(cdp, "!!document.querySelector('#tasks-layout-focus')", timeout=5)

        await cdp.eval("document.querySelector('#tasks-layout-focus').click()")
        await wait_until(cdp, "!!document.querySelector('#tasks-cards-scroll.focus')", timeout=3)

        modes = await cdp.eval(
            "[...document.querySelectorAll('.tasks-layout-mode')].map(x => x.title)"
        )
        assert modes == ['One column', 'Two columns', 'Focus view'], f'modes: {modes!r}'

        await wait_until(cdp, "!!document.querySelector('.tasks-focus-search')", timeout=3)
        await cdp.eval(
            "[...document.querySelectorAll('.tasks-focus-row-title')]"
            ".find(x => x.textContent.includes('Regular mock task')).click()"
        )
        await wait_until(
            cdp,
            "document.querySelector('.tasks-focus-detail .task-title')?.textContent.includes('Regular mock task')",
            timeout=3,
        )
        compact_by_default = await cdp.eval("!document.querySelector('.tasks-focus-detail .task-editor-body')")
        assert compact_by_default, 'Focus view should open selected task in compact mode by default'
        eye_active = await cdp.eval("!!document.querySelector('.tasks-focus-detail .task-hide-done-btn.active')")
        assert eye_active, 'Hide completed should be active by default'
        cb_text = await cdp.eval("document.querySelector('.tasks-focus-detail')?.textContent || ''")
        assert 'Regular todo visible' in cb_text, cb_text
        assert 'Regular done hidden' not in cb_text, cb_text

        await cdp.eval("document.querySelector('.tasks-focus-detail .task-icon-btn[title=\"Expand\"]').click()")
        await wait_until(cdp, "!!document.querySelector('.tasks-focus-detail .task-editor-title')", timeout=3)
        await cdp.eval("document.querySelector('.tasks-focus-detail .task-icon-btn[title=\"Collapse\"]').click()")
        await wait_until(cdp, "!document.querySelector('.tasks-focus-detail .task-editor-body')", timeout=3)

        row_titles = await cdp.eval(
            "[...document.querySelectorAll('.tasks-focus-row-title')].map(x => x.textContent.trim())"
        )
        assert 'Pinned mock task' in row_titles, row_titles
        assert 'Regular mock task' in row_titles, row_titles

        await cdp.eval(
            "(() => {"
            "const input=document.querySelector('.tasks-focus-search');"
            "input.value='regular';"
            "input.dispatchEvent(new Event('input', { bubbles: true }));"
            "})()"
        )
        searched = await cdp.eval(
            "[...document.querySelectorAll('.tasks-focus-row-title')].map(x => x.textContent.trim())"
        )
        assert searched == ['Regular mock task'], f'searched: {searched!r}'

        await cdp.eval(
            "(() => {"
            "const input=document.querySelector('.tasks-focus-search');"
            "input.value='';"
            "input.dispatchEvent(new Event('input', { bubbles: true }));"
            "})()"
        )
        await cdp.eval("document.querySelector('#tasks-cat-dropdown').click()")
        await wait_until(cdp, "!!document.querySelector('.tasks-dropdown-menu')", timeout=3)
        await cdp.eval(
            "[...document.querySelectorAll('.tasks-dropdown-item')]"
            ".find(x => x.textContent.includes('Work')).click()"
        )
        await wait_until(
            cdp,
            "[...document.querySelectorAll('.tasks-focus-row-title')]"
            ".every(x => !x.textContent.includes('Pinned personal task'))",
            timeout=3,
        )

        await cdp.eval(
            "[...document.querySelectorAll('#tasks-pinned .tasks-pinned-chip-label')]"
            ".find(x => x.textContent.includes('Pinned personal task')).click()"
        )
        await wait_until(
            cdp,
            "document.querySelector('.tasks-focus-outside-banner')?.textContent.includes('outside current filters')",
            timeout=3,
        )
        selected_title = await cdp.eval("document.querySelector('.tasks-focus-detail .task-title')?.textContent")
        assert selected_title == 'Pinned personal task', f'selected title: {selected_title!r}'
        detail_scroll = await cdp.eval("document.querySelector('.tasks-focus-detail')?.scrollTop")
        assert detail_scroll == 0, f'Focus detail should open at top, got scrollTop={detail_scroll!r}'

        await cdp.eval("document.querySelector('.tasks-focus-show-in-list').click()")
        await wait_until(
            cdp,
            "[...document.querySelectorAll('.tasks-focus-row-title')]"
            ".some(x => x.textContent.includes('Pinned personal task'))",
            timeout=3,
        )
        category_label = await cdp.eval("document.querySelector('#tasks-cat-dropdown')?.textContent")
        assert 'Personal' in category_label, f'category label: {category_label!r}'
    await check('T16 Tasks Focus view layout/search/outside pinned', t16_tasks_focus_view_layout_search_and_outside_pin)

    # ── T17: Snippets detail tabs are conditional ────────────
    async def t17_snippets_tabs_conditional():
        await open_shortcuts_tab()
        await cdp.eval(
            "[...document.querySelectorAll('#panel-shortcuts div')]"
            ".find(x => x.textContent.trim() === 'Minimal plain snippet').click()"
        )
        await wait_until(cdp, "document.body.innerText.includes('plain text only')", timeout=3)
        tabs_min = await cdp.eval(
            "[...document.querySelectorAll('.snippet-detail-tab')].map(x => x.textContent.trim())"
        )
        assert tabs_min == [], f'minimal tabs should be hidden when only Code exists: {tabs_min!r}'

        await cdp.eval(
            "[...document.querySelectorAll('#panel-shortcuts div')]"
            ".find(x => x.textContent.trim() === 'Python markdown block').click()"
        )
        await wait_until(cdp, "document.body.innerText.includes('Python markdown block')", timeout=3)
        tabs_full = await cdp.eval(
            "[...document.querySelectorAll('.snippet-detail-tab')].map(x => x.textContent.trim())"
        )
        assert tabs_full == ['Code', 'Description', 'Links', 'Note'], f'full tabs: {tabs_full!r}'
        iframe_count = await cdp.eval("document.querySelectorAll('#panel-shortcuts iframe').length")
        assert iframe_count == 0, f'embedded iframe should not render, got {iframe_count}'
    await check('T17 Snippets detail tabs are conditional', t17_snippets_tabs_conditional)

    # ── T18: Snippets Links tab exposes explicit actions ─────
    async def t18_snippets_links_tab_actions():
        await open_shortcuts_tab()
        await cdp.eval(
            "[...document.querySelectorAll('#panel-shortcuts div')]"
            ".find(x => x.textContent.trim() === 'Python markdown block').click()"
        )
        await cdp.eval(
            "[...document.querySelectorAll('.snippet-detail-tab')]"
            ".find(x => x.textContent.trim() === 'Links').click()"
        )
        await wait_until(cdp, "document.body.innerText.includes('Python docs')", timeout=3)
        rows = await cdp.eval("document.querySelectorAll('.snippet-link-row').length")
        assert rows == 2, f'link rows: {rows}'
        actions = await cdp.eval(
            "[...document.querySelectorAll('.snippet-link-row:first-child button')].map(x => x.title)"
        )
        assert actions == ['Open in browser', 'Open in app window'], f'actions: {actions!r}'
    await check('T18 Snippets Links tab exposes explicit actions', t18_snippets_links_tab_actions)

    # ── T19: Snippets Markdown code block copy ───────────────
    async def t19_snippets_markdown_code_copy():
        await open_shortcuts_tab()
        await cdp.eval(
            "[...document.querySelectorAll('#panel-shortcuts div')]"
            ".find(x => x.textContent.trim() === 'Python markdown block').click()"
        )
        await wait_until(cdp, "!!document.querySelector('.markdown-code-copy')", timeout=3)
        await cdp.eval(
            "window.__copiedText='';"
            "navigator.clipboard.writeText = async (text) => { window.__copiedText = text; };"
        )
        await cdp.eval("document.querySelector('.markdown-code-copy').click()")
        copied = await wait_until(
            cdp,
            "window.__copiedText.includes('print(\"hello\")') && window.__copiedText",
            timeout=3,
        )
        assert copied == 'print("hello")\nprint("world")', f'copied: {copied!r}'
    await check('T19 Snippets Markdown code block copy', t19_snippets_markdown_code_copy)

    # ── T20: New snippet editor focus + description collapse ─
    async def t20_snippets_new_editor_focus_and_description_collapse():
        await open_shortcuts_tab()
        await cdp.eval("document.querySelector('#panel-shortcuts button[title=\"Add shortcut\"]').click()")
        await wait_until(cdp, "!!document.querySelector('.modal-overlay input[placeholder=\"Name\"]')", timeout=3)
        active = await cdp.eval(
            "document.activeElement === document.querySelector('.modal-overlay input[placeholder=\"Name\"]')"
        )
        assert active, 'name input should be focused'
        desc_visible = await cdp.eval(
            "!![...document.querySelectorAll('.modal-overlay textarea')]"
            ".find(x => x.placeholder.startsWith('Description') && x.offsetParent !== null)"
        )
        assert not desc_visible, 'description textarea should be collapsed by default'
        badge = await cdp.eval(
            "document.querySelector('.snippet-editor-desc-toggle .snippet-editor-desc-badge')?.textContent"
        )
        assert badge == 'empty', f'description badge: {badge!r}'
    await check('T20 Snippets new editor focuses name and collapses description', t20_snippets_new_editor_focus_and_description_collapse)

    # ── T21: Toolbar code button inserts fenced block ────────
    async def t21_snippets_toolbar_code_block_insert():
        await open_shortcuts_tab()
        await cdp.eval("document.querySelector('#panel-shortcuts button[title=\"Add shortcut\"]').click()")
        await wait_until(cdp, "!!document.querySelector('.modal-overlay textarea[placeholder^=\"Value\"]')", timeout=3)
        await cdp.eval(
            "const ta=document.querySelector('.modal-overlay textarea[placeholder^=\"Value\"]');"
            "ta.focus(); ta.setSelectionRange(0,0);"
            "[...document.querySelectorAll('.modal-overlay .md-toolbar button')]"
            ".find(b => b.title === 'Code block').click();"
        )
        value = await cdp.eval("document.querySelector('.modal-overlay textarea[placeholder^=\"Value\"]').value")
        caret = await cdp.eval("document.querySelector('.modal-overlay textarea[placeholder^=\"Value\"]').selectionStart")
        assert value == '```\n\n```', f'value: {value!r}'
        assert caret == 4, f'caret: {caret}'
    await check('T21 Snippets toolbar inserts fenced code block', t21_snippets_toolbar_code_block_insert)

    # ── T22: Snippets tab hover uses readable tint ───────────
    async def t22_snippets_tab_hover_css():
        hover_rule = await cdp.eval("""(() => {
          for (const sheet of document.styleSheets) {
            let rules;
            try { rules = sheet.cssRules; } catch { continue; }
            for (const rule of rules) {
              if (rule.selectorText === '.snippet-detail-tab:hover') {
                return {
                  background: rule.style.background,
                  color: rule.style.color,
                  border: rule.style.borderBottomColor,
                };
              }
            }
          }
          return null;
        })()""")
        assert hover_rule, 'missing .snippet-detail-tab:hover rule'
        assert hover_rule['background'] == 'rgba(88, 166, 255, 0.18)', hover_rule
        assert hover_rule['color'] == 'rgb(255, 255, 255)', hover_rule
        assert hover_rule['border'] == 'rgb(121, 192, 255)', hover_rule
    await check('T22 Snippets tab hover uses readable tint', t22_snippets_tab_hover_css)

    # ── T23: Snippets code block headers and indented fences ─
    async def t23_snippets_code_block_headers_and_indented_fences():
        await open_shortcuts_tab()
        await cdp.eval(
            "[...document.querySelectorAll('#panel-shortcuts div')]"
            ".find(x => x.textContent.trim() === 'Indented fenced blocks').click()"
        )
        await wait_until(cdp, "document.querySelectorAll('.markdown-code-header').length === 3", timeout=3)
        labels = await cdp.eval(
            "[...document.querySelectorAll('.markdown-code-lang')].map(x => x.textContent.trim())"
        )
        assert labels == ['bash', 'sql', 'plain'], f'labels: {labels!r}'
        copies = await cdp.eval("document.querySelectorAll('.markdown-code-copy').length")
        assert copies == 3, f'copy buttons: {copies}'
        await cdp.eval(
            "window.__copiedText='';"
            "navigator.clipboard.writeText = async (text) => { window.__copiedText = text; };"
            "document.querySelector('.markdown-code-copy').click();"
        )
        copied = await wait_until(cdp, "window.__copiedText", timeout=3)
        assert 'echo ok' in copied, f'copied: {copied!r}'
        assert 'bash' not in copied, f'copied includes header: {copied!r}'
    await check('T23 Snippets code block headers and indented fences', t23_snippets_code_block_headers_and_indented_fences)

    # Summary
    print()
    passed = sum(1 for _, ok, _ in results if ok)
    total = len(results)
    print(f'=== {passed}/{total} passed ===')
    await ws.close()
    return 0 if passed == total else 1


async def main():
    with http_server(), chrome_cdp():
        try:
            rc = await run_tests()
        except Exception as e:
            print(f'FATAL: {e}')
            rc = 2
    sys.exit(rc)


if __name__ == '__main__':
    asyncio.run(main())
