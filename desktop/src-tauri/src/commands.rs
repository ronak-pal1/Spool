//! Tauri commands. The session mutex is never held across an await.

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc;
use std::sync::Arc;
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_opener::OpenerExt;

use crate::capture::{self, Control, Outbound, SupervisorConfig};
use crate::devices::{self, AudioInventory, SourceInfo};
use crate::geom::{layout_overlays, CameraSize, RectF};
use crate::overlay::{self};
use crate::session::{lock, AppState, Phase, Session, Snapshot, StartRequest};
use crate::upload::{self, ApiAuth, PreparedUpload};

#[tauri::command]
pub async fn list_sources(state: State<'_, AppState>) -> Result<Vec<SourceInfo>, String> {
    let listed = tauri::async_runtime::spawn_blocking(devices::list_sources).await.map_err(|e| e.to_string())??;
    lock(&state.session).pointer_baseline = listed.pointer_baseline;
    Ok(listed.sources)
}

#[tauri::command]
pub fn list_audio_devices() -> AudioInventory {
    devices::list_audio()
}

#[tauri::command]
pub fn recording_snapshot(state: State<'_, AppState>) -> Snapshot {
    lock(&state.session).snapshot()
}

#[tauri::command]
pub async fn start_recording(app: AppHandle, state: State<'_, AppState>, request: StartRequest) -> Result<Snapshot, String> {
    let _ = ApiAuth::new(&request.api_url, &request.token, request.workspace_id.clone())?;
    let generation = {
        let mut session = lock(&state.session);
        if session.is_busy() {
            return Err("A recording is already in progress.".into());
        }
        if let Some(dir) = session.temp_dir.take() {
            let _ = std::fs::remove_dir_all(dir);
        }
        session.generation = session.generation.saturating_add(1);
        session.phase = Phase::Countdown;
        session.countdown = Some(3);
        session.clock.reset();
        session.error = None;
        session.can_retry = false;
        session.share_id = None;
        session.video_id = None;
        session.upload_open = false;
        session.clicks.clear();
        session.stop_requested = false;
        session.draw_enabled = false;
        session.camera_enabled = request.camera_enabled;
        session.camera_device_id = request.camera_device_id.clone();
        session.camera_click_through = false;
        session.mic_muted = !request.mic_enabled;
        session.system_muted = !request.system_enabled;
        session.mic_attached = false;
        session.system_attached = false;
        session.config = Some(request.clone());
        session.abort = Arc::new(AtomicBool::new(false));
        session.produced = Arc::new(AtomicU64::new(0));
        session.uploaded = Arc::new(AtomicU64::new(0));
        session.control = None;
        session.auth = None;
        session.geometry = None;
        session.generation
    };
    let snapshot = publish(&app, &state);
    let app_task = app.clone();
    let http = state.http.clone();
    let session = state.session.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(error) = countdown(app_task.clone(), http.clone(), session.clone(), request, generation).await {
            fail(&app_task, &http, &session, generation, error);
        }
    });
    Ok(snapshot)
}

