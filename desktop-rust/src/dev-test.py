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
