# Observatory / 觀測室

三個 Ogg 文件為本項目原創程序編配的同步循環聲部，MP3 是帶首尾淡變的獨立試聽版。配樂無原片采樣、無外部錄音、無人聲。

源譜及合成：`scripts/render-audio.mjs`；音效合成：`src/audio.ts`。
生成數據：`score.json`。隨項目采用倉庫 LICENSE。

## 逐字輸入短音

`typing-preview.wav` 及 `src/typing-samples.ts` 使用用戶提供的《明日方舟》特別映像 [萊茵生命：訪問] 中約 6.864–6.986 秒的三個短音，各 38ms。`typing-source.json` 保留精確時間、源文件校驗與處理參數。原音及其衍生片段的權利歸原作者，不納入上文原創配樂的 MIT 授權聲明。

提取腳本：`scripts/extract-typing-audio.mjs`。原片短音僅去直流、做邊緣淡變和統一增益，沒有變調、變速或合成替換。`reference/typing-original.wav` 為本地對照片段，不屬于生產配樂。
꜇