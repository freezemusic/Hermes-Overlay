# Hermes Overlay 規格

這是 Devon 對 Hermes Overlay 的單一依據。之後每一次改動都要逐條核對受影響的條文，再改程式。與 README、註解或較早說明衝突時，以本檔為準。

條文用「必須／不得」寫成可觀察的結果。UI 字串維持繁體中文（zh-HK）。英文只用於程式、協定與專有名詞。

預設修飾鍵是 Ctrl，可在設定改成 Shift 或 Alt。下面寫 Ctrl 的地方，若設定改了修飾鍵，就改指那個鍵。透明度百分比的預設是 18%（設定範圍 5–60），下面稱作靜止透明度。

## 1. 互動

光球與面板方向相反。

1. 光球（包括設定光球、看板光球與排程光球）在未按住修飾鍵時必須半透明，透明度等於靜止透明度，而且滑鼠穿透：不接收 click、hover 或 right-click。
2. 按住修飾鍵時，只有游標在其上或距命中區 12px 以內的那一粒光球變成不透明（透明度 1）並且可點。其餘光球保持靜止透明度與穿透。
3. 放開修飾鍵後，該光球必須回到半透明與穿透。名稱標籤只在按住修飾鍵且游標在該光球上時出現；放開後必須消失，不得因 hover 卡住而留在畫面上。
4. 右鍵「隱藏呢個 Bot」只在按住修飾鍵、而且游標在該 Bot 光球上時出現。未按住修飾鍵時，右鍵不得打開這個選單。
5. 隱藏選單是面板：修飾鍵仍按住時它跟其他面板一樣穿透；放開修飾鍵後才可以點「隱藏呢個 Bot」。
6. 面板（Bot 面板、設定、看板、排程，以及貼在 Bot 面板旁的計劃視窗）在未按住修飾鍵時必須不透明（透明度 1）、可點、可操作。游標移近或移過面板不得讓它變淡。計劃視窗沒有自己的命中 id，它的範圍併入該 Bot 面板的命中矩形。面板打開期間，該矩形必須一直留在作業系統的命中區，不得等 hover 或 mousemove 輪詢先取消穿透。游標剛到達輸入列、「關閉計劃視窗」或面板內其他控制的第一次按下必須生效。已經聚焦嘅輸入框不得因為修飾鍵按下或放開而 blur，亦不得重建那個 input。放開修飾鍵之後打出嘅第一個字必須進入仍然聚焦嘅輸入框。Bot 仍在回覆（停止掣可見）時打開面板，面板剪裁同計劃接縫未完嗰陣打出嘅字必須進入嗰個輸入列並留喺度，等回覆完再送。串流更新、焦點交還、或者按下打中停止掣，都不得吞走呢啲字。Busy 仍然只係阻止送出非 `/stop` 嘅訊息，不得清走輸入列。
7. 按住修飾鍵、而且游標位置已知時，所有面板必須降到靜止透明度並穿透，關閉按鈕一併穿透。作業系統 input shape 這時只包含光球，以及游標下面嘅預覽膠囊，不得包含面板矩形或 `close:`。放開修飾鍵後恢復不透明與可操作，面板矩形同關閉按鈕（連同周圍約 36px）回到命中區，第一次按下就關閉該面板。光球不得因為面板打開而變成未按修飾鍵也可點。任何 hit flush 或 input shape 公佈都要跟住而家嘅修飾鍵：修飾鍵按住而且游標喺光球或預覽膠囊上時，必須保留或重算嗰個矩形，不得公佈 n=0。指標已經按下期間亦不得清走現有命中區。呢條適用於每一條 flush，包括看板膠囊 settle 之後嗰下。權威係 Rust 嘅系統鍵監測（同驅動 Ctrl n=1 嗰個 `device_query`），唔係網頁 keydown。網頁喺穿透視窗未聚焦時撳落嘅 Ctrl 唔會有 keydown，頁面報 `ctrl=0` 都不得清走 Rust 已經睇到嘅鍵態。游標喺已公佈嘅光球或預覽膠囊上時，即使有面板蓋住，input shape 都要留住嗰個矩形。真實鍵態要交返俾頁面。滑鼠鍵同樣由 `device_query` 讀。按下如果係喺修飾鍵按住、游標喺光球上開始，就要把當時的 input shape 鎖到放開為止，期間的重新公佈不得改形狀。重新公佈時用同 n=1 一樣的 CSS 座標打新矩形；游標樣本缺失就沿用上次打中的座標。游標仍然喺上一份形狀的光球或預覽膠囊裡面時，不得公佈 n=0。設定 `HERMES_OVERLAY_DEBUG_LOG` 時，打不中或者鎖住形狀要寫 `hit-shape`（游標、候選矩形、原因）。Ctrl+光球的打開由 pointerup 開始：pointerdown 用 `setPointerCapture` 記住光球 id，不得等同一個元素的 DOM `click`。按下已被 Rust 鎖住形狀時，用 Rust 鎖住的光球 id。指標按下期間，以及距上次 pointerdown 約 300ms 內，不得開始計劃彩排，亦不得重畫光球 DOM；pointerdown 會中止進行中的彩排並延後。真實計劃接縫期間不得開始彩排，重疊的 hit flush 亦要延後。同一份記錄寫 `pointer`（phase、目標、光球 id）。
8. 訊息預覽是膠囊，不是獨立 toast。它在未按住修飾鍵時必須不透明（透明度 1）而且滑鼠穿透。只有按住修飾鍵、而且游標在該膠囊上時才可點，並可以繼續展開成面板。
9. 在其他程式或本程式輸入框按 Ctrl+C 或 Ctrl+V 時，光球與面板的透明度與穿透不得改變，也不得閃一下。這包括 C／V 先放開、Ctrl 仍按住的整段尾巴。單獨按住 Ctrl 必須在 100ms 內進入第 2 與第 7 條的互動狀態。修飾鍵若改成 Shift 或 Alt，Ctrl+C／Ctrl+V 不適用這條約束。
10. 面板必須能在視窗內拖移：拖標題列改變該面板的 `left`／`top`。不得改成拖動整個作業系統視窗。拖移中途游標離開原矩形，拖移仍須完成。拖移只移動打開中的面板。收回成光球時必須丟掉這次拖移位置，光球回到原本的邊緣錨點，不得留在畫面中間。
11. 讀不到全域游標或修飾鍵時（純 Wayland），光球與面板保持可點，不得進入穿透。
12. 冷啟動的視窗必須鋪滿所在螢幕。不得停在置中的 1280×800，否則點擊打不中 overlay。Windows 上不得用會把無邊框視窗縮回 1280×800 的位置或尺寸呼叫來完成這件事。視窗建立時必須隱藏、無裝飾、透明（`visible: false`）。Linux 上 tao 會喺 `set_decorated` 之前就 map，所以第一下 `show` 只可以發生喺透明畫面畫好之後。視窗隱藏時就要寫好滿螢幕嘅位置同尺寸（Linux 直接改 GTK 視窗，Windows 用唔帶顯示旗嘅位置呼叫），頁面等到 viewport 係嗰個尺寸、光球排好、再透明畫一幀，先至 `show`。光球第一眼就要喺最終位置。`show` 之後再公佈一次命中區，已經有嘅命中區不得清成 n=0。Windows 喺 `WM_CREATE` 先顯示，鋪滿螢幕嗰下不得帶顯示旗。`skipTaskbar` 維持 false，系統匣同工作列都仲喺。唔好靠 `maximized`，因為 tao 會等到第一次 configure（即係 show）先放大。
13. 啟動狀態列（例如「已連接設定…」）不得蓋住上緣光球。成功與資訊約 4 秒後必須消失。錯誤，以及可以點擊的提示，可以留下。

