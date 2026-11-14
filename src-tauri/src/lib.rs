mod config;
mod hermes;
mod interaction;
mod secrets;
mod sse;
mod client;
use client::kanban;

use config::{AppConfig, BotConfig};
use hermes::{explain, HermesError, TurnEvent};
use secrets::Lookup;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::Write;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, Mutex, OnceLock};
use tauri::{AppHandle, Emitter, Manager, State};

const SETTINGS_SHORTCUT: &str = "Ctrl+Shift+Alt+H";
const SETTINGS_TRAY_LABEL: &str = "設定 (Ctrl+Shift+Alt+H)";

#[cfg(unix)]
fn install_unix_signal_exit(app: AppHandle) {
    use std::sync::atomic::{AtomicBool, Ordering};

    static REQUESTED: AtomicBool = AtomicBool::new(false);

    extern "C" fn on_signal(sig: i32) {
        if interaction::signal_requests_exit(sig) {
            REQUESTED.store(true, Ordering::SeqCst);
        }
    }

    extern "C" {
        fn signal(sig: i32, handler: extern "C" fn(i32)) -> usize;
    }

    unsafe {
        for sig in [interaction::SIGINT, interaction::SIGTERM] {
            if interaction::signal_requests_exit(sig) {
                signal(sig, on_signal);
            }
        }
    }

    std::thread::Builder::new()
        .name("unix-signal-exit".into())
        .spawn(move || loop {
            if REQUESTED.swap(false, Ordering::SeqCst) {
                app.exit(interaction::APP_EXIT_CODE);
            }
            std::thread::sleep(std::time::Duration::from_millis(50));
        })
        .ok();
}

fn tray_icon(app: &AppHandle) -> Result<tauri::image::Image<'static>, String> {
    match tauri::image::Image::from_bytes(include_bytes!("../icons/tray.png")) {
        Ok(icon) => Ok(icon),
        Err(err) => {
            eprintln!("系統匣圖示：{err}");
            app.default_window_icon()
                .cloned()
                .map(tauri::image::Image::to_owned)
                .ok_or_else(|| "缺少視窗圖示，系統匣開唔到".to_string())
        }
    }
}

fn install_escape_hatches(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    use tauri::menu::{Menu, MenuItem};
    use tauri::tray::TrayIconBuilder;
    use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

    let settings = MenuItem::with_id(app, "settings", SETTINGS_TRAY_LABEL, true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "結束", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&settings, &quit])?;
    let icon = tray_icon(app)?;
    TrayIconBuilder::new()
        .icon(icon)
        .icon_as_template(cfg!(target_os = "macos"))
        .tooltip("Hermes Overlay")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "settings" => {
                let _ = app.emit("overlay-ui", serde_json::json!({ "type": "open-settings" }));
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .build(app)?;

    app.global_shortcut()
        .on_shortcut(SETTINGS_SHORTCUT, |app, _shortcut, event| {
            if event.state == ShortcutState::Pressed {
                let _ = app.emit("overlay-ui", serde_json::json!({ "type": "open-settings" }));
            }
        })?;
    Ok(())
}

#[derive(Clone)]
struct CommandCacheEntry {
    etag: String,
    commands: Vec<hermes::OverlayCommand>,
}

#[derive(Clone)]
struct SessionPin {
    id: String,
    explicit: bool,
    anchor: f64,
}

struct WatchedRow {
    stamp: hermes::ChatStamp,
    messages: Vec<hermes::UiMessage>,
}

struct WatchedChat {
    fingerprint: String,
    rows: HashMap<String, WatchedRow>,
}

#[derive(Clone)]
struct StreamControl {
    abort: Arc<AtomicBool>,
    stop_requested: Arc<AtomicBool>,
    generation: u64,
}

struct ProfileStreams {
    generation: u64,
    live: Vec<StreamControl>,
}

struct AppState {
    streams: Arc<Mutex<HashMap<String, ProfileStreams>>>,
    run_ids: Arc<Mutex<HashMap<String, String>>>,
    queued_run_ids: Arc<Mutex<HashMap<String, String>>>,
    sessions: Arc<Mutex<HashMap<String, SessionPin>>>,
    /// Last Bot Chat transcript seen by the cron poll. Locked only after HTTP awaits.
    bot_chats: Arc<Mutex<HashMap<String, WatchedChat>>>,
    config_write: Arc<Mutex<()>>,
    command_cache: Mutex<HashMap<String, CommandCacheEntry>>,
    interaction: Arc<interaction::InteractionHub>,
    /// All chat goes through this (R-CL-01).
    client: Arc<client::HermesClient>,
    /// Per-profile attempt count for `seed_session_lists` retries (R-SO-11).
    seed_attempts: Arc<Mutex<HashMap<String, SeedAttempt>>>,
}

struct SeedAttempt {
    n: u32,
    pending: bool,
}

/// The chat client, pointed at the dashboard address in `cfg`.
fn chat_client(state: &AppState, cfg: &AppConfig) -> Arc<client::HermesClient> {
    state.client.set_origin(&kanban::origin(&cfg.kanban_base_url));
    Arc::clone(&state.client)
}

static DEMO_MODE: OnceLock<bool> = OnceLock::new();

/// The offline demo runs only when launched with `--demo` (or
/// `HERMES_OVERLAY_DEMO=1`). Nothing in config.json or Settings turns it on.
fn demo_mode() -> bool {
    *DEMO_MODE.get_or_init(|| {
        config::demo_requested(std::env::args(), std::env::var(config::DEMO_ENV).ok())
    })
}

/// `mock` is the demo, `hermes` is the dashboard. Shown to the web layer.
fn app_mode() -> &'static str {
    if demo_mode() {
        "mock"
    } else {
        "hermes"
    }
}

const DEMO_LINE: &str = "示範模式（--demo），冇連 Hermes。";

fn new_chat_client(http: reqwest::Client) -> Arc<client::HermesClient> {
    client::HermesClient::new(
        http,
        Arc::new(load_kanban_secrets),
        Arc::new(|next: &kanban::KanbanSecrets| {
            let _ = store_kanban_secrets(next);
        }),
    )
}

fn http_client() -> reqwest::Client {
    // `hermes serve` closes idle sockets after about 5s. Drop ours first.
    reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(10))
        .pool_idle_timeout(std::time::Duration::from_secs(2))
        .user_agent("hermes-overlay/0.1")
        .build()
        .expect("reqwest client")
}

fn config_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("攞唔到設定目錄：{e}"))?;
    Ok(dir.join("config.json"))
}

fn load_config(app: &AppHandle) -> Result<AppConfig, String> {
    let path = config_path(app)?;
    if demo_mode() {
        // --demo never writes config.json.
        return config::load(&path);
    }
    // One-time move of the old gateway host into Kanban server (R-AR-06).
    config::load_and_migrate(&path)
}

#[derive(Serialize)]
struct PublicBot {
    profile: String,
    display_name: String,
    color: String,
    detail: String,
    enabled: bool,
    compose_mode: String,
}

#[derive(Serialize)]
struct PublicInteraction {
    modifier: String,
    fade_enabled: bool,
    fade_distance: f64,
    min_opacity: f64,
    orb_rest_transparency: f64,
    panel_rest_transparency: f64,
    supported: bool,
}

#[derive(Serialize)]
struct PublicSettings {
    mode: String,
    dashboard_base_url: String,
    kanban_base_url: String,
    kanban_board: String,
    kanban_server_url: String,
    has_kanban_login: bool,
    has_dashboard_token: bool,
    keyring_error: Option<String>,
    interaction: PublicInteraction,
    bots: Vec<PublicBot>,
    needs_setup: bool,
    show_bot_names: bool,
    show_tool_detail: bool,
    suborb_pins: std::collections::BTreeMap<String, Vec<String>>,
    /// R-PN-09 dragged panel sizes (empty when none).
    panel_sizes: std::collections::BTreeMap<String, config::PanelSize>,
    /// R-OB-08 dragged orb centres (empty when none).
    orb_positions: std::collections::BTreeMap<String, config::OrbPosition>,
    /// R-SO-09 sub-orb panel compose modes, `[session, mode]` pairs per profile.
    suborb_modes: std::collections::BTreeMap<String, Vec<(String, String)>>,
    /// R-SO-11 overlay-created session rows. Empty when none.
    suborb_created: std::collections::BTreeMap<String, Vec<config::CreatedSuborb>>,
    /// R-LK-01 / R-LK-02. "" is the standard size / zh-HK.
    text_size: String,
    ui_language: String,
    /// Profiles a remote list really returned on this sync (R-SY-09 removal).
    /// None when no remote list answered, so nobody is hidden on a failed read.
    #[serde(skip_serializing_if = "Option::is_none")]
    listed_profiles: Option<Vec<String>>,
}

#[derive(Deserialize)]
struct SaveBotMeta {
    profile: String,
    #[serde(default)]
    display_name: String,
    #[serde(default)]
    detail: String,
}

#[derive(Deserialize)]
struct SaveBot {
    profile: String,
    #[serde(default)]
    display_name: String,
    #[serde(default)]
    color: String,
    #[serde(default)]
    detail: String,
    #[serde(default = "default_bot_enabled")]
    enabled: bool,
}

fn default_bot_enabled() -> bool {
    true
}

#[derive(Deserialize)]
struct SaveSettings {
    #[serde(default)]
    dashboard_base_url: String,
    #[serde(default)]
    kanban_base_url: String,
    #[serde(default)]
    dashboard_token: String,
    #[serde(default)]
    clear_dashboard_token: bool,
    #[serde(default)]
    interaction: Option<SaveInteraction>,
    #[serde(default)]
    show_bot_names: bool,
    #[serde(default)]
    show_tool_detail: bool,
    /// None (an older form) keeps what the file already has (R-LK-01/02).
    #[serde(default)]
    text_size: Option<String>,
    #[serde(default)]
    ui_language: Option<String>,
    bots: Vec<SaveBot>,
}

#[derive(Deserialize)]
struct SaveInteraction {
    #[serde(default)]
    modifier: String,
    fade_enabled: Option<bool>,
    fade_distance: Option<f64>,
    min_opacity: Option<f64>,
    orb_rest_transparency: Option<f64>,
    panel_rest_transparency: Option<f64>,
}

#[derive(Serialize)]
struct ProbeBot {
    profile: String,
    ok: bool,
    detail: String,
}

#[derive(Serialize)]
struct ProbeReport {
    health_ok: bool,
    health_detail: String,
    bots: Vec<ProbeBot>,
}

#[derive(Serialize)]
struct OpenedChat {
    profile: String,
    session_id: String,
    session_explicit: bool,
    session_anchor: f64,
    session_source: String,
    read_only: bool,
    read_only_reason: String,
    /// Raw Hermes `message_count` for this session. A reopen replaces the view when it disagrees.
    message_count: Option<u64>,
    messages: Vec<hermes::UiMessage>,
    sessions: Vec<SessionChoice>,
    /// Hermes 0.22.5 live run (`run_ws_…`) when this stored session is already in a turn.
    /// Empty when nothing is live. Opening a chat does not start a run.
    run_id: String,
    /// `waiting` / `working` / `streaming` / `starting`, or empty.
    run_status: String,
}

#[derive(Serialize)]
struct SessionChoice {
    id: String,
    title: String,
    last_active: f64,
    hidden: bool,
    preview: String,
    source: String,
    archived: bool,
    ended: bool,
    end_reason: String,
    /// Closed chat's title when this row still has the gateway default. Empty otherwise.
    kept_title: String,
    /// Cheap change-check fields from the session list. Not a transcript.
    message_count: Option<u64>,
    started_at: f64,
    busy: bool,
}

#[derive(Serialize)]
struct DiscoveredBot {
    profile: String,
    display_name: String,
    detail: String,
    color: String,
}

fn require_hermes(_cfg: &AppConfig) -> Result<(), String> {
    // `_cfg` stays so every caller reads config first; demo is the launch flag.
    if demo_mode() {
        Err(DEMO_LINE.into())
    } else {
        Ok(())
    }
}

fn bot_or_err<'a>(cfg: &'a AppConfig, profile: &str) -> Result<&'a BotConfig, String> {
    cfg.bot(profile)
        .ok_or_else(|| format!("名單冇 profile「{profile}」"))
}

struct WatchNote {
    session_id: String,
    messages: Vec<hermes::UiMessage>,
    reset: bool,
}

struct WatchReport {
    notes: Vec<WatchNote>,
    sessions: Option<Vec<SessionChoice>>,
    resolved_id: String,
}

struct WatchBusy(Arc<AtomicBool>);

impl Drop for WatchBusy {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

/// Poll each enabled profile's Bot Chat. The snapshot lock is taken only after
/// the HTTP awaits, because a `MutexGuard` is not `Send`.
fn spawn_bot_chat_watch(app: AppHandle) {
    std::thread::Builder::new()
        .name("bot-chat-watch".into())
        .spawn(move || {
            let busy = Arc::new(AtomicBool::new(false));
            loop {
                if !busy.swap(true, Ordering::AcqRel) {
                    let app = app.clone();
                    let busy = Arc::clone(&busy);
                    tauri::async_runtime::spawn(async move {
                        let _guard = WatchBusy(busy);
                        poll_bot_chats(&app).await;
                    });
                }
                std::thread::sleep(std::time::Duration::from_secs(3));
            }
        })
        .ok();
}

/// R-CL-04: one plain line on every bot when the dashboard link is down, and
/// back to idle once it reconnects. Only sent when the state changes.
fn note_link_hint(app: &AppHandle, chat: &client::HermesClient, targets: &[(String, String, SessionPin)]) {
    static LAST: std::sync::Mutex<String> = std::sync::Mutex::new(String::new());
    let hint = chat.link_hint();
    let mut last = LAST.lock().unwrap_or_else(|err| err.into_inner());
    if *last == hint {
        return;
    }
    let was_down = !last.is_empty();
    *last = hint.clone();
    drop(last);
    for (profile, _, _) in targets {
        if !hint.is_empty() {
            emit_status(app, profile, "error", &hint);
        } else if was_down {
            emit_status(app, profile, "idle", "閒置");
        }
    }
}

async fn poll_bot_chats(app: &AppHandle) {
    let cfg = match load_config(app) {
        Ok(cfg) if !demo_mode() => cfg,
        _ => return,
    };
    let Some(state) = app.try_state::<AppState>() else {
        return;
    };
    let chat = chat_client(&state, &cfg);
    let watched = Arc::clone(&state.bot_chats);
    let targets: Vec<(String, String, SessionPin)> = cfg
        .bots
        .iter()
        .filter(|bot| bot.enabled)
        .filter_map(|bot| {
            let pin = load_pin(app, &state, &bot.profile);
            Some((bot.profile.clone(), bot.profile.clone(), pin))
        })
        .collect();
    drop(state);
    note_link_hint(app, &chat, &targets);
    for (profile, root, pin) in targets {
        let Ok(report) = watch_profile(&chat, &watched, &profile, &root, &pin).await else {
            continue;
        };
        if !report.resolved_id.is_empty() {
            let _ = chat.watch(&root, &report.resolved_id).await;
        }
        if let Some(sessions) = report.sessions {
            emit(
                app,
                serde_json::json!({
                    "type": "sessions",
                    "profile": profile,
                    "session_id": report.resolved_id,
                    "sessions": sessions,
                }),
            );
        }
        for note in report.notes {
            if note.messages.is_empty() {
                continue;
            }
            emit(
                app,
                serde_json::json!({
                    "type": "cron",
                    "profile": profile,
                    "session_id": note.session_id,
                    "messages": note.messages,
                    "reset": note.reset,
                }),
            );
        }
    }
}

fn remember_watched(
    watched: &Arc<Mutex<HashMap<String, WatchedChat>>>,
    profile: &str,
    session_id: &str,
    messages: &[hermes::UiMessage],
    sessions: &[hermes::SessionSummary],
) {
    let Some(session) = sessions.iter().find(|session| session.id == session_id) else {
        return;
    };
    let stamp = hermes::ChatStamp::from_session(session);
    let mut guard = watched.lock().unwrap_or_else(|err| err.into_inner());
    let chat = guard.entry(profile.to_string()).or_insert_with(|| WatchedChat {
        fingerprint: String::new(),
        rows: HashMap::new(),
    });
    chat.fingerprint = hermes::session_list_fingerprint(sessions);
    chat.rows.insert(
        session_id.to_string(),
        WatchedRow {
            stamp,
            messages: messages.to_vec(),
        },
    );
}

async fn watch_profile(
    chat: &client::HermesClient,
    watched: &Arc<Mutex<HashMap<String, WatchedChat>>>,
    profile: &str,
    root: &str,
    pin: &SessionPin,
) -> Result<WatchReport, HermesError> {
    let sessions = chat.list_sessions_for_bot_chat(root).await?;
    let fingerprint = hermes::session_list_fingerprint(&sessions);
    let canonical = hermes::canonical_bot_chat(&sessions).map(|session| session.id.clone());
    let resolved = hermes::session_for_startup(&sessions, &pin.id, pin.explicit, pin.anchor)
        .map(|session| session.id);
    let mut ids: Vec<String> = Vec::new();
    if let Some(id) = canonical.clone() {
        ids.push(id);
    }
    if let Some(id) = resolved.clone() {
        if !ids.iter().any(|have| have == &id) {
            ids.push(id);
        }
    }
    let (list_same, jobs) = {
        let guard = watched.lock().unwrap_or_else(|err| err.into_inner());
        let chat = guard.get(profile);
        let list_same = chat.is_some_and(|chat| chat.fingerprint == fingerprint);
        let mut jobs = Vec::new();
        for id in &ids {
            let Some(session) = sessions.iter().find(|session| &session.id == id) else {
                continue;
            };
            let next = hermes::ChatStamp::from_session(session);
            let prev = chat.and_then(|chat| chat.rows.get(id));
            let planned = prev.map(|row| row.stamp.clone());
            let plan = hermes::message_fetch(planned.as_ref(), &next);
            let stored = match &plan {
                hermes::MessageFetch::Skip => Vec::new(),
                _ => prev.map(|row| row.messages.clone()).unwrap_or_default(),
            };
            jobs.push((id.clone(), next, planned, plan, stored));
        }
        (list_same, jobs)
    };
    let mut prepared = Vec::new();
    for (id, next, planned, plan, stored) in jobs {
        match plan {
            hermes::MessageFetch::Skip => prepared.push((id, next, planned, None)),
            hermes::MessageFetch::Tail { from, to } => {
                let mut fetched = Vec::new();
                let mut at = from;
                let mut replaced = false;
                for (offset, limit) in hermes::tail_windows(from, to) {
                    let page = chat.fetch_message_page(root, &id, offset, limit).await?;
                    if page.returned == 0 {
                        fetched = chat.fetch_counted_messages(root, &id, Some(to)).await?;
                        replaced = true;
                        at = to;
                        break;
                    }
                    fetched.extend(page.messages);
                    at += page.returned;
                }
                let stamp = hermes::ChatStamp {
                    message_count: Some(at),
                    ..next
                };
                let (messages, emit, reset) = hermes::apply_watch_fetch(&stored, &fetched, replaced);
                prepared.push((id, stamp, planned, Some((messages, emit, reset))));
            }
            hermes::MessageFetch::Full => {
                let fetched = chat.fetch_counted_messages(root, &id, next.message_count).await?;
                let (messages, emit, reset) = hermes::apply_watch_fetch(&stored, &fetched, true);
                prepared.push((id, next, planned, Some((messages, emit, reset))));
            }
        }
    }
    let mut notes = Vec::new();
    {
        let mut guard = watched.lock().unwrap_or_else(|err| err.into_inner());
        let chat = guard.entry(profile.to_string()).or_insert_with(|| WatchedChat {
            fingerprint: String::new(),
            rows: HashMap::new(),
        });
        chat.fingerprint = fingerprint;
        for (id, stamp, planned, fetched) in prepared {
            let current = chat.rows.get(&id).map(|row| &row.stamp);
            if !hermes::watch_row_unchanged(planned.as_ref(), current) {
                continue;
            }
            match fetched {
                None => {
                    let row = chat.rows.entry(id).or_insert_with(|| WatchedRow {
                        stamp: stamp.clone(),
                        messages: Vec::new(),
                    });
                    row.stamp = stamp;
                }
                Some((messages, emit, reset)) => {
                    if !emit.is_empty() {
                        notes.push(WatchNote {
                            session_id: id.clone(),
                            messages: emit,
                            reset,
                        });
                    }
                    chat.rows.insert(id, WatchedRow { stamp, messages });
                }
            }
        }
        // A poll that misses the pinned hidden Bot Chat (title RPC failed) keeps its row.
        // Dropping it re-baselines on the next sight and skips the rows written meanwhile.
        chat.rows.retain(|id, _| hermes::keep_watched_row(id, &ids, &pin.id));
    }
    let sessions_out = if list_same {
        None
    } else {
        Some(session_choices(&sessions, resolved.as_deref().unwrap_or("")))
    };
    Ok(WatchReport {
        notes,
        sessions: sessions_out,
        resolved_id: resolved.unwrap_or_default(),
    })
}

fn session_map(state: &AppState) -> std::sync::MutexGuard<'_, HashMap<String, SessionPin>> {
    state.sessions.lock().unwrap_or_else(|err| err.into_inner())
}

