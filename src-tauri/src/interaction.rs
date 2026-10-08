//! Rainmeter-style hit testing: click-through by default, proximity fade, and a
//! held modifier that solids only the element under the cursor.

use crate::config::InteractionConfig;
use device_query::{DeviceQuery, DeviceState, Keycode};
use serde::Serialize;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

#[derive(Debug, Clone)]
pub struct HitRect {
    pub id: String,
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    /// Higher paints above. Used when two rects both contain the cursor.
    pub z: i32,
    /// Circular avatar: capture and fade use distance from the centre.
    pub round: bool,
}

pub struct InteractionHub {
    pub rects: Mutex<Vec<HitRect>>,
    /// Element ids that stay solid while focused (center chat, settings card).
    pub latched_ids: Mutex<Vec<String>>,
    pub config: Mutex<InteractionConfig>,
    pub supported: bool,
}

impl InteractionHub {
    pub fn new() -> Self {
        Self {
            rects: Mutex::new(Vec::new()),
            latched_ids: Mutex::new(Vec::new()),
            config: Mutex::new(InteractionConfig::default()),
            supported: platform_supports_global_input(),
        }
    }
}

pub fn platform_supports_global_input() -> bool {
    #[cfg(target_os = "linux")]
    {
        std::env::var_os("DISPLAY").is_some()
    }
    #[cfg(not(target_os = "linux"))]
    {
        true
    }
}

pub fn modifier_held(keys: &[Keycode], modifier: &str) -> bool {
    match modifier {
        "shift" => keys
            .iter()
            .any(|key| matches!(key, Keycode::LShift | Keycode::RShift)),
        "alt" => keys.iter().any(|key| {
            matches!(
                key,
                Keycode::LAlt | Keycode::RAlt | Keycode::LOption | Keycode::ROption
            )
        }),
        _ => keys
            .iter()
            .any(|key| matches!(key, Keycode::LControl | Keycode::RControl)),
    }
}

pub fn distance_to_hit(px: f64, py: f64, rect: &HitRect) -> f64 {
    if !rect.round {
        return distance_to_rect(px, py, rect);
    }
    let radius = rect.w.min(rect.h) / 2.0;
    let dx = px - (rect.x + rect.w / 2.0);
    let dy = py - (rect.y + rect.h / 2.0);
    ((dx * dx + dy * dy).sqrt() - radius).max(0.0)
}

pub fn distance_to_rect(px: f64, py: f64, rect: &HitRect) -> f64 {
    let dx = if px < rect.x {
        rect.x - px
    } else if px > rect.x + rect.w {
        px - (rect.x + rect.w)
    } else {
        0.0
    };
    let dy = if py < rect.y {
        rect.y - py
    } else if py > rect.y + rect.h {
        py - (rect.y + rect.h)
    } else {
        0.0
    };
    (dx * dx + dy * dy).sqrt()
}

pub fn opacity_for_distance(
    distance: f64,
    fade_distance: f64,
    min_opacity: f64,
    enabled: bool,
) -> f64 {
    if !enabled {
        return 1.0;
    }
    if fade_distance <= 0.0 {
        return min_opacity;
    }
    if distance >= fade_distance {
        return 1.0;
    }
    if distance <= 0.0 {
        return min_opacity;
    }
    min_opacity + (1.0 - min_opacity) * (distance / fade_distance)
}

/// Extra CSS pixels around a hit rect that still count as "under the cursor".
pub const HIT_MARGIN_PX: f64 = 12.0;

/// The single element whose rect (plus margin) contains the cursor.
/// A point inside a rect beats a neighbour that is only within the margin.
/// When distances tie, a latched panel wins, then the higher z-order, then the smaller rect.
pub fn element_under_cursor<'a>(
    cursor: Option<(f64, f64)>,
    rects: &'a [HitRect],
    margin: f64,
    latched_ids: &[String],
) -> Option<&'a HitRect> {
    let (x, y) = cursor?;
    let mut best: Option<usize> = None;
    for (index, rect) in rects.iter().enumerate() {
        let distance = distance_to_hit(x, y, rect);
        if distance > margin {
            continue;
        }
        let replace = match best {
            None => true,
            Some(best_index) => prefers_hit(rect, distance, latched_ids, &rects[best_index], x, y),
        };
        if replace {
            best = Some(index);
        }
    }
    best.map(|index| &rects[index])
}

fn prefers_hit(
    candidate: &HitRect,
    candidate_distance: f64,
    latched_ids: &[String],
    current: &HitRect,
    x: f64,
    y: f64,
) -> bool {
    let current_distance = distance_to_hit(x, y, current);
    if candidate_distance < current_distance - f64::EPSILON {
        return true;
    }
    if candidate_distance > current_distance + f64::EPSILON {
        return false;
    }
    let candidate_latched = id_listed(latched_ids, &candidate.id);
    let current_latched = id_listed(latched_ids, &current.id);
    if candidate_latched != current_latched {
        return candidate_latched;
    }
    if candidate.z != current.z {
        return candidate.z > current.z;
    }
    candidate.w * candidate.h < current.w * current.h
}

#[derive(Debug, Clone, PartialEq)]
pub struct ElementFrame {
    pub id: String,
    pub opacity: f64,
    pub capture: bool,
}

fn round_opacity(opacity: f64) -> f64 {
    (opacity * 100.0).round() / 100.0
}

fn id_listed(ids: &[String], id: &str) -> bool {
    ids.iter().any(|item| item == id)
}