## 2. 面板開關

光球、膠囊與面板是同一個元素。殼在動畫開始前就有面板尺寸，可見形狀用 `clip-path: inset() round` 剪出來。不得逐帧改變作業系統視窗尺寸。透明、被剪走的區域必須滑鼠穿透。

1. 每一粒 Bot 光球只打開與關閉自己的面板。打開 A 不得關閉 B、設定、看板或排程。另一粒殼嘅膠囊變形、settle 或 quiet window 不得吞掉對其他光球嘅點擊；被剪走嘅區域保持穿透，點中嘅光球必須喺同一個回合開始打開，不得等對方嘅 quiet-flush，亦不得等歷史載入先至開始變形。打開由 pointerup 開始（pointerdown 已記住光球 id），不得等 DOM `click` 先至 `morph-start`。
2. 面板上的關閉只關閉該面板。回覆進行中按下關閉必須收回該面板。訊息預覽不得取消進行中的關閉，也不得把正在收回的面板重新展開成膠囊。游標剛到達關閉按鈕、輸入列或「關閉計劃視窗」的第一次按下必須生效，不得因為命中測試落後而忽略。關閉按鈕在修飾鍵放開時第一次按下就生效；修飾鍵仍按住時跟面板穿透，不得關閉。
3. 點已經打開的光球必須把該面板升到最前，而不是關掉其他面板。點擊與 hover 光球仍然要按住修飾鍵（見第 1 節）。
4. 三個形狀：光球約 44px 圓形；膠囊約 320px 寬、高度等於光球直徑、兩端全圓，裡面是光球加一行預覽；面板約 420×560、圓角 ≤3px。光球位置就係標題列嗰粒光球，打開時不得飛、不得平移。殼以光球中心做錨，標題槽中心落喺光球原本嘅位置。上緣：標題在面板頂，光球在標題靠螢幕嗰一側（左半就左上），面板向下長。左緣或右緣：標題在頂，光球貼住螢幕邊緣嗰一角，面板向畫面中心同向下長；光球太貼底、向下會超出螢幕多過向上，就改為向上長，標題改到面板底、低過輸入列。下緣：標題在面板底、低過輸入列，光球在底角，面板向上長，標題字在光球旁邊。光球若由 44px 收到 28px，只用 `transform: scale`，中心唔郁，480ms，同面板剪裁同一回合。看板可以用更大的板面，但同一套變形。看板光球在上緣正中。其餘 Bot 光球沿邊緣分佈，不得蓋住這粒看板光球。排程光球在右緣、高度約 38%，展開成一欄：寬度 `min(320px, 86vw)`，高度 `fit-content` 而且 `max-height: 70vh`。必須喺資料畫完之後量內容高度再寫入殼，不得先用 70vh 鋪到螢幕底，亦不得之後縮得太矮而裁走最後一行「未有排程」。設定光球留在下緣。
5. `data-edge` 為 `bottom`、`top`、`left` 或 `right`，決定 `transform-origin` 與錨點。展開永遠朝向畫面中心。剪裁用的光球中心在整個過程中不得移動，亦不得飛去另一個標題角。標題槽就築在呢個中心上面。
6. 冷啟動只顯示光球。不得自動打開預設 Bot 的面板。第一次需要設定時仍可打開設定面板。
7. 光球到膠囊只向畫面中心橫向加長，200ms，用 `clip-path` 由光球直徑長到膠囊寬度，不得動畫 `width`。緩動是 `cubic-bezier(.2,.8,.2,1)`。點擊打開時，膠囊剪完立刻接面板，中間不得停住，`transition-delay` 係 0；只有 hover 先停喺膠囊。膠囊到面板用 480ms 的 `clip-path`，呢段時鐘必須真係跑滿 480ms `cubic-bezier(.2,.8,.2,1)`（大約 14 幀），不得改由膠囊嗰條 200ms `transition` 代跑。，由光球所在的那一角向外擴到整塊面板，四邊同一套，同一條緩動。不得使用 spring，不得過衝。動畫開始前，殼已經擺喺分離之後嘅最終矩形（包住計劃視窗），之後只過渡 `clip-path`，不得再改 `width`、`height` 或 `top`。關鍵幀必須係 JavaScript 算出嘅 px（Web Animations API），圓角由膠囊高度一半（22px）收到 3px。不得喺 inset 變化期間維持 `round 999px`，否則可見形會變成由面板中間長出嘅橢圓；亦不得動畫 `calc()`，WebKitGTK 唔會對佢插值。下緣而且錨點喺左時，吃掉嘅係上邊同右邊，左邊同下邊維持 0，光球嗰一角全程唔郁；其他角按錨點對調。上緣同下緣面板同時打開時，可見外緣之間至少留 12px，不得貼成一條冇縫嘅柱，亦不得因此關掉另一塊。呢個 12px 係兩塊看得見嘅外緣之間嘅淨空，要計埋框線、伸出框外嘅角標同發光，亦要計埋貼住面板嘅計劃視窗矩形。角標伸出 3px，所以排版盒子之間要再加兩邊伸出量，唔可以只量 border box。
8. 只可以動畫 `transform`、`opacity` 與 `clip-path`。玻璃底必須跟 `clip-path` 一起被剪。面板內容唔再用 CSS `transition` 同 delay。WebKitGTK 會喺 delay 生效嗰陣把 opacity 從 0 重播，下緣標題會先空白再回來。`.content` 維持 `opacity: 0`，冇 opacity transition。`open` 只加一次，加喺面板嗰 480ms 開始，之後不得再移除再加。同一個回合、同 `clip-path` 動畫一齊，對 `.content` 同 `.morph-body` 播一段 WAAPI：`opacity` 由 0 到 1、160ms 就到 1、linear、`fill: forwards`，時鐘係剪裁嘅四倍，避免 settle 後幾幀放開 fill。四邊同一條，唔加 delay。之後不得再寫 inline opacity 或 transition，剪完亦不得改會動到 opacity 的 class。內容層（`translateZ(0)`，`will-change: opacity`）要喺呢段開始之前提升。光球 `::before` 嘅光暈喺移動同埋停喺標題時 `transition: none`，唔好喺光球到位之後喺面板中間留低一粒光。光球不得平移。縮放同面板嗰段 `clip-path` 同一回合開始：`transform: scale` 由 1 去 `28/44`，`transform-origin: center`，480ms、`cubic-bezier(.2,.8,.2,1)`、delay 0，中心固定。冇 `--icon-dx`／`--icon-dy` 飛行。`is-orb-moving` 喺剪裁開始時加上，縮放期間 `.morph-glow` 留喺光球中心、透明度係 .4；縮放完先換成 `is-orb-docked`，透明度返 1，而且 `transition: none`。收回時同一粒光球用 300ms 由而家嘅縮放返到 1，中心仍然唔郁。1px hairline 沿著剪裁邊緣，面板嗰段第一幀四邊都要有，唔可以只剩錨點嗰一邊。`.morph-stroke` 係 `#0000f2`，剪到形狀外緣；玻璃 `.morph-fill` 再向內 1px，藍線先會跟住四邊一齊走。殼本身喺呢段保持透明。圖示附近有淡的 Bot 色放射光。四角 HUD 角標係 8×8 嘅 L、線粗 1px、顏色 `rgba(0,0,242,.4)`，放喺框外（`top`/`left` 同 `bottom`/`right` 都係 `-3px`），DOM 仍然喺 `.center-panel` 裡面，計劃視窗嘅角標喺 `.plan-window` 裡面。角標嘅線畫喺 `-3px` 嗰一像素，殼如果用 `inset(-3px)` 會剛好裁走成條線。面板剪裁期間殼向外讓 `FRAME_BLEED + 1`（4px），角標先至包喺剪裁裡面跟住長大。`.center-panel` 同打開後嘅 `.plan-window` 都係 `overflow: visible`，角標 `z-index` 高過玻璃。面板打開而且唔喺變形中時，殼用 `overflow: visible`，剪裁停喺最終關鍵幀（計劃打開就拉闊去蓋住計劃），不得改成 `clip-path: none`，等角標畫到框外；變形嗰 480ms 仍然用 `clip-path` 剪玻璃。排程面板用同一種角標，必須睇得見。計劃視窗唔再用 `clip-path` 長大。WebKitGTK 唔會合成 `clip-path`，而且 `opacity: 0` 唔會把 Markdown 畫入合成層。真實對話嘅計劃要喺膠囊開始之前排好版，並且以 `opacity: 1`、`z-index: -1`、平移到不透明玻璃下面畫入合成層。面板嗰 480ms 剪完之後，到計劃第一幀之間，不得重畫對話、不得讀 `offsetWidth` 或 `getBoundingClientRect`、不得 `flushHits` 或改 input shape。內容要喺剪裁開始之前已經畫好。剪完之後擺出 `scaleX(0.001)` 同內層相反嘅 `scaleX`，鎖死計劃外框嘅像素寬同高。`getComputedStyle` 確認呢個計劃節點，等佢以 `visibility: visible` 畫出一幀 `scaleX(0.001)`（雙重 rAF），之後先設定兩條軌道嘅 `startTime`。第一個畫出嘅增長幀要低過 35%。外層去到 `scaleX(1)`，字唔會被拉扁。240ms，緩動仍然係 `cubic-bezier(.2,.8,.2,1)`，數值寫入關鍵幀，時鐘用 linear，等兩條軌道保持互為倒數。右貼 `transform-origin: left center`，左貼 `right center`。命中區用排版寬度，動畫嗰 240ms 唔改作業系統 input shape，亦唔改視窗尺寸。變形、計劃增長同之後約 300ms 內嘅 DOM 更新要排隊。由變形開始到計劃增長完成之後 600ms 係凍結：唔跑背景刷新、唔套用排隊更新、唔 `renderBots`、唔做會讀版面嘅 hit flush，亦唔 cancel 計劃動畫。計劃動畫用 `fill: forwards` 留到最後，最後一幀就係靜止狀態；完成嗰幀唔寫新嘅 inline transform。凍結完先就地換 markdown，外框仍然鎖住像素尺寸同 `overflow: hidden`；早過就保持舊內容。面板唔好用 `innerHTML` 清走再重建。設定 `HERMES_OVERLAY_DEBUG_LOG` 先寫檔案記錄（預設關閉）。對話就地換文字，唔替換節點，唔改會重播 transition 嘅 class。不得一幀彈出完整視窗。每個已啟用 profile 嘅 Bot Chat 同上次計劃都要喺打開之前載入，唔止預設嗰個：啟動、任一光球 hover 或 Ctrl-hover、以及背景刷新。打開若果快取未返到就先等佢畫完，先至開始變形；變形開始直到計劃增長完成之後 600ms 零 fetch、零重畫。冷開先開空面板，內容畫完並且畫出一幀之後先開始 240ms 增長，唔好先計時再載入。session 選擇器唔好停喺「未有對話」先等網絡。剪裁結束時如果計劃已經排好版，計劃保持 `visibility: hidden`，不得先露出大約 2% 嘅接縫。隱藏期間可以擺 `scaleX(0.001)` 同 `getComputedStyle`。`scaleX(0.001)` 畫出一幀之後先 `startTime`。呢幀大約係 0.1%，唔好停喺 2% 嘅接縫。完成之後留住 `fill: forwards`，唔好 cancel，唔好喺完成幀寫新嘅 transform，並且唔好再加 `is-seam-grow`。計劃節點只建立一次，之後只換裡面嘅內容，不得移除再插入，亦不得再開一條 `scaleX`。剪裁結束時仲未有計劃，就完全唔顯示接縫；等計劃到咗，再用自己嘅 240ms 由接縫長出。接縫只准長一次。已經長開或者正在長，後到嘅 session 或計劃只可以換內容，不得再播 `scaleX`，亦不得縮返接縫。氣泡要喺剪裁開始之前排好。變形同增長期間唔好再排版。左緣打開期間，整個 `is-morphing`（膠囊同面板剪裁）標題、內容、膠囊、光球同 `::before` 的 `transition` 同 `animation` 都是 `none !important`。`renderBots` 不得在呢段重寫光球 class。內容 opacity 跟剪裁同一條 WAAPI 時鐘：160ms 淡到 1，動畫本身行到剪裁完，避免 160ms 結束嗰幀重播。`contain` 亦不得喺 `is-orb-moving` 拎走嗰一幀改返 `layout`，否則標題同分頁會洗淡一幀。
9. 收回用緩動 `cubic-bezier(.4,0,1,1)`，一次剪返光球，中間不停膠囊。時間以動畫本身嘅 duration 計，不得再加收尾等待。時鐘按邊釘死：右緣 300ms，左緣 316ms，下緣 266ms，上緣 382ms。`.is-collapsing` 不得再加 `transition: clip-path`，殼、玻璃、描邊同光球嘅 `transition` 必須係 `none`；WebKitGTK 如果 CSS transition 同 WAAPI 一齊跑，左右緣會拉長過 300ms。收回期間不得逐幀更新命中區，亦不得跑 `renderBots`。內容喺開頭先用 80ms 淡出，同形狀收回重疊。收回嗰條 WAAPI 喺同一個回合寫入 `startTime`，並把 `currentTime` 設做 0，時鐘由呢一刻計，唔好等下一幀先開始，亦不得先做 `offsetWidth`。上緣面板段 v62 畫出約 267ms（加一幀約 2k px 尾先到 300）。時鐘加到 382ms，面板段畫出要清楚落在 300–333ms。右緣、左緣、下緣時鐘唔改。`renderBots` 等到收回剪完先跑。左右緣同上緣、下緣嘅可見收回要落在 300–333ms。收回進行中不得跑對話、看板或排程刷新，命中區刷新亦不得落地。這些 tick 不得喺面板消失之後兩幀單獨重畫；要等到收回結束超過 1 秒，而且資料冇變就不得寫 DOM。收回開始前先公佈光球命中區。面板消失之後同一段時間不得再 `set_hit_rects`、不得改 input shape、不得重畫光球。光球靜止 clip 同 `scale(1)` 喺收回動畫開始嗰回合寫入，結束幀唔再改。下緣時鐘維持 266ms（畫出大約 300ms）。上緣、左緣、右緣嘅時鐘加長，等畫出落在 300–333ms。`prefers-reduced-motion` 時不得播放變形，只做一次普通淡入淡出。
10. 沒有閒置循環動畫。`will-change` 只在變形期間存在，結束必須拿掉。