fn cached_session(state: &AppState, profile: &str) -> Option<String> {
    session_map(state)
        .get(profile)
        .map(|pin| pin.id.clone())
        .filter(|id| !id.is_empty())
}

fn load_pin(app: &AppHandle, state: &AppState, profile: &str) -> SessionPin {
    if let Some(pin) = session_map(state).get(profile).cloned() {
        return pin;
    }
    let cfg = load_config(app).ok();
    let bot = cfg.as_ref().and_then(|cfg| cfg.bot(profile));
    SessionPin {
        id: bot.map(|bot| bot.session_id.clone()).unwrap_or_default(),
        explicit: bot.map(|bot| bot.session_explicit).unwrap_or(false),
        anchor: bot.map(|bot| bot.session_anchor).unwrap_or(0.0),
    }
}

fn remember_pin(app: &AppHandle, state: &AppState, profile: &str, pin: SessionPin) {
    persist_pin(app, &state.sessions, &state.config_write, profile, pin);
}

/// Automatic open, send, and reconnect. This never writes config.json.
/// A configured id keeps its explicit flag and its saved anchor in memory.
/// An empty config id may cache the resolved row in memory only. A missing
/// id is not shadowed.
fn remember_pin_if_absent(
    app: &AppHandle,
    state: &AppState,
    profile: &str,
    pin: SessionPin,
    stored_on_server: bool,
) {
    let existing = load_pin(app, state, profile);
    // A manual pick stays through reload and the quiet roster. Startup
    // resolution must not replace that id with the latest row.
    if existing.explicit && !existing.id.trim().is_empty() {
        return;
    }
    if !existing.id.trim().is_empty() {
        if !stored_on_server {
            return;
        }
        let id = pin.id.trim().to_string();
        if id.is_empty() {
            return;
        }
        let anchor = if existing.anchor.is_finite() {
            existing.anchor
        } else {
            0.0
        };
        session_map(state).insert(
            profile.to_string(),
            SessionPin {
                id,
                explicit: existing.explicit,
                anchor,
            },
        );
        return;
    }
    let id = pin.id.trim().to_string();
    if id.is_empty() {
        return;
    }
    let anchor = if existing.anchor.is_finite() && existing.anchor > 0.0 {
        existing.anchor
    } else {
        0.0
    };
    session_map(state).insert(
        profile.to_string(),
        SessionPin {
            id,
            explicit: false,
            anchor,
        },
    );
}

fn active_session(app: &AppHandle, state: &AppState, profile: &str) -> Option<String> {
    let pin = load_pin(app, state, profile);
    if pin.id.trim().is_empty() {
        None
    } else {
        Some(pin.id)
    }
}

fn persist_pin(
    app: &AppHandle,
    sessions: &Mutex<HashMap<String, SessionPin>>,
    config_write: &Mutex<()>,
    profile: &str,
    pin: SessionPin,
) {
    let _write = config_write.lock().unwrap_or_else(|err| err.into_inner());
    let loaded = config_path(app)
        .ok()
        .and_then(|path| config::load(&path).ok().map(|cfg| (path, cfg)));
    let (file_id, file_explicit, file_anchor) = loaded
        .as_ref()
        .and_then(|(_, cfg)| cfg.bot(profile))
        .map(|bot| {
            (
                bot.session_id.clone(),
                bot.session_explicit,
                bot.session_anchor,
            )
        })
        .unwrap_or_else(|| (String::new(), false, 0.0));
    let update = hermes::session_file_update(
        &file_id,
        file_explicit,
        file_anchor,
        &pin.id,
        pin.explicit,
        pin.anchor,
    );
    let stored_anchor = update
        .as_ref()
        .map(|(_, _, anchor)| *anchor)
        .unwrap_or(file_anchor);
    let stored = SessionPin {
        id: pin.id.trim().to_string(),
        explicit: pin.explicit && !pin.id.trim().is_empty(),
        anchor: stored_anchor,
    };
    {
        let mut map = sessions.lock().unwrap_or_else(|err| err.into_inner());
        if stored.id.is_empty() {
            map.remove(profile);
        } else {
            map.insert(profile.to_string(), stored);
        }
    }
    let Some((next_id, next_explicit, next_anchor)) = update else {
        return;
    };
    let Some((path, mut cfg)) = loaded else {
        return;
    };
    let Some(bot) = cfg.bot_mut(profile) else {
        return;
    };
    bot.session_id = next_id;
    bot.session_explicit = next_explicit;
    bot.session_anchor = next_anchor;
    let _ = config::save(&path, &cfg);
}

fn choice_of(session: &hermes::SessionSummary) -> SessionChoice {
    let title = session.title.trim();
    SessionChoice {
        id: session.id.clone(),
        title: if title.is_empty() { session.id.clone() } else { title.to_string() },
        last_active: session.last_active,
        hidden: session.hidden.unwrap_or(false),
        preview: session.preview.clone(),
        source: session.source.clone(),
        archived: session.archived,
        ended: session.ended,
        end_reason: session.end_reason.clone(),
        kept_title: String::new(),
        message_count: session.message_count,
        started_at: session.started_at,
        busy: session.busy,
    }
}

fn session_choices(sessions: &[hermes::SessionSummary], active: &str) -> Vec<SessionChoice> {
    let mut rows: Vec<SessionChoice> = hermes::session_menu_order(sessions)
        .into_iter()
        .map(|session| SessionChoice {
            title: {
                let title = session.title.trim();
                if title.is_empty() {
                    session.id.clone()
                } else {
                    title.to_string()
                }
            },
            id: session.id.clone(),
            last_active: session.last_active,
            hidden: session.hidden.unwrap_or(false),
            preview: session.preview.clone(),
            source: session.source.clone(),
            archived: session.archived,
            ended: session.ended,
            end_reason: session.end_reason.clone(),
            kept_title: String::new(),
            message_count: session.message_count,
            started_at: session.started_at,
            busy: session.busy,
        })
        .collect();
    let routed_away = sessions.iter().any(|session| session.id == active && !hermes::session_route_matches(session));
    if !active.is_empty() && !routed_away && !rows.iter().any(|row| row.id == active) {
        rows.insert(
            0,
            SessionChoice {
                id: active.to_string(),
                title: config::BOT_CHAT_TITLE.to_string(),
                last_active: 0.0,
                hidden: false,
                preview: String::new(),
                source: String::new(),
                archived: false,
                ended: false,
                end_reason: String::new(),
                kept_title: String::new(),
                message_count: None,
                started_at: 0.0,
                busy: false,
            },
        );
    }
    rows
}

fn begin_stream(state: &AppState, profile: &str, replace: bool) -> StreamControl {
    let mut map = state.streams.lock().unwrap_or_else(|err| err.into_inner());
    let slot = map.entry(profile.to_string()).or_insert_with(|| ProfileStreams {
        generation: 0,
        live: Vec::new(),
    });
    slot.generation = slot.generation.wrapping_add(1);
    let control = StreamControl {
        abort: Arc::new(AtomicBool::new(false)),
        stop_requested: Arc::new(AtomicBool::new(false)),
        generation: slot.generation,
    };
    if replace {
        for previous in slot.live.drain(..) {
            previous.abort.store(true, Ordering::Relaxed);
        }
    }
    slot.live.push(control.clone());
    control
}

fn request_stream_stop(state: &AppState, profile: &str) {
    let map = state.streams.lock().unwrap_or_else(|err| err.into_inner());
    if let Some(slot) = map.get(profile) {
        let generations: Vec<u64> = slot.live.iter().map(|control| control.generation).collect();
        let Some(generation) = hermes::stop_stream_generations(&generations) else {
            return;
        };
        for control in &slot.live {
            if control.generation == generation {
                control.stop_requested.store(true, Ordering::Relaxed);
            }
        }
    }
}

fn end_stream(streams: &Mutex<HashMap<String, ProfileStreams>>, profile: &str, generation: u64) {
    if let Some(slot) = streams
        .lock()
        .unwrap_or_else(|err| err.into_inner())
        .get_mut(profile)
    {
        slot.live.retain(|item| item.generation != generation);
    }
}

fn stream_is_current(
    streams: &Mutex<HashMap<String, ProfileStreams>>,
    profile: &str,
    generation: u64,
) -> bool {
    streams
        .lock()
        .unwrap_or_else(|err| err.into_inner())
        .get(profile)
        .map(|slot| slot.generation == generation)
        .unwrap_or(true)
}

fn remembered_run_id(state: &AppState, profile: &str) -> String {
    state
        .run_ids
        .lock()
        .unwrap_or_else(|err| err.into_inner())
        .get(profile)
        .cloned()
        .unwrap_or_default()
}

fn chat_failure_line(err: &HermesError) -> String {
    hermes::send_failure(err).line
}

fn emit(app: &AppHandle, payload: serde_json::Value) {
    let _ = app.emit("hermes", payload);
}

fn emit_status(app: &AppHandle, profile: &str, state_name: &str, detail: &str) {
    emit(
        app,
        serde_json::json!({
            "type": "status",
            "profile": profile,
            "state": state_name,
            "detail": detail,
        }),
    );
}

fn hermes_home_dir() -> std::path::PathBuf {
    if let Ok(value) = std::env::var("HERMES_HOME") {
        let trimmed = value.trim();
        if !trimmed.is_empty() {
            return std::path::PathBuf::from(trimmed);
        }
    }
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".into());
    std::path::PathBuf::from(home).join(".hermes")
}

#[tauri::command]
fn read_soul(profile: String) -> Result<String, String> {
    let path = config::soul_path(profile.trim(), &hermes_home_dir())?;
    if !path.is_file() {
        return Ok(String::new());
    }
    std::fs::read_to_string(&path).map_err(|err| format!("讀唔到 SOUL.md：{err}"))
}

#[tauri::command]
fn write_soul(profile: String, text: String) -> Result<(), String> {
    let path = config::soul_path(profile.trim(), &hermes_home_dir())?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|err| format!("開唔到 SOUL 目錄：{err}"))?;
    }
    std::fs::write(&path, text).map_err(|err| format!("寫唔到 SOUL.md：{err}"))
}

#[tauri::command]
async fn save_bot_meta(app: AppHandle, input: SaveBotMeta) -> Result<PublicBot, String> {
    tauri::async_runtime::spawn_blocking(move || save_bot_meta_sync(app, input))
        .await
        .map_err(|err| format!("讀唔到設定：{err}"))?
}

fn save_bot_meta_sync(app: AppHandle, input: SaveBotMeta) -> Result<PublicBot, String> {
    let profile = input.profile.trim().to_string();
    config::validate_profile(&profile)?;
    let state = app.try_state::<AppState>();
    let _guard = state.as_ref().map(|state| {
        state
            .config_write
            .lock()
            .unwrap_or_else(|err| err.into_inner())
    });
    let path = config_path(&app)?;
    let mut cfg = config::load(&path)?;
    let bot = cfg
        .bot_mut(&profile)
        .ok_or_else(|| format!("名單冇 profile「{profile}」"))?;
    let name = input.display_name.trim();
    bot.display_name = if name.is_empty() {
        profile.clone()
    } else {
        name.to_string()
    };
    bot.detail = input.detail.trim().to_string();
    let saved = PublicBot {
        profile: bot.profile.clone(),
        display_name: bot.display_name.clone(),
        color: bot.color.clone(),
        detail: bot.detail.clone(),
        enabled: bot.enabled,
        compose_mode: bot.compose_mode.clone(),
    };
    config::save(&path, &cfg)?;
    Ok(saved)
}

fn load_public_settings(app: AppHandle) -> Result<PublicSettings, String> {
    let path = config_path(&app)?;
    let needs_setup = !path.exists();
    let cfg = config::load(&path)?;
    // Per-bot API keys are not read any more (R-CL-01): no network code uses them.
    let mut keyring_error = match secrets::store_is_mock() {
        Ok(true) => Some(
            "鑰匙圈係記憶體模擬，金鑰唔會保存。呢個版本應該用系統鑰匙圈（Windows Credential Manager、macOS Keychain、Linux Secret Service）。"
                .into(),
        ),
        Ok(false) => None,
        Err(err) => Some(err),
    };
    let mut bots = Vec::new();
    for bot in &cfg.bots {
        bots.push(PublicBot {
            profile: bot.profile.clone(),
            display_name: bot.display_name.clone(),
            color: bot.color.clone(),
            detail: bot.detail.clone(),
            enabled: bot.enabled,
            compose_mode: bot.compose_mode.clone(),
        });
    }
    let has_kanban_login = [
        secrets::KANBAN_ACCESS_ACCOUNT,
        secrets::KANBAN_REFRESH_ACCOUNT,
        secrets::KANBAN_COOKIE_ACCOUNT,
    ]
    .iter()
    .any(|account| {
        matches!(
            secrets::get_kanban_secret(account),
            Ok(Lookup::Value(value)) if !value.trim().is_empty()
        )
    });
    let has_dashboard_token = match secrets::get_dashboard_token() {
        Ok(Lookup::Value(token)) => !token.trim().is_empty(),
        Ok(Lookup::Missing) => false,
        Err(err) => {
            keyring_error.get_or_insert(err);
            false
        }
    };
    let supported = app
        .try_state::<AppState>()
        .map(|state| state.interaction.supported)
        .unwrap_or_else(interaction::platform_supports_global_input);
    Ok(PublicSettings {
        mode: app_mode().into(),
        kanban_server_url: kanban::origin(&cfg.kanban_base_url),
        kanban_base_url: cfg.kanban_base_url,
        kanban_board: cfg.kanban_board,
        dashboard_base_url: cfg.dashboard_base_url,
        has_kanban_login,
        has_dashboard_token,
        keyring_error,
        interaction: PublicInteraction {
            modifier: cfg.interaction.modifier,
            fade_enabled: cfg.interaction.fade_enabled,
            fade_distance: cfg.interaction.fade_distance,
            min_opacity: cfg.interaction.min_opacity,
            orb_rest_transparency: config::normalize_rest_transparency(
                cfg.interaction.orb_rest_transparency,
            ),
            panel_rest_transparency: config::normalize_rest_transparency(
                cfg.interaction.panel_rest_transparency,
            ),
            supported,
        },
        bots,
        needs_setup,
        show_bot_names: cfg.show_bot_names,
        show_tool_detail: cfg.show_tool_detail,
        suborb_pins: cfg.suborb_pins.clone(),
        panel_sizes: cfg.panel_sizes.clone(),
        orb_positions: cfg.orb_positions.clone(),
        suborb_modes: cfg.suborb_modes.clone(),
        suborb_created: cfg.suborb_created.clone(),
        text_size: config::normalize_text_size(&cfg.text_size),
        ui_language: config::normalize_ui_language(&cfg.ui_language),
        listed_profiles: None,
    })
}

/// The IPC handler runs on the GTK thread. A locked keyring read has to stay
/// on the blocking pool so the main loop can still draw orbs and exit.
#[tauri::command]
async fn get_settings(app: AppHandle) -> Result<PublicSettings, String> {
    tauri::async_runtime::spawn_blocking(move || load_public_settings(app))
        .await
        .map_err(|err| format!("讀唔到設定：{err}"))?
}

#[tauri::command]
async fn set_show_bot_names(app: AppHandle, enabled: bool) -> Result<PublicSettings, String> {
    tauri::async_runtime::spawn_blocking(move || set_show_bot_names_sync(app, enabled))
        .await
        .map_err(|err| format!("讀唔到設定：{err}"))?
}

#[tauri::command]
async fn set_show_tool_detail(app: AppHandle, enabled: bool) -> Result<PublicSettings, String> {
    tauri::async_runtime::spawn_blocking(move || set_show_tool_detail_sync(app, enabled))
        .await
        .map_err(|err| format!("讀唔到設定：{err}"))?
}

fn set_show_tool_detail_sync(app: AppHandle, enabled: bool) -> Result<PublicSettings, String> {
    let state = app.try_state::<AppState>();
    let _guard = state.as_ref().map(|state| {
        state
            .config_write
            .lock()
            .unwrap_or_else(|err| err.into_inner())
    });
    let path = config_path(&app)?;
    config::store_show_tool_detail(&path, enabled)?;
    drop(_guard);
    drop(state);
    load_public_settings(app)
}

/// R-PN-09. width/height 0 removes the panel's saved size (reset).
#[tauri::command]
async fn set_panel_size(
    app: AppHandle,
    panel: String,
    width: u32,
    height: u32,
) -> Result<PublicSettings, String> {
    tauri::async_runtime::spawn_blocking(move || set_panel_size_sync(app, panel, width, height))
        .await
        .map_err(|err| format!("讀唔到設定：{err}"))?
}

fn set_panel_size_sync(
    app: AppHandle,
    panel: String,
    width: u32,
    height: u32,
) -> Result<PublicSettings, String> {
    let state = app.try_state::<AppState>();
    let _guard = state.as_ref().map(|state| {
        state
            .config_write
            .lock()
            .unwrap_or_else(|err| err.into_inner())
    });
    let path = config_path(&app)?;
    let size = if width == 0 || height == 0 {
        None
    } else {
        Some(config::PanelSize { w: width, h: height })
    };
    config::store_panel_size(&path, panel.trim(), size)?;
    drop(_guard);
    drop(state);
    load_public_settings(app)
}

/// R-OB-08. `x`/`y` None removes the orb's saved spot (dropped back home).
#[tauri::command]
async fn set_orb_position(
    app: AppHandle,
    orb: String,
    x: Option<u32>,
    y: Option<u32>,
) -> Result<PublicSettings, String> {
    tauri::async_runtime::spawn_blocking(move || set_orb_position_sync(app, orb, x, y))
        .await
        .map_err(|err| format!("讀唔到設定：{err}"))?
}

fn set_orb_position_sync(
    app: AppHandle,
    orb: String,
    x: Option<u32>,
    y: Option<u32>,
) -> Result<PublicSettings, String> {
    let state = app.try_state::<AppState>();
    let _guard = state.as_ref().map(|state| {
        state
            .config_write
            .lock()
            .unwrap_or_else(|err| err.into_inner())
    });
    let path = config_path(&app)?;
    let point = match (x, y) {
        (Some(x), Some(y)) => Some(config::OrbPosition { x, y }),
        _ => None,
    };
    config::store_orb_position(&path, orb.trim(), point)?;
    drop(_guard);
    drop(state);
    load_public_settings(app)
}

/// R-OB-08 「所有光球返原位」: removes `orb_positions` only.
#[tauri::command]
async fn reset_orb_positions(app: AppHandle) -> Result<PublicSettings, String> {
    tauri::async_runtime::spawn_blocking(move || reset_orb_positions_sync(app))
        .await
        .map_err(|err| format!("讀唔到設定：{err}"))?
}

fn reset_orb_positions_sync(app: AppHandle) -> Result<PublicSettings, String> {
    let state = app.try_state::<AppState>();
    let _guard = state.as_ref().map(|state| {
        state
            .config_write
            .lock()
            .unwrap_or_else(|err| err.into_inner())
    });
    let path = config_path(&app)?;
    config::clear_orb_positions(&path)?;
    drop(_guard);
    drop(state);
    load_public_settings(app)
}

