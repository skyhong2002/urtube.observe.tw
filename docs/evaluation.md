# 配對效果與使用價值的評估（#92 R17／R18）

本文件說明兩個可重跑的評估工具、執行方式與它們**不能**證明的事。兩者都只使用程式產生的合成資料，在記憶體中執行，不連線外部服務，也不讀取任何真實使用者資料。

> 重要：合成資料上的 relevance 由產生器「埋設」，因此結果只證明 runner、指標與 app 流程能正確運作，**不是**推薦對真人有用的證據。人工標註的 relevance、真實需求與長期效果皆尚未驗證。

```bash
npm run eval -- matching                 # R17：配對效果評估（Markdown 報告輸出到 stdout）
npm run eval -- matching --json out.json # 另存完整 JSON（含 provenance）
npm run eval -- matching --seed 7 --users-per-community 20 --k 5,10,20
npm run eval -- funnel                   # R18：合成使用漏斗
npm run eval -- funnel --users 12 --json funnel.json
```

`scripts/eval/cli.ts` 在載入 app 前強制設定 `DATABASE_PATH=:memory:`、合成 token、關閉 AI 分類與 v3、清空 YouTube／Gemini key，因此即使開發者的 shell 有正式環境變數，也不會連到正式資料或付費服務。漏斗執行期間 `globalThis.fetch` 會被替換成直接拋錯的版本，任何對外連線都會讓步驟失敗而非悄悄送出。

## R17：配對效果評估

### Corpus schema 與 manifest

- Schema：`scripts/eval/corpus.ts`（zod，`schema: "urtube-eval-corpus"`、`schemaVersion: 1`）。每位成員只含彙總輪廓：最近 90 天（`recent`，對應 app 的配對視窗）與前一段（`prior`）的頻道 share、legacy 14 類主題 share 與 coverage、tag 次數與其 genre 標籤；可選的成員 genre 真值；以及 `queries[].judgments[]`（`grade` 0／1／2、`raterId`）。不含觀看事件、時間戳、搜尋或身分。
- `relevanceSource` 為 `planted` 或 `human`；schema 拒絕把 planted relevance 標為 `relevanceVerified: true`。
- Manifest：`scripts/eval/manifest.json`。產生器型 corpus 記錄 generator、seed、corpus 版本與 canonical JSON 的 `expectedSha256`；runner 每次比對 digest，不一致時報告並以非零碼結束。檔案型 corpus 必須填 `consent`（誰、同意了什麼用途）。目前只登錄合成 corpus。

### 正例、負例與評審一致性

- grade 2＝明確相關，1＝部分相關，0＝不相關。P@k 以 grade ≥ 1 為正例；NDCG@k 用 gain `2^grade − 1`、log2 discount，ideal ranking 取該 query 所有已判斷候選。沒有任何正例的 query 不計入 NDCG（報告會列出數量）。
- 多位評審時，以中位數（偶數取較低者）彙整，並計算評審兩兩之間二元標籤的 Cohen's kappa 平均。合成 corpus 只有單一 `planted` 評審，報告標示「無法量測」。人工標註前應先以小樣本試標，kappa 達團隊事先訂定的門檻才擴大標註；門檻尚未決定。

### 合成 corpus（`scripts/eval/synthetic-corpus.ts`）

固定 seed（預設 `20261022`）產生 8 個虛構社群 × 9 人＝72 人。埋設的特性：兩兩共享大類的姊妹社群（jazz／metal、speedrun／strategy）、大部分落在 legacy taxonomy 之外的 civics 社群（News & Politics 本來就被排除）、每人都看的熱門頻道、30% 有次要興趣、20% 的前一段視窗屬於別的社群（興趣漂移）、10% 低於 app 的活動門檻、15% 的 tag genre 標籤故意錯誤。Relevance 只依**最近**興趣：同主社群為 2；一方的次要社群是另一方主社群為 1。

產生器的設計決定了哪些訊號能區分社群，也就決定了哪個方法會贏。例如合成 tag 是從每個社群固定的 48 個字串中抽樣，exact-string tag cosine 因此表現極好；真實 tag 的詞彙量與同義詞遠多於此。

### 比較的方法（`scripts/eval/methods.ts`）

