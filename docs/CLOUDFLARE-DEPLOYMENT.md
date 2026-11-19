# Cloudflare Pages 部署

## 2026-09-26 首頁 ERR_FAILED 修復

線上首頁、JS 和 CSS 均返回 HTTP 200；Pages 生產部署成功，自定義域名處于 active 狀態，未啟用 Functions。Edge 在 Service Worker 控制下報 ERR_FAILED，臨時繞過 Service Worker 即恢復。

根因是 Pages 將 `/index.html` 308 重定向至 `/`，原預緩存直接保存跟隨重定向后的 Response。首頁導航使用 manual 重定向模式，不能直接消費該響應。現在預緩存從作用域目錄 URL 獲取首頁，仍以 index.html 作為版本內緩存鍵；讀取歷史 redirected 首頁響應時重建 Response，保留正文、狀態和標頭。

驗證：`node --test scripts/check-pwa-redirect.mjs` 使用真實 308 響應覆蓋子路徑、首頁別名、查詢參數、歷史重定向響應和離線讀取；`npm run build:cloudflare` 通過。實際 Edge 本地對照：舊 worker 首次載入后刷新復現 ERR_FAILED，新 worker 刷新與斷網讀取均正常。恢復入口仍為 `/update.html`，不清除收藏與偏好。

## Git 自動部署

生產倉庫為 `LBEILC/RhineLabUI`，分支 `main`，構建命令 `npm run build:cloudflare`，輸出目錄 `release/cloudflare/site`，根目錄為倉庫根目錄。Pages 注入 `CF_PAGES=1` 時打包到固定輸出目錄；本機構建繼續使用版本號目錄。

Pages 官方項目 URL 為 `rhine-lab-ui.pages.dev` 或其預覽子域時，構建腳本從當前正式網站恢復三份授權 WOFF2 和原 CSS，逐個校驗 SHA-256。恢復失敗中止構建，保留正在服務的上一版本。授權字體不提交到 Git；其他 Pages 項目不自動恢復該字體。首次建站仍使用本機授權 kit 引導部署。

當前控制臺支持為已有直接上傳項目連接 Git 倉庫，無需新建項目或更改 DNS；此流程以控制臺實際提供的功能為準。

2026-09-15 已在控制臺連接倉庫，確認生產分支 `main`、自動部署啟用、構建系統版本 3、命令和目錄與上述一致。空目錄恢復測試成功校驗四個授權資源，模擬 Pages 環境構建輸出 828 個文件。連接后的本次文檔提交用于驗證 Git 推送觸發的首次托管構建。

### 自動部署驗證結果

- 2026-09-15 20:19（UTC+8）：Git 提交 `4c8f62d` 自動觸發部署 `8e956e3b-3dd1-4a8a-ae65-7b948b4e0d42`，狀態 success，耗時 52 秒。部署地址 `https://8e956e3b.rhine-lab-ui.pages.dev/`，生產別名繼續為 `rhine.lubeiluchen.cc`。
- 構建環境 Node.js 22.16.0、npm 10.9.2；執行 npm clean-install 后構建成功，日志確認恢復并驗證四個授權資源、生成 828 個發行文件、解析 9 條標頭規則。
- 生產 PWA 版本 `f3ab483c8b364c9e`。825 個應用文件驗證通過；12 個文本文件僅存在 Windows／Linux 換行差異，其他內容與本地構建一致。按遠程文件內容重新計算 PWA 版本哈希通過，Service Worker 代碼及清單匹配，更新入口 no-store、模型 immutable 和缺失文件 404 均通過。
- 本地直接上傳包的版本號可能因換行差異而不同。下面的逐字節校驗命令適用于本地包和該包的直接上傳部署；Git 構建應以托管構建日志中的版本及跨平臺內容校驗為依據，不能把換行造成的版本變化視為資源丟失。
- 后續正常推送 main 會自動發布。僅記錄驗證結果、不涉及產品內容的提交可按需使用 `[CF-Pages-Skip]` 前綴跳過冗余部署。

## 構建

從正式 main 版本構建，安裝項目依賴及本機已授權的 Novecento Webfont kit 后執行：

```powershell
npm run build:cloudflare
```

`release/cloudflare/latest.json` 指向本次版本目錄。打包腳本從 PWA 資源清單生成靜態發行包，驗證三個字體的 SHA-256、單文件 25 MiB 與 20,000 文件限制；缺少授權字體直接停止。源碼倉庫繼續排除字體 kit。

Cloudflare Pages 項目名為 `rhine-lab-ui`，默認地址為 `https://rhine-lab-ui.pages.dev/`。首次遷移通過上傳版本目錄內容生成的 ZIP 完成；連接 Git 后日常發布由推送自動觸發。需要手動恢復時，可使用 `wrangler pages deploy <版本目錄> --project-name rhine-lab-ui --branch main`，不依賴暫停中的 Vercel 來恢復字體。

本次發行包共 828 個文件，瀏覽器上傳成功。瀏覽器直接上傳上限為 1,000 文件；資源增長后改用 Wrangler 上傳（免費項目上限 20,000 文件）。

上傳后執行以下命令，對比版本清單、全部應用文件字節、關鍵緩存頭和缺失資源響應：

```powershell
node scripts/check-cloudflare-deployment.mjs https://rhine-lab-ui.pages.dev/
node scripts/check-cloudflare-deployment.mjs https://rhine.lubeiluchen.cc/
```

## 緩存與 PWA

發行包生成 `_headers`，保留 MiSans 分包和帶內容哈希模型的一年不可變緩存；首頁、Service Worker、更新入口與版本清單使用重新驗證策略。`404.html` 防止不存在的模型或字體被首頁 HTML 代替。PWA 緩存內容與版本規則保持原樣。

## 域名切換記錄

目標域名：`rhine.lubeiluchen.cc`。DNS 由阿里云管理，先在 Pages 中綁定該自定義域名，再更新阿里云的 `rhine` CNAME。無需更改 NS。

2026-09-15 瀏覽器讀取的原記錄：

- 類型：CNAME；主機記錄：`rhine`；線路：默認。
- 原值：`cfbe4759f8473c27.vercel-dns-017.com`。
- TTL：10 分鐘；權重：1；狀態：啟用。
- 原備注：`Rhine Lab UI · Vercel`。

2026-09-15 已通過瀏覽器將 `rhine` CNAME 提交為 `rhine-lab-ui.pages.dev`，保持默認線路、10 分鐘 TTL、權重 1 和啟用狀態，備注改為 `Rhine Lab UI · Cloudflare Pages`。

首版 PWA 版本為 `c4ceb4fc0bf3994d`。Pages 地址與正式域名各校驗 825 個文件，字節全部匹配；檢查了更新文件不存儲、模型不可變緩存和缺失資源 404。2026-09-15 20:05（UTC+8）正式域名返回 HTTP 200、`Server: cloudflare`，控制臺顯示“活動、SSL 已啟用”。Edge 實際打開原域名，完成開場、陣列、檔案詳情和 360° 模型加載與畫面檢查。

切換期間內置瀏覽器仍短暫命中舊 Vercel DNS 緩存，Edge 與公開 DNS 已使用新記錄。短時間仍見暫停提示的訪客可等待原 10 分鐘 TTL 到期后重開頁面；這不需要清除收藏或網站數據。

首次遷移使用直接上傳，之后用戶授權接入 Git 自動部署。自動構建配置及驗證結果以本文“Git 自動部署”部分為準。

回退 DNS 可恢復原記錄，但原 Vercel 服務因額度超限暫停，回退本身不會解除暫停。
Ć