# 主屏幕安裝與離線使用

正式地址：[rhine.lubeiluchen.cc](https://rhine.lubeiluchen.cc/)。

## iPhone / iPad

1. 用 Safari 打開正式地址。
2. 輕點“分享”，選擇“添加到主屏幕”；如果出現“作為網頁 App 打開”，保持開啟。
3. 從主屏幕的萊茵生命圖標打開，即可使用沒有 Safari 地址欄的獨立窗口。系統狀態欄和底部手勢區域會保留安全間距。

首次保持聯網，在終端設置的“主屏幕與離線”區域看到“離線資源已就緒”后，即可斷網重新打開。離線資源約 34 MiB，包含模型、完整字體分包、音樂與 40 份檔案。普通頁面按需加載字體，完整離線資源在進入終端后于后臺準備。Safari 標簽頁和主屏幕 App 的存儲可能各自獨立，請以主屏幕 App 內顯示的狀態為準。

如果瀏覽器清除了網站數據或系統回收了緩存，需要聯網重新準備離線資源。啟用聲音時，資源就緒后輕觸“點擊進入”（或按 Enter），聲音準備完成后統一開始開機動畫；關閉全部聲音的用戶直接進入。聲音加載失敗可重試，也可選擇“關閉聲音并進入”，此選擇會關閉并保存音效與音樂開關。開啟減少動態效果時仍可點擊進入并播放聲音，但會跳過開機動畫。

## 桌面與其他手機

支持安裝的瀏覽器會在終端設置中提供“安裝到設備”，也可使用瀏覽器菜單安裝。不同瀏覽器的菜單名稱可能不同；普通瀏覽器標簽頁同樣支持在線使用。

陣列上左右滑動切列，上下滑動切檔；也可輕點方向按鈕。詳情中的正文獨立滾動。360° 查看器支持單指旋轉、雙指縮放和平移，以及拆解、重組和復位。橫豎屏切換保留當前檔案和查看器狀態。

## 更新

新版本會在后臺下載完整資源，準備好后在頁面底部提供“更新并重啟”，也可從右上角“設置”中更新。更新不會清除收藏與偏好。下載失敗時繼續使用上一個完整離線版本，聯網后重試即可。

如果舊版只有提示、找不到更新入口，請打開[更新終端](https://rhine.lubeiluchen.cc/update.html)，點擊“更新并返回”。這個入口從網絡獲取，不經過舊版本的頁面緩存；應用完整新版后返回終端。普通“清除緩存”不一定清除 Service Worker 的離線副本，無需清空網站數據或收藏。

## 開機動畫與選檔動效

首次進入時，本站跟隨系統“減少動態效果”偏好；系統未要求減少時使用完整動畫。之后可在設置中選擇“完整 / 減少 / 自定義”，選擇會保存在本地，資源更新不會重置它。

需要完整動效時，打開右上角圓形圖標下標有“設置”的按鈕，選擇“啟用完整動效并重播”。這只調整本站，無需修改系統設置。減少動態效果開關也可隨時重新開啟。

## 開發與 Vercel

`npm run build` 生成靜態站點和帶內容版本號的 Service Worker，輸出在 `dist`。現有 Vercel 項目沿用 GitHub 自動部署，配置見 `vercel.json`。Service Worker、manifest 與構建清單使用重新驗證緩存頭。離線功能只在正式構建的 HTTPS 或 localhost 環境注冊，`npm run dev` 不注冊。

本地驗證：運行 `npm run build`，再運行 `npm run preview`。瀏覽器測試見 `scripts/check-pwa.mjs`，需要本機可用的 Playwright 與 Chrome；可通過 `PLAYWRIGHT_MODULE` 指定已有 Playwright 模塊路徑。

`scripts/check-startup-motion.mjs` 驗證首次進入跟隨瀏覽器動效偏好，以及本站的完整 / 減少 / 自定義選擇、重播和正文解密；`scripts/check-pwa-recovery.mjs` 驗證舊版遷移，需要以 `PWA_PREVIOUS_DIST` 指定保留的舊生產構建。兩個腳本可設 `REVIEW_CHANNEL=msedge` 驗證 Edge。更新恢復頁保持網絡獲取，未加入離線資源清單。

圖標源自項目共享萊茵生命 SVG 路徑，生成腳本為 `scripts/build-icons.mjs`，通過 `SHARP_MODULE` 可指定本地 Sharp 模塊。修改資源后重新構建即可生成新的離線版本，無需手動修改緩存編號。

平臺說明參考：[WebKit 主屏幕 Web App](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)、[Safari 26 主屏幕安裝行為](https://webkit.org/blog/17333/webkit-features-in-safari-26-0/)、[Service Worker 生命周期](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers)。
◖