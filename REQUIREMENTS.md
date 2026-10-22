# Hermes-Overlay 要求同驗收清單（v0.1）

> 狀態：**Devon 於 2026-10-21 核准。** 本檔係驗收依據。同 `SPEC.md` 衝突時以本檔為準。`SPEC.md` 只做實作細節。
> 整理日期：2026-10-21。整合自：Devon 歷來要求（記憶）、repo `SPEC.md`／`AGENTS.md`／`README.md`（branch `cursor/v20-art-director-fixes-ddc6`，head `d8fd9b0`）、PR #3 內文、`DESIGN-REVIEW*.md`、`DESIGN-SPEC.md`、`ORB-REVERT-SPEC.md`、`SUBORB-SPEC.md`、`screens-v84/ad`、`screens-v85/ad`、`laptop-b919b7f/CLICKTHROUGH-DIAG.md`。
> 本檔講「要乜」同「點樣先算過」。實作細節（WAAPI、input shape、`device_query` 等）留喺 repo `SPEC.md`。

## 0. 點睇

**狀態圖例**：✅ 過｜❌ 唔過｜⚠️ 部分／有條件｜❓ 未驗｜— 唔適用
狀態欄格式：`f8cb046 / b919b7f`。括號註明喺邊度驗：(Win) 手提 LAPTOP-DEVON，(盒) Linux box。
已知：f8cb046 喺 Windows 穿透正常；b919b7f 喺 Windows **完全撳唔到後面**，而且啟動時改咗 4 個 bot 嘅 session。

**驗收原則**：只認可觀察到嘅行為。讀 exstyle、log、DOM 屬性、單元測試，只可以做輔助證據，**唔可以當通過**。

**共用測試工具**
- **T-WIN-CLICK（Windows 真點擊）**：overlay 後面擺一個會即時顯示收到點擊嘅視窗（例如 Notepad 加一個會記低點擊座標嘅測試頁或 app），喺預先定好嘅點做真滑鼠點擊（Devon 手撳，或者測試程式用 `SendInput` 模擬真硬件輸入）。點：(a) 冇嘢嘅空位 ×5；(b) 光球正中，冇撳 Ctrl ×各 1；(c) 已打開面板旁邊嘅空位 ×3；(d) 收合後原本面板位置 ×3；(e) 計劃視窗旁邊空位 ×2。**後面視窗收到嘅點擊數 = 應該收到嘅數先算過。**
- **T-WIN-HOVER**：後面放瀏覽器頁，有 hover 效果；游標掃過 overlay 透明位，hover 效果要出。
- **T-BOX-REC**：box 由 source build（`npx tauri build --no-bundle`），獨立 keyring，30fps 錄影，逐幀量度。
- **T-REF**：同一部機、同一張桌布，build f8cb046 做光球外觀參考。

---

## 1. 穿透同 Ctrl 規則（R-CT）

**R-CT-01** overlay 除咗按 Ctrl 規則可以互動嘅光球／面板之外，**絕對唔可以擋住後面程式嘅點擊、hover 同滾動**。光球同面板嘅命中區可以伸出矩形外最多 12px（`HIT_MARGIN_PX`，`interaction.rs`）。再外嘅點一定要穿透。頁腳量度跌出殼外時，命中區只包住殼，唔好拉成成版高。
- 來源：Devon（多次；2026-10-21「根本按不到後面任何東西」）；SPEC §1、§2 開首。
- 驗收（Windows，必做）：T-WIN-CLICK 全部點數到；T-WIN-HOVER 有反應；喺後面程式捲動得到。啟動後 0.5s、30s、5 分鐘各做一次（因為 e3db750 起啟動後 0.2s 已經食點擊）。
- 驗收（盒）：同一套點用 xev／測試窗收到點擊。
- 狀態：✅(Win) / ❌(Win，全部食咗)。盒：f8 ✅ / b919 ✅（盒測驗唔到呢個 Windows bug）。

**R-CT-02** 光球（Bot、設定、看板、排程）預設穿透：唔收 click、hover、右撳。「預設半透明（靜止透明度，預設 18%，可設 5–60%）」已取代，見 R-OB-05。按住修飾鍵時，游標下面（或 12px 內）嗰粒光球嘅命中永遠贏過蓋住佢嘅面板，Ctrl+click 要去到嗰粒光球。
- 來源：Devon Ctrl 規則；SPEC §1.1。外觀半透明由 R-OB-05 取代（Devon 2026-10-22）。
- 驗收（兩邊）：唔撳 Ctrl 喺光球正中左撳、右撳、hover → 後面視窗收到，光球唔變、唔開 menu、唔出名稱標籤。
- 狀態：✅(Win) / ❌(Win，因 R-CT-01)。

**R-CT-03** 揸住 Ctrl 嗰陣，只有游標下面（或 12px 內）嗰粒光球可以撳。名稱標籤只喺 Ctrl+hover 先出，放手即消失。「其他光球維持半透明、放手即刻返半透明」已取代，見 R-OB-05：游標唔近就實色；行近先淡；Ctrl 揸住而且游標喺淡出範圍內嗰粒返實色。
- 來源：Devon；SPEC §1.2–1.3。外觀由 R-OB-05 取代（Devon 2026-10-22）。
- 驗收（兩邊）：Ctrl+撳光球 → 開該面板；Ctrl 唔放，撳隔籬空位 → 後面收到；放 Ctrl 後再撳光球 → 後面收到。按 Ctrl 後 ≥10ms 先撳，16 次要 16 次中（0ms 競賽另計，見衝突 C-12）。
- 狀態：❓(Win) / ❓(Win)。盒：b919 ⚠️ 14/16、15/16（失敗全部係 0ms 競賽，≥10ms 24/24）。

**R-CT-04** 面板（Bot 面板、設定、看板、排程、貼住嘅計劃視窗）預設**實色、可以撳、可以操作**；游標行近唔會令佢變淡。
- 來源：Devon Ctrl 規則；SPEC §1.6。
- 驗收（兩邊）：唔撳 Ctrl，游標剛到就撳輸入列／關閉／計劃 ✕，第一下就生效；hover 過面板，透明度量度唔變。
- 狀態：❓ / ❓(Win)。盒 b919：輸入列、關閉 ✅；計劃掣 ❌（見 R-PL-05）。

