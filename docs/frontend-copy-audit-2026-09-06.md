# 公開發布前文案檢查

檢查日期：2026-09-06。基準：`main`，`a2e99b4`。

已檢查現行路由、頁面模板、中英文訊息、瀏覽器動態文案、擴充功能介面，以及首頁使用的三張產品截圖。以下是原始碼與既有圖片的盤點，未登入線上帳號逐一觸發所有狀態，也未確認部署容器是否與此版本一致。以下各表保留實作前的盤點與行號；完成情況見下方「修正與驗證」。

「刪除」指移除畫面文案；「改寫」指保留必要資訊、改成使用者能理解的文字；「移位」指放到操作當下、說明連結或管理工具。P0 是與實際行為矛盾、容易造成錯誤理解；P1 是發布前應清理的權限規則、內部術語與開發文案；P2 是用語及資訊層級的改善。

## 修正與驗證

2026-09-06：已依確認的修改方向完成前端文案整理，並在對應程式加上原因註解。

- 移除配對與 Blend 的完整權限附註、解鎖框與重複狀態說明；方法與公式改放摺疊說明。
- 改寫資料不足、處理進度、登入及匯入錯誤；一般介面不再直接顯示版本、批次、品質門檻或原始錯誤。
- 修正公開預設與資料處理說明；分享、撤回、刪除及憑證重設的實際後果保留於操作旁。
- 補齊興趣選擇與動態訊息的中英文；興趣取消提醒會點名受影響的主題，API 類別值維持原樣。
- 統一設定、連線與觀看統計用語，將手動安裝步驟移至進階說明，清除失去用途的訊息與參數。
- 三張首頁 PNG 已以目前介面重新擷取，使用明確標示的合成範例資料；修正手機版英文操作列造成的水平溢出。

驗證使用臨時記憶體資料庫。`npm run check` 通過：360 項測試通過，1 項 Node/Python 外部計算服務整合測試因未設定服務網址而略過。JavaScript 語法與 `git diff --check` 通過。另以 Playwright 檢查中英文興趣編輯、取消選取後的主題刪除提醒及儲存、390px 手機版，以及總覽／頻道／Blend 展示圖。沒有使用真實使用者資料作測試素材，也尚未部署或驗證線上容器。

## 分號呈現複查

2026-09-06：檢查中英文固定文案、模板與動態訊息，修正 9 個前端檔案中的分號長句，涵蓋設定、隱私、匯入教學、圖表說明、處理狀態、好友邀請、擴充功能與管理頁提示。

- 狀態與操作拆成短句，例如「操作未完成，請稍後重試。若持續失敗，請重新連接擴充功能。」
- 數據範圍與限制各自成句，例如「依近 90 天的觀看內容計算。分數不隨下方比較範圍改變。」
- 影片查詢進度與待更新頻道數使用獨立段落，避免把不同單位串在同一行。
- 計算說明改為依序交代校正、公式與缺資料處理。必要的分享和刪除後果維持完整。

只調整介面文字與段落。JavaScript／CSS 語法、HTML entity、HTTP 標頭與使用者內容中的分號不作字元替換。後端配對理由仍有分號，但目前成員卡與 client 並未輸出該理由欄位，不列為現行可見文案。首頁現有三張展示圖未顯示本次修改的句子，無須重新擷取。

本次複查後 `npm run check` 通過，360 項測試通過、1 項略過。另確認中英文靜態訊息，以及待更新頻道數為零／非零時的段落輸出。尚未部署。

## 整合提交檢查

提交時同步整合遠端 `main` 的 `c295ef5`，保留新總覽順序、扁平版面、每日／每週時間軸及 Google 頭貼取得流程。隱私文案已改為如實說明基本個人資料授權與 Google 頭貼查詢，不再保留舊版「不額外要求個人資料權限」敘述。

異常關鍵詞只在畫面上過濾，來源與配對資料保留。補充驗證涵蓋全形／半形冒號及等號、分類同名詞、大小寫及空白、正常子字串與符號、顯示數量及字級計算，以及過濾後空狀態。整合後 `npm run check` 為 365 項通過、1 項略過，發布 manifest 檢查通過。

## 一、全站與首頁

