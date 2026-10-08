mod config;
mod hermes;
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

struct AppState {
    http: reqwest::Client,
    stops: Mutex<HashMap<String, Arc<AtomicBool>>>,
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
}

#[derive(Serialize)]
struct PublicSettings {
    mode: String,
    gateway_base_url: String,
    dashboard_base_url: String,
    has_dashboard_token: bool,
    keyring_error: Option<String>,
    bots: Vec<PublicBot>,
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
    bots: Vec<SaveBot>,
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
    messages: Vec<hermes::UiMessage>,
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

fn profile_key(profile: &str) -> Result<String, String> {
    match secrets::get_profile_key(profile)? {
        Lookup::Value(key) if !key.trim().is_empty() => Ok(key),
        Lookup::Value(_) | Lookup::Missing => {
            Err(format!("profile「{profile}」未有 API 金鑰"))
        }
    }
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

#[tauri::command]
fn get_settings(app: AppHandle) -> Result<PublicSettings, String> {
    let cfg = load_config(&app)?;
    let mut keyring_error = None;
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
    Ok(PublicSettings {
        mode: cfg.mode().into(),
        gateway_base_url: cfg.gateway_base_url,
        dashboard_base_url: cfg.dashboard_base_url,
        has_dashboard_token,
        keyring_error,
        bots,
    })
}

#[tauri::command]
fn save_settings(app: AppHandle, input: SaveSettings) -> Result<PublicSettings, String> {
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
        bots.push(BotConfig {
            color: config::normalize_color(&bot.color, &profile),
            detail: bot.detail.trim().to_string(),
            profile,
            display_name,
            base_url,
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

    let cfg = AppConfig {
        version: 1,
        gateway_base_url,
        dashboard_base_url,
        bots,
    };
    config::save(&config_path(&app)?, &cfg)?;
    get_settings(app)
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
                "Dashboard 拒絕存取。Loopback 通常唔使 token；否則請貼 window.__HERMES_SESSION_TOKEN__。呢個端點係實驗性質。".into()
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
                color: config::color_for(&item.profile),
                profile: item.profile,
                display_name: item.display_name,
                detail: item.detail,
            })
        })
        .collect())
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
    let result = async {
        let session_id = hermes::ensure_bot_chat(&state.http, &root, &key).await?;
        let messages = hermes::fetch_messages(&state.http, &root, &key, &session_id).await?;
        Ok::<_, HermesError>((session_id, messages))
    }
    .await;
    match result {
        Ok((session_id, messages)) => {
            emit_status(&app, &profile, "idle", "閒置");
            Ok(OpenedChat {
                profile,
                session_id,
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
    emit_status(&app, &profile, "busy", "思考中…");

    tauri::async_runtime::spawn(async move {
        let run = async {
            let session_id = hermes::ensure_bot_chat(&http, &root, &key).await?;
            hermes::stream_turn(&http, &root, &key, &session_id, &text, &stop, |event| {
                dispatch_turn(&app, &profile, event)
            })
            .await
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
        TurnEvent::Delta(text) => emit(
            app,
            serde_json::json!({"type": "delta", "profile": profile, "text": text}),
        ),
        TurnEvent::Commentary(text) => emit(
            app,
            serde_json::json!({"type": "commentary", "profile": profile, "text": text}),
        ),
        TurnEvent::Tool { phase, name, preview } => emit(
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
                "failed" => detail.as_str(),
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
        .manage(AppState {
            http: http_client(),
            stops: Mutex::new(HashMap::new()),
        })
        .invoke_handler(tauri::generate_handler![
            get_settings,
            save_settings,
            probe_gateway,
            discover_profiles,
            open_bot,
            send_chat,
            stop_chat
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