**R-CT-05** 揸住 Ctrl 嗰陣，所有面板（連關閉掣同計劃視窗）變透明而且穿透；放手一幀內返實色、可操作。
- 來源：Devon Ctrl 規則；SPEC §1.7。
- 驗收（兩邊）：Ctrl 揸住，喺面板內文、關閉掣、計劃 ✕ 撳 → 後面視窗收到，面板冇反應；放手後 1 幀內實色（30fps 錄影，冇中間格、冇閃）。
- 狀態：❓ / ❓(Win)。盒 b919 ✅（0 個 pointer event）。

**R-CT-06** 喺其他程式或者 overlay 輸入框撳 Ctrl+C／Ctrl+V，光球同面板嘅透明度同穿透**完全唔變、唔閃**，包括 C／V 放咗、Ctrl 仲揸住嗰段。
- 來源：Devon；SPEC §1.9。
- 驗收（Windows 必做＋盒）：喺 Notepad 做 20 次複製貼上，錄 30fps，overlay 範圍冇任何像素變化；期間撳後面視窗照收到。
- 狀態：❓ / ❓。

**R-CT-07** 單獨揸 Ctrl，到畫面進入互動狀態，Windows 總延遲中位數 ≤100ms（app 自己嗰段 ≤22ms）。
- 來源：Devon；美術監督 PR3c（v79）；SPEC §1.9。
- 驗收（Windows）：高速錄影或者鍵盤事件時間戳對畫面，量 20 次，中位數 ≤100ms。
- 狀態：❓ / ❓。盒：e3db750 app 段 ≤22ms ✅；總延遲 82.8ms（盒，v79）。

**R-CT-08** 已聚焦嘅輸入框唔會因為撳／放 Ctrl 而失焦；放 Ctrl 後打嘅第一個字入到輸入框。Ctrl+Enter **唔送出**。
- 來源：SPEC §1.6–1.7。
- 驗收（兩邊）：Enter 送 10/10；Ctrl+Enter 送 0/6。
- 狀態：❓ / ✅(盒)。

**R-CT-09** 讀唔到全域游標／修飾鍵（純 Wayland）時，overlay 保持可撳，唔入穿透。
- 來源：SPEC §1.11。驗收（盒，Wayland session）：光球同面板直接撳得。狀態：❓ / ❓。

**R-CT-10** 冷啟動視窗鋪滿所在螢幕；第一眼光球已經喺最終位置；啟動只出光球，唔自動開面板；工作列同系統匣仲喺度。
- 來源：SPEC §1.12、§2.6。
- 驗收（兩邊）：啟動錄影第一個可見幀光球已經喺最終位置；冇 1280×800 置中窗；R-CT-01 喺啟動後 0.5s 已經過。
- 狀態：❓ / ⚠️（盒過；Windows 穿透唔過，懷疑同隱藏啟動有關，見 C-08）。

---

## 2. 面板開關同動畫（R-PN）

**R-PN-01** 每粒光球只開／關自己個面板；開 A 唔會收 B、設定、看板或排程；幾個面板可以同時開，各自獨立。撳已開嘅光球就攞嗰塊去最前。同時開嘅面板唔可以矮過可用下限（一般 240px；排程欄用自己嘅 140px）。畫面放唔晒就重疊邊緣堆疊，唔好壓成一條線，而且每塊都要完整留喺畫面入面。內容高出卡片就喺面板裡面捲，殼同關閉掣留喺可見卡片入面。Esc 關一層：圓球選單、session 下拉、slash 先收；否則關焦點所在嘅面板（輸入框唔會自己食咗呢下），冇焦點就關最上面（z 最高）嗰塊。
- 來源：Devon；SPEC §2.1–2.3。
- 驗收（兩邊）：順序開 3 個 bot ＋看板＋排程，全部仲開住；逐個關，其他唔郁。
- 狀態：❓ / ❓。

**R-PN-02** 面板由**自己嗰粒光球**展開同收返：光球位置 = 面板標題球位置，光球唔飛、唔平移；向螢幕中間展開；四條邊各自按 SPEC §2.4 擺 header（底緣 header 喺底，上緣喺頂）。
- 來源：Devon（「光球位置 = 面板標題球位置」）；ORB-REVERT §3；美術監督 PR3c。
- 驗收（盒＋Windows 目測）：四邊各錄一次，逐幀光球中心位移 ≤1px；展開方向啱。
- 狀態：❓ / ✅(盒，v79 起)。

**R-PN-03** 面板可以拖（拖標題列）；拖嘅只係面板，唔係成個 OS 視窗；計劃視窗跟住一齊拖；收返嗰陣光球返原本邊緣位置。放開之後面板留喺嗰個位置，只鉗入畫面。設定卡左邊緣放喺畫面左約 300px 內，不得再向右跳（約 636px，即卡片寬減光球直徑：錨點過咗畫面中線就翻邊）。
- 來源：Devon；SPEC §1.10、§6.8。
- 驗收（兩邊）：拖到螢幕中間，游標拖出原矩形都完成；收合後光球喺原邊緣錨點。
- 狀態：❓ / ❓。

**R-PN-04** 打開：光球→膠囊 200ms，膠囊→面板 480ms `cubic-bezier(.2,.8,.2,1)`，中間唔停；冇 spring、冇 overshoot；外框同角標由第一幀跟住長。
- 來源：美術監督 PR3b §5–6；SPEC §2.7。
- 驗收（盒 T-BOX-REC）：膠囊停頓 0 格；面板段約 14 格；冇空框格、冇內容閃。
- 狀態：❓ / ✅(盒)。

**R-PN-05** 收合時間（美術監督）：上緣面板 300ms `cubic-bezier(.4,0,1,1)`，內容先 80ms 淡出；有計劃時計劃先收 200ms，計劃收到 160ms 主面板開始收；總長 ≤500ms。後備方案 (b)：維持 382ms、面板喺計劃 +100ms 開始。冇計劃嘅邊：可見收合 300–333ms。
- 來源：美術監督 PR3c 應改 #2、v82 改 300ms；SPEC §2.9。
- 驗收（盒 T-BOX-REC，每邊 ≥3 次）：由第一個像素變化到只剩光球嘅時間；冇重複格、冇倒退、冇白閃。
- 狀態：❓ / ✅(盒，上緣連計劃 400–467ms)。⚠️ 下／右 400／433ms 要分開有冇計劃再量。

