# Matching v3：tag 分群與分布配對

## 2026-09-06：與正式 Matches 整合（以下規則優先）

- 唯一正式入口為 `/matches`。啟用 V3 時，同頁提供所有成員、好友邀請與我的主題；`/matching-v3` 轉到 `/matches?view=topics`。不再將 `/matches` 強制轉去匿名列表。
- 所有成員仍顯示整體合拍度（沒有可計算資料時為 `—`）。主題結果另外標示主題合拍度，保留 V3 等權分布算法、暫定狀態與缺資料語意，不混用兩種分數。
- V3 結果使用真實姓名、頭像與 Profile 連結，重用同一套好友邀請與 Blend 按鈕。`/api/matching-v3/match` 的候選項目現在包含 handle、displayName、detailsVisible，以及正式 app 提供的 memberHtml；不再使用不可操作的隨機匿名 ID。
- 代表 tags、权重與詳細推薦理由僅對好友或公開帳號開放，仍需雙方同意所選 V3 類別。非好友私人帳號只提供身分與分數，詳細 reasons/details 為空；服務端在非同步計算全部完成後重新檢查 session、類別、公開狀態、好友關係與輪廓版本。
- 公開 Profile／直接 Blend 沿用正式站規則，不要求 V3 輪廓完成或 V3 類別同意。好友可看 Overview／Insights；History／Recap 仍需本人或 dashboard key。
- 好友邀請與舊分類器的資料資格分開：V3-only 成員也能送出／接受邀請，仍保留雙方 opt-in、token 到期、使用者綁定、拒絕與撤銷保護。舊版分數與 legacy discovery token 的資格檢查不變。
- 衝突合併保留舊分類器的重試回饋、timeout，並加入 V3 的獨立 limiter、用量監控及請求選項。分類／embedding 快取與 profile version 不重建。

### 正式 app 部署

既有 V3 worker／compute 已運作且共用正式 registry 時，可在正式 compose 加上 `compose.matching-v3-app.yml`。設定 `MATCHING_V3_ENV_FILE` 指向與既有 worker 相同版本設定的受保護環境檔，`MATCHING_V3_COMPUTE_NETWORK` 指向 compute 所在 Docker network（預設 `urtube-local_default`）。app 必須能透過該網路解析 `matching-compute:8090`。

此 overlay 只連接既有數值服務，不新增 worker、不更改其併發／API 額度、不刪除已完成快取。應先備份 registry，驗證 app 與 worker 的演算法版本一致，再啟用入口。下方較早的匿名 UI／入口轉址／費用設定段落為開發歷程，以本節與現行環境設定為準。

驗證：`npm run check`、隔離 Python 六項數值測試，以及 `scripts/check-matching-v3.ts` 的瀏覽器測試；測試不讀正式資料或呼叫付費分類 API。


實作於目前的 dev 分支。`MATCHING_V3_ENABLED` 預設關閉：不建立 v3 表、不排程 OpenAI，也不改變原本 `/matches` 的行為。新版入口為 `/matching-v3`，原本 `/match-preview/` 仍是獨立互動原型。

## 現行資料版本相容性

正式 app 與既有 worker 使用相同的 `MATCHING_V3_BACKFILL_VIDEO_LIMIT`（預設 2,000）。取最近觀看的不同影片後，依影片 ID 固定排序；上限納入輪廓版本。bootstrap、排程、重建與讀取共同沿用此設定，避免完成輪廓被誤判為舊版本。此修正不重啟既有 worker，也不清除分類／embedding 快取。

## 文字與費用限制

分類使用 `gpt-5.6-luna`（API ID 為 luna，不是 lunar），沿用 `src/youtube/ai.ts` 的 `chatJson`：Chat Completions + `response_format=json_object`、`temperature=0`，請求最多 2,048 output tokens；JSON schema 放在文字提示並以 Zod 驗證。相容現有 gateway 沒有 `finish_reason` 的回應及 fenced JSON。影片 payload 僅含 title（最多 1,000 字元）及 tags（最多 30 個，每個最多 100 字元）；頻道 payload 僅含名稱（200 字元）與描述（3,000 字元）。所有 messages.content 都是純文字，沒有圖片、影音、附件、工具或網頁搜尋。Gemini embedding 僅傳每個 tag 的 text part，不包含媒體內容。

分類沿用專案的 `AI_BASE_URL`／`AI_API_KEY`，僅新版配對的模型指定為 `gpt-5.6-luna`，不修改舊分類器的 `AI_MODEL`。可用 `MATCHING_V3_BASE_URL`／`MATCHING_V3_API_KEY` 個別覆寫；沒有既有設定時才使用 `OPENAI_BASE_URL`／`OPENAI_API_KEY`。Embedding 固定呼叫 Google Gemini Developer API，僅讀取獨立的 `GEMINI_API_KEY`，不沿用 GPT key，也不再使用 gateway 的 `/embeddings`。

