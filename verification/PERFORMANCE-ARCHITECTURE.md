# 本地文件工具：性能與技術棧評估

日期：2026-09-09。此文是源碼、GLB 資源統計與官方架構文檔分析，不是跨框架性能跑分。未測得當前設備的 GPU 幀時、整進程內存或文件索引吞吐；系統硬件信息查詢在當前權限下未能取得。未修改產品代碼或已確認的視覺規范。

## 當前實現的可核實成本

- `src/archive-loop.ts` 固定 9 × 32 = 288 個陣列位置，已經具備可見窗口復用機制。文件總數不必決定 GPU 中的模型數量。
- `src/scene.ts` 從 GLB 選擇五個材質組建立 InstancedMesh；沒有為陣列復制全部模型。五組分別為 Frosted_Polymer、Ivory_Edges、Optical_Diffuser、Champagne_Index、Titanium_Fasteners。
- 直接讀取 `public/assets/archive-cassette.glb` 的 accessor 索引數量，五組每份分別為 188、6248、188、1468、896 個三角形，共 8988。288 個位置在一次遍歷全部陣列幾何的 pass 中提交約 2,588,544 個三角形。這不是每幀最終總量，也不是最終可見像素量；陰影和透射等 pass 繪制的對象集合不同，隱藏實例通過縮放為零處理，仍占實例提交。
- Ivory_Edges 占陣列幾何三角形約 69.5%，是背景模型 LOD 原型最值得檢查的部位。原始 GLB 全部 11 個 primitive 共 39544 個三角形，不能直接乘以 288 作為實際陣列負載。
- 五組實例矩陣每幀均標記更新：5 × 288 × 16 × 4 = 92160 字節，約 90 KiB/幀，60 FPS 約 5.27 MiB/s。僅從傳輸量看并不大；這不等于 CPU 計算耗時已測定。
- `src/scene.ts` 開啟物理透射、2048² 陰影、SSAO 和景深。當前 Three.js 的 SSAOPass 額外渲染法線并做屏幕空間處理，BokehPass 另繪深度；透射也有背景捕獲與紋理處理。實例化減少提交調用，不能免除幾何處理和多 pass 的像素成本。
- 所有陣列 InstancedMesh 設置 `frustumCulled = false`，沒有逐實例視錐剔除。外圍與霧中的卡片仍可能提交，是否減少窗口或增加分塊剔除需檢查鏡頭邊界。
- `src/main.ts` 持續 requestAnimationFrame，主場景在獨立查看器打開時暫停繪制。檔案預覽有持續呼吸動畫；減少動態效果只改變動效狀態，不會停止主渲染循環。啟動階段三維畫布透明時也沒有在主循環按其可見性跳過場景更新。
- 高畫質使用 `min(devicePixelRatio, 1.5)`，再結合固定 1920×1080 舞臺的窗口縮放。相同 CSS 視口從有效像素比例 1 提到 1.5，渲染面積增加到 2.25 倍；不能據此聲稱 FPS 必然變為 1/2.25。低畫質同時關閉 AO 和景深，不能用該開關單獨歸因某一種效果。

結論：GPU 幾何、多 pass 與長期持續繪制是優先驗證的瓶頸假設。當前沒有證據表明 TypeScript 執行速度是主要瓶頸，也沒有證據證明更換宿主能自動提升特定倍數的 FPS。

## 文件數據層

文件名、路徑、大小和時間戳索引，與三維效果分開測量。縮略圖、全文提取、視頻解碼也應獨立排隊，不能在初次掃描時讀取所有內容。

建議查詢層返回有界分頁結果，附穩定標識與查詢代次；快速輸入取消或丟棄舊查詢。界面只維護當前結果頁和附近卡片，不把百萬條記錄反復序列化傳給前端。收藏與目錄綁定等元數據可以用 SQLite；文件名包含匹配的索引策略需要單獨設計，普通 B-tree 不能自動加速任意子串查詢。

綁定少量目錄可用后臺枚舉、持久緩存與目錄變更監聽。監聽事件需要合并，丟失或溢出后重掃對應范圍。全盤搜索優先接入 Everything SDK，避免第一版自行實現完整 NTFS 索引器。SDK 需要 Everything 客戶端后臺運行；性能統計應把它的索引時間和內存計入總成本。

## 技術棧取舍

