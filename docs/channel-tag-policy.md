# Channel tag policy / 頻道標籤政策

- Policy version / 政策版本: **2026-09-05**
- Source / 資料來源: [analysis.tw `channels_list` API](https://urtubeapi.analysis.tw/api/channels_list.php)
- Report an error / 回報錯誤: [open a GitHub Issue](https://github.com/skyhong2002/urtube.observe.tw/issues/new)

## What the labels mean / 標籤代表什麼

These labels describe the source curator's classification of a **channel's
content**. They do not classify the viewer's identity, beliefs, party
membership, or voting behavior.

這些標籤描述資料來源維護者對**頻道內容**的分類，不代表觀看者本人的
身分、信念、政黨支持或投票行為。

The page shows estimated watch-time distribution among labeled channels and
the share of all watch time covered by any label. Unlabeled channels remain in
the coverage denominator. A label may be incomplete, outdated, or disputed.

頁面顯示被標記頻道之間的估計觀看時間分布，以及所有觀看時間中有多少
落在任何標籤清單。未標記頻道仍計入 coverage 分母。標籤可能不完整、
過時或具有爭議。

## Group definitions / 分組定義

The query strings are the complete executable definitions used by urtube.
Commas mean intersection; `not` excludes any channel carrying one of the
listed upstream tags.

| Key | UI label | Definition | API query |
|---|---|---|---|
| `news` | News / 新聞 | Channels carrying upstream news tag 13. | `tagid=13` |
| `editorial` | Personal commentary / 個人社論 | Channels carrying tag 1, excluding upstream show, news, simplified-Chinese, and other non-personal categories selected by the source curator. The exact excluded tag ids are part of the policy. | `tagid=1&not=2,9,10,12,13,33,36,81` |
| `editorialShows` | Commentary shows / 社論節目 | Channels carrying both upstream tags 1 and 9. | `tagid=1,9` |
| `blue` | Pan-Blue / 泛藍 | Channels carrying upstream political tag 3. | `tagid=3` |
| `green` | Pan-Green / 泛綠 | Channels carrying upstream political tag 4. | `tagid=4` |
| `white` | Pan-White / 泛白 | Channels carrying upstream political tag 6. | `tagid=6` |
| `red` | Pan-Red / 泛紅 | Channels carrying upstream political tag 5. | `tagid=5` |

urtube does not infer these groups from a user's videos and does not silently
reassign channels. Each group is fetched independently from the source.

urtube 不會從使用者的影片自行推論這些分組，也不會暗中重分頻道；每個
分組都直接、獨立地向資料來源取得。

## Provenance and versions / 來源與版本

Every displayed result carries:

- the policy version above;
- the latest source `time` returned by all seven API responses;
- the server fetch time; and
- a data version formatted as `sha256:<12 hex characters>`, derived from
  sorted `group-key:channel-id` membership.

Sorting makes the version independent of API row order. A membership change
changes the version. The upstream API does not publish a semantic dataset
version, so urtube does not invent one.

If any request fails, `result` is not an array, or `time` is missing or
malformed, the whole classification is unavailable. A verified snapshot may
be reused for up to six hours; after that, a refresh failure hides the result
instead of presenting the expired snapshot as current.

每次顯示都附政策版本、七個 API 回應中最新的來源時間、本站抓取時間，
以及依排序後 `group-key:channel-id` 內容計算的 SHA-256 短版資料版本。
任一請求失敗或缺少可驗證時間時，整個分類停止顯示；已驗證快照最多重用
六小時，逾期後不以舊資料冒充最新結果。

## Review and change process / 審查與變更流程

1. Open an Issue naming the affected key/query, evidence, expected meaning,
   privacy impact, and rollback.
2. A human reviews semantic changes. Do not reinterpret an existing key in
   place when consumers need historical comparison; introduce a new policy
   version.
3. Change the query/constants, this document, the policy version, the
   changelog, and a synthetic regression fixture in one reviewed commit.
4. Compare the old and new membership hashes before release. Never include a
   user's watch history, private title list, or search terms in the review.

Upstream membership additions/removals are observable as a new membership
hash and source time. Changes to the meaning or query of a tag require the
source-controlled policy review above.

## Matching boundary / 配對邊界

Political and content-type channel labels are personal-insight-only. They are
never written to registry matching crystals and never enter candidate scores,
candidate cards, recommendations, or icebreakers. Matching uses only the
separate canonical taxonomy and explicit user choices defined in
`src/youtube/matching.ts` and `src/youtube/dimensions.ts`.

政治及內容類型頻道標籤只供本人洞察使用，不會寫入共用 matching crystal，
也不會進入候選分數、候選卡、推薦或破冰提示。

## Changelog / 變更紀錄

| Policy version | Change |
|---|---|
| 2026-09-05 | Defined all seven executable groups; separated channel labels from viewer identity; added source time, membership hash, fail-closed refresh, review/report paths, and the matching exclusion. |
