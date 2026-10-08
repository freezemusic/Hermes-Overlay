#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SseEvent {
    pub event: String,
    pub data: String,
}

/// Split complete SSE frames from `buf`. The returned string is the incomplete tail.
pub fn drain(buf: &str) -> (Vec<SseEvent>, String) {
    let mut events = Vec::new();
    let mut rest = buf;
    while let Some((block, next)) = split_frame(rest) {
        rest = next;
        if let Some(event) = parse_block(block) {
            events.push(event);
        }
    }
    (events, rest.to_string())
}

fn split_frame(input: &str) -> Option<(&str, &str)> {
    let nn = input.find("\n\n");
    let rn = input.find("\r\n\r\n");
    match (nn, rn) {
        (Some(a), Some(b)) if b < a => Some((&input[..b], &input[b + 4..])),
        (Some(a), Some(_)) => Some((&input[..a], &input[a + 2..])),
        (Some(a), None) => Some((&input[..a], &input[a + 2..])),
        (None, Some(b)) => Some((&input[..b], &input[b + 4..])),
        (None, None) => None,
    }
}

fn parse_block(block: &str) -> Option<SseEvent> {
    let mut event = String::new();
    let mut data_lines: Vec<String> = Vec::new();
    for raw in block.split('\n') {
        let line = raw.trim_end_matches('\r');
        if line.is_empty() || line.starts_with(':') {
            continue;
        }
        if let Some(rest) = line.strip_prefix("event:") {
            event = rest.trim().to_string();
        } else if let Some(rest) = line.strip_prefix("data:") {
            let rest = rest.strip_prefix(' ').unwrap_or(rest);
            data_lines.push(rest.to_string());
        }
    }
    if event.is_empty() && data_lines.is_empty() {
        return None;
    }
    if event.is_empty() {
        event = "message".into();
    }
    Some(SseEvent {
        event,
        data: data_lines.join("\n"),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_named_events_and_skips_keepalive() {
        let raw = "\
: keepalive\n\n\
event: assistant.delta\n\
data: {\"delta\":\"你\"}\n\n\
event: tool.started\n\
data: {\"tool_name\":\"terminal\",\"preview\":\"ls\"}\n\n\
event: run.completed\n\
data: {\"completed\":true}\n\n";
        let (events, tail) = drain(raw);
        assert!(tail.is_empty());
        assert_eq!(events.len(), 3);
        assert_eq!(events[0].event, "assistant.delta");
        assert_eq!(events[0].data, "{\"delta\":\"你\"}");
        assert_eq!(events[1].event, "tool.started");
        assert_eq!(events[2].event, "run.completed");
    }

    #[test]
    fn keeps_partial_frame() {
        let (events, tail) = drain("event: assistant.delta\ndata: {\"delta\":\"a\"}");
        assert!(events.is_empty());
        assert!(tail.contains("assistant.delta"));
        let (events, tail) = drain(&format!("{tail}\n\n"));
        assert_eq!(events.len(), 1);
        assert!(tail.is_empty());
    }

    #[test]
    fn crlf_frames() {
        let raw = "event: run.failed\r\ndata: {\"error\":\"nope\"}\r\n\r\n";
        let (events, tail) = drain(raw);
        assert!(tail.is_empty());
        assert_eq!(events[0].event, "run.failed");
        assert_eq!(events[0].data, "{\"error\":\"nope\"}");
    }
}
