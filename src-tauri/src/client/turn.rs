//! Map `/api/ws` events for one live session onto the overlay's [`TurnEvent`]s.
//! Pure, so the order rules are unit-tested without a server.
//!
//! Order on 0.22.5 (box, hybrid-9119/exp/p3.py):
//! `prompt.submit` → `{status: streaming|queued}`; then `message.start`,
//! `message.delta*`, `tool.start` / `tool.complete`, `message.complete {text, status?}`.
//! A queued send first sees the other client's turn finish (`message.complete`),
//! then its own `message.start`.

use super::endpoints::{event, server_request};
use crate::hermes::TurnEvent;
use serde_json::Value;

#[derive(Debug, Clone, PartialEq)]
pub enum Step {
    Emit(Vec<TurnEvent>),
    /// Our turn ended. `failed` carries the line for an error turn.
    Done { events: Vec<TurnEvent>, failed: Option<String> },
    Ignore,
}

pub struct TurnMapper {
    pub run_id: String,
    pub live_sid: String,
    /// Waiting behind another client's turn (or our own queued one).
    pub waiting: bool,
    /// Say 「手機嗰邊行緊，排緊隊」 while waiting (R-ST-05 on 9119).
    pub hint: bool,
    pub started: bool,
    /// Open clarify request id → question ids (for `request.cancel`).
    clarify: Vec<(String, Vec<String>)>,
    approvals: Vec<String>,
}

fn text(value: &Value, key: &str) -> String {
    value.get(key).and_then(Value::as_str).unwrap_or("").to_string()
}

/// `run_ws_<live sid>_<row>`: passes `hermes::approval_run_id` (alnum + `_`).
pub fn run_id_for(live_sid: &str, row: &str) -> String {
    let clean = |raw: &str| -> String { raw.chars().filter(|c| c.is_ascii_alphanumeric()).collect() };
    format!("run_ws_{}_{}", clean(live_sid), clean(row))
}

/// The live sid inside a [`run_id_for`] id.
pub fn live_sid_of(run_id: &str) -> Option<String> {
    let rest = run_id.strip_prefix("run_ws_")?;
    let (sid, _) = rest.split_once('_')?;
    (!sid.is_empty()).then(|| sid.to_string())
}

/// Clarify prompt ids carry the question: `<request id>~<qid>`.
pub fn clarify_prompt_id(request_id: &str, qid: &str) -> String {
    format!("{request_id}~{qid}")
}

pub fn split_clarify_prompt_id(prompt_id: &str) -> Option<(String, String)> {
    let (request, qid) = prompt_id.split_once('~')?;
    (!request.is_empty() && !qid.is_empty()).then(|| (request.to_string(), qid.to_string()))
}

impl TurnMapper {
    pub fn new(run_id: String, live_sid: String, submit_status: &str, hint: bool) -> Self {
        let waiting = submit_status.trim() != "streaming";
        Self {
            run_id,
            live_sid,
            waiting,
            hint,
            started: !waiting,
            clarify: Vec::new(),
            approvals: Vec::new(),
        }
    }

    /// Events to emit right after the submit was accepted.
    pub fn opening(&self) -> Vec<TurnEvent> {
        let mut out = vec![TurnEvent::Started { run_id: self.run_id.clone() }];
        if self.waiting && self.hint {
            out.push(TurnEvent::QueueElsewhere(true));
        }
        out
    }

