/**
 * Chat attachments (R-AT-01 … R-AT-04, SPEC §14.10).
 *
 * Follows Hermes Desktop (NousResearch/hermes-agent `bf0203a`):
 * - images ride `image.attach_bytes {session_id, content_base64, filename}`
 *   and are staged on the live session; `prompt.submit` picks them up;
 * - other files ride `file.attach {session_id, name, data_url}` and come back
 *   with `ref_text` (`@file:…`), which goes in front of the typed text
 *   (`submit.ts` buildContextText);
 * - an image-only send uses Desktop's default line.
 * The server is remote, so the overlay always sends bytes, never a laptop path.
 */

/** Per-file cap. Base64 of 10 MB is ~13.4 MB, under a 16 MiB WebSocket frame. */
export const ATTACH_MAX_BYTES = 10 * 1024 * 1024;
/** Attachments per message. */
export const ATTACH_MAX_FILES = 10;
/** Desktop `buildContextText` default when only images are sent. */
export const IMAGE_ONLY_PROMPT = "What do you see in this image?";

/** Server `_allowed_image_extensions` fallback set (prompt_attachments.py). */
const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp"]);
const IMAGE_MIME = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/bmp"]);

export function fileExt(name) {
  const match = String(name || "").toLowerCase().match(/\.([a-z0-9]+)$/);
  return match ? match[1] : "";
}

/** `image` when the server will accept it as an image, else `file`. */
export function attachmentKind(file) {
  const mime = String(file?.type || "").toLowerCase();
  if (IMAGE_MIME.has(mime)) return "image";
  if (!mime && IMAGE_EXT.has(fileExt(file?.name))) return "image";
  if (mime.startsWith("image/") && IMAGE_EXT.has(fileExt(file?.name))) return "image";
  return "file";
}

export function formatBytes(n) {
  const size = Math.max(0, Number(n) || 0);
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 102.4) / 10} KB`;
  return `${Math.round(size / (1024 * 102.4)) / 10} MB`;
}

/** Why `file` cannot be added next to `existing`, or "" when it can. */
export function attachRefusal(file, existing = []) {
  const name = String(file?.name || "附件");
  if (existing.length >= ATTACH_MAX_FILES) return `最多 ${ATTACH_MAX_FILES} 個附件`;
  const size = Number(file?.size) || 0;
  if (size <= 0) return `「${name}」係空檔案`;
  if (size > ATTACH_MAX_BYTES) return `「${name}」太大（${formatBytes(size)}），每個附件上限 ${formatBytes(ATTACH_MAX_BYTES)}`;
  return "";
}

/** Name for a pasted clipboard image (no file name on the clipboard). */
export function pastedImageName(mime, when = new Date()) {
  const ext = { "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp", "image/bmp": "bmp" }[String(mime || "").toLowerCase()] || "png";
  const pad = (n) => String(n).padStart(2, "0");
  return `pasted-${when.getFullYear()}${pad(when.getMonth() + 1)}${pad(when.getDate())}-${pad(when.getHours())}${pad(when.getMinutes())}${pad(when.getSeconds())}.${ext}`;
}

/** Image files on a paste / drop `DataTransfer` (`items` first, then `files`). */
export function clipboardImageFiles(data) {
  if (!data) return [];
  const out = [];
  for (const item of Array.from(data.items || [])) {
    if (item?.kind !== "file") continue;
    const file = item.getAsFile?.();
    if (file && String(file.type || "").startsWith("image/")) out.push(file);
  }
  if (out.length) return out;
  return Array.from(data.files || []).filter((file) => String(file?.type || "").startsWith("image/"));
}

/** OS files on a drop `DataTransfer`. */
export function droppedFiles(data) {
  if (!data) return [];
  const files = Array.from(data.files || []);
  if (files.length) return files;
  const out = [];
  for (const item of Array.from(data.items || [])) {
    if (item?.kind !== "file") continue;
    const file = item.getAsFile?.();
    if (file) out.push(file);
  }
  return out;
}

/** True when a drag carries OS files (not text or an in-page drag). */
export function dragHasFiles(data) {
  if (!data) return false;
  const types = Array.from(data.types || []);
  return types.includes("Files");
}

/** Strip `data:…;base64,` from a FileReader data URL. */
export function base64FromDataUrl(dataUrl) {
  const text = String(dataUrl || "");
  const comma = text.indexOf(",");
  return comma >= 0 && /;base64$/i.test(text.slice(0, comma)) ? text.slice(comma + 1) : "";
}

/** Chip model for one picked / dropped / pasted file. `data` is filled later. */
export function makeAttachment(file, seq, name = "") {
  const label = String(name || file?.name || "附件").trim() || "附件";
  return {
    id: `att-${seq}`,
    kind: attachmentKind({ type: file?.type, name: label }),
    name: label,
    mime: String(file?.type || "") || (attachmentKind({ name: label }) === "image" ? `image/${fileExt(label) === "jpg" ? "jpeg" : fileExt(label) || "png"}` : "application/octet-stream"),
    size: Number(file?.size) || 0,
    file,
    state: "ready",
    error: "",
  };
}

/** What the `chat_attach` Tauri command gets for one chip (base64 without prefix). */
export function attachPayload(att, base64) {
  return {
    kind: att.kind === "image" ? "image" : "file",
    name: att.name,
    mime: att.mime || "application/octet-stream",
    data: String(base64 || ""),
  };
}

/**
 * Model-facing text, Desktop `buildContextText`: file refs (one per line),
 * a blank line, then the typed text. Image-only → Desktop's default question.
 */
export function buildContextText(results, typed) {
  const refs = (results || []).map((item) => String(item?.ref_text || "").trim()).filter(Boolean).join("\n");
  const text = String(typed || "").trim();
  const joined = [refs, text].filter(Boolean).join("\n\n");
  if (joined) return joined;
  return (results || []).some((item) => item?.kind === "image") ? IMAGE_ONLY_PROMPT : "";
}

/** Chip text: name and size, or the error. */
export function chipText(att) {
  if (att.state === "error") return `${att.name}：${att.error || "上載失敗"}`;
  if (att.state === "uploading") return `${att.name}（上載中…）`;
  return `${att.name}（${formatBytes(att.size)}）`;
}

/**
 * Why a send with attachments must wait, or "": slash commands and side
 * questions are not prompts, and a clarify answer cannot carry files.
 */
export function attachSendBlock(typed, { clarify = false, side = false } = {}) {
  const text = String(typed || "").trim();
  if (text.startsWith("/")) return "附件唔可以同斜線指令一齊送，請先拎走附件或者指令";
  if (side) return "旁問模式唔送附件，請先轉返一般或者計劃模式";
  if (clarify) return "要先答完問題卡，附件先可以送";
  return "";
}
