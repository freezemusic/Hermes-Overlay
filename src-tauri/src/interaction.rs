//! Hit testing. Panels stay opaque and capture the cursor until the modifier is held.
//! Orbs stay faded and click-through until the modifier is held over that orb.

use crate::config::InteractionConfig;
use device_query::{DeviceQuery, DeviceState, Keycode};
use serde::Serialize;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicU8, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};
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

/// Lone modifier wait. Shorter than the 120ms hover motion, long enough that
/// Ctrl+C / Ctrl+V is sampled before the HUD changes.
pub const MODIFIER_ARM: Duration = Duration::from_millis(100);

fn configured_modifier_key(key: &Keycode, modifier: &str) -> bool {
    match modifier {
        "shift" => matches!(key, Keycode::LShift | Keycode::RShift),
        "alt" => matches!(
            key,
            Keycode::LAlt | Keycode::RAlt | Keycode::LOption | Keycode::ROption
        ),
        _ => matches!(key, Keycode::LControl | Keycode::RControl),
    }
}

/// Any key beside the configured modifier. Ctrl+C / Ctrl+V is the case the
/// box measured, and Ctrl+another key is the same chord: it must not arm.
pub fn copy_paste_chord(keys: &[Keycode], modifier: &str) -> bool {
    if modifier == "shift" || modifier == "alt" {
        return false;
    }
    keys.iter()
        .any(|key| !configured_modifier_key(key, modifier))
}

/// Copy and paste stay at rest, including after C or V lifts while Ctrl is held.
/// A lone modifier becomes active after [`MODIFIER_ARM`].
pub fn modifier_engages(
    keys: &[Keycode],
    modifier: &str,
    now: Instant,
    armed_at: &mut Option<Instant>,
    suppressed: &mut bool,
) -> bool {
    if !modifier_held(keys, modifier) {
        *armed_at = None;
        *suppressed = false;
        return false;
    }
    if copy_paste_chord(keys, modifier) {
        *armed_at = None;
        *suppressed = true;
        return false;
    }
    if *suppressed {
        *armed_at = None;
        return false;
    }
    let start = armed_at.get_or_insert(now);
    now.saturating_duration_since(*start) >= MODIFIER_ARM
}

/// Physical modifier at the moment of a sample. A copy/paste chord does not count.
/// This is not the armed `KEY_DOWN` flag from the last poll.
pub fn modifier_physically_down(keys: &[Keycode], modifier: &str) -> bool {
    modifier_held(keys, modifier) && !copy_paste_chord(keys, modifier)
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

#[cfg_attr(not(test), allow(dead_code))]
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

/// Fade starts this far outside the orb hit circle (R-OB-05). Visual only.
pub const ORB_PROXIMITY_PX: f64 = 72.0;

/// How long a proximity publish keeps repeating after the target changes.
/// The fade is 160ms. The page samples inline opacity from these publishes,
/// so one edge is not enough and a paused animation frame must not stall it.
pub const ORB_FADE_EMIT: Duration = Duration::from_millis(168);

/// `true` when this poll should reach the page.
/// A new signature starts the hold. Repeats inside the hold keep the fade
/// moving. After the hold, an unchanged signature stays quiet.
pub fn proximity_emit_hold(
    changed: bool,
    now: Instant,
    hold_until: Option<Instant>,
    hold: Duration,
) -> (bool, Option<Instant>) {
    if changed {
        return (true, Some(now + hold));
    }
    match hold_until {
        Some(until) if now < until => (true, hold_until),
        _ => (false, None),
    }
}

/// Near-orb opacity. The settings floor defaults to 0.25 and never exceeds 0.30.
pub fn orb_near_opacity(min_opacity: f64) -> f64 {
    let floor = if min_opacity.is_finite() {
        min_opacity
    } else {
        0.25
    };
    floor.clamp(0.05, 0.30)
}

/// Bottom reserve when no work area is reported. A reported full-screen work area stays 0.
pub const WORK_AREA_FALLBACK_BOTTOM: u32 = 48;

/// CSS-pixel insets of the work area inside the monitor.
/// Rects are in one pixel space: x, y, width, height. Returns top, right, bottom, left.
/// A missing work rect becomes zeros here. Call `reported_work_insets` to tell that apart.
pub fn work_area_insets(
    monitor_x: i32,
    monitor_y: i32,
    monitor_w: i32,
    monitor_h: i32,
    work_x: i32,
    work_y: i32,
    work_w: i32,
    work_h: i32,
    scale: f64,
) -> (u32, u32, u32, u32) {
    reported_work_insets(
        monitor_x, monitor_y, monitor_w, monitor_h, work_x, work_y, work_w, work_h, scale,
    )
    .unwrap_or((0, 0, 0, 0))
}

/// `None` when the work rect was not reported. A work rect that matches the monitor is zeros.
pub fn reported_work_insets(
    monitor_x: i32,
    monitor_y: i32,
    monitor_w: i32,
    monitor_h: i32,
    work_x: i32,
    work_y: i32,
    work_w: i32,
    work_h: i32,
    scale: f64,
) -> Option<(u32, u32, u32, u32)> {
    if monitor_w <= 0 || monitor_h <= 0 || work_w <= 0 || work_h <= 0 {
        return None;
    }
    let scale = if scale.is_finite() && scale > 0.01 {
        scale
    } else {
        1.0
    };
    let px = |delta: i32| ((f64::from(delta) / scale).round().max(0.0)) as u32;
    let top = px(work_y - monitor_y);
    let left = px(work_x - monitor_x);
    let right = px((monitor_x + monitor_w) - (work_x + work_w));
    let bottom = px((monitor_y + monitor_h) - (work_y + work_h));
    Some((top, right, bottom, left))
}

/// EWMH `_NET_WM_STRUT_PARTIAL`. Widths are pixels in from the X screen edges.
#[derive(Clone, Copy, Debug)]
pub struct WmStrut {
    pub left: i32,
    pub right: i32,
    pub top: i32,
    pub bottom: i32,
    pub left_start: i32,
    pub left_end: i32,
    pub right_start: i32,
    pub right_end: i32,
    pub top_start: i32,
    pub top_end: i32,
    pub bottom_start: i32,
    pub bottom_end: i32,
}

fn ranges_overlap(a0: i32, a1: i32, b0: i32, b1: i32) -> bool {
    a0 <= b1 && b0 <= a1
}

fn strut_reserves(strut: &WmStrut) -> bool {
    strut.left > 0 || strut.right > 0 || strut.top > 0 || strut.bottom > 0
}

/// Shrink the monitor by struts and by `_NET_WORKAREA` (x, y, w, h).
/// `None` when neither source was reported. A full-screen work area is zeros.
pub fn insets_from_struts(
    monitor_x: i32,
    monitor_y: i32,
    monitor_w: i32,
    monitor_h: i32,
    screen_w: i32,
    screen_h: i32,
    struts: &[WmStrut],
    workarea: Option<(i32, i32, i32, i32)>,
    scale: f64,
) -> Option<(u32, u32, u32, u32)> {
    if monitor_w <= 0 || monitor_h <= 0 || screen_w <= 0 || screen_h <= 0 {
        return None;
    }
    let reserved: Vec<&WmStrut> = struts.iter().filter(|strut| strut_reserves(strut)).collect();
    if reserved.is_empty() && workarea.is_none() {
        return None;
    }
    let mut x = monitor_x;
    let mut y = monitor_y;
    let mut right = monitor_x + monitor_w;
    let mut bottom = monitor_y + monitor_h;
    let mx1 = monitor_x + monitor_w - 1;
    let my1 = monitor_y + monitor_h - 1;
    for strut in reserved {
        if strut.left > 0 && ranges_overlap(strut.left_start, strut.left_end, monitor_y, my1) {
            x = x.max(strut.left);
        }
        if strut.right > 0 && ranges_overlap(strut.right_start, strut.right_end, monitor_y, my1) {
            right = right.min(screen_w - strut.right);
        }
        if strut.top > 0 && ranges_overlap(strut.top_start, strut.top_end, monitor_x, mx1) {
            y = y.max(strut.top);
        }
        if strut.bottom > 0 && ranges_overlap(strut.bottom_start, strut.bottom_end, monitor_x, mx1)
        {
            bottom = bottom.min(screen_h - strut.bottom);
        }
    }
    if let Some((wx, wy, ww, wh)) = workarea {
        if ww > 0 && wh > 0 {
            x = x.max(wx);
            y = y.max(wy);
            right = right.min(wx + ww);
            bottom = bottom.min(wy + wh);
        }
    }
    let width = right - x;
    let height = bottom - y;
    if width <= 0 || height <= 0 {
        return None;
    }
    reported_work_insets(
        monitor_x, monitor_y, monitor_w, monitor_h, x, y, width, height, scale,
    )
}

fn inset_weight(insets: (u32, u32, u32, u32)) -> u32 {
    insets
        .0
        .saturating_add(insets.1)
        .saturating_add(insets.2)
        .saturating_add(insets.3)
}

/// Linux bottom clearance. A dock that reports no strut still keeps 48px.
/// Top, left, and right stay as reported. Windows does not call this.
pub fn floor_bottom_inset(insets: (u32, u32, u32, u32)) -> (u32, u32, u32, u32) {
    (
        insets.0,
        insets.1,
        insets.2.max(WORK_AREA_FALLBACK_BOTTOM),
        insets.3,
    )
}

/// The largest reported inset wins, so a dock strut beats a zero GDK read.
/// Every `None` means the work area was not reported: reserve the bottom.
pub fn pick_reported_insets(reads: &[Option<(u32, u32, u32, u32)>]) -> (u32, u32, u32, u32) {
    let mut best: Option<(u32, u32, u32, u32)> = None;
    for read in reads {
        let Some(insets) = *read else {
            continue;
        };
        best = Some(match best {
            None => insets,
            Some(current) => {
                if inset_weight(insets) > inset_weight(current) {
                    insets
                } else {
                    current
                }
            }
        });
    }
    best.unwrap_or((0, 0, WORK_AREA_FALLBACK_BOTTOM, 0))
}

#[cfg(target_os = "linux")]
fn x_monitor_space(
    monitor_x: i32,
    monitor_y: i32,
    monitor_w: i32,
    monitor_h: i32,
    screen_w: i32,
    screen_h: i32,
    scale: f64,
) -> (i32, i32, i32, i32, f64) {
    let inside = |x: i32, y: i32, w: i32, h: i32| {
        w > 0 && h > 0 && x >= -1 && y >= -1 && x + w <= screen_w + 2 && y + h <= screen_h + 2
    };
    if inside(monitor_x, monitor_y, monitor_w, monitor_h) {
        return (monitor_x, monitor_y, monitor_w, monitor_h, scale);
    }
    let scale = if scale.is_finite() && scale > 1.01 {
        scale
    } else {
        1.0
    };
    let logical_x = (f64::from(monitor_x) / scale).round() as i32;
    let logical_y = (f64::from(monitor_y) / scale).round() as i32;
    let logical_w = (f64::from(monitor_w) / scale).round() as i32;
    let logical_h = (f64::from(monitor_h) / scale).round() as i32;
    if inside(logical_x, logical_y, logical_w, logical_h) {
        return (logical_x, logical_y, logical_w, logical_h, 1.0);
    }
    let screen_scale = if (screen_h - monitor_h).abs() <= 2 {
        scale
    } else {
        1.0
    };
    (0, 0, screen_w, screen_h, screen_scale)
}

#[cfg(target_os = "linux")]
fn card_at(values: &[u32], index: usize) -> i32 {
    values.get(index).copied().unwrap_or(0) as i32
}

#[cfg(target_os = "linux")]
fn strut_from_partial(values: &[u32]) -> WmStrut {
    WmStrut {
        left: card_at(values, 0),
        right: card_at(values, 1),
        top: card_at(values, 2),
        bottom: card_at(values, 3),
        left_start: card_at(values, 4),
        left_end: card_at(values, 5),
        right_start: card_at(values, 6),
        right_end: card_at(values, 7),
        top_start: card_at(values, 8),
        top_end: card_at(values, 9),
        bottom_start: card_at(values, 10),
        bottom_end: card_at(values, 11),
    }
}

#[cfg(target_os = "linux")]
fn strut_from_full(values: &[u32], screen_w: i32, screen_h: i32) -> WmStrut {
    WmStrut {
        left: card_at(values, 0),
        right: card_at(values, 1),
        top: card_at(values, 2),
        bottom: card_at(values, 3),
        left_start: 0,
        left_end: screen_h.saturating_sub(1),
        right_start: 0,
        right_end: screen_h.saturating_sub(1),
        top_start: 0,
        top_end: screen_w.saturating_sub(1),
        bottom_start: 0,
        bottom_end: screen_w.saturating_sub(1),
    }
}

/// X11 `_NET_WORKAREA` plus client and root-child struts. `None` when the display or the properties are missing.
#[cfg(target_os = "linux")]
fn x11_reported_insets(
    monitor_x: i32,
    monitor_y: i32,
    monitor_w: i32,
    monitor_h: i32,
    scale: f64,
) -> Option<(u32, u32, u32, u32)> {
    use x11rb::connection::Connection;
    use x11rb::protocol::xproto::{AtomEnum, ConnectionExt};

    let (conn, screen_num) = x11rb::connect(None).ok()?;
    let (root, screen_w, screen_h) = {
        let screen = conn.setup().roots.get(screen_num)?;
        (
            screen.root,
            screen.width_in_pixels as i32,
            screen.height_in_pixels as i32,
        )
    };
    let atom = |name: &[u8]| -> Option<u32> {
        let reply = conn.intern_atom(true, name).ok()?.reply().ok()?;
        if reply.atom == 0 {
            None
        } else {
            Some(reply.atom)
        }
    };
    let cards = |window: u32, prop: u32| -> Option<Vec<u32>> {
        let reply = conn
            .get_property(false, window, prop, AtomEnum::ANY, 0, 4096)
            .ok()?
            .reply()
            .ok()?;
        let values: Vec<u32> = reply.value32()?.collect();
        Some(values)
    };
    let workarea = atom(b"_NET_WORKAREA").and_then(|prop| {
        let values = cards(root, prop)?;
        if values.len() < 4 {
            return None;
        }
        let mut index = 0usize;
        if let Some(desk_prop) = atom(b"_NET_CURRENT_DESKTOP") {
            if let Some(desk) = cards(root, desk_prop) {
                if let Some(current) = desk.first().copied() {
                    let slot = current as usize;
                    if slot.saturating_mul(4).saturating_add(4) <= values.len() {
                        index = slot * 4;
                    }
                }
            }
        }
        Some((
            values[index] as i32,
            values[index + 1] as i32,
            values[index + 2] as i32,
            values[index + 3] as i32,
        ))
    });
    let mut windows = Vec::new();
    if let Some(prop) = atom(b"_NET_CLIENT_LIST") {
        if let Some(ids) = cards(root, prop) {
            windows.extend(ids);
        }
    }
    if let Ok(cookie) = conn.query_tree(root) {
        if let Ok(tree) = cookie.reply() {
            for child in tree.children {
                if !windows.contains(&child) {
                    windows.push(child);
                }
            }
        }
    }
    let partial_atom = atom(b"_NET_WM_STRUT_PARTIAL");
    let strut_atom = atom(b"_NET_WM_STRUT");
    let mut struts = Vec::new();
    for window in windows {
        if let Some(prop) = partial_atom {
            if let Some(values) = cards(window, prop) {
                if values.len() >= 12 {
                    struts.push(strut_from_partial(&values));
                    continue;
                }
            }
        }
        if let Some(prop) = strut_atom {
            if let Some(values) = cards(window, prop) {
                if values.len() >= 4 {
                    struts.push(strut_from_full(&values, screen_w, screen_h));
                }
            }
        }
    }
    let (x, y, w, h, x_scale) = x_monitor_space(
        monitor_x, monitor_y, monitor_w, monitor_h, screen_w, screen_h, scale,
    );
    insets_from_struts(x, y, w, h, screen_w, screen_h, &struts, workarea, x_scale)
}

/// GDK geometry and workarea share one pixel space, so the scale passed in is 1.
#[cfg(target_os = "linux")]
fn gdk_reported_insets() -> Option<(u32, u32, u32, u32)> {
    use gtk::gdk::prelude::MonitorExt;

    let display = gtk::gdk::Display::default()?;
    let monitor = display.primary_monitor().or_else(|| display.monitor(0))?;
    let geo = monitor.geometry();
    let work = monitor.workarea();
    reported_work_insets(
        geo.x(),
        geo.y(),
        geo.width(),
        geo.height(),
        work.x(),
        work.y(),
        work.width(),
        work.height(),
        1.0,
    )
}

/// Work-area insets in CSS pixels.
/// Windows keeps `Monitor::work_area()` with no extra floor.
/// Linux reads GDK and X11, then uses max(reported bottom, 48).
pub fn monitor_work_insets(window: &tauri::WebviewWindow) -> (u32, u32, u32, u32) {
    let Some(monitor) = window
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| window.primary_monitor().ok().flatten())
    else {
        return (0, 0, WORK_AREA_FALLBACK_BOTTOM, 0);
    };
    let scale = window.scale_factor().unwrap_or(1.0);
    let pos = monitor.position();
    let size = monitor.size();
    let work = monitor.work_area();
    let tauri_insets = reported_work_insets(
        pos.x,
        pos.y,
        size.width as i32,
        size.height as i32,
        work.position.x,
        work.position.y,
        work.size.width as i32,
        work.size.height as i32,
        scale,
    );
    #[cfg(target_os = "linux")]
    {
        let x11 = x11_reported_insets(pos.x, pos.y, size.width as i32, size.height as i32, scale);
        let gdk = gdk_reported_insets();
        return floor_bottom_inset(pick_reported_insets(&[x11, gdk, tauri_insets]));
    }
    #[cfg(not(target_os = "linux"))]
    {
        tauri_insets.unwrap_or((0, 0, WORK_AREA_FALLBACK_BOTTOM, 0))
    }
}

