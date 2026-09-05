# 配對主題互動原型

開啟 http://localhost:19080/match-preview/ 。這個獨立靜態頁面由本機 Caddy 提供，
不需要登入，也不替換正式 `/matches`。沒有呼叫帳號、配對或聊天 API。

## 已實作

- 首次確認個人興趣，再進入 LINE 風格的主題列表。
- 固定分類：Politic、Music、Sport、Education、Video gaming、Streaming、News、Podcast、channel type。
- 自訂主題名稱；每個主題選 1 項至全部已確認的分類。禁止自訂分類。
- 建立、編輯、刪除確認、搜尋與切換主題。
- 六位虛構人物的示範名單，以共同分類數排列；不代表正式配對分數。
- 興趣比較視窗、空狀態、切換載入狀態、桌面雙欄與手機返回列表。
- localStorage 使用 `urtube.match-topic-preview.v1`，只儲存此瀏覽器的原型興趣與主題。
- 重設原型、表單錯誤、名稱重複檢查、輸入 escaping 與鍵盤操作。

若要快速預覽名單，可選 Music、Podcast、Streaming 等興趣，再按「先看看示範主題」。
只選 Politic 的主題會呈現無示範配對的狀態。

## 修改位置

- `index.html`：頁面與對話框骨架。
- `styles.css`：色票、排版、元件與響應式樣式。
- `app.js`：固定分類、虛構人物、瀏覽器端互動與暫存。

檔案直接掛載至本機 proxy，儲存後重新整理即可看到變更，不需要 build。
新增掛載後第一次啟動：

```sh
docker compose -f compose.local.yml -f compose.production-data.yml up -d --no-deps proxy
```

## 驗證

`scripts/check-match-preview.mjs` 使用獨立 Chromium + Playwright 測試環境，
測試全選分類與至少一項驗證、表單驗證、建立／編輯／刪除、搜尋、比較、重新整理後保留、
空狀態、HTML escaping、手機導覽及重設。攔截網路請求，只允許原型靜態檔案與 favicon。
測試容器沒有掛載資料庫。瀏覽器依賴只安裝於臨時測試容器，未加入專案依賴。

聊天、跨裝置同步、正式種類對應與按主題計算配對，仍需另行確認後端方案。

配對卡片與比較視窗均預留「為什麼推薦給你」區塊。`matchReason.text` 接收純文字、
`matchReason.isExample` 控制示範標示；未提供文字時顯示待提供狀態。長文自動換行，
內容會先做 HTML escaping。目前只使用示範說明，未改動後端配對機制。
