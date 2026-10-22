# 參與貢獻

## 開始之前

- 從全新 clone 的合成資料環境開始，見 [本機開發指南](docs/LOCAL_DEVELOPMENT.md) 的環境 A。
  不要連接或複製正式資料。
- 測試與示範只使用合成資料；不得把真實觀看紀錄、token 或金鑰放進 fixtures、issue 或 PR。
- 安全問題請依 [SECURITY.md](SECURITY.md) 私下通報，不要開公開 issue。

## 修改流程

1. 需要 Node.js 22，執行 `npm ci`。
2. 修改程式時一併補上測試。修 bug 時，先寫出能重現問題的測試，確認它會失敗再修正。
3. 送出前執行：

   ```sh
   npm run check            # 型別檢查與全部測試
   npm run security:audit   # 機密掃描與正式依賴稽核
   ```

   改到數值服務（`services/matching-compute/`）時，另外執行
   `python3 -m unittest discover -s services/matching-compute -p 'test_*.py'`。
4. 沿用周遭程式碼的命名、註解密度與寫法。commit 訊息說明「為什麼」，而不只是「改了什麼」。

## 後端行為與產品決策

`AGENTS.md` 記錄已確認的產品決策，例如配對演算法、API 預算與快取保存規則。
要變更後端行為（API 契約、授權、schema、匯入、worker、配對或統計演算法），
請先在 issue 中說明理由與方案，取得同意後再實作。

## 授權

貢獻內容以本專案的 [MIT License](LICENSE) 授權。新增第三方套件、資料或素材時，
請一併更新 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