| 編號 | 優先 | 位置與原文 | 問題與建議 |
| --- | --- | --- | --- |
| A01 | P1 | 全站頁尾：`footer`，「自架於 … · 觀看紀錄絕不外流」。[i18n.ts](/Users/jacoblincool/Documents/GitHub/urtube.observe.tw/src/output/i18n.ts:602)，[頁尾輸出](/Users/jacoblincool/Documents/GitHub/urtube.observe.tw/src/output/pages.ts:220) | 部署方式不是一般使用者的任務；「絕不外流」也是過度絕對的承諾，且站內確有分享部分觀看相關資訊的功能。改為品牌名稱與隱私權連結，具體資料處理放隱私頁。 |
| A02 | P0 | 私人洞察徽章：「預設私密」。[i18n.ts](/Users/jacoblincool/Documents/GitHub/urtube.observe.tw/src/output/i18n.ts:619)，[輸出條件](/Users/jacoblincool/Documents/GitHub/urtube.observe.tw/src/output/youtube.ts:857) | 目前只在私人洞察條件下顯示，但它宣稱的是「預設」，與新帳號預設公開不符；私人頁也可能向好友開放。刪除徽章，不應替換成「僅自己可見」。 |
| A03 | P0 | 首頁開始流程：「先建立你的私人檔案」「看見興趣，再決定要不要參與配對」；信任文案：「可保持私人」。[landing.ts](/Users/jacoblincool/Documents/GitHub/urtube.observe.tw/src/output/landing.ts:118) | 容易讓人以為分享與配對要稍後主動開啟。改為「建立你的興趣檔案」「查看興趣，調整分享設定」。實際預設值在分享設定步驟清楚交代。這是修正文案，不是改變預設。 |
| A04 | P1 | 首頁統計說明：「頻道以 YouTube ID 去重」「統計最多快取 5 分鐘」「退出下一次頁面統計」。[landing.ts](/Users/jacoblincool/Documents/GitHub/urtube.observe.tw/src/output/landing.ts:36) | 已在摺疊說明中，但仍像查詢與快取規格。保留「近 90 天、公開成員、依已匯入紀錄、觀看時間為估計值」；刪除 ID 去重與快取機制。若需說明更新延遲，用「設定變更後，統計可能稍後更新」。 |
| A05 | P1 | 首頁頁底：「以既有 Infovore 的 YouTube 紀錄模組為基礎…開源範圍與實作限制詳見 README。」[landing.ts](/Users/jacoblincool/Documents/GitHub/urtube.observe.tw/src/output/landing.ts:39) | 專案沿革、提交說明和實作限制不適合產品首頁。移至專案文件／關於頁；保留原始碼入口。若有必要授權署名，保留適當署名而非整段開發說明。 |
| A06 | P2 | 首頁圖說：「都是實際操作畫面。點圖即可進入對應頁面；配對需先登入。」[landing.ts](/Users/jacoblincool/Documents/GitHub/urtube.observe.tw/src/output/landing.ts:107) | 像展示驗收附註。簡化為功能描述；需登入的預告可以保留在配對入口旁，不必用整段解釋圖片操作。 |
| A07 | P1 | 首頁圖片內仍有「取消互相認識」「雙方都已選擇想認識」「已解鎖更多共同興趣」、幾何平均排序說明；儀表板圖片仍有中繼資料／進度涵蓋率附註。[配對截圖](/Users/jacoblincool/Documents/GitHub/urtube.observe.tw/public/landing/matching.png)，[儀表板截圖](/Users/jacoblincool/Documents/GitHub/urtube.observe.tw/public/landing/dashboard.png)，[頻道截圖](/Users/jacoblincool/Documents/GitHub/urtube.observe.tw/public/landing/channel.png) | 修改模板不會改掉圖片裡的文字。發布前需以完成文案整理後的畫面更新圖片；頻道圖片另有舊導覽「帳號」，應一併與目前「設定」統一。 |

## 二、配對、Blend 與成員頁

