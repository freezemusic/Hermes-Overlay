//! HTTP client for a self-hosted Hermes Agent API server.
//!
//! Field names follow the public API-server docs, `gateway/platforms/api_server.py`,
//! and a live Hermes v0.21.6 gateway (`assistant.delta` uses `delta`, tool events use
//! `tool_name` / `preview`, chat accepts `message` or `input`, failed turns use
//! `display_kind: failed_turn` rather than `run.failed.error`).

use crate::config::BOT_CHAT_TITLE;
use crate::sse::{self, SseEvent};
use futures_util::StreamExt;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

#[derive(Debug)]
pub enum HermesError {
    Http { status: u16, body: String },
    Connect(String),
    Timeout(String),
    Transport(String),
    Protocol(String),
    Cancelled,
}

impl std::fmt::Display for HermesError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Http { status, body } => write!(f, "HTTP {status} {body}"),
            Self::Connect(msg) => write!(f, "{msg}"),
            Self::Timeout(msg) => write!(f, "{msg}"),
            Self::Transport(msg) => write!(f, "{msg}"),
            Self::Protocol(msg) => write!(f, "{msg}"),
            Self::Cancelled => write!(f, "cancelled"),
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct SessionSummary {
    pub id: String,
    pub title: String,
    pub hidden: Option<bool>,
    pub last_active: f64,
    pub preview: String,
    /// Hermes session source (`api_server`, `desktop`, `tui`, …).
    pub source: String,
    /// Session row `started_at`. `0.0` means the list did not include one.
    pub started_at: f64,
    /// `message_count` when the list included it.
    pub message_count: Option<u64>,
    /// The list named this row as the delivery lease, home channel, or canonical Bot Chat.
    pub delivery: bool,
    /// Compression parent. Empty when this row is not a continuation.
    pub parent_session_id: String,
    /// Archived rows stay out of the titled Bot Chat pick.
    pub archived: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct UiMessage {
    pub role: String,
    pub text: String,
    pub tool_name: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DiscoveredProfile {
    pub profile: String,
    pub display_name: String,
    pub detail: String,
    /// Raw Hermes color from `color`, `bot_color`, or `ui_meta.hermes-bots.color`.
    pub color: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct OverlayCommand {
    pub name: String,
    pub kind: String,
    pub category: String,
    pub description: String,
    pub args_hint: String,
    pub aliases: Vec<String>,
    pub enabled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub maps_to: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CatalogFetch {
    Fresh {
        etag: String,
        commands: Vec<OverlayCommand>,
    },
    NotModified,
    Missing,
}

pub const PLUGIN_HINT: &str = "未裝 overlay-slash，/ 選單唔會出現。";

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TurnEvent {
    Started { run_id: String },
    Delta(String),
    Commentary(String),
    Command(String),
    Tool {
        phase: String,
        name: String,
        preview: String,
    },
    ApprovalRequest {
        run_id: String,
        request_id: String,
        description: String,
        command: String,
        execution_generation: Option<i64>,
    },
    ApprovalResponded {
        request_id: String,
        choice: String,
    },
    ClarifyRequest {
        run_id: String,
        prompt_id: String,
        question: String,
        choices: Vec<String>,
        multi_select: bool,
        execution_generation: i64,
        timeout_s: Option<u64>,
    },
    /// `approval.settled` or `clarify.settled`. The card closes; the answer is not in this event.
    ControlSettled {
        kind: String,
        prompt_id: String,
    },
    Finished {
        outcome: String,
        detail: String,
        run_id: String,
    },
}

/// Stop posts the latest started run first. A stale hint is only a fallback
/// after that id answers 409 `run_not_active`.
pub fn stop_target_ids(hinted: &str, remembered: &str) -> Vec<String> {
    let mut ids = Vec::new();
    let remember = approval_run_id(remembered).unwrap_or("");
    let hint = approval_run_id(hinted).unwrap_or("");
    if !remember.is_empty() {
        ids.push(remember.to_string());
    }
    if !hint.is_empty() && hint != remember {
        ids.push(hint.to_string());
    }
    ids
}

pub fn route_root(gateway: &str, profile: &str, bot_base: &str) -> String {
    let dedicated = bot_base.trim().trim_end_matches('/');
    if !dedicated.is_empty() {
        return dedicated.to_string();
    }
    let gateway = gateway.trim_end_matches('/');
    if profile == "default" {
        gateway.to_string()
    } else {
        format!("{gateway}/p/{profile}")
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct ResolvedSession {
    pub id: String,
    pub explicit: bool,
    pub anchor: f64,
    pub source: String,
    pub read_only: bool,
    pub read_only_reason: String,
}

pub fn is_bot_chat_title(title: &str) -> bool {
    title.trim() == BOT_CHAT_TITLE
}

/// Higher `last_active` wins. Equal timestamps keep the smaller id.
fn session_rank(a: &SessionSummary, b: &SessionSummary) -> std::cmp::Ordering {
    match a.last_active.partial_cmp(&b.last_active) {
        Some(std::cmp::Ordering::Greater) => std::cmp::Ordering::Greater,
        Some(std::cmp::Ordering::Less) => std::cmp::Ordering::Less,
        _ => b.id.cmp(&a.id),
    }
}

/// Highest `last_active`. Equal timestamps keep the smaller id.
pub fn most_recent_session(sessions: &[SessionSummary]) -> Option<&SessionSummary> {
    sessions.iter().max_by(|a, b| session_rank(a, b))
}

/// Overlay and Hermes Desktop chats. Kept for the picker ranking tests.
pub fn is_overlay_chat_source(source: &str) -> bool {
    matches!(source.trim(), "api_server" | "desktop")
}

pub fn is_overlay_bot_chat(session: &SessionSummary) -> bool {
    is_bot_chat_title(&session.title) && is_overlay_chat_source(&session.source)
}

/// Narrow `tui` check. The write gate is `session_accepts_send`.
pub fn is_tui_source(source: &str) -> bool {
    source.trim().eq_ignore_ascii_case("tui")
}

/// Gateway 0.22.5 `session_api_turn` allows a send only for these sources.
pub fn session_accepts_send(source: &str) -> bool {
    matches!(
        source.trim().to_ascii_lowercase().as_str(),
        "api_server" | "bot_room"
    )
}

pub fn session_read_only(source: &str) -> bool {
    !session_accepts_send(source)
}

pub fn session_read_only_reason() -> &'static str {
    "呢個 session 係喺 CLI／Desktop 開嘅，只可以睇，唔可以喺呢度傳嘢"
}

pub const OVERLAY_CONTINUE_TITLE: &str = "Overlay";

/// Another session of this profile that accepts a chat. A live Bot Chat wins.
/// `avoid_id` is the row on screen, which is read-only or was just refused.
pub fn writable_continuation<'a>(
    sessions: &'a [SessionSummary],
    avoid_id: &str,
    refused: &[&str],
) -> Option<&'a SessionSummary> {
    let avoid = avoid_id.trim();
    let writable: Vec<&SessionSummary> = sessions
        .iter()
        .filter(|session| {
            session.id != avoid
                && !refused.iter().any(|id| session.id == id.trim())
                && session_accepts_send(&session.source)
        })
        .collect();
    let live: Vec<&SessionSummary> = writable
        .iter()
        .copied()
        .filter(|session| !session.archived)
        .collect();
    let pool: Vec<&SessionSummary> = if live.is_empty() { writable } else { live };
    let chats: Vec<&SessionSummary> = pool
        .iter()
        .copied()
        .filter(|session| is_bot_chat_title(&session.title))
        .collect();
    let pick_from: &[ &SessionSummary] = if chats.is_empty() { &pool } else { &chats };
    pick_from.iter().copied().max_by(|a, b| session_rank(a, b))
}

pub fn text_is_permission_denied(text: &str) -> bool {
    let lower = text.to_ascii_lowercase();
    lower.contains("permission_denied")
        || lower.contains("permission denied")
        || lower.contains("permission-denied")
}

pub fn turn_is_permission_denied(result: &Result<(), HermesError>) -> bool {
    match result {
        Err(HermesError::Http { body, .. }) => text_is_permission_denied(body),
        Err(HermesError::Protocol(msg)) => text_is_permission_denied(msg),
        _ => false,
    }
}

pub fn execute_code_blocked_line() -> &'static str {
    "呢個 bot 想行 Python（execute_code），經 Overlay 唔允許，叫佢改用 terminal 指令"
}

pub fn text_is_execute_code_blocked(text: &str) -> bool {
    let lower = text.to_ascii_lowercase();
    lower.contains("execute_code") && lower.contains("blocked")
}

/// Hand approval only. `session` and `always` are not posted.
pub fn allowed_approval_choice(choice: &str) -> Option<&'static str> {
    match choice.trim() {
        "once" => Some("once"),
        "deny" => Some("deny"),
        _ => None,
    }
}

pub fn approval_run_id(run_id: &str) -> Option<&str> {
    let id = run_id.trim();
    if id.len() < 5 || !id.starts_with("run_") {
        return None;
    }
    if !id
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_')
    {
        return None;
    }
    Some(id)
}

pub fn approval_request_id(request_id: &str) -> Option<&str> {
    let id = request_id.trim();
    if id.is_empty()
        || id.len() > 200
        || id.contains('/')
        || id.contains('\\')
        || id.contains("..")
        || id.chars().any(|ch| ch.is_control() || ch.is_whitespace())
    {
        return None;
    }
    Some(id)
}

fn finish_resolved(session: &SessionSummary, explicit: bool, anchor: f64) -> ResolvedSession {
    let read_only = session_read_only(&session.source);
    ResolvedSession {
        id: session.id.clone(),
        explicit,
        anchor,
        source: session.source.clone(),
        read_only,
        read_only_reason: if read_only {
            session_read_only_reason().to_string()
        } else {
            String::new()
        },
    }
}

/// Most recently active `Bot Chat` whose source is `api_server` or `desktop`.
/// Not the main-orb choice: that is `canonical_bot_chat`.
pub fn most_recent_bot_chat(sessions: &[SessionSummary]) -> Option<&SessionSummary> {
    sessions
        .iter()
        .filter(|session| is_overlay_bot_chat(session))
        .max_by(|a, b| session_rank(a, b))
}

fn is_hidden_chat(session: &SessionSummary) -> bool {
    session.hidden == Some(true)
}

/// A retired Bot Chat: the title was cleared, and the row stayed archived and hidden.
fn retired_bot_chat(session: &SessionSummary) -> bool {
    session.title.trim().is_empty() && session.archived && is_hidden_chat(session)
}

/// The profile's `Bot Chat` row. Hidden wins when one is hidden. Archived
/// titled rows lose to a live one. Message count and source do not matter.
fn desktop_bot_chat_root(sessions: &[SessionSummary]) -> Option<&SessionSummary> {
    let titled: Vec<&SessionSummary> = sessions
        .iter()
        .filter(|session| is_bot_chat_title(&session.title))
        .collect();
    if titled.is_empty() {
        return None;
    }
    let hidden: Vec<&SessionSummary> = titled
        .iter()
        .copied()
        .filter(|session| is_hidden_chat(session))
        .collect();
    let pool = if hidden.is_empty() { titled } else { hidden };
    let live: Vec<&SessionSummary> = pool
        .iter()
        .copied()
        .filter(|session| !session.archived)
        .collect();
    let pool = if live.is_empty() { pool } else { live };
    pool.into_iter().min_by(|a, b| a.id.cmp(&b.id))
}

/// The Bot Chat Hermes Desktop opens.
///
/// Identity is the exact title `Bot Chat` (usually `hidden=1`; the title
/// index allows one). The gateway title lookup already returns the latest
/// continuation child, and the blanket session list omits children, so this
/// does not walk `parent_session_id`. Source and message count do not matter.
/// An empty row is valid.
pub fn canonical_bot_chat(sessions: &[SessionSummary]) -> Option<&SessionSummary> {
    desktop_bot_chat_root(sessions)
}

/// Latest session that is not a Bot Chat from another surface.
pub fn fallback_session(sessions: &[SessionSummary]) -> Option<&SessionSummary> {
    sessions
        .iter()
        .filter(|session| !is_bot_chat_title(&session.title) || is_overlay_bot_chat(session))
        .max_by(|a, b| session_rank(a, b))
}

/// Bot Chat rows first, then other sessions. Each group is most-recent first.
pub fn session_menu_order(sessions: &[SessionSummary]) -> Vec<&SessionSummary> {
    let mut rows: Vec<&SessionSummary> = sessions.iter().collect();
    rows.sort_by(|a, b| {
        is_bot_chat_title(&b.title)
            .cmp(&is_bot_chat_title(&a.title))
            .then_with(|| session_rank(b, a))
    });
    rows
}

/// Same choice as startup. An explicit id that still exists stays.
/// Otherwise Desktop's Bot Chat wins. No Bot Chat does not fall through
/// to the latest other session.
pub fn resolve_session(
    sessions: &[SessionSummary],
    remembered: &str,
    explicit: bool,
    anchor: f64,
) -> Option<ResolvedSession> {
    session_for_startup(sessions, remembered, explicit, anchor)
}

/// `0.0` is not a timestamp. A newer `last_active` must not replace the
/// saved watermark: v92 rewrote `session_anchor` on every panel open.
/// The file keeps the previous number. `now` and `next_anchor` are ignored.
pub fn merge_session_anchor(
    _previous_id: &str,
    previous_anchor: f64,
    next_id: &str,
    _next_anchor: f64,
    _now: f64,
) -> f64 {
    if next_id.trim().is_empty() {
        return 0.0;
    }
    if previous_anchor.is_finite() && previous_anchor > 0.0 {
        return previous_anchor;
    }
    0.0
}

/// Automatic open, reconnect, and panel close must not rewrite config.
/// `None` means the file stays byte-for-byte. A hand pick that changes the
/// id or the explicit flag may write, and the anchor number stays.
pub fn session_file_update(
    previous_id: &str,
    previous_explicit: bool,
    previous_anchor: f64,
    next_id: &str,
    next_explicit: bool,
    next_anchor: f64,
) -> Option<(String, bool, f64)> {
    let id = next_id.trim();
    let explicit = next_explicit && !id.is_empty();
    let anchor = merge_session_anchor(
        previous_id,
        previous_anchor,
        id,
        next_anchor,
        0.0,
    );
    if previous_id == id && previous_explicit == explicit && previous_anchor == anchor {
        return None;
    }
    Some((id.to_string(), explicit, anchor))
}

/// Startup, panel open, and gateway reconnect. No I/O.
///
/// 1. An explicit id that is still in the list wins, and keeps its anchor.
/// 2. Otherwise Desktop's Bot Chat wins, even when config holds a different
///    non-explicit id. The caller must not write that id back
///    (`stored_pin_after_resolve`).
/// 3. With no Bot Chat, a stored row that is not a retired untitled archived
///    chat stays. Never take the latest other session, and never create one.
pub fn session_for_startup(
    sessions: &[SessionSummary],
    remembered: &str,
    explicit: bool,
    anchor: f64,
) -> Option<ResolvedSession> {
    let remembered = remembered.trim();
    let anchor = if anchor.is_finite() { anchor } else { 0.0 };
    let saved = sessions.iter().find(|session| session.id == remembered);
    if explicit {
        if let Some(saved) = saved {
            return Some(finish_resolved(saved, true, anchor));
        }
    }
    if let Some(chat) = canonical_bot_chat(sessions) {
        let used = if chat.id == remembered { anchor } else { chat.last_active };
        return Some(finish_resolved(chat, false, used));
    }
    if let Some(saved) = saved {
        if !retired_bot_chat(saved) {
            return Some(finish_resolved(saved, false, anchor));
        }
    }
    None
}

/// Config already names a session: leave `session_id`, the explicit flag,
/// and the anchor alone. The only automatic write is filling an empty id.
pub fn stored_pin_after_resolve(
    existing_id: &str,
    existing_explicit: bool,
    existing_anchor: f64,
    resolved_id: &str,
    resolved_explicit: bool,
    resolved_anchor: f64,
) -> Option<(String, bool, f64)> {
    if !existing_id.trim().is_empty() {
        return None;
    }
    let resolved_id = resolved_id.trim();
    if resolved_id.is_empty() {
        return None;
    }
    let anchor = if existing_anchor.is_finite() && existing_anchor > 0.0 {
        existing_anchor
    } else if resolved_anchor.is_finite() && resolved_anchor > 0.0 {
        resolved_anchor
    } else {
        0.0
    };
    Some((
        resolved_id.to_string(),
        existing_explicit || resolved_explicit,
        anchor,
    ))
}

/// Suffix of `next` that was not in `seen`. `None` means the transcript diverged.
pub fn fresh_messages<'a>(seen: &[UiMessage], next: &'a [UiMessage]) -> Option<&'a [UiMessage]> {
    if next.len() < seen.len() || next[..seen.len()] != *seen {
        return None;
    }
    Some(&next[seen.len()..])
}

fn json_flag(item: &Value, key: &str) -> Option<bool> {
    let value = item.get(key)?;
    if let Some(flag) = value.as_bool() {
        return Some(flag);
    }
    if let Some(n) = value.as_i64() {
        return Some(n != 0);
    }
    if let Some(n) = value.as_u64() {
        return Some(n != 0);
    }
    None
}

fn json_f64(item: &Value, key: &str) -> f64 {
    item.get(key).and_then(Value::as_f64).unwrap_or(0.0)
}

fn message_count_of(item: &Value) -> Option<u64> {
    let keyed = json_count(item, "message_count").or_else(|| json_count(item, "messageCount"));
    let listed = item
        .get("messages")
        .and_then(Value::as_array)
        .map(|rows| rows.len() as u64);
    match (keyed, listed) {
        (Some(count), Some(len)) if count == 0 && len > 0 => Some(len),
        (Some(count), _) => Some(count),
        (None, Some(len)) => Some(len),
        (None, None) => None,
    }
}

fn json_count(item: &Value, key: &str) -> Option<u64> {
    let value = item.get(key)?;
    value
        .as_u64()
        .or_else(|| value.as_i64().and_then(|n| u64::try_from(n).ok()))
        .or_else(|| {
            value.as_f64().and_then(|n| {
                if n.is_finite() && n >= 0.0 && n.fract() == 0.0 {
                    Some(n as u64)
                } else {
                    None
                }
            })
        })
}

fn id_value(value: &Value) -> Option<String> {
    let raw = value
        .as_str()
        .or_else(|| {
            value
                .get("id")
                .or_else(|| value.get("session_id"))
                .and_then(Value::as_str)
        })
        .unwrap_or("")
        .trim();
    if raw.is_empty() {
        None
    } else {
        Some(raw.to_string())
    }
}

/// Delivery lease or home-channel id when the session list exposes one.
/// Current Hermes `_session_response` does not. These names are the ones a
/// gateway would add; absent means use the titled-row fallback.
fn envelope_delivery_id(value: &Value) -> Option<String> {
    const KEYS: &[&str] = &[
        "canonical_session",
        "canonical_session_id",
        "delivery_session",
        "delivery_session_id",
        "home_channel_session",
        "home_channel",
        "lease_session",
        "delivery_lease",
    ];
    KEYS.iter()
        .find_map(|key| value.get(*key).and_then(id_value))
}

fn row_marks_delivery(item: &Value) -> bool {
    const KEYS: &[&str] = &[
        "canonical",
        "is_canonical",
        "delivery",
        "home_channel",
        "is_home_channel",
    ];
    KEYS.iter()
        .any(|key| item.get(*key).and_then(Value::as_bool) == Some(true))
}

pub fn parse_session_list(value: &Value) -> Vec<SessionSummary> {
    let items = value
        .get("data")
        .or_else(|| value.get("sessions"))
        .and_then(Value::as_array)
        .cloned()
        .or_else(|| value.as_array().cloned())
        .unwrap_or_default();
    let mut sessions: Vec<SessionSummary> = items
        .iter()
        .filter_map(|item| {
            let id = item
                .get("id")
                .or_else(|| item.get("session_id"))
                .and_then(Value::as_str)?
                .trim()
                .to_string();
            if id.is_empty() {
                return None;
            }
            let title = item
                .get("title")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let hidden = json_flag(item, "hidden");
            let archived = json_flag(item, "archived").unwrap_or(false)
                || json_flag(item, "is_archived").unwrap_or(false);
            let parent_session_id = item
                .get("parent_session_id")
                .or_else(|| item.get("parentSessionId"))
                .and_then(Value::as_str)
                .unwrap_or("")
                .trim()
                .to_string();
            let started_at = json_f64(item, "started_at");
            let last_active = item
                .get("last_active")
                .and_then(Value::as_f64)
                .unwrap_or(started_at);
            let preview = item
                .get("preview")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let source = item
                .get("source")
                .and_then(Value::as_str)
                .unwrap_or("")
                .trim()
                .to_string();
            Some(SessionSummary {
                id,
                title,
                hidden,
                last_active,
                preview,
                source,
                started_at,
                message_count: message_count_of(item),
                delivery: row_marks_delivery(item),
                parent_session_id,
                archived,
            })
        })
        .collect();
    if let Some(id) = envelope_delivery_id(value) {
        for session in &mut sessions {
            if session.id == id {
                session.delivery = true;
            }
        }
    }
    sessions
}

/// Title-query rows fill in hidden Bot Chats the blanket list omits.
pub fn merge_sessions(
    mut base: Vec<SessionSummary>,
    extra: Vec<SessionSummary>,
) -> Vec<SessionSummary> {
    for session in extra {
        if let Some(found) = base.iter_mut().find(|row| row.id == session.id) {
            if session.delivery {
                found.delivery = true;
            }
            if found.message_count.is_none() {
                found.message_count = session.message_count;
            }
            if found.preview.is_empty() {
                found.preview = session.preview;
            }
            if found.started_at <= 0.0 {
                found.started_at = session.started_at;
            }
            if found.source.is_empty() {
                found.source = session.source;
            }
            if found.last_active <= 0.0 {
                found.last_active = session.last_active;
            }
            if found.parent_session_id.is_empty() {
                found.parent_session_id = session.parent_session_id;
            }
            if found.hidden.is_none() {
                found.hidden = session.hidden;
            }
            if session.archived {
                found.archived = true;
            }
        } else {
            base.push(session);
        }
    }
    base
}