新版輪廓版本已更換為 GPT 分類 + Gemini embedding；模型、task、維度及 endpoint 都納入快取識別，舊 OpenAI 向量不會混入。

## 資料與計算

1. 依使用者要求，全站帳號預先建立固定九類輪廓，不等待選擇。主題可選 1–9 類；選擇僅控制結果與揭露，改變選擇不刪除已算好的輪廓。bootstrap 只對已參與配對且尚無新版設定的帳號建立預設主題，保留既有選擇。
2. worker 每輪完成後休息 30 秒，讀取全站使用者的所有可用歷史，以 `DISTINCT video_id` 去重。掃描或中繼資料變化會產生新 fingerprint；新增資料不必等待使用者按配對才開始分類。
3. 分類預設每批 5 部（`MATCHING_V3_CLASSIFICATION_BATCH_SIZE` 可設 1–20），失敗重試時縮小批次；每批分類落庫後立即建立缺少的 tag 向量，不等完整帳號分類完。公開標題與原始 tags／hashtags 送 `gpt-5.6-luna`，多標籤分類到前八個內容類別，逐 tag 指定其適用類別。**沒有 tag 才根據標題補最多 5 個保守 tag**；保留 `tagSource=generated`，資訊不足允許空結果。既有 tags 不讓模型任意添加。
4. embedding 的唯一文字輸入是正規化後的 **單一 tag**；不拼上標題、genre、次數或個人資訊。使用 `gemini-embedding-001`、`SEMANTIC_SIMILARITY` task、768 維並 L2 正規化。64 個 tag 一批，回傳數量／維度／數值皆驗證。
5. 每個使用者、每個內容 genre：同一影片的同一 tag 只計一次。以不同影片數作 DBSCAN 的 `sample_weight`，cosine distance、`eps=0.2`、`min_samples=5`。移除 noise、低於總 tag 權重 5% 的群，保留權重最大的最多 10 群。質心為群內加權平均後正規化，不把不同興趣全部平均。
6. 保存群的質心、原始 mass、保留群中 share、代表 tags 及其原始／補標籤計數。`retainedCoverage` 的分母是**去除 noise／小群以前的總 tag 權重**，不把丟失的資料藏起來。低於 50% 時標為資料不足。
7. 兩人同一 genre 的質心 cosine 值轉成 `K = clamp((cosine - 0.7) / 0.3, 0, 1)`。以 SciPy HiGHS 求解精確 optimal transport：`max Σ T[i,j] K[i,j]`，每列／每欄總量分別等於雙方群的 share。每份權重只能用一次，避免 Max Similarity 將小小交集灌成高分。
8. 所選 genre **等權平均**。已處理且確定沒有該類興趣給 0；缺少類別輪廓則不產生總分。不完整掃描、未能分類或低覆蓋標為暫定，排在完整結果之後。舊版本輪廓不混算；尚有工作處理中的舊快照亦標為暫定。

上述 DBSCAN／相似度門檻是可調整的初始參數，尚未以真實 Gemini 向量校準。分數是此演算法的分布相似度，**不是交友成功機率**。

### 權重與範例

權重是 tag 在不同影片中出現的次數。含多個 tag 的影片可以對多個 tag 貢獻，所以「tag 權重占比」不等於觀看時間比例或互斥的影片比例。跨 genre 的多標籤影片可在每個適用 genre 出現一次。

語義測試 fixture 讓三種球類向量接近、拳擊向量正交。A 的球類權重 10、拳擊 9，B 的球類 4 被判定為 noise、拳擊 100：A 有兩群，B 有一群，分布配對為 `9/19 ≈ 47.37%`，而非因共同拳擊給 100%。B 的保留覆蓋仍是 `100/104`。

會議中任意填入的四維數字並不滿足球類距離均小於拳擊距離，不能據此承諾同樣分群；正式結果取決於 tag 語義向量。

### channel type

第九類比較**頻道經營類型的分布**，不是「訂閱同一頻道」，不使用 tag embedding 或 DBSCAN。內部類型為：

- personal creator：個人創作者／主持人
- media team：媒體／編輯團隊
- educational institution：教育／專業機構
- official brand：官方品牌／公司
- curated compilation：策展／彙整型頻道

透過 YouTube API 取得公開頻道名稱及 description，再由 `gpt-5.6-luna` 判斷。證據不足保留 unknown。以看過的不同影片計數；多類型頻道的影片在各適用類型貢獻一次，再將全部類型貢獻正規化。類型 one-hot 配對等價於 histogram intersection。這些內部類型不增加前端可選 genre。

