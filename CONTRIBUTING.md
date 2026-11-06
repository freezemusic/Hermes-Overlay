# 參與貢獻

> English summary: Read [REQUIREMENTS.md](REQUIREMENTS.md) first (it beats SPEC on conflicts). Use `HermesClient` only for Hermes traffic; put paths in `client/endpoints.rs`; never hard-code port 8642; demo is `--demo` / `HERMES_OVERLAY_DEMO=1` only. Run `npm ci`, `npm test`, and `cargo test --manifest-path src-tauri/Cargo.toml` before opening a PR. Do **not** create git tags or GitHub Releases.

感謝你願意幫忙。Hermes Overlay 是**非官方**社群用戶端，和 Nous Research 無關。

## 開始之前

1. 讀 [AGENTS.md](AGENTS.md)。
2. **驗收依據是 [REQUIREMENTS.md](REQUIREMENTS.md)**（條號如 `R-CT-01`、`R-AR-04`）。實作細節在 [SPEC.md](SPEC.md)；兩者衝突時以 REQUIREMENTS.md 為準。
3. 路線圖與 Desktop 對照：[docs/ROADMAP.md](docs/ROADMAP.md)、[README 路線圖](README.md#路線圖)。
4. 安裝與系統需求：[docs/INSTALL.md](docs/INSTALL.md)。

## 開發環境

需要：

- Node.js 20+（CI 用 22）
- Rust stable（見 `rust-toolchain.toml`）
- （可選）一台執行 `hermes serve` 的 Hermes Agent v0.22.5

```bash
npm ci
npm run tauri dev          # 開發用 identifier：com.freezemusic.hermes-overlay.dev
npm test                   # 前端單元測試（目前約 320 項）
cargo test --manifest-path src-tauri/Cargo.toml   # Rust（約 182 passed、1 ignored）
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
```

Linux 相依套件與平台注意事項見 README〈開發〉。沒有圖形介面時不要跑 `tauri dev`／`tauri build`，改用上面的 test／check。

## 架構規則（R-AR-01…06）白話版

這些寫在 REQUIREMENTS.md §12；送 PR 前請對一下：

| 條文 | 意思 |
|------|------|
| **R-AR-01** | 所有 Hermes 網路（REST、WebSocket、登入、重連）只能經 `HermesClient`（`src-tauri/src/client/`）。`lib.rs` 與 Tauri command 不要自己拼 URL 或開 WebSocket。 |
| **R-AR-02** | 路徑、RPC 方法名、事件名只寫在 `client/endpoints.rs`。 |
| **R-AR-03** | 埠號只出現在 config 預設（`DEFAULT_DASHBOARD_PORT = 9119`）；client／指令不要 hard-code 主機或埠。 |
| **R-AR-04** | **不要**打舊 gateway **8642**（含 `GET /health`）。 |
| **R-AR-05** | 示範模式只能 `--demo` 或 `HERMES_OVERLAY_DEMO=1`；設定頁與 `config.json` 都不能開啟示範。 |
| **R-AR-06** | 設定沒有 Gateway／每 Bot 位址／API 金鑰欄；「Kanban server」就是 Dashboard 位址，留空＝`http://127.0.0.1:9119`。 |

## 介面字串語言

- 預設 UI 是**繁體中文（香港）**；英文是設定裡可選的翻譯層（`src/look.js`）。
- 文件（README、REQUIREMENTS 引用、本檔）若引用介面原文，**保留香港用字**（例如「手機嗰邊行緊，排緊隊」「儲存」），不要擅自改成臺灣或大陸用語。
- 新增字串：先加香港繁中原文，再在 `look.js` 補英文；較長說明若尚未翻譯，保持中文並在 PR 註明。

## Pull request 期望

- **對上條號**：說明裡列出受影響的 `R-xx`，以及你重新驗證過的項目。
- **CI 必須全綠**：`npm test`、`cargo test`、Linux／Windows 打包檢查（見 `.github/workflows/ci.yml`）。
- **不要**自行建立 git tag 或 GitHub Release（R-SY-05）；發佈由維護者決定。
- 保持 PR 可審：小步提交、避免無關格式化大改。
- 絕對不要在 issue／PR／log 貼上 API 金鑰、token、cookie、密碼。

## 回報問題

請用 GitHub Issue 範本（Bug／功能）。Bug 請附 Overlay 版本或 commit、Hermes Agent 版本、Windows 版本、重現步驟；**不要貼密鑰**。

## 授權

貢獻視為同意以 [MIT License](LICENSE) 釋出（版權人 freezemusic，2026）。
