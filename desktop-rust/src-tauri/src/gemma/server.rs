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
    /// Streams via Server-Sent Events (`stream:true` on the llama-server side):
    /// each chunk is `data: {"content":"…", ...}\n\n`. Token count is
    /// approximated by counting `data:`-frames received. The `on_progress`
    /// callback fires throttled (≤ once per 80ms or every 8 frames, whichever
    /// comes first) so the frontend doesn't drown in events.
    ///
    /// We use llama.cpp's native `/completion` endpoint (not OpenAI-compatible
    /// `/v1/chat/completions`) because it's simpler and supports all gguf
    /// models regardless of chat-template quirks.
    pub async fn complete<F>(
        &self,
        prompt: &str,
        n_predict: i32,
        mut on_progress: F,
    ) -> Result<String, String>
    where
        F: FnMut(usize, i32, u64),
    {
        let client = reqwest::Client::new();
        let body = serde_json::json!({
            "prompt": prompt,
            "n_predict": n_predict,
            "temperature": 0.2,
            "top_k": 40,
            "top_p": 0.9,
            "stop": ["<end_of_turn>", "<|endoftext|>", "<eot_id>"],
            "stream": true,
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

        use futures_util::StreamExt;
        let started = Instant::now();
        let mut stream = resp.bytes_stream();
        // Byte-buffer accumulating raw bytes until we can parse a full SSE
        // frame (delimiter is `\n\n`, ASCII so always at a UTF-8 char
        // boundary). Decoding `from_utf8_lossy` per network chunk would
        // mangle a multi-byte char split across two TCP segments — Cyrillic
        // and emoji would come back as `�` (CLAUDE.md §10).
        let mut buf: Vec<u8> = Vec::new();
        let mut content = String::new();
        let mut tokens_done: usize = 0;
        let mut last_emit = Instant::now() - Duration::from_millis(200);
        let mut frames_since_emit: usize = 0;
        const EMIT_INTERVAL: Duration = Duration::from_millis(80);
        const FRAMES_PER_EMIT: usize = 8;

        while let Some(chunk) = stream.next().await {
            let bytes = chunk.map_err(|e| format!("stream chunk: {e}"))?;
            buf.extend_from_slice(&bytes);

            // Drain complete frames (terminated by `\n\n`) from `buf`. The
            // `\n\n` boundary is ASCII, so slicing there can never cut a
            // multi-byte UTF-8 char.
            while let Some(idx) = find_double_newline(&buf) {
                let frame_bytes: Vec<u8> = buf.drain(..idx + 2).collect();
                let frame_str = String::from_utf8_lossy(&frame_bytes);
                let frame = frame_str.trim_end();
                // SSE allows multiple lines per frame; we only care about
                // `data:`-prefixed lines (llama-server emits exactly one per
                // frame).
                let payload = frame.lines()
                    .find_map(|l| l.strip_prefix("data:").map(str::trim))
                    .unwrap_or("");
                if payload.is_empty() { continue; }
                let v: serde_json::Value = match serde_json::from_str(payload) {
                    Ok(v) => v,
                    Err(_) => continue, // ignore malformed frames silently
                };
                if let Some(piece) = v.get("content").and_then(|c| c.as_str()) {
                    content.push_str(piece);
                }
                tokens_done += 1;
                frames_since_emit += 1;

                let stopped = v.get("stop").and_then(|b| b.as_bool()).unwrap_or(false)
                    || v.get("stopped_eos").and_then(|b| b.as_bool()).unwrap_or(false)
                    || v.get("stopped_word").and_then(|b| b.as_bool()).unwrap_or(false)
                    || v.get("stopped_limit").and_then(|b| b.as_bool()).unwrap_or(false);

                let now = Instant::now();
                let due = now.duration_since(last_emit) >= EMIT_INTERVAL
                    || frames_since_emit >= FRAMES_PER_EMIT;
                if due || stopped {
                    let elapsed_ms = now.duration_since(started).as_millis() as u64;
                    on_progress(tokens_done, n_predict, elapsed_ms);
                    last_emit = now;
                    frames_since_emit = 0;
                }
                if stopped {
                    return Ok(content.trim().to_string());
                }
            }
        }
        // Stream ended without an explicit stop frame — return what we got.
        Ok(content.trim().to_string())
    }

    pub fn shutdown(self) {
        let _ = self.child.kill();
    }
}

/// Find the index of the first `\n\n` separator in a byte buffer.
fn find_double_newline(buf: &[u8]) -> Option<usize> {
    buf.windows(2).position(|w| w == b"\n\n")
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

    #[test]
    fn double_newline_finds_first_occurrence() {
        assert_eq!(find_double_newline(b"abc\n\ndef"), Some(3));
        assert_eq!(find_double_newline(b"\n\nx"), Some(0));
        assert_eq!(find_double_newline(b"no separator"), None);
        // Single \n must not match.
        assert_eq!(find_double_newline(b"abc\ndef"), None);
    }

    #[test]
    fn frame_split_across_chunks_preserves_utf8() {
        // Simulate llama-server emitting `data: {"content":"привет"}\n\n`
        // chopped at a multi-byte boundary mid-Cyrillic char.
        let full = "data: {\"content\":\"привет\"}\n\n".as_bytes().to_vec();
        // Cut between bytes of 'и' (2-byte UTF-8 = 0xD0 0xB8). Find the
        // index of 'и' in the original string and split mid-char.
        let split_at = full.windows(2).position(|w| w == [0xD0, 0xB8]).unwrap() + 1;
        let (a, b) = full.split_at(split_at);

        let mut buf: Vec<u8> = Vec::new();
        buf.extend_from_slice(a);
        // Stage 1: only half the chunk is here, no full frame yet.
        assert!(find_double_newline(&buf).is_none());
        buf.extend_from_slice(b);
        // Stage 2: full frame complete; decode the frame and ensure no
        // U+FFFD substitution sneaked in.
        let idx = find_double_newline(&buf).expect("frame complete");
        let frame_bytes: Vec<u8> = buf.drain(..idx + 2).collect();
        let frame = String::from_utf8_lossy(&frame_bytes);
        assert!(frame.contains("привет"), "frame={}", frame);
        assert!(!frame.contains('\u{FFFD}'), "U+FFFD substitution: {}", frame);
    }
}
