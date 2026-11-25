# Changelog

本專案依 [Keep a Changelog](https://keepachangelog.com/zh-TW/1.1.0/) 格式記錄變更，版本號依 [Semantic Versioning](https://semver.org/lang/zh-TW/)。

> English: `[0.3.0]` is the 2026-11-25 pre-release at tag `v0.3.0` (`d4c1951`). `[Unreleased]` is documentation after that tag. The v0.1.0 GitHub Release draft was deleted; tag `v0.1.0` remains. There was never a `v0.2.0` tag.

## [Unreleased]

### Changed

- 文件跟上已發出的 v0.3.0 預先發佈：安裝說明改為公開 Release 的 Windows NSIS 與 Linux `.deb`（下載不用登入 GitHub）。沒有改程式、tag、Release、workflow 或倉庫設定。

## [0.3.0] - 2026-11-25

**狀態**：預先發佈。[v0.3.0](https://github.com/freezemusic/Hermes-Overlay/releases/tag/v0.3.0) 的 tag 是 `d4c1951265ffecd34a7937b9c74ac7fad376063a`。安裝檔沒有簽章，是 CI run [44795677438](https://github.com/freezemusic/Hermes-Overlay/actions/runs/44795677438) 的 Windows NSIS 與 Linux `.deb`，另附 `SHA256SUMS.txt`。這次沒有 MSI、AppImage、macOS 版。[PR #4](https://github.com/freezemusic/Hermes-Overlay/pull/4) 已於 2026-11-06 合併（merge `c592310`）；tag 還包含其後到 `d4c1951` 的提交。`package.json`／`src-tauri/tauri.conf.json` 版本號自 `defba20`（2026-11-06）起是 `0.3.0`。

**驗證範圍**（沒有把未核對的項目算成通過）：

- 先前在 `d4c1951` 重跑：`npm test` 495 通過，`cargo test` 227 通過、1 略過。CI run [44795677438](https://github.com/freezemusic/Hermes-Overlay/actions/runs/44795677438)、[44795689457](https://github.com/freezemusic/Hermes-Overlay/actions/runs/44795689457) 為該 commit 的打包與測試。
- 隔離 Linux 實機（`d4c1951`）連 Hermes Agent v0.23.4（`8fc0374`）：密碼登入、串流回覆、「睇計劃」直接讀檔；檔案不在時改走對話紀錄重組。
- Windows：Devon 在已安裝的 `d4c1951` 上確認「睇計劃」直接讀檔、連結用系統瀏覽器開、系統匣「重啟」。該次沒有記錄伺服器的 Hermes 版本。
- 附件沒有用真模型驗證。v0.23.4 沒有在 Windows 上測，也沒有在 Devon 的伺服器上測。系統瀏覽器登入（PKCE）沒有在 v0.23.4 上測。macOS 沒有建置、沒有實測。

### Added

- 子光球與「開新 session」（`/new`、標題列「＋」）：未釘選的子光球可在完成並已讀後收起；可從 session 選單拎出既有對話做子光球（R-SO）。
- 看板通知鈴、未讀數字徽章、鈴清單；拖卡改狀態改走 Hermes Dashboard 9119（R-KB-07…15）。
- 一次多題的提問卡（clarify batch）：每題一張卡，可選「其他（自己打）」，已答保留原文（R-AP-06）。
- 文字大小五級（特細 0.8×／細／標準／大／特大）與介面語言（繁中香港／英文）。文字大小縮放成個面板內容（掣、留白、圖示、工具列、輸入列），不只是字（R-LK-01…04）。
- 排程面板標出失敗工作（R-CR-05）。
- MIT License（`LICENSE`、README「授權」、`package.json`／`Cargo.toml` 的 `license` 欄）。
- 重啟後自動重開：overlay 關咗之前開住嘅主光球同子光球對話面板，下次開 app 自己返嚟，主面板開返當時嗰個 session，大小位置照舊；清單記入 config.json `open_panels`（只改呢個鍵，唔改釘選同 session 記錄）；bot 或者 session 冇咗就跳過；計劃視窗唔會因此彈出（R-PN-10）。
- 計劃視窗可以拉闊：外緣（離接縫嗰邊）有拉闊把手，高度照跟對話面板；闊度記入 config.json `panel_sizes._plan`，主光球同子光球共用，雙擊還原（R-PL-09、R-PN-09）。
- 對話可以加附件，跟 Hermes Desktop：輸入框左邊「＋」（檔案…／圖片…／貼上圖片）、由檔案總管拖檔案落輸入列、Ctrl+V 貼截圖；每個附件一粒 chip 可以拎走。送出時經 `/api/ws` 上載：圖片 `image.attach_bytes`，其他檔案 `file.attach`（`@file:` ref 放喺訊息前面）。每個最多 10 MB、每次 10 個；上載失敗字同附件都留低，被拒嗰粒變紅寫原因。主光球同子光球面板都有（R-AT-01～04）。沒有用真模型驗證。
- 對話、看板、設定面板可以拖離光球嗰兩條邊同角嚟拉大／拉細，大小逐個面板記入 config.json `panel_sizes`，雙擊把手還原（R-PN-09）。
- 光球可以揸住 Ctrl 拖去任何位置，放喺邊就留喺邊，位置記入 config.json `orb_positions`；設定頁「所有光球返原位」（Reset all orb positions）一次過滑返設計位置並移除呢個鍵；面板蓋住光球原位時光球自動閃去框外，原位冇框就返去，唔再消失（R-OB-08）。
- 拉大框嘅把手改闊（邊 10px、角 12px），一定喺框入面、喺 HUD 角之上，角標常顯、邊 hover 有藍線；Windows CI 加真游標形狀檢查（R-PN-09）。
- 計劃窗開住、開場 `is-morphing` 未清走時，拉大把手仍然顯示同可以拖，Windows CI 先讀到 `resize-at`（R-PN-09）。

### Changed

- **只走 Hermes Dashboard（預設埠 9119）**：對話、看板、Bot 名單、斜線選單都經 `HermesClient`；不再呼叫舊 gateway（8642）（R-AR-04、R-CL-01）。
- 設定拿掉「Gateway 位址」、每個 Bot 的「專用位址」與「API 金鑰」欄；「Kanban server」留空即 `http://127.0.0.1:9119`（R-AR-06）。
- 示範模式只能用啟動參數 `hermes-overlay --demo` 或環境變數 `HERMES_OVERLAY_DEMO=1`；設定頁沒有示範開關（R-AR-05）。
- 插話（steer）時不再顯示「已加入呢一輪」，只保留用戶氣泡，對齊 Hermes Desktop（R-ST-02）。
- 排隊提示改為「手機嗰邊行緊，排緊隊」（R-ST-05）。
- 舊設定若 Kanban server 為空，會一次性把舊 gateway 主機配上 9119 埠寫入（R-AR-06 搬遷）。

### Fixed

- 普通對話唔再彈計劃視窗：只有新到、同一輪 `write_file` 寫入 `.hermes/plans/*.md` 嘅計劃檔先自動打開；標題加 Goal、路徑、代碼塊、`/plan` 長回覆等對話文字唔再當計劃，「計劃檔內容唔在對話紀錄裡面。」拎走。舊計劃喺之後對話、重開面板、轉 session、重啟都唔會再彈，只可以撳「睇計劃」；✕ 同睇過邊份逐個 session 記（R-PL-01）。
- 喺主面板 session 清單或者斜線選單上面捲滾輪，對話會一齊被捲：面板嘅滾輪轉送例外名單仲係舊版 `select`，冇自訂清單（`.session-menu`）同斜線選單（`.slash-popup`）。而家兩張清單只捲自己，唔會捲對話；判斷抽咗做 `wheelScrollsChat`（`src/wheel.js`），兩張清單加 `overscroll-behavior: contain`（R-SO-10）。
- 訊息輸入框唔可以輸入下一行：輸入框係單行 `input`，Shift+Enter 都會送出。而家 Bot 面板同子光球面板嘅輸入框跟 Hermes Desktop：Enter 送出，Shift+Enter 換行，輸入法選字嗰下唔送，框跟內容長高到 150px 再捲（R-CT-08）。
- 子光球自己嗰輪完咗、狀態寫「閒置」，但尾頁最後係工具列、清單唔忙、冇 run id 時，運行弧唔再永遠轉：每個清單 stamp 問一次伺服器（`check_session_run`／`session.active_list`，只讀），冇活躍 run 就停弧；仲有就繼續轉，面板狀態字改「行緊…」，弧同狀態字一致。自己嗰輪完結即刻記已閒置。REST `is_active` 唔當 busy。黃點同釘住重開規則不變（R-SO-03、R-SO-05）。
- 面板蓋住主光球原位時，主光球同自己個扇嘅子光球唔會再喺兩個位之間不停跳（約每 0.5 秒一次）：未拖過、跟扇嘅子光球唔再當主光球嘅障礙，光碟間距用子光球實際大小；同一組面板之下閃開一兩輪就停，再加 2 秒三次返同一位就停嘅保險（R-OB-08）。
- 澄清卡（要你答）自己打字嗰格撳 Enter 冇反應：格仔冇任何送出鍵，Enter 只係換行。而家跟 Hermes Desktop：Ctrl／Cmd+Enter 送出，Enter 照舊換行，輸入法選字嗰下唔送；「送出」掣 tooltip 提示「Ctrl+Enter 送出」（R-AP-06）。
- 減少動畫（`prefers-reduced-motion`）或者零長度收合時，面板收返光球之後殼仍然係 `data-state=panel`，所以佢嘅子光球扇一直收埋、唔喺命中區，蓋住嘅光球亦唔淡返；而家即時收合同動畫收合一樣寫入收起狀態（R-PN-08）。
- 子光球 session 面板都可以拉大／拉細（之前冇把手），所有子光球面板共用 config.json `panel_sizes._suborb`；Windows CI 加假子光球拉大測試（R-PN-09、R-SO-09）。
- 面板拉唔大（拉細得）：計劃窗開住或者命中區凍住時，拖把手嗰下嘅全畫面命中框冇送出，滑鼠一出舊框 Windows 就穿透。而家拖把手同拖標題列第一下就送，放手用新大小重新公佈；Rust 再加保險，喺面板撳落嘅掣揸住期間唔會穿透。Windows CI 真係拖自由角向外 150px（有計劃、冇計劃各一次）（R-PN-09）。
- 未釘、已收起嘅子光球，如果伺服器話個 run 已經完結或者個 session 閒置而且冇活躍 run，就停止旋轉，並喺已讀之後按 3 秒收起。歷史通知倒數到 0 會再問伺服器，唔會自己清走忙碌狀態。排隊嘅用戶句喺伺服器閒置、冇活躍 run 之後唔會令運行弧一直轉。釘住嘅子光球留低，但唔再轉（R-SO-05、R-SO-07）。
- 計劃視窗改為顯示同一輪 `write_file` 寫入 `.hermes/plans/` 嘅計劃檔正文，唔再把提到路徑嘅對話摘要當成計劃；對話裡冇檔案正文時會註明（R-PL-01）。「睇計劃」先用 GET 讀伺服器上的檔，讀不到再用對話紀錄的 `write_file` 加後來的 `old_string`／`new_string` `patch` 重組，頂部標明來源。
- 子光球回合結束嘅計劃檔回讀改走 `open_suborb`，唔再對 `suborb:…` 呼叫 `open_bot` 然後靜靜吞錯；要不要回讀只睇最新一輪。回讀唔改輸入文字、捲動、黃點、釘選同每塊子光球嘅撰寫模式（R-PL-01、R-SO-07、R-SO-09）。
- `/renew` 這類技能斜線指令會把 Hermes 展開的技能正文經 `prompt.submit` 送出（`command.dispatch` 的 `type: skill`）。用戶氣泡只顯示 `display`；沒有 `display` 就保留原本打的 `/renew …`。技能正文不再畫成助手回覆。Plan 模式不會把這行再包一次（R-CL-08、R-MD-07）。
- 再開面板或重新載入歷史時，如果 bot 仲等緊澄清或批准，會用 Hermes 0.22.5 嘅 live session（`open_requests`）補一張可以答嘅卡；打字會當答案送出。補唔到就唔會靜默 steer／排隊，並講明「呢句送唔到做答案。」（R-AP-06）。

### Removed

- 對 8642 gateway 的執行期呼叫（含 `GET /health`）；`gateway_legacy.rs` 已刪。
- 設定裡的 gateway／API 金鑰相關欄位與金鑰提示橫額。

## [0.2.0] - 2026-10-29（從未打 tag）

**狀態**：[PR #3](https://github.com/freezemusic/Hermes-Overlay/pull/3) 已於 2026-11-06 合併，頂點 `2a50abd`（2026-10-29）。**從來沒有** `v0.2.0` tag 或 GitHub Release；下列摘要來自該 PR 相對 `v0.1.0` 的提交，方便對照 README 的版本表。

### Added

- Ctrl 穿透規則：光球預設穿透、按住 Ctrl 可點；面板按住 Ctrl 變透明可點穿（R-CT）。
- 批准卡與提問（clarify）卡；永遠只有「批准（一次）」／「拒絕」，不會自動批准。
- 停止、插話（steer）、一般／Plan／旁問三種模式（Shift+Tab）。
- 計劃視窗貼在面板旁。
- 看板與排程光球（當時看板仍經 overlay-slash／舊路徑讀取）。
- 工具呼叫收成一行。
- 斷線自動重連。

## [0.1.0] - 2026-10-15

**Tag**：`v0.1.0`（`563c913`）保留。v0.1.0 的 GitHub Release 草稿已刪除，沒有公開的 v0.1.0 Release。目前公開的預先發佈是 v0.3.0。

### Added

- 第一次連上自架 Hermes gateway（8642）：螢幕邊緣 Bot 光球、對話面板、串流回覆。
- `hermes-plugin/overlay-slash`：斜線選單與看板代理（給仍走 8642 的舊版用；v0.3 不需要）。

---

[Unreleased]: https://github.com/freezemusic/Hermes-Overlay/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/freezemusic/Hermes-Overlay/compare/v0.1.0...v0.3.0
[0.2.0]: https://github.com/freezemusic/Hermes-Overlay/compare/v0.1.0...2a50abd68a8161af37bf305a4da8bd742a476eb0
[0.1.0]: https://github.com/freezemusic/Hermes-Overlay/tree/v0.1.0