fn orb_visual_opacity(distance: f64, held: bool, min_opacity: f64) -> f64 {
    if distance > ORB_PROXIMITY_PX {
        return 1.0;
    }
    if held {
        return 1.0;
    }
    orb_near_opacity(min_opacity)
}

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
    let both_inside = candidate_distance <= f64::EPSILON && current_distance <= f64::EPSILON;
    if both_inside && candidate.round && current.round {
        let candidate_area = candidate.w * candidate.h;
        let current_area = current.w * current.h;
        if (candidate_area - current_area).abs() > f64::EPSILON {
            return candidate_area < current_area;
        }
        if candidate.z != current.z {
            return candidate.z > current.z;
        }
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

/// Message-preview pills are neither orbs nor panels.
pub fn is_pill_hit(rect: &HitRect) -> bool {
    rect.id.starts_with("pill:")
}

/// A `close:` id. It is part of the panel: clickable when the modifier is up,
/// and out of the OS shape while the modifier is held.
pub fn is_close_hit(rect: &HitRect) -> bool {
    rect.id.starts_with("close:")
}

/// Open panels and their close buttons stay in the OS hit region while the
/// modifier is up. While it is held, both leave the shape. Orbs are left out
/// here; the poll adds only the orb (or preview pill) under the cursor.
pub fn immediate_hit_rects(held: bool, rects: &[HitRect]) -> Vec<HitRect> {
    rects
        .iter()
        .filter(|rect| {
            if rect.w < 1.0 || rect.h < 1.0 {
                return false;
            }
            if held && (is_close_hit(rect) || is_panel_hit(rect)) {
                return false;
            }
            if is_close_hit(rect) {
                return true;
            }
            !held && is_panel_hit(rect)
        })
        .cloned()
        .collect()
}

/// Orb or preview pill the cursor is actually on. A covering panel does not
/// count: while the modifier is held the panel leaves the shape, and the orb
/// underneath must stay. Higher z, then the smaller rect, wins among orbs and
/// pills only.
pub fn orb_or_pill_under_cursor<'a>(
    cursor: Option<(f64, f64)>,
    rects: &'a [HitRect],
) -> Option<&'a HitRect> {
    let (x, y) = cursor?;
    let mut best: Option<usize> = None;
    for (index, rect) in rects.iter().enumerate() {
        if !(is_orb_hit(rect) || is_pill_hit(rect)) || rect.w < 1.0 || rect.h < 1.0 {
            continue;
        }
        let distance = distance_to_hit(x, y, rect);
        if distance > HIT_MARGIN_PX {
            continue;
        }
        let replace = match best {
            None => true,
            Some(best_index) => prefers_hit(rect, distance, &[], &rects[best_index], x, y),
        };
        if replace {
            best = Some(index);
        }
    }
    best.map(|index| &rects[index])
}

fn interactive_shape_target<'a>(
    cursor: Option<(f64, f64)>,
    rects: &'a [HitRect],
) -> Option<&'a HitRect> {
    orb_or_pill_under_cursor(cursor, rects)
}

/// Put the orb or pill under the cursor back on a flush list. `held` is the
/// engaged modifier; `key_down` is the physical key from the same OS monitor.
/// A page that logged `ctrl=0` does not get a say.
pub fn ensure_modifier_target(
    held: bool,
    key_down: bool,
    cursor: Option<(f64, f64)>,
    incoming: &mut Vec<HitRect>,
    existing: &[HitRect],
) -> bool {
    let before = incoming.len();
    let why = retain_modifier_orb(held, key_down, cursor, incoming, existing, &None);
    why != "up" && why != "hit-new" && incoming.len() > before
}

/// `set_hit_rects` with an empty list. Keeps the rects already stored when a
/// press is active, or when the modifier is held over an orb. A missing cursor
/// sample also keeps the list: the poll will shrink it.
pub fn keep_empty_hit_publish(window: &tauri::WebviewWindow, existing: &[HitRect]) -> bool {
    should_keep_hit_rects(
        os_modifier_engaged() || os_modifier_down(),
        POINTER_DOWN.load(Ordering::Relaxed),
        stored_css_cursor(window),
        existing,
    )
}

/// Engaged modifier (after the arm delay). Written only by the OS key monitor.
pub fn os_modifier_engaged() -> bool {
    LAST_HELD.load(Ordering::Relaxed)
}

/// Physical modifier key, excluding a copy/paste chord. Written only by the
/// OS key monitor. A webview `ctrl=0` cannot clear it.
pub fn os_modifier_down() -> bool {
    KEY_DOWN.load(Ordering::Relaxed)
}

/// Page-facing modifier. A live `device_query` monitor wins over the hit-poll
/// sample, which can still say the key is down after it blocked on shape or
/// focus work. Morph, collapse, and rehearsal never delay this choice.
pub fn page_modifier(
    monitor: bool,
    live_held: bool,
    live_key: bool,
    sampled_held: bool,
    sampled_key: bool,
) -> (bool, bool) {
    if monitor {
        (live_held, live_key)
    } else {
        (sampled_held, sampled_key)
    }
}

pub fn should_keep_hit_rects(
    held: bool,
    pointer_down: bool,
    cursor: Option<(f64, f64)>,
    existing: &[HitRect],
) -> bool {
    if existing.is_empty() {
        return false;
    }
    if pointer_down {
        return true;
    }
    if !held {
        return false;
    }
    cursor.is_none() || interactive_shape_target(cursor, existing).is_some()
}

/// OS shape after any flush. While the engaged modifier or the physical key
/// is down, the orb or pill under the cursor stays in the region even if a
/// panel won the hit test or the fresh region is empty. An active press never
/// drops a shape that was already painted. Panel and close filtering still
/// follow `held` only, so a plain click and Ctrl+close stay click-through.
pub fn shape_after_flush(
    held: bool,
    key_down: bool,
    pointer_down: bool,
    cursor: Option<(f64, f64)>,
    rects: &[HitRect],
    frames: &[ElementFrame],
    previous_rects: &[HitRect],
    last_painted: &[HitRect],
) -> Vec<HitRect> {
    let mut guard = ShapeGuard::default();
    resolve_input_shape(
        held,
        key_down,
        pointer_down,
        cursor,
        rects,
        frames,
        previous_rects,
        last_painted,
        &mut guard,
    )
    .0
}

/// Cursor and mouse-button memory for the OS shape. The poll and
/// `set_hit_rects` share one of these. `latched` is the orb geometry that
/// last contained the cursor while Ctrl was down (the same CSS pixel space
/// that produced `n=1`). `frozen` is that input shape held until mouseup.
#[derive(Debug, Clone)]
pub struct ShapeGuard {
    pub latched: Option<HitRect>,
    pub last_cursor: Option<(f64, f64)>,
    pub button_down: bool,
    frozen: Option<Vec<HitRect>>,
    last_log: String,
    /// Orb hit id whose press began while the modifier was down. Survives
    /// the key going up and the button going up, until the page takes it
    /// or a later press begins without the modifier.
    armed_id: String,
    armed_down_ms: u64,
    /// `0` while the button is still down.
    armed_up_ms: u64,
}

impl Default for ShapeGuard {
    fn default() -> Self {
        Self {
            latched: None,
            last_cursor: None,
            button_down: false,
            frozen: None,
            last_log: String::new(),
            armed_id: String::new(),
            armed_down_ms: 0,
            armed_up_ms: 0,
        }
    }
}

pub struct ShapeNote {
    pub reason: &'static str,
    pub interesting: bool,
    pub n: usize,
    pub detail: String,
}

fn shape_guard() -> &'static Mutex<ShapeGuard> {
    static GUARD: OnceLock<Mutex<ShapeGuard>> = OnceLock::new();
    GUARD.get_or_init(|| Mutex::new(ShapeGuard::default()))
}

pub fn shape_guard_lock() -> std::sync::MutexGuard<'static, ShapeGuard> {
    shape_guard()
        .lock()
        .unwrap_or_else(|err| err.into_inner())
}

pub fn press_frozen(guard: &ShapeGuard) -> bool {
    guard.button_down && guard.frozen.is_some()
}

const ARMED_PRESS_MS: u64 = 800;

/// Hit id of a press that began with the modifier down, or empty.
/// A button that is down again after the armed press already ended is a
/// new click and must not inherit the old id. The page's later key sample
/// does not come through here.
pub fn armed_press_id(guard: &ShapeGuard, now_ms: u64) -> String {
    if guard.armed_id.is_empty() {
        return String::new();
    }
    if guard.armed_up_ms != 0 && now_ms.saturating_sub(guard.armed_up_ms) > ARMED_PRESS_MS {
        return String::new();
    }
    if guard.button_down && guard.armed_up_ms != 0 {
        return String::new();
    }
    guard.armed_id.clone()
}

fn clear_armed_press(guard: &mut ShapeGuard) {
    guard.armed_id.clear();
    guard.armed_down_ms = 0;
    guard.armed_up_ms = 0;
}

/// `consume` drops the latch so a later plain click cannot reuse it.
pub fn read_armed_press(consume: bool) -> String {
    let mut guard = shape_guard_lock();
    let now = mono_ms();
    let id = armed_press_id(&guard, now);
    if id.is_empty() || consume {
        if guard.armed_up_ms != 0 && now.saturating_sub(guard.armed_up_ms) > ARMED_PRESS_MS {
            clear_armed_press(&mut guard);
        } else if consume {
            clear_armed_press(&mut guard);
        }
    }
    id
}

fn push_unique(out: &mut Vec<HitRect>, rect: &HitRect) {
    if out.iter().any(|item| item.id == rect.id && (item.x - rect.x).abs() < 0.5 && (item.y - rect.y).abs() < 0.5) {
        return;
    }
    if let Some(slot) = out.iter_mut().find(|item| item.id == rect.id) {
        *slot = rect.clone();
        return;
    }
    out.push(rect.clone());
}

fn orbs_and_pills(rects: &[HitRect]) -> Vec<HitRect> {
    rects
        .iter()
        .filter(|rect| is_orb_hit(rect) || is_pill_hit(rect))
        .cloned()
        .collect()
}

fn hit_candidates(rects: &[HitRect]) -> String {
    let mut parts = Vec::new();
    let mut panels = 0u32;
    for rect in rects {
        if is_orb_hit(rect) || is_pill_hit(rect) {
            parts.push(format!(
                "{}:{:.0},{:.0},{:.0}x{:.0}",
                rect.id, rect.x, rect.y, rect.w, rect.h
            ));
        } else {
            panels += 1;
        }
    }
    if parts.is_empty() {
        format!("orbs=0 panels={panels}")
    } else {
        format!("{} panels={panels}", parts.join(";"))
    }
}

fn shape_detail(
    reason: &str,
    cursor: Option<(f64, f64)>,
    last_cursor: Option<(f64, f64)>,
    button: bool,
    held: bool,
    key_down: bool,
    n: usize,
    rects: &[HitRect],
    previous: &[HitRect],
    latched: &Option<HitRect>,
) -> String {
    let cursor = match cursor {
        Some((x, y)) => format!("{x:.0},{y:.0}"),
        None => "none".to_string(),
    };
    let last = match last_cursor {
        Some((x, y)) => format!("{x:.0},{y:.0}"),
        None => "none".to_string(),
    };
    let latch = match latched {
        Some(rect) => format!("{}:{:.0},{:.0},{:.0}x{:.0}", rect.id, rect.x, rect.y, rect.w, rect.h),
        None => "none".to_string(),
    };
    format!(
        "reason={reason} cursor={cursor} last={last} button={} held={} key={} n={n} latch={latch} new={} prev={}",
        u8::from(button),
        u8::from(held),
        u8::from(key_down),
        hit_candidates(rects),
        hit_candidates(previous),
    ) + " space=css"
}

fn contains_orb(cursor: Option<(f64, f64)>, rect: &HitRect) -> bool {
    orb_or_pill_under_cursor(cursor, std::slice::from_ref(rect)).is_some()
}

/// Hit-test `cursor` in the CSS pixel space used for `n=1`. A missing sample
/// reuses the last CSS point. A press that starts while Ctrl is down over an
/// orb freezes that shape until mouseup. Ctrl plus a cursor that still sits
/// in the previous shape's orb never yields an empty region.
pub fn resolve_input_shape(
    held: bool,
    key_down: bool,
    pointer_down: bool,
    cursor: Option<(f64, f64)>,
    rects: &[HitRect],
    frames: &[ElementFrame],
    previous_rects: &[HitRect],
    last_painted: &[HitRect],
    guard: &mut ShapeGuard,
) -> (Vec<HitRect>, ShapeNote) {
    let modifier = held || key_down;
    let press_began = pointer_down && !guard.button_down;
    if !pointer_down {
        guard.frozen = None;
    }
    guard.button_down = pointer_down;
    if let Some(point) = cursor {
        guard.last_cursor = Some(point);
    }
    if !modifier && !pointer_down {
        guard.latched = None;
    }
    let sample = cursor.or(guard.last_cursor);
    let over_new = orb_or_pill_under_cursor(sample, rects).cloned();
    let over_prev = orb_or_pill_under_cursor(sample, previous_rects).cloned();
    let over_paint = orb_or_pill_under_cursor(sample, last_painted).cloned();
    let over_latch = guard.latched.as_ref().and_then(|rect| {
        if sample.is_none() || contains_orb(sample, rect) {
            Some(rect.clone())
        } else {
            None
        }
    });

    if press_began && modifier {
        // The button went down since the previous sample, while the shape was
        // already the orb. A republish in this same sample must not talk us
        // out of that shape. The armed id is the modifier state at this
        // hit check: a later key-up must not erase it.
        let painted = orbs_and_pills(last_painted);
        if !painted.is_empty() {
            if guard.latched.is_none() {
                guard.latched = painted.first().cloned();
            }
            guard.frozen = Some(painted);
        } else if let Some(rect) = over_new
            .clone()
            .or_else(|| over_prev.clone())
            .or_else(|| over_paint.clone())
            .or_else(|| over_latch.clone())
        {
            guard.latched = Some(rect.clone());
            guard.frozen = Some(vec![rect]);
        }
        if let Some(id) = guard
            .frozen
            .as_ref()
            .and_then(|rects| rects.iter().find(|rect| is_orb_hit(rect) || is_pill_hit(rect)))
            .map(|rect| rect.id.clone())
        {
            guard.armed_id = id;
            guard.armed_down_ms = mono_ms();
            guard.armed_up_ms = 0;
        }
    } else if press_began {
        // This press began without the modifier. A click at the instant of
        // release must not open, and must not reuse the previous arm.
        guard.armed_id.clear();
        guard.armed_down_ms = 0;
        guard.armed_up_ms = 0;
    }
    if !pointer_down && !guard.armed_id.is_empty() && guard.armed_up_ms == 0 {
        // `0` means the button is still down. The clock can still read 0
        // in the first millisecond, so a finished press stores at least 1.
        guard.armed_up_ms = mono_ms().max(1);
    }

    if pointer_down {
        if let Some(frozen) = guard.frozen.clone() {
            let detail = shape_detail(
                "frozen",
                cursor,
                guard.last_cursor,
                true,
                held,
                key_down,
                frozen.len(),
                rects,
                previous_rects,
                &guard.latched,
            );
            let n = frozen.len();
            return (
                frozen,
                ShapeNote {
                    reason: "frozen",
                    interesting: true,
                    n,
                    detail,
                },
            );
        }
    }

    let mut fresh = os_input_rects(held, rects, frames);
    let mut reason = if fresh.is_empty() { "empty" } else { "open" };
    if modifier {
        if let Some(rect) = over_new.clone() {
            push_unique(&mut fresh, &rect);
            guard.latched = Some(rect);
            reason = if cursor.is_none() { "cursor-missing" } else { "hit-new" };
        } else if let Some(rect) = over_prev.clone() {
            push_unique(&mut fresh, &rect);
            guard.latched = Some(rect);
            reason = "hit-prev";
        } else if let Some(rect) = over_paint.clone() {
            push_unique(&mut fresh, &rect);
            guard.latched = Some(rect);
            reason = "hit-painted";
        } else if cursor.is_none() {
            if let Some(rect) = guard.latched.clone().or(over_latch) {
                push_unique(&mut fresh, &rect);
                guard.latched = Some(rect);
            }
            reason = "cursor-missing";
        } else if let Some(rect) = over_latch.clone() {
            push_unique(&mut fresh, &rect);
            reason = "latched";
        } else {
            if !pointer_down {
                guard.latched = None;
            }
            reason = "outside";
        }
    }
    if fresh.is_empty() && pointer_down && !last_painted.is_empty() {
        let detail = shape_detail(
            "press-hold",
            cursor,
            guard.last_cursor,
            true,
            held,
            key_down,
            last_painted.len(),
            rects,
            previous_rects,
            &guard.latched,
        );
        return (
            last_painted.to_vec(),
            ShapeNote {
                reason: "press-hold",
                interesting: true,
                n: last_painted.len(),
                detail,
            },
        );
    }
    if fresh.is_empty() && modifier {
        let keep = over_prev
            .clone()
            .or(over_paint)
            .or_else(|| guard.latched.clone())
            .filter(|rect| sample.is_none() || contains_orb(sample, rect));
        if let Some(rect) = keep {
            fresh.push(rect.clone());
            guard.latched = Some(rect);
            reason = "keep-prev";
        }
    }
    let interesting = !matches!(reason, "hit-new" | "open") && !(reason == "outside" && !fresh.is_empty());
    let n = fresh.len();
    let detail = shape_detail(
        reason,
        cursor,
        guard.last_cursor,
        pointer_down,
        held,
        key_down,
        fresh.len(),
        rects,
        previous_rects,
        &guard.latched,
    );
    (
        fresh,
        ShapeNote {
            reason,
            interesting,
            n,
            detail,
        },
    )
}

