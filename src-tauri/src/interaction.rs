//! Hit testing. Panels stay opaque and capture the cursor until the modifier is held.
//! Orbs stay faded and click-through until the modifier is held over that orb.

use crate::config::InteractionConfig;
use device_query::{DeviceQuery, DeviceState, Keycode};
use serde::Serialize;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicU8, Ordering};
#[cfg(windows)]
use std::sync::atomic::AtomicPtr;
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

pub fn copy_paste_chord(keys: &[Keycode], modifier: &str) -> bool {
    if modifier == "shift" || modifier == "alt" {
        return false;
    }
    keys.iter()
        .any(|key| matches!(key, Keycode::C | Keycode::V))
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
}

impl Default for ShapeGuard {
    fn default() -> Self {
        Self {
            latched: None,
            last_cursor: None,
            button_down: false,
            frozen: None,
            last_log: String::new(),
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
        // out of that shape.
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

/// Per-element frame.
/// Panels are opaque and captured until the modifier is held, then they wash out
/// and capture nothing. Orbs stay at `min_opacity` and click-through until the
/// modifier is held over that orb, which turns it solid and clickable.
/// A message-preview pill stays visually solid and captures only while the
/// modifier is held over it. A close button captures only while the modifier
/// is up; while it is held the button passes through with the panel. Toasts stay
/// visually solid. A missing cursor does not capture.
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
            let here = cursor.is_some() && under.as_deref() == Some(rect.id.as_str());
            let (opacity, capture) = if is_close_hit(rect) {
                (1.0, here && !held)
            } else if is_pill_hit(rect) {
                (1.0, here && held)
            } else if is_orb_hit(rect) {
                let awake = here && held;
                (if awake { 1.0 } else { cfg.min_opacity }, awake)
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
static SHAPE_GEN: AtomicU64 = AtomicU64::new(0);
static EMPTY_BLOCK_UNTIL: AtomicU64 = AtomicU64::new(0);
static LAST_HELD: AtomicBool = AtomicBool::new(false);
/// Physical modifier from `device_query`, not the webview keydown.
static KEY_DOWN: AtomicBool = AtomicBool::new(false);
static POINTER_DOWN: AtomicBool = AtomicBool::new(false);

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

fn screen_cursor() -> &'static Mutex<Option<(f64, f64)>> {
    static CURSOR: OnceLock<Mutex<Option<(f64, f64)>>> = OnceLock::new();
    CURSOR.get_or_init(|| Mutex::new(None))
}

/// Cover the monitor without mapping the window. The first `show` is
/// `reveal_overlay`, after the page has painted at this size. Focusing
/// here would map the creation frame. A later maximize is what leaves the
/// webview at 1280×800 for the first visible frames.
pub fn place_overlay(window: &tauri::WebviewWindow) {
    let _ = window.set_always_on_top(true);
    #[cfg(windows)]
    if cover_windows_monitor(window) {
        return;
    }
    #[cfg(target_os = "linux")]
    if cover_linux_monitor(window) {
        return;
    }
    let _ = window.maximize();
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
        // Do not pass the show flag. A hidden window keeps this rect, and reveal maps it.
        const SWP_NOACTIVATE: u32 = 0x0010;
        const SWP_FRAMECHANGED: u32 = 0x0020;
        SetWindowPos(
            hwnd,
            (-1isize) as *mut c_void,
            info.rc_monitor.left,
            info.rc_monitor.top,
            width,
            height,
            SWP_NOACTIVATE | SWP_FRAMECHANGED,
        ) != 0
    }
}

#[cfg(not(windows))]
fn cover_windows_monitor(_window: &tauri::WebviewWindow) -> bool {
    false
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
            KEY_DOWN.store(key_down, Ordering::Relaxed);
            LAST_HELD.store(held, Ordering::Relaxed);
            let pointer_down = pointer_is_down(&device);
            POINTER_DOWN.store(pointer_down, Ordering::Relaxed);
            remember_screen_cursor(&window, &device);
            if SHAPE_DIRTY.swap(false, Ordering::Relaxed) {
                region_signature.clear();
            }
            let rects = hub
                .rects
                .lock()
                .unwrap_or_else(|err| err.into_inner())
                .clone();
            let cursor = cursor_in_view(&window, &device);
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
                    if window.set_ignore_cursor_events(true).is_ok() {
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
            let signature = format!(
                "{}|focus={focus_owner}|held={}|key={}",
                items
                    .iter()
                    .map(|item| format!("{}={:.2}:{}", item.id, item.opacity, item.capture))
                    .collect::<Vec<_>>()
                    .join("|"),
                u8::from(held),
                u8::from(key_down),
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
                    "held": held,
                    "modifier_down": key_down,
                    "opacities": items,
                }),
            );
        }
    });
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
) -> Vec<HitRect> {
    #[cfg(any(windows, target_os = "linux"))]
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
        if signature == *region_signature {
            return region;
        }
        *region_signature = signature;
        #[cfg(windows)]
        {
            remember_hit_region(&region, origin_x, origin_y, scale);
            let empty = region.is_empty();
            if *ignoring != Some(empty) {
                queue_windows_hit_style(app, empty);
                *ignoring = Some(empty);
            }
        }
        #[cfg(target_os = "linux")]
        {
            apply_linux_input_shape(app, &region, scale);
            *ignoring = Some(region.is_empty());
        }
        let _ = window;
        return region;
    }
    #[cfg(not(any(windows, target_os = "linux")))]
    {
        let _ = (
            app,
            held,
            key_down,
            pointer_down,
            cursor,
            rects,
            previous_rects,
            last_painted,
            region_signature,
        );
        let ignore = !frames.iter().any(|item| item.capture);
        if *ignoring != Some(ignore) && window.set_ignore_cursor_events(ignore).is_ok() {
            *ignoring = Some(ignore);
        }
        Vec::new()
    }
}

