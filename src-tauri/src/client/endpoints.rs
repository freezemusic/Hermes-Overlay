//! Every path and JSON-RPC method the overlay uses on Hermes, in one place.
//! The chat runs on the dashboard server (`hermes serve`). Its address comes
//! from Settings (`kanban_base_url`, labelled 「Kanban server」); an empty field
//! is the config default, [`crate::config::default_dashboard_origin`]. The old
//! gateway API server is not used at all (R-AR-04).

/// REST on the dashboard server. Profile is the `?profile=` query.
pub mod rest {
    pub const HEALTH: &str = "/api/health";
    pub const PROFILES: &str = "/api/profiles";
    pub const SESSIONS: &str = "/api/sessions";
    pub const WS_TICKET: &str = "/api/auth/ws-ticket";
    pub const CRON_JOBS: &str = "/api/cron/jobs";
    pub const WS: &str = "/api/ws";

    pub fn session(id: &str) -> String {
        format!("{SESSIONS}/{}", super::escape(id))
    }

    pub fn session_messages(id: &str) -> String {
        format!("{SESSIONS}/{}/messages", super::escape(id))
    }

    /// Kanban dashboard plugin (`plugins/kanban/dashboard/plugin_api.py`).
    /// `?board=<slug>` picks a board; without it the server uses its current one.
    pub const KANBAN_BOARD: &str = "/api/plugins/kanban/board";
    pub const KANBAN_BOARDS: &str = "/api/plugins/kanban/boards";
    pub const KANBAN_TASKS: &str = "/api/plugins/kanban/tasks";

    /// `GET` reads a card; `PATCH` moves it (`{"status": …}`, Hermes 0.22.5).
    pub fn kanban_task(id: &str) -> String {
        format!("{KANBAN_TASKS}/{}", super::escape(id))
    }
}

/// Dashboard login (`hermes_cli/dashboard_auth`). Not under `/api/`.
pub mod auth {
    /// Basic login: `{"provider":"basic","username","password"}` → session cookie.
    pub const PASSWORD_LOGIN: &str = "/auth/password-login";
    /// Native PKCE: the system browser opens this; the code comes back on loopback.
    pub const NATIVE_AUTHORIZE: &str = "/auth/native/authorize";
    pub const NATIVE_TOKEN: &str = "/auth/native/token";
    pub const NATIVE_REFRESH: &str = "/auth/native/refresh";
}

/// JSON-RPC methods on `/api/ws` (tui_gateway, Hermes 0.22.5).
pub mod rpc {
    pub const CAPABILITIES: &str = "client.capabilities";
    pub const PING: &str = "ping";
    pub const SESSION_CREATE: &str = "session.create";
    pub const SESSION_BRANCH: &str = "session.branch_stored";
    pub const SESSION_RESUME: &str = "session.resume";
    pub const SESSION_TITLE: &str = "session.title";
    pub const SESSION_ARCHIVE: &str = "session.archive";
    pub const SESSION_LIST: &str = "session.list";
    /// In-memory sessions only. Does not create one (unlike `session.resume`).
    pub const SESSION_ACTIVE_LIST: &str = "session.active_list";
    /// Reconnect snapshot. `open_requests` is the unanswered clarify / approval list.
    pub const SESSION_EVENTS_SINCE: &str = "session.events.since";
    pub const SESSION_INTERRUPT: &str = "session.interrupt";
    pub const PROMPT_SUBMIT: &str = "prompt.submit";
    pub const CLARIFY_LOCK: &str = "clarify.lock";
    pub const COMPLETE_SLASH: &str = "complete.slash";
    pub const MODEL_OPTIONS: &str = "model.options";
    pub const CONFIG_SET: &str = "config.set";
    pub const PROMPT_BTW: &str = "prompt.btw";
    pub const SESSION_STEER: &str = "session.steer";
    pub const COMMAND_DISPATCH: &str = "command.dispatch";
    pub const SLASH_EXEC: &str = "slash.exec";
}

/// Server-to-client request methods the overlay answers.
pub mod server_request {
    pub const APPROVAL: &str = "approval";
    pub const CLARIFY: &str = "clarify";
}

/// Event names (`{"method":"event","params":{"type":…}}`).
pub mod event {
    pub const READY: &str = "gateway.ready";
    pub const MESSAGE_START: &str = "message.start";
    pub const MESSAGE_DELTA: &str = "message.delta";
    pub const MESSAGE_COMPLETE: &str = "message.complete";
    pub const TOOL_START: &str = "tool.start";
    pub const TOOL_PROGRESS: &str = "tool.progress";
    pub const TOOL_COMPLETE: &str = "tool.complete";
    pub const ERROR: &str = "error";
    pub const REQUEST_CANCEL: &str = "request.cancel";
    pub const SESSIONS_CHANGED: &str = "sessions.changed";
    pub const BTW_COMPLETE: &str = "btw.complete";
}

pub fn escape(raw: &str) -> String {
    let mut out = String::new();
    for byte in raw.trim().bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(byte as char),
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

/// `?profile=` plus extra pairs, escaped.
pub fn query(profile: &str, pairs: &[(&str, &str)]) -> String {
    let mut parts: Vec<String> = pairs
        .iter()
        .map(|(key, value)| format!("{key}={}", escape(value)))
        .collect();
    if !profile.trim().is_empty() {
        parts.push(format!("profile={}", escape(profile)));
    }
    if parts.is_empty() {
        String::new()
    } else {
        format!("?{}", parts.join("&"))
    }
}

/// `http(s)://host:port` → `ws(s)://host:port/api/ws?ticket=…`.
pub fn ws_url(origin: &str, ticket: &str) -> String {
    let origin = origin.trim().trim_end_matches('/');
    let base = if let Some(rest) = origin.strip_prefix("https://") {
        format!("wss://{rest}")
    } else if let Some(rest) = origin.strip_prefix("http://") {
        format!("ws://{rest}")
    } else {
        format!("ws://{origin}")
    };
    format!("{base}{}?ticket={}", rest::WS, escape(ticket))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn paths_and_queries_are_escaped() {
        assert_eq!(rest::session_messages("a b/c"), "/api/sessions/a%20b%2Fc/messages");
        assert_eq!(query("mt-orch", &[("limit", "100")]), "?limit=100&profile=mt-orch");
        assert_eq!(query("", &[]), "");
    }

    #[test]
    fn kanban_and_login_paths_live_here() {
        assert_eq!(rest::kanban_task("t_1 x"), "/api/plugins/kanban/tasks/t_1%20x");
        assert_eq!(rest::KANBAN_BOARD, "/api/plugins/kanban/board");
        assert_eq!(rest::KANBAN_BOARDS, "/api/plugins/kanban/boards");
        assert_eq!(auth::PASSWORD_LOGIN, "/auth/password-login");
        assert_eq!(auth::NATIVE_REFRESH, "/auth/native/refresh");
    }

    #[test]
    fn ws_url_follows_the_origin_scheme() {
        assert_eq!(ws_url("http://10.0.0.1:9119/", "t1"), "ws://10.0.0.1:9119/api/ws?ticket=t1");
        assert_eq!(ws_url("https://h.example/x", "t"), "wss://h.example/x/api/ws?ticket=t");
    }
}