| id | 類型 | 內容 |
| --- | --- | --- |
| `channel-jaccard` | 非 AI baseline | 頻道集合 Jaccard |
| `tag-cosine` | 非 AI baseline | tag 次數向量 cosine，只比對完全相同的字串 |
| `legacy-calibrated` | 現行 app | `matchingCandidateSimilarity()`＋`calibratedMatchScore()`（`calibrated-v2`），輸入為與 worker 相同上限的 registry crystal 投影；app 不會計分的配對（活動量不足）列為無法計分 |
| `legacy-compare-raw` | 現行 app | `compareCrystals()` 的頻道／主題 cosine 平均，未經校準（校準曲線的 ablation） |
| `v3-single-cluster-local` | 現行 app（降級） | `compareProfiles()`＋真正的 `computeClient`。每個 genre 只保留一個 centroid，1×1 比較在 Node 內本地計算；其他形狀一律拒絕，不會連線。這**不是**正式 v3：沒有 compact-medoid 分群與 optimal transport，genre 標籤來自 corpus 而非 GPT 分類，向量是合成的而非 Gemini embeddings |
| `v3-compact-medoid-ot` | 需要 compute service | 正式 v3。需要 Python `services/matching-compute` 與真實 embeddings，本 runner 明確略過，不報告任何數字 |

所有方法在本機執行：0 次模型／API／embedding 呼叫，0 次 compute service 請求。

### 指標與報告內容

- 每個方法的 P@5、NDCG@5、P@10、NDCG@10（k 可調），附 query 層級 percentile bootstrap 95% 區間（固定 seed，1,000 次）。不同 query 共用候選人，區間偏樂觀；重疊區間內的差異不具意義。
- 可計分配對比例與「至少有一位可計分候選人」的 query 比例。
- Genre macro-F1：以成員最近 tag mass 中占比 ≥ 門檻的 genre 作為預測，與成員 genre 真值比較（8 個內容類別）。合成資料的 per-tag genre 是加了雜訊的模擬分類結果，所以這只檢查彙整門檻，不評估 GPT 分類器。
- 錯誤分析：每個方法 NDCG 最低的 3 個 query，列出前三名候選人的 grade 與合成註記（社群、次要興趣、sparse、drift）。
- Provenance：corpus id／版本／sha256（與 manifest 是否一致）、generator 與 seed、`git rev-parse HEAD` 與工作樹是否有未提交變更、Node 版本、各方法版本（含 v3 settings digest 與 similarityFloor）、成本。

### Ablation

已實作：

- recency weight：`w × recent + (1 − w) × prior`，w ∈ {0.5, 0.75, 1}；app 預設為 1（只看 90 天視窗）。套用於 `legacy-calibrated`、`tag-cosine`、`v3-single-cluster-local`。
- v3 `similarityFloor` ∈ {0, 0.5, 0.7, 0.9}；正式預設 0.7。
- 校準曲線：`legacy-calibrated` 與 `legacy-compare-raw` 的對照。
- genre 門檻 ∈ {0.05, 0.1, 0.2, 0.3}。

未實作：分群開／關與 optimal transport 對 centroid（需要 compute service）；calibrated-v2 內 topic／channel 權重（app 中固定等權平均，未參數化）；`compactDistance`／`minSamples`（只有 compute service 使用）。

### 範例輸出（合成資料，不代表真實效果）

在 revision `55128f1`（工作樹含其他未提交變更）、Node v24.15.0、預設 seed 下執行 `npm run eval -- matching` 的部分結果：

| method | 可計分配對 | P@10 | NDCG@10 |
| --- | --- | --- | --- |
| channel-jaccard | 100% | 0.881 | 0.869 |
| tag-cosine | 100% | 0.961 | 0.998 |
| legacy-calibrated | 76% | 0.583 | 0.650 |
| legacy-compare-raw | 100% | 0.803 | 0.885 |
| v3-single-cluster-local | 100% | 0.961 | 0.955 |
| v3-compact-medoid-ot | — | 略過 | 略過 |

在這個合成 corpus 上，非 AI 的 exact tag cosine 最好，這來自產生器的小詞彙設計，不能推論真實情況下 AI 不必要或必要。`legacy-calibrated` 偏低的主因可在錯誤分析看到：低活動量的人無法計分（app 刻意如此），以及熱門頻道使 `calibrated-v2` 的頻道曲線很快飽和。數字會隨程式版本改變；corpus 本身由 manifest digest 固定。

### 限制

