//! Monitors, windows, and audio devices.
//!
//! Monitor pixels and logical pixels differ by the display scale. See `geom`.

use base64::Engine;
use serde::Serialize;
use xcap::image::codecs::jpeg::JpegEncoder;
use xcap::image::{DynamicImage, ExtendedColorType, ImageEncoder};
use xcap::{Monitor, Window};

use crate::geom::{area_within_monitor, finite_scale, from_reported, CaptureGeometry, RectF, ReportedSpace};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceInfo {
    pub id: String,
    pub kind: String,
    pub name: String,
    pub app_name: Option<String>,
    pub logical: RectF,
    pub scale: f64,
    pub is_primary: bool,
    pub thumbnail: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioDevice {
    pub id: String,
    pub name: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioInventory {
    pub microphones: Vec<AudioDevice>,
    pub system: Vec<AudioDevice>,
    pub system_available: bool,
    pub note: Option<String>,
}

#[derive(Clone)]
struct MonitorGeom {
    id: u32,
    name: String,
    logical: RectF,
    pixel_x: i32,
    pixel_y: i32,
    pixel_w: u32,
    pixel_h: u32,
    scale: f64,
    index: usize,
    primary: bool,
    thumbnail: Option<String>,
}

pub struct SourceList {
    pub sources: Vec<SourceInfo>,
    pub pointer_baseline: f64,
}

pub fn list_sources() -> Result<SourceList, String> {
    let monitors = read_monitors()?;
    if monitors.is_empty() {
        return Err("No displays were found.".into());
    }
    let baseline = pointer_baseline(&monitors);
    let mut sources = Vec::new();
    for monitor in &monitors {
        sources.push(SourceInfo {
            id: format!("monitor:{}", monitor.id),
            kind: "monitor".into(),
            name: monitor.name.clone(),
            app_name: None,
            logical: monitor.logical,
            scale: monitor.scale,
            is_primary: monitor.primary,
            thumbnail: monitor.thumbnail.clone(),
        });
    }
    let windows = Window::all().unwrap_or_default();
    let mut window_sources = Vec::new();
    for window in windows {
        let title = window.title().unwrap_or_default();
        let app = window.app_name().unwrap_or_default();
        if window.is_minimized().unwrap_or(false) {
            continue;
        }
        let haystack = format!("{title} {app}").to_lowercase();
        if title.trim().is_empty() || haystack.contains("spool") {
            continue;
        }
        let (x, y, width, height) = match (window.x(), window.y(), window.width(), window.height()) {
            (Ok(x), Ok(y), Ok(width), Ok(height)) if width >= 80 && height >= 80 => (x, y, width, height),
            _ => continue,
        };
        let id = window.id().unwrap_or(0);
        let scale = monitor_for_point(&monitors, x, y, width, height).map(|item| item.scale).unwrap_or(1.0);
        let (logical, _, _, _, _) = from_reported(x, y, width, height, scale, window_space());
        let thumbnail = window.capture_image().ok().and_then(|image| encode_thumbnail(image).ok());
        window_sources.push((width as u64 * height as u64, SourceInfo {
            id: format!("window:{id}"),
            kind: "window".into(),
            name: title,
            app_name: if app.is_empty() { None } else { Some(app) },
            logical,
            scale,
            is_primary: false,
            thumbnail,
        }));
    }
    window_sources.sort_by(|a, b| b.0.cmp(&a.0));
    sources.extend(window_sources.into_iter().take(12).map(|(_, source)| source));
    Ok(SourceList { sources, pointer_baseline: baseline })
}

pub fn resolve(mode: &str, source_id: &str, area: Option<RectF>) -> Result<CaptureGeometry, String> {
    let monitors = read_monitors()?;
    let baseline = pointer_baseline(&monitors);
    match mode {
        "screen" => {
            let monitor = find_monitor(&monitors, source_id)?;
            Ok(geometry_from_monitor(monitor, baseline, false, 0, 0, monitor.name.clone()))
        }
        "area" => {
            let monitor = find_monitor(&monitors, source_id)?;
            let rel = area.ok_or_else(|| "Drag on the display to choose an area first.".to_string())?;
            let (logical, px, py, pw, ph) = area_within_monitor(monitor.logical, monitor.pixel_x, monitor.pixel_y, monitor.scale, rel)?;
            let crop = cfg!(target_os = "macos");
            let crop_x = px.saturating_sub(monitor.pixel_x).max(0) as u32;
            let crop_y = py.saturating_sub(monitor.pixel_y).max(0) as u32;
            Ok(CaptureGeometry {
                logical,
                pixel_x: px,
                pixel_y: py,
                pixel_w: pw,
                pixel_h: ph,
                scale: monitor.scale,
                screen_index: monitor.index,
                pointer_baseline: baseline,
                label: format!("Area on {}", monitor.name),
                crop,
                crop_x,
                crop_y,
            })
        }
        "window" => resolve_window(&monitors, source_id, baseline),
        _ => Err("Choose a screen, a window, or an area.".into()),
    }
}

fn resolve_window(monitors: &[MonitorGeom], source_id: &str, baseline: f64) -> Result<CaptureGeometry, String> {
    let id: u32 = source_id
        .strip_prefix("window:")
        .unwrap_or(source_id)
        .parse()
        .map_err(|_| format!("Unknown window {source_id}"))?;
    let windows = Window::all().map_err(|e| e.to_string())?;
    let window = windows
        .into_iter()
        .find(|window| window.id().ok() == Some(id))
        .ok_or_else(|| "That window is no longer open.".to_string())?;
    let (x, y, width, height) = match (window.x(), window.y(), window.width(), window.height()) {
        (Ok(x), Ok(y), Ok(width), Ok(height)) => (x, y, width, height),
        _ => return Err("Could not read that window's size.".into()),
    };
    let monitor = monitor_for_point(monitors, x, y, width, height).ok_or_else(|| "That window is not on a display.".to_string())?;
    let (logical, px, py, pw, ph) = from_reported(x, y, width, height, monitor.scale, window_space());
    let crop = cfg!(target_os = "macos");
    let crop_x = px.saturating_sub(monitor.pixel_x).max(0) as u32;
    let crop_y = py.saturating_sub(monitor.pixel_y).max(0) as u32;
    let title = window.title().unwrap_or_else(|_| "Window".into());
    Ok(CaptureGeometry {
        logical,
        pixel_x: px,
        pixel_y: py,
        pixel_w: pw,
        pixel_h: ph,
        scale: monitor.scale,
        screen_index: monitor.index,
        pointer_baseline: baseline,
        label: title,
        crop,
        crop_x,
        crop_y,
    })
}

fn geometry_from_monitor(monitor: &MonitorGeom, baseline: f64, crop: bool, crop_x: u32, crop_y: u32, label: String) -> CaptureGeometry {
    CaptureGeometry {
        logical: monitor.logical,
        pixel_x: monitor.pixel_x,
        pixel_y: monitor.pixel_y,
        pixel_w: monitor.pixel_w,
        pixel_h: monitor.pixel_h,
        scale: monitor.scale,
        screen_index: monitor.index,
        pointer_baseline: baseline,
        label,
        crop,
        crop_x,
        crop_y,
    }
}

fn find_monitor<'a>(monitors: &'a [MonitorGeom], source_id: &str) -> Result<&'a MonitorGeom, String> {
    let id: u32 = source_id
        .strip_prefix("monitor:")
        .unwrap_or(source_id)
        .parse()
        .map_err(|_| "Choose a display first.".to_string())?;
    monitors.iter().find(|monitor| monitor.id == id).ok_or_else(|| "That display is no longer connected.".to_string())
}

