# Hermes Overlay 規格

這是 Devon 對 Hermes Overlay 的單一依據。之後每一次改動都要逐條核對受影響的條文，再改程式。與 README、註解或較早說明衝突時，以本檔為準。

條文用「必須／不得」寫成可觀察的結果。UI 字串維持繁體中文（zh-HK）。英文只用於程式、協定與專有名詞。

預設修飾鍵是 Ctrl，可在設定改成 Shift 或 Alt。下面寫 Ctrl 的地方，若設定改了修飾鍵，就改指那個鍵。透明度百分比的預設是 18%（設定範圍 5–60），下面稱作靜止透明度。

## 1. 互動

光球與面板方向相反。

1. 光球（包括設定光球與看板光球）在未按住修飾鍵時必須半透明，透明度等於靜止透明度，而且滑鼠穿透：不接收 click、hover 或 right-click。
2. 按住修飾鍵時，只有游標在其上或距命中區 12px 以內的那一粒光球變成不透明（透明度 1）並且可點。其餘光球保持靜止透明度與穿透。
3. 放開修飾鍵後，該光球必須回到半透明與穿透。
4. 右鍵「隱藏呢個 Bot」只在按住修飾鍵、而且游標在該 Bot 光球上時出現。未按住修飾鍵時，右鍵不得打開這個選單。
5. 隱藏選單是面板：修飾鍵仍按住時它跟其他面板一樣穿透；放開修飾鍵後才可以點「隱藏呢個 Bot」。
6. 面板（Bot 面板、設定、看板）在未按住修飾鍵時必須不透明（透明度 1）、可點、可操作。游標移近或移過面板不得讓它變淡。
7. 按住修飾鍵、而且游標位置已知時，所有面板必須降到靜止透明度並穿透。放開後恢復不透明與可操作。
8. Toast 維持不透明。只有未按住修飾鍵、而且游標在該 toast 上時才可點。
9. 在其他程式或本程式輸入框按 Ctrl+C 或 Ctrl+V 時，光球與面板的透明度與穿透不得改變，也不得閃一下。這包括 C／V 先放開、Ctrl 仍按住的整段尾巴。單獨按住 Ctrl 必須在 100ms 內進入第 2 與第 7 條的互動狀態。修飾鍵若改成 Shift 或 Alt，Ctrl+C／Ctrl+V 不適用這條約束。
10. 面板必須能在視窗內拖移：拖標題列改變該面板的 `left`／`top`。不得改成拖動整個作業系統視窗。拖移中途游標離開原矩形，拖移仍須完成。
11. 讀不到全域游標或修飾鍵時（純 Wayland），光球與面板保持可點，不得進入穿透。
12. 冷啟動的視窗必須鋪滿所在螢幕。不得停在置中的 1280×800，否則點擊打不中 overlay。Windows 上不得用會把無邊框視窗縮回 1280×800 的位置或尺寸呼叫來完成這件事。

## 2. 面板開關

1. 每一粒 Bot 光球只打開與關閉自己的面板。打開 A 不得關閉 B、設定或看板。
2. 面板上的關閉只關閉該面板。
3. 點已經打開的光球必須把該面板升到最前，而不是關掉其他面板。
4. 打開必須從所屬光球展開，關閉必須收回該光球。動畫 0.48s、`cubic-bezier(0, 0, 0.2, 1)`、由 `scale(0.92)` 到 1。不得使用 spring，不得過衝。
5. `prefers-reduced-motion` 時，上述動畫必須短到看不出位移（1ms）。

## 3. 設定光球與 Bot 面板

