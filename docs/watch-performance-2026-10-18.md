# 觀看資料與候選補齊性能修復

2026-10-18。本輪保留觀看時間推估、匹配排序、同意與類別選擇、成功 cache、AI 設定及成本政策；不回填使用者資料。

## 改動

- `ensureEstimatedEvents()` 重建既有 connection-local cache 時，先將量測事件的 `video_id` 與 `julianday(watched_at)` 寫入暫存 lookup，以兩欄 covering index 搜尋同影片的近鄰。SQLite 仍解析原始日期，不用字串時間範圍假設所有既有 timestamp 都是同一格式。
- 索引先尋找 ±301 秒候選，最後仍用原本 `ABS((measured_jd-julianday(watched_at))*86400)<=300` 判斷。額外一秒僅用於索引候選範圍，避免將浮點算式改寫後改變五分鐘端點。並未把去重視窗改為 301 秒。
- lookup 與推估 materialization 共用 savepoint/read snapshot，避免其他 ingest connection 在兩次讀之間新增量測事件。成功後移除 lookup；失敗會 rollback，保留先前完成的暫存 cache，再將錯誤交還呼叫者。沒有永久 schema migration，schema version 仍是 13。
- 單筆 capture 僅針對本次 `videoId` 執行既有 channel reconcile，仍補齊該影片所有舊 Takeout/capture 事件。constructor、archive 批次，以及 metadata 的 reconcile 路徑保留。
- `/matches` 預建 ranked 成員 ID 的 `Set`，補齊公開/v3 成員時查集合，移除逐候選的陣列掃描。現行可見性檢查、非同步計分後的 session/consent 重查、計分與排序流程保留。

lookup 建置增加一次量測事件投影與索引建置，以及短暫的暫存空間。它只在原本 materialization 需要更新時發生，並非每個 Dashboard 查詢都執行。極密集且位於 seek 邊緣的資料仍可能要檢查多個候選，不能把所有可能分布都宣稱成常數時間。

## 離線量測

`NODE_ENV=test node --import tsx scripts/benchmark-watch-neighbors.ts` 只建立合成記憶體 SQLite，無網路、無真人資料。比較舊 CTE materialization 與新的**完整 cache 重建**；新路徑包含 freshness 聚合、lookup 建置/索引/移除、原有 timeline、輸出 materialization 及索引。每組 warmup 一次，取五次中位數，逐列比對 event ID 與估計秒數。

同影片且量測事件遠離待估事件的合成退化情境：

- 2,000 未量測、0 量測：舊 698.182 ms，新 11.155 ms。
- 2,000 未量測、200 量測：舊 1,571.923 ms，新 50.029 ms。
- 2,000 未量測、2,000 量測：舊 1,165.215 ms，新 10.023 ms。

12 組遠時情境皆輸出相同。共享主機負載造成中位數差異，這些數字只證明特定合成退化情境的改善，不代表正式流量 p95 或固定倍數。

EXPLAIN 的 correlated probe 為：

```text
SEARCH measured USING COVERING INDEX youtube_measured_video_time_idx
  (video_id=? AND watched_jd>? AND watched_jd<?)
```

另提供 `--edge-cases` 執行近時量測及全部已量測的成本探針；後者原本不需要 EXISTS，因此可看出額外 lookup 的固定成本。

- 2,000 未量測、2,000 近時量測：舊 397.215 ms，新 9.933 ms，輸出相同。
- 全部 2,000 筆已量測：舊 3.584 ms，新 4.897 ms，輸出相同；此情境多約 1.3 ms 的 lookup/freshness 開銷，沒有近鄰掃描可省。

## 驗證與回復

- `npm run typecheck`。
- 全套 Node tests：427 tests，426 pass、0 fail、1 existing skip（未提供 Python HTTP integration endpoint），使用單序列與記憶體/臨時 DB。
- 新 oracle fixtures 涵蓋五分鐘兩端與 ±1 ms、正負時區、無毫秒、空白分隔、submillisecond、無效日期與 null video ID。另驗證空資料、無量測資料、新量測/播放更新刷新 cache、故障注入後 rollback 與重試、lookup 無殘留。
- channel fixture 驗證同片舊事件與新 capture 都補齊，其他影片留給批次 reconcile；候選 fixture 驗證 ranked/public 重疊只出現一次，以及撤回公開/匹配後立即不可見。既有非同步撤回與持久化分數 cache 測試亦通過。

回復可 revert 本次 commit，再由原有 CD 發布；沒有永久 schema、cache namespace 或真人回填需要回復。本輪未部署或重啟，正式效益仍需 CD 後的運行驗證。
