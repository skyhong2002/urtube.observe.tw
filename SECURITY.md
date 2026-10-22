# 安全政策

## 通報漏洞

請**不要**在公開 issue 或 pull request 中描述漏洞。請寄信至 **me@skyhong.tw**，
主旨註明「urtube security」，內容包含：

- 受影響的網址、API 或擴充功能版本；
- 重現步驟，請使用自己的帳號或合成資料，不要存取他人資料；
- 你判斷的影響範圍。

我們會在 7 天內回覆確認，並在修正部署後告知。修正前請勿公開細節。

## 範圍

範圍包括 urtube.observe.tw 網站、匯入 API、Chrome 擴充功能，以及本 repository 中的程式碼。
請勿對正式站進行阻斷服務、大量自動化掃描、社交工程，或任何讀取、修改他人資料的測試。

## 發布物的依賴與更新

- Node 依賴由 `package-lock.json` 鎖定；CI 以 `npm run security:audit` 掃描追蹤檔案中的
  機密，並對正式依賴執行 `npm audit --audit-level=high`。未通過就不發布映像。
- 數值服務的 Python 依賴（含間接依賴）在 `services/matching-compute/requirements.txt`
  中以 hash 鎖定，映像以 `pip install --require-hashes` 安裝；直接依賴列在 `requirements.in`。
- 兩個映像的 base image 以 digest 固定（`Dockerfile`、`services/matching-compute/Dockerfile`）。

更新流程：

1. 取得新 digest：`docker pull node:22-alpine && docker inspect --format '{{index .RepoDigests 0}}' node:22-alpine`，
   Python base image 同理。
2. 調整 `requirements.in` 後，依 `requirements.txt` 開頭的指令重新產生鎖定檔。
3. 執行 `npm run check` 與數值服務測試，再 push 到 `main`，由 CI 驗證並發布。

發布映像隨附 `LICENSE` 與 `THIRD_PARTY_NOTICES.md`，並附上 build provenance 與 SBOM attestation。