/// R-SO-09. One sub-orb panel's compose mode. `live` is that profile's current
/// session ids; saved modes for sessions missing from it are dropped.
#[tauri::command]
async fn set_suborb_mode(
    app: AppHandle,
    profile: String,
    session_id: String,
    mode: String,
    live: Vec<String>,
) -> Result<PublicSettings, String> {
    tauri::async_runtime::spawn_blocking(move || set_suborb_mode_sync(app, profile, session_id, mode, live))
        .await
        .map_err(|err| format!("讀唔到設定：{err}"))?
}

fn set_suborb_mode_sync(
    app: AppHandle,
    profile: String,
    session_id: String,
    mode: String,
    live: Vec<String>,
) -> Result<PublicSettings, String> {
    let state = app.try_state::<AppState>();
    let _guard = state.as_ref().map(|state| {
        state
            .config_write
            .lock()
            .unwrap_or_else(|err| err.into_inner())
    });
    let path = config_path(&app)?;
    config::store_suborb_mode(&path, profile.trim(), session_id.trim(), mode.trim(), &live)?;
    drop(_guard);
    drop(state);
    load_public_settings(app)
}

#[tauri::command]
async fn set_compose_mode(
    app: AppHandle,
    profile: String,
    mode: String,
) -> Result<PublicSettings, String> {
    tauri::async_runtime::spawn_blocking(move || set_compose_mode_sync(app, profile, mode))
        .await
        .map_err(|err| format!("讀唔到設定：{err}"))?
}

fn set_compose_mode_sync(
    app: AppHandle,
    profile: String,
    mode: String,
) -> Result<PublicSettings, String> {
    let state = app.try_state::<AppState>();
    let _guard = state.as_ref().map(|state| {
        state
            .config_write
            .lock()
            .unwrap_or_else(|err| err.into_inner())
    });
    let path = config_path(&app)?;
    config::store_compose_mode(&path, profile.trim(), mode.trim())?;
    drop(_guard);
    drop(state);
    load_public_settings(app)
}

fn set_show_bot_names_sync(app: AppHandle, enabled: bool) -> Result<PublicSettings, String> {
    let state = app.try_state::<AppState>();
    let _guard = state.as_ref().map(|state| {
        state
            .config_write
            .lock()
            .unwrap_or_else(|err| err.into_inner())
    });
    let path = config_path(&app)?;
    config::store_show_bot_names(&path, enabled)?;
    drop(_guard);
    drop(state);
    load_public_settings(app)
}

#[tauri::command]
async fn save_settings(app: AppHandle, input: SaveSettings) -> Result<PublicSettings, String> {
    tauri::async_runtime::spawn_blocking(move || save_settings_sync(app, input))
        .await
        .map_err(|err| format!("讀唔到設定：{err}"))?
}

fn save_settings_sync(app: AppHandle, input: SaveSettings) -> Result<PublicSettings, String> {
    let state = app.try_state::<AppState>();
    let _config_write = state.as_ref().map(|state| {
        state
            .config_write
            .lock()
            .unwrap_or_else(|err| err.into_inner())
    });
    let memory_sessions = state
        .as_ref()
        .map(|state| session_map(state).clone())
        .unwrap_or_default();
    let previous = load_config(&app)?;
    let dashboard_base_url = {
        let raw = input.dashboard_base_url.trim();
        if raw.is_empty() {
            config::default_dashboard_origin()
        } else {
            config::normalize_http_base(raw, false)?
        }
    };
    let kanban_base_url = config::normalize_http_base(&input.kanban_base_url, true)?;

    let mut seen = std::collections::HashSet::new();
    let mut bots = Vec::new();
    for bot in &input.bots {
        let profile = bot.profile.trim().to_string();
        config::validate_profile(&profile)?;
        if !seen.insert(profile.clone()) {
            return Err(format!("profile「{profile}」重複"));
        }
        let display_name = {
            let name = bot.display_name.trim();
            if name.is_empty() {
                profile.clone()
            } else {
                name.to_string()
            }
        };
        let previous_bot = previous.bot(&profile);
        // Retired per-bot gateway address: kept as the file has it, never read.
        let legacy_base_url = previous_bot.and_then(|bot| bot.legacy_base_url.clone());
        let previous_id = previous_bot
            .map(|bot| bot.session_id.clone())
            .unwrap_or_default();
        let pin = memory_sessions.get(&profile);
        let session_id = config::session_to_keep(pin.map(|pin| pin.id.as_str()), &previous_id);
        let session_explicit = pin.map(|pin| pin.explicit).unwrap_or_else(|| {
            previous_bot
                .map(|bot| bot.session_explicit)
                .unwrap_or(false)
        });
        let session_anchor = previous_bot.map(|bot| bot.session_anchor).unwrap_or(0.0);
        let compose_mode = previous_bot
            .map(|bot| bot.compose_mode.clone())
            .unwrap_or_default();
        bots.push(BotConfig {
            color: config::normalize_color(&bot.color, &profile),
            detail: bot.detail.trim().to_string(),
            profile,
            display_name,
            legacy_base_url,
            session_id,
            session_explicit,
            session_anchor,
            enabled: bot.enabled,
            compose_mode,
        });
    }

    let previous_profiles: std::collections::HashSet<_> =
        previous.bots.iter().map(|b| b.profile.as_str()).collect();
    let next_profiles: std::collections::HashSet<_> =
        bots.iter().map(|b| b.profile.as_str()).collect();
    // A removed bot's old API key (if any) is deleted, never read.
    for removed in previous_profiles.difference(&next_profiles) {
        secrets::delete_profile_key(removed)?;
    }
    if input.clear_dashboard_token {
        secrets::delete_dashboard_token()?;
    } else if !input.dashboard_token.trim().is_empty() {
        secrets::set_dashboard_token(&input.dashboard_token)?;
    }

    let interaction = match &input.interaction {
        Some(raw) => config::InteractionConfig {
            modifier: config::normalize_modifier(&raw.modifier),
            fade_enabled: raw.fade_enabled.unwrap_or(true),
            fade_distance: config::normalize_fade_distance(raw.fade_distance.unwrap_or(120.0)),
            min_opacity: config::normalize_min_opacity(raw.min_opacity.unwrap_or(0.25)),
            // A form without the field keeps what the file already has.
            orb_rest_transparency: config::normalize_rest_transparency(
                raw.orb_rest_transparency
                    .unwrap_or(previous.interaction.orb_rest_transparency),
            ),
            panel_rest_transparency: config::normalize_rest_transparency(
                raw.panel_rest_transparency
                    .unwrap_or(previous.interaction.panel_rest_transparency),
            ),
        },
        None => previous.interaction.clone(),
    };
    let cfg = AppConfig {
        version: 1,
        legacy_gateway_base_url: previous.legacy_gateway_base_url.clone(),
        dashboard_base_url,
        kanban_base_url,
        kanban_board: previous.kanban_board,
        bots,
        interaction,
        show_bot_names: input.show_bot_names,
        show_tool_detail: input.show_tool_detail,
        suborb_pins: previous.suborb_pins.clone(),
        kanban_base_url_from_gateway: previous.kanban_base_url_from_gateway,
        panel_sizes: previous.panel_sizes.clone(),
        orb_positions: previous.orb_positions.clone(),
        suborb_modes: previous.suborb_modes.clone(),
        suborb_created: previous.suborb_created.clone(),
        text_size: config::normalize_text_size(
            input.text_size.as_deref().unwrap_or(&previous.text_size),
        ),
        ui_language: config::normalize_ui_language(
            input.ui_language.as_deref().unwrap_or(&previous.ui_language),
        ),
    };
    config::save(&config_path(&app)?, &cfg)?;
    if let Some(state) = state.as_ref() {
        let mut map = session_map(state);
        map.clear();
        for bot in &cfg.bots {
            let id = bot.session_id.trim();
            if !id.is_empty() {
                map.insert(
                    bot.profile.clone(),
                    SessionPin {
                        id: id.to_string(),
                        explicit: bot.session_explicit,
                        anchor: bot.session_anchor,
                    },
                );
            }
        }
        drop(map);
        *state
            .interaction
            .config
            .lock()
            .unwrap_or_else(|err| err.into_inner()) = cfg.interaction.clone();
    }
    drop(_config_write);
    drop(state);
    load_public_settings(app)
}

#[tauri::command]
async fn probe_gateway(app: AppHandle, state: State<'_, AppState>) -> Result<ProbeReport, String> {
    let cfg = load_config(&app)?;
    require_hermes(&cfg)?;
    let chat = chat_client(&state, &cfg);
    let health = chat.probe().await;
    let (health_ok, health_detail) = match health {
        Ok(body) => (true, if body.is_empty() { "ok".into() } else { body }),
        Err(err) => (false, explain(&err)),
    };
    let mut bots = Vec::new();
    for bot in &cfg.bots {
        let detail = chat
            .list_sessions(&bot.profile)
            .await
            .map(|_| "sessions API 可讀".to_string())
            .map_err(|err| explain(&err));
        bots.push(match detail {
            Ok(detail) => ProbeBot {
                profile: bot.profile.clone(),
                ok: true,
                detail,
            },
            Err(detail) => ProbeBot {
                profile: bot.profile.clone(),
                ok: false,
                detail,
            },
        });
    }
    Ok(ProbeReport {
        health_ok,
        health_detail,
        bots,
    })
}

#[tauri::command]
async fn discover_profiles(
    app: AppHandle,
    state: State<'_, AppState>,
    dashboard_base_url: String,
    token: String,
) -> Result<Vec<DiscoveredBot>, String> {
    let cfg = load_config(&app)?;
    let dashboard = if dashboard_base_url.trim().is_empty() {
        cfg.dashboard_base_url.clone()
    } else {
        config::normalize_http_base(&dashboard_base_url, false)?
    };
    let stored = if token.trim().is_empty() {
        match secrets::get_dashboard_token()? {
            Lookup::Value(value) => value,
            Lookup::Missing => String::new(),
        }
    } else {
        token.trim().to_string()
    };
    let token_ref = if stored.trim().is_empty() {
        None
    } else {
        Some(stored.as_str())
    };
    let found = chat_client(&state, &cfg)
        .session_token_profiles(&dashboard, token_ref, std::time::Duration::from_secs(15))
        .await
        .map_err(|err| match err {
            HermesError::Http { status: 401 | 403, .. } => {
                "Dashboard 拒絕存取。Hermes dashboard 即使喺 localhost 都要 session token（dashboard 頁面嘅 window.__HERMES_SESSION_TOKEN__，唔係 API_SERVER_KEY）。呢個匯入係實驗性質。".into()
            }
            other => format!("匯入名單失敗（實驗）：{}", explain(&other)),
        })?;
    if !token.trim().is_empty() {
        secrets::set_dashboard_token(&token)?;
    }
    Ok(found
        .into_iter()
        .filter_map(|item| {
            config::validate_profile(&item.profile).ok()?;
            Some(DiscoveredBot {
                color: config::parse_hermes_color(&item.color)
                    .unwrap_or_else(|| config::color_for(&item.profile)),
                profile: item.profile,
                display_name: item.display_name,
                detail: item.detail,
            })
        })
        .collect())
}

fn push_discovered(hints: &mut Vec<config::ProfileHint>, found: Vec<hermes::DiscoveredProfile>) {
    for item in found {
        hints.push(config::ProfileHint {
            profile: item.profile,
            display_name: item.display_name,
            detail: item.detail,
            color: item.color,
        });
    }
}

#[tauri::command]
async fn sync_profiles(
    app: AppHandle,
    state: State<'_, AppState>,
    quiet: Option<bool>,
) -> Result<PublicSettings, String> {
    let quiet = quiet.unwrap_or(false);
    let initial = load_config(&app)?;
    if demo_mode() {
        return load_public_settings(app);
    }
    let dashboard = initial.dashboard_base_url.clone();
    if quiet {
        // A down dashboard skips this tick. R-SY-08 owns the backoff (R-CL-01).
        chat_client(&state, &initial)
            .probe()
            .await
            .map_err(|err| explain(&err))?;
    }
    // Discover outside the write lock. std::sync::MutexGuard is not Send,
    // so holding it across these awaits makes the command future unsendable.
    let mut hints = Vec::new();
    // A remote list that answered. Local ~/.hermes alone never counts, so a
    // stale local folder cannot hide gateway bots (R-SY-09 removal).
    // Profile names come only from the dashboard (9119) through HermesClient.
    // The old gateway `/health` hint is gone (R-AR-04, 2026-11-03).
    let mut listed_remote = false;
    let token = match secrets::get_dashboard_token() {
        Ok(Lookup::Value(value)) if !value.trim().is_empty() => Some(value),
        _ => None,
    };
    let mut saw_dashboard = false;
    if let Some(token) = token.as_deref() {
        if let Ok(found) = chat_client(&state, &initial)
            .session_token_profiles(&dashboard, Some(token), std::time::Duration::from_secs(4))
            .await
        {
            saw_dashboard = true;
            listed_remote = true;
            push_discovered(&mut hints, found);
        }
    }
    // Laptop has the Kanban native token, not a dashboard session token.
    // Hermes 0.22.5 gated dashboard accepts that bearer on GET /api/profiles.
    if !saw_dashboard {
        // The client keeps a refreshed login (store_kanban_secrets via its store hook).
        let read = chat_client(&state, &initial).native_profiles().await;
        listed_remote |= read.listed;
        push_discovered(&mut hints, read.profiles);
    }
    hints.extend(config::local_hermes_profiles(&hermes_home_dir()));

    let guard = state
        .config_write
        .lock()
        .unwrap_or_else(|err| err.into_inner());
    let path = config_path(&app)?;
    let mut cfg = config::load(&path)?;
    if !demo_mode() {
        if quiet {
            config::apply_quiet_roster(&path, &hints)?;
        } else {
            let before = cfg.bots.clone();
            config::merge_discovered_profiles(&mut cfg.bots, &hints);
            if cfg.bots != before {
                config::save(&path, &cfg)?;
            }
        }
    }
    drop(guard);
    let mut public = load_public_settings(app)?;
    public.listed_profiles = listed_profiles(listed_remote, &hints);
    Ok(public)
}

/// Names seen on this sync, or None when no remote list answered.
fn listed_profiles(listed_remote: bool, hints: &[config::ProfileHint]) -> Option<Vec<String>> {
    if !listed_remote {
        return None;
    }
    let mut names: Vec<String> = hints.iter().map(|hint| hint.profile.clone()).collect();
    names.sort();
    names.dedup();
    Some(names)
}

#[tauri::command]
async fn set_profile_enabled(
    app: AppHandle,
    profile: String,
    enabled: bool,
) -> Result<PublicSettings, String> {
    tauri::async_runtime::spawn_blocking(move || set_profile_enabled_sync(app, profile, enabled))
        .await
        .map_err(|err| format!("讀唔到設定：{err}"))?
}

fn set_profile_enabled_sync(
    app: AppHandle,
    profile: String,
    enabled: bool,
) -> Result<PublicSettings, String> {
    let profile = profile.trim().to_string();
    config::validate_profile(&profile)?;
    let state = app.try_state::<AppState>();
    let _guard = state.as_ref().map(|state| {
        state
            .config_write
            .lock()
            .unwrap_or_else(|err| err.into_inner())
    });
    let path = config_path(&app)?;
    let mut cfg = config::load(&path)?;
    config::set_bot_enabled(&mut cfg.bots, &profile, enabled)?;
    config::save(&path, &cfg)?;
    drop(_guard);
    load_public_settings(app)
}

#[tauri::command]
async fn open_bot(
    app: AppHandle,
    state: State<'_, AppState>,
    profile: String,
    quiet: Option<bool>,
) -> Result<OpenedChat, String> {
    // A 4s poll passes quiet. Emitting 載入對話… flashes 停止 and dims 傳送
    // for a frame even when the transcript did not change (R-PN-08).
    let quiet = quiet.unwrap_or(false);
    let cfg = load_config(&app)?;
    require_hermes(&cfg)?;
    let bot = bot_or_err(&cfg, &profile)?;
    let chat = chat_client(&state, &cfg);
    let root = bot.profile.clone();
    if !quiet {
        emit_status(&app, &profile, "busy", "載入對話…");
    }
    let pin = load_pin(&app, &state, &profile);
    let result = async {
        let sessions = chat.list_sessions_for_bot_chat(&root).await?;
        let resolved = hermes::session_for_startup(&sessions, &pin.id, pin.explicit, pin.anchor);
        let (session_id, explicit, anchor, source, read_only, read_only_reason, messages) =
            if let Some(resolved) = resolved {
                let count = sessions
                    .iter()
                    .find(|session| session.id == resolved.id)
                    .and_then(|session| session.message_count);
                let messages = chat.fetch_counted_messages(&root, &resolved.id,
                    count,
                )
                .await?;
                (
                    resolved.id,
                    resolved.explicit,
                    resolved.anchor,
                    resolved.source,
                    resolved.read_only,
                    resolved.read_only_reason,
                    messages,
                )
            } else {
                (
                    String::new(),
                    pin.explicit,
                    pin.anchor,
                    String::new(),
                    false,
                    String::new(),
                    Vec::new(),
                )
            };
        Ok::<_, HermesError>((
            session_id,
            explicit,
            anchor,
            source,
            read_only,
            read_only_reason,
            messages,
            sessions,
        ))
    }
    .await;
    match result {
        Ok((
            session_id,
            explicit,
            anchor,
            source,
            read_only,
            read_only_reason,
            messages,
            sessions,
        )) => {
            if !session_id.is_empty() {
                let stored_on_server = sessions.iter().any(|session| session.id == pin.id);
                remember_pin_if_absent(
                    &app,
                    &state,
                    &profile,
                    SessionPin {
                        id: session_id.clone(),
                        explicit,
                        anchor,
                    },
                    stored_on_server,
                );
            }
            if !session_id.is_empty() {
                remember_watched(&state.bot_chats, &profile, &session_id, &messages, &sessions);
            }
            if !quiet {
                emit_status(&app, &profile, "idle", "閒置");
            }
            let message_count = sessions
                .iter()
                .find(|session| session.id == session_id)
                .and_then(|session| session.message_count);
            let (run_id, run_status) = chat.bind_live_run(&root, &session_id).await;
            Ok(OpenedChat {
                sessions: session_choices(&sessions, &session_id),
                profile,
                session_id,
                session_explicit: explicit,
                session_anchor: anchor,
                session_source: source,
                read_only,
                read_only_reason,
                message_count,
                messages,
                run_id,
                run_status,
            })
        }
        Err(err) => {
            let message = explain(&err);
            if !quiet {
                emit_status(&app, &profile, "error", &message);
            }
            Err(message)
        }
    }
}

/// The manual picker write. Only this profile's session id, explicit flag, and
/// the existing anchor are stored. Other config keys stay as they were.
async fn open_explicit_session(
    app: &AppHandle,
    chat: &client::HermesClient,
    sessions: &std::sync::Mutex<HashMap<String, SessionPin>>,
    config_write: &std::sync::Mutex<()>,
    watched: &Arc<Mutex<HashMap<String, WatchedChat>>>,
    profile: &str,
    root: &str,
    session_id: &str,
) -> Result<OpenedChat, String> {
    let session_id = session_id.trim().to_string();
    if session_id.is_empty() {
        return Err("未揀對話".into());
    }
    let listed = chat.list_sessions_for_bot_chat(root)
        .await
        .map_err(|err| explain(&err))?;
    let Some(chosen) = listed.iter().find(|session| session.id == session_id) else {
        return Err("搵唔到呢個對話".into());
    };
    let read_only = hermes::session_read_only_in(chosen, &listed);
    let read_only_reason = if read_only {
        hermes::session_read_only_reason().to_string()
    } else {
        String::new()
    };
    let source = chosen.source.clone();
    let anchor = hermes::most_recent_session(&listed)
        .map(|session| session.last_active)
        .unwrap_or(0.0);
    let messages = chat.fetch_counted_messages(root, &session_id, chosen.message_count)
        .await
        .map_err(|err| explain(&err))?;
    remember_watched(watched, profile, &session_id, &messages, &listed);
    let (run_id, run_status) = chat.bind_live_run(root, &session_id).await;
    persist_pin(
        app,
        sessions,
        config_write,
        profile,
        SessionPin {
            id: session_id.clone(),
            explicit: true,
            anchor,
        },
    );
    Ok(OpenedChat {
        sessions: session_choices(&listed, &session_id),
        profile: profile.to_string(),
        session_id,
        session_explicit: true,
        session_anchor: anchor,
        session_source: source,
        read_only,
        read_only_reason,
        message_count: chosen.message_count,
        messages,
        run_id,
        run_status,
    })
}

