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

/// Incremental UTF-8 + SSE decoder. A multi-byte character split across chunks
/// stays in `pending` until the rest arrives, instead of becoming U+FFFD.
pub struct ByteBuf {
    pending: Vec<u8>,
    text: String,
}

impl ByteBuf {
    pub fn new() -> Self {
        Self {
            pending: Vec::new(),
            text: String::new(),
        }
    }

    pub fn push(&mut self, bytes: &[u8]) -> Vec<SseEvent> {
        push_utf8(&mut self.pending, &mut self.text, bytes);
        self.drain_ready()
    }

    pub fn finish(&mut self) -> Vec<SseEvent> {
        if !self.pending.is_empty() {
            self.text.push_str(&String::from_utf8_lossy(&self.pending));
            self.pending.clear();
        }
        self.drain_ready()
    }

    fn drain_ready(&mut self) -> Vec<SseEvent> {
        let (events, rest) = drain(&self.text);
        self.text = rest;
        events
    }
}

pub fn push_utf8(pending: &mut Vec<u8>, buf: &mut String, bytes: &[u8]) {
    pending.extend_from_slice(bytes);
    loop {
        if pending.is_empty() {
            return;
        }
        match std::str::from_utf8(pending) {
            Ok(text) => {
                buf.push_str(text);
                pending.clear();
                return;
            }
            Err(err) => {
                let valid = err.valid_up_to();
                if valid > 0 {
                    buf.push_str(
                        std::str::from_utf8(&pending[..valid]).expect("valid utf-8 prefix"),
                    );
                    pending.drain(..valid);
                    continue;
                }
                match err.error_len() {
                    Some(bad) => {
                        buf.push_str(&String::from_utf8_lossy(&pending[..bad]));
                        pending.drain(..bad);
                    }
                    None => return,
                }
            }
        }
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
    fn split_multibyte_utf8_does_not_become_replacement_char() {
        let frame = "event: assistant.delta\ndata: {\"delta\":\"你好\"}\n\n";
        let bytes = frame.as_bytes();
        let split = bytes.iter().position(|b| *b == 0xE4).unwrap() + 1;
        let mut decoder = ByteBuf::new();
        let first = decoder.push(&bytes[..split]);
        assert!(first.is_empty(), "incomplete character must not decode yet");
        let second = decoder.push(&bytes[split..]);
        assert_eq!(second.len(), 1);
        assert!(second[0].data.contains("你好"));
        assert!(!second[0].data.contains('\u{FFFD}'));
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
