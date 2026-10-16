mod config;
mod hermes;
mod interaction;
mod secrets;
mod sse;

use config::{AppConfig, BotConfig};
use hermes::{explain, route_root, HermesError, TurnEvent};
use secrets::Lookup;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
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

struct AppState {
    http: reqwest::Client,
    stops: Mutex<HashMap<String, Arc<AtomicBool>>>,
    sessions: Arc<Mutex<HashMap<String, SessionPin>>>,
    /// Last Bot Chat transcript seen by the cron poll. Locked only after HTTP awaits.
    bot_chats: Arc<Mutex<HashMap<String, WatchedChat>>>,
    config_write: Arc<Mutex<()>>,
    command_cache: Mutex<HashMap<String, CommandCacheEntry>>,
    interaction: Arc<interaction::InteractionHub>,
}

fn http_client() -> reqwest::Client {
    reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(10))
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
    has_dashboard_token: bool,
    keyring_error: Option<String>,
    interaction: PublicInteraction,
    bots: Vec<PublicBot>,
    needs_setup: bool,
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
    dashboard_token: String,
    #[serde(default)]
    clear_dashboard_token: bool,
    #[serde(default)]
    interaction: Option<SaveInteraction>,
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
    let sessions = hermes::list_sessions(http, root, key).await?;
    let session_id = if let Some(session) = hermes::most_recent_bot_chat(&sessions) {
        session.id.clone()
    } else {
        match hermes::create_bot_chat(http, root, key).await {
            Ok(id) => id,
            Err(_) => {
                return Ok(WatchHit {
                    session_id: String::new(),
                    messages: Vec::new(),
                })
            }
        }
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
    let id = pin.id.trim().to_string();
    let pin = SessionPin {
        explicit: pin.explicit && !id.is_empty(),
        anchor: if id.is_empty() { 0.0 } else { pin.anchor },
        id,
    };
    {
        let mut map = sessions.lock().unwrap_or_else(|err| err.into_inner());
        if pin.id.is_empty() {
            map.remove(profile);
        } else {
            map.insert(profile.to_string(), pin.clone());
        }
    }
    let Ok(path) = config_path(app) else {
        return;
    };
    let Ok(mut cfg) = config::load(&path) else {
        return;
    };
    let Some(bot) = cfg.bot_mut(profile) else {
        return;
    };
    if bot.session_id == pin.id
        && bot.session_explicit == pin.explicit
        && bot.session_anchor == pin.anchor
    {
        return;
    }
    bot.session_id = pin.id;
    bot.session_explicit = pin.explicit;
    bot.session_anchor = pin.anchor;
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
            },
        );
    }
    rows
}