## 3. 設定光球與 Bot 面板

1. 必須有一粒獨立的設定光球。它開啟的面板才放 Hermes gateway、dashboard、名單、API 金鑰、修飾鍵、置頂與結束程式。
2. Bot 面板只編輯該 Bot 的顯示名稱、詳情與 `SOUL.md`。Bot 面板不得出現 gateway 位址或 API 金鑰欄。
3. Bot 面板的主畫面必須是標題列、session 選擇器、可捲動的訊息列表，以及釘在底部、永遠可見的輸入列。訊息列表必須是 `flex: 1` 且有 `min-height`，滾輪必須能捲動它，高度不得變成 0。顯示名稱、詳情與 `SOUL.md` 放在另一個分頁，不得佔滿 420×560 而把對話或輸入列推出畫面。送出訊息、重新打開面板，以及串流進行中，列表必須留在最新訊息。使用者向上捲離底部後必須停在該處，直到再捲回接近底部才恢復跟隨。另一塊面板打開，或者幾秒後嘅重新排版，不得把仍跟隨底部嘅列表跳去最舊訊息。只有使用者自己嘅捲動先可以離開底部。
4. `SOUL.md` 路徑：環境變數 `HERMES_HOME` 有非空值就用它，否則用 `$HOME/.hermes`。profile `default` 寫在該目錄根上的 `SOUL.md`；其他 profile 寫在 `profiles/<profile>/SOUL.md`。
5. profile 名稱只允許 1–64 字元的 ASCII 英數與 `.`、`_`、`-`。不得含 `/`、`\`、`.` 或 `..`。
6. API 金鑰只放系統鑰匙圈，不得寫入 `config.json`。讀取必須離開 GTK 主線程，大約 3 秒未回應就當鎖定：顯示鑰匙圈錯誤，光球繼續畫，程式仍然可以結束。沒有金鑰唔係錯誤。

## 4. 發現 profile 與隱藏

1. 連上 Hermes（`mode == hermes`）時必須自動發現 profile，並寫入設定。發現來源只有：本機 Hermes home（根目錄有 `config.yaml` 或 `SOUL.md` 則為 `default`；`profiles/` 下合法子目錄為其他 profile）、已儲存 dashboard session token 時的 `GET /api/profiles`（逾時 4 秒，失敗則略過）、以及 gateway `/health` JSON 裡真正帶有 `profiles` 陣列的情況。
2. 不得靠猜測 `GET /p/<id>/health` 來枚舉 profile。本機已發現的 profile 不得因為 gateway health 失敗而被刪掉。
3. 新發現的 profile 預設顯示為光球。不得自動產生 API 金鑰。只有這次新加入且沒有金鑰的 profile 才提示「未有 API 金鑰，請喺設定填寫。金鑰唔會自動產生。」
4. 設定名單必須列出已停用的 profile，並有「顯示」勾選。取消顯示後光球消失，列與金鑰都保留。
5. 右鍵隱藏（見第 1.4 條）等同取消顯示，而且不得從儲存名單刪掉該列，否則鑰匙圈金鑰會被刪掉。
6. 「移除」才刪除該 profile 的金鑰。之後再次發現會重新出現，但必須重新填金鑰。
7. 再次發現不得覆蓋使用者已改的顯示名稱、詳情、專用位址或 session。顯示名稱只在空白或仍等於 profile id 時更新；詳情只在空白時更新。Hermes 若提供可解析的顏色，該顏色必須覆蓋既有顏色。

## 5. 對話

1. Hermes 把 cron 輸出寫入每個 profile 標題剛好是 `Bot Chat` 的 session。打開 Bot 面板時，若使用者沒有明確選過其他 session，預設必須是該 profile 最近活躍、而且 `source` 為 `api_server` 或 `desktop` 的 `Bot Chat`。`tui` 或其他 source 的同名 session 不得當成預設（佢冇 desktop 工具）。有多條符合時 `last_active` 較大者勝；仍相同則 id 較小者勝。隱藏的符合 session 一樣計算，但不因為隱藏而優先。列表為 `{root}/api/sessions?limit=200&include_hidden=true`。選擇器仍可手動選任何 session，包括 `tui` 的 `Bot Chat`。
2. 完全沒有 `source` 為 `api_server` 或 `desktop` 的 `Bot Chat` 時，必須先按 Hermes Desktop 的方式建立：`POST {root}/api/sessions`，內容為 `{ "title": "Bot Chat", "source": "api_server" }`。若 400 寫明標題已被某 session 佔用，只有該 session 的 `source` 係 `api_server` 或 `desktop` 先用該 id；其他 source 唔採用。列表搵唔到該 id 時仍用該 id（隱藏佔用者）。只有建立不可行時，才改開最近活躍、而且唔係其他 source 的 `Bot Chat` 的 session。
3. 面板必須保留 session 選擇器，其他 session 仍可選。標題為 `Bot Chat` 的列必須排在最頂，其餘再按最近活躍排序。
4. 使用者明確選過的 session 要按 Bot 記住，直到使用者再改，或該 id 已不在列表／回 404。Bot Chat 因 cron 更新 `last_active`，不得把明確選擇搶走。
5. 舊設定若只存著 session id、而 `session_explicit` 不是 true，打開時必須改跟最近活躍的 `Bot Chat`，不得停在過期對話。
6. `/new` 與 `/branch` 必須把新 session 記成使用者的明確選擇，不得立刻被 Bot Chat 蓋掉。
7. 送出時若有明確選擇就用該 id。該 id 回 404 時清掉選擇，再解析 Bot Chat；沒有就建立，建立不可行才用最新 session。
8. Overlay 必須輪詢每個已顯示且有金鑰的 profile 的 Bot Chat。新訊息到達後：面板若正開着該 session，訊息必須即時出現在對話，而且不得把面板收成膠囊；光球收起時必須展開預覽膠囊（24 小時 `HH:MM`，約 5 秒）。面板若開着其他 session，新訊息只記在 Bot Chat，不得打亂目前畫面，也不得把面板收成膠囊。

## 6. 光球顏色與計劃預覽

1. 光球顏色必須來自該 Hermes profile，而不是全部用同一個藍色。
2. 本機顏色只讀 `profile.yaml` 的 `ui_meta.hermes-bots.color`。`default` 讀 Hermes home 根目錄；具名 profile 讀 `profiles/<id>/profile.yaml`。區塊外的 `color` 不得採用。
3. dashboard 或 health 可提供 `color`、`bot_color`，或 `ui_meta` 裡 `hermes-bots`／`hermes_bots` 的 `color`。本機 yaml 有色時必須蓋過 dashboard。
4. 接受 `#rgb`、`#rrggbb`、`hsl(H S% L%)`、`hsl(H, S%, L%)`、`rgb(...)`，並存成小寫 `#rrggbb`。例：`hsl(326 68% 58%)` 必須成為 `#dd4b9e`，`#ABC` 必須成為 `#aabbcc`。無法辨識時不得用雜湊造色。
5. Hermes 顏色解析成功就必須用它，蓋過色票與已存的選擇器顏色。沒有顏色時保留已存顏色；全新列才用色票。
6. 沒有獨立的計劃 API。Bot 回覆若是計劃（含 Implementation Plan 與標題、或 `.hermes/plans/*.md` 與標題、或標題加 `**Goal:**`、或上一句使用者指令是 `plan` 且回覆至少 40 字、或包在 ` ```markdown `／` ```plan ` 代碼塊而且塊內有標題），必須打開貼在該 Bot 面板右側的計劃視窗。兩塊玻璃之間冇間隙，共用一條 1px 線：計劃視窗 `left: 100%`、`margin-left: 0`、接縫側 `border-left: none`，唔好再疊 `0 0 0 1px` 環。接縫兩側嘅角標收起，成組只留外框四角。右側放唔落就貼左側（`right: 100%`、`border-right: none`）。進行中的 live 氣泡不得當成計劃。代碼塊裡的計劃必須用塊內的 Markdown 渲染，不得把圍欄本身當成正文。
7. 視窗用與對話相同的 Markdown 渲染。「預覽」同「原文」係分段控制（segmented control）。關閉控制係 ✕，無障礙名稱仍然係「關閉計劃視窗」。沒有計劃，或使用者關閉之後，視窗必須收起。對話裡每條已完成的計劃訊息必須有「睇計劃」，按下去重新打開該份計劃。最新一份完成的計劃必須自動打開。計劃視窗已經開着另一份時，新計劃到達也必須改顯示最新一份。
8. 計劃視窗跟該 Bot 面板一起拖移，並屬於同一塊面板命中區（見第 1.6 與 1.7 條）。變形或收回期間不得露出視窗。計劃外框寬度停喺最終 px，文字唔縮放，`overflow: hidden`。增長唔再喺 `requestAnimationFrame` 入面改計劃嘅 transform、寬度或自己嘅 clip，亦不得把面板嗰條已經播完嘅 clip 動畫 `pause`、改 `currentTime` 或改 `startTime`。面板剪裁維持 480ms、`cubic-bezier(.2,.8,.2,1)`。計劃增長只喺呢段 transition 結束之後先開始。面板剪裁唔好出血到計劃上：計劃嗰一邊 inset 停喺 0（0px，冇 1% 殘邊），直到增長時鐘開始。增長係新嘅 `shell.animate()`，同一個 `.morph` 嘅 `clip-path`，由完全收起去到完全打開（`fill: both`、inline clip 寫終態），時長 280ms。緩動係一個常數 `PLAN_EASE`，固定 `cubic-bezier(.3,.6,.2,1)`，唔好再換後備曲線，亦唔好改 280ms。盒測閘：第一幀畫出 ≤45%，約 100ms ≤80%，約 200ms ≥90%，至少四幀睇得到變化。計劃增長收工，曲線唔再改。接縫時鐘睇頭三個 callback，唔好只覆蓋頭兩幀。第一個已經離開關閉關鍵幀（大約一個 vsync）就對回 t=0。第二同第三個若距上一幀超過大約 40ms，或者時鐘已經去到大約 75ms（冷開第一張真正上到畫面嘅幀，前面兩幀可以未掃到螢幕），都對回 t=0，唔好因為之前嘅 reveal 已經過 30% 就放棄。殼嘅 inline clip 維持關閉（`planRevealClip` 的 0）直到呢個呈現確認，先寫終態。唔好改 `PLAN_EASE`，亦唔好改 280ms。每次打開都要寫 `plan-warm`。冷開（包括第一次）在面板 480ms 剪裁期間，把計劃以 opacity 0.01 疊在剪裁裡面（唔好放喺不透明玻璃下面），用計劃自己的 px `clip-path` 由全關掃到全開。掃掠延遲約 200ms，等面板剪裁大到包得住計劃，先計 vsync。要有至少六個 vsync 間距，而且掃掠本身超過約 190ms（已經去到全開並停幾幀），先可以當已呈現；只睇 `animation.currentTime` 唔算，冷開第一幀會把文件時間線誤當成動畫時間。已經呈現過的打開寫 `plan-warm reuse`，時鐘仍在面板結束的同一刻開始，不得再等。正文還沒畫出來就不得開始時鐘。`capturePlanRaster` 喺時鐘開始之後不得再行樣式掃描。合成泵係視窗外面 1px 嘅 `.seam-tick`（`position: fixed`、`left/top: -1px`、`translate3d`），掛喺 `documentElement`，唔好放喺殼入面或者光球中心，亦唔好再喺光球加 `translateZ`。四邊光球色，同打開之前、關閉之後，都要一樣。收回結束就把 `--hit-opacity` 收到閒置值：`orb-idle` 在收回最後約 60ms 畫出，唔好等到 `collapse-release` 先由亮跳去暗。`collapse-release` 如果資料冇變，仍然係視覺空操作。時鐘用 `alignSeamClock` 釘在第一個呈現幀：同一個回合把 `currentTime` 設做 0 並立刻 `play`，暫停不得留到下一幀（冷開合成器唔會恢復跨幀暫停）。第一個呈現幀係全關空幀，呢個 callback 再把 `currentTime` 設做 0，下一幀先係 t≈0，唔好帶住啟動嗰下約 25ms 空隙。`fill: both` 托住全關關鍵幀。啟動第一幀畫完之後，先同步公佈光球命中區（`first-paint`），唔好等彩排完。然後閒置 callback 對每個已啟用 profile 喺真實殼上彩排一次：計劃打開、280ms `PLAN_EASE` 增長、再收起。殼放喺螢幕外 1px 宿主（`left/top: -4px`、`width/height: 1px`、`overflow: hidden`），再平移 `translate3d(-300vw, -300vh, 0)`，opacity 保持 1，所以層仍然合成，畫面上冇像素變化。光球替身留喺原位而且可以點；點擊會中止該 profile 嘅彩排並照常打開。指標按下期間，以及距上次 pointerdown 約 300ms 內，不得開始彩排，亦不得重畫光球 DOM；pointerdown 會中止進行中的彩排並延後到安靜之後。真實計劃接縫（`is-plan-seam`、`is-plan-arming`）或殼仲喺 `is-morphing` 時不得開始彩排，重疊的 hit flush 要延後。打開唔靠同一個元素的 DOM `click`。彩排唔好 silence 命中區。記錄寫 `plan-rehearsal start/finish profile=`。文件時間線被讀成 `currentTime`（遠大於動畫長度）要再釘並 `play`，唔好當成已經跑完。`present-frame` 在暫停同運行期間都逐幀寫，直到 finished，唔好停喺第一個 paused。如果等到增長完仍然停在關閉關鍵幀，再跑一次 280ms，唔好由結束寫入直接跳到全開。`PLAN_EASE` 唔改。計劃接縫期間（`is-plan-seam`）對話面板可以點擊輸入，計劃視窗本身仍然 `pointer-events: none`，呢段不重送命中區。計劃節點喺呢段唔改 transform。增長開始之前不得再 `holdQuiet`。收回時計劃先收：200ms、`cubic-bezier(.4,0,1,1)`，對話內容留到呢段完，面板自己嘅收回開始先淡走（同 v55）。然後先係每邊嘅面板時鐘，畫出要 300–333ms。約 1.1 秒後 `collapse-release` 如果資料冇變，不得寫光球文字、屬性、class、clip 或幾何，視覺上係空操作；`paintClip` 亦不得把靜止 px clip 改寫成 `revealClip` calc。完成後殼 clip 留喺最終值，唔 cancel。樣式表嘅靜止 `transform` 係 `none`，不得寫 `scaleX(0.001)`。左貼同右貼用同一條殼剪裁：只拉闊向外嗰一邊，不得拆層。下緣面板嘅關閉命中跟殼底腳欄，並寫 `hit-close`。按住 Ctrl 時作業系統命中區只留光球同游標下面嘅預覽膠囊，面板同 `close:` 都穿透；放開先恢復面板矩形同關閉。Ctrl 變化而且有面板打開時，檔案記錄寫 `hit-ctrl`（`held`、`shape`、`live`）。Settle 嗰一幀不得改任何視覺屬性，亦不得拆走變形剪裁層。剪裁結束不得移除 `is-growing-panel`（留到凍結後嘅排隊套用）。玻璃底色打開期間維持 `#f8f8fc`，描邊喺面板變形期間保持可見。停喺標題嘅光球同光暈保持 `will-change: transform`。內容淡入 160ms 到 1，WAAPI 時鐘係剪裁嘅四倍，唔好喺 settle 後幾幀放開 fill。凍結開始只寫時間戳：唔 cancel 動畫、唔停 rAF、唔移除 listener。最終面板命中區（連計劃寬度）喺變形開始前公佈。Settle 同凍結期間不得 `set_hit_rects`。下一次 input shape 要等凍結結束，同排隊渲染同一批。每次 `set_hit_rects` 同 input shape 都寫入檔案記錄。面板剪裁完成後，殼嘅 `clip-path` 停喺最終關鍵幀（計劃打開時同一層拉闊到蓋住計劃，不得改成 `none`），內容層維持原樣，底層 opacity 已經係 1。Settle 嗰一幀不得套用排隊渲染；要再等兩個 frame，先就地換文字或 markdown，並把內容 opacity 鎖成 inline `1`，不得喺套用時播淡入。變形同收回期間新氣泡不得有入場動畫。
9. 計劃視窗同 Bot 對話面板嘅 1px 框係玻璃 hairline，唔好再加一圈 `0 0 0 1px` 同框線疊厚。打開後嘅外陰影不得填滿第 2.7 條嘅 12px 淨空。底色 `rgba(248,248,252,.92)`，格線大約係平時一半嘅透明度。標題 13px、字重 600、顏色 `#0000f2`。正文 13px、行高 1.55。代碼同 JSON 塊係黑底白字、`11px var(--font-mono)`、圓角 2px、`1px solid var(--bot-20)`。使用者氣泡底 `var(--bot-10)`、字色 `var(--bot)`。