| 編號 | 優先 | 位置與原文 | 問題與建議 |
| --- | --- | --- | --- |
| B01 | P1 | `/matches`：「私密配對」「以下建議只使用有範圍限制的近期聚合資料，以及你選擇的配對興趣」「公開成員可直接進行 Blend；私人帳號先加好友…」。`matchesEyebrow / matchesPara / matchesPrivacy`。[i18n.ts](/Users/jacoblincool/Documents/GitHub/urtube.observe.tw/src/output/i18n.ts:803)，[輸出](/Users/jacoblincool/Documents/GitHub/urtube.observe.tw/src/output/matches.ts:406) | 頁首堆疊資料管線與權限說明。「私密配對」也容易與具名成員及公開 Blend 混淆。刪除權限段落，介紹改為「從共同興趣，找到和你合拍的人。」 |
| B02 | P1 | Blend 頁底：使用者指出的完整段落。`matchesProfilePrivacy`。[i18n.ts](/Users/jacoblincool/Documents/GitHub/urtube.observe.tw/src/output/i18n.ts:830)，[輸出](/Users/jacoblincool/Documents/GitHub/urtube.observe.tw/src/output/matches.ts:337) | **整段移除，不需要替代文案。** 權限由可見內容與操作呈現；分享設定才需要解釋分享對象。 |
| B03 | P1 | Blend 操作列下方：「這位成員已公開頁面…不需要好友邀請」「你們已成為好友，任何一方都可以隨時取消好友關係」。`matchesPublicBlendNote / matchesConsentConnectedNote`。[i18n.ts](/Users/jacoblincool/Documents/GitHub/urtube.observe.tw/src/output/i18n.ts:887)，[狀態選擇](/Users/jacoblincool/Documents/GitHub/urtube.observe.tw/src/output/matches.ts:313) | 已能進入 Blend／已有好友操作，無須重述狀態機。刪除段落；「已送出好友邀請」等實際操作回饋仍保留。 |
| B04 | P1 | Blend 綠色框：「已解鎖更多共同興趣」「這份 Blend 包含觀看統計、共同頻道與影片及各自排名，以及首次與最後觀看日期。」`matchesUnlockedTitle / matchesUnlockedPara`。[i18n.ts](/Users/jacoblincool/Documents/GitHub/urtube.observe.tw/src/output/i18n.ts:825)，[輸出](/Users/jacoblincool/Documents/GitHub/urtube.observe.tw/src/output/matches.ts:318) | 把功能清單與解鎖狀態再講一次，而且公開成員不經好友解鎖。整個說明框可刪，直接顯示比較內容。 |
| B05 | P1 | Blend：「百分比拆解」下的 cosine、校正曲線、`1 − e^(−25·cos)`、維度不可用時的處理，以及版本字串。`matchesFormulaNote / matchesFormulaVersion`。[i18n.ts](/Users/jacoblincool/Documents/GitHub/urtube.observe.tw/src/output/i18n.ts:828)，[輸出](/Users/jacoblincool/Documents/GitHub/urtube.observe.tw/src/output/matches.ts:334) | 可保留主題／頻道相似度，但公式、版本及缺少維度時的規則應移到計算說明。簡短入口可叫「分數如何計算」。保留真正的資料範圍，不能把舊 Blend 分數誤稱為新版類別分數。 |
| B06 | P1 | Blend：「清單依『兩人都常看』排序（各自佔比的幾何平均），所以你和對方看到的是同一份清單，只是左右對調。」`matchesBlendNote`。[i18n.ts](/Users/jacoblincool/Documents/GitHub/urtube.observe.tw/src/output/i18n.ts:848) | 刪除幾何平均與左右對調。需要排序說明時只保留「依兩人共同喜愛的程度排序」。 |
| B07 | P1 | 成員卡／Blend：「雙方允許的共同頻道」「目前沒有更多雙方允許顯示的概括興趣」。`matchesSharedChannel / matchesNoProfileTopics`。[i18n.ts](/Users/jacoblincool/Documents/GitHub/urtube.observe.tw/src/output/i18n.ts:808)，[空值輸出](/Users/jacoblincool/Documents/GitHub/urtube.observe.tw/src/output/matches.ts:307) | 「允許顯示」洩露呈現規則，且沒有更多內容不必變成公告。標籤改「共同頻道」；興趣空值可省略區塊，必要時用「暫無興趣資料」。 |
| B08 | P1 | 私人成員頁：「與對方成為好友後，就能查看總覽與洞察並進行 Blend。」`memberProfilePrivate`。[member-profile.ts](/Users/jacoblincool/Documents/GitHub/urtube.observe.tw/src/output/member-profile.ts:22) | 在無法查看內容時有引導價值，但無須列權限矩陣。改「加好友，認識更多共同興趣。」與加好友按鈕相鄰。 |
| B09 | P1 | 配對空狀態：「不會降低活動量或覆蓋門檻來硬湊配對」「目前沒有合格候選人」「符合主動加入與資料品質門檻；配對池成長期間…」。`matchesPendingPara / matchesEmptyTitle / matchesEmptyPara / matchesOptInPara`。[i18n.ts](/Users/jacoblincool/Documents/GitHub/urtube.observe.tw/src/output/i18n.ts:956) | 品質政策與「合格候選人」不適合交友介面，部分參與敘述也沿用舊流程。按實際狀態改為「正在整理你的觀看紀錄」「目前還沒有配對建議」「開啟好友探索，認識合拍的人」。只在確實處理中時說「正在」。 |
| B10 | P2 | 「你的同溫層最近常看」說明：「概括方向」「群體訊號」「不能用來推測任何一個人」；分頁：「候選批次」「第 N 批」。[i18n.ts](/Users/jacoblincool/Documents/GitHub/urtube.observe.tw/src/output/i18n.ts:942) | 改「興趣相近的人最近常看」及「發現近期紀錄以外的新主題與頻道」。方法放說明；分頁改「上一頁／下一頁／第 N 頁」。 |
| B11 | P1 | 舊 `/compare`：「注意力結晶比較」「彙總頻道份額」「僅有彙總資料——不會揭露…」「待重算 · 目前僅使用頻道」「加入配對池」。[i18n.ts](/Users/jacoblincool/Documents/GitHub/urtube.observe.tw/src/output/i18n.ts:788)，[crystal.ts](/Users/jacoblincool/Documents/GitHub/urtube.observe.tw/src/output/crystal.ts:89) | 路由仍存在，不能只查 `/matches`。改為觀看興趣比較；缺少主題分數用「主題資料尚未齊全」。功能是否整併另議，本次不改路由。 |
| B12 | P0 | 舊 `/compare`：「只有 A 在看——B 還沒看過這些」。`onlyList`。[i18n.ts](/Users/jacoblincool/Documents/GitHub/urtube.observe.tw/src/output/i18n.ts:801) | 資料只能證明本次比較紀錄中沒有，不足以判定對方從未看過。改「只出現在 A 近期紀錄中的內容」。 |

## 三、興趣選擇與主題配對

