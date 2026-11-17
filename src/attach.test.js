import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { JSDOM } from "jsdom";
import {
  ATTACH_MAX_BYTES,
  ATTACH_MAX_FILES,
  IMAGE_ONLY_PROMPT,
  attachmentKind,
  attachPayload,
  attachRefusal,
  attachSendBlock,
  base64FromDataUrl,
  buildContextText,
  chipText,
  clipboardImageFiles,
  dragHasFiles,
  droppedFiles,
  formatBytes,
  makeAttachment,
  pastedImageName,
} from "./attach.js";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const main = read("./main.js");
const html = read("../index.html");
const css = read("./styles.css");
const lib = read("../src-tauri/src/lib.rs");
const client = read("../src-tauri/src/client/mod.rs");
const attachRs = read("../src-tauri/src/client/attach.rs");
const perms = read("../src-tauri/permissions/hermes.toml");
const cap = JSON.parse(read("../src-tauri/capabilities/default.json"));
const conf = JSON.parse(read("../src-tauri/tauri.conf.json"));
const winConf = JSON.parse(read("../src-tauri/tauri.windows.conf.json"));
const reqs = read("../REQUIREMENTS.md");
const probe = read("../scripts/windows-clickthrough.ps1");
const spec = read("../SPEC.md");
const roadmap = read("../docs/ROADMAP.md");

test("R-AT-02 kinds: server image types are images, everything else is a file", () => {
  assert.equal(attachmentKind({ type: "image/png", name: "a.png" }), "image");
  assert.equal(attachmentKind({ type: "image/jpeg", name: "a.jpg" }), "image");
  assert.equal(attachmentKind({ type: "", name: "shot.WEBP" }), "image");
  assert.equal(attachmentKind({ type: "image/svg+xml", name: "logo.svg" }), "file");
  assert.equal(attachmentKind({ type: "image/heic", name: "p.heic" }), "file");
  assert.equal(attachmentKind({ type: "application/pdf", name: "spec.pdf" }), "file");
  assert.equal(attachmentKind({ type: "", name: "notes" }), "file");
});

test("R-AT-03 limits: 10 files, 10 MB each, no empty files", () => {
  assert.equal(ATTACH_MAX_BYTES, 10 * 1024 * 1024);
  assert.equal(ATTACH_MAX_FILES, 10);
  assert.equal(attachRefusal({ name: "a.txt", size: 3 }, []), "");
  assert.match(attachRefusal({ name: "big.zip", size: ATTACH_MAX_BYTES + 1 }, []), /太大.*10 MB/);
  assert.equal(attachRefusal({ name: "ok.bin", size: ATTACH_MAX_BYTES }, []), "");
  assert.match(attachRefusal({ name: "e.txt", size: 0 }, []), /空檔案/);
  assert.match(attachRefusal({ name: "x", size: 1 }, new Array(10).fill({})), /最多 10 個附件/);
  assert.equal(formatBytes(512), "512 B");
  assert.equal(formatBytes(1536), "1.5 KB");
  assert.equal(formatBytes(10 * 1024 * 1024), "10 MB");
  // Rust checks the same numbers before any upload.
  assert.match(attachRs, /ATTACH_MAX_BYTES: usize = 10 \* 1024 \* 1024/);
  assert.match(attachRs, /ATTACH_MAX_FILES: usize = 10;/);
});

test("R-AT-02 payload: base64 bytes, never a laptop path", () => {
  const att = makeAttachment({ name: "C:\\fake\\spec.pdf", type: "application/pdf", size: 4 }, 1, "spec.pdf");
  assert.equal(att.id, "att-1");
  assert.equal(att.kind, "file");
  assert.equal(att.state, "ready");
  const payload = attachPayload(att, "JVBERi0=");
  assert.deepEqual(payload, { kind: "file", name: "spec.pdf", mime: "application/pdf", data: "JVBERi0=" });
  assert.equal("path" in payload, false);
  const img = makeAttachment({ name: "", type: "image/png", size: 9 }, 2, pastedImageName("image/png", new Date(2026, 10, 17, 9, 5, 7)));
  assert.equal(img.name, "pasted-20261117-090507.png");
  assert.equal(attachPayload(img, "iVBO").kind, "image");
  assert.equal(base64FromDataUrl("data:image/png;base64,iVBORw0KGgo="), "iVBORw0KGgo=");
  assert.equal(base64FromDataUrl("data:text/plain,hello"), "");
  assert.equal(pastedImageName("image/jpeg", new Date(2026, 0, 2, 3, 4, 5)), "pasted-20260102-030405.jpg");
});

