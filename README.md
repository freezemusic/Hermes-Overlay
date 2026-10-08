# Hermes Overlay

跨平台（Windows / macOS / Linux）**透明、無邊框、長期置頂** 嘅桌面 Overlay，用嚟同自架 [Hermes Agent](https://hermes-agent.nousresearch.com/) gateway 上面嘅 Bot 傾偈。

技術棧：**Tauri 2 + Vite + Vanilla HTML/CSS/JS**，HTTP 喺 Rust（reqwest）。介面文案用 **繁體中文（香港）zh-HK**。

未填 gateway 位址時，畫面用內置 mock Bot，可以離線睇版面。填咗位址就改由名單上嘅 profile 排邊框頭像；連唔到會顯示錯誤，唔會靜靜雞退返去 mock。

## 前置需求

### 共通

- [Node.js](https://nodejs.org/) 20+
- [Rust stable](https://rustup.rs/)（Tauri 2.12 需要近期 stable；系統套件嘅舊 `rustc` 可能唔夠）

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source "$HOME/.cargo/env"
rustc -V
```

### 啟用 Hermes API server 同攞金鑰

Hermes 本身要先有 provider。API server 預設關。喺 `~/.hermes/.env`：

```bash
API_SERVER_ENABLED=true
API_SERVER_KEY=change-me-local-dev
# 可選
# API_SERVER_PORT=8642
# API_SERVER_HOST=127.0.0.1
```

然後：

```bash
hermes gateway
```

聽到 `[API Server] API server listening on http://127.0.0.1:8642` 就得。健康檢查唔使金鑰：

```bash
curl http://127.0.0.1:8642/health
```

**Bot 就係 profile。** 每個 Bot 一條永久對話，標題剛好係 `Bot Chat`。具名 profile 要喺自己嘅 `~/.hermes/profiles/<profile>/.env` 設**另一條** `API_SERVER_KEY`。共享一個 listener 時要開 multiplex：

```yaml
gateway:
  multiplex_profiles: true
```

之後：

- `default` profile：`http://127.0.0.1:8642/api/...`，用 default 嗰條 key
- 具名 profile：`http://127.0.0.1:8642/p/<profile>/api/...`，用**該 profile 自己**嘅 key（default 嘅 key 會 401）

如果唔開 multiplex，而係每個 profile 自己一個埠（`hermes -p alice gateway`），喺 Overlay 嗰個 Bot 填「專用位址」（例如 `http://127.0.0.1:8643`）。專用位址唔再加 `/p/<profile>/`。

公開 API server **冇**穩定嘅「列出所有 profile」端點。名單要自己加。實驗按鈕先會問 dashboard 嘅 `GET /api/profiles`（預設 `http://127.0.0.1:9119`，`hermes dashboard`），而且**唔會**帶返 API 金鑰。非 loopback 嘅 dashboard 要另貼 `window.__HERMES_SESSION_TOKEN__`（session token，唔係 `API_SERVER_KEY`）。

參考：

- [API Server](https://hermes-agent.nousresearch.com/docs/user-guide/features/api-server)
- [Programmatic integration](https://hermes-agent.nousresearch.com/docs/developer-guide/programmatic-integration)
- [Bot Mode](https://hermes-agent.nousresearch.com/docs/user-guide/bot-mode)

### Linux（Debian / Ubuntu 類）

```bash
sudo apt update
sudo apt install -y \
  libwebkit2gtk-4.1-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev \
  patchelf \
  pkg-config \
  build-essential \
  libssl-dev \
  libgtk-3-dev
```

金鑰用系統 Secret Service（gnome-keyring 或 KWallet）。無 keyring daemon 時，儲存金鑰會失敗並顯示錯誤。

### macOS

- Xcode Command Line Tools
- 金鑰放去 Keychain
- 透明窗開咗 `macOSPrivateApi`。**用 private API 可能過唔到 App Store。**

### Windows

- Microsoft Visual Studio C++ Build Tools
- WebView2 Runtime（新版 Windows 通常已有）
- 金鑰放去 Windows Credential Manager

## 安裝同執行

```bash
npm install
npm run tauri dev
```

只起前端（無透明窗、無鑰匙圈，強制示範模式）：

```bash
npm run dev
# http://localhost:1420
```

正式打包：

```bash
npm run tauri build
```

無 GUI 時可以只驗證編譯：

```bash
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
```

## 點用

1. 開中間面板嘅「設定」。
2. Gateway 位址填 `http://127.0.0.1:8642`（留空 = 示範模式）。
3. 每個 Bot：profile 名稱、顯示名稱、顏色、API 金鑰。金鑰留空代表保留鑰匙圈入面已有嗰條。
4. 儲存。邊框會按名單數量排頭像。
5. 點一個頭像：Rust 用該 profile 嘅 key 搵標題係 `Bot Chat` 嘅 session（包含 hidden），載入訊息。冇就建立一條。
6. 傳送會 `POST /api/sessions/{id}/chat/stream`，即時顯示文字、工具開始／完成／失敗，同埋忙碌或閒置。
7. 「測試已儲存連線」打 `GET /health`，再對每個已存金鑰打 `GET /api/sessions?limit=1`。

設定檔（位址、名稱、顏色、詳情）喺 app config 目錄嘅 `config.json`。金鑰同 dashboard token 喺 OS keychain，service 名 `com.freezemusic.hermes-overlay`。網頁層只知道 `has_key`，唔會再攞到明文。

## 設定重點

`src-tauri/tauri.conf.json` 視窗：

| 選項 | 值 | 作用 |
|------|-----|------|
| `transparent` | `true` | 視窗可透明 |
| `decorations` | `false` | 無標題列 |
| `alwaysOnTop` | `true` | 長期置頂 |
| `shadow` | `false` | 減少邊框陰影 |
| `maximized` | `true` | 大範圍 overlay |
| `macOSPrivateApi` | `true` | macOS 透明背景 |
| `identifier` | `com.freezemusic.hermes-overlay` | bundle id |

## 已知限制

1. **Click-through（空白位滑鼠穿透）**  
   Tauri 有 `setIgnoreCursorEvents`，但一開全域穿透，空白位就收唔到 hover。預設**關閉**。要自己做嘅話，用快捷鍵切換，或者平台原生 hit-test。Linux 支援唔穩定。

2. **Profile 列表**  
   API server 冇已文件化、穩定嘅 roster 端點（曾經提出嘅 `GET /api/profiles` 冇落地）。Dashboard 嘅 `GET /api/profiles` 先係實驗匯入，而且唔包含 API 金鑰。Hidden 嘅 `Bot Chat` 要 gateway 支援 `include_hidden=true` 先搵到；舊版忽略呢個 query 時，如果標題已被隱藏 session 佔用，建立會 400。

3. **串流中斷**  
   「停止」只會切斷呢個客戶端嘅 SSE。Gateway 上嗰輪可能繼續行。逾時上限約由 reqwest 預設（無總時限，連接逾時 10 秒）；keepalive comment 會被略過。

4. **無頭／CI**  
   `tauri dev` / `tauri build` 要顯示器同 WebKit。無 GUI 時用 `cargo check` 同 `cargo test`。

5. **Wayland**  
   部分合成器對 transparent / always-on-top 嘅行為同 X11 唔同。

6. **未對住真實 Hermes 跑過**  
   協議係對住公開文件同 upstream `api_server.py` 嘅欄位（`message`/`input`、`assistant.delta` 嘅 `delta`、`tool.started` 嘅 `tool_name`）寫嘅。單元測試用本機假 HTTP。見 PR 說明。

## 專案結構

```
.
├── index.html
├── src/main.js              # 邊框排位、設定、對話
├── src/styles.css
└── src-tauri/
    ├── tauri.conf.json
    └── src/
        ├── lib.rs           # Tauri commands、事件
        ├── hermes.rs        # Sessions / SSE
        ├── secrets.rs       # OS keychain
        └── config.rs
```