/// Per-element Rainmeter frame.
/// Holding the modifier solids and captures only the element under the cursor.
/// Latched ids stay solid; they capture only while the cursor is over that element.
/// A missing cursor does not capture and does not change fade.
pub fn interaction_frame(
    held: bool,
    latched_ids: &[String],
    cursor: Option<(f64, f64)>,
    rects: &[HitRect],
    margin: f64,
    cfg: &InteractionConfig,
) -> Vec<ElementFrame> {
    let under =
        element_under_cursor(cursor, rects, margin, latched_ids).map(|rect| rect.id.clone());
    rects
        .iter()
        .map(|rect| {
            let latched = id_listed(latched_ids, &rect.id);
            let targeted = held && under.as_deref() == Some(rect.id.as_str());
            let forced = latched || targeted;
            let opacity = match cursor {
                Some((x, y)) => element_opacity(forced, distance_to_hit(x, y, rect), cfg),
                None => 1.0,
            };
            let capture = under.as_deref() == Some(rect.id.as_str()) && (held || latched);
            ElementFrame {
                id: rect.id.clone(),
                opacity: round_opacity(opacity),
                capture,
            }
        })
        .collect()
}

/// Whose window owns OS focus.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FocusOwner {
    /// This app's window, its frame, or a popup that belongs to it.
    Own,
    /// Another window is focused. On Windows and macOS this is another process.
    Other,
    /// The foreground window could not be read, or this app's window id is not known yet.
    Unknown,
}

pub fn classify_focus_owner(focused_pid: Option<u32>, self_pid: u32) -> FocusOwner {
    match focused_pid {
        Some(pid) if pid == self_pid => FocusOwner::Own,
        Some(_) => FocusOwner::Other,
        None => FocusOwner::Unknown,
    }
}

/// Linux focus, compared by X11 window id.
/// `own` is this app's client window ids.
/// `own_ancestors` are parents of those windows, excluding the root.
/// `active_ancestors` are parents of the active window, excluding the root.
/// `active_transient_for` is the WM_TRANSIENT_FOR chain of the active window.
/// A missing pid must not matter: any other non-zero window is another app.
pub fn classify_window_ids(
    active: Option<u64>,
    own: &[u64],
    own_ancestors: &[u64],
    active_ancestors: &[u64],
    active_transient_for: &[u64],
) -> FocusOwner {
    if own.is_empty() {
        return FocusOwner::Unknown;
    }
    let Some(active) = active.filter(|id| *id != 0) else {
        return FocusOwner::Unknown;
    };
    let ours = |id: u64| own.iter().any(|own_id| *own_id == id);
    if ours(active) || own_ancestors.iter().any(|id| *id == active) {
        return FocusOwner::Own;
    }
    if active_ancestors.iter().any(|id| ours(*id)) {
        return FocusOwner::Own;
    }
    if active_transient_for
        .iter()
        .any(|id| ours(*id) || own_ancestors.iter().any(|ancestor| *ancestor == *id))
    {
        return FocusOwner::Own;
    }
    FocusOwner::Other
}

pub fn focus_owner_name(owner: FocusOwner) -> &'static str {
    match owner {
        FocusOwner::Own => "own",
        FocusOwner::Other => "other",
        FocusOwner::Unknown => "unknown",
    }
}

/// One other-process sample stays unconfirmed so a popup mapping does not release the lock.
/// The second consecutive sample is another process. Our own process reports immediately.
pub fn confirm_focus_owner(previous_other_samples: u8, owner: FocusOwner) -> (FocusOwner, u8) {
    match owner {
        FocusOwner::Other => {
            let samples = previous_other_samples.saturating_add(1);
            if samples >= 2 {
                (FocusOwner::Other, samples)
            } else {
                (FocusOwner::Unknown, samples)
            }
        }
        other => (other, 0),
    }
}

pub fn current_focus_owner(window: &tauri::WebviewWindow) -> FocusOwner {
    let mut probe = FocusProbe::open();
    let ids = read_own_window_ids(window).unwrap_or_default();
    probe.owner(&ids)
}

pub fn install_option_menu_hook(window: &tauri::WebviewWindow) {
    #[cfg(target_os = "linux")]
    native_popup::install(window);
    #[cfg(not(target_os = "linux"))]
    {
        let _ = window;
    }
}

pub fn option_menu_is_open() -> bool {
    #[cfg(target_os = "linux")]
    {
        native_popup::is_open()
    }
    #[cfg(not(target_os = "linux"))]
    {
        false
    }
}

pub fn close_option_menu(window: &tauri::WebviewWindow) {
    #[cfg(target_os = "linux")]
    native_popup::close(window);
    #[cfg(not(target_os = "linux"))]
    {
        let _ = window;
    }
}

/// How a grabbed GTK widget is dismissed when another app takes focus.
/// `hide` and `seat.ungrab` leave the select so the next click is swallowed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GrabDismiss {
    /// `GtkMenuShell::cancel` then `deactivate`, after WebKit `menu.close()`.
    CancelDeactivate,
    /// `GtkPopover::popdown`.
    Popdown,
    /// Plain popup (WebKit's own select window). Send Escape with `widget.event`.
    /// Do not `hide` or ungrab the seat.
    Leave,
}

/// `GDK_KEY_Escape`. Delivered to the popup with `widget.event`.
pub const POPUP_CANCEL_KEYVAL: u32 = 0xff1b;
/// X11 hardware keycode for Escape. `gtk::test_widget_send_key` did not dismiss the popup.
pub const POPUP_CANCEL_KEYCODE: u16 = 9;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GrabKind {
    Menu,
    Popover,
    Other,
}

pub fn grab_dismiss(kind: GrabKind) -> GrabDismiss {
    match kind {
        GrabKind::Menu => GrabDismiss::CancelDeactivate,
        GrabKind::Popover => GrabDismiss::Popdown,
        GrabKind::Other => GrabDismiss::Leave,
    }
}

/// How long a pin toggle swallows `CloseRequested`. Alt+F4 and `wmctrl -c` quit after this.
pub const PIN_CLOSE_GUARD_MS: u64 = 1000;

