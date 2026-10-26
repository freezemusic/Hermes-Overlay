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

## 工具批准（R-AP）

Devon 每個工具都人手批。Overlay **唔可以**開啟 `approvals.unattended_mode: approve`，畫面、設定、註解都唔好建議開啟。

**R-AP-01** `POST /p/{profile}/api/sessions/{id}/chat/stream` 嘅 SSE 如果出 `approval.request`，面板入面即刻出一張卡。卡有小標題「要你批准」，並顯示 `description` 同 gateway 已經遮罩嘅 `command`。只有兩個掣：「批准（一次）」（body `choice` = `once`，主掣，實色藍）同「拒絕」（`deny`，次掣）。等緊批准時狀態係「等緊批准」，唔係「思考中…」；批完如果嗰輪仲忙，先返「思考中…」。撳一次之後兩個掣停用。`approval.responded` 或者 POST 成功之後顯示「已批准」或「已拒絕」。HTTP 409 顯示「呢個批准已經過時」。唔自動重試，唔自動批准，唔送 `session`、`always`、`all` 或 `resolve_all`。
- 來源：Devon（2026-10-26，Hermes gateway 0.22.5）。`approval.request` 喺 `gateway/platforms/api_server.py`；回覆係 `POST /p/{profile}/v1/runs/{run_id}/approval`，body `{"choice","request_id"}`，用同一個 profile prefix 同 api_server Bearer。`run_id` 亦出現喺同一條串流嘅 `run.started`。
- 驗收（盒）：模擬 `approval.request` 出卡；POST 路徑包含 profile prefix、`run_id`，body 有對應 `request_id` 同 `once` 或 `deny`。409 只顯示「呢個批准已經過時」，而且只 POST 一次。
- 狀態：❓ / ✅(盒，單元測試)；Win 未再驗。

**R-AP-02** 面板規則不變：預設實色、可以撳（R-CT-04）；Ctrl 揸住就穿透（R-CT-05）。面板收埋時如果有批准等緊，嗰粒 bot 光球出一個小標記。標記喺 44px 光球裡面，`pointer-events: none`，唔擴大命中區，光球預設仍然穿透（R-CT-02）。
- 來源：Devon（2026-10-26）。
- 驗收（盒）：面板未開時 `has-approval` 先出現；打開面板之後標記收起；命中區仍然係光球本身。
- 狀態：❓ / ✅(盒，單元測試)；Win 未再驗。

**R-AP-03** `execute_code` 喺 api_server session 唔會出 `approval.request`（gateway 早已拒絕）。串流或工具結果如果係 BLOCKED `execute_code`，顯示「呢個 bot 想行 Python（execute_code），經 Overlay 唔允許，叫佢改用 terminal 指令」，唔顯示原始錯誤。同一句只出一次：工具氣泡同 bot 氣泡唔好各出一次。
- 來源：Devon（2026-10-26，gateway 0.22.5）。
- 驗收（盒）：含 `execute_code` 同 `BLOCKED` 嘅工具結果只剩嗰句。
- 狀態：❓ / ✅(盒，單元測試)；Win 未再驗。

**R-AP-04** 非 debug log 唔記錄 Bearer，亦唔記錄 command 原文。debug log 維持 opt-in（要 `HERMES_OVERLAY_DEBUG_LOG`）。批准路徑唔寫 config.json。
- 來源：Devon（2026-10-26）；R-SS-02。
- 驗收（盒）：`submit_approval`／`respond_approval` 冇 `println`、`eprintln`、`config::save`，錯誤 body 唔留低。
- 狀態：❓ / ✅(盒，單元測試)；Win 未再驗。

**R-AP-05** 面板收埋期間如果已經有一張未批嘅卡，再開面板要把卡捲到睇到（貼底）。唔好恢復收埋前嘅 scroll，令張卡留喺輸入框下面。
- 來源：Devon 盒測（2026-10-26，AP-a）。卡大約低 94px，撳「批准」嘅位置打中輸入框。
- 驗收（盒）：收埋時有 pending approval，再開之後張卡喺對話底、輸入框上面。之後用戶自己捲上唔好被拉返底。
- 狀態：❓ / ❓。

---

## 停止同忙碌發送（R-ST）

**R-ST-01** 「停止」打 `POST /p/{profile}/v1/runs/{run_id}/stop`，冇 body（Hermes 0.22.5 `api_server.py:89`，handler `api_server_runs.py:1453`）。`run_id` 係 `run.started` 嘅 admission request id。呢下唔切斷 SSE：繼續聽直到串流 `run.cancelled` 或者結束。串流確認取消，或者 HTTP 409 `run_not_active`，先顯示「已停止」。其他失敗只顯示「停止未送到。」，唔顯示原始錯誤，唔記錄金鑰或者 body。
- 來源：Devon（2026-10-26，Hermes gateway 0.22.5）。真用：mt-orch 撳停止之後本地只係唔再聽，gateway 嗰輪仲行。
- 驗收（盒）：mock gateway 見到一次 `POST /p/mt-coder/v1/runs/run_abc/stop`、冇 body；409 當未在行；使用者停止唔會設 reader abort。
- 狀態：❓ / ✅(盒，單元測試)；Win 未再驗。

**R-ST-02** 忙碌時送出嘅字，先 `POST /p/{profile}/v1/runs/{run_id}/steer`，body 只有 `{"input":"..."}`（`api_server.py:87`，handler `api_server_runs.py:1398`；`message`／`text` gateway 都收，overlay 只送 `input`）。成功就喺對話顯示「已加入呢一輪」，唔開第二條串流。409（`run_not_accepting_steer` 或 `steer_not_accepted`）就改送平常 `POST /api/sessions/{id}/chat/stream`。Gateway 會排隊，唔會打斷手上嗰輪（`busy_input_mode: interrupt` 只適用 Telegram／Discord）。對話顯示「排隊中，等佢講完就會行」。`sendActive` 唔可以靜默返回。Chat HTTP 409 顯示「個 bot 仲忙，呢句未送出。」。
- 來源：Devon（2026-10-26）。真用：訊息排咗 admission seq 8，約一分鐘後先答，畫面冇排隊狀態。
- 驗收（盒）：steer 路徑同 body 只有 `input`；409 變排隊句；忙碌發送唔再係直接 `return`。
- 狀態：❓ / ✅(盒，單元測試)；Win 未再驗。

**R-ST-04** Bot 回覆進行中，可以轉去同一個 Bot 嘅另一個 session，亦可以打開另一個 Bot。手上嗰輪繼續喺伺服器行，唔好切斷 SSE，唔好打 `/stop`。原 session 嘅回覆繼續收，返去先顯示。光球保持忙碌。唔好出「停咗先至轉對話」呢類冇下一步嘅提示。真正停止之後，忙碌清除，轉對話即刻可以。
- 來源：Devon（2026-10-26，筆電 build 6e1f09d）。面板轉 session 時被「呢個 Bot 仲喺度回覆，停咗先至轉對話。」擋住。
- 驗收（盒）：mock gateway 喺串流未完時讀到另一個 session 嘅訊息，串流仍然交到回覆，而且冇 `/stop`。轉走之後直播字寫入原 session，而家個畫面唔變；返去見到嗰句。光球喺忙碌時仍然係思考狀態。
- 狀態：❓ / ❓。

