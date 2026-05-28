async function waitForTauriInvoke(timeoutMs = 2500) {
  const started = Date.now();
  while (Date.now() - started <= timeoutMs) {
    const invoke = window.__TAURI__?.core?.invoke;
    if (typeof invoke === 'function') return invoke;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('Tauri IPC bridge is not available in this window');
}

export async function call(command, args = {}) {
  try {
    const invoke = await waitForTauriInvoke();
    return await invoke(command, args);
  } catch (err) {
    console.error(`IPC error [${command}]:`, err);
    throw err;
  }
}
