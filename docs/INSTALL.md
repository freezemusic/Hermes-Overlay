# 安裝指南

> English summary: Download an unsigned Windows NSIS/MSI build from [Releases](https://github.com/freezemusic/Hermes-Overlay/releases) (only `v0.1.0` is published today; `v0.3.0` is not released yet). Bypass SmartScreen with **More info → Run anyway**, verify SHA256 when checksum files are attached, point Settings at Hermes Dashboard port **9119**, or launch with `--demo`. macOS/Linux artefacts are produced by CI but are **untested** as daily drivers.

## 系統需求

| 項目 | 要求 |
|------|------|
| 作業系統（主要） | **Windows 10／11 x64**（實測平台） |
| WebView2 | 需要 [Microsoft Edge WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/)。Windows 11 通常已內建。本專案的 `src-tauri/tauri.conf.json` **沒有**覆寫 `bundle.windows.webviewInstallMode`，因此沿用 Tauri 2 預設：`{ "type": "downloadBootstrapper", "silent": true }`——安裝程式在缺少 Runtime 時會下載並安靜執行 bootstrapper（需要網路） |
| Hermes Agent | **v0.22.5 stable**（`bf0203a`），並執行 `hermes serve`（Hermes Dashboard，預設埠 **9119**），且 Overlay 能連到該位址。**v0.23.0 尚未實測** |
| 其他平台 | macOS／Linux 有打包設定與 CI 產物，但**不是**目前的日常實測平台（見下方） |

<!-- tested on: filled after laptop test -->

## 下載

1. 到 [GitHub Releases](https://github.com/freezemusic/Hermes-Overlay/releases)。
2. 目前公開 Release 只有 **`v0.1.0`**（2026-10-15）。**v0.3.0 尚未發佈**；開發中的 Windows 建置請用 CI artifact `windows-x64-nsis`（見 README）。
3. 發佈後預期檔名（版本號以 `package.json`／`tauri.conf.json` 為準）：

| 平台 | 檔案 |
|------|------|
| Windows | `Hermes Overlay_0.3.0_x64-setup.exe`（NSIS）、`Hermes Overlay_0.3.0_x64_en-US.msi` |
| macOS | `Hermes Overlay_0.3.0_universal.dmg`、`Hermes Overlay.app.tar.gz` |
| Linux | `Hermes Overlay_0.3.0_amd64.AppImage`、`Hermes Overlay_0.3.0_amd64.deb` |

安裝檔**沒有程式碼簽章**。

### NSIS 與 MSI（Windows）

- **NSIS**（`-setup.exe`）：一般使用者安裝／解除安裝較直覺，建議優先用這個。
- **MSI**（`.msi`）：適合需要 msiexec／企業部署的情境。
- 兩者功能相同；擇一安裝即可，不必兩個都裝。

## Windows：SmartScreen（未簽名）

安裝或第一次執行時，可能看到：

> **Windows 已保護您的電腦**

請依序：

1. 按 **其他資訊**（英文介面是 **More info**）。
2. 再按 **仍要執行**（英文介面是 **Run anyway**）。

這是未簽名安裝檔的預期行為，不是病毒警報本身。若你的環境禁止略過 SmartScreen，需要管理員允許，或改用自行建置／自簽憑證（見 README「不做或待決定」）。

## 驗證 SHA256

發佈流程會為每個平台上傳 `windows-SHA256SUMS.txt`／`macos-SHA256SUMS.txt`／`linux-SHA256SUMS.txt`（見 `.github/workflows/release.yml`）。下載安裝檔與對應的 SUMS 後，在 **PowerShell** 核對：

```powershell
Get-FileHash -Algorithm SHA256 ".\Hermes Overlay_0.3.0_x64-setup.exe"
Get-Content ".\windows-SHA256SUMS.txt"
```

兩邊的雜湊必須一致。Linux／macOS 可用 `sha256sum` 或 `shasum -a 256`。

> 注意：checksum 步驟會在**第一次**打 `v*` tag 並跑 Release workflow 時才真正驗證；在那之前請以 CI artifact 的來源為準。

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

- **NSIS**：Windows「設定 → 應用程式」或「控制台 → 程式和功能」裡移除 **Hermes Overlay**。
- **MSI**：同上，或 `msiexec /x <產品>`。
- 解除安裝**不一定**刪除 `%APPDATA%\com.freezemusic.hermes-overlay\` 與鑰匙圈項目；若要清除本機狀態，請手動刪除該資料夾，並在「認證管理員」移除 service 名稱為 `com.freezemusic.hermes-overlay` 的項目。

## macOS／Linux 狀態

| 平台 | 狀態 |
|------|------|
| Windows | 主要使用與實測環境 |
| Linux（X11） | CI 打包；README 記載在測試機驗證過穿透等行為。純 Wayland **沒有**游標穿透 |
| macOS | 有 universal 打包設定（`macOSPrivateApi` 透明視窗），**尚未當日常用戶端實測**；不能上架 Mac App Store |

Release workflow 會為三個平台產物建置，但**請勿假設** macOS／Linux 建置已經過與 Windows 同等的驗收。

## 已知問題

完整清單見 [README 〈已知問題〉](../README.md#已知問題)。安裝相關摘要：

- 安裝檔未簽名 → SmartScreen。
- 純 Wayland 無穿透。
- 關閉時偶發當掉（tao 重複釋放；不丟資料）。

## 相關文件

- [README](../README.md) — 功能、路線圖、開發指令
- [CHANGELOG.md](../CHANGELOG.md)
- [CONTRIBUTING.md](../CONTRIBUTING.md)
- [SECURITY.md](../SECURITY.md)
