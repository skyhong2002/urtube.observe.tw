# 後端資料聚合與匹配演算法複雜度分析

分析日期：2026-09-06。程式基準：`85b5cec`。本文件描述目前 checkout 的實作；設定預設值與 Compose 限制不代表已查證線上程序的實際環境值。

分析涵蓋資料匯入／去重、觀看時間推估、Dashboard／Insights／頻道統計、關鍵字、個人分類、Crystal、兩人 Blend、候選排序、群體推薦、參考母體，以及 matching v3 的資料來源、分類、embedding、DBSCAN、最佳傳輸、排程與監控。沒有修改後端、重啟服務或呼叫付費模型；驗證只使用合成的記憶體資料庫。

## 1. 主要結論

系統不是只有一個「匹配演算法」。資料讀取、建立個人表示、兩人比較、全站候選搜尋，以及頁面補齊成員的成本不同，必須分開看。

1. **v3 最重的數值運算是建立 profile 時的 DBSCAN。** 每類別 `T` 個不同 tag、embedding 維度 `d`，暴力餘弦距離為 `O(T²d)`；空間最壞 `O(T² + Td)`。最後只保留十群，並不降低先前分群的成本。
2. **觀看時間推估有另一個平方退化點。** 對未量測事件查找同影片的量測事件，時間條件包在 `ABS(julianday(...))` 中；目前索引只能定位影片，最壞同一影片反覆掃描，形成 `O(Σ nᵥ²)`。
3. **單筆 capture 也會做全表頻道回填。** 它的成本不是純粹幾次主鍵 upsert。Archive 匯入另外會為每筆新的精確事件掃描 day placeholder 候選，最壞有新事件數乘既有資料量的成本。
4. **v3 兩人比較本身受十群上限約束，主要擴展問題在全站遍歷與序列 HTTP。** 一位使用者對全站要做 `O(U)` 次配對；全站每人各查一次是 `O(U²)` 次配對。不能把外部 LP 求解器直接宣稱為 `O(K³)`。
5. **目前 `/matches` 整合頁已有額外 `O(U²)` 的陣列掃描。** 補齊成員時逐人使用 `ranked.some(...)`；頁面先計算全池才分頁，而且公開使用者與 v3 成員不受原先 250 人池限制。
6. **讀取快取能降低重複成本，但不改變冷讀複雜度。** 全站頻道頁、Insights 參考母體、worker 各有跨使用者扇出；同步 SQLite 與 JSON 工作會占用 Node 主事件迴圈。

## 2. 符號與估算原則

| 符號 | 定義 |
| --- | --- |
| `U`、`P` | 全站使用者數、某次實際候選池人數；公開／同意加入的人數以對應子集合替代 |
| `A`、`W`、`S` | 單一帳號的通用活動、觀看事件、搜尋事件數 |
| `N = W + S` | 推估時間軸輸入規模；實際 timeline 排除非 video 的 watch |
| `E` | 查詢時間範圍內的觀看事件數，`E ≤ W` |
| `V`、`C` | 影片、頻道數；下標 `r` 表示選定範圍，`h` 表示指定頻道 |
| `nᵥ`、`uᵥ` | 影片 `v` 的觀看數、其中未量測觀看數 |
| `J`、`D` | 實際參與查詢的 join 中間列數、相關 B-tree 表／索引規模的上界 |
| `B`、`H` | 新匯入事件／項目數、歷史 progress scan 紀錄數 |
| `G`、`Tɡ`、`Kɡ` | v3 類別數、每類不同 tag 數、保留群數；目前 `G ≤ 9`、內容類 `Tɡ ≤ 10,000`、`Kɡ ≤ 10` |
| `d`、`a` | embedding 維度、來源影片平均 tag 數；預設 `d=768`，允許 128–3072 |
| `Vₗ`、`b` | v3 來源影片數（不超過 backfill limit）、分類 batch 大小（1–20，預設 5） |
| `Z`、`Oₚ` | v3 快取列數、保留的 operation 列數 |
| `M`、`F`、`s` | 日／月或週期數、race 實際 frame 數、平滑視窗大小（3 或 7） |
| `L`、`X`、`I` | 處理文字總長、不同關鍵字候選數、關鍵字與影片／頻道／別名的關聯總量 |

Map／Set 採一般雜湊表的期望攤銷 `O(1)` 模型；文字正規化、JSON、雜湊、比較字串仍要按字串長度計費。排序以比較排序上界 `O(n log n)` 表示，不假設輸入恰好已排序。

SQLite 主鍵點查通常為 `O(log D)`；範圍索引掃描為 `O(log D + E)`，逐列再 join 其他 B-tree 還有查找成本。`GROUP BY`、`DISTINCT`、window function 與 `ORDER BY` 是否需要額外排序取決於 query plan。下文以

`Q(E,J) = O(log(1+W) + E log(1+D) + J log(1+J))`

