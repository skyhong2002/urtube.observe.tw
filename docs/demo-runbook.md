# 合成 v3 展示與重設

資料、帳號、公開統計、分類與向量全部是固定合成輸入；不使用真實觀看紀錄或 API key。
實際 `runCycle` 建立 v3 profiles，真正的 Python `compact-medoid-v1` 與精確 transport
服務負責數值計算。此環境能驗證流程，不能證明模型品質、真人推薦效果或線上容量。

## 啟動

Node.js 22.13+、Python 3.11+；CI／正式數值映像使用 Python 3.12。

```sh
npm ci
python3 -m venv /tmp/urtube-demo-venv
/tmp/urtube-demo-venv/bin/pip install --require-hashes -r services/matching-compute/requirements.txt
DEMO_PYTHON=/tmp/urtube-demo-venv/bin/python npm run demo:matching
```

準備 Python 環境後只需最後一個命令。網站綁定 `127.0.0.1:4317`，可設 `DEMO_PORT`；
其自有數值子程序使用隨機 loopback port 與暫時 token，不連設定中的正式 compute。
未安裝 Python 依賴會明確失敗，不悄悄改用近似分數。資料庫放在 OS temporary directory；
Ctrl-C 同時停止網站／子程序並清理資料。重啟建立新登入連結並重設所有資料與關係。
測第二頁好友操作時加入 `DEMO_DIRECTORY_MEMBERS=22`；會增加無歷史的合成目錄帳號，
並輸出最後一位成員的登入連結，以便從另一個 context 接受第二頁的邀請。

終端登入連結是暫時存取能力，請勿錄影或公開。每個帳號使用獨立瀏覽器 profile／private
context；單一 context 內開不同分頁仍會共用 cookie。日期相對啟動時間產生；可由測試注入
時鐘。Legacy aggregate 由這些觀看紀錄計算，不預填不存在的筆數或覆蓋率。

## 帳號與狀態

| 帳號 | 示範用途 |
| --- | --- |
| Alice | 私人洞察、完整 Music／Education、News 有 genre 但沒有原始 tags；已選擇加入探索 |
| Bob | 私人帳號、完整分數；送出／接受好友後才能查看其私人分析 |
| Carol | 公開頁、未完整同步的 provisional profile；已登入可直接 Blend |
| New member | 沒有歷史；不捏造匹配信號 |
| Pending processing | 合成 queued job，沒有 profile；不啟動真正 provider |
| Failed processing | 合成 failed job，沒有 profile；顯示失敗而非虛假完成 |

合成 Alice／Bob 已有探索同意，不能用它們聲稱新註冊預設開啟；新註冊行為由 onboarding
測試核對。Google OAuth 與 Chrome 實際擷取不由這組預種資料模擬成「已端到端驗證」。

## 展示流程

1. Alice → Dashboard → Insights：查看 32 天合成歷史與時間範圍。熱門度是每部不同
   已觀看影片一次、公開快照的分布；包含真實零、未知與隱藏訂閱量。切換 7 天／全部。
2. Matches → My topics → Music & learning：Bob 完整且排在 Carol 前；Carol 顯示暫定。
   新增命名 topic，選擇 Music，儲存、編輯再儲存；鍵盤可操作 dialog 並以 Escape 取消。
3. News：說明有內容類別但無原始 tags，沒有向量就不生成假的興趣分數。
4. 在 All members 向 Bob 發送好友邀請。Bob 的獨立 context 接受後，Alice 可查看
   Bob 的 Overview／Insights 及 Blend；History／Recap 仍受限。
5. 撤回 Bob 關係，再試先前的私人頁及 Blend URL，應重新受限制。Carol 公開頁可直接
   Blend，這是獨立公開設定，不是越過私人好友邊界。
6. Bob → Account 關閉探索。重新載入 Alice 目錄確認 **Bob** 消失；Carol 仍在，
   不可宣稱整份目錄變空。停用不修改公開頁設定。
7. 分別登入 New member、Pending、Failed，展示空資料／等待／失敗。重啟恢復初始狀態。

刪除也只能在此暫存環境演練；依目前 Account 頁要求輸入影片筆數確認，勿沿用舊版
「輸入 handle」說明。測試對應 `tests/privacy-lifecycle.test.ts`、
`tests/matching-demo.test.ts`、`tests/matching-pagination-actions.test.ts`。

## 錄影與外部驗收

兩分鐘交接稿在 [submission-qa.md](submission-qa.md)，三分鐘與七題問答在
[pitch.md](pitch.md)。錄影應顯示合成資料標示、應用程式實際操作及片尾正式連結。
不錄下終端、session URLs、cookie、真實使用者或無關通知。

本機可啟動不等於現場備援已備妥。Jacob／展示者仍需交付最終成片、字幕、可離線播放檔，
檢查每幀與音訊並實際計時；影片連結可開啟也不等於上述品質項目通過。