fn read_monitors() -> Result<Vec<MonitorGeom>, String> {
    let all = Monitor::all().map_err(|e| format!("Could not list displays: {e}"))?;
    let mut monitors = Vec::new();
    for (index, monitor) in all.into_iter().enumerate() {
        let id = monitor.id().map_err(|e| e.to_string())?;
        let scale = finite_scale(monitor.scale_factor().unwrap_or(1.0) as f64);
        let (logical, px, py, pw, ph) = from_reported(
            monitor.x().unwrap_or(0),
            monitor.y().unwrap_or(0),
            monitor.width().unwrap_or(0),
            monitor.height().unwrap_or(0),
            scale,
            monitor_space(),
        );
        if logical.width < 64.0 || logical.height < 64.0 {
            continue;
        }
        let name = monitor
            .friendly_name()
            .or_else(|_| monitor.name())
            .unwrap_or_else(|_| format!("Display {}", index + 1));
        let primary = monitor.is_primary().unwrap_or(index == 0);
        let thumbnail = monitor.capture_image().ok().and_then(|image| encode_thumbnail(image).ok());
        monitors.push(MonitorGeom {
            id,
            name,
            logical,
            pixel_x: px,
            pixel_y: py,
            pixel_w: pw,
            pixel_h: ph,
            scale,
            index,
            primary,
            thumbnail,
        });
    }
    monitors.sort_by(|a, b| b.primary.cmp(&a.primary).then(a.logical.x.partial_cmp(&b.logical.x).unwrap_or(std::cmp::Ordering::Equal)));
    Ok(monitors)
}