成功的頻道分類快取 30 天，缺少公開證據快取 5 分鐘，含 channel type 的輪廓每天重新檢查一次。未設定 `YOUTUBE_API_KEY` 時此類別會顯示資料不足。

## 說明與揭露

推薦文字由 `matching.ts` 用此次 optimal transport 的實際對應群、代表 tags、雙方 share 和對分數的貢獻組成。**沒有呼叫 LLM 生成推薦理由**。回應附雙方輪廓時間及演算法版本，避免拿另一份快照的說明拼接分數。

含模型補出的代表 tag 會明確標記。數字是實際計算，但補標籤仍屬模型推論，不宣稱影片內容已經人工驗證；觀看政治內容也不等於使用者具有某種政治立場。

列表保持匿名，不輸出候選人的 handle、真實觀看事件、影片 ID 或向量。新版類別同意文案說明代表 tag／權重比例的揭露；撤回類別立即停止該類別的配對揭露，但保留內部預先計算的輪廓，整體退出配對立即從結果中排除。此版不新增聊天／聯絡功能。

## 儲存及可靠性

- `users.sqlite` 新增 `matching_v3_cache/preferences/profiles/jobs/api_budget`，僅啟用時建表。原始观看歷史仍只讀取既有個人資料庫，沒有改寫舊資料表或 user_version。
- 共用快取僅放公開影片分類、tag 向量與頻道類型，key 包含文字／metadata／模型版本等必要欄位。個人輪廓預先保存九類的聚合資料；API 仍逐次檢查參與與類別選擇。
- 個人 v3 rows 對 users 有 `ON DELETE CASCADE`；原有 SQLite 備份／還原會包含這些新表。
- 每個使用者工作有租約 token、心跳、重試時間。新輸入會使舊工作失效；啟用輪廓前再次核對來源／授權及工作 token，在單一 transaction 內發布。
- API 429／5xx／timeout 採指數退避，最長一小時，持續自動重試；其他 HTTP 錯誤直接標示失敗，持續無效資料則最多失敗五次後等候處理。紀錄僅保存安全錯誤碼，不保存 provider 回應或金鑰。
- 每個帳號每輪最多 3 次操作以輪流推進；每一 cycle 預設最多 20 次外部處理操作；達上限的工作續接快取，不重新呼叫已成功完成的項目。另有 `MATCHING_V3_DAILY_API_CALLS=200` 的全站每日操作上限，SQLite 原子計數跨 worker／重啟保留。到達上限暫停至 UTC 午夜（台灣上午 8 點），失敗請求也計入；這不是美元金額保證，API gateway 仍可能有不同計價。設定 `0` 可取消每日上限但持續計數；目前部署仍使用 `200`；無上限啟動遭自動核准審查拒絕，調整前需明確費用授權，沒有全站 1 RPM 限制。
- 每個 genre 超過 10,000 個不同 tag 明確失敗，避免默默截斷使用者興趣。數值容器限制 2 GB、2 CPU；大型資料仍需再做記憶體／延遲壓測。
- 完整掃描判定使用現有 `history-start` 覆蓋證據。只有匯入部分 archive 或尚未完整掃描的使用者，仍可看到標記為暫定的结果。

## 啟用

不要直接在目前共用正式資料的容器手動啟動無上限回填。先建立被 git 忽略的 `.env.matching-v3`：

```dotenv
GEMINI_API_KEY=your-gemini-key
# GPT 分類沿用既有 AI_BASE_URL / AI_API_KEY
MATCHING_V3_COMPUTE_TOKEN=a-random-secret-at-least-32-characters
MATCHING_V3_CALLS_PER_CYCLE=20
MATCHING_V3_DAILY_API_CALLS=200
```

先在**隔離資料**測試：

```sh
docker compose -p urtube-v3-dev -f compose.local.yml -f compose.matching-v3.yml build
```

若舊開發站仍占用 19080／19081，請使用另一份 port override；勿同時直接 `up proxy ingest`。可只啟動 app、matching-compute、matching-worker，透過 Docker 網路或額外的本機 port override 預覽。新專案名稱會建立自己的 `local-data` volume；需要測試帳號與測試影片，預設沒有正式使用者資料。

要對**既有共用正式資料**啟用時，必須同時使用四份設定，讓 app、ingest、v3 worker 指向同一份 volume：

```sh
docker compose -f compose.local.yml -f compose.production-data.yml \
  -f compose.matching-v3.yml -f compose.matching-v3-production-data.yml \
  up -d --build app matching-compute matching-worker
```

