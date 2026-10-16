/**
 * Hermes Overlay — perimeter bots + center chat.
 * UI labels: Traditional Chinese (zh-HK).
 * Gateway keys stay in the Rust process; this file only sees has_key.
 */

import { formatToastClock, orbMotion, reduceActivity, statusAfterWatchdog, TOAST_MS } from "./activity.js";
import { latestPlan, noteNewestPlan, planDemoMarkdown, planTask, plansIn } from "./plan.js";
import { closePanel, openPanel } from "./panels.js";
import {
  CONTENT_IN_MS,
  EASE,
  ICON,
  ORB,
  PANEL_H,
  PANEL_W,
  PLAN_GROW_MS,
  clipPath,
  distributeEdges,
  fixedOrbPoint,
  iconShift,
  insetsFor,
  phaseList,
  dropParkedAnchor,
  placeShell,
  previewBlocked,
  revealClip,
  separateStackedPanels,
  includePlan,
  slotPoint,
  FRAME_BLEED,
  STACK_GAP,
  tighten,
  seamInsets,
  cronShellHeight,
  chatTailAction,
} from "./morph.js";
import { isProfileEnabled, profilesNeedingKeys } from "./roster.js";
import { orderSessions, previewLine, resolveSession, sessionLabel, unseenMessages } from "./sessions.js";
import { applyBotColor, NOUS } from "./botcolor.js";
import {
  KANBAN_BOARD,
  KANBAN_EMPTY,
  KANBAN_POLL_MS,
  boardFingerprint,
  kanbanChangeLine,
  kanbanErrorText,
  moveTask,
  normalizeBoard,
  ownerColor,
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
  PREVIEW_COMMANDS,
  completionText,
  filterCommands,
  gatewayDown,
  groupByCategory,
  inlineArgsHint,
  modelFields,
  moveSlashIndex,
  orderSlashCommands,
  parseSlashMarker,
  reconnectDelayMs,
  resolveClient,
  sendBlockedWhileBusy,
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
  composerKeyAction,
  MODIFIER_ARM_MS,
  nextDropdownOpen,
  selectKeyOpensDropdown,
  BLUR_RELEASE_MS,
} from "./proximity.js";

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
    ? `光球預設半透明同穿透。按住 ${name}，游標下嗰粒先變實色、可以點同右鍵隱藏。新訊息會由光球橫向展開成膠囊 5 秒，唔使按 ${name} 都睇到，但要按住先至點得。面板預設實色，可以拖同點；按住 ${name} 就變透明並穿透。`
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
  if (id === "settings" || id === "kanban" || id === "cron") return fixedOrbPoint(id, vw, vh, pad, ORB);
  const index = Math.max(0, state.bots.findIndex((bot) => bot.id === id));
  const slots = distributeEdges(Math.max(state.bots.length, 1));
  const slot = slots[index] || { edge: "right", t: 0.5 };
  return slotPoint(slot.edge, slot.t, vw, vh, pad, ORB);
}

/** Room outside the cron orb for the tick ring and the 14px+4px running glow. */
const CRON_ORB_BLEED = 32;

function paintClip(shell, insets, visual = shell.dataset.visual || shell.dataset.state || "orb") {
  const cronOrb = shell.dataset.botId === "cron" && visual === "orb";
  const outer = cronOrb
    ? {
      top: insets.top - CRON_ORB_BLEED,
      right: insets.right - CRON_ORB_BLEED,
      bottom: insets.bottom - CRON_ORB_BLEED,
      left: insets.left - CRON_ORB_BLEED,
      radius: insets.radius + CRON_ORB_BLEED,
    }
    : null;
  shell.style.clipPath = outer ? clipPath(outer) : revealClip(visual, shellGeom(shell));
  const fill = shell.querySelector(".morph-fill");
  if (fill) fill.style.clipPath = clipPath(tighten(insets));
  shell.dataset.clipTop = String(insets.top);
  shell.dataset.clipRight = String(insets.right);
  shell.dataset.clipBottom = String(insets.bottom);
  shell.dataset.clipLeft = String(insets.left);
  shell.dataset.clipRadius = String(insets.radius);
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
  shell.dataset.visual = visual;
  shell.dataset.state = visual === "orb" || visual === "pill" ? visual : "panel";
  shell.dataset.hitId = hitFor(shell.dataset.botId, shell.dataset.state);
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

function placeShellElement(shell) {
  const id = shell.dataset.botId;
  const size = boxSize(id);
  const point = anchorPoint(id);
  const vw = window.innerWidth || 1280;
  const vh = window.innerHeight || 800;
  const placed = placeShell(point.x, point.y, size.w, size.h, vw, vh);
  shell.style.width = `${placed.width}px`;
  shell.style.height = `${placed.height}px`;
  shell.style.left = `${placed.left}px`;
  shell.style.top = `${placed.top}px`;
  shell.style.right = "auto";
  shell.style.bottom = "auto";
  shell.dataset.edge = placed.edge;
  shell.dataset.ax = String(placed.anchor.x);
  shell.dataset.ay = String(placed.anchor.y);
  shell.dataset.anchor = placed.anchor.x > placed.width / 2 ? "end" : "start";
  shell.style.setProperty("--ax", `${placed.anchor.x}px`);
  shell.style.setProperty("--ay", `${placed.anchor.y}px`);
  const shift = iconShift(placed.anchor.x, placed.anchor.y, placed.width, placed.height);
  shell.style.setProperty("--icon-dx", `${shift.x}px`);
  shell.style.setProperty("--icon-dy", `${shift.y}px`);
  shell.style.transformOrigin = `${placed.anchor.x}px ${placed.anchor.y}px`;
  syncPlanSide(shell);
  return placed;
}

function layoutShell(shell) {
  if (!shell || shell.classList.contains("is-morphing")) return;
  if (state.dragHitId && state.dragHitId === shell.dataset.hitId) return;
  const placed = placeShellElement(shell);
  const visual = shell.dataset.visual || "orb";
  paintClip(shell, insetsFor(visual, {
    boxW: placed.width,
    boxH: placed.height,
    ax: placed.anchor.x,
    ay: placed.anchor.y,
  }), visual);
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
    };
    const plan = shell.querySelector(".plan-window");
    const planOpen = plan && shell.dataset.planOpen === "1";
    if (!planOpen) return box;
    const dockedWidth = plan.offsetWidth || plan.getBoundingClientRect().width
      || Math.min(420, (window.innerWidth || 1280) * 0.42);
    const dock = includePlan(box, {
      side: shell.dataset.planSide === "left" ? "left" : "right",
      width: dockedWidth,
    });
    dock.shell = shell;
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
    const ay = box.edge === "bottom" ? box.height - ORB / 2 : box.edge === "top" ? ORB / 2 : Number(shell.dataset.ay) || ORB / 2;
    shell.dataset.ay = String(ay);
    shell.style.setProperty("--ay", `${ay}px`);
    const shift = iconShift(ax, ay, prev.width, box.height);
    shell.style.setProperty("--icon-dx", `${shift.x}px`);
    shell.style.setProperty("--icon-dy", `${shift.y}px`);
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
  const box = shell.getBoundingClientRect();
  const insets = readInsets(shell);
  return {
    x: box.x + insets.left,
    y: box.y + insets.top,
    w: Math.max(0, box.width - insets.left - insets.right),
    h: Math.max(0, box.height - insets.top - insets.bottom),
  };
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

function cancelClipAnims(shell) {
  const fill = shell.querySelector(".morph-fill");
  shell.getAnimations?.().forEach((anim) => anim.cancel());
  fill?.getAnimations?.().forEach((anim) => anim.cancel());
  shell.querySelector(".morph-orb")?.getAnimations?.().forEach((anim) => anim.cancel());
  shell.querySelector(".morph-glow")?.getAnimations?.().forEach((anim) => anim.cancel());
  shell.querySelector(".plan-window")?.getAnimations?.().forEach((anim) => anim.cancel());
}

/** Stylesheet transitions must not run beside a WAAPI clip. WebKitGTK will
 *  stretch a left or right collapse past 300ms when both are active. */
function holdMotion(el) {
  el?.style.setProperty("transition", "none", "important");
}

function releaseMotion(el) {
  el?.style.removeProperty("transition");
}

function pxOf(shell, name) {
  const n = Number.parseFloat(shell.style.getPropertyValue(name));
  return Number.isFinite(n) ? n : 0;
}

function whenAnimEnds(anim, duration) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      resolve(ok);
    };
    const timer = window.setTimeout(() => {
      try {
        if (anim.playState !== "finished") anim.currentTime = duration;
      } catch { /* already finished */ }
      finish(true);
    }, duration);
    anim.finished.then(() => finish(true), () => finish(false));
  });
}