## 7. 訊息預覽與思考狀態

1. 新訊息必須把該光球展開成膠囊預覽，而不是另外一張 toast。時間必須是 24 小時 `HH:MM`，不得出現 `下午09:42` 這類 12 小時格式。
2. 每一粒光球同時只有一個預覽。顯示 5 秒後收回光球。已經打開的面板不得被預覽取代。預覽期間按住修飾鍵點擊，必須繼續展開成面板。
3. 預覽遵守第 1.8 條：看得見，但未按住修飾鍵時穿透。
4. Bot 思考中或使用工具時，光球必須持續顯示 spinner。閒置時不得有無限循環的動畫。
5. 名稱以 `_` 開頭或名為 `reasoning` 的進度只轉 spinner，不另開預覽。
6. 助手開始串流文字後 spinner 停止。完成、失敗、取消，或 90 秒沒有新事件後，思考狀態必須結束；若回合仍忙，狀態改為等候且不再空轉。

## 8. 看板

1. 必須有一粒看板光球，停在螢幕上緣正中。它打開的是即時看板，而不是另一個 Bot 的對話。
2. 看板資料來自 Hermes 上的 overlay-slash plugin。未安裝時必須顯示「未裝 overlay-slash kanban，看板唔會出現。」不得顯示假任務。瀏覽器預覽可以顯示示範任務。
3. 欄位順序為 triage、todo、ready、running、blocked、done。`archived` 不得出現。
4. 無論面板開或收，都必須每 5 秒輪詢。第一次快照只作基準，不得彈出預覽。之後卡片新增、移動或狀態改變，而且看板面板未打開時，必須用第 7 節的膠囊預覽（約 5 秒，未按住修飾鍵時穿透）。一張新增寫「新增：標題」；多張寫「新增 N 張卡片」。一張改狀態寫「標題 → 狀態」；多張寫「N 張卡片改咗狀態」。其他指紋變化寫「看板有更新」。看板面板已經打開時不得再彈膠囊。拖卡片只發生在面板打開時，因此不得因今次拖動再彈一粒。
5. 拖卡片必須能改任務狀態並寫回。
6. 看板光球遵守第 1 節的光球規則，看板面板遵守第 1 節的面板規則。菱形光球用第 2 節的同一套變形展開成看板，不得另外做一張飛出的面板。

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
4. 程式碼塊同 JSON 塊黑底 `#000`、白字 `#fff`、`11px var(--font-mono)`、圓角 2px、`1px solid var(--bot-20)`。使用者氣泡底 `var(--bot-10)`、字色 `var(--bot)`。
5. 光球核心只留近白眩光（`#fff 0 36%`）。不得加回粗的實色藍外圈。外暈用該 Bot 顏色，約 `.55` 與 `.22`。
6. Bot 思考圈是 1px、顏色 `--bot-60` 的弧線。不得用粗的 `#0000f2` 加外發光。等候時弧線不旋轉。排程光球嘅進行中樣式見第 12 節，唔用呢條思考圈。
7. 看板菱形是 1px `#616191`，不得加黑色雙框，也不得用 `scale()` 把線縮沒。欄標題 `#0000f2`。格線用半透明 `--bot-5`。
8. 控制項圓角 0–3px，面板最大 3px。只有大型 popout 可以用 6px。
9. 中文不得 `text-transform: uppercase`，也不得加 letter-spacing。全檔只能有一組 uppercase，而且只在 `:lang(en)` 底下。
10. hover 與 press 為 120–200ms。光球展開成面板的時間與緩動見第 2 節（膠囊 200ms，面板 480ms，`cubic-bezier(.2,.8,.2,1)`）。不得使用 spring，不得用 `scale(0.92)` 假裝由光球展開。
11. Popout 陰影只有 `0 4px 40px rgb(0 0 145 / .6)`。Bot 對話面板同計劃視窗改用第 6.9 條嘅淺陰影。

