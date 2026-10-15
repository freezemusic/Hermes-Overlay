use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

pub const BOT_CHAT_TITLE: &str = "Bot Chat";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct BotConfig {
    pub profile: String,
    pub display_name: String,
    #[serde(default)]
    pub color: String,
    /// Dedicated API-server origin for this profile.
    /// Empty uses the shared gateway and `/p/<profile>/` (unprefixed for `default`).
    #[serde(default)]
    pub base_url: String,
    #[serde(default)]
    pub detail: String,
    /// Session this profile opens. Empty means follow the latest session on the gateway.
    #[serde(default)]
    pub session_id: String,
    /// User picked `session_id`. A newer `last_active` than `session_anchor` drops the pick.
    #[serde(default)]
    pub session_explicit: bool,
    /// Highest `last_active` seen when the current session was chosen.
    #[serde(default)]
    pub session_anchor: f64,
    /// Hidden profiles stay in the roster (and keep their key) but are not orbs.
    #[serde(default = "default_true")]
    pub enabled: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProfileHint {
    pub profile: String,
    pub display_name: String,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct InteractionConfig {
    #[serde(default = "default_modifier")]
    pub modifier: String,
    #[serde(default = "default_true")]
    pub fade_enabled: bool,
    #[serde(default = "default_fade_distance")]
    pub fade_distance: f64,
    #[serde(default = "default_min_opacity")]
    pub min_opacity: f64,
}

impl Default for InteractionConfig {
    fn default() -> Self {
        Self {
            modifier: default_modifier(),
            fade_enabled: default_true(),
            fade_distance: default_fade_distance(),
            min_opacity: default_min_opacity(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AppConfig {
    #[serde(default = "one")]
    pub version: u32,
    #[serde(default)]
    pub gateway_base_url: String,
    #[serde(default = "default_dashboard")]
    pub dashboard_base_url: String,
    #[serde(default)]
    pub bots: Vec<BotConfig>,
    #[serde(default)]
    pub interaction: InteractionConfig,
}

fn one() -> u32 {
    1
}

fn default_dashboard() -> String {
    "http://127.0.0.1:9119".into()
}

fn default_modifier() -> String {
    "ctrl".into()
}

fn default_true() -> bool {
    true
}

fn default_fade_distance() -> f64 {
    120.0
}

fn default_min_opacity() -> f64 {
    0.18
}

pub fn normalize_modifier(raw: &str) -> String {
    match raw.trim().to_ascii_lowercase().as_str() {
        "shift" => "shift".into(),
        "alt" | "option" => "alt".into(),
        _ => "ctrl".into(),
    }
}

pub fn normalize_fade_distance(value: f64) -> f64 {
    if !value.is_finite() {
        return default_fade_distance();
    }
    value.clamp(24.0, 480.0)
}

pub fn normalize_min_opacity(value: f64) -> f64 {
    if !value.is_finite() {
        return default_min_opacity();
    }
    value.clamp(0.05, 0.6)
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            version: 1,
            gateway_base_url: String::new(),
            dashboard_base_url: default_dashboard(),
            bots: Vec::new(),
            interaction: InteractionConfig::default(),
        }
    }
}

impl AppConfig {
    /// A blank gateway URL is the offline mock fallback.
    pub fn mode(&self) -> &'static str {
        if self.gateway_base_url.trim().is_empty() {
            "mock"
        } else {
            "hermes"
        }
    }

    pub fn bot(&self, profile: &str) -> Option<&BotConfig> {
        self.bots.iter().find(|b| b.profile == profile)
    }

    pub fn bot_mut(&mut self, profile: &str) -> Option<&mut BotConfig> {
        self.bots.iter_mut().find(|b| b.profile == profile)
    }
}

/// Memory wins when it names a session. Otherwise use the id stored in config.
pub fn preferred_session<'a>(memory: Option<&'a str>, stored: &'a str) -> Option<&'a str> {
    let memory = memory.map(str::trim).filter(|id| !id.is_empty());
    if let Some(id) = memory {
        return Some(id);
    }
    let stored = stored.trim();
    if stored.is_empty() {
        None
    } else {
        Some(stored)
    }
}

pub fn session_to_keep(memory: Option<&str>, previous: &str) -> String {
    preferred_session(memory, previous)
        .unwrap_or("")
        .to_string()
}

pub fn load(path: &Path) -> Result<AppConfig, String> {
    if !path.exists() {
        return Ok(AppConfig::default());
    }
    let text = fs::read_to_string(path).map_err(|e| format!("讀唔到設定：{e}"))?;
    serde_json::from_str(&text).map_err(|e| format!("設定檔格式唔啱：{e}"))
}

pub fn save(path: &Path, cfg: &AppConfig) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("開唔到設定目錄：{e}"))?;
    }
    let text = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, &text).map_err(|e| format!("寫唔到設定：{e}"))?;
    fs::rename(&tmp, path).map_err(|e| format!("寫唔到設定：{e}"))?;
    Ok(())
}

