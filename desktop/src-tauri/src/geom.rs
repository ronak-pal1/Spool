//! Coordinate conversion shared by capture, overlays, and click hit-testing.
//!
//! xcap reports monitor geometry in logical pixels on Linux and macOS, and in
//! physical pixels on Windows. Linux window geometry is physical. Overlays are
//! placed in logical pixels; ffmpeg and click hit-testing use the pixel rect.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ReportedSpace {
    Logical,
    Physical,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum PointerOrigin {
    TopLeft,
    /// macOS `NSEvent` mouse location grows upward from the primary display.
    BottomLeft,
}

#[derive(Clone, Copy, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RectF {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct RectI {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

#[derive(Clone, Debug)]
pub struct CaptureGeometry {
    pub logical: RectF,
    pub pixel_x: i32,
    pub pixel_y: i32,
    pub pixel_w: u32,
    pub pixel_h: u32,
    pub scale: f64,
    pub screen_index: usize,
    pub pointer_baseline: f64,
    pub label: String,
    pub crop: bool,
    pub crop_x: u32,
    pub crop_y: u32,
}

impl CaptureGeometry {
    pub fn capture_pixel(&self) -> RectI {
        RectI {
            x: self.pixel_x,
            y: self.pixel_y,
            width: even_dim(self.pixel_w),
            height: even_dim(self.pixel_h),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CameraSize {
    S,
    M,
    L,
    Full,
}

impl CameraSize {
    pub fn parse(value: &str) -> Self {
        match value {
            "s" | "S" => Self::S,
            "l" | "L" => Self::L,
            "full" | "Full" => Self::Full,
            _ => Self::M,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::S => "s",
            Self::M => "m",
            Self::L => "l",
            Self::Full => "full",
        }
    }

    fn side(self) -> f64 {
        match self {
            Self::S => 128.0,
            Self::M => 196.0,
            Self::L => 300.0,
            Self::Full => 0.0,
        }
    }
}

#[derive(Clone, Copy, Debug)]
pub struct OverlayLayout {
    pub bar: RectF,
    pub camera: Option<RectF>,
    pub draw: RectF,
}

pub fn even_dim(value: u32) -> u32 {
    let value = value.max(2);
    value - (value % 2)
}

pub fn finite_scale(scale: f64) -> f64 {
    if scale.is_finite() && scale > 0.05 {
        scale
    } else {
        1.0
    }
}

pub fn from_reported(x: i32, y: i32, width: u32, height: u32, scale: f64, space: ReportedSpace) -> (RectF, i32, i32, u32, u32) {
    let scale = finite_scale(scale);
    match space {
        ReportedSpace::Logical => {
            let logical = RectF {
                x: x as f64,
                y: y as f64,
                width: width as f64,
                height: height as f64,
            };
            let px = (x as f64 * scale).round() as i32;
            let py = (y as f64 * scale).round() as i32;
            let pw = (width as f64 * scale).round().max(2.0) as u32;
            let ph = (height as f64 * scale).round().max(2.0) as u32;
            (logical, px, py, pw, ph)
        }
        ReportedSpace::Physical => {
            let logical = RectF {
                x: x as f64 / scale,
                y: y as f64 / scale,
                width: width as f64 / scale,
                height: height as f64 / scale,
            };
            (logical, x, y, width.max(2), height.max(2))
        }
    }
}

/// `rel` is logical and relative to the monitor's logical origin.
pub fn area_within_monitor(
    monitor_logical: RectF,
    pixel_x: i32,
    pixel_y: i32,
    scale: f64,
    rel: RectF,
) -> Result<(RectF, i32, i32, u32, u32), String> {
    if !rel.width.is_finite() || !rel.height.is_finite() || rel.width < 64.0 || rel.height < 64.0 {
        return Err("Select an area at least 64×64.".into());
    }
    let scale = finite_scale(scale);
    let rel_x = rel.x.clamp(0.0, monitor_logical.width.max(0.0));
    let rel_y = rel.y.clamp(0.0, monitor_logical.height.max(0.0));
    let rel_w = rel.width.min((monitor_logical.width - rel_x).max(0.0));
    let rel_h = rel.height.min((monitor_logical.height - rel_y).max(0.0));
    if rel_w < 64.0 || rel_h < 64.0 {
        return Err("Select an area at least 64×64.".into());
    }
    let logical = RectF {
        x: monitor_logical.x + rel_x,
        y: monitor_logical.y + rel_y,
        width: rel_w,
        height: rel_h,
    };
    let px = pixel_x + (rel_x * scale).round() as i32;
    let py = pixel_y + (rel_y * scale).round() as i32;
    let pw = (rel_w * scale).round().max(2.0) as u32;
    let ph = (rel_h * scale).round().max(2.0) as u32;
    Ok((logical, px, py, pw, ph))
}

pub fn layout_overlays(capture: RectF, camera: Option<CameraSize>) -> OverlayLayout {
    let bw = 640.0_f64.min(capture.width.max(1.0));
    let bh = 88.0_f64.min(capture.height.max(1.0));
    let mut bar_y = capture.y + capture.height - bh - 28.0;
    if bar_y < capture.y {
        bar_y = capture.y;
    }
    let bar = RectF {
        x: capture.x + (capture.width - bw) / 2.0,
        y: bar_y,
        width: bw,
        height: bh,
    };
    let camera = camera.map(|size| match size {
        CameraSize::Full => capture,
        other => {
            let side = other.side().min(capture.width.max(1.0)).min(capture.height.max(1.0));
            let mut x = capture.x + 24.0;
            let mut y = capture.y + capture.height - side - 40.0;
            if x + side > capture.x + capture.width {
                x = capture.x + capture.width - side;
            }
            if y < capture.y {
                y = capture.y;
            }
            RectF {
                x,
                y,
                width: side,
                height: side,
            }
        }
    });
    OverlayLayout { bar, camera, draw: capture }
}

pub fn round_secs(seconds: f64) -> f64 {
    if !seconds.is_finite() {
        return 0.0;
    }
    (seconds.max(0.0) * 100.0).round() / 100.0
}

pub fn hit_test(x: f64, y: f64, origin_x: f64, origin_y: f64, width: f64, height: f64) -> Option<(f64, f64)> {
    if width <= 1.0 || height <= 1.0 {
        return None;
    }
    let nx = (x - origin_x) / width;
    let ny = (y - origin_y) / height;
    if (0.0..=1.0).contains(&nx) && (0.0..=1.0).contains(&ny) {
        Some(((nx * 10_000.0).round() / 10_000.0, (ny * 10_000.0).round() / 10_000.0))
    } else {
        None
    }
}

pub fn flip_pointer_y(y: f64, baseline: f64, origin: PointerOrigin) -> f64 {
    match origin {
        PointerOrigin::TopLeft => y,
        PointerOrigin::BottomLeft => baseline - y,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn logical_monitor_scales_to_pixels() {
        let (logical, px, py, pw, ph) = from_reported(10, 20, 1440, 900, 2.0, ReportedSpace::Logical);
        assert_eq!(logical.width, 1440.0);
        assert_eq!((px, py, pw, ph), (20, 40, 2880, 1800));
    }

    #[test]
    fn physical_window_divides_into_logical() {
        let (logical, px, py, pw, ph) = from_reported(100, 50, 800, 601, 2.0, ReportedSpace::Physical);
        assert_eq!(logical, RectF { x: 50.0, y: 25.0, width: 400.0, height: 300.5 });
        assert_eq!((px, py, pw, ph), (100, 50, 800, 601));
        assert_eq!(even_dim(ph), 600);
    }

    #[test]
    fn area_is_monitor_origin_plus_scaled_offset() {
        let monitor = RectF { x: 100.0, y: 0.0, width: 1000.0, height: 800.0 };
        let (logical, px, py, pw, ph) = area_within_monitor(monitor, 200, 0, 2.0, RectF { x: 10.0, y: 20.0, width: 100.0, height: 80.0 }).unwrap();
        assert_eq!(logical.x, 110.0);
        assert_eq!(logical.y, 20.0);
        assert_eq!((px, py, pw, ph), (220, 40, 200, 160));
    }

    #[test]
    fn tiny_area_is_rejected() {
        let monitor = RectF { x: 0.0, y: 0.0, width: 800.0, height: 600.0 };
        let err = area_within_monitor(monitor, 0, 0, 1.0, RectF { x: 0.0, y: 0.0, width: 20.0, height: 20.0 }).unwrap_err();
        assert!(err.contains("64"));
    }

    #[test]
    fn overlays_sit_inside_the_capture() {
        let capture = RectF { x: 0.0, y: 0.0, width: 1280.0, height: 720.0 };
        let layout = layout_overlays(capture, Some(CameraSize::S));
        assert_eq!(layout.bar.width, 640.0);
        assert_eq!(layout.bar.x, 320.0);
        assert!(layout.bar.y + layout.bar.height <= 720.0);
        let camera = layout.camera.unwrap();
        assert_eq!(camera.width, 128.0);
        assert_eq!((camera.x, camera.y), (24.0, 720.0 - 128.0 - 40.0));
        assert_eq!(layout.draw, capture);
    }

    #[test]
    fn hit_test_normalizes_and_rejects_outside() {
        assert_eq!(hit_test(10.0, 10.0, 0.0, 0.0, 100.0, 50.0), Some((0.1, 0.2)));
        assert_eq!(hit_test(-1.0, 0.0, 0.0, 0.0, 100.0, 50.0), None);
    }

    #[test]
    fn bottom_left_pointer_flips_around_the_primary_baseline() {
        assert_eq!(flip_pointer_y(100.0, 900.0, PointerOrigin::BottomLeft), 800.0);
        assert_eq!(flip_pointer_y(100.0, 900.0, PointerOrigin::TopLeft), 100.0);
    }
}
