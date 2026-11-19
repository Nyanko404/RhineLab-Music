# 官網 Novecento 字體部署

2026-09-11：之前的字體提交僅在 Wallpaper Engine 分支，且授權字體文件不進入 Git，因此正式網頁仍是原版。將開場字體相關提交獨立集成到 main，保留網頁原有功能。

- 本機通過 MyFonts 正式 Webfont kit 構建，三份 WOFF2 共 119,732 字節；文件哈希見 `boot-lettering/webfont-sources.json`。
- 首次使用 `npm run build`、`node scripts/package-vercel.mjs` 和 Vercel `deploy --prebuilt --prod` 部署靜態輸出，不讀取生產環境變量。
- 后續僅本項目 Vercel 構建從當前正式域名恢復同一份字體及原 CSS，逐文件驗證 SHA-256。恢復失敗中止構建，保留原部署；其他項目沒有本地字體時沿用固定文字圖形。
- 正式域名 `https://rhine.lubeiluchen.cc/` 的 PWA 版本為 `0aa8a1c41186b335`。從空目錄執行恢復腳本，成功下載并驗證全部四個資源，線上 PWA 清單包含三份字體。
- 本地正式構建通過；原生瀏覽器字體回歸 15 項通過，三種字重用于開場的 27 個字形分別與源文件一致。線上完成資源及版本校驗，未將這些 HTTP 檢查稱作線上視覺驗收。

已安裝舊 PWA 的用戶可從設置更新并重啟，或打開 `/update.html` 恢復入口。授權原文件與訂單不提交到公共倉庫；官網 Webfont 授權不等同于 Wallpaper Engine 內容包分發許可。