fn note_shape(guard: &mut ShapeGuard, note: &ShapeNote) {
    if !note.interesting {
        return;
    }
    let marks = note
        .detail
        .find("new=")
        .map(|index| &note.detail[index..])
        .unwrap_or("");
    let sig = format!("{}|{}|{marks}", note.reason, note.n);
    if sig == guard.last_log {
        return;
    }
    guard.last_log = sig;
    crate::trace_debug("hit-shape", &note.detail);
}

fn guarded_input_shape(
    held: bool,
    key_down: bool,
    pointer_down: bool,
    cursor: Option<(f64, f64)>,
    rects: &[HitRect],
    frames: &[ElementFrame],
    previous_rects: &[HitRect],
    last_painted: &[HitRect],
) -> Vec<HitRect> {
    let mut guard = shape_guard()
        .lock()
        .unwrap_or_else(|err| err.into_inner());
    let (region, note) = resolve_input_shape(
        held,
        key_down,
        pointer_down,
        cursor,
        rects,
        frames,
        previous_rects,
        last_painted,
        &mut guard,
    );
    note_shape(&mut guard, &note);
    region
}

/// On a republish, hit-test the cursor against the new rects first, then the
/// previous shape, then the latched orb. A missing cursor does not drop the
/// latched orb. Returns why the orb was kept, for the opt-in debug log.
pub fn retain_modifier_orb(
    held: bool,
    key_down: bool,
    cursor: Option<(f64, f64)>,
    incoming: &mut Vec<HitRect>,
    existing: &[HitRect],
    latched: &Option<HitRect>,
) -> &'static str {
    if !(held || key_down) {
        return "up";
    }
    if orb_or_pill_under_cursor(cursor, incoming).is_some() {
        return "hit-new";
    }
    if let Some(rect) = orb_or_pill_under_cursor(cursor, existing).cloned() {
        push_unique(incoming, &rect);
        return "hit-prev";
    }
    if cursor.is_none() {
        if let Some(rect) = latched.clone() {
            push_unique(incoming, &rect);
        }
        return "cursor-missing";
    }
    if let Some(rect) = latched.clone() {
        if contains_orb(cursor, &rect) {
            push_unique(incoming, &rect);
            return "latched";
        }
    }
    "outside"
}

/// OS input region: panels that are already open, plus whatever the hover poll
/// is currently capturing (an orb under the modifier, a preview pill).
pub fn os_input_rects(held: bool, rects: &[HitRect], frames: &[ElementFrame]) -> Vec<HitRect> {
    let mut out = immediate_hit_rects(held, rects);
    for frame in frames {
        if !frame.capture || out.iter().any(|item| item.id == frame.id) {
            continue;
        }
        if let Some(rect) = rects.iter().find(|item| item.id == frame.id) {
            if rect.w >= 1.0 && rect.h >= 1.0 {
                out.push(rect.clone());
            }
        }
    }
    out
}

pub fn css_point_hits(rects: &[HitRect], x: f64, y: f64) -> bool {
    rects.iter().any(|rect| {
        x >= rect.x && y >= rect.y && x < rect.x + rect.w && y < rect.y + rect.h
    })
}

/// Round avatars, pills, close buttons, and toasts are not panels. Everything else is a panel.
pub fn is_panel_hit(rect: &HitRect) -> bool {
    if is_pill_hit(rect) || is_close_hit(rect) || is_orb_hit(rect) {
        return false;
    }
    !rect.id.starts_with("toast:")
}

/// Bot, settings, and kanban orbs. A round hit or a `bot:` id both count.
pub fn is_orb_hit(rect: &HitRect) -> bool {
    if is_pill_hit(rect) || is_close_hit(rect) {
        return false;
    }
    rect.round || rect.id.starts_with("bot:")
}

/// Sub-orb discs use a fixed 0.18 floor (R-SO-08). Main orbs keep `min_opacity`.
pub fn suborb_hit(id: &str) -> bool {
    id.starts_with("suborb:")
        || id.starts_with("suborb-more:")
        || id.starts_with("bot:suborb:")
        || id.starts_with("bot:suborb-more:")
}