**R-ST-03** 本地停止或者面板再開之後，要再讀呢個 session 嘅訊息，把未顯示嘅回覆補上。排隊嗰輪嘅回覆唔可以因為當時冇聽住就唔見。呢條唔寫 config.json。
- 來源：Devon（2026-10-26）。本地停止令 overlay 唔再聽，seq 8 嘅回覆後來先寫入 session。
- 驗收（盒）：已載入嘅面板再開會補讀；`watchReply` 喺忙碌時仍會合併未見訊息；補讀唔把忙碌中嘅狀態強制改做閒置，除非補到一條完成嘅回覆而且冇直播氣泡。
- 狀態：❓ / ✅(盒，單元測試)；Win 未再驗。

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

**R-CT-03** 揸住 Ctrl 嗰陣，只有游標下面（或 12px 內）嗰粒光球可以撳。名稱標籤只喺 Ctrl+hover 先出，放手即消失。開咗「永遠顯示員工名」之後，名稱跟 R-OB-06，唔再等 Ctrl 先出。「其他光球維持半透明、放手即刻返半透明」已取代，見 R-OB-05：游標唔近就實色；行近先淡；Ctrl 揸住而且游標喺淡出範圍內嗰粒返實色。
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

**R-PL-01** 只有 bot 真係出咗計劃，先喺該 bot 面板**右邊**貼一個計劃視窗（右邊放唔落就貼左；兩邊都放唔落就鉗入畫面，成個計劃要留喺螢幕入面）；串流緊嘅氣泡唔算計劃；新計劃到就換成最新嗰份。`.hermes/plans/*.md` 同 `.hermes\plans\*.md` 都算路徑；`.hermes` 前面嘅反斜線被吃掉（`Workbench.hermes\plans\`）仍然算。冇 `#` 標題、但成篇至少 200 字而且有呢條路徑，都當計劃。標題跟 `#` 標題；冇標題就用檔名，去掉日期前綴同 `.md`（`2026-10-26_210008-mt5-wrapper-next.md` → `mt5-wrapper-next`），再冇就「計劃」。一行短句只提到路徑唔算。對話氣泡同計劃預覽要原樣顯示 Windows 路徑嘅反斜線。R-PL-04 曲線唔改。
- 來源：Devon；SPEC §6.6–6.7。2026-10-26 手提：mt-orch 把整份計劃貼成普通回覆，路徑係 `C:\Users\freez\Desktop\MetaTrader Workbench\.hermes\plans\2026-10-26_210008-mt5-wrapper-next.md`，畫面未開計劃窗。驗收（盒＋Windows）：冇計劃嘅 session 唔出；送 `/plan` → 出；第二份取代第一份。上面嗰條 Windows 路徑（連吃掉 `\.` 嗰種）喺長文入面會開計劃窗，短句提到路徑唔會。狀態：❓ / ❓。

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

**R-OB-01** 光球外觀要同 Devon 鍾意嗰版一樣：參考 build 係 **f8cb046**（Devon 2026-10-21 確認）。要改外觀，一定要美術監督**同** Devon 都批准。開合一次之後，閒置光球（包括看板同設定）要同未開過一樣。v104（美術監督同 Devon）：閒置圓形光球冇邊、冇圈、冇 `box-shadow` 環；顏色只來自 34px 光暈。狀態環（排程進度、運行、失敗、完成）先可以畫圈。看板菱形保留 1px `#616191` 邊。
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

**R-OB-05** 光球近距淡出。游標唔近、又冇揸 Ctrl 時，光球實色、完全睇到。游標進入該粒光球嘅命中圓再加 `ORB_PROXIMITY_PX`（72px，光暈／命中半徑加一個 60–80px 以內嘅邊）時，只有嗰粒（或同樣近嘅幾粒）用 160ms `cubic-bezier(.2,.8,.2,1)` 淡到靜止透明度（預設 25%，上限 30%）。游標離開就用同一段淡返實色。淡出由腳本逐幀寫殼嘅 inline opacity（160ms `cubic-bezier(.2,.8,.2,1)`），`transition: none`，唔靠 CSS transition 播完。第一格用而家嘅 computed opacity 做起點，之後每一格向目標行，唔好停喺 `from`=1.00。近距輪詢喺目標改變之後繼續送約 168ms，視窗未聚焦、rAF 停咗都推到時鐘；到埗之後同一目標唔再寫 style，亦唔重設起點。`--hit-opacity` 唔可以同時驅動光球，亦唔好用 `opacity: 1 !important` 釘實光球。殼保持 `will-change: opacity`。transitionend 唔改 class 或者其他 style。每一幀 computed opacity 向目標單調，包括最後一格。透明度跟全域輪詢嘅游標距離同 Ctrl，另加一個例外：打開嘅面板或者計劃（包括收合未完、`data-state` 仍然係 panel）蓋住光球嘅 44px 光碟再加 34px 光暈時，嗰粒用同一段 160ms 淡到 0，DOM `pointer-events: none`；hit rect 照發，Ctrl+click 仍然開到被蓋住嘅光球（R-CT-02）；收合完、面板唔再係 panel，先淡返。光球位置唔郁。名稱片跟住淡，蓋實就收埋。其餘情況唔跟鍵盤事件或者焦點；游標遠一定係 1。Esc 關面板之後放開 overlay 嘅鍵盤焦點。儲存設定要保留已有嘅 `fade_enabled` 同 `fade_distance`。設定表單冇呢兩個欄，唔好寫死 `fade_enabled: false`。穿透唔變：預設穿透，只有揸住 Ctrl 而且游標喺 12px 命中邊內先可以撳（R-CT-*）。Ctrl 揸住而且游標喺 72px 淡出範圍內，嗰粒用同一段 160ms 返實色；可以撳仍然只係 12px 命中邊，而且命中圓對齊可見光碟（底部 footer slack 唔好拉高 orb 嘅 hit，令圓心跌低）。Ctrl+C／Ctrl+V 唔閃（R-CT-06），就算 overlay 仲有焦點都唔好把遠方光球留喺 0.18。面板唔變：預設實色可撳，Ctrl 揸住先透明同穿透。穿透視窗要靠全域游標輪詢（Windows `GetCursorPos`、Linux `XQueryPointer`，經 `device_query`），唔好靠 DOM mouse。`prefers-reduced-motion` 縮到 1ms。冇閒置循環動畫（R-PN-08）。2026-10-22 早段「約 180ms、淡出 150–200ms」**已取代**（v92 盒：180ms linear 加輪詢，6/21 次過唔到 250ms 內 ≤30%）。5dac6e2 嘅 250ms 目標 21/21 已過，但 15/84 次尾段仍有一格反向。2da217e 將反向減到 11/84。e301d99 改用腳本逐幀之後光球完全唔淡（21/21 近距樣本仍係 1）：輪詢每個目標只送一次，時鐘冇再推。改返由 compositor 嘅 CSS transition 播去 inline 目標，而且唔再同時寫 `--hit-opacity`。ae88559 一次 inline 目標加 CSS transition 令淡出 21/21 恢復，但尾段反向返到 29/125：完結嗰格畫咗中間值或舊值。CSS transition 完結會補一格，所以改返腳本逐幀，輪詢喺淡出期間持續送樣，到埗就停寫。
- 來源：Devon 2026-10-08 原規則；2026-10-22 恢復（整合 REQUIREMENTS.md 時漏咗）。見 C-16。取代 R-CT-02／R-CT-03 嘅「預設半透明」。
- 驗收（兩邊）：游標遠時光球實色；進入 72px 後 250ms 內透明度 ≤30%；離開返實色；Ctrl 揸住近光球時實色而且 12px 內可撳；Ctrl 放開，喺淡出範圍內撳仍然穿透；Ctrl+C／V 冇閃。
- 狀態：❓ / ❓。