1. 必須有一粒獨立的設定光球。它開啟的面板才放 Hermes gateway、dashboard、名單、API 金鑰、修飾鍵、置頂與結束程式。
2. Bot 面板只編輯該 Bot 的顯示名稱、詳情與 `SOUL.md`。Bot 面板不得出現 gateway 位址或 API 金鑰欄。
3. `SOUL.md` 路徑：環境變數 `HERMES_HOME` 有非空值就用它，否則用 `$HOME/.hermes`。profile `default` 寫在該目錄根上的 `SOUL.md`；其他 profile 寫在 `profiles/<profile>/SOUL.md`。
4. profile 名稱只允許 1–64 字元的 ASCII 英數與 `.`、`_`、`-`。不得含 `/`、`\`、`.` 或 `..`。
5. API 金鑰只放系統鑰匙圈，不得寫入 `config.json`。

## 4. 發現 profile 與隱藏

1. 連上 Hermes（`mode == hermes`）時必須自動發現 profile，並寫入設定。發現來源只有：本機 Hermes home（根目錄有 `config.yaml` 或 `SOUL.md` 則為 `default`；`profiles/` 下合法子目錄為其他 profile）、已儲存 dashboard session token 時的 `GET /api/profiles`（逾時 4 秒，失敗則略過）、以及 gateway `/health` JSON 裡真正帶有 `profiles` 陣列的情況。
2. 不得靠猜測 `GET /p/<id>/health` 來枚舉 profile。本機已發現的 profile 不得因為 gateway health 失敗而被刪掉。
3. 新發現的 profile 預設顯示為光球。不得自動產生 API 金鑰。只有這次新加入且沒有金鑰的 profile 才提示「未有 API 金鑰，請喺設定填寫。金鑰唔會自動產生。」
4. 設定名單必須列出已停用的 profile，並有「顯示」勾選。取消顯示後光球消失，列與金鑰都保留。
5. 右鍵隱藏（見第 1.4 條）等同取消顯示，而且不得從儲存名單刪掉該列，否則鑰匙圈金鑰會被刪掉。
6. 「移除」才刪除該 profile 的金鑰。之後再次發現會重新出現，但必須重新填金鑰。
7. 再次發現不得覆蓋使用者已改的顯示名稱、詳情、專用位址或 session。顯示名稱只在空白或仍等於 profile id 時更新；詳情只在空白時更新。Hermes 若提供可解析的顏色，該顏色必須覆蓋既有顏色。

## 5. 對話

1. 打開 Bot 面板時，預設必須是該 profile 最近活躍的 session。不限標題，也不優先隱藏的 session。列表為 `{root}/api/sessions?limit=200&include_hidden=true`。
2. 同分時 `last_active` 較大者勝；仍相同則 id 較小者勝。
3. 面板內必須有 session 選擇器。使用者選過的 session 要按 Bot 記住，直到使用者再改，或另一條 session 的 `last_active` 嚴格大於選擇當下的水位。
4. 舊設定若只是存著一條 `Bot Chat` id、而使用者沒有明確選過，打開時必須改跟最新 session，不得停在過期對話。
5. 只有該 profile 完全沒有 session 時，才建立標題為 `Bot Chat` 的 overlay 專用對話。
6. `/new` 與 `/branch` 必須把新 session 記成使用者的選擇，不得立刻被「最新」蓋掉。
7. 送出時若有明確選擇就用該 id。該 id 回 404 時清掉選擇，再解析最新 session。

## 6. 光球顏色與計劃預覽

1. 光球顏色必須來自該 Hermes profile，而不是全部用同一個藍色。
2. 本機顏色只讀 `profile.yaml` 的 `ui_meta.hermes-bots.color`。`default` 讀 Hermes home 根目錄；具名 profile 讀 `profiles/<id>/profile.yaml`。區塊外的 `color` 不得採用。
3. dashboard 或 health 可提供 `color`、`bot_color`，或 `ui_meta` 裡 `hermes-bots`／`hermes_bots` 的 `color`。本機 yaml 有色時必須蓋過 dashboard。
4. 接受 `#rgb`、`#rrggbb`、`hsl(H S% L%)`、`hsl(H, S%, L%)`、`rgb(...)`，並存成小寫 `#rrggbb`。例：`hsl(326 68% 58%)` 必須成為 `#dd4b9e`，`#ABC` 必須成為 `#aabbcc`。無法辨識時不得用雜湊造色。
5. Hermes 顏色解析成功就必須用它，蓋過色票與已存的選擇器顏色。沒有顏色時保留已存顏色；全新列才用色票。
6. 沒有獨立的計劃 API。Bot 回覆若是計劃（含 Implementation Plan 與標題、或 `.hermes/plans/*.md` 與標題、或標題加 `**Goal:**`、或上一句使用者指令是 `plan` 且回覆至少 40 字），Bot 面板必須顯示計劃預覽。進行中的 live 氣泡不得當成計劃。
7. 預覽用與對話相同的 Markdown 渲染，放在該 Bot 面板內，預設展開。「收起／展開」只切換預覽正文，對話原文必須留下。

## 7. Toast 與思考狀態

