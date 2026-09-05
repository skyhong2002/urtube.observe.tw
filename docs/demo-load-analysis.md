# Demo 負載研究：100 位使用者，每人 20,000 部歷史影片

研究日期：2026-09-06 · 程式基準：`85b5cec`

**結論：兩百萬筆歷史資料本身不是唯一問題；真正的壓力來自同一批資料被反覆掃描、tag 之間的平方距離運算，以及把大量小型配對計算串成同步等待。** 首次準備資料時，外部模型呼叫與 DBSCAN 最值得注意；demo 現場則應優先處理背景全站掃描、跨帳號冷讀，以及匹配頁的序列 RPC。只有 100 個帳號，尚不足以支持「必須換資料庫」或「必須採近似匹配」的結論。

本研究結合原始碼追蹤、官方文件與隔離的合成測試。耗時實測只涵蓋單帳號 SQLite／Repository 與部分數值資料表示；**沒有測試正式環境的 100 人並發、實際 DBSCAN、LP 求解或模型 API 吞吐量**。下列容量判斷因此是有證據的風險排序，並非正式環境效能保證。

## 情境與符號

| 符號 | 定義與本次代入值 |
| --- | --- |
| `U` | 帳號數，100；不等於同時送出請求的人數 |
| `V`、`W` | 每人不同影片數、觀看事件數；基準均為 20,000，若有重看則 `W ≥ V` |
| `S` | 每人搜尋事件數；合成測試設為 0，真實資料可能更多 |
| `L` | 實際投入 v3 的影片數，`min(V, backfillVideoLimit)` |
| `b` | 分類每批影片數；程式預設 5，允許最大 20 |
| `T_ug` | 使用者 `u` 在內容類別 `g` 的不同 tag 數；不能由影片數直接推出 |
| `d`、`G`、`K` | embedding 維度預設 768；8 個內容類別加 1 個 channel type；每類最多保留 10 群 |
| `D_video`、`T_global` | 全站尚未命中快取的不同影片分類鍵數、不同 tag embedding 鍵數 |
| `E`、`J` | 查詢範圍內事件數、join 後中間列數；多重分類可能使 `J > E` |

所有 MB／GB 使用十進位；容器的 1／2 GiB 為二進位。複雜度中的 B-tree 查找通常計 `O(log N)`，雜湊集合採期望攤銷 `O(1)`。公式描述工作量成長，不直接代表秒數。

有兩個部署前置條件必須確認：來源碼的 `MATCHING_V3_BACKFILL_VIDEO_LIMIT` 預設為 **2,000**，不代表 20,000 部都會建立 v3 表示；`MAX_USERS` 預設為 **25**，註冊路由會檢查此值。本文沒有查證運行中部署的有效設定，因此同時列出 `L=2,000` 與 `L=20,000`。已有帳號數、允許註冊數與真正納入匹配的影片數是不同指標。來源：[v3 設定](../src/matching-v3/model.ts)、[應用設定](../src/config.ts)、[註冊與頁面路由](../src/index.ts)。

## 壓力排序

| 階段 | 優先關注 | 壓力來源 | 主要症狀 |
| --- | --- | --- | --- |
| 首次準備資料 | 1. 分類與 embedding | 未命中快取數、輸入 token、外部吞吐量、重試 | 準備時間長，佇列／快取快速增長 |
| 首次及重新建立 profile | 2. DBSCAN | 每類不同 tag 數平方增長；一次性數值／JSON 記憶體 | CPU 飽和、超出記憶體或 10,000-tag 硬限制 |
| 匯入當下 | 3. 精確事件 placeholder 查找 | 新事件逐筆掃描既有活動 | 初次匯入後半段愈來愈慢 |
| 資料已準備完成 | 4. 背景重掃與每日重建 | 無新工作仍重建全站 source；日期改變觸發內容重分群 | 背景持續占用資源，白天重新排隊 |
| Demo 互動 | 5. 跨帳號聚合及序列匹配 | 冷讀同步 SQLite、重複 JSON／HTTP、單一 compare handler | 首次開頁慢、其他請求一起等待、尾延遲拉長 |

這是依階段排列的風險，不是宣稱五者在同一時間有固定耗時名次。實際最大瓶頸取決於快取命中率、`T_ug`、重看分布、實際並發與部署資源。

## 1. 首次全站分類與 embedding：主要是外部工作量

### 原因與複雜度

