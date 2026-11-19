# 詳情與彈窗過渡驗證

2026-09-09 在真實 Vite 應用中驗證。分支 `codex/boot-motion-polish` 已通過合并提交 `09162a0` 進入 `main`，同時保留工作區內的音頻和畫質改動。

## 本次覆蓋

- `reference/ui-transition-check.html`：20 項通過。覆蓋彈窗退出保留節點和輸入隔離、重復 Esc、開場中斷時的透明度連續性、檢索結果的關閉后導航、正文可讀后焦點、收藏保留 DOM 與滾動位置、快速頁簽切換、詳情退出反向接續、鏡頭遮罩歸位，以及減少動態效果。
- `reference/viewer-motion-check.html`：合并后的 14 項全部通過，包括幀率一致性、復位短路徑與中斷、鍵盤與滾輪平滑跟隨、邊界以及再次進入。
- `reference/micro-transition-review.html`：原有標題快切與查看器進出 13 項全部通過。
- `node scripts/check-motion.mjs` 與 `node scripts/check-loop.mjs`：通過。基線正負波谷、抽取運動和 20,000 次循環導航繼續滿足原有檢查。
- `npm run build`：通過 TypeScript 與生產打包。仍存在原有的大體積 JavaScript chunk 提示。

詳情穩定畫面經瀏覽器截圖檢查，頁簽下劃線、正文、收藏按鈕與既有構圖一致。功能與數值連續性檢查不等同于原片逐像素認證。

新增檢查頁只在本地開發入口使用，自動恢復開始前的收藏與設置存儲。參考頁面不包含在產品構建入口中。
