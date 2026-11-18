/**
 * Browser-UI accelerator keys the overlay must never pass to the webview (R-SY-10).
 * F5 / Ctrl+R reload the whole page, which closes every panel and drops unsent
 * composer text. Find, print, save, open, view-source and history navigation open
 * browser chrome that has no place in an overlay. Text-editing keys
 * (Ctrl+C/V/X/Z/Y/A, arrows, Home/End, Ctrl+Backspace) are never in this list.
 * The Windows build also turns the same keys off inside WebView2 from Rust
 * (`disable_browser_accelerators`); this guard covers the other platforms and acts
 * as a fallback.
 */

const ACCEL_LETTERS = new Set(["r", "f", "g", "p", "s", "o", "u"]);

/** True when the keydown is one of the browser accelerators we swallow. */
export function isBrowserAccelerator(event) {
  const key = String(event?.key ?? "");
  const lower = key.toLowerCase();
  const mod = !!(event.ctrlKey || event.metaKey);
  if (key === "F5" || key === "F3" || key === "F7") return true; // reload, find next, caret browsing
  if (event.altKey && !mod && (key === "ArrowLeft" || key === "ArrowRight")) return true; // history back/forward
  if (key === "BrowserBack" || key === "BrowserForward" || key === "BrowserRefresh" || key === "BrowserSearch") return true;
  if (!mod || event.altKey) return false;
  return ACCEL_LETTERS.has(lower);
}

/** Capture-phase listener: swallow before any page handler or the browser sees it. */
export function installKeyGuard(target) {
  const handler = (event) => {
    if (!isBrowserAccelerator(event)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  target.addEventListener("keydown", handler, true);
  return handler;
}