每部影片的標題、原始 tags 等資料參與分類；新分類結果只決定 genres，原始 tags 進入每個指派的內容類別。不同帳號間可共用成功快取，但不能將兩百萬筆帳號影片關聯直接視為兩百萬個全站不同影片。

令 `M_u` 為帳號 `u` 尚未命中分類快取的影片數。在無重試且批次滿載時：

`R_class ≤ Σ_u ceil(M_u / b)`；跨帳號成功去重後，`ceil(D_video / b)` 是理想下界。

實際有批次切分、重試縮批與並發時序，不能保證達到這個下界。CPU 端讀取／序列化亦要按 metadata 總 bytes 計費，而非將每部影片視為等長資料。

| 情境：完全冷快取、帳號間影片無重疊、無重試 | 納入的帳號影片數 | `b=5` 分類請求 | `b=20` 分類請求 |
| --- | ---: | ---: | ---: |
| 每人取最新 2,000 部 | 200,000 | 40,000 | 10,000 |
| 每人完整 20,000 部 | 2,000,000 | 400,000 | 100,000 |

embedding 每批最多 64 個 tag，但目前由影片分類批次引發 tag 暖快取，小批次可能未填滿：

`ceil(T_global / 64) ≤ R_embed ≤ T_global`，此處排除重試。

例如每部影片平均 10 個 tags，兩百萬個帳號影片關聯有兩千萬次 tag 出現。若全站不同 tag 數分別是出現次數的 1%、5%、10%，則為 20 萬、100 萬、200 萬個不同 tag，理想滿批 embedding 請求分別為 3,125、15,625、31,250。**這三個比例只是敏感度情境，不是真實資料統計。**

`T_global=1,000,000`、`d=768` 時，向量本體 float32 為 **3.072 GB**、float64 為 **6.144 GB**，尚未包含鍵、索引、JSON、物件與暫存複本。目前 JSON 表示可能明顯大於二進位向量；不能用純向量 bytes 充當 registry 的完整磁碟預算。

另有 channel type：每個缺少有效快取的頻道會取得 YouTube 頻道資料，有描述才進一步分類；成功分類有 30 天 TTL，缺證據結果較短。這些請求是影片分類之外的工作。若 legacy 個人分類 worker 仍需補齊 14 類分類，也有另一套準備成本，不能視為 v3 快取已一併完成它。

### 如何緩解

1. **先量測真正缺少的鍵數，再估完成時間。** 以成功吞吐量 `λ` 估算 `R/λ`，加入重試與尾端收斂；併發上限 `c` 只能在平均延遲 `ℓ`、供應商及本地資源都不限制時給出理想 `c/ℓ`。10,000 併發不代表 10,000 RPM，更不保證同量成功吞吐。
2. **保留成功快取與跨帳號 in-flight 去重。** 快取鍵需維持 metadata、模型、分類 namespace 與 embedding 設定的一致性；不要為了重排作業清空已完成結果。
3. **提高有效批次填充率。** `b=5 → 20` 在理想條件下減少 75% 分類 HTTP 次數與固定提示開銷，並不等於減少 75% 的影片內容 token 或費用。可共用待送 tag 集合，於一次排程機會填滿 embedding 批次；無須加入固定送出間隔。頻道資料可考慮利用 `channels.list` 的多 ID 介面。
4. **壓低每個進行中工作的記憶體。** 排隊項目保存鍵與狀態，到執行時才載入 payload；已完成批次及時釋放。向量改用二進位 float64 可保留現有 double 值；若用 float32 降容量，必須另驗證距離門檻與分群是否改變。

