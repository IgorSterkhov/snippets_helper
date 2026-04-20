use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::io::Cursor;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};
use zip::ZipArchive;

const MANIFEST_URL: &str =
    "https://github.com/IgorSterkhov/snippets_helper/releases/latest/download/frontend-version.json";

const PUBKEY: &str = "RWQIAfv24WJYN4VY0nJkvvd5fgcvRosIskA34G9GtS9S+B9XnAzVp08W";

const BUNDLED_VERSION_ASSET: &str = "frontend-version.json";

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ManifestInfo {
    pub version: String,
    pub url: String,
    pub signature: String,
    #[serde(default)]
    pub sha256: String,
}

#[derive(Debug, Serialize)]
pub struct FrontendUpdateStatus {
    pub current_version: String,
    pub latest_version: String,
    pub has_update: bool,
    pub url: Option<String>,
    pub signature: Option<String>,
    pub sha256: Option<String>,
}

fn app_data_root(app: &AppHandle) -> Result<PathBuf, String> {
    let root = app.path().app_data_dir().map_err(|e| e.to_string())?;
    if !root.exists() {
        fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    }
    Ok(root)
}

fn pointer_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_data_root(app)?.join("frontend-current.txt"))
}

fn prev_pointer_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_data_root(app)?.join("frontend-prev.txt"))
}

fn tentative_pointer_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_data_root(app)?.join("frontend-tentative.txt"))
}

fn frontend_dir_for(root: &Path, version: &str) -> PathBuf {
    root.join(format!("frontend-{}", version))
}

fn read_trimmed_string(path: &Path) -> Option<String> {
    fs::read_to_string(path).ok().map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}

pub fn current_frontend_version(app: &AppHandle) -> String {
    if let Ok(pp) = pointer_path(app) {
        if let Some(v) = read_trimmed_string(&pp) {
            let dir = frontend_dir_for(&app.path().app_data_dir().unwrap_or_default(), &v);
            if dir.join("index.html").exists() {
                return v;
            }
        }
    }
    bundled_frontend_version(app)
}

fn bundled_frontend_version(app: &AppHandle) -> String {
    if let Some(asset) = app.asset_resolver().get(BUNDLED_VERSION_ASSET.to_string()) {
        if let Ok(s) = std::str::from_utf8(&asset.bytes) {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(s) {
                if let Some(ver) = v.get("version").and_then(|x| x.as_str()) {
                    return ver.to_string();
                }
            }
        }
    }
    String::new()
}

pub fn override_frontend_dir(app: &AppHandle) -> Option<PathBuf> {
    let pp = pointer_path(app).ok()?;
    let v = read_trimmed_string(&pp)?;
    let dir = frontend_dir_for(&app_data_root(app).ok()?, &v);
    if dir.join("index.html").exists() { Some(dir) } else { None }
}

#[tauri::command]
pub fn get_frontend_version(app: AppHandle) -> String {
    current_frontend_version(&app)
}

#[tauri::command]
pub async fn check_frontend_update(app: AppHandle) -> Result<FrontendUpdateStatus, String> {
    let current = current_frontend_version(&app);
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;
    let res = client.get(MANIFEST_URL).send().await.map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("HTTP {} for manifest", res.status()));
    }
    let text = res.text().await.map_err(|e| e.to_string())?;
    let info: ManifestInfo = serde_json::from_str(&text)
        .map_err(|e| format!("Invalid manifest: {}", e))?;
    let has_update = !current.is_empty() && info.version != current;
    Ok(FrontendUpdateStatus {
        current_version: current,
        latest_version: info.version.clone(),
        has_update,
        url: if has_update { Some(info.url) } else { None },
        signature: if has_update { Some(info.signature) } else { None },
        sha256: if has_update { Some(info.sha256) } else { None },
    })
}