**R-PN-06** 收合最後幾幀，內容唔可以伸出面板邊（≤1px）。
- 來源：美術監督（v83 發現 7–12px）。驗收（盒）：最後 9 格 1:1 量度 ≤1px。狀態：❓ / ✅(盒)。

**R-PN-07** 上緣同下緣面板同時開，可見外緣之間淨空 ≥12px（計埋角標同計劃視窗）。淨空要縮短面板先做到、又會跌穿高度下限時，改為重疊，唔可以再壓扁。
- 來源：美術監督 PR3、PR3b；SPEC §2.7。驗收（盒）：1:1 截圖量。狀態：❓ / ❓。

**R-PN-08** 冇閒置循環動畫；`prefers-reduced-motion` 只做淡入淡出。
- 來源：DESIGN-SPEC §4–5；SPEC §2.10。驗收（盒）：全部收合閒置 10s，`document.getAnimations()` 入面 infinite 嘅數量 = 0，錄影 AE=0。狀態：❓ / ❓。

---

## 3. 計劃視窗（R-PL）

**R-PL-01** 只有 bot 真係出咗計劃，先喺該 bot 面板**右邊**貼一個計劃視窗（右邊放唔落就貼左；兩邊都放唔落就鉗入畫面，成個計劃要留喺螢幕入面）；串流緊嘅氣泡唔算計劃；新計劃到就換成最新嗰份。
- 來源：Devon；SPEC §6.6–6.7。驗收（盒＋Windows）：冇計劃嘅 session 唔出；送 `/plan` → 出；第二份取代第一份。狀態：❓ / ❓。

**R-PL-02** 有「關閉計劃視窗」掣（✕，無障礙名稱「關閉計劃視窗」）；關咗之後對話入面「睇計劃」可以再開。撳 ✕ 同一回合就要喺命中區抽走計劃矩形，唔使收埋面板再打開。睇計劃清走 dismiss 並重新畫出計劃，唔使重開 app。
- 來源：Devon；SPEC §6.7。驗收（兩邊）：撳 ✕ 一下就關；撳「睇計劃」再開。狀態：❓ / ❌(盒，掣撳唔中)。

**R-PL-03** 計劃 header 固定寫「計劃」；計劃名放喺內文第一行。
- 來源：Devon／美術監督 PR3c 應改 #3。驗收（盒）：四邊截圖 header 都係「計劃」。狀態：❓ / ✅(盒，6904645 起)。

**R-PL-04** 計劃揭示曲線固定 280ms `cubic-bezier(.3,.6,.2,1)`，**唔准改**。盒測閘：第一幀 ≤45%，約 100ms ≤80%，約 200ms ≥90%，≥4 格有變化，冇停格。
- 來源：Devon 約束；美術監督 PR3c；SPEC §6.8。驗收（盒，冷開＋暖開各 ≥3 次）。狀態：❓ / ✅(盒，7/7/7 格，第一幀 7.6–27.4%)。

**R-PL-05** 計劃視窗內嘅「預覽」／「原文」／✕ 唔撳 Ctrl 時第一下就撳得中。
- 來源：Devon；SPEC §1.6、§6.8。驗收（兩邊）：每個掣各撳 3 次，畫面有對應變化。狀態：❓ / ❌(盒，點擊落到 BODY)。3437ddd ❌（計劃變空白）；d8fd9b0 ❓。

**R-PL-06** 計劃視窗開住期間**永遠唔可以變空白**；收合第一幀唔可以「彈返」出嚟。
- 來源：Devon；v85 發現（3437ddd 揭示完 2–3 幀變白紙）。驗收（盒）：開完之後 6s 內每幀都有計劃內容；收合第一幀變化 ≤ 正常一幀。狀態：❓ / ✅(盒)；3437ddd ❌。

**R-PL-07** 計劃開住時，計劃視窗旁邊嘅空位仍然穿透。
- 來源：R-CT-01 延伸；v85 發現闊咗嘅空白位食點擊。驗收（兩邊）：T-WIN-CLICK (e)。狀態：❓ / ❓。

**R-PL-08** 接縫：主面板同計劃之間只有一條 1px 線，冇粗 T 字、冇縫；計劃有 16px 格紋。
- 來源：美術監督 PR3b §2a、PR3c。驗收（盒）：1:1 截圖。狀態：❓ / ✅(盒)。

---

## 4. 光球外觀（R-OB）

**R-OB-01** 光球外觀要同 Devon 鍾意嗰版一樣：參考 build 係 **f8cb046**（Devon 2026-10-21 確認）。要改外觀，一定要美術監督**同** Devon 都批准。開合一次之後，閒置光球（包括看板同設定）要同未開過一樣，1px 藍邊要留低。
- 來源：Devon（2026-10-21「上一次的版本比較好看」；同日確認參考 build = f8cb046，C-02）；ORB-REVERT-SPEC。
- 驗收（盒 T-REF，淺色＋深色桌布）：每粒閒置光球 r0–48px 同 f8cb046 逐像素比較，r0–24 平均差 ≤2、r24–48 平均差 0；glyph 色一樣。Windows 手提目測並排截圖。
- 狀態：✅（參考）/ ⚠️(盒：bot 光球 ≈ 一樣，1px 邊緣淡少少藍；排程光球差 48 級 ❌)。3437ddd：全部平均差 ≤2 ✅。

**R-OB-02** 每粒光球用該 Hermes bot 自己嘅顏色：太陽式光暈，近白核心帶少少 bot 色；bot 色由 Hermes profile 讀（`profile.yaml` 嘅 `ui_meta.hermes-bots.color` 優先，dashboard／health 次之）。
- 來源：Devon；SPEC §6.1–6.5。
- 驗收（兩邊）：改一個 profile 嘅顏色後重新同步，光球跟住變；`hsl(326 68% 58%)` 變 `#dd4b9e`。
- 狀態：❓ / ✅(盒，glyph 色同 f8 一樣)。