    pub fn on_event(&mut self, kind: &str, session_id: &str, payload: &Value) -> Step {
        if session_id != self.live_sid && kind != event::REQUEST_CANCEL {
            return Step::Ignore;
        }
        if self.waiting {
            // The turn ahead of ours: let it pass.
            if kind == event::MESSAGE_COMPLETE || kind == event::ERROR {
                self.waiting = false;
                return Step::Ignore;
            }
            if kind != event::MESSAGE_START {
                return Step::Ignore;
            }
        }
        match kind {
            event::MESSAGE_START => {
                if self.started {
                    return Step::Ignore;
                }
                self.started = true;
                self.waiting = false;
                if self.hint {
                    Step::Emit(vec![TurnEvent::QueueElsewhere(false)])
                } else {
                    Step::Ignore
                }
            }
            event::MESSAGE_DELTA => {
                let delta = text(payload, "text");
                if delta.is_empty() {
                    Step::Ignore
                } else {
                    Step::Emit(vec![TurnEvent::Delta(delta)])
                }
            }
            event::TOOL_START | event::TOOL_PROGRESS | event::TOOL_COMPLETE => {
                let phase = match kind {
                    event::TOOL_START => "started",
                    event::TOOL_PROGRESS => "progress",
                    _ => {
                        let failed = payload
                            .pointer("/result/error")
                            .map(|v| !v.is_null() && v.as_str() != Some(""))
                            .unwrap_or(false);
                        if failed { "failed" } else { "completed" }
                    }
                };
                let preview = {
                    let context = text(payload, "context");
                    if context.is_empty() { text(payload, "preview") } else { context }
                };
                Step::Emit(vec![TurnEvent::Tool {
                    phase: phase.into(),
                    name: text(payload, "name"),
                    preview,
                }])
            }
            event::MESSAGE_COMPLETE => {
                let status = text(payload, "status");
                let failed = (status == "error").then(|| text(payload, "text"));
                Step::Done {
                    events: vec![TurnEvent::Finished {
                        outcome: if failed.is_some() { "failed".into() } else { "completed".into() },
                        detail: String::new(),
                        run_id: self.run_id.clone(),
                    }],
                    failed,
                }
            }
            event::ERROR => {
                let message = text(payload, "message");
                Step::Done { events: Vec::new(), failed: Some(message) }
            }
            event::REQUEST_CANCEL => {
                let id = text(payload, "id");
                let mut out = Vec::new();
                if let Some(pos) = self.approvals.iter().position(|have| have == &id) {
                    self.approvals.remove(pos);
                    out.push(TurnEvent::ControlSettled { kind: "approval".into(), prompt_id: id.clone() });
                }
                if let Some(pos) = self.clarify.iter().position(|(have, _)| have == &id) {
                    let (_, qids) = self.clarify.remove(pos);
                    for qid in qids {
                        out.push(TurnEvent::ControlSettled {
                            kind: "clarify".into(),
                            prompt_id: clarify_prompt_id(&id, &qid),
                        });
                    }
                }
                if out.is_empty() { Step::Ignore } else { Step::Emit(out) }
            }
            _ => Step::Ignore,
        }
    }