| 編號 | 優先 | 位置與原文 | 問題與建議 |
| --- | --- | --- | --- |
| C01 | P1 | 興趣編輯視窗：「選取並儲存，即同意…代表 tag、權重及詳細配對理由僅向好友或在頁面公開時顯示…」。[page.ts](/Users/jacoblincool/Documents/GitHub/urtube.observe.tw/src/matching-v3/page.ts:9) | 把資料結構、分享條件與操作後果混成長段落。刪除 tag／權重／權限矩陣；主文改「選擇想用來尋找合拍朋友的興趣。」必要的分享資訊用精簡說明連結承接。 |
| C02 | P1 | 同視窗：「Politic 表示觀看內容主題，不代表政治立場」「取消類別會從主題中移除，沒有剩餘類別的主題也會刪除」。[page.ts](/Users/jacoblincool/Documents/GitHub/urtube.observe.tw/src/matching-v3/page.ts:9) | 第一項應放「政治」選項旁，用「依觀看內容分類，不代表個人立場」。第二項是會影響既有主題的必要提醒，應保留於取消選取時，最好點名受影響的主題，不能當雜訊刪掉。 |
| C03 | P1 | 選取計數：「取消全部可撤回新版類別授權」「至少 1 個，最多全部 9 個」。[client.js](/Users/jacoblincool/Documents/GitHub/urtube.observe.tw/src/matching-v3/client.js:141) | 刪「新版」「授權」等版本語言；平時只顯示「已選 N 項」。零選取時說明「取消所有興趣後，將停止這些主題的配對」，並保留主題刪除後果。 |
| C04 | P1 | 選項、主題卡副標與 chips 直接顯示 `Politic / Sport / Video gaming / channel type`。[client.js](/Users/jacoblincool/Documents/GitHub/urtube.observe.tw/src/matching-v3/client.js:46) | 這些是內部 enum，英文也有不自然的命名。只在顯示層映射政治、運動、遊戲、其他類別等名稱，API 值保持不變。 |
| C05 | P0 | 空結果：「還沒有同意參與這些類別、且已完成輪廓處理的使用者」。[client.js](/Users/jacoblincool/Documents/GitHub/urtube.observe.tw/src/matching-v3/client.js:99) | 空結果被解讀為其他人的同意／處理狀態，既冗長，也不宜從單一空清單推定具體原因。改「這個主題目前還沒有配對結果，試試其他興趣組合。」 |
| C06 | P1 | 錯誤：「興趣輪廓尚未建立，請等待背景處理完成」「輪廓剛更新，請重新配對」「HTTP N」。[client.js](/Users/jacoblincool/Documents/GitHub/urtube.observe.tw/src/matching-v3/client.js:20) | 用「興趣分析尚未完成」「興趣資料已更新，請再試一次」；HTTP 留診斷用途，畫面保留重試與登入引導。不要把尚未排程說成正在處理。 |
| C07 | P1 | 英文模式下，編輯視窗的名稱、同意文字、取消／儲存及大部分 client 動態文字仍固定中文；「我的帳號」又與導覽「設定」不一致。[page.ts](/Users/jacoblincool/Documents/GitHub/urtube.observe.tw/src/matching-v3/page.ts:9)，[client.js](/Users/jacoblincool/Documents/GitHub/urtube.observe.tw/src/matching-v3/client.js:34) | 補齊中英文訊息，不只改 i18n.ts。統一入口名稱為「設定」。 |

## 四、總覽、洞察與頻道分類

