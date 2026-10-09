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

公開 API server **冇**穩定嘅「列出所有 profile」端點。名單要自己加。實驗按鈕先會問 dashboard 嘅 `GET /api/profiles`（預設 `http://127.0.0.1:9119`，`hermes dashboard`），而且**唔會**帶返 API 金鑰。Hermes 0.21.6 嘅 dashboard **即使係 localhost** 都會 401，除非你貼 dashboard 頁面入面嘅 `window.__HERMES_SESSION_TOKEN__`（session token，唔係 `API_SERVER_KEY`）。

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
  libgtk-3-dev \
  libdbus-1-dev \
  libx11-dev
```

金鑰用系統 Secret Service（gnome-keyring 或 KWallet）。程式連結咗 `sync-secret-service`，唔會靜靜雞退回 keyring 嘅記憶體 mock。無 keyring daemon 時，儲存金鑰會失敗並顯示錯誤。編譯需要 `libdbus-1-dev`。

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
6. 傳送會 `POST /api/sessions/{id}/chat/stream`，即時顯示文字、工具開始／完成／失敗，同埋忙碌或閒置。助手同歷史訊息會渲染 Markdown（標題、粗斜體、清單、程式碼、引用、表格、分隔線）；串流期間約 50ms 更新一次，未閉合嘅程式碼圍欄都會保持成塊程式碼。連結用系統瀏覽器打開，唔會喺 overlay 裡面跳頁。你自己打嘅字維持純文字。
7. 「測試已儲存連線」打 `GET /health`，再對每個已存金鑰打 `GET /api/sessions?limit=1`。

## 外觀

色板、圓角同字體都係 `:root` 嘅 CSS 變數，之後可以整組換主題。色同公開 Nous / Hermes 站一致：電光藍 `#0000f2`、螢光黃 `#edff45`、紙色字 `#f5f5f5`。頭像係太陽光暈（`--orb-glare-tint`、`--orb-core-alpha`、`--orb-glow-radius`、`--orb-glow-alpha`、`--orb-selected-glow-radius`、`--orb-selected-glow-alpha`）：細粒近白熱核、只帶少少 Bot 色，用徑向漸變向外淡到完全透明，冇實色圓球同硬邊。未選中光暈大約 34px。選中係更大更亮嘅同一種光，大約 52px。邊位頭像內縮夠選中光暈，貼住螢幕邊都唔會被切走。選中嘅光只喺切換時以 transform 脈衝兩次，之後保持靜態。Linux 面板唔再用模糊 box-shadow，自己放喺一層合成上面。狀態點同樣係圓。中間面板大約 76% 不透明，設定卡大約 80%，支援嘅 WebView 會加 `backdrop-filter` 模糊。Linux 嘅 WebKitGTK 畫唔到 `backdrop-filter`，面板同設定卡會提高到大約 90% 不透明，對比唔再靠背後嘅牆紙。字用紙色加陰影，淺色或深色牆紙都讀到。標題用 Barlow Condensed，正文用 Schibsted Grotesk，狀態用 IBM Plex Mono，中文繼續落 PingFang HK / Noto Sans TC。呢啲係開源替代，冇嵌入 Rules、Aeonik 或其他專有字檔同標誌。

## 游標同穿透

互動對齊 Rainmeter：