/// Hermes `default` profile stores SOUL.md at the home root.
/// Every other profile stores it at `profiles/<profile>/SOUL.md`.
pub fn soul_path(profile: &str, hermes_home: &Path) -> Result<std::path::PathBuf, String> {
    validate_profile(profile)?;
    if profile == "default" {
        Ok(hermes_home.join("SOUL.md"))
    } else {
        Ok(hermes_home.join("profiles").join(profile).join("SOUL.md"))
    }
}

pub fn validate_profile(name: &str) -> Result<(), String> {
    if name.is_empty() || name.len() > 64 {
        return Err("profile 名稱要有 1–64 個字".into());
    }
    if name == "." || name == ".." || name.contains('/') || name.contains('\\') {
        return Err("profile 名稱唔合法".into());
    }
    if !name
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
    {
        return Err(format!("profile「{name}」只可以有英數、點、底線同連字號"));
    }
    Ok(())
}

/// Origin (plus optional path prefix), no userinfo, query, or fragment.
pub fn normalize_http_base(raw: &str, allow_empty: bool) -> Result<String, String> {
    let raw = raw.trim();
    if raw.is_empty() {
        return if allow_empty {
            Ok(String::new())
        } else {
            Err("要填 gateway 位址".into())
        };
    }
    let url = reqwest::Url::parse(raw).map_err(|_| format!("位址唔合法：{raw}"))?;
    if url.scheme() != "http" && url.scheme() != "https" {
        return Err("位址只接受 http 或 https".into());
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("唔好把金鑰放喺位址入面".into());
    }
    if url.query().is_some() || url.fragment().is_some() {
        return Err("位址唔可以帶 query 或 fragment".into());
    }
    let host = url.host_str().ok_or_else(|| "位址缺少 host".to_string())?;
    let port = url.port().map(|p| format!(":{p}")).unwrap_or_default();
    let path = url.path().trim_end_matches('/');
    let path = if path.is_empty() || path == "/" {
        ""
    } else {
        path
    };
    Ok(format!("{}://{host}{port}{path}", url.scheme()))
}

/// `default` when the Hermes home has `config.yaml` or `SOUL.md`.
/// Other profiles are subdirectories of `profiles/` with a legal profile name.
pub fn local_hermes_profiles(home: &Path) -> Vec<ProfileHint> {
    let mut out = Vec::new();
    let mut seen = std::collections::HashSet::new();
    let has_default = home.join("config.yaml").is_file() || home.join("SOUL.md").is_file();
    if has_default && validate_profile("default").is_ok() && seen.insert("default".to_string()) {
        out.push(ProfileHint {
            profile: "default".into(),
            display_name: "default".into(),
            detail: String::new(),
        });
    }
    let mut names = Vec::new();
    if let Ok(entries) = fs::read_dir(home.join("profiles")) {
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
                continue;
            };
            if validate_profile(name).is_err() {
                continue;
            }
            names.push(name.to_string());
        }
    }
    names.sort();
    for name in names {
        if !seen.insert(name.clone()) {
            continue;
        }
        out.push(ProfileHint {
            profile: name.clone(),
            display_name: name,
            detail: String::new(),
        });
    }
    out
}

