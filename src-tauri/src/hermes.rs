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
use serde::Serialize;
use serde_json::Value;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

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
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TurnEvent {
    Delta(String),
    Commentary(String),
    Tool {
        phase: String,
        name: String,
        preview: String,
    },
    Finished {
        outcome: String,
        detail: String,
    },
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

pub fn find_bot_chat(sessions: &[SessionSummary]) -> Option<&SessionSummary> {
    let mut matches: Vec<&SessionSummary> = sessions
        .iter()
        .filter(|s| s.title == BOT_CHAT_TITLE)
        .collect();
    if matches.is_empty() {
        return None;
    }
    matches.sort_by(|a, b| {
        let rank = |s: &&SessionSummary| if s.hidden == Some(true) { 0 } else { 1 };
        rank(a).cmp(&rank(b)).then_with(|| {
            b.last_active
                .partial_cmp(&a.last_active)
                .unwrap_or(std::cmp::Ordering::Equal)
        })
    });
    matches.into_iter().next()
}

pub fn parse_session_list(value: &Value) -> Vec<SessionSummary> {
    let items = value
        .get("data")
        .or_else(|| value.get("sessions"))
        .and_then(Value::as_array)
        .cloned()
        .or_else(|| value.as_array().cloned())
        .unwrap_or_default();
    items
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
            let hidden = item.get("hidden").and_then(Value::as_bool);
            let last_active = item
                .get("last_active")
                .or_else(|| item.get("started_at"))
                .and_then(Value::as_f64)
                .unwrap_or(0.0);
            let preview = item
                .get("preview")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            Some(SessionSummary {
                id,
                title,
                hidden,
                last_active,
                preview,
            })
        })
        .collect()
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

pub async fn list_sessions(
    http: &Client,
    root: &str,
    key: &str,
) -> Result<Vec<SessionSummary>, HermesError> {
    let url = format!("{root}/api/sessions?limit=200&title=Bot%20Chat&include_hidden=true");
    let resp = send(http.get(url).timeout(Duration::from_secs(20)), key).await?;
    let value: Value = resp
        .json()
        .await
        .map_err(|e| HermesError::Protocol(format!("session list 唔係 JSON：{e}")))?;
    Ok(parse_session_list(&value))
}

pub async fn ensure_bot_chat(http: &Client, root: &str, key: &str) -> Result<String, HermesError> {
    let sessions = list_sessions(http, root, key).await?;
    if let Some(session) = find_bot_chat(&sessions) {
        return Ok(session.id.clone());
    }
    let url = format!("{root}/api/sessions");
    let create = send(
        http.post(url)
            .timeout(Duration::from_secs(20))
            .json(&serde_json::json!({
                "title": BOT_CHAT_TITLE,
                "source": "api_server"
            })),
        key,
    )
    .await;
    match create {
        Ok(resp) => {
            let value: Value = resp
                .json()
                .await
                .map_err(|e| HermesError::Protocol(format!("建立 session 回應唔係 JSON：{e}")))?;
            session_id_from_create(&value)
                .ok_or_else(|| HermesError::Protocol("建立 session 回應冇 id".into()))
        }
        Err(HermesError::Http { status: 400, body }) => {
            conflict_session_id(&body).ok_or(HermesError::Http { status: 400, body })
        }
        Err(err) => Err(err),
    }
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

pub async fn list_dashboard_profiles(
    http: &Client,
    dashboard: &str,
    token: Option<&str>,
) -> Result<Vec<DiscoveredProfile>, HermesError> {
    let url = format!("{}/api/profiles", dashboard.trim_end_matches('/'));
    let mut req = http
        .get(url)
        .timeout(Duration::from_secs(15))
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
        let detail = item
            .get("description")
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim()
            .to_string();
        out.push(DiscoveredProfile {
            profile,
            display_name,
            detail,
        });
    }
    out
}

