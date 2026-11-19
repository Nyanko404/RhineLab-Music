# Win11 桌面動效與 PWA 更新入口（歷史記錄）

> 以下為歷史回歸記錄。2026-09-20 恢復首次進入跟隨系統動效偏好，與 main 一致；本站保存的完整、減少、自定義設置繼續優先。

日期：2026-09-09。反饋環境：Windows 11，Chrome 152.0.7977.83，Edge 同樣出現癥狀。

## 復現與判斷

在本機 Chrome 152.0.7977.83 和 Edge 152.0.4191.66 中使用新建瀏覽器上下文，對比 `prefers-reduced-motion` 的兩種狀態。該歷史版本的正常狀態進入開機動畫；`reduce` 狀態直接進入陣列，減少選檔、鏡頭和文字動效。兩種狀態都可打開右上角圓形圖標對應的設置窗口。

這證明系統減少動畫可以造成相同癥狀，不能證明反饋者的 Win11 開關一定關閉；未直接檢查對方設備。原先設置只有圖標，提示要求“在設置中更新”卻沒有可點操作，確實不易找到入口。

另用兩個完整生產構建復現舊版本更新：先安裝舊 Service Worker，再切換服務端新版，調用 Chromium `Network.clearBrowserCache` 后重新加載。頁面仍由舊 Service Worker 提供，新版處于 waiting。只清理 HTTP 緩存不能保證替換離線副本。

## 修改

- 設置圖標增加可見文字，新版就緒后在底部提供“更新并重啟”，保留設置內的更新按鈕。
- `update.html` / `update.js` 不進入離線清單，可通過網絡加載恢復入口；用戶點擊后檢查并下載新版，等待激活后返回。保留收藏與偏好。
- 設置中說明減少動效會跳過開機與簡化選檔，并提供“啟用完整動效并重播”。選擇保存在本站，系統輔助設置不變。
- 正文解密遮罩改為遵循 `.reduce-motion`，避免系統媒體查詢覆蓋用戶在本站明確開啟完整動效的選擇。

## 回歸方式

`scripts/check-startup-motion.mjs` 現在檢查不同瀏覽器動效環境下統一使用完整動畫，以及本站的完整 / 減少 / 自定義選擇、重播、選檔脈沖、正文遮罩和刷新后保留偏好。

`scripts/check-pwa-recovery.mjs` 以 `PWA_PREVIOUS_DIST` 指向保留的舊構建，檢查普通緩存清理后仍運行舊版、從網絡恢復入口遷移、保留收藏與動效偏好、更新后離線重載，以及從未安裝 Service Worker 的新訪客。

兩個腳本分別使用 Chrome 與 `REVIEW_CHANNEL=msedge`。另運行 `scripts/check-pwa.mjs`，覆蓋直接更新按鈕、完整離線資源、失敗更新保留舊版及不清理其他應用緩存。截圖和報告存放于 `.tools/responsive`。瀏覽器動效偏好通過自動化設置，未修改測試機的 Windows 全局輔助功能設置。

本次結果：Chrome 152.0.7977.83 與 Edge 152.0.4191.66 的動效和舊版恢復測試通過。Chrome 額外模擬恢復下載時一個圖標返回 503，頁面報告失敗并繼續保留上一完整版本；直接更新、離線查看、偏好保留和模態輸入隔離也通過。

平臺依據：[MDN 的系統減少動畫映射](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/%40media/prefers-reduced-motion)、[Chrome 的 Service Worker 更新生命周期](https://developer.chrome.com/docs/workbox/handling-service-worker-updates)。
-