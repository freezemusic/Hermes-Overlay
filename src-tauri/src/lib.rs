mod config;
mod hermes;
mod interaction;
mod kanban_server;
mod secrets;
mod sse;

use config::{AppConfig, BotConfig};
use hermes::{explain, route_root, HermesError, TurnEvent};
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

struct WatchedChat {
    session_id: String,
    messages: Vec<hermes::UiMessage>,
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
    http: reqwest::Client,
    streams: Arc<Mutex<HashMap<String, ProfileStreams>>>,
    run_ids: Arc<Mutex<HashMap<String, String>>>,
    sessions: Arc<Mutex<HashMap<String, SessionPin>>>,
    /// Last Bot Chat transcript seen by the cron poll. Locked only after HTTP awaits.
    bot_chats: Arc<Mutex<HashMap<String, WatchedChat>>>,
    config_write: Arc<Mutex<()>>,
    command_cache: Mutex<HashMap<String, CommandCacheEntry>>,
    interaction: Arc<interaction::InteractionHub>,
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
    config::load(&config_path(app)?)
}

#[derive(Serialize)]
struct PublicBot {
    profile: String,
    display_name: String,
    color: String,
    base_url: String,
    detail: String,
    has_key: bool,
    enabled: bool,
}

#[derive(Serialize)]
struct PublicInteraction {
    modifier: String,
    fade_enabled: bool,
    fade_distance: f64,
    min_opacity: f64,
    supported: bool,
}

#[derive(Serialize)]
struct PublicSettings {
    mode: String,
    gateway_base_url: String,
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
    base_url: String,
    #[serde(default)]
    detail: String,
    #[serde(default)]
    key: String,
    #[serde(default)]
    clear_key: bool,
    #[serde(default = "default_bot_enabled")]
    enabled: bool,
}

fn default_bot_enabled() -> bool {
    true
}

#[derive(Deserialize)]
struct SaveSettings {
    #[serde(default)]
    gateway_base_url: String,
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
    bots: Vec<SaveBot>,
}

#[derive(Deserialize)]
struct SaveInteraction {
    #[serde(default)]
    modifier: String,
    fade_enabled: Option<bool>,
    fade_distance: Option<f64>,
    min_opacity: Option<f64>,
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
    messages: Vec<hermes::UiMessage>,
    sessions: Vec<SessionChoice>,
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
}

#[derive(Serialize)]
struct DiscoveredBot {
    profile: String,
    display_name: String,
    detail: String,
    color: String,
}

fn require_hermes(cfg: &AppConfig) -> Result<(), String> {
    if cfg.mode() == "mock" {
        Err("未設定 gateway，而家係離線示範模式。".into())
    } else {
        Ok(())
    }
}

fn bot_or_err<'a>(cfg: &'a AppConfig, profile: &str) -> Result<&'a BotConfig, String> {
    cfg.bot(profile)
        .ok_or_else(|| format!("名單冇 profile「{profile}」"))
}

/// Keyring reads time out off this thread. Sync commands must not call this:
/// Tauri runs those on the GTK thread.
fn profile_key(profile: &str) -> Result<String, String> {
    match secrets::get_profile_key(profile)? {
        Lookup::Value(key) if !key.trim().is_empty() => Ok(key),
        Lookup::Value(_) | Lookup::Missing => Err(format!("profile「{profile}」未有 API 金鑰")),
    }
}

