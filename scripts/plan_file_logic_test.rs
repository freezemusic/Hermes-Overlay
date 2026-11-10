//! Standalone logic test for plan-file extraction (box has no gtk/webkit2gtk dev).
//! Mirrors helpers and the turn-attachment rule in `hermes::normalize_messages`.
//! Canonical tests live in hermes.rs and run in CI.

const PLAN_FILE_MAX_BYTES: usize = 512 * 1024;

fn is_hermes_plan_path(path: &str) -> bool {
    let normalized = path.replace('\\', "/");
    let Some(at) = normalized.find(".hermes/plans/") else {
        return false;
    };
    let rest = &normalized[at + ".hermes/plans/".len()..];
    let file = rest
        .split(|ch: char| ch.is_whitespace() || ch == ')' || ch == '/')
        .next()
        .unwrap_or("");
    file.len() > 3 && file.ends_with(".md") && !file.contains("..")
}

fn clip_plan_content(text: &str) -> String {
    let bytes = text.as_bytes();
    if bytes.len() <= PLAN_FILE_MAX_BYTES {
        return text.to_string();
    }
    let mut end = PLAN_FILE_MAX_BYTES;
    while end > 0 && !text.is_char_boundary(end) {
        end -= 1;
    }
    let mut out = text[..end].to_string();
    out.push('…');
    out
}

fn arg(args: &[(&str, &str)], keys: &[&str]) -> String {
    for key in keys {
        if let Some((_, value)) = args.iter().find(|(name, _)| *name == *key) {
            if !value.is_empty() {
                return (*value).to_string();
            }
        }
    }
    String::new()
}

struct PlanFile {
    path: String,
    content: String,
}

fn plan_file_from_write_args(name: &str, args: &[(&str, &str)]) -> Option<PlanFile> {
    if name != "write_file" {
        return None;
    }
    let path = arg(args, &["path", "file_path"]);
    if !is_hermes_plan_path(&path) {
        return None;
    }
    let content = arg(args, &["content", "file_content"]);
    if content.is_empty() {
        return None;
    }
    Some(PlanFile {
        path,
        content: clip_plan_content(&content),
    })
}

#[test]
fn windows_plan_path_with_spaces_matches() {
    let path = r"C:\Users\freez\Desktop\MetaTrader Workbench\.hermes\plans\2026-11-11_013841-runtime-gate-status.md";
    assert!(is_hermes_plan_path(path));
    assert!(is_hermes_plan_path("/tmp/.hermes/plans/demo-plan.md"));
    assert!(!is_hermes_plan_path("/tmp/notes.txt"));
    assert!(!is_hermes_plan_path("/tmp/.hermes/plans/../secrets.md"));
}

#[test]
fn write_file_body_over_8000_chars_is_kept_and_attached_to_the_summary() {
    let body = "x".repeat(9000);
    let path = r"C:\Users\freez\Desktop\MetaTrader Workbench\.hermes\plans\2026-11-11_013841-runtime-gate-status.md";
    let summary = format!("詳細計劃已寫好，呢輪沒有再跑回測。\n{path}");
    let plan = plan_file_from_write_args("write_file", &[("path", path), ("content", &body)]).unwrap();
    // Attachment rule: last bot text of the turn receives the plan.
    struct Msg { role: &'static str, text: String, plan: Option<PlanFile> }
    let mut out = vec![
        Msg { role: "user", text: "/plan runtime gate".into(), plan: None },
        Msg { role: "bot", text: summary.clone(), plan: None },
    ];
    out[1].plan = Some(plan);
    assert_eq!(out[1].text, summary);
    let plan = out[1].plan.as_ref().unwrap();
    assert_eq!(plan.path, path);
    assert_eq!(plan.content, body);
    assert_eq!(plan.content.len(), 9000);
}

#[test]
fn aliases_work_and_the_512kb_cap_applies() {
    let path = "/home/work/.hermes/plans/demo-plan.md";
    let file = "# Demo\n\n**Goal:** keep the file body.";
    let plan = plan_file_from_write_args("write_file", &[("file_path", path), ("file_content", file)]).unwrap();
    assert_eq!(plan.path, path);
    assert!(plan.content.starts_with("# Demo"));

    let huge = "h".repeat(PLAN_FILE_MAX_BYTES + 50);
    let plan = plan_file_from_write_args("write_file", &[("path", path), ("content", &huge)]).unwrap();
    assert!(plan.content.ends_with('…'));
    assert!(plan.content.len() <= PLAN_FILE_MAX_BYTES + 3);

    assert!(plan_file_from_write_args(
        "write_file",
        &[("path", "/tmp/notes.txt"), ("content", "not a plan")]
    )
    .is_none());
}
