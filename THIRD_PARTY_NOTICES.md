# 第三方來源與授權聲明

本文件列出 urtube 使用的第三方套件、外部服務、模型、資料與素材，以及各項來源、版本與適用授權。專案程式與文件採用 [MIT License](LICENSE)。

## 盤點基準與範圍

- 查核日期：2026-09-06（第二次盤點，補入 `js-tiktoken` 及其相依、matching-compute Python 元件與正式部署的模型版本）。
- 原始碼基準：`main` 於 2026-09-06 的投稿版本（[`ebd5a92`](https://github.com/skyhong2002/urtube.observe.tw/tree/ebd5a92) 之後僅新增 `js-tiktoken`、`base64-js` 兩個套件），專案版本 `0.1.0`。
- 套件依據：[`package-lock.json`](package-lock.json)，SHA-256：`6bc6b6576e673776d6354b1a4f299e5482caf917b9575f82e81f57386724a5a4`。
- 涵蓋 lockfile 的 **61 個套件安裝項目**，包括直接、間接、開發與各平台選用依賴；同名不同版本分別列出。實際安裝項目依作業系統與部署設定而定；正式容器元件另由映像盤點記錄。
- 每個套件的 registry tarball 皆依 lockfile `resolved` 下載，並驗證 `integrity`；授權文字取自套件內檔案，缺件時使用下方明列的官方來源補足。
- 模型、外部資料、部署基礎設施與素材以程式、版本歷史及公開來源核對。正式環境的確切模型與映像組成仍需部署者補充。

## npm 套件

「來源」連結指向實際發布的套件封存檔，內含 package metadata 與可取得的授權檔；機器可讀版本、來源網址、完整性雜湊與依賴關係另收於文末 SBOM。下方授權 ID 取自套件宣告；套件內嵌的第三方聲明收錄於授權附錄。

| 套件 | 版本 | 使用範圍 | 宣告授權 | 來源 |
| --- | --- | --- | --- | --- |
| `@esbuild/aix-ppc64` | `0.28.2` | 選用／平台相依；間接 | MIT | [發布套件](https://registry.npmjs.org/@esbuild/aix-ppc64/-/aix-ppc64-0.28.2.tgz) |
| `@esbuild/android-arm` | `0.28.2` | 選用／平台相依；間接 | MIT | [發布套件](https://registry.npmjs.org/@esbuild/android-arm/-/android-arm-0.28.2.tgz) |
| `@esbuild/android-arm64` | `0.28.2` | 選用／平台相依；間接 | MIT | [發布套件](https://registry.npmjs.org/@esbuild/android-arm64/-/android-arm64-0.28.2.tgz) |
| `@esbuild/android-x64` | `0.28.2` | 選用／平台相依；間接 | MIT | [發布套件](https://registry.npmjs.org/@esbuild/android-x64/-/android-x64-0.28.2.tgz) |
| `@esbuild/darwin-arm64` | `0.28.2` | 選用／平台相依；間接 | MIT | [發布套件](https://registry.npmjs.org/@esbuild/darwin-arm64/-/darwin-arm64-0.28.2.tgz) |
| `@esbuild/darwin-x64` | `0.28.2` | 選用／平台相依；間接 | MIT | [發布套件](https://registry.npmjs.org/@esbuild/darwin-x64/-/darwin-x64-0.28.2.tgz) |
| `@esbuild/freebsd-arm64` | `0.28.2` | 選用／平台相依；間接 | MIT | [發布套件](https://registry.npmjs.org/@esbuild/freebsd-arm64/-/freebsd-arm64-0.28.2.tgz) |
| `@esbuild/freebsd-x64` | `0.28.2` | 選用／平台相依；間接 | MIT | [發布套件](https://registry.npmjs.org/@esbuild/freebsd-x64/-/freebsd-x64-0.28.2.tgz) |
| `@esbuild/linux-arm` | `0.28.2` | 選用／平台相依；間接 | MIT | [發布套件](https://registry.npmjs.org/@esbuild/linux-arm/-/linux-arm-0.28.2.tgz) |
| `@esbuild/linux-arm64` | `0.28.2` | 選用／平台相依；間接 | MIT | [發布套件](https://registry.npmjs.org/@esbuild/linux-arm64/-/linux-arm64-0.28.2.tgz) |
| `@esbuild/linux-ia32` | `0.28.2` | 選用／平台相依；間接 | MIT | [發布套件](https://registry.npmjs.org/@esbuild/linux-ia32/-/linux-ia32-0.28.2.tgz) |
| `@esbuild/linux-loong64` | `0.28.2` | 選用／平台相依；間接 | MIT | [發布套件](https://registry.npmjs.org/@esbuild/linux-loong64/-/linux-loong64-0.28.2.tgz) |
| `@esbuild/linux-mips64el` | `0.28.2` | 選用／平台相依；間接 | MIT | [發布套件](https://registry.npmjs.org/@esbuild/linux-mips64el/-/linux-mips64el-0.28.2.tgz) |
| `@esbuild/linux-ppc64` | `0.28.2` | 選用／平台相依；間接 | MIT | [發布套件](https://registry.npmjs.org/@esbuild/linux-ppc64/-/linux-ppc64-0.28.2.tgz) |
| `@esbuild/linux-riscv64` | `0.28.2` | 選用／平台相依；間接 | MIT | [發布套件](https://registry.npmjs.org/@esbuild/linux-riscv64/-/linux-riscv64-0.28.2.tgz) |
| `@esbuild/linux-s390x` | `0.28.2` | 選用／平台相依；間接 | MIT | [發布套件](https://registry.npmjs.org/@esbuild/linux-s390x/-/linux-s390x-0.28.2.tgz) |
| `@esbuild/linux-x64` | `0.28.2` | 選用／平台相依；間接 | MIT | [發布套件](https://registry.npmjs.org/@esbuild/linux-x64/-/linux-x64-0.28.2.tgz) |
| `@esbuild/netbsd-arm64` | `0.28.2` | 選用／平台相依；間接 | MIT | [發布套件](https://registry.npmjs.org/@esbuild/netbsd-arm64/-/netbsd-arm64-0.28.2.tgz) |
| `@esbuild/netbsd-x64` | `0.28.2` | 選用／平台相依；間接 | MIT | [發布套件](https://registry.npmjs.org/@esbuild/netbsd-x64/-/netbsd-x64-0.28.2.tgz) |
| `@esbuild/openbsd-arm64` | `0.28.2` | 選用／平台相依；間接 | MIT | [發布套件](https://registry.npmjs.org/@esbuild/openbsd-arm64/-/openbsd-arm64-0.28.2.tgz) |
| `@esbuild/openbsd-x64` | `0.28.2` | 選用／平台相依；間接 | MIT | [發布套件](https://registry.npmjs.org/@esbuild/openbsd-x64/-/openbsd-x64-0.28.2.tgz) |
| `@esbuild/openharmony-arm64` | `0.28.2` | 選用／平台相依；間接 | MIT | [發布套件](https://registry.npmjs.org/@esbuild/openharmony-arm64/-/openharmony-arm64-0.28.2.tgz) |
| `@esbuild/sunos-x64` | `0.28.2` | 選用／平台相依；間接 | MIT | [發布套件](https://registry.npmjs.org/@esbuild/sunos-x64/-/sunos-x64-0.28.2.tgz) |
| `@esbuild/win32-arm64` | `0.28.2` | 選用／平台相依；間接 | MIT | [發布套件](https://registry.npmjs.org/@esbuild/win32-arm64/-/win32-arm64-0.28.2.tgz) |
| `@esbuild/win32-ia32` | `0.28.2` | 選用／平台相依；間接 | MIT | [發布套件](https://registry.npmjs.org/@esbuild/win32-ia32/-/win32-ia32-0.28.2.tgz) |
| `@esbuild/win32-x64` | `0.28.2` | 選用／平台相依；間接 | MIT | [發布套件](https://registry.npmjs.org/@esbuild/win32-x64/-/win32-x64-0.28.2.tgz) |
| `@hono/node-server` | `2.1.1` | 執行；直接 | MIT | [發布套件](https://registry.npmjs.org/@hono/node-server/-/node-server-2.1.1.tgz) |
| `@types/node` | `26.2.0` | 開發；直接 | MIT | [發布套件](https://registry.npmjs.org/@types/node/-/node-26.2.0.tgz) |
| `base64-js` | `1.5.1` | 執行；間接（`js-tiktoken` 相依） | MIT | [發布套件](https://registry.npmjs.org/base64-js/-/base64-js-1.5.1.tgz) |
| `boolbase` | `1.0.0` | 執行；間接 | ISC | [發布套件](https://registry.npmjs.org/boolbase/-/boolbase-1.0.0.tgz) |
| `cheerio` | `1.2.0` | 執行；直接 | MIT | [發布套件](https://registry.npmjs.org/cheerio/-/cheerio-1.2.0.tgz) |
| `cheerio-select` | `2.1.0` | 執行；間接 | BSD-2-Clause | [發布套件](https://registry.npmjs.org/cheerio-select/-/cheerio-select-2.1.0.tgz) |
| `css-select` | `5.2.2` | 執行；間接 | BSD-2-Clause | [發布套件](https://registry.npmjs.org/css-select/-/css-select-5.2.2.tgz) |
| `css-what` | `6.2.2` | 執行；間接 | BSD-2-Clause | [發布套件](https://registry.npmjs.org/css-what/-/css-what-6.2.2.tgz) |
| `dom-serializer` | `2.0.0` | 執行；間接 | MIT | [發布套件](https://registry.npmjs.org/dom-serializer/-/dom-serializer-2.0.0.tgz) |
| `domelementtype` | `2.3.0` | 執行；間接 | BSD-2-Clause | [發布套件](https://registry.npmjs.org/domelementtype/-/domelementtype-2.3.0.tgz) |
| `domhandler` | `5.0.3` | 執行；間接 | BSD-2-Clause | [發布套件](https://registry.npmjs.org/domhandler/-/domhandler-5.0.3.tgz) |
| `domutils` | `3.2.2` | 執行；間接 | BSD-2-Clause | [發布套件](https://registry.npmjs.org/domutils/-/domutils-3.2.2.tgz) |
| `encoding-sniffer` | `0.2.1` | 執行；間接 | MIT | [發布套件](https://registry.npmjs.org/encoding-sniffer/-/encoding-sniffer-0.2.1.tgz) |
| `entities` | `4.5.0` | 執行；間接 | BSD-2-Clause | [發布套件](https://registry.npmjs.org/entities/-/entities-4.5.0.tgz) |
| `esbuild` | `0.28.2` | 執行；間接 | MIT | [發布套件](https://registry.npmjs.org/esbuild/-/esbuild-0.28.2.tgz) |
| `fflate` | `0.8.3` | 執行；直接 | MIT | [發布套件](https://registry.npmjs.org/fflate/-/fflate-0.8.3.tgz) |
| `fsevents` | `2.3.3` | 選用／平台相依；間接 | MIT | [發布套件](https://registry.npmjs.org/fsevents/-/fsevents-2.3.3.tgz) |
| `hono` | `4.13.2` | 執行；直接 | MIT | [發布套件](https://registry.npmjs.org/hono/-/hono-4.13.2.tgz) |
| `htmlparser2` | `10.1.0` | 執行；間接 | MIT | [發布套件](https://registry.npmjs.org/htmlparser2/-/htmlparser2-10.1.0.tgz) |
| `entities` | `7.0.1` | 執行；間接 | BSD-2-Clause | [發布套件](https://registry.npmjs.org/entities/-/entities-7.0.1.tgz) |
| `iconv-lite` | `0.6.3` | 執行；間接 | MIT | [發布套件](https://registry.npmjs.org/iconv-lite/-/iconv-lite-0.6.3.tgz) |
| `js-tiktoken` | `1.0.21` | 執行；直接（配對監控的 token 估算） | MIT | [發布套件](https://registry.npmjs.org/js-tiktoken/-/js-tiktoken-1.0.21.tgz) |
| `nth-check` | `2.1.1` | 執行；間接 | BSD-2-Clause | [發布套件](https://registry.npmjs.org/nth-check/-/nth-check-2.1.1.tgz) |
| `parse5` | `7.3.0` | 執行；間接 | MIT | [發布套件](https://registry.npmjs.org/parse5/-/parse5-7.3.0.tgz) |
| `parse5-htmlparser2-tree-adapter` | `7.1.0` | 執行；間接 | MIT | [發布套件](https://registry.npmjs.org/parse5-htmlparser2-tree-adapter/-/parse5-htmlparser2-tree-adapter-7.1.0.tgz) |
| `parse5-parser-stream` | `7.1.2` | 執行；間接 | MIT | [發布套件](https://registry.npmjs.org/parse5-parser-stream/-/parse5-parser-stream-7.1.2.tgz) |
| `entities` | `6.0.1` | 執行；間接 | BSD-2-Clause | [發布套件](https://registry.npmjs.org/entities/-/entities-6.0.1.tgz) |
| `safer-buffer` | `2.1.2` | 執行；間接 | MIT | [發布套件](https://registry.npmjs.org/safer-buffer/-/safer-buffer-2.1.2.tgz) |
| `tsx` | `4.23.12` | 執行；直接 | MIT | [發布套件](https://registry.npmjs.org/tsx/-/tsx-4.23.12.tgz) |
| `typescript` | `6.0.3` | 開發；直接 | Apache-2.0 | [發布套件](https://registry.npmjs.org/typescript/-/typescript-6.0.3.tgz) |
| `undici` | `7.29.0` | 執行；間接 | MIT | [發布套件](https://registry.npmjs.org/undici/-/undici-7.29.0.tgz) |
| `undici-types` | `8.3.0` | 開發；間接 | MIT | [發布套件](https://registry.npmjs.org/undici-types/-/undici-types-8.3.0.tgz) |
| `whatwg-encoding` | `3.1.1` | 執行；間接 | MIT | [發布套件](https://registry.npmjs.org/whatwg-encoding/-/whatwg-encoding-3.1.1.tgz) |
| `whatwg-mimetype` | `4.0.0` | 執行；間接 | MIT | [發布套件](https://registry.npmjs.org/whatwg-mimetype/-/whatwg-mimetype-4.0.0.tgz) |
| `zod` | `3.25.76` | 執行；直接 | MIT | [發布套件](https://registry.npmjs.org/zod/-/zod-3.25.76.tgz) |

### 授權檔案查核補充

- `@esbuild/*@0.28.2` 的平台套件未附個別 LICENSE；其 package metadata 宣告 MIT，並指向 esbuild。本文附上主套件及[同版本官方 LICENSE.md](https://github.com/evanw/esbuild/blob/v0.28.2/LICENSE.md) 的授權文字。
- `boolbase@1.0.0` 的封存檔只有 package metadata、README 與程式，metadata 宣告 ISC；本文補附[官方新增的 ISC LICENSE](https://github.com/fb55/boolbase/blob/be0bcd8a4e917a0a5895e95b523fbbed05a64871/LICENSE)。
- `undici@7.29.0` 除根目錄 LICENSE 外，也保留 `lib/web/fetch/LICENSE`。`typescript@6.0.3` 的 `ThirdPartyNoticeText.txt` 另含內嵌程式與資料聲明，全文收錄於授權附錄。
- `js-tiktoken@1.0.21` 的封存檔沒有 LICENSE 檔，package metadata 宣告 MIT；本文附上[上游 dqbd/tiktoken 的 MIT LICENSE](https://github.com/dqbd/tiktoken/blob/main/LICENSE)（Copyright OpenAI, Shantanu Jain）。套件內含 OpenAI [tiktoken](https://github.com/openai/tiktoken) 的 BPE 排名資料（`o200k_base` 等），上游同為 MIT。本專案只用它估算送往模型的文字 token 數，估算值不用於計費。`base64-js@1.5.1` 為其唯一相依，封存檔附 `package/LICENSE`。
- 發布時需隨所散布的套件保留其 copyright、license 與 notices。本文提供中文索引與授權原文。

## 模型、外部服務與資料

| 項目／提供者 | 本專案使用方式與來源 | 授權／條款與揭露狀態 |
| --- | --- | --- |
| Google OAuth／Google | 以 Google 帳號登入，使用 `openid email profile`；[來源文件](https://developers.google.com/identity/protocols/oauth2/web-server)。 | 外部服務，依 [Google APIs Terms](https://developers.google.com/terms) 與 [User Data Policy](https://developers.google.com/terms/api-services-user-data-policy)。 |
| Google Takeout、My Activity、YouTube History | 使用者自行提供 ZIP，或擴充功能在本人授權的頁面擷取觀看紀錄；[Takeout](https://takeout.google.com/)、[My Activity](https://myactivity.google.com/)、[YouTube History](https://www.youtube.com/feed/history)。 | 依 [Google 服務條款](https://policies.google.com/terms) 與 [YouTube 條款](https://www.youtube.com/t/terms) 及資料主體授權使用。使用者 archive 儲存於各自的資料庫。 |
| Google Data Portability API | 可選的 instance owner 定期匯入；[官方資料來源](https://developers.google.com/data-portability)。 | [Data Portability user data and developer policy](https://developers.google.com/data-portability/policy) 與適用 Google API 條款。服務權限與驗證由部署者設定。 |
| YouTube Data API v3／Google | 取得公開影片、頻道 metadata、圖片 URL 與公開統計；[API 文件](https://developers.google.com/youtube/v3)。 | [YouTube API Services Terms](https://developers.google.com/youtube/terms/api-services-terms-of-service)、[Developer Policies](https://developers.google.com/youtube/terms/developer-policies) 與 [Branding Guidelines](https://developers.google.com/youtube/terms/branding-guidelines)。影片、縮圖與頻道圖片依權利人授權及平台條款使用。 |
| analysis.tw 頻道標籤清單 | 以 [channels_list API](https://urtubeapi.analysis.tw/api/channels_list.php) 取得新聞／社論與政治內容標籤；使用 query、來源時間與內容版本見[專案政策](docs/channel-tag-policy.md)。 | **資料再利用授權待確認**：待維護者提供授權／使用條款，補充展示、快取與再散布範圍。此清單用於頻道內容標籤。 |
| OpenAI GPT 5.6 Luna／OpenAI | 主題配對（matching v3）以 Chat Completions 對公開影片標題與 tags 做多類別 genre 分類，並判斷頻道經營類型；正式部署的 model ID 為 `gpt-5.6-luna`、`reasoning_effort=low`，端點為 OpenAI 官方 `https://api.openai.com/v1`（`MATCHING_V3_BASE_URL`／`MATCHING_V3_CLASSIFICATION_MODEL`），程式見 [`src/matching-v3/provider.ts`](src/matching-v3/provider.ts)，設計見 [`docs/matching-v3.md`](docs/matching-v3.md)。 | 外部服務，依 [OpenAI 適用條款](https://openai.com/policies/terms-of-use/)與 [Usage policies](https://openai.com/policies/usage-policies/)；模型卡見 [GPT-5.6 Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna)。OpenAI 未公開此模型的訓練資料來源，本文列為「未公開／無法確認」。回應僅快取分類結果，不散布模型輸出以外的內容。 |
| OpenAI GPT 5.6 Sol／OpenAI（經自架 gateway） | 個人私密興趣 taxonomy 分類（[`src/youtube/ai.ts`](src/youtube/ai.ts)）透過 `AI_BASE_URL` 指向的自架 chat-completions gateway，正式部署 `AI_MODEL=gpt-5.6-sol`。 | 模型與訂閱服務依 [OpenAI 適用條款](https://openai.com/policies/terms-of-use/)；訓練資料來源未公開／無法確認。gateway shim 見下列 Codex CLI 項目。 |
| Google Gemini embedding／Google | 主題配對將每個公開影片 tag 的正規化文字送 Gemini Developer API 取得向量；正式部署 `gemini-embedding-001`、`SEMANTIC_SIMILARITY` task、768 維、L2 正規化，端點 `generativelanguage.googleapis.com/v1beta`；[官方文件](https://ai.google.dev/gemini-api/docs/embeddings)、程式見 [`src/matching-v3/provider.ts`](src/matching-v3/provider.ts)。 | 外部服務，依 [Gemini API Additional Terms of Service](https://ai.google.dev/gemini-api/terms)。Google 未公開該 embedding 模型的訓練資料來源，本文列為「未公開／無法確認」。向量僅存於共用快取供配對計算，不對外散布。 |
| Codex CLI gateway／OpenAI | [部署紀錄](docs/ai-gateway.md) 描述自訂 shim 執行 `codex exec` 提供 chat-completions；正式站僅舊版私密 taxonomy 分類仍經此 gateway，主題配對已改走 OpenAI 官方端點。shim 原始碼不在本 repository。 | CLI 程式來源及 Apache-2.0 授權見 [openai/codex](https://github.com/openai/codex/blob/main/LICENSE)；模型／訂閱服務另依 [OpenAI 適用條款](https://openai.com/policies/terms-of-use/)。shim 自身來源與授權亦待部署者補充。 |
| Google／Gravatar 頭像 | [`src/avatars.ts`](src/avatars.ts) 優先使用 Google 登入或 UserInfo 提供的 allowlist 圖片；無法取得時暫用 Gravatar，再失敗則使用本機字首頭像。圖片經本站同源路徑提供。 | Google 圖片依帳號／服務適用條款；Gravatar 依 [Automattic 條款](https://wordpress.com/tos/)。Gravatar 請求使用 email 的 SHA-256 雜湊。 |

模型名稱與用途依正式部署容器的環境設定核對（2026-09-06）；兩個模型供應者皆未公開訓練資料來源，本文不推測。尚未採用的模型不列入。

## 部署工具與基礎映像

此表根據 repository 記錄部署依賴；正式主機與映像元件由部署者另行盤點。

| 元件 | 使用與來源 | 授權／版本狀態 |
| --- | --- | --- |
| Node.js | [`Dockerfile`](Dockerfile) 使用 `node:22-alpine`，內含 `node:sqlite`；[Node.js 原始碼與完整授權](https://github.com/nodejs/node/blob/main/LICENSE)。 | Node.js 本體 MIT，內含元件有個別條款，須保留其完整 LICENSE；浮動 image tag 未固定 patch 或 digest。 |
| SQLite | 經 Node.js 內建 `node:sqlite` 使用；[SQLite 來源與權利說明](https://www.sqlite.org/copyright.html)。 | SQLite 原始碼 public domain；Node.js 的打包與其他元件仍依各自條款。 |
| Node Docker image／Alpine Linux | [官方 Node image](https://github.com/nodejs/docker-node)、[Alpine 套件](https://pkgs.alpinelinux.org/packages)。 | 映像內作業系統與函式庫依各元件授權提供。最終發布 image digest 與完整映像 SBOM 待發布者補充。 |
| matching-compute／Python 3.12 | [`services/matching-compute/Dockerfile`](services/matching-compute/Dockerfile) 以 `python:3.12-slim`（Debian 基底）執行 DBSCAN 分群與 optimal transport 數值服務；正式容器內為 Python `3.12.14`；[Python 原始碼與授權](https://github.com/python/cpython/blob/main/LICENSE)。 | Python [PSF License](https://docs.python.org/3/license.html)；Debian 基底套件依各自授權，映像內作業系統元件 SBOM 未另行產生。正式映像 `ghcr.io/skyhong2002/urtube-matching-compute@sha256:4f81985e5c83f4130a6c2179b4b2d6354d3ec4b1b7e6c678ad8a4878bf33d1f5`（2026-09-06 執行中）。 |
| numpy、scipy、scikit-learn（pip） | [`requirements.txt`](services/matching-compute/requirements.txt) 固定 `numpy==2.2.6`、`scipy==1.15.3`、`scikit-learn==1.6.1`；pip 另解析相依 `joblib 1.6.0`、`threadpoolctl 3.6.0`（正式容器實測）。來源：[numpy](https://github.com/numpy/numpy)、[scipy](https://github.com/scipy/scipy)、[scikit-learn](https://github.com/scikit-learn/scikit-learn)、[joblib](https://github.com/joblib/joblib)、[threadpoolctl](https://github.com/joblib/threadpoolctl)。 | 皆為 [BSD-3-Clause](https://github.com/scikit-learn/scikit-learn/blob/main/COPYING)（numpy／scipy／scikit-learn／joblib／threadpoolctl 各自 LICENSE）。scipy 與 numpy wheel 內含 OpenBLAS（BSD-3-Clause）等編譯元件，隨 wheel 附帶授權。相依版本未在 requirements 固定，重建時可能解析到不同版本。 |
| 正式映像（GHCR） | GitHub Actions 依 [`Dockerfile`](Dockerfile) 建置並發布 `ghcr.io/skyhong2002/urtube.observe.tw`（app／ingest／worker／backup／matching-worker 共用），由 Komodo 拉取部署；2026-09-06 執行中的 app 映像對應原始碼 `401856a`、image ID `sha256:af6d7796ccbed5d7046a36cd3e2bfecf2905eb912d3e101ca8bb8fdd8647fbb2`。 | 映像內容為本專案（MIT）加上上述 Node.js／Alpine 元件與 npm 套件；映像層級 SBOM 未另行產生，以 lockfile SBOM 與本表為準。部署工具 [Komodo](https://github.com/moghtech/komodo)（GPL-3.0）與 MongoDB 8.0（SSPL）只在主機上執行部署，不隨產品散布。 |
| Docker Compose／Docker 執行環境 | [`docker-compose.yml`](docker-compose.yml) 啟動服務；[Compose 原始碼](https://github.com/docker/compose)。 | Compose [Apache-2.0](https://github.com/docker/compose/blob/main/LICENSE)；若用 Docker Desktop，另依其[訂閱條款](https://www.docker.com/legal/docker-subscription-service-agreement/)。部署工具版本由執行環境決定。 |
| Cloudflare Tunnel／cloudflared | [目前維運紀錄](CUTOVER_RUNBOOK.md) 的正式對外入口；[cloudflared](https://github.com/cloudflare/cloudflared)。 | client 依[完整 LICENSE](https://github.com/cloudflare/cloudflared/blob/master/LICENSE)，Cloudflare 服務依[使用條款](https://www.cloudflare.com/terms/)。正式版本與 Tunnel 設定不在 repository，待部署者確認。 |
| Caddy | [`compose.local.yml`](compose.local.yml) 使用 `caddy:2-alpine` 提供本機反向代理與配對主題原型；[Caddy 來源](https://github.com/caddyserver/caddy)。 | [Apache-2.0](https://github.com/caddyserver/caddy/blob/master/LICENSE)；發布時記錄實際映像版本與隨附元件。 |

## 素材與示範資料

| 項目 | 可查核來源 | 使用與授權說明 |
| --- | --- | --- |
| `favicon.svg` | [新增來源 commit](https://github.com/skyhong2002/urtube.observe.tw/commit/6f69d8240e6f748893408af4dec1a6af8d9fe87e)，由 repository 內 SVG 幾何圖形組成。 | 專案程式繪製的品牌素材，隨專案 MIT 提供；提交紀錄含 AI coding assistant 協作標記。 |
| `chrome-extension/icon16.png`、`icon32.png`、`icon48.png`、`icon128.png` | [轉換紀錄](https://github.com/skyhong2002/urtube.observe.tw/commit/5438d3a430a9e4877f186a7bf39a43f2c938f724) 說明由 `favicon.svg` 產生。 | 專案圖示的不同尺寸輸出，沿用來源素材聲明。 |
| `og.png` | [`scripts/og-card.html`](scripts/og-card.html) 與[產生紀錄](https://github.com/skyhong2002/urtube.observe.tw/commit/869b571d54f8657773f4728a3d6a431dfc96fe8e)；以 headless Chrome 將 HTML 品牌卡輸出成圖片。 | 專案 HTML／SVG 素材，沿用專案 MIT；原產生環境的實際字型與瀏覽器版本未記錄，重現時需確認所用字型授權。 |
| 網頁字型與 UI 圖表 | CSS 使用系統字型／名稱候選；圖表由專案原生 SVG／HTML 產生。 | 顯示時使用使用者環境的系統字型；CSS 列出的 Inter、Noto 等名稱作為字型選擇順序。 |
| 合成示範與測試 fixtures | [`scripts/matching-demo.ts`](scripts/matching-demo.ts) 與 [`tests/`](tests/)。 | 專案合成資料隨專案 MIT 提供，用於介面展示與流程測試。 |
| 使用者歷史、外部縮圖與頭像 | 由本人匯入或外部服務於執行時提供。 | 使用者歷史依本人授權使用，縮圖與頭像依來源條款使用；Example dashboard 的資料與公開設定由 owner 管理。 |

## 發布前仍需補齊的項目

| 項目 | 待提供的證據／處置 | 負責角色 |
| --- | --- | --- |
| gateway shim 原始碼 | 舊版私密 taxonomy 分類使用的 codex-exec shim 原始碼不在 repository；模型 ID 已於上表揭露，shim 本身的來源與授權仍待部署者補充。 | 部署維護者 |
| analysis.tw 資料授權 | 取得維護者正式使用條款或許可證據，確認展示、快取與再散布的使用範圍。 | 資料來源聯絡者／維護者 |
| 映像層級 SBOM | 執行中的映像 digest 已記錄於上表；容器作業系統層（Alpine／Debian）元件 SBOM 尚未產生。 | 發布維護者 |
| OG 圖片重現環境 | 現有紀錄可追溯 HTML；原渲染環境的字型、瀏覽器版本與字型授權待補。 | 素材維護者 |

這些項目以 [#54](https://github.com/skyhong2002/urtube.observe.tw/issues/54) 追蹤。版本定版或新增模型／資料／素材後應再查核一次。

## SBOM 產生與更新

採用 npm 內建 `npm sbom` 輸出 **CycloneDX 1.5 JSON**。[npm 官方說明](https://docs.npmjs.com/cli/v11/commands/npm-sbom/) 記錄兩種格式與 lockfile 模式。

首次盤點工具為 Node.js `v24.2.0`、npm `11.3.0`；本次更新為 Node.js `v24.15.0`、npm `11.12.1`。npm 輸出的根元件名稱可能取自 checkout 目錄；以下步驟將它統一為 `package.json` 的專案名稱，其餘 SBOM 欄位保留。在相同 lockfile 下執行：

```bash
# 在 repository 根目錄執行；輸出到 repository 外
npm sbom --package-lock-only --sbom-format=cyclonedx > /tmp/urtube-sbom.cdx.json
node --input-type=module <<'JS'
import { readFileSync, writeFileSync } from 'node:fs';
const file = '/tmp/urtube-sbom.cdx.json';
const bom = JSON.parse(readFileSync(file, 'utf8'));
bom.metadata.component.name = JSON.parse(readFileSync('package.json', 'utf8')).name;
writeFileSync(file, JSON.stringify(bom, null, 2) + '\n');
JS
node --input-type=module -e "import fs from 'node:fs'; const b=JSON.parse(fs.readFileSync('/tmp/urtube-sbom.cdx.json','utf8')); if(b.bomFormat!=='CycloneDX'||!Array.isArray(b.components)) throw Error('Invalid SBOM'); console.log(b.specVersion,b.components.length);"
```

lockfile 模式納入所有平台的選用項目；單次部署的安裝清單依實際環境產生。重新產生的時間與 serial number 可能不同，應比較套件名稱、版本、hash、授權與依賴關係。此 SBOM 的範圍為 npm lockfile；外部模型、API 資料、使用者資料、圖像與部署元件收於前述表格。

JSON 快照收在下方折疊區，可用以下指令擷取成獨立檔案：

```bash
node --input-type=module <<'JS'
import { readFileSync, writeFileSync } from 'node:fs';
const text = readFileSync('THIRD_PARTY_NOTICES.md', 'utf8');
const match = text.match(/<!-- sbom:start -->\s*```json\n([\s\S]*?)\n```\s*<!-- sbom:end -->/);
if (!match) throw new Error('SBOM block missing');
const bom = JSON.parse(match[1]);
writeFileSync('/tmp/urtube-sbom.cdx.json', JSON.stringify(bom, null, 2) + '\n');
JS
```

更新時應重新下載 lockfile 的來源套件、驗證 integrity、核對 LICENSE／NOTICE／ThirdPartyNoticeText 等檔案，再同步更新套件表、授權附錄、SHA-256 與 JSON 快照。

<details>
<summary>CycloneDX 1.5 JSON：61 個套件及依賴關係</summary>

<!-- sbom:start -->
```json
{
  "$schema": "http://cyclonedx.org/schema/bom-1.5.schema.json",
  "bomFormat": "CycloneDX",
  "specVersion": "1.5",
  "serialNumber": "urn:uuid:c7d5ace2-d314-45e1-b2fa-091f157b2ffc",
  "version": 1,
  "metadata": {"timestamp":"2026-09-05T21:16:10.282Z","lifecycles":[{"phase":"pre-build"}],"tools":[{"vendor":"npm","name":"cli","version":"11.12.1"}],"component":{"bom-ref":"urtube@0.1.0","type":"library","name":"urtube","version":"0.1.0","scope":"required","purl":"pkg:npm/urtube@0.1.0","properties":[{"name":"cdx:npm:package:private","value":"true"}],"externalReferences":[]}},
  "components": [
    {"bom-ref":"@esbuild/aix-ppc64@0.28.2","type":"library","name":"@esbuild/aix-ppc64","version":"0.28.2","scope":"optional","purl":"pkg:npm/%40esbuild/aix-ppc64@0.28.2","properties":[],"externalReferences":[{"type":"distribution","url":"https://registry.npmjs.org/@esbuild/aix-ppc64/-/aix-ppc64-0.28.2.tgz"}],"hashes":[{"alg":"SHA-512","content":"5c4c5c3be76f2cabd5b4d4e26d24c17a3d4d0806da1a15a7f56c3564fc7cd2ab1a8613c57bff238163f421c84d7b41771f0914ee7f1e8e11fc6e3a27aa1b7c99"}],"licenses":[{"license":{"id":"MIT"}}]},
    {"bom-ref":"@esbuild/android-arm@0.28.2","type":"library","name":"@esbuild/android-arm","version":"0.28.2","scope":"optional","purl":"pkg:npm/%40esbuild/android-arm@0.28.2","properties":[],"externalReferences":[{"type":"distribution","url":"https://registry.npmjs.org/@esbuild/android-arm/-/android-arm-0.28.2.tgz"}],"hashes":[{"alg":"SHA-512","content":"9175e888f55519072721818e79aa2fc0e511a678830694aae00d37aa443e04c42ab461ba1d86a9df19def42d4ed72a384d1deac65097e48aaa997e9f168d8baa"}],"licenses":[{"license":{"id":"MIT"}}]},
    {"bom-ref":"@esbuild/android-arm64@0.28.2","type":"library","name":"@esbuild/android-arm64","version":"0.28.2","scope":"optional","purl":"pkg:npm/%40esbuild/android-arm64@0.28.2","properties":[],"externalReferences":[{"type":"distribution","url":"https://registry.npmjs.org/@esbuild/android-arm64/-/android-arm64-0.28.2.tgz"}],"hashes":[{"alg":"SHA-512","content":"e587ca79e23ca967c16485febb6c590b76656f73acfe02d2dac6c428cf88e1939cb169874b658bcac09c4190c0151b250d45393a2ab8e207fa3d8375bc6c06e4"}],"licenses":[{"license":{"id":"MIT"}}]},
    {"bom-ref":"@esbuild/android-x64@0.28.2","type":"library","name":"@esbuild/android-x64","version":"0.28.2","scope":"optional","purl":"pkg:npm/%40esbuild/android-x64@0.28.2","properties":[],"externalReferences":[{"type":"distribution","url":"https://registry.npmjs.org/@esbuild/android-x64/-/android-x64-0.28.2.tgz"}],"hashes":[{"alg":"SHA-512","content":"3b7f3b8ad7bb4b353209ccb72505f83f86cbb4403b6cb2e4c7e7acbdee491e7c987cd4f1715a57668f6385d07495328de38833b442d3754ee74bc36bd7a16cd5"}],"licenses":[{"license":{"id":"MIT"}}]},
    {"bom-ref":"@esbuild/darwin-arm64@0.28.2","type":"library","name":"@esbuild/darwin-arm64","version":"0.28.2","scope":"optional","purl":"pkg:npm/%40esbuild/darwin-arm64@0.28.2","properties":[],"externalReferences":[{"type":"distribution","url":"https://registry.npmjs.org/@esbuild/darwin-arm64/-/darwin-arm64-0.28.2.tgz"}],"hashes":[{"alg":"SHA-512","content":"9f82aa90e42badac4725c82333546fc1b8a07d028828956933bc69f8ab318b2512ad17485e7b7bdd586b3c0c747d5e388607e62152a3c4c37d275b798f249593"}],"licenses":[{"license":{"id":"MIT"}}]},
    {"bom-ref":"@esbuild/darwin-x64@0.28.2","type":"library","name":"@esbuild/darwin-x64","version":"0.28.2","scope":"optional","purl":"pkg:npm/%40esbuild/darwin-x64@0.28.2","properties":[],"externalReferences":[{"type":"distribution","url":"https://registry.npmjs.org/@esbuild/darwin-x64/-/darwin-x64-0.28.2.tgz"}],"hashes":[{"alg":"SHA-512","content":"baaeacb885983f7eeacc675d04a3f0e501103e2e8788b1ac3bb5269297f2698350dc3fab37ac3a59fc07fa7baa7065d6bdac06c31384ae83b86069c587de5acf"}],"licenses":[{"license":{"id":"MIT"}}]},
    {"bom-ref":"@esbuild/freebsd-arm64@0.28.2","type":"library","name":"@esbuild/freebsd-arm64","version":"0.28.2","scope":"optional","purl":"pkg:npm/%40esbuild/freebsd-arm64@0.28.2","properties":[],"externalReferences":[{"type":"distribution","url":"https://registry.npmjs.org/@esbuild/freebsd-arm64/-/freebsd-arm64-0.28.2.tgz"}],"hashes":[{"alg":"SHA-512","content":"9fe234053491228cbe77a44f2a7115c2a979530049a25cadbd8e2600e204268aca96a80f208f22c7ab25555adf6794e78fb825219be5a3295b07f1093cc5845f"}],"licenses":[{"license":{"id":"MIT"}}]},
    {"bom-ref":"@esbuild/freebsd-x64@0.28.2","type":"library","name":"@esbuild/freebsd-x64","version":"0.28.2","scope":"optional","purl":"pkg:npm/%40esbuild/freebsd-x64@0.28.2","properties":[],"externalReferences":[{"type":"distribution","url":"https://registry.npmjs.org/@esbuild/freebsd-x64/-/freebsd-x64-0.28.2.tgz"}],"hashes":[{"alg":"SHA-512","content":"efc5c94c992f3ecd24cf6c3ad77d353c98d797883bab726a898319fccff2548ef710706b0914e0921bbda2a1bbbcfaaaf9aff269d116f1a0fe6a02a5939c6b9a"}],"licenses":[{"license":{"id":"MIT"}}]},
    {"bom-ref":"@esbuild/linux-arm@0.28.2","type":"library","name":"@esbuild/linux-arm","version":"0.28.2","scope":"optional","purl":"pkg:npm/%40esbuild/linux-arm@0.28.2","properties":[],"externalReferences":[{"type":"distribution","url":"https://registry.npmjs.org/@esbuild/linux-arm/-/linux-arm-0.28.2.tgz"}],"hashes":[{"alg":"SHA-512","content":"5e50e7bb6ab9ca8a9e9acfb16b2eb0480720f430c3ecaf512ca64404e3199b7724369241bce5f6d2d49f6f2f0a7ebae120d0f2bfd57661564a63f4a9a06248f3"}],"licenses":[{"license":{"id":"MIT"}}]},
    {"bom-ref":"@esbuild/linux-arm64@0.28.2","type":"library","name":"@esbuild/linux-arm64","version":"0.28.2","scope":"optional","purl":"pkg:npm/%40esbuild/linux-arm64@0.28.2","properties":[],"externalReferences":[{"type":"distribution","url":"https://registry.npmjs.org/@esbuild/linux-arm64/-/linux-arm64-0.28.2.tgz"}],"hashes":[{"alg":"SHA-512","content":"a56e000b43f78adf1cedda3d315338a79d45cc7cdd33f4d9adeaeeae045c1c9d964dad55435088ab5f319dc7e9049c38a23922659aca5b6c8805604ff768fa52"}],"licenses":[{"license":{"id":"MIT"}}]},
    {"bom-ref":"@esbuild/linux-ia32@0.28.2","type":"library","name":"@esbuild/linux-ia32","version":"0.28.2","scope":"optional","purl":"pkg:npm/%40esbuild/linux-ia32@0.28.2","properties":[],"externalReferences":[{"type":"distribution","url":"https://registry.npmjs.org/@esbuild/linux-ia32/-/linux-ia32-0.28.2.tgz"}],"hashes":[{"alg":"SHA-512","content":"0986e78fbf07b08780f8386050a80509fbcdb131c584c32b8a752b319a435c95ca37c4f75d589367ffb0b47795c44598f1ec12cd314dfa74664b03b6b5968b51"}],"licenses":[{"license":{"id":"MIT"}}]},
    {"bom-ref":"@esbuild/linux-loong64@0.28.2","type":"library","name":"@esbuild/linux-loong64","version":"0.28.2","scope":"optional","purl":"pkg:npm/%40esbuild/linux-loong64@0.28.2","properties":[],"externalReferences":[{"type":"distribution","url":"https://registry.npmjs.org/@esbuild/linux-loong64/-/linux-loong64-0.28.2.tgz"}],"hashes":[{"alg":"SHA-512","content":"6eec2477c9eca61e11f9a8d1bf0d2a3391e36bf4d7428c37a6dcd63b611b1bf72a70890796846b76506d425b21c98193345bdf91f279b693cb5646380edb0f7d"}],"licenses":[{"license":{"id":"MIT"}}]},
    {"bom-ref":"@esbuild/linux-mips64el@0.28.2","type":"library","name":"@esbuild/linux-mips64el","version":"0.28.2","scope":"optional","purl":"pkg:npm/%40esbuild/linux-mips64el@0.28.2","properties":[],"externalReferences":[{"type":"distribution","url":"https://registry.npmjs.org/@esbuild/linux-mips64el/-/linux-mips64el-0.28.2.tgz"}],"hashes":[{"alg":"SHA-512","content":"655ca46c3ca4ef9d7d57088d6fd2dc8fd9bc5cceafe55f6e28fbeb10c92411e7557b07fed22b6485a869e070e98044578702d1a56172a6c19b1bf27cb3442324"}],"licenses":[{"license":{"id":"MIT"}}]},
    {"bom-ref":"@esbuild/linux-ppc64@0.28.2","type":"library","name":"@esbuild/linux-ppc64","version":"0.28.2","scope":"optional","purl":"pkg:npm/%40esbuild/linux-ppc64@0.28.2","properties":[],"externalReferences":[{"type":"distribution","url":"https://registry.npmjs.org/@esbuild/linux-ppc64/-/linux-ppc64-0.28.2.tgz"}],"hashes":[{"alg":"SHA-512","content":"0805e5f83b5df5452e25df2928a77087a30b9b7314322a8c3e6859ded4d25cfa9fc90def0e5e91e6165d67f918a232b8a1f5ed75f4afd6d16af17cd6c7785e35"}],"licenses":[{"license":{"id":"MIT"}}]},
    {"bom-ref":"@esbuild/linux-riscv64@0.28.2","type":"library","name":"@esbuild/linux-riscv64","version":"0.28.2","scope":"optional","purl":"pkg:npm/%40esbuild/linux-riscv64@0.28.2","properties":[],"externalReferences":[{"type":"distribution","url":"https://registry.npmjs.org/@esbuild/linux-riscv64/-/linux-riscv64-0.28.2.tgz"}],"hashes":[{"alg":"SHA-512","content":"19e5c27a3e0842d53507e4250d5f16fd146f6f32373bf4adb2cfbf6c25efe25665b3958646dbb66bedc9900de2e2a21494c5e970779b5a917c024261013a30b8"}],"licenses":[{"license":{"id":"MIT"}}]},
    {"bom-ref":"@esbuild/linux-s390x@0.28.2","type":"library","name":"@esbuild/linux-s390x","version":"0.28.2","scope":"optional","purl":"pkg:npm/%40esbuild/linux-s390x@0.28.2","properties":[],"externalReferences":[{"type":"distribution","url":"https://registry.npmjs.org/@esbuild/linux-s390x/-/linux-s390x-0.28.2.tgz"}],"hashes":[{"alg":"SHA-512","content":"dc7d707936193f1b7f58e841caccd06726d2f70e652b3527d450ccb2010285b1d64301d841045f071802719bcf8631df2b22632227afbcc98451ac09add63d0e"}],"licenses":[{"license":{"id":"MIT"}}]},
    {"bom-ref":"@esbuild/linux-x64@0.28.2","type":"library","name":"@esbuild/linux-x64","version":"0.28.2","scope":"optional","purl":"pkg:npm/%40esbuild/linux-x64@0.28.2","properties":[],"externalReferences":[{"type":"distribution","url":"https://registry.npmjs.org/@esbuild/linux-x64/-/linux-x64-0.28.2.tgz"}],"hashes":[{"alg":"SHA-512","content":"e314d9af5154992a105b85c85a68addedcd0ad44d933e3773f45d5f3144e298179d177c8ef178ef74fb56d9bcdc3122e7d0f610d0551247e588603d517c03f1d"}],"licenses":[{"license":{"id":"MIT"}}]},
    {"bom-ref":"@esbuild/netbsd-arm64@0.28.2","type":"library","name":"@esbuild/netbsd-arm64","version":"0.28.2","scope":"optional","purl":"pkg:npm/%40esbuild/netbsd-arm64@0.28.2","properties":[],"externalReferences":[{"type":"distribution","url":"https://registry.npmjs.org/@esbuild/netbsd-arm64/-/netbsd-arm64-0.28.2.tgz"}],"hashes":[{"alg":"SHA-512","content":"b120134633de0c1837a5d807a107e8601a1bd752a4d4519af65ba2e51207642a029096bd40a96f977fef2b3daeb02998623b3bca6251ff6367b2a7be1e3b799f"}],"licenses":[{"license":{"id":"MIT"}}]},
    {"bom-ref":"@esbuild/netbsd-x64@0.28.2","type":"library","name":"@esbuild/netbsd-x64","version":"0.28.2","scope":"optional","purl":"pkg:npm/%40esbuild/netbsd-x64@0.28.2","properties":[],"externalReferences":[{"type":"distribution","url":"https://registry.npmjs.org/@esbuild/netbsd-x64/-/netbsd-x64-0.28.2.tgz"}],"hashes":[{"alg":"SHA-512","content":"96a9f3095fa633480800368a8a188283a89f81f5362f7879137deb35004dd58e0c6951a7cebcb39afbdfed41f1a6ba50744f21a6a2e8949f5197e4a42110e9cb"}],"licenses":[{"license":{"id":"MIT"}}]},
    {"bom-ref":"@esbuild/openbsd-arm64@0.28.2","type":"library","name":"@esbuild/openbsd-arm64","version":"0.28.2","scope":"optional","purl":"pkg:npm/%40esbuild/openbsd-arm64@0.28.2","properties":[],"externalReferences":[{"type":"distribution","url":"https://registry.npmjs.org/@esbuild/openbsd-arm64/-/openbsd-arm64-0.28.2.tgz"}],"hashes":[{"alg":"SHA-512","content":"00bdaa2482c7ee5363ac3982403bddc4c7c0508bfc28c3593afaf0010f22f3ffe7b4bf457e584ec8c27c39948c05bf3f0165dedffe6fe52db4cb7cc2a1958aa1"}],"licenses":[{"license":{"id":"MIT"}}]},
    {"bom-ref":"@esbuild/openbsd-x64@0.28.2","type":"library","name":"@esbuild/openbsd-x64","version":"0.28.2","scope":"optional","purl":"pkg:npm/%40esbuild/openbsd-x64@0.28.2","properties":[],"externalReferences":[{"type":"distribution","url":"https://registry.npmjs.org/@esbuild/openbsd-x64/-/openbsd-x64-0.28.2.tgz"}],"hashes":[{"alg":"SHA-512","content":"42d8ae3f2b5c851c82e2bc142a17b125d40abc3b99ea15a5a22de282a3d03542424b5feff4488edd44ce5d1e80dc5a0ca387e700a6d625da9a23084ece1f2a13"}],"licenses":[{"license":{"id":"MIT"}}]},
    {"bom-ref":"@esbuild/openharmony-arm64@0.28.2","type":"library","name":"@esbuild/openharmony-arm64","version":"0.28.2","scope":"optional","purl":"pkg:npm/%40esbuild/openharmony-arm64@0.28.2","properties":[],"externalReferences":[{"type":"distribution","url":"https://registry.npmjs.org/@esbuild/openharmony-arm64/-/openharmony-arm64-0.28.2.tgz"}],"hashes":[{"alg":"SHA-512","content":"5a48580e6a538cbbc6952700d6bc234549a197893ca174777086eda969842e053f7457871e51259710ef75670d255f6b6f309ec41e6fcfc82d35ec162e0093ed"}],"licenses":[{"license":{"id":"MIT"}}]},
    {"bom-ref":"@esbuild/sunos-x64@0.28.2","type":"library","name":"@esbuild/sunos-x64","version":"0.28.2","scope":"optional","purl":"pkg:npm/%40esbuild/sunos-x64@0.28.2","properties":[],"externalReferences":[{"type":"distribution","url":"https://registry.npmjs.org/@esbuild/sunos-x64/-/sunos-x64-0.28.2.tgz"}],"hashes":[{"alg":"SHA-512","content":"18f3129133ad327bf653617c8317b8228eaa995b3e60aca9f37d84b6aab1af48459e0997437af3c32b5e966dc6227ed3e15be245495fdec3a004e89376f69fee"}],"licenses":[{"license":{"id":"MIT"}}]},
    {"bom-ref":"@esbuild/win32-arm64@0.28.2","type":"library","name":"@esbuild/win32-arm64","version":"0.28.2","scope":"optional","purl":"pkg:npm/%40esbuild/win32-arm64@0.28.2","properties":[],"externalReferences":[{"type":"distribution","url":"https://registry.npmjs.org/@esbuild/win32-arm64/-/win32-arm64-0.28.2.tgz"}],"hashes":[{"alg":"SHA-512","content":"3c886112413db8f06579106b404269527ecc06789b6736c6cd858f998df1f98a1583ff79cdb8c1e02c4f3ce43c979b5860ce2631a0ad845f3fd4321f05043259"}],"licenses":[{"license":{"id":"MIT"}}]},
    {"bom-ref":"@esbuild/win32-ia32@0.28.2","type":"library","name":"@esbuild/win32-ia32","version":"0.28.2","scope":"optional","purl":"pkg:npm/%40esbuild/win32-ia32@0.28.2","properties":[],"externalReferences":[{"type":"distribution","url":"https://registry.npmjs.org/@esbuild/win32-ia32/-/win32-ia32-0.28.2.tgz"}],"hashes":[{"alg":"SHA-512","content":"62625b7d396f53b49d9fd041fb83d1112e2807aa71812dfb30038d8fe841aff7295d2d5a04f297c4d9c36eef900963e3d28f5d832c5eabbf60e9ce4ff0a7ae60"}],"licenses":[{"license":{"id":"MIT"}}]},
    {"bom-ref":"@esbuild/win32-x64@0.28.2","type":"library","name":"@esbuild/win32-x64","version":"0.28.2","scope":"optional","purl":"pkg:npm/%40esbuild/win32-x64@0.28.2","properties":[],"externalReferences":[{"type":"distribution","url":"https://registry.npmjs.org/@esbuild/win32-x64/-/win32-x64-0.28.2.tgz"}],"hashes":[{"alg":"SHA-512","content":"e5e6e9c6bde758cceb2ffae7508ef9e4992e79ed1b1cbfc6ab459317d96f729bfbdf0029e5ebbc31f0548162bd6e15af6638fbc97f1eb5fffcb48f0d7b2ebde6"}],"licenses":[{"license":{"id":"MIT"}}]},
    {"bom-ref":"@hono/node-server@2.1.1","type":"library","name":"@hono/node-server","version":"2.1.1","scope":"required","purl":"pkg:npm/%40hono/node-server@2.1.1","properties":[],"externalReferences":[{"type":"distribution","url":"https://registry.npmjs.org/@hono/node-server/-/node-server-2.1.1.tgz"}],"hashes":[{"alg":"SHA-512","content":"10bb9e8648f954205d804c3dcecfa2be42b0cb3cd409242e13de989a23ef9f51020686427336c55c92de106313623a613fa832761e291cca8460f54c61456042"}],"licenses":[{"license":{"id":"MIT"}}]},
    {"bom-ref":"@types/node@26.2.0","type":"library","name":"@types/node","version":"26.2.0","scope":"optional","purl":"pkg:npm/%40types/node@26.2.0","properties":[{"name":"cdx:npm:package:development","value":"true"}],"externalReferences":[{"type":"distribution","url":"https://registry.npmjs.org/@types/node/-/node-26.2.0.tgz"}],"hashes":[{"alg":"SHA-512","content":"e48be2ba54d9791369daf009e75e1c73f1d4958e6767d7c26eaf433320b9d81ae1159002a379c8d11eea0718509a8fdddbb3457bdeaeaff6fb5b0c6495d6be92"}],"licenses":[{"license":{"id":"MIT"}}]},
    {"bom-ref":"base64-js@1.5.1","type":"library","name":"base64-js","version":"1.5.1","scope":"required","purl":"pkg:npm/base64-js@1.5.1","properties":[],"externalReferences":[{"type":"distribution","url":"https://registry.npmjs.org/base64-js/-/base64-js-1.5.1.tgz"}],"hashes":[{"alg":"SHA-512","content":"00aa5a6251e7f2de1255b3870b2f9be7e28a82f478bebb03f2f6efadb890269b3b7ca0d3923903af2ea38b4ad42630b49336cd78f2f0cf1abc8b2a68e35a9e58"}],"licenses":[{"license":{"id":"MIT"}}]},
    {"bom-ref":"boolbase@1.0.0","type":"library","name":"boolbase","version":"1.0.0","scope":"required","purl":"pkg:npm/boolbase@1.0.0","properties":[],"externalReferences":[{"type":"distribution","url":"https://registry.npmjs.org/boolbase/-/boolbase-1.0.0.tgz"}],"hashes":[{"alg":"SHA-512","content":"25939203b328f6c34607cf948d283374bb68916024cb5cdbced3375912c26d9ef4ff771300d99098e751ef2da0f89d1ed965f2c32d724b8ebcb58f88aeea84c3"}],"licenses":[{"license":{"id":"ISC"}}]},
    {"bom-ref":"cheerio@1.2.0","type":"library","name":"cheerio","version":"1.2.0","scope":"required","purl":"pkg:npm/cheerio@1.2.0","properties":[],"externalReferences":[{"type":"distribution","url":"https://registry.npmjs.org/cheerio/-/cheerio-1.2.0.tgz"}],"hashes":[{"alg":"SHA-512","content":"583af26dcfe0285a53610bad2882ba52f7dcbb18a32197cc7d76989bc34cb0f431498bdffb5ddf5d4278af3b4619b25c050fc6179e60beb67405cd1b8ff9aabe"}],"licenses":[{"license":{"id":"MIT"}}]},
    {"bom-ref":"cheerio-select@2.1.0","type":"library","name":"cheerio-select","version":"2.1.0","scope":"required","purl":"pkg:npm/cheerio-select@2.1.0","properties":[],"externalReferences":[{"type":"distribution","url":"https://registry.npmjs.org/cheerio-select/-/cheerio-select-2.1.0.tgz"}],"hashes":[{"alg":"SHA-512","content":"f6ff641b42efceb95cba782d9c9b6918dc58f9fcc40902a12b8106257daf0727a388c5fce0c14d430e14c4f265ddb15b4ccc3e0dfb37ed7688902c1365f2e1e2"}],"licenses":[{"license":{"id":"BSD-2-Clause"}}]},
    {"bom-ref":"css-select@5.2.2","type":"library","name":"css-select","version":"5.2.2","scope":"required","purl":"pkg:npm/css-select@5.2.2","properties":[],"externalReferences":[{"type":"distribution","url":"https://registry.npmjs.org/css-select/-/css-select-5.2.2.tgz"}],"hashes":[{"alg":"SHA-512","content":"4e2cd3cd475d1bfc582c0dcd5e87453347d26cd8b35e338a86a890430be196ca5a759a249f5283cb4359152d30b84b9b218015e7f735fe502bd1369a157117cf"}],"licenses":[{"license":{"id":"BSD-2-Clause"}}]},
    {"bom-ref":"css-what@6.2.2","type":"library","name":"css-what","version":"6.2.2","scope":"required","purl":"pkg:npm/css-what@6.2.2","properties":[],"externalReferences":[{"type":"distribution","url":"https://registry.npmjs.org/css-what/-/css-what-6.2.2.tgz"}],"hashes":[{"alg":"SHA-512","content":"bbf3b7bf06e9b7384cb372f57d013cd9948b1d041fb68e60c99cf0b5e54813279a63915ced1e1d6a917f06f46849815ea9f064e26d15d5569fab93e3bf6e70bc"}],"licenses":[{"license":{"id":"BSD-2-Clause"}}]},
    {"bom-ref":"dom-serializer@2.0.0","type":"library","name":"dom-serializer","version":"2.0.0","scope":"required","purl":"pkg:npm/dom-serializer@2.0.0","properties":[],"externalReferences":[{"type":"distribution","url":"https://registry.npmjs.org/dom-serializer/-/dom-serializer-2.0.0.tgz"}],"hashes":[{"alg":"SHA-512","content":"c08900af28aab7f9d5e4440aa90a68dd24e848e57d2740e76c9ab02bb5affd3adcf76cc801867816532ef893c55b50df185b7cd594c21a00c469b7df5de2f226"}],"licenses":[{"license":{"id":"MIT"}}]},
    {"bom-ref":"domelementtype@2.3.0","type":"library","name":"domelementtype","version":"2.3.0","scope":"required","purl":"pkg:npm/domelementtype@2.3.0","properties":[],"externalReferences":[{"type":"distribution","url":"https://registry.npmjs.org/domelementtype/-/domelementtype-2.3.0.tgz"}],"hashes":[{"alg":"SHA-512","content":"38b113063eb0d0eb1a801c1d5e73dd37472731f17da2937af5ca3eed9adb7cf1ab7693d5341523d36b298ba07537bc0284b4223e7e02487ff326f5f0e7a8261f"}],"licenses":[{"license":{"id":"BSD-2-Clause"}}]},
    {"bom-ref":"domhandler@5.0.3","type":"library","name":"domhandler","version":"5.0.3","scope":"required","purl":"pkg:npm/domhandler@5.0.3","properties":[],"externalReferences":[{"type":"distribution","url":"https://registry.npmjs.org/domhandler/-/domhandler-5.0.3.tgz"}],"hashes":[{"alg":"SHA-512","content":"720c25bffd621508859d4f7a5d78113a1f314de7adb272620ec4dced36022c577dfbf58d908a8f4f188cffca5277c548ae15c64dfd4dcb5ab586ab95a83241e7"}],"licenses":[{"license":{"id":"BSD-2-Clause"}}]},
    {"bom-ref":"domutils@3.2.2","type":"library","name":"domutils","version":"3.2.2","scope":"required","purl":"pkg:npm/domutils@3.2.2","properties":[],"externalReferences":[{"type":"distribution","url":"https://registry.npmjs.org/domutils/-/domutils-3.2.2.tgz"}],"hashes":[{"alg":"SHA-512","content":"ea464ac946a3943baa9472955f5c3b832b258fd30f217cc8162cffac6bb7e6e0b5c0c8be90c850c06865e25b7dba70bd55bf4836763d677fd9037f8584048b6b"}],"licenses":[{"license":{"id":"BSD-2-Clause"}}]},
    {"bom-ref":"encoding-sniffer@0.2.1","type":"library","name":"encoding-sniffer","version":"0.2.1","scope":"required","purl":"pkg:npm/encoding-sniffer@0.2.1","properties":[],"externalReferences":[{"type":"distribution","url":"https://registry.npmjs.org/encoding-sniffer/-/encoding-sniffer-0.2.1.tgz"}],"hashes":[{"alg":"SHA-512","content":"e60beadb44fabdfa5e915b6aad842c482159d70120e7ec16d3f41a64c5a416be81a83dcd7cab34acb0b1e2bad59525897996f934126054bb302bfc3631653e1b"}],"licenses":[{"license":{"id":"MIT"}}]},
    {"bom-ref":"entities@4.5.0","type":"library","name":"entities","version":"4.5.0","scope":"required","purl":"pkg:npm/entities@4.5.0","properties":[],"externalReferences":[{"type":"distribution","url":"https://registry.npmjs.org/entities/-/entities-4.5.0.tgz"}],"hashes":[{"alg":"SHA-512","content":"5748631f87463e1f40a39a74328458e8156ab700a3873eaf2392d3f00279e47fb883dff8bdb1f1d48e787d2d17b9c94b8431c0acf40288c8c3c6368bf1f3f187"}],"licenses":[{"license":{"id":"BSD-2-Clause"}}]},
    {"bom-ref":"esbuild@0.28.2","type":"library","name":"esbuild","version":"0.28.2","scope":"required","purl":"pkg:npm/esbuild@0.28.2","properties":[],"externalReferences":[{"type":"distribution","url":"https://registry.npmjs.org/esbuild/-/esbuild-0.28.2.tgz"}],"hashes":[{"alg":"SHA-512","content":"1ca54b4bc76f208fb1a0a5bd926ab16d12ab9d61177c926bfc56618499a2a880747b4e7740d605a8e068b9330efe4e6c203e0cbc28940afbfc6fd338877db020"}],"licenses":[{"license":{"id":"MIT"}}]},
    {"bom-ref":"fflate@0.8.3","type":"library","name":"fflate","version":"0.8.3","scope":"required","purl":"pkg:npm/fflate@0.8.3","properties":[],"externalReferences":[{"type":"distribution","url":"https://registry.npmjs.org/fflate/-/fflate-0.8.3.tgz"}],"hashes":[{"alg":"SHA-512","content":"b5b64db89acbc06529df3b2106d772e16f8e47166e221f1ae629722044030b9ad8d5fdd4db424caf2d0b977581cd4e7c1192ac12e2455e16f9830bfc0ac3ef80"}],"licenses":[{"license":{"id":"MIT"}}]},
    {"bom-ref":"fsevents@2.3.3","type":"library","name":"fsevents","version":"2.3.3","scope":"optional","purl":"pkg:npm/fsevents@2.3.3","properties":[],"externalReferences":[{"type":"distribution","url":"https://registry.npmjs.org/fsevents/-/fsevents-2.3.3.tgz"}],"hashes":[{"alg":"SHA-512","content":"e71a037d7f9f2fb7da0139da82658fa5b16dc21fd1efb5a630caaa1c64bae42defbc1d181eb805f81d58999df8e35b4c8f99fade4d36d765cda09c339617df43"}],"licenses":[{"license":{"id":"MIT"}}]},
    {"bom-ref":"hono@4.13.2","type":"library","name":"hono","version":"4.13.2","scope":"required","purl":"pkg:npm/hono@4.13.2","properties":[],"externalReferences":[{"type":"distribution","url":"https://registry.npmjs.org/hono/-/hono-4.13.2.tgz"}],"hashes":[{"alg":"SHA-512","content":"2727518a50d191805032df6a47d53dda65f199b1aab2a4a7fc828eae1e1eeff8046e7fb4cd2afc8a04eed286f0268346378b1ecf6f0322a97b1411d6c9da09a4"}],"licenses":[{"license":{"id":"MIT"}}]},
    {"bom-ref":"htmlparser2@10.1.0","type":"library","name":"htmlparser2","version":"10.1.0","scope":"required","purl":"pkg:npm/htmlparser2@10.1.0","properties":[],"externalReferences":[{"type":"distribution","url":"https://registry.npmjs.org/htmlparser2/-/htmlparser2-10.1.0.tgz"}],"hashes":[{"alg":"SHA-512","content":"55366433d196440b44a6f7a1ecc485e928e3ae935534d5497c5ba9ef14d8dd4a45b66ebb7e8cbd1c35579de2ed155b78a4ccf9919b6035cbc29e23456f586511"}],"licenses":[{"license":{"id":"MIT"}}]},
    {"bom-ref":"entities@7.0.1","type":"library","name":"entities","version":"7.0.1","scope":"required","purl":"pkg:npm/entities@7.0.1","properties":[],"externalReferences":[{"type":"distribution","url":"https://registry.npmjs.org/entities/-/entities-7.0.1.tgz"}],"hashes":[{"alg":"SHA-512","content":"4d6ae02ce1544131fdf78614ca5d724f8bb26af6399cd0799ae7dff91b566aa3550802b8d3c6f96679db34050458b4c2a6e9bdc3a6ab4fbd22d57750e1478e3c"}],"licenses":[{"license":{"id":"BSD-2-Clause"}}]},
    {"bom-ref":"iconv-lite@0.6.3","type":"library","name":"iconv-lite","version":"0.6.3","scope":"required","purl":"pkg:npm/iconv-lite@0.6.3","properties":[],"externalReferences":[{"type":"distribution","url":"https://registry.npmjs.org/iconv-lite/-/iconv-lite-0.6.3.tgz"}],"hashes":[{"alg":"SHA-512","content":"e1f0a4efdc2c84c773329dab1f4eaa5ab244e22a25a8b842507f8e8ae22053ef91074fbde0d9432fcd5ab4eec65f9e6e50ab9ea34b711cdb6f13223a0fb59d33"}],"licenses":[{"license":{"id":"MIT"}}]},
    {"bom-ref":"js-tiktoken@1.0.21","type":"library","name":"js-tiktoken","version":"1.0.21","scope":"required","purl":"pkg:npm/js-tiktoken@1.0.21","properties":[],"externalReferences":[{"type":"distribution","url":"https://registry.npmjs.org/js-tiktoken/-/js-tiktoken-1.0.21.tgz"}],"hashes":[{"alg":"SHA-512","content":"6e23a3ffa339a9d831e532a30e7153d72992a4ce6d6dddf29700edad0bc5412bb467b6c1624a36745f96fda5245d43ee93a215a51c64ff7436b073b31a54b7ea"}],"licenses":[{"license":{"id":"MIT"}}]},
    {"bom-ref":"nth-check@2.1.1","type":"library","name":"nth-check","version":"2.1.1","scope":"required","purl":"pkg:npm/nth-check@2.1.1","properties":[],"externalReferences":[{"type":"distribution","url":"https://registry.npmjs.org/nth-check/-/nth-check-2.1.1.tgz"}],"hashes":[{"alg":"SHA-512","content":"96a8eb8e668ea009d67cc9813cbf97367ca7661dbeb30c625f7594134b38c841c8ea6f80c2b2b65193a2988465dd7ff841cb55a92f008998c5ab2386acc5dbff"}],"licenses":[{"license":{"id":"BSD-2-Clause"}}]},
    {"bom-ref":"parse5@7.3.0","type":"library","name":"parse5","version":"7.3.0","scope":"required","purl":"pkg:npm/parse5@7.3.0","properties":[],"externalReferences":[{"type":"distribution","url":"https://registry.npmjs.org/parse5/-/parse5-7.3.0.tgz"}],"hashes":[{"alg":"SHA-512","content":"2089ef53b7da6e5df8aa68bd818f17395c61632332b87db150da5bdaaf3f63eef9e762a57a3911beabc3d7d9cca145bfb901866ea36903a4ee7eee452f905983"}],"licenses":[{"license":{"id":"MIT"}}]},
    {"bom-ref":"parse5-htmlparser2-tree-adapter@7.1.0","type":"library","name":"parse5-htmlparser2-tree-adapter","version":"7.1.0","scope":"required","purl":"pkg:npm/parse5-htmlparser2-tree-adapter@7.1.0","properties":[],"externalReferences":[{"type":"distribution","url":"https://registry.npmjs.org/parse5-htmlparser2-tree-adapter/-/parse5-htmlparser2-tree-adapter-7.1.0.tgz"}],"hashes":[{"alg":"SHA-512","content":"aeec39c722acea5ae9a3dc7dac266a6599c8527b480a34007745ac9a9dfde9497d94dfe1fa27e0555d71d606478bc7ae7a3eb04dfa6a5fc8fe045431174352fe"}],"licenses":[{"license":{"id":"MIT"}}]},
    {"bom-ref":"parse5-parser-stream@7.1.2","type":"library","name":"parse5-parser-stream","version":"7.1.2","scope":"required","purl":"pkg:npm/parse5-parser-stream@7.1.2","properties":[],"externalReferences":[{"type":"distribution","url":"https://registry.npmjs.org/parse5-parser-stream/-/parse5-parser-stream-7.1.2.tgz"}],"hashes":[{"alg":"SHA-512","content":"27279073d8b014b9f94dbbefa8008817f5571ba69b383781dc5c26bff4c674b9362df6d691ac92198ef66ade3e4f2ec490f663f39e2ee02ac80aa364daa21ba3"}],"licenses":[{"license":{"id":"MIT"}}]},
    {"bom-ref":"entities@6.0.1","type":"library","name":"entities","version":"6.0.1","scope":"required","purl":"pkg:npm/entities@6.0.1","properties":[],"externalReferences":[{"type":"distribution","url":"https://registry.npmjs.org/entities/-/entities-6.0.1.tgz"}],"hashes":[{"alg":"SHA-512","content":"68df7b357585e805814da85f54e22b07f352864ce2e47ec5f6bd6cf660f77038f82a8e5fdaa86156860c89b5c5ec694bbde6ff0f68a859acbc97123ded57a7de"}],"licenses":[{"license":{"id":"BSD-2-Clause"}}]},
    {"bom-ref":"safer-buffer@2.1.2","type":"library","name":"safer-buffer","version":"2.1.2","scope":"required","purl":"pkg:npm/safer-buffer@2.1.2","properties":[],"externalReferences":[{"type":"distribution","url":"https://registry.npmjs.org/safer-buffer/-/safer-buffer-2.1.2.tgz"}],"hashes":[{"alg":"SHA-512","content":"619a372bcd920fb462ca2d04d4440fa232f3ee4a5ea6749023d2323db1c78355d75debdbe5d248eeda72376003c467106c71bbbdcc911e4d1c6f0a9c42b894b6"}],"licenses":[{"license":{"id":"MIT"}}]},
    {"bom-ref":"tsx@4.23.12","type":"library","name":"tsx","version":"4.23.12","scope":"required","purl":"pkg:npm/tsx@4.23.12","properties":[],"externalReferences":[{"type":"distribution","url":"https://registry.npmjs.org/tsx/-/tsx-4.23.12.tgz"}],"hashes":[{"alg":"SHA-512","content":"1437f82f8b18ccab73598854fd79b401015d4e3748c4da3d1254dfda6c5733a93c60c1d7cd851ee3238355a5cfe15f6e3056d583c734ab205c70ad8e3b16f8e5"}],"licenses":[{"license":{"id":"MIT"}}]},
    {"bom-ref":"typescript@6.0.3","type":"library","name":"typescript","version":"6.0.3","scope":"optional","purl":"pkg:npm/typescript@6.0.3","properties":[{"name":"cdx:npm:package:development","value":"true"}],"externalReferences":[{"type":"distribution","url":"https://registry.npmjs.org/typescript/-/typescript-6.0.3.tgz"}],"hashes":[{"alg":"SHA-512","content":"cb64efbb14993c3c906a490544f6472859be28a56a222b1d83dfc26709bd7edbca5cb3fc3515a3dfcfce0e335baf8dd2b285ea36e022b047f519d0b1a9671d07"}],"licenses":[{"license":{"id":"Apache-2.0"}}]},
    {"bom-ref":"undici@7.29.0","type":"library","name":"undici","version":"7.29.0","scope":"required","purl":"pkg:npm/undici@7.29.0","properties":[],"externalReferences":[{"type":"distribution","url":"https://registry.npmjs.org/undici/-/undici-7.29.0.tgz"}],"hashes":[{"alg":"SHA-512","content":"203c5f95e2e699b4ac91f5925004e23759df9f6ac3baf9cc3aa6f909647dda221fa2303451dfae94e000110e7b2cfafdad69acade5327f9970c9aa3eec634d57"}],"licenses":[{"license":{"id":"MIT"}}]},
    {"bom-ref":"undici-types@8.3.0","type":"library","name":"undici-types","version":"8.3.0","scope":"optional","purl":"pkg:npm/undici-types@8.3.0","properties":[{"name":"cdx:npm:package:development","value":"true"}],"externalReferences":[{"type":"distribution","url":"https://registry.npmjs.org/undici-types/-/undici-types-8.3.0.tgz"}],"hashes":[{"alg":"SHA-512","content":"8f7ef949c57ad1da26f9890f1487d32dc3a23f190dfdbb87cf91a86e32e18b116e00d68db370bd9781a6ad6a9e8e05d627b05b25c158a53114912d467bc6e965"}],"licenses":[{"license":{"id":"MIT"}}]},
    {"bom-ref":"whatwg-encoding@3.1.1","type":"library","name":"whatwg-encoding","version":"3.1.1","scope":"required","purl":"pkg:npm/whatwg-encoding@3.1.1","properties":[],"externalReferences":[{"type":"distribution","url":"https://registry.npmjs.org/whatwg-encoding/-/whatwg-encoding-3.1.1.tgz"}],"hashes":[{"alg":"SHA-512","content":"eaa37884974cc1f601b44dd80534c78687ae52b0c13d999b41ac5602a4802d5fcc7849d1e73d7177c50ab9dd910241683e4981fa1962d536529f28bce31cf5bd"}],"licenses":[{"license":{"id":"MIT"}}]},
    {"bom-ref":"whatwg-mimetype@4.0.0","type":"library","name":"whatwg-mimetype","version":"4.0.0","scope":"required","purl":"pkg:npm/whatwg-mimetype@4.0.0","properties":[],"externalReferences":[{"type":"distribution","url":"https://registry.npmjs.org/whatwg-mimetype/-/whatwg-mimetype-4.0.0.tgz"}],"hashes":[{"alg":"SHA-512","content":"41a2b187478d222da613da76bc47737da80e28709c8f5a49e7a1041c640e571a7cafdfe2b332d4515eeff3dc7d3b5a7f4fe3654cce56ee35baf9ccf816ad5856"}],"licenses":[{"license":{"id":"MIT"}}]},
    {"bom-ref":"zod@3.25.76","type":"library","name":"zod","version":"3.25.76","scope":"required","purl":"pkg:npm/zod@3.25.76","properties":[],"externalReferences":[{"type":"distribution","url":"https://registry.npmjs.org/zod/-/zod-3.25.76.tgz"}],"hashes":[{"alg":"SHA-512","content":"83352dfeab7cd675ec14628815c0b76277c4031e4d92e9c27e70e5bee0524854b4d9b717bb82e679ad001485306cb5b158fc7777da7c4b94286ae8ca70d43171"}],"licenses":[{"license":{"id":"MIT"}}]}
  ],
  "dependencies": [
    {"ref":"urtube@0.1.0","dependsOn":["@hono/node-server@2.1.1","cheerio@1.2.0","fflate@0.8.3","hono@4.13.2","js-tiktoken@1.0.21","tsx@4.23.12","zod@3.25.76","@types/node@26.2.0","typescript@6.0.3"]},
    {"ref":"@esbuild/aix-ppc64@0.28.2","dependsOn":[]},
    {"ref":"@esbuild/android-arm@0.28.2","dependsOn":[]},
    {"ref":"@esbuild/android-arm64@0.28.2","dependsOn":[]},
    {"ref":"@esbuild/android-x64@0.28.2","dependsOn":[]},
    {"ref":"@esbuild/darwin-arm64@0.28.2","dependsOn":[]},
    {"ref":"@esbuild/darwin-x64@0.28.2","dependsOn":[]},
    {"ref":"@esbuild/freebsd-arm64@0.28.2","dependsOn":[]},
    {"ref":"@esbuild/freebsd-x64@0.28.2","dependsOn":[]},
    {"ref":"@esbuild/linux-arm@0.28.2","dependsOn":[]},
    {"ref":"@esbuild/linux-arm64@0.28.2","dependsOn":[]},
    {"ref":"@esbuild/linux-ia32@0.28.2","dependsOn":[]},
    {"ref":"@esbuild/linux-loong64@0.28.2","dependsOn":[]},
    {"ref":"@esbuild/linux-mips64el@0.28.2","dependsOn":[]},
    {"ref":"@esbuild/linux-ppc64@0.28.2","dependsOn":[]},
    {"ref":"@esbuild/linux-riscv64@0.28.2","dependsOn":[]},
    {"ref":"@esbuild/linux-s390x@0.28.2","dependsOn":[]},
    {"ref":"@esbuild/linux-x64@0.28.2","dependsOn":[]},
    {"ref":"@esbuild/netbsd-arm64@0.28.2","dependsOn":[]},
    {"ref":"@esbuild/netbsd-x64@0.28.2","dependsOn":[]},
    {"ref":"@esbuild/openbsd-arm64@0.28.2","dependsOn":[]},
    {"ref":"@esbuild/openbsd-x64@0.28.2","dependsOn":[]},
    {"ref":"@esbuild/openharmony-arm64@0.28.2","dependsOn":[]},
    {"ref":"@esbuild/sunos-x64@0.28.2","dependsOn":[]},
    {"ref":"@esbuild/win32-arm64@0.28.2","dependsOn":[]},
    {"ref":"@esbuild/win32-ia32@0.28.2","dependsOn":[]},
    {"ref":"@esbuild/win32-x64@0.28.2","dependsOn":[]},
    {"ref":"@hono/node-server@2.1.1","dependsOn":["hono@4.13.2"]},
    {"ref":"@types/node@26.2.0","dependsOn":["undici-types@8.3.0"]},
    {"ref":"base64-js@1.5.1","dependsOn":[]},
    {"ref":"boolbase@1.0.0","dependsOn":[]},
    {"ref":"cheerio@1.2.0","dependsOn":["cheerio-select@2.1.0","dom-serializer@2.0.0","domhandler@5.0.3","domutils@3.2.2","encoding-sniffer@0.2.1","htmlparser2@10.1.0","parse5@7.3.0","parse5-htmlparser2-tree-adapter@7.1.0","parse5-parser-stream@7.1.2","undici@7.29.0","whatwg-mimetype@4.0.0"]},
    {"ref":"cheerio-select@2.1.0","dependsOn":["boolbase@1.0.0","css-select@5.2.2","css-what@6.2.2","domelementtype@2.3.0","domhandler@5.0.3","domutils@3.2.2"]},
    {"ref":"css-select@5.2.2","dependsOn":["boolbase@1.0.0","css-what@6.2.2","domhandler@5.0.3","domutils@3.2.2","nth-check@2.1.1"]},
    {"ref":"css-what@6.2.2","dependsOn":[]},
    {"ref":"dom-serializer@2.0.0","dependsOn":["domelementtype@2.3.0","domhandler@5.0.3","entities@4.5.0"]},
    {"ref":"domelementtype@2.3.0","dependsOn":[]},
    {"ref":"domhandler@5.0.3","dependsOn":["domelementtype@2.3.0"]},
    {"ref":"domutils@3.2.2","dependsOn":["dom-serializer@2.0.0","domelementtype@2.3.0","domhandler@5.0.3"]},
    {"ref":"encoding-sniffer@0.2.1","dependsOn":["iconv-lite@0.6.3","whatwg-encoding@3.1.1"]},
    {"ref":"entities@4.5.0","dependsOn":[]},
    {"ref":"esbuild@0.28.2","dependsOn":["@esbuild/aix-ppc64@0.28.2","@esbuild/android-arm@0.28.2","@esbuild/android-arm64@0.28.2","@esbuild/android-x64@0.28.2","@esbuild/darwin-arm64@0.28.2","@esbuild/darwin-x64@0.28.2","@esbuild/freebsd-arm64@0.28.2","@esbuild/freebsd-x64@0.28.2","@esbuild/linux-arm@0.28.2","@esbuild/linux-arm64@0.28.2","@esbuild/linux-ia32@0.28.2","@esbuild/linux-loong64@0.28.2","@esbuild/linux-mips64el@0.28.2","@esbuild/linux-ppc64@0.28.2","@esbuild/linux-riscv64@0.28.2","@esbuild/linux-s390x@0.28.2","@esbuild/linux-x64@0.28.2","@esbuild/netbsd-arm64@0.28.2","@esbuild/netbsd-x64@0.28.2","@esbuild/openbsd-arm64@0.28.2","@esbuild/openbsd-x64@0.28.2","@esbuild/openharmony-arm64@0.28.2","@esbuild/sunos-x64@0.28.2","@esbuild/win32-arm64@0.28.2","@esbuild/win32-ia32@0.28.2","@esbuild/win32-x64@0.28.2"]},
    {"ref":"fflate@0.8.3","dependsOn":[]},
    {"ref":"fsevents@2.3.3","dependsOn":[]},
    {"ref":"hono@4.13.2","dependsOn":[]},
    {"ref":"htmlparser2@10.1.0","dependsOn":["domelementtype@2.3.0","domhandler@5.0.3","domutils@3.2.2","entities@7.0.1"]},
    {"ref":"entities@7.0.1","dependsOn":[]},
    {"ref":"iconv-lite@0.6.3","dependsOn":["safer-buffer@2.1.2"]},
    {"ref":"js-tiktoken@1.0.21","dependsOn":["base64-js@1.5.1"]},
    {"ref":"nth-check@2.1.1","dependsOn":["boolbase@1.0.0"]},
    {"ref":"parse5@7.3.0","dependsOn":["entities@6.0.1"]},
    {"ref":"parse5-htmlparser2-tree-adapter@7.1.0","dependsOn":["domhandler@5.0.3","parse5@7.3.0"]},
    {"ref":"parse5-parser-stream@7.1.2","dependsOn":["parse5@7.3.0"]},
    {"ref":"entities@6.0.1","dependsOn":[]},
    {"ref":"safer-buffer@2.1.2","dependsOn":[]},
    {"ref":"tsx@4.23.12","dependsOn":["esbuild@0.28.2","fsevents@2.3.3"]},
    {"ref":"typescript@6.0.3","dependsOn":[]},
    {"ref":"undici@7.29.0","dependsOn":[]},
    {"ref":"undici-types@8.3.0","dependsOn":[]},
    {"ref":"whatwg-encoding@3.1.1","dependsOn":["iconv-lite@0.6.3"]},
    {"ref":"whatwg-mimetype@4.0.0","dependsOn":[]},
    {"ref":"zod@3.25.76","dependsOn":[]}
  ]
}
```
<!-- sbom:end -->

</details>

## 授權原文與第三方 notices

以下依文字內容去重；同一區塊列出所有適用套件與原始檔名。保留 copyright 與授權原文，僅統一換行並移除行尾空白以供 Markdown 閱讀。

<details>
<summary>授權原文 1：@esbuild/aix-ppc64@0.28.2 等 27 項</summary>

- `@esbuild/aix-ppc64@0.28.2` — `upstream v0.28.2 LICENSE.md`
- `@esbuild/android-arm@0.28.2` — `upstream v0.28.2 LICENSE.md`
- `@esbuild/android-arm64@0.28.2` — `upstream v0.28.2 LICENSE.md`
- `@esbuild/android-x64@0.28.2` — `upstream v0.28.2 LICENSE.md`
- `@esbuild/darwin-arm64@0.28.2` — `upstream v0.28.2 LICENSE.md`
- `@esbuild/darwin-x64@0.28.2` — `upstream v0.28.2 LICENSE.md`
- `@esbuild/freebsd-arm64@0.28.2` — `upstream v0.28.2 LICENSE.md`
- `@esbuild/freebsd-x64@0.28.2` — `upstream v0.28.2 LICENSE.md`
- `@esbuild/linux-arm@0.28.2` — `upstream v0.28.2 LICENSE.md`
- `@esbuild/linux-arm64@0.28.2` — `upstream v0.28.2 LICENSE.md`
- `@esbuild/linux-ia32@0.28.2` — `upstream v0.28.2 LICENSE.md`
- `@esbuild/linux-loong64@0.28.2` — `upstream v0.28.2 LICENSE.md`
- `@esbuild/linux-mips64el@0.28.2` — `upstream v0.28.2 LICENSE.md`
- `@esbuild/linux-ppc64@0.28.2` — `upstream v0.28.2 LICENSE.md`
- `@esbuild/linux-riscv64@0.28.2` — `upstream v0.28.2 LICENSE.md`
- `@esbuild/linux-s390x@0.28.2` — `upstream v0.28.2 LICENSE.md`
- `@esbuild/linux-x64@0.28.2` — `upstream v0.28.2 LICENSE.md`
- `@esbuild/netbsd-arm64@0.28.2` — `upstream v0.28.2 LICENSE.md`
- `@esbuild/netbsd-x64@0.28.2` — `upstream v0.28.2 LICENSE.md`
- `@esbuild/openbsd-arm64@0.28.2` — `upstream v0.28.2 LICENSE.md`
- `@esbuild/openbsd-x64@0.28.2` — `upstream v0.28.2 LICENSE.md`
- `@esbuild/openharmony-arm64@0.28.2` — `upstream v0.28.2 LICENSE.md`
- `@esbuild/sunos-x64@0.28.2` — `upstream v0.28.2 LICENSE.md`
- `@esbuild/win32-arm64@0.28.2` — `upstream v0.28.2 LICENSE.md`
- `@esbuild/win32-ia32@0.28.2` — `upstream v0.28.2 LICENSE.md`
- `@esbuild/win32-x64@0.28.2` — `upstream v0.28.2 LICENSE.md`
- `esbuild@0.28.2` — `package/LICENSE.md`

```text
MIT License

Copyright (c) 2020 Evan Wallace

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

</details>

<details>
<summary>授權原文 2：@hono/node-server@2.1.1</summary>

- `@hono/node-server@2.1.1` — `package/LICENSE`

```text
MIT License

Copyright (c) 2022 - present, Yusuke Wada and Hono contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

</details>

<details>
<summary>授權原文 3：@types/node@26.2.0</summary>

- `@types/node@26.2.0` — `node/LICENSE`

```text
MIT License

    Copyright (c) Microsoft Corporation.

    Permission is hereby granted, free of charge, to any person obtaining a copy
    of this software and associated documentation files (the "Software"), to deal
    in the Software without restriction, including without limitation the rights
    to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
    copies of the Software, and to permit persons to whom the Software is
    furnished to do so, subject to the following conditions:

    The above copyright notice and this permission notice shall be included in all
    copies or substantial portions of the Software.

    THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
    IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
    FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
    AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
    LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
    OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
    SOFTWARE
```

</details>

<details>
<summary>授權原文 4：boolbase@1.0.0</summary>

- `boolbase@1.0.0` — `upstream be0bcd8 LICENSE`

```text
Copyright (c) 2014-2015, Felix Boehm <me@feedic.com>

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
```

</details>

<details>
<summary>授權原文 5：cheerio@1.2.0</summary>

- `cheerio@1.2.0` — `package/LICENSE`

```text
MIT License

Copyright (c) 2022 The Cheerio contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

</details>

<details>
<summary>授權原文 6：cheerio-select@2.1.0 等 10 項</summary>

- `cheerio-select@2.1.0` — `package/LICENSE`
- `css-select@5.2.2` — `package/LICENSE`
- `css-what@6.2.2` — `package/LICENSE`
- `domelementtype@2.3.0` — `package/LICENSE`
- `domhandler@5.0.3` — `package/LICENSE`
- `domutils@3.2.2` — `package/LICENSE`
- `entities@4.5.0` — `package/LICENSE`
- `entities@7.0.1` — `package/LICENSE`
- `nth-check@2.1.1` — `package/LICENSE`
- `entities@6.0.1` — `package/LICENSE`

```text
Copyright (c) Felix Böhm
All rights reserved.

Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:

Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.

Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.

THIS IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS,
EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

</details>

<details>
<summary>授權原文 7：dom-serializer@2.0.0</summary>

- `dom-serializer@2.0.0` — `package/LICENSE`

```text
License

(The MIT License)

Copyright (c) 2014 The cheeriojs contributors

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the 'Software'), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

</details>

<details>
<summary>授權原文 8：encoding-sniffer@0.2.1</summary>

- `encoding-sniffer@0.2.1` — `package/LICENSE`

```text
Copyright (c) 2022 Felix Boehm <me@feedic.com>

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

</details>

<details>
<summary>授權原文 9：fflate@0.8.3</summary>

- `fflate@0.8.3` — `package/LICENSE`

```text
MIT License

Copyright (c) 2026 Arjun Barrett

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

</details>

<details>
<summary>授權原文 10：fsevents@2.3.3</summary>

- `fsevents@2.3.3` — `package/LICENSE`

```text
MIT License
-----------

Copyright (C) 2010-2020 by Philipp Dunkel, Ben Noordhuis, Elan Shankar, Paul Miller

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

</details>

<details>
<summary>授權原文 11：hono@4.13.2</summary>

- `hono@4.13.2` — `package/LICENSE`

```text
MIT License

Copyright (c) 2021 - present, Yusuke Wada and Hono contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

</details>

<details>
<summary>授權原文 12：htmlparser2@10.1.0</summary>

- `htmlparser2@10.1.0` — `package/LICENSE`

```text
Copyright 2010, 2011, Chris Winberry <chris@winberry.net>. All rights reserved.
Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to
deal in the Software without restriction, including without limitation the
rights to use, copy, modify, merge, publish, distribute, sublicense, and/or
sell copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
IN THE SOFTWARE.
```

</details>

<details>
<summary>授權原文 13：iconv-lite@0.6.3</summary>

- `iconv-lite@0.6.3` — `package/LICENSE`

```text
Copyright (c) 2011 Alexander Shtuchkin

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
"Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

</details>

<details>
<summary>授權原文 14：parse5@7.3.0 等 3 項</summary>

- `parse5@7.3.0` — `package/LICENSE`
- `parse5-htmlparser2-tree-adapter@7.1.0` — `package/LICENSE`
- `parse5-parser-stream@7.1.2` — `package/LICENSE`

```text
Copyright (c) 2013-2019 Ivan Nikulin (ifaaan@gmail.com, https://github.com/inikulin)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

</details>

<details>
<summary>授權原文 15：safer-buffer@2.1.2</summary>

- `safer-buffer@2.1.2` — `package/LICENSE`

```text
MIT License

Copyright (c) 2018 Nikita Skovoroda <chalkerx@gmail.com>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

</details>

<details>
<summary>授權原文 16：tsx@4.23.12</summary>

- `tsx@4.23.12` — `package/LICENSE`

```text
MIT License

Copyright (c) Hiroki Osame <hiroki.osame@gmail.com>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

</details>

<details>
<summary>授權原文 17：typescript@6.0.3</summary>

- `typescript@6.0.3` — `package/LICENSE.txt`

```text
Apache License

Version 2.0, January 2004

http://www.apache.org/licenses/

TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

1. Definitions.

"License" shall mean the terms and conditions for use, reproduction, and distribution as defined by Sections 1 through 9 of this document.

"Licensor" shall mean the copyright owner or entity authorized by the copyright owner that is granting the License.

"Legal Entity" shall mean the union of the acting entity and all other entities that control, are controlled by, or are under common control with that entity. For the purposes of this definition, "control" means (i) the power, direct or indirect, to cause the direction or management of such entity, whether by contract or otherwise, or (ii) ownership of fifty percent (50%) or more of the outstanding shares, or (iii) beneficial ownership of such entity.

"You" (or "Your") shall mean an individual or Legal Entity exercising permissions granted by this License.

"Source" form shall mean the preferred form for making modifications, including but not limited to software source code, documentation source, and configuration files.

"Object" form shall mean any form resulting from mechanical transformation or translation of a Source form, including but not limited to compiled object code, generated documentation, and conversions to other media types.

"Work" shall mean the work of authorship, whether in Source or Object form, made available under the License, as indicated by a copyright notice that is included in or attached to the work (an example is provided in the Appendix below).

"Derivative Works" shall mean any work, whether in Source or Object form, that is based on (or derived from) the Work and for which the editorial revisions, annotations, elaborations, or other modifications represent, as a whole, an original work of authorship. For the purposes of this License, Derivative Works shall not include works that remain separable from, or merely link (or bind by name) to the interfaces of, the Work and Derivative Works thereof.

"Contribution" shall mean any work of authorship, including the original version of the Work and any modifications or additions to that Work or Derivative Works thereof, that is intentionally submitted to Licensor for inclusion in the Work by the copyright owner or by an individual or Legal Entity authorized to submit on behalf of the copyright owner. For the purposes of this definition, "submitted" means any form of electronic, verbal, or written communication sent to the Licensor or its representatives, including but not limited to communication on electronic mailing lists, source code control systems, and issue tracking systems that are managed by, or on behalf of, the Licensor for the purpose of discussing and improving the Work, but excluding communication that is conspicuously marked or otherwise designated in writing by the copyright owner as "Not a Contribution."

"Contributor" shall mean Licensor and any individual or Legal Entity on behalf of whom a Contribution has been received by Licensor and subsequently incorporated within the Work.

2. Grant of Copyright License. Subject to the terms and conditions of this License, each Contributor hereby grants to You a perpetual, worldwide, non-exclusive, no-charge, royalty-free, irrevocable copyright license to reproduce, prepare Derivative Works of, publicly display, publicly perform, sublicense, and distribute the Work and such Derivative Works in Source or Object form.

3. Grant of Patent License. Subject to the terms and conditions of this License, each Contributor hereby grants to You a perpetual, worldwide, non-exclusive, no-charge, royalty-free, irrevocable (except as stated in this section) patent license to make, have made, use, offer to sell, sell, import, and otherwise transfer the Work, where such license applies only to those patent claims licensable by such Contributor that are necessarily infringed by their Contribution(s) alone or by combination of their Contribution(s) with the Work to which such Contribution(s) was submitted. If You institute patent litigation against any entity (including a cross-claim or counterclaim in a lawsuit) alleging that the Work or a Contribution incorporated within the Work constitutes direct or contributory patent infringement, then any patent licenses granted to You under this License for that Work shall terminate as of the date such litigation is filed.

4. Redistribution. You may reproduce and distribute copies of the Work or Derivative Works thereof in any medium, with or without modifications, and in Source or Object form, provided that You meet the following conditions:

You must give any other recipients of the Work or Derivative Works a copy of this License; and

You must cause any modified files to carry prominent notices stating that You changed the files; and

You must retain, in the Source form of any Derivative Works that You distribute, all copyright, patent, trademark, and attribution notices from the Source form of the Work, excluding those notices that do not pertain to any part of the Derivative Works; and

If the Work includes a "NOTICE" text file as part of its distribution, then any Derivative Works that You distribute must include a readable copy of the attribution notices contained within such NOTICE file, excluding those notices that do not pertain to any part of the Derivative Works, in at least one of the following places: within a NOTICE text file distributed as part of the Derivative Works; within the Source form or documentation, if provided along with the Derivative Works; or, within a display generated by the Derivative Works, if and wherever such third-party notices normally appear. The contents of the NOTICE file are for informational purposes only and do not modify the License. You may add Your own attribution notices within Derivative Works that You distribute, alongside or as an addendum to the NOTICE text from the Work, provided that such additional attribution notices cannot be construed as modifying the License. You may add Your own copyright statement to Your modifications and may provide additional or different license terms and conditions for use, reproduction, or distribution of Your modifications, or for any such Derivative Works as a whole, provided Your use, reproduction, and distribution of the Work otherwise complies with the conditions stated in this License.

5. Submission of Contributions. Unless You explicitly state otherwise, any Contribution intentionally submitted for inclusion in the Work by You to the Licensor shall be under the terms and conditions of this License, without any additional terms or conditions. Notwithstanding the above, nothing herein shall supersede or modify the terms of any separate license agreement you may have executed with Licensor regarding such Contributions.

6. Trademarks. This License does not grant permission to use the trade names, trademarks, service marks, or product names of the Licensor, except as required for reasonable and customary use in describing the origin of the Work and reproducing the content of the NOTICE file.

7. Disclaimer of Warranty. Unless required by applicable law or agreed to in writing, Licensor provides the Work (and each Contributor provides its Contributions) on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied, including, without limitation, any warranties or conditions of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A PARTICULAR PURPOSE. You are solely responsible for determining the appropriateness of using or redistributing the Work and assume any risks associated with Your exercise of permissions under this License.

8. Limitation of Liability. In no event and under no legal theory, whether in tort (including negligence), contract, or otherwise, unless required by applicable law (such as deliberate and grossly negligent acts) or agreed to in writing, shall any Contributor be liable to You for damages, including any direct, indirect, special, incidental, or consequential damages of any character arising as a result of this License or out of the use or inability to use the Work (including but not limited to damages for loss of goodwill, work stoppage, computer failure or malfunction, or any and all other commercial damages or losses), even if such Contributor has been advised of the possibility of such damages.

9. Accepting Warranty or Additional Liability. While redistributing the Work or Derivative Works thereof, You may choose to offer, and charge a fee for, acceptance of support, warranty, indemnity, or other liability obligations and/or rights consistent with this License. However, in accepting such obligations, You may act only on Your own behalf and on Your sole responsibility, not on behalf of any other Contributor, and only if You agree to indemnify, defend, and hold each Contributor harmless for any liability incurred by, or claims asserted against, such Contributor by reason of your accepting any such warranty or additional liability.

END OF TERMS AND CONDITIONS
```

</details>

<details>
<summary>授權原文 18：typescript@6.0.3</summary>

- `typescript@6.0.3` — `package/ThirdPartyNoticeText.txt`

```text
/*!----------------- TypeScript ThirdPartyNotices -------------------------------------------------------

The TypeScript software incorporates third party material from the projects listed below. The original copyright notice and the license under which Microsoft received such third party material are set forth below. Microsoft reserves all other rights not expressly granted, whether by implication, estoppel or otherwise.

---------------------------------------------
Third Party Code Components
--------------------------------------------

------------------- DefinitelyTyped --------------------
This file is based on or incorporates material from the projects listed below (collectively "Third Party Code"). Microsoft is not the original author of the Third Party Code. The original copyright notice and the license, under which Microsoft received such Third Party Code, are set forth below. Such licenses and notices are provided for informational purposes only. Microsoft, not the third party, licenses the Third Party Code to you under the terms set forth in the EULA for the Microsoft Product. Microsoft reserves all other rights not expressly granted under this agreement, whether by implication, estoppel or otherwise.
DefinitelyTyped
This project is licensed under the MIT license. Copyrights are respective of each contributor listed at the beginning of each definition file. Provided for Informational Purposes Only

MIT License
Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the ""Software""), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
--------------------------------------------------------------------------------------

------------------- Unicode --------------------
UNICODE, INC. LICENSE AGREEMENT - DATA FILES AND SOFTWARE

Unicode Data Files include all data files under the directories
http://www.unicode.org/Public/, http://www.unicode.org/reports/,
http://www.unicode.org/cldr/data/, http://source.icu-project.org/repos/icu/, and
http://www.unicode.org/utility/trac/browser/.

Unicode Data Files do not include PDF online code charts under the
directory http://www.unicode.org/Public/.

Software includes any source code published in the Unicode Standard
or under the directories
http://www.unicode.org/Public/, http://www.unicode.org/reports/,
http://www.unicode.org/cldr/data/, http://source.icu-project.org/repos/icu/, and
http://www.unicode.org/utility/trac/browser/.

NOTICE TO USER: Carefully read the following legal agreement.
BY DOWNLOADING, INSTALLING, COPYING OR OTHERWISE USING UNICODE INC.'S
DATA FILES ("DATA FILES"), AND/OR SOFTWARE ("SOFTWARE"),
YOU UNEQUIVOCALLY ACCEPT, AND AGREE TO BE BOUND BY, ALL OF THE
TERMS AND CONDITIONS OF THIS AGREEMENT.
IF YOU DO NOT AGREE, DO NOT DOWNLOAD, INSTALL, COPY, DISTRIBUTE OR USE
THE DATA FILES OR SOFTWARE.

COPYRIGHT AND PERMISSION NOTICE

Copyright (c) 1991-2017 Unicode, Inc. All rights reserved.
Distributed under the Terms of Use in http://www.unicode.org/copyright.html.

Permission is hereby granted, free of charge, to any person obtaining
a copy of the Unicode data files and any associated documentation
(the "Data Files") or Unicode software and any associated documentation
(the "Software") to deal in the Data Files or Software
without restriction, including without limitation the rights to use,
copy, modify, merge, publish, distribute, and/or sell copies of
the Data Files or Software, and to permit persons to whom the Data Files
or Software are furnished to do so, provided that either
(a) this copyright and permission notice appear with all copies
of the Data Files or Software, or
(b) this copyright and permission notice appear in associated
Documentation.

THE DATA FILES AND SOFTWARE ARE PROVIDED "AS IS", WITHOUT WARRANTY OF
ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE
WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT OF THIRD PARTY RIGHTS.
IN NO EVENT SHALL THE COPYRIGHT HOLDER OR HOLDERS INCLUDED IN THIS
NOTICE BE LIABLE FOR ANY CLAIM, OR ANY SPECIAL INDIRECT OR CONSEQUENTIAL
DAMAGES, OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE,
DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER
TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THE DATA FILES OR SOFTWARE.

Except as contained in this notice, the name of a copyright holder
shall not be used in advertising or otherwise to promote the sale,
use or other dealings in these Data Files or Software without prior
written authorization of the copyright holder.
-------------------------------------------------------------------------------------

-------------------Document Object Model-----------------------------
DOM

W3C License
This work is being provided by the copyright holders under the following license.
By obtaining and/or copying this work, you (the licensee) agree that you have read, understood, and will comply with the following terms and conditions.
Permission to copy, modify, and distribute this work, with or without modification, for any purpose and without fee or royalty is hereby granted, provided that you include the following
on ALL copies of the work or portions thereof, including modifications:
* The full text of this NOTICE in a location viewable to users of the redistributed or derivative work.
* Any pre-existing intellectual property disclaimers, notices, or terms and conditions. If none exist, the W3C Software and Document Short Notice should be included.
* Notice of any changes or modifications, through a copyright statement on the new code or document such as "This software or document includes material copied from or derived
from [title and URI of the W3C document]. Copyright © [YEAR] W3C® (MIT, ERCIM, Keio, Beihang)."
Disclaimers
THIS WORK IS PROVIDED "AS IS," AND COPYRIGHT HOLDERS MAKE NO REPRESENTATIONS OR WARRANTIES, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO, WARRANTIES OF MERCHANTABILITY OR
FITNESS FOR ANY PARTICULAR PURPOSE OR THAT THE USE OF THE SOFTWARE OR DOCUMENT WILL NOT INFRINGE ANY THIRD PARTY PATENTS, COPYRIGHTS, TRADEMARKS OR OTHER RIGHTS.
COPYRIGHT HOLDERS WILL NOT BE LIABLE FOR ANY DIRECT, INDIRECT, SPECIAL OR CONSEQUENTIAL DAMAGES ARISING OUT OF ANY USE OF THE SOFTWARE OR DOCUMENT.
The name and trademarks of copyright holders may NOT be used in advertising or publicity pertaining to the work without specific, written prior permission.
Title to copyright in this work will at all times remain with copyright holders.

---------

DOM
Copyright © 2018 WHATWG (Apple, Google, Mozilla, Microsoft). This work is licensed under a Creative Commons Attribution 4.0 International License: Attribution 4.0 International
=======================================================================
Creative Commons Corporation ("Creative Commons") is not a law firm and does not provide legal services or legal advice. Distribution of Creative Commons public licenses does not create a lawyer-client or other relationship. Creative Commons makes its licenses and related information available on an "as-is" basis. Creative Commons gives no warranties regarding its licenses, any material licensed under their terms and conditions, or any related information. Creative Commons disclaims all liability for damages resulting from their use to the fullest extent possible. Using Creative Commons Public Licenses Creative Commons public licenses provide a standard set of terms and conditions that creators and other rights holders may use to share original works of authorship and other material subject to copyright and certain other rights specified in the public license below. The following considerations are for informational purposes only, are not exhaustive, and do not form part of our licenses. Considerations for licensors: Our public licenses are intended for use by those authorized to give the public permission to use material in ways otherwise restricted by copyright and certain other rights. Our licenses are irrevocable. Licensors should read and understand the terms and conditions of the license they choose before applying it. Licensors should also secure all rights necessary before applying our licenses so that the public can reuse the material as expected. Licensors should clearly mark any material not subject to the license. This includes other CC- licensed material, or material used under an exception or limitation to copyright. More considerations for licensors:

wiki.creativecommons.org/Considerations_for_licensors Considerations for the public: By using one of our public licenses, a licensor grants the public permission to use the licensed material under specified terms and conditions. If the licensor's permission is not necessary for any reason--for example, because of any applicable exception or limitation to copyright--then that use is not regulated by the license. Our licenses grant only permissions under copyright and certain other rights that a licensor has authority to grant. Use of the licensed material may still be restricted for other reasons, including because others have copyright or other rights in the material. A licensor may make special requests, such as asking that all changes be marked or described. Although not required by our licenses, you are encouraged to respect those requests where reasonable. More_considerations for the public: wiki.creativecommons.org/Considerations_for_licensees =======================================================================
Creative Commons Attribution 4.0 International Public License By exercising the Licensed Rights (defined below), You accept and agree to be bound by the terms and conditions of this Creative Commons Attribution 4.0 International Public License ("Public License"). To the extent this Public License may be interpreted as a contract, You are granted the Licensed Rights in consideration of Your acceptance of these terms and conditions, and the Licensor grants You such rights in consideration of benefits the Licensor receives from making the Licensed Material available under these terms and conditions. Section 1 -- Definitions. a. Adapted Material means material subject to Copyright and Similar Rights that is derived from or based upon the Licensed Material and in which the Licensed Material is translated, altered, arranged, transformed, or otherwise modified in a manner requiring permission under the Copyright and Similar Rights held by the Licensor. For purposes of this Public License, where the Licensed Material is a musical work, performance, or sound recording, Adapted Material is always produced where the Licensed Material is synched in timed relation with a moving image. b. Adapter's License means the license You apply to Your Copyright and Similar Rights in Your contributions to Adapted Material in accordance with the terms and conditions of this Public License. c. Copyright and Similar Rights means copyright and/or similar rights closely related to copyright including, without limitation, performance, broadcast, sound recording, and Sui Generis Database Rights, without regard to how the rights are labeled or categorized. For purposes of this Public License, the rights specified in Section 2(b)(1)-(2) are not Copyright and Similar Rights. d. Effective Technological Measures means those measures that, in the absence of proper authority, may not be circumvented under laws fulfilling obligations under Article 11 of the WIPO Copyright Treaty adopted on December 20, 1996, and/or similar international agreements. e. Exceptions and Limitations means fair use, fair dealing, and/or any other exception or limitation to Copyright and Similar Rights that applies to Your use of the Licensed Material. f. Licensed Material means the artistic or literary work, database, or other material to which the Licensor applied this Public License. g. Licensed Rights means the rights granted to You subject to the terms and conditions of this Public License, which are limited to all Copyright and Similar Rights that apply to Your use of the Licensed Material and that the Licensor has authority to license. h. Licensor means the individual(s) or entity(ies) granting rights under this Public License. i. Share means to provide material to the public by any means or process that requires permission under the Licensed Rights, such as reproduction, public display, public performance, distribution, dissemination, communication, or importation, and to make material available to the public including in ways that members of the public may access the material from a place and at a time individually chosen by them. j. Sui Generis Database Rights means rights other than copyright resulting from Directive 96/9/EC of the European Parliament and of the Council of 11 March 1996 on the legal protection of databases, as amended and/or succeeded, as well as other essentially equivalent rights anywhere in the world. k. You means the individual or entity exercising the Licensed Rights under this Public License. Your has a corresponding meaning. Section 2 -- Scope. a. License grant. 1. Subject to the terms and conditions of this Public License, the Licensor hereby grants You a worldwide, royalty-free, non-sublicensable, non-exclusive, irrevocable license to exercise the Licensed Rights in the Licensed Material to: a. reproduce and Share the Licensed Material, in whole or in part; and b. produce, reproduce, and Share Adapted Material. 2. Exceptions and Limitations. For the avoidance of doubt, where Exceptions and Limitations apply to Your use, this Public License does not apply, and You do not need to comply with its terms and conditions. 3. Term. The term of this Public License is specified in Section 6(a). 4. Media and formats; technical modifications allowed. The Licensor authorizes You to exercise the Licensed Rights in all media and formats whether now known or hereafter created, and to make technical modifications necessary to do so. The Licensor waives and/or agrees not to assert any right or authority to forbid You from making technical modifications necessary to exercise the Licensed Rights, including technical modifications necessary to circumvent Effective Technological Measures. For purposes of this Public License, simply making modifications authorized by this Section 2(a) (4) never produces Adapted Material. 5. Downstream recipients. a. Offer from the Licensor -- Licensed Material. Every recipient of the Licensed Material automatically receives an offer from the Licensor to exercise the Licensed Rights under the terms and conditions of this Public License. b. No downstream restrictions. You may not offer or impose any additional or different terms or conditions on, or apply any Effective Technological Measures to, the Licensed Material if doing so restricts exercise of the Licensed Rights by any recipient of the Licensed Material. 6. No endorsement. Nothing in this Public License constitutes or may be construed as permission to assert or imply that You are, or that Your use of the Licensed Material is, connected with, or sponsored, endorsed, or granted official status by, the Licensor or others designated to receive attribution as provided in Section 3(a)(1)(A)(i). b. Other rights. 1. Moral rights, such as the right of integrity, are not licensed under this Public License, nor are publicity, privacy, and/or other similar personality rights; however, to the extent possible, the Licensor waives and/or agrees not to assert any such rights held by the Licensor to the limited extent necessary to allow You to exercise the Licensed Rights, but not otherwise. 2. Patent and trademark rights are not licensed under this Public License. 3. To the extent possible, the Licensor waives any right to collect royalties from You for the exercise of the Licensed Rights, whether directly or through a collecting society under any voluntary or waivable statutory or compulsory licensing scheme. In all other cases the Licensor expressly reserves any right to collect such royalties. Section 3 -- License Conditions. Your exercise of the Licensed Rights is expressly made subject to the following conditions. a. Attribution. 1. If You Share the Licensed Material (including in modified form), You must: a. retain the following if it is supplied by the Licensor with the Licensed Material: i. identification of the creator(s) of the Licensed Material and any others designated to receive attribution, in any reasonable manner requested by the Licensor (including by pseudonym if designated); ii. a copyright notice; iii. a notice that refers to this Public License; iv. a notice that refers to the disclaimer of warranties; v. a URI or hyperlink to the Licensed Material to the extent reasonably practicable; b. indicate if You modified the Licensed Material and retain an indication of any previous modifications; and c. indicate the Licensed Material is licensed under this Public License, and include the text of, or the URI or hyperlink to, this Public License. 2. You may satisfy the conditions in Section 3(a)(1) in any reasonable manner based on the medium, means, and context in which You Share the Licensed Material. For example, it may be reasonable to satisfy the conditions by providing a URI or hyperlink to a resource that includes the required information. 3. If requested by the Licensor, You must remove any of the information required by Section 3(a)(1)(A) to the extent reasonably practicable. 4. If You Share Adapted Material You produce, the Adapter's License You apply must not prevent recipients of the Adapted Material from complying with this Public License. Section 4 -- Sui Generis Database Rights. Where the Licensed Rights include Sui Generis Database Rights that apply to Your use of the Licensed Material: a. for the avoidance of doubt, Section 2(a)(1) grants You the right to extract, reuse, reproduce, and Share all or a substantial portion of the contents of the database; b. if You include all or a substantial portion of the database contents in a database in which You have Sui Generis Database Rights, then the database in which You have Sui Generis Database Rights (but not its individual contents) is Adapted Material; and c. You must comply with the conditions in Section 3(a) if You Share all or a substantial portion of the contents of the database. For the avoidance of doubt, this Section 4 supplements and does not replace Your obligations under this Public License where the Licensed Rights include other Copyright and Similar Rights. Section 5 -- Disclaimer of Warranties and Limitation of Liability. a. UNLESS OTHERWISE SEPARATELY UNDERTAKEN BY THE LICENSOR, TO THE EXTENT POSSIBLE, THE LICENSOR OFFERS THE LICENSED MATERIAL AS-IS AND AS-AVAILABLE, AND MAKES NO REPRESENTATIONS OR WARRANTIES OF ANY KIND CONCERNING THE LICENSED MATERIAL, WHETHER EXPRESS, IMPLIED, STATUTORY, OR OTHER. THIS INCLUDES, WITHOUT LIMITATION, WARRANTIES OF TITLE, MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, NON-INFRINGEMENT, ABSENCE OF LATENT OR OTHER DEFECTS, ACCURACY, OR THE PRESENCE OR ABSENCE OF ERRORS, WHETHER OR NOT KNOWN OR DISCOVERABLE. WHERE DISCLAIMERS OF WARRANTIES ARE NOT ALLOWED IN FULL OR IN PART, THIS DISCLAIMER MAY NOT APPLY TO YOU. b. TO THE EXTENT POSSIBLE, IN NO EVENT WILL THE LICENSOR BE LIABLE TO YOU ON ANY LEGAL THEORY (INCLUDING, WITHOUT LIMITATION, NEGLIGENCE) OR OTHERWISE FOR ANY DIRECT, SPECIAL, INDIRECT, INCIDENTAL, CONSEQUENTIAL, PUNITIVE, EXEMPLARY, OR OTHER LOSSES, COSTS, EXPENSES, OR DAMAGES ARISING OUT OF THIS PUBLIC LICENSE OR USE OF THE LICENSED MATERIAL, EVEN IF THE LICENSOR HAS BEEN ADVISED OF THE POSSIBILITY OF SUCH LOSSES, COSTS, EXPENSES, OR DAMAGES. WHERE A LIMITATION OF LIABILITY IS NOT ALLOWED IN FULL OR IN PART, THIS LIMITATION MAY NOT APPLY TO YOU. c. The disclaimer of warranties and limitation of liability provided above shall be interpreted in a manner that, to the extent possible, most closely approximates an absolute disclaimer and waiver of all liability. Section 6 -- Term and Termination. a. This Public License applies for the term of the Copyright and Similar Rights licensed here. However, if You fail to comply with this Public License, then Your rights under this Public License terminate automatically. b. Where Your right to use the Licensed Material has terminated under Section 6(a), it reinstates: 1. automatically as of the date the violation is cured, provided it is cured within 30 days of Your discovery of the violation; or 2. upon express reinstatement by the Licensor. For the avoidance of doubt, this Section 6(b) does not affect any right the Licensor may have to seek remedies for Your violations of this Public License. c. For the avoidance of doubt, the Licensor may also offer the Licensed Material under separate terms or conditions or stop distributing the Licensed Material at any time; however, doing so will not terminate this Public License. d. Sections 1, 5, 6, 7, and 8 survive termination of this Public License. Section 7 -- Other Terms and Conditions. a. The Licensor shall not be bound by any additional or different terms or conditions communicated by You unless expressly agreed. b. Any arrangements, understandings, or agreements regarding the Licensed Material not stated herein are separate from and independent of the terms and conditions of this Public License. Section 8 -- Interpretation. a. For the avoidance of doubt, this Public License does not, and shall not be interpreted to, reduce, limit, restrict, or impose conditions on any use of the Licensed Material that could lawfully be made without permission under this Public License. b. To the extent possible, if any provision of this Public License is deemed unenforceable, it shall be automatically reformed to the minimum extent necessary to make it enforceable. If the provision cannot be reformed, it shall be severed from this Public License without affecting the enforceability of the remaining terms and conditions. c. No term or condition of this Public License will be waived and no failure to comply consented to unless expressly agreed to by the Licensor. d. Nothing in this Public License constitutes or may be interpreted as a limitation upon, or waiver of, any privileges and immunities that apply to the Licensor or You, including from the legal processes of any jurisdiction or authority. ======================================================================= Creative Commons is not a party to its public licenses. Notwithstanding, Creative Commons may elect to apply one of its public licenses to material it publishes and in those instances will be considered the "Licensor." Except for the limited purpose of indicating that material is shared under a Creative Commons public license or as otherwise permitted by the Creative Commons policies published at creativecommons.org/policies, Creative Commons does not authorize the use of the trademark "Creative Commons" or any other trademark or logo of Creative Commons without its prior written consent including, without limitation, in connection with any unauthorized modifications to any of its public licenses or any other arrangements, understandings, or agreements concerning use of licensed material. For the avoidance of doubt, this paragraph does not form part of the public licenses. Creative Commons may be contacted at creativecommons.org.

--------------------------------------------------------------------------------

----------------------Web Background Synchronization------------------------------

Web Background Synchronization Specification
Portions of spec © by W3C

W3C Community Final Specification Agreement
To secure commitments from participants for the full text of a Community or Business Group Report, the group may call for voluntary commitments to the following terms; a "summary" is
available. See also the related "W3C Community Contributor License Agreement".
1. The Purpose of this Agreement.
This Agreement sets forth the terms under which I make certain copyright and patent rights available to you for your implementation of the Specification.
Any other capitalized terms not specifically defined herein have the same meaning as those terms have in the "W3C Patent Policy", and if not defined there, in the "W3C Process Document".
2. Copyrights.
2.1. Copyright Grant. I grant to you a perpetual (for the duration of the applicable copyright), worldwide, non-exclusive, no-charge, royalty-free, copyright license, without any obligation for accounting to me, to reproduce, prepare derivative works of, publicly display, publicly perform, sublicense, distribute, and implement the Specification to the full extent of my copyright interest in the Specification.
2.2. Attribution. As a condition of the copyright grant, you must include an attribution to the Specification in any derivative work you make based on the Specification. That attribution must include, at minimum, the Specification name and version number.
3. Patents.
3.1. Patent Licensing Commitment. I agree to license my Essential Claims under the W3C Community RF Licensing Requirements. This requirement includes Essential Claims that I own and any that I have the right to license without obligation of payment or other consideration to an unrelated third party. W3C Community RF Licensing Requirements obligations made concerning the Specification and described in this policy are binding on me for the life of the patents in question and encumber the patents containing Essential Claims, regardless of changes in participation status or W3C Membership. I also agree to license my Essential Claims under the W3C Community RF Licensing Requirements in derivative works of the Specification so long as all normative portions of the Specification are maintained and that this licensing commitment does not extend to any portion of the derivative work that was not included in the Specification.
3.2. Optional, Additional Patent Grant. In addition to the provisions of Section 3.1, I may also, at my option, make certain intellectual property rights infringed by implementations of the Specification, including Essential Claims, available by providing those terms via the W3C Web site.
4. No Other Rights. Except as specifically set forth in this Agreement, no other express or implied patent, trademark, copyright, or other property rights are granted under this Agreement, including by implication, waiver, or estoppel.
5. Antitrust Compliance. I acknowledge that I may compete with other participants, that I am under no obligation to implement the Specification, that each participant is free to develop competing technologies and standards, and that each party is free to license its patent rights to third parties, including for the purpose of enabling competing technologies and standards.
6. Non-Circumvention. I agree that I will not intentionally take or willfully assist any third party to take any action for the purpose of circumventing my obligations under this Agreement.
7. Transition to W3C Recommendation Track. The Specification developed by the Project may transition to the W3C Recommendation Track. The W3C Team is responsible for notifying me that a Corresponding Working Group has been chartered. I have no obligation to join the Corresponding Working Group. If the Specification developed by the Project transitions to the W3C Recommendation Track, the following terms apply:
7.1. If I join the Corresponding Working Group. If I join the Corresponding Working Group, I will be subject to all W3C rules, obligations, licensing commitments, and policies that govern that Corresponding Working Group.
7.2. If I Do Not Join the Corresponding Working Group.
7.2.1. Licensing Obligations to Resulting Specification. If I do not join the Corresponding Working Group, I agree to offer patent licenses according to the W3C Royalty-Free licensing requirements described in Section 5 of the W3C Patent Policy for the portions of the Specification included in the resulting Recommendation. This licensing commitment does not extend to any portion of an implementation of the Recommendation that was not included in the Specification. This licensing commitment may not be revoked but may be modified through the exclusion process defined in Section 4 of the W3C Patent Policy. I am not required to join the Corresponding Working Group to exclude patents from the W3C Royalty-Free licensing commitment, but must otherwise follow the normal exclusion procedures defined by the W3C Patent Policy. The W3C Team will notify me of any Call for Exclusion in the Corresponding Working Group as set forth in Section 4.5 of the W3C Patent Policy.
7.2.2. No Disclosure Obligation. If I do not join the Corresponding Working Group, I have no patent disclosure obligations outside of those set forth in Section 6 of the W3C Patent Policy.
8. Conflict of Interest. I will disclose significant relationships when those relationships might reasonably be perceived as creating a conflict of interest with my role. I will notify W3C of any change in my affiliation using W3C-provided mechanisms.
9. Representations, Warranties and Disclaimers. I represent and warrant that I am legally entitled to grant the rights and promises set forth in this Agreement. IN ALL OTHER RESPECTS THE SPECIFICATION IS PROVIDED “AS IS.” The entire risk as to implementing or otherwise using the Specification is assumed by the implementer and user. Except as stated herein, I expressly disclaim any warranties (express, implied, or otherwise), including implied warranties of merchantability, non-infringement, fitness for a particular purpose, or title, related to the Specification. IN NO EVENT WILL ANY PARTY BE LIABLE TO ANY OTHER PARTY FOR LOST PROFITS OR ANY FORM OF INDIRECT, SPECIAL, INCIDENTAL, OR CONSEQUENTIAL DAMAGES OF ANY CHARACTER FROM ANY CAUSES OF ACTION OF ANY KIND WITH RESPECT TO THIS AGREEMENT, WHETHER BASED ON BREACH OF CONTRACT, TORT (INCLUDING NEGLIGENCE), OR OTHERWISE, AND WHETHER OR NOT THE OTHER PARTY HAS BEEN ADVISED OF THE POSSIBILITY OF SUCH DAMAGE. All of my obligations under Section 3 regarding the transfer, successors in interest, or assignment of Granted Claims will be satisfied if I notify the transferee or assignee of any patent that I know contains Granted Claims of the obligations under Section 3. Nothing in this Agreement requires me to undertake a patent search.
10. Definitions.
10.1. Agreement. “Agreement” means this W3C Community Final Specification Agreement.
10.2. Corresponding Working Group. “Corresponding Working Group” is a W3C Working Group that is chartered to develop a Recommendation, as defined in the W3C Process Document, that takes the Specification as an input.
10.3. Essential Claims. “Essential Claims” shall mean all claims in any patent or patent application in any jurisdiction in the world that would necessarily be infringed by implementation of the Specification. A claim is necessarily infringed hereunder only when it is not possible to avoid infringing it because there is no non-infringing alternative for implementing the normative portions of the Specification. Existence of a non-infringing alternative shall be judged based on the state of the art at the time of the publication of the Specification. The following are expressly excluded from and shall not be deemed to constitute Essential Claims:
10.3.1. any claims other than as set forth above even if contained in the same patent as Essential Claims; and
10.3.2. claims which would be infringed only by:
portions of an implementation that are not specified in the normative portions of the Specification, or
enabling technologies that may be necessary to make or use any product or portion thereof that complies with the Specification and are not themselves expressly set forth in the Specification (e.g., semiconductor manufacturing technology, compiler technology, object-oriented technology, basic operating system technology, and the like); or
the implementation of technology developed elsewhere and merely incorporated by reference in the body of the Specification.
10.3.3. design patents and design registrations.
For purposes of this definition, the normative portions of the Specification shall be deemed to include only architectural and interoperability requirements. Optional features in the RFC 2119 sense are considered normative unless they are specifically identified as informative. Implementation examples or any other material that merely illustrate the requirements of the Specification are informative, rather than normative.
10.4. I, Me, or My. “I,” “me,” or “my” refers to the signatory.
10.5 Project. “Project” means the W3C Community Group or Business Group for which I executed this Agreement.
10.6. Specification. “Specification” means the Specification identified by the Project as the target of this agreement in a call for Final Specification Commitments. W3C shall provide the authoritative mechanisms for the identification of this Specification.
10.7. W3C Community RF Licensing Requirements. “W3C Community RF Licensing Requirements” license shall mean a non-assignable, non-sublicensable license to make, have made, use, sell, have sold, offer to sell, import, and distribute and dispose of implementations of the Specification that:
10.7.1. shall be available to all, worldwide, whether or not they are W3C Members;
10.7.2. shall extend to all Essential Claims owned or controlled by me;
10.7.3. may be limited to implementations of the Specification, and to what is required by the Specification;
10.7.4. may be conditioned on a grant of a reciprocal RF license (as defined in this policy) to all Essential Claims owned or controlled by the licensee. A reciprocal license may be required to be available to all, and a reciprocal license may itself be conditioned on a further reciprocal license from all.
10.7.5. may not be conditioned on payment of royalties, fees or other consideration;
10.7.6. may be suspended with respect to any licensee when licensor issued by licensee for infringement of claims essential to implement the Specification or any W3C Recommendation;
10.7.7. may not impose any further conditions or restrictions on the use of any technology, intellectual property rights, or other restrictions on behavior of the licensee, but may include reasonable, customary terms relating to operation or maintenance of the license relationship such as the following: choice of law and dispute resolution;
10.7.8. shall not be considered accepted by an implementer who manifests an intent not to accept the terms of the W3C Community RF Licensing Requirements license as offered by the licensor.
10.7.9. The RF license conforming to the requirements in this policy shall be made available by the licensor as long as the Specification is in effect. The term of such license shall be for the life of the patents in question.
I am encouraged to provide a contact from which licensing information can be obtained and other relevant licensing information. Any such information will be made publicly available.
10.8. You or Your. “You,” “you,” or “your” means any person or entity who exercises copyright or patent rights granted under this Agreement, and any person that person or entity controls.

-------------------------------------------------------------------------------------

------------------- WebGL -----------------------------
Copyright (c) 2018 The Khronos Group Inc.

Permission is hereby granted, free of charge, to any person obtaining a
copy of this software and/or associated documentation files (the
"Materials"), to deal in the Materials without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Materials, and to
permit persons to whom the Materials are furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be included
in all copies or substantial portions of the Materials.

THE MATERIALS ARE PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
MATERIALS OR THE USE OR OTHER DEALINGS IN THE MATERIALS.
------------------------------------------------------

------------- End of ThirdPartyNotices ------------------------------------------- */
```

</details>

<details>
<summary>授權原文 19：undici@7.29.0</summary>

- `undici@7.29.0` — `package/lib/web/fetch/LICENSE`

```text
MIT License

Copyright (c) 2020 Ethan Arrowood

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

</details>

<details>
<summary>授權原文 20：undici@7.29.0 等 2 項</summary>

- `undici@7.29.0` — `package/LICENSE`
- `undici-types@8.3.0` — `package/LICENSE`

```text
MIT License

Copyright (c) Matteo Collina and Undici contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

</details>

<details>
<summary>授權原文 21：whatwg-encoding@3.1.1 等 2 項</summary>

- `whatwg-encoding@3.1.1` — `package/LICENSE.txt`
- `whatwg-mimetype@4.0.0` — `package/LICENSE.txt`

```text
Copyright © Domenic Denicola <d@domenic.me>

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

</details>

<details>
<summary>授權原文 22：zod@3.25.76</summary>

- `zod@3.25.76` — `package/LICENSE`

```text
MIT License

Copyright (c) 2025 Colin McDonnell

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

</details>

<details>
<summary>授權原文 23：base64-js@1.5.1</summary>

- `base64-js@1.5.1` — `package/LICENSE`

```text
The MIT License (MIT)

Copyright (c) 2014 Jameson Little

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

</details>

<details>
<summary>授權原文 24：js-tiktoken@1.0.21</summary>

- `js-tiktoken@1.0.21` — 封存檔未附 LICENSE；引用 `upstream dqbd/tiktoken LICENSE`（2026-09-06 取得）

```text
MIT License

Copyright (c) 2022 OpenAI, Shantanu Jain

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

</details>
