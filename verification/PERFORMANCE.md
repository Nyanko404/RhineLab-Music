# 保持視覺效果的性能優化

基線：`75f7eac83d65dcb70a6177437d7994ce5a0933f2`，來自 `codex/wallpaper-engine`。本輪工作保留在 `codex/visual-preserving-performance`。網頁與壁紙使用同一套主場景優化；開場 HUD 使用既有原生實現。

## 完成的修改

1. **同幀陰影復用**：每次實際繪制只在主畫面通道生成一次陰影，環境遮蔽與景深通道復用。場景世界矩陣也在模擬結束后統一更新一次。
2. **陣列數據共享與按變化上傳**：五種陣列部件共用一個實例矩陣緩沖。比較實際 Float32 數值，只上傳變化區間；主題屬性獨立更新。包圍球僅在實例變換或數量變化時重算。相機、軌道及覆蓋參數相同則復用候選列表，逐卡裁剪繼續執行。
3. **靜止畫面復用**：模擬、選檔、拾取與界面更新繼續執行，僅在相機、實例、材質、紋理及后處理輸入均相同時跳過三維繪制。比較的是 GPU 浮點輸入，不截斷彈簧、不增加動畫停止閾值。變化中的實例直接繪制，避免在忙碌幀上額外掃描全部材質。紋理更新、畫質、窗口尺寸、上下文恢復等變化會使緩存失效。
4. **開場 HUD 布局緩存**：文字或布局變化時測量原始框體；Logo 位移與歡迎畫面縮放從原時間軸變換計算。保留字體完成加載、窗口尺寸、布局模式切換等失效條件。
5. **環境遮蔽與景深共享深度繪制**：在法線通道的第二個顏色附件中，同時輸出原 BokehPass 的 RGBA 打包深度，保留 HalfFloat 存儲與高精度深度公式。景深使用原著色器。AO 分辨率降低或關閉時繼續使用原獨立景深深度通道；不以低分辨率深度替代完整深度。

模型、材質參數、光照、陰影分辨率、AO 采樣、景深強度、抗鋸齒、三維渲染比例和動效時間軸未降低。無新增產品開關。

## 測量方法

- 本機 GPU：NVIDIA GeForce RTX 5070 Ti Laptop GPU，ANGLE / D3D11；主基準為 1920×1080、DPR 1、原始畫質。
- Edge 中運行實際 ArchiveScene。固定隨機種子以保持 SSAO 樣本一致，固定 1/60 秒模擬步長，按場景重建實例。核心每場景采樣 48 幀。
- 原生 Wallpaper Engine 測試窗使用相同場景和畫質，運行于其 CEF（Chrome 146）中。每場景先運行 60 個實際預熱幀，再采樣 96 幀；三輪順序為基線→優化、優化→基線、基線→優化。
- 宿主性能基準隔離真實鼠標轉發，選檔與音樂頻段由腳本提供。正常鼠標、觸摸、音樂喚醒等另有運行時回歸。
- GPU 時間來自 `EXT_disjoint_timer_query_webgl2`，失效或未就緒的查詢記為 `null`，不當作零；CPU 時間是主線程模擬和渲染命令提交耗時。二者不能直接相加推算 FPS。
- 原始記錄中的 `total` 僅包含 CPU 提交及 `gl.finish()` 調用返回時間，瀏覽器可異步處理命令，不能把它當作端到端幀耗時。
- 測試未鎖顯卡頻率、功耗與其他桌面進程，因此同時報告繪制工作量和時間波動。此機器不是低配設備，結果不外推為所有用戶的固定提升幅度。

## 已確認的工作量減少

| 場景／指標 | 基線 | 優化后 |
| --- | ---: | ---: |
| 普通呼吸／音樂場景繪制調用 | 102 次/幀 | 75 次/幀 |
| 固定 48 幀快速切檔樣本的繪制調用中位數 | 308 次/幀 | 225 次/幀 |
| 普通陣列緩沖上傳 | 186,624 字節/幀，6 次 | 約 20,000 字節/幀，1 次 |
| 已穩定陣列／詳情三維繪制 | 每幀重繪 | 采樣期間 0 次 |
| 已穩定陣列／詳情緩沖上傳 | 每幀上傳 | 0 字節 |
| 開場 HUD，650 幀布局測量 | 651 次，含預備幀 | 92 次 |

上傳減少約 89%；102→75 的繪制調用減少約 26%。連續呼吸、音樂、切檔和開場仍完整運行，靜止復用僅在輸入一致時生效。

## 時間結果與視覺證據

以下為最終三輪原生宿主各輪中位數的中位數（毫秒），每輪 96 個樣本：

| 場景 | CPU 基線→優化 | GPU 基線→優化 | 解讀 |
| --- | --- | --- | --- |
| 靜止歸齊陣列 | 2.60→1.20 | 5.22→0 | 復用已有畫面；模擬仍運行 |
| 呼吸陣列 | 2.70→2.40 | 5.23→4.57 | GPU 中位耗時降低 12.6% |
| 連續快速換檔 | 5.10→4.60 | 7.09→6.15 | 最終三輪降低 13.2%，早先一批接近持平 |
| 已穩定詳情 | 2.00→0.80 | 5.43→0 | 復用已有畫面；輸入會喚醒 |
| 音樂律動 | 2.80→2.60 | 5.22→4.52 | GPU 中位耗時降低 13.3% |

