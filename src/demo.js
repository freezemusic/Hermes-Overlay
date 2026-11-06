/**
 * English content for the offline demo (`--demo`) when the UI is English (R-LK-02).
 * zh-HK keeps the demo in main.js exactly as it was. Everything here is made up:
 * no real people, chats, trading data or logos.
 */

export const DEMO_BANNER_EN = "Demo mode (--demo): sample bots, not connected to Hermes.";
export const PREVIEW_BANNER = "瀏覽器預覽：離線示範。登入同連線只喺桌面版可用。";
export const PREVIEW_BANNER_EN = "Browser preview: offline demo. Sign-in and connections only work in the desktop app.";

/** Same ids and order as the zh-HK demo, so colours and saved positions line up. */
export const DEMO_BOTS_EN = Object.freeze([
  {
    id: "planner",
    name: "Planner",
    short: "P",
    status: "Online · interactive",
    detail: "Breaks tasks down, sets priorities and follows up on daily progress. Built to sit on top all day.",
    messages: [
      { role: "bot", text: "There are 3 to-dos you could start right now. Which one first?" },
      { role: "user", text: "The most urgent one." },
      { role: "bot", text: "Done. I've marked it urgent with a 25-minute estimate." },
    ],
    float: "Tip: the overlay stays on top without getting in the way of your typing.",
  },
  {
    id: "coder",
    name: "Code Pal",
    short: "C",
    status: "Online · code mode",
    detail: "Desktop and web coding helper. This overlay itself is built with Tauri 2.",
    messages: [
      { role: "bot", text: "Transparent window and always-on-top are on. Want a tray icon too?" },
      { role: "user", text: "Later. First I want to check the orb interactions." },
      { role: "bot", text: "Click an orb and its panel opens right there." },
    ],
    float: "This is the offline demo. Connect Hermes in Settings to use real bots.",
  },
  {
    id: "research",
    name: "Researcher",
    short: "R",
    status: "Standing by",
    detail: "Searches, summarises and keeps track of sources. Sample content only.",
    messages: [{ role: "bot", text: "What topic should I look into? I can start with a short summary." }],
    float: null,
  },
  {
    id: "writer",
    name: "Writer",
    short: "W",
    status: "Online",
    detail: "Drafts replies, rewrites copy and suggests headlines.",
    messages: [
      { role: "bot", text: "Formal or casual?" },
      { role: "user", text: "Casual, and a bit shorter." },
    ],
    float: "Example: make “Could you possibly take a look at this?” shorter.",
  },
  {
    id: "ops",
    name: "Monitor",
    short: "M",
    status: "Watching",
    detail: "Placeholder for CPU, network and agent status. Sample only.",
    messages: [{ role: "bot", text: "No live data here yet. The layout is ready." }],
    float: null,
  },
  {
    id: "voice",
    name: "Voice Bot",
    short: "V",
    status: "Muted",
    detail: "Placeholder for voice in and out. Click to see a sample chat.",
    messages: [{ role: "bot", text: "Voice isn't connected. Try the overlay with text for now." }],
    float: null,
  },
  {
    id: "memory",
    name: "Notebook",
    short: "N",
    status: "Local sample",
    detail: "Remembers preferences and context across sessions (not saved in the demo).",
    messages: [{ role: "bot", text: "These are sample notes only. They reset when the app restarts." }],
    float: null,
  },
  {
    id: "security",
    name: "Guard",
    short: "G",
    status: "On guard",
    detail: "Flags sensitive actions, permissions and click-through risks.",
    messages: [
      { role: "bot", text: "A full-screen transparent overlay can catch stray clicks, so click-through is still experimental." },
    ],
    float: "Esc collapses the open panel. Quit from Settings or the tray.",
  },
]);

export const DEMO_OLD_SESSION_EN = "(Earlier chat)";

/** The demo answer to a sent message. Plans use `planDemoMarkdown` like zh-HK. */
export function demoReplyEn(shown) {
  const text = String(shown?.text || "").trim();
  if (shown?.command === "btw") return `(Demo aside) ${text}`;
  return [
    `(Demo reply) Here's a quick draft for “${text}”:`,
    "",
    "1. List what you already have",
    "2. Pick the three things that matter most",
    "3. Set a day to check back",
    "",
    "Demo mode isn't connected to Hermes.",
  ].join("\n");
}

export function demoCommandEn(action) {
  return `(Demo) ${action?.mapsTo || action?.command || ""}`;
}

export function demoPlanEn(task) {
  const name = String(task || "").trim() || "Untitled task";
  return [
    `# ${name} Implementation Plan`,
    "",
    "**Goal:** agree the scope first, then split it into steps. Nothing runs yet.",
    "",
    "- Line up with the existing panels",
    "- Keep the plan preview next to the chat",
    "",
    "File: `.hermes/plans/demo-plan.md`",
  ].join("\n");
}

export function demoKanbanEn() {
  return {
    board: "",
    columns: [
      {
        name: "triage",
        tasks: [{
          id: "demo-1",
          title: "Sort today's to-dos",
          assignee: "Planner",
          status: "triage",
          priority: "high",
          updated_at: "",
          body: "Group the list into now, later and someday, then pick the top three.",
        }],
      },
      {
        name: "ready",
        tasks: [{
          id: "demo-2",
          title: "Check the board columns",
          assignee: "Code Pal",
          status: "ready",
          priority: "normal",
          updated_at: "",
          body: "Make sure every column name matches the sample workflow.",
        }],
      },
    ],
  };
}

/** Raw groups; main.js normalises them like the zh-HK demo. */
export function demoCronEn(now = Date.now()) {
  const soon = new Date(now + 30 * 60 * 1000).toISOString();
  const earlier = new Date(now - 60 * 60 * 1000).toISOString();
  return [
    {
      profile: "planner",
      name: "Planner",
      jobs: [
        { id: "daily", name: "Daily summary", schedule: "Every day 09:00", enabled: true, next_run_at: soon, last_run_at: earlier, state: "scheduled" },
        { id: "tidy", name: "Tidy the board", schedule: "Mondays 10:00", enabled: false, next_run_at: "", state: "paused" },
      ],
    },
    {
      profile: "coder",
      name: "Code Pal",
      jobs: [
        {
          id: "tests",
          name: "Run the tests",
          schedule: "Every 30 minutes",
          enabled: true,
          next_run_at: soon,
          state: "scheduled",
          fire_claim: { at: earlier, by: "host:demo" },
          latest_execution: { status: "running", started_at: new Date(now - 42 * 1000).toISOString() },
        },
      ],
    },
    { profile: "quiet", name: "Quiet", jobs: [] },
  ];
}

/** zh-HK chrome orb text is the source; English swaps glyph and name together. */
export const CHROME_ORBS = Object.freeze({
  settings: Object.freeze({ "zh-HK": ["設", "設定"], en: ["⚙\uFE0E", "Settings"] }),
  kanban: Object.freeze({ "zh-HK": ["▥", "看板"], en: ["▥", "Kanban"] }),
  cron: Object.freeze({ "zh-HK": ["時", "排程"], en: ["◷", "Schedule"] }),
});

export function chromeOrbText(id, lang) {
  const row = CHROME_ORBS[id];
  if (!row) return null;
  const [glyph, label] = row[lang === "en" ? "en" : "zh-HK"];
  return { glyph, label };
}
