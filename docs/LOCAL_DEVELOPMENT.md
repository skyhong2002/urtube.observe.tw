# 本機部署與前端修改指南

## 配對主題前端原型

http://localhost:19080/match-preview/ 提供獨立的配對主題互動原型。
使用固定九種分類與虛構人物，主題只儲存於瀏覽器，不讀寫正式資料。
原本 `/matches` 仍保留。前端檔案與說明位於 `frontend/match-preview/`。

## 目前啟用：直接共用正式資料庫

依使用者授權，本機網站與 ingest 現在掛載正式資料卷 `urtube_urtube-data`，
使用正式站的全站帳號、觀看歷史、分類與配對資料。本機操作會寫入正式資料。
前端程式仍來自這份 checkout，網址仍是 http://localhost:19080。
正式站既有 worker 與 backup 負責背景工作；本機 worker、backup 已停止。

目前啟停請使用：

```sh
docker compose -f compose.local.yml -f compose.production-data.yml up -d app ingest proxy
docker compose -f compose.local.yml -f compose.production-data.yml logs --tail=80 -f app
docker compose -f compose.local.yml -f compose.production-data.yml stop app ingest proxy
```

共用模式所需的金鑰、owner 與處理能力設定放在被 Git 忽略的
`.env.production-data`；本機 OAuth 回呼網址保持不變。原本本機 session
與擴充套件 token 屬於獨立資料庫，切換後請重新登入；若使用本機擴充套件，
請重新連接帳號。所有帳戶操作（包括旋轉 token、刪除與配對設定）會影響正式站。

切換前已完成正式全站備份：
`urtube-backup:/backups/before-shared-dev-20260905`。
原本開發資料卷仍保留，另有本機備份：
`urtube-local_local-backups` 內的 `before-production-link-20260905`。

之後僅修改前端；任何後端邏輯變更需先說明理由並取得使用者決定，
詳見根目錄 `AGENTS.md`。

以下為原本的獨立開發模式說明；只使用 `compose.local.yml` 啟動會切回原本本機資料。

此 checkout 的開發環境使用 `compose.local.yml`，專案名稱為 `urtube-local`。
既有 `urtube` 容器使用另一份 checkout；修改本目錄只會影響本機開發環境。

## 開啟網站

- 首頁：http://localhost:19080/
- 儀表板：http://localhost:19080/preview
- 洞察：http://localhost:19080/preview/insights
- 紀錄：http://localhost:19080/preview/history
- 回顧：http://localhost:19080/preview/recap
- 匯入服務：http://localhost:19081
- 就緒檢查：http://localhost:19080/readyz

以上網址在執行 Docker 的電腦上使用。遠端開發時可透過 SSH 轉送：
`ssh -L 19080:127.0.0.1:19080 -L 19081:127.0.0.1:19081 urtube@<主機位址>`。

## 日常指令

在 repo 根目錄執行：

```sh
docker compose -f compose.local.yml up -d --build
docker compose -f compose.local.yml logs --tail=80 -f app
docker compose -f compose.local.yml exec -T app env -u OWNER_HANDLE -u OWNER_NAME -u SIGNUP_ENABLED -u TAG_LISTS_URL -u URTUBE_BACKUP_DIRECTORY npm run check
docker compose -f compose.local.yml stop
docker compose -f compose.local.yml start
```

主機不必安裝 Node.js；容器內使用 Node.js 22、npm 與專案依賴。
測試指令清除本機客製環境變數，讓測試使用預期的預設帳號與註冊設定。
`src/`、`scripts/`、`tests/`、擴充套件與圖片掛載自本目錄。
修改 TypeScript 後，`tsx watch` 自動重啟服務；請手動重新整理瀏覽器。
修改 package.json、lockfile 或 tsconfig 後，重新執行 `up -d --build`。

`.env.local` 已建立隨機的本機金鑰，並由 Git 忽略；Docker build 也排除環境檔。
在新的 checkout 重建此環境時，需先建立自己的 `.env.local`：設定上述本機
PUBLIC_BASE_URL、OWNER_HANDLE=preview、SIGNUP_ENABLED=false，並依 `.env.example`
設定三組至少 32 字元的獨立金鑰。
資料與備份分別保存在 `urtube-local_local-data`、`urtube-local_local-backups`
Docker volumes。停止容器會保留資料。