| 編號 | 優先 | 位置與原文 | 問題與建議 |
| --- | --- | --- | --- |
| D01 | P1 | 總覽數字下方：「中繼資料涵蓋率 N% · 進度涵蓋率 N% · 估計值綜合實測秒數、儲存進度與影片長度」。`heroFoot`。[i18n.ts](/Users/jacoblincool/Documents/GitHub/urtube.observe.tw/src/output/i18n.ts:646) | 主要卡片不應是資料品質報告。保留「估計觀看時間」，方法放「時間如何估算」說明；覆蓋率移到處理明細。 |
| D02 | P1 | 穩定主題：「已處理 N% · 有效 N% · Unknown N%」「有效覆蓋未達 80%，暫不顯示主題排名」。[youtube.ts](/Users/jacoblincool/Documents/GitHub/urtube.observe.tw/src/output/youtube.ts:790) | 內部品質指標直接上主畫面。改「主題資料尚未齊全，暫時無法顯示排名」。若保留指標則放詳細說明，Unknown 改「未分類」。 |
| D03 | P1 | 觀看節奏空狀態：「日期回填」「12:00 是佔位值」「多於 N 筆精確時間紀錄」「避免呈現假的結果」。`rhythmUnavailable / rhythmPartial`。[i18n.ts](/Users/jacoblincool/Documents/GitHub/urtube.observe.tw/src/output/i18n.ts:654) | 資料清理過程與防衛語氣太重。改「部分紀錄只有日期，暫時無法分析一天中的觀看時段。」部分可用時簡述「僅使用有完整觀看時間的紀錄」。Takeout 引導可保留。 |
| D04 | P1 | 主題動態：「跨月只串接目前 taxonomy，缺少目前版本分類的月份會維持暫定」。`topicTrendTaxonomyNote`。[i18n.ts](/Users/jacoblincool/Documents/GitHub/urtube.observe.tw/src/output/i18n.ts:699)，[輸出](/Users/jacoblincool/Documents/GitHub/urtube.observe.tw/src/output/topic-trend.ts:227) | 移除版本管線說明；必要時用「部分月份的主題資料尚未齊全」。 |
| D05 | P2 | 主題圖：「依頁面範圍 · 平滑觀看占比」「原始或平滑占比」「日期回填每筆估計上限 10 分鐘」；頻道動能：「時間加權熱度 · 半衰期 N 天」。[i18n.ts](/Users/jacoblincool/Documents/GitHub/urtube.observe.tw/src/output/i18n.ts:684) | 指標本身可以存在，但演算法參數移入圖表說明。標題／控制用「觀看占比」「趨勢」「近期常看」等可理解名稱。保留資料範圍、估計值與比較基準。 |
| D06 | P1 | 洞察的 `?shorts=stacked/dual/compare/heatmap`：「方案 A」「方案 A2」「方案 B」「方案 C」。[youtube.ts](/Users/jacoblincool/Documents/GitHub/urtube.observe.tw/src/output/youtube.ts:278)，[路由接受參數](/Users/jacoblincool/Documents/GitHub/urtube.observe.tw/src/index.ts:392) | 預設頁不會出現，但可由 URL 開啟，是仍可到達的設計評選文案。刪除方案編號，只留圖表名稱；本次不改功能或路由。 |
| D07 | P1 | 興趣分析：「已建立 N 個興趣群」「尚未建立」「興趣分析目前尚未啟用」「文字大小依不同影片中的標籤次數呈現。此標籤雲僅自己可見。」[v3-dashboard.ts](/Users/jacoblincool/Documents/GitHub/urtube.observe.tw/src/output/v3-dashboard.ts:17) | 分群數是模型結構，不是興趣內容；部署開關和可見性也不必常駐。改為內容摘要或簡短空狀態，刪「僅自己可見」附註。詞雲大小的解釋可以移到說明。保留「最近 N 部影片」與不受日期篩選影響的必要範圍提示，縮成一行。 |
| D08 | P1 | 關鍵字：「僅使用公開中繼資料 · 取樣 N／N 部影片」；工具提示：「標題 N · 標籤 N · 說明 N」。[i18n.ts](/Users/jacoblincool/Documents/GitHub/urtube.observe.tw/src/output/i18n.ts:742)，[youtube.ts](/Users/jacoblincool/Documents/GitHub/urtube.observe.tw/src/output/youtube.ts:800) | 中繼資料來源計數像分析除錯。主文改「觀看內容中常出現的詞」；若為抽樣，保留抽樣範圍於說明，工具提示優先顯示相關影片／頻道數。 |
| D09 | P2 | 觀看時間方法：「依 YouTube 標記辨識，包含首播，無法判定觀看當時是否正在直播。舊資料會陸續補齊辨識。」[youtube.ts](/Users/jacoblincool/Documents/GitHub/urtube.observe.tw/src/output/youtube.ts:219) | 保留「短影音為推估」「直播／回放」的解讀限制，移除舊資料維護說明。不要直接把推估短片全部宣稱為 Shorts。回顧中的 Shorts 文案也應一致。 |
| D10 | P1 | 頻道分類：「受治理的頻道標籤」「政策 … · 清單 … · 來源時間 … · 抓取時間 …」。[i18n.ts](/Users/jacoblincool/Documents/GitHub/urtube.observe.tw/src/output/i18n.ts:1130)，[taglean.ts](/Users/jacoblincool/Documents/GitHub/urtube.observe.tw/src/output/taglean.ts:215) | 「受治理」是內部管理用語；多個版本／時間欄位不適合一般圖表頁。改「頻道分類」，來源列保留來源名稱、更新日期與定義／回報連結，版本資訊移到方法文件。 |
| D11 | P2 | 頻道分類／設定：「本站參考母體」「匿名參考母體」「聚合比例」「每人等權」「版本 … · 方法 …」。[i18n.ts](/Users/jacoblincool/Documents/GitHub/urtube.observe.tw/src/output/i18n.ts:1160)，[設定](/Users/jacoblincool/Documents/GitHub/urtube.observe.tw/src/output/i18n.ts:1093) | 可改稱「社群參考」／「參與匿名統計」。保留自願參與、樣本不足、不代表整體社會及分類不代表個人政治立場；方法版本與詳細統計規則移到說明。 |
| D12 | P2 | 頻道：「YouTube 公開的訂閱人數向下取至三位有效數字」「成員排行是互惠的：加入配對才能看到…」「所有加入配對的成員合計」。[i18n.ts](/Users/jacoblincool/Documents/GitHub/urtube.observe.tw/src/output/i18n.ts:903) | 訂閱數旁的約數符號已可傳達概略值，捨入規格移到說明。「互惠」改為可執行引導「開啟好友探索，看看還有誰喜歡這個頻道」。統計範圍不能刪掉造成全體成員的誤解，可簡稱「參與探索的成員」。 |

## 五、資料處理面板

這是最密集的一區。本人頁面的處理面板不等於管理後台；一般使用者需要知道完成程度、是否遇到問題、接著能做什麼。

