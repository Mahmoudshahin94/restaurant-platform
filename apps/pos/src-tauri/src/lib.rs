//! Native shell of the POS. Business rules live in the TypeScript domain package; this crate only
//! hosts the web UI and exposes device capabilities (more arrive with printing and the local hub).

use serde::Serialize;
use std::time::Duration;

pub mod printing;
pub mod secure_store;

/// Facts about the running build and host, shown on the POS status bar and sent with device
/// registration so support can see what is installed where.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub version: String,
    pub os: String,
    pub arch: String,
}

pub fn app_info_for(version: &str) -> AppInfo {
    AppInfo {
        version: version.to_owned(),
        os: std::env::consts::OS.to_owned(),
        arch: std::env::consts::ARCH.to_owned(),
    }
}

#[tauri::command]
fn app_info(app: tauri::AppHandle) -> AppInfo {
    app_info_for(&app.package_info().version.to_string())
}

/// Sends a raw ESC/POS job to a network printer. Runs off the UI thread; errors are returned
/// as text for the UI to show.
#[tauri::command]
async fn print_raw(host: String, port: u16, data: Vec<u8>) -> Result<(), String> {
    printing::validate_target(&host, port, data.len()).map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        printing::send_raw(&host, port, &data, Duration::from_secs(5))
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())
}

/// The refresh token kept in OS secure storage, read once when the POS starts.
#[tauri::command]
fn secure_token_get() -> Result<Option<String>, String> {
    secure_store::read().map_err(|e| e.to_string())
}

/// Stores the rotated refresh token, or removes it (`null`) on sign-out.
#[tauri::command]
fn secure_token_set(token: Option<String>) -> Result<(), String> {
    secure_store::write(token.as_deref()).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            app_info,
            print_raw,
            secure_token_get,
            secure_token_set
        ])
        .run(tauri::generate_context!())
        .expect("error while running the POS application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn app_info_reports_version_and_host() {
        let info = app_info_for("1.2.3");
        assert_eq!(info.version, "1.2.3");
        assert!(!info.os.is_empty());
        assert!(!info.arch.is_empty());
    }

    #[test]
    fn app_info_serializes_camel_case() {
        let json = serde_json::to_value(app_info_for("0.1.0")).expect("serializable");
        assert_eq!(json["version"], "0.1.0");
        assert!(json.get("os").is_some());
    }
}