async fn countdown(app: AppHandle, http: reqwest::Client, session: Arc<std::sync::Mutex<Session>>, request: StartRequest, generation: u64) -> Result<(), String> {
    let mode = request.mode.clone();
    let source_id = request.source_id.clone();
    let area = request.area;
    let geometry = tauri::async_runtime::spawn_blocking(move || devices::resolve(&mode, &source_id, area)).await.map_err(|e| e.to_string())??;
    if generation_is(&session, generation) {
        return Ok(());
    }
    {
        let mut guard = lock(&session);
        if guard.generation != generation {
            return Ok(());
        }
        guard.pointer_baseline = geometry.pointer_baseline;
        guard.geometry = Some(geometry.clone());
    }
    let camera = {
        let guard = lock(&session);
        if guard.camera_enabled { Some(guard.camera_size) } else { None }
    };
    overlay::present(&app, &geometry, camera, false)?;

    let http_for_prep = http.clone();
    let request_for_prep = request.clone();
    let mut prep = Box::pin(async move {
        let auth = ApiAuth::new(&request_for_prep.api_url, &request_for_prep.token, request_for_prep.workspace_id.clone())?;
        let prepared = upload::prepare(&http_for_prep, &auth, request_for_prep.title.clone()).await?;
        Ok::<(ApiAuth, PreparedUpload), String>((auth, prepared))
    });
    let mut prepared: Option<(ApiAuth, PreparedUpload)> = None;
    for step in [3u8, 2, 1] {
        if !set_countdown(&session, generation, step) {
            if let Some((auth, upload)) = prepared.as_ref() {
                abort_prepared(&http, Some((auth, upload))).await;
            }
            return Ok(());
        }
        publish_session(&app, &session);
        let sleep = tokio::time::sleep(Duration::from_secs(1));
        tokio::pin!(sleep);
        loop {
            tokio::select! {
                result = &mut prep, if prepared.is_none() => {
                    prepared = Some(result?);
                }
                _ = &mut sleep => break,
            }
        }
    }
    if prepared.is_none() {
        prepared = Some(prep.await?);
    }
    let (auth, prepared) = prepared.expect("upload prep");
    if generation_is(&session, generation) {
        abort_prepared(&http, Some((&auth, &prepared))).await;
        return Ok(());
    }
    let temp_dir = std::env::temp_dir().join(format!("spool-{}-{generation}", prepared.video_id));
    if let Err(error) = std::fs::create_dir_all(&temp_dir) {
        abort_prepared(&http, Some((&auth, &prepared))).await;
        return Err(error.to_string());
    }
    let mic = match optional_device(request.mic_enabled, request.mic_device_id.clone(), "Choose a microphone, or turn the microphone off.") {
        Ok(device) => device,
        Err(error) => {
            abort_prepared(&http, Some((&auth, &prepared))).await;
            let _ = std::fs::remove_dir_all(&temp_dir);
            return Err(error);
        }
    };
    let system = match optional_device(request.system_enabled, request.system_device_id.clone(), "Choose a system-audio device, or turn system audio off.") {
        Ok(device) => device,
        Err(error) => {
            abort_prepared(&http, Some((&auth, &prepared))).await;
            let _ = std::fs::remove_dir_all(&temp_dir);
            return Err(error);
        }
    };
    let (control_tx, control_rx) = mpsc::channel();
    let (outbound_tx, outbound_rx) = tokio::sync::mpsc::channel(8);
    let (ready_tx, ready_rx) = mpsc::sync_channel(1);
    let fatal = Arc::new(std::sync::Mutex::new(String::new()));
    {
        let mut guard = lock(&session);
        if guard.generation != generation {
            drop(guard);
            abort_prepared(&http, Some((&auth, &prepared))).await;
            let _ = std::fs::remove_dir_all(&temp_dir);
            return Ok(());
        }
        guard.limit = Duration::from_secs(prepared.max_seconds);
        guard.web_url = Some(prepared.web_url.clone());
        guard.share_id = Some(prepared.share_id.clone());
        guard.video_id = Some(prepared.video_id.clone());
        guard.upload_open = true;
        guard.auth = Some(auth.clone());
        guard.temp_dir = Some(temp_dir.clone());
        guard.mic_attached = mic.is_some();
        guard.system_attached = system.is_some();
        guard.control = Some(control_tx);
    }
    let config = SupervisorConfig {
        dir: temp_dir,
        geometry,
        mic,
        system,
        mic_muted: lock(&session).mic_muted,
        system_muted: lock(&session).system_muted,
        control: control_rx,
        outbound: outbound_tx,
        ready: ready_tx,
        fatal: fatal.clone(),
    };
    std::thread::Builder::new().name("spool-capture".into()).spawn(move || capture::run_supervisor(config)).map_err(|e| e.to_string())?;
    let abort = lock(&session).abort.clone();
    let produced = lock(&session).produced.clone();
    let uploaded = lock(&session).uploaded.clone();
    let app_upload = app.clone();
    let http_upload = http.clone();
    let session_upload = session.clone();
    let auth_upload = auth.clone();
    let prepared_upload = prepared.clone();
    tauri::async_runtime::spawn(async move {
        drive_upload(app_upload, http_upload, session_upload, generation, auth_upload, prepared_upload, outbound_rx, abort, produced, uploaded, fatal).await;
    });
    let ready = tauri::async_runtime::spawn_blocking(move || ready_rx.recv_timeout(Duration::from_secs(12))).await.map_err(|e| e.to_string())?;
    if generation_is(&session, generation) {
        return Ok(());
    }
    match ready {
        Ok(Ok(())) => {}
        Ok(Err(message)) if message == "cancelled" => return Ok(()),
        Ok(Err(message)) => return Err(message),
        Err(_) => return Err("Capture did not start. Check that ffmpeg is installed and the display can be recorded.".into()),
    }
    {
        let mut guard = lock(&session);
        if guard.generation != generation || guard.phase != Phase::Countdown {
            return Ok(());
        }
        guard.phase = Phase::Recording;
        guard.countdown = None;
        guard.clock.start();
    }
    publish_session(&app, &session);
    Ok(())
}