/// Per-element frame.
/// Panels are opaque and captured until the modifier is held, then they wash out
/// and capture nothing. Orbs are opaque and click-through. The orb whose hit
/// circle is within `ORB_PROXIMITY_PX` fades to `orb_near_opacity` (R-OB-05).
/// Holding the modifier inside that radius makes that orb opaque again. It
/// captures only while the modifier is held and the cursor is within
/// `HIT_MARGIN_PX`. A message-preview pill stays visually solid and captures
/// only while the modifier is held over it. A close button captures only while
/// the modifier is up; while it is held the button passes through with the
/// panel. Toasts stay visually solid. A missing cursor does not capture and
/// leaves orbs opaque.
pub fn interaction_frame(
    held: bool,
    latched_ids: &[String],
    cursor: Option<(f64, f64)>,
    rects: &[HitRect],
    margin: f64,
    cfg: &InteractionConfig,
) -> Vec<ElementFrame> {
    // While the modifier is held, the orb or pill under the cursor wins even
    // when a panel rect also contains that point (R-CT-02). Unheld, the panel
    // still captures, including over its own docked title orb.
    let orb_under = if held {
        orb_or_pill_under_cursor(cursor, rects).map(|rect| rect.id.clone())
    } else {
        None
    };
    let under = orb_under.or_else(|| {
        element_under_cursor(cursor, rects, margin, latched_ids).map(|rect| rect.id.clone())
    });
    rects
        .iter()
        .map(|rect| {
            let here = cursor.is_some() && under.as_deref() == Some(rect.id.as_str());
            let (opacity, capture) = if is_close_hit(rect) {
                (1.0, here && !held)
            } else if is_pill_hit(rect) {
                (1.0, here && held)
            } else if is_orb_hit(rect) {
                let distance = match cursor {
                    Some((x, y)) => distance_to_hit(x, y, rect),
                    None => ORB_PROXIMITY_PX + 1.0,
                };
                let awake = here && held;
                let floor = if suborb_hit(&rect.id) {
                    0.18
                } else {
                    cfg.min_opacity
                };
                (orb_visual_opacity(distance, held, floor), awake)
            } else if is_panel_hit(rect) {
                let opacity = if cursor.is_some() && held {
                    cfg.min_opacity
                } else {
                    1.0
                };
                (opacity, here && !held)
            } else {
                (1.0, here && !held)
            };
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

/// Drop the page key target after Esc closes a panel. The window stays
/// mapped. Orb opacity keeps following the global poll.
pub fn release_overlay_focus(window: &tauri::WebviewWindow) {
    #[cfg(target_os = "linux")]
    {
        use gtk::prelude::*;
        if let Ok(gtk_window) = window.gtk_window() {
            gtk_window.set_focus(None::<&gtk::Widget>);
        }
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = window;
    }
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

/// Distance fade kept for the unit test. Live frames do not call it.
#[cfg_attr(not(test), allow(dead_code))]
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

static RECOVER_ATTEMPTS: AtomicU8 = AtomicU8::new(0);
static SHAPE_DIRTY: AtomicBool = AtomicBool::new(false);
/// Key edge defers the input shape until the page has written opacity.
static OPACITY_SHAPE_HOLD: AtomicBool = AtomicBool::new(false);
static OPACITY_SHAPE_UNTIL: AtomicU64 = AtomicU64::new(0);
static OPACITY_SHAPE_GEN: AtomicU64 = AtomicU64::new(0);
const OPACITY_SHAPE_HOLD_MS: u64 = 100;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OpacityShapeGate {
    Apply,
    Defer,
    Fallback,
}

/// `until_ms == 0` keeps the hold (no deadline yet). A reached deadline
/// is the fallback so click-through cannot stick if the page never acks.
pub fn opacity_shape_gate(now_ms: u64, hold: bool, until_ms: u64) -> OpacityShapeGate {
    if !hold {
        return OpacityShapeGate::Apply;
    }
    if until_ms != 0 && now_ms >= until_ms {
        return OpacityShapeGate::Fallback;
    }
    OpacityShapeGate::Defer
}

fn arm_opacity_shape_hold() {
    let until = mono_ms().saturating_add(OPACITY_SHAPE_HOLD_MS).max(1);
    OPACITY_SHAPE_UNTIL.store(until, Ordering::Release);
    OPACITY_SHAPE_HOLD.store(true, Ordering::Release);
    OPACITY_SHAPE_GEN.fetch_add(1, Ordering::Release);
}

fn clear_opacity_shape_hold() {
    OPACITY_SHAPE_HOLD.store(false, Ordering::Release);
    OPACITY_SHAPE_UNTIL.store(0, Ordering::Release);
}

/// One frame after the opacity present. A newer key edge bumps the
/// generation, so this timer must not release that newer hold. The hold
/// only skips a Ctrl-edge combine that does not add a hittable rect.
/// Skipping `SHAPE_DIRTY` leaves an unchanged region signature in place.
fn release_opacity_shape_next_frame(gen: u64) {
    #[cfg(target_os = "linux")]
    {
        gtk::glib::timeout_add_local(Duration::from_millis(16), move || {
            if OPACITY_SHAPE_GEN.load(Ordering::Acquire) == gen {
                clear_opacity_shape_hold();
                crate::trace_debug("opacity-shape", "release=frame");
            }
            gtk::glib::ControlFlow::Break
        });
    }
    #[cfg(not(target_os = "linux"))]
    {
        if OPACITY_SHAPE_GEN.load(Ordering::Acquire) == gen {
            clear_opacity_shape_hold();
        }
    }
}

fn opacity_shape_deferred(now_ms: u64) -> bool {
    let hold = OPACITY_SHAPE_HOLD.load(Ordering::Acquire);
    let until = OPACITY_SHAPE_UNTIL.load(Ordering::Acquire);
    match opacity_shape_gate(now_ms, hold, until) {
        OpacityShapeGate::Apply => false,
        OpacityShapeGate::Defer => true,
        OpacityShapeGate::Fallback => {
            clear_opacity_shape_hold();
            crate::trace_debug("opacity-present", "source=fallback");
            false
        }
    }
}
static SHAPE_GEN: AtomicU64 = AtomicU64::new(0);
static EMPTY_BLOCK_UNTIL: AtomicU64 = AtomicU64::new(0);
static LAST_HELD: AtomicBool = AtomicBool::new(false);
/// Physical modifier from `device_query`, not the webview keydown.
static KEY_DOWN: AtomicBool = AtomicBool::new(false);
static POINTER_DOWN: AtomicBool = AtomicBool::new(false);
/// Set once the dedicated key monitor owns `KEY_DOWN` / `LAST_HELD`.
static MODIFIER_MONITOR: AtomicBool = AtomicBool::new(false);
/// Bumps on every key edge so a late hit-poll sample cannot rewind the page.
static MODIFIER_SEQ: AtomicU64 = AtomicU64::new(0);

/// Left, right, and middle. `device_query` is 1-based; indexes 4 and 5 are
/// the X11 wheel and must not freeze the orb shape.
fn pointer_is_down(device: &DeviceState) -> bool {
    device
        .get_mouse()
        .button_pressed
        .iter()
        .enumerate()
        .any(|(index, pressed)| *pressed && (1..=3).contains(&index))
}

/// Live OS modifier. Not `KEY_DOWN`, which the 16ms poll can still say is down
/// after the key has already gone up. `DeviceState` holds an `Rc`, so this
/// sample stays on the calling thread instead of sharing the poll's device.
pub fn modifier_down_now(hub: &InteractionHub) -> bool {
    let modifier = hub
        .config
        .lock()
        .unwrap_or_else(|err| err.into_inner())
        .modifier
        .clone();
    let Some(device) = DeviceState::checked_new() else {
        return false;
    };
    let keys = device.get_keys();
    modifier_physically_down(&keys, &modifier)
}

fn screen_cursor() -> &'static Mutex<Option<(f64, f64)>> {
    static CURSOR: OnceLock<Mutex<Option<(f64, f64)>>> = OnceLock::new();
    CURSOR.get_or_init(|| Mutex::new(None))
}

/// Linux stays unmapped until `reveal_overlay`. Windows is created visible
/// and this call shows the monitor rect, then click-through follows the cursor.
pub fn place_overlay(window: &tauri::WebviewWindow) {
    let _ = window.set_always_on_top(true);
    #[cfg(windows)]
    {
        if !cover_windows_monitor(window) {
            let _ = window.maximize();
        }
        let _ = apply_ignore_cursor(window, true, 0);
        return;
    }
    #[cfg(target_os = "linux")]
    if cover_linux_monitor(window) {
        return;
    }
    #[cfg(not(windows))]
    {
        let _ = window.maximize();
    }
}

/// Whole-window click-through. tao sets `WS_EX_LAYERED|WS_EX_TRANSPARENT` and
/// keeps its style cache in sync. Windows then asks the frame to pick that up.
fn apply_ignore_cursor(window: &tauri::WebviewWindow, ignore: bool, shape_n: usize) -> bool {
    if window.set_ignore_cursor_events(ignore).is_err() {
        return false;
    }
    #[cfg(windows)]
    {
        commit_exstyle_frame(window);
        crate::trace_debug(
            "hit-ipc",
            &format!("cmd=input-shape n={} platform=windows", shape_n),
        );
    }
    #[cfg(not(windows))]
    {
        let _ = shape_n;
    }
    true
}

#[cfg(windows)]
fn commit_exstyle_frame(window: &tauri::WebviewWindow) {
    use raw_window_handle::{HasWindowHandle, RawWindowHandle};
    use std::ffi::c_void;

    #[link(name = "user32")]
    extern "system" {
        fn SetWindowPos(
            hwnd: *mut c_void,
            insert_after: *mut c_void,
            x: i32,
            y: i32,
            cx: i32,
            cy: i32,
            flags: u32,
        ) -> i32;
    }

    let Ok(handle) = window.window_handle() else {
        return;
    };
    let RawWindowHandle::Win32(win) = handle.as_raw() else {
        return;
    };
    let hwnd = win.hwnd.get() as *mut c_void;
    if hwnd.is_null() {
        return;
    }
    const SWP_NOSIZE: u32 = 0x0001;
    const SWP_NOMOVE: u32 = 0x0002;
    const SWP_NOZORDER: u32 = 0x0004;
    const SWP_NOACTIVATE: u32 = 0x0010;
    const SWP_FRAMECHANGED: u32 = 0x0020;
    unsafe {
        SetWindowPos(
            hwnd,
            std::ptr::null_mut(),
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED,
        );
    }
}

/// How many GTK after-paint frames actually ran. Zero means the clock did
/// not report, and the caller should start anyway. Does not block the GTK
/// thread: the wait sits on a worker until the main thread signals.
pub fn wait_presented_frames(app: &AppHandle, frames: u32) -> u32 {
    let frames = frames.clamp(1, 8);
    wait_presented_frames_inner(app, frames)
}

#[cfg(not(target_os = "linux"))]
fn wait_presented_frames_inner(_app: &AppHandle, _frames: u32) -> u32 {
    0
}

#[cfg(target_os = "linux")]
fn wait_presented_frames_inner(app: &AppHandle, frames: u32) -> u32 {
    use std::sync::atomic::AtomicU32;
    let Some(window) = app.get_webview_window("main") else {
        return 0;
    };
    let (tx, rx) = std::sync::mpsc::sync_channel(1);
    let posted = app.run_on_main_thread(move || {
        use gtk::prelude::*;
        let Ok(gtk_window) = window.gtk_window() else {
            let _ = tx.send(0);
            return;
        };
        let Some(clock) = gtk_window.upcast_ref::<gtk::Widget>().frame_clock() else {
            let _ = tx.send(0);
            return;
        };
        let seen = Arc::new(AtomicU32::new(0));
        let tx_slot = Arc::new(Mutex::new(Some(tx)));
        let handler_slot: Arc<Mutex<Option<gtk::glib::signal::SignalHandlerId>>> =
            Arc::new(Mutex::new(None));
        let seen_cb = Arc::clone(&seen);
        let tx_cb = Arc::clone(&tx_slot);
        let handler_cb = Arc::clone(&handler_slot);
        let clock_cb = clock.clone();
        let id = clock.connect_after_paint(move |_clock| {
            let n = seen_cb.fetch_add(1, Ordering::Relaxed).saturating_add(1);
            if n < frames {
                clock_cb.request_phase(gtk::gdk::FrameClockPhase::AFTER_PAINT);
                return;
            }
            if let Some(handler) = handler_cb
                .lock()
                .unwrap_or_else(|err| err.into_inner())
                .take()
            {
                clock_cb.disconnect(handler);
            }
            if let Some(sender) = tx_cb.lock().unwrap_or_else(|err| err.into_inner()).take() {
                let _ = sender.send(n);
            }
        });
        *handler_slot
            .lock()
            .unwrap_or_else(|err| err.into_inner()) = Some(id);
        let clock_timeout = clock.clone();
        let handler_timeout = Arc::clone(&handler_slot);
        let tx_timeout = Arc::clone(&tx_slot);
        gtk::glib::timeout_add_local(Duration::from_millis(120), move || {
            if let Some(handler) = handler_timeout
                .lock()
                .unwrap_or_else(|err| err.into_inner())
                .take()
            {
                clock_timeout.disconnect(handler);
            }
            if let Some(sender) = tx_timeout
                .lock()
                .unwrap_or_else(|err| err.into_inner())
                .take()
            {
                let _ = sender.send(0);
            }
            gtk::glib::ControlFlow::Break
        });
        clock.request_phase(gtk::gdk::FrameClockPhase::AFTER_PAINT);
    });
    if posted.is_err() {
        return 0;
    }
    rx.recv_timeout(Duration::from_millis(160)).unwrap_or(0)
}

static SEAM_TOKEN: AtomicU64 = AtomicU64::new(0);

/// Drive the plan seam from GTK after-paint timestamps. Each presented frame
/// evals `window.__hermesSeamFrame(elapsedMs)` on the webview. The first gap
/// over 45ms restarts the origin so the next presented frame is still on the
/// early part of the curve. Returns false when the clock cannot start.
pub fn drive_presented_seam(window: tauri::WebviewWindow) -> bool {
    drive_presented_seam_inner(window)
}

#[cfg(not(target_os = "linux"))]
fn drive_presented_seam_inner(_window: tauri::WebviewWindow) -> bool {
    false
}

#[cfg(target_os = "linux")]
fn drive_presented_seam_inner(window: tauri::WebviewWindow) -> bool {
    use std::sync::atomic::AtomicU8;
    let (tx, rx) = std::sync::mpsc::sync_channel(1);
    let token = SEAM_TOKEN.fetch_add(1, Ordering::Relaxed).wrapping_add(1);
    let posted = window.with_webview(move |webview| {
        use gtk::prelude::*;
        let view = webview.inner();
        let Some(clock) = view.frame_clock() else {
            let _ = tx.send(false);
            return;
        };
        let origin = Arc::new(std::sync::atomic::AtomicI64::new(0));
        let restarts = Arc::new(AtomicU8::new(0));
        let live = Arc::new(AtomicBool::new(false));
        let tx_slot = Arc::new(Mutex::new(Some(tx)));
        let handler_slot: Arc<Mutex<Option<gtk::glib::signal::SignalHandlerId>>> =
            Arc::new(Mutex::new(None));
        let origin_cb = Arc::clone(&origin);
        let restarts_cb = Arc::clone(&restarts);
        let live_cb = Arc::clone(&live);
        let handler_cb = Arc::clone(&handler_slot);
        let tx_cb = Arc::clone(&tx_slot);
        let clock_cb = clock.clone();
        let view_cb = view.clone();
        let id = clock.connect_after_paint(move |paint_clock| {
            if SEAM_TOKEN.load(Ordering::Relaxed) != token {
                end_presented_seam(token, &clock_cb, &handler_cb, &tx_cb, true);
                return;
            }
            let now = paint_clock.frame_time();
            let start = origin_cb.load(Ordering::Relaxed);
            if start == 0 {
                origin_cb.store(now, Ordering::Relaxed);
                eval_seam_frame(&view_cb, 0.0);
                clock_cb.request_phase(gtk::gdk::FrameClockPhase::AFTER_PAINT);
                return;
            }
            let mut dt = (now.saturating_sub(start) as f64) / 1000.0;
            let running = live_cb.load(Ordering::Relaxed);
            if !running && dt > 45.0 && restarts_cb.load(Ordering::Relaxed) < 3 {
                restarts_cb.fetch_add(1, Ordering::Relaxed);
                origin_cb.store(now, Ordering::Relaxed);
                eval_seam_frame(&view_cb, 0.0);
                clock_cb.request_phase(gtk::gdk::FrameClockPhase::AFTER_PAINT);
                return;
            }
            if !running && dt > 45.0 {
                // Restarts are spent and this presented frame is still late.
                // Show it at 45ms on the curve (about 38%) and keep going.
                origin_cb.store(now.saturating_sub(45_000), Ordering::Relaxed);
                dt = 45.0;
            }
            live_cb.store(true, Ordering::Relaxed);
            eval_seam_frame(&view_cb, dt);
            if dt >= 280.0 {
                end_presented_seam(token, &clock_cb, &handler_cb, &tx_cb, true);
                return;
            }
            clock_cb.request_phase(gtk::gdk::FrameClockPhase::AFTER_PAINT);
        });
        *handler_slot
            .lock()
            .unwrap_or_else(|err| err.into_inner()) = Some(id);
        let origin_timeout = Arc::clone(&origin);
        let handler_timeout = Arc::clone(&handler_slot);
        let tx_timeout = Arc::clone(&tx_slot);
        let clock_timeout = clock.clone();
        gtk::glib::timeout_add_local(Duration::from_millis(460), move || {
            let started = origin_timeout.load(Ordering::Relaxed) != 0;
            end_presented_seam(token, &clock_timeout, &handler_timeout, &tx_timeout, started);
            gtk::glib::ControlFlow::Break
        });
        clock.request_phase(gtk::gdk::FrameClockPhase::AFTER_PAINT);
    });
    if posted.is_err() {
        return false;
    }
    rx.recv_timeout(Duration::from_millis(520)).unwrap_or(false)
}

#[cfg(target_os = "linux")]
fn end_presented_seam(
    token: u64,
    clock: &gtk::gdk::FrameClock,
    handler_slot: &Mutex<Option<gtk::glib::signal::SignalHandlerId>>,
    tx_slot: &Mutex<Option<std::sync::mpsc::SyncSender<bool>>>,
    ok: bool,
) {
    use gtk::prelude::*;
    let _ = token;
    if let Some(handler) = handler_slot
        .lock()
        .unwrap_or_else(|err| err.into_inner())
        .take()
    {
        clock.disconnect(handler);
    }
    if let Some(sender) = tx_slot.lock().unwrap_or_else(|err| err.into_inner()).take() {
        let _ = sender.send(ok);
    }
}

#[cfg(target_os = "linux")]
#[allow(deprecated)]
fn eval_seam_frame(view: &webkit2gtk::WebView, elapsed_ms: f64) {
    use webkit2gtk::WebViewExt;
    let script = format!("window.__hermesSeamFrame&&window.__hermesSeamFrame({elapsed_ms:.3})");
    view.run_javascript(&script, None::<&gtk::gio::Cancellable>, |_| {});
}

fn log_opacity_present(write_unix: u64, source: &str, gen: u64) {
    if source == "after-paint" {
        release_opacity_shape_next_frame(gen);
    } else if gen == 0 || OPACITY_SHAPE_GEN.load(Ordering::Acquire) == gen {
        clear_opacity_shape_hold();
    }
    crate::trace_debug(
        "opacity-present",
        &format!("source={source} write_unix={write_unix}"),
    );
    crate::trace_debug(
        "opacity-stage",
        &format!("stage=present source={source} write_unix={write_unix}"),
    );
}

/// The page has written panel opacity. Log the next presented frame.
/// A Ctrl-edge hold may skip a combine that does not add a hittable rect.
/// Opens, morphs, and startup rects are not held here.
pub fn note_opacity_written(window: Option<&tauri::WebviewWindow>, write_unix: u64, gen: u64) {
    #[cfg(target_os = "linux")]
    {
        if let Some(window) = window {
            if schedule_opacity_present(window, write_unix, gen) {
                return;
            }
        }
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = window;
    }
    log_opacity_present(write_unix, "immediate", gen);
}

#[cfg(target_os = "linux")]
fn schedule_opacity_present(window: &tauri::WebviewWindow, write_unix: u64, gen: u64) -> bool {
    let posted = window.with_webview(move |webview| {
        use gtk::prelude::*;
        let view = webview.inner();
        let Some(clock) = view.frame_clock() else {
            log_opacity_present(write_unix, "no-clock", gen);
            return;
        };
        let clock_cb = clock.clone();
        let slot: Arc<Mutex<Option<gtk::glib::signal::SignalHandlerId>>> =
            Arc::new(Mutex::new(None));
        let slot_cb = Arc::clone(&slot);
        let id = clock.connect_after_paint(move |_| {
            let handler = slot_cb.lock().unwrap_or_else(|err| err.into_inner()).take();
            if let Some(handler) = handler {
                clock_cb.disconnect(handler);
            }
            log_opacity_present(write_unix, "after-paint", gen);
        });
        *slot.lock().unwrap_or_else(|err| err.into_inner()) = Some(id);
        clock.request_phase(gtk::gdk::FrameClockPhase::AFTER_PAINT);
    });
    posted.is_ok()
}

/// Opacity 0 lets Linux map the window so WebKit receives the monitor
/// size without a visible frame. Other platforms ignore it.
pub fn set_window_opacity(window: &tauri::WebviewWindow, opacity: f64) {
    #[cfg(target_os = "linux")]
    {
        use gtk::prelude::*;
        if let Ok(gtk_window) = window.gtk_window() {
            gtk_window.set_opacity(opacity);
        }
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = (window, opacity);
    }
}

/// CSS pixels of the monitor the overlay should cover. Zero means unknown.
pub fn monitor_css_size(window: &tauri::WebviewWindow) -> Option<(u32, u32)> {
    let (_, _, w, h) = monitor_logical_rect(window)?;
    if w <= 0 || h <= 0 {
        return None;
    }
    Some((w as u32, h as u32))
}

/// A cold start that stayed at the config size is not covering the monitor.
pub fn recover_startup_size(window: &tauri::WebviewWindow, width: u32, height: u32) {
    if RECOVER_ATTEMPTS.load(Ordering::Relaxed) >= 4 {
        return;
    }
    let Some((mon_w, mon_h)) = monitor_size(window) else {
        return;
    };
    if width + 8 >= mon_w && height + 8 >= mon_h {
        return;
    }
    let scale = window.scale_factor().unwrap_or(1.0).max(1.0);
    let fallback_w = (1280.0 * scale).round() as u32;
    let fallback_h = (800.0 * scale).round() as u32;
    if width.abs_diff(fallback_w) <= 4 && height.abs_diff(fallback_h) <= 4 {
        RECOVER_ATTEMPTS.fetch_add(1, Ordering::Relaxed);
        place_overlay(window);
    }
}

fn monitor_size(window: &tauri::WebviewWindow) -> Option<(u32, u32)> {
    let monitor = window
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| window.primary_monitor().ok().flatten())?;
    let size = monitor.size();
    Some((size.width, size.height))
}

fn monitor_logical_rect(window: &tauri::WebviewWindow) -> Option<(i32, i32, i32, i32)> {
    let monitor = window
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| window.primary_monitor().ok().flatten())?;
    let scale = window.scale_factor().unwrap_or(1.0).max(0.01);
    let pos = monitor.position();
    let size = monitor.size();
    let x = (f64::from(pos.x) / scale).round() as i32;
    let y = (f64::from(pos.y) / scale).round() as i32;
    let width = (f64::from(size.width) / scale).round() as i32;
    let height = (f64::from(size.height) / scale).round() as i32;
    Some((x, y, width, height))
}

/// Size and place the window while it is still unmapped, so the first map
/// is already the monitor. tao's maximize waits for the first configure,
/// which is the show, and that is the 1280×800 orb frame.
#[cfg(target_os = "linux")]
fn cover_linux_monitor(window: &tauri::WebviewWindow) -> bool {
    use gtk::prelude::*;

    let Ok(gtk_window) = window.gtk_window() else {
        return false;
    };
    let Some((x, y, width, height)) = monitor_logical_rect(window) else {
        return false;
    };
    if width <= 0 || height <= 0 {
        return false;
    }
    gtk_window.set_decorated(false);
    gtk_window.set_default_size(width, height);
    gtk_window.resize(width, height);
    gtk_window.move_(x, y);
    if !gtk_window.is_realized() {
        gtk_window.realize();
    }
    allocate_webkit(gtk_window.upcast_ref::<gtk::Widget>(), width, height);
    if let Some(gdk_window) = gtk_window.window() {
        gdk_window.move_resize(x, y, width, height);
    }
    true
}

#[cfg(target_os = "linux")]
fn allocate_webkit(widget: &gtk::Widget, width: i32, height: i32) {
    use gtk::prelude::*;

    if widget.is::<webkit2gtk::WebView>() {
        let mut allocation = gtk::Allocation::new(0, 0, width, height);
        widget.size_allocate(&mut allocation);
    }
    if let Some(container) = widget.downcast_ref::<gtk::Container>() {
        container.foreach(|child| allocate_webkit(child, width, height));
    }
}

#[cfg(windows)]
fn cover_windows_monitor(window: &tauri::WebviewWindow) -> bool {
    use raw_window_handle::{HasWindowHandle, RawWindowHandle};
    use std::ffi::c_void;

    #[repr(C)]
    struct WinRect {
        left: i32,
        top: i32,
        right: i32,
        bottom: i32,
    }
    #[repr(C)]
    struct MonitorInfo {
        cb_size: u32,
        rc_monitor: WinRect,
        rc_work: WinRect,
        flags: u32,
    }

    #[link(name = "user32")]
    extern "system" {
        fn MonitorFromWindow(hwnd: *mut c_void, flags: u32) -> *mut c_void;
        fn GetMonitorInfoW(monitor: *mut c_void, info: *mut MonitorInfo) -> i32;
        fn GetWindowLongW(hwnd: *mut c_void, index: i32) -> i32;
        fn SetWindowLongW(hwnd: *mut c_void, index: i32, value: i32) -> i32;
        fn SetWindowPos(
            hwnd: *mut c_void,
            insert_after: *mut c_void,
            x: i32,
            y: i32,
            cx: i32,
            cy: i32,
            flags: u32,
        ) -> i32;
    }

    let Ok(handle) = window.window_handle() else {
        return false;
    };
    let RawWindowHandle::Win32(win) = handle.as_raw() else {
        return false;
    };
    let hwnd = win.hwnd.get() as *mut c_void;
    if hwnd.is_null() {
        return false;
    }
    unsafe {
        let monitor = MonitorFromWindow(hwnd, 2);
        if monitor.is_null() {
            return false;
        }
        let mut info = MonitorInfo {
            cb_size: std::mem::size_of::<MonitorInfo>() as u32,
            rc_monitor: WinRect {
                left: 0,
                top: 0,
                right: 0,
                bottom: 0,
            },
            rc_work: WinRect {
                left: 0,
                top: 0,
                right: 0,
                bottom: 0,
            },
            flags: 0,
        };
        if GetMonitorInfoW(monitor, &mut info) == 0 {
            return false;
        }
        const GWL_STYLE: i32 = -16;
        const WS_MAXIMIZE: i32 = 0x0100_0000;
        let style = GetWindowLongW(hwnd, GWL_STYLE);
        if style & WS_MAXIMIZE != 0 {
            SetWindowLongW(hwnd, GWL_STYLE, style & !WS_MAXIMIZE);
        }
        let width = info.rc_monitor.right - info.rc_monitor.left;
        let height = info.rc_monitor.bottom - info.rc_monitor.top;
        if width <= 0 || height <= 0 {
            return false;
        }
        const SWP_SHOWWINDOW: u32 = 0x0040;
        const SWP_FRAMECHANGED: u32 = 0x0020;
        SetWindowPos(
            hwnd,
            (-1isize) as *mut c_void,
            info.rc_monitor.left,
            info.rc_monitor.top,
            width,
            height,
            SWP_SHOWWINDOW | SWP_FRAMECHANGED,
        ) != 0
    }
}

#[cfg(target_os = "linux")]
#[allow(deprecated)]
fn push_opacity_edge(app: &AppHandle, key_down: bool, held: bool, seq: u64, gen: u64, unix: u64) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let down = u8::from(key_down);
    let held_n = u8::from(held);
    let _ = window.with_webview(move |webview| {
        use webkit2gtk::WebViewExt;
        let script = format!(
            "window.__hermesOpacityEdge&&window.__hermesOpacityEdge({{down:{down},held:{held_n},seq:{seq},unix:{unix},gen:{gen}}})"
        );
        webview
            .inner()
            .run_javascript(&script, None::<&gtk::gio::Cancellable>, |_| {});
    });
}