test("R-AT-02 context text follows Desktop buildContextText", () => {
  const file = { kind: "file", ref_text: "@file:attachments/spec.pdf" };
  const file2 = { kind: "file", ref_text: "@file:\"attachments/my notes.txt\"" };
  const image = { kind: "image", ref_text: "" };
  assert.equal(buildContextText([file], "summarise"), "@file:attachments/spec.pdf\n\nsummarise");
  assert.equal(buildContextText([file, file2, image], " hi "), "@file:attachments/spec.pdf\n@file:\"attachments/my notes.txt\"\n\nhi");
  assert.equal(buildContextText([image], "what is this"), "what is this");
  assert.equal(buildContextText([image], ""), IMAGE_ONLY_PROMPT);
  assert.equal(buildContextText([file], ""), "@file:attachments/spec.pdf");
  assert.equal(IMAGE_ONLY_PROMPT, "What do you see in this image?");
});

test("R-AT-04 chips show size, upload and the server reason; sends that cannot carry files wait", () => {
  const att = { name: "a.png", size: 2048, state: "ready" };
  assert.equal(chipText(att), "a.png（2 KB）");
  assert.equal(chipText({ ...att, state: "uploading" }), "a.png（上載中…）");
  assert.equal(chipText({ ...att, state: "error", error: "image too large" }), "a.png：image too large");
  assert.match(attachSendBlock("/new x"), /斜線指令/);
  assert.match(attachSendBlock("hello", { clarify: true }), /問題卡/);
  assert.match(attachSendBlock("hello", { side: true }), /旁問/);
  assert.equal(attachSendBlock("hello"), "");
});

test("R-AT-01 paste and drop pick files off a DataTransfer", () => {
  const png = { type: "image/png", name: "image.png" };
  const pdf = { type: "application/pdf", name: "a.pdf" };
  const items = [{ kind: "string", getAsFile: () => null }, { kind: "file", getAsFile: () => png }, { kind: "file", getAsFile: () => pdf }];
  assert.deepEqual(clipboardImageFiles({ items, files: [] }), [png]);
  assert.deepEqual(clipboardImageFiles({ items: [], files: [png, pdf] }), [png]);
  assert.deepEqual(clipboardImageFiles(null), []);
  assert.deepEqual(droppedFiles({ files: [pdf, png], items: [] }), [pdf, png]);
  assert.deepEqual(droppedFiles({ files: [], items }), [png, pdf]);
  assert.equal(dragHasFiles({ types: ["Files"] }), true);
  assert.equal(dragHasFiles({ types: ["text/plain"] }), false);
});

test("R-AT-01 shared composer template: ＋ menu (檔案／圖片／貼上圖片), chips, hidden pickers", () => {
  const dom = new JSDOM(html);
  const tpl = dom.window.document.getElementById("bot-panel-template");
  const composer = tpl.content.querySelector(".composer");
  assert.ok(composer);
  const plus = composer.querySelector('[data-role="attach"]');
  assert.ok(plus);
  assert.equal(plus.getAttribute("aria-haspopup"), "menu");
  assert.match(plus.getAttribute("title"), /10 MB/);
  const items = [...composer.querySelectorAll('[data-role="attach-menu"] [data-attach]')].map((b) => b.dataset.attach);
  assert.deepEqual(items, ["files", "images", "paste"]);
  const files = composer.querySelector('input[type="file"][data-role="attach-files"]');
  const images = composer.querySelector('input[type="file"][data-role="attach-images"]');
  assert.ok(files.hasAttribute("multiple") && files.hasAttribute("hidden"));
  assert.match(images.getAttribute("accept"), /image\/png/);
  assert.ok(composer.querySelector('[data-role="attach-chips"][hidden]'));
  // The ＋ sits before the textarea; the chips row comes before both.
  const order = [...composer.children].map((el) => el.dataset.role || el.className);
  assert.ok(order.indexOf("attach-chips") < order.indexOf("attach"));
  assert.ok(order.indexOf("attach") < order.indexOf("input"));
});