**R-OB-03** 頭部光暈（`.morph-glow`）：光球收埋時 0；面板打開做標題球時 96px、alpha .12，延遲 320ms 再 160ms 淡入，收合 80ms 淡出；冇 transform transition。
- 來源：美術監督 ORB-REVERT §1。驗收（盒）：閒置截圖光暈位置差 0；打開錄影量時間。狀態：❓ / ❓（v80 起有截圖，未逐項量時間）。

**R-OB-04** 光球核心只得近白眩光，冇實色粗藍圈；思考圈係 1px `--bot-60` 弧，等候時唔轉，思考中先轉。
- 來源：美術監督 v20（DESIGN-REVIEW）；SPEC §10.5–10.6。驗收（盒）：1:1 截圖；思考完弧即刻消失。狀態：❓ / ❓。

**R-OB-05** 光球近距淡出。游標唔近、又冇揸 Ctrl 時，光球實色、完全睇到。游標進入該粒光球嘅命中圓再加 `ORB_PROXIMITY_PX`（72px，光暈／命中半徑加一個 60–80px 以內嘅邊）時，只有嗰粒（或同樣近嘅幾粒）用約 180ms 淡到靜止透明度（預設 18%，上限 30%）。游標離開就淡返實色。穿透唔變：預設穿透，只有揸住 Ctrl 而且游標喺 12px 命中邊內先可以撳（R-CT-*）。Ctrl 揸住而且游標喺 72px 淡出範圍內，嗰粒返實色；可以撳仍然只係 12px 命中邊。Ctrl+C／Ctrl+V 唔閃（R-CT-06）。面板唔變：預設實色可撳，Ctrl 揸住先透明同穿透。穿透視窗要靠全域游標輪詢（Windows `GetCursorPos`、Linux `XQueryPointer`，經 `device_query`），唔好靠 DOM mouse。淡出 150–200ms，`prefers-reduced-motion` 縮到 1ms。冇閒置循環動畫（R-PN-08）。
- 來源：Devon 2026-10-08 原規則；2026-10-22 恢復（整合 REQUIREMENTS.md 時漏咗）。見 C-16。取代 R-CT-02／R-CT-03 嘅「預設半透明」。
- 驗收（兩邊）：游標遠時光球實色；進入 72px 後 250ms 內透明度 ≤30%；離開返實色；Ctrl 揸住近光球時實色而且 12px 內可撳；Ctrl 放開，喺淡出範圍內撳仍然穿透；Ctrl+C／V 冇閃。
- 狀態：❓ / ❓。

---

## 5. 排程（cron）光球（R-CR）

**R-CR-01** 排程光球只做狀態顯示（只供查看，開關留喺 Hermes），喺右緣約 38% 高；右撳唔可以隱藏。
- 來源：Devon；SPEC §12.1、§12.6。驗收：面板寫「只供查看。開關留喺 Hermes。」；冇開關掣。狀態：❓ / ❓。

**R-CR-02** 閒置樣子同 f8cb046 **一模一樣**（同 R-OB-01 一樣量度）；下次運行時間只喺 Ctrl+hover 先出。
- 來源：Devon；ORB-REVERT §2。狀態：✅（參考）/ ❌(盒，差 48 級)。3437ddd ✅。

**R-CR-03** 狀態效果只喺有狀態嗰陣先出：
- 進行中：2px 進度環（`--p`）；運行中陰影 `0 0 10px 2px rgba(0,0,242,.25)`；
- 未知進度：90° 弧，2.4s 一圈，停咗即刻冇；
- 完成：一次 400ms ripple；
- 失敗：靜止 `#e5484d` 環，**全強度**（唔乘閒置透明度），核心同閒置一樣；下一次運行開始或成功就收。
- 來源：美術監督 ORB-REVERT §2、v83；Devon。
- 驗收（盒，用真 Hermes 臨時 cron job，淺色＋深色桌布）：五個狀態各一張 1:1；失敗環對背景對比 ≥1.9:1（v84 水平），完成 ripple 第一幀同閒置明顯唔同。
- 狀態：❓ / ✅(盒，五個狀態都出；但閒置本身唔啱)。3437ddd：失敗環太淡（1.18:1）❌、ripple 睇唔到 ❌。d8fd9b0 聲稱修好，❓。

**R-CR-04** 排程面板：按 bot 分組，每個顯示中嘅 profile 都列出（冇工作就寫「未有排程」）；資料來自 `GET {root}/api/jobs?include_disabled=true`，404 先試 `/api/crons`；唔虛構工作；時間 24 小時 `HH:MM`。
- 來源：SPEC §12.4–12.7；REPORT-v24。驗收（盒，真 Hermes）：同 `hermes` CLI 列出嘅工作對得上。狀態：❓ / ❓。

---

## 6. 看板（R-KB）

**R-KB-01** 看板有自己一粒光球（上緣正中，菱形），開出即時看板；欄序 triage、todo、ready、running、blocked、done，唔顯示 archived；拖卡改狀態寫返 Hermes。
- 來源：Devon；SPEC §8。驗收（盒）：拖卡後 `hermes kanban list` 顯示新狀態。狀態：❓ / ❓。

**R-KB-02** 看板有變（新增、改狀態）而且面板未開，光球展開膠囊通知約 5 秒（「新增：標題」／「標題 → 狀態」／「看板有更新」）；第一次快照唔通知；面板開住唔通知。
- 來源：Devon；SPEC §8.4。驗收（盒）：用 CLI 加一張卡，5–10s 內出膠囊。狀態：❓ / ❓。

**R-KB-03** 未裝 overlay-slash kanban 時顯示「未裝 overlay-slash kanban，看板唔會出現。」，唔可以出假任務。
- 來源：SPEC §8.2。狀態：❓ / ❓。

**R-KB-04** gateway 對看板路徑回 404（overlay-slash kanban route 唔喺呢部 Hermes）時，顯示「呢部 Hermes 未有看板。伺服器冇提供看板功能（404）。」，字色 `#14142b`，靜態、冇動畫。呢個係功能未提供，唔當逾時，唔進入 R-SY-08 嘅無限重試。
- 來源：Devon（2026-10-22 手提：看板 endpoint 404）。驗收（單元＋盒）：404 回應之後看板停留喺上面嗰句，`gatewayDown` 係 false；真正連唔到或者逾時仍然行 R-SY-08。
- 狀態：❓ / ❓。

