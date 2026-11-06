//! One WebSocket to the dashboard server (`/api/ws`) shared by every bot.
//!
//! - Requests are JSON-RPC 2.0; replies are matched by id.
//! - Events (`method: "event"`) and server-to-client requests (approval, clarify)
//!   go to every subscriber through a broadcast channel.
//! - The socket comes up lazily on the first call. A drop fails the calls in
//!   flight, then the hub reconnects with backoff (1, 5, 10, 20, 60 s).
//! - `client.capabilities {server_requests: true}` is sent after `gateway.ready`.
//!   Sent earlier, 0.22.5 answers it but does not record it, and approvals are
//!   then withdrawn as "client cannot answer" (box test, hybrid-9119/exp/p6.py).

use super::endpoints::{event, rpc};
use crate::hermes::HermesError;
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::{broadcast, mpsc, oneshot, watch, Notify};
use tokio_tungstenite::tungstenite::Message;

pub const BACKOFF_SECS: [u64; 5] = [1, 5, 10, 20, 60];
const PING_EVERY: Duration = Duration::from_secs(20);
const SILENT_LIMIT: Duration = Duration::from_secs(50);
const READY_WAIT: Duration = Duration::from_secs(10);

#[derive(Debug, Clone)]
pub enum WsEvent {
    Event {
        kind: String,
        session_id: String,
        payload: Value,
    },
    Request {
        id: String,
        method: String,
        params: Value,
    },
    /// `up: false` when the socket dropped; every live sid is gone with it.
    Link { up: bool },
}

pub type Connector =
    Arc<dyn Fn() -> Pin<Box<dyn Future<Output = Result<String, HermesError>> + Send>> + Send + Sync>;

type Pending = Mutex<HashMap<String, oneshot::Sender<Result<Value, HermesError>>>>;

struct Inner {
    connect: Connector,
    out: Mutex<Option<mpsc::UnboundedSender<String>>>,
    pending: Pending,
    events: broadcast::Sender<WsEvent>,
    /// 0 while down, else the connection generation.
    up: watch::Sender<u64>,
    wake: Notify,
    started: AtomicBool,
    seq: AtomicU64,
    /// Plain line for the status hint: why the link is down.
    reason: Mutex<String>,
}

#[derive(Clone)]
pub struct WsHub {
    inner: Arc<Inner>,
}

/// Next wait after `attempt` failures in a row.
pub fn backoff(attempt: usize) -> Duration {
    Duration::from_secs(BACKOFF_SECS[attempt.min(BACKOFF_SECS.len() - 1)])
}

/// One inbound frame, sorted.
#[derive(Debug, PartialEq)]
pub enum Frame {
    Reply { id: String, result: Result<Value, (i64, String)> },
    Event { kind: String, session_id: String, payload: Value },
    Request { id: String, method: String, params: Value },
    Other,
}

pub const DOWN_LINE: &str = "連唔到 Hermes Dashboard，等陣自動再試";

/// Opt-in debug sink (set only when the app's debug log is on). Never gets
/// tickets, cookies or tokens: callers pass plain status words.
pub static DEBUG: std::sync::OnceLock<fn(String)> = std::sync::OnceLock::new();

pub fn debug(line: impl Into<String>) {
    if let Some(sink) = DEBUG.get() {
        sink(line.into());
    }
}

pub const LOGIN_LINE: &str = "要登入 Hermes Dashboard（設定 → 登入）";

pub fn classify(raw: &str) -> Frame {
    let Ok(value) = serde_json::from_str::<Value>(raw) else {
        return Frame::Other;
    };
    let id = match value.get("id") {
        Some(Value::String(text)) => Some(text.clone()),
        Some(Value::Number(num)) => Some(num.to_string()),
        _ => None,
    };
    let method = value.get("method").and_then(Value::as_str).unwrap_or("");
    if method == "event" {
        let params = value.get("params").cloned().unwrap_or(Value::Null);
        return Frame::Event {
            kind: params.get("type").and_then(Value::as_str).unwrap_or("").to_string(),
            session_id: params
                .get("session_id")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string(),
            payload: params.get("payload").cloned().unwrap_or(Value::Null),
        };
    }
    if !method.is_empty() {
        if let Some(id) = id {
            return Frame::Request {
                id,
                method: method.to_string(),
                params: value.get("params").cloned().unwrap_or(Value::Null),
            };
        }
        return Frame::Other;
    }
    let Some(id) = id else {
        return Frame::Other;
    };
    if let Some(error) = value.get("error") {
        let code = error.get("code").and_then(Value::as_i64).unwrap_or(-32000);
        let message = error
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        return Frame::Reply { id, result: Err((code, message)) };
    }
    Frame::Reply {
        id,
        result: Ok(value.get("result").cloned().unwrap_or(Value::Null)),
    }
}