fn replace_stop(state: &AppState, profile: &str) -> Arc<AtomicBool> {
    let flag = Arc::new(AtomicBool::new(false));
    let mut map = state.stops.lock().unwrap_or_else(|err| err.into_inner());
    if let Some(previous) = map.insert(profile.to_string(), flag.clone()) {
        previous.store(true, Ordering::Relaxed);
    }
    flag
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
        gateway_base_url: cfg.gateway_base_url,
        dashboard_base_url: cfg.dashboard_base_url,
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
        let session_anchor = pin
            .map(|pin| pin.anchor)
            .unwrap_or_else(|| previous_bot.map(|bot| bot.session_anchor).unwrap_or(0.0));
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
            min_opacity: config::normalize_min_opacity(raw.min_opacity.unwrap_or(0.18)),
        },
        None => previous.interaction.clone(),
    };
    let cfg = AppConfig {
        version: 1,
        gateway_base_url,
        dashboard_base_url,
        bots,
        interaction,
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

#[tauri::command]
async fn sync_profiles(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<PublicSettings, String> {
    let initial = load_config(&app)?;
    if initial.mode() != "hermes" {
        return load_public_settings(app);
    }
    let gateway = initial.gateway_base_url.clone();
    let dashboard = initial.dashboard_base_url.clone();
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
    if let Some(token) = token.as_deref() {
        if let Ok(found) = hermes::list_dashboard_profiles_timeout(
            &state.http,
            &dashboard,
            Some(token),
            std::time::Duration::from_secs(4),
        )
        .await
        {
            for item in found {
                hints.push(config::ProfileHint {
                    profile: item.profile,
                    display_name: item.display_name,
                    detail: item.detail,
                    color: item.color,
                });
            }
        }
    }
    hints.extend(config::local_hermes_profiles(&hermes_home_dir()));

    let guard = state
        .config_write
        .lock()
        .unwrap_or_else(|err| err.into_inner());
    let path = config_path(&app)?;
    let mut cfg = config::load(&path)?;
    if cfg.mode() == "hermes" {
        let before = cfg.bots.clone();
        config::merge_discovered_profiles(&mut cfg.bots, &hints);
        if cfg.bots != before {
            config::save(&path, &cfg)?;
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
) -> Result<OpenedChat, String> {
    let cfg = load_config(&app)?;
    require_hermes(&cfg)?;
    let bot = bot_or_err(&cfg, &profile)?;
    let key = profile_key(&profile)?;
    let root = route_root(&cfg.gateway_base_url, &bot.profile, &bot.base_url);
    emit_status(&app, &profile, "busy", "載入對話…");
    let pin = load_pin(&app, &state, &profile);
    let result = async {
        let mut sessions = hermes::list_sessions(&state.http, &root, &key).await?;
        let resolved = hermes::resolve_session(&sessions, &pin.id, pin.explicit, pin.anchor);
        let has_bot_chat = sessions
            .iter()
            .any(|session| hermes::is_bot_chat_title(&session.title));
        let (session_id, explicit, anchor) = if let Some(resolved) = resolved {
            if resolved.explicit || has_bot_chat {
                (resolved.id, resolved.explicit, resolved.anchor)
            } else {
                match hermes::create_bot_chat(&state.http, &root, &key).await {
                    Ok(id) => {
                        if let Ok(fresh) = hermes::list_sessions(&state.http, &root, &key).await {
                            sessions = fresh;
                        }
                        (id, false, 0.0)
                    }
                    Err(_) => (resolved.id, false, resolved.anchor),
                }
            }
        } else {
            let id = hermes::create_bot_chat(&state.http, &root, &key).await?;
            if let Ok(fresh) = hermes::list_sessions(&state.http, &root, &key).await {
                sessions = fresh;
            }
            (id, false, 0.0)
        };
        let messages = hermes::fetch_messages(&state.http, &root, &key, &session_id).await?;
        Ok::<_, HermesError>((session_id, explicit, anchor, messages, sessions))
    }
    .await;
    match result {
        Ok((session_id, explicit, anchor, messages, sessions)) => {
            remember_pin(
                &app,
                &state,
                &profile,
                SessionPin {
                    id: session_id.clone(),
                    explicit,
                    anchor,
                },
            );
            emit_status(&app, &profile, "idle", "閒置");
            Ok(OpenedChat {
                sessions: session_choices(&sessions, &session_id),
                profile,
                session_id,
                session_explicit: explicit,
                session_anchor: anchor,
                messages,
            })
        }
        Err(err) => {
            let message = explain(&err);
            emit_status(&app, &profile, "error", &message);
            Err(message)
        }
    }
}

#[tauri::command]
async fn select_session(
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
    let bot = bot_or_err(&cfg, &profile)?;
    let key = profile_key(&profile)?;
    let root = route_root(&cfg.gateway_base_url, &bot.profile, &bot.base_url);
    let sessions = hermes::list_sessions(&state.http, &root, &key)
        .await
        .map_err(|err| explain(&err))?;
    if !sessions.iter().any(|session| session.id == session_id) {
        return Err("搵唔到呢個對話".into());
    }
    let anchor = hermes::most_recent_session(&sessions)
        .map(|session| session.last_active)
        .unwrap_or(0.0);
    let messages = hermes::fetch_messages(&state.http, &root, &key, &session_id)
        .await
        .map_err(|err| explain(&err))?;
    remember_pin(
        &app,
        &state,
        &profile,
        SessionPin {
            id: session_id.clone(),
            explicit: true,
            anchor,
        },
    );
    Ok(OpenedChat {
        sessions: session_choices(&sessions, &session_id),
        profile,
        session_id,
        session_explicit: true,
        session_anchor: anchor,
        messages,
    })
}

#[tauri::command]
async fn send_chat(
    app: AppHandle,
    state: State<'_, AppState>,
    profile: String,
    text: String,
) -> Result<(), String> {
    let text = text.trim().to_string();
    if text.is_empty() {
        return Err("訊息係空".into());
    }
    let cfg = load_config(&app)?;
    require_hermes(&cfg)?;
    let bot = bot_or_err(&cfg, &profile)?.clone();
    let key = profile_key(&profile)?;
    let root = route_root(&cfg.gateway_base_url, &bot.profile, &bot.base_url);
    let stop = replace_stop(&state, &profile);
    let http = state.http.clone();
    let session_cache = Arc::clone(&state.sessions);
    let config_write = Arc::clone(&state.config_write);
    let pin = load_pin(&app, &state, &profile);
    let cached = if pin.explicit && !pin.id.trim().is_empty() {
        Some(pin.id)
    } else {
        None
    };
    emit_status(&app, &profile, "busy", "思考中…");

    tauri::async_runtime::spawn(async move {
        let run = async {
            let mut session_id = if let Some(id) = cached {
                id
            } else {
                let id = hermes::ensure_bot_chat(&http, &root, &key).await?;
                persist_pin(
                    &app,
                    &session_cache,
                    &config_write,
                    &profile,
                    SessionPin {
                        id: id.clone(),
                        explicit: false,
                        anchor: 0.0,
                    },
                );
                id
            };
            let first =
                hermes::stream_turn(&http, &root, &key, &session_id, &text, &stop, |event| {
                    dispatch_turn(&app, &profile, event)
                })
                .await;
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
                session_id = hermes::ensure_bot_chat(&http, &root, &key).await?;
                persist_pin(
                    &app,
                    &session_cache,
                    &config_write,
                    &profile,
                    SessionPin {
                        id: session_id.clone(),
                        explicit: false,
                        anchor: 0.0,
                    },
                );
                hermes::stream_turn(&http, &root, &key, &session_id, &text, &stop, |event| {
                    dispatch_turn(&app, &profile, event)
                })
                .await
            } else {
                first
            }
        };
        match run.await {
            Ok(()) => {}
            Err(HermesError::Cancelled) => {
                emit_status(&app, &profile, "idle", "已停止");
                emit(
                    &app,
                    serde_json::json!({
                        "type": "done",
                        "profile": profile,
                        "outcome": "cancelled",
                        "detail": "已停止呢次回覆。",
                    }),
                );
            }
            Err(err) => {
                let message = explain(&err);
                emit_status(&app, &profile, "error", &message);
                emit(
                    &app,
                    serde_json::json!({
                        "type": "error",
                        "profile": profile,
                        "message": message,
                    }),
                );
            }
        }
    });
    Ok(())
}

fn dispatch_turn(app: &AppHandle, profile: &str, event: TurnEvent) {
    match event {
        TurnEvent::Started => emit(
            app,
            serde_json::json!({"type": "run.started", "profile": profile}),
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
        TurnEvent::Finished { outcome, detail } => {
            let state_name = if outcome == "failed" { "error" } else { "idle" };
            let label = match outcome.as_str() {
                "failed" => "回覆失敗",
                "cancelled" => "已停止",
                _ => "閒置",
            };
            emit_status(app, profile, state_name, label);
            emit(
                app,
                serde_json::json!({
                    "type": "done",
                    "profile": profile,
                    "outcome": outcome,
                    "detail": detail,
                }),
            );
        }
    }
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

#[tauri::command]
fn set_hit_rects(state: State<'_, AppState>, rects: Vec<HitRectIn>) -> Result<(), String> {
    let mapped = rects
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
    *state
        .interaction
        .rects
        .lock()
        .unwrap_or_else(|err| err.into_inner()) = mapped;
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

#[tauri::command]
async fn get_kanban_board(
    app: AppHandle,
    state: State<'_, AppState>,
    board: Option<String>,
) -> Result<hermes::KanbanBoard, String> {
    let cfg = load_config(&app)?;
    let slug = board.unwrap_or_else(|| "default".into());
    let slug = if slug.trim().is_empty() {
        "default".to_string()
    } else {
        slug
    };
    if cfg.mode() == "mock" {
        return Ok(hermes::KanbanBoard {
            board: slug,
            columns: Vec::new(),
            unavailable: true,
            message: "未設定 gateway，而家係離線示範模式。".into(),
        });
    }
    let (root, key) = kanban_auth(&cfg)?;
    hermes::fetch_kanban_board(&state.http, &root, &key, &slug)
        .await
        .map_err(|err| explain(&err))
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
    let bots: Vec<BotConfig> = cfg
        .bots
        .iter()
        .filter(|bot| bot.enabled)
        .cloned()
        .collect();
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
            if let Some(flag) = state
                .stops
                .lock()
                .unwrap_or_else(|err| err.into_inner())
                .get(&input.profile)
            {
                flag.store(true, Ordering::Relaxed);
            }
            Ok(ClientCommandOut {
                command,
                notice: "已停止呢次回覆。".into(),
                session_id: cached_session(&state, &input.profile).unwrap_or_default(),
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
    if pin.explicit && !pin.id.trim().is_empty() {
        return Ok(pin.id);
    }
    let id = hermes::ensure_bot_chat(&state.http, root, key)
        .await
        .map_err(|err| explain(&err))?;
    remember_pin(
        app,
        state,
        profile,
        SessionPin {
            id: id.clone(),
            explicit: false,
            anchor: 0.0,
        },
    );
    Ok(id)
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
    let id = hermes::ensure_bot_chat(&state.http, root, key)
        .await
        .map_err(|err| explain(&err))?;
    remember_pin(
        app,
        state,
        profile,
        SessionPin {
            id: id.clone(),
            explicit: false,
            anchor: 0.0,
        },
    );
    Ok(id)
}

#[tauri::command]
fn stop_chat(state: State<'_, AppState>, profile: String) -> Result<(), String> {
    if let Some(flag) = state
        .stops
        .lock()
        .unwrap_or_else(|err| err.into_inner())
        .get(&profile)
    {
        flag.store(true, Ordering::Relaxed);
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(AppState {
            http: http_client(),
            stops: Mutex::new(HashMap::new()),
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
            probe_gateway,
            discover_profiles,
            sync_profiles,
            set_profile_enabled,
            open_bot,
            select_session,
            send_chat,
            stop_chat,
            list_commands,
            client_command,
            get_kanban_board,
            patch_kanban_task,
            list_cron_jobs,
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
    fn tray_settings_label_shows_the_shortcut() {
        assert!(SETTINGS_TRAY_LABEL.starts_with("設定"));
        assert!(SETTINGS_TRAY_LABEL.contains(SETTINGS_SHORTCUT));
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
        let src = include_str!("lib.rs");
        assert!(src.contains("icons/tray.png"));
        assert!(src.contains("icon_as_template"));
        assert!(src.contains("set_service"));
        let csp = prod["app"]["security"]["csp"].as_str().unwrap_or("");
        assert!(csp.contains("font-src 'self'"));
        assert!(!csp.contains("fonts.googleapis.com"));
        assert!(!csp.contains("fonts.gstatic.com"));
    }
}