| 方案 | 對本項目的判斷 | 主要成本或限制 |
| --- | --- | --- |
| Electron + Three.js | 復用現有代碼最直接，適合快速產品化 | 攜帶 Chromium/Node 運行時；不能解決既有 GPU 渲染成本 |
| Tauri 2 + Rust + Three.js | 推薦作為保留當前效果的第一條驗證路線；Rust 承擔索引和系統操作 | Windows 前端仍是 WebView2。減少自帶瀏覽器的發行負擔，不代表運行內存或 FPS 必然優于 Electron |
| C++ + Qt Quick/QML + Qt Quick 3D | 推薦作為非 Web 的工具型應用候選，具備集成的二維控件與三維場景 | UI 和渲染層需遷移；燈光、透射、色彩映射和后處理需重新校準。Qt Quick 3D 官方許可為 GPLv3 或商業許可，選型時需與發行方式匹配 |
| Godot 4 + C#，必要處接原生模塊 | 偏三維交互體驗的原生候選，場景和動畫工作流適合檔案陣列 | 工具所需的系統集成、文件預覽與列表行為要自行完善；游戲引擎運行成本仍存在，不保證更省電 |
| Windows 原生 UI + Direct3D，或 Rust + wgpu | 對渲染管線、內存和調度控制最多，適合將底層優化作為長期核心投入 | 需要自行搭建較多材質、后處理、文本與輸入系統；開發和視覺驗證成本最高，并無本項目跑分證明其收益 |

Tauri 是桌面宿主方案，wgpu 是圖形 API，二者不處于同一抽象層。wgpu 在原生運行時可以使用 D3D12、Vulkan、Metal，不要求網頁或瀏覽器。WinUI 的 SwapChainPanel 可承載 DirectX，但不直接提供現成的 Three.js 材質與場景移植。

## 驗證順序與驗收口徑

1. 在相同機器、相同物理輸出分辨率、相同畫質和電源模式下記錄現有生產構建。分別測試啟動、閑置、連續換檔、詳情和獨立查看器。記錄幀間隔 P50/P95/P99、長幀、CPU、GPU、進程樹內存與顯存。幀率上限和垂直同步應保持一致。
2. 分別關閉 AO、景深、陰影和透射，分別調低渲染分辨率、引入背景 LOD，定位單項收益；不要以同時關閉多個效果的差值歸因某一項。靜止、隱藏和最小化狀態單獨檢查繪制調度。
3. 在獨立原型中測試背景邊框簡化，保留當前特寫模型；對抽取和歸位的材質、幾何連續性做對照。涉及美術模型的生成仍遵循項目 Blender MCP 要求。原型不能直接替換用戶確認的外觀。
4. 用 1萬、10萬、100萬條元數據測查詢和分頁，以真實目錄測磁盤枚舉與監聽；合成數據不能代替真實磁盤吞吐。分別報告冷啟動、熱緩存以及縮略圖隊列負載。
5. 只有在同一資產、相機、輸出尺寸、可比材質效果下，才用 Tauri 或原生候選原型進行對比。新引擎默認場景的高幀率不能證明當前畫面遷移后更快。

可用的初步目標：60 Hz 下幀預算 16.7 ms；索引就緒后首批結果端到端延遲 P95 小于 100 ms；隱藏和最小化時停止三維繪制。以上是候選驗收目標，不是現有成績，也不保證適用所有硬件。

推薦決策：保留成果并盡快得到本地工具，先驗證 Tauri + Rust + Three.js；明確選擇完全非 Web 且以桌面工具功能為主，評估 Qt Quick 3D 的同場景原型；若主要價值是三維交互且不選 Qt 的許可路線，評估 Godot。不要僅根據框架名稱進行全量重寫。

## 官方資料

- [Everything SDK](https://www.voidtools.com/support/everything/sdk/)
- [Tauri 架構](https://v2.tauri.app/concept/architecture/)、[WebView 版本](https://tauri.app/reference/webview-versions/)
- [Electron 性能分析指導](https://www.electronjs.org/docs/latest/tutorial/performance)
- [Qt Quick 3D 功能與許可](https://doc.qt.io/qt-6/qtquick3d-index.html)、[后處理性能成本](https://doc.qt.io/qt-6/qml-qtquick3d-effect.html)
- [Godot MultiMesh](https://docs.godotengine.org/en/stable/tutorials/performance/using_multimesh.html)
- [wgpu 原生后端](https://docs.rs/wgpu/latest/wgpu/)
- [WinUI SwapChainPanel](https://learn.microsoft.com/en-us/windows/windows-app-sdk/api/winrt/microsoft.ui.xaml.controls.swapchainpanel?view=windows-app-sdk-1.8)
- [Windows 目錄變化監聽](https://learn.microsoft.com/zh-cn/windows/win32/api/winbase/nf-winbase-readdirectorychangesw)