/// A JSON-RPC error as the overlay's error type. Codes are Hermes' own (4006, 4009 …).
pub fn rpc_error(code: i64, message: &str) -> HermesError {
    HermesError::Http {
        status: code.clamp(0, u16::MAX as i64) as u16,
        body: message.chars().take(300).collect(),
    }
}

impl WsHub {
    pub fn new(connect: Connector) -> Self {
        let (events, _) = broadcast::channel(2048);
        let (up, _) = watch::channel(0u64);
        Self {
            inner: Arc::new(Inner {
                connect,
                out: Mutex::new(None),
                pending: Mutex::new(HashMap::new()),
                events,
                up,
                wake: Notify::new(),
                started: AtomicBool::new(false),
                seq: AtomicU64::new(1),
                reason: Mutex::new(String::new()),
            }),
        }
    }

    pub fn subscribe(&self) -> broadcast::Receiver<WsEvent> {
        self.ensure_started();
        self.inner.events.subscribe()
    }

    /// 0 while down.
    pub fn generation(&self) -> u64 {
        *self.inner.up.borrow()
    }

    pub fn down_reason(&self) -> String {
        self.inner.reason.lock().unwrap_or_else(|e| e.into_inner()).clone()
    }

    /// Drop the socket now (address or login changed); it comes back by itself.
    pub fn reset(&self) {
        if let Some(out) = self.inner.out.lock().unwrap_or_else(|e| e.into_inner()).take() {
            drop(out);
        }
        self.inner.wake.notify_one();
    }

    pub fn ensure_started(&self) {
        if self.inner.started.swap(true, Ordering::AcqRel) {
            return;
        }
        let inner = Arc::clone(&self.inner);
        tauri::async_runtime::spawn(async move { drive(inner).await });
    }

    pub async fn wait_up(&self, limit: Duration) -> Result<u64, HermesError> {
        self.ensure_started();
        let mut rx = self.inner.up.subscribe();
        if *rx.borrow() != 0 {
            return Ok(*rx.borrow());
        }
        self.inner.wake.notify_one();
        let waited = tokio::time::timeout(limit, async {
            loop {
                if rx.changed().await.is_err() {
                    return 0;
                }
                let gen = *rx.borrow();
                if gen != 0 {
                    return gen;
                }
            }
        })
        .await;
        match waited {
            Ok(gen) if gen != 0 => Ok(gen),
            _ => {
                let reason = self.down_reason();
                Err(HermesError::Protocol(if reason.is_empty() {
                    "連唔到 Hermes Dashboard".into()
                } else {
                    reason
                }))
            }
        }
    }

    fn send_text(&self, text: String) -> Result<(), HermesError> {
        let guard = self.inner.out.lock().unwrap_or_else(|e| e.into_inner());
        match guard.as_ref() {
            Some(out) if out.send(text).is_ok() => Ok(()),
            _ => Err(HermesError::Transport("同 Hermes 嘅連線斷咗".into())),
        }
    }

    pub async fn call(&self, method: &str, params: Value, limit: Duration) -> Result<Value, HermesError> {
        self.wait_up(READY_WAIT).await?;
        let id = format!("ov-{}", self.inner.seq.fetch_add(1, Ordering::Relaxed));
        let (tx, rx) = oneshot::channel();
        self.inner
            .pending
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(id.clone(), tx);
        let frame = json!({"jsonrpc": "2.0", "id": id, "method": method, "params": params});
        if let Err(err) = self.send_text(frame.to_string()) {
            self.inner.pending.lock().unwrap_or_else(|e| e.into_inner()).remove(&id);
            return Err(err);
        }
        match tokio::time::timeout(limit, rx).await {
            Ok(Ok(result)) => result,
            Ok(Err(_)) => Err(HermesError::Transport("同 Hermes 嘅連線斷咗".into())),
            Err(_) => {
                self.inner.pending.lock().unwrap_or_else(|e| e.into_inner()).remove(&id);
                Err(HermesError::Timeout(format!("{method} 冇回應")))
            }
        }
    }