Gemini 限制按 project 而非 API key 計，多把同 project 的 key 不能直接倍增配額。保留 provider 的 429 cooldown／retry，GPT 與 Gemini 分開計算吞吐與佇列；本研究不把新增本地 RPM／每日上限當作容量解法。[Gemini rate limits](https://ai.google.dev/gemini-api/docs/rate-limits)、[embedding API](https://ai.google.dev/api/embeddings)、[YouTube channels.list](https://developers.google.com/youtube/v3/docs/channels/list)

程式依據：[pipeline](../src/matching-v3/pipeline.ts)、[provider](../src/matching-v3/provider.ts)、[store](../src/matching-v3/store.ts)。

## 2. DBSCAN：數值計算與記憶體的最大風險

### 原因與複雜度

內容類別使用 `DBSCAN(metric="cosine", algorithm="brute")`，tag 的權重是支援該 tag 的不同影片數。最後保留最多十群發生在分群之後，**不會將前段成本降成十個點的成本**。channel type 使用五維類別表示，不走這段 DBSCAN。

全站八個內容類別的距離主項：

`T_cluster = Θ(d × Σ_u Σ_{g=1..8} T_ug²)`。

單類別記憶體可用 `O(Td + hT + T q̄)` 描述向量、`h` 列距離 chunk 與平均 `q̄` 個鄰居；最壞為 `O(Td + T²)`，此外還有 JSON 字串、Python list／float、正規化副本與服務執行期。scikit-learn 說明鄰居批次求取與最壞平方記憶體；不能把 chunked distance 理解為整個 DBSCAN 都是線性記憶體。[DBSCAN 1.6 文件](https://scikit-learn.org/1.6/modules/generated/sklearn.cluster.DBSCAN.html)

| 每帳號、每內容類不同 tag 數 `T`，`d=768` | `T²d` 距離維度乘積 | float64 向量 | 完整 float64 距離矩陣等值大小 |
| --- | ---: | ---: | ---: |
| 2,000 | 30.72 億 | 12.288 MB | 32 MB |
| 5,000 | 192 億 | 30.720 MB | 200 MB |
| 10,000 | 768 億 | 61.440 MB | 800 MB |

右欄用來展示平方尺度，**不是宣稱實作必定同時配置一整張距離矩陣**；鄰居儲存與資料副本可能使峰值高於這個數，也可能因稀疏度而較低。維度乘積不是精確 FLOPs，更不是秒數。

若 100 人的八類都各有 5,000 tags，主項達 `100 × 8 × 5,000² × 768 = 15.36 × 10¹²`。這是條件式運算規模，不是假設每個帳號真的有此分布。

可用 `T = V × p_g × a × r_g` 做敏感度分析：`p_g` 為影片落在該類的比例、`a` 為平均 tags 數、`r_g` 為該類 tag 出現次數轉成不同 tag 數的比例。當 `V=20,000`、`p_g=25%`、`a=10`，該類有 50,000 次 tag 出現；`r_g=4%／10%／20%／40%` 對應 `T=2,000／5,000／10,000／20,000`。

**超過 10,000 個不同 tags 會失敗。** pipeline 在分類、embedding 與 points 準備之後才檢查，可能已完成大量外部工作才撞到限制。不能把它描述成只是稍微變慢，也不能不告知便截掉 tags。

Compose 的分群服務設為 2 GiB／2 CPU，compare 另有 1 GiB／1 CPU，兩者已分離。Python 服務使用單一 `HTTPServer`，且 Docker 設定 BLAS／OMP 為單執行緒；配置兩個 CPU 不代表每次分群自動使用兩核。來源：[compute.py](../services/matching-compute/compute.py)、[Dockerfile](../services/matching-compute/Dockerfile)、[Compose](../compose.matching-v3.yml)、[Python HTTP server](https://docs.python.org/3.12/library/http.server.html)。

### 如何緩解

1. **提早估算與檢查 tag 數。** 隨分類批次完成累積每類不同 tag 數，一旦超限就停止為該不可完成的 profile 增加不必要工作，保留已完成快取。目前分類回應會立即觸發 embedding；若要求在任何 embedding 之前做完整檢查，需改成先完成分類，並評估失去流水線重疊的時間成本。
2. **按類別輸入版本快取分群結果。** tag、影片支援數、向量版本與分群參數都沒改時直接重用。這比單純增加 CPU 更能消除不必要工作。
3. **精確的稀疏鄰居圖／分塊建圖。** 在鄰居稀疏時降低峰值記憶體，時間主項仍可為 `O(T²d)`；密集資料仍有平方鄰居量。必須測試零距離點、自身鄰居、sample weights、eps 邊界及 border point 次序，才可主張結果一致。
4. **根據實測峰值安排分群程序數與容器資源。** 不可將外部 API 併發上限直接套到重型數值工作。若更換為 ANN、PCA、K-means、抽樣或 top-tags，會改變語意或結果，應另做品質研究，不能當成等價優化。

## 3. 背景全站掃描與每日重建：完成後仍持續付出成本

### 原因與公式

`runCycle()` 一開始便對所有使用者執行 `matchingV3Source()` 再決定是否需排程。沒有新工作時，worker 預設等待 5 秒後重新進入 cycle。source 會對歷史事件做分組、最新時間與排序後才套用影片上限，再處理 metadata／tags／fingerprint。因此 `LIMIT 2000` 不會把歷史讀取成本變成固定 2,000 列。

每輪可概括為 `Σ_u Q_source(W_u, V_u) + O(來源 metadata bytes)`；對未利用完整排序索引的聚合，常見保守上界包含 `O(W log W)`。本次沒有將 SQLite planner 的所有情況宣稱為同一個緊確界。

令單輪掃描耗時 `S_scan = Σ_u t_source(u)`，在沒有待辦、沒有其他等待的穩定迴圈中：

`週期 = S_scan + 5 秒`；`掃描占迴圈牆鐘時間比例 = S_scan / (S_scan + 5)`。

| 每人都有 20,000 筆歷史 | 單帳號 source 合成實測中位數 | 相同成本線性外推 100 人一輪 | 掃描占迴圈時間 |
| --- | ---: | ---: | ---: |
| 輸出上限 2,000 部 | 24.856 ms | 2.486 秒 | 約 33.2% |
| 輸出上限 20,000 部 | 90.479 ms | 9.048 秒 | 約 64.4% |

這是單帳號記憶體測試的線性外推，**不是 100 人實測或 CPU 使用率預測**。但它直接說明「已經沒有分類待辦」並不等於 worker 接近零成本。worker 與 app 是不同程序，這段同步掃描先阻塞 worker 自己的事件迴圈，再透過共用 CPU／磁碟／registry 與 app 競爭資源。

首次成功作業還會在排程、開始處理、提交前驗證三個時點建立 source。更值得注意的是 `sourceKey` 納入 UTC 日期，而全九類預算包含 channel type；日期改變會重新排程，內容分類與 embedding 命中快取後，仍會再次建立八類內容分群。頻道分類的 30 天 TTL 並沒有阻止這段每日內容重算。

### 如何緩解

- **用可交易更新的來源 revision／dirty-user 清單代替內容重算式輪詢。** ingest、metadata 與相關設定變更時標記 dirty；無變更檢查降到約 `O(U)` 個輕量版本讀取，或只取 dirty 集合。保留待辦帳號立即可執行的行為，不靠固定送出間隔改善。
- **把內容 fingerprint 與頻道 TTL 分開。** 日期變更只刷新需更新的頻道資訊；未改變的內容 genre 直接重用。快取鍵涵蓋 tag counts、向量與演算法參數，以免把資料變更漏掉。
- **保留提交前一致性驗證，但驗證版本而非再載入全歷史。** 必須保證 revision 與修改在同一交易生效，不能用可能漏更新的時間戳捷徑。

程式依據：[worker](../src/matching-v3/worker.ts) 第 20–28 行、[pipeline](../src/matching-v3/pipeline.ts) 第 178–224 行、[store](../src/matching-v3/store.ts) 第 158–175 行、[source 查詢](../src/data/database.ts) 第 1582 行起。

## 4. Demo 的聚合頁面：冷快取與跨帳號扇出

### 原因與複雜度

個人事件存在各自的 SQLite 檔案。Dashboard、頻道與 Insights 會讀取／聚合事件；社群與參考母體還會逐帳號扇出。Node 使用 `DatabaseSync`，冷查詢與 JSON 工作會占用 app 的主事件迴圈；單純包成 `async`／`Promise.all` 不會讓同步 SQL 自動移出主執行緒。[Node 22 SQLite 文件](https://nodejs.org/download/release/v22.19.0/docs/api/sqlite.html)

對單帳號範圍查詢，可以用 `O(E log N + J log J)` 表示逐列 join 與可能排序的保守模型；已有適用索引時可以消掉部分排序。跨帳號為 `Σ_u Q_u`，若每人資料相近則約 `U × Q(W)`。有些頁面即使選 28 天，仍計算全歷史 race 等資料，不能一律用 28 天事件數代替 `W`。

第一次建立觀看秒數 TEMP 表亦有成本：

`T_est = O((W+S) log(W+S) + W log N + Σ_v u_v n_v)`，

其中 `n_v` 為同一影片觀看數，`u_v` 為其中沒有實際量測秒數的事件數。**本情境每部影片只看一次時，`Σ n_v² = 20,000`，不是 4 億。** 一般複雜度分析中的平方退化，不能直接當成這次 demo 的主要瓶頸。若另有大量同片重看，需要另按分布計算。

read cache 預設 5 分鐘、每個 Repository 128 項，以整個個人 DB revision 驗證；它按項數而非 bytes 限制。持續 ingest／metadata 更新可能使多種聚合一起失效；寫入獨立 v3 registry 則不等於所有個人 DB cache 都失效。Repository 連線與 TEMP 表也會隨讀取過的帳號累積，不可只看單次回應大小。

合成測試中，TEMP 已存在時，單帳號 overview 約 115 ms、all-time Insights Repository 計算約 419 ms；後者**還不含路由的全站參考母體與畫面輸出**。若 100 個帳號都需冷建 TEMP 與讀取全時段頻道總計，逐帳號成本線性外推約 `100 × (50.285 + 14.278) ms = 6.456 秒`。如果走需要重建完整 Crystal 的路徑，同樣外推約 `100 × (50.285 + 268.742) ms = 31.903 秒`。這兩個是不同路徑的條件式估算，不能相加當成每次頁面必付成本。

### 如何緩解

1. **預先保存每人每天／每頻道的統計，再合併摘要。** 全站頁面從讀兩百萬事件改成讀必要的摘要列；複雜度轉為 `O(摘要列數)`，不宣稱所有統計都能 O(1)。頻道單頁應查指定頻道所需資料，避免每次為所有成員建立完整頻道排名。
2. **使用相依性明確的版本與群體快取。** key 包含成員集合、資料版本、範圍與同意狀態；每次請求仍重新授權。不能以快取的分數或 HTML 代替授權。
3. **將冷重算移到背景／獨立執行環境，HTTP 讀已完成摘要。** 正常 ingest 的增量時間推估要考慮前一筆事件、同影片 metadata／progress 與 ±300 秒量測匹配；不能天真地只 append 新列而不修正受影響事件。
4. **Demo 前暖指定路徑，但不要只依賴暖快取。** 五分鐘到期、資料更新或另一個日期範圍都會重算；需同時驗證冷請求與背景作業共存。

SQLite WAL 容許讀寫並行，但每個 DB 同時仍只有一位 writer。100 個個人 DB 不是全站共同一個寫鎖；共享的 `users.sqlite` registry 才是 v3 jobs／快取／監控寫入的集中點。建議量測 lock wait、交易長度、checkpoint 與寫入量後再決定是否遷移資料庫。[SQLite WAL](https://www.sqlite.org/wal.html)

程式依據：[聚合與 TEMP 表](../src/data/database.ts)、[read cache](../src/data/read-cache.ts)、[跨帳號路由](../src/index.ts)、[Crystal](../src/youtube/crystal.ts)。

## 5. 匹配頁：小型 LP 被大量序列請求放大

### 原因與複雜度

每一對內容 profile 的 cluster 數 `n,m ≤ 10`。單類比較包含：

`O(nmd)` 餘弦 kernel，加 `O((n+m)nm)` 建立 dense 約束矩陣，再加 `LP(nm, n+m)`。

最大只有 100 個運輸變數、20 列等式約束，dense 約束本體 16 KB。SciPy 的 `method="highs"` 會選擇不同求解方法，不能直接稱它保證 `O(K³)`；這裡更重要的是呼叫次數、序列化與排隊。[SciPy 1.15.3 HiGHS](https://docs.scipy.org/doc/scipy-1.15.3/reference/optimize.linprog-highs.html)

當一人與其餘 99 人都比較九類：

- 一次請求最多 **891 個邏輯類別比較**：`(U−1)G`。
- 100 人各查一次最多 **89,100 個邏輯類別比較**：`U(U−1)G`。
- 若對稱結果能以版本去重，全站只有 **4,950 對、44,550 個類別比較**：`U(U−1)G/2`。

目前路由逐人逐類 `await`，compare 服務也由單一 `HTTPServer` 處理。空 profile／尚未準備好的類別會減少工作；`1×1` 已有本地直接解，不能把 891 全說成必然的 HTTP 數。

令 `f` 為真正遠端比較次數、`ℓ_rpc` 為每次含序列化／傳輸／求解的平均耗時，單請求約有 `f × ℓ_rpc` 的序列等待。**假設** `f=891`，`ℓ_rpc=5／20／50 ms`，分別是 4.455／17.820／44.550 秒；此表達式是延遲敏感度，沒有實測這些 RPC 耗時。若目標 2 秒，單靠 891 個序列 RPC 意味平均每次需低於約 2.245 ms，尚未含其他工作。

資料搬運也不可忽略：`10×10` 群、768 維時，一次請求送出兩側共 15,360 個向量數值。同一人的向量會對每個候選反覆 JSON 化；8 個內容類對 99 人合計 792 次這種 payload。在合成小數表示約 21 字元／值的假設下，向量文字接近 257 MB／匹配請求。這是最大群數下的示例，不是實際流量。

對單一 compare handler，若匹配請求到達率為 `λ_match`、每次有 `f` 個遠端比較、每次服務時間為 `s`，則利用率模型為 `ρ = λ_match × f × s`。`ρ ≥ 1` 表示穩態處理能力不足；`ρ < 1` 也不保證好的 p95，還取決於變異與突發量。

### 如何緩解

1. **精確的配對結果快取／預計算。** 100 人的 4,950 對規模適合保存結果，key 包含兩邊 profile 版本、genre 與比較設定。對稱 score 可共用，但 transport 左右方向、解釋內容與 tie 順序要正確處理；公開性／朋友關係仍每次重新驗證。
2. **批次比較並一次載入 profile。** 左側向量只送一次，各候選只載一次，減少重複 JSON、SQLite 與 HTTP；這先減少常數和排隊，不改變完整兩兩比較的 `O(U²)`。
3. **擴充有精確解的特例。** `1×1` 已存在；`1×m`／`n×1` 的流量由邊際分布唯一決定，可直接 `O(md)` 求值。channel type 的五維 one-hot kernel 則有 `score = Σ_t min(a_t,b_t)` 的 `O(5)` 解。需保留輸入檢查；分數可一致，零貢獻流量的分配未必與求解器同解，解釋／transport 契約應分別驗證。
4. **以 CPU／RAM 能承受的比較程序池提升吞吐。** 分群與比較已是不同容器，不應再把「拆開服務」當成尚未做的主要解法。只增加 app 端同時 `fetch` 而不增加服務能力，主要效果會是加長 compare queue。

`ranked.some()` 補齊成員另有 `O(U²)` 掃描；100 人約一萬次廉價比對，值得以 Set 清理，但其優先度低於上述數百個 RPC 與冷聚合。僅為 100 人引入近似候選搜尋，通常不是第一步。

程式依據：[數值比較](../services/matching-compute/compute.py)、[compute client](../src/matching-v3/compute.ts)、[逐類比較](../src/matching-v3/matching.ts)、[v3 路由](../src/matching-v3/routes.ts)、[整合匹配頁](../src/index.ts)。

## 6. 首次匯入的隱藏平方掃描

`ingestYoutubeArchive()` 對每個新的精確時間影片事件，查找相同 identity／台北日期的 day placeholder。既有 SQL 使用 `COALESCE(...)` 與 `strftime(...)`；目前索引沒有覆蓋這組表達式，合成 query plan 為 `SCAN a` 後按 activity ID 找 watch。

若從空資料庫逐筆匯入 `V` 個精確事件，每次查找都掃描前面已插入的活動，約有：

`Σ_{i=0..V−1} i = V(V−1)/2` 個活動列篩選；全站乘 `U`。

`V=20,000` 時每人約 **2 億**、100 人約 **200 億**次列篩選。這是指定 query plan、逐筆插入條件下的掃描量估算，並非 CPU 指令數或匯入秒數；只有 day precision 的輸入不走此分支。去重與逐列寫入也有額外工作。

在 20,000 筆合成歷史上重複 100 次相同類型查詢：現有索引 **46.188 ms**，只在記憶體測試 DB 加入匹配表達式索引後 **0.051 ms**。計畫變成 `SEARCH w USING INDEX probe_identity_day`。測試沒有命中的 day placeholders，不能把此查找的約 900 倍差距宣稱為端到端匯入也會快 900 倍。

可行改善是建立與查詢完全一致的 identity／日期複合 expression index，或交易性維護可索引的正規化欄位；查找從逐筆掃歷史轉為約 `O(B log W + 命中列數)`，另付索引建立、空間與寫入維護成本。SQLite 要求查詢表達式與 expression index 匹配，須以 `EXPLAIN QUERY PLAN` 驗證。[SQLite expression indexes](https://www.sqlite.org/expridx.html)

capture 另外每次呼叫無影片範圍的 `backfillYoutubeChannelIds()`；所有頻道都已知時仍掃 `W`。合成測試全表 0.395 ms、只指定一影片 0.013 ms，單次較輕，但高頻率更新會放大。可沿用既有帶影片 ID 的定向回填能力，避免反覆全表掃描。來源：[database.ts](../src/data/database.ts) 第 404、1076、1282 行。

## 驗證證據與限制

SQLite 測試使用真正 Repository migration 建立 `:memory:` 資料庫：20,000 部不同影片、各看一次、2,000 頻道、均勻分布 730 天、沒有搜尋與 actual seconds、每部八個固定原始 tags、短合成 metadata。使用 Apple M5 Pro、Node 24.2.0、SQLite 3.50.0；各列三次中位數，純 cache 命中五次。部署 Node 版本、磁碟、事件分布與 metadata 大小可能不同。

| 合成測試項目 | 中位數 |
| --- | ---: |
| source：輸出 2,000／20,000 部 | 24.856／90.479 ms |
| 強制重建推估事件 TEMP 表，含索引 | 50.285 ms |
| TEMP 已存在：90 天／全時段頻道總計 | 2.468／14.278 ms |
| TEMP 已存在：單頻道全時段詳情 | 17.474 ms |
| TEMP 已存在：28 天 Dashboard base／overview | 31.902／115.062 ms |
| TEMP 已存在：全時段 Insights Repository 計算 | 418.756 ms |
| TEMP 已存在：比較 profile／完整 Crystal | 132.545／268.742 ms |
| 已存在 overview cache 的純查找 | 0.003 ms |

純 cache 查找不含 JSON、HTML、HTTP；TEMP warm 不代表該聚合也已 cache hit。合成 DB 邏輯主資料約 24.842 MB、TEMP 約 4.354 MB；短 metadata 與固定 tags 使其不適合作為真實磁碟上限。測試程序峰值 RSS 包含多次測試的暫存與 GC，不是每帳號常駐量。

補充向量實驗使用另一個本地 Python 3.14.7／NumPy 2.4.6 環境，與服務固定版本不同；1,000 個 768 維向量，float64 約 6.144 MB、合成 JSON 約 16.249 MB。此實驗只支持表示方式與解析開銷分析，**不是 DBSCAN／SciPy LP benchmark**。原始樣本及環境均保留於 evidence JSON。

可重現命令（所有資料均合成，只在記憶體 DB 建索引）：

```sh
node --import tsx docs/analysis/demo-load-probe.mjs > /tmp/urtube-demo-load-new-evidence.json
```

附件：[測試程式](analysis/demo-load-probe.mjs)、[SQL 原始量測](analysis/demo-load-sql-evidence.json)、[向量原始量測](analysis/demo-load-numeric-evidence.json)。全系統其他聚合與匹配公式見[後端完整複雜度分析](backend-complexity-analysis.md)。

## 建議執行順序與驗收

**第一階段：先消除重複工作。** 確認有效影片上限與帳號容量；修正 source 輪詢為 revision／dirty-user；拆開每日頻道刷新與內容重分群；替 placeholder 查找補適用索引。這些項目都有明確原始碼或 query-plan 證據，且可保留既有演算法語意。

**第二階段：讓 demo 互動只讀已完成結果。** 預建九類 profile 與必要聚合；完成精確配對快取／批次比較、輕量版本檢查及授權重驗。準備階段完成後，驗證「沒有新資料」確實接近空閒，而不是仍掃描兩百萬事件。

**第三階段：處理資料多樣性與記憶體。** 統計每帳號／每 genre 的不同 tags 分布、鄰居密度與峰值 RSS，確認 10,000-tag 限制；據此驗證精確稀疏分群、向量表示與程序池。不能僅按影片數平均值配置。

**最後以 100 帳號的隔離合成環境驗收。** 分別測 1、10、100 個同時互動者，涵蓋冷／暖快取、剛匯入資料、背景分類／分群與跨日刷新。記錄 HTTP p50／p95／p99、Node event-loop delay、每程序 CPU／RSS、SQL 時間／鎖等待、compare RPC 數與排隊時間、provider 成功吞吐／429、cache hit 與重算次數。

可先把「暖 overview p95 < 1 秒、完整匹配 p95 < 2 秒、所有預期成員都有可用分數、無 tag 超限／OOM」訂為 demo 驗收目標；這些是建議目標，並非本次已達成的測試結果。完成這組驗收前，不能僅憑兩百萬筆資料的總量宣稱系統已能穩定支援 100 人同時操作。
