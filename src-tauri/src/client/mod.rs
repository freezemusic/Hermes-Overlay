//! `HermesClient`: the one place the overlay talks to Hermes.
//!
//! - **Transport:** the dashboard server (`hermes serve`, default port 9119) for
//!   all chat: REST for lists and history, one WebSocket (`/api/ws`) for sends,
//!   the reply stream, stop, approvals, clarify and other devices' live turns.
//! - **Auth:** the app's own dashboard login (R-KB-05 tokens or the basic-login
//!   cookie) from its keyring. No per-bot API key. A 401 refreshes once.
//! - **Profiles:** one server for every bot. REST takes `?profile=`, RPC a
//!   `profile` param (`session.create`, `session.resume`, `session.list`, `complete.slash`).
//! - **Paths:** [`endpoints`]. **Socket and backoff:** [`ws`]. **Event mapping:** [`turn`].
//! - The old gateway API is not used for chat. See REQUIREMENTS R-CL-01.

pub mod endpoints;
pub mod turn;
pub mod ws;

use crate::hermes::{
    self, CatalogFetch, ClarifyOutcome, CronList, HermesError, MessagePage, OverlayCommand,
    SessionSummary, StopOutcome, SteerOutcome, TurnEvent, UiMessage,
};
use crate::kanban_server::{self, KanbanSecrets};
use endpoints::{event, query, rest, rpc};
use reqwest::header::{AUTHORIZATION, COOKIE};
use reqwest::{Client, Method};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, Weak};
use std::time::Duration;
use turn::{Step, TurnMapper};
use ws::{WsEvent, WsHub};

const RPC_WAIT: Duration = Duration::from_secs(30);
const REST_WAIT: Duration = Duration::from_secs(20);
/// REST `GET /api/sessions` caps `limit` at 100 on 0.22.5.
const LIST_LIMIT: &str = "100";

/// Another device's turn on a session the overlay shows (R-CL-03).
#[derive(Debug, Clone, PartialEq)]
pub enum RemoteTurn {
    Start,
    Delta(String),
    Done,
}

pub type RemoteSink = Arc<dyn Fn(&str, &str, RemoteTurn) + Send + Sync>;
pub type SecretStore = Arc<dyn Fn(&KanbanSecrets) + Send + Sync>;
pub type SecretLoad = Arc<dyn Fn() -> KanbanSecrets + Send + Sync>;

#[derive(Debug, Clone)]
struct RunInfo {
    profile: String,
    live: String,
    done: bool,
}

pub struct HermesClient {
    http: Client,
    origin: Mutex<String>,
    secrets: Mutex<Option<KanbanSecrets>>,
    load: SecretLoad,
    store: SecretStore,
    ws: WsHub,
    /// (profile, stored id) → (socket generation, live sid).
    live: Mutex<HashMap<(String, String), (u64, String)>>,
    /// live sid → (profile, stored id), for sessions shown in a panel.
    watched: Mutex<HashMap<String, (String, String)>>,
    /// live sids with an own send in flight.
    own: Mutex<HashSet<String>>,
    runs: Mutex<HashMap<String, RunInfo>>,
    remote: Mutex<Option<RemoteSink>>,
    watcher: AtomicBool,
    me: Weak<HermesClient>,
}

fn json_text(value: Option<&Value>) -> String {
    value.and_then(Value::as_str).unwrap_or("").trim().to_string()
}

impl HermesClient {
    pub fn new(http: Client, load: SecretLoad, store: SecretStore) -> Arc<Self> {
        Arc::new_cyclic(|weak: &Weak<HermesClient>| {
            let weak_me = weak.clone();
            let weak = weak.clone();
            let connect: ws::Connector = Arc::new(move || {
                let weak = weak.clone();
                Box::pin(async move {
                    let Some(client) = weak.upgrade() else {
                        return Err(HermesError::Protocol("client gone".into()));
                    };
                    client.ws_url().await
                })
            });
            HermesClient {
                http,
                origin: Mutex::new(String::new()),
                secrets: Mutex::new(None),
                load,
                store,
                ws: WsHub::new(connect),
                live: Mutex::new(HashMap::new()),
                watched: Mutex::new(HashMap::new()),
                own: Mutex::new(HashSet::new()),
                runs: Mutex::new(HashMap::new()),
                remote: Mutex::new(None),
                watcher: AtomicBool::new(false),
                me: weak_me,
            }
        })
    }