    /// Answer a server-to-client request (approval) with `result`.
    pub fn answer(&self, id: &str, result: Value) -> Result<(), HermesError> {
        let frame = json!({"jsonrpc": "2.0", "id": id, "result": result});
        self.send_text(frame.to_string())
    }
}

fn set_reason(inner: &Inner, text: &str) {
    *inner.reason.lock().unwrap_or_else(|e| e.into_inner()) = text.to_string();
}

fn explain_down(err: &HermesError) -> String {
    match err {
        HermesError::Http { status: 401 | 403, .. } => LOGIN_LINE.into(),
        HermesError::Protocol(line) if line == LOGIN_LINE => LOGIN_LINE.into(),
        HermesError::Connect(_) | HermesError::Timeout(_) => DOWN_LINE.into(),
        _ => "同 Hermes Dashboard 斷咗線，等陣自動再試".into(),
    }
}

fn fail_pending(inner: &Inner) {
    let drained: Vec<_> = inner
        .pending
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .drain()
        .collect();
    for (_, tx) in drained {
        let _ = tx.send(Err(HermesError::Transport("同 Hermes 嘅連線斷咗".into())));
    }
}

/// Errors may echo the URL; drop anything after `?` so a ticket never lands in a log.
fn hermes_clip(text: &str) -> String {
    let cut = text.split('?').next().unwrap_or_default();
    cut.chars().take(160).collect()
}

async fn drive(inner: Arc<Inner>) {
    let mut attempt = 0usize;
    let mut generation = 0u64;
    loop {
        let url = (inner.connect)().await;
        match url {
            Ok(url) => match tokio_tungstenite::connect_async(url.as_str()).await {
                Ok((stream, _)) => {
                    generation += 1;
                    debug(format!("hc-ws open gen={generation}"));
                    let was_up = run_socket(&inner, stream, generation).await;
                    debug(format!("hc-ws closed gen={generation}"));
                    if was_up {
                        attempt = 0;
                    }
                    set_reason(&inner, "同 Hermes Dashboard 斷咗線，等陣自動再試");
                }
                Err(err) => {
                    debug(format!("hc-ws connect-failed {}", hermes_clip(&err.to_string())));
                    set_reason(&inner, DOWN_LINE)
                }
            },
            Err(err) => {
                debug(format!("hc-ws ticket-failed {}", hermes_clip(&format!("{err:?}"))));
                set_reason(&inner, &explain_down(&err))
            }
        }
        *inner.out.lock().unwrap_or_else(|e| e.into_inner()) = None;
        inner.up.send_replace(0);
        fail_pending(&inner);
        let _ = inner.events.send(WsEvent::Link { up: false });
        let wait = backoff(attempt);
        attempt += 1;
        tokio::select! {
            _ = tokio::time::sleep(wait) => {}
            _ = inner.wake.notified() => {
                // A caller is waiting; still keep one second between tries.
                tokio::time::sleep(Duration::from_secs(1)).await;
            }
        }
    }
}

