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
    /// Last session id written for this profile. Main-orb open ignores it.
    #[serde(default)]
    pub session_id: String,
    /// User picked `session_id` for the panel that is open.
    /// Startup and the next main-orb open still use Bot Chat.
    #[serde(default)]
    pub session_explicit: bool,
    /// Highest `last_active` seen when the current session was chosen.
    #[serde(default)]
    pub session_anchor: f64,
    /// Hidden profiles stay in the roster (and keep their key) but are not orbs.
    #[serde(default = "default_true")]
    pub enabled: bool,
    /// R-MD-07. Composer Plan Mode for this profile.
    /// Omitted while off so an untouched bot object stays byte-identical.
    #[serde(default, skip_serializing_if = "skip_false")]
    pub plan_mode: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProfileHint {
    pub profile: String,
    pub display_name: String,
    pub detail: String,
    /// Raw Hermes color (`#rgb`, `#rrggbb`, `hsl(...)`, `rgb(...)`) or empty.
    pub color: String,
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
    /// Empty means the gateway host on port 9119. Not a secret.
    #[serde(default)]
    pub kanban_base_url: String,
    /// Empty follows the server's current kanban board.
    /// Written only after an explicit pick. Omitted while empty so an
    /// untouched config.json stays byte-identical.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub kanban_board: String,
    #[serde(default)]
    pub bots: Vec<BotConfig>,
    #[serde(default)]
    pub interaction: InteractionConfig,
    /// R-OB-06. Omitted while off so an unchanged file stays byte-identical.
    #[serde(default, skip_serializing_if = "skip_false")]
    pub show_bot_names: bool,
    /// R-MD-06. Omitted while off so an unchanged file stays byte-identical.
    /// Per-run expand flags are not stored here.
    #[serde(default, skip_serializing_if = "skip_false")]
    pub show_tool_detail: bool,
}

fn skip_false(value: &bool) -> bool {
    !*value
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
    0.25
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
            kanban_base_url: String::new(),
            kanban_board: String::new(),
            bots: Vec::new(),
            interaction: InteractionConfig::default(),
            show_bot_names: false,
            show_tool_detail: false,
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
    let mut text = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?;
    text = omit_absent_unchanged_keys(path, cfg, &text);
    write_config_text(path, &text)
}

/// A full settings save rewrites the file. Keys the user did not change,
/// and that were not already in the file, stay omitted. An empty
/// `kanban_base_url` is the default, so a file that never had the key
/// must not gain `"kanban_base_url": ""`.
fn omit_absent_unchanged_keys(path: &Path, cfg: &AppConfig, text: &str) -> String {
    if !cfg.kanban_base_url.is_empty() {
        return text.to_string();
    }
    let previous = fs::read_to_string(path).unwrap_or_default();
    if top_level_field(&previous, "kanban_base_url").is_some() {
        return text.to_string();
    }
    let Some(span) = top_level_field(text, "kanban_base_url") else {
        return text.to_string();
    };
    remove_top_level_field(text, &span)
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
            color: profile_yaml_color(&home.join("profile.yaml")),
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
            if name.starts_with('.') || validate_profile(name).is_err() {
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
            display_name: name.clone(),
            detail: String::new(),
            color: profile_yaml_color(&home.join("profiles").join(&name).join("profile.yaml")),
        });
    }
    out
}

/// Adds unknown profiles. A parsed Hermes color replaces the stored swatch.
/// Otherwise existing rows keep enabled, color, base URL, session, and a custom
/// display name or detail. Does not drop rows that were not rediscovered.
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
            if let Some(color) = parse_hermes_color(&hint.color) {
                existing.color = color;
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
            color: parse_hermes_color(&hint.color).unwrap_or_else(|| color_for(&hint.profile)),
            base_url: String::new(),
            detail: hint.detail.trim().to_string(),
            session_id: String::new(),
            session_explicit: false,
            session_anchor: 0.0,
            enabled: true,
            plan_mode: false,
        });
    }
}

/// Appends profiles that are not already in the roster.
/// Existing rows keep session id, enabled, colour, order, name, and detail.
/// A profile missing from `found` stays. Returns true when a row was added.
pub fn append_new_profiles(bots: &mut Vec<BotConfig>, found: &[ProfileHint]) -> bool {
    let mut added = false;
    for hint in found {
        if validate_profile(&hint.profile).is_err() {
            continue;
        }
        if bots.iter().any(|bot| bot.profile == hint.profile) {
            continue;
        }
        let name = hint.display_name.trim();
        let display_name = if name.is_empty() {
            hint.profile.clone()
        } else {
            name.to_string()
        };
        bots.push(BotConfig {
            profile: hint.profile.clone(),
            display_name,
            color: parse_hermes_color(&hint.color).unwrap_or_else(|| color_for(&hint.profile)),
            base_url: String::new(),
            detail: hint.detail.trim().to_string(),
            session_id: String::new(),
            session_explicit: false,
            session_anchor: 0.0,
            enabled: true,
            plan_mode: false,
        });
        added = true;
    }
    added
}

fn skip_ws(bytes: &[u8], mut i: usize) -> usize {
    while i < bytes.len() && bytes[i].is_ascii_whitespace() {
        i += 1;
    }
    i
}

fn scan_json_string(bytes: &[u8], start: usize) -> Option<usize> {
    if start >= bytes.len() || bytes[start] != b'"' {
        return None;
    }
    let mut i = start + 1;
    while i < bytes.len() {
        match bytes[i] {
            b'\\' => {
                i += 2;
                if i > bytes.len() {
                    return None;
                }
            }
            b'"' => return Some(i + 1),
            _ => i += 1,
        }
    }
    None
}

fn skip_json_container(bytes: &[u8], start: usize, open: u8, close: u8) -> Option<usize> {
    let mut i = start + 1;
    let mut depth = 1i32;
    while i < bytes.len() {
        match bytes[i] {
            b'"' => i = scan_json_string(bytes, i)?,
            c if c == open => {
                depth += 1;
                i += 1;
            }
            c if c == close => {
                depth -= 1;
                i += 1;
                if depth == 0 {
                    return Some(i);
                }
            }
            _ => i += 1,
        }
    }
    None
}

fn skip_json_value(bytes: &[u8], i: usize) -> Option<usize> {
    if i >= bytes.len() {
        return None;
    }
    match bytes[i] {
        b'"' => scan_json_string(bytes, i),
        b'{' => skip_json_container(bytes, i, b'{', b'}'),
        b'[' => skip_json_container(bytes, i, b'[', b']'),
        b't' | b'f' | b'n' | b'-' | b'0'..=b'9' => {
            let mut j = i + 1;
            while j < bytes.len()
                && !matches!(bytes[j], b',' | b'}' | b']' | b' ' | b'\n' | b'\r' | b'\t')
            {
                j += 1;
            }
            Some(j)
        }
        _ => None,
    }
}