/**
 * Pixel keyframes. A 999px radius stays a stadium while the inset grows, and
 * WebKitGTK does not interpolate calc() insets, so both the rect and the
 * corner radius (pill height / 2 → 3px) are plain px and run on the Web
 * Animations API. The duration is the animation's own clock, with no tail
 * timeout that would stretch a left or right collapse past 300ms.
 */
function playClip(shell, fromState, toState, duration, token, easing = EASE) {
  const fill = shell.querySelector(".morph-fill");
  const from = insetsFor(fromState, shellGeom(shell));
  const to = insetsFor(toState, shellGeom(shell));
  if (shell.dataset.morphToken !== token) return Promise.resolve(false);
  shell.classList.remove("is-growing-pill", "is-growing-panel");
  holdMotion(shell);
  holdMotion(fill);
  cancelClipAnims(shell);
  if (reducedMotion() || !(duration > 0)) {
    writeClip(shell, to);
    if (toState === "panel") playContentIn(shell, 0);
    return Promise.resolve(true);
  }
  writeClip(shell, from);
  void shell.offsetWidth;
  const timing = { duration, easing, fill: "forwards" };
  let shellAnim;
  let fillAnim;
  try {
    shellAnim = shell.animate([
      { clipPath: clipPath(from) },
      { clipPath: clipPath(to) },
    ], timing);
    if (toState === "panel") playContentIn(shell, duration);
    if (fill) {
      fillAnim = fill.animate([
        { clipPath: clipPath(tighten(from)) },
        { clipPath: clipPath(tighten(to)) },
      ], timing);
    }
  } catch {
    writeClip(shell, to);
    if (toState === "panel") playContentIn(shell, 0);
    return Promise.resolve(shell.dataset.morphToken === token);
  }
  if (toState === "panel") shell.classList.add("is-growing-panel");
  else if (toState === "pill") shell.classList.add("is-growing-pill");
  if (toState !== "orb") {
    const track = () => {
      if (shell.dataset.morphToken !== token) return;
      scheduleHitSync();
      if (!shellAnim || shellAnim.playState === "finished" || shellAnim.playState === "idle") return;
      requestAnimationFrame(track);
    };
    requestAnimationFrame(track);
  } else {
    scheduleHitSync();
  }
  return whenAnimEnds(shellAnim, duration).then((finished) => {
    if (shell.dataset.morphToken !== token) return false;
    if (!finished) return false;
    pauseHitSync();
    // The content fade is the WAAPI started with this clip. Writing opacity
    // or transition here restarts it and drops the seam's first frame.
    holdMotion(shell);
    holdMotion(fill);
    const revealPlan = toState === "panel"
      && shell.dataset.planOpen === "1"
      && !shell.classList.contains("is-collapsing");
    if (revealPlan) {
      const fillEl = shell.querySelector(".morph-fill");
      if (fillEl) fillEl.style.clipPath = clipPath(tighten(to));
      shell.style.clipPath = "none";
      shell.dataset.clipTop = String(to.top);
      shell.dataset.clipRight = String(to.right);
      shell.dataset.clipBottom = String(to.bottom);
      shell.dataset.clipLeft = String(to.left);
      shell.dataset.clipRadius = String(to.radius);
    } else {
      writeClip(shell, to);
    }
    shell.classList.remove("is-growing-pill", "is-growing-panel");
    shellAnim.cancel();
    fillAnim?.cancel();
    return true;
  });
}

function planWidthPx() {
  return Math.min(420, (window.innerWidth || 1280) * 0.42);
}

/** Side from the parked box. Reading layout here is what stalls the seam. */
function sideFromStyle(shell) {
  const left = Number.parseFloat(shell.style.left) || 0;
  const width = Number.parseFloat(shell.style.width) || 0;
  const roomRight = (window.innerWidth || 1280) - (left + width);
  return roomRight >= planWidthPx() ? "right" : "left";
}

/** The plan sits outside the shell box. A shell clip or overflow:hidden
 *  hides the seam grow, then the open rect appears in one frame. */
function showPlanHost(shell) {
  shell.style.setProperty("overflow", "visible", "important");
  shell.style.background = "transparent";
  shell.style.setProperty("filter", "none", "important");
  shell.style.clipPath = "none";
  const fill = shell.querySelector(".morph-fill");
  if (fill && !fill.style.clipPath) fill.style.clipPath = "inset(0px 0px 0px 0px round 3px)";
}

/** Park the seam while the panel clip is still covering it, before content
 *  fades in. The handoff must not flip display, filter, or measure. */
function armPlanSeam(shell) {
  const plan = shell.querySelector(".plan-window");
  if (!plan || shell.dataset.planOpen !== "1") return;
  const side = shell.dataset.planSide === "left" ? "left" : sideFromStyle(shell);
  shell.dataset.planSide = side;
  const width = planWidthPx();
  shell.dataset.seamWidth = String(width);
  plan.hidden = false;
  plan.classList.add("is-seam-grow");
  plan.style.setProperty("display", "flex", "important");
  plan.style.setProperty("overflow", "hidden", "important");
  holdMotion(plan);
  plan.style.clipPath = clipPath(seamInsets(width, side, false));
}

function cancelContentIn(shell) {
  shell.querySelectorAll(".content, .morph-body").forEach((el) => {
    el.getAnimations?.().forEach((anim) => {
      if (anim.id === "content-in") anim.cancel();
    });
  });
}

/** One opacity animation, started in the same turn as the panel clip.
 *  No delay and no later inline opacity: a delay makes WebKitGTK replay from 0. */
function playContentIn(shell, duration) {
  const nodes = [...shell.querySelectorAll(".content, .morph-body")];
  cancelContentIn(shell);
  const frames = duration > 0
    ? [{ opacity: 0 }, { opacity: 1 }]
    : [{ opacity: 1 }, { opacity: 1 }];
  const timing = {
    duration: duration > 0 ? CONTENT_IN_MS : 1,
    easing: "linear",
    fill: "forwards",
    id: "content-in",
  };
  nodes.forEach((el) => {
    try { el.animate(frames, timing); } catch { /* .open keeps the resting opacity */ }
  });
}

function primePanelTail(shell) {
  shell.classList.add("is-content-promoted", "is-orb-moving");
  shell.classList.remove("is-orb-docked");
  armPlanSeam(shell);
}