此命令會開始對全站帳號預先分類及建立 Gemini 向量，並寫入共用 registry。首次應先不啟动常駐 matching-worker，改用同組 compose 的 `run --rm matching-worker npx tsx src/matching-v3/worker.ts --once` 做有上限驗證。之後在 `http://localhost:19080/matching-v3` 選興趣、建主題，等待輪廓完成後配對。

停用：停掉 matching-worker／matching-compute，以原來兩份 compose 重新建立 app 即可；無需刪資料或回滾原有 DB schema。

## 驗證

```sh
npm run check
docker build -t urtube-matching-compute:dev services/matching-compute
docker run --rm -v "$PWD/services/matching-compute:/app:ro" \
  urtube-matching-compute:dev python -m unittest -v test_compute
```

Node 測試使用 in-memory 資料與 fake OpenAI；Python 測試用固定向量，驗證比例降分、對稱性、同輪廓得 1、權重守恆、noise、Top 10、無效向量與頻道比例。未使用正式使用者資料作測試 fixture。

2026-09-05 驗證結果：207 項 Node 測試（含 Node→Python HTTP）及 6 項 Python 測試通過。`scripts/check-matching-v3.ts` 的 Chromium 測試也通過：九類全選、主題儲存／重載、最少一類驗證、API 回傳的推薦依據、390px 手機版無橫向溢出。桌面與手機截圖存於忽略追蹤的 `release/matching-v3/`。

原始版本未啟用共用正式資料回填；模型回覆品質、實際語義向量門檻及全站處理成本仍需在受控批次驗證。混合 provider 可使用 `scripts/check-matching-provider.ts` 發送兩筆人工文字請求，檢查分類／embedding 連線；此工具不讀使用者資料或寫入輪廓。