#[tauri::command]
async fn select_session(
    app: AppHandle,
    state: State<'_, AppState>,
    profile: String,
    session_id: String,
) -> Result<OpenedChat, String> {
    let cfg = load_config(&app)?;
    require_hermes(&cfg)?;
    let bot = bot_or_err(&cfg, &profile)?;
    let chat = chat_client(&state, &cfg);
    let root = bot.profile.clone();
    open_explicit_session(
        &app,
        &chat,
        &state.sessions,
        &state.config_write,
        &state.bot_chats,
        &profile,
        &root,
        &session_id,
    )
    .await
}

fn emit_session_offer(app: &AppHandle, profile: &str, switch_id: &str, kept_title: &str) {
    emit(
        app,
        serde_json::json!({
            "type": "session.offer",
            "profile": profile,
            "kind": "closed",
            "notice": hermes::CLOSED_SESSION_LINE,
            "switch_session_id": switch_id,
            "kept_title": kept_title,
        }),
    );
}

fn remember_replacement_title(rows: &mut [SessionChoice], session_id: &str, kept: &str) {
    let Some(row) = rows.iter_mut().find(|row| row.id == session_id) else {
        return;
    };
    let unnamed = hermes::is_gateway_fork_title(&row.title)
        || (row.source.is_empty() && row.title == config::BOT_CHAT_TITLE);
    if unnamed {
        row.kept_title = kept.to_string();
    }
}

/// renew: the closed row becomes `<title>_YYYYMMDDHHMM` and is archived; the replacement
/// takes the old title exactly. A failed rename changes nothing. A failed retitle
/// puts the old title back and does not archive. `false` means the picker label
/// still has to show the old name.
async fn hand_title_to_replacement(
    chat: &client::HermesClient,
    root: &str,
    old_id: &str,
    new_id: &str,
    old_title: &str,
    new_title: &str,
    sessions: &[hermes::SessionSummary],
) -> bool {
    let Some(title) = hermes::title_to_patch(old_title, new_title) else {
        return false;
    };
    if old_id.trim().is_empty() || old_id == new_id {
        return false;
    }
    let (ymdhm, seconds) = hermes::local_renew_stamp();
    let existing: Vec<String> = sessions.iter().map(|session| session.title.clone()).collect();
    let primary = format!("{title}_{ymdhm}");
    let with_seconds = format!("{primary}{seconds}");
    let mut retired = hermes::retired_session_title(&title, &ymdhm, &seconds, &existing);
    match chat.patch_session_title(root, old_id, &retired).await {
        Ok(()) => {}
        Err(err) if hermes::is_title_conflict(&err) && retired != with_seconds => {
            retired = with_seconds;
            if chat.patch_session_title(root, old_id, &retired)
                .await
                .is_err()
            {
                return false;
            }
        }
        Err(_) => return false,
    }
    if chat.patch_session_title(root, new_id, &title)
        .await
        .is_err()
    {
        let _ = chat.patch_session_title(root, old_id, &title).await;
        return false;
    }
    let _ = chat.patch_session_archived(root, old_id).await;
    true
}

/// After a turn, follow a session the server wrote instead of the one Devon picked.
/// The write is the explicit picker path (`persist_pin`), and only that profile's session fields.
async fn note_landed_session(
    app: &AppHandle,
    chat: &client::HermesClient,
    sessions: &Mutex<HashMap<String, SessionPin>>,
    config_write: &Mutex<()>,
    profile: &str,
    root: &str,
    posted: &str,
    reported: &str,
    known_ids: &[String],
) {
    let after = chat.list_sessions_for_bot_chat(root)
        .await
        .unwrap_or_default();
    let Some(next) = hermes::landed_session_id(posted, reported, known_ids, &after) else {
        if after
            .iter()
            .any(|session| session.id == posted && hermes::session_send_closed(session, &after))
        {
            emit_session_offer(app, profile, &hermes::closed_switch_id(&after, posted), "");
        }
        return;
    };
    let old_title = after
        .iter()
        .find(|session| session.id == posted)
        .map(|session| session.title.clone())
        .unwrap_or_default();
    let new_title = after
        .iter()
        .find(|session| session.id == next)
        .map(|session| session.title.clone())
        .unwrap_or_default();
    let kept = hermes::kept_replacement_title(&old_title, &new_title);
    hand_title_to_replacement(
        chat, root, posted, &next, &old_title, &new_title, &after,
    )
    .await;
    let watched = app.try_state::<AppState>().map(|state| Arc::clone(&state.bot_chats));
    let Some(watched) = watched else {
        emit_session_offer(app, profile, &next, kept.as_deref().unwrap_or(""));
        return;
    };
    match open_explicit_session(
        app, chat, sessions, config_write, &watched, profile, root, &next,
    )
    .await
    {
        Ok(mut opened) => {
            if let Some(title) = kept.clone() {
                remember_replacement_title(&mut opened.sessions, &opened.session_id, &title);
            }
            let mut payload = serde_json::to_value(&opened).unwrap_or(serde_json::json!({}));
            if let Some(object) = payload.as_object_mut() {
                object.insert("type".into(), serde_json::json!("session.moved"));
                object.insert("notice".into(), serde_json::json!(hermes::MOVED_SESSION_LINE));
                if let Some(title) = &kept {
                    object.insert("kept_title".into(), serde_json::json!(title));
                }
            }
            emit(app, payload);
        }
        Err(_) => emit_session_offer(app, profile, &next, kept.as_deref().unwrap_or("")),
    }
}

#[tauri::command]
async fn send_chat(
    app: AppHandle,
    state: State<'_, AppState>,
    profile: String,
    text: String,
    queue: Option<bool>,
    side: Option<bool>,
) -> Result<(), String> {
    let text = text.trim().to_string();
    if text.is_empty() {
        return Err("訊息係空".into());
    }
    let side_turn = side.unwrap_or(false);
    let queued = queue.unwrap_or(false);
    let cfg = load_config(&app)?;
    require_hermes(&cfg)?;
    let bot = bot_or_err(&cfg, &profile)?.clone();
    let chat = chat_client(&state, &cfg);
    let root = bot.profile.clone();
    // A /btw while a turn is live must not abort that stream. begin_stream
    // with replace posts /stop from the old reader. The side flags stay false.
    let (stop, stop_requested, generation) = if side_turn {
        (
            Arc::new(AtomicBool::new(false)),
            Arc::new(AtomicBool::new(false)),
            u64::MAX,
        )
    } else {
        let control = begin_stream(&state, &profile, !queued);
        (
            Arc::clone(&control.abort),
            Arc::clone(&control.stop_requested),
            control.generation,
        )
    };
    let streams = Arc::clone(&state.streams);
    let run_ids = Arc::clone(&state.run_ids);
    let queued_run_ids = Arc::clone(&state.queued_run_ids);

    let session_cache = Arc::clone(&state.sessions);
    let config_write = Arc::clone(&state.config_write);
    let pin = load_pin(&app, &state, &profile);
    let sessions = chat.list_sessions_for_bot_chat(&root)
        .await
        .map_err(|err| explain(&err))?;
    let target = match hermes::send_session_target(&sessions, &pin.id, pin.explicit, pin.anchor) {
        Ok(target) => target,
        // R-CL-07 first Bot Chat: only when the profile has none at all.
        Err(_) if !sessions.iter().any(|row| row.title == config::BOT_CHAT_TITLE && !row.archived) => {
            let pick = chat.ensure_bot_chat(&root).await.map_err(|err| explain(&err))?;
            hermes::SendTarget { id: pick.id, rewrite: true, explicit: false, anchor: 0.0 }
        }
        Err(err) => return Err(err),
    };
    if target.rewrite {
        persist_pin(
            &app,
            &session_cache,
            &config_write,
            &profile,
            SessionPin {
                id: target.id.clone(),
                explicit: target.explicit,
                anchor: target.anchor,
            },
        );
    }
    let session_id = target.id;
    if sessions
        .iter()
        .any(|session| session.id == session_id && hermes::session_send_closed(session, &sessions))
    {
        return Err(hermes::CLOSED_SESSION_LINE.into());
    }
    let before_ids: Vec<String> = sessions.iter().map(|session| session.id.clone()).collect();
    if !side_turn {
        let busy_label = if queued {
            "排隊中，等佢講完就會行"
        } else {
            "思考中…"
        };
        emit_status(&app, &profile, "busy", busy_label);
    }

    tauri::async_runtime::spawn(async move {
        let mut emit_turn = |event: TurnEvent| {
            if !side_turn {
                let mut streaming = run_ids.lock().unwrap_or_else(|err| err.into_inner());
                let mut waiting = queued_run_ids.lock().unwrap_or_else(|err| err.into_inner());
                let current = streaming.get(&profile).cloned().unwrap_or_default();
                let queued_id = waiting.get(&profile).cloned().unwrap_or_default();
                match &event {
                    TurnEvent::Started { run_id } => {
                        if let Some(id) = hermes::approval_run_id(run_id) {
                            let (next, next_queued) =
                                hermes::note_streaming_run(&current, &queued_id, id, queued);
                            if next.is_empty() {
                                streaming.remove(&profile);
                            } else {
                                streaming.insert(profile.clone(), next);
                            }
                            if next_queued.is_empty() {
                                waiting.remove(&profile);
                            } else {
                                waiting.insert(profile.clone(), next_queued);
                            }
                        }
                    }
                    TurnEvent::Finished { run_id, .. } => {
                        let (next, next_queued) =
                            hermes::promote_finished_run(&current, &queued_id, run_id);
                        if next.is_empty() {
                            streaming.remove(&profile);
                        } else {
                            streaming.insert(profile.clone(), next);
                        }
                        if next_queued.is_empty() {
                            waiting.remove(&profile);
                        } else {
                            waiting.insert(profile.clone(), next_queued);
                        }
                    }
                    _ => {}
                }
            }
            let keep_busy = side_turn
                || (matches!(event, TurnEvent::Finished { .. })
                    && !stream_is_current(&streams, &profile, generation));
            dispatch_turn(&app, &profile, event, keep_busy, side_turn, queued);
        };
        let run = async {
            let first = chat.stream_turn_watched(&root, &session_id,
                &text,
                &stop,
                &stop_requested,
                !side_turn && !queued,
                &mut emit_turn,
            )
            .await;
            if hermes::turn_is_permission_denied(&first) {
                return Err(HermesError::Protocol(
                    hermes::session_read_only_reason().to_string(),
                ));
            }
            if matches!(first, Err(HermesError::Http { status: 404, .. })) {
                persist_pin(
                    &app,
                    &session_cache,
                    &config_write,
                    &profile,
                    SessionPin {
                        id: String::new(),
                        explicit: false,
                        anchor: 0.0,
                    },
                );
                let pick = chat.ensure_bot_chat(&root).await?;
                if pick.read_only {
                    return Err(HermesError::Protocol(pick.read_only_reason));
                }
                persist_pin(
                    &app,
                    &session_cache,
                    &config_write,
                    &profile,
                    SessionPin {
                        id: pick.id.clone(),
                        explicit: false,
                        anchor: 0.0,
                    },
                );
                chat.stream_turn_watched(&root, &pick.id,
                    &text,
                    &stop,
                    &stop_requested,
                    !side_turn && !queued,
                    &mut emit_turn,
                )
                .await
            } else {
                first
            }
        };
        let result = run.await;
        end_stream(&streams, &profile, generation);
        match result {
            Ok(landed) => {
                note_landed_session(
                    &app,
                    &chat,
                    &session_cache,
                    &config_write,
                    &profile,
                    &root,
                    &session_id,
                    &landed,
                    &before_ids,
                )
                .await;
            }
            Err(HermesError::Cancelled) => {
                let keep_busy = side_turn || !stream_is_current(&streams, &profile, generation);
                if !keep_busy {
                    emit_status(&app, &profile, "idle", "已停止");
                }
                emit(
                    &app,
                    serde_json::json!({
                        "type": "done",
                        "profile": profile,
                        "outcome": "cancelled",
                        "detail": "已停止呢次回覆。",
                        "keep_busy": keep_busy,
                        "side": side_turn,
                    }),
                );
            }
            Err(err) => {
                if side_turn {
                    let failure = hermes::send_failure(&err);
                    let message = chat_failure_line(&err);
                    emit(
                        &app,
                        serde_json::json!({
                            "type": "error",
                            "profile": profile,
                            "message": message,
                            "kind": failure.kind,
                            "code": failure.code,
                            "switch_session_id": failure.switch_session_id,
                            "side": true,
                            "keeps_connected": hermes::failure_keeps_connected(&err),
                        }),
                    );
                } else if !stream_is_current(&streams, &profile, generation) {
                    emit(
                        &app,
                        serde_json::json!({
                            "type": "done",
                            "profile": profile,
                            "outcome": "failed",
                            "detail": "",
                            "keep_busy": true,
                        }),
                    );
                } else {
                    let failure = hermes::send_failure(&err);
                    let message = chat_failure_line(&err);
                    if failure.kind == "closed" {
                        emit_status(&app, &profile, "idle", "對話已關閉");
                    } else if failure.kind != "busy" && failure.kind != "other" && !side_turn {
                        emit_status(&app, &profile, "error", &message);
                    }
                    emit(
                        &app,
                        serde_json::json!({
                            "type": "error",
                            "profile": profile,
                            "message": message,
                            "kind": failure.kind,
                            "code": failure.code,
                            "switch_session_id": failure.switch_session_id,
                            "keeps_connected": hermes::failure_keeps_connected(&err),
                        }),
                    );
                }
            }
        }
    });
    Ok(())
}

#[tauri::command]
async fn respond_approval(
    app: AppHandle,
    state: State<'_, AppState>,
    profile: String,
    run_id: String,
    request_id: String,
    choice: String,
    execution_generation: Option<i64>,
) -> Result<(), String> {
    let Some(choice) = hermes::allowed_approval_choice(&choice) else {
        return Err("只可以批准一次或者拒絕".into());
    };
    let Some(run_id) = hermes::approval_run_id(&run_id) else {
        return Err("缺少批准編號".into());
    };
    let Some(request_id) = hermes::approval_request_id(&request_id) else {
        return Err("缺少批准編號".into());
    };
    let cfg = load_config(&app)?;
    require_hermes(&cfg)?;
    let bot = bot_or_err(&cfg, &profile)?;
    let chat = chat_client(&state, &cfg);
    let root = bot.profile.clone();
    let _ = execution_generation;
    chat.submit_approval(&root, run_id, request_id, choice)
        .await
        .map_err(|err| match err {
            HermesError::Http { status: 409, .. } => "呢個批准已經過時".into(),
            HermesError::Http { status, .. } => format!("批准未送出（{status}）。"),
            other => explain(&other),
        })
}

fn dispatch_turn(app: &AppHandle, profile: &str, event: TurnEvent, keep_busy: bool, side: bool, queued: bool) {
    let stamp = |mut payload: serde_json::Value| {
        if side {
            if let Some(object) = payload.as_object_mut() {
                object.insert("side".into(), serde_json::json!(true));
            }
        }
        emit(app, payload);
    };
    match event {
        TurnEvent::Started { run_id } => stamp(serde_json::json!({"type": "run.started", "profile": profile, "run_id": run_id, "queued": queued})),
        TurnEvent::ApprovalRequest {
            run_id,
            request_id,
            description,
            command,
            execution_generation,
        } => stamp(serde_json::json!({
                "type": "approval.request",
                "profile": profile,
                "run_id": run_id,
                "request_id": request_id,
                "description": description,
                "command": command,
                "execution_generation": execution_generation,
            })),
        TurnEvent::ClarifyRequest {
            run_id,
            prompt_id,
            question,
            choices,
            multi_select,
            execution_generation,
            timeout_s,
        } => {
            let mut payload = serde_json::json!({
                "type": "clarify.request",
                "profile": profile,
                "run_id": run_id,
                "prompt_id": prompt_id,
                "question": question,
                "choices": choices,
                "multi_select": multi_select,
                "execution_generation": execution_generation,
            });
            if let Some(timeout) = timeout_s {
                payload["timeout_s"] = serde_json::json!(timeout);
            }
            stamp(payload);
        }
        TurnEvent::ControlSettled { kind, prompt_id } => stamp(serde_json::json!({
                "type": format!("{kind}.settled"),
                "profile": profile,
                "prompt_id": prompt_id,
            })),
        TurnEvent::ApprovalResponded { request_id, choice } => stamp(serde_json::json!({
                "type": "approval.responded",
                "profile": profile,
                "request_id": request_id,
                "choice": choice,
            })),
        TurnEvent::Delta(text) => stamp(serde_json::json!({"type": "delta", "profile": profile, "text": text})),
        TurnEvent::UserShown(text) => stamp(serde_json::json!({"type": "user.shown", "profile": profile, "text": text})),
        TurnEvent::Command(command) => stamp(serde_json::json!({"type": "command", "profile": profile, "command": command})),
        TurnEvent::Commentary(text) => stamp(serde_json::json!({"type": "commentary", "profile": profile, "text": text})),
        // R-ST-05: the status line, no chat row. Back to the plain busy line when the wait ends.
        TurnEvent::QueueElsewhere(waiting) => stamp(serde_json::json!({
                "type": "status",
                "profile": profile,
                "state": "busy",
                "detail": if waiting { hermes::QUEUE_ELSEWHERE_LINE } else { "思考中…" },
            })),
        TurnEvent::Tool {
            phase,
            name,
            preview,
        } => stamp(serde_json::json!({
                "type": "tool",
                "profile": profile,
                "phase": phase,
                "name": name,
                "preview": preview,
            })),
        TurnEvent::Finished { outcome, detail, run_id } => {
            let denied = hermes::text_is_permission_denied(&detail)
                || detail == hermes::session_read_only_reason();
            let blocked = hermes::text_is_execute_code_blocked(&detail)
                || detail == hermes::execute_code_blocked_line();
            let detail = if denied {
                hermes::session_read_only_reason().to_string()
            } else if blocked {
                hermes::execute_code_blocked_line().to_string()
            } else {
                detail
            };
            let state_name = if outcome == "failed" { "error" } else { "idle" };
            let label = if denied || blocked {
                detail.clone()
            } else {
                match outcome.as_str() {
                    "failed" => "回覆失敗",
                    "cancelled" => "已停止",
                    _ => "閒置",
                }
                .to_string()
            };
            if !keep_busy {
                stamp(serde_json::json!({
                    "type": "status",
                    "profile": profile,
                    "state": state_name,
                    "detail": label,
                    "run_id": &run_id,
                }));
            }
            stamp(serde_json::json!({
                "type": "done",
                "profile": profile,
                "outcome": outcome,
                "detail": detail,
                "run_id": &run_id,
                "keep_busy": keep_busy,
            }));
        }
    }
}

#[derive(Serialize)]
struct ClarifyAnswer {
    status: String,
    prompt_id: String,
}

#[tauri::command]
async fn respond_clarify(
    app: AppHandle,
    state: State<'_, AppState>,
    profile: String,
    run_id: String,
    request_id: String,
    execution_generation: i64,
    answer: String,
) -> Result<ClarifyAnswer, String> {
    if answer.chars().count() > 16384 {
        return Err("答案太長".into());
    }
    let Some(run_id) = hermes::approval_run_id(&run_id) else {
        return Err("缺少問題編號".into());
    };
    let Some(request_id) = hermes::approval_request_id(&request_id) else {
        return Err("缺少問題編號".into());
    };
    let cfg = load_config(&app)?;
    require_hermes(&cfg)?;
    let bot = bot_or_err(&cfg, &profile)?;
    let chat = chat_client(&state, &cfg);
    let root = bot.profile.clone();
    let _ = execution_generation;
    let outcome = chat
        .submit_clarify(&root, run_id, request_id, &answer)
    .await
    .map_err(|err| match err {
        HermesError::Http { status: 409, .. } => "答案未送出。".into(),
        HermesError::Http { status, .. } => format!("答案未送出（{status}）。"),
        other => explain(&other),
    })?;
    let status = match outcome {
        hermes::ClarifyOutcome::Resolved => "resolved",
        hermes::ClarifyOutcome::AlreadyResolved => "already_resolved",
        hermes::ClarifyOutcome::Stale => "stale",
    };
    Ok(ClarifyAnswer {
        status: status.to_string(),
        prompt_id: request_id.to_string(),
    })
}