pub async fn stream_turn<F>(
    http: &Client,
    root: &str,
    key: &str,
    session_id: &str,
    text: &str,
    stop: &AtomicBool,
    mut on_event: F,
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

    let mut stream = resp.bytes_stream();
    let mut decoder = sse::ByteBuf::new();
    let mut saw_terminal = false;
    let mut streamed = false;
    let mut pending_failure: Option<String> = None;
    while let Some(chunk) = stream.next().await {
        if stop.load(Ordering::Relaxed) {
            return Err(HermesError::Cancelled);
        }
        let bytes = chunk.map_err(map_reqwest)?;
        for event in decoder.push(&bytes) {
            if stop.load(Ordering::Relaxed) {
                return Err(HermesError::Cancelled);
            }
            if apply_sse(
                event,
                &mut streamed,
                &mut saw_terminal,
                &mut pending_failure,
                &mut on_event,
            ) {
                saw_terminal = true;
            }
        }
    }
    for event in decoder.finish() {
        if apply_sse(
            event,
            &mut streamed,
            &mut saw_terminal,
            &mut pending_failure,
            &mut on_event,
        ) {
            saw_terminal = true;
        }
    }
    if stop.load(Ordering::Relaxed) {
        return Err(HermesError::Cancelled);
    }
    if !saw_terminal {
        return Err(HermesError::Protocol(
            "串流未有 run.completed / run.failed / run.cancelled 就結束".into(),
        ));
    }
    Ok(())
}

fn apply_sse<F>(
    event: SseEvent,
    streamed: &mut bool,
    saw_terminal: &mut bool,
    pending_failure: &mut Option<String>,
    on_event: &mut F,
) -> bool
where
    F: FnMut(TurnEvent),
{
    let payload: Value = serde_json::from_str(&event.data).unwrap_or(Value::Null);
    match event.event.as_str() {
        "assistant.delta" => {
            let text = payload
                .get("delta")
                .or_else(|| payload.get("text"))
                .and_then(Value::as_str)
                .unwrap_or("");
            if !text.is_empty() {
                *streamed = true;
                *pending_failure = None;
                on_event(TurnEvent::Delta(text.to_string()));
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
                on_event(TurnEvent::Delta(text));
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
                on_event(TurnEvent::Commentary(text.to_string()));
            }
            false
        }
        "tool.started" | "tool.completed" | "tool.failed" => {
            let phase = event
                .event
                .strip_prefix("tool.")
                .unwrap_or("started")
                .to_string();
            on_event(TurnEvent::Tool {
                phase,
                name: tool_name(&payload),
                preview: preview_text(&payload),
            });
            false
        }
        "run.completed" => {
            *saw_terminal = true;
            on_event(TurnEvent::Finished {
                outcome: "completed".into(),
                detail: String::new(),
            });
            true
        }
        "run.failed" => {
            *saw_terminal = true;
            let detail = failure_detail(&payload, pending_failure.as_deref());
            on_event(TurnEvent::Finished {
                outcome: "failed".into(),
                detail,
            });
            true
        }
        "run.cancelled" => {
            *saw_terminal = true;
            on_event(TurnEvent::Finished {
                outcome: "cancelled".into(),
                detail: String::new(),
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
                detail: clip(&detail, 400),
            });
            true
        }
        _ => false,
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
    clip(&parts.join("\n\n"), 2000)
}

pub fn explain(err: &HermesError) -> String {
    match err {
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

    #[test]
    fn prefers_hidden_bot_chat() {
        let sessions = vec![
            SessionSummary {
                id: "visible".into(),
                title: "Bot Chat".into(),
                hidden: Some(false),
                last_active: 50.0,
                preview: String::new(),
            },
            SessionSummary {
                id: "hidden".into(),
                title: "Bot Chat".into(),
                hidden: Some(true),
                last_active: 10.0,
                preview: String::new(),
            },
            SessionSummary {
                id: "other".into(),
                title: "notes".into(),
                hidden: None,
                last_active: 99.0,
                preview: String::new(),
            },
        ];
        assert_eq!(find_bot_chat(&sessions).unwrap().id, "hidden");
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
        assert_eq!(find_bot_chat(&sessions).unwrap().id, "abc");
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
        stream_turn(&http, &base, "k", "sid", "hello", &stop, |ev| {
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
        stream_turn(&http, &base, "k", "sid", "hello", &stop, |ev| {
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
            Some(TurnEvent::Finished { outcome, detail }) => {
                assert_eq!(outcome, "failed");
                assert!(detail.contains("does-not-exist-model"));
                assert!(detail.contains("Your request was not processed."));
                assert!(!detail.is_empty());
            }
            other => panic!("expected failed finish, got {other:?}"),
        }
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
}
