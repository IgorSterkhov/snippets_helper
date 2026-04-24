//! Spawn + talk to llama.cpp's `llama-server` sidecar.

use std::path::Path;
use std::time::{Duration, Instant};
use tauri::AppHandle;
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tokio::sync::mpsc;

pub struct LlamaServer {
    child: CommandChild,
    pub port: u16,
    pub pid: u32,
    _rx_task: tokio::task::JoinHandle<()>,
}

impl LlamaServer {
    /// Spawn llama-server bound to `127.0.0.1:<free>`, wait up to 120s for
    /// TCP readiness, return a handle.
    pub async fn spawn(app: &AppHandle, model_path: &Path) -> Result<Self, String> {
        let port = find_free_port()?;

        let cmd = app.shell()
            .sidecar("llama-server")
            .map_err(|e| format!("sidecar: {e}"))?
            .args([
                "--host", "127.0.0.1",
                "--port", &port.to_string(),
                "--model", &model_path.to_string_lossy(),
                // Keep context small — we only feed post-proc prompts of a few
                // hundred tokens. Lower ctx = less RAM.
                "--ctx-size", "2048",
                // CPU thread count: 4 is sane default across dev laptops;
                // llama-server clamps to available cores internally.
                "--threads", "4",
                // No logs from llama.cpp (we have our own panic hook).
                "--log-disable",
            ]);

        let (mut rx, child) = cmd.spawn().map_err(|e| format!("spawn: {e}"))?;
        let pid = child.pid();

        // TCP-probe readiness (same pattern as whisper/server.rs — stdout is
        // full-buffered on Windows, so banner parsing is unreliable).
        let (term_tx, mut term_rx) = mpsc::channel::<String>(1);
        let rx_task = tokio::spawn(async move {
            while let Some(event) = rx.recv().await {
                match event {
                    CommandEvent::Stderr(bytes) | CommandEvent::Stdout(bytes) => {
                        let line = String::from_utf8_lossy(&bytes);
                        eprintln!("[llama-server] {}", line.trim_end());
                    }
                    CommandEvent::Terminated(payload) => {
                        let _ = term_tx.send(format!(
                            "llama-server exited (code {:?})",
                            payload.code
                        )).await;
                        return;
                    }
                    _ => {}
                }
            }
        });

        // Large GGUF models mmap + load weights in 30-60s on CPU; give 180s.
        let deadline = Instant::now() + Duration::from_secs(180);
        loop {
            if let Ok(msg) = term_rx.try_recv() {
                return Err(msg);
            }
            let probe = tokio::time::timeout(
                Duration::from_millis(500),
                tokio::net::TcpStream::connect(("127.0.0.1", port)),
            ).await;
            if let Ok(Ok(sock)) = probe {
                drop(sock);
                return Ok(Self { child, port, pid, _rx_task: rx_task });
            }
            if Instant::now() > deadline {
                return Err("timeout waiting for llama-server TCP port".into());
            }
            tokio::time::sleep(Duration::from_millis(300)).await;
        }
    }

    /// POST /completion with a prompt; return the generated text.
    ///
    /// We use llama.cpp's native `/completion` endpoint (not OpenAI-compatible
    /// `/v1/chat/completions`) because it's simpler and supports all gguf
    /// models regardless of chat-template quirks.
    pub async fn complete(&self, prompt: &str, n_predict: i32) -> Result<String, String> {
        let client = reqwest::Client::new();
        let body = serde_json::json!({
            "prompt": prompt,
            "n_predict": n_predict,
            "temperature": 0.2,
            "top_k": 40,
            "top_p": 0.9,
            "stop": ["<end_of_turn>", "<|endoftext|>", "<eot_id>"],
            // Streaming off — we want the full result synchronously.
            "stream": false,
        });
        let url = format!("http://127.0.0.1:{}/completion", self.port);
        let resp = client.post(&url)
            .json(&body)
            .timeout(Duration::from_secs(600))
            .send().await
            .map_err(|e| format!("completion request: {e}"))?;
        if !resp.status().is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("completion http: {body}"));
        }
        let json: serde_json::Value = resp.json().await
            .map_err(|e| format!("completion parse: {e}"))?;
        let text = json.get("content")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        Ok(text)
    }

    pub fn shutdown(self) {
        let _ = self.child.kill();
    }
}

fn find_free_port() -> Result<u16, String> {
    use std::net::{TcpListener, SocketAddr};
    let addr: SocketAddr = "127.0.0.1:0".parse().unwrap();
    let listener = TcpListener::bind(addr).map_err(|e| format!("bind: {e}"))?;
    let port = listener.local_addr().map_err(|e| format!("local_addr: {e}"))?.port();
    drop(listener);
    Ok(port)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn free_port_is_nonzero() {
        assert!(find_free_port().unwrap() > 0);
    }
}