struct JsonField {
    key_start: usize,
    value_start: usize,
    value_end: usize,
}

fn root_object_close(bytes: &[u8]) -> Option<usize> {
    let i = skip_ws(bytes, 0);
    if i >= bytes.len() || bytes[i] != b'{' {
        return None;
    }
    let end = skip_json_container(bytes, i, b'{', b'}')?;
    Some(end - 1)
}

fn top_level_field(text: &str, name: &str) -> Option<JsonField> {
    let bytes = text.as_bytes();
    let mut i = skip_ws(bytes, 0);
    if i >= bytes.len() || bytes[i] != b'{' {
        return None;
    }
    i += 1;
    loop {
        i = skip_ws(bytes, i);
        if i >= bytes.len() || bytes[i] == b'}' {
            return None;
        }
        if bytes[i] != b'"' {
            return None;
        }
        let key_start = i;
        let key_end = scan_json_string(bytes, i)?;
        let key = &text[key_start + 1..key_end - 1];
        i = skip_ws(bytes, key_end);
        if i >= bytes.len() || bytes[i] != b':' {
            return None;
        }
        i = skip_ws(bytes, i + 1);
        let value_start = i;
        let value_end = skip_json_value(bytes, i)?;
        if key == name {
            return Some(JsonField {
                key_start,
                value_start,
                value_end,
            });
        }
        i = skip_ws(bytes, value_end);
        if i < bytes.len() && bytes[i] == b',' {
            i += 1;
            continue;
        }
        return None;
    }
}

fn valid_board_slug(slug: &str) -> bool {
    !slug.is_empty()
        && slug.len() <= 64
        && slug
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
}

fn insert_kanban_board(text: &str, slug: &str) -> Result<String, String> {
    let bytes = text.as_bytes();
    let close = root_object_close(bytes).ok_or_else(|| "設定檔格式唔啱".to_string())?;
    let mut j = close;
    while j > 0 && bytes[j - 1].is_ascii_whitespace() {
        j -= 1;
    }
    let field = format!("\n  \"kanban_board\": \"{slug}\"\n");
    let mut out = String::with_capacity(text.len() + field.len() + 1);
    if j > 0 && bytes[j - 1] == b'{' {
        out.push_str(&text[..j]);
        out.push_str(&field);
        out.push_str(&text[close..]);
        return Ok(out);
    }
    out.push_str(&text[..j]);
    out.push(',');
    out.push_str(&field);
    out.push_str(&text[close..]);
    Ok(out)
}

fn insert_show_bot_names(text: &str) -> Result<String, String> {
    let bytes = text.as_bytes();
    let close = root_object_close(bytes).ok_or_else(|| "設定檔格式唔啱".to_string())?;
    let mut j = close;
    while j > 0 && bytes[j - 1].is_ascii_whitespace() {
        j -= 1;
    }
    let mut out = String::with_capacity(text.len() + 32);
    if j > 0 && bytes[j - 1] == b'{' {
        out.push_str(&text[..j]);
        out.push_str("\n  \"show_bot_names\": true\n");
        out.push_str(&text[close..]);
        return Ok(out);
    }
    out.push_str(&text[..j]);
    out.push_str(",\n  \"show_bot_names\": true\n");
    out.push_str(&text[close..]);
    Ok(out)
}

fn insert_show_tool_detail(text: &str) -> Result<String, String> {
    let bytes = text.as_bytes();
    let close = root_object_close(bytes).ok_or_else(|| "設定檔格式唔啱".to_string())?;
    let mut j = close;
    while j > 0 && bytes[j - 1].is_ascii_whitespace() {
        j -= 1;
    }
    let mut out = String::with_capacity(text.len() + 32);
    if j > 0 && bytes[j - 1] == b'{' {
        out.push_str(&text[..j]);
        out.push_str("\n  \"show_tool_detail\": true\n");
        out.push_str(&text[close..]);
        return Ok(out);
    }
    out.push_str(&text[..j]);
    out.push_str(",\n  \"show_tool_detail\": true\n");
    out.push_str(&text[close..]);
    Ok(out)
}

fn remove_top_level_field(text: &str, span: &JsonField) -> String {
    let bytes = text.as_bytes();
    let after = skip_ws(bytes, span.value_end);
    if after < bytes.len() && bytes[after] == b',' {
        let mut start = span.key_start;
        while start > 0 && (bytes[start - 1] == b' ' || bytes[start - 1] == b'\t') {
            start -= 1;
        }
        let mut end = after + 1;
        if end < bytes.len() && bytes[end] == b'\r' {
            end += 1;
        }
        if end < bytes.len() && bytes[end] == b'\n' {
            end += 1;
        }
        let mut out = String::with_capacity(text.len());
        out.push_str(&text[..start]);
        out.push_str(&text[end..]);
        return out;
    }
    let mut start = span.key_start;
    while start > 0 && (bytes[start - 1] == b' ' || bytes[start - 1] == b'\t') {
        start -= 1;
    }
    let mut k = start;
    if k > 0 && bytes[k - 1] == b'\n' {
        k -= 1;
        if k > 0 && bytes[k - 1] == b'\r' {
            k -= 1;
        }
    }
    let mut c = k;
    while c > 0 && bytes[c - 1].is_ascii_whitespace() {
        c -= 1;
    }
    let cut = if c > 0 && bytes[c - 1] == b',' {
        c - 1
    } else {
        start
    };
    let mut out = String::with_capacity(text.len());
    out.push_str(&text[..cut]);
    out.push_str(&text[span.value_end..]);
    out
}

fn write_config_text(path: &Path, text: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("開唔到設定目錄：{e}"))?;
    }
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, text).map_err(|e| format!("寫唔到設定：{e}"))?;
    fs::rename(&tmp, path).map_err(|e| format!("寫唔到設定：{e}"))?;
    Ok(())
}

/// Writes `kanban_board` only when the user picked a slug.
/// An empty slug removes the key. A missing key and an empty slug leave
/// the file byte-identical. Other keys keep their order.
pub fn store_kanban_board(path: &Path, slug: &str) -> Result<bool, String> {
    let slug = slug.trim();
    if !slug.is_empty() && !valid_board_slug(slug) {
        return Err("看板名稱唔合法".into());
    }
    if !path.exists() {
        if slug.is_empty() {
            return Ok(false);
        }
        let mut cfg = AppConfig::default();
        cfg.kanban_board = slug.to_string();
        save(path, &cfg)?;
        return Ok(true);
    }
    let text = fs::read_to_string(path).map_err(|e| format!("讀唔到設定：{e}"))?;
    let value: serde_json::Value =
        serde_json::from_str(&text).map_err(|e| format!("設定檔格式唔啱：{e}"))?;
    if !value.is_object() {
        return Err("設定檔格式唔啱".to_string());
    }
    let current = value
        .get("kanban_board")
        .and_then(serde_json::Value::as_str)
        .unwrap_or("")
        .trim();
    if current == slug {
        return Ok(false);
    }
    let patched = if slug.is_empty() {
        let span = top_level_field(&text, "kanban_board")
            .ok_or_else(|| "設定檔格式唔啱".to_string())?;
        remove_top_level_field(&text, &span)
    } else if let Some(span) = top_level_field(&text, "kanban_board") {
        let mut out = String::with_capacity(text.len() + slug.len());
        out.push_str(&text[..span.value_start]);
        out.push('"');
        out.push_str(slug);
        out.push('"');
        out.push_str(&text[span.value_end..]);
        out
    } else {
        insert_kanban_board(&text, slug)?
    };
    write_config_text(path, &patched)?;
    Ok(true)
}