作為一般索引 join 加排序／聚合的保守估算；對固定次數、每事件固定 assignment 數的查詢，可以簡寫近似 `O(E log E)`，但這個簡寫不包含額外的全歷史查詢。若歷史 taxonomy 使 join 膨脹，應使用 `J`，不能一律假設每影片只有一筆 topic 列。部分索引順序能消去排序項。SQLite 的 temp B-tree 可能溢寫磁碟，本文「空間」包括邏輯中間資料，不等同全部常駐 RAM。[SQLite query-plan 說明](https://www.sqlite.org/eqp.html)

`O` 是成長上界，不是精確耗時或必然發生的瓶頸。API 呼叫量、token 量、數值 CPU、資料庫 I/O 與牆鐘時間分開列出。

## 3. 資料匯入、去重與時間推估

### 3.1 Archive、history sync 與通用活動

來源：[database.ts](../src/data/database.ts)、[takeout.ts](../src/youtube/takeout.ts)、[history-sync.ts](../src/youtube/history-sync.ts)、[activity.ts](../src/data/activity.ts)。

| 流程 | 時間 | 額外空間 | 關鍵行為 |
| --- | --- | --- | --- |
| `ingestEntries` | `O(L + B log(A+B))` | 除輸入與 transaction 外，逐筆工作空間 | 每筆建立活動、雜湊、存在查詢、upsert；固定數量索引更新 |
| Takeout ZIP／JSON／HTML | 一般按壓縮／解壓／解析 bytes 成長；多檔 concat 額外最壞 `O(fB)` | `O(解壓 bytes + B)` | 同步解壓後保留檔案與解析結果；`f` 個檔案反覆 concat 會複製已累積事件，不能宣稱完整串流 |
| history sync 事件正規化與 fingerprint | `O(L + B log B)` | `O(L+B)` | 事件 ID 排序後雜湊 |
| `ingestYoutubeArchive` 初始去重集合 | `O(W+S)` 次資料列讀取及字串處理 | `O(W+S)` | 既有 watch 分秒／分／日掃三次；search 掃一次，即使只新進一小批也要讀歷史 |
| Archive 正常逐列寫入 | `O(B log D + L)`，另加下述 placeholder 與回填 | `O(B)` 新增去重鍵 | transaction 降低提交次數，沒有消除查詢次數 |
| `ingestYoutubeProgress` | `O(B log D + Bscan)` | 逐項暫存；輸入 `O(B)` | 結尾依 `scan_id` COUNT 掃本次 scan 已存項目 `Bscan`；重送分批資料時這項會重複 |
| 通用活動搜尋 `queryActivities` | 最壞 `O(搜尋文字 bytes + A log A)` | 排序工作區與一頁輸出 | `%query%` 不是前綴索引搜尋；`ORDER BY CASE...` 不被現有 timeline 索引完整滿足；OFFSET 也不會把成本限制在頁大小 |

正規表示式／ICU 文字處理以上採正常 metadata 輸入的工程模型，不把 JavaScript regex 引擎對任意惡意長字串保證成線性。

### 3.2 精確事件替換 day placeholder：潛在乘法放大

`ingestYoutubeArchive` 的 `selectDayPlaceholders`（database.ts:1075）對每個通過去重、帶 video ID 的精確事件執行：

```sql
WHERE a.occurred_precision = 'day'
  AND COALESCE(w.video_id, NULLIF(w.raw_url, ''), w.raw_title) = ?
  AND strftime('%Y-%m-%d', w.watched_at, '+8 hours') = ?
```

現有索引沒有覆蓋這組表達式。合成資料 query plan 為 `SCAN a`，再以 `activity_id` 找 watch。若本批有 `Bₑ` 筆走到此處，總量可達 `O(Bₑ(A+B))` 掃描，加上 join／刪除索引成本；若活動以 watch 為主，即常見的 `O(Bₑ(W+B))` 型態。當 `Bₑ` 和 `W` 同量級時，就是平方成長。這是根據程式與計畫推導，沒有對線上資料做負載實驗。

### 3.3 Capture 後全表回填

`upsertYoutubeCapture` 在完成主鍵寫入後，呼叫無 videoIds 參數的 `backfillYoutubeChannelIds()`（database.ts:1282、404）。後者會掃整張 watch 表，再對缺 channel 的列查影片。

單次成本為 `O(W + Wnull log V + R log W)`，其中 `R` 為實際更新列數；即使所有 channel 都已補完，仍可能有 `O(W)` 的篩選掃描。連續輸入 `B` 筆 capture 時，總掃描量可達 `O(BW+B²)`。constructor 與 Archive 結尾也呼叫全量回填；metadata 更新另有帶 videoIds 的定向版本。

### 3.4 觀看秒數估算與 materialization

`YOUTUBE_ESTIMATED_EVENTS_CTE`（database.ts:186）先合併 watch/search 時間軸，以 `LEAD` 找下一次活動，再依量測值、鄰近量測、day precision、影片長度／進度／時間差產生推估秒數。

一般建表成本包括：

- timeline 合併／排序：上界 `O(N log N)`；現有時間索引可做部分有序 merge，並非每次完整排序。
- 事件、活動、metadata、progress join：`O(W log D)`。
- 建立 TEMP time/video 索引：`O(W log W)`。
- TEMP 結果與排序空間：按事件資料 bytes 成長，行數模型為 `O(N+W)`。

**關聯 EXISTS 是主要退化點。** 對每個沒有 actual seconds 的事件，以 `(video_id, watched_at)` 索引找同影片事件，但 `ABS((julianday(measured.watched_at)-julianday(w.watched_at))*86400)<=300` 無法成為直接的時間範圍搜尋。

完整成本上界：

`T_est = O(N log N + W log D + Σᵥ uᵥ nᵥ)`。

因為 `uᵥ ≤ nᵥ`，最後一項最壞為 `O(Σᵥ nᵥ²) ≤ O(W²)`。EXISTS 找到符合列可以提早停止；所有事件都量測時跳過這個分支；相反，同影片大量未量測、無匹配量測事件時就必須反覆掃完整組。

`ensureEstimatedEvents`（database.ts:1649）的快取分三層：

| 狀態 | 成本 |
| --- | --- |
| revision 相同且未過 5 分鐘 | 固定次數 PRAGMA／total_changes，按資料量近似 `O(1)` |
| revision 變更，但 signature 相同且未到 TTL | signature 的 COUNT/SUM/MAX，約 `O(W+S+V+progress)` 掃描；不一定重建 |
| signature 變更或超過 TTL | signature 掃描再加 `T_est`，完整重建 TEMP 表與兩個索引 |

快取是每個 Repository／連線一份。全站開啟多個 repository 會累積各帳號 TEMP 表，app 與 worker 程序也不共用該物化結果。

### 3.5 合成資料驗證

使用真實 Repository migration 建立 `:memory:` schema，抽取目前程式中的原始 CTE，執行 `SUM(estimated_watch_seconds)`。每種情境先暖身一次、再取五次中位數；事件相隔一小時、全部未量測、metadata 長度 600 秒。沒有實際使用者資料、網路請求或服務重啟。

| Watch 筆數 | 每筆不同影片 | 全部同一影片 |
| ---: | ---: | ---: |
| 250 | 0.436 ms | 5.317 ms |
| 500 | 0.688 ms | 19.777 ms |
| 1,000 | 1.770 ms | 79.202 ms |
| 2,000 | 3.596 ms | 313.681 ms |

後三次 repeat 的倍增比約 3.72、4.00、3.96，與平方項相符。結果只驗證退化形狀，不是生產 SLA，也不包括 TEMP 索引建立與完整 Dashboard。環境為 Node v24.2.0、SQLite 3.50.0；Compose 映像可能有不同執行版本。

關鍵 query-plan 證據：

```text
推估：SEARCH measured USING INDEX youtube_watch_video_idx (video_id=?)
placeholder：SCAN a
頻道回填：SCAN youtube_watch_events
v3 source：SCAN w + USE TEMP B-TREE FOR GROUP BY / ORDER BY
```

完整計畫與量測見 [evidence JSON](analysis/backend-complexity-evidence.json)，可重跑的合成探針見 [complexity-probe.mjs](analysis/complexity-probe.mjs)。

## 4. Dashboard、頻道與時間序列聚合

來源：database.ts:1689–2271、2459–2817。下列成本假設 TEMP estimated-events 已有效；冷建表需另加 `T_est`。

| 功能 | SQL／本機時間 | 中間與輸出空間 |
| --- | --- | --- |
| `youtubeChannelTotals` | `Q(E,J) + O(Cᵣ log Cᵣ)`，讀全部範圍事件再分組／排序 | SQL 工作區 + `O(Cᵣ)` 完整頻道列表 |
| 基礎 Dashboard stats | 多個固定次數 aggregate、distinct、correlated topic lookups，約 `Q(E,J)`；不是只有 COUNT | `O(Vᵣ+Cᵣ+日期數)` distinct 集合／結果 |
| daily／hourly／short-form／length buckets | 各自掃範圍資料，`Q(E,J)`；小 bucket 數只限制輸出 | 小 bucket 輸出，但 SQL 工作區仍按輸入量 |
| Top channels／videos | 聚合後再做 watches/time 兩種 `ROW_NUMBER` 排序，`Q(E,J)+O(Cᵣ log Cᵣ+Vᵣ log Vᵣ)` | 中間全部分組；各結果最多兩組前 12 名聯集 |
| 最近 10 個不同影片 | window partition 覆蓋範圍事件，再挑每影片一筆與排序，保守 `O(E log E + E log V)` | `O(E)` 級 SQL 工作區；輸出 10 |
| 關鍵字取樣 SQL | 先 window 去重，再編完整 distinct-video 序號後 stride，`O(E log E+Vᵣ log Vᵣ)` 加 join | 取樣輸出 ≤2,000；此前中間結果並未限為 2,000 |
| `youtubeMatchingTopicWindow` | stats 與 topic group 固定數次查詢，`Q(E,J)` | topic 固定 14 個；查詢工作區仍取決於 E |
| `youtubeComparisonProfile` | totals、兩個 channel lists、video/topic ranks、rhythm、hour/day、first/last 等多次 SQL；`Q(E,J)+O(Cᵣ log Cᵣ+Vᵣ log Vᵣ)` | 每個 channel／shorts／video list 最多 5,000；排序在 LIMIT 之前 |
| `youtubeChannelDetail` | 指定頻道的多次掃描，加上全範圍所有頻道排名；`Q(E,J)+O(Cᵣ log Cᵣ+Vₕ log Vₕ)` | `O(Cᵣ+Vₕ+M)` 與 SQL 工作區；影片結果未設 5,000 cap |

**指定頻道頁不是只掃該頻道。** TEMP 表只有 watched_at 與 video_id 索引；`COALESCE(e.channel_id,v.channel_id)=?` 需 join／篩選，且排名刻意聚合所有頻道。因此不能估為 `O(log C + 該頻道事件數)`。

**Overview 也會計算完整歷史 race。** `includeInsights='overview'` 是 truthy，會產生 race 與 topicTrend，只省去語意關鍵字；History／Recap 的 false 投影才跳過這些部分。即使使用者選 28 天，raceRows 沒有 range cutoff，仍掃全歷史。

### 4.1 Topic trend 與平滑

`youtubeTopicTrend`（database.ts:1717）包含一個全歷史 firstExact 查詢，以及兩個按時間區段／topic 的聚合。設輸出有 `M` 個區段、`T` 個 topic：

- SQL：全歷史 firstExact 查找／掃描，加 `Q(E,J)`。
- 補零／稠密結果：`O(MT)` 時間與空間。
- 平滑：每區段 × 每 topic × 最多 `s` 個歷史區段，且每次 `month.topics.find` 最壞掃 `T`。
- 因此本機平滑為 **`O(MsT²)`**，不是 `O(MsT)`。

目前固定個人 taxonomy 約 14 類、`s=3/7`，所以這項常數相對小；歷史 taxonomy 仍應按實際 T 算。使用按 topic 的查找表及 rolling sum 可消除第二個 T 因子，但需另行驗證。

### 4.2 頻道 race：衰減、排名與補位

`buildChannelRace`（database.ts:283）將 `(週,頻道)` 列放進 Map，每週衰減、加入觀看秒數、移除低於 60 秒者，排序活躍頻道取前八。

設週頻道輸入有 `Rweek` 列、週 `t` 保留 `Cₜ` 個活躍頻道：

`O(Rweek + Σₜ Cₜ log(1+Cₜ))`

空間為 `O(Rweek + max Cₜ + 8F + Cseen)`。`Cseen` 是曾進前八的不同頻道數。資料空白週也會走時間軸，不能只用有資料的週數。

最後若某 frame 不滿八名，會掃全部 `Cseen` 個未來入榜頻道，再排序補零項目；額外上界為 **`O(Fshort · Cseen log Cseen)`**。這是前八名之外仍然存在的工作。整個流程前面還要加全歷史 race SQL 的 `Q(W,J)`。

`weekdayExposure` 則已用完整週除法跳過長區間，只剩最多八個日界線，時間／空間均為 `O(1)`，不隨年數逐日迴圈。

## 5. 關鍵字與個人 taxonomy

### 5.1 Keyword pipeline v2

來源：[keywords.ts](../src/youtube/keywords.ts)。

流程包括 boilerplate line 統計、固定 locale 分詞、unigram／相鄰 bigram、每影片去重、格式變體合併、支持度門檻、phrase dominance、來源加權及頻道多樣性評分。

以 `L` 表示實際文字長度、`I` 表示總候選關聯、`X` 表示不同候選，`lₓ` 表示某候選的別名數：

`T_keyword = O(L + I + X log X + Σₓ lₓ log lₓ)`。

空間 `O(L + I + X)`。單一候選可出現在很多頻道，因此不能只用 `O(X)` 忽略 candidate-channel Set。

重要的細節：

- bigram 只生成相鄰詞，title／每個 tag 各取前 40 個 token；沒有全詞兩兩組合的 `O(tokens²)`。
- phrase dominance 每個 phrase 只查兩個 part 的 Map，因此是線性候選遍歷。
- `extractYoutubeKeywords` 直接呼叫 `explainYoutubeKeywords`，即使只要 20 個結果，仍建立全部 decisions/candidates、排序候選與別名。部分 pickLabel 會重複執行。
- description 限 600 字元；2,000 是 SQL 抽樣量，函式本身不截斷 rows，title/tag 總長也仍應計入 L。

### 5.2 個人 taxonomy 取樣、分類與品質統計

來源：[personal-taxonomy.ts](../src/youtube/personal-taxonomy.ts)、[ai.ts](../src/youtube/ai.ts)、database.ts:2374、2818–3344。

| 階段 | 時間／API | 空間與限制 |
| --- | --- | --- |
| readiness | COUNT、available/metadata 檢查，按 `V` 掃描 | 固定大小結果 |
| 候選資料 | watch 依影片 min/max/count 聚合，再 join metadata 排序；`Q(W,J)+O(V log V+L)` | 所有候選 metadata `O(V+L)` |
| `samplePersonalTaxonomy` | 建 strata `O(V)`，各 strata 排序合計 `O(V log V)`；抽樣 cursor 單調推進，另有 `O(sampleLimit·strata數)` 輪詢上界 | `O(V)`；最後 sample ≤480 不代表前處理 ≤480 |
| 穩定排序 | 比較器反覆 SHA-256 同一 video ID，`O(V log V)` 次 hash | ID 長度固定但常數浪費可觀 |
| 分類候選查詢 | 每次重算所有影片 latest watch，`Q(W,J)+O(V log V)`；personal 回傳 ≤1,000、matching ≤5,000 | batch limit 控制回傳，未控制前置聚合 |
| personal 模型分類 | 每 batch 20，單輪至多 `3·ceil(B/20)` 次嘗試；驗證 `batch.some` 有 `O(b²)`，b=20 固定 | metadata bytes、batches、回應 |
| evidence 核對 | 每影片至多三個 evidence，搜尋來源 metadata，按該影片文字長度成長 | 不做 embedding 或影片彼此比較 |
| 品質重算 | watch min/max、assignment join、多個 DISTINCT／SUM，`Q(W,J)` 加影片 eligibility 查詢 | DISTINCT 集合按影片數 |
| `assessPersonalTaxonomyQuality` | 接受已聚合計數後為 `O(1)` | 固定五個門檻 |
| 各 topic evidence | partition 內按 confidence 排序，上界 `O(J log J)` 加 join | 每 topic 最後 ≤5 筆，不省先前排名 |
| `youtubePersonalTaxonomyDistribution` | 選版本 topics 再與範圍事件 join，兩次統計，`Q(E,J)` | topic 結果與 join 工作區 |

既有固定 YouTube category → 14 個 matching topic 是 Map 查表，單影片分類本身 `O(1)`，不呼叫 LLM；昂貴的是候選 SQL 與逐筆落庫。品質頁的 cohesion score 是接受分類的平均 confidence，並沒有另跑 pairwise embedding cohesion。

分類回補若需要 `r` 個 worker cycle，上述 latest-watch 聚合、quality aggregate、Crystal 建立也可能被重做 `r` 次，因此應估 `r × 每輪聚合成本`，不能只算每影片一次模型費用。

## 6. 既有 Crystal、Blend 與候選推薦

### 6.1 Crystal 建立與儲存

`buildYoutubeCrystal`（[crystal.ts](../src/youtube/crystal.ts):158）建立 recent、prior、all-time、90-day matching 四個窗口，另外讀固定 matching topic 分布。每個 `youtubeCrystalWindow` 都有 totals／channels／topics／keywords SQL 和關鍵字處理。

總時間是這些窗口的聚合與 keyword 成本之和，加一次必要的 `T_est`。all-time 保證會觸及完整歷史；四個窗口是固定常數，所以不增加漸近階數，但資料重疊時有明顯重算。即使 worker 最後只存 matching projection，也先建立完整 Crystal 與這些窗口。

份額計算 `O(C+T)`；recent/prior shift 用 Map 合併後排序，`O((C+T) log(C+T))`。DB Crystal 每窗口最多 250 頻道，registry projection 再取 200 頻道、最多 20 topic（固定 taxonomy 目前實際 14）；儲存／解析按 projection JSON bytes 成長，與 raw history 長度脫鉤。

### 6.2 兩人的 cosine、共同項目與 Blend

| 函式 | 已有 profile 時的時間 | 空間 |
| --- | --- | --- |
| `matchingCandidateSimilarity` | `O(Cₐ+Cᵦ+Tₐ+Tᵦ)`；建立右側 Map、點積與兩側 norm | `O(Cᵦ+Tᵦ)` 及篩選陣列 |
| calibrated score／percentage | `O(1)` | `O(1)` |
| `compareCrystals` | cosine 加交集／差集排序，`O(Cₐ+Cᵦ+Tₐ+Tᵦ+Icommon log Icommon)`，差集排序另以相同量級上界計 | 線性於兩個 projection |
| `compareWatchProfiles` | channel、shorts、video、topic 各自 Map 交集再依 geometric-mean share 排序：`O(sizeₐ+sizeᵦ+Icommon log Icommon)` | `O(sizeₐ+sizeᵦ+Icommon)` |

這些交集不是巢狀逐項比對，沒有 `VₐVᵦ` 的影片交叉乘積。兩人 Blend 顯示 50 筆，但各 profile 先讀最多 5,000 筆，交集與排名完成後才切 50。locked 頁面會跳過 channel/video 交集，**route 仍先建立兩份 comparison profile**，不能把隱藏細節等同不做底層聚合。

### 6.3 候選卡片與 cohort recommendations

`rankedMatchingCandidateCards` 每人計算 cosine、共通頻道／topic 並排序，再全池按 score 排序。以 registry profile 寬度 `Cₚ≤200`、`Tₚ≤20`：

`O(P(Cₚ log Cₚ + Tₚ log Tₚ) + P log P)`，空間為輸入 profiles `O(P(Cₚ+Tₚ))`、候選卡片 `O(P)`，單人暫存按 profile 寬度。

`cohortRecommendations` **再次**對全池算 similarity 並排序取 10 位鄰居；然後對鄰居的項目做 `similarity × share` 累加，每項至少三人支持，排序後取五個推薦。若鄰居聯集項目 `R`：

`O(P(Cₚ+Tₚ) + P log P + 10(Cₚ+Tₚ) + R log R)`。

治理名單 union／viewer seen-channel policy 另加名單總數及已看頻道數。10 位鄰居限制的是後半段聚合，不是前面找鄰居的成本。

### 6.4 `/matches` 的實際組合成本

來源：[index.ts](../src/index.ts):773–846、[users.ts](../src/users.ts):685。

原 `listMatchingCandidatesFor` 預設 250、硬上限 499，內部 `listMatchableCrystals` 最多 500。但整合頁另外合併**所有**公開帳號與 v3 matching 成員，因此 `P` 可長到 `O(U)`。

除了上述候選排序，還有：

1. `blendIdentity` 在 registry Crystal 缺失時建立完整 `cachedCrystalFor`；冷頁可能對多帳號做歷史聚合。
2. card 補齊對每位成員呼叫 `ranked.some` 判斷是否已有卡片，最壞 `O(U·P)`，`P≈U` 時為 `O(U²)`。
3. cohort 與卡片分別計算 similarity；目前沒有共享每對的結果。
4. v3 invitations 在每次 respond 都枚舉所有 users 並查 relationship；不是只有一頁 20 人的查詢量。
5. 最後才 `matchingCandidateBatch` 切頁，分頁只限制回應卡片數，沒有減少上游計算。

關係查詢有 participant 複合索引，但每對仍有使用者／關係點查與小結果排序；記作 `O(log U + log Rrel + rpair log rpair)`。歷史關係列增加、全頁逐人呼叫會累積，不應把每個 SQL 當零成本。

因此，**目前整合頁的使用者成長最壞已經有平方項，即使兩人 cosine 本身是線性的**。

## 7. 頻道標籤、參考母體與全站統計

來源：[taglists.ts](../src/youtube/taglists.ts)、[reference-population.ts](../src/youtube/reference-population.ts)、[community.ts](../src/youtube/community.ts)、index.ts:340、883、920。

### 7.1 標籤名單與個人份額

外部名單有固定七組，冷讀七個 HTTP 請求並行，TTL 六小時，pending Promise 共用。設各組長度 `Lⱼ`，建立 Set 和 membership hash 需 `O(Σ Lⱼ log Lⱼ)` 時間、`O(Σ Lⱼ)` 空間；熱讀近似 `O(1)`。

`computeTagLean` 先累計所有頻道，再為七組各 filter／sort／reduce：

`O(7C + Σⱼ Cⱼ log Cⱼ)`，最壞 `O(7C log C)`；額外暫存 `O(C)`，輸出各組只取前五。類別可重疊，`matched` 用 `.some` 避免總量重複計次。

### 7.2 參考母體

目前每個 metric 對符合條件的使用者建立份額陣列、mean、median 排序、低於／等於 viewer 的數量；另將 contributions 排序生成版本 hash。

若有 `Ur` 個貢獻者與 `g=7` 個 metric，純計算為 `O(g·Ur log Ur + Ur log Ur)`；更一般地，groupShare 的 `.find` 與 denominator reduce 會有 `O(Ur·g²)`，但 g 目前固定很小。傳入 contributions 空間 `O(Ur·g)`，單 metric 暫存 `O(Ur)`。

**Insights route 的真實成本更高：**每次先跨全部 reference users 呼叫 `youtubeReferenceDataUpdatedAt()`；其中 imported_at／metadata／progress 的 MAX 不是全都能用索引直接定位，會掃相關資料。然後讀頻道 totals（可能快取），並逐人重算 tagLean。即使 totals 已熱，這些版本查詢與群體計算仍不是 `O(1)`。

全站一次 Insights 冷讀大致為：

`Σᵤ [資料更新時間掃描 + T_est,u（若失效） + Q(Eᵤ,Jᵤ) + tagLean(Cᵤ)] + O(Ur log Ur)`。

### 7.3 公開首頁與會員頻道頁

| 流程 | 冷讀 | 熱讀仍需做的事 |
| --- | --- | --- |
| `communityStatsProvider` | 每個公開帳號 `youtubeChannelTotals('90d')`，Map 累計頻道；三種完整排序後取 8／30／30。`Σ Qᵤ + O(Σ Cᵤ + Cglobal log Cglobal)`，另加失效的 T_est | 五分鐘 cache 命中仍 listUsers、篩公開成員、sort IDs、建 key，`O(U log U)` 上界 |
| `/channel/` 會員頻道目錄 | 每個 matching member totals 聚合，`Σ Qᵤ + O(Σ Cᵤ)`；呈現排序另 `O(Cglobal log Cglobal)` | 個人 totals 有快取，但跨會員 Map 每次重建，至少 `O(Σ Cᵤ)` |
| `/channel/:id` | 對全部 matching members 建 `youtubeChannelDetail`，`Σ Q(Eᵤ,Jᵤ)` 加各自全頻道排名；再合併影片與會員 | 即使個人 detail 已熱，仍 merge `Σ Vᵤ,h` 個影片、排序會員／影片；無群體 aggregate cache |

單頻道 route 還可能在 metadata 過期時呼叫一次 YouTube API；這是額外網路延遲，不影響上述資料量階數。每次跨不同頻道查詢，會重複同一帳號的「所有頻道排名」計算，直到各 key 快取建立。

## 8. Matching v3：建立 profile

來源：[pipeline.ts](../src/matching-v3/pipeline.ts)、[provider.ts](../src/matching-v3/provider.ts)、[model.ts](../src/matching-v3/model.ts)、database.ts:1582。

### 8.1 Source 讀取與 fingerprint

SQL 先 join 所有 video watches、依影片 group、按 MAX(watched_at) 排序，**最後才 LIMIT**。合成計畫確認 `SCAN w` 與 GROUP BY／ORDER BY temp B-tree。

時間上界：`Q(W,J) + O(V log V + Vₗ log Vₗ + Σᵥ aᵥ log aᵥ + L)`；空間為 SQL 全量中間結果及回傳 `O(Vₗ a + L)`。

來源包含原 tag 和 title/description hashtag，正規化、去重並排序；fingerprint 序列化整個 source，成本與 bytes 成正比。backfill limit 限制送模型和後續分群的影片數，不會把 source 查詢變成 `O(Vₗ)`。

complete 狀態另查 scan history。`youtubeHistoryCoverage` 對 eligible scan 做 correlated baseline EXISTS，索引 `(end_reason,observed_at)` 能縮小條件；一般可估 `O(H log H)`，但大量未完成 baseline 需要跳過時仍可能退化，保守最壞 `O(H²)`。H 應獨立於影片數。

### 8.2 分類、跨帳號快取與 API 工作量

新分類結果只回 genres，所有原始 tags 套用到每一個指定內容 genre；沒有新 tag 生成。歷史已完成 cache 可以含舊式 assignments，因此應按儲存的 assignment 總量估算。

設本輪未命中分類的不同 cache keys 有 `Vmiss`、未命中 embedding 的不同 tag 有 `Tmiss`、過期／未命中頻道有 `Cmiss`：

| 項目 | 無失敗時請求數與工作量 |
| --- | --- |
| GPT 影片分類 | 單帳號單次批次劃分通常 `ceil(Vmiss/b)`；多帳號是各實際 batch 的總數 |
| Gemini embedding | 每批最多 64；理想集中批次約 `ceil(Tmiss/64)`，目前分散在各分類 batch 的 warmEmbeddings，可能接近 `Tmiss` 個小請求 |
| Channel metadata | 有 YouTube key 時每個 cold channel 一次，沒有 50 個頻道合併 |
| GPT channel type | 最多 Cmiss 次，需公開 description 足夠才呼叫 |
| Embedding 回傳與正規化 | `Θ(Tmiss·d)` 數值／JSON bytes、CPU 與寫入資料量 |

分類模型的 server-side FLOPs 不在 repo，不能由「每影片一次呼叫」推得模型計算是 O(影片數)。可確定的是輸入 token 受實際 title/tags bytes 與每 batch 重複 prompt 影響；本文不推算未量測的金額或模型服務時間。

`cachedWork` 的 pending Map 讓**同一程序／MatchingStore**內帳號共享正在進行的相同 key 工作，完成 cache 持久化後可跨輪重用。它不是跨程序的 provider-request lease，也不是所有影片永遠只處理一次；TTL、key 版本、失敗與重試仍會增加工作。

若多個 batch 部分 key 重疊，會等待後重新檢查；每次有新衝突就再經過一次 keys 掃描。一般按排程 key 出現次數成長，不能宣稱等同全站 unique keys 的單次 O(1) 查找。

### 8.3 Tag 聚合與快取讀取

每個內容 genre 都重新去重 source videos、檢查 assignments、建立 assigned Set，並累計每個 tag 出現於多少不同影片。

以新資料每影片最多 G 個 assignments、平均 a tags，全部 genre 的上界為 `O(G·Vₗ(G+a))`；若用任意歷史 assignment 大小表示，則按每 genre 的 assignment 掃描與命中 tag 數相加。G 固定為八個內容類時，影片／tag 部分近似線性。

**權重不等於觀看次數。** 一個 tag 的 count 是 distinct-video 支持數；重複觀看不會把 DBSCAN 點複製成多筆。影響分群平方項的是不同 tag 數 T，而不是 tag count 總和。

`store.cache` 每次都 SELECT 後 `JSON.parse(value_json)`；只用來判斷向量存在，也會解析 d 個數值，因此一次 vector hit 為 `O(log Z+d)`，不是常數。warmEmbeddings 多輪去重／排序，之後各 genre 再查一遍 vectors，總讀取含 `Σɡ Tɡ·d`，同一 tag 在不同 genre 會重複 JSON parse。

分類 cache 同樣按完整 JSON bytes 解析；因 assignments 內重複存放每個 genre 的 tags，單影片快取大小可到 `O(Ga)` 個 tag 項目，還需計算 tag 文字長度。持久化 cache 的總空間為所有分類 JSON 加 `Θ(Tglobal·d)` 向量值、頻道分類及 `O(UGKd)` profile；不同使用者共享向量可省儲存，不能省每次讀取時重新解析。

每 genre 排序 points 為 `O(Tɡ log Tɡ)`，組裝／序列化 cluster HTTP body 為 `O(Tɡd)`，Node 端最大單類 points 至少 `O(Tmax·d)`；此外仍保留 source、分類 Map、所有已排程 Promise、網路 payload 和完成 profile。

### 8.4 DBSCAN 與群摘要

實作：[compute.py](../services/matching-compute/compute.py):23。

```python
DBSCAN(metric="cosine", algorithm="brute").fit_predict(
    vectors, sample_weight=weights
)
```

每 genre T 個向量：

| 階段 | 時間 | 額外空間 |
| --- | --- | --- |
| 檢查與單位化 | `O(Td)` | `O(Td)` |
| 暴力餘弦鄰域 | `O(T²d)` | 距離／鄰域最壞 `O(T²)`，加向量 `O(Td)` |
| DBSCAN 展開 | `O(T + 鄰域邊數)` | 最壞平方鄰域 |
| 每 label 用 `np.where(labels == label)` | `O(T·Kraw)` | 逐群索引；Kraw 為未截斷群數 |
| weighted centroid | 各群合計 `O(Td)` | 最大群的向量拷貝／平均工作區 |
| 群內代表 tag 排序 | `Σ O(Tcluster log Tcluster)` | 最大群 tag 列表；最後才切五個 |
| 群排序／篩選／取十群 | `O(Kraw log Kraw)` | `O(Kraw·d)` 的未截斷群摘要上界 |

因此單類主導項為 **`O(T²d)` 時間、`O(T²+Td)` 最壞空間**。scikit-learn 1.6.1 官方也明列最壞平方記憶體；平均鄰域較稀疏不代表暴力距離計算變成線性。[版本對應 DBSCAN 文件](https://scikit-learn.org/1.6/modules/generated/sklearn.cluster.DBSCAN.html)

預設 d=768 的容量尺度（float64，十進位 MB，僅單一陣列，不是實測 peak RSS）：

| T | 一份 T×d 向量 | 一份 T×T 距離資料 | T²d 運算尺度 |
| ---: | ---: | ---: | ---: |
| 1,000 | 6.144 MB | 8 MB | 0.768×10⁹ |
| 5,000 | 30.72 MB | 200 MB | 19.2×10⁹ |
| 10,000 | 61.44 MB | 800 MB | 76.8×10⁹ |

實際同時存在 JSON bytes、Python list/float、NumPy 拷貝、鄰域索引及模型內部資料；距離實作也可能分塊。此表既不是完整峰值，也不是聲稱一定常駐完整 dense matrix。Compose 的 clustering container 設 2 GiB，因此 10,000 tag 的 guard **不是記憶體安全證明**。

八個內容 genre 的總分群量：`O(d Σɡ Tɡ²)`。若相同 T 個 tags 同時出現在八類，最多就是八次同規模工作。保留十群、minShare 及每群五個代表 tag 都在鄰域計算之後，主要改善的是 downstream profile 大小。

Channel type 不跑 DBSCAN；五種固定 one-hot 類型，聚合 `O(5Vₗ)`，輸出最多五群。

### 8.5 建立一個 profile 與全站預計算

排除遠端模型內部計算，單 profile 的主要成本可寫為：

`T_source + T_cache/文字/排程 + O(d Σɡ Tɡ²)`。

全站為各帳號之和 `Σᵤ (...)`，加第 10 節的排程成本。相同影片／tag 的付費結果有共用 cache，但**不同使用者的 weighted tag 分群仍各自執行**。

`cachedPreview` 只免 provider 費用，仍讀 source/cache 並跑相同 DBSCAN，CPU 最壞階數沒有降低。

## 9. Matching v3：兩人分布匹配與全站搜尋

來源：[matching.ts](../src/matching-v3/matching.ts)、[compute.ts](../src/matching-v3/compute.ts)、compute.py:62、[routes.ts](../src/matching-v3/routes.ts):102。

### 9.1 分數定義與成本

每個 genre 的左 n 群／右 m 群，先單位化 centroid，算 kernel：

`kernelᵢⱼ = clip((cosine(aᵢ,bⱼ) - floor)/(1-floor), 0, 1)`。

再解運輸問題，使 row flow 總和等於左群 share、column flow 總和等於右群 share，最大化 `Σ flowᵢⱼ × kernelᵢⱼ`。可拆分群質量，所以不是一對一的 Hungarian assignment。

- cosine matrix：`O(nmd)` 時間、`O(nm+(n+m)d)` 空間。
- 目前建立 **dense** equality matrix `(n+m) × nm`，初始化與空間為 `O((n+m)nm)`。
- LP 有 `nm` 個變數與 `n+m` 個等式（至少一條冗餘）；solver 時間記 `LP(nm,n+m,數值條件/容差)`。
- flow 掃描 `O(nm)`，transport 排序上界 `O(nm log(nm))`。

`linprog(method='highs')` 會在 dual simplex／interior-point 之間選擇；repo 沒有固定迭代數或提供可直接套用的多項式次方保證。因此不能把本實作寫成「LP 保證 O(K³)」或拿一般 assignment 的複雜度代替。[SciPy 1.15.3 HiGHS 文件](https://docs.scipy.org/doc/scipy-1.15.3/reference/optimize.linprog-highs.html)

目前 n,m≤10，因此最多 100 個變數、20×100 的 dense equality matrix。相對 profile 建立，單次比較規模很小，但 HTTP、JSON 與 solver 啟動仍有常數成本。

若雙方都只有一群且有效，TypeScript 使用已驗證的唯一 flow=1 快速路徑：`O(d)`，沒有 compute HTTP。空群則 `O(1)` 提前返回。

### 9.2 多 genre、解釋與缺資料

`compareProfiles` 按所選 genre **逐一 await**，所以同一配對的延遲是各 genre 呼叫相加。每個 genre 的解釋取最高 contribution 的 transport，再取雙方各三個代表 tag；profile 已把每群 tags 限五個，因此文字解釋本身按 G 計為 `O(G)`。

總分是所選 genre 等權平均；任一缺資料使總分 unavailable，沒有為了計分重新跑分類或分群。配對不會直接讀 raw watch events。

### 9.3 一人對全站

`POST /api/matching-v3/match` 對 `listUsers()` **逐人 await compareProfiles**，不是 ANN／向量索引搜尋，也沒有 precomputed pair score cache。

設實際可比較 P 人，單對成本 Cpair：

`O(U + P·Cpair + P log P + 反覆profile JSON解析/consent/relationship查詢)`。

每個 profile JSON 包含全部 genre centroid；即使只選一類，`store.profile` 仍解析全部 profile，大小約 `O(GKd)`。同一候選在計算前後與最終投影有多次 profile freshness 檢查，沒有只查 builtAt 的輕量路徑。總解析量約 `O(PGKd)`，常數為數次。

有效固定 G、K、d 時，單次總 CPU 可視為約 `O(U log U)`（加 DB 查找），配對數為 O(U)。**全站 U 人各執行一次**則 `Θ(U²)` 次配對，加各自排序 `O(U² log U)`。配對數與排序成本應分別報告。

HTTP 最多 P×G 次，扣除空群、缺資料與 1×1 快速路徑。逐人逐類 await 使單次延遲接近這些 RPC 的總和，而不是除以模型 concurrency。所有 candidates 計算後才回應，沒有分頁／串流早回。

busy Set 只阻止同一使用者重疊發起；其他使用者可同時加入。`compute.py` 使用單一 `HTTPServer`，每個程序一次服務一個請求。Compose 已把 interactive compare 與 background cluster 分成兩個容器，避免二者共用同一 queue；但各自內部仍序列服務。NumPy/BLAS 可能使用內部執行緒，不等於 HTTP 同時處理多個請求。

## 10. 排程、快取與監控的放大成本

### 10.1 V3 job 排程

`runCycle` 先對所有使用者算 source/schedule，claim 後再算 source，完成前再算 source。無重試的正常成功帳號至少有**三次** source 建立／fingerprint。sourceKey 包含 UTC 日數（選 channel type 時），全部九類預計算因此每天都可能重新排 job；即使影片／embedding cache 全命中，profile 聚合與 DBSCAN 仍會重跑，cache 並沒有保存可直接復用的分群工作結果。

`matching_v3_jobs` 只有 user_id 主鍵，沒有 state/retry_at/lease_until queue 索引：

- `claim` 子查詢篩全表後 `ORDER BY retry_at,user_id LIMIT 1`，每次至少可能 O(U) 掃描；LIMIT 1 的 top-one 可線性選取，不能憑 ORDER BY 一律多加 log U。
- U 個 job 的完整領取一輪可能 O(U²)；`queuedWorkDelay`／`nextWorkDelay` 的 MIN 也會掃 job 表。
- `users.find` 每次領取與完成前 `listUsers().find`，整輪另有 O(U²) 查找／結果建構量。
- 非 drain 模式把 visited 序列化並用 json_each 排除，額外按已訪問量成長；drain 模式 exclude 是空陣列，但 visited 仍會隨實際 job attempts 累積。

有重試時以實際 attempts 數 `Rjob` 計為 `O(Rjob·U)` 加 source/build 成本；retryable provider error 可以持續 defer，因此在沒有最終成功／停止條件前不存在有限的「整輪一定完成時間」。成功 cache 已落庫，可避免重付已完成項目的工作，但不能消除每次 source、聚合、序列化成本。

### 10.2 Concurrency、Promise 與資源量

`createDispatchLimiter` 使用 queue/head，每項排入／取出攤銷 O(1)，每次 setImmediate 最多發 32 個；它是讓出事件迴圈，不是固定時間間隔或 RPM quota。

所有帳號 batch 立即建立 Promise，GPT active requests 受 configured concurrency 控制；Gemini embeddingLimit 使用 Infinity。**active cap 不限制全部 pending promises／payload 大小**，也不減少總 CPU／API 工作量。

近似在途記憶體：

`O(所有活躍source/classification + 所有queued batch payload + Cgpt·GPT response bytes + Cembed·64d + 等待cluster的向量payload)`。

其中 Cembed 沒有本機硬上限。即使 Python cluster 序列處理，Node 的不同帳號仍可把多份大型 JSON 請求放在等待中。

GPT 的 `chatJson` 在 onUsage 存在時，還會用 js-tiktoken 重新編碼 system、input 與 output 估算 token。這是每個回應完成時的本機 CPU 工作，需另按實際 tokenizer 對文字 L 的成本計算；provider latency 或 API concurrency 不能涵蓋它。encoder 可重用，但各請求的文字編碼仍重做。

舊的 `createAsyncLimiter` 用 Array.shift 排隊；在一般陣列搬移模型下，一次 dequeue 可能 O(queue length)，排空 Q 個等待者保守 O(Q²)，但 JS 引擎可能優化，沒有做 V8 queue benchmark。它仍被 provider／舊流程使用；不應把新 dispatch queue 的 head 特性套用到所有 limiter。

GeminiKeyPool 有 k 把 key 時，一次 request 最多試 k 把，選取每次最壞掃 k，CPU 上界 O(k²)、HTTP 最多 k 次；429 標冷卻，所有 key 不可用則退出交給 worker 之後重試。通常 k 很小。

### 10.3 Read cache 與全站記憶體

`cachedRead`（[read-cache.ts](../src/data/read-cache.ts)）每 Repository 最多 128 keys，TTL 五分鐘；命中為 revision 比較後回傳物件，按資料量近似 O(1)。但是：

- JSON／HTML 回應序列化仍為 O(輸出 bytes)，不會因 cache 命中而消失。
- 128 限制的是項目數，不是 bytes；單個 comparison profile 最多多組 5,000 列，channel detail 影片列表未設同樣 cap。
- UserRegistry 的 repositories Map 保持開啟的帳號連線，沒有 LRU 關閉；全站 cache／TEMP 表占用會隨 U 累積。
- 每個 key 的 revision 是整個帳號 DB revision，其他表寫入也會使 read cache 失效；持續 ingest／classification 期間不能套用靜態站點的高命中假設。
- `api/...youtube` 的部分 route 直接呼叫 `youtubeDashboard`，沒有 cachedDashboard 外層；仍有 TEMP 物化快取，但聚合 SQL 每次重做。

### 10.4 Admin monitoring

`readMonitoring` 的 cache 分類/count/max 可用 expression index 按 kind 排序掃 Z 個 entry，時間 O(Z)，不是 O(三種 kind)；索引可省 JSON 判型／排序成本，不省 COUNT 的資料量。recent operations 沒有 started_at 索引，需 O(Oₚ) 掃描；recent 50 可用 id 索引。

`readAdminSnapshot` 讀全部 users/profile JSON，完整 profile 解析總量 O(UGKd)，暫時 all() 結果也可能保留所有 JSON bytes；之後只輸出狀態與群數，不改變先前讀入成本。

所以冷 snapshot 約 `O(Z+Oₚ+UGKd+U log U)`，空間最壞包括所有 profile JSON `O(UGKd)`。檔案型 DB 已在獨立 worker thread 執行，30 秒 demand cache 和單個 pending 避免多個 admin 分頁重複掃描；HTTP route 仍每次重新查有效使用者集合，按 U 成長。

Operation 清理每 256 次 INSERT 以 id 範圍刪舊資料，減少清理頻率；但保留五分鐘內全部請求及 running records，**不是固定最多 2,000 筆**。高請求量時 Oₚ 會隨近期吞吐增加。

## 11. 改善優先順序與可保留的語義

以下是分析建議，未實作。優先順序根據觸發頻率與成長風險；實際排序仍應以生產資料量的匿名統計及 profiling 調整。

| 優先 | 對象 | 建議與預期複雜度方向 | 必須驗證的語義 |
| --- | --- | --- | --- |
| 高 | 單筆 capture 全表回填 | 以此次 video ID 定向回填，由全 W 掃描轉為該影片事件範圍 | event channel metadata 補齊結果一致 |
| 高 | 匯入 placeholder 掃描 | 精確 video/day 索引查找，避免每筆掃 A／W；目標 O(B log W + 命中列) | Taipei 日期、exact/day 替換與跨格式去重 |
| 高 | 推估 correlated EXISTS | 以可索引時間範圍先縮小候選，再保留原判定；或預先有序標記鄰近量測事件 | ±300 秒邊界、ISO 時間格式、量測優先與重複去重 |
| 高 | v3 clustering 容量 | 去除重複分群、依 points/counts/版本快取 cluster 結果；評估精確分塊半徑圖以降低峰值 | 不截斷 tag、不變更距離／權重／noise 語義；dense 鄰域仍可能平方 |
| 高 | `/matches` 補齊卡片 | 預建 ranked user ID Set，O(U·P) → O(U+P) | 成員完整性、順序、0 分與 unavailable 卡片 |
| 中高 | v3 全站比較 | 批次 RPC、重用 profile parsed values；若加 pair cache，key 需包含雙 profile/version/genres/floor | 每次仍重新授權／披露，profile 更新立即失效；只優化不等於改分數 |
| 中高 | source／job 全站掃描 | 可重用 latest-watch projection 與 source fingerprint；適配 queue 謂詞的索引、user Map | 資料變更偵測、lease token、重試／dispatch eligibility |
| 中 | 頻道跨會員頁／Insights | 預聚合每帳號頻道排名與來源更新版本；群體結果按 membership/consent/data version 快取 | opt-out／公開狀態即時變更、時間範圍一致 |
| 中 | vector 存取 | existence-only SQL 避免無用 JSON.parse；同 build 復用 vector Map／二進位向量 | cache namespace、模型維度與完成資料保存 |
| 中低 | topic 平滑／race | topic-key lookup、rolling sums；只需 top8 時評估 bounded heap、預先建立 future-entry 順序 | 所有 tie-break、衰減、低分淘汰、補零入場順序 |
| 中低 | keyword／taxonomy sample | 必要時分離 explain 產物、每 video ID 預算一次 stable hash | 顯示 spelling、排序穩定性與證據不變 |

近似最近鄰、改成 k-means、降低 embedding 維度或只保留部分 tags 都可能改變匹配結果，不能當成無語義影響的效能修補。提高 GPT concurrency 不會降低 DBSCAN 的 T²，也不會讓 SQLite 同步聚合或單程序 compare HTTP 自動平行。

## 12. 驗證界線與完整盤點備註

已做程式逐路徑檢查、schema/index 對照、四類 SQL 的合成 EXPLAIN QUERY PLAN，以及觀看時間估算的兩種資料分布量測。未讀取 production user rows、未測模型實際延遲、未做 DBSCAN peak RSS 或全站負載壓測；表中的記憶體尺度為結構推導。

metadata API enrichment 是最多 50 IDs 一批的資料取得與逐列寫入，正常本機 CPU 按輸入／回應 bytes 及 B-tree upsert 次數成長；candidate SQL、分類、頻道回填成本已分列。portability／Takeout 下載與檔案合併不是新的匹配算法，成本按總下載／解壓 bytes 與檔案數計。

`youtubeCounts`、processing counts、history status、reference updatedAt、history coverage 都是前述 COUNT/DISTINCT/EXISTS/MAX 類型，不能因回傳小物件視為常數。scan list 的 `ORDER BY observed_at LIMIT` 沒有以 observed_at 為首的通用索引，最壞仍需掃 H；history chronological listing 可用時間索引，但 activity_type 殘餘篩選與 tie 排序可能多掃事件。

user export 先 COUNT 各表建立 manifest，再使用逐列 JSON／ZIP stream，時間 O(總列數 + 輸出 bytes)，資料列串流額外記憶體主要是單列與小 chunk；但 route 預先建立 personal Crystal，仍需加第 6 節聚合成本。長時間唯讀 transaction 也會延長 snapshot 存活時間。沒有將「串流匯出」誤列為整條 route 常數記憶體。

舊 snapshots／sync_runs／time_ledger schema 在目前原始碼標註 unused，沒有把它們的歷史 migration 當成每個正常請求會執行的活躍聚合。驗證／授權、備份與 UI 動畫本身不屬於匹配數值算法；本文只在它們放大資料庫讀取或伺服器排序時納入。