async fn drive_upload(
    app: AppHandle,
    http: reqwest::Client,
    session: Arc<std::sync::Mutex<Session>>,
    generation: u64,
    auth: ApiAuth,
    prepared: PreparedUpload,
    mut outbound: tokio::sync::mpsc::Receiver<Outbound>,
    abort: Arc<AtomicBool>,
    produced: Arc<AtomicU64>,
    uploaded: Arc<AtomicU64>,
    fatal: Arc<std::sync::Mutex<String>>,
) {
    let mut uploader = upload::PartUploader::new(http.clone(), auth.clone(), prepared.video_id.clone(), prepared.part_size, abort.clone(), uploaded);
    let mut failure: Option<String> = None;
    let mut finished = false;
    while let Some(message) = outbound.recv().await {
        if abort.load(Ordering::Relaxed) {
            continue;
        }
        match message {
            Outbound::Bytes(bytes) => {
                produced.fetch_add(bytes.len() as u64, Ordering::Relaxed);
                if let Err(error) = uploader.push(&bytes).await {
                    failure = Some(error);
                    break;
                }
            }
            Outbound::Finish { duration } => {
                let clicks = lock(&session).clicks.clone();
                match uploader.finish(duration, clicks).await {
                    Ok(()) => finished = true,
                    Err(error) => failure = Some(error),
                }
                break;
            }
        }
    }
    if generation_is(&session, generation) || abort.load(Ordering::Relaxed) {
        if !finished {
            let _ = upload::abort_upload(&http, &auth, &prepared.video_id).await;
        }
        return;
    }
    if finished {
        succeed(&app, &session, generation, &prepared.share_id, &prepared.web_url);
        return;
    }
    let fatal_text = fatal.lock().unwrap_or_else(|e| e.into_inner()).clone();
    let message = failure.or_else(|| if fatal_text.is_empty() { None } else { Some(fatal_text) }).unwrap_or_else(|| "Capture ended before the upload finished.".into());
    fail(&app, &http, &session, generation, message);
}

fn succeed(app: &AppHandle, session: &std::sync::Mutex<Session>, generation: u64, share_id: &str, web_url: &str) {
    let snapshot = {
        let mut guard = lock(session);
        if guard.generation != generation {
            return;
        }
        guard.phase = Phase::Idle;
        guard.countdown = None;
        guard.upload_open = false;
        guard.can_retry = false;
        guard.error = None;
        guard.clock.pause();
        if let Some(dir) = guard.temp_dir.take() {
            let _ = std::fs::remove_dir_all(dir);
        }
        guard.snapshot()
    };
    overlay::restore_main(app);
    let _ = app.emit("recording-state", &snapshot);
    let url = format!("{}/s/{share_id}", web_url.trim_end_matches('/'));
    let _ = app.opener().open_url(url, None::<&str>);
}