/// Writes `show_bot_names` only when the stored value changes.
/// Splices that one key so the other keys keep their order and a full
/// save cannot invent omitted fields.
pub fn store_show_bot_names(path: &Path, enabled: bool) -> Result<bool, String> {
    if !path.exists() {
        if !enabled {
            return Ok(false);
        }
        let mut cfg = AppConfig::default();
        cfg.show_bot_names = true;
        save(path, &cfg)?;
        return Ok(true);
    }
    let text = fs::read_to_string(path).map_err(|e| format!("讀唔到設定：{e}"))?;
    let value: serde_json::Value =
        serde_json::from_str(&text).map_err(|e| format!("設定檔格式唔啱：{e}"))?;
    if !value.is_object() {
        return Err("設定檔格式唔啱".to_string());
    }
    let current = value
        .get("show_bot_names")
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(false);
    if current == enabled {
        return Ok(false);
    }
    let patched = if enabled {
        if let Some(span) = top_level_field(&text, "show_bot_names") {
            let mut out = String::with_capacity(text.len() + 8);
            out.push_str(&text[..span.value_start]);
            out.push_str("true");
            out.push_str(&text[span.value_end..]);
            out
        } else {
            insert_show_bot_names(&text)?
        }
    } else {
        let span = top_level_field(&text, "show_bot_names")
            .ok_or_else(|| "設定檔格式唔啱".to_string())?;
        remove_top_level_field(&text, &span)
    };
    write_config_text(path, &patched)?;
    Ok(true)
}

/// Writes `show_tool_detail` only when the stored value changes.
/// Splices that one key. Expand flags on a chat run are not config.
pub fn store_show_tool_detail(path: &Path, enabled: bool) -> Result<bool, String> {
    if !path.exists() {
        if !enabled {
            return Ok(false);
        }
        let mut cfg = AppConfig::default();
        cfg.show_tool_detail = true;
        save(path, &cfg)?;
        return Ok(true);
    }
    let text = fs::read_to_string(path).map_err(|e| format!("讀唔到設定：{e}"))?;
    let value: serde_json::Value =
        serde_json::from_str(&text).map_err(|e| format!("設定檔格式唔啱：{e}"))?;
    if !value.is_object() {
        return Err("設定檔格式唔啱".to_string());
    }
    let current = value
        .get("show_tool_detail")
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(false);
    if current == enabled {
        return Ok(false);
    }
    let patched = if enabled {
        if let Some(span) = top_level_field(&text, "show_tool_detail") {
            let mut out = String::with_capacity(text.len() + 8);
            out.push_str(&text[..span.value_start]);
            out.push_str("true");
            out.push_str(&text[span.value_end..]);
            out
        } else {
            insert_show_tool_detail(&text)?
        }
    } else {
        let span = top_level_field(&text, "show_tool_detail")
            .ok_or_else(|| "設定檔格式唔啱".to_string())?;
        remove_top_level_field(&text, &span)
    };
    write_config_text(path, &patched)?;
    Ok(true)
}

fn object_field(text: &str, object_start: usize, name: &str) -> Option<JsonField> {
    let bytes = text.as_bytes();
    if object_start >= bytes.len() || bytes[object_start] != b'{' {
        return None;
    }
    let end = skip_json_value(bytes, object_start)?;
    let mut i = object_start + 1;
    loop {
        i = skip_ws(bytes, i);
        if i >= end || bytes[i] == b'}' {
            return None;
        }
        if bytes[i] != b'"' {
            return None;
        }
        let key_start = i;
        let key_end = scan_json_string(bytes, i)?;
        let key = &text[key_start + 1..key_end - 1];
        i = skip_ws(bytes, key_end);
        if i >= bytes.len() || bytes[i] != b':' {
            return None;
        }
        i = skip_ws(bytes, i + 1);
        let value_start = i;
        let value_end = skip_json_value(bytes, i)?;
        if key == name {
            return Some(JsonField {
                key_start,
                value_start,
                value_end,
            });
        }
        i = skip_ws(bytes, value_end);
        if i < end && bytes[i] == b',' {
            i += 1;
            continue;
        }
        return None;
    }
}

fn object_string(text: &str, object_start: usize, name: &str) -> Option<String> {
    let span = object_field(text, object_start, name)?;
    let raw = &text[span.value_start..span.value_end];
    let value: serde_json::Value = serde_json::from_str(raw).ok()?;
    value.as_str().map(str::to_string)
}

fn bot_object_bounds(text: &str, profile: &str) -> Result<(usize, usize), String> {
    let bots = top_level_field(text, "bots").ok_or_else(|| "設定檔格式唔啱".to_string())?;
    let bytes = text.as_bytes();
    if bots.value_start >= bytes.len() || bytes[bots.value_start] != b'[' {
        return Err("設定檔格式唔啱".to_string());
    }
    let mut i = bots.value_start + 1;
    while i < bots.value_end {
        i = skip_ws(bytes, i);
        if i >= bots.value_end || bytes[i] == b']' {
            break;
        }
        if bytes[i] != b'{' {
            return Err("設定檔格式唔啱".to_string());
        }
        let obj_end = skip_json_value(bytes, i).ok_or_else(|| "設定檔格式唔啱".to_string())?;
        if object_string(text, i, "profile").as_deref() == Some(profile) {
            return Ok((i, obj_end));
        }
        i = skip_ws(bytes, obj_end);
        if i < bots.value_end && bytes[i] == b',' {
            i += 1;
        }
    }
    Err(format!("名單冇 profile「{profile}」"))
}

fn insert_into_object(text: &str, obj_end: usize, field: &str) -> Result<String, String> {
    let bytes = text.as_bytes();
    if obj_end == 0 || bytes.get(obj_end - 1) != Some(&b'}') {
        return Err("設定檔格式唔啱".to_string());
    }
    let close = obj_end - 1;
    let mut j = close;
    while j > 0 && bytes[j - 1].is_ascii_whitespace() {
        j -= 1;
    }
    let mut out = String::with_capacity(text.len() + field.len() + 16);
    if j > 0 && bytes[j - 1] == b'{' {
        out.push_str(&text[..j]);
        out.push('\n');
        out.push_str(field);
        out.push('\n');
        out.push_str(&text[close..]);
        return Ok(out);
    }
    out.push_str(&text[..j]);
    out.push_str(",\n      ");
    out.push_str(field);
    out.push_str(&text[j..]);
    Ok(out)
}

