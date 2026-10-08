//! Rainmeter-style hit testing: click-through by default, proximity fade, and a
//! held modifier that makes every overlay element solid. Clicks are accepted
//! only inside a hit rect (plus a small margin).

use crate::config::InteractionConfig;
use device_query::{DeviceQuery, DeviceState, Keycode};
use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
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
}

pub struct InteractionHub {
    pub rects: Mutex<Vec<HitRect>>,
    pub latched: AtomicBool,
    pub config: Mutex<InteractionConfig>,
    pub supported: bool,
}

impl InteractionHub {
    pub fn new() -> Self {
        Self {
            rects: Mutex::new(Vec::new()),
            latched: AtomicBool::new(false),
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

/// Extra CSS pixels around a hit rect that still accept a click.
pub const HIT_MARGIN_PX: f64 = 12.0;

pub fn cursor_hits_any(px: f64, py: f64, rects: &[HitRect], margin: f64) -> bool {
    rects
        .iter()
        .any(|rect| distance_to_rect(px, py, rect) <= margin)
}

/// Solid or latched overlays only capture the pointer inside a padded hit rect.
/// A missing cursor stays click-through so a failed query cannot swallow the screen.
pub fn should_capture(
    interactive: bool,
    cursor: Option<(f64, f64)>,
    rects: &[HitRect],
    margin: f64,
) -> bool {
    let Some((x, y)) = cursor else {
        return false;
    };
    interactive && cursor_hits_any(x, y, rects, margin)
}

/// Modifier held (or the input/settings latch) forces every element to full opacity.
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
            let latched = hub.latched.load(Ordering::Relaxed);
            let held = modifier_held(&device.get_keys(), &cfg.modifier);
            let solid = held || latched;
            let rects = hub
                .rects
                .lock()
                .unwrap_or_else(|err| err.into_inner())
                .clone();
            let cursor = cursor_in_view(&window);
            let ignore = !should_capture(solid, cursor, &rects, HIT_MARGIN_PX);
            if ignoring != Some(ignore) {
                if window.set_ignore_cursor_events(ignore).is_ok() {
                    ignoring = Some(ignore);
                }
            }
            let mut items = Vec::with_capacity(rects.len());
            for rect in &rects {
                let opacity = if solid {
                    1.0
                } else if let Some((x, y)) = cursor {
                    let distance = distance_to_rect(x, y, rect);
                    element_opacity(false, distance, &cfg)
                } else {
                    1.0
                };
                items.push(OpacityItem {
                    id: rect.id.clone(),
                    opacity: (opacity * 100.0).round() / 100.0,
                });
            }
            let signature = format!(
                "{solid}:{}",
                items
                    .iter()
                    .map(|item| format!("{}={:.2}", item.id, item.opacity))
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
                    "solid": solid,
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

    #[test]
    fn held_modifier_is_solid_regardless_of_distance() {
        let cfg = InteractionConfig {
            modifier: "ctrl".into(),
            fade_enabled: true,
            fade_distance: 120.0,
            min_opacity: 0.18,
        };
        assert_eq!(element_opacity(true, 0.0, &cfg), 1.0);
        assert_eq!(element_opacity(true, 10_000.0, &cfg), 1.0);
        assert!((element_opacity(false, 0.0, &cfg) - 0.18).abs() < 0.001);
        assert_eq!(element_opacity(false, 120.0, &cfg), 1.0);
        assert_eq!(element_opacity(false, 400.0, &cfg), 1.0);
        let mid = element_opacity(false, 60.0, &cfg);
        assert!(mid > 0.18 && mid < 1.0);
    }

    #[test]
    fn capture_only_inside_padded_hit_rects() {
        let rects = [rect()];
        let inside = Some((110.0, 110.0));
        let padded = Some((152.0, 110.0));
        let outside = Some((170.0, 110.0));
        let far = Some((0.0, 0.0));
        assert!(should_capture(true, inside, &rects, HIT_MARGIN_PX));
        assert!(should_capture(true, padded, &rects, HIT_MARGIN_PX));
        assert!(!should_capture(true, outside, &rects, HIT_MARGIN_PX));
        assert!(!should_capture(true, far, &rects, HIT_MARGIN_PX));
        assert!(!should_capture(false, inside, &rects, HIT_MARGIN_PX));
        assert!(!should_capture(true, None, &rects, HIT_MARGIN_PX));
    }
}
