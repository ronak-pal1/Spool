#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod capture;
mod commands;
mod devices;
mod geom;
mod input;
mod overlay;
mod session;
mod upload;

use std::sync::{Arc, Mutex};
use std::time::Duration;

use tauri::Manager;

use session::{AppState, Session};

fn main() {
    let http = reqwest::Client::builder()
        .user_agent("spool-desktop/1.0.0")
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(180))
        .build()
        .expect("http client");
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(AppState {
            session: Arc::new(Mutex::new(Session::new())),
            http,
        })
        .setup(|app| {
            overlay::install(app.handle()).map_err(std::io::Error::other)?;
            input::start(app.state::<AppState>().session.clone());
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                loop {
                    tokio::time::sleep(Duration::from_millis(200)).await;
                    commands::tick(&handle);
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_sources,
            commands::list_audio_devices,
            commands::start_recording,
            commands::pause_recording,
            commands::resume_recording,
            commands::set_mic_muted,
            commands::set_system_muted,
            commands::stop_recording,
            commands::discard_recording,
            commands::restart_recording,
            commands::retry_upload,
            commands::recording_snapshot,
            commands::prepare_area_select,
            commands::cancel_area_select,
            commands::complete_area_select,
            commands::camera_config,
            commands::set_camera_size,
            commands::set_camera_click_through,
            commands::set_draw_enabled,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Spool");
}
