//! Chat attachments over `/api/ws` (R-AT-01 … R-AT-04).
//!
//! Hermes Desktop (`bf0203a`, `use-prompt-actions/index.ts`
//! `uploadComposerAttachment`) stages attachments on the live session before
//! `prompt.submit`: images with `image.attach_bytes {session_id,
//! content_base64, filename}` (queued in `attached_images`, consumed by the
//! next turn), other files with `file.attach {session_id, name, data_url}`
//! (returns `ref_text`, an `@file:` ref the prompt text carries). The server is
//! remote, so the overlay always sends bytes; it never sends a laptop path and
//! never calls the gateway's `clipboard.paste`.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

/// Per-file cap (decoded bytes). Base64 of this is ~13.4 MB, under the 16 MiB
/// WebSocket frame older dashboards accept. Same number as `src/attach.js`.
pub const ATTACH_MAX_BYTES: usize = 10 * 1024 * 1024;
/// Attachments per message.
pub const ATTACH_MAX_FILES: usize = 10;

pub const IMAGE_ATTACH_BYTES: &str = "image.attach_bytes";
pub const FILE_ATTACH: &str = "file.attach";
pub const IMAGE_DETACH: &str = "image.detach";

/// One chip from the page. `data` is base64 without the `data:` prefix.
#[derive(Debug, Clone, Deserialize)]
pub struct AttachIn {
    pub kind: String,
    pub name: String,
    #[serde(default)]
    pub mime: String,
    pub data: String,
}

/// One staged attachment. Images carry the server `path` (for rollback);
/// files carry `ref_text` for the prompt.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct AttachOut {
    pub kind: String,
    pub name: String,
    pub path: String,
    pub ref_text: String,
}

/// Why the batch stopped. `index` names the chip the server refused.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct AttachFailure {
    pub index: Option<usize>,
    pub message: String,
}

pub fn is_image(item: &AttachIn) -> bool {
    item.kind == "image"
}

/// Decoded size of a base64 string (no padding errors counted).
pub fn decoded_len(b64: &str) -> usize {
    let trimmed = b64.trim_end_matches('=');
    let n = trimmed.chars().filter(|c| !c.is_whitespace()).count();
    n * 3 / 4
}

fn clean_name(name: &str) -> String {
    let base = name.rsplit(['/', '\\']).next().unwrap_or("").trim();
    if base.is_empty() { "attachment".into() } else { base.chars().take(200).collect() }
}

/// Refuse the whole batch before any upload (the page checks the same).
pub fn check_batch(items: &[AttachIn]) -> Result<(), String> {
    if items.is_empty() {
        return Err("冇附件".into());
    }
    if items.len() > ATTACH_MAX_FILES {
        return Err(format!("最多 {ATTACH_MAX_FILES} 個附件"));
    }
    for item in items {
        let name = clean_name(&item.name);
        let size = decoded_len(&item.data);
        if size == 0 {
            return Err(format!("「{name}」係空檔案"));
        }
        if size > ATTACH_MAX_BYTES {
            return Err(format!("「{name}」太大，每個附件上限 10 MB"));
        }
    }
    Ok(())
}

/// JSON-RPC (method, params) for one item on live session `live`.
pub fn attach_call(live: &str, item: &AttachIn) -> (&'static str, Value) {
    let name = clean_name(&item.name);
    if is_image(item) {
        (IMAGE_ATTACH_BYTES, json!({"session_id": live, "content_base64": item.data, "filename": name}))
    } else {
        let mime = if item.mime.trim().is_empty() { "application/octet-stream" } else { item.mime.trim() };
        (FILE_ATTACH, json!({"session_id": live, "name": name, "data_url": format!("data:{mime};base64,{}", item.data)}))
    }
}

/// Server reply → [`AttachOut`], or the server's own reason.
pub fn attach_result(item: &AttachIn, value: &Value) -> Result<AttachOut, String> {
    let name = clean_name(&item.name);
    let attached = value.get("attached").and_then(Value::as_bool).unwrap_or(false);
    let message = value.get("message").and_then(Value::as_str).unwrap_or("").to_string();
    if !attached {
        return Err(if message.is_empty() { format!("「{name}」上載唔到") } else { message });
    }
    let path = value.get("path").and_then(Value::as_str).unwrap_or("").to_string();
    if is_image(item) {
        return Ok(AttachOut { kind: "image".into(), name, path, ref_text: String::new() });
    }
    let ref_text = value.get("ref_text").and_then(Value::as_str).unwrap_or("").to_string();
    if ref_text.is_empty() {
        return Err(if message.is_empty() { format!("「{name}」上載唔到") } else { message });
    }
    Ok(AttachOut { kind: "file".into(), name, path, ref_text })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(kind: &str, name: &str, data: &str) -> AttachIn {
        AttachIn { kind: kind.into(), name: name.into(), mime: "application/pdf".into(), data: data.into() }
    }

    #[test]
    fn r_at_02_images_use_attach_bytes_and_files_use_file_attach_with_a_data_url() {
        let (method, params) = attach_call("live1", &item("image", "C:\\Users\\d\\shot.png", "iVBORw0KGgo="));
        assert_eq!(method, "image.attach_bytes");
        assert_eq!(params, json!({"session_id": "live1", "content_base64": "iVBORw0KGgo=", "filename": "shot.png"}));
        let (method, params) = attach_call("live1", &item("file", "spec.pdf", "JVBERi0="));
        assert_eq!(method, "file.attach");
        assert_eq!(params, json!({"session_id": "live1", "name": "spec.pdf", "data_url": "data:application/pdf;base64,JVBERi0="}));
        assert!(params.get("path").is_none(), "never a laptop path: the server is remote");
    }

    #[test]
    fn r_at_03_limits_are_ten_files_of_ten_mb() {
        assert!(check_batch(&[]).is_err());
        assert!(check_batch(&[item("file", "a.txt", "aGk=")]).is_ok());
        let many: Vec<AttachIn> = (0..11).map(|i| item("file", &format!("{i}.txt"), "aGk=")).collect();
        assert_eq!(check_batch(&many).unwrap_err(), "最多 10 個附件");
        let big = "A".repeat((ATTACH_MAX_BYTES / 3 + 2) * 4);
        assert!(check_batch(&[item("file", "big.bin", &big)]).unwrap_err().contains("太大"));
        let ok = "A".repeat(ATTACH_MAX_BYTES / 3 * 4);
        assert!(check_batch(&[item("file", "ok.bin", &ok)]).is_ok());
        assert!(check_batch(&[item("file", "e.txt", "")]).unwrap_err().contains("空檔案"));
    }

    #[test]
    fn r_at_02_replies_map_to_refs_or_the_server_reason() {
        let file = item("file", "spec.pdf", "JVBERi0=");
        let ok = attach_result(&file, &json!({"attached": true, "path": "/h/attachments/spec.pdf", "ref_text": "@file:attachments/spec.pdf"})).unwrap();
        assert_eq!(ok.ref_text, "@file:attachments/spec.pdf");
        let img = item("image", "a.png", "iVBO");
        let ok = attach_result(&img, &json!({"attached": true, "path": "/h/images/upload_1.png", "count": 1})).unwrap();
        assert_eq!((ok.kind.as_str(), ok.path.as_str(), ok.ref_text.as_str()), ("image", "/h/images/upload_1.png", ""));
        assert_eq!(attach_result(&file, &json!({"attached": false, "message": "nope"})).unwrap_err(), "nope");
        assert!(attach_result(&file, &json!({"attached": true})).unwrap_err().contains("spec.pdf"));
    }
}
