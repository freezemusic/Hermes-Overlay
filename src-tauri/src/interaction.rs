//! Rainmeter-style hit testing: click-through by default, proximity fade, and a
//! held modifier that solids only the element under the cursor.

use crate::config::InteractionConfig;
use device_query::{DeviceQuery, DeviceState, Keycode};
use serde::Serialize;
use std::sync::{Arc, Mutex};
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
            let signature = items
                .iter()
                .map(|item| format!("{}={:.2}:{}", item.id, item.opacity, item.capture))
                .collect::<Vec<_>>()
                .join("|");
            if signature == last_signature {
                continue;
            }
            last_signature = signature;
            let _ = app.emit(
                "overlay-interaction",
                serde_json::json!({
                    "type": "proximity",
                    "supported": true,
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
}