#[cfg(not(target_os = "linux"))]
fn push_opacity_edge(app: &AppHandle, key_down: bool, held: bool, seq: u64, gen: u64, unix: u64) {
    let _ = (app, key_down, held, seq, gen, unix);
}

fn publish_key_edge(app: &AppHandle, held: bool, key_down: bool) {
    KEY_DOWN.store(key_down, Ordering::Release);
    LAST_HELD.store(held, Ordering::Release);
    // Unchanged Ctrl-edge shapes skip combine. A new hittable rect is
    // applied on the next poll and is not held for the opacity present.
    arm_opacity_shape_hold();
    let seq = MODIFIER_SEQ.fetch_add(1, Ordering::Release) + 1;
    let gen = OPACITY_SHAPE_GEN.load(Ordering::Acquire);
    let unix = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|dur| dur.as_millis() as u64)
        .unwrap_or(0);
    crate::trace_debug(
        "opacity-stage",
        &format!(
            "stage=rust down={} held={} seq={seq} gen={gen}",
            u8::from(key_down),
            u8::from(held)
        ),
    );
    push_opacity_edge(app, key_down, held, seq, gen, unix);
    crate::trace_debug("opacity-stage", &format!("stage=emit seq={seq} gen={gen}"));
    crate::trace_debug(
        "key-edge",
        &format!(
            "held={} key={} seq={seq}",
            u8::from(held),
            u8::from(key_down)
        ),
    );
    let _ = app.emit(
        "overlay-interaction",
        serde_json::json!({
            "type": "modifier",
            "key_edge": true,
            "supported": true,
            "held": held,
            "modifier_down": key_down,
            "modifier_seq": seq,
            "shape_gen": gen,
            "unix": unix,
        }),
    );
}

/// Reads `device_query` and emits Ctrl up/down on the change itself.
/// This thread never touches the input shape, focus, or the page's morph
/// deferral, so a release is not stuck behind a frozen shape or a rehearsal.
fn spawn_modifier_monitor(app: AppHandle, hub: Arc<InteractionHub>) {
    std::thread::spawn(move || {
        let Some(device) = DeviceState::checked_new() else {
            return;
        };
        MODIFIER_MONITOR.store(true, Ordering::Release);
        let mut arm_at: Option<Instant> = None;
        let mut chord_suppressed = false;
        let mut last: Option<(bool, bool)> = None;
        loop {
            let modifier = hub
                .config
                .lock()
                .unwrap_or_else(|err| err.into_inner())
                .modifier
                .clone();
            let keys = device.get_keys();
            let physical = modifier_held(&keys, &modifier);
            let held = modifier_engages(
                &keys,
                &modifier,
                Instant::now(),
                &mut arm_at,
                &mut chord_suppressed,
            );
            let key_down = physical && !chord_suppressed;
            if last != Some((held, key_down)) {
                last = Some((held, key_down));
                publish_key_edge(&app, held, key_down);
            }
            std::thread::sleep(Duration::from_millis(5));
        }
    });
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
    spawn_modifier_monitor(app.clone(), hub.clone());
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
        let mut fade_hold: Option<Instant> = None;
        let mut last_edge: Option<(bool, bool)> = None;
        let mut logged_held: Option<bool> = None;
        let mut ignoring: Option<bool> = None;
        let mut region_signature = String::new();
        let mut remembered_rects: Vec<HitRect> = Vec::new();
        let mut painted_shape: Vec<HitRect> = Vec::new();
        let mut arm_at: Option<Instant> = None;
        let mut chord_suppressed = false;
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
            let keys = device.get_keys();
            let physical = modifier_held(&keys, &cfg.modifier);
            let held = modifier_engages(
                &keys,
                &cfg.modifier,
                Instant::now(),
                &mut arm_at,
                &mut chord_suppressed,
            );
            // Copy/paste keeps the key from capturing. The page's ctrl flag
            // is never stored here.
            let key_down = physical && !chord_suppressed;
            // The monitor already pushed this edge. Publishing again from
            // here would wait until shape and focus work return.
            if !MODIFIER_MONITOR.load(Ordering::Acquire) {
                if last_edge != Some((held, key_down)) {
                    last_edge = Some((held, key_down));
                    publish_key_edge(&app, held, key_down);
                }
            }
            let pointer_down = pointer_is_down(&device);
            POINTER_DOWN.store(pointer_down, Ordering::Relaxed);
            let mouse = device.get_mouse();
            remember_screen_cursor(&window, f64::from(mouse.coords.0), f64::from(mouse.coords.1));
            let defer_shrink = opacity_shape_deferred(mono_ms());
            if !defer_shrink && SHAPE_DIRTY.swap(false, Ordering::Relaxed) {
                region_signature.clear();
            }
            let rects = hub
                .rects
                .lock()
                .unwrap_or_else(|err| err.into_inner())
                .clone();
            let cursor = cursor_in_view(
                &window,
                f64::from(mouse.coords.0),
                f64::from(mouse.coords.1),
            );
            let frames = interaction_frame(held, &latched_ids, cursor, &rects, HIT_MARGIN_PX, &cfg);
            if logged_held != Some(held) {
                if rects.iter().any(|rect| is_panel_hit(rect)) {
                    let region = os_input_rects(held, &rects, &frames);
                    let shape = region
                        .iter()
                        .map(|rect| {
                            format!(
                                "{}:{:.0},{:.0},{:.0}x{:.0}",
                                rect.id, rect.x, rect.y, rect.w, rect.h
                            )
                        })
                        .collect::<Vec<_>>()
                        .join(";");
                    let live = rects
                        .iter()
                        .map(|rect| {
                            format!(
                                "{}:{:.0},{:.0},{:.0}x{:.0}",
                                rect.id, rect.x, rect.y, rect.w, rect.h
                            )
                        })
                        .collect::<Vec<_>>()
                        .join(";");
                    crate::trace_debug(
                        "hit-ctrl",
                        &format!(
                            "held={} shape={} live={}",
                            if held { 1 } else { 0 },
                            shape,
                            live
                        ),
                    );
                }
                logged_held = Some(held);
            }
            let region = sync_os_hit_region(
                &app,
                &window,
                held,
                key_down,
                pointer_down,
                cursor,
                &rects,
                &frames,
                &remembered_rects,
                &painted_shape,
                &mut ignoring,
                &mut region_signature,
                defer_shrink,
            );
            if rects.iter().any(|rect| is_orb_hit(rect) || is_pill_hit(rect)) {
                remembered_rects = rects.clone();
            }
            // A real empty publish forgets the old shape. Keeping it would
            // resurrect an orb under a later press that started on the desktop.
            if region.is_empty() {
                painted_shape.clear();
            } else {
                painted_shape = region;
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
                    if apply_ignore_cursor(&window, true, 0) {
                        ignoring = Some(true);
                        region_signature.clear();
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
            let (latched_orb, frozen_press) = {
                let guard = shape_guard_lock();
                let id = guard
                    .latched
                    .as_ref()
                    .map(|rect| rect.id.clone())
                    .unwrap_or_default();
                (id, press_frozen(&guard))
            };
            let monitor = MODIFIER_MONITOR.load(Ordering::Acquire);
            let (page_held, page_key) = page_modifier(
                monitor,
                LAST_HELD.load(Ordering::Acquire),
                KEY_DOWN.load(Ordering::Acquire),
                held,
                key_down,
            );
            let items = if page_held == held {
                items
            } else {
                interaction_frame(page_held, &latched_ids, cursor, &rects, HIT_MARGIN_PX, &cfg)
                    .iter()
                    .map(|item| OpacityItem {
                        id: item.id.clone(),
                        opacity: item.opacity,
                        capture: item.capture,
                    })
                    .collect()
            };
            let modifier_seq = MODIFIER_SEQ.load(Ordering::Acquire);
            let signature = format!(
                "{}|focus={focus_owner}|held={}|key={}|latch={latched_orb}|frozen={}",
                items
                    .iter()
                    .map(|item| format!("{}={:.2}:{}", item.id, item.opacity, item.capture))
                    .collect::<Vec<_>>()
                    .join("|"),
                u8::from(page_held),
                u8::from(page_key),
                u8::from(frozen_press),
            );
            let changed = signature != last_signature;
            let (emit, next_hold) =
                proximity_emit_hold(changed, Instant::now(), fade_hold, ORB_FADE_EMIT);
            fade_hold = next_hold;
            if !emit {
                continue;
            }
            if changed {
                last_signature = signature;
            }
            let _ = app.emit(
                "overlay-interaction",
                serde_json::json!({
                    "type": "proximity",
                    "supported": true,
                    "focus_owner": focus_owner,
                    "held": page_held,
                    "modifier_down": page_key,
                    "modifier_seq": modifier_seq,
                    "latched_orb": latched_orb,
                    "press_frozen": frozen_press,
                    "opacities": items,
                }),
            );
        }
    });
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ShapeCombine {
    Apply,
    Skip,
    Defer,
}

/// A pointer can hit `inner` somewhere `outer` does not already cover.
fn rect_covers(outer: &HitRect, inner: &HitRect) -> bool {
    const SLOP: f64 = 0.5;
    outer.x <= inner.x + SLOP
        && outer.y <= inner.y + SLOP
        && outer.x + outer.w + SLOP >= inner.x + inner.w
        && outer.y + outer.h + SLOP >= inner.y + inner.h
}

/// True when `next` contains a rect a pointer could not hit in `painted`.
pub fn shape_adds_hittable(painted: &[HitRect], next: &[HitRect]) -> bool {
    next.iter()
        .any(|rect| !painted.iter().any(|old| rect_covers(old, rect)))
}

/// Opens, morphs, and startup always apply. A Ctrl-edge hold may skip an
/// unchanged region or defer a shrink. It must not defer a new hittable rect.
pub fn shape_combine_action(hold: bool, adds_hit: bool, unchanged: bool) -> ShapeCombine {
    if adds_hit {
        return ShapeCombine::Apply;
    }
    if unchanged {
        return ShapeCombine::Skip;
    }
    if hold {
        return ShapeCombine::Defer;
    }
    ShapeCombine::Apply
}

#[cfg_attr(target_os = "linux", allow(dead_code))]
fn view_css_size(window: &tauri::WebviewWindow) -> (f64, f64) {
    let scale = window.scale_factor().unwrap_or(1.0).max(0.01);
    match window.inner_size() {
        Ok(size) => (
            f64::from(size.width) / scale,
            f64::from(size.height) / scale,
        ),
        Err(_) => (0.0, 0.0),
    }
}

/// A drag publishes one rect the size of the view. A settings card of
/// 680×660 on a 1024×768 screen is large and is not this.
pub fn rect_covers_view(rect: &HitRect, view_w: f64, view_h: f64) -> bool {
    if view_w < 1.0 || view_h < 1.0 {
        return false;
    }
    rect.x <= 1.0 && rect.y <= 1.0 && rect.w >= view_w - 2.0 && rect.h >= view_h - 2.0
}

/// Windows and macOS click-through is the whole window (`set_ignore_cursor_events`).
/// Pass the cursor through unless it is inside a rect this frame is capturing.
/// A sticky `capture` flag does not keep the window after the cursor leaves
/// that rect. A full-window rect captures only while the pointer is down,
/// which is a drag. An open panel does not.
pub fn windows_cursor_ignored(
    cursor: Option<(f64, f64)>,
    frames: &[ElementFrame],
    rects: &[HitRect],
    view_w: f64,
    view_h: f64,
    pointer_down: bool,
) -> bool {
    let Some((x, y)) = cursor else {
        return true;
    };
    let hot = frames.iter().any(|frame| {
        if !frame.capture {
            return false;
        }
        let Some(rect) = rects.iter().find(|item| item.id == frame.id) else {
            return false;
        };
        if rect_covers_view(rect, view_w, view_h) && !pointer_down {
            return false;
        }
        // R-CT-01 allows HIT_MARGIN_PX (12) around orbs and panels.
        // Orbs use that pad so Ctrl+hover still finds the disc.
        // Panels use 0, so 10px outside still reaches the window behind.
        // Linux GDK already uses the raw rect.
        let pad = if is_panel_hit(rect) {
            0.0
        } else {
            HIT_MARGIN_PX
        };
        distance_to_hit(x, y, rect) <= pad
    });
    !hot
}

fn sync_os_hit_region(
    app: &AppHandle,
    window: &tauri::WebviewWindow,
    held: bool,
    key_down: bool,
    pointer_down: bool,
    cursor: Option<(f64, f64)>,
    rects: &[HitRect],
    frames: &[ElementFrame],
    previous_rects: &[HitRect],
    last_painted: &[HitRect],
    ignoring: &mut Option<bool>,
    region_signature: &mut String,
    defer_shrink: bool,
) -> Vec<HitRect> {
    #[cfg(target_os = "linux")]
    {
        let region = guarded_input_shape(
            held,
            key_down,
            pointer_down,
            cursor,
            rects,
            frames,
            previous_rects,
            last_painted,
        );
        // Show clears the Linux input shape. For a short beat after reveal,
        // an empty poll must not replace the orb that was just applied.
        if region.is_empty() && mono_ms() < EMPTY_BLOCK_UNTIL.load(Ordering::Relaxed) {
            return last_painted.to_vec();
        }
        let origin = window.inner_position().ok();
        let scale = window.scale_factor().unwrap_or(1.0).max(0.01);
        let (origin_x, origin_y) = origin
            .map(|point| (f64::from(point.x), f64::from(point.y)))
            .unwrap_or((0.0, 0.0));
        let signature = format!(
            "{origin_x:.0},{origin_y:.0},{scale:.2}|{}",
            region
                .iter()
                .map(|rect| {
                    format!(
                        "{}:{:.0},{:.0},{:.0},{:.0}",
                        rect.id, rect.x, rect.y, rect.w, rect.h
                    )
                })
                .collect::<Vec<_>>()
                .join(";")
        );
        let adds_hit = shape_adds_hittable(last_painted, &region);
        let action = shape_combine_action(defer_shrink, adds_hit, signature == *region_signature);
        match action {
            ShapeCombine::Skip => return region,
            // Keep the rects a pointer can already hit. The signature stays
            // so the shrink still applies once the Ctrl-edge hold ends.
            ShapeCombine::Defer => return last_painted.to_vec(),
            ShapeCombine::Apply => {}
        }
        *region_signature = signature;
        apply_linux_input_shape(app, &region, scale);
        *ignoring = Some(region.is_empty());
        let _ = (window, origin_x, origin_y);
        return region;
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = (
            app,
            held,
            key_down,
            previous_rects,
            last_painted,
            region_signature,
            defer_shrink,
        );
        let (view_w, view_h) = view_css_size(window);
        let ignore = windows_cursor_ignored(cursor, frames, rects, view_w, view_h, pointer_down);
        let shape_n = frames.iter().filter(|item| item.capture).count();
        if *ignoring != Some(ignore) && apply_ignore_cursor(window, ignore, shape_n) {
            *ignoring = Some(ignore);
        }
        Vec::new()
    }
}