fn fail(app: &AppHandle, http: &reqwest::Client, session: &std::sync::Mutex<Session>, generation: u64, message: String) {
    let abort_job = {
        let mut guard = lock(session);
        if guard.generation != generation {
            return;
        }
        let retry = guard.temp_dir.as_deref().is_some_and(upload::dir_has_video);
        guard.phase = Phase::Error;
        guard.countdown = None;
        guard.clock.pause();
        guard.error = Some(message);
        guard.can_retry = retry;
        guard.stop_requested = false;
        let job = if guard.upload_open {
            guard.upload_open = false;
            match (guard.auth.clone(), guard.video_id.clone()) {
                (Some(auth), Some(video_id)) => Some((auth, video_id)),
                _ => None,
            }
        } else {
            None
        };
        let snapshot = guard.snapshot();
        drop(guard);
        overlay::restore_main(app);
        let _ = app.emit("recording-state", &snapshot);
        job
    };
    if let Some((auth, video_id)) = abort_job {
        let http = http.clone();
        tauri::async_runtime::spawn(async move {
            let _ = upload::abort_upload(&http, &auth, &video_id).await;
        });
    }
}

#[tauri::command]
pub fn pause_recording(app: AppHandle, state: State<'_, AppState>) -> Result<Snapshot, String> {
    let mut session = lock(&state.session);
    if session.phase != Phase::Recording {
        return Err("Recording is not running.".into());
    }
    session.clock.pause();
    session.phase = Phase::Paused;
    if let Some(tx) = &session.control {
        let _ = tx.send(Control::Pause);
    }
    drop(session);
    Ok(publish(&app, &state))
}

#[tauri::command]
pub fn resume_recording(app: AppHandle, state: State<'_, AppState>) -> Result<Snapshot, String> {
    let mut session = lock(&state.session);
    if session.phase != Phase::Paused {
        return Err("Recording is not paused.".into());
    }
    session.phase = Phase::Recording;
    session.clock.start();
    if let Some(tx) = &session.control {
        let _ = tx.send(Control::Resume);
    }
    drop(session);
    Ok(publish(&app, &state))
}

#[tauri::command]
pub fn set_mic_muted(app: AppHandle, state: State<'_, AppState>, muted: bool) -> Result<Snapshot, String> {
    set_muted(&app, &state, true, muted)
}

#[tauri::command]
pub fn set_system_muted(app: AppHandle, state: State<'_, AppState>, muted: bool) -> Result<Snapshot, String> {
    set_muted(&app, &state, false, muted)
}

fn set_muted(app: &AppHandle, state: &State<'_, AppState>, mic: bool, muted: bool) -> Result<Snapshot, String> {
    let mut session = lock(&state.session);
    if mic {
        if !session.mic_attached && matches!(session.phase, Phase::Recording | Phase::Paused) {
            return Err("This take has no microphone track.".into());
        }
        session.mic_muted = muted;
    } else {
        if !session.system_attached && matches!(session.phase, Phase::Recording | Phase::Paused) {
            return Err("This take has no system-audio track.".into());
        }
        session.system_muted = muted;
    }
    if matches!(session.phase, Phase::Recording | Phase::Paused) {
        if let Some(tx) = &session.control {
            let _ = if mic { tx.send(Control::MicMute(muted)) } else { tx.send(Control::SystemMute(muted)) };
        }
    }
    drop(session);
    Ok(publish(app, state))
}

#[tauri::command]
pub fn stop_recording(app: AppHandle, state: State<'_, AppState>) -> Result<Snapshot, String> {
    let phase = lock(&state.session).phase;
    if phase == Phase::Countdown {
        return discard_recording(app, state);
    }
    request_stop(&state.session);
    Ok(publish(&app, &state))
}

fn request_stop(session: &std::sync::Mutex<Session>) {
    let mut guard = lock(session);
    if !matches!(guard.phase, Phase::Recording | Phase::Paused) {
        return;
    }
    guard.clock.pause();
    let duration = guard.clock.elapsed().as_secs_f64();
    guard.phase = Phase::Finalizing;
    guard.countdown = None;
    guard.stop_requested = true;
    if let Some(tx) = &guard.control {
        let _ = tx.send(Control::Stop { duration });
    }
}

