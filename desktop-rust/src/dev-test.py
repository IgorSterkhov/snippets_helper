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
        await cdp.eval("""(() => {
          const input = document.querySelector('#panel-shortcuts .search-bar input');
          if (input && input.value) {
            input.value = '';
            input.dispatchEvent(new Event('input', { bubbles: true }));
          }
        })()""")
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

    # ── T2b: Help changelog shows frontend OTA notes ─────────
    async def t2b_help_changelog_shows_frontend_ota_notes():
        await cdp.eval("document.querySelector('.tab-btn[title=\"Help\"]').click()")
        await wait_until(cdp, "!!document.querySelector('.help-overlay')", timeout=3)
        await cdp.eval("document.querySelector('.help-tab-btn[data-tab-id=\"changelog\"]').click()")
        await wait_until(
            cdp,
            "document.querySelector('.help-changelog')?.textContent.includes('f-20260522-6')",
            timeout=3,
        )
        await cdp.eval("document.querySelector('.help-close-btn').click()")
        await wait_until(cdp, "!document.querySelector('.help-overlay')", timeout=3)
    await check('T2b Help changelog shows frontend OTA notes', t2b_help_changelog_shows_frontend_ota_notes)

    # ── T2c: Settings admin tab is gated by server flag ──────
    async def t2c_admin_settings_tab_visibility():
        await cdp.eval("""
          localStorage.setItem('mock.admin_me', JSON.stringify({
            user_id: 'mock-admin-user', name: 'Mock Admin', is_admin: false,
            media_quota_bytes: 1073741824, media_max_upload_bytes: 20971520,
            media_used_bytes: 0
          }));
          document.querySelector('.settings-overlay')?.remove();
          document.querySelector('.tab-btn[title="Settings"]').click();
        """)
        await wait_until(cdp, "!!document.querySelector('.settings-overlay')", timeout=3)
        await asyncio.sleep(0.3)
        hidden = await cdp.eval("![...document.querySelectorAll('.settings-tab-btn')].some(b => b.textContent.includes('Users / Limits'))")
        assert hidden

        await cdp.eval("""
          document.querySelector('.settings-overlay')?.remove();
          localStorage.setItem('mock.admin_me', JSON.stringify({
            user_id: 'mock-admin-user', name: 'Mock Admin', is_admin: true,
            media_quota_bytes: 1073741824, media_max_upload_bytes: 20971520,
            media_used_bytes: 12582912
          }));
          localStorage.setItem('mock.admin_users', JSON.stringify([{
            user_id: 'mock-admin-user', name: 'Mock Admin',
            created_at: new Date().toISOString(), last_seen_at: new Date().toISOString(),
            is_admin: true, media_quota_bytes: 1073741824,
            media_max_upload_bytes: 20971520, media_used_bytes: 12582912
          }]));
          document.querySelector('.tab-btn[title="Settings"]').click();
        """)
        await wait_until(cdp, "[...document.querySelectorAll('.settings-tab-btn')].some(b => b.textContent.includes('Users / Limits'))", timeout=3)
        await cdp.eval("[...document.querySelectorAll('.settings-tab-btn')].find(b => b.textContent.includes('Users / Limits')).click()")
        await wait_until(cdp, "document.body.textContent.includes('Mock Admin') && document.body.textContent.includes('Quota MB')", timeout=3)
        await cdp.eval("document.querySelector('.settings-overlay')?.remove()")
    await check('T2c Settings admin limits tab visibility', t2c_admin_settings_tab_visibility)

    # ── T2d: Tauri CSP permits public media previews ────────
    async def t2d_tauri_csp_allows_media_images():
        config_path = os.path.join(SRC_DIR, '..', 'src-tauri', 'tauri.conf.json')
        with open(config_path, 'r', encoding='utf-8') as f:
            config = json.load(f)
        csp = config['app']['security']['csp']
        assert 'img-src' in csp, csp
        img_directive = next((part.strip() for part in csp.split(';') if part.strip().startswith('img-src')), '')
        assert 'https:' in img_directive, img_directive
        assert 'data:' in img_directive, img_directive
        assert 'blob:' in img_directive, img_directive
    await check('T2d Tauri CSP allows media image previews', t2d_tauri_csp_allows_media_images)

    # ── T2e: Whisper live dictate UI + mock flow ──────────────
    async def t2e_whisper_live_dictate_ui_and_mock_flow():
        await cdp.eval("""(async () => {
          await window.__TAURI__.core.invoke('whisper_install_model', { name: 'ggml-small' });
          const settings = JSON.parse(localStorage.getItem('mock.settings') || '{}');
          settings['whisper.deepgram_api_key'] = 'dg_mock_key';
          settings['whisper.deepgram_model'] = 'nova-3';
          settings['whisper.deepgram_endpointing_ms'] = '300';
          localStorage.setItem('mock.settings', JSON.stringify(settings));
          document.querySelector('.tab-btn[data-tab-id="whisper"]').click();
        })()""")
        await wait_until(cdp, "!!document.querySelector('#panel-whisper #live-dictate-toggle')", timeout=5)
        label = await cdp.eval("document.querySelector('#panel-whisper #live-dictate-label')?.textContent || ''")
        assert 'Live dictate' in label, label

        await cdp.eval("document.querySelector('#panel-whisper #settings-btn').click()")
        await wait_until(cdp, "document.body.textContent.includes('Deepgram live dictation')", timeout=3)
        has_key = await cdp.eval("!!document.querySelector('.modal-overlay [data-key=\"whisper.deepgram_api_key\"]')")
        assert has_key, 'Deepgram API key input missing'
        await close_modals()
        await wait_until(cdp, "!document.querySelector('.modal-overlay')", timeout=3)

        await cdp.eval("""(() => {
          document.querySelector('#panel-whisper #live-dictate-toggle').click();
          document.querySelector('#panel-whisper #record-btn').click();
        })()""")
        await wait_until(
            cdp,
            "document.querySelector('#panel-whisper #state-chip')?.textContent.includes('live streaming')",
            timeout=4,
        )
        await wait_until(
            cdp,
            "(document.querySelector('#panel-whisper textarea')?.value || '').includes('Live mock transcript')",
            timeout=4,
        )
        await cdp.eval("document.querySelector('#panel-whisper #record-btn').click()")
        await wait_until(
            cdp,
            "[...document.querySelectorAll('#panel-whisper [data-provider=\"deepgram\"]')].length >= 1",
            timeout=4,
        )
    await check('T2e Whisper live dictate UI + mock flow', t2e_whisper_live_dictate_ui_and_mock_flow)

    # ── T2f: Whisper errors show persistent copyable dialog ──
    async def t2f_whisper_live_error_dialog():
        await close_modals()
        await cdp.eval("""(() => {
          const settings = JSON.parse(localStorage.getItem('mock.settings') || '{}');
          delete settings['whisper.deepgram_api_key'];
          settings['whisper.live_dictate'] = 'true';
          localStorage.setItem('mock.settings', JSON.stringify(settings));
          window.__mockClipboardText = '';
          document.querySelector('.tab-btn[data-tab-id="whisper"]').click();
        })()""")
        await wait_until(cdp, "!!document.querySelector('#panel-whisper #live-dictate-toggle')", timeout=5)
        await cdp.eval("""(() => {
          const toggle = document.querySelector('#panel-whisper #live-dictate-toggle');
          if (!toggle.checked) toggle.click();
          document.querySelector('#panel-whisper #record-btn').click();
        })()""")
        await wait_until(cdp, "!!document.querySelector('.error-dialog-overlay')", timeout=5)
        title = await cdp.eval("document.querySelector('.error-dialog h3')?.textContent.trim()")
        assert title == 'Whisper action failed', f'title: {title!r}'
        message = await cdp.eval("document.querySelector('.error-dialog-message')?.textContent || ''")
        assert 'Deepgram API key is missing' in message, f'message: {message!r}'
        details = await cdp.eval("document.querySelector('.error-dialog-details')?.textContent || ''")
        assert 'frontend_version' in details, f'details missing frontend_version: {details!r}'
        assert 'live_dictate' in details, f'details missing live_dictate: {details!r}'
        assert 'Deepgram API key is missing' in details, f'details missing error: {details!r}'
        await cdp.eval(
            "[...document.querySelectorAll('.error-dialog button')]"
            ".find(b => b.textContent.trim() === 'Copy error').click()"
        )
        copied = await wait_until(cdp, "window.__mockClipboardText", timeout=3)
        assert 'Whisper action failed' in copied, f'copied: {copied!r}'
        assert 'Deepgram API key is missing' in copied, f'copied missing error: {copied!r}'
        await cdp.eval("""(() => {
          [...document.querySelectorAll('.error-dialog button')]
            .find(b => b.textContent.trim() === 'OK').click();
          const settings = JSON.parse(localStorage.getItem('mock.settings') || '{}');
          settings['whisper.deepgram_api_key'] = 'dg_mock_key';
          localStorage.setItem('mock.settings', JSON.stringify(settings));
        })()""")
        await wait_until(cdp, "!document.querySelector('.error-dialog-overlay')", timeout=3)
    await check('T2f Whisper live errors show diagnostics', t2f_whisper_live_error_dialog)

    # ── T2g: Whisper overlay has clickable active controls ───
    async def t2g_whisper_overlay_static_contract():
        overlay_html_path = os.path.join(SRC_DIR, 'tabs', 'whisper', 'whisper-overlay.html')
        overlay_js_path = os.path.join(SRC_DIR, 'tabs', 'whisper', 'whisper-overlay.js')
        with open(overlay_html_path, 'r', encoding='utf-8') as f:
            overlay_html = f.read()
        with open(overlay_js_path, 'r', encoding='utf-8') as f:
            overlay_js = f.read()
        assert 'id="status"' in overlay_html, 'overlay should show a persistent status line'
        assert 'id="ticker"' in overlay_html, 'overlay should show recent recognized words'
        assert 'pointerdown' in overlay_js, 'overlay buttons should react to pointer input'
        assert 'stopActive' in overlay_js, 'overlay stop should use provider-agnostic stop command'
        assert 'cancelActive' in overlay_js, 'overlay close should use provider-agnostic cancel command'
    await check('T2g Whisper overlay active controls', t2g_whisper_overlay_static_contract)

    # ── T2h: Whisper overlay bridge is robust in its own window ─
    async def t2h_whisper_overlay_bridge_contract():
        tauri_api_path = os.path.join(SRC_DIR, 'tauri-api.js')
        events_rs_path = os.path.join(SRC_DIR, '..', 'src-tauri', 'src', 'whisper', 'events.rs')
        service_rs_path = os.path.join(SRC_DIR, '..', 'src-tauri', 'src', 'whisper', 'service.rs')
        overlay_js_path = os.path.join(SRC_DIR, 'tabs', 'whisper', 'whisper-overlay.js')
        with open(tauri_api_path, 'r', encoding='utf-8') as f:
            tauri_api = f.read()
        with open(events_rs_path, 'r', encoding='utf-8') as f:
            events_rs = f.read()
        with open(service_rs_path, 'r', encoding='utf-8') as f:
            service_rs = f.read()
        with open(overlay_js_path, 'r', encoding='utf-8') as f:
            overlay_js = f.read()
        assert 'const { invoke } = window.__TAURI__.core' not in tauri_api, 'IPC bridge must not crash at module load when __TAURI__ is late'
        assert 'waitForTauriInvoke' in tauri_api, 'IPC bridge should wait briefly for Tauri injection'
        assert 'emit_to_whisper_windows' in events_rs, 'Whisper events should explicitly target main + overlay windows'
        assert 'emit_to(\"whisper-overlay\"' in events_rs, 'Overlay window must receive targeted events'
        assert '.work_area()' in service_rs, 'Overlay should be positioned inside monitor work area, not behind taskbar'
        assert 'Overlay JS ready' in overlay_js, 'Overlay should visibly prove that its JS initialized'
    await check('T2h Whisper overlay bridge contract', t2h_whisper_overlay_bridge_contract)

    # ── T2i: Whisper overlay remains hit-testable when inactive ─
    async def t2i_whisper_overlay_window_contract():
        config_path = os.path.join(SRC_DIR, '..', 'src-tauri', 'tauri.conf.json')
        service_rs_path = os.path.join(SRC_DIR, '..', 'src-tauri', 'src', 'whisper', 'service.rs')
        with open(config_path, 'r', encoding='utf-8') as f:
            config = json.load(f)
        overlay = next(
            (w for w in config.get('app', {}).get('windows', []) if w.get('label') == 'whisper-overlay'),
            None,
        )
        assert overlay is not None, 'whisper-overlay window config should exist'
        assert overlay.get('focus') is False, 'overlay should not steal focus from the dictation target on show'
        assert overlay.get('focusable') is True, 'overlay must remain focusable/clickable when the user clicks controls'
        assert overlay.get('acceptFirstMouse') is True, 'inactive overlay should pass the first mouse click through to controls'
        with open(service_rs_path, 'r', encoding='utf-8') as f:
            service_rs = f.read()
        assert 'set_ignore_cursor_events(false)' in service_rs, 'show_overlay should explicitly keep overlay hit-testable'
        assert 'OVERLAY_BOTTOM_SAFE_MARGIN_LOGICAL' in service_rs, 'bottom overlay placement should avoid auto-hide taskbars'
    await check('T2i Whisper overlay hit-test contract', t2i_whisper_overlay_window_contract)

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

    # ── T14b: Snippets pinned panel + rename chip ───────────
    async def t14b_snippets_pinned_panel_and_rename():
        await open_shortcuts_tab()
        await wait_until(cdp, "!!document.querySelector('#panel-shortcuts .snippet-panel-button')", timeout=4)
        await cdp.eval("document.querySelector('#panel-shortcuts .snippet-panel-button').click()")
        await wait_until(cdp, "!!document.querySelector('.snippet-panel-menu')", timeout=2)
        await cdp.eval(
            "[...document.querySelectorAll('.snippet-panel-menu .snippet-sort-menu-item')]"
            ".find(x => x.textContent.includes('Pinned')).click()"
        )
        await wait_until(
            cdp,
            "document.querySelector('#panel-shortcuts .snippet-panel-button')?.textContent.includes('Pinned')",
            timeout=2,
        )
        await cdp.eval("[...document.querySelectorAll('#panel-shortcuts .shortcut-list-name')].find(x => x.textContent.includes('SELECT all')).click()")
        await wait_until(cdp, "!!document.querySelector('#panel-shortcuts .snippet-pin-button')", timeout=3)
        await cdp.eval("document.querySelector('#panel-shortcuts .snippet-pin-button').click()")
        await wait_until(
            cdp,
            "[...document.querySelectorAll('#panel-shortcuts .snippet-pinned-chip-label')]"
            ".some(x => x.textContent.includes('SELECT all'))",
            timeout=3,
        )
        chip_icon = await cdp.eval(
            "document.querySelector('#panel-shortcuts .snippet-pinned-chip-icon')?.textContent.trim()"
        )
        assert chip_icon == '📌', f'pinned chip icon: {chip_icon!r}'
        await cdp.eval("[...document.querySelectorAll('#panel-shortcuts button')].find(x => x.textContent === 'Edit').click()")
        await wait_until(cdp, "!!document.querySelector('.modal-overlay .modal-body input[type=\"text\"]')", timeout=3)
        await cdp.eval("""(() => {
          const input = document.querySelector('.modal-overlay .modal-body input[type="text"]');
          input.value = 'SELECT all pinned renamed';
          input.dispatchEvent(new Event('input', { bubbles: true }));
          [...document.querySelectorAll('.modal-overlay .modal-actions button')].pop().click();
        })()""")
        await wait_until(
            cdp,
            "[...document.querySelectorAll('#panel-shortcuts .snippet-pinned-chip-label')]"
            ".some(x => x.textContent.includes('SELECT all pinned renamed'))",
            timeout=4,
        )
        await cdp.eval("""(() => {
          const items = JSON.parse(localStorage.getItem('mock.shortcuts') || '[]');
          for (const item of items) {
            if (item.name === 'SELECT all pinned renamed') {
              item.name = 'SELECT all';
              item.is_pinned = false;
              item.pinned_sort_order = 0;
              item.updated_at = new Date().toISOString();
            }
          }
          localStorage.setItem('mock.shortcuts', JSON.stringify(items));
        })()""")
        await cdp.eval("document.querySelector('#panel-shortcuts .snippet-panel-button').click()")
        await wait_until(cdp, "!!document.querySelector('.snippet-panel-menu')", timeout=2)
        await cdp.eval(
            "[...document.querySelectorAll('.snippet-panel-menu .snippet-sort-menu-item')]"
            ".find(x => x.textContent.includes('Tags')).click()"
        )
        await wait_until(
            cdp,
            "document.querySelector('#panel-shortcuts .snippet-panel-button')?.textContent.includes('Tags')",
            timeout=2,
        )
    await check('T14b Snippets pinned panel + rename chip', t14b_snippets_pinned_panel_and_rename)

    # ── T14d: Snippets share link modal ────────────────────
    async def t14d_snippets_share_link_modal():
        await open_shortcuts_tab()
        await cdp.eval("[...document.querySelectorAll('#panel-shortcuts .shortcut-list-name')].find(x => x.textContent.includes('SELECT all')).click()")
        await wait_until(cdp, "!!document.querySelector('#panel-shortcuts .snippet-detail-actions')", timeout=3)
        toolbar_text = await cdp.eval(
            "[...document.querySelectorAll('#panel-shortcuts .snippet-detail-actions button')]"
            ".map(b => b.textContent.trim()).join('|')"
        )
        assert toolbar_text.startswith('📌|🔗|Copy|Edit|Del'), toolbar_text
        chip_icon = await cdp.eval(
            "document.querySelector('#panel-shortcuts .snippet-pinned-chip-icon')?.textContent.trim() || ''"
        )
        if chip_icon:
            assert chip_icon == '📌', f'pinned chip icon: {chip_icon!r}'
        await cdp.eval(
            "[...document.querySelectorAll('#panel-shortcuts .snippet-detail-actions button')]"
            ".find(b => b.textContent.trim() === '🔗').click()"
        )
        await wait_until(cdp, "document.body.innerText.includes('Share link')", timeout=3)
        await cdp.eval("[...document.querySelectorAll('.share-link-actions button')].find(b => b.textContent === 'Create link').click()")
        await wait_until(cdp, "!document.body.innerText.includes('Share link')", timeout=3)
        await cdp.eval(
            "[...document.querySelectorAll('#panel-shortcuts .snippet-detail-actions button')]"
            ".find(b => b.textContent.trim() === '🔗').click()"
        )
        await wait_until(cdp, "document.body.innerText.includes('Public live link is active')", timeout=3)
        await cdp.eval("[...document.querySelectorAll('.share-link-actions button')].find(b => b.textContent === 'Revoke').click()")
        await wait_until(cdp, "!document.body.innerText.includes('Share link')", timeout=3)
    await check('T14d Snippets share link modal', t14d_snippets_share_link_modal)

    # ── T14c: Notes pinned chips drag reorder ────────────────
    async def t14c_notes_pinned_chip_drag_reorder():
        await cdp.eval("""(() => {
          const stamp = new Date().toISOString();
          localStorage.setItem('mock.notes', JSON.stringify([
            { id: 1, uuid: 'note-a', folder_id: 1, title: 'Pinned note A', content: 'A', is_pinned: true, pinned_sort_order: 0, created_at: stamp, updated_at: stamp },
            { id: 2, uuid: 'note-b', folder_id: 1, title: 'Pinned note B', content: 'B', is_pinned: true, pinned_sort_order: 1, created_at: stamp, updated_at: stamp }
          ]));
        })()""")
        await cdp.eval("document.querySelector('.tab-btn[data-tab-id=\"notes\"]').click()")
        await wait_until(cdp, "document.querySelectorAll('#pinned-chips .pinned-chip').length >= 2", timeout=5)
        before = await cdp.eval(
            "[...document.querySelectorAll('#pinned-chips .pinned-chip-label')]"
            ".map(x => x.textContent.trim())"
        )
        assert before == ['Pinned note A', 'Pinned note B'], f'initial notes chips: {before!r}'

        await cdp.eval("""(async () => {
          const chips = [...document.querySelectorAll('#pinned-chips .pinned-chip')];
          const from = chips[1];
          const to = chips[0];
          const fr = from.getBoundingClientRect();
          const tr = to.getBoundingClientRect();
          const sx = fr.left + fr.width / 2;
          const sy = fr.top + fr.height / 2;
          const tx = tr.left + 4;
          const ty = tr.top + tr.height / 2;
          const emit = (target, type, x, y, buttons = 1) => {
            target.dispatchEvent(new PointerEvent(type, {
              bubbles: true,
              cancelable: true,
              pointerId: 14,
              pointerType: 'mouse',
              button: 0,
              buttons,
              clientX: x,
              clientY: y,
            }));
          };
          emit(from, 'pointerdown', sx, sy);
          await new Promise(resolve => setTimeout(resolve, 30));
          emit(document, 'pointermove', sx - 16, sy);
          await new Promise(resolve => setTimeout(resolve, 30));
          emit(document, 'pointermove', tx, ty);
          await new Promise(resolve => setTimeout(resolve, 30));
          emit(document, 'pointerup', tx, ty, 0);
        })()""")

        await wait_until(
            cdp,
            "[...document.querySelectorAll('#pinned-chips .pinned-chip-label')]"
            "[0]?.textContent.trim() === 'Pinned note B'",
            timeout=3,
        )
        order = await cdp.eval("""(() => {
          return JSON.parse(localStorage.getItem('mock.notes') || '[]')
            .filter(n => n.is_pinned)
            .sort((a, b) => a.pinned_sort_order - b.pinned_sort_order)
            .map(n => n.title);
        })()""")
        assert order == ['Pinned note B', 'Pinned note A'], f'stored order: {order!r}'
    await check('T14c Notes pinned chips drag reorder', t14c_notes_pinned_chip_drag_reorder)

    # ── T14e: Notes share link modal ───────────────────────
    async def t14e_notes_share_link_modal():
        await close_modals()
        await cdp.eval("document.querySelector('.tab-btn[data-tab-id=\"notes\"]').click()")
        await wait_until(cdp, "!!document.querySelector('#panel-notes .note-card-title')", timeout=5)
        await cdp.eval("document.querySelector('#panel-notes .note-card-title').click()")
        await wait_until(cdp, "[...document.querySelectorAll('#panel-notes .note-toolbar button')].some(b => b.textContent.trim() === '🔗')", timeout=3)
        toolbar_text = await cdp.eval(
            "[...document.querySelectorAll('#panel-notes .note-toolbar button')]"
            ".map(b => b.textContent.trim()).join('|')"
        )
        assert toolbar_text.startswith('📌|🔗|Copy|'), toolbar_text
        await cdp.eval("[...document.querySelectorAll('#panel-notes .note-toolbar button')].find(b => b.textContent.trim() === '🔗').click()")
        await wait_until(cdp, "document.body.innerText.includes('Share link')", timeout=3)
        await cdp.eval("[...document.querySelectorAll('.share-link-actions button')].find(b => b.textContent === 'Create link').click()")
        await wait_until(cdp, "!document.body.innerText.includes('Share link')", timeout=3)
    await check('T14e Notes share link modal', t14e_notes_share_link_modal)

    # ── T14f: Notes share saves draft and syncs before create ──
    async def t14f_notes_share_autosaves_and_syncs_before_create():
        await close_modals()
        await cdp.eval("""window.__TAURI__.core.invoke('create_note', {
          folderId: 1,
          title: 'Share sync source',
          content: 'Initial content'
        })""")
        await cdp.eval("document.querySelector('.tab-btn[data-tab-id=\"notes\"]').click()")
        await wait_until(cdp, "!!document.querySelector('#panel-notes .notes-folder-item')", timeout=5)
        await cdp.eval(
            "[...document.querySelectorAll('#panel-notes .folder-name')]"
            ".find(x => x.textContent.trim() === 'Inbox').click()"
        )
        await wait_until(
            cdp,
            "[...document.querySelectorAll('#panel-notes .note-card-title')]"
            ".some(x => x.textContent.trim() === 'Share sync source')",
            timeout=5,
        )
        await cdp.eval(
            "[...document.querySelectorAll('#panel-notes .note-card-title')]"
            ".find(x => x.textContent.trim() === 'Share sync source').click()"
        )
        await wait_until(cdp, "!!document.querySelector('#panel-notes .note-toolbar')", timeout=3)
        await cdp.eval(
            "[...document.querySelectorAll('#panel-notes .note-toolbar button')]"
            ".find(b => b.textContent.trim() === 'Edit').click()"
        )
        await wait_until(cdp, "!!document.querySelector('#panel-notes .note-content-input')", timeout=3)
        await cdp.eval("""(() => {
          const title = document.querySelector('#panel-notes .note-title-input');
          const textarea = document.querySelector('#panel-notes .note-content-input');
          title.value = 'Share sync source edited';
          title.dispatchEvent(new Event('input', { bubbles: true }));
          textarea.value = 'Saved before share\\n\\n![share-image](https://ister-app.ru/snippets-media/mock-balanced.webp)';
          textarea.dispatchEvent(new Event('input', { bubbles: true }));
          window.__mockCommandLog = [];
          window.__mockCallSeq = 0;
          window.__mockLastNoteWriteCall = 0;
          window.__mockLastSyncCall = 0;
        })()""")
        await cdp.eval(
            "[...document.querySelectorAll('#panel-notes .note-toolbar button')]"
            ".find(b => b.textContent.trim() === '🔗').click()"
        )
        await wait_until(cdp, "document.body.innerText.includes('Share link')", timeout=3)
        await cdp.eval("[...document.querySelectorAll('.share-link-actions button')].find(b => b.textContent === 'Create link').click()")
        await wait_until(cdp, "!document.body.innerText.includes('Share link')", timeout=3)
        commands = await cdp.eval("window.__mockCommandLog.map(x => x.command)")
        assert 'update_note' in commands, f'commands: {commands!r}'
        assert 'trigger_sync' in commands, f'commands: {commands!r}'
        assert 'create_share_link' in commands, f'commands: {commands!r}'
        assert commands.index('update_note') < commands.index('trigger_sync') < commands.index('create_share_link'), commands
        saved_content = await cdp.eval(
            "JSON.parse(localStorage.getItem('mock.notes') || '[]')"
            ".find(n => n.title === 'Share sync source edited')?.content || ''"
        )
        assert '![share-image]' in saved_content, f'saved content: {saved_content!r}'
    await check('T14f Notes share autosaves and syncs before create', t14f_notes_share_autosaves_and_syncs_before_create)

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

    # ── T15b: Tasks pinned chips drag reorder ────────────────
    async def t15b_tasks_pinned_chip_drag_reorder():
        await cdp.eval("document.querySelector('.tab-btn[data-tab-id=\"tasks\"]').click()")
        await wait_until(cdp, "document.querySelectorAll('#tasks-pinned .tasks-pinned-chip').length >= 2", timeout=5)
        before = await cdp.eval(
            "[...document.querySelectorAll('#tasks-pinned .tasks-pinned-chip-label')]"
            ".map(x => x.textContent.trim())"
        )
        assert before[-1] == 'Pinned personal task', f'expected personal task last before drag, got {before!r}'

        await cdp.eval("""(async () => {
          const chips = [...document.querySelectorAll('#tasks-pinned .tasks-pinned-chip')];
          const from = chips[chips.length - 1];
          const to = chips[0];
          const fr = from.getBoundingClientRect();
          const tr = to.getBoundingClientRect();
          const sx = fr.left + fr.width / 2;
          const sy = fr.top + fr.height / 2;
          const tx = tr.left + 3;
          const ty = tr.top + tr.height / 2;
          const emit = (target, type, x, y, buttons = 1) => {
            target.dispatchEvent(new PointerEvent(type, {
              bubbles: true,
              cancelable: true,
              pointerId: 15,
              pointerType: 'mouse',
              button: 0,
              buttons,
              clientX: x,
              clientY: y,
            }));
          };
          emit(from, 'pointerdown', sx, sy);
          await new Promise(resolve => setTimeout(resolve, 30));
          emit(document, 'pointermove', sx - 16, sy);
          await new Promise(resolve => setTimeout(resolve, 30));
          emit(document, 'pointermove', tx, ty);
          await new Promise(resolve => setTimeout(resolve, 30));
          emit(document, 'pointerup', tx, ty, 0);
        })()""")

        await wait_until(
            cdp,
            "[...document.querySelectorAll('#tasks-pinned .tasks-pinned-chip-label')]"
            "[0]?.textContent.trim() === 'Pinned personal task'",
            timeout=3,
        )
        await cdp.eval("document.querySelector('#tasks-pinned .tasks-pinned-chip').click()")
        await wait_until(
            cdp,
            "document.querySelector('.task-editor-title')?.value === 'Pinned personal task'",
            timeout=3,
        )
    await check('T15b Tasks pinned chips drag reorder', t15b_tasks_pinned_chip_drag_reorder)

    # ── T15c: Checkbox DnD ignores hidden completed rows ────
    async def t15c_tasks_checkbox_drag_hidden_completed_context():
        await cdp.eval("""(() => {
          const stamp = new Date().toISOString();
          const rows = [
            {
              id: 10, task_id: 2, parent_id: null,
              text: 'Done parent with active child', is_checked: true,
              sort_order: 0, created_at: stamp, updated_at: stamp,
              sync_status: 'synced', user_id: 'mock-user',
            },
            {
              id: 11, task_id: 2, parent_id: 10,
              text: 'Active child under done parent', is_checked: false,
              sort_order: 0, created_at: stamp, updated_at: stamp,
              sync_status: 'synced', user_id: 'mock-user',
            },
            {
              id: 12, task_id: 2, parent_id: null,
              text: 'Hidden completed root', is_checked: true,
              sort_order: 1, created_at: stamp, updated_at: stamp,
              sync_status: 'synced', user_id: 'mock-user',
            },
            {
              id: 13, task_id: 2, parent_id: null,
              text: 'Visible root before', is_checked: false,
              sort_order: 2, created_at: stamp, updated_at: stamp,
              sync_status: 'synced', user_id: 'mock-user',
            },
            {
              id: 14, task_id: 2, parent_id: null,
              text: 'Visible root dragged', is_checked: false,
              sort_order: 3, created_at: stamp, updated_at: stamp,
              sync_status: 'synced', user_id: 'mock-user',
            },
          ];
          const others = JSON.parse(localStorage.getItem('mock.task_checkboxes') || '[]')
            .filter(x => x.task_id !== 2);
          localStorage.setItem('mock.task_checkboxes', JSON.stringify([...others, ...rows]));
          localStorage.setItem('mock.__seq.task_checkboxes', '14');
          window.dispatchEvent(new CustomEvent('snippets:sync-complete', {
            detail: {
              result: {
                timestamp: '12:00:00',
                push: { total: 0, pushed: {} },
                pull: { total: 1, pulled: { task_checkboxes: ['fixture'] } },
              },
            },
          }));
        })()""")
        await cdp.eval("document.querySelector('.tab-btn[data-tab-id=\"tasks\"]').click()")
        await wait_until(
            cdp,
            "[...document.querySelectorAll('.task-title')]"
            ".some(x => x.textContent.includes('Regular mock task'))",
            timeout=4,
        )
        await cdp.eval(
            "[...document.querySelectorAll('.task-title')]"
            ".find(x => x.textContent.includes('Regular mock task')).click()"
        )
        await wait_until(
            cdp,
            "[...document.querySelectorAll('.tcb-text')]"
            ".some(x => x.textContent.includes('Visible root dragged'))",
            timeout=4,
        )
        hidden_visible = await cdp.eval(
            "[...document.querySelectorAll('.tcb-text')]"
            ".some(x => x.textContent.includes('Hidden completed root'))"
        )
        assert hidden_visible is False, 'hidden completed root should not be visible in the DnD list'

        await cdp.eval("""(async () => {
          const rowByText = (text) => [...document.querySelectorAll('.tcb-item')]
            .find(row => row.querySelector('.tcb-text')?.textContent.includes(text));
          const from = rowByText('Visible root dragged');
          const before = rowByText('Visible root before');
          const handle = from.querySelector('[data-drag-kind="checkbox"]');
          const fr = handle.getBoundingClientRect();
          const br = before.getBoundingClientRect();
          const sx = fr.left + fr.width / 2;
          const sy = fr.top + fr.height / 2;
          const tx = sx;
          const ty = br.top + 2;
          const emit = (target, type, x, y, buttons = 1) => {
            target.dispatchEvent(new PointerEvent(type, {
              bubbles: true,
              cancelable: true,
              pointerId: 16,
              pointerType: 'mouse',
              button: 0,
              buttons,
              clientX: x,
              clientY: y,
            }));
          };
          emit(handle, 'pointerdown', sx, sy);
          await new Promise(resolve => setTimeout(resolve, 30));
          emit(document, 'pointermove', tx, ty);
          await new Promise(resolve => setTimeout(resolve, 30));
          emit(document, 'pointerup', tx, ty, 0);
        })()""")

        await wait_until(
            cdp,
            "(() => {"
            "const rows = JSON.parse(localStorage.getItem('mock.task_checkboxes') || '[]');"
            "const dragged = rows.find(x => x.id === 14);"
            "return dragged && dragged.sync_status === 'pending';"
            "})()",
            timeout=3,
        )
        parent_id = await cdp.eval("""(() => {
          const rows = JSON.parse(localStorage.getItem('mock.task_checkboxes') || '[]');
          return rows.find(x => x.id === 14)?.parent_id ?? null;
        })()""")
        assert parent_id is None, f'dragged root should stay root-level, got parent_id={parent_id!r}'
        await cdp.eval("""(() => {
          const stamp = new Date().toISOString();
          const restored = [
            {
              id: 1, task_id: 2, parent_id: null,
              text: 'Regular todo visible', is_checked: false,
              sort_order: 0, created_at: stamp, updated_at: stamp,
              sync_status: 'synced', user_id: 'mock-user',
            },
            {
              id: 2, task_id: 2, parent_id: null,
              text: 'Regular done hidden', is_checked: true,
              sort_order: 1, created_at: stamp, updated_at: stamp,
              sync_status: 'synced', user_id: 'mock-user',
            },
          ];
          const others = JSON.parse(localStorage.getItem('mock.task_checkboxes') || '[]')
            .filter(x => x.task_id !== 2);
          localStorage.setItem('mock.task_checkboxes', JSON.stringify([...others, ...restored]));
          localStorage.setItem('mock.__seq.task_checkboxes', '2');
          window.dispatchEvent(new CustomEvent('snippets:sync-complete', {
            detail: {
              result: {
                timestamp: '12:00:00',
                push: { total: 0, pushed: {} },
                pull: { total: 1, pulled: { task_checkboxes: ['restore'] } },
              },
            },
          }));
        })()""")
    await check('T15c Tasks checkbox DnD hidden completed context', t15c_tasks_checkbox_drag_hidden_completed_context)

    # ── T15d: Checkbox collapse survives frontend reload ─────
    async def t15d_tasks_checkbox_collapse_survives_reload():
        await cdp.eval("""(() => {
          const stamp = new Date().toISOString();
          const settings = JSON.parse(localStorage.getItem('mock.settings') || '{}');
          settings.last_active_tab = 'tasks';
          delete settings.tasks_collapsed_checkbox_ids;
          localStorage.setItem('mock.settings', JSON.stringify(settings));
          const rows = [
            {
              id: 20, task_id: 2, parent_id: null,
              text: 'OTA collapse parent', is_checked: false,
              sort_order: 0, created_at: stamp, updated_at: stamp,
              sync_status: 'synced', user_id: 'mock-user',
            },
            {
              id: 21, task_id: 2, parent_id: 20,
              text: 'OTA collapse child', is_checked: false,
              sort_order: 0, created_at: stamp, updated_at: stamp,
              sync_status: 'synced', user_id: 'mock-user',
            },
          ];
          const others = JSON.parse(localStorage.getItem('mock.task_checkboxes') || '[]')
            .filter(x => x.task_id !== 2);
          localStorage.setItem('mock.task_checkboxes', JSON.stringify([...others, ...rows]));
          localStorage.setItem('mock.__seq.task_checkboxes', '21');
          window.dispatchEvent(new CustomEvent('snippets:sync-complete', {
            detail: {
              result: {
                timestamp: '12:00:00',
                push: { total: 0, pushed: {} },
                pull: { total: 1, pulled: { task_checkboxes: ['collapse fixture'] } },
              },
            },
          }));
        })()""")
        await cdp.eval("document.querySelector('.tab-btn[data-tab-id=\"tasks\"]').click()")
        await wait_until(
            cdp,
            "[...document.querySelectorAll('.task-title')]"
            ".some(x => x.textContent.includes('Regular mock task'))",
            timeout=4,
        )
        await cdp.eval(
            "[...document.querySelectorAll('.task-title')]"
            ".find(x => x.textContent.includes('Regular mock task')).click()"
        )
        await wait_until(
            cdp,
            "[...document.querySelectorAll('.tcb-text')]"
            ".some(x => x.textContent.includes('OTA collapse child'))",
            timeout=4,
        )
        await cdp.eval("""(() => {
          const row = [...document.querySelectorAll('.tcb-item')]
            .find(x => x.querySelector('.tcb-text')?.textContent.includes('OTA collapse parent'));
          row?.querySelector('.tcb-arrow')?.click();
        })()""")
        await wait_until(
            cdp,
            "![...document.querySelectorAll('.tcb-text')]"
            ".some(x => x.textContent.includes('OTA collapse child'))",
            timeout=3,
        )

        await cdp.send('Page.reload', ignoreCache=True)
        await wait_until(cdp, "!!document.querySelector('.tab-btn')", timeout=8)
        await wait_until(cdp, "!!window.__TAURI__ && !!window.__TAURI__.core", timeout=5)
        await cdp.eval("document.querySelector('.tab-btn[data-tab-id=\"tasks\"]').click()")
        await wait_until(
            cdp,
            "[...document.querySelectorAll('.task-title')]"
            ".some(x => x.textContent.includes('Regular mock task'))",
            timeout=4,
        )
        await cdp.eval(
            "[...document.querySelectorAll('.task-title')]"
            ".find(x => x.textContent.includes('Regular mock task')).click()"
        )
        await wait_until(
            cdp,
            "[...document.querySelectorAll('.tcb-text')]"
            ".some(x => x.textContent.includes('OTA collapse parent'))",
            timeout=4,
        )
        child_visible = await cdp.eval(
            "[...document.querySelectorAll('.tcb-text')]"
            ".some(x => x.textContent.includes('OTA collapse child'))"
        )
        assert child_visible is False, 'collapsed child became visible after frontend reload'

        await cdp.eval("""(() => {
          const stamp = new Date().toISOString();
          const settings = JSON.parse(localStorage.getItem('mock.settings') || '{}');
          delete settings.tasks_collapsed_checkbox_ids;
          localStorage.setItem('mock.settings', JSON.stringify(settings));
          const restored = [
            {
              id: 1, task_id: 2, parent_id: null,
              text: 'Regular todo visible', is_checked: false,
              sort_order: 0, created_at: stamp, updated_at: stamp,
              sync_status: 'synced', user_id: 'mock-user',
            },
            {
              id: 2, task_id: 2, parent_id: null,
              text: 'Regular done hidden', is_checked: true,
              sort_order: 1, created_at: stamp, updated_at: stamp,
              sync_status: 'synced', user_id: 'mock-user',
            },
          ];
          const others = JSON.parse(localStorage.getItem('mock.task_checkboxes') || '[]')
            .filter(x => x.task_id !== 2);
          localStorage.setItem('mock.task_checkboxes', JSON.stringify([...others, ...restored]));
          localStorage.setItem('mock.__seq.task_checkboxes', '2');
          window.dispatchEvent(new CustomEvent('snippets:sync-complete', {
            detail: {
              result: {
                timestamp: '12:00:00',
                push: { total: 0, pushed: {} },
                pull: { total: 1, pulled: { task_checkboxes: ['restore'] } },
              },
            },
          }));
        })()""")
    await check('T15d Tasks checkbox collapse survives frontend reload', t15d_tasks_checkbox_collapse_survives_reload)

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
        focus_body_style = await cdp.eval("""(() => {
          const body = document.querySelector('.tasks-focus-detail .task-card-body');
          const st = getComputedStyle(body);
          return { maxHeight: st.maxHeight, overflowY: st.overflowY };
        })()""")
        assert focus_body_style == {'maxHeight': 'none', 'overflowY': 'visible'}, focus_body_style

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

    # ── T16b: Tasks refresh checkbox state after sync pull ───
    async def t16b_tasks_refresh_after_sync_pull():
        await cdp.eval("document.querySelector('.tab-btn[data-tab-id=\"tasks\"]').click()")
        await wait_until(cdp, "!!document.querySelector('#tasks-layout-one')", timeout=5)
        await cdp.eval("document.querySelector('#tasks-layout-one').click()")
        await wait_until(cdp, "!!document.querySelector('#tasks-cards-scroll.one-col')", timeout=3)

        for dropdown_id in ['tasks-cat-dropdown', 'tasks-status-dropdown']:
            await cdp.eval(f"document.querySelector('#{dropdown_id}').click()")
            await wait_until(cdp, "!!document.querySelector('.tasks-dropdown-menu')", timeout=3)
            await cdp.eval(
                "[...document.querySelectorAll('.tasks-dropdown-item')]"
                ".find(x => x.textContent.includes('All')).click()"
            )
            await wait_until(cdp, "!document.querySelector('.tasks-dropdown-menu')", timeout=3)

        await wait_until(
            cdp,
            "[...document.querySelectorAll('.task-title')]"
            ".some(x => x.textContent.includes('Regular mock task'))",
            timeout=3,
        )
        await cdp.eval(
            "[...document.querySelectorAll('.task-title')]"
            ".find(x => x.textContent.includes('Regular mock task')).click()"
        )
        await wait_until(
            cdp,
            "[...document.querySelectorAll('.tcb-text')]"
            ".some(x => x.textContent.includes('Regular todo visible'))",
            timeout=3,
        )
        await cdp.eval("""(() => {
          const card = [...document.querySelectorAll('.task-card')]
            .find(x => x.querySelector('.task-title')?.textContent.includes('Regular mock task'));
          const activeEye = card?.querySelector('.task-hide-done-btn.active');
          if (activeEye) activeEye.click();
        })()""")
        initial_checked = await cdp.eval("""(() => {
          const row = [...document.querySelectorAll('.tcb-item')]
            .find(x => x.textContent.includes('Regular todo visible'));
          return row?.querySelector('input[type="checkbox"]')?.checked;
        })()""")
        assert initial_checked is False, f'checkbox should start unchecked, got {initial_checked!r}'

        await cdp.eval("""(() => {
          window.__mockTriggerSync = () => {
            const key = 'mock.task_checkboxes';
            const items = JSON.parse(localStorage.getItem(key) || '[]');
            const idx = items.findIndex(x => x.text === 'Regular todo visible');
            if (idx >= 0) {
              items[idx] = { ...items[idx], is_checked: true, updated_at: new Date().toISOString() };
              localStorage.setItem(key, JSON.stringify(items));
            }
            return {
              timestamp: '12:00:00',
              push: { total: 0, pushed: {} },
              pull: { total: 1, pulled: { task_checkboxes: ['Regular todo visible'] } },
            };
          };
          document.querySelector('.sb-sync').click();
        })()""")
        await wait_until(
            cdp,
            "(() => {"
            "const row = [...document.querySelectorAll('.tcb-item')]"
            ".find(x => x.textContent.includes('Regular todo visible'));"
            "return row?.querySelector('input[type=\"checkbox\"]')?.checked === true;"
            "})()",
            timeout=3,
        )
        await cdp.eval("delete window.__mockTriggerSync")
    await check('T16b Tasks refresh after sync pull', t16b_tasks_refresh_after_sync_pull)

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

    # ── T21b: Image upload modal inserts Markdown + figure ───
    async def t21b_snippets_image_upload_modal_and_figure():
        await cdp.eval("document.querySelector('.modal-overlay')?.remove()")
        await open_shortcuts_tab()
        await cdp.eval("document.querySelector('#panel-shortcuts button[title=\"Add shortcut\"]').click()")
        await wait_until(cdp, "!!document.querySelector('.modal-overlay textarea[placeholder^=\"Value\"]')", timeout=3)
        await wait_until(
            cdp,
            "[...document.querySelectorAll('.modal-overlay .md-toolbar button')].some(b => b.title === 'Image' || b.textContent.includes('🖼'))",
            timeout=3,
        )
        await cdp.eval(
            "const buttons=[...document.querySelectorAll('.modal-overlay .md-toolbar button')];"
            "const btn=buttons.find(b => b.title === 'Image' || b.textContent.includes('🖼'));"
            "if (!btn) throw new Error(buttons.map(b => `${b.title}:${b.textContent}`).join('|'));"
            "btn.click();"
        )
        await wait_until(cdp, "!!document.querySelector('.image-upload-overlay')", timeout=3)
        await cdp.eval(
            "(() => {"
            "const btn=document.querySelector('.image-upload-overlay .image-upload-picker button');"
            "if (!btn) throw new Error(document.querySelector('.image-upload-overlay')?.innerHTML || 'missing image picker');"
            "btn.click();"
            "})()"
        )
        await wait_until(
            cdp,
            "[...document.querySelectorAll('.image-upload-overlay .image-upload-presets button')]"
            ".some(b => b.textContent.trim() === 'Readable' && !b.disabled)",
            timeout=3,
        )
        await cdp.eval(
            "[...document.querySelectorAll('.image-upload-overlay .image-upload-presets button')]"
            ".find(b => b.textContent.trim() === 'Readable').click()"
        )
        await wait_until(cdp, "!!document.querySelector('.image-upload-overlay .image-upload-preview img')", timeout=3)
        await cdp.eval("document.querySelector('.image-upload-overlay .image-upload-preview img').click()")
        await wait_until(cdp, "!!document.querySelector('.image-full-preview img')", timeout=3)
        await cdp.eval("document.querySelector('.image-full-preview')?.remove()")
        await wait_until(cdp, "!document.querySelector('.image-upload-footer button').disabled", timeout=3)
        await cdp.eval(
            "(() => {"
            "const btn=document.querySelector('.image-upload-overlay .image-upload-footer button');"
            "if (!btn) throw new Error(document.querySelector('.image-upload-overlay')?.innerHTML || 'missing insert button');"
            "btn.click();"
            "})()"
        )
        value = await wait_until(
            cdp,
            "document.querySelector('.modal-overlay textarea[placeholder^=\"Value\"]')?.value.includes('mock-readable.webp') && document.querySelector('.modal-overlay textarea[placeholder^=\"Value\"]').value",
            timeout=3,
        )
        assert '![mock-image]' in value
        assert 'mock-readable.webp' in value
        await cdp.eval("""(() => {
          const editor = [...document.querySelectorAll('.modal-overlay')]
            .find(x => !x.classList.contains('image-upload-overlay') && x.querySelector('input[placeholder="Name"]'));
          if (!editor) throw new Error('missing snippet editor modal');
          const name = editor.querySelector('input[placeholder="Name"]');
          name.value = 'Image markdown';
          name.dispatchEvent(new Event('input', { bubbles: true }));
          const confirm = [...editor.querySelectorAll('.modal-actions button')]
            .find(x => x.textContent.trim() === 'Confirm');
          if (!confirm) throw new Error('missing editor confirm button');
          confirm.click();
        })()""")
        await wait_until(
            cdp,
            "[...document.querySelectorAll('#panel-shortcuts .shortcut-list-item .shortcut-list-name')].some(x => x.textContent.trim() === 'Image markdown')",
            timeout=3,
        )
        await cdp.eval(
            "[...document.querySelectorAll('#panel-shortcuts .shortcut-list-item .shortcut-list-name')]"
            ".find(x => x.textContent.trim() === 'Image markdown').click()"
        )
        await wait_until(cdp, "!!document.querySelector('.markdown-figure-card')", timeout=3)
    await check('T21b Snippets image upload modal and figure card', t21b_snippets_image_upload_modal_and_figure)

    # ── T21c: Notes image upload toolbar renders Figure Card ─
    async def t21c_notes_image_upload_modal_and_figure():
        await close_modals()
        await cdp.eval("document.querySelector('.tab-btn[data-tab-id=\"notes\"]').click()")
        await wait_until(cdp, "!!document.querySelector('#panel-notes button')", timeout=5)
        await cdp.eval(
            "[...document.querySelectorAll('#panel-notes button')]"
            ".find(b => b.textContent.includes('New Note')).click()"
        )
        await wait_until(cdp, "!!document.querySelector('#panel-notes .note-content-input')", timeout=3)
        await wait_until(
            cdp,
            "[...document.querySelectorAll('#panel-notes .md-toolbar button')].some(b => b.title === 'Image')",
            timeout=3,
        )
        await cdp.eval(
            "[...document.querySelectorAll('#panel-notes .md-toolbar button')]"
            ".find(b => b.title === 'Image').click()"
        )
        await wait_until(cdp, "!!document.querySelector('.image-upload-overlay')", timeout=3)
        await cdp.eval(
            "(() => {"
            "const btn=document.querySelector('.image-upload-overlay .image-upload-picker button');"
            "btn.click();"
            "})()"
        )
        await wait_until(cdp, "!document.querySelector('.image-upload-footer button').disabled", timeout=3)
        await cdp.eval("document.querySelector('.image-upload-footer button').click()")
        note_value = await wait_until(
            cdp,
            "document.querySelector('#panel-notes .note-content-input')?.value.includes('mock-') && document.querySelector('#panel-notes .note-content-input').value",
            timeout=3,
        )
        assert '![mock-image]' in note_value
        await cdp.eval("[...document.querySelectorAll('#panel-notes .note-toolbar button')].find(b => b.textContent.trim() === 'Preview').click()")
        await wait_until(cdp, "!!document.querySelector('#panel-notes .markdown-figure-card')", timeout=3)
    await check('T21c Notes image upload modal and figure card', t21c_notes_image_upload_modal_and_figure)

    # ── T21d: Clipboard screenshot upload path works ─────────
    async def t21d_snippets_image_upload_from_clipboard():
        await close_modals()
        await open_shortcuts_tab()
        await cdp.eval("document.querySelector('#panel-shortcuts button[title=\"Add shortcut\"]').click()")
        await wait_until(cdp, "!!document.querySelector('.modal-overlay textarea[placeholder^=\"Value\"]')", timeout=3)
        await cdp.eval(
            "[...document.querySelectorAll('.modal-overlay .md-toolbar button')]"
            ".find(b => b.title === 'Image').click()"
        )
        await wait_until(cdp, "!!document.querySelector('.image-upload-overlay')", timeout=3)
        await wait_until(
            cdp,
            "[...document.querySelectorAll('.image-upload-overlay button')]"
            ".some(b => b.textContent.trim() === 'Paste from clipboard')",
            timeout=3,
        )
        await cdp.eval(
            "[...document.querySelectorAll('.image-upload-overlay button')]"
            ".find(b => b.textContent.trim() === 'Paste from clipboard').click()"
        )
        await wait_until(cdp, "!document.querySelector('.image-upload-footer button').disabled", timeout=3)
        await cdp.eval("document.querySelector('.image-upload-footer button').click()")
        value = await wait_until(
            cdp,
            "document.querySelector('.modal-overlay textarea[placeholder^=\"Value\"]')?.value.includes('mock-clipboard-balanced.webp') && document.querySelector('.modal-overlay textarea[placeholder^=\"Value\"]').value",
            timeout=3,
        )
        assert '![clipboard-screenshot]' in value
    await check('T21d Snippets clipboard image upload modal', t21d_snippets_image_upload_from_clipboard)

    # ── T21e: Image preview failures show copyable diagnostics ─
    async def t21e_snippets_image_preview_error_dialog():
        await close_modals()
        await open_shortcuts_tab()
        await cdp.eval("window.__mockFailMediaPreviews = true; window.__mockClipboardText = '';")
        await cdp.eval("document.querySelector('#panel-shortcuts button[title=\"Add shortcut\"]').click()")
        await wait_until(cdp, "!!document.querySelector('.modal-overlay textarea[placeholder^=\"Value\"]')", timeout=3)
        await cdp.eval(
            "[...document.querySelectorAll('.modal-overlay .md-toolbar button')]"
            ".find(b => b.title === 'Image').click()"
        )
        await wait_until(cdp, "!!document.querySelector('.image-upload-overlay')", timeout=3)
        await cdp.eval("document.querySelector('.image-upload-overlay .image-upload-picker button').click()")
        await wait_until(cdp, "!!document.querySelector('.error-dialog-overlay')", timeout=5)
        title = await cdp.eval("document.querySelector('.error-dialog h3')?.textContent.trim()")
        assert title == 'Image preview failed', f'title: {title!r}'
        details = await cdp.eval("document.querySelector('.error-dialog-details')?.textContent || ''")
        assert 'frontend_version' in details, f'details missing frontend_version: {details!r}'
        assert 'native_version' in details, f'details missing native_version: {details!r}'
        assert 'mock-balanced' in details, f'details missing failed preview url: {details!r}'
        await cdp.eval(
            "[...document.querySelectorAll('.error-dialog button')]"
            ".find(b => b.textContent.trim() === 'Copy error').click()"
        )
        copied = await wait_until(cdp, "window.__mockClipboardText", timeout=3)
        assert 'Image preview failed' in copied, f'copied: {copied!r}'
        assert 'mock-balanced' in copied, f'copied missing preview url: {copied!r}'
        await cdp.eval(
            "[...document.querySelectorAll('.error-dialog button')]"
            ".find(b => b.textContent.trim() === 'OK').click();"
            "window.__mockFailMediaPreviews = false;"
        )
        await wait_until(cdp, "!document.querySelector('.error-dialog-overlay')", timeout=3)
    await check('T21e Snippets image preview errors show diagnostics', t21e_snippets_image_preview_error_dialog)

    # ── T21f: Remote media previews use native data-url fallback ─
    async def t21f_snippets_remote_media_preview_native_fallback():
        await close_modals()
        await open_shortcuts_tab()
        await cdp.eval(
            "window.__mockFailMediaPreviews = false;"
            "window.__mockRemoteMediaPreviews = true;"
            "window.__mockMediaPreviewDataCalls = 0;"
        )
        await cdp.eval("document.querySelector('#panel-shortcuts button[title=\"Add shortcut\"]').click()")
        await wait_until(cdp, "!!document.querySelector('.modal-overlay textarea[placeholder^=\"Value\"]')", timeout=3)
        await cdp.eval(
            "[...document.querySelectorAll('.modal-overlay .md-toolbar button')]"
            ".find(b => b.title === 'Image').click()"
        )
        await wait_until(cdp, "!!document.querySelector('.image-upload-overlay')", timeout=3)
        await cdp.eval("document.querySelector('.image-upload-overlay .image-upload-picker button').click()")
        preview_src = await wait_until(
            cdp,
            "document.querySelector('.image-upload-overlay .image-upload-preview img')?.src.startsWith('data:image/') && document.querySelector('.image-upload-overlay .image-upload-preview img').src",
            timeout=5,
        )
        assert preview_src.startswith('data:image/'), f'preview src: {preview_src[:80]!r}'
        calls = await cdp.eval("window.__mockMediaPreviewDataCalls || 0")
        assert calls >= 1, f'native preview calls: {calls}'
        await wait_until(cdp, "!document.querySelector('.image-upload-footer button').disabled", timeout=3)
        await cdp.eval("document.querySelector('.image-upload-footer button').click()")
        value = await wait_until(
            cdp,
            "document.querySelector('.modal-overlay textarea[placeholder^=\"Value\"]')?.value.includes('https://ister-app.ru/snippets-media/mock-balanced.webp') && document.querySelector('.modal-overlay textarea[placeholder^=\"Value\"]').value",
            timeout=3,
        )
        assert 'data:image/' not in value, f'markdown should keep portable URL: {value!r}'
        await cdp.eval("""(() => {
          const editor = [...document.querySelectorAll('.modal-overlay')]
            .find(x => !x.classList.contains('image-upload-overlay') && x.querySelector('input[placeholder="Name"]'));
          const name = editor.querySelector('input[placeholder="Name"]');
          name.value = 'Remote media fallback';
          name.dispatchEvent(new Event('input', { bubbles: true }));
          [...editor.querySelectorAll('.modal-actions button')]
            .find(x => x.textContent.trim() === 'Confirm').click();
        })()""")
        await wait_until(
            cdp,
            "[...document.querySelectorAll('#panel-shortcuts .shortcut-list-item .shortcut-list-name')].some(x => x.textContent.trim() === 'Remote media fallback')",
            timeout=3,
        )
        await cdp.eval(
            "[...document.querySelectorAll('#panel-shortcuts .shortcut-list-item .shortcut-list-name')]"
            ".find(x => x.textContent.trim() === 'Remote media fallback').click()"
        )
        figure_src = await wait_until(
            cdp,
            "document.querySelector('#panel-shortcuts .markdown-figure-card img')?.src.startsWith('data:image/') && document.querySelector('#panel-shortcuts .markdown-figure-card img').src",
            timeout=5,
        )
        assert figure_src.startswith('data:image/'), f'figure src: {figure_src[:80]!r}'
        await cdp.eval("window.__mockRemoteMediaPreviews = false;")
    await check('T21f Snippets remote media previews use native fallback', t21f_snippets_remote_media_preview_native_fallback)

    # ── T21g: Image preview shows variant title + arrows ─────
    async def t21g_image_preview_variant_navigation():
        await close_modals()
        await open_shortcuts_tab()
        await cdp.eval("window.__mockFailMediaPreviews = false; window.__mockRemoteMediaPreviews = false;")
        await cdp.eval("document.querySelector('#panel-shortcuts button[title=\"Add shortcut\"]').click()")
        await wait_until(cdp, "!!document.querySelector('.modal-overlay textarea[placeholder^=\"Value\"]')", timeout=3)
        await cdp.eval(
            "[...document.querySelectorAll('.modal-overlay .md-toolbar button')]"
            ".find(b => b.title === 'Image').click()"
        )
        await wait_until(cdp, "!!document.querySelector('.image-upload-overlay')", timeout=3)
        await cdp.eval("document.querySelector('.image-upload-overlay .image-upload-picker button').click()")
        await wait_until(cdp, "!!document.querySelector('.image-upload-overlay .image-upload-preview img')", timeout=3)
        title = await cdp.eval("document.querySelector('.image-upload-preview-title')?.textContent.trim() || ''")
        assert 'Balanced' in title, f'title: {title!r}'
        assert '2 / 4' in title, f'title: {title!r}'
        await cdp.eval("document.querySelector('.image-upload-preview-next').click()")
        title = await wait_until(
            cdp,
            "document.querySelector('.image-upload-preview-title')?.textContent.includes('Readable') && document.querySelector('.image-upload-preview-title').textContent",
            timeout=3,
        )
        assert '3 / 4' in title, f'title: {title!r}'
        await cdp.eval("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))")
        title = await wait_until(
            cdp,
            "document.querySelector('.image-upload-preview-title')?.textContent.includes('Balanced') && document.querySelector('.image-upload-preview-title').textContent",
            timeout=3,
        )
        assert '2 / 4' in title, f'title: {title!r}'
        await close_modals()
    await check('T21g Image preview variant title and arrows', t21g_image_preview_variant_navigation)

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

    # ── T24: Snippets key cloud modal ───────────────────────
    async def t24_snippets_key_cloud_modal():
        await open_shortcuts_tab()
        await cdp.eval(
            "localStorage.removeItem('snippet_key_cloud_cache_v2');"
            "localStorage.removeItem('snippet_key_cloud_cache_v3');"
            "localStorage.removeItem('snippet_key_cloud_cache_v4');"
            "localStorage.removeItem('snippet_key_cloud_algorithm');"
        )
        await cdp.eval(
            "Promise.all(Array.from({ length: 70 }, (_, i) => "
            "window.__TAURI__.core.invoke('create_shortcut', {"
            "name: `cloudk${i}_solo${i}`, value: 'x', description: '', links: []"
            "})))"
        )
        await cdp.eval(
            "[...document.querySelectorAll('#panel-shortcuts div button')]"
            ".find(x => x.textContent.trim() === 'sql').click()"
        )
        await wait_until(cdp, "!!document.querySelector('#panel-shortcuts div button[style*=\"font-weight: 600\"]')", timeout=3)

        await cdp.eval("window.__keyCloudPerfStart = performance.now(); document.querySelector('#panel-shortcuts button[title=\"Key Cloud\"]').click()")
        await wait_until(cdp, "!!document.querySelector('.snippet-key-cloud-modal')", timeout=3)
        open_ms = await cdp.eval("performance.now() - window.__keyCloudPerfStart")
        assert open_ms < 700, f'key cloud modal opens too slowly without cache: {open_ms:.0f}ms'
        assert await cdp.eval("!!document.querySelector('.snippet-key-cloud-progress')"), 'missing no-cache progress state'
        await wait_until(cdp, "document.querySelectorAll('.snippet-key-bubble').length > 20", timeout=12)
        cached_after_build = await cdp.eval("!!localStorage.getItem('snippet_key_cloud_cache_v4')")
        assert cached_after_build, 'key cloud cache was not persisted'
        algorithm_value = await cdp.eval("document.querySelector('.snippet-key-cloud-algorithm')?.value")
        assert algorithm_value == 'dense', f'key cloud algorithm: {algorithm_value!r}'
        cache_meta = await cdp.eval(
            "(() => {"
            "const cache = JSON.parse(localStorage.getItem('snippet_key_cloud_cache_v4'));"
            "const nearestGaps = cache.nodes.slice(1).map((a, index) => {"
            "let best = Infinity;"
            "cache.nodes.forEach((b, j) => {"
            "if (j === index + 1) return;"
            "const dist = Math.hypot(a.x - b.x, a.y - b.y) - (a.size + b.size) / 2;"
            "best = Math.min(best, dist);"
            "});"
            "return best;"
            "});"
            "return {"
            "algorithm: cache.algorithm,"
            "maxNearestGap: Math.max(...nearestGaps),"
            "colors: new Set(cache.nodes.map(x => x.color)).size"
            "};"
            "})()"
        )
        assert cache_meta['algorithm'] == 'dense', f'cache algorithm: {cache_meta!r}'
        assert cache_meta['maxNearestGap'] <= 2.0, f'key cloud has loose gaps: {cache_meta!r}'
        assert cache_meta['colors'] >= 12, f'key cloud palette too narrow: {cache_meta!r}'

        await cdp.eval("document.querySelector('.modal-actions button:last-child').click()")
        await wait_until(cdp, "!document.querySelector('.modal-overlay')", timeout=3)
        await cdp.eval("window.__keyCloudCachedOpenStart = performance.now(); document.querySelector('#panel-shortcuts button[title=\"Key Cloud\"]').click()")
        await wait_until(cdp, "document.querySelectorAll('.snippet-key-bubble').length > 20", timeout=3)
        cached_open_ms = await cdp.eval("performance.now() - window.__keyCloudCachedOpenStart")
        assert cached_open_ms < 700, f'cached key cloud opens too slowly: {cached_open_ms:.0f}ms'
        labels = await cdp.eval(
            "[...document.querySelectorAll('.snippet-key-bubble')]"
            ".map(x => ({ key: x.dataset.key, count: x.dataset.count }))"
        )
        counts = {item['key']: item['count'] for item in labels}
        assert counts.get('bash') == '3', f'cloud counts: {counts!r}'
        assert counts.get('guide') == '3', f'cloud counts: {counts!r}'
        assert await cdp.eval("!!document.querySelector('.snippet-key-cloud-viewport')"), 'missing packed cloud viewport'
        assert await cdp.eval("!!document.querySelector('.snippet-key-cloud-fit')"), 'missing Fit control'
        metrics = await cdp.eval(
            "(() => {"
            "const viewport = document.querySelector('.snippet-key-cloud-viewport').getBoundingClientRect();"
            "const center = { x: viewport.left + viewport.width / 2, y: viewport.top + viewport.height / 2 };"
            "return [...document.querySelectorAll('.snippet-key-bubble')].reduce((acc, el) => {"
            "const r = el.getBoundingClientRect();"
            "acc[el.dataset.key] = {"
            "w: Math.round(r.width),"
            "d: Math.round(parseFloat(el.style.width)),"
            "font: parseFloat(getComputedStyle(el.querySelector('.snippet-key-bubble-key')).fontSize),"
            "dist: Math.round(Math.hypot(r.left + r.width / 2 - center.x, r.top + r.height / 2 - center.y)),"
            "title: el.getAttribute('title')"
            "};"
            "return acc;"
            "}, {});"
            "})()"
        )
        assert metrics['bash']['d'] >= 150, f'bash bubble source diameter too small: {metrics!r}'
        assert metrics['bash']['d'] - metrics['sql']['d'] >= 45, f'weak size contrast: {metrics!r}'
        assert metrics['sql']['font'] <= metrics['bash']['font'], f'font not scaled down: {metrics!r}'
        assert metrics['bash']['dist'] < metrics['sql']['dist'], f'large key not centered: {metrics!r}'
        assert metrics['bash']['title'] == 'bash · 3 snippets', f'title tooltip text: {metrics!r}'
        overlaps = await cdp.eval(
            "(() => {"
            "const bubbles = [...document.querySelectorAll('.snippet-key-bubble')].map(el => ({"
            "key: el.dataset.key, rect: el.getBoundingClientRect()"
            "}));"
            "const out = [];"
            "for (let i = 0; i < bubbles.length; i++) {"
            "for (let j = i + 1; j < bubbles.length; j++) {"
            "const a = bubbles[i], b = bubbles[j];"
            "const ax = a.rect.left + a.rect.width / 2;"
            "const ay = a.rect.top + a.rect.height / 2;"
            "const bx = b.rect.left + b.rect.width / 2;"
            "const by = b.rect.top + b.rect.height / 2;"
            "const dist = Math.hypot(ax - bx, ay - by);"
            "const min = (a.rect.width + b.rect.width) / 2 - 1;"
            "if (dist < min) out.push(`${a.key}/${b.key}:${Math.round(min - dist)}`);"
            "}"
            "}"
            "return out.slice(0, 8);"
            "})()"
        )
        assert overlaps == [], f'key bubbles overlap: {overlaps!r}'
        await cdp.eval(
            "document.querySelector('.snippet-key-bubble[data-key=\"bash\"]').dispatchEvent("
            "new MouseEvent('mouseenter', { bubbles: true, clientX: 80, clientY: 80 }));"
        )
        tooltip_text = await wait_until(cdp, "document.querySelector('.snippet-key-tooltip.visible')?.textContent", timeout=3)
        assert 'bash' in tooltip_text and '3 snippets' in tooltip_text, f'tooltip: {tooltip_text!r}'

        await cdp.eval("document.querySelector('.snippet-key-bubble[data-key=\"bash\"]').click()")
        await wait_until(cdp, "!document.querySelector('.modal-overlay')", timeout=3)
        search_value = await cdp.eval("document.querySelector('#panel-shortcuts .search-bar input')?.value")
        assert search_value == 'bash', f'search value: {search_value!r}'
        active_tag = await cdp.eval("!!document.querySelector('#panel-shortcuts div button[style*=\"font-weight: 600\"]')")
        assert not active_tag, 'tag filter should be cleared after key cloud click'
        names = await cdp.eval(
            "[...document.querySelectorAll('#panel-shortcuts div')]"
            ".map(x => x.textContent.trim())"
        )
        assert any(n == 'bash_cd_guide' for n in names), names
        assert any(n == 'bash_cd_cheatsheet' for n in names), names
        assert any(n == 'bash_ssh_guide' for n in names), names
        assert not any(n == 'sql_guide' for n in names), names
    await check('T24 Snippets key cloud modal', t24_snippets_key_cloud_modal)

    # ── T25: Snippets related tab sorts by shared keys ──────
    async def t25_snippets_related_tab_sorting():
        await open_shortcuts_tab()
        await cdp.eval(
            "[...document.querySelectorAll('#panel-shortcuts div')]"
            ".find(x => x.textContent.trim() === 'bash_cd_guide').click()"
        )
        await wait_until(cdp, "document.body.innerText.includes('bash_cd_guide')", timeout=3)
        tabs = await cdp.eval(
            "[...document.querySelectorAll('.snippet-detail-tab')].map(x => x.textContent.trim())"
        )
        assert 'Related' in tabs, f'tabs: {tabs!r}'
        await cdp.eval(
            "[...document.querySelectorAll('.snippet-detail-tab')]"
            ".find(x => x.textContent.trim() === 'Related').click()"
        )
        await wait_until(cdp, "document.querySelectorAll('.snippet-related-row').length >= 3", timeout=3)
        rows = await cdp.eval(
            "[...document.querySelectorAll('.snippet-related-row')]"
            ".slice(0, 3).map(row => ({"
            "name: row.querySelector('.snippet-related-name')?.textContent.trim(),"
            "keys: [...row.querySelectorAll('.snippet-key-pill')].map(x => x.textContent.trim())"
            "}))"
        )
        assert [r['name'] for r in rows] == ['bash_cd_cheatsheet', 'bash_ssh_guide', 'sql_guide'], rows
        assert rows[0]['keys'] == ['bash', 'cd'], rows
        assert rows[1]['keys'] == ['bash', 'guide'], rows
        assert rows[2]['keys'] == ['guide'], rows
    await check('T25 Snippets related tab sorts by shared keys', t25_snippets_related_tab_sorting)

    # ── T26: Snippets left panel sort mode ───────────────────
    async def t26_snippets_left_panel_sort_mode():
        await cdp.eval("""(() => {
          const settings = JSON.parse(localStorage.getItem('mock.settings') || '{}');
          settings.snippets_sort_mode = 'name';
          localStorage.setItem('mock.settings', JSON.stringify(settings));

          const updatedAt = {
            'SELECT all': '2026-05-24T14:00:00.000Z',
            'sql_guide': '2026-05-24T13:00:00.000Z',
            'Python markdown block': '2026-05-23T12:00:00.000Z',
            'Minimal plain snippet': '2026-05-22T11:00:00.000Z',
            'Indented fenced blocks': '2026-05-21T10:00:00.000Z',
            'bash_cd_guide': '2026-05-20T09:00:00.000Z',
            'bash_ssh_guide': '2026-05-19T08:00:00.000Z',
            'bash_cd_cheatsheet': '2026-05-18T07:00:00.000Z'
          };
          const items = JSON.parse(localStorage.getItem('mock.shortcuts') || '[]');
          for (const item of items) {
            item.updated_at = updatedAt[item.name] || '2026-01-01T00:00:00.000Z';
          }
          localStorage.setItem('mock.shortcuts', JSON.stringify(items));
        })()""")
        await cdp.send('Page.reload', ignoreCache=True)
        await asyncio.sleep(0.8)
        await wait_until(cdp, "!!document.querySelector('.tab-btn')", timeout=8)
        await wait_until(cdp, "!!window.__TAURI__ && !!window.__TAURI__.core", timeout=5)
        await open_shortcuts_tab()

        alpha_names = await cdp.eval(
            "[...document.querySelectorAll('#panel-shortcuts .shortcut-list-item .shortcut-list-name')]"
            ".map(x => x.textContent.trim()).slice(0, 3)"
        )
        assert alpha_names == [
            'bash_cd_cheatsheet',
            'bash_cd_guide',
            'bash_ssh_guide',
        ], f'alphabetical order: {alpha_names!r}'

        await cdp.eval("document.querySelector('#panel-shortcuts .snippet-sort-button').click()")
        await wait_until(cdp, "document.querySelectorAll('.snippet-sort-menu [data-sort-mode]').length === 2", timeout=3)
        await cdp.eval("document.querySelector('.snippet-sort-menu [data-sort-mode=\"modified\"]').click()")
        await wait_until(
            cdp,
            "document.querySelector('#panel-shortcuts .snippet-sort-button')?.textContent.includes('Modified')",
            timeout=3,
        )

        modified_names = await cdp.eval(
            "[...document.querySelectorAll('#panel-shortcuts .shortcut-list-item .shortcut-list-name')]"
            ".map(x => x.textContent.trim()).slice(0, 3)"
        )
        assert modified_names == [
            'SELECT all',
            'sql_guide',
            'Python markdown block',
        ], f'modified order: {modified_names!r}'

        stored_mode = await cdp.eval(
            "JSON.parse(localStorage.getItem('mock.settings') || '{}').snippets_sort_mode"
        )
        assert stored_mode == 'modified', f'stored sort mode: {stored_mode!r}'

        await cdp.send('Page.reload', ignoreCache=True)
        await asyncio.sleep(0.8)
        await wait_until(cdp, "!!document.querySelector('.tab-btn')", timeout=8)
        await wait_until(cdp, "!!window.__TAURI__ && !!window.__TAURI__.core", timeout=5)
        await open_shortcuts_tab()
        reloaded_names = await cdp.eval(
            "[...document.querySelectorAll('#panel-shortcuts .shortcut-list-item .shortcut-list-name')]"
            ".map(x => x.textContent.trim()).slice(0, 2)"
        )
        assert reloaded_names == ['SELECT all', 'sql_guide'], f'reloaded modified order: {reloaded_names!r}'
    await check('T26 Snippets left panel sort mode', t26_snippets_left_panel_sort_mode)

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