fn verify_signature(data: &[u8], signature: &str) -> Result<(), String> {
    if signature.is_empty() {
        return Ok(());
    }
    use base64::{Engine as _, engine::general_purpose::STANDARD};
    use minisign_verify::{PublicKey, Signature};
    // Signature is transported as base64 of the raw .sig file contents.
    let sig_text = match STANDARD.decode(signature.trim()) {
        Ok(decoded) => String::from_utf8(decoded).map_err(|e| format!("Bad signature UTF-8: {}", e))?,
        Err(_) => signature.to_string(),
    };
    let pk = PublicKey::from_base64(PUBKEY).map_err(|e| format!("Bad pubkey: {}", e))?;
    let sig = Signature::decode(&sig_text).map_err(|e| format!("Bad signature: {}", e))?;
    pk.verify(data, &sig, true).map_err(|e| format!("Signature verification failed: {}", e))
}

fn verify_sha256(data: &[u8], expected_hex: &str) -> Result<(), String> {
    if expected_hex.is_empty() {
        return Ok(());
    }
    let mut hasher = Sha256::new();
    hasher.update(data);
    let got = hex::encode(hasher.finalize());
    if got.eq_ignore_ascii_case(expected_hex) {
        Ok(())
    } else {
        Err(format!("Hash mismatch: got {} expected {}", got, expected_hex))
    }
}

fn extract_zip(zip_bytes: &[u8], dest: &Path) -> Result<(), String> {
    if dest.exists() {
        fs::remove_dir_all(dest).map_err(|e| e.to_string())?;
    }
    fs::create_dir_all(dest).map_err(|e| e.to_string())?;
    let mut archive = ZipArchive::new(Cursor::new(zip_bytes)).map_err(|e| e.to_string())?;
    for i in 0..archive.len() {
        let mut f = archive.by_index(i).map_err(|e| e.to_string())?;
        let rel = match f.enclosed_name() {
            Some(p) => p.to_path_buf(),
            None => continue,
        };
        let out = dest.join(&rel);
        if f.is_dir() {
            fs::create_dir_all(&out).map_err(|e| e.to_string())?;
            continue;
        }
        if let Some(parent) = out.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let mut writer = fs::File::create(&out).map_err(|e| e.to_string())?;
        std::io::copy(&mut f, &mut writer).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn download_frontend_update(
    app: AppHandle,
    url: String,
    version: String,
    signature: String,
    sha256: Option<String>,
) -> Result<(), String> {
    if version.is_empty() || version.contains('/') || version.contains('\\') {
        return Err("Invalid version".to_string());
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| e.to_string())?;
    let res = client.get(&url).send().await.map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("HTTP {} for zip", res.status()));
    }
    let bytes = res.bytes().await.map_err(|e| e.to_string())?.to_vec();

    verify_signature(&bytes, &signature)?;
    if let Some(hash) = sha256.as_deref() {
        verify_sha256(&bytes, hash)?;
    }

    let root = app_data_root(&app)?;
    let dest = frontend_dir_for(&root, &version);
    extract_zip(&bytes, &dest)?;

    if !dest.join("index.html").exists() {
        fs::remove_dir_all(&dest).ok();
        return Err("Zip missing index.html".to_string());
    }
    Ok(())
}

#[tauri::command]
pub async fn apply_frontend_update(app: AppHandle, version: String) -> Result<(), String> {
    let root = app_data_root(&app)?;
    let dest = frontend_dir_for(&root, &version);
    if !dest.join("index.html").exists() {
        return Err(format!("frontend-{} not prepared", version));
    }

    let pointer = pointer_path(&app)?;
    let prev_pointer = prev_pointer_path(&app)?;
    let tentative = tentative_pointer_path(&app)?;

    if let Some(old) = read_trimmed_string(&pointer) {
        if old != version {
            let _ = fs::write(&prev_pointer, &old);
        }
    }
    fs::write(&pointer, &version).map_err(|e| e.to_string())?;
    // Mark this boot as tentative. Next startup's watchdog will auto-revert
    // if confirm_frontend_boot is not called within the grace period.
    fs::write(&tentative, &version).map_err(|e| e.to_string())?;

    cleanup_old_frontends(&root, &version)?;

    if let Some(window) = app.get_webview_window("main") {
        let _ = window.eval("window.location.reload()");
    }
    Ok(())
}