#[tauri::command]
pub fn discard_recording(app: AppHandle, state: State<'_, AppState>) -> Result<Snapshot, String> {
    let (auth, video_id, dir) = {
        let mut session = lock(&state.session);
        session.generation = session.generation.saturating_add(1);
        session.abort.store(true, Ordering::Relaxed);
        session.phase = Phase::Idle;
        session.countdown = None;
        session.clock.reset();
        session.error = None;
        session.can_retry = false;
        session.clicks.clear();
        session.stop_requested = false;
        session.draw_enabled = false;
        let open = session.upload_open;
        session.upload_open = false;
        if let Some(tx) = session.control.take() {
            let _ = tx.send(Control::Discard);
        }
        let video = if open { session.video_id.take() } else { session.video_id.take(); None };
        (session.auth.clone(), video, session.temp_dir.take())
    };
    overlay::restore_main(&app);
    if let Some(dir) = dir {
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(Duration::from_millis(600)).await;
            let _ = tokio::fs::remove_dir_all(dir).await;
        });
    }
    if let (Some(auth), Some(video_id)) = (auth, video_id) {
        let http = state.http.clone();
        tauri::async_runtime::spawn(async move {
            let _ = upload::abort_upload(&http, &auth, &video_id).await;
        });
    }
    Ok(publish(&app, &state))
}

#[tauri::command]
pub async fn restart_recording(app: AppHandle, state: State<'_, AppState>) -> Result<Snapshot, String> {
    let request = lock(&state.session).config.clone().ok_or_else(|| "There is no take to restart.".to_string())?;
    discard_recording(app.clone(), state.clone())?;
    start_recording(app, state, request).await
}

#[tauri::command]
pub async fn retry_upload(app: AppHandle, state: State<'_, AppState>) -> Result<Snapshot, String> {
    let (dir, auth, clicks, duration, title) = {
        let session = lock(&state.session);
        if session.phase != Phase::Error || !session.can_retry {
            return Err("There is no recording to upload.".into());
        }
        let dir = session.temp_dir.clone().ok_or_else(|| "The recording files are gone.".to_string())?;
        let auth = session.auth.clone().ok_or_else(|| "Sign in again before retrying the upload.".to_string())?;
        (dir, auth, session.clicks.clone(), session.clock.elapsed().as_secs_f64(), session.config.as_ref().and_then(|config| config.title.clone()))
    };
    let prepared = upload::prepare(&state.http, &auth, title).await?;
    if lock(&state.session).phase != Phase::Error {
        let _ = upload::abort_upload(&state.http, &auth, &prepared.video_id).await;
        return Err("The recording changed before the retry started.".into());
    }
    let generation = {
        let mut session = lock(&state.session);
        session.generation = session.generation.saturating_add(1);
        session.phase = Phase::Finalizing;
        session.error = None;
        session.video_id = Some(prepared.video_id.clone());
        session.share_id = Some(prepared.share_id.clone());
        session.web_url = Some(prepared.web_url.clone());
        session.upload_open = true;
        session.abort = Arc::new(AtomicBool::new(false));
        session.produced = Arc::new(AtomicU64::new(0));
        session.uploaded = Arc::new(AtomicU64::new(0));
        session.generation
    };
    publish(&app, &state);
    let http = state.http.clone();
    let session = state.session.clone();
    let abort = lock(&session).abort.clone();
    let uploaded = lock(&session).uploaded.clone();
    let bytes = upload::segment_files(&dir).iter().filter_map(|path| std::fs::metadata(path).ok()).map(|meta| meta.len()).sum::<u64>();
    lock(&session).produced.store(bytes, Ordering::Relaxed);
    let app_task = app.clone();
    tauri::async_runtime::spawn(async move {
        match upload::upload_directory(&http, &auth, &prepared, &dir, duration, clicks, abort, uploaded).await {
            Ok(()) => succeed(&app_task, &session, generation, &prepared.share_id, &prepared.web_url),
            Err(error) => fail(&app_task, &http, &session, generation, error),
        }
    });
    Ok(lock(&state.session).snapshot())
}

#[tauri::command]
pub fn prepare_area_select(app: AppHandle, state: State<'_, AppState>, source_id: String) -> Result<(), String> {
    if lock(&state.session).is_busy() {
        return Err("Finish the current recording before selecting an area.".into());
    }
    let geometry = devices::resolve("screen", &source_id, None)?;
    overlay::show_area(&app, geometry.logical)
}