    // ---- configuration -------------------------------------------------

    /// Dashboard address from Settings. A change drops the socket.
    pub fn set_origin(&self, origin: &str) {
        let origin = origin.trim().trim_end_matches('/').to_string();
        let mut guard = self.origin.lock().unwrap_or_else(|e| e.into_inner());
        if *guard != origin {
            *guard = origin;
            drop(guard);
            self.live.lock().unwrap_or_else(|e| e.into_inner()).clear();
            self.ws.reset();
        }
    }

    pub fn origin(&self) -> String {
        self.origin.lock().unwrap_or_else(|e| e.into_inner()).clone()
    }

    /// Re-read the login from the keyring (after sign-in or sign-out).
    pub fn reload_login(&self) {
        *self.secrets.lock().unwrap_or_else(|e| e.into_inner()) = None;
        self.ws.reset();
    }

    pub fn set_remote_sink(&self, sink: RemoteSink) {
        *self.remote.lock().unwrap_or_else(|e| e.into_inner()) = Some(sink);
    }

    /// Plain line when the socket is down, empty when up.
    pub fn link_hint(&self) -> String {
        if self.ws.generation() != 0 {
            String::new()
        } else {
            self.ws.down_reason()
        }
    }

    fn current_secrets(&self) -> KanbanSecrets {
        let mut guard = self.secrets.lock().unwrap_or_else(|e| e.into_inner());
        if guard.is_none() {
            *guard = Some((self.load)());
        }
        guard.clone().unwrap_or_default()
    }

    fn keep_secrets(&self, next: KanbanSecrets) {
        (self.store)(&next);
        *self.secrets.lock().unwrap_or_else(|e| e.into_inner()) = Some(next);
    }

    fn authed(&self, builder: reqwest::RequestBuilder, secrets: &KanbanSecrets) -> reqwest::RequestBuilder {
        let builder = builder.header("Accept", "application/json");
        if !secrets.access_token.trim().is_empty() {
            builder.header(AUTHORIZATION, format!("Bearer {}", secrets.access_token.trim()))
        } else if !secrets.session_cookie.trim().is_empty() {
            builder.header(COOKIE, secrets.session_cookie.trim().to_string())
        } else {
            builder
        }
    }

    /// One REST call with the login. A 401/403 renews once and retries.
    async fn rest(&self, method: Method, path: &str, body: Option<Value>, wait: Duration) -> Result<Value, HermesError> {
        let origin = self.origin();
        if origin.is_empty() {
            return Err(HermesError::Connect("未設定 Hermes Dashboard 地址".into()));
        }
        let url = format!("{origin}{path}");
        let mut secrets = self.current_secrets();
        let mut renewed = false;
        loop {
            let mut builder = self.http.request(method.clone(), &url).timeout(wait);
            if let Some(body) = &body {
                builder = builder.json(body);
            }
            let resp = self.authed(builder, &secrets).send().await.map_err(hermes::map_reqwest_pub)?;
            let status = resp.status().as_u16();
            if (status == 401 || status == 403) && !renewed {
                renewed = true;
                // A sign-in elsewhere may have stored newer tokens.
                let fresh = (self.load)();
                if fresh != secrets {
                    secrets = fresh;
                    *self.secrets.lock().unwrap_or_else(|e| e.into_inner()) = Some(secrets.clone());
                    continue;
                }
                if kanban_server::renew_login(&self.http, &origin, &mut secrets).await.unwrap_or(false) {
                    self.keep_secrets(secrets.clone());
                    continue;
                }
            }
            let text = resp.text().await.unwrap_or_default();
            if !(200..300).contains(&status) {
                return Err(HermesError::Http { status, body: hermes::clip(&text, 300) });
            }
            if text.trim().is_empty() {
                return Ok(Value::Null);
            }
            return serde_json::from_str(&text)
                .map_err(|err| HermesError::Protocol(format!("Dashboard 回應唔係 JSON：{err}")));
        }
    }

    async fn ws_url(&self) -> Result<String, HermesError> {
        let value = self.rest(Method::POST, rest::WS_TICKET, Some(json!({})), Duration::from_secs(10)).await?;
        let ticket = json_text(value.get("ticket"));
        if ticket.is_empty() {
            return Err(HermesError::Protocol("Dashboard 冇俾連線票".into()));
        }
        Ok(endpoints::ws_url(&self.origin(), &ticket))
    }

