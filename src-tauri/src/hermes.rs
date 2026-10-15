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
    Started,
    Delta(String),
    Commentary(String),
    Command(String),
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

#[derive(Debug, Clone, PartialEq)]
pub struct ResolvedSession {
    pub id: String,
    pub explicit: bool,
    pub anchor: f64,
}

/// Highest `last_active`. Equal timestamps keep the smaller id.
pub fn most_recent_session(sessions: &[SessionSummary]) -> Option<&SessionSummary> {
    sessions
        .iter()
        .max_by(|a, b| match a.last_active.partial_cmp(&b.last_active) {
            Some(std::cmp::Ordering::Greater) => std::cmp::Ordering::Greater,
            Some(std::cmp::Ordering::Less) => std::cmp::Ordering::Less,
            _ => b.id.cmp(&a.id),
        })
}

/// Latest session by default. An explicit pick sticks until a session is active
/// after `anchor`, or until that pick disappears.
pub fn resolve_session(
    sessions: &[SessionSummary],
    remembered: &str,
    explicit: bool,
    anchor: f64,
) -> Option<ResolvedSession> {
    let latest = most_recent_session(sessions)?;
    let remembered = remembered.trim();
    let picked = if explicit && !remembered.is_empty() {
        sessions.iter().find(|session| session.id == remembered)
    } else {
        None
    };
    if let Some(picked) = picked {
        if latest.last_active > anchor && latest.id != picked.id {
            return Some(ResolvedSession {
                id: latest.id.clone(),
                explicit: false,
                anchor: latest.last_active,
            });
        }
        return Some(ResolvedSession {
            id: picked.id.clone(),
            explicit: true,
            anchor: anchor.max(latest.last_active),
        });
    }
    Some(ResolvedSession {
        id: latest.id.clone(),
        explicit: false,
        anchor: latest.last_active,
    })
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
    let url = format!("{root}/api/sessions?limit=200&include_hidden=true");
    let resp = send(http.get(url).timeout(Duration::from_secs(20)), key).await?;
    let value: Value = resp
        .json()
        .await
        .map_err(|e| HermesError::Protocol(format!("session list 唔係 JSON：{e}")))?;
    Ok(parse_session_list(&value))
}

pub async fn ensure_bot_chat(http: &Client, root: &str, key: &str) -> Result<String, HermesError> {
    let sessions = list_sessions(http, root, key).await?;
    if let Some(session) = most_recent_session(&sessions) {
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
pub const KANBAN_STATUSES: [&str; 6] = ["triage", "todo", "ready", "running", "blocked", "done"];

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

fn task_from(value: &Value, fallback_status: &str) -> Option<KanbanTask> {
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
    Some(KanbanTask {
        id,
        title: json_string(value, "title"),
        assignee: json_string(value, "assignee"),
        status,
        priority: json_string(value, "priority"),
        updated_at: json_string(value, "updated_at"),
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
        message: String::new(),
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
            message: KANBAN_EMPTY.to_string(),
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
        "run.started" => {
            on_event(TurnEvent::Started);
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
        "tool.started" | "tool.completed" | "tool.failed" | "tool.progress" => {
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
    fn latest_session_is_not_limited_to_bot_chat() {
        let sessions = vec![
            SessionSummary {
                id: "visible".into(),
                title: "Bot Chat".into(),
                hidden: Some(false),
                last_active: 50.0,
                preview: String::new(),
            },
            SessionSummary {
                id: "split".into(),
                title: "_splitLot".into(),
                hidden: Some(true),
                last_active: 10.0,
                preview: String::new(),
            },
            SessionSummary {
                id: "desktop".into(),
                title: "System Architect".into(),
                hidden: None,
                last_active: 99.0,
                preview: String::new(),
            },
        ];
        assert_eq!(most_recent_session(&sessions).unwrap().id, "desktop");
        let stale = resolve_session(&sessions, "split", false, 10.0).unwrap();
        assert_eq!(stale.id, "desktop");
        assert!(!stale.explicit);
        let pinned = resolve_session(&sessions, "split", true, 99.0).unwrap();
        assert_eq!(pinned.id, "split");
        assert!(pinned.explicit);
        let newer = resolve_session(&sessions, "split", true, 40.0).unwrap();
        assert_eq!(newer.id, "desktop");
        assert!(!newer.explicit);
        assert_eq!(newer.anchor, 99.0);
        assert!(resolve_session(&[], "split", true, 1.0).is_none());
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
        assert!(profiles_from_health_body("ok").is_empty());
        assert!(profiles_from_health_body(r#"{"status":"ok"}"#).is_empty());
        let health = profiles_from_health_body(
            r#"{"status":"ok","profiles":[{"profile":"coder","description":"程式"}]}"#,
        );
        assert_eq!(health.len(), 1);
        assert_eq!(health[0].profile, "coder");
        assert_eq!(health[0].detail, "程式");
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
        stream_turn(
            &http,
            &format!("http://{addr}"),
            "k",
            "sid",
            "/arxiv q",
            &stop,
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
        assert_eq!(board.message, KANBAN_EMPTY);
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
        stream_turn(&http, &base, "k", "sid", "hi", &stop, |ev| {
            seen2.lock().unwrap().push(ev);
        })
        .await
        .unwrap();
        let seen = seen.lock().unwrap();
        assert!(matches!(seen[0], TurnEvent::Started));
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
}
