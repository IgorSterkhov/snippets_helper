const { invoke } = window.__TAURI__.core;

export async function call(command, args = {}) {
  try {
    return await invoke(command, args);
  } catch (err) {
    console.error(`IPC error [${command}]:`, err);
    throw err;
  }
}