**R-OB-06** 設定有開關「永遠顯示員工名」，預設關。關住時光球同而家一樣。值係 config.json 嘅 `show_bot_names`；關住唔寫出呢個欄。只有 Devon 撥個開關先寫檔。啟動、重連、靜態名單同步（R-SY-09）唔好為咗呢個值改 config.json。
開咗之後，每粒光球（Bot、設定、看板、排程，同之後嘅子光球）喺畫面中心嗰一側顯示 `display_name`，離開光碟邊 10px，同光球垂直置中。嗰側撞到面板、其他名、或者連線膠囊，先試對面同上下。長名按名稱片 96px 闊度截斷加省略號，「Hermes 主機」留全名，tooltip 同 aria-label 保留全名。名稱片高 18px、左右 padding 6px、圓角 2px；字 Barlow Condensed 12px/18px `#14142b`；底 `rgba(248,248,252,.82)`；1px `rgb(var(--bot-rgb) / .2)` 邊。中文唔好大階或者加字距。字唔可以用淺色 bot 色（黃 `#f2f200`、青 `#00f2f2`），對住淺色底至少 4.5:1。淺色 bot 嘅 glyph 用深色 `--bot-ink`（黃 `#f2f200` 係 `#6b6b00`，青 `#00f2f2` 係 `#006b6b`；白底對比低過 3:1 嘅其他色，包括 `#edff45`、`#79f200`、`#f27900`、`#ff8442`，用加深咗嘅同色墨），光暈保持純 bot 色。標籤屬於嗰粒光球：跟 R-OB-05 一齊淡，被面板蓋住就收埋，預設穿透，只有揸住 Ctrl 先可以撳同喺近距返實色（R-CT-01、R-CT-03）。冇揸 Ctrl 時命中區維持光碟加原本 12px，唔好因為標籤變大。標籤唔好疊住面板，標籤之間亦唔好重疊。撥開關只寫 `show_bot_names` 呢一個鍵；舊檔冇 `kanban_base_url` 就唔好順便寫出空字串，亦唔好把其他鍵按字母重排。設定撳「儲存」同樣只寫用戶改過、或者檔案已經有嘅鍵：舊檔冇 `kanban_base_url` 而且仍然留空，就唔好寫出 `"kanban_base_url": ""`；用戶填咗網址就寫入；個鍵已經喺檔案入面就照寫。名稱片嘅底片跟字嘅闊度，置中仍然對齊光球中心。
- 來源：Devon 2026-10-24，排喺 R-SY-09 之後。
- 驗收：開關持久而且冇改過唔寫檔；標籤有渲染同截斷；冇 Ctrl 時命中矩形不變；字同底片對比 ≥4.5，唔係淺色 bot 色。儲存唔會為咗仍然留空、而且舊檔冇有嘅 `kanban_base_url` 新增個鍵。
- 狀態：❓ / ❓。

**R-AD-01** v104 閒置光球。`.bot-btn::before` 光暈：`inset: calc(-1 * var(--orb-glow-radius))`，`--orb-glow-radius: 34px`，`radial-gradient(circle, rgb(var(--bot-rgb) / .55) 0%, rgb(var(--bot-rgb) / .22) 42%, transparent 72%)`，opacity `.85`；hover opacity `1` 同 `scale(1.08)`。`.orb-core` 係近白眩光，`box-shadow: none`。`--bot-size: 44px`。glyph `500 18px/1`，`color: var(--bot-ink, var(--bot))`，`text-shadow: 0 0 4px #fff`。黃 `#f2f200` 嘅 `--bot-ink` 係 `#6b6b00`，青 `#00f2f2` 係 `#006b6b`。其餘喺白底對比低過 3:1 嘅 bot 色（包括 `#edff45`、`#79f200`、`#f27900`、`#ff8442`）用同一條對比規則加深成自己嘅墨，墨對白至少 4.5:1。光暈保持純 bot 色。閒置圓形光球唔畫邊。打開面板嘅 `.morph-glow` 維持 96px、alpha `.12`。Orb 狀態嘅殼 clip 每邊闊 34px（`round 999px`），殼同 `.morph-orb` 都係 `overflow: visible`。殼背景同 `.morph-fill` 喺閒置 orb 透明。命中矩形仍然係 44px 光碟，唔包括光暈。
- 驗收：要睇渲染像素，唔可以只對 computed style。閒置光球嘅光暈要畫出 44px 光碟之外（光碟邊再外仍然有 bot 色），光碟冇實白貼紙，亦冇 1px 色環。閒置光球冇 `.morph-fill::after` 圈洗。黃 `#f2f200`、青 `#00f2f2` glyph 用上面兩隻墨；`#edff45` 嘅 glyph 唔可以係原色。打開之後再收合（關閉掣、Esc、再撳另一粒光球，以及重複開關）要返到同打開之前一樣嘅閒置渲染：殼 clip 每邊闊 34px、`round 999px`，殼同 `.morph-orb` `overflow: visible`，殼背景同 `.morph-fill` 透明，`.bot-btn::before` 光暈恢復，冇留低 `is-morphing`、`is-collapsing`、`is-orb-docked`，亦冇 fill:forwards 鎖住嘅 44px clip。命中矩形仍然係 44px 光碟，光暈穿透。