#[tauri::command]
pub fn cancel_area_select(app: AppHandle) -> Result<(), String> {
    overlay::restore_main(&app);
    let _ = app.emit("area-cancelled", true);
    Ok(())
}

#[tauri::command]
pub fn complete_area_select(app: AppHandle, rect: RectF) -> Result<RectF, String> {
    if rect.width < 64.0 || rect.height < 64.0 {
        return Err("Select an area at least 64×64.".into());
    }
    overlay::restore_main(&app);
    let _ = app.emit("area-selected", &rect);
    Ok(rect)
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct CameraConfig {
    enabled: bool,
    device_id: Option<String>,
    size: String,
    click_through: bool,
    phase: Phase,
}

#[tauri::command]
pub fn camera_config(state: State<'_, AppState>) -> CameraConfig {
    let session = lock(&state.session);
    CameraConfig {
        enabled: session.camera_enabled,
        device_id: session.camera_device_id.clone(),
        size: session.camera_size.as_str().into(),
        click_through: session.camera_click_through,
        phase: session.phase,
    }
}

#[tauri::command]
pub fn set_camera_size(app: AppHandle, state: State<'_, AppState>, size: String) -> Result<Snapshot, String> {
    let mut session = lock(&state.session);
    session.camera_size = CameraSize::parse(&size);
    let frame = session.geometry.as_ref().and_then(|geometry| layout_overlays(geometry.logical, Some(session.camera_size)).camera);
    let show = session.camera_enabled && session.is_busy();
    drop(session);
    if show {
        if let Some(frame) = frame {
            overlay::place_camera(&app, frame)?;
        }
    }
    Ok(publish(&app, &state))
}

#[tauri::command]
pub fn set_camera_click_through(app: AppHandle, state: State<'_, AppState>, enabled: bool) -> Result<Snapshot, String> {
    lock(&state.session).camera_click_through = enabled;
    overlay::set_ignore(&app, "camera", enabled)?;
    Ok(publish(&app, &state))
}

#[tauri::command]
pub fn set_draw_enabled(app: AppHandle, state: State<'_, AppState>, enabled: bool) -> Result<Snapshot, String> {
    lock(&state.session).draw_enabled = enabled;
    overlay::set_ignore(&app, "draw", !enabled)?;
    Ok(publish(&app, &state))
}

pub fn tick(app: &AppHandle) {
    let state = app.state::<AppState>();
    let stop = {
        let mut session = lock(&state.session);
        session.phase == Phase::Recording && !session.stop_requested && session.clock.elapsed() >= session.limit
    };
    if stop {
        request_stop(&state.session);
    }
    let phase = lock(&state.session).phase;
    if phase != Phase::Idle {
        let snapshot = lock(&state.session).snapshot();
        let _ = app.emit("recording-state", &snapshot);
    }
}

fn publish(app: &AppHandle, state: &State<'_, AppState>) -> Snapshot {
    let snapshot = lock(&state.session).snapshot();
    let _ = app.emit("recording-state", &snapshot);
    snapshot
}

fn publish_session(app: &AppHandle, session: &std::sync::Mutex<Session>) {
    let snapshot = lock(session).snapshot();
    let _ = app.emit("recording-state", &snapshot);
}

fn set_countdown(session: &std::sync::Mutex<Session>, generation: u64, step: u8) -> bool {
    let mut guard = lock(session);
    if guard.generation != generation {
        return false;
    }
    guard.countdown = Some(step);
    true
}

fn generation_is(session: &std::sync::Mutex<Session>, generation: u64) -> bool {
    lock(session).generation != generation
}

async fn abort_prepared(http: &reqwest::Client, prepared: Option<(&ApiAuth, &PreparedUpload)>) {
    if let Some((auth, prepared)) = prepared {
        let _ = upload::abort_upload(http, auth, &prepared.video_id).await;
    }
}

fn optional_device(enabled: bool, id: Option<String>, message: &str) -> Result<Option<String>, String> {
    if !enabled {
        return Ok(None);
    }
    id.filter(|value| !value.trim().is_empty()).map(Some).ok_or_else(|| message.to_string())
}