/// `guard_until_ms == 0` means the guard was never armed.
pub fn close_refused_during_pin_guard(now_ms: u64, guard_until_ms: u64) -> bool {
    guard_until_ms != 0 && now_ms < guard_until_ms
}

fn pin_guard_until() -> &'static AtomicU64 {
    static UNTIL: AtomicU64 = AtomicU64::new(0);
    &UNTIL
}

fn mono_ms() -> u64 {
    static START: OnceLock<std::time::Instant> = OnceLock::new();
    START
        .get_or_init(std::time::Instant::now)
        .elapsed()
        .as_millis() as u64
}

/// Call immediately before `set_always_on_top`. A keep-above change on this
/// maximized frameless window can make the WM deliver delete for about a second.
pub fn arm_pin_close_guard() {
    let until = mono_ms().saturating_add(PIN_CLOSE_GUARD_MS);
    pin_guard_until().store(until, Ordering::Relaxed);
}

pub fn refuse_window_close() -> bool {
    close_refused_during_pin_guard(mono_ms(), pin_guard_until().load(Ordering::Relaxed))
}

/// Normal quit code for the settings button, the tray, and Unix signals.
pub const APP_EXIT_CODE: i32 = 0;

#[cfg(unix)]
pub const SIGINT: i32 = 2;
#[cfg(unix)]
pub const SIGTERM: i32 = 15;

#[cfg(unix)]
pub fn signal_requests_exit(sig: i32) -> bool {
    sig == SIGINT || sig == SIGTERM
}

#[cfg(target_os = "linux")]
mod native_popup {
    use std::cell::RefCell;
    use std::sync::atomic::{AtomicBool, Ordering};

    use gtk::prelude::*;
    use webkit2gtk::{OptionMenuExt, WebViewExt};

    fn flag() -> &'static AtomicBool {
        static FLAG: AtomicBool = AtomicBool::new(false);
        &FLAG
    }

    thread_local! {
        static SLOT: RefCell<Option<webkit2gtk::OptionMenu>> = const { RefCell::new(None) };
    }

    pub fn is_open() -> bool {
        flag().load(Ordering::Relaxed)
    }

    pub fn install(window: &tauri::WebviewWindow) {
        let _ = window.with_webview(|webview| {
            webview.inner().connect_show_option_menu(|_, menu, _, _| {
                menu.connect_close(|_| {
                    flag().store(false, Ordering::Relaxed);
                    SLOT.with(|slot| slot.replace(None));
                });
                SLOT.with(|slot| slot.replace(Some(menu.clone())));
                flag().store(true, Ordering::Relaxed);
                false
            });
        });
    }

    fn kind_of(widget: &gtk::Widget) -> super::GrabKind {
        if widget.downcast_ref::<gtk::Menu>().is_some() {
            super::GrabKind::Menu
        } else if widget.downcast_ref::<gtk::Popover>().is_some() {
            super::GrabKind::Popover
        } else {
            super::GrabKind::Other
        }
    }

    fn dismiss_widget(widget: &gtk::Widget) {
        match super::grab_dismiss(kind_of(widget)) {
            super::GrabDismiss::CancelDeactivate => {
                if let Some(menu) = widget.downcast_ref::<gtk::Menu>() {
                    menu.cancel();
                    menu.deactivate();
                }
            }
            super::GrabDismiss::Popdown => {
                if let Some(popover) = widget.downcast_ref::<gtk::Popover>() {
                    popover.popdown();
                }
            }
            super::GrabDismiss::Leave => {
                // WebKit draws <select> in its own GTK popup window, not a GtkMenu, and
                // webkit_option_menu_close() does not hide it. Deliver Escape straight to the
                // popup's key handler so WebKit runs its normal cancel path (hide, ungrab, notify).
                use gtk::glib::translate::{ToGlibPtr, ToGlibPtrMut};
                let Some(gdk_window) = widget.window() else {
                    return;
                };
                let mut ev = gtk::gdk::Event::new(gtk::gdk::EventType::KeyPress);
                unsafe {
                    let raw = <gtk::gdk::Event as ToGlibPtrMut<
                        *mut gtk::gdk::ffi::GdkEvent,
                    >>::to_glib_none_mut(&mut ev)
                    .0 as *mut gtk::gdk::ffi::GdkEventKey;
                    (*raw).window = gdk_window.to_glib_full();
                    (*raw).send_event = 1;
                    (*raw).keyval = super::POPUP_CANCEL_KEYVAL;
                    (*raw).hardware_keycode = super::POPUP_CANCEL_KEYCODE;
                }
                if let Some(keyboard) = widget
                    .display()
                    .default_seat()
                    .and_then(|seat| seat.keyboard())
                {
                    ev.set_device(Some(&keyboard));
                }
                let _ = widget.event(&ev);
            }
        }
    }

    pub fn close(window: &tauri::WebviewWindow) {
        flag().store(false, Ordering::Relaxed);
        let menu = SLOT.with(|slot| slot.replace(None));
        if let Some(menu) = menu {
            menu.close();
        }
        if let Some(widget) = gtk::grab_get_current() {
            dismiss_widget(&widget);
        }
        for toplevel in gtk::Window::list_toplevels() {
            if let Some(popup) = toplevel.downcast_ref::<gtk::Menu>() {
                if popup.is_visible() {
                    popup.cancel();
                    popup.deactivate();
                }
            }
        }
        let _ = window.set_ignore_cursor_events(true);
    }
}

/// A forced element (modifier target or latched panel) is full opacity at any distance.
pub fn element_opacity(solid: bool, distance: f64, cfg: &InteractionConfig) -> f64 {
    if solid {
        return 1.0;
    }
    opacity_for_distance(
        distance,
        cfg.fade_distance,
        cfg.min_opacity,
        cfg.fade_enabled,
    )
}

#[derive(Serialize)]
struct OpacityItem {
    id: String,
    opacity: f64,
    capture: bool,
}

