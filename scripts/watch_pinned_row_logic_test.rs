//! Standalone logic test for keeping the pinned Bot Chat watch row (box has no webkit2gtk).
//! Mirrors `hermes::keep_watched_row` and the `message_fetch` branch it protects.

fn keep_watched_row(id: &str, polled: &[String], pinned: &str) -> bool {
    polled.iter().any(|keep| keep == id) || (!pinned.trim().is_empty() && id == pinned.trim())
}

#[derive(Debug, PartialEq)]
enum Fetch { Skip, Tail(u64, u64) }

fn fetch(prev: Option<u64>, next: u64) -> Fetch {
    match prev { None => Fetch::Skip, Some(old) if next > old => Fetch::Tail(old, next), Some(_) => Fetch::Skip }
}

/// One watcher run over polls of (listed?, count). Returns the row ranges emitted.
fn run(polls: &[(bool, u64)], keep_pinned: bool) -> Vec<(u64, u64)> {
    let mut stamp: Option<u64> = None;
    let mut out = Vec::new();
    for &(listed, count) in polls {
        let ids: Vec<String> = if listed { vec!["sa".into()] } else { Vec::new() };
        if listed {
            match fetch(stamp, count) {
                Fetch::Tail(from, to) => out.push((from, to)),
                Fetch::Skip => {}
            }
            stamp = Some(count);
        }
        let kept = if keep_pinned { keep_watched_row("sa", &ids, "sa") } else { ids.iter().any(|id| id == "sa") };
        if !kept { stamp = None; }
    }
    out
}

#[test]
fn rule() {
    let polled = vec!["other".to_string()];
    assert!(keep_watched_row("pinned", &polled, "pinned"));
    assert!(keep_watched_row("pinned", &[], " pinned "));
    assert!(!keep_watched_row("stale", &polled, "pinned"));
    assert!(!keep_watched_row("stale", &polled, ""));
}

#[test]
fn a_missed_poll_no_longer_swallows_the_final_row() {
    // SA turn: count 10 after the last tool row, the title RPC fails once, the final row makes it 11.
    let polls = [(true, 3), (true, 10), (false, 10), (true, 11)];
    assert_eq!(run(&polls, false), vec![(3, 10)], "old rule: row 10..11 (final reply) never emitted");
    assert_eq!(run(&polls, true), vec![(3, 10), (10, 11)]);
}
