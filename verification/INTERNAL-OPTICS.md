# 內部模型專項打磨

日期：2026-09-09。需求：更銳利的內構邊緣、半透明磨砂質感、改善兩環連接處。繼續采用 Blender MCP 建模；外殼與交互規則沿用現狀。

## 幾何與法線

- `art/internal_architecture.py` 生成環形屋面、直立壁板、內孔薄階、橙色嵌帶、84/52 根立面細肋與連續連接薄片。`art/clear_reference_details.py` 保留外蓋壓槽、浮雕文字等已有細節。
- 環形面沿圓周使用 192 段并平滑插值，在截面折邊處使用分裂法線；不跨屋面與側壁平均法線。切邊為小平面。橙色嵌帶也采用直壁截面。
- 連接薄片為一條三次貝塞爾路徑，兩端導數與環切線一致，寬度 0.225–0.260，烘焙后厚度 0.008。截面角處斷開法線，沿路徑平滑；兩端展寬、中央淺拱。
- 導出前斷言內構位于蓋板與基板之間；GLB 實測內構深度 -0.0340000 至 0.142399997。沒有左側高塔。
- 通過 Blender MCP 順序執行 `art/build_archive.py` 和 `art/build_assembly.py`，保留單體與拆解 `.blend`。先導出至 `art/.cache`，成功后替換產品 GLB，避免瀏覽器讀取到半寫入文件。

## 材質

`src/internal-optics.ts` 定義四類內部玻璃表面：壁板、屋面、切邊和連接片。使用粗糙高光與掠射角透明密度，保持薄片的平面感。閉合薄層使用正面繪制，避免前后表面重復加深。

Three.js 的外層 transmission 捕獲不包含其他 transmissive 網格。因此內構先在不透明捕獲序列中，以自定義 alpha 混合繪制到基板與細肋上，外蓋再折射已經合成的內構。它是實時薄層透明近似；沒有完整體積散射或多層路徑追蹤。基線燈光和外蓋清晰／磨砂參數未改變。

## 驗證

- `node --experimental-strip-types scripts/check-internal-optics.mjs`：通過。外殼頂點誤差 0、法線誤差 0；內構三角形幾何法線與著色法線最小點積 0.9997446，說明折邊未再次被平均成圓角。四種半透明材料與一條連接薄片檢查通過。
- `node --experimental-strip-types scripts/check-assembly.mjs`：通過；六組裝配與單體頂點最大差 1.688e-7，高度 3.70000005。
- `node --experimental-strip-types scripts/check-decryption.mjs`：通過；包含實際 GLB 的內構空間約束與材質連續切換綁定。
- `npm run build`：通過，保留既有包體大小提示。
- `reference/decryption-check.html`：8 項真實應用檢查通過，覆蓋解密、清晰／磨砂反向切換、拆解時切換、返回詳情及中途退出。
- 瀏覽器復核：無遮擋的斜視、連接處 1.6 倍放大、清晰裝配與磨砂裝配。外蓋透視正常，原片與模型仍有材質、比例及光照差異，最終效果待用戶查看。

## 對照

`reference/internal-review.html` 保留本輪打磨前與當前資產，可切換三種裝配顯示、三個角度及放大。兩邊共用相同燈光與視角。網格用于展示透明層次，僅存在于本地對照頁。打磨前資產為 `reference/internal-study/assembly-before.glb`；此前正式版本可從提交 89c7742 恢復。
e