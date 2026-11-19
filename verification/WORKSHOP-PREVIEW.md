# 工作臺工坊預覽

2026-09-10 用戶改為自行發布，要求錄制 GIF，并參照本地工坊項目 3088099655 的鏡頭方式。

參考預覽分析：256×256，127 個編碼幀，12.8 秒，幀延遲主要 100ms；全景與局部裁切交替，局部輕微移動。具體制作軟件無法僅憑 GIF 確定。沒有使用其人物圖片、文字、4K 標記或任何畫面作為本作品素材。

素材由 scripts/record-workshop-preview.mjs 在 1280×720 瀏覽器內錄制，展示工作臺、演示事項、音樂頻譜、專注頁與明暗切換。53 個截圖素材按實際時間記錄；隨后 scripts/encode-workshop-preview.py 組織六個鏡頭并進行局部推近。素材受截圖采樣速度限制，導出 100ms 時間步不代表原三維渲染或錄制達到穩定 10 FPS。

最終 wallpaper/preview.gif：256×256、13.2 秒、940017 字節、73 個編碼幀（相同幀合并延長停留），小于 1 MB。全局 24 色調色板用于減少閃動與體積；主要損失為細漸變層次。reference/workshop-preview/workbench-preview.gif 是 640×640、96 色的本地審閱版，不能作為受 1 MB 限制的工坊封面直接上傳。

鏡頭：亮色全景 1.8s → 時鐘與事項 2.4s → 亮色專注 2.4s → 暗色全景 2.0s → 暗色專注 2.0s → 亮色全景 2.6s。storyboard.jpg 已逐鏡檢查；輸入沒有寫入生產默認任務。封面預覽路徑和正式名稱寫入 wallpaper/project.json，構建腳本自動復制 GIF。

正式工程準備在 myprojects/rhine-lab-workshop，尚未上傳。用戶操作步驟與保持工坊 ID 的更新注意事項見 docs/WORKSHOP-PUBLISH.md。
6