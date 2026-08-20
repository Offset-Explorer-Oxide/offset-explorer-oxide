use crate::commands::connections::CommandError;
use crate::state::AppState;
use kafkaoxide_db::tabs::Tab;
use tauri::State;

#[tauri::command]
pub async fn tab_list(state: State<'_, AppState>) -> Result<Vec<Tab>, CommandError> {
    Ok(kafkaoxide_db::tabs::list(&state.pool).await?)
}

#[tauri::command]
pub async fn tab_create(state: State<'_, AppState>, name: String) -> Result<Tab, CommandError> {
    Ok(kafkaoxide_db::tabs::create(&state.pool, &name).await?)
}

#[tauri::command]
pub async fn tab_rename(
    state: State<'_, AppState>,
    id: String,
    name: String,
) -> Result<(), CommandError> {
    Ok(kafkaoxide_db::tabs::rename(&state.pool, &id, &name).await?)
}

#[tauri::command]
pub async fn tab_delete(state: State<'_, AppState>, id: String) -> Result<(), CommandError> {
    Ok(kafkaoxide_db::tabs::delete(&state.pool, &id).await?)
}

#[tauri::command]
pub async fn tab_reorder(state: State<'_, AppState>, ids: Vec<String>) -> Result<(), CommandError> {
    Ok(kafkaoxide_db::tabs::reorder(&state.pool, &ids).await?)
}
