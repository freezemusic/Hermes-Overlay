# Hermes Overlay

> 狀態：**v0.3.0，開發中，尚未發佈。** 相容性：已用 Hermes Agent v0.22.5 stable（`bf0203a`）實測；v0.23.0 還沒測。

Hermes Overlay 是一個跨平台（Windows／macOS／Linux）的桌面 Overlay。它是**透明、無邊框、永遠置頂**的視窗，用來和自架 [Hermes Agent](https://hermes-agent.nousresearch.com/) 伺服器上的 Bot 對話。

這是**非官方的社群用戶端**，和 Nous Research 沒有關係，也沒有得到 Nous Research 的背書或認可。本專案不使用 Nous Research 或 Hermes 的標誌。

- **技術**：Tauri 2 + Vite + 原生 HTML/CSS/JS。網路請求都在 Rust 端（reqwest）。
- **介面語言**：預設是繁體中文（香港），設定裡可以改成英文。本文件引用介面文字時照抄原文，所以會看到香港用語。
- **連線**：所有對話、看板和 Bot 名單都走 Hermes Dashboard（`hermes serve`，預設埠 9119）。v0.3 起不再使用舊的 gateway API server（8642），也不需要每個 Bot 各自的 API 金鑰。
- **示範模式**：想在不連伺服器的情況下看版面（假 Bot），用啟動參數開示範模式：`hermes-overlay --demo`，或設定環境變數 `HERMES_OVERLAY_DEMO=1`。設定頁裡沒有示範模式的開關。
- **規格**：驗收以根目錄的 [REQUIREMENTS.md](REQUIREMENTS.md) 為準，實作細節寫在 [SPEC.md](SPEC.md)；兩者衝突時以 REQUIREMENTS.md 為準。改程式前請先看 [AGENTS.md](AGENTS.md)。

## 長期目標

長期目標是**完全取代 Hermes Desktop**：平常用 Hermes，只開 Overlay 就夠，不必再開 Desktop。做到這一點才算 v1.0。

目前的 v0.3.0 大約涵蓋 Desktop 四成的功能面向（見下面的〈和 Hermes Desktop 比較〉）。送出、串流、批准、停止、切換 session 這些基本流程已經可以用。還缺的主要是附件、語音這類輸入方式，以及設定、profile、技能這些管理功能。

## 目前版本：v0.3.0（開發中，尚未發佈）

| 項目 | 現況 |
|------|------|
| 程式碼 | [PR #4](https://github.com/freezemusic/Hermes-Overlay/pull/4)（草稿），分支 `cursor/suborbs-new-session-5d9a` |
| 已發佈 | 只有 tag `v0.1.0`（2026-10-15，`563c913`）。之後沒有再打 tag，也沒有發 Release |
| 相容的 Hermes | Hermes Agent v0.22.5 stable（`bf0203a`），連 Hermes Dashboard（`hermes serve`，預設埠 9119）。v0.23.0 還沒測，它新增的路由在 v0.22.5 上沒有 |
| 平台 | Windows 是主要使用環境，在 Devon 的筆電上實測。Linux（X11）在測試機上驗證。macOS 只有打包設定，沒有實測 |
| 簽章 | 安裝檔沒有簽章 |

### 版本怎麼算

| 版本 | 內容 | 狀態 |
|------|------|------|
| v0.1 | 第一次連上自架的 Hermes gateway（8642）。包含螢幕邊緣的 Bot 光球、對話面板、串流回覆，以及 overlay-slash plugin | 已打 tag（2026-10-15） |
| v0.2 | 可以每天使用。包含 Ctrl 穿透規則、批准卡和提問卡、停止和插話、計劃視窗、看板和排程光球、工具呼叫收成一行、一般／Plan／旁問三種模式、斷線自動重連 | [PR #3](https://github.com/freezemusic/Hermes-Overlay/pull/3)（`2a50abd`，2026-10-29） |
| **v0.3** | 只走 Hermes Dashboard（9119）：拿掉 8642，也拿掉「Gateway 位址」和每個 Bot 的「API 金鑰」欄位。新增子光球和「開新 session」，看板拖卡改走 9119 並加上通知鈴，加入文字大小和英文介面，以及一次多題的提問卡 | PR #4，**目前版本** |
| v0.4–v0.8 | 見下面的〈路線圖〉 | 規劃中 |
| v1.0 | 可以不開 Hermes Desktop | 長期目標 |

v0.3 拿掉了舊的設定欄位，舊版設定檔會自動搬一次（舊 gateway 的主機配上 9119 埠），所以算一個小版本，而不是修補版。

## 已經能做的事

- **對話**：串流回覆、Markdown、程式碼一鍵複製，連結用系統瀏覽器開啟。工具呼叫收成一行，點開才看得到細節。
- **一般／Plan／旁問**：用 Shift+Tab 切換。Plan 會開計劃視窗，貼在面板旁邊。
- **批准和提問**：只有「批准（一次）」和「拒絕」兩個選項，永遠不會自動批准。一次多題的提問會每題各出一張卡，可以選選項，也可以自己打字回答。
- **停止、插話、排隊**：Bot 回覆時可以插話，和 Desktop 一樣只留下你的訊息。另一台裝置（手機、Desktop）正在執行時，會顯示「手機嗰邊行緊，排緊隊」。
- **Session**：預設開啟 Desktop 的 Bot Chat，也可以手動切換。`/new` 和「＋」會開一個新的子光球，不會改動主光球。也支援 `/title`、`/branch`、`/model`、`/stop`。
- **看板**：讀取 9119 的看板，可以切換看板、看卡片內容、拖卡改狀態，另外有通知鈴和未讀數字。
- **排程**：排程光球會顯示執行中、完成或失敗，面板會標出哪個工作失敗。目前只能看，開關排程還是要在 Hermes 裡改。
- **穿透**：光球平常不擋滑鼠，按住 Ctrl 才能點。面板平常可以點，按住 Ctrl 就會變透明，可以點到後面的視窗。
- **外觀**：文字大小有四段可選。介面有繁中（香港）和英文。光球和面板的透明度都可以調。
- **連線**：斷線會自動重試，重試時不會自己建立 session。

## 和 Hermes Desktop 比較

對照 Hermes Agent v0.22.5 的 Desktop 原始碼（`bf0203a`）。✅ 已有，⚠️ 部分有，❌ 還沒有。逐項的查證結果（Desktop 怎麼做、9119 有沒有對應的 API、需要多少工作量）整理在 [docs/ROADMAP.md](docs/ROADMAP.md)。

| 功能 | Overlay |
|------|---------|
| 串流對話、工具活動、Markdown | ✅ |
| 批准卡、提問卡 | ✅ |
| 停止、插話、排隊 | ⚠️ 沒有 Desktop 那種可以編輯、刪除、立刻送出的排隊面板 |
| 切換、新增、分支、改名 session | ✅ |
| 搜尋 session | ❌ |
| Plan／旁問、斜線選單 | ✅ |
| 換模型 | ⚠️ 只有 `/model` 指令，沒有選單，也不能調整思考程度 |
| 附件、圖片、長文貼上 | ❌ |
| 語音 | ❌ |
| 回到前一步（rewind） | ❌ |
| 手機和 Desktop 同時用同一個對話 | ⚠️ 可以即時看到，但自己的訊息還在排隊時，看不到對方的即時回覆 |
| Desktop 關著時也收得到 Bot 主動發的訊息 | ⚠️ 程式已經寫好，Windows 上還沒驗證 |
| 看板 | ⚠️ 可以看、可以拖卡，不能新增或編輯卡片 |
| 排程 | ⚠️ 只能看（目前的規則就是只能看） |
| 管理 profile（新增、改名、刪除） | ❌ |
| 設定 provider、模型、金鑰、記憶 | ❌ |
| 技能、工具組、MCP、plugin | ❌ |
| 訊息平台、webhook | ❌ |
| 檔案瀏覽、預覽、artifacts、終端機 | ❌ |
| 系統通知 | ⚠️ 只有光球旁的預覽和看板通知鈴 |
| 介面語言 | ⚠️ 只有繁中（香港）和英文；Desktop 有九種語言，包括簡中和日文 |
| 文字大小 | ⚠️ 看板欄頭不會跟著變 |
| 自動更新、簽章安裝檔 | ❌ |
| 第一次使用的設定流程 | ⚠️ 只有設定頁和提示橫幅 |
| 透明、置頂、滑鼠穿透 | ✅ 這是 Overlay 的本行 |

25 項中，5 項已齊、10 項部分有、10 項還沒有，大約四成。

查證時也確認了一件事：Desktop 用到的伺服器 API，v0.22.5 的 9119 幾乎都有。所以要補齊的主要是 Overlay 自己的程式，不太需要等伺服器改版。

## 路線圖

以下路線圖已經由 Devon 核准（2026-11-06）。每一項都歡迎在 [Issues](https://github.com/freezemusic/Hermes-Overlay/issues) 討論，順序也可以依大家的回饋調整。

### v0.4：把對話打磨好，並在 Windows 實測

- [ ] 排隊面板（參考 Desktop）：可以編輯、刪除、立刻送出，或改成插話
- [ ] 自己的訊息在排隊時，也要即時顯示手機那邊的回覆（目前要等排完才出現）
- [ ] 空白對話加上提示（目前是一片空白）
- [ ] `/branch` 不帶名稱時，新 session 會沿用 Hermes 複製的標題（例如 `Bot Chat #2`），要改成看得懂的名字
- [ ] 斜線選單加上快取（目前每次打 `/` 都會重新抓整份清單）
- [ ] 搜尋 session
- [ ] 系統通知（Windows 通知中心）
- [ ] 連不上伺服器時，`/` 選單和看板還會顯示舊的「未裝 overlay-slash」提示，要改成連線錯誤的說明
- [ ] 部分指令改走 `slash.exec` 時出現「slash worker closed pipe」：先在測試機重現，再確認是不是伺服器端的問題
- [ ] 看板通知鈴的清單可以用方向鍵選擇
- [ ] 關閉程式時偶爾會當掉（結束時 tao 重複釋放記憶體），不會遺失資料
- [ ] Hermes Desktop 關著時也能收到 Bot 主動發的訊息（R-SS-06）：在 Windows 實測，並確認 10 秒內出現
- [ ] 在 Windows 實機補驗 REQUIREMENTS 中標示「Win 未驗」的項目
- [ ] 美術監督剩下的意見：英文介面下的示範橫幅沒有翻譯、英文按鈕全部大寫、看板欄頭不跟著文字大小變

### v0.5：輸入與操作

- [ ] 圖片和檔案附件：從檔案選擇、拖曳進來、從剪貼簿貼上
- [ ] 換模型的選單，可以調整思考程度
- [ ] 回到前一步（rewind）、編輯後重送
- [ ] 新增、編輯看板卡片，以及留言
- [ ] 排程：新增、暫停、手動執行（目前規則是只能看，要先由 Devon 決定）
- [ ] 顯示用量和 context 使用量
- [ ] 匯出 session

### v0.6：管理功能

- [ ] 新增、改名、刪除 profile，並設定每個 Bot 的模型
- [ ] 設定 provider、模型、金鑰，以及第一次使用的設定流程
- [ ] 技能、工具組、MCP、plugin 的開關
- [ ] 記憶設定
- [ ] 訊息平台和 webhook（有人用到才做）
- [ ] 介面語言加上簡中和日文

### v0.7：工作區

- [ ] 瀏覽和預覽伺服器上的檔案、artifacts
- [ ] 終端機（要先決定開在哪一台機器上，見〈不做或待決定〉）
- [ ] 語音輸入和朗讀
- [ ] 快速輸入視窗、命令面板
- [ ] 維運頁面：doctor、備份、log

### v0.8（可選）

- [ ] Bot 群組聊天（@ 其他 Bot）
- [ ] Git review、worktree
- [ ] 學習圖譜、curator
- [ ] 委派設定、本機模型
- [ ] Computer use、瀏覽器控制
- [ ] 密碼庫（vault）
- [ ] 內嵌網頁預覽

### v1.0：可以不開 Hermes Desktop

- [ ] Devon 列出平常在 Desktop 會用到的功能，每一項在 Overlay 上（Windows）都能用，而且是對著他的伺服器版本實測過
- [ ] 決定簽章和更新的方式（見下面）
- [ ] 「不做」清單寫清楚
- [ ] 固定支援一個 Hermes 版本，並列出之後追新版的方式
- [ ] Devon 實際一週不開 Desktop

Desktop 改版很快：過去三個月大約發了 23 個正式版，從 v0.22.5 到 v0.23.0 的兩週內就改了一千多個檔案。所以 v1.0 是以「實際會用到的功能」來定義，而不是「Desktop 的全部功能」。

## 不做或待決定

**目前不打算做：**

- Desktop 的外掛 SDK。這些外掛是給 Desktop 介面用的模組，Overlay 要跑它們等於重寫一套 SDK。
- 在本機安裝、啟動 Hermes，或用 SSH 管理遠端 Hermes。Overlay 只當遠端 9119 的用戶端。
- Nous portal、免費額度、計費。

**需要 Devon 決定：**

- **自動更新**：技術上可以做，但需要發佈 Release。依照 REQUIREMENTS R-SY-05，沒有 Devon 同意不發 Release。
- **Windows 程式碼簽章**：
  - Desktop 用的 Azure Artifact Signing 不開放英國的個人開發者申請。
  - OV 憑證每年大約 US$150–300。
  - 只給自己的電腦用的話，自簽憑證就夠了，不用花錢。
- **排程**：要不要讓 Overlay 新增或修改排程（R-CR-01 目前規定只能看）。
- **Hermes 更新**：要不要能從 Overlay 觸發伺服器端的 Hermes 更新。
- **終端機**：要開在筆電上，還是伺服器上。
- **寵物、喚醒詞**：喚醒詞代表麥克風要一直開著。
- **外觀**：要不要對齊 Desktop 的主題系統。
- **伺服器版本**：要不要升級到 Hermes v0.23.0。有些新路由只有 v0.23.0 才有。

## 已知問題

- 安裝檔沒有簽章，Windows 會跳出 SmartScreen。
- 純 Wayland 讀不到全域游標，Overlay 只能一直保持可點擊，沒有穿透效果。
- 關閉程式時偶爾會當掉（見 v0.4）。
- 斜線選單沒有快取，每次打 `/` 都會問一次伺服器。
- 自己的訊息在排隊時，手機那邊的回覆不會即時出現，要排完才補上。
- 英文介面只翻譯了按鈕、標籤這類短字，較長的說明和少見的錯誤訊息還是中文。
- 連不上伺服器時，`/` 選單和看板會顯示舊的「未裝 overlay-slash」提示，但其實不需要裝這個 plugin。
- Bot Chat 的標題可能被伺服器改掉。這是伺服器端的問題，Overlay 不另外處理。

## 參與和回饋

這個專案是社群開發，很需要大家的使用回饋。

- **回報問題、提功能需求、給意見**：請到 [GitHub Issues](https://github.com/freezemusic/Hermes-Overlay/issues) 開 issue。
  - 回報問題時，請寫上作業系統、Overlay 的 commit 或版本、Hermes 的版本（`hermes --version`），以及重現步驟。
  - 請不要貼出密碼、token 或金鑰。
- **路線圖的項目**都可以討論：哪一項比較重要、哪一項可以不做，都歡迎直接在 issue 裡說。
- **送 PR 之前**：
  - 先讀 [AGENTS.md](AGENTS.md)。驗收依據是 [REQUIREMENTS.md](REQUIREMENTS.md)，實作細節在 [SPEC.md](SPEC.md)，兩者衝突時以 REQUIREMENTS.md 為準。
  - 改動要對上 REQUIREMENTS 的條號，並在說明裡列出受影響、重新驗證過的項目。
  - CI 必須全部通過（`npm test`、`cargo test`、Linux 和 Windows 打包檢查）。
  - 不要自行建立 git tag 或 GitHub Release。

## 安裝

安裝檔可以從 [GitHub Releases](https://github.com/freezemusic/Hermes-Overlay/releases) 下載。目前只有 v0.1.0 有 Release。v0.3.0 還沒發佈，Windows 版請用 CI 產生的 artifact `windows-x64-nsis`。安裝檔都**沒有簽章**。macOS 版開了 `macOSPrivateApi` 才能透明，所以**不能上架 Mac App Store**。

發佈時的檔名如下：

| 平台 | 檔案 |
|------|------|
| Windows | `Hermes Overlay_0.3.0_x64-setup.exe`（NSIS）、`Hermes Overlay_0.3.0_x64_en-US.msi` |
| macOS | `Hermes Overlay_0.3.0_universal.dmg`（Apple silicon + Intel）、`Hermes Overlay.app.tar.gz` |
| Linux | `Hermes Overlay_0.3.0_amd64.AppImage`、`Hermes Overlay_0.3.0_amd64.deb` |

### 第一次開啟沒有簽章的版本

**Windows**
- SmartScreen 顯示「Windows protected your PC」時，選 **More info → Run anyway**。
- 需要 WebView2 Runtime（新版 Windows 通常已經內建）。
- 登入資料存在 Windows 認證管理員（Credential Manager）。

**macOS**
- 在 `.app` 上按右鍵 →「打開」，或在終端機執行：

  ```bash
  xattr -dr com.apple.quarantine "/Applications/Hermes Overlay.app"
  ```

- 系統匣和全域快捷鍵 **Ctrl+Shift+Alt+H** 需要在「隱私權與安全性 → 輔助使用」允許這個 app。
- 登入資料存在鑰匙圈（Keychain）。

**Linux**
- AppImage 要先加上執行權限，再安裝 WebKit、GTK 和系統匣的相依套件（`.deb` 會自動安裝這三個）：

  ```bash
  chmod +x "Hermes Overlay_0.3.0_amd64.AppImage"
  sudo apt install libwebkit2gtk-4.1-0 libgtk-3-0 libayatana-appindicator3-1
  ```

- 登入資料用 Secret Service 儲存。`.deb` **建議**一起安裝：
  - `gnome-keyring`：沒有 Secret Service 時，儲存登入資料會顯示「鑰匙圈不可用」。KWallet 也可以提供 Secret Service。
  - `xdg-utils`：用系統瀏覽器開啟連結。
- 純 Wayland 讀不到全域游標和修飾鍵，所以 Overlay 會一直保持可點擊，不會穿透。要有穿透效果，請用 X11，或設定了 `DISPLAY` 的 XWayland。
- 桌面捷徑的檔名依 `productName` 產生，是 `Hermes Overlay.desktop`（Tauri 沒有另外設定檔名的選項）。`Exec` 和 `Icon` 是 `hermes-overlay`。

### 連上 Hermes Dashboard

1. 在伺服器上執行 `hermes serve`（Hermes Dashboard，預設埠 9119）。
2. 打開 Overlay 的設定：從系統匣選「設定」，或按 **Ctrl+Shift+Alt+H**。
3. 在「Kanban server」填入 `hermes serve` 的位址。留空的話，就是 `http://127.0.0.1:9119`。
4. 輸入帳號密碼登入，或留空改用系統瀏覽器登入。
5. 按儲存。

Bot 名單會自動從 Dashboard 的 `GET /api/profiles` 讀取，不用填任何 API 金鑰。

如果是從舊版升級，而且舊設定檔的「Kanban server」是空的，第一次載入時會把舊 gateway 的主機配上 9119 埠，寫入一次。例如 `http://10.10.24.33:8642` 會變成 `http://10.10.24.33:9119`。

### overlay-slash plugin（v0.3 不需要）

v0.3 的 `/` 選單和 `/plan` 直接使用 9119 內建的 `complete.slash`、`command.dispatch`，**不需要**再安裝 `hermes-plugin/overlay-slash`。這個 plugin 只給還在用舊版（v0.2 以前、走 8642）的人。舊版的 8642 設定方式請看 [v0.1.0 的 README](https://github.com/freezemusic/Hermes-Overlay/blob/v0.1.0/README.md)。

## 開發

### 需要的工具

- [Node.js](https://nodejs.org/) 20 以上（CI 用 22）
- [Rust stable](https://rustup.rs/)。Tauri 2.12 需要較新的 stable 版，系統套件附的舊版 `rustc` 可能不夠新：

  ```bash
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
  source "$HOME/.cargo/env"
  rustc -V
  ```

- 一台有 provider 設定好的 Hermes Agent，並執行 `hermes serve`。

**Linux（Debian／Ubuntu 類）**

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

- 登入資料存在系統的 Secret Service（gnome-keyring 或 KWallet）。
- 程式連結了 `sync-secret-service`，不會偷偷退回 keyring 的記憶體模擬版。沒有 keyring daemon 時，儲存會失敗並顯示錯誤。
- 編譯需要 `libdbus-1-dev`。

**macOS**
- 需要 Xcode Command Line Tools。
- 透明視窗開了 `macOSPrivateApi`，用了 private API，可能無法通過 App Store 審查。

**Windows**
- 需要 Microsoft Visual Studio C++ Build Tools 和 WebView2 Runtime。

### 執行和打包

```bash
npm install
npm run tauri dev
```

`npm run tauri dev` 會合併 `src-tauri/tauri.dev.conf.json`，identifier 是 `com.freezemusic.hermes-overlay.dev`。設定目錄和鑰匙圈的 service 名稱都跟著這個 id，所以不會蓋掉已安裝版本（`com.freezemusic.hermes-overlay`）的設定和登入資料。`npm run tauri build` 不會用到這個檔案。

**只跑前端**（沒有透明視窗、沒有鑰匙圈，會強制進入示範模式）：

```bash
npm run dev
# http://localhost:1420
```

**正式打包**：

```bash
npm run tauri build
```

**沒有圖形介面時，只驗證編譯和測試**：

```bash
npm run build
npm test
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
```

## 使用方式

1. 打開設定，在「Kanban server」填入 Dashboard 位址並登入。示範模式不在設定裡，要用 `--demo` 啟動。
2. 每個 Bot 可以設定 profile 名稱、顯示名稱、顏色和說明。名單通常會自動從 Dashboard 讀取。
3. 按儲存。螢幕邊緣會依名單數量排好光球。
4. **點一個光球**，主光球會開啟這個 profile 的 Bot Chat，也就是和 Hermes Desktop 同一個對話（標題剛好是 `Bot Chat` 的那一條）。
   - 啟動和開啟時都不會建立 session。還沒有 Bot Chat 的話，就保持沒有對話。
   - 選單裡可以手動改選其他 session，`Bot Chat` 固定在最上面。手動選的才會記住。
   - 收起再打開時，有手動選過就留在那一條，否則回到 Bot Chat。
5. **送出訊息**時，會經由 `/api/ws` 的 `prompt.submit` 送出，即時顯示文字，以及工具的開始、完成、失敗，和忙碌或閒置狀態。
   - 回覆和歷史訊息會顯示成 Markdown。串流期間大約每 50ms 更新一次。
   - 你自己打的字維持純文字。
6. **`/` 選單**的內容來自伺服器的 `complete.slash`。
   - ↑↓ 移動，Tab 補全。
   - `/new`、`/title`、`/branch`、`/model`、`/stop` 由 Overlay 自己處理，其他指令交給伺服器執行。
   - 回合進行中也可以打 `/stop`。
7. **停止**會經由 WebSocket 的 `session.interrupt` 要求伺服器停止這一輪。等伺服器確認後，畫面才會顯示「已停止」。
8. **斷線或逾時**時，看板、排程、Bot 名單和對話會自動重試，間隔依序是 5 秒、10 秒、20 秒，最長到 60 秒（上下浮動 20%）。
   - 網路恢復、從睡眠喚醒，或打開相關面板時，會立刻重試。
   - 重試不會建立 session。
9. 設定頁的「測試已儲存連線」會呼叫 Dashboard 的 `GET /api/health`，再對每個 Bot 讀一次 session 清單。

## 游標與穿透

光球和面板的行為剛好相反。預設的修飾鍵是 **Ctrl**（可以改成 Shift 或 Alt）。

- **光球**（Bot、設定、看板、排程）平常是實色，但滑鼠可以穿透，不會擋住後面的視窗。游標靠近時光球會淡化。按住 Ctrl 並對準光球，才能點擊。
- **面板**（Bot 面板、設定、看板、排程、計劃視窗）平常是實色、可以操作。按住 Ctrl 時，所有面板會變透明，滑鼠可以穿透；放開就恢復。
- 在其他程式裡按 Ctrl+C／Ctrl+V 時，光球和面板不會閃動。
- 在輸入框打字時，對話面板會保持實色。按 Esc、點空白處，或切到別的程式，就會解除。
- 在 Linux 上把修飾鍵改成 Alt 的話，視窗管理員可能會攔下 Alt+click，設定頁會顯示警告。
- 不用點擊也能開設定：按全域快捷鍵 **Ctrl+Shift+Alt+H**，或從系統匣選「設定」。系統匣和設定頁都有「結束」。對話面板的「關閉」只會收起面板，不會結束程式。

**實作方式**：

- Rust 端大約每 16ms 讀一次全域游標和修飾鍵（`device_query`）。
- Windows 和 macOS 用 `set_ignore_cursor_events` 切換整個視窗的穿透。
- Linux X11（包括 XWayland）用 GDK input shape。
- macOS 要允許「輔助使用」，否則可能讀不到修飾鍵。

詳細規則見 [REQUIREMENTS.md](REQUIREMENTS.md) §1（R-CT）。原本寫在 README 的實作筆記已經移到 [docs/CLICKTHROUGH.md](docs/CLICKTHROUGH.md)。

## 設定檔和登入資料

- **設定檔**：位址、名稱、顏色、說明等存在 app 設定目錄的 `config.json`，目錄名稱就是 bundle identifier。
- **登入資料**：Dashboard 的登入資料（token 或密碼）存在作業系統的鑰匙圈，service 名稱和 identifier 相同。網頁層拿不到明文。
- **第一次執行**：還沒有設定檔時，會自動打開設定頁。

## 外觀

- **配色**：色盤、圓角和字型都是 `:root` 裡的 CSS 變數，之後可以整組換主題。配色參考 Nous／Hermes 公開網站：電光藍 `#0000f2`、螢光黃 `#edff45`、紙白字 `#f5f5f5`。
- **光球**：像一團太陽光暈，中心接近白色，只帶一點 Bot 的顏色，往外漸淡到完全透明，沒有實色圓球和硬邊。
  - 選中的光球光暈更大、更亮，切換時脈動兩次，之後保持靜止。
  - 靠近螢幕邊的光球會往內縮，光暈不會被切掉。
- **面板**：中間面板大約 76% 不透明，設定卡大約 80%。支援的 WebView 會加上背景模糊。Linux 的 WebKitGTK 畫不出背景模糊，所以會把不透明度提高到大約 90%。
- **字型**：標題用 Barlow Condensed，內文用 Schibsted Grotesk，狀態用 IBM Plex Mono，中文用 PingFang HK／Noto Sans TC。這些都是開源字型，沒有內嵌專有字型，也沒有使用 Nous Research 或 Hermes 的標誌。
- **對比**：每一組文字和背景的對比至少 4.5:1。

`src-tauri/tauri.conf.json` 的視窗設定：

| 選項 | 值 | 作用 |
|------|-----|------|
| `transparent` | `true` | 視窗可以透明 |
| `decorations` | `false` | 沒有標題列 |
| `alwaysOnTop` | `true` | 永遠置頂 |
| `shadow` | `false` | 減少邊框陰影 |
| `maximized` | `false` | 不在顯示後才最大化，隱藏時就先鋪滿螢幕 |
| `macOSPrivateApi` | `true` | macOS 透明背景 |
| `identifier` | `com.freezemusic.hermes-overlay` | bundle id |

## 限制

1. **穿透**：純 Wayland 還不支援讀取全域游標和修飾鍵，所以會一直保持可點擊。Linux 請用 X11 或 XWayland。
2. **沒有圖形介面的環境（CI）**：`tauri dev`／`tauri build` 需要顯示器和 WebKit。沒有圖形介面時，用 `npm test`、`cargo check` 和 `cargo test`。
3. **Wayland**：部分合成器對透明和置頂的處理和 X11 不同。
4. **Hermes 版本**：通訊協定是對照 Hermes Agent v0.22.5 stable（`bf0203a`）的實機和原始碼。單元測試用本機的假伺服器固定這些格式。v0.23.0 還沒測。
5. **鑰匙圈**：需要 Secret Service、Keychain 或 Credential Manager，才能長期保存登入資料。

## 專案結構

```
.
├── index.html
├── REQUIREMENTS.md            # 驗收依據
├── SPEC.md                    # 實作細節
├── AGENTS.md                  # 協作者須知
├── docs/
│   ├── ROADMAP.md             # 和 Desktop 的逐項比較、路線圖依據
│   └── CLICKTHROUGH.md        # 游標與穿透的實作筆記
├── src/
│   ├── main.js                # 光球排列、設定、對話
│   ├── *.js                   # 各功能模組（看板、排程、子光球、斜線選單…）
│   ├── *.test.js              # Node 單元測試（npm test）
│   └── styles.css
├── src-tauri/
│   ├── tauri.conf.json
│   └── src/
│       ├── lib.rs             # Tauri commands、事件
│       ├── client/            # HermesClient：和 9119 的所有連線（REST、/api/ws、登入、看板）
│       ├── hermes.rs          # 共用的資料型別和解析
│       ├── sse.rs             # SSE 解析
│       ├── interaction.rs     # 穿透、Ctrl、修飾鍵
│       ├── secrets.rs         # 作業系統鑰匙圈
│       └── config.rs
├── hermes-plugin/overlay-slash/  # 舊版 8642 用的 plugin（v0.3 不需要）
└── scripts/                   # CI 用的假伺服器、Windows 穿透測試
```

## 授權

本專案以 MIT License 釋出，全文見 [LICENSE](LICENSE)。
