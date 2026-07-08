use serde::Serialize;
use tauri::{Manager, WebviewWindow};
use tauri_nspanel::{cocoa::appkit::NSWindowCollectionBehavior, WebviewWindowExt};

#[derive(Serialize)]
pub struct WsConfig {
    token: String,
    port: u16,
}

#[tauri::command]
fn ws_token() -> Result<WsConfig, String> {
    let home = dirs::home_dir().ok_or("no home directory")?;
    let tts = home.join(".cursor").join("tts");
    let token = std::fs::read_to_string(tts.join("panel_ws_token"))
        .map(|s| s.trim().to_string())
        .map_err(|e| e.to_string())?;
    let port = std::fs::read_to_string(tts.join("config.json"))
        .ok()
        .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
        .and_then(|v| v.get("panel_port").and_then(|p| p.as_u64()))
        .unwrap_or(4780) as u16;
    Ok(WsConfig { token, port })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_nspanel::init())
        .invoke_handler(tauri::generate_handler![ws_token])
        .setup(|app| {
            // Keep the panel out of the Dock / app switcher — it's a menu-bar
            // companion widget, and Accessory reinforces "never steal focus".
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            // Convert the window into a real NSPanel (call to_panel only once).
            let window: WebviewWindow = app.get_webview_window("main").unwrap();
            let panel = window.to_panel().unwrap();

            // Float above normal windows.
            #[allow(non_upper_case_globals)]
            const NSFloatWindowLevel: i32 = 4;
            panel.set_level(NSFloatWindowLevel);

            // Non-activating: clicking a card never steals focus from the editor.
            // set_style_mask REPLACES the whole mask — include Resizable or
            // tauri.conf's `resizable: true` is silently lost.
            #[allow(non_upper_case_globals)]
            const NSWindowStyleMaskResizable: i32 = 1 << 3;
            #[allow(non_upper_case_globals)]
            const NSWindowStyleMaskNonActivatingPanel: i32 = 1 << 7;
            panel.set_style_mask(NSWindowStyleMaskResizable | NSWindowStyleMaskNonActivatingPanel);

            // Visible on all Spaces, including over fullscreen apps.
            panel.set_collection_behaviour(
                NSWindowCollectionBehavior::NSWindowCollectionBehaviorCanJoinAllSpaces
                    | NSWindowCollectionBehavior::NSWindowCollectionBehaviorFullScreenAuxiliary,
            );

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
