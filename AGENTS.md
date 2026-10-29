# 給協作者與代理

改 Hermes Overlay 之前先讀根目錄的 [REQUIREMENTS.md](REQUIREMENTS.md) 同 [SPEC.md](SPEC.md)。REQUIREMENTS.md 係驗收依據。同 SPEC.md 衝突時以 REQUIREMENTS.md 為準。SPEC.md 係實作細節。

每一項改動完成前，逐條核對受影響的條文：行為要符合規格，測試要能對上條號。與 README、註解或較早的說明衝突、而且 REQUIREMENTS.md 冇覆蓋時，以 SPEC.md 為準。

每一次改動都要重核 REQUIREMENTS.md §1–§11。commit message 或報告必須列出今次修咗同重新驗過嘅項目 ID。

未獲明確要求，不要建立 git tag 或 GitHub Release。
