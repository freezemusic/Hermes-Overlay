//! Devon's kanban lives on `hermes serve` (port 9119), not the gateway.
//! Reads are GET only. Tokens and the basic password stay in this app's keyring.

use crate::hermes::{
    parse_kanban_board, DiscoveredProfile, HermesError, KanbanBoard, KanbanTask, ProfileBearer,
    KANBAN_LOGIN, KANBAN_UNAVAILABLE,
};
use reqwest::header::{HeaderMap, AUTHORIZATION, COOKIE, SET_COOKIE};
use reqwest::Client;
use serde::Serialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

pub const LOGIN_MESSAGE: &str = KANBAN_LOGIN;

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct KanbanSecrets {
    pub access_token: String,
    pub refresh_token: String,
    pub session_cookie: String,
    pub username: String,
    pub password: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct KanbanComment {
    pub author: String,
    pub body: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq, Default)]
pub struct KanbanBoardList {
    pub boards: Vec<String>,
    pub current: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct KanbanTaskDetail {
    pub task: KanbanTask,
    pub comments: Vec<KanbanComment>,
    pub events: Vec<String>,
    pub runs: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NativeTokens {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_at: String,
}

/// Empty `configured` uses the gateway host with port 9119.
pub fn origin(gateway: &str, configured: &str) -> String {
    let configured = configured.trim().trim_end_matches('/');
    if !configured.is_empty() {
        return configured.to_string();
    }
    let Ok(url) = reqwest::Url::parse(gateway.trim()) else {
        return "http://127.0.0.1:9119".into();
    };
    let Some(host) = url.host_str() else {
        return "http://127.0.0.1:9119".into();
    };
    format!("{}://{host}:9119", url.scheme())
}

/// An empty slug omits `?board=` so hermes serve returns its current board.
pub fn board_url(origin: &str, board: &str) -> String {
    let mut url = format!(
        "{}/api/plugins/kanban/board",
        origin.trim_end_matches('/')
    );
    if !board.trim().is_empty() {
        url.push_str("?board=");
        url.push_str(&query_escape(board.trim()));
    }
    url
}

pub fn boards_url(origin: &str) -> String {
    format!(
        "{}/api/plugins/kanban/boards",
        origin.trim_end_matches('/')
    )
}

pub fn task_url(origin: &str, id: &str) -> String {
    format!(
        "{}/api/plugins/kanban/tasks/{}",
        origin.trim_end_matches('/'),
        query_escape(id.trim())
    )
}

pub fn pkce_challenge(verifier: &str) -> String {
    base64url(&Sha256::digest(verifier.as_bytes()))
}

pub fn authorize_url(origin: &str, challenge: &str, redirect: &str, state: &str) -> String {
    format!(
        "{}/auth/native/authorize?response_type=code&code_challenge={}&code_challenge_method=S256&redirect_uri={}&state={}",
        origin.trim_end_matches('/'),
        query_escape(challenge),
        query_escape(redirect),
        query_escape(state)
    )
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

fn base64url(bytes: &[u8]) -> String {
    const TABLE: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut out = String::new();
    let mut i = 0;
    while i + 3 <= bytes.len() {
        let n = ((bytes[i] as u32) << 16) | ((bytes[i + 1] as u32) << 8) | bytes[i + 2] as u32;
        out.push(TABLE[((n >> 18) & 63) as usize] as char);
        out.push(TABLE[((n >> 12) & 63) as usize] as char);
        out.push(TABLE[((n >> 6) & 63) as usize] as char);
        out.push(TABLE[(n & 63) as usize] as char);
        i += 3;
    }
    if i < bytes.len() {
        let mut n = (bytes[i] as u32) << 16;
        out.push(TABLE[((n >> 18) & 63) as usize] as char);
        if i + 1 < bytes.len() {
            n |= (bytes[i + 1] as u32) << 8;
            out.push(TABLE[((n >> 12) & 63) as usize] as char);
            out.push(TABLE[((n >> 6) & 63) as usize] as char);
        } else {
            out.push(TABLE[((n >> 12) & 63) as usize] as char);
        }
    }
    out
}

pub fn random_token(bytes: usize) -> String {
    let mut buf = vec![0u8; bytes.max(1)];
    if let Ok(mut file) = std::fs::File::open("/dev/urandom") {
        let _ = file.read_exact(&mut buf);
    } else {
        let ticks = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(1);
        for (i, slot) in buf.iter_mut().enumerate() {
            *slot = ((ticks >> ((i % 8) * 8)) as u8).wrapping_add(i as u8);
        }
    }
    base64url(&buf)
}

fn rejected_passwords() -> &'static Mutex<HashSet<String>> {
    static CELL: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    CELL.get_or_init(|| Mutex::new(HashSet::new()))
}

fn rejected_refreshes() -> &'static Mutex<HashSet<String>> {
    static CELL: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    CELL.get_or_init(|| Mutex::new(HashSet::new()))
}

fn credential_fingerprint(username: &str, password: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(username.trim().as_bytes());
    hasher.update([0]);
    hasher.update(password.as_bytes());
    base64url(&hasher.finalize())
}

fn password_is_rejected(username: &str, password: &str) -> bool {
    let fp = credential_fingerprint(username, password);
    rejected_passwords()
        .lock()
        .unwrap_or_else(|err| err.into_inner())
        .contains(&fp)
}

/// A 401/403 password attempt. Later polls skip it until the stored pair changes.
pub fn note_rejected_password(username: &str, password: &str) {
    let fp = credential_fingerprint(username, password);
    rejected_passwords()
        .lock()
        .unwrap_or_else(|err| err.into_inner())
        .insert(fp);
}

fn forget_rejected_password(username: &str, password: &str) {
    let fp = credential_fingerprint(username, password);
    rejected_passwords()
        .lock()
        .unwrap_or_else(|err| err.into_inner())
        .remove(&fp);
}

pub fn clear_rejected_password() {
    rejected_passwords()
        .lock()
        .unwrap_or_else(|err| err.into_inner())
        .clear();
}

fn refresh_is_rejected(refresh_token: &str) -> bool {
    let fp = credential_fingerprint("kanban-refresh", refresh_token);
    rejected_refreshes()
        .lock()
        .unwrap_or_else(|err| err.into_inner())
        .contains(&fp)
}

fn note_rejected_refresh(refresh_token: &str) {
    let fp = credential_fingerprint("kanban-refresh", refresh_token);
    rejected_refreshes()
        .lock()
        .unwrap_or_else(|err| err.into_inner())
        .insert(fp);
}

fn forget_rejected_refresh(refresh_token: &str) {
    let fp = credential_fingerprint("kanban-refresh", refresh_token);
    rejected_refreshes()
        .lock()
        .unwrap_or_else(|err| err.into_inner())
        .remove(&fp);
}

pub fn clear_rejected_refresh() {
    rejected_refreshes()
        .lock()
        .unwrap_or_else(|err| err.into_inner())
        .clear();
}

/// Kanban-port failures stay on the kanban surface. The words must not match `gatewayDown`.
pub fn explain_kanban(err: &HermesError) -> String {
    match err {
        HermesError::Connect(_) | HermesError::Timeout(_) | HermesError::Transport(_) => {
            "連唔到 Kanban。".into()
        }
        HermesError::Http { status: 401 | 403, .. } => LOGIN_MESSAGE.into(),
        HermesError::Http { status, .. } => format!("Kanban 回應 {status}。"),
        HermesError::Protocol(message) => message.clone(),
        HermesError::Cancelled => "已停止呢次回覆。".into(),
    }
}

fn map_reqwest(err: reqwest::Error) -> HermesError {
    if err.is_timeout() {
        HermesError::Timeout(err.to_string())
    } else if err.is_connect() {
        HermesError::Connect(err.to_string())
    } else {
        HermesError::Transport(err.to_string())
    }
}

fn session_expired(status: u16, _body: &str) -> bool {
    // Any board GET 401 is an expired or missing bearer. The body shape
    // differs (`invalid_or_expired_session`, `session_expired`, empty).
    // The refresh call is the only recovery; the body is not logged.
    status == 401
}

pub fn cookie_from_headers(headers: &HeaderMap) -> String {
    let mut parts = Vec::new();
    for value in headers.get_all(SET_COOKIE) {
        let Ok(text) = value.to_str() else {
            continue;
        };
        let pair = text.split(';').next().unwrap_or("").trim();
        let Some((name, cookie_value)) = pair.split_once('=') else {
            continue;
        };
        if name.trim().is_empty() || cookie_value.trim().is_empty() {
            continue;
        }
        parts.push(format!("{}={}", name.trim(), cookie_value.trim()));
    }
    parts.join("; ")
}

fn parse_tokens(value: &Value) -> Result<NativeTokens, HermesError> {
    let access = value
        .get("access_token")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .to_string();
    if access.is_empty() {
        return Err(HermesError::Protocol("登入回應冇 access token".into()));
    }
    Ok(NativeTokens {
        access_token: access,
        refresh_token: value
            .get("refresh_token")
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim()
            .to_string(),
        expires_at: value
            .get("expires_at")
            .map(|item| match item {
                Value::String(text) => text.trim().to_string(),
                Value::Number(number) => number.to_string(),
                _ => String::new(),
            })
            .unwrap_or_default(),
    })
}

fn apply_auth(
    builder: reqwest::RequestBuilder,
    secrets: &KanbanSecrets,
) -> reqwest::RequestBuilder {
    if !secrets.access_token.trim().is_empty() {
        builder.header(
            AUTHORIZATION,
            format!("Bearer {}", secrets.access_token.trim()),
        )
    } else if !secrets.session_cookie.trim().is_empty() {
        builder.header(COOKIE, secrets.session_cookie.trim())
    } else {
        builder
    }
}

enum ReadBody {
    Json(Value),
    Missing,
    Expired,
}

async fn get_json(
    http: &Client,
    url: &str,
    secrets: &KanbanSecrets,
) -> Result<ReadBody, HermesError> {
    let resp = apply_auth(http.get(url).timeout(Duration::from_secs(8)), secrets)
        .send()
        .await
        .map_err(map_reqwest)?;
    let status = resp.status().as_u16();
    if status == 404 {
        return Ok(ReadBody::Missing);
    }
    if !(200..300).contains(&status) {
        let body = resp.text().await.unwrap_or_default();
        if session_expired(status, &body) {
            return Ok(ReadBody::Expired);
        }
        return Err(HermesError::Http {
            status,
            body: String::new(),
        });
    }
    let value = resp
        .json()
        .await
        .map_err(|err| HermesError::Protocol(format!("kanban 回應唔係 JSON：{err}")))?;
    Ok(ReadBody::Json(value))
}

pub async fn password_login(
    http: &Client,
    origin: &str,
    username: &str,
    password: &str,
) -> Result<String, HermesError> {
    let url = format!("{}/auth/password-login", origin.trim_end_matches('/'));
    let resp = http
        .post(url)
        .timeout(Duration::from_secs(15))
        .json(&json!({
            "provider": "basic",
            "username": username.trim(),
            "password": password,
        }))
        .send()
        .await
        .map_err(map_reqwest)?;
    let status = resp.status().as_u16();
    if !(200..300).contains(&status) {
        return Err(HermesError::Http {
            status,
            body: String::new(),
        });
    }
    let cookie = cookie_from_headers(resp.headers());
    if cookie.is_empty() {
        return Err(HermesError::Protocol("登入回應冇 session cookie".into()));
    }
    Ok(cookie)
}

pub async fn refresh_tokens(
    http: &Client,
    origin: &str,
    refresh_token: &str,
) -> Result<NativeTokens, HermesError> {
    let url = format!("{}/auth/native/refresh", origin.trim_end_matches('/'));
    let resp = http
        .post(url)
        .timeout(Duration::from_secs(15))
        .json(&json!({ "refresh_token": refresh_token }))
        .send()
        .await
        .map_err(map_reqwest)?;
    let status = resp.status().as_u16();
    if !(200..300).contains(&status) {
        return Err(HermesError::Http {
            status,
            body: String::new(),
        });
    }
    let value: Value = resp
        .json()
        .await
        .map_err(|_| HermesError::Protocol("refresh 回應唔係 JSON".into()))?;
    parse_tokens(&value)
}

pub async fn exchange_code(
    http: &Client,
    origin: &str,
    code: &str,
    verifier: &str,
) -> Result<NativeTokens, HermesError> {
    let url = format!("{}/auth/native/token", origin.trim_end_matches('/'));
    let resp = http
        .post(url)
        .timeout(Duration::from_secs(15))
        .json(&json!({
            "code": code,
            "code_verifier": verifier,
        }))
        .send()
        .await
        .map_err(map_reqwest)?;
    let status = resp.status().as_u16();
    if !(200..300).contains(&status) {
        return Err(HermesError::Http {
            status,
            body: String::new(),
        });
    }
    let value: Value = resp
        .json()
        .await
        .map_err(|_| HermesError::Protocol("token 回應唔係 JSON".into()))?;
    parse_tokens(&value)
}

fn login_board(board: &str) -> KanbanBoard {
    KanbanBoard {
        board: board.to_string(),
        columns: Vec::new(),
        unavailable: false,
        needs_login: true,
        message: LOGIN_MESSAGE.to_string(),
    }
}

fn missing_board(board: &str) -> KanbanBoard {
    KanbanBoard {
        board: board.to_string(),
        columns: Vec::new(),
        unavailable: true,
        needs_login: false,
        message: KANBAN_UNAVAILABLE.to_string(),
    }
}

/// One native refresh. A rejected token is remembered so later polls do not POST it again.
pub async fn refresh_access_once(
    http: &Client,
    origin: &str,
    secrets: &mut KanbanSecrets,
) -> Result<bool, HermesError> {
    if secrets.refresh_token.trim().is_empty() {
        return Ok(false);
    }
    let token = secrets.refresh_token.trim().to_string();
    if refresh_is_rejected(&token) {
        return Ok(false);
    }
    match refresh_tokens(http, origin, &token).await {
        Ok(tokens) => {
            forget_rejected_refresh(&token);
            secrets.access_token = tokens.access_token;
            if !tokens.refresh_token.is_empty() {
                secrets.refresh_token = tokens.refresh_token;
            }
            Ok(true)
        }
        Err(HermesError::Http { status: 401 | 403, .. }) => {
            note_rejected_refresh(&token);
            Ok(false)
        }
        Err(err) => Err(err),
    }
}

async fn renew(
    http: &Client,
    origin: &str,
    secrets: &mut KanbanSecrets,
) -> Result<bool, HermesError> {
    if refresh_access_once(http, origin, secrets).await? {
        return Ok(true);
    }
    if !secrets.username.trim().is_empty() && !secrets.password.is_empty() {
        let username = secrets.username.trim().to_string();
        if password_is_rejected(&username, &secrets.password) {
            return Ok(false);
        }
        match password_login(http, origin, &username, &secrets.password).await {
            Ok(cookie) => {
                forget_rejected_password(&username, &secrets.password);
                secrets.session_cookie = cookie;
                secrets.access_token.clear();
                return Ok(true);
            }
            Err(HermesError::Http { status: 401 | 403, .. }) => {
                note_rejected_password(&username, &secrets.password);
                return Ok(false);
            }
            Err(err) => return Err(err),
        }
    }
    Ok(false)
}

pub struct NativeProfileRead {
    pub profiles: Vec<DiscoveredProfile>,
    pub secrets: KanbanSecrets,
    pub changed: bool,
    /// True only when `GET /api/profiles` answered 2xx with a list (R-SY-09 removal).
    pub listed: bool,
}

/// `GET {origin}/api/profiles` with the Kanban native access token.
/// A 401 refreshes once via `POST /auth/native/refresh`, then retries that GET once.
/// The profiles call itself stays GET. A miss returns no rows and does not fail the roster.
pub async fn read_native_profiles(
    http: &Client,
    origin: &str,
    mut secrets: KanbanSecrets,
) -> NativeProfileRead {
    if secrets.access_token.trim().is_empty() && secrets.refresh_token.trim().is_empty() {
        return NativeProfileRead {
            profiles: Vec::new(),
            secrets,
            changed: false,
            listed: false,
        };
    }
    let timeout = Duration::from_secs(4);
    let mut changed = false;
    let mut listed = if secrets.access_token.trim().is_empty() {
        ProfileBearer::Expired
    } else {
        crate::hermes::list_profiles_with_bearer(http, origin, &secrets.access_token, timeout).await
    };
    if matches!(listed, ProfileBearer::Expired) {
        match refresh_access_once(http, origin, &mut secrets).await {
            Ok(true) => {
                changed = true;
                listed = crate::hermes::list_profiles_with_bearer(
                    http,
                    origin,
                    &secrets.access_token,
                    timeout,
                )
                .await;
            }
            Ok(false) => {}
            Err(_) => {
                return NativeProfileRead {
                    profiles: Vec::new(),
                    secrets,
                    changed,
                    listed: false,
                };
            }
        }
    }
    let (profiles, listed) = match listed {
        ProfileBearer::Listed(rows) => (rows, true),
        ProfileBearer::Expired | ProfileBearer::Missed => (Vec::new(), false),
    };
    NativeProfileRead {
        profiles,
        secrets,
        changed,
        listed,
    }
}

/// GET the board. A 401 refreshes or renews once. Still unauthorized is a calm login state.
/// A real 404 is the missing-kanban state. Connection failures stay errors.
pub async fn read_board(
    http: &Client,
    origin: &str,
    board: &str,
    mut secrets: KanbanSecrets,
) -> Result<(KanbanBoard, KanbanSecrets, bool), HermesError> {
    let url = board_url(origin, board);
    let mut changed = false;
    let mut body = get_json(http, &url, &secrets).await?;
    if matches!(body, ReadBody::Expired) {
        let renewed = renew(http, origin, &mut secrets).await?;
        if renewed {
            changed = true;
            body = get_json(http, &url, &secrets).await?;
        }
    }
    match body {
        ReadBody::Json(value) => Ok((parse_kanban_board(&value, board), secrets, changed)),
        ReadBody::Missing => Ok((missing_board(board), secrets, changed)),
        ReadBody::Expired => Ok((login_board(board), secrets, changed)),
    }
}

fn json_field(value: &Value, key: &str) -> String {
    value
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .to_string()
}

/// `current` wins. `is_current` fills it when the response omits that field.
pub fn parse_kanban_boards(value: &Value) -> KanbanBoardList {
    let source = value.get("data").unwrap_or(value);
    let mut current = json_field(source, "current");
    let mut boards = Vec::new();
    if let Some(rows) = source.get("boards").and_then(Value::as_array) {
        for row in rows {
            let (slug, marked) = match row {
                Value::String(text) => (text.trim().to_string(), false),
                Value::Object(_) => {
                    let from_slug = json_field(row, "slug");
                    let slug = if from_slug.is_empty() {
                        json_field(row, "name")
                    } else {
                        from_slug
                    };
                    let marked = row.get("is_current").and_then(Value::as_bool) == Some(true);
                    (slug, marked)
                }
                _ => continue,
            };
            if slug.is_empty() {
                continue;
            }
            if marked && current.is_empty() {
                current = slug.clone();
            }
            if !boards.iter().any(|item: &String| item == &slug) {
                boards.push(slug);
            }
        }
    }
    if !current.is_empty() && !boards.iter().any(|item| item == &current) {
        boards.insert(0, current.clone());
    }
    KanbanBoardList { boards, current }
}

/// GET `/api/plugins/kanban/boards`. A missing route leaves the picker empty.
/// The board GET still follows the server's current board.
pub async fn read_boards(
    http: &Client,
    origin: &str,
    mut secrets: KanbanSecrets,
) -> Result<(KanbanBoardList, KanbanSecrets, bool), HermesError> {
    let url = boards_url(origin);
    let mut changed = false;
    let mut body = get_json(http, &url, &secrets).await?;
    if matches!(body, ReadBody::Expired) {
        let renewed = renew(http, origin, &mut secrets).await?;
        if renewed {
            changed = true;
            body = get_json(http, &url, &secrets).await?;
        }
    }
    match body {
        ReadBody::Json(value) => Ok((parse_kanban_boards(&value), secrets, changed)),
        ReadBody::Missing | ReadBody::Expired => Ok((KanbanBoardList::default(), secrets, changed)),
    }
}

pub fn parse_task_detail(value: &Value) -> Result<KanbanTaskDetail, HermesError> {
    let task_value = value.get("task").unwrap_or(value);
    let task = crate::hermes::task_from(task_value, "")
        .ok_or_else(|| HermesError::Protocol("看板卡片冇 id".into()))?;
    let comments = value
        .get("comments")
        .and_then(Value::as_array)
        .map(|rows| {
            rows.iter()
                .filter_map(|row| {
                    let body = row
                        .get("body")
                        .or_else(|| row.get("text"))
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .trim()
                        .to_string();
                    if body.is_empty() {
                        return None;
                    }
                    let author = row
                        .get("author")
                        .or_else(|| row.get("user"))
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .trim()
                        .to_string();
                    Some(KanbanComment { author, body })
                })
                .collect()
        })
        .unwrap_or_default();
    let events = lines_of(value.get("events"));
    let runs = lines_of(value.get("runs"));
    Ok(KanbanTaskDetail {
        task,
        comments,
        events,
        runs,
    })
}

fn lines_of(value: Option<&Value>) -> Vec<String> {
    let Some(rows) = value.and_then(Value::as_array) else {
        return Vec::new();
    };
    rows.iter()
        .filter_map(|row| {
            if let Some(text) = row.as_str() {
                let text = text.trim();
                return (!text.is_empty()).then(|| text.to_string());
            }
            for key in ["summary", "message", "type", "kind", "status"] {
                if let Some(text) = row.get(key).and_then(Value::as_str) {
                    let text = text.trim();
                    if !text.is_empty() {
                        return Some(text.to_string());
                    }
                }
            }
            None
        })
        .collect()
}

pub async fn read_task(
    http: &Client,
    origin: &str,
    id: &str,
    mut secrets: KanbanSecrets,
) -> Result<(KanbanTaskDetail, KanbanSecrets, bool), HermesError> {
    let url = task_url(origin, id);
    let mut changed = false;
    let mut body = get_json(http, &url, &secrets).await?;
    if matches!(body, ReadBody::Expired) {
        let renewed = renew(http, origin, &mut secrets).await?;
        if renewed {
            changed = true;
            body = get_json(http, &url, &secrets).await?;
        }
    }
    match body {
        ReadBody::Json(value) => Ok((parse_task_detail(&value)?, secrets, changed)),
        ReadBody::Missing => Err(HermesError::Protocol("搵唔到呢張卡".into())),
        ReadBody::Expired => Err(HermesError::Protocol(LOGIN_MESSAGE.into())),
    }
}

/// System-browser PKCE. The loopback code is exchanged at `/auth/native/token`.
pub async fn native_pkce_login<F>(
    http: &Client,
    origin: &str,
    timeout: Duration,
    open_url: F,
) -> Result<NativeTokens, HermesError>
where
    F: FnOnce(&str) -> Result<(), String> + Send + 'static,
{
    let verifier = random_token(32);
    let challenge = pkce_challenge(&verifier);
    let state = random_token(16);
    let listener = TcpListener::bind("127.0.0.1:0")
        .map_err(|err| HermesError::Protocol(format!("開唔到登入回呼：{err}")))?;
    let port = listener
        .local_addr()
        .map_err(|err| HermesError::Protocol(format!("開唔到登入回呼：{err}")))?
        .port();
    let redirect = format!("http://127.0.0.1:{port}/cb");
    let url = authorize_url(origin, &challenge, &redirect, &state);
    open_url(&url).map_err(HermesError::Protocol)?;
    let expected_state = state.clone();
    let (code, got_state) = tokio::task::spawn_blocking(move || wait_loopback(listener, timeout))
        .await
        .map_err(|err| HermesError::Protocol(format!("登入回呼中斷：{err}")))??;
    if got_state != expected_state {
        return Err(HermesError::Protocol("登入 state 唔夾".into()));
    }
    exchange_code(http, origin, &code, &verifier).await
}

fn percent_decode(raw: &str) -> String {
    let bytes = raw.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'+' => out.push(b' '),
            b'%' if i + 2 < bytes.len() => {
                let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).unwrap_or("");
                match u8::from_str_radix(hex, 16) {
                    Ok(byte) => {
                        out.push(byte);
                        i += 3;
                        continue;
                    }
                    Err(_) => out.push(b'%'),
                }
            }
            byte => out.push(byte),
        }
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// What one loopback request carried. Only `/cb` with `code` or `error` ends the wait.
#[derive(Debug, PartialEq, Eq)]
enum Callback {
    Code(String, String),
    Denied,
    Other,
}

