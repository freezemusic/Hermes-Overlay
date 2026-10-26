//! Devon's kanban lives on `hermes serve` (port 9119), not the gateway.
//! Reads are GET only. Tokens and the basic password stay in this app's keyring.

use crate::hermes::{
    parse_kanban_board, KanbanBoard, KanbanTask, HermesError, KANBAN_LOGIN, KANBAN_UNAVAILABLE,
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

async fn renew(
    http: &Client,
    origin: &str,
    secrets: &mut KanbanSecrets,
) -> Result<bool, HermesError> {
    if !secrets.refresh_token.trim().is_empty() {
        let token = secrets.refresh_token.trim().to_string();
        if !refresh_is_rejected(&token) {
            match refresh_tokens(http, origin, &token).await {
                Ok(tokens) => {
                    forget_rejected_refresh(&token);
                    secrets.access_token = tokens.access_token;
                    if !tokens.refresh_token.is_empty() {
                        secrets.refresh_token = tokens.refresh_token;
                    }
                    return Ok(true);
                }
                Err(HermesError::Http { status: 401 | 403, .. }) => {
                    note_rejected_refresh(&token);
                }
                Err(err) => return Err(err),
            }
        }
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

fn wait_loopback(listener: TcpListener, timeout: Duration) -> Result<(String, String), HermesError> {
    listener
        .set_nonblocking(true)
        .map_err(|err| HermesError::Protocol(format!("登入回呼：{err}")))?;
    let start = std::time::Instant::now();
    let (mut sock, _) = loop {
        match listener.accept() {
            Ok(pair) => break pair,
            Err(err) if err.kind() == std::io::ErrorKind::WouldBlock => {
                if start.elapsed() > timeout {
                    return Err(HermesError::Protocol("登入逾時。可以喺設定填帳號密碼。".into()));
                }
                std::thread::sleep(Duration::from_millis(40));
            }
            Err(err) => return Err(HermesError::Protocol(format!("登入回呼：{err}"))),
        }
    };
    sock.set_read_timeout(Some(Duration::from_secs(2))).ok();
    let mut buf = [0u8; 4096];
    let n = sock.read(&mut buf).unwrap_or(0);
    let head = String::from_utf8_lossy(&buf[..n]);
    let path = head
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .unwrap_or("");
    let query = path.split_once('?').map(|(_, query)| query).unwrap_or("");
    let mut code = String::new();
    let mut state = String::new();
    for pair in query.split('&') {
        let Some((key, value)) = pair.split_once('=') else {
            continue;
        };
        let value = value.replace('+', " ");
        if key == "code" {
            code = value;
        } else if key == "state" {
            state = value;
        }
    }
    let page = "已登入 Kanban。可以關閉呢個分頁。";
    let header = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        page.len()
    );
    let _ = sock.write_all(header.as_bytes());
    let _ = sock.write_all(page.as_bytes());
    if code.is_empty() {
        return Err(HermesError::Protocol("登入回呼冇 code".into()));
    }
    Ok((code, state))
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
        clear_rejected_refresh();
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
        clear_rejected_refresh();
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