1. 新訊息必須以 toast 提示。時間必須是 24 小時 `HH:MM`，不得出現 `下午09:42` 這類 12 小時格式。
2. 同一時間最多三則 toast。一則顯示 5 秒。
3. Bot 思考中或使用工具時，光球必須持續顯示 spinner。閒置時不得有無限循環的動畫。
4. 名稱以 `_` 開頭或名為 `reasoning` 的進度只轉 spinner，不另開 toast。
5. 助手開始串流文字後 spinner 停止。完成、失敗、取消，或 90 秒沒有新事件後，思考狀態必須結束；若回合仍忙，狀態改為等候且不再空轉。

## 8. 看板

1. 必須有一粒看板光球。它打開的是即時看板，而不是另一個 Bot 的對話。
2. 看板資料來自 Hermes 上的 overlay-slash plugin。未安裝時必須顯示「未裝 overlay-slash kanban，看板唔會出現。」不得顯示假任務。
3. 欄位順序為 triage、todo、ready、running、blocked、done。`archived` 不得出現。
4. 開啟時必須輪詢更新（5 秒）。拖卡片必須能改任務狀態並寫回。
5. 看板光球遵守第 1 節的光球規則，看板面板遵守第 1 節的面板規則。

## 9. Markdown 與斜線指令

1. 助手訊息（含串流中）必須渲染 Markdown：標題、粗斜體、清單、程式碼、引用、表格、分隔線。使用者自己打的字維持純文字。
2. 串流約每 50ms 重繪一次。未閉合的程式碼圍欄必須維持為程式碼塊。空程式碼塊不得出現複製鈕。
3. 原始 HTML、事件處理器與 `javascript:` 連結必須被去掉。
4. 連結必須用系統瀏覽器打開，不得在 overlay 裡換頁。
5. 輸入 `/` 必須打開 overlay-slash 的指令選單（`GET /v1/overlay/commands`）。分類按首次出現順序。↑↓ 移動，Tab 補全。沒有參數提示的指令按 Enter 要補全並送出。
6. `/new`、`/title`、`/branch`、`/model`、`/stop` 由 overlay 處理。其他指令原文送出，由 plugin 改寫。回合進行中仍必須能送 `/stop`。
7. 歷史裡的 `<!-- overlay-slash: ... -->` 必須顯示成可讀的指令標籤，而不是整段註解。

## 10. 視覺（美術監督 v20）

視覺以美術監督的 v20 審查為準。

1. 面板玻璃霧底至少 0.85。指定值為 `rgb(247 248 248 / .88)`。Linux WebKitGTK 用 `.92`。
2. 介面墨色 `#000091`。訊息正文 `#1a1a1a`。
3. 面板是 1px `#0000f2` hairline，加上四角 HUD 角標。不得改成 5px 全螢幕外框。
4. 程式碼塊黑底 `#000`、白字 `#fff`。
5. 光球核心只留近白眩光（`#fff 0 36%`）。不得加回粗的實色藍外圈。外暈用該 Bot 顏色，約 `.55` 與 `.22`。
6. 思考圈是 1px、顏色 `--bot-60` 的弧線。不得用粗的 `#0000f2` 加外發光。等候時弧線不旋轉。
7. 看板菱形是 1px `#616191`，不得加黑色雙框，也不得用 `scale()` 把線縮沒。欄標題 `#0000f2`。格線用半透明 `--bot-5`。
8. 控制項圓角 0–3px，面板最大 3px。只有大型 popout 可以用 6px。
9. 中文不得 `text-transform: uppercase`，也不得加 letter-spacing。全檔只能有一組 uppercase，而且只在 `:lang(en)` 底下。
10. hover 與 press 為 120–200ms。面板與 toast 進場約 0.48s ease-out。不得使用 spring。`scale(0.92)` 只出現在光球展開／收回。
11. Popout 陰影只有 `0 4px 40px rgb(0 0 145 / .6)`。

## 11. 部署

1. Overlay 跑在 `LAPTOP-DEVON`，連線對象是遠端 Hermes API，不是假設 gateway 一定在這台電腦的 `127.0.0.1`。設定仍允許填那台機器 reach 得到的 gateway 位址。
2. 安裝檔維持未簽名。Windows 測試用 CI artifact `windows-x64-nsis`，不靠發佈 release。
3. 未獲明確要求，不得建立 git tag，也不得建立 GitHub Release。Release workflow 的 tag 與 draft 行為不得為了測試安裝檔而改掉。