**R-AD-02** 被打開面板或者計劃蓋住嘅光球（44px 光碟加 34px 光暈相交）用 R-OB-05 同一段 160ms 淡到 0。殼同 `.morph-orb` 都係 `pointer-events: none`。hit rect 照發，而且仍然係 44px 光碟，Ctrl+click 仍然開到嗰粒（R-CT-02）。殼離開 orb 狀態要清 `data-orb-covered`。收合完先返。位置唔郁。
- 驗收：面板開住時，光暈撞到面板嘅光球 opacity 去 0，hit 清單仍然有佢，而且係 44×44；收合完淡返。打開之後個面板冇 `data-orb-covered="1"`。

**R-AD-03** 看板空狀態同登入。Header 係 `KANBAN /` 加 profile 名；profile 用 JetBrains Mono 11px `#616191`（有呢個字體先用，否則跟 `--font-mono`）。登入塊上下左右置中：標題 22px，一行 13px 說明（`#14142b` 70%），實心 `#0000f2` 掣，白字，高 32px，padding `0 16px`，圓角 2px，掣上面 16px。「要登入 Kanban」留喺標題。「連唔到 Kanban。」同其他空狀態顯示期間，`#kanban-board` 收起，句子喺面板置中。面板尺寸唔改。
- 驗收：登入畫面見到「要登入 Kanban」同實心登入掣；看板面板仍然係 `min(960px, 80vw)` × `min(80vh, 760px)`。「連唔到 Kanban。」嘅中心貼近面板中心。

**R-AD-04** 設定面板密度（頁尾結束／儲存唔改）。說明最少 12px／1.5，`#14142b` 70%。欄位標籤 12px Barlow Condensed `#0000f2`。輸入 13px。標籤同行距 12px，組距 20px，legend 上面 24px。剔選係 14×14，包括每個 profile 嘅「顯示」，1px `rgba(0,0,242,.4)` 邊，圓角 2px；剔中填 `#0000f2` 加白 1.5px 剔。`.bot-row` 唔好再寫 16px。顏色格 20×20，圓角 2px，1px `rgba(20,20,43,.2)` 邊。「永遠顯示員工名」字唔改。
- 驗收：設定面板用上述字級同自訂剔選；頁尾掣維持原樣。profile「顯示」剔選係 14×14。

**R-AD-05** Windows 工作區。視窗仍然蓋滿成個螢幕。邊位光球放喺 work area 入面。頂、左、右嘅 `--edge-pad` 由工作區邊度起計。底邊光球中心係 `workArea.bottom - 12 - orb/2`：光暈可以蓋過工作列，44px 光碟唔可以。`fit_overlay` 交 `inset_top/right/bottom/left`（CSS px）。Windows 用 `Monitor::work_area()`（WorkingArea），唔再加底邊下限；一般工作列已經至少 48px，所以 y 唔變。Linux 另外讀 GDK `gdk_monitor_get_workarea`，同 X11 `_NET_WORKAREA`、`_NET_WM_STRUT`、`_NET_WM_STRUT_PARTIAL`；幾個讀數用 inset 最大嗰組。Linux 有效底邊 inset 係 `max(reportedBottom, 48)`：plank 唔留位、工作區報全螢幕、底邊讀數係 0，都仍然留 48px。頂、左、右維持讀數，頂邊 t=0.21 唔郁。Windows 點擊穿透探測嘅頂邊 t=0.21 唔改。探測腳本用 WorkingArea 同 Bounds 嘅差做同一組 inset；設定光球 y 係 `frameTop + frameH - 12 - orb/2`，看板、排程跟住工作區；頂邊 field 公式維持 `$w * 0.08 + $w * 0.84 * 0.21` 同 `pad + orb/2`。視窗同空白點仍然用成個 Bounds。
- 驗收：底邊 inset 48px 時，底邊光球 y 係 `height - inset - 12 - orb/2`；頂邊 t=0.21 嘅 y 仍然係 `pad + orb/2`。X11 底邊 strut 56px、scale 1 得出 bottom inset 56。Linux 讀到全螢幕（bottom 0）時有效底邊係 48，光碟底至少喺 `screenBottom - 48 - 12`。頂、左、右唔因呢個下限而郁。Windows 探測 y 跟 WorkingArea，唔加 48px 下限。

**R-AD-06** 金鑰橫額同連線膠囊。預設仍然 top 96px。呢個 home 都要避開每粒光球同佢 34px 光暈，再加 12px；冇面板開住、光暈擋到 home，就改放喺光暈外（頂邊看板光暈會將橫額同膠囊放到 y ≥ 132）。只係底邊面板開住、又冇碰到 home，唔好因為個面板搬走。撞到打開嘅面板就放喺面板外 12px、畫面中心嗰一側；放唔落先試其餘邊，再退到 header 行。唔好疊住光球或者佢 34px 光暈。金鑰橫額圓角 2px。膠囊仍然係唯一 999px 圓角。底係 `rgba(248,248,252,.92)`，字 `#14142b` 12px/1.4 Noto Sans HK，唔好用文字透明度。連結部分 `#0000f2` 加底線，其餘句子保持 `#14142b`。邊 1px `rgb(0 0 242 / .35)`。padding `6px 12px`。字同連結對住橫額底 `#f8f8fc` 至少 7:1。
- 驗收：`keyBannerSlot` 預設 gap 12；光暈擋住中心側時改去另一邊。閒置橫額同膠囊唔疊住看板光暈。`#conn-banner[data-sticky="keys"]` 圓角 2px。`.conn-banner.ok, .conn-banner.info` 圓角 999px。`.conn-banner` 用上面嘅底、字、邊、padding。底線只喺包住「設定」嘅 `.banner-link`（`#0000f2`）。`.banner-action` 同 `.banner-copy` 都係 `text-decoration: none`。

**R-AD-07** 設定。Kanban server 只得欄位標籤，唔好再加一個 legend。說明放喺個標籤下面，12px/1.5 `#616191`。「Bot 名單」唔加項目符號，用 Barlow Condensed 12px `#0000f2`，上面 24px。設定開住時金鑰橫額保持收起，`keyPromptBots` 唔清空。未有金鑰嘅 profile 喺金鑰欄下面顯示 12px `#e5484d` 提示「未有 API 金鑰」。Bot 列同 token 欄嘅提示（「詳情（可留空）」、「專用位址（可留空）」、「可留空」）係 `placeholder`，`::placeholder` 色 `#616191`，唔好寫入 value。實驗 legend「實驗：由 dashboard 匯入名單」唔加項目符號，用 Barlow Condensed 12px `#0000f2`，fieldset 上面 24px。
- 驗收：設定 HTML 冇 `<legend>Kanban server</legend>`。`.kanban-server-hint` 係 12px/1.5 `#616191`。`.settings-panel .roster-head` margin-top 24px，`.roster-head h3::before` 係 `content: none`。`rowFromBot` 喺有 profile 而 `has_key` 係 false 時加 `.key-missing`。`.settings-panel .bot-row input::placeholder` 同 `.settings-panel .field input::placeholder` 係 `#616191`。token 欄標籤冇「可留空」，input 嘅 placeholder 係「可留空」。`.settings-panel .experimental legend::before` 係 `content: none`。`.settings-panel legend` 係 12px Barlow Condensed `#0000f2`，`.settings-panel fieldset` margin-top 24px。

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

