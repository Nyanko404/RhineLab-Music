# RhineLab Music 平台設定

複製根目錄的 `.env.example` 為 `.env.local`，填寫所需變數後重新啟動 Vite。正式環境在建置階段設定相同變數。Vite 會將 `VITE_` 變數編入瀏覽器程式。這些變數適合公開設定，請將伺服器憑證留在各自的後端。

## YouTube 與 YouTube Music

1. 在 Google Cloud 專案啟用 YouTube Data API v3。
2. 建立瀏覽器 API 金鑰。將 API 限制設為 YouTube Data API v3，並在網站限制加入實際開發與部署網站來源，例如 `http://127.0.0.1:5173/*` 和 `https://music.example.org/*`。
3. 將金鑰填入 `VITE_YOUTUBE_API_KEY`。在「平台管理」確認顯示 Data API 已設定，然後執行站內搜尋。
4. 貼上公開清單頁網址，例如 `https://www.youtube.com/playlist?list=…`，即可逐頁匯入。清單讀取的可見範圍受 YouTube 設定與配額限制。

支援 `youtube.com`、`youtu.be` 和 `music.youtube.com` 的影片連結，實際播放使用可見的 YouTube 官方 IFrame。可用時支援播放、暫停、時間、進度跳轉、音量和結束後切歌。影片必須允許嵌入，具體播放受地區、帳號、年齡、廣告與裝置規則影響。播放器移出可視畫面或分頁進入背景時會暫停。請避免部署時全站設定 `Referrer-Policy: no-referrer`，以便嵌入播放器驗證來源。金鑰留空時，可匯入單一影片以及開啟官方搜尋。從 Data API 取得的曲名、作者與封面逾期後，程式會在開啟時清除快取欄位，保留使用者收藏的連結及自訂名稱。

[YouTube Data API](https://developers.google.com/youtube/v3/getting-started) · [IFrame Player API](https://developers.google.com/youtube/iframe_api_reference) · [播放器與平台政策](https://developers.google.com/youtube/terms/developer-policies)

## Bilibili

可貼上 BV 號或 `https://www.bilibili.com/video/BV…?p=2`。嵌入播放器載自 `player.bilibili.com`，其播放、暫停、分 P、進度及音量由 iframe 裡的官方控制項負責。統一控制器可手動切換曲目，切換時會卸載 iframe。此整合缺少可用的進度同步、音量設定與播放結束事件。

站內搜尋可連接營運者持有相應權限的端點。跨來源部署時需允許網站的 HTTPS Origin，直接回應 JSON：

```http
GET /api/bilibili-search?q=<UTF-8 query>
```

```json
{
  "items": [
    { "bvid": "BV1xx411c7mD", "title": "影片標題", "author": "作者", "artwork": "https://example.org/cover.jpg" }
  ]
}
```

必填欄位為 `bvid` 與 `title`。封面使用 HTTPS 網址。瀏覽器需能讀取圖片，3D 標籤中的跨來源封面另需允許 CORS。設定 `VITE_BILIBILI_SEARCH_URL=/api/bilibili-search` 或 HTTPS 端點網址。供應端點需具備平台授權。此儲存庫提供搜尋介面和回應驗證，未搭載抓取服務。端點留空時，搜尋結果頁提供 Bilibili 官方搜尋連結。

私人資料和付費內容依 Bilibili 官方帳號權限與 iframe 行為而定。 [Bilibili 開放平台](https://open.bilibili.com/)

## Spotify

Spotify 開發者政策限制產品整合其他服務的串流或內容。RhineLab Music 採用使用者提供的 Spotify 曲目連結，包含 `https://open.spotify.com/track/…` 或 `spotify:track:…`，可輸入自訂顯示名稱，並存為收藏或混合清單中的外部項目。站內搜尋可查找已匯入的連結，另提供 Spotify 官方搜尋。

選取外部項目後，點選「在 Spotify 開啟」。帳號登入、付費訂閱、裝置選擇、曲目與專輯目錄及播放均由 Spotify 官方網站管理。此版本的站內 OAuth PKCE、Web API 帳號與目錄整合、遠端清單讀取、Web Playback SDK 和 Premium／裝置檢查均未實作。沒有 Spotify 憑證變數。 [Spotify Developer Policy，第 III 節](https://developer.spotify.com/policy)

## 部署與資料

- 站內匯入的本機音訊、封面、歌詞、清單及偏好保存在同一個瀏覽器來源的 IndexedDB。檔案匯入不會上傳。瀏覽器清理網站資料或移除離線資料可能影響保存內容。
- 遠端搜尋只在提交搜尋時呼叫設定的端點。選取嵌入影片時，瀏覽器會連線到該平台。平台的 Cookie 與資料處理依各自政策。
- 外站 API 失敗時，可重新送出搜尋或改用官方連結。嵌入播放失敗時，使用播放器的重試按鈕或官方頁面。