pub fn spawn_poll(app: AppHandle, hub: Arc<InteractionHub>) {
    if !hub.supported {
        let _ = app.emit(
            "overlay-interaction",
            serde_json::json!({
                "type": "proximity",
                "supported": false,
                "solid": true,
                "opacities": []
            }),
        );
        return;
    }
    std::thread::spawn(move || {
        let Some(device) = DeviceState::checked_new() else {
            let _ = app.emit(
                "overlay-interaction",
                serde_json::json!({
                    "type": "proximity",
                    "supported": false,
                    "solid": true,
                    "opacities": []
                }),
            );
            return;
        };
        let mut last_signature = String::new();
        let mut ignoring: Option<bool> = None;
        let mut focus_probe = FocusProbe::open();
        let mut other_samples = 0u8;
        let mut closed_popup_for_other = false;
        let mut cached_window_ids: Option<Vec<u64>> = None;
        loop {
            std::thread::sleep(Duration::from_millis(16));
            let Some(window) = app.get_webview_window("main") else {
                continue;
            };
            let cfg = hub
                .config
                .lock()
                .unwrap_or_else(|err| err.into_inner())
                .clone();
            let latched_ids = hub
                .latched_ids
                .lock()
                .unwrap_or_else(|err| err.into_inner())
                .clone();
            let held = modifier_held(&device.get_keys(), &cfg.modifier);
            let rects = hub
                .rects
                .lock()
                .unwrap_or_else(|err| err.into_inner())
                .clone();
            let cursor = cursor_in_view(&window);
            let frames = interaction_frame(held, &latched_ids, cursor, &rects, HIT_MARGIN_PX, &cfg);
            let ignore = !frames.iter().any(|item| item.capture);
            if ignoring != Some(ignore) {
                if window.set_ignore_cursor_events(ignore).is_ok() {
                    ignoring = Some(ignore);
                }
            }
            let items: Vec<OpacityItem> = frames
                .iter()
                .map(|item| OpacityItem {
                    id: item.id.clone(),
                    opacity: item.opacity,
                    capture: item.capture,
                })
                .collect();
            if cached_window_ids.is_none() {
                cached_window_ids = read_own_window_ids(&window);
            }
            let raw_owner = focus_probe.owner(cached_window_ids.as_deref().unwrap_or(&[]));
            let (owner, samples) = confirm_focus_owner(other_samples, raw_owner);
            other_samples = samples;
            if owner == FocusOwner::Other {
                if !closed_popup_for_other && option_menu_is_open() {
                    if window.set_ignore_cursor_events(true).is_ok() {
                        ignoring = Some(true);
                    }
                    let app_handle = app.clone();
                    let _ = app.run_on_main_thread(move || {
                        if let Some(main) = app_handle.get_webview_window("main") {
                            close_option_menu(&main);
                        }
                    });
                }
                closed_popup_for_other = true;
            } else if owner == FocusOwner::Own {
                closed_popup_for_other = false;
            }
            let focus_owner = focus_owner_name(owner);
            let signature = format!(
                "{}|focus={focus_owner}",
                items
                    .iter()
                    .map(|item| format!("{}={:.2}:{}", item.id, item.opacity, item.capture))
                    .collect::<Vec<_>>()
                    .join("|")
            );
            if signature == last_signature {
                continue;
            }
            last_signature = signature;
            let _ = app.emit(
                "overlay-interaction",
                serde_json::json!({
                    "type": "proximity",
                    "supported": true,
                    "focus_owner": focus_owner,
                    "opacities": items,
                }),
            );
        }
    });
}

fn cursor_in_view(window: &tauri::WebviewWindow) -> Option<(f64, f64)> {
    let cursor = window.cursor_position().ok()?;
    let origin = window.inner_position().ok()?;
    let scale = window.scale_factor().ok()?;
    if scale <= 0.0 {
        return None;
    }
    Some((
        (cursor.x - f64::from(origin.x)) / scale,
        (cursor.y - f64::from(origin.y)) / scale,
    ))
}

struct FocusProbe {
    #[cfg(target_os = "linux")]
    display: *mut std::ffi::c_void,
}

impl FocusProbe {
    fn open() -> Self {
        #[cfg(target_os = "linux")]
        {
            Self {
                display: x11_focus::open_display(),
            }
        }
        #[cfg(not(target_os = "linux"))]
        {
            Self {}
        }
    }

    fn owner(&mut self, own_windows: &[u64]) -> FocusOwner {
        #[cfg(target_os = "linux")]
        {
            x11_focus::classify(self.display, own_windows)
        }
        #[cfg(target_os = "windows")]
        {
            let _ = own_windows;
            classify_focus_owner(windows_focus::focused_pid(), std::process::id())
        }
        #[cfg(target_os = "macos")]
        {
            let _ = own_windows;
            classify_focus_owner(macos_focus::focused_pid(), std::process::id())
        }
        #[cfg(not(any(target_os = "linux", target_os = "windows", target_os = "macos")))]
        {
            let _ = (self, own_windows);
            FocusOwner::Unknown
        }
    }
}

/// `None` means the X id is not realized yet and the caller should retry.
/// `Some(empty)` means this platform has no X window to compare.
fn read_own_window_ids(window: &tauri::WebviewWindow) -> Option<Vec<u64>> {
    #[cfg(target_os = "linux")]
    {
        linux_window_ids(window)
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = window;
        Some(Vec::new())
    }
}

#[cfg(target_os = "linux")]
fn linux_window_ids(window: &tauri::WebviewWindow) -> Option<Vec<u64>> {
    use raw_window_handle::{HasWindowHandle, RawWindowHandle};
    let handle = window.window_handle().ok()?;
    match handle.as_raw() {
        RawWindowHandle::Xlib(handle) => {
            let id = handle.window as u64;
            if id == 0 {
                None
            } else {
                Some(vec![id])
            }
        }
        RawWindowHandle::Xcb(handle) => Some(vec![u64::from(handle.window.get())]),
        _ => Some(Vec::new()),
    }
}

