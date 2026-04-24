//! Spawn and talk to whisper.cpp's `whisper-server` sidecar.

use crate::whisper::bin_manager::BinVariant;
use std::path::Path;
use std::time::Duration;
use tauri::AppHandle;
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tokio::sync::mpsc;
use tokio::time::timeout;

pub struct WhisperServer {
    child: CommandChild,
    pub port: u16,
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

        let (ready_tx, mut ready_rx) = mpsc::channel::<Result<(), String>>(1);
        let rx_task = tokio::spawn(async move {
            let mut ready_sent = false;
            // Note: whisper-server v1.7.x prints the "listening" banner to
            // STDOUT via printf (examples/server/server.cpp:1030), not stderr.
            // Watch both streams so we don't time out on a perfectly-healthy
            // server.
            let check_ready = |line: &str| -> bool {
                line.contains("listening") || line.contains("Listening")
            };
            while let Some(event) = rx.recv().await {
                match event {
                    CommandEvent::Stderr(bytes) => {
                        let line = String::from_utf8_lossy(&bytes);
                        if !ready_sent && check_ready(&line) {
                            let _ = ready_tx.send(Ok(())).await;
                            ready_sent = true;
                        }
                        eprintln!("[whisper-server] {}", line.trim_end());
                    }
                    CommandEvent::Stdout(bytes) => {
                        let line = String::from_utf8_lossy(&bytes);
                        if !ready_sent && check_ready(&line) {
                            let _ = ready_tx.send(Ok(())).await;
                            ready_sent = true;
                        }
                        eprintln!("[whisper-server] {}", line.trim_end());
                    }
                    CommandEvent::Terminated(payload) => {
                        if !ready_sent {
                            let _ = ready_tx.send(Err(format!(
                                "whisper-server exited before ready (code {:?})",
                                payload.code
                            ))).await;
                        }
                        return;
                    }
                    _ => {}
                }
            }
        });

        match timeout(Duration::from_secs(30), ready_rx.recv()).await {
            Ok(Some(Ok(()))) => Ok(Self { child, port, _rx_task: rx_task }),
            Ok(Some(Err(e))) => Err(e),
            Ok(None) => Err("server channel closed".into()),
            Err(_) => Err("timeout waiting for whisper-server to become ready".into()),
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
