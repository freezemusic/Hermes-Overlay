/**
 * Hermes Overlay — perimeter bots + center chat.
 * UI labels: Traditional Chinese (zh-HK).
 * Gateway keys stay in the Rust process; this file only sees has_key.
 */

import { formatToastClock, orbMotion, reduceActivity, statusAfterWatchdog, TOAST_MS } from "./activity.js";
import { latestPlan, noteNewestPlan, planBodyLead, planDemoMarkdown, planForPanel, planTask, plansIn, rememberPlan } from "./plan.js";
import { closePanel, openPanel } from "./panels.js";
import {
  CONTENT_IN_MS,
  EASE,
  ICON,
  ORB,
  PANEL_H,
  PANEL_W,
  PILL_PANEL_MS,
  PLAN_COLLAPSE_MS,
  PLAN_COLLAPSE_HANDOFF_MS,
  PLAN_EASE,
  overlappedCollapseInsets,
  PLAN_GROW_MS,
  COLLAPSE_EASE,
  planEase,
  seamAdvanceMs,
  seamFrameStep,
  seamVisibleMs,
  seamClipStillClosed,
  clipPath,
  distributeEdges,
  fixedOrbPoint,
  iconShift,
  insetsFor,
  phaseList,
  collapseMs,
  dropParkedAnchor,
  clampDroppedBox,
  placeShell,
  fitPlanBox,
  panelDragHost,
  closeYieldsToOpen,
  chromeToggleAction,
  closeNudge,
  previewBlocked,
  revealClip,
  separateStackedPanels,
  includePlan,
  hostOpenPlan,
  placePlanHost,
  releasePlanDock,
  planControlUnder,
  restoreHostedPlan,
  sameChatSnapshot,
  slotPoint,
  orbCoveredBy,
  orbHaloInsets,
  restoreIdleOrbClip,
  ORB_HALO_PX,
  FRAME_BLEED,
  HAIRLINE,
  settledPlanReach,
  STACK_GAP,
  MIN_PANEL_H,
  CRON_MIN_H,
  tighten,
  cronShellHeight,
  chatTailAction,
  pinnedScrollTop,
} from "./morph.js";
import { isProfileEnabled, keyBannerSlot, panelErrorSlot, profilesNeedingKeys, rosterSyncDelayMs, rosterTickAllowed } from "./roster.js";
import {
  approvalFailure,
  approvalPending,
  approvalPost,
  omitRepeatedBlockedLine,
  plainToolText,
  renderApprovalCard,
  showApprovalBadge,
  statusAfterResponded,
  textIsExecuteCodeBlocked,
  APPROVAL_WAIT_LABEL,
  EXECUTE_CODE_BLOCKED_LINE,
} from "./approval.js";
import {
  CLARIFY_SEND_FAIL,
  CLARIFY_TIMEOUT_S,
  CLARIFY_WAIT_LABEL,
  clarifyFailure,
  clarifyKept,
  clarifyPending,
  clarifyPost,
  clarifyTick,
  mergePendingControls,
  renderClarifyCard,
} from "./clarify.js";
import { SESSION_READ_ONLY_REASON, UNSENT_MARK, bannerOwner, catchUpMessages, clearRunSession, continueLiveTurn, finishApplies, isPermissionDeniedText, markUnsentDraft, mergePendingSend, mergeSendError, mergeUnsentDraft, noteRunSession, noteRunStarted, orderSessions, pendingSend, permissionDeniedMessage, previewLine, readOnlyLocked, readOnlyNote, refusedSessionIds, rememberDenied, rememberPendingSend, rememberSendError, rememberUnsent, rememberView, resolveSession, keepManualSession, runTranscript, sendErrorDraft, sessionLabel, sessionReadOnly, showSession, stopAfterMiss, unseenMessages, unsentDraft, viewingRun, writableContinuation } from "./sessions.js";
import { applyBotColor, NOUS } from "./botcolor.js";
import {
  KANBAN_EMPTY,
  KANBAN_LOGIN,
  KANBAN_POLL_MS,
  KANBAN_UNAVAILABLE,
  boardFingerprint,
  boardOptionLabel,
  columnCollapsed,
  kanbanChangeLine,
  kanbanErrorText,
  kanbanRequestSlug,
  kanbanUnavailable,
  moveTask,
  normalizeBoard,
  ownerColor,
  pickerSelection,
} from "./kanban.js";
import {
  CRON_EMPTY,
  CRON_POLL_MS,
  cronGroupNote,
  cronOrbActive,
  cronOrbFace,
  cronProgress,
  nextRunLabel,
  normalizeCronGroup,
  pruneRunMarks,
} from "./cron.js";
import { createLivePainter, decorateCodeBlocks, isSafeLink, renderAssistantMarkdown } from "./markdown.js";
import { SETUP_BANNER, setupHintVisible, shouldAutoOpenSettings } from "./setup.js";
import {
  RECONNECT_STATUS,
  createProbeGate,
  createReconnect,
  gatewayDown,
} from "./reconnect.js";
import {
  PREVIEW_COMMANDS,
  completionText,
  filterCommands,
  groupByCategory,
  inlineArgsHint,
  modelFields,
  moveSlashIndex,
  orderSlashCommands,
  parseSlashMarker,
  resolveClient,
  shouldRefreshCatalog,
  slashEnterSubmits,
  slashFilterQuery,
} from "./slash.js";
import {
  PALETTE,
  applyDropdownDismiss,
  colorForIndex,
  elementStates,
  focusLossAction,
  latchedElementIds,
  osFocusAction,
  pinToggle,
  invokeFailureMessage,
  settingsQuitAction,
  selectBlurAction,
  linuxAltWarning,
  nextOrbPulse,
  modifierLabel,
  modifierMatches,
  modifierEngages,
  guardPublishedHits,
  unionOpenPlanRect,
  rehearsalDeferReason,
  pressOrbId,
  orbOpenFromPress,
  botIdFromHit,
  POINTER_QUIET_MS,
  composerKeyAction,
  escapeTarget,
  ownComposerKey,
  MODIFIER_ARM_MS,
  nextDropdownOpen,
  selectKeyOpensDropdown,
  BLUR_RELEASE_MS,
  onOrbOpacityTransitionEnd,
  orbDiscHit,
  applyOrbFadeFrame,
  ORB_FADE_MS,
} from "./proximity.js";
import { applyOrbName, layoutOrbNames, orbHitRect } from "./names.js";

const MOCK_BOTS = [
  {
    id: "planner",
    name: "計劃助手",
    short: "計",
    color: PALETTE[0],
    status: "線上 · 可互動",
    detail: "幫你拆解任務、排優先次序，同埋跟進每日進度。適合長時 overlay 置頂使用。",
    messages: [
      { role: "bot", text: "而家有 3 件待辦可以即刻開工——想我先排邊件？" },
      { role: "user", text: "先做最緊急嗰件。" },
      { role: "bot", text: "得。我已經標咗「緊急」同估時 25 分鐘。" },
    ],
    float: "記住：置頂 Overlay 唔會擋你打字——空白位可穿透（平台支援時）。",
  },
  {
    id: "coder",
    name: "程式夥伴",
    short: "碼",
    color: PALETTE[1],
    status: "線上 · 程式碼模式",
    detail: "跨平台桌面／網頁開發助手。而家呢個骨架就係用 Tauri 2 整出嚟。",
    messages: [
      { role: "bot", text: "透明窗 + alwaysOnTop 已開。要唔要加系統托盤？" },
      { role: "user", text: "稍後先。而家想確認 bot 邊框互動。" },
      { role: "bot", text: "點選邊框頭像就會切換中間面板內容。" },
    ],
    float: "而家係離線示範。設定 gateway 之後先會連 Hermes。",
  },
  {
    id: "research",
    name: "資料搜查",
    short: "查",
    color: PALETTE[2],
    status: "待命",
    detail: "負責搜尋、摘要同來源整理。呢個版本用 mock 內容示範版面。",
    messages: [{ role: "bot", text: "你想查邊個主題？我可以先出重點摘要。" }],
    float: null,
  },
  {
    id: "writer",
    name: "文案助手",
    short: "文",
    color: PALETTE[3],
    status: "線上",
    detail: "粵語／書面語文稿、回覆草稿、標題建議。",
    messages: [
      { role: "bot", text: "想用正式書面語定口語風格？" },
      { role: "user", text: "口語，短少少。" },
    ],
    float: "例：幫你改短呢句「可唔可以幫我睇下」。",
  },
  {
    id: "ops",
    name: "系統監控",
    short: "監",
    color: PALETTE[4],
    status: "觀察中",
    detail: "預留位置顯示 CPU／網路／agent 狀態。目前係 stub。",
    messages: [{ role: "bot", text: "監控面板尚未接真數據——骨架已就位。" }],
    float: null,
  },
  {
    id: "voice",
    name: "語音 Bot",
    short: "聲",
    color: PALETTE[5],
    status: "靜音",
    detail: "語音輸入／輸出預留。點選可睇 mock 對話。",
    messages: [{ role: "bot", text: "語音通道未接上。你可以先用文字試 overlay。" }],
    float: null,
  },
  {
    id: "memory",
    name: "記憶庫",
    short: "憶",
    color: PALETTE[6],
    status: "本地 stub",
    detail: "記住偏好同跨 session 上下文（未實作持久化）。",
    messages: [{ role: "bot", text: "而家只係記憶示範字串，重開 app 會重置。" }],
    float: null,
  },
  {
    id: "security",
    name: "安全守門",
    short: "安",
    color: PALETTE[7],
    status: "守護中",
    detail: "提示敏感操作、權限同 click-through 風險。",
    messages: [
      { role: "bot", text: "全螢幕透明 overlay 要小心誤觸；空白位穿透仍屬實驗功能。" },
    ],
    float: "Esc 會收起中間面板。結束程式用設定入面嘅「結束」，或者系統匣。",
  },
];

function $(sel) {
  return document.querySelector(sel);
}

function panelFor(id) {
  if (!id) return null;
  return document.querySelector(`.bot-panel[data-bot-id="${cssEscape(id)}"]`);
}

function role(panel, name) {
  return panel?.querySelector(`[data-role="${name}"]`) || null;
}

function chatOf(id) {
  return role(panelFor(id), "chat");
}

function hintText() {
  const name = modifierLabel(state.interaction.modifier);
  return state.interaction.supported
    ? `光球預設實色同穿透。游標行近先淡出；按住 ${name}，游標下嗰粒返實色、可以點同右鍵隱藏。新訊息會由光球橫向展開成膠囊 5 秒，唔使按 ${name} 都睇到，但要按住先至點得。面板預設實色，可以拖同點；按住 ${name} 就變透明並穿透。`
    : "呢個環境讀唔到全域游標或修飾鍵，所以保持可點擊，唔會穿透。";
}

function modifierHeld(event) {
  if (state.interaction.supported === false) return true;
  const kind = state.interaction.modifier || "ctrl";
  if (kind === "shift") return !!event.shiftKey;
  if (kind === "alt") return !!event.altKey;
  return !!event.ctrlKey;
}

function reducedMotion() {
  return !!window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
}

function shellFor(id) {
  if (!id) return null;
  return document.querySelector(`.morph[data-bot-id="${cssEscape(id)}"]`);
}

function edgePadPx() {
  const raw = getComputedStyle(document.documentElement).getPropertyValue("--orb-glow-radius");
  const glow = Number.parseFloat(raw);
  return (Number.isFinite(glow) ? glow : 34) + 8;
}

function boxSize(id) {
  const vw = window.innerWidth || 1280;
  const vh = window.innerHeight || 800;
  if (id === "kanban") return { w: Math.min(960, vw * 0.8), h: Math.min(vh * 0.8, 760) };
  if (id === "cron") {
    const fitted = state.cronBoxH > 0 ? state.cronBoxH : 140;
    return { w: Math.min(320, vw * 0.86), h: cronShellHeight(fitted, vh) };
  }
  if (id === "settings") return { w: Math.min(680, vw * 0.92), h: Math.min(vh * 0.86, 760) };
  return { w: PANEL_W, h: PANEL_H };
}

function anchorPoint(id) {
  const saved = state.anchors[id];
  if (saved?.placed) return { x: saved.x, y: saved.y };
  const vw = window.innerWidth || 1280;
  const vh = window.innerHeight || 800;
  const pad = edgePadPx();
  const insets = state.workInsets;
  if (id === "settings" || id === "kanban" || id === "cron") return fixedOrbPoint(id, vw, vh, pad, ORB, insets);
  const index = Math.max(0, state.bots.findIndex((bot) => bot.id === id));
  const slots = distributeEdges(Math.max(state.bots.length, 1), {
    width: vw,
    height: vh,
    pad,
    orb: ORB,
    insets,
  });
  const slot = slots[index] || { edge: "left", t: ((index % 7) + 1) / 8 };
  return slotPoint(slot.edge, slot.t, vw, vh, pad, ORB, insets);
}

/** Room outside a live or failed cron orb for the status ring and the running glow. */
const CRON_ORB_BLEED = 32;

function paintClip(shell, insets, visual = shell.dataset.visual || shell.dataset.state || "orb") {
  const cronBleed = shell.dataset.botId === "cron"
    && visual === "orb"
    && (shell.classList.contains("is-cron-live") || shell.classList.contains("is-cron-fail"));
  // The resting clip includes the 34px halo. Dataset insets stay the 44px
  // disc; hit rects read the button, not this wider circle.
  const bleed = visual === "orb" ? Math.max(ORB_HALO_PX, cronBleed ? CRON_ORB_BLEED : 0) : 0;
  const outer = bleed > 0 ? orbHaloInsets(insets, bleed) : null;
  if (visual === "panel") {
    // The open clip stays where the morph left it. Clearing it here drops
    // the layer and the compositor paints one blank frame.
    shell.style.setProperty("overflow", "visible", "important");
  } else {
    const next = outer ? clipPath(outer) : revealClip(visual, shellGeom(shell));
    const px = clipPath(insets);
    const held = shell.style.clipPath;
    // Every orb writes the halo circle. An identical clip stays put.
    // Swapping the collapse's px clip for revealClip's calc rebuilds the
    // orb about a second later.
    if (!outer && held && (held === next || held === px)) {
      /* resting clip already matches */
    } else if (held !== next) {
      // Clearing the inline clip first paints the stylesheet's full-panel
      // inset for one frame, and that frame's outline goes dark (R-PN-05).
      shell.style.clipPath = next;
    }
  }
  const fill = shell.querySelector(".morph-fill");
  if (fill) {
    const fillClip = clipPath(tighten(insets));
    if (fill.style.clipPath !== fillClip) fill.style.clipPath = fillClip;
  }
  const clipNote = (key, value) => {
    const text = String(value);
    if (shell.dataset[key] !== text) shell.dataset[key] = text;
  };
  clipNote("clipTop", insets.top);
  clipNote("clipRight", insets.right);
  clipNote("clipBottom", insets.bottom);
  clipNote("clipLeft", insets.left);
  clipNote("clipRadius", insets.radius);
}

function planNode(shell) {
  if (!shell?.querySelector) return null;
  return shell.querySelector(":scope > .plan-window") || shell._planHost?.querySelector(".plan-window") || null;
}

function shellOfPlan(plan) {
  if (!plan) return null;
  return plan.closest?.(".morph") || plan._planShell || null;
}

function shellGeom(shell) {
  const size = boxSize(shell.dataset.botId);
  return {
    boxW: Number.parseFloat(shell.style.width) || size.w,
    boxH: Number.parseFloat(shell.style.height) || size.h,
    ax: Number(shell.dataset.ax) || ORB / 2,
    ay: Number(shell.dataset.ay) || ORB / 2,
  };
}

function hitFor(id, visual) {
  if (visual === "orb") return `bot:${id}`;
  if (visual === "pill") return `pill:${id}`;
  if (id === "settings") return "settings";
  if (id === "kanban") return "kanban";
  if (id === "cron") return "cron";
  return `panel:${id}`;
}

function markVisual(shell, visual) {
  const next = visual === "orb" || visual === "pill" ? visual : "panel";
  const wasPanel = shell.dataset.state === "panel";
  shell.dataset.visual = visual;
  shell.dataset.state = next;
  shell.dataset.hitId = hitFor(shell.dataset.botId, shell.dataset.state);
  if (next !== "orb") delete shell.dataset.orbCovered;
  if (wasPanel && next !== "panel") {
    shell.style.removeProperty("opacity");
    planNode(shell)?.style.removeProperty("opacity");
  } else if (next === "panel") {
    paintOpenedHeldLook();
  }
}

function rememberAnchor(shell) {
  const id = shell?.dataset.botId;
  if (!id) return;
  const box = shell.getBoundingClientRect();
  if (box.width < 1 || box.height < 1) return;
  const ax = Number(shell.dataset.ax) || 0;
  const ay = Number(shell.dataset.ay) || 0;
  state.anchors[id] = { x: box.left + ax, y: box.top + ay, placed: true };
}

function clampDraggedShell(shell) {
  const width = Number.parseFloat(shell.style.width) || 0;
  const height = Number.parseFloat(shell.style.height) || 0;
  const left = Number.parseFloat(shell.style.left) || 0;
  const top = Number.parseFloat(shell.style.top) || 0;
  const vw = window.innerWidth || 1280;
  const vh = window.innerHeight || 800;
  const clamped = clampDroppedBox(left, top, width, height, vw, vh);
  const ax = Number(shell.dataset.ax) || 0;
  const ay = Number(shell.dataset.ay) || 0;
  const same = shell.style.left === `${clamped.left}px`
    && shell.style.top === `${clamped.top}px`
    && shell.style.width === `${clamped.width}px`
    && shell.style.height === `${clamped.height}px`;
  shell._geomHeld = same ? 1 : 0;
  if (!same) {
    shell.style.left = `${clamped.left}px`;
    shell.style.top = `${clamped.top}px`;
    shell.style.width = `${clamped.width}px`;
    shell.style.height = `${clamped.height}px`;
    shell.style.right = "auto";
    shell.style.bottom = "auto";
  }
  rememberAnchor(shell);
  const header = shell.dataset.header === "bottom" ? "bottom" : "top";
  return {
    edge: shell.dataset.edge || "bottom",
    header,
    anchor: { x: ax, y: ay, header },
    left: clamped.left,
    top: clamped.top,
    width: clamped.width,
    height: clamped.height,
  };
}

function placeShellElement(shell) {
  if (shell?.dataset?.dragged === "1") return clampDraggedShell(shell);
  const id = shell.dataset.botId;
  const size = boxSize(id);
  const point = anchorPoint(id);
  const vw = window.innerWidth || 1280;
  const vh = window.innerHeight || 800;
  const placed = placeShell(point.x, point.y, size.w, size.h, vw, vh);
  const ax = String(placed.anchor.x);
  const ay = String(placed.anchor.y);
  if (shell.style.width === `${placed.width}px`
    && shell.style.height === `${placed.height}px`
    && shell.style.left === `${placed.left}px`
    && shell.style.top === `${placed.top}px`
    && shell.dataset.edge === placed.edge
    && shell.dataset.ax === ax
    && shell.dataset.ay === ay) {
    shell._geomHeld = 1;
    placeCronStatus(shell);
    return placed;
  }
  shell._geomHeld = 0;
  shell.style.width = `${placed.width}px`;
  shell.style.height = `${placed.height}px`;
  shell.style.left = `${placed.left}px`;
  shell.style.top = `${placed.top}px`;
  shell.style.right = "auto";
  shell.style.bottom = "auto";
  shell.dataset.edge = placed.edge;
  shell.dataset.header = placed.header === "bottom" ? "bottom" : "top";
  shell.dataset.ax = String(placed.anchor.x);
  shell.dataset.ay = String(placed.anchor.y);
  shell.dataset.anchor = placed.anchor.x > placed.width / 2 ? "end" : "start";
  shell.style.setProperty("--ax", `${placed.anchor.x}px`);
  shell.style.setProperty("--ay", `${placed.anchor.y}px`);
  const shift = iconShift();
  shell.style.setProperty("--icon-dx", `${shift.x}px`);
  shell.style.setProperty("--icon-dy", `${shift.y}px`);
  shell.style.transformOrigin = `${placed.anchor.x}px ${placed.anchor.y}px`;
  syncPlanSide(shell);
  placeCronStatus(shell);
  return placed;
}

function layoutShell(shell) {
  if (!shell || shell.classList.contains("is-morphing") || shell.classList.contains("is-collapsing")) return;
  if (shell.dataset.rehearsal === "1") return;
  if (document.querySelector(".morph.is-collapsing")) return;
  if (state.dragHitId && state.dragHitId === shell.dataset.hitId) return;
  const placed = placeShellElement(shell);
  // Collapse snaps the shell back to the edge anchor. Re-hosting here parks
  // the plan outside the clip at that old position (R-PN-03 / R-PL-06).
  if (shell.dataset.intent === "close" || shell._motion === "collapse") return;
  const visual = shell.dataset.visual || "orb";
  // collapse-release lays the resting orb out again. An identical box with
  // the halo clip already set must not rewrite it: that rebuilds the orb tile.
  // A collapse that stopped on the 44px disc still has to widen, or the halo
  // stays clipped for the rest of the idle period.
  if (shell._geomHeld && visual !== "panel" && shell.dataset.botId !== "cron" && shell.style.clipPath) {
    if (visual !== "orb") return;
    const idle = insetsFor("orb", shellGeom(shell));
    if (shell.style.clipPath === clipPath(orbHaloInsets(idle))) return;
  }
  paintClip(shell, insetsFor(visual, {
    boxW: placed.width,
    boxH: placed.height,
    ax: placed.anchor.x,
    ay: placed.anchor.y,
  }), visual);
  if (shell.dataset.planOpen === "1" && (visual === "panel" || shell.dataset.state === "panel")) {
    hostOpenPlan(shell);
  }
}

/** Final top/height before a clip, so the open does not slide the box at the end. */
function parkFinalBox(shell) {
  placeShellElement(shell);
  separateOpenShells([...document.querySelectorAll(".morph")], shell);
  const visual = shell.dataset.visual || shell.dataset.state || "orb";
  paintClip(shell, insetsFor(visual, shellGeom(shell)), visual);
}

function separateOpenShells(shells, extra) {
  const open = shells.filter((shell) => {
    if (shell === extra) return true;
    if (shell.classList.contains("is-morphing") || shell.classList.contains("is-collapsing")) return false;
    if (state.dragHitId && state.dragHitId === shell.dataset.hitId) return false;
    return (shell.dataset.visual || shell.dataset.state) === "panel";
  });
  if (open.length < 2) return;
  const vh = window.innerHeight || 800;
  const before = open.map((shell) => {
    const box = {
      shell,
      top: Number.parseFloat(shell.style.top) || 0,
      height: Number.parseFloat(shell.style.height) || 0,
      left: Number.parseFloat(shell.style.left) || 0,
      width: Number.parseFloat(shell.style.width) || 0,
      edge: shell.dataset.edge || "",
      pin: shell.dataset.header === "bottom" ? "end" : "start",
      minHeight: shell.dataset.botId === "cron" ? CRON_MIN_H : MIN_PANEL_H,
    };
    const plan = planNode(shell);
    const planOpen = plan && shell.dataset.planOpen === "1";
    if (!planOpen) return box;
    const paintedH = Math.max(box.height, Number.parseFloat(plan.style.height) || 0);
    if (paintedH > box.height) box.height = paintedH;
    const dockedWidth = plan.offsetWidth || plan.getBoundingClientRect().width
      || Math.min(420, (window.innerWidth || 1280) * 0.42);
    const dock = includePlan(box, {
      side: shell.dataset.planSide === "left" ? "left" : "right",
      width: dockedWidth,
    });
    dock.shell = shell;
    dock.pin = box.pin;
    dock.minHeight = box.minHeight;
    return dock;
  });
  const after = separateStackedPanels(before, vh, STACK_GAP + 2 * FRAME_BLEED);
  let moved = false;
  after.forEach((box, index) => {
    const prev = before[index];
    if (Math.abs(box.top - prev.top) < 0.5 && Math.abs(box.height - prev.height) < 0.5) return;
    moved = true;
    const shell = prev.shell;
    shell.style.top = `${box.top}px`;
    shell.style.height = `${box.height}px`;
    const ax = Number(shell.dataset.ax) || ORB / 2;
    const header = shell.dataset.header === "bottom" || box.edge === "bottom" ? "bottom" : "top";
    const ay = header === "bottom" ? box.height - ORB / 2 : ORB / 2;
    shell.dataset.header = header;
    shell.dataset.ay = String(ay);
    shell.style.setProperty("--ay", `${ay}px`);
    const shift = iconShift();
    shell.style.setProperty("--icon-dx", `${shift.x}px`);
    shell.style.setProperty("--icon-dy", `${shift.y}px`);
    placePlanHost(shell);
    const visual = shell.dataset.visual || "panel";
    paintClip(shell, insetsFor(visual, {
      boxW: prev.width,
      boxH: box.height,
      ax,
      ay,
    }), visual);
  });
  if (moved) restickOpenChats();
}

function layoutShells() {
  syncCronBox(false);
  const shells = [...document.querySelectorAll(".morph")];
  shells.forEach((shell) => layoutShell(shell));
  separateOpenShells(shells);
  seatKanbanClose();
  paintOrbNames();
  scheduleHitSync();
}

function readInsets(shell) {
  const raw = getComputedStyle(shell).clipPath || shell.style.clipPath || "";
  const match = raw.match(/inset\(\s*([-\d.]+)px\s+([-\d.]+)px\s+([-\d.]+)px\s+([-\d.]+)px/i);
  if (!match) {
    return {
      top: Number(shell.dataset.clipTop) || 0,
      right: Number(shell.dataset.clipRight) || 0,
      bottom: Number(shell.dataset.clipBottom) || 0,
      left: Number(shell.dataset.clipLeft) || 0,
    };
  }
  return {
    top: Number(match[1]),
    right: Number(match[2]),
    bottom: Number(match[3]),
    left: Number(match[4]),
  };
}

function visibleBox(shell) {
  if (shell?.dataset?.state === "orb") {
    const btn = shell.querySelector?.(".morph-orb");
    const disc = btn?.getBoundingClientRect?.();
    if (disc && disc.width >= 1 && disc.height >= 1) {
      return { x: disc.x, y: disc.y, w: disc.width, h: disc.height };
    }
  }
  const box = shell.getBoundingClientRect();
  const insets = readInsets(shell);
  return {
    x: box.x + insets.left,
    y: box.y + insets.top,
    w: Math.max(0, box.width - insets.left - insets.right),
    h: Math.max(0, box.height - insets.top - insets.bottom),
  };
}

/** Layout box. A closed plan leaves a negative clip inset, and visibleBox
 *  still covers that empty area (R-CT-01). Hits use this once the plan is shut. */
function layoutBox(shell) {
  const left = Number.parseFloat(shell.style.left);
  const top = Number.parseFloat(shell.style.top);
  const width = Number.parseFloat(shell.style.width);
  const height = Number.parseFloat(shell.style.height);
  if (![left, top, width, height].every(Number.isFinite) || width < 1 || height < 1) return null;
  return { x: left, y: top, w: width, h: height };
}

function writeClip(shell, insets) {
  const fill = shell.querySelector(".morph-fill");
  shell.style.clipPath = clipPath(insets);
  if (fill) fill.style.clipPath = clipPath(tighten(insets));
  shell.dataset.clipTop = String(insets.top);
  shell.dataset.clipRight = String(insets.right);
  shell.dataset.clipBottom = String(insets.bottom);
  shell.dataset.clipLeft = String(insets.left);
  shell.dataset.clipRadius = String(insets.radius);
}

function cancelClipAnims(shell, keepPlan = false, keepId = "") {
  const fill = shell.querySelector(".morph-fill");
  const stroke = shell.querySelector(".morph-stroke");
  const drop = (anim) => {
    if (keepId && anim?.id === keepId) return;
    anim.cancel();
  };
  shell.getAnimations?.().forEach(drop);
  fill?.getAnimations?.().forEach(drop);
  stroke?.getAnimations?.().forEach(drop);
  shell.querySelector(".morph-orb")?.getAnimations?.().forEach(drop);
  shell.querySelector(".morph-glow")?.getAnimations?.().forEach(drop);
  if (keepPlan) debugLog("plan-anim-cancel-blocked", "reason=clip");
  else dropPlanAnims(planNode(shell), "clip");
}

/** Stylesheet transitions must not run beside a WAAPI clip. WebKitGTK will
 *  stretch a left or right collapse past 300ms when both are active. */
function holdMotion(el) {
  el?.style.setProperty("transition", "none", "important");
}

function releaseMotion(el) {
  el?.style.removeProperty("transition");
}

function whenAnimEnds(anim, duration, seek = true) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      resolve(ok);
    };
    const started = performance.now();
    const clock = Number(anim.effect?.getTiming?.().duration);
    const limit = Number.isFinite(clock) && clock > 0 ? clock : duration;
    const timer = window.setTimeout(() => {
      if (seek) {
        try {
          if (anim.playState !== "finished") anim.currentTime = limit;
        } catch { /* already finished */ }
      }
      finish(true);
    }, duration);
    anim.finished.then(() => {
      // A document-timeline currentTime resolves this before a painted
      // frame. Compare against the animation's own duration, not the
      // padded wall timeout, so a real 280ms finish still resolves.
      if (performance.now() - started < Math.max(0, limit - 40)) return;
      finish(true);
    }, () => finish(false));
  });
}

/**
 * Pixel keyframes. A 999px radius stays a stadium while the inset grows, and
 * WebKitGTK does not interpolate calc() insets, so both the rect and the
 * corner radius (pill height / 2 → 3px) are plain px and run on the Web
 * Animations API. The duration is the animation's own clock, with no tail
 * timeout that would stretch a left or right collapse past 300ms.
 */
function bleedInsets(insets, px) {
  return {
    top: insets.top - px,
    right: insets.right - px,
    bottom: insets.bottom - px,
    left: insets.left - px,
    radius: insets.radius,
  };
}

/** Panel bleed is -4px on every side. That last 4px is the plan stub.
 *  Hold the plan edge at 0 until the growth clock opens it. */
function sealPlanSide(shell, insets) {
  if (shell?.dataset.planOpen !== "1" || !insets) return insets;
  const side = shell.dataset.planSide === "left" ? "left" : "right";
  if (insets[side] < 0) insets[side] = 0;
  return insets;
}

/** Sample both curves into one shell clip. `elapsedMs` is time since the
 *  plan collapse began. The panel curve still starts at the 160ms handoff
 *  and still lasts `panelMs`; a late call only plays the part that remains. */
function shellOverlapClip(shell, panelMs, elapsedMs = PLAN_COLLAPSE_HANDOFF_MS) {
  if (!(panelMs > 0) || shell.dataset.planOpen !== "1") return null;
  if (!(shell._collapsePlanAt > 0)) {
    const anim = shell.getAnimations?.().find((item) => item.id === "plan-collapse");
    if (!anim || anim.playState === "finished" || anim.playState === "idle") return null;
  }
  const handoff = PLAN_COLLAPSE_HANDOFF_MS;
  const endElapsed = handoff + panelMs;
  const startElapsed = Math.min(Math.max(Number(elapsedMs) || 0, handoff), endElapsed);
  const span = endElapsed - startElapsed;
  if (!(span > 0)) return null;
  const planOpen = planRevealClip(shell, 1).insets;
  const planClosed = planRevealClip(shell, 0).insets;
  const geom = shellGeom(shell);
  const panelFrom = insetsFor("panel", geom);
  const panelTo = insetsFor("orb", geom);
  const planSide = shell.dataset.planSide === "left" ? "left" : "right";
  const count = Math.max(2, Math.round(span / 16));
  const frames = [];
  let start = null;
  let end = null;
  for (let i = 0; i <= count; i += 1) {
    const insets = overlappedCollapseInsets({
      planOpen,
      planClosed,
      panelFrom,
      panelTo,
      planSide,
      elapsedMs: startElapsed + (span * i) / count,
      panelMs,
    });
    if (!start) start = insets;
    end = insets;
    frames.push({ clipPath: clipPath(insets), offset: i / count });
  }
  return { start, end, frames, duration: span };
}

function playClip(shell, fromState, toState, duration, token, easing = EASE) {
  const fill = shell.querySelector(".morph-fill");
  const stroke = shell.querySelector(".morph-stroke");
  const from = insetsFor(fromState, shellGeom(shell));
  const to = insetsFor(toState, shellGeom(shell));
  // The corner stroke is the outer 1px of an 8px box parked at -3px. A clip
  // of exactly -3px eats that pixel. The shell window is one pixel larger
  // than the corner, transparent, so the L sits inside the clip. The blue
  // line is the stroke layer, clipped to the shape, with the glass 1px inside
  // it — every edge of the clip, including the first frame.
  const cornerRoom = FRAME_BLEED + HAIRLINE;
  const shellFrom = toState === "panel" ? bleedInsets(from, cornerRoom) : from;
  const shellTo = toState === "panel" ? bleedInsets(to, cornerRoom) : to;
  if (toState === "panel") sealPlanSide(shell, shellTo);
  const fillFrom = tighten(from);
  const fillTo = tighten(to);
  if (shell.dataset.morphToken !== token) return Promise.resolve(false);
  const armed = toState === "orb" ? shell._panelCollapse : null;
  const armedAnim = armed?.anim || null;
  let armedState = "";
  try { armedState = armedAnim?.playState || ""; } catch { armedState = ""; }
  const armedLive = armedState === "running" || armedState === "pending";
  const armedDone = !!(armed && !armedLive && (armed.done || armedAnim));
  const sincePlan = shell._collapsePlanAt > 0 ? performance.now() - shell._collapsePlanAt : PLAN_COLLAPSE_HANDOFF_MS;
  const overlap = toState === "orb" && !armed ? shellOverlapClip(shell, duration, sincePlan) : null;
  shell.classList.remove("is-growing-pill", "is-growing-panel");
  holdMotion(shell);
  holdMotion(fill);
  if (toState === "orb") {
    holdMotion(stroke);
    holdMotion(shell.querySelector(".morph-orb"));
    holdMotion(shell.querySelector(".morph-glow"));
    debugLog("collapse-plan-keep", `seam=${seamPhase(planNode(shell)) || "-"}`);
    pauseHitSync();
  }
  cancelClipAnims(shell, toState === "orb", armedLive ? "panel-collapse" : "");
  if (reducedMotion() || !(duration > 0)) {
    writeClip(shell, to);
    if (toState === "panel") {
      playContentIn(shell, 0);
      return moveOrbToHeader(shell, token).then(() => shell.dataset.morphToken === token);
    }
    return Promise.resolve(true);
  }
  if (armedDone) {
    writeClip(shell, to);
    commitClosedShell(shell);
    shell.classList.remove("is-growing-pill", "is-growing-panel");
    debugLog("clip-hold", `bot=${shell.dataset.botId || ""} mode=orb`);
    return Promise.resolve(shell.dataset.morphToken === token);
  }
  let waitMs = duration;
  if (armedLive) {
    const elapsed = Math.max(0, performance.now() - (armed.startedAt || 0));
    waitMs = Math.max(0, (armed.duration || duration) - elapsed);
  }
  // Drop the pill's 200ms transition before the panel clip. The panel clock
  // is the WAAPI duration (480ms), and transition-delay stays 0. Collapse
  // skips the layout flush: it was pushing the 300ms clock out by a frame.
  if (!armedLive) writeClip(shell, overlap ? overlap.start : from);
  if (toState !== "orb") void shell.offsetWidth;
  if (!armedLive) shell.style.clipPath = clipPath(overlap ? overlap.start : shellFrom);
  if (fill) fill.style.clipPath = clipPath(fillFrom);
  if (stroke && toState === "panel") stroke.style.clipPath = clipPath(to);
  if (toState === "panel") {
    shell.style.background = "transparent";
    shell.style.setProperty("overflow", "visible", "important");
  }
  shell.style.setProperty("transition", "none", "important");
  shell.style.setProperty("transition-delay", "0s", "important");
  fill?.style.setProperty("transition", "none", "important");
  fill?.style.setProperty("transition-delay", "0s", "important");
  if (toState === "panel") shell.classList.add("is-growing-panel");
  else if (toState === "pill") shell.classList.add("is-growing-pill");
  const timing = { duration, easing, fill: "forwards" };
  const orbMs = armedLive ? waitMs : (overlap ? overlap.duration : duration);
  const orbTiming = toState === "orb" ? { duration: orbMs, easing, fill: "forwards" } : timing;
  let shellAnim;
  let fillAnim;
  let strokeAnim;
  let contentAnim;
  try {
    if (armedLive) shellAnim = armedAnim;
    else {
      shellAnim = shell.animate(
        overlap ? overlap.frames : [
          { clipPath: clipPath(shellFrom) },
          { clipPath: clipPath(shellTo) },
        ],
        overlap ? { duration: overlap.duration, easing: "linear", fill: "forwards", id: "panel-collapse" } : timing,
      );
      if (toState === "orb") noteCollapse(shell, "panel");
    }
    if (overlap) debugLog("collapse-overlap", `edge=${shell.dataset.edge || ""} handoff=${PLAN_COLLAPSE_HANDOFF_MS} panel=${duration} span=${overlap.duration.toFixed(1)}`);
    if (toState === "panel") {
      // Underlying opacity is 1 before the fade exists, so a later fill drop
      // cannot present the stylesheet's opacity 0. Setting it after animate()
      // would restart the fade.
      pinContentOpacity(shell);
      playContentIn(shell, duration);
      moveOrbToHeader(shell, token);
    } else if (toState === "orb") {
      const fromScale = Number(shell._closingScale) || 1;
      if (fromScale < 0.98) scaleOrb(shell, token, fromScale, 1, duration, easing, true);
      const floor = idleOrbOpacity(shell);
      shell._idleDim = shell.animate([
        { opacity: 1, offset: 0 },
        { opacity: 1, offset: 0.82 },
        { opacity: floor, offset: 1 },
      ], { duration: orbMs, easing: "linear", fill: "forwards", id: "orb-idle" });
      if (stroke) {
        strokeAnim = stroke.animate([
          { clipPath: clipPath(from) },
          { clipPath: clipPath(to) },
        ], orbTiming);
      }
    }
    if (fill) {
      fillAnim = fill.animate([
        { clipPath: clipPath(fillFrom) },
        { clipPath: clipPath(fillTo) },
      ], toState === "orb" ? orbTiming : timing);
    }
    if (toState === "orb") {
      const content = shell.querySelector(".center-panel");
      if (content) {
        holdMotion(content);
        content.style.overflow = "hidden";
        content.getAnimations?.().forEach((anim) => {
          if (anim.id === "content-collapse") anim.cancel();
        });
        try {
          contentAnim = content.animate([
            { clipPath: clipPath(fillFrom) },
            { clipPath: clipPath(fillTo) },
          ], { ...orbTiming, id: "content-collapse" });
        } catch { /* the shell clip still covers the panel */ }
      }
    }
    if (toState === "panel") {
      // Resting clip is the final keyframe. The animation paints the from
      // frame; the inline value is what remains if that fill drops.
      shell.style.clipPath = clipPath(shellTo);
      if (fill) fill.style.clipPath = clipPath(fillTo);
    } else if (toState === "orb") {
      // Resting orb is already the inline style. The collapse animation
      // paints the from frame, so the frames after it ends match.
      shell.style.clipPath = clipPath(shellTo);
      if (fill) fill.style.clipPath = clipPath(fillTo);
      const orb = shell.querySelector(".morph-orb");
      if (orb) {
        orb.style.transformOrigin = "center center";
        orb.style.transform = "scale(1)";
      }
    }
    if (toState === "orb") {
      const now = document.timeline?.currentTime;
      if (typeof now === "number") {
        // A clip that starts here must open on its first frame. The panel
        // clip armed at the plan handoff is already on that clock; rewinding
        // it adds the full panel duration after the plan has been running.
        if (!armedLive && shellAnim) {
          shellAnim.startTime = now;
          try { shellAnim.currentTime = 0; } catch { /* already at the first frame */ }
        }
        if (fillAnim) {
          fillAnim.startTime = now;
          try { fillAnim.currentTime = 0; } catch { /* same clock */ }
        }
        if (contentAnim) {
          contentAnim.startTime = now;
          try { contentAnim.currentTime = 0; } catch { /* same clock */ }
        }
        if (strokeAnim) {
          strokeAnim.startTime = now;
          try { strokeAnim.currentTime = 0; } catch { /* same clock */ }
        }
        if (shell._idleDim) {
          shell._idleDim.startTime = now;
          try { shell._idleDim.currentTime = 0; } catch { /* same clock */ }
        }
      }
    }
    if (toState === "panel") watchPresent(shell, shellAnim, "panel");
  } catch {
    writeClip(shell, to);
    if (toState === "panel") {
      playContentIn(shell, 0);
      return moveOrbToHeader(shell, token).then(() => shell.dataset.morphToken === token);
    }
    return Promise.resolve(shell.dataset.morphToken === token);
  }
  // Hits were announced before this clip. A per-frame hit rAF would stop
  // on the finish frame, which is the settle wash. Leave that loop idle.
  pauseHitSync();
  return whenAnimEnds(shellAnim, armedLive ? waitMs : orbMs).then((finished) => {
    if (shell.dataset.morphToken !== token) return false;
    if (!finished) return false;
    // The content fade is the WAAPI started with this clip. Writing opacity
    // or transition here restarts it and drops the seam's first frame.
    holdMotion(shell);
    holdMotion(fill);
    if (toState === "orb") {
      commitClosedShell(shell);
      shell.classList.remove("is-growing-pill", "is-growing-panel");
      // Same pixels as the inline orb clip and scale(1). Cancelling here
      // drops the layer one frame after the panel is already gone.
      debugLog("clip-hold", `bot=${shell.dataset.botId || ""} mode=orb`);
      return true;
    }
    // Leave the clip animation in place. Cancelling it, or swapping the
    // clip to none, drops the layer and one frame paints blank at settle.
    shell._clipHold = shellAnim;
    const fillEl = shell.querySelector(".morph-fill");
    shell.style.clipPath = clipPath(shellTo);
    if (fillEl) {
      fillEl.style.clipPath = clipPath(fillTo);
      fillEl.style.boxShadow = "inset 0 0 0 1px #0000f2";
    }
    shell.dataset.clipTop = String(shellTo.top);
    shell.dataset.clipRight = String(shellTo.right);
    shell.dataset.clipBottom = String(shellTo.bottom);
    shell.dataset.clipLeft = String(shellTo.left);
    shell.dataset.clipRadius = String(shellTo.radius);
    // Keep is-growing-panel. Dropping it here changes the fill color and
    // hides the stroke; that rebuild presents about five frames after settle.
    shell.classList.remove("is-growing-pill");
    debugLog("clip-hold", `bot=${shell.dataset.botId || ""} mode=final`);
    return true;
  });
}

/** Close end-state, still inside the clip completion. No layout read.
 *  Settle must not repeat this, or the finish frame washes. */
function commitClosedShell(shell) {
  markVisual(shell, "orb");
  shell.classList.remove(
    "is-morphing",
    "is-collapsing",
    "is-orb-docked",
    "is-orb-moving",
    "is-content-hold",
    "open",
    "is-growing-panel",
    "is-growing-pill",
    "is-content-promoted",
  );
  shell.dataset.contentOnce = "";
  shell.dataset.opening = "";
  shell.dataset.intent = "";
  shell.querySelectorAll(".center-panel").forEach((panel) => {
    panel.hidden = true;
    panel.getAnimations?.().forEach((anim) => {
      try { anim.cancel(); } catch { /* already idle */ }
    });
    panel.style.removeProperty("clip-path");
    panel.style.removeProperty("overflow");
    panel.style.removeProperty("opacity");
    panel.style.removeProperty("display");
    if (panel.id === "settings" || panel.id === "kanban-panel") {
      for (const prop of ["left", "top", "right", "bottom", "width", "height", "transform", "box-shadow", "filter", "outline"]) {
        panel.style.removeProperty(prop);
      }
    }
  });
  const plan = planNode(shell);
  if (plan) {
    plan.hidden = true;
    plan.style.visibility = "hidden";
  }
  const orb = shell.querySelector(".morph-orb");
  const fill = shell.querySelector(".morph-fill");
  const glow = shell.querySelector(".morph-glow");
  // Header docking and the collapse layer leave will-change / translateZ.
  // That retitles the idle disc: the 1px blue rim goes light after one
  // open/close (R-OB-01). A fresh orb has none of these inline hints.
  const stroke = shell.querySelector(".morph-stroke");
  for (const el of [shell, fill, orb, glow, stroke]) {
    if (!el) continue;
    el.style.removeProperty("will-change");
    el.style.removeProperty("filter");
    el.style.removeProperty("background");
    el.style.removeProperty("background-color");
    el.style.removeProperty("overflow");
    el.style.removeProperty("box-shadow");
    if (restingTransform(el.style.transform)) el.style.removeProperty("transform");
    el.style.removeProperty("transition");
    el.style.removeProperty("transition-delay");
  }
  // Kanban and settings stamp --bot-rgb onto the shell while the panel is
  // open. The idle ::after rim inherits that and the blue edge is gone
  // (R-OB-01). A fresh chrome orb has the colour on the button only.
  // Cron's idle disc is painted with the shell colour from the first frame.
  if (shell.dataset.kind === "chrome" && shell.dataset.botId !== "cron") {
    shell.style.removeProperty("--bot");
    shell.style.removeProperty("--bot-rgb");
    shell.style.removeProperty("--bot-color");
  }
  const idle = insetsFor("orb", shellGeom(shell));
  // writeClip pins the 44px disc (and the dataset hit insets) so cancelling
  // the collapse's fill:forwards clip cannot flash the full panel. The next
  // line widens that same clip to the 34px halo circle.
  writeClip(shell, idle);
  restoreIdleOrbClip(shell, idle);
  const floor = String(idleOrbOpacity(shell));
  if (shell.style.getPropertyValue("--hit-opacity") !== floor) {
    shell.style.setProperty("--hit-opacity", floor);
  }
  // The collapse dim is fill:forwards. Once the orb rule owns opacity, that
  // animation keeps a promoted layer and the idle rim washes out (R-OB-01).
  const dim = shell._idleDim;
  if (dim && (dim.playState === "finished" || dim.playState === "idle")) {
    try { dim.cancel(); } catch { /* the stylesheet opacity is the floor */ }
    shell._idleDim = null;
  }
  if (orb) {
    orb.getAnimations?.().forEach((anim) => {
      try { anim.cancel(); } catch { /* already idle */ }
    });
    orb.style.removeProperty("transform");
    orb.style.removeProperty("transform-origin");
    orb.style.removeProperty("outline");
    orb.style.removeProperty("box-shadow");
    orb.style.removeProperty("filter");
    if (orb.ownerDocument?.activeElement === orb) orb.blur();
  }
  if (orb?.classList.contains("active") && !state.openIds.includes(shell.dataset.botId)) {
    orb.classList.remove("active");
  }
  debugLog("orb-restyle", `when=collapse-end class=active-off opacity=${floor}`);
  logCollapseSpan(shell);
}

/** scale(1) and translateZ(0) are collapse leftovers, not an idle disc. */
function restingTransform(value) {
  const text = String(value || "").trim();
  if (!text || text === "none") return true;
  return text.split(/\s+/).every((part) => (
    part === "none"
    || part === "scale(1)"
    || /^translateZ\(0(px)?\)$/.test(part)
    || /^translate3d\(0(px)?,\s*0(px)?,\s*0(px)?\)$/.test(part)
  ));
}

function idleOrbOpacity(shell) {
  void shell;
  // Resting orbs are opaque (R-OB-05). The near fade is the proximity poll,
  // not this collapse floor. A missing cursor must not leave the disc dim.
  return 1;
}

function planWidthPx() {
  return Math.min(420, (window.innerWidth || 1280) * 0.42);
}

/** Final plan border box, including the close control and the 1px border.
 *  Measured only while the panel clip still covers the plan. The seam
 *  clock reads `dataset.planWidth` and must not measure again. */
function commitPlanWidth(shell, plan, { measure = false } = {}) {
  let width = Math.max(
    Math.round(planWidthPx()),
    Math.round(Number(shell?.dataset?.planWidth) || 0),
  );
  if (measure && plan) {
    const laid = Math.round(plan.offsetWidth || 0);
    if (laid > width) width = laid;
    const close = plan.querySelector("[data-role='plan-close']");
    if (close && laid > 0) {
      let edge = 0;
      if (close.offsetParent === plan) edge = Math.ceil(close.offsetLeft + close.offsetWidth + 1);
      else {
        const box = plan.getBoundingClientRect();
        const button = close.getBoundingClientRect();
        edge = Math.ceil(button.right - box.left + 1);
      }
      if (edge > width && edge - width < 64) width = edge;
    }
  }
  const prev = shell?.dataset?.planWidth || "";
  if (shell) shell.dataset.planWidth = String(width);
  if (plan && width > 0) {
    const px = `${width}px`;
    plan.style.width = px;
    plan.style.minWidth = px;
    plan.style.maxWidth = px;
    plan._planClose = plan.querySelector("[data-role='plan-close']") || plan._planClose || null;
    watchPlanGeometry(plan);
  }
  if (prev && prev !== String(width)) {
    debugLog("plan-geometry", `commit ${prev}->${width} call=${callerTag("commitPlanWidth")}`);
  }
  return width;
}

function watchPlanGeometry(plan) {
  if (!debugFile.enabled || !plan || plan._geomWatch || typeof MutationObserver !== "function") return;
  plan._geomWatch = true;
  let width = plan.style.width;
  let node = plan.querySelector("[data-role='plan-close']");
  const observer = new MutationObserver(() => {
    const next = plan.style.width;
    const live = plan.querySelector("[data-role='plan-close']");
    if (next === width && live === node) return;
    debugLog("plan-geometry", `mut w=${width || "-"}->${next || "-"} close=${live === node ? "same" : "replaced"}`);
    width = next;
    node = live;
  });
  observer.observe(plan, {
    attributes: true,
    attributeFilter: ["style"],
    subtree: true,
    childList: true,
  });
}

/** Side from the parked box. Reading layout here is what stalls the seam. */
function sideFromStyle(shell) {
  const left = Number.parseFloat(shell.style.left) || 0;
  const top = Number.parseFloat(shell.style.top) || 0;
  const width = Number.parseFloat(shell.style.width) || 0;
  const height = Number.parseFloat(shell.style.height) || 0;
  return fitPlanBox({
    shellLeft: left,
    shellTop: top,
    shellW: width,
    shellH: height,
    planW: Math.max(planWidthPx(), Number(shell?.dataset?.planWidth) || 0),
    screenW: window.innerWidth || 0,
    screenH: window.innerHeight || 0,
  }).side;
}

function fittedPlanPane(hostBox, width) {
  return fitPlanBox({
    shellLeft: hostBox?.x || 0,
    shellTop: hostBox?.y || 0,
    shellW: hostBox?.width ?? hostBox?.w ?? 0,
    shellH: hostBox?.height ?? hostBox?.h ?? 0,
    planW: width,
    screenW: window.innerWidth || 0,
    screenH: window.innerHeight || 0,
  });
}

/** Shell clip that reveals `t` of the plan (0..1 through planEase).
 *  The plan box stays full size. Only this outward inset changes.
 *  t = 0 keeps the plan edge at 0 so the panel bleed cannot show a stub. */
function planRevealClip(shell, t) {
  const reveal = t <= 0 ? 0 : t >= 1 ? 1 : planEase(t);
  const base = bleedInsets(insetsFor("panel", shellGeom(shell)), FRAME_BLEED + HAIRLINE);
  const extra = settledPlanReach(Number(shell.dataset.planWidth) || planWidthPx());
  const shown = extra * reveal;
  if (shell.dataset.planSide === "left") base.left = -shown;
  else base.right = -shown;
  return { value: clipPath(base), insets: base, reveal };
}

/** Fully open shell clip in whole pixels. Ceil an outward inset so the last
 *  sample cannot land a fraction short of the locked width. The settled clip
 *  stays this inset; clearing it to none paints a blank frame. */
function exactOpenClip(shell) {
  const base = planRevealClip(shell, 1).insets;
  for (const key of ["top", "right", "bottom", "left"]) {
    const value = Number(base[key]) || 0;
    base[key] = value < 0 ? -Math.ceil(-value) : Math.floor(value);
  }
  base.radius = Math.round(Number(base.radius) || 0);
  return clipPath(base);
}

/** Widen the held clip over the plan. Left and right share this path: only
 *  the outward edge changes, and the clip animation stays. */
function holdPlanClip(shell, reveal = 1) {
  if (!shell || shell.dataset.planOpen !== "1") return;
  const clip = planRevealClip(shell, reveal);
  const { value, insets: base } = clip;
  const anim = shell._clipHold;
  if (anim?.effect?.setKeyframes) {
    try {
      anim.effect.setKeyframes([{ clipPath: value }, { clipPath: value }]);
    } catch { /* inline value below matches if the effect is already gone */ }
  }
  shell.style.clipPath = value;
  shell.dataset.clipTop = String(base.top);
  shell.dataset.clipRight = String(base.right);
  shell.dataset.clipBottom = String(base.bottom);
  shell.dataset.clipLeft = String(base.left);
  shell.dataset.clipRadius = String(base.radius);
  debugLog("clip-hold", `bot=${shell.dataset.botId || ""} mode=widen side=${shell.dataset.planSide || "right"} reveal=${clip.reveal.toFixed(3)}`);
}

/** The plan sits outside the shell box. Keep the clip layer and stretch it
 *  over the plan; removing the clip paints one blank frame at settle. */
function showPlanHost(shell) {
  shell.style.setProperty("overflow", "visible", "important");
  shell.style.background = "transparent";
  shell.style.setProperty("filter", "none", "important");
  const fill = shell.querySelector(".morph-fill");
  if (fill && !fill.style.clipPath) fill.style.clipPath = "inset(0px 0px 0px 0px round 3px)";
}

function planFitEl(plan) {
  return plan?.querySelector?.(":scope > .plan-fit") || null;
}

/** Corners stay on the plan. Everything else counter-scales inside .plan-fit. */
function ensurePlanFit(plan) {
  const ready = planFitEl(plan);
  if (ready) return ready;
  const fit = document.createElement("div");
  fit.className = "plan-fit";
  const moving = [...plan.childNodes].filter((node) => (
    !node.classList?.contains("hud-corner") && !node.classList?.contains("plan-raster")
  ));
  fit.append(...moving);
  plan.append(fit);
  return fit;
}

function seamOrigin(shell) {
  return shell.dataset.planSide === "left" ? "right center" : "left center";
}

function hideUnwarmedPlan(shell) {
  const plan = planNode(shell);
  if (plan) {
    plan.hidden = true;
    setSeamPhase(plan, "");
    delete plan.dataset.sizeLock;
    clearPlanMotion(plan);
    plan.style.width = "";
    plan.style.height = "";
    plan.style.minWidth = "";
    plan.style.maxWidth = "";
    forgetPlanWarm(plan);
  }
  if (shell) {
    restoreHostedPlan(shell);
    const wasOpen = shell.dataset.planOpen === "1";
    delete shell.dataset.planOpen;
    shell.classList.remove("is-plan-seam", "is-plan-arming");
    // announcePanelHits already published the plan union and then went
    // silent. Hiding the plan without retracting leaves that empty pane
    // capturing clicks (R-CT-01).
    if (wasOpen) retractPlanHit(shell);
  }
}

/** Freeze, quiet, and plan-hold clocks live off the DOM. Writing them onto
 *  the shell at growth finish was a style recalc in the same task as the seam. */
const shellClock = new WeakMap();

function clockOf(shell) {
  let clock = shellClock.get(shell);
  if (!clock) {
    clock = { freeze: 0, quiet: 0, plan: 0 };
    shellClock.set(shell, clock);
  }
  return clock;
}

function holdClock(shell, key, ms) {
  if (!shell || !(ms > 0)) return 0;
  const clock = clockOf(shell);
  const until = performance.now() + ms;
  if (until > clock[key]) clock[key] = until;
  return clock[key];
}

function clockAt(shell, key) {
  return shellClock.get(shell)?.[key] || 0;
}

function shellFrozen(shell) {
  if (!shell) return false;
  if (shell._motion) return true;
  if (shell.classList.contains("is-plan-seam")
    || shell.classList.contains("is-plan-arming")
    || shell.classList.contains("is-collapsing")) return true;
  return performance.now() < clockAt(shell, "freeze");
}

function motionFrozen() {
  if (document.querySelector(".morph.is-collapsing, .morph.is-plan-seam, .morph.is-plan-arming")) {
    return true;
  }
  const now = performance.now();
  return [...document.querySelectorAll(".morph")].some((shell) => shell._motion || now < clockAt(shell, "freeze"));
}

/** Any shell still on a morph, plan, or settle clock. Background paints wait. */
function presentationBusy() {
  if (motionFrozen()) return true;
  if (document.querySelector(".morph.is-morphing, .morph.is-plan-seam, .morph.is-plan-arming")) return true;
  const now = performance.now();
  return [...document.querySelectorAll(".morph")].some((shell) => {
    if (shell._settleGate || shell._motion) return true;
    return now < clockAt(shell, "quiet") || now < clockAt(shell, "freeze");
  });
}

function backgroundBlocked() {
  return collapseBusy() || collapseQuiet() || presentationBusy();
}

/** Timestamp only. Settle must not cancel an animation, stop an rAF loop,
 *  or remove a listener in the same turn. */
function holdFreeze(shell, ms) {
  if (!shell || !(ms > 0)) return;
  holdClock(shell, "freeze", ms);
  debugLog("freeze", `bot=${shell.dataset.botId || ""} ms=${ms}`);
}

/** A live seam stays at fill:forwards. Cancelling it on the finish frame
 *  paints the pre-animation scale for one or two frames. */
function planAnimLocked(plan, shell) {
  if (!plan) return false;
  if (shell?.classList.contains("is-collapsing")
    || shell?.classList.contains("is-morphing")
    || shell?.classList.contains("is-plan-seam")
    || shell?.classList.contains("is-plan-arming")) return true;
  if (performance.now() < clockAt(shell, "freeze")) return true;
  if (plan.dataset.sizeLock === "1") return true;
  const phase = seamPhase(plan);
  if (phase === "growing" || phase === "grown") return true;
  return false;
}

function dropPlanAnims(plan, reason) {
  if (!plan) return;
  const shell = shellOfPlan(plan);
  if (planAnimLocked(plan, shell)) {
    debugLog("plan-anim-cancel-blocked", `reason=${reason} seam=${seamPhase(plan) || "-"}`);
    return;
  }
  const fit = planFitEl(plan);
  plan.getAnimations?.().forEach((anim) => {
    debugLog("plan-anim-cancel", `reason=${reason} id=${anim.id || ""} state=${anim.playState || ""}`);
    seamLog("anim-cancel", `${reason} ${anim.id || anim.playState || ""}`);
    anim.cancel();
  });
  fit?.getAnimations?.().forEach((anim) => anim.cancel());
}

function cancelPlanAnims(plan, fit) {
  if (!plan) {
    fit?.getAnimations?.().forEach((anim) => anim.cancel());
    return;
  }
  dropPlanAnims(plan, "clear");
}

/** Full size. Leave the finished animation at fill:forwards. Cancelling it
 *  paints one frame of the underlying seam on a warm layer (about 26%). */
function lockPlanRevealed(plan) {
  if (!plan) return;
  const fit = planFitEl(plan);
  const shell = shellOfPlan(plan);
  const full = Math.round(Number(shell?.dataset.planWidth) || planWidthPx());
  plan.style.visibility = "visible";
  plan.classList.remove("is-plan-parked");
  plan.style.removeProperty("transform");
  if (fit) {
    fit.style.removeProperty("transform");
    fit.style.flex = "none";
    fit.style.width = "100%";
    fit.style.maxWidth = "100%";
    fit.style.boxSizing = "border-box";
    fit.style.alignSelf = shell?.dataset.planSide === "left" ? "flex-end" : "flex-start";
  }
  plan.style.width = `${full}px`;
  void getComputedStyle(plan).width;
  plan.style.opacity = "";
  plan.style.removeProperty("z-index");
  plan.style.removeProperty("pointer-events");
  if (plan.dataset.sizeLock !== "1") {
    plan.style.removeProperty("will-change");
    if (fit) fit.style.removeProperty("will-change");
  }
  setSeamPhase(plan, "grown");
  hostOpenPlan(shell);
  // The sliver lock is the path that actually hosts the plan. The clip
  // finish also logs, but this run often never reaches that frame.
  logPlanHitBox(shell);
  requestAnimationFrame(() => logPlanHitBox(shell));
  seamLog("lock", "width=final kept");
}

/** Seam phase is a JS field. The finish frame must not write data-seam:
 *  that attribute change repaints the underlying scaleX(0.001) for one frame. */
function seamPhase(plan) {
  if (!plan) return "";
  return plan._seamPhase || "";
}

function paintedScaleX(transform) {
  if (!transform || transform === "none") return 1;
  const matched = transform.match(/matrix\(([^)]+)\)/);
  if (!matched) return 1;
  const scale = Number(matched[1].split(",")[0]);
  return Number.isFinite(scale) ? scale : 1;
}

/** Next open only. Pin scaleX(1), flush, then cancel. Never call this from
 *  the growth-finish task: that frame must leave fill:forwards alone. */
function retireGrownSeam(plan) {
  if (!plan || seamPhase(plan) !== "grown") return;
  const fit = planFitEl(plan);
  const shell = shellOfPlan(plan);
  const full = Math.round(Number(shell?.dataset.planWidth) || planWidthPx());
  plan.style.width = `${full}px`;
  if (fit) {
    fit.style.flex = "none";
    fit.style.width = "100%";
    fit.style.maxWidth = "100%";
    fit.style.boxSizing = "border-box";
  }
  plan.style.removeProperty("transform");
  if (fit) fit.style.removeProperty("transform");
  const painted = getComputedStyle(plan).transform;
  if (fit) void getComputedStyle(fit).transform;
  if (paintedScaleX(painted) < 0.99) return;
  plan.getAnimations?.().forEach((anim) => {
    debugLog("plan-anim-cancel", `reason=reopen id=${anim.id || ""} state=${anim.playState || ""}`);
    anim.cancel();
  });
  fit?.getAnimations?.().forEach((anim) => anim.cancel());
  setSeamPhase(plan, "");
}

function setSeamPhase(plan, phase, { dom = true } = {}) {
  if (!plan) return;
  if (phase) plan._seamPhase = phase;
  else delete plan._seamPhase;
  if (!dom) return;
  if (phase) plan.dataset.seam = phase;
  else delete plan.dataset.seam;
}

function clearPlanMotion(plan) {
  if (!plan) return;
  stopSeamClock(plan);
  const fit = planFitEl(plan);
  if (seamPhase(plan) === "grown" || seamPhase(plan) === "growing") {
    return;
  }
  cancelPlanAnims(plan, fit);
  plan.style.transform = "";
  plan.style.opacity = "";
  plan.style.removeProperty("z-index");
  plan.style.removeProperty("clip-path");
  plan.style.removeProperty("will-change");
  plan.style.removeProperty("pointer-events");
  plan.style.removeProperty("visibility");
  plan.classList.remove("is-plan-parked");
  if (fit) {
    fit.style.transform = "";
    fit.style.removeProperty("will-change");
  }
}

const seamPhases = [];

function seamMark(name) {
  const now = performance.now();
  try { performance.mark(name); } catch { /* duplicate marks are fine */ }
  const prev = seamPhases.at(-1);
  const dt = prev ? now - prev.t : 0;
  seamPhases.push({ name, t: now });
  const line = `[plan-seam] ${name}${prev ? ` +${dt.toFixed(0)}ms` : ""}`;
  if (dt > 40) console.warn(line);
  else console.info(line);
}

/** Quiet window after the plan reaches full size. Queued DOM work waits this out. */
const FREEZE_AFTER_GROW_MS = 600;

const debugFile = { enabled: false, invoke: null };

function callerTag(skip) {
  const stack = (new Error().stack || "").split("\n");
  const skipNames = new Set(["callerTag", "debugLog", "seamLog", skip].filter(Boolean));
  for (const raw of stack) {
    const frame = raw.trim().replace(/^at\s+/, "");
    const name = frame.split(/[@(]/)[0].trim();
    if (!name || skipNames.has(name)) continue;
    if (name === "Error") continue;
    return name.slice(0, 160);
  }
  return "top";
}

/** Opt-in file log. Release builds hide the console; the box sets
 *  HERMES_OVERLAY_DEBUG_LOG to a path and lines land there off the GTK thread. */
function debugLog(event, detail = "") {
  if (!debugFile.enabled || !debugFile.invoke) return;
  const line = `${new Date().toISOString()} t=${performance.now().toFixed(1)} ${event}${detail ? ` ${detail}` : ""}`;
  debugFile.invoke("debug_log", { line }).catch(() => {});
}

async function armDebugLog() {
  if (!inTauri()) return;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    debugFile.invoke = invoke;
    debugFile.enabled = !!(await invoke("debug_log_enabled"));
    if (debugFile.enabled) debugLog("boot", "HERMES_OVERLAY_DEBUG_LOG");
  } catch {
    debugFile.enabled = false;
  }
}

function seamLog(event, detail = "") {
  const plan = document.querySelector(".plan-window");
  const phase = seamPhase(plan) || "-";
  const scale = plan ? (plan.style.transform || "style-empty") : "no-plan";
  const width = plan ? (plan.style.width || "width-empty") : "no-plan";
  console.info(`[plan-seam] ${event} t=${performance.now().toFixed(1)} seam=${phase} node=${plan?.dataset.seamNode || "-"} ${scale} width=${width} ${detail}`);
  debugLog(`plan-${event}`, `seam=${phase} ${scale} width=${width} ${detail}`);
}

function installPlanDomLog() {
  if (installPlanDomLog.installed || typeof MutationObserver !== "function") return;
  installPlanDomLog.installed = true;
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node.nodeType !== 1) continue;
        const plan = node.classList?.contains("plan-window") ? node : node.querySelector?.(".plan-window");
        if (plan) seamLog("dom-add", `id=${plan.dataset.seamNode || "new"}`);
      }
      for (const node of record.removedNodes) {
        if (node.nodeType !== 1) continue;
        const plan = node.classList?.contains("plan-window") ? node : node.querySelector?.(".plan-window");
        if (plan) seamLog("dom-remove", `id=${plan.dataset.seamNode || "?"}`);
      }
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
}

let seamWatchUntil = 0;

function seamWatching() {
  return performance.now() < seamWatchUntil
    || !!document.querySelector(".morph.is-plan-seam, .morph.is-plan-arming");
}

function armSeamWatch(ms = 1600) {
  seamWatchUntil = Math.max(seamWatchUntil, performance.now() + ms);
  installSeamWatch();
}

function installSeamWatch() {
  if (installSeamWatch.installed) return;
  installSeamWatch.installed = true;
  try {
    const observer = new PerformanceObserver((list) => {
      if (!seamWatching()) return;
      for (const entry of list.getEntries()) {
        console.warn(`[plan-seam] long task ${Math.round(entry.duration)}ms`);
      }
    });
    observer.observe({ type: "longtask", buffered: true });
  } catch {
    /* WebKitGTK has no longtask entries. Frame gaps below cover that. */
  }
}

function watchSeamFrames() {
  let last = performance.now();
  let ticks = 0;
  const step = (now) => {
    const gap = now - last;
    if (gap > 50) console.warn(`[plan-seam] frame gap ${Math.round(gap)}ms`);
    last = now;
    ticks += 1;
    if (ticks < 20 && document.querySelector(".morph.is-plan-seam")) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/** Sit the full-size plan on top of the panel, under the opaque glass.
 *  WebKitGTK does not rasterise opacity:0, so the real markdown paint has to
 *  happen here, during the panel clip, not on the first seam frame. */
function applyParkedPlan(shell, plan) {
  releasePlanDock(plan);
  const fit = ensurePlanFit(plan);
  const origin = seamOrigin(shell);
  const shift = shell.dataset.planSide === "left" ? "100%" : "-100%";
  plan.hidden = false;
  plan.classList.add("is-seam-grow", "is-plan-parked");
  plan.style.setProperty("display", "flex", "important");
  plan.style.setProperty("overflow", "hidden", "important");
  plan.style.visibility = "visible";
  plan.style.pointerEvents = "none";
  plan.style.opacity = "1";
  plan.style.zIndex = "-1";
  plan.style.willChange = "transform";
  fit.style.willChange = "transform";
  plan.style.transformOrigin = origin;
  fit.style.transformOrigin = origin;
  plan.style.removeProperty("clip-path");
  holdMotion(plan);
  holdMotion(fit);
  plan.style.transform = `translateX(${shift})`;
  fit.style.removeProperty("transform");
  return fit;
}

/** Freeze the plan border box so a later markdown swap cannot change the
 *  measured width. The pixels come from the warm pass, before the clip. */
function lockPlanBox(shell, plan) {
  if (!plan) return;
  const width = Number(shell?.dataset.planWidth) || Math.round(planWidthPx());
  const height = Number(shell?.dataset.planHeight)
    || Math.round(Number.parseFloat(shell?.style.height) || 0);
  if (height > 0) plan.style.height = `${height}px`;
  plan.style.setProperty("overflow", "hidden", "important");
  plan.dataset.sizeLock = "1";
  plan.style.width = `${width}px`;
  const fit = ensurePlanFit(plan);
  fit.style.overflow = "hidden";
  fit.style.flex = "none";
  fit.style.width = "100%";
  fit.style.maxWidth = "100%";
  fit.style.boxSizing = "border-box";
  fit.style.height = "100%";
  fit.style.alignSelf = shell?.dataset.planSide === "left" ? "flex-end" : "flex-start";
}

function releasePlanBox(plan) {
  if (!plan || plan.dataset.sizeLock !== "1") return;
  const shell = shellOfPlan(plan);
  if (shellFrozen(shell) || shell?.classList.contains("is-plan-seam")) return;
  if (seamPhase(plan) === "grown" || seamPhase(plan) === "growing") {
    debugLog("plan-unlock", "keep-fill");
    return;
  }
  if (shell?.dataset.planOpen === "1") {
    debugLog("plan-unlock", "keep-open");
    return;
  }
  delete plan.dataset.sizeLock;
  plan.style.width = "";
  plan.style.height = "";
  plan.style.minWidth = "";
  plan.style.maxWidth = "";
  plan.style.removeProperty("overflow");
  plan.style.removeProperty("will-change");
  const fit = planFitEl(plan);
  if (fit) {
    fit.style.overflow = "";
    fit.style.width = "";
    fit.style.height = "";
    fit.style.removeProperty("will-change");
  }
  plan.classList.remove("is-seam-grow");
  plan.style.removeProperty("display");
  if (shell?.dataset.planOpen === "1") {
    plan.style.setProperty("overflow", "visible", "important");
  }
}

function planHostReady(shell) {
  if (!shell) return false;
  if (shell.dataset.opening === "panel") return true;
  return (shell.dataset.visual || shell.dataset.state) === "panel";
}

function planRasterHost(plan) {
  return plan?.querySelector?.(":scope > .plan-raster") || null;
}

function ensurePlanRaster(plan) {
  const ready = planRasterHost(plan);
  if (ready) return ready;
  const host = document.createElement("div");
  host.className = "plan-raster";
  host.setAttribute("aria-hidden", "true");
  plan.append(host);
  return host;
}

function fontFaceCss() {
  let text = "";
  const sheets = document.styleSheets;
  if (!sheets) return text;
  for (const sheet of sheets) {
    let rules;
    try { rules = sheet.cssRules; } catch { continue; }
    if (!rules) continue;
    for (const rule of rules) {
      if (rule.type === CSSRule.FONT_FACE_RULE) text += `${rule.cssText}\n`;
    }
  }
  return text.replace(/<\/style/gi, "<\\/style");
}

const RASTER_PROPS = [
  "display", "position", "box-sizing", "width", "height", "min-width", "max-width",
  "margin", "padding", "border", "border-radius", "background", "background-color",
  "color", "font", "font-family", "font-size", "font-weight", "line-height",
  "letter-spacing", "white-space", "text-align", "overflow", "flex", "flex-direction",
  "align-items", "justify-content", "gap", "list-style", "text-decoration",
];

function inlinePaintStyles(source, clone) {
  const view = source.ownerDocument?.defaultView;
  if (!view?.getComputedStyle) return;
  const walk = (from, to) => {
    if (from.nodeType !== 1 || to.nodeType !== 1) return;
    let computed;
    try { computed = view.getComputedStyle(from); } catch { computed = null; }
    if (computed) {
      const bits = [];
      for (const name of RASTER_PROPS) {
        const value = computed.getPropertyValue(name);
        if (value) bits.push(`${name}:${value}`);
      }
      const prev = to.getAttribute("style") || "";
      to.setAttribute("style", `${bits.join(";")};${prev}`);
    }
    const fromKids = [...from.children];
    const toKids = [...to.children];
    for (let i = 0; i < fromKids.length && i < toKids.length; i += 1) walk(fromKids[i], toKids[i]);
  };
  walk(source, clone);
}

function rasterInk(ctx, width, height) {
  let ink = 0;
  try {
    const sample = ctx.getImageData(0, 0, width, height).data;
    for (let i = 3; i < sample.length; i += 64) {
      if (sample[i] > 12) ink += 1;
    }
  } catch {
    return -1;
  }
  return ink;
}

function styleRasterBox(node, width, height) {
  node.style.width = `${width}px`;
  node.style.height = `${height}px`;
  node.style.pointerEvents = "none";
}

/** Snapshot the parked plan while the panel clip still covers it.
 *  A blank canvas is discarded so the seam never reveals an empty bitmap. */
function capturePlanRaster(plan) {
  if (!plan || plan.dataset.raster || plan._rasterTask) return;
  // A style walk after the clock has started is a main-thread gap, and the
  // clip then stops presenting until the animation is already finished.
  const phase = seamPhase(plan);
  if (phase === "growing" || phase === "grown") return;
  const fit = planFitEl(plan);
  const shell = shellOfPlan(plan);
  const width = Math.round(Number(shell?.dataset.planWidth) || plan.offsetWidth || 0);
  const height = Math.round(Number(shell?.dataset.planHeight) || plan.offsetHeight || 0);
  if (!fit || width < 2 || height < 2 || typeof XMLSerializer !== "function") {
    plan.dataset.raster = "live";
    return;
  }
  plan._rasterTask = 1;
  const canvas = document.createElement("canvas");
  canvas.className = "plan-raster-bmp";
  let svg = "";
  try {
    const clone = fit.cloneNode(true);
    inlinePaintStyles(fit, clone);
    clone.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
    const faces = fontFaceCss();
    const body = new XMLSerializer().serializeToString(clone);
    svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <foreignObject x="0" y="0" width="${width}" height="${height}">
    <div xmlns="http://www.w3.org/1999/xhtml" style="width:${width}px;height:${height}px;overflow:hidden;visibility:visible;background:#f8f8fc">
      ${faces ? `<style>${faces}</style>` : ""}
      ${body}
    </div>
  </foreignObject>
</svg>`;
  } catch {
    plan.dataset.raster = "live";
    plan._rasterTask = 0;
    debugLog("plan-raster", "serialize-failed");
    return;
  }
  const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  let settled = false;
  const finish = (mode, reason) => {
    if (settled) return;
    settled = true;
    URL.revokeObjectURL(url);
    plan.dataset.raster = mode;
    plan._rasterTask = 0;
    debugLog("plan-raster", reason);
  };
  const drawBitmap = (source, allowImage) => {
    if (!canvas || !plan.isConnected) {
      finish("live", "detached");
      return "live";
    }
    if (seamPhase(plan) === "growing" || seamPhase(plan) === "grown") {
      finish("live", "late");
      return "live";
    }
    canvas.width = width;
    canvas.height = height;
    let tainted = false;
    try {
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(source, 0, 0, width, height);
      const ink = rasterInk(ctx, width, height);
      if (ink > 0) {
        const host = ensurePlanRaster(plan);
        host.textContent = "";
        host.append(canvas);
        styleRasterBox(canvas, width, height);
        finish("1", `ok w=${width} h=${height} ink=${ink}`);
        return "ok";
      }
    } catch {
      tainted = true;
    }
    // An unverified image is not shown. A blank bitmap would hide the live plan.
    if (!allowImage) return "retry";
    finish("live", tainted ? `tainted w=${width} h=${height}` : `blank w=${width} h=${height}`);
    return "live";
  };
  const loadImage = () => {
    const img = new Image();
    img.onload = () => drawBitmap(img, true);
    img.onerror = () => finish("live", "error");
    img.src = url;
  };
  if (typeof createImageBitmap === "function") {
    createImageBitmap(blob).then((bitmap) => {
      const result = drawBitmap(bitmap, false);
      bitmap.close?.();
      if (result === "retry") loadImage();
    }).catch(() => loadImage());
    return;
  }
  loadImage();
}

function planInk(plan) {
  const text = plan?.querySelector?.("[data-role='plan-body']")?.textContent || "";
  const title = plan?.querySelector?.("[data-role='plan-title']")?.textContent || "";
  return `${title}${text}`.trim().length;
}

/** Warm is real only after several presented frames, with the same text
 *  still in the plan. A single currentTime read does not count: on the cold
 *  open WebKit can report the document timeline (~seconds) as the animation
 *  clock, so a 6ms sample looks like 120ms. */
function planPresented(plan) {
  if (!plan || plan.dataset.warmPresented !== "1") return false;
  if ((Number(plan.dataset.warmFrames) || 0) < 6) return false;
  const ink = planInk(plan);
  return ink > 0 && plan.dataset.warmInk === String(ink);
}

function forgetPlanWarm(plan) {
  if (!plan) return;
  plan.getAnimations?.().forEach((anim) => {
    if (anim.id === "plan-warm") anim.cancel();
  });
  delete plan.dataset.warm;
  delete plan.dataset.warmPresented;
  delete plan.dataset.warmInk;
  delete plan.dataset.warmFrames;
  delete plan.dataset.painted;
  delete plan.dataset.raster;
}

/** Lay the plan out and promote a transform layer before the seam clock.
 *  Opacity 0 and a plan hidden under opaque glass are both skipped by
 *  WebKitGTK, so the cold open never uploads tiles. The reveal runs at
 *  0.01, inside the panel clip, and sweeps every plan clip size. */
function warmPlanLayer(shell) {
  const plan = planNode(shell);
  if (!plan || shell.dataset.planOpen !== "1" || !planHostReady(shell)) return;
  if (seamLocked(plan)) return;
  const ink = planInk(plan);
  if (plan.dataset.warm === "1" && planPresented(plan)) return;
  if (plan.dataset.warmInk && plan.dataset.warmInk !== String(ink)) forgetPlanWarm(plan);
  applyParkedPlan(shell, plan);
  armSeamWatch(2000);
  seamMark("plan-seam:warm");
  void plan.offsetWidth;
  const laid = Math.round(plan.offsetWidth || 0);
  if (laid < 1) {
    plan.hidden = true;
    clearPlanMotion(plan);
    return;
  }
  commitPlanWidth(shell, plan, { measure: true });
  shell.dataset.planHeight = String(Math.round(plan.offsetHeight || 0));
  const fit = ensurePlanFit(plan);
  fit.style.flex = "none";
  fit.style.width = "100%";
  fit.style.maxWidth = "100%";
  fit.style.boxSizing = "border-box";
  fit.style.height = "100%";
  fit.style.alignSelf = shell.dataset.planSide === "left" ? "flex-end" : "flex-start";
  plan.style.willChange = "transform";
  fit.style.willChange = "transform";
  plan.dataset.warm = "1";
  plan.dataset.warmInk = String(ink);
  const anim = pumpPlanWarm(shell, plan);
  // applyParkedPlan just buried the layer. Lift again even when the sweep
  // is already running, or a second warm call puts it back under the glass.
  liftPlanWarm(plan);
  watchPlanWarm(plan, anim);
}

/** Above the paper, barely visible, still inside the panel clip via the
 *  parked translate. z-index -1 under #f8f8fc is occlusion-culled. */
function liftPlanWarm(plan) {
  if (!plan) return;
  plan.style.setProperty("opacity", "0.01");
  plan.style.zIndex = "4";
}

/** Full-width throwaway while the panel clip still covers the side.
 *  The plan's own px clip walks every reveal size so the cold compositor
 *  uploads those tiles before the real clock. */
function pumpPlanWarm(shell, plan) {
  const running = plan?.getAnimations?.().find((anim) => anim.id === "plan-warm" && anim.playState === "running");
  if (!plan || running) return running || null;
  const side = shell?.dataset.planSide === "left" ? "left" : "right";
  const shift = side === "left" ? "100%" : "-100%";
  const width = Math.max(1, Math.round(Number(shell?.dataset.planWidth) || planWidthPx()));
  const closed = side === "left"
    ? `inset(0px 0px 0px ${width}px)`
    : `inset(0px ${width}px 0px 0px)`;
  const open = "inset(0px 0px 0px 0px)";
  const ink = planInk(plan);
  debugLog("plan-warm", `side=${side} ink=${ink} w=${width} mode=reveal`);
  liftPlanWarm(plan);
  let anim = null;
  try {
    // Delay until the panel clip is large enough to include the parked plan.
    // A sweep during the orb-sized clip only rasters a sliver.
    anim = plan.animate([
      { transform: `translate3d(${shift},0,0)`, clipPath: closed, offset: 0 },
      { transform: `translate3d(${shift},0,1px)`, clipPath: open, offset: 0.72 },
      { transform: `translate3d(${shift},0,0)`, clipPath: open, offset: 1 },
    ], { duration: 220, delay: 200, easing: "linear", fill: "forwards", id: "plan-warm" });
  } catch {
    return null;
  }
  const now = document.timeline?.currentTime;
  if (typeof now === "number") {
    try { anim.startTime = now; } catch { /* the sweep still runs */ }
  }
  return anim;
}

/** Keep the full plan layer. Cancelling the sweep during the panel clip,
 *  not on the seam frame, leaves the backing store in place for the clock. */
function settleWarmLayer(plan, anim) {
  const shell = shellOfPlan(plan);
  const shift = shell?.dataset.planSide === "left" ? "100%" : "-100%";
  try { anim?.cancel?.(); } catch { /* already idle */ }
  plan.style.removeProperty("clip-path");
  plan.style.transform = `translate3d(${shift},0,0)`;
  plan.style.willChange = "transform";
  liftPlanWarm(plan);
}

/** Presented means vsync gaps, not a lucky currentTime. The cold log marked
 *  paint 6ms after plan-warm because that read was the document timeline. */
function watchPlanWarm(plan, anim) {
  if (!anim) return;
  const started = performance.now();
  let last = 0;
  let presented = 0;
  const step = (now) => {
    if (!plan?.isConnected || anim.playState === "idle") return;
    if (plan.dataset.warmPresented === "1") return;
    const gap = last ? now - last : 0;
    last = now;
    const wall = now - started;
    // The first 200ms are the delay: the panel clip is still too small.
    // Frames before that must not count as a presented sweep.
    if (wall < 200) {
      requestAnimationFrame(step);
      return;
    }
    if (gap >= 8 && gap <= 48) presented += 1;
    const sweep = wall - 200;
    const ink = planInk(plan);
    if (ink > 0 && presented >= 6 && sweep >= 190) {
      plan.dataset.warmFrames = String(presented);
      plan.dataset.warmPresented = "1";
      plan.dataset.warmInk = String(ink);
      plan.dataset.painted = "1";
      debugLog("plan-warm-paint", `sweep=${sweep.toFixed(1)} wall=${wall.toFixed(1)} frames=${presented} ink=${ink} state=${anim.playState || ""}`);
      settleWarmLayer(plan, anim);
      return;
    }
    if (wall > 460) {
      debugLog("plan-warm-paint", `timeout ink=${ink} sweep=${sweep.toFixed(1)} wall=${wall.toFixed(1)} frames=${presented}`);
      return;
    }
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

async function waitPlanPresented(shell) {
  const plan = planNode(shell);
  if (!plan) return false;
  if (planPresented(plan)) return true;
  const started = performance.now();
  while (plan.isConnected && performance.now() - started < 340) {
    if (planPresented(plan)) return true;
    await nextFrame();
  }
  debugLog("plan-warm-wait", `presented=${plan.dataset.warmPresented || 0} ink=${planInk(plan)}`);
  return planPresented(plan);
}

/** Park the seam while the panel clip is still covering it, before content
 *  fades in. The layer is warmed here, 480ms before the seam clock starts. */
function armPlanSeam(shell) {
  const plan = planNode(shell);
  if (!plan || shell.dataset.planOpen !== "1") return;
  const side = shell.dataset.planSide === "left" ? "left" : sideFromStyle(shell);
  shell.dataset.planSide = side;
  warmPlanLayer(shell);
}

function cancelContentIn(shell) {
  shell.querySelectorAll(".content, .morph-body, .morph-pill").forEach((el) => {
    el.getAnimations?.().forEach((anim) => {
      if (anim.id === "content-in") anim.cancel();
    });
  });
}

/** Opacity reaches 1 at 160ms. The running clock is four times the clip so
 *  WebKit does not release the fill a few frames after settle. */
function playContentIn(shell, duration) {
  const nodes = [...shell.querySelectorAll(".content, .morph-body")];
  cancelContentIn(shell);
  nodes.forEach((el) => holdMotion(el));
  shell.querySelectorAll(".morph-pill, .panel-header, .morph-orb").forEach((el) => holdMotion(el));
  const fadeAt = duration > 0 ? Math.min(1, CONTENT_IN_MS / duration / 4) : 1;
  const frames = duration > 0
    ? [{ opacity: 0, offset: 0 }, { opacity: 1, offset: fadeAt }, { opacity: 1, offset: 1 }]
    : [{ opacity: 1 }, { opacity: 1 }];
  const timing = {
    duration: duration > 0 ? duration * 4 : 1,
    easing: "linear",
    fill: "forwards",
    id: "content-in",
  };
  const now = document.timeline?.currentTime;
  nodes.forEach((el) => {
    try {
      const anim = el.animate(frames, timing);
      if (duration > 0 && typeof now === "number") anim.startTime = now;
    } catch { /* .open keeps the resting opacity */ }
  });
}

function primePanelTail(shell) {
  shell.classList.add("is-content-promoted", "is-orb-moving");
  shell.classList.remove("is-orb-docked");
  armPlanSeam(shell);
}

function nextPaint() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  });
}

function nextFrame() {
  return new Promise((resolve) => {
    requestAnimationFrame(resolve);
  });
}

/** Seam pixels only. No layout read: that belongs in warmPlanLayer, before the clip. */
function holdSeamVisual(shell) {
  const plan = planNode(shell);
  if (!plan) return;
  const fit = ensurePlanFit(plan);
  const origin = seamOrigin(shell);
  if (seamPhase(plan) !== "grown" && !plan.classList.contains("is-seam-grow")) {
    seamLog("class-add", "is-seam-grow");
  }
  if (seamPhase(plan) !== "grown") plan.classList.add("is-seam-grow");
  plan.classList.add("is-plan-parked");
  // A presented warm layer stays above the paper. Putting it back at
  // z-index -1 drops the tiles the cold sweep just uploaded.
  if (plan.dataset.warmPresented !== "1") {
    plan.style.opacity = "1";
    plan.style.zIndex = "-1";
  }
  plan.style.pointerEvents = "none";
  plan.style.visibility = "visible";
  if (!plan.style.transform) {
    const shift = shell.dataset.planSide === "left" ? "100%" : "-100%";
    plan.style.transform = `translateX(${shift})`;
  }
  plan.style.transformOrigin = origin;
  fit.style.transformOrigin = origin;
  plan.style.willChange = "transform";
  fit.style.willChange = "transform";
  plan.style.removeProperty("clip-path");
  plan.style.setProperty("display", "flex", "important");
  plan.style.setProperty("overflow", "hidden", "important");
  holdMotion(plan);
  holdMotion(fit);
}

function seamLocked(plan) {
  const phase = seamPhase(plan);
  return phase === "growing" || phase === "grown";
}

/** Content is already in the DOM. Paint the parked plan while it is hidden.
 *  The rAF clock starts after that gate and writes the first sample itself. */
async function playPlanSeam(shell, token) {
  armSeamWatch();
  seamMark("plan-seam:clip-end");
  const plan = planNode(shell);
  if (!plan || shell.dataset.planOpen !== "1") return;
  if (token && shell.dataset.morphToken !== token) return;
  if (seamLocked(plan)) {
    seamLog("skip-locked", seamPhase(plan));
    return;
  }
  if (plan.dataset.warm !== "1" || !plan.dataset.key) {
    seamLog("skip-unready");
    hideUnwarmedPlan(shell);
    return;
  }
  applyParkedPlan(shell, plan);
  setSeamPhase(plan, "growing");
  shell.classList.add("is-plan-seam", "is-plan-arming");
  pauseHitSync();
  holdSeamVisual(shell);
  showPlanHost(shell);
  lockPlanBox(shell, plan);
  const flushed = getComputedStyle(plan).transform;
  seamLog("sliver-flush", flushed);
  if (!shell.isConnected || (token && shell.dataset.morphToken !== token)) return;
  if (seamPhase(plan) !== "growing") return;
  seamLog("sliver-painted", flushed);
  shell.classList.remove("is-plan-arming");
  seamMark("plan-seam:painted");
  await growPlan(shell, token);
}

function stopSeamClock(plan) {
  if (!plan?._seamFrame) return;
  cancelAnimationFrame(plan._seamFrame);
  plan._seamFrame = 0;
}

function pinContentOpacity(shell) {
  shell?.querySelectorAll(".content, .morph-body").forEach((el) => {
    el.style.opacity = "1";
  });
}

/** rAF time against the animation clock for one running clip. The 30fps
 *  capture is still the gate; this only shows whether the callback cadence
 *  matches. No computed style: a flush here would itself force a paint. */
function watchPresent(shell, anim, tag) {
  if (!debugFile.enabled || !anim) return;
  let last = performance.now();
  let i = 0;
  const step = (now) => {
    const gap = now - last;
    last = now;
    let current = "";
    try { current = Number(anim.currentTime).toFixed(1); } catch { current = ""; }
    const quiet = Math.round(clockAt(shell, "quiet") - now);
    debugLog(
      "present-frame",
      `tag=${tag} i=${i} gap=${gap.toFixed(1)} current=${current} state=${anim.playState || ""} motion=${shell._motion || ""} quiet=${quiet}`,
    );
    i += 1;
    const state = anim.playState || "";
    // The seam clock is paused for the turn it pins t=0. Stopping on that
    // first paused sample hid whether play() resumed.
    if (i < 48 && state !== "finished" && state !== "idle") requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/** A 1px tick outside the viewport keeps a composited transform beside the
 *  shell clip. It is not a child of the shell, so the orb tile is not retiled. */
function pumpSeamPresent(shell, duration) {
  if (!(duration > 0)) return null;
  shell?.querySelectorAll(":scope > .seam-tick").forEach((node) => node.remove());
  const root = document.documentElement;
  let tick = root.querySelector(":scope > .seam-tick");
  if (!tick) {
    tick = document.createElement("span");
    tick.className = "seam-tick";
    tick.setAttribute("aria-hidden", "true");
    root.append(tick);
  }
  holdMotion(tick);
  tick.style.willChange = "transform";
  try {
    return tick.animate([
      { transform: "translate3d(0,0,0)" },
      { transform: "translate3d(0,0,1px)", offset: 0.5 },
      { transform: "translate3d(0,0,0)" },
    ], { duration, easing: "linear", fill: "forwards", id: "seam-pump" });
  } catch {
    return null;
  }
}

/** Last presented sample. The open clip and the hosted plan already include
 *  the outward edge, so this frame paints the right strip. Hosting waits
 *  until here: a transform or dock write on the next frame repaints that
 *  1–3px line after the curve settles. */
function presentSeamFinal(shell, anim) {
  if (!shell || shell._seamFinal) return;
  if (shell.dataset?.planOpen !== "1") return;
  shell._seamFinal = 1;
  const value = exactOpenClip(shell);
  if (anim?.effect?.setKeyframes) {
    try {
      anim.effect.setKeyframes([{ clipPath: value }, { clipPath: value }]);
    } catch { /* the inline clip still opens the shell */ }
  }
  try {
    if (anim && anim.playState !== "finished" && anim.playState !== "idle") {
      anim.currentTime = PLAN_GROW_MS;
    }
  } catch { /* keyframes already hold the open clip */ }
  shell.style.clipPath = value;
  const plan = planNode(shell);
  if (plan && seamPhase(plan) !== "grown") setSeamPhase(plan, "grown", { dom: false });
  if (plan && plan.style.opacity !== "1") plan.style.opacity = "1";
  hostOpenPlan(shell);
  if (!debugFile.enabled) return;
  let used = "";
  let rect = "-";
  try { used = getComputedStyle(shell).clipPath || ""; } catch { used = ""; }
  try {
    const box = plan?.getBoundingClientRect();
    if (box) {
      rect = `${Math.round(box.x)},${Math.round(box.y)} ${Math.round(box.width)}x${Math.round(box.height)}`;
    }
  } catch { rect = "-"; }
  debugLog("seam-final", `clip=${used || "-"} rect=${rect}`);
}

/** Anchor t=0 to the first frame that can be presented. A pause that is
 *  still in effect on a later frame never resumes on a cold compositor:
 *  the shell stays on the closed keyframe until the finish write jumps
 *  to open. Play before yielding. A document-timeline currentTime (seconds
 *  into the page, not the animation) must not be treated as progress.
 *  The first two callbacks can run without reaching the glass. The third
 *  one is often the first scan, already ~46ms down the curve. */
function alignSeamClock(anim, onPresented, warm = false, shell = null) {
  if (!anim) return;
  const pin = (ahead = 0) => {
    const now = document.timeline?.currentTime;
    if (typeof now !== "number") return;
    const at = ahead > 0 ? now + ahead : now;
    try { anim.startTime = at; } catch { /* this frame already owns the clock */ }
  };
  const resume = () => {
    if (!anim || anim.playState === "finished" || anim.playState === "idle") return;
    try {
      if (anim.playState !== "running") anim.play();
    } catch { /* the paused frame stays */ }
  };
  const confirm = (presented) => {
    debugLog("seam-clock", `present-hold frame=${presented}`);
    if (typeof onPresented === "function") onPresented();
  };
  try {
    anim.pause();
    anim.currentTime = 0;
  } catch {
    pin(0);
    resume();
    confirm(0);
    return;
  }
  // Play this turn so a cold compositor is not left paused. The closed
  // keyframe (fill both) is presented once as a no-op. The startup gap
  // (about 25ms at the first sample) is discarded on that frame.
  pin(0);
  resume();
  const layer = shell || anim.effect?.target || null;
  let presented = 0;
  let lastStamp = 0;
  let heldOpen = false;
  let shownMs = 0;
  let frameMs = 0;
  let pace = false;
  const sampleLate = (stamp) => {
    if (!anim || anim.playState === "idle") return;
    if (anim.playState === "finished") {
      presentSeamFinal(layer, anim);
      return;
    }
    let current = 0;
    try { current = Number(anim.currentTime) || 0; } catch { current = 0; }
    presented += 1;
    const gap = lastStamp ? Math.abs(lastStamp - stamp) : 0;
    lastStamp = stamp;
    if (!frameMs && gap >= 8 && gap <= 40) frameMs = gap;
    const lie = current > 400;
    if ((anim.playState === "paused" || lie) && !pace) {
      try { anim.currentTime = 0; } catch { /* keep the pin */ }
      pin(0);
      resume();
      if (presented < 3) requestAnimationFrame(sampleLate);
      return;
    }
    if (pace && lie) current = shownMs;
    if (pace && anim.playState === "paused") resume();
    // Frame 1 drops the startup hole on a cold compositor. A warm layer
    // is already on the glass, so that first sample is capped, not discarded.
    const startup = !warm && presented === 1 && current > 16;
    const hole = !warm && presented > 1 && presented <= 3 && (gap > 40 || current > 75);
    if ((startup || hole) && !pace) {
      try { anim.pause(); } catch { /* the pin still moves the start */ }
      try { anim.currentTime = 0; } catch { /* the closed keyframe stays */ }
      pin(0);
      resume();
      const late = hole && gap > 0 ? gap : current;
      debugLog("seam-clock", `reanchor gap=${late.toFixed(1)} frame=${presented}`);
      if (presented < 3) {
        requestAnimationFrame(sampleLate);
        return;
      }
      // Restarts are spent. The first committed sample is the 20ms value
      // (~16%). The next presented frame, often the one a 30fps capture
      // records, is capped at 45ms below.
      const step = seamFrameStep(current, { first: true, duration: PLAN_GROW_MS });
      const shown = seamVisibleMs(current);
      if (current > 20) {
        try { anim.currentTime = 20; } catch { /* the closed keyframe stays */ }
        debugLog("seam-clock", `reanchor gap=${current.toFixed(1)} frame=${presented} pin=20 restart=${step.restart ? 1 : 0}`);
      }
      if (!heldOpen) {
        heldOpen = true;
        confirm(presented);
      }
      shownMs = shown > 0 ? shown : seamVisibleMs(current);
      pace = true;
      requestAnimationFrame(sampleLate);
      return;
    }
    if (!pace && warm && !heldOpen) {
      const shown = seamVisibleMs(current);
      if (current > 20) {
        try { anim.currentTime = 20; } catch { /* the closed keyframe stays */ }
        debugLog("seam-clock", `reanchor gap=${current.toFixed(1)} frame=${presented} pin=20`);
      }
      shownMs = shown;
      heldOpen = true;
      confirm(presented);
      pace = true;
      requestAnimationFrame(sampleLate);
      return;
    }
    if (!pace && !heldOpen && (current <= 16 || (presented >= 2 && gap > 0 && gap <= 40))) {
      // A reanchor that is not a 75ms hole still presents this sample.
      // Cap that first visible frame at 20ms even when the gap stayed small.
      const shown = seamVisibleMs(current);
      if (current > 20) {
        try { anim.currentTime = 20; } catch { /* the closed keyframe stays */ }
        debugLog("seam-clock", `reanchor gap=${current.toFixed(1)} frame=${presented} pin=20`);
      }
      shownMs = shown;
      heldOpen = true;
      confirm(presented);
      pace = true;
    } else if (pace) {
      const frame = frameMs || 16;
      let next = seamAdvanceMs(current, {
        shownMs,
        gapMs: gap,
        frameMs: frame,
        duration: PLAN_GROW_MS,
      });
      if (shownMs > 0 && next <= shownMs + 0.5 && next < PLAN_GROW_MS) {
        next = Math.min(PLAN_GROW_MS, shownMs + frame);
        if (shownMs <= 20.5) next = Math.min(45, next);
      }
      // Sample 2 is the frame a 30fps capture often records. Top and bottom
      // both land here. Keep it on the 45ms value so that frame stays under 45%.
      if (shownMs > 0 && shownMs <= 20.5 && current > 45) {
        next = Math.min(next, 45);
        if (next <= shownMs + 0.5) next = Math.min(45, shownMs + frame);
        try { anim.currentTime = 45; } catch { /* the closed keyframe stays */ }
        resume();
        debugLog("seam-clock", `pace gap=${gap.toFixed(1)} at=${current.toFixed(1)} show=45`);
      } else if (next >= PLAN_GROW_MS - 0.5) {
        next = PLAN_GROW_MS;
        try { anim.currentTime = next; } catch { /* the open keyframe stays */ }
        presentSeamFinal(layer, anim);
        debugLog("seam-clock", `pace gap=${gap.toFixed(1)} at=${current.toFixed(1)} show=${next.toFixed(1)}`);
      } else if (next > shownMs + 0.5 || Math.abs(next - current) > 0.5) {
        try { anim.currentTime = next; } catch { /* keep the running clock */ }
        resume();
        debugLog("seam-clock", `pace gap=${gap.toFixed(1)} at=${current.toFixed(1)} show=${next.toFixed(1)}`);
      }
      shownMs = next;
    }
    const running = anim.playState !== "finished" && anim.playState !== "idle";
    if (running && (presented < 3 || (pace && shownMs < PLAN_GROW_MS))) requestAnimationFrame(sampleLate);
  };
  requestAnimationFrame(sampleLate);
}

/** Presented elapsed time, not the document timeline. A first sample already
 *  past 45ms would show planEase above 45%; that sample stays closed and the
 *  origin moves to it. Each later sample writes a new clip, so a hold cannot
 *  span two presented frames. */
function onPresentedSeamFrame(shell, from, elapsed) {
  const slot = onPresentedSeamFrame.slot;
  if (!slot || slot.shell !== shell || !shell.isConnected) return;
  const ms = Number(elapsed) || 0;
  if (ms <= 0) {
    shell.style.clipPath = from;
    if (!slot.sawClosed) {
      slot.sawClosed = true;
      debugLog("seam-clock", "present-hold frame=1");
    } else if (!slot.live) {
      debugLog("seam-clock", "reanchor gap=late frame=1");
    }
    return;
  }
  const step = seamFrameStep(ms, { first: !slot.live, duration: PLAN_GROW_MS });
  if (step.restart) {
    shell.style.clipPath = from;
    debugLog("seam-clock", `reanchor gap=${ms.toFixed(1)} frame=1`);
    return;
  }
  slot.live = true;
  if (slot.anim) slot.anim.currentTime = ms;
  const next = planRevealClip(shell, step.t).value;
  if (shell.style.clipPath !== next) shell.style.clipPath = next;
}

function runRafSeam(shell, to, duration) {
  let origin = 0;
  let live = false;
  let restarts = 0;
  return new Promise((resolve) => {
    const step = (stamp) => {
      if (!shell.isConnected) {
        resolve(false);
        return;
      }
      if (!origin) {
        origin = stamp;
        window.__hermesSeamFrame?.(0);
        requestAnimationFrame(step);
        return;
      }
      const dt = stamp - origin;
      if (!live && dt > 45 && restarts < 3) {
        origin = stamp;
        restarts += 1;
        window.__hermesSeamFrame?.(0);
        requestAnimationFrame(step);
        return;
      }
      live = true;
      window.__hermesSeamFrame?.(dt);
      if (dt >= duration) {
        shell.style.clipPath = to;
        resolve(true);
        return;
      }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

function drivePresentedSeam(shell, to, duration) {
  const open = () => {
    if (shell.isConnected) {
      shell.style.clipPath = to;
      if (shell.style.transition === "none") shell.style.removeProperty("transition");
    }
    return true;
  };
  if (!inTauri()) return runRafSeam(shell, to, duration).then(open);
  return import("@tauri-apps/api/core")
    .then(({ invoke }) => invoke("drive_presented_seam"))
    .then((ok) => (ok ? open() : runRafSeam(shell, to, duration).then(open)))
    .catch(() => runRafSeam(shell, to, duration).then(open));
}

/** Fresh shell clip, fully closed to fully open. The WAAPI clip is the
 *  reveal (v71). holdMotion keeps `transition: none !important` so a
 *  stylesheet clip-path transition cannot freeze the used value closed.
 *  The curve stays PLAN_EASE / 280ms. */
function beginSeamClip(shell) {
  const from = planRevealClip(shell, 0).value;
  // The curve is still PLAN_EASE / 280ms. The last sample is the ceiled
  // open clip, so the outward 1px is on this layer instead of a later write.
  const to = exactOpenClip(shell);
  const duration = PLAN_GROW_MS;
  holdMotion(shell);
  const previous = shell._clipHold;
  let anim = null;
  try {
    anim = shell.animate([
      { clipPath: from },
      { clipPath: to },
    ], { duration, easing: PLAN_EASE, fill: "both", id: "seam-clip" });
  } catch {
    shell.style.clipPath = to;
    return null;
  }
  shell._clipHold = anim;
  shell.style.clipPath = from;
  const warm = planNode(shell)?.dataset.warmPresented === "1";
  // Top and bottom share this clock, including the 20ms then 45ms caps.
  alignSeamClock(anim, () => {
    shell.style.clipPath = to;
  }, warm, shell);
  pumpSeamPresent(shell, duration);
  watchPresent(shell, anim, "plan");
  seamLog("clip-open", `prev=${previous?.playState || "none"} dur=${duration}`);
  return anim;
}

function dropClipHold(anim) {
  try { anim?.cancel?.(); } catch { /* already idle */ }
}

function finishSeamClip(anim) {
  if (!anim) return Promise.resolve(false);
  // Do not seek to the end on the wall timeout: that is the one-frame jump
  // to open. If the clock never left the closed keyframe, run it once more.
  return whenAnimEnds(anim, PLAN_GROW_MS * 2, false).then((ok) => {
    if (!seamClockStuck(anim)) return ok;
    debugLog("plan-anim-restart", `state=${anim.playState || ""}`);
    kickSeamClock(anim);
    return whenAnimEnds(anim, PLAN_GROW_MS * 2, false);
  });
}

function seamClockStuck(anim) {
  if (!anim || anim.playState === "finished") return false;
  if (anim.playState === "paused") return true;
  let current = 0;
  try { current = Number(anim.currentTime) || 0; } catch { current = 0; }
  // Thousands of milliseconds here is the document timeline, not growth.
  if (current > 400) return true;
  // Still on the closed keyframe. A paced frame under 40ms is moving.
  return current < 8;
}

function kickSeamClock(anim) {
  if (!anim) return;
  try { anim.currentTime = 0; } catch { /* already idle */ }
  const now = document.timeline?.currentTime;
  if (typeof now === "number") {
    try { anim.startTime = now; } catch { /* play still starts this turn */ }
  }
  try { anim.play(); } catch { /* the closed keyframe stays */ }
}

/** GTK after-paint. A double rAF is not a presented frame on this webview. */
function waitPresentedFrames(count) {
  const need = Math.max(1, Math.min(8, count | 0));
  if (!inTauri()) return Promise.resolve(0);
  return import("@tauri-apps/api/core")
    .then(({ invoke }) => invoke("wait_presented_frames", { frames: need }))
    .then((got) => Number(got) || 0)
    .catch(() => 0);
}

function promoteLayer(el) {
  if (!el) return;
  holdMotion(el);
  el.style.willChange = "clip-path, transform";
  const current = el.style.transform || "";
  if (!current || current === "none") el.style.transform = "translateZ(0)";
  else if (!/translateZ|translate3d/.test(current)) el.style.transform = `${current} translateZ(0)`;
}

/** Closed plan clip, already composited, for at least two presented frames.
 *  The 280ms clock starts only after this returns. */
async function promoteClosedSeam(shell) {
  const closed = planRevealClip(shell, 0).value;
  promoteLayer(shell);
  shell.style.clipPath = closed;
  promoteLayer(planNode(shell));
  const frames = await waitPresentedFrames(2);
  debugLog("seam-present", `frames=${frames} clip=closed`);
  return frames;
}

/** Final plan width, including the close control, before the 280ms clock.
 *  A cold open that measured during the reveal sat ~10px short, held, then jumped. */
function prelayoutOpenPlan(shell, plan) {
  if (!plan) return Math.round(planWidthPx());
  plan.hidden = false;
  plan.style.setProperty("display", "flex", "important");
  let width = commitPlanWidth(shell, plan, { measure: true });
  const apply = (value) => {
    const px = `${Math.round(value)}px`;
    plan.style.width = px;
    plan.style.minWidth = px;
    plan.style.maxWidth = px;
  };
  apply(width);
  void plan.offsetWidth;
  void plan.offsetHeight;
  const close = plan.querySelector("[data-role='plan-close']");
  if (close) {
    void close.offsetWidth;
    void close.offsetLeft;
  }
  width = commitPlanWidth(shell, plan, { measure: true });
  apply(width);
  void plan.offsetWidth;
  return width;
}

function growPlan(shell, token) {
  const plan = planNode(shell);
  if (!plan || shell.dataset.planOpen !== "1") return Promise.resolve();
  if (token && shell.dataset.morphToken !== token) return Promise.resolve();
  if (seamPhase(plan) === "grown") return Promise.resolve();
  if (plan._seamRun) {
    seamLog("anim-skip", "already-running");
    return plan._seamRun;
  }
  const fit = ensurePlanFit(plan);
  const flight = String((Number(plan.dataset.seamFlight) || 0) + 1);
  plan.dataset.seamFlight = flight;
  setSeamPhase(plan, "growing");
  if (reducedMotion()) {
    const parked = planRasterHost(plan);
    if (parked) parked.style.visibility = "hidden";
    fit.style.visibility = "visible";
    releasePlanDock(plan);
    plan.style.transform = "none";
    plan.style.visibility = "visible";
    plan.classList.remove("is-plan-parked");
    holdPlanClip(shell, 1);
    lockPlanRevealed(plan);
    plan.style.removeProperty("display");
    plan.classList.remove("is-seam-grow");
    endPlanSeam(shell);
    releaseReopenedPlan(shell);
    return Promise.resolve();
  }
  shell.classList.add("is-plan-seam");
  pauseHitSync();
  stopSeamClock(plan);
  // Full-size plan, already painted under the glass. The shell clip is the
  // only thing that moves, so the markdown layer is not rebuilt per frame.
  const side = shell.dataset.planSide === "left" ? "left" : "right";
  const origin = seamOrigin(shell);
  const full = commitPlanWidth(shell, plan);
  fit.style.flex = "none";
  fit.style.width = "100%";
  fit.style.maxWidth = "100%";
  fit.style.boxSizing = "border-box";
  fit.style.height = "100%";
  fit.style.alignSelf = side === "left" ? "flex-end" : "flex-start";
  fit.style.transformOrigin = origin;
  fit.style.transform = "none";
  fit.style.visibility = "visible";
  fit.style.willChange = "transform";
  plan.style.transformOrigin = origin;
  releasePlanDock(plan);
  plan.getAnimations?.().forEach((anim) => {
    if (anim.id !== "plan-warm") return;
    debugLog("plan-warm-cancel", `current=${Number(anim.currentTime || 0).toFixed(1)} presented=${plan.dataset.warmPresented || 0}`);
    anim.cancel();
  });
  plan.style.transform = "none";
  plan.style.removeProperty("clip-path");
  plan.style.width = `${Math.round(full)}px`;
  plan.style.pointerEvents = "none";
  plan.style.visibility = "visible";
  plan.style.opacity = "1";
  if (plan.dataset.warmPresented !== "1") plan.style.zIndex = "";
  plan.style.willChange = "transform";
  plan.classList.remove("is-plan-parked");
  pinContentOpacity(shell);
  const alive = () => {
    if (!plan.isConnected || plan.dataset.seamFlight !== flight) return false;
    if (token && shell.dataset.morphToken !== token) return false;
    return true;
  };
  const run = (async () => {
    shell._seamFinal = 0;
    const locked = prelayoutOpenPlan(shell, plan);
    plan.style.width = `${Math.round(locked)}px`;
    await promoteClosedSeam(shell);
    if (!alive()) return false;
    // Geometry is final before the first reveal sample. No layout read here.
    const anim = beginSeamClip(shell);
    seamLog("anim-start", `flight=${flight} mode=clip same=shell raster=${plan.dataset.raster || "live"} reveal=0 motion=${shell._motion || ""} quiet=${Math.round(clockAt(shell, "quiet") - performance.now())}`);
    seamMark("plan-seam:clock");
    if (!alive()) return false;
    const started = performance.now();
    await finishSeamClip(anim);
    if (alive() && seamPhase(plan) !== "grown") {
      const wall = performance.now() - started;
      const t = Math.min(1, wall / PLAN_GROW_MS);
      seamLog("seam-sample", `i=0 wall=${wall.toFixed(1)} reveal=${planEase(t).toFixed(3)} motion=${shell._motion || ""} quiet=${Math.round(clockAt(shell, "quiet") - performance.now())}`);
    }
    if (!alive()) return false;
    presentSeamFinal(shell, anim);
    const openClip = planRevealClip(shell, 1).value;
    // The settle frame already wrote the ceiled outer edge. A computed-style
    // read here yields one frame, and the unceiled reveal clip is 1px short.
    if (!shell._seamFinal) {
      let usedClip = "";
      try { usedClip = getComputedStyle(shell).clipPath || ""; } catch { usedClip = ""; }
      if (seamClipStillClosed(usedClip, openClip)) {
        debugLog("seam-clip-stuck", `used=${usedClip} open=${openClip}`);
        dropClipHold(anim);
        holdMotion(shell);
        shell.style.clipPath = openClip;
      }
      if (shell.style.clipPath !== openClip) shell.style.clipPath = openClip;
    }
    if (!plan.parentElement?.classList?.contains("plan-hit-host")) plan.style.pointerEvents = "";
    if (fit.style.visibility !== "visible") fit.style.visibility = "visible";
    paintOpenedHeldLook();
    seamLog("anim-finish", `flight=${flight} mode=clip raster=${plan.dataset.raster || "live"} reveal=1`);
    holdFreeze(shell, FREEZE_AFTER_GROW_MS);
    holdPlanContent(shell, FREEZE_AFTER_GROW_MS);
    setSeamPhase(plan, "grown", { dom: false });
    hostOpenPlan(shell);
    logPlanHitBox(shell);
    releaseReopenedPlan(shell);
    armQuietFlush(shell);
    return true;
  })();
  plan._seamRun = run;
  run.finally(() => {
    if (plan._seamRun === run) plan._seamRun = null;
  });
  return run;
}

function visualQuiet(shell) {
  if (!shell) return false;
  if (shellFrozen(shell) || shell._settleGate) return true;
  return performance.now() < clockAt(shell, "quiet");
}

function holdQuiet(shell, ms) {
  holdClock(shell, "quiet", ms);
}

function holdPlanContent(shell, ms) {
  holdClock(shell, "plan", ms);
}

function planContentHeld(shell) {
  return !!shell && performance.now() < clockAt(shell, "plan");
}

function deferShellWork(shell) {
  return visualQuiet(shell);
}

function quietWait(shell) {
  return Math.max(
    0,
    clockAt(shell, "quiet") - performance.now(),
    clockAt(shell, "plan") - performance.now(),
    clockAt(shell, "freeze") - performance.now(),
    collapseQuietUntil - performance.now(),
  );
}

function freezeCooling(shell) {
  if (!shell) return false;
  if (shell._motion || shell._settleGate) return true;
  if (shell.classList.contains("is-collapsing")
    || shell.classList.contains("is-plan-arming")) return true;
  if (planContentHeld(shell)) return true;
  return performance.now() < clockAt(shell, "freeze");
}

function framesLater(count, fn) {
  const step = (left) => {
    if (left <= 0) fn();
    else requestAnimationFrame(() => step(left - 1));
  };
  if (count <= 0) fn();
  else requestAnimationFrame(() => step(count - 1));
}

function pinRestingNodes(shell) {
  if (!shell || shell.dataset.state !== "panel") return;
  shell.querySelectorAll(".content, .morph-body, .bubble").forEach((el) => {
    if (el.hidden || el.closest?.("[hidden]")) return;
    el.style.opacity = "1";
    el.style.setProperty("animation", "none", "important");
    el.style.setProperty("transition", "none", "important");
  });
}

function restBubble(node) {
  if (!node) return node;
  node.style.opacity = "1";
  node.style.setProperty("animation", "none", "important");
  node.style.setProperty("transition", "none", "important");
  return node;
}

/** What a deferred render would touch. researcher is called out because its
 *  wash stayed after the left panel went clean. */
function deferredParts(shell) {
  const id = shell?.dataset.botId || "";
  const panel = panelFor(id);
  const thread = id ? threadFor(id) : null;
  const chat = role(panel, "chat");
  let chatPart = "missing";
  if (chat && thread) {
    const stamp = chatStamp(thread);
    const same = chat.dataset.stamp === stamp && chat.childElementCount === thread.messages.length;
    chatPart = same ? "same" : (chat.childElementCount > 0 ? "sync" : "mount");
  }
  const section = planNode(shell);
  let planPart = "none";
  if (thread && section) {
    const focus = planForPanel(thread);
    if (focus) {
      const body = role(section, "plan-body");
      const html = renderAssistantMarkdown(focus.markdown || "");
      const md = body && body.dataset.md !== html ? "markdown" : "same";
      const key = section.dataset.key !== focus.key ? "key" : "keep";
      planPart = `${key}:${md}`;
    }
  }
  const select = role(panel, "session");
  const sessions = orderSessions(thread?.sessions || []);
  const sessionKey = JSON.stringify([
    thread?.sessionId || "",
    sessions.map((session) => [session.id, session.title, session.hidden, session.archived, session.source]),
  ]);
  const sessionPart = select && select.dataset.key !== sessionKey ? "rebuild" : "same";
  const soul = role(panel, "soul");
  const soulWant = state.souls.get(id) || "";
  const soulPart = soul && soul.dataset.dirty !== "1" && soul.value !== soulWant ? "write" : "same";
  const showChat = role(panel, "tab-chat")?.getAttribute("aria-selected") !== "false";
  const focusBot = id === "researcher" ? " focus=researcher" : "";
  return `chat=${chatPart} plan=${planPart} session=${sessionPart} soul=${soulPart} tab=${showChat ? "chat" : "bot"} dirty=${shell?.dataset.chatDirty || 0}/${shell?.dataset.planDirty || 0}${focusBot}`;
}

function snapshotPlanGeometry(plan) {
  if (!plan) return null;
  const fit = plan.querySelector(".plan-fit");
  return {
    width: plan.style.width,
    height: plan.style.height,
    top: plan.style.top,
    left: plan.style.left,
    right: plan.style.right,
    minWidth: plan.style.minWidth,
    maxWidth: plan.style.maxWidth,
    fitWidth: fit?.style.width || "",
    fitHeight: fit?.style.height || "",
    fitMax: fit?.style.maxWidth || "",
    close: plan.querySelector("[data-role='plan-close']") || plan._planClose || null,
    plan,
  };
}

function restorePlanGeometry(plan, snap) {
  if (!plan || !snap) return;
  if (snap.plan && plan !== snap.plan) {
    debugLog("plan-geometry", `plan-node-replaced call=${callerTag("restorePlanGeometry")}`);
  }
  const moved = plan.style.width !== snap.width
    || plan.style.height !== snap.height
    || plan.style.top !== snap.top
    || plan.style.left !== snap.left
    || plan.style.right !== snap.right
    || plan.style.minWidth !== snap.minWidth
    || plan.style.maxWidth !== snap.maxWidth;
  if (moved) {
    debugLog("plan-geometry", `restore w=${snap.width || "-"} was=${plan.style.width || "-"} call=${callerTag("restorePlanGeometry")}`);
  }
  plan.style.width = snap.width;
  plan.style.height = snap.height;
  plan.style.top = snap.top;
  if (plan.parentElement?.classList?.contains("plan-hit-host")) {
    if (plan.style.left !== snap.left) plan.style.left = snap.left;
    if (plan.style.right !== snap.right) plan.style.right = snap.right;
  } else {
    if (plan.style.left) plan.style.removeProperty("left");
    if (plan.style.right) plan.style.removeProperty("right");
  }
  plan.style.minWidth = snap.minWidth;
  plan.style.maxWidth = snap.maxWidth;
  const close = plan.querySelector("[data-role='plan-close']");
  if (snap.close && close !== snap.close) {
    debugLog("plan-geometry", `close-replaced call=${callerTag("restorePlanGeometry")}`);
    if (close) close.replaceWith(snap.close);
    else (plan.querySelector(".plan-head .panel-actions") || plan.querySelector(".plan-head"))?.append(snap.close);
  }
  const fit = plan.querySelector(".plan-fit");
  if (!fit) return;
  fit.style.width = snap.fitWidth;
  fit.style.height = snap.fitHeight;
  fit.style.maxWidth = snap.fitMax;
}

function seamRevealLive(shell) {
  if (!shell) return false;
  const plan = planNode(shell);
  return shell.classList.contains("is-plan-seam")
    || shell.classList.contains("is-plan-arming")
    || seamPhase(plan) === "growing";
}

function applyQueuedShell(shell, tag) {
  if (!shell?.isConnected) return;
  const plan = planNode(shell);
  // A grown plan used to keep is-plan-seam forever, so chat and plan paints
  // deferred until the panel closed. Drop the lock once the freeze is over.
  if (seamPhase(plan) === "grown" && !freezeCooling(shell) && !collapseBusy() && !collapseQuiet()) {
    shell.classList.remove("is-plan-seam", "is-plan-arming");
  }
  if (seamRevealLive(shell) || freezeCooling(shell) || collapseBusy() || collapseQuiet()) {
    armQuietFlush(shell);
    return;
  }
  const parts = deferredParts(shell);
  debugLog("queued-apply", `bot=${shell.dataset.botId || ""} tag=${tag} ${parts}`);
  const snap = snapshotPlanGeometry(plan);
  pinRestingNodes(shell);
  shell.classList.remove("is-morphing", "is-plan-seam", "is-plan-arming", "is-growing-panel");
  delete shell.dataset.chatDirty;
  delete shell.dataset.planDirty;
  renderChat(shell.dataset.botId, { inplace: true, tag, resting: true });
  restorePlanGeometry(planNode(shell) || plan, snap);
  hostOpenPlan(shell);
  pinRestingNodes(shell);
  requestAnimationFrame(() => {
    if (!shell.isConnected || seamRevealLive(shell) || freezeCooling(shell) || collapseBusy() || collapseQuiet()) {
      armQuietFlush(shell);
      return;
    }
    const live = planNode(shell);
    releasePlanBox(live);
    restorePlanGeometry(live, snap);
    hostOpenPlan(shell);
    releaseHitSilence(tag);
    if (renderBots.pending) renderBots(tag);
  });
}

function armQuietFlush(shell) {
  if (!shell || shell._quietFlush) return;
  const wait = Math.max(quietWait(shell), (freezeCooling(shell) || shell._settleGate) ? 32 : 0);
  shell._quietFlush = window.setTimeout(() => {
    shell._quietFlush = 0;
    framesLater(2, () => applyQueuedShell(shell, "quiet-flush"));
  }, wait);
}

function flushDeferredChat(shell) {
  if (!shell) return;
  if (shell.dataset.chatDirty !== "1" && shell.dataset.planDirty !== "1" && !renderBots.pending) return;
  if (deferShellWork(shell) || planContentHeld(shell) || shellFrozen(shell) || shell._settleGate) {
    armQuietFlush(shell);
    return;
  }
  framesLater(2, () => applyQueuedShell(shell, "deferred-chat"));
}

function endPlanSeam(shell) {
  if (freezeCooling(shell)) {
    debugLog("seam-end-held", `bot=${shell.dataset.botId || ""}`);
    armQuietFlush(shell);
    return;
  }
  shell.classList.remove("is-plan-seam", "is-plan-arming");
  scheduleHitSync("seam-end");
  flushDeferredChat(shell);
}

function orbScaleNow(orb) {
  const value = getComputedStyle(orb).transform;
  if (!value || value === "none") return 1;
  const matched = value.match(/matrix\(([^)]+)\)/);
  if (!matched) return 1;
  const scale = Number(matched[1].split(",")[0]);
  return Number.isFinite(scale) && scale > 0 ? scale : 1;
}

/** Scale about the orb centre. No translate: the header slot is already there.
 *  The caller owns cancelling the animation once the resting class matches. */
function scaleOrb(shell, token, from, to, duration, easing, pinClock = false) {
  const orb = shell.querySelector(".morph-orb");
  if (!orb || (token && shell.dataset.morphToken !== token)) return Promise.resolve(null);
  if (!(duration > 0) || Math.abs(from - to) < 0.01) return Promise.resolve(null);
  holdMotion(orb);
  orb.style.transformOrigin = "center center";
  try {
    const anim = orb.animate([
      { transform: `scale(${from})` },
      { transform: `scale(${to})` },
    ], { duration, easing, fill: "forwards" });
    if (pinClock) {
      const now = document.timeline?.currentTime;
      if (typeof now === "number") anim.startTime = now;
    }
    return whenAnimEnds(anim, duration).then((finished) => (finished ? anim : null));
  } catch {
    return Promise.resolve(null);
  }
}

/** Same 480ms curve as the panel clip, started in that turn. The centre
 *  stays on the header slot. Glow opacity is the moving and docked classes. */
function moveOrbToHeader(shell, token) {
  if (token && shell.dataset.morphToken !== token) return Promise.resolve();
  const orb = shell.querySelector(".morph-orb");
  if (!orb || reducedMotion()) {
    shell.classList.remove("is-orb-moving");
    shell.classList.add("is-orb-docked");
    return Promise.resolve();
  }
  // is-orb-moving is already on from the panel clip, so this does not
  // restyle transform in the handoff frame. Adding it here is only the
  // fallback when the tail was not primed.
  if (!shell.classList.contains("is-orb-moving")) {
    shell.classList.add("is-orb-moving");
    shell.classList.remove("is-orb-docked");
  }
  const scale = ICON / ORB;
  const glow = shell.querySelector(".morph-glow");
  holdMotion(glow);
  return scaleOrb(shell, token, 1, scale, PILL_PANEL_MS, EASE).then((anim) => {
    if (token && shell.dataset.morphToken !== token) return;
    shell.classList.add("is-orb-docked");
    if (orb) {
      orb.style.willChange = "transform";
      orb.style.transform = `scale(${scale})`;
    }
    shell.classList.remove("is-orb-moving");
    void anim;
  });
}

function releaseContent(shell) {
  cancelContentIn(shell);
  shell.querySelectorAll(".content, .morph-body").forEach((el) => {
    el.style.removeProperty("transition");
    el.style.removeProperty("opacity");
  });
}

function resetContent(shell) {
  shell.dataset.contentOnce = "";
  shell.classList.remove("open", "is-content-hold");
  releaseContent(shell);
}

function revealContent(shell) {
  if (shell.dataset.contentOnce === "1") return;
  shell.dataset.contentOnce = "1";
  shell.classList.add("open");
}

/** Paint is already on screen. One frame later the seam clock starts. */
async function growAfterPaint(shell, token) {
  await nextFrame();
  if (!shell?.isConnected) return;
  // 睇計劃 sets planRepublish. The settle quiet and a stale morph token
  // used to return here, so the chip click never hosted the plan again.
  const republish = shell.dataset.planRepublish === "1";
  if (token && shell.dataset.morphToken !== token && !republish) return;
  if (visualQuiet(shell) && !republish) {
    shell.dataset.planDirty = "1";
    armQuietFlush(shell);
    return;
  }
  const plan = planNode(shell);
  if (!plan || shell.dataset.planOpen !== "1" || seamLocked(plan)) return;
  if (plan.dataset.warm !== "1") warmPlanLayer(shell);
  else if (planPresented(plan)) {
    debugLog("plan-warm", `reuse side=${shell.dataset.planSide || "right"} ink=${planInk(plan)} frames=${plan.dataset.warmFrames || 0}`);
  }
  await playPlanSeam(shell, token);
}

function logSettleLater(shell) {
  framesLater(5, () => {
    if (!shell?.isConnected) return;
    debugLog(
      "settle-later",
      `bot=${shell.dataset.botId || ""} edge=${shell.dataset.edge || ""} side=${shell.dataset.planSide || ""} clip=${shell.dataset.clipRadius ? "kept" : "empty"} growing=${shell.classList.contains("is-growing-panel") ? 1 : 0}`,
    );
  });
}

/** Settle is bookkeeping only. Class, opacity, visibility, transition, and
 *  clip writes here race the last growth frame and wash the panel. The clip
 *  completion already committed the resting inline styles. */
function settleShell(shell, target) {
  if (target === "panel") {
    if (!(clockAt(shell, "freeze") > performance.now())) holdFreeze(shell, FREEZE_AFTER_GROW_MS);
    holdQuiet(shell, FREEZE_AFTER_GROW_MS);
  }
  // Freeze is already a timestamp. Clearing motion after it keeps the hit
  // gate closed; this function does not touch animations or listeners.
  shell._motion = "";
  shell._settleGate = 1;
  debugLog(
    "morph-settle",
    `target=${target} bot=${shell.dataset.botId || ""} dom=0 edge=${shell.dataset.edge || ""} side=${shell.dataset.planSide || ""} clip=${shell.dataset.clipRadius ? "kept" : "empty"}`,
  );
  debugLog("settle-defer", `bot=${shell.dataset.botId || ""} ${deferredParts(shell)}`);
  logSettleLater(shell);
  framesLater(2, () => {
    if (!shell.isConnected) return;
    shell._settleGate = 0;
    if (target === "orb") releaseCollapseGate(shell);
    armQuietFlush(shell);
  });
}

function stopShellTransition(shell, target = "") {
  const fill = shell.querySelector(".morph-fill");
  const stroke = shell.querySelector(".morph-stroke");
  holdMotion(shell);
  holdMotion(fill);
  holdMotion(stroke);
  const plan = planNode(shell);
  const keepPlan = target === "orb" || planAnimLocked(plan, shell);
  if (keepPlan) debugLog("plan-anim-cancel-blocked", `reason=stop target=${target}`);
  cancelClipAnims(shell, keepPlan);
  if (stroke) stroke.style.clipPath = "";
  if (fill) fill.style.removeProperty("box-shadow");
  if (plan && !keepPlan) {
    plan.style.visibility = "hidden";
    holdMotion(plan);
    const fit = planFitEl(plan);
    void getComputedStyle(plan).transform;
    dropPlanAnims(plan, "stop");
    fit?.getAnimations?.().forEach((anim) => anim.cancel());
    // Keep a warmed layer across the open. display:none drops the backing
    // store, and WebKitGTK would rasterise the markdown again at the seam.
    if (plan.dataset.warm === "1" && shell.dataset.planOpen === "1") {
      applyParkedPlan(shell, plan);
    } else {
      setSeamPhase(plan, "");
      clearPlanMotion(plan);
      plan.style.removeProperty("display");
      plan.classList.remove("is-seam-grow");
      forgetPlanWarm(plan);
      delete shell.dataset.planWidth;
    }
  } else if (plan && target === "orb") {
    debugLog("collapse-plan-keep", `seam=${seamPhase(plan) || "-"}`);
  }
  shell.classList.remove("is-growing-pill", "is-growing-panel", "is-orb-moving", "is-content-promoted", "is-plan-seam", "is-plan-arming", "is-plan-collapse");
}

function planSeamLive(shell) {
  if (!shell || shell.dataset.planOpen !== "1") return false;
  const phase = seamPhase(planNode(shell));
  return phase === "grown" || phase === "growing";
}

/** Keep the panel clip layer hot through the plan collapse that follows. */
function promoteCollapseLayer(shell) {
  if (!shell) return;
  promoteLayer(shell);
  promoteLayer(shell.querySelector(".morph-fill"));
  promoteLayer(shell.querySelector(".content"));
  promoteLayer(shell.querySelector(".morph-body"));
  debugLog("collapse-promote", `edge=${shell.dataset.edge || ""}`);
}

/** Class bookkeeping only. Opacity stays put so the handoff is not a blank card. */
function beginPanelCollapseContent(shell) {
  shell.classList.remove("is-plan-collapse", "is-content-hold", "open");
  shell.dataset.contentOnce = "";
  releaseContent(shell);
}

/** Plan clips shut before the panel collapse. Same ease, its own 200ms. */
async function collapsePlanSeam(shell, token) {
  if (!planSeamLive(shell)) return;
  shell.classList.add("is-plan-collapse");
  promoteCollapseLayer(shell);
  const plan = planNode(shell);
  const closed = planRevealClip(shell, 0).value;
  if (reducedMotion()) {
    shell.style.clipPath = closed;
    applyParkedPlan(shell, plan);
    setSeamPhase(plan, "", { dom: false });
    return;
  }
  const from = planRevealClip(shell, 1).value;
  const duration = PLAN_COLLAPSE_MS;
  holdMotion(shell);
  debugLog("collapse-start", `plan=first edge=${shell.dataset.edge || ""} ms=${duration}`);
  shell._collapsePlanAt = performance.now();
  noteCollapse(shell, "plan");
  let anim = null;
  try {
    anim = shell.animate([
      { clipPath: from },
      { clipPath: closed },
    ], { duration, easing: COLLAPSE_EASE, fill: "forwards", id: "plan-collapse" });
  } catch {
    shell.style.clipPath = closed;
    applyParkedPlan(shell, plan);
    setSeamPhase(plan, "", { dom: false });
    return;
  }
  shell._clipHold = anim;
  shell.style.clipPath = closed;
  pumpSeamPresent(shell, duration);
  watchPresent(shell, anim, "plan-collapse");
  await whenAnimReaches(anim, PLAN_COLLAPSE_HANDOFF_MS);
  if (!shell.isConnected || (token && shell.dataset.morphToken !== token)) return;
  armPanelCollapse(shell);
  setSeamPhase(plan, "", { dom: false });
  debugLog("collapse-handoff", `at=${PLAN_COLLAPSE_HANDOFF_MS} edge=${shell.dataset.edge || ""}`);
}

function whenAnimReaches(anim, ms) {
  if (!anim || !(ms > 0)) return Promise.resolve();
  const started = performance.now();
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    const step = () => {
      if (done) return;
      let current = 0;
      try { current = Number(anim.currentTime) || 0; } catch { current = 0; }
      if (current >= ms || performance.now() - started >= ms) {
        finish();
        return;
      }
      requestAnimationFrame(step);
    };
    window.setTimeout(finish, ms);
    step();
  });
}

function noteCollapse(shell, key) {
  if (!shell) return;
  if (!shell._collapseMark) shell._collapseMark = { plan: 0, panel: 0, end: 0 };
  if (!(shell._collapseMark[key] > 0)) shell._collapseMark[key] = performance.now();
}

function logCollapseSpan(shell) {
  const mark = shell?._collapseMark;
  if (!mark || !(mark.panel > 0)) return;
  if (!(mark.plan > 0)) mark.plan = mark.panel;
  mark.end = performance.now();
  debugLog(
    "collapse-start",
    `plan=${mark.plan.toFixed(1)} panel=${mark.panel.toFixed(1)} end=${mark.end.toFixed(1)}`,
  );
  shell._collapseMark = null;
  shell._panelCollapse = null;
  shell._collapsePlanAt = 0;
}

/** Start the panel clip at the plan handoff, before class changes. Waiting
 *  until the plan animation's finished state made the top edge add its full
 *  300ms clock after the 200ms plan clip. */
function armPanelCollapse(shell) {
  if (!shell || shell.dataset.planOpen !== "1" || !(shell._collapsePlanAt > 0)) return null;
  const panelMs = collapseMs(shell.dataset.edge || "bottom");
  const elapsed = Math.max(0, performance.now() - shell._collapsePlanAt);
  const overlap = shellOverlapClip(shell, panelMs, elapsed);
  if (!overlap) {
    const endAt = PLAN_COLLAPSE_HANDOFF_MS + panelMs;
    if (elapsed >= endAt) {
      writeClip(shell, insetsFor("orb", shellGeom(shell)));
      noteCollapse(shell, "panel");
      shell._panelCollapse = {
        anim: null,
        duration: panelMs,
        startedAt: shell._collapsePlanAt + PLAN_COLLAPSE_HANDOFF_MS,
        panelMs,
        done: true,
      };
    }
    shell.getAnimations?.().forEach((anim) => {
      if (anim.id === "plan-collapse") anim.cancel();
    });
    return null;
  }
  shell.style.clipPath = clipPath(overlap.start);
  shell.getAnimations?.().forEach((anim) => {
    if (anim.id === "plan-collapse") anim.cancel();
  });
  let anim = null;
  try {
    anim = shell.animate(overlap.frames, {
      duration: overlap.duration,
      easing: "linear",
      fill: "forwards",
      id: "panel-collapse",
    });
  } catch {
    return null;
  }
  shell.style.clipPath = clipPath(overlap.end);
  const armed = { anim, duration: overlap.duration, startedAt: performance.now(), panelMs };
  shell._panelCollapse = armed;
  noteCollapse(shell, "panel");
  debugLog(
    "collapse-overlap",
    `edge=${shell.dataset.edge || ""} handoff=${PLAN_COLLAPSE_HANDOFF_MS} panel=${panelMs} elapsed=${elapsed.toFixed(1)} span=${overlap.duration.toFixed(1)}`,
  );
  return armed;
}

async function runShellMorph(shell, target) {
  if (!shell) return false;
  abortPlanRehearsal(shell);
  restoreHostedPlan(shell);
  if (closeYieldsToOpen(target, shell.dataset.intent)) {
    shell.dataset.intent = "";
    shell.classList.remove("is-collapsing");
  }
  let closingScale = 1;
  if (target === "orb") {
    const orb = shell.querySelector(".morph-orb");
    if (shell.classList.contains("is-orb-docked")) closingScale = ICON / ORB;
    else if (orb) closingScale = orbScaleNow(orb);
  }
  const token = String((Number(shell.dataset.morphToken) || 0) + 1);
  shell.dataset.morphToken = token;
  shell.getAnimations?.().forEach((anim) => anim.cancel());
  stopShellTransition(shell, target);
  debugLog("morph-start", `target=${target} bot=${shell.dataset.botId || ""} edge=${shell.dataset.edge || ""}`);
  if (target === "panel") {
    const openingPlan = planNode(shell);
    if (openingPlan && seamPhase(openingPlan) === "grown") retireGrownSeam(openingPlan);
    else if (openingPlan) setSeamPhase(openingPlan, "");
  }
  // Settled panels pin clip-path/overflow with !important so the corner
  // stroke is not cut. The next morph has to drop that before it can clip.
  shell.style.removeProperty("clip-path");
  shell.style.removeProperty("overflow");
  planNode(shell)?.style.removeProperty("clip-path");
  planNode(shell)?.style.removeProperty("overflow");
  shell.querySelectorAll(".center-panel").forEach((panel) => {
    panel.getAnimations?.().forEach((anim) => {
      if (anim.id === "content-collapse") anim.cancel();
    });
    panel.style.removeProperty("clip-path");
    panel.style.removeProperty("overflow");
  });
  const alive = () => shell.dataset.morphToken === token && shell.isConnected;
  const from = shell.dataset.visual || shell.dataset.state || "orb";
  window.clearTimeout(shell._pillTimer);
  if (target === "orb") {
    shell.dataset.intent = "close";
    delete shell.dataset.dragged;
    dropParkedAnchor(state.anchors, shell.dataset.botId);
    // Stacking must not have moved the orb. Put the box back on the edge
    // anchor before the clip runs, so the idle disc is the launch position.
    placeShellElement(shell);
  }
  shell.style.willChange = "clip-path, transform, opacity";
  shell.classList.add("is-morphing");
  shell._motion = target === "orb" ? "collapse" : "open";
  if (target !== "orb") {
    shell.querySelectorAll(".content, .morph-body, .morph-pill, .panel-header, .morph-orb").forEach((el) => {
      holdMotion(el);
      el.style.setProperty("animation", "none", "important");
    });
  }
  if (from === target && !shell.classList.contains("is-collapsing")) {
    if (alive()) settleShell(shell, target);
    return true;
  }
  if (target === "orb") {
    holdMotion(shell);
    holdMotion(shell.querySelector(".morph-fill"));
    shell.dataset.intent = "close";
    shell.classList.add("is-collapsing");
    holdCollapseGate(shell);
    pauseHitSync();
    promoteCollapseLayer(shell);
    debugLog("collapse-start", `edge=${shell.dataset.edge || ""} scale=${closingScale}`);
    shell._closingScale = closingScale;
    shell._collapseMark = { plan: 0, panel: 0, end: 0 };
    shell._panelCollapse = null;
    shell._collapsePlanAt = 0;
    shell.classList.remove("is-orb-moving");
    shell.dataset.opening = "";
  } else {
    shell.classList.remove("is-collapsing");
    shell.dataset.intent = target === "panel" ? "open" : "preview";
    if (target === "panel") {
      shell.dataset.opening = "panel";
      shell.classList.remove("is-orb-docked");
      parkFinalBox(shell);
      shell.querySelectorAll(".center-panel").forEach((panel) => {
        panel.hidden = false;
      });
      resetContent(shell);
      void shell.offsetWidth;
      if (shell.dataset.kind === "bot") primeCachedChat(shell);
    } else {
      shell.dataset.opening = "";
      shell.classList.remove("is-orb-docked");
      resetContent(shell);
    }
  }
  if (target === "panel" && shell.dataset.planOpen === "1") {
    if (!shell.dataset.planSide) shell.dataset.planSide = sideFromStyle(shell);
    warmPlanLayer(shell);
    announcePanelHits(shell);
    armSeamWatch(2000);
    await nextPaint();
    if (!alive()) return false;
  } else if (target === "panel" && shell.dataset.kind === "bot" && threadHasCache(threadFor(shell.dataset.botId))) {
    announcePanelHits(shell);
    await nextPaint();
    if (!alive()) return false;
  } else if (target === "panel") {
    announcePanelHits(shell);
  } else if (target === "orb") {
    announceOrbHits(shell);
  }
  if (target === "orb") {
    await collapsePlanSeam(shell, token);
    if (!alive()) {
      if (target === "orb") releaseCollapseGate(shell);
      return false;
    }
    beginPanelCollapseContent(shell);
  }
  let current = from;
  for (const step of phaseList(shell.dataset.edge || "bottom", from, target)) {
    if (step.state === "panel" && target === "panel") {
      revealContent(shell);
      primePanelTail(shell);
    }
    if (target !== "orb") markVisual(shell, step.state);
    const ok = await playClip(shell, current, step.state, reducedMotion() ? 0 : step.ms, token, step.ease || EASE);
    if (!ok || !alive()) {
      if (alive() && target === "orb") {
        settleShell(shell, "orb");
        return true;
      }
      if (alive()) shell._motion = "";
      if (target === "orb") releaseCollapseGate(shell);
      return false;
    }
    current = step.state;
  }
  if (!alive()) {
    if (target === "orb") releaseCollapseGate(shell);
    return false;
  }
  if (target === "panel" && shell.dataset.planOpen === "1") {
    const id = shell.dataset.botId;
    const thread = threadFor(id);
    const plan = planNode(shell);
    // A layer that already presented during the panel clip starts on this
    // turn. A cold plan stays parked until plan-warm has painted real text.
    if (planPresented(plan)) {
      debugLog("plan-warm", `reuse side=${shell.dataset.planSide || "right"} ink=${planInk(plan)} frames=${plan.dataset.warmFrames || 0}`);
      await playPlanSeam(shell, token);
    } else if (thread.loaded || thread.messages.length || thread.planCache || planInk(plan) > 0) {
      shell.dataset.paintThrough = "1";
      renderChat(id, { force: true });
      delete shell.dataset.paintThrough;
      warmPlanLayer(shell);
      shell.classList.add("is-plan-seam");
      const ready = alive() && await waitPlanPresented(shell);
      // The 340ms warm wait often ends before six presented frames. The
      // seam still hosts on that warm layer; hiding here left the union
      // in the hit list and never logged the close point (R-CT-01).
      const hosted = plan.dataset.warm === "1" && !!plan.dataset.key;
      if (alive() && (ready || hosted)) await playPlanSeam(shell, token);
      else if (alive()) hideUnwarmedPlan(shell);
    } else {
      warmPlanLayer(shell);
      shell.classList.add("is-plan-seam");
      const ready = alive() && await waitPlanPresented(shell);
      const hosted = plan.dataset.warm === "1" && !!plan.dataset.key;
      if (alive() && (ready || hosted)) await playPlanSeam(shell, token);
      else if (alive()) {
        shell.dataset.seamWait = "1";
        hideUnwarmedPlan(shell);
      }
    }
  } else if (target === "panel" && shell.dataset.kind === "bot") {
    const thread = threadFor(shell.dataset.botId);
    if (!thread.loaded && !thread.planCache && thread.messages.length === 0) {
      shell.dataset.seamWait = "1";
    }
  }
  if (!alive()) {
    if (target === "orb") releaseCollapseGate(shell);
    return false;
  }
  settleShell(shell, target);
  if (target === "panel") paintOpenedHeldLook();
  return true;
}

function raisePanel(panel) {
  const host = panel?.closest?.(".morph") || panel;
  if (!host) return;
  state.panelZ += 1;
  host.style.zIndex = String(state.panelZ);
  placePlanHost(host);
  scheduleHitSync();
}

function clearInnerPanelBox(panel, shell) {
  if (!panel || panel === shell) return;
  for (const prop of ["left", "top", "right", "bottom", "width", "height"]) {
    panel.style.removeProperty(prop);
  }
}

function bindPanelDrag(panel) {
  if (!panel) return;
  const header = panel.querySelector(".panel-header, .settings-head");
  if (!header) return;
  // Bound before the panel moves into a morph, the listener keeps the panel
  // as its host and one click writes viewport coordinates onto it (R-PN-03).
  if (!panelDragHost(panel)) return;
  if (header.dataset.dragBound === "shell") return;
  header.dataset.dragBound = "shell";
  header.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    if (event.target.closest("button, input, textarea, select, a, label")) return;
    const shell = panelDragHost(panel);
    if (!shell) return;
    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    let dragged = false;
    let origin = null;
    const move = (ev) => {
      if (ev.pointerId !== event.pointerId) return;
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!dragged) {
        if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
        dragged = true;
        clearInnerPanelBox(panel, shell);
        state.dragHitId = shell.dataset.hitId || "";
        raisePanel(shell);
        flushHits();
        origin = shell.getBoundingClientRect();
        shell.style.right = "auto";
        shell.style.bottom = "auto";
        shell.style.left = `${origin.left}px`;
        shell.style.top = `${origin.top}px`;
      }
      shell.style.left = `${origin.left + dx}px`;
      shell.style.top = `${origin.top + dy}px`;
      syncPlanSide(shell);
      if (shell.dataset.planHost === "1") placePlanHost(shell);
      else hostOpenPlan(shell);
      rememberAnchor(shell);
      scheduleHitSync();
    };
    const up = (ev) => {
      if (ev.pointerId !== event.pointerId) return;
      header.removeEventListener("pointermove", move);
      header.removeEventListener("pointerup", up);
      header.removeEventListener("pointercancel", up);
      if (!dragged) return;
      shell.dataset.dragged = "1";
      state.dragHitId = "";
      clearInnerPanelBox(panel, shell);
      rememberAnchor(shell);
      layoutShell(shell);
      separateOpenShells([...document.querySelectorAll(".morph")]);
      flushHits();
    };
    header.addEventListener("pointermove", move);
    header.addEventListener("pointerup", up);
    header.addEventListener("pointercancel", up);
    try {
      header.setPointerCapture(event.pointerId);
    } catch {
      /* The drag listeners stay on the header when the pointer id is synthetic. */
    }
  });
}

function removeBotPanels() {
  document.querySelectorAll(".morph[data-kind='bot']").forEach((shell) => shell.remove());
  state.openIds = [];
}

function inTauri() {
  return "__TAURI_INTERNALS__" in window || "__TAURI__" in window;
}

function shortLabel(name) {
  const chars = Array.from((name || "").trim());
  return chars[0] || "?";
}

const state = {
  mode: "mock",
  settings: null,
  bots: [],
  activeId: null,
  threads: new Map(),
  busy: new Set(),
  alwaysOnTop: true,
  interaction: {
    modifier: "ctrl",
    fadeEnabled: true,
    fadeDistance: 120,
    minOpacity: 0.25,
    supported: true,
  },
  pointerHitId: "",
  heldKeys: new Set(),
  osModifierDown: false,
  modifierHeld: false,
  showBotNames: false,
  workInsets: { top: 0, right: 0, bottom: 0, left: 0 },
  latchedOrbId: "",
  pressFrozen: false,
  latchedIds: [],
  windowFocused: true,
  dropdownOpen: false,
  catalog: null,
  catalogHint: "",
  catalogProfile: "",
  slashIndex: 0,
  slashArgsHint: "",
  reconnectToken: 0,
  reconnectTimer: 0,
  gatewayClock: 0,
  openIds: [],
  anchors: {},
  panelPos: {},
  panelZ: 4,
  slashPanelId: "",
  dragHitId: "",
  souls: new Map(),
  kanbanOpen: false,
  kanban: {
    board: null,
    fingerprint: "",
    unread: false,
    saving: false,
    dragging: false,
    detailOpen: false,
    explicit: "",
    boards: [],
    current: "",
    doneOpen: false,
  },
  rosterTimer: 0,
  keyPromptBots: [],
  prefetchDeferred: false,
  kanbanPaintDue: null,
  kanbanTimer: 0,
  cronOpen: false,
  cronGroups: [],
  cronTimer: 0,
  cronClock: 0,
  cronBoxH: 0,
  cronBurst: false,
  cronHover: false,
  cronSeenRun: new Set(),
  cronRunMarks: new Map(),
  cronPrimed: false,
  toastSeq: 0,
  deniedSessions: new Set(),
  unsentDrafts: new Map(),
  pendingSends: new Map(),
  sendErrors: new Map(),
  clarifyTimer: 0,
};

const probeGate = createProbeGate();
const gateway = createReconnect({
  onWait() {
    paintGatewayWait();
  },
  onClear() {
    clearGatewayWait();
  },
});
gateway.bind("gateway", () => recoverGateway());

function threadFor(id) {
  if (!state.threads.has(id)) {
    state.threads.set(id, {
      messages: [],
      status: "閒置",
      activity: { thinking: false, streaming: false, deadline: null },
      unread: false,
      sessions: [],
      sessionId: "",
      sessionExplicit: false,
      sessionAnchor: 0,
      sessionReadOnly: false,
      sessionReadOnlyReason: "",
      bySession: new Map(),
    });
  }
  return state.threads.get(id);
}

function showActionError(message) {
  console.warn(message);
  setBanner(message, "error");
  const status = $("#settings-status");
  if (status && settingsOpen()) status.textContent = message;
}

const BANNER_OK_MS = 4000;
let bannerTimer = 0;

function setBanner(text, kind = "error", sticky = "", action = "") {
  const banner = $("#conn-banner");
  window.clearTimeout(bannerTimer);
  bannerTimer = 0;
  banner.classList.remove("ok", "info", "danger");
  banner.dataset.sticky = sticky || "";
  banner.replaceChildren();
  delete banner.dataset.hitId;
  if (!text) {
    banner.hidden = true;
    placeKeyBanner();
    return;
  }
  banner.hidden = false;
  if (kind === "ok" || kind === "info") banner.classList.add(kind);
  else banner.classList.add("danger");
  if (action === "settings") {
    banner.dataset.hitId = "banner";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "banner-action";
    button.dataset.action = "settings";
    const link = "設定";
    const linkAt = text.indexOf(link);
    const paint = (value, kind) => {
      if (!value) return;
      const span = document.createElement("span");
      span.className = kind === "link" ? "banner-link" : "banner-copy";
      span.textContent = value;
      button.appendChild(span);
    };
    if (linkAt >= 0) {
      paint(text.slice(0, linkAt), "copy");
      paint(link, "link");
      paint(text.slice(linkAt + link.length), "copy");
    } else {
      button.textContent = text;
    }
    banner.appendChild(button);
    placeKeyBanner();
    return;
  }
  banner.textContent = text;
  if ((kind === "ok" || kind === "info") && sticky !== "keyring" && sticky !== "gateway" && sticky !== "keys") {
    bannerTimer = window.setTimeout(() => {
      bannerTimer = 0;
      const held = banner.dataset.sticky;
      if (held === "keyring" || held === "gateway" || held === "keys") return;
      setBanner("");
    }, BANNER_OK_MS);
  }
  placeKeyBanner();
}

function clearConnectionBanner() {
  const banner = $("#conn-banner");
  const held = banner.dataset.sticky;
  if (held === "keyring" || held === "gateway" || held === "keys") return;
  setBanner("");
}

/** undefined until the first paint, so the initial selection does not pulse. */
let renderedActiveId;

function previewNode() {
  const pill = document.createElement("div");
  pill.className = "morph-pill";
  const text = document.createElement("span");
  text.className = "morph-preview";
  text.dataset.role = "preview";
  const time = document.createElement("time");
  time.dataset.role = "preview-time";
  pill.append(text, time);
  return pill;
}

function pointInBox(x, y, box) {
  return !!box && box.w >= 1 && box.h >= 1
    && x >= box.x && x <= box.x + box.w
    && y >= box.y && y <= box.y + box.h;
}

function shellHitLevel(shell) {
  const z = Number.parseInt(shell.style.zIndex, 10);
  if (Number.isFinite(z)) return z;
  if (shell.dataset.state === "pill") return 40;
  if (shell.dataset.state === "panel") return 1;
  return 0;
}

/** Visible clip, not the pre-sized layout box. A finished clip animation can
 *  leave WebKitGTK hit-testing the border box for a few frames. */
function visibleShellAt(x, y) {
  let best = null;
  let bestZ = -Infinity;
  document.querySelectorAll(".morph").forEach((shell) => {
    if (shell.classList.contains("is-collapsing")) return;
    const box = visibleBox(shell);
    if (!pointInBox(x, y, box)) return;
    const level = shellHitLevel(shell);
    if (!best || level >= bestZ) {
      best = shell;
      bestZ = level;
    }
  });
  return best;
}

function activateHitShell(shell) {
  const hitId = shell?.dataset.botId || "";
  if (!hitId) return;
  if (hitId === "settings") focusSettings();
  else if (hitId === "kanban") toggleKanban();
  else if (hitId === "cron") toggleCron();
  else selectBot(hitId);
}

function attachShell(shell, id) {
  shell.addEventListener("pointerenter", () => {
    if (id === "settings" || id === "kanban" || id === "cron") return;
    prefetchBotChats();
  });
  shell.addEventListener("click", (event) => {
    if (orbOpenedThisPress()) return;
    const mine = visibleBox(shell);
    const inside = pointInBox(event.clientX, event.clientY, mine);
    if (!inside) {
      const foreign = visibleShellAt(event.clientX, event.clientY);
      if (!foreign || foreign === shell || foreign.dataset.state === "panel") return;
    if (pageOpenBlocked() || !orbClickAllowed(event)) return;
    debugLog("click-retarget", `from=${id} to=${foreign.dataset.botId || ""}`);
      activateHitShell(foreign);
      return;
    }
    const orb = event.target.closest?.(".morph-orb");
    if (shell.dataset.state === "panel") {
      focusOpenPanel(id);
      return;
    }
    if (!orb && shell.dataset.state === "orb") return;
    if (pageOpenBlocked() || !orbClickAllowed(event)) return;
    activateHitShell(shell);
  });
  shell.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    if (shell.dataset.state !== "orb") return;
    if (!modifierHeld(event)) return;
    event.stopPropagation();
    if (id === "settings" || id === "kanban" || id === "cron") return;
    openOrbMenu(id, event.clientX, event.clientY);
  });
}

function mountBotPanel(shell, id) {
  if (shell.querySelector(".bot-panel")) return;
  const tpl = document.getElementById("bot-panel-template");
  const fragment = tpl.content.cloneNode(true);
  const panel = fragment.querySelector(".bot-panel");
  const plan = fragment.querySelector(".plan-window");
  panel.dataset.botId = id;
  panel.dataset.panelKey = id;
  panel.classList.add("morph-body", "content");
  panel.hidden = true;
  const slash = role(panel, "slash");
  if (slash) slash.dataset.hitId = `slash:${id}`;
  const close = role(panel, "close");
  if (close) close.dataset.hitId = `close:${id}`;
  shell.append(panel);
  if (plan) {
    if (!plan.dataset.seamNode) {
      mountBotPanel.serial = (mountBotPanel.serial || 0) + 1;
      plan.dataset.seamNode = String(mountBotPanel.serial);
    }
    shell.append(plan);
    installPlanDomLog();
    seamLog("create", `id=${plan.dataset.seamNode} bot=${id}`);
  }
  wireBotPanel(panel, id);
  wirePlanWindow(plan, id);
  bindPanelDrag(panel);
  if (plan) bindPanelDrag(plan);
}

function ensureBotShell(bot) {
  let shell = shellFor(bot.id);
  if (shell) return shell;
  shell = document.createElement("div");
  shell.className = "morph";
  shell.dataset.kind = "bot";
  shell.dataset.botId = bot.id;
  shell.dataset.state = "orb";
  shell.dataset.visual = "orb";
  shell.dataset.hitId = `bot:${bot.id}`;
  const stroke = document.createElement("div");
  stroke.className = "morph-stroke";
  stroke.setAttribute("aria-hidden", "true");
  const fill = document.createElement("div");
  fill.className = "morph-fill";
  const glow = document.createElement("div");
  glow.className = "morph-glow";
  fill.appendChild(glow);
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "bot-btn morph-orb";
  btn.dataset.botId = bot.id;
  btn.addEventListener("animationend", (event) => {
    if (event.animationName === "orb-pulse") btn.classList.remove("orb-enter");
    if (event.animationName === "ping") event.target.remove();
  });
  fillOrb(btn);
  const label = document.createElement("span");
  label.className = "bot-label";
  btn.appendChild(label);
  shell.append(stroke, fill, btn, previewNode());
  attachShell(shell, bot.id);
  $("#bot-rail").appendChild(shell);
  mountBotPanel(shell, bot.id);
  return shell;
}

function ensureChromeShell(panel, id, glyph, label, orbClass) {
  let shell = shellFor(id);
  if (shell) {
    const existing = shell.querySelector(".morph-orb");
    if (existing && existing.dataset.orbName !== label) existing.dataset.orbName = label;
    return shell;
  }
  shell = document.createElement("div");
  shell.className = "morph";
  shell.dataset.kind = "chrome";
  shell.dataset.botId = id;
  shell.dataset.state = "orb";
  shell.dataset.visual = "orb";
  shell.dataset.hitId = `bot:${id}`;
  const stroke = document.createElement("div");
  stroke.className = "morph-stroke";
  stroke.setAttribute("aria-hidden", "true");
  const fill = document.createElement("div");
  fill.className = "morph-fill";
  const glow = document.createElement("div");
  glow.className = "morph-glow";
  fill.appendChild(glow);
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = `bot-btn morph-orb ${orbClass}`;
  btn.dataset.botId = id;
  btn.dataset.orbName = label;
  if (id === "kanban") {
    btn.addEventListener("animationend", (event) => {
      if (event.animationName === "ping") event.target.remove();
    });
  }
  fillOrb(btn);
  const name = document.createElement("span");
  name.className = "bot-label";
  name.textContent = label;
  btn.appendChild(name);
  btn.querySelector(".orb-glyph").textContent = glyph;
  panel.classList.add("morph-body", "content");
  panel.hidden = true;
  panel.removeAttribute("data-hit-id");
  const close = panel.querySelector("#btn-settings-close, #btn-kanban-close, #btn-cron-close");
  if (close) close.dataset.hitId = `close:${id}`;
  shell.append(stroke, fill, btn, previewNode(), panel);
  attachShell(shell, id);
  bindPanelDrag(panel);
  $("#bot-rail").appendChild(shell);
  layoutShell(shell);
  return shell;
}

function ensureChrome() {
  const settings = document.getElementById("settings");
  const kanban = document.getElementById("kanban-panel");
  const cron = document.getElementById("cron-panel");
  if (settings) ensureChromeShell(settings, "settings", "設", "設定", "orb--settings");
  if (kanban) ensureChromeShell(kanban, "kanban", "▥", "看板", "orb--kanban");
  if (cron) ensureChromeShell(cron, "cron", "時", "排程", "orb--cron");
}

function botPaintSig() {
  return state.bots.map((bot) => {
    const thread = threadFor(bot.id);
    const open = state.openIds.includes(bot.id) ? 1 : 0;
    return [
      bot.id,
      bot.name,
      bot.color,
      bot.short,
      open,
      thread.activity || "",
      thread.statusState || "",
      thread.unread ? 1 : 0,
      thread.messages.some(approvalPending) && !open ? 1 : 0,
    ].join(":");
  }).join("|") + `|${state.activeId || ""}|${state.showBotNames ? 1 : 0}`;
}

function renderBots(tag = "renderBots") {
  let wait = rehearsalWaitReason();
  if (tag === "pointer-release" && wait !== "plan-open" && wait !== "morph") wait = "";
  if (wait) {
    renderBots.pending = true;
    debugLog("render-bots-defer", `tag=${tag} reason=${wait}`);
    postponeOrbWork();
    return;
  }
  if (backgroundBlocked()) {
    renderBots.pending = true;
    debugLog("render-bots-defer", `tag=${tag} quiet=${collapseQuiet() ? 1 : 0}`);
    return;
  }
  const sig = botPaintSig();
  if (sig === renderBots.sig && state.bots.every((bot) => shellFor(bot.id))) {
    renderBots.pending = false;
    renderKanbanOrb();
    renderCronOrb();
    renderSettingsOrb();
    paintOrbNames();
    return;
  }
  renderBots.sig = sig;
  if (debugFile.enabled) debugLog("render-bots", `tag=${tag} call=${callerTag("renderBots")}`);
  renderBots.pending = false;
  const rail = $("#bot-rail");
  ensureChrome();
  const pulse = nextOrbPulse(renderedActiveId, state.activeId);
  renderedActiveId = pulse.rendered;
  const pulseId = pulse.pulseId;
  const keep = new Set(state.bots.map((bot) => bot.id));
  rail.querySelectorAll(".morph[data-kind='bot']").forEach((shell) => {
    if (keep.has(shell.dataset.botId)) return;
    state.openIds = closePanel(state.openIds, shell.dataset.botId);
    shell.remove();
  });
  state.bots.forEach((bot) => {
    const shell = ensureBotShell(bot);
    const morphing = shell.classList.contains("is-morphing")
      || shell.classList.contains("is-collapsing")
      || visualQuiet(shell);
    const btn = shell.querySelector(".morph-orb");
    if (btn && btn.dataset.orbName !== bot.name) btn.dataset.orbName = bot.name;
    const thread = threadFor(bot.id);
    if (morphing) {
      // Rewriting className restarts the orb ::before transition. On the left
      // edge that glow sits on the title and washes it for one frame.
    } else {
    const keepEnter = btn.classList.contains("orb-enter") && bot.id === state.activeId;
    const classes = ["bot-btn", "morph-orb"];
    if (state.openIds.includes(bot.id) || shell.dataset.state === "panel") classes.push("active");
    const motion = orbMotion(thread.activity, thread.statusState);
    if (motion === "spin") classes.push("is-thinking");
    if (motion === "wait") classes.push("is-waiting");
    if (thread.unread) classes.push("has-unread");
    const panelOpen = state.openIds.includes(bot.id) || shell.dataset.state === "panel";
    const approvalWait = thread.messages.some(approvalPending) || parkedApproval(thread);
    const clarifyWait = thread.messages.some(clarifyPending) || parkedClarify(thread);
    if (showApprovalBadge(panelOpen, approvalWait || clarifyWait)) classes.push("has-approval");
    if (thread.statusState === "error") classes.push("error");
    if (bot.id === pulseId || keepEnter) classes.push("orb-enter");
    const nextClass = classes.join(" ");
    if (btn.className !== nextClass) btn.className = nextClass;
    applyBotColor(shell, bot.color);
    applyBotColor(btn, bot.color);
    const orbLabel = classes.includes("has-approval")
      ? (approvalWait ? `${bot.name}，有工具等緊批准` : `${bot.name}，有問題等你答`)
      : bot.name;
    if (btn.getAttribute("aria-label") !== orbLabel) btn.setAttribute("aria-label", orbLabel);
    if (btn.title !== orbLabel) btn.title = orbLabel;
    const glyph = btn.querySelector(".orb-glyph");
    const nameLabel = btn.querySelector(".bot-label");
    const shortText = bot.short || "";
    if (glyph && glyph.textContent !== shortText) glyph.textContent = shortText;
    if (nameLabel && nameLabel.textContent !== bot.name) nameLabel.textContent = bot.name;
    layoutShell(shell);
    }
    // Moving a node that is already in the rail restarts CSS transitions on it,
    // which replays the content fade and snaps a clip that is still running.
    if (shell.parentElement !== rail) rail.appendChild(shell);
  });
  renderKanbanOrb();
  renderCronOrb();
  renderSettingsOrb();
  separateOpenShells([...document.querySelectorAll(".morph")]);
  paintOrbNames();
  scheduleHitSync();
  schedulePlanRehearsal();
}

/** Button keeps the swatch. The shell colour tints the halo, so an
 *  idle kanban or settings shell must not keep the open-panel channels. */
function paintIdleChromeColor(shell, btn, hex) {
  applyBotColor(btn, hex);
  const open = !!shell && (
    (shell.dataset.visual || shell.dataset.state) === "panel"
    || shell.dataset.opening === "panel"
  );
  if (open) {
    applyBotColor(shell, hex);
    return;
  }
  if (shell?.dataset.kind === "chrome" && shell.dataset.botId !== "cron") {
    shell.style.removeProperty("--bot");
    shell.style.removeProperty("--bot-rgb");
    shell.style.removeProperty("--bot-color");
  }
}

function renderSettingsOrb() {
  ensureChrome();
  const shell = shellFor("settings");
  const btn = shell?.querySelector(".orb--settings");
  if (!btn) return;
  const open = settingsOpen();
  const next = ["bot-btn", "morph-orb", "orb--settings", open ? "active" : ""].filter(Boolean).join(" ");
  const laid = btn.className === next && !!shell.style.width;
  const dirtyColor = !open && !!shell.style.getPropertyValue("--bot-rgb");
  if (btn.className !== next) btn.className = next;
  if (!open) btn.classList.remove("active");
  if (!laid || dirtyColor) paintIdleChromeColor(shell, btn, NOUS.blue);
  btn.setAttribute("aria-label", "Hermes 設定");
  btn.title = "Hermes 設定";
  if (!laid) layoutShell(shell);
}

function fillOrb(btn) {
  const hit = document.createElement("span");
  hit.className = "bot-hit";
  hit.setAttribute("aria-hidden", "true");
  const core = document.createElement("span");
  core.className = "orb-core";
  const glyph = document.createElement("span");
  glyph.className = "orb-glyph";
  const spinner = document.createElement("span");
  spinner.className = "spinner";
  spinner.setAttribute("aria-hidden", "true");
  const unread = document.createElement("span");
  unread.className = "unread-dot";
  const badge = document.createElement("span");
  badge.className = "approval-badge";
  badge.setAttribute("aria-hidden", "true");
  btn.append(hit, core, glyph, spinner, unread, badge);
}

function renderKanbanOrb() {
  ensureChrome();
  const shell = shellFor("kanban");
  const btn = shell?.querySelector(".orb--kanban");
  if (!btn) return;
  const next = ["bot-btn", "morph-orb", "orb--kanban", state.kanbanOpen ? "active" : "", state.kanban.unread ? "has-unread" : ""]
    .filter(Boolean)
    .join(" ");
  const waiting = gateway.isDown("gateway");
  const label = waiting ? (gateway.status("gateway") || RECONNECT_STATUS) : "看板";
  if (btn.className === next && shell.style.width) {
    if (btn.title !== label) {
      btn.title = label;
      btn.setAttribute("aria-label", label);
    }
    return;
  }
  btn.className = next;
  paintIdleChromeColor(shell, btn, NOUS.neutral);
  btn.setAttribute("aria-label", label);
  btn.title = label;
  layoutShell(shell);
}

function noteCronTransition(groups) {
  const running = new Set();
  (groups || []).forEach((group) => {
    (group.jobs || []).forEach((job) => {
      if (job.running) running.add(job.id);
    });
  });
  if (!state.cronPrimed) {
    state.cronPrimed = true;
    state.cronSeenRun = running;
    return running.size === 0 && cronOrbActive(groups);
  }
  let finished = false;
  state.cronSeenRun.forEach((id) => {
    if (!running.has(id)) finished = true;
  });
  state.cronSeenRun = running;
  return finished;
}

function cronReadoutVisible(shell, text) {
  const orb = (shell?.dataset.visual || shell?.dataset.state) === "orb";
  return !!text && orb && state.osModifierDown === true && state.cronHover === true;
}

function placeCronReadout(shell, face) {
  const label = document.getElementById("cron-readout");
  const btn = shell?.querySelector(".orb--cron");
  if (!label || !btn) return;
  const text = face?.label || "";
  const show = cronReadoutVisible(shell, text);
  if (!show) {
    label.hidden = true;
    label.textContent = "";
    return;
  }
  label.hidden = false;
  label.textContent = text;
  label.classList.toggle("is-live", face.mode === "spin" || face.mode === "progress");
  const box = btn.getBoundingClientRect();
  const width = label.offsetWidth;
  const height = label.offsetHeight;
  const center = window.innerWidth / 2;
  const towardLeft = box.left + box.width / 2 > center;
  let left = towardLeft ? box.left - width - 8 : box.right + 8;
  let top = box.top + box.height / 2 - height / 2;
  left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
  top = Math.max(8, Math.min(top, window.innerHeight - height - 8));
  label.style.left = `${Math.round(left)}px`;
  label.style.top = `${Math.round(top)}px`;
}

function syncCronClock(face) {
  const live = face.mode === "spin" || face.mode === "progress";
  if (live && !state.cronClock) {
    state.cronClock = window.setInterval(() => renderCronOrb({ tick: true }), 1000);
  }
  if (!live && state.cronClock) {
    window.clearInterval(state.cronClock);
    state.cronClock = 0;
  }
}

function ensureCronStatus(shell) {
  if (!shell) return null;
  const live = shell._cronStatus;
  if (live?.isConnected) return live;
  const node = document.createElement("span");
  node.className = "cron-status";
  node.setAttribute("aria-hidden", "true");
  node.hidden = true;
  (shell.parentElement || document.getElementById("bot-rail"))?.append(node);
  shell._cronStatus = node;
  return node;
}

/** Failed ring and done ripple sit outside the shell, so the shell's idle
 *  opacity does not fade them and the orb clip does not cut the ripple. */
function placeCronStatus(shell) {
  if (!shell || shell.dataset.botId !== "cron") return;
  const node = ensureCronStatus(shell);
  if (!node) return;
  const orb = (shell.dataset.visual || shell.dataset.state) === "orb";
  const failed = shell.classList.contains("is-cron-fail");
  const done = shell.classList.contains("is-cron-done");
  if (!orb || shell.classList.contains("is-collapsing") || (!failed && !done)) {
    node.hidden = true;
    node.classList.remove("is-failed", "is-done");
    return;
  }
  node.hidden = false;
  node.classList.toggle("is-failed", failed);
  node.classList.toggle("is-done", done && !failed);
  // The shell is the full panel box, clipped down to the disc. The ring
  // used to sit on the 44px button, so the sibling uses that same box.
  const ax = Number(shell.dataset.ax) || ORB / 2;
  const ay = Number(shell.dataset.ay) || ORB / 2;
  const shellLeft = Number.parseFloat(shell.style.left) || 0;
  const shellTop = Number.parseFloat(shell.style.top) || 0;
  node.style.left = `${shellLeft + ax - ORB / 2}px`;
  node.style.top = `${shellTop + ay - ORB / 2}px`;
  node.style.width = `${ORB}px`;
  node.style.height = `${ORB}px`;
  const p = shell.querySelector(".orb--cron")?.style.getPropertyValue("--p");
  if (p) node.style.setProperty("--p", p);
  else node.style.removeProperty("--p");
}

function renderCronOrb(options = {}) {
  if (!options.force && backgroundBlocked()) {
    if (collapseBusy() || collapseQuiet()) {
      state.cronDeferred = true;
      debugLog("refresh-tick-defer", "cron-orb");
    }
    return;
  }
  ensureChrome();
  const shell = shellFor("cron");
  const btn = shell?.querySelector(".orb--cron");
  if (!btn) return;
  if (btn.dataset.hoverWatch !== "1") {
    btn.dataset.hoverWatch = "1";
    btn.addEventListener("pointerenter", () => {
      state.cronHover = true;
      renderCronOrb({ force: true });
    });
    btn.addEventListener("pointerleave", () => {
      state.cronHover = false;
      renderCronOrb({ force: true });
    });
  }
  pruneRunMarks(state.cronGroups, state.cronRunMarks);
  const face = cronOrbFace(state.cronGroups, new Date(), state.cronRunMarks);
  if (!options.tick && noteCronTransition(state.cronGroups) && face.mode !== "failed" && !state.cronBurst) {
    state.cronBurst = true;
    window.setTimeout(() => {
      state.cronBurst = false;
      btn.classList.remove("is-done", "is-running", "is-progress", "is-failed");
      btn.classList.add("is-idle");
      shell.classList.remove("is-cron-done");
      delete shell.dataset.cronSig;
      placeCronStatus(shell);
    }, 400);
  }
  const live = face.mode === "spin" || face.mode === "progress";
  const classes = ["bot-btn", "morph-orb", "orb--cron"];
  if (state.cronOpen) classes.push("active");
  if (face.mode === "spin") classes.push("is-running");
  else if (face.mode === "progress") classes.push("is-progress");
  else if (face.mode === "failed") classes.push("is-failed");
  else if (state.cronBurst) classes.push("is-done");
  else classes.push("is-idle");
  const label = face.label || "";
  const show = cronReadoutVisible(shell, label);
  const sig = `${classes.join(" ")}|${face.p}|${label}|${show ? 1 : 0}|${live ? 1 : 0}`;
  if (shell.dataset.cronSig === sig) return;
  shell.dataset.cronSig = sig;
  shell.classList.toggle("is-cron-live", live);
  shell.classList.toggle("is-cron-fail", face.mode === "failed");
  shell.classList.toggle("is-cron-done", state.cronBurst && face.mode !== "failed" && !live);
  btn.className = classes.join(" ");
  if (face.mode === "progress" || face.mode === "failed") btn.style.setProperty("--p", String(face.p));
  else btn.style.removeProperty("--p");
  applyBotColor(shell, NOUS.neutral);
  applyBotColor(btn, NOUS.neutral);
  const caption = live ? "排程工作進行中" : face.mode === "failed" ? "排程工作失敗" : "排程工作";
  btn.setAttribute("aria-label", caption);
  btn.title = caption;
  if (!options.tick) layoutShell(shell);
  placeCronStatus(shell);
  placeCronReadout(shell, face);
  syncCronClock(face);
  if (options.tick) paintCronArcs();
  paintOrbNames();
}

function chatStamp(thread) {
  const last = thread.messages[thread.messages.length - 1];
  const approvals = thread.messages
    .filter((message) => message.role === "approval")
    .map((message) => `${message.requestId || ""}:${message.status || ""}`)
    .join(",");
  const clarifies = thread.messages
    .filter((message) => message.role === "clarify")
    .map((message) => `${message.promptId || ""}:${message.status || ""}`)
    .join(",");
  const unsent = thread.messages.some((message) => message.unsent) ? 1 : 0;
  return `${thread.sessionId}|${thread.messages.length}|${last?.role || ""}|${String(last?.text || "").length}|${last?.live ? 1 : 0}|${unsent}|${approvals}|${clarifies}`;
}

function threadHasCache(thread) {
  return !!(thread && (thread.loaded || thread.messages.length || thread.planCache));
}

function chatPainted(id) {
  const thread = threadFor(id);
  const chat = chatOf(id);
  if (!thread || !chat) return false;
  return chat.dataset.stamp === chatStamp(thread) && chat.childElementCount === thread.messages.length;
}

function primeCachedChat(shell) {
  if (!shell || shell.dataset.kind !== "bot") return;
  const id = shell.dataset.botId;
  if (!threadHasCache(threadFor(id)) || chatPainted(id)) return;
  shell.dataset.paintThrough = "1";
  renderChat(id, { force: true });
  delete shell.dataset.paintThrough;
}

function ensurePlanChip(node, message, id) {
  if (!id || message.role !== "bot" || message.live || node.querySelector(".plan-chip")) return;
  const messages = threadFor(id).messages;
  const plan = plansIn(messages).find((item) => messages[item.index] === message);
  if (!plan) return;
  const chip = document.createElement("button");
  chip.type = "button";
  chip.className = "plan-chip";
  chip.textContent = "睇計劃";
  chip.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    openPlanWindow(id, plan.key);
  });
  node.appendChild(chip);
}

function syncChatInPlace(chat, thread, id, resting = false) {
  const messages = thread.messages;
  for (let i = 0; i < messages.length; i += 1) {
    const message = messages[i];
    let node = chat.children[i];
    if (!node) {
      const created = bubbleEl(message, id);
      if (resting) restBubble(created);
      chat.appendChild(created);
      continue;
    }
    if (resting) restBubble(node);
    const want = message.role === "user" ? "user" : message.role === "bot" ? "bot" : message.role;
    const nextClass = `bubble ${want}`;
    if (node.className !== nextClass) node.className = nextClass;
    if (message.role === "bot") {
      paintBotBubble(node, message.text);
      ensurePlanChip(node, message, id);
    } else if (message.role === "user") {
      const line = node.querySelector(".user-line");
      const marked = !!node.querySelector(".unsent-mark");
      if (!line || line.textContent !== (message.text || "") || marked !== !!message.unsent) {
        node.replaceChildren();
        paintUserBubble(node, message);
      }
    } else if (message.role === "approval") {
      paintApprovalBubble(node, message, id);
    } else if (message.role === "clarify") {
      paintClarifyBubble(node, message, id);
    } else if (node.textContent !== (message.text || "")) {
      node.textContent = message.text || "";
    }
    if (message.live) node.dataset.live = "1";
    else delete node.dataset.live;
  }
  while (chat.childElementCount > messages.length) chat.lastElementChild.remove();
  chat.dataset.stamp = chatStamp(thread);
}

function mountChat(chat, thread, id, resting = false) {
  const frag = document.createDocumentFragment();
  thread.messages.forEach((message) => {
    const node = bubbleEl(message, id);
    if (resting) restBubble(node);
    frag.appendChild(node);
  });
  chat.replaceChildren(frag);
  chat.dataset.stamp = chatStamp(thread);
}

function replaceHtml(el, html) {
  const scratch = document.createElement("div");
  scratch.innerHTML = html;
  el.replaceChildren(...scratch.childNodes);
}

function renderChat(id = state.activeId, options = {}) {
  const shell = shellFor(id);
  const force = options.force === true;
  const tag = options.tag || "renderChat";
  const growing = !!shell && (seamPhase(planNode(shell)) === "growing" || shell.classList.contains("is-plan-arming"));
  if (shell && (growing || (seamRevealLive(shell) && !force)) && shell.dataset.paintThrough !== "1") {
    shell.dataset.chatDirty = "1";
    shell.dataset.planDirty = "1";
    debugLog("render-panel-defer", `id=${id} tag=${tag} seam=1`);
    armQuietFlush(shell);
    return;
  }
  if (shell && !force && deferShellWork(shell)) {
    shell.dataset.chatDirty = "1";
    debugLog("render-panel-defer", `id=${id} tag=${tag}`);
    return;
  }
  const panel = panelFor(id);
  if (!panel) return;
  const bot = state.bots.find((b) => b.id === id);
  const chat = role(panel, "chat");
  if (!bot || !chat) return;
  if (debugFile.enabled) debugLog("render-panel", `id=${id} force=${force ? 1 : 0} tag=${tag} call=${callerTag("renderChat")}`);
  const thread = threadFor(bot.id);
  retainOutgoing(bot.id);
  const title = role(panel, "name");
  if (title && title.textContent !== bot.name) title.textContent = bot.name;
  const statusEl = role(panel, "status");
  setStatusText(id, thread.status || bot.status || "閒置");
  if (statusEl) statusEl.dataset.state = thread.statusState || "idle";
  const nameInput = role(panel, "display-name");
  if (nameInput && nameInput.dataset.dirty !== "1" && document.activeElement !== nameInput) {
    nameInput.value = bot.name || "";
  }
  const detailInput = role(panel, "detail");
  if (detailInput && detailInput.dataset.dirty !== "1" && document.activeElement !== detailInput) {
    detailInput.value = bot.detail || "";
  }
  const hint = role(panel, "hint");
  if (hint) hint.textContent = hintText();
  const quietChrome = shell && visualQuiet(shell) && !force;
  if (!quietChrome) {
    paintOrb(role(panel, "avatar"), bot.color, bot.short || "");
    applyBotColor(panel, bot.color);
    paintSessionSelect(id);
  }
  const stamp = chatStamp(thread);
  const current = chat.dataset.stamp === stamp && chat.childElementCount === thread.messages.length;
  const resting = options.resting === true;
  if (!current) {
    if (thread.followTail === false) thread.scrollTop = chat.scrollTop;
    markProgrammaticScroll(chat);
    if (chat.childElementCount > 0) syncChatInPlace(chat, thread, bot.id, resting);
    else mountChat(chat, thread, bot.id, resting);
    stickChat(id);
  } else {
    // The stamp already counts 未送出. A commentary append can set that
    // stamp without repainting the user line, so repair the mark here.
    repaintUnsent(bot.id);
    chat.querySelectorAll(".bubble").forEach((node, index) => {
      const message = thread.messages[index];
      if (resting) restBubble(node);
      if (message?.role === "bot") ensurePlanChip(node, message, bot.id);
    });
  }
  paintPlan(id, { force });
  const stop = role(panel, "stop");
  const send = role(panel, "send");
  const input = role(panel, "input");
  const note = role(panel, "readonly");
  const cont = role(panel, "continue");
  const locked = !!thread.sessionReadOnly && !!thread.sessionId;
  if (note) {
    note.hidden = !locked;
    note.textContent = locked
      ? readOnlyNote(thread.sessionReadOnlyReason || SESSION_READ_ONLY_REASON)
      : "";
  }
  if (cont) cont.hidden = !locked;
  if (input) {
    input.disabled = locked;
    input.placeholder = locked ? "只可以睇" : "輸入訊息給呢個 Bot…";
  }
  if (stop) stop.hidden = !(state.mode === "hermes" && state.busy.has(bot.id));
  if (send) send.disabled = locked || (state.mode === "hermes" && state.busy.has(bot.id));
  if (!quietChrome) syncActivityChrome(id);
  if (!shell || !visualQuiet(shell)) scheduleHitSync();
  paintApprovalBadge(id);
  requestAnimationFrame(() => logPlanChip(id));
}

function logPlanChip(id) {
  const chip = panelFor(id)?.querySelector(".plan-chip");
  if (!chip) return;
  const box = chip.getBoundingClientRect();
  if (box.width < 1 || box.height < 1) return;
  const x = Math.round(box.x + box.width / 2);
  const y = Math.round(box.y + box.height / 2);
  const key = `${id}:${x},${y}`;
  if (logPlanChip.last === key) return;
  logPlanChip.last = key;
  debugLog("plan-chip-at", `bot=${id} x=${x} y=${y}`);
}

function planWindow(id) {
  return planNode(shellFor(id));
}

function syncPlanSide(shell) {
  const plan = planNode(shell);
  if (!shell || !plan) return;
  const box = shell.getBoundingClientRect();
  const width = Math.max(planWidthPx(), Number(shell.dataset.planWidth) || 0);
  shell.dataset.planSide = fitPlanBox({
    shellLeft: box.x,
    shellTop: box.y,
    shellW: box.width,
    shellH: box.height,
    planW: width,
    screenW: window.innerWidth || 0,
    screenH: window.innerHeight || 0,
  }).side;
}

function openPlanWindow(id, key) {
  const thread = threadFor(id);
  thread.planFocus = key || "";
  thread.planDismissed = "";
  const shell = shellFor(id);
  if (shell) shell.dataset.planRepublish = "1";
  // Quiet and the frozen hit list used to swallow this until relaunch.
  paintPlan(id, { force: true });
  if (shell?.dataset.planDirty === "1") armQuietFlush(shell);
}

function planSwapBlocked(shell, section) {
  if (seamPhase(section) === "growing") return true;
  return planContentHeld(shell);
}

function paintPlan(id, options = {}) {
  const shell = shellFor(id);
  const section = planWindow(id);
  if (!shell || !section) return;
  const force = options.force === true;
  const through = shell.dataset.paintThrough === "1";
  const growing = seamPhase(section) === "growing" || shell.classList.contains("is-plan-arming");
  if (force && growing) {
    shell.dataset.planDirty = "1";
    debugLog("render-plan-defer", `id=${id}`);
    return;
  }
  if (!through && !force && (visualQuiet(shell) || shellFrozen(shell))) {
    shell.dataset.planDirty = "1";
    debugLog("render-plan-defer", `id=${id}`);
    return;
  }
  if (debugFile.enabled) debugLog("render-plan", `id=${id} call=${callerTag("paintPlan")}`);
  const thread = threadFor(id);
  const plans = plansIn(thread.messages);
  noteNewestPlan(thread, plans);
  rememberPlan(thread, thread.messages);
  const focus = planForPanel(thread);
  const open = !!focus;
  const wasOpen = shell.dataset.planOpen === "1";
  seamLog("paint", `open=${open ? 1 : 0} was=${wasOpen ? 1 : 0} key=${focus?.key || ""}`);
  // A grown seam keeps is-plan-seam while the open morph holds the collapse
  // gate, so a deferred × never runs. Forced close of a grown plan drops
  // the pane on this turn (R-CT-01). Only a still-growing seam waits.
  if (!open && (growing || (!force && (freezeCooling(shell) || shell.classList.contains("is-plan-seam"))))) {
    shell.dataset.planDirty = "1";
    debugLog("plan-hide-blocked", `seam=${seamPhase(section) || "-"} force=${force ? 1 : 0}`);
    if (force) armQuietFlush(shell);
    return;
  }
  if (section.hidden !== !open) section.hidden = !open;
  if (open) shell.dataset.planOpen = "1";
  else delete shell.dataset.planOpen;
  if (!open) {
    restoreHostedPlan(shell);
    setSeamPhase(section, "");
    delete section.dataset.sizeLock;
    clearPlanMotion(section);
    section.style.width = "";
    section.style.height = "";
    section.style.minWidth = "";
    section.style.maxWidth = "";
    section.style.removeProperty("display");
    section.classList.remove("is-seam-grow");
    forgetPlanWarm(section);
    delete shell.dataset.planWidth;
    delete shell.dataset.planHeight;
    shell.classList.remove("is-plan-seam", "is-plan-arming");
    debugLog("plan-rect", `bot=${id} open=0`);
    // hitSilence kept the union that announcePanelHits published. A deferred
    // flush never runs while the panel stays open, so the empty plan rect
    // was still capturing 15s later (R-CT-01). An empty first paint is not
    // a close: retracting then logs a drop before the plan ever hosted.
    if (wasOpen) retractPlanHit(shell);
    return;
  }
  const heldFrame = section.dataset.sizeLock === "1"
    || seamPhase(section) === "growing"
    || seamPhase(section) === "grown";
  const frameSnap = heldFrame ? snapshotPlanGeometry(section) : null;
  section.dataset.key = focus.key;
  const title = role(section, "plan-title");
  if (title && title.textContent !== "計劃") title.textContent = "計劃";
  const lead = planBodyLead(focus.markdown, focus.title);
  const mode = section.dataset.mode === "source" ? "source" : "preview";
  section.dataset.mode = mode;
  const previewBtn = role(section, "plan-preview-mode");
  const sourceBtn = role(section, "plan-source-mode");
  if (previewBtn) previewBtn.setAttribute("aria-pressed", mode === "preview" ? "true" : "false");
  if (sourceBtn) sourceBtn.setAttribute("aria-pressed", mode === "source" ? "true" : "false");
  const body = role(section, "plan-body");
  const source = role(section, "plan-source");
  if (body) {
    body.hidden = mode !== "preview";
    if (mode === "preview") {
      const html = renderAssistantMarkdown(lead);
      if (body.dataset.md !== html) {
        if (planSwapBlocked(shell, section)) {
          shell.dataset.planDirty = "1";
          seamLog("content-hold", `key=${focus.key}`);
        } else {
          body.dataset.md = html;
          replaceHtml(body, html);
          decorateCodeBlocks(body);
          if (section.dataset.sizeLock !== "1" && !seamLocked(section)) {
            forgetPlanWarm(section);
          }
        }
      }
    }
  }
  if (source) {
    source.hidden = mode !== "source";
    if (mode === "source" && source.textContent !== lead) {
      if (planSwapBlocked(shell, section)) shell.dataset.planDirty = "1";
      else source.textContent = lead;
    }
  }
  if (seamLocked(section)) {
    if (frameSnap) restorePlanGeometry(section, frameSnap);
    if (!shell.classList.contains("is-plan-seam") && !collapseBusy()) scheduleHitSync();
    return;
  }
  const morphing = shell.classList.contains("is-morphing") || shell.classList.contains("is-collapsing");
  // The open morph leaves is-morphing on while the collapse gate is held,
  // so a later 睇計劃 used to warm the plan and return without hosting it.
  if (morphing && shell.dataset.planRepublish !== "1") {
    if (open) {
      if (!shell.dataset.planSide) shell.dataset.planSide = sideFromStyle(shell);
      warmPlanLayer(shell);
    }
    if (!through) shell.dataset.chatDirty = "1";
    return;
  }
  syncPlanSide(shell);
  separateOpenShells([...document.querySelectorAll(".morph")]);
  const settledPanel = (shell.dataset.visual || shell.dataset.state) === "panel";
  if (open && !wasOpen && settledPanel) {
    const token = shell.dataset.morphToken || "";
    warmPlanLayer(shell);
    void growAfterPaint(shell, token);
    return;
  }
  if (open && !wasOpen && planHostReady(shell)) warmPlanLayer(shell);
  if (!shell.classList.contains("is-plan-seam")) scheduleHitSync();
}

function wirePlanWindow(section, id) {
  if (!section) return;
  role(section, "plan-close")?.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const thread = threadFor(id);
    const focus = plansIn(thread.messages).find((item) => item.key === thread.planFocus) || latestPlan(thread.messages);
    thread.planDismissed = focus?.key || "closed";
    paintPlan(id, { force: true });
  });
  role(section, "plan-preview-mode")?.addEventListener("click", () => {
    section.dataset.mode = "preview";
    paintPlan(id);
  });
  role(section, "plan-source-mode")?.addEventListener("click", () => {
    section.dataset.mode = "source";
    paintPlan(id);
  });
}

function setStatusText(id, text) {
  const node = role(panelFor(id), "status-text");
  if (node) node.textContent = text;
}

function paintApprovalBubble(bubble, message, id) {
  bubble.className = "bubble approval";
  bubble.replaceChildren(renderApprovalCard(document, message, (choice) => {
    void answerApproval(id, message, choice);
  }));
}

function paintClarifyBubble(bubble, message, id) {
  bubble.className = "bubble clarify";
  bubble.replaceChildren(renderClarifyCard(document, message, {
    onAnswer(answer) {
      void answerClarify(id, message, answer);
    },
    onDraft(value) {
      message.draft = value;
      const send = bubble.querySelector(".clarify-primary");
      if (send && message.status === "pending" && !(message.choices || []).length) {
        send.disabled = !String(value || "").trim();
      }
    },
    onToggle(choice, checked) {
      const selected = Array.isArray(message.selected) ? message.selected : [];
      message.selected = checked ? [...selected, choice] : selected.filter((item) => item !== choice);
      const send = bubble.querySelector(".clarify-primary");
      if (send && message.status === "pending") send.disabled = message.selected.length === 0;
    },
  }));
}

function bubbleEl(m, id) {
  const bubble = document.createElement("div");
  bubble.className = `bubble ${m.role === "user" ? "user" : m.role === "bot" ? "bot" : m.role}`;
  if (m.role === "approval") {
    paintApprovalBubble(bubble, m, id);
    return bubble;
  }
  if (m.role === "clarify") {
    paintClarifyBubble(bubble, m, id);
    return bubble;
  }
  if (m.role === "bot") paintBotBubble(bubble, m.text);
  else if (m.role === "user") paintUserBubble(bubble, m);
  else bubble.textContent = m.text;
  if (m.live) bubble.dataset.live = "1";
  if (id && m.role === "bot" && !m.live) {
    const messages = threadFor(id).messages;
    const plan = plansIn(messages).find((item) => messages[item.index] === m);
    if (plan) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "plan-chip";
      chip.textContent = "睇計劃";
      chip.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        openPlanWindow(id, plan.key);
      });
      bubble.appendChild(chip);
    }
  }
  return bubble;
}

function paintUserBubble(bubble, message) {
  const line = document.createElement("span");
  line.className = "user-line";
  line.textContent = message.text || "";
  bubble.appendChild(line);
  if (message.command) {
    const chip = document.createElement("span");
    chip.className = "cmd-chip";
    chip.textContent = message.command;
    bubble.appendChild(chip);
  }
  if (message.unsent) {
    const mark = document.createElement("span");
    mark.className = "unsent-mark";
    mark.textContent = UNSENT_MARK;
    bubble.appendChild(mark);
  }
  if (!message.full) return;
  const full = document.createElement("div");
  full.className = "full-prompt";
  full.hidden = !message.expanded;
  full.textContent = message.full;
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "prompt-toggle";
  toggle.textContent = message.expanded ? "收起完整提示" : "顯示完整提示";
  toggle.addEventListener("click", () => {
    message.expanded = !message.expanded;
    full.hidden = !message.expanded;
    toggle.textContent = message.expanded ? "收起完整提示" : "顯示完整提示";
  });
  bubble.append(toggle, full);
}

function paintBotBubble(el, text) {
  const html = renderAssistantMarkdown(text);
  if (el.dataset.md === html) return;
  el.dataset.md = html;
  replaceHtml(el, html);
  decorateCodeBlocks(el);
}

const livePainters = new Map();

function painterFor(id) {
  let painter = livePainters.get(id);
  if (painter) return painter;
  painter = createLivePainter({
    delay: 50,
    paint() {
      paintLiveNow(id);
    },
  });
  livePainters.set(id, painter);
  return painter;
}

async function openExternal(url) {
  if (!isSafeLink(url)) return;
  if (inTauri()) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

const TAIL_GAP_PX = 80;

function chatNearTail(chat) {
  if (!chat) return true;
  return chat.scrollHeight - chat.scrollTop - chat.clientHeight <= TAIL_GAP_PX;
}

function markProgrammaticScroll(chat) {
  if (chat) chat.dataset.programmaticScroll = "1";
}

function assignChatScroll(chat, top) {
  if (!chat) return;
  markProgrammaticScroll(chat);
  chat.scrollTop = top;
  requestAnimationFrame(() => {
    delete chat.dataset.programmaticScroll;
  });
}

const pinTokens = new Map();

function pinChat(id) {
  const apply = () => {
    const thread = threadFor(id);
    const chat = chatOf(id);
    const top = pinnedScrollTop(chat, thread.followTail !== false);
    if (top == null || !chat) return false;
    markProgrammaticScroll(chat);
    chat.scrollTop = top;
    return true;
  };
  if (!apply()) return;
  const token = (pinTokens.get(id) || 0) + 1;
  pinTokens.set(id, token);
  requestAnimationFrame(() => {
    if (pinTokens.get(id) !== token) return;
    apply();
    requestAnimationFrame(() => {
      const chat = chatOf(id);
      if (chat) delete chat.dataset.programmaticScroll;
    });
  });
}

function stickChat(id) {
  if (!id) return;
  const thread = threadFor(id);
  if (thread.followTail === false) {
    const chat = chatOf(id);
    assignChatScroll(chat, thread.scrollTop || 0);
    requestAnimationFrame(() => {
      if (thread.followTail === false) assignChatScroll(chatOf(id), thread.scrollTop || 0);
    });
    return;
  }
  pinChat(id);
}

function noteChatScroll(id, chat, userGesture = false) {
  const thread = threadFor(id);
  const action = chatTailAction({
    followTail: thread.followTail !== false,
    userGesture,
    nearTail: chatNearTail(chat),
  });
  if (action === "remember") {
    thread.followTail = false;
    thread.scrollTop = chat.scrollTop;
    return;
  }
  if (action === "restore") {
    assignChatScroll(chat, thread.scrollTop || 0);
    return;
  }
  thread.followTail = true;
  pinChat(id);
}

function armUserScroll(chat) {
  if (!chat) return;
  chat.dataset.userScroll = "1";
  window.clearTimeout(chat._userScrollTimer);
  chat._userScrollTimer = window.setTimeout(() => {
    delete chat.dataset.userScroll;
  }, 400);
}

function restickOpenChats() {
  document.querySelectorAll('.morph[data-kind="bot"][data-state="panel"]').forEach((shell) => {
    if (shell.classList.contains("is-morphing") || shell.classList.contains("is-collapsing")) return;
    const id = shell.dataset.botId;
    const thread = threadFor(id);
    const chat = chatOf(id);
    if (!chat) return;
    if (thread.followTail === false) assignChatScroll(chat, thread.scrollTop || 0);
    else pinChat(id);
  });
}

function runMessages(id) {
  return runTranscript(threadFor(id));
}

function runIsOnScreen(id) {
  return viewingRun(threadFor(id));
}

function parkedApproval(thread) {
  const parked = thread?.liveSessionId && thread.bySession?.get(thread.liveSessionId);
  return !!(parked && parked !== thread.messages && parked.some(approvalPending));
}

function parkedClarify(thread) {
  const parked = thread?.liveSessionId && thread.bySession?.get(thread.liveSessionId);
  return !!(parked && parked !== thread.messages && parked.some(clarifyPending));
}

function settleBlockedCopies(id) {
  const thread = threadFor(id);
  const messages = runMessages(id);
  const next = omitRepeatedBlockedLine(messages);
  if (next.length === messages.length) return false;
  if (messages === thread.messages) thread.messages = next;
  if (thread.liveSessionId) {
    if (!thread.bySession) thread.bySession = new Map();
    const parked = thread.bySession.get(thread.liveSessionId);
    if (parked === messages || messages === thread.messages) {
      thread.bySession.set(thread.liveSessionId, messages === thread.messages ? thread.messages : next);
    }
  }
  return true;
}

function appendOnce(id, message) {
  const thread = threadFor(id);
  const messages = runMessages(id);
  if (message?.text === EXECUTE_CODE_BLOCKED_LINE && messages.some((item) => item.text === EXECUTE_CODE_BLOCKED_LINE)) {
    if (settleBlockedCopies(id) && runIsOnScreen(id) && panelFor(id)) renderChat(id);
    return;
  }
  if (!runIsOnScreen(id)) {
    messages.push(message);
    return;
  }
  appendMessage(id, message);
}

function appendMessage(id, message) {
  const thread = threadFor(id);
  thread.messages.push(message);
  const shell = shellFor(id);
  if (shell && (deferShellWork(shell) || presentationBusy())) {
    shell.dataset.chatDirty = "1";
    if (presentationBusy()) armPresentationFlush();
    return;
  }
  const chat = chatOf(id);
  if (!chat) return;
  chat.appendChild(bubbleEl(message, id));
  chat.dataset.stamp = chatStamp(thread);
  if (thread.followTail !== false) pinChat(id);
  paintPlan(id);
}

function setBotStatus(id, text, statusState) {
  const thread = threadFor(id);
  const waitingApproval = thread.messages.some(approvalPending) || parkedApproval(thread);
  const waitingClarify = thread.messages.some(clarifyPending) || parkedClarify(thread);
  const raw = String(text);
  if (waitingApproval && (raw.includes("思考中") || raw === CLARIFY_WAIT_LABEL)) text = APPROVAL_WAIT_LABEL;
  else if (waitingClarify && raw.includes("思考中")) text = CLARIFY_WAIT_LABEL;
  else if (
    thread.queued
    && !waitingApproval
    && !waitingClarify
    && (raw.includes("思考中") || raw === "排隊中，等佢講完就會行")
  ) text = "排隊中";
  thread.status = text;
  thread.statusState = statusState;
  if (statusState === "busy") state.busy.add(id);
  else state.busy.delete(id);
  const shell = shellFor(id);
  if (shell && (visualQuiet(shell) || presentationBusy())) {
    setStatusText(id, text);
    const statusEl = role(panelFor(id), "status");
    if (statusEl) statusEl.dataset.state = statusState || "idle";
    shell.dataset.chatDirty = "1";
    if (presentationBusy()) armPresentationFlush();
    return;
  }
  if (panelFor(id)) renderChat(id);
  if (thread.loading) return;
  renderBots();
}

function cancelReconnect() {
  state.reconnectToken += 1;
  window.clearTimeout(state.reconnectTimer);
  state.reconnectTimer = 0;
  gateway.reset();
  clearGatewayWait();
}

function applyOpened(id, opened, { quiet = false } = {}) {
  const thread = threadFor(id);
  const messages = (opened.messages || []).map(presentMessage);
  const sessions = opened.sessions || [];
  const nextId = opened.session_id || "";
  if (keepManualSession(
    { id: thread.sessionId, explicit: thread.sessionExplicit },
    { id: nextId },
    quiet,
  )) return;
  const sessionKey = nextId || thread.sessionId;
  const heldError = sendErrorDraft(state.sendErrors, id, sessionKey);
  const shown = mergeSendError(
    mergeUnsentDraft(
      mergePendingSend(messages, pendingSend(state.pendingSends, id, sessionKey)),
      unsentDraft(state.unsentDrafts, id, sessionKey),
    ),
    heldError,
  );
  const running = state.busy.has(id);
  const switching = running && thread.sessionId && nextId && thread.sessionId !== nextId;
  if (switching) {
    if (!thread.liveSessionId) noteRunSession(thread);
    rememberView(thread);
    showSession(thread, nextId, shown);
  }
  const keptApprovals = !switching && thread.sessionId === nextId
    ? thread.messages.filter((message) => approvalPending(message) || clarifyKept(message))
    : [];
  if (!switching && !(running && thread.messages.some((message) => message.live))) {
    if (quiet && sameChatSnapshot({
      sessionId: thread.sessionId,
      sessionExplicit: thread.sessionExplicit,
      sessionReadOnly: thread.sessionReadOnly,
      messages: thread.messages,
      sessions: thread.sessions,
    }, {
      sessionId: nextId,
      sessionExplicit: !!opened.session_explicit,
      sessionReadOnly: !!opened.read_only,
      messages: shown,
      sessions,
    }) && thread.statusState !== "busy") {
      if (panelShowing(id)) restoreSendErrorBanner(id);
      return;
    }
    thread.messages = shown;
    for (const card of keptApprovals) {
      const same = thread.messages.some((message) => {
        if (card.role === "approval") return message.role === "approval" && message.requestId === card.requestId;
        if (card.role === "clarify") return message.role === "clarify" && message.promptId === card.promptId;
        return false;
      });
      if (!same) thread.messages.push(card);
    }
  }
  thread.loaded = true;
  thread.sessionId = nextId || thread.sessionId;
  thread.messages = mergeSendError(
    mergeUnsentDraft(
      mergePendingSend(thread.messages, pendingSend(state.pendingSends, id, thread.sessionId)),
      unsentDraft(state.unsentDrafts, id, thread.sessionId),
    ),
    sendErrorDraft(state.sendErrors, id, thread.sessionId),
  );
  thread.sessionExplicit = !!opened.session_explicit;
  thread.sessionAnchor = Number(opened.session_anchor) || 0;
  const locked = readOnlyLocked(state.deniedSessions, id, thread.sessionId, !!opened.read_only);
  thread.sessionReadOnly = locked;
  thread.sessionReadOnlyReason = locked ? (opened.read_only_reason || SESSION_READ_ONLY_REASON) : "";
  thread.sessions = sessions;
  thread.loading = false;
  rememberPlan(thread, thread.messages);
  const keptError = sendErrorDraft(state.sendErrors, id, thread.sessionId);
  if (panelShowing(id)) {
    if (keptError) setBanner(keptError, "error");
    else clearConnectionBanner();
  }
  const shell = shellFor(id);
  const openPanel = shell?.dataset.state === "panel" && !shell.classList.contains("is-collapsing");
  if (running) {
    if (openPanel) renderChat(id, { force: true, tag: "session-switch" });
    else if (shell) shell.dataset.chatDirty = "1";
    renderBots();
    return;
  }
  const resting = thread.sessionReadOnly ? "只可以睇" : "閒置";
  if (openPanel) {
    if (keptError && !locked) setBotStatus(id, "連線錯誤", "error");
    else setBotStatus(id, resting, "idle");
    renderChat(id, { force: true, tag: "session-switch" });
    return;
  }
  const label = keptError && !locked ? "連線錯誤" : resting;
  const tone = keptError && !locked ? "error" : "idle";
  if (shell && (visualQuiet(shell) || presentationBusy())) {
    thread.status = label;
    thread.statusState = tone;
    state.busy.delete(id);
    setStatusText(id, label);
    shell.dataset.chatDirty = "1";
    shell.dataset.planDirty = "1";
    armPresentationFlush();
    return;
  }
  setBotStatus(id, label, tone);
}

function beginBotHistory(id) {
  if (state.mode !== "hermes" || !inTauri()) return null;
  if (gateway.isDown("gateway")) {
    gateway.kick("gateway");
    return null;
  }
  const thread = threadFor(id);
  if (thread.loaded) return null;
  if (thread.historyPromise) return thread.historyPromise;
  const token = state.reconnectToken;
  thread.loading = true;
  thread.historyPromise = loadBotHistory(id, token).finally(() => {
    thread.loading = false;
    thread.historyPromise = null;
  });
  return thread.historyPromise;
}

function prefetchBotChats() {
  if (state.mode !== "hermes" || !inTauri()) return;
  if (backgroundBlocked()) {
    state.prefetchDeferred = true;
    debugLog("refresh-tick-defer", "prefetch");
    armPresentationFlush();
    return;
  }
  for (const bot of state.bots) {
    if (bot.hasKey === false) continue;
    beginBotHistory(bot.id)?.catch((err) => {
      if (gatewayDown(String(err))) noteGatewayDown();
    });
  }
}

function prefetchOrbUnderCursor() {
  if (state.mode !== "hermes" || !inTauri()) return;
  const pad = 24;
  for (const bot of state.bots) {
    const shell = shellFor(bot.id);
    const visual = shell?.dataset.visual || shell?.dataset.state;
    if (!shell || visual !== "orb") continue;
    const box = shell.getBoundingClientRect();
    const x = cursorPoint.x;
    const y = cursorPoint.y;
    if (x < box.left - pad || x > box.right + pad || y < box.top - pad || y > box.bottom + pad) continue;
    prefetchBotChats();
    return;
  }
}

function refreshBotChats() {
  if (gateway.isDown("gateway") || probeGate.has("kanban")) return;
  if (collapseBusy() || collapseQuiet()) {
    state.refreshDeferred = true;
    debugLog("refresh-tick-defer", "frozen=1");
    armPresentationFlush();
    return;
  }
  const frozen = presentationBusy();
  debugLog("refresh-tick", `frozen=${frozen ? 1 : 0}`);
  if (state.mode !== "hermes" || !inTauri()) return;
  if (frozen) {
    state.refreshDeferred = true;
    armPresentationFlush();
    return;
  }
  for (const bot of state.bots) {
    if (bot.hasKey === false) continue;
    const shell = shellFor(bot.id);
    const thread = threadFor(bot.id);
    if (visualQuiet(shell)) continue;
    if (thread.watchReply) {
      void catchUpSession(bot.id);
      continue;
    }
    if (state.busy.has(bot.id)) continue;
    if (thread.historyPromise) continue;
    if (!thread.loaded) {
      beginBotHistory(bot.id)?.catch((err) => {
        if (gatewayDown(String(err))) noteGatewayDown();
      });
      continue;
    }
    const token = state.reconnectToken;
    const panelOpen = shell?.dataset.state === "panel" && !shell.classList.contains("is-collapsing");
    const reload = panelOpen && thread.sessionExplicit && thread.sessionId
      ? reloadOpenSession(bot.id, token, { quiet: true })
      : loadBotHistory(bot.id, token, { quiet: true });
    const job = reload.catch((err) => {
      if (gatewayDown(String(err))) noteGatewayDown();
      return false;
    }).finally(() => {
      if (thread.historyPromise === job) thread.historyPromise = null;
    });
    thread.historyPromise = job;
  }
}

function armChatRefresh() {
  window.clearInterval(state.chatRefresh);
  state.chatRefresh = window.setInterval(refreshBotChats, 4000);
}

const pendingHistory = new Map();

async function reloadOpenSession(id, token, { quiet = false } = {}) {
  return loadBotHistory(id, token, { quiet });
}

async function loadBotHistory(id, token, { quiet = false } = {}) {
  const { invoke } = await import("@tauri-apps/api/core");
  const opened = await invoke("open_bot", { profile: id, quiet });
  if (token !== state.reconnectToken || state.mode !== "hermes") return false;
  if (backgroundBlocked()) {
    pendingHistory.set(id, { opened, token });
    armPresentationFlush();
    debugLog("history-defer", `id=${id}`);
    return false;
  }
  applyOpened(id, opened, { quiet });
  return true;
}

function paintSessionSelect(id) {
  const select = role(panelFor(id), "session");
  if (!select || document.activeElement === select) return;
  const thread = threadFor(id);
  const sessions = orderSessions(thread.sessions || []);
  const key = JSON.stringify([thread.sessionId, sessions.map((session) => [session.id, session.title, session.hidden, session.archived, session.source])]);
  if (select.dataset.key === key) return;
  select.replaceChildren();
  const rows = sessions.length
    ? sessions
    : thread.sessionId
      ? [{ id: thread.sessionId, title: thread.sessionId, hidden: false }]
      : [];
  if (!rows.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "未有對話";
    select.appendChild(option);
    select.disabled = true;
    select.dataset.key = key;
    return;
  }
  for (const session of rows) {
    const option = document.createElement("option");
    option.value = session.id;
    option.textContent = sessionLabel(session);
    select.appendChild(option);
  }
  select.disabled = false;
  select.value = thread.sessionId || rows[0].id;
  select.dataset.key = key;
}

async function pickSession(id, sessionId) {
  const thread = threadFor(id);
  const select = role(panelFor(id), "session");
  if (!sessionId || sessionId === thread.sessionId) return;
  if (state.mode !== "hermes" || !inTauri()) {
    if (state.busy.has(id) && !thread.liveSessionId) noteRunSession(thread);
    rememberView(thread);
    const anchor = Math.max(0, ...(thread.sessions || []).map((session) => Number(session.last_active) || 0));
    const picked = (thread.sessions || []).find((session) => session.id === sessionId);
    const stored = thread.bySession?.get(sessionId);
    showSession(thread, sessionId, (stored || [{ role: "bot", text: "（舊對話）" }]).map((message) => ({ ...message })));
    thread.sessionExplicit = true;
    thread.sessionAnchor = anchor;
    const locked = readOnlyLocked(state.deniedSessions, id, sessionId, sessionReadOnly(picked?.source));
    thread.sessionReadOnly = locked;
    thread.sessionReadOnlyReason = locked ? SESSION_READ_ONLY_REASON : "";
    thread.loaded = true;
    if (select) delete select.dataset.key;
    renderChat(id);
    renderBots();
    return;
  }
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const opened = await invoke("select_session", { profile: id, sessionId });
    if (select) delete select.dataset.key;
    applyOpened(id, opened);
  } catch (err) {
    if (select) select.value = thread.sessionId;
    showActionError(String(err));
  }
}

function noteHistoryError(id, err) {
  const thread = threadFor(id);
  thread.loaded = false;
  const message = String(err);
  debugLog("history-error", `id=${id} ${message}`);
  if (gatewayDown(message)) {
    setBotStatus(id, "自動重試", "idle");
    noteGatewayDown();
    return;
  }
  appendMessage(id, { role: "commentary", text: message });
  setBotStatus(id, "連線錯誤", "error");
  setBanner(message, "error");
}

function noteGatewayDown() {
  if (state.mode !== "hermes") return;
  gateway.fail("gateway");
}

function paintGatewayWait() {
  if (!gateway.isDown("gateway")) return;
  const text = gateway.status("gateway") || RECONNECT_STATUS;
  const empty = $("#kanban-empty");
  const root = $("#kanban-board");
  const featureMissing = state.kanban.board?.unavailable && kanbanUnavailable(state.kanban.board.message);
  const login = $("#kanban-login");
  if (login) login.hidden = true;
  const detail = $("#kanban-detail");
  if (detail) {
    detail.hidden = true;
    detail.replaceChildren();
  }
  state.kanban.detailOpen = false;
  if (empty && root && !featureMissing) {
    empty.hidden = false;
    empty.classList.remove("is-unavailable");
    if (!empty.classList.contains("is-retry")) root.replaceChildren();
    empty.classList.add("is-retry");
    empty.textContent = text;
    root.hidden = true;
    if (!state.kanban.board?.retry) {
      state.kanban.board = {
        board: state.kanban.board?.board || kanbanRequestSlug(state.kanban.explicit),
        columns: [],
        unavailable: true,
        retry: true,
        message: text,
      };
      state.kanban.fingerprint = boardFingerprint(state.kanban.board);
    }
  }
  const cronEmpty = $("#cron-empty");
  const cronList = $("#cron-list");
  if (cronEmpty) {
    if (!cronEmpty.classList.contains("is-retry")) cronList?.replaceChildren();
    cronEmpty.hidden = false;
    cronEmpty.classList.add("is-retry");
    cronEmpty.textContent = text;
  }
  const btn = shellFor("kanban")?.querySelector(".orb--kanban");
  if (btn) {
    btn.title = text;
    btn.setAttribute("aria-label", text);
  }
  const banner = $("#conn-banner");
  if (banner && (banner.dataset.sticky !== "gateway" || banner.textContent !== text)) {
    setBanner(text, "info", "gateway");
  }
  placeKeyBanner();
  if (!state.gatewayClock) {
    state.gatewayClock = window.setInterval(() => {
      if (!gateway.isDown("gateway")) {
        window.clearInterval(state.gatewayClock);
        state.gatewayClock = 0;
        return;
      }
      if (gateway.inflight("gateway")) return;
      paintGatewayWait();
    }, 1000);
  }
}

function clearGatewayWait() {
  window.clearInterval(state.gatewayClock);
  state.gatewayClock = 0;
  $("#kanban-empty")?.classList.remove("is-retry");
  $("#cron-empty")?.classList.remove("is-retry");
  const btn = shellFor("kanban")?.querySelector(".orb--kanban");
  if (btn && gateway.isDown("gateway") === false) {
    btn.title = "看板";
    btn.setAttribute("aria-label", "看板");
  }
  const banner = $("#conn-banner");
  if (banner?.dataset.sticky === "gateway") {
    if (!showKeyPrompt()) setBanner("");
    scheduleHitSync("keys");
  }
}

function keyPromptText(bots) {
  const names = bots.map((bot) => bot.display_name || bot.profile).join("、");
  return `${names} 未有 API 金鑰，請喺設定填寫。金鑰唔會自動產生。`;
}

function showKeyPrompt() {
  const bots = state.keyPromptBots || [];
  if (!bots.length || gateway.isDown("gateway")) return false;
  setBanner(keyPromptText(bots), "info", "keys", "settings");
  placeKeyBanner();
  scheduleHitSync("keys");
  return true;
}

function resetKeyBannerShift(banner) {
  if (!banner) return;
  banner.style.top = "";
  banner.style.left = "";
  banner.style.width = "";
  banner.style.maxWidth = "";
  banner.style.transform = "";
  delete banner.dataset.parked;
}

function visibleBandBottom(node) {
  if (!node || node.hidden || node.closest("[hidden]")) return 0;
  const box = node.getBoundingClientRect();
  return box.height >= 1 ? box.bottom : 0;
}

function errorToastPanelBox() {
  const shells = [];
  const preferred = shellFor(state.activeId);
  if (preferred) shells.push(preferred);
  document.querySelectorAll(".morph[data-state='panel']:not(.is-collapsing)").forEach((node) => {
    if (node !== preferred) shells.push(node);
  });
  for (const shell of shells) {
    if (!shell || shell.classList.contains("is-collapsing")) continue;
    if (shell.dataset.state !== "panel" && shell.dataset.opening !== "panel") continue;
    const panel = shell.querySelector(".center-panel");
    if (!panel || panel.hidden || panel.closest("[hidden]")) continue;
    const rect = panel.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) continue;
    const header = panel.querySelector(".panel-header, .settings-head");
    const band = header && !header.hidden ? header.getBoundingClientRect() : null;
    const headerBottom = band && band.height >= 1 ? band.bottom : rect.top;
    const chromeBottom = Math.max(
      headerBottom,
      visibleBandBottom(panel.querySelector(".panel-switch")),
      visibleBandBottom(panel.querySelector(".chat-head")),
    );
    return {
      x: rect.x,
      y: rect.y,
      w: rect.width,
      h: rect.height,
      headerTop: band && band.height >= 1 ? band.top : rect.top,
      headerBottom,
      chromeBottom,
    };
  }
  return null;
}

function placePanelErrorBanner(banner) {
  const slot = panelErrorSlot(errorToastPanelBox());
  if (!slot?.inside) {
    resetKeyBannerShift(banner);
    return;
  }
  banner.dataset.parked = "panel";
  banner.style.top = `${Math.round(slot.y)}px`;
  banner.style.left = `${Math.round(slot.x)}px`;
  banner.style.width = `${Math.round(slot.w)}px`;
  banner.style.maxWidth = `${Math.round(slot.w)}px`;
  banner.style.transform = "none";
}

function hideKeyPrompt() {
  const banner = $("#conn-banner");
  if (banner?.dataset.sticky === "keys") setBanner("");
  resetKeyBannerShift(banner);
}

function openPanelBox(node) {
  if (!node || node.hidden || node.closest("[hidden]")) return null;
  if (node.classList.contains("is-plan-parked")) return null;
  const rect = node.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) return null;
  const header = node.querySelector(".panel-header, .settings-head, .plan-head");
  let head = null;
  if (header && !header.hidden && !header.closest("[hidden]")) {
    const band = header.getBoundingClientRect();
    if (band.width >= 1 && band.height >= 1) {
      head = { x: band.x, y: band.y, w: band.width, h: band.height };
    }
  }
  return { x: rect.x, y: rect.y, w: rect.width, h: rect.height, header: head };
}

function placeKeyBanner() {
  const banner = $("#conn-banner");
  if (!banner) return;
  const sticky = banner.dataset.sticky || "";
  if (!banner.hidden && !bannerSticky(banner) && !(banner.textContent || "").trim() && !banner.querySelector(".banner-action")) {
    banner.hidden = true;
  }
  if (banner.hidden || sticky === "keyring") {
    resetKeyBannerShift(banner);
    return;
  }
  if (sticky !== "keys" && sticky !== "gateway") {
    placePanelErrorBanner(banner);
    return;
  }
  resetKeyBannerShift(banner);
  const box = banner.getBoundingClientRect();
  const panels = [];
  document.querySelectorAll(
    ".morph[data-state='panel']:not(.is-collapsing) .center-panel, .plan-hit-host, .morph[data-state='panel']:not(.is-collapsing) .plan-window",
  ).forEach((node) => {
    const panel = openPanelBox(node);
    if (panel) panels.push(panel);
  });
  const home = { x: box.x, y: box.y, w: box.width, h: box.height };
  const orbs = [];
  document.querySelectorAll(".morph[data-state='orb'] .morph-orb").forEach((node) => {
    const disc = node.getBoundingClientRect();
    if (disc.width >= 1 && disc.height >= 1) {
      orbs.push({ x: disc.x, y: disc.y, w: disc.width, h: disc.height });
    }
  });
  const slot = keyBannerSlot(home, panels, { w: window.innerWidth, h: window.innerHeight }, 12, orbs);
  if (Math.abs(slot.y - home.y) > 0.5) banner.style.top = `${Math.round(slot.y)}px`;
  if (Math.abs(slot.x - home.x) > 0.5) {
    banner.style.left = `${Math.round(slot.x)}px`;
    banner.style.transform = "none";
  }
}

function reconcileKeyPrompt(bots) {
  const pending = state.keyPromptBots || [];
  if (!pending.length) return;
  const rows = new Map((bots || []).filter((bot) => bot?.profile).map((bot) => [bot.profile, bot]));
  const next = [];
  for (const bot of pending) {
    const row = rows.get(bot.profile);
    if (!row || row.has_key || row.enabled === false) continue;
    next.push({ ...bot, display_name: row.display_name || bot.display_name });
  }
  state.keyPromptBots = next;
  if (!next.length) {
    hideKeyPrompt();
    scheduleHitSync("keys");
    return;
  }
  showKeyPrompt();
}

async function claimProfiles(ids, fn) {
  const keys = ids.length ? ids : ["cron"];
  if (keys.some((id) => probeGate.has(id))) return "busy";
  for (const id of keys) probeGate.tryBegin(id);
  try {
    return await fn();
  } finally {
    for (const id of keys) probeGate.end(id);
  }
}

function announceNewKeys(before, synced) {
  const added = profilesNeedingKeys(before, synced?.bots || []);
  if (!added.length || synced?.keyring_error) return;
  const seen = new Set((state.keyPromptBots || []).map((bot) => bot.profile));
  const next = [...(state.keyPromptBots || [])];
  for (const bot of added) {
    if (seen.has(bot.profile)) continue;
    next.push(bot);
    seen.add(bot.profile);
  }
  state.keyPromptBots = next;
  showKeyPrompt();
}

/** One read of each consumer. Never calls create_session or create_bot_chat. */
async function recoverGateway() {
  if (state.mode !== "hermes" || !inTauri()) return true;
  const { invoke } = await import("@tauri-apps/api/core");
  if (!probeGate.tryBegin("kanban")) return "busy";
  let board;
  try {
    board = await readKanbanPayload(invoke);
  } catch (err) {
    const message = String(err);
    board = message.includes(KANBAN_LOGIN)
      ? { needs_login: true, message: KANBAN_LOGIN }
      : {
          unavailable: true,
          message: gatewayDown(message)
            ? "連唔到 Kanban。"
            : (kanbanUnavailable(message) ? KANBAN_UNAVAILABLE : message),
        };
  } finally {
    probeGate.end("kanban");
  }
  commitKanban(normalizeBoard(board));
  const roster = await claimProfiles(["roster"], async () => {
    const before = state.settings?.bots || [];
    try {
      const synced = await invoke("sync_profiles");
      applyRoster(synced);
      announceNewKeys(before, synced);
      return true;
    } catch (err) {
      return gatewayDown(String(err)) ? false : true;
    }
  });
  if (roster === false || roster === "busy") return roster;
  const ids = state.bots.map((bot) => bot.id);
  const cron = await claimProfiles(ids, async () => {
    try {
      const rows = await invoke("list_cron_jobs");
      const next = (rows || []).map((row) => normalizeCronGroup(row));
      if (next.length && next.every((group) => group.unavailable && gatewayDown(group.message))) return false;
      state.cronSig = JSON.stringify(next);
      state.cronGroups = next;
      renderCronOrb();
      if (state.cronOpen) paintCron();
      return true;
    } catch (err) {
      return gatewayDown(String(err)) ? false : true;
    }
  });
  if (cron === false || cron === "busy") return cron;
  for (const bot of state.bots) {
    if (bot.hasKey === false) continue;
    const step = await claimProfiles([bot.id], () => refreshBotQuiet(bot.id));
    if (step === false || step === "busy") return step;
  }
  return true;
}

function applyRoster(synced) {
  const next = botsFromSettings(synced);
  state.settings = synced;
  const prev = state.bots.map((bot) => bot.id).join("\n");
  const ids = next.map((bot) => bot.id).join("\n");
  if (prev === ids) {
    state.bots = next.map((bot) => {
      const old = state.bots.find((item) => item.id === bot.id);
      return old ? { ...old, name: bot.name, short: bot.short, color: bot.color, detail: bot.detail, hasKey: bot.hasKey } : bot;
    });
  } else {
    state.bots = next;
  }
  renderBots();
}

function stopRosterSync() {
  window.clearTimeout(state.rosterTimer);
  state.rosterTimer = 0;
}

function armRosterSync() {
  stopRosterSync();
  const wait = rosterSyncDelayMs(Math.random);
  state.rosterTimer = window.setTimeout(() => {
    state.rosterTimer = 0;
    void tickRoster().finally(() => {
      if (state.mode === "hermes") armRosterSync();
    });
  }, wait);
}

async function tickRoster() {
  if (state.mode !== "hermes" || !inTauri()) return;
  const otherBusy = state.bots.some((bot) => probeGate.has(bot.id));
  if (!rosterTickAllowed({
    gatewayDown: gateway.isDown("gateway"),
    rosterBusy: probeGate.has("roster"),
    kanbanBusy: probeGate.has("kanban"),
    otherBusy,
  })) return;
  let failedDown = false;
  await claimProfiles(["roster"], async () => {
    const before = state.settings?.bots || [];
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const synced = await invoke("sync_profiles", { quiet: true });
      applyRoster(synced);
      announceNewKeys(before, synced);
    } catch (err) {
      if (gatewayDown(String(err))) failedDown = true;
    }
  });
  if (failedDown) noteGatewayDown();
}

async function refreshBotQuiet(id) {
  const token = state.reconnectToken;
  const thread = threadFor(id);
  if (thread.historyPromise) {
    try {
      await thread.historyPromise;
      return true;
    } catch (err) {
      return gatewayDown(String(err)) ? false : true;
    }
  }
  const shell = shellFor(id);
  const panelOpen = shell?.dataset.state === "panel" && !shell.classList.contains("is-collapsing");
  try {
    if (panelOpen && thread.sessionExplicit && thread.sessionId) {
      await reloadOpenSession(id, token, { quiet: true });
    } else {
      await loadBotHistory(id, token, { quiet: true });
    }
    return true;
  } catch (err) {
    return gatewayDown(String(err)) ? false : true;
  }
}

function kickGateway() {
  if (state.mode !== "hermes" || !gateway.isDown("gateway")) return;
  gateway.kick("gateway");
}

function armHistoryAfterQuiet(id) {
  const tick = () => {
    const shell = shellFor(id);
    if (shell && visualQuiet(shell)) {
      window.setTimeout(tick, 40);
      return;
    }
    if (state.mode !== "hermes") return;
    const thread = threadFor(id);
    if (thread.loaded || thread.historyPromise) return;
    beginBotHistory(id)?.catch((err) => noteHistoryError(id, err));
  };
  window.setTimeout(tick, 40);
}

async function selectBot(id) {
  clearUnread(id);
  if (state.catalogProfile && state.catalogProfile !== id) {
    state.catalog = null;
    state.catalogProfile = "";
  }
  state.activeId = id;
  state.slashPanelId = id;
  const shell = shellFor(id);
  // Ctrl draws an open panel as an orb, so dataset.state is not enough.
  if (raisedPanelShell(id)) {
    if (!state.openIds.includes(id)) state.openIds = openPanel(state.openIds, id);
    raisePanel(shell);
    renderBots();
    applySendErrorBanner(id);
    return;
  }
  const thread = threadFor(id);
  const pending = thread.loaded ? null : (thread.historyPromise || null);
  const manual = thread.sessionExplicit;
  // The morph starts on this click. Another shell's pill, and this bot's
  // history round-trip, must not delay morph-start.
  renderBots();
  renderChat(id);
  openBotPanel(id);
  if (pending) {
    try {
      await pending;
    } catch (err) {
      noteHistoryError(id, err);
    }
    renderChat(id);
  }
  if (manual && state.mode === "hermes" && inTauri()) {
    try {
      await loadBotHistory(id, state.reconnectToken);
    } catch (err) {
      noteHistoryError(id, err);
    }
    renderChat(id);
  }
  if (thread.loaded) return;
  const host = shellFor(id);
  if (host) host.dataset.seamWait = "1";
  armHistoryAfterQuiet(id);
}

function openBotPanel(id) {
  const bot = state.bots.find((item) => item.id === id);
  const shell = shellFor(id) || (bot ? ensureBotShell(bot) : null);
  if (!shell) return null;
  abortPlanRehearsal(shell);
  const thread = threadFor(id);
  thread.followTail = true;
  if (thread.loaded) void catchUpSession(id);
  state.openIds = openPanel(state.openIds, id);
  window.clearTimeout(shell._pillTimer);
  shell.dataset.intent = "open";
  raisePanel(shell);
  void runShellMorph(shell, "panel");
  // The card painted while closed is below the restored scroll, under the composer.
  if (thread.messages.some(approvalPending)) pinChat(id);
  if (thread.messages.some(clarifyPending) || thread.messages.some((message) => message.role === "clarify" && message.status === "timeout")) pinChat(id);
  applySendErrorBanner(id);
  void recoverRunControls(id);
  void loadSoul(id);
  scheduleHitSync();
  if (gateway.isDown("gateway")) gateway.kick("gateway");
  return shell.querySelector(".bot-panel");
}

function closeBotPanel(id) {
  const panel = panelFor(id);
  const shell = shellFor(id);
  if (shell) shell.dataset.intent = "close";
  state.openIds = closePanel(state.openIds, id);
  if (state.activeId === id) state.activeId = state.openIds.at(-1) || null;
  if (state.slashPanelId === id) state.slashPanelId = state.activeId || "";
  if (state.pointerHitId === `panel:${id}`) state.pointerHitId = "";
  if (panel) {
    const active = document.activeElement;
    if (active && panel.contains(active)) active.blur();
    if (composerField && panel.contains(composerField)) composerField = null;
  }
  if (shell) void finishClose(shell);
  else renderBots();
}

async function finishClose(shell) {
  try {
    const closed = await runShellMorph(shell, "orb");
    if (!closed || !shell.isConnected) return;
    syncLatch();
    scheduleHitSync();
  } finally {
    renderBots();
  }
}

function showBotTab(panel, tab) {
  const chat = role(panel, "view-chat");
  const sheet = role(panel, "view-bot");
  const showChat = tab !== "bot";
  if (chat) chat.hidden = !showChat;
  if (sheet) sheet.hidden = showChat;
  role(panel, "tab-chat")?.setAttribute("aria-selected", showChat ? "true" : "false");
  role(panel, "tab-bot")?.setAttribute("aria-selected", showChat ? "false" : "true");
}

function wireBotPanel(panel, id) {
  role(panel, "close")?.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    holdMotion(event.currentTarget);
    closeBotPanel(id);
  });
  role(panel, "tab-chat")?.addEventListener("click", () => showBotTab(panel, "chat"));
  role(panel, "tab-bot")?.addEventListener("click", () => showBotTab(panel, "bot"));
  panel.addEventListener("wheel", (event) => {
    const sheet = role(panel, "view-bot");
    if (sheet && !sheet.hidden) return;
    const chat = role(panel, "chat");
    if (!chat || event.target.closest?.(".chat-messages, .plan-preview, textarea, select")) return;
    armUserScroll(chat);
    assignChatScroll(chat, chat.scrollTop + event.deltaY);
    noteChatScroll(id, chat, true);
  }, { passive: true });
  const chatBox = role(panel, "chat");
  chatBox?.addEventListener("pointerdown", () => {
    chatBox.dataset.userScroll = "1";
  });
  const endUserScroll = () => armUserScroll(chatBox);
  chatBox?.addEventListener("pointerup", endUserScroll);
  chatBox?.addEventListener("pointercancel", endUserScroll);
  chatBox?.addEventListener("wheel", () => armUserScroll(chatBox), { passive: true });
  chatBox?.addEventListener("touchstart", () => armUserScroll(chatBox), { passive: true });
  chatBox?.addEventListener("keydown", () => armUserScroll(chatBox));
  chatBox?.addEventListener("scroll", (event) => {
    const chat = event.currentTarget;
    if (chat.dataset.programmaticScroll === "1") return;
    noteChatScroll(id, chat, chat.dataset.userScroll === "1");
  });
  role(panel, "send")?.addEventListener("click", () => sendActive(id));
  role(panel, "continue")?.addEventListener("click", () => continueApiSession(id));
  role(panel, "stop")?.addEventListener("click", () => stopActive(id));
  role(panel, "save")?.addEventListener("click", () => saveBotPanel(id));
  const sessionSelect = role(panel, "session");
  sessionSelect?.addEventListener("pointerdown", () => {
    state.dropdownOpen = nextDropdownOpen(state.dropdownOpen, "pointerdown");
  });
  sessionSelect?.addEventListener("keydown", (event) => {
    if (selectKeyOpensDropdown(event.key)) {
      state.dropdownOpen = nextDropdownOpen(state.dropdownOpen, "open-key");
    }
    if (event.key === "Escape" && state.dropdownOpen) {
      state.dropdownOpen = nextDropdownOpen(state.dropdownOpen, "escape");
      event.stopPropagation();
    }
  });
  sessionSelect?.addEventListener("change", () => {
    state.dropdownOpen = nextDropdownOpen(state.dropdownOpen, "change");
    void pickSession(id, sessionSelect.value);
  });
  sessionSelect?.addEventListener("blur", () => {
    const action = selectBlurAction({
      dropdownOpen: state.dropdownOpen,
      documentFocused: document.hasFocus(),
    });
    if (action === "close") state.dropdownOpen = nextDropdownOpen(state.dropdownOpen, "blur");
  });
  role(panel, "chat")?.addEventListener("click", (event) => {
    const anchor = event.target.closest?.("a");
    const chat = role(panel, "chat");
    if (!anchor || !chat?.contains(anchor)) return;
    event.preventDefault();
    const href = anchor.getAttribute("href") || "";
    if (!isSafeLink(href)) return;
    openExternal(href);
  });
  for (const field of ["display-name", "detail", "soul"]) {
    role(panel, field)?.addEventListener("input", (event) => {
      event.target.dataset.dirty = "1";
    });
  }
  const input = role(panel, "input");
  input?.addEventListener("focus", () => {
    state.activeId = id;
    state.slashPanelId = id;
    closeSlashExcept(id);
  });
  input?.addEventListener("input", () => {
    state.activeId = id;
    state.slashPanelId = id;
    state.slashIndex = 0;
    syncSlashGhost();
    refreshSlash();
  });
  input?.addEventListener("keyup", syncSlashGhost);
  input?.addEventListener("click", syncSlashGhost);
  input?.addEventListener("keydown", (event) => {
    state.activeId = id;
    state.slashPanelId = id;
    if (slashPopupOpen()) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const items = activeSlashItems();
        state.slashIndex = moveSlashIndex(items, state.slashIndex, event.key);
        renderSlashPopup();
        return;
      }
      if (event.key === "Tab" || event.key === "Enter") {
        const items = activeSlashItems();
        const picked = items[state.slashIndex];
        if (picked && picked.enabled !== false) {
          event.preventDefault();
          const submit = event.key === "Enter" && slashEnterSubmits(picked);
          completeSlash(picked);
          if (submit) sendActive(id);
          return;
        }
      }
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeSlash();
        return;
      }
    }
    if (event.key === "Enter" && composerKeyAction({
      key: "Enter",
      ctrlKey: event.ctrlKey,
      altKey: event.altKey,
      metaKey: event.metaKey,
      activeIsComposer: true,
      composerConnected: true,
      osModifierDown: state.osModifierDown,
    }) === "send") sendActive(id);
  });
}

async function loadSoul(id) {
  const panel = panelFor(id);
  const field = role(panel, "soul");
  if (!field || field.dataset.dirty === "1") return;
  if (!inTauri()) {
    field.value = state.souls.get(id) || "";
    return;
  }
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const text = await invoke("read_soul", { profile: id });
    const write = (tries) => {
      const shell = shellFor(id);
      if (deferShellWork(shell) && tries < 90) {
        requestAnimationFrame(() => write(tries + 1));
        return;
      }
      const current = role(panelFor(id), "soul");
      if (!current || current.dataset.dirty === "1") return;
      current.value = text || "";
    };
    write(0);
  } catch (err) {
    const status = role(panelFor(id), "save-status");
    if (status) status.textContent = String(err);
  }
}

async function saveBotPanel(id) {
  const panel = panelFor(id);
  if (!panel) return;
  const name = role(panel, "display-name")?.value.trim() || "";
  const detail = role(panel, "detail")?.value.trim() || "";
  const soul = role(panel, "soul")?.value ?? "";
  const status = role(panel, "save-status");
  const bot = state.bots.find((item) => item.id === id);
  if (bot) {
    if (name) bot.name = name;
    bot.detail = detail;
    bot.short = shortLabel(bot.name);
  }
  state.souls.set(id, soul);
  role(panel, "display-name").dataset.dirty = "";
  role(panel, "detail").dataset.dirty = "";
  role(panel, "soul").dataset.dirty = "";
  renderBots();
  renderChat(id);
  if (!inTauri()) {
    if (status) status.textContent = "示範模式：已記喺呢個視窗。";
    return;
  }
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("write_soul", { profile: id, text: soul });
    if (state.mode === "hermes") {
      const saved = await invoke("save_bot_meta", {
        input: { profile: id, display_name: name, detail },
      });
      const row = state.settings?.bots?.find((item) => item.profile === id);
      if (row && saved) {
        row.display_name = saved.display_name;
        row.detail = saved.detail;
      }
    }
    if (status) status.textContent = "已儲存呢個 Bot。";
  } catch (err) {
    if (status) status.textContent = String(err);
  }
}

function presentMessage(m) {
  if (m.role === "tool") {
    const name = m.tool_name || m.toolName || "tool";
    return { role: "tool", text: `工具 ${name}：${m.text}` };
  }
  if (m.role === "user") {
    const marker = parseSlashMarker(m.text);
    if (marker) {
      return {
        role: "user",
        text: marker.display,
        command: marker.command,
        full: marker.rest,
        expanded: false,
      };
    }
  }
  return { role: m.role, text: m.text };
}

function ensureLiveBubble(id) {
  const messages = runMessages(id);
  const turn = continueLiveTurn(messages);
  const live = turn.message;
  if (turn.created) {
    if (!runIsOnScreen(id)) return live;
    const shell = shellFor(id);
    if (shell && (deferShellWork(shell) || presentationBusy())) {
      shell.dataset.chatDirty = "1";
      if (presentationBusy()) armPresentationFlush();
      return live;
    }
    const chat = chatOf(id);
    if (chat) {
      const el = bubbleEl(live);
      el.dataset.live = "1";
      chat.appendChild(el);
    }
  }
  return live;
}

function paintLiveNow(id) {
  const shell = shellFor(id);
  if (shell && (deferShellWork(shell) || presentationBusy())) {
    shell.dataset.chatDirty = "1";
    if (presentationBusy()) armPresentationFlush();
    return;
  }
  const chat = chatOf(id);
  if (!chat) return;
  const thread = threadFor(id);
  const live = [...thread.messages].reverse().find((m) => m.live);
  const nodes = chat.querySelectorAll("[data-live]");
  const node = nodes[nodes.length - 1];
  if (live && node) paintBotBubble(node, live.text);
  if (thread.followTail !== false) pinChat(id);
}

function patchLive(id) {
  if (!panelFor(id)) return;
  painterFor(id).schedule();
}

function shellBlocksPreview(shell) {
  if (!shell) return false;
  return previewBlocked({
    intent: shell.dataset.intent || "",
    collapsing: shell.classList.contains("is-collapsing"),
    opening: shell.dataset.opening || "",
    visual: shell.dataset.visual || "",
    state: shell.dataset.state || "",
  });
}

function deliverCron(id, payload) {
  const sessionId = String(payload?.session_id || "").trim();
  const incoming = (payload?.messages || []).map(presentMessage);
  if (!id || !sessionId || !incoming.length) return;
  const thread = threadFor(id);
  const viewing = thread.sessionId === sessionId;
  const existing = viewing ? thread.messages : thread.bySession.get(sessionId) || [];
  const { fresh, settled } = unseenMessages(existing, incoming);
  if (settled && viewing) {
    const last = [...thread.messages].reverse().find((message) => message.live && message.role === "bot");
    if (last) {
      last.text = settled.text;
      last.live = false;
      if (panelFor(id)) renderChat(id);
    }
  }
  if (!fresh.length) return;
  if (viewing) {
    for (const message of fresh) appendMessage(id, message);
  } else {
    const stored = thread.bySession.get(sessionId) || [];
    thread.bySession.set(sessionId, stored.concat(fresh.map((message) => ({ ...message }))));
  }
  if (shellBlocksPreview(shellFor(id))) return;
  const text = previewLine(fresh);
  if (!text) return;
  thread.unread = true;
  paintActivity(id);
  pingOrb(id);
  showToast(id, { kind: "message", text });
}

function bannerSticky(banner) {
  const held = banner?.dataset.sticky || "";
  return held === "keyring" || held === "gateway" || held === "keys";
}

function panelShowing(id) {
  const panels = [];
  document.querySelectorAll(".morph[data-kind='bot']").forEach((shell) => {
    panels.push({
      id: shell.dataset.botId || "",
      open: shell.dataset.state === "panel" || shell.dataset.visual === "panel",
      collapsing: shell.classList.contains("is-collapsing"),
      z: Number.parseInt(shell.style.zIndex, 10),
    });
  });
  return !!id && bannerOwner(state.activeId, panels) === id;
}

/** An open bot panel, including one Ctrl is currently drawing as an orb. */
function raisedPanelShell(id) {
  if (!id || id === "settings" || id === "kanban" || id === "cron") return null;
  const shell = shellFor(id);
  if (!shell || shell.classList.contains("is-collapsing")) return null;
  if (shell.dataset.intent === "close") return null;
  const open = state.openIds.includes(id)
    || shell.dataset.state === "panel"
    || shell.dataset.visual === "panel"
    || shell.dataset.opening === "panel";
  return open ? shell : null;
}

/** Bring an already-open bot panel to the front and point the error banner at it. */
function focusOpenPanel(id) {
  const shell = raisedPanelShell(id);
  if (!shell) return;
  state.activeId = id;
  state.slashPanelId = id;
  raisePanel(shell);
  applySendErrorBanner(id);
}

/** Keep the in-flight typed line in the thread so a racing re-render can paint it. */
function retainOutgoing(id) {
  const thread = threadFor(id);
  if (!thread) return;
  const line = pendingSend(state.pendingSends, id, thread.sessionId);
  if (!line) return;
  const next = mergePendingSend(thread.messages, line);
  if (next !== thread.messages) thread.messages = next;
}

function holdOutgoing(id, text) {
  const thread = threadFor(id);
  rememberPendingSend(state.pendingSends, id, thread?.sessionId || "", text);
}

function releaseOutgoing(id) {
  const thread = threadFor(id);
  rememberPendingSend(state.pendingSends, id, thread?.sessionId || "", "");
}

/** Put this session's send error back on the banner. A blank banner hides. */
function restoreSendErrorBanner(id) {
  const banner = $("#conn-banner");
  if (!banner || bannerSticky(banner)) return;
  const text = sendErrorDraft(state.sendErrors, id, threadFor(id).sessionId);
  if (text) {
    if (banner.hidden || banner.textContent !== text) setBanner(text, "error");
    return;
  }
  if (!banner.hidden && !(banner.textContent || "").trim()) setBanner("");
}

/** This open panel owns the banner: show its send error, or clear one that is not sticky. */
function applySendErrorBanner(id) {
  const banner = $("#conn-banner");
  if (!banner || bannerSticky(banner)) return;
  const text = sendErrorDraft(state.sendErrors, id, threadFor(id).sessionId);
  if (text) {
    if (banner.hidden || banner.textContent !== text) setBanner(text, "error");
    return;
  }
  clearConnectionBanner();
}

/** The user line gained 未送出 after it was painted. Rewrite that bubble. */
function repaintUnsent(id) {
  const thread = threadFor(id);
  const chat = chatOf(id);
  if (!thread || !chat) return;
  thread.messages.forEach((message, index) => {
    if (message?.role !== "user") return;
    const node = chat.children[index];
    if (!node) return;
    const marked = !!node.querySelector(".unsent-mark");
    if (marked === !!message.unsent) return;
    node.replaceChildren();
    paintUserBubble(node, message);
  });
}

function noteSendFailed(id, raw) {
  const thread = threadFor(id);
  retainOutgoing(id);
  const text = String(raw || "連線錯誤");
  rememberUnsent(state.unsentDrafts, id, thread.sessionId, markUnsentDraft(thread.messages));
  rememberSendError(state.sendErrors, id, thread.sessionId, text);
  releaseOutgoing(id);
  // appendMessage stamps the chat, including 未送出, without repainting this line.
  repaintUnsent(id);
  thread.queued = false;
  thread.watchReply = false;
  clearRunSession(thread);
  const messages = runMessages(id);
  const have = messages.some((item) => item.text === text && (item.role === "commentary" || item.role === "failure"));
  if (!have) appendOnce(id, { role: "commentary", text });
  noteActivity(id, { type: "failed", text });
  setBotStatus(id, "連線錯誤", "error");
  setBanner(text, "error");
}

function noteReadOnly(id) {
  const thread = threadFor(id);
  retainOutgoing(id);
  rememberDenied(state.deniedSessions, id, thread.sessionId);
  rememberUnsent(state.unsentDrafts, id, thread.sessionId, markUnsentDraft(thread.messages));
  releaseOutgoing(id);
  thread.sessionReadOnly = true;
  thread.sessionReadOnlyReason = SESSION_READ_ONLY_REASON;
  thread.queued = false;
  thread.watchReply = false;
  clearRunSession(thread);
  setBotStatus(id, "只可以睇", "idle");
}

function lockIfPermissionDenied(id, raw) {
  const text = permissionDeniedMessage(raw);
  if (!isPermissionDeniedText(raw)) return text;
  noteReadOnly(id);
  return SESSION_READ_ONLY_REASON;
}

function panelIsOpen(id) {
  const shell = shellFor(id);
  if (shell?.classList.contains("is-collapsing")) return false;
  if (state.openIds.includes(id)) return true;
  return shell?.dataset.state === "panel";
}

function releaseApprovalWait(id) {
  const thread = threadFor(id);
  if (thread.messages.some(approvalPending) || parkedApproval(thread)) return;
  if (!state.busy.has(id) || thread.status !== APPROVAL_WAIT_LABEL) return;
  setBotStatus(id, "思考中…", "busy");
}

function armClarifyClock() {
  if (state.clarifyTimer) return;
  state.clarifyTimer = window.setInterval(() => {
    let live = false;
    for (const bot of state.bots) {
      const thread = threadFor(bot.id);
      let changed = false;
      for (const message of thread.messages) {
        if (message.role !== "clarify" || message.status !== "pending") continue;
        live = true;
        const before = `${message.status}:${message.remain}`;
        clarifyTick(message, Date.now());
        if (`${message.status}:${message.remain}` !== before) changed = true;
      }
      if (!changed) continue;
      const chat = chatOf(bot.id);
      thread.messages.forEach((message, index) => {
        if (message.role !== "clarify" || !chat?.children[index]) return;
        if (message.status === "timeout") paintClarifyBubble(chat.children[index], message, bot.id);
        else {
          const clock = chat.children[index].querySelector(".clarify-countdown");
          if (clock && Number.isInteger(message.remain)) clock.textContent = `仲有 ${message.remain} 秒`;
        }
      });
      if (thread.messages.some((message) => message.role === "clarify" && message.status === "timeout")) {
        releaseClarifyWait(bot.id);
      }
    }
    if (!live) {
      window.clearInterval(state.clarifyTimer);
      state.clarifyTimer = 0;
    }
  }, 1000);
}

function releaseClarifyWait(id) {
  const thread = threadFor(id);
  if (thread.messages.some(clarifyPending) || parkedClarify(thread)) return;
  if (thread.messages.some(approvalPending) || parkedApproval(thread)) return;
  if (!state.busy.has(id) || thread.status !== CLARIFY_WAIT_LABEL) return;
  setBotStatus(id, "思考中…", "busy");
}

function paintApprovalBadge(id) {
  const thread = threadFor(id);
  const waiting = thread.messages.some(approvalPending)
    || parkedApproval(thread)
    || thread.messages.some(clarifyPending)
    || parkedClarify(thread);
  const show = showApprovalBadge(panelIsOpen(id), waiting);
  const btn = document.querySelector(`.bot-btn[data-bot-id="${cssEscape(id)}"]`);
  btn?.classList.toggle("has-approval", show);
}

function closeOtherClarifies(messages, promptId) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message.role === "clarify" && message.promptId !== promptId && (clarifyPending(message) || message.status === "timeout")) {
      messages.splice(i, 1);
    }
  }
}

async function answerApproval(id, message, choice) {
  if (!message || message.status !== "pending") return;
  const posted = approvalPost(id, message.runId, message.requestId, choice, message.executionGeneration);
  if (!posted) return;
  message.status = "sending";
  if (panelFor(id)) renderChat(id);
  paintApprovalBadge(id);
  if (state.mode !== "hermes" || !inTauri()) {
    message.status = choice === "deny" ? "denied" : "approved";
    releaseApprovalWait(id);
    if (panelFor(id)) renderChat(id);
    paintApprovalBadge(id);
    return;
  }
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("respond_approval", {
      profile: posted.profile,
      runId: posted.runId,
      requestId: posted.requestId,
      choice: posted.choice,
      ...(Number.isInteger(posted.executionGeneration) ? { executionGeneration: posted.executionGeneration } : {}),
    });
    if (message.status === "sending") message.status = choice === "deny" ? "denied" : "approved";
  } catch (err) {
    if (message.status !== "approved" && message.status !== "denied") {
      const failed = approvalFailure(String(err));
      message.status = failed.status;
      message.notice = failed.notice;
    }
  }
  releaseApprovalWait(id);
  if (panelFor(id)) renderChat(id);
  paintApprovalBadge(id);
}

async function answerClarify(id, message, answer) {
  if (!message || message.status !== "pending") return;
  const posted = clarifyPost(id, message.runId, message.promptId, message.executionGeneration, answer);
  if (!posted) {
    message.status = "error";
    message.notice = CLARIFY_SEND_FAIL;
    if (panelFor(id)) renderChat(id);
    return;
  }
  message.postedAnswer = posted.body.answer;
  message.status = "sending";
  if (panelFor(id)) renderChat(id);
  paintApprovalBadge(id);
  if (state.mode !== "hermes" || !inTauri()) {
    message.status = posted.body.answer === "" ? "skipped" : "answered";
    releaseClarifyWait(id);
    if (panelFor(id)) renderChat(id);
    paintApprovalBadge(id);
    return;
  }
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const result = await invoke("respond_clarify", {
      profile: posted.profile,
      runId: posted.runId,
      requestId: posted.promptId,
      executionGeneration: posted.executionGeneration,
      answer: posted.body.answer,
    });
    if (message.status !== "sending" && message.status !== "pending") return;
    message.status = result?.status === "stale" ? "stale" : posted.body.answer === "" ? "skipped" : "answered";
  } catch (err) {
    if (message.status === "sending") {
      const failed = clarifyFailure(String(err));
      message.status = failed.status;
      message.notice = failed.notice;
    }
  }
  releaseClarifyWait(id);
  if (panelFor(id)) renderChat(id);
  paintApprovalBadge(id);
}

async function recoverRunControls(id) {
  const thread = threadFor(id);
  if (state.mode !== "hermes" || !inTauri() || !thread.runId) return;
  const waiting = state.busy.has(id) || thread.messages.some(approvalPending) || thread.messages.some(clarifyPending);
  if (!waiting) return;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const snapshot = await invoke("load_run_controls", { profile: id, runId: thread.runId });
    const status = String(snapshot?.status || "");
    const dropMissing = status === "started" || status === "running" || status === "waiting_for_approval";
    const messages = runMessages(id);
    const merged = mergePendingControls(messages, snapshot?.pending_controls, thread.runId, {
      dropMissing,
      now: Date.now(),
    });
    if (messages === thread.messages) thread.messages = merged;
    else if (thread.liveSessionId && thread.bySession?.get(thread.liveSessionId) === messages) {
      thread.bySession.set(thread.liveSessionId, merged);
    }
    if (merged.some(clarifyPending)) armClarifyClock();
    if (merged.some(approvalPending) || parkedApproval(thread)) {
      setBotStatus(id, APPROVAL_WAIT_LABEL, "busy");
    } else if (merged.some(clarifyPending) || parkedClarify(thread)) {
      setBotStatus(id, CLARIFY_WAIT_LABEL, "busy");
    }
    if (panelFor(id)) renderChat(id);
    if (merged.some(approvalPending) || merged.some(clarifyPending)) pinChat(id);
    paintApprovalBadge(id);
  } catch {
    /* the live stream still paints the cards */
  }
}

function handleHermes(payload) {
  if (!payload || !payload.profile) return;
  const id = payload.profile;
  if (payload.type === "cron") {
    deliverCron(id, payload);
    return;
  }
  if (payload.type === "run.started") {
    const thread = threadFor(id);
    noteRunStarted(thread, payload.run_id || "");
    if (!thread.liveSessionId) noteRunSession(thread);
    thread.stopNoted = false;
    setBotStatus(id, "思考中…", "busy");
    noteActivity(id, { type: "run.started" });
    return;
  }
  if (payload.type === "approval.request") {
    const thread = threadFor(id);
    const requestId = String(payload.request_id || "");
    const messages = runMessages(id);
    const existing = messages.find((message) => message.role === "approval" && message.requestId === requestId);
    const card = {
      role: "approval",
      runId: payload.run_id || thread.runId || "",
      requestId,
      description: payload.description || "",
      command: payload.command || "",
      ...(Number.isInteger(payload.execution_generation) ? { executionGeneration: payload.execution_generation } : {}),
      status: "pending",
    };
    if (!existing) {
      if (runIsOnScreen(id)) appendMessage(id, card);
      else messages.push(card);
    }
    setBotStatus(id, APPROVAL_WAIT_LABEL, "busy");
    if (runIsOnScreen(id) && panelFor(id)) renderChat(id);
    paintApprovalBadge(id);
    return;
  }
  if (payload.type === "approval.responded") {
    const card = runMessages(id).find((message) => message.role === "approval" && message.requestId === payload.request_id);
    const next = statusAfterResponded(payload.choice);
    if (card && next && card.status !== "stale") card.status = next;
    releaseApprovalWait(id);
    if (panelFor(id)) renderChat(id);
    paintApprovalBadge(id);
    return;
  }
  if (payload.type === "clarify.request") {
    const thread = threadFor(id);
    const promptId = String(payload.prompt_id || "");
    const messages = runMessages(id);
    closeOtherClarifies(messages, promptId);
    const existing = messages.find((message) => message.role === "clarify" && message.promptId === promptId);
    if (!existing) {
      const timeoutS = Number.isInteger(payload.timeout_s) ? payload.timeout_s : undefined;
      const card = {
        role: "clarify",
        runId: payload.run_id || thread.runId || "",
        promptId,
        question: payload.question || "",
        choices: Array.isArray(payload.choices) ? payload.choices.map((choice) => String(choice)) : [],
        multiSelect: !!payload.multi_select,
        executionGeneration: Number.isInteger(payload.execution_generation) ? payload.execution_generation : undefined,
        timeoutS,
        askedAt: Date.now(),
        remain: timeoutS == null ? CLARIFY_TIMEOUT_S : timeoutS > 0 ? timeoutS : null,
        status: "pending",
        draft: "",
        selected: [],
      };
      if (runIsOnScreen(id)) appendMessage(id, card);
      else messages.push(card);
    }
    const waitingApproval = thread.messages.some(approvalPending) || parkedApproval(thread);
    setBotStatus(id, waitingApproval ? APPROVAL_WAIT_LABEL : CLARIFY_WAIT_LABEL, "busy");
    armClarifyClock();
    if (runIsOnScreen(id) && panelFor(id)) renderChat(id);
    paintApprovalBadge(id);
    return;
  }
  if (payload.type === "clarify.settled" || payload.type === "approval.settled") {
    const promptId = String(payload.prompt_id || "");
    if (payload.type === "approval.settled") {
      const card = runMessages(id).find((message) => message.role === "approval" && message.requestId === promptId);
      if (card && (card.status === "pending" || card.status === "sending")) card.status = "approved";
      releaseApprovalWait(id);
    } else {
      const card = runMessages(id).find((message) => message.role === "clarify" && message.promptId === promptId);
      if (card && card.status !== "stale" && card.status !== "timeout") {
        if (card.status === "pending" || card.status === "sending") {
          card.status = card.postedAnswer === "" ? "skipped" : "answered";
        }
      }
      releaseClarifyWait(id);
    }
    if (panelFor(id)) renderChat(id);
    paintApprovalBadge(id);
    return;
  }
  if (payload.type === "delta") {
    noteActivity(id, { type: "delta" });
    const live = ensureLiveBubble(id);
    live.text += plainToolText(payload.text || "");
    if (textIsExecuteCodeBlocked(live.text)) live.text = EXECUTE_CODE_BLOCKED_LINE;
    if (settleBlockedCopies(id)) {
      if (runIsOnScreen(id) && panelFor(id)) renderChat(id);
      return;
    }
    if (runIsOnScreen(id)) patchLive(id);
    return;
  }
  if (payload.type === "command") {
    const user = [...runMessages(id)].reverse().find((item) => item.role === "user");
    if (user && payload.command) {
      user.command = payload.command;
      if (runIsOnScreen(id) && panelFor(id)) renderChat(id);
    }
    return;
  }
  if (payload.type === "commentary") {
    const text = plainToolText(payload.text || "");
    appendOnce(id, { role: "commentary", text: text === EXECUTE_CODE_BLOCKED_LINE ? text : `過程：${text}` });
    if (runIsOnScreen(id) && panelFor(id)) renderChat(id);
    return;
  }
  if (payload.type === "tool") {
    const raw = `${payload.name || ""} ${payload.preview || ""}`;
    const blocked = textIsExecuteCodeBlocked(raw) || payload.preview === EXECUTE_CODE_BLOCKED_LINE;
    const preview = payload.preview ? ` — ${plainToolText(payload.preview)}` : "";
    const text = blocked ? EXECUTE_CODE_BLOCKED_LINE : `${payload.name || "tool"}${preview}`;
    if (payload.phase === "progress") {
      noteActivity(id, { type: "tool.progress", name: payload.name || "", text });
      return;
    }
    noteActivity(id, { type: "tool" });
    const phase = payload.phase === "completed" ? "完成" : payload.phase === "failed" ? "失敗" : "開始";
    appendOnce(id, { role: "tool", text: blocked ? EXECUTE_CODE_BLOCKED_LINE : `${phase} ${text}` });
    if (runIsOnScreen(id) && panelFor(id)) renderChat(id);
    return;
  }
  if (payload.type === "status") {
    const thread = threadFor(id);
    if (payload.run_id && !finishApplies(thread, payload.run_id) && payload.state !== "busy") return;
    const pending = thread.messages.some(approvalPending) || parkedApproval(thread);
    const asking = thread.messages.some(clarifyPending) || parkedClarify(thread);
    const errored = payload.state === "error";
    let label = payload.detail || (payload.state === "busy" ? "思考中…" : "閒置");
    let statusState = payload.state === "busy" ? "busy" : errored ? "error" : "idle";
    if (pending && !errored) {
      label = APPROVAL_WAIT_LABEL;
      statusState = "busy";
    } else if (asking && !errored) {
      label = CLARIFY_WAIT_LABEL;
      statusState = "busy";
    }
    setBotStatus(id, label, statusState);
    return;
  }
  if (payload.type === "done") {
    const thread = threadFor(id);
    if (payload.run_id && !finishApplies(thread, payload.run_id)) return;
    const live = [...runMessages(id)].reverse().find((m) => m.live);
    painterFor(id).flush();
    if (live) {
      live.live = false;
      if (textIsExecuteCodeBlocked(live.text)) live.text = EXECUTE_CODE_BLOCKED_LINE;
    }
    settleBlockedCopies(id);
    if (payload.keep_busy) {
      if (payload.outcome === "cancelled") noteStopped(id, { keepBusy: true });
      else if (runIsOnScreen(id) && panelFor(id)) renderChat(id);
      return;
    }
    if (!payload.run_id || payload.run_id === thread.runId) thread.runId = "";
    if (runIsOnScreen(id) && panelFor(id)) renderChat(id);
    const outcome = payload.outcome === "failed" ? "failed" : payload.outcome === "cancelled" ? "cancelled" : "completed";
    const detail = payload.detail || "";
    const blocked = textIsExecuteCodeBlocked(detail) || detail === EXECUTE_CODE_BLOCKED_LINE;
    if (payload.outcome === "failed" && isPermissionDeniedText(detail)) {
      lockIfPermissionDenied(id, detail);
      return;
    }
    noteActivity(id, { type: outcome, text: outcome === "completed" ? live?.text || "" : plainToolText(detail) });
    if (payload.outcome === "completed") clearConnectionBanner();
    const failedText = payload.outcome === "failed" ? plainToolText(detail) : "";
    if (payload.outcome === "failed" && failedText) {
      appendOnce(id, { role: "failure", text: failedText });
    }
    if (payload.outcome === "cancelled") {
      noteStopped(id);
      if (!thread.queued) thread.watchReply = false;
      void catchUpSession(id);
      return;
    }
    clearRunSession(thread);
    if (payload.outcome === "completed") {
      thread.queued = false;
      thread.watchReply = false;
      if (!thread.sessionReadOnly) {
        rememberUnsent(state.unsentDrafts, id, thread.sessionId, "");
        rememberSendError(state.sendErrors, id, thread.sessionId, "");
        releaseOutgoing(id);
      }
    }
    setBotStatus(
      id,
      payload.outcome === "failed"
        ? (blocked || failedText === EXECUTE_CODE_BLOCKED_LINE ? EXECUTE_CODE_BLOCKED_LINE : "回覆失敗")
        : payload.outcome === "cancelled" ? "已停止" : "閒置",
      payload.outcome === "failed" ? "error" : "idle",
    );
    return;
  }
  if (payload.type === "error") {
    const raw = payload.message || "未知錯誤";
    if (isPermissionDeniedText(raw)) {
      lockIfPermissionDenied(id, raw);
      return;
    }
    noteSendFailed(id, raw);
  }
}

async function sendActive(id = state.activeId) {
  const panel = panelFor(id);
  const input = role(panel, "input");
  const text = input?.value.trim() || "";
  if (!text || !id) return;
  const thread = threadFor(id);
  if (thread.sessionReadOnly) {
    showActionError(thread.sessionReadOnlyReason || SESSION_READ_ONLY_REASON);
    return;
  }
  state.activeId = id;
  state.slashPanelId = id;
  thread.followTail = true;
  thread.stopNoted = false;
  const busy = state.mode === "hermes" && state.busy.has(id);
  const action = resolveClient(text, state.catalog || []);
  if (busy && action?.command !== "stop") {
    closeSlash();
    input.value = "";
    input.placeholder = "輸入訊息給呢個 Bot…";
    state.slashArgsHint = "";
    syncSlashGhost();
    await sendWhileBusy(id, text);
    return;
  }
  closeSlash();
  input.value = "";
  input.placeholder = "輸入訊息給呢個 Bot…";
  state.slashArgsHint = "";
  syncSlashGhost();
  if (action) {
    await sendClientCommand(id, text, action);
    return;
  }
  const task = planTask(text);
  appendMessage(id, task === null ? { role: "user", text } : { role: "user", text, command: "plan" });
  const sentId = id;
  noteActivity(sentId, { type: "send" });
  if (state.mode !== "hermes" || !inTauri()) {
    setTimeout(() => {
      const reply = task === null
        ? `（示範回覆）收到：「${text}」。未設定 Hermes gateway。`
        : planDemoMarkdown(task);
      appendMessage(sentId, { role: "bot", text: reply });
      noteActivity(sentId, { type: "completed", text: reply });
    }, 350);
    return;
  }
  holdOutgoing(sentId, text);
  noteRunSession(threadFor(sentId));
  setBotStatus(sentId, "思考中…", "busy");
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("send_chat", { profile: sentId, text });
  } catch (err) {
    const raw = String(err);
    if (isPermissionDeniedText(raw)) {
      lockIfPermissionDenied(sentId, raw);
      return;
    }
    noteSendFailed(sentId, raw);
    setBanner(raw, "error");
  }
}

async function continueApiSession(id) {
  const thread = threadFor(id);
  if (!id || !thread.sessionReadOnly || continueApiSession.busy) return;
  continueApiSession.busy = true;
  const button = role(panelFor(id), "continue");
  if (button) button.disabled = true;
  try {
    const refused = refusedSessionIds(state.deniedSessions, id);
    const existing = writableContinuation(thread.sessions, thread.sessionId, refused);
    if (existing) {
      await pickSession(id, existing.id);
      return;
    }
    if (state.mode !== "hermes" || !inTauri()) return;
    const { invoke } = await import("@tauri-apps/api/core");
    const result = await invoke("client_command", {
      input: {
        profile: id,
        command: "continue",
        args: thread.sessionId || "",
        model: "",
        provider: "",
        refused,
      },
    });
    const sessionId = result?.session_id || "";
    if (sessionId && sessionId !== thread.sessionId) await pickSession(id, sessionId);
  } catch (err) {
    showActionError(String(err));
  } finally {
    continueApiSession.busy = false;
    const next = role(panelFor(id), "continue");
    if (next) next.disabled = false;
  }
}

function botsFromSettings(settings) {
  return (settings.bots || []).filter(isProfileEnabled).map((bot) => ({
    id: bot.profile,
    name: bot.display_name || bot.profile,
    short: shortLabel(bot.display_name || bot.profile),
    color: bot.color || PALETTE[0],
    status: bot.has_key ? "閒置" : "未有金鑰",
    detail: bot.detail || `profile ${bot.profile}`,
    float: null,
    hasKey: bot.has_key,
  }));
}

async function sendClientCommand(id, text, action) {
  appendMessage(id, { role: "user", text, command: action.command });
  if (action.command === "stop") {
    await stopActive(id);
    return;
  }
  if (state.mode !== "hermes" || !inTauri()) {
    appendMessage(id, { role: "commentary", text: `（示範）${action.mapsTo || action.command}` });
    return;
  }
  const fields = action.command === "model" ? modelFields(action.args) : { model: "", provider: "" };
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const result = await invoke("client_command", {
      input: {
        profile: id,
        command: action.command,
        args: action.args,
        model: fields.model,
        provider: fields.provider,
      },
    });
    const thread = threadFor(id);
    if (result.session_id) thread.sessionId = result.session_id;
    if (action.command === "new" || action.command === "branch") {
      thread.messages = [{ role: "user", text, command: action.command }];
      if (result.notice) thread.messages.push({ role: "commentary", text: result.notice });
      renderChat(id);
      return;
    }
    if (result.options?.length) {
      appendMessage(id, { role: "commentary", text: result.options.join("\n") });
    } else if (result.notice) {
      appendMessage(id, { role: "commentary", text: result.notice });
    }
  } catch (err) {
    const message = String(err);
    appendMessage(id, { role: "commentary", text: message });
    setBanner(message, "error");
  }
}

function useMock(reason, bannerAction = "") {
  cancelReconnect();
  stopRosterSync();
  window.clearInterval(state.chatRefresh);
  state.chatRefresh = 0;
  state.mode = "mock";
  state.bots = MOCK_BOTS.map((bot) => ({
    ...bot,
    messages: bot.messages.map((m) => ({ ...m })),
  }));
  state.threads = new Map();
  state.bots.forEach((bot) => {
    const thread = threadFor(bot.id);
    const sessions = [
      { id: `${bot.id}-desktop`, title: bot.name, last_active: 200, hidden: false, preview: "" },
      { id: `${bot.id}-bot-chat`, title: "Bot Chat", source: "api_server", last_active: 80, hidden: false, preview: "" },
      { id: `${bot.id}-splitLot`, title: "_splitLot", last_active: 40, hidden: true, preview: "" },
    ];
    const choice = resolveSession(sessions, { id: "", explicit: false, anchor: 0 });
    thread.sessions = sessions;
    thread.sessionId = choice.id;
    thread.sessionExplicit = false;
    thread.sessionAnchor = choice.anchor;
    thread.sessionReadOnly = !!choice.readOnly;
    thread.sessionReadOnlyReason = choice.readOnly ? SESSION_READ_ONLY_REASON : "";
    thread.messages = bot.messages.map((m) => ({ ...m }));
    thread.bySession = new Map([
      [choice.id, thread.messages.map((m) => ({ ...m }))],
      [`${bot.id}-desktop`, [{ role: "bot", text: "（舊對話）" }]],
      [`${bot.id}-splitLot`, [{ role: "bot", text: "（舊對話）_splitLot" }]],
    ]);
    thread.status = bot.status;
    thread.loaded = true;
  });
  removeBotPanels();
  state.activeId = null;
  state.slashPanelId = "";
  state.openIds = [];
  setBanner(reason, "info", "", bannerAction);
  renderBots();
}

function useHermes(settings) {
  cancelReconnect();
  state.catalog = null;
  state.catalogProfile = "";
  state.mode = "hermes";
  state.settings = settings;
  adoptKanbanPick(settings);
  state.showBotNames = !!settings?.show_bot_names;
  state.bots = botsFromSettings(settings);
  state.threads = new Map();
  state.busy.clear();
  removeBotPanels();
  state.activeId = null;
  state.slashPanelId = "";
  state.openIds = [];
  if (settings.keyring_error) {
    setBanner(`鑰匙圈：${settings.keyring_error}`, "error", "keyring");
  } else if (state.bots.length === 0) {
    setBanner("Gateway 已設定，但未有 Bot。打開設定加入 profile 同金鑰。", "info");
  } else {
    setBanner("已連接設定。點頭像載入該 Bot 嘅 Bot Chat。", "ok");
  }
  renderBots();
  prefetchBotChats();
  armChatRefresh();
  armRosterSync();
}

async function connectHermes(settings) {
  if (!inTauri() || settings?.mode !== "hermes") {
    useHermes(settings);
    return;
  }
  const before = settings.bots || [];
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const synced = await invoke("sync_profiles");
    useHermes(synced);
    announceNewKeys(before, synced);
  } catch (err) {
    useHermes(settings);
    if (gatewayDown(String(err))) noteGatewayDown();
    else setBanner(String(err), "error");
  }
}

function ensureSettingsList() {
  if (!state.settings || typeof state.settings !== "object") {
    state.settings = { mode: state.mode, bots: [] };
  }
  if (!Array.isArray(state.settings.bots)) state.settings.bots = [];
  return state.settings.bots;
}

function rosterForSettings() {
  const saved = Array.isArray(state.settings?.bots) ? [...state.settings.bots] : [];
  if (state.mode !== "mock") return saved;
  const ids = new Set(saved.map((bot) => bot.profile));
  for (const bot of state.bots) {
    if (ids.has(bot.id)) continue;
    saved.push({
      profile: bot.id,
      display_name: bot.name || bot.id,
      color: bot.color || "",
      detail: bot.detail || "",
      base_url: "",
      has_key: false,
      enabled: true,
    });
  }
  return saved;
}

function syncRosterCheckbox(id, enabled) {
  document.querySelectorAll(".bot-row").forEach((row) => {
    const profile = row.querySelector('[data-field="profile"]')?.value.trim();
    if (profile !== id) return;
    const box = row.querySelector('[data-field="enabled"]');
    if (box) box.checked = enabled;
  });
}

function settingsRowFromLive(id) {
  const live = state.bots.find((bot) => bot.id === id);
  if (!live) return null;
  return {
    profile: id,
    display_name: live.name || id,
    color: live.color || "",
    detail: live.detail || "",
    base_url: "",
    has_key: !!live.hasKey,
    enabled: true,
  };
}

async function setProfileShown(id, enabled) {
  const bots = ensureSettingsList();
  const persisted = bots.some((bot) => bot.profile === id);
  let row = bots.find((bot) => bot.profile === id);
  if (!row) {
    row = settingsRowFromLive(id);
    if (!row) return;
    bots.push(row);
  }
  const previous = row.enabled !== false;
  row.enabled = !!enabled;
  if (!enabled) {
    state.bots = state.bots.filter((bot) => bot.id !== id);
    closeBotPanel(id);
  } else if (!state.bots.some((bot) => bot.id === id)) {
    const [mapped] = botsFromSettings({ bots: [{ ...row, enabled: true }] });
    if (mapped) state.bots.push(mapped);
    renderBots();
    prefetchBotChats();
  }
  syncRosterCheckbox(id, !!enabled);
  closeOrbMenu();
  if (!(inTauri() && state.mode === "hermes" && persisted)) return;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const settings = await invoke("set_profile_enabled", { profile: id, enabled: !!enabled });
    state.settings = settings;
    state.bots = botsFromSettings(settings);
    renderBots();
    prefetchBotChats();
    syncRosterCheckbox(id, !!enabled);
  } catch (err) {
    row.enabled = previous;
    if (previous) {
      if (!state.bots.some((bot) => bot.id === id)) {
        const [mapped] = botsFromSettings({ bots: [{ ...row, enabled: true }] });
        if (mapped) state.bots.push(mapped);
      }
    } else {
      state.bots = state.bots.filter((bot) => bot.id !== id);
      closeBotPanel(id);
    }
    syncRosterCheckbox(id, previous);
    renderBots();
    showActionError(String(err));
  }
}

function openOrbMenu(id, x, y) {
  const menu = $("#orb-menu");
  if (!menu) return;
  menu.hidden = false;
  menu.dataset.profile = id;
  menu.style.left = "0px";
  menu.style.top = "0px";
  const box = menu.getBoundingClientRect();
  const left = Math.max(8, Math.min(x, window.innerWidth - box.width - 8));
  const top = Math.max(8, Math.min(y, window.innerHeight - box.height - 8));
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
  cursorPoint.x = x;
  cursorPoint.y = y;
  flushHits();
}

function closeOrbMenu() {
  const menu = $("#orb-menu");
  if (!menu || menu.hidden) return;
  menu.hidden = true;
  delete menu.dataset.profile;
  scheduleHitSync();
}

function rowFromBot(bot = {}) {
  const row = document.createElement("div");
  row.className = "bot-row";
  row.innerHTML = `
    <label class="show-toggle"><input type="checkbox" data-field="enabled" /><span>顯示</span></label>
    <input type="text" data-field="profile" placeholder="profile" autocomplete="off" />
    <input type="text" data-field="display_name" placeholder="顯示名稱" autocomplete="off" />
    <input type="color" data-field="color" aria-label="顏色" />
    <button type="button" class="icon-btn" data-action="remove">移除</button>
    <input class="span-2" type="text" data-field="detail" placeholder="詳情（可留空）" autocomplete="off" />
    <input class="span-2" type="url" data-field="base_url" placeholder="專用位址（可留空）" autocomplete="off" />
    <input class="span-2" type="password" data-field="key" placeholder="API 金鑰" autocomplete="off" />
  `;
  row.querySelector('[data-field="profile"]').value = bot.profile || "";
  const enabled = row.querySelector('[data-field="enabled"]');
  enabled.checked = bot.enabled !== false;
  enabled.addEventListener("change", () => {
    const profile = row.querySelector('[data-field="profile"]').value.trim();
    if (!profile) {
      enabled.checked = true;
      return;
    }
    void setProfileShown(profile, enabled.checked);
  });
  row.querySelector('[data-field="display_name"]').value = bot.display_name || "";
  const existingRows = $("#bot-editor") ? $("#bot-editor").querySelectorAll(".bot-row").length : 0;
  row.querySelector('[data-field="color"]').value = bot.color || colorForIndex(existingRows);
  row.querySelector('[data-field="detail"]').value = bot.detail || "";
  row.querySelector('[data-field="base_url"]').value = bot.base_url || "";
  const key = row.querySelector('[data-field="key"]');
  key.placeholder = bot.has_key ? "已儲存，留空代表保留" : "API 金鑰";
  key.dataset.hasKey = bot.has_key ? "1" : "0";
  if (bot.profile && !bot.has_key) {
    const missing = document.createElement("p");
    missing.className = "key-missing";
    missing.textContent = "未有 API 金鑰";
    row.appendChild(missing);
  }
  row.querySelector('[data-action="remove"]').addEventListener("click", () => row.remove());
  return row;
}

function readRows() {
  return [...$("#bot-editor").querySelectorAll(".bot-row")].map((row) => {
    const value = (field) => row.querySelector(`[data-field="${field}"]`).value.trim();
    const keyInput = row.querySelector('[data-field="key"]');
    return {
      profile: value("profile"),
      display_name: value("display_name"),
      color: row.querySelector('[data-field="color"]').value,
      detail: value("detail"),
      base_url: value("base_url"),
      key: keyInput.value,
      clear_key: false,
      has_key: keyInput.dataset.hasKey === "1",
      enabled: row.querySelector('[data-field="enabled"]').checked,
    };
  });
}

function applyInteraction(raw) {
  const interaction = raw || {};
  state.interaction = {
    modifier: interaction.modifier || "ctrl",
    fadeEnabled: interaction.fade_enabled !== false && interaction.fadeEnabled !== false,
    fadeDistance: Number(interaction.fade_distance ?? interaction.fadeDistance ?? 120),
    minOpacity: Number(interaction.min_opacity ?? interaction.minOpacity ?? 0.25),
    supported: interaction.supported !== false,
  };
  document.querySelectorAll(".interact-hint").forEach((hint) => {
    hint.textContent = hintText();
  });
}

function readInteractionForm() {
  const fadeDistance = Number(state.interaction?.fadeDistance ?? state.settings?.interaction?.fade_distance);
  return {
    modifier: $("#interaction-modifier").value,
    fade_enabled: state.interaction?.fadeEnabled !== false && state.settings?.interaction?.fade_enabled !== false,
    fade_distance: Number.isFinite(fadeDistance) ? fadeDistance : 120,
    min_opacity: Number($("#interaction-min-opacity").value) / 100,
  };
}

function fillSettings(settings) {
  $("#gateway-url").value = settings?.gateway_base_url || "";
  const kanbanUrl = $("#kanban-url");
  if (kanbanUrl) {
    kanbanUrl.value = settings?.kanban_base_url || "";
    kanbanUrl.placeholder = settings?.kanban_server_url || "http://127.0.0.1:9119";
  }
  const kanbanPassword = $("#kanban-password");
  if (kanbanPassword) {
    kanbanPassword.value = "";
    kanbanPassword.placeholder = settings?.has_kanban_login ? "已登入，留空代表保留" : "";
  }
  const kanbanUser = $("#kanban-user");
  if (kanbanUser) kanbanUser.value = "";
  $("#dashboard-url").value = settings?.dashboard_base_url || "http://127.0.0.1:9119";
  $("#dashboard-token").value = "";
  $("#dashboard-token").placeholder = settings?.has_dashboard_token
    ? "已儲存，留空代表保留"
    : "可留空";
  const editor = $("#bot-editor");
  editor.innerHTML = "";
  const bots = rosterForSettings();
  if (bots.length === 0) editor.appendChild(rowFromBot());
  bots.forEach((bot) => editor.appendChild(rowFromBot(bot)));
  const interaction = settings?.interaction || state.interaction;
  $("#interaction-modifier").value = interaction.modifier || "ctrl";
  const min = interaction.min_opacity ?? interaction.minOpacity ?? 0.25;
  $("#interaction-min-opacity").value = String(Math.round(Number(min) * 100));
  const showNames = $("#show-bot-names");
  if (showNames) showNames.checked = !!settings?.show_bot_names;
  const support = $("#interaction-support");
  const supported = interaction.supported !== false;
    support.textContent = supported
    ? "Windows、macOS、Linux X11 會讀全域游標同修飾鍵。Wayland 冇 X11（DISPLAY）時唔會穿透。"
    : "而家讀唔到全域輸入（常見於純 Wayland）。Overlay 會保持可點擊。";
  const altWarning = $("#interaction-alt-warning");
  if (altWarning) {
    const platform = `${navigator.platform || ""} ${navigator.userAgent || ""}`;
    altWarning.hidden = !linuxAltWarning(platform);
  }
  const setupHint = $("#setup-hint");
  if (setupHint) setupHint.hidden = !setupHintVisible($("#gateway-url").value);
}

function focusSettings() {
  const shell = shellFor("settings");
  if (settingsOpen() && shell && !shell.classList.contains("is-collapsing")) {
    raisePanel(shell);
    renderSettingsOrb();
    return;
  }
  openSettings();
}

function openSettings() {
  hideKeyPrompt();
  window.clearTimeout(blurReleaseTimer);
  blurReleaseTimer = 0;
  state.windowFocused = true;
  fillSettings(state.settings);
  ensureChrome();
  const panel = $("#settings");
  const shell = shellFor("settings");
  if (!panel || !shell) return;
  const opening = shell.dataset.state !== "panel" || shell.classList.contains("is-collapsing");
  panel.hidden = false;
  if (opening) {
    raisePanel(shell);
    void runShellMorph(shell, "panel");
  } else {
    raisePanel(shell);
  }
  renderSettingsOrb();
  syncLatch();
  scheduleHitSync();
  const firstRun = shouldAutoOpenSettings(state.settings);
  $("#settings-status").textContent = firstRun
    ? "填上面嘅 Gateway 位址同 API 金鑰，然後儲存。"
    : inTauri()
      ? "儲存之後先會用新設定。測試連線讀已儲存嘅金鑰。"
      : "瀏覽器預覽改唔到鑰匙圈。請用 npm run tauri dev。";
  if (setupHintVisible($("#gateway-url").value)) $("#gateway-url").focus();
  if (!inTauri()) return;
  import("@tauri-apps/api/window")
    .then(({ getCurrentWindow }) => getCurrentWindow().setFocus())
    .catch(() => {});
}

function closeSettings() {
  const panel = $("#settings");
  const shell = shellFor("settings");
  if (!panel || !shell || !settingsOpen()) return;
  const active = document.activeElement;
  if (active && panel.contains(active)) active.blur();
  if (state.pointerHitId === "settings") state.pointerHitId = "";
  void runShellMorph(shell, "orb").then((closed) => {
    if (!closed) return;
    renderSettingsOrb();
    syncLatch();
    if ((state.keyPromptBots || []).length) showKeyPrompt();
    else scheduleHitSync();
  });
  renderSettingsOrb();
}

async function saveSettings(event) {
  event.preventDefault();
  if (!inTauri()) {
    $("#settings-status").textContent = "瀏覽器預覽唔可以儲存。";
    return;
  }
  const bots = readRows().filter((bot) => bot.profile || bot.display_name || bot.key);
  const { invoke } = await import("@tauri-apps/api/core");
  try {
    const settings = await invoke("save_settings", {
      input: {
        gateway_base_url: $("#gateway-url").value.trim(),
        kanban_base_url: $("#kanban-url")?.value.trim() || "",
        dashboard_base_url: $("#dashboard-url").value.trim(),
        dashboard_token: $("#dashboard-token").value,
        clear_dashboard_token: false,
        interaction: readInteractionForm(),
        show_bot_names: !!$("#show-bot-names")?.checked,
        bots,
      },
    });
    applyInteraction(settings.interaction);
    state.settings = settings;
    $("#settings-status").textContent = "已儲存。";
    $("#dashboard-token").value = "";
    if (settings.mode === "mock") useMock("未設定 gateway，而家係離線示範模式。", "settings");
    else await connectHermes(settings);
    reconcileKeyPrompt(settings.bots || []);
    closeSettings();
  } catch (err) {
    $("#settings-status").textContent = String(err);
  }
}

async function probeSaved() {
  if (!inTauri()) return;
  $("#settings-status").textContent = "測試緊…";
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const report = await invoke("probe_gateway");
    const lines = [
      report.health_ok ? `健康檢查：${report.health_detail}` : `健康檢查失敗：${report.health_detail}`,
      ...(report.bots || []).map((bot) => `${bot.ok ? "可讀" : "失敗"} ${bot.profile}：${bot.detail}`),
    ];
    $("#settings-status").textContent = lines.join("\n");
    if (!report.health_ok) setBanner(report.health_detail, "error");
    else if ((report.bots || []).every((bot) => bot.ok)) setBanner("Gateway 同名單金鑰可用。", "ok");
    else setBanner("Gateway 有回應，但部分 Bot 金鑰或路徑失敗。睇設定入面嘅結果。", "error");
  } catch (err) {
    $("#settings-status").textContent = String(err);
  }
}

async function discoverProfiles() {
  if (!inTauri()) return;
  $("#settings-status").textContent = "實驗匯入中…";
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const found = await invoke("discover_profiles", {
      dashboardBaseUrl: $("#dashboard-url").value.trim(),
      token: $("#dashboard-token").value,
    });
    $("#dashboard-token").value = "";
    const existing = new Map(readRows().filter((b) => b.profile).map((b) => [b.profile, b]));
    for (const bot of found) {
      if (!existing.has(bot.profile)) {
        existing.set(bot.profile, {
          profile: bot.profile,
          display_name: bot.display_name,
          color: bot.color,
          detail: bot.detail,
          base_url: "",
          has_key: false,
          enabled: true,
        });
      }
    }
    const editor = $("#bot-editor");
    editor.innerHTML = "";
    for (const bot of existing.values()) editor.appendChild(rowFromBot(bot));
    $("#settings-status").textContent = found.length
      ? `匯入 ${found.length} 個 profile。金鑰要自己填，然後儲存。`
      : "Dashboard 冇返回 profile。";
  } catch (err) {
    $("#settings-status").textContent = String(err);
  }
}

async function setupWindowChrome() {
  let win = null;
  if (inTauri()) {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      win = getCurrentWindow();
    } catch {
      win = null;
    }
  }
  const pinBtn = $("#btn-pin");
  pinBtn?.addEventListener("click", async (event) => {
    event.stopPropagation();
    const next = pinToggle(state.alwaysOnTop);
    state.alwaysOnTop = next.alwaysOnTop;
    pinBtn.setAttribute("aria-pressed", String(next.pressed));
    pinBtn.textContent = next.label;
    if (next.armsCloseGuard && inTauri()) {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("arm_pin_close_guard");
      } catch (err) {
        showActionError(invokeFailureMessage("置頂保護", err));
      }
    }
    if (win) {
      try {
        await win.setAlwaysOnTop(next.alwaysOnTop);
      } catch (err) {
        console.warn("setAlwaysOnTop failed", err);
      }
    }
  });
  bindPanelDrag($("#settings"));
  bindPanelDrag($("#kanban-panel"));
}

function slashPanel() {
  return panelFor(state.slashPanelId || state.activeId);
}

function slashInput() {
  return role(slashPanel(), "input");
}

function slashPopup() {
  return role(slashPanel(), "slash");
}

function closeSlashExcept(id) {
  document.querySelectorAll(".bot-panel").forEach((panel) => {
    if (panel.dataset.botId === id) return;
    const popup = role(panel, "slash");
    if (!popup || popup.hidden) return;
    popup.hidden = true;
    popup.replaceChildren();
  });
}

function slashPopupOpen() {
  const popup = slashPopup();
  return !!popup && !popup.hidden;
}

function closeSlash() {
  const popup = slashPopup();
  if (!popup) return;
  popup.hidden = true;
  popup.replaceChildren();
  syncLatch();
  scheduleHitSync();
}

function activeSlashItems() {
  const query = slashFilterQuery(slashInput()?.value || "");
  if (query == null) return [];
  return orderSlashCommands(filterCommands(state.catalog || [], query));
}

function noteStopped(id, { keepBusy = false } = {}) {
  const thread = threadFor(id);
  if (!thread.stopNoted) {
    thread.stopNoted = true;
    const note = { role: "commentary", text: "已停止呢次回覆。" };
    if (runIsOnScreen(id)) appendMessage(id, note);
    else runMessages(id).push(note);
  }
  if (!keepBusy) {
    clearRunSession(thread);
    setBotStatus(id, "已停止", "idle");
  }
  if (runIsOnScreen(id) && panelFor(id)) renderChat(id);
}

function mergeCaughtUp(id, opened) {
  const thread = threadFor(id);
  const sessionId = opened.session_id || "";
  if (sessionId && thread.sessionId && sessionId !== thread.sessionId) return false;
  const incoming = (opened.messages || []).map(presentMessage);
  const { fresh, settled } = catchUpMessages(thread.messages, incoming);
  const busy = state.busy.has(id);
  if (settled && !busy) {
    const last = [...thread.messages].reverse().find((message) => message.live && message.role === "bot");
    if (last) {
      last.text = settled.text;
      last.live = false;
    }
  }
  const live = [...thread.messages].reverse().find((message) => message.live && message.role === "bot" && message.text);
  const additions = fresh.filter((message) => {
    if (!busy || message.role !== "bot" || !live) return true;
    return !String(message.text || "").startsWith(String(live.text));
  });
  for (const message of additions) appendMessage(id, message);
  if (sessionId && !thread.sessionId) thread.sessionId = sessionId;
  thread.loaded = true;
  const gotReply = additions.some((message) => message.role === "bot" || message.role === "failure")
    || (!!settled && !busy);
  if (gotReply && viewingRun(thread)) {
    thread.queued = false;
    thread.watchReply = false;
    if (!thread.messages.some((message) => message.live)) {
      clearRunSession(thread);
      setBotStatus(id, "閒置", "idle");
    }
  }
  if ((settled || additions.length) && panelFor(id)) renderChat(id);
  return gotReply;
}

async function catchUpSession(id) {
  if (state.mode !== "hermes" || !inTauri() || !id) return false;
  const token = state.reconnectToken;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const opened = await invoke("open_bot", { profile: id, quiet: true });
    if (token !== state.reconnectToken || state.mode !== "hermes") return false;
    return mergeCaughtUp(id, opened);
  } catch (err) {
    if (gatewayDown(String(err))) noteGatewayDown();
    return false;
  }
}

async function sendWhileBusy(id, text) {
  const thread = threadFor(id);
  const task = planTask(text);
  appendMessage(id, task === null ? { role: "user", text } : { role: "user", text, command: "plan" });
  noteActivity(id, { type: "send" });
  if (state.mode !== "hermes" || !inTauri()) {
    appendMessage(id, { role: "commentary", text: "排隊中，等佢講完就會行" });
    window.setTimeout(() => {
      const reply = task === null
        ? `（示範回覆）收到：「${text}」。未設定 Hermes gateway。`
        : planDemoMarkdown(task);
      appendMessage(id, { role: "bot", text: reply });
      noteActivity(id, { type: "completed", text: reply });
      setBotStatus(id, "閒置", "idle");
    }, 350);
    return;
  }
  holdOutgoing(id, text);
  let joined = false;
  if (thread.runId) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      joined = (await invoke("steer_run", { profile: id, runId: thread.runId, text })) === "joined";
    } catch {
      joined = false;
    }
  }
  if (joined) {
    appendMessage(id, { role: "commentary", text: "已加入呢一輪" });
    if (panelFor(id)) renderChat(id);
    return;
  }
  appendMessage(id, { role: "commentary", text: "排隊中，等佢講完就會行" });
  thread.queued = true;
  thread.watchReply = true;
  if (panelFor(id)) renderChat(id);
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("send_chat", { profile: id, text, queue: true });
  } catch (err) {
    thread.queued = false;
    const raw = String(err);
    if (isPermissionDeniedText(raw)) {
      lockIfPermissionDenied(id, raw);
      return;
    }
    noteSendFailed(id, raw);
  }
}

async function stopActive(id) {
  const profile = id || state.activeId;
  if (!profile || state.mode !== "hermes" || !inTauri()) return;
  const thread = threadFor(profile);
  thread.watchReply = true;
  const posted = thread.runId || "";
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    let result = await invoke("stop_chat", { profile, runId: posted });
    const again = stopAfterMiss(thread, posted);
    if (result === "not_active" && again.retry) {
      result = await invoke("stop_chat", { profile, runId: again.retry });
    }
    if (typeof result === "string" && result.startsWith("terminal:")) {
      const ended = result.slice("terminal:".length);
      thread.queued = false;
      thread.watchReply = false;
      thread.runId = "";
      clearRunSession(thread);
      setBotStatus(profile, ended === "failed" ? "回覆失敗" : "閒置", ended === "failed" ? "error" : "idle");
      void catchUpSession(profile);
      return;
    }
    if (result === "not_active") {
      void catchUpSession(profile);
      return;
    }
    void catchUpSession(profile);
  } catch {
    showActionError("停止未送到。");
  }
}

function measureInputText(text, style) {
  const canvas = measureInputText.canvas || (measureInputText.canvas = document.createElement("canvas"));
  const ctx = canvas.getContext("2d");
  ctx.font = style.font;
  return ctx.measureText(text).width;
}

function syncSlashGhost() {
  const input = slashInput();
  const ghost = role(slashPanel(), "ghost");
  if (!input || !ghost) return;
  const hint = inlineArgsHint(input.value, state.slashArgsHint);
  if (!hint) {
    ghost.hidden = true;
    ghost.textContent = "";
    return;
  }
  ghost.hidden = false;
  ghost.textContent = hint;
  const style = getComputedStyle(input);
  const caret = input.selectionStart ?? input.value.length;
  const width = measureInputText(input.value.slice(0, caret), style);
  const pad = Number.parseFloat(style.paddingLeft) || 0;
  ghost.style.left = `${input.offsetLeft + pad + width - input.scrollLeft}px`;
  ghost.style.top = `${input.offsetTop}px`;
  ghost.style.height = `${input.offsetHeight}px`;
  ghost.style.font = style.font;
}

async function ensureCatalog() {
  if (!inTauri() || state.mode !== "hermes" || !state.activeId) {
    state.catalog = PREVIEW_COMMANDS;
    state.catalogHint = "";
    state.catalogProfile = state.activeId || "";
    return;
  }
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const result = await invoke("list_commands", { profile: state.activeId });
    state.catalog = result.commands || [];
    state.catalogHint = result.hint || "";
    state.catalogProfile = state.activeId;
  } catch (err) {
    state.catalog = [];
    state.catalogHint = String(err);
    state.catalogProfile = state.activeId;
  }
}

function renderSlashPopup() {
  const popup = slashPopup();
  const input = slashInput();
  if (!popup || !input) return;
  const query = slashFilterQuery(input.value);
  if (query == null) {
    closeSlash();
    return;
  }
  const items = activeSlashItems();
  if (!items.length && !(state.catalogHint && !(state.catalog || []).length)) {
    closeSlash();
    return;
  }
  if (state.slashIndex >= items.length) state.slashIndex = 0;
  popup.replaceChildren();
  if (!items.length) {
    const hint = document.createElement("p");
    hint.className = "slash-hint";
    hint.textContent = state.catalogHint || "未裝 overlay-slash，/ 選單唔會出現。";
    popup.appendChild(hint);
  }
  let index = 0;
  groupByCategory(items).forEach((group) => {
    const label = document.createElement("div");
    label.className = "slash-cat";
    label.textContent = group.category;
    if (/^[\x00-\x7F]+$/.test(group.category || "")) label.lang = "en";
    popup.appendChild(label);
    group.items.forEach((command) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `slash-item${index === state.slashIndex ? " active" : ""}${command.enabled === false ? " disabled" : ""}`;
    button.disabled = command.enabled === false;
    button.setAttribute("role", "option");
    const name = document.createElement("span");
    name.className = "slash-name";
    name.lang = "en";
    name.textContent = command.name;
    const desc = document.createElement("span");
    desc.className = "slash-desc";
    desc.textContent = command.description || "";
    button.append(name, desc);
    button.addEventListener("click", () => completeSlash(command));
    popup.appendChild(button);
    index += 1;
    });
  });
  popup.hidden = false;
  const active = popup.querySelector(".slash-item.active");
  active?.scrollIntoView({ block: "nearest" });
  syncLatch();
  scheduleHitSync();
}

function completeSlash(command) {
  if (!command || command.enabled === false) return;
  const input = slashInput();
  if (!input) return;
  input.value = completionText(command);
  input.placeholder = "輸入訊息給呢個 Bot…";
  state.slashArgsHint = String(command.args_hint || "");
  input.focus();
  const end = input.value.length;
  input.setSelectionRange(end, end);
  closeSlash();
  syncSlashGhost();
}

async function refreshSlash() {
  const query = slashFilterQuery(slashInput()?.value || "");
  if (query == null) {
    closeSlash();
    return;
  }
  const alreadyOpen = slashPopupOpen();
  const sameProfile = state.catalog != null && state.catalogProfile === state.activeId;
  if (shouldRefreshCatalog(alreadyOpen, sameProfile)) await ensureCatalog();
  if (slashFilterQuery(slashInput()?.value || "") == null) return;
  renderSlashPopup();
}

function topOpenPanelId() {
  const shells = [...document.querySelectorAll(".morph")].filter(
    (shell) => shell.dataset.state === "panel" && !shell.classList.contains("is-collapsing"),
  );
  shells.sort((a, b) => (Number(b.style.zIndex) || 0) - (Number(a.style.zIndex) || 0));
  return shells[0]?.dataset.botId || "";
}

function focusedOpenPanelId() {
  const shell = document.activeElement?.closest?.(".morph");
  if (!shell || shell.classList.contains("is-collapsing")) return "";
  if (shell.dataset.state !== "panel" && shell.dataset.opening !== "panel") return "";
  return shell.dataset.botId || "";
}

function closeOpenPanel(id) {
  if (id === "settings") closeSettings();
  else if (id === "kanban") closeKanban();
  else if (id === "cron") closeCron();
  else if (id) closeBotPanel(id);
}

let composerField = null;

function composerHostOpen(field) {
  if (!field || !field.isConnected) return false;
  const shell = field.closest(".morph");
  if (!shell) return field.closest("#settings") != null;
  if (shell.classList.contains("is-collapsing")) return false;
  return shell.dataset.state === "panel" || shell.dataset.opening === "panel";
}

function rememberComposer() {
  const active = document.activeElement;
  if (!isTextField(active)) return;
  if (!active.closest?.(".morph, #settings")) return;
  composerField = active;
}

function restoreComposer() {
  const field = composerField;
  if (!composerHostOpen(field)) return;
  if (document.activeElement === field) return;
  const start = field.selectionStart;
  const end = field.selectionEnd;
  field.focus({ preventScroll: true });
  if (start != null && typeof field.setSelectionRange === "function") {
    try { field.setSelectionRange(start, end ?? start); } catch { /* number inputs */ }
  }
}

function insertComposerKey(field, key) {
  if (!field || field.disabled) return;
  const start = field.selectionStart ?? field.value.length;
  const end = field.selectionEnd ?? start;
  field.value = `${field.value.slice(0, start)}${key}${field.value.slice(end)}`;
  const caret = start + key.length;
  if (typeof field.setSelectionRange === "function") field.setSelectionRange(caret, caret);
  field.dispatchEvent(new Event("input", { bubbles: true }));
}

function composerShellSettling(shell) {
  if (!shell) return false;
  return visualQuiet(shell)
    || !!shell._motion
    || shell.classList.contains("is-morphing")
    || shell.classList.contains("is-plan-seam")
    || shell.classList.contains("is-plan-arming");
}

function openPanelComposer() {
  const ordered = [];
  const preferred = shellFor(state.activeId);
  if (preferred) ordered.push(preferred);
  document.querySelectorAll(".morph[data-kind='bot']").forEach((node) => {
    if (node !== preferred) ordered.push(node);
  });
  for (const shell of ordered) {
    if (shell.classList.contains("is-collapsing")) continue;
    if (shell.dataset.state !== "panel" && shell.dataset.opening !== "panel") continue;
    const input = role(shell, "input");
    if (input) return input;
  }
  return null;
}

function foreignFieldFocus() {
  const active = document.activeElement;
  if (!active) return false;
  if (active.tagName === "SELECT") return true;
  if (!isTextField(active)) return false;
  return active.dataset?.role !== "input";
}

function composerIsBusy(field) {
  const id = field?.closest?.(".morph")?.dataset?.botId || "";
  return !!id && state.busy.has(id);
}

function setupComposer() {
  window.addEventListener("keydown", (event) => {
    if (!foreignFieldFocus() && event.key.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey) {
      const latched = openPanelComposer();
      if (latched && !composerHostOpen(composerField)) composerField = latched;
    }
    const action = composerKeyAction({
      key: event.key,
      ctrlKey: event.ctrlKey,
      altKey: event.altKey,
      metaKey: event.metaKey,
      activeIsComposer: !!composerField && (document.activeElement === composerField || event.target === composerField),
      composerConnected: composerHostOpen(composerField),
      osModifierDown: state.osModifierDown,
    });
    if (action === "remember") {
      rememberComposer();
      return;
    }
    const shell = composerField?.closest?.(".morph");
    if (!event.isComposing && !foreignFieldFocus() && composerField && ownComposerKey({
      action,
      busy: composerIsBusy(composerField),
      settling: composerShellSettling(shell),
    })) {
      event.preventDefault();
      restoreComposer();
      insertComposerKey(composerField, event.key);
      debugLog("composer-own", `key=${event.key} busy=1 settling=1`);
      return;
    }
    if (action === "send" && composerField?.dataset.role === "input" && event.target !== composerField && !slashPopupOpen()) {
      event.preventDefault();
      const id = composerField.closest(".morph")?.dataset.botId
        || composerField.closest(".bot-panel")?.dataset.botId
        || state.activeId;
      sendActive(id);
      return;
    }
    if (action === "insert" && composerField && !foreignFieldFocus()) {
      restoreComposer();
      if (event.target !== composerField) {
        insertComposerKey(composerField, event.key);
        event.preventDefault();
      }
    }
  }, true);
  window.addEventListener("keyup", (event) => {
    const action = composerKeyAction({
      key: event.key,
      composerConnected: composerHostOpen(composerField) || isTextField(document.activeElement),
    });
    if (action !== "remember") return;
    rememberComposer();
    restoreComposer();
    flushHits();
  });
  document.addEventListener("focusin", (event) => {
    if (isTextField(event.target)) rememberComposer();
  });
  document.addEventListener("pointerdown", (event) => {
    if (event.button === 0 && !event.ctrlKey && !engagedModifier()) {
      const direct = event.target?.closest?.("[data-role='plan-preview-mode'], [data-role='plan-source-mode'], [data-role='plan-close']");
      const control = direct || planControlUnder(document, event.clientX, event.clientY);
      if (control && !direct) {
        // WebKitGTK hit-tests the clipped plan as BODY. The layout box is
        // still the button, so the first plain click has to reach it.
        control.dispatchEvent(new PointerEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
          button: 0,
          clientX: event.clientX,
          clientY: event.clientY,
        }));
        if (control.dataset.role !== "plan-close") control.click();
        event.preventDefault();
        event.stopPropagation();
        return;
      }
    }
    const control = event.target?.closest?.("button, select, a, textarea, .panel-header, .settings-head");
    const shell = event.target?.closest?.(".morph");
    if (control) {
      // 停止 sits in the composer row while a reply streams. Clearing the
      // remembered field here dropped the keys that followed that click.
      const keep = shell && composerField && shell.contains(composerField) && composerShellSettling(shell);
      if (!keep && composerField && !composerField.contains(event.target)) composerField = null;
      return;
    }
    const bot = event.target?.closest?.(".morph[data-kind='bot']");
    const input = role(bot, "input");
    const open = bot && !bot.classList.contains("is-collapsing")
      && (bot.dataset.state === "panel" || bot.dataset.opening === "panel");
    const onComposer = !!(input && (event.target === input || event.target.closest?.(".composer")));
    if (input && open && (onComposer || composerShellSettling(bot))) {
      composerField = input;
      if (document.activeElement !== input) input.focus({ preventScroll: true });
      return;
    }
    if (composerField && !composerField.contains(event.target)) composerField = null;
  }, true);
  window.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || event.repeat) return;
    const menu = $("#orb-menu");
    const action = escapeTarget({
      menuOpen: !!(menu && !menu.hidden),
      dropdownOpen: !!state.dropdownOpen,
      slashOpen: slashPopupOpen(),
      focusedPanelId: focusedOpenPanelId(),
      topPanelId: topOpenPanelId(),
    });
    if (action.kind === "none") return;
    event.preventDefault();
    event.stopPropagation();
    if (action.kind === "menu") {
      closeOrbMenu();
      return;
    }
    if (action.kind === "dropdown") {
      state.dropdownOpen = nextDropdownOpen(state.dropdownOpen, "escape");
      return;
    }
    if (action.kind === "slash") {
      closeSlash();
      return;
    }
    releaseOverlayFocus();
    closeOpenPanel(action.id);
    syncLatch();
  }, true);
  $("#conn-banner")?.addEventListener("click", (event) => {
    if (event.target.closest?.("[data-action='settings']")) openSettings();
  });
  const modifierSelect = $("#interaction-modifier");
  modifierSelect?.addEventListener("pointerdown", () => {
    state.dropdownOpen = nextDropdownOpen(state.dropdownOpen, "pointerdown");
  });
  modifierSelect?.addEventListener("keydown", (event) => {
    if (selectKeyOpensDropdown(event.key)) {
      state.dropdownOpen = nextDropdownOpen(state.dropdownOpen, "open-key");
    }
    if (event.key === "Escape" && state.dropdownOpen) {
      state.dropdownOpen = nextDropdownOpen(state.dropdownOpen, "escape");
      event.stopPropagation();
    }
  });
  modifierSelect?.addEventListener("change", () => {
    state.dropdownOpen = nextDropdownOpen(state.dropdownOpen, "change");
  });
  modifierSelect?.addEventListener("blur", () => {
    const action = selectBlurAction({
      dropdownOpen: state.dropdownOpen,
      documentFocused: document.hasFocus(),
    });
    if (action === "defer") {
      void queryOsFocus();
      return;
    }
    if (action === "close") state.dropdownOpen = nextDropdownOpen(state.dropdownOpen, "blur");
  });
  const settingsClose = $("#btn-settings-close");
  if (settingsClose) {
    settingsClose.dataset.hitId = "close:settings";
    settingsClose.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      closeSettings();
    });
  }
  $("#btn-quit")?.addEventListener("click", async () => {
    const action = settingsQuitAction();
    if (!inTauri()) return;
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke(action.command);
    } catch (err) {
      showActionError(invokeFailureMessage("結束程式", err));
    }
  });
  $("#settings-form").addEventListener("submit", saveSettings);
  $("#btn-add-bot").addEventListener("click", () => $("#bot-editor").appendChild(rowFromBot()));
  $("#btn-probe").addEventListener("click", probeSaved);
  $("#btn-discover").addEventListener("click", discoverProfiles);
  $("#show-bot-names")?.addEventListener("change", (event) => {
    void setShowBotNames(event.target.checked);
  });
  $("#btn-kanban-signin")?.addEventListener("click", () => {
    void signInKanban();
  });
  $("#btn-kanban-login")?.addEventListener("click", () => {
    openSettings();
    $("#kanban-user")?.focus();
  });
  $("#orb-menu-hide")?.addEventListener("click", () => {
    const id = $("#orb-menu")?.dataset.profile;
    if (id) void setProfileShown(id, false);
  });
  window.addEventListener("pointerdown", (event) => {
    const menu = $("#orb-menu");
    if (!menu || menu.hidden || menu.contains(event.target)) return;
    closeOrbMenu();
  });
}

function paintOrb(el, color, letter) {
  if (!el) return;
  if (el.style.background) el.style.background = "";
  applyBotColor(el, color || NOUS.neutral);
  const glyph = el.querySelector?.(".orb-glyph");
  if (glyph && letter !== undefined) {
    if (glyph.textContent !== letter) glyph.textContent = letter;
  } else if (letter !== undefined && !glyph && el.textContent !== letter) {
    el.textContent = letter;
  }
}

function isTextField(el) {
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA");
}

function settingsOpen() {
  const shell = shellFor("settings");
  if (!shell || shell.classList.contains("is-collapsing")) return false;
  return shell.dataset.state === "panel" || shell.dataset.opening === "panel";
}

function currentLatchedIds() {
  const active = document.activeElement;
  return latchedElementIds({
    windowFocused: state.windowFocused,
    textFocused: isTextField(active),
    textInSettings: !!(active && active.closest && active.closest("#settings")),
    settingsOpen: settingsOpen(),
    pointerHitId: state.pointerHitId,
    slashOpen: slashPopupOpen(),
  });
}

function syncLatch() {
  const ids = currentLatchedIds();
  state.latchedIds = ids;
  if (inTauri()) {
    import("@tauri-apps/api/core")
      .then(({ invoke }) => invoke("set_interaction_latch", { ids }))
      .catch(() => {});
    return;
  }
  paintLocalProximity();
}

const CLOSE_PAD_PX = 36;
/** The v50 miss was ~15px below the published edge. Cover the button and that slack. */
const BOTTOM_HIT_SLACK = 32;

function hitBoxText(box) {
  if (!box || box.width < 1 || box.height < 1) return "-";
  return `${Math.round(box.x)},${Math.round(box.y)},${Math.round(box.width)}x${Math.round(box.height)}`;
}

/** Bottom footer border box. The header is the last flex item. */
function bottomFooterBox(shell) {
  if (shell?.dataset.header !== "bottom") return null;
  const header = shell.querySelector(".center-panel > .panel-header, .settings-head");
  if (!header || header.hidden || header.closest("[hidden]")) return null;
  const box = header.getBoundingClientRect();
  if (box.width < 1 || box.height < 1) return null;
  return box;
}

function bottomCloseButton(shell) {
  return shell?.querySelector?.(".panel-header [data-role='close'], .settings-head [data-role='close']") || null;
}

/** Bottom slot. A box measured while the header is still the top row sits in
 *  the upper half of the shell; the painted footer is the bottom 44px. */
function bottomHitFloor(shell) {
  if (shell?.dataset.header !== "bottom") return null;
  const host = shell.getBoundingClientRect();
  if (host.width < 1 || host.height < 1) return null;
  const foot = bottomFooterBox(shell);
  const buttonEl = bottomCloseButton(shell);
  const button = buttonEl?.getBoundingClientRect();
  const buttonOk = button && button.height >= 1 && button.width >= 1;
  const footOk = !!foot;
  const centerY = buttonOk
    ? button.y + button.height / 2
    : footOk
      ? foot.y + foot.height / 2
      : host.bottom;
  const upper = centerY < host.y + host.height * 0.5;
  const measured = Math.max(host.bottom, footOk ? foot.bottom : 0, buttonOk ? button.bottom : 0);
  // The settings form used to lay the header out ~500px below the shell.
  // Treating that as the footer stretched the hit to 1236px (R-CT-01).
  const runaway = measured > host.bottom + BOTTOM_HIT_SLACK + 48;
  return {
    host,
    foot: footOk ? foot : null,
    button: buttonOk ? button : null,
    upper,
    runaway,
    bottom: (upper || runaway) ? host.bottom + BOTTOM_HIT_SLACK : measured + BOTTOM_HIT_SLACK,
  };
}

/** Pull the panel hit down over a bottom footer that paints past the shell. */
function coverBottomFooter(rect, shell) {
  const slot = bottomHitFloor(shell);
  if (!slot || !rect) return rect;
  const bottom = Math.max(rect.y + rect.h, slot.bottom);
  rect.h = bottom - rect.y;
  return rect;
}

/** Header disc of an open bot panel. Published as `bot:<id>` so the Ctrl-held
 *  input shape can keep it after `panel:` and `close:` drop out. z stays
 *  under the panel, so an unheld click still belongs to the panel. */
function dockedPanelOrb(shell, level = 1) {
  if (!shell || shell.dataset.kind !== "bot") return null;
  const id = shell.dataset.botId || "";
  if (!id) return null;
  const button = shell.querySelector(".morph-orb")?.getBoundingClientRect();
  let box = null;
  if (button && button.width >= 1 && button.height >= 1) {
    box = { x: button.x, y: button.y, w: button.width, h: button.height };
  } else {
    const host = shell.getBoundingClientRect();
    const ax = Number(shell.dataset.ax) || ORB / 2;
    const ay = Number(shell.dataset.ay) || ORB / 2;
    box = { x: host.x + ax - ORB / 2, y: host.y + ay - ORB / 2, w: ORB, h: ORB };
  }
  if (!box || box.w < 1 || box.h < 1) return null;
  return {
    id: `bot:${id}`,
    x: box.x,
    y: box.y,
    w: box.w,
    h: box.h,
    z: level - 1,
    round: true,
  };
}

function pushCloseHit(rects, shell, level) {
  const close = shell.querySelector("[data-hit-id^='close:']");
  if (!close || close.hidden || close.closest("[hidden]")) return;
  const box = close.getBoundingClientRect();
  if (box.width < 1 || box.height < 1) return;
  let y = box.y;
  let h = box.height;
  if (shell.dataset.header === "bottom") {
    const slot = bottomHitFloor(shell);
    if (slot?.upper || slot?.runaway) {
      const row = 44;
      y = slot.host.bottom - row + Math.max(0, (row - box.height) / 2);
    }
    const footBottom = Math.max(y + h, slot?.bottom || y + h);
    h = footBottom - y;
    debugLog(
      "hit-close",
      `when=push header=bottom upper=${slot?.upper ? 1 : 0} shell=${hitBoxText(slot?.host)} foot=${hitBoxText(slot?.foot)} button=${hitBoxText(slot?.button || box)} hit=${Math.round(box.x - CLOSE_PAD_PX)},${Math.round(y - CLOSE_PAD_PX)},${Math.round(box.width + CLOSE_PAD_PX * 2)}x${Math.round(h + CLOSE_PAD_PX * 2)}`,
    );
  }
  rects.push({
    id: close.dataset.hitId,
    x: box.x - CLOSE_PAD_PX,
    y: y - CLOSE_PAD_PX,
    w: box.width + CLOSE_PAD_PX * 2,
    h: h + CLOSE_PAD_PX * 2,
    z: level + 40,
    round: false,
  });
}

function orbNameChip(id) {
  const host = document.getElementById("orb-names");
  if (!host || !id) return null;
  for (const node of host.children) {
    if (node.dataset.orbId === id) return node;
  }
  return null;
}

function orbNameHitBox(id) {
  if (!state.showBotNames || state.modifierHeld !== true) return null;
  const el = orbNameChip(id);
  if (!el || el.hidden) return null;
  const box = el.getBoundingClientRect();
  if (box.width < 1 || box.height < 1) return null;
  return { x: box.x, y: box.y, w: box.width, h: box.height };
}

function openCoverBoxes() {
  const rects = [];
  const push = (node) => {
    if (!node || node.hidden || node.closest?.("[hidden]")) return;
    if (node.classList?.contains("is-plan-parked")) return;
    const box = node.getBoundingClientRect();
    if (box.width < 1 || box.height < 1) return;
    rects.push({ x: box.x, y: box.y, w: box.width, h: box.height });
  };
  document.querySelectorAll(".morph[data-state='panel']").forEach((shell) => {
    push(shell);
    if (shell._planHost) push(shell._planHost);
  });
  document.querySelectorAll(".plan-hit-host").forEach(push);
  return rects;
}

function discBox(shell) {
  const btn = shell.querySelector?.(".morph-orb");
  const box = btn?.getBoundingClientRect?.();
  if (box && box.width >= 1 && box.height >= 1) {
    return { x: box.x, y: box.y, w: box.width, h: box.height };
  }
  const host = shell.getBoundingClientRect();
  return { x: host.x, y: host.y, w: host.width, h: host.height };
}

function collectHits() {
  const rects = [];
  const coverBoxes = openCoverBoxes();
  const push = (id, el, z = 0, round = false) => {
    // [hidden] drops the rect even before layout. display:none makes the box empty too.
    if (!el || el.hidden || el.closest("[hidden]")) return;
    if (id && id === state.dragHitId) {
      rects.push({
        id,
        x: 0,
        y: 0,
        w: window.innerWidth,
        h: window.innerHeight,
        z: 1000,
        round: false,
      });
      return;
    }
    const box = el.getBoundingClientRect();
    if (box.width < 1 || box.height < 1) return;
    rects.push({ id, x: box.x, y: box.y, w: box.width, h: box.height, z, round });
  };
  document.querySelectorAll(".morph").forEach((shell) => {
    const id = shell.dataset.hitId;
    if (!id) return;
    const z = Number.parseInt(shell.style.zIndex, 10);
    const level = Number.isFinite(z)
      ? z
      : shell.dataset.state === "pill"
        ? 40
        : shell.dataset.state === "panel"
          ? 1
          : 0;
    if (shell.dataset.state === "orb") {
      // Fade and name plates follow this flag. The OS rect below stays
      // published so Ctrl+click still opens an orb under a panel (R-CT-02).
      if (orbCoveredBy(discBox(shell), coverBoxes)) shell.dataset.orbCovered = "1";
      else delete shell.dataset.orbCovered;
    } else {
      delete shell.dataset.orbCovered;
    }
    if (id === state.dragHitId) {
      rects.push({
        id,
        x: 0,
        y: 0,
        w: window.innerWidth,
        h: window.innerHeight,
        z: 1000,
        round: false,
      });
    } else if (shell.classList.contains("is-collapsing")) {
      // State is still "panel" until the clip ends. Publishing that box
      // puts the closing card, and its old close button, back in the list.
      const host = shell.getBoundingClientRect();
      const ax = Number(shell.dataset.ax) || ORB / 2;
      const ay = Number(shell.dataset.ay) || ORB / 2;
      rects.push({
        id: hitFor(shell.dataset.botId, "orb"),
        x: host.x + ax - ORB / 2,
        y: host.y + ay - ORB / 2,
        w: ORB,
        h: ORB,
        z: 0,
        round: true,
      });
    } else if (shell.dataset.rehearsal === "1" && shell._rehearsalHit) {
      const hit = shell._rehearsalHit;
      rects.push({
        id,
        x: hit.x,
        y: hit.y,
        w: hit.w,
        h: hit.h,
        z: 0,
        round: true,
      });
    } else {
      let box = visibleBox(shell);
      // An orb's layout box is the full card; the clip is the disc. Only a
      // closed plan leaves a negative inset, and that spills visibleBox
      // over the empty pane (R-CT-01). Pull that panel back to its card.
      if (shell.dataset.state === "panel" && shell.dataset.planOpen !== "1") {
        const laid = layoutBox(shell);
        const spilled = laid && (
          box.x < laid.x - 0.5
          || box.y < laid.y - 0.5
          || box.w > laid.w + 1
          || box.h > laid.h + 1
        );
        if (spilled) box = laid;
      }
      if (box.w < 1 || box.h < 1) return;
      const rect = {
        id,
        x: box.x,
        y: box.y,
        w: box.w,
        h: box.h,
        z: level,
        round: shell.dataset.state === "orb",
      };
      if (shell.dataset.state === "orb") {
        const button = shell.querySelector(".morph-orb")?.getBoundingClientRect();
        const disc = button && button.width >= 1 && button.height >= 1
          ? { x: button.x, y: button.y, w: button.width, h: button.height }
          : null;
        const circle = orbDiscHit(box, disc);
        const label = state.showBotNames && state.modifierHeld
          ? orbNameHitBox(shell.dataset.botId)
          : null;
        const hit = orbHitRect(circle, label, !!label);
        rect.x = hit.x;
        rect.y = hit.y;
        rect.w = hit.w;
        rect.h = hit.h;
        if (label) rect.round = false;
      }
      const plan = planNode(shell);
      const seam = shell.classList.contains("is-plan-seam");
      const planVisible = plan
        && !plan.hidden
        && shell.dataset.planOpen === "1"
        && shell.dataset.state === "panel"
        && (seam || (!shell.classList.contains("is-morphing") && !shell.classList.contains("is-collapsing")));
      if (planVisible) {
        // scaleX changes the border box. The hit rect is the layout width,
        // published once before the seam so GDK does not reshape every frame.
        const cached = Number(shell.dataset.planWidth);
        const width = seam
          ? (cached >= 1 ? cached : planWidthPx())
          : (plan.offsetWidth || cached || planWidthPx());
        const host = shell.getBoundingClientRect();
        if (width >= 1 && host.height >= 1) {
          const fitted = fittedPlanPane(host, width);
          const hosted = shell._planHost?.getBoundingClientRect?.();
          const pane = hosted && hosted.width >= 1 && hosted.height >= 1
            ? { x: hosted.x, y: hosted.y, w: hosted.width, h: hosted.height }
            : { x: fitted.x, y: fitted.y, w: fitted.w, h: fitted.h };
          const union = unionOpenPlanRect(rect, { open: true, ...pane });
          rect.x = union.x;
          rect.y = union.y;
          rect.w = union.w;
          rect.h = union.h;
        }
      }
      if (shell.dataset.state !== "orb") coverBottomFooter(rect, shell);
      rects.push(rect);
    }
    if (shell.dataset.state === "panel" && !shell.classList.contains("is-collapsing")) {
      const slash = role(shell, "slash");
      if (slash?.dataset.hitId) push(slash.dataset.hitId, slash, level + 20);
      pushCloseHit(rects, shell, level);
      const docked = dockedPanelOrb(shell, level);
      if (docked && !rects.some((item) => item.id === docked.id)) rects.push(docked);
    }
  });
  const banner = $("#conn-banner");
  if (banner?.dataset.hitId === "banner") push("banner", banner, 5);
  const menu = $("#orb-menu");
  if (menu && !menu.hidden) push("orb-menu", menu, 80);
  return rects;
}

let hitFrame = 0;
let lastHits = "";
let lastHitList = [];
let pointerButtons = 0;
const hitSilence = new Set();

/** One press. `at` is pointerdown. Capture lives on documentElement so a
 *  rehearsal that reparents the orb cannot split pointerdown from pointerup. */
const orbGesture = {
  pointerId: -1,
  orbId: "",
  at: 0,
  opened: false,
  ctrlAtDown: null,
  ctrlSample: null,
  rejected: false,
};

function pointerAge() {
  if (!orbGesture.at) return null;
  return performance.now() - orbGesture.at;
}

function rehearsalWaitReason() {
  const age = pointerAge();
  const stuck = age != null && age > 2000;
  return rehearsalDeferReason({
    pointerDown: pointerButtons > 0 && !stuck,
    sincePointerDown: age,
    planLive: !!document.querySelector(".morph.is-plan-seam, .morph.is-plan-arming"),
    morphLive: !!document.querySelector(".morph.is-morphing"),
  });
}

function noteRehearsalDefer(reason, profile = "") {
  const key = `${reason}|${profile}`;
  if (noteRehearsalDefer.last === key) return;
  noteRehearsalDefer.last = key;
  const detail = profile ? `defer profile=${profile} reason=${reason}` : `defer reason=${reason}`;
  debugLog("plan-rehearsal", detail);
}

function postponeOrbWork() {
  window.clearTimeout(postponeOrbWork.timer);
  const age = pointerAge();
  const remain = age == null ? 48 : Math.max(48, POINTER_QUIET_MS - age + 16);
  postponeOrbWork.timer = window.setTimeout(() => {
    postponeOrbWork.timer = 0;
    const wait = rehearsalWaitReason();
    if (wait) {
      noteRehearsalDefer(wait);
      postponeOrbWork();
      return;
    }
    noteRehearsalDefer.last = "";
    if (renderBots.pending) renderBots("pointer-release");
    schedulePlanRehearsal();
  }, remain);
}

function pointerTargetText(node) {
  if (!node || node.nodeType !== 1) return "none";
  const cls = typeof node.className === "string" ? node.className.trim().slice(0, 80) : "";
  return `${node.nodeName}${cls ? `.${cls.replace(/\s+/g, ".")}` : ""}`;
}

function orbIdFromEventTarget(node) {
  if (!node?.closest) return "";
  const chip = node.closest(".orb-name");
  if (chip?.dataset?.orbId && chip.dataset.hitCapture === "1") return chip.dataset.orbId;
  const stand = node.closest(".plan-rehearsal-stand");
  if (stand?.dataset?.botId) return stand.dataset.botId;
  const shell = node.closest(".morph");
  if (!shell) return "";
  const onOrb = !!node.closest(".morph-orb");
  const visual = shell.dataset.state || shell.dataset.visual || "";
  if (visual === "panel" && !onOrb) return "";
  if (visual !== "orb" && visual !== "pill" && shell.dataset.rehearsal !== "1") return "";
  return shell.dataset.botId || "";
}

function logPointer(phase, event, orbId, extra = "") {
  debugLog(
    "pointer",
    `phase=${phase} orb=${orbId || ""} target=${pointerTargetText(event.target)} button=${event.button ?? ""} frozen=${state.pressFrozen ? 1 : 0} latch=${state.latchedOrbId || ""}${extra}`,
  );
}

function orbClickAllowed(event) {
  if (state.interaction.supported === false) return true;
  return modifierHeld(event) || engagedModifier() || state.pressFrozen;
}

/** A fresh OS sample is in flight or said the modifier was up at pointerdown. */
function pageOpenBlocked() {
  if (state.interaction.supported === false) return false;
  if (orbGesture.rejected) return true;
  if (orbGesture.ctrlSample && orbGesture.ctrlAtDown !== true) return true;
  return false;
}

function sampleModifierDown(event, domId = "") {
  if (state.interaction.supported === false || !inTauri()) {
    orbGesture.ctrlAtDown = state.interaction.supported === false || !!(event && modifierHeld(event));
    orbGesture.ctrlSample = null;
    return Promise.resolve(orbGesture.ctrlAtDown === true);
  }
  // DOM ctrlKey is the state on this event. A later OS sample must not
  // clear it, and a latch from the hit check must not be cleared either.
  if (event && modifierHeld(event)) orbGesture.ctrlAtDown = true;
  else if (orbGesture.ctrlAtDown !== true) orbGesture.ctrlAtDown = null;
  const sample = import("@tauri-apps/api/core")
    .then(({ invoke }) => invoke("armed_press"))
    .then((armed) => {
      if (orbGesture.ctrlSample !== sample) return orbGesture.ctrlAtDown === true;
      const hitId = typeof armed === "string" ? armed : "";
      const bot = botIdFromHit(hitId);
      const under = event
        ? (orbShellAtPoint(event.clientX, event.clientY)?.shell?.dataset?.botId || "")
        : "";
      // An empty DOM id is the late click: the pill moved while the page was
      // busy. The hit-check id is still this press. A different live orb
      // does not inherit it.
      if (bot && (!domId || bot === domId || bot === under || bot === orbGesture.orbId)) {
        orbGesture.ctrlAtDown = true;
        if (!orbGesture.orbId) orbGesture.orbId = bot;
        if (event && orbGesture.pointerId < 0) orbGesture.pointerId = event.pointerId;
        return invoke("armed_press", { consume: true }).then(() => true);
      }
      if (orbGesture.ctrlAtDown === true) return true;
      return invoke("modifier_down_now").then((down) => {
        if (orbGesture.ctrlSample !== sample || orbGesture.ctrlAtDown === true) {
          return orbGesture.ctrlAtDown === true;
        }
        orbGesture.ctrlAtDown = down === true;
        return orbGesture.ctrlAtDown === true;
      });
    })
    .catch(() => {
      if (orbGesture.ctrlAtDown === true) return true;
      orbGesture.ctrlAtDown = false;
      return false;
    });
  orbGesture.ctrlSample = sample;
  return sample;
}

function orbOpenedThisPress() {
  const age = pointerAge();
  return orbGesture.opened && age != null && age < 800;
}

function rememberOrbOpen(id) {
  orbGesture.opened = true;
  orbGesture.orbId = id;
}

function openPressedOrb(id, fallback = "") {
  const primary = id && shellFor(id) ? id : "";
  const next = primary || (fallback && fallback !== id && shellFor(fallback) ? fallback : "");
  if (!next) return;
  // Ctrl-click is logged as an orb open. The shell click then bails on
  // orbOpenedThisPress, and selectBot misses a panel Ctrl is drawing as an orb.
  if (raisedPanelShell(next)) {
    if (!orbOpenedThisPress()) rememberOrbOpen(next);
    focusOpenPanel(next);
    return;
  }
  if (orbOpenedThisPress()) return;
  const shell = shellFor(next);
  rememberOrbOpen(next);
  abortPlanRehearsal(shell);
  activateHitShell(shell);
}

function abortLiveRehearsals() {
  document.querySelectorAll(".morph[data-rehearsal='1']").forEach((shell) => {
    abortPlanRehearsal(shell);
  });
}

function hitBlockReason() {
  if (document.querySelector(".morph.is-plan-seam, .morph.is-plan-arming")) return "plan-open";
  if (hitSilence.size > 0) return "silence";
  if (collapseBusy() || collapseQuiet()) return "collapse";
  if (motionFrozen()) return "motion";
  return "";
}

function orbShellAtPoint(x, y) {
  let best = null;
  let bestZ = -Infinity;
  document.querySelectorAll(".morph").forEach((shell) => {
    const visual = shell.dataset.visual || shell.dataset.state;
    if (visual !== "orb" && visual !== "pill") return;
    // A retracting pill is still the orb under the cursor. Skipping it
    // dropped the open, and the flag then stayed true (R-KB).
    const visible = visibleBox(shell);
    let box = visible;
    let named = false;
    if (shell.dataset.state === "orb" && box.w >= 1 && box.h >= 1) {
      const button = shell.querySelector(".morph-orb")?.getBoundingClientRect();
      const disc = button && button.width >= 1 && button.height >= 1
        ? { x: button.x, y: button.y, w: button.width, h: button.height }
        : null;
      box = orbDiscHit(box, disc);
      const label = orbNameHitBox(shell.dataset.botId);
      if (label) {
        box = orbHitRect(box, label, true);
        named = true;
      }
    }
    if (box.w < 1 || box.h < 1) {
      const host = shell.getBoundingClientRect();
      const ax = Number(shell.dataset.ax) || ORB / 2;
      const ay = Number(shell.dataset.ay) || ORB / 2;
      box = { x: host.x + ax - ORB / 2, y: host.y + ay - ORB / 2, w: ORB, h: ORB };
      named = false;
    }
    if (!pointInBox(x, y, box)) return;
    const level = shellHitLevel(shell);
    if (!best || level >= bestZ) {
      best = { shell, box, level, named };
      bestZ = level;
    }
  });
  return best;
}

function ctrlOrbRect() {
  if (state.interaction.supported === false || !engagedModifier()) return null;
  const hit = orbShellAtPoint(cursorPoint.x, cursorPoint.y);
  if (!hit) return null;
  const shell = hit.shell;
  return {
    id: shell.dataset.hitId || hitFor(shell.dataset.botId, shell.dataset.state),
    x: hit.box.x,
    y: hit.box.y,
    w: hit.box.w,
    h: hit.box.h,
    z: hit.level,
    round: shell.dataset.state === "orb" && !hit.named,
  };
}

function hitsBlocked() {
  return hitBlockReason() !== "";
}

function sendHitRects(rects, tag, force = false) {
  const held = state.interaction.supported !== false && engagedModifier();
  const guarded = guardPublishedHits({
    rects,
    previous: lastHitList,
    held,
    pointerDown: pointerButtons > 0,
    cursor: cursorPoint.x <= -9000 ? null : { x: cursorPoint.x, y: cursorPoint.y },
    orb: ctrlOrbRect(),
  });
  if (guarded.kept || (!guarded.rects.length && lastHits && lastHits !== "[]")) {
    debugLog("hit-flush", `tag=${tag} n=0 kept=1`);
    return Promise.resolve();
  }
  rects = guarded.rects;
  const key = JSON.stringify(
    rects.map((rect) => ({
      id: rect.id,
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      w: Math.round(rect.w),
      h: Math.round(rect.h),
      z: rect.z || 0,
      round: !!rect.round,
    })),
  );
  const same = key === lastHits;
  debugLog("hit-flush", `tag=${tag} n=${rects.length} same=${same ? 1 : 0} ctrl=${held ? 1 : 0}`);
  if (same && !force) return Promise.resolve();
  lastHits = key;
  lastHitList = rects.map((rect) => ({ ...rect }));
  debugLog("hit-ipc", `cmd=set_hit_rects tag=${tag} n=${rects.length}`);
  if (inTauri()) {
    return import("@tauri-apps/api/core")
      .then(({ invoke }) => invoke("set_hit_rects", { rects }))
      .catch(() => {});
  }
  paintLocalProximity(rects);
  return Promise.resolve();
}

function publishHits(tag = "publish", force = false) {
  const blocked = hitBlockReason();
  if (blocked) {
    if (!hitDeferLogged) {
      hitDeferLogged = true;
      debugLog("hit-flush-defer", `tag=${tag} reason=${blocked}`);
    }
    return Promise.resolve();
  }
  hitDeferLogged = false;
  return sendHitRects(collectHits(), tag, force);
}

/** Final geometry, announced once before the clip. Later frames must not
 *  send another input shape until the freeze or the collapse quiet ends. */
/** 睇計劃 sets planRepublish after × dropped the union. The first open
 *  already announced it, so this stays quiet unless that flag is set. */
function releaseReopenedPlan(shell) {
  if (!shell || shell.dataset.planRepublish !== "1") return;
  delete shell.dataset.planRepublish;
  const plan = planNode(shell);
  if (plan && (plan._seamPhase || plan.dataset.seam || "") !== "grown") {
    setSeamPhase(plan, "grown", { dom: false });
    hostOpenPlan(shell);
    logPlanHitBox(shell);
  }
  announcePanelHits(shell);
}

function logPlanHitBox(shell) {
  const plan = planNode(shell);
  if (!shell || !plan || shell.dataset.planOpen !== "1") return;
  const box = plan.getBoundingClientRect();
  if (box.width < 1 || box.height < 1) return;
  debugLog(
    "plan-rect",
    `bot=${shell.dataset.botId || ""} open=1 x=${Math.round(box.x)} y=${Math.round(box.y)} w=${Math.round(box.width)} h=${Math.round(box.height)}`,
  );
  const close = plan.querySelector("[data-role='plan-close']");
  const button = close?.getBoundingClientRect();
  const x = button && button.width >= 1 ? button.x + button.width / 2 : box.right - 16;
  const y = button && button.height >= 1 ? button.y + button.height / 2 : box.y + 16;
  debugLog(
    "plan-close-at",
    `bot=${shell.dataset.botId || ""} x=${Math.round(x)} y=${Math.round(y)}`,
  );
}

/** Replace this panel's published rect with the shell box. The plan is
 *  already hidden. Silence from the open announce must not keep the union. */
function retractPlanHit(shell) {
  if (!shell) return;
  hitSilence.delete(shell);
  const id = shell.dataset.hitId || hitFor(shell.dataset.botId, shell.dataset.state || "panel");
  const host = shell.getBoundingClientRect();
  const rect = {
    id,
    x: host.x,
    y: host.y,
    w: host.width,
    h: host.height,
    z: 1,
    round: false,
  };
  coverBottomFooter(rect, shell);
  const closeId = `close:${shell.dataset.botId || ""}`;
  const source = lastHitList.length ? lastHitList.map((item) => ({ ...item })) : collectHits();
  const keep = source.filter((item) => item.id !== id && item.id !== closeId);
  keep.push(rect);
  sendHitRects(keep, "plan-close", true);
  debugLog(
    "plan-hit-drop",
    `bot=${shell.dataset.botId || ""} x=${Math.round(rect.x)} y=${Math.round(rect.y)} w=${Math.round(rect.w)} h=${Math.round(rect.h)}`,
  );
}

/** A right-docked plan's 預覽/原文 row covers kanban 關閉 on a 1024px screen.
 *  Shift the button until its whole box is outside those controls. A click
 *  with no overlap leaves the button where the header put it. */
function seatKanbanClose() {
  const shell = shellFor("kanban");
  const button = document.getElementById("btn-kanban-close");
  if (!shell || !button) return;
  const open = shell.dataset.state === "panel"
    || shell.dataset.opening === "panel"
    || shell.dataset.visual === "panel";
  if (!open) {
    button.style.removeProperty("transform");
    return;
  }
  button.style.removeProperty("transform");
  const box = button.getBoundingClientRect();
  if (box.width < 1 || box.height < 1) return;
  const blockers = [];
  document.querySelectorAll("[data-role='plan-preview-mode'], [data-role='plan-source-mode'], [data-role='plan-close']").forEach((node) => {
    if (node.closest("[hidden]")) return;
    const rect = node.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;
    blockers.push({ x: rect.left, y: rect.top, w: rect.width, h: rect.height });
  });
  const nudge = closeNudge(
    { x: box.left, y: box.top, w: box.width, h: box.height },
    blockers,
  );
  if (nudge.dx || nudge.dy) button.style.transform = `translate(${nudge.dx}px, ${nudge.dy}px)`;
}

function announcePanelHits(shell) {
  seatKanbanClose();
  const id = hitFor(shell.dataset.botId, "panel");
  const host = shell.getBoundingClientRect();
  const rect = {
    id,
    x: host.x,
    y: host.y,
    w: host.width,
    h: host.height,
    z: 1,
    round: false,
  };
  if (shell.dataset.planOpen === "1" && host.width >= 1) {
    const width = Number(shell.dataset.planWidth) || planWidthPx();
    const fitted = fittedPlanPane(host, width);
    const union = unionOpenPlanRect(rect, {
      open: true,
      x: fitted.x,
      y: fitted.y,
      w: fitted.w,
      h: fitted.h,
    });
    rect.x = union.x;
    rect.y = union.y;
    rect.w = union.w;
    rect.h = union.h;
  }
  coverBottomFooter(rect, shell);
  const closeId = `close:${shell.dataset.botId || ""}`;
  const docked = dockedPanelOrb(shell);
  const keep = collectHits().filter((item) => item.id !== shell.dataset.hitId && item.id !== id && item.id !== closeId && item.id !== docked?.id);
  if (docked) keep.push(docked);
  keep.push(rect);
  // No close: rect in this frozen set. The button sits inside the panel rect,
  // so it clicks when Ctrl is up and passes through while Ctrl is held.
  // v50 published close: here and the silence window captured Ctrl+click.
  hitSilence.add(shell);
  pauseHitSync();
  sendHitRects(keep, "announce-panel");
  debugLog("hit-announce", `bot=${shell.dataset.botId || ""} mode=panel`);
  // The frozen announce omits close:. A covering plan seam can block the
  // next flush, so the button's own box is logged for the click-through test.
  const closeEl = shell.querySelector("[data-hit-id^='close:']");
  const closeBox = closeEl?.getBoundingClientRect?.();
  if (closeBox && closeBox.width >= 1 && closeBox.height >= 1) {
    debugLog(
      "panel-close-at",
      `bot=${shell.dataset.botId || ""} x=${Math.round(closeBox.x)} y=${Math.round(closeBox.y)} w=${Math.round(closeBox.width)} h=${Math.round(closeBox.height)}`,
    );
  }
  if (shell.dataset.header === "bottom") {
    const slot = bottomHitFloor(shell);
    debugLog(
      "hit-close",
      `when=announce header=bottom upper=${slot?.upper ? 1 : 0} shell=${hitBoxText(slot?.host)} foot=${hitBoxText(slot?.foot)} button=${hitBoxText(slot?.button)} panel=${Math.round(rect.x)},${Math.round(rect.y)},${Math.round(rect.w)}x${Math.round(rect.h)} close=omitted`,
    );
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (!shell.isConnected) return;
      const later = bottomHitFloor(shell);
      debugLog(
        "hit-close",
        `when=later header=bottom upper=${later?.upper ? 1 : 0} shell=${hitBoxText(later?.host)} foot=${hitBoxText(later?.foot)} button=${hitBoxText(later?.button)}`,
      );
    }));
  }
}

function announceOrbHits(shell) {
  const id = hitFor(shell.dataset.botId, "orb");
  const host = shell.getBoundingClientRect();
  const ax = Number(shell.dataset.ax) || ORB / 2;
  const ay = Number(shell.dataset.ay) || ORB / 2;
  const rect = {
    id,
    x: host.x + ax - ORB / 2,
    y: host.y + ay - ORB / 2,
    w: ORB,
    h: ORB,
    z: 0,
    round: true,
  };
  const closeId = `close:${shell.dataset.botId || ""}`;
  const keep = collectHits().filter((item) => item.id !== shell.dataset.hitId && item.id !== id && item.id !== closeId);
  keep.push(rect);
  hitSilence.add(shell);
  pauseHitSync();
  sendHitRects(keep, "announce-orb");
  debugLog("hit-announce", `bot=${shell.dataset.botId || ""} mode=orb`);
}

function releaseHitSilence(tag) {
  for (const shell of [...hitSilence]) {
    if (!shell.isConnected) {
      hitSilence.delete(shell);
      continue;
    }
    if (shellFrozen(shell)
      || shell.classList.contains("is-morphing")
      || shell.classList.contains("is-collapsing")
      || shell.classList.contains("is-plan-seam")
      || shell.classList.contains("is-plan-arming")) continue;
    hitSilence.delete(shell);
  }
  if (!hitsBlocked()) scheduleHitSync(tag);
}

let collapseHold = 0;

function collapseBusy() {
  return collapseHold > 0 || !!document.querySelector(".morph.is-collapsing");
}

function armPresentationFlush() {
  if (armPresentationFlush.armed) return;
  armPresentationFlush.armed = true;
  const tick = () => {
    if (backgroundBlocked()) {
      armPresentationFlush.timer = window.setTimeout(tick, 48);
      return;
    }
    armPresentationFlush.armed = false;
    armPresentationFlush.timer = 0;
    releaseDeferredTicks();
  };
  armPresentationFlush.timer = window.setTimeout(tick, 48);
}

function flushIdleChats() {
  document.querySelectorAll(".morph").forEach((shell) => {
    if (shell.dataset.chatDirty !== "1" && shell.dataset.planDirty !== "1") return;
    flushDeferredChat(shell);
  });
}

function releaseDeferredTicks() {
  if (backgroundBlocked()) {
    armPresentationFlush();
    return;
  }
  if (state.prefetchDeferred) {
    state.prefetchDeferred = false;
    prefetchBotChats();
  }
  if (state.refreshDeferred) {
    state.refreshDeferred = false;
    debugLog("refresh-tick-release", "chat");
    refreshBotChats();
  }
  if (state.kanbanPending) {
    const board = state.kanbanPending;
    state.kanbanPending = null;
    commitKanban(board);
  } else if (state.kanbanDeferred) {
    state.kanbanDeferred = false;
    refreshKanban();
  }
  if (backgroundBlocked()) {
    armPresentationFlush();
    return;
  }
  if (state.kanbanPaintDue) {
    const board = state.kanbanPaintDue;
    state.kanbanPaintDue = null;
    paintKanban(board);
  }
  if (state.cronDeferred) {
    state.cronDeferred = false;
    refreshCron();
  }
  if (pendingHistory.size) {
    for (const [id, job] of [...pendingHistory]) {
      if (job.token !== state.reconnectToken) {
        pendingHistory.delete(id);
        continue;
      }
      if (backgroundBlocked()) {
        armPresentationFlush();
        return;
      }
      pendingHistory.delete(id);
      applyOpened(id, job.opened);
    }
  }
  if (renderBots.pending) renderBots("after-collapse");
  releaseHitSilence("after-collapse");
  flushIdleChats();
}

let collapseQuietUntil = 0;
let collapseReleaseTimer = 0;

function collapseQuiet() {
  return performance.now() < collapseQuietUntil;
}

function holdCollapseGate(shell) {
  if (!shell || shell._collapseGate) return;
  shell._collapseGate = 1;
  collapseHold += 1;
  window.clearTimeout(collapseReleaseTimer);
  collapseReleaseTimer = 0;
}

function releaseCollapseGate(shell) {
  if (!shell?._collapseGate) return;
  shell._collapseGate = 0;
  collapseHold = Math.max(0, collapseHold - 1);
  if (collapseHold > 0) return;
  // A flush two frames after the panel is gone repaints the edge and
  // stretches the measured close. Hold ticks past one second, then let
  // unchanged refreshes return without touching the DOM.
  collapseQuietUntil = performance.now() + 1100;
  window.clearTimeout(collapseReleaseTimer);
  collapseReleaseTimer = window.setTimeout(() => {
    collapseReleaseTimer = 0;
    if (collapseBusy()) return;
    collapseQuietUntil = 0;
    debugLog(
      "collapse-release",
      `bots=${renderBots.pending ? 1 : 0} refresh=${state.refreshDeferred ? 1 : 0} kanban=${state.kanbanDeferred || state.kanbanPending ? 1 : 0} cron=${state.cronDeferred ? 1 : 0}`,
    );
    releaseDeferredTicks();
  }, 1100);
}

let hitDeferLogged = false;

function noteOrbCover() {
  const covers = openCoverBoxes();
  let running = false;
  document.querySelectorAll('.morph[data-state="orb"]').forEach((el) => {
    const covered = orbCoveredBy(discBox(el), covers);
    const was = el.dataset.orbCovered === "1";
    if (covered) el.dataset.orbCovered = "1";
    else delete el.dataset.orbCovered;
    if (covered === was) return;
    const live = el.classList.contains("is-cron-live");
    if (!covered && live) {
      delete el.dataset.orbFade;
      orbFadeClocks.delete(el);
      if (el.style.opacity) el.style.removeProperty("opacity");
      if (el.style.getPropertyValue("--hit-opacity")) el.style.removeProperty("--hit-opacity");
      return;
    }
    const aim = covered ? 0 : Number(el.dataset.orbAim || 1);
    const stepped = applyOrbFadeFrame(
      el,
      orbFadeClocks.get(el) || null,
      performance.now(),
      aim,
      reducedMotion() ? 1 : ORB_FADE_MS,
      readOrbOpacity(el),
    );
    orbFadeClocks.set(el, stepped.clock);
    if (stepped.running) running = true;
  });
  if (running) scheduleOrbFade();
  paintOrbNames();
}

function scheduleHitSync(tag = "schedule") {
  placeKeyBanner();
  noteOrbCover();
  const blocked = hitBlockReason();
  if (blocked) {
    if (!hitDeferLogged) {
      hitDeferLogged = true;
      debugLog("hit-flush-defer", `tag=${tag} reason=${blocked}`);
    }
    return;
  }
  hitDeferLogged = false;
  cancelAnimationFrame(hitFrame);
  hitFrame = requestAnimationFrame(() => publishHits(tag));
}

function pauseHitSync() {
  cancelAnimationFrame(hitFrame);
  hitFrame = 0;
}

function flushHits(tag = "flush") {
  const blocked = hitBlockReason();
  if (blocked) {
    debugLog("hit-flush-defer", `tag=${tag} reason=${blocked}`);
    return;
  }
  cancelAnimationFrame(hitFrame);
  publishHits(tag);
}

function modifierKeyName() {
  const kind = state.interaction?.modifier || "ctrl";
  if (kind === "shift") return "Shift";
  if (kind === "alt") return "Alt";
  return "Control";
}

function paintLayerOpacity(el, next) {
  if (!el) return false;
  // Drop a stale custom property in the same write as the inline value.
  // Leaving it lets one later frame paint the floor after the key is up.
  let changed = false;
  if (el.style.getPropertyValue("--hit-opacity")) {
    el.style.removeProperty("--hit-opacity");
    changed = true;
  }
  if (el.style.opacity !== next) {
    el.style.opacity = next;
    changed = true;
  }
  return changed;
}

function modifierVisuallyDown(down = state.osModifierDown) {
  return down === true || state.heldKeys?.has(modifierKeyName()) === true;
}

/** Settled panel. The OS flag, the DOM key, or one fresh sample. */
function paintOpenedHeldLook() {
  // Physical Ctrl is not the wash. A chord in the first 100ms must stay solid.
  paintHeldPanels(state.modifierHeld === true);
}

function paintHeldPanels(down) {
  const floor = Number(state.interaction?.minOpacity);
  const next = down ? String(Number.isFinite(floor) ? floor : 0.25) : "1";
  const panels = document.querySelectorAll('.morph[data-state="panel"]');
  panels.forEach((shell) => {
    // Inline opacity on the shell. The plan stays at 1 so the two layers
    // do not multiply. A custom property here restyles the whole tree.
    // will-change stays in CSS: writing it here rebuilds the layer and
    // costs the frame the key was supposed to paint in.
    paintLayerOpacity(shell, next);
    const plan = planNode(shell);
    if (plan) paintLayerOpacity(plan, "1");
  });
  return panels.length;
}

function applyOpacityEdge(payload) {
  const seen = Date.now();
  if (!acceptModifier(payload)) return false;
  if (state.showBotNames) {
    paintOrbNames();
    scheduleHitSync("orb-names");
  }
  const panels = paintHeldPanels(state.modifierHeld === true);
  renderCronOrb({ force: true });
  const unix = Date.now();
  const seq = Number(payload?.modifier_seq) || 0;
  debugLog("opacity-stage", `stage=js seq=${seq} rust=${Number(payload?.unix) || 0} seen=${seen}`);
  debugLog("opacity-stage", `stage=write unix=${unix} panels=${panels}`);
  debugLog("opacity-write", `unix=${unix} down=${state.osModifierDown ? 1 : 0} panels=${panels}`);
  debugLog("key-edge", `down=${state.osModifierDown ? 1 : 0} panels=${panels}`);
  if (inTauri()) {
    const gen = Number(payload?.shape_gen) || 0;
    import("@tauri-apps/api/core")
      .then(({ invoke }) => invoke("note_opacity_written", { unix, gen }))
      .catch(() => {});
  }
  return true;
}

window.__hermesOpacityEdge = (edge) => applyOpacityEdge({
  key_edge: true,
  modifier_down: edge?.down === 1 || edge?.down === true,
  held: edge?.held === 1 || edge?.held === true,
  modifier_seq: Number(edge?.seq) || 0,
  unix: Number(edge?.unix) || 0,
  shape_gen: Number(edge?.gen) || 0,
});

let modifierSeq = 0;

function acceptModifier(payload) {
  const seq = Number(payload?.modifier_seq);
  if (Number.isFinite(seq) && seq > 0 && seq <= modifierSeq) return false;
  if (Number.isFinite(seq)) modifierSeq = seq;
  // The physical key is the panel look. `held` can still be true for one
  // poll after the key is up, and that one sample was a full-panel flash.
  if (payload?.modifier_down === true) state.osModifierDown = true;
  else if (payload?.modifier_down === false) state.osModifierDown = false;
  else if (payload?.held === true) state.osModifierDown = true;
  else if (payload?.held === false) state.osModifierDown = false;
  // Opacity follows the armed flag. modifier_down is the physical key and
  // is true for the whole Ctrl→C lead; painting from it flashes the panel.
  if (payload?.modifier_down === false && payload?.held !== true) {
    modifierArm.suppressed = false;
    modifierArm.at = null;
    state.modifierHeld = false;
  } else if (modifierArm.suppressed) {
    state.modifierHeld = false;
  } else if (payload?.held === true) state.modifierHeld = true;
  else if (payload?.held === false) state.modifierHeld = false;
  if (state.modifierHeld === true) document.documentElement.dataset.pass = "1";
  else delete document.documentElement.dataset.pass;
  return true;
}

const orbFadeClocks = new WeakMap();
let orbFadeFrame = 0;

function applyFrames(frames, interactiveAll = false) {
  const map = new Map((frames || []).map((item) => [item.id, item]));
  const covers = openCoverBoxes();
  document.querySelectorAll("[data-hit-id]").forEach((el) => {
    const known = map.get(el.dataset.hitId);
    const nested = !!el.parentElement?.closest?.("[data-hit-id]");
    const value = known == null || nested ? 1 : known.opacity;
    const nextOpacity = String(value);
    // A finished orb-idle fill is the dim already on screen. Cancelling it
    // when this frame does not know the orb would paint the lit fallback.
    el.getAnimations?.().forEach((anim) => {
      if (anim.id !== "orb-idle" || anim.playState === "running") return;
      if (known == null && nextOpacity === "1") return;
      anim.cancel();
    });
    const panelShell = el.classList?.contains("morph") && el.dataset.state === "panel";
    const orbLike = el.classList?.contains("morph")
      && (el.dataset.state === "orb" || el.dataset.visual === "orb");
    const liveCron = orbLike && el.classList.contains("is-cron-live");
    const orbShell = orbLike && !el.classList.contains("is-cron-live");
    if (orbLike && el.dataset.state === "orb") {
      const covered = orbCoveredBy(discBox(el), covers);
      if (covered) el.dataset.orbCovered = "1";
      else delete el.dataset.orbCovered;
      el.dataset.orbAim = String(value);
    }
    if (liveCron && el.dataset.orbCovered !== "1") {
      // A running disc stays at the stylesheet's 1. Drop the fade number
      // so it cannot keep a near-cursor sample on screen.
      delete el.dataset.orbFade;
      orbFadeClocks.delete(el);
      if (el.style.opacity) el.style.removeProperty("opacity");
      if (el.style.getPropertyValue("--hit-opacity")) el.style.removeProperty("--hit-opacity");
    } else if (orbShell || liveCron) {
      // One sample of the scripted fade. Repeated polls of the same target
      // keep this clock. A settled target does not write again.
      // A panel that meets the disc plus its halo fades this orb to 0.
      const aim = el.dataset.orbCovered === "1" ? 0 : value;
      const stepped = applyOrbFadeFrame(
        el,
        orbFadeClocks.get(el) || null,
        performance.now(),
        aim,
        reducedMotion() ? 1 : ORB_FADE_MS,
        readOrbOpacity(el),
      );
      orbFadeClocks.set(el, stepped.clock);
      if (stepped.running) scheduleOrbFade();
    } else if (!panelShell && el.style.getPropertyValue("--hit-opacity") !== nextOpacity) {
      orbFadeClocks.delete(el);
      el.style.setProperty("--hit-opacity", nextOpacity);
    } else {
      orbFadeClocks.delete(el);
    }
    if (interactiveAll || known?.capture) el.dataset.hitCapture = "1";
    else delete el.dataset.hitCapture;
  });
  paintOrbLabel();
  paintOrbNames();
}

function onOrbFadeEnd(event) {
  if (!event || event.propertyName !== "opacity") return;
  const shell = event.target;
  if (!shell || shell.dataset?.state !== "orb") return;
  onOrbOpacityTransitionEnd(shell);
}

function paintOrbLabel() {
  const label = document.getElementById("orb-hover-label");
  if (!label) return;
  if (state.showBotNames) {
    label.hidden = true;
    label.textContent = "";
    return;
  }
  const shells = [...document.querySelectorAll('.morph[data-state="orb"][data-hit-capture]')]
    .filter((item) => item.dataset.botId !== "cron");
  let shell = shells.length === 1 ? shells[0] : null;
  if (shells.length > 1) {
    shell = shells.find((item) => {
      const box = visibleBox(item);
      return cursorPoint.x >= box.x - 12
        && cursorPoint.x <= box.x + box.w + 12
        && cursorPoint.y >= box.y - 12
        && cursorPoint.y <= box.y + box.h + 12;
    }) || null;
  }
  const name = shell?.querySelector(".morph-orb")?.getAttribute("aria-label") || "";
  if (!shell || !name) {
    label.hidden = true;
    label.textContent = "";
    return;
  }
  if (label.textContent !== name) label.textContent = name;
  label.hidden = false;
  const box = visibleBox(shell);
  const width = label.offsetWidth;
  const height = label.offsetHeight;
  let left = box.x + box.w / 2 - width / 2;
  let top = box.y + box.h + 6;
  if (top + height > window.innerHeight - 8) top = Math.max(8, box.y - height - 6);
  left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
  label.style.left = `${Math.round(left)}px`;
  label.style.top = `${Math.round(top)}px`;
}

function syncOrbNameFade() {
  if (!state.showBotNames) return;
  const host = document.getElementById("orb-names");
  if (!host) return;
  for (const label of host.children) {
    const shell = shellFor(label.dataset.orbId);
    if (!shell || shell.dataset.state !== "orb") {
      label.hidden = true;
      continue;
    }
    const covered = shell.dataset.orbCovered === "1";
    const next = shell.style.opacity || (covered ? "0.00" : "1");
    if (label.style.opacity !== next) label.style.opacity = next;
    const settled = covered && Number.parseFloat(next) <= 0.01;
    if (settled) label.hidden = true;
    if (state.modifierHeld === true && !covered) label.dataset.hitCapture = "1";
    else delete label.dataset.hitCapture;
  }
}

function paintOrbNames() {
  const host = document.getElementById("orb-names");
  if (!host) return;
  if (!state.showBotNames) {
    if (host.childElementCount) host.replaceChildren();
    return;
  }
  const orbs = [];
  const obstacles = [];
  document.querySelectorAll(".morph").forEach((shell) => {
    const box = shell.getBoundingClientRect();
    if (box.width < 1 || box.height < 1) return;
    if (shell.dataset.state === "panel") {
      obstacles.push({ x: box.x, y: box.y, w: box.width, h: box.height });
      return;
    }
    if (shell.dataset.state === "pill") {
      const vis = visibleBox(shell);
      if (vis.w >= 1 && vis.h >= 1) obstacles.push(vis);
      return;
    }
    if (shell.dataset.state !== "orb") return;
    const btn = shell.querySelector(".morph-orb");
    const name = (btn?.dataset.orbName || btn?.getAttribute("aria-label") || "").trim();
    const disc = btn?.getBoundingClientRect();
    if (!name || !disc || disc.width < 1 || disc.height < 1) return;
    orbs.push({
      id: shell.dataset.botId,
      name,
      x: disc.x,
      y: disc.y,
      w: disc.width,
      h: disc.height,
      shell,
    });
    obstacles.push({ x: disc.x, y: disc.y, w: disc.width, h: disc.height });
  });
  const banner = document.getElementById("conn-banner");
  if (banner && !banner.hidden) {
    const box = banner.getBoundingClientRect();
    if (box.width >= 1 && box.height >= 1) {
      obstacles.push({ x: box.x, y: box.y, w: box.width, h: box.height });
    }
  }
  const readout = document.getElementById("cron-readout");
  if (readout && !readout.hidden) {
    const box = readout.getBoundingClientRect();
    if (box.width >= 1 && box.height >= 1) {
      obstacles.push({ x: box.x, y: box.y, w: box.width, h: box.height });
    }
  }
  const placed = layoutOrbNames(orbs, obstacles, {
    width: window.innerWidth,
    height: window.innerHeight,
  });
  const byId = new Map(orbs.map((orb) => [orb.id, orb]));
  const keep = new Set(placed.map((item) => item.id));
  for (const node of [...host.children]) {
    if (!keep.has(node.dataset.orbId)) node.remove();
  }
  for (const item of placed) {
    let node = orbNameChip(item.id);
    if (!node) {
      node = document.createElement("span");
      node.className = "orb-name";
      node.dataset.orbId = item.id;
      host.appendChild(node);
    }
    applyOrbName(node, item.title);
    const shell = byId.get(item.id)?.shell;
    const centered = item.align !== "side";
    const place = item.place || (centered ? "below" : "right");
    let left = `${Math.round(item.x)}px`;
    let top = `${Math.round(item.y)}px`;
    let transform = "";
    if (place === "left") {
      left = `${Math.round(item.x + item.w)}px`;
      transform = "translateX(-100%)";
    } else if (place === "above") {
      left = `${Math.round(item.anchorX)}px`;
      top = `${Math.round(item.y + item.h)}px`;
      transform = "translate(-50%, -100%)";
    } else if (place === "below" || centered) {
      left = `${Math.round(item.anchorX)}px`;
      transform = "translateX(-50%)";
    }
    if (node.style.left !== left) node.style.left = left;
    if (node.style.top !== top) node.style.top = top;
    if (node.style.width) node.style.width = "";
    if (node.style.transform !== transform) node.style.transform = transform;
    const channels = shell?.style.getPropertyValue("--bot-rgb")?.trim();
    if (channels) node.style.setProperty("--bot-rgb", channels);
    const covered = shell?.dataset.orbCovered === "1";
    const opacity = shell?.style.opacity || (covered ? "0.00" : "1");
    if (node.style.opacity !== opacity) node.style.opacity = opacity;
    if (covered && Number.parseFloat(opacity) <= 0.01) node.hidden = true;
    if (state.modifierHeld === true && !covered) node.dataset.hitCapture = "1";
    else delete node.dataset.hitCapture;
  }
}

let showBotNamesWrite = 0;

async function setShowBotNames(enabled) {
  const value = !!enabled;
  state.showBotNames = value;
  if (state.settings) state.settings.show_bot_names = value;
  paintOrbLabel();
  paintOrbNames();
  scheduleHitSync("orb-names");
  if (!inTauri()) return;
  const generation = ++showBotNamesWrite;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const settings = await invoke("set_show_bot_names", { enabled: value });
    if (generation !== showBotNamesWrite || !settings) return;
    state.settings = settings;
    state.showBotNames = !!settings.show_bot_names;
    const box = $("#show-bot-names");
    if (box) box.checked = state.showBotNames;
    paintOrbNames();
  } catch (err) {
    if (generation !== showBotNamesWrite) return;
    setBanner(String(err), "error");
  }
}

function readOrbOpacity(el) {
  const inline = Number.parseFloat(el?.style?.opacity);
  if (Number.isFinite(inline)) return inline;
  const computed = Number.parseFloat(getComputedStyle(el).opacity);
  return Number.isFinite(computed) ? computed : 1;
}

function tickOrbFades() {
  orbFadeFrame = 0;
  const now = performance.now();
  const duration = reducedMotion() ? 1 : ORB_FADE_MS;
  let running = false;
  document.querySelectorAll('.morph[data-state="orb"][data-hit-id]').forEach((el) => {
    if (el.classList.contains("is-cron-live") && el.dataset.orbCovered !== "1") return;
    const clock = orbFadeClocks.get(el);
    if (!clock || clock.settled) return;
    const stepped = applyOrbFadeFrame(el, clock, now, clock.target, duration, readOrbOpacity(el));
    orbFadeClocks.set(el, stepped.clock);
    if (stepped.running) running = true;
  });
  syncOrbNameFade();
  if (running) scheduleOrbFade();
}

function scheduleOrbFade() {
  if (orbFadeFrame) return;
  orbFadeFrame = requestAnimationFrame(() => {
    tickOrbFades();
  });
}

const cursorPoint = { x: -10000, y: -10000 };
let blurReleaseTimer = 0;

function dismissModifierDropdown() {
  const select = $("#interaction-modifier");
  const action = applyDropdownDismiss(state);
  if (action.blur) select?.blur();
}

function finishInteractiveRelease() {
  window.clearTimeout(blurReleaseTimer);
  blurReleaseTimer = 0;
  const dropdownWasOpen = state.dropdownOpen;
  state.dropdownOpen = false;
  state.windowFocused = false;
  state.pointerHitId = "";
  state.heldKeys.clear();
  const active = document.activeElement;
  if (isTextField(active)) active.blur();
  if (dropdownWasOpen) dismissModifierDropdown();
  syncLatch();
}

function releaseInteractiveLock(source = "webview") {
  const action = focusLossAction({ source, dropdownOpen: state.dropdownOpen });
  if (action === "hold") {
    window.clearTimeout(blurReleaseTimer);
    blurReleaseTimer = 0;
    return;
  }
  if (action === "release") {
    finishInteractiveRelease();
    return;
  }
  window.clearTimeout(blurReleaseTimer);
  blurReleaseTimer = window.setTimeout(() => {
    blurReleaseTimer = 0;
    if (state.dropdownOpen) return;
    finishInteractiveRelease();
  }, BLUR_RELEASE_MS);
}

function noteWindowFocus() {
  window.clearTimeout(blurReleaseTimer);
  blurReleaseTimer = 0;
  state.dropdownOpen = nextDropdownOpen(state.dropdownOpen, "window-focus");
  state.windowFocused = true;
  syncLatch();
}

function openSettingsFromShortcut() {
  state.dropdownOpen = false;
  openSettings();
}

function applyOsFocus(owner) {
  const action = osFocusAction(owner);
  if (action === "release") {
    finishInteractiveRelease();
    return;
  }
  if (action === "hold" && state.dropdownOpen && !state.windowFocused) {
    state.windowFocused = true;
    syncLatch();
  }
}

function queryOsFocus() {
  if (!inTauri()) return Promise.resolve();
  return import("@tauri-apps/api/core")
    .then(({ invoke }) => invoke("focus_owner"))
    .then((owner) => {
      if (owner === "own") applyOsFocus(owner);
    })
    .catch(() => {});
}

const modifierArm = { at: null, suppressed: false, timer: 0 };

function noteChordKey() {
  modifierArm.suppressed = true;
  modifierArm.at = null;
  state.modifierHeld = false;
  window.clearTimeout(modifierArm.timer);
  paintHeldPanels(false);
  delete document.documentElement.dataset.pass;
}

function engagedModifier(now = performance.now()) {
  // Physical Ctrl is not enough. The wash waits out MODIFIER_ARM_MS, and any
  // other key cancels it. The OS `held` flag is what paints in Tauri.
  if (state.modifierHeld === true && !modifierArm.suppressed) return true;
  const next = modifierEngages({
    modifier: state.interaction.modifier,
    keys: [...state.heldKeys],
    now,
    armedAt: modifierArm.at,
    suppressed: modifierArm.suppressed,
  });
  modifierArm.at = next.armedAt;
  modifierArm.suppressed = next.suppressed;
  window.clearTimeout(modifierArm.timer);
  if (!next.held && next.armedAt != null) {
    modifierArm.timer = window.setTimeout(() => paintLocalProximity(), MODIFIER_ARM_MS - (now - next.armedAt));
  }
  return next.held;
}

function releaseOverlayFocus() {
  const active = document.activeElement;
  if (active && active !== document.body && typeof active.blur === "function") active.blur();
  state.heldKeys.clear();
  modifierArm.at = null;
  modifierArm.suppressed = false;
  window.clearTimeout(modifierArm.timer);
  modifierArm.timer = 0;
  if (!inTauri()) return;
  import("@tauri-apps/api/core")
    .then(({ invoke }) => invoke("release_overlay_focus"))
    .catch(() => {});
}

function paintLocalProximity(rects) {
  if (inTauri()) return;
  const list = rects || collectHits();
  const cfg = state.interaction;
  const held = engagedModifier();
  if (held) document.documentElement.dataset.pass = "1";
  else delete document.documentElement.dataset.pass;
  const frames = elementStates({
    held,
    latchedIds: state.latchedIds,
    cursor: { x: cursorPoint.x, y: cursorPoint.y },
    rects: list,
    fadeDistance: cfg.fadeDistance,
    minOpacity: cfg.minOpacity,
    fadeEnabled: cfg.fadeEnabled,
  });
  applyFrames(frames);
}

function setupProximity() {
  window.addEventListener("contextmenu", (event) => {
    const shell = event.target.closest?.(".morph");
    if (shell && shell.dataset.state === "orb" && modifierHeld(event)) return;
    event.preventDefault();
  });
  document.addEventListener("pointerdown", (event) => {
    const shell = event.target.closest?.(".morph") || event.target.closest?.(".plan-hit-host")?._planShell;
    if (shell && shell.dataset.state === "panel" && !shell.classList.contains("is-collapsing")) {
      const botId = shell.dataset.kind === "bot" ? shell.dataset.botId || "" : "";
      if (botId) focusOpenPanel(botId);
      else raisePanel(shell);
    }
    const hit = event.target.closest?.("[data-hit-id]");
    if (hit) state.pointerHitId = hit.dataset.hitId || "";
    else {
      state.pointerHitId = "";
      if (isTextField(document.activeElement)) document.activeElement.blur();
    }
    syncLatch();
  });
  document.addEventListener("pointerup", () => {
    state.pointerHitId = "";
    syncLatch();
  });
  document.addEventListener("focusin", () => syncLatch());
  document.addEventListener("focusout", () => setTimeout(syncLatch, 0));
  window.addEventListener("blur", () => {
    if (inTauri()) return;
    releaseInteractiveLock("webview");
  });
  window.addEventListener("focus", noteWindowFocus);
  window.addEventListener("resize", scheduleHitSync);
  const logCtrlEdge = (phase, ctrl) => {
    if (!document.querySelector(".morph[data-state='panel']")) return;
    debugLog("hit-ctrl", `phase=${phase} ctrl=${ctrl ? 1 : 0} published=${lastHits || "-"}`);
  };
  window.addEventListener("pointerdown", (event) => {
    pointerButtons += 1;
    orbGesture.at = performance.now();
    orbGesture.opened = false;
    orbGesture.rejected = false;
    orbGesture.ctrlAtDown = null;
    orbGesture.ctrlSample = null;
    const domId = orbIdFromEventTarget(event.target)
      || orbShellAtPoint(event.clientX, event.clientY)?.shell?.dataset?.botId
      || "";
    logPointer("down", event, domId);
    orbGesture.ctrlKey = modifierHeld(event);
    const capture = event.button === 0 && !!domId;
    if (event.button === 0) {
      if (capture) {
        orbGesture.pointerId = event.pointerId;
        orbGesture.orbId = domId;
      }
      // Always ask the hit-check latch. The shell may already have left
      // orb/pill, and the current Ctrl key is the wrong clock.
      sampleModifierDown(event, domId);
      if (capture) {
        try { document.documentElement.setPointerCapture(event.pointerId); } catch { /* already released */ }
      }
    } else {
      orbGesture.pointerId = -1;
      orbGesture.orbId = "";
    }
    abortLiveRehearsals();
    postponeOrbWork();
  }, true);
  window.addEventListener("pointerup", (event) => {
    pointerButtons = Math.max(0, pointerButtons - 1);
    const captured = orbGesture.pointerId === event.pointerId;
    const domId = orbIdFromEventTarget(event.target) || (captured ? orbGesture.orbId : "");
    const orbId = pressOrbId({
      domId,
      pressFrozen: state.pressFrozen,
      latchedHitId: state.latchedOrbId,
    });
    const gestureAt = orbGesture.at;
    const finishOpen = (ctrlAtDown) => {
      if (orbGesture.at !== gestureAt) return;
      const pressed = orbGesture.orbId || orbId;
      const open = orbOpenFromPress({
        supported: state.interaction.supported,
        button: event.button,
        captured: captured || orbGesture.pointerId === event.pointerId,
        orbId: pressed,
        ctrlAtDown: ctrlAtDown === true || orbGesture.ctrlAtDown === true,
        ctrlKey: orbGesture.ctrlKey === true,
      });
      if (!open && (captured || orbGesture.pointerId === event.pointerId)) orbGesture.rejected = true;
      logPointer("up", event, pressed, ` open=${open ? 1 : 0} down=${ctrlAtDown ? 1 : 0}`);
      try { document.documentElement.releasePointerCapture(event.pointerId); } catch { /* not captured */ }
      if (open) openPressedOrb(pressed, domId);
      orbGesture.pointerId = -1;
      orbGesture.ctrlSample = null;
      postponeOrbWork();
    };
    if (state.interaction.supported === false) finishOpen(true);
    else if (orbGesture.ctrlSample) orbGesture.ctrlSample.then((down) => finishOpen(down === true || orbGesture.ctrlAtDown === true));
    else finishOpen(orbGesture.ctrlAtDown === true);
  }, true);
  window.addEventListener("pointercancel", (event) => {
    pointerButtons = Math.max(0, pointerButtons - 1);
    logPointer("cancel", event, orbGesture.orbId);
    try { document.documentElement.releasePointerCapture(event.pointerId); } catch { /* not captured */ }
    orbGesture.pointerId = -1;
    postponeOrbWork();
  }, true);
  window.addEventListener("click", (event) => {
    logPointer("click", event, orbIdFromEventTarget(event.target));
  }, true);
  document.addEventListener("transitionend", onOrbFadeEnd);
  window.addEventListener("keydown", (event) => {
    if (inTauri()) return;
    if (event.repeat) return;
    const isMod = event.key === "Control" || event.key === "Shift" || event.key === "Alt";
    if (!isMod) {
      if (state.osModifierDown || state.modifierHeld || modifierArm.at != null || event.ctrlKey) {
        noteChordKey();
      }
      return;
    }
    state.heldKeys.add(event.key);
    logCtrlEdge("down", event.ctrlKey || event.key === "Control");
  });
  window.addEventListener("keyup", (event) => {
    if (inTauri()) return;
    if (event.key !== "Control" && event.key !== "Shift" && event.key !== "Alt") return;
    state.heldKeys.delete(event.key);
    if (event.key === modifierKeyName()) {
      modifierArm.suppressed = false;
      modifierArm.at = null;
      state.modifierHeld = false;
      paintHeldPanels(false);
      delete document.documentElement.dataset.pass;
    }
    logCtrlEdge("up", event.ctrlKey);
  });
  if (inTauri()) {
    import("@tauri-apps/api/window")
      .then(({ getCurrentWindow }) =>
        getCurrentWindow().onFocusChanged(({ payload: focused }) => {
          if (focused) noteWindowFocus();
          else releaseInteractiveLock("tauri-window");
        }),
      )
      .catch(() => {});
    import("@tauri-apps/api/event").then(({ listen }) => {
      listen("overlay-interaction", (event) => {
        const payload = event.payload || {};
        if (payload.supported === false) {
          state.interaction.supported = false;
          applyInteraction({ ...state.interaction, fade_enabled: state.interaction.fadeEnabled, supported: false });
          applyFrames([], true);
          return;
        }
        if (payload.key_edge === true) {
          applyOpacityEdge(payload);
          return;
        }
        if (payload.focus_owner) applyOsFocus(payload.focus_owner);
        const beforeModifier = state.osModifierDown;
        const freshModifier = acceptModifier(payload);
        if (typeof payload.latched_orb === "string") state.latchedOrbId = payload.latched_orb;
        state.pressFrozen = payload.press_frozen === true;
        applyFrames(payload.opacities || []);
        if (freshModifier && (beforeModifier !== state.osModifierDown || payload.held === true || payload.held === false)) {
          paintHeldPanels(state.modifierHeld === true);
          if (state.showBotNames) scheduleHitSync("orb-names");
        }
      });
    });
    window.addEventListener("mousemove", (event) => {
      cursorPoint.x = event.clientX;
      cursorPoint.y = event.clientY;
      paintOrbLabel();
      prefetchOrbUnderCursor();
    });
    return;
  }
  document.documentElement.classList.add("overlay-passthrough");
  window.addEventListener("mousemove", (event) => {
    cursorPoint.x = event.clientX;
    cursorPoint.y = event.clientY;
    paintLocalProximity();
    prefetchOrbUnderCursor();
  });
  window.addEventListener("keydown", (event) => {
    state.heldKeys.add(event.key);
    paintLocalProximity();
    prefetchOrbUnderCursor();
  });
  window.addEventListener("keyup", (event) => {
    state.heldKeys.delete(event.key);
    paintLocalProximity();
  });
  paintLocalProximity();
}

const watchdogs = new Map();

function cssEscape(value) {
  if (typeof CSS !== "undefined" && CSS.escape) return CSS.escape(value);
  return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}

function applyOrbMotion(btn, thread) {
  const motion = orbMotion(thread?.activity, thread?.statusState);
  btn?.classList.toggle("is-thinking", motion === "spin");
  btn?.classList.toggle("is-waiting", motion === "wait");
}

function syncActivityChrome(id = state.activeId) {
  const panel = panelFor(id);
  if (!panel) return;
  const activity = threadFor(id).activity;
  panel.classList.toggle("is-thinking", !!activity?.thinking);
  role(panel, "chat")?.classList.toggle("streaming", !!activity?.streaming);
}

function paintActivity(id) {
  const thread = threadFor(id);
  if (visualQuiet(shellFor(id))) return;
  const btn = document.querySelector(`.bot-btn[data-bot-id="${cssEscape(id)}"]`);
  applyOrbMotion(btn, thread);
  btn?.classList.toggle("has-unread", !!thread.unread);
  if (panelFor(id)) syncActivityChrome(id);
}

function clearUnread(id) {
  const thread = threadFor(id);
  if (!thread.unread) return;
  thread.unread = false;
  paintActivity(id);
}

function noteActivity(id, event) {
  const thread = threadFor(id);
  const step = reduceActivity(thread.activity, event, Date.now());
  thread.activity = step.state;
  if (event.type === "watchdog") {
    const next = statusAfterWatchdog(thread.status);
    if (next !== thread.status) {
      thread.status = next;
      if (panelFor(id)) setStatusText(id, next);
    }
  }
  if (step.unread) thread.unread = true;
  paintActivity(id);
  if (step.state.deadline) armWatchdog(id, step.state.deadline);
  else clearWatchdog(id);
  if (step.toast) showToast(id, step.toast);
  if (step.unread) pingOrb(id);
}

function armWatchdog(id, deadline) {
  clearWatchdog(id);
  const delay = Math.max(0, deadline - Date.now());
  const timer = window.setTimeout(() => noteActivity(id, { type: "watchdog" }), delay);
  watchdogs.set(id, timer);
}

function clearWatchdog(id) {
  const timer = watchdogs.get(id);
  if (timer) window.clearTimeout(timer);
  watchdogs.delete(id);
}

function pingOrb(id) {
  if (visualQuiet(shellFor(id))) return;
  const btn = document.querySelector(`.bot-btn[data-bot-id="${cssEscape(id)}"]`);
  if (!btn) return;
  btn.querySelector(".orb-ping")?.remove();
  const ping = document.createElement("span");
  ping.className = "orb-ping";
  btn.appendChild(ping);
}

function showToast(id, toast) {
  const shell = shellFor(id);
  if (!shell || previewBlocked({
    intent: shell.dataset.intent || "",
    collapsing: shell.classList.contains("is-collapsing"),
    opening: shell.dataset.opening || "",
    visual: shell.dataset.visual || "",
    state: shell.dataset.state || "",
  })) return;
  const preview = shell.querySelector("[data-role='preview']");
  const time = shell.querySelector("[data-role='preview-time']");
  if (preview) preview.textContent = toast.text || "";
  if (time) {
    const now = new Date();
    time.dateTime = now.toISOString();
    time.textContent = formatToastClock(now);
  }
  shell.querySelector(".morph-pill")?.classList.toggle("is-error", toast.kind === "error");
  window.clearTimeout(shell._pillTimer);
  if ((shell.dataset.visual || shell.dataset.state) !== "pill") void runShellMorph(shell, "pill");
  shell._pillTimer = window.setTimeout(() => {
    if (shell.dataset.state === "pill" && shell.dataset.opening !== "panel") void runShellMorph(shell, "orb");
  }, TOAST_MS);
  scheduleHitSync();
}

function toggleKanban() {
  const shell = shellFor("kanban");
  const action = chromeToggleAction({
    open: state.kanbanOpen,
    state: shell?.dataset.state || "orb",
    opening: shell?.dataset.opening || "",
    collapsing: !!shell?.classList.contains("is-collapsing"),
  });
  if (action === "raise" && shell) {
    raisePanel(shell);
    return;
  }
  openKanban();
}

function openKanban() {
  ensureChrome();
  const panel = $("#kanban-panel");
  const shell = shellFor("kanban");
  if (!panel || !shell) return;
  state.kanbanOpen = true;
  state.kanban.unread = false;
  const opening = shell.dataset.state !== "panel" || shell.classList.contains("is-collapsing");
  panel.hidden = false;
  applyBotColor(shell, NOUS.neutral);
  applyBotColor(panel, NOUS.neutral);
  window.clearTimeout(shell._pillTimer);
  shell.dataset.intent = "open";
  raisePanel(shell);
  if (opening) {
    void runShellMorph(shell, "panel").then((opened) => {
      if (opened) return;
      if (shell.dataset.state === "panel" || shell.dataset.opening === "panel") return;
      state.kanbanOpen = false;
      renderKanbanOrb();
    });
  }
  renderBots();
  if (gateway.isDown("gateway")) {
    paintGatewayWait();
    gateway.kick("gateway");
  } else {
    refreshKanban();
  }
  startKanbanPoll();
}

function closeKanban() {
  state.kanbanOpen = false;
  state.kanban.detailOpen = false;
  const detail = $("#kanban-detail");
  if (detail) {
    detail.hidden = true;
    detail.replaceChildren();
  }
  const board = $("#kanban-board");
  if (board) board.hidden = false;
  if (kanbanDrag) {
    kanbanDrag.ghost?.remove();
    kanbanDrag.card?.classList.remove("is-dragging");
    kanbanDrag = null;
    state.kanban.dragging = false;
  }
  setKanbanError("");
  const shell = shellFor("kanban");
  if (
    shell
    && !shell.classList.contains("is-collapsing")
    && (shell.dataset.state === "panel" || shell.dataset.opening === "panel")
  ) {
    void runShellMorph(shell, "orb").then((closed) => {
      if (!closed) return;
      syncLatch();
      scheduleHitSync();
    });
  }
  renderBots();
  scheduleHitSync();
}

function startKanbanPoll() {
  if (state.kanbanTimer) return;
  state.kanbanTimer = window.setInterval(() => {
    if (document.hidden) return;
    refreshKanban();
  }, KANBAN_POLL_MS);
}

function stopKanbanPoll() {
  window.clearInterval(state.kanbanTimer);
  state.kanbanTimer = 0;
}

function adoptKanbanPick(settings) {
  const saved = kanbanRequestSlug(settings?.kanban_board);
  if (saved) state.kanban.explicit = saved;
}

function kanbanBoardArgs() {
  const board = kanbanRequestSlug(state.kanban.explicit);
  return board ? { board } : {};
}

async function readKanbanPayload(invoke) {
  const payload = await invoke("get_kanban_board", kanbanBoardArgs());
  try {
    const list = await invoke("get_kanban_boards");
    const boards = Array.isArray(list?.boards)
      ? list.boards.map((slug) => kanbanRequestSlug(slug)).filter(Boolean)
      : [];
    state.kanban.boards = boards;
    state.kanban.current = kanbanRequestSlug(list?.current);
  } catch {
    // The board GET already follows the current board. A boards-list miss leaves the picker.
  }
  return payload;
}

async function pickKanbanBoard(slug) {
  const next = kanbanRequestSlug(slug);
  if (!next || next === kanbanRequestSlug(state.kanban.explicit)) return;
  const shown = pickerSelection("", state.kanban.current, state.kanban.board?.board);
  if (!state.kanban.explicit && next === shown) return;
  state.kanban.explicit = next;
  if (state.settings) state.settings.kanban_board = next;
  state.kanban.board = null;
  state.kanban.fingerprint = "";
  if (state.mode === "hermes" && inTauri()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const settings = await invoke("set_kanban_board", { board: next });
      if (settings) {
        state.settings = settings;
        state.kanban.explicit = kanbanRequestSlug(settings.kanban_board) || next;
      }
    } catch (err) {
      setKanbanError(String(err));
    }
  }
  refreshKanban();
}

async function refreshKanban() {
  if (backgroundBlocked()) {
    state.kanbanDeferred = true;
    debugLog("refresh-tick-defer", "kanban");
    armPresentationFlush();
    return;
  }
  if (state.kanban.saving || state.kanban.dragging) return;
  if (gateway.isDown("gateway") || probeGate.has("kanban")) return;
  let payload;
  if (state.mode !== "hermes" || !inTauri()) {
    payload = state.kanban.board || mockKanban();
  } else {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      payload = await readKanbanPayload(invoke);
    } catch (err) {
      const message = String(err);
      if (message.includes(KANBAN_LOGIN)) {
        payload = { needs_login: true, message: KANBAN_LOGIN };
      } else if (kanbanUnavailable(message)) {
        payload = { unavailable: true, message: KANBAN_UNAVAILABLE };
      } else if (gatewayDown(message)) {
        payload = { unavailable: true, message: "連唔到 Kanban。" };
      } else {
        payload = { unavailable: true, message };
      }
    }
  }
  commitKanban(normalizeBoard(payload));
}

function commitKanban(board) {
  if (backgroundBlocked()) {
    state.kanbanPending = board;
    debugLog("refresh-tick-defer", "kanban-commit");
    armPresentationFlush();
    return;
  }
  const print = boardFingerprint(board);
  if (state.kanban.board && print === state.kanban.fingerprint) return;
  const line = kanbanChangeLine(state.kanban.board, board);
  state.kanban.fingerprint = print;
  state.kanban.board = board;
  if (line) {
    showToast("kanban", { kind: "message", text: line });
    if (!state.kanbanOpen) {
      state.kanban.unread = true;
      pingOrb("kanban");
      renderKanbanOrb();
    }
  }
  paintKanban(board);
}

function mockKanban() {
  return {
    board: "",
    columns: [
      { name: "triage", tasks: [{ id: "demo-1", title: "整理今日待辦", assignee: "計劃助手", status: "triage", priority: "high", updated_at: "" }] },
      { name: "ready", tasks: [{ id: "demo-2", title: "對一下看板欄位", assignee: "程式夥伴", status: "ready", priority: "normal", updated_at: "" }] },
    ],
  };
}

function hideKanbanLogin() {
  const login = $("#kanban-login");
  if (login) login.hidden = true;
}

function showKanbanLogin() {
  const empty = $("#kanban-empty");
  const root = $("#kanban-board");
  const detail = $("#kanban-detail");
  const login = $("#kanban-login");
  state.kanban.detailOpen = false;
  if (empty) {
    empty.hidden = true;
    empty.classList.remove("is-retry", "is-unavailable");
  }
  if (root) {
    root.replaceChildren();
    root.hidden = true;
  }
  if (detail) {
    detail.hidden = true;
    detail.replaceChildren();
  }
  if (login) login.hidden = false;
  setKanbanError("");
  scheduleHitSync();
}

function paintKanban(board) {
  if (backgroundBlocked()) {
    state.kanbanPaintDue = board;
    debugLog("refresh-tick-defer", "kanban-paint");
    armPresentationFlush();
    return;
  }
  state.kanbanPaintDue = null;
  const empty = $("#kanban-empty");
  const root = $("#kanban-board");
  paintKanbanPicker(board);
  if (!root || !empty) return;
  if (board.needsLogin && !board.retry) {
    showKanbanLogin();
    return;
  }
  hideKanbanLogin();
  if (state.kanban.detailOpen && !board.unavailable && !board.retry) {
    scheduleHitSync();
    return;
  }
  const detail = $("#kanban-detail");
  if (detail) {
    detail.hidden = true;
    detail.replaceChildren();
  }
  state.kanban.detailOpen = false;
  if (board.retry || (gateway.isDown("gateway") && board.unavailable && gatewayDown(board.message) && !kanbanUnavailable(board.message))) {
    empty.hidden = false;
    empty.classList.remove("is-unavailable");
    empty.classList.add("is-retry");
    empty.textContent = gateway.status("gateway") || RECONNECT_STATUS;
    root.hidden = true;
    root.replaceChildren();
    scheduleHitSync();
    return;
  }
  empty.classList.remove("is-retry");
  if (board.unavailable) {
    empty.hidden = false;
    empty.textContent = board.message || KANBAN_EMPTY;
    empty.classList.toggle("is-unavailable", kanbanUnavailable(empty.textContent));
    root.hidden = true;
    root.replaceChildren();
    scheduleHitSync();
    return;
  }
  empty.hidden = true;
  root.hidden = false;
  empty.classList.remove("is-unavailable");
  root.replaceChildren();
  board.columns.forEach((column) => {
    const col = document.createElement("section");
    col.className = "kanban-col";
    col.dataset.status = column.name;
    const collapsed = columnCollapsed(column.name, state.kanban.doneOpen);
    if (collapsed) col.classList.add("is-collapsed");
    if (column.name === "done") col.setAttribute("aria-expanded", collapsed ? "false" : "true");
    const head = document.createElement("header");
    head.className = "kanban-col-head";
    head.lang = "en";
    const name = document.createElement("span");
    name.lang = "en";
    name.textContent = column.name;
    const count = document.createElement("small");
    count.textContent = String(column.tasks.length);
    if (column.name === "done") {
      const chevron = document.createElement("span");
      chevron.className = "kanban-done-chevron";
      chevron.setAttribute("aria-hidden", "true");
      chevron.textContent = collapsed ? "▸" : "▾";
      head.append(chevron, name, count);
    } else {
      head.append(name, count);
    }
    if (column.name === "done") {
      head.addEventListener("click", () => {
        state.kanban.doneOpen = !state.kanban.doneOpen;
        if (state.kanban.board) paintKanban(state.kanban.board);
      });
    }
    col.append(head);
    if (!collapsed) {
      const list = document.createElement("div");
      column.tasks.forEach((task) => list.appendChild(kanbanCard(task)));
      col.append(list);
    }
    root.appendChild(col);
  });
  scheduleHitSync();
}

function paintKanbanPicker(board) {
  const crumb = document.getElementById("kanban-crumb-board");
  const pick = document.getElementById("kanban-board-pick");
  const selected = pickerSelection(state.kanban.explicit, state.kanban.current, board?.board);
  const slugs = [];
  for (const slug of state.kanban.boards || []) {
    const name = kanbanRequestSlug(slug);
    if (name && !slugs.includes(name)) slugs.push(name);
  }
  if (selected && !slugs.includes(selected)) slugs.unshift(selected);
  state.kanban.paintingPick = true;
  try {
    if (pick && slugs.length) {
      const current = kanbanRequestSlug(state.kanban.current);
      const same = pick.options.length === slugs.length
        && slugs.every((slug, index) => {
          const option = pick.options[index];
          return option?.value === slug && option.textContent === boardOptionLabel(slug, current);
        });
      if (!same) {
        pick.replaceChildren();
        for (const slug of slugs) {
          const option = document.createElement("option");
          option.value = slug;
          option.textContent = boardOptionLabel(slug, current);
          pick.append(option);
        }
      }
      if (pick.value !== selected) pick.value = selected;
      pick.hidden = false;
      if (crumb) crumb.hidden = true;
    } else {
      if (pick) pick.hidden = true;
      if (crumb) {
        crumb.hidden = false;
        crumb.textContent = selected;
      }
    }
  } finally {
    state.kanban.paintingPick = false;
  }
}

function kanbanCard(task) {
  const card = document.createElement("article");
  card.className = "kanban-card";
  card.dataset.taskId = task.id;
  card.style.setProperty("--owner", ownerColor(task.assignee, state.bots));
  const title = document.createElement("p");
  title.className = "kanban-title";
  title.textContent = task.title || task.id;
  const meta = document.createElement("div");
  meta.className = "kanban-meta";
  if (task.assignee) {
    const who = document.createElement("span");
    who.textContent = task.assignee;
    meta.appendChild(who);
  }
  if (task.priority) {
    const chip = document.createElement("span");
    chip.className = "kanban-priority";
    chip.textContent = task.priority;
    chip.lang = "en";
    meta.appendChild(chip);
  }
  card.append(title, meta);
  card.addEventListener("pointerdown", (event) => startKanbanPointer(event, card, task.id));
  return card;
}

function setKanbanError(text) {
  const node = $("#kanban-error");
  if (!node) return;
  const message = String(text || "").trim();
  node.hidden = !message;
  node.textContent = message;
}

let kanbanDrag = null;

function columnAt(x, y) {
  const stack = document.elementsFromPoint?.(x, y) || [];
  for (const el of stack) {
    const col = el.closest?.(".kanban-col");
    if (col) return col;
  }
  return null;
}

function clearKanbanTargets() {
  document.querySelectorAll(".kanban-col.is-drop-target").forEach((el) => el.classList.remove("is-drop-target"));
}

function startKanbanPointer(event, card, taskId) {
  if (event.button !== 0 || kanbanDrag) return;
  kanbanDrag = {
    id: taskId,
    pointerId: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    moved: false,
    card,
    ghost: null,
  };
  card.setPointerCapture?.(event.pointerId);
  event.preventDefault();
}

function moveKanbanPointer(event) {
  const drag = kanbanDrag;
  if (!drag || event.pointerId !== drag.pointerId) return;
  const dx = event.clientX - drag.x;
  const dy = event.clientY - drag.y;
  if (!drag.moved && Math.hypot(dx, dy) < 6) return;
  if (!drag.moved) {
    drag.moved = true;
    state.kanban.dragging = true;
    drag.card.classList.add("is-dragging");
    const ghost = drag.card.cloneNode(true);
    ghost.classList.add("kanban-ghost");
    ghost.style.position = "fixed";
    ghost.style.width = `${drag.card.offsetWidth}px`;
    ghost.style.pointerEvents = "none";
    ghost.style.zIndex = "50";
    ghost.style.margin = "0";
    document.body.appendChild(ghost);
    drag.ghost = ghost;
  }
  drag.ghost.style.left = `${event.clientX + 8}px`;
  drag.ghost.style.top = `${event.clientY + 8}px`;
  const col = columnAt(event.clientX, event.clientY);
  clearKanbanTargets();
  col?.classList.add("is-drop-target");
}

function resyncKanbanHover(point) {
  if (point) {
    cursorPoint.x = point.x;
    cursorPoint.y = point.y;
  }
  // The board is rebuilt after the pointer grab lets go. Publish rects again
  // and, in the browser preview, paint fade from this pointer immediately.
  scheduleHitSync();
  if (!inTauri()) paintLocalProximity();
}

function endKanbanPointer(event) {
  const drag = kanbanDrag;
  if (!drag || event.pointerId !== drag.pointerId) return;
  const drop = event.type !== "pointercancel" && drag.moved;
  const openDetail = event.type === "pointerup" && !drag.moved;
  const col = drop ? columnAt(event.clientX, event.clientY) : null;
  const status = col?.dataset.status || "";
  const taskId = drag.id;
  const point = { x: event.clientX, y: event.clientY };
  kanbanDrag = null;
  state.kanban.dragging = false;
  drag.card.classList.remove("is-dragging");
  drag.ghost?.remove();
  clearKanbanTargets();
  try {
    drag.card.releasePointerCapture?.(event.pointerId);
  } catch {
    /* capture already released */
  }
  // Replacing the capture target inside pointerup leaves the GTK grab held,
  // so the board stays at the near-cursor fade until the next Ctrl hover.
  if (status) {
    requestAnimationFrame(() => {
      dropKanban(taskId, status);
      resyncKanbanHover(point);
    });
  } else if (openDetail) {
    requestAnimationFrame(() => {
      void openKanbanDetail(taskId);
      resyncKanbanHover(point);
    });
  } else {
    resyncKanbanHover(point);
  }
}

async function openKanbanDetail(taskId) {
  if (!taskId) return;
  if (state.mode !== "hermes" || !inTauri()) {
    const task = (state.kanban.board?.columns || [])
      .flatMap((column) => column.tasks || [])
      .find((item) => item.id === taskId);
    if (!task) return;
    paintKanbanDetail({ task, comments: [], events: [], runs: [] });
    return;
  }
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const detail = await invoke("get_kanban_task", { id: taskId });
    paintKanbanDetail(detail);
  } catch (err) {
    const message = String(err);
    if (message.includes(KANBAN_LOGIN)) {
      state.kanban.board = {
        board: state.kanban.board?.board || kanbanRequestSlug(state.kanban.explicit),
        columns: [],
        unavailable: false,
        needsLogin: true,
        message: KANBAN_LOGIN,
      };
      state.kanban.fingerprint = boardFingerprint(state.kanban.board);
      showKanbanLogin();
      return;
    }
    setKanbanError(gatewayDown(message) ? "連唔到 Kanban。" : message);
  }
}

function paintKanbanDetail(detail) {
  const root = $("#kanban-detail");
  const board = $("#kanban-board");
  const empty = $("#kanban-empty");
  if (!root) return;
  state.kanban.detailOpen = true;
  hideKanbanLogin();
  if (empty) empty.hidden = true;
  if (board) board.hidden = true;
  setKanbanError("");
  root.hidden = false;
  root.replaceChildren();
  const task = detail?.task || {};
  const back = document.createElement("button");
  back.type = "button";
  back.className = "icon-btn";
  back.textContent = "返回";
  back.addEventListener("click", () => {
    state.kanban.detailOpen = false;
    root.hidden = true;
    root.replaceChildren();
    if (board) board.hidden = false;
    if (state.kanban.board) paintKanban(state.kanban.board);
  });
  const title = document.createElement("h2");
  title.textContent = task.title || task.id || "";
  const meta = document.createElement("p");
  const bits = [task.assignee, task.status, task.priority].filter(Boolean);
  meta.textContent = bits.join(" · ");
  root.append(back, title, meta);
  if (task.latest_summary) {
    const summary = document.createElement("p");
    summary.textContent = task.latest_summary;
    root.append(summary);
  }
  if (task.body) {
    const body = document.createElement("p");
    body.textContent = task.body;
    root.append(body);
  }
  const comments = Array.isArray(detail?.comments) ? detail.comments : [];
  if (comments.length) {
    const list = document.createElement("ul");
    comments.forEach((comment) => {
      const item = document.createElement("li");
      const who = comment?.author ? `${comment.author}：` : "";
      item.textContent = `${who}${comment?.body || ""}`;
      list.append(item);
    });
    root.append(list);
  }
  scheduleHitSync();
}

async function signInKanban() {
  if (!inTauri()) {
    $("#settings-status").textContent = "瀏覽器預覽唔可以登入。";
    return;
  }
  const username = $("#kanban-user")?.value.trim() || "";
  const password = $("#kanban-password")?.value || "";
  $("#settings-status").textContent = username || password ? "登入緊…" : "開緊瀏覽器登入…";
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const message = await invoke("sign_in_kanban", {
      input: {
        kanban_base_url: $("#kanban-url")?.value.trim() || "",
        username,
        password,
      },
    });
    if ($("#kanban-password")) $("#kanban-password").value = "";
    $("#settings-status").textContent = String(message || "已登入 Kanban");
    if (state.kanban.board?.needsLogin) {
      state.kanban.board = null;
      state.kanban.fingerprint = "";
    }
    refreshKanban();
  } catch (err) {
    if ($("#kanban-password")) $("#kanban-password").value = "";
    $("#settings-status").textContent = String(err);
  }
}

async function dropKanban(taskId, status) {
  const previous = state.kanban.board;
  if (!previous || previous.unavailable) return;
  const current = (previous.columns || []).flatMap((column) => column.tasks || []).find((task) => task.id === taskId);
  if (current && current.status === status) return;
  const next = moveTask(previous, taskId, status);
  state.kanban.board = next;
  state.kanban.fingerprint = boardFingerprint(next);
  setKanbanError("");
  paintKanban(next);
  if (state.mode !== "hermes" || !inTauri()) return;
  state.kanban.saving = true;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("patch_kanban_task", { id: taskId, patch: { status } });
  } catch (err) {
    state.kanban.board = previous;
    state.kanban.fingerprint = boardFingerprint(previous);
    paintKanban(previous);
    setKanbanError(kanbanErrorText(err));
  } finally {
    state.kanban.saving = false;
    resyncKanbanHover();
  }
}

function mockCronGroups() {
  const soon = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  const earlier = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  return [
    normalizeCronGroup({
      profile: "planner",
      name: "計劃助手",
      jobs: [
        { id: "daily", name: "每日摘要", schedule: "每日 09:00", enabled: true, next_run_at: soon, last_run_at: earlier, state: "scheduled" },
        { id: "tidy", name: "整理看板", schedule: "每週一 10:00", enabled: false, next_run_at: "", state: "paused" },
      ],
    }),
    normalizeCronGroup({
      profile: "coder",
      name: "程式夥伴",
      jobs: [
        {
          id: "tests",
          name: "檢查測試",
          schedule: "每 30 分鐘",
          enabled: true,
          next_run_at: soon,
          state: "scheduled",
          fire_claim: { at: earlier, by: "host:demo" },
          latest_execution: { status: "running", started_at: new Date(Date.now() - 42 * 1000).toISOString() },
        },
      ],
    }),
    normalizeCronGroup({ profile: "quiet", name: "靜音", jobs: [] }),
  ];
}

function toggleCron() {
  const shell = shellFor("cron");
  const action = chromeToggleAction({
    open: state.cronOpen,
    state: shell?.dataset.state || "orb",
    opening: shell?.dataset.opening || "",
    collapsing: !!shell?.classList.contains("is-collapsing"),
  });
  if (action === "raise" && shell) {
    raisePanel(shell);
    return;
  }
  openCron();
}

function openCron() {
  ensureChrome();
  const panel = $("#cron-panel");
  const shell = shellFor("cron");
  if (!panel || !shell) return;
  state.cronOpen = true;
  const opening = shell.dataset.state !== "panel" || shell.classList.contains("is-collapsing");
  panel.hidden = false;
  applyBotColor(shell, NOUS.neutral);
  applyBotColor(panel, NOUS.neutral);
  window.clearTimeout(shell._pillTimer);
  shell.dataset.intent = "open";
  paintCron();
  raisePanel(shell);
  if (opening) {
    void runShellMorph(shell, "panel").then((opened) => {
      if (opened) return;
      if (shell.dataset.state === "panel" || shell.dataset.opening === "panel") return;
      state.cronOpen = false;
      renderCronOrb();
    });
  } else {
    syncCronBox();
  }
  renderBots();
  if (gateway.isDown("gateway")) {
    paintGatewayWait();
    gateway.kick("gateway");
  } else {
    refreshCron();
  }
}

function closeCron() {
  state.cronOpen = false;
  const shell = shellFor("cron");
  if (
    shell
    && !shell.classList.contains("is-collapsing")
    && (shell.dataset.state === "panel" || shell.dataset.opening === "panel")
  ) {
    void runShellMorph(shell, "orb").then((closed) => {
      if (!closed) return;
      syncLatch();
      scheduleHitSync();
    });
  }
  renderBots();
  scheduleHitSync();
}

function cronStatusMark(job) {
  if (job.running) {
    const mark = document.createElement("span");
    mark.className = "cron-arc";
    mark.dataset.jobId = job.id;
    const p = cronProgress(job);
    mark.style.setProperty("--p", String(p == null ? 0.25 : p));
    return mark;
  }
  const dot = document.createElement("span");
  dot.className = job.enabled ? "cron-dot is-on" : "cron-dot is-off";
  return dot;
}

function paintCronArcs() {
  const jobs = (state.cronGroups || []).flatMap((group) => group.jobs || []);
  document.querySelectorAll(".cron-arc").forEach((mark) => {
    const job = jobs.find((item) => item.id === mark.dataset.jobId);
    if (!job) return;
    const p = cronProgress(job);
    mark.style.setProperty("--p", String(p == null ? 0.25 : p));
  });
}

function measureCronContent() {
  const panel = document.getElementById("cron-panel");
  if (!panel || panel.hidden) return 0;
  const shell = panel.closest(".morph");
  const list = document.getElementById("cron-list");
  const saved = {
    shellH: shell?.style.height ?? "",
    position: panel.style.position,
    inset: panel.style.inset,
    height: panel.style.height,
    maxHeight: panel.style.maxHeight,
    bottom: panel.style.bottom,
    overflow: panel.style.overflow,
    listFlex: list?.style.flex ?? "",
    listOverflow: list?.style.overflow ?? "",
    listMin: list?.style.minHeight ?? "",
  };
  if (shell) shell.style.height = "auto";
  panel.style.position = "relative";
  panel.style.inset = "auto";
  panel.style.height = "fit-content";
  panel.style.maxHeight = "none";
  panel.style.bottom = "auto";
  panel.style.overflow = "visible";
  if (list) {
    list.style.flex = "none";
    list.style.overflow = "visible";
    list.style.minHeight = "auto";
  }
  const height = Math.ceil(panel.getBoundingClientRect().height);
  if (shell) shell.style.height = saved.shellH;
  panel.style.position = saved.position;
  panel.style.inset = saved.inset;
  panel.style.height = saved.height;
  panel.style.maxHeight = saved.maxHeight;
  panel.style.bottom = saved.bottom;
  panel.style.overflow = saved.overflow;
  if (list) {
    list.style.flex = saved.listFlex;
    list.style.overflow = saved.listOverflow;
    list.style.minHeight = saved.listMin;
  }
  return height;
}

function syncCronBox(retry = true) {
  const panel = document.getElementById("cron-panel");
  if (!panel || panel.hidden) return;
  const next = cronShellHeight(measureCronContent(), window.innerHeight || 800);
  if (!(Math.abs(next - state.cronBoxH) < 2 && state.cronBoxH > 0)) {
    state.cronBoxH = next;
    const shell = shellFor("cron");
    if (shell && !shell.classList.contains("is-morphing") && !shell.classList.contains("is-collapsing")) {
      layoutShell(shell);
    }
  }
  if (retry) requestAnimationFrame(() => syncCronBox(false));
}

function paintCron() {
  const empty = $("#cron-empty");
  const list = $("#cron-list");
  if (!empty || !list) return;
  if (gateway.isDown("gateway")) {
    empty.hidden = false;
    empty.classList.add("is-retry");
    empty.textContent = gateway.status("gateway") || RECONNECT_STATUS;
    list.replaceChildren();
    renderCronOrb();
    syncCronBox();
    scheduleHitSync();
    return;
  }
  empty.classList.remove("is-retry");
  list.replaceChildren();
  const blocks = state.cronGroups || [];
  if (!blocks.length) {
    empty.hidden = false;
    empty.textContent = CRON_EMPTY;
    empty.classList.add("cron-note");
    renderCronOrb();
    syncCronBox();
    scheduleHitSync();
    return;
  }
  empty.hidden = true;
  blocks.forEach((group) => {
    const block = document.createElement("section");
    const title = document.createElement("h2");
    title.className = "cron-group-title";
    title.textContent = group.name || group.profile || "Bot";
    block.appendChild(title);
    const noteText = cronGroupNote(group);
    if (noteText) {
      const note = document.createElement("p");
      note.className = "cron-note";
      note.textContent = noteText;
      block.appendChild(note);
    }
    const cards = document.createElement("div");
    cards.className = "cron-cards";
    (group.jobs || []).forEach((job) => {
      const row = document.createElement("article");
      row.className = "cron-job";
      const copy = document.createElement("div");
      copy.className = "cron-card-copy";
      const name = document.createElement("p");
      name.className = "cron-name";
      name.textContent = job.name;
      const expr = document.createElement("p");
      expr.className = "cron-expr";
      expr.textContent = job.schedule || "";
      const time = document.createElement("p");
      time.className = "cron-time";
      const bits = [];
      const next = nextRunLabel(job.next_run_at);
      if (next) bits.push(`下次 ${next}`);
      if (job.running) bits.push("進行中");
      const last = nextRunLabel(job.last_run_at);
      if (last) bits.push(`上次 ${last}`);
      time.textContent = bits.join(" · ");
      const tag = document.createElement("span");
      tag.className = job.enabled ? "cron-tag is-on" : "cron-tag";
      tag.textContent = job.enabled ? "啟用" : "停用";
      copy.append(name, expr, time, tag);
      row.append(copy, cronStatusMark(job));
      cards.appendChild(row);
    });
    if (cards.childElementCount) block.appendChild(cards);
    list.appendChild(block);
  });
  renderCronOrb();
  syncCronBox();
  scheduleHitSync();
}

async function refreshCron() {
  if (backgroundBlocked()) {
    state.cronDeferred = true;
    debugLog("refresh-tick-defer", "cron");
    armPresentationFlush();
    return;
  }
  if (gateway.isDown("gateway")) return;
  let next;
  if (!inTauri() || state.mode !== "hermes") {
    next = mockCronGroups();
  } else {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const rows = await invoke("list_cron_jobs");
      next = (rows || []).map((row) => normalizeCronGroup(row));
    } catch (err) {
      if (gatewayDown(String(err))) {
        noteGatewayDown();
        return;
      }
      next = [normalizeCronGroup({
        unavailable: true,
        name: "排程",
        message: String(err),
      })];
    }
  }
  if (
    inTauri()
    && state.mode === "hermes"
    && next.length
    && next.every((group) => group.unavailable && gatewayDown(group.message))
  ) {
    noteGatewayDown();
    return;
  }
  if (backgroundBlocked()) {
    state.cronDeferred = true;
    debugLog("refresh-tick-defer", "cron-apply");
    armPresentationFlush();
    return;
  }
  const sig = JSON.stringify(next);
  if (sig === state.cronSig) {
    renderCronOrb();
    return;
  }
  state.cronSig = sig;
  state.cronGroups = next;
  renderCronOrb();
  if (state.cronOpen) paintCron();
}

function startCronPoll() {
  if (state.cronTimer) return;
  state.cronTimer = window.setInterval(() => {
    if (document.hidden) return;
    refreshCron();
  }, CRON_POLL_MS);
}

function stopCronPoll() {
  window.clearInterval(state.cronTimer);
  window.clearInterval(state.cronClock);
  state.cronTimer = 0;
  state.cronClock = 0;
}

function startWatchers() {
  ensureChrome();
  startKanbanPoll();
  startCronPoll();
  refreshKanban();
  refreshCron();
}

/** The real shell has to run a clip in the visible window before the first
 *  user open. An off-screen prime does not build that element's tiles. */
function rehearsalBlocked(shell) {
  if (!shell?.isConnected) return true;
  if (shell.dataset.rehearsal === "1") return true;
  if (shell.dataset.state === "panel" || shell.dataset.visual === "panel") return true;
  if (shell.dataset.intent === "open" || shell.dataset.intent === "close") return true;
  if (state.openIds.includes(shell.dataset.botId)) return true;
  return shell.classList.contains("is-morphing")
    || shell.classList.contains("is-collapsing")
    || shell.classList.contains("is-plan-seam")
    || shell.classList.contains("is-plan-arming");
}

function rehearsalHandedOff(shell) {
  if (!shell?.isConnected) return true;
  if (shell.dataset.intent === "open" || shell.dataset.intent === "close") return true;
  if (shell.dataset.state === "panel" || shell.dataset.visual === "panel") return true;
  if (state.openIds.includes(shell.dataset.botId)) return true;
  return shell.classList.contains("is-morphing") || shell.classList.contains("is-collapsing");
}

/** Same-opacity stand-in. The real shell is parked off-screen, so this orb
 *  stays clickable and forwards into the normal open path. */
function placeRehearsalStand(shell) {
  const orb = shell.querySelector(".morph-orb");
  const box = orb?.getBoundingClientRect?.();
  if (!orb || !box || box.width < 1 || box.height < 1) return null;
  const stand = orb.cloneNode(true);
  const id = shell.dataset.botId || "";
  stand.classList.add("plan-rehearsal-stand");
  stand.dataset.botId = id;
  stand.setAttribute("aria-hidden", "true");
  stand.tabIndex = -1;
  const opacity = getComputedStyle(shell).opacity || "1";
  stand.style.position = "fixed";
  stand.style.left = `${box.left}px`;
  stand.style.top = `${box.top}px`;
  stand.style.width = `${box.width}px`;
  stand.style.height = `${box.height}px`;
  stand.style.margin = "0";
  stand.style.pointerEvents = "auto";
  stand.style.opacity = opacity;
  stand.style.zIndex = "30";
  stand.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (orbOpenedThisPress()) return;
    if (pageOpenBlocked() || !orbClickAllowed(event)) return;
    selectBot(id);
  });
  stand.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!modifierHeld(event)) return;
    openOrbMenu(id, event.clientX, event.clientY);
  });
  document.documentElement.append(stand);
  return stand;
}

/** 1px host outside the viewport. The shell keeps opacity 1 and a real
 *  clip-path animation so the layer is composited, and overflow clips
 *  every painted pixel off the screen. */
function parkRehearsalHost(shell) {
  const host = document.createElement("div");
  host.className = "plan-rehearsal-host";
  host.setAttribute("aria-hidden", "true");
  host.style.cssText = "position:fixed;left:-4px;top:-4px;width:1px;height:1px;overflow:hidden;opacity:1;pointer-events:none;z-index:0;";
  document.documentElement.append(host);
  host.append(shell);
  return host;
}

function restorePlanRehearsal(shell, saved, stand) {
  stand?.remove();
  if (shell?._rehearsalRestored) return;
  if (shell) shell._rehearsalRestored = 1;
  if (shell && saved?.rail && shell.parentElement !== saved.rail) saved.rail.append(shell);
  saved?.host?.remove();
  if (!shell?.isConnected) {
    if (!hitsBlocked()) scheduleHitSync("plan-rehearsal");
    return;
  }
  const morphOwns = shell.classList.contains("is-morphing") || shell.classList.contains("is-collapsing");
  delete shell.dataset.rehearsal;
  delete shell._rehearsalHit;
  if (saved?.rail && shell.parentElement !== saved.rail) saved.rail.append(shell);
  if (saved?.opacity) shell.style.opacity = saved.opacity;
  else shell.style.removeProperty("opacity");
  if (saved?.pointer) shell.style.pointerEvents = saved.pointer;
  else shell.style.removeProperty("pointer-events");
  if (!saved?.background) shell.style.removeProperty("background");
  else shell.style.background = saved.background;
  if (saved?.transform) shell.style.transform = saved.transform;
  else shell.style.removeProperty("transform");
  shell.getAnimations?.().forEach((anim) => {
    const name = anim.id || "";
    if (name === "plan-rehearsal" || name === "plan-rehearsal-close") anim.cancel();
  });
  if (morphOwns) return;
  shell.style.removeProperty("overflow");
  if (saved?.will) shell.style.willChange = saved.will;
  else shell.style.removeProperty("will-change");
  releaseMotion(shell);
  const plan = planNode(shell);
  if (plan) {
    plan.classList.remove("is-seam-grow");
    plan.hidden = saved?.planHidden ?? true;
    if (saved?.planWidth) plan.style.width = saved.planWidth;
    else plan.style.removeProperty("width");
    if (saved?.planVisibility) plan.style.visibility = saved.planVisibility;
    else plan.style.removeProperty("visibility");
    if (saved?.planPointer) plan.style.pointerEvents = saved.planPointer;
    else plan.style.removeProperty("pointer-events");
  }
  if (saved?.planWidthData) shell.dataset.planWidth = saved.planWidthData;
  else delete shell.dataset.planWidth;
  if (saved?.clip) shell.style.clipPath = saved.clip;
  else shell.style.removeProperty("clip-path");
  layoutShell(shell);
  if (!hitsBlocked()) scheduleHitSync("plan-rehearsal");
}

function abortPlanRehearsal(shell) {
  if (!shell || shell.dataset.rehearsal !== "1" || shell._rehearsalRestored) return;
  const id = shell.dataset.botId || "";
  if (id) rehearsedProfiles.delete(id);
  restorePlanRehearsal(shell, shell._rehearsalSaved, shell._rehearsalStand);
}

/** Hidden open → 280ms grow → close on the real shell. The shell stays at
 *  opacity 1 inside a 1px host outside the screen, so the clip is composited
 *  and no pixel lands on the desktop. Orb hits were already published. */
async function rehearseOnePlan(shell) {
  const id = shell.dataset.botId || "";
  if (!id || rehearsalBlocked(shell) || rehearsedProfiles.has(id)) return false;
  const wait = rehearsalWaitReason();
  if (wait) {
    noteRehearsalDefer(wait, id);
    return false;
  }
  const orbBox = visibleBox(shell);
  const stand = placeRehearsalStand(shell);
  if (!stand || orbBox.w < 1 || orbBox.h < 1) {
    stand?.remove();
    return false;
  }
  const plan = planNode(shell);
  const saved = {
    opacity: shell.style.opacity,
    pointer: shell.style.pointerEvents,
    background: shell.style.background,
    will: shell.style.willChange,
    clip: shell.style.clipPath,
    transform: shell.style.transform,
    rail: shell.parentElement,
    planHidden: plan ? plan.hidden : true,
    planVisibility: plan ? plan.style.visibility : "",
    planWidth: plan ? plan.style.width : "",
    planPointer: plan ? plan.style.pointerEvents : "",
    planWidthData: shell.dataset.planWidth || "",
  };
  shell._rehearsalHit = { x: orbBox.x, y: orbBox.y, w: orbBox.w, h: orbBox.h };
  shell._rehearsalSaved = saved;
  shell._rehearsalStand = stand;
  shell._rehearsalRestored = 0;
  rehearsedProfiles.add(id);
  shell.dataset.rehearsal = "1";
  saved.host = parkRehearsalHost(shell);
  debugLog("plan-rehearsal", `start profile=${id}`);
  let anim = null;
  try {
    holdMotion(shell);
    shell.style.pointerEvents = "none";
    shell.style.opacity = "1";
    shell.style.background = "transparent";
    shell.style.transform = "translate3d(-300vw, -300vh, 0)";
    shell.style.willChange = "clip-path";
    if (!shell.dataset.planSide) shell.dataset.planSide = sideFromStyle(shell);
    shell.dataset.planWidth = String(Math.round(planWidthPx()));
    if (plan) {
      plan.hidden = false;
      plan.classList.add("is-seam-grow");
      plan.style.visibility = "visible";
      plan.style.pointerEvents = "none";
      plan.style.width = `${Math.round(planWidthPx())}px`;
    }
    const from = planRevealClip(shell, 0).value;
    const to = planRevealClip(shell, 1).value;
    try {
      anim = shell.animate([
        { clipPath: from },
        { clipPath: to },
      ], { duration: PLAN_GROW_MS, easing: PLAN_EASE, fill: "both", id: "plan-rehearsal" });
    } catch {
      anim = null;
    }
    if (anim) {
      alignSeamClock(anim);
      shell.style.clipPath = to;
      pumpSeamPresent(shell, PLAN_GROW_MS);
      await whenAnimEnds(anim, PLAN_GROW_MS + 64, false);
    }
    if (anim && !rehearsalHandedOff(shell) && shell.dataset.rehearsal === "1" && !shell._rehearsalRestored) {
      try { anim.cancel(); } catch { /* the close clip replaces it */ }
      const rest = saved.clip || from;
      let closing = null;
      try {
        closing = shell.animate([
          { clipPath: to },
          { clipPath: rest },
        ], { duration: 48, easing: "linear", fill: "both", id: "plan-rehearsal-close" });
      } catch {
        closing = null;
      }
      if (closing) {
        try { closing.currentTime = 0; closing.play(); } catch { /* restore paints the orb */ }
        await whenAnimEnds(closing, 80, false);
      }
    }
  } finally {
    restorePlanRehearsal(shell, saved, stand);
    debugLog("plan-rehearsal", `finish profile=${id}`);
  }
  return true;
}

const rehearsedProfiles = new Set();

async function rehearsePlanShells() {
  if (rehearsePlanShells.running) return;
  rehearsePlanShells.running = true;
  try {
    const queue = state.bots.filter((bot) => bot?.id && !rehearsedProfiles.has(bot.id));
    for (const bot of queue) {
      const wait = rehearsalWaitReason();
      if (wait) {
        noteRehearsalDefer(wait);
        postponeOrbWork();
        return;
      }
      const shell = shellFor(bot.id);
      if (!shell || shell.dataset.kind !== "bot") {
        rehearsedProfiles.add(bot.id);
        continue;
      }
      if (rehearsalBlocked(shell)) {
        rehearsedProfiles.add(bot.id);
        continue;
      }
      const ran = await rehearseOnePlan(shell);
      if (!ran && rehearsalWaitReason()) {
        postponeOrbWork();
        return;
      }
    }
  } finally {
    rehearsePlanShells.running = false;
  }
  const left = state.bots.some((bot) => bot?.id && !rehearsedProfiles.has(bot.id) && shellFor(bot.id));
  if (left && (rehearsePlanShells.tries || 0) < 12) {
    rehearsePlanShells.tries = (rehearsePlanShells.tries || 0) + 1;
    schedulePlanRehearsal();
  }
}

function schedulePlanRehearsal() {
  if (inTauri() && !revealOverlay.shown) return;
  const wait = rehearsalWaitReason();
  if (wait) {
    noteRehearsalDefer(wait);
    postponeOrbWork();
    return;
  }
  if (!hitsBlocked()) publishHits("first-paint");
  if (schedulePlanRehearsal.armed || rehearsePlanShells.running) return;
  const waiting = state.bots.some((bot) => bot?.id && !rehearsedProfiles.has(bot.id) && shellFor(bot.id));
  if (!waiting) return;
  schedulePlanRehearsal.armed = true;
  const run = () => {
    schedulePlanRehearsal.armed = false;
    const again = rehearsalWaitReason();
    if (again) {
      noteRehearsalDefer(again);
      postponeOrbWork();
      return;
    }
    rehearsePlanShells();
  };
  if (typeof requestIdleCallback === "function") requestIdleCallback(run, { timeout: 80 });
  else window.setTimeout(run, 1);
}

/** One composited clip before the first real open. A cold shell clip that
 *  is paused across frames never presents; this run uses the same clock. */
function primePlanCompositor() {
  if (primePlanCompositor.done) return;
  primePlanCompositor.done = true;
  const node = document.createElement("div");
  node.setAttribute("aria-hidden", "true");
  node.style.cssText = "position:fixed;left:0;top:0;width:280px;height:160px;opacity:0.01;pointer-events:none;z-index:0;will-change:clip-path;transform:translate3d(-120vw,0,0)";
  document.documentElement.append(node);
  let anim = null;
  try {
    anim = node.animate([
      { clipPath: "inset(0px 280px 0px 0px)" },
      { clipPath: "inset(0px 0px 0px 0px)" },
    ], { duration: PLAN_GROW_MS, easing: PLAN_EASE, fill: "both", id: "seam-prime" });
  } catch {
    node.remove();
    return;
  }
  alignSeamClock(anim);
  whenAnimEnds(anim, PLAN_GROW_MS + 64, false).then(() => node.remove());
}

function viewportMatches(target) {
  const width = window.innerWidth || 0;
  const height = window.innerHeight || 0;
  const goalW = target?.width || window.screen?.width || 0;
  const goalH = target?.height || window.screen?.height || 0;
  if (goalW < 100 || goalH < 100) return width >= 100;
  return width + 8 >= goalW && height + 8 >= goalH;
}

function afterNextPaint() {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    requestAnimationFrame(() => requestAnimationFrame(finish));
    setTimeout(finish, 50);
  });
}

function rememberWorkInsets(size) {
  if (!size) return;
  state.workInsets = {
    top: Number(size.inset_top) || 0,
    right: Number(size.inset_right) || 0,
    bottom: Number(size.inset_bottom) || 0,
    left: Number(size.inset_left) || 0,
  };
}

function fitOverlay() {
  if (!inTauri()) return Promise.resolve(null);
  return import("@tauri-apps/api/core")
    .then(({ invoke }) => invoke("fit_overlay"))
    .then((size) => {
      rememberWorkInsets(size);
      return size;
    })
    .catch(() => null);
}

/** Map the native window after the transparent page has composited at the
 *  monitor size. A hidden document does not run rAF; the timeout is that paint. */
function revealOverlay() {
  if (!inTauri() || revealOverlay.shown) return Promise.resolve();
  revealOverlay.shown = true;
  return import("@tauri-apps/api/core")
    .then(({ invoke }) => invoke("reveal_overlay"))
    .catch(() => {
      revealOverlay.shown = false;
    });
}

function scheduleOverlayReveal() {
  if (!inTauri() || scheduleOverlayReveal.started) return;
  scheduleOverlayReveal.started = true;
  revealWhenCovered();
}

async function revealWhenCovered() {
  let target = await fitOverlay();
  const started = performance.now();
  const deadline = started + 1200;
  let refit = false;
  while (!viewportMatches(target) && performance.now() < deadline) {
    if (!refit && performance.now() > started + 180) {
      refit = true;
      const again = await fitOverlay();
      if (again?.width) target = again;
      if (inTauri()) {
        try {
          const { invoke } = await import("@tauri-apps/api/core");
          await invoke("map_overlay_for_layout");
        } catch { /* the visible reveal still runs */ }
      }
    }
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        window.removeEventListener("resize", onResize);
        resolve();
      }, 32);
      const onResize = () => {
        clearTimeout(timer);
        window.removeEventListener("resize", onResize);
        resolve();
      };
      window.addEventListener("resize", onResize);
    });
  }
  layoutShells();
  await afterNextPaint();
  await publishHits("final-size");
  await revealOverlay();
  layoutShells();
  await publishHits("after-reveal", true);
  primePlanCompositor();
  schedulePlanRehearsal();
}

async function boot() {
  await armDebugLog();
  setupComposer();
  requestAnimationFrame(() => requestAnimationFrame(() => {
    primePlanCompositor();
  }));
  scheduleOverlayReveal();
  setupWindowChrome();
  setupProximity();
  const kanbanPick = $("#kanban-board-pick");
  if (kanbanPick) {
    kanbanPick.addEventListener("change", (event) => {
      if (!event.isTrusted || state.kanban.paintingPick) return;
      void pickKanbanBoard(kanbanPick.value);
    });
  }
  const kanbanClose = $("#btn-kanban-close");
  if (kanbanClose) {
    kanbanClose.dataset.hitId = "close:kanban";
    kanbanClose.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      closeKanban();
    });
  }
  window.addEventListener("pointermove", moveKanbanPointer);
  window.addEventListener("pointerup", endKanbanPointer);
  window.addEventListener("pointercancel", endKanbanPointer);
  const cronClose = $("#btn-cron-close");
  if (cronClose) {
    cronClose.dataset.hitId = "close:cron";
    cronClose.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      closeCron();
    });
  }
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      stopKanbanPoll();
      stopCronPoll();
      return;
    }
    kickGateway();
    refreshKanban();
    startKanbanPoll();
    refreshCron();
    startCronPoll();
  });
  window.addEventListener("online", kickGateway);
  document.addEventListener("resume", kickGateway);
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) kickGateway();
  });
  window.addEventListener("resize", layoutShells);
  applyInteraction(state.interaction);
  if (!inTauri()) {
    window.__deliverCron = deliverCron;
    window.__handleHermes = handleHermes;
    window.__setBanner = setBanner;
    window.__applyKanbanBoard = (payload) => commitKanban(normalizeBoard(payload));
    useMock("瀏覽器預覽：離線示範。Gateway 同金鑰只喺桌面版可用。", "settings");
    startWatchers();
    if (new URLSearchParams(location.search).has("setup")) {
      state.settings = { needs_setup: true, mode: "mock", gateway_base_url: "" };
      openSettings();
    }
    return;
  }
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const { listen } = await import("@tauri-apps/api/event");
    await listen("hermes", (event) => handleHermes(event.payload));
    await listen("overlay-ui", (event) => {
      if (event.payload?.type === "open-settings") openSettingsFromShortcut();
    });
    const settings = await invoke("get_settings");
    state.settings = settings;
    adoptKanbanPick(settings);
    state.showBotNames = !!settings?.show_bot_names;
    applyInteraction(settings.interaction);
    if (settings.needs_setup) {
      useMock(SETUP_BANNER, "settings");
      openSettings();
    } else if (settings.mode === "mock") useMock("未設定 gateway，而家係離線示範模式。", "settings");
    else await connectHermes(settings);
    if (settings.keyring_error) {
      setBanner(`鑰匙圈：${settings.keyring_error}`, "error", "keyring");
    }
  } catch (err) {
    useMock(`讀唔到設定，改用示範模式：${err}`);
  }
  startWatchers();
}

if (linuxAltWarning(`${navigator.platform || ""} ${navigator.userAgent || ""}`)) {
  document.documentElement.classList.add("platform-linux");
}

window.addEventListener("DOMContentLoaded", boot);