---

## 7. Session（R-SS）

> 2026-10-21 Devon 裁決（C-01）：本節取代 repo `SPEC.md` §5.2、§5.5、§5.7，同埋同本節撞嘅 §5.4、§5.6。
> 2026-10-21 曾經寫「啟動唔跟已儲存 session id，一律開標題 Bot Chat」。**已取代**（Devon 2026-10-22 手提，11a150e）：config 或者 explicit 已經有嘅 session 要保留，見下面 R-SS-01／02／04。

**R-SS-01** 每個 bot 嘅**主光球面板**開 config 已經記住嘅 session。嗰條 id 喺伺服器存在就用佢，隱藏同 archived 都算存在，啟動、打開面板、同 gateway 重連（R-SY-08）都**唔改** config 嘅 session id、explicit 旗、anchor。explicit 旗唔可以自動清走。config 未有 session id，先至可以寫入一次。

已儲存嘅 id 係空、已經唔喺清單、或者條列係空而且有更好的 Bot Chat（而且唔係 explicit），先至跟 Hermes Desktop 嘅次序揀真正嘅 Bot Chat：
- (a) API 有露出 Desktop delivery lease 或者 `canonical_session` 就用嗰條；空 lease 唔可以壓過有訊息嘅 Bot Chat。
- (b) 否則用真正有訊息嘅 Bot Chat：訊息最多，打和就最近活動。
- (c) 有非空候選時，永遠唔開 0 訊息重複。
- (d) 全部都空，用最舊嗰條；`api_` 開出來嘅重複唔可以壓過 Desktop 或者 `tui`。

`POST /api/sessions/{id}/chat` 寫入 `tui` 會 `permission_denied`，所以 `tui` 照打開、顯示只讀，並講明 API 唔接受寫入。啟動同打開都**唔新建** session。2026-10-21「忽略已儲存 id、淨係跟標題 `Bot Chat`、有歷史就取最舊」**已取代**。

- 來源：Devon（2026-10-22 手提，11a150e 開錯 session 同改寫 config；0 次建立）。Desktop 點揀（查 NousResearch/hermes-agent PR #92129）：`profiles.list` 嘅 `canonical_session` 按**名字**登記 Bot Chat，session id 釘已拿掉；`session.list` 用精確標題 `Bot Chat` 加 `include_hidden`。隱藏列會解析；tool／kanban source 同 archived 唔算入標題登記；壓縮譜系用 `get_compression_tip` 去到 live tip，唔係見個 child 就跟。現行 Hermes REST `GET /api/sessions` 嘅 `_session_response` **冇** lease 欄。Overlay 仍然讀 envelope 嘅 `canonical_session`、`canonical_session_id`、`delivery_session`、`delivery_session_id`、`home_channel_session`、`home_channel`、`lease_session`、`delivery_lease`，同列上嘅 `canonical`／`is_canonical`／`delivery`／`home_channel`／`is_home_channel`。重複開 session 可以把真正對話嘅標題改走，所以 config 記住嘅 id 就算標題唔係 `Bot Chat` 都保留（ff-daily `20261013_180130_88f994`，標題「判斷截圖顯示嘅問題」，373 訊息）。
- 驗收（兩邊）：ff-daily 開 `20261013_180130_88f994`（config）。mt-orch 開 explicit `20261015_011713_2242f9`，旗保留。forex-forest 留 `20261001_013827_25b1eb`（tui，2312 訊息，只讀）。mt-coder、mt-reviewer、mt-tester：清單入面有非空 Bot Chat 就開嗰條；而家手提錄到嘅列係空的 `api_1792573589_f1c99a3b`、`api_1792573589_b1b8ccc5`、`api_1792573589_257658b2`（e3db750 的「Bot Chat」重複），冇第二條就停喺嗰條，唔再因為標題跳去空重複而改 config。gateway 返嚟之後 session 欄同重連之前一樣。只有 `tui` 時輸入同傳送停用。單元測試用呢組形狀。
- 狀態：❓ / ❌(Win，11a150e：0 次建立，但開錯 session 同改寫 config)。單元測試已鎖新規則；手提未再驗。

**R-SS-02** 自動路徑**唔改**已記住嘅 session：啟動、打開面板、cron 更新 `last_active`、有新 session、gateway 重連，都唔改 session id、explicit 旗、anchor。explicit 唔會被清走。只有 config 未有 id 先寫入一次。手動 picker（R-SS-04）先可以改 id 同寫上 explicit。2026-10-21「主光球永遠唔可以離開標題 Bot Chat」**已取代**：已記住而且仍然存在嘅 session 就停喺度；空而且唔係 explicit 的儲存列，畫面可以跟有訊息嘅 Bot Chat，但唔寫返 config。
- 來源：Devon（2026-10-22）。11a150e 喺 gateway 返嚟時改咗 ff-daily、mt-coder、mt-tester、mt-orch 嘅 session id，清走 mt-orch 嘅 explicit，又改咗 anchor。
- 驗收（**Windows 必做**＋盒）：Devon 手提上，ff-daily、mt-orch、forex-forest 啟動後、等 60s、逐個開關面板、gateway 重連、再重啟一次，session id、explicit、anchor 同開波之前一樣。盒：單元測試 `stored_pin_after_resolve` 喺已有 id 時返回唔寫。
- 狀態：❓ / ❌(Win，11a150e 改寫 config)。盒未再驗。

**R-SS-03** 啟動時同打開面板時**唔可以新建任何 session**（零次 `POST /api/sessions`）。
- 來源：Devon（2026-10-21）；6904645 段。
- 驗收（兩邊）：開 debug log 或者喺 gateway 記錄請求，啟動＋打開全部面板，`POST /api/sessions` = 0 次；前後 `GET /api/sessions` 數目一樣。
- 狀態：❓ / ✅(盒)；Win ❓。11a150e 手提亦係 0 次建立。