function growPlan(shell, token) {
  const plan = shell.querySelector(".plan-window");
  if (!plan || shell.dataset.planOpen !== "1") return Promise.resolve();
  if (token && shell.dataset.morphToken !== token) return Promise.resolve();
  plan.getAnimations?.().forEach((anim) => anim.cancel());
  if (reducedMotion()) {
    plan.style.clipPath = "";
    plan.style.removeProperty("display");
    plan.classList.remove("is-seam-grow");
    return Promise.resolve();
  }
  const armed = plan.classList.contains("is-seam-grow") && !!plan.style.clipPath;
  if (!armed) {
    syncPlanSide(shell);
    plan.hidden = false;
    plan.classList.add("is-seam-grow");
    plan.style.setProperty("display", "flex", "important");
    plan.style.setProperty("overflow", "hidden", "important");
    holdMotion(plan);
    showPlanHost(shell);
    const side = shell.dataset.planSide === "left" ? "left" : "right";
    const width = planWidthPx();
    shell.dataset.seamWidth = String(width);
    plan.style.clipPath = clipPath(seamInsets(width, side, false));
  } else if (shell.style.clipPath !== "none") {
    shell.style.clipPath = "none";
  }
  const side = shell.dataset.planSide === "left" ? "left" : "right";
  const width = Number(shell.dataset.seamWidth) || planWidthPx();
  const from = seamInsets(width, side, false);
  const to = seamInsets(width, side, true);
  let anim;
  try {
    anim = plan.animate([
      { clipPath: clipPath(from) },
      { clipPath: clipPath(to) },
    ], { duration: PLAN_GROW_MS, easing: EASE, fill: "forwards" });
  } catch {
    plan.style.clipPath = clipPath(to);
    return Promise.resolve();
  }
  // Do not pin the animation clock. A layout flush freezes the timeline at
  // the frame start, so the first painted frame is already most of the way
  // through the ease and the orb's visible move collapses to about 100ms.
  return whenAnimEnds(anim, PLAN_GROW_MS).then((finished) => {
    if (token && shell.dataset.morphToken !== token) return;
    if (!finished) return;
    plan.style.clipPath = clipPath(to);
    anim.cancel();
    holdMotion(plan);
  });
}

const GLOW = 140;

/** After the panel clip, slide the orb (and its glow) to the header corner. */
function moveOrbToHeader(shell, token) {
  if (token && shell.dataset.morphToken !== token) return Promise.resolve();
  const orb = shell.querySelector(".morph-orb");
  const glow = shell.querySelector(".morph-glow");
  const dx = pxOf(shell, "--icon-dx");
  const dy = pxOf(shell, "--icon-dy");
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
  holdMotion(orb);
  holdMotion(glow);
  const scale = ICON / ORB;
  const timing = { duration: PLAN_GROW_MS, easing: EASE, fill: "forwards" };
  let orbAnim;
  let glowAnim;
  try {
    orbAnim = orb.animate([
      { transform: "translate(0px, 0px) scale(1)" },
      { transform: `translate(${dx}px, ${dy}px) scale(${scale})` },
    ], timing);
    if (glow) {
      const half = GLOW / 2;
      glowAnim = glow.animate([
        { transform: `translate(${-half}px, ${-half}px)` },
        { transform: `translate(${-half + dx}px, ${-half + dy}px)` },
      ], timing);
    }
  } catch {
    shell.classList.remove("is-orb-moving");
    shell.classList.add("is-orb-docked");
    return Promise.resolve();
  }
  return whenAnimEnds(orbAnim, PLAN_GROW_MS).then((finished) => {
    if (token && shell.dataset.morphToken !== token) return;
    if (!finished) return;
    try {
      if (glowAnim && orbAnim.currentTime != null) glowAnim.currentTime = orbAnim.currentTime;
    } catch { /* already finished */ }
    shell.classList.add("is-orb-docked");
    shell.classList.remove("is-orb-moving");
    orbAnim.cancel();
    glowAnim?.cancel();
    releaseMotion(orb);
    releaseMotion(glow);
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

function settleShell(shell, target) {
  markVisual(shell, target);
  shell.classList.remove("is-growing-pill", "is-growing-panel");
  const fill = shell.querySelector(".morph-fill");
  if (target === "panel") {
    if (!shell.classList.contains("is-orb-moving")) shell.classList.add("is-orb-docked");
    if (shell.dataset.contentOnce !== "1") revealContent(shell);
  } else {
    shell.classList.remove("open", "is-content-hold", "is-orb-docked", "is-orb-moving");
    shell.dataset.contentOnce = "";
    releaseContent(shell);
  }
  const plan = shell.querySelector(".plan-window");
  shell.classList.remove("is-morphing", "is-collapsing");
  shell.style.removeProperty("overflow");
  shell.style.background = "";
  shell.style.removeProperty("filter");
  const promoted = shell;
  requestAnimationFrame(() => promoted.classList.remove("is-content-promoted"));
  releaseMotion(shell);
  releaseMotion(fill);
  if (plan) {
    plan.classList.remove("is-seam-grow");
    plan.style.removeProperty("display");
    plan.style.removeProperty("overflow");
    plan.style.clipPath = "";
    releaseMotion(plan);
  }
  paintClip(shell, insetsFor(target, shellGeom(shell)), target);
  shell.dataset.opening = "";
  shell.dataset.intent = "";
  if (target === "orb") {
    shell.querySelectorAll(".center-panel").forEach((panel) => {
      panel.hidden = true;
    });
    layoutShell(shell);
  }
  if (target === "panel" && shell.dataset.kind === "bot") stickChat(shell.dataset.botId);
  if (target === "panel" && shell.dataset.botId === "cron") syncCronBox();
  separateOpenShells([...document.querySelectorAll(".morph")]);
  scheduleHitSync();
}

function stopShellTransition(shell) {
  const fill = shell.querySelector(".morph-fill");
  holdMotion(shell);
  holdMotion(fill);
  cancelClipAnims(shell);
  const plan = shell.querySelector(".plan-window");
  if (plan) {
    holdMotion(plan);
    plan.style.clipPath = "";
    plan.style.removeProperty("display");
    plan.classList.remove("is-seam-grow");
  }
  shell.classList.remove("is-growing-pill", "is-growing-panel", "is-orb-moving", "is-content-promoted");
}

async function runShellMorph(shell, target) {
  if (!shell) return false;
  if (target !== "orb" && shell.dataset.intent === "close") return false;
  const token = String((Number(shell.dataset.morphToken) || 0) + 1);
  shell.dataset.morphToken = token;
  shell.getAnimations?.().forEach((anim) => anim.cancel());
  stopShellTransition(shell);
  const alive = () => shell.dataset.morphToken === token && shell.isConnected;
  const from = shell.dataset.visual || shell.dataset.state || "orb";
  window.clearTimeout(shell._pillTimer);
  if (target === "orb" && dropParkedAnchor(state.anchors, shell.dataset.botId)) layoutShell(shell);
  shell.classList.add("is-morphing");
  if (from === target && !shell.classList.contains("is-collapsing")) {
    if (alive()) settleShell(shell, target);
    return true;
  }
  if (target === "orb") {
    holdMotion(shell);
    holdMotion(shell.querySelector(".morph-fill"));
    shell.dataset.intent = "close";
    shell.classList.add("is-collapsing");
    shell.classList.remove("is-orb-docked", "is-orb-moving", "is-content-hold", "open");
    shell.dataset.contentOnce = "";
    shell.dataset.opening = "";
    releaseContent(shell);
  } else {
    shell.classList.remove("is-collapsing");
    if (shell.dataset.intent === "close") {
      shell.classList.remove("is-morphing");
      return false;
    }
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
    } else {
      shell.dataset.opening = "";
      shell.classList.remove("is-orb-docked");
      resetContent(shell);
    }
  }
  let current = from;
  for (const step of phaseList(shell.dataset.edge || "bottom", from, target)) {
    if (step.state === "panel" && target === "panel") {
      if (from === "pill") {
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        if (!alive()) return false;
      }
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
      return false;
    }
    current = step.state;
  }
  if (!alive()) return false;
  if (target === "panel") {
    await Promise.all([growPlan(shell, token), moveOrbToHeader(shell, token)]);
  }
  if (!alive()) return false;
  settleShell(shell, target);
  return true;
}

function raisePanel(panel) {
  const host = panel?.closest?.(".morph") || panel;
  if (!host) return;
  state.panelZ += 1;
  host.style.zIndex = String(state.panelZ);
  scheduleHitSync();
}

function bindPanelDrag(panel) {
  const host = panel.closest?.(".morph") || panel;
  const header = panel.querySelector(".panel-header, .settings-head");
  if (!header || header.dataset.dragBound) return;
  header.dataset.dragBound = "1";
  header.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    if (event.target.closest("button, input, textarea, select, a, label")) return;
    event.preventDefault();
    state.dragHitId = host.dataset.hitId || "";
    raisePanel(host);
    flushHits();
    const startX = event.clientX;
    const startY = event.clientY;
    const origin = host.getBoundingClientRect();
    host.style.right = "auto";
    host.style.bottom = "auto";
    host.style.left = `${origin.left}px`;
    host.style.top = `${origin.top}px`;
    const move = (ev) => {
      if (ev.pointerId !== event.pointerId) return;
      host.style.left = `${origin.left + ev.clientX - startX}px`;
      host.style.top = `${origin.top + ev.clientY - startY}px`;
      syncPlanSide(host);
      rememberAnchor(host);
      scheduleHitSync();
    };
    const up = (ev) => {
      if (ev.pointerId !== event.pointerId) return;
      header.removeEventListener("pointermove", move);
      header.removeEventListener("pointerup", up);
      header.removeEventListener("pointercancel", up);
      state.dragHitId = "";
      rememberAnchor(host);
      layoutShell(host);
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
    minOpacity: 0.18,
    supported: true,
  },
  pointerHitId: "",
  heldKeys: new Set(),
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
  openIds: [],
  anchors: {},
  panelPos: {},
  panelZ: 4,
  slashPanelId: "",
  dragHitId: "",
  souls: new Map(),
  kanbanOpen: false,
  kanban: { board: null, fingerprint: "", unread: false, saving: false, dragging: false },
  kanbanTimer: 0,
  cronOpen: false,
  cronGroups: [],
  cronTimer: 0,
  cronClock: 0,
  cronBoxH: 0,
  cronBurst: false,
  cronSeenRun: new Set(),
  cronRunMarks: new Map(),
  cronPrimed: false,
  toastSeq: 0,
};

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
    button.textContent = text;
    banner.appendChild(button);
    return;
  }
  banner.textContent = text;
  if ((kind === "ok" || kind === "info") && sticky !== "keyring") {
    bannerTimer = window.setTimeout(() => {
      bannerTimer = 0;
      if (banner.dataset.sticky === "keyring") return;
      setBanner("");
    }, BANNER_OK_MS);
  }
}

