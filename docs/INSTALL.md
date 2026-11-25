# 安裝指南

> English summary: The [v0.3.0 pre-release](https://github.com/freezemusic/Hermes-Overlay/releases/tag/v0.3.0) (2026-11-25, commit `d4c1951`) is unsigned. Download needs no GitHub login. Assets are the Windows x64 NSIS installer `Hermes.Overlay_0.3.0_x64-setup.exe` and the Linux `Hermes.Overlay_0.3.0_amd64.deb`, plus `SHA256SUMS.txt`. This pre-release has no MSI, AppImage, or macOS build. Bypass SmartScreen with **More info → Run anyway**. Developed against Hermes Agent v0.22.5. Hermes Agent v0.23.4 was tested only with the Linux build on an isolated server. On Windows, the maintainer confirmed plan-file reading, external links, and tray restart; that check did not record the server's Hermes version. Attachments are not verified with a real model. macOS is not built or tested.

## 系統需求

| 項目 | 要求 |
|------|------|
| 作業系統（主要） | **Windows 10／11 x64** |
| WebView2 | 需要 [Microsoft Edge WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/)。Windows 11 通常已內建。本專案的 `src-tauri/tauri.conf.json` **沒有**覆寫 `bundle.windows.webviewInstallMode`，因此沿用 Tauri 2 預設：`{ "type": "downloadBootstrapper", "silent": true }`——安裝程式在缺少 Runtime 時會下載並安靜執行 bootstrapper（需要網路） |
| Hermes Agent | 開發時對照 **v0.22.5 stable**（`bf0203a`）。**v0.23.4**（`8fc0374`）只在隔離的 Linux 測試機上，用這次的 Linux 實機驗證過。兩邊都要執行 `hermes serve`（Hermes Dashboard，預設埠 **9119**），而且 Overlay 能連到該位址 |
| 其他平台 | 這次預先發佈附 Linux `.deb`。macOS 只有打包設定，這次沒有建置也沒有實測 |

## 這次預先發佈核對過的範圍

| 項目 | 範圍 |
|------|------|
| Windows 安裝檔 `d4c1951` | Devon 確認「睇計劃」直接讀檔、連結用系統瀏覽器開、系統匣「重啟」。該次沒有記錄伺服器的 Hermes 版本 |
| Linux 實機 `d4c1951` | 隔離測試機上的 Hermes v0.23.4：密碼登入、串流回覆、「睇計劃」直接讀檔；檔案不在時改走對話紀錄重組 |
| 單元測試 | 先前在 `d4c1951` 重跑：`npm test` 495 通過，`cargo test` 227 通過、1 略過 |
| 附件 | 程式可以選檔、拖入、貼上截圖。沒有用真模型驗證 Bot 是否讀到內容 |
| 系統瀏覽器登入（PKCE） | 沒有在 v0.23.4 上測 |
| macOS | 這次沒有建置、沒有實測 |

## 下載

1. 到 [v0.3.0 預先發佈](https://github.com/freezemusic/Hermes-Overlay/releases/tag/v0.3.0)。Release 頁面下載**不用登入 GitHub**。
2. 下載下面兩個安裝檔其中一個，以及 `SHA256SUMS.txt`。還在開發、尚未發佈的提交才要用 CI artifact（例如 `windows-x64-nsis`）；下載 artifact 要先登入 GitHub。
3. 這次的檔名（中間是點，不是空格）：

| 平台 | 檔案 | SHA256 |
|------|------|--------|
| Windows 10／11 x64（NSIS） | [`Hermes.Overlay_0.3.0_x64-setup.exe`](https://github.com/freezemusic/Hermes-Overlay/releases/download/v0.3.0/Hermes.Overlay_0.3.0_x64-setup.exe) | `8b389f07116a1d0128e52bde6320908008381d1bde61e41c1ee1c578f81df793` |
| Linux x64（Debian／Ubuntu） | [`Hermes.Overlay_0.3.0_amd64.deb`](https://github.com/freezemusic/Hermes-Overlay/releases/download/v0.3.0/Hermes.Overlay_0.3.0_amd64.deb) | `0dd80905556c779144fbbecb24013916515881626b6811136f5366dc6447c442` |

兩個檔案都取自 CI run [44795677438](https://github.com/freezemusic/Hermes-Overlay/actions/runs/44795677438)（`d4c1951`）。雜湊也在 [`SHA256SUMS.txt`](https://github.com/freezemusic/Hermes-Overlay/releases/download/v0.3.0/SHA256SUMS.txt)。這次沒有 MSI、AppImage 和 macOS 版。

安裝檔**沒有程式碼簽章**。

tag `v0.1.0`（`563c913`，2026-10-15）仍然保留。v0.1.0 的 Release 草稿已刪除，沒有公開的 v0.1.0 安裝檔。請安裝 v0.3.0。

`.github/workflows/release.yml` 可以另外產出 MSI、AppImage、macOS dmg／app，以及 `windows-SHA256SUMS.txt`、`macos-SHA256SUMS.txt`、`linux-SHA256SUMS.txt`。這些檔案**不在**這次預先發佈裡。

## Windows：SmartScreen（未簽名）

安裝或第一次執行時，可能看到：

> **Windows 已保護您的電腦**

請依序：

1. 按 **其他資訊**（英文介面是 **More info**）。
2. 再按 **仍要執行**（英文介面是 **Run anyway**）。

這是未簽名安裝檔的預期行為。若你的環境禁止略過 SmartScreen，需要管理員允許，或改用自行建置／自簽憑證（見 README「不做或待決定」）。

## 驗證 SHA256

下載 [`SHA256SUMS.txt`](https://github.com/freezemusic/Hermes-Overlay/releases/download/v0.3.0/SHA256SUMS.txt) 後，在 **PowerShell** 核對：

```powershell
Get-FileHash -Algorithm SHA256 ".\Hermes.Overlay_0.3.0_x64-setup.exe"
Get-Content ".\SHA256SUMS.txt"
```

Linux：

```bash
sha256sum Hermes.Overlay_0.3.0_amd64.deb
cat SHA256SUMS.txt
```

雜湊必須和上表以及 `SHA256SUMS.txt` 裡同一行一致。macOS 可用 `shasum -a 256`。

## 第一次設定

1. 在伺服器執行 `hermes serve`（Dashboard，預設 **9119**）。
2. 打開 Overlay 設定：系統匣「設定」，或快捷鍵 **Ctrl+Shift+Alt+H**。
3. 「Kanban server」填 Dashboard 位址。**留空**＝`http://127.0.0.1:9119`（程式碼：`config::DEFAULT_DASHBOARD_PORT = 9119`、`default_dashboard_origin()`）。
4. 登入（瀏覽器 PKCE，或帳號密碼），按「儲存」。
5. Bot 名單來自 `GET /api/profiles`，**不需要**每個 Bot 的 API 金鑰。

### `config.json` 放哪裡

路徑由 Tauri `app_config_dir()` + `config.json` 決定，目錄名等於 bundle identifier `com.freezemusic.hermes-overlay`：

| 平台 | 典型路徑 |
|------|----------|
| Windows | `%APPDATA%\com.freezemusic.hermes-overlay\config.json` |
| macOS | `~/Library/Application Support/com.freezemusic.hermes-overlay/config.json` |
| Linux | `~/.config/com.freezemusic.hermes-overlay/config.json` |

開發建置（`npm run tauri dev`）使用 `com.freezemusic.hermes-overlay.dev`，不會蓋掉正式版的設定與鑰匙圈。

登入用的 token／密碼存在作業系統鑰匙圈（Windows Credential Manager／macOS Keychain／Linux Secret Service），**不會**寫入 `config.json`。詳見 [SECURITY.md](../SECURITY.md)。

## 示範模式（不連伺服器）

```text
hermes-overlay --demo
```

或：

```text
set HERMES_OVERLAY_DEMO=1
hermes-overlay
```

設定頁**沒有**示範開關；`config.json` 也無法開啟示範模式（R-AR-05）。

## 解除安裝（Windows）

- 這次的安裝檔是 **NSIS**：Windows「設定 → 應用程式」或「控制台 → 程式和功能」裡移除 **Hermes Overlay**。
- 解除安裝**不一定**刪除 `%APPDATA%\com.freezemusic.hermes-overlay\` 與鑰匙圈項目；若要清除本機狀態，請手動刪除該資料夾，並在「認證管理員」移除 service 名稱為 `com.freezemusic.hermes-overlay` 的項目。

## Linux `.deb`

```bash
sudo apt install ./Hermes.Overlay_0.3.0_amd64.deb
```

套件建議一併安裝 `gnome-keyring`（或另一個 Secret Service，例如 KWallet）和 `xdg-utils`。沒有 Secret Service 時，儲存登入資料會顯示「鑰匙圈不可用」。連結用系統瀏覽器開，需要 `xdg-utils`。

純 Wayland 讀不到全域游標和修飾鍵，所以 Overlay 會一直保持可點擊，不會穿透。要有穿透效果，請用 X11，或設定了 `DISPLAY` 的 XWayland。

## macOS／未附在這次 Release 的格式

| 平台 | 狀態 |
|------|------|
| Windows | 這次附 NSIS。Devon 在筆電上核對了計劃讀檔、連結、系統匣「重啟」 |
| Linux（X11） | 這次附 `.deb`，並在隔離的 v0.23.4 測試機上做過上面的實機項目。純 Wayland **沒有**游標穿透 |
| macOS | 有 universal 打包設定（`macOSPrivateApi` 透明視窗），**這次沒有建置也沒有實測**；不能上架 Mac App Store |
| MSI、AppImage | release workflow 可以產出，**不在**這次預先發佈 |

## 已知問題

完整清單見 [README 〈已知問題〉](../README.md#已知問題)。安裝相關摘要：

- 安裝檔未簽名 → SmartScreen。
- 純 Wayland 無穿透。
- 關閉時偶發當掉（tao 重複釋放；不丟資料）。
- 英文介面下，訊息輸入框的提示文字仍然是中文（只影響外觀）。
- 附件沒有用真模型驗證。

## 相關文件

- [README](../README.md) — 功能、路線圖、開發指令
- [CHANGELOG.md](../CHANGELOG.md)
- [CONTRIBUTING.md](../CONTRIBUTING.md)
- [SECURITY.md](../SECURITY.md)