## 11. 部署

1. Overlay 跑在 `LAPTOP-DEVON`，連線對象是遠端 Hermes API，不是假設 gateway 一定在這台電腦的 `127.0.0.1`。設定仍允許填那台機器 reach 得到的 gateway 位址。
2. 安裝檔維持未簽名。Windows 測試用 CI artifact `windows-x64-nsis`，不靠發佈 release。
3. 未獲明確要求，不得建立 git tag，也不得建立 GitHub Release。Release workflow 的 tag 與 draft 行為不得為了測試安裝檔而改掉。

## 12. 排程工作

1. 必須有一粒排程光球，停在螢幕右緣、高度約 38%。字形是「時」，顏色 `#616191`，字重 600。它不是 Bot 光球，右鍵不得隱藏。
2. 它遵守第 1 節的光球規則：未按修飾鍵必須穿透，按住先至可以點。閒置視覺透明度係 .55（唔係全域靜止透明度 .18）。靜止時有一圈唔郁嘅刻度環，用 `::before`，`inset: -3px`，`repeating-conic-gradient(rgba(97,97,145,.45) 0 2deg, transparent 2deg 30deg)`，再用 `radial-gradient(circle closest-side, …)` 只留外圍約 3px。遮罩不得用預設嘅 `farthest-corner`，否則環會落到圓外被剪走。光球狀態嘅殼 `overflow` 必須係 `visible`，`clip-path` 要向外讓到跑得過進行中陰影（`0 0 14px 4px`），唔好喺殼嘅上邊同右邊切成一直線。下次執行標籤指向畫面中心，等寬 10px、`#616191`、底 `rgba(248,248,252,.82)`、1px 框 `rgba(97,97,145,.35)`、圓角 2px、內距 2px 4px，而且 `pointer-events: none`。光球名稱標籤底色同樣係 `rgba(248,248,252,.82)`。
3. 有任何工作的 `state` 為 `running`、`running` 為 true、`fire_claim` 有內容，或 `latest_execution.status` 為 `running`／`claimed`（`state` 仍是 `scheduled` 也算）時，光球透明度係 1，核心係 `radial-gradient(#fff 0 30%, rgba(0,0,242,.35) 60%, transparent 75%)`，陰影 `0 0 14px 4px rgba(0,0,242,.35)`，而且呢圈光要畫到光球外面，不得被殼或光球盒裁成直線。外圈 2px 進度弧用 `::after` 的 `conic-gradient(#0000f2 calc(var(--p)*1turn), rgba(0,0,242,.12) 0)`，遮罩同樣用 `circle closest-side`。腳本每次 tick 更新 `--p`，弧本身唔好加動畫。標籤變成「行緊 00:42」，顏色 `#0000f2`。經過時間由 `latest_execution.started_at` 計；未有開始時間就用 `latest_execution.claimed_at`，再沒有先用 fire claim 的時間。進行中每一秒都要更新標籤，不得停喺「行緊 00:00」。計唔到進度先加 `.is-running`：90° 弧、2.4s 線性旋轉，完成就拎走呢個 class。完成時播一次 400ms 擴散環。失敗係靜止 `#e5484d` 弧。閒置零動畫。輪詢約每 5 秒一次；若一個短過輪詢間隔嘅工作喺窗內結束，而光球未見過佢行緊，就播一次完成環，唔好停喺旋轉。每次輪詢都要重畫進行中樣式。
4. 打開後是一欄面板（尺寸見第 2.4 條），用第 2 節的變形，四角必須有 HUD 角標。角標同其他面板一樣：8px、1px、`rgba(0,0,242,.4)`，放喺框外 `-3px`，必須畫出嚟，不得被 `clip-path` 或 `overflow` 裁走。格線大約 .06 透明度。卡片底 `rgba(255,255,255,.78)`、1px `rgba(97,97,145,.25)`、圓角 3px、內距 8px 10px、間距 4px。名稱 13px 字重 600、顏色 `#10102a`。cron 表達式同時間等寬 11px `#616191`。「停用」係細標籤（1px `#616191`、圓角 2px、10px）；啟用用 `#0000f2`。每張卡右邊有靜止狀態點，直徑 6px：啟用實心 `#0000f2`，停用空心 `#616191`。進行中係 12px 進度弧。列出每個已顯示 profile 的排程，按 Bot 分組。沒有工作的 profile 也要列出。
5. 資料來自該 profile 的 gateway `GET {root}/api/jobs?include_disabled=true`（Bearer 金鑰）。`default` 的 `{root}` 是 gateway 本身；其他 profile 是 `{gateway}/p/<profile>`。`/api/jobs` 回 404 時才可以再試 `GET {root}/api/crons`。不得改呼叫 dashboard 的 `/api/cron/jobs`。HTTP 404（兩條都沒有）或 501 顯示「呢個 Bot 未有排程。」，不得虛構工作。每列顯示名稱、schedule、啟用或停用、下次執行、以及進行中或上次執行。時間用 24 小時 `HH:MM`；跨日則 `YYYY-MM-DD HH:MM`。上次執行取 `last_run_at`，否則 `last_run`，否則 `latest_execution.finished_at`，否則 `started_at`。
6. 第一版只供查看，不得在 overlay 開關工作。提示必須是「只供查看。開關留喺 Hermes。」「未有排程」用 `#616191`。
7. 完全沒有 profile 時顯示「未有排程工作。」某個已顯示 profile 的工作列表是空的時，該組仍要出現，並顯示「未有排程」，不得整組省略。該 profile 沒有排程 API（HTTP 404 或 `cron_unavailable`）時顯示「呢個 Bot 未有排程。」連線失敗不得虛構工作。瀏覽器預覽可以顯示示範工作；已連接的 Hermes 不得。
8. 面板遵守第 1 節的面板規則。關閉按鈕有第 1.7 條的例外。