#[cfg(target_os = "linux")]
impl Drop for FocusProbe {
    fn drop(&mut self) {
        x11_focus::close_display(self.display);
    }
}

#[cfg(target_os = "linux")]
mod x11_focus {
    use std::ffi::{c_char, c_int, c_long, c_uint, c_ulong, c_void};
    use std::ptr;

    #[link(name = "X11")]
    extern "C" {
        fn XOpenDisplay(name: *const c_char) -> *mut c_void;
        fn XCloseDisplay(display: *mut c_void) -> c_int;
        fn XDefaultRootWindow(display: *mut c_void) -> c_ulong;
        fn XInternAtom(display: *mut c_void, name: *const c_char, only_if_exists: c_int)
            -> c_ulong;
        fn XGetWindowProperty(
            display: *mut c_void,
            window: c_ulong,
            property: c_ulong,
            long_offset: c_long,
            long_length: c_long,
            delete: c_int,
            req_type: c_ulong,
            actual_type_return: *mut c_ulong,
            actual_format_return: *mut c_int,
            nitems_return: *mut c_ulong,
            bytes_after_return: *mut c_ulong,
            prop_return: *mut *mut u8,
        ) -> c_int;
        fn XFree(data: *mut c_void) -> c_int;
        fn XQueryTree(
            display: *mut c_void,
            window: c_ulong,
            root_return: *mut c_ulong,
            parent_return: *mut c_ulong,
            children_return: *mut *mut c_ulong,
            nchildren_return: *mut c_uint,
        ) -> c_int;
        fn XSync(display: *mut c_void, discard: c_int) -> c_int;
        fn XSetErrorHandler(
            handler: Option<unsafe extern "C" fn(*mut c_void, *mut c_void) -> c_int>,
        ) -> Option<unsafe extern "C" fn(*mut c_void, *mut c_void) -> c_int>;
    }

    unsafe extern "C" fn swallow_error(_: *mut c_void, _: *mut c_void) -> c_int {
        0
    }

    pub fn open_display() -> *mut c_void {
        unsafe { XOpenDisplay(ptr::null()) }
    }

    pub fn close_display(display: *mut c_void) {
        if !display.is_null() {
            unsafe {
                XCloseDisplay(display);
            }
        }
    }

    pub fn classify(display: *mut c_void, own: &[u64]) -> super::FocusOwner {
        if display.is_null() || own.is_empty() {
            return super::FocusOwner::Unknown;
        }
        unsafe {
            let previous = XSetErrorHandler(Some(swallow_error));
            let owner = read_owner(display, own);
            XSync(display, 0);
            XSetErrorHandler(previous);
            owner
        }
    }

    unsafe fn read_owner(display: *mut c_void, own: &[u64]) -> super::FocusOwner {
        let Some(active_atom) = intern(display, b"_NET_ACTIVE_WINDOW\0") else {
            return super::FocusOwner::Unknown;
        };
        let root = XDefaultRootWindow(display);
        let active = read_ulong(display, root, active_atom).map(|id| id as u64);
        let own_ancestors = ancestors(display, own, root);
        let active_ancestors = match active {
            Some(id) if id != 0 => ancestors(display, &[id], root),
            _ => Vec::new(),
        };
        let transient = match active {
            Some(id) if id != 0 => transient_chain(display, id as c_ulong, root),
            _ => Vec::new(),
        };
        super::classify_window_ids(active, own, &own_ancestors, &active_ancestors, &transient)
    }

    unsafe fn ancestors(display: *mut c_void, seeds: &[u64], root: c_ulong) -> Vec<u64> {
        let mut out = Vec::new();
        for seed in seeds {
            let mut current = *seed as c_ulong;
            if current == 0 {
                continue;
            }
            for _ in 0..16 {
                let Some(parent) = query_parent(display, current) else {
                    break;
                };
                if parent == 0 || parent == current || parent == root {
                    break;
                }
                out.push(parent as u64);
                current = parent;
            }
        }
        out
    }

    unsafe fn transient_chain(display: *mut c_void, window: c_ulong, root: c_ulong) -> Vec<u64> {
        let Some(atom) = intern(display, b"WM_TRANSIENT_FOR\0") else {
            return Vec::new();
        };
        let mut out = Vec::new();
        let mut current = window;
        for _ in 0..8 {
            let Some(next) = read_ulong(display, current, atom) else {
                break;
            };
            if next == 0 || next == current || next == root {
                break;
            }
            out.push(next as u64);
            current = next;
        }
        out
    }

    unsafe fn query_parent(display: *mut c_void, window: c_ulong) -> Option<c_ulong> {
        let mut root = 0;
        let mut parent = 0;
        let mut children = ptr::null_mut();
        let mut nchildren = 0;
        let status = XQueryTree(
            display,
            window,
            &mut root,
            &mut parent,
            &mut children,
            &mut nchildren,
        );
        if !children.is_null() {
            XFree(children.cast());
        }
        if status == 0 {
            None
        } else {
            Some(parent)
        }
    }

    unsafe fn intern(display: *mut c_void, name: &[u8]) -> Option<c_ulong> {
        let atom = XInternAtom(display, name.as_ptr().cast(), 0);
        if atom == 0 {
            None
        } else {
            Some(atom)
        }
    }