/// Runs until the socket closes. True when it reached `gateway.ready`.
async fn run_socket<S>(inner: &Arc<Inner>, stream: S, generation: u64) -> bool
where
    S: futures_util::Stream<Item = Result<Message, tokio_tungstenite::tungstenite::Error>>
        + futures_util::Sink<Message>
        + Unpin
        + Send
        + 'static,
{
    let (mut sink, mut source) = stream.split();
    let (tx, mut rx) = mpsc::unbounded_channel::<String>();
    *inner.out.lock().unwrap_or_else(|e| e.into_inner()) = Some(tx.clone());
    let writer = tauri::async_runtime::spawn(async move {
        while let Some(text) = rx.recv().await {
            if sink.send(Message::Text(text)).await.is_err() {
                break;
            }
        }
        let _ = sink.close().await;
    });
    let mut ready = false;
    let mut last_seen = tokio::time::Instant::now();
    let mut ping = tokio::time::interval(PING_EVERY);
    ping.tick().await;
    loop {
        tokio::select! {
            frame = source.next() => {
                let Some(Ok(message)) = frame else { break };
                last_seen = tokio::time::Instant::now();
                let text = match message {
                    Message::Text(text) => text,
                    Message::Close(_) => break,
                    _ => continue,
                };
                match classify(&text) {
                    Frame::Reply { id, result } => {
                        let waiter = inner.pending.lock().unwrap_or_else(|e| e.into_inner()).remove(&id);
                        if let Some(waiter) = waiter {
                            let _ = waiter.send(result.map_err(|(code, msg)| rpc_error(code, &msg)));
                        }
                    }
                    Frame::Event { kind, session_id, payload } => {
                        if kind == event::READY && !ready {
                            ready = true;
                            debug(format!("hc-ws ready gen={generation}"));
                            let caps = json!({"jsonrpc": "2.0", "id": format!("caps-{generation}"),
                                "method": rpc::CAPABILITIES, "params": {"server_requests": true}});
                            let _ = tx.send(caps.to_string());
                            set_reason(inner, "");
                            inner.up.send_replace(generation);
                            let _ = inner.events.send(WsEvent::Link { up: true });
                            continue;
                        }
                        let _ = inner.events.send(WsEvent::Event { kind, session_id, payload });
                    }
                    Frame::Request { id, method, params } => {
                        let _ = inner.events.send(WsEvent::Request { id, method, params });
                    }
                    Frame::Other => {}
                }
            }
            _ = ping.tick() => {
                if last_seen.elapsed() > SILENT_LIMIT {
                    break;
                }
                let frame = json!({"jsonrpc": "2.0", "id": format!("ping-{generation}"), "method": rpc::PING, "params": {}});
                if tx.send(frame.to_string()).is_err() {
                    break;
                }
            }
        }
        // `reset()` dropped our sender: close.
        if inner.out.lock().unwrap_or_else(|e| e.into_inner()).is_none() {
            break;
        }
    }
    drop(tx);
    writer.abort();
    ready
}

#[cfg(test)]
mod tests {
    #[test]
    fn link_state_updates_even_with_nobody_waiting() {
        // `watch::Sender::send` drops the value when no receiver exists, which
        // left the link "up" after the dashboard went away (box smoke, R-CL-04).
        let (tx, rx) = tokio::sync::watch::channel(3u64);
        drop(rx);
        tx.send_replace(0);
        assert_eq!(*tx.borrow(), 0);
        let src = include_str!("ws.rs");
        let code = &src[..src.find("#[cfg(test)]").unwrap()];
        assert!(!code.contains("up.send("));
    }

    use super::*;

    #[test]
    fn frames_sort_into_replies_events_and_requests() {
        assert_eq!(
            classify(r#"{"jsonrpc":"2.0","id":"ov-1","result":{"status":"streaming"}}"#),
            Frame::Reply { id: "ov-1".into(), result: Ok(json!({"status":"streaming"})) }
        );
        assert_eq!(
            classify(r#"{"jsonrpc":"2.0","id":"ov-2","error":{"code":4009,"message":"session busy"}}"#),
            Frame::Reply { id: "ov-2".into(), result: Err((4009, "session busy".into())) }
        );
        assert_eq!(
            classify(r#"{"jsonrpc":"2.0","method":"event","params":{"type":"message.delta","session_id":"ab12","payload":{"text":"hi"}}}"#),
            Frame::Event { kind: "message.delta".into(), session_id: "ab12".into(), payload: json!({"text":"hi"}) }
        );
        assert_eq!(
            classify(r#"{"jsonrpc":"2.0","id":"srq-1","method":"approval","params":{"session_id":"ab12","command":"rm"}}"#),
            Frame::Request { id: "srq-1".into(), method: "approval".into(), params: json!({"session_id":"ab12","command":"rm"}) }
        );
        assert_eq!(classify("not json"), Frame::Other);
    }

    #[test]
    fn backoff_steps_then_holds_at_a_minute() {
        assert_eq!(backoff(0), Duration::from_secs(1));
        assert_eq!(backoff(1), Duration::from_secs(5));
        assert_eq!(backoff(4), Duration::from_secs(60));
        assert_eq!(backoff(40), Duration::from_secs(60));
    }

    #[test]
    fn capabilities_go_out_only_after_ready() {
        let src = include_str!("ws.rs");
        let ready = src.find("if kind == event::READY && !ready").expect("ready arm");
        let caps = src.find("rpc::CAPABILITIES, \"params\"").expect("caps");
        assert!(caps > ready);
    }
}
