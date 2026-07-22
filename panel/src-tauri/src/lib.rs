use std::sync::Mutex;

use serde::Serialize;
use tauri::{ActivationPolicy, AppHandle, Manager, WebviewWindow};
use tauri_nspanel::{
    cocoa::appkit::NSWindowCollectionBehavior, ManagerExt, WebviewWindowExt,
};

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

// ── Room mode (floating room window vs dock NSPanel) ────────────────────
//
// Rust is the mode authority: window visibility IS the mode, transitions
// are serialized behind this mutex, repeats are idempotent, and a failed
// transition rolls back so one window is always visible (Sol #3). The two
// webviews never coordinate through JS — they both just call
// set_room_mode and re-render off daemon snapshots.

#[derive(Clone, Copy, PartialEq)]
enum RoomMode {
    Floating,
    Dock,
}

struct ModeState(Mutex<RoomMode>);

#[allow(non_upper_case_globals)]
const NSFloatWindowLevel: i32 = 4;
#[allow(non_upper_case_globals)]
const NSWindowStyleMaskResizable: i32 = 1 << 3;
#[allow(non_upper_case_globals)]
const NSWindowStyleMaskNonActivatingPanel: i32 = 1 << 7;

/// Today's (pre-4b) whole-app panel policy, now scoped to the dock window:
/// float above normal windows, never steal focus, join every Space
/// including over fullscreen apps. Reasserted on every dock entry —
/// cheap defensive hardening against AppKit state drift on hidden panels.
fn apply_dock_panel_policy(panel: &tauri_nspanel::objc_id::ShareId<tauri_nspanel::raw_nspanel::RawNSPanel>) {
    panel.set_level(NSFloatWindowLevel);
    // set_style_mask REPLACES the whole mask — include Resizable or the
    // window config's `resizable: true` is silently lost.
    panel.set_style_mask(NSWindowStyleMaskResizable | NSWindowStyleMaskNonActivatingPanel);
    panel.set_collection_behaviour(
        NSWindowCollectionBehavior::NSWindowCollectionBehaviorCanJoinAllSpaces
            | NSWindowCollectionBehavior::NSWindowCollectionBehaviorFullScreenAuxiliary,
    );
}

#[tauri::command]
fn set_room_mode(app: AppHandle, mode: String) -> Result<(), String> {
    let target = match mode.as_str() {
        "dock" => RoomMode::Dock,
        "floating" => RoomMode::Floating,
        other => return Err(format!("unknown mode: {other}")),
    };

    let state = app.state::<ModeState>();
    // Mutex held for the whole transition: serialized, no interleaving.
    let mut current = state.0.lock().map_err(|_| "mode lock poisoned")?;
    if *current == target {
        return Ok(()); // idempotent repeat
    }

    let main = app
        .get_webview_window("main")
        .ok_or("main window missing")?;
    let panel = app
        .get_webview_panel("dock")
        .map_err(|e| format!("dock panel missing: {e:?}"))?;

    match target {
        RoomMode::Dock => {
            // Position the dock at its FINAL bottom-center spot on MAIN's
            // monitor before it becomes visible — the hidden dock's own
            // monitor may be a different display (Sol #6), and waiting for
            // the dock webview's layout effect would leave it parked
            // wherever it last was until the next store commit (Sol 4b
            // blocker). The dock realm still refines geometry on later
            // renders (agent-count width changes).
            if let (Ok(Some(monitor)), Some(dock_win)) =
                (main.current_monitor(), app.get_webview_window("dock"))
            {
                let mon_pos = monitor.position();
                let mon_size = monitor.size();
                let dock_size = dock_win
                    .outer_size()
                    .unwrap_or(tauri::PhysicalSize::new(400, 126));
                let gap = (12.0 * monitor.scale_factor()) as i32;
                let x = mon_pos.x + ((mon_size.width as i32 - dock_size.width as i32) / 2).max(0);
                let y = mon_pos.y + mon_size.height as i32 - dock_size.height as i32 - gap;
                let _ = dock_win.set_position(tauri::PhysicalPosition::new(x, y));
            }
            apply_dock_panel_policy(&panel);
            // NEVER the plugin's show() — it makes the panel KEY, which is
            // the exact opposite of a non-activating dock (Sol #3).
            panel.order_front_regardless();
            if !panel.is_visible() {
                return Err("dock panel did not become visible".into());
            }
            if let Err(e) = main.hide() {
                // Roll back: dock away again, main stays the visible one.
                panel.order_out(None);
                return Err(format!("failed to hide main window: {e}"));
            }
            if let Err(e) = app.set_activation_policy(ActivationPolicy::Accessory) {
                // Policy failed → restore the floating world entirely so
                // ModeState never disagrees with what's on screen (Sol 4b
                // major: no partial commits).
                let _ = main.show();
                let _ = main.set_focus();
                panel.order_out(None);
                return Err(format!("failed to set Accessory policy: {e}"));
            }
            *current = RoomMode::Dock;
        }
        RoomMode::Floating => {
            if let Err(e) = app.set_activation_policy(ActivationPolicy::Regular) {
                return Err(format!("failed to set Regular policy: {e}"));
            }
            if let Err(e) = main.show() {
                // Roll back the policy; the dock stays up.
                let _ = app.set_activation_policy(ActivationPolicy::Accessory);
                return Err(format!("failed to show main window: {e}"));
            }
            // User-initiated transition → focus the room (best-effort:
            // a focus failure is cosmetic, not a state inconsistency).
            let _ = main.set_focus();
            panel.order_out(None);
            *current = RoomMode::Floating;
        }
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_nspanel::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![ws_token, set_room_mode])
        .manage(ModeState(Mutex::new(RoomMode::Floating)))
        .setup(|app| {
            // Floating room is primary at launch: normal app presence
            // (Dock icon, ⌘-Tab, activates on click). Accessory only while
            // in dock mode — role-aware per the Phase 4 spec.
            app.set_activation_policy(ActivationPolicy::Regular);

            // Convert the (hidden) dock window into a real NSPanel exactly
            // once; it carries the old whole-app float policy from here on.
            let dock: WebviewWindow = app
                .get_webview_window("dock")
                .expect("dock window missing from tauri.conf.json");
            let panel = dock.to_panel().expect("dock to_panel failed");
            apply_dock_panel_policy(&panel);

            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing the floating room quits the app — otherwise the
            // hidden dock window keeps the process alive forever.
            if window.label() == "main" {
                if let tauri::WindowEvent::CloseRequested { .. } = event {
                    window.app_handle().exit(0);
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