#[cfg(windows)]
struct HitRegionCache {
    rects: Vec<HitRect>,
    origin_x: f64,
    origin_y: f64,
    scale: f64,
}

#[cfg(windows)]
fn hit_region_cache() -> &'static Mutex<HitRegionCache> {
    static CACHE: OnceLock<Mutex<HitRegionCache>> = OnceLock::new();
    CACHE.get_or_init(|| {
        Mutex::new(HitRegionCache {
            rects: Vec::new(),
            origin_x: 0.0,
            origin_y: 0.0,
            scale: 1.0,
        })
    })
}

#[cfg(windows)]
fn remember_hit_region(rects: &[HitRect], origin_x: f64, origin_y: f64, scale: f64) {
    let mut cache = hit_region_cache()
        .lock()
        .unwrap_or_else(|err| err.into_inner());
    cache.rects = rects.to_vec();
    cache.origin_x = origin_x;
    cache.origin_y = origin_y;
    cache.scale = if scale > 0.0 { scale } else { 1.0 };
    crate::trace_debug(
        "hit-ipc",
        &format!("cmd=input-shape n={} platform=windows", cache.rects.len()),
    );
}

#[cfg(windows)]
fn queue_windows_hit_style(app: &AppHandle, transparent: bool) {
    let app = app.clone();
    let handle = app.clone();
    let _ = handle.run_on_main_thread(move || {
        let Some(window) = app.get_webview_window("main") else {
            return;
        };
        let Some(hwnd) = window_hwnd(&window) else {
            return;
        };
        install_hit_proc(hwnd);
        set_window_transparent(hwnd, transparent);
    });
}

#[cfg(windows)]
fn window_hwnd(window: &tauri::WebviewWindow) -> Option<*mut std::ffi::c_void> {
    use raw_window_handle::{HasWindowHandle, RawWindowHandle};
    let handle = window.window_handle().ok()?;
    let RawWindowHandle::Win32(win) = handle.as_raw() else {
        return None;
    };
    let hwnd = win.hwnd.get() as *mut std::ffi::c_void;
    if hwnd.is_null() {
        None
    } else {
        Some(hwnd)
    }
}

#[cfg(windows)]
fn install_hit_proc(hwnd: *mut std::ffi::c_void) {
    static INSTALLED: AtomicBool = AtomicBool::new(false);
    if INSTALLED.load(Ordering::Relaxed) {
        return;
    }
    const GWLP_WNDPROC: i32 = -4;
    #[link(name = "user32")]
    extern "system" {
        fn SetWindowLongPtrW(hwnd: *mut std::ffi::c_void, index: i32, new_proc: isize) -> isize;
    }
    let previous = unsafe {
        SetWindowLongPtrW(
            hwnd,
            GWLP_WNDPROC,
            hit_window_proc as *const std::ffi::c_void as isize,
        )
    };
    if previous == 0 {
        return;
    }
    HIT_PROC_PREVIOUS.store(previous as *mut std::ffi::c_void, Ordering::Relaxed);
    INSTALLED.store(true, Ordering::Relaxed);
}

#[cfg(windows)]
fn set_window_transparent(hwnd: *mut std::ffi::c_void, transparent: bool) {
    const GWL_EXSTYLE: i32 = -20;
    const WS_EX_TRANSPARENT: i32 = 0x0000_0020;
    #[link(name = "user32")]
    extern "system" {
        fn GetWindowLongW(hwnd: *mut std::ffi::c_void, index: i32) -> i32;
        fn SetWindowLongW(hwnd: *mut std::ffi::c_void, index: i32, value: i32) -> i32;
    }
    unsafe {
        let style = GetWindowLongW(hwnd, GWL_EXSTYLE);
        let next = if transparent {
            style | WS_EX_TRANSPARENT
        } else {
            style & !WS_EX_TRANSPARENT
        };
        if next != style {
            SetWindowLongW(hwnd, GWL_EXSTYLE, next);
        }
    }
}

