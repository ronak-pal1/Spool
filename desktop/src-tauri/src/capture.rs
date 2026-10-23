//! ffmpeg capture through a PTY.
//!
//! ffmpeg only honors the interactive filter command (`cvolume@mic -1 volume 0`)
//! when stdin is a terminal. A pipe, and `-nostdin`, both disable live mute.
//! Pause ends the process; resume starts a new MPEG-TS segment so the bytes
//! concatenate. The server transcodes the uploaded MPEG-TS to MP4.

use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::mpsc::{Receiver, RecvTimeoutError, SyncSender};
use tokio::sync::mpsc::error::TrySendError;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use portable_pty::{Child, CommandBuilder, PtySize, native_pty_system};

use crate::geom::{even_dim, CaptureGeometry};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Platform {
    Linux,
    Macos,
    Windows,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EncoderKind {
    Libx264,
    Videotoolbox,
    Nvenc,
    Qsv,
    Amf,
}

impl EncoderKind {
    fn args(self) -> Vec<String> {
        match self {
            Self::Libx264 => vec![
                "-c:v".into(),
                "libx264".into(),
                "-preset".into(),
                "ultrafast".into(),
                "-tune".into(),
                "zerolatency".into(),
                "-crf".into(),
                "20".into(),
                "-pix_fmt".into(),
                "yuv420p".into(),
                "-g".into(),
                "60".into(),
            ],
            Self::Videotoolbox | Self::Nvenc | Self::Qsv | Self::Amf => {
                let name = match self {
                    Self::Videotoolbox => "h264_videotoolbox",
                    Self::Nvenc => "h264_nvenc",
                    Self::Qsv => "h264_qsv",
                    Self::Amf => "h264_amf",
                    Self::Libx264 => unreachable!(),
                };
                vec![
                    "-c:v".into(),
                    name.into(),
                    "-b:v".into(),
                    "6M".into(),
                    "-maxrate".into(),
                    "8M".into(),
                    "-bufsize".into(),
                    "12M".into(),
                    "-pix_fmt".into(),
                    "yuv420p".into(),
                    "-g".into(),
                    "60".into(),
                ]
            }
        }
    }
}

#[derive(Clone, Debug)]
pub struct PlanInput {
    pub platform: Platform,
    pub pixel_x: i32,
    pub pixel_y: i32,
    pub pixel_w: u32,
    pub pixel_h: u32,
    /// macOS records a whole display, then crops. Other platforms capture the pixel rect directly.
    pub crop: bool,
    pub crop_x: u32,
    pub crop_y: u32,
    pub screen_index: usize,
    pub display: String,
    pub mic: Option<String>,
    pub system: Option<String>,
    pub mic_muted: bool,
    pub system_muted: bool,
    pub encoder: EncoderKind,
    pub output: String,
}

#[derive(Clone, Debug)]
pub struct FfmpegPlan {
    pub args: Vec<String>,
    pub has_mic: bool,
    pub has_system: bool,
}

pub fn current_platform() -> Platform {
    if cfg!(target_os = "macos") {
        Platform::Macos
    } else if cfg!(target_os = "windows") {
        Platform::Windows
    } else {
        Platform::Linux
    }
}

pub fn ffmpeg_bin() -> String {
    std::env::var("SPOOL_FFMPEG").unwrap_or_else(|_| "ffmpeg".into())
}

pub fn x11_display() -> String {
    let raw = std::env::var("DISPLAY").unwrap_or_else(|_| ":0".into());
    if raw.contains('.') { raw } else { format!("{raw}.0") }
}

pub fn volume_command(target: &str, muted: bool) -> String {
    format!("c{target} -1 volume {}\n", if muted { 0 } else { 1 })
}

pub fn build_plan(input: &PlanInput) -> Result<FfmpegPlan, String> {
    let width = even_dim(input.pixel_w);
    let height = even_dim(input.pixel_h);
    if width < 2 || height < 2 {
        return Err("The capture region is too small.".into());
    }
    let has_mic = input.mic.is_some();
    let has_system = input.system.is_some();
    let mut args = vec![
        "-hide_banner".into(),
        "-loglevel".into(),
        "info".into(),
        "-y".into(),
        "-fflags".into(),
        "+genpts".into(),
    ];

    match input.platform {
        Platform::Linux => {
            args.extend([
                "-f".into(),
                "x11grab".into(),
                "-draw_mouse".into(),
                "1".into(),
                "-framerate".into(),
                "30".into(),
                "-video_size".into(),
                format!("{width}x{height}"),
                "-i".into(),
                format!("{}+{},{}", input.display, input.pixel_x, input.pixel_y),
            ]);
            if let Some(mic) = &input.mic {
                args.extend(["-f".into(), "pulse".into(), "-ac".into(), "2".into(), "-i".into(), mic.clone()]);
            }
            if let Some(system) = &input.system {
                args.extend(["-f".into(), "pulse".into(), "-ac".into(), "2".into(), "-i".into(), system.clone()]);
            }
        }
        Platform::Macos => {
            args.extend([
                "-f".into(),
                "avfoundation".into(),
                "-framerate".into(),
                "30".into(),
                "-capture_cursor".into(),
                "1".into(),
                "-i".into(),
                format!("{}:none", input.screen_index),
            ]);
            if let Some(mic) = &input.mic {
                args.extend(["-f".into(), "avfoundation".into(), "-i".into(), format!(":{mic}")]);
            }
            if let Some(system) = &input.system {
                args.extend(["-f".into(), "avfoundation".into(), "-i".into(), format!(":{system}")]);
            }
        }
        Platform::Windows => {
            args.extend([
                "-f".into(),
                "gdigrab".into(),
                "-framerate".into(),
                "30".into(),
                "-draw_mouse".into(),
                "1".into(),
                "-offset_x".into(),
                input.pixel_x.to_string(),
                "-offset_y".into(),
                input.pixel_y.to_string(),
                "-video_size".into(),
                format!("{width}x{height}"),
                "-i".into(),
                "desktop".into(),
            ]);
            if let Some(mic) = &input.mic {
                args.extend(["-f".into(), "dshow".into(), "-i".into(), format!("audio={mic}")]);
            }
            if let Some(system) = &input.system {
                args.extend(["-f".into(), "wasapi".into(), "-i".into(), system.clone()]);
            }
        }
    }

    let crop = input.crop;
    let (video_map, audio_map) = filter_graph(has_mic, has_system, input.mic_muted, input.system_muted, crop, input.crop_x, input.crop_y, width, height);
    if let Some(graph) = video_map.graph {
        args.extend(["-filter_complex".into(), graph]);
    }
    args.extend(["-map".into(), video_map.map]);
    if let Some(map) = audio_map {
        args.extend(["-map".into(), map, "-c:a".into(), "aac".into(), "-b:a".into(), "128k".into(), "-ar".into(), "48000".into()]);
    } else {
        args.push("-an".into());
    }
    args.extend(input.encoder.args());
    args.extend(["-flush_packets".into(), "1".into(), "-f".into(), "mpegts".into(), input.output.clone()]);
    if args.iter().any(|arg| arg == "-nostdin") {
        return Err("internal: ffmpeg plan must not disable stdin".into());
    }
    Ok(FfmpegPlan { args, has_mic, has_system })
}

struct Maps {
    graph: Option<String>,
    map: String,
}

fn filter_graph(
    has_mic: bool,
    has_system: bool,
    mic_muted: bool,
    system_muted: bool,
    crop: bool,
    crop_x: u32,
    crop_y: u32,
    width: u32,
    height: u32,
) -> (Maps, Option<String>) {
    let mut parts: Vec<String> = Vec::new();
    let video_map = if crop {
        parts.push(format!("[0:v]crop={width}:{height}:{crop_x}:{crop_y}[v]"));
        "[v]".into()
    } else {
        "0:v:0".into()
    };
    let audio_map = match (has_mic, has_system) {
        (false, false) => None,
        (true, false) => {
            let volume = if mic_muted { 0 } else { 1 };
            parts.push(format!("[1:a]volume@mic=volume={volume}[aout]"));
            Some("[aout]".into())
        }
        (false, true) => {
            let volume = if system_muted { 0 } else { 1 };
            parts.push(format!("[1:a]volume@sys=volume={volume}[aout]"));
            Some("[aout]".into())
        }
        (true, true) => {
            let mic = if mic_muted { 0 } else { 1 };
            let system = if system_muted { 0 } else { 1 };
            parts.push(format!(
                "[1:a]volume@mic=volume={mic}[mic];[2:a]volume@sys=volume={system}[sys];[mic][sys]amix=inputs=2:duration=longest:dropout_transition=0:normalize=0[aout]"
            ));
            Some("[aout]".into())
        }
    };
    let graph = if parts.is_empty() { None } else { Some(parts.join(";")) };
    (Maps { graph, map: video_map }, audio_map)
}

pub fn plan_for_segment(geometry: &CaptureGeometry, output: &Path, mic: Option<String>, system: Option<String>, mic_muted: bool, system_muted: bool) -> Result<FfmpegPlan, String> {
    let pixel = geometry.capture_pixel();
    build_plan(&PlanInput {
        platform: current_platform(),
        pixel_x: pixel.x,
        pixel_y: pixel.y,
        pixel_w: pixel.width,
        pixel_h: pixel.height,
        crop: geometry.crop,
        crop_x: geometry.crop_x,
        crop_y: geometry.crop_y,
        screen_index: geometry.screen_index,
        display: x11_display(),
        mic,
        system,
        mic_muted,
        system_muted,
        encoder: default_encoder(),
        output: output.display().to_string(),
    })
}

pub fn default_encoder() -> EncoderKind {
    static CACHE: std::sync::OnceLock<EncoderKind> = std::sync::OnceLock::new();
    *CACHE.get_or_init(|| match current_platform() {
        Platform::Linux => EncoderKind::Libx264,
        Platform::Macos => {
            if encoder_listed("h264_videotoolbox") { EncoderKind::Videotoolbox } else { EncoderKind::Libx264 }
        }
        Platform::Windows => {
            for (name, kind) in [("h264_nvenc", EncoderKind::Nvenc), ("h264_qsv", EncoderKind::Qsv), ("h264_amf", EncoderKind::Amf)] {
                if encoder_listed(name) {
                    return kind;
                }
            }
            EncoderKind::Libx264
        }
    })
}

fn encoder_listed(name: &str) -> bool {
    let Ok(output) = std::process::Command::new(ffmpeg_bin()).args(["-hide_banner", "-encoders"]).output() else {
        return false;
    };
    let text = String::from_utf8_lossy(&output.stdout);
    text.lines().any(|line| line.split_whitespace().nth(1) == Some(name))
}

#[derive(Debug)]
pub enum Control {
    Pause,
    Resume,
    MicMute(bool),
    SystemMute(bool),
    Stop { duration: f64 },
    Discard,
}

pub enum Outbound {
    Bytes(Vec<u8>),
    Finish { duration: f64 },
}

pub struct SupervisorConfig {
    pub dir: PathBuf,
    pub geometry: CaptureGeometry,
    pub mic: Option<String>,
    pub system: Option<String>,
    pub mic_muted: bool,
    pub system_muted: bool,
    pub control: Receiver<Control>,
    pub outbound: tokio::sync::mpsc::Sender<Outbound>,
    pub ready: SyncSender<Result<(), String>>,
    pub fatal: Arc<Mutex<String>>,
}

pub fn run_supervisor(config: SupervisorConfig) {
    let ready = config.ready.clone();
    if let Err(error) = supervise(config) {
        let _ = ready.send(Err(error));
    }
}

fn supervise(config: SupervisorConfig) -> Result<(), String> {
    let mut index = 0u32;
    let mut mic_muted = config.mic_muted;
    let mut system_muted = config.system_muted;
    let mut pending: Vec<u8> = Vec::new();
    let mut announced = false;
    loop {
        let path = config.dir.join(format!("seg-{index:04}.ts"));
        let mut running = match start_segment(&config, &path, mic_muted, system_muted) {
            Ok(running) => running,
            Err(error) => {
                if !announced {
                    let _ = config.ready.send(Err(error.clone()));
                }
                let mut fatal = config.fatal.lock().unwrap_or_else(|e| e.into_inner());
                *fatal = error;
                return Ok(());
            }
        };
        if !announced {
            let started = Instant::now();
            while started.elapsed() < Duration::from_millis(400) {
                if running.try_exited() {
                    let message = running.failure_message();
                    let _ = config.ready.send(Err(message.clone()));
                    let mut fatal = config.fatal.lock().unwrap_or_else(|e| e.into_inner());
                    *fatal = message;
                    running.stop();
                    return Ok(());
                }
                match config.control.recv_timeout(Duration::from_millis(40)) {
                    Ok(Control::Discard) | Err(RecvTimeoutError::Disconnected) => {
                        running.stop();
                        let _ = config.ready.send(Err("cancelled".into()));
                        return Ok(());
                    }
                    Ok(Control::MicMute(muted)) => {
                        mic_muted = muted;
                        if running.has_mic {
                            running.mute("volume@mic", muted);
                        }
                    }
                    Ok(Control::SystemMute(muted)) => {
                        system_muted = muted;
                        if running.has_system {
                            running.mute("volume@sys", muted);
                        }
                    }
                    Ok(Control::Stop { .. }) => {
                        running.stop();
                        let _ = config.ready.send(Err("cancelled".into()));
                        return Ok(());
                    }
                    Ok(Control::Pause | Control::Resume) | Err(RecvTimeoutError::Timeout) => {}
                }
            }
            let _ = config.ready.send(Ok(()));
            announced = true;
        }
        let reason = pump(&path, &mut running, &config.control, &config.outbound, &mut pending, &mut mic_muted, &mut system_muted);
        running.stop();
        match reason {
            Pump::Pause => {
                index = index.saturating_add(1);
                loop {
                    match config.control.recv() {
                        Ok(Control::Resume) => break,
                        Ok(Control::MicMute(muted)) => mic_muted = muted,
                        Ok(Control::SystemMute(muted)) => system_muted = muted,
                        Ok(Control::Pause) => {}
                        Ok(Control::Stop { duration }) => {
                            let _ = blocking_finish(&config.outbound, &mut pending, duration);
                            return Ok(());
                        }
                        Ok(Control::Discard) | Err(_) => return Ok(()),
                    }
                }
            }
            Pump::Stop { duration } => {
                let _ = blocking_finish(&config.outbound, &mut pending, duration);
                return Ok(());
            }
            Pump::Discard => return Ok(()),
            Pump::Died => {
                let message = running.failure_message();
                let mut fatal = config.fatal.lock().unwrap_or_else(|e| e.into_inner());
                *fatal = message;
                return Ok(());
            }
        }
    }
}

enum Pump {
    Pause,
    Stop { duration: f64 },
    Discard,
    Died,
}

struct Running {
    child: Box<dyn Child + Send + Sync>,
    writer: Box<dyn Write + Send>,
    tail: Arc<Mutex<String>>,
    has_mic: bool,
    has_system: bool,
}

impl Running {
    fn try_exited(&mut self) -> bool {
        matches!(self.child.try_wait(), Ok(Some(_)))
    }

    fn failure_message(&self) -> String {
        let tail = self.tail.lock().unwrap_or_else(|e| e.into_inner());
        let line = tail
            .lines()
            .rev()
            .find(|line| !line.trim().is_empty() && !line.contains("size="))
            .unwrap_or("ffmpeg exited before producing video");
        format!("Capture failed: {line}")
    }

    fn stop(&mut self) {
        let _ = self.writer.write_all(b"q\n");
        let _ = self.writer.flush();
        let started = Instant::now();
        while started.elapsed() < Duration::from_secs(2) {
            if self.try_exited() {
                return;
            }
            thread::sleep(Duration::from_millis(40));
        }
        let _ = self.child.kill();
        let _ = self.child.wait();
    }

    fn mute(&mut self, target: &str, muted: bool) {
        let _ = self.writer.write_all(volume_command(target, muted).as_bytes());
        let _ = self.writer.flush();
    }
}

fn start_segment(config: &SupervisorConfig, output: &Path, mic_muted: bool, system_muted: bool) -> Result<Running, String> {
    if let Some(parent) = output.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let plan = plan_for_segment(&config.geometry, output, config.mic.clone(), config.system.clone(), mic_muted, system_muted)?;
    let pair = native_pty_system()
        .openpty(PtySize { rows: 32, cols: 120, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| format!("Could not open a terminal for ffmpeg: {e}"))?;
    let mut command = CommandBuilder::new(ffmpeg_bin());
    command.args(plan.args.iter().map(String::as_str));
    let child = pair
        .slave
        .spawn_command(command)
        .map_err(|e| format!("Could not start ffmpeg ({}): {e}", ffmpeg_bin()))?;
    drop(pair.slave);
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    let reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let tail = Arc::new(Mutex::new(String::new()));
    let tail_for_reader = tail.clone();
    thread::Builder::new()
        .name("spool-ffmpeg-log".into())
        .spawn(move || drain_pty(reader, tail_for_reader))
        .map_err(|e| e.to_string())?;
    Ok(Running { child, writer, tail, has_mic: plan.has_mic, has_system: plan.has_system })
}

fn drain_pty(mut reader: Box<dyn Read + Send>, tail: Arc<Mutex<String>>) {
    let mut buf = [0u8; 4096];
    loop {
        match reader.read(&mut buf) {
            Ok(0) | Err(_) => break,
            Ok(n) => {
                let text = String::from_utf8_lossy(&buf[..n]);
                let mut guard = tail.lock().unwrap_or_else(|e| e.into_inner());
                guard.push_str(&text);
                if guard.len() > 12_000 {
                    let excess = guard.len() - 6_000;
                    guard.drain(..excess);
                }
            }
        }
    }
}

fn pump(
    path: &Path,
    running: &mut Running,
    control: &Receiver<Control>,
    outbound: &tokio::sync::mpsc::Sender<Outbound>,
    pending: &mut Vec<u8>,
    mic_muted: &mut bool,
    system_muted: &mut bool,
) -> Pump {
    let mut file: Option<std::fs::File> = None;
    let mut buf = vec![0u8; 64 * 1024];
    loop {
        if file.is_none() {
            file = std::fs::File::open(path).ok();
        }
        if let Some(handle) = file.as_mut() {
            match handle.read(&mut buf) {
                Ok(0) => {}
                Ok(n) => enqueue(outbound, pending, &buf[..n]),
                Err(_) => {}
            }
        }
        let message = control.recv_timeout(Duration::from_millis(30));
        if running.try_exited() && !matches!(message, Ok(Control::Pause | Control::Stop { .. } | Control::Discard)) {
            if let Some(handle) = file.as_mut() {
                drain_file_from(handle, outbound, pending);
            }
            return Pump::Died;
        }
        match message {
            Ok(Control::Pause) | Ok(Control::Stop { .. }) | Ok(Control::Discard) => {
                running.stop();
                if let Some(handle) = file.as_mut() {
                    drain_file_from(handle, outbound, pending);
                } else {
                    drain_file(path, outbound, pending);
                }
                return match message {
                    Ok(Control::Pause) => Pump::Pause,
                    Ok(Control::Stop { duration }) => Pump::Stop { duration },
                    _ => Pump::Discard,
                };
            }
            Ok(Control::MicMute(muted)) => {
                *mic_muted = muted;
                if running.has_mic {
                    running.mute("volume@mic", muted);
                }
            }
            Ok(Control::SystemMute(muted)) => {
                *system_muted = muted;
                if running.has_system {
                    running.mute("volume@sys", muted);
                }
            }
            Ok(Control::Resume) | Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => return Pump::Discard,
        }
    }
}

fn drain_file(path: &Path, outbound: &tokio::sync::mpsc::Sender<Outbound>, pending: &mut Vec<u8>) {
    let Ok(mut file) = std::fs::File::open(path) else { return };
    drain_file_from(&mut file, outbound, pending);
}

fn enqueue(outbound: &tokio::sync::mpsc::Sender<Outbound>, pending: &mut Vec<u8>, data: &[u8]) {
    pending.extend_from_slice(data);
    while !pending.is_empty() {
        let n = pending.len().min(256 * 1024);
        let chunk: Vec<u8> = pending.drain(..n).collect();
        match outbound.try_send(Outbound::Bytes(chunk)) {
            Ok(()) => {}
            Err(TrySendError::Full(Outbound::Bytes(chunk))) => {
                let mut restored = chunk;
                restored.append(pending);
                *pending = restored;
                thread::sleep(Duration::from_millis(20));
                return;
            }
            Err(_) => return,
        }
    }
}

fn blocking_finish(outbound: &tokio::sync::mpsc::Sender<Outbound>, pending: &mut Vec<u8>, duration: f64) -> Result<(), ()> {
    while !pending.is_empty() {
        let n = pending.len().min(256 * 1024);
        let chunk: Vec<u8> = pending.drain(..n).collect();
        if outbound.blocking_send(Outbound::Bytes(chunk)).is_err() {
            return Err(());
        }
    }
    outbound.blocking_send(Outbound::Finish { duration }).map_err(|_| ())
}

fn drain_file_from(file: &mut std::fs::File, outbound: &tokio::sync::mpsc::Sender<Outbound>, pending: &mut Vec<u8>) {
    let mut buf = vec![0u8; 256 * 1024];
    loop {
        match file.read(&mut buf) {
            Ok(0) | Err(_) => break,
            Ok(n) => enqueue(outbound, pending, &buf[..n]),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(platform: Platform) -> PlanInput {
        PlanInput {
            platform,
            pixel_x: -100,
            pixel_y: 40,
            pixel_w: 640,
            pixel_h: 361,
            crop: false,
            crop_x: 8,
            crop_y: 4,
            screen_index: 1,
            display: ":0.0".into(),
            mic: Some("mic0".into()),
            system: Some("spk.monitor".into()),
            mic_muted: true,
            system_muted: false,
            encoder: EncoderKind::Libx264,
            output: "/tmp/seg-0000.ts".into(),
        }
    }

    #[test]
    fn linux_plan_uses_a_pty_command_and_starts_muted() {
        let plan = build_plan(&sample(Platform::Linux)).unwrap();
        let joined = plan.args.join(" ");
        assert!(plan.has_mic && plan.has_system);
        assert!(joined.contains("x11grab"));
        assert!(joined.contains(":0.0+-100,40"));
        assert!(joined.contains("640x360"));
        assert!(joined.contains("volume@mic=volume=0"));
        assert!(joined.contains("volume@sys=volume=1"));
        assert!(joined.contains("normalize=0"));
        assert!(!joined.contains("nostdin"));
        assert_eq!(volume_command("volume@mic", true), "cvolume@mic -1 volume 0\n");
    }

    #[test]
    fn macos_plan_crops_and_uses_videotoolbox_args() {
        let mut input = sample(Platform::Macos);
        input.encoder = EncoderKind::Videotoolbox;
        input.crop = true;
        let plan = build_plan(&input).unwrap();
        let joined = plan.args.join(" ");
        assert!(joined.contains("avfoundation"));
        assert!(joined.contains("1:none"));
        assert!(joined.contains("crop=640:360:8:4"));
        assert!(joined.contains("h264_videotoolbox"));
        assert!(!joined.contains("libx264"));
    }

    #[test]
    fn silent_plan_maps_video_only() {
        let mut input = sample(Platform::Windows);
        input.mic = None;
        input.system = None;
        input.encoder = EncoderKind::Nvenc;
        let plan = build_plan(&input).unwrap();
        assert!(!plan.has_mic && !plan.has_system);
        let joined = plan.args.join(" ");
        assert!(joined.contains("-an"));
        assert!(joined.contains("gdigrab"));
        assert!(joined.contains("h264_nvenc"));
        assert!(!joined.contains("volume@"));
    }

    #[test]
    fn pty_accepts_the_volume_command() {
        let dir = std::env::temp_dir().join(format!("spool-pty-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let output = dir.join("tone.ts");
        let pair = native_pty_system().openpty(PtySize { rows: 24, cols: 100, pixel_width: 0, pixel_height: 0 }).unwrap();
        let mut command = CommandBuilder::new(ffmpeg_bin());
        command.args([
            "-hide_banner",
            "-loglevel",
            "info",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:sample_rate=48000",
            "-filter_complex",
            "[0:a]volume@mic=volume=1[a]",
            "-map",
            "[a]",
            "-c:a",
            "aac",
            "-t",
            "1.2",
            "-f",
            "mpegts",
            output.to_str().unwrap(),
        ]);
        let mut child = pair.slave.spawn_command(command).unwrap();
        drop(pair.slave);
        let mut writer = pair.master.take_writer().unwrap();
        let reader = pair.master.try_clone_reader().unwrap();
        let tail = Arc::new(Mutex::new(String::new()));
        let tail_bg = tail.clone();
        thread::spawn(move || drain_pty(reader, tail_bg));
        thread::sleep(Duration::from_millis(300));
        writer.write_all(volume_command("volume@mic", true).as_bytes()).unwrap();
        writer.flush().unwrap();
        thread::sleep(Duration::from_millis(200));
        writer.write_all(b"q\n").unwrap();
        writer.flush().unwrap();
        let started = Instant::now();
        while started.elapsed() < Duration::from_secs(3) {
            if matches!(child.try_wait(), Ok(Some(_))) {
                break;
            }
            thread::sleep(Duration::from_millis(40));
        }
        let _ = child.kill();
        let _ = child.wait();
        let log = tail.lock().unwrap().clone();
        assert!(log.contains("ret:0"), "ffmpeg rejected the volume command:\n{log}");
        assert!(output.exists() && std::fs::metadata(&output).unwrap().len() > 0);
        let _ = std::fs::remove_dir_all(&dir);
        let _ = writer;
    }
}