**R-KB-01** 看板有自己一粒光球（上緣正中，菱形），開出即時看板；欄序 triage、todo、ready、running、blocked、done，唔顯示 archived；拖卡改狀態寫返 Hermes。R-KB-05 把欄序擴成 triage、todo、scheduled、ready、running、blocked、review、done。
- 來源：Devon；SPEC §8。驗收（盒）：拖卡後 `hermes kanban list` 顯示新狀態。狀態：❓ / ❓。

**R-KB-02** 看板有變（新增、改狀態）而且面板未開，光球展開膠囊通知約 5 秒（「新增：標題」／「標題 → 狀態」／「看板有更新」）；第一次快照唔通知；面板開住唔通知。
- 來源：Devon；SPEC §8.4。驗收（盒）：用 CLI 加一張卡，5–10s 內出膠囊。狀態：❓ / ❓。

**R-KB-03** 未裝 overlay-slash kanban 時顯示「未裝 overlay-slash kanban，看板唔會出現。」，唔可以出假任務。
- 來源：SPEC §8.2。狀態：❓ / ❓。

**R-KB-04** gateway 對看板路徑回 404（overlay-slash kanban route 唔喺呢部 Hermes）時，顯示「呢部 Hermes 未有看板。伺服器冇提供看板功能。」，字色 `#14142b`，靜態、冇動畫。唔好再寫「（404）」，以免全形括號自己跳一行。呢個係功能未提供，唔當逾時，唔進入 R-SY-08 嘅無限重試。
- 來源：Devon（2026-10-22 手提：看板 endpoint 404）。驗收（單元＋盒）：404 回應之後看板停留喺上面嗰句，`gatewayDown` 係 false；真正連唔到或者逾時仍然行 R-SY-08。
- 狀態：❓ / ❓。

**R-KB-05** 看板讀 Devon 部機嘅 `hermes serve`（埠 9119，`/api/plugins/kanban`），唔係 gateway 8642。8642 嘅 `/api/jobs` 係排程；看板路徑 404 係預期。讀只用 GET：`/api/plugins/kanban/board`、`/api/plugins/kanban/boards` 同 `/api/plugins/kanban/tasks/{id}`。冇傳 `board` 就係伺服器嘅 current board，唔好寫死 `default`（見 R-KB-06）。欄序 triage、todo、scheduled、ready、running、blocked、review、done。撳卡片開詳情（標題、內文、負責人、狀態、優先、latest_summary、留言）。拖卡仍然走原來嘅 overlay PATCH（R-KB-01），唔好對 9119 嘅看板路徑發 POST。

設定有 Kanban server 位址。留空就用 gateway 嘅 host 加埠 9119。登入由 Devon 自己填：優先系統瀏覽器 PKCE（`GET /auth/native/authorize`、`POST /auth/native/token`、`POST /auth/native/refresh`）；帳號密碼一齊填就用 `POST /auth/password-login`（`provider: basic`）攞 session cookie。鑰匙圈已經有 `kanban-access-token` 同 `kanban-refresh-token`（Windows 目標名係 `kanban-access-token.com.freezemusic.hermes-overlay` 同 `kanban-refresh-token.com.freezemusic.hermes-overlay`）時，access 過期或者看板 GET 回任何 401，都用該 refresh token POST `/auth/native/refresh`（JSON 只得 `refresh_token`）。成功就把新 access 同新 refresh 寫返同一對鑰匙圈帳戶，然後同一個 GET 再試一次。Refresh 回 401 或 403 先顯示「要登入 Kanban」；同一條已拒嘅 refresh token 唔好每個輪詢再 POST。Refresh 連唔到或者逾時保持「連唔到 Kanban。」，token 留喺鑰匙圈。帳號、密碼、cookie、access、refresh 只放呢個程式自己嘅鑰匙圈（`com.freezemusic.hermes-overlay` 嘅 kanban 帳戶），唔寫 log、唔寫 config.json、唔讀寫 `dashboard-session-token`、`profile:*`，亦唔用其他程式嘅鑰匙圈。

401 顯示平靜「要登入 Kanban」加登入掣，唔當錯誤、唔當未有看板、唔進入 R-SY-08。錯咗嘅已存密碼同樣係呢句，唔好顯示 API_SERVER_KEY 嘅 401 字，而且要清走看板上面嘅舊卡。錯密碼唔好每 5 秒再 POST `/auth/password-login`；記住呢組帳號密碼已經被拒，直至 Devon 改咗鑰匙圈入面嘅帳號或密碼先再試一次。真正 404 先用 R-KB-04。9119 連唔到、逾時、或者條閒置連線被 `hermes serve` 關掉（大約 5 秒），都只顯示喺看板，唔好觸發 R-SY-08，亦唔好出 gateway 嗰粒「連唔到 Hermes」膠囊。HTTP pool 嘅 idle timeout 係 2 秒，短過 5 秒，避免重用已經被伺服器關掉嘅 socket。

- 來源：Devon（2026-10-22，Hermes 0.22.2，`http://10.10.24.33:9119`）。8cf5af4 盒：錯密碼出 API_SERVER_KEY 401 而且每 5 秒再登入；needsLogin 留低舊卡；閒置 socket 閃「連唔到 Hermes」並觸發重連。
- 驗收（單元，假 9119）：過期 access 加 refresh token，board GET 401 之後只 POST 一次 `/auth/native/refresh`，寫低新 access 同新 refresh，再 GET 一次就有欄同卡片；refresh 401 先係「要登入 Kanban」，第二次讀唔再 POST 該 refresh token，回應亦唔包含 token 字；密碼登入儲 cookie；錯密碼係登入狀態而且第二次讀唔再 POST 密碼；404 仍然係 R-KB-04；閂咗嘅埠係連線錯誤，看板文案唔含 Hermes gateway；登入狀態唔當 404。金鑰唔入 config.json。`get_kanban_board` 同 `get_kanban_task` 喺 secrets 有變時寫返鑰匙圈，而且唔 log token。
- 狀態：❓ / ❓。

