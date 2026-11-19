# RhineLab Music 驗收

環境為 Debian Linux、Node.js 24.22.1、Chromium 156.0.8078.79。上游以 `git clone` 取得完整歷史，於 `12cc5e4` 執行 `npm ci` 和 Vite 開發環境，再進行改造。Chromium 在原始頁進入檔案狀態，讀到「莱茵生命」及 WebGL 場景。原始全視窗 WebGL 截圖在這個軟體渲染環境逾時。

## 驗證範圍

| 項目 | 結果 |
| --- | --- |
| TypeScript 與正式建置 | `npm run typecheck`、`npm run build`。Vite 仍提示 Three.js 場景區塊大於 500 kB。 |
| 正式離線預覽 | Chromium 在 Service Worker 就緒後切成離線，重新載入首頁並實際播放已快取的試聽 MP3。 |
| 依賴稽核 | `npm audit --omit=dev --audit-level=high` 回報 0 個已知漏洞。 |
| 上游回歸 | `npm run check:content` 的 18 項通過。視窗構圖與解析率校驗 `npm run check:viewport` 通過。 |
| 音樂單元測試 | `npm test` 的 5 項通過，涵蓋來源連結與網域驗證、LRC 字詞時間、切換 Adapter 對遲到事件的處理、循環與位置恢復、YouTube 快取逾期。 |
| 本機播放 | Chromium 實際匯入及播放測試 WAV、FLAC 和 OGG，並播放上游試聽 MP3。FLAC 和 OGG 的標籤顯示正確。WAV 驗證暫停、跳轉、切歌、收藏及重新載入後的位置。 |
| UI | Playwright Chromium 的 7 項整合測試通過，涵蓋首頁、搜尋、來源篩選、混合清單建立／排序／刪除、平台切換、設定浮窗、曲目筆記持久化及手機歌詞。以 390 px、820 px 和 1280 px 擷取畫面，另在瀏覽器開啟和關閉 360° 模型檢視。 |
| WebGL | Chromium SwiftShader 載入上游低細節 GLB、完成一次畫面繪製並擷取桌面；全速硬體、長時間效能與實機觸控手勢需另行驗證。 |
| YouTube | 測試替身涵蓋官方 IFrame 介面、暫停、跳轉、切換時移除 iframe、Data API 搜尋及公開清單匯入。實站 IFrame API 在此環境回報 `ERR_TUNNEL_CONNECTION_FAILED`，也沒有配置有效 Data API 金鑰。實際串流與實站 API 未驗證。 |
| Bilibili | 官方 iframe 實際回應 HTTP 200，播放媒體、登入、私人內容及付費內容未驗證。自備搜尋端點以測試替身驗證契約及來源篩選。 |
| Spotify | 測試連結匯入、混合佇列切換、控制項停用及官方網址。站內授權、遠端清單及播放功能未實作。 |

[桌面 WebGL 畫面](../verification/music/desktop-webgl.png) · [設定浮窗](../verification/music/desktop-settings.png) · [平板 2D 畫面](../verification/music/tablet-2d.png) · [手機 2D 畫面](../verification/music/mobile-2d.png)

## 已知限制

- Spotify 保留使用者提供的曲目連結。OAuth PKCE、Web API、Web Playback SDK、Premium 與裝置檢查由整合範圍排除，詳見平台設定。
- Bilibili 站內搜尋需要外部授權的服務；播放時間、暫停與音量由 iframe 管理，混合佇列需手動切換此來源的下一首。YouTube Music 影片使用 YouTube 供應的嵌入播放器。
- 歌詞來源為本機檔案標籤或使用者匯入的 LRC，字詞同步需要對應的時間標記。未串接線上歌詞目錄。
- 平板及手機驗收使用 Chromium 版面與觸控模擬。Safari、Firefox、實機音量行為及實際裝置的 Media Session 控制未做相容性驗收。
- 新建置的靜態檔可在同一個網站來源離線使用。本機媒體和資料保存在瀏覽器，跨裝置或跨來源沒有同步服務。

[平台設定與限制](MUSIC-PLATFORMS.md) · [重現指令](../README.md)