#[cfg(target_os = "linux")]
fn apply_linux_input_shape(app: &AppHandle, rects: &[HitRect], scale: f64) {
    let rects = rects.to_vec();
    let scale = if scale > 0.0 { scale } else { 1.0 };
    let gen = SHAPE_GEN.fetch_add(1, Ordering::Relaxed) + 1;
    let app = app.clone();
    let handle = app.clone();
    let _ = handle.run_on_main_thread(move || {
        if SHAPE_GEN.load(Ordering::Relaxed) != gen {
            SHAPE_DIRTY.store(true, Ordering::Relaxed);
            return;
        }
        if !paint_linux_input_shape(&app, &rects, scale) {
            SHAPE_DIRTY.store(true, Ordering::Relaxed);
        }
    });
}

#[cfg(target_os = "linux")]
fn paint_linux_input_shape(app: &AppHandle, rects: &[HitRect], scale: f64) -> bool {
    use gtk::prelude::*;
    let Some(window) = app.get_webview_window("main") else {
        return false;
    };
    let Ok(gtk_window) = window.gtk_window() else {
        return false;
    };
    let Some(gdk_window) = gtk_window.window() else {
        return false;
    };
    let scale = if scale > 0.0 { scale } else { 1.0 };
    let pixels: Vec<gtk::cairo::RectangleInt> = rects
        .iter()
        .filter(|rect| rect.w >= 1.0 && rect.h >= 1.0)
        .map(|rect| {
            gtk::cairo::RectangleInt::new(
                (rect.x * scale).floor() as i32,
                (rect.y * scale).floor() as i32,
                ((rect.w * scale).ceil() as i32).max(1),
                ((rect.h * scale).ceil() as i32).max(1),
            )
        })
        .collect();
    if pixels.is_empty() && mono_ms() < EMPTY_BLOCK_UNTIL.load(Ordering::Relaxed) {
        return true;
    }
    let region = if pixels.is_empty() {
        gtk::cairo::Region::create_rectangle(&gtk::cairo::RectangleInt::new(0, 0, 1, 1))
    } else {
        gtk::cairo::Region::create_rectangles(&pixels)
    };
    crate::trace_debug(
        "hit-ipc",
        &format!("cmd=input-shape n={} platform=linux", pixels.len()),
    );
    gdk_window.input_shape_combine_region(&region, 0, 0);
    true
}

/// After show, ignore empty shapes briefly. A reveal/resize poll was clearing
/// the orb (`n=1` then `n=0`) before the click landed.
pub fn hold_empty_input_shape() {
    EMPTY_BLOCK_UNTIL.store(mono_ms().saturating_add(400), Ordering::Relaxed);
    SHAPE_DIRTY.store(true, Ordering::Relaxed);
}

fn remember_screen_cursor(window: &tauri::WebviewWindow, mouse_x: f64, mouse_y: f64) {
    let Some(point) = screen_point(window, mouse_x, mouse_y) else {
        return;
    };
    *screen_cursor()
        .lock()
        .unwrap_or_else(|err| err.into_inner()) = Some(point);
}

fn screen_point(window: &tauri::WebviewWindow, mouse_x: f64, mouse_y: f64) -> Option<(f64, f64)> {
    // Polled global cursor, not a DOM mouse event. Those do not fire while
    // the window is click-through. Windows coords are GetCursorPos via
    // device_query. Linux coords are XQueryPointer on the root window.
    let _ = window;
    Some((mouse_x, mouse_y))
}

pub fn css_cursor(window: &tauri::WebviewWindow) -> Option<(f64, f64)> {
    stored_css_cursor(window)
}

fn stored_css_cursor(window: &tauri::WebviewWindow) -> Option<(f64, f64)> {
    let (x, y) = (*screen_cursor()
        .lock()
        .unwrap_or_else(|err| err.into_inner()))?;
    let origin = window.inner_position().ok()?;
    let scale = window.scale_factor().ok()?;
    if scale <= 0.0 {
        return None;
    }
    Some(css_point_from_screen(
        x,
        y,
        f64::from(origin.x),
        f64::from(origin.y),
        scale,
    ))
}

/// Recompute the OS shape from the rects just published and the latest
/// cursor, on the same turn as `show`. The poll's cached signature would
/// otherwise skip a window that GDK cleared when it mapped.
pub fn reapply_live_input_shape(app: &AppHandle, hub: &InteractionHub) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let rects = hub
        .rects
        .lock()
        .unwrap_or_else(|err| err.into_inner())
        .clone();
    let cfg = hub
        .config
        .lock()
        .unwrap_or_else(|err| err.into_inner())
        .clone();
    let latched = hub
        .latched_ids
        .lock()
        .unwrap_or_else(|err| err.into_inner())
        .clone();
    let held = LAST_HELD.load(Ordering::Relaxed);
    let key_down = KEY_DOWN.load(Ordering::Relaxed);
    let pointer_down = POINTER_DOWN.load(Ordering::Relaxed);
    let cursor = stored_css_cursor(&window);
    let frames = interaction_frame(held, &latched, cursor, &rects, HIT_MARGIN_PX, &cfg);
    let region = guarded_input_shape(
        held,
        key_down,
        pointer_down,
        cursor,
        &rects,
        &frames,
        &rects,
        &[],
    );
    SHAPE_GEN.fetch_add(1, Ordering::Relaxed);
    #[cfg(not(target_os = "linux"))]
    {
        let (view_w, view_h) = view_css_size(&window);
        let ignore =
            windows_cursor_ignored(cursor, &frames, &rects, view_w, view_h, pointer_down);
        let shape_n = frames.iter().filter(|item| item.capture).count();
        let _ = apply_ignore_cursor(&window, ignore, shape_n);
    }
    if region.is_empty() {
        SHAPE_DIRTY.store(true, Ordering::Relaxed);
        return;
    }
    let scale = window.scale_factor().unwrap_or(1.0).max(0.01);
    #[cfg(target_os = "linux")]
    {
        if !paint_linux_input_shape(app, &region, scale) {
            SHAPE_DIRTY.store(true, Ordering::Relaxed);
        }
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = (app, scale);
    }
    SHAPE_DIRTY.store(true, Ordering::Relaxed);
}

/// Screen pixels to CSS pixels inside the window.
pub fn css_point_from_screen(
    x: f64,
    y: f64,
    origin_x: f64,
    origin_y: f64,
    scale: f64,
) -> (f64, f64) {
    ((x - origin_x) / scale, (y - origin_y) / scale)
}