pub fn normalize_messages(value: &Value) -> Vec<UiMessage> {
    let items = value
        .get("data")
        .or_else(|| value.get("messages"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mut out = Vec::new();
    for item in items {
        let role = item.get("role").and_then(Value::as_str).unwrap_or("");
        let tool_name = item
            .get("tool_name")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        let text = content_to_text(item.get("content").unwrap_or(&Value::Null));
        let text = clip(&text, 8000);
        let display_kind = item
            .get("display_kind")
            .and_then(Value::as_str)
            .unwrap_or("");
        if display_kind == "failed_turn" && !text.trim().is_empty() {
            out.push(UiMessage {
                role: "failure".into(),
                text,
                tool_name: String::new(),
            });
            continue;
        }
        match role {
            "user" if !text.trim().is_empty() => out.push(UiMessage {
                role: "user".into(),
                text,
                tool_name: String::new(),
            }),
            "assistant" if !text.trim().is_empty() => out.push(UiMessage {
                role: "bot".into(),
                text,
                tool_name: String::new(),
            }),
            "tool" if !text.trim().is_empty() => out.push(UiMessage {
                role: "tool".into(),
                text,
                tool_name: if tool_name.is_empty() {
                    "tool".into()
                } else {
                    tool_name
                },
            }),
            _ => {}
        }
    }
    let order = value
        .pointer("/pagination/order")
        .and_then(Value::as_str)
        .unwrap_or("");
    if order == "latest" {
        out.reverse();
    }
    out
}

pub fn session_id_from_create(value: &Value) -> Option<String> {
    let id = value
        .pointer("/session/id")
        .or_else(|| value.get("id"))
        .or_else(|| value.get("session_id"))
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .to_string();
    if id.is_empty() {
        None
    } else {
        Some(id)
    }
}

pub fn conflict_session_id(body: &str) -> Option<String> {
    // Hermes 0.21.6: `Title 'Bot Chat' is already in use by session api_…`
    // Older wording was `Title already in use by session api_…`.
    const MARKER: &str = "already in use by session ";
    let idx = body.find(MARKER)?;
    let rest = &body[idx + MARKER.len()..];
    let id: String = rest
        .chars()
        .take_while(|c| !c.is_whitespace() && *c != '"' && *c != '\\' && *c != '}')
        .collect();
    let id = id.trim().trim_matches(|c| c == ',' || c == '.').to_string();
    if id.is_empty() {
        None
    } else {
        Some(id)
    }
}

fn content_to_text(value: &Value) -> String {
    match value {
        Value::String(text) => text.clone(),
        Value::Array(parts) => parts
            .iter()
            .filter_map(|part| {
                if let Some(text) = part.get("text").and_then(Value::as_str) {
                    return Some(text.to_string());
                }
                match part.get("type").and_then(Value::as_str) {
                    Some("image_url" | "input_image" | "image") => Some("[image]".into()),
                    _ => None,
                }
            })
            .collect::<Vec<_>>()
            .join(""),
        _ => String::new(),
    }
}

pub fn clip(text: &str, max_chars: usize) -> String {
    let mut out = String::new();
    for (i, ch) in text.chars().enumerate() {
        if i >= max_chars {
            out.push('…');
            break;
        }
        out.push(ch);
    }
    out
}

fn map_reqwest(err: reqwest::Error) -> HermesError {
    let msg = err.to_string();
    if err.is_connect() {
        HermesError::Connect(msg)
    } else if err.is_timeout() {
        HermesError::Timeout(msg)
    } else {
        HermesError::Transport(msg)
    }
}

fn authed(builder: reqwest::RequestBuilder, key: &str) -> reqwest::RequestBuilder {
    builder
        .header("Authorization", format!("Bearer {}", key.trim()))
        .header("Accept", "application/json")
}

async fn send(
    builder: reqwest::RequestBuilder,
    key: &str,
) -> Result<reqwest::Response, HermesError> {
    let resp = authed(builder, key).send().await.map_err(map_reqwest)?;
    let status = resp.status();
    if status.is_success() {
        return Ok(resp);
    }
    let code = status.as_u16();
    let body = resp.text().await.unwrap_or_default();
    Err(HermesError::Http {
        status: code,
        body: clip(&body, 400),
    })
}

async fn list_sessions_url(
    http: &Client,
    key: &str,
    url: String,
) -> Result<Vec<SessionSummary>, HermesError> {
    let resp = send(http.get(url).timeout(Duration::from_secs(20)), key).await?;
    let value: Value = resp
        .json()
        .await
        .map_err(|e| HermesError::Protocol(format!("session list 唔係 JSON：{e}")))?;
    Ok(parse_session_list(&value))
}

pub async fn list_sessions(
    http: &Client,
    root: &str,
    key: &str,
) -> Result<Vec<SessionSummary>, HermesError> {
    let url = format!("{root}/api/sessions?limit=200&include_hidden=true");
    list_sessions_url(http, key, url).await
}

/// Exact-title lookup for the canonical Bot Chat, including hidden and archived rows.
/// `include_hidden` is honored only together with `title` on current Hermes.
pub async fn list_titled_bot_chats(
    http: &Client,
    root: &str,
    key: &str,
) -> Result<Vec<SessionSummary>, HermesError> {
    let title = query_escape(BOT_CHAT_TITLE);
    let url = format!(
        "{root}/api/sessions?limit=200&title={title}&include_hidden=true&include_archived=true"
    );
    list_sessions_url(http, key, url).await
}

/// Blanket list plus the exact-title lookup. A failed title query keeps the blanket list.
pub async fn list_sessions_for_bot_chat(
    http: &Client,
    root: &str,
    key: &str,
) -> Result<Vec<SessionSummary>, HermesError> {
    let sessions = list_sessions(http, root, key).await?;
    match list_titled_bot_chats(http, root, key).await {
        Ok(titled) => Ok(merge_sessions(sessions, titled)),
        Err(_) => Ok(sessions),
    }
}

/// A 400 that names a session titled `Bot Chat` returns that id.
/// Source does not matter. An id missing from this listing keeps the
/// previous hidden-occupant behaviour.
fn adopt_title_conflict(sessions: &[SessionSummary], body: &str) -> Option<String> {
    let id = conflict_session_id(body)?;
    match sessions.iter().find(|session| session.id == id) {
        Some(session) if is_bot_chat_title(&session.title) => Some(id),
        Some(_) => None,
        None => Some(id),
    }
}

/// `POST /api/sessions` with `{title: "Bot Chat", source: "api_server"}`.
/// Startup, open, and send must not call this. A 400 adopts the occupant
/// when that session is titled `Bot Chat`, whatever its source.
#[allow(dead_code)]
pub async fn create_bot_chat(http: &Client, root: &str, key: &str) -> Result<String, HermesError> {
    match create_session(http, root, key, Some(BOT_CHAT_TITLE)).await {
        Ok(id) => Ok(id),
        Err(HermesError::Http { status: 400, body }) => {
            match list_sessions(http, root, key).await {
                Ok(sessions) => adopt_title_conflict(&sessions, &body)
                    .ok_or(HermesError::Http { status: 400, body }),
                Err(_) => conflict_session_id(&body).ok_or(HermesError::Http { status: 400, body }),
            }
        }
        Err(err) => Err(err),
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BotChatPick {
    pub id: String,
    pub source: String,
    pub read_only: bool,
    pub read_only_reason: String,
}

impl BotChatPick {
    pub fn from_session(session: &SessionSummary) -> Self {
        let read_only = session_read_only(&session.source);
        Self {
            id: session.id.clone(),
            source: session.source.clone(),
            read_only,
            read_only_reason: if read_only {
                session_read_only_reason().to_string()
            } else {
                String::new()
            },
        }
    }
}

/// Canonical Bot Chat already on the gateway. Never creates a session.
pub async fn ensure_bot_chat(
    http: &Client,
    root: &str,
    key: &str,
) -> Result<BotChatPick, HermesError> {
    let sessions = list_sessions_for_bot_chat(http, root, key).await?;
    canonical_bot_chat(&sessions)
        .map(BotChatPick::from_session)
        .ok_or_else(|| HermesError::Protocol("未有 Bot Chat".into()))
}

pub async fn fetch_messages(
    http: &Client,
    root: &str,
    key: &str,
    session_id: &str,
) -> Result<Vec<UiMessage>, HermesError> {
    let url = format!(
        "{root}/api/sessions/{session_id}/messages?order=oldest&limit=500&inline_images=false"
    );
    let resp = send(http.get(url).timeout(Duration::from_secs(30)), key).await?;
    let value: Value = resp
        .json()
        .await
        .map_err(|e| HermesError::Protocol(format!("訊息紀錄唔係 JSON：{e}")))?;
    Ok(normalize_messages(&value))
}

pub async fn probe_health(http: &Client, gateway: &str) -> Result<String, HermesError> {
    let url = format!("{}/health", gateway.trim_end_matches('/'));
    let resp = http
        .get(url)
        .timeout(Duration::from_secs(8))
        .send()
        .await
        .map_err(map_reqwest)?;
    let status = resp.status();
    let body = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(HermesError::Http {
            status: status.as_u16(),
            body: clip(&body, 200),
        });
    }
    Ok(clip(&body, 200))
}

pub async fn probe_sessions(http: &Client, root: &str, key: &str) -> Result<(), HermesError> {
    let url = format!("{root}/api/sessions?limit=1");
    let _ = send(http.get(url).timeout(Duration::from_secs(15)), key).await?;
    Ok(())
}

pub fn parse_command_catalog(value: &Value) -> Vec<OverlayCommand> {
    let items = value
        .get("data")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    items
        .iter()
        .filter_map(|item| {
            let name = item
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or("")
                .trim();
            if name.is_empty() {
                return None;
            }
            let aliases = item
                .get("aliases")
                .and_then(Value::as_array)
                .map(|list| {
                    list.iter()
                        .filter_map(|entry| entry.as_str().map(str::to_string))
                        .collect()
                })
                .unwrap_or_default();
            Some(OverlayCommand {
                name: name.to_string(),
                kind: item
                    .get("kind")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string(),
                category: item
                    .get("category")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string(),
                description: item
                    .get("description")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string(),
                args_hint: item
                    .get("args_hint")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string(),
                aliases,
                enabled: item.get("enabled").and_then(Value::as_bool).unwrap_or(true),
                maps_to: item
                    .get("maps_to")
                    .and_then(Value::as_str)
                    .filter(|text| !text.is_empty())
                    .map(str::to_string),
            })
        })
        .collect()
}

pub fn commands_from_fetch(
    result: Result<CatalogFetch, HermesError>,
    cached: &[OverlayCommand],
) -> (Vec<OverlayCommand>, String) {
    match result {
        Ok(CatalogFetch::Fresh { commands, .. }) => (commands, String::new()),
        Ok(CatalogFetch::NotModified) => (cached.to_vec(), String::new()),
        Ok(CatalogFetch::Missing) => (Vec::new(), PLUGIN_HINT.into()),
        Err(HermesError::Connect(_) | HermesError::Timeout(_) | HermesError::Transport(_)) => {
            (Vec::new(), PLUGIN_HINT.into())
        }
        Err(HermesError::Http { status: 404, .. }) => (Vec::new(), PLUGIN_HINT.into()),
        Err(err) => (Vec::new(), explain(&err)),
    }
}

pub async fn fetch_overlay_commands(
    http: &Client,
    root: &str,
    key: &str,
    etag: Option<&str>,
) -> Result<CatalogFetch, HermesError> {
    let url = format!("{root}/v1/overlay/commands");
    let mut req = http.get(url).timeout(Duration::from_secs(8));
    if let Some(tag) = etag.map(str::trim).filter(|tag| !tag.is_empty()) {
        req = req.header("If-None-Match", tag);
    }
    let resp = authed(req, key).send().await.map_err(map_reqwest)?;
    let status = resp.status().as_u16();
    if status == 304 {
        return Ok(CatalogFetch::NotModified);
    }
    if status == 404 {
        return Ok(CatalogFetch::Missing);
    }
    if !(200..300).contains(&status) {
        let body = resp.text().await.unwrap_or_default();
        return Err(HermesError::Http {
            status,
            body: clip(&body, 200),
        });
    }
    let etag = resp
        .headers()
        .get("etag")
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
        .to_string();
    let value: Value = resp
        .json()
        .await
        .map_err(|err| HermesError::Protocol(format!("指令目錄唔係 JSON：{err}")))?;
    Ok(CatalogFetch::Fresh {
        etag,
        commands: parse_command_catalog(&value),
    })
}

pub const KANBAN_EMPTY: &str = "未裝 overlay-slash kanban，看板唔會出現。";
pub const KANBAN_UNAVAILABLE: &str = "呢部 Hermes 未有看板。伺服器冇提供看板功能。";
pub const KANBAN_LOGIN: &str = "要登入 Kanban";
pub const KANBAN_STATUSES: [&str; 8] = [
    "triage", "todo", "scheduled", "ready", "running", "blocked", "review", "done",
];

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct KanbanTask {
    pub id: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub assignee: String,
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub priority: String,
    #[serde(default)]
    pub updated_at: String,
    #[serde(default)]
    pub body: String,
    #[serde(default)]
    pub latest_summary: String,
    #[serde(default)]
    pub comment_count: u64,
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub started_at: String,
    #[serde(default)]
    pub completed_at: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct KanbanColumn {
    pub name: String,
    pub tasks: Vec<KanbanTask>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct KanbanBoard {
    pub board: String,
    pub columns: Vec<KanbanColumn>,
    pub unavailable: bool,
    pub needs_login: bool,
    pub message: String,
}

fn query_escape(raw: &str) -> String {
    let mut out = String::new();
    for byte in raw.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' => out.push(byte as char),
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

fn json_string(value: &Value, key: &str) -> String {
    match value.get(key) {
        Some(Value::String(text)) => text.trim().to_string(),
        Some(Value::Number(number)) => number.to_string(),
        Some(Value::Bool(flag)) => flag.to_string(),
        _ => String::new(),
    }
}

pub(crate) fn task_from(value: &Value, fallback_status: &str) -> Option<KanbanTask> {
    let id = json_string(value, "id");
    if id.is_empty() {
        return None;
    }
    let mut status = json_string(value, "status");
    if status.is_empty() {
        status = fallback_status.to_string();
    }
    if status == "archived" {
        return None;
    }
    let created_at = json_time(value, "created_at");
    let started_at = json_time(value, "started_at");
    let completed_at = json_time(value, "completed_at");
    let mut updated_at = json_string(value, "updated_at");
    if updated_at.is_empty() {
        updated_at = [&completed_at, &started_at, &created_at]
            .into_iter()
            .find(|item| !item.is_empty())
            .cloned()
            .unwrap_or_default();
    }
    Some(KanbanTask {
        id,
        title: json_string(value, "title"),
        assignee: json_string(value, "assignee"),
        status,
        priority: json_string(value, "priority"),
        updated_at,
        body: json_string(value, "body"),
        latest_summary: json_string(value, "latest_summary"),
        comment_count: value
            .get("comment_count")
            .and_then(Value::as_u64)
            .unwrap_or(0),
        created_at,
        started_at,
        completed_at,
    })
}

pub fn parse_kanban_board(value: &Value, board: &str) -> KanbanBoard {
    let source = value.get("data").unwrap_or(value);
    let board_name = json_string(source, "board");
    let board_name = if board_name.is_empty() {
        board.to_string()
    } else {
        board_name
    };
    let mut tasks = Vec::new();
    if let Some(columns) = source.get("columns").and_then(Value::as_array) {
        for column in columns {
            let name = json_string(column, "name");
            let items = column
                .get("tasks")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            for item in items {
                if let Some(task) = task_from(&item, &name) {
                    tasks.push(task);
                }
            }
        }
    }
    let mut names: Vec<String> = KANBAN_STATUSES
        .iter()
        .map(|name| (*name).to_string())
        .collect();
    for task in &tasks {
        if !task.status.is_empty() && !names.iter().any(|name| name == &task.status) {
            names.push(task.status.clone());
        }
    }
    let columns = names
        .into_iter()
        .map(|name| KanbanColumn {
            tasks: tasks
                .iter()
                .filter(|task| task.status == name)
                .cloned()
                .collect(),
            name,
        })
        .collect();
    KanbanBoard {
        board: board_name,
        columns,
        unavailable: false,
        needs_login: false,
        message: String::new(),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CronJob {
    pub id: String,
    pub name: String,
    pub schedule: String,
    pub enabled: bool,
    pub next_run_at: String,
    pub last_run_at: String,
    pub running: bool,
    /// Live execution start, else claim time. Empty when this job is not in a run.
    pub started_at: String,
    /// Hermes keeps `completed` or `scheduled` on a failed job. The red ring reads these.
    #[serde(default)]
    pub state: String,
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub last_status: String,
    #[serde(default)]
    pub last_error: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct CronList {
    pub jobs: Vec<CronJob>,
    pub unavailable: bool,
    pub message: String,
}

fn json_time(value: &Value, key: &str) -> String {
    match value.get(key) {
        Some(Value::String(text)) => text.trim().to_string(),
        Some(Value::Number(number)) => number.to_string(),
        _ => String::new(),
    }
}

fn schedule_text(value: &Value) -> String {
    if let Some(text) = value.get("schedule_display").and_then(Value::as_str) {
        let text = text.trim();
        if !text.is_empty() {
            return text.to_string();
        }
    }
    match value.get("schedule") {
        Some(Value::String(text)) => text.trim().to_string(),
        Some(Value::Object(map)) => {
            for key in ["display", "expression", "expr"] {
                if let Some(Value::String(text)) = map.get(key) {
                    let text = text.trim();
                    if !text.is_empty() {
                        return text.to_string();
                    }
                }
            }
            String::new()
        }
        _ => String::new(),
    }
}

fn json_any(value: &Value, key: &str) -> String {
    match value.get(key) {
        Some(Value::String(text)) => text.trim().to_string(),
        Some(Value::Number(number)) => number.to_string(),
        Some(Value::Bool(true)) => "true".into(),
        Some(Value::Bool(false)) | Some(Value::Null) | None => String::new(),
        Some(other) => {
            let text = other.to_string();
            if text == "{}" || text == "[]" {
                String::new()
            } else {
                text
            }
        }
    }
}

fn nested_text(value: &Value, keys: &[&str]) -> String {
    for key in keys {
        let text = json_any(value, key);
        if !text.is_empty() {
            return text;
        }
    }
    let Some(exec) = value
        .get("latest_execution")
        .filter(|item| item.is_object())
    else {
        return String::new();
    };
    for key in keys {
        let text = json_any(exec, key);
        if !text.is_empty() {
            return text;
        }
    }
    String::new()
}

fn last_status_text(value: &Value) -> String {
    nested_text(value, &["last_status", "lastStatus"])
}

fn last_error_text(value: &Value) -> String {
    let direct = nested_text(value, &["last_error", "lastError"]);
    if !direct.is_empty() {
        return direct;
    }
    value
        .get("latest_execution")
        .map(|exec| json_any(exec, "error"))
        .unwrap_or_default()
}

fn job_status_text(value: &Value) -> String {
    let exec = execution_status(value);
    if !exec.is_empty() {
        return exec;
    }
    json_string(value, "status")
}

fn execution_status(value: &Value) -> String {
    value
        .get("latest_execution")
        .and_then(|item| item.get("status"))
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .to_string()
}

/// Hermes stamps `fire_claim` on the job (and sometimes the execution) for the whole run.
fn fire_claim_live(value: &Value) -> bool {
    match value.get("fire_claim") {
        Some(Value::Object(map)) => !map.is_empty(),
        Some(Value::String(text)) => !text.trim().is_empty(),
        _ => false,
    }
}

fn job_is_running(value: &Value, state: &str) -> bool {
    if state.eq_ignore_ascii_case("running")
        || value.get("running").and_then(Value::as_bool) == Some(true)
    {
        return true;
    }
    if fire_claim_live(value) {
        return true;
    }
    if value.get("latest_execution").is_some_and(fire_claim_live) {
        return true;
    }
    let status = execution_status(value);
    status.eq_ignore_ascii_case("running") || status.eq_ignore_ascii_case("claimed")
}

fn last_run_text(value: &Value) -> String {
    for key in ["last_run_at", "last_run"] {
        let text = json_time(value, key);
        if !text.is_empty() {
            return text;
        }
    }
    let Some(exec) = value.get("latest_execution") else {
        return String::new();
    };
    let finished = json_time(exec, "finished_at");
    if !finished.is_empty() {
        return finished;
    }
    json_time(exec, "started_at")
}

/// `started_at` once the attempt is running, otherwise `claimed_at`, otherwise the fire claim.
fn run_start_text(value: &Value) -> String {
    if let Some(exec) = value
        .get("latest_execution")
        .filter(|item| item.is_object())
    {
        let status = exec
            .get("status")
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim()
            .to_ascii_lowercase();
        let live = status.is_empty() || status == "running" || status == "claimed";
        if live {
            for key in ["started_at", "start", "claimed_at", "claim_time"] {
                let text = json_time(exec, key);
                if !text.is_empty() {
                    return text;
                }
            }
        }
        if let Some(claim) = exec.get("fire_claim").filter(|item| item.is_object()) {
            for key in ["started_at", "claimed_at", "at"] {
                let text = json_time(claim, key);
                if !text.is_empty() {
                    return text;
                }
            }
        }
    }
    if let Some(claim) = value.get("fire_claim").filter(|item| item.is_object()) {
        for key in ["started_at", "claimed_at", "at"] {
            let text = json_time(claim, key);
            if !text.is_empty() {
                return text;
            }
        }
    }
    for key in ["started_at", "claimed_at"] {
        let text = json_time(value, key);
        if !text.is_empty() {
            return text;
        }
    }
    String::new()
}

fn cron_job_from(value: &Value) -> Option<CronJob> {
    let id = json_string(value, "id");
    let name = json_string(value, "name");
    if id.is_empty() && name.is_empty() {
        return None;
    }
    let state = json_string(value, "state");
    let enabled = match value.get("enabled").and_then(Value::as_bool) {
        Some(flag) => flag,
        None => !state.eq_ignore_ascii_case("paused"),
    };
    Some(CronJob {
        id: if id.is_empty() { name.clone() } else { id },
        name: if name.is_empty() {
            "未命名".into()
        } else {
            name
        },
        schedule: schedule_text(value),
        enabled,
        next_run_at: {
            let next = json_time(value, "next_run_at");
            if next.is_empty() {
                json_time(value, "next_run")
            } else {
                next
            }
        },
        last_run_at: last_run_text(value),
        running: job_is_running(value, &state),
        started_at: if job_is_running(value, &state) {
            run_start_text(value)
        } else {
            String::new()
        },
        state,
        status: job_status_text(value),
        last_status: last_status_text(value),
        last_error: last_error_text(value),
    })
}

fn unavailable_cron() -> CronList {
    CronList {
        jobs: Vec::new(),
        unavailable: true,
        message: "呢個 Bot 未有排程。".into(),
    }
}

/// Hermes 0.21.6 lists jobs at `/api/jobs`. `/api/crons` is only a fallback.
pub fn cron_jobs_url(root: &str) -> String {
    format!(
        "{}/api/jobs?include_disabled=true",
        root.trim_end_matches('/')
    )
}

pub fn cron_legacy_url(root: &str) -> String {
    format!("{}/api/crons", root.trim_end_matches('/'))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CronFetchStep {
    Parse,
    TryFallback,
    Unavailable,
    Error,
}

/// 404 on the jobs route may try `/api/crons`. 404 there, or 501, is an empty list.
fn cron_fetch_step(status: u16, primary: bool) -> CronFetchStep {
    if (200..300).contains(&status) {
        return CronFetchStep::Parse;
    }
    if status == 404 && primary {
        return CronFetchStep::TryFallback;
    }
    if status == 404 || status == 501 {
        return CronFetchStep::Unavailable;
    }
    CronFetchStep::Error
}

/// `GET /api/jobs` for one profile. `cron_unavailable` is an empty list, not an error.
pub fn parse_cron_list(value: &Value) -> CronList {
    if value.get("cron_unavailable").and_then(Value::as_bool) == Some(true) {
        return unavailable_cron();
    }
    let items = if let Some(list) = value.as_array() {
        list
    } else if let Some(list) = value.get("jobs").and_then(Value::as_array) {
        list
    } else {
        return CronList {
            jobs: Vec::new(),
            unavailable: false,
            message: String::new(),
        };
    };
    CronList {
        jobs: items.iter().filter_map(cron_job_from).collect(),
        unavailable: false,
        message: String::new(),
    }
}

enum CronFetchBody {
    Parsed(CronList),
    Fallback,
}

async fn fetch_cron_url(
    http: &Client,
    url: &str,
    key: &str,
    primary: bool,
) -> Result<CronFetchBody, HermesError> {
    let resp = authed(http.get(url).timeout(Duration::from_secs(8)), key)
        .send()
        .await
        .map_err(map_reqwest)?;
    let status = resp.status().as_u16();
    match cron_fetch_step(status, primary) {
        CronFetchStep::Parse => {
            let value: Value = resp
                .json()
                .await
                .map_err(|err| HermesError::Protocol(format!("cron 回應唔係 JSON：{err}")))?;
            Ok(CronFetchBody::Parsed(parse_cron_list(&value)))
        }
        CronFetchStep::TryFallback => Ok(CronFetchBody::Fallback),
        CronFetchStep::Unavailable => Ok(CronFetchBody::Parsed(unavailable_cron())),
        CronFetchStep::Error => {
            let body = resp.text().await.unwrap_or_default();
            Err(HermesError::Http {
                status,
                body: clip(&body, 200),
            })
        }
    }
}

pub async fn fetch_cron_jobs(
    http: &Client,
    root: &str,
    key: &str,
) -> Result<CronList, HermesError> {
    match fetch_cron_url(http, &cron_jobs_url(root), key, true).await? {
        CronFetchBody::Parsed(list) => Ok(list),
        CronFetchBody::Fallback => {
            match fetch_cron_url(http, &cron_legacy_url(root), key, false).await? {
                CronFetchBody::Parsed(list) => Ok(list),
                CronFetchBody::Fallback => Ok(unavailable_cron()),
            }
        }
    }
}

pub fn kanban_patch_body(status: &str, assignee: &str, priority: &str, title: &str) -> Value {
    let mut body = serde_json::Map::new();
    if !status.trim().is_empty() {
        body.insert("status".into(), Value::String(status.trim().to_string()));
    }
    if !assignee.trim().is_empty() {
        body.insert(
            "assignee".into(),
            Value::String(assignee.trim().to_string()),
        );
    }
    if !priority.trim().is_empty() {
        body.insert(
            "priority".into(),
            Value::String(priority.trim().to_string()),
        );
    }
    if !title.trim().is_empty() {
        body.insert("title".into(), Value::String(title.trim().to_string()));
    }
    Value::Object(body)
}

pub async fn fetch_kanban_board(
    http: &Client,
    root: &str,
    key: &str,
    board: &str,
) -> Result<KanbanBoard, HermesError> {
    let url = format!(
        "{}/v1/overlay/kanban/board?board={}",
        root.trim_end_matches('/'),
        query_escape(board)
    );
    let resp = authed(http.get(url).timeout(Duration::from_secs(8)), key)
        .send()
        .await
        .map_err(map_reqwest)?;
    let status = resp.status().as_u16();
    if status == 404 {
        return Ok(KanbanBoard {
            board: board.to_string(),
            columns: Vec::new(),
            unavailable: true,
            needs_login: false,
            message: KANBAN_UNAVAILABLE.to_string(),
        });
    }
    if !(200..300).contains(&status) {
        let body = resp.text().await.unwrap_or_default();
        return Err(HermesError::Http {
            status,
            body: clip(&body, 200),
        });
    }
    let value: Value = resp
        .json()
        .await
        .map_err(|err| HermesError::Protocol(format!("kanban 回應唔係 JSON：{err}")))?;
    Ok(parse_kanban_board(&value, board))
}

pub async fn patch_kanban_task(
    http: &Client,
    root: &str,
    key: &str,
    id: &str,
    body: &Value,
) -> Result<KanbanTask, HermesError> {
    let url = format!(
        "{}/v1/overlay/kanban/tasks/{}",
        root.trim_end_matches('/'),
        query_escape(id)
    );
    let resp = send(
        http.patch(url).timeout(Duration::from_secs(8)).json(body),
        key,
    )
    .await?;
    let value: Value = resp
        .json()
        .await
        .map_err(|err| HermesError::Protocol(format!("kanban 更新唔係 JSON：{err}")))?;
    let task_value = value.get("task").unwrap_or(&value);
    task_from(task_value, "").ok_or_else(|| HermesError::Protocol("kanban 更新回應冇 id".into()))
}

pub async fn create_session(
    http: &Client,
    root: &str,
    key: &str,
    title: Option<&str>,
) -> Result<String, HermesError> {
    let mut body = serde_json::json!({ "source": "api_server" });
    if let Some(title) = title.map(str::trim).filter(|title| !title.is_empty()) {
        body["title"] = Value::String(title.to_string());
    }
    let url = format!("{root}/api/sessions");
    let resp = send(
        http.post(url).timeout(Duration::from_secs(20)).json(&body),
        key,
    )
    .await?;
    let value: Value = resp
        .json()
        .await
        .map_err(|err| HermesError::Protocol(format!("建立 session 回應唔係 JSON：{err}")))?;
    session_id_from_create(&value)
        .ok_or_else(|| HermesError::Protocol("建立 session 回應冇 id".into()))
}

pub async fn patch_session_title(
    http: &Client,
    root: &str,
    key: &str,
    session_id: &str,
    title: &str,
) -> Result<(), HermesError> {
    let url = format!("{root}/api/sessions/{session_id}");
    let _ = send(
        http.patch(url)
            .timeout(Duration::from_secs(20))
            .json(&serde_json::json!({ "title": title })),
        key,
    )
    .await?;
    Ok(())
}

pub async fn fork_session(
    http: &Client,
    root: &str,
    key: &str,
    session_id: &str,
    title: &str,
) -> Result<String, HermesError> {
    let mut body = serde_json::json!({});
    if !title.trim().is_empty() {
        body["title"] = Value::String(title.trim().to_string());
    }
    let url = format!("{root}/api/sessions/{session_id}/fork");
    let resp = send(
        http.post(url).timeout(Duration::from_secs(20)).json(&body),
        key,
    )
    .await?;
    let value: Value = resp
        .json()
        .await
        .map_err(|err| HermesError::Protocol(format!("分支回應唔係 JSON：{err}")))?;
    session_id_from_create(&value).ok_or_else(|| HermesError::Protocol("分支回應冇 id".into()))
}

pub fn parse_model_options(value: &Value) -> Vec<String> {
    let mut out = Vec::new();
    let mut push = |text: &str| {
        let text = text.trim();
        if text.is_empty() || out.iter().any(|item: &String| item == text) || out.len() >= 40 {
            return;
        }
        out.push(text.to_string());
    };
    if let Some(data) = value.get("data").and_then(Value::as_array) {
        for item in data {
            if let Some(text) = item.as_str() {
                push(text);
                continue;
            }
            let name = item
                .get("id")
                .or_else(|| item.get("name"))
                .or_else(|| item.get("model"))
                .and_then(Value::as_str)
                .unwrap_or("");
            let provider = item.get("provider").and_then(Value::as_str).unwrap_or("");
            if !provider.is_empty() && !name.is_empty() {
                push(&format!("{provider} / {name}"));
            } else {
                push(name);
            }
        }
    }
    if let Some(providers) = value.get("providers").and_then(Value::as_array) {
        for provider in providers {
            let pname = provider
                .get("name")
                .or_else(|| provider.get("id"))
                .and_then(Value::as_str)
                .unwrap_or("");
            let Some(models) = provider.get("models").and_then(Value::as_array) else {
                continue;
            };
            for model in models {
                let name = model.as_str().or_else(|| {
                    model
                        .get("id")
                        .or_else(|| model.get("name"))
                        .and_then(Value::as_str)
                });
                let Some(name) = name else { continue };
                if !pname.is_empty() {
                    push(&format!("{pname} / {name}"));
                } else {
                    push(name);
                }
            }
        }
    }
    out
}

pub async fn list_model_options(
    http: &Client,
    root: &str,
    key: &str,
) -> Result<Vec<String>, HermesError> {
    let url = format!("{root}/api/model/options");
    let resp = send(http.get(url).timeout(Duration::from_secs(20)), key).await?;
    let value: Value = resp
        .json()
        .await
        .map_err(|err| HermesError::Protocol(format!("模型選項唔係 JSON：{err}")))?;
    Ok(parse_model_options(&value))
}

pub async fn lock_session_model(
    http: &Client,
    root: &str,
    key: &str,
    session_id: &str,
    model: &str,
    provider: &str,
) -> Result<(), HermesError> {
    let mut body = serde_json::json!({ "model": model });
    if !provider.trim().is_empty() {
        body["provider"] = Value::String(provider.trim().to_string());
    }
    let url = format!("{root}/api/sessions/{session_id}/model");
    let _ = send(
        http.post(url).timeout(Duration::from_secs(20)).json(&body),
        key,
    )
    .await?;
    Ok(())
}

pub fn profiles_from_health_body(body: &str) -> Vec<DiscoveredProfile> {
    let Ok(value) = serde_json::from_str::<Value>(body) else {
        return Vec::new();
    };
    if value.get("profiles").and_then(Value::as_array).is_none() {
        return Vec::new();
    }
    parse_dashboard_profiles(&value)
}

/// A failed health read means the gateway is down. Callers skip the roster write.
pub async fn require_gateway(http: &Client, gateway: &str) -> Result<(), HermesError> {
    let url = format!("{}/health", gateway.trim_end_matches('/'));
    let resp = http
        .get(url)
        .timeout(Duration::from_secs(8))
        .send()
        .await
        .map_err(map_reqwest)?;
    if resp.status().is_success() {
        Ok(())
    } else {
        Err(HermesError::Http {
            status: resp.status().as_u16(),
            body: String::new(),
        })
    }
}

pub async fn profiles_from_gateway_health(http: &Client, gateway: &str) -> Vec<DiscoveredProfile> {
    let url = format!("{}/health", gateway.trim_end_matches('/'));
    let Ok(resp) = http.get(url).timeout(Duration::from_secs(8)).send().await else {
        return Vec::new();
    };
    if !resp.status().is_success() {
        return Vec::new();
    }
    let Ok(body) = resp.text().await else {
        return Vec::new();
    };
    profiles_from_health_body(&body)
}

pub async fn list_dashboard_profiles(
    http: &Client,
    dashboard: &str,
    token: Option<&str>,
) -> Result<Vec<DiscoveredProfile>, HermesError> {
    list_dashboard_profiles_timeout(http, dashboard, token, Duration::from_secs(15)).await
}

pub async fn list_dashboard_profiles_timeout(
    http: &Client,
    dashboard: &str,
    token: Option<&str>,
    timeout: Duration,
) -> Result<Vec<DiscoveredProfile>, HermesError> {
    let url = format!("{}/api/profiles", dashboard.trim_end_matches('/'));
    let mut req = http
        .get(url)
        .timeout(timeout)
        .header("Accept", "application/json");
    if let Some(token) = token.map(str::trim).filter(|t| !t.is_empty()) {
        req = req.header("X-Hermes-Session-Token", token);
    }
    let resp = req.send().await.map_err(map_reqwest)?;
    let status = resp.status();
    if !status.is_success() {
        let code = status.as_u16();
        let body = resp.text().await.unwrap_or_default();
        return Err(HermesError::Http {
            status: code,
            body: clip(&body, 300),
        });
    }
    let value: Value = resp
        .json()
        .await
        .map_err(|e| HermesError::Protocol(format!("dashboard profiles 唔係 JSON：{e}")))?;
    Ok(parse_dashboard_profiles(&value))
}

/// `GET /api/profiles` on the Hermes 0.22.5 dashboard.
/// Gated mode accepts the native access token as `Authorization: Bearer`
/// (`dashboard_auth/middleware.py` `_extract_bearer`). The body is discarded
/// on failure and is not logged.
#[derive(Debug)]
pub enum ProfileBearer {
    Listed(Vec<DiscoveredProfile>),
    Expired,
    Missed,
}

pub async fn list_profiles_with_bearer(
    http: &Client,
    origin: &str,
    access_token: &str,
    timeout: Duration,
) -> ProfileBearer {
    let token = access_token.trim();
    if token.is_empty() {
        return ProfileBearer::Expired;
    }
    let url = format!("{}/api/profiles", origin.trim_end_matches('/'));
    let response = match http
        .get(url)
        .timeout(timeout)
        .header("Accept", "application/json")
        .header("Authorization", format!("Bearer {token}"))
        .send()
        .await
    {
        Ok(response) => response,
        Err(_) => return ProfileBearer::Missed,
    };
    let status = response.status().as_u16();
    if status == 401 {
        return ProfileBearer::Expired;
    }
    if !(200..300).contains(&status) {
        return ProfileBearer::Missed;
    }
    let Ok(value) = response.json::<Value>().await else {
        return ProfileBearer::Missed;
    };
    ProfileBearer::Listed(parse_dashboard_profiles(&value))
}

pub fn parse_dashboard_profiles(value: &Value) -> Vec<DiscoveredProfile> {
    let items = value
        .get("profiles")
        .and_then(Value::as_array)
        .cloned()
        .or_else(|| value.as_array().cloned())
        .unwrap_or_default();
    let mut out = Vec::new();
    for item in items {
        let profile = item
            .get("name")
            .or_else(|| item.get("profile"))
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim()
            .to_string();
        if profile.is_empty() {
            continue;
        }
        let bot_title = item.get("bot_title").and_then(Value::as_str).unwrap_or("");
        let display_name = item
            .get("display_name")
            .and_then(Value::as_str)
            .unwrap_or("");
        let display_name = if !bot_title.trim().is_empty() {
            bot_title.trim().to_string()
        } else if !display_name.trim().is_empty() {
            display_name.trim().to_string()
        } else {
            profile.clone()
        };
        let described = item
            .get("description")
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim();
        let detail = if described.is_empty() {
            item.get("detail")
                .and_then(Value::as_str)
                .unwrap_or("")
                .trim()
                .to_string()
        } else {
            described.to_string()
        };
        out.push(DiscoveredProfile {
            profile,
            display_name,
            detail,
            color: json_profile_color(&item),
        });
    }
    out
}

fn json_text(value: Option<&Value>) -> String {
    value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .unwrap_or("")
        .to_string()
}

fn json_profile_color(item: &Value) -> String {
    let direct = json_text(item.get("color"));
    if !direct.is_empty() {
        return direct;
    }
    let bot = json_text(item.get("bot_color"));
    if !bot.is_empty() {
        return bot;
    }
    let nested = item
        .get("ui_meta")
        .and_then(|ui| ui.get("hermes-bots").or_else(|| ui.get("hermes_bots")))
        .and_then(|bots| bots.get("color"));
    json_text(nested)
}

fn is_event_stream(resp: &reqwest::Response) -> bool {
    resp.headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(|value| value.to_ascii_lowercase().contains("text/event-stream"))
        .unwrap_or(false)
}

/// Chat SSE names the frame. `/v1/runs/{id}/events` puts the name in JSON and the seq in `id:`.
fn sse_name(event: &SseEvent) -> String {
    let payload: Value = serde_json::from_str(&event.data).unwrap_or(Value::Null);
    let raw = if !event.event.is_empty() && event.event != "message" {
        event.event.clone()
    } else {
        let named = json_text(payload.get("event"));
        if named.is_empty() {
            event.event.clone()
        } else {
            named
        }
    };
    match raw.as_str() {
        "message.delta" => "assistant.delta".to_string(),
        "message.interim" => "assistant.commentary".to_string(),
        "message.completed" => "assistant.completed".to_string(),
        _ => raw,
    }
}

struct SseRead {
    terminal: bool,
    queued: bool,
}

async fn read_sse_body<F>(
    resp: reqwest::Response,
    stop: &AtomicBool,
    run_id: &mut String,
    streamed: &mut bool,
    last_id: &mut String,
    mut on_event: F,
) -> Result<SseRead, HermesError>
where
    F: FnMut(TurnEvent),
{
    let command = resp
        .headers()
        .get("x-hermes-command")
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
        .trim()
        .to_string();
    if !command.is_empty() {
        on_event(TurnEvent::Command(command));
    }
    let mut stream = resp.bytes_stream();
    let mut decoder = sse::ByteBuf::new();
    let mut saw_terminal = false;
    let mut saw_queued = false;
    let mut pending_failure: Option<String> = None;
    let mut take = |event: SseEvent| {
        if !event.id.is_empty() {
            *last_id = event.id.clone();
        }
        if sse_name(&event) == "run.queued" {
            saw_queued = true;
        }
        if apply_sse(
            event,
            streamed,
            &mut saw_terminal,
            &mut pending_failure,
            run_id,
            &mut on_event,
        ) {
            saw_terminal = true;
        }
    };
    while let Some(chunk) = stream.next().await {
        // `stop` aborts a reader that a newer send replaced. A user stop only
        // sets `stop_requested` and must keep reading until the server ends.
        if stop.load(Ordering::Relaxed) {
            return Err(HermesError::Cancelled);
        }
        let bytes = chunk.map_err(map_reqwest)?;
        for event in decoder.push(&bytes) {
            if stop.load(Ordering::Relaxed) {
                return Err(HermesError::Cancelled);
            }
            take(event);
        }
    }
    for event in decoder.finish() {
        if stop.load(Ordering::Relaxed) {
            return Err(HermesError::Cancelled);
        }
        take(event);
    }
    Ok(SseRead {
        terminal: saw_terminal,
        queued: saw_queued,
    })
}

fn direct_sse_end(read: &SseRead, stop: &AtomicBool, stop_requested: &AtomicBool) -> Result<(), HermesError> {
    if stop.load(Ordering::Relaxed) || (stop_requested.load(Ordering::Relaxed) && !read.terminal) {
        return Err(HermesError::Cancelled);
    }
    if !read.terminal {
        if read.queued {
            return Ok(());
        }
        return Err(HermesError::Protocol(
            "串流未有 run.completed / run.failed / run.cancelled 就結束".into(),
        ));
    }
    Ok(())
}

async fn finish_direct_sse<F>(
    resp: reqwest::Response,
    stop: &AtomicBool,
    stop_requested: &AtomicBool,
    on_event: F,
) -> Result<(), HermesError>
where
    F: FnMut(TurnEvent),
{
    let mut run_id = String::new();
    let mut streamed = false;
    let mut last_id = String::new();
    let read = read_sse_body(resp, stop, &mut run_id, &mut streamed, &mut last_id, on_event).await?;
    direct_sse_end(&read, stop, stop_requested)
}

/// Older gateways have no `/v1/runs`. 202 here is a queued chat admission with nothing left to read.
async fn stream_chat_turn<F>(
    http: &Client,
    root: &str,
    key: &str,
    session_id: &str,
    text: &str,
    stop: &AtomicBool,
    stop_requested: &AtomicBool,
    on_event: F,
) -> Result<(), HermesError>
where
    F: FnMut(TurnEvent),
{
    let url = format!("{root}/api/sessions/{session_id}/chat/stream");
    let resp = authed(
        http.post(&url).json(&serde_json::json!({
            "input": text,
            "message": text
        })),
        key,
    )
    .send()
    .await
    .map_err(map_reqwest)?;
    let status = resp.status();
    if !status.is_success() {
        let code = status.as_u16();
        let body = resp.text().await.unwrap_or_default();
        return Err(HermesError::Http {
            status: code,
            body: clip(&body, 400),
        });
    }
    if status.as_u16() == 202 {
        let _ = resp.bytes().await;
        return Ok(());
    }
    finish_direct_sse(resp, stop, stop_requested, on_event).await
}

async fn open_run_events(
    http: &Client,
    root: &str,
    key: &str,
    run_id: &str,
    last_id: &str,
) -> Result<reqwest::Response, HermesError> {
    let url = if last_id.is_empty() || !last_id.bytes().all(|byte| byte.is_ascii_digit()) {
        format!("{root}/v1/runs/{run_id}/events")
    } else {
        format!("{root}/v1/runs/{run_id}/events?last_seq={last_id}")
    };
    let mut builder = authed(http.get(&url), key).header(reqwest::header::ACCEPT, "text/event-stream");
    if !last_id.is_empty() {
        builder = builder.header("Last-Event-ID", last_id);
    }
    let resp = builder.send().await.map_err(map_reqwest)?;
    let status = resp.status();
    if status.is_success() {
        return Ok(resp);
    }
    let code = status.as_u16();
    let body = resp.text().await.unwrap_or_default();
    Err(HermesError::Http {
        status: code,
        body: clip(&body, 400),
    })
}

fn emit_one_control<F>(item: &Value, run_id: &mut String, streamed: &mut bool, on_event: &mut F)
where
    F: FnMut(TurnEvent),
{
    let mut payload = item.clone();
    let kind = json_text(payload.get("kind"));
    if json_text(payload.get("event")).is_empty() {
        let event = if kind == "clarify" {
            "clarify.request"
        } else if kind == "approval" {
            "approval.request"
        } else {
            ""
        };
        if event.is_empty() {
            return;
        }
        payload["event"] = Value::String(event.to_string());
    }
    if json_text(payload.get("run_id")).is_empty() && !run_id.is_empty() {
        payload["run_id"] = Value::String(run_id.clone());
    }
    let event = SseEvent {
        event: "message".into(),
        data: payload.to_string(),
        id: String::new(),
    };
    let mut terminal = false;
    let mut pending = None;
    apply_sse(event, streamed, &mut terminal, &mut pending, run_id, on_event);
}

fn snapshot_is_terminal(status: &str) -> bool {
    matches!(
        status,
        "completed" | "failed" | "cancelled" | "canceled" | "interrupted" | "expired"
    )
}

fn snapshot_outcome(status: &str) -> &'static str {
    match status {
        "failed" => "failed",
        "completed" => "completed",
        _ => "cancelled",
    }
}

enum RunFollow {
    Done,
    Live,
    Dark,
}

fn remember_control(seen: &mut HashSet<String>, event: &TurnEvent) {
    let id = match event {
        TurnEvent::ClarifyRequest { prompt_id, .. } => prompt_id.as_str(),
        TurnEvent::ApprovalRequest { request_id, .. } => request_id.as_str(),
        _ => "",
    };
    if !id.is_empty() {
        seen.insert(id.to_string());
    }
}

fn control_ids(item: &Value) -> Vec<String> {
    let mut ids = Vec::new();
    for key in ["prompt_id", "request_id"] {
        let id = json_text(item.get(key));
        if !id.is_empty() && !ids.iter().any(|have| have == &id) {
            ids.push(id);
        }
    }
    ids
}

fn run_still_open(status: &str, pending: bool) -> bool {
    pending
        || matches!(
            status,
            "started" | "running" | "queued" | "waiting_for_approval" | "stopping" | "accepted"
        )
}

async fn finish_open_run<F>(
    http: &Client,
    root: &str,
    key: &str,
    run_id: &str,
    streamed: bool,
    seen: &mut HashSet<String>,
    mut on_event: F,
) -> Result<RunFollow, HermesError>
where
    F: FnMut(TurnEvent),
{
    let value = fetch_run(http, root, key, run_id).await?;
    let mut streamed = streamed;
    let mut current = run_id.to_string();
    if let Some(controls) = value.get("pending_controls").and_then(Value::as_array) {
        for item in controls {
            let ids = control_ids(item);
            if ids.iter().any(|id| seen.contains(id)) {
                continue;
            }
            emit_one_control(item, &mut current, &mut streamed, &mut on_event);
            for id in ids {
                seen.insert(id);
            }
        }
    }
    let status = json_text(value.get("status"));
    let pending = value
        .get("pending_controls")
        .and_then(Value::as_array)
        .map(|items| !items.is_empty())
        .unwrap_or(false);
    if snapshot_is_terminal(&status) {
        let output = json_text(value.get("output"));
        if !streamed && !output.is_empty() {
            on_event(TurnEvent::Delta(plain_permission_detail(output)));
        }
        let detail = if status == "failed" {
            plain_permission_detail(clip(&json_text(value.get("error")), 400))
        } else {
            String::new()
        };
        on_event(TurnEvent::Finished {
            outcome: snapshot_outcome(&status).to_string(),
            detail,
            run_id: current,
        });
        return Ok(RunFollow::Done);
    }
    if run_still_open(&status, pending) {
        return Ok(RunFollow::Live);
    }
    Ok(RunFollow::Dark)
}

/// A user stop on a run that has already finished must not become a cancel.
/// The panel would flash 「已停止」 and then idle once the 409 snapshot lands.
async fn settle_user_stop<F>(
    http: &Client,
    root: &str,
    key: &str,
    run_id: &str,
    streamed: bool,
    seen: &mut HashSet<String>,
    on_event: &mut F,
) -> Result<(), HermesError>
where
    F: FnMut(TurnEvent),
{
    match finish_open_run(http, root, key, run_id, streamed, seen, on_event).await {
        Ok(RunFollow::Done) => Ok(()),
        _ => Err(HermesError::Cancelled),
    }
}

/// Events-SSE disconnect does not stop the run. Reconnect with backoff for
/// about a minute, and keep following a live run until it is terminal.
/// A newer send aborts this reader and must POST `/stop`.
async fn follow_run_events<F>(
    http: &Client,
    root: &str,
    key: &str,
    run_id: &str,
    stop: &AtomicBool,
    stop_requested: &AtomicBool,
    mut on_event: F,
) -> Result<(), HermesError>
where
    F: FnMut(TurnEvent),
{
    let mut last_id = String::new();
    let mut streamed = false;
    let mut current = run_id.to_string();
    let mut seen = HashSet::new();
    let mut outage: Option<Instant> = None;
    let mut pause = Duration::from_millis(40);
    loop {
        if stop.load(Ordering::Relaxed) && !stop_requested.load(Ordering::Relaxed) {
            let _ = stop_run(http, root, key, &current).await;
            return Err(HermesError::Cancelled);
        }
        if stop_requested.load(Ordering::Relaxed) {
            return settle_user_stop(
                http,
                root,
                key,
                &current,
                streamed,
                &mut seen,
                &mut on_event,
            )
            .await;
        }
        match open_run_events(http, root, key, &current, &last_id).await {
            Ok(resp) => {
                match read_sse_body(resp, stop, &mut current, &mut streamed, &mut last_id, |event| {
                    remember_control(&mut seen, &event);
                    on_event(event);
                })
                .await
                {
                    Err(HermesError::Cancelled) => {
                        if !stop_requested.load(Ordering::Relaxed) {
                            let _ = stop_run(http, root, key, &current).await;
                        }
                        return Err(HermesError::Cancelled);
                    }
                    Ok(read) if read.terminal => return Ok(()),
                    Ok(_)
                        if stop.load(Ordering::Relaxed)
                            && !stop_requested.load(Ordering::Relaxed) =>
                    {
                        let _ = stop_run(http, root, key, &current).await;
                        return Err(HermesError::Cancelled);
                    }
                    Ok(_) if stop_requested.load(Ordering::Relaxed) => {
                        return settle_user_stop(
                            http,
                            root,
                            key,
                            &current,
                            streamed,
                            &mut seen,
                            &mut on_event,
                        )
                        .await;
                    }
                    Ok(_) | Err(_) => {}
                }
            }
            Err(_) => {}
        }
        if stop.load(Ordering::Relaxed) && !stop_requested.load(Ordering::Relaxed) {
            let _ = stop_run(http, root, key, &current).await;
            return Err(HermesError::Cancelled);
        }
        if stop_requested.load(Ordering::Relaxed) {
            return settle_user_stop(
                http,
                root,
                key,
                &current,
                streamed,
                &mut seen,
                &mut on_event,
            )
            .await;
        }
        let elapsed = match outage {
            Some(start) => start.elapsed(),
            None => {
                outage = Some(Instant::now());
                Duration::ZERO
            }
        };
        match finish_open_run(http, root, key, &current, streamed, &mut seen, &mut on_event).await {
            Ok(RunFollow::Done) => return Ok(()),
            Ok(RunFollow::Live) => {
                outage = None;
            }
            Ok(RunFollow::Dark) | Err(_) => {
                if elapsed >= Duration::from_secs(60) {
                    return Err(HermesError::Protocol(
                        "串流未有 run.completed / run.failed / run.cancelled 就結束".into(),
                    ));
                }
            }
        }
        tokio::time::sleep(pause).await;
        pause = (pause * 2).min(Duration::from_secs(5));
    }
}

pub async fn stream_turn<F>(
    http: &Client,
    root: &str,
    key: &str,
    session_id: &str,
    text: &str,
    stop: &AtomicBool,
    stop_requested: &AtomicBool,
    mut on_event: F,
) -> Result<(), HermesError>
where
    F: FnMut(TurnEvent),
{
    // `clarify.request` is not forwarded on `/api/sessions/{id}/chat/stream` (0.22.5).
    // `/v1/runs` admits the same write gate, then the events stream carries clarify and approval.
    // 404 means an older gateway: fall back to chat/stream, including its queued 202.
    let url = format!("{root}/v1/runs");
    let resp = authed(
        http.post(&url).json(&serde_json::json!({
            "input": text,
            "session_id": session_id
        })),
        key,
    )
    .send()
    .await
    .map_err(map_reqwest)?;
    if resp.status().as_u16() == 404 {
        let _ = resp.bytes().await;
        return stream_chat_turn(
            http,
            root,
            key,
            session_id,
            text,
            stop,
            stop_requested,
            on_event,
        )
        .await;
    }
    let status = resp.status();
    if !status.is_success() {
        let code = status.as_u16();
        let body = resp.text().await.unwrap_or_default();
        return Err(HermesError::Http {
            status: code,
            body: clip(&body, 400),
        });
    }
    if is_event_stream(&resp) {
        return finish_direct_sse(resp, stop, stop_requested, on_event).await;
    }
    let bytes = resp.bytes().await.map_err(map_reqwest)?;
    let parsed: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    let run_id = json_text(parsed.get("run_id"));
    if approval_run_id(&run_id).is_none() {
        return Err(HermesError::Protocol(
            "POST /v1/runs 冇有效 run_id".into(),
        ));
    }
    on_event(TurnEvent::Started {
        run_id: run_id.clone(),
    });
    follow_run_events(
        http,
        root,
        key,
        &run_id,
        stop,
        stop_requested,
        on_event,
    )
    .await
}

fn apply_sse<F>(
    event: SseEvent,
    streamed: &mut bool,
    saw_terminal: &mut bool,
    pending_failure: &mut Option<String>,
    run_id: &mut String,
    on_event: &mut F,
) -> bool
where
    F: FnMut(TurnEvent),
{
    let payload: Value = serde_json::from_str(&event.data).unwrap_or(Value::Null);
    let name = sse_name(&event);
    match name.as_str() {
        "run.started" => {
            let incoming = json_text(payload.get("run_id"));
            if !incoming.is_empty() {
                *run_id = incoming;
            }
            on_event(TurnEvent::Started {
                run_id: run_id.clone(),
            });
            false
        }
        "assistant.delta" => {
            let text = payload
                .get("delta")
                .or_else(|| payload.get("text"))
                .and_then(Value::as_str)
                .unwrap_or("");
            if !text.is_empty() {
                *streamed = true;
                *pending_failure = None;
                on_event(TurnEvent::Delta(plain_permission_detail(text.to_string())));
            }
            false
        }
        "assistant.completed" => {
            let text = content_to_text(payload.get("content").unwrap_or(&Value::Null));
            let completed = payload.get("completed").and_then(Value::as_bool);
            if completed == Some(false) {
                if !text.trim().is_empty() {
                    *pending_failure = Some(text);
                }
                return false;
            }
            if !*streamed && !text.is_empty() {
                *streamed = true;
                *pending_failure = None;
                on_event(TurnEvent::Delta(plain_permission_detail(text)));
            }
            false
        }
        "assistant.commentary" => {
            let text = payload
                .get("text")
                .or_else(|| payload.get("delta"))
                .and_then(Value::as_str)
                .unwrap_or("");
            if !text.is_empty() {
                on_event(TurnEvent::Commentary(plain_permission_detail(text.to_string())));
            }
            false
        }
        "tool.started" | "tool.completed" | "tool.failed" | "tool.progress" => {
            let phase = name
                .strip_prefix("tool.")
                .unwrap_or("started")
                .to_string();
            let name = tool_name(&payload);
            let preview = preview_text(&payload);
            let preview = if text_is_execute_code_blocked(&preview)
                || text_is_execute_code_blocked(&format!("{name} {preview}"))
            {
                execute_code_blocked_line().to_string()
            } else {
                preview
            };
            on_event(TurnEvent::Tool {
                phase,
                name,
                preview,
            });
            false
        }
        "approval.request" => {
            let incoming = json_text(payload.get("run_id"));
            if !incoming.is_empty() {
                *run_id = incoming;
            }
            let request_id = {
                let id = json_text(payload.get("request_id"));
                if id.is_empty() {
                    json_text(payload.get("prompt_id"))
                } else {
                    id
                }
            };
            on_event(TurnEvent::ApprovalRequest {
                run_id: run_id.clone(),
                request_id,
                description: clip(&json_text(payload.get("description")), 500),
                command: clip(&json_text(payload.get("command")), 2000),
                execution_generation: payload.get("execution_generation").and_then(Value::as_i64),
            });
            false
        }
        "clarify.request" => {
            let incoming = json_text(payload.get("run_id"));
            if !incoming.is_empty() {
                *run_id = incoming;
            }
            let prompt_id = {
                let id = json_text(payload.get("prompt_id"));
                if id.is_empty() {
                    json_text(payload.get("request_id"))
                } else {
                    id
                }
            };
            let choices = payload
                .get("choices")
                .and_then(Value::as_array)
                .map(|items| {
                    items
                        .iter()
                        .filter_map(|item| item.as_str().map(str::to_string))
                        .collect()
                })
                .unwrap_or_default();
            let timeout_s = payload.get("timeout_s").and_then(|value| {
                value
                    .as_u64()
                    .or_else(|| value.as_i64().and_then(|n| u64::try_from(n).ok()))
            });
            on_event(TurnEvent::ClarifyRequest {
                run_id: run_id.clone(),
                prompt_id,
                question: clip(&json_text(payload.get("question")), 2000),
                choices,
                multi_select: payload
                    .get("multi_select")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
                execution_generation: payload
                    .get("execution_generation")
                    .and_then(Value::as_i64)
                    .unwrap_or(0),
                timeout_s,
            });
            false
        }
        "approval.settled" | "clarify.settled" => {
            let prompt_id = {
                let id = json_text(payload.get("prompt_id"));
                if id.is_empty() {
                    json_text(payload.get("request_id"))
                } else {
                    id
                }
            };
            on_event(TurnEvent::ControlSettled {
                kind: if name.starts_with("approval") {
                    "approval".to_string()
                } else {
                    "clarify".to_string()
                },
                prompt_id,
            });
            false
        }
        "approval.responded" => {
            on_event(TurnEvent::ApprovalResponded {
                request_id: json_text(payload.get("request_id")),
                choice: json_text(payload.get("choice")),
            });
            false
        }
        "run.completed" => {
            let output = json_text(payload.get("output"));
            if !*streamed && !output.is_empty() {
                *streamed = true;
                *pending_failure = None;
                on_event(TurnEvent::Delta(plain_permission_detail(output)));
            }
            *saw_terminal = true;
            on_event(TurnEvent::Finished {
                outcome: "completed".into(),
                detail: String::new(),
                run_id: finished_run_id(&payload, run_id),
            });
            true
        }
        "run.failed" => {
            *saw_terminal = true;
            let detail = failure_detail(&payload, pending_failure.as_deref());
            on_event(TurnEvent::Finished {
                outcome: "failed".into(),
                detail,
                run_id: finished_run_id(&payload, run_id),
            });
            true
        }
        "run.cancelled" => {
            *saw_terminal = true;
            on_event(TurnEvent::Finished {
                outcome: "cancelled".into(),
                detail: String::new(),
                run_id: finished_run_id(&payload, run_id),
            });
            true
        }
        "error" => {
            *saw_terminal = true;
            let detail = payload
                .get("message")
                .or_else(|| payload.get("error"))
                .map(value_text)
                .unwrap_or_else(|| event.data.clone());
            on_event(TurnEvent::Finished {
                outcome: "failed".into(),
                detail: plain_permission_detail(clip(&detail, 400)),
                run_id: finished_run_id(&payload, run_id),
            });
            true
        }
        _ => false,
    }
}

fn finished_run_id(payload: &Value, current: &str) -> String {
    let named = json_text(payload.get("run_id"));
    if named.is_empty() {
        current.to_string()
    } else {
        named
    }
}

fn tool_name(payload: &Value) -> String {
    payload
        .get("tool_name")
        .or_else(|| payload.get("tool"))
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .unwrap_or("tool")
        .to_string()
}

fn preview_text(payload: &Value) -> String {
    if let Some(text) = payload.get("preview").and_then(Value::as_str) {
        return clip(text, 300);
    }
    match payload.get("preview") {
        Some(value) if !value.is_null() => clip(&value.to_string(), 300),
        _ => String::new(),
    }
}

fn value_text(value: &Value) -> String {
    match value {
        Value::String(text) => text.clone(),
        other => other.to_string(),
    }
}

fn failure_detail(payload: &Value, prior: Option<&str>) -> String {
    let mut parts = Vec::new();
    if let Some(prior) = prior.map(str::trim).filter(|text| !text.is_empty()) {
        parts.push(prior.to_string());
    }
    let failed_turn = payload
        .get("messages")
        .and_then(Value::as_array)
        .and_then(|messages| {
            messages.iter().rev().find(|item| {
                item.get("display_kind").and_then(Value::as_str) == Some("failed_turn")
            })
        });
    if let Some(item) = failed_turn {
        let text = content_to_text(item.get("content").unwrap_or(&Value::Null));
        let text = text.trim();
        if !text.is_empty() && parts.last().map(String::as_str) != Some(text) {
            parts.push(text.to_string());
        }
    } else if parts.is_empty() {
        let fallback = payload.get("error").map(value_text).unwrap_or_default();
        let fallback = fallback.trim();
        if !fallback.is_empty() && fallback != "null" {
            parts.push(fallback.to_string());
        }
    }
    plain_permission_detail(clip(&parts.join("\n\n"), 2000))
}

fn plain_permission_detail(text: String) -> String {
    if text_is_permission_denied(&text) {
        session_read_only_reason().to_string()
    } else if text_is_execute_code_blocked(&text) {
        execute_code_blocked_line().to_string()
    } else {
        text
    }
}

pub async fn submit_approval(
    http: &Client,
    root: &str,
    key: &str,
    run_id: &str,
    request_id: &str,
    choice: &str,
    execution_generation: Option<i64>,
) -> Result<(), HermesError> {
    let url = format!("{root}/v1/runs/{run_id}/approval");
    let mut body = serde_json::json!({
        "choice": choice,
        "request_id": request_id,
    });
    if let Some(generation) = execution_generation {
        body["execution_generation"] = serde_json::json!(generation);
    }
    let resp = authed(http.post(&url).json(&body), key)
        .send()
        .await
        .map_err(map_reqwest)?;
    let status = resp.status();
    if status.is_success() {
        let _ = resp.bytes().await;
        return Ok(());
    }
    let code = status.as_u16();
    let _ = resp.bytes().await;
    Err(HermesError::Http {
        status: code,
        body: String::new(),
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ClarifyOutcome {
    Resolved,
    AlreadyResolved,
    Stale,
}

fn text_is_stale_generation(text: &str) -> bool {
    text.to_ascii_lowercase().contains("stale_generation")
}

/// Authority clarify body is exactly `{request_id, execution_generation, answer}`.
/// The answer is not logged and is not kept on the error.
pub async fn submit_clarify(
    http: &Client,
    root: &str,
    key: &str,
    run_id: &str,
    request_id: &str,
    execution_generation: i64,
    answer: &str,
) -> Result<ClarifyOutcome, HermesError> {
    let url = format!("{root}/v1/runs/{run_id}/clarify");
    let resp = authed(
        http.post(&url).json(&serde_json::json!({
            "request_id": request_id,
            "execution_generation": execution_generation,
            "answer": answer,
        })),
        key,
    )
    .send()
    .await
    .map_err(map_reqwest)?;
    let status = resp.status();
    let body = resp.text().await.unwrap_or_default();
    if status.is_success() {
        let parsed: Value = serde_json::from_str(&body).unwrap_or(Value::Null);
        if json_text(parsed.get("status")) == "already_resolved" {
            return Ok(ClarifyOutcome::AlreadyResolved);
        }
        return Ok(ClarifyOutcome::Resolved);
    }
    let code = status.as_u16();
    if code == 409 && text_is_stale_generation(&body) {
        return Ok(ClarifyOutcome::Stale);
    }
    Err(HermesError::Http {
        status: code,
        body: String::new(),
    })
}

pub async fn fetch_run(
    http: &Client,
    root: &str,
    key: &str,
    run_id: &str,
) -> Result<Value, HermesError> {
    let url = format!("{root}/v1/runs/{run_id}");
    let resp = authed(http.get(&url), key)
        .send()
        .await
        .map_err(map_reqwest)?;
    let status = resp.status();
    if status.as_u16() == 404 {
        return Ok(serde_json::json!({
            "run_id": run_id,
            "status": "",
            "pending_controls": [],
        }));
    }
    if !status.is_success() {
        let code = status.as_u16();
        let _ = resp.bytes().await;
        return Err(HermesError::Http {
            status: code,
            body: String::new(),
        });
    }
    let bytes = resp.bytes().await.map_err(map_reqwest)?;
    Ok(serde_json::from_slice(&bytes).unwrap_or(Value::Null))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StopOutcome {
    Stopping,
    NotActive,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SteerOutcome {
    Joined,
    Rejected,
}

pub fn terminal_run_status(status: &str) -> bool {
    matches!(
        status,
        "completed" | "failed" | "cancelled" | "canceled" | "interrupted" | "expired"
    )
}

/// `POST /p/{profile}/v1/runs/{run_id}/stop` with no body.
/// 409 `run_not_active` (and an already-terminal 200) is [`StopOutcome::NotActive`].
pub async fn stop_run(
    http: &Client,
    root: &str,
    key: &str,
    run_id: &str,
) -> Result<StopOutcome, HermesError> {
    let url = format!("{root}/v1/runs/{run_id}/stop");
    let resp = authed(http.post(&url), key)
        .send()
        .await
        .map_err(map_reqwest)?;
    let status = resp.status();
    if status.is_success() {
        let bytes = resp.bytes().await.unwrap_or_default();
        let parsed: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
        let run_status = parsed.get("status").and_then(Value::as_str).unwrap_or("");
        if terminal_run_status(run_status) {
            return Ok(StopOutcome::NotActive);
        }
        return Ok(StopOutcome::Stopping);
    }
    let code = status.as_u16();
    let _ = resp.bytes().await;
    if code == 409 {
        return Ok(StopOutcome::NotActive);
    }
    Err(HermesError::Http {
        status: code,
        body: String::new(),
    })
}

/// `POST /p/{profile}/v1/runs/{run_id}/steer` with exactly `{"input": text}`.
/// 409 (`run_not_accepting_steer` or `steer_not_accepted`) is [`SteerOutcome::Rejected`].
pub async fn steer_run(
    http: &Client,
    root: &str,
    key: &str,
    run_id: &str,
    text: &str,
) -> Result<SteerOutcome, HermesError> {
    let url = format!("{root}/v1/runs/{run_id}/steer");
    let resp = authed(
        http.post(&url).json(&serde_json::json!({
            "input": text,
        })),
        key,
    )
    .send()
    .await
    .map_err(map_reqwest)?;
    let status = resp.status();
    let _ = resp.bytes().await;
    if status.is_success() {
        return Ok(SteerOutcome::Joined);
    }
    let code = status.as_u16();
    if code == 409 {
        return Ok(SteerOutcome::Rejected);
    }
    Err(HermesError::Http {
        status: code,
        body: String::new(),
    })
}

fn json_error_reason(body: &str) -> String {
    let trimmed = body.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    let Ok(value) = serde_json::from_str::<Value>(trimmed) else {
        if trimmed.starts_with('{') || trimmed.starts_with('[') {
            return String::new();
        }
        return clip(trimmed, 180);
    };
    reason_from_json(&value)
}

fn reason_from_json(value: &Value) -> String {
    if let Some(text) = value.as_str() {
        let text = text.trim();
        if text.is_empty() || text == "null" {
            return String::new();
        }
        return clip(text, 180);
    }
    let Some(obj) = value.as_object() else {
        return String::new();
    };
    for key in ["error", "message", "reason", "detail"] {
        if let Some(found) = obj.get(key) {
            let text = reason_from_json(found);
            if !text.is_empty() {
                return text;
            }
        }
    }
    String::new()
}

/// Copy for a rejected kanban move. 409/422 keep the plugin reason and drop raw JSON.
pub fn kanban_move_error(err: &HermesError) -> String {
    match err {
        HermesError::Http { status, body } => {
            let reason = json_error_reason(body);
            let rejected = matches!(*status, 400 | 409 | 422);
            if reason.is_empty() {
                if rejected {
                    format!("看板拒絕呢次移動（{status}）。")
                } else {
                    "看板更新失敗。".into()
                }
            } else if rejected {
                format!("看板拒絕呢次移動：{reason}")
            } else {
                format!("看板更新失敗：{reason}")
            }
        }
        HermesError::Protocol(msg) => format!("看板更新失敗：{msg}"),
        other => {
            let text = explain(other);
            if text.contains('{') {
                "看板更新失敗。".into()
            } else {
                text
            }
        }
    }
}

pub fn explain(err: &HermesError) -> String {
    match err {
        HermesError::Http { body, .. } if text_is_permission_denied(body) => {
            session_read_only_reason().into()
        }
        HermesError::Protocol(msg) if text_is_permission_denied(msg) => {
            session_read_only_reason().into()
        }
        HermesError::Http { status: 401, .. } => {
            "Gateway 拒絕金鑰（401）。請核對呢個 profile 嘅 API_SERVER_KEY。".into()
        }
        HermesError::Http { status: 403, .. } => "Gateway 拒絕存取（403）。".into(),
        HermesError::Http { status: 404, body } => format!(
            "找不到路徑（404）。具名 profile 需要 gateway.multiplex_profiles，或者填呢個 Bot 嘅專用位址。{body}"
        ),
        HermesError::Http { status: 429, .. } => "Gateway 太忙（429），稍後再試。".into(),
        HermesError::Http { status, body } => format!("Gateway 回應 {status}。{body}"),
        HermesError::Connect(_) => {
            "連唔到 Hermes gateway。請確認 gateway 已開，位址係設定入面嗰個（預設埠 8642）。".into()
        }
        HermesError::Timeout(_) => {
            "Hermes gateway 逾時。請確認 gateway 已開，位址係設定入面嗰個（預設埠 8642）。".into()
        }
        HermesError::Transport(_) => {
            "同 Hermes gateway 嘅連線中斷。請確認 gateway 已開，位址係設定入面嗰個（預設埠 8642）。"
                .into()
        }
        HermesError::Protocol(msg) => msg.clone(),
        HermesError::Cancelled => "已停止呢次回覆。".into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::sync::Arc;
    use std::thread;

    #[test]
    fn route_uses_profile_prefix_unless_default_or_dedicated() {
        assert_eq!(
            route_root("http://127.0.0.1:8642", "alice", ""),
            "http://127.0.0.1:8642/p/alice"
        );
        assert_eq!(
            route_root("http://127.0.0.1:8642/", "default", ""),
            "http://127.0.0.1:8642"
        );
        assert_eq!(
            route_root("http://127.0.0.1:8642", "alice", "http://127.0.0.1:8643/"),
            "http://127.0.0.1:8643"
        );
    }

    fn summary(id: &str, title: &str, last_active: f64) -> SessionSummary {
        summary_source(id, title, last_active, "api_server")
    }

    fn summary_source(id: &str, title: &str, last_active: f64, source: &str) -> SessionSummary {
        SessionSummary {
            id: id.into(),
            title: title.into(),
            hidden: None,
            last_active,
            preview: String::new(),
            source: source.into(),
            started_at: 0.0,
            message_count: None,
            delivery: false,
            parent_session_id: String::new(),
            archived: false,
        }
    }

    fn devon_chat(
        id: &str,
        source: &str,
        started_at: f64,
        last_active: f64,
        message_count: u64,
        preview: &str,
    ) -> SessionSummary {
        SessionSummary {
            id: id.into(),
            title: "Bot Chat".into(),
            hidden: Some(false),
            last_active,
            preview: preview.into(),
            source: source.into(),
            started_at,
            message_count: Some(message_count),
            delivery: false,
            parent_session_id: String::new(),
            archived: false,
        }
    }

    fn ui_message(role: &str, text: &str) -> UiMessage {
        UiMessage {
            role: role.into(),
            text: text.into(),
            tool_name: String::new(),
        }
    }

    #[test]
    fn cron_list_reads_schedule_enabled_and_running() {
        let parsed = parse_cron_list(&json!({
            "jobs": [{
                "id": "brief",
                "name": "每日摘要",
                "schedule": { "kind": "cron", "expr": "0 9 * * *", "display": "每日 09:00" },
                "enabled": true,
                "state": "running",
                "next_run_at": "2026-10-16T09:00:00Z"
            }, {
                "id": "quiet",
                "name": "停用",
                "schedule_display": "every 2h",
                "enabled": false,
                "state": "paused",
                "next_run_at": 1712000000,
                "last_run_at": "2026-10-15T10:00:00Z"
            }, {
                "id": "claimed",
                "name": "檢查測試",
                "schedule": { "kind": "cron", "expr": "*/30 * * * *" },
                "enabled": true,
                "state": "scheduled",
                "next_run_at": "2026-10-16T12:00:00Z",
                "latest_execution": {
                    "status": "claimed",
                    "started_at": "2026-10-16T11:30:00Z"
                }
            }, {
                "id": "done",
                "name": "上次先",
                "enabled": true,
                "state": "scheduled",
                "latest_execution": {
                    "status": "completed",
                    "finished_at": "2026-10-16T08:00:00Z",
                    "started_at": "2026-10-16T07:59:00Z"
                }
            }, {
                "id": "live",
                "name": "進行中",
                "enabled": true,
                "state": "scheduled",
                "fire_claim": { "at": "2026-10-16T12:00:00Z", "by": "host:abc" },
                "latest_execution": {
                    "status": "running",
                    "started_at": "2026-10-16T12:00:01Z"
                }
            }]
        }));
        assert!(!parsed.unavailable);
        assert_eq!(parsed.jobs.len(), 5);
        assert_eq!(parsed.jobs[0].schedule, "每日 09:00");
        assert!(parsed.jobs[0].running);
        assert!(parsed.jobs[0].enabled);
        assert_eq!(parsed.jobs[1].schedule, "every 2h");
        assert!(!parsed.jobs[1].enabled);
        assert!(!parsed.jobs[1].running);
        assert_eq!(parsed.jobs[1].next_run_at, "1712000000");
        assert_eq!(parsed.jobs[1].last_run_at, "2026-10-15T10:00:00Z");
        assert!(parsed.jobs[2].running);
        assert_eq!(parsed.jobs[2].schedule, "*/30 * * * *");
        assert_eq!(parsed.jobs[2].last_run_at, "2026-10-16T11:30:00Z");
        assert!(!parsed.jobs[3].running);
        assert_eq!(parsed.jobs[3].last_run_at, "2026-10-16T08:00:00Z");
        assert!(parsed.jobs[4].running);
        assert_eq!(parsed.jobs[4].last_run_at, "2026-10-16T12:00:01Z");
        assert_eq!(parsed.jobs[4].started_at, "2026-10-16T12:00:01Z");
        assert_eq!(parsed.jobs[2].started_at, "2026-10-16T11:30:00Z");
        assert_eq!(parsed.jobs[3].started_at, "");
        let claimed_at = parse_cron_list(&json!({
            "jobs": [{
                "id": "claim-time",
                "name": "只得 claim",
                "state": "scheduled",
                "latest_execution": { "status": "claimed", "claimed_at": "2026-10-16T12:00:00Z" }
            }]
        }));
        assert!(claimed_at.jobs[0].running);
        assert_eq!(claimed_at.jobs[0].started_at, "2026-10-16T12:00:00Z");
        let claimed_only = parse_cron_list(&json!({
            "jobs": [{
                "id": "fence",
                "name": "只靠 fire_claim",
                "state": "scheduled",
                "latest_execution": { "status": "completed", "fire_claim": "host:abc" }
            }]
        }));
        assert!(claimed_only.jobs[0].running);
        let missing = parse_cron_list(&json!({ "jobs": [], "cron_unavailable": true }));
        assert!(missing.unavailable);
        assert!(missing.jobs.is_empty());
        assert_eq!(
            cron_jobs_url("http://127.0.0.1:8642/"),
            "http://127.0.0.1:8642/api/jobs?include_disabled=true"
        );
        assert_eq!(
            cron_jobs_url("http://127.0.0.1:8642/p/coder"),
            "http://127.0.0.1:8642/p/coder/api/jobs?include_disabled=true"
        );
        assert_eq!(
            cron_legacy_url("http://127.0.0.1:8642/p/coder/"),
            "http://127.0.0.1:8642/p/coder/api/crons"
        );
        assert_eq!(cron_fetch_step(200, true), CronFetchStep::Parse);
        assert_eq!(cron_fetch_step(404, true), CronFetchStep::TryFallback);
        assert_eq!(cron_fetch_step(404, false), CronFetchStep::Unavailable);
        assert_eq!(cron_fetch_step(501, true), CronFetchStep::Unavailable);
        assert_eq!(cron_fetch_step(500, false), CronFetchStep::Error);
    }

    #[test]
    fn cron_job_keeps_last_status_error_for_the_frontend() {
        let parsed = parse_cron_list(&json!({
            "jobs": [{
                "id": "once",
                "name": "one-shot",
                "state": "completed",
                "last_status": "error",
                "last_error": "boom",
                "schedule": "once"
            }, {
                "id": "again",
                "name": "daily",
                "state": "scheduled",
                "last_status": "error",
                "last_error": "nope"
            }, {
                "id": "nested",
                "name": "from-exec",
                "state": "completed",
                "latest_execution": {
                    "status": "completed",
                    "last_status": "error",
                    "error": "nested"
                }
            }, {
                "id": "ok",
                "name": "recovered",
                "state": "scheduled",
                "last_status": "success",
                "last_error": "stale"
            }, {
                "id": "run",
                "name": "again-running",
                "state": "scheduled",
                "running": true,
                "last_status": "error",
                "last_error": "old",
                "latest_execution": { "status": "running" }
            }]
        }));
        let wire = serde_json::to_value(&parsed.jobs).unwrap();
        let jobs = wire.as_array().unwrap();
        assert_eq!(jobs[0]["state"], "completed");
        assert_eq!(jobs[0]["last_status"], "error");
        assert_eq!(jobs[0]["last_error"], "boom");
        assert_eq!(jobs[0]["running"], false);
        assert_eq!(jobs[1]["state"], "scheduled");
        assert_eq!(jobs[1]["last_status"], "error");
        assert_eq!(jobs[1]["last_error"], "nope");
        assert_eq!(jobs[2]["state"], "completed");
        assert_eq!(jobs[2]["status"], "completed");
        assert_eq!(jobs[2]["last_status"], "error");
        assert_eq!(jobs[2]["last_error"], "nested");
        assert_eq!(jobs[3]["last_status"], "success");
        assert_eq!(jobs[3]["last_error"], "stale");
        assert_eq!(jobs[4]["running"], true);
        assert_eq!(jobs[4]["last_status"], "error");
        assert_eq!(jobs[4]["last_error"], "old");
    }

    #[test]
    fn bot_chat_is_the_default_session() {
        let sessions = vec![
            summary("older", "Bot Chat", 50.0),
            summary("newer", "Bot Chat", 80.0),
            summary("split", "_splitLot", 10.0),
            summary("desktop", "System Architect", 200.0),
        ];
        assert_eq!(most_recent_session(&sessions).unwrap().id, "desktop");
        assert_eq!(most_recent_bot_chat(&sessions).unwrap().id, "newer");
        assert_eq!(canonical_bot_chat(&sessions).unwrap().id, "newer");
        let opened = resolve_session(&sessions, "split", false, 10.0).unwrap();
        assert_eq!(opened.id, "newer");
        assert!(!opened.explicit);
        assert_eq!(opened.anchor, 80.0);
        let pinned = resolve_session(&sessions, "split", true, 10.0).unwrap();
        assert_eq!(pinned.id, "split");
        assert!(pinned.explicit);
        assert_eq!(pinned.anchor, 10.0);
        let missing = resolve_session(&sessions, "gone", true, 1.0).unwrap();
        assert_eq!(missing.id, "newer");
        assert!(!missing.explicit);
        assert!(resolve_session(&[], "split", true, 1.0).is_none());
        let kept = session_for_startup(&sessions, "split", false, 10.0).unwrap();
        assert_eq!(kept.id, "newer");
        assert!(!kept.explicit);
        assert_eq!(kept.anchor, 80.0);
        assert_eq!(
            merge_session_anchor("split", 1792566430.7, "split", 0.0, 99.0),
            1792566430.7
        );
        assert_eq!(
            merge_session_anchor("split", 10.0, "split", 20.0, 99.0),
            10.0
        );
        assert_eq!(merge_session_anchor("split", 10.0, "", 0.0, 99.0), 0.0);
        assert_eq!(
            merge_session_anchor("split", 10.0, "other", 0.0, 99.0),
            10.0
        );
        assert_eq!(merge_session_anchor("split", 0.0, "split", 0.0, 99.0), 0.0);
        assert!(session_file_update("sess", true, 1792546080.05, "sess", true, 1792606967.10).is_none());
        assert!(session_file_update("sess", false, 1792546210.56, "sess", false, 1792607001.46).is_none());
        assert!(session_file_update("sess", true, 1792545967.28, "sess", true, 1792606891.45).is_none());
        let explicit = session_for_startup(&sessions, "desktop", true, 3.0).unwrap();
        assert_eq!(explicit.id, "desktop");
        assert!(explicit.explicit);
        assert_eq!(explicit.anchor, 3.0);
        assert_eq!(
            session_for_startup(&sessions, "", false, 0.0).unwrap().id,
            "newer"
        );
        assert_eq!(
            session_for_startup(&sessions, "missing", false, 1.0)
                .unwrap()
                .id,
            "newer"
        );
        assert!(session_for_startup(&[], "split", true, 1.0).is_none());
        let tied = vec![summary("b", "Bot Chat", 5.0), summary("a", "Bot Chat", 5.0)];
        assert_eq!(resolve_session(&tied, "", false, 0.0).unwrap().id, "a");
        let plain = vec![
            summary("desktop", "System Architect", 99.0),
            summary("split", "_splitLot", 10.0),
        ];
        assert!(resolve_session(&plain, "", false, 0.0).is_none());
        assert!(session_for_startup(&plain, "", false, 0.0).is_none());
        assert_eq!(
            session_menu_order(&sessions)
                .into_iter()
                .map(|session| session.id.as_str())
                .collect::<Vec<_>>(),
            vec!["newer", "older", "desktop", "split"]
        );
        let tui = summary_source("tui-chat", "Bot Chat", 500.0, "tui");
        let desktop_chat = summary_source("desk-chat", "Bot Chat", 40.0, "desktop");
        let mixed = vec![
            tui.clone(),
            desktop_chat,
            summary_source("notes", "Notes", 900.0, "cli"),
        ];
        assert_eq!(most_recent_bot_chat(&mixed).unwrap().id, "desk-chat");
        let desk_open = resolve_session(&mixed, "", false, 0.0).unwrap();
        assert_eq!(desk_open.id, "desk-chat");
        assert!(desk_open.read_only);
        assert_eq!(desk_open.read_only_reason, session_read_only_reason());
        let picked_tui = resolve_session(&mixed, "tui-chat", true, 1.0).unwrap();
        assert_eq!(picked_tui.id, "tui-chat");
        assert!(picked_tui.explicit);
        assert!(most_recent_bot_chat(&[tui.clone()]).is_none());
        assert_eq!(canonical_bot_chat(&[tui.clone()]).unwrap().id, "tui-chat");
        let tui_open = session_for_startup(&[tui.clone()], "", false, 0.0).unwrap();
        assert_eq!(tui_open.id, "tui-chat");
        assert!(tui_open.read_only);
        assert_eq!(
            fallback_session(&[tui.clone()]).map(|session| session.id.as_str()),
            None
        );
        assert_eq!(fallback_session(&mixed).unwrap().id, "notes");
        assert_eq!(
            fallback_session(&[
                tui.clone(),
                summary_source("desk-only", "Bot Chat", 40.0, "desktop"),
            ])
            .unwrap()
            .id,
            "desk-only"
        );
        assert_eq!(
            session_menu_order(&mixed)
                .into_iter()
                .map(|session| session.id.as_str())
                .collect::<Vec<_>>(),
            vec!["tui-chat", "desk-chat", "notes"]
        );
        let conflict = "Title 'Bot Chat' is already in use by session tui-chat";
        assert_eq!(adopt_title_conflict(&mixed, conflict).as_deref(), Some("tui-chat"));
        let ours = "Title 'Bot Chat' is already in use by session desk-chat";
        assert_eq!(
            adopt_title_conflict(&mixed, ours).as_deref(),
            Some("desk-chat")
        );
        let hidden = "Title 'Bot Chat' is already in use by session api_hidden";
        assert_eq!(
            adopt_title_conflict(&mixed, hidden).as_deref(),
            Some("api_hidden")
        );
        let parsed = parse_session_list(&json!({
            "data": [
                {"id": "t", "title": "Bot Chat", "source": "tui", "last_active": 3},
                {"id": "a", "title": "Bot Chat", "source": "api_server", "last_active": 1}
            ]
        }));
        assert_eq!(parsed[0].source, "tui");
        assert_eq!(most_recent_bot_chat(&parsed).unwrap().id, "a");
        let seen = vec![ui_message("user", "hi")];
        let next = vec![ui_message("user", "hi"), ui_message("bot", "cron")];
        assert_eq!(fresh_messages(&seen, &next).unwrap(), &next[1..]);
        assert!(fresh_messages(&next, &seen).is_none());
        assert!(fresh_messages(&seen, &seen).unwrap().is_empty());
    }

    /// A saved id that still exists stays. A missing id falls through to the
    /// canonical Bot Chat. Opening cannot create a session.
    #[test]
    fn startup_and_panel_open_resolve_to_bot_chat_without_creating() {
        let sessions = vec![
            summary("saved-forex", "Forex notes", 10.0),
            summary("mt-coder", "Coder notes", 30.0),
            summary("mt-reviewer", "Review notes", 20.0),
            summary("mt-tester", "Tester notes", 15.0),
            summary("newest", "System Architect", 900.0),
            summary_source("tui-latest", "Bot Chat", 5000.0, "tui"),
            summary("bot-chat", "Bot Chat", 40.0),
        ];
        let saved = [
            ("saved-forex", false, 0.0),
            ("mt-coder", false, 0.0),
            ("mt-reviewer", true, 20.0),
            ("mt-tester", false, 0.0),
            ("newest", true, 900.0),
            ("missing-id", true, 1.0),
            ("", false, 0.0),
            ("bot-chat", true, 0.0),
        ];
        for (id, explicit, anchor) in saved {
            let opened = session_for_startup(&sessions, id, explicit, anchor)
                .unwrap_or_else(|| panic!("open {id}"));
            if explicit && id != "missing-id" {
                assert_eq!(opened.id, id, "{id}");
                assert_eq!(opened.explicit, true, "{id}");
                assert_eq!(opened.anchor, anchor, "{id}");
            } else {
                assert_eq!(opened.id, "bot-chat", "{id}");
                assert!(!opened.explicit, "{id}");
                assert_eq!(opened.anchor, 40.0, "{id}");
            }
        }
        let plain = vec![
            summary("desktop", "System Architect", 99.0),
            summary_source("tui-chat", "Bot Chat", 800.0, "tui"),
        ];
        let kept_desktop = session_for_startup(&plain, "desktop", true, 0.0).unwrap();
        assert_eq!(kept_desktop.id, "desktop");
        assert!(kept_desktop.explicit);
        assert!(!kept_desktop.read_only);
        let tui_only = session_for_startup(&plain, "", false, 0.0).unwrap();
        assert_eq!(tui_only.id, "tui-chat");
        assert!(tui_only.read_only);
        assert!(session_for_startup(
            &[summary("desktop", "System Architect", 99.0)],
            "",
            false,
            0.0
        )
        .is_none());
        assert!(session_for_startup(&[], "saved-forex", true, 1.0).is_none());
        let open_src = include_str!("lib.rs");
        let start = open_src.find("async fn open_bot").expect("open_bot");
        let end = open_src
            .find("async fn select_session")
            .expect("select_session");
        let open = &open_src[start..end];
        assert!(open.contains("session_for_startup"));
        assert!(open.contains("remember_pin_if_absent"));
        assert!(!open.contains("remember_pin("));
        assert!(!open.contains("ensure_bot_chat"));
        assert!(!open.contains("create_bot_chat"));
        assert!(!open.contains("create_session"));
        assert!(!open.contains("config::save"));
        let absent_at = open_src.find("fn remember_pin_if_absent").expect("absent");
        let absent_end = open_src.find("fn active_session").expect("active_session");
        let absent = &open_src[absent_at..absent_end];
        assert!(!absent.contains("remember_pin("));
        assert!(!absent.contains("persist_pin"));
        assert!(!absent.contains("config::save"));
        let pin_at = open_src.find("fn persist_pin").expect("persist_pin");
        let pin_end = open_src.find("fn session_choices").expect("session_choices");
        let pin_body = &open_src[pin_at..pin_end];
        assert!(pin_body.contains("session_file_update"));
        assert!(!pin_body.contains("merge_session_anchor"));
    }

    #[test]
    fn opening_a_configured_session_leaves_config_bytes_unchanged() {
        use crate::config::{load, save, AppConfig, BotConfig, InteractionConfig};
        let dir = std::env::temp_dir().join(format!(
            "hermes-overlay-open-bytes-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("config.json");
        let bot = |profile: &str, id: &str, explicit: bool, anchor: f64| BotConfig {
            profile: profile.into(),
            display_name: profile.into(),
            color: String::new(),
            base_url: String::new(),
            detail: String::new(),
            session_id: id.into(),
            session_explicit: explicit,
            session_anchor: anchor,
            enabled: true,
        };
        let cfg = AppConfig {
            version: 1,
            gateway_base_url: "http://127.0.0.1:8642".into(),
            dashboard_base_url: "http://127.0.0.1:9119".into(),
            kanban_base_url: String::new(),
            kanban_board: String::new(),
            show_bot_names: false,
            bots: vec![
                bot("researcher", "20261015_researcher", true, 1792546080.05),
                bot("writer", "20261015_writer", true, 1792546210.56),
                bot("broken", "20261015_broken", false, 1792545967.28),
            ],
            interaction: InteractionConfig::default(),
        };
        save(&path, &cfg).unwrap();
        let before = std::fs::read(&path).unwrap();
        let loaded = load(&path).unwrap();
        for (profile, next_anchor) in [
            ("researcher", 1792606967.10),
            ("writer", 1792607001.46),
            ("broken", 1792606891.45),
        ] {
            let row = loaded.bot(profile).unwrap();
            assert!(
                session_file_update(
                    &row.session_id,
                    row.session_explicit,
                    row.session_anchor,
                    &row.session_id,
                    row.session_explicit,
                    next_anchor,
                )
                .is_none(),
                "{profile}"
            );
        }
        assert_eq!(std::fs::read(&path).unwrap(), before);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Devon 2026-10-21, read from the laptop and the server.
    /// forex-forest's only Bot Chat is the tui row `20261001_013827_25b1eb`.
    /// mt-coder and mt-tester: e3db750 minted an empty `api_1792573589_*` at
    /// 10:06; cron is delivered into the older chat that has history.
    #[test]
    fn canonical_bot_chat_uses_devon_sessions() {
        let forex = vec![devon_chat(
            "20261001_013827_25b1eb",
            "tui",
            1759279107.0,
            1792500000.0,
            18,
            "forex note",
        )];
        let opened = session_for_startup(&forex, "saved-other", true, 0.0).unwrap();
        assert_eq!(opened.id, "20261001_013827_25b1eb");
        assert!(opened.read_only);
        assert_eq!(opened.read_only_reason, session_read_only_reason());
        assert_eq!(
            session_read_only_reason(),
            "呢個 session 係喺 CLI／Desktop 開嘅，只可以睇，唔可以喺呢度傳嘢"
        );
        assert!(is_tui_source("tui"));
        assert!(!is_tui_source("api_server"));
        assert!(!is_tui_source("desktop"));
        assert!(session_read_only("desktop"));
        assert!(!session_read_only("api_server"));

        for (profile, empty_id) in [
            ("mt-coder", "api_1792573589_f1c99a3b"),
            ("mt-tester", "api_1792573589_257658b2"),
        ] {
            let mut chat = devon_chat(empty_id, "api_server", 1792573589.0, 1792573600.0, 0, "");
            chat.hidden = Some(true);
            let mut retired = summary(&format!("{profile}-retired"), "", 1.0);
            retired.archived = true;
            retired.hidden = Some(true);
            let sessions = vec![
                retired,
                chat,
                summary("notes", "Notes", 1792579999.0),
            ];
            let opened = session_for_startup(&sessions, &format!("{profile}-retired"), false, 1.0)
                .unwrap();
            assert_eq!(opened.id, empty_id, "{profile}");
            assert!(!opened.read_only, "{profile}");
            assert!(!opened.explicit, "{profile}");
            let explicit_empty = session_for_startup(&sessions, empty_id, true, 1792573600.0).unwrap();
            assert_eq!(explicit_empty.id, empty_id, "{profile}");
            assert!(explicit_empty.explicit, "{profile}");
            assert!(stored_pin_after_resolve(
                &format!("{profile}-retired"),
                false,
                1.0,
                empty_id,
                false,
                1.0
            )
            .is_none());
            assert_eq!(canonical_bot_chat(&sessions).unwrap().id, empty_id);
        }

        let mut ff_other = devon_chat(
            "20261013_180130_88f994",
            "desktop",
            1791914490.0,
            1792500000.0,
            373,
            "判斷截圖顯示嘅問題",
        );
        ff_other.title = "判斷截圖顯示嘅問題".into();
        let mut ff_chat = devon_chat(
            "api_1792573589_0c14ed12",
            "api_server",
            1792573589.0,
            1792573600.0,
            387,
            "ff",
        );
        ff_chat.hidden = Some(true);
        let ff_daily = vec![ff_other, ff_chat];
        let ff_opened =
            session_for_startup(&ff_daily, "20261013_180130_88f994", false, 1791914490.0).unwrap();
        assert_eq!(ff_opened.id, "api_1792573589_0c14ed12");
        assert!(!ff_opened.read_only);
        assert!(stored_pin_after_resolve(
            "20261013_180130_88f994",
            false,
            1791914490.0,
            "api_1792573589_0c14ed12",
            false,
            1792573600.0
        )
        .is_none());
        assert_eq!(
            canonical_bot_chat(&ff_daily).unwrap().id,
            "api_1792573589_0c14ed12"
        );

        let mut leased = devon_chat(
            "desk-real",
            "desktop",
            1758000000.0,
            1792000000.0,
            9,
            "leased",
        );
        leased.delivery = true;
        leased.hidden = Some(true);
        let with_lease = vec![
            devon_chat(
                "api_1792573589_empty",
                "api_server",
                1792573589.0,
                1792573700.0,
                0,
                "",
            ),
            leased,
        ];
        assert_eq!(canonical_bot_chat(&with_lease).unwrap().id, "desk-real");

        let mut empty_lease = devon_chat(
            "api_1792573589_lease",
            "api_server",
            1792573589.0,
            1792573700.0,
            0,
            "",
        );
        empty_lease.delivery = true;
        empty_lease.hidden = Some(true);
        let ignore_empty_lease = vec![
            empty_lease,
            devon_chat(
                "desk-real",
                "desktop",
                1758000000.0,
                1792000000.0,
                9,
                "history",
            ),
        ];
        assert_eq!(
            canonical_bot_chat(&ignore_empty_lease).unwrap().id,
            "api_1792573589_lease"
        );

        let parsed = parse_session_list(&json!({
            "canonical_session": {"id": "20261001_013827_25b1eb"},
            "data": [
                {
                    "id": "api_1792573589_empty",
                    "title": "Bot Chat",
                    "source": "api_server",
                    "started_at": 1792573589.0,
                    "last_active": 1792573600.0,
                    "message_count": 0,
                    "preview": ""
                },
                {
                    "id": "20261001_013827_25b1eb",
                    "title": "Bot Chat",
                    "source": "tui",
                    "started_at": 1759279107.0,
                    "last_active": 1792400000.0,
                    "message_count": 18,
                    "preview": "forex"
                }
            ]
        }));
        assert!(parsed
            .iter()
            .any(|session| session.id == "20261001_013827_25b1eb" && session.delivery));
        assert_eq!(
            canonical_bot_chat(&parsed).unwrap().id,
            "20261001_013827_25b1eb"
        );
        assert_eq!(
            parsed
                .iter()
                .find(|session| session.id == "api_1792573589_empty")
                .unwrap()
                .message_count,
            Some(0)
        );

        let lib = include_str!("lib.rs");
        let send_start = lib.find("async fn send_chat").expect("send_chat");
        let send_end = lib.find("fn dispatch_turn").expect("dispatch_turn");
        let send = &lib[send_start..send_end];
        assert!(!send.contains("create_bot_chat"));
        assert!(!send.contains("create_session"));
        let send_head = &send[..send.find("status: 404").expect("404")];
        assert!(!send_head.contains("persist_pin"));
        let client_start = lib
            .find("async fn session_for_client")
            .expect("session_for_client");
        let client_end = lib.find("async fn pin_explicit").expect("pin_explicit");
        let client = &lib[client_start..client_end];
        assert!(!client.contains("create_bot_chat"));
        assert!(!client.contains("create_session"));
        assert!(client.contains("remember_pin_if_absent"));
        assert!(!client.contains("remember_pin("));
    }

    /// Devon 2026-10-22 laptop check of 11a150e. Config and explicit picks
    /// stay. An empty `api_` Bot Chat loses to a non-empty one. A reconnect
    /// does not rewrite a session id that is already stored.
    #[test]
    fn laptop_session_check_keeps_configured_and_explicit_rows() {
        let forex = vec![devon_chat(
            "20261001_013827_25b1eb",
            "tui",
            1759279107.0,
            1792500000.0,
            2312,
            "forex",
        )];
        let forest = session_for_startup(&forex, "20261001_013827_25b1eb", false, 1759279107.0)
            .unwrap();
        assert_eq!(forest.id, "20261001_013827_25b1eb");
        assert!(forest.read_only);
        assert_eq!(forest.anchor, 1759279107.0);
        assert!(stored_pin_after_resolve(
            "20261001_013827_25b1eb",
            false,
            1759279107.0,
            "20261001_013827_25b1eb",
            false,
            1792500000.0
        )
        .is_none());

        let mut orch_pick = devon_chat(
            "20261015_011713_2242f9",
            "desktop",
            1791910000.0,
            1792000000.0,
            40,
            "devon pick",
        );
        orch_pick.title = "Bot Chat".into();
        let orch_wrong = devon_chat(
            "20261020_231552_1372e7",
            "api_server",
            1792570000.0,
            1792571000.0,
            3,
            "later",
        );
        let orch = vec![orch_wrong, orch_pick];
        let orch_open =
            session_for_startup(&orch, "20261015_011713_2242f9", true, 1791910000.0).unwrap();
        assert_eq!(orch_open.id, "20261015_011713_2242f9");
        assert!(orch_open.explicit);
        assert!(orch_open.read_only);
        assert_eq!(orch_open.read_only_reason, session_read_only_reason());
        assert_eq!(orch_open.anchor, 1791910000.0);
        assert!(stored_pin_after_resolve(
            "20261015_011713_2242f9",
            true,
            1791910000.0,
            "20261020_231552_1372e7",
            false,
            1792571000.0
        )
        .is_none());

        let mut ff_real = devon_chat(
            "20261013_180130_88f994",
            "desktop",
            1791914490.0,
            1792500000.0,
            373,
            "判斷截圖顯示嘅問題",
        );
        ff_real.title = "判斷截圖顯示嘅問題".into();
        let ff_empty = devon_chat(
            "api_1792573589_0c14ed12",
            "api_server",
            1792573589.0,
            1792573600.0,
            0,
            "",
        );
        let ff_daily = vec![ff_empty, ff_real];
        assert_eq!(
            canonical_bot_chat(&ff_daily).unwrap().id,
            "api_1792573589_0c14ed12"
        );
        let ff_open =
            session_for_startup(&ff_daily, "20261013_180130_88f994", false, 1791914490.0).unwrap();
        assert_eq!(ff_open.id, "api_1792573589_0c14ed12");
        assert!(!ff_open.explicit);
        assert!(!ff_open.read_only);
        assert_eq!(ff_open.anchor, 1792573600.0);
        assert!(stored_pin_after_resolve(
            "20261013_180130_88f994",
            false,
            1791914490.0,
            "api_1792573589_0c14ed12",
            false,
            1792573600.0
        )
        .is_none());

        let mut coder_real = devon_chat(
            "20261012_mtcoder",
            "desktop",
            1758000000.0,
            1792400000.0,
            42,
            "coder",
        );
        coder_real.title = "Coder notes".into();
        let mut coder_chat = devon_chat(
            "api_1792573589_f1c99a3b",
            "api_server",
            1792573589.0,
            1792573600.0,
            0,
            "",
        );
        coder_chat.hidden = Some(true);
        let coder = vec![coder_real, coder_chat];
        assert_eq!(
            session_for_startup(&coder, "api_1792573589_f1c99a3b", false, 1792573600.0)
                .unwrap()
                .id,
            "api_1792573589_f1c99a3b"
        );
        assert!(stored_pin_after_resolve(
            "api_1792573589_f1c99a3b",
            false,
            1792573600.0,
            "20261012_mtcoder",
            false,
            1792400000.0
        )
        .is_none());

        let reviewer_only = vec![devon_chat(
            "api_1792573589_b1b8ccc5",
            "api_server",
            1792573589.0,
            1792573600.0,
            0,
            "",
        )];
        assert_eq!(
            session_for_startup(&reviewer_only, "api_1792573589_b1b8ccc5", false, 1792573600.0)
                .unwrap()
                .id,
            "api_1792573589_b1b8ccc5"
        );

        let mut tester_empty = devon_chat(
            "api_1792573589_257658b2",
            "api_server",
            1792574000.0,
            1792574100.0,
            0,
            "",
        );
        tester_empty.hidden = Some(true);
        let mut tester_desktop = devon_chat(
            "20260901_mttester",
            "desktop",
            1750000000.0,
            1750001000.0,
            0,
            "",
        );
        tester_desktop.title = "Tester notes".into();
        let tester = vec![tester_empty.clone(), tester_desktop];
        assert_eq!(
            canonical_bot_chat(&tester).unwrap().id,
            "api_1792573589_257658b2"
        );
        assert_eq!(
            session_for_startup(&tester, "", false, 0.0).unwrap().id,
            "api_1792573589_257658b2"
        );
        let filled = stored_pin_after_resolve("", false, 0.0, "20260901_mttester", false, 1750001000.0)
            .unwrap();
        assert_eq!(filled.0, "20260901_mttester");
        assert!(!filled.1);
        assert_eq!(filled.2, 1750001000.0);
        let kept_anchor = stored_pin_after_resolve("", true, 42.0, "20260901_mttester", false, 9.0)
            .unwrap();
        assert!(kept_anchor.1);
        assert_eq!(kept_anchor.2, 42.0);

        let mut few = devon_chat("few", "desktop", 1.0, 500.0, 2, "a");
        few.hidden = Some(false);
        let mut many = devon_chat("many", "tui", 1.0, 100.0, 80, "b");
        many.hidden = Some(true);
        many.message_count = Some(0);
        many.preview.clear();
        let busier = vec![few, many];
        assert_eq!(canonical_bot_chat(&busier).unwrap().id, "many");

        let counted = parse_session_list(&json!({
            "data": [
                {
                    "id": "by-count",
                    "title": "Bot Chat",
                    "messageCount": 4,
                    "messages": [{"role": "user"}]
                },
                {
                    "id": "by-list",
                    "title": "Bot Chat",
                    "messages": [{"role": "user"}, {"role": "assistant"}]
                },
                {
                    "id": "zero-with-list",
                    "title": "Bot Chat",
                    "message_count": 0,
                    "messages": [{"role": "user"}, {"role": "assistant"}, {"role": "user"}]
                }
            ]
        }));
        assert_eq!(counted[0].message_count, Some(4));
        assert_eq!(counted[1].message_count, Some(2));
        assert_eq!(counted[2].message_count, Some(3));
    }

    /// Devon 2026-10-22. Desktop's Bot Chat is the hidden exact-title row.
    /// A continuation child in the list is not followed. Explicit wins.
    /// Config is not rewritten.
    #[test]
    fn desktop_bot_chat_follows_the_titled_row_and_its_tip() {
        let mut forex = devon_chat(
            "20261001_013827_25b1eb",
            "tui",
            1759279107.0,
            1792500000.0,
            2312,
            "forex",
        );
        forex.hidden = Some(true);
        let forest = session_for_startup(&[forex], "", false, 0.0).unwrap();
        assert_eq!(forest.id, "20261001_013827_25b1eb");
        assert!(forest.read_only);

        let mut ff_chat = devon_chat(
            "api_1792573589_0c14ed12",
            "api_server",
            1792573589.0,
            1792574000.0,
            387,
            "daily",
        );
        ff_chat.hidden = Some(true);
        let mut ff_saved = summary("20261013_180130_88f994", "判斷截圖顯示嘅問題", 1792500000.0);
        ff_saved.source = "desktop".into();
        ff_saved.message_count = Some(373);
        let ff = vec![ff_saved, ff_chat, summary("newest-ff", "Describe uploaded image", 1792600000.0)];
        let ff_open = session_for_startup(&ff, "20261013_180130_88f994", false, 1791914490.0).unwrap();
        assert_eq!(ff_open.id, "api_1792573589_0c14ed12");
        assert!(!ff_open.explicit);
        assert!(stored_pin_after_resolve(
            "20261013_180130_88f994",
            false,
            1791914490.0,
            "api_1792573589_0c14ed12",
            false,
            1792574000.0
        )
        .is_none());

        let mut orch_chat = devon_chat(
            "20261020_231552_1372e7",
            "tui",
            1792500000.0,
            1792550000.0,
            1406,
            "orch",
        );
        orch_chat.hidden = Some(true);
        let orch_pick = summary("20261015_011713_2242f9", "Continue previous plan work #3", 1792000000.0);
        let orch = vec![
            orch_chat,
            orch_pick,
            summary("20261022_011600_f8fb1b", "devon-time0-fix", 1792700000.0),
        ];
        let orch_open =
            session_for_startup(&orch, "20261015_011713_2242f9", true, 1791910000.0).unwrap();
        assert_eq!(orch_open.id, "20261015_011713_2242f9");
        assert!(orch_open.explicit);
        assert_eq!(orch_open.anchor, 1791910000.0);
        assert!(stored_pin_after_resolve(
            "20261015_011713_2242f9",
            true,
            1791910000.0,
            "20261020_231552_1372e7",
            false,
            1792550000.0
        )
        .is_none());

        for (profile, retired_id, chat_id) in [
            (
                "mt-coder",
                "20261001_013821_3e5864",
                "api_1792573589_f1c99a3b",
            ),
            (
                "mt-tester",
                "20261013_002746_0531c3",
                "api_1792573589_257658b2",
            ),
            (
                "mt-reviewer",
                "api_1792086916_ab37ceff",
                "api_1792573589_b1b8ccc5",
            ),
        ] {
            let mut retired = summary(retired_id, "", 10.0);
            retired.archived = true;
            retired.hidden = Some(true);
            retired.source = "tui".into();
            let mut chat = devon_chat(chat_id, "api_server", 1792573589.0, 1792573600.0, 0, "");
            chat.hidden = Some(true);
            let sessions = vec![
                retired,
                chat,
                summary("kanban-latest", "Bingo", 1792999999.0),
            ];
            let opened = session_for_startup(&sessions, retired_id, false, 10.0).unwrap();
            assert_eq!(opened.id, chat_id, "{profile}");
            assert!(!opened.explicit, "{profile}");
            assert_ne!(opened.id, "kanban-latest", "{profile}");
            assert!(stored_pin_after_resolve(retired_id, false, 10.0, chat_id, false, 1.0).is_none());
        }

        let mut root = devon_chat("bot-root", "tui", 1.0, 10.0, 4, "root");
        root.hidden = Some(true);
        let mut mid = summary("bot-mid", "continued", 20.0);
        mid.parent_session_id = "bot-root".into();
        let mut stale_child = summary("bot-old", "old branch", 15.0);
        stale_child.parent_session_id = "bot-root".into();
        let mut tip = summary("bot-tip", "tip", 40.0);
        tip.parent_session_id = "bot-mid".into();
        let chain = vec![root, stale_child, mid, tip];
        assert_eq!(canonical_bot_chat(&chain).unwrap().id, "bot-root");
        let chained = session_for_startup(&chain, "stale-config", false, 1.0).unwrap();
        assert_eq!(chained.id, "bot-root");
        assert!(session_for_startup(
            &[summary("only-latest", "System Architect", 99.0)],
            "only-latest",
            false,
            1.0
        )
        .unwrap()
        .id
            == "only-latest");
        let mut retired_only = summary("retired-only", "", 5.0);
        retired_only.archived = true;
        retired_only.hidden = Some(true);
        assert!(session_for_startup(&[retired_only], "retired-only", false, 1.0).is_none());

        let parsed = parse_session_list(&json!({
            "data": [{
                "id": "api_1792573589_f1c99a3b",
                "title": "Bot Chat",
                "hidden": 1,
                "archived": 0,
                "source": "api_server",
                "message_count": 0,
                "parent_session_id": null
            }, {
                "id": "child",
                "title": "continued",
                "parent_session_id": "api_1792573589_f1c99a3b",
                "last_active": 50
            }]
        }));
        assert_eq!(parsed[0].hidden, Some(true));
        assert!(!parsed[0].archived);
        assert_eq!(parsed[1].parent_session_id, "api_1792573589_f1c99a3b");
        assert_eq!(canonical_bot_chat(&parsed).unwrap().id, "api_1792573589_f1c99a3b");
    }

    #[test]
    fn parses_messages_and_conflict() {
        let value = json!({
            "object": "list",
            "data": [
                {"role": "user", "content": "你好"},
                {"role": "assistant", "content": [{"type": "text", "text": "早晨"}]},
                {"role": "tool", "tool_name": "terminal", "content": "ok"},
                {"role": "assistant", "content": "Your request was not processed.", "display_kind": "failed_turn"},
                {"role": "system", "content": "skip"}
            ],
            "pagination": {"order": "oldest"}
        });
        let msgs = normalize_messages(&value);
        assert_eq!(msgs.len(), 4);
        assert_eq!(msgs[1].role, "bot");
        assert_eq!(msgs[1].text, "早晨");
        assert_eq!(msgs[2].tool_name, "terminal");
        assert_eq!(msgs[3].role, "failure");
        assert!(!msgs
            .iter()
            .any(|m| m.role == "bot" && m.text.contains("not processed")));
        let body = r#"{"error":{"message":"Title already in use by session api_1_abcd","code":"invalid_title"}}"#;
        assert_eq!(conflict_session_id(body).as_deref(), Some("api_1_abcd"));
        let live = r#"{"error":{"message":"Title 'Bot Chat' is already in use by session api_1791473313_291c4f1b","code":"invalid_title"}}"#;
        assert_eq!(
            conflict_session_id(live).as_deref(),
            Some("api_1791473313_291c4f1b")
        );
        assert_eq!(
            session_id_from_create(&json!({"object":"hermes.session","session":{"id":"s1"}}))
                .as_deref(),
            Some("s1")
        );
    }

    #[test]
    fn dashboard_profile_names() {
        let value = json!({"profiles":[
            {"name":"researcher","display_name":"researcher","bot_title":"資料搜查","description":"搜尋"},
            {"name":"","display_name":"skip"}
        ]});
        let found = parse_dashboard_profiles(&value);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].display_name, "資料搜查");
        assert_eq!(found[0].detail, "搜尋");
        let joyce = parse_dashboard_profiles(&json!({"profiles":[
            {"name":"joyce","display_name":"Joyce","description":"文稿同回覆"},
            {"name":"fallback","detail":"只用 detail"}
        ]}));
        assert_eq!(joyce[0].detail, "文稿同回覆");
        assert_eq!(joyce[1].detail, "只用 detail");
        assert_eq!(found[0].color, "");
        assert!(profiles_from_health_body("ok").is_empty());
        assert!(profiles_from_health_body(r#"{"status":"ok"}"#).is_empty());
        let health = profiles_from_health_body(
            r#"{"status":"ok","profiles":[{"profile":"coder","description":"程式"}]}"#,
        );
        assert_eq!(health.len(), 1);
        assert_eq!(health[0].profile, "coder");
        assert_eq!(health[0].detail, "程式");
        assert_eq!(health[0].color, "");
        let colored = parse_dashboard_profiles(&json!({"profiles":[
            {"name":"planner","color":"hsl(326 68% 58%)"},
            {"name":"coder","bot_color":"#ABC"},
            {"name":"writer","ui_meta":{"hermes-bots":{"color":"rgb(10, 20, 30)"}}}
        ]}));
        assert_eq!(colored[0].color, "hsl(326 68% 58%)");
        assert_eq!(colored[1].color, "#ABC");
        assert_eq!(colored[2].color, "rgb(10, 20, 30)");
        let src = include_str!("hermes.rs");
        let start = src
            .find("pub async fn list_profiles_with_bearer")
            .expect("bearer");
        let end = src[start..]
            .find("\npub fn parse_dashboard_profiles")
            .expect("parse");
        let body = &src[start..start + end];
        assert!(body.contains("/api/profiles"));
        assert!(body.contains("Authorization"));
        assert!(body.contains("Bearer"));
        assert!(!body.contains("X-Hermes-Session-Token"));
        assert!(!body.contains("println"));
        assert!(!body.contains("eprintln"));
        assert!(!body.contains("config::save"));
    }

    #[tokio::test]
    async fn bearer_profile_list_sends_the_native_token_and_stops_on_401() {
        let seen = Arc::new(std::sync::Mutex::new(String::new()));
        let captured = seen.clone();
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        thread::spawn(move || {
            let (mut sock, _) = listener.accept().unwrap();
            let mut buf = [0u8; 4096];
            let n = sock.read(&mut buf).unwrap_or(0);
            *captured.lock().unwrap() = String::from_utf8_lossy(&buf[..n]).to_string();
            let body = r#"{"profiles":[{"name":"hr-8words","display_name":"人事"}]}"#;
            let header = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                body.len()
            );
            let _ = sock.write_all(header.as_bytes());
            let _ = sock.write_all(body.as_bytes());
        });
        let http = Client::new();
        let listed = list_profiles_with_bearer(
            &http,
            &format!("http://{addr}"),
            "native-access",
            Duration::from_secs(4),
        )
        .await;
        let head = seen.lock().unwrap().clone();
        let lower = head.to_ascii_lowercase();
        assert!(head.starts_with("GET /api/profiles "), "{head}");
        assert!(lower.contains("authorization: bearer native-access"), "{head}");
        assert!(!lower.contains("x-hermes-session-token"), "{head}");
        match listed {
            ProfileBearer::Listed(rows) => {
                assert_eq!(rows.len(), 1);
                assert_eq!(rows[0].profile, "hr-8words");
                assert_eq!(rows[0].display_name, "人事");
            }
            other => panic!("expected profiles, got {other:?}"),
        }

        let denied = TcpListener::bind("127.0.0.1:0").unwrap();
        let denied_addr = denied.local_addr().unwrap();
        thread::spawn(move || {
            let (mut sock, _) = denied.accept().unwrap();
            let mut buf = [0u8; 2048];
            let _ = sock.read(&mut buf);
            let body = r#"{"error":"session_expired","access_token":"must-not-echo"}"#;
            let header = format!(
                "HTTP/1.1 401 Unauthorized\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                body.len()
            );
            let _ = sock.write_all(header.as_bytes());
            let _ = sock.write_all(body.as_bytes());
        });
        let expired = list_profiles_with_bearer(
            &http,
            &format!("http://{denied_addr}"),
            "stale-access",
            Duration::from_secs(4),
        )
        .await;
        assert!(matches!(expired, ProfileBearer::Expired));
    }

    fn oneshot(status: &str, content_type: &str, body: &str) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let status = status.to_string();
        let content_type = content_type.to_string();
        let body = body.to_string();
        thread::spawn(move || {
            let (mut sock, _) = listener.accept().unwrap();
            let mut buf = [0u8; 8192];
            let _ = sock.read(&mut buf);
            let header = format!(
                "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                body.len()
            );
            let _ = sock.write_all(header.as_bytes());
            let _ = sock.write_all(body.as_bytes());
        });
        format!("http://{addr}")
    }

    #[tokio::test]
    async fn lists_sessions_over_http() {
        let body = r#"{"object":"list","data":[{"id":"abc","title":"Bot Chat","hidden":true,"last_active":1}]}"#;
        let base = oneshot("200 OK", "application/json", body);
        let http = Client::new();
        let sessions = list_sessions(&http, &base, "test-key").await.unwrap();
        assert_eq!(sessions[0].id, "abc");
        assert_eq!(most_recent_session(&sessions).unwrap().id, "abc");
    }

    #[tokio::test]
    async fn gateway_down_then_up_refreshes_reads_without_creating_a_session() {
        let reserved = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = reserved.local_addr().unwrap().port();
        drop(reserved);
        let base = format!("http://127.0.0.1:{port}");
        let http = Client::builder()
            .connect_timeout(Duration::from_millis(400))
            .timeout(Duration::from_secs(2))
            .build()
            .unwrap();
        let down = list_sessions(&http, &base, "k").await.unwrap_err();
        let explained = explain(&down);
        assert!(
            explained.contains("連唔到") || explained.contains("中斷") || explained.contains("逾時"),
            "{explained}"
        );

        let listener = (0..20).find_map(|_| TcpListener::bind(("127.0.0.1", port)).ok());
        let listener = listener.expect("fake gateway port");
        let posts = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let gets = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let posts2 = posts.clone();
        let gets2 = gets.clone();
        thread::spawn(move || {
            for _ in 0..2 {
                let (mut sock, _) = listener.accept().unwrap();
                let mut buf = [0u8; 8192];
                let n = sock.read(&mut buf).unwrap_or(0);
                let head = String::from_utf8_lossy(&buf[..n]);
                let line = head.lines().next().unwrap_or("");
                if line.starts_with("POST") {
                    posts2.fetch_add(1, Ordering::SeqCst);
                } else if line.starts_with("GET") {
                    gets2.fetch_add(1, Ordering::SeqCst);
                }
                let body = if line.contains("/v1/overlay/kanban/board") {
                    r#"{"board":"default","columns":[{"name":"todo","tasks":[{"id":"t1","title":"回來","status":"todo"}]}]}"#
                } else {
                    r#"{"object":"list","data":[{"id":"20261001_013827_25b1eb","title":"Bot Chat","source":"tui","last_active":1}]}"#
                };
                let header = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    body.len()
                );
                let _ = sock.write_all(header.as_bytes());
                let _ = sock.write_all(body.as_bytes());
            }
        });

        let sessions = list_sessions(&http, &base, "k").await.unwrap();
        assert_eq!(sessions[0].id, "20261001_013827_25b1eb");
        assert_eq!(sessions[0].title, "Bot Chat");
        let board = fetch_kanban_board(&http, &base, "k", "default").await.unwrap();
        assert!(!board.unavailable);
        let title = board
            .columns
            .iter()
            .flat_map(|column| column.tasks.iter())
            .find(|task| task.id == "t1")
            .map(|task| task.title.as_str());
        assert_eq!(title, Some("回來"));
        assert_eq!(posts.load(Ordering::SeqCst), 0);
        assert!(gets.load(Ordering::SeqCst) >= 2);
    }

    #[tokio::test]
    async fn streams_sse_turn() {
        let body = "\
event: assistant.delta\n\
data: {\"delta\":\"你好\"}\n\
\n\
event: tool.started\n\
data: {\"tool_name\":\"terminal\",\"preview\":\"ls\"}\n\
\n\
event: tool.completed\n\
data: {\"tool_name\":\"terminal\",\"preview\":\"README\"}\n\
\n\
event: run.completed\n\
data: {\"completed\":true}\n\
\n";
        let base = oneshot("200 OK", "text/event-stream", body);
        let http = Client::new();
        let seen = Arc::new(std::sync::Mutex::new(Vec::new()));
        let seen2 = seen.clone();
        let stop = AtomicBool::new(false);
        let stop_requested = AtomicBool::new(false);
        stream_turn(&http, &base, "k", "sid", "hello", &stop, &stop_requested, |ev| {
            seen2.lock().unwrap().push(ev);
        })
        .await
        .unwrap();
        let seen = seen.lock().unwrap();
        assert!(matches!(seen[0], TurnEvent::Delta(ref t) if t == "你好"));
        assert!(matches!(seen[1], TurnEvent::Tool { ref phase, .. } if phase == "started"));
        assert!(
            matches!(seen.last(), Some(TurnEvent::Finished { outcome, .. }) if outcome == "completed")
        );
    }

    #[tokio::test]
    async fn a_later_run_started_is_the_stop_target() {
        let body = "\
event: run.started\n\
data: {\"run_id\":\"run_queued\"}\n\
\n\
event: run.started\n\
data: {\"run_id\":\"run_live\"}\n\
\n\
event: assistant.delta\n\
data: {\"delta\":\"仍然講\"}\n\
\n\
event: run.completed\n\
data: {\"run_id\":\"run_queued\",\"completed\":true}\n\
\n";
        let base = oneshot("200 OK", "text/event-stream", body);
        let http = Client::new();
        let seen = Arc::new(std::sync::Mutex::new(Vec::new()));
        let seen2 = seen.clone();
        let stop = AtomicBool::new(false);
        let stop_requested = AtomicBool::new(false);
        stream_turn(&http, &base, "k", "sid", "hello", &stop, &stop_requested, |ev| {
            seen2.lock().unwrap().push(ev);
        })
        .await
        .unwrap();
        let seen = seen.lock().unwrap();
        let started: Vec<_> = seen
            .iter()
            .filter_map(|ev| match ev {
                TurnEvent::Started { run_id } => Some(run_id.as_str()),
                _ => None,
            })
            .collect();
        assert_eq!(started, vec!["run_queued", "run_live"]);
        assert!(seen.iter().any(|ev| matches!(ev, TurnEvent::Delta(text) if text == "仍然講")));
        assert!(matches!(
            seen.last(),
            Some(TurnEvent::Finished { outcome, run_id, .. }) if outcome == "completed" && run_id == "run_queued"
        ));
        assert_eq!(
            stop_target_ids("run_queued", "run_live"),
            vec!["run_live".to_string(), "run_queued".to_string()]
        );
    }

    #[tokio::test]
    async fn another_session_read_does_not_stop_the_open_stream() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let saw_stop = Arc::new(AtomicBool::new(false));
        let flag = saw_stop.clone();
        thread::spawn(move || {
            let mut pending = None;
            for _ in 0..2 {
                let (mut sock, _) = listener.accept().unwrap();
                sock.set_read_timeout(Some(Duration::from_secs(2))).ok();
                let mut buf = vec![0u8; 8192];
                let n = sock.read(&mut buf).unwrap_or(0);
                let head = String::from_utf8_lossy(&buf[..n]).to_string();
                if head.contains("/v1/runs/") && head.contains("/stop") {
                    flag.store(true, Ordering::SeqCst);
                }
                let line = head.lines().next().unwrap_or("");
                if line.starts_with("GET") && line.contains("/api/sessions/other/messages") {
                    let body = r#"{"data":[{"role":"assistant","content":"另一個對話"}]}"#;
                    let header = format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                        body.len()
                    );
                    let _ = sock.write_all(header.as_bytes());
                    let _ = sock.write_all(body.as_bytes());
                } else if line.starts_with("POST")
                    && (line.contains("/v1/runs") || line.contains("/api/sessions/live/chat/stream"))
                {
                    pending = Some(sock);
                } else {
                    let body = "{}";
                    let header = format!(
                        "HTTP/1.1 404 Not Found\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                        body.len()
                    );
                    let _ = sock.write_all(header.as_bytes());
                    let _ = sock.write_all(body.as_bytes());
                }
            }
            let Some(mut sock) = pending else {
                return;
            };
            let body = "\
event: assistant.delta\n\
data: {\"delta\":\"仍然收到\"}\n\
\n\
event: run.completed\n\
data: {\"completed\":true}\n\
\n";
            let header = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                body.len()
            );
            let _ = sock.write_all(header.as_bytes());
            let _ = sock.write_all(body.as_bytes());
        });
        let http = Client::new();
        let base = format!("http://{addr}");
        let stop = AtomicBool::new(false);
        let stop_requested = AtomicBool::new(false);
        let seen = Arc::new(std::sync::Mutex::new(Vec::new()));
        let seen2 = seen.clone();
        let stream = stream_turn(
            &http,
            &base,
            "k",
            "live",
            "hello",
            &stop,
            &stop_requested,
            move |ev| {
                seen2.lock().unwrap().push(ev);
            },
        );
        let messages = fetch_messages(&http, &base, "k", "other");
        let (streamed, listed) = tokio::join!(stream, messages);
        streamed.unwrap();
        let listed = listed.unwrap();
        assert_eq!(listed[0].text, "另一個對話");
        let seen = seen.lock().unwrap();
        assert!(matches!(seen.first(), Some(TurnEvent::Delta(text)) if text == "仍然收到"));
        assert!(matches!(seen.last(), Some(TurnEvent::Finished { outcome, .. }) if outcome == "completed"));
        assert!(!saw_stop.load(Ordering::SeqCst));
        assert!(!stop.load(Ordering::SeqCst));
    }

    #[tokio::test]
    async fn failed_turn_uses_provider_text_not_a_normal_reply() {
        let body = "\
event: assistant.completed\n\
data: {\"content\":\"HTTP 404: model 'does-not-exist-model' not found\",\"completed\":false}\n\
\n\
event: run.failed\n\
data: {\"messages\":[{\"role\":\"assistant\",\"content\":\"Your request was not processed.\",\"display_kind\":\"failed_turn\"}]}\n\
\n";
        let base = oneshot("200 OK", "text/event-stream", body);
        let http = Client::new();
        let seen = Arc::new(std::sync::Mutex::new(Vec::new()));
        let seen2 = seen.clone();
        let stop = AtomicBool::new(false);
        let stop_requested = AtomicBool::new(false);
        stream_turn(&http, &base, "k", "sid", "hello", &stop, &stop_requested, |ev| {
            seen2.lock().unwrap().push(ev);
        })
        .await
        .unwrap();
        let seen = seen.lock().unwrap();
        assert!(
            !seen.iter().any(|ev| matches!(ev, TurnEvent::Delta(_))),
            "a failed turn must not render as a normal reply"
        );
        match seen.last() {
            Some(TurnEvent::Finished { outcome, detail, .. }) => {
                assert_eq!(outcome, "failed");
                assert!(detail.contains("does-not-exist-model"));
                assert!(detail.contains("Your request was not processed."));
                assert!(!detail.is_empty());
            }
            other => panic!("expected failed finish, got {other:?}"),
        }
    }

    #[test]
    fn oneshot_and_other_foreign_sources_are_read_only() {
        let reason = session_read_only_reason();
        for source in ["oneshot", "desktop", "tui", "cli", "", "CLI", "Desktop"] {
            assert!(session_read_only(source), "{source}");
            assert!(!session_accepts_send(source), "{source}");
        }
        for source in ["api_server", "API_Server", "bot_room", "Bot_Room"] {
            assert!(!session_read_only(source), "{source}");
            assert!(session_accepts_send(source), "{source}");
        }
        let detail = failure_detail(
            &json!({"error": "RuntimeStoreError('permission_denied')"}),
            None,
        );
        assert_eq!(detail, reason);
        let with_prior = failure_detail(
            &json!({
                "messages": [{
                    "content": "RuntimeStoreError('permission_denied')",
                    "display_kind": "failed_turn"
                }]
            }),
            Some("partial reply"),
        );
        assert_eq!(with_prior, reason);
        assert_eq!(
            explain(&HermesError::Http {
                status: 500,
                body: "RuntimeStoreError('permission_denied')".into(),
            }),
            reason
        );
        assert_eq!(
            explain(&HermesError::Http {
                status: 403,
                body: "permission denied".into(),
            }),
            reason
        );
        assert_eq!(
            explain(&HermesError::Http {
                status: 500,
                body: "busy".into(),
            }),
            "Gateway 回應 500。busy"
        );
        assert_eq!(
            explain(&HermesError::Http {
                status: 403,
                body: String::new(),
            }),
            "Gateway 拒絕存取（403）。"
        );
        let mut pick = devon_chat(
            "20261015_011713_2242f9",
            "desktop",
            1.0,
            2.0,
            40,
            "pick",
        );
        pick.title = "Bot Chat".into();
        let api = devon_chat("api_1792573589_f1c99a3b", "api_server", 3.0, 4.0, 1, "");
        let opened =
            session_for_startup(&[api.clone(), pick], "20261015_011713_2242f9", true, 1.0)
                .unwrap();
        assert_eq!(opened.id, "20261015_011713_2242f9");
        assert!(opened.read_only);
        assert_eq!(opened.read_only_reason, reason);
        let writable = session_for_startup(&[api], "", false, 0.0).unwrap();
        assert!(!writable.read_only);
        assert!(writable.read_only_reason.is_empty());
        let shot = session_for_startup(
            &[summary_source("shot", "CLI oneshot", 9.0, "oneshot")],
            "shot",
            true,
            0.0,
        )
        .unwrap();
        assert_eq!(shot.id, "shot");
        assert!(shot.read_only);
        assert_eq!(shot.read_only_reason, reason);
        let room = session_for_startup(
            &[summary_source("room", "Bot Chat", 4.0, "bot_room")],
            "",
            false,
            0.0,
        )
        .unwrap();
        assert_eq!(room.id, "room");
        assert!(!room.read_only);

        let lib = include_str!("lib.rs");
        let send_start = lib.find("async fn send_chat").expect("send_chat");
        let send_end = lib.find("fn dispatch_turn").expect("dispatch_turn");
        let send = &lib[send_start..send_end];
        let head = &send[..send.find("status: 404").expect("404")];
        assert!(head.contains("turn_is_permission_denied"));
        assert!(!head.contains("ensure_bot_chat"));
        assert!(!head.contains("create_session"));
        assert!(!head.contains("create_bot_chat"));
        assert!(!head.contains("persist_pin"));
        assert!(!send.contains("create_session"));
        assert!(!send.contains("create_bot_chat"));
    }

    #[test]
    fn continue_uses_an_existing_api_session_before_creating_one() {
        let cli = summary_source("local-mt5", "MT5 wrapper (CLI)", 9.0, "cli");
        let desktop = summary_source("20261015_011713_2242f9", "Bot Chat", 8.0, "desktop");
        let notes = summary_source("api_notes", "notes", 7.0, "api_server");
        let chat = summary_source("api_1792573589_0c14ed12", "Bot Chat", 3.0, "api_server");
        let sessions = [cli.clone(), desktop.clone(), notes.clone(), chat.clone()];
        let picked = writable_continuation(&sessions, "20261015_011713_2242f9", &[]).unwrap();
        assert_eq!(picked.id, "api_1792573589_0c14ed12");
        let foreign = [cli.clone(), desktop.clone()];
        assert!(writable_continuation(&foreign, "local-mt5", &[]).is_none());
        let refused = summary_source("api_refused", "Bot Chat", 12.0, "api_server");
        let after_deny = [refused, notes.clone()];
        let next = writable_continuation(&after_deny, "api_refused", &[]).unwrap();
        assert_eq!(next.id, "api_notes");
        let room = summary_source("room", "stand", 1.0, "bot_room");
        let room_only = [desktop.clone(), room];
        assert_eq!(
            writable_continuation(&room_only, "20261015_011713_2242f9", &[])
                .unwrap()
                .id,
            "room"
        );
        let denied = summary_source("api_denied", "Bot Chat", 20.0, "api_server");
        let denied_pool = [denied.clone(), notes.clone(), chat.clone()];
        assert_eq!(
            writable_continuation(&denied_pool, "local-mt5", &["api_denied"])
                .unwrap()
                .id,
            "api_1792573589_0c14ed12"
        );
        assert!(writable_continuation(
            &denied_pool,
            "local-mt5",
            &["api_denied", "api_notes", "api_1792573589_0c14ed12"]
        )
        .is_none());

        let lib = include_str!("lib.rs");
        let arm = lib.find("\"continue\" =>").expect("continue");
        let body = &lib[arm..arm + 1400];
        let pick_at = body.find("writable_continuation").expect("pick");
        let create_at = body.find("create_session").expect("create");
        assert!(body.contains("refused"));
        assert!(pick_at < create_at);
        assert!(body.contains("OVERLAY_CONTINUE_TITLE"));
        let open_at = lib.find("async fn open_bot").expect("open");
        let open_end = lib.find("async fn select_session").expect("select");
        let open = &lib[open_at..open_end];
        assert!(!open.contains("\"continue\""));
        assert!(!open.contains("create_session"));
    }

    #[tokio::test]
    async fn permission_denied_stream_is_the_plain_sentence() {
        let body = "\
event: run.failed\n\
data: {\"error\":\"RuntimeStoreError('permission_denied')\"}\n\
\n";
        let base = oneshot("200 OK", "text/event-stream", body);
        let http = Client::new();
        let seen = Arc::new(std::sync::Mutex::new(Vec::new()));
        let seen2 = seen.clone();
        let stop = AtomicBool::new(false);
        let stop_requested = AtomicBool::new(false);
        stream_turn(&http, &base, "k", "sid", "hello", &stop, &stop_requested, |ev| {
            seen2.lock().unwrap().push(ev);
        })
        .await
        .unwrap();
        let seen = seen.lock().unwrap();
        match seen.last() {
            Some(TurnEvent::Finished { outcome, detail, .. }) => {
                assert_eq!(outcome, "failed");
                assert_eq!(detail, session_read_only_reason());
            }
            other => panic!("expected failed finish, got {other:?}"),
        }

        let denied = oneshot(
            "500 Internal Server Error",
            "text/plain",
            "RuntimeStoreError('permission_denied')",
        );
        let err = stream_turn(&http, &denied, "k", "sid", "hello", &stop, &stop_requested, |_| {}).await;
        assert!(turn_is_permission_denied(&err));
        assert!(matches!(err, Err(HermesError::Http { status: 500, .. })));
    }

    #[tokio::test]
    async fn approval_request_keeps_run_id_and_blocked_execute_code_is_plain() {
        let body = "\
event: run.started\n\
data: {\"run_id\":\"run_abc\"}\n\
\n\
event: approval.request\n\
data: {\"event\":\"approval.request\",\"run_id\":\"run_abc\",\"request_id\":\"req_1\",\"description\":\"list files\",\"command\":\"ls <redacted>\",\"choices\":[\"once\",\"session\",\"always\",\"deny\"],\"allow_permanent\":true}\n\
\n\
event: approval.responded\n\
data: {\"request_id\":\"req_1\",\"choice\":\"once\"}\n\
\n\
event: tool.completed\n\
data: {\"tool_name\":\"execute_code\",\"preview\":\"BLOCKED execute_code\"}\n\
\n\
event: run.completed\n\
data: {}\n\
\n";
        let base = oneshot("200 OK", "text/event-stream", body);
        let http = Client::new();
        let seen = Arc::new(std::sync::Mutex::new(Vec::new()));
        let seen2 = seen.clone();
        let stop = AtomicBool::new(false);
        let stop_requested = AtomicBool::new(false);
        stream_turn(&http, &base, "k", "sid", "hello", &stop, &stop_requested, |ev| {
            seen2.lock().unwrap().push(ev);
        })
        .await
        .unwrap();
        let seen = seen.lock().unwrap();
        assert!(matches!(&seen[0], TurnEvent::Started { run_id } if run_id == "run_abc"));
        match &seen[1] {
            TurnEvent::ApprovalRequest {
                run_id,
                request_id,
                description,
                command,
                execution_generation,
            } => {
                assert_eq!(run_id, "run_abc");
                assert_eq!(request_id, "req_1");
                assert_eq!(description, "list files");
                assert_eq!(command, "ls <redacted>");
                assert_eq!(execution_generation, &None);
            }
            other => panic!("expected approval request, got {other:?}"),
        }
        assert!(matches!(
            &seen[2],
            TurnEvent::ApprovalResponded { request_id, choice }
                if request_id == "req_1" && choice == "once"
        ));
        assert!(matches!(
            &seen[3],
            TurnEvent::Tool { name, preview, .. }
                if name == "execute_code" && preview == execute_code_blocked_line()
        ));
        assert_eq!(allowed_approval_choice("once"), Some("once"));
        assert_eq!(allowed_approval_choice("deny"), Some("deny"));
        assert_eq!(allowed_approval_choice("always"), None);
        assert_eq!(allowed_approval_choice("session"), None);
        assert_eq!(approval_run_id("run_abc"), Some("run_abc"));
        assert_eq!(approval_run_id("../run_abc"), None);
        assert_eq!(
            failure_detail(
                &json!({"error": "BLOCKED execute_code by policy"}),
                None
            ),
            execute_code_blocked_line()
        );
        let src = include_str!("hermes.rs");
        let start = src.find("pub async fn submit_approval").expect("submit");
        let end = src[start..].find("\nfn ").expect("next fn");
        let body = &src[start..start + end];
        assert!(body.contains("/v1/runs/{run_id}/approval"));
        assert!(body.contains("\"request_id\""));
        assert!(body.contains("\"choice\""));
        assert!(!body.contains("resolve_all"));
        assert!(!body.contains("println"));
        assert!(!body.contains("eprintln"));
        assert!(!body.contains("config::save"));
        let lib = include_str!("lib.rs");
        let cmd = lib.find("async fn respond_approval").expect("command");
        let cmd_end = lib[cmd..].find("\nfn dispatch_turn").expect("dispatch");
        let cmd_body = &lib[cmd..cmd + cmd_end];
        assert!(cmd_body.contains("allowed_approval_choice"));
        assert!(cmd_body.contains("status: 409"));
        assert!(!cmd_body.contains("println"));
        assert!(!cmd_body.contains("eprintln"));
        assert!(!cmd_body.contains("config::save"));
        assert!(!cmd_body.contains("resolve_all"));
    }

    #[tokio::test]
    async fn approval_post_uses_the_profile_prefix_once_and_409_does_not_retry() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let seen = Arc::new(std::sync::Mutex::new(String::new()));
        let seen2 = seen.clone();
        let posts = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let posts2 = posts.clone();
        thread::spawn(move || {
            let (mut sock, _) = listener.accept().unwrap();
            let mut buf = [0u8; 8192];
            let n = sock.read(&mut buf).unwrap_or(0);
            posts2.fetch_add(1, Ordering::SeqCst);
            *seen2.lock().unwrap() = String::from_utf8_lossy(&buf[..n]).into_owned();
            let body = r#"{"object":"hermes.run.approval_response","run_id":"run_abc","choice":"once","request_id":"req_1","resolved":true}"#;
            let header = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                body.len()
            );
            let _ = sock.write_all(header.as_bytes());
            let _ = sock.write_all(body.as_bytes());
        });
        let root = format!("http://{addr}/p/mt-coder");
        let http = Client::new();
        submit_approval(&http, &root, "test-key", "run_abc", "req_1", "once", None)
            .await
            .unwrap();
        let req = seen.lock().unwrap();
        assert!(req.starts_with("POST /p/mt-coder/v1/runs/run_abc/approval "));
        let json_body = req.split("\r\n\r\n").nth(1).unwrap_or("");
        let value: Value = serde_json::from_str(json_body.trim()).unwrap();
        assert_eq!(value["choice"], "once");
        assert_eq!(value["request_id"], "req_1");
        assert_eq!(value.as_object().unwrap().len(), 2);
        assert!(req.to_ascii_lowercase().contains("authorization: bearer "));
        assert!(!req.contains("resolve_all"));
        drop(req);
        assert_eq!(posts.load(Ordering::SeqCst), 1);

        let stale = TcpListener::bind("127.0.0.1:0").unwrap();
        let stale_addr = stale.local_addr().unwrap();
        let stale_posts = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let stale_posts2 = stale_posts.clone();
        thread::spawn(move || {
            let (mut sock, _) = stale.accept().unwrap();
            let mut buf = [0u8; 2048];
            let _ = sock.read(&mut buf);
            stale_posts2.fetch_add(1, Ordering::SeqCst);
            let body = r#"{"error":"approval_not_pending"}"#;
            let header = format!(
                "HTTP/1.1 409 Conflict\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                body.len()
            );
            let _ = sock.write_all(header.as_bytes());
            let _ = sock.write_all(body.as_bytes());
        });
        let err = submit_approval(
            &http,
            &format!("http://{stale_addr}/p/mt-coder"),
            "test-key",
            "run_abc",
            "req_1",
            "deny",
            None,
        )
        .await
        .expect_err("409");
        assert!(matches!(err, HermesError::Http { status: 409, ref body } if body.is_empty()));
        assert_eq!(stale_posts.load(Ordering::SeqCst), 1);
    }

    fn write_http(sock: &mut std::net::TcpStream, status: &str, content_type: &str, body: &str) {
        let header = format!(
            "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            body.len()
        );
        let _ = sock.write_all(header.as_bytes());
        let _ = sock.write_all(body.as_bytes());
    }

    fn read_http(sock: &mut std::net::TcpStream) -> String {
        sock.set_read_timeout(Some(Duration::from_secs(2))).ok();
        let mut buf = vec![0u8; 16384];
        let n = sock.read(&mut buf).unwrap_or(0);
        String::from_utf8_lossy(&buf[..n]).into_owned()
    }

    #[tokio::test]
    async fn runs_404_falls_back_to_chat_stream() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        thread::spawn(move || {
            for _ in 0..2 {
                let (mut sock, _) = listener.accept().unwrap();
                let head = read_http(&mut sock);
                let line = head.lines().next().unwrap_or("");
                if line.contains("/v1/runs") && !line.contains("/events") {
                    write_http(&mut sock, "404 Not Found", "application/json", r#"{"error":"no runs"}"#);
                } else if line.contains("/chat/stream") {
                    let body = "event: assistant.delta\ndata: {\"delta\":\"舊路\"}\n\nevent: run.completed\ndata: {}\n\n";
                    write_http(&mut sock, "200 OK", "text/event-stream", body);
                } else {
                    write_http(&mut sock, "404 Not Found", "application/json", "{}");
                }
            }
        });
        let http = Client::new();
        let seen = Arc::new(std::sync::Mutex::new(Vec::new()));
        let seen2 = seen.clone();
        let stop = AtomicBool::new(false);
        let stop_requested = AtomicBool::new(false);
        stream_turn(
            &http,
            &format!("http://{addr}"),
            "k",
            "sid",
            "hello",
            &stop,
            &stop_requested,
            |ev| seen2.lock().unwrap().push(ev),
        )
        .await
        .unwrap();
        let seen = seen.lock().unwrap();
        assert!(matches!(seen.first(), Some(TurnEvent::Delta(text)) if text == "舊路"));
        assert!(matches!(seen.last(), Some(TurnEvent::Finished { outcome, .. }) if outcome == "completed"));
    }

    #[tokio::test]
    async fn runs_events_carry_clarify_and_reconnect_with_last_event_id() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let seen = Arc::new(std::sync::Mutex::new(Vec::new()));
        let seen2 = seen.clone();
        thread::spawn(move || {
            let mut sent_partial = false;
            for _ in 0..4 {
                let (mut sock, _) = listener.accept().unwrap();
                let head = read_http(&mut sock);
                let line = head.lines().next().unwrap_or("").to_string();
                seen2.lock().unwrap().push(head);
                if line.contains("POST ") {
                    write_http(
                        &mut sock,
                        "202 Accepted",
                        "application/json",
                        r#"{"run_id":"run_abc","status":"started","replayed":false}"#,
                    );
                } else if line.contains("/events") && !sent_partial {
                    sent_partial = true;
                    let partial = "\
id: 1\n\
data: {\"event\":\"clarify.request\",\"run_id\":\"run_abc\",\"prompt_id\":\"p1\",\"execution_generation\":4,\"question\":\"邊個？\",\"choices\":[\"甲\",\"乙\"],\"multi_select\":false,\"timeout_s\":2}\n\
\n";
                    write_http(&mut sock, "200 OK", "text/event-stream", partial);
                } else if line.contains("/events") {
                    let rest = "\
id: 2\n\
data: {\"event\":\"approval.request\",\"run_id\":\"run_abc\",\"prompt_id\":\"req_9\",\"execution_generation\":4,\"description\":\"list\",\"command\":\"ls\",\"choices\":[\"once\",\"deny\"]}\n\
\n\
id: 3\n\
data: {\"event\":\"clarify.settled\",\"run_id\":\"run_abc\",\"prompt_id\":\"p1\",\"execution_generation\":4}\n\
\n\
id: 4\n\
data: {\"event\":\"run.completed\",\"run_id\":\"run_abc\",\"output\":\"\"}\n\
\n";
                    write_http(&mut sock, "200 OK", "text/event-stream", rest);
                } else {
                    write_http(
                        &mut sock,
                        "200 OK",
                        "application/json",
                        r#"{"run_id":"run_abc","status":"started","pending_controls":[]}"#,
                    );
                }
            }
        });
        let http = Client::new();
        let events = Arc::new(std::sync::Mutex::new(Vec::new()));
        let events2 = events.clone();
        let stop = AtomicBool::new(false);
        let stop_requested = AtomicBool::new(false);
        stream_turn(
            &http,
            &format!("http://{addr}/p/mt-coder"),
            "k",
            "sid_1",
            "hello",
            &stop,
            &stop_requested,
            |ev| events2.lock().unwrap().push(ev),
        )
        .await
        .unwrap();
        let reqs = seen.lock().unwrap();
        assert!(reqs[0].contains("POST /p/mt-coder/v1/runs "));
        assert!(!reqs[0].contains("/chat/stream"));
        let posted = reqs[0].split("\r\n\r\n").nth(1).unwrap_or("");
        let body: Value = serde_json::from_str(posted.trim()).unwrap();
        assert_eq!(body["input"], "hello");
        assert_eq!(body["session_id"], "sid_1");
        assert!(body.get("conversation_history").is_none());
        assert_eq!(body.as_object().unwrap().len(), 2);
        assert!(reqs[1].contains("GET /p/mt-coder/v1/runs/run_abc/events "));
        assert!(!reqs[1].to_ascii_lowercase().contains("last-event-id"));
        let snap_at = reqs
            .iter()
            .position(|req| req.contains("GET /p/mt-coder/v1/runs/run_abc ") && !req.contains("/events"))
            .expect("snapshot");
        let reconnect_at = reqs.iter().position(|req| req.contains("last_seq=1")).expect("reconnect");
        assert!(snap_at < reconnect_at);
        assert!(reqs[reconnect_at].to_ascii_lowercase().contains("last-event-id: 1"));
        drop(reqs);
        let events = events.lock().unwrap();
        assert!(matches!(&events[0], TurnEvent::Started { run_id } if run_id == "run_abc"));
        match &events[1] {
            TurnEvent::ClarifyRequest {
                prompt_id,
                question,
                choices,
                multi_select,
                execution_generation,
                timeout_s,
                ..
            } => {
                assert_eq!(prompt_id, "p1");
                assert_eq!(question, "邊個？");
                assert_eq!(choices, &vec!["甲".to_string(), "乙".to_string()]);
                assert!(!multi_select);
                assert_eq!(*execution_generation, 4);
                assert_eq!(*timeout_s, Some(2));
            }
            other => panic!("expected clarify, got {other:?}"),
        }
        match &events[2] {
            TurnEvent::ApprovalRequest {
                request_id,
                execution_generation,
                ..
            } => {
                assert_eq!(request_id, "req_9");
                assert_eq!(*execution_generation, Some(4));
            }
            other => panic!("expected approval, got {other:?}"),
        }
        assert!(matches!(
            &events[3],
            TurnEvent::ControlSettled { kind, prompt_id } if kind == "clarify" && prompt_id == "p1"
        ));
        let src = include_str!("hermes.rs");
        let start = src.find("pub async fn stream_turn").expect("stream");
        let end = src[start..].find("\nfn apply_sse").expect("apply");
        let turned = &src[start..start + end];
        assert!(turned.contains("/v1/runs"));
        assert!(turned.contains("session_id"));
        assert!(turned.contains("stream_chat_turn"));
        assert!(!turned.contains("conversation_history"));
        let follow = src.find("async fn follow_run_events").expect("follow");
        let follow_end = src[follow..].find("pub async fn stream_turn").expect("stream");
        let followed = &src[follow..follow + follow_end];
        assert!(followed.contains("60"));
        assert!(!followed.contains("0..=4"));
    }

    #[tokio::test]
    async fn pending_snapshot_keeps_following_until_the_run_ends() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        thread::spawn(move || {
            let mut events = 0usize;
            let mut snaps = 0usize;
            for _ in 0..5 {
                let (mut sock, _) = listener.accept().unwrap();
                let head = read_http(&mut sock);
                let line = head.lines().next().unwrap_or("");
                if line.contains("POST ") {
                    write_http(
                        &mut sock,
                        "202 Accepted",
                        "application/json",
                        r#"{"run_id":"run_abc","status":"started"}"#,
                    );
                } else if line.contains("/events") {
                    events += 1;
                    if events == 1 {
                        let body = "id: 1\ndata: {\"event\":\"clarify.request\",\"run_id\":\"run_abc\",\"prompt_id\":\"p1\",\"execution_generation\":1,\"question\":\"Q\",\"choices\":[\"甲\"]}\n\n";
                        write_http(&mut sock, "200 OK", "text/event-stream", body);
                    } else {
                        write_http(&mut sock, "200 OK", "text/event-stream", "");
                    }
                } else {
                    snaps += 1;
                    let body = if snaps == 1 {
                        r#"{"run_id":"run_abc","status":"started","pending_controls":[{"kind":"clarify","prompt_id":"p1","execution_generation":1,"question":"Q","choices":["甲"]}]}"#
                    } else {
                        r#"{"run_id":"run_abc","status":"completed","output":"","pending_controls":[]}"#
                    };
                    write_http(&mut sock, "200 OK", "application/json", body);
                }
            }
        });
        let http = Client::new();
        let events = Arc::new(std::sync::Mutex::new(Vec::new()));
        let events2 = events.clone();
        let stop = AtomicBool::new(false);
        let stop_requested = AtomicBool::new(false);
        stream_turn(
            &http,
            &format!("http://{addr}"),
            "k",
            "sid",
            "hello",
            &stop,
            &stop_requested,
            |ev| events2.lock().unwrap().push(ev),
        )
        .await
        .unwrap();
        let events = events.lock().unwrap();
        let clarifies = events
            .iter()
            .filter(|ev| matches!(ev, TurnEvent::ClarifyRequest { .. }))
            .count();
        assert_eq!(clarifies, 1);
        assert!(matches!(events.last(), Some(TurnEvent::Finished { outcome, .. }) if outcome == "completed"));
    }

    #[tokio::test]
    async fn events_reconnect_survives_five_drops_while_the_run_stays_live() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        thread::spawn(move || {
            let mut drops = 0usize;
            for _ in 0..12 {
                let (mut sock, _) = listener.accept().unwrap();
                let head = read_http(&mut sock);
                let line = head.lines().next().unwrap_or("");
                if line.contains("POST ") {
                    write_http(
                        &mut sock,
                        "202 Accepted",
                        "application/json",
                        r#"{"run_id":"run_abc","status":"started"}"#,
                    );
                } else if line.contains("/events") {
                    if drops < 5 {
                        drops += 1;
                        continue;
                    }
                    let body = "id: 1\ndata: {\"event\":\"run.completed\",\"run_id\":\"run_abc\",\"output\":\"\"}\n\n";
                    write_http(&mut sock, "200 OK", "text/event-stream", body);
                } else {
                    write_http(
                        &mut sock,
                        "200 OK",
                        "application/json",
                        r#"{"run_id":"run_abc","status":"running","pending_controls":[]}"#,
                    );
                }
            }
        });
        let http = Client::new();
        let events = Arc::new(std::sync::Mutex::new(Vec::new()));
        let events2 = events.clone();
        let stop = AtomicBool::new(false);
        let stop_requested = AtomicBool::new(false);
        stream_turn(
            &http,
            &format!("http://{addr}"),
            "k",
            "sid",
            "hello",
            &stop,
            &stop_requested,
            |ev| events2.lock().unwrap().push(ev),
        )
        .await
        .unwrap();
        let events = events.lock().unwrap();
        assert!(matches!(events.last(), Some(TurnEvent::Finished { outcome, .. }) if outcome == "completed"));
    }

    #[tokio::test]
    async fn user_stop_on_a_finished_run_is_not_a_cancel() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let seen = Arc::new(std::sync::Mutex::new(Vec::new()));
        let seen2 = seen.clone();
        thread::spawn(move || {
            for _ in 0..3 {
                let (mut sock, _) = listener.accept().unwrap();
                let head = read_http(&mut sock);
                seen2.lock().unwrap().push(head.clone());
                let line = head.lines().next().unwrap_or("");
                if line.contains("POST ") {
                    write_http(
                        &mut sock,
                        "202 Accepted",
                        "application/json",
                        r#"{"run_id":"run_abc","status":"started"}"#,
                    );
                } else if line.contains("/events") {
                    let body = "id: 1\ndata: {\"event\":\"message.delta\",\"delta\":\"半句\"}\n\n";
                    write_http(&mut sock, "200 OK", "text/event-stream", body);
                } else {
                    write_http(
                        &mut sock,
                        "200 OK",
                        "application/json",
                        r#"{"run_id":"run_abc","status":"completed","output":"","pending_controls":[]}"#,
                    );
                }
            }
        });
        let http = Client::new();
        let events = Arc::new(std::sync::Mutex::new(Vec::new()));
        let events2 = events.clone();
        let stop = AtomicBool::new(false);
        let stop_requested = AtomicBool::new(false);
        stream_turn(
            &http,
            &format!("http://{addr}"),
            "k",
            "sid",
            "hello",
            &stop,
            &stop_requested,
            |ev| {
                if matches!(ev, TurnEvent::Delta(_)) {
                    stop_requested.store(true, Ordering::SeqCst);
                }
                events2.lock().unwrap().push(ev);
            },
        )
        .await
        .unwrap();
        let reqs = seen.lock().unwrap();
        assert!(reqs.iter().any(|req| req.contains("GET /v1/runs/run_abc ") && !req.contains("/events")));
        assert!(reqs.iter().all(|req| !req.contains("/stop")));
        drop(reqs);
        let events = events.lock().unwrap();
        assert!(matches!(events.last(), Some(TurnEvent::Finished { outcome, .. }) if outcome == "completed"));
        assert!(!events.iter().any(|ev| matches!(ev, TurnEvent::Finished { outcome, .. } if outcome == "cancelled")));
    }

    #[tokio::test]
    async fn replaced_runs_reader_posts_stop_once() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let stops = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let stops2 = stops.clone();
        thread::spawn(move || {
            let (mut sock, _) = listener.accept().unwrap();
            let _ = read_http(&mut sock);
            write_http(
                &mut sock,
                "202 Accepted",
                "application/json",
                r#"{"run_id":"run_abc","status":"started","replayed":false}"#,
            );
            let (mut sock, _) = listener.accept().unwrap();
            let _ = read_http(&mut sock);
            let body = "id: 1\ndata: {\"event\":\"clarify.request\",\"run_id\":\"run_abc\",\"prompt_id\":\"p1\",\"execution_generation\":1,\"question\":\"Q\",\"choices\":[]}\n\n";
            write_http(&mut sock, "200 OK", "text/event-stream", body);
            let (mut sock, _) = listener.accept().unwrap();
            let head = read_http(&mut sock);
            if head.contains("/stop") {
                stops2.fetch_add(1, Ordering::SeqCst);
            }
            write_http(&mut sock, "200 OK", "application/json", r#"{"status":"stopping"}"#);
        });
        let http = Client::new();
        let stop = AtomicBool::new(false);
        let stop_requested = AtomicBool::new(false);
        let err = stream_turn(
            &http,
            &format!("http://{addr}"),
            "k",
            "sid",
            "hello",
            &stop,
            &stop_requested,
            |ev| {
                if matches!(ev, TurnEvent::ClarifyRequest { .. }) {
                    stop.store(true, Ordering::SeqCst);
                }
            },
        )
        .await
        .expect_err("replaced");
        assert!(matches!(err, HermesError::Cancelled));
        assert_eq!(stops.load(Ordering::SeqCst), 1);
        assert!(!stop_requested.load(Ordering::SeqCst));
    }

    #[tokio::test]
    async fn clarify_post_single_multi_text_skip_stale_and_run_recovery() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let seen = Arc::new(std::sync::Mutex::new(Vec::new()));
        let seen2 = seen.clone();
        thread::spawn(move || {
            for _ in 0..4 {
                let (mut sock, _) = listener.accept().unwrap();
                let head = read_http(&mut sock);
                seen2.lock().unwrap().push(head);
                let body = r#"{"run_id":"run_abc","status":"resolved","prompt_id":"p1"}"#;
                write_http(&mut sock, "200 OK", "application/json", body);
            }
        });
        let http = Client::new();
        let root = format!("http://{addr}/p/mt-coder");
        let answers = ["甲", "[\"甲\",\"乙\"]", "自己講", ""];
        for answer in answers {
            let outcome = submit_clarify(&http, &root, "test-key", "run_abc", "p1", 4, answer)
                .await
                .unwrap();
            assert_eq!(outcome, ClarifyOutcome::Resolved);
        }
        let reqs = seen.lock().unwrap();
        assert_eq!(reqs.len(), 4);
        for (req, answer) in reqs.iter().zip(answers) {
            assert!(req.starts_with("POST /p/mt-coder/v1/runs/run_abc/clarify "));
            assert!(req.to_ascii_lowercase().contains("authorization: bearer "));
            let json_body = req.split("\r\n\r\n").nth(1).unwrap_or("");
            let value: Value = serde_json::from_str(json_body.trim()).unwrap();
            assert_eq!(value["request_id"], "p1");
            assert_eq!(value["execution_generation"], 4);
            assert_eq!(value["answer"], answer);
            assert_eq!(value.as_object().unwrap().len(), 3);
            assert!(!json_body.contains("推薦"));
        }
        drop(reqs);

        let stale = TcpListener::bind("127.0.0.1:0").unwrap();
        let stale_addr = stale.local_addr().unwrap();
        let posts = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let posts2 = posts.clone();
        thread::spawn(move || {
            let (mut sock, _) = stale.accept().unwrap();
            let _ = read_http(&mut sock);
            posts2.fetch_add(1, Ordering::SeqCst);
            let body = r#"{"error":{"message":"stale_generation","code":"stale_generation"}}"#;
            write_http(&mut sock, "409 Conflict", "application/json", body);
        });
        let outcome = submit_clarify(
            &http,
            &format!("http://{stale_addr}/p/mt-coder"),
            "test-key",
            "run_abc",
            "p1",
            3,
            "甲",
        )
        .await
        .unwrap();
        assert_eq!(outcome, ClarifyOutcome::Stale);
        assert_eq!(posts.load(Ordering::SeqCst), 1);

        let settled = TcpListener::bind("127.0.0.1:0").unwrap();
        let settled_addr = settled.local_addr().unwrap();
        thread::spawn(move || {
            let (mut sock, _) = settled.accept().unwrap();
            let _ = read_http(&mut sock);
            write_http(
                &mut sock,
                "200 OK",
                "application/json",
                r#"{"run_id":"run_abc","status":"already_resolved","prompt_id":"p1"}"#,
            );
        });
        let outcome = submit_clarify(
            &http,
            &format!("http://{settled_addr}"),
            "k",
            "run_abc",
            "p1",
            4,
            "",
        )
        .await
        .unwrap();
        assert_eq!(outcome, ClarifyOutcome::AlreadyResolved);

        let recover = TcpListener::bind("127.0.0.1:0").unwrap();
        let recover_addr = recover.local_addr().unwrap();
        thread::spawn(move || {
            let (mut sock, _) = recover.accept().unwrap();
            let head = read_http(&mut sock);
            assert!(head.starts_with("GET /v1/runs/run_abc "));
            let body = r#"{"run_id":"run_abc","status":"started","pending_controls":[{"kind":"clarify","prompt_id":"p9","execution_generation":8,"question":"幾時？","choices":[],"multi_select":false,"timeout_s":600}]}"#;
            write_http(&mut sock, "200 OK", "application/json", body);
        });
        let value = fetch_run(&http, &format!("http://{recover_addr}"), "k", "run_abc")
            .await
            .unwrap();
        assert_eq!(value["pending_controls"][0]["prompt_id"], "p9");
        assert_eq!(value["pending_controls"][0]["question"], "幾時？");
        assert_eq!(value["status"], "started");

        let src = include_str!("hermes.rs");
        let start = src.find("pub async fn submit_clarify").expect("clarify");
        let end = src[start..].find("\npub async fn ").expect("next");
        let body = &src[start..start + end];
        assert!(body.contains("/v1/runs/{run_id}/clarify"));
        assert!(body.contains("\"answer\""));
        assert!(body.contains("execution_generation"));
        assert!(!body.contains("resolve_all"));
        assert!(!body.contains("println"));
        assert!(!body.contains("eprintln"));
        assert!(!body.contains("create_session"));
        let lib = include_str!("lib.rs");
        let cmd = lib.find("async fn respond_clarify").expect("command");
        let cmd_end = lib[cmd..].find("\n#[tauri::command]").expect("next command");
        let cmd_body = &lib[cmd..cmd + cmd_end];
        assert!(cmd_body.contains("submit_clarify"));
        assert!(!cmd_body.contains("println"));
        assert!(!cmd_body.contains("resolve_all"));
        assert!(!cmd_body.contains("create_session"));
    }

    #[tokio::test]
    async fn approval_post_includes_execution_generation_when_present() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let seen = Arc::new(std::sync::Mutex::new(String::new()));
        let seen2 = seen.clone();
        thread::spawn(move || {
            let (mut sock, _) = listener.accept().unwrap();
            *seen2.lock().unwrap() = read_http(&mut sock);
            write_http(
                &mut sock,
                "200 OK",
                "application/json",
                r#"{"run_id":"run_abc","choice":"once","request_id":"req_1"}"#,
            );
        });
        let http = Client::new();
        submit_approval(
            &http,
            &format!("http://{addr}/p/mt-coder"),
            "test-key",
            "run_abc",
            "req_1",
            "once",
            Some(4),
        )
        .await
        .unwrap();
        let req = seen.lock().unwrap();
        let value: Value = serde_json::from_str(req.split("\r\n\r\n").nth(1).unwrap_or("").trim()).unwrap();
        assert_eq!(value["choice"], "once");
        assert_eq!(value["request_id"], "req_1");
        assert_eq!(value["execution_generation"], 4);
        assert_eq!(value.as_object().unwrap().len(), 3);
    }

    #[test]
    fn command_catalog_keeps_client_maps_and_falls_back_when_missing() {
        let value = json!({
            "object": "list",
            "data": [
                {"name":"/plan","kind":"prompt","category":"Session","description":"計劃","args_hint":"[task]","aliases":[],"enabled":true},
                {"name":"/new","kind":"client","category":"Session","description":"新","args_hint":"[name]","aliases":["/reset"],"enabled":true,"maps_to":"POST /api/sessions"}
            ]
        });
        let cmds = parse_command_catalog(&value);
        assert_eq!(cmds[1].maps_to.as_deref(), Some("POST /api/sessions"));
        assert_eq!(cmds[1].aliases, vec!["/reset"]);
        let (empty, hint) = commands_from_fetch(Ok(CatalogFetch::Missing), &cmds);
        assert!(empty.is_empty());
        assert_eq!(hint, PLUGIN_HINT);
        let (kept, quiet) = commands_from_fetch(Ok(CatalogFetch::NotModified), &cmds);
        assert_eq!(kept.len(), 2);
        assert!(quiet.is_empty());
        let (down, down_hint) =
            commands_from_fetch(Err(HermesError::Connect("refused".into())), &[]);
        assert!(down.is_empty());
        assert_eq!(down_hint, PLUGIN_HINT);
        let models = parse_model_options(&json!({
            "providers": [{"name":"ollama","models":["qwen2.5","llama3"]}]
        }));
        assert_eq!(models, vec!["ollama / qwen2.5", "ollama / llama3"]);
    }

    #[tokio::test]
    async fn overlay_commands_use_etag_and_404_is_empty() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        thread::spawn(move || {
            for _ in 0..2 {
                let (mut sock, _) = listener.accept().unwrap();
                let mut buf = [0u8; 4096];
                let n = sock.read(&mut buf).unwrap_or(0);
                let req = String::from_utf8_lossy(&buf[..n]).to_ascii_lowercase();
                let (status, extra, body) = if req.contains("if-none-match:") {
                    ("304 Not Modified", "ETag: \"cat\"\r\n", String::new())
                } else {
                    (
                        "200 OK",
                        "ETag: \"cat\"\r\n",
                        r#"{"data":[{"name":"/plan","kind":"prompt","category":"Session","description":"計劃","args_hint":"[task]","aliases":[],"enabled":true}]}"#.to_string(),
                    )
                };
                let header = format!(
                    "HTTP/1.1 {status}\r\nContent-Type: application/json\r\n{extra}Content-Length: {}\r\nConnection: close\r\n\r\n",
                    body.len()
                );
                let _ = sock.write_all(header.as_bytes());
                let _ = sock.write_all(body.as_bytes());
            }
        });
        let http = Client::new();
        let base = format!("http://{addr}");
        let fresh = fetch_overlay_commands(&http, &base, "k", None)
            .await
            .unwrap();
        match fresh {
            CatalogFetch::Fresh { etag, commands } => {
                assert_eq!(etag, "\"cat\"");
                assert_eq!(commands[0].name, "/plan");
                let again = fetch_overlay_commands(&http, &base, "k", Some(&etag))
                    .await
                    .unwrap();
                assert!(matches!(again, CatalogFetch::NotModified));
            }
            other => panic!("expected catalog, got {other:?}"),
        }
        let missing = oneshot("404 Not Found", "application/json", r#"{"error":"no"}"#);
        let gone = fetch_overlay_commands(&http, &missing, "k", None)
            .await
            .unwrap();
        assert!(matches!(gone, CatalogFetch::Missing));
    }

    #[tokio::test]
    async fn stream_surfaces_the_command_header() {
        let body = "\
event: assistant.delta\n\
data: {\"delta\":\"計劃\"}\n\
\n\
event: run.completed\n\
data: {}\n\
\n";
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let body = body.to_string();
        thread::spawn(move || {
            let (mut sock, _) = listener.accept().unwrap();
            let mut buf = [0u8; 2048];
            let _ = sock.read(&mut buf);
            let header = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nX-Hermes-Command: skill:arxiv\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                body.len()
            );
            let _ = sock.write_all(header.as_bytes());
            let _ = sock.write_all(body.as_bytes());
        });
        let http = Client::new();
        let seen = Arc::new(std::sync::Mutex::new(Vec::new()));
        let seen2 = seen.clone();
        let stop = AtomicBool::new(false);
        let stop_requested = AtomicBool::new(false);
        stream_turn(
            &http,
            &format!("http://{addr}"),
            "k",
            "sid",
            "/arxiv q",
            &stop, &stop_requested,
            |ev| {
                seen2.lock().unwrap().push(ev);
            },
        )
        .await
        .unwrap();
        let seen = seen.lock().unwrap();
        assert!(matches!(seen[0], TurnEvent::Command(ref name) if name == "skill:arxiv"));
        assert!(matches!(seen[1], TurnEvent::Delta(ref text) if text == "計劃"));
    }

    #[tokio::test]
    async fn a_closed_gateway_skips_the_quiet_roster_tick() {
        let http = reqwest::Client::new();
        let err = require_gateway(&http, "http://127.0.0.1:1")
            .await
            .expect_err("closed port");
        let text = explain(&err);
        assert!(
            text.contains("連唔到") || text.contains("逾時") || text.contains("中斷"),
            "{text}"
        );
    }

    #[test]
    fn connect_explanation_hides_the_gateway_url() {
        let msg = explain(&HermesError::Connect(
            "error sending request for url (http://127.0.0.1:8642/)".into(),
        ));
        assert!(!msg.contains("http://"));
        assert!(!msg.contains("127.0.0.1"));
        assert!(msg.contains("8642"));
    }

    #[test]
    fn kanban_board_orders_columns_and_hides_archived() {
        let value = json!({
            "board": "default",
            "columns": [
                {"name": "done", "tasks": [
                    {"id": "a", "title": "完成", "assignee": "計劃", "status": "done", "priority": "low", "updated_at": "1"},
                    {"id": 9, "title": "封存", "status": "archived"}
                ]},
                {"name": "todo", "tasks": [
                    {"id": "b", "title": "未做", "status": "todo", "priority": "high"}
                ]}
            ]
        });
        let board = parse_kanban_board(&value, "default");
        assert!(!board.unavailable);
        assert_eq!(
            board
                .columns
                .iter()
                .map(|column| column.name.as_str())
                .collect::<Vec<_>>(),
            KANBAN_STATUSES.to_vec()
        );
        assert_eq!(
            board
                .columns
                .iter()
                .flat_map(|column| &column.tasks)
                .count(),
            2
        );
        let body = kanban_patch_body("running", "", "", "");
        assert_eq!(body, json!({"status": "running"}));
    }

    #[tokio::test]
    async fn kanban_404_is_an_empty_board() {
        let base = oneshot(
            "404 Not Found",
            "application/json",
            r#"{"error":"missing"}"#,
        );
        let http = Client::new();
        let board = fetch_kanban_board(&http, &base, "key", "default")
            .await
            .unwrap();
        assert!(board.unavailable);
        assert_eq!(board.message, KANBAN_UNAVAILABLE);
        assert!(board.message.contains("未有看板"));
        assert!(!board.message.contains("（404）"));
        assert!(KANBAN_EMPTY.contains("overlay-slash"));
        assert_ne!(board.message, KANBAN_EMPTY);
        assert!(board.columns.is_empty());
    }

    #[tokio::test]
    async fn thinking_events_include_run_started_and_tool_progress() {
        let body = "\
event: run.started\n\
data: {}\n\
\n\
event: tool.progress\n\
data: {\"tool_name\":\"terminal\",\"preview\":\"讀緊\"}\n\
\n\
event: assistant.delta\n\
data: {\"delta\":\"好\"}\n\
\n\
event: run.completed\n\
data: {\"completed\":true}\n\
\n";
        let base = oneshot("200 OK", "text/event-stream", body);
        let http = Client::new();
        let seen = Arc::new(std::sync::Mutex::new(Vec::new()));
        let seen2 = seen.clone();
        let stop = AtomicBool::new(false);
        let stop_requested = AtomicBool::new(false);
        stream_turn(&http, &base, "k", "sid", "hi", &stop, &stop_requested, |ev| {
            seen2.lock().unwrap().push(ev);
        })
        .await
        .unwrap();
        let seen = seen.lock().unwrap();
        assert!(matches!(seen[0], TurnEvent::Started { .. }));
        assert!(
            matches!(seen[1], TurnEvent::Tool { ref phase, ref preview, .. } if phase == "progress" && preview == "讀緊")
        );
        assert!(matches!(seen[2], TurnEvent::Delta(ref text) if text == "好"));
    }

    #[test]
    fn kanban_move_error_surfaces_409_and_422_reasons() {
        let conflict = HermesError::Http {
            status: 409,
            body: r#"{"error":"completion blocked: no result"}"#.into(),
        };
        let text = kanban_move_error(&conflict);
        assert_eq!(text, "看板拒絕呢次移動：completion blocked: no result");
        assert!(!text.contains('{'));
        let unprocessable = HermesError::Http {
            status: 422,
            body: r#"{"error":{"message":"needs a summary","code":"kanban_conflict"}}"#.into(),
        };
        assert_eq!(
            kanban_move_error(&unprocessable),
            "看板拒絕呢次移動：needs a summary"
        );
        let crashed = HermesError::Http {
            status: 500,
            body: r#"{"error":{"message":"overlay-slash failed","type":"server_error"}}"#.into(),
        };
        let crashed_text = kanban_move_error(&crashed);
        assert_eq!(crashed_text, "看板更新失敗：overlay-slash failed");
        assert!(!crashed_text.contains('{'));
    }

    #[tokio::test]
    async fn user_stop_keeps_the_delta_then_marks_cancelled_when_the_stream_ends() {
        let body = "\
event: assistant.delta\n\
data: {\"delta\":\"未講完\"}\n\
\n";
        let base = oneshot("200 OK", "text/event-stream", body);
        let http = Client::new();
        let seen = Arc::new(std::sync::Mutex::new(Vec::new()));
        let seen2 = seen.clone();
        let stop = AtomicBool::new(false);
        let stop_requested = AtomicBool::new(true);
        let err = stream_turn(&http, &base, "k", "sid", "hello", &stop, &stop_requested, |ev| {
            seen2.lock().unwrap().push(ev);
        })
        .await
        .expect_err("ended without a terminal after stop");
        assert!(matches!(err, HermesError::Cancelled));
        let seen = seen.lock().unwrap();
        assert!(matches!(seen.last(), Some(TurnEvent::Delta(text)) if text == "未講完"));
    }

    #[tokio::test]
    async fn queued_stream_without_a_terminal_is_not_a_protocol_error() {
        let body = "\
event: run.queued\n\
data: {\"status\":\"queued\"}\n\
\n";
        let base = oneshot("200 OK", "text/event-stream", body);
        let http = Client::new();
        let stop = AtomicBool::new(false);
        let stop_requested = AtomicBool::new(false);
        stream_turn(&http, &base, "k", "sid", "hello", &stop, &stop_requested, |_| {})
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn stop_post_uses_the_profile_prefix_once_and_409_is_not_active() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let seen = Arc::new(std::sync::Mutex::new(String::new()));
        let seen2 = seen.clone();
        let posts = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let posts2 = posts.clone();
        thread::spawn(move || {
            let (mut sock, _) = listener.accept().unwrap();
            let mut buf = [0u8; 8192];
            let n = sock.read(&mut buf).unwrap_or(0);
            posts2.fetch_add(1, Ordering::SeqCst);
            *seen2.lock().unwrap() = String::from_utf8_lossy(&buf[..n]).into_owned();
            let body = r#"{"run_id":"run_abc","status":"stopping","token":"sk-test-secret"}"#;
            let header = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                body.len()
            );
            let _ = sock.write_all(header.as_bytes());
            let _ = sock.write_all(body.as_bytes());
        });
        let http = Client::new();
        let outcome = stop_run(&http, &format!("http://{addr}/p/mt-coder"), "test-key", "run_abc")
            .await
            .unwrap();
        assert_eq!(outcome, StopOutcome::Stopping);
        let req = seen.lock().unwrap();
        assert!(req.starts_with("POST /p/mt-coder/v1/runs/run_abc/stop "));
        let req_body = req.split("\r\n\r\n").nth(1).unwrap_or("").trim();
        assert!(req_body.is_empty());
        assert!(req.to_ascii_lowercase().contains("authorization: bearer "));
        assert!(!req.contains("sk-test-secret"));
        drop(req);
        assert_eq!(posts.load(Ordering::SeqCst), 1);

        let stale = TcpListener::bind("127.0.0.1:0").unwrap();
        let stale_addr = stale.local_addr().unwrap();
        let stale_posts = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let stale_posts2 = stale_posts.clone();
        thread::spawn(move || {
            let (mut sock, _) = stale.accept().unwrap();
            let mut buf = [0u8; 2048];
            let _ = sock.read(&mut buf);
            stale_posts2.fetch_add(1, Ordering::SeqCst);
            let body = r#"{"error":{"code":"run_not_active","token":"sk-test-secret"}}"#;
            let header = format!(
                "HTTP/1.1 409 Conflict\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                body.len()
            );
            let _ = sock.write_all(header.as_bytes());
            let _ = sock.write_all(body.as_bytes());
        });
        let inactive = stop_run(
            &http,
            &format!("http://{stale_addr}/p/mt-coder"),
            "test-key",
            "run_abc",
        )
        .await
        .unwrap();
        assert_eq!(inactive, StopOutcome::NotActive);
        assert_eq!(stale_posts.load(Ordering::SeqCst), 1);

        assert_eq!(
            stop_target_ids("run_queued", "run_live"),
            vec!["run_live".to_string(), "run_queued".to_string()]
        );
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let paths = Arc::new(std::sync::Mutex::new(Vec::new()));
        let paths2 = paths.clone();
        thread::spawn(move || {
            let (mut sock, _) = listener.accept().unwrap();
            let mut buf = [0u8; 4096];
            let n = sock.read(&mut buf).unwrap_or(0);
            let head = String::from_utf8_lossy(&buf[..n]).to_string();
            let line = head.lines().next().unwrap_or("").to_string();
            let queued = line.contains("/runs/run_queued/stop");
            paths2.lock().unwrap().push(line);
            let (status, body) = if queued {
                ("409 Conflict", r#"{"error":{"code":"run_not_active"}}"#)
            } else {
                ("200 OK", r#"{"run_id":"run_live","status":"stopping"}"#)
            };
            let header = format!(
                "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                body.len()
            );
            let _ = sock.write_all(header.as_bytes());
            let _ = sock.write_all(body.as_bytes());
        });
        let root = format!("http://{addr}/p/mt-coder");
        let mut outcome = StopOutcome::NotActive;
        for id in stop_target_ids("run_queued", "run_live") {
            outcome = stop_run(&http, &root, "test-key", &id).await.unwrap();
            if outcome == StopOutcome::Stopping {
                break;
            }
        }
        assert_eq!(outcome, StopOutcome::Stopping);
        let seen_paths = paths.lock().unwrap();
        assert_eq!(seen_paths.len(), 1);
        assert!(seen_paths[0].contains("POST /p/mt-coder/v1/runs/run_live/stop "));
        drop(seen_paths);

        let src = include_str!("hermes.rs");
        let start = src.find("pub async fn stop_run").expect("stop_run");
        let end = src[start..].find("pub async fn steer_run").expect("steer");
        let body = &src[start..start + end];
        assert!(body.contains("/v1/runs/{run_id}/stop"));
        assert!(body.contains("body: String::new()"));
        assert!(!body.contains("println"));
        assert!(!body.contains("eprintln"));
        assert!(!body.contains("config::save"));
    }

    #[tokio::test]
    async fn steer_post_sends_only_input_and_409_is_rejected() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let seen = Arc::new(std::sync::Mutex::new(String::new()));
        let seen2 = seen.clone();
        thread::spawn(move || {
            let (mut sock, _) = listener.accept().unwrap();
            let mut buf = [0u8; 8192];
            let n = sock.read(&mut buf).unwrap_or(0);
            *seen2.lock().unwrap() = String::from_utf8_lossy(&buf[..n]).into_owned();
            let body = r#"{"object":"hermes.run.steer","run_id":"run_abc","accepted":true,"token":"sk-test-secret"}"#;
            let header = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                body.len()
            );
            let _ = sock.write_all(header.as_bytes());
            let _ = sock.write_all(body.as_bytes());
        });
        let http = Client::new();
        let joined = steer_run(
            &http,
            &format!("http://{addr}/p/mt-coder"),
            "test-key",
            "run_abc",
            "等陣",
        )
        .await
        .unwrap();
        assert_eq!(joined, SteerOutcome::Joined);
        let req = seen.lock().unwrap();
        assert!(req.starts_with("POST /p/mt-coder/v1/runs/run_abc/steer "));
        let json_body = req.split("\r\n\r\n").nth(1).unwrap_or("");
        let value: Value = serde_json::from_str(json_body.trim()).unwrap();
        assert_eq!(value["input"], "等陣");
        assert_eq!(value.as_object().unwrap().len(), 1);
        assert!(req.to_ascii_lowercase().contains("authorization: bearer "));
        drop(req);

        let stale = TcpListener::bind("127.0.0.1:0").unwrap();
        let stale_addr = stale.local_addr().unwrap();
        let stale_posts = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let stale_posts2 = stale_posts.clone();
        thread::spawn(move || {
            let (mut sock, _) = stale.accept().unwrap();
            let mut buf = [0u8; 2048];
            let _ = sock.read(&mut buf);
            stale_posts2.fetch_add(1, Ordering::SeqCst);
            let body = r#"{"error":{"code":"run_not_accepting_steer","token":"sk-test-secret"}}"#;
            let header = format!(
                "HTTP/1.1 409 Conflict\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                body.len()
            );
            let _ = sock.write_all(header.as_bytes());
            let _ = sock.write_all(body.as_bytes());
        });
        let rejected = steer_run(
            &http,
            &format!("http://{stale_addr}/p/mt-coder"),
            "test-key",
            "run_abc",
            "等陣",
        )
        .await
        .unwrap();
        assert_eq!(rejected, SteerOutcome::Rejected);
        assert_eq!(stale_posts.load(Ordering::SeqCst), 1);

        let src = include_str!("hermes.rs");
        let start = src.find("pub async fn steer_run").expect("steer");
        let end = src[start..].find("\nfn json_error_reason").expect("next");
        let body = &src[start..start + end];
        assert!(body.contains("/v1/runs/{run_id}/steer"));
        assert!(body.contains("\"input\""));
        assert!(body.contains("body: String::new()"));
        assert!(!body.contains("println"));
        assert!(!body.contains("eprintln"));
        assert!(!body.contains("config::save"));
    }
}
