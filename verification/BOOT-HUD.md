# 開場 HUD

2026-09-11：按用戶要求，既有 HUD 開關覆蓋開場 UI。

- 接入 ACCESS、Logo、驗證文字、掃描圓環與歡迎畫面；品牌及 Powered 共用既有投影。
- 先更新 BootSequence 當幀原始動作，再讀取本幀布局并計算投影，避免緩存舊的 Logo 位移或歡迎縮放。僅開場逐幀測量相關七塊內容，交互階段保留原來的按需測量。
- 階段切換不再將 HUD 深度歸零。關閉追蹤保留曲面，減少動態效果停止追蹤，關閉 HUD 恢復原始 DOM 變換。三維鏡頭繼續不響應被動指針。
- 磨砂底沿用僅交互階段啟用的范圍，全局屏幕效果繼續覆蓋開場。

驗證：`npm run build:wallpaper`、`node scripts/check-visual-effects.mjs`、`node scripts/check-boot-hud.mjs` 通過。Edge 實際運行覆蓋開場五塊投影、啟停、靜態追蹤、減少動態效果、工作臺銜接與 2560×1080 視口；無頁面異常。截圖與結果見 `verification/boot-hud/`。檢查了圓環與歡迎畫面截圖；尚待用戶試用最終觀感。

復現腳本自帶 5189 靜態服務，讀取壁紙構建；可通過 `PLAYWRIGHT_MODULE` 指定 Playwright 安裝位置。

## Logo 下方小字閃動修正

用戶錄屏 `PixPin_2026-09-11_10-36-02.mp4` 指向 Logo 內的 RHINE·LAB 字樣。此前 BootSequence 每幀無條件賦值 SVG text.textContent；內容完整且不變時，650ms 內產生 20 次節點替換。改為僅內容變化時賦值。瀏覽器回歸同一時段為 0 次替換，保留同一個文本節點和完整文字，HUD 其他回歸通過。僅修正此處文字更新，最終 WE 錄屏所見的閃動是否完全消失仍待用戶復看。
或