**R-SS-04** 面板內嘅 session picker 保留，可以手動揀任何 session（Bot Chat 釘頂）；轉 session 即刻重畫（≤1 幀；要等 fetch 時 ≤333ms）。手動揀先寫 explicit。下一次打開主光球面板停喺呢個 explicit／已記住嘅 session。2026-10-21「關咗再開返標題 Bot Chat」**已取代**。
- 來源：Devon；SPEC §5.3；2026-10-22 手提（mt-orch 的 explicit `20261015_011713_2242f9` 要留低）。驗收（兩邊）：揀另一條 → 即刻顯示，config 寫上 explicit；關咗再開 → 同一條，旗仲喺。
- 狀態：❓ / ⚠️(盒：重畫 67ms／333ms ✅；「再開留喺 explicit」未驗)。

**R-SS-05** 面板開住 Bot Chat 時，新訊息（包括 cron 輸出）即時加入對話；光球收埋時出預覽膠囊（24 小時 `HH:MM`，約 5s）。
- 來源：SPEC §5.8、§7。狀態：❓ / ❓。

**R-SS-06** 就算 Hermes Desktop 冇開，都要收到 Hermes 主動發出嘅訊息。**（未解決）**
- 來源：Devon。驗收（Windows）：閂 Hermes Desktop，觸發一個會主動發訊息嘅 cron，overlay 喺 ≤10s 內出膠囊。狀態：❓ / ❓。

**R-SS-07** Bot Chat 以外嘅 session，每條用一粒 sub-orb 代表（將來做，見 R-SO）；主光球唔會用嚟顯示呢啲 session。
- 來源：Devon（2026-10-21）。狀態：— / —（PR #3 唔包）。

---

## 8. Profile、設定同 bot 面板（R-PF）

**R-PF-01** 自動發現 Hermes 有提供嘅 profile；新 profile 預設顯示；唔自動產生 API key。
- 來源：Devon；SPEC §4.1–4.3。驗收（盒）：加一個 profile 後重連，出新光球同「未有 API 金鑰」提示。狀態：❓ / ❓。

**R-PF-02** 設定揀邊啲 profile 顯示成光球；Ctrl+右撳光球 →「隱藏呢個 Bot」；喺設定剔返就再出；隱藏唔刪 key。
- 來源：Devon；SPEC §1.4–1.5、§4.4–4.6。驗收（兩邊）。狀態：❓ / ❓。

**R-PF-03** Hermes 連線設定（gateway、dashboard、名單、API key、修飾鍵、置頂、結束）只喺獨立嘅設定光球；bot 面板只改該 bot 嘅顯示名、詳情、`SOUL.md` 同 per-bot 設定，冇 gateway／key 欄。
- 來源：Devon；SPEC §3.1–3.4。驗收：改 `SOUL.md` 後喺磁碟路徑（`$HERMES_HOME` 或 `~/.hermes`，其他 profile `profiles/<id>/SOUL.md`）見到。狀態：❓ / ❓。

**R-PF-04** Bot 面板主畫面：標題、session picker、可捲動訊息列表、釘底輸入列；列表跟住最新訊息，用戶上捲就停。
- 來源：SPEC §3.3。狀態：❓ / ❓。

**R-PF-05** 再次發現唔可以覆蓋用戶改過嘅名、詳情、位址、session。
- 來源：SPEC §4.7。驗收：重新發現前後比較 config，用戶改過嘅欄位唔變。狀態：❓ / ❓。

---

## 9. 訊息、Markdown、斜線指令（R-MD）

**R-MD-01** 助手訊息（包括串流中）渲染 Markdown：標題、粗斜體、清單、code、引用、表格、分隔線；未閉合 code fence 仍然係 code block；用戶自己打嘅字維持純文字。
- 來源：Devon；SPEC §9.1–9.2。驗收（盒）：送一段含晒以上元素嘅回覆，串流中截圖同完成後截圖都啱。狀態：❓ / ❓。

**R-MD-02** 連結用系統瀏覽器開，overlay 唔跳頁；HTML、事件屬性、`javascript:` 連結被清走。
- 來源：Devon；SPEC §9.3–9.4。驗收（Windows）：撳連結 → 預設瀏覽器開，overlay 內容唔變。狀態：❓ / ❓。

**R-MD-03** 打 `/` 彈出 overlay-slash 指令選單；↑↓ 揀，Tab 補全；`/new`、`/title`、`/branch`、`/model`、`/stop` 由 overlay 處理；回覆中都送到 `/stop`。
- 來源：Devon；SPEC §9.5–9.7。狀態：❓ / ❓。

**R-MD-04** code block 黑底白字加「複製」掣；空 code block 冇複製掣。
- 來源：美術監督 v20、PR3c；SPEC §10.4。狀態：❓ / ✅(盒)。

**R-MD-05** 新訊息係由光球變出嚟嘅預覽膠囊（唔係獨立 toast），24 小時 `HH:MM`，5s；平時睇得見但穿透，Ctrl+撳先展開成面板。
- 來源：SPEC §1.8、§7.1–7.3。狀態：❓ / ❓。

---

## 10. 視覺同對比（R-VS）

**R-VS-01** bot 色只可以用喺光球核心、光暈、頭像圈同 2px 色條。文字、user 氣泡邊、實色掣用 `#0000f2` 或 `#14142b`；淺色 bot 色底上面嘅字用 `#14142b`。所有文字對底對比 ≥4.5:1。光球 glyph 用 bot 色（唔受對比規則限制）。
- 來源：美術監督 PR3c 必改 #1；Devon。
- 驗收（盒，用黃 `#f2f200`／`#edff45` 同青 bot）：量標題、user 氣泡字、「對話」「傳送」掣對比 ≥4.5。
- 狀態：❓ / ✅(盒，8.69／13.46／9.2)。

**R-VS-02** 面板玻璃不透明度 ≥.85（`.88`，WebKitGTK `.92`）；1px `#0000f2` hairline；四角 HUD 角標 8px、1px `rgba(0,0,242,.4)`、喺框外 3px；圓角 ≤3px；中文唔 uppercase、唔加字距；冇 spring。
- 來源：美術監督 v20、PR3、PR3b；SPEC §10。驗收（盒）：1:1 截圖同 computed style。狀態：❓ / ❓。

---

## 11. 系統、安全、部署（R-SY）

**R-SY-01** API key 同 token 永遠唔寫入 log、唔印出嚟、唔放 `config.json`（只放系統 keyring）。
- 來源：Devon；SPEC §3.6。驗收：開 debug log 跑一輪，`rg` log 同 config 搵唔到任何 key 片段。狀態：❓ / ❓。

**R-SY-02** debug log 預設關，要設 `HERMES_OVERLAY_DEBUG_LOG` 先寫。
- 來源：Devon。驗收：冇設 env 跑一輪，冇 log 檔產生。狀態：❓ / ✅（PR 內文）。

**R-SY-03** 硬件加速維持預設，唔准改。
- 來源：Devon。驗收：diff 冇改 WebView2／WebKit 加速設定。狀態：✅ / ✅。

**R-SY-04** keyring 讀取唔阻 UI；約 3s 冇回應就顯示錯誤，光球照畫，程式照結束到。
- 來源：SPEC §3.6。狀態：❓ / ❓。

**R-SY-05** 未經 Devon 明確要求，唔建 git tag、唔建 GitHub Release；PR #3 保持 draft；Windows 用 CI artifact `windows-x64-nsis`（未簽名）。
- 來源：Devon；SPEC §11.2–11.3；AGENTS.md。狀態：✅ / ✅。

**R-SY-06** overlay 喺 LAPTOP-DEVON 跑，連遠端 Hermes API（唔假設係 127.0.0.1）。
- 來源：SPEC §11.1。狀態：✅ / ✅。

**R-SY-07** 測試次序：先盒測，全部過咗先交美術監督；**裝手提之前一定要先話俾 Devon 知**。手提上唔閂 Hermes Desktop、唔人手改視窗樣式。
- 來源：Devon。狀態：流程要求（每次記錄）。

**R-SY-08** Hermes gateway 連唔到或者逾時，看板、排程、Bot 名單／profile、同每個 Bot 嘅對話都要自己接返，唔使重開程式、亦唔使人手撳。退避大約 5 秒、10 秒、20 秒，之後封頂 60 秒，每次上下 20%。網路恢復、系統由睡眠醒返、或者打開受影響嘅面板，即刻再試。重試期間看板／光球顯示平靜狀態「連唔到 Hermes，自動重試中…」加下次再試時間，唔顯示原始錯誤；字色 `#14142b`，對比 ≥4.5:1（R-VS-01）。唔可以有閒置循環動畫（R-PN-08）：唔轉圈，靜態狀態加倒數文字就得。恢復之後每個消費者刷新一次並清走錯誤。重試同重連永遠唔建立 session、亦唔離開 Bot Chat（0 次建立，R-SS-01…04）。每個 profile 同時最多一個進行中嘅探測。
- 來源：Devon（2026-10-22）。
- 驗收：停掉假 gateway，面板出重試狀態；再開 gateway，喺退避窗口加 1 秒內看板同 Bot 自己出現；全程 0 次建立 session。CI／單元測試覆蓋假 gateway 由落到起。
- 狀態：❓ / ❓。

---

## 12. 將來／唔包喺 PR #3（R-SO）

PR #3 過咗先開新 branch，跟 `SUBORB-SPEC.md` v1（美術監督）。

**R-SO-01** Bot Chat 以外嘅 session 每條一粒 sub-orb（Devon 2026-10-21）。每個 Task session 自動出一粒臨時 sub-orb（虛線圈）；Devon 釘選咗先一直留住（實線圈）；未釘選嘅喺完成兼睇完之後 3s 收起。
**R-SO-02** 沿主球所在嗰條邊排成一行；直徑 = 主球 0.45 倍（最細 14px）；最多 5 粒，第 6 個位係「+N」；按釘選／建立時間排，唔因狀態跳位。
**R-SO-03** 兩條狀態通道：活動（閒置 .45、思考中 1.2s 弧）同角標（失敗 > Plan > 未讀，一次只出一個）。
**R-SO-04** sub-orb 用同一套 morph、同一條 Ctrl 規則；session 面板 header 用 breadcrumb `BOTNAME / session 標題` 加實心釘。
**R-SO-05** 閒置冇持續動畫；只動 transform、opacity、clip-path。
- 驗收：開新 branch 時逐條寫細（盒錄影＋Windows 真點擊），而且**本檔全部 PR #3 項目照樣要過**。
- 狀態：— / —。

---

## 13. 回歸規則（Regression rules）

1. **每一個 build**，交美術監督審**之前**、裝 Devon 手提**之前**，都要將本檔 §1–§11 每一項重新驗一次，寫低結果（✅／❌／❓同原因）。有任何 ❌ 就唔交審、唔裝。❓ 要寫明點解驗唔到。
2. 盒驗唔到嘅 Windows 項目（R-CT-01/02/06/07、R-SS-02、R-MD-02 等），**唔可以因為盒過咗就當過**。先話俾 Devon 知，再裝手提做真點擊測試，Windows 過咗先算。
3. 光球外觀（R-OB-01、R-CR-02）每次都要同 f8cb046 並排量度，唔可以淨係睇 r24–48 或淨係目測。
4. 發俾寫 code 嗰邊（cloud agent）嘅修改單，一定要：
   - 寫明「跟 `REQUIREMENTS.md`」；
   - 列出今次要修嘅項目 ID；
   - 列出今次重新驗過嘅項目 ID 同結果；
   - 要求回覆時講明邊啲項目可能受影響、點樣自己驗過；唔准改任何「唔准改」嘅項目（R-PL-04 曲線、R-SY-03 硬件加速、R-SY-05 tag/release）。
5. 新要求或者 Devon／美術監督改咗決定：先改本檔（加 ID、來源、日期），再發修改單。舊項目唔刪，標「已取代」同寫邊項取代。
6. 唔可以聲稱美術監督批准咗佢冇批准嘅嘢；批准要寫低版本同日期。

---

## 14. 衝突同未清楚（要 Devon／美術監督裁決）