fn monitor_for_point(monitors: &[MonitorGeom], x: i32, y: i32, width: u32, height: u32) -> Option<&MonitorGeom> {
    let space = window_space();
    let center_x = x as f64 + width as f64 / 2.0;
    let center_y = y as f64 + height as f64 / 2.0;
    monitors.iter().find(|monitor| {
        let (cx, cy) = match space {
            ReportedSpace::Physical => (center_x, center_y),
            ReportedSpace::Logical => (center_x, center_y),
        };
        let (left, top, right, bottom) = match space {
            ReportedSpace::Physical => (
                monitor.pixel_x as f64,
                monitor.pixel_y as f64,
                monitor.pixel_x as f64 + monitor.pixel_w as f64,
                monitor.pixel_y as f64 + monitor.pixel_h as f64,
            ),
            ReportedSpace::Logical => (
                monitor.logical.x,
                monitor.logical.y,
                monitor.logical.x + monitor.logical.width,
                monitor.logical.y + monitor.logical.height,
            ),
        };
        cx >= left && cx < right && cy >= top && cy < bottom
    }).or_else(|| monitors.iter().find(|monitor| monitor.primary).or(monitors.first()))
}

fn pointer_baseline(monitors: &[MonitorGeom]) -> f64 {
    monitors
        .iter()
        .find(|monitor| monitor.primary)
        .or_else(|| monitors.first())
        .map(|monitor| monitor.logical.y + monitor.logical.height)
        .unwrap_or(0.0)
}

fn monitor_space() -> ReportedSpace {
    if cfg!(target_os = "windows") { ReportedSpace::Physical } else { ReportedSpace::Logical }
}

fn window_space() -> ReportedSpace {
    if cfg!(target_os = "macos") { ReportedSpace::Logical } else { ReportedSpace::Physical }
}