    async fn call(&self, method: &str, params: Value) -> Result<Value, HermesError> {
        self.ws.call(method, params, RPC_WAIT).await
    }

    // ---- health and profiles ---------------------------------------------

    /// `GET /api/health` → version line. No login needed.
    pub async fn probe(&self) -> Result<String, HermesError> {
        let value = self.rest(Method::GET, rest::HEALTH, None, Duration::from_secs(8)).await?;
        let version = json_text(value.get("displayVersion"));
        Ok(if version.is_empty() { json_text(value.get("version")) } else { version })
    }

    // ---- sessions ------------------------------------------------------

    pub async fn list_sessions(&self, profile: &str) -> Result<Vec<SessionSummary>, HermesError> {
        let path = format!(
            "{}{}",
            rest::SESSIONS,
            query(profile, &[("limit", LIST_LIMIT), ("archived", "include"), ("order", "recent")])
        );
        let value = self.rest(Method::GET, &path, None, REST_WAIT).await?;
        Ok(hermes::parse_session_list(&value))
    }

    /// The list plus the exact-title Bot Chat lookup (`session.list {title}` finds hidden rows).
    pub async fn list_sessions_for_bot_chat(&self, profile: &str) -> Result<Vec<SessionSummary>, HermesError> {
        let sessions = self.list_sessions(profile).await?;
        let titled = self
            .call(rpc::SESSION_LIST, json!({"title": crate::config::BOT_CHAT_TITLE, "profile": profile}))
            .await;
        match titled {
            Ok(value) => {
                let mut rows = hermes::parse_session_list(&value);
                // RPC rows omit flags; keep the REST row when both have it.
                rows.retain(|row| !sessions.iter().any(|have| have.id == row.id));
                Ok(hermes::merge_sessions(sessions, rows))
            }
            Err(_) => Ok(sessions),
        }
    }

    pub async fn ensure_bot_chat(&self, profile: &str) -> Result<hermes::BotChatPick, HermesError> {
        let sessions = self.list_sessions_for_bot_chat(profile).await?;
        hermes::canonical_bot_chat(&sessions)
            .map(hermes::BotChatPick::from_session)
            .ok_or_else(|| HermesError::Protocol("未有 Bot Chat".into()))
    }

    pub async fn fetch_message_page(&self, profile: &str, session_id: &str, offset: u64, limit: u64) -> Result<MessagePage, HermesError> {
        let limit = limit.clamp(1, 500).to_string();
        let offset = offset.to_string();
        let path = format!(
            "{}{}",
            rest::session_messages(session_id),
            query(profile, &[("order", "oldest"), ("limit", &limit), ("offset", &offset), ("inline_images", "false")])
        );
        let value = self.rest(Method::GET, &path, None, Duration::from_secs(30)).await?;
        Ok(hermes::message_page_from(&value))
    }

    pub async fn fetch_messages(&self, profile: &str, session_id: &str) -> Result<Vec<UiMessage>, HermesError> {
        Ok(self.fetch_message_page(profile, session_id, 0, 500).await?.messages)
    }

    pub async fn fetch_counted_messages(&self, profile: &str, session_id: &str, count: Option<u64>) -> Result<Vec<UiMessage>, HermesError> {
        let mut out = Vec::new();
        for (offset, limit) in hermes::transcript_windows(count) {
            let page = self.fetch_message_page(profile, session_id, offset, limit).await?;
            if page.returned == 0 {
                break;
            }
            out.extend(page.messages);
        }
        Ok(out)
    }

    /// Newest rows, for the R-ST-05 check (latest first page).
    pub async fn fetch_latest_rows(&self, profile: &str, session_id: &str, limit: u64) -> Result<Vec<Value>, HermesError> {
        let limit = limit.to_string();
        let path = format!(
            "{}{}",
            rest::session_messages(session_id),
            query(profile, &[("order", "latest"), ("limit", &limit), ("inline_images", "false")])
        );
        let value = self.rest(Method::GET, &path, None, REST_WAIT).await?;
        Ok(value.get("messages").and_then(Value::as_array).cloned().unwrap_or_default())
    }

