//! Standalone logic tests for R-PN-09 resize handles on Windows
//! (Devon 2026-11-10: no double-arrow cursor on the panel edge).
//! Kept free of tauri/gtk so the box can run them without native UI deps:
//!   rustc --edition 2021 --test scripts/resize_handle_hit_logic_test.rs -o /tmp/rh && /tmp/rh
//! The functions below are copied from src-tauri/src/interaction.rs
//! (distance_to_rect, css_point_from_screen, the panel branch of
//! interaction_frame and windows_cursor_ignored). The in-crate test
//! `resize_strip_inside_panel_captures_at_125_percent` runs the real ones in CI.

#[derive(Clone)]
struct HitRect {
    x: f64,
    y: f64,
    w: f64,
    h: f64,
}

const HIT_MARGIN_PX: f64 = 12.0;

fn distance_to_rect(px: f64, py: f64, rect: &HitRect) -> f64 {
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

fn css_point_from_screen(x: f64, y: f64, origin_x: f64, origin_y: f64, scale: f64) -> (f64, f64) {
    ((x - origin_x) / scale, (y - origin_y) / scale)
}

/// interaction_frame, panel branch: the panel is "under" within the 12px
/// margin, and captures while the modifier is up.
fn panel_capture(held: bool, cursor: (f64, f64), rect: &HitRect) -> bool {
    distance_to_rect(cursor.0, cursor.1, rect) <= HIT_MARGIN_PX && !held
}

/// windows_cursor_ignored for one panel: pad 0 for panels.
fn windows_cursor_ignored(cursor: (f64, f64), capture: bool, rect: &HitRect) -> bool {
    !(capture && distance_to_rect(cursor.0, cursor.1, rect) <= 0.0)
}

/// Every physical pixel of `strip` (CSS px), as the poll sees it.
fn sample(strip: (f64, f64, f64, f64), scale: f64, origin: (f64, f64)) -> Vec<(f64, f64)> {
    let (x0, y0, x1, y1) = strip;
    let mut out = Vec::new();
    let px0 = (x0 * scale + origin.0).floor() as i32;
    let px1 = (x1 * scale + origin.0).ceil() as i32;
    let py0 = (y0 * scale + origin.1).floor() as i32;
    let py1 = (y1 * scale + origin.1).ceil() as i32;
    for py in py0..py1 {
        for px in px0..px1 {
            let (cx, cy) = css_point_from_screen(f64::from(px), f64::from(py), origin.0, origin.1, scale);
            if cx >= x0 && cx < x1 && cy >= y0 && cy < y1 {
                out.push((cx, cy));
            }
        }
    }
    out
}

fn panel() -> HitRect {
    HitRect { x: 503.09375, y: 42.6, w: 420.0, h: 560.0 }
}

#[test]
fn every_physical_pixel_of_the_inside_strips_captures_at_common_scales() {
    for scale in [1.0, 1.25, 1.5, 1.75, 2.0] {
        for origin in [(0.0, 0.0), (-8.0, -8.0), (2560.0, 0.0)] {
            let rect = panel();
            let right = rect.x + rect.w;
            let bottom = rect.y + rect.h;
            let strips = [
                (right - 10.0, rect.y + 48.0, right, bottom), // free right edge
                (rect.x, rect.y + 48.0, rect.x + 10.0, bottom), // free left edge (end anchor)
                (rect.x, bottom - 10.0, right, bottom),       // free bottom edge
                (rect.x, rect.y, right, rect.y + 10.0),       // free top edge (bottom header)
                (right - 12.0, bottom - 12.0, right, bottom), // corner
            ];
            for strip in strips {
                let points = sample(strip, scale, origin);
                assert!(!points.is_empty());
                for point in points {
                    let capture = panel_capture(false, point, &rect);
                    assert!(!windows_cursor_ignored(point, capture, &rect), "scale {scale} {point:?}");
                    let held = panel_capture(true, point, &rect);
                    assert!(windows_cursor_ignored(point, held, &rect), "Ctrl passes through at {point:?}");
                }
            }
        }
    }
}

#[test]
fn a_strip_that_pokes_past_the_edge_loses_pixels_to_click_through() {
    // A handle straddling the box edge (right: -4px) is what would leave
    // the window click-through under the cursor: pad 0 for panels.
    let rect = panel();
    let right = rect.x + rect.w;
    let points = sample((right - 6.0, 200.0, right + 4.0, 260.0), 1.25, (0.0, 0.0));
    let lost = points
        .iter()
        .filter(|point| windows_cursor_ignored(**point, panel_capture(false, **point, &rect), &rect))
        .count();
    assert!(lost > 0);
}

#[test]
fn landing_depth_in_physical_pixels() {
    // Physical columns across the strip at 125%: 6px gave 8, 10px gives 13.
    let cols = |w: f64| sample((0.0, 0.0, w, 0.5), 1.25, (0.0, 0.0)).len();
    assert_eq!(cols(6.0), 8);
    assert!(cols(10.0) >= 12);
}

#[test]
fn just_outside_the_panel_is_click_through() {
    let rect = panel();
    let right = rect.x + rect.w;
    for scale in [1.0, 1.25, 1.5] {
        let px = (right * scale).ceil() + 1.0;
        let point = css_point_from_screen(px, 400.0 * scale, 0.0, 0.0, scale);
        let capture = panel_capture(false, point, &rect);
        assert!(windows_cursor_ignored(point, capture, &rect));
    }
}