fn parse_callback(head: &str) -> Callback {
    let target = head
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .unwrap_or("");
    let (path, query) = target.split_once('?').unwrap_or((target, ""));
    if path != "/cb" {
        return Callback::Other;
    }
    let mut code = String::new();
    let mut state = String::new();
    let mut denied = false;
    for pair in query.split('&') {
        let Some((key, value)) = pair.split_once('=') else {
            continue;
        };
        match key {
            "code" => code = percent_decode(value),
            "state" => state = percent_decode(value),
            "error" => denied = true,
            _ => {}
        }
    }
    if !code.is_empty() {
        Callback::Code(code, state)
    } else if denied {
        Callback::Denied
    } else {
        Callback::Other
    }
}

fn reply(sock: &mut std::net::TcpStream, status: &str, page: &str) {
    let header = format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        page.len()
    );
    let _ = sock.write_all(header.as_bytes());
    let _ = sock.write_all(page.as_bytes());
}

/// Waits for the browser's redirect to `/cb`. Browsers also open idle
/// preconnect sockets and ask for `/favicon.ico`; those get a short answer and
/// the wait goes on, so the first stray socket cannot end the sign-in.
fn wait_loopback(listener: TcpListener, timeout: Duration) -> Result<(String, String), HermesError> {
    listener
        .set_nonblocking(true)
        .map_err(|err| HermesError::Protocol(format!("登入回呼：{err}")))?;
    let start = std::time::Instant::now();
    loop {
        let mut sock = match listener.accept() {
            Ok((sock, _)) => sock,
            Err(err) if err.kind() == std::io::ErrorKind::WouldBlock => {
                if start.elapsed() > timeout {
                    return Err(HermesError::Protocol("登入逾時。可以喺設定填帳號密碼。".into()));
                }
                std::thread::sleep(Duration::from_millis(40));
                continue;
            }
            Err(err) => return Err(HermesError::Protocol(format!("登入回呼：{err}"))),
        };
        let _ = sock.set_nonblocking(false);
        sock.set_read_timeout(Some(Duration::from_millis(1500))).ok();
        let mut buf = [0u8; 8192];
        let mut len = 0;
        while len < buf.len() {
            match sock.read(&mut buf[len..]) {
                Ok(0) => break,
                Ok(n) => {
                    len += n;
                    if buf[..len].windows(4).any(|w| w == b"\r\n\r\n") {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
        let head = String::from_utf8_lossy(&buf[..len]).into_owned();
        match parse_callback(&head) {
            Callback::Code(code, state) => {
                reply(&mut sock, "200 OK", "已登入 Kanban。可以關閉呢個分頁。");
                return Ok((code, state));
            }
            Callback::Denied => {
                reply(&mut sock, "200 OK", "Kanban 登入取消咗。可以關閉呢個分頁。");
                return Err(HermesError::Protocol("Kanban 登入取消咗".into()));
            }
            Callback::Other => {
                if len > 0 {
                    reply(&mut sock, "404 Not Found", "");
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::sync::{Arc, Mutex};
    use std::thread;

    #[test]
    fn origin_uses_the_gateway_host_on_port_9119() {
        assert_eq!(
            origin("http://10.10.24.33:8642/", ""),
            "http://10.10.24.33:9119"
        );
        assert_eq!(
            origin("http://10.10.24.33:8642", "http://10.10.24.33:9120/"),
            "http://10.10.24.33:9120"
        );
        assert!(authorize_url(
            "http://10.10.24.33:9119",
            "chal",
            "http://127.0.0.1:9/cb",
            "st"
        )
        .contains("/auth/native/authorize"));
        assert_eq!(pkce_challenge("verifier"), pkce_challenge("verifier"));
        assert_ne!(pkce_challenge("verifier"), pkce_challenge("other"));
    }

    fn serve(
        handler: impl Fn(&str) -> (u16, &'static str, String) + Send + 'static,
    ) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        thread::spawn(move || {
            for _ in 0..8 {
                let Ok((mut sock, _)) = listener.accept() else {
                    break;
                };
                sock.set_read_timeout(Some(Duration::from_secs(2))).ok();
                let mut buf = vec![0u8; 16384];
                let n = sock.read(&mut buf).unwrap_or(0);
                let head = String::from_utf8_lossy(&buf[..n]).to_string();
                let (status, extra, body) = handler(&head);
                let reason = match status {
                    200 => "OK",
                    401 => "Unauthorized",
                    404 => "Not Found",
                    _ => "OK",
                };
                let header = format!(
                    "HTTP/1.1 {status} {reason}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n{extra}\r\n",
                    body.len()
                );
                let _ = sock.write_all(header.as_bytes());
                let _ = sock.write_all(body.as_bytes());
            }
        });
        format!("http://{addr}")
    }

    fn board_json() -> String {
        json!({
            "columns": [
                {"name": "todo", "tasks": [{
                    "id": "card-1",
                    "title": "真看板",
                    "assignee": "devon",
                    "status": "todo",
                    "priority": "high",
                    "body": "內文",
                    "comment_count": 2,
                    "created_at": 10
                }]},
                {"name": "review", "tasks": []}
            ]
        })
        .to_string()
    }

    #[tokio::test]
    async fn a_401_refreshes_then_reads_the_plugin_board_with_get_only() {
        let posts = Arc::new(Mutex::new(Vec::new()));
        let posts2 = posts.clone();
        let base = serve(move |head| {
            let line = head.lines().next().unwrap_or("");
            if line.contains("/api/plugins/kanban") && line.starts_with("POST") {
                posts2.lock().unwrap().push(line.to_string());
            }
            if line.starts_with("POST") && line.contains("/auth/native/refresh") {
                assert!(head.contains("refresh-old"));
                return (
                    200,
                    "",
                    r#"{"access_token":"access-new","refresh_token":"refresh-new","expires_at":99}"#
                        .into(),
                );
            }
            if line.starts_with("GET") && line.contains("/api/plugins/kanban/tasks/") {
                assert!(head.contains("Bearer access-new"));
                return (
                    200,
                    "",
                    r#"{"task":{"id":"card-1","title":"真看板","body":"內文","status":"todo"},"comments":[{"author":"devon","body":"睇過"}],"events":[{"type":"moved"}],"runs":[]}"#
                        .into(),
                );
            }
            if line.starts_with("GET") && line.contains("/api/plugins/kanban/board") {
                if head.contains("Bearer access-new") {
                    return (200, "", board_json());
                }
                return (
                    401,
                    "",
                    r#"{"error":"invalid_or_expired_session","login_url":"/login"}"#.into(),
                );
            }
            (404, "", r#"{"error":"nope"}"#.into())
        });
        let http = Client::new();
        let secrets = KanbanSecrets {
            refresh_token: "refresh-old".into(),
            ..KanbanSecrets::default()
        };
        let (board, next, changed) = read_board(&http, &base, "default", secrets).await.unwrap();
        assert!(changed);
        assert!(!board.unavailable);
        assert!(!board.needs_login);
        assert_eq!(next.access_token, "access-new");
        assert_eq!(next.refresh_token, "refresh-new");
        let card = board
            .columns
            .iter()
            .flat_map(|column| column.tasks.iter())
            .find(|task| task.id == "card-1")
            .unwrap();
        assert_eq!(card.title, "真看板");
        assert_eq!(card.body, "內文");
        assert_eq!(card.comment_count, 2);
        let names: Vec<_> = board.columns.iter().map(|column| column.name.as_str()).collect();
        assert_eq!(
            names,
            vec![
                "triage", "todo", "scheduled", "ready", "running", "blocked", "review", "done"
            ]
        );
        let (detail, _, _) = read_task(&http, &base, "card-1", next).await.unwrap();
        assert_eq!(detail.task.id, "card-1");
        assert_eq!(detail.comments[0].body, "睇過");
        assert_eq!(detail.events, vec!["moved".to_string()]);
        assert!(posts.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn a_401_on_profiles_refreshes_once_then_gets_the_roster() {
        let calls = Arc::new(Mutex::new(Vec::new()));
        let seen = calls.clone();
        let base = serve(move |head| {
            let line = head.lines().next().unwrap_or("").to_string();
            seen.lock().unwrap().push(line.clone());
            if line.starts_with("POST") && line.contains("/api/profiles") {
                return (500, "", r#"{"error":"roster must stay GET"}"#.into());
            }
            if line.starts_with("POST") && line.contains("/auth/native/refresh") {
                assert!(head.contains("refresh-roster-old"));
                assert!(!head.contains("access-roster-old"));
                return (
                    200,
                    "",
                    r#"{"access_token":"access-roster-new","refresh_token":"refresh-roster-new"}"#
                        .into(),
                );
            }
            if line.starts_with("GET") && line.contains("/api/profiles") {
                let lower = head.to_ascii_lowercase();
                assert!(lower.contains("authorization: bearer "), "{head}");
                assert!(!lower.contains("x-hermes-session-token"), "{head}");
                if head.contains("Bearer access-roster-new") {
                    return (
                        200,
                        "",
                        r#"{"profiles":[{"name":"mt-coder","display_name":"mt-coder"},{"name":"hr-8words","display_name":"hr-8words","description":"人事"}]}"#
                            .into(),
                    );
                }
                return (401, "", r#"{"error":"session_expired"}"#.into());
            }
            (404, "", "{}".into())
        });
        let http = Client::new();
        let secrets = KanbanSecrets {
            access_token: "access-roster-old".into(),
            refresh_token: "refresh-roster-old".into(),
            ..KanbanSecrets::default()
        };
        let read = read_native_profiles(&http, &base, secrets).await;
        assert!(read.changed);
        assert_eq!(read.secrets.access_token, "access-roster-new");
        assert_eq!(read.secrets.refresh_token, "refresh-roster-new");
        let names: Vec<_> = read.profiles.iter().map(|item| item.profile.as_str()).collect();
        assert_eq!(names, vec!["mt-coder", "hr-8words"]);
        assert_eq!(read.profiles[1].detail, "人事");
        let log = calls.lock().unwrap().clone();
        assert_eq!(log.iter().filter(|line| line.contains("/auth/native/refresh")).count(), 1);
        assert!(log.iter().all(|line| !line.starts_with("POST") || line.contains("/auth/native/refresh")));
        assert_eq!(log.iter().filter(|line| line.starts_with("GET") && line.contains("/api/profiles")).count(), 2);

        forget_rejected_refresh("refresh-roster-dead");
        let refreshes = Arc::new(Mutex::new(0u32));
        let counted = refreshes.clone();
        let again = serve(move |head| {
            let line = head.lines().next().unwrap_or("");
            if line.starts_with("POST") && line.contains("/auth/native/refresh") {
                *counted.lock().unwrap() += 1;
                return (401, "", r#"{"error":"invalid_or_expired_session"}"#.into());
            }
            if line.starts_with("POST") {
                return (500, "", r#"{"error":"roster must stay GET"}"#.into());
            }
            if line.starts_with("GET") && line.contains("/api/profiles") {
                return (401, "", r#"{"error":"session_expired"}"#.into());
            }
            (404, "", "{}".into())
        });
        let dead = KanbanSecrets {
            access_token: "access-roster-dead".into(),
            refresh_token: "refresh-roster-dead".into(),
            ..KanbanSecrets::default()
        };
        let first = read_native_profiles(&http, &again, dead.clone()).await;
        assert!(first.profiles.is_empty());
        let second = read_native_profiles(&http, &again, dead).await;
        assert!(second.profiles.is_empty());
        assert!(!second.changed);
        assert_eq!(*refreshes.lock().unwrap(), 1);
    }

    #[tokio::test]
    async fn password_login_stores_a_cookie_and_a_404_stays_unavailable() {
        let base = serve(|head| {
            let line = head.lines().next().unwrap_or("");
            if line.starts_with("POST") && line.contains("/auth/password-login") {
                assert!(head.contains("\"provider\":\"basic\""));
                assert!(head.contains("devon"));
                return (
                    200,
                    "Set-Cookie: hermes_session=abc123; Path=/; HttpOnly\r\n",
                    "{}".into(),
                );
            }
            if line.starts_with("GET") && line.contains("/api/plugins/kanban/board") {
                if head.contains("hermes_session=abc123") {
                    return (404, "", r#"{"error":"missing"}"#.into());
                }
                return (
                    401,
                    "",
                    r#"{"error":{"code":"invalid_or_expired_session"}}"#.into(),
                );
            }
            (404, "", "{}".into())
        });
        let http = Client::new();
        let secrets = KanbanSecrets {
            username: "devon".into(),
            password: "secret-value".into(),
            ..KanbanSecrets::default()
        };
        let (board, next, changed) = read_board(&http, &base, "", secrets).await.unwrap();
        assert!(changed);
        assert_eq!(next.session_cookie, "hermes_session=abc123");
        assert!(next.access_token.is_empty());
        assert!(board.unavailable);
        assert!(!board.needs_login);
        assert_eq!(board.message, KANBAN_UNAVAILABLE);
        let bare = read_board(&http, &base, "default", KanbanSecrets::default())
            .await
            .unwrap();
        assert!(bare.0.needs_login);
        assert!(!bare.0.unavailable);
        assert_eq!(bare.0.message, LOGIN_MESSAGE);
    }

    #[tokio::test]
    async fn a_closed_port_is_a_connection_error() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        drop(listener);
        let http = Client::builder()
            .connect_timeout(Duration::from_millis(300))
            .timeout(Duration::from_secs(2))
            .build()
            .unwrap();
        let err = read_board(
            &http,
            &format!("http://127.0.0.1:{port}"),
            "default",
            KanbanSecrets::default(),
        )
        .await
        .unwrap_err();
        let text = crate::hermes::explain(&err);
        assert!(
            text.contains("連唔到") || text.contains("逾時") || text.contains("中斷"),
            "{text}"
        );
        let calm = explain_kanban(&err);
        let lower = calm.to_ascii_lowercase();
        assert!(!calm.contains("Hermes gateway"), "{calm}");
        assert!(!calm.contains("API_SERVER_KEY"), "{calm}");
        assert!(!lower.contains("timed out"), "{calm}");
        assert!(!lower.contains("connection refused"), "{calm}");
        assert!(!lower.contains("error sending request"), "{calm}");
    }

    #[tokio::test]
    async fn a_wrong_password_is_login_and_is_not_posted_again() {
        super::forget_rejected_password("box-user", "box-wrong");
        super::forget_rejected_password("box-user", "box-next");
        let posts = Arc::new(Mutex::new(0u32));
        let posts2 = posts.clone();
        let base = serve(move |head| {
            let line = head.lines().next().unwrap_or("");
            if line.starts_with("POST") && line.contains("/auth/password-login") {
                *posts2.lock().unwrap() += 1;
                return (401, "", r#"{"error":"unauthorized"}"#.into());
            }
            if line.starts_with("GET") && line.contains("/api/plugins/kanban/board") {
                return (
                    401,
                    "",
                    r#"{"error":"invalid_or_expired_session"}"#.into(),
                );
            }
            (404, "", "{}".into())
        });
        let http = Client::new();
        let secrets = KanbanSecrets {
            username: "box-user".into(),
            password: "box-wrong".into(),
            ..KanbanSecrets::default()
        };
        let (board, _, changed) = read_board(&http, &base, "default", secrets.clone())
            .await
            .unwrap();
        assert!(!changed);
        assert!(board.needs_login);
        assert!(!board.unavailable);
        assert_eq!(board.message, LOGIN_MESSAGE);
        assert!(!board.message.contains("API_SERVER_KEY"));
        assert_eq!(*posts.lock().unwrap(), 1);
        let (again, _, _) = read_board(&http, &base, "default", secrets.clone())
            .await
            .unwrap();
        assert!(again.needs_login);
        assert_eq!(again.message, LOGIN_MESSAGE);
        assert_eq!(*posts.lock().unwrap(), 1);
        let changed_pw = KanbanSecrets {
            password: "box-next".into(),
            ..secrets
        };
        let (third, _, _) = read_board(&http, &base, "default", changed_pw).await.unwrap();
        assert!(third.needs_login);
        assert_eq!(*posts.lock().unwrap(), 2);
    }

    #[tokio::test]
    async fn an_expired_access_token_refreshes_once_and_retries_the_get() {
        forget_rejected_refresh("refresh-laptop");
        let counts = Arc::new(Mutex::new((0u32, 0u32, 0u32)));
        let seen = counts.clone();
        let base = serve(move |head| {
            let line = head.lines().next().unwrap_or("").to_string();
            let mut slot = seen.lock().unwrap();
            if line.contains("/api/plugins/kanban") && line.starts_with("POST") {
                slot.2 += 1;
            }
            if line.starts_with("POST") && line.contains("/auth/native/refresh") {
                slot.1 += 1;
                assert!(head.contains("refresh-laptop"));
                assert!(!head.contains("access-expired"));
                return (
                    200,
                    "",
                    r#"{"access_token":"access-rotated","refresh_token":"refresh-rotated","expires_at":99}"#
                        .into(),
                );
            }
            if line.starts_with("GET") && line.contains("/api/plugins/kanban/board") {
                slot.0 += 1;
                if head.contains("Bearer access-rotated") {
                    return (200, "", board_json());
                }
                assert!(head.contains("Bearer access-expired"));
                return (401, "", r#"{"error":"session_expired"}"#.into());
            }
            (404, "", r#"{"error":"nope"}"#.into())
        });
        let http = Client::new();
        let secrets = KanbanSecrets {
            access_token: "access-expired".into(),
            refresh_token: "refresh-laptop".into(),
            ..KanbanSecrets::default()
        };
        let (board, next, changed) = read_board(&http, &base, "default", secrets).await.unwrap();
        assert!(changed);
        assert!(!board.needs_login);
        assert!(!board.unavailable);
        assert_eq!(next.access_token, "access-rotated");
        assert_eq!(next.refresh_token, "refresh-rotated");
        assert!(!board.message.contains("refresh-laptop"));
        assert!(!board.message.contains("access-expired"));
        assert!(!board.message.contains("access-rotated"));
        let (gets, refreshes, kanban_posts) = *counts.lock().unwrap();
        assert_eq!(gets, 2, "the board GET is retried once");
        assert_eq!(refreshes, 1);
        assert_eq!(kanban_posts, 0);
    }

    #[tokio::test]
    async fn a_rejected_refresh_token_needs_login_and_is_not_posted_again() {
        forget_rejected_refresh("refresh-dead-box");
        let posts = Arc::new(Mutex::new(0u32));
        let posts2 = posts.clone();
        let base = serve(move |head| {
            let line = head.lines().next().unwrap_or("");
            if line.starts_with("POST") && line.contains("/auth/native/refresh") {
                *posts2.lock().unwrap() += 1;
                assert!(head.contains("refresh-dead-box"));
                return (
                    401,
                    "",
                    r#"{"error":"session_expired","detail":"Refresh token expired or invalid"}"#
                        .into(),
                );
            }
            if line.contains("/api/plugins/kanban") && line.starts_with("POST") {
                return (500, "", r#"{"error":"kanban post"}"#.into());
            }
            if line.starts_with("GET") && line.contains("/api/plugins/kanban/board") {
                assert!(head.contains("Bearer access-stale"));
                return (401, "", r#"{"error":"session_expired"}"#.into());
            }
            (404, "", "{}".into())
        });
        let http = Client::new();
        let secrets = KanbanSecrets {
            access_token: "access-stale".into(),
            refresh_token: "refresh-dead-box".into(),
            ..KanbanSecrets::default()
        };
        let (board, next, changed) = read_board(&http, &base, "default", secrets.clone())
            .await
            .unwrap();
        assert!(!changed);
        assert!(board.needs_login);
        assert!(!board.unavailable);
        assert_eq!(board.message, LOGIN_MESSAGE);
        assert!(!board.message.contains("refresh-dead-box"));
        assert!(!board.message.contains("access-stale"));
        assert_eq!(next.refresh_token, "refresh-dead-box");
        assert_eq!(*posts.lock().unwrap(), 1);
        let (again, _, again_changed) = read_board(&http, &base, "default", secrets)
            .await
            .unwrap();
        assert!(again.needs_login);
        assert!(!again_changed);
        assert_eq!(again.message, LOGIN_MESSAGE);
        assert_eq!(*posts.lock().unwrap(), 1);
    }

    #[test]
    fn an_empty_board_slug_omits_the_query() {
        assert_eq!(
            board_url("http://10.10.24.33:9119", ""),
            "http://10.10.24.33:9119/api/plugins/kanban/board"
        );
        assert_eq!(
            board_url("http://10.10.24.33:9119/", "   "),
            "http://10.10.24.33:9119/api/plugins/kanban/board"
        );
        assert!(
            !board_url("http://10.10.24.33:9119", "").contains("default"),
            "an omitted slug must not become board=default"
        );
        assert_eq!(
            board_url("http://10.10.24.33:9119", "mt4"),
            "http://10.10.24.33:9119/api/plugins/kanban/board?board=mt4"
        );
        assert_eq!(
            boards_url("http://10.10.24.33:9119/"),
            "http://10.10.24.33:9119/api/plugins/kanban/boards"
        );
        let listed = parse_kanban_boards(&json!({
            "boards": [
                {"slug": "default"},
                {"slug": "deskrpg"},
                {"slug": "mt4", "is_current": true}
            ],
            "current": "mt4"
        }));
        assert_eq!(listed.current, "mt4");
        assert_eq!(
            listed.boards,
            vec!["default".to_string(), "deskrpg".to_string(), "mt4".to_string()]
        );
        let marked = parse_kanban_boards(&json!({
            "boards": [
                {"slug": "default", "is_current": false},
                {"slug": "mt4", "is_current": true}
            ]
        }));
        assert_eq!(marked.current, "mt4");
        assert_eq!(marked.boards, vec!["default".to_string(), "mt4".to_string()]);
    }

    fn mt4_board_json() -> String {
        json!({
            "board": "mt4",
            "columns": [
                {"name": "triage", "tasks": [
                    {"id": "tr-1", "title": "一分", "status": "triage"},
                    {"id": "tr-2", "title": "二分", "status": "triage"},
                    {"id": "tr-3", "title": "三分", "status": "triage"}
                ]},
                {"name": "todo", "tasks": [
                    {"id": "td-1", "title": "一做", "status": "todo"},
                    {"id": "td-2", "title": "二做", "status": "todo"},
                    {"id": "td-3", "title": "三做", "status": "todo"},
                    {"id": "td-4", "title": "四做", "status": "todo"}
                ]},
                {"name": "done", "tasks": [
                    {"id": "dn-1", "title": "完成", "status": "done"},
                    {"id": "ar-1", "title": "封存", "status": "archived"}
                ]},
                {"name": "archived", "tasks": [
                    {"id": "ar-2", "title": "舊", "status": "archived"}
                ]}
            ]
        })
        .to_string()
    }

    #[tokio::test]
    async fn the_current_board_is_read_when_the_query_is_omitted() {
        let hits = Arc::new(Mutex::new(Vec::new()));
        let posts = Arc::new(Mutex::new(0u32));
        let hits2 = hits.clone();
        let posts2 = posts.clone();
        let base = serve(move |head| {
            let line = head.lines().next().unwrap_or("").to_string();
            if line.starts_with("POST") {
                *posts2.lock().unwrap() += 1;
                return (500, "", r#"{"error":"no writes"}"#.into());
            }
            if line.starts_with("GET") && line.contains("/api/plugins/kanban/boards") {
                hits2.lock().unwrap().push(line);
                return (
                    200,
                    "",
                    r#"{"boards":[{"slug":"default"},{"slug":"deskrpg"},{"slug":"mt4","is_current":true}],"current":"mt4"}"#
                        .into(),
                );
            }
            if line.starts_with("GET") && line.contains("/api/plugins/kanban/board") {
                hits2.lock().unwrap().push(line.clone());
                if line.contains("board=") {
                    let name = if line.contains("board=deskrpg") {
                        "deskrpg"
                    } else {
                        "default"
                    };
                    return (200, "", format!(r#"{{"board":"{name}","columns":[]}}"#));
                }
                return (200, "", mt4_board_json());
            }
            (404, "", r#"{"error":"nope"}"#.into())
        });
        let http = Client::new();
        let (board, _, changed) = read_board(&http, &base, "", KanbanSecrets::default())
            .await
            .unwrap();
        assert!(!changed);
        assert_eq!(board.board, "mt4");
        assert!(!board.unavailable);
        assert!(!board.needs_login);
        let ids: Vec<_> = board
            .columns
            .iter()
            .flat_map(|column| column.tasks.iter().map(|task| task.id.as_str()))
            .collect();
        assert!(ids.contains(&"tr-1") && ids.contains(&"td-4") && ids.contains(&"dn-1"), "{ids:?}");
        assert!(!ids.contains(&"ar-1") && !ids.contains(&"ar-2"), "{ids:?}");
        assert_eq!(
            board
                .columns
                .iter()
                .find(|column| column.name == "done")
                .unwrap()
                .tasks
                .len(),
            1
        );
        assert!(board.columns.iter().all(|column| column.name != "archived"));
        let (empty, _, _) = read_board(&http, &base, "default", KanbanSecrets::default())
            .await
            .unwrap();
        assert_eq!(empty.board, "default");
        assert_eq!(empty.columns.iter().flat_map(|column| &column.tasks).count(), 0);
        let (desk, _, _) = read_board(&http, &base, "deskrpg", KanbanSecrets::default())
            .await
            .unwrap();
        assert_eq!(desk.board, "deskrpg");
        assert_eq!(desk.columns.iter().flat_map(|column| &column.tasks).count(), 0);
        let (list, _, list_changed) = read_boards(&http, &base, KanbanSecrets::default())
            .await
            .unwrap();
        assert!(!list_changed);
        assert_eq!(list.current, "mt4");
        assert_eq!(
            list.boards,
            vec!["default".to_string(), "deskrpg".to_string(), "mt4".to_string()]
        );
        let lines = hits.lock().unwrap().clone();
        assert!(
            lines.iter().any(|line| {
                line.contains("/api/plugins/kanban/board")
                    && !line.contains("/boards")
                    && !line.contains("board=")
            }),
            "{lines:?}"
        );
        assert!(lines.iter().any(|line| line.contains("board=default")), "{lines:?}");
        assert!(
            lines.iter().any(|line| line.contains("/api/plugins/kanban/boards")),
            "{lines:?}"
        );
        assert_eq!(*posts.lock().unwrap(), 0);
        let src = include_str!("kanban_server.rs");
        let end = src.find("#[cfg(test)]").expect("tests");
        let production = &src[..end];
        assert!(production.contains("/api/plugins/kanban/boards"));
        assert!(!production.contains("include_archived"));
        assert!(!production.contains("println!"));
    }

    #[test]
    fn kanban_auth_source_does_not_log_tokens() {
        let src = include_str!("kanban_server.rs");
        let end = src.find("#[cfg(test)]").expect("tests");
        let production = &src[..end];
        assert!(!production.contains("println!"));
        assert!(!production.contains("eprintln!"));
        assert!(!production.contains("debug!"));
        assert!(!production.contains("tracing::"));
        assert!(production.contains("/auth/native/refresh"));
        assert!(production.contains("\"refresh_token\": refresh_token"));
    }

    #[test]
    fn kanban_copy_does_not_match_gateway_down() {
        for err in [
            crate::hermes::HermesError::Connect("connection refused".into()),
            crate::hermes::HermesError::Timeout("timed out".into()),
            crate::hermes::HermesError::Transport("error sending request".into()),
            crate::hermes::HermesError::Http {
                status: 401,
                body: String::new(),
            },
        ] {
            let text = explain_kanban(&err);
            let lower = text.to_ascii_lowercase();
            assert!(!text.contains("Hermes gateway"), "{text}");
            assert!(!text.contains("API_SERVER_KEY"), "{text}");
            assert!(!lower.contains("timed out"), "{text}");
            assert!(!lower.contains("connection refused"), "{text}");
            assert!(!lower.contains("error sending request"), "{text}");
        }
        assert_eq!(
            explain_kanban(&crate::hermes::HermesError::Http {
                status: 401,
                body: String::new(),
            }),
            LOGIN_MESSAGE
        );
    }
}

#[cfg(test)]
mod loopback_tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::{TcpListener, TcpStream};

    fn spawn_wait() -> (u16, std::thread::JoinHandle<Result<(String, String), HermesError>>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let handle =
            std::thread::spawn(move || wait_loopback(listener, Duration::from_secs(10)));
        (port, handle)
    }

    fn get(port: u16, path: &str) -> String {
        let mut sock = TcpStream::connect(("127.0.0.1", port)).unwrap();
        write!(sock, "GET {path} HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n").unwrap();
        let mut out = String::new();
        let _ = sock.read_to_string(&mut out);
        out
    }

    #[test]
    fn a_browser_preconnect_and_favicon_do_not_end_the_sign_in() {
        let (port, handle) = spawn_wait();
        // Chrome-style speculative socket: opened, nothing sent, closed.
        drop(TcpStream::connect(("127.0.0.1", port)).unwrap());
        let favicon = get(port, "/favicon.ico");
        assert!(favicon.starts_with("HTTP/1.1 404"), "{favicon}");
        let page = get(port, "/cb?code=abc%2Dx_9&state=s%3D1");
        assert!(page.starts_with("HTTP/1.1 200"), "{page}");
        let (code, state) = handle.join().unwrap().unwrap();
        assert_eq!(code, "abc-x_9");
        assert_eq!(state, "s=1");
    }

    #[test]
    fn a_denied_callback_ends_the_wait_with_an_error() {
        let (port, handle) = spawn_wait();
        let page = get(port, "/cb?error=access_denied&state=x");
        assert!(page.starts_with("HTTP/1.1 200"), "{page}");
        assert!(handle.join().unwrap().is_err());
    }

    #[test]
    fn the_authorize_url_keeps_its_ampersands_away_from_cmd() {
        let url = authorize_url("http://10.0.0.1:9119", "CH", "http://127.0.0.1:5/cb", "ST");
        // Every PKCE field rides after an `&`. cmd.exe /C start would cut them all off.
        assert!(url.contains("&code_challenge=CH&code_challenge_method=S256&redirect_uri="));
        let lib = include_str!("lib.rs");
        let start = lib.find("fn open_system_browser").expect("opener");
        let body = &lib[start..start + lib[start..].find("\n}\n").expect("end")];
        assert!(body.contains("tauri_plugin_opener::open_url"), "{body}");
        assert!(!body.contains("Command::new(\"cmd\")"), "{body}");
        assert!(!body.contains("\"start\""), "{body}");
    }
}

/// Live check against a real gated `hermes serve` (box only, never Devon's server).
/// `KANBAN_LIVE_ORIGIN=http://172.30.0.2:9119 KANBAN_LIVE_BROWSER=/path/browser.py \
///  KANBAN_LIVE_USER=.. KANBAN_LIVE_PASS_FILE=.. cargo test live_box -- --ignored --nocapture`
/// The browser script plays the system browser. Nothing here prints a token.
#[cfg(test)]
mod live_box {
    use super::*;

    fn env(name: &str) -> String {
        std::env::var(name).unwrap_or_default()
    }

    fn count(board: &KanbanBoard) -> usize {
        board.columns.iter().map(|column| column.tasks.len()).sum()
    }

    #[tokio::test]
    #[ignore]
    async fn live_native_login_reads_refreshes_and_password_cookie() {
        let origin = env("KANBAN_LIVE_ORIGIN");
        let browser = env("KANBAN_LIVE_BROWSER");
        assert!(!origin.is_empty() && !browser.is_empty(), "set KANBAN_LIVE_*");
        let http = Client::builder()
            .pool_idle_timeout(Duration::from_secs(2))
            .build()
            .unwrap();
        let tokens = native_pkce_login(&http, &origin, Duration::from_secs(30), move |url| {
            std::process::Command::new(&browser)
                .arg(url)
                .spawn()
                .map(|_| ())
                .map_err(|err| err.to_string())
        })
        .await
        .expect("native login");
        assert!(!tokens.access_token.is_empty() && !tokens.refresh_token.is_empty());
        let secrets = KanbanSecrets {
            access_token: tokens.access_token.clone(),
            refresh_token: tokens.refresh_token.clone(),
            ..KanbanSecrets::default()
        };
        let (board, secrets, changed) = read_board(&http, &origin, "", secrets).await.unwrap();
        assert!(!board.needs_login && !board.unavailable, "{}", board.message);
        assert!(!changed);
        eprintln!("bearer board: {} cards, {} columns", count(&board), board.columns.len());
        let (list, secrets, _) = read_boards(&http, &origin, secrets).await.unwrap();
        eprintln!("boards: {:?} current {}", list.boards, list.current);
        assert!(!list.current.is_empty());
        let first = board
            .columns
            .iter()
            .flat_map(|column| column.tasks.iter())
            .next()
            .map(|task| task.id.clone())
            .expect("a card on the box board");
        let (detail, secrets, _) = read_task(&http, &origin, &first, secrets).await.unwrap();
        eprintln!(
            "task {}: status {} comments {} events {}",
            detail.task.id,
            detail.task.status,
            detail.comments.len(),
            detail.events.len()
        );
        let profiles = read_native_profiles(&http, &origin, secrets.clone()).await;
        eprintln!("profiles via bearer: {}", profiles.profiles.len());
        assert!(!profiles.profiles.is_empty());

        let wait = env("KANBAN_LIVE_EXPIRE_WAIT").parse::<u64>().unwrap_or(0);
        if wait > 0 {
            eprintln!("waiting {wait}s for the access token to expire");
            tokio::time::sleep(Duration::from_secs(wait)).await;
            let before = secrets.clone();
            let (board, after, changed) = read_board(&http, &origin, "", secrets).await.unwrap();
            assert!(changed, "expired access must refresh");
            assert!(!board.needs_login, "{}", board.message);
            assert_ne!(after.access_token, before.access_token);
            assert!(!after.refresh_token.is_empty());
            eprintln!(
                "after expiry: refreshed, {} cards, refresh rotated: {}",
                count(&board),
                after.refresh_token != before.refresh_token
            );
        }

        let user = env("KANBAN_LIVE_USER");
        let pass_file = env("KANBAN_LIVE_PASS_FILE");
        if !user.is_empty() && !pass_file.is_empty() {
            let password = std::fs::read_to_string(&pass_file).unwrap().trim().to_string();
            let cookie = password_login(&http, &origin, &user, &password).await.unwrap();
            assert!(!cookie.is_empty());
            let secrets = KanbanSecrets {
                session_cookie: cookie,
                ..KanbanSecrets::default()
            };
            let (board, _, _) = read_board(&http, &origin, "", secrets).await.unwrap();
            assert!(!board.needs_login, "{}", board.message);
            eprintln!("cookie board: {} cards", count(&board));
        }
    }
}
