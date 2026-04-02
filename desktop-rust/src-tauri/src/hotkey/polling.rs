use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tauri::Manager;

static RUNNING: AtomicBool = AtomicBool::new(false);

pub fn start_polling(app_handle: tauri::AppHandle, mode: &str) -> Result<(), String> {
    if RUNNING.load(Ordering::SeqCst) {
        return Ok(());
    }
    RUNNING.store(true, Ordering::SeqCst);

    let handle = app_handle.clone();
    let detect_key = match mode {
        "double_shift" => rdev::Key::ShiftLeft,
        "double_ctrl" => rdev::Key::ControlLeft,
        _ => return Err(format!("Unknown polling mode: {}", mode)),
    };

    std::thread::spawn(move || {
        let last_press = Arc::new(Mutex::new(Instant::now()));
        let press_count = Arc::new(Mutex::new(0u32));

        let last_press_c = Arc::clone(&last_press);
        let press_count_c = Arc::clone(&press_count);
        let handle_c = handle;

        rdev::listen(move |event| {
            if !RUNNING.load(Ordering::SeqCst) {
                return;
            }

            if let rdev::EventType::KeyPress(key) = event.event_type {
                let is_target = key == detect_key
                    || (detect_key == rdev::Key::ShiftLeft && key == rdev::Key::ShiftRight)
                    || (detect_key == rdev::Key::ControlLeft && key == rdev::Key::ControlRight);

                if is_target {
                    let now = Instant::now();
                    let mut lp = last_press_c.lock().unwrap();
                    let mut pc = press_count_c.lock().unwrap();

                    if now.duration_since(*lp).as_millis() < 300 {
                        *pc += 1;
                    } else {
                        *pc = 1;
                    }
                    *lp = now;

                    if *pc >= 2 {
                        *pc = 0;
                        if let Some(window) = handle_c.get_webview_window("main") {
                            let visible = window.is_visible().unwrap_or(false);
                            if visible {
                                let _ = window.hide();
                            } else {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                    }
                } else {
                    let mut pc = press_count_c.lock().unwrap();
                    *pc = 0;
                }
            }
        })
        .ok();
    });

    Ok(())
}

pub fn stop_polling() {
    RUNNING.store(false, Ordering::SeqCst);
}