    /// A server-to-client request (approval / clarify) for our session.
    pub fn on_request(&mut self, id: &str, method: &str, params: &Value) -> Step {
        if text(params, "session_id") != self.live_sid {
            return Step::Ignore;
        }
        match method {
            server_request::APPROVAL => {
                self.approvals.push(id.to_string());
                let description = {
                    let d = text(params, "description");
                    if d.is_empty() { text(params, "pattern_key") } else { d }
                };
                Step::Emit(vec![TurnEvent::ApprovalRequest {
                    run_id: self.run_id.clone(),
                    request_id: id.to_string(),
                    description,
                    command: text(params, "command"),
                    execution_generation: None,
                }])
            }
            server_request::CLARIFY => {
                let questions = params
                    .get("questions")
                    .and_then(Value::as_array)
                    .cloned()
                    .unwrap_or_default();
                let mut out = Vec::new();
                let mut qids = Vec::new();
                for q in questions {
                    let qid = text(&q, "qid");
                    if qid.is_empty() {
                        continue;
                    }
                    let choices = q
                        .get("choices")
                        .and_then(Value::as_array)
                        .map(|items| {
                            items
                                .iter()
                                .filter_map(Value::as_str)
                                .map(|c| c.trim_end_matches(" (Recommended)").to_string())
                                .collect()
                        })
                        .unwrap_or_default();
                    out.push(TurnEvent::ClarifyRequest {
                        run_id: self.run_id.clone(),
                        prompt_id: clarify_prompt_id(id, &qid),
                        question: text(&q, "question"),
                        choices,
                        multi_select: q.get("multi_select").and_then(Value::as_bool).unwrap_or(false),
                        execution_generation: 0,
                        timeout_s: None,
                    });
                    qids.push(qid);
                }
                self.clarify.push((id.to_string(), qids));
                if out.is_empty() { Step::Ignore } else { Step::Emit(out) }
            }
            _ => Step::Ignore,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn mapper(status: &str) -> TurnMapper {
        TurnMapper::new(run_id_for("ab12", "7"), "ab12".into(), status, true)
    }

    #[test]
    fn run_ids_round_trip_and_pass_the_run_id_check() {
        let id = run_id_for("5a73-76a2", "99");
        assert_eq!(id, "run_ws_5a7376a2_99");
        assert!(crate::hermes::approval_run_id(&id).is_some());
        assert_eq!(live_sid_of(&id).as_deref(), Some("5a7376a2"));
        assert_eq!(live_sid_of("run_abc"), None);
        assert_eq!(split_clarify_prompt_id("srq-1~q0"), Some(("srq-1".into(), "q0".into())));
    }

    #[test]
    fn a_streaming_send_maps_deltas_tools_and_completion() {
        let mut m = mapper("streaming");
        assert_eq!(m.opening(), vec![TurnEvent::Started { run_id: "run_ws_ab12_7".into() }]);
        assert_eq!(m.on_event("message.start", "ab12", &Value::Null), Step::Ignore);
        assert_eq!(m.on_event("message.delta", "ab12", &json!({"text": "hi"})), Step::Emit(vec![TurnEvent::Delta("hi".into())]));
        assert_eq!(m.on_event("message.delta", "zz99", &json!({"text": "other"})), Step::Ignore);
        assert!(matches!(m.on_event("tool.start", "ab12", &json!({"name": "terminal", "context": "ls"})),
            Step::Emit(ref v) if matches!(&v[0], TurnEvent::Tool { phase, preview, .. } if phase == "started" && preview == "ls")));
        assert!(matches!(m.on_event("tool.complete", "ab12", &json!({"name": "terminal", "result": {"error": "BLOCKED"}})),
            Step::Emit(ref v) if matches!(&v[0], TurnEvent::Tool { phase, .. } if phase == "failed")));
        assert!(matches!(m.on_event("message.complete", "ab12", &json!({"text": "hi"})), Step::Done { failed: None, .. }));
    }

    #[test]
    fn a_queued_send_skips_the_turn_ahead_and_says_the_phone_line() {
        let mut m = mapper("queued");
        assert_eq!(m.opening().last(), Some(&TurnEvent::QueueElsewhere(true)));
        // Phone's turn still streaming, then completing: none of it is ours.
        assert_eq!(m.on_event("message.delta", "ab12", &json!({"text": "phone"})), Step::Ignore);
        assert_eq!(m.on_event("message.complete", "ab12", &json!({"text": "phone done"})), Step::Ignore);
        assert_eq!(m.on_event("message.start", "ab12", &Value::Null), Step::Emit(vec![TurnEvent::QueueElsewhere(false)]));
        assert_eq!(m.on_event("message.delta", "ab12", &json!({"text": "ours"})), Step::Emit(vec![TurnEvent::Delta("ours".into())]));
    }

    #[test]
    fn approvals_and_clarify_become_cards_and_cancel_settles_them() {
        let mut m = mapper("streaming");
        let step = m.on_request("srq-a", "approval", &json!({"session_id": "ab12", "command": "rm -rf x", "description": "delete"}));
        assert!(matches!(step, Step::Emit(ref v) if matches!(&v[0], TurnEvent::ApprovalRequest { request_id, command, .. } if request_id == "srq-a" && command == "rm -rf x")));
        let step = m.on_request("srq-c", "clarify", &json!({"session_id": "ab12", "questions": [{"qid": "q0", "question": "Fruit?", "choices": ["Apple (Recommended)", "Banana"]}]}));
        assert!(matches!(step, Step::Emit(ref v) if matches!(&v[0], TurnEvent::ClarifyRequest { prompt_id, choices, .. } if prompt_id == "srq-c~q0" && choices[0] == "Apple")));
        assert_eq!(m.on_event("request.cancel", "", &json!({"id": "srq-a"})),
            Step::Emit(vec![TurnEvent::ControlSettled { kind: "approval".into(), prompt_id: "srq-a".into() }]));
        assert_eq!(m.on_event("request.cancel", "", &json!({"id": "srq-c"})),
            Step::Emit(vec![TurnEvent::ControlSettled { kind: "clarify".into(), prompt_id: "srq-c~q0".into() }]));
        assert_eq!(m.on_request("srq-x", "approval", &json!({"session_id": "other"})), Step::Ignore);
    }

    #[test]
    fn a_batch_clarify_emits_one_card_per_question() {
        let mut m = mapper("streaming");
        let step = m.on_request(
            "srq-batch",
            "clarify",
            &json!({
                "session_id": "ab12",
                "questions": [
                    {"qid": "q0", "question": "Time?", "choices": ["Unknown"]},
                    {"qid": "q1", "question": "City?", "choices": ["HK", "GZ"]},
                    {"qid": "q2", "question": "Sex?", "choices": ["M", "F"]}
                ]
            }),
        );
        match step {
            Step::Emit(ref v) => {
                assert_eq!(v.len(), 3);
                assert!(matches!(&v[0], TurnEvent::ClarifyRequest { prompt_id, question, .. }
                    if prompt_id == "srq-batch~q0" && question == "Time?"));
                assert!(matches!(&v[1], TurnEvent::ClarifyRequest { prompt_id, .. } if prompt_id == "srq-batch~q1"));
                assert!(matches!(&v[2], TurnEvent::ClarifyRequest { prompt_id, .. } if prompt_id == "srq-batch~q2"));
            }
            other => panic!("expected Emit, got {other:?}"),
        }
    }


    #[test]
    fn an_error_event_ends_the_turn_as_failed() {
        let mut m = mapper("streaming");
        assert!(matches!(m.on_event("error", "ab12", &json!({"message": "boom"})), Step::Done { failed: Some(ref t), .. } if t == "boom"));
    }
}

/// What a typed line starting with `/` becomes on the dashboard. Hermes 0.22.5
/// `prompt.submit` does not read slash commands (box p10: `/plan …` and
/// `/btw …` reached the model as plain text), so the client routes them.
#[derive(Debug, Clone, PartialEq)]
pub enum Slash {
    /// Not a command: submit as typed.
    Plain,
    /// `/btw question` → `prompt.btw`, answer in `btw.complete`, not stored.
    Btw(String),
    /// Anything else → `command.dispatch {name, arg}` (falls back to `slash.exec`).
    Command { name: String, arg: String },
}

pub fn classify_slash(text: &str) -> Slash {
    let line = text.trim();
    let Some(rest) = line.strip_prefix('/') else {
        return Slash::Plain;
    };
    let mut parts = rest.splitn(2, char::is_whitespace);
    let name = parts.next().unwrap_or_default().trim().to_ascii_lowercase();
    let arg = parts.next().unwrap_or_default().trim().to_string();
    if name.is_empty() || name.contains('/') {
        return Slash::Plain;
    }
    if name == "btw" {
        return Slash::Btw(arg);
    }
    Slash::Command { name, arg }
}

/// `command.dispatch` / `slash.exec` result → a message to submit, or text to show.
///
/// Hermes 0.22.5 skills (`tui_gateway/methods_tools.py` `_dispatch_skill`) return
/// `{type: "skill", message, display}`. `message` is the expanded skill body and
/// must be `prompt.submit`ted like `send`. `display` is the user-bubble projection
/// (`/renew`), never rendered as an assistant reply. Bundles use `type: "send"`
/// with the same `display` field.
#[derive(Debug, Clone, PartialEq)]
pub enum Dispatched {
    /// Submit `message`. `display` is the bubble override when non-empty.
    Send { message: String, display: String },
    Show(String),
}

/// Bubble text from a dispatch `display`. `None` keeps the line the composer
/// already painted (typed `/renew …`, or the plan/btw chip). Never the skill body.
pub fn bubble_override(display: &str) -> Option<String> {
    let shown = display.trim();
    if shown.is_empty() {
        None
    } else {
        Some(shown.to_string())
    }
}

pub fn dispatched(result: &Value) -> Dispatched {
    let kind = text_of(result.get("type"));
    let message = text_of(result.get("message"));
    // `skill` with a body is a send. An empty body is not submitted and is not
    // painted as an assistant reply (Desktop: "skill payload missing message").
    if (kind == "send" || kind == "skill") && !message.trim().is_empty() {
        return Dispatched::Send {
            message,
            display: text_of(result.get("display")).trim().to_string(),
        };
    }
    let output = text_of(result.get("output"));
    let notice = text_of(result.get("notice"));
    let shown = [
        output,
        notice,
        if kind == "send" || kind == "skill" { String::new() } else { message },
    ]
    .into_iter()
    .find(|t| !t.trim().is_empty())
    .unwrap_or_else(|| "（冇輸出）".into());
    Dispatched::Show(shown)
}

fn text_of(value: Option<&Value>) -> String {
    value.and_then(Value::as_str).unwrap_or_default().to_string()
}

#[cfg(test)]
mod slash_tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn plan_and_btw_are_routed_not_sent_as_text() {
        assert_eq!(classify_slash("hello"), Slash::Plain);
        assert_eq!(classify_slash("/btw what is 2+2"), Slash::Btw("what is 2+2".into()));
        assert_eq!(
            classify_slash("/plan write a list"),
            Slash::Command { name: "plan".into(), arg: "write a list".into() }
        );
        assert_eq!(classify_slash("/usr/bin is a path"), Slash::Plain);
        assert_eq!(
            dispatched(&json!({"type": "send", "message": "[/plan — plan mode] x"})),
            Dispatched::Send { message: "[/plan — plan mode] x".into(), display: String::new() }
        );
        assert_eq!(dispatched(&json!({"type": "exec", "output": "ok"})), Dispatched::Show("ok".into()));
    }

    #[test]
    fn skill_dispatch_submits_the_body_and_keeps_display() {
        let body = "[IMPORTANT: The user has invoked the \"renew\" skill, indicating they want you to follow its instructions. The full skill content is loaded below.]\n\nSKILL";
        assert_eq!(
            dispatched(&json!({"type": "skill", "message": body, "display": "/renew"})),
            Dispatched::Send { message: body.into(), display: "/renew".into() }
        );
        assert_eq!(
            dispatched(&json!({"type": "skill", "message": body, "name": "renew", "display": "  /renew 舊題  "})),
            Dispatched::Send { message: body.into(), display: "/renew 舊題".into() }
        );
        assert_eq!(
            dispatched(&json!({"type": "send", "message": "bundle body", "notice": "Loading", "display": "/clean /work"})),
            Dispatched::Send { message: "bundle body".into(), display: "/clean /work".into() }
        );
        assert_eq!(bubble_override("/renew"), Some("/renew".into()));
        assert_eq!(bubble_override("  "), None);
        assert_eq!(bubble_override(""), None);
    }

    #[test]
    fn an_empty_skill_message_is_not_submitted_or_shown_as_the_body() {
        assert_eq!(
            dispatched(&json!({"type": "skill", "message": "  ", "display": "/renew"})),
            Dispatched::Show("（冇輸出）".into())
        );
        assert_eq!(
            dispatched(&json!({"type": "skill", "message": "", "output": "missing"})),
            Dispatched::Show("missing".into())
        );
        assert_eq!(
            dispatched(&json!({"type": "send", "message": ""})),
            Dispatched::Show("（冇輸出）".into())
        );
        let shown = dispatched(&json!({"type": "skill", "message": "   ", "notice": "no skill"}));
        assert_eq!(shown, Dispatched::Show("no skill".into()));
    }
}
