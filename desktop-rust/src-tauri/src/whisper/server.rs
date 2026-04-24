//! Spawn and talk to whisper.cpp's `whisper-server` sidecar.

use crate::whisper::bin_manager::BinVariant;
use std::path::Path;
use std::time::{Duration, Instant};
use tauri::AppHandle;
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tokio::sync::mpsc;

pub struct WhisperServer {
    child: CommandChild,
    pub port: u16,
    pub pid: u32,
    _rx_task: tokio::task::JoinHandle<()>,
}

impl WhisperServer {
    /// Spawn the server bound to `127.0.0.1:<free>`, wait up to 30s for
    /// "listening" stderr line, and return a handle.
    pub async fn spawn(
        app: &AppHandle,
        variant: &BinVariant,
        model_path: &Path,
    ) -> Result<Self, String> {
        let port = find_free_port()?;

        let cmd = match variant {
            BinVariant::BundledCpu => {
                app.shell()
                    .sidecar("whisper-server")
                    .map_err(|e| format!("sidecar: {e}"))?
            }
            BinVariant::DownloadedGpu { path } => {
                app.shell().command(path.to_string_lossy().as_ref())
            }
        }
        .args([
            "--host", "127.0.0.1",
            "--port", &port.to_string(),
            "--model", &model_path.to_string_lossy(),
            "--inference-path", "/inference",
            "--threads", "4",
        ]);

        let (mut rx, child) = cmd.spawn().map_err(|e| format!("spawn: {e}"))?;
        let pid = child.pid();

        // Readiness detection by TCP probe, NOT by stdout parsing:
        // whisper-server v1.7.x prints "whisper server listening at ..."
        // via printf to stdout. On Windows, stdout piped to a parent process
        // is full-buffered (not line-buffered), so the banner stays in the
        // C runtime buffer until the buffer fills or the process exits —
        // our parent never sees it even when the server is perfectly healthy.
        // Connecting to 127.0.0.1:<port> succeeds the moment server.cpp calls
        // `svr.listen_after_bind()`, which happens *right after* the banner
        // printf, so the probe is a reliable readiness signal independent
        // of stdio buffering.
        let (term_tx, mut term_rx) = mpsc::channel::<String>(1);
        let rx_task = tokio::spawn(async move {
            while let Some(event) = rx.recv().await {
                match event {
                    CommandEvent::Stderr(bytes) | CommandEvent::Stdout(bytes) => {
                        let line = String::from_utf8_lossy(&bytes);
                        eprintln!("[whisper-server] {}", line.trim_end());
                    }
                    CommandEvent::Terminated(payload) => {
                        let _ = term_tx.send(format!(
                            "whisper-server exited (code {:?})",
                            payload.code
                        )).await;
                        return;
                    }
                    _ => {}
                }
            }
        });

        let deadline = Instant::now() + Duration::from_secs(120);
        loop {
            // 1) If the child already terminated, stop probing immediately.
            if let Ok(msg) = term_rx.try_recv() {
                return Err(msg);
            }
            // 2) Try to open a TCP connection to the port.
            let probe = tokio::time::timeout(
                Duration::from_millis(500),
                tokio::net::TcpStream::connect(("127.0.0.1", port)),
            ).await;
            if let Ok(Ok(sock)) = probe {
                drop(sock);
                return Ok(Self { child, port, pid, _rx_task: rx_task });
            }
            if Instant::now() > deadline {
                return Err("timeout waiting for whisper-server TCP port".into());
            }
            tokio::time::sleep(Duration::from_millis(200)).await;
        }
    }

    /// POST /inference with a WAV body. Returns the transcript text + language.
    pub async fn transcribe(&self, wav: Vec<u8>, language: Option<&str>) -> Result<InferenceResult, String> {
        let client = reqwest::Client::new();
        let form = reqwest::multipart::Form::new()
            .part("file", reqwest::multipart::Part::bytes(wav)
                  .file_name("input.wav")
                  .mime_str("audio/wav").unwrap())
            .text("temperature", "0")
            .text("response_format", "json")
            .text("language", language.unwrap_or("auto").to_string());
        let url = format!("http://127.0.0.1:{}/inference", self.port);
        let resp = client.post(&url)
            .multipart(form)
            .timeout(Duration::from_secs(600))
            .send().await
            .map_err(|e| format!("inference: {e}"))?;
        if !resp.status().is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("inference http: {}", body));
        }
        let json: serde_json::Value = resp.json().await
            .map_err(|e| format!("inference parse: {e}"))?;
        let text = json.get("text").and_then(|v| v.as_str())
            .unwrap_or("").trim().to_string();
        let language = json.get("language").and_then(|v| v.as_str()).map(|s| s.to_string());
        Ok(InferenceResult { text, language })
    }

    /// Graceful shutdown — send SIGTERM on Unix, kill on Windows.
    pub fn shutdown(self) {
        let _ = self.child.kill();
    }
}

#[derive(Debug, Clone)]
pub struct InferenceResult {
    pub text: String,
    pub language: Option<String>,
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
        let p = find_free_port().unwrap();
        assert!(p > 0);
    }
}