/// Called by the frontend once it has successfully booted. Clears the
/// "tentative" flag so the watchdog doesn't revert this version.
#[tauri::command]
pub fn confirm_frontend_boot(app: AppHandle) -> Result<(), String> {
    let tentative = tentative_pointer_path(&app)?;
    if tentative.exists() {
        fs::remove_file(&tentative).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Runs once at startup when a tentative frontend pointer is present.
/// Sleeps for the grace period; if the pointer is still there (frontend
/// never confirmed a successful boot), reverts to the previous version
/// and reloads the window. Safe-to-call at every startup — no-op when
/// there is nothing tentative.
pub fn spawn_boot_watchdog(app: AppHandle) {
    let tentative = match tentative_pointer_path(&app) {
        Ok(p) => p,
        Err(_) => return,
    };
    if !tentative.exists() {
        return;
    }
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(30)).await;
        if !tentative.exists() {
            return; // Confirmed in time, no rollback needed.
        }
        eprintln!("[ota] tentative boot not confirmed within 30s — rolling back");
        let _ = fs::remove_file(&tentative);
        let root = match app_data_root(&app) {
            Ok(r) => r,
            Err(_) => return,
        };
        let prev = match read_trimmed_string(&root.join("frontend-prev.txt")) {
            Some(v) => v,
            None => {
                // No previous version — drop the override entirely so the
                // bundled frontend is used on next launch.
                if let Ok(p) = pointer_path(&app) {
                    let _ = fs::remove_file(&p);
                }
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.eval("window.location.reload()");
                }
                return;
            }
        };
        let prev_dir = frontend_dir_for(&root, &prev);
        if prev_dir.join("index.html").exists() {
            if let Ok(pp) = pointer_path(&app) {
                let _ = fs::write(&pp, &prev);
            }
            let _ = fs::remove_file(&root.join("frontend-prev.txt"));
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.eval("window.location.reload()");
            }
        } else if let Ok(pp) = pointer_path(&app) {
            // Previous folder gone too — drop override to fall back to bundled.
            let _ = fs::remove_file(&pp);
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.eval("window.location.reload()");
            }
        }
    });
}

fn cleanup_old_frontends(root: &Path, keep_version: &str) -> Result<(), String> {
    let prev = read_trimmed_string(&root.join("frontend-prev.txt")).unwrap_or_default();
    let keep_current = format!("frontend-{}", keep_version);
    let keep_prev = format!("frontend-{}", prev);
    let entries = fs::read_dir(root).map_err(|e| e.to_string())?;
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if !name.starts_with("frontend-") || name.ends_with(".txt") {
            continue;
        }
        if name == keep_current || (!prev.is_empty() && name == keep_prev) {
            continue;
        }
        let _ = fs::remove_dir_all(entry.path());
    }
    Ok(())
}

#[tauri::command]
pub async fn revert_frontend(app: AppHandle) -> Result<String, String> {
    let root = app_data_root(&app)?;
    let prev = read_trimmed_string(&prev_pointer_path(&app)?)
        .ok_or_else(|| "No previous frontend version".to_string())?;
    let dest = frontend_dir_for(&root, &prev);
    if !dest.join("index.html").exists() {
        return Err(format!("frontend-{} missing on disk", prev));
    }
    fs::write(pointer_path(&app)?, &prev).map_err(|e| e.to_string())?;
    fs::remove_file(prev_pointer_path(&app)?).ok();
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.eval("window.location.reload()");
    }
    Ok(prev)
}

#[tauri::command]
pub async fn drop_frontend_override(app: AppHandle) -> Result<(), String> {
    let pointer = pointer_path(&app)?;
    if pointer.exists() {
        fs::remove_file(&pointer).map_err(|e| e.to_string())?;
    }
    let prev = prev_pointer_path(&app)?;
    if prev.exists() {
        fs::remove_file(&prev).map_err(|e| e.to_string())?;
    }
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.eval("window.location.reload()");
    }
    Ok(())
}
