# 壁紙 UI 曲面與全局畫面質感

2026-09-10。用戶提供三張標注截圖，要求重新查看本機創意工坊 3088099655；UI 單獨產生空間視差，色散、顆粒、暗角處理全局。

## 參考結構與本次修正

只讀查看指定項目的 project.json 與 scene.pkg。場景禁用了 camera parallax；前后兩個 Full Composition Layer 使用正負 0.02 的徑向鏡頭畸變，UI 位于中間，背景經過相反方向處理。cursortracking 控制兩層相反的切向中心偏移，歸一化鼠標乘正負 0.005，關閉時回到中心。另一個合成層使用 CRT 與色散；顆粒還受 resolution 影響，中心附近色散較弱。參考文件沒有復制到交付包。

此前同方向 translate / rotate 與僅三維的 ShaderPass 已撤換。本版 UI 各區塊以共同徑向曲面四角計算 matrix3d，左上／右上、左下／右下的斜率不同。為保留原生 DOM 控件、磨砂底和正確命中范圍，區塊內部采用四角投影近似，沒有聲稱逐像素復用參考項目的光學 shader。曲率為縱深 × 0.08，指針改變切向項。屏幕角落歸一化避免把邊緣內容推離畫面。關閉鼠標追蹤保留靜態曲面；關閉視差返回原布局。WE 被動指針不再移動三維相機，顯式拖動卡片規則沿用。

全局效果現在使用瀏覽器 SVG SourceGraphic 合成，涵蓋三維畫布、DOM 文字、按鈕、磨砂與模態查看器。徑向色散分別偏移紅／藍通道；邊界淡出并校正位移圖中性值，避免彩色邊框。顆粒為單色 soft-light 合成，有強度和尺寸，12Hz 更新；暗角同樣在全局合成后衰減。關閉時移除濾鏡，單項為零時不創建對應處理節點。保留 sRGB 避免不必要的色調變化。技術依據：[SVG 位移濾鏡](https://developer.mozilla.org/en-US/docs/Web/SVG/Reference/Element/feDisplacementMap)、[SVG 混合濾鏡](https://developer.mozilla.org/en-US/docs/Web/SVG/Reference/Element/feBlend)。

三項主開關默認關閉。鼠標追蹤默認開啟，依賴 UI 視差顯示。減少動態效果時停止追蹤、凍結顆粒，但不取消用戶選中的靜態曲面。開場沒有 UI 曲面，仍經過用戶啟用的全局屏幕效果。局部磨砂繼續獨立配置。

## 驗證

- check-visual-effects.mjs：三種寬高比零縱深恒等、曲面左右對稱、兩側斜率相反、投影矩陣四角精確匹配、部分屬性回調、追蹤關閉保留曲面、彈窗停止追蹤、減少動態效果、開場全局濾鏡范圍。
- check-workbench.mjs、check-wallpaper.mjs、check-playground.mjs：工作臺、宿主回調、原生七分組與條件顯示通過。
- Edge 實際打開 reference/visual-effects-review.html，逐項檢查曲面、色散、顆粒、暗角。70% 縱深、追蹤關閉時，左上品牌頂邊斜率約 +0.098，canvas transform 為 none；右側與底部方向相應反轉。
- 60% 色散清楚覆蓋品牌字體、時鐘與三維卡片邊緣；修正后的邊緣無越界彩框。80% 顆粒 / 60% 尺寸在淺色背景可見；70% 暗角同時壓暗暗色主題的文字與背景。
- 曲面與磨砂開啟時，實際點擊底部「專注計時」成功切換，再點擊變形后的設置入口成功打開彈窗。20% 色散、30% 顆粒、35% 暗角同時覆蓋設置彈窗，彈窗內容和按鈕仍可使用。
- 瀏覽器檢查不等于 Wallpaper Engine 宿主 GPU 性能測量。本次不宣稱宿主幀率；整體合成濾鏡的實際負載取決于壁紙分辨率和硬件。
`npm run build:wallpaper` 與 `npm run build` 均通過；保留既有大塊體積提示。