/// Adds unknown profiles. Existing rows keep enabled, color, base URL, session,
/// and a custom display name or detail. Does not drop rows that were not rediscovered.
pub fn merge_discovered_profiles(bots: &mut Vec<BotConfig>, found: &[ProfileHint]) {
    for hint in found {
        if validate_profile(&hint.profile).is_err() {
            continue;
        }
        if let Some(existing) = bots.iter_mut().find(|bot| bot.profile == hint.profile) {
            let name = hint.display_name.trim();
            let untitled = existing.display_name.trim().is_empty()
                || existing.display_name.trim() == existing.profile;
            if !name.is_empty() && untitled {
                existing.display_name = name.to_string();
            }
            if existing.detail.trim().is_empty() {
                existing.detail = hint.detail.trim().to_string();
            }
            continue;
        }
        let display_name = {
            let name = hint.display_name.trim();
            if name.is_empty() {
                hint.profile.clone()
            } else {
                name.to_string()
            }
        };
        bots.push(BotConfig {
            profile: hint.profile.clone(),
            display_name,
            color: color_for(&hint.profile),
            base_url: String::new(),
            detail: hint.detail.trim().to_string(),
            session_id: String::new(),
            session_explicit: false,
            session_anchor: 0.0,
            enabled: true,
        });
    }
}

pub fn set_bot_enabled(bots: &mut [BotConfig], profile: &str, enabled: bool) -> Result<(), String> {
    validate_profile(profile)?;
    let bot = bots
        .iter_mut()
        .find(|bot| bot.profile == profile)
        .ok_or_else(|| format!("名單冇 profile「{profile}」"))?;
    bot.enabled = enabled;
    Ok(())
}

pub fn color_for(name: &str) -> String {
    // Same chart colours as src/proximity.js. Not a copy of Nous artwork.
    const COLORS: [&str; 10] = [
        "#0000f2", "#00f2f2", "#00f279", "#79f200", "#f2f200", "#f27900", "#f20000", "#f20079",
        "#f200f2", "#7900f2",
    ];
    let n = name
        .bytes()
        .fold(0usize, |acc, b| acc.wrapping_add(b as usize));
    COLORS[n % COLORS.len()].to_string()
}

