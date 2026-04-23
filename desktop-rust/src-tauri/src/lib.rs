use tauri::{Manager, WindowEvent};
use tauri::http::{Response, StatusCode};

mod db;
mod commands;
mod handlers;
mod clipboard;
mod tray;
mod hotkey;
mod sync;
mod autostart;

fn write_log(msg: &str) {
    let log_path = dirs::data_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("keyboard-helper")
        .join("crash.log");
    let _ = std::fs::write(&log_path, format!("{}\n", msg));
}

pub fn run() {
    let db = match db::init_db() {
        Ok(db) => db,
        Err(e) => {
            write_log(&format!("Failed to initialize database: {}", e));
            return;
        }
    };

    tauri::Builder::default()
        .manage(db)
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .register_uri_scheme_protocol("khapp", |ctx, req| {
            let app = ctx.app_handle();
            let uri = req.uri().to_string();
            let path = uri
                .split_once("://")
                .map(|(_, rest)| rest)
                .unwrap_or(&uri);
            let path = path.split_once('/').map(|(_, p)| p).unwrap_or("");
            let path = path.split('?').next().unwrap_or(path);
            let path = path.split('#').next().unwrap_or(path);
            let path = if path.is_empty() { "index.html".to_string() } else { path.to_string() };

            // Try override directory first
            if let Some(dir) = commands::ota::override_frontend_dir(app) {
                let candidate = dir.join(&path);
                if candidate.exists() && candidate.is_file() {
                    if let Ok(bytes) = std::fs::read(&candidate) {
                        let mime = mime_for(&path);
                        return Response::builder()
                            .status(StatusCode::OK)
                            .header("Content-Type", mime)
                            .header("Access-Control-Allow-Origin", "*")
                            .body(bytes)
                            .unwrap();
                    }
                }
            }

            // Fallback to bundled
            if let Some(asset) = app.asset_resolver().get(path.clone()) {
                let mime = if asset.mime_type.is_empty() { mime_for(&path).to_string() } else { asset.mime_type };
                return Response::builder()
                    .status(StatusCode::OK)
                    .header("Content-Type", mime)
                    .header("Access-Control-Allow-Origin", "*")
                    .body(asset.bytes)
                    .unwrap();
            }

            Response::builder()
                .status(StatusCode::NOT_FOUND)
                .body(format!("Not found: {}", path).into_bytes())
                .unwrap()
        })
        .invoke_handler(tauri::generate_handler![
            commands::settings::get_setting,
            commands::settings::set_setting,
            commands::settings::set_always_on_top,
            commands::settings::hide_and_sync,
            commands::shortcuts::list_shortcuts,
            commands::shortcuts::search_shortcuts,
            commands::shortcuts::create_shortcut,
            commands::shortcuts::update_shortcut,
            commands::shortcuts::delete_shortcut,
            commands::shortcuts::list_snippet_tags,
            commands::shortcuts::create_snippet_tag,
            commands::shortcuts::update_snippet_tag,
            commands::shortcuts::delete_snippet_tag,
            commands::shortcuts::filter_shortcuts,
            commands::shortcuts::open_link_window,
            commands::shortcuts::list_obsidian_vaults,
            commands::shortcuts::list_obsidian_folders,
            commands::shortcuts::list_obsidian_files,
            commands::shortcuts::create_obsidian_note,
            commands::shortcuts::read_obsidian_note,
            commands::shortcuts::link_obsidian_note,
            clipboard::copy_to_clipboard,
            clipboard::open_url,
            clipboard::read_clipboard,
            commands::sync_cmd::trigger_sync,
            commands::sync_cmd::register_sync,
            commands::sync_cmd::check_sync_health,
            commands::sync_cmd::check_for_update,
            commands::sync_cmd::debug_sync,
            commands::sync_cmd::force_full_sync,
            commands::notes::list_note_folders,
            commands::notes::create_note_folder,
            commands::notes::update_note_folder,
            commands::notes::delete_note_folder,
            commands::notes::list_notes,
            commands::notes::create_note,
            commands::notes::update_note,
            commands::notes::delete_note,
            commands::sql_tools::parse_sql_tables,
            commands::sql_tools::format_sql,
            commands::sql_tools::obfuscate_sql,
            commands::sql_tools::analyze_ddl,
            commands::sql_tools::generate_macros,
            commands::sql_tools::list_analyzer_templates,
            commands::sql_tools::create_analyzer_template,
            commands::sql_tools::delete_analyzer_template,
            commands::sql_tools::list_macrosing_templates,
            commands::sql_tools::create_macrosing_template,
            commands::sql_tools::update_macrosing_template,
            commands::sql_tools::delete_macrosing_template,
            // Superset
            commands::superset::extract_superset_zip,
            commands::superset::validate_superset_report,
            commands::superset::parse_superset_sql,
            // Commits
            commands::commits::list_commit_history,
            commands::commits::create_commit_history,
            commands::commits::delete_commit_history,
            commands::commits::list_commit_tags,
            commands::commits::create_commit_tag,
            commands::commits::delete_commit_tag,
            // Exec
            commands::exec::list_exec_categories,
            commands::exec::create_exec_category,
            commands::exec::update_exec_category,
            commands::exec::delete_exec_category,
            commands::exec::list_exec_commands,
            commands::exec::create_exec_command,
            commands::exec::update_exec_command,
            commands::exec::delete_exec_command,
            commands::exec::run_command,
            commands::exec::stop_command,
            // Help
            commands::help::get_changelog,
            // Repo Search
            commands::repo_search::list_repos,
            commands::repo_search::add_repo,
            commands::repo_search::remove_repo,
            commands::repo_search::update_repo,
            commands::repo_search::list_repo_groups,
            commands::repo_search::add_repo_group,
            commands::repo_search::update_repo_group,
            commands::repo_search::remove_repo_group,
            commands::repo_search::search_filenames,
            commands::repo_search::search_content,
            commands::repo_search::search_git_history,
            commands::repo_search::get_file_context,
            commands::repo_search::open_in_editor,
            commands::repo_search::read_full_file,
            commands::repo_search::repo_search_status,
            commands::repo_search::repo_search_pull_main,
            commands::repo_search::repo_search_reset_hard,
            commands::repo_search::repo_search_commit_diff,
            // VPS
            commands::vps::list_vps_servers,
            commands::vps::add_vps_server,
            commands::vps::update_vps_server,
            commands::vps::remove_vps_server,
            commands::vps::move_vps_server,
            commands::vps::vps_get_stats,
            commands::vps::vps_test_connection,
            commands::vps::list_vps_environments,
            commands::vps::add_vps_environment,
            commands::vps::rename_vps_environment,
            commands::vps::remove_vps_environment,
            commands::vps::reorder_vps_environments,
            // Autostart
            autostart::set_autostart,
            autostart::get_autostart,
            // OTA (frontend)
            commands::ota::get_frontend_version,
            commands::ota::check_frontend_update,
            commands::ota::download_frontend_update,
            commands::ota::apply_frontend_update,
            commands::ota::revert_frontend,
            commands::ota::drop_frontend_override,
            commands::ota::confirm_frontend_boot,
        ])
        .setup(|app| {
            tray::create_tray(app)?;

            // Read hotkey mode from settings
            let db = app.state::<db::DbState>();
            let conn = db.0.lock().unwrap();
            let computer_id = hostname::get()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string();
            let hotkey_mode = db::queries::get_setting(&conn, &computer_id, "hotkey")
                .ok()
                .flatten()
                .unwrap_or_else(|| "alt_space".to_string());

            // Apply always_on_top setting
            if let Some(window) = app.get_webview_window("main") {
                let aot = db::queries::get_setting(&conn, &computer_id, "always_on_top")
                    .ok().flatten().unwrap_or_else(|| "1".to_string());
                let _ = window.set_always_on_top(aot == "1");
            }

            drop(conn);

            // Debug escape hatch: force the window visible on startup.
            // Useful for headless / CI screenshot tests and for users who
            // can't trigger the global hotkey in their environment.
            if std::env::var("KH_FORCE_SHOW").is_ok() {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.set_focus();
                }
            }

            // If the previous session applied a frontend update that never
            // confirmed a successful boot, roll back before the new JS has
            // a chance to break things again.
            commands::ota::spawn_boot_watchdog(app.handle().clone());

            match hotkey_mode.as_str() {
                "double_shift" | "double_ctrl" => {
                    hotkey::polling::start_polling(app.handle().clone(), &hotkey_mode)
                        .map_err(|e| Box::<dyn std::error::Error>::from(e))?;
                }
                _ => {
                    hotkey::native::register_hotkey(app)?;
                }
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                // Only hide to tray for the main window; let link windows close normally
                if window.label() == "main" {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .run(tauri::generate_context!())
        .unwrap_or_else(|e| write_log(&format!("Tauri run error: {}", e)));
}

fn mime_for(path: &str) -> &'static str {
    let lower = path.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    match lower.as_str() {
        "html" | "htm" => "text/html; charset=utf-8",
        "js" | "mjs" => "application/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" => "application/json; charset=utf-8",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "ico" => "image/x-icon",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "txt" => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}
