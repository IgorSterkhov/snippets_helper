use tauri::Manager;

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
        .invoke_handler(tauri::generate_handler![
            commands::settings::get_setting,
            commands::settings::set_setting,
            commands::settings::hide_and_sync,
            commands::shortcuts::list_shortcuts,
            commands::shortcuts::search_shortcuts,
            commands::shortcuts::create_shortcut,
            commands::shortcuts::update_shortcut,
            commands::shortcuts::delete_shortcut,
            clipboard::copy_to_clipboard,
            clipboard::read_clipboard,
            commands::sync_cmd::trigger_sync,
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
            // Autostart
            autostart::set_autostart,
            autostart::get_autostart,
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
            drop(conn);

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
        .run(tauri::generate_context!())
        .unwrap_or_else(|e| write_log(&format!("Tauri run error: {}", e)));
}