pub fn normalize_color(raw: &str, fallback_name: &str) -> String {
    let raw = raw.trim();
    if raw.len() == 7 && raw.starts_with('#') && raw[1..].chars().all(|c| c.is_ascii_hexdigit()) {
        return raw.to_ascii_lowercase();
    }
    color_for(fallback_name)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_gateway_is_mock() {
        assert_eq!(AppConfig::default().mode(), "mock");
        let mut cfg = AppConfig::default();
        cfg.gateway_base_url = "http://127.0.0.1:8642".into();
        assert_eq!(cfg.mode(), "hermes");
    }

    #[test]
    fn strips_trailing_slash_and_rejects_secrets_in_url() {
        assert_eq!(
            normalize_http_base("http://127.0.0.1:8642/", true).unwrap(),
            "http://127.0.0.1:8642"
        );
        assert!(normalize_http_base("http://user:secret@127.0.0.1:8642", true).is_err());
        assert!(normalize_http_base("file:///tmp/x", true).is_err());
    }

    #[test]
    fn serialized_config_has_no_key_field() {
        let cfg = AppConfig {
            bots: vec![BotConfig {
                profile: "alice".into(),
                display_name: "Alice".into(),
                color: "#5b6cff".into(),
                base_url: String::new(),
                detail: String::new(),
                session_id: String::new(),
                session_explicit: false,
                session_anchor: 0.0,
                enabled: true,
            }],
            ..AppConfig::default()
        };
        let text = serde_json::to_string(&cfg).unwrap();
        assert!(!text.contains("\"key\""));
        assert!(!text.contains("token"));
    }

    #[test]
    fn missing_interaction_uses_ctrl_and_fade() {
        let cfg: AppConfig = serde_json::from_str(r#"{"gateway_base_url":""}"#).unwrap();
        assert_eq!(cfg.interaction.modifier, "ctrl");
        assert!(cfg.interaction.fade_enabled);
        assert_eq!(cfg.interaction.fade_distance, 120.0);
        assert_eq!(cfg.interaction.min_opacity, 0.18);
        assert_eq!(normalize_modifier("ALT"), "alt");
        assert_eq!(normalize_fade_distance(8.0), 24.0);
        assert_eq!(normalize_min_opacity(0.9), 0.6);
    }

    #[test]
    fn soul_file_follows_the_hermes_profile_layout() {
        let root = Path::new("/tmp/hermes-home");
        assert_eq!(soul_path("default", root).unwrap(), root.join("SOUL.md"));
        assert_eq!(
            soul_path("planner", root).unwrap(),
            root.join("profiles").join("planner").join("SOUL.md")
        );
        assert!(soul_path("../x", root).is_err());
        assert!(soul_path("has space", root).is_err());
    }

    #[test]
    fn session_id_survives_restart_and_falls_back_when_blank() {
        let cfg: AppConfig =
            serde_json::from_str(r#"{"bots":[{"profile":"alice","display_name":"Alice"}]}"#)
                .unwrap();
        assert_eq!(cfg.bots[0].session_id, "");
        assert!(!cfg.bots[0].session_explicit);
        assert_eq!(cfg.bots[0].session_anchor, 0.0);
        assert!(cfg.bots[0].enabled);
        assert_eq!(preferred_session(None, ""), None);
        assert_eq!(preferred_session(Some("  "), "stored"), Some("stored"));
        assert_eq!(preferred_session(Some("memory"), "stored"), Some("memory"));
        assert_eq!(session_to_keep(None, "stored"), "stored");
        assert_eq!(session_to_keep(Some(""), "stored"), "stored");

        let mut cfg = cfg;
        cfg.bot_mut("alice").unwrap().session_id = "sess_9".into();
        let text = serde_json::to_string(&cfg).unwrap();
        let again: AppConfig = serde_json::from_str(&text).unwrap();
        assert_eq!(again.bot("alice").unwrap().session_id, "sess_9");
        assert_eq!(
            session_to_keep(Some("sess_live"), &again.bot("alice").unwrap().session_id),
            "sess_live"
        );
    }

    #[test]
    fn local_layout_lists_default_and_profile_dirs() {
        let root =
            std::env::temp_dir().join(format!("hermes-overlay-discover-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("profiles").join("planner")).unwrap();
        fs::create_dir_all(root.join("profiles").join("bad name")).unwrap();
        fs::write(root.join("config.yaml"), "model: x").unwrap();
        fs::write(root.join("profiles").join("notes.txt"), "x").unwrap();
        let found = local_hermes_profiles(&root);
        let names: Vec<_> = found.iter().map(|hint| hint.profile.as_str()).collect();
        assert_eq!(names, vec!["default", "planner"]);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn merge_keeps_hidden_rows_and_adds_new_profiles_without_keys() {
        let mut bots = vec![
            BotConfig {
                profile: "planner".into(),
                display_name: "我的計劃".into(),
                color: "#00f2f2".into(),
                base_url: "http://127.0.0.1:9000".into(),
                detail: "自訂".into(),
                session_id: "sess".into(),
                session_explicit: true,
                session_anchor: 40.0,
                enabled: false,
            },
            BotConfig {
                profile: "remote".into(),
                display_name: "remote".into(),
                color: "#f20000".into(),
                base_url: String::new(),
                detail: String::new(),
                session_id: String::new(),
                session_explicit: false,
                session_anchor: 0.0,
                enabled: true,
            },
        ];
        merge_discovered_profiles(
            &mut bots,
            &[
                ProfileHint {
                    profile: "planner".into(),
                    display_name: "Planner".into(),
                    detail: "新".into(),
                },
                ProfileHint {
                    profile: "coder".into(),
                    display_name: "碼".into(),
                    detail: String::new(),
                },
                ProfileHint {
                    profile: "bad name".into(),
                    display_name: "nope".into(),
                    detail: String::new(),
                },
            ],
        );
        assert_eq!(bots.len(), 3);
        assert!(!bots[0].enabled);
        assert_eq!(bots[0].display_name, "我的計劃");
        assert_eq!(bots[0].detail, "自訂");
        assert_eq!(bots[0].color, "#00f2f2");
        assert_eq!(bots[0].session_id, "sess");
        assert_eq!(bots[1].profile, "remote");
        assert_eq!(bots[2].profile, "coder");
        assert!(bots[2].enabled);
        assert_eq!(bots[2].display_name, "碼");
        assert!(bots[2].base_url.is_empty());
        let text = serde_json::to_string(&bots[2]).unwrap();
        assert!(!text.contains("key"));
        set_bot_enabled(&mut bots, "coder", false).unwrap();
        assert!(!bots[2].enabled);
        assert!(set_bot_enabled(&mut bots, "missing", false).is_err());
    }
}
