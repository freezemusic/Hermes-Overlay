//! Standalone logic tests for the Windows minimize off-screen fix.
//! Kept free of tauri/gtk so the box can run them without native UI deps.

const WIN_MINIMIZE_SENTINEL: i32 = -32000;

fn is_minimize_sentinel_pos(x: i32, y: i32) -> bool {
    x <= -31000 || y <= -31000
}

fn rect_off_virtual_desktop(
    left: i32,
    top: i32,
    right: i32,
    bottom: i32,
    desk_left: i32,
    desk_top: i32,
    desk_right: i32,
    desk_bottom: i32,
) -> bool {
    right <= desk_left || left >= desk_right || bottom <= desk_top || top >= desk_bottom
}

fn may_mutate_overlay_frame(is_minimized: bool) -> bool {
    !is_minimized
}

#[test]
fn minimize_sentinel_pos_matches_win32_parking_spot() {
    assert!(is_minimize_sentinel_pos(WIN_MINIMIZE_SENTINEL, WIN_MINIMIZE_SENTINEL));
    assert!(is_minimize_sentinel_pos(-32000, 0));
    assert!(is_minimize_sentinel_pos(0, -32000));
    assert!(is_minimize_sentinel_pos(-31000, 100));
    assert!(!is_minimize_sentinel_pos(-100, -100));
    assert!(!is_minimize_sentinel_pos(0, 0));
    assert!(!is_minimize_sentinel_pos(2560, 1600));
}

#[test]
fn rect_off_virtual_desktop_detects_no_overlap() {
    assert!(rect_off_virtual_desktop(
        -32000, -32000, -31840, -31972, 0, 0, 2560, 1600
    ));
    assert!(!rect_off_virtual_desktop(0, 0, 2560, 1600, 0, 0, 2560, 1600));
    assert!(!rect_off_virtual_desktop(100, 100, 500, 400, 0, 0, 2560, 1600));
    assert!(rect_off_virtual_desktop(3000, 0, 3500, 100, 0, 0, 2560, 1600));
}

#[test]
fn may_mutate_overlay_frame_blocks_while_minimized() {
    assert!(!may_mutate_overlay_frame(true));
    assert!(may_mutate_overlay_frame(false));
}
