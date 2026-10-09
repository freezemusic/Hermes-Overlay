import { Marked } from "marked";
import createDOMPurify from "dompurify";

const parser = new Marked({ gfm: true, breaks: true });

parser.use({
  renderer: {
    html(token) {
      const text = typeof token === "string" ? token : (token?.text ?? "");
      return escapeHtml(text);
    },
  },
});

const PURIFY_CONFIG = {
  ALLOWED_TAGS: [
    "h1", "h2", "h3", "h4", "h5", "h6",
    "p", "br", "strong", "em", "del",
    "code", "pre",
    "ul", "ol", "li",
    "blockquote",
    "a",
    "table", "thead", "tbody", "tr", "th", "td",
    "hr",
    "span",
  ],
  ALLOWED_ATTR: ["href", "title", "class", "start", "colspan", "rowspan"],
  ALLOW_DATA_ATTR: false,
  ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):)/i,
  // A custom ALLOWED_URI_REGEXP makes DOMPurify test every attribute outside its URI-safe list
  // against it, so scheme-less values like start="2" / colspan="2" would be stripped.
  ADD_URI_SAFE_ATTR: ["start", "colspan", "rowspan"],
};

let browserPurify = null;

function purifyFor(explicit) {
  if (explicit) return explicit;
  if (browserPurify) return browserPurify;
  if (typeof window !== "undefined" && window.document) {
    browserPurify = createDOMPurify(window);
    return browserPurify;
  }
  throw new Error("markdown sanitize needs a DOM");
}

export function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[ch]));
}

export function isSafeLink(href) {
  if (!href || href.length > 2048) return false;
  try {
    const url = new URL(href);
    return url.protocol === "https:" || url.protocol === "http:" || url.protocol === "mailto:";
  } catch {
    return false;
  }
}

export function renderAssistantMarkdown(source, purify) {
  const raw = parser.parse(String(source ?? ""), { async: false });
  const html = typeof raw === "string" ? raw : "";
  return purifyFor(purify).sanitize(html, PURIFY_CONFIG);
}

export function decorateCodeBlocks(root) {
  const doc = root.ownerDocument;
  if (!doc) return;
  root.querySelectorAll("pre").forEach((pre) => {
    if (pre.querySelector(":scope > .code-copy")) return;
    const code = pre.querySelector("code")?.textContent ?? "";
    if (!code.trim()) return;
    const button = doc.createElement("button");
    button.type = "button";
    button.className = "code-copy";
    button.textContent = "複製";
    button.addEventListener("click", () => {
      const code = pre.querySelector("code")?.textContent ?? "";
      const write = doc.defaultView?.navigator?.clipboard?.writeText;
      if (!write) return;
      write.call(doc.defaultView.navigator.clipboard, code).then(
        () => {
          button.textContent = "已複製";
        },
        () => {
          button.textContent = "複製";
        },
      );
    });
    pre.appendChild(button);
  });
}

export function paintBotBubble(el, text, purify) {
  const html = renderAssistantMarkdown(text, purify);
  if (el.dataset.md === html) return false;
  el.dataset.md = html;
  el.innerHTML = html;
  decorateCodeBlocks(el);
  return true;
}

export function createLivePainter({
  paint,
  delay = 50,
  now = () => Date.now(),
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
}) {
  let timer = null;
  let last = Number.NEGATIVE_INFINITY;

  function fire() {
    timer = null;
    last = now();
    paint();
  }

  return {
    schedule() {
      if (timer != null) return;
      const elapsed = now() - last;
      if (elapsed >= delay) {
        fire();
        return;
      }
      const token = {};
      timer = token;
      const handle = setTimer(() => {
        if (timer !== token) return;
        fire();
      }, delay - elapsed);
      token.handle = handle;
    },
    flush() {
      if (timer != null) {
        clearTimer(timer.handle);
        timer = null;
      }
      last = now();
      paint();
    },
  };
}
