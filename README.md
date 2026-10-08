# Hermes Overlay

跨平台（Windows / macOS / Linux）**透明、無邊框、長期置頂** 嘅桌面 Overlay 骨架。

技術棧：**Tauri 2 + Vite + Vanilla HTML/CSS/JS**。介面文案用 **繁體中文（香港）zh-HK**。

## 功能（骨架）

- 全窗透明背景（`transparent: true` + CSS `background: transparent`）
- 無系統裝飾列（`decorations: false`）
- 啟動即 **always on top**（面板可撳「置頂／取消置頂」切換）
- 中間：詳情 + 對話氣泡 + 輸入框
- 邊框一圈：有幾個 mock Bot 就顯示幾個圓形按鈕；點選會高亮並更新中間內容
- 右側浮出訊息泡（對應線稿右側 callout）

## 前置需求

### 共通

- [Node.js](https://nodejs.org/) 18+（建議 20）
- [Rust via rustup](https://rustup.rs/)（**stable ≥ 1.90**；Tauri 2.12+ 需要）。系統套件嘅 `rustc` 1.85 唔夠新。

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source "$HOME/.cargo/env"
rustc -V
```

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

詳情：<https://v2.tauri.app/start/prerequisites/>

### macOS

- Xcode Command Line Tools
- 透明窗需要 `macOSPrivateApi`（本專案已喺 `tauri.conf.json` 開咗）。**用 private API 可能令 App Store 審核失敗。**

### Windows

- Microsoft Visual Studio C++ Build Tools
- WebView2 Runtime（新版 Windows 通常已有）

## 安裝同執行

```bash
npm install
npm run tauri dev
```

只起前端預覽（無原生透明／置頂）：

```bash
npm run dev
# 瀏覽器開 http://localhost:1420
```

正式打包：

```bash
npm run tauri build
```

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

前端：`html` / `body` 必須保持透明，否則會蓋住系統桌面。

## 已知限制

1. **Click-through（空白位滑鼠穿透）**  
   Tauri 有 `setIgnoreCursorEvents`，但一開全域穿透之後，空白位收唔到 hover，好難自動「移去 UI 就恢復」。骨架**預設關閉**穿透。若要實作，建議：
   - 快捷鍵切換穿透模式，或
   - 平台原生 hit-test（Windows `WS_EX_TRANSPARENT` 區域、macOS 自訂）  
   Linux 支援唔穩定。

2. **真 Agent 通道**  
   對話同 Bot 資料係 mock；傳送只會本地加示範回覆。

3. **無頭／CI 環境**  
   `tauri dev` 需要顯示器（或虛擬 framebuffer）。無 GUI 時可 `cargo check` 驗證 Rust 編譯。

4. **Wayland**  
   部分合成器對 transparent / always-on-top 行為同 X11 有差異。

## 專案結構

```
.
├── index.html           # Vite 入口
├── src/
│   ├── main.js          # Bot 列表、邊框排位、面板互動
│   └── styles.css
├── src-tauri/           # Tauri / Rust
│   ├── tauri.conf.json  # transparent / alwaysOnTop / decorations
│   ├── capabilities/
│   └── src/
├── package.json
├── vite.config.js
└── rust-toolchain.toml
```

## 授權

私人專案骨架；按需要自行修改。