- **C-01 Session 規則（✅ 已解決，Devon 2026-10-21；2026-10-22 收窄）**：啟動同打開都唔新建 session；picker 保留；其他 session 做 sub-orb。見 R-SS-01–04、R-SS-07。**本檔取代 repo `SPEC.md` §5.2（冇 Bot Chat 就 POST 新建）、§5.5（非明確揀嘅 id 改跟最新 Bot Chat）、§5.7（送出時 404 就新建）**；§5.4、§5.6「明確選擇記住」同 R-SS-04 撞嘅部分亦以本檔為準。2026-10-21「一律忽略已儲存 id、淨係開標題 Bot Chat」**已取代**（Devon 2026-10-22 手提）：config 或者 explicit 已經有嘅 session 要保留，見 R-SS-01／02／04。原本推斷 §5.5 係 b919b7f 改咗 4 個 bot 嘅原因，未證實。仲有兩點未講（見 C-15）。
- **C-02 光球參考版本（✅ 已解決，Devon 2026-10-21）**：參考 build 係 **f8cb046**。R-OB-01、R-CR-02 都同 f8cb046 並排量度。
- **C-03 排程失敗狀態「.55 核心」**：交帶嘅 Devon 要求寫「failed idle .55 core」，但 Devon 同時要求閒置同 f8cb046 一模一樣（f8cb046 排程光球閒置係 .18，v84 就係因為 .55 地板唔夾）。現行 SPEC §12.2／d8fd9b0：核心跟閒置（.18），只有紅環係實色。本檔跟後者，要確認。
- **C-04 repo SPEC 自己撞**：§2.8 仲有舊嘅「計劃 240ms `cubic-bezier(.2,.8,.2,1)` scaleX」，§6.8 係 280ms `(.3,.6,.2,1)`；§12.1 寫排程 glyph `#616191` 字重 600，§12.2 寫 glyph `var(--bot)`、冇 `#616191` override。要清走舊條文。
- **C-05 文字墨色**：SPEC §10.2 寫介面墨色 `#000091`、正文 `#1a1a1a`；美術監督 PR3c 寫文字一律 `#0000f2` 或 `#14142b`。要定 `#000091`／`#1a1a1a` 仲用唔用。
- **C-06 收合時間**：PR 內文舊講法「≤360ms」，SPEC §2.9 逐邊釘死（右 300、左 316、下 266、上 300ms，可見 300–333ms），美術監督 PR3c 有計劃 ≤500ms，仲有後備 (b) 382ms。本檔已全部列入 R-PN-05，但後備 (b) 幾時用要美術監督定。
- **C-07 README 過時**：README「游標同穿透」仲寫「預設成個 overlay（包括面板）穿透、游標行近就淡出」，同 Devon 嘅 Ctrl 規則（面板預設實色可撳）相反；外觀段仲寫螢光黃 `#edff45`、面板 76%。建議 README 跟本檔更新（要 Devon 批准先改 repo）。
- **C-08 隱藏啟動**：SPEC §1.12 要求 `visible: false` 隱藏啟動，但 CLICKTHROUGH-DIAG 指出 Windows 穿透壞咗嘅改動正正包括隱藏啟動、`set_decorations(false)`、`show()`＋`set_focus()`、16ms 重寫 exstyle 同 tao 打交（只寫 `WS_EX_TRANSPARENT`，冇 `WS_EX_LAYERED`、冇 `SWP_FRAMECHANGED`）。如果修穿透要改返啟動方式，SPEC §1.12 要跟住改；R-CT-01 優先。
- **C-09 關閉掣例外**：PR 內文舊版話 Ctrl 揸住時關閉掣 36px 內仍然撳得；現行 SPEC §1.7 同 Devon 規則係 Ctrl 揸住時關閉掣都穿透。本檔跟現行。
- **C-10 計劃視窗位置**：Devon 講「貼右邊」；SPEC 加咗「右邊放唔落就貼左」。本檔保留後備，要確認。
- **C-11 HUD 角標顏色**：PR 內文寫「實色藍」，SPEC／美術監督 PR3b 寫 `rgba(0,0,242,.4)`。本檔跟美術監督。
- **C-12 Ctrl 0ms 競賽**：Ctrl 撳落同一刻（0ms）撳光球間中唔中，一直當「已知盒測時序」。Devon 冇講可以接受；要定係咪當唔過。
- **C-13 R-SS-06 主動訊息**：未定點做（Hermes 推送定 overlay 輪詢），亦未有驗收時限，本檔暫定 ≤10s。
- **C-14 本檔同 repo SPEC.md 嘅關係（已定）**：repo 一直有 `SPEC.md`（自稱 Devon 需求嘅單一依據）同 `AGENTS.md`（要求改動前逐條核對），所以唔係「冇 MD」。問題係：SPEC.md 有條文同 Devon 嘅規則撞（例如 C-01 嘅 §5.2／5.5／5.7），而且以前發俾 cloud agent 嘅修改單冇要求逐條重驗。**而家兩份撞就以本檔為準**；SPEC.md 只做實作細節參考。
- **C-15 Session 規則未講清嘅位**：(a) 冇符合條件嘅 Bot Chat（又唔准新建）時，主光球面板應該顯示乜（建議：空狀態「未有 Bot Chat」，唔自動揀其他 session）？(b) 喺 picker 手動揀咗另一條，然後 Bot Chat 有新訊息（例如 cron），面板應唔應該轉返 Bot Chat？本檔暫時當唔轉，只出預覽膠囊（SPEC §5.8）。(c) SUBORB-SPEC 原本只係 Task session 自動出 sub-orb、最多顯示 5 粒加「+N」；Devon 新講法係「其他 session 每條一粒」，要同美術監督對清楚，係咪全部 session 都出。
- **C-16 光球預設透明度（✅ 已解決，Devon 2026-10-22）**：Devon 2026-10-08 嘅規則係游標行近光球先淡出，平時實色。整合本檔時誤寫成「光球預設半透明」（R-CT-02、R-CT-03，同 SPEC §1.1–1.3、README「游標同穿透」嗰兩句）。而家以 R-OB-05 為準：平時實色，72px 內先淡，Ctrl 揸住近光球返實色，穿透範圍仍然係 12px。面板規則唔變。README 呢兩句同一日改，唔再等另外批准。f8cb046 閒置 .18 係游標行近嘅地板，唔再係平時樣。