| 編號 | 優先 | 位置與原文 | 問題與建議 |
| --- | --- | --- | --- |
| E01 | P1 | 「v3 興趣分析…」「v3 興趣分類」「v3 標籤向量」「v3 頻道分析」「v3 工作明細」。[v3-processing.ts](/Users/jacoblincool/Documents/GitHub/urtube.observe.tw/src/output/v3-processing.ts:29)，[processing-monitor.ts](/Users/jacoblincool/Documents/GitHub/urtube.observe.tw/src/output/processing-monitor.ts:33) | 刪除版本號與向量術語；一般進度以影片資訊、興趣分析等使用者能辨識的階段表達。 |
| E02 | P1 | 「此部署未啟用…」「等待背景服務」「背景服務閒置時約每 5 分鐘檢查新工作」「預定重試」「每 30 秒更新」。[v3-processing.ts](/Users/jacoblincool/Documents/GitHub/urtube.observe.tw/src/output/v3-processing.ts:50)，[processing-monitor.ts](/Users/jacoblincool/Documents/GitHub/urtube.observe.tw/src/output/processing-monitor.ts:68) | 移除部署與輪詢規格；用「等待處理」「稍後重試」「更新於…」。服務沒啟用時不能假裝正在排隊，應明確顯示暫不可用。 |
| E03 | P1 | 「沒有獨立的 AI 排程」「至少需要 24 部…98%」「未通過品質門檻」「下一輪背景工作自動啟用」「保留既有版本」。[processing-monitor.ts](/Users/jacoblincool/Documents/GitHub/urtube.observe.tw/src/output/processing-monitor.ts:40) | 整組是處理管線規格。保留使用者可處理的資料不足／暫不可用結果，將門檻、啟用與版本保留細節留在管理或技術文件。 |
| E04 | P1 | 「向量數量是目前批次／類別的 tags，不是全帳號進度」「不以來源影片數冒充頻道完成率」「失敗不代表工作仍在背景執行」。[processing-monitor.ts](/Users/jacoblincool/Documents/GitHub/urtube.observe.tw/src/output/processing-monitor.ts:46) | 這些是實作驗收與防錯解釋，不應作使用說明。直接顯示有意義、真實的進度；無法計算百分比的階段就顯示狀態，失敗顯示「分析暫停，已完成的結果仍可查看」。 |
| E05 | P1 | 「失敗次數」「最近錯誤：`job.error`」「已儲存輪廓」「目前版本／舊版本」「尚無階段進度回報」。[processing-monitor.ts](/Users/jacoblincool/Documents/GitHub/urtube.observe.tw/src/output/processing-monitor.ts:98) | 正常帳號可展開看到原始工作錯誤，不是只有管理員可見。保留簡短失敗通知、已完成結果及必要時間資訊；原始錯誤與嘗試次數移出一般頁。 |
| E06 | P1 | 設定的「顯示處理狀態」說明：「關閉後進入簡潔模式，所有頁面隱藏背景處理提示與進度；背景工作仍會繼續。此偏好在目前瀏覽器依帳號儲存。」[processing-visibility.ts](/Users/jacoblincool/Documents/GitHub/urtube.observe.tw/src/output/processing-visibility.ts:51) | 一個顯示開關不必引入另一個「簡潔模式」概念，也不必解釋儲存機制。縮成「在頁面上顯示資料整理進度。」無法保存偏好時的實際錯誤通知可保留。 |

## 六、登入、引導設定與帳號設定

| 編號 | 優先 | 位置與原文 | 問題與建議 |
| --- | --- | --- | --- |
| F01 | P1 | Google 登入：「永久 ID、email…Google 登入 token 已提供時的頭貼網址——不會存取你的任何 Google 資料」。`signupStartPara`。[i18n.ts](/Users/jacoblincool/Documents/GitHub/urtube.observe.tw/src/output/i18n.ts:1002) | 一般登入頁不需描述 token 欄位，且剛說會儲存 email 又說不存取任何 Google 資料容易自相矛盾。改「使用 Google 帳號登入或建立 urtube 帳號。」資料用途連到隱私說明。 |
| F02 | P1 | 建立代號步驟：`signupCompletePara` 又列一次公開總覽／洞察、配對開關與私人紀錄。另有「在 Google 登入上線前就有帳號了？」。[i18n.ts](/Users/jacoblincool/Documents/GitHub/urtube.observe.tw/src/output/i18n.ts:1004) | 代號步驟保留登入身分與網址用途。分享預設在分享選擇步驟清楚呈現；舊帳號綁定若仍需保留，入口改「綁定既有帳號」，不述說產品上線歷史。本次不刪綁定行為。 |
| F03 | P2 | 註冊欄位：「代號（小寫字母、數字、連字號）」、placeholder `dad / Sky's Dad / skyhong.tw`。[onboarding.ts](/Users/jacoblincool/Documents/GitHub/urtube.observe.tw/src/output/onboarding.ts:79) | 說明漏掉實際允許的點號，也與個人檔案的「使用者 ID」不一致。統一使用者名稱／ID 用語，採中性的示例。 |
| F04 | P1 | 引導設定：「每一步都依目前保存的資料判斷」「不需要複製 token」「可靠配對所需的近期聚合資料」「不會為了湊出候選而降低品質門檻」「候選順序可能隨覆蓋率提升而改變」。[i18n.ts](/Users/jacoblincool/Documents/GitHub/urtube.observe.tw/src/output/i18n.ts:969) | 改為步驟目的與下一個動作，例如「隨時可以離開，下次繼續設定」「連接擴充功能，匯入觀看紀錄」「正在整理你的興趣」。資料不足時只說缺少近期紀錄，不講品質政策。 |
| F05 | P1 | 擴充功能授權：「這個頁面會直接與擴充功能對話」「把 endpoint、新的擷取 token 和你的 Google 帳號寫進擴充功能」。`esPara / esAuthorizePara`。[i18n.ts](/Users/jacoblincool/Documents/GitHub/urtube.observe.tw/src/output/i18n.ts:1017) | 改「連接後即可同步 YouTube 觀看紀錄。」保留登入帳號、連接按鈕、首次同步的結果；去掉設定寫入過程。 |
| F06 | P1 | 分享設定：「觀看紀錄與回顧需要你的登入帳號或儀表板 key」「一個開關，預設開啟。配對授權和儀表板公開彼此獨立」。`accountVisibilityPara / accountMatchingPara`。[i18n.ts](/Users/jacoblincool/Documents/GitHub/urtube.observe.tw/src/output/i18n.ts:1085) | **這裡需要分享對象資訊，但不需要實作規格。** 公開開關旁簡述「所有人可查看總覽與洞察，登入成員可與你進行 Blend」；好友探索旁說明可收到邀請。私人紀錄的額外金鑰存取移到進階金鑰說明，不能改成不實的「任何情況都只有本人可看」。 |
| F07 | P0 | 分享詳細說明：「儀表板仍依我自己的公開設定」「任何階段都不會顯示…聯絡資訊」。`accountMatchingFriends`。[i18n.ts](/Users/jacoblincool/Documents/GitHub/urtube.observe.tw/src/output/i18n.ts:1091) | 前者不足以表達好友也能看私人總覽／洞察；後者容易與個人檔案可顯示社群連結混淆。移除舊規則敘述；資料不分享的承諾應限定為系統不提供登入 email 等資料，另說明自填個人檔案可見內容。 |
| F08 | P1 | 進階設定：「重新產生 token」「舊的兩個 token」「capture token」「儀表板 key」。[i18n.ts](/Users/jacoblincool/Documents/GitHub/urtube.observe.tw/src/output/i18n.ts:1039) | 功能本身是進階用途，不能刪掉操作後果。改稱「重設連線憑證／擴充功能連線碼／私人存取金鑰」，清楚保留舊憑證立即失效、需要重新連接、只顯示一次的提示。 |
| F09 | P1 | 匯入／匯出：「日期回填」「公開 metadata、主題、聚合結果」「先加密再寫入資料庫」「未設定私人資料金鑰，目前無法匯出」「伺服器…背景抓取」。[i18n.ts](/Users/jacoblincool/Documents/GitHub/urtube.observe.tw/src/output/i18n.ts:1054) | 用「補齊歷史觀看時間」「包含觀看與搜尋紀錄、播放進度及興趣分析」等使用者語言。容量限制、檔案格式、重複匯入規則與私密檔案提醒保留；部署錯誤改「目前無法匯出資料，請稍後再試或聯絡我們」。 |
| F10 | P2 | 擴充功能安裝／更新段落預先詳細列出 ZIP、開發人員模式、未封裝項目、手動 token 更新；多處「popup」。[i18n.ts](/Users/jacoblincool/Documents/GitHub/urtube.observe.tw/src/output/i18n.ts:960)，[設定輸出](/Users/jacoblincool/Documents/GitHub/urtube.observe.tw/src/output/onboarding.ts:200) | 商店安裝作主流程，手動安裝／更新收進明確標示的進階說明。「popup」改「擴充功能視窗」。不移除仍有使用者需要的有效安裝路徑。 |
| F11 | P1 | 編輯個人檔案開頭：「沿用帳號目前的公開／私人設定，不會公開額外的觀看或搜尋紀錄」。ID 說明：「不可使用保留字」「同意保留舊網址轉址」。[profile.ts](/Users/jacoblincool/Documents/GitHub/urtube.observe.tw/src/output/profile.ts:17) | 開頭權限附註刪除；ID 格式保留，保留字在發生衝突時提示即可。改 ID 的必要後果可簡述「個人頁網址會改變，舊連結仍可使用」，不需讓使用者同意路由實作術語。社群連結錯誤也應避免一次傾倒 40／2048 字元與所有格式規格。 |

