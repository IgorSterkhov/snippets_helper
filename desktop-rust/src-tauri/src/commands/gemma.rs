//! Tauri commands for the local Gemma post-processing sidecar.

use tauri::{AppHandle, Manager, State};

use crate::gemma::{catalog::{self, ModelMeta}, models, service::{GemmaService, InstalledModel}};

#[tauri::command]
pub fn gemma_list_catalog() -> Vec<ModelMeta> {
    catalog::CATALOG.to_vec()
}

#[tauri::command]
pub fn gemma_list_models(app: AppHandle) -> Result<Vec<InstalledModel>, String> {
    let app_data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(crate::gemma::service::list_installed(&app_data))
}

#[tauri::command]
pub async fn gemma_install_model(app: AppHandle, name: String) -> Result<(), String> {
    let app_data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let meta = catalog::find(&name).ok_or_else(|| format!("unknown model: {name}"))?;
    models::download_and_install(&app, &app_data, meta).await?;
    // If no default yet, make this one the default.
    if crate::gemma::service::read_default_model(&app_data).is_none() {
        let _ = crate::gemma::service::write_default_model(&app_data, &name);
    }
    Ok(())
}

#[tauri::command]
pub fn gemma_delete_model(app: AppHandle, name: String) -> Result<(), String> {
    let app_data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let path = models::model_path(&app_data, &name);
    if path.exists() {
        std::fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    // If we just deleted the default, clear the pointer.
    if crate::gemma::service::read_default_model(&app_data).as_deref() == Some(&name) {
        let _ = std::fs::remove_file(app_data.join("gemma-default.txt"));
    }
    Ok(())
}

#[tauri::command]
pub async fn gemma_set_default_model(
    svc: State<'_, GemmaService>,
    app: AppHandle,
    name: String,
) -> Result<(), String> {
    let app_data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    crate::gemma::service::write_default_model(&app_data, &name).map_err(|e| e.to_string())?;
    svc.set_default_model(&name).await
}

#[tauri::command]
pub async fn gemma_postprocess(
    svc: State<'_, GemmaService>,
    text: String,
) -> Result<String, String> {
    svc.postprocess(&text).await
}

#[tauri::command]
pub async fn gemma_unload_now(svc: State<'_, GemmaService>) -> Result<(), String> {
    svc.unload_now().await;
    Ok(())
}