fn cursor_in_view(window: &tauri::WebviewWindow, mouse_x: f64, mouse_y: f64) -> Option<(f64, f64)> {
    let origin = window.inner_position().ok()?;
    let scale = window.scale_factor().ok()?;
    if scale <= 0.0 {
        return None;
    }
    // GTK's seat position stays on the last grabbed point after a pointer-capture
    // drag. The poll already read the global cursor: XQueryPointer on Linux,
    // GetCursorPos on Windows. Both keep moving while the window is click-through.
    let (x, y) = (mouse_x, mouse_y);
    Some(css_point_from_screen(
        x,
        y,
        f64::from(origin.x),
        f64::from(origin.y),
        scale,
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
    fn opacity_shape_waits_for_the_write_then_falls_back() {
        assert_eq!(opacity_shape_gate(10, false, 50), OpacityShapeGate::Apply);
        assert_eq!(opacity_shape_gate(10, true, 50), OpacityShapeGate::Defer);
        assert_eq!(opacity_shape_gate(50, true, 50), OpacityShapeGate::Fallback);
        assert_eq!(opacity_shape_gate(80, true, 0), OpacityShapeGate::Defer);
    }

    fn hit(id: &str, x: f64, y: f64, w: f64, h: f64) -> HitRect {
        HitRect {
            id: id.into(),
            x,
            y,
            w,
            h,
            z: 0,
            round: true,
        }
    }

    #[test]
    fn ctrl_edge_hold_never_delays_a_new_hit_rect() {
        let orb = hit("orb:default", 10.0, 20.0, 44.0, 44.0);
        let panel = hit("panel:default", 10.0, 80.0, 420.0, 560.0);
        assert!(shape_adds_hittable(&[], &[orb.clone()]));
        assert!(!shape_adds_hittable(&[orb.clone()], &[orb.clone()]));
        assert!(shape_adds_hittable(&[orb.clone()], &[orb.clone(), panel.clone()]));
        assert!(!shape_adds_hittable(
            &[orb.clone(), panel.clone()],
            &[orb.clone()]
        ));
        let moved = hit("orb:default", 80.0, 20.0, 44.0, 44.0);
        assert!(shape_adds_hittable(&[orb.clone()], &[moved]));
        assert_eq!(
            shape_combine_action(true, true, false),
            ShapeCombine::Apply
        );
        assert_eq!(
            shape_combine_action(true, false, true),
            ShapeCombine::Skip
        );
        assert_eq!(
            shape_combine_action(true, false, false),
            ShapeCombine::Defer
        );
        assert_eq!(
            shape_combine_action(false, false, false),
            ShapeCombine::Apply
        );
        assert_eq!(
            shape_combine_action(false, true, false),
            ShapeCombine::Apply
        );
    }

    #[test]
    fn windows_click_through_follows_the_cursor_not_an_open_panel() {
        let panel = HitRect {
            id: "settings".into(),
            x: 150.0,
            y: 66.0,
            w: 680.0,
            h: 660.0,
            z: 1,
            round: false,
        };
        let sticky = vec![ElementFrame {
            id: "settings".into(),
            opacity: 1.0,
            capture: true,
        }];
        // (200, 384) is inside the 1024×768 settings card. That point captures.
        assert!(!windows_cursor_ignored(
            Some((200.0, 384.0)),
            &sticky,
            &[panel.clone()],
            1024.0,
            768.0,
            false,
        ));
        // (16, 384) is beside it. A sticky capture flag must not take the window.
        assert!(windows_cursor_ignored(
            Some((16.0, 384.0)),
            &sticky,
            &[panel.clone()],
            1024.0,
            768.0,
            false,
        ));
        // 10px outside the panel edge. The 12px pad does not apply to panels.
        assert!(windows_cursor_ignored(
            Some((140.0, 384.0)),
            &sticky,
            &[panel.clone()],
            1024.0,
            768.0,
            false,
        ));
        let orb = HitRect {
            id: "bot:field".into(),
            x: 100.0,
            y: 100.0,
            w: 44.0,
            h: 44.0,
            z: 0,
            round: true,
        };
        let orb_frame = vec![ElementFrame {
            id: "bot:field".into(),
            opacity: 1.0,
            capture: true,
        }];
        // 10px outside the disc is still inside the orb pad.
        assert!(!windows_cursor_ignored(
            Some((122.0, 90.0)),
            &orb_frame,
            &[orb],
            1024.0,
            768.0,
            false,
        ));
        assert!(windows_cursor_ignored(
            None,
            &sticky,
            &[panel.clone()],
            1024.0,
            768.0,
            false,
        ));
        let full = HitRect {
            id: "settings".into(),
            x: 0.0,
            y: 0.0,
            w: 1024.0,
            h: 768.0,
            z: 1,
            round: false,
        };
        assert!(rect_covers_view(&full, 1024.0, 768.0));
        assert!(!rect_covers_view(&panel, 1024.0, 768.0));
        assert!(windows_cursor_ignored(
            Some((16.0, 384.0)),
            &sticky,
            &[full.clone()],
            1024.0,
            768.0,
            false,
        ));
        assert!(!windows_cursor_ignored(
            Some((16.0, 384.0)),
            &sticky,
            &[full],
            1024.0,
            768.0,
            true,
        ));
    }

    #[test]
    fn fresh_modifier_sample_requires_the_key_and_ignores_copy_paste() {
        assert!(modifier_physically_down(&[Keycode::LControl], "ctrl"));
        assert!(modifier_physically_down(&[Keycode::RControl], "ctrl"));
        assert!(!modifier_physically_down(
            &[Keycode::LControl, Keycode::C],
            "ctrl"
        ));
        assert!(!modifier_physically_down(&[Keycode::LControl, Keycode::V], "ctrl"));
        assert!(!modifier_physically_down(&[], "ctrl"));
        assert!(modifier_physically_down(&[Keycode::LShift], "shift"));
        assert!(!modifier_physically_down(&[Keycode::LControl], "shift"));
    }

    #[test]
    fn page_modifier_prefers_the_live_monitor_over_a_stale_sample() {
        assert_eq!(page_modifier(true, false, false, true, true), (false, false));
        assert_eq!(page_modifier(true, true, true, false, false), (true, true));
        assert_eq!(page_modifier(false, false, false, true, true), (true, true));
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
                round: true,
            },
            HitRect {
                id: "b".into(),
                x: 100.0,
                y: 0.0,
                w: 40.0,
                h: 40.0,
                z: 0,
                round: true,
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

    fn bottom_dock(width: i32) -> WmStrut {
        WmStrut {
            left: 0,
            right: 0,
            top: 0,
            bottom: width,
            left_start: 0,
            left_end: 0,
            right_start: 0,
            right_end: 0,
            top_start: 0,
            top_end: 0,
            bottom_start: 0,
            bottom_end: 1919,
        }
    }

    #[test]
    fn work_area_bottom_reserve_and_struts() {
        assert_eq!(work_area_insets(0, 0, 1920, 1080, 0, 0, 1920, 1040, 1.0), (0, 0, 40, 0));
        assert_eq!(work_area_insets(0, 0, 2560, 1440, 0, 0, 2560, 1400, 2.0), (0, 0, 20, 0));
        assert_eq!(work_area_insets(0, 0, 1280, 800, 0, 0, 1280, 800, 1.0), (0, 0, 0, 0));
        assert_eq!(reported_work_insets(0, 0, 1920, 1080, 0, 0, 0, 0, 1.0), None);
        assert_eq!(WORK_AREA_FALLBACK_BOTTOM, 48);
        let dock = insets_from_struts(0, 0, 1920, 1080, 1920, 1080, &[bottom_dock(56)], None, 1.0);
        assert_eq!(dock, Some((0, 0, 56, 0)));
        let scaled = insets_from_struts(0, 0, 1920, 1080, 1920, 1080, &[bottom_dock(80)], None, 2.0);
        assert_eq!(scaled, Some((0, 0, 40, 0)));
        let area = insets_from_struts(0, 0, 1920, 1080, 1920, 1080, &[], Some((0, 0, 1920, 1040)), 1.0);
        assert_eq!(area, Some((0, 0, 40, 0)));
        assert_eq!(insets_from_struts(0, 0, 1920, 1080, 1920, 1080, &[], None, 1.0), None);
        assert_eq!(
            insets_from_struts(0, 0, 1920, 1080, 1920, 1080, &[], Some((0, 0, 1920, 1080)), 1.0),
            Some((0, 0, 0, 0))
        );
        assert_eq!(pick_reported_insets(&[None, None, None]), (0, 0, 48, 0));
        assert_eq!(
            pick_reported_insets(&[Some((0, 0, 56, 0)), Some((0, 0, 0, 0)), None]),
            (0, 0, 56, 0)
        );
        assert_eq!(
            pick_reported_insets(&[Some((0, 0, 0, 0)), Some((0, 0, 0, 0))]),
            (0, 0, 0, 0)
        );
        assert_eq!(floor_bottom_inset((0, 0, 0, 0)), (0, 0, 48, 0));
        assert_eq!(floor_bottom_inset((0, 0, 40, 0)), (0, 0, 48, 0));
        assert_eq!(floor_bottom_inset((0, 0, 56, 0)), (0, 0, 56, 0));
        assert_eq!(floor_bottom_inset((8, 4, 0, 6)), (8, 4, 48, 6));
    }

    #[test]
    fn orb_fades_inside_the_proximity_radius_and_stays_opaque_outside() {
        assert_eq!(ORB_PROXIMITY_PX, 72.0);
        let start = Instant::now();
        let (emit, hold) = proximity_emit_hold(true, start, None, ORB_FADE_EMIT);
        assert!(emit);
        let again = proximity_emit_hold(false, start + Duration::from_millis(32), hold, ORB_FADE_EMIT);
        assert!(again.0);
        let done = proximity_emit_hold(
            false,
            start + Duration::from_millis(200),
            again.1,
            ORB_FADE_EMIT,
        );
        assert!(!done.0);
        assert!(done.1.is_none());
        assert!((orb_near_opacity(0.18) - 0.18).abs() < 0.001);
        assert!((orb_near_opacity(f64::NAN) - 0.25).abs() < 0.001);
        assert!((orb_near_opacity(0.5) - 0.30).abs() < 0.001);
        assert_eq!(work_area_insets(0, 0, 1920, 1080, 0, 0, 1920, 1040, 1.0), (0, 0, 40, 0));
        assert_eq!(work_area_insets(0, 0, 2560, 1440, 0, 0, 2560, 1400, 2.0), (0, 0, 20, 0));
        assert_eq!(work_area_insets(0, 0, 1280, 800, 0, 0, 1280, 800, 1.0), (0, 0, 0, 0));
        let cfg = fade_cfg();
        let orb = HitRect {
            id: "bot:a".into(),
            x: 0.0,
            y: 0.0,
            w: 44.0,
            h: 44.0,
            z: 0,
            round: true,
        };
        let far = interaction_frame(
            false,
            &[],
            Some((400.0, 400.0)),
            &[orb.clone()],
            HIT_MARGIN_PX,
            &cfg,
        );
        assert!((far[0].opacity - 1.0).abs() < 0.001 && !far[0].capture);
        let near = interaction_frame(
            false,
            &[],
            Some((22.0, 22.0)),
            &[orb.clone()],
            HIT_MARGIN_PX,
            &cfg,
        );
        assert!(near[0].opacity <= 0.30 && !near[0].capture);
        let held = interaction_frame(
            true,
            &[],
            Some((22.0, 22.0)),
            &[orb.clone()],
            HIT_MARGIN_PX,
            &cfg,
        );
        assert!(held[0].capture && held[0].opacity == 1.0);
        let aim = interaction_frame(
            true,
            &[],
            Some((84.0, 22.0)),
            &[orb.clone()],
            HIT_MARGIN_PX,
            &cfg,
        );
        assert!(!aim[0].capture && aim[0].opacity == 1.0);
        let aim_up = interaction_frame(
            false,
            &[],
            Some((84.0, 22.0)),
            &[orb.clone()],
            HIT_MARGIN_PX,
            &cfg,
        );
        assert!(aim_up[0].opacity <= 0.30 && !aim_up[0].capture);
        let quiet = interaction_frame(false, &[], None, &[orb], HIT_MARGIN_PX, &cfg);
        assert!((quiet[0].opacity - 1.0).abs() < 0.001 && !quiet[0].capture);
    }

    #[test]
    fn screen_pointer_maps_into_css_pixels() {
        assert_eq!(
            css_point_from_screen(10.0, 20.0, 0.0, 0.0, 1.0),
            (10.0, 20.0)
        );
        assert_eq!(
            css_point_from_screen(300.0, 250.0, 100.0, 50.0, 2.0),
            (100.0, 100.0)
        );
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
    fn modifier_far_from_elements_does_not_capture_or_fade() {
        let rects = bots();
        let cfg = fade_cfg();
        let far = Some((1000.0, 1000.0));
        let held = interaction_frame(true, &[], far, &rects, HIT_MARGIN_PX, &cfg);
        let idle = interaction_frame(false, &[], far, &rects, HIT_MARGIN_PX, &cfg);
        assert!(held.iter().all(|item| !item.capture));
        assert!(idle.iter().all(|item| !item.capture));
        assert!((frame_of(&held, "a").opacity - 1.0).abs() < 0.001);
        assert!((frame_of(&held, "center").opacity - 0.18).abs() < 0.001);
        assert!((frame_of(&idle, "a").opacity - 1.0).abs() < 0.001);
        assert!((frame_of(&idle, "center").opacity - 1.0).abs() < 0.001);

        let outside_margin = Some((70.0, 20.0));
        let near = interaction_frame(false, &[], outside_margin, &rects, HIT_MARGIN_PX, &cfg);
        assert!((frame_of(&near, "a").opacity - 0.18).abs() < 0.001);
        assert!(!frame_of(&near, "a").capture);
        assert!((frame_of(&near, "center").opacity - 1.0).abs() < 0.001);
    }

    #[test]
    fn unheld_captures_the_element_under_the_cursor_and_modifier_washes_panels() {
        let rects = bots();
        let cfg = fade_cfg();
        let over_a = interaction_frame(false, &[], Some((20.0, 20.0)), &rects, HIT_MARGIN_PX, &cfg);
        assert!((frame_of(&over_a, "a").opacity - 0.18).abs() < 0.001);
        assert!(!frame_of(&over_a, "a").capture);
        assert!((frame_of(&over_a, "b").opacity - 1.0).abs() < 0.001);
        assert!(!frame_of(&over_a, "b").capture);
        assert_eq!(frame_of(&over_a, "center").opacity, 1.0);
        assert!(!frame_of(&over_a, "center").capture);
        assert_eq!(over_a.iter().filter(|item| item.capture).count(), 0);

        let held = interaction_frame(true, &[], Some((20.0, 20.0)), &rects, HIT_MARGIN_PX, &cfg);
        assert!(frame_of(&held, "a").capture);
        assert_eq!(frame_of(&held, "a").opacity, 1.0);
        assert!(!frame_of(&held, "b").capture);
        assert!((frame_of(&held, "b").opacity - 1.0).abs() < 0.001);
        assert!(!frame_of(&held, "center").capture);
        assert!((frame_of(&held, "center").opacity - 0.18).abs() < 0.001);

        let over_center =
            interaction_frame(false, &[], Some((40.0, 100.0)), &rects, HIT_MARGIN_PX, &cfg);
        assert_eq!(frame_of(&over_center, "center").opacity, 1.0);
        assert!(frame_of(&over_center, "center").capture);
        assert!(!frame_of(&over_center, "a").capture);
        assert!(!frame_of(&over_center, "b").capture);
    }

    #[test]
    fn panel_stays_opaque_when_the_cursor_is_on_another_element() {
        let rects = bots();
        let cfg = fade_cfg();
        let latched = vec!["center".to_string()];
        let cursor_on_a = Some((20.0, 20.0));
        let away = interaction_frame(false, &latched, cursor_on_a, &rects, HIT_MARGIN_PX, &cfg);
        assert_eq!(frame_of(&away, "center").opacity, 1.0);
        assert!(!frame_of(&away, "center").capture);
        assert!((frame_of(&away, "a").opacity - 0.18).abs() < 0.001);
        assert!(!frame_of(&away, "a").capture);

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
        assert_eq!(frame_of(&over_center, "center").opacity, 1.0);
    }

    #[test]
    fn capture_follows_the_padded_rect_until_the_modifier_is_held() {
        let rects = [rect()];
        let cfg = fade_cfg();
        let inside = interaction_frame(
            false,
            &[],
            Some((110.0, 110.0)),
            &rects,
            HIT_MARGIN_PX,
            &cfg,
        );
        let padded = interaction_frame(
            false,
            &[],
            Some((152.0, 110.0)),
            &rects,
            HIT_MARGIN_PX,
            &cfg,
        );
        let outside = interaction_frame(
            false,
            &[],
            Some((170.0, 110.0)),
            &rects,
            HIT_MARGIN_PX,
            &cfg,
        );
        let held = interaction_frame(true, &[], Some((110.0, 110.0)), &rects, HIT_MARGIN_PX, &cfg);
        let missing = interaction_frame(false, &[], None, &rects, HIT_MARGIN_PX, &cfg);
        assert!(inside[0].capture && inside[0].opacity == 1.0);
        assert!(padded[0].capture && padded[0].opacity == 1.0);
        assert!(!outside[0].capture && (outside[0].opacity - 1.0).abs() < 0.001);
        assert!(!held[0].capture && (held[0].opacity - 0.18).abs() < 0.001);
        assert!(!missing[0].capture && missing[0].opacity == 1.0);
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

        let by_z = interaction_frame(false, &[], strip, &rects, HIT_MARGIN_PX, &cfg);
        assert!(frame_of(&by_z, "settings").capture);
        assert!(!frame_of(&by_z, "center").capture);
        assert_eq!(frame_of(&by_z, "center").opacity, 1.0);

        let passed = interaction_frame(true, &[], strip, &rects, HIT_MARGIN_PX, &cfg);
        assert!(passed.iter().all(|item| !item.capture));
        assert!(passed.iter().all(|item| item.opacity < 1.0));

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
    fn overlapping_orbs_prefer_the_smaller_disc() {
        let rects = vec![
            HitRect {
                id: "bot:writer".into(),
                x: 0.0,
                y: 0.0,
                w: 68.0,
                h: 68.0,
                z: 8,
                round: true,
            },
            HitRect {
                id: "bot:suborb:writer:job".into(),
                x: 40.0,
                y: 40.0,
                w: 42.0,
                h: 42.0,
                z: 1,
                round: true,
            },
        ];
        let hit = element_under_cursor(Some((50.0, 50.0)), &rects, HIT_MARGIN_PX, &[]);
        assert_eq!(hit.map(|rect| rect.id.as_str()), Some("bot:suborb:writer:job"));
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
            false,
            &[],
            Some((50.0, 50.0)),
            &[orb.clone()],
            HIT_MARGIN_PX,
            &cfg,
        );
        let padded = interaction_frame(
            false,
            &[],
            Some((110.0, 50.0)),
            &[orb.clone()],
            HIT_MARGIN_PX,
            &cfg,
        );
        let bbox_corner = interaction_frame(
            false,
            &[],
            Some((100.0, 100.0)),
            &[orb.clone()],
            HIT_MARGIN_PX,
            &cfg,
        );
        assert!(!inside[0].capture);
        assert!((inside[0].opacity - 0.18).abs() < 0.001);
        assert!(!padded[0].capture);
        assert!((padded[0].opacity - 0.18).abs() < 0.001);
        let held_orb = interaction_frame(
            true,
            &[],
            Some((110.0, 50.0)),
            &[orb.clone()],
            HIT_MARGIN_PX,
            &cfg,
        );
        assert!(held_orb[0].capture && held_orb[0].opacity == 1.0);
        assert!(!bbox_corner[0].capture);
        assert!((bbox_corner[0].opacity - 0.18).abs() < 0.001);

        let mut square = orb;
        square.round = false;
        let square_corner = interaction_frame(
            false,
            &[],
            Some((100.0, 100.0)),
            &[square.clone()],
            HIT_MARGIN_PX,
            &cfg,
        );
        assert!(square_corner[0].capture && square_corner[0].opacity == 1.0);
        let held_panel = interaction_frame(
            true,
            &[],
            Some((50.0, 50.0)),
            &[square],
            HIT_MARGIN_PX,
            &cfg,
        );
        assert!(!held_panel[0].capture);
        assert!((held_panel[0].opacity - 0.18).abs() < 0.001);
    }

    #[test]
    fn settings_and_kanban_orbs_stay_faded_until_the_modifier_is_held() {
        let cfg = fade_cfg();
        let rects = vec![
            HitRect {
                id: "bot:settings".into(),
                x: 0.0,
                y: 0.0,
                w: 40.0,
                h: 40.0,
                z: 0,
                round: true,
            },
            HitRect {
                id: "bot:kanban".into(),
                x: 80.0,
                y: 0.0,
                w: 40.0,
                h: 40.0,
                z: 0,
                round: true,
            },
        ];
        let idle = interaction_frame(false, &[], Some((20.0, 20.0)), &rects, HIT_MARGIN_PX, &cfg);
        assert!(is_orb_hit(&rects[0]) && is_orb_hit(&rects[1]));
        assert!(!frame_of(&idle, "bot:settings").capture);
        assert!((frame_of(&idle, "bot:settings").opacity - 0.18).abs() < 0.001);
        assert!(!frame_of(&idle, "bot:kanban").capture);
        let held = interaction_frame(true, &[], Some((20.0, 20.0)), &rects, HIT_MARGIN_PX, &cfg);
        assert!(frame_of(&held, "bot:settings").capture);
        assert_eq!(frame_of(&held, "bot:settings").opacity, 1.0);
        assert!(!frame_of(&held, "bot:kanban").capture);
        // 60px outside the kanban disc is still inside the 72px fade, so Ctrl
        // returns it to opaque without capturing it.
        assert!((frame_of(&held, "bot:kanban").opacity - 1.0).abs() < 0.001);
    }

    #[test]
    fn preview_pill_stays_solid_until_the_modifier_is_held() {
        let cfg = fade_cfg();
        let rects = vec![
            HitRect {
                id: "pill:a".into(),
                x: 0.0,
                y: 0.0,
                w: 320.0,
                h: 44.0,
                z: 40,
                round: false,
            },
            HitRect {
                id: "panel:a".into(),
                x: 0.0,
                y: 80.0,
                w: 420.0,
                h: 560.0,
                z: 4,
                round: false,
            },
        ];
        assert!(is_pill_hit(&rects[0]));
        assert!(!is_orb_hit(&rects[0]));
        assert!(!is_panel_hit(&rects[0]));
        let idle = interaction_frame(false, &[], Some((40.0, 20.0)), &rects, HIT_MARGIN_PX, &cfg);
        assert_eq!(frame_of(&idle, "pill:a").opacity, 1.0);
        assert!(!frame_of(&idle, "pill:a").capture);
        assert_eq!(frame_of(&idle, "panel:a").opacity, 1.0);
        let held = interaction_frame(true, &[], Some((40.0, 20.0)), &rects, HIT_MARGIN_PX, &cfg);
        assert_eq!(frame_of(&held, "pill:a").opacity, 1.0);
        assert!(frame_of(&held, "pill:a").capture);
        assert!((frame_of(&held, "panel:a").opacity - 0.18).abs() < 0.001);
        assert!(!frame_of(&held, "panel:a").capture);
    }

    #[test]
    fn close_button_passes_through_while_the_modifier_is_held() {
        let cfg = fade_cfg();
        let rects = vec![
            HitRect {
                id: "panel:a".into(),
                x: 0.0,
                y: 0.0,
                w: 420.0,
                h: 560.0,
                z: 4,
                round: false,
            },
            HitRect {
                id: "close:a".into(),
                x: 300.0,
                y: 8.0,
                w: 100.0,
                h: 80.0,
                z: 44,
                round: false,
            },
        ];
        assert!(is_close_hit(&rects[1]));
        assert!(!is_panel_hit(&rects[1]));
        assert!(!is_orb_hit(&rects[1]));
        let over = Some((340.0, 40.0));
        let held = interaction_frame(true, &[], over, &rects, HIT_MARGIN_PX, &cfg);
        assert!(!frame_of(&held, "close:a").capture);
        assert_eq!(frame_of(&held, "close:a").opacity, 1.0);
        assert!(!frame_of(&held, "panel:a").capture);
        assert!((frame_of(&held, "panel:a").opacity - 0.18).abs() < 0.001);
        let shape = os_input_rects(true, &rects, &held);
        assert!(!shape.iter().any(|rect| rect.id == "close:a" || rect.id == "panel:a"));
        assert!(!css_point_hits(&shape, 340.0, 40.0));
        let idle = interaction_frame(false, &[], over, &rects, HIT_MARGIN_PX, &cfg);
        assert!(frame_of(&idle, "close:a").capture);
        assert!(!frame_of(&idle, "panel:a").capture);
        let away = interaction_frame(true, &[], Some((20.0, 200.0)), &rects, HIT_MARGIN_PX, &cfg);
        assert!(!frame_of(&away, "close:a").capture);
        assert!(!frame_of(&away, "panel:a").capture);
    }

    #[test]
    fn held_orb_wins_over_a_covering_panel() {
        let cfg = fade_cfg();
        let rects = vec![
            HitRect {
                id: "bot:mt-reviewer".into(),
                x: 100.0,
                y: 900.0,
                w: 44.0,
                h: 44.0,
                z: 1,
                round: true,
            },
            HitRect {
                id: "settings".into(),
                x: 0.0,
                y: 0.0,
                w: 680.0,
                h: 2256.0,
                z: 30,
                round: false,
            },
        ];
        let on_orb = Some((120.0, 920.0));
        let held = interaction_frame(true, &[], on_orb, &rects, HIT_MARGIN_PX, &cfg);
        assert!(frame_of(&held, "bot:mt-reviewer").capture);
        assert_eq!(frame_of(&held, "bot:mt-reviewer").opacity, 1.0);
        assert!(!frame_of(&held, "settings").capture);
        let shape = os_input_rects(true, &rects, &held);
        assert!(css_point_hits(&shape, 120.0, 920.0));
        assert!(!windows_cursor_ignored(
            on_orb, &held, &rects, 1920.0, 1080.0, false
        ));
        let idle = interaction_frame(false, &[], on_orb, &rects, HIT_MARGIN_PX, &cfg);
        assert!(!frame_of(&idle, "bot:mt-reviewer").capture);
        assert!(frame_of(&idle, "settings").capture);
        assert!(!windows_cursor_ignored(
            on_orb, &idle, &rects, 1920.0, 1080.0, false
        ));
    }

    #[test]
    fn open_panel_is_hit_testable_before_the_cursor_arrives() {
        let cfg = fade_cfg();
        let rects = vec![
            HitRect {
                id: "bot:a".into(),
                x: 0.0,
                y: 700.0,
                w: 44.0,
                h: 44.0,
                z: 1,
                round: true,
            },
            HitRect {
                id: "panel:a".into(),
                x: 80.0,
                y: 40.0,
                w: 420.0,
                h: 560.0,
                z: 4,
                round: false,
            },
            HitRect {
                id: "close:a".into(),
                x: 460.0,
                y: 20.0,
                w: 80.0,
                h: 80.0,
                z: 44,
                round: false,
            },
        ];
        let far = interaction_frame(false, &[], Some((900.0, 900.0)), &rects, HIT_MARGIN_PX, &cfg);
        assert!(!frame_of(&far, "panel:a").capture);
        let region = os_input_rects(false, &rects, &far);
        assert!(css_point_hits(&region, 100.0, 80.0));
        assert!(css_point_hits(&region, 470.0, 40.0));
        assert!(!css_point_hits(&region, 10.0, 710.0));
        assert!(!css_point_hits(&region, 900.0, 900.0));
        assert!(!region.iter().any(|rect| rect.id == "bot:a"));
        let held_far = interaction_frame(true, &[], Some((900.0, 900.0)), &rects, HIT_MARGIN_PX, &cfg);
        let passed = os_input_rects(true, &rects, &held_far);
        assert!(!css_point_hits(&passed, 100.0, 80.0));
        assert!(!css_point_hits(&passed, 470.0, 40.0));
        assert!(!passed.iter().any(|rect| rect.id == "bot:a" || rect.id == "close:a" || rect.id == "panel:a"));
        let over_orb = interaction_frame(true, &[], Some((10.0, 710.0)), &rects, HIT_MARGIN_PX, &cfg);
        assert!(frame_of(&over_orb, "bot:a").capture);
        let armed = os_input_rects(true, &rects, &over_orb);
        assert!(armed.iter().any(|rect| rect.id == "bot:a"));
        assert!(!armed.iter().any(|rect| rect.id == "close:a" || rect.id == "panel:a"));
        assert!(css_point_hits(&armed, 10.0, 710.0));
        assert!(!css_point_hits(&armed, 100.0, 80.0));
        assert!(!css_point_hits(&armed, 470.0, 40.0));
    }

    #[test]
    fn open_panel_docked_orb_stays_in_the_ctrl_shape() {
        let cfg = fade_cfg();
        // The header disc sits inside the panel. Its z is below the panel, so
        // an unheld click still belongs to the card. Ctrl drops panel: and
        // close: and keeps this bot: disc on Windows and Linux.
        let rects = vec![
            HitRect {
                id: "panel:default".into(),
                x: 80.0,
                y: 40.0,
                w: 420.0,
                h: 560.0,
                z: 4,
                round: false,
            },
            HitRect {
                id: "close:default".into(),
                x: 460.0,
                y: 48.0,
                w: 28.0,
                h: 28.0,
                z: 24,
                round: false,
            },
            HitRect {
                id: "bot:default".into(),
                x: 92.0,
                y: 52.0,
                w: 28.0,
                h: 28.0,
                z: 3,
                round: true,
            },
        ];
        let on_orb = Some((100.0, 60.0));
        let on_body = Some((200.0, 300.0));
        let held = interaction_frame(true, &[], on_orb, &rects, HIT_MARGIN_PX, &cfg);
        assert!(frame_of(&held, "bot:default").capture);
        assert!((frame_of(&held, "panel:default").opacity - 0.18).abs() < 0.001);
        assert!(!frame_of(&held, "panel:default").capture);
        assert!(!frame_of(&held, "close:default").capture);
        let shape = os_input_rects(true, &rects, &held);
        assert!(shape.iter().any(|rect| rect.id == "bot:default"));
        assert!(!shape
            .iter()
            .any(|rect| rect.id == "panel:default" || rect.id == "close:default"));
        assert!(css_point_hits(&shape, 100.0, 60.0));
        assert!(!css_point_hits(&shape, 200.0, 300.0));
        assert!(!windows_cursor_ignored(
            on_orb, &held, &rects, 1920.0, 1080.0, false
        ));
        let body = interaction_frame(true, &[], on_body, &rects, HIT_MARGIN_PX, &cfg);
        let passed = os_input_rects(true, &rects, &body);
        assert!(passed.is_empty());
        assert!(windows_cursor_ignored(
            on_body, &body, &rects, 1920.0, 1080.0, false
        ));
        let idle = interaction_frame(false, &[], on_orb, &rects, HIT_MARGIN_PX, &cfg);
        assert!(!frame_of(&idle, "bot:default").capture);
        assert!(frame_of(&idle, "panel:default").capture);
        assert!((frame_of(&idle, "panel:default").opacity - 1.0).abs() < 0.001);
        let region = os_input_rects(false, &rects, &idle);
        assert!(region.iter().any(|rect| rect.id == "panel:default"));
        assert!(!region.iter().any(|rect| rect.id == "bot:default"));
        assert!(css_point_hits(&region, 100.0, 60.0));
        assert!(!windows_cursor_ignored(
            on_orb, &idle, &rects, 1920.0, 1080.0, false
        ));
    }

    fn orb_at(id: &str, x: f64, y: f64) -> HitRect {
        HitRect {
            id: id.into(),
            x,
            y,
            w: 44.0,
            h: 44.0,
            z: 0,
            round: true,
        }
    }

    #[test]
    fn flush_keeps_the_orb_under_ctrl_and_a_press() {
        let cfg = fade_cfg();
        let orb = orb_at("bot:a", 10.0, 10.0);
        let cursor = Some((20.0, 20.0));
        let empty_frames = interaction_frame(true, &[], cursor, &[], HIT_MARGIN_PX, &cfg);
        let kept = shape_after_flush(
            true,
            false,
            false,
            cursor,
            &[],
            &empty_frames,
            &[orb.clone()],
            &[],
        );
        assert_eq!(kept.len(), 1);
        assert_eq!(kept[0].id, "bot:a");
        let physical = shape_after_flush(
            false,
            true,
            false,
            cursor,
            &[],
            &empty_frames,
            &[orb.clone()],
            &[],
        );
        assert_eq!(physical.len(), 1);
        assert_eq!(physical[0].id, "bot:a");
        let away = shape_after_flush(
            true,
            true,
            false,
            Some((400.0, 400.0)),
            &[],
            &empty_frames,
            &[orb.clone()],
            &[],
        );
        assert!(away.is_empty());
        let painted = vec![orb.clone()];
        let press = shape_after_flush(
            false,
            false,
            true,
            Some((400.0, 400.0)),
            &[],
            &empty_frames,
            &[],
            &painted,
        );
        assert_eq!(press.len(), 1);
        assert_eq!(press[0].id, "bot:a");
        assert!(should_keep_hit_rects(true, false, cursor, &[orb.clone()]));
        assert!(!should_keep_hit_rects(true, false, Some((400.0, 400.0)), &[orb.clone()]));
        assert!(should_keep_hit_rects(false, true, Some((400.0, 400.0)), &[orb]));
        assert!(!should_keep_hit_rects(false, false, cursor, &[]));
    }

    #[test]
    fn ctrl_keeps_the_orb_under_a_covering_panel() {
        let cfg = fade_cfg();
        let orb = orb_at("bot:a", 100.0, 100.0);
        let panel = HitRect {
            id: "kanban".into(),
            x: 0.0,
            y: 0.0,
            w: 800.0,
            h: 600.0,
            z: 40,
            round: false,
        };
        let rects = vec![orb.clone(), panel];
        let cursor = Some((110.0, 110.0));
        let frames = interaction_frame(true, &[], cursor, &rects, HIT_MARGIN_PX, &cfg);
        assert!(
            frames
                .iter()
                .any(|frame| frame.id == "bot:a" && frame.capture),
            "the orb under the cursor wins over the covering panel"
        );
        assert!(!frames.iter().any(|frame| frame.id == "kanban" && frame.capture));
        let shape = shape_after_flush(true, true, false, cursor, &rects, &frames, &[], &[]);
        assert!(shape.iter().any(|rect| rect.id == "bot:a"));
        assert!(!shape.iter().any(|rect| rect.id == "kanban" || rect.id.starts_with("close:")));
        let physical = shape_after_flush(false, true, false, cursor, &rects, &frames, &[], &[]);
        assert!(physical.iter().any(|rect| rect.id == "bot:a"));
        let idle = interaction_frame(false, &[], cursor, &rects, HIT_MARGIN_PX, &cfg);
        let plain = shape_after_flush(false, false, false, cursor, &rects, &idle, &[], &[]);
        assert!(!plain.iter().any(|rect| rect.id == "bot:a"));
        let mut published = vec![rects[1].clone()];
        assert!(ensure_modifier_target(
            false,
            true,
            cursor,
            &mut published,
            &rects
        ));
        assert!(published.iter().any(|rect| rect.id == "bot:a"));
        assert!(!ensure_modifier_target(
            false,
            false,
            cursor,
            &mut published,
            &rects
        ));
    }

    #[test]
    fn ctrl_press_freezes_the_orb_until_mouseup() {
        let orb = orb_at("bot:a", 100.0, 700.0);
        let cursor = Some((110.0, 710.0));
        let frames = vec![];
        let mut guard = ShapeGuard::default();
        let (first, note) = resolve_input_shape(
            true,
            true,
            false,
            cursor,
            &[orb.clone()],
            &frames,
            &[],
            &[],
            &mut guard,
        );
        assert_eq!(note.reason, "hit-new");
        assert_eq!(first[0].id, "bot:a");
        let (down, _) = resolve_input_shape(
            true,
            true,
            true,
            cursor,
            &[orb.clone()],
            &frames,
            &[orb.clone()],
            &first,
            &mut guard,
        );
        assert!(guard.frozen.is_some());
        assert!(down.iter().any(|rect| rect.id == "bot:a"));
        let moved = orb_at("bot:a", 800.0, 10.0);
        let (held_down, note) = resolve_input_shape(
            true,
            true,
            true,
            None,
            &[moved.clone()],
            &frames,
            &[moved.clone()],
            &down,
            &mut guard,
        );
        assert_eq!(note.reason, "frozen");
        assert!(
            held_down
                .iter()
                .any(|rect| rect.id == "bot:a" && (rect.x - 100.0).abs() < 1.0),
            "republish while the button is down must not move or drop the orb"
        );
        assert!(!held_down.iter().any(|rect| rect.id.starts_with("close:")));
        let (up, note) = resolve_input_shape(
            true,
            true,
            false,
            None,
            &[moved.clone()],
            &frames,
            &[moved.clone()],
            &[],
            &mut guard,
        );
        assert!(guard.frozen.is_none());
        assert_eq!(note.reason, "cursor-missing");
        assert!(
            !up.is_empty(),
            "a missing cursor sample must not publish n=0 while Ctrl is held"
        );
    }

    #[test]
    fn ctrl_press_arms_the_orb_after_the_key_comes_up() {
        let orb = orb_at("bot:a", 100.0, 700.0);
        let cursor = Some((110.0, 710.0));
        let mut guard = ShapeGuard::default();
        let _ = resolve_input_shape(true, true, false, cursor, &[orb.clone()], &[], &[], &[], &mut guard);
        let _ = resolve_input_shape(
            true,
            true,
            true,
            cursor,
            &[orb.clone()],
            &[],
            &[orb.clone()],
            &[orb.clone()],
            &mut guard,
        );
        assert_eq!(guard.armed_id, "bot:a");
        assert_eq!(guard.armed_up_ms, 0);
        let _ = resolve_input_shape(false, false, true, cursor, &[orb.clone()], &[], &[], &[], &mut guard);
        assert_eq!(
            guard.armed_id, "bot:a",
            "a later key-up must not cancel a press that began with Ctrl"
        );
        let _ = resolve_input_shape(false, false, false, cursor, &[orb.clone()], &[], &[], &[], &mut guard);
        assert_eq!(guard.armed_id, "bot:a");
        assert!(guard.armed_up_ms > 0);
        assert_eq!(armed_press_id(&guard, guard.armed_up_ms + 100), "bot:a");
        assert_eq!(armed_press_id(&guard, guard.armed_up_ms + 801), "");
        let ended = guard.armed_up_ms;
        guard.button_down = true;
        assert_eq!(
            armed_press_id(&guard, ended + 10),
            "",
            "a new button-down is not the armed press"
        );
        guard.button_down = false;
        let _ = resolve_input_shape(false, false, true, cursor, &[orb.clone()], &[], &[], &[], &mut guard);
        assert!(
            guard.armed_id.is_empty(),
            "a press that begins without Ctrl clears the arm"
        );
    }

    #[test]
    fn republish_keeps_the_previous_orb_under_ctrl() {
        let previous = orb_at("bot:a", 100.0, 700.0);
        let moved = orb_at("bot:a", 0.0, 0.0);
        let cursor = Some((110.0, 710.0));
        let mut guard = ShapeGuard::default();
        let (shape, note) = resolve_input_shape(
            true,
            true,
            false,
            cursor,
            &[moved],
            &[],
            &[previous],
            &[],
            &mut guard,
        );
        assert_eq!(note.reason, "hit-prev");
        assert!(shape.iter().any(|rect| (rect.x - 100.0).abs() < 1.0));
        assert!(!shape.is_empty());
        let mut incoming = vec![orb_at("pill:kanban", 0.0, 0.0)];
        let why = retain_modifier_orb(
            true,
            true,
            cursor,
            &mut incoming,
            &[orb_at("bot:a", 100.0, 700.0)],
            &guard.latched,
        );
        assert_eq!(why, "hit-prev");
        assert!(incoming.iter().any(|rect| rect.id == "bot:a"));
        let away = resolve_input_shape(
            true,
            true,
            false,
            Some((10.0, 10.0)),
            &[],
            &[],
            &[orb_at("bot:a", 100.0, 700.0)],
            &[],
            &mut ShapeGuard::default(),
        );
        assert!(away.0.is_empty(), "a cursor that left the orb may publish n=0");
    }

    #[test]
    fn ctrl_c_and_ctrl_v_do_not_engage_the_modifier() {
        let mut armed = None;
        let mut suppressed = false;
        let now = Instant::now();
        let copy = [Keycode::LControl, Keycode::C];
        assert!(!modifier_engages(
            &copy,
            "ctrl",
            now,
            &mut armed,
            &mut suppressed
        ));
        assert!(suppressed);
        let tail = [Keycode::LControl];
        assert!(!modifier_engages(
            &tail,
            "ctrl",
            now + Duration::from_millis(300),
            &mut armed,
            &mut suppressed
        ));
        assert!(suppressed);
        assert!(!modifier_engages(
            &[],
            "ctrl",
            now + Duration::from_millis(400),
            &mut armed,
            &mut suppressed
        ));
        assert!(!suppressed);

        let early = modifier_engages(&tail, "ctrl", now, &mut armed, &mut suppressed);
        assert!(!early);
        let armed_now = modifier_engages(
            &tail,
            "ctrl",
            now + MODIFIER_ARM,
            &mut armed,
            &mut suppressed,
        );
        assert!(armed_now);
        let paste = [Keycode::RControl, Keycode::V];
        assert!(!modifier_engages(
            &paste,
            "ctrl",
            now,
            &mut armed,
            &mut suppressed
        ));
        assert!(suppressed);
        let other = [Keycode::LControl, Keycode::A];
        assert!(!modifier_engages(
            &other,
            "ctrl",
            now,
            &mut armed,
            &mut suppressed
        ));
        assert!(suppressed);
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

    #[test]
    fn suborb_fades_to_0_18_and_stays_click_through_until_ctrl() {
        let cfg = InteractionConfig {
            modifier: "ctrl".into(),
            fade_enabled: true,
            fade_distance: 120.0,
            min_opacity: 0.25,
        };
        let sub = HitRect {
            id: "bot:suborb:mt-coder:task_1".into(),
            x: 10.0,
            y: 10.0,
            w: 20.0,
            h: 20.0,
            z: 1,
            round: true,
        };
        let main = HitRect {
            id: "bot:mt-coder".into(),
            x: 200.0,
            y: 10.0,
            w: 44.0,
            h: 44.0,
            z: 1,
            round: true,
        };
        let near = interaction_frame(false, &[], Some((20.0, 20.0)), &[sub.clone(), main.clone()], 12.0, &cfg);
        let sub_near = near.iter().find(|frame| frame.id == sub.id).unwrap();
        let main_far = near.iter().find(|frame| frame.id == main.id).unwrap();
        assert_eq!(sub_near.opacity, 0.18);
        assert!(!sub_near.capture);
        assert_eq!(main_far.opacity, 1.0);
        let held = interaction_frame(true, &[], Some((20.0, 20.0)), &[sub.clone()], 12.0, &cfg);
        assert_eq!(held[0].opacity, 1.0);
        assert!(held[0].capture);
        assert!(suborb_hit(&sub.id));
        assert!(!suborb_hit(&main.id));
    }
}
