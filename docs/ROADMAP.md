# 路線圖依據：和 Hermes Desktop 的逐項比較

這份文件說明 [README](../README.md#路線圖) 裡的路線圖是怎麼排出來的。查證日期是 2026-11-06（倫敦時間）。

- **Overlay**：v0.3.0（PR #4）。
- **對照版本**：Hermes Agent **v0.22.5 stable = `bf0203a`**，也就是 Devon 伺服器目前跑的版本（2026-11-06 在伺服器上用 `GET /api/status` 和 `hermes --version` 確認）。
- **檔案路徑**：Desktop 的路徑沒有特別註明的，都在 `apps/desktop/` 底下。
- **較新版本**：v0.23.0（`2bd378e`）只比對了路由差異，沒有實測。

## 0. 怎麼讀這份文件

- **事實（原）**：在上面指定的 commit 原始碼裡看到，附 `檔案:行號`。
- **事實（測）**：在一台測試機上的 Hermes v0.22.5（`hermes serve`，basic 登入）實際呼叫過。
  - 99 條 GET 路由。
  - WebSocket RPC。
  - 寫入類：新增後馬上刪除。
- **事實（文）**：官方文件或價目頁。
- **推論**：沒有實測，是判斷。表格裡這類內容一律標「推論」。
- **分類**：
  - **A** = 用現有的 9119 API 就能做。
  - **B** = 做得到，但要寫本機（Overlay/Tauri）的部分。
  - **C** = 要改伺服器。
  - **D** = 做不到，或需要 Devon 決定、需要花錢。
- **工作量**：
  - **S** = 1 天內。
  - **M** = 2–5 天。
  - **L** = 1–3 週。
  - **XL** = 3 週以上。
  - 估算依據：Desktop 該功能的程式碼行數（不含測試），加上 Overlay 過去做類似功能的經驗。

## 1. 先講結論

1. **伺服器這一側幾乎不是瓶頸。**
   - Desktop 用到的 REST 路徑前綴，0.22.5 的 9119 全部都有（事實（原）：0.22.5 共有 374 條路由定義）。
   - 測試機上 GET 99 條的結果：76 條 200，20 條 422（缺參數，代表路由存在），2 條 400，只有 1 條 404（`/api/ssh/ownership`，Desktop 沒用到）。
   - Desktop 呼叫的 94 個 WS RPC method，伺服器只缺 `session.rewind` 一個。Desktop 本身的 rewind 也不是靠這個 method，而是走 `prompt.submit` 截斷（`src/app/session/hooks/use-prompt-actions/rewind.ts:191`；伺服器 `tui_gateway/methods_prompt.py:327-348`）。
   - 寫入類也實測可行：
     - 排程：新增、暫停、刪除都 200。
     - 看板：新增、留言、刪除都 200。
     - `/api/chat/image-upload` 200。
     - Profile：新增、刪除都 200。
2. **真正的瓶頸是本機程式量，還有 Desktop 本身一直在變。**
   - 程式量（事實（原），`wc -l`，不含測試）：
     - Desktop：`src` 約 42.8 萬行，`electron` 約 7.7 萬行。
     - Overlay：JS 約 2.3 萬行，Rust 約 2.5 萬行，CSS 約 4.3 千行。
   - 變動速度：
     - Desktop 從 v0.22.5 到 v0.23.0 才兩週，就改了 1332 個檔案，+100,763 / −10,038 行。
     - 近 3 個月 `apps/desktop` 有 7392 個 commit。
3. **所以「完全複製 Desktop 每一個功能」不實際。**
   - 這是一個每週都在移動的目標，而且有幾塊本質上就不適合 Overlay（第 3.6 節的 D 類）。
   - 所以 v1.0 定義成：「Devon 平常在 Desktop 會用到的功能，Overlay 在 Windows 上全部可以用，所以可以把 Desktop 關掉」，再加上一份明確寫出「不做」的清單。

## 2. Desktop 發版節奏（事實，GitHub API）

| 期間 | 版本 |
|---|---|
| 2026-08-06 ~ 11-06 | 約 23 個正式版，約每週 1.8 個 |
| 小版號 | 0.21.0（08-31）→ 0.22.0（10-14）→ 0.23.0（11-05 21:32 UTC = 倫敦 21:32） |
| 0.22.x 系列 | 10-14 .0／.1、10-15 .2、10-21 .3／.4、10-23 .5、11-02 .6、11-03 .7 |
| 0.21 以前 | 用日期命名：8.13、8.16、8.16.2、8.18、8.19、8.27、8.31、9.7、9.11、9.14、9.21、9.24 |
| 另外 | 每天都有 canary tag |
| `apps/desktop` commit 數 | 近 3 個月 7392，近 1 個月 1901 |

0.23.0 新增的伺服器路由（事實（原），比對兩版路由表，0.22.5 的路由都沒被刪）：
- `/api/chat/file-upload`
- `/api/cron/jobs/{id}/cancel`
- `/api/desktop-plugins/*`
- `/api/files/ticket`
- `/api/host-terminal`（ws）
- `/api/messaging/relay*`
- `/api/skills/lock`
- `/api/ui-preferences`
- `/api/webapp-access/*`
- `/api/webapp/*-ticket`

## 3. 功能逐項表

欄位：Desktop 怎麼做（事實（原））｜9119 有沒有（事實（原）／（測））｜Overlay 本機部分｜分類｜工作量｜目前狀態

### 3.1 對話核心

| # | 功能 | Desktop 怎麼做 | 9119 | Overlay 本機部分 | 類 | 量 | 現況 |
|---|---|---|---|---|---|---|---|
| 1 | 串流對話、工具卡 | WS `prompt.submit`（`use-prompt-actions/submit.ts:412`） | ✅（測）WS 可用 | 已完成 | A | — | ✅ 已有 |
| 2 | 批准／回答提問 | `clarify.respond`（`src/api/client.ts:49`） | ✅（原） | 已完成 | A | — | ✅ |
| 3 | 停止、插話（steer） | `session.interrupt`（`client.ts:50`）、steer（`canonical-protocol.ts:398`） | ✅ | 已完成 | A | — | ✅ |
| 4 | 排隊面板（看、改、刪排隊中的訊息） | 前端自己管 queue（`app/chat/composer/queue-panel.tsx:24`，443 行） | 不需要新 API | 純前端 | A | M | ❌ |
| 5 | session 新增／切換／分支／改名／封存 | `session.create`（`client.ts:68`）、`branch_stored`（`client.ts:60`）、`PATCH/DELETE /api/sessions/{id}`（`sessions.py:926/846`） | ✅ | `/branch` 的標題還沒照 Desktop 的規則 | A | S | 大致 ✅ |
| 6 | 搜尋歷史 session | `src/api/sessions.ts:445` → `/api/sessions/search` | ✅（測）200，查 "Bot" 有 12 筆 | 在 session 選單加搜尋框（Desktop picker／palette 共 2295 行，只做簡單版就好） | A | M | ❌ |
| 7 | 斜線指令、Plan、旁問 `/btw` | `command.dispatch`（`slash.ts:557`）、`prompt.btw`（`slash.ts:728`）、`commands.catalog`（`slash.ts:1258`） | ✅（測）`commands.catalog` OK | ETag 快取寫了但沒用到（`lib.rs:2672 _etag`，`client/mod.rs:783` 用的是假的 `ws-N`） | A | S | 大致 ✅ |
| 8 | 換模型、思考程度 | `model.options`（`plugins/hermes-bots/model-picker.tsx:92`）、`reasoning-pill.tsx:14`、`POST /api/model/set`（`models.py:376`） | ✅（測）`model.options` OK | 模型選單＋思考程度切換（Desktop 450 行） | A | M | ❌ |
| 9 | 圖片附件、貼上截圖 | `upload-server-image.ts:36` → `/api/chat/image-upload`（`files.py:477`）；剪貼簿讀圖在 `electron/clipboard-image.ts` | ✅（測）上傳 200，回 path | 要用 `tauri-plugin-clipboard-manager` 讀圖、`tauri-plugin-dialog` 選檔（事實（文））。拖放到「滑鼠穿透」的視窗只在面板接收輸入時有效（推論） | A+B | M | ❌ |
| 10 | 檔案附件 | `plugins/hermes-bots/group-turns.ts:931-943`（`file.attach`）、`/api/files/upload`（`files.py:654`） | ✅（原） | 同上，跟 #9 一起做 | A+B | S（接在 #9 後面） | ❌ |
| 11 | 語音輸入、朗讀 | 麥克風用 `getUserMedia`（`hooks/use-mic-recorder.ts:270`）；`/api/audio/transcribe`、`/api/audio/speak`（`src/api/system.ts:189/211`）；Desktop 語音相關約 3.5k 行 | ✅（測）`/api/audio/voice-config` 200 | WebView2 的 `getUserMedia` 會跳權限詢問。**Windows 沒實測**（推論）。另外要 Devon 的伺服器已經設定 STT/TTS provider（未查證） | A+B | L | ❌ |
| 12 | Rewind、編輯後重送 | `rewind.ts:191`（920 行），用 `prompt.submit` 截斷 | ✅（原）`methods_prompt.py:327-348`；`session.rewind` 回 −32601（測），但不需要 | 會刪歷史，要做確認對話框 | A | M | ❌ |
| 13 | 多裝置同步 | 伺服器推事件 | ✅ | 已有。已知問題：自己有訊息在排隊時，手機那邊的回覆不會即時顯示（原因未查，推論是 Overlay 端的事件處理） | A（可能 B） | M | 部分 |
| 14 | Desktop 關著時也能收到主動訊息 | 伺服器寫入 | ✅ | 已有，需要在 Windows 再確認 | A | S | 待驗 |
| 15 | 空白對話畫面 | `hermes-bots/chat-empty.tsx` | 不需要 API | 純前端 | B | S | ❌ |
| 16 | 匯出／匯入 session | `session.export`（`slash-desktop-commands.ts:416`）、`/api/profiles/import`（`profiles.py:1115`） | ✅（原） | 存檔對話框（`tauri-plugin-dialog`） | A+B | S | ❌ |
| 17 | 用量、context 用量 | `session.usage`（`use-session-actions/index.ts:1568`）、`context_breakdown`（`shell/hooks/use-context-breakdown.ts:161`）、`/api/analytics/usage`（`src/api/models.ts:31`） | ✅（測）analytics 200 | 小面板 | A | M | ❌ |

### 3.2 看板、排程、Bot

| # | 功能 | Desktop 怎麼做 | 9119 | Overlay 本機部分 | 類 | 量 | 現況 |
|---|---|---|---|---|---|---|---|
| 18 | 看板：看、拖曳換欄 | `src/plugins/kanban/api.ts` | ✅ | 已完成 | A | — | ✅ |
| 19 | 看板：新增、編輯、留言、刪除、指派 | `kanban/api.ts:440-463` | ✅（測）新增、留言、刪除都 200（`plugin_api.py:435/719`） | 表單＋確認（kanban 外掛共 6.1k 行，只做這幾項） | A | M | ❌ |
| 20 | 看板：多個看板、匯入匯出 | `/boards*`（`plugin_api.py:1411-1534`） | ✅（原） | 看板切換選單 | A | M | ❌（優先度低） |
| 21 | 看板欄頭字太小 | — | — | CSS 寫死 24px | B | S | ❌ |
| 22 | 排程：新增、編輯、暫停、手動觸發、刪除、藍圖 | `src/api/cron.ts:36, 86-165`（`app/cron` 2205 行） | ✅（測）新增、暫停、刪除 200；`PUT` 要完整 body（422）；路由在 `cron.py:716-767` | 表單 | A（**需決定**：R-CR-01 目前規定排程只能看） | M | 只能看 |
| 23 | Bot 名冊、頭像、新增 Bot（= 新增 profile） | `plugins/hermes-bots/profile-ops.ts:377`、`create-dialog.tsx`、`edit-profile-dialog.tsx`；`src/api/profiles.ts:22/43/64/113` | ✅（測）`POST/DELETE /api/profiles` 200；`PATCH`、`soul`、`model`、`description`（`profiles.py:812-1051`） | Overlay 已經可以編 SOUL（`main.js` 有 14 處 soul）。還缺：新增、改名、刪除、換模型（約 3.1k 行） | A | L | 部分 |
| 24 | 每個 Bot 的排程磚 | hermes-bots Routines tile → cron API | ✅ | 接在 #22 後面 | A | S | ❌ |
| 25 | Bot 群組聊天、@ 互傳 | `group-turns.ts:393` `requestForBot` → `session.create`／`prompt.submit`（gateway RPC，不是本機 CLI） | ✅（原） | hermes-bots 外掛共 32.9k 行，群組這塊估一部分 | A | L | ❌ |

### 3.3 設定與能力

| # | 功能 | Desktop 怎麼做 | 9119 | Overlay 本機部分 | 類 | 量 | 現況 |
|---|---|---|---|---|---|---|---|
| 26 | Provider、API key、設定檔 | `src/api/config.ts:135/208/260` → `/api/config`、`/api/env`、`/api/providers/*` | ✅（測）200；寫入路由在 `config_env.py:117/328/1067/1085` | 設定頁（Desktop settings 28.5k 行）。牽涉密鑰顯示（`/api/env/reveal`），要小心設計 | A | L | ❌ |
| 27 | 記憶 provider | `system.ts:110` → `/api/memory` | ✅（測）200 | 設定頁一部分 | A | M | ❌ |
| 28 | 技能、工具組、MCP、agent plugin | `store/agent-plugins.ts:167`（`plugins.manage`）、skills／tools／mcp（`app/capabilities` 15.4k 行） | ✅（測）skills／toolsets／mcp 200；`skills.manage`、`plugins.manage` OK；寫入在 `mcp.py:110-372`、`skills.py:379`、`tools.py:273` | 管理頁 | A | L | ❌ |
| 29 | 訊息平台、webhook、配對 | `src/api/messaging.ts:21/160/117` | ✅（測）messaging／webhooks／pairing 200 | 管理頁＋Telegram QR（2.5k 行） | A | L | ❌ |
| 30 | 首次設定、onboarding | `store/onboarding-run.ts:163`、`lib/runtime-readiness.ts:104` | ✅（測）`setup.status`、`onboarding.state` OK | 要先有 #26 | A | M | ❌ |
| 31 | Ops：doctor、備份、安全稽核、log | `system.ts:283`、`config.ts:128` | ✅（原）ops／logs 路由存在 | 小頁面 | A | M | ❌ |
| 32 | 學習圖譜（starmap）、curator | `api/skills.ts:49`、`system.ts:126`（starmap 3.7k 行） | ✅（測）`/api/learning/*`、`/api/curator` 200 | 圖譜視覺化 | A | curator 開關 S；圖譜 L | ❌ |
| 33 | 委派路由、本機模型 | `api/delegation.ts:6`、`/api/local-models/*` | ✅（測）200 | 設定頁一部分 | A | M | ❌ |
| 34 | Computer use、瀏覽器控制 | `browser.manage`（`slash.ts:1361`）、`/api/tools/computer-use` | ✅（測）200 | 狀態＋開關 | A | M | ❌ |
| 35 | Vault（密碼庫） | `lib/gateway-events.ts:44` | ✅（原）`vault.*` RPC 有註冊 | 很敏感，要設計 | A | M | ❌ |
| 36 | Hermes 本身的更新 | `system.ts:159` → `/api/hermes/update` | ✅（測）`/check` 200 | 按鈕。從 Overlay 觸發伺服器更新有風險 | A（建議需 Devon 確認） | S | ❌ |

### 3.4 工作區（檔案、終端機、預覽）

| # | 功能 | Desktop 怎麼做 | 9119 | Overlay 本機部分 | 類 | 量 | 現況 |
|---|---|---|---|---|---|---|---|
| 37 | 瀏覽／預覽伺服器上的檔案 | `store/file-actions.ts:91`（fs）、`lib/desktop-fs.ts:146`（files）；右側欄 7.2k 行 | ✅（測）`/api/files` 200；`fs/*` 422 = 路由存在 | 檔案樹＋預覽 | A | L | ❌ |
| 38 | Artifacts、媒體 | `app/artifacts`（1.3k 行）→ `/api/media` | ✅（原） | 預覽面板 | A | M | ❌ |
| 39 | Git review、worktree | `store/projects.ts:1490` → `/api/git/*` | ✅（測）422 = 路由存在 | diff 介面 | A | L | ❌ |
| 40 | 終端機 | **本機** node-pty（`electron/terminal-ipc.ts:11`；`preload.ts:508` `hermes:terminal:attach`），開的是筆電自己的 shell。agent 執行指令的輸出則是後端事件（`agent-terminal-stream.ts:1`） | 伺服器另有 `/api/pty` ws（`chat_ws.py:538`），開的是**伺服器**的 shell；0.23.0 再加 `/api/host-terminal` | 兩條路：(a) 接伺服器 `/api/pty` = A；(b) Rust `portable-pty` 開筆電 shell = B。**要決定終端機是開在哪台機器** | A 或 B（需決定） | L | ❌ |
| 41 | 內嵌網頁預覽 | Electron guest webContents | 不需要 API | Tauri 2 的「一個視窗放多個 webview」要開 `unstable` feature，而且 Windows 上在同步 command 裡建立會 deadlock（事實（文）：docs.rs `Window::add_child`）。另開一個視窗則是穩定 API | B | L（有風險） | ❌ |

### 3.5 Windows 本機、外觀、發佈

| # | 功能 | Desktop 怎麼做 | 9119 | Overlay 本機部分 | 類 | 量 | 現況 |
|---|---|---|---|---|---|---|---|
| 42 | 系統通知 | Electron Notification（`electron/notification-ipc.ts:53`） | — | `tauri-plugin-notification`（事實（文））；Windows toast 沒實測 | B | S–M | ❌（目前只有 App 內的鈴鐺） |
| 43 | 介面語言：簡中、日文等 | `src/i18n/languages.ts:31`：en、zh、zh-hant、ja、de、es、fr、ru、ar（58.6k 行） | — | Overlay 現在只有 zh-HK、en（`look.js:23-26`）。Desktop 是 MIT 授權可以參考，但字串的 key 不同，要重新整理 | B | 每種語言 M | ❌ |
| 44 | 英文按鈕強制全大寫、DEMO_BANNER 沒有英文 | — | — | `styles.css:2625-2637`、`setup.js:7` | B | S | ❌ |
| 45 | 半透明、滑鼠穿透 HUD | `app/hud/click-through.ts` | — | Overlay 原生功能 | B | — | ✅ |
| 46 | 快速輸入視窗 | `electron/quick-entry.ts`（275 行） | — | 已經在用 `global-shortcut` | B | S–M | ❌ |
| 47 | 命令面板 | `app/command-palette` | — | 純前端 | B | M | ❌ |
| 48 | 系統匣、開機啟動 | `electron/tray-host.ts:13` | — | 系統匣已有（`lib.rs:58`） | B | S | 大致 ✅ |
| 49 | `hermes://` 深層連結 | `electron/deep-link-protocol.ts:10` | — | `tauri-plugin-deep-link` | B | S | ❌（優先度低） |
| 50 | 截圖快捷鍵 | `desktopCapturer`（`electron/command-screenshot.ts:4`）；Desktop README 標示 macOS | — | Windows 要的話是 B，可以接 #9 | B | M | ❌（可不做） |
| 51 | 寵物、喚醒詞 | `store/wake-word.ts:165`、`app/pet-overlay`（1.5k 行） | ✅（測）`pet.info`、`pet.gallery`、`wake.status` OK | 喚醒詞代表麥克風一直開著 | B（**需決定**） | M–L | ❌ |
| 52 | App 自動更新 | `electron-updater`（`electron/main.ts:3522-3557`） | — | 技術上：`tauri-plugin-updater`＋免費的 minisign 金鑰＋放更新檔的地方（GitHub Releases）。但 R-SY-05 規定沒有 Devon 同意不發 release | **D**（需決定） | 決定後 M | ❌ |
| 53 | Windows 程式碼簽章 | `electron-builder.config.cjs:340-352` 用 Azure signtool | — | 見 §4 | **D**（要花錢） | 決定後 S–M | ❌（沒簽章） |

### 3.6 不適合 Overlay 的 Desktop 功能

| # | 功能 | Desktop 怎麼做 | 為什麼是 D |
|---|---|---|---|
| 54 | Desktop 外掛 SDK（contrib plugins） | `src/contrib/types.ts:10`，contrib＋sdk 共 5.2k 行；0.23.0 又加了 `/api/desktop-plugins/*` | 外掛本身是給 Desktop React 介面用的模組。Overlay 要跑它們，等於重寫一套 SDK，還要支援每一個擴充點，而且這些擴充點每週都在變。內建的 radio、hello-runtime 是範例性質 |
| 55 | 在本機安裝／啟動 Hermes、SSH 遠端管理 | `electron/backend-child.ts`、`electron/ssh-connection.ts` | Overlay 的設計就是只當遠端 9119 的用戶端（R-AR）。這塊不適用 |
| 56 | Nous portal、免費額度、計費 | `store/free-tier-challenge.ts:15` | 路由有（`free_tier.status` OK），但 Devon 有沒有在用 Nous 帳號未知。建議不做，除非他說要 |
| 57 | Desktop 主題系統 | `/api/dashboard/themes` | Overlay 有自己的外觀規範（AD 規則）。是否需要對齊，看 Devon 決定 |

### 3.7 要改伺服器的項目（C）

| # | 問題 | 說明 | 誰改 |
|---|---|---|---|
| C1 | Bot Chat 被伺服器改名（「Hermes 管家」問題，R-SS） | 名字是伺服器端產生的 | NousResearch 上游，或 Devon 伺服器上的設定。不是 Overlay 能修的 |
| C2 | `slash.exec` 出現 pipe closed | 推論是伺服器的 slash worker 掛掉，**未查證到底是哪一端** | 先在測試機重現；如果確定是伺服器，要回報上游 |
| C3 | 只有 0.23.0 才有的路由（`/api/chat/file-upload`、`/api/host-terminal`、`/api/desktop-plugins`、`/api/ui-preferences` 等） | Devon 的伺服器是 v0.22.5 stable（2026-11-06 確認），所以沒有這些 | Devon 決定要不要升級伺服器。Overlay 已經可以用 0.22.5 的替代路由（`/api/files/upload`、`/api/pty`） |

## 4. 程式碼簽章與發佈（事實（文）＋推論）

- **Azure Artifact Signing**（Desktop 用的方式）：每月 US$9.99。但「個人開發者」只開放美國、加拿大；「組織」才開放 EU／UK。Devon 是英國個人，所以**以個人身分不能用**。如果用公司名義申請，可以。
- **OV 憑證**：每年約 US$150–300。剛開始 SmartScreen 還是會警告，要累積信譽才會消失。
- **EV 憑證**：每年 US$400 以上。
- **自簽憑證**：免費，但只在信任那張憑證的電腦上有效。給 Devon 自己的筆電用，這樣就夠了。
- **Microsoft Store MSIX**：免費簽章，但 Tauri 沒有原生輸出 MSIX（推論：要另外打包）。
- **自動更新**：
  - 簽章金鑰（minisign）免費。
  - 更新檔要放在某個地方，最簡單是 GitHub Releases。
  - 但 R-SY-05 規定發 release 要 Devon 同意。
- 建議：只給 Devon 自己用的話，**自簽憑證＋手動更新**就夠了，費用 0。要發給別人用，再考慮 OV 或用公司名義申請 Azure。

## 5. 數量統計

主表共 57 項（#1–57），另外 C 類 3 項。混合分類的算法：「A+B」算 A；「A（需決定）」算 A，另外列進需決定清單。

| 類 | 數量 | 項目 |
|---|---|---|
| A | 38 | #1–14、16–20、22–40 |
| B | 13 | #15、21、41–51 |
| C | 3 | C1–C3 |
| D | 6 | #52–57 |

- 已經完成或大致完成：#1、2、3、5、7、14（待驗）、18、45、48。
- 需要 Devon 決定的：
  - #22：排程可不可以改。
  - #36：可不可以從 Overlay 觸發伺服器更新。
  - #40：終端機開在哪台機器。
  - #51：要不要寵物、喚醒詞。
  - #52：自動更新（需要發 release）。
  - #53：簽章要不要花錢。
  - #56：要不要做 Nous portal。
  - #57：外觀要不要對齊 Desktop 主題。
  - C3：要不要升級伺服器。

## 6. 還沒查證的部分

1. **Windows 本機行為還沒實測**：
   - WebView2 的麥克風權限。
   - 拖曳到滑鼠穿透的視窗。
   - Windows 通知。
   - 安裝後的系統匣和開機啟動。
2. **伺服器的 STT/TTS**：Devon 的伺服器有沒有設定語音辨識和語音合成，還沒查。
3. **v0.23.0 的 Desktop**：沒有逐檔重新稽核，只比對了路由差異和改動量。
4. **原因還沒找到**：
   - 排隊時手機回覆不即時（#13）。
   - `slash.exec` 出現 pipe closed（C2）。
5. **Tauri 輸出 MSIX**：只是推論，沒有實際試過。
6. **工作量**：都是用程式碼行數和過去經驗推估的。
7. **路線圖排序**：要等 Devon 列出他在 Desktop 實際會用的功能，再依此調整。

路線圖本身（各版要做的項目）在 [README](../README.md#路線圖)，2026-11-06 由 Devon 核准。
