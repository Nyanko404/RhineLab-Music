# README 演示素材

2026-09-09 從當前應用重新采集，運行版本為 `e0cb75ffcc1bf7d1fb5e2458b3c35fa0f6f336da`。使用獨立的 Chrome 瀏覽器上下文、GPU 硬件加速與默認「原始」畫質，不讀取日常瀏覽器的收藏和偏好。素材僅用于文檔展示，不參與應用運行。

## 靜態截圖

全部截圖為 1600 × 900 JPEG，質量參數 93。保留真實界面與模型，沒有疊加宣傳文字或替換背景。

| 文件 | 展示內容 |
| --- | --- |
| `archive.jpg` | 新版循環陣列與檔案導航 |
| `detail.jpg` | 解密完成后的雙環內構與檔案概述 |
| `research.jpg` | 研究記錄頁簽 |
| `viewer-clear.jpg` | 獨立查看器，清晰玻璃 |
| `viewer-frosted.jpg` | 相同視角下的磨砂玻璃 |
| `assembly.jpg` | 六組結構拆解 |
| `search.jpg` | 搜索「萊茵」后的檔案索引 |
| `settings.jpg` | 音效、音樂、減少動態效果與畫質設置 |
| `boot.jpg` | 白底開場中的 Logo 與身份接入 |

## 動圖

通過 Chrome DevTools Protocol 錄制運行頁面，按捕獲時間戳保留真實節奏，再用 FFmpeg 縮放、降幀和量化。GIF 使用 96 色調色板與 Bayer 抖動，無聲音，不代表應用實時幀率。瀏覽器僅在合成幀變化時輸出錄制幀，靜止畫面依照原時間保持。

| 文件 | 內容 | 大約時長 | 尺寸 / 幀率 |
| --- | --- | --- | --- |
| `decryption.gif` | 抽取、對角解密線、玻璃與正文同步揭示 | 7.9 秒 | 960 × 540 / 12 fps |
| `glass-motion.gif` | 清晰 → 磨砂 → 清晰 | 4.2 秒 | 800 × 450 / 12 fps |
| `assembly-motion.gif` | 拆解、旋轉、視角復位與重組 | 8.0 秒 | 800 × 450 / 12 fps |
| `browse.gif` | 連續選檔、切列和文字滾動 | 6.8 秒 | 640 × 360 / 8 fps |
| `boot-motion.gif` | 白底輸入、Logo、權限掃描與歡迎轉場 | 20.4 秒 | 800 × 450 / 12 fps |

README 直接展示解密動圖，其余動圖放在可展開區域。采集時間、源碼版本與原始幀間隔記錄見 [`capture.json`](capture.json)；GIF 編碼的幀時長取整可能使成片時長略有差異。

## 重新采集

采集腳本為 [`scripts/capture-readme.mjs`](../../scripts/capture-readme.mjs)。需要 Chrome、Playwright 與 FFmpeg；它們是文檔制作工具，普通應用運行不需要安裝。腳本會覆蓋本目錄同名素材，并將中間 JPEG 幀保存在被 Git 忽略的 `.tools/readme-capture/`。

先啟動應用：

```sh
npm ci
npm run dev -- --port 5186
```

再從倉庫根目錄執行腳本。已能通過 Node 導入 Playwright、且 FFmpeg 在 PATH 中時：

```sh
node scripts/capture-readme.mjs
```

也可以指定現有工具的位置，例如 PowerShell：

```powershell
$env:PLAYWRIGHT_MODULE = 'C:/tools/node_modules/playwright/index.mjs'
$env:FFMPEG = 'C:/tools/ffmpeg.exe'
$env:CAPTURE_URL = 'http://127.0.0.1:5186'
node scripts/capture-readme.mjs
```

其中工具路徑需要替換為本機的實際位置。Windows 錄制顯式使用 D3D11；其他平臺使用 Chrome 可用的 GPU 后端。錄制后應查看截圖、GIF 的起止幀及中間過渡，確認資源加載完整、沒有遮擋或異常，檢查 README 圖片鏈接，并更新此處的版本與時長。