test("R-AT-01/02 main.js wiring: both composers, upload before send, queue never steers", () => {
  const botWire = main.slice(main.indexOf("function wireBotPanel"), main.indexOf("function wireBotPanel") + 4000);
  assert.match(botWire, /installAttachments\(panel, id\)/);
  assert.equal((main.match(/installAttachments\(panel, id\);/g) || []).length, 2);
  const active = main.slice(main.indexOf("async function sendActive"), main.indexOf("async function continueApiSession"));
  assert.match(active, /!preset && attachmentsOf\(id\)\.length[\s\S]*sendWithAttachments\(id\)/);
  assert.match(active, /sendWhileBusy\(id, text, \{ queueOnly: !!preset\?\.queueOnly \}\)/);
  const busy = main.slice(main.indexOf("async function sendWhileBusy"), main.indexOf("async function stopActive"));
  assert.match(busy, /thread\.runId && !queueOnly/);
  const sub = main.slice(main.indexOf("async function sendSuborb("), main.indexOf("async function sendSuborbBusy"));
  assert.match(sub, /!preset && attachmentsOf\(id\)\.length/);
  const subBusy = main.slice(main.indexOf("async function sendSuborbBusy"), main.indexOf("async function postSuborb"));
  assert.match(subBusy, /if \(!queueOnly\)/);
  const send = main.slice(main.indexOf("async function sendWithAttachments"), main.indexOf("function setupComposer"));
  assert.match(send, /invoke\("chat_attach", \{ profile: sub \? sub\.profile : id, sessionId: sub \? sub\.sessionId : null, files \}\)/);
  assert.match(send, /buildContextText\(results, typed\)/);
  assert.match(send, /queueOnly: true/);
  assert.doesNotMatch(send, /clipboard\.paste/);
  // Failure paths keep the text: the composer is only read-only while uploading, never cleared there.
  assert.doesNotMatch(send, /input\.value = ""/);
  assert.match(main, /input\.readOnly = on/);
  // Enter / Space on the ＋, menu or chip × never sends.
  const foreign = main.slice(main.indexOf("function foreignFieldFocus"), main.indexOf("function newSessionKeyFocus"));
  assert.match(foreign, /\.attach-menu, \.attach-chips/);
  // The open menu is in the hit region (click-through stays off over it); Esc closes it first.
  assert.match(main, /attachMenu\?\.dataset\.hitId && !attachMenu\.hidden\) push\(/);
  assert.match(main, /if \(closeOpenAttachMenu\(\)\)/);
  // OS drops outside a composer never navigate the webview.
  assert.match(main, /window\.addEventListener\("drop", guard\)/);
});

test("R-AT-01 webview gets OS drops; chips CSS; Tauri command and permission", () => {
  assert.equal(conf.app.windows[0].dragDropEnabled, false);
  assert.equal(winConf.app.windows[0].dragDropEnabled, false);
  assert.match(css, /\.attach-chips \{[^}]*flex: 1 0 100%;/);
  assert.match(css, /\.attach-chip\[data-state="error"\]/);
  assert.match(css, /\.composer\.is-drop-target/);
  assert.match(lib, /async fn chat_attach\(/);
  assert.match(lib, /send_chat,\n\s+chat_attach,/);
  assert.match(perms, /identifier = "allow-chat-attach"[\s\S]*?commands\.allow = \["chat_attach"\]/);
  assert.ok(cap.permissions.includes("allow-chat-attach"));
  assert.match(client, /pub async fn attach_files\(/);
  assert.match(client, /attach::IMAGE_DETACH/);
  assert.match(attachRs, /"image\.attach_bytes"/);
  assert.match(attachRs, /"file\.attach"/);
  assert.doesNotMatch(attachRs, /clipboard\.paste"/);
});

test("R-AT-01..04 docs: requirements, SPEC §14.10, roadmap 9-10", () => {
  for (const id of ["R-AT-01", "R-AT-02", "R-AT-03", "R-AT-04"]) assert.match(reqs, new RegExp(`\\*\\*${id}\\*\\*`));
  assert.match(spec, /附件（R-AT-01/);
  assert.match(roadmap, /附件[\s\S]*R-AT-01/);
});

test("R-AT-01 Windows CI: ＋ is clickable, opens the menu on the hit list, Esc closes only the menu", () => {
  assert.match(main, /debugLog\("attach-at", line\)/);
  assert.match(main, /debugLog\("attach-menu-open"/);
  assert.match(main, /if \(wasOpen\) debugLog\("attach-menu-close"/);
  assert.match(probe, /Assert-Captured "attach-plus" \$ax \$ay/);
  assert.match(probe, /\$_\.id -eq "attach:field" -or \$_\.id -eq "panel:field"/);
  assert.match(main, /debugLog\("attach-menu-open", `id=\$\{panel\?\.dataset\.botId \|\| ""\} dpr=/);
  assert.match(probe, /Note-Ok "attach-menu-esc" "menu closed, panel kept"/);
});