**R-KB-06** 看板唔再寫死 `board=default`。未有人手揀過嘅板時，`GET /api/plugins/kanban/board` 唔帶 `board` 參數，伺服器回 current board（Devon 部 Hermes 0.22.5 係 `mt4`；`default` 同 `deskrpg` 可以係空）。另外 `GET /api/plugins/kanban/boards`，用佢嘅 `current` 填 header 嘅細揀板器。清單入面伺服器 current 嗰項標「（目前）」，例如 `mt4（目前）`。`.kanban-board-pick` 用 `appearance: none` 同 overlay 箭咀，唔好用原生灰盒同黑箭。Linux WebKitGTK 打開嘅清單仍然係原生 GTK menu：`option` 樣式改唔到個 popup，自製 listbox 會掂命中區（R-CT），所以開住嘅清單保持原生。收起嗰陣嘅揀板器繼續用 overlay 樣式。只有用戶親手揀過先記住：記憶體即時用，並用 splice 寫 `kanban_board` 入 config.json。跟 current、開面板、輪詢、quiet roster 都唔寫呢個鍵；舊檔冇 `kanban_board` 就保持逐個位元組不變。DONE 欄用原有欄頭樣式，預設收起，欄頭有 chevron 同張數，表示撳開先展開卡片。archived 繼續隱藏，唔好傳 `include_archived`。呢啲讀全部 GET，唔好對 9119 看板路徑 POST。空狀態、登入、「連唔到 Kanban。」同 R-AD-03 嘅置中版面唔改。

- 來源：Devon（2026-10-26，Hermes 0.22.5，`http://10.10.24.33:9119`，85 張卡全部喺 current board `mt4`：72 done、4 todo、3 triage、6 archived；`default` 同 `deskrpg` 係空）。
- 驗收（單元，假 9119）：空 slug 嘅 board URL 冇 `?board=`，亦唔含 `default`；唔帶 query 回 `mt4` 嘅卡，`?board=default` 同 `?board=deskrpg` 係空板；`/boards` 嘅 `current` 係 `mt4`；archived 唔出現；done 欄在；`columnCollapsed("done", false)` 係收起，收起欄頭有 `▸` 同張數。`boardOptionLabel("mt4", "mt4")` 係 `mt4（目前）`。`.kanban-board-pick` 有 `appearance: none`。`store_kanban_board` 未呼叫、或者 slug 係空，config.json 位元組不變；揀咗 `mt4` 先多 `kanban_board`。`get_kanban_board` 唔寫呢個鍵。
- 狀態：❓ / ❓。

---

## 7. Session（R-SS）

> 2026-10-21 Devon 裁決（C-01）：本節取代 repo `SPEC.md` §5.2、§5.5、§5.7，同埋同本節撞嘅 §5.4、§5.6。
> 2026-10-21 曾經寫「啟動唔跟已儲存 session id，一律開標題 Bot Chat」。2026-10-22 手提一度改成「config 或者 explicit 已經有嘅 session 要保留」。**已取代**（Devon 2026-10-22，SESSIONS-desktop）：主面板預設等於 Hermes Desktop 喺嗰個 profile 開嘅 Bot Chat。只有人手 explicit 先可以蓋過。見下面 R-SS-01／02／04。

**R-SS-01** 每個 bot 嘅**主光球面板**預設開 Hermes Desktop 喺嗰個 profile 開嘅 Bot Chat。Desktop 嘅 Bot Chat 係標題剛好係 `Bot Chat` 嗰一條（通常 `hidden=1`；title 唯一索引保證只有一條）。Gateway 嘅精確標題查已經返回最新嘅延續 child；客戶端唔沿 `parent_session_id` 行，因為一般 session 清單預設唔包含 children。`source`（`tui`／`api_server`／`desktop`）同訊息數都唔計。空嘅 Bot Chat 都有效。清單要搵到隱藏嘅 Bot Chat：用精確標題查，包含 hidden 同 archived。

次序：
1. Devon 人手揀過、而且 explicit 旗仲喺、嗰條 id 仍然喺清單（例如 mt-orch `20261015_011713_2242f9`）就用嗰條。
2. 否則用 Desktop 嘅 Bot Chat，就算 config.json 記住另一條而且唔係 explicit。例如 ff-daily config 係 `20261013_180130_88f994`，都要開 `api_1792573589_0c14ed12`。
3. 永遠唔自動轉去最新 session，亦唔新建 session。冇 Bot Chat 時，先至可以留喺一條仍然存在、而且唔係「標題已清、archived、hidden」嘅舊列。
4. 啟動、打開或關閉面板、同 gateway 重連之後，config.json 位元組保持不變。喺記憶解析，唔好把過時嘅 sessionId 寫返檔。explicit 旗唔可以自動清走。anchor 唔跟最新訊息時間改寫。只有設定畫面改動，或者人手揀 session，先可以寫檔。

`POST /api/sessions/{id}/chat` 寫入唔係 `api_server`／`bot_room` 嘅 session 會 `permission_denied`。邊條開邊條仍然跟上面次序，`source` 唔影響揀邊條。只讀提示同發送失敗嘅說法見 R-SS-08。「只有 `tui` 時輸入同傳送停用」**已取代**（R-SS-08）。啟動同打開都**唔新建** session。「永遠唔開 0 訊息 `api_` 重複」**已取代**：mt-coder、mt-tester、mt-reviewer 嘅 `api_1792573589_*` 而家就係 Desktop 嘅 Bot Chat。