#[tauri::command]
async fn load_run_controls(
    app: AppHandle,
    state: State<'_, AppState>,
    profile: String,
    run_id: String,
) -> Result<serde_json::Value, String> {
    let Some(run_id) = hermes::approval_run_id(&run_id) else {
        return Ok(serde_json::json!({
            "run_id": "",
            "status": "",
            "pending_controls": [],
        }));
    };
    let cfg = load_config(&app)?;
    require_hermes(&cfg)?;
    let bot = bot_or_err(&cfg, &profile)?;
    let chat = chat_client(&state, &cfg);
    let root = bot.profile.clone();
    chat.fetch_run(&root, run_id)
        .await
        .map_err(|_| "讀唔到未答嘅卡。".to_string())
}

#[derive(Deserialize)]
struct HitRectIn {
    id: String,
    x: f64,
    y: f64,
    w: f64,
    h: f64,
    #[serde(default)]
    z: i32,
    #[serde(default)]
    round: bool,
}

static DEBUG_LOG_TX: OnceLock<Option<Sender<String>>> = OnceLock::new();

/// `HERMES_OVERLAY_DEBUG_LOG=/path` opts into a file log. Unset means no file
/// and no disk work. The writer thread keeps the append off the GTK thread.
fn debug_log_tx() -> Option<&'static Sender<String>> {
    DEBUG_LOG_TX
        .get_or_init(|| {
            let path = std::env::var("HERMES_OVERLAY_DEBUG_LOG").unwrap_or_default();
            let path = path.trim();
            if path.is_empty() {
                return None;
            }
            let path = path.to_string();
            let (tx, rx) = mpsc::channel::<String>();
            std::thread::Builder::new()
                .name("hermes-debug-log".into())
                .spawn(move || {
                    let mut file = match std::fs::OpenOptions::new()
                        .create(true)
                        .append(true)
                        .open(&path)
                    {
                        Ok(file) => file,
                        Err(err) => {
                            eprintln!("HERMES_OVERLAY_DEBUG_LOG: {err}");
                            return;
                        }
                    };
                    while let Ok(line) = rx.recv() {
                        let _ = writeln!(file, "{line}");
                        let _ = file.flush();
                    }
                })
                .ok()?;
            Some(tx)
        })
        .as_ref()
}

#[tauri::command]
fn debug_log_enabled() -> bool {
    debug_log_tx().is_some()
}

#[tauri::command]
fn debug_log(line: String) -> Result<(), String> {
    if let Some(tx) = debug_log_tx() {
        let _ = tx.send(line);
    }
    Ok(())
}

/// File log for hit IPC. The writer thread owns the disk; this only enqueues.
pub(crate) fn trace_debug(event: &str, detail: &str) {
    let Some(tx) = debug_log_tx() else {
        return;
    };
    let ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|dur| dur.as_millis())
        .unwrap_or(0);
    let _ = tx.send(format!("unix_ms={ms} {event} {detail}"));
}

#[tauri::command]
fn set_hit_rects(
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    rects: Vec<HitRectIn>,
) -> Result<(), String> {
    let mapped: Vec<interaction::HitRect> = rects
        .into_iter()
        .map(|rect| interaction::HitRect {
            id: rect.id,
            x: rect.x,
            y: rect.y,
            w: rect.w,
            h: rect.h,
            z: rect.z,
            round: rect.round,
        })
        .collect();
    let mut mapped = mapped;
    let mut slot = state
        .interaction
        .rects
        .lock()
        .unwrap_or_else(|err| err.into_inner());
    // Ctrl comes from the OS key monitor (the same one that paints n=1).
    // The page does not send a ctrl flag; a flush logged as ctrl=0 cannot
    // clear KEY_DOWN or drop the orb under the cursor.
    let held = interaction::os_modifier_engaged();
    let key_down = interaction::os_modifier_down();
    let cursor = interaction::css_cursor(&window);
    let cursor_text = match cursor {
        Some((x, y)) => format!("{x:.0},{y:.0}"),
        None => "none".to_string(),
    };
    let mut guard = interaction::shape_guard_lock();
    if interaction::press_frozen(&guard) {
        trace_debug(
            "hit-ipc",
            &format!(
                "cmd=set_hit_rects n={} ignored=1 reason=frozen held={} key={} button=1 cursor={cursor_text}",
                mapped.len(),
                u8::from(held),
                u8::from(key_down)
            ),
        );
        trace_debug(
            "hit-shape",
            &format!(
                "reason=frozen cursor={cursor_text} button=1 held={} key={} n={} ignored=1",
                u8::from(held),
                u8::from(key_down),
                slot.len()
            ),
        );
        return Ok(());
    }
    if mapped.is_empty() && interaction::keep_empty_hit_publish(&window, &slot) {
        trace_debug(
            "hit-ipc",
            &format!(
                "cmd=set_hit_rects n=0 kept=1 held={} key={} cursor={cursor_text}",
                u8::from(held),
                u8::from(key_down)
            ),
        );
        return Ok(());
    }
    let sample = cursor.or(guard.last_cursor);
    let latched = guard.latched.clone();
    let why =
        interaction::retain_modifier_orb(held, key_down, sample, &mut mapped, &slot, &latched);
    if matches!(why, "hit-new" | "hit-prev" | "latched" | "cursor-missing") {
        if let Some(rect) = interaction::orb_or_pill_under_cursor(sample, &mapped).cloned() {
            guard.latched = Some(rect);
        }
    }
    if cursor.is_some() {
        guard.last_cursor = cursor;
    }
    let added = u8::from(why != "up" && why != "hit-new");
    let count = mapped.len();
    let listed = mapped
        .iter()
        .map(|rect| {
            format!(
                "{}@{:.0},{:.0},{:.0}x{:.0}",
                rect.id, rect.x, rect.y, rect.w, rect.h
            )
        })
        .collect::<Vec<_>>()
        .join(" ");
    *slot = mapped;
    trace_debug("hit-rects", &listed);
    trace_debug(
        "hit-ipc",
        &format!(
            "cmd=set_hit_rects n={count} held={} key={} added={added} button={} cursor={cursor_text} why={why}",
            u8::from(held),
            u8::from(key_down),
            u8::from(guard.button_down)
        ),
    );
    if !matches!(why, "up" | "hit-new") {
        trace_debug(
            "hit-shape",
            &format!(
                "reason={why} cursor={cursor_text} last={} button={} held={} key={} n={count}",
                guard
                    .last_cursor
                    .map(|(x, y)| format!("{x:.0},{y:.0}"))
                    .unwrap_or_else(|| "none".to_string()),
                u8::from(guard.button_down),
                u8::from(held),
                u8::from(key_down)
            ),
        );
    }
    Ok(())
}

#[tauri::command]
fn arm_pin_close_guard() {
    interaction::arm_pin_close_guard();
}

#[tauri::command]
fn quit_app(app: AppHandle) {
    app.exit(interaction::APP_EXIT_CODE);
}

#[tauri::command]
fn focus_owner(window: tauri::WebviewWindow) -> String {
    interaction::focus_owner_name(interaction::current_focus_owner(&window)).to_string()
}

#[tauri::command]
fn set_interaction_latch(state: State<'_, AppState>, ids: Vec<String>) -> Result<(), String> {
    *state
        .interaction
        .latched_ids
        .lock()
        .unwrap_or_else(|err| err.into_inner()) = ids;
    Ok(())
}

#[derive(Serialize)]
struct CommandList {
    commands: Vec<hermes::OverlayCommand>,
    hint: String,
}

#[tauri::command]
async fn list_commands(
    app: AppHandle,
    state: State<'_, AppState>,
    profile: String,
) -> Result<CommandList, String> {
    let cfg = load_config(&app)?;
    require_hermes(&cfg)?;
    let bot = bot_or_err(&cfg, &profile)?;
    let chat = chat_client(&state, &cfg);
    let root = bot.profile.clone();
    let cached = state
        .command_cache
        .lock()
        .unwrap_or_else(|err| err.into_inner())
        .get(&profile)
        .cloned();
    let _etag = cached.as_ref().map(|entry| entry.etag.clone());
    let fetched = chat.fetch_overlay_commands(&root).await;
    let mut cache = state
        .command_cache
        .lock()
        .unwrap_or_else(|err| err.into_inner());
    let (commands, hint) = match fetched {
        Ok(hermes::CatalogFetch::Fresh { etag, commands }) => {
            cache.insert(
                profile,
                CommandCacheEntry {
                    etag,
                    commands: commands.clone(),
                },
            );
            (commands, String::new())
        }
        Ok(hermes::CatalogFetch::NotModified) => {
            let commands = cache
                .get(&profile)
                .map(|entry| entry.commands.clone())
                .unwrap_or_default();
            (commands, String::new())
        }
        Ok(hermes::CatalogFetch::Missing)
        | Err(HermesError::Connect(_) | HermesError::Timeout(_) | HermesError::Transport(_))
        | Err(HermesError::Http { status: 404, .. }) => {
            cache.remove(&profile);
            (Vec::new(), hermes::PLUGIN_HINT.to_string())
        }
        Err(err) => {
            cache.remove(&profile);
            (Vec::new(), explain(&err))
        }
    };
    Ok(CommandList { commands, hint })
}

/// Empty follows the server current board. A slug is sent only after a pick.
fn kanban_slug(board: Option<String>) -> String {
    board.unwrap_or_default().trim().to_string()
}

#[tauri::command]
async fn get_kanban_board(
    app: AppHandle,
    state: State<'_, AppState>,
    board: Option<String>,
) -> Result<hermes::KanbanBoard, String> {
    let cfg = load_config(&app)?;
    let slug = kanban_slug(board);
    if demo_mode() {
        return Ok(hermes::KanbanBoard {
            board: slug,
            columns: Vec::new(),
            unavailable: true,
            needs_login: false,
            message: DEMO_LINE.into(),
        });
    }
    // R-AR-01: the client reads, renews once and stores a renewed login.
    chat_client(&state, &cfg)
        .kanban_board(&slug)
        .await
        .map_err(|err| kanban::explain_kanban(&err))
}

fn load_kanban_secrets() -> kanban::KanbanSecrets {
    let read = |account| match secrets::get_kanban_secret(account) {
        Ok(Lookup::Value(value)) => value,
        _ => String::new(),
    };
    kanban::KanbanSecrets {
        access_token: read(secrets::KANBAN_ACCESS_ACCOUNT),
        refresh_token: read(secrets::KANBAN_REFRESH_ACCOUNT),
        session_cookie: read(secrets::KANBAN_COOKIE_ACCOUNT),
        username: read(secrets::KANBAN_USER_ACCOUNT),
        password: read(secrets::KANBAN_PASSWORD_ACCOUNT),
    }
}

fn store_kanban_secrets(secrets: &kanban::KanbanSecrets) -> Result<(), String> {
    let write = |account: &str, value: &str| {
        if value.trim().is_empty() {
            secrets::delete_kanban_secret(account)
        } else {
            secrets::set_kanban_secret(account, value)
        }
    };
    write(secrets::KANBAN_ACCESS_ACCOUNT, &secrets.access_token)?;
    write(secrets::KANBAN_REFRESH_ACCOUNT, &secrets.refresh_token)?;
    write(secrets::KANBAN_COOKIE_ACCOUNT, &secrets.session_cookie)?;
    write(secrets::KANBAN_USER_ACCOUNT, &secrets.username)?;
    write(secrets::KANBAN_PASSWORD_ACCOUNT, &secrets.password)?;
    Ok(())
}

#[derive(Deserialize)]
struct KanbanSignIn {
    #[serde(default)]
    kanban_base_url: String,
    #[serde(default)]
    username: String,
    #[serde(default)]
    password: String,
}

#[tauri::command]
async fn sign_in_kanban(
    app: AppHandle,
    state: State<'_, AppState>,
    input: KanbanSignIn,
) -> Result<String, String> {
    let cfg = load_config(&app)?;
    require_hermes(&cfg)?;
    let typed = config::normalize_http_base(&input.kanban_base_url, true)?;
    let origin = if typed.is_empty() {
        kanban::origin(&cfg.kanban_base_url)
    } else {
        typed.clone()
    };
    if typed != cfg.kanban_base_url {
        remember_kanban_url(&app, &typed)?;
    }
    // Chat and Kanban share this address and login (R-CL-01, R-AR-01).
    state.client.set_origin(&origin);
    if !input.username.trim().is_empty() || !input.password.is_empty() {
        if input.username.trim().is_empty() || input.password.is_empty() {
            return Err("帳號同密碼要一齊填".into());
        }
        state
            .client
            .sign_in_password(&origin, input.username.trim(), &input.password)
            .await
            .map_err(|err| match err {
                HermesError::Http { status: 401 | 403, .. } => "帳號或密碼唔啱".to_string(),
                other => kanban::explain_kanban(&other),
            })?;
        emit(&app, serde_json::json!({ "type": "login.changed" }));
        return Ok(SIGNED_IN_LINE.into());
    }
    state
        .client
        .sign_in_browser(&origin, std::time::Duration::from_secs(180), |url| {
            open_system_browser(url)
        })
        .await
        .map_err(|err| kanban::explain_kanban(&err))?;
    emit(&app, serde_json::json!({ "type": "login.changed" }));
    Ok(SIGNED_IN_LINE.into())
}

/// Sign-in success. Chat and Kanban both run on this login (R-CL-01).
const SIGNED_IN_LINE: &str = "已登入 Hermes Dashboard";

fn remember_kanban_url(app: &AppHandle, url: &str) -> Result<(), String> {
    let state = app.try_state::<AppState>();
    let _guard = state.as_ref().map(|state| {
        state
            .config_write
            .lock()
            .unwrap_or_else(|err| err.into_inner())
    });
    let path = config_path(app)?;
    let mut cfg = config::load(&path)?;
    if cfg.kanban_base_url == url {
        return Ok(());
    }
    cfg.kanban_base_url = url.to_string();
    config::save(&path, &cfg)
}

/// Opens the PKCE authorize URL in the system browser.
/// Not `cmd /C start`: Rust leaves a URL without spaces unquoted, so cmd.exe
/// cuts it at the first `&` and the browser loses `code_challenge` (400).
/// The opener hands the whole URL to the OS (PowerShell/Explorer, xdg-open, open), no cmd.exe.
fn open_system_browser(url: &str) -> Result<(), String> {
    tauri_plugin_opener::open_url(url, None::<&str>)
        .map_err(|_| "開唔到系統瀏覽器。可以喺設定填帳號密碼。".into())
}