fn encode_thumbnail(image: xcap::image::RgbaImage) -> Result<String, String> {
    let rgb = DynamicImage::ImageRgba8(image).thumbnail(480, 300).to_rgb8();
    let mut bytes = Vec::new();
    JpegEncoder::new_with_quality(&mut bytes, 68)
        .write_image(rgb.as_raw(), rgb.width(), rgb.height(), ExtendedColorType::Rgb8)
        .map_err(|e| e.to_string())?;
    Ok(format!("data:image/jpeg;base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes)))
}

pub fn list_audio() -> AudioInventory {
    match crate::capture::current_platform() {
        crate::capture::Platform::Linux => list_linux_audio(),
        crate::capture::Platform::Macos => list_macos_audio(),
        crate::capture::Platform::Windows => list_windows_audio(),
    }
}

fn list_linux_audio() -> AudioInventory {
    if let Some(text) = command_output("pactl", &["list", "short", "sources"]) {
        let (microphones, system) = parse_pactl_short(&text);
        return inventory(microphones, system, "No PulseAudio monitor source is available, so system audio cannot be captured.");
    }
    match command_output("ffmpeg", &["-hide_banner", "-f", "pulse", "-list_devices", "true", "-i", "dummy"]) {
        Some(text) => {
            let (microphones, system) = parse_pulse_ffmpeg(&text);
            if microphones.is_empty() && system.is_empty() && text.to_lowercase().contains("no such process") {
                AudioInventory {
                    microphones,
                    system,
                    system_available: false,
                    note: Some("PulseAudio is not running, so the microphone and system audio cannot be captured.".into()),
                }
            } else {
                inventory(microphones, system, "No PulseAudio monitor source is available, so system audio cannot be captured.")
            }
        }
        None => AudioInventory {
            microphones: Vec::new(),
            system: Vec::new(),
            system_available: false,
            note: Some("ffmpeg is not available to list audio devices.".into()),
        },
    }
}

fn list_macos_audio() -> AudioInventory {
    let Some(text) = command_output("ffmpeg", &["-hide_banner", "-f", "avfoundation", "-list_devices", "true", "-i", ""]) else {
        return missing_ffmpeg();
    };
    let (microphones, system) = parse_avfoundation_audio(&text);
    inventory(microphones, system, "System audio needs a loopback device such as BlackHole or Loopback. Spool will not pretend to record it.")
}

fn list_windows_audio() -> AudioInventory {
    let mics = command_output("ffmpeg", &["-hide_banner", "-list_devices", "true", "-f", "dshow", "-i", "dummy"])
        .map(|text| parse_quoted_devices(&text, "audio"))
        .unwrap_or_default();
    let system = command_output("ffmpeg", &["-hide_banner", "-list_devices", "true", "-f", "wasapi", "-i", "dummy"])
        .map(|text| parse_wasapi_loopback(&text))
        .unwrap_or_default();
    if mics.is_empty() && system.is_empty() {
        if command_output("ffmpeg", &["-version"]).is_none() {
            return missing_ffmpeg();
        }
    }
    inventory(mics, system, "System audio needs a WASAPI loopback device. Spool will not pretend to record it.")
}

fn missing_ffmpeg() -> AudioInventory {
    AudioInventory {
        microphones: Vec::new(),
        system: Vec::new(),
        system_available: false,
        note: Some("ffmpeg is not on PATH. Install it before recording audio.".into()),
    }
}

fn inventory(microphones: Vec<AudioDevice>, system: Vec<AudioDevice>, system_note: &str) -> AudioInventory {
    let system_available = !system.is_empty();
    let note = if system_available { None } else { Some(system_note.to_string()) };
    AudioInventory { microphones, system, system_available, note }
}

fn command_output(program: &str, args: &[&str]) -> Option<String> {
    let output = std::process::Command::new(program).args(args).output().ok()?;
    let mut text = String::from_utf8_lossy(&output.stdout).into_owned();
    text.push_str(&String::from_utf8_lossy(&output.stderr));
    Some(text)
}

pub fn parse_pactl_short(text: &str) -> (Vec<AudioDevice>, Vec<AudioDevice>) {
    let mut mics = Vec::new();
    let mut system = Vec::new();
    for line in text.lines() {
        let mut fields = line.split('\t');
        let _index = fields.next();
        let Some(name) = fields.next() else { continue };
        if name.is_empty() {
            continue;
        }
        let device = AudioDevice { id: name.to_string(), name: name.replace('.', " ") };
        if name.ends_with(".monitor") {
            system.push(device);
        } else {
            mics.push(device);
        }
    }
    (mics, system)
}

pub fn parse_pulse_ffmpeg(text: &str) -> (Vec<AudioDevice>, Vec<AudioDevice>) {
    let mut mics = Vec::new();
    let mut system = Vec::new();
    for (name, description) in quoted_devices(text) {
        let device = AudioDevice { id: name.clone(), name: if description.is_empty() { name.clone() } else { description.clone() } };
        if name.ends_with(".monitor") || description.to_lowercase().starts_with("monitor of") {
            system.push(device);
        } else {
            mics.push(device);
        }
    }
    (mics, system)
}

pub fn parse_avfoundation_audio(text: &str) -> (Vec<AudioDevice>, Vec<AudioDevice>) {
    let mut mics = Vec::new();
    let mut system = Vec::new();
    let mut audio = false;
    for line in text.lines() {
        let lower = line.to_lowercase();
        if lower.contains("audio devices") {
            audio = true;
            continue;
        }
        if lower.contains("video devices") {
            audio = false;
        }
        if !audio {
            continue;
        }
        let Some(start) = line.rfind('[') else { continue };
        let Some(end) = line[start + 1..].find(']') else { continue };
        let id = line[start + 1..start + 1 + end].trim();
        if id.parse::<u32>().is_err() {
            continue;
        }
        let name = line[start + 1 + end + 1..].trim();
        if name.is_empty() {
            continue;
        }
        let device = AudioDevice { id: id.to_string(), name: name.to_string() };
        let lower_name = name.to_lowercase();
        if lower_name.contains("blackhole") || lower_name.contains("loopback") || lower_name.contains("soundflower") {
            system.push(device);
        } else {
            mics.push(device);
        }
    }
    (mics, system)
}

pub fn parse_wasapi_loopback(text: &str) -> Vec<AudioDevice> {
    quoted_devices(text)
        .into_iter()
        .filter(|(_, description)| description.to_lowercase().contains("loopback") || description.is_empty())
        .filter(|(name, description)| {
            let line = format!("{name} {description}").to_lowercase();
            line.contains("loopback")
        })
        .map(|(name, _description)| AudioDevice { id: name.clone(), name })
        .collect()
}

fn parse_quoted_devices(text: &str, section_needle: &str) -> Vec<AudioDevice> {
    let mut in_section = section_needle.is_empty();
    let mut devices = Vec::new();
    for line in text.lines() {
        let lower = line.to_lowercase();
        if lower.contains(section_needle) {
            in_section = true;
            continue;
        }
        if in_section && (lower.contains("video devices") || lower.contains("directshow video")) {
            break;
        }
        if !in_section {
            continue;
        }
        for (name, _) in quoted_devices(line) {
            devices.push(AudioDevice { id: name.clone(), name });
        }
    }
    devices
}

fn quoted_devices(text: &str) -> Vec<(String, String)> {
    let mut found = Vec::new();
    for line in text.lines() {
        let Some(start) = line.find('"') else { continue };
        let Some(end) = line[start + 1..].find('"') else { continue };
        let name = line[start + 1..start + 1 + end].trim().to_string();
        if name.is_empty() {
            continue;
        }
        let rest = &line[start + 1 + end + 1..];
        let description = rest
            .find('(')
            .and_then(|open| rest[open + 1..].find(')').map(|close| rest[open + 1..open + 1 + close].trim().to_string()))
            .unwrap_or_default();
        found.push((name, description));
    }
    found
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pactl_splits_monitors_from_microphones() {
        let text = "\
0\talisa_output.pci.analog-stereo.monitor\tmodule\ts16le\tRUNNING
1\talisa_input.pci.analog-stereo\tmodule\ts16le\tRUNNING
";
        let (mics, system) = parse_pactl_short(text);
        assert_eq!(mics.len(), 1);
        assert_eq!(system.len(), 1);
        assert!(system[0].id.ends_with(".monitor"));
    }

    #[test]
    fn avfoundation_treats_blackhole_as_system_audio() {
        let text = "\
[AVFoundation] AVFoundation video devices:
[AVFoundation] [0] Capture screen 0
[AVFoundation] AVFoundation audio devices:
[AVFoundation] [0] MacBook Pro Microphone
[AVFoundation] [1] BlackHole 2ch
";
        let (mics, system) = parse_avfoundation_audio(text);
        assert_eq!(mics[0].name, "MacBook Pro Microphone");
        assert_eq!(system[0].id, "1");
    }

    #[test]
    fn wasapi_ignores_devices_that_are_not_loopback() {
        let text = "\
[wasapi] \"Microphone (Realtek)\" (capture)
[wasapi] \"Speakers (Realtek)\" (loopback)
";
        let system = parse_wasapi_loopback(text);
        assert_eq!(system.len(), 1);
        assert_eq!(system[0].name, "Speakers (Realtek)");
    }
}
