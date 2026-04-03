#[tauri::command]
pub fn get_changelog() -> String {
    include_str!("../../../CHANGELOG.md").to_string()
}