- 預設成個 overlay（包括面板同頭像）係 click-through。點擊、滾動、hover 會去到底下嗰個程式。
- 游標靠近某個元素就會按距離淡出：大約 120px 以外係實色，貼住元素大約 18% 透明度。可以喺設定改距離、最低透明度，或者關掉淡出。
- 按住修飾鍵（預設 **Ctrl**，可改 Shift 或 Alt）時，**只係游標下面嗰一個元素**即刻去到全強度同可點擊。面板用矩形再加大約 12px。頭像用圓形：距離圓心唔超過半徑加 12px 先算對準，外接正方形嘅角位唔會接手。全強度頭像仍然係呢團光（近距離淡出乘喺成個元素上面），面板就係玻璃面嘅本來透明度。其他元素繼續按距離淡出，而且保持穿透。游標由一個元素移去下一個，全強度會跟住游標走。
- 修飾鍵喺所有元素範圍以外撳（例如喺另一個程式 Ctrl+C / Ctrl+V）唔會改變任何元素，亦唔會接手點擊。
- 輸入框聚焦會保持**中間對話面板**實色，游標喺塊面板上先可以點。設定頁打開會保持**設定面板**同樣處理。Esc、點到元素以外嘅空白，或者視窗失焦，會 blur 輸入框並解除鎖定。視窗交畀另一個程式會即時解除鎖定；網頁內短暫失焦先會等約 150ms。修飾鍵選單嘅彈出視窗、本程式視窗，同埋佢嘅外框，都仍然算本程式，設定卡會保持。Linux 用前景視窗嘅 X11 window id 對照呢啲 id，唔再靠 `_NET_WM_PID`；任何其他非零前景視窗都係另一個程式，連續兩次讀到就放開，並且清走 dropdown 旗、blur 修飾鍵選單，再叫 WebKit 閂 option menu，GTK menu 用 cancel／deactivate 收起。WebKit 自己嘅 popup 唔係 GtkMenu，`menu.close()` 收唔到；抓手係普通 popup window 時，向個 window 送合成 Escape（`widget.event`），等 WebKit 自己取消。唔再用 hide 同 seat ungrab，避免下一次撳選單要撳兩下。讀唔到前景視窗先保持。Windows 同 macOS 仍然用行程 id。
- 修飾鍵可以改做 Alt，但 Linux 視窗管理員（xfwm4 預設，GNOME／KDE 都常見）用 Alt 拖移視窗，Alt+click 可能去唔到 overlay。設定頁喺 Linux 會顯示呢個警告，Alt 仍然可以揀。唔使點擊都可以開設定：全域快捷鍵 **Ctrl+Shift+Alt+H**，或者系統匣選單「設定 (Ctrl+Shift+Alt+H)」。系統匣亦有「結束」。中間面板嘅「關閉」只收起對話面板，唔會結束程式。收起會設 `[hidden]`，`.center-panel[hidden]` 用 `display: none` 蓋過 `display: flex`，面板先會真係消失，hit-sync 亦會丟掉呢塊矩形。置頂只切換 keep-above。置頂之後大約 1 秒內先拒絕關閉要求，避免 keep-above 令程式退出。過咗呢一秒，Alt+F4 同 wmctrl -c 可以正常結束。設定頁有「結束」，同系統匣「結束」一樣呼叫 `app.exit(0)`。`quit_app` 同 `arm_pin_close_guard` 要喺預設 capability 允許先叫到；叫唔到會出喺錯誤橫額。Unix 嘅 SIGINT／SIGTERM 同樣走呢條路。

實作用 Rust 大約每 16ms 讀全域游標同修飾鍵（`device_query`），前端報上元素矩形。`set_ignore_cursor_events` 只喺游標進入「修飾鍵對準嘅元素」或者「鎖定緊嘅面板」時先關閉。Windows、macOS、Linux X11（包括開咗 `DISPLAY` 嘅 XWayland）先支援。純 Wayland 讀唔到全域游標／修飾鍵，overlay 會保持可點擊，唔會穿透。macOS 要喺「私隱與保安 → 輔助使用」允許呢個 app，否則修飾鍵可能讀唔到。全域快捷鍵同樣要輔助使用權限。

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

1. **Click-through**  
   預設開啟（見上面「游標同穿透」）。純 Wayland 未支援全域游標／修飾鍵查詢，會保持可點擊。Linux 用 X11 或 XWayland。

2. **Profile 列表**  
   API server 冇已文件化、穩定嘅 roster 端點（曾經提出嘅 `GET /api/profiles` 冇落地）。Dashboard 嘅 `GET /api/profiles` 先係實驗匯入，而且唔包含 API 金鑰。Hidden 嘅 `Bot Chat` 要 gateway 支援 `include_hidden=true` 先搵到；舊版忽略呢個 query 時，如果標題已被隱藏 session 佔用，建立會 400。

3. **串流中斷**  
   「停止」只會切斷呢個客戶端嘅 SSE。Gateway 上嗰輪可能繼續行。逾時上限約由 reqwest 預設（無總時限，連接逾時 10 秒）；keepalive comment 會被略過。

4. **無頭／CI**  
   `tauri dev` / `tauri build` 要顯示器同 WebKit。無 GUI 時用 `cargo check` 同 `cargo test`。

5. **Wayland**  
   部分合成器對 transparent / always-on-top 嘅行為同 X11 唔同。

6. **真實 Hermes**  
   協議對過 Hermes v0.21.6 實機（Ollama qwen2.5 1.5B，`default` / `researcher` / `writer` / `broken`，multiplex `/p/<profile>/`）：重複 `Bot Chat` 標題、失敗回合 `display_kind: failed_turn`、中文 SSE 分塊。單元測試用本機假 HTTP 鎖住呢啲形狀。金鑰圈要有 Secret Service / Keychain / Credential Manager 先寫到持久金鑰。

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
        ├── interaction.rs   # 穿透、淡出、修飾鍵
        ├── secrets.rs       # OS keychain
        └── config.rs
```