## 七、錯誤頁、隱私說明與擴充功能

| 編號 | 優先 | 位置與原文 | 問題與建議 |
| --- | --- | --- | --- |
| G01 | P1 | 登入／註冊／表單錯誤直出 `error.message`，或 `Missing OAuth code or state / Onboarding step is no longer available / Invalid sharing preferences / Unauthorized`。[index.ts](/Users/jacoblincool/Documents/GitHub/urtube.observe.tw/src/index.ts:602)，[註冊](/Users/jacoblincool/Documents/GitHub/urtube.observe.tw/src/index.ts:697)，[引導](/Users/jacoblincool/Documents/GitHub/urtube.observe.tw/src/index.ts:713) | 錯誤分支也是發布介面。應以本地化、可操作的訊息呈現，例如「登入未完成，請重新登入」「設定已更新，請重新整理」。保持原有狀態碼、認證與驗證行為；若需新增後端錯誤契約，另行討論。 |
| G02 | P1 | Takeout 解析錯誤會直接包進「Takeout 匯入失敗：…」；可能包含 `Archive contains no recognized… / exceeds uncompressed size limit` 等。[index.ts](/Users/jacoblincool/Documents/GitHub/urtube.observe.tw/src/index.ts:1265)，[takeout.ts](/Users/jacoblincool/Documents/GitHub/urtube.observe.tw/src/youtube/takeout.ts:358) | 在呈現邊界轉成「檔案中找不到 YouTube 觀看紀錄」「解壓縮後的檔案過大」等已知原因，未知錯誤顯示穩定的通用通知。保留詳情於診斷處，不讓例外原文成為產品文案。 |
| G03 | P2 | 404：「這個網址沒有東西。檢查一下連結，或回放映廳首頁。」[i18n.ts](/Users/jacoblincool/Documents/GitHub/urtube.observe.tw/src/output/i18n.ts:1113) | 「放映廳」是殘留產品用語，語氣也不夠明確。改「找不到這個頁面。請確認網址，或返回首頁。」 |
| G04 | P1 | 隱私頁：「behavioral matching」「data-driven」「登入 session」「儀表板 key」「AES-256-GCM」「SHA-256」「限制大小、類型與逾時」。[i18n.ts](/Users/jacoblincool/Documents/GitHub/urtube.observe.tw/src/output/i18n.ts:1100) | 隱私頁需要資料收集、分享與第三方服務資訊；不能當作一般附註整頁刪減。這裡是可讀性修訂：用行為／興趣配對、登入帳號、存取金鑰、加密等白話；保留 Gravatar、AI、搜尋紀錄及分享範圍等實質資訊，把代理與演算法參數移往技術說明。本項未作法律合規判定。 |
| G05 | P1 | 擴充功能：「擷取觀看工作階段」「擷取 endpoint」「擷取 token」「Token 和待送出的擷取資料只存在這個 Chrome 設定檔裡」。[i18n.js](/Users/jacoblincool/Documents/GitHub/urtube.observe.tw/chrome-extension/i18n.js:96) | 改「記錄觀看時間」「伺服器網址」「連線碼」。設定檔的儲存說明移至進階／隱私說明；保留同步會讀取觀看紀錄的必要告知。 |
| G06 | P1 | 擴充功能同步：「已驗證的歷史」「忽略既有覆蓋範圍」「N 段完成、N 段待處理」「已在安全上限保存 N 筆」。[i18n.js](/Users/jacoblincool/Documents/GitHub/urtube.observe.tw/chrome-extension/i18n.js:18)，[靜態說明](/Users/jacoblincool/Documents/GitHub/urtube.observe.tw/chrome-extension/i18n.js:96) | 改「同步新增紀錄」「重新檢查全部歷史紀錄」；進度以已匯入紀錄數為主。「安全上限」改「本次同步已完成，使用『重新掃描全部紀錄』匯入更早的紀錄」。不能暗示重新掃描會刪除既有資料。 |
| G07 | P1 | 擴充功能直接顯示 `Endpoint must be… / Capture token must contain at least 32 characters / Connection failed: HTTP…`；popup 與網站同步列也直出 `lastError`。[options.js](/Users/jacoblincool/Documents/GitHub/urtube.observe.tw/chrome-extension/options.js:30)，[popup.js](/Users/jacoblincool/Documents/GitHub/urtube.observe.tw/chrome-extension/popup.js:77)，[網站輸出](/Users/jacoblincool/Documents/GitHub/urtube.observe.tw/src/output/youtube.ts:729) | 統一翻譯為「連線設定不正確，請重新連接擴充功能」「連線失敗，請稍後重試」等。網站與擴充功能兩端都需處理，不能只改某個 HTML 模板。 |