## 整體架構

```text
瀏覽器 → app：Hono 路由 + TypeScript HTML 模板 → 個人 SQLite
Chrome extension / Takeout / Portability → ingest → 個人 SQLite
worker → YouTube metadata / AI 分類 / 統計與配對摘要
users.sqlite → 帳號、登入 session、配對設定與跨使用者摘要
backup → users.sqlite + 所有個人資料庫的備份
```

這是伺服器產生 HTML 的網站，沒有 React、Vue、Vite 或獨立 SPA build。
樣式大多寫在模板內的 CSS 字串，互動則以內嵌 JavaScript 實作。
app、ingest、worker、backup 共用資料卷；每位使用者有自己的 SQLite 檔案。
正式部署的 `docker-compose.yml` 綁定 18080/18081，依 repo 文件再由反向代理
提供 HTTPS，並把 `/api/ingest/*` 導向 ingest。
本機開發版由 `Caddyfile.local` 在 19080 統一提供網站及匯入路徑：
`/api/ingest/*` 轉送 ingest:3001，其餘路徑轉送 app:3000。
19081 仍可直接診斷 ingest。本機使用 HTTP。

## 修改位置

| 要修改的部分 | 檔案 |
| --- | --- |
| 共用顏色、字型、卡片、導覽列、頁面外框 | `src/output/pages.ts`，從 `styles` 與 `shell()` 開始 |
| 首頁內容排列與首頁專用 CSS | `src/index.ts` 的 `app.get('/')` |
| 儀表板、洞察、紀錄、回顧 | `src/output/youtube.ts` |
| 主題趨勢圖 | `src/output/topic-trend.ts` |
| 登入、帳戶設定、引導流程 | `src/output/onboarding.ts` |
| 配對清單與比較畫面 | `src/output/matches.ts`、`src/output/crystal.ts` |
| 中英文文案 | `src/output/i18n.ts` |
| 網址路由、權限、頁面資料組裝 | `src/index.ts` |
| 資料查詢與 schema | `src/data/database.ts`、`src/users.ts` |
| 統計、分類、配對演算法 | `src/youtube/` |
| Chrome 擴充套件 | `chrome-extension/` |

建議先修改 `pages.ts` 的 `:root` 色票、間距與卡片，再調整 `youtube.ts`
的區塊排列。保留模板現有的 `html()` escaping，以及互動程式使用的
`data-*` 屬性與事件名稱。

## 目前可預覽範圍

本機環境使用全新的空資料庫，預覽帳號是 `preview`，不含既有站點的觀看資料。
可直接查看公開首頁、儀表板與空資料狀態。Google OAuth 登入 credentials
已從運作中的 production app 複製到 `.env.local`，並啟用本機 signup；
已驗證登入路由回傳 302 到 Google。仍需在 Google OAuth client 的授權重新導向
URI 登記 `http://localhost:19080/auth/google/callback`，才能完成登入；
目前未驗證該設定或實際 Google 帳號授權流程。
YouTube API、AI 尚未設定；真實資料分析需要相應設定及資料匯入。
原始／商店擴充套件限制 `urtube.observe.tw`。本機的 `/extension.zip` 會產生
專用 `urtube YouTube Capture (Local Development)`，端點固定為
`http://localhost:19080/api/ingest/youtube/capture`，並包含 localhost 的網頁橋接權限。
production 下載包與原始商店擴充套件保持原樣。

## 本機掃描資料

1. 在 Chrome 暫停原本的 urtube 擴充套件，避免同時執行兩份掃描。
2. 從 http://localhost:19080/extension.zip 下載並解壓縮。
3. 到 `chrome://extensions` 開啟「開發人員模式」，按「載入未封裝項目」，
   選取解壓縮後含有 manifest.json 的 `urtube-extension-local` 資料夾。
4. 使用本機帳號登入 http://localhost:19080/extension-setup 並完成連接。
5. 開啟本機版擴充套件 popup，按「重新掃描全部紀錄」，等待完成再刷新儀表板。

既有 production token 與掃描狀態不會搬到本機；需要本機帳號重新授權與掃描。
YouTube 播放進度掃描的安全筆數限制提示，與資料是否送到正確環境是兩件事。
先看「觀看事件」是否增加；歷史影片時數估計還取決於長度等中繼資料是否齊全。