    /// `session.create {profile, title}` → the stored id. The new chat is live on our socket.
    pub async fn create_session(&self, profile: &str, title: Option<&str>) -> Result<String, HermesError> {
        let mut params = json!({"profile": profile});
        if let Some(title) = title.map(str::trim).filter(|t| !t.is_empty()) {
            params["title"] = json!(title);
        }
        let value = self.call(rpc::SESSION_CREATE, params).await?;
        let live = json_text(value.get("session_id"));
        let stored = json_text(value.get("stored_session_id"));
        if stored.is_empty() {
            return Err(HermesError::Protocol("開新對話冇回 id".into()));
        }
        if !live.is_empty() {
            self.remember_live(profile, &stored, &live);
        }
        Ok(stored)
    }

    /// Branch a stored chat (`session.branch_stored`).
    pub async fn fork_session(&self, profile: &str, session_id: &str, title: &str) -> Result<String, HermesError> {
        let mut params = json!({"profile": profile, "parent_session_id": session_id});
        if !title.trim().is_empty() {
            params["title"] = json!(title.trim());
        }
        let value = self.call(rpc::SESSION_BRANCH, params).await?;
        let stored = json_text(value.get("stored_session_id"));
        if stored.is_empty() {
            return Err(HermesError::Protocol("分支回應冇 id".into()));
        }
        Ok(stored)
    }

    pub async fn patch_session_title(&self, profile: &str, session_id: &str, title: &str) -> Result<(), HermesError> {
        let body = json!({"title": title, "profile": profile});
        self.rest(Method::PATCH, &rest::session(session_id), Some(body), REST_WAIT).await.map(|_| ())
    }

    pub async fn patch_session_archived(&self, profile: &str, session_id: &str) -> Result<(), HermesError> {
        let body = json!({"archived": true, "profile": profile});
        self.rest(Method::PATCH, &rest::session(session_id), Some(body), REST_WAIT).await.map(|_| ())
    }

    // ---- live sessions -------------------------------------------------

    fn remember_live(&self, profile: &str, stored: &str, live: &str) {
        let gen = self.ws.generation();
        self.live
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert((profile.to_string(), stored.to_string()), (gen, live.to_string()));
    }

    /// Attach to a stored chat (`session.resume`) → live sid on this socket.
    /// Several clients (phone, Desktop, overlay) attach to one live session.
    pub async fn attach(&self, profile: &str, stored: &str) -> Result<String, HermesError> {
        let gen = self.ws.wait_up(Duration::from_secs(10)).await?;
        let key = (profile.to_string(), stored.to_string());
        if let Some((have_gen, live)) = self.live.lock().unwrap_or_else(|e| e.into_inner()).get(&key) {
            if *have_gen == gen {
                return Ok(live.clone());
            }
        }
        let value = self
            .call(rpc::SESSION_RESUME, json!({"session_id": stored, "profile": profile}))
            .await?;
        let live = json_text(value.get("session_id"));
        if live.is_empty() {
            return Err(HermesError::Protocol("接唔上對話".into()));
        }
        self.remember_live(profile, stored, &live);
        Ok(live)
    }

    /// Keep `stored` attached so other devices' turns stream in (R-CL-03).
    pub async fn watch(&self, profile: &str, stored: &str) -> Result<(), HermesError> {
        self.start_watcher();
        let live = self.attach(profile, stored).await?;
        let mut watched = self.watched.lock().unwrap_or_else(|e| e.into_inner());
        watched.retain(|_, (p, _)| p != profile);
        watched.insert(live, (profile.to_string(), stored.to_string()));
        Ok(())
    }