#[cfg(windows)]
unsafe extern "system" fn hit_window_proc(
    hwnd: *mut std::ffi::c_void,
    msg: u32,
    wparam: usize,
    lparam: isize,
) -> isize {
    const WM_NCHITTEST: u32 = 0x0084;
    const HTTRANSPARENT: isize = -1;
    if msg == WM_NCHITTEST {
        let cache = hit_region_cache()
            .lock()
            .unwrap_or_else(|err| err.into_inner());
        let x = (lparam as u16) as i16 as f64;
        let y = ((lparam >> 16) as u16) as i16 as f64;
        let scale = if cache.scale > 0.0 { cache.scale } else { 1.0 };
        let css_x = (x - cache.origin_x) / scale;
        let css_y = (y - cache.origin_y) / scale;
        let hit = css_point_hits(&cache.rects, css_x, css_y);
        drop(cache);
        if !hit {
            return HTTRANSPARENT;
        }
    }
    #[link(name = "user32")]
    extern "system" {
        fn CallWindowProcW(
            prev: *mut std::ffi::c_void,
            hwnd: *mut std::ffi::c_void,
            msg: u32,
            wparam: usize,
            lparam: isize,
        ) -> isize;
    }
    let previous = HIT_PROC_PREVIOUS.load(Ordering::Relaxed);
    if previous.is_null() {
        return 0;
    }
    unsafe { CallWindowProcW(previous, hwnd, msg, wparam, lparam) }
}

#[cfg(windows)]
static HIT_PROC_PREVIOUS: AtomicPtr<std::ffi::c_void> = AtomicPtr::new(std::ptr::null_mut());

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

fn remember_screen_cursor(window: &tauri::WebviewWindow, device: &DeviceState) {
    let Some(point) = screen_point(window, device) else {
        return;
    };
    *screen_cursor()
        .lock()
        .unwrap_or_else(|err| err.into_inner()) = Some(point);
}

fn screen_point(window: &tauri::WebviewWindow, device: &DeviceState) -> Option<(f64, f64)> {
    #[cfg(target_os = "linux")]
    {
        let _ = window;
        let mouse = device.get_mouse();
        Some((f64::from(mouse.coords.0), f64::from(mouse.coords.1)))
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = device;
        let cursor = window.cursor_position().ok()?;
        Some((cursor.x, cursor.y))
    }
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
    #[cfg(windows)]
    {
        let origin = window.inner_position().ok();
        let (origin_x, origin_y) = origin
            .map(|point| (f64::from(point.x), f64::from(point.y)))
            .unwrap_or((0.0, 0.0));
        remember_hit_region(&region, origin_x, origin_y, scale);
        queue_windows_hit_style(app, false);
    }
    #[cfg(not(any(windows, target_os = "linux")))]
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

fn cursor_in_view(window: &tauri::WebviewWindow, device: &DeviceState) -> Option<(f64, f64)> {
    let origin = window.inner_position().ok()?;
    let scale = window.scale_factor().ok()?;
    if scale <= 0.0 {
        return None;
    }
    // GTK's seat position stays on the last grabbed point after a pointer-capture
    // drag, so a rejected kanban drop leaves the board faded until the next
    // modifier hover. XQueryPointer on our own display follows the pointer.
    #[cfg(target_os = "linux")]
    let (x, y) = {
        let mouse = device.get_mouse();
        (f64::from(mouse.coords.0), f64::from(mouse.coords.1))
    };
    #[cfg(not(target_os = "linux"))]
    let (x, y) = {
        let _ = device;
        let cursor = window.cursor_position().ok()?;
        (cursor.x, cursor.y)
    };
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
        assert!((frame_of(&held, "a").opacity - 0.18).abs() < 0.001);
        assert!((frame_of(&held, "center").opacity - 0.18).abs() < 0.001);
        assert!((frame_of(&idle, "a").opacity - 0.18).abs() < 0.001);
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
        assert!((frame_of(&over_a, "b").opacity - 0.18).abs() < 0.001);
        assert!(!frame_of(&over_a, "b").capture);
        assert_eq!(frame_of(&over_a, "center").opacity, 1.0);
        assert!(!frame_of(&over_a, "center").capture);
        assert_eq!(over_a.iter().filter(|item| item.capture).count(), 0);

        let held = interaction_frame(true, &[], Some((20.0, 20.0)), &rects, HIT_MARGIN_PX, &cfg);
        assert!(frame_of(&held, "a").capture);
        assert_eq!(frame_of(&held, "a").opacity, 1.0);
        assert!(!frame_of(&held, "b").capture);
        assert!((frame_of(&held, "b").opacity - 0.18).abs() < 0.001);
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
        assert!((frame_of(&held, "bot:kanban").opacity - 0.18).abs() < 0.001);
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
            !frames
                .iter()
                .any(|frame| frame.id == "bot:a" && frame.capture),
            "a covering panel wins the hit test, so capture stays off the orb"
        );
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