/// Writes `plan_mode` on one bot only when that bot's stored value changes.
/// Splices the key inside that object. Sibling keys, other bots, and key
/// order stay as they are. Off removes the key so a false flag is not stored.
pub fn store_plan_mode(path: &Path, profile: &str, enabled: bool) -> Result<bool, String> {
    let profile = profile.trim();
    validate_profile(profile)?;
    if !path.exists() {
        return Err(format!("名單冇 profile「{profile}」"));
    }
    let text = fs::read_to_string(path).map_err(|e| format!("讀唔到設定：{e}"))?;
    let value: serde_json::Value =
        serde_json::from_str(&text).map_err(|e| format!("設定檔格式唔啱：{e}"))?;
    let bots = value
        .get("bots")
        .and_then(serde_json::Value::as_array)
        .ok_or_else(|| "設定檔格式唔啱".to_string())?;
    let Some(bot) = bots
        .iter()
        .find(|bot| bot.get("profile").and_then(serde_json::Value::as_str) == Some(profile))
    else {
        return Err(format!("名單冇 profile「{profile}」"));
    };
    let current = bot
        .get("plan_mode")
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(false);
    if current == enabled {
        return Ok(false);
    }
    let (start, end) = bot_object_bounds(&text, profile)?;
    let patched = if enabled {
        if let Some(span) = object_field(&text, start, "plan_mode") {
            let mut out = String::with_capacity(text.len());
            out.push_str(&text[..span.value_start]);
            out.push_str("true");
            out.push_str(&text[span.value_end..]);
            out
        } else {
            insert_into_object(&text, end, "\"plan_mode\": true")?
        }
    } else {
        let span = object_field(&text, start, "plan_mode")
            .ok_or_else(|| "設定檔格式唔啱".to_string())?;
        remove_top_level_field(&text, &span)
    };
    write_config_text(path, &patched)?;
    Ok(true)
}

/// Copies a discovered description into a roster row whose detail is still blank.
/// A written detail, `enabled`, name, colour, order, and session stay as they are.
pub fn fill_empty_details(bots: &mut [BotConfig], found: &[ProfileHint]) -> bool {
    let mut filled = false;
    for hint in found {
        let detail = hint.detail.trim();
        if detail.is_empty() {
            continue;
        }
        let Some(existing) = bots.iter_mut().find(|bot| bot.profile == hint.profile) else {
            continue;
        };
        if !existing.detail.trim().is_empty() {
            continue;
        }
        existing.detail = detail.to_string();
        filled = true;
    }
    filled
}