    fn start_watcher(&self) {
        if self.watcher.swap(true, Ordering::AcqRel) {
            return;
        }
        let mut rx = self.ws.subscribe();
        let watched = self.watched_handle();
        tauri::async_runtime::spawn(async move {
            let mut in_turn: HashSet<String> = HashSet::new();
            loop {
                let item = match rx.recv().await {
                    Ok(item) => item,
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                    Err(_) => break,
                };
                let Some(client) = watched.upgrade() else { break };
                match item {
                    WsEvent::Link { up: false } => {
                        client.watched.lock().unwrap_or_else(|e| e.into_inner()).clear();
                        in_turn.clear();
                    }
                    WsEvent::Event { kind, session_id, payload } => {
                        let target = client.watched.lock().unwrap_or_else(|e| e.into_inner()).get(&session_id).cloned();
                        let Some((profile, stored)) = target else { continue };
                        if client.own.lock().unwrap_or_else(|e| e.into_inner()).contains(&session_id) {
                            in_turn.remove(&session_id);
                            continue;
                        }
                        let sink = client.remote.lock().unwrap_or_else(|e| e.into_inner()).clone();
                        let Some(sink) = sink else { continue };
                        match kind.as_str() {
                            event::MESSAGE_START => {
                                in_turn.insert(session_id.clone());
                                sink(&profile, &stored, RemoteTurn::Start);
                            }
                            event::MESSAGE_DELTA => {
                                if in_turn.insert(session_id.clone()) {
                                    sink(&profile, &stored, RemoteTurn::Start);
                                }
                                let text = json_text(payload.get("text"));
                                let raw = payload.get("text").and_then(Value::as_str).unwrap_or("");
                                if !text.is_empty() {
                                    sink(&profile, &stored, RemoteTurn::Delta(raw.to_string()));
                                }
                            }
                            event::MESSAGE_COMPLETE | event::ERROR => {
                                if in_turn.remove(&session_id) {
                                    sink(&profile, &stored, RemoteTurn::Done);
                                }
                            }
                            _ => {}
                        }
                    }
                    _ => {}
                }
            }
        });
    }

    fn watched_handle(&self) -> Weak<HermesClient> {
        self.me.clone()
    }

    // ---- turns -----------------------------------------------------------

    /// Send `text` into stored chat `session_id` and stream the reply as [`TurnEvent`]s.
    /// `hint`: say 「手機嗰邊行緊，排緊隊」 when the send waits behind another client.
    /// Returns the stored id the turn landed in.
    pub async fn stream_turn_watched<F>(
        &self,
        profile: &str,
        session_id: &str,
        text: &str,
        stop: &AtomicBool,
        stop_requested: &AtomicBool,
        hint: bool,
        mut on_event: F,
    ) -> Result<String, HermesError>
    where
        F: FnMut(TurnEvent),
    {
        let mut rx = self.ws.subscribe();
        let live = self.attach(profile, session_id).await?;
        // `queued: true`: a send while another device's turn runs waits in line
        // instead of redirecting that turn (display.busy_input_mode = interrupt).
        let accepted = self
            .call(rpc::PROMPT_SUBMIT, json!({"session_id": live, "text": text, "queued": true}))
            .await?;
        let status = json_text(accepted.get("status"));
        let row = accepted
            .get("user_row_id")
            .map(|v| v.to_string().trim_matches('"').to_string())
            .unwrap_or_default();
        let run_id = turn::run_id_for(&live, if row.is_empty() { "0" } else { &row });
        self.runs.lock().unwrap_or_else(|e| e.into_inner()).insert(
            run_id.clone(),
            RunInfo { profile: profile.to_string(), live: live.clone(), done: false },
        );
        self.own.lock().unwrap_or_else(|e| e.into_inner()).insert(live.clone());
        let _guard = OwnTurn { client: self, live: live.clone(), run_id: run_id.clone() };
        let mut mapper = TurnMapper::new(run_id, live.clone(), &status, hint);
        for item in mapper.opening() {
            on_event(item);
        }
        let mut interrupted = false;
        loop {
            if stop.load(Ordering::Acquire) && !interrupted {
                interrupted = true;
                let _ = self.call(rpc::SESSION_INTERRUPT, json!({"session_id": live})).await;
                return Err(HermesError::Cancelled);
            }
            let item = tokio::time::timeout(Duration::from_millis(250), rx.recv()).await;
            let item = match item {
                Err(_) => continue,
                Ok(Ok(item)) => item,
                Ok(Err(tokio::sync::broadcast::error::RecvError::Lagged(_))) => continue,
                Ok(Err(_)) => return Err(HermesError::Transport("同 Hermes 嘅連線斷咗".into())),
            };
            let step = match &item {
                WsEvent::Event { kind, session_id, payload } => mapper.on_event(kind, session_id, payload),
                WsEvent::Request { id, method, params } => mapper.on_request(id, method, params),
                WsEvent::Link { up: false } => {
                    return Err(HermesError::Transport("同 Hermes 嘅連線斷咗，回覆中斷咗。".into()));
                }
                WsEvent::Link { .. } => Step::Ignore,
            };
            match step {
                Step::Ignore => {}
                Step::Emit(items) => items.into_iter().for_each(&mut on_event),
                Step::Done { events, failed } => {
                    if stop_requested.load(Ordering::Acquire) {
                        return Err(HermesError::Cancelled);
                    }
                    if let Some(line) = failed {
                        return Err(HermesError::Protocol(if line.trim().is_empty() {
                            "回覆失敗".into()
                        } else {
                            line
                        }));
                    }
                    events.into_iter().for_each(&mut on_event);
                    return Ok(session_id.to_string());
                }
            }
        }
    }

