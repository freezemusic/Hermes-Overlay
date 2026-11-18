/**
 * R-SY-12: no link may ever navigate the overlay's own webview.
 * One capture-phase listener on the document covers every rendered anchor
 * (main chat, sub-orb chat, plan body, tool detail, cards, kanban, settings).
 * It always cancels the in-page navigation; a safe http(s)/mailto link goes to
 * the system browser through `open`. The Rust side (`navigation_allowed`)
 * is the second layer.
 */

import { isSafeLink } from "./markdown.js";

/** The anchor an event landed on, or null. Works through text nodes and SVG. */
export function anchorOf(event) {
  let node = event?.target;
  if (node && node.nodeType === 3) node = node.parentElement;
  const hit = node?.closest?.("a[href], area[href]");
  return hit || null;
}

/**
 * Install on `doc`. `open(url)` opens a safe link outside the overlay.
 * Handles click, middle click (auxclick) and Enter-activated links alike.
 */
export function installLinkGuard(doc, open) {
  const handler = (event) => {
    if (event.type === "auxclick" && event.button !== 1) return;
    if (event.type === "click" && event.button > 0) return;
    const anchor = anchorOf(event);
    if (!anchor) return;
    event.preventDefault();
    event.stopPropagation();
    const href = anchor.getAttribute("href") || "";
    if (href.startsWith("#")) return;
    // Resolve a relative href against the page, then judge the absolute URL.
    let absolute = href;
    try {
      absolute = new URL(href, doc.baseURI || "http://localhost/").href;
    } catch {
      return;
    }
    if (!isSafeLink(absolute)) return;
    // A link to the app's own origin is never an external page.
    if (href.startsWith("/") || href.startsWith(".")) return;
    open(absolute);
  };
  doc.addEventListener("click", handler, true);
  doc.addEventListener("auxclick", handler, true);
  return handler;
}
