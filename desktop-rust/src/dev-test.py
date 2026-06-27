#!/usr/bin/env python3
"""CDP-based smoke test for the browser mock dev environment.

Launches a local python HTTP server + headless Chrome with remote debugging,
connects via Chrome DevTools Protocol, runs interactive scenarios, and prints
PASS/FAIL. Intended to run from repo root or this folder.
"""

import asyncio
import base64
import json
import os
import re
import signal
import socket
import subprocess
import sys
import time
from contextlib import contextmanager

import websockets
from urllib.request import urlopen

def free_port(p):
    try:
        with socket.socket() as s: s.bind(('', p))
        return True
    except OSError:
        return False


def pick_port(env_name, preferred):
    raw = os.environ.get(env_name)
    if raw:
        return int(raw)
    if free_port(preferred):
        return preferred
    with socket.socket() as s:
        s.bind(('', 0))
        return s.getsockname()[1]


SRC_DIR = os.path.dirname(os.path.abspath(__file__))
HTTP_PORT = pick_port('DEV_TEST_HTTP_PORT', 8765)
CDP_PORT = pick_port('DEV_TEST_CDP_PORT', 9222)
TEST_URL = f"http://localhost:{HTTP_PORT}/dev.html"


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
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
            proc.wait(timeout=5)


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
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
            proc.wait(timeout=5)
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

    async def clear_snippet_drafts():
        await cdp.eval("""(() => {
          for (const key of Object.keys(localStorage)) {
            if (key.startsWith('snippet_editor_draft_')) localStorage.removeItem(key);
          }
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

    # ── T2a: external links open outside the app webview ─────
    async def t2a_external_links_use_native_open_url():
        before = await cdp.eval("location.href")
        await cdp.eval("""(() => {
          window.__mockOpenedUrls = [];
          window.__directExternalGuardOpenUrls = [];
          window.__originalOpenForExternalGuard = window.open;
          window.open = (url) => {
            window.__directExternalGuardOpenUrls.push(String(url));
            return null;
          };
          document.querySelector('#external-link-guard-test')?.remove();
          const a = document.createElement('a');
          a.id = 'external-link-guard-test';
          a.href = 'https://example.com/global-guard';
          a.textContent = 'external guard';
          document.body.appendChild(a);
          a.click();
        })()""")
        opened = await wait_until(
            cdp,
            """(() => {
              const urls = window.__mockOpenedUrls || [];
              return urls.includes('https://example.com/global-guard') ? urls : null;
            })()""",
            timeout=3,
        )
        after = await cdp.eval("location.href")
        assert opened == ['https://example.com/global-guard'], opened
        assert after == before, f'app webview navigated from {before!r} to {after!r}'
        await cdp.eval("""(() => {
          document.querySelector('#external-link-guard-test')?.remove();
          if (window.__originalOpenForExternalGuard) {
            window.open = window.__originalOpenForExternalGuard;
            delete window.__originalOpenForExternalGuard;
          }
          delete window.__directExternalGuardOpenUrls;
        })()""")
    await check('T2a external links use native open_url', t2a_external_links_use_native_open_url)

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
        await cdp.eval("document.querySelector('.help-tab-btn[data-tab-id=\"hotkeys\"]').click()")
        await wait_until(
            cdp,
            "document.querySelector('.help-overlay')?.textContent.includes('Ctrl+Alt+Insert')",
            timeout=3,
        )
        await cdp.eval("document.querySelector('.help-close-btn').click()")
        await wait_until(cdp, "!document.querySelector('.help-overlay')", timeout=3)
    await check('T2b Help changelog shows frontend OTA notes', t2b_help_changelog_shows_frontend_ota_notes)

    # ── T2b2: Settings modal keeps stable layout ─────────────
    async def t2b2_settings_modal_layout_stable():
        await cdp.eval("""
          document.querySelector('.settings-overlay')?.remove();
          localStorage.setItem('mock.admin_me', JSON.stringify({
            user_id: 'mock-admin-user', name: 'Mock Admin', is_admin: true,
            media_quota_bytes: 1073741824, media_max_upload_bytes: 20971520,
            media_used_bytes: 12582912
          }));
          document.querySelector('.tab-btn[title="Settings"]').click();
        """)
        await wait_until(cdp, "!!document.querySelector('.settings-overlay')", timeout=3)
        await wait_until(cdp, "[...document.querySelectorAll('.settings-tab-btn')].some(b => b.textContent.trim() === 'AI')", timeout=3)
        layout = await cdp.eval("""(() => {
          const modal = document.querySelector('.settings-modal');
          const btn = document.querySelector('.settings-tab-btn');
          const style = getComputedStyle(btn);
          const strip = document.querySelector('.settings-tab-strip');
          const stripStyle = getComputedStyle(strip);
          return {
            modalHeight: Math.round(modal.getBoundingClientRect().height),
            expectedHeight: Math.round(Math.min(window.innerHeight * 0.86, 760)),
            textAlign: style.textAlign,
            justifyContent: style.justifyContent,
            stripOverflowY: stripStyle.overflowY,
          };
        })()""")
        assert abs(layout['modalHeight'] - layout['expectedHeight']) <= 2, layout
        assert layout['textAlign'] == 'left', layout
        assert layout['justifyContent'] == 'flex-start', layout
        assert layout['stripOverflowY'] in ('auto', 'scroll'), layout
        await cdp.eval("[...document.querySelectorAll('.settings-tab-btn')].find(b => b.textContent.trim() === 'AI').click()")
        await wait_until(cdp, "document.querySelector('.settings-tab-btn.active')?.textContent.trim() === 'AI'", timeout=3)
        switched_height = await cdp.eval("Math.round(document.querySelector('.settings-modal').getBoundingClientRect().height)")
        assert switched_height == layout['modalHeight'], { **layout, 'switchedHeight': switched_height }
        await cdp.eval("document.querySelector('.settings-overlay')?.remove()")
    await check('T2b2 Settings modal stable layout', t2b2_settings_modal_layout_stable)

    # ── T2b2b: Settings exposes Launchpad hotkey ─────────────
    async def t2b2b_settings_launchpad_hotkey():
        await cdp.eval("""
          document.querySelector('.settings-overlay')?.remove();
          const settings = JSON.parse(localStorage.getItem('mock.settings') || '{}');
          delete settings['launchpad.hotkey'];
          localStorage.setItem('mock.settings', JSON.stringify(settings));
          document.querySelector('.tab-btn[title="Settings"]').click();
        """)
        await wait_until(cdp, "!!document.querySelector('.settings-overlay')", timeout=3)
        await cdp.eval("[...document.querySelectorAll('.settings-tab-btn')].find(b => b.textContent.trim() === 'Shortcuts').click()")
        await wait_until(cdp, "document.querySelector('.settings-tab-btn.active')?.textContent.trim() === 'Shortcuts'", timeout=3)
        await wait_until(cdp, "!!document.querySelector('[data-setting-key=\"launchpad.hotkey\"]')", timeout=3)
        default_value = await cdp.eval("document.querySelector('[data-setting-key=\"launchpad.hotkey\"]')?.value")
        assert default_value == 'Ctrl+Alt+Space', default_value
        await cdp.eval("""
          const input = document.querySelector('[data-setting-key="launchpad.hotkey"]');
          input.value = 'Ctrl+Shift+Space';
          input.dispatchEvent(new Event('change', { bubbles: true }));
        """)
        await wait_until(
            cdp,
            "JSON.parse(localStorage.getItem('mock.settings') || '{}')['launchpad.hotkey'] === 'Ctrl+Shift+Space'",
            timeout=3,
        )
        await cdp.eval("[...document.querySelectorAll('.settings-content button')].find(b => b.textContent.trim() === 'Reset Launchpad hotkey').click()")
        await wait_until(
            cdp,
            "JSON.parse(localStorage.getItem('mock.settings') || '{}')['launchpad.hotkey'] === 'Ctrl+Alt+Space'",
            timeout=3,
        )
        reset_value = await cdp.eval("document.querySelector('[data-setting-key=\"launchpad.hotkey\"]')?.value")
        assert reset_value == 'Ctrl+Alt+Space', reset_value
        help_text = await cdp.eval("document.querySelector('.settings-overlay')?.textContent || ''")
        assert 'Restart the app' in help_text, help_text
        await cdp.eval("document.querySelector('.settings-overlay')?.remove()")
    await check('T2b2b Settings Launchpad hotkey', t2b2b_settings_launchpad_hotkey)

    # ── T2b3: Settings exposes frontend cache reset ──────────
    async def t2b3_settings_frontend_cache_reset_action():
        await cdp.eval("""
          document.querySelector('.settings-overlay')?.remove();
          document.querySelector('.tab-btn[title="Settings"]').click();
        """)
        await wait_until(cdp, "!!document.querySelector('.settings-overlay')", timeout=3)
        await cdp.eval("[...document.querySelectorAll('.settings-tab-btn')].find(b => b.textContent.trim() === 'Updates').click()")
        await wait_until(cdp, "document.querySelector('.settings-tab-btn.active')?.textContent.trim() === 'Updates'", timeout=3)
        button_texts = await cdp.eval("[...document.querySelectorAll('.settings-content button')].map(b => b.textContent.trim())")
        assert 'Clear frontend cache & reload' in button_texts, button_texts
        await cdp.eval("""(() => {
          localStorage.removeItem('mock.clear_frontend_browsing_data_calls');
          const oldConfirm = window.confirm;
          window.confirm = () => true;
          [...document.querySelectorAll('.settings-content button')]
            .find(b => b.textContent.trim() === 'Clear frontend cache & reload')
            .click();
          window.confirm = oldConfirm;
        })()""")
        await wait_until(cdp, "localStorage.getItem('mock.clear_frontend_browsing_data_calls') === '1'", timeout=3)
        await cdp.eval("document.querySelector('.settings-overlay')?.remove()")
    await check('T2b3 Settings frontend cache reset action', t2b3_settings_frontend_cache_reset_action)

    # ── T2b4: VPS imports SSH config aliases without duplicates ──
    async def t2b4_vps_ssh_config_import_ui():
        await close_modals()
        await cdp.eval("""(() => {
          localStorage.setItem('mock.vps_servers', JSON.stringify([
            { name: 'api-prod', host: '10.0.0.1', user: 'deploy', port: 22, key_file: '~/.ssh/id_rsa',
              color: '#3b82f6', auto_refresh: true, refresh_interval: 30, environment: 'Production' },
            { name: 'dev-box', host: '192.168.1.50', user: 'dev', port: 22, key_file: '',
              color: '#10b981', auto_refresh: false, refresh_interval: 60, environment: 'Default' }
          ]));
          const settings = JSON.parse(localStorage.getItem('mock.settings') || '{}');
          delete settings['vps_ssh_config_windows_paths'];
          delete settings['vps_ssh_config_wsl_paths'];
          localStorage.setItem('mock.settings', JSON.stringify(settings));
          document.querySelector('.tab-btn[data-tab-id="vps"]').click();
        })()""")
        await wait_until(cdp, "!!document.querySelector('#panel-vps .vps-toolbar')", timeout=5)
        toolbar_buttons = await cdp.eval("[...document.querySelectorAll('#panel-vps .vps-toolbar button')].map(b => b.textContent.trim())")
        assert 'Import SSH configs' in toolbar_buttons, toolbar_buttons
        assert 'Settings' in toolbar_buttons, toolbar_buttons

        await cdp.eval("[...document.querySelectorAll('#panel-vps .vps-toolbar button')].find(b => b.textContent.trim() === 'Settings').click()")
        await wait_until(cdp, "document.querySelector('.vps-modal')?.textContent.includes('SSH config import')", timeout=3)
        await cdp.eval("""(() => {
          document.querySelector('.vps-ssh-windows-paths').value = '/mock/windows/config';
          document.querySelector('.vps-ssh-wsl-paths').value = '\\\\\\\\wsl.localhost\\\\Ubuntu\\\\home\\\\dev\\\\.ssh\\\\config';
          document.querySelector('.vps-ssh-settings-save').click();
        })()""")
        await wait_until(cdp, "!document.querySelector('.vps-modal-overlay')", timeout=3)
        saved = await cdp.eval("JSON.parse(localStorage.getItem('mock.settings') || '{}')")
        assert saved.get('vps_ssh_config_windows_paths') == '/mock/windows/config', saved
        assert '\\\\wsl.localhost\\Ubuntu' in saved.get('vps_ssh_config_wsl_paths', ''), saved

        await cdp.eval("[...document.querySelectorAll('#panel-vps .vps-toolbar button')].find(b => b.textContent.trim() === 'Import SSH configs').click()")
        await wait_until(cdp, "JSON.parse(localStorage.getItem('mock.vps_servers') || '[]').some(s => s.name === 'ssh-api')", timeout=3)
        first_count = await cdp.eval("JSON.parse(localStorage.getItem('mock.vps_servers') || '[]').length")
        await cdp.eval("[...document.querySelectorAll('#panel-vps .vps-toolbar button')].find(b => b.textContent.trim() === 'Import SSH configs').click()")
        await asyncio.sleep(0.3)
        second_count = await cdp.eval("JSON.parse(localStorage.getItem('mock.vps_servers') || '[]').length")
        assert second_count == first_count, {'first': first_count, 'second': second_count}
        body = await cdp.eval("document.body.textContent")
        assert 'skipped' in body.lower(), body[-1000:]
    await check('T2b4 VPS SSH config import UI', t2b4_vps_ssh_config_import_ui)

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

    # ── T2c2: Settings AI provider key is server-side ────────
    async def t2c2_ai_provider_settings_tab():
        await cdp.eval("""
          document.querySelector('.settings-overlay')?.remove();
          localStorage.removeItem('mock.ai_provider_deepseek_key');
          localStorage.removeItem('mock.ai_provider_deepseek_updated_at');
          document.querySelector('.tab-btn[title="Settings"]').click();
        """)
        await wait_until(cdp, "!!document.querySelector('.settings-overlay')", timeout=3)
        await wait_until(
            cdp,
            "[...document.querySelectorAll('.settings-tab-btn')].some(b => b.textContent.trim() === 'AI')",
            timeout=3,
        )
        await cdp.eval("[...document.querySelectorAll('.settings-tab-btn')].find(b => b.textContent.trim() === 'AI').click()")
        await wait_until(cdp, "document.querySelector('.ai-provider-status')?.textContent.includes('Not configured')", timeout=3)
        has_input = await cdp.eval("document.querySelector('.ai-provider-key-input')?.type === 'password'")
        assert has_input, 'DeepSeek key password input missing'
        has_balance_button = await cdp.eval("!!document.querySelector('.ai-provider-balance-btn')")
        assert has_balance_button, 'DeepSeek balance button missing'
        has_usage_button = await cdp.eval("!!document.querySelector('.ai-provider-usage-btn')")
        assert has_usage_button, 'DeepSeek usage cabinet button missing'

        await cdp.eval("""(() => {
          const input = document.querySelector('.ai-provider-key-input');
          input.value = 'sk-test-secret';
          input.dispatchEvent(new Event('input', { bubbles: true }));
          document.querySelector('.ai-provider-save-btn').click();
        })()""")
        await wait_until(cdp, "document.querySelector('.ai-provider-status')?.textContent.includes('Configured')", timeout=3)
        input_value = await cdp.eval("document.querySelector('.ai-provider-key-input')?.value || ''")
        assert input_value == '', 'saved secret should not stay visible in the input'
        body_text = await cdp.eval("document.querySelector('.settings-overlay')?.textContent || ''")
        assert 'sk-test-secret' not in body_text, 'raw DeepSeek key leaked into Settings text'

        await cdp.eval("document.querySelector('.ai-provider-balance-btn').click()")
        await wait_until(cdp, "document.querySelector('.ai-provider-balance')?.textContent.includes('Total')", timeout=3)
        await cdp.eval("document.querySelector('.ai-provider-usage-btn').click()")
        opened_urls = await cdp.eval("window.__mockOpenedUrls || []")
        assert 'https://platform.deepseek.com/usage' in opened_urls, opened_urls

        telegram_input_exists = await cdp.eval("document.querySelector('.telegram-provider-token-input')?.type === 'password'")
        assert telegram_input_exists, 'Telegram bot token password input missing'
        await cdp.eval("""(() => {
          const input = document.querySelector('.telegram-provider-token-input');
          input.value = '123456:telegram-secret';
          input.dispatchEvent(new Event('input', { bubbles: true }));
          document.querySelector('.telegram-provider-save-btn').click();
        })()""")
        await wait_until(cdp, "document.querySelector('.telegram-provider-status')?.textContent.includes('Configured')", timeout=3)
        telegram_value = await cdp.eval("document.querySelector('.telegram-provider-token-input')?.value || ''")
        assert telegram_value == '', 'saved Telegram token should not stay visible in the input'
        body_text = await cdp.eval("document.querySelector('.settings-overlay')?.textContent || ''")
        assert 'telegram-secret' not in body_text, 'raw Telegram token leaked into Settings text'
        pairing_command = await cdp.eval("document.querySelector('.telegram-pairing-command')?.textContent || ''")
        assert pairing_command.startswith('/start '), f'pairing command missing: {pairing_command!r}'
        binding_text = await cdp.eval("document.querySelector('.telegram-binding-box')?.textContent || ''")
        assert 'automatically' in binding_text.lower(), binding_text
        poll_label = await cdp.eval("document.querySelector('.telegram-provider-poll-btn')?.textContent.trim() || ''")
        assert poll_label == 'Poll now', poll_label
        await cdp.eval("document.querySelector('.telegram-provider-poll-btn')?.click()")
        await wait_until(cdp, "document.querySelector('.telegram-bound-chat')?.textContent.includes('123456789')", timeout=3)
        await cdp.eval("document.querySelector('.telegram-bound-chat .telegram-chat-unbind-btn')?.click()")
        await wait_until(cdp, "!document.querySelector('.telegram-bound-chat')", timeout=3)
        await cdp.eval("document.querySelector('.telegram-provider-clear-btn').click()")
        await wait_until(cdp, "document.querySelector('.telegram-provider-status')?.textContent.includes('Not configured')", timeout=3)

        await cdp.eval("document.querySelector('.ai-provider-clear-btn').click()")
        await wait_until(cdp, "document.querySelector('.ai-provider-status')?.textContent.includes('Not configured')", timeout=3)
        await cdp.eval("document.querySelector('.settings-overlay')?.remove()")
    await check('T2c2 Settings AI provider key tab', t2c2_ai_provider_settings_tab)

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
        frame_directive = next((part.strip() for part in csp.split(';') if part.strip().startswith('frame-src')), '')
        assert 'https:' not in frame_directive.split(), frame_directive
        assert 'https://ister-app.ru' in frame_directive, frame_directive
        assert 'http://localhost:*' in frame_directive, frame_directive
    await check('T2d Tauri CSP allows media and HTML previews', t2d_tauri_csp_allows_media_images)

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
        await wait_until(cdp, "!!document.querySelector('#panel-whisper #engine-select')", timeout=5)
        await wait_until(cdp, "!!document.querySelector('#panel-whisper #live-dictate-toggle')", timeout=5)
        label = await cdp.eval("document.querySelector('#panel-whisper #live-dictate-label')?.textContent || ''")
        assert 'Live dictate' in label, label
        local_live_disabled = await cdp.eval("document.querySelector('#panel-whisper #live-dictate-toggle')?.disabled === true")
        assert local_live_disabled, 'Local Whisper engine should disable Live dictate'
        has_help = await cdp.eval("!!document.querySelector('#panel-whisper .sql-help-btn')")
        assert has_help, 'Whisper help button missing'
        await cdp.eval("document.querySelector('#panel-whisper .sql-help-btn').click()")
        await wait_until(cdp, "!!document.querySelector('.sql-help-overlay')", timeout=3)
        help_text = await cdp.eval("document.querySelector('.sql-help-overlay')?.textContent || ''")
        assert 'Deepgram' in help_text, help_text
        assert 'Yandex SpeechKit' in help_text, help_text
        assert 'ai.speechkit-stt.user' in help_text, help_text
        assert 'secret' in help_text.lower(), help_text
        assert 'key ID' in help_text, help_text
        assert 'AQVN' in help_text, help_text
        assert 'aje' in help_text, help_text
        assert 'Unknown api key' in help_text, help_text
        assert 'Folder ID' in help_text, help_text
        assert 'folder identifier' in help_text, help_text
        await close_modals()
        await wait_until(cdp, "!document.querySelector('.sql-help-overlay')", timeout=3)

        await cdp.eval("document.querySelector('#panel-whisper #settings-btn').click()")
        await wait_until(cdp, "document.body.textContent.includes('Deepgram live dictation')", timeout=3)
        has_key = await cdp.eval("!!document.querySelector('.modal-overlay [data-key=\"whisper.deepgram_api_key\"]')")
        assert has_key, 'Deepgram API key input missing'
        hotkey_value = await cdp.eval("document.querySelector('.modal-overlay [data-key=\"whisper.hotkey\"]')?.value || ''")
        assert hotkey_value == 'Ctrl+Alt+Insert', hotkey_value
        settings_text = await cdp.eval("document.querySelector('.modal-overlay')?.textContent || ''")
        assert 'secret value' in settings_text, settings_text
        assert 'not the key ID' in settings_text, settings_text
        assert 'Literary text / punctuation' in settings_text, settings_text
        assert 'Profanity filter' in settings_text, settings_text
        assert 'Phone number formatting' in settings_text, settings_text
        has_literature = await cdp.eval("!!document.querySelector('.modal-overlay [data-key=\"whisper.yandex_literature_text\"]')")
        has_profanity = await cdp.eval("!!document.querySelector('.modal-overlay [data-key=\"whisper.yandex_profanity_filter\"]')")
        has_phone = await cdp.eval("!!document.querySelector('.modal-overlay [data-key=\"whisper.yandex_phone_formatting\"]')")
        assert has_literature, 'Yandex literary text checkbox missing'
        assert has_profanity, 'Yandex profanity filter checkbox missing'
        assert has_phone, 'Yandex phone formatting checkbox missing'
        await close_modals()
        await wait_until(cdp, "!document.querySelector('.modal-overlay')", timeout=3)

        await cdp.eval("""(() => {
          const settings = JSON.parse(localStorage.getItem('mock.settings') || '{}');
          delete settings['whisper.recognition_engine'];
          settings['whisper.live_provider'] = 'deepgram';
          settings['whisper.live_dictate'] = 'true';
          localStorage.setItem('mock.settings', JSON.stringify(settings));
          window.dispatchEvent(new CustomEvent('whisper:settings-changed'));
        })()""")
        await wait_until(cdp, "document.querySelector('#panel-whisper #engine-select')?.value === 'deepgram'", timeout=4)
        migrated_engine = await wait_until(
            cdp,
            "JSON.parse(localStorage.getItem('mock.settings') || '{}')['whisper.recognition_engine']",
            timeout=4,
        )
        assert migrated_engine == 'deepgram', f'legacy cloud engine was not migrated: {migrated_engine!r}'
        await wait_until(cdp, "document.querySelector('#panel-whisper #live-dictate-toggle')?.disabled === false", timeout=4)
        await wait_until(cdp, "document.querySelector('#panel-whisper #live-dictate-toggle')?.checked === true", timeout=4)
        await cdp.eval("document.querySelector('#panel-whisper #live-dictate-toggle').click()")
        await wait_until(
            cdp,
            "JSON.parse(localStorage.getItem('mock.settings') || '{}')['whisper.live_dictate'] === 'false'",
            timeout=4,
        )
        engine_after_live_off = await cdp.eval(
            "JSON.parse(localStorage.getItem('mock.settings') || '{}')['whisper.recognition_engine']"
        )
        assert engine_after_live_off == 'deepgram', f'cloud engine changed after Live off: {engine_after_live_off!r}'
        await wait_until(cdp, "document.querySelector('#panel-whisper #record-btn')?.textContent.includes('Record cloud')", timeout=4)
        await cdp.eval("document.querySelector('#panel-whisper #record-btn').click()")
        await wait_until(
            cdp,
            "document.querySelector('#panel-whisper #state-chip')?.textContent.includes('recording')",
            timeout=4,
        )
        await cdp.eval("document.querySelector('#panel-whisper #record-btn').click()")
        await wait_until(
            cdp,
            "[...document.querySelectorAll('#panel-whisper [data-provider=\"deepgram\"]')].length >= 1",
            timeout=4,
        )

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

        await close_modals()
        await cdp.eval("""(() => {
          const settings = JSON.parse(localStorage.getItem('mock.settings') || '{}');
          settings['whisper.yandex_api_key'] = 'AQVN_mock_key';
          settings['whisper.yandex_folder_id'] = '';
          settings['whisper.recognition_engine'] = 'yandex';
          settings['whisper.live_provider'] = 'yandex';
          settings['whisper.live_dictate'] = 'false';
          localStorage.setItem('mock.settings', JSON.stringify(settings));
          window.dispatchEvent(new CustomEvent('whisper:settings-changed'));
        })()""")
        await wait_until(cdp, "document.querySelector('#panel-whisper #engine-select')?.value === 'yandex'", timeout=4)
        await wait_until(cdp, "document.querySelector('#panel-whisper #live-dictate-toggle')?.checked === false", timeout=4)
        warning_text = await wait_until(
            cdp,
            "document.querySelector('#panel-whisper #yandex-folder-warning')?.textContent || ''",
            timeout=4,
        )
        assert 'Yandex batch' in warning_text, warning_text
        assert 'Folder ID' in warning_text, warning_text
        assert 'Live dictate' in warning_text, warning_text
        await wait_until(
            cdp,
            "document.querySelector('#panel-whisper #record-btn')?.dataset.mode === 'start' && !document.querySelector('#panel-whisper #record-btn')?.disabled",
            timeout=4,
        )
        await cdp.eval("document.querySelector('#panel-whisper #record-btn').click()")
        await wait_until(cdp, "!!document.querySelector('.error-dialog-overlay')", timeout=5)
        yandex_error = await cdp.eval("document.querySelector('.error-dialog-message')?.textContent || ''")
        assert 'Yandex batch recognition' in yandex_error, yandex_error
        assert 'Folder ID' in yandex_error, yandex_error
        assert 'Live dictate' in yandex_error, yandex_error
        await cdp.eval("""(() => {
          [...document.querySelectorAll('.error-dialog button')]
            .find(b => b.textContent.trim() === 'OK').click();
        })()""")
        await wait_until(cdp, "!document.querySelector('.error-dialog-overlay')", timeout=3)
        await cdp.eval("""(() => {
          window.dispatchEvent(new CustomEvent('whisper:error', {
            detail: {
              code: 'hotkey_toggle_failed',
              message: 'Yandex batch recognition needs Folder ID. Add Yandex Folder ID in Whisper Settings, or enable Live dictate to use Yandex streaming instead.'
            }
          }));
        })()""")
        await wait_until(cdp, "!!document.querySelector('.error-dialog-overlay')", timeout=5)
        hotkey_error = await cdp.eval("document.querySelector('.error-dialog-message')?.textContent || ''")
        assert 'Yandex batch recognition' in hotkey_error, hotkey_error
        assert 'Folder ID' in hotkey_error, hotkey_error
        assert 'Live dictate' in hotkey_error, hotkey_error
        details = await cdp.eval("document.querySelector('.error-dialog-details')?.textContent || ''")
        assert 'hotkey_toggle_failed' in details, details
        await cdp.eval("""(() => {
          [...document.querySelectorAll('.error-dialog button')]
            .find(b => b.textContent.trim() === 'OK').click();
        })()""")
        await wait_until(cdp, "!document.querySelector('.error-dialog-overlay')", timeout=3)
    await check('T2e Whisper live dictate UI + mock flow', t2e_whisper_live_dictate_ui_and_mock_flow)

    # ── T2f: Whisper errors show persistent copyable dialog ──
    async def t2f_whisper_live_error_dialog():
        await close_modals()
        await cdp.eval("""(() => {
          const settings = JSON.parse(localStorage.getItem('mock.settings') || '{}');
          delete settings['whisper.deepgram_api_key'];
          settings['whisper.recognition_engine'] = 'deepgram';
          settings['whisper.live_provider'] = 'deepgram';
          settings['whisper.live_dictate'] = 'true';
          localStorage.setItem('mock.settings', JSON.stringify(settings));
          window.__mockClipboardText = '';
          document.querySelector('.tab-btn[data-tab-id="whisper"]').click();
          window.dispatchEvent(new CustomEvent('whisper:settings-changed'));
        })()""")
        await wait_until(cdp, "!!document.querySelector('#panel-whisper #live-dictate-toggle')", timeout=5)
        await wait_until(cdp, "document.querySelector('#panel-whisper #live-dictate-toggle')?.disabled === false", timeout=4)
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

    # ── T2j: Whisper overlay boot does not depend on module imports ─
    async def t2j_whisper_overlay_boot_contract():
        overlay_html_path = os.path.join(SRC_DIR, 'tabs', 'whisper', 'whisper-overlay.html')
        overlay_js_path = os.path.join(SRC_DIR, 'tabs', 'whisper', 'whisper-overlay.js')
        with open(overlay_html_path, 'r', encoding='utf-8') as f:
            overlay_html = f.read()
        with open(overlay_js_path, 'r', encoding='utf-8') as f:
            overlay_js = f.read()
        assert 'src="whisper-overlay.js"' in overlay_html, 'overlay should load its script as a relative asset'
        assert 'type="module"' not in overlay_html, 'overlay boot should not depend on module loading in the secondary window'
        assert 'import ' not in overlay_js, 'overlay script should be self-contained so import failures cannot leave static Ready UI'
        assert 'waitForTauriInvoke' in overlay_js, 'overlay script should own its IPC bridge'
        assert 'waitForEventListen' in overlay_js, 'overlay script should own its event bridge'
        assert 'Overlay booting' in overlay_html, 'static fallback should reveal script boot failures instead of saying Ready'
    await check('T2j Whisper overlay boot contract', t2j_whisper_overlay_boot_contract)

    # ── T2k: Whisper overlay is reloaded after frontend OTA ─
    async def t2k_whisper_overlay_reload_contract():
        ota_rs_path = os.path.join(SRC_DIR, '..', 'src-tauri', 'src', 'commands', 'ota.rs')
        lib_rs_path = os.path.join(SRC_DIR, '..', 'src-tauri', 'src', 'lib.rs')
        service_rs_path = os.path.join(SRC_DIR, '..', 'src-tauri', 'src', 'whisper', 'service.rs')
        capabilities_path = os.path.join(SRC_DIR, '..', 'src-tauri', 'capabilities', 'default.json')
        with open(ota_rs_path, 'r', encoding='utf-8') as f:
            ota_rs = f.read()
        with open(lib_rs_path, 'r', encoding='utf-8') as f:
            lib_rs = f.read()
        with open(service_rs_path, 'r', encoding='utf-8') as f:
            service_rs = f.read()
        with open(capabilities_path, 'r', encoding='utf-8') as f:
            capabilities = json.load(f)
        assert 'reload_frontend_windows' in ota_rs, 'frontend OTA should reload all frontend windows, not only main'
        assert 'webview_windows()' in ota_rs, 'frontend OTA should iterate every open WebView window'
        assert 'label == "whisper-overlay"' in ota_rs, 'frontend OTA should explicitly reload the hidden overlay window'
        assert 'label.starts_with("module_")' in ota_rs, 'frontend OTA should reload detached module windows'
        assert 'clear_all_browsing_data' in ota_rs, 'manual frontend cache reset should use Tauri WebView browsing-data clear'
        assert 'clear_frontend_browsing_data,' in lib_rs, 'manual frontend cache reset command should be registered'
        assert 'Cache-Control' in lib_rs and 'no-store, no-cache' in lib_rs, 'khapp frontend assets should disable WebView caching'
        assert 'Pragma' in lib_rs and 'Expires' in lib_rs, 'khapp frontend assets should include legacy no-cache headers'
        assert 'reload_overlay_document' in service_rs, 'show_overlay should refresh a stale hidden overlay document before showing it'
        assert '.reload()' in service_rs, 'overlay refresh should use the native WebView reload API'
        assert 'module_*' in capabilities.get('windows', []), 'detached module windows must have Tauri IPC permissions'
    await check('T2k Whisper overlay OTA reload contract', t2k_whisper_overlay_reload_contract)

    # ── T2l: AI tab renders command/chat shell ────────────────
    async def t2l_ai_tab_shell():
        await close_modals()
        await cdp.eval("document.querySelector('.tab-btn[data-tab-id=\"ai\"]').click()")
        await wait_until(cdp, "!!document.querySelector('#panel-ai .ai-agent-wrap')", timeout=4)
        mode_labels = await cdp.eval(
            "[...document.querySelectorAll('#panel-ai .ai-mode-btn')].map(x => x.textContent.trim())"
        )
        assert mode_labels == ['Chat', 'Command'], mode_labels
        has_input = await cdp.eval("!!document.querySelector('#panel-ai textarea.ai-input')")
        assert has_input, 'AI input missing'
        send_text = await cdp.eval("document.querySelector('#panel-ai .ai-send-btn')?.textContent.trim() || ''")
        assert 'Send' in send_text, f'send button text: {send_text!r}'
        has_log = await cdp.eval("!!document.querySelector('#panel-ai .ai-execution-log')")
        assert has_log, 'execution log missing'
        has_help = await cdp.eval("!!document.querySelector('#panel-ai .ai-help-btn')")
        assert has_help, 'AI tab help button missing'
        has_settings = await cdp.eval("!!document.querySelector('#panel-ai .ai-agent-settings-btn')")
        assert has_settings, 'AI agent settings gear button missing'
        await cdp.eval("document.querySelector('#panel-ai .ai-help-btn').click()")
        await wait_until(cdp, "!!document.querySelector('.ai-help-modal')", timeout=3)
        help_text = await cdp.eval("document.querySelector('.ai-help-modal')?.textContent || ''")
        assert 'Command mode' in help_text, help_text
        assert 'Telegram bot' in help_text, help_text
        assert 'Покажи задачу Аптека' in help_text, help_text
        await cdp.eval("document.querySelector('.ai-help-modal .ai-help-close')?.click()")
    await check('T2l AI tab renders shell', t2l_ai_tab_shell)

    # ── T2l2: AI agent settings modal ───────────────────────
    async def t2l2_ai_agent_settings_modal():
        await close_modals()
        await cdp.eval("document.querySelector('.tab-btn[data-tab-id=\"ai\"]').click()")
        await wait_until(cdp, "!!document.querySelector('#panel-ai .ai-agent-settings-btn')", timeout=4)
        await cdp.eval("document.querySelector('#panel-ai .ai-agent-settings-btn').click()")
        await wait_until(cdp, "!!document.querySelector('.ai-agent-settings-modal')", timeout=3)
        modal_text = await cdp.eval("document.querySelector('.ai-agent-settings-modal')?.textContent || ''")
        assert 'AI Agent Settings' in modal_text, modal_text
        assert 'show_task' in modal_text, modal_text
        assert 'Never invent UUIDs' in modal_text, modal_text
        await cdp.eval("""(() => {
          const input = document.querySelector('.ai-agent-settings-modal .ai-agent-instructions-input');
          input.value = 'Отвечай кратко на русском.';
          input.dispatchEvent(new Event('input', { bubbles: true }));
          document.querySelector('.ai-agent-settings-modal .ai-agent-save-btn').click();
        })()""")
        await wait_until(
            cdp,
            "(document.querySelector('.ai-agent-settings-modal .ai-agent-settings-status')?.textContent || '').includes('Saved')",
            timeout=3,
        )
        await cdp.eval("document.querySelector('.ai-agent-settings-modal .ai-agent-reset-btn').click()")
        await wait_until(
            cdp,
            "(document.querySelector('.ai-agent-settings-modal .ai-agent-instructions-input')?.value || '') === ''",
            timeout=3,
        )
        await cdp.eval("""(() => {
          const input = document.querySelector('.ai-agent-settings-modal .ai-agent-preview-input');
          input.value = 'Покажи задачу Аптека';
          input.dispatchEvent(new Event('input', { bubbles: true }));
          document.querySelector('.ai-agent-settings-modal .ai-agent-preview-btn').click();
        })()""")
        await wait_until(
            cdp,
            "(document.querySelector('.ai-agent-settings-modal .ai-agent-preview-output')?.textContent || '').includes('show_task')",
            timeout=4,
        )
        const_active = await cdp.eval("document.querySelector('.tab-btn[data-tab-id=\"tasks\"]')?.classList.contains('active')")
        assert const_active is False, 'Preview must not navigate to Tasks'
        await cdp.eval("document.querySelector('.ai-agent-settings-modal .ai-agent-settings-close')?.click()")
    await check('T2l2 AI agent settings modal', t2l2_ai_agent_settings_modal)

    # ── T2m: AI command plan executes locally ────────────────
    async def t2m_ai_command_creates_task_locally():
        await close_modals()
        await cdp.eval("document.querySelector('.tab-btn[data-tab-id=\"ai\"]').click()")
        await wait_until(cdp, "!!document.querySelector('#panel-ai textarea.ai-input')", timeout=4)
        await cdp.eval("""(() => {
          const input = document.querySelector('#panel-ai textarea.ai-input');
          input.value = 'create task from ai';
          input.dispatchEvent(new Event('input', { bubbles: true }));
          document.querySelector('#panel-ai .ai-send-btn').click();
        })()""")
        await wait_until(
            cdp,
            "document.querySelector('.tab-btn[data-tab-id=\"tasks\"]')?.classList.contains('active')",
            timeout=6,
        )
        created = await wait_until(cdp, """(async () => {
          const tasks = await window.__TAURI__.core.invoke('list_tasks', { category: null, status: null });
          const task = tasks.find(t => t.title === 'AI created mock task');
          if (!task) return null;
          const boxes = await window.__TAURI__.core.invoke('list_task_checkboxes', { taskId: task.id });
          return { title: task.title, boxes: boxes.map(b => b.text) };
        })()""", timeout=4)
        assert created['title'] == 'AI created mock task', created
        assert 'First AI checkbox' in created['boxes'], created
        await cdp.eval("""(async () => {
          const tasks = await window.__TAURI__.core.invoke('list_tasks', { category: null, status: null });
          const task = tasks.find(t => t.title === 'AI created mock task');
          if (task) await window.__TAURI__.core.invoke('delete_task', { id: task.id });
          await window.__TAURI__.core.invoke('set_setting', { key: 'last_active_tab', value: 'shortcuts' });
        })()""")
        await cdp.send('Page.reload', ignoreCache=True)
        await wait_until(cdp, "!!document.querySelector('.tab-btn[data-tab-id=\"shortcuts\"]')", timeout=8)
    await check('T2m AI command creates task locally', t2m_ai_command_creates_task_locally)

    # ── T2m2: AI command follows search result to finish mutation ─
    async def t2m2_ai_command_followup_completes_checkbox():
        await close_modals()
        await cdp.eval("""(async () => {
          window.__mockCommandLog = [];
          const boxes = JSON.parse(localStorage.getItem('mock.task_checkboxes') || '[]');
          for (const box of boxes) {
            if (box.text === 'Regular todo visible') box.is_checked = false;
          }
          localStorage.setItem('mock.task_checkboxes', JSON.stringify(boxes));
        })()""")
        await cdp.eval("document.querySelector('.tab-btn[data-tab-id=\"ai\"]').click()")
        await wait_until(cdp, "!!document.querySelector('#panel-ai textarea.ai-input')", timeout=4)
        await cdp.eval("""(() => {
          const input = document.querySelector('#panel-ai textarea.ai-input');
          input.value = 'В задаче Regular пункт Regular todo отметь выполненным';
          input.dispatchEvent(new Event('input', { bubbles: true }));
          document.querySelector('#panel-ai .ai-send-btn').click();
        })()""")
        completed = await wait_until(cdp, """(async () => {
          const tasks = await window.__TAURI__.core.invoke('list_tasks', { category: null, status: null });
          const task = tasks.find(t => t.title === 'Regular mock task');
          if (!task) return null;
          const boxes = await window.__TAURI__.core.invoke('list_task_checkboxes', { taskId: task.id });
          const box = boxes.find(b => b.text === 'Regular todo visible');
          if (!box || !box.is_checked) return null;
          return { checked: true, text: box.text };
        })()""", timeout=8)
        assert completed['checked'] is True, completed
        await cdp.eval("window.__TAURI__.core.invoke('set_setting', { key: 'last_active_tab', value: 'shortcuts' })")
        await cdp.send('Page.reload', ignoreCache=True)
        await wait_until(cdp, "!!document.querySelector('.tab-btn[data-tab-id=\"shortcuts\"]')", timeout=8)
    await check('T2m2 AI command follows search result', t2m2_ai_command_followup_completes_checkbox)

    # ── T2m3: AI command follows opened task to finish mutation ─
    async def t2m3_ai_command_followup_after_open_task():
        await close_modals()
        await cdp.eval("""(async () => {
          const boxes = JSON.parse(localStorage.getItem('mock.task_checkboxes') || '[]');
          for (const box of boxes) {
            if (box.text === 'Regular todo visible') box.is_checked = false;
          }
          localStorage.setItem('mock.task_checkboxes', JSON.stringify(boxes));
        })()""")
        await cdp.eval("document.querySelector('.tab-btn[data-tab-id=\"ai\"]').click()")
        await wait_until(cdp, "!!document.querySelector('#panel-ai textarea.ai-input')", timeout=4)
        await cdp.eval("""(() => {
          const input = document.querySelector('#panel-ai textarea.ai-input');
          input.value = 'Открой задачу Regular, и выполни там пункт Regular todo';
          input.dispatchEvent(new Event('input', { bubbles: true }));
          document.querySelector('#panel-ai .ai-send-btn').click();
        })()""")
        completed = await wait_until(cdp, """(async () => {
          const tasks = await window.__TAURI__.core.invoke('list_tasks', { category: null, status: null });
          const task = tasks.find(t => t.title === 'Regular mock task');
          if (!task) return null;
          const boxes = await window.__TAURI__.core.invoke('list_task_checkboxes', { taskId: task.id });
          const box = boxes.find(b => b.text === 'Regular todo visible');
          if (!box || !box.is_checked) return null;
          const calls = (window.__mockCommandLog || []).filter(call => call.command === 'ai_chat');
          return { checked: true, text: box.text, aiCalls: calls.length };
        })()""", timeout=8)
        assert completed['checked'] is True, completed
        assert completed['aiCalls'] >= 2, completed
        await cdp.eval("window.__TAURI__.core.invoke('set_setting', { key: 'last_active_tab', value: 'shortcuts' })")
        await cdp.send('Page.reload', ignoreCache=True)
        await wait_until(cdp, "!!document.querySelector('.tab-btn[data-tab-id=\"shortcuts\"]')", timeout=8)
    await check('T2m3 AI command follows opened task', t2m3_ai_command_followup_after_open_task)

    # ── T2n: AI mic records into prompt input ─────────────────
    async def t2n_ai_mic_records_into_prompt():
        await close_modals()
        await cdp.eval("""(() => {
          const settings = JSON.parse(localStorage.getItem('mock.settings') || '{}');
          settings['ai.voice_provider'] = 'local';
          localStorage.setItem('mock.settings', JSON.stringify(settings));
        })()""")
        await cdp.eval("window.__TAURI__.core.invoke('whisper_install_model', { name: 'ggml-small' })")
        await cdp.eval("document.querySelector('.tab-btn[data-tab-id=\"ai\"]').click()")
        await wait_until(cdp, "!!document.querySelector('#panel-ai .ai-mic-btn')", timeout=4)
        has_voice_select = await cdp.eval("!!document.querySelector('#panel-ai .ai-voice-provider-select')")
        assert has_voice_select, 'AI voice provider selector missing'
        await wait_until(cdp, "document.querySelector('#panel-ai .ai-voice-provider-select')?.value === 'local'", timeout=4)
        await wait_until(cdp, "document.querySelector('#panel-ai .ai-mic-btn')?.disabled === false", timeout=4)
        await cdp.eval("document.querySelector('#panel-ai .ai-mic-btn').click()")
        start_result = await wait_until(cdp, """(() => {
          const mic = document.querySelector('#panel-ai .ai-mic-btn');
          if (mic?.textContent.includes('Stop')) return 'recording';
          const err = document.querySelector('.error-dialog-details')?.textContent
            || document.querySelector('.error-dialog-message')?.textContent;
          return err ? `error: ${err}` : null;
        })()""", timeout=3)
        assert start_result == 'recording', start_result
        await cdp.eval("document.querySelector('#panel-ai .ai-mic-btn').click()")
        await wait_until(
            cdp,
            "(document.querySelector('#panel-ai textarea.ai-input')?.value || '').includes('Mocked transcript')",
            timeout=4,
        )
        await cdp.eval("""(() => {
          const settings = JSON.parse(localStorage.getItem('mock.settings') || '{}');
          settings['whisper.deepgram_api_key'] = 'dg_mock_key';
          settings['whisper.deepgram_model'] = 'nova-3';
          localStorage.setItem('mock.settings', JSON.stringify(settings));
          const input = document.querySelector('#panel-ai textarea.ai-input');
          input.value = '';
          input.dispatchEvent(new Event('input', { bubbles: true }));
          const select = document.querySelector('#panel-ai .ai-voice-provider-select');
          select.value = 'deepgram';
          select.dispatchEvent(new Event('change', { bubbles: true }));
        })()""")
        await cdp.eval("document.querySelector('#panel-ai .ai-mic-btn').click()")
        await wait_until(cdp, "document.querySelector('#panel-ai .ai-mic-btn')?.textContent.includes('Stop')", timeout=4)
        await cdp.eval("document.querySelector('#panel-ai .ai-mic-btn').click()")
        await wait_until(
            cdp,
            "(document.querySelector('#panel-ai textarea.ai-input')?.value || '').includes('Live mock transcript')",
            timeout=4,
        )
    await check('T2n AI mic records into prompt', t2n_ai_mic_records_into_prompt)

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
            "(() => {"
            "const r=document.querySelector('input[name=\"tpl-type\"][value=\"scp\"]');"
            "r.checked=true; r.dispatchEvent(new Event('change'));"
            "})()"
        )
        # Confirm picker (topmost)
        await cdp.eval(
            "[...document.querySelectorAll('.modal-overlay')].pop()"
            ".querySelector('.modal-actions button:last-child').click()"
        )
        # SCP form should appear with the multi-source controls.
        await wait_until(
            cdp,
            "!!document.getElementById('scp-source-list') && !!document.getElementById('scp-pick-files')",
            timeout=3,
        )
    await check('T6 template picker opens & SCP form loads', t6)

    # ── T7: SCP multi-file template fills cmd textarea ────────
    async def t7():
        await cdp.eval(
            "window.__mockDialogOpenResult=['/tmp/src one.txt','/tmp/src-two.txt'];"
            "document.getElementById('scp-pick-files').click();"
        )
        await wait_until(
            cdp,
            "document.querySelectorAll('#scp-source-list input').length >= 2 && "
            "[...document.querySelectorAll('#scp-source-list input')].some(x => x.value.includes('src one.txt'))",
            timeout=3,
        )
        await cdp.eval(
            "document.getElementById('scp-dst-path').value='/srv/upload/';"
            "document.getElementById('scp-src-host').value='__local__';"
            # pick a non-local dst (first vps)
            "(() => {"
            "const sel=document.getElementById('scp-dst-host');"
            "const nonlocal=[...sel.options].find(o=>o.value!=='__local__');"
            "if(nonlocal) sel.value=nonlocal.value;"
            "})()"
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
        assert 'src one.txt' in cmd and 'src-two.txt' in cmd and '/srv/upload/' in cmd, cmd
        assert "'/tmp/src one.txt'" in cmd, cmd
    await check('T7 SCP multi-file template fills command textarea', t7)

    # ── T7b: rsync multi-file template fills cmd textarea ─────
    async def t7b():
        await cdp.eval("document.getElementById('cmd-tpl-btn').click()")
        await wait_until(
            cdp,
            "document.querySelectorAll('.modal-overlay').length >= 2 && "
            "!!document.querySelector('input[name=\"tpl-type\"][value=\"rsync\"]')",
            timeout=4,
        )
        await cdp.eval(
            "(() => {"
            "const r=document.querySelector('input[name=\"tpl-type\"][value=\"rsync\"]');"
            "r.checked=true; r.dispatchEvent(new Event('change'));"
            "})()"
        )
        await cdp.eval(
            "[...document.querySelectorAll('.modal-overlay')].pop()"
            ".querySelector('.modal-actions button:last-child').click()"
        )
        await wait_until(
            cdp,
            "!!document.getElementById('rs-source-list') && !!document.getElementById('rs-pick-files')",
            timeout=3,
        )
        await cdp.eval(
            "window.__mockDialogOpenResult=['/tmp/app.conf','/tmp/env file'];"
            "document.getElementById('rs-pick-files').click();"
        )
        await wait_until(
            cdp,
            "document.querySelectorAll('#rs-source-list input').length >= 2 && "
            "[...document.querySelectorAll('#rs-source-list input')].some(x => x.value.includes('env file'))",
            timeout=3,
        )
        await cdp.eval(
            "document.getElementById('rs-dst-path').value='/srv/config/';"
            "document.getElementById('rs-src-host').value='__local__';"
            "(() => {"
            "const sel=document.getElementById('rs-dst-host');"
            "const nonlocal=[...sel.options].find(o=>o.value!=='__local__');"
            "if(nonlocal) sel.value=nonlocal.value;"
            "})()"
        )
        await cdp.eval(
            "[...document.querySelectorAll('.modal-overlay')].pop()"
            ".querySelector('.modal-actions button:last-child').click()"
        )
        await wait_until(
            cdp, "document.querySelectorAll('.modal-overlay').length === 1",
            timeout=3,
        )
        cmd = await cdp.eval("document.getElementById('cmd-command').value")
        assert cmd.startswith('rsync '), f'unexpected cmd: {cmd!r}'
        assert 'app.conf' in cmd and 'env file' in cmd and '/srv/config/' in cmd, cmd
        assert "'/tmp/env file'" in cmd, cmd
    await check('T7b rsync multi-file template fills command textarea', t7b)

    # ── T7c: SCP destination folder picker fills local dst ─────
    async def t7c():
        await cdp.eval("document.getElementById('cmd-tpl-btn').click()")
        await wait_until(
            cdp,
            "document.querySelectorAll('.modal-overlay').length >= 2 && "
            "!!document.querySelector('input[name=\"tpl-type\"][value=\"scp\"]')",
            timeout=4,
        )
        await cdp.eval(
            "(() => {"
            "const r=document.querySelector('input[name=\"tpl-type\"][value=\"scp\"]');"
            "r.checked=true; r.dispatchEvent(new Event('change'));"
            "})()"
        )
        await cdp.eval(
            "[...document.querySelectorAll('.modal-overlay')].pop()"
            ".querySelector('.modal-actions button:last-child').click()"
        )
        await wait_until(
            cdp,
            "!!document.getElementById('scp-dst-path') && !!document.getElementById('scp-pick-dst-folder')",
            timeout=3,
        )
        await cdp.eval(
            "window.__mockDialogOpenResult=(opts)=>opts.directory ? '/tmp/local dest' : ['/tmp/source.txt'];"
            "document.getElementById('scp-dst-host').value='__local__';"
            "document.getElementById('scp-pick-dst-folder').click();"
        )
        await wait_until(
            cdp,
            "document.getElementById('scp-dst-path').value === '/tmp/local dest'",
            timeout=3,
        )
        await cdp.eval(
            "[...document.querySelectorAll('.modal-overlay')].pop()"
            ".querySelector('.modal-actions button:first-child').click()"
        )
        await wait_until(
            cdp, "document.querySelectorAll('.modal-overlay').length === 1",
            timeout=3,
        )
    await check('T7c SCP destination folder picker fills local dst', t7c)

    # ── T7d: rsync destination folder picker fills local dst ───
    async def t7d():
        await cdp.eval("document.getElementById('cmd-tpl-btn').click()")
        await wait_until(
            cdp,
            "document.querySelectorAll('.modal-overlay').length >= 2 && "
            "!!document.querySelector('input[name=\"tpl-type\"][value=\"rsync\"]')",
            timeout=4,
        )
        await cdp.eval(
            "(() => {"
            "const r=document.querySelector('input[name=\"tpl-type\"][value=\"rsync\"]');"
            "r.checked=true; r.dispatchEvent(new Event('change'));"
            "})()"
        )
        await cdp.eval(
            "[...document.querySelectorAll('.modal-overlay')].pop()"
            ".querySelector('.modal-actions button:last-child').click()"
        )
        await wait_until(
            cdp,
            "!!document.getElementById('rs-dst-path') && !!document.getElementById('rs-pick-dst-folder')",
            timeout=3,
        )
        await cdp.eval(
            "window.__mockDialogOpenResult=(opts)=>opts.directory ? '/tmp/rsync target' : ['/tmp/source.txt'];"
            "document.getElementById('rs-dst-host').value='__local__';"
            "document.getElementById('rs-pick-dst-folder').click();"
        )
        await wait_until(
            cdp,
            "document.getElementById('rs-dst-path').value === '/tmp/rsync target'",
            timeout=3,
        )
        await cdp.eval(
            "[...document.querySelectorAll('.modal-overlay')].pop()"
            ".querySelector('.modal-actions button:first-child').click()"
        )
        await wait_until(
            cdp, "document.querySelectorAll('.modal-overlay').length === 1",
            timeout=3,
        )
    await check('T7d rsync destination folder picker fills local dst', t7d)

    # ── T7e: Local copy template generates PowerShell command ──
    async def t7e():
        await cdp.eval("document.getElementById('cmd-tpl-btn').click()")
        await wait_until(
            cdp,
            "document.querySelectorAll('.modal-overlay').length >= 2 && "
            "!!document.querySelector('input[name=\"tpl-type\"][value=\"local_copy\"]')",
            timeout=4,
        )
        await cdp.eval(
            "(() => {"
            "const r=document.querySelector('input[name=\"tpl-type\"][value=\"local_copy\"]');"
            "r.checked=true; r.dispatchEvent(new Event('change'));"
            "})()"
        )
        await cdp.eval(
            "[...document.querySelectorAll('.modal-overlay')].pop()"
            ".querySelector('.modal-actions button:last-child').click()"
        )
        await wait_until(
            cdp,
            "!!document.getElementById('lc-source-list') && !!document.getElementById('lc-pick-files') && "
            "!!document.getElementById('lc-pick-dst-folder')",
            timeout=3,
        )
        await cdp.eval(
            "window.__mockDialogOpenResult=(opts)=>opts.directory "
            "? 'C:\\\\Deploy Target' "
            ": ['C:\\\\Temp\\\\One File.txt','C:\\\\Temp\\\\two.txt'];"
            "document.getElementById('lc-pick-files').click();"
        )
        await wait_until(
            cdp,
            "document.querySelectorAll('#lc-source-list input').length >= 2 && "
            "[...document.querySelectorAll('#lc-source-list input')].some(x => x.value.includes('One File.txt'))",
            timeout=3,
        )
        await cdp.eval(
            "document.getElementById('lc-pick-dst-folder').click();"
            "document.getElementById('lc-shell').value='powershell';"
        )
        await wait_until(
            cdp,
            "document.getElementById('lc-dst-path').value === 'C:\\\\Deploy Target'",
            timeout=3,
        )
        await cdp.eval(
            "[...document.querySelectorAll('.modal-overlay')].pop()"
            ".querySelector('.modal-actions button:last-child').click()"
        )
        await wait_until(
            cdp, "document.querySelectorAll('.modal-overlay').length === 1",
            timeout=3,
        )
        cmd = await cdp.eval("document.getElementById('cmd-command').value")
        assert cmd.startswith('powershell '), f'unexpected cmd: {cmd!r}'
        assert '-EncodedCommand ' in cmd, cmd
        encoded = re.search(r'-EncodedCommand\s+([A-Za-z0-9+/=]+)', cmd)
        assert encoded, cmd
        script = base64.b64decode(encoded.group(1)).decode('utf-16le')
        assert 'Copy-Item' in script and 'One File.txt' in script and 'two.txt' in script and 'Deploy Target' in script, script
        assert '$ErrorActionPreference = ' in script and '-ErrorAction Stop' in script, script
        assert r"'C:\Temp\One File.txt'" in script, script
    await check('T7e Local copy template generates PowerShell command', t7e)

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

    # ── T13b: group tab scopes search calls ──────────────────
    async def t13b_group_tab_scopes_search_calls():
        await cdp.eval("""(async () => {
          localStorage.setItem('mock.repo_groups', JSON.stringify([
            { id: 501, name: 'Scoped', icon: '', color: '#10b981', sort_order: 0 }
          ]));
          localStorage.setItem('mock.repos', JSON.stringify([
            { name: 'snippets_helper', path: '/home/dev/snippets_helper', color: '#3b82f6', group_id: 501 },
            { name: 'dags-core', path: '/home/dev/dags-core', color: '#10b981', group_id: null },
            { name: 'pg-analytics', path: '/home/dev/pg-analytics', color: '#f59e0b', group_id: null }
          ]));
          localStorage.removeItem('mock.repo_search_last_search');
          document.querySelector('.tab-btn[data-tab-id="repo-search"]').click();
          await (window.__rsRefreshAfterGroupDelete && window.__rsRefreshAfterGroupDelete());
        })()""")
        await wait_until(cdp, "[...document.querySelectorAll('.rs-tab')].some(b => b.textContent.includes('Scoped'))", timeout=3)
        await cdp.eval("[...document.querySelectorAll('.rs-tab')].find(b => b.textContent.includes('Scoped')).click()")
        await wait_until(cdp, "[...document.querySelectorAll('.rs-tab.active')].some(b => b.textContent.includes('Scoped'))", timeout=2)
        await cdp.eval("[...document.querySelectorAll('.rs-inner-tab')].find(b => b.textContent.includes('Search')).click()")
        await cdp.eval("[...document.querySelectorAll('.rs-type-btn')].find(b => b.textContent.includes('Git')).click()")
        await cdp.eval("""(() => {
          const input = document.getElementById('rs-search-input');
          input.value = 'needle';
          input.dispatchEvent(new Event('input', { bubbles: true }));
          document.querySelector('.rs-search-btn').click();
        })()""")
        await wait_until(cdp, "!!localStorage.getItem('mock.repo_search_last_search')", timeout=3)
        payload = await cdp.eval("JSON.parse(localStorage.getItem('mock.repo_search_last_search'))")
        assert payload['type'] == 'git', payload
        assert payload['repos'] == ['snippets_helper'], payload
        badge = await cdp.eval("document.querySelector('#rs-scope-badge')?.textContent || ''")
        assert 'Scoped' in badge and '1 repo' in badge, badge
    await check('T13b group tab scopes search calls', t13b_group_tab_scopes_search_calls)

    # ── T13c: Repo Search header owns help/settings ──────────
    async def t13c_repo_search_header_settings_help():
        await cdp.eval("""(async () => {
          const repos = [];
          for (let i = 0; i < 36; i++) {
            repos.push({
              name: `repo-${String(i).padStart(2, '0')}`,
              path: `/home/dev/repo-${String(i).padStart(2, '0')}`,
              color: '#3b82f6',
              group_id: null,
            });
          }
          localStorage.setItem('mock.repo_groups', JSON.stringify([]));
          localStorage.setItem('mock.repos', JSON.stringify(repos));
          document.querySelector('.tab-btn[data-tab-id="repo-search"]').click();
          await (window.__rsRefreshAfterGroupDelete && window.__rsRefreshAfterGroupDelete());
        })()""")
        await wait_until(cdp, "!!document.querySelector('#panel-repo-search .rs-module-header')", timeout=4)
        title = await cdp.eval("document.querySelector('#panel-repo-search .rs-module-header h2')?.textContent.trim()")
        assert title == 'Repo Search', title
        has_help = await cdp.eval("!!document.querySelector('#panel-repo-search .rs-module-header .sql-help-btn')")
        has_settings = await cdp.eval("!!document.querySelector('#panel-repo-search .rs-module-header .rs-settings-btn')")
        assert has_help and has_settings, 'missing module header help/settings'
        old_settings = await cdp.eval("!!document.querySelector('#panel-repo-search #rs-search-panel .rs-gear-btn')")
        assert not old_settings, 'settings gear should not remain in search toolbar'
        inner_tabs = await cdp.eval("[...document.querySelectorAll('#panel-repo-search .rs-inner-tab')].map(x => x.textContent.trim())")
        assert inner_tabs == ['Search', 'Manage'], inner_tabs

        await cdp.eval("document.querySelector('#panel-repo-search .rs-module-header .sql-help-btn').click()")
        await wait_until(cdp, "!!document.querySelector('.sql-help-modal')", timeout=3)
        help_text = await cdp.eval("document.querySelector('.sql-help-body')?.textContent || ''")
        assert 'Repo Search' in help_text and 'Manage tab' in help_text, help_text[:120]
        await cdp.eval("[...document.querySelectorAll('.sql-help-modal button')].find(x => x.textContent.trim() === 'Close').click()")
        await wait_until(cdp, "!document.querySelector('.sql-help-modal')", timeout=3)

        await cdp.eval("document.querySelector('#panel-repo-search .rs-module-header .rs-settings-btn').click()")
        await wait_until(cdp, "!!document.querySelector('.rs-settings-modal')", timeout=3)
        metrics = await cdp.eval("""(() => {
          const body = document.querySelector('.rs-settings-modal-body');
          const style = getComputedStyle(body);
          return {
            overflowY: style.overflowY,
            scrollHeight: body.scrollHeight,
            clientHeight: body.clientHeight,
            repoRows: document.querySelectorAll('.rs-settings-modal .rs-path-item').length,
          };
        })()""")
        assert metrics['overflowY'] == 'auto', metrics
        assert metrics['scrollHeight'] > metrics['clientHeight'], metrics
        assert metrics['repoRows'] == 36, metrics
        await cdp.eval("[...document.querySelectorAll('.rs-settings-modal .rs-modal-actions button')].find(x => x.textContent.trim() === 'Close').click()")
        await wait_until(cdp, "!document.querySelector('.rs-settings-modal')", timeout=3)
    await check('T13c Repo Search header help/settings', t13c_repo_search_header_settings_help)

    # ── T14: expand/collapse file card ───────────────────────
    async def t14_expand_collapse_file_card():
        # Ensure we're on the Search inner tab
        await cdp.eval(
          "[...document.querySelectorAll('.rs-inner-tab')].find(b => b.textContent.includes('Search')).click()"
        )
        await cdp.eval("""(() => {
          const input = document.getElementById('rs-search-input');
          input.value = 'import';
          input.dispatchEvent(new Event('input', { bubbles: true }));
          const area = document.getElementById('rs-results');
          if (!area) return;
          area.innerHTML = `<div class="rs-file-card">
            <button data-role="rs-expand" data-path="/home/dev/repo-00/sample.py">Expand ▸</button>
          </div>`;
        })()""")
        # Click expand
        await cdp.eval("document.querySelector('[data-role=\"rs-expand\"]').click()")
        await wait_until(cdp, "!!document.getElementById('rs-fullscreen-overlay')", timeout=3)
        await wait_until(cdp, "document.querySelectorAll('#rs-fullscreen-overlay .rs-fs-line.is-match').length === 2", timeout=3)
        initial = await cdp.eval("""(() => ({
          query: document.querySelector('#rs-fullscreen-overlay .rs-fs-find-input')?.value || '',
          matches: document.querySelectorAll('#rs-fullscreen-overlay .rs-fs-line.is-match').length,
          current: document.querySelector('#rs-fullscreen-overlay .rs-fs-line.is-current')?.dataset.lineNum || '',
          counter: document.querySelector('#rs-fullscreen-overlay .rs-fs-match-count')?.textContent || '',
          hasOpen: !!document.querySelector('#rs-fullscreen-overlay [data-role="rs-open"]'),
          hasCopy: !!document.querySelector('#rs-fullscreen-overlay [data-role="rs-copy-path"]'),
          hasHistory: !!document.querySelector('#rs-fullscreen-overlay [data-role="rs-file-history"]'),
          syntax: document.querySelectorAll('#rs-fullscreen-overlay .rs-fs-code-text .hljs-keyword').length,
        }))()""")
        assert initial['query'] == 'import', initial
        assert initial['matches'] == 2, initial
        assert initial['current'] == '1', initial
        assert initial['counter'] == '1 / 2', initial
        assert initial['hasOpen'] and initial['hasCopy'] and initial['hasHistory'], initial
        assert initial['syntax'] >= 2, initial

        await cdp.eval("document.querySelector('#rs-fullscreen-overlay .rs-fs-nav-btn[title=\"Next match\"]').click()")
        after_next = await cdp.eval("""(() => ({
          current: document.querySelector('#rs-fullscreen-overlay .rs-fs-line.is-current')?.dataset.lineNum || '',
          counter: document.querySelector('#rs-fullscreen-overlay .rs-fs-match-count')?.textContent || '',
          editorLine: document.querySelector('#rs-fullscreen-overlay [data-role="rs-open"]')?.dataset.line || '',
        }))()""")
        assert after_next['current'] == '2' and after_next['counter'] == '2 / 2', after_next
        assert after_next['editorLine'] == '2', after_next

        await cdp.eval("""(() => {
          const input = document.querySelector('#rs-fullscreen-overlay .rs-fs-find-input');
          input.value = 'return';
          input.dispatchEvent(new Event('input', { bubbles: true }));
        })()""")
        await wait_until(cdp, "document.querySelectorAll('#rs-fullscreen-overlay .rs-fs-line.is-match').length === 1", timeout=3)
        updated = await cdp.eval("""(() => ({
          current: document.querySelector('#rs-fullscreen-overlay .rs-fs-line.is-current')?.dataset.lineNum || '',
          counter: document.querySelector('#rs-fullscreen-overlay .rs-fs-match-count')?.textContent || '',
          inlineHits: document.querySelectorAll('#rs-fullscreen-overlay .rs-inline-hit').length,
          syntaxAndSearch: !!document.querySelector('#rs-fullscreen-overlay .rs-fs-line.is-match .hljs-keyword .rs-inline-hit'),
        }))()""")
        assert updated['current'] == '6' and updated['counter'] == '1 / 1', updated
        assert updated['inlineHits'] >= 1, updated
        assert updated['syntaxAndSearch'], updated
        await cdp.eval("""(() => {
          localStorage.removeItem('mock.repo_search_last_open_editor');
          document.querySelector('#rs-fullscreen-overlay [data-role="rs-open"]').click();
        })()""")
        await wait_until(cdp, "!!localStorage.getItem('mock.repo_search_last_open_editor')", timeout=2)
        opened = await cdp.eval("JSON.parse(localStorage.getItem('mock.repo_search_last_open_editor'))")
        assert opened['path'] == '/home/dev/repo-00/sample.py' and opened['line'] == 6, opened

        await cdp.eval("document.querySelector('#rs-fullscreen-overlay [data-role=\"rs-file-history\"]').click()")
        await wait_until(cdp, "document.querySelectorAll('#rs-fullscreen-overlay .rs-fs-history-row').length === 2", timeout=3)
        history = await cdp.eval("""(() => ({
          rows: document.querySelectorAll('#rs-fullscreen-overlay .rs-fs-history-row').length,
          active: document.querySelector('#rs-fullscreen-overlay .rs-fs-history-row.active .rs-fs-history-message')?.textContent || '',
          diffHead: document.querySelector('#rs-fullscreen-overlay .rs-fs-history-diff-head')?.textContent || '',
          diff: document.querySelector('#rs-fullscreen-overlay .rs-fs-history-diff')?.textContent || '',
          highlighted: document.querySelectorAll('#rs-fullscreen-overlay .rs-fs-history-diff .hljs-addition').length,
          backLabel: document.querySelector('#rs-fullscreen-overlay [data-role="rs-file-history"]')?.textContent || '',
        }))()""")
        assert history['rows'] == 2, history
        assert 'update file history sample' in history['active'], history
        assert '2026-06-20' in history['diffHead'] and 'Mock User' in history['diffHead'], history
        assert '+import sys' in history['diff'] and history['highlighted'] >= 1, history
        assert history['backLabel'] == 'Back to file', history

        await cdp.eval("document.querySelector('#rs-fullscreen-overlay [data-role=\"rs-file-history\"]').click()")
        await wait_until(cdp, "!!document.querySelector('#rs-fullscreen-overlay .rs-fs-findbar') && getComputedStyle(document.querySelector('#rs-fullscreen-overlay .rs-fs-findbar')).display !== 'none'", timeout=3)
        back = await cdp.eval("""(() => ({
          label: document.querySelector('#rs-fullscreen-overlay [data-role="rs-file-history"]')?.textContent || '',
          syntax: document.querySelectorAll('#rs-fullscreen-overlay .rs-fs-code-text .hljs-keyword').length,
        }))()""")
        assert back['label'] == 'History' and back['syntax'] >= 2, back

        await cdp.eval("""(() => {
          const input = document.querySelector('#rs-fullscreen-overlay .rs-fs-find-input');
          input.value = 'no-such-pattern';
          input.dispatchEvent(new Event('input', { bubbles: true }));
        })()""")
        no_match = await cdp.eval("""(() => ({
          matches: document.querySelectorAll('#rs-fullscreen-overlay .rs-fs-line.is-match').length,
          counter: document.querySelector('#rs-fullscreen-overlay .rs-fs-match-count')?.textContent || '',
          editorLine: document.querySelector('#rs-fullscreen-overlay [data-role="rs-open"]')?.dataset.line || '',
          disabled: document.querySelector('#rs-fullscreen-overlay .rs-fs-nav-btn[title="Next match"]')?.disabled || false,
        }))()""")
        assert no_match['matches'] == 0 and no_match['counter'] == '0 / 0', no_match
        assert no_match['editorLine'] == '1' and no_match['disabled'], no_match
        # Click collapse
        await cdp.eval(
          "document.getElementById('rs-fullscreen-overlay').querySelector('[data-role=\"rs-collapse\"]').click()"
        )
        await wait_until(cdp, "!document.getElementById('rs-fullscreen-overlay')", timeout=3)
    await check('T14 expand/collapse file card', t14_expand_collapse_file_card)

    # ── T14b: Snippets pinned panel + rename chip ───────────
    async def t14b_snippets_pinned_panel_and_rename():
        await cdp.eval("""(() => {
          const settings = JSON.parse(localStorage.getItem('mock.settings') || '{}');
          settings.snippets_show_tags_panel = '1';
          settings.snippets_show_pinned_panel = '0';
          localStorage.setItem('mock.settings', JSON.stringify(settings));
        })()""")
        await open_shortcuts_tab()
        await wait_until(cdp, "!!document.querySelector('#panel-shortcuts .snippet-pinned-toggle')", timeout=4)
        await cdp.eval("""(() => {
          const btn = document.querySelector('#panel-shortcuts .snippet-pinned-toggle');
          if (btn?.dataset.active !== '1') btn.click();
        })()""")
        await wait_until(
            cdp,
            "!!document.querySelector('#panel-shortcuts .snippet-pinned-panel')",
            timeout=2,
        )
        await wait_until(
            cdp,
            "document.querySelector('#panel-shortcuts .snippet-pinned-toggle')?.dataset.active === '1'",
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
        await cdp.eval("""(() => {
          const btn = document.querySelector('#panel-shortcuts .snippet-pinned-toggle');
          if (btn?.dataset.active === '1') btn.click();
        })()""")
        await wait_until(
            cdp,
            "!document.querySelector('#panel-shortcuts .snippet-pinned-panel')",
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
        await wait_until(cdp, "document.body.innerText.includes('Telegra.ph')", timeout=3)
        await cdp.eval(
            "[...document.querySelectorAll('.share-link-telegraph-actions button')]"
            ".find(b => b.textContent.includes('Publish to Telegra.ph')).click()"
        )
        await wait_until(cdp, "document.body.innerText.includes('Published snapshot')", timeout=3)
        telegraph_url = await cdp.eval("document.querySelector('.share-link-telegraph .share-link-input')?.value || ''")
        assert telegraph_url.startswith('https://telegra.ph/'), telegraph_url
        commands = await cdp.eval("window.__mockCommandLog.map(x => x.command)")
        assert 'publish_telegraph_page' in commands, f'commands: {commands!r}'
        await cdp.eval("window.__mockFailTelegraphPublish = true")
        await cdp.eval(
            "[...document.querySelectorAll('.share-link-telegraph-actions button')]"
            ".find(b => b.textContent.includes('Update Telegra.ph')).click()"
        )
        await wait_until(cdp, "document.body.innerText.includes('Telegra.ph publish failed')", timeout=3)
        copy_label = await cdp.eval("document.querySelector('.error-dialog .btn-secondary')?.textContent.trim() || ''")
        assert copy_label == 'Copy error', copy_label
        await cdp.eval("window.__mockFailTelegraphPublish = false")
        await cdp.eval("document.querySelector('.error-dialog-ok').click()")
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

    # ── T15b2: Tasks collapsed link shelf settings + DnD ────
    async def t15b2_tasks_collapsed_link_shelf_settings_and_dnd():
        await cdp.eval("""(() => {
          const settings = JSON.parse(localStorage.getItem('mock.settings') || '{}');
          settings.last_active_tab = 'tasks';
          settings.tasks_collapsed_links_enabled = 'false';
          delete settings.tasks_collapsed_link_marker;
          delete settings.tasks_collapsed_link_color;
          localStorage.setItem('mock.settings', JSON.stringify(settings));
          const stamp = new Date().toISOString();
          const links = [
            { id: 210, uuid: 'mock-link-210', task_id: 2, url: 'https://example.com/alpha', label: 'Alpha docs', sort_order: 0, created_at: stamp, updated_at: stamp, sync_status: 'synced', user_id: 'mock-user' },
            { id: 211, uuid: 'mock-link-211', task_id: 2, url: 'https://example.com/beta', label: 'Beta console', sort_order: 1, created_at: stamp, updated_at: stamp, sync_status: 'synced', user_id: 'mock-user' },
          ];
          const others = JSON.parse(localStorage.getItem('mock.task_links') || '[]')
            .filter(x => x.task_id !== 2);
          localStorage.setItem('mock.task_links', JSON.stringify([...others, ...links]));
          localStorage.setItem('mock.__seq.task_links', '211');
          window.__mockOpenedUrls = [];
          window.__directTaskWindowOpenUrls = [];
          window.__originalOpenForTaskLinks = window.open;
          window.open = (url) => {
            window.__directTaskWindowOpenUrls.push(String(url));
            return null;
          };
        })()""")
        try:
            await cdp.eval("document.querySelector('.tab-btn[data-tab-id=\"tasks\"]').click()")
            await wait_until(cdp, "!!document.querySelector('#panel-tasks .tasks-wrap')", timeout=5)
            await cdp.eval("document.querySelector('#panel-tasks .tasks-header .task-icon-btn[title=\"Display settings\"]')?.click()")
            settings_text = await wait_until(cdp, "document.querySelector('.modal-overlay')?.innerText", timeout=3)
            assert 'Collapsed links' in settings_text, settings_text
            assert 'Show links in collapsed cards' in settings_text, settings_text
            assert 'Diamond resource' in settings_text, settings_text
            await cdp.eval("""(() => {
              const modal = document.querySelector('.modal-overlay');
              modal.querySelector('#tasks-set-links-enabled').checked = true;
              modal.querySelector('#tasks-set-link-marker').value = '◈';
              modal.querySelector('#tasks-set-link-color').value = '#d29922';
              modal.querySelector('.modal-actions button:last-child')?.click();
            })()""")
            await wait_until(cdp, "!document.querySelector('.modal-overlay')", timeout=3)
            shelf = await wait_until(
                cdp,
                """(() => {
                  const card = [...document.querySelectorAll('#panel-tasks .task-card')]
                    .find(x => x.querySelector('.task-title')?.textContent.includes('Regular mock task'));
                  const shelf = card?.querySelector('.task-link-shelf');
                  if (!shelf) return null;
                  return {
                    text: shelf.textContent,
                    marker: shelf.querySelector('.task-link-chip-marker')?.textContent || '',
                    color: getComputedStyle(shelf.querySelector('.task-link-chip')).borderColor,
                    beforeCheckboxes: (() => {
                      const body = shelf.parentElement;
                      const firstCheckboxAreaRow = [...body.children]
                        .find(x => x.classList.contains('tcb-item') || x.classList.contains('tcb-add'));
                      return !!firstCheckboxAreaRow
                        && !!(shelf.compareDocumentPosition(firstCheckboxAreaRow) & Node.DOCUMENT_POSITION_FOLLOWING);
                    })(),
                  };
                })()""",
                timeout=4,
            )
            assert 'Alpha docs' in shelf['text'] and 'Beta console' in shelf['text'], shelf
            assert shelf['marker'] == '◈', shelf
            assert shelf['beforeCheckboxes'] is True, shelf

            await cdp.eval("""(() => {
              const chip = [...document.querySelectorAll('#panel-tasks .task-link-chip')]
                .find(x => x.textContent.includes('Alpha docs'));
              chip?.click();
            })()""")
            opened = await wait_until(
                cdp,
                """(() => {
                  const urls = window.__mockOpenedUrls || [];
                  return urls.includes('https://example.com/alpha') ? urls : null;
                })()""",
                timeout=3,
            )
            assert opened == ['https://example.com/alpha'], opened

            await cdp.eval("""(async () => {
              const shelf = [...document.querySelectorAll('#panel-tasks .task-card')]
                .find(x => x.querySelector('.task-title')?.textContent.includes('Regular mock task'))
                ?.querySelector('.task-link-shelf');
              const chips = [...shelf.querySelectorAll('.task-link-chip')];
              const from = chips[1];
              const to = chips[0];
              const fr = from.getBoundingClientRect();
              const tr = to.getBoundingClientRect();
              const sx = fr.left + fr.width / 2;
              const sy = fr.top + fr.height / 2;
              const tx = tr.left + 2;
              const ty = tr.top + tr.height / 2;
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
                """(() => {
                  const links = JSON.parse(localStorage.getItem('mock.task_links') || '[]')
                    .filter(x => x.task_id === 2 && x.sync_status !== 'deleted')
                    .sort((a, b) => a.sort_order - b.sort_order || a.id - b.id)
                    .map(x => x.label);
                  return links[0] === 'Beta console' ? links : null;
                })()""",
                timeout=3,
            )

            await cdp.eval(
                "[...document.querySelectorAll('.task-title')]"
                ".find(x => x.textContent.includes('Regular mock task')).click()"
            )
            await wait_until(
                cdp,
                "document.querySelector('.task-editor-title')?.value === 'Regular mock task'",
                timeout=3,
            )
            await cdp.eval("""(() => {
              const trackerRow = [...document.querySelectorAll('#panel-tasks .task-editor-row')]
                .find(x => x.querySelector('.task-editor-label')?.textContent.trim() === 'Tracker');
              const trackerInput = trackerRow?.querySelector('input');
              if (trackerInput) trackerInput.value = 'https://tracker.example.com/TASK-2';
              const trackerButton = [...trackerRow?.querySelectorAll('button') || []]
                .find(x => x.textContent.includes('Open'));
              trackerButton?.click();
            })()""")
            opened = await wait_until(
                cdp,
                """(() => {
                  const urls = window.__mockOpenedUrls || [];
                  return urls[urls.length - 1] === 'https://tracker.example.com/TASK-2' ? urls : null;
                })()""",
                timeout=3,
            )
            assert opened[-1] == 'https://tracker.example.com/TASK-2', opened

            await cdp.eval("""(() => {
              const row = [...document.querySelectorAll('.task-editor-link-row')]
                .find(x => x.querySelector('.url-in')?.value === 'https://example.com/alpha');
              row?.querySelector('.task-icon-btn[title="Open"]')?.click();
            })()""")
            opened = await wait_until(
                cdp,
                """(() => {
                  const urls = window.__mockOpenedUrls || [];
                  return urls[urls.length - 1] === 'https://example.com/alpha' && urls.length >= 3 ? urls : null;
                })()""",
                timeout=3,
            )
            assert opened[-1] == 'https://example.com/alpha', opened
        finally:
            await cdp.eval("""(() => {
              if (window.__originalOpenForTaskLinks) {
                window.open = window.__originalOpenForTaskLinks;
                delete window.__originalOpenForTaskLinks;
              }
              delete window.__directTaskWindowOpenUrls;
            })()""")
    await check('T15b2 Tasks collapsed link shelf settings + DnD', t15b2_tasks_collapsed_link_shelf_settings_and_dnd)

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

    # ── T15e: Enter inserts checkbox after current sibling ───
    async def t15e_tasks_checkbox_enter_inserts_after_current():
        async def restore_task2_checkboxes():
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

        try:
            await cdp.eval("""(() => {
              const stamp = new Date().toISOString();
              const settings = JSON.parse(localStorage.getItem('mock.settings') || '{}');
              settings.last_active_tab = 'tasks';
              delete settings.tasks_collapsed_checkbox_ids;
              localStorage.setItem('mock.settings', JSON.stringify(settings));
              const rows = [
                {
                  id: 40, task_id: 2, parent_id: null,
                  text: 'Enter root before', is_checked: false,
                  sort_order: 0, created_at: stamp, updated_at: stamp,
                  sync_status: 'synced', user_id: 'mock-user',
                },
                {
                  id: 41, task_id: 2, parent_id: null,
                  text: 'Enter root current', is_checked: false,
                  sort_order: 1, created_at: stamp, updated_at: stamp,
                  sync_status: 'synced', user_id: 'mock-user',
                },
                {
                  id: 42, task_id: 2, parent_id: null,
                  text: 'Enter hidden completed root', is_checked: true,
                  sort_order: 2, created_at: stamp, updated_at: stamp,
                  sync_status: 'synced', user_id: 'mock-user',
                },
                {
                  id: 43, task_id: 2, parent_id: null,
                  text: 'Enter root after', is_checked: false,
                  sort_order: 3, created_at: stamp, updated_at: stamp,
                  sync_status: 'synced', user_id: 'mock-user',
                },
                {
                  id: 44, task_id: 2, parent_id: 41,
                  text: 'Enter child current', is_checked: false,
                  sort_order: 0, created_at: stamp, updated_at: stamp,
                  sync_status: 'synced', user_id: 'mock-user',
                },
                {
                  id: 45, task_id: 2, parent_id: 41,
                  text: 'Enter child after', is_checked: false,
                  sort_order: 1, created_at: stamp, updated_at: stamp,
                  sync_status: 'synced', user_id: 'mock-user',
                },
                {
                  id: 46, task_id: 2, parent_id: 44,
                  text: 'Enter grandchild current', is_checked: false,
                  sort_order: 0, created_at: stamp, updated_at: stamp,
                  sync_status: 'synced', user_id: 'mock-user',
                },
                {
                  id: 47, task_id: 2, parent_id: 44,
                  text: 'Enter grandchild after', is_checked: false,
                  sort_order: 1, created_at: stamp, updated_at: stamp,
                  sync_status: 'synced', user_id: 'mock-user',
                },
              ];
              const others = JSON.parse(localStorage.getItem('mock.task_checkboxes') || '[]')
                .filter(x => x.task_id !== 2);
              localStorage.setItem('mock.task_checkboxes', JSON.stringify([...others, ...rows]));
              localStorage.setItem('mock.__seq.task_checkboxes', '47');
              window.dispatchEvent(new CustomEvent('snippets:sync-complete', {
                detail: {
                  result: {
                    timestamp: '12:00:00',
                    push: { total: 0, pushed: {} },
                    pull: { total: 1, pulled: { task_checkboxes: ['enter fixture'] } },
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
                ".some(x => x.textContent.includes('Enter grandchild after'))",
                timeout=4,
            )
            hidden_visible = await cdp.eval(
                "[...document.querySelectorAll('.tcb-text')]"
                ".some(x => x.textContent.includes('Enter hidden completed root'))"
            )
            assert hidden_visible is False, 'completed root fixture should be hidden in the UI'

            await cdp.eval("""(() => {
              const row = [...document.querySelectorAll('.tcb-item')]
                .find(x => x.querySelector('.tcb-text')?.textContent.includes('Enter root current'));
              const text = row?.querySelector('.tcb-text');
              text?.dispatchEvent(new KeyboardEvent('keydown', {
                key: 'Enter',
                bubbles: true,
                cancelable: true,
              }));
            })()""")
            await wait_until(
                cdp,
                "JSON.parse(localStorage.getItem('mock.task_checkboxes') || '[]')"
                ".some(x => x.task_id === 2 && x.id > 47)",
                timeout=3,
            )
            root_created_id = await cdp.eval("""(() => {
              return JSON.parse(localStorage.getItem('mock.task_checkboxes') || '[]')
                .filter(x => x.task_id === 2 && x.parent_id == null && x.id > 47 && x.text === '')
                .sort((a, b) => a.id - b.id)[0]?.id || null;
            })()""")
            root_order = await cdp.eval("""(() => {
              return JSON.parse(localStorage.getItem('mock.task_checkboxes') || '[]')
                .filter(x => x.task_id === 2 && x.parent_id == null && x.sync_status !== 'deleted')
                .sort((a, b) => a.sort_order - b.sort_order || a.id - b.id)
                .map(x => x.text || `new:${x.id}`);
            })()""")
            assert root_order == [
                'Enter root before',
                'Enter root current',
                f'new:{root_created_id}',
                'Enter hidden completed root',
                'Enter root after',
            ], f'root order after Enter: {root_order!r}'

            await wait_until(
                cdp,
                f"document.querySelector('[data-cb-id=\"{root_created_id}\"] .tcb-text[contenteditable=\"true\"]') === document.activeElement",
                timeout=3,
            )
            await cdp.eval("""(() => {
              const row = [...document.querySelectorAll('.tcb-item')]
                .find(x => x.querySelector('.tcb-text')?.textContent.includes('Enter child current'));
              const text = row?.querySelector('.tcb-text');
              text?.dispatchEvent(new KeyboardEvent('keydown', {
                key: 'Enter',
                bubbles: true,
                cancelable: true,
              }));
            })()""")
            await wait_until(
                cdp,
                f"JSON.parse(localStorage.getItem('mock.task_checkboxes') || '[]')"
                f".some(x => x.task_id === 2 && x.id > {root_created_id})",
                timeout=3,
            )
            child_created_id = await cdp.eval(f"""(() => {{
              return JSON.parse(localStorage.getItem('mock.task_checkboxes') || '[]')
                .filter(x => x.task_id === 2 && x.parent_id === 41 && x.id > {root_created_id} && x.text === '')
                .sort((a, b) => a.id - b.id)[0]?.id || null;
            }})()""")
            child_order = await cdp.eval("""(() => {
              return JSON.parse(localStorage.getItem('mock.task_checkboxes') || '[]')
                .filter(x => x.task_id === 2 && x.parent_id === 41 && x.sync_status !== 'deleted')
                .sort((a, b) => a.sort_order - b.sort_order || a.id - b.id)
                .map(x => x.text || `new:${x.id}`);
            })()""")
            assert child_order == [
                'Enter child current',
                f'new:{child_created_id}',
                'Enter child after',
            ], f'child order after Enter: {child_order!r}'

            await cdp.eval("""(() => {
              const row = [...document.querySelectorAll('.tcb-item')]
                .find(x => x.querySelector('.tcb-text')?.textContent.includes('Enter grandchild current'));
              const text = row?.querySelector('.tcb-text');
              text?.dispatchEvent(new KeyboardEvent('keydown', {
                key: 'Enter',
                bubbles: true,
                cancelable: true,
              }));
            })()""")
            await wait_until(
                cdp,
                f"JSON.parse(localStorage.getItem('mock.task_checkboxes') || '[]')"
                f".some(x => x.task_id === 2 && x.id > {child_created_id})",
                timeout=3,
            )
            grandchild_created_id = await cdp.eval(f"""(() => {{
              return JSON.parse(localStorage.getItem('mock.task_checkboxes') || '[]')
                .filter(x => x.task_id === 2 && x.parent_id === 44 && x.id > {child_created_id} && x.text === '')
                .sort((a, b) => a.id - b.id)[0]?.id || null;
            }})()""")
            grandchild_order = await cdp.eval("""(() => {
              return JSON.parse(localStorage.getItem('mock.task_checkboxes') || '[]')
                .filter(x => x.task_id === 2 && x.parent_id === 44 && x.sync_status !== 'deleted')
                .sort((a, b) => a.sort_order - b.sort_order || a.id - b.id)
                .map(x => x.text || `new:${x.id}`);
            })()""")
            assert grandchild_order == [
                'Enter grandchild current',
                f'new:{grandchild_created_id}',
                'Enter grandchild after',
            ], f'grandchild order after Enter: {grandchild_order!r}'
        finally:
            await restore_task2_checkboxes()
    await check('T15e Tasks checkbox Enter inserts after current sibling', t15e_tasks_checkbox_enter_inserts_after_current)

    # ── T15f: Arrow keys move between visible checkbox rows ───
    async def t15f_tasks_checkbox_arrow_navigation_uses_visible_rows():
        async def restore_task2_checkboxes():
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

        try:
            await cdp.eval("""(() => {
              const stamp = new Date().toISOString();
              const settings = JSON.parse(localStorage.getItem('mock.settings') || '{}');
              settings.last_active_tab = 'tasks';
              delete settings.tasks_collapsed_checkbox_ids;
              localStorage.setItem('mock.settings', JSON.stringify(settings));
              const rows = [
                {
                  id: 70, task_id: 2, parent_id: null,
                  text: 'Arrow previous', is_checked: false,
                  sort_order: 0, created_at: stamp, updated_at: stamp,
                  sync_status: 'synced', user_id: 'mock-user',
                },
                {
                  id: 71, task_id: 2, parent_id: null,
                  text: 'Arrow hidden before current', is_checked: true,
                  sort_order: 1, created_at: stamp, updated_at: stamp,
                  sync_status: 'synced', user_id: 'mock-user',
                },
                {
                  id: 72, task_id: 2, parent_id: null,
                  text: 'Arrow current', is_checked: false,
                  sort_order: 2, created_at: stamp, updated_at: stamp,
                  sync_status: 'synced', user_id: 'mock-user',
                },
                {
                  id: 73, task_id: 2, parent_id: null,
                  text: 'Arrow hidden after current', is_checked: true,
                  sort_order: 3, created_at: stamp, updated_at: stamp,
                  sync_status: 'synced', user_id: 'mock-user',
                },
                {
                  id: 74, task_id: 2, parent_id: null,
                  text: 'Arrow next', is_checked: false,
                  sort_order: 4, created_at: stamp, updated_at: stamp,
                  sync_status: 'synced', user_id: 'mock-user',
                },
                {
                  id: 75, task_id: 2, parent_id: null,
                  text: 'Arrow nested parent', is_checked: false,
                  sort_order: 5, created_at: stamp, updated_at: stamp,
                  sync_status: 'synced', user_id: 'mock-user',
                },
                {
                  id: 76, task_id: 2, parent_id: 75,
                  text: 'Arrow nested child', is_checked: false,
                  sort_order: 0, created_at: stamp, updated_at: stamp,
                  sync_status: 'synced', user_id: 'mock-user',
                },
              ];
              const others = JSON.parse(localStorage.getItem('mock.task_checkboxes') || '[]')
                .filter(x => x.task_id !== 2);
              localStorage.setItem('mock.task_checkboxes', JSON.stringify([...others, ...rows]));
              localStorage.setItem('mock.__seq.task_checkboxes', '76');
              window.dispatchEvent(new CustomEvent('snippets:sync-complete', {
                detail: {
                  result: {
                    timestamp: '12:00:00',
                    push: { total: 0, pushed: {} },
                    pull: { total: 1, pulled: { task_checkboxes: ['arrow fixture'] } },
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
                ".some(x => x.textContent.includes('Arrow nested child'))",
                timeout=4,
            )
            hidden_visible = await cdp.eval(
                "[...document.querySelectorAll('.tcb-text')]"
                ".some(x => x.textContent.includes('Arrow hidden before current') || x.textContent.includes('Arrow hidden after current'))"
            )
            assert hidden_visible is False, 'completed arrow fixture rows should be hidden in the UI'

            up_result = await cdp.eval("""(() => {
              const rowByText = (text) => [...document.querySelectorAll('.tcb-item')]
                .find(row => row.querySelector('.tcb-text')?.textContent.includes(text));
              const textByText = (text) => rowByText(text)?.querySelector('.tcb-text');
              const setCaret = (el, atEnd) => {
                el.focus();
                const range = document.createRange();
                range.selectNodeContents(el);
                range.collapse(!atEnd);
                const sel = window.getSelection();
                sel.removeAllRanges();
                sel.addRange(range);
              };
              const caretOffset = (el) => {
                const sel = window.getSelection();
                if (!sel || sel.rangeCount === 0) return -1;
                const range = sel.getRangeAt(0);
                const pre = range.cloneRange();
                pre.selectNodeContents(el);
                pre.setEnd(range.endContainer, range.endOffset);
                return pre.toString().length;
              };
              const current = textByText('Arrow current');
              setCaret(current, false);
              current.dispatchEvent(new KeyboardEvent('keydown', {
                key: 'ArrowUp',
                bubbles: true,
                cancelable: true,
              }));
              const active = document.activeElement;
              return {
                activeText: active?.textContent || '',
                offset: active ? caretOffset(active) : -1,
              };
            })()""")
            assert 'Arrow previous' in up_result['activeText'], f'ArrowUp active row: {up_result!r}'
            assert up_result['offset'] == 0, f'ArrowUp caret offset: {up_result!r}'

            down_result = await cdp.eval("""(() => {
              const rowByText = (text) => [...document.querySelectorAll('.tcb-item')]
                .find(row => row.querySelector('.tcb-text')?.textContent.includes(text));
              const textByText = (text) => rowByText(text)?.querySelector('.tcb-text');
              const setCaret = (el, atEnd) => {
                el.focus();
                const range = document.createRange();
                range.selectNodeContents(el);
                range.collapse(!atEnd);
                const sel = window.getSelection();
                sel.removeAllRanges();
                sel.addRange(range);
              };
              const caretOffset = (el) => {
                const sel = window.getSelection();
                if (!sel || sel.rangeCount === 0) return -1;
                const range = sel.getRangeAt(0);
                const pre = range.cloneRange();
                pre.selectNodeContents(el);
                pre.setEnd(range.endContainer, range.endOffset);
                return pre.toString().length;
              };
              const current = textByText('Arrow current');
              setCaret(current, true);
              current.dispatchEvent(new KeyboardEvent('keydown', {
                key: 'ArrowDown',
                bubbles: true,
                cancelable: true,
              }));
              const active = document.activeElement;
              return {
                activeText: active?.textContent || '',
                offset: active ? caretOffset(active) : -1,
              };
            })()""")
            assert 'Arrow next' in down_result['activeText'], f'ArrowDown active row: {down_result!r}'
            assert down_result['offset'] == 0, f'ArrowDown caret offset: {down_result!r}'
        finally:
            await restore_task2_checkboxes()
    await check('T15f Tasks checkbox arrow navigation uses visible rows', t15f_tasks_checkbox_arrow_navigation_uses_visible_rows)

    # ── T15g: Tab indent expands collapsed new parent ────────
    async def t15g_tasks_tab_indent_expands_collapsed_parent():
        async def restore_task2_checkboxes_and_settings():
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
              const settings = JSON.parse(localStorage.getItem('mock.settings') || '{}');
              delete settings.tasks_collapsed_checkbox_ids;
              localStorage.setItem('mock.settings', JSON.stringify(settings));
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

        try:
            await cdp.eval("""(() => {
              const stamp = new Date().toISOString();
              const settings = JSON.parse(localStorage.getItem('mock.settings') || '{}');
              settings.last_active_tab = 'tasks';
              delete settings.tasks_collapsed_checkbox_ids;
              localStorage.setItem('mock.settings', JSON.stringify(settings));
              const rows = [
                { id: 90, task_id: 2, parent_id: null, text: 'Tab collapsed parent', is_checked: false, sort_order: 0, created_at: stamp, updated_at: stamp, sync_status: 'synced', user_id: 'mock-user' },
                { id: 91, task_id: 2, parent_id: 90, text: 'Tab existing hidden child', is_checked: false, sort_order: 0, created_at: stamp, updated_at: stamp, sync_status: 'synced', user_id: 'mock-user' },
                { id: 92, task_id: 2, parent_id: null, text: 'Tab current sibling', is_checked: false, sort_order: 1, created_at: stamp, updated_at: stamp, sync_status: 'synced', user_id: 'mock-user' },
              ];
              const others = JSON.parse(localStorage.getItem('mock.task_checkboxes') || '[]')
                .filter(x => x.task_id !== 2);
              localStorage.setItem('mock.task_checkboxes', JSON.stringify([...others, ...rows]));
              localStorage.setItem('mock.__seq.task_checkboxes', '92');
              window.dispatchEvent(new CustomEvent('snippets:sync-complete', {
                detail: {
                  result: {
                    timestamp: '12:00:00',
                    push: { total: 0, pushed: {} },
                    pull: { total: 1, pulled: { task_checkboxes: ['tab fixture'] } },
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
                ".some(x => x.textContent.includes('Tab current sibling'))",
                timeout=4,
            )
            await wait_until(
                cdp,
                "[...document.querySelectorAll('.tcb-text')]"
                ".some(x => x.textContent.includes('Tab existing hidden child'))",
                timeout=4,
            )
            await cdp.eval("""(() => {
              const parentRow = [...document.querySelectorAll('.tcb-item')]
                .find(x => x.querySelector('.tcb-text')?.textContent.includes('Tab collapsed parent'));
              parentRow?.querySelector('.tcb-arrow')?.click();
            })()""")
            await wait_until(
                cdp,
                "![...document.querySelectorAll('.tcb-text')].some(x => x.textContent.includes('Tab existing hidden child'))",
                timeout=3,
            )
            hidden_child_visible = await cdp.eval(
                "[...document.querySelectorAll('.tcb-text')]"
                ".some(x => x.textContent.includes('Tab existing hidden child'))"
            )
            assert hidden_child_visible is False, 'fixture parent must start collapsed'

            await cdp.eval("""(() => {
              const row = [...document.querySelectorAll('.tcb-item')]
                .find(x => x.querySelector('.tcb-text')?.textContent.includes('Tab current sibling'));
              const text = row?.querySelector('.tcb-text');
              text?.dispatchEvent(new KeyboardEvent('keydown', {
                key: 'Tab',
                bubbles: true,
                cancelable: true,
              }));
            })()""")
            await wait_until(
                cdp,
                "JSON.parse(localStorage.getItem('mock.task_checkboxes') || '[]').find(x => x.id === 92)?.parent_id === 90",
                timeout=3,
            )
            visible_after_indent = await wait_until(
                cdp,
                """(() => {
                  const rows = [...document.querySelectorAll('.tcb-text')].map(x => x.textContent);
                  return rows.includes('Tab existing hidden child') && rows.includes('Tab current sibling') ? rows : null;
                })()""",
                timeout=3,
            )
            assert 'Tab current sibling' in visible_after_indent, visible_after_indent
            collapsed_ids = await cdp.eval("""(() => {
              const settings = JSON.parse(localStorage.getItem('mock.settings') || '{}');
              return JSON.parse(settings.tasks_collapsed_checkbox_ids || '[]');
            })()""")
            assert 90 not in collapsed_ids, collapsed_ids
        finally:
            await restore_task2_checkboxes_and_settings()
    await check('T15g Tasks checkbox Tab expands collapsed parent', t15g_tasks_tab_indent_expands_collapsed_parent)

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

    # ── T20b: New snippet draft survives accidental close ───
    async def t20b_snippets_new_editor_draft_restore():
        await clear_snippet_drafts()
        await cdp.eval("""
          document.querySelectorAll('.modal-overlay').forEach(el => el.remove());
        """)
        await open_shortcuts_tab()
        await cdp.eval("document.querySelector('#panel-shortcuts button[title=\"Add shortcut\"]').click()")
        await wait_until(cdp, "!!document.querySelector('.modal-overlay textarea[placeholder^=\"Value\"]')", timeout=3)
        await cdp.eval("""
          var draftNameInput = document.querySelector('.modal-overlay input[placeholder="Name"]');
          var draftValueInput = document.querySelector('.modal-overlay textarea[placeholder^="Value"]');
          draftNameInput.value = 'Draft guarded snippet';
          draftValueInput.value = 'draft body';
          draftNameInput.dispatchEvent(new Event('input', { bubbles: true }));
          draftValueInput.dispatchEvent(new Event('input', { bubbles: true }));
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        """)
        await wait_until(
            cdp,
            "[...document.querySelectorAll('.modal h3')].some(x => x.textContent.includes('Discard unsaved changes'))",
            timeout=3,
        )
        overlay_count = await cdp.eval("document.querySelectorAll('.modal-overlay').length")
        assert overlay_count == 2, f'expected editor + discard confirm, got {overlay_count}'
        await cdp.eval("""
          var overlayTop = [...document.querySelectorAll('.modal-overlay')].at(-1);
          [...overlayTop.querySelectorAll('.modal-actions button')]
            .find(btn => btn.textContent.trim() === 'Continue editing')
            .click();
        """)
        await wait_until(cdp, "document.querySelectorAll('.modal-overlay').length === 1", timeout=3)
        value = await cdp.eval("document.querySelector('.modal-overlay textarea[placeholder^=\"Value\"]')?.value")
        assert value == 'draft body', f'editor should stay open with draft text, got {value!r}'

        await cdp.eval("""
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        """)
        await wait_until(
            cdp,
            "[...document.querySelectorAll('.modal h3')].some(x => x.textContent.includes('Discard unsaved changes'))",
            timeout=3,
        )
        await cdp.eval("""
          var overlayTop = [...document.querySelectorAll('.modal-overlay')].at(-1);
          [...overlayTop.querySelectorAll('.modal-actions button')]
            .find(btn => btn.textContent.trim() === 'Discard')
            .click();
        """)
        await wait_until(cdp, "document.querySelectorAll('.modal-overlay').length === 0", timeout=3)
        draft_after_discard = await cdp.eval("localStorage.getItem('snippet_editor_draft_new_v1')")
        assert draft_after_discard is None, f'draft should clear after discard: {draft_after_discard!r}'

        await cdp.eval("document.querySelector('#panel-shortcuts button[title=\"Add shortcut\"]').click()")
        await wait_until(cdp, "!!document.querySelector('.modal-overlay textarea[placeholder^=\"Value\"]')", timeout=3)
        await cdp.eval("""
          var draftNameInput = document.querySelector('.modal-overlay input[placeholder="Name"]');
          var draftValueInput = document.querySelector('.modal-overlay textarea[placeholder^="Value"]');
          draftNameInput.value = 'Restored draft snippet';
          draftValueInput.value = 'restored draft body';
          draftNameInput.dispatchEvent(new Event('input', { bubbles: true }));
          draftValueInput.dispatchEvent(new Event('input', { bubbles: true }));
          document.querySelectorAll('.modal-overlay').forEach(el => el.remove());
        """)
        saved_draft = await cdp.eval("!!localStorage.getItem('snippet_editor_draft_new_v1')")
        assert saved_draft, 'draft should be saved in localStorage'
        await cdp.eval("document.querySelector('#panel-shortcuts button[title=\"Add shortcut\"]').click()")
        await wait_until(
            cdp,
            "[...document.querySelectorAll('.modal h3')].some(x => x.textContent.includes('Unsaved snippet draft'))",
            timeout=3,
        )
        await cdp.eval("""
          var overlayTop = [...document.querySelectorAll('.modal-overlay')].at(-1);
          [...overlayTop.querySelectorAll('.modal-actions button')]
            .find(btn => btn.textContent.trim() === 'Restore')
            .click();
        """)
        await wait_until(
            cdp,
            "document.querySelector('.modal-overlay textarea[placeholder^=\"Value\"]')?.value === 'restored draft body'",
            timeout=3,
        )
        restored_name = await cdp.eval("document.querySelector('.modal-overlay input[placeholder=\"Name\"]')?.value")
        assert restored_name == 'Restored draft snippet', f'restored name: {restored_name!r}'
        await cdp.eval("""
          document.querySelectorAll('.modal-overlay').forEach(el => el.remove());
        """)
        await clear_snippet_drafts()
    await check('T20b Snippets new editor draft restore', t20b_snippets_new_editor_draft_restore)

    # ── T21: Toolbar code button inserts fenced block ────────
    async def t21_snippets_toolbar_code_block_insert():
        await clear_snippet_drafts()
        await cdp.eval("""
          document.querySelectorAll('.modal-overlay').forEach(el => el.remove());
        """)
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
        await cdp.eval("""
          document.querySelectorAll('.modal-overlay').forEach(el => el.remove());
        """)
        await clear_snippet_drafts()
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

    # ── T21b2: Snippets HTML upload renders sandbox card ─────
    async def t21b2_snippets_html_upload_modal_and_card():
        await close_modals()
        await open_shortcuts_tab()
        await cdp.eval("document.querySelector('#panel-shortcuts button[title=\"Add shortcut\"]').click()")
        await wait_until(cdp, "!!document.querySelector('.modal-overlay textarea[placeholder^=\"Value\"]')", timeout=3)
        await wait_until(
            cdp,
            "[...document.querySelectorAll('.modal-overlay .md-toolbar button')].some(b => b.title === 'Insert HTML from file')",
            timeout=3,
        )
        await cdp.eval(
            "[...document.querySelectorAll('.modal-overlay .md-toolbar button')]"
            ".find(b => b.title === 'Insert HTML from file').click()"
        )
        await wait_until(cdp, "!!document.querySelector('.html-upload-overlay')", timeout=3)
        await cdp.eval("document.querySelector('.html-upload-overlay .image-upload-picker button').click()")
        await wait_until(cdp, "!!document.querySelector('.html-upload-overlay iframe')", timeout=3)
        await wait_until(cdp, "!document.querySelector('.html-upload-overlay .image-upload-footer button').disabled", timeout=3)
        await cdp.eval("document.querySelector('.html-upload-overlay .image-upload-footer button').click()")
        value = await wait_until(
            cdp,
            "document.querySelector('.modal-overlay textarea[placeholder^=\"Value\"]')?.value.includes('![html:mock-presentation]') && document.querySelector('.modal-overlay textarea[placeholder^=\"Value\"]').value",
            timeout=3,
        )
        assert '/snippets-api/v1/media/html/' in value
        await cdp.eval("""(() => {
          const editor = [...document.querySelectorAll('.modal-overlay')]
            .find(x => !x.classList.contains('html-upload-overlay') && x.querySelector('input[placeholder="Name"]'));
          if (!editor) throw new Error('missing snippet editor modal');
          const name = editor.querySelector('input[placeholder="Name"]');
          name.value = 'HTML markdown';
          name.dispatchEvent(new Event('input', { bubbles: true }));
          const confirm = [...editor.querySelectorAll('.modal-actions button')]
            .find(x => x.textContent.trim() === 'Confirm');
          if (!confirm) throw new Error('missing editor confirm button');
          confirm.click();
        })()""")
        await wait_until(
            cdp,
            "[...document.querySelectorAll('#panel-shortcuts .shortcut-list-item .shortcut-list-name')].some(x => x.textContent.trim() === 'HTML markdown')",
            timeout=3,
        )
        await cdp.eval(
            "[...document.querySelectorAll('#panel-shortcuts .shortcut-list-item .shortcut-list-name')]"
            ".find(x => x.textContent.trim() === 'HTML markdown').click()"
        )
        await wait_until(cdp, "!!document.querySelector('.markdown-html-card iframe')", timeout=3)
        sandbox = await cdp.eval("document.querySelector('.markdown-html-card iframe')?.getAttribute('sandbox')")
        assert sandbox == 'allow-scripts', sandbox
    await check('T21b2 Snippets HTML upload modal and sandbox card', t21b2_snippets_html_upload_modal_and_card)

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
        await clear_snippet_drafts()
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
        await clear_snippet_drafts()
        await close_modals()
    await check('T21d Snippets clipboard image upload modal', t21d_snippets_image_upload_from_clipboard)

    # ── T21e: Image preview failures show copyable diagnostics ─
    async def t21e_snippets_image_preview_error_dialog():
        await clear_snippet_drafts()
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
        await clear_snippet_drafts()
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

    # ── T21f2: Figure Card viewer supports Ctrl-wheel zoom + pan ─
    async def t21f2_markdown_figure_viewer_zoom_pan():
        await close_modals()
        await cdp.eval("""(async () => {
          document.querySelector('#viewer-test-host')?.remove();
          const host = document.createElement('div');
          host.id = 'viewer-test-host';
          host.className = 'markdown-body';
          const img = document.createElement('img');
          img.alt = 'zoom-pan-test';
          img.src = 'data:image/svg+xml,' + encodeURIComponent(
            '<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="1200">' +
            '<rect width="2000" height="1200" fill="#123456"/>' +
            '<rect x="240" y="220" width="1520" height="760" fill="#d7ebff"/>' +
            '</svg>'
          );
          const p = document.createElement('p');
          p.appendChild(img);
          host.appendChild(p);
          document.body.appendChild(host);
          const mod = await import('./components/markdown-figures.js');
          mod.enhanceMarkdownFigures(host);
          host.querySelector('.markdown-figure-card img').click();
        })()""")
        await wait_until(
            cdp,
            "document.querySelector('.markdown-image-viewer-body img')?.naturalWidth > 0",
            timeout=3,
        )
        before = await cdp.eval("""(() => {
          const transform = document.querySelector('.markdown-image-viewer-body img').style.transform;
          return Number((transform.match(/scale\\(([^)]+)\\)/) || [])[1] || 0);
        })()""")
        after = await cdp.eval("""(() => {
          const body = document.querySelector('.markdown-image-viewer-body');
          const img = body.querySelector('img');
          const rect = body.getBoundingClientRect();
          body.dispatchEvent(new WheelEvent('wheel', {
            bubbles: true,
            cancelable: true,
            ctrlKey: true,
            deltaY: -900,
            clientX: rect.left + rect.width / 2,
            clientY: rect.top + rect.height / 2,
          }));
          const transform = img.style.transform;
          return Number((transform.match(/scale\\(([^)]+)\\)/) || [])[1] || 0);
        })()""")
        assert after > before, f'scale did not increase: before={before}, after={after}'
        pan_x = await cdp.eval("""(() => {
          const body = document.querySelector('.markdown-image-viewer-body');
          const img = body.querySelector('img');
          const rect = body.getBoundingClientRect();
          const startX = rect.left + rect.width / 2;
          const startY = rect.top + rect.height / 2;
          body.dispatchEvent(new PointerEvent('pointerdown', {
            bubbles: true,
            cancelable: true,
            button: 0,
            buttons: 1,
            pointerId: 101,
            clientX: startX,
            clientY: startY,
          }));
          body.dispatchEvent(new PointerEvent('pointermove', {
            bubbles: true,
            cancelable: true,
            button: 0,
            buttons: 1,
            pointerId: 101,
            clientX: startX + 48,
            clientY: startY + 16,
          }));
          body.dispatchEvent(new PointerEvent('pointerup', {
            bubbles: true,
            cancelable: true,
            button: 0,
            pointerId: 101,
            clientX: startX + 48,
            clientY: startY + 16,
          }));
          const transform = img.style.transform;
          return Number((transform.match(/translate\\(calc\\(-50% \\+ ([^p]+)px\\)/) || [])[1] || 0);
        })()""")
        assert pan_x > 10, f'pan offset did not change: {pan_x}'
        await cdp.eval(
            "[...document.querySelectorAll('.markdown-image-viewer-actions button')]"
            ".find(b => b.textContent.trim() === 'Close').click();"
            "document.querySelector('#viewer-test-host')?.remove();"
        )
    await check('T21f2 Markdown figure viewer supports zoom and pan', t21f2_markdown_figure_viewer_zoom_pan)

    # ── T21g: Image preview shows variant title + arrows ─────
    async def t21g_image_preview_variant_navigation():
        await clear_snippet_drafts()
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
        await wait_until(cdp, "!!document.querySelector('#panel-shortcuts .snippet-tag-chip.active')", timeout=3)

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
        active_tag = await cdp.eval("!!document.querySelector('#panel-shortcuts .snippet-tag-chip.active')")
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

    # ── T26b: Snippets Related navigation history ───────────
    async def t26b_snippets_related_history_navigation():
        await open_shortcuts_tab()
        await cdp.eval(
            "[...document.querySelectorAll('#panel-shortcuts .shortcut-list-name')]"
            ".find(x => x.textContent.trim() === 'bash_cd_guide').click()"
        )
        await wait_until(cdp, "document.querySelector('#panel-shortcuts h3')?.textContent.trim() === 'bash_cd_guide'", timeout=3)
        await wait_until(cdp, "!![...document.querySelectorAll('.snippet-detail-tab')].find(x => x.textContent.trim() === 'Related')", timeout=3)
        await cdp.eval(
            "[...document.querySelectorAll('.snippet-detail-tab')]"
            ".find(x => x.textContent.trim() === 'Related').click()"
        )
        await wait_until(cdp, "document.querySelectorAll('.snippet-related-row').length > 0", timeout=3)
        first_related = await cdp.eval("document.querySelector('.snippet-related-row .snippet-related-name')?.textContent.trim()")
        await cdp.eval("document.querySelector('.snippet-related-row').click()")
        await wait_until(
            cdp,
            f"document.querySelector('#panel-shortcuts h3')?.textContent.trim() === {json.dumps(first_related)}",
            timeout=3,
        )
        await wait_until(cdp, "!!document.querySelector('#panel-shortcuts .snippet-history-back:not(:disabled)')", timeout=3)
        await cdp.eval("document.querySelector('#panel-shortcuts .snippet-history-back').click()")
        await wait_until(cdp, "document.querySelector('#panel-shortcuts h3')?.textContent.trim() === 'bash_cd_guide'", timeout=3)
        await wait_until(cdp, "!!document.querySelector('#panel-shortcuts .snippet-history-forward:not(:disabled)')", timeout=3)
        await cdp.eval("document.querySelector('#panel-shortcuts .snippet-history-button').click()")
        await wait_until(cdp, "document.querySelectorAll('.snippet-history-popover-item').length >= 2", timeout=3)
        count = await cdp.eval("document.querySelectorAll('.snippet-history-popover-item').length")
        assert count <= 10, f'history popover should be capped at 10, got {count}'
    await check('T26b Snippets related history navigation', t26b_snippets_related_history_navigation)

    # ── T26c: Snippets search scope and token matching ──────
    async def t26c_snippets_search_scope_and_tokens():
        await cdp.eval("""(() => {
          const settings = JSON.parse(localStorage.getItem('mock.settings') || '{}');
          settings.snippets_search_scope = 'name';
          localStorage.setItem('mock.settings', JSON.stringify(settings));
        })()""")
        await cdp.eval("""
          window.__TAURI__.core.invoke('create_shortcut', {
            name: 'route_plain_name',
            value: 'plain value',
            description: '',
            links: '[]',
            obsidian_note: ''
          })
        """)
        await cdp.eval("""
          window.__TAURI__.core.invoke('create_shortcut', {
            name: 'routes without underscore',
            value: 'value mentions route_ literal',
            description: '',
            links: '[]',
            obsidian_note: ''
          })
        """)
        await cdp.eval("""
          window.__TAURI__.core.invoke('create_shortcut', {
            name: 'bash_obsidian_setup',
            value: 'setup notes',
            description: '',
            links: '[]',
            obsidian_note: ''
          })
        """)
        await cdp.eval("""
          window.__TAURI__.core.invoke('create_shortcut', {
            name: 'setup_bash_chrome_keenetic',
            value: 'network note',
            description: '',
            links: '[]',
            obsidian_note: ''
          })
        """)
        await cdp.send('Page.reload', ignoreCache=True)
        await asyncio.sleep(0.8)
        await wait_until(cdp, "!!window.__TAURI__ && !!window.__TAURI__.core", timeout=5)
        await open_shortcuts_tab()

        await cdp.eval("""(() => {
          const input = document.querySelector('#panel-shortcuts .search-bar input');
          input.value = 'route_';
          input.dispatchEvent(new Event('input', { bubbles: true }));
        })()""")
        await wait_until(cdp, "document.querySelector('#panel-shortcuts .shortcut-list-name')?.textContent.includes('route_plain_name')", timeout=3)
        names = await cdp.eval("[...document.querySelectorAll('#panel-shortcuts .shortcut-list-name')].map(x => x.textContent.trim())")
        assert 'route_plain_name' in names, names
        assert 'routes without underscore' not in names, names

        await wait_until(cdp, "!!document.querySelector('#panel-shortcuts .snippet-search-scope-button')", timeout=3)
        await cdp.eval("document.querySelector('#panel-shortcuts .snippet-search-scope-button').click()")
        await wait_until(cdp, "document.querySelector('#panel-shortcuts .snippet-search-scope-button')?.dataset.searchScope === 'full'", timeout=3)
        await wait_until(cdp, "[...document.querySelectorAll('#panel-shortcuts .shortcut-list-name')].some(x => x.textContent.trim() === 'routes without underscore')", timeout=3)

        await cdp.eval("""(() => {
          const input = document.querySelector('#panel-shortcuts .search-bar input');
          input.value = 'bash setup';
          input.dispatchEvent(new Event('input', { bubbles: true }));
        })()""")
        await wait_until(cdp, "[...document.querySelectorAll('#panel-shortcuts .shortcut-list-name')].some(x => x.textContent.trim() === 'bash_obsidian_setup')", timeout=3)
        token_names = await cdp.eval("[...document.querySelectorAll('#panel-shortcuts .shortcut-list-name')].map(x => x.textContent.trim())")
        assert 'bash_obsidian_setup' in token_names, token_names
        assert 'setup_bash_chrome_keenetic' in token_names, token_names
    await check('T26c Snippets search scope and tokens', t26c_snippets_search_scope_and_tokens)

    # ── T26d: Snippets panel toggles and tag reorder ────────
    async def t26d_snippets_panel_toggles_and_tag_reorder():
        await cdp.eval("""(() => {
          const settings = JSON.parse(localStorage.getItem('mock.settings') || '{}');
          settings.snippets_show_tags_panel = '1';
          settings.snippets_show_pinned_panel = '0';
          localStorage.setItem('mock.settings', JSON.stringify(settings));
        })()""")
        await cdp.send('Page.reload', ignoreCache=True)
        await asyncio.sleep(0.8)
        await wait_until(cdp, "!!window.__TAURI__ && !!window.__TAURI__.core", timeout=5)
        await open_shortcuts_tab()

        await wait_until(cdp, "!!document.querySelector('#panel-shortcuts .snippet-tags-toggle')", timeout=3)
        assert await cdp.eval("!!document.querySelector('#panel-shortcuts .snippet-tags-panel')"), 'tags panel hidden by default'
        await cdp.eval("document.querySelector('#panel-shortcuts .snippet-pinned-toggle').click()")
        await wait_until(cdp, "!!document.querySelector('#panel-shortcuts .snippet-pinned-panel')", timeout=3)
        assert await cdp.eval("!!document.querySelector('#panel-shortcuts .snippet-tags-panel')"), 'tags should remain visible when pinned is shown'
        await cdp.eval("document.querySelector('#panel-shortcuts .snippet-tags-toggle').click()")
        await wait_until(cdp, "!document.querySelector('#panel-shortcuts .snippet-tags-panel') && !!document.querySelector('#panel-shortcuts .snippet-pinned-panel')", timeout=3)
        await cdp.eval("document.querySelector('#panel-shortcuts .snippet-pinned-toggle').click()")
        await wait_until(cdp, "!document.querySelector('#panel-shortcuts .snippet-tags-panel') && !document.querySelector('#panel-shortcuts .snippet-pinned-panel')", timeout=3)
        await cdp.eval("document.querySelector('#panel-shortcuts .snippet-pinned-toggle').click()")
        await wait_until(cdp, "!!document.querySelector('#panel-shortcuts .snippet-pinned-panel')", timeout=3)
        await cdp.eval("document.querySelector('#panel-shortcuts .snippet-tags-toggle').click()")
        await wait_until(cdp, "document.querySelectorAll('#panel-shortcuts .snippet-tag-chip').length >= 2", timeout=3)

        before = await cdp.eval("[...document.querySelectorAll('#panel-shortcuts .snippet-tag-chip')].map(x => Number(x.dataset.tagId))")
        first_id = before[0]
        await cdp.eval("""
          const chips = [...document.querySelectorAll('#panel-shortcuts .snippet-tag-chip')];
          const first = chips[0];
          const last = chips[chips.length - 1];
          const a = first.getBoundingClientRect();
          const b = last.getBoundingClientRect();
          first.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, button: 0, clientX: a.left + 5, clientY: a.top + 5, bubbles: true }));
          document.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, button: 0, clientX: b.right + 28, clientY: b.top + 5, bubbles: true }));
          document.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, button: 0, clientX: b.right + 28, clientY: b.top + 5, bubbles: true }));
        """)
        await wait_until(
            cdp,
            f"JSON.parse(localStorage.getItem('mock.snippet_tags') || '[]').find(t => t.id === {first_id})?.sort_order > 0",
            timeout=3,
        )
        after = await cdp.eval("[...document.querySelectorAll('#panel-shortcuts .snippet-tag-chip')].map(x => Number(x.dataset.tagId))")
        assert before != after, (before, after)
    await check('T26d Snippets panel toggles and tag reorder', t26d_snippets_panel_toggles_and_tag_reorder)

    # ── T26e: Ctrl+Tab recent view history ─────────────────
    async def t26e_ctrl_tab_recent_view_history():
        await cdp.send('Page.navigate', url=TEST_URL)
        await asyncio.sleep(0.8)
        await wait_until(cdp, "!!document.querySelector('.tab-btn')", timeout=8)
        await wait_until(cdp, "!!window.__TAURI__ && !!window.__TAURI__.core", timeout=5)
        await open_shortcuts_tab()
        await cdp.eval(
            "[...document.querySelectorAll('#panel-shortcuts .shortcut-list-name')]"
            ".find(x => x.textContent.trim() === 'bash_obsidian_setup').click()"
        )
        await wait_until(
            cdp,
            "document.querySelector('#panel-shortcuts h3')?.textContent.trim() === 'bash_obsidian_setup'",
            timeout=3,
        )

        await cdp.eval("document.querySelector('.tab-btn[data-tab-id=\"tasks\"]').click()")
        await wait_until(cdp, "document.body.innerText.includes('Regular mock task')", timeout=5)
        await cdp.eval(
            "[...document.querySelectorAll('#panel-tasks .task-title')]"
            ".find(x => x.textContent.trim() === 'Regular mock task').click()"
        )
        await wait_until(
            cdp,
            "document.querySelector('#panel-tasks .task-card.expanded .task-title')?.textContent.trim() === 'Regular mock task'",
            timeout=4,
        )

        await cdp.eval("""(() => {
          document.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'Tab', code: 'Tab', ctrlKey: true, bubbles: true, cancelable: true
          }));
          document.dispatchEvent(new KeyboardEvent('keyup', {
            key: 'Control', code: 'ControlLeft', bubbles: true, cancelable: true
          }));
        })()""")
        await wait_until(
            cdp,
            "document.querySelector('.tab-btn[data-tab-id=\"shortcuts\"]')?.classList.contains('active')",
            timeout=4,
        )
        await wait_until(
            cdp,
            "document.querySelector('#panel-shortcuts h3')?.textContent.trim() === 'bash_obsidian_setup'",
            timeout=4,
        )

        await cdp.eval("""(() => {
          document.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'Tab', code: 'Tab', ctrlKey: true, bubbles: true, cancelable: true
          }));
          document.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'Tab', code: 'Tab', ctrlKey: true, bubbles: true, cancelable: true
          }));
        })()""")
        await wait_until(cdp, "!!document.querySelector('.view-history-switcher')", timeout=4)
        switcher_text = await cdp.eval("document.querySelector('.view-history-switcher')?.textContent || ''")
        assert 'Regular mock task' in switcher_text, switcher_text
        assert 'bash_obsidian_setup' in switcher_text, switcher_text
        await cdp.eval("""(() => {
          document.dispatchEvent(new KeyboardEvent('keyup', {
            key: 'Control', code: 'ControlLeft', bubbles: true, cancelable: true
          }));
        })()""")
        await wait_until(cdp, "!document.querySelector('.view-history-switcher')", timeout=3)

        await wait_until(
            cdp,
            "document.querySelector('.tab-btn[data-tab-id=\"shortcuts\"]')?.classList.contains('active')",
            timeout=3,
        )
        await cdp.eval("""(() => {
          const modal = document.createElement('div');
          modal.className = 'modal-overlay';
          document.body.appendChild(modal);
          document.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'Tab', code: 'Tab', ctrlKey: true, bubbles: true, cancelable: true
          }));
        })()""")
        await asyncio.sleep(0.2)
        still_shortcuts = await cdp.eval(
            "document.querySelector('.tab-btn[data-tab-id=\"shortcuts\"]')?.classList.contains('active')"
        )
        assert still_shortcuts is True, 'Ctrl+Tab switched while modal overlay was open'
        assert await cdp.eval("!document.querySelector('.view-history-switcher')"), 'switcher opened over modal'
        await cdp.eval("document.querySelector('.modal-overlay')?.remove()")
    await check('T26e Ctrl+Tab recent view history', t26e_ctrl_tab_recent_view_history)

    # ── T26f: Ctrl+Tab tracks task changes in Focus view ─────
    async def t26f_ctrl_tab_tracks_tasks_focus_view():
        await cdp.send('Page.navigate', url=TEST_URL)
        await asyncio.sleep(0.8)
        await wait_until(cdp, "!!document.querySelector('.tab-btn')", timeout=8)
        await wait_until(cdp, "!!window.__TAURI__ && !!window.__TAURI__.core", timeout=5)

        await open_shortcuts_tab()
        await cdp.eval(
            "[...document.querySelectorAll('#panel-shortcuts .shortcut-list-name')]"
            ".find(x => x.textContent.trim() === 'bash_obsidian_setup').click()"
        )
        await wait_until(
            cdp,
            "document.querySelector('#panel-shortcuts h3')?.textContent.trim() === 'bash_obsidian_setup'",
            timeout=3,
        )

        await cdp.eval("document.querySelector('.tab-btn[data-tab-id=\"tasks\"]').click()")
        await wait_until(cdp, "document.body.innerText.includes('Regular mock task')", timeout=5)
        await cdp.eval("document.querySelector('#tasks-layout-focus').click()")
        await wait_until(cdp, "!!document.querySelector('#panel-tasks .tasks-focus-row')", timeout=4)

        await cdp.eval(
            "[...document.querySelectorAll('#panel-tasks .tasks-focus-row')]"
            ".find(x => x.textContent.includes('Pinned mock task')).click()"
        )
        await wait_until(
            cdp,
            "document.querySelector('#panel-tasks .tasks-focus-row.active .tasks-focus-row-title')?.textContent.trim() === 'Pinned mock task'",
            timeout=4,
        )

        await cdp.eval(
            "[...document.querySelectorAll('#panel-tasks .tasks-focus-row')]"
            ".find(x => x.textContent.includes('Regular mock task')).click()"
        )
        await wait_until(
            cdp,
            "document.querySelector('#panel-tasks .tasks-focus-row.active .tasks-focus-row-title')?.textContent.trim() === 'Regular mock task'",
            timeout=4,
        )

        await cdp.eval("""(() => {
          document.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'Tab', code: 'Tab', ctrlKey: true, bubbles: true, cancelable: true
          }));
          document.dispatchEvent(new KeyboardEvent('keyup', {
            key: 'Control', code: 'ControlLeft', bubbles: true, cancelable: true
          }));
        })()""")
        await wait_until(
            cdp,
            "document.querySelector('.tab-btn[data-tab-id=\"tasks\"]')?.classList.contains('active')",
            timeout=4,
        )
        await wait_until(
            cdp,
            "document.querySelector('#panel-tasks .tasks-focus-row.active .tasks-focus-row-title')?.textContent.trim() === 'Pinned mock task'",
            timeout=4,
        )
    await check('T26f Ctrl+Tab tracks tasks Focus view', t26f_ctrl_tab_tracks_tasks_focus_view)

    # ── T26g: Finance level bands and display settings ──────
    async def t26g_finance_level_bands_and_settings():
        async def seed_finance(items, reset_settings=True):
            await cdp.eval(f"""(() => {{
              localStorage.setItem('mock.finance_items', JSON.stringify({json.dumps(items)}));
              if ({json.dumps(reset_settings)}) {{
                const settings = JSON.parse(localStorage.getItem('mock.settings') || '{{}}');
                delete settings['finance.level_band_strong_color'];
                delete settings['finance.level_band_medium_color'];
                delete settings['finance.level_band_soft_color'];
                delete settings['finance.level_band_fill_order'];
                localStorage.setItem('mock.settings', JSON.stringify(settings));
              }}
            }})()""")

        async def reload_finance():
            await cdp.send('Page.navigate', url=TEST_URL)
            await asyncio.sleep(0.8)
            await wait_until(cdp, "!!document.querySelector('.tab-btn')", timeout=8)
            await wait_until(cdp, "!!window.__TAURI__ && !!window.__TAURI__.core", timeout=5)
            await cdp.eval("document.querySelector('.tab-btn[data-tab-id=\"finance\"]').click()")
            await wait_until(cdp, "!!document.querySelector('#panel-finance .finance-row')", timeout=5)

        three_levels = [
            {'id': 1, 'uuid': 'f1', 'plan_id': 1, 'parent_id': None, 'name': 'Housing', 'amount_cents': 0, 'due_day': None, 'due_date': None, 'note': '', 'sort_order': 0, 'created_at': '2026-01-01T00:00:00Z', 'updated_at': '2026-01-01T00:00:00Z', 'sync_status': 'pending', 'user_id': 'mock-user'},
            {'id': 2, 'uuid': 'f2', 'plan_id': 1, 'parent_id': 1, 'name': 'Utilities', 'amount_cents': 0, 'due_day': None, 'due_date': None, 'note': '', 'sort_order': 0, 'created_at': '2026-01-01T00:00:00Z', 'updated_at': '2026-01-01T00:00:00Z', 'sync_status': 'pending', 'user_id': 'mock-user'},
            {'id': 3, 'uuid': 'f3', 'plan_id': 1, 'parent_id': 2, 'name': 'Internet', 'amount_cents': 830000, 'due_day': 15, 'due_date': None, 'note': '', 'sort_order': 0, 'created_at': '2026-01-01T00:00:00Z', 'updated_at': '2026-01-01T00:00:00Z', 'sync_status': 'pending', 'user_id': 'mock-user'},
            {'id': 4, 'uuid': 'f4', 'plan_id': 1, 'parent_id': 1, 'name': 'Rent', 'amount_cents': 8200000, 'due_day': 3, 'due_date': None, 'note': '', 'sort_order': 1, 'created_at': '2026-01-01T00:00:00Z', 'updated_at': '2026-01-01T00:00:00Z', 'sync_status': 'pending', 'user_id': 'mock-user'},
        ]
        await seed_finance(three_levels)
        await reload_finance()

        header_text = await cdp.eval("document.querySelector('#panel-finance .finance-main-header')?.textContent || ''")
        assert '+ Group' not in header_text, header_text
        assert '+ Row' in header_text, header_text
        save_button_count = await cdp.eval("""(() => [...document.querySelectorAll('#panel-finance .finance-main-header button')]
          .filter(btn => btn.textContent.trim() === 'Save').length)()""")
        assert save_button_count == 0, save_button_count
        compact_metrics = await cdp.eval("""(() => {
          const row = document.querySelector('#panel-finance .finance-row');
          const input = row?.querySelector('[data-field="name"]');
          const status = document.querySelector('#panel-finance [data-finance-autosave-status]');
          return {
            rowHeight: parseFloat(getComputedStyle(row).minHeight),
            inputHeight: parseFloat(getComputedStyle(input).height),
            statusText: status?.textContent.trim() || '',
          };
        })()""")
        assert compact_metrics['rowHeight'] <= 32, compact_metrics
        assert compact_metrics['inputHeight'] <= 24, compact_metrics
        assert compact_metrics['statusText'] == 'Saved', compact_metrics

        await cdp.eval("""(() => {
          const input = document.querySelector('#panel-finance [data-plan-field="name"]');
          input.value = 'Autosaved expenses';
          input.dispatchEvent(new Event('input', { bubbles: true }));
        })()""")
        await wait_until(
            cdp,
            "JSON.parse(localStorage.getItem('mock.finance_plans') || '[]').some(p => p.id === 1 && p.name === 'Autosaved expenses')",
            timeout=4,
        )
        await wait_until(
            cdp,
            "document.querySelector('#panel-finance [data-finance-autosave-status]')?.textContent.trim() === 'Saved'",
            timeout=4,
        )

        classes = await cdp.eval("""(() => Object.fromEntries(
          [...document.querySelectorAll('#panel-finance .finance-row')].map(row => [row.dataset.id, row.className])
        ))()""")
        assert 'finance-band-slot-0' in classes['1'], classes
        assert 'finance-band-slot-1' in classes['2'], classes
        assert 'finance-band-slot-1' in classes['4'], classes
        assert 'finance-group-row' in classes['2'], classes
        assert 'finance-group-row' not in classes['4'], classes
        assert 'finance-band-slot-' not in classes['3'], classes
        band_style = await cdp.eval("""(() => {
          const row = document.querySelector('#panel-finance .finance-row[data-id="1"]');
          const style = getComputedStyle(row);
          return {
            backgroundImage: style.backgroundImage,
            borderBottomColor: style.borderBottomColor,
          };
        })()""")
        assert band_style['backgroundImage'] and band_style['backgroundImage'] != 'none', band_style

        await cdp.eval("""(() => {
          document.querySelector('#panel-finance .finance-row[data-id="1"] .finance-toggle')?.click();
        })()""")
        await wait_until(
            cdp,
            "document.querySelectorAll('#panel-finance .finance-row').length === 1",
            timeout=3,
        )
        collapsed_root_class = await cdp.eval(
            "document.querySelector('#panel-finance .finance-row[data-id=\"1\"]')?.className || ''"
        )
        assert 'finance-band-slot-0' in collapsed_root_class, collapsed_root_class
        await cdp.eval("""(() => {
          document.querySelector('#panel-finance .finance-row[data-id="1"] .finance-toggle')?.click();
        })()""")
        await wait_until(
            cdp,
            "document.querySelectorAll('#panel-finance .finance-row').length === 4",
            timeout=3,
        )

        await cdp.eval("""(() => {
          [...document.querySelectorAll('#panel-finance .finance-header-actions button')]
            .find(btn => btn.title === 'Finance display settings').click();
        })()""")
        await wait_until(cdp, "!!document.querySelector('.modal-overlay .finance-settings-body')", timeout=3)
        await cdp.eval("""(() => {
          const strong = document.querySelector('[data-finance-setting="strong-color"]');
          const medium = document.querySelector('[data-finance-setting="medium-color"]');
          const soft = document.querySelector('[data-finance-setting="soft-color"]');
          const order = document.querySelector('[data-finance-setting="fill-order"]');
          strong.value = '#123456';
          medium.value = '#234567';
          soft.value = '#345678';
          order.value = 'soft_first';
          strong.dispatchEvent(new Event('input', { bubbles: true }));
          medium.dispatchEvent(new Event('input', { bubbles: true }));
          soft.dispatchEvent(new Event('input', { bubbles: true }));
          order.dispatchEvent(new Event('change', { bubbles: true }));
        })()""")
        await wait_until(
            cdp,
            "document.querySelector('#panel-finance .finance-row[data-id=\"1\"]')?.classList.contains('finance-band-slot-1')",
            timeout=3,
        )
        soft_first_styles = await cdp.eval("""(() => {
          const root = document.querySelector('#panel-finance .finance-row[data-id="1"]');
          const child = document.querySelector('#panel-finance .finance-row[data-id="2"]');
          const rootStyle = getComputedStyle(root);
          const childStyle = getComputedStyle(child);
          return {
            rootClass: root.className,
            childClass: child.className,
            rootBackground: rootStyle.backgroundImage,
            childBackground: childStyle.backgroundImage,
            mediumVar: rootStyle.getPropertyValue('--finance-band-medium-bg').trim(),
            softVar: childStyle.getPropertyValue('--finance-band-soft-bg').trim(),
          };
        })()""")
        assert 'finance-band-slot-1' in soft_first_styles['rootClass'], soft_first_styles
        assert 'finance-band-slot-2' in soft_first_styles['childClass'], soft_first_styles
        assert soft_first_styles['rootBackground'] and soft_first_styles['rootBackground'] != 'none', soft_first_styles
        assert soft_first_styles['mediumVar'].startswith('hsl('), soft_first_styles
        assert soft_first_styles['softVar'].startswith('hsl('), soft_first_styles
        row_input_style = await cdp.eval("""(() => {
          const input = document.querySelector('#panel-finance .finance-row[data-id="1"] [data-field="name"]');
          const style = getComputedStyle(input);
          return {
            backgroundColor: style.backgroundColor,
            borderTopColor: style.borderTopColor,
          };
        })()""")
        assert row_input_style['backgroundColor'] in ('rgba(0, 0, 0, 0)', 'transparent'), row_input_style
        await cdp.eval("document.querySelector('.modal-actions button:last-child').click()")
        await wait_until(cdp, "!document.querySelector('.modal-overlay')", timeout=3)
        saved_order = await cdp.eval(
            "JSON.parse(localStorage.getItem('mock.settings') || '{}')['finance.level_band_fill_order']"
        )
        assert saved_order == 'soft_first', saved_order

        await cdp.eval("""(() => {
          [...document.querySelectorAll('#panel-finance .finance-header-actions button')]
            .find(btn => btn.title === 'Finance display settings').click();
        })()""")
        await wait_until(cdp, "!!document.querySelector('.modal-overlay .finance-settings-body')", timeout=3)
        await cdp.eval("""(() => {
          const order = document.querySelector('[data-finance-setting="fill-order"]');
          order.value = 'strong_first';
          order.dispatchEvent(new Event('change', { bubbles: true }));
        })()""")
        await wait_until(
            cdp,
            "document.querySelector('#panel-finance .finance-row[data-id=\"1\"]')?.classList.contains('finance-band-slot-0')",
            timeout=3,
        )
        pink_strong_var = await cdp.eval("""(() => {
          const root = document.querySelector('#panel-finance .finance-row[data-id="1"]');
          const strong = document.querySelector('[data-finance-setting="strong-color"]');
          strong.value = '#ff66cc';
          strong.dispatchEvent(new Event('input', { bubbles: true }));
          return getComputedStyle(root).getPropertyValue('--finance-band-strong-bg').trim();
        })()""")
        assert pink_strong_var == 'hsl(320 88% 24%)', pink_strong_var
        await cdp.eval("document.querySelector('.modal-actions button:first-child').click()")
        await wait_until(cdp, "!document.querySelector('.modal-overlay')", timeout=3)
        restored = await wait_until(
            cdp,
            "document.querySelector('#panel-finance .finance-row[data-id=\"1\"]')?.classList.contains('finance-band-slot-1')",
            timeout=3,
        )
        assert restored is True

        two_levels = [
            {**three_levels[0], 'parent_id': None},
            {**three_levels[3], 'parent_id': 1},
        ]
        await seed_finance(two_levels, reset_settings=False)
        await reload_finance()
        two_level_classes = await cdp.eval("""(() => Object.fromEntries(
          [...document.querySelectorAll('#panel-finance .finance-row')].map(row => [row.dataset.id, row.className])
        ))()""")
        assert 'finance-band-slot-2' in two_level_classes['1'], two_level_classes
        assert 'finance-band-slot-' not in two_level_classes['4'], two_level_classes

        four_levels = [
            *three_levels,
            {'id': 5, 'uuid': 'f5', 'plan_id': 1, 'parent_id': 3, 'name': 'Provider', 'amount_cents': 120000, 'due_day': 20, 'due_date': None, 'note': '', 'sort_order': 0, 'created_at': '2026-01-01T00:00:00Z', 'updated_at': '2026-01-01T00:00:00Z', 'sync_status': 'pending', 'user_id': 'mock-user'},
        ]
        await seed_finance(four_levels, reset_settings=False)
        await reload_finance()
        four_level_classes = await cdp.eval("""(() => Object.fromEntries(
          [...document.querySelectorAll('#panel-finance .finance-row')].map(row => [row.dataset.id, row.className])
        ))()""")
        assert 'finance-band-slot-0' in four_level_classes['1'], four_level_classes
        assert 'finance-band-slot-1' in four_level_classes['2'], four_level_classes
        assert 'finance-band-slot-2' in four_level_classes['3'], four_level_classes
        assert 'finance-band-slot-' not in four_level_classes['5'], four_level_classes

        one_level = [
            {**three_levels[0], 'parent_id': None},
            {**three_levels[3], 'parent_id': None},
        ]
        await seed_finance(one_level, reset_settings=False)
        await reload_finance()
        one_level_classes = await cdp.eval("""(() => [...document.querySelectorAll('#panel-finance .finance-row')]
          .map(row => row.className).join('\\n'))()""")
        assert 'finance-band-slot-' not in one_level_classes, one_level_classes

    await check('T26g Finance level bands and settings', t26g_finance_level_bands_and_settings)

    # ── T26h: Finance row editing preserves viewport/focus ──
    async def t26h_finance_row_editing_scroll_and_placeholder():
        async def seed_finance(items):
            await cdp.eval(f"""(() => {{
              localStorage.setItem('mock.finance_plans', JSON.stringify([{{
                id: 1,
                uuid: 'fp1',
                name: 'Large edit test',
                currency: 'RUB',
                kind: 'monthly',
                sort_order: 0,
                created_at: '2026-01-01T00:00:00Z',
                updated_at: '2026-01-01T00:00:00Z',
                sync_status: 'pending',
                user_id: 'mock-user',
              }}]));
              localStorage.setItem('__seq.finance_plans', '1');
              localStorage.setItem('mock.finance_items', JSON.stringify({json.dumps(items)}));
              localStorage.setItem('__seq.finance_items', String({max([item["id"] for item in items], default=0)}));
            }})()""")

        async def reload_finance():
            await cdp.send('Page.navigate', url=TEST_URL)
            await asyncio.sleep(0.8)
            await wait_until(cdp, "!!document.querySelector('.tab-btn')", timeout=8)
            await wait_until(cdp, "!!window.__TAURI__ && !!window.__TAURI__.core", timeout=5)
            await cdp.eval("document.querySelector('.tab-btn[data-tab-id=\"finance\"]').click()")
            await wait_until(cdp, "!!document.querySelector('#panel-finance .finance-row')", timeout=5)

        long_items = [
            {
                'id': i,
                'uuid': f'fi{i}',
                'plan_id': 1,
                'parent_id': None,
                'name': f'Row {i:02d}',
                'amount_cents': i * 100,
                'due_day': None,
                'due_date': None,
                'note': '',
                'sort_order': i,
                'created_at': '2026-01-01T00:00:00Z',
                'updated_at': '2026-01-01T00:00:00Z',
                'sync_status': 'pending',
                'user_id': 'mock-user',
            }
            for i in range(1, 65)
        ]
        await seed_finance(long_items)
        await reload_finance()
        before_scroll = await cdp.eval("""(() => {
          const wrap = document.querySelector('#panel-finance .finance-table-wrap');
          const row = document.querySelector('#panel-finance .finance-row[data-id="64"]');
          const amount = row.querySelector('[data-field="amount"]');
          wrap.scrollTop = wrap.scrollHeight;
          amount.focus();
          amount.value = '123,45';
          amount.setSelectionRange(amount.value.length, amount.value.length);
          return wrap.scrollTop;
        })()""")
        assert before_scroll > 80, before_scroll
        await cdp.eval("""(() => {
          const amount = document.querySelector('#panel-finance .finance-row[data-id="64"] [data-field="amount"]');
          amount.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'Enter',
            code: 'Enter',
            bubbles: true,
            cancelable: true,
          }));
        })()""")
        await wait_until(
            cdp,
            "JSON.parse(localStorage.getItem('mock.finance_items') || '[]').some(item => item.id === 64 && item.amount_cents === 12345)",
            timeout=4,
        )
        after_save = await wait_until(
            cdp,
            """(() => {
              const wrap = document.querySelector('#panel-finance .finance-table-wrap');
              const active = document.activeElement;
              return active?.closest?.('.finance-row')?.dataset.id === '64'
                && active?.dataset.field === 'amount'
                && wrap.scrollTop > 80
                && {
                  scrollTop: wrap.scrollTop,
                  field: active.dataset.field,
                  rowId: active.closest('.finance-row').dataset.id,
                  selectionStart: active.selectionStart,
                  selectionEnd: active.selectionEnd,
                };
            })()""",
            timeout=4,
        )
        assert after_save['scrollTop'] >= before_scroll - 4, after_save
        assert after_save['rowId'] == '64', after_save
        assert after_save['field'] == 'amount', after_save
        assert after_save['selectionStart'] == after_save['selectionEnd'], after_save

        base_items = [
            {**long_items[0], 'id': 1, 'uuid': 'base1', 'name': 'Parent', 'sort_order': 0},
            {**long_items[1], 'id': 2, 'uuid': 'base2', 'name': 'Next root', 'sort_order': 1},
        ]
        await seed_finance(base_items)
        await reload_finance()
        await cdp.eval("""(() => {
          const input = document.querySelector('#panel-finance .finance-row[data-id="1"] [data-field="name"]');
          input.focus();
          input.setSelectionRange(input.value.length, input.value.length);
          input.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'Enter',
            code: 'Enter',
            bubbles: true,
            cancelable: true,
          }));
        })()""")
        created_id = await wait_until(
            cdp,
            """(() => {
              const items = JSON.parse(localStorage.getItem('mock.finance_items') || '[]');
              const created = items.find(item => item.id > 2);
              return created && String(created.id);
            })()""",
            timeout=4,
        )
        await wait_until(
            cdp,
            f"document.activeElement?.closest?.('.finance-row')?.dataset.id === '{created_id}'",
            timeout=4,
        )
        await cdp.eval(f"""(() => {{
          const input = document.querySelector('#panel-finance .finance-row[data-id="{created_id}"] [data-field="name"]');
          input.value = '';
          input.dispatchEvent(new Event('input', {{ bubbles: true }}));
          input.dispatchEvent(new KeyboardEvent('keydown', {{
            key: 'Tab',
            code: 'Tab',
            bubbles: true,
            cancelable: true,
          }}));
        }})()""")
        await wait_until(
            cdp,
            f"""(() => {{
              const item = JSON.parse(localStorage.getItem('mock.finance_items') || '[]')
                .find(entry => String(entry.id) === '{created_id}');
              return item?.parent_id === 1 && item?.name === 'Untitled item';
            }})()""",
            timeout=4,
        )
        placeholder_focus = await wait_until(
            cdp,
            f"""(() => {{
              const active = document.activeElement;
              return active?.closest?.('.finance-row')?.dataset.id === '{created_id}'
                && active?.dataset.field === 'name'
                && active.value === 'Untitled item'
                && active.selectionStart === 0
                && active.selectionEnd === active.value.length
                && {{
                  value: active.value,
                  selectionStart: active.selectionStart,
                  selectionEnd: active.selectionEnd,
                }};
            }})()""",
            timeout=4,
        )
        assert placeholder_focus['value'] == 'Untitled item', placeholder_focus
        assert placeholder_focus['selectionStart'] == 0, placeholder_focus
        assert placeholder_focus['selectionEnd'] == len('Untitled item'), placeholder_focus

    await check('T26h Finance row editing preserves scroll and placeholder selection', t26h_finance_row_editing_scroll_and_placeholder)

    # ── T26i: Finance payment calendar ───────────────────────
    async def t26i_finance_payment_calendar():
        async def seed_finance_calendar():
            plans = [
                {
                    'id': 1,
                    'uuid': 'fp-calendar-1',
                    'name': 'Regular monthly',
                    'currency': 'RUB',
                    'kind': 'monthly',
                    'sort_order': 0,
                    'created_at': '2026-01-01T00:00:00Z',
                    'updated_at': '2026-01-01T00:00:00Z',
                    'sync_status': 'pending',
                    'user_id': 'mock-user',
                },
                {
                    'id': 2,
                    'uuid': 'fp-calendar-2',
                    'name': 'Project once',
                    'currency': 'RUB',
                    'kind': 'project',
                    'sort_order': 1,
                    'created_at': '2026-01-01T00:00:00Z',
                    'updated_at': '2026-01-01T00:00:00Z',
                    'sync_status': 'pending',
                    'user_id': 'mock-user',
                },
            ]
            items = [
                {
                    'id': 1,
                    'uuid': 'fi-calendar-1',
                    'plan_id': 1,
                    'parent_id': None,
                    'name': 'Housing',
                    'amount_cents': 0,
                    'due_day': None,
                    'due_date': None,
                    'note': '',
                    'sort_order': 0,
                    'created_at': '2026-01-01T00:00:00Z',
                    'updated_at': '2026-01-01T00:00:00Z',
                    'sync_status': 'pending',
                    'user_id': 'mock-user',
                },
                {
                    'id': 2,
                    'uuid': 'fi-calendar-2',
                    'plan_id': 1,
                    'parent_id': 1,
                    'name': 'Rent',
                    'amount_cents': 12000000,
                    'due_day': 21,
                    'due_date': None,
                    'note': '',
                    'sort_order': 0,
                    'created_at': '2026-01-01T00:00:00Z',
                    'updated_at': '2026-01-01T00:00:00Z',
                    'sync_status': 'pending',
                    'user_id': 'mock-user',
                },
                {
                    'id': 3,
                    'uuid': 'fi-calendar-3',
                    'plan_id': 2,
                    'parent_id': None,
                    'name': 'Project row',
                    'amount_cents': 500000,
                    'due_day': None,
                    'due_date': '2026-07-01',
                    'note': '',
                    'sort_order': 0,
                    'created_at': '2026-01-01T00:00:00Z',
                    'updated_at': '2026-01-01T00:00:00Z',
                    'sync_status': 'pending',
                    'user_id': 'mock-user',
                },
            ]
            await cdp.eval(f"""(() => {{
              localStorage.setItem('mock.finance_plans', JSON.stringify({json.dumps(plans)}));
              localStorage.setItem('mock.__seq.finance_plans', '2');
              localStorage.setItem('mock.finance_items', JSON.stringify({json.dumps(items)}));
              localStorage.setItem('mock.__seq.finance_items', '3');
              localStorage.setItem('mock.finance_payments', JSON.stringify([]));
              localStorage.setItem('mock.__seq.finance_payments', '0');
              Object.keys(localStorage)
                .filter(key => key.startsWith('finance.calendar.months.'))
                .forEach(key => localStorage.removeItem(key));
              localStorage.removeItem('finance.calendar.show_old_months');
            }})()""")

        async def reload_finance():
            await cdp.send('Page.navigate', url=TEST_URL)
            await asyncio.sleep(0.8)
            await wait_until(cdp, "!!document.querySelector('.tab-btn')", timeout=8)
            await wait_until(cdp, "!!window.__TAURI__ && !!window.__TAURI__.core", timeout=5)
            await cdp.eval("document.querySelector('.tab-btn[data-tab-id=\"finance\"]').click()")
            await wait_until(cdp, "!!document.querySelector('#panel-finance .finance-row')", timeout=5)

        await seed_finance_calendar()
        await reload_finance()

        view_buttons = await cdp.eval("""(() => [...document.querySelectorAll('#panel-finance .finance-view-bar .finance-segment-btn')]
          .map(btn => btn.textContent.trim()).join('|'))()""")
        assert view_buttons == 'Structure|Calendar', view_buttons

        await cdp.eval("""(() => [...document.querySelectorAll('#panel-finance .finance-view-bar .finance-segment-btn')]
          .find(btn => btn.textContent.trim() === 'Calendar').click())()""")
        await wait_until(cdp, "!!document.querySelector('#panel-finance .finance-calendar-row[data-id=\"2\"]')", timeout=4)

        initial_month_count = await cdp.eval(
            "document.querySelector('#panel-finance .finance-calendar-head')?.children.length || 0"
        )
        assert initial_month_count >= 3, initial_month_count
        first_headers = await cdp.eval("""(() => [...document.querySelectorAll('#panel-finance .finance-calendar-head > div')]
          .slice(0, 2)
          .map(cell => cell.textContent.trim())
          .join('|'))()""")
        assert first_headers == 'Expense|Date', first_headers
        rent_due_day = await cdp.eval(
            "document.querySelector('#panel-finance .finance-calendar-row[data-id=\"2\"] .finance-calendar-date')?.textContent.trim() || ''"
        )
        assert rent_due_day == '21', rent_due_day
        await cdp.eval("""(() => {
          const row = document.querySelector('#panel-finance .finance-calendar-row[data-id="2"]');
          const amount = row.querySelector('.finance-payment-amount');
          const checkbox = row.querySelector('input[type="checkbox"]');
          amount.value = '1000';
          checkbox.click();
        })()""")
        await wait_until(
            cdp,
            """(() => {
              const payments = JSON.parse(localStorage.getItem('mock.finance_payments') || '[]');
              return payments.some(payment => payment.item_id === 2 && payment.is_paid === true && payment.paid_amount_cents === 100000);
            })()""",
            timeout=4,
        )
        group_total = await wait_until(
            cdp,
            """(() => {
              const text = document.querySelector('#panel-finance .finance-calendar-row[data-id="1"] .finance-calendar-total')?.textContent || '';
              return text.replace(/\\s/g, '').includes('1000') && text;
            })()""",
            timeout=4,
        )
        assert '1000' in group_total.replace('\xa0', '').replace(' ', ''), group_total

        await cdp.eval("""(() => [...document.querySelectorAll('#panel-finance .finance-calendar-actions button')]
          .find(btn => btn.textContent.trim() === '+ Month').click())()""")
        await wait_until(
            cdp,
            f"(document.querySelector('#panel-finance .finance-calendar-head')?.children.length || 0) > {initial_month_count}",
            timeout=4,
        )

        await cdp.eval("document.querySelector('#panel-finance .finance-plan-card[data-id=\"2\"]').click()")
        await wait_until(
            cdp,
            "document.querySelector('#panel-finance .finance-plan-card[data-id=\"2\"]')?.classList.contains('active')",
            timeout=4,
        )
        project_buttons = await cdp.eval(
            "document.querySelectorAll('#panel-finance .finance-view-bar .finance-segment-btn').length"
        )
        assert project_buttons == 0, project_buttons

    await check('T26i Finance payment calendar', t26i_finance_payment_calendar)

    async def t26j_finance_facts_import_and_rules():
        async def seed_finance_facts():
            plans = [
                {
                    'id': 1,
                    'uuid': 'fp-facts-1',
                    'name': 'Regular monthly',
                    'currency': 'RUB',
                    'kind': 'monthly',
                    'sort_order': 0,
                    'created_at': '2026-01-01T00:00:00Z',
                    'updated_at': '2026-01-01T00:00:00Z',
                    'sync_status': 'pending',
                    'user_id': 'mock-user',
                },
                {
                    'id': 2,
                    'uuid': 'fp-facts-2',
                    'name': 'Project expenses',
                    'currency': 'RUB',
                    'kind': 'project',
                    'sort_order': 1,
                    'created_at': '2026-01-01T00:00:00Z',
                    'updated_at': '2026-01-01T00:00:00Z',
                    'sync_status': 'pending',
                    'user_id': 'mock-user',
                },
            ]
            items = [
                {
                    'id': 1,
                    'uuid': 'fi-facts-1',
                    'plan_id': 1,
                    'parent_id': None,
                    'name': 'Transport',
                    'amount_cents': 0,
                    'due_day': None,
                    'due_date': None,
                    'note': '',
                    'sort_order': 0,
                    'created_at': '2026-01-01T00:00:00Z',
                    'updated_at': '2026-01-01T00:00:00Z',
                    'sync_status': 'pending',
                    'user_id': 'mock-user',
                },
                {
                    'id': 2,
                    'uuid': 'fi-facts-2',
                    'plan_id': 1,
                    'parent_id': 1,
                    'name': 'Taxi',
                    'amount_cents': 125000,
                    'due_day': None,
                    'due_date': None,
                    'note': '',
                    'sort_order': 0,
                    'created_at': '2026-01-01T00:00:00Z',
                    'updated_at': '2026-01-01T00:00:00Z',
                    'sync_status': 'pending',
                    'user_id': 'mock-user',
                },
                {
                    'id': 3,
                    'uuid': 'fi-facts-3',
                    'plan_id': 1,
                    'parent_id': 1,
                    'name': 'Fuel',
                    'amount_cents': 0,
                    'due_day': None,
                    'due_date': None,
                    'note': '',
                    'sort_order': 1,
                    'created_at': '2026-01-01T00:00:00Z',
                    'updated_at': '2026-01-01T00:00:00Z',
                    'sync_status': 'pending',
                    'user_id': 'mock-user',
                },
            ]
            transactions = [
                {
                    'id': 1,
                    'uuid': 'ft-facts-1',
                    'source': 'tbank_csv',
                    'source_fingerprint': 'facts-taxi-1',
                    'import_batch_id': None,
                    'operation_at': '2026-04-30 17:38:55',
                    'payment_date': '2026-04-30',
                    'card_mask': '*7857',
                    'status': 'OK',
                    'amount_cents': -50600,
                    'currency': 'RUB',
                    'operation_amount_cents': -50600,
                    'operation_currency': 'RUB',
                    'payment_amount_cents': -50600,
                    'payment_currency': 'RUB',
                    'cashback_cents': 2500,
                    'bank_category': 'Такси',
                    'mcc': '3990',
                    'description': 'Яндекс Такси',
                    'bonuses_cents': 2500,
                    'invest_rounding_cents': 9400,
                    'rounded_amount_cents': -60000,
                    'raw_json': '{}',
                    'rules_locked': False,
                    'created_at': '2026-01-01T00:00:00Z',
                    'updated_at': '2026-01-01T00:00:00Z',
                    'sync_status': 'pending',
                    'user_id': 'mock-user',
                },
                {
                    'id': 2,
                    'uuid': 'ft-facts-2',
                    'source': 'tbank_csv',
                    'source_fingerprint': 'facts-coffee-1',
                    'import_batch_id': None,
                    'operation_at': '2025-12-15 09:10:11',
                    'payment_date': '2025-12-15',
                    'card_mask': '*7857',
                    'status': 'OK',
                    'amount_cents': -15000,
                    'currency': 'RUB',
                    'operation_amount_cents': -15000,
                    'operation_currency': 'RUB',
                    'payment_amount_cents': -15000,
                    'payment_currency': 'RUB',
                    'cashback_cents': 0,
                    'bank_category': 'Кафе',
                    'mcc': '5812',
                    'description': 'Coffee test',
                    'bonuses_cents': 0,
                    'invest_rounding_cents': 0,
                    'rounded_amount_cents': -15000,
                    'raw_json': '{}',
                    'rules_locked': False,
                    'created_at': '2026-01-01T00:00:00Z',
                    'updated_at': '2026-01-01T00:00:00Z',
                    'sync_status': 'pending',
                    'user_id': 'mock-user',
                },
            ]
            await cdp.eval(f"""(() => {{
              localStorage.setItem('mock.finance_plans', JSON.stringify({json.dumps(plans)}));
              localStorage.setItem('mock.__seq.finance_plans', '2');
              localStorage.setItem('mock.finance_items', JSON.stringify({json.dumps(items)}));
              localStorage.setItem('mock.__seq.finance_items', '3');
              localStorage.setItem('mock.finance_payments', JSON.stringify([]));
              localStorage.setItem('mock.__seq.finance_payments', '0');
              localStorage.setItem('mock.finance_transactions', JSON.stringify({json.dumps(transactions)}));
              localStorage.setItem('mock.__seq.finance_transactions', '2');
              localStorage.setItem('mock.finance_transaction_allocations', JSON.stringify([]));
              localStorage.setItem('mock.__seq.finance_transaction_allocations', '0');
              localStorage.setItem('mock.finance_mapping_rules', JSON.stringify([]));
              localStorage.setItem('mock.__seq.finance_mapping_rules', '0');
              localStorage.setItem('mock.finance_import_batches', JSON.stringify([]));
              localStorage.setItem('mock.__seq.finance_import_batches', '0');
            }})()""")

        async def reload_finance():
            await cdp.send('Page.navigate', url=TEST_URL)
            await asyncio.sleep(0.8)
            await wait_until(cdp, "!!document.querySelector('.tab-btn')", timeout=8)
            await wait_until(cdp, "!!window.__TAURI__ && !!window.__TAURI__.core", timeout=5)
            await cdp.eval("document.querySelector('.tab-btn[data-tab-id=\"finance\"]').click()")
            await wait_until(cdp, "!!document.querySelector('#panel-finance .finance-mode-bar')", timeout=5)

        await seed_finance_facts()
        await reload_finance()
        mode_buttons = await cdp.eval("""(() => [...document.querySelectorAll('#panel-finance .finance-mode-bar .finance-segment-btn')]
          .map(btn => btn.textContent.trim()).join('|'))()""")
        assert mode_buttons == 'Lists|Facts', mode_buttons

        await cdp.eval("""(() => [...document.querySelectorAll('#panel-finance .finance-mode-bar .finance-segment-btn')]
          .find(btn => btn.textContent.trim() === 'Facts').click())()""")
        await wait_until(cdp, "!!document.querySelector('#panel-finance .finance-facts-table')", timeout=4)
        has_filter_sidebar = await cdp.eval("!!document.querySelector('#panel-finance .finance-facts-sidebar')")
        assert has_filter_sidebar, 'Facts mode must replace plan sidebar with filter sidebar'
        has_plan_list = await cdp.eval("!!document.querySelector('#panel-finance .finance-plan-list')")
        assert not has_plan_list, 'Facts mode must not show finance plan list'
        first_fact = await cdp.eval(
            "document.querySelector('#panel-finance .finance-fact-row .finance-fact-description')?.textContent.trim() || ''"
        )
        assert first_fact == 'Яндекс Такси', first_fact

        await cdp.eval("""(() => {
          const select = document.querySelector('#panel-finance .finance-facts-sidebar select');
          select.value = 'year';
          select.dispatchEvent(new Event('change', { bubbles: true }));
        })()""")
        await wait_until(cdp, "!!document.querySelector('#panel-finance .finance-facts-sidebar input[type=\"number\"]')", timeout=3)
        await cdp.eval("""(() => {
          const input = document.querySelector('#panel-finance .finance-facts-sidebar input[type="number"]');
          input.value = '2025';
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
        })()""")
        await wait_until(cdp, "document.querySelectorAll('#panel-finance .finance-fact-row').length === 1", timeout=3)
        filtered_fact = await cdp.eval(
            "document.querySelector('#panel-finance .finance-fact-row .finance-fact-description')?.textContent.trim() || ''"
        )
        assert filtered_fact == 'Coffee test', filtered_fact
        await cdp.eval("document.querySelector('#panel-finance .finance-facts-sidebar button')?.click()")
        await wait_until(cdp, "document.querySelectorAll('#panel-finance .finance-fact-row').length === 2", timeout=3)

        await cdp.eval("""(() => {
          const select = document.querySelector('#panel-finance .finance-facts-sidebar select');
          select.value = 'month';
          select.dispatchEvent(new Event('change', { bubbles: true }));
        })()""")
        await wait_until(cdp, "!!document.querySelector('#panel-finance .finance-month-picker-field')", timeout=3)
        await cdp.eval("document.querySelector('#panel-finance .finance-month-picker-field')?.click()")
        await wait_until(cdp, "!!document.querySelector('#panel-finance .finance-month-popover')", timeout=3)
        month_picker_rect = await cdp.eval("""(() => {
          const sidebar = document.querySelector('#panel-finance .finance-facts-sidebar').getBoundingClientRect();
          const popover = document.querySelector('#panel-finance .finance-month-popover').getBoundingClientRect();
          return {
            sidebarRight: Math.round(sidebar.right),
            popoverRight: Math.round(popover.right),
            sidebarWidth: Math.round(sidebar.width),
            popoverWidth: Math.round(popover.width),
          };
        })()""")
        assert month_picker_rect['popoverRight'] <= month_picker_rect['sidebarRight'], month_picker_rect
        await cdp.eval("document.querySelector('#panel-finance .finance-month-option[data-month=\"2026-04\"]')?.click()")
        await wait_until(cdp, "document.querySelectorAll('#panel-finance .finance-fact-row').length === 1", timeout=3)
        month_fact = await cdp.eval(
            "document.querySelector('#panel-finance .finance-fact-row .finance-fact-description')?.textContent.trim() || ''"
        )
        assert month_fact == 'Яндекс Такси', month_fact
        await cdp.eval("document.querySelector('#panel-finance .finance-facts-sidebar button')?.click()")
        await wait_until(cdp, "document.querySelectorAll('#panel-finance .finance-fact-row').length === 2", timeout=3)

        await cdp.eval("""(() => {
          const row = [...document.querySelectorAll('#panel-finance .finance-fact-row')]
            .find(row => row.querySelector('.finance-fact-description')?.textContent.trim() === 'Яндекс Такси');
          row?.querySelector('.finance-fact-actions button')?.click();
        })()""")
        await wait_until(cdp, "!!document.querySelector('.modal-overlay .finance-tree-select')", timeout=4)
        fact_modal_style = await cdp.eval("""(() => {
          const modal = document.querySelector('.modal-overlay .modal.finance-facts-modal');
          if (!modal) return null;
          const style = getComputedStyle(modal);
          return {
            className: modal.className,
            boxShadow: style.boxShadow,
            borderColor: style.borderTopColor,
          };
        })()""")
        assert fact_modal_style and 'finance-facts-modal' in fact_modal_style['className'], fact_modal_style
        assert fact_modal_style['boxShadow'] != 'none', fact_modal_style
        assert fact_modal_style['borderColor'], fact_modal_style
        await cdp.eval("document.querySelector('.modal-overlay .finance-tree-select-trigger')?.click()")
        await wait_until(cdp, "!!document.querySelector('.modal-overlay .finance-tree-select-menu')", timeout=3)
        map_dropdown_layout = await cdp.eval("""(() => {
          const modal = document.querySelector('.modal-overlay .modal.finance-map-modal');
          const body = modal?.querySelector('.modal-body');
          const menu = modal?.querySelector('.finance-tree-select-menu');
          if (!modal || !body || !menu) return null;
          const bodyStyle = getComputedStyle(body);
          const modalStyle = getComputedStyle(modal);
          const menuRect = menu.getBoundingClientRect();
          return {
            modalOverflow: modalStyle.overflow,
            bodyOverflowY: bodyStyle.overflowY,
            menuHeight: Math.round(menuRect.height),
          };
        })()""")
        assert map_dropdown_layout['modalOverflow'] == 'visible', map_dropdown_layout
        assert map_dropdown_layout['bodyOverflowY'] == 'visible', map_dropdown_layout
        assert map_dropdown_layout['menuHeight'] >= 100, map_dropdown_layout
        tree_state = await cdp.eval("""(() => {
          const root = document.querySelector('.modal-overlay .finance-tree-select');
          const group = root.querySelector('.finance-tree-select-option[data-item-id="1"]');
          group.click();
          const valueAfterGroupClick = root.querySelector('.finance-tree-select-value')?.value || '';
          const terminal = root.querySelector('.finance-tree-select-option[data-item-id="2"]');
          const amountText = terminal.querySelector('.finance-tree-select-amount')?.textContent || '';
          terminal.click();
          return {
            groupDisabled: group.getAttribute('aria-disabled') === 'true',
            valueAfterGroupClick,
            selectedValue: root.querySelector('.finance-tree-select-value')?.value || '',
            selectedLabel: root.querySelector('.finance-tree-select-trigger')?.textContent || '',
            amountText,
          };
        })()""")
        assert tree_state['groupDisabled'], tree_state
        assert tree_state['valueAfterGroupClick'] != '1', tree_state
        assert tree_state['selectedValue'] == '2', tree_state
        assert 'Taxi' in tree_state['selectedLabel'], tree_state
        assert '1\xa0250' in tree_state['amountText'], tree_state
        await cdp.eval("""(() => [...document.querySelectorAll('.modal-overlay .modal-actions button')]
          .find(btn => btn.textContent.trim() === 'Create rule from fact')?.click())()""")
        await wait_until(cdp, "document.querySelector('.modal-overlay h3')?.textContent.trim() === 'Finance mapping rules'", timeout=4)
        rule_seed_modal_class = await cdp.eval("document.querySelector('.modal-overlay .modal')?.className || ''")
        assert 'finance-facts-modal' in rule_seed_modal_class, rule_seed_modal_class
        rule_modal_layout = await cdp.eval("""(() => {
          const modal = document.querySelector('.modal-overlay .modal.finance-facts-modal');
          const body = modal?.querySelector('.modal-body');
          const input = modal?.querySelector('[data-rule-field="name"]');
          const actions = modal?.querySelector('.modal-actions');
          const modalRect = modal.getBoundingClientRect();
          const inputRect = input.getBoundingClientRect();
          const actionsRect = actions.getBoundingClientRect();
          const bodyStyle = getComputedStyle(body);
          return {
            modalRight: Math.round(modalRect.right),
            viewportWidth: window.innerWidth,
            inputRight: Math.round(inputRect.right),
            actionsBottom: Math.round(actionsRect.bottom),
            viewportHeight: window.innerHeight,
            bodyOverflowY: bodyStyle.overflowY,
            bodyMaxHeight: bodyStyle.maxHeight,
          };
        })()""")
        assert rule_modal_layout['modalRight'] <= rule_modal_layout['viewportWidth'], rule_modal_layout
        assert rule_modal_layout['inputRight'] <= rule_modal_layout['modalRight'], rule_modal_layout
        assert rule_modal_layout['actionsBottom'] <= rule_modal_layout['viewportHeight'], rule_modal_layout
        assert rule_modal_layout['bodyOverflowY'] in ('auto', 'scroll'), rule_modal_layout
        seeded_rule = await cdp.eval("""(() => ({
          category: document.querySelector('.modal-overlay [data-rule-field="category"]')?.value || '',
          description: document.querySelector('.modal-overlay [data-rule-field="description"]')?.value || '',
          mcc: document.querySelector('.modal-overlay [data-rule-field="mcc"]')?.value || '',
          direction: document.querySelector('.modal-overlay [data-rule-field="direction"]')?.value || '',
          planId: document.querySelector('.modal-overlay [data-rule-field="plan-id"]')?.value || '',
          itemId: document.querySelector('.modal-overlay [data-rule-field="item-id"]')?.value || '',
          applyExisting: document.querySelector('.modal-overlay [data-rule-field="apply-existing"]')?.checked || false,
          targetLabel: document.querySelector('.modal-overlay .finance-tree-select-trigger')?.textContent || '',
        }))()""")
        assert seeded_rule['category'] == 'Такси', seeded_rule
        assert seeded_rule['description'] == 'Яндекс Такси', seeded_rule
        assert seeded_rule['mcc'] == '3990', seeded_rule
        assert seeded_rule['direction'] == 'expense', seeded_rule
        assert seeded_rule['planId'] == '1', seeded_rule
        assert seeded_rule['itemId'] == '2', seeded_rule
        assert seeded_rule['applyExisting'], seeded_rule
        assert 'Taxi' in seeded_rule['targetLabel'], seeded_rule
        await cdp.eval("""(() => [...document.querySelectorAll('.modal-overlay .modal-actions button')]
          .find(btn => btn.textContent.trim().startsWith('Create'))?.click())()""")
        await wait_until(cdp, "!document.querySelector('.modal-overlay')", timeout=5)
        mapped_by_rule = await cdp.eval("""(() => {
          const rules = JSON.parse(localStorage.getItem('mock.finance_mapping_rules') || '[]');
          const allocations = JSON.parse(localStorage.getItem('mock.finance_transaction_allocations') || '[]')
            .filter(row => row.is_active !== false);
          return {
            rules: rules.length,
            allocationCount: allocations.length,
            allocationItemId: String(allocations[0]?.item_id || ''),
            assignedBy: allocations[0]?.assigned_by || '',
          };
        })()""")
        assert mapped_by_rule == {
            'rules': 1,
            'allocationCount': 1,
            'allocationItemId': '2',
            'assignedBy': 'rule',
        }, mapped_by_rule

        await cdp.eval("""(() => {
          const allocations = JSON.parse(localStorage.getItem('mock.finance_transaction_allocations') || '[]');
          if (allocations[0]) {
            allocations[0].item_id = 1;
            allocations[0].updated_at = '2026-01-02T00:00:00Z';
          }
          localStorage.setItem('mock.finance_transaction_allocations', JSON.stringify(allocations));
        })()""")
        await reload_finance()
        await cdp.eval("""(() => [...document.querySelectorAll('#panel-finance .finance-mode-bar .finance-segment-btn')]
          .find(btn => btn.textContent.trim() === 'Facts').click())()""")
        await wait_until(cdp, "!!document.querySelector('#panel-finance .finance-facts-table')", timeout=4)
        group_filter_label = await cdp.eval("""(() => [...document.querySelectorAll('#panel-finance .finance-facts-filter button')]
          .map(btn => btn.textContent.trim()).find(text => text.includes('Group target')) || '')()""")
        assert 'Group target' in group_filter_label and '!' in group_filter_label, group_filter_label
        group_marker = await cdp.eval("!!document.querySelector('#panel-finance .finance-fact-row .finance-group-target-alert')")
        assert group_marker, 'facts mapped to group items need an alert marker'
        await cdp.eval("""(() => [...document.querySelectorAll('#panel-finance .finance-facts-filter button')]
          .find(btn => btn.textContent.includes('Group target'))?.click())()""")
        await wait_until(cdp, "document.querySelectorAll('#panel-finance .finance-fact-row').length === 1", timeout=3)
        group_target_fact = await cdp.eval(
            "document.querySelector('#panel-finance .finance-fact-row .finance-fact-description')?.textContent.trim() || ''"
        )
        assert group_target_fact == 'Яндекс Такси', group_target_fact

        await cdp.eval("""(() => {
          const original = window.__TAURI__.core.invoke;
          window.__financeFactsOriginalInvoke = original;
          window.__TAURI__.core.invoke = async (command, args = {}) => {
            if (command === 'preview_finance_bank_csv') {
              throw new Error('invalid payment date: not-a-date\\n\\nColumn: Дата платежа\\nValue: not-a-date\\nCSV row 2:\\n"30.04.2026 17:38:55";"not-a-date";"*7857"');
            }
            return original(command, args);
          };
        })()""")
        await cdp.eval("""(() => [...document.querySelectorAll('#panel-finance .finance-facts-header button')]
          .find(btn => btn.textContent.trim() === 'Import CSV').click())()""")
        await wait_until(cdp, "!!document.querySelector('.error-dialog-overlay')", timeout=4)
        import_error_details = await cdp.eval("document.querySelector('.error-dialog-details')?.textContent || ''")
        assert 'preview' in import_error_details and 'CSV row 2' in import_error_details, import_error_details
        await cdp.eval("""(() => {
          if (window.__financeFactsOriginalInvoke) {
            window.__TAURI__.core.invoke = window.__financeFactsOriginalInvoke;
            delete window.__financeFactsOriginalInvoke;
          }
        })()""")
        await close_modals()

        await cdp.eval("""(() => [...document.querySelectorAll('#panel-finance .finance-facts-header button')]
          .find(btn => btn.textContent.trim() === 'Import CSV').click())()""")
        await wait_until(cdp, "!!document.querySelector('.modal-overlay .finance-import-preview')", timeout=4)
        preview_text = await cdp.eval("document.querySelector('.modal-overlay .finance-import-preview')?.textContent || ''")
        assert 'New' in preview_text and 'Duplicates' in preview_text, preview_text
        await close_modals()

        await cdp.eval("""(() => {
          const rules = Array.from({ length: 32 }, (_, index) => ({
            id: index + 1,
            uuid: `rule-overflow-${index + 1}`,
            name: `Long mapping rule ${index + 1} for modal overflow regression`,
            is_enabled: true,
            priority: index + 1,
            match_mode: 'all',
            conditions_json: JSON.stringify([{ field: 'description', op: 'contains', value: `merchant ${index + 1}` }]),
            target_plan_id: 1,
            target_item_id: 2,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
            sync_status: 'pending',
            user_id: 'mock-user',
          }));
          localStorage.setItem('mock.finance_mapping_rules', JSON.stringify(rules));
          localStorage.setItem('mock.__seq.finance_mapping_rules', '32');
        })()""")
        await reload_finance()
        await cdp.eval("""(() => [...document.querySelectorAll('#panel-finance .finance-mode-bar .finance-segment-btn')]
          .find(btn => btn.textContent.trim() === 'Facts').click())()""")
        await wait_until(cdp, "!!document.querySelector('#panel-finance .finance-facts-table')", timeout=4)
        await cdp.eval("""(() => [...document.querySelectorAll('#panel-finance .finance-facts-header button')]
          .find(btn => btn.textContent.trim() === 'Rules').click())()""")
        await wait_until(cdp, "!!document.querySelector('.modal-overlay [data-rule-field=\"category\"]')", timeout=4)
        rules_title = await cdp.eval("document.querySelector('.modal-overlay h3')?.textContent || ''")
        assert rules_title == 'Finance mapping rules', rules_title
        rules_modal_class = await cdp.eval("document.querySelector('.modal-overlay .modal')?.className || ''")
        assert 'finance-facts-modal' in rules_modal_class, rules_modal_class
        overflow_layout = await cdp.eval("""(() => {
          const modal = document.querySelector('.modal-overlay .modal.finance-facts-modal');
          const body = modal.querySelector('.modal-body');
          const input = modal.querySelector('[data-rule-field="name"]');
          const actions = modal.querySelector('.modal-actions');
          const modalRect = modal.getBoundingClientRect();
          const bodyRect = body.getBoundingClientRect();
          const inputRect = input.getBoundingClientRect();
          const actionsRect = actions.getBoundingClientRect();
          return {
            modalRight: Math.round(modalRect.right),
            inputRight: Math.round(inputRect.right),
            actionsBottom: Math.round(actionsRect.bottom),
            viewportWidth: window.innerWidth,
            viewportHeight: window.innerHeight,
            bodyHasVerticalScroll: body.scrollHeight > body.clientHeight,
            bodyBottomBeforeActions: Math.round(bodyRect.bottom) <= Math.round(actionsRect.top),
          };
        })()""")
        assert overflow_layout['modalRight'] <= overflow_layout['viewportWidth'], overflow_layout
        assert overflow_layout['inputRight'] <= overflow_layout['modalRight'], overflow_layout
        assert overflow_layout['actionsBottom'] <= overflow_layout['viewportHeight'], overflow_layout
        assert overflow_layout['bodyHasVerticalScroll'], overflow_layout
        assert overflow_layout['bodyBottomBeforeActions'], overflow_layout
        await close_modals()

    await check('T26j Finance facts import and rules', t26j_finance_facts_import_and_rules)

    async def t26k_clickhouse_docs_slow_tree_fallback():
        clickhouse_rs_path = os.path.join(SRC_DIR, '..', 'src-tauri', 'src', 'commands', 'clickhouse_docs.rs')
        with open(clickhouse_rs_path, 'r', encoding='utf-8') as fh:
            clickhouse_rs = fh.read()
        for fn_name in (
            'list_clickhouse_doc_tree',
            'get_clickhouse_doc_page',
            'get_clickhouse_doc_section',
            'search_clickhouse_docs',
            'list_clickhouse_doc_update_runs',
            'list_clickhouse_doc_changes',
        ):
            assert f'pub async fn {fn_name}' in clickhouse_rs, f'{fn_name} must stay async to avoid UI-blocking IPC'

        await close_modals()
        await cdp.eval("""(() => {
          const settings = JSON.parse(localStorage.getItem('mock.settings') || '{}');
          settings.last_active_tab = 'shortcuts';
          localStorage.setItem('mock.settings', JSON.stringify(settings));
        })()""")
        await cdp.send('Page.reload', ignoreCache=True)
        await wait_until(cdp, "!!window.__TAURI__ && !!window.__TAURI__.core && !!document.querySelector('.tab-btn[data-tab-id=\"clickhouse-docs\"]')", timeout=8)
        await cdp.eval("""(() => {
          window.__CLICKHOUSE_DOCS_LOAD_TIMEOUT_MS = 80;
          const originalInvoke = window.__TAURI__.core.invoke;
          window.__clickhouseOriginalInvoke = originalInvoke;
          window.__TAURI__.core.invoke = async (command, args = {}) => {
            if (command === 'list_clickhouse_doc_tree') {
              await new Promise(resolve => setTimeout(resolve, 400));
            }
            return originalInvoke(command, args);
          };
        })()""")
        try:
            await cdp.eval("document.querySelector('.tab-btn[data-tab-id=\"clickhouse-docs\"]').click()")
            slow_text = await wait_until(
                cdp,
                """(() => {
                  const panel = document.querySelector('#panel-clickhouse-docs');
                  if (!panel) return null;
                  const text = panel.innerText || '';
                  return text.includes('ClickHouse docs are still loading') ? text : null;
                })()""",
                timeout=3,
            )
            assert 'ClickHouse docs are still loading' in slow_text, slow_text
        finally:
            await cdp.eval("""(() => {
              if (window.__clickhouseOriginalInvoke) {
                window.__TAURI__.core.invoke = window.__clickhouseOriginalInvoke;
                delete window.__clickhouseOriginalInvoke;
              }
              delete window.__CLICKHOUSE_DOCS_LOAD_TIMEOUT_MS;
            })()""")

    await check('T26k ClickHouse docs slow tree fallback', t26k_clickhouse_docs_slow_tree_fallback)

    # ── T27: ClickHouse docs module ───────────────────────
    async def t27_clickhouse_docs_module():
        await close_modals()
        await cdp.eval("""(() => {
          const settings = JSON.parse(localStorage.getItem('mock.settings') || '{}');
          settings.last_active_tab = 'clickhouse-docs';
          localStorage.setItem('mock.settings', JSON.stringify(settings));
        })()""")
        await cdp.send('Page.reload', ignoreCache=True)
        await wait_until(cdp, "!!window.__TAURI__ && !!window.__TAURI__.core", timeout=8)
        await wait_until(cdp, "!!document.querySelector('#panel-clickhouse-docs .ch-docs-shell')", timeout=8)
        startup_calls = await wait_until(
            cdp,
            """(() => {
              const calls = (window.__mockCommandLog || []).map(call => call.command);
              return calls.includes('list_clickhouse_doc_tree') && !!document.querySelector('#panel-clickhouse-docs .ch-nav-page')
                ? calls
                : null;
            })()""",
            timeout=8,
        )
        assert 'list_clickhouse_doc_tree' in startup_calls, startup_calls
        assert 'get_clickhouse_doc_page' not in startup_calls, startup_calls

        placement = await cdp.eval("""(() => {
          const buttons = [...document.querySelectorAll('.tab-btn[data-tab-id]')];
          const ids = buttons.map(btn => btn.dataset.tabId);
          return {
            ids,
            searchIndex: ids.indexOf('repo-search'),
            clickhouseIndex: ids.indexOf('clickhouse-docs'),
          };
        })()""")
        assert placement['clickhouseIndex'] > placement['searchIndex'] >= 0, placement

        await cdp.eval("document.querySelector('.tab-btn[data-tab-id=\"clickhouse-docs\"]').click()")
        await wait_until(cdp, "!!document.querySelector('#panel-clickhouse-docs .ch-docs-shell')", timeout=5)
        title = await cdp.eval("document.querySelector('#panel-clickhouse-docs .ch-docs-title')?.textContent.trim()")
        assert title == 'ClickHouse', title
        console_frame = await cdp.eval("""(() => {
          const panel = document.querySelector('#panel-clickhouse-docs');
          return {
            hasShell: !!panel?.querySelector('.ch-reference-console'),
            hasLogo: !!panel?.querySelector('.ch-logo-mark'),
            hasStatusRail: !!panel?.querySelector('.ch-inspector-rail'),
            statusText: panel?.querySelector('.ch-inspector-rail')?.innerText || '',
          };
        })()""")
        assert console_frame['hasShell'] is True, console_frame
        assert console_frame['hasLogo'] is True, console_frame
        assert console_frame['hasStatusRail'] is True, console_frame
        assert '4' in console_frame['statusText'] and 'sections' in console_frame['statusText'], console_frame
        assert '2' in console_frame['statusText'] and 'pages' in console_frame['statusText'], console_frame
        update_control = await cdp.eval("""(() => {
          const panel = document.querySelector('#panel-clickhouse-docs');
          return {
            hasControl: !!panel?.querySelector('.ch-update-control'),
            hasProgressStrip: !!panel?.querySelector('.ch-update-progress:not([hidden])'),
            updateLogText: panel?.querySelector('[data-action="changelog"]')?.textContent.trim() || '',
          };
        })()""")
        assert update_control['hasControl'] is True, update_control
        assert update_control['hasProgressStrip'] is False, update_control
        assert update_control['updateLogText'] == 'Update log', update_control
        await cdp.eval("document.querySelector('#panel-clickhouse-docs .ch-nav-page')?.click()")
        page_index_text = await wait_until(
            cdp,
            "document.querySelector('#panel-clickhouse-docs .ch-section-index')?.innerText",
            timeout=5,
        )
        assert 'arrayCompact' in page_index_text, page_index_text
        page_payload_chars = await cdp.eval("window.__mockClickHouseLastPageBodyChars")
        assert page_payload_chars == 0, f'ClickHouse page index payload must not include markdown/section bodies, got {page_payload_chars} chars'
        expanded_nav_sections = await cdp.eval(
            "document.querySelectorAll('#panel-clickhouse-docs .ch-nav-section').length"
        )
        assert expanded_nav_sections >= 3, expanded_nav_sections
        nav_tree = await cdp.eval("""(() => {
          const panel = document.querySelector('#panel-clickhouse-docs');
          return {
            hasTree: !!panel?.querySelector('.ch-nav-tree'),
            branchTexts: [...panel?.querySelectorAll('.ch-nav-branch') || []].map(row => row.textContent.trim()),
            pageDepth: panel?.querySelector('.ch-nav-page.active')?.dataset.navDepth || '',
            sectionDepth: panel?.querySelector('.ch-nav-section')?.dataset.navDepth || '',
          };
        })()""")
        assert nav_tree['hasTree'] is True, nav_tree
        assert any('Functions' in text for text in nav_tree['branchTexts']), nav_tree
        assert any('Arrays' in text for text in nav_tree['branchTexts']), nav_tree
        assert nav_tree['pageDepth'] == '2', nav_tree
        assert nav_tree['sectionDepth'] == '3', nav_tree
        nav_alignment = await cdp.eval("""(() => {
          const page = document.querySelector('#panel-clickhouse-docs .ch-nav-page.active');
          const section = document.querySelector('#panel-clickhouse-docs .ch-nav-section');
          const pageStyle = page ? getComputedStyle(page) : null;
          const sectionStyle = section ? getComputedStyle(section) : null;
          return {
            pageTextAlign: pageStyle?.textAlign || '',
            pageDisplay: pageStyle?.display || '',
            pageJustify: pageStyle?.justifyContent || '',
            sectionTextAlign: sectionStyle?.textAlign || '',
            sectionDisplay: sectionStyle?.display || '',
            sectionJustify: sectionStyle?.justifyContent || '',
          };
        })()""")
        assert nav_alignment['pageTextAlign'] == 'left', nav_alignment
        assert nav_alignment['pageDisplay'] == 'flex', nav_alignment
        assert nav_alignment['pageJustify'] == 'flex-start', nav_alignment
        assert nav_alignment['sectionTextAlign'] == 'left', nav_alignment
        assert nav_alignment['sectionDisplay'] == 'flex', nav_alignment
        assert nav_alignment['sectionJustify'] == 'flex-start', nav_alignment
        collapsed_children = await cdp.eval("""(() => {
          const branch = [...document.querySelectorAll('#panel-clickhouse-docs .ch-nav-branch')]
            .find(row => row.textContent.includes('Arrays'));
          branch?.click();
          return document.querySelectorAll('#panel-clickhouse-docs .ch-nav-section').length;
        })()""")
        assert collapsed_children == 0, collapsed_children
        expanded_children = await cdp.eval("""(() => {
          const branch = [...document.querySelectorAll('#panel-clickhouse-docs .ch-nav-branch')]
            .find(row => row.textContent.includes('Arrays'));
          branch?.click();
          return document.querySelectorAll('#panel-clickhouse-docs .ch-nav-section').length;
        })()""")
        assert expanded_children >= 3, expanded_children
        article_on_page_index = await cdp.eval("!!document.querySelector('#panel-clickhouse-docs .ch-article')")
        assert article_on_page_index is False, article_on_page_index
        normalized_fence = await cdp.eval("""(async () => {
          const mod = await import('./tabs/clickhouse-docs.js');
          return [
            mod.normalizeClickHouseMarkdownForRender("```sql title=Query\\nSELECT 1\\n```"),
            mod.normalizeClickHouseMarkdownForRender("````sql title=Query\\n```not close\\n````"),
          ];
        })()""")
        assert normalized_fence == [
            "```sql\nSELECT 1\n```",
            "````sql\n```not close\n````",
        ], normalized_fence

        await cdp.eval("""(() => {
          const input = document.querySelector('#panel-clickhouse-docs .ch-search-input');
          input.value = 'arrayCompact';
          input.dispatchEvent(new Event('input', { bubbles: true }));
        })()""")
        await wait_until(cdp, "!!document.querySelector('#panel-clickhouse-docs .ch-result-card')", timeout=5)
        first_result = await cdp.eval("document.querySelector('#panel-clickhouse-docs .ch-result-card')?.textContent")
        assert first_result and 'arrayCompact' in first_result, first_result
        await cdp.eval("document.querySelector('#panel-clickhouse-docs .ch-result-card').click()")
        article_text = await wait_until(
            cdp,
            "document.querySelector('#panel-clickhouse-docs .ch-article')?.innerText",
            timeout=5,
        )
        assert 'arrayCompact(arr)' in article_text, article_text[:200]
        assert 'arrayConcat(arr1' not in article_text, article_text[:400]
        result_expanded_nav = await cdp.eval("""(() => ({
          functionsOpen: [...document.querySelectorAll('#panel-clickhouse-docs .ch-nav-branch.expanded')]
            .some(row => row.textContent.includes('Functions')),
          arraysOpen: [...document.querySelectorAll('#panel-clickhouse-docs .ch-nav-branch.expanded')]
            .some(row => row.textContent.includes('Arrays')),
        }))()""")
        assert result_expanded_nav['functionsOpen'] is True, result_expanded_nav
        assert result_expanded_nav['arraysOpen'] is True, result_expanded_nav
        section_calls = await cdp.eval(
            "(window.__mockCommandLog || []).filter(call => call.command === 'get_clickhouse_doc_section').length"
        )
        assert section_calls >= 1, section_calls

        await cdp.eval("document.querySelector('#panel-clickhouse-docs [data-action=\"changelog\"]').click()")
        await wait_until(cdp, "!!document.querySelector('.modal-overlay .ch-changelog-modal')", timeout=4)
        changelog_text = await cdp.eval("document.querySelector('.modal-overlay')?.innerText")
        assert 'ClickHouse Docs Update Log' in changelog_text, changelog_text
        await close_modals()

        await cdp.eval("document.querySelector('#panel-clickhouse-docs [data-action=\"update\"]').click()")
        update_text = await wait_until(
            cdp,
            """(() => {
              const control = document.querySelector('#panel-clickhouse-docs .ch-update-control');
              return control && control.innerText.includes('updated') ? control.innerText : null;
            })()""",
            timeout=5,
        )
        assert 'Update docs' in update_text, update_text
        assert 'updated' in update_text, update_text
        visible_progress_strip = await cdp.eval(
            "!!document.querySelector('#panel-clickhouse-docs .ch-update-progress:not([hidden])')"
        )
        assert visible_progress_strip is False, visible_progress_strip
        await cdp.eval("document.querySelector('#panel-clickhouse-docs [data-action=\"update-details\"]').click()")
        details_text = await wait_until(
            cdp,
            "document.querySelector('#panel-clickhouse-docs .ch-update-popover:not([hidden])')?.innerText",
            timeout=5,
        )
        assert 'Complete' in details_text, details_text
        assert '100%' in details_text, details_text
        assert '2 page(s) checked' in details_text, details_text
        assert 'Last update' in details_text, details_text
        await cdp.eval("document.querySelector('#panel-clickhouse-docs [data-action=\"update-details\"]').click()")
        await cdp.eval("""(() => {
          const progress = {
            running: true,
            phase: 'fetching',
            message: 'Fetching docs',
            current: 1,
            total: 2,
            remaining: 1,
            percent: 50,
            elapsed_ms: 1000,
            summary: '',
            error: null,
          };
          window.dispatchEvent(new CustomEvent('clickhouse-doc-update-progress', { detail: progress }));
        })()""")
        running_update_text = await wait_until(
            cdp,
            """(() => {
              const control = document.querySelector('#panel-clickhouse-docs .ch-update-control');
              return control && control.innerText.includes('50%') ? control.innerText : null;
            })()""",
            timeout=5,
        )
        assert '50%' in running_update_text, running_update_text
        assert '1/2' in running_update_text, running_update_text
        running_progress_strip = await cdp.eval(
            "!!document.querySelector('#panel-clickhouse-docs .ch-update-progress:not([hidden])')"
        )
        assert running_progress_strip is False, running_progress_strip
        await cdp.eval("""(() => {
          const now = new Date().toISOString();
          const progress = {
            running: false,
            phase: 'done',
            message: 'Complete',
            current: 2,
            total: 2,
            remaining: 0,
            percent: 100,
            started_at: now,
            finished_at: now,
            elapsed_ms: 1000,
            summary: '2 page(s) checked, 2 updated, 4 added, 0 changed, 0 removed, 0 failed',
            error: null,
          };
          window.dispatchEvent(new CustomEvent('clickhouse-doc-update-progress', { detail: progress }));
        })()""")
        article_after_update = await cdp.eval("!!document.querySelector('#panel-clickhouse-docs .ch-article')")
        assert article_after_update is False, article_after_update
        await cdp.eval("document.querySelector('.tab-btn[data-tab-id=\"tasks\"]').click()")
        await wait_until(cdp, "!!document.querySelector('#panel-tasks')", timeout=5)
        await cdp.eval("document.querySelector('.tab-btn[data-tab-id=\"clickhouse-docs\"]').click()")
        persisted_update_text = await wait_until(
            cdp,
            "document.querySelector('#panel-clickhouse-docs .ch-update-control')?.innerText",
            timeout=5,
        )
        assert 'Update docs' in persisted_update_text, persisted_update_text
        assert 'updated' in persisted_update_text, persisted_update_text

    await check('T27 ClickHouse docs module', t27_clickhouse_docs_module)

    # ── T28: Detached module windows ───────────────────────
    async def t28_detached_module_context_menu_and_standalone_boot():
        await cdp.send('Page.navigate', url=TEST_URL)
        await asyncio.sleep(0.8)
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

        await cdp.eval("""(() => {
          const tasks = JSON.parse(localStorage.getItem('mock.tasks') || '[]');
          const idx = tasks.findIndex(t => Number(t.id) === 880);
          const row = {
            id: 880,
            uuid: 'standalone-route-task-uuid',
            title: 'Standalone route task',
            category_id: null,
            status_id: null,
            is_pinned: false,
            bg_color: null,
            tracker_url: null,
            notes_md: '',
            sort_order: 880,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          };
          if (idx >= 0) tasks[idx] = { ...tasks[idx], ...row };
          else tasks.push(row);
          localStorage.setItem('mock.tasks', JSON.stringify(tasks));
        })()""")
        await cdp.send('Page.navigate', url=f'{TEST_URL}?standalone=1&module=tasks&objectType=task&objectId=880&title=Standalone%20route%20task')
        await asyncio.sleep(0.8)
        await wait_until(cdp, "document.body.classList.contains('standalone-module-window')", timeout=8)
        opened_task = await wait_until(
            cdp,
            "document.querySelector('.task-card.expanded[data-task-id=\"880\"]')?.innerText.includes('Standalone route task') || document.querySelector('.tasks-focus-row.active[data-task-id=\"880\"]')?.innerText.includes('Standalone route task')",
            timeout=5,
        )
        assert opened_task is True, 'standalone object route did not expand deterministic task'

        stored_tab = await cdp.eval(
            "JSON.parse(localStorage.getItem('mock.settings') || '{}').last_active_tab"
        )
        assert stored_tab == 'notes', f'standalone changed last_active_tab: {stored_tab!r}'

        await cdp.send('Page.navigate', url=f'{TEST_URL}?standalone=1&module=whisper')
        await asyncio.sleep(0.8)
        await wait_until(cdp, "document.body.classList.contains('standalone-module-window')", timeout=8)
        whisper_panel_id = await cdp.eval("document.querySelector('.tab-panel')?.id")
        assert whisper_panel_id == 'panel-whisper', whisper_panel_id
        whisper_text = await wait_until(
            cdp,
            "document.body.innerText",
            timeout=5,
        )
        assert 'Failed to load module' not in whisper_text, whisper_text
        assert 'Whisper' in whisper_text or 'Выберите модель' in whisper_text, whisper_text

        await cdp.send('Page.navigate', url=f'{TEST_URL}?standalone=1&module=unknown')
        await asyncio.sleep(0.8)
        await wait_until(cdp, "document.body.classList.contains('standalone-module-window')", timeout=8)
        invalid_has_sidebar = await cdp.eval("!!document.querySelector('.tab-bar')")
        assert invalid_has_sidebar is False, 'invalid standalone URL rendered the main sidebar'
        invalid_text = await cdp.eval("document.body.innerText")
        assert 'Unsupported module window' in invalid_text, invalid_text

        await cdp.eval("""(() => {
          const plans = JSON.parse(localStorage.getItem('mock.finance_plans') || '[]');
          localStorage.setItem('mock.finance_plans', JSON.stringify(plans.map(p => (
            Number(p.id) === 2 ? { ...p, name: 'Project expenses', uuid: 'finance-project-expenses-uuid' } : p
          ))));
        })()""")
        await cdp.send('Page.navigate', url=f'{TEST_URL}?standalone=1&module=finance&objectType=finance_plan&objectId=2&title=Project%20expenses')
        await asyncio.sleep(0.8)
        await wait_until(cdp, "document.body.classList.contains('standalone-module-window')", timeout=8)
        await wait_until(cdp, "!!document.querySelector('.finance-plan-card.active')", timeout=6)
        active_finance = await cdp.eval("document.querySelector('.finance-plan-card.active .finance-plan-name')?.textContent.trim()")
        assert active_finance == 'Project expenses', active_finance

        await cdp.send('Page.navigate', url=TEST_URL)
        await asyncio.sleep(0.8)
        await wait_until(cdp, "!!document.querySelector('.tab-btn')", timeout=8)
        active_tab = await wait_until(
            cdp,
            "document.querySelector('.tab-btn.active')?.dataset.tabId",
            timeout=4,
        )
        assert active_tab == 'notes', f'main window did not keep last_active_tab: {active_tab!r}'
    await check('T28 Detached module windows', t28_detached_module_context_menu_and_standalone_boot)

    # ── T29: Micro Launchpad ───────────────────────────────
    async def t29_micro_launchpad_shell_settings_search_actions():
        await cdp.send('Page.navigate', url=f'{TEST_URL}?launchpad=1')
        await asyncio.sleep(0.8)
        await wait_until(cdp, "document.body.classList.contains('micro-launchpad-window')", timeout=8)

        has_sidebar = await cdp.eval("!!document.querySelector('.tab-bar')")
        assert has_sidebar is False, 'launchpad rendered main sidebar'
        has_status_bar = await cdp.eval("!!document.querySelector('#status-bar')")
        assert has_status_bar is False, 'launchpad rendered main status bar'
        sync_calls = await cdp.eval("window.__mockSyncCalls || 0")
        assert sync_calls == 0, f'launchpad boot called sync: {sync_calls}'

        await wait_until(cdp, "!!document.querySelector('.micro-launchpad')", timeout=5)
        await wait_until(cdp, "!!document.querySelector('.launchpad-gear-btn')", timeout=5)
        add_tile_exists = await cdp.eval("!!document.querySelector('.launchpad-add-tile')")
        assert add_tile_exists is False, 'Add tile should not consume Launchpad grid space'
        add_button_exists = await cdp.eval("!!document.querySelector('.launchpad-plus-btn')")
        assert add_button_exists is True, 'topbar + button missing'
        await cdp.eval("document.querySelector('.launchpad-gear-btn').click()")
        await wait_until(cdp, "!!document.querySelector('.launchpad-menu')", timeout=3)
        menu_text = await cdp.eval("document.querySelector('.launchpad-menu').innerText")
        assert 'Edit Launchpad' in menu_text, menu_text
        assert 'Show search' in menu_text, menu_text
        assert 'Show recent' in menu_text, menu_text
        assert 'Columns' in menu_text and 'Rows' in menu_text, menu_text
        await cdp.eval("""(() => {
          const cols = document.querySelector('[data-launchpad-size="columns"]');
          const rows = document.querySelector('[data-launchpad-size="rows"]');
          cols.value = '5';
          rows.value = '4';
          cols.dispatchEvent(new Event('change', { bubbles: true }));
          rows.dispatchEvent(new Event('change', { bubbles: true }));
        })()""")
        await wait_until(
            cdp,
            "JSON.parse(localStorage.getItem('mock.settings') || '{}')['launchpad.columns'] === '5'",
            timeout=3,
        )
        await wait_until(
            cdp,
            "JSON.parse(localStorage.getItem('mock.settings') || '{}')['launchpad.rows'] === '4'",
            timeout=3,
        )
        resize_call = await wait_until(
            cdp,
            "window.__mockLaunchpadResizeCalls && window.__mockLaunchpadResizeCalls.length >= 1 && window.__mockLaunchpadResizeCalls.at(-1)",
            timeout=3,
        )
        assert int(resize_call['columns']) == 5 and int(resize_call['rows']) == 4, resize_call

        await cdp.eval("document.querySelector('[data-launchpad-setting=\"show-search\"]').click()")
        show_search = await wait_until(
            cdp,
            "JSON.parse(localStorage.getItem('mock.settings') || '{}')['launchpad.show_search'] === '0' && '0'",
            timeout=3,
        )
        assert show_search == '0', show_search

        await cdp.eval("""document.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'e', code: 'KeyE', ctrlKey: true, bubbles: true, cancelable: true
        }))""")
        await wait_until(cdp, "document.body.classList.contains('launchpad-edit-mode')", timeout=3)
        await cdp.eval("""document.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'Escape', code: 'Escape', bubbles: true, cancelable: true
        }))""")
        await wait_until(cdp, "!document.body.classList.contains('launchpad-edit-mode')", timeout=3)

        await cdp.eval("document.querySelector('.launchpad-plus-btn').click()")
        await wait_until(cdp, "!!document.querySelector('.launchpad-add-menu')", timeout=3)
        add_menu_text = await cdp.eval("document.querySelector('.launchpad-add-menu').innerText")
        assert 'Add item' in add_menu_text and 'Add container' in add_menu_text and 'Add separator' in add_menu_text, add_menu_text
        await cdp.eval("[...document.querySelectorAll('.launchpad-add-menu button')].find(x => x.textContent.includes('Add container')).click()")
        await wait_until(cdp, "!!document.querySelector('.launchpad-container-entry')", timeout=3)
        items = await cdp.eval("JSON.parse(JSON.parse(localStorage.getItem('mock.settings') || '{}')['launchpad.items'] || '[]')")
        assert any(item.get('layoutType') == 'container' and int(item.get('w') or 0) >= 2 and int(item.get('h') or 0) >= 1 for item in items), items

        await cdp.eval("document.querySelector('.launchpad-plus-btn').click()")
        await wait_until(cdp, "!!document.querySelector('.launchpad-add-menu')", timeout=3)
        await cdp.eval("[...document.querySelectorAll('.launchpad-add-menu button')].find(x => x.textContent.includes('Add separator')).click()")
        await wait_until(cdp, "!!document.querySelector('.launchpad-separator-entry')", timeout=3)
        items = await cdp.eval("JSON.parse(JSON.parse(localStorage.getItem('mock.settings') || '{}')['launchpad.items'] || '[]')")
        assert any(item.get('layoutType') == 'separator' for item in items), items

        await cdp.eval("document.querySelector('.launchpad-plus-btn').click()")
        await wait_until(cdp, "!!document.querySelector('.launchpad-add-menu')", timeout=3)
        await cdp.eval("[...document.querySelectorAll('.launchpad-add-menu button')].find(x => x.textContent.includes('Add item')).click()")
        await wait_until(cdp, "!!document.querySelector('.launchpad-add-picker')", timeout=3)
        await cdp.eval("[...document.querySelectorAll('.launchpad-module-add')].find(x => x.closest('.launchpad-add-module-row')?.textContent.includes('Tasks')).click()")
        items = await cdp.eval("JSON.parse(JSON.parse(localStorage.getItem('mock.settings') || '{}')['launchpad.items'] || '[]')")
        assert any((item.get('layoutType') == 'tile' and item.get('item', {}).get('type') == 'module' and item.get('item', {}).get('moduleId') == 'tasks') or (item.get('type') == 'module' and item.get('moduleId') == 'tasks') for item in items), items

        await cdp.eval("""(() => {
          const snippets = JSON.parse(localStorage.getItem('mock.shortcuts') || '[]');
          if (!snippets.some(s => s.name === 'wb_doc_kylin')) {
            snippets.push({
              id: 9001,
              uuid: 'snippet-kylin-uuid',
              name: 'wb_doc_kylin',
              value: 'kylin connection notes',
              description: 'deterministic launchpad add fixture',
              links: [],
              obsidian_note: null,
              is_pinned: false,
              pinned_sort_order: 0,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            });
            localStorage.setItem('mock.shortcuts', JSON.stringify(snippets));
          }
        })()""")
        await cdp.eval("document.querySelector('.launchpad-plus-btn').click()")
        await wait_until(cdp, "!!document.querySelector('.launchpad-add-menu')", timeout=3)
        await cdp.eval("[...document.querySelectorAll('.launchpad-add-menu button')].find(x => x.textContent.includes('Add item')).click()")
        await wait_until(cdp, "!!document.querySelector('.launchpad-add-picker')", timeout=3)
        await cdp.eval("[...document.querySelectorAll('.launchpad-module-browse')].find(x => x.closest('.launchpad-add-module-row')?.textContent.includes('Snippets')).click()")
        await wait_until(cdp, "document.querySelector('.launchpad-add-title')?.textContent.includes('Snippets')", timeout=3)
        await cdp.eval("""(() => {
          const input = document.querySelector('.launchpad-add-search');
          input.value = 'kylin';
          input.dispatchEvent(new Event('input', { bubbles: true }));
        })()""")
        await wait_until(cdp, "[...document.querySelectorAll('.launchpad-add-result')].some(x => x.textContent.includes('wb_doc_kylin'))", timeout=5)
        await cdp.eval("[...document.querySelectorAll('.launchpad-add-result')].find(x => x.textContent.includes('wb_doc_kylin')).click()")
        items = await cdp.eval("JSON.parse(JSON.parse(localStorage.getItem('mock.settings') || '{}')['launchpad.items'] || '[]')")
        assert any((item.get('layoutType') == 'tile' and item.get('item', {}).get('type') == 'snippet' and item.get('item', {}).get('objectUuid') == 'snippet-kylin-uuid') or (item.get('type') == 'snippet' and item.get('objectUuid') == 'snippet-kylin-uuid') for item in items), items

        await cdp.eval("document.querySelector('.launchpad-plus-btn').click()")
        await wait_until(cdp, "!!document.querySelector('.launchpad-add-menu')", timeout=3)
        await cdp.eval("[...document.querySelectorAll('.launchpad-add-menu button')].find(x => x.textContent.includes('Add item')).click()")
        await wait_until(cdp, "!!document.querySelector('.launchpad-add-picker')", timeout=3)
        await cdp.eval("[...document.querySelectorAll('.launchpad-module-browse')].find(x => x.closest('.launchpad-add-module-row')?.textContent.includes('Finance')).click()")
        await wait_until(cdp, "document.querySelector('.launchpad-add-title')?.textContent.includes('Finance')", timeout=3)
        await cdp.eval("""(() => {
          const input = document.querySelector('.launchpad-add-search');
          input.value = 'Project';
          input.dispatchEvent(new Event('input', { bubbles: true }));
        })()""")
        await wait_until(cdp, "[...document.querySelectorAll('.launchpad-add-result')].some(x => x.textContent.includes('Project expenses'))", timeout=5)
        await cdp.eval("[...document.querySelectorAll('.launchpad-add-result')].find(x => x.textContent.includes('Project expenses')).click()")
        items = await cdp.eval("JSON.parse(JSON.parse(localStorage.getItem('mock.settings') || '{}')['launchpad.items'] || '[]')")
        assert any((item.get('layoutType') == 'tile' and item.get('item', {}).get('type') == 'finance_plan' and item.get('item', {}).get('moduleId') == 'finance') or (item.get('type') == 'finance_plan' and item.get('moduleId') == 'finance') for item in items), items

        await cdp.eval("""(() => {
          const settings = JSON.parse(localStorage.getItem('mock.settings') || '{}');
          settings['launchpad.show_search'] = '1';
          settings['launchpad.show_recent'] = '1';
          settings['launchpad.items'] = JSON.stringify([
            { layoutType: 'container', id: 'dev-container', title: 'Dev tray', w: 2, h: 2, children: [] },
            { layoutType: 'tile', id: 'tile-tasks', w: 1, h: 1, item: { type: 'module', moduleId: 'tasks', label: 'Tasks', icon: '✓' } },
            { layoutType: 'tile', id: 'tile-task', w: 1, h: 1, item: { type: 'task', moduleId: 'tasks', objectType: 'task', objectId: 1, objectUuid: 'task-uuid-1', label: 'Regular mock task', icon: '✓' } },
            { layoutType: 'tile', id: 'tile-exec', w: 1, h: 1, item: { type: 'exec_command', commandId: 1, label: 'ls project', icon: '⚡', command: 'ls', shell: 'host' } }
          ]);
          localStorage.setItem('mock.settings', JSON.stringify(settings));
          const plans = JSON.parse(localStorage.getItem('mock.finance_plans') || '[]');
          localStorage.setItem('mock.finance_plans', JSON.stringify(plans.map(p => (
            Number(p.id) === 2 ? { ...p, name: 'Project expenses', uuid: 'finance-project-expenses-uuid' } : p
          ))));
          const snippets = JSON.parse(localStorage.getItem('mock.shortcuts') || '[]');
          if (!snippets.some(s => s.name === 'wb_doc_kylin')) {
            snippets.push({
              id: 9001,
              uuid: 'snippet-kylin-uuid',
              name: 'wb_doc_kylin',
              value: 'kylin connection notes',
              description: 'deterministic launchpad search fixture',
              links: [],
              obsidian_note: null,
              is_pinned: false,
              pinned_sort_order: 0,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            });
            localStorage.setItem('mock.shortcuts', JSON.stringify(snippets));
          }
        })()""")
        await cdp.send('Page.navigate', url=f'{TEST_URL}?launchpad=1')
        await asyncio.sleep(0.8)
        await wait_until(cdp, "document.querySelectorAll('.launchpad-tile').length >= 3", timeout=5)
        await wait_until(cdp, "!!document.querySelector('.launchpad-container-entry')", timeout=5)
        body_overflow = await cdp.eval("""(() => {
          const body = document.querySelector('.launchpad-body');
          return body && getComputedStyle(body).overflowY;
        })()""")
        assert body_overflow in ('auto', 'scroll'), body_overflow

        await cdp.eval("window.__mockOpenedModuleWindows = []")
        await cdp.eval("window.__mockLaunchpadClosed = false")
        await cdp.eval("[...document.querySelectorAll('.launchpad-tile')].find(x => x.textContent.includes('Tasks')).click()")
        opened_module = await wait_until(
            cdp,
            "window.__mockOpenedModuleWindows && window.__mockOpenedModuleWindows.includes('tasks')",
            timeout=3,
        )
        assert opened_module is True, 'module tile did not open Tasks window'
        closed_after_module = await wait_until(cdp, "window.__mockLaunchpadClosed === true", timeout=3)
        assert closed_after_module is True, 'Launchpad did not close after opening module window'

        await cdp.eval("window.__mockOpenedModuleObjectWindows = []")
        await cdp.eval("window.__mockLaunchpadClosed = false")
        await cdp.eval("[...document.querySelectorAll('.launchpad-tile')].find(x => x.textContent.includes('Regular mock task')).click()")
        opened_object = await wait_until(
            cdp,
            "window.__mockOpenedModuleObjectWindows && window.__mockOpenedModuleObjectWindows[0]?.objectUuid === 'task-uuid-1'",
            timeout=3,
        )
        assert opened_object is True, 'task tile did not call open_module_object_window'
        closed_after_object = await wait_until(cdp, "window.__mockLaunchpadClosed === true", timeout=3)
        assert closed_after_object is True, 'Launchpad did not close after opening object window'

        await cdp.eval("window.__mockCommandLog = []")
        await cdp.eval("window.__mockLaunchpadClosed = false")
        await cdp.eval("[...document.querySelectorAll('.launchpad-tile')].find(x => x.textContent.includes('ls project')).click()")
        await wait_until(cdp, "document.querySelector('.launchpad-status')?.innerText.includes('OK')", timeout=5)
        ran_command = await cdp.eval("window.__mockCommandLog && window.__mockCommandLog[0]?.command === 'run_command' && window.__mockCommandLog[0]?.payload?.command === 'ls'")
        assert ran_command is True, 'exec tile did not run command'
        closed_after_command = await cdp.eval("window.__mockLaunchpadClosed === true")
        assert closed_after_command is False, 'Launchpad should stay open after running a command'

        recent = await cdp.eval("JSON.parse(JSON.parse(localStorage.getItem('mock.settings') || '{}')['launchpad.recent'] || '[]')")
        assert recent and recent[0]['type'] == 'exec_command', recent

        await cdp.eval("""document.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'Escape', code: 'Escape', bubbles: true, cancelable: true
        }))""")
        await wait_until(cdp, "!document.querySelector('.launchpad-status')", timeout=3)

        await cdp.eval("""document.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'e', code: 'KeyE', ctrlKey: true, bubbles: true, cancelable: true
        }))""")
        await wait_until(cdp, "document.body.classList.contains('launchpad-edit-mode')", timeout=3)
        await cdp.eval("""(() => {
          const tile = [...document.querySelectorAll('.launchpad-tile')].find(x => x.textContent.includes('ls project'));
          const container = document.querySelector('.launchpad-container-entry');
          tile.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 7, button: 0, clientX: 20, clientY: 20, bubbles: true }));
          container.dispatchEvent(new PointerEvent('pointermove', { pointerId: 7, clientX: 60, clientY: 60, bubbles: true }));
          document.dispatchEvent(new PointerEvent('pointerup', { pointerId: 7, clientX: 60, clientY: 60, bubbles: true }));
        })()""")
        await wait_until(
            cdp,
            """(() => {
              const items = JSON.parse(JSON.parse(localStorage.getItem('mock.settings') || '{}')['launchpad.items'] || '[]');
              const container = items.find(x => x.layoutType === 'container');
              return container?.children?.some(child => child.type === 'exec_command' || child.item?.type === 'exec_command');
            })()""",
            timeout=3,
        )
        await cdp.eval("""(() => {
          const container = document.querySelector('.launchpad-container-entry');
          const rect = container.getBoundingClientRect();
          const handle = container.querySelector('.launchpad-resize-handle');
          handle.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 8, button: 0, clientX: rect.right - 3, clientY: rect.bottom - 3, bubbles: true }));
          document.dispatchEvent(new PointerEvent('pointermove', { pointerId: 8, clientX: rect.right + 180, clientY: rect.bottom + 110, bubbles: true }));
          document.dispatchEvent(new PointerEvent('pointerup', { pointerId: 8, clientX: rect.right + 180, clientY: rect.bottom + 110, bubbles: true }));
        })()""")
        resized = await wait_until(
            cdp,
            """(() => {
              const items = JSON.parse(JSON.parse(localStorage.getItem('mock.settings') || '{}')['launchpad.items'] || '[]');
              const container = items.find(x => x.layoutType === 'container');
              return container && Number(container.w) >= 3 && Number(container.h) >= 3 ? container : null;
            })()""",
            timeout=3,
        )
        assert int(resized['w']) >= 3 and int(resized['h']) >= 3, resized
        await cdp.eval("document.querySelector('.launchpad-container-remove').click()")
        unwrapped = await wait_until(
            cdp,
            """(() => {
              const items = JSON.parse(JSON.parse(localStorage.getItem('mock.settings') || '{}')['launchpad.items'] || '[]');
              return !items.some(x => x.layoutType === 'container') && items.some(x => x.layoutType === 'tile' && x.item?.type === 'exec_command');
            })()""",
            timeout=3,
        )
        assert unwrapped is True, 'deleting container did not unwrap children'

        await cdp.eval("""(() => {
          const settings = JSON.parse(localStorage.getItem('mock.settings') || '{}');
          settings['launchpad.items'] = JSON.stringify([
            { type: 'module', moduleId: 'tasks', label: 'Legacy Tasks', icon: '✓' },
            { layoutType: 'container', id: 'search-container', title: 'Search tray', w: 2, h: 1, children: [
              { type: 'exec_command', commandId: 44, label: 'container search command', icon: '⚡', command: 'echo nested', shell: 'host' }
            ] }
          ]);
          localStorage.setItem('mock.settings', JSON.stringify(settings));
        })()""")
        await cdp.send('Page.navigate', url=f'{TEST_URL}?launchpad=1')
        await asyncio.sleep(0.8)
        await wait_until(cdp, "document.body.innerText.includes('Legacy Tasks')", timeout=5)
        await cdp.eval("window.__mockOpenedModuleWindows = []")
        await cdp.eval("[...document.querySelectorAll('.launchpad-tile')].find(x => x.textContent.includes('Legacy Tasks')).click()")
        legacy_opened = await wait_until(cdp, "window.__mockOpenedModuleWindows?.includes('tasks')", timeout=3)
        assert legacy_opened is True, 'legacy flat tile was not activatable after normalization'

        input_exists = await cdp.eval("!!document.querySelector('.launchpad-search-input')")
        assert input_exists is True, 'search input missing after command status'
        await cdp.eval("""(() => {
          const input = document.querySelector('.launchpad-search-input');
          input.value = 'container search';
          input.dispatchEvent(new Event('input', { bubbles: true }));
        })()""")
        await wait_until(cdp, "document.body.innerText.includes('container search command')", timeout=5)
    await check('T29 Micro Launchpad', t29_micro_launchpad_shell_settings_search_actions)

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