參考：[GPT-5.6 Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna)、[OpenAI structured output](https://developers.openai.com/api/docs/guides/structured-outputs)、[Gemini embedding REST](https://ai.google.dev/api/embeddings)、[DBSCAN sample_weight](https://scikit-learn.org/stable/modules/generated/sklearn.cluster.DBSCAN.html)、[SciPy HiGHS](https://docs.scipy.org/doc/scipy/reference/optimize.linprog-highs.html)。

目前 gateway 驗證：加上 `host.docker.internal:host-gateway` 後，沿用 chatJson 以人工標題與 tag 呼叫 Luna 分類成功；GPT gateway 的 `/embeddings` 不再使用；tag 向量改由 Gemini API 提供，須在 `.env.matching-v3` 設定 `GEMINI_API_KEY` 才能驗證真實向量配對。

## 目前開發部署狀態

2026-09-05 已依使用者要求啟動四份 compose overlay：app、matching-worker、matching-compute 正常執行，沿用共享正式資料。GPT 分類與 Gemini embedding 均以人工文字實測成功。新版入口為 http://localhost:19080/matching-v3。之後已依新要求執行 `scripts/bootstrap-matching-v3.ts` 並改為全站九類預先計算。`/matches` 在功能啟用時導向 `/matching-v3`。介面顯示分類／embedding 工作進度；已排程或已有 tag 向量不代表完整個人輪廓已完成。舊原型的瀏覽器主題不會自動搬入新版。

啟動前備份：正式備份容器內 `/data/backups/urtube-2026-09-05T13-17-08-495Z`。

## 管理員即時監控

`MATCHING_V3_ADMIN_HANDLES` 為以逗號分隔的帳號白名單，預設空白（無人可讀）。使用既有 Google 登入 session；一般登入使用者也無法讀取管理 API。管理員在配對頁可見「資料處理監控」，入口 `/matching-v3/admin`，可見分頁每 30 秒更新，切到背景時暫停，回到前景即重新讀取；失敗時退避至 60／120 秒。畫面顯示統計實際取樣時間。提供共用分類／向量快取、各帳號工作進度、九類輪廓狀態、worker 心跳、近五分鐘操作數與最近 50 次操作。操作記錄只保存時間、類型、項目數及安全錯誤碼，保留最近約 2,000 筆；不保存提示詞或原始回應。監控啟用前的呼叫數不回填捏造。

「重試」沿用既有快取並清除失敗退避，不搶佔正在執行的工作；寫入端點檢查管理員與 Origin。API 回應皆 no-store，不傳回金鑰、觀看事件、tag 文字或向量。

使用者隨後明確批准暫時開放每日上限；当前開發部署採 `MATCHING_V3_DAILY_API_CALLS=0`，繼續計數並保留 provider 限流退避。此為暫時回填設定，管理頁清楚顯示；恢復上限需修改環境設定並重建 app / matching-worker。

使用者要求加速後，開發部署分類 batch 調為 20（真實 20 部成功批次約 40 秒），並行帳號工作數 `MATCHING_V3_CONCURRENCY=4`。批次的 output 上限按批量給足文字容量（20 部為 14,512 tokens），不是實際用量。不同工作共用 API 操作預算；每輪每帳號只領一次，租約防止重複執行，失敗時縮小批次並退避。現有 GPT client 同時最多四個請求。

管理員操作表保存 provider 回傳的 input/output usage；gateway 缺少 usage 時顯示「供應商未回傳」及文字字元數，絕不把字元數或 output 上限當作實際 tokens。

## 分類效能診斷（2026-09-05）

使用者指定 `gpt-5.6-luna`、`reasoning_effort=low`；matching provider 現在每次明確送出 low，既有非 matching 分類呼叫不變。先前未送 effort，不能假設以前也是 low。現有 gateway 不回傳 model 或 usage；請求設定可驗證，但無法從回應獨立證實上游模型／effort。不存在模型的人工負向控制得到 HTTP 502，沒有 completion。

監控操作紀錄新增本機 FIFO 排隊毫秒、非串流 HTTP 完整回應毫秒、請求模型／effort、回傳模型（若有），以及 o200k_base 可見文字 token 估算。`輸出 tok/s（全程）= output tokens / ((queueMs + requestMs) / 1000)`，usage 不存在時改用 estimatedOutputTokens 並明確標示。估算不包含隱藏 reasoning 或訊息封裝；不可當成帳單 token 數。HTTP 耗時含 gateway 排隊、網路與生成，非串流無法量得首 token 延遲或純解碼速度。

## 最新決定：先以影片層級 genre 分類加速（2026-09-05）

此節覆蓋前述逐 tag 分類及補標籤規則。使用者要求趕進度，**只對尚未分類的影片套用，不清除、遷移或重新呼叫既有分類與 embedding 快取**，輪廓版本亦不強制變更。

- 單片 GPT 回覆僅 `{"genres":["News"]}`。批次仍為 `{"videos":[{"genres":["News"]}, ...]}`，按輸入順序每片一列。
- GPT 不再回傳 tagIndexes、tag assignments 或 generatedTags。仍為 gpt-5.6-luna、low effort，僅輸入文字標題及既有 tags。
- 程式將影片的所有既有 tags 納入每個回傳 genre；沒有分類的影片，其既有 tags 也可先建立共用 Gemini 向量快取。tag 向量按文字去重沿用。
- 無 tags 的影片仍保存 genre 分類，但不生成 tags、不送空字串至 Gemini，也不以標題代替 tag embedding；該 genre 若只有此類影片則標示向量資料不足。
- 新資料移除來源處的 30-tag 截斷。為保留舊快取，查找既有分類仍沿用舊版 key 的前 30 個有效 tag 識別；這次不因新增識別規則重算已完成資料。因此暫時可能同時存在舊逐 tag／生成標籤結果及新全 tags 結果。

### 之後可以考慮加回

1. 缺少 tags 時依標題產生保守標籤，補足目前無法建立語義向量的影片；需評估成本及品質並保留生成來源標記。
2. 同片 tags 逐一分配 genre，減少無關標籤進入某類 pool；若恢復索引設計，需明示索引或採受約束輸出，避免越界。
3. 有時間再決定是否統一重建舊分類／輪廓，消除暫時混合規則；本次不執行。


使用者要求分類工作加倍後，開發部署改為 `MATCHING_V3_CONCURRENCY=8`，每輪操作額度由 20 增為 40。matching GPT client 使用跨 provider 實例共享的 8 請求 limiter，避免排程加倍卻仍受舊 4 請求限制；舊非 matching 分類器保持原本 4。仍為每批最多 20 部、Luna low、既有快取沿用及 API 限流退避。8 是並行上限，不保證任意時刻都有 8 個請求或吞吐量一定加倍。

## 正式資料持久化確認與備份（2026-09-05）

已從 Docker 實際掛載核對 `urtube-app`、`urtube-worker`、`urtube-backup`、`urtube-local-app-1` 與 `urtube-local-matching-worker-1` 共用外部 volume `urtube_urtube-data`，掛載至 `/data`。matching 表位於 `/data/users.sqlite`，不是容器暫存層。正式站容器也直接讀得到 matching 分類、向量及輪廓。這不代表正式站舊版 UI 已切換新版配對程式。

已建立完整線上備份 `/backups/manual-matching-v3-2026-09-05T15-09-51-341Z`，主機實際位置 `/home/deck/Backups/urtube/nightly/manual-matching-v3-2026-09-05T15-09-51-341Z`。包含 15 位使用者、16 個 SQLite 檔、888,176,640 bytes；registry 備份內有 13,096 筆 matching cache 及全部 matching 表。既有備份流程執行 SQLite integrity_check 並產生 SHA-256 manifest；未對線上資料執行還原演練。此手動備份名稱不屬於每日備份自動輪替的命名範圍。

部署時持續使用全部四份 overlay；不要以不含 `compose.matching-v3-production-data.yml` 的設定重新建立 matching worker。容器更新會保留外部資料卷；此主機備份不是異地備份。


使用者再要求提高 worker 後，部署並行上限為 16、每輪操作額度為 80；GPT limiter 隨相同設定共用 16 個位置。每批仍最多 20 部。由於目前按使用者租約排程，實際活躍數也受未完成帳號數、退避及各階段可用工作限制；設定 16 不表示一定有 16 個 GPT 請求。擴大前最近五分鐘未觀察到 429，但回覆延遲仍可能限制吞吐量。

### 持續送出模式（最新）

依使用者要求，移除「每個帳號每輪 3 次操作」限制，並移除每輪固定 30 秒休息。可執行工作在輪次額度用完後立刻續接快取，無錯誤的重新排程延遲由 1 秒改為 0。每輪 80 次操作是刷新工作排程的邊界，不再附加休息時間；16 並行限制仍有效。

只有沒有可執行工作時，才依重試／租約到期時間等待，最多 5 秒便重新檢查。429、供應商錯誤及無效結果的退避保留，避免失敗請求無限連發。停止訊號會在目前 API 完成後讓出工作，避免繼續發送下一批。舊快取與正式資料卷不變。

使用者隨後指定並行上限 32：部署 `MATCHING_V3_CONCURRENCY=32`，每輪刷新額度 160，配合以上零固定等待模式。GPT limiter 同步 32；實際活躍数仍受未完成帳號與可用工作限制。

## OpenAI 官方端點與最新並行設定

使用者提供新的 OpenAI API key 後，matching 專用 `MATCHING_V3_BASE_URL=https://api.openai.com/v1`，金鑰只存忽略追蹤且權限 600 的 `.env.matching-v3`。不修改正式站舊分類器的 AI_API_KEY。人工文字請求已成功，官方回傳模型為 gpt-5.6-luna，請求 effort=low，且有實際 usage。官方 low reasoning 請求不傳 temperature；原 gateway 保持相容設定。

部署 `MATCHING_V3_CONCURRENCY=1500`，`MATCHING_V3_CALLS_PER_CYCLE=0`、`MATCHING_V3_DAILY_API_CALLS=0` 代表不另设每輪／每日操作額度，也沒有本機 RPM 節流。API 實際 429／暫時錯誤仍退避重試。1500 是允許的並行上限；目前按使用者租約處理，實際可同時執行多少也取決於未完成帳號及可用工作，不能把設定值當成已送出 1500 個請求。

依先前指示保留舊快取，透過 `MATCHING_V3_CLASSIFICATION_CACHE_NAMESPACE` 維持先前 gateway 的快取識別。分類快取、channel type 快取及 profile 版本沿用此命名空間；新請求走官方端點，但不因端點切換重新分類已完成資料。Gemini embedding 的 key、端點及快取不變。

使用者最終將並行上限調整為 **5000**；不另設本機 RPM／每日／每輪請求配額，原始資料與快取沿用。無每輪額度時工作槽會持續領取到期工作，失敗退避到期後不用等待其他大帳號全部完成。


### 同帳號批次並行（2026-09-05）

使用者要求每個帳號的待分類影片批次全部立即進入排程，不再逐批等待。
影片分類、Gemini tag 批次與頻道處理共用全站 API 執行上限（目前 5000）；
影片仍依既有 batch size 打包，5000 指同時執行的請求／處理操作上限，不是每分鐘配額。
沒有固定發送間隔。所有帳號共用執行中的快取鍵，避免同一影片、頻道或 tag 重複付費。
分類結果逐批寫入原有正式資料庫；同一帳號有批次失敗時，等待其他已派出批次結束後
才釋放工作租約，成功快取保留，重試只補缺漏。所有必要資料完成後才發布新版 profile。
已有的 HTTP 429／服務錯誤退避仍適用於失敗工作的重試。

- Latest requested concurrency ceiling: 10000. Keep all pending account batches eligible immediately, without a fixed send interval or additional RPM quota. Concurrency is simultaneous requests, distinct from observed requests per minute. Preserve provider error backoff and completed caches.

### Gemini 多 key 設定

在未追蹤的 `.env.matching-v3` 加入 `GEMINI_API_KEYS=key1,key2,key3,key4,key5`。
非空時取代 `GEMINI_API_KEY`，空值時沿用單 key；會去除重複 key。
所有 worker 帳號共用 round-robin key pool；429 後該 key 至少冷卻 60 秒，
若 Retry-After 或 Gemini RetryInfo 指定更久則遵循更久的時間。
當次 embedding 會改試其他可用 key；全部冷卻時交回既有工作重試，不持續空轉。
401/403 key 在此 process 內停用；更正設定並重啟後恢復。
冷卻状态僅保存在記憶體，重啟會重設。金鑰不影響 embedding/cache/profile version，既有結果保留。
目前監控計數是邏輯 embedding 批次，跨 key 重試可能包含多次 HTTP 請求。
Google 配額按 project 而非 key 計算，同一 project 的多 key 不會提高 RPM：
https://ai.google.dev/gemini-api/docs/rate-limits

### Embedding 排程隔離

GPT 與 Gemini 各自使用獨立的全站請求佇列，GPT 上限為 MATCHING_V3_CONCURRENCY；
Gemini 依使用者最新要求不設本機並行上限。
因此此設定不再代表兩個 API 相加的總並行量。Gemini 不排在 GPT 待送批次之後。
每次 event-loop turn 派送最多 32 個新操作，再以 setImmediate 讓網路回應及心跳執行，
沒有固定毫秒等待或 RPM 節流。监控紀錄清理每 256 個新操作執行一次，保留最近五分鐘的
完成紀錄及所有執行中紀錄，減少 SQLite 同步工作阻塞請求回應。

### 2026-09-06 備份檢查

新增 Gemini key 後輪換池共六把（秘密值僅放 ignored env）。
確認 dev matching worker、正式 app、backup 都掛載 `urtube_urtube-data`。
完整備份：`/home/deck/Backups/urtube/nightly/manual-matching-2026-09-06-six-keys`。
備份完成時間 2026-09-06 00:03:55（Asia/Taipei），16 位使用者、17 個 SQLite 檔，
合計 1,636,806,656 bytes；registry 快照含 183,478 筆 matching cache。
專案備份工具對每個輸出檔執行 integrity_check 並保存 SHA-256 manifest；
這是同主機備份，尚未執行還原演練或建立異地副本。

### Backfill 影片範圍上限

`MATCHING_V3_BACKFILL_VIDEO_LIMIT=2000`（預設）：每位使用者依最後觀看時間，
只取最新 2000 部不同影片，所有種類合計，非每類 2000 部。相同時間用影片 ID 穩定排序。
分類、tag embedding、頻道分析與最終 profile 共用此來源；worker、bootstrap、手動 rebuild
皆套用同一設定。上限必須為正整數。這限制來源影片數，並非 API RPM 或 tag 數上限。
調整上限會使 profile 重新聚合，但不清除原始歷史或成功分類／embedding 快取；
範圍外快取保留供之後使用。profile.totalVideos 表示這次受限範圍的影片數，
complete 仍表示來源掃描完整性，不代表整段歷史全部納入 matching。

### 暫定測試輪廓

`publishCachedPreviews` 從每人最新 2000 部（依 backfill 設定）中已提交的分類、tag 向量
建立暫定輪廓，不呼叫 GPT/Gemini，不補假向量；缺少向量的 tag 不參與叢集。
所有類別標示 insufficient、整份 complete=false，配對既有 provisional 邏輯會標示暫定。
只建立有實際叢集的輪廓，不覆蓋目前版本輪廓、不改工作狀態、不擴大配對公開同意。
背景原工作繼續補全，最終結果仍由原子 finish 發布。此工具用於開發預覽，
不可把暫定比例／分數當作完整 2000 部的最終分布。

### 配對身分與公開條件

歷史分支的「只列出公開 profile」限制與本討論串衝突，整合時沿用正式站規則：
候選須開啟 matchingOptIn 並同意所有選定類別；私密成員仍能出現身分、合拍度與好友按鈕。
詳細理由與 tags 僅對好友或公開 profile 顯示，完成所有非同步計算後重新驗證授權。
API 沿用 handle、displayName、detailsVisible、memberHtml，頭像經既有 avatar 路由；
不回傳 email、密鑰或原始觀看資料。首頁成員展示仍只列出公開 profile。

### 即時配對計算隔離

cluster 由背景 worker 計算後存入 matching_v3_profiles；點擊配對不呼叫 GPT/Gemini，
也不重新分群，只比較已儲存的 cluster 質心及權重。
`MATCHING_V3_COMPARE_URL` 可指定獨立即時比較服務；未指定則相容原 computeUrl。
開發部署以 matching-compare 容器處理 compare，原 matching-compute 專做背景分群，
避免 Python 單執行緒 HTTPServer 讓即時配對排在大批次 DBSCAN 後面。

### 配對延遲與 502 修正

監控快取分類統計使用 expression index，避免解析整張向量快取表；索引仍須掃描，因此不能在 HTTP 執行緒反覆查詢。
單 cluster 對單 cluster 使用與 1x1 transport 相同的 cosine／floor 公式直接計算；
多 cluster 仍走獨立 compare 服務。前端對空白或非 JSON 的 HTTP 錯誤提供可讀訊息。
2026-09-06 修正後在背景 worker 恢復狀態，經 Caddy 實測 Music+Sport 兩次
HTTP 200，60ms／20ms，各回傳 7 位公開候選（僅為當次量測，不是延遲保證）。

### 歷史修復（2026-09-06）

`feature/dev-matching-local-backup-20260906` 的舊祖先已由 #64、#65、#67 等整合。
本次從最新 main 接回尚未合併的監控索引、獨立 compare、暫定快取輪廓與 HTTP 錯誤處理；
保留正式 `/matches`、Profile／好友／Blend 可見性，以及 `/landing-assets/` 與站內相對連結。
不把歷史分支的匿名／僅公開帳號列表及開發用圖片路徑帶回正式站。


### 監控讀取與網頁延遲（2026-09-06）

檔案型 registry 的管理統計改由按需啟動的唯讀 worker thread 計算，連同帳號輪廓摘要一起產生快照；不在 HTTP event loop 解析向量或執行彙總。每個 registry 共用一份 30 秒快取與一個進行中的讀取，多個管理頁不會重複掃描。查詢超過 30 秒會終止 reader，失敗後冷卻 30 秒；前一個 reader 結束前不啟動下一個。沒有管理頁請求時不會背景掃描。記憶體型測試 registry 使用同一組查詢直接讀取。

回傳前重新驗證 session／管理員白名單，並排除已刪除帳號、更新已更名帳號；回應仍是 `no-store`。快取只影響監控資料新鮮度，不快取權限判斷。

移除啟動後與每四分鐘對所有已瀏覽帳號、五種範圍進行的同步總覽預熱，保留依請求填入的 revision-aware 快取。首次開啟或快取失效時，該頁統計仍需要同步計算；本次修正消除的是管理監控與推測性預熱反覆阻塞所有網頁的負擔。


### 儀表板與帳號處理狀態（2026-09-06）

儀表板總覽／洞察保留目前版本的 v3 九類摘要，並恢復曾在 `b2042d9` 移除的分析區塊：總覽的舊主題覆蓋率、主題排行與趨勢，以及洞察的 crystal 興趣變化、關鍵字雲、外部頻道分類分布與匿名參考母體。基本觀看統計、頻道、影片、觀看節奏及回顧保留。v3 摘要依配對輪廓的影片上限建立，明示它不跟隨儀表板日期範圍，也不把類別影片數當作觀看時數占比。本人可查看九類；其他有權查看 profile 的訪客僅看到對方已選擇分享的類別，退出配對後不顯示其 v3 摘要。

帳號頁與個人頁的處理提示讀取影片 metadata 數量及 v3 job/profile 摘要，不讀取 v2 主題完成量、不推算剩餘時間。分類顯示本輪影片數；embedding 顯示目前批次／類別的 tags；頻道階段只顯示來源影片範圍，因 worker 尚未回報逐頻道完成量。工作版本不符、失敗、等待重試及暫定結果都有不同狀態；詳細數量和輪廓更新時間僅顯示給本人。metadata-only 查詢共用五秒 revision-aware 快取。

`GET /account/taxonomy` 導向 `/account#processing`，舊審核 POST 回傳 410，不再建立或啟用分類版本。v1/v2 的資料、演算法及背景工作仍保留；這是顯示與進度來源的切換，未停止舊版背景生成，也未重新分類既有 v3 快取。

恢復的頻道分類包含泛藍、泛綠、泛白、泛紅、新聞、個人社論與社論節目，沿用既有來源查詢與觀看時間統計。舊主題排名保留有效覆蓋率 80% 門檻；參考母體仍要求獨立同意、至少五人並隱藏個人身分。外部來源失敗只顯示分類不可用提示，其餘分析保留；等待來源後重新檢查 profile 存取權限。恢復僅讀取既有資料，不啟動重新分類、不變更 worker 或 API 額度，也不重新開啟舊 taxonomy 審核操作。

### 本人處理監控（2026-09-06）

個人首頁與設定頁的本人處理狀態，透過既有 `/api/matching-v3` 每 30 秒讀取工作狀態、最後階段、失敗次數、安全錯誤、重試時間與九類結果。失敗與暫定結果不再被描述成一定正在執行；分類影片數與類別可用性分開呈現。讀取失敗會標示資料可能過期並退避，背景分頁暂停更新，導覽離開後取消請求，登入失效後清除即時資料並停止更新。影片 metadata 數量仍為頁面載入時的快照。此元件僅供本人，不載入全站監控資料、不增加重試或重新分類操作。原管理員面板位於 `/matching-v3/admin`，仍保留全站心跳、API 活動與管理操作。