struct WatchHit {
    session_id: String,
    messages: Vec<hermes::UiMessage>,
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

async fn poll_bot_chats(app: &AppHandle) {
    let cfg = match load_config(app) {
        Ok(cfg) if cfg.mode() == "hermes" => cfg,
        _ => return,
    };
    let Some(state) = app.try_state::<AppState>() else {
        return;
    };
    let http = state.http.clone();
    let watched = Arc::clone(&state.bot_chats);
    drop(state);
    let targets: Vec<(String, String, String)> = cfg
        .bots
        .iter()
        .filter(|bot| bot.enabled)
        .filter_map(|bot| {
            let key = profile_key(&bot.profile).ok()?;
            let root = route_root(&cfg.gateway_base_url, &bot.profile, &bot.base_url);
            Some((bot.profile.clone(), root, key))
        })
        .collect();
    for (profile, root, key) in targets {
        let Ok(hit) = watch_profile(&http, &watched, &profile, &root, &key).await else {
            continue;
        };
        if hit.messages.is_empty() {
            continue;
        }
        emit(
            app,
            serde_json::json!({
                "type": "cron",
                "profile": profile,
                "session_id": hit.session_id,
                "messages": hit.messages,
            }),
        );
    }
}

async fn watch_profile(
    http: &reqwest::Client,
    watched: &Arc<Mutex<HashMap<String, WatchedChat>>>,
    profile: &str,
    root: &str,
    key: &str,
) -> Result<WatchHit, HermesError> {
    let sessions = hermes::list_sessions_for_bot_chat(http, root, key).await?;
    let Some(session_id) = hermes::canonical_bot_chat(&sessions).map(|session| session.id.clone())
    else {
        return Ok(WatchHit {
            session_id: String::new(),
            messages: Vec::new(),
        });
    };
    let messages = hermes::fetch_messages(http, root, key, &session_id).await?;
    let fresh = {
        let mut guard = watched.lock().unwrap_or_else(|err| err.into_inner());
        let fresh = match guard.get(profile) {
            Some(prev) if prev.session_id == session_id => {
                match hermes::fresh_messages(&prev.messages, &messages) {
                    Some(suffix) => suffix.to_vec(),
                    None => Vec::new(),
                }
            }
            _ => Vec::new(),
        };
        guard.insert(
            profile.to_string(),
            WatchedChat {
                session_id: session_id.clone(),
                messages,
            },
        );
        fresh
    };
    Ok(WatchHit {
        session_id,
        messages: fresh,
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
        })
        .collect();
    if !active.is_empty() && !rows.iter().any(|row| row.id == active) {
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
        for control in &slot.live {
            control.stop_requested.store(true, Ordering::Relaxed);
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
    let has_key = match secrets::get_profile_key(&profile) {
        Ok(Lookup::Value(key)) => !key.trim().is_empty(),
        _ => false,
    };
    let saved = PublicBot {
        profile: bot.profile.clone(),
        display_name: bot.display_name.clone(),
        color: bot.color.clone(),
        base_url: bot.base_url.clone(),
        detail: bot.detail.clone(),
        has_key,
        enabled: bot.enabled,
    };
    config::save(&path, &cfg)?;
    Ok(saved)
}

fn load_public_settings(app: AppHandle) -> Result<PublicSettings, String> {
    let path = config_path(&app)?;
    let needs_setup = !path.exists();
    let cfg = config::load(&path)?;
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
        let has_key = match secrets::get_profile_key(&bot.profile) {
            Ok(Lookup::Value(key)) => !key.trim().is_empty(),
            Ok(Lookup::Missing) => false,
            Err(err) => {
                keyring_error.get_or_insert(err);
                false
            }
        };
        bots.push(PublicBot {
            profile: bot.profile.clone(),
            display_name: bot.display_name.clone(),
            color: bot.color.clone(),
            base_url: bot.base_url.clone(),
            detail: bot.detail.clone(),
            has_key,
            enabled: bot.enabled,
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
        mode: cfg.mode().into(),
        kanban_server_url: kanban_server::origin(&cfg.gateway_base_url, &cfg.kanban_base_url),
        kanban_base_url: cfg.kanban_base_url,
        kanban_board: cfg.kanban_board,
        gateway_base_url: cfg.gateway_base_url,
        dashboard_base_url: cfg.dashboard_base_url,
        has_kanban_login,
        has_dashboard_token,
        keyring_error,
        interaction: PublicInteraction {
            modifier: cfg.interaction.modifier,
            fade_enabled: cfg.interaction.fade_enabled,
            fade_distance: cfg.interaction.fade_distance,
            min_opacity: cfg.interaction.min_opacity,
            supported,
        },
        bots,
        needs_setup,
        show_bot_names: cfg.show_bot_names,
        show_tool_detail: cfg.show_tool_detail,
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
    let gateway_base_url = config::normalize_http_base(&input.gateway_base_url, true)?;
    let dashboard_base_url = {
        let raw = input.dashboard_base_url.trim();
        if raw.is_empty() {
            "http://127.0.0.1:9119".to_string()
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
        let base_url = config::normalize_http_base(&bot.base_url, true)?;
        let previous_bot = previous.bot(&profile);
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
        bots.push(BotConfig {
            color: config::normalize_color(&bot.color, &profile),
            detail: bot.detail.trim().to_string(),
            profile,
            display_name,
            base_url,
            session_id,
            session_explicit,
            session_anchor,
            enabled: bot.enabled,
        });
    }

    let previous_profiles: std::collections::HashSet<_> =
        previous.bots.iter().map(|b| b.profile.as_str()).collect();
    let next_profiles: std::collections::HashSet<_> =
        bots.iter().map(|b| b.profile.as_str()).collect();
    for removed in previous_profiles.difference(&next_profiles) {
        secrets::delete_profile_key(removed)?;
    }
    for bot in &input.bots {
        let profile = bot.profile.trim();
        if bot.clear_key {
            secrets::delete_profile_key(profile)?;
        } else if !bot.key.trim().is_empty() {
            secrets::set_profile_key(profile, &bot.key)?;
        }
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
        },
        None => previous.interaction.clone(),
    };
    let cfg = AppConfig {
        version: 1,
        gateway_base_url,
        dashboard_base_url,
        kanban_base_url,
        kanban_board: previous.kanban_board,
        bots,
        interaction,
        show_bot_names: input.show_bot_names,
        show_tool_detail: input.show_tool_detail,
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
    let health = hermes::probe_health(&state.http, &cfg.gateway_base_url).await;
    let (health_ok, health_detail) = match health {
        Ok(body) => (true, if body.is_empty() { "ok".into() } else { body }),
        Err(err) => (false, explain(&err)),
    };
    let mut bots = Vec::new();
    for bot in &cfg.bots {
        let detail = match profile_key(&bot.profile) {
            Err(err) => Err(err),
            Ok(key) => {
                let root = route_root(&cfg.gateway_base_url, &bot.profile, &bot.base_url);
                hermes::probe_sessions(&state.http, &root, &key)
                    .await
                    .map(|_| "sessions API 可讀".to_string())
                    .map_err(|err| explain(&err))
            }
        };
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
    let found = hermes::list_dashboard_profiles(&state.http, &dashboard, token_ref)
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
    if initial.mode() != "hermes" {
        return load_public_settings(app);
    }
    let gateway = initial.gateway_base_url.clone();
    let dashboard = initial.dashboard_base_url.clone();
    if quiet {
        // A down gateway skips this tick. R-SY-08 owns the backoff.
        hermes::require_gateway(&state.http, &gateway)
            .await
            .map_err(|err| explain(&err))?;
    }
    // Discover outside the write lock. std::sync::MutexGuard is not Send,
    // so holding it across these awaits makes the command future unsendable.
    let mut hints = Vec::new();
    for item in hermes::profiles_from_gateway_health(&state.http, &gateway).await {
        hints.push(config::ProfileHint {
            profile: item.profile,
            display_name: item.display_name,
            detail: item.detail,
            color: item.color,
        });
    }
    let token = match secrets::get_dashboard_token() {
        Ok(Lookup::Value(value)) if !value.trim().is_empty() => Some(value),
        _ => None,
    };
    let mut saw_dashboard = false;
    if let Some(token) = token.as_deref() {
        if let Ok(found) = hermes::list_dashboard_profiles_timeout(
            &state.http,
            &dashboard,
            Some(token),
            std::time::Duration::from_secs(4),
        )
        .await
        {
            saw_dashboard = true;
            push_discovered(&mut hints, found);
        }
    }
    // Laptop has the Kanban native token, not a dashboard session token.
    // Hermes 0.22.5 gated dashboard accepts that bearer on GET /api/profiles.
    if !saw_dashboard {
        let origin = kanban_server::origin(&gateway, &initial.kanban_base_url);
        let read = kanban_server::read_native_profiles(
            &state.http,
            &origin,
            load_kanban_secrets(),
        )
        .await;
        if read.changed {
            let _ = store_kanban_secrets(&read.secrets);
        }
        push_discovered(&mut hints, read.profiles);
    }
    hints.extend(config::local_hermes_profiles(&hermes_home_dir()));

    let guard = state
        .config_write
        .lock()
        .unwrap_or_else(|err| err.into_inner());
    let path = config_path(&app)?;
    let mut cfg = config::load(&path)?;
    if cfg.mode() == "hermes" {
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
    load_public_settings(app)
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
    let key = profile_key(&profile)?;
    let root = route_root(&cfg.gateway_base_url, &bot.profile, &bot.base_url);
    if !quiet {
        emit_status(&app, &profile, "busy", "載入對話…");
    }
    let pin = load_pin(&app, &state, &profile);
    let result = async {
        let sessions = hermes::list_sessions_for_bot_chat(&state.http, &root, &key).await?;
        let resolved = hermes::session_for_startup(&sessions, &pin.id, pin.explicit, pin.anchor);
        let (session_id, explicit, anchor, source, read_only, read_only_reason, messages) =
            if let Some(resolved) = resolved {
                let messages =
                    hermes::fetch_messages(&state.http, &root, &key, &resolved.id).await?;
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
            if !quiet {
                emit_status(&app, &profile, "idle", "閒置");
            }
            Ok(OpenedChat {
                sessions: session_choices(&sessions, &session_id),
                profile,
                session_id,
                session_explicit: explicit,
                session_anchor: anchor,
                session_source: source,
                read_only,
                read_only_reason,
                messages,
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
    http: &reqwest::Client,
    sessions: &std::sync::Mutex<HashMap<String, SessionPin>>,
    config_write: &std::sync::Mutex<()>,
    profile: &str,
    root: &str,
    key: &str,
    session_id: &str,
) -> Result<OpenedChat, String> {
    let session_id = session_id.trim().to_string();
    if session_id.is_empty() {
        return Err("未揀對話".into());
    }
    let listed = hermes::list_sessions_for_bot_chat(http, root, key)
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
    let source = chosen.source.clone();
    let anchor = hermes::most_recent_session(&listed)
        .map(|session| session.last_active)
        .unwrap_or(0.0);
    let messages = hermes::fetch_messages(http, root, key, &session_id)
        .await
        .map_err(|err| explain(&err))?;
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
        messages,
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
    let key = profile_key(&profile)?;
    let root = route_root(&cfg.gateway_base_url, &bot.profile, &bot.base_url);
    open_explicit_session(
        &app,
        &state.http,
        &state.sessions,
        &state.config_write,
        &profile,
        &root,
        &key,
        &session_id,
    )
    .await
}

fn emit_session_offer(app: &AppHandle, profile: &str, switch_id: &str) {
    emit(
        app,
        serde_json::json!({
            "type": "session.offer",
            "profile": profile,
            "kind": "closed",
            "notice": hermes::CLOSED_SESSION_LINE,
            "switch_session_id": switch_id,
        }),
    );
}

/// After a turn, follow a session the server wrote instead of the one Devon picked.
/// The write is the explicit picker path (`persist_pin`), and only that profile's session fields.
async fn note_landed_session(
    app: &AppHandle,
    http: &reqwest::Client,
    sessions: &Mutex<HashMap<String, SessionPin>>,
    config_write: &Mutex<()>,
    profile: &str,
    root: &str,
    key: &str,
    posted: &str,
    reported: &str,
    known_ids: &[String],
) {
    let after = hermes::list_sessions_for_bot_chat(http, root, key)
        .await
        .unwrap_or_default();
    if let Some(next) = hermes::landed_session_id(posted, reported, known_ids, &after) {
        match open_explicit_session(
            app, http, sessions, config_write, profile, root, key, &next,
        )
        .await
        {
            Ok(opened) => {
                let mut payload = serde_json::to_value(&opened).unwrap_or(serde_json::json!({}));
                if let Some(object) = payload.as_object_mut() {
                    object.insert("type".into(), serde_json::json!("session.moved"));
                    object.insert("notice".into(), serde_json::json!(hermes::MOVED_SESSION_LINE));
                }
                emit(app, payload);
            }
            Err(_) => emit_session_offer(app, profile, &next),
        }
        return;
    }
    if after
        .iter()
        .any(|session| session.id == posted && session.ended)
    {
        emit_session_offer(app, profile, &hermes::closed_switch_id(&after, posted));
    }
}

#[tauri::command]
async fn send_chat(
    app: AppHandle,
    state: State<'_, AppState>,
    profile: String,
    text: String,
    queue: Option<bool>,
) -> Result<(), String> {
    let text = text.trim().to_string();
    if text.is_empty() {
        return Err("訊息係空".into());
    }
    let queued = queue.unwrap_or(false);
    let cfg = load_config(&app)?;
    require_hermes(&cfg)?;
    let bot = bot_or_err(&cfg, &profile)?.clone();
    let key = profile_key(&profile)?;
    let root = route_root(&cfg.gateway_base_url, &bot.profile, &bot.base_url);
    let control = begin_stream(&state, &profile, !queued);
    let stop = Arc::clone(&control.abort);
    let stop_requested = Arc::clone(&control.stop_requested);
    let generation = control.generation;
    let streams = Arc::clone(&state.streams);
    let run_ids = Arc::clone(&state.run_ids);
    let http = state.http.clone();
    let session_cache = Arc::clone(&state.sessions);
    let config_write = Arc::clone(&state.config_write);
    let pin = load_pin(&app, &state, &profile);
    let sessions = hermes::list_sessions_for_bot_chat(&http, &root, &key)
        .await
        .map_err(|err| explain(&err))?;
    let session_id = if pin.explicit && !pin.id.trim().is_empty() {
        if sessions
            .iter()
            .any(|session| session.id == pin.id && hermes::session_read_only(&session.source))
        {
            return Err(hermes::session_read_only_reason().into());
        }
        pin.id
    } else {
        let resolved = hermes::session_for_startup(&sessions, &pin.id, false, pin.anchor)
            .ok_or_else(|| "未有 Bot Chat".to_string())?;
        if resolved.read_only {
            return Err(resolved.read_only_reason);
        }
        resolved.id
    };
    if sessions
        .iter()
        .any(|session| session.id == session_id && session.ended)
    {
        return Err(hermes::CLOSED_SESSION_LINE.into());
    }
    let before_ids: Vec<String> = sessions.iter().map(|session| session.id.clone()).collect();
    let busy_label = if queued {
        "排隊中，等佢講完就會行"
    } else {
        "思考中…"
    };
    emit_status(&app, &profile, "busy", busy_label);

    tauri::async_runtime::spawn(async move {
        let mut emit_turn = |event: TurnEvent| {
            if let TurnEvent::Started { run_id } = &event {
                if let Some(id) = hermes::approval_run_id(run_id) {
                    run_ids
                        .lock()
                        .unwrap_or_else(|err| err.into_inner())
                        .insert(profile.clone(), id.to_string());
                }
            }
            let keep_busy = matches!(event, TurnEvent::Finished { .. })
                && !stream_is_current(&streams, &profile, generation);
            dispatch_turn(&app, &profile, event, keep_busy);
        };
        let run = async {
            let first = hermes::stream_turn(
                &http,
                &root,
                &key,
                &session_id,
                &text,
                &stop,
                &stop_requested,
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
                let pick = hermes::ensure_bot_chat(&http, &root, &key).await?;
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
                hermes::stream_turn(
                    &http,
                    &root,
                    &key,
                    &pick.id,
                    &text,
                    &stop,
                    &stop_requested,
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
                    &http,
                    &session_cache,
                    &config_write,
                    &profile,
                    &root,
                    &key,
                    &session_id,
                    &landed,
                    &before_ids,
                )
                .await;
            }
            Err(HermesError::Cancelled) => {
                let keep_busy = !stream_is_current(&streams, &profile, generation);
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
                    }),
                );
            }
            Err(err) => {
                if !stream_is_current(&streams, &profile, generation) {
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
                    } else {
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
    let key = profile_key(&profile)?;
    let root = route_root(&cfg.gateway_base_url, &bot.profile, &bot.base_url);
    hermes::submit_approval(
        &state.http,
        &root,
        &key,
        run_id,
        request_id,
        choice,
        execution_generation,
    )
        .await
        .map_err(|err| match err {
            HermesError::Http { status: 409, .. } => "呢個批准已經過時".into(),
            HermesError::Http { status, .. } => format!("批准未送出（{status}）。"),
            other => explain(&other),
        })
}

fn dispatch_turn(app: &AppHandle, profile: &str, event: TurnEvent, keep_busy: bool) {
    match event {
        TurnEvent::Started { run_id } => emit(
            app,
            serde_json::json!({"type": "run.started", "profile": profile, "run_id": run_id}),
        ),
        TurnEvent::ApprovalRequest {
            run_id,
            request_id,
            description,
            command,
            execution_generation,
        } => emit(
            app,
            serde_json::json!({
                "type": "approval.request",
                "profile": profile,
                "run_id": run_id,
                "request_id": request_id,
                "description": description,
                "command": command,
                "execution_generation": execution_generation,
            }),
        ),
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
            emit(app, payload);
        }
        TurnEvent::ControlSettled { kind, prompt_id } => emit(
            app,
            serde_json::json!({
                "type": format!("{kind}.settled"),
                "profile": profile,
                "prompt_id": prompt_id,
            }),
        ),
        TurnEvent::ApprovalResponded { request_id, choice } => emit(
            app,
            serde_json::json!({
                "type": "approval.responded",
                "profile": profile,
                "request_id": request_id,
                "choice": choice,
            }),
        ),
        TurnEvent::Delta(text) => emit(
            app,
            serde_json::json!({"type": "delta", "profile": profile, "text": text}),
        ),
        TurnEvent::Command(command) => emit(
            app,
            serde_json::json!({"type": "command", "profile": profile, "command": command}),
        ),
        TurnEvent::Commentary(text) => emit(
            app,
            serde_json::json!({"type": "commentary", "profile": profile, "text": text}),
        ),
        TurnEvent::Tool {
            phase,
            name,
            preview,
        } => emit(
            app,
            serde_json::json!({
                "type": "tool",
                "profile": profile,
                "phase": phase,
                "name": name,
                "preview": preview,
            }),
        ),
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
                emit(
                    app,
                    serde_json::json!({
                        "type": "status",
                        "profile": profile,
                        "state": state_name,
                        "detail": label,
                        "run_id": &run_id,
                    }),
                );
            }
            emit(
                app,
                serde_json::json!({
                    "type": "done",
                    "profile": profile,
                    "outcome": outcome,
                    "detail": detail,
                    "run_id": &run_id,
                    "keep_busy": keep_busy,
                }),
            );
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
    let key = profile_key(&profile)?;
    let root = route_root(&cfg.gateway_base_url, &bot.profile, &bot.base_url);
    let outcome = hermes::submit_clarify(
        &state.http,
        &root,
        &key,
        run_id,
        request_id,
        execution_generation,
        &answer,
    )
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
    let key = profile_key(&profile)?;
    let root = route_root(&cfg.gateway_base_url, &bot.profile, &bot.base_url);
    hermes::fetch_run(&state.http, &root, &key, run_id)
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
    let key = profile_key(&profile)?;
    let root = route_root(&cfg.gateway_base_url, &bot.profile, &bot.base_url);
    let cached = state
        .command_cache
        .lock()
        .unwrap_or_else(|err| err.into_inner())
        .get(&profile)
        .cloned();
    let etag = cached.as_ref().map(|entry| entry.etag.clone());
    let fetched = hermes::fetch_overlay_commands(&state.http, &root, &key, etag.as_deref()).await;
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

fn kanban_auth(cfg: &AppConfig) -> Result<(String, String), String> {
    require_hermes(cfg)?;
    let root = cfg
        .gateway_base_url
        .trim()
        .trim_end_matches('/')
        .to_string();
    let mut profiles = Vec::new();
    if cfg.bots.iter().any(|bot| bot.profile == "default") {
        profiles.push("default".to_string());
    }
    for bot in &cfg.bots {
        if bot.profile != "default" {
            profiles.push(bot.profile.clone());
        }
    }
    for profile in &profiles {
        if let Ok(key) = profile_key(profile) {
            return Ok((root, key));
        }
    }
    Err("未有 API 金鑰，看板開唔到。".into())
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
    if cfg.mode() == "mock" {
        return Ok(hermes::KanbanBoard {
            board: slug,
            columns: Vec::new(),
            unavailable: true,
            needs_login: false,
            message: "未設定 gateway，而家係離線示範模式。".into(),
        });
    }
    let origin = kanban_server::origin(&cfg.gateway_base_url, &cfg.kanban_base_url);
    let secrets = load_kanban_secrets();
    let (board, next, changed) =
        kanban_server::read_board(&state.http, &origin, &slug, secrets)
            .await
            .map_err(|err| kanban_server::explain_kanban(&err))?;
    if changed {
        let _ = store_kanban_secrets(&next);
    }
    Ok(board)
}

fn load_kanban_secrets() -> kanban_server::KanbanSecrets {
    let read = |account| match secrets::get_kanban_secret(account) {
        Ok(Lookup::Value(value)) => value,
        _ => String::new(),
    };
    kanban_server::KanbanSecrets {
        access_token: read(secrets::KANBAN_ACCESS_ACCOUNT),
        refresh_token: read(secrets::KANBAN_REFRESH_ACCOUNT),
        session_cookie: read(secrets::KANBAN_COOKIE_ACCOUNT),
        username: read(secrets::KANBAN_USER_ACCOUNT),
        password: read(secrets::KANBAN_PASSWORD_ACCOUNT),
    }
}

fn store_kanban_secrets(secrets: &kanban_server::KanbanSecrets) -> Result<(), String> {
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
        kanban_server::origin(&cfg.gateway_base_url, &cfg.kanban_base_url)
    } else {
        typed.clone()
    };
    if typed != cfg.kanban_base_url {
        remember_kanban_url(&app, &typed)?;
    }
    if !input.username.trim().is_empty() || !input.password.is_empty() {
        if input.username.trim().is_empty() || input.password.is_empty() {
            return Err("帳號同密碼要一齊填".into());
        }
        let cookie = kanban_server::password_login(
            &state.http,
            &origin,
            input.username.trim(),
            &input.password,
        )
        .await
        .map_err(|err| match err {
            HermesError::Http { status: 401 | 403, .. } => {
                kanban_server::note_rejected_password(input.username.trim(), &input.password);
                "帳號或密碼唔啱".into()
            }
            other => kanban_server::explain_kanban(&other),
        })?;
        let mut secrets = load_kanban_secrets();
        secrets.username = input.username.trim().to_string();
        secrets.password = input.password;
        secrets.session_cookie = cookie;
        secrets.access_token.clear();
        store_kanban_secrets(&secrets)?;
        kanban_server::clear_rejected_password();
        kanban_server::clear_rejected_refresh();
        return Ok("已登入 Kanban".into());
    }
    let tokens = kanban_server::native_pkce_login(
        &state.http,
        &origin,
        std::time::Duration::from_secs(180),
        |url| open_system_browser(url),
    )
    .await
    .map_err(|err| kanban_server::explain_kanban(&err))?;
    let mut secrets = load_kanban_secrets();
    secrets.access_token = tokens.access_token;
    secrets.refresh_token = tokens.refresh_token;
    store_kanban_secrets(&secrets)?;
    kanban_server::clear_rejected_password();
    kanban_server::clear_rejected_refresh();
    Ok("已登入 Kanban".into())
}

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

fn open_system_browser(url: &str) -> Result<(), String> {
    let result = if cfg!(target_os = "windows") {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", url])
            .spawn()
    } else if cfg!(target_os = "macos") {
        std::process::Command::new("open").arg(url).spawn()
    } else {
        std::process::Command::new("xdg-open").arg(url).spawn()
    };
    result
        .map(|_| ())
        .map_err(|_| "開唔到系統瀏覽器。可以喺設定填帳號密碼。".into())
}

#[tauri::command]
async fn get_kanban_task(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<kanban_server::KanbanTaskDetail, String> {
    let id = id.trim().to_string();
    if id.is_empty() {
        return Err("未揀卡片".into());
    }
    let cfg = load_config(&app)?;
    require_hermes(&cfg)?;
    let origin = kanban_server::origin(&cfg.gateway_base_url, &cfg.kanban_base_url);
    let secrets = load_kanban_secrets();
    let (detail, next, changed) = kanban_server::read_task(&state.http, &origin, &id, secrets)
        .await
        .map_err(|err| kanban_server::explain_kanban(&err))?;
    if changed {
        let _ = store_kanban_secrets(&next);
    }
    Ok(detail)
}

#[tauri::command]
async fn get_kanban_boards(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<kanban_server::KanbanBoardList, String> {
    let cfg = load_config(&app)?;
    if cfg.mode() == "mock" {
        return Ok(kanban_server::KanbanBoardList::default());
    }
    let origin = kanban_server::origin(&cfg.gateway_base_url, &cfg.kanban_base_url);
    let secrets = load_kanban_secrets();
    let (list, next, changed) = kanban_server::read_boards(&state.http, &origin, secrets)
        .await
        .map_err(|err| kanban_server::explain_kanban(&err))?;
    if changed {
        let _ = store_kanban_secrets(&next);
    }
    Ok(list)
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
) -> Result<hermes::KanbanTask, String> {
    let cfg = load_config(&app)?;
    let (root, key) = kanban_auth(&cfg)?;
    let body = hermes::kanban_patch_body(
        &patch.status,
        &patch.assignee,
        &patch.priority,
        &patch.title,
    );
    if body.as_object().is_some_and(|fields| fields.is_empty()) {
        return Err("看板更新係空".into());
    }
    hermes::patch_kanban_task(&state.http, &root, &key, id.trim(), &body)
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
    if cfg.mode() != "hermes" {
        return Ok(Vec::new());
    }
    let gateway = cfg.gateway_base_url.clone();
    let bots: Vec<BotConfig> = cfg.bots.iter().filter(|bot| bot.enabled).cloned().collect();
    let mut out = Vec::new();
    for bot in bots {
        let name = if bot.display_name.trim().is_empty() {
            bot.profile.clone()
        } else {
            bot.display_name.clone()
        };
        let key = match profile_key(&bot.profile) {
            Ok(key) => key,
            Err(err) => {
                out.push(CronProfileOut {
                    profile: bot.profile,
                    name,
                    jobs: Vec::new(),
                    unavailable: true,
                    message: err,
                });
                continue;
            }
        };
        let root = hermes::route_root(&gateway, &bot.profile, &bot.base_url);
        match hermes::fetch_cron_jobs(&state.http, &root, &key).await {
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
    let key = profile_key(&input.profile)?;
    let root = route_root(&cfg.gateway_base_url, &bot.profile, &bot.base_url);
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
            let sessions = hermes::list_sessions_for_bot_chat(&state.http, &root, &key)
                .await
                .map_err(|err| hermes::explain(&err))?;
            let refused_ids: Vec<&str> = input.refused.iter().map(String::as_str).collect();
            if let Some(found) = hermes::writable_continuation(&sessions, &args, &refused_ids) {
                pin_explicit(&app, &state, &input.profile, &root, &key, &found.id).await;
                return Ok(ClientCommandOut {
                    command,
                    notice: "已轉去可以傳嘢嘅對話".into(),
                    session_id: found.id.clone(),
                    options: Vec::new(),
                });
            }
            let session_id = hermes::create_session(
                &state.http,
                &root,
                &key,
                Some(hermes::OVERLAY_CONTINUE_TITLE),
            )
            .await
            .map_err(|err| match &err {
                HermesError::Http { status: 400, .. } => "開唔到新對話。".into(),
                _ => hermes::explain(&err),
            })?;
            pin_explicit(&app, &state, &input.profile, &root, &key, &session_id).await;
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
            let session_id = hermes::create_session(&state.http, &root, &key, title)
                .await
                .map_err(|err| explain(&err))?;
            pin_explicit(&app, &state, &input.profile, &root, &key, &session_id).await;
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
            let session_id = session_for_client(&app, &state, &input.profile, &root, &key).await?;
            if let Err(err) =
                hermes::patch_session_title(&state.http, &root, &key, &session_id, &args).await
            {
                if !matches!(err, HermesError::Http { status: 404, .. }) {
                    return Err(explain(&err));
                }
                let session_id =
                    replace_missing_session(&app, &state, &input.profile, &root, &key).await?;
                hermes::patch_session_title(&state.http, &root, &key, &session_id, &args)
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
            let session_id = session_for_client(&app, &state, &input.profile, &root, &key).await?;
            let forked = match hermes::fork_session(&state.http, &root, &key, &session_id, &args)
                .await
            {
                Ok(id) => id,
                Err(HermesError::Http { status: 404, .. }) => {
                    let session_id =
                        replace_missing_session(&app, &state, &input.profile, &root, &key).await?;
                    hermes::fork_session(&state.http, &root, &key, &session_id, &args)
                        .await
                        .map_err(|err| explain(&err))?
                }
                Err(err) => return Err(explain(&err)),
            };
            pin_explicit(&app, &state, &input.profile, &root, &key, &forked).await;
            Ok(ClientCommandOut {
                command,
                notice: format!("已分支做 {forked}"),
                session_id: forked,
                options: Vec::new(),
            })
        }
        "model" => {
            if input.model.trim().is_empty() && args.is_empty() {
                let options = hermes::list_model_options(&state.http, &root, &key)
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
            let session_id = session_for_client(&app, &state, &input.profile, &root, &key).await?;
            if let Err(err) = hermes::lock_session_model(
                &state.http,
                &root,
                &key,
                &session_id,
                &model,
                input.provider.trim(),
            )
            .await
            {
                if !matches!(err, HermesError::Http { status: 404, .. }) {
                    return Err(explain(&err));
                }
                let session_id =
                    replace_missing_session(&app, &state, &input.profile, &root, &key).await?;
                hermes::lock_session_model(
                    &state.http,
                    &root,
                    &key,
                    &session_id,
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
    key: &str,
) -> Result<String, String> {
    let pin = load_pin(app, state, profile);
    let sessions = hermes::list_sessions_for_bot_chat(&state.http, root, key)
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
    key: &str,
    id: &str,
) {
    let anchor = hermes::list_sessions(&state.http, root, key)
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
    key: &str,
) -> Result<String, String> {
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
    let pick = hermes::ensure_bot_chat(&state.http, root, key)
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
fn release_overlay_focus(app: AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    interaction::release_overlay_focus(&window);
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
    let key = profile_key(profile)?;
    let root = route_root(&cfg.gateway_base_url, &bot.profile, &bot.base_url);
    let mut ended = String::new();
    let mut still_open = false;
    for run_id in targets {
        match hermes::stop_run(&state.http, &root, &key, &run_id)
            .await
            .map_err(|_| "停止未送到。".to_string())?
        {
            hermes::StopOutcome::Stopping => return Ok("stopping".into()),
            hermes::StopOutcome::NotActive => match hermes::fetch_run(&state.http, &root, &key, &run_id).await {
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
        let key = profile_key(&profile)?;
        let root = route_root(&cfg.gateway_base_url, &bot.profile, &bot.base_url);
        hermes::steer_run(&state.http, &root, &key, &run_id, &text)
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
        .manage(AppState {
            http: http_client(),
            streams: Arc::new(Mutex::new(HashMap::new())),
            run_ids: Arc::new(Mutex::new(HashMap::new())),
            sessions: Arc::new(Mutex::new(HashMap::new())),
            bot_chats: Arc::new(Mutex::new(HashMap::new())),
            config_write: Arc::new(Mutex::new(())),
            command_cache: Mutex::new(HashMap::new()),
            interaction: Arc::new(interaction::InteractionHub::new()),
        })
        .setup(|app| {
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
                        interaction::recover_startup_size(&placed, size.width, size.height);
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
    fn quiet_sync_appends_profiles_and_does_not_write_keys_or_sessions() {
        let src = include_str!("lib.rs");
        let start = src.find("async fn sync_profiles").expect("sync");
        let rest = &src[start..];
        let end = rest.find("async fn set_profile_enabled").expect("next");
        let body = &rest[..end];
        assert!(body.contains("quiet"));
        assert!(body.contains("require_gateway"));
        assert!(body.contains("apply_quiet_roster"));
        assert!(body.contains("read_native_profiles"));
        assert!(body.contains("kanban_server::origin"));
        assert!(body.contains("store_kanban_secrets"));
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
        assert!(open_body.contains("fetch_messages"));
        assert!(open_body.contains("persist_pin"));
        assert!(open_body.contains("explicit: true"));
        assert!(!open_body.contains("store_show_bot_names"));
        assert!(!open_body.contains("store_kanban_board"));
        assert!(!open_body.contains("store_show_tool_detail"));
        assert!(!open_body.contains("config::save"));
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
        assert!(body.contains("session.ended"));
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
        assert!(!note_body.contains("config::save"));
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
        assert!(steer_body.contains("hermes::steer_run"));
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
        assert!(board_body.contains("if changed"));
        assert!(board_body.contains("store_kanban_secrets"));
        let slug_end = src[board..].find("fn load_kanban_secrets").expect("secrets");
        let slug_body = &src[board..board + slug_end];
        assert!(slug_body.contains("kanban_slug"));
        assert!(!slug_body.contains("\"default\""));
        assert!(!slug_body.contains("store_kanban_board"));
        assert!(!slug_body.contains("config::save"));
        assert!(task_body.contains("store_kanban_secrets"));
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
        let boards = src.find("async fn get_kanban_boards").expect("boards");
        let set = src.find("async fn set_kanban_board").expect("set");
        let boards_body = &src[boards..set];
        assert!(boards_body.contains("read_boards"));
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
}
