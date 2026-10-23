//! Global pointer sampling for click-to-zoom.
//!
//! On Linux, device_query reports coordinates relative to a child window, so
//! the root pointer comes from XQueryPointer. The button edge is recorded only
//! after a sample is applied; a contended session lock must not swallow it.

use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use crate::geom::PointerOrigin;
use crate::session::Session;

#[derive(Clone, Copy, Debug)]
pub struct PointerSample {
    pub x: f64,
    pub y: f64,
    pub pressed: bool,
    pub origin: PointerOrigin,
    pub pixel_space: bool,
}

pub fn start(session: Arc<Mutex<Session>>) {
    let _ = thread::Builder::new().name("spool-pointer".into()).spawn(move || {
        let mut sampler = Sampler::open();
        let mut was_pressed = false;
        loop {
            if let Some(sample) = sampler.poll() {
                if let Some(mut guard) = try_session(&session) {
                    guard.note_pointer(&sample, was_pressed);
                    was_pressed = sample.pressed;
                }
            }
            thread::sleep(Duration::from_millis(16));
        }
    });
}

fn try_session(session: &Mutex<Session>) -> Option<std::sync::MutexGuard<'_, Session>> {
    match session.try_lock() {
        Ok(guard) => Some(guard),
        Err(std::sync::TryLockError::Poisoned(poisoned)) => Some(poisoned.into_inner()),
        Err(std::sync::TryLockError::WouldBlock) => None,
    }
}

#[cfg(target_os = "linux")]
struct Sampler {
    display: *mut x11::xlib::Display,
}

#[cfg(target_os = "linux")]
impl Sampler {
    fn open() -> Self {
        Self { display: unsafe { x11::xlib::XOpenDisplay(std::ptr::null()) } }
    }

    fn poll(&mut self) -> Option<PointerSample> {
        if self.display.is_null() {
            return None;
        }
        unsafe {
            let root = x11::xlib::XDefaultRootWindow(self.display);
            let mut root_return: x11::xlib::Window = 0;
            let mut child_return: x11::xlib::Window = 0;
            let mut root_x: std::os::raw::c_int = 0;
            let mut root_y: std::os::raw::c_int = 0;
            let mut win_x: std::os::raw::c_int = 0;
            let mut win_y: std::os::raw::c_int = 0;
            let mut mask: std::os::raw::c_uint = 0;
            let ok = x11::xlib::XQueryPointer(
                self.display,
                root,
                &mut root_return,
                &mut child_return,
                &mut root_x,
                &mut root_y,
                &mut win_x,
                &mut win_y,
                &mut mask,
            );
            if ok == 0 {
                return None;
            }
            Some(PointerSample {
                x: root_x as f64,
                y: root_y as f64,
                pressed: mask & x11::xlib::Button1Mask != 0,
                origin: PointerOrigin::TopLeft,
                pixel_space: true,
            })
        }
    }
}

#[cfg(not(target_os = "linux"))]
struct Sampler {
    device: Option<device_query::DeviceState>,
}

#[cfg(not(target_os = "linux"))]
impl Sampler {
    fn open() -> Self {
        Self { device: device_query::DeviceState::checked_new() }
    }

    fn poll(&mut self) -> Option<PointerSample> {
        let device = self.device.as_ref()?;
        let mouse = device_query::DeviceQuery::get_mouse(device);
        let pressed = mouse.button_pressed.get(1).copied().unwrap_or(false);
        Some(PointerSample {
            x: mouse.coords.0 as f64,
            y: mouse.coords.1 as f64,
            pressed,
            origin: if cfg!(target_os = "macos") { PointerOrigin::BottomLeft } else { PointerOrigin::TopLeft },
            pixel_space: !cfg!(target_os = "macos"),
        })
    }
}