    unsafe fn read_ulong(
        display: *mut c_void,
        window: c_ulong,
        property: c_ulong,
    ) -> Option<c_ulong> {
        let mut actual_type = 0;
        let mut actual_format = 0;
        let mut nitems = 0;
        let mut bytes_after = 0;
        let mut prop = ptr::null_mut();
        let status = XGetWindowProperty(
            display,
            window,
            property,
            0,
            1,
            0,
            0,
            &mut actual_type,
            &mut actual_format,
            &mut nitems,
            &mut bytes_after,
            &mut prop,
        );
        if status != 0 || prop.is_null() || nitems == 0 {
            if !prop.is_null() {
                XFree(prop.cast());
            }
            return None;
        }
        let value = *prop.cast::<c_ulong>();
        XFree(prop.cast());
        Some(value)
    }
}

#[cfg(target_os = "windows")]
mod windows_focus {
    use std::ffi::c_void;

    #[link(name = "user32")]
    extern "system" {
        fn GetForegroundWindow() -> *mut c_void;
        fn GetWindowThreadProcessId(hwnd: *mut c_void, process_id: *mut u32) -> u32;
    }

    pub fn focused_pid() -> Option<u32> {
        unsafe {
            let hwnd = GetForegroundWindow();
            if hwnd.is_null() {
                return None;
            }
            let mut pid = 0u32;
            GetWindowThreadProcessId(hwnd, &mut pid);
            if pid == 0 {
                None
            } else {
                Some(pid)
            }
        }
    }
}

#[cfg(target_os = "macos")]
mod macos_focus {
    use std::ffi::c_void;

    #[link(name = "AppKit", kind = "framework")]
    extern "C" {}

    #[link(name = "objc", kind = "dylib")]
    extern "C" {
        fn objc_getClass(name: *const u8) -> *mut c_void;
        fn sel_registerName(name: *const u8) -> *mut c_void;
        fn objc_msgSend();
    }

    pub fn focused_pid() -> Option<u32> {
        unsafe {
            let class = objc_getClass(b"NSWorkspace\0".as_ptr());
            if class.is_null() {
                return None;
            }
            let shared = msg(class, b"sharedWorkspace\0");
            if shared.is_null() {
                return None;
            }
            let app = msg(shared, b"frontmostApplication\0");
            if app.is_null() {
                return None;
            }
            let pid = msg_i32(app, b"processIdentifier\0");
            if pid <= 0 {
                None
            } else {
                Some(pid as u32)
            }
        }
    }

    unsafe fn msg(receiver: *mut c_void, selector: &[u8]) -> *mut c_void {
        let send: unsafe extern "C" fn(*mut c_void, *mut c_void) -> *mut c_void =
            std::mem::transmute(objc_msgSend as *const ());
        send(receiver, sel_registerName(selector.as_ptr()))
    }

