# Contributing to urtube

這個專案使用 **Issue → branch → Pull Request → review → merge** 的方式協作。請不要直接把功能或修正推到 `main`。

## 1. 先開 Issue

1. 先搜尋是否已有相同或相關的 Issue。
2. 依工作類型選擇 Task、Bug 或 Feature 模板。
3. 寫清楚目標、範圍與可逐項確認的驗收條件。
4. 指派負責人；若變更較大，先在 Issue 內對齊做法再開發。

一個 Pull Request 原則上只處理一個 Issue。若工作太大，先拆成數個可獨立驗收的 Issue。

## 2. 從最新的 `main` 建立分支

```sh
git switch main
git pull --ff-only origin main
git switch -c feature/123-short-description
```

分支名稱使用 `<type>/<issue-number>-<short-description>`：

- `feature/123-google-import`
- `fix/124-empty-history`
- `docs/125-deployment-guide`
- `chore/126-update-dependencies`

開發期間若 `main` 有更新，先拉回本機再整合到自己的分支：

```sh
git fetch origin
git rebase origin/main
```

若分支已由多人共用，請先和協作者確認再 rebase，避免改寫對方正在使用的歷史。

## 3. 開發與驗證

保持每個 commit 聚焦且可讀。提交前執行：

```sh
npm ci
npm run check
```

涉及部署或容器設定時，也要確認 production image 能建置：

```sh
docker build -t urtube:local .
```

不要提交 `.env`、token、私密 dashboard URL、cookie、使用者資料庫或個人觀看紀錄。

## 4. 開 Pull Request

```sh
git push -u origin feature/123-short-description
```

接著在 GitHub 開 Pull Request，並：

- 在說明中填入 `Closes #123`，讓合併後自動關閉 Issue。
- 說明變更內容、驗證方式與已知風險。
- 未完成時先開 Draft Pull Request，準備好再標記為 Ready for review。
- 確認 CI 的 **Check** workflow 通過。

## 5. Review 與合併

- 至少由一位不是作者的隊友 review。
- Review 意見處理完成後再合併。
- 建議使用 **Squash and merge**，讓 `main` 的歷史保持清楚。
- 合併後刪除遠端分支，並在本機同步最新的 `main`。

```sh
git switch main
git pull --ff-only origin main
git branch -d feature/123-short-description
```

## Repository owner 設定

為了真正阻止直接推送，repo 擁有者應在 GitHub 的 `Settings → Branches` 或 `Settings → Rules → Rulesets` 為 `main` 設定：

- Require a pull request before merging
- Require at least 1 approval
- Dismiss stale approvals when new commits are pushed
- Require status checks to pass：`Check`
- Block force pushes and deletions
- Automatically delete head branches（建議）