- 來源：Devon（2026-10-22，SESSIONS-desktop）。Desktop：`CANONICAL_CHAT_TITLE`、`hidden=1`、`idx_sessions_title_unique`。標題查已經係最新 child。清單係 `GET /api/sessions?limit=200&title=Bot%20Chat&include_hidden=true&include_archived=true`，再同一般清單合併；兩條請求都不加 `include_children`。
- 驗收（兩邊）：forex-forest 開 `20261001_013827_25b1eb`（tui，只讀）。ff-daily 開 `api_1792573589_0c14ed12`（config 係 `20261013_180130_88f994`，唔係 explicit，唔寫返檔）。mt-orch 開 explicit `20261015_011713_2242f9`，旗保留。mt-coder 開 `api_1792573589_f1c99a3b`。mt-tester 開 `api_1792573589_257658b2`。mt-reviewer 開 `api_1792573589_b1b8ccc5`。單元測試覆蓋：過時 archived config id、非 explicit 而且唔等於 Bot Chat 嘅 config id、explicit 贏、壓縮譜系、空 Bot Chat。gateway 返嚟之後 config 位元組同重連之前一樣。輸入同傳送停用見 R-SS-08。
- 狀態：❓ / ❌(Win，11a150e：0 次建立，但開錯 session 同改寫 config）。單元測試已鎖呢條 Desktop 規則；手提未再驗。

**R-SS-02** 自動路徑**唔改** config.json：啟動、打開或關閉面板、cron 更新 `last_active`、有新 session、gateway 重連，位元組都保持不變，包括 session id、explicit 旗、anchor。畫面喺記憶跟 R-SS-01 解析，所以一條非 explicit 嘅舊 id 可以顯示 Desktop 嘅 Bot Chat，但唔寫返檔。explicit 唔會被清走。手動 picker（R-SS-04）先可以改 id 同寫上 explicit；anchor 數字唔跟最新訊息時間改寫。「只有 config 未有 id 先寫入一次」**已取代**（v92 打開面板改寫 anchor）。
- 來源：Devon（2026-10-22）。11a150e 喺 gateway 返嚟時改咗 ff-daily、mt-coder、mt-tester、mt-orch 嘅 session id，清走 mt-orch 嘅 explicit，又改咗 anchor。
- 驗收（**Windows 必做**＋盒）：Devon 手提上，ff-daily、mt-orch、forex-forest 啟動後、等 60s、逐個開關面板、gateway 重連、再重啟一次，session id、explicit、anchor 同開波之前一樣。盒：單元測試 `stored_pin_after_resolve` 喺已有 id 時返回唔寫。
- 狀態：❓ / ❌(Win，11a150e 改寫 config)。盒未再驗。

**R-SS-03** 啟動時同打開面板時**唔可以新建任何 session**（零次 `POST /api/sessions`）。
- 來源：Devon（2026-10-21）；6904645 段。
- 驗收（兩邊）：開 debug log 或者喺 gateway 記錄請求，啟動＋打開全部面板，`POST /api/sessions` = 0 次；前後 `GET /api/sessions` 數目一樣。
- 狀態：❓ / ✅(盒)；Win ❓。11a150e 手提亦係 0 次建立。

**R-SS-04** 面板內嘅 session picker 保留，可以手動揀任何 session（Bot Chat 釘頂）；轉 session 即刻重畫（≤1 幀；要等 fetch 時 ≤333ms）。手動揀先寫 explicit。下一次打開主光球面板停喺呢個 explicit session。冇 explicit 就開 Desktop 嘅 Bot Chat（R-SS-01）。
- 來源：Devon；SPEC §5.3；2026-10-22 手提（mt-orch 的 explicit `20261015_011713_2242f9` 要留低）。驗收（兩邊）：揀另一條 → 即刻顯示，config 寫上 explicit；關咗再開 → 同一條，旗仲喺。
- 狀態：❓ / ⚠️(盒：重畫 67ms／333ms ✅；「再開留喺 explicit」未驗)。

**R-SS-05** 面板開住 Bot Chat 時，新訊息（包括 cron 輸出）即時加入對話；光球收埋時出預覽膠囊（24 小時 `HH:MM`，約 5s）。
- 來源：SPEC §5.8、§7。狀態：❓ / ❓。

**R-SS-06** 就算 Hermes Desktop 冇開，都要收到 Hermes 主動發出嘅訊息。**（未解決）**
- 來源：Devon。驗收（Windows）：閂 Hermes Desktop，觸發一個會主動發訊息嘅 cron，overlay 喺 ≤10s 內出膠囊。狀態：❓ / ❓。

**R-SS-07** Bot Chat 以外嘅 session，每條用一粒 sub-orb 代表（將來做，見 R-SO）；主光球唔會用嚟顯示呢啲 session。
- 來源：Devon（2026-10-21）。狀態：— / —（PR #3 唔包）。

**R-SS-08** 主面板開住嘅 session，如果 metadata `source` 唔係 `api_server` 或者 `bot_room`（包括 `oneshot`、`cli`、`tui`、`desktop`、空 source），輸入停用，並顯示「呢個 session 係喺 CLI／Desktop 開嘅，只可以睇，唔可以喺呢度傳嘢」。`api_server` 同 `bot_room` 可以傳。如果發送仍然收到 `permission_denied`（例如 `RuntimeStoreError('permission_denied')` 或者 `permission denied`），畫面顯示同一句，唔顯示原始錯誤，唔重試，亦唔建立 session。Bot Chat 揀邊條（R-SS-01）、config.json 位元組（R-SS-02）、啟動同打開唔 `POST /api/sessions`（R-SS-03）都保持不變。新 session 按鈕仍然留喺 sub-orb（R-SS-07／R-SO），呢條唔加。

**SS-08-a** 只讀 session 開住時，鍵盤轉發唔好寫入已停用嘅輸入：`insertComposerKey` 見到 `field.disabled` 就返回。停用輸入要睇得出係停用（Nous `#616191` 嘅暗底同 placeholder），唔好保持白底。停用嘅「傳送」同樣要睇得出係停用（同一套 `#616191` 暗底，唔好只係半透明藍掣）。只讀／錯誤橫額留喺開住嘅面板入面，而且喺分頁同 session 列下面，唔好蓋住佢哋，亦唔好疊出預設面板右緣。金鑰同 gateway 橫額仍然用 `keyBannerSlot`。
- 來源：Devon 手提真用（Hermes gateway 0.22.5，CLI oneshot `source=oneshot`）。盒測 a76c65d、6a0973e 之後。
- 驗收（盒）：`oneshot`／`desktop`／`tui`／`cli`／空 source 係只讀而且 id 不變；`api_server`／`bot_room` 可寫；explicit desktop `20261015_011713_2242f9` 仍然開嗰條而且只讀；`failure_detail`／`explain` 見到 `RuntimeStoreError('permission_denied')` 只剩嗰句；`send_chat` 喺 `status: 404` 之前唔呼叫 `ensure_bot_chat`、`create_session`、`persist_pin`。呢條唔寫 config.json。SS-08-a：停用輸入撳字唔會入去；錯誤橫額嘅左右緣都喺面板入面。
- 狀態：❓ / ✅(盒，單元測試)；Win 未再驗。

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

**R-SY-08** Hermes gateway 連唔到或者逾時，看板、排程、Bot 名單／profile、同每個 Bot 嘅對話都要自己接返，唔使重開程式、亦唔使人手撳。退避大約 5 秒、10 秒、20 秒，之後封頂 60 秒，每次上下 20%。網路恢復、系統由睡眠醒返、或者打開受影響嘅面板，即刻再試，而且唔好跳級：打開面板觸發嘅即時重試如果失敗，停留喺而家嗰級（例如 20 秒），唔好直接去 60 秒封頂。重試期間看板／光球顯示平靜狀態「連唔到 Hermes，自動重試中…」加下次再試時間，唔顯示原始錯誤；字色 `#14142b`，對比 ≥4.5:1（R-VS-01）。唔可以有閒置循環動畫（R-PN-08）：唔轉圈，靜態狀態加倒數文字就得。恢復之後每個消費者刷新一次並清走錯誤。重試同重連永遠唔建立 session、亦唔離開 Bot Chat（0 次建立，R-SS-01…04）。每個 profile 同時最多一個進行中嘅探測。v92 盒：打開面板失敗之後倒數顯示「49 秒」（+15s），跳過咗 20 秒級。重試膠囊同金鑰橫額用同一個面板外固定槽，bot 面板開住時唔好壓住計劃嘅 Goal: 行。ddd908c 盒：重試膠囊壓住 Goal: 行。
- 來源：Devon（2026-10-22）。
- 驗收：停掉假 gateway，面板出重試狀態；再開 gateway，喺退避窗口加 1 秒內看板同 Bot 自己出現；全程 0 次建立 session。CI／單元測試覆蓋假 gateway 由落到起。重試膠囊經 `placeKeyBanner` 放喺面板外 12px、畫面中心嗰一側，而且唔好疊住光球或者佢 34px 光暈。
- 狀態：❓ / ❓。

**R-SY-09** 連住 Hermes 時，大約每 60 秒（上下 20%）靜靜對一次 profile 名單，唔使重開程式。用 `claimProfiles(["roster"])`，同看板、排程、其他 Bot 嘅探測唔重疊。Gateway 落咗就跳過呢一輪，交給 R-SY-08。

遠端機冇本機 `~/.hermes`、gateway `GET /health` 又冇 `profiles` 陣列、亦冇 dashboard session token 時，用 Kanban 同一個 origin（設咗嘅 Kanban 位址，否則 gateway host 埠 9119）打 `GET /api/profiles`。認證係鑰匙圈入面嘅 Kanban native access token，`Authorization: Bearer`（Hermes 0.22.5 gated dashboard middleware 收呢種 bearer；唔係 `X-Hermes-Session-Token`）。GET 回 401 就用同一條 refresh token `POST /auth/native/refresh` 一次，寫返新 access 同新 refresh，然後同一個 GET 再試一次。已拒嘅 refresh 唔好每個輪詢再 POST。呢下對 `/api/profiles` 只可以 GET。已經喺名單入面嘅 `enabled` 唔改。

新 profile 出光球，然後用現有 `profilesNeedingKeys` 提示 Devon 自己填金鑰。唔自動填金鑰，唔改共用鑰匙圈項目。對 Hermes 只讀，唔建立 session。

config.json 只有名單真係多咗 profile 先寫。冇變動嘅每一輪，檔案位元組保持一樣。已有 Bot 嘅 sessionId、enabled、顏色、次序、名稱、詳情都唔改。計時器唔刪走消失或者隱藏嘅 profile，亦唔因為今次搵唔到就標做不可用（一次讀取失敗唔可以隱藏晒所有人）。

每次同步都要為新 profile 出一次金鑰提示，包括啟動 `connectHermes`、`recoverGateway` 同靜態計時。已經喺名單入面嘅唔再提示。提示用 sticky kind `keys`：第一次載入歷史、`clearConnectionBanner()`、同 4 秒計時都唔好清走。Gateway 膠囊顯示期間記住呢句，膠囊收起之後再出，而且要更新 hit rect。金鑰橫額跟面板：平常點擊打開設定；揸住 Ctrl 就穿透，同其他面板一樣。打開設定先收起橫額，名單留住。儲存之後只留仍然未有金鑰嘅 profile，再出橫額。金鑰橫額預設停喺 top 96px。打開咗嘅面板（主面板同貼住嘅計劃，包括 `.plan-hit-host`）外緣 12px 之內，就改放喺面板外 12px、畫面中心嗰一側；嗰側放唔落先試其餘邊，再退到該面板 header 行入面。唔好逐行內容向下推。橫額唔好壓住計劃步驟、Bot Chat 下拉、看板內容，亦唔好疊住面板、光球或者光球 34px 光暈。

頭四粒光球用經典邊位（一粒喺頂邊 t=0.21；四粒係頂、右、底、左），加 profile 唔好郁呢四粒。第五粒起放入空位：中心距要大過光碟直徑加兩個 72px 淡出半徑，72px 淡出先唔會同時捉到兩粒；新位亦唔好落入打開咗嘅看板面板。6 粒或以上唔好疊到看板、排程、設定光球。`profiles/` 入面以點開頭嘅目錄（例如 `.deleted`）唔算 profile。

- 來源：Devon。8cf5af4 盒：恢復先跑同步，3 個新 profile 有 2 個冇金鑰提示；加光球會重排，6 粒時 researcher 疊住 cron；`.deleted` 被當成 profile。f1ebd03 盒：金鑰提示約 60ms／340ms 就被歷史載入或 gateway 膠囊清走；穩定槽把原有四粒推去角落，新粒相距約 70px 一齊淡，打開看板蓋住預設光球。afb21e2 盒：平常點擊橫額開到設定；Ctrl+click 穿透係面板規則，`interaction.rs` 維持只放行光球同 `pill:`。eafdd1e 盒：計劃打開之後 Goal 行搬入 `.plan-hit-host`，橫額 y 109–142 仍然蓋住 Goal y 110–118。fbcb44c 盒：橫額 y=133 蓋住計劃步驟 1 同 Bot Chat 下拉右緣；已登入看板橫額 top y=794 疊住面板底邊 y=801 約 7px。
- 驗收（單元）：冇變動嘅一輪 config 位元組一樣；新 profile 出現而且出金鑰提示，包括 `recoverGateway`；`GET /api/profiles` 帶 `Authorization: Bearer`，401 只 `POST /auth/native/refresh` 一次然後再 GET 一次，`/api/profiles` 冇 POST，已有列嘅 `enabled` 保持原值；提示係 sticky `keys`，`clearConnectionBanner` 保留，`clearGatewayWait` 會再顯示並 `scheduleHitSync`；平常點擊打開設定，Ctrl+click 穿透；打開設定收起橫額但留低 `keyPromptBots`，儲存之後只留未有金鑰嘅 profile；金鑰橫額預設 top 96px，打開面板就放喺外緣外面至少 12px（優先畫面中心嗰側），光暈擋住就換邊，放唔落先用 header 行，唔好壓住計劃步驟、Bot Chat 下拉、看板底邊或者光球光暈；舊 Bot 嘅 sessionId、enabled、顏色、次序保留；同其他探測唔重疊；gateway 落咗唔寫檔；`distributeEdges(4)` 係 `distributeEdges(5)` 同 `distributeEdges(6)` 嘅前綴而且等於經典四邊位；第 5 粒起中心距大於 188 而且唔落入看板面板；點開頭目錄唔出現。
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

- **C-01 Session 規則（✅ 已解決，Devon 2026-10-21；2026-10-22 收窄）**：啟動同打開都唔新建 session；picker 保留；其他 session 做 sub-orb。見 R-SS-01–04、R-SS-07。**本檔取代 repo `SPEC.md` §5.2（冇 Bot Chat 就 POST 新建）、§5.5（非明確揀嘅 id 改跟最新 Bot Chat）、§5.7（送出時 404 就新建）**；§5.4、§5.6「明確選擇記住」同 R-SS-04 撞嘅部分亦以本檔為準。2026-10-21「一律忽略已儲存 id、淨係開標題 Bot Chat」同 2026-10-22 手提「config 或者 explicit 已經有嘅 session 要保留」**已取代**（Devon 2026-10-22，SESSIONS-desktop）：只有人手 explicit 先蓋過；否則開 Desktop 標題剛好係 `Bot Chat` 嗰條（通常 hidden）。標題查已經係最新 child，客戶端唔再沿 `parent_session_id`。見 R-SS-01／02／04。原本推斷 §5.5 係 b919b7f 改咗 4 個 bot 嘅原因，未證實。仲有兩點未講（見 C-15）。
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