#[tauri::command]
async fn get_kanban_task(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<kanban::KanbanTaskDetail, String> {
    let id = id.trim().to_string();
    if id.is_empty() {
        return Err("未揀卡片".into());
    }
    let cfg = load_config(&app)?;
    require_hermes(&cfg)?;
    chat_client(&state, &cfg)
        .kanban_task(&id)
        .await
        .map_err(|err| kanban::explain_kanban(&err))
}

#[tauri::command]
async fn get_kanban_boards(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<kanban::KanbanBoardList, String> {
    let cfg = load_config(&app)?;
    if demo_mode() {
        return Ok(kanban::KanbanBoardList::default());
    }
    chat_client(&state, &cfg)
        .kanban_boards()
        .await
        .map_err(|err| kanban::explain_kanban(&err))
}

#[tauri::command]
async fn set_kanban_board(app: AppHandle, board: String) -> Result<PublicSettings, String> {
    tauri::async_runtime::spawn_blocking(move || set_kanban_board_sync(app, board))
        .await
        .map_err(|err| format!("讀唔到設定：{err}"))?
}

fn set_kanban_board_sync(app: AppHandle, board: String) -> Result<PublicSettings, String> {
    let state = app.try_state::<AppState>();
    let _guard = state.as_ref().map(|state| {
        state
            .config_write
            .lock()
            .unwrap_or_else(|err| err.into_inner())
    });
    let path = config_path(&app)?;
    config::store_kanban_board(&path, &board)?;
    drop(_guard);
    drop(state);
    load_public_settings(app)
}

#[derive(Deserialize)]
struct KanbanPatch {
    #[serde(default)]
    status: String,
    #[serde(default)]
    assignee: String,
    #[serde(default)]
    priority: String,
    #[serde(default)]
    title: String,
}

#[tauri::command]
async fn patch_kanban_task(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    patch: KanbanPatch,
    board: Option<String>,
) -> Result<hermes::KanbanTask, String> {
    let cfg = load_config(&app)?;
    require_hermes(&cfg)?;
    let body = kanban::patch_body(&patch.status, &patch.assignee, &patch.priority, &patch.title)
        .map_err(|err| hermes::kanban_move_error(&err))?;
    if body.as_object().is_some_and(|fields| fields.is_empty()) {
        return Err("看板更新係空".into());
    }
    // R-KB-07 / R-AR-01: the move goes to the dashboard (9119) through the
    // client, on the board on screen. No per-bot key, no 8642.
    chat_client(&state, &cfg)
        .patch_kanban_task(id.trim(), &kanban_slug(board), &body)
        .await
        .map_err(|err| hermes::kanban_move_error(&err))
}

#[derive(Serialize)]
struct CronProfileOut {
    profile: String,
    name: String,
    jobs: Vec<hermes::CronJob>,
    unavailable: bool,
    message: String,
}

#[tauri::command]
async fn list_cron_jobs(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Vec<CronProfileOut>, String> {
    let cfg = load_config(&app)?;
    if demo_mode() {
        return Ok(Vec::new());
    }
    let chat = chat_client(&state, &cfg);
    let bots: Vec<BotConfig> = cfg.bots.iter().filter(|bot| bot.enabled).cloned().collect();
    let mut out = Vec::new();
    for bot in bots {
        let name = if bot.display_name.trim().is_empty() {
            bot.profile.clone()
        } else {
            bot.display_name.clone()
        };
        let root = bot.profile.clone();
        match chat.fetch_cron_jobs(&root).await {
            Ok(list) => out.push(CronProfileOut {
                profile: bot.profile,
                name,
                jobs: list.jobs,
                unavailable: list.unavailable,
                message: list.message,
            }),
            Err(err) => out.push(CronProfileOut {
                profile: bot.profile,
                name,
                jobs: Vec::new(),
                unavailable: true,
                message: explain(&err),
            }),
        }
    }
    Ok(out)
}

#[derive(Deserialize)]
struct ClientCommandIn {
    profile: String,
    command: String,
    #[serde(default)]
    args: String,
    #[serde(default)]
    model: String,
    #[serde(default)]
    provider: String,
    #[serde(default)]
    refused: Vec<String>,
}

#[derive(Serialize)]
struct ClientCommandOut {
    command: String,
    notice: String,
    session_id: String,
    options: Vec<String>,
}

#[tauri::command]
async fn client_command(
    app: AppHandle,
    state: State<'_, AppState>,
    input: ClientCommandIn,
) -> Result<ClientCommandOut, String> {
    let cfg = load_config(&app)?;
    require_hermes(&cfg)?;
    let bot = bot_or_err(&cfg, &input.profile)?.clone();
    let chat = chat_client(&state, &cfg);
    let root = bot.profile.clone();
    let command = input.command.trim().to_string();
    let args = input.args.trim().to_string();
    match command.as_str() {
        "stop" => {
            let outcome = request_stop(&app, &state, &input.profile, None).await;
            let notice = match outcome {
                Ok(status) if status == "not_active" => "已停止呢次回覆。".into(),
                Ok(_) => String::new(),
                Err(message) => message,
            };
            Ok(ClientCommandOut {
                command,
                notice,
                session_id: cached_session(&state, &input.profile).unwrap_or_default(),
                options: Vec::new(),
            })
        }
        "continue" => {
            let sessions = chat.list_sessions_for_bot_chat(&root)
                .await
                .map_err(|err| hermes::explain(&err))?;
            let refused_ids: Vec<&str> = input.refused.iter().map(String::as_str).collect();
            if let Some(found) = hermes::writable_continuation(&sessions, &args, &refused_ids) {
                pin_explicit(&app, &state, &input.profile, &root, &found.id).await;
                return Ok(ClientCommandOut {
                    command,
                    notice: "已轉去可以傳嘢嘅對話".into(),
                    session_id: found.id.clone(),
                    options: Vec::new(),
                });
            }
            let session_id = chat.create_session(&root, Some(hermes::OVERLAY_CONTINUE_TITLE),
            )
            .await
            .map_err(|err| match &err {
                HermesError::Http { status: 400, .. } => "開唔到新對話。".into(),
                _ => hermes::explain(&err),
            })?;
            pin_explicit(&app, &state, &input.profile, &root, &session_id).await;
            Ok(ClientCommandOut {
                command,
                notice: "已開新對話".into(),
                session_id,
                options: Vec::new(),
            })
        }
        "new" => {
            let title = if args.is_empty() {
                None
            } else {
                Some(args.as_str())
            };
            let session_id = chat.create_session(&root, title)
                .await
                .map_err(|err| explain(&err))?;
            Ok(ClientCommandOut {
                command,
                notice: format!("新 session {session_id}"),
                session_id,
                options: Vec::new(),
            })
        }
        "title" => {
            if args.is_empty() {
                return Err("要有標題。".into());
            }
            let session_id = session_for_client(&app, &state, &input.profile, &root).await?;
            if let Err(err) =
                chat.patch_session_title(&root, &session_id, &args).await
            {
                if !matches!(err, HermesError::Http { status: 404, .. }) {
                    return Err(explain(&err));
                }
                let session_id =
                    replace_missing_session(&app, &state, &input.profile, &root).await?;
                chat.patch_session_title(&root, &session_id, &args)
                    .await
                    .map_err(|err| explain(&err))?;
                return Ok(ClientCommandOut {
                    command,
                    notice: format!("標題已改做 {args}"),
                    session_id,
                    options: Vec::new(),
                });
            }
            Ok(ClientCommandOut {
                command,
                notice: format!("標題已改做 {args}"),
                session_id,
                options: Vec::new(),
            })
        }
        "branch" => {
            let session_id = session_for_client(&app, &state, &input.profile, &root).await?;
            let forked = match chat.fork_session(&root, &session_id, &args)
                .await
            {
                Ok(id) => id,
                Err(HermesError::Http { status: 404, .. }) => {
                    let session_id =
                        replace_missing_session(&app, &state, &input.profile, &root).await?;
                    chat.fork_session(&root, &session_id, &args)
                        .await
                        .map_err(|err| explain(&err))?
                }
                Err(err) => return Err(explain(&err)),
            };
            pin_explicit(&app, &state, &input.profile, &root, &forked).await;
            Ok(ClientCommandOut {
                command,
                notice: format!("已分支做 {forked}"),
                session_id: forked,
                options: Vec::new(),
            })
        }
        "model" => {
            if input.model.trim().is_empty() && args.is_empty() {
                let options = chat.list_model_options(&root)
                    .await
                    .map_err(|err| explain(&err))?;
                return Ok(ClientCommandOut {
                    command,
                    notice: if options.is_empty() {
                        "冇模型選項。".into()
                    } else {
                        String::new()
                    },
                    session_id: active_session(&app, &state, &input.profile).unwrap_or_default(),
                    options,
                });
            }
            let model = if input.model.trim().is_empty() {
                args
            } else {
                input.model.trim().to_string()
            };
            let session_id = session_for_client(&app, &state, &input.profile, &root).await?;
            if let Err(err) = chat.lock_session_model(&root, &session_id,
                &model,
                input.provider.trim(),
            )
            .await
            {
                if !matches!(err, HermesError::Http { status: 404, .. }) {
                    return Err(explain(&err));
                }
                let session_id =
                    replace_missing_session(&app, &state, &input.profile, &root).await?;
                chat.lock_session_model(&root, &session_id,
                    &model,
                    input.provider.trim(),
                )
                .await
                .map_err(|err| explain(&err))?;
                return Ok(ClientCommandOut {
                    command,
                    notice: format!("已切換模型 {model}"),
                    session_id,
                    options: Vec::new(),
                });
            }
            Ok(ClientCommandOut {
                command,
                notice: format!("已切換模型 {model}"),
                session_id,
                options: Vec::new(),
            })
        }
        other => Err(format!("唔係 client 指令：{other}")),
    }
}

async fn session_for_client(
    app: &AppHandle,
    state: &AppState,
    profile: &str,
    root: &str,
) -> Result<String, String> {
    let chat = Arc::clone(&state.client);
    let pin = load_pin(app, state, profile);
    let sessions = chat.list_sessions_for_bot_chat(root)
        .await
        .map_err(|err| explain(&err))?;
    let resolved = hermes::session_for_startup(&sessions, &pin.id, pin.explicit, pin.anchor)
        .ok_or_else(|| "未有 Bot Chat".to_string())?;
    if resolved.read_only {
        return Err(resolved.read_only_reason);
    }
    let stored_on_server = sessions.iter().any(|session| session.id == pin.id);
    remember_pin_if_absent(
        app,
        state,
        profile,
        SessionPin {
            id: resolved.id.clone(),
            explicit: resolved.explicit,
            anchor: resolved.anchor,
        },
        stored_on_server,
    );
    Ok(resolved.id)
}

async fn pin_explicit(
    app: &AppHandle,
    state: &AppState,
    profile: &str,
    root: &str,
    id: &str,
) {
    let chat = Arc::clone(&state.client);
    let anchor = chat.list_sessions(root)
        .await
        .ok()
        .and_then(|sessions| {
            hermes::most_recent_session(&sessions).map(|session| session.last_active)
        })
        .unwrap_or(0.0);
    remember_pin(
        app,
        state,
        profile,
        SessionPin {
            id: id.to_string(),
            explicit: true,
            anchor,
        },
    );
}

async fn replace_missing_session(
    app: &AppHandle,
    state: &AppState,
    profile: &str,
    root: &str,
) -> Result<String, String> {
    let chat = Arc::clone(&state.client);
    persist_pin(
        app,
        &state.sessions,
        &state.config_write,
        profile,
        SessionPin {
            id: String::new(),
            explicit: false,
            anchor: 0.0,
        },
    );
    let pick = chat.ensure_bot_chat(root)
        .await
        .map_err(|err| explain(&err))?;
    if pick.read_only {
        return Err(pick.read_only_reason);
    }
    remember_pin(
        app,
        state,
        profile,
        SessionPin {
            id: pick.id.clone(),
            explicit: false,
            anchor: 0.0,
        },
    );
    Ok(pick.id)
}

/// Monitor size. Linux stays hidden until reveal. Windows is already visible.
/// The page waits until its viewport matches, paints once, then calls `reveal_overlay`.
#[tauri::command]
fn fit_overlay(app: AppHandle) -> OverlayCssSize {
    let Some(window) = app.get_webview_window("main") else {
        return OverlayCssSize {
            width: 0,
            height: 0,
            inset_top: 0,
            inset_right: 0,
            inset_bottom: 0,
            inset_left: 0,
        };
    };
    #[cfg(target_os = "linux")]
    let _ = window.set_decorations(false);
    interaction::place_overlay(&window);
    let (width, height) = interaction::monitor_css_size(&window).unwrap_or((0, 0));
    let (inset_top, inset_right, inset_bottom, inset_left) =
        interaction::monitor_work_insets(&window);
    OverlayCssSize {
        width,
        height,
        inset_top,
        inset_right,
        inset_bottom,
        inset_left,
    }
}

#[derive(serde::Serialize)]
struct OverlayCssSize {
    width: u32,
    height: u32,
    inset_top: u32,
    inset_right: u32,
    inset_bottom: u32,
    inset_left: u32,
}

/// Map without a visible frame when the hidden resize never reaches the
/// page. Linux WebKit often keeps the 1280×800 viewport until the first
/// map; opacity 0 is that map. Windows already resized with the hidden
/// position call, so this does not show.
#[tauri::command]
fn map_overlay_for_layout(app: AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    #[cfg(target_os = "linux")]
    let _ = window.set_decorations(false);
    interaction::place_overlay(&window);
    #[cfg(target_os = "linux")]
    {
        interaction::set_window_opacity(&window, 0.0);
        let _ = window.show();
    }
}

/// Linux maps inside `set_visible` before `set_decorated`, so `visible: false`
/// lets decorations land first. Windows stays on the f8cb046 path: created
/// visible and maximized, and reveal does not focus or restyle decorations.
#[tauri::command]
async fn wait_presented_frames(app: AppHandle, frames: Option<u32>) -> u32 {
    let count = frames.unwrap_or(2);
    tauri::async_runtime::spawn_blocking(move || interaction::wait_presented_frames(&app, count))
        .await
        .unwrap_or(0)
}

#[tauri::command]
fn modifier_down_now(state: State<'_, AppState>) -> bool {
    interaction::modifier_down_now(state.interaction.as_ref())
}

/// Esc closed a panel. The webview must not keep the next Ctrl chord.
#[tauri::command]
fn release_overlay_focus(app: AppHandle, restore: Option<bool>) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    interaction::release_overlay_focus(&window, restore.unwrap_or(false));
}

fn suborb_panel_id(profile: &str, session_id: &str) -> String {
    format!("suborb:{profile}:{session_id}")
}

fn suborb_title(raw: &str) -> Result<String, String> {
    let title = raw.trim();
    if title.is_empty() {
        return Err("要有標題。".into());
    }
    if title == "Continue previous conversation" {
        return Err("標題唔用。".into());
    }
    if title.len() > 120 {
        return Err("標題太長。".into());
    }
    Ok(title.to_string())
}

#[derive(Serialize)]
struct CreatedSession {
    session_id: String,
    title: String,
}

/// A new Hermes session for one bot. Does not write the main orb pin.
#[tauri::command]
async fn create_task_session(
    app: AppHandle,
    state: State<'_, AppState>,
    profile: String,
    title: String,
) -> Result<CreatedSession, String> {
    let title = suborb_title(&title)?;
    let cfg = load_config(&app)?;
    require_hermes(&cfg)?;
    let bot = bot_or_err(&cfg, &profile)?.clone();
    let chat = chat_client(&state, &cfg);
    let root = bot.profile.clone();
    let session_id = chat.create_session(&root, Some(title.as_str()))
        .await
        .map_err(|err| match &err {
            HermesError::Http { status: 400, .. } => "開唔到新對話。".into(),
            _ => hermes::explain(&err),
        })?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs_f64())
        .unwrap_or(0.0);
    if let Ok(path) = config_path(&app) {
        let _guard = state.config_write.lock().unwrap_or_else(|err| err.into_inner());
        let row = config::CreatedSuborb {
            id: session_id.clone(),
            title: title.clone(),
            source: "api_server".into(),
            started_at: now,
            last_active: now,
            message_count: Some(0),
        };
        if let Err(_err) = config::store_suborb_created(&path, &profile, &row) {
            eprintln!("suborb_created: profile {profile} 寫入失敗");
        }
    }
    Ok(CreatedSession { session_id, title })
}

/// Load one task session for a sub-orb panel. Does not write config.json.
#[tauri::command]
async fn open_suborb(
    app: AppHandle,
    state: State<'_, AppState>,
    profile: String,
    session_id: String,
) -> Result<OpenedChat, String> {
    let session_id = session_id.trim().to_string();
    if session_id.is_empty() {
        return Err("未揀對話".into());
    }
    let cfg = load_config(&app)?;
    require_hermes(&cfg)?;
    let bot = bot_or_err(&cfg, &profile)?.clone();
    let chat = chat_client(&state, &cfg);
    let root = bot.profile.clone();
    let listed = chat.list_sessions_for_bot_chat(&root)
        .await
        .map_err(|err| explain(&err))?;
    let Some(chosen) = listed.iter().find(|session| session.id == session_id) else {
        return Err("搵唔到呢個對話".into());
    };
    let read_only = hermes::session_read_only(&chosen.source);
    let read_only_reason = if read_only {
        hermes::session_read_only_reason().to_string()
    } else {
        String::new()
    };
    let messages = chat.fetch_counted_messages(&root, &session_id,
        chosen.message_count,
    )
    .await
    .map_err(|err| explain(&err))?;
    remember_watched(&state.bot_chats, &profile, &session_id, &messages, &listed);
    let (run_id, run_status) = chat.bind_live_run(&root, &session_id).await;
    Ok(OpenedChat {
        sessions: session_choices(&listed, &session_id),
        profile,
        session_id,
        session_explicit: false,
        session_anchor: 0.0,
        session_source: chosen.source.clone(),
        read_only,
        read_only_reason,
        message_count: chosen.message_count,
        messages,
        run_id,
        run_status,
    })
}

#[derive(Serialize)]
struct SessionTail {
    session_id: String,
    message_count: u64,
    messages: Vec<hermes::UiMessage>,
    settled: bool,
}

/// One tail page for a session whose list stamp changed. Not a full transcript.
#[tauri::command]
async fn peek_session_tail(
    app: AppHandle,
    state: State<'_, AppState>,
    profile: String,
    session_id: String,
    message_count: Option<u64>,
) -> Result<SessionTail, String> {
    let session_id = session_id.trim().to_string();
    let count = message_count.unwrap_or(0);
    if session_id.is_empty() {
        return Err("未揀對話".into());
    }
    if count == 0 {
        return Ok(SessionTail {
            session_id,
            message_count: 0,
            messages: Vec::new(),
            settled: false,
        });
    }
    let cfg = load_config(&app)?;
    require_hermes(&cfg)?;
    let bot = bot_or_err(&cfg, &profile)?.clone();
    let chat = chat_client(&state, &cfg);
    let root = bot.profile.clone();
    let from = count.saturating_sub(40);
    let limit = (count - from).max(1);
    let page = chat.fetch_message_page(&root, &session_id, from, limit)
        .await
        .map_err(|err| explain(&err))?;
    let settled = page
        .messages
        .last()
        .map(|message| message.role == "bot" || message.role == "assistant")
        .unwrap_or(false);
    Ok(SessionTail {
        session_id,
        message_count: count,
        messages: page.messages,
        settled,
    })
}

/// Send on a sub-orb session. The main orb pin is not read or written.
#[tauri::command]
async fn send_suborb(
    app: AppHandle,
    state: State<'_, AppState>,
    profile: String,
    session_id: String,
    text: String,
    queue: Option<bool>,
    side: Option<bool>,
) -> Result<(), String> {
    let text = text.trim().to_string();
    let session_id = session_id.trim().to_string();
    if text.is_empty() || session_id.is_empty() {
        return Err("訊息係空".into());
    }
    let side_turn = side.unwrap_or(false);
    let queued = queue.unwrap_or(false);
    let cfg = load_config(&app)?;
    require_hermes(&cfg)?;
    let bot = bot_or_err(&cfg, &profile)?.clone();
    let chat = chat_client(&state, &cfg);
    let root = bot.profile.clone();
    let panel = suborb_panel_id(&profile, &session_id);
    let (stop, stop_requested, generation) = if side_turn {
        (
            Arc::new(AtomicBool::new(false)),
            Arc::new(AtomicBool::new(false)),
            u64::MAX,
        )
    } else {
        let control = begin_stream(&state, &panel, !queued);
        (
            Arc::clone(&control.abort),
            Arc::clone(&control.stop_requested),
            control.generation,
        )
    };
    let streams = Arc::clone(&state.streams);
    let run_ids = Arc::clone(&state.run_ids);
    let queued_run_ids = Arc::clone(&state.queued_run_ids);

    if !side_turn {
        let busy_label = if queued {
            "排隊中，等佢講完就會行"
        } else {
            "思考中…"
        };
        emit_status(&app, &panel, "busy", busy_label);
    }
    tauri::async_runtime::spawn(async move {
        let mut emit_turn = |event: TurnEvent| {
            if !side_turn {
                let mut streaming = run_ids.lock().unwrap_or_else(|err| err.into_inner());
                let mut waiting = queued_run_ids.lock().unwrap_or_else(|err| err.into_inner());
                let current = streaming.get(&panel).cloned().unwrap_or_default();
                let queued_id = waiting.get(&panel).cloned().unwrap_or_default();
                match &event {
                    TurnEvent::Started { run_id } => {
                        if let Some(id) = hermes::approval_run_id(run_id) {
                            let (next, next_queued) =
                                hermes::note_streaming_run(&current, &queued_id, id, queued);
                            if next.is_empty() {
                                streaming.remove(&panel);
                            } else {
                                streaming.insert(panel.clone(), next);
                            }
                            if next_queued.is_empty() {
                                waiting.remove(&panel);
                            } else {
                                waiting.insert(panel.clone(), next_queued);
                            }
                        }
                    }
                    TurnEvent::Finished { run_id, .. } => {
                        let (next, next_queued) =
                            hermes::promote_finished_run(&current, &queued_id, run_id);
                        if next.is_empty() {
                            streaming.remove(&panel);
                        } else {
                            streaming.insert(panel.clone(), next);
                        }
                        if next_queued.is_empty() {
                            waiting.remove(&panel);
                        } else {
                            waiting.insert(panel.clone(), next_queued);
                        }
                    }
                    _ => {}
                }
            }
            let keep_busy = side_turn
                || (matches!(event, TurnEvent::Finished { .. })
                    && !stream_is_current(&streams, &panel, generation));
            dispatch_turn(&app, &panel, event, keep_busy, side_turn, queued);
        };
        let result = chat.stream_turn_watched(&root, &session_id,
            &text,
            &stop,
            &stop_requested,
            !side_turn && !queued,
            &mut emit_turn,
        )
        .await;
        end_stream(&streams, &panel, generation);
        match result {
            Ok(_) => {}
            Err(HermesError::Cancelled) => {
                let keep_busy = side_turn || !stream_is_current(&streams, &panel, generation);
                if !keep_busy {
                    emit_status(&app, &panel, "idle", "已停止");
                }
                emit(
                    &app,
                    serde_json::json!({
                        "type": "done",
                        "profile": panel,
                        "outcome": "cancelled",
                        "detail": "已停止呢次回覆。",
                        "keep_busy": keep_busy,
                        "side": side_turn,
                    }),
                );
            }
            Err(err) => {
                let failure = hermes::send_failure(&err);
                let message = chat_failure_line(&err);
                if !side_turn && stream_is_current(&streams, &panel, generation) {
                    if failure.kind == "closed" {
                        emit_status(&app, &panel, "idle", "對話已關閉");
                    } else if failure.kind != "busy" && failure.kind != "other" {
                        emit_status(&app, &panel, "error", &message);
                    }
                }
                emit(
                    &app,
                    serde_json::json!({
                        "type": "error",
                        "profile": panel,
                        "message": message,
                        "kind": failure.kind,
                        "code": failure.code,
                        "switch_session_id": "",
                        "side": side_turn,
                        "keeps_connected": hermes::failure_keeps_connected(&err),
                    }),
                );
            }
        }
    });
    Ok(())
}

/// Stop the sub-orb run. The main orb stream is left alone.
#[tauri::command]
async fn stop_suborb(
    app: AppHandle,
    state: State<'_, AppState>,
    profile: String,
    session_id: String,
    run_id: Option<String>,
) -> Result<String, String> {
    let panel = suborb_panel_id(profile.trim(), session_id.trim());
    request_stream_stop(&state, &panel);
    let hinted = run_id.unwrap_or_default();
    let remembered = remembered_run_id(&state, &panel);
    let targets = hermes::stop_target_ids(&hinted, &remembered);
    if targets.is_empty() {
        return Ok("not_active".into());
    }
    let cfg = load_config(&app)?;
    require_hermes(&cfg)?;
    let bot = bot_or_err(&cfg, profile.trim())?;
    let chat = chat_client(&state, &cfg);
    let root = bot.profile.clone();
    for run_id in targets {
        match chat.stop_run(&root, &run_id)
            .await
            .map_err(|_| "停止未送到。".to_string())?
        {
            hermes::StopOutcome::Stopping => return Ok("stopping".into()),
            hermes::StopOutcome::NotActive => {}
        }
    }
    Ok("not_active".into())
}

#[tauri::command]
async fn set_suborb_pin(
    app: AppHandle,
    profile: String,
    session_id: String,
    pinned: bool,
) -> Result<PublicSettings, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = config_path(&app)?;
        config::store_suborb_pin(&path, profile.trim(), session_id.trim(), pinned)?;
        load_public_settings(app)
    })
    .await
    .map_err(|err| format!("讀唔到設定：{err}"))?
}

