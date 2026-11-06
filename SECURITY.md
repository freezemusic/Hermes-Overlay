# 安全政策

> English summary: Only the **0.3.x** line is intended for support once released. Report vulnerabilities via **GitHub private vulnerability reporting** (maintainers must enable it under Settings → Security). Never paste API keys, tokens, cookies, or passwords into issues. The app stores non-secret settings in `config.json` and secrets in the OS keyring only.

## 支援的版本

| 版本 | 支援 |
|------|------|
| 0.3.x | 支援（目前開發中；尚未打 `v0.3.0` tag） |
| 0.2.x | 無獨立 tag；請升級到 0.3 線 |
| 0.1.x | 僅歷史 Release；不再修安全問題（請升級） |

## 如何回報弱點

請使用 **GitHub 私人弱點回報（Private vulnerability reporting）**：

1. 到本 repo 的 **Security** 分頁提交報告（不要開公開 issue）。
2. 若該選項尚未出現：維護者（Devon）需在 **Settings → Security → Code security → Private vulnerability reporting** 啟用。啟用前請先開一則**不含敏感細節**的 issue 標明「請開啟私人弱點回報」，或透過你已信任的管道聯絡維護者。

**本專案不公佈安全回報用的電子郵件。** 請勿自行猜測或在公開場合張貼維護者私人信箱。

回報時請盡量包含：Overlay 版本／commit、作業系統、Hermes Agent 版本、重現步驟、影響範圍。**不要**附上真實 token、密碼、cookie 或 `config.json` 裡與登入有關的內容。

## 請勿在公開地方貼的內容

- API 金鑰、Bearer token、refresh token、session cookie
- Dashboard 帳號密碼
- 鑰匙圈匯出、認證管理員截圖（若看得到密文）
- 內網位址若構成你環境的敏感資訊，可打碼

REQUIREMENTS **R-SY-01**：API key 與 token 永遠不寫入 log、不印出、不放 `config.json`（只放系統 keyring）。

## 本機儲存什麼（不含密文）

### `config.json`（非密）

路徑見 [docs/INSTALL.md](docs/INSTALL.md#configjson-放哪裡)。典型內容包括：Dashboard／Kanban 位址（不是密碼）、Bot 顯示名與顏色、文字大小、介面語言、透明度、session 選擇與子光球釘選等。**不應**含 token 或密碼。

### 作業系統鑰匙圈（密）

Service 名稱＝bundle identifier（正式版 `com.freezemusic.hermes-overlay`；dev 建置為 `….dev`）。帳號名稱（程式碼 `src-tauri/src/secrets.rs`）包括：

- `dashboard-session-token`
- `kanban-access-token`、`kanban-refresh-token`
- `kanban-session-cookie`
- `kanban-basic-username`、`kanban-basic-password`
- （舊版遺留）每 profile 的 API 金鑰項目；v0.3 不再讀寫新的每 Bot 金鑰，移除 Bot 時仍會刪舊項目

網頁前端拿不到這些明文。

### 不會做的事

- 不把密鑰寫進 log（非 debug）；debug log 需自行設定 `HERMES_OVERLAY_DEBUG_LOG`（opt-in）
- 不讀其他程式的鑰匙圈
- 批准／拒絕路徑不寫 `config.json`（R-AP-04）

## 安裝檔簽章

發佈的安裝檔目前**未簽名**；Windows SmartScreen 警告是預期現象。驗證檔案請比對 Release 附上的 `*-SHA256SUMS.txt`（見 [docs/INSTALL.md](docs/INSTALL.md)）。