“0”僅指受測三維場景無重復繪制，不代表整張壁紙零 GPU 占用；界面、窗口合成與其他效果仍可能運行。先前交替采樣中快速換檔的 GPU 中位數為 6.98→7.05 ms，體現了頻率和負載波動，因此不承諾所有機器或每次運行都能得到上述百分比。

網頁核心結果：`performance/baseline/results.json`、`performance/candidate/results.json`；逐像素對照：`performance/candidate/comparison-baseline.json`。六個場景的定點截圖均無像素差異。網頁樣本中呼吸和音樂的 GPU 時間有所下降，快速切檔接近持平，三維入場的一次樣本反而較慢；不據此宣稱所有場景都提速。

擴展對照覆蓋暗色、半分辨率 AO、關閉 AO、關閉景深、SMAA、2560×1080、900×1600，以及另兩種音樂律動，九組截圖均無像素差異。見 `performance/candidate-extended/comparison-baseline-extended.json`。

開場 HUD 在 1920×1080、2560×1080、900×1600 連續運行各 650 幀。CPU 總耗時分別由約 1638/1990/1920 ms 降至 363/409/408 ms，減少約 78%–79%。連續投影矩陣的最大數值差約 0.00025（瀏覽器變換序列化精度）；15 張定點截圖逐像素相同。見 `performance/hud/results.json` 和 `performance/hud/images.json`。

原生宿主三輪的逐幀記錄、每輪中位數和畫面校驗位于 `performance/host/runs.json`。匯總腳本保留輪間范圍，并單獨驗證每組畫面，見 `performance/host/summary.json`。早期采樣發現宿主真實鼠標導致懸停抬起、破壞固定輸入，已修訂測試程序；不把該批結果用于最終比較。

更嚴格的重復檢查發現：宿主詳情頁的截圖有 **4 個像素，各有一個 RGB 通道相差 1/255**，總絕對通道差為 4，其余像素相同。坐標與逐輪結果完整保留在上述匯總中。人工審閱認定這不構成可見畫質損失，但不能稱作原生宿主所有畫面逐字節一致；匯總腳本如實保留不一致的哈希。此前未保存截圖的重復采樣也保留為 `performance/host/first-repeated-runs.json`。

完整截圖在本機 `verification/performance/`；Git 保存代表性對照圖、原始數值、比較報告和完整圖片哈希清單 `performance/image-manifest.json`，避免把每次中間運行的截圖全部加入倉庫。

## 運行時回歸

- `check-render-updates.mjs`：實際 Float32 更新范圍、尚未提交的區間、紋理與對象變化、顯式失效，以及長期運行中超過 2²⁴ 的版本計數。
- `check-performance-invalidation.mjs`：穩定畫面、改尺寸、配色、選檔、延遲紋理、AO/景深通道切換、SMAA、3D 退場反向、音樂恢復、實例容量擴展后的共享緩沖。
- `check-archive-diagonal.mjs`：桌面、手機豎屏與橫屏上的投影軌道、自由拖動、轉向。結果見 `performance/runtime/diagonal.json`。
- `check-three-release.mjs`：退場反向、實際上下文釋放、零三維畫布、圖片背景、重新創建上下文、減少動態效果、查看器釋放與詳情恢復。結果見 `performance/runtime/three-release.json`。
- `check-boot-hud.mjs`：五個開場區域、曲面關閉／靜態／追蹤、減少動態效果、階段切換、超寬屏。結果見 `performance/runtime/boot-hud.json`。
- 既有覆蓋范圍、畫質遷移、運動規則與內容檢查通過；TypeScript、網頁生產構建、Wallpaper Engine 構建通過。

當前機器未安裝 Playwright WebKit 運行時，本輪沒有真實 iPhone/Safari 或其他 GPU 的驗證；不能把 Chromium 的手機視口測試稱為 iPhone 實機結果。

## 復現與維護

```powershell
# 如 playwright / pngjs 不在項目依賴中，設置為本機安裝路徑。
$env:PLAYWRIGHT_MODULE = '<playwright 模塊目錄>'
$env:PNGJS_MODULE = '<pngjs 模塊目錄>'
node scripts/build-performance.mjs baseline
node scripts/build-performance.mjs candidate
node scripts/check-performance.mjs baseline
node scripts/check-performance.mjs candidate
node scripts/compare-performance.mjs baseline candidate

# 宿主必須已安裝，必要時配置 WALLPAPER_EXE。
$env:HOST_ROUNDS = '3'
node scripts/check-performance-host.mjs
node scripts/summarize-performance.mjs

# 另一個終端啟動測試服務器后運行緩存與 HUD 回歸。
node scripts/serve-performance.mjs release/performance-candidate 5194
node scripts/check-performance-invalidation.mjs
node scripts/check-hud-performance.mjs
node --experimental-strip-types scripts/check-render-updates.mjs
```

基線構建從上述 Git 提交加載原版 `scene.ts`、`archive-visibility.ts`、`hud-projection.ts`，使用同一資源與測試入口；不切換或改寫工作區。測試頁面不屬于正常生產構建入口。

共享深度針對鎖定的 Three.js 0.183.2 實現，使用了 SSAOPass 的 `_renderOverride` 擴展點。升級 Three.js 時必須檢查該調用約定、深度著色器、附件清除行為，并重跑視覺及回退通道測試。主場景后續增加新的可變材質、光源或著色器輸入時，需要一并加入 RenderState 失效條件。