fn hermes_error_kind(err: &HermesError) -> String {
    match err {
        HermesError::Http { status, .. } => format!("http {status}"),
        HermesError::Connect(_) => "connect".into(),
        HermesError::Timeout(_) => "timeout".into(),
        HermesError::Transport(_) => "transport".into(),
        HermesError::Protocol(_) => "protocol".into(),
        HermesError::Cancelled => "cancelled".into(),
    }
}

fn take_seed_retry(state: &AppState, profile: &str) -> Option<u64> {
    let mut map = state.seed_attempts.lock().unwrap_or_else(|err| err.into_inner());
    let row = map.entry(profile.to_string()).or_insert(SeedAttempt { n: 0, pending: false });
    if row.pending {
        return None;
    }
    let wait = client::seed_backoff_ms(row.n);
    row.n = row.n.saturating_add(1);
    row.pending = true;
    Some(wait)
}

fn finish_seed_wait(state: &AppState, profile: &str) {
    let mut map = state.seed_attempts.lock().unwrap_or_else(|err| err.into_inner());
    if let Some(row) = map.get_mut(profile) {
        row.pending = false;
    }
}

fn clear_seed_attempt(state: &AppState, profile: &str) {
    let mut map = state.seed_attempts.lock().unwrap_or_else(|err| err.into_inner());
    if let Some(row) = map.get_mut(profile) {
        row.n = 0;
        row.pending = false;
    }
}

/// Pins missing from the recent list are fetched by id. 404 and archived
/// rows are returned so the page can unpin. Any other error keeps the pin.
async fn attach_pinned_sessions(
    chat: &client::HermesClient,
    profile: &str,
    sessions: &mut Vec<hermes::SessionSummary>,
    pins: &[String],
) -> Vec<String> {
    let mut gone = Vec::new();
    for id in pins {
        let id = id.trim();
        if id.is_empty() || sessions.iter().any(|row| row.id == id) {
            continue;
        }
        match chat.get_session(profile, id).await {
            Ok(client::SessionGet::Found(session)) => {
                if session.archived {
                    gone.push(id.to_string());
                }
                sessions.push(session);
            }
            Ok(client::SessionGet::Missing) => gone.push(id.to_string()),
            Err(err) => {
                let kind = hermes_error_kind(&err);
                eprintln!("seed_session_lists: profile {profile} session {id} 讀取失敗（{kind}），保留釘選");
            }
        }
    }
    gone
}

async fn seed_profile(
    app: &AppHandle,
    state: &AppState,
    profile: &str,
    pins: &[String],
) -> Result<(), HermesError> {
    let mut sessions = state.client.list_sessions_for_bot_chat(profile).await?;
    let gone = attach_pinned_sessions(&state.client, profile, &mut sessions, pins).await;
    let pin = load_pin(app, state, profile);
    let resolved = hermes::session_for_startup(&sessions, &pin.id, pin.explicit, pin.anchor)
        .map(|session| session.id);
    let mut rows = session_choices(&sessions, resolved.as_deref().unwrap_or(""));
    for session in &sessions {
        let pinned = pins.iter().any(|id| id == &session.id);
        if pinned && !session.archived && !rows.iter().any(|row| row.id == session.id) {
            rows.push(choice_of(session));
        }
    }
    emit(
        app,
        serde_json::json!({
            "type": "sessions",
            "profile": profile,
            "session_id": resolved.clone().unwrap_or_default(),
            "sessions": rows,
            "gone_pins": gone,
        }),
    );
    Ok(())
}

async fn seed_profile_by_name(app: &AppHandle, state: &AppState, profile: &str) -> Result<(), HermesError> {
    let cfg = load_config(app).map_err(|_| HermesError::Protocol("讀唔到設定".into()))?;
    let Some(bot) = cfg.bots.iter().find(|bot| bot.profile == profile && bot.enabled) else {
        return Ok(());
    };
    let pins = cfg.suborb_pins.get(profile).cloned().unwrap_or_default();
    seed_profile(app, state, &bot.profile, &pins).await
}

fn note_seed_list_failure(app: &AppHandle, state: &AppState, profile: &str, err: &HermesError) {
    let kind = hermes_error_kind(err);
    let Some(wait) = take_seed_retry(state, profile) else {
        eprintln!("seed_session_lists: profile {profile} 清單失敗（{kind}），再試已排定");
        return;
    };
    eprintln!("seed_session_lists: profile {profile} 清單失敗（{kind}），{wait}ms 後再試");
    let app = app.clone();
    let profile = profile.to_string();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(wait)).await;
        let Some(state) = app.try_state::<AppState>() else {
            return;
        };
        finish_seed_wait(&state, &profile);
        match seed_profile_by_name(&app, &state, &profile).await {
            Ok(()) => clear_seed_attempt(&state, &profile),
            Err(err) => note_seed_list_failure(&app, &state, &profile, &err),
        }
    });
}

/// Re-send each profile's session list once the page is ready.
/// Clears the watcher fingerprint so the next poll also emits, without downloading transcripts.
/// A failed list is logged and retried with backoff. It does not emit an empty list, so pins stay.
#[tauri::command]
async fn seed_session_lists(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let cfg = load_config(&app)?;
    if demo_mode() {
        return Ok(());
    }
    {
        let mut watched = state.bot_chats.lock().unwrap_or_else(|err| err.into_inner());
        for chat in watched.values_mut() {
            chat.fingerprint.clear();
        }
    }
    for bot in cfg.bots.iter().filter(|bot| bot.enabled) {
        let pins = cfg.suborb_pins.get(&bot.profile).cloned().unwrap_or_default();
        match seed_profile(&app, &state, &bot.profile, &pins).await {
            Ok(()) => clear_seed_attempt(&state, &bot.profile),
            Err(err) => note_seed_list_failure(&app, &state, &bot.profile, &err),
        }
    }
    Ok(())
}

#[derive(Serialize)]
struct PinnedSessionFetch {
    status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    session: Option<SessionChoice>,
}

/// `GET /api/sessions/{id}` for one pin the recent list omitted (R-SO-11).
/// `gone` is HTTP 404. `archived` is a row the server marked archived.
/// Any other failure is returned so the page keeps the pin and retries.
#[tauri::command]
async fn fetch_pinned_session(
    app: AppHandle,
    state: State<'_, AppState>,
    profile: String,
    session_id: String,
) -> Result<PinnedSessionFetch, String> {
    let session_id = session_id.trim().to_string();
    if session_id.is_empty() {
        return Err("未揀對話".into());
    }
    let cfg = load_config(&app)?;
    require_hermes(&cfg)?;
    let bot = bot_or_err(&cfg, &profile)?.clone();
    let chat = chat_client(&state, &cfg);
    match chat.get_session(&bot.profile, &session_id).await {
        Ok(client::SessionGet::Missing) => Ok(PinnedSessionFetch { status: "gone".into(), session: None }),
        Ok(client::SessionGet::Found(session)) => {
            let archived = session.archived;
            Ok(PinnedSessionFetch {
                status: if archived { "archived".into() } else { "found".into() },
                session: Some(choice_of(&session)),
            })
        }
        Err(err) => Err(explain(&err)),
    }
}

/// Drop one overlay-created row. Does not rewrite `suborb_pins`.
#[tauri::command]
async fn forget_suborb_created(
    app: AppHandle,
    profile: String,
    session_id: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = config_path(&app)?;
        config::drop_suborb_created(&path, profile.trim(), session_id.trim())?;
        Ok(())
    })
    .await
    .map_err(|err| format!("讀唔到設定：{err}"))?
}

/// Orb id latched when the hit check saw Ctrl+press. The page reads this
/// from a late pointerdown; a newer key sample is not the answer.
#[tauri::command]
fn armed_press(consume: Option<bool>) -> String {
    interaction::read_armed_press(consume.unwrap_or(false))
}

/// Presented-frame clock for the plan seam. False means the page should
/// fall back to its own frame loop.
/// Page finished the opacity write. The next GTK after-paint logs
/// `opacity-present` and only then may the poll update the input shape.
#[tauri::command]
fn note_opacity_written(app: AppHandle, unix: Option<u64>, gen: Option<u64>) {
    let window = app.get_webview_window("main");
    interaction::note_opacity_written(window.as_ref(), unix.unwrap_or(0), gen.unwrap_or(0));
}

#[tauri::command]
async fn drive_presented_seam(app: AppHandle) -> bool {
    let Some(window) = app.get_webview_window("main") else {
        return false;
    };
    tauri::async_runtime::spawn_blocking(move || interaction::drive_presented_seam(window))
        .await
        .unwrap_or(false)
}

fn focus_revealed_overlay(window: &tauri::WebviewWindow) {
    #[cfg(not(windows))]
    let _ = window.set_focus();
    #[cfg(windows)]
    let _ = window;
}

#[tauri::command]
fn reveal_overlay(app: AppHandle, state: State<'_, AppState>) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    #[cfg(target_os = "linux")]
    let _ = window.set_decorations(false);
    interaction::set_window_opacity(&window, 1.0);
    let _ = window.show();
    focus_revealed_overlay(&window);
    interaction::hold_empty_input_shape();
    interaction::reapply_live_input_shape(&app, state.interaction.as_ref());
}

async fn request_stop(
    app: &AppHandle,
    state: &AppState,
    profile: &str,
    run_id: Option<String>,
) -> Result<String, String> {
    request_stream_stop(state, profile);
    let hinted = run_id.unwrap_or_default();
    let remembered = remembered_run_id(state, profile);
    let targets = hermes::stop_target_ids(&hinted, &remembered);
    if targets.is_empty() {
        return Ok("not_active".into());
    }
    let cfg = load_config(app)?;
    require_hermes(&cfg)?;
    let bot = bot_or_err(&cfg, profile)?;
    let chat = chat_client(&state, &cfg);
    let root = bot.profile.clone();
    let mut ended = String::new();
    let mut still_open = false;
    for run_id in targets {
        match chat.stop_run(&root, &run_id)
            .await
            .map_err(|_| "停止未送到。".to_string())?
        {
            hermes::StopOutcome::Stopping => return Ok("stopping".into()),
            hermes::StopOutcome::NotActive => match chat.fetch_run(&root, &run_id).await {
                Ok(value) => {
                    let status = value.get("status").and_then(|item| item.as_str()).unwrap_or("");
                    let pending = value
                        .get("pending_controls")
                        .and_then(|item| item.as_array())
                        .map(|items| !items.is_empty())
                        .unwrap_or(false);
                    if hermes::terminal_run_status(status) && !pending {
                        if ended.is_empty() {
                            ended = status.to_string();
                        }
                    } else if pending || !status.is_empty() {
                        still_open = true;
                    }
                }
                Err(_) => still_open = true,
            },
        }
    }
    if !still_open && !ended.is_empty() {
        return Ok(format!("terminal:{ended}"));
    }
    Ok("not_active".into())
}

#[tauri::command]
async fn steer_run(
    app: AppHandle,
    state: State<'_, AppState>,
    profile: String,
    run_id: String,
    text: String,
) -> Result<String, String> {
    let text = text.trim().to_string();
    let Some(run_id) = hermes::approval_run_id(&run_id).map(str::to_string) else {
        return Ok("rejected".into());
    };
    if text.is_empty() {
        return Ok("rejected".into());
    }
    let posted = async {
        let cfg = load_config(&app)?;
        require_hermes(&cfg)?;
        let bot = bot_or_err(&cfg, &profile)?;
        let chat = chat_client(&state, &cfg);
        let root = bot.profile.clone();
        chat.steer_run(&root, &run_id, &text)
            .await
            .map_err(|_| "rejected".to_string())
    }
    .await;
    match posted {
        Ok(hermes::SteerOutcome::Joined) => Ok("joined".into()),
        _ => Ok("rejected".into()),
    }
}

