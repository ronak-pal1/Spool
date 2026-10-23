//! Floating recorder windows. Draw and camera are not content-protected, so
//! ffmpeg records them. The bar and the main window are protected, and the
//! main window is hidden for the take because content protection is unreliable.

use tauri::{AppHandle, LogicalPosition, LogicalSize, Manager, WebviewUrl, WebviewWindowBuilder};

use crate::geom::{layout_overlays, CameraSize, CaptureGeometry, RectF};

const OVERLAYS: [&str; 4] = ["bar", "camera", "area", "draw"];

pub fn install(app: &AppHandle) -> Result<(), String> {
    build(app, "bar", 640.0, 88.0, true)?;
    build(app, "camera", 196.0, 196.0, false)?;
    build(app, "area", 800.0, 600.0, false)?;
    build(app, "draw", 800.0, 600.0, false)?;
    if let Some(draw) = app.get_webview_window("draw") {
        let _ = draw.set_ignore_cursor_events(true);
    }
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.set_content_protected(true);
    }
    Ok(())
}

fn build(app: &AppHandle, label: &str, width: f64, height: f64, protected: bool) -> Result<(), String> {
    if app.get_webview_window(label).is_some() {
        return Ok(());
    }
    WebviewWindowBuilder::new(app, label, WebviewUrl::App("index.html".into()))
        .title("Spool")
        .inner_size(width, height)
        .min_inner_size(1.0, 1.0)
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .shadow(false)
        .visible(false)
        .focused(false)
        .resizable(label == "camera")
        .maximizable(false)
        .minimizable(false)
        .closable(false)
        .content_protected(protected)
        .visible_on_all_workspaces(true)
        .build()
        .map_err(|error| format!("Could not create the {label} window: {error}"))?;
    Ok(())
}

pub fn present(app: &AppHandle, geometry: &CaptureGeometry, camera: Option<CameraSize>, draw_enabled: bool) -> Result<(), String> {
    let layout = layout_overlays(geometry.logical, camera);
    hide(app, "area");
    place(app, "draw", layout.draw, false)?;
    set_ignore(app, "draw", !draw_enabled)?;
    if let Some(frame) = layout.camera {
        place(app, "camera", frame, false)?;
    } else {
        hide(app, "camera");
    }
    place(app, "bar", layout.bar, true)?;
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.hide();
    }
    Ok(())
}

pub fn show_area(app: &AppHandle, monitor: RectF) -> Result<(), String> {
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.hide();
    }
    place(app, "area", monitor, true)?;
    if let Some(window) = app.get_webview_window("area") {
        let _ = window.set_focus();
    }
    Ok(())
}

pub fn place_camera(app: &AppHandle, frame: RectF) -> Result<(), String> {
    place(app, "camera", frame, true)
}

pub fn set_ignore(app: &AppHandle, label: &str, ignore: bool) -> Result<(), String> {
    let Some(window) = app.get_webview_window(label) else {
        return Ok(());
    };
    window.set_ignore_cursor_events(ignore).map_err(|error| error.to_string())
}

pub fn restore_main(app: &AppHandle) {
    for label in OVERLAYS {
        hide(app, label);
    }
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.show();
        let _ = main.unminimize();
        let _ = main.set_focus();
    }
}

fn place(app: &AppHandle, label: &str, rect: RectF, focus: bool) -> Result<(), String> {
    let Some(window) = app.get_webview_window(label) else {
        return Err(format!("The {label} window is missing."));
    };
    window
        .set_position(LogicalPosition::new(rect.x, rect.y))
        .map_err(|error| error.to_string())?;
    window
        .set_size(LogicalSize::new(rect.width.max(1.0), rect.height.max(1.0)))
        .map_err(|error| error.to_string())?;
    let _ = window.set_always_on_top(true);
    window.show().map_err(|error| error.to_string())?;
    if focus {
        let _ = window.set_focus();
    }
    Ok(())
}

fn hide(app: &AppHandle, label: &str) {
    if let Some(window) = app.get_webview_window(label) {
        let _ = window.hide();
    }
}
