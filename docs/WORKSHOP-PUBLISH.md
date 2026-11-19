# 手動發布到 Wallpaper Engine 創意工坊

正式名稱：**Rhine Lab · 萊茵生命交互桌面**。

正式本地工程已關聯創意工坊條目 `3799142774`，后續使用「發布更新」。

工程目錄：

```text
D:\Game\Steam\steamapps\common\wallpaper_engine\projects\myprojects\rhine-lab-workshop
```

## 第一次發布

1. 確保 Steam 在線，打開 Wallpaper Engine。如果已經打開過，重新打開壁紙選擇界面，讓它刷新本地工程。
2. 在「已安裝」里搜索 `Rhine Lab`，選擇 **Rhine Lab · 萊茵生命交互桌面**。另一個帶「本地測試」的條目是之前的試用工程，本次使用新名稱的條目。
3. 點擊右側詳情里的 **在編輯器中打開**。
4. 在編輯器頂部打開 **創意工坊** 菜單，選擇分享／發布壁紙的選項，進入 **發布到創意工坊** 表單。不同版本的菜單可能稱為「準備發布」或「在創意工坊上分享壁紙」。這是發布完整壁紙，不是發布組件或屬性預設。[官方網頁壁紙發布流程](https://docs.wallpaperengine.io/en/web/first/gettingstarted.html)
5. 核對標題為 **Rhine Lab · 萊茵生命交互桌面**。描述已寫入工程；如果界面未帶出，可從本文末尾復制。
6. 設置 **可見性：公開**、**年齡分級：大眾級（Everyone）**；樣式可選 **科技（Technology）**。
7. 在 **預覽圖片 → 導入文件** 中選擇下面的 GIF。即使已經出現封面，也可以重新導入這一版。

```text
D:\Game\Steam\steamapps\common\wallpaper_engine\projects\myprojects\rhine-lab-workshop\preview.gif
```

8. 第一次上傳選擇 **創建新項目**，點擊 **發布**，等待提示上傳成功。
9. 點擊 **在創意工坊中顯示壁紙**，檢查正式名稱、動畫封面和可見性。如果 Steam 要求接受創意工坊協議，由你在 Steam 頁面完成。若頁面提示審核中，等待審核即可，不要重復創建條目。
10. 保存工坊頁面鏈接，并備份整個 `rhine-lab-workshop` 工程目錄，尤其是發布后更新的 `project.json`。

## GIF 說明

工坊封面為 256×256、13.2 秒、約 940 KB，包含工作臺全景、時鐘與事項特寫、專注計時特寫、暗色全景與暗色特寫，再回到亮色全景。它從真實瀏覽器畫面剪輯并裁切放大，使用演示事項及演示頻譜；演示事項沒有寫入壁紙的默認值。

GIF 是無聲的。預覽封面不能完整表現所有細節，訂閱后的壁紙按實際屏幕尺寸渲染。官方規定 GIF 預覽不超過 256×256、文件不超過 1 MB；當前文件符合該限制。[官方預覽說明](https://docs.wallpaperengine.io/en/scene/first/publishing.html#animated-preview-images)

## 以后如何更新

可以持續更新同一個工坊條目，原訂閱者會收到更新，無需重新訂閱。[官方更新說明](https://docs.wallpaperengine.io/en/scene/first/publishing.html#publishing-updates)

1. 更新這個原工程的壁紙資源，保留 `project.json` 中的 **workshopid**，以及原發布關聯。
2. 從同一條目選擇 **在編輯器中打開**，再次進入發布窗口。
3. 「上傳為」應為 **更新現有項目**，按鈕應顯示 **發布更新**；填寫本次更新說明并發布。
4. 如果變成「創建新項目」，先檢查是否打開了其他工程或丟失工坊 ID，不要直接發布一個重復條目。

源碼倉庫的 `npm run build:wallpaper` 只生成構建包，不會自動讀取 Steam 剛生成的工坊 ID。首次發布后，不要用尚未包含該 ID 的構建版 `project.json` 直接覆蓋已發布工程的同名文件。后續交給代理更新時，提供這個工程目錄或工坊鏈接，讓代理先保留發布關聯再同步資源。

工坊上傳不等于源碼備份。保留源碼倉庫和發布工程，兩者都有用途。

## 可復制的發布描述

完整簡介保存在 [WORKSHOP-DESCRIPTION.txt](WORKSHOP-DESCRIPTION.txt)，并同步到正式工程的 description。更新日志放在最前面，按日期從新到舊，同一天按更新順序從新到舊排列，后接功能介紹。日期依據開發記錄整理，不代表當天每一項都單獨發布過工坊版本。以后完成更新時，在簡介頂部追加面向用戶的變化。

若發布窗口未自動帶出新簡介，將該文本文件的完整內容粘貼到描述欄，再發布更新。
)