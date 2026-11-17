/**
 * Panel wheel forwarding (R-SO-10, SPEC §3.3).
 *
 * A Bot panel forwards wheel turns over its header / composer to the chat
 * list so the list scrolls from anywhere in the panel. Areas that scroll on
 * their own must keep the wheel to themselves: the chat list itself, the
 * plan preview, text fields, the native select, the custom session menu and
 * the slash-command popup. Wheeling those never moves the chat.
 */

export const OWN_SCROLL_SELECTOR = ".chat-messages, .plan-preview, textarea, select, .session-menu, .slash-popup";

/** True when a wheel on `target` should be forwarded to the panel's chat. */
export function wheelScrollsChat(target) {
  if (!target || typeof target.closest !== "function") return true;
  return !target.closest(OWN_SCROLL_SELECTOR);
}