    fn run(&self, run_id: &str) -> Option<RunInfo> {
        self.runs.lock().unwrap_or_else(|e| e.into_inner()).get(run_id).cloned()
    }

    /// Model picker list (`model.options`, same payload as the old route).
    pub async fn list_model_options(&self, profile: &str) -> Result<Vec<String>, HermesError> {
        let value = self.call(rpc::MODEL_OPTIONS, json!({"profile": profile})).await?;
        Ok(hermes::parse_model_options(&value))
    }

    /// Lock this session's model (`config.set` key `model`, session scoped).
    pub async fn lock_session_model(
        &self,
        profile: &str,
        session_id: &str,
        model: &str,
        provider: &str,
    ) -> Result<(), HermesError> {
        let live = self.attach(profile, session_id).await?;
        let value = if provider.trim().is_empty() {
            model.trim().to_string()
        } else {
            format!("{} --provider {}", model.trim(), provider.trim())
        };
        self.call(
            rpc::CONFIG_SET,
            json!({"session_id": live, "key": "model", "value": value, "profile": profile}),
        )
        .await?;
        Ok(())
    }

    /// 「停止」: `session.interrupt` on the run's live session.
    pub async fn stop_run(&self, _profile: &str, run_id: &str) -> Result<StopOutcome, HermesError> {
        let live = match self.run(run_id) {
            Some(info) if info.done => return Ok(StopOutcome::NotActive),
            Some(info) => info.live,
            None => match turn::live_sid_of(run_id) {
                Some(live) => live,
                None => return Ok(StopOutcome::NotActive),
            },
        };
        let value = self.call(rpc::SESSION_INTERRUPT, json!({"session_id": live})).await?;
        Ok(if json_text(value.get("status")) == "interrupted" {
            StopOutcome::Stopping
        } else {
            StopOutcome::NotActive
        })
    }

    /// `{status}` for a run this client started.
    pub async fn fetch_run(&self, _profile: &str, run_id: &str) -> Result<Value, HermesError> {
        Ok(match self.run(run_id) {
            Some(info) if info.done => json!({"status": "completed"}),
            Some(_) => json!({"status": "running"}),
            None => json!({"status": "completed"}),
        })
    }

    /// A correction into the running turn: `prompt.submit` without `queued`.
    /// Hermes steers or redirects by `display.busy_input_mode`.
    pub async fn steer_run(&self, _profile: &str, run_id: &str, text: &str) -> Result<SteerOutcome, HermesError> {
        let Some(info) = self.run(run_id).filter(|info| !info.done) else {
            return Ok(SteerOutcome::Rejected);
        };
        let value = self
            .call(rpc::PROMPT_SUBMIT, json!({"session_id": info.live, "text": text}))
            .await?;
        Ok(match json_text(value.get("status")).as_str() {
            "steered" | "redirected" => SteerOutcome::Joined,
            _ => SteerOutcome::Rejected,
        })
    }

    /// 批准／拒絕: answer the `approval` server request. Only `once` / `deny` reach here.
    pub async fn submit_approval(&self, _profile: &str, _run_id: &str, request_id: &str, choice: &str) -> Result<(), HermesError> {
        self.ws.answer(request_id, json!({"choice": choice}))
    }