/// Writes config.json when a profile is appended or a blank detail is filled.
pub fn apply_quiet_roster(path: &Path, found: &[ProfileHint]) -> Result<bool, String> {
    let mut cfg = load(path)?;
    let added = append_new_profiles(&mut cfg.bots, found);
    let filled = fill_empty_details(&mut cfg.bots, found);
    if added || filled {
        save(path, &cfg)?;
    }
    Ok(added || filled)
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

pub fn profile_yaml_color(path: &Path) -> String {
    let Ok(text) = fs::read_to_string(path) else {
        return String::new();
    };
    hermes_bot_color_from_yaml(&text).unwrap_or_default()
}

/// `ui_meta.hermes-bots.color` from a profile.yaml body. A `color` outside that block is ignored.
pub fn hermes_bot_color_from_yaml(text: &str) -> Option<String> {
    let mut ui_indent: Option<usize> = None;
    let mut bots_indent: Option<usize> = None;
    for raw in text.lines() {
        let Some(indent) = raw.find(|c: char| !c.is_whitespace()) else {
            continue;
        };
        let line = raw[indent..].trim_end();
        if line.starts_with('#') {
            continue;
        }
        if ui_indent.is_some_and(|level| indent <= level) && !line.starts_with("ui_meta:") {
            ui_indent = None;
            bots_indent = None;
        } else if bots_indent.is_some_and(|level| indent <= level)
            && !line.starts_with("hermes-bots:")
        {
            bots_indent = None;
        }
        if line.starts_with("ui_meta:") {
            ui_indent = Some(indent);
            bots_indent = None;
            continue;
        }
        if ui_indent.is_some_and(|level| indent > level) && line.starts_with("hermes-bots:") {
            bots_indent = Some(indent);
            continue;
        }
        if bots_indent.is_some_and(|level| indent > level) && line.starts_with("color:") {
            let value = strip_yaml_scalar(&line["color:".len()..]);
            if !value.is_empty() {
                return Some(value);
            }
        }
    }
    None
}

fn strip_yaml_scalar(raw: &str) -> String {
    let raw = raw.trim();
    if raw.is_empty() || raw.starts_with('|') || raw.starts_with('>') {
        return String::new();
    }
    let (quote, rest) = if let Some(stripped) = raw.strip_prefix('"') {
        ('"', stripped)
    } else if let Some(stripped) = raw.strip_prefix('\'') {
        ('\'', stripped)
    } else {
        return raw.split(" #").next().unwrap_or(raw).trim().to_string();
    };
    match rest.find(quote) {
        Some(end) => rest[..end].to_string(),
        None => rest.to_string(),
    }
}

/// Hermes profile color as `#rrggbb`. Unrecognized values are `None` (caller falls back).
pub fn parse_hermes_color(raw: &str) -> Option<String> {
    let raw = raw.trim().trim_matches(|c| c == '"' || c == '\'');
    if raw.is_empty() {
        return None;
    }
    if let Some(hex) = parse_hex_color(raw) {
        return Some(hex);
    }
    let lower = raw.to_ascii_lowercase();
    if let Some(hex) = parse_hsl_color(&lower) {
        return Some(hex);
    }
    parse_rgb_color(&lower)
}

fn parse_hex_color(raw: &str) -> Option<String> {
    let body = raw.strip_prefix('#')?;
    let expanded = if body.len() == 3 && body.chars().all(|c| c.is_ascii_hexdigit()) {
        body.chars().flat_map(|c| [c, c]).collect::<String>()
    } else if body.len() == 6 && body.chars().all(|c| c.is_ascii_hexdigit()) {
        body.to_string()
    } else {
        return None;
    };
    Some(format!("#{}", expanded.to_ascii_lowercase()))
}

fn parse_hsl_color(raw: &str) -> Option<String> {
    let inner = raw.strip_prefix("hsl(")?.strip_suffix(')')?.trim();
    let parts = split_color_args(inner);
    if parts.len() != 3 {
        return None;
    }
    let h: f64 = parts[0].trim_end_matches("deg").trim().parse().ok()?;
    let s = color_number(parts[1])?;
    let l = color_number(parts[2])?;
    if !h.is_finite() {
        return None;
    }
    Some(hsl_to_hex(h, s, l))
}

fn parse_rgb_color(raw: &str) -> Option<String> {
    let inner = raw.strip_prefix("rgb(")?.strip_suffix(')')?.trim();
    let parts = split_color_args(inner);
    if parts.len() != 3 {
        return None;
    }
    let mut channels = [0u8; 3];
    for (index, part) in parts.iter().enumerate() {
        channels[index] = rgb_channel(part)?;
    }
    Some(format!(
        "#{:02x}{:02x}{:02x}",
        channels[0], channels[1], channels[2]
    ))
}

fn split_color_args(inner: &str) -> Vec<&str> {
    if inner.contains(',') {
        inner
            .split(',')
            .map(str::trim)
            .filter(|part| !part.is_empty())
            .collect()
    } else {
        inner.split_whitespace().collect()
    }
}

fn color_number(part: &str) -> Option<f64> {
    let n: f64 = part.trim().trim_end_matches('%').trim().parse().ok()?;
    n.is_finite().then_some(n)
}

fn rgb_channel(part: &str) -> Option<u8> {
    let part = part.trim();
    if let Some(pct) = part.strip_suffix('%') {
        let n = color_number(pct)?;
        return Some(((n / 100.0).clamp(0.0, 1.0) * 255.0).round() as u8);
    }
    let n = color_number(part)?;
    if !(0.0..=255.0).contains(&n) {
        return None;
    }
    Some(n.round() as u8)
}

fn hsl_to_hex(h: f64, s: f64, l: f64) -> String {
    let h = h.rem_euclid(360.0);
    let s = (s / 100.0).clamp(0.0, 1.0);
    let l = (l / 100.0).clamp(0.0, 1.0);
    let c = (1.0 - (2.0 * l - 1.0).abs()) * s;
    let h_prime = h / 60.0;
    let x = c * (1.0 - ((h_prime % 2.0) - 1.0).abs());
    let m = l - c / 2.0;
    let (r1, g1, b1) = match h_prime as i32 {
        0 => (c, x, 0.0),
        1 => (x, c, 0.0),
        2 => (0.0, c, x),
        3 => (0.0, x, c),
        4 => (x, 0.0, c),
        _ => (c, 0.0, x),
    };
    let channel = |value: f64| ((value * 255.0).round() as i32).clamp(0, 255) as u8;
    format!(
        "#{:02x}{:02x}{:02x}",
        channel(r1 + m),
        channel(g1 + m),
        channel(b1 + m)
    )
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
                plan_mode: false,
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
        assert_eq!(cfg.interaction.min_opacity, 0.25);
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
        fs::create_dir_all(root.join("profiles").join(".deleted")).unwrap();
        fs::write(root.join("config.yaml"), "model: x").unwrap();
        fs::write(
            root.join("profile.yaml"),
            "color: \"#112233\"\nui_meta:\n  hermes-bots:\n    color: \"hsl(326 68% 58%)\"\n",
        )
        .unwrap();
        fs::write(root.join("profiles").join("notes.txt"), "x").unwrap();
        fs::write(
            root.join("profiles").join("planner").join("profile.yaml"),
            "ui_meta:\n  other:\n    color: \"#abcdef\"\n  hermes-bots:\n    title: Planner\n",
        )
        .unwrap();
        let found = local_hermes_profiles(&root);
        let names: Vec<_> = found.iter().map(|hint| hint.profile.as_str()).collect();
        assert_eq!(names, vec!["default", "planner"]);
        assert_eq!(found[0].color, "hsl(326 68% 58%)");
        assert_eq!(found[1].color, "");
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
                plan_mode: false,
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
                plan_mode: false,
            },
        ];
        merge_discovered_profiles(
            &mut bots,
            &[
                ProfileHint {
                    profile: "planner".into(),
                    display_name: "Planner".into(),
                    detail: "新".into(),
                    color: String::new(),
                },
                ProfileHint {
                    profile: "coder".into(),
                    display_name: "碼".into(),
                    detail: String::new(),
                    color: String::new(),
                },
                ProfileHint {
                    profile: "bad name".into(),
                    display_name: "nope".into(),
                    detail: String::new(),
                    color: "#ff00aa".into(),
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
        assert_eq!(bots[2].color, color_for("coder"));
        assert!(bots[2].base_url.is_empty());
        let text = serde_json::to_string(&bots[2]).unwrap();
        assert!(!text.contains("key"));
        set_bot_enabled(&mut bots, "coder", false).unwrap();
        assert!(!bots[2].enabled);
        assert!(set_bot_enabled(&mut bots, "missing", false).is_err());
    }

    #[test]
    fn hermes_color_replaces_the_stored_swatch_and_falls_back_when_absent() {
        let yaml = "\
color: \"#112233\"
ui_meta:
  theme:
    color: red
  hermes-bots:
    title: Planner
    color: hsl(326 68% 58%) # bot mode
other:
  color: \"#abcdef\"
";
        assert_eq!(
            hermes_bot_color_from_yaml(yaml).as_deref(),
            Some("hsl(326 68% 58%)")
        );
        assert_eq!(hermes_bot_color_from_yaml("color: \"#112233\"\n"), None);
        assert_eq!(
            parse_hermes_color("hsl(326 68% 58%)").as_deref(),
            Some("#dd4b9e")
        );
        assert_eq!(
            parse_hermes_color("hsl(200, 50%, 40%)").as_deref(),
            Some("#337799")
        );
        assert_eq!(parse_hermes_color("#ABC").as_deref(), Some("#aabbcc"));
        assert_eq!(parse_hermes_color("#00f2f2").as_deref(), Some("#00f2f2"));
        assert_eq!(
            parse_hermes_color("rgb(10, 20, 30)").as_deref(),
            Some("#0a141e")
        );
        assert_eq!(parse_hermes_color("not-a-color"), None);
        assert_eq!(parse_hermes_color(""), None);

        let mut bots = vec![BotConfig {
            profile: "planner".into(),
            display_name: "我的計劃".into(),
            color: "#00f2f2".into(),
            base_url: String::new(),
            detail: String::new(),
            session_id: String::new(),
            session_explicit: false,
            session_anchor: 0.0,
            enabled: true,
            plan_mode: false,
        }];
        merge_discovered_profiles(
            &mut bots,
            &[ProfileHint {
                profile: "planner".into(),
                display_name: "Planner".into(),
                detail: String::new(),
                color: "hsl(326 68% 58%)".into(),
            }],
        );
        assert_eq!(bots[0].color, "#dd4b9e");
        assert_eq!(bots[0].display_name, "我的計劃");
        merge_discovered_profiles(
            &mut bots,
            &[
                ProfileHint {
                    profile: "planner".into(),
                    display_name: "Planner".into(),
                    detail: String::new(),
                    color: String::new(),
                },
                ProfileHint {
                    profile: "ops".into(),
                    display_name: "ops".into(),
                    detail: String::new(),
                    color: "#ABC".into(),
                },
            ],
        );
        assert_eq!(bots[0].color, "#dd4b9e");
        assert_eq!(bots[1].color, "#aabbcc");
    }

    #[test]
    fn quiet_roster_tick_keeps_bytes_until_a_new_profile_appears() {
        let dir = std::env::temp_dir().join(format!(
            "hermes-roster-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("config.json");
        let cfg = AppConfig {
            bots: vec![BotConfig {
                profile: "forex-forest".into(),
                display_name: "Forest".into(),
                color: "#112233".into(),
                base_url: String::new(),
                detail: "keep".into(),
                session_id: "20261001_013827_25b1eb".into(),
                session_explicit: true,
                session_anchor: 12.5,
                enabled: false,
                plan_mode: false,
            }],
            gateway_base_url: "http://10.10.24.33:8642".into(),
            ..AppConfig::default()
        };
        save(&path, &cfg).unwrap();
        let before = fs::read(&path).unwrap();
        let same = [ProfileHint {
            profile: "forex-forest".into(),
            display_name: "Other".into(),
            detail: "changed".into(),
            color: "#abcdef".into(),
        }];
        assert_eq!(apply_quiet_roster(&path, &same).unwrap(), false);
        assert_eq!(fs::read(&path).unwrap(), before);
        let loaded = load(&path).unwrap();
        assert_eq!(loaded.bots[0].color, "#112233");
        assert_eq!(loaded.bots[0].session_id, "20261001_013827_25b1eb");
        assert!(loaded.bots[0].session_explicit);
        assert_eq!(loaded.bots[0].session_anchor, 12.5);
        assert!(!loaded.bots[0].enabled);
        assert_eq!(loaded.bots[0].display_name, "Forest");
        assert_eq!(loaded.bots[0].detail, "keep");

        let added = [
            ProfileHint {
                profile: "forex-forest".into(),
                display_name: "Other".into(),
                detail: "changed".into(),
                color: "#abcdef".into(),
            },
            ProfileHint {
                profile: "new-bot".into(),
                display_name: "New".into(),
                detail: String::new(),
                color: String::new(),
            },
        ];
        assert_eq!(apply_quiet_roster(&path, &added).unwrap(), true);
        let with_new = fs::read(&path).unwrap();
        assert_ne!(with_new, before);
        let next = load(&path).unwrap();
        assert_eq!(next.bots.len(), 2);
        assert_eq!(next.bots[0].session_id, "20261001_013827_25b1eb");
        assert_eq!(next.bots[0].color, "#112233");
        assert!(!next.bots[0].enabled);
        assert_eq!(next.bots[0].display_name, "Forest");
        assert_eq!(next.bots[1].profile, "new-bot");
        assert!(next.bots[1].session_id.is_empty());
        assert!(next.bots[1].enabled);

        assert_eq!(apply_quiet_roster(&path, &[]).unwrap(), false);
        assert_eq!(fs::read(&path).unwrap(), with_new);
        assert_eq!(load(&path).unwrap().bots.len(), 2);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn quiet_roster_copies_a_blank_description_and_keeps_enabled() {
        let dir = std::env::temp_dir().join(format!(
            "hermes-joyce-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("config.json");
        let cfg = AppConfig {
            bots: vec![BotConfig {
                profile: "joyce".into(),
                display_name: "Joyce".into(),
                color: "#f20079".into(),
                base_url: String::new(),
                detail: String::new(),
                session_id: "keep-session".into(),
                session_explicit: true,
                session_anchor: 3.0,
                enabled: false,
                plan_mode: false,
            }],
            ..AppConfig::default()
        };
        save(&path, &cfg).unwrap();
        let hint = [ProfileHint {
            profile: "joyce".into(),
            display_name: "Joyce".into(),
            detail: "文稿同回覆".into(),
            color: "#0000f2".into(),
        }];
        assert_eq!(apply_quiet_roster(&path, &hint).unwrap(), true);
        let loaded = load(&path).unwrap();
        assert_eq!(loaded.bots[0].detail, "文稿同回覆");
        assert!(!loaded.bots[0].enabled);
        assert_eq!(loaded.bots[0].display_name, "Joyce");
        assert_eq!(loaded.bots[0].color, "#f20079");
        assert_eq!(loaded.bots[0].session_id, "keep-session");
        assert!(loaded.bots[0].session_explicit);
        let filled = fs::read(&path).unwrap();
        assert_eq!(apply_quiet_roster(&path, &hint).unwrap(), false);
        assert_eq!(fs::read(&path).unwrap(), filled);
        let keep = [ProfileHint {
            profile: "joyce".into(),
            display_name: "Other".into(),
            detail: "唔好覆蓋".into(),
            color: String::new(),
        }];
        assert_eq!(apply_quiet_roster(&path, &keep).unwrap(), false);
        assert_eq!(load(&path).unwrap().bots[0].detail, "文稿同回覆");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn show_bot_names_is_written_only_when_the_toggle_changes() {
        let dir = std::env::temp_dir().join(format!(
            "hermes-names-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("config.json");
        let cfg = AppConfig {
            bots: vec![BotConfig {
                profile: "mt-coder".into(),
                display_name: "Coder".into(),
                color: "#112233".into(),
                base_url: String::new(),
                detail: String::new(),
                session_id: "api_1792573589_f1c99a3b".into(),
                session_explicit: false,
                session_anchor: 4.0,
                enabled: true,
                plan_mode: false,
            }],
            ..AppConfig::default()
        };
        save(&path, &cfg).unwrap();
        let before = fs::read(&path).unwrap();
        let text = String::from_utf8(before.clone()).unwrap();
        assert!(!text.contains("show_bot_names"));
        assert!(!text.contains("kanban_board"));
        assert!(!load(&path).unwrap().show_bot_names);
        assert_eq!(store_show_bot_names(&path, false).unwrap(), false);
        assert_eq!(fs::read(&path).unwrap(), before);
        assert_eq!(store_show_bot_names(&path, true).unwrap(), true);
        let on = fs::read(&path).unwrap();
        assert_ne!(on, before);
        assert!(String::from_utf8(on.clone()).unwrap().contains("\"show_bot_names\": true"));
        let loaded = load(&path).unwrap();
        assert!(loaded.show_bot_names);
        assert_eq!(loaded.bots[0].session_id, "api_1792573589_f1c99a3b");
        assert_eq!(loaded.bots[0].color, "#112233");
        assert!(loaded.bots[0].enabled);
        assert_eq!(store_show_bot_names(&path, true).unwrap(), false);
        assert_eq!(fs::read(&path).unwrap(), on);
        assert_eq!(store_show_bot_names(&path, false).unwrap(), true);
        let off = String::from_utf8(fs::read(&path).unwrap()).unwrap();
        assert!(!off.contains("show_bot_names"));
        assert_eq!(load(&path).unwrap().bots[0].session_id, "api_1792573589_f1c99a3b");

        let bare = dir.join("bare.json");
        fs::write(
            &bare,
            r##"{
  "version": 1,
  "gateway_base_url": "http://10.10.24.33:8642",
  "bots": [{
    "profile": "mt-coder",
    "display_name": "Coder",
    "color": "#112233",
    "session_id": "api_1792573589_f1c99a3b",
    "enabled": true
  }]
}
"##,
        )
        .unwrap();
        assert_eq!(store_show_bot_names(&bare, true).unwrap(), true);
        let patched = String::from_utf8(fs::read(&bare).unwrap()).unwrap();
        assert!(patched.contains("\"show_bot_names\": true"));
        assert!(!patched.contains("kanban_base_url"));
        assert!(patched.contains("api_1792573589_f1c99a3b"));
        assert!(patched.contains("#112233"));
        let version_at = patched.find("\"version\"").unwrap();
        let gateway_at = patched.find("\"gateway_base_url\"").unwrap();
        let bots_at = patched.find("\"bots\"").unwrap();
        let names_at = patched.find("\"show_bot_names\"").unwrap();
        assert!(version_at < gateway_at && gateway_at < bots_at && bots_at < names_at);

        let ordered = dir.join("ordered.json");
        fs::write(
            &ordered,
            r##"{
  "bots": [],
  "version": 1,
  "gateway_base_url": "http://10.10.24.33:8642"
}
"##,
        )
        .unwrap();
        assert_eq!(store_show_bot_names(&ordered, true).unwrap(), true);
        let turned_on = String::from_utf8(fs::read(&ordered).unwrap()).unwrap();
        let bots_i = turned_on.find("\"bots\"").unwrap();
        let version_i = turned_on.find("\"version\"").unwrap();
        let gateway_i = turned_on.find("\"gateway_base_url\"").unwrap();
        let names_i = turned_on.find("\"show_bot_names\"").unwrap();
        assert!(bots_i < version_i && version_i < gateway_i && gateway_i < names_i);
        assert!(!turned_on.contains("kanban_base_url"));
        assert_eq!(store_show_bot_names(&ordered, false).unwrap(), true);
        let turned_off = String::from_utf8(fs::read(&ordered).unwrap()).unwrap();
        assert!(!turned_off.contains("show_bot_names"));
        assert!(turned_off.find("\"bots\"").unwrap() < turned_off.find("\"version\"").unwrap());
        assert!(
            turned_off.find("\"version\"").unwrap()
                < turned_off.find("\"gateway_base_url\"").unwrap()
        );
        assert!(load(&ordered).unwrap().gateway_base_url.contains("8642"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn show_tool_detail_is_written_only_when_the_toggle_changes() {
        let dir = std::env::temp_dir().join(format!(
            "hermes-tool-detail-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("config.json");
        let cfg = AppConfig {
            bots: vec![BotConfig {
                profile: "mt-coder".into(),
                display_name: "Coder".into(),
                color: "#112233".into(),
                base_url: String::new(),
                detail: String::new(),
                session_id: "api_1792573589_f1c99a3b".into(),
                session_explicit: false,
                session_anchor: 4.0,
                enabled: true,
                plan_mode: false,
            }],
            ..AppConfig::default()
        };
        save(&path, &cfg).unwrap();
        let before = fs::read(&path).unwrap();
        let text = String::from_utf8(before.clone()).unwrap();
        assert!(!text.contains("show_tool_detail"));
        assert!(!load(&path).unwrap().show_tool_detail);
        assert_eq!(store_show_tool_detail(&path, false).unwrap(), false);
        assert_eq!(fs::read(&path).unwrap(), before);
        assert_eq!(store_show_tool_detail(&path, true).unwrap(), true);
        let on = String::from_utf8(fs::read(&path).unwrap()).unwrap();
        assert!(on.contains("\"show_tool_detail\": true"));
        assert!(!on.contains("\"open\""));
        assert_eq!(load(&path).unwrap().bots[0].session_id, "api_1792573589_f1c99a3b");
        assert_eq!(store_show_tool_detail(&path, true).unwrap(), false);
        assert_eq!(store_show_tool_detail(&path, false).unwrap(), true);
        let off = String::from_utf8(fs::read(&path).unwrap()).unwrap();
        assert!(!off.contains("show_tool_detail"));
        assert_eq!(load(&path).unwrap().bots[0].session_id, "api_1792573589_f1c99a3b");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn kanban_board_is_written_only_after_an_explicit_pick() {
        let dir = std::env::temp_dir().join(format!(
            "hermes-kanban-board-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("config.json");
        let cfg = AppConfig {
            bots: vec![BotConfig {
                profile: "mt-coder".into(),
                display_name: "Coder".into(),
                color: "#112233".into(),
                base_url: String::new(),
                detail: String::new(),
                session_id: "api_1792573589_f1c99a3b".into(),
                session_explicit: false,
                session_anchor: 4.0,
                enabled: true,
                plan_mode: false,
            }],
            gateway_base_url: "http://10.10.24.33:8642".into(),
            ..AppConfig::default()
        };
        save(&path, &cfg).unwrap();
        let before = fs::read(&path).unwrap();
        let text = String::from_utf8(before.clone()).unwrap();
        assert!(!text.contains("kanban_board"), "{text}");
        assert!(load(&path).unwrap().kanban_board.is_empty());
        assert_eq!(store_kanban_board(&path, "").unwrap(), false);
        assert_eq!(store_kanban_board(&path, "   ").unwrap(), false);
        assert!(store_kanban_board(&path, "../mt4").is_err());
        assert!(store_kanban_board(&path, "board=default").is_err());
        assert_eq!(fs::read(&path).unwrap(), before);
        assert_eq!(store_kanban_board(&path, "mt4").unwrap(), true);
        let picked = fs::read(&path).unwrap();
        assert_ne!(picked, before);
        let picked_text = String::from_utf8(picked.clone()).unwrap();
        assert!(picked_text.contains("\"kanban_board\": \"mt4\""));
        assert_eq!(picked_text.matches("kanban_board").count(), 1);
        assert!(picked_text.contains("api_1792573589_f1c99a3b"));
        assert!(picked_text.contains("http://10.10.24.33:8642"));
        assert!(!picked_text.contains("kanban_base_url"));
        assert_eq!(load(&path).unwrap().kanban_board, "mt4");
        assert_eq!(store_kanban_board(&path, "mt4").unwrap(), false);
        assert_eq!(fs::read(&path).unwrap(), picked);
        assert_eq!(store_kanban_board(&path, "deskrpg").unwrap(), true);
        let switched = String::from_utf8(fs::read(&path).unwrap()).unwrap();
        assert_eq!(switched.matches("kanban_board").count(), 1);
        assert!(switched.contains("\"kanban_board\": \"deskrpg\""));
        assert!(!switched.contains("mt4"));
        assert!(switched.contains("api_1792573589_f1c99a3b"));
        assert_eq!(store_kanban_board(&path, "").unwrap(), true);
        let cleared = String::from_utf8(fs::read(&path).unwrap()).unwrap();
        assert!(!cleared.contains("kanban_board"), "{cleared}");
        assert!(cleared.contains("api_1792573589_f1c99a3b"));
        assert!(load(&path).unwrap().kanban_board.is_empty());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn save_omits_an_empty_kanban_base_url_that_was_not_in_the_file() {
        let dir = std::env::temp_dir().join(format!(
            "hermes-kanban-url-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("config.json");
        fs::write(
            &path,
            r##"{
  "version": 1,
  "gateway_base_url": "http://10.10.24.33:8642",
  "bots": [{
    "profile": "mt-coder",
    "display_name": "Coder",
    "color": "#112233",
    "session_id": "api_1792573589_f1c99a3b",
    "enabled": true
  }]
}
"##,
        )
        .unwrap();
        let mut cfg = load(&path).unwrap();
        assert!(cfg.kanban_base_url.is_empty());
        save(&path, &cfg).unwrap();
        let saved = fs::read_to_string(&path).unwrap();
        assert!(!saved.contains("kanban_base_url"), "{saved}");
        serde_json::from_str::<serde_json::Value>(&saved).unwrap();
        let loaded = load(&path).unwrap();
        assert_eq!(loaded.gateway_base_url, "http://10.10.24.33:8642");
        assert_eq!(loaded.bots[0].session_id, "api_1792573589_f1c99a3b");
        assert_eq!(loaded.bots[0].color, "#112233");

        cfg.kanban_base_url = "http://10.10.24.33:9119".into();
        save(&path, &cfg).unwrap();
        let with_url = fs::read_to_string(&path).unwrap();
        assert!(with_url.contains("\"kanban_base_url\": \"http://10.10.24.33:9119\""));

        cfg.kanban_base_url.clear();
        save(&path, &cfg).unwrap();
        let kept = fs::read_to_string(&path).unwrap();
        assert!(kept.contains("\"kanban_base_url\": \"\""));
        serde_json::from_str::<serde_json::Value>(&kept).unwrap();
        assert!(load(&path).unwrap().kanban_base_url.is_empty());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn plan_mode_is_written_only_on_the_toggled_bot() {
        let dir = std::env::temp_dir().join(format!(
            "hermes-plan-mode-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("config.json");
        let original = r##"{
  "version": 1,
  "gateway_base_url": "http://10.10.24.33:8642",
  "bots": [
    {
      "profile": "alpha",
      "display_name": "Alpha",
      "color": "#112233",
      "session_id": "api_alpha",
      "enabled": true
    },
    {
      "profile": "beta",
      "display_name": "Beta",
      "color": "#445566",
      "session_id": "api_beta",
      "enabled": true
    }
  ],
  "show_bot_names": true
}
"##;
        fs::write(&path, original).unwrap();
        let before = fs::read(&path).unwrap();
        assert!(!load(&path).unwrap().bots[0].plan_mode);
        assert_eq!(store_plan_mode(&path, "alpha", false).unwrap(), false);
        assert_eq!(fs::read(&path).unwrap(), before);
        assert!(store_plan_mode(&path, "nope", true).is_err());
        assert_eq!(fs::read(&path).unwrap(), before);
        assert!(store_plan_mode(&path, "../x", true).is_err());
        assert_eq!(fs::read(&path).unwrap(), before);
        let missing = dir.join("missing.json");
        assert!(store_plan_mode(&missing, "alpha", true).is_err());
        assert!(!missing.exists());

        let beta_before = {
            let (start, end) = bot_object_bounds(original, "beta").unwrap();
            original[start..end].to_string()
        };
        assert_eq!(store_plan_mode(&path, "alpha", true).unwrap(), true);
        let on = fs::read_to_string(&path).unwrap();
        assert_eq!(on.matches("\"plan_mode\"").count(), 1);
        let (a0, a1) = bot_object_bounds(&on, "alpha").unwrap();
        let alpha = &on[a0..a1];
        assert!(alpha.contains("\"plan_mode\": true"), "{alpha}");
        assert!(alpha.find("\"session_id\"").unwrap() < alpha.find("\"plan_mode\"").unwrap());
        assert!(alpha.find("\"color\"").unwrap() < alpha.find("\"plan_mode\"").unwrap());
        assert!(alpha.contains("\"session_id\": \"api_alpha\""));
        assert!(alpha.contains("\"color\": \"#112233\""));
        let (b0, b1) = bot_object_bounds(&on, "beta").unwrap();
        assert_eq!(&on[b0..b1], beta_before);
        assert!(on.contains("\"show_bot_names\": true"));
        let loaded = load(&path).unwrap();
        assert!(loaded.bots[0].plan_mode);
        assert!(!loaded.bots[1].plan_mode);
        assert_eq!(loaded.bots[0].session_id, "api_alpha");
        assert_eq!(loaded.bots[1].session_id, "api_beta");
        assert_eq!(loaded.bots[1].color, "#445566");
        let on_bytes = fs::read(&path).unwrap();
        assert_eq!(store_plan_mode(&path, "alpha", true).unwrap(), false);
        assert_eq!(fs::read(&path).unwrap(), on_bytes);
        assert_eq!(store_plan_mode(&path, "alpha", false).unwrap(), true);
        assert_eq!(fs::read(&path).unwrap(), before);
        assert!(!load(&path).unwrap().bots.iter().any(|bot| bot.plan_mode));

        let held = r##"{
  "version": 1,
  "bots": [
    {
      "profile": "alpha",
      "display_name": "Alpha",
      "color": "#112233",
      "session_id": "api_alpha",
      "plan_mode": false,
      "enabled": true
    },
    {
      "profile": "beta",
      "display_name": "Beta",
      "color": "#445566",
      "session_id": "api_beta",
      "plan_mode": true
    }
  ]
}
"##;
        fs::write(&path, held).unwrap();
        let beta_on = {
            let (start, end) = bot_object_bounds(held, "beta").unwrap();
            held[start..end].to_string()
        };
        assert_eq!(store_plan_mode(&path, "alpha", false).unwrap(), false);
        assert_eq!(fs::read(&path).unwrap(), held.as_bytes());
        assert_eq!(store_plan_mode(&path, "alpha", true).unwrap(), true);
        let flipped = fs::read_to_string(&path).unwrap();
        let (start, end) = bot_object_bounds(&flipped, "alpha").unwrap();
        let alpha = &flipped[start..end];
        assert!(alpha.contains("\"plan_mode\": true"), "{alpha}");
        assert!(alpha.find("\"color\"").unwrap() < alpha.find("\"plan_mode\"").unwrap());
        assert!(alpha.find("\"plan_mode\"").unwrap() < alpha.find("\"enabled\"").unwrap());
        let (start, end) = bot_object_bounds(&flipped, "beta").unwrap();
        assert_eq!(&flipped[start..end], beta_on);
        assert!(load(&path).unwrap().bots[1].plan_mode);
        let _ = fs::remove_dir_all(&dir);
    }
}