    unsafe fn msg_i32(receiver: *mut c_void, selector: &[u8]) -> i32 {
        let send: unsafe extern "C" fn(*mut c_void, *mut c_void) -> i32 =
            std::mem::transmute(objc_msgSend as *const ());
        send(receiver, sel_registerName(selector.as_ptr()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rect() -> HitRect {
        HitRect {
            id: "center".into(),
            x: 100.0,
            y: 100.0,
            w: 40.0,
            h: 20.0,
            z: 0,
            round: false,
        }
    }

    #[test]
    fn modifier_ctrl_shift_alt() {
        assert!(modifier_held(&[Keycode::LControl], "ctrl"));
        assert!(modifier_held(&[Keycode::RControl], "ctrl"));
        assert!(!modifier_held(&[Keycode::LShift], "ctrl"));
        assert!(modifier_held(&[Keycode::RShift], "shift"));
        assert!(modifier_held(&[Keycode::LAlt], "alt"));
        assert!(modifier_held(&[Keycode::LOption], "alt"));
        assert!(!modifier_held(&[Keycode::A], "alt"));
    }

    #[test]
    fn distance_is_zero_inside_and_grows_outside() {
        let rect = rect();
        assert_eq!(distance_to_rect(110.0, 110.0, &rect), 0.0);
        assert!((distance_to_rect(100.0, 80.0, &rect) - 20.0).abs() < 0.001);
    }

    fn fade_cfg() -> InteractionConfig {
        InteractionConfig {
            modifier: "ctrl".into(),
            fade_enabled: true,
            fade_distance: 120.0,
            min_opacity: 0.18,
        }
    }

    fn bots() -> Vec<HitRect> {
        vec![
            HitRect {
                id: "a".into(),
                x: 0.0,
                y: 0.0,
                w: 40.0,
                h: 40.0,
                z: 0,
                round: false,
            },
            HitRect {
                id: "b".into(),
                x: 100.0,
                y: 0.0,
                w: 40.0,
                h: 40.0,
                z: 0,
                round: false,
            },
            HitRect {
                id: "center".into(),
                x: 0.0,
                y: 80.0,
                w: 120.0,
                h: 40.0,
                z: 0,
                round: false,
            },
        ]
    }

    fn frame_of<'a>(frames: &'a [ElementFrame], id: &str) -> &'a ElementFrame {
        frames.iter().find(|item| item.id == id).unwrap()
    }

    #[test]
    fn forced_solid_element_ignores_distance() {
        let cfg = fade_cfg();
        assert_eq!(element_opacity(true, 0.0, &cfg), 1.0);
        assert_eq!(element_opacity(true, 10_000.0, &cfg), 1.0);
        assert!((element_opacity(false, 0.0, &cfg) - 0.18).abs() < 0.001);
        assert_eq!(element_opacity(false, 120.0, &cfg), 1.0);
        assert_eq!(element_opacity(false, 400.0, &cfg), 1.0);
        let mid = element_opacity(false, 60.0, &cfg);
        assert!(mid > 0.18 && mid < 1.0);
    }

    #[test]
    fn modifier_far_from_elements_changes_nothing_and_does_not_capture() {
        let rects = bots();
        let cfg = fade_cfg();
        let far = Some((1000.0, 1000.0));
        let held = interaction_frame(true, &[], far, &rects, HIT_MARGIN_PX, &cfg);
        let idle = interaction_frame(false, &[], far, &rects, HIT_MARGIN_PX, &cfg);
        assert_eq!(held, idle);
        assert!(held.iter().all(|item| !item.capture));
        assert!(held.iter().all(|item| (item.opacity - 1.0).abs() < 0.001));

        let outside_margin = Some((70.0, 20.0));
        let near = interaction_frame(true, &[], outside_margin, &rects, HIT_MARGIN_PX, &cfg);
        let faded = interaction_frame(false, &[], outside_margin, &rects, HIT_MARGIN_PX, &cfg);
        assert_eq!(near, faded);
        assert!(frame_of(&near, "a").opacity < 1.0);
        assert!(!frame_of(&near, "a").capture);
    }

    #[test]
    fn modifier_solids_only_the_element_under_the_cursor() {
        let rects = bots();
        let cfg = fade_cfg();
        let over_a = interaction_frame(true, &[], Some((20.0, 20.0)), &rects, HIT_MARGIN_PX, &cfg);
        assert_eq!(frame_of(&over_a, "a").opacity, 1.0);
        assert!(frame_of(&over_a, "a").capture);
        assert!(frame_of(&over_a, "b").opacity < 1.0);
        assert!(!frame_of(&over_a, "b").capture);
        assert!(frame_of(&over_a, "center").opacity < 1.0);
        assert!(!frame_of(&over_a, "center").capture);
        assert_eq!(over_a.iter().filter(|item| item.capture).count(), 1);

        let over_b = interaction_frame(true, &[], Some((120.0, 20.0)), &rects, HIT_MARGIN_PX, &cfg);
        assert!(frame_of(&over_b, "a").opacity < 1.0);
        assert!(!frame_of(&over_b, "a").capture);
        assert_eq!(frame_of(&over_b, "b").opacity, 1.0);
        assert!(frame_of(&over_b, "b").capture);
        assert_eq!(over_b.iter().filter(|item| item.capture).count(), 1);

        let over_center =
            interaction_frame(true, &[], Some((40.0, 100.0)), &rects, HIT_MARGIN_PX, &cfg);
        assert_eq!(frame_of(&over_center, "center").opacity, 1.0);
        assert!(frame_of(&over_center, "center").capture);
        assert!(!frame_of(&over_center, "a").capture);
        assert!(!frame_of(&over_center, "b").capture);
    }

    #[test]
    fn latched_panel_stays_solid_and_captures_only_itself() {
        let rects = bots();
        let cfg = fade_cfg();
        let latched = vec!["center".to_string()];
        let cursor_on_a = Some((20.0, 20.0));
        let away = interaction_frame(false, &latched, cursor_on_a, &rects, HIT_MARGIN_PX, &cfg);
        assert_eq!(frame_of(&away, "center").opacity, 1.0);
        assert!(!frame_of(&away, "center").capture);
        assert!(frame_of(&away, "a").opacity < 1.0);
        assert!(away.iter().all(|item| !item.capture));

        let over_center = interaction_frame(
            false,
            &latched,
            Some((40.0, 100.0)),
            &rects,
            HIT_MARGIN_PX,
            &cfg,
        );
        assert!(frame_of(&over_center, "center").capture);
        assert!(!frame_of(&over_center, "a").capture);
        assert!(!frame_of(&over_center, "b").capture);
    }

    #[test]
    fn capture_follows_the_padded_rect_only_while_held() {
        let rects = [rect()];
        let cfg = fade_cfg();
        let inside =
            interaction_frame(true, &[], Some((110.0, 110.0)), &rects, HIT_MARGIN_PX, &cfg);
        let padded =
            interaction_frame(true, &[], Some((152.0, 110.0)), &rects, HIT_MARGIN_PX, &cfg);
        let outside =
            interaction_frame(true, &[], Some((170.0, 110.0)), &rects, HIT_MARGIN_PX, &cfg);
        let unheld = interaction_frame(
            false,
            &[],
            Some((110.0, 110.0)),
            &rects,
            HIT_MARGIN_PX,
            &cfg,
        );
        let missing = interaction_frame(true, &[], None, &rects, HIT_MARGIN_PX, &cfg);
        assert!(inside[0].capture && inside[0].opacity == 1.0);
        assert!(padded[0].capture && padded[0].opacity == 1.0);
        assert!(!outside[0].capture && outside[0].opacity < 1.0);
        assert!(!unheld[0].capture && unheld[0].opacity < 1.0);
        assert!(!missing[0].capture);
    }

    fn overlap_panels() -> Vec<HitRect> {
        vec![
            HitRect {
                id: "center".into(),
                x: 0.0,
                y: 0.0,
                w: 400.0,
                h: 500.0,
                z: 0,
                round: false,
            },
            HitRect {
                id: "settings".into(),
                x: 360.0,
                y: 40.0,
                w: 420.0,
                h: 640.0,
                z: 30,
                round: false,
            },
        ]
    }

    #[test]
    fn overlap_prefers_latched_settings_then_higher_z() {
        let rects = overlap_panels();
        let cfg = fade_cfg();
        let strip = Some((380.0, 80.0));
        let both = vec!["center".to_string(), "settings".to_string()];
        let latched = interaction_frame(false, &both, strip, &rects, HIT_MARGIN_PX, &cfg);
        assert!(frame_of(&latched, "settings").capture);
        assert!(!frame_of(&latched, "center").capture);
        assert_eq!(frame_of(&latched, "settings").opacity, 1.0);

        let only_settings = interaction_frame(
            false,
            &["settings".to_string()],
            strip,
            &rects,
            HIT_MARGIN_PX,
            &cfg,
        );
        assert!(frame_of(&only_settings, "settings").capture);
        assert!(!frame_of(&only_settings, "center").capture);

        let by_z = interaction_frame(true, &[], strip, &rects, HIT_MARGIN_PX, &cfg);
        assert!(frame_of(&by_z, "settings").capture);
        assert!(!frame_of(&by_z, "center").capture);

        let latched_center = interaction_frame(
            false,
            &["center".to_string()],
            strip,
            &rects,
            HIT_MARGIN_PX,
            &cfg,
        );
        assert!(frame_of(&latched_center, "center").capture);
        assert!(!frame_of(&latched_center, "settings").capture);
    }

    #[test]
    fn round_avatar_capture_uses_radius_plus_margin() {
        let orb = HitRect {
            id: "bot".into(),
            x: 0.0,
            y: 0.0,
            w: 100.0,
            h: 100.0,
            z: 0,
            round: true,
        };
        let cfg = fade_cfg();
        assert_eq!(distance_to_hit(50.0, 50.0, &orb), 0.0);
        let rim = distance_to_hit(110.0, 50.0, &orb);
        assert!((rim - 10.0).abs() < 0.001);
        let corner = distance_to_hit(100.0, 100.0, &orb);
        assert!(corner > HIT_MARGIN_PX);

        let inside = interaction_frame(
            true,
            &[],
            Some((50.0, 50.0)),
            &[orb.clone()],
            HIT_MARGIN_PX,
            &cfg,
        );
        let padded = interaction_frame(
            true,
            &[],
            Some((110.0, 50.0)),
            &[orb.clone()],
            HIT_MARGIN_PX,
            &cfg,
        );
        let bbox_corner = interaction_frame(
            true,
            &[],
            Some((100.0, 100.0)),
            &[orb.clone()],
            HIT_MARGIN_PX,
            &cfg,
        );
        assert!(inside[0].capture);
        assert!(padded[0].capture && padded[0].opacity == 1.0);
        assert!(!bbox_corner[0].capture);
        assert!(bbox_corner[0].opacity < 1.0);

        let mut square = orb;
        square.round = false;
        let square_corner = interaction_frame(
            true,
            &[],
            Some((100.0, 100.0)),
            &[square],
            HIT_MARGIN_PX,
            &cfg,
        );
        assert!(square_corner[0].capture);
    }

    #[test]
    fn focus_owner_is_own_process_or_another_process() {
        assert_eq!(classify_focus_owner(Some(10), 10), FocusOwner::Own);
        assert_eq!(classify_focus_owner(Some(11), 10), FocusOwner::Other);
        assert_eq!(classify_focus_owner(None, 10), FocusOwner::Unknown);
        assert_eq!(focus_owner_name(FocusOwner::Own), "own");
        assert_eq!(focus_owner_name(FocusOwner::Other), "other");
    }

    #[test]
    fn another_x_window_releases_without_a_pid() {
        let own = [10u64];
        assert_eq!(
            classify_window_ids(Some(10), &own, &[], &[], &[]),
            FocusOwner::Own
        );
        assert_eq!(
            classify_window_ids(Some(9), &own, &[9], &[], &[]),
            FocusOwner::Own
        );
        assert_eq!(
            classify_window_ids(Some(11), &own, &[], &[10], &[]),
            FocusOwner::Own
        );
        assert_eq!(
            classify_window_ids(Some(12), &own, &[], &[], &[10]),
            FocusOwner::Own
        );
        assert_eq!(
            classify_window_ids(Some(12), &own, &[9], &[], &[9]),
            FocusOwner::Own
        );
        assert_eq!(
            classify_window_ids(Some(99), &own, &[9], &[], &[]),
            FocusOwner::Other
        );
        assert_eq!(
            classify_window_ids(None, &own, &[], &[], &[]),
            FocusOwner::Unknown
        );
        assert_eq!(
            classify_window_ids(Some(0), &own, &[], &[], &[]),
            FocusOwner::Unknown
        );
        assert_eq!(
            classify_window_ids(Some(99), &[], &[], &[], &[]),
            FocusOwner::Unknown
        );
    }

    #[test]
    fn option_menu_close_cancels_a_menu_and_does_not_ungrab() {
        assert_eq!(grab_dismiss(GrabKind::Menu), GrabDismiss::CancelDeactivate);
        assert_eq!(grab_dismiss(GrabKind::Popover), GrabDismiss::Popdown);
        assert_eq!(grab_dismiss(GrabKind::Other), GrabDismiss::Leave);
        assert_eq!(POPUP_CANCEL_KEYVAL, 0xff1b);
        assert_eq!(POPUP_CANCEL_KEYCODE, 9);
        assert!(!close_refused_during_pin_guard(0, 0));
        assert!(close_refused_during_pin_guard(0, PIN_CLOSE_GUARD_MS));
        assert!(close_refused_during_pin_guard(999, PIN_CLOSE_GUARD_MS));
        assert!(!close_refused_during_pin_guard(
            PIN_CLOSE_GUARD_MS,
            PIN_CLOSE_GUARD_MS
        ));
        assert!(!close_refused_during_pin_guard(1500, PIN_CLOSE_GUARD_MS));
        assert_eq!(APP_EXIT_CODE, 0);
    }

    #[cfg(unix)]
    #[test]
    fn sigint_and_sigterm_request_app_exit() {
        assert!(signal_requests_exit(SIGINT));
        assert!(signal_requests_exit(SIGTERM));
        assert!(!signal_requests_exit(1));
    }

    #[test]
    fn other_process_focus_is_confirmed_on_the_second_sample() {
        let (first, samples) = confirm_focus_owner(0, FocusOwner::Other);
        assert_eq!(first, FocusOwner::Unknown);
        assert_eq!(samples, 1);
        let (second, _) = confirm_focus_owner(samples, FocusOwner::Other);
        assert_eq!(second, FocusOwner::Other);
        let (own, reset) = confirm_focus_owner(samples, FocusOwner::Own);
        assert_eq!(own, FocusOwner::Own);
        assert_eq!(reset, 0);
    }
}
