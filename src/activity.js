/** Thinking spinner, streaming cursor, and toast timing. No infinite idle motion. */

export const THINKING_WATCHDOG_MS = 90_000;
export const TOAST_MS = 5_000;
export const TOAST_MAX = 3;

export function emptyActivity() {
  return { thinking: false, streaming: false, deadline: null };
}

/**
 * send / run.started -> thinking.
 * tool.progress keeps the spinner and raises a toast.
 * assistant delta -> streaming (spinner off).
 * completed / failed / cancelled / watchdog clear both.
 * Any live event resets the 90s deadline.
 */
export function reduceActivity(state, event, now = 0) {
  const current = state || emptyActivity();
  const live = (patch) => ({
    thinking: patch.thinking,
    streaming: patch.streaming,
    deadline: now + THINKING_WATCHDOG_MS,
  });
  switch (event.type) {
    case "send":
    case "run.started":
      return { state: live({ thinking: true, streaming: false }), toast: null, unread: false };
    case "tool.progress":
      return {
        state: live({ thinking: true, streaming: false }),
        toast: { kind: "tool", text: event.text || "工具" },
        unread: true,
      };
    case "tool":
      return {
        state: live({
          thinking: current.thinking && !current.streaming,
          streaming: current.streaming,
        }),
        toast: null,
        unread: false,
      };
    case "delta":
      return { state: live({ thinking: false, streaming: true }), toast: null, unread: false };
    case "completed": {
      const text = String(event.text || "").trim();
      return {
        state: { thinking: false, streaming: false, deadline: null },
        toast: text ? { kind: "message", text } : null,
        unread: !!text,
      };
    }
    case "failed":
    case "cancelled":
      return {
        state: { thinking: false, streaming: false, deadline: null },
        toast: {
          kind: "error",
          text: String(event.text || "").trim() || (event.type === "cancelled" ? "已停止" : "回覆失敗"),
        },
        unread: true,
      };
    case "watchdog":
      return { state: emptyActivity(), toast: null, unread: false };
    default:
      return { state: current, toast: null, unread: false };
  }
}

export function pushToast(stack, item, max = TOAST_MAX) {
  return [...stack, item].slice(-max);
}

/** Side away from the nearer screen edge. `left` means the toast sits left of the orb. */
export function toastSide(orb, viewportWidth) {
  const center = orb.x + orb.w / 2;
  const width = viewportWidth || 1;
  return width - center < center ? "left" : "right";
}

export function toastAnchor(orb, viewport, index = 0) {
  const width = 280;
  const gap = 12;
  const stack = 8;
  const side = toastSide(orb, viewport.width);
  const rawX = side === "left" ? orb.x - width - gap : orb.x + orb.w + gap;
  const x = Math.max(8, Math.min(rawX, Math.max(8, viewport.width - width - 8)));
  const y = Math.max(8, orb.y + index * (72 + stack));
  return { side, x, y, width };
}