- 只有合成資料與 planted relevance；72 位成員、單一評審，無法估計真實的評審一致性。
- 正式 v3（分群＋OT、Gemini embeddings、GPT genre 分類）沒有被評估。
- 只評估排序，不評估使用者看到的說明、隱私揭露或 UI。
- 沒有成本／延遲比較：所有方法本地執行，正式 v3 的 API 與 compute 成本另見 [matching-v3](matching-v3.md)。

## R18：需求與價值的量測

### 主要目標族群與 job-to-be-done（假設，尚未經研究驗證）

- **目標族群**：長期使用 YouTube、想在原有生活圈外認識有共同興趣朋友的成年人，例如剛進入新學校、新職場或新城市的人。
- **Job-to-be-done**：「當我想認識能長期聊同樣興趣的人時，我想用自己已經存在的觀看紀錄，快速找到真的有共同話題的人並開始交流，而不必先自己寫一長串興趣標籤。」
- **首次價值**：使用者第一次看到可信的私人洞察（app 的配對資料門檻已達成：最近 90 天 ≥ 200 次觀看、≥ 14 個活動日、主題 coverage ≥ 0.8），且可以進入同好探索。

目前沒有訪談、問卷或使用數據支持這個定義；它是後續驗證要檢驗的假設。

### 合成漏斗（`scripts/eval/funnel.ts`）

透過 `createApp`／`createIngestApp` 的真實 HTTP 路由與 in-memory registry 執行：

1. **signup**：建立已驗證的 pending signup（取代無法離線執行的 Google OAuth 一步），再 `POST /signup`。
2. **import**：`POST /extension-setup/token` 取得 capture token，以 `POST /api/ingest/youtube/history` 分批上傳合成觀看紀錄。
3. **first-insight**：執行一次真正的 `runYoutubeWorkerCycle`；只有 YouTube 影片資訊由合成資料取代，配對分類、crystal 投影與 registry 發布都是正式程式。需通過 `registryCrystalEligible` 與 coverage 門檻，且本人儀表板回應 200。
4. **opt-in**：`POST /onboarding/finish` 明確開啟好友探索（app 只在資料達門檻後接受）。
5. **match-candidate**：`GET /matches` 出現候選卡片。
6. **invite**：偶數序號的人邀請排名最高、尚無關係的候選人。
7. **accept**：受邀者從邀請者頁面回覆。**接受與否是埋設的規則**（同一合成社群才接受，或 `decline-all`），接受後檢查好友的 Insights 可讀取。

報告每一步的到達數／可進入數、首次價值時間（wall-clock 毫秒）、到首次價值的動作數（HTTP 請求＋worker cycle，具決定性）、第一名候選人是否同社群、埋設規則下的邀請接受率。

範例（預設 6 人、seed `20261022`）：七個步驟皆 100%；到首次價值 7 個動作；wall-clock 中位數約 30–50 ms。這只代表流程可以走通，真實首次價值時間主要取決於擴充功能掃描、YouTube Data API 配額與 worker 排程，皆未模擬。

### 未驗證

- 真實的首次價值時間、邀請接受率、使用者認定的推薦相關性。
- 長期效果：友誼是否形成、是否持續交流、留存。**目前沒有任何資料，也不收集。**

### 若未來要量測（僅設計，未實作；需另行經使用者核准並更新隱私權政策）

- **明確 opt-in**：獨立設定，預設關閉，不與配對同意或儀表板公開綁定；可隨時撤回。
- **最少化**：只記錄少數事件（到達首次價值、送出邀請、邀請結果 accepted／declined、可選的推薦相關性 1–3 分），以日為粒度；不記錄觀看內容、tag、搜尋或自由文字，不保存對方身分，只存隨機 ID。
- **可刪除**：撤回同意或刪除帳號時一併刪除；設定固定保存期限（例如 180 天）後自動刪除。
- **呈現**：只發布彙總數字，每格至少 5 人，否則不顯示；報告標示樣本數與期間。
- 長期交流只能透過使用者自願回報，不從私訊或其他行為推測。

## 測試

`tests/evaluation-matching.test.ts` 以手算的小 fixture 驗證 P@k、NDCG@k、macro-F1、Cohen's kappa、中位數彙整、決定性排序、schema 拒絕條件、manifest digest 重現，並在小型合成 corpus 上跑完所有方法。`tests/evaluation-funnel.test.ts` 驗證漏斗七步全部完成、對外 fetch 防護會被還原，以及 decline 路徑。