#[tauri::command]
async fn stop_chat(
    app: AppHandle,
    state: State<'_, AppState>,
    profile: String,
    run_id: Option<String>,
) -> Result<String, String> {
    request_stop(&app, &state, &profile, run_id).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage({
            let http = http_client();
            AppState {
            client: new_chat_client(http),
            streams: Arc::new(Mutex::new(HashMap::new())),
            run_ids: Arc::new(Mutex::new(HashMap::new())),
            queued_run_ids: Arc::new(Mutex::new(HashMap::new())),
            sessions: Arc::new(Mutex::new(HashMap::new())),
            bot_chats: Arc::new(Mutex::new(HashMap::new())),
            config_write: Arc::new(Mutex::new(())),
            command_cache: Mutex::new(HashMap::new()),
            interaction: Arc::new(interaction::InteractionHub::new()),
            seed_attempts: Arc::new(Mutex::new(HashMap::new())),
        }})
        .setup(|app| {
            if debug_log_enabled() {
                let _ = client::ws::DEBUG.set(|line| {
                    let _ = debug_log(line);
                });
            }
            {
                let handle = app.handle().clone();
                let state = app.state::<AppState>();
                state.client.set_remote_sink(Arc::new(move |profile: &str, session_id: &str, turn: client::RemoteTurn| {
                    let (kind, text) = match turn {
                        client::RemoteTurn::Start => ("remote.start", String::new()),
                        client::RemoteTurn::Delta(text) => ("remote.delta", text),
                        client::RemoteTurn::Done => ("remote.done", String::new()),
                    };
                    emit(
                        &handle,
                        serde_json::json!({
                            "type": kind,
                            "profile": profile,
                            "session_id": session_id,
                            "text": text,
                        }),
                    );
                }));
            }
            secrets::set_service(&app.config().identifier);
            if let Ok(cfg) = load_config(app.handle()) {
                let state = app.state::<AppState>();
                *state
                    .interaction
                    .config
                    .lock()
                    .unwrap_or_else(|err| err.into_inner()) = cfg.interaction;
            }
            let hub = Arc::clone(&app.state::<AppState>().interaction);
            if let Some(window) = app.get_webview_window("main") {
                // 無邊框透明視窗喺未顯示時會跳過 SW_MAXIMIZE，再加 center 就停喺 1280×800。
                interaction::place_overlay(&window);
                interaction::install_option_menu_hook(&window);
                let placed = window.clone();
                // 置頂之後約 1 秒先拒絕 CloseRequested。過咗就俾 Alt+F4 / wmctrl -c 結束。
                window.on_window_event(move |event| match event {
                    tauri::WindowEvent::CloseRequested { api, .. } => {
                        if interaction::refuse_window_close() {
                            api.prevent_close();
                        }
                    }
                    tauri::WindowEvent::Resized(size) => {
                        // Skip while iconic: recover/place must not SetWindowLongW
                        // on a minimized HWND (unrestorable at -32000,-32000).
                        if !placed.is_minimized().unwrap_or(false) {
                            interaction::recover_startup_size(&placed, size.width, size.height);
                            interaction::reposition_if_offscreen(&placed);
                        }
                    }
                    tauri::WindowEvent::ScaleFactorChanged { .. } => {
                        interaction::place_overlay(&placed);
                    }
                    _ => {}
                });
            }
            interaction::spawn_poll(app.handle().clone(), hub);
            spawn_bot_chat_watch(app.handle().clone());
            #[cfg(unix)]
            install_unix_signal_exit(app.handle().clone());
            if let Err(err) = install_escape_hatches(app.handle()) {
                eprintln!("設定捷徑：{err}");
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_settings,
            save_settings,
            set_show_bot_names,
            set_show_tool_detail,
            set_panel_size,
            set_orb_position,
            reset_orb_positions,
            set_compose_mode,
            set_suborb_mode,
            probe_gateway,
            discover_profiles,
            sync_profiles,
            set_profile_enabled,
            open_bot,
            select_session,
            send_chat,
            respond_approval,
            respond_clarify,
            load_run_controls,
            steer_run,
            stop_chat,
            list_commands,
            client_command,
            create_task_session,
            open_suborb,
            peek_session_tail,
            send_suborb,
            stop_suborb,
            set_suborb_pin,
            seed_session_lists,
            fetch_pinned_session,
            forget_suborb_created,
            get_kanban_board,
            get_kanban_boards,
            get_kanban_task,
            set_kanban_board,
            sign_in_kanban,
            patch_kanban_task,
            list_cron_jobs,
            debug_log_enabled,
            debug_log,
            fit_overlay,
            map_overlay_for_layout,
            wait_presented_frames,
            modifier_down_now,
            release_overlay_focus,
            armed_press,
            note_opacity_written,
            drive_presented_seam,
            reveal_overlay,
            set_hit_rects,
            set_interaction_latch,
            focus_owner,
            arm_pin_close_guard,
            quit_app,
            read_soul,
            write_soul,
            save_bot_meta
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::{SETTINGS_SHORTCUT, SETTINGS_TRAY_LABEL};

    #[test]
    fn listed_profiles_need_a_remote_list_and_include_local_names() {
        let hint = |name: &str| crate::config::ProfileHint {
            profile: name.into(),
            display_name: String::new(),
            detail: String::new(),
            color: String::new(),
        };
        let hints = vec![hint("writer"), hint("default"), hint("writer")];
        assert_eq!(crate::listed_profiles(false, &hints), None);
        assert_eq!(
            crate::listed_profiles(true, &hints),
            Some(vec!["default".to_string(), "writer".to_string()])
        );
        let src = include_str!("lib.rs");
        let start = src.find("async fn sync_profiles").expect("sync");
        let body = &src[start..start + 4000];
        assert!(body.contains("listed_remote |= read.listed"));
        assert!(!body.contains("listed_remote |= !local"));
    }

    #[test]
    fn quiet_sync_appends_profiles_and_does_not_write_keys_or_sessions() {
        let src = include_str!("lib.rs");
        let start = src.find("async fn sync_profiles").expect("sync");
        let rest = &src[start..];
        let end = rest.find("async fn set_profile_enabled").expect("next");
        let body = &rest[..end];
        assert!(body.contains("quiet"));
        assert!(body.contains(".probe()"));  // R-CL-01: the dashboard, not the gateway
        assert!(body.contains("apply_quiet_roster"));
        assert!(body.contains(".native_profiles()"));
        assert!(!body.contains("read_native_profiles"));
        assert!(!body.contains("password_login"));
        assert!(!body.contains("println"));
        assert!(!body.contains("eprintln"));
        assert!(!body.contains("set_profile_key"));
        assert!(!body.contains("delete_profile_key"));
        assert!(!body.contains("create_session"));
        assert!(!body.contains("create_bot_chat"));
    }

    #[test]
    fn select_session_does_not_stop_the_running_turn() {
        let src = include_str!("lib.rs");
        let start = src.find("async fn select_session").expect("select");
        let rest = &src[start..];
        let end = rest.find("async fn send_chat").expect("send");
        let body = &rest[..end];
        assert!(body.contains("open_explicit_session"));
        assert!(!body.contains("stop_run"));
        assert!(!body.contains("begin_stream"));
        assert!(!body.contains("request_stream_stop"));
        assert!(!body.contains("println"));
        assert!(!body.contains("eprintln"));
        let open = src.find("async fn open_explicit_session").expect("open");
        let open_body = &src[open..start];
        assert!(open_body.contains("fetch_counted_messages"));
        assert!(open_body.contains("chosen.message_count"));
        assert!(open_body.contains("remember_watched"));
        let watch = src[src.find("async fn watch_profile").expect("watch")..src.find("fn session_map").expect("map")].to_string();
        assert!(watch.contains("message_fetch"));
        assert!(watch.contains("fetch_message_page"));
        assert!(watch.contains("fetch_counted_messages"));
        assert!(watch.contains("watch_row_unchanged"));
        assert!(!watch.contains("existing_count"));
        assert!(watch.contains("tail_windows"));
        let plan = watch.find("message_fetch").expect("plan");
        let page = watch.find("fetch_message_page").expect("page");
        assert!(plan < page);
        assert!(open_body.contains("persist_pin"));
        assert!(open_body.contains("explicit: true"));
        assert!(!open_body.contains("store_show_bot_names"));
        assert!(!open_body.contains("store_kanban_board"));
        assert!(!open_body.contains("store_show_tool_detail"));
        assert!(!open_body.contains("store_compose_mode"));
        assert!(!open_body.contains("config::save"));
    }

    #[test]
    fn r_st_04_main_and_sub_orb_sends_probe_and_show_the_line_on_the_status() {
        let src = include_str!("lib.rs");
        let send = src.find("async fn send_chat").expect("send");
        let send_end = src.find("async fn respond_approval").expect("approval");
        let body = &src[send..send_end];
        assert_eq!(body.matches("chat.stream_turn_watched(").count(), 2);
        assert_eq!(body.matches("!side_turn && !queued,").count(), 2);
        assert!(!body.contains("hermes::stream_turn("));
        let sub = src.find("async fn send_suborb").expect("suborb");
        let sub_body = &src[sub..sub + 9000];
        assert!(sub_body.contains("chat.stream_turn_watched("));
        assert!(sub_body.contains("!side_turn && !queued,"));
        let dispatch = src.find("fn dispatch_turn").expect("dispatch");
        let arm = src[dispatch..].find("TurnEvent::QueueElsewhere(waiting)").expect("arm") + dispatch;
        let arm_body = &src[arm..arm + 420];
        assert!(arm_body.contains("\"type\": \"status\""));
        assert!(arm_body.contains("\"state\": \"busy\""));
        assert!(arm_body.contains("hermes::QUEUE_ELSEWHERE_LINE"));
        assert!(arm_body.contains("思考中…"));
    }

    #[test]
    fn a_closed_or_forked_send_is_not_called_busy() {
        let src = include_str!("lib.rs");
        let fail = src.find("fn chat_failure_line").expect("line");
        let fail_body = &src[fail..fail + 200];
        assert!(fail_body.contains("send_failure"));
        assert!(!fail_body.contains("個 bot 仲忙"));
        let send = src.find("async fn send_chat").expect("send");
        let send_end = src.find("async fn respond_approval").expect("approval");
        let body = &src[send..send_end];
        assert!(body.contains("session_send_closed"));
        assert!(body.contains("CLOSED_SESSION_LINE"));
        assert!(body.contains("note_landed_session"));
        assert!(body.contains("failure.kind"));
        assert!(body.contains("switch_session_id"));
        let note = src.find("async fn note_landed_session").expect("note");
        let note_body = &src[note..send];
        assert!(note_body.contains("landed_session_id"));
        assert!(note_body.contains("open_explicit_session"));
        assert!(note_body.contains("session.moved"));
        assert!(note_body.contains("MOVED_SESSION_LINE"));
        assert!(note_body.contains("kept_title"));
        assert!(note_body.contains("kept_replacement_title"));
        assert!(note_body.contains("hand_title_to_replacement"));
        assert!(!note_body.contains("patch_session_title"));
        assert!(!note_body.contains("（已閉）"));
        assert!(!note_body.contains("config::save"));
        let hand = src.find("async fn hand_title_to_replacement").expect("hand");
        let hand_body = &src[hand..note];
        assert!(hand_body.contains("retired_session_title"));
        assert!(hand_body.contains("patch_session_archived"));
        assert!(hand_body.contains("is_title_conflict"));
        assert_eq!(hand_body.matches("patch_session_title").count(), 4);
        assert!(!hand_body.contains("（已閉）"));
        assert!(!hand_body.contains("config::save"));
        assert!(!hand_body.contains("store_compose_mode"));
        assert!(!note_body.contains("store_compose_mode"));
        assert!(!hand_body.contains("POST /api/sessions"));
        assert!(!note_body.contains("store_show_bot_names"));
    }

    #[test]
    fn stop_and_steer_keep_the_reader_and_do_not_log() {
        let src = include_str!("lib.rs");
        let stop = src.find("async fn request_stop").expect("request_stop");
        let steer = src.find("async fn steer_run").expect("steer");
        let stop_chat = src.find("async fn stop_chat").expect("stop_chat");
        let request = &src[stop..steer];
        assert!(request.contains("request_stream_stop"));
        assert!(request.contains("stop_run"));
        assert!(request.contains("not_active"));
        assert!(!request.contains("abort.store"));
        let mark = src.find("fn request_stream_stop").expect("mark");
        let mark_end = src[mark..].find("\nfn end_stream").expect("end_stream");
        let mark_body = &src[mark..mark + mark_end];
        assert!(mark_body.contains("stop_requested.store(true"));
        assert!(!mark_body.contains("abort.store"));
        assert!(!request.contains("println"));
        assert!(!request.contains("eprintln"));
        assert!(!request.contains("config::save"));
        let steer_body = &src[steer..stop_chat];
        assert!(steer_body.contains("chat.steer_run"));
        assert!(steer_body.contains("\"joined\""));
        assert!(steer_body.contains("\"rejected\""));
        assert!(!steer_body.contains("println"));
        assert!(!steer_body.contains("eprintln"));
        assert!(!steer_body.contains("config::save"));
        let send_start = src.find("async fn send_chat").expect("send");
        let send_end = src.find("fn dispatch_turn").expect("dispatch");
        let send = &src[send_start..send_end];
        assert!(send.contains("begin_stream"));
        assert!(send.contains("!queued"));
        assert!(send.contains("stop_requested"));
        assert!(send.contains("chat_failure_line"));
        assert!(send.contains("keep_busy"));
    }

    #[test]
    fn resized_skips_place_while_minimized_and_recovers_offscreen() {
        let src = include_str!("lib.rs");
        assert!(
            src.contains("reposition_if_offscreen"),
            "restore path must re-cover a frame stuck at the minimize sentinel"
        );
        assert!(
            src.contains("is_minimized()"),
            "Resized must not recover/place while the HWND is iconic"
        );
        let interaction = include_str!("interaction.rs");
        assert!(interaction.contains("may_mutate_overlay_frame"));
        assert!(interaction.contains("is_minimize_sentinel_pos"));
        assert!(
            interaction.contains("IsIconic"),
            "cover_windows_monitor must refuse SetWindowLongW while iconic"
        );
    }

    #[test]
    fn tray_settings_label_shows_the_shortcut() {
        assert!(SETTINGS_TRAY_LABEL.starts_with("設定"));
        assert!(SETTINGS_TRAY_LABEL.contains(SETTINGS_SHORTCUT));
    }

    #[test]
    fn http_pool_drops_idle_sockets_before_hermes_serve_closes_them() {
        let src = include_str!("lib.rs");
        let start = src.find("fn http_client()").expect("http_client");
        let body = &src[start..start + 500];
        assert!(body.contains("pool_idle_timeout"));
        assert!(body.contains("from_secs(2)"));
        let board = src
            .find("async fn get_kanban_board")
            .expect("get_kanban_board");
        let task = src.find("async fn get_kanban_task").expect("get_kanban_task");
        let board_body = &src[board..task];
        assert!(board_body.contains("explain_kanban"));
        assert!(!board_body.contains("explain("));
        let after = src[task..].find("async fn patch_kanban_task").expect("patch");
        let task_body = &src[task..task + after];
        assert!(task_body.contains("explain_kanban"));
        assert!(!task_body.contains("explain("));
        // R-AR-01: reads go through the client, which stores a renewed login.
        assert!(board_body.contains(".kanban_board(&slug)"));
        assert!(!board_body.contains("state.http"));
        let slug_end = src[board..].find("fn load_kanban_secrets").expect("secrets");
        let slug_body = &src[board..board + slug_end];
        assert!(slug_body.contains("kanban_slug"));
        assert!(!slug_body.contains("\"default\""));
        assert!(!slug_body.contains("store_kanban_board"));
        assert!(!slug_body.contains("config::save"));
        assert!(task_body.contains(".kanban_task(&id)"));
        assert!(!task_body.contains("state.http"));
        let patch = src.find("async fn patch_kanban_task").expect("patch");
        let patch_end = src[patch..].find("#[derive(Serialize)]").expect("next");
        let patch_body = &src[patch..patch + patch_end];
        // R-KB-07: the move is on the dashboard through the client, on the board shown.
        assert!(patch_body.contains(".patch_kanban_task(id.trim(), &kanban_slug(board), &body)"));
        assert!(!patch_body.contains("gateway_legacy"));
        assert!(!patch_body.contains("profile_key"));
        assert!(!patch_body.contains("state.http"));
        let store = src.find("fn store_kanban_secrets").expect("store");
        let store_body = &src[store..store + 700];
        assert!(store_body.contains("KANBAN_ACCESS_ACCOUNT"));
        assert!(store_body.contains("KANBAN_REFRESH_ACCOUNT"));
        assert!(!store_body.contains("println!"));
        assert!(!store_body.contains("eprintln!"));
    }

    #[test]
    fn kanban_slug_follows_the_server_current_board() {
        assert_eq!(super::kanban_slug(None), "");
        assert_eq!(super::kanban_slug(Some("  ".into())), "");
        assert_eq!(super::kanban_slug(Some("mt4".into())), "mt4");
        assert_eq!(super::kanban_slug(Some("default".into())), "default");
        let src = include_str!("lib.rs");
        let save = src.find("fn save_settings_sync").expect("save");
        let save_end = src[save..].find("async fn probe_gateway").expect("probe");
        let save_body = &src[save..save + save_end];
        assert!(save_body.contains("kanban_board: previous.kanban_board"));
        assert!(save_body.contains("bot.compose_mode.clone()"));
        let boards = src.find("async fn get_kanban_boards").expect("boards");
        let set = src.find("async fn set_kanban_board").expect("set");
        let boards_body = &src[boards..set];
        assert!(boards_body.contains(".kanban_boards()"));
        assert!(!boards_body.contains("store_kanban_board"));
        assert!(!boards_body.contains("config::save"));
        let set_end = src[set..].find("struct KanbanPatch").expect("patch");
        let set_body = &src[set..set + set_end];
        assert!(set_body.contains("store_kanban_board"));
        assert!(!set_body.contains("read_board"));
    }

    fn invoke_commands() -> Vec<String> {
        let src = include_str!("lib.rs");
        let start = src
            .find("tauri::generate_handler![")
            .expect("invoke_handler");
        let rest = &src[start..];
        let end = rest.find("])").expect("invoke_handler end");
        rest[..end]
            .lines()
            .skip(1)
            .map(|line| line.trim().trim_end_matches(',').to_string())
            .filter(|name| !name.is_empty())
            .collect()
    }

    #[test]
    fn every_invoke_command_is_in_the_default_capability() {
        let commands = invoke_commands();
        assert!(
            commands.len() >= 12,
            "handler parse missed commands: {commands:?}"
        );
        let perms = include_str!("../permissions/hermes.toml");
        let cap: serde_json::Value =
            serde_json::from_str(include_str!("../capabilities/default.json")).expect("capability");
        let granted = cap["permissions"]
            .as_array()
            .expect("permissions")
            .iter()
            .filter_map(|item| item.as_str())
            .collect::<Vec<_>>();
        for command in &commands {
            let allow = format!("commands.allow = [\"{command}\"]");
            assert!(
                perms.contains(&allow),
                "permissions/hermes.toml 缺少 {command}"
            );
            let identifier = format!("allow-{}", command.replace('_', "-"));
            assert!(
                perms.contains(&format!("identifier = \"{identifier}\"")),
                "缺少 permission {identifier}"
            );
            assert!(
                granted.contains(&identifier.as_str()),
                "capabilities/default.json 未允許 {identifier}"
            );
        }
        assert!(
            granted.contains(&"global-shortcut:default"),
            "capabilities/default.json 未允許 global-shortcut:default"
        );
    }

    #[test]
    fn keyring_features_follow_the_target_os() {
        let cargo = include_str!("../Cargo.toml");
        assert!(cargo.contains("sync-secret-service"));
        assert!(cargo.contains("apple-native"));
        assert!(cargo.contains("windows-native"));
        assert!(
            !cargo.contains(
                "features = [\"apple-native\", \"windows-native\", \"sync-secret-service\""
            ),
            "keyring features must stay split by target_os"
        );
    }

    #[test]
    fn dev_identifier_is_separate_and_the_tray_icon_is_a_template() {
        let dev: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.dev.conf.json")).expect("dev config");
        let prod: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).expect("tauri.conf");
        assert_eq!(dev["identifier"], "com.freezemusic.hermes-overlay.dev");
        assert_eq!(prod["identifier"], "com.freezemusic.hermes-overlay");
        assert_eq!(prod["bundle"]["category"], "Utility");
        let window = &prod["app"]["windows"][0];
        assert_eq!(window["visible"], false);
        assert_eq!(window["decorations"], false);
        assert_eq!(window["transparent"], true);
        assert_eq!(window["maximized"], false);
        let windows: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.windows.conf.json"))
                .expect("tauri.windows.conf");
        let win = &windows["app"]["windows"][0];
        assert_eq!(win["visible"], true);
        assert_eq!(win["maximized"], true);
        assert_eq!(win["decorations"], false);
        assert_eq!(win["transparent"], true);
        let src = include_str!("lib.rs");
        assert!(src.contains("icons/tray.png"));
        assert!(src.contains("icon_as_template"));
        assert!(src.contains("set_service"));
        let csp = prod["app"]["security"]["csp"].as_str().unwrap_or("");
        assert!(csp.contains("font-src 'self'"));
        assert!(!csp.contains("fonts.googleapis.com"));
        assert!(!csp.contains("fonts.gstatic.com"));
    }

    #[test]
    fn session_choice_sends_source_and_archived() {
        let desktop = crate::hermes::SessionSummary {
            id: "desk".into(),
            title: "Bot Chat".into(),
            hidden: Some(false),
            last_active: 8.0,
            preview: String::new(),
            source: "desktop".into(),
            started_at: 0.0,
            message_count: None,
            delivery: false,
            parent_session_id: String::new(),
            archived: false,
            ended: false,
            end_reason: String::new(),
            session_key: String::new(),
            busy: false,
        };
        let archived = crate::hermes::SessionSummary {
            id: "old".into(),
            title: "Bot Chat".into(),
            hidden: None,
            last_active: 1.0,
            preview: String::new(),
            source: "api_server".into(),
            started_at: 0.0,
            message_count: None,
            delivery: false,
            parent_session_id: String::new(),
            archived: true,
            ended: false,
            end_reason: String::new(),
            session_key: String::new(),
            busy: false,
        };
        let rows = super::session_choices(&[desktop, archived], "missing");
        assert_eq!(rows[0].id, "missing");
        assert!(rows[0].source.is_empty());
        assert!(!rows[0].archived);
        let desk = rows.iter().find(|row| row.id == "desk").expect("desktop");
        assert_eq!(desk.source, "desktop");
        assert!(!desk.archived);
        let old = rows.iter().find(|row| row.id == "old").expect("archived");
        assert_eq!(old.source, "api_server");
        assert!(old.archived);
        let json = serde_json::to_value(desk).expect("json");
        assert_eq!(json["source"], "desktop");
        assert_eq!(json["archived"], false);
        let old_json = serde_json::to_value(old).expect("old json");
        assert_eq!(old_json["source"], "api_server");
        assert_eq!(old_json["archived"], true);
    }

    /// R-AR-04 (2026-11-03): the app makes no call to the old gateway (8642).
    /// Code outside `client/` sends nothing; gateway HTTP left in hermes.rs is
    /// `#[cfg(test)]` only; no URL is built from the retired settings keys.
    #[test]
    fn the_app_makes_no_gateway_calls() {
        fn app_code(src: &str) -> String {
            let src = src.split("#[cfg(test)]\nmod tests").next().unwrap_or("");
            let mut out = String::new();
            let mut skip_item = false;
            let mut depth: i32 = 0;
            let mut started = false;
            for line in src.lines() {
                let trimmed = line.trim_start();
                if !skip_item && trimmed.starts_with("#[cfg(test)]") {
                    skip_item = true;
                    depth = 0;
                    started = false;
                    continue;
                }
                if skip_item {
                    for ch in line.chars() {
                        if ch == '{' {
                            depth += 1;
                            started = true;
                        } else if ch == '}' {
                            depth -= 1;
                        }
                    }
                    let one_line = !started && trimmed.ends_with(';');
                    if (started && depth <= 0) || one_line {
                        skip_item = false;
                    }
                    continue;
                }
                if trimmed.starts_with("//") {
                    continue;
                }
                out.push_str(line);
                out.push('\n');
            }
            out
        }
        let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/src/");
        assert!(
            !std::path::Path::new(dir).join("gateway_legacy.rs").exists(),
            "gateway_legacy.rs is gone: nothing uses the gateway"
        );
        let outside_client = [
            ("lib.rs", include_str!("lib.rs")),
            ("hermes.rs", include_str!("hermes.rs")),
            ("config.rs", include_str!("config.rs")),
            ("secrets.rs", include_str!("secrets.rs")),
            ("sse.rs", include_str!("sse.rs")),
            ("interaction.rs", include_str!("interaction.rs")),
            ("main.rs", include_str!("main.rs")),
        ];
        for (name, src) in outside_client {
            let code = app_code(src);
            for banned in [
                ".send()",
                "http.get(",
                "http.post(",
                "http.patch(",
                "reqwest::Client::new",
                "Client::new()",
                "8642",
                "/v1/",
                "\"/health\"",
                "/health\"",
                "gateway_legacy",
                "profiles_from_gateway_health",
                "list_dashboard_profiles",
                "get_profile_key",
                "set_profile_key",
            ] {
                assert!(!code.contains(banned), "{name} app code has {banned}");
            }
        }
        // hermes.rs keeps no request builder in the app at all.
        assert!(!app_code(include_str!("hermes.rs")).contains("reqwest::Client"));
        // The retired keys are only carried through a save, never read for a URL.
        let lib = app_code(include_str!("lib.rs"));
        assert_eq!(lib.matches("legacy_gateway_base_url").count(), 2, "one field init in save");
        assert_eq!(lib.matches(".legacy_base_url").count(), 1);
        let save = lib.find("fn save_settings_sync").expect("save");
        let save_end = lib[save..].find("async fn probe_gateway").expect("probe");
        let save_body = &lib[save..save + save_end];
        assert!(save_body.contains("previous.legacy_gateway_base_url.clone()"));
        assert!(save_body.contains("bot.legacy_base_url.clone()"));
        for (name, src) in [
            ("client/mod.rs", include_str!("client/mod.rs")),
            ("client/kanban.rs", include_str!("client/kanban.rs")),
            ("client/ws.rs", include_str!("client/ws.rs")),
            ("client/turn.rs", include_str!("client/turn.rs")),
            ("client/endpoints.rs", include_str!("client/endpoints.rs")),
        ] {
            let code = app_code(src);
            assert!(!code.contains("legacy_"), "{name} reads a retired key");
            assert!(!code.contains("gateway_base_url"), "{name} reads the gateway address");
            assert!(!code.contains("base_url"), "{name} reads a per-bot address");
        }
        // The dashboard origin is the field or the config default, never the gateway.
        assert_eq!(crate::kanban::origin(""), crate::config::default_dashboard_origin());
        // Profile lists come from the client.
        let sync = lib.find("async fn sync_profiles").expect("sync");
        let sync_end = lib[sync..].find("fn listed_profiles").expect("listed");
        let sync_body = &lib[sync..sync + sync_end];
        assert!(sync_body.contains(".session_token_profiles("));
        assert!(sync_body.contains(".native_profiles()"));
    }

    #[test]
    fn settings_save_keeps_the_file_look_when_an_older_form_sends_none() {
        let older: super::SaveSettings = serde_json::from_str(r#"{"bots": []}"#).unwrap();
        assert!(older.text_size.is_none());
        assert!(older.ui_language.is_none());
        let newer: super::SaveSettings =
            serde_json::from_str(r#"{"bots": [], "text_size": "xl", "ui_language": "en"}"#).unwrap();
        assert_eq!(newer.text_size.as_deref(), Some("xl"));
        assert_eq!(newer.ui_language.as_deref(), Some("en"));
        let src = include_str!("lib.rs");
        let save = src.find("fn save_settings_sync").expect("save");
        let save_end = src[save..].find("async fn probe_gateway").expect("probe");
        let body = &src[save..save + save_end];
        assert!(body.contains("input.text_size.as_deref().unwrap_or(&previous.text_size)"));
        assert!(body.contains("input.ui_language.as_deref().unwrap_or(&previous.ui_language)"));
        assert!(body.contains("config::normalize_text_size("));
        assert!(body.contains("config::normalize_ui_language("));
    }
}
