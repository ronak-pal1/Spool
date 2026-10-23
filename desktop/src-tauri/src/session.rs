//! Recording session. Each desktop window has its own JavaScript heap, so the
//! UI listens for `recording-state` instead of sharing a store.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::Sender;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

use crate::capture::Control;
use crate::geom::{flip_pointer_y, hit_test, round_secs, CameraSize, CaptureGeometry, PointerOrigin, RectF};
use crate::input::PointerSample;
use crate::upload::{ApiAuth, ClickEvent};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Phase {
    Idle,
    Countdown,
    Recording,
    Paused,
    Finalizing,
    Error,
}

#[derive(Clone, Debug)]
pub struct Clock {
    accumulated: Duration,
    running_since: Option<Instant>,
}

impl Clock {
    pub fn new() -> Self {
        Self { accumulated: Duration::ZERO, running_since: None }
    }

    pub fn elapsed(&self) -> Duration {
        self.accumulated + self.running_since.map(|start| start.elapsed()).unwrap_or_default()
    }

    pub fn start(&mut self) {
        if self.running_since.is_none() {
            self.running_since = Some(Instant::now());
        }
    }

    pub fn pause(&mut self) {
        if let Some(start) = self.running_since.take() {
            self.accumulated += start.elapsed();
        }
    }

