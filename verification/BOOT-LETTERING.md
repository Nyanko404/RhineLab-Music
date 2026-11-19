# 開場中央文字 · Novecento

2026-09-11，按用戶要求將適合的中央開場文案統一替換，不僅限于 START PROCESSING。

- Normal：訪問權限、身份確認、請求接收、開始處理、權限通過，以及處理中的留白故障幀。
- Bold：WELCOME TO、RHINE LAB.LLC.、INTERNAL DATABASE；公司名稱的黑底與灰閃層使用相同圖形。
- 保留原逐字時間軸、聲音觸發、授權字距收束、歡迎黑底掃過及 HUD 投影。左上 RHINE LAB 后續改為 DemiBold，下方兩行保留 MiSans。

## 來源與制作

在原片 18 秒的 START PROCESSING 裁切上，以實際 OTF 對比 Light、Normal、DemiBold、Bold 和 Arial。Normal 在本次統一字號／字距搜索中最貼合。該比較用于選型，不代表獲得了原工程的字體記錄。

Normal 與 DemiBold 來自作者的 DaFont 免費包；用戶已明確同意其許可。Bold 來自用戶既有 MyFonts 桌面字體包。源文件版本與 SHA-256 見 `boot-lettering/sources.json`。本地比較材料位于 `.tools/font-comparison/`，字體不納入 Git 或發行包。

根據兩個來源許可中將字母作為輪廓圖形導入的條款，項目僅發行十段預先制作的固定文字圖形，不嵌入 OTF 或 Webfont。`scripts/make-boot-lettering.py` 需要使用者自行提供獲許可的本地字體，并安裝 Pillow、fonttools 4.59.2。執行示例：

```powershell
python scripts/make-boot-lettering.py --fonts .tools/font-comparison/fonts
```

生成 `src/boot-lettering-art.json`（29,698 字節），保留逐字顯現所需的圖形分段，不提供任意文字排版或通用字庫。來源聲明隨發行包保存在 `assets/boot-lettering-notice.txt`。

## 實現與驗證

`BootLettering` 預建圖形節點，僅在文字變化時更新可見段；可訪問文本單獨保留。未知新文案回退為普通文字，維護時需重新制作圖形。授權掃描圓環在文字綁定前收集路徑，避免把字形路徑作為圓弧修改。

瀏覽器復核入口：`reference/boot-lettering-review.html`。本機 Chromium 實際運行通過 12 項回歸：

- 169–487 幀共 83 個實際文字變化，文本、圖形段數與時間軸一致，覆蓋標點、空白和故障幀。
- 靜止 450ms 內無文字 DOM 修改；前后跳幀復用原節點并恢復相同可見圖形。
- 授權圖形寬度隨字距收束；掃描圓環仍為六條動畫弧，跳幀結果一致。
- 歡迎灰閃及恢復符合原透明度，四個顯示層全部使用 Bold。
- 無意外文案回退、無 Novecento 字體文件請求；開場結束正常隱藏文字進入陣列。

處理提示與歡迎畫面已在瀏覽器檢查。此輪不聲稱真實 iPhone 驗收或所有 HUD 參數組合均已重測。

`npm run build` 與 `npm run build:wallpaper` 均通過，包含 TypeScript 檢查；只出現既有的大體積 JavaScript 分塊提示。壁紙產物位于 `release/wallpaper`，此輪未上傳創意工坊。

## 左上標題后續修訂

用戶指出 Bold 偏重后，同一裁切擬合的 DemiBold 像素 MSE 為 0.03689，Bold 為 0.06343，支持采用 DemiBold。對照圖 `boot-lettering/brand-demibold-fit.png` 從上到下為原片、DemiBold、疊加；不代表原工程字體鑒定。原始品牌外層及三行節點不變，第一行固定 48px 高，避免推動下方內容。復核頁新增標題文字、DemiBold 圖形和行高檢查。

此修訂實際瀏覽器共 14 項檢查全部通過，含原有 83 個文字變化；兩種發行構建再次通過。

## MyFonts 正式 Webfont（2026-09-11 后續）

用戶明確授權接受 MyFonts 條款并領取字體。Normal、DemiBold、Bold 的年度 Webfont 訂單已成功，當前每種每月 10,000 次頁面瀏覽，合計 $0；自動續期未開啟。訂單與個人賬單信息不寫入倉庫。MyFonts 的單域名網頁許可范圍不應等同于允許分發 Wallpaper Engine 字體包；用戶獲知區別后仍要求本機直接替換，此輪完成本機構建，未上傳創意工坊。

官方 Kit Builder 下載的原始 WOFF2 總計 119,732 字節。每種所用 27 個字符的字形與之前桌面 OTF 一致，來源版本與哈希見 `boot-lettering/webfont-sources.json`。字體未經轉換、子集化或修改。原包保存于本機 `.tools/myfonts-webfont/`；字體包和版權聲明安裝到 `public/fonts/novecento/`，該目錄已加入 Git 忽略。

其他獲許可的維護者可將官方 Kit Builder 的包解壓，將其頂層內容放到上述目錄，保持 `webFonts/NovecentoSansWideNormal/font.woff2`、`NovecentoSansWideDemiBold/font.woff2`、`NovecentoSansWideBold/font.woff2` 三個相對路徑，并保留原 CSS 的版權聲明。重啟開發服務器或重新構建后生效。字體權利不隨項目 MIT 許可轉讓。

Vite 檢查本地三種字體是否齊備；齊備時開場準備階段加載三種原生 FontFace，成功后用真實文字替換 SVG 字形。保留原有逐字容器寬度和字距，以避免位置、聲音觸發和動畫變化。官方字體行度量為 1021/-179，1em 行高下基線為 0.921em；字形上移 0.121em 對齊既有 0.8em 基線。缺少字體包或網絡失敗時保留原圖形，8 秒超時不阻斷啟動。

瀏覽器實際通過 15 項檢查：原有文字／品牌／掃描／歡迎回歸通過，確認三種 WOFF2 均已加載、所有文字改用真實字體且不保留文字 SVG 路徑。網頁與壁紙構建均通過；PWA 資源表包含三種 WOFF2。公開 Git 僅提交接入邏輯和聲明，不包含授權字體。新環境未安裝字體包時仍使用此前圖形。
ǈ