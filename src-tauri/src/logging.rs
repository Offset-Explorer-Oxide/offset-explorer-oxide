use serde::Serialize;
use tauri::{AppHandle, Emitter};

#[derive(Debug, Clone, Serialize)]
pub struct LogEntry {
    pub timestamp: String,
    pub level: String,
    pub message: String,
}

pub fn emit_log(app: &AppHandle, level: &str, message: impl Into<String>) {
    let entry = LogEntry {
        timestamp: chrono::Utc::now().to_rfc3339(),
        level: level.to_string(),
        message: message.into(),
    };
    let _ = app.emit("log", entry);
}