    pub fn reset(&mut self) {
        *self = Self::new();
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartRequest {
    pub mode: String,
    pub source_id: String,
    pub area: Option<RectF>,
    pub mic_enabled: bool,
    pub mic_device_id: Option<String>,
    pub system_enabled: bool,
    pub system_device_id: Option<String>,
    pub camera_enabled: bool,
    pub camera_device_id: Option<String>,
    pub api_url: String,
    pub token: String,
    pub workspace_id: Option<String>,
    pub title: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub phase: Phase,
    pub countdown: Option<u8>,
    pub elapsed_ms: u64,
    pub limit_ms: u64,
    pub mic_muted: bool,
    pub system_muted: bool,
    pub mic_attached: bool,
    pub system_attached: bool,
    pub camera_enabled: bool,
    pub camera_device_id: Option<String>,
    pub camera_size: String,
    pub camera_click_through: bool,
    pub draw_enabled: bool,
    pub progress: f64,
    pub error: Option<String>,
    pub can_retry: bool,
    pub share_id: Option<String>,
    pub web_url: Option<String>,
    pub label: Option<String>,
}

pub struct Session {
    pub generation: u64,
    pub phase: Phase,
    pub countdown: Option<u8>,
    pub clock: Clock,
    pub limit: Duration,
    pub mic_muted: bool,
    pub system_muted: bool,
    pub mic_attached: bool,
    pub system_attached: bool,
    pub camera_enabled: bool,
    pub camera_device_id: Option<String>,
    pub camera_size: CameraSize,
    pub camera_click_through: bool,
    pub draw_enabled: bool,
    pub error: Option<String>,
    pub can_retry: bool,
    pub share_id: Option<String>,
    pub web_url: Option<String>,
    pub video_id: Option<String>,
    pub upload_open: bool,
    pub geometry: Option<CaptureGeometry>,
    pub pointer_baseline: f64,
    pub control: Option<Sender<Control>>,
    pub clicks: Vec<ClickEvent>,
    pub abort: Arc<AtomicBool>,
    pub temp_dir: Option<PathBuf>,
    pub produced: Arc<AtomicU64>,
    pub uploaded: Arc<AtomicU64>,
    pub config: Option<StartRequest>,
    pub auth: Option<ApiAuth>,
    pub stop_requested: bool,
}

impl Session {
    pub fn new() -> Self {
        Self {
            generation: 0,
            phase: Phase::Idle,
            countdown: None,
            clock: Clock::new(),
            limit: Duration::from_secs(420),
            mic_muted: false,
            system_muted: false,
            mic_attached: false,
            system_attached: false,
            camera_enabled: false,
            camera_device_id: None,
            camera_size: CameraSize::M,
            camera_click_through: false,
            draw_enabled: false,
            error: None,
            can_retry: false,
            share_id: None,
            web_url: None,
            video_id: None,
            upload_open: false,
            geometry: None,
            pointer_baseline: 0.0,
            control: None,
            clicks: Vec::new(),
            abort: Arc::new(AtomicBool::new(false)),
            temp_dir: None,
            produced: Arc::new(AtomicU64::new(0)),
            uploaded: Arc::new(AtomicU64::new(0)),
            config: None,
            auth: None,
            stop_requested: false,
        }
    }

    pub fn is_busy(&self) -> bool {
        matches!(self.phase, Phase::Countdown | Phase::Recording | Phase::Paused | Phase::Finalizing)
    }

    pub fn snapshot(&self) -> Snapshot {
        let produced = self.produced.load(Ordering::Relaxed);
        let uploaded = self.uploaded.load(Ordering::Relaxed);
        let progress = if produced == 0 { 0.0 } else { (uploaded as f64 / produced as f64).clamp(0.0, 1.0) };
        Snapshot {
            phase: self.phase,
            countdown: self.countdown,
            elapsed_ms: self.clock.elapsed().as_millis() as u64,
            limit_ms: self.limit.as_millis() as u64,
            mic_muted: self.mic_muted,
            system_muted: self.system_muted,
            mic_attached: self.mic_attached,
            system_attached: self.system_attached,
            camera_enabled: self.camera_enabled,
            camera_device_id: self.camera_device_id.clone(),
            camera_size: self.camera_size.as_str().into(),
            camera_click_through: self.camera_click_through,
            draw_enabled: self.draw_enabled,
            progress,
            error: self.error.clone(),
            can_retry: self.can_retry,
            share_id: self.share_id.clone(),
            web_url: self.web_url.clone(),
            label: self.geometry.as_ref().map(|geometry| geometry.label.clone()),
        }
    }

    pub fn note_pointer(&mut self, sample: &PointerSample, was_pressed: bool) {
        if self.phase != Phase::Recording || self.draw_enabled || !sample.pressed || was_pressed {
            return;
        }
        let Some(geometry) = &self.geometry else { return };
        let (x, y, origin_x, origin_y, width, height) = if sample.pixel_space {
            let pixel = geometry.capture_pixel();
            (sample.x, sample.y, pixel.x as f64, pixel.y as f64, pixel.width as f64, pixel.height as f64)
        } else {
            if sample.origin == PointerOrigin::BottomLeft && self.pointer_baseline <= 1.0 {
                return;
            }
            let y = flip_pointer_y(sample.y, self.pointer_baseline, sample.origin);
            (sample.x, y, geometry.logical.x, geometry.logical.y, geometry.logical.width, geometry.logical.height)
        };
        let Some((nx, ny)) = hit_test(x, y, origin_x, origin_y, width, height) else { return };
        if self.clicks.len() >= 4000 {
            return;
        }
        self.clicks.push(ClickEvent {
            t: round_secs(self.clock.elapsed().as_secs_f64()),
            x: nx,
            y: ny,
        });
    }
}

pub struct AppState {
    pub session: Arc<Mutex<Session>>,
    pub http: reqwest::Client,
}

pub fn lock(session: &Mutex<Session>) -> std::sync::MutexGuard<'_, Session> {
    session.lock().unwrap_or_else(|error| error.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::geom::{CaptureGeometry, RectF};

    #[test]
    fn paused_clock_does_not_advance() {
        let mut clock = Clock::new();
        clock.start();
        clock.pause();
        let frozen = clock.elapsed();
        std::thread::sleep(Duration::from_millis(30));
        assert!(clock.elapsed().saturating_sub(frozen) < Duration::from_millis(15));
    }

    #[test]
    fn clicks_are_normalized_only_while_recording() {
        let mut session = Session::new();
        session.pointer_baseline = 1000.0;
        session.geometry = Some(CaptureGeometry {
            logical: RectF { x: 0.0, y: 0.0, width: 200.0, height: 100.0 },
            pixel_x: 0,
            pixel_y: 0,
            pixel_w: 200,
            pixel_h: 100,
            scale: 1.0,
            screen_index: 0,
            pointer_baseline: 1000.0,
            label: "Display".into(),
            crop: false,
            crop_x: 0,
            crop_y: 0,
        });
        let sample = PointerSample { x: 50.0, y: 25.0, pressed: true, origin: PointerOrigin::TopLeft, pixel_space: true };
        session.note_pointer(&sample, false);
        assert!(session.clicks.is_empty());
        session.phase = Phase::Recording;
        session.note_pointer(&sample, false);
        assert_eq!(session.clicks.len(), 1);
        assert_eq!(session.clicks[0].x, 0.25);
        assert_eq!(session.clicks[0].y, 0.25);
        session.draw_enabled = true;
        session.note_pointer(&sample, false);
        assert_eq!(session.clicks.len(), 1);
    }
}