## 不應誤刪的資訊

- 成功／失敗、同步中、已送出邀請、登入到期等實際操作回饋，以及按鈕名稱、工具提示和無障礙名稱。
- 在分享開關旁的分享對象、真實預設，以及關閉好友探索會撤銷邀請／好友關係的後果。可縮短與分段，不能隱藏。
- 取消興趣可能刪除既有主題、重設連線憑證使舊憑證失效、修改 ID 改變網址，以及匯出私人資料的提醒。
- 數字是估計值、資料範圍、抽樣／缺資料、短影音是推估、分類不代表政治立場、社群樣本不代表社會等理解結果必需的限制。詳細方法可以移位。
- 隱私頁中實際收集哪些資料、第三方用途、分享與刪除方式。刪內部術語不等於刪告知。

## 已核對、未當作現行主要畫面問題的殘留

- `src/output/i18n.ts` 中舊 `landingPara / landingPoints / signupPara` 含「每個帳號一個獨立資料庫」「不抽樣、不過期」等文字，但目前頁面未引用。屬後續死文案清理，不列為當前可見頁面。
- `matchesNoSharedTopics / matchesProvisional / memberProfileShared` 等訊息沒有現行引用；不能因搜尋命中就說使用者目前看得到。
- `matchesLockedTitle / matchesLockedPara / matchesLockedTopics / matchesShareMode / matchesConsentPendingNote` 仍有 renderer 分支，但現行 Blend 路由會先將未公開且非好友的請求導向成員頁，正常整合流程不會走鎖定比較。這批應隨未使用分支清理；若未來重新啟用，不能直接帶回舊權限文案。
- `/account/taxonomy` 已導向設定頁，舊審核模板不列為一般使用者可達頁。舊 POST 書籤仍可能得到「舊版主題審核已停用…v3 處理進度」的 410 文字，可在錯誤呈現整理時白話化。
- `/matching-v3/admin` 有管理員權限限制，適合保留版本、工作佇列、模型和錯誤細節。一般帳號的 `processing-monitor` 沒有同樣的管理員限制，所以不能一概排除。
- `frontend/match-preview` 是預覽素材，未找到在正式 Hono 路由中提供的入口，不列為現行產品頁。首頁 `public/landing/*.png` 有正式引用，已列入 A07。

## 建議修改順序與複查

1. 先處理 P0 的預設分享誤導、過度推定觀看行為與空狀態原因，再移除配對／Blend 頁面反覆的權限與解鎖說明。
2. 將一般處理面板改成使用者需要的進度與結果，清掉 v3、向量、排程、品質門檻與原始錯誤。
3. 整理登入、分享設定、興趣編輯與擴充功能連接，保留操作後果，清除技術過程描述。
4. 統一中英文、類別顯示名稱、設定入口與空狀態，最後更新首頁產品圖片。

實作後以合成資料或臨時資料庫複查：未登入、新帳號、本人、公開成員、私人成員、好友；無資料／分析中／失敗／完成；首次載入與 client 更新；中文／英文；進階摺疊內容與 `?shorts=` 變體；三張首頁圖片。此清單是後續驗收範圍，不代表本次已操作過這些線上狀態。
