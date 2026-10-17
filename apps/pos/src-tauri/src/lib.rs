//! Native shell of the POS. Business rules live in the TypeScript domain package; this crate only
//! hosts the web UI and exposes device capabilities (more arrive with printing and the local hub).

use serde::Serialize;

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![app_info])
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
