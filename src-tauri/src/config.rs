use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

pub const BOT_CHAT_TITLE: &str = "Bot Chat";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
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
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AppConfig {
    #[serde(default = "one")]
    pub version: u32,
    #[serde(default)]
    pub gateway_base_url: String,
    #[serde(default = "default_dashboard")]
    pub dashboard_base_url: String,
    #[serde(default)]
    pub bots: Vec<BotConfig>,
}

fn one() -> u32 {
    1
}

fn default_dashboard() -> String {
    "http://127.0.0.1:9119".into()
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            version: 1,
            gateway_base_url: String::new(),
            dashboard_base_url: default_dashboard(),
            bots: Vec::new(),
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
        return Err(format!(
            "profile「{name}」只可以有英數、點、底線同連字號"
        ));
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
    let path = if path.is_empty() || path == "/" { "" } else { path };
    Ok(format!("{}://{host}{port}{path}", url.scheme()))
}

pub fn color_for(name: &str) -> String {
    const COLORS: [&str; 10] = [
        "#5b6cff", "#2dd4bf", "#f59e0b", "#f472b6", "#94a3b8", "#a78bfa", "#34d399",
        "#fb7185", "#38bdf8", "#facc15",
    ];
    let n = name
        .bytes()
        .fold(0usize, |acc, b| acc.wrapping_add(b as usize));
    COLORS[n % COLORS.len()].to_string()
}

pub fn normalize_color(raw: &str, fallback_name: &str) -> String {
    let raw = raw.trim();
    if raw.len() == 7
        && raw.starts_with('#')
        && raw[1..].chars().all(|c| c.is_ascii_hexdigit())
    {
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
            }],
            ..AppConfig::default()
        };
        let text = serde_json::to_string(&cfg).unwrap();
        assert!(!text.contains("\"key\""));
        assert!(!text.contains("token"));
    }
}