function clearConnectionBanner() {
  const banner = $("#conn-banner");
  if (banner.dataset.sticky === "keyring") return;
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

function attachShell(shell, id) {
  shell.addEventListener("click", (event) => {
    const orb = event.target.closest?.(".morph-orb");
    if (shell.dataset.state === "panel" && !orb) return;
    if (shell.dataset.state === "panel") {
      raisePanel(shell);
      return;
    }
    if (!orb && shell.dataset.state === "orb") return;
    if (state.interaction.supported !== false && !modifierHeld(event)) return;
    if (id === "settings") focusSettings();
    else if (id === "kanban") toggleKanban();
    else if (id === "cron") toggleCron();
    else selectBot(id);
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
  if (plan) shell.append(plan);
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
  shell.append(fill, btn, previewNode());
  attachShell(shell, bot.id);
  $("#bot-rail").appendChild(shell);
  mountBotPanel(shell, bot.id);
  return shell;
}

function ensureChromeShell(panel, id, glyph, label, orbClass) {
  let shell = shellFor(id);
  if (shell) return shell;
  shell = document.createElement("div");
  shell.className = "morph";
  shell.dataset.kind = "chrome";
  shell.dataset.botId = id;
  shell.dataset.state = "orb";
  shell.dataset.visual = "orb";
  shell.dataset.hitId = `bot:${id}`;
  const fill = document.createElement("div");
  fill.className = "morph-fill";
  const glow = document.createElement("div");
  glow.className = "morph-glow";
  fill.appendChild(glow);
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = `bot-btn morph-orb ${orbClass}`;
  btn.dataset.botId = id;
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
  shell.append(fill, btn, previewNode(), panel);
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

function renderBots() {
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
    const morphing = shell.classList.contains("is-morphing") || shell.classList.contains("is-collapsing");
    const btn = shell.querySelector(".morph-orb");
    const thread = threadFor(bot.id);
    const keepEnter = btn.classList.contains("orb-enter") && bot.id === state.activeId;
    const classes = ["bot-btn", "morph-orb"];
    if (state.openIds.includes(bot.id) || shell.dataset.state === "panel") classes.push("active");
    const motion = orbMotion(thread.activity, thread.statusState);
    if (motion === "spin") classes.push("is-thinking");
    if (motion === "wait") classes.push("is-waiting");
    if (thread.unread) classes.push("has-unread");
    if (thread.statusState === "error") classes.push("error");
    if (bot.id === pulseId || keepEnter) classes.push("orb-enter");
    btn.className = classes.join(" ");
    applyBotColor(shell, bot.color);
    applyBotColor(btn, bot.color);
    btn.setAttribute("aria-label", bot.name);
    btn.title = bot.name;
    btn.querySelector(".orb-glyph").textContent = bot.short || "";
    btn.querySelector(".bot-label").textContent = bot.name;
    if (!morphing) layoutShell(shell);
    // Moving a node that is already in the rail restarts CSS transitions on it,
    // which replays the content fade and snaps a clip that is still running.
    if (shell.parentElement !== rail) rail.appendChild(shell);
  });
  renderKanbanOrb();
  renderCronOrb();
  renderSettingsOrb();
  separateOpenShells([...document.querySelectorAll(".morph")]);
  scheduleHitSync();
}

function renderSettingsOrb() {
  ensureChrome();
  const shell = shellFor("settings");
  const btn = shell?.querySelector(".orb--settings");
  if (!btn) return;
  btn.className = ["bot-btn", "morph-orb", "orb--settings", settingsOpen() ? "active" : ""].filter(Boolean).join(" ");
  applyBotColor(shell, NOUS.blue);
  applyBotColor(btn, NOUS.blue);
  btn.setAttribute("aria-label", "Hermes 設定");
  btn.title = "Hermes 設定";
  layoutShell(shell);
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
  btn.append(hit, core, glyph, spinner, unread);
}

function renderKanbanOrb() {
  ensureChrome();
  const shell = shellFor("kanban");
  const btn = shell?.querySelector(".orb--kanban");
  if (!btn) return;
  btn.className = ["bot-btn", "morph-orb", "orb--kanban", state.kanbanOpen ? "active" : "", state.kanban.unread ? "has-unread" : ""]
    .filter(Boolean)
    .join(" ");
  applyBotColor(shell, NOUS.neutral);
  applyBotColor(btn, NOUS.neutral);
  btn.setAttribute("aria-label", "看板");
  btn.title = "看板";
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

function placeCronReadout(shell, face) {
  const label = document.getElementById("cron-readout");
  const btn = shell?.querySelector(".orb--cron");
  if (!label || !btn) return;
  const text = face?.label || "";
  const show = !!text && (shell.dataset.visual || shell.dataset.state) === "orb";
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

function renderCronOrb(options = {}) {
  ensureChrome();
  const shell = shellFor("cron");
  const btn = shell?.querySelector(".orb--cron");
  if (!btn) return;
  pruneRunMarks(state.cronGroups, state.cronRunMarks);
  const face = cronOrbFace(state.cronGroups, new Date(), state.cronRunMarks);
  if (!options.tick && noteCronTransition(state.cronGroups) && face.mode !== "failed" && !state.cronBurst) {
    state.cronBurst = true;
    window.setTimeout(() => {
      state.cronBurst = false;
      btn.classList.remove("is-done");
    }, 400);
  }
  const live = face.mode === "spin" || face.mode === "progress";
  shell.classList.toggle("is-cron-live", live);
  shell.classList.toggle("is-cron-fail", face.mode === "failed");
  const classes = ["bot-btn", "morph-orb", "orb--cron"];
  if (state.cronOpen) classes.push("active");
  if (face.mode === "spin") classes.push("is-running");
  if (face.mode === "progress") classes.push("is-progress");
  if (face.mode === "failed") classes.push("is-failed");
  if (state.cronBurst) classes.push("is-done");
  btn.className = classes.join(" ");
  if (face.mode === "progress" || face.mode === "failed") btn.style.setProperty("--p", String(face.p));
  else btn.style.removeProperty("--p");
  applyBotColor(shell, NOUS.neutral);
  applyBotColor(btn, NOUS.neutral);
  const caption = live ? "排程工作進行中" : face.mode === "failed" ? "排程工作失敗" : "排程工作";
  btn.setAttribute("aria-label", caption);
  btn.title = caption;
  if (!options.tick) layoutShell(shell);
  placeCronReadout(shell, face);
  syncCronClock(face);
  if (options.tick) paintCronArcs();
}

function renderChat(id = state.activeId) {
  const panel = panelFor(id);
  if (!panel) return;
  const bot = state.bots.find((b) => b.id === id);
  const chat = role(panel, "chat");
  if (!bot || !chat) return;
  const thread = threadFor(bot.id);
  if (thread.followTail === false) thread.scrollTop = chat.scrollTop;
  markProgrammaticScroll(chat);
  chat.innerHTML = "";
  const title = role(panel, "name");
  if (title) title.textContent = bot.name;
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
  paintOrb(role(panel, "avatar"), bot.color, bot.short || "");
  applyBotColor(panel, bot.color);
  thread.messages.forEach((m) => chat.appendChild(bubbleEl(m, bot.id)));
  stickChat(id);
  paintPlan(id);
  paintSessionSelect(id);
  const stop = role(panel, "stop");
  const send = role(panel, "send");
  if (stop) stop.hidden = !(state.mode === "hermes" && state.busy.has(bot.id));
  if (send) send.disabled = state.mode === "hermes" && state.busy.has(bot.id);
  syncActivityChrome(id);
  scheduleHitSync();
}

function planWindow(id) {
  return shellFor(id)?.querySelector(".plan-window") || null;
}

function syncPlanSide(shell) {
  const plan = shell?.querySelector?.(".plan-window");
  if (!shell || !plan) return;
  const box = shell.getBoundingClientRect();
  const width = Math.min(420, (window.innerWidth || 1280) * 0.42);
  const roomRight = (window.innerWidth || 1280) - box.right;
  shell.dataset.planSide = roomRight >= width ? "right" : "left";
}

function openPlanWindow(id, key) {
  const thread = threadFor(id);
  thread.planFocus = key || "";
  thread.planDismissed = "";
  paintPlan(id);
}

function paintPlan(id) {
  const shell = shellFor(id);
  const section = planWindow(id);
  if (!shell || !section) return;
  const thread = threadFor(id);
  const plans = plansIn(thread.messages);
  noteNewestPlan(thread, plans);
  const newest = plans.at(-1) || null;
  const focus = plans.find((item) => item.key === thread.planFocus) || newest;
  const open = !!(focus && thread.planDismissed !== focus.key);
  const wasOpen = shell.dataset.planOpen === "1";
  section.hidden = !open;
  if (open) shell.dataset.planOpen = "1";
  else delete shell.dataset.planOpen;
  if (!open) {
    scheduleHitSync();
    return;
  }
  section.dataset.key = focus.key;
  const title = role(section, "plan-title");
  if (title) title.textContent = focus.title;
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
      const html = renderAssistantMarkdown(focus.markdown);
      if (body.dataset.md !== html) {
        body.dataset.md = html;
        body.innerHTML = html;
        decorateCodeBlocks(body);
      }
    }
  }
  if (source) {
    source.hidden = mode !== "source";
    if (mode === "source" && source.textContent !== focus.markdown) source.textContent = focus.markdown;
  }
  syncPlanSide(shell);
  separateOpenShells([...document.querySelectorAll(".morph")]);
  const morphing = shell.classList.contains("is-morphing") || shell.classList.contains("is-collapsing");
  if (open && !wasOpen && !morphing) void growPlan(shell, shell.dataset.morphToken || "");
  scheduleHitSync();
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
    paintPlan(id);
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

function bubbleEl(m, id) {
  const bubble = document.createElement("div");
  bubble.className = `bubble ${m.role === "user" ? "user" : m.role === "bot" ? "bot" : m.role}`;
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
  el.innerHTML = html;
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
    if (!chat || thread.followTail === false) return;
    markProgrammaticScroll(chat);
    chat.scrollTop = chat.scrollHeight;
  };
  apply();
  const token = (pinTokens.get(id) || 0) + 1;
  pinTokens.set(id, token);
  requestAnimationFrame(() => {
    if (pinTokens.get(id) !== token) return;
    apply();
    requestAnimationFrame(() => {
      if (pinTokens.get(id) !== token) return;
      apply();
      requestAnimationFrame(() => {
        if (pinTokens.get(id) !== token) return;
        const chat = chatOf(id);
        if (chat) delete chat.dataset.programmaticScroll;
      });
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

function appendMessage(id, message) {
  const thread = threadFor(id);
  thread.messages.push(message);
  const chat = chatOf(id);
  if (!chat) return;
  chat.appendChild(bubbleEl(message, id));
  if (thread.followTail !== false) pinChat(id);
  paintPlan(id);
}

function setBotStatus(id, text, statusState) {
  const thread = threadFor(id);
  thread.status = text;
  thread.statusState = statusState;
  if (statusState === "busy") state.busy.add(id);
  else state.busy.delete(id);
  if (panelFor(id)) renderChat(id);
  renderBots();
}

function cancelReconnect() {
  state.reconnectToken += 1;
  window.clearTimeout(state.reconnectTimer);
  state.reconnectTimer = 0;
}

function applyOpened(id, opened) {
  const thread = threadFor(id);
  thread.messages = (opened.messages || []).map(presentMessage);
  thread.loaded = true;
  thread.sessionId = opened.session_id || "";
  thread.sessionExplicit = !!opened.session_explicit;
  thread.sessionAnchor = Number(opened.session_anchor) || 0;
  thread.sessions = opened.sessions || [];
  thread.loading = false;
  clearConnectionBanner();
  setBotStatus(id, "閒置", "idle");
}

async function loadBotHistory(id, token) {
  const { invoke } = await import("@tauri-apps/api/core");
  const opened = await invoke("open_bot", { profile: id });
  if (token !== state.reconnectToken || state.mode !== "hermes") return false;
  applyOpened(id, opened);
  return true;
}

function paintSessionSelect(id) {
  const select = role(panelFor(id), "session");
  if (!select || document.activeElement === select) return;
  const thread = threadFor(id);
  const sessions = orderSessions(thread.sessions || []);
  const key = JSON.stringify([thread.sessionId, sessions.map((session) => [session.id, session.title, session.hidden])]);
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
  if (state.busy.has(id)) {
    if (select) select.value = thread.sessionId;
    showActionError("呢個 Bot 仲喺度回覆，停咗先至轉對話。");
    return;
  }
  if (state.mode !== "hermes" || !inTauri()) {
    if (!thread.bySession) thread.bySession = new Map();
    thread.bySession.set(thread.sessionId, thread.messages.map((message) => ({ ...message })));
    const anchor = Math.max(0, ...(thread.sessions || []).map((session) => Number(session.last_active) || 0));
    thread.sessionId = sessionId;
    thread.sessionExplicit = true;
    thread.sessionAnchor = anchor;
    const stored = thread.bySession.get(sessionId);
    thread.messages = (stored || [{ role: "bot", text: "（舊對話）" }]).map((message) => ({ ...message }));
    thread.loaded = true;
    if (select) delete select.dataset.key;
    renderChat(id);
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

function armReconnect(id, attempt, token) {
  window.clearTimeout(state.reconnectTimer);
  state.reconnectTimer = window.setTimeout(() => {
    if (token !== state.reconnectToken) return;
    retryHistory(id, attempt, token);
  }, reconnectDelayMs(attempt));
}

async function retryHistory(id, attempt, token) {
  if (token !== state.reconnectToken || state.mode !== "hermes") return;
  try {
    await loadBotHistory(id, token);
  } catch (err) {
    if (token !== state.reconnectToken) return;
    if (gatewayDown(String(err))) armReconnect(id, attempt + 1, token);
  }
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
  if (shell && shell.dataset.state === "panel" && !shell.classList.contains("is-collapsing")) {
    if (!state.openIds.includes(id)) state.openIds = openPanel(state.openIds, id);
    raisePanel(shell);
    renderBots();
    return;
  }
  openBotPanel(id);
  renderBots();
  renderChat(id);
  if (state.mode !== "hermes" || !inTauri()) return;
  const thread = threadFor(id);
  if (thread.loaded || thread.loading) return;
  cancelReconnect();
  const token = state.reconnectToken;
  thread.loading = true;
  setBotStatus(id, "載入對話…", "busy");
  try {
    await loadBotHistory(id, token);
  } catch (err) {
    thread.loaded = false;
    const message = String(err);
    if (gatewayDown(message)) {
      setBotStatus(id, "連線錯誤", "error");
      setBanner(message, "error");
      armReconnect(id, 0, token);
    } else {
      appendMessage(id, { role: "commentary", text: message });
      setBotStatus(id, "連線錯誤", "error");
      setBanner(message, "error");
    }
  } finally {
    thread.loading = false;
  }
}

function openBotPanel(id) {
  const bot = state.bots.find((item) => item.id === id);
  const shell = shellFor(id) || (bot ? ensureBotShell(bot) : null);
  if (!shell) return null;
  threadFor(id).followTail = true;
  state.openIds = openPanel(state.openIds, id);
  window.clearTimeout(shell._pillTimer);
  shell.dataset.intent = "open";
  raisePanel(shell);
  void runShellMorph(shell, "panel");
  void loadSoul(id);
  scheduleHitSync();
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
  renderBots();
}

async function finishClose(shell) {
  const closed = await runShellMorph(shell, "orb");
  if (!closed || !shell.isConnected) return;
  syncLatch();
  scheduleHitSync();
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
    if (event.key === "Enter") sendActive(id);
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
    const current = role(panelFor(id), "soul");
    if (!current || current.dataset.dirty === "1") return;
    current.value = text || "";
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
  const thread = threadFor(id);
  let live = thread.messages[thread.messages.length - 1];
  if (!live || live.role !== "bot" || !live.live) {
    live = { role: "bot", text: "", live: true };
    thread.messages.push(live);
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

function handleHermes(payload) {
  if (!payload || !payload.profile) return;
  const id = payload.profile;
  if (payload.type === "cron") {
    deliverCron(id, payload);
    return;
  }
  if (payload.type === "run.started") {
    noteActivity(id, { type: "run.started" });
    return;
  }
  if (payload.type === "delta") {
    noteActivity(id, { type: "delta" });
    const live = ensureLiveBubble(id);
    live.text += payload.text || "";
    patchLive(id);
    return;
  }
  if (payload.type === "command") {
    const user = [...threadFor(id).messages].reverse().find((item) => item.role === "user");
    if (user && payload.command) {
      user.command = payload.command;
      if (panelFor(id)) renderChat(id);
    }
    return;
  }
  if (payload.type === "commentary") {
    appendMessage(id, { role: "commentary", text: `過程：${payload.text || ""}` });
    if (panelFor(id)) renderChat(id);
    return;
  }
  if (payload.type === "tool") {
    const preview = payload.preview ? ` — ${payload.preview}` : "";
    const text = `${payload.name || "tool"}${preview}`;
    if (payload.phase === "progress") {
      noteActivity(id, { type: "tool.progress", name: payload.name || "", text });
      return;
    }
    noteActivity(id, { type: "tool" });
    const phase = payload.phase === "completed" ? "完成" : payload.phase === "failed" ? "失敗" : "開始";
    appendMessage(id, { role: "tool", text: `${phase} ${text}` });
    if (panelFor(id)) renderChat(id);
    return;
  }
  if (payload.type === "status") {
    const label = payload.detail || (payload.state === "busy" ? "思考中…" : "閒置");
    setBotStatus(id, label, payload.state === "busy" ? "busy" : payload.state === "error" ? "error" : "idle");
    return;
  }
  if (payload.type === "done") {
    const thread = threadFor(id);
    const live = [...thread.messages].reverse().find((m) => m.live);
    painterFor(id).flush();
    if (live) live.live = false;
    if (panelFor(id)) renderChat(id);
    const outcome = payload.outcome === "failed" ? "failed" : payload.outcome === "cancelled" ? "cancelled" : "completed";
    noteActivity(id, { type: outcome, text: outcome === "completed" ? live?.text || "" : payload.detail || "" });
    if (payload.outcome === "completed") clearConnectionBanner();
    if (payload.outcome === "failed" && payload.detail) {
      appendMessage(id, { role: "failure", text: payload.detail });
    }
    setBotStatus(
      id,
      payload.outcome === "failed" ? "回覆失敗" : payload.outcome === "cancelled" ? "已停止" : "閒置",
      payload.outcome === "failed" ? "error" : "idle",
    );
    return;
  }
  if (payload.type === "error") {
    noteActivity(id, { type: "failed", text: payload.message || "未知錯誤" });
    appendMessage(id, { role: "commentary", text: payload.message || "未知錯誤" });
    setBotStatus(id, "連線錯誤", "error");
    setBanner(payload.message || "連線錯誤", "error");
  }
}

async function sendActive(id = state.activeId) {
  const panel = panelFor(id);
  const input = role(panel, "input");
  const text = input?.value.trim() || "";
  if (!text || !id) return;
  state.activeId = id;
  state.slashPanelId = id;
  threadFor(id).followTail = true;
  const busy = state.mode === "hermes" && state.busy.has(id);
  if (sendBlockedWhileBusy(text, state.catalog || [], busy)) return;
  closeSlash();
  input.value = "";
  input.placeholder = "輸入訊息給呢個 Bot…";
  state.slashArgsHint = "";
  syncSlashGhost();
  const action = resolveClient(text, state.catalog || []);
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
  setBotStatus(sentId, "思考中…", "busy");
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("send_chat", { profile: sentId, text });
  } catch (err) {
    const message = String(err);
    noteActivity(sentId, { type: "failed", text: message });
    appendMessage(sentId, { role: "commentary", text: message });
    setBotStatus(sentId, "連線錯誤", "error");
    setBanner(message, "error");
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
    if (!state.busy.has(id)) {
      appendMessage(id, { role: "commentary", text: "已停止呢次回覆。" });
      setBotStatus(id, "已停止", "idle");
    }
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
      { id: `${bot.id}-bot-chat`, title: "Bot Chat", last_active: 80, hidden: false, preview: "" },
      { id: `${bot.id}-splitLot`, title: "_splitLot", last_active: 40, hidden: true, preview: "" },
    ];
    const choice = resolveSession(sessions, { id: "", explicit: false, anchor: 0 });
    thread.sessions = sessions;
    thread.sessionId = choice.id;
    thread.sessionExplicit = false;
    thread.sessionAnchor = choice.anchor;
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
    const added = profilesNeedingKeys(before, synced.bots || []);
    useHermes(synced);
    if (added.length && !synced.keyring_error) {
      const names = added.map((bot) => bot.display_name || bot.profile).join("、");
      setBanner(`${names} 未有 API 金鑰，請喺設定填寫。金鑰唔會自動產生。`, "info", "", "settings");
    }
  } catch (err) {
    useHermes(settings);
    setBanner(String(err), "error");
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
    minOpacity: Number(interaction.min_opacity ?? interaction.minOpacity ?? 0.18),
    supported: interaction.supported !== false,
  };
  document.querySelectorAll(".interact-hint").forEach((hint) => {
    hint.textContent = hintText();
  });
}

function readInteractionForm() {
  return {
    modifier: $("#interaction-modifier").value,
    fade_enabled: false,
    fade_distance: 120,
    min_opacity: Number($("#interaction-min-opacity").value) / 100,
  };
}

function fillSettings(settings) {
  $("#gateway-url").value = settings?.gateway_base_url || "";
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
  const min = interaction.min_opacity ?? interaction.minOpacity ?? 0.18;
  $("#interaction-min-opacity").value = String(Math.round(Number(min) * 100));
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
    scheduleHitSync();
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
        dashboard_base_url: $("#dashboard-url").value.trim(),
        dashboard_token: $("#dashboard-token").value,
        clear_dashboard_token: false,
        interaction: readInteractionForm(),
        bots,
      },
    });
    applyInteraction(settings.interaction);
    state.settings = settings;
    $("#settings-status").textContent = "已儲存。";
    $("#dashboard-token").value = "";
    if (settings.mode === "mock") useMock("未設定 gateway，而家係離線示範模式。", "settings");
    else await connectHermes(settings);
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

async function stopActive(id) {
  const profile = id || state.activeId;
  if (!profile || state.mode !== "hermes" || !inTauri()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("stop_chat", { profile });
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

function topOpenPanel() {
  const shells = [...document.querySelectorAll(".morph")].filter(
    (shell) => shell.dataset.state === "panel" && !shell.classList.contains("is-collapsing"),
  );
  shells.sort((a, b) => (Number(b.style.zIndex) || 0) - (Number(a.style.zIndex) || 0));
  return shells[0]?.querySelector(".center-panel") || null;
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
  const start = field.selectionStart ?? field.value.length;
  const end = field.selectionEnd ?? start;
  field.value = `${field.value.slice(0, start)}${key}${field.value.slice(end)}`;
  const caret = start + key.length;
  if (typeof field.setSelectionRange === "function") field.setSelectionRange(caret, caret);
  field.dispatchEvent(new Event("input", { bubbles: true }));
}

function setupComposer() {
  window.addEventListener("keydown", (event) => {
    const action = composerKeyAction({
      key: event.key,
      ctrlKey: event.ctrlKey,
      altKey: event.altKey,
      metaKey: event.metaKey,
      activeIsComposer: !!composerField && (document.activeElement === composerField || event.target === composerField),
      composerConnected: composerHostOpen(composerField),
    });
    if (action === "remember") {
      rememberComposer();
      return;
    }
    if (action === "insert" && composerField) {
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
    if (composerField && !composerField.contains(event.target)) composerField = null;
  }, true);
  window.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    const menu = $("#orb-menu");
    if (menu && !menu.hidden) {
      closeOrbMenu();
      return;
    }
    if (state.dropdownOpen) {
      state.dropdownOpen = nextDropdownOpen(state.dropdownOpen, "escape");
      return;
    }
    if (slashPopupOpen()) {
      closeSlash();
      return;
    }
    if (isTextField(document.activeElement)) {
      document.activeElement.blur();
      syncLatch();
      return;
    }
    const top = topOpenPanel();
    if (!top) return;
    if (top.id === "settings") closeSettings();
    else if (top.id === "kanban-panel") closeKanban();
    else if (top.id === "cron-panel") closeCron();
    else if (top.dataset.botId) closeBotPanel(top.dataset.botId);
  });
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
  el.style.background = "";
  applyBotColor(el, color || NOUS.neutral);
  const glyph = el.querySelector?.(".orb-glyph");
  if (glyph && letter !== undefined) glyph.textContent = letter;
  else if (letter !== undefined && !glyph) el.textContent = letter;
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

function pushCloseHit(rects, shell, level) {
  const close = shell.querySelector("[data-hit-id^='close:']");
  if (!close || close.hidden || close.closest("[hidden]")) return;
  const box = close.getBoundingClientRect();
  if (box.width < 1 || box.height < 1) return;
  rects.push({
    id: close.dataset.hitId,
    x: box.x - CLOSE_PAD_PX,
    y: box.y - CLOSE_PAD_PX,
    w: box.width + CLOSE_PAD_PX * 2,
    h: box.height + CLOSE_PAD_PX * 2,
    z: level + 40,
    round: false,
  });
}

function collectHits() {
  const rects = [];
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
    } else {
      const box = visibleBox(shell);
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
      const plan = shell.querySelector(".plan-window");
      const planVisible = plan
        && !plan.hidden
        && shell.dataset.state === "panel"
        && !shell.classList.contains("is-morphing")
        && !shell.classList.contains("is-collapsing");
      if (planVisible) {
        const dock = plan.getBoundingClientRect();
        if (dock.width >= 1 && dock.height >= 1) {
          const left = Math.min(rect.x, dock.x);
          const top = Math.min(rect.y, dock.y);
          const right = Math.max(rect.x + rect.w, dock.x + dock.width);
          const bottom = Math.max(rect.y + rect.h, dock.y + dock.height);
          rect.x = left;
          rect.y = top;
          rect.w = right - left;
          rect.h = bottom - top;
        }
      }
      rects.push(rect);
    }
    if (shell.dataset.state === "panel") {
      const slash = role(shell, "slash");
      if (slash?.dataset.hitId) push(slash.dataset.hitId, slash, level + 20);
      pushCloseHit(rects, shell, level);
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

function publishHits() {
  const rects = collectHits();
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
  if (key !== lastHits) {
    lastHits = key;
    if (inTauri()) {
      import("@tauri-apps/api/core")
        .then(({ invoke }) => invoke("set_hit_rects", { rects }))
        .catch(() => {});
    }
  }
  if (!inTauri()) paintLocalProximity(rects);
}

function scheduleHitSync() {
  cancelAnimationFrame(hitFrame);
  hitFrame = requestAnimationFrame(publishHits);
}

function pauseHitSync() {
  cancelAnimationFrame(hitFrame);
  hitFrame = 0;
}

function flushHits() {
  cancelAnimationFrame(hitFrame);
  publishHits();
}

function applyFrames(frames, interactiveAll = false) {
  const map = new Map((frames || []).map((item) => [item.id, item]));
  document.querySelectorAll("[data-hit-id]").forEach((el) => {
    const known = map.get(el.dataset.hitId);
    const nested = !!el.parentElement?.closest?.("[data-hit-id]");
    const value = known == null || nested ? 1 : known.opacity;
    const nextOpacity = String(value);
    if (el.style.getPropertyValue("--hit-opacity") !== nextOpacity) {
      el.style.setProperty("--hit-opacity", nextOpacity);
    }
    if (interactiveAll || known?.capture) el.dataset.hitCapture = "1";
    else delete el.dataset.hitCapture;
  });
  paintOrbLabel();
}

function paintOrbLabel() {
  const label = document.getElementById("orb-hover-label");
  if (!label) return;
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

function engagedModifier(now = performance.now()) {
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

function paintLocalProximity(rects) {
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
    const shell = event.target.closest?.(".morph");
    if (shell && shell.dataset.state === "panel" && !shell.classList.contains("is-collapsing")) raisePanel(shell);
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
        if (payload.focus_owner) applyOsFocus(payload.focus_owner);
        applyFrames(payload.opacities || []);
      });
    });
    window.addEventListener("mousemove", (event) => {
      cursorPoint.x = event.clientX;
      cursorPoint.y = event.clientY;
      paintOrbLabel();
    });
    return;
  }
  document.documentElement.classList.add("overlay-passthrough");
  window.addEventListener("mousemove", (event) => {
    cursorPoint.x = event.clientX;
    cursorPoint.y = event.clientY;
    paintLocalProximity();
  });
  window.addEventListener("keydown", (event) => {
    state.heldKeys.add(event.key);
    paintLocalProximity();
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
  if (state.kanbanOpen && shell && !shell.classList.contains("is-collapsing")) {
    raisePanel(shell);
    return;
  }
  openKanban();
}

function openKanban() {
  ensureChrome();
  state.kanbanOpen = true;
  state.kanban.unread = false;
  const panel = $("#kanban-panel");
  const shell = shellFor("kanban");
  if (panel && shell) {
    const opening = shell.dataset.state !== "panel" || shell.classList.contains("is-collapsing");
    panel.hidden = false;
    applyBotColor(shell, NOUS.neutral);
    applyBotColor(panel, NOUS.neutral);
    window.clearTimeout(shell._pillTimer);
    if (opening) {
      raisePanel(shell);
      void runShellMorph(shell, "panel");
    } else {
      raisePanel(shell);
    }
  }
  renderBots();
  refreshKanban();
  startKanbanPoll();
}

function closeKanban() {
  state.kanbanOpen = false;
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

async function refreshKanban() {
  if (state.kanban.saving || state.kanban.dragging) return;
  let payload;
  if (state.mode !== "hermes" || !inTauri()) {
    payload = state.kanban.board || mockKanban();
  } else {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      payload = await invoke("get_kanban_board", { board: KANBAN_BOARD });
    } catch (err) {
      payload = { unavailable: true, message: String(err) };
    }
  }
  commitKanban(normalizeBoard(payload));
}

function commitKanban(board) {
  const line = kanbanChangeLine(state.kanban.board, board);
  state.kanban.fingerprint = boardFingerprint(board);
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
    board: KANBAN_BOARD,
    columns: [
      { name: "triage", tasks: [{ id: "demo-1", title: "整理今日待辦", assignee: "計劃助手", status: "triage", priority: "high", updated_at: "" }] },
      { name: "ready", tasks: [{ id: "demo-2", title: "對一下看板欄位", assignee: "程式夥伴", status: "ready", priority: "normal", updated_at: "" }] },
    ],
  };
}

function paintKanban(board) {
  const empty = $("#kanban-empty");
  const root = $("#kanban-board");
  const title = $("#kanban-title");
  if (title) title.textContent = board.board || "Board";
  if (!root || !empty) return;
  if (board.unavailable) {
    empty.hidden = false;
    empty.textContent = board.message || KANBAN_EMPTY;
    root.replaceChildren();
    scheduleHitSync();
    return;
  }
  empty.hidden = true;
  root.replaceChildren();
  board.columns.forEach((column) => {
    const col = document.createElement("section");
    col.className = "kanban-col";
    col.dataset.status = column.name;
    const head = document.createElement("header");
    head.className = "kanban-col-head";
    head.lang = "en";
    const name = document.createElement("span");
    name.lang = "en";
    name.textContent = column.name;
    const count = document.createElement("small");
    count.textContent = String(column.tasks.length);
    head.append(name, count);
    const list = document.createElement("div");
    column.tasks.forEach((task) => list.appendChild(kanbanCard(task)));
    col.append(head, list);
    root.appendChild(col);
  });
  scheduleHitSync();
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
  } else {
    resyncKanbanHover(point);
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
  if (state.cronOpen && shell && !shell.classList.contains("is-collapsing")) {
    raisePanel(shell);
    return;
  }
  openCron();
}

function openCron() {
  ensureChrome();
  state.cronOpen = true;
  const panel = $("#cron-panel");
  const shell = shellFor("cron");
  if (panel && shell) {
    const opening = shell.dataset.state !== "panel" || shell.classList.contains("is-collapsing");
    panel.hidden = false;
    applyBotColor(shell, NOUS.neutral);
    applyBotColor(panel, NOUS.neutral);
    window.clearTimeout(shell._pillTimer);
    paintCron();
    if (opening) {
      raisePanel(shell);
      void runShellMorph(shell, "panel");
    } else {
      raisePanel(shell);
      syncCronBox();
    }
  }
  renderBots();
  refreshCron();
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
  if (!inTauri() || state.mode !== "hermes") {
    state.cronGroups = mockCronGroups();
  } else {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const rows = await invoke("list_cron_jobs");
      state.cronGroups = (rows || []).map((row) => normalizeCronGroup(row));
    } catch (err) {
      state.cronGroups = [normalizeCronGroup({
        unavailable: true,
        name: "排程",
        message: String(err),
      })];
    }
  }
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

async function boot() {
  setupComposer();
  setupWindowChrome();
  setupProximity();
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
    refreshKanban();
    startKanbanPoll();
    refreshCron();
    startCronPoll();
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
