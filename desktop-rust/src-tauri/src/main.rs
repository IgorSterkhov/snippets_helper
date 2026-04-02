#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::Write;

fn main() {
    // Log panics and errors to file (Windows hides console output in release)
    let log_path = dirs::data_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("keyboard-helper")
        .join("crash.log");
    let _ = std::fs::create_dir_all(log_path.parent().unwrap());

    std::panic::set_hook(Box::new(move |info| {
        let _ = std::fs::write(&log_path, format!("{}\n", info));
    }));

    keyboard_helper::run();
}