    /// A clarify answer: `clarify.lock {request_id, question_id, answer}`.
    pub async fn submit_clarify(&self, _profile: &str, _run_id: &str, prompt_id: &str, answer: &str) -> Result<ClarifyOutcome, HermesError> {
        let Some((request_id, qid)) = turn::split_clarify_prompt_id(prompt_id) else {
            return Ok(ClarifyOutcome::Stale);
        };
        match self
            .call(rpc::CLARIFY_LOCK, json!({"request_id": request_id, "question_id": qid, "answer": answer}))
            .await
        {
            Ok(value) if json_text(value.get("status")) == "ok" => Ok(ClarifyOutcome::Resolved),
            Ok(_) => Ok(ClarifyOutcome::AlreadyResolved),
            Err(HermesError::Http { .. }) => Ok(ClarifyOutcome::Stale),
            Err(err) => Err(err),
        }
    }

    // ---- menus, models, cron --------------------------------------------

    /// The / menu from `complete.slash` (native on 9119; no overlay-slash needed).
    pub async fn fetch_overlay_commands(&self, profile: &str) -> Result<CatalogFetch, HermesError> {
        let value = self.call(rpc::COMPLETE_SLASH, json!({"text": "/", "profile": profile})).await?;
        let commands = parse_slash_items(&value);
        let etag = format!("ws-{}", commands.len());
        Ok(CatalogFetch::Fresh { etag, commands })
    }

    pub async fn fetch_cron_jobs(&self, profile: &str) -> Result<CronList, HermesError> {
        let path = format!("{}{}", rest::CRON_JOBS, query(profile, &[]));
        let value = self.rest(Method::GET, &path, None, Duration::from_secs(8)).await?;
        Ok(hermes::parse_cron_list(&value))
    }
}

/// Clears the own-turn marks when a send ends, however it ends.
struct OwnTurn<'a> {
    client: &'a HermesClient,
    live: String,
    run_id: String,
}

impl Drop for OwnTurn<'_> {
    fn drop(&mut self) {
        self.client.own.lock().unwrap_or_else(|e| e.into_inner()).remove(&self.live);
        if let Some(info) = self.client.runs.lock().unwrap_or_else(|e| e.into_inner()).get_mut(&self.run_id) {
            info.done = true;
        }
        let _ = &self.client.ws;
    }
}

/// `complete.slash` items → menu rows. `kind: command|skill`.
pub fn parse_slash_items(value: &Value) -> Vec<OverlayCommand> {
    let items = value.get("items").and_then(Value::as_array).cloned().unwrap_or_default();
    let mut out: Vec<OverlayCommand> = Vec::new();
    for item in items {
        let name = json_text(item.get("text")).trim_start_matches('/').to_string();
        if name.is_empty() || out.iter().any(|have| have.name == name) {
            continue;
        }
        let kind = json_text(item.get("kind"));
        let meta = json_text(item.get("meta"));
        let (description, args_hint) = match meta.find("(usage:") {
            Some(at) => (
                meta[..at].trim().to_string(),
                meta[at + 7..].trim_end_matches(')').trim().trim_start_matches(&format!("/{name}")).trim().to_string(),
            ),
            None => (meta.clone(), String::new()),
        };
        out.push(OverlayCommand {
            name,
            kind: if kind.is_empty() { "command".into() } else { kind.clone() },
            category: if kind == "skill" { "技能".into() } else { "指令".into() },
            description,
            args_hint,
            aliases: Vec::new(),
            enabled: true,
            maps_to: None,
        });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slash_items_become_menu_rows() {
        let value = json!({"items": [
            {"text": "new", "display": "/new", "meta": "Start a new session (usage: /new [name])", "kind": "command"},
            {"text": "plan", "display": "/plan", "meta": "Plan first", "kind": "skill"},
            {"text": "new", "display": "/new", "meta": "dup", "kind": "command"}
        ]});
        let rows = parse_slash_items(&value);
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].name, "new");
        assert_eq!(rows[0].description, "Start a new session");
        assert_eq!(rows[0].args_hint, "[name]");
        assert_eq!(rows[1].category, "技能");
    }

    #[test]
    fn the_client_module_has_no_gateway_paths() {
        for src in [include_str!("mod.rs"), include_str!("endpoints.rs"), include_str!("ws.rs"), include_str!("turn.rs")] {
            let code = src.split("#[cfg(test)]").next().unwrap_or("");
            assert!(!code.contains("/v1/runs"), "no 8642 run paths");
            assert!(!code.contains("8642"), "no gateway port");
            assert!(!code.contains(":9119"), "port only in config defaults");
        }
    }
}
