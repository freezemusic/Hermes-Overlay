# 游標與穿透：實作筆記

這份是從 README 移出來的實作細節，內容沒有改，仍是原本的香港繁中寫法。驗收以 [REQUIREMENTS.md](../REQUIREMENTS.md) §1（R-CT）為準，實作細節另見 [SPEC.md](../SPEC.md) §1。使用方式的簡短說明在 [README](../README.md#游標與穿透)。

## 游標同穿透

光球同面板方向相反。預設修飾鍵係 **Ctrl**（可改 Shift 或 Alt）。靜止透明度預設 18%（可設 5–60%）。

- 光球（Bot、設定、看板、排程）預設實色而且穿透：唔收 click、hover、右撳。游標距命中圓 72px 內，嗰粒先用 120ms ease-out 淡到靜止透明度（上限 30%）；離開就淡返實色。淡出由腳本逐幀寫 inline opacity（120ms ease-out，`transition: none`），輪詢喺目標改變後繼續送約 168ms，到埗就停寫。透明度只跟全域輪詢嘅游標距離同 Ctrl。
- 揸住修飾鍵，而且游標喺淡出範圍內，嗰粒返實色。可以撳仍然只係游標下面或者 12px 內。其他唔近嘅光球維持實色同穿透。放手之後按游標距離返第上一條。名稱標籤只喺修飾鍵加 hover 先出，放手即消失。光球用圓形：距離圓心唔超過半徑加 12px 先算對準，外接正方形嘅角位唔會接手。Ctrl+C／Ctrl+V 唔閃。
- 面板（Bot 面板、設定、看板、排程、貼住嘅計劃視窗）預設實色、可以撳、可以操作。游標行近唔會令佢變淡。
- 揸住修飾鍵，所有面板（連關閉掣同計劃視窗）變透明而且穿透。放手即返實色、可操作。
- 訊息預覽膠囊平時實色但穿透。只有修飾鍵加游標喺膠囊上先可以撳，再展開成面板。
- 喺其他程式或者輸入框撳 Ctrl+C／Ctrl+V，光球同面板嘅透明度同穿透唔變、唔閃，包括 C／V 放咗、Ctrl 仲揸住嗰段。
- 讀唔到全域游標或者修飾鍵（純 Wayland）時，光球同面板保持可撳，唔入穿透。
- 任何 hit flush 都要跟住而家嘅修飾鍵。Ctrl 仍然按住、游標又喺光球或預覽膠囊上時，不得把 input shape 清成 n=0；要保留或重算嗰個矩形。滑鼠已經按下期間亦不得清走現有命中區。呢個判斷喺 Rust，用系統鍵監測（`device_query`，同驅動 Ctrl 時 n=1 嗰個），唔信網頁 keydown。穿透視窗未聚焦時撳落嘅 Ctrl，頁面會報 `ctrl=0`，都不得清走 Rust 嘅鍵態。有面板蓋住光球時，只要游標喺已公佈嘅光球或膠囊上，shape 都留住嗰個矩形。Rust 把真實鍵態交俾頁面。滑鼠鍵亦係 `device_query`。Ctrl 按住時喺光球上按下，就把當時的 input shape 鎖到放開，重新公佈唔會改形狀。重新公佈用同 n=1 一樣的 CSS 座標打新矩形；游標樣本缺失就沿用上次打中的點。游標仲喺上一份形狀的光球裡面就不得公佈 n=0。開咗 debug log 會寫 `hit-shape`（游標、候選矩形、點解落到 n=0）。Ctrl+光球由 pointerup 打開：pointerdown 用 pointer capture 記住光球 id，唔靠同一個元素的 click。按下期間同之後約 300ms 唔開始計劃彩排，亦唔重畫光球；進行中的彩排會中止並延後。真實計劃接縫期間彩排同 hit flush 都延後。Rust 鎖住形狀時用鎖住的光球 id。debug log 會寫 `pointer`（phase、目標、光球 id）。pointerup 要按下開始時修飾鍵按住先打開：Rust hit check 鎖住嘅光球 id，同埋 pointerdown 嘅 ctrlKey；之後先至推到嘅鍵態不得取消。剛放開就點不得打開。計劃增長時鐘要等殼嘅收起 clip 已經合成，而且 GTK after-paint 確認至少兩幀，先開始 280ms。揭示跟返 v71：殼 `shell.animate` 剪裁，`fill: both`，`holdMotion` 係 `transition: none !important`。冷開第一個超過 20ms 嘅樣本重新對原點，最多三次，仍然遲就顯示 20ms；第二個提交樣本最多 45ms，暖開同底緣都用同一對上限。重新對鐘之後第一個可見樣本停喺 20ms。計劃 ✕ 同右邊界從第一幀就喺剪裁入面，揭示前寬度鎖定，排隊重畫不得改幾何或換走 ✕。揭示中途呈現幀距超過一幀就每幀最多行一幀，總時間超過兩倍先追，而且不得連續兩幀同一進度，每一個呈現樣本至少行一幀曲線。最後一個樣本同一幀寫入完全打開嘅整數 px clip，並推計劃層重畫成個矩形，after-paint 確認後先還原；開咗 debug log 先寫 `seam-final`。曲線唔改。鍵沿用 run_javascript 直接寫透明度。打開、變形同啟動的 input shape 即時套用。Ctrl 鍵沿矩形冇變就唔再 combine，亦不得延遲加入游標打得到的矩形。完成但 computed clip-path 仍然收起就寫 `seam-clip-stuck`。計劃收回去到 160ms 就開始面板收回，兩段曲線同時間唔改。計劃收回同面板收回中間唔改畫面，面板層要喺計劃收回期間已經合成，關閉按鈕唔播背景 transition。Ctrl 按下或放開由 `device_query` 監測即時推去頁面，唔等 morph、收回、彩排或 hit flush；面板透明係 Ctrl 鍵沿處理器入面同步寫殼嘅 inline opacity，唔等 rAF、after-paint 或 input shape；新的 input shape 即時套用，冇變的 Ctrl 鍵沿先跳過 combine。寫入記 `opacity-write`，下一幀 after-paint 記 `opacity-present`。呢下唔重畫 Bot。Ctrl 按住穿過打開，動畫完結第一幀就要透明。聚焦輸入框嘅 Enter 用 DOM ctrlKey 或者系統鍵態，唔好兩個一齊先算。
- 輸入框聚焦會保持**中間對話面板**實色，游標喺塊面板上先可以點。設定頁打開會保持**設定面板**同樣處理。Esc、點到元素以外嘅空白，或者視窗失焦，會 blur 輸入框並解除鎖定。視窗交畀另一個程式會即時解除鎖定；網頁內短暫失焦先會等約 150ms。修飾鍵選單嘅彈出視窗、本程式視窗，同埋佢嘅外框，都仍然算本程式，設定卡會保持。Linux 用前景視窗嘅 X11 window id 對照呢啲 id，唔再靠 `_NET_WM_PID`；任何其他非零前景視窗都係另一個程式，連續兩次讀到就放開，並且清走 dropdown 旗、blur 修飾鍵選單，再叫 WebKit 閂 option menu，GTK menu 用 cancel／deactivate 收起。WebKit 自己嘅 popup 唔係 GtkMenu，`menu.close()` 收唔到；抓手係普通 popup window 時，向個 window 送合成 Escape（`widget.event`），等 WebKit 自己取消。唔再用 hide 同 seat ungrab，避免下一次撳選單要撳兩下。讀唔到前景視窗先保持。Windows 同 macOS 仍然用行程 id。
- 修飾鍵可以改做 Alt，但 Linux 視窗管理員（xfwm4 預設，GNOME／KDE 都常見）用 Alt 拖移視窗，Alt+click 可能去唔到 overlay。設定頁喺 Linux 會顯示呢個警告，Alt 仍然可以揀。唔使點擊都可以開設定：全域快捷鍵 **Ctrl+Shift+Alt+H**，或者系統匣選單「設定 (Ctrl+Shift+Alt+H)」。系統匣亦有「結束」。中間面板嘅「關閉」只收起對話面板，唔會結束程式。收起會設 `[hidden]`，`.center-panel[hidden]` 用 `display: none` 蓋過 `display: flex`，面板先會真係消失，hit-sync 亦會丟掉呢塊矩形。置頂只切換 keep-above。置頂之後大約 1 秒內先拒絕關閉要求，避免 keep-above 令程式退出。過咗呢一秒，Alt+F4 同 wmctrl -c 可以正常結束。設定頁有「結束」，同系統匣「結束」一樣呼叫 `app.exit(0)`。`quit_app` 同 `arm_pin_close_guard` 要喺預設 capability 允許先叫到；叫唔到會出喺錯誤橫額。Unix 嘅 SIGINT／SIGTERM 同樣走呢條路。

實作用 Rust 大約每 16ms 讀全域游標同修飾鍵（`device_query`），前端報上元素矩形。Windows 同 macOS 用成個視窗嘅 `set_ignore_cursor_events`：有任何應接收游標嘅光球或面板先關閉穿透。光球只喺修飾鍵對準時接收；面板喺未按修飾鍵而且游標喺上面時接收。Linux X11（包括開咗 `DISPLAY` 嘅 XWayland）用 GDK input shape。純 Wayland 讀唔到全域游標／修飾鍵，overlay 會保持可點擊，唔會穿透。macOS 要喺「私隱與保安 → 輔助使用」允許呢個 app，否則修飾鍵可能讀唔到。全域快捷鍵同樣要輔助使用權限。
