# Changelog

本專案依 [Keep a Changelog](https://keepachangelog.com/zh-TW/1.1.0/) 格式記錄變更，版本號依 [Semantic Versioning](https://semver.org/lang/zh-TW/)。

> English: Unreleased notes are derived from git history on PR #4 (`b201293`) and PR #3 (`2a50abd`). Only tagged releases appear under GitHub Releases.

## [Unreleased]

尚無。下一批功能見 [README 路線圖 v0.4](README.md#路線圖) 與 [docs/ROADMAP.md](docs/ROADMAP.md)。

## [0.3.0] - Unreleased

**狀態**：程式碼在 [PR #4](https://github.com/freezemusic/Hermes-Overlay/pull/4)（`b201293`，分支 `cursor/suborbs-new-session-5d9a`）。尚未打 `v0.3.0` tag，亦尚未發佈 GitHub Release。`package.json`／`src-tauri/tauri.conf.json` 版本號已是 `0.3.0`（`defba20`，2026-11-06）。

### Added

- 子光球與「開新 session」（`/new`、標題列「＋」）：未釘選的子光球可在完成並已讀後收起；可從 session 選單拎出既有對話做子光球（R-SO）。
- 看板通知鈴、未讀數字徽章、鈴清單；拖卡改狀態改走 Hermes Dashboard 9119（R-KB-07…15）。
- 一次多題的提問卡（clarify batch）：每題一張卡，可選「其他（自己打）」，已答保留原文（R-AP-06）。
- 文字大小四段（細／標準／大／特大）與介面語言（繁中香港／英文）（R-LK-01…03）。
- 排程面板標出失敗工作（R-CR-05）。
- MIT License（`LICENSE`、README「授權」、`package.json`／`Cargo.toml` 的 `license` 欄）。

### Changed

- **只走 Hermes Dashboard（預設埠 9119）**：對話、看板、Bot 名單、斜線選單都經 `HermesClient`；不再呼叫舊 gateway（8642）（R-AR-04、R-CL-01）。
- 設定拿掉「Gateway 位址」、每個 Bot 的「專用位址」與「API 金鑰」欄；「Kanban server」留空即 `http://127.0.0.1:9119`（R-AR-06）。
- 示範模式只能用啟動參數 `hermes-overlay --demo` 或環境變數 `HERMES_OVERLAY_DEMO=1`；設定頁沒有示範開關（R-AR-05）。
- 插話（steer）時不再顯示「已加入呢一輪」，只保留用戶氣泡，對齊 Hermes Desktop（R-ST-02）。
- 排隊提示改為「手機嗰邊行緊，排緊隊」（R-ST-05）。
- 舊設定若 Kanban server 為空，會一次性把舊 gateway 主機配上 9119 埠寫入（R-AR-06 搬遷）。

### Removed

- 對 8642 gateway 的執行期呼叫（含 `GET /health`）；`gateway_legacy.rs` 已刪。
- 設定裡的 gateway／API 金鑰相關欄位與金鑰提示橫額。

## [0.2.0] - 2026-10-29（從未打 tag）

**狀態**：[PR #3](https://github.com/freezemusic/Hermes-Overlay/pull/3) 頂點 `2a50abd`（2026-10-29）。**從來沒有** `v0.2.0` tag 或 GitHub Release；下列摘要來自該 PR 相對 `v0.1.0` 的提交，方便對照 README 的版本表。

### Added

- Ctrl 穿透規則：光球預設穿透、按住 Ctrl 可點；面板按住 Ctrl 變透明可點穿（R-CT）。
- 批准卡與提問（clarify）卡；永遠只有「批准（一次）」／「拒絕」，不會自動批准。
- 停止、插話（steer）、一般／Plan／旁問三種模式（Shift+Tab）。
- 計劃視窗貼在面板旁。
- 看板與排程光球（當時看板仍經 overlay-slash／舊路徑讀取）。
- 工具呼叫收成一行。
- 斷線自動重連。

## [0.1.0] - 2026-10-15

**Tag**：`v0.1.0`（`563c913`）。這是目前唯一已發佈的 GitHub Release。

### Added

- 第一次連上自架 Hermes gateway（8642）：螢幕邊緣 Bot 光球、對話面板、串流回覆。
- `hermes-plugin/overlay-slash`：斜線選單與看板代理（給仍走 8642 的舊版用；v0.3 不需要）。

---

[Unreleased]: https://github.com/freezemusic/Hermes-Overlay/compare/v0.1.0...HEAD
[0.3.0]: https://github.com/freezemusic/Hermes-Overlay/compare/v0.1.0...cursor/suborbs-new-session-5d9a
[0.2.0]: https://github.com/freezemusic/Hermes-Overlay/compare/v0.1.0...2a50abd68a8161af37bf305a4da8bd742a476eb0
[0.1.0]: https://github.com/freezemusic/Hermes-Overlay/releases/tag/v0.1.0
