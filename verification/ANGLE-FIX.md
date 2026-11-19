# 側邊角度條紋修復

基線：`ca578332ebe35107740e94d2406f208ed4624c03`，標簽 `baseline-2026-09-08`。本地完整快照保存在 `backups/render-baseline-20260908-021308`。

標注位置對應 Amber_Lightguide。導光條前表面僅比透明蓋板前表面靠前 0.002 世界單位，原有遠距離透視鏡頭在部分角度下無法穩定區分深度，形成斜向條紋。以 -0.8 弧度穩定復現。

僅給 Amber_Lightguide 材質添加 polygonOffset，factor=-1、units=-2。模型 GLB 與基線 SHA256 相同；相機、裁剪面、燈光、AO、顏色、透射與動效均未改變。

驗證：

- 實際場景在 -0.8、-0.45、0、+0.8 弧度對照；標注側條的斜紋消失，螺釘和標簽的遮擋正常。
- 關閉 AO 后基線問題仍存在；臨時提高近裁剪面能消除問題但改變 AO 層次，因此最終只修正局部材質。
- 切換檔案并歸位時，當前和舊卡片都保留同一深度偏移，舊卡片仍先轉正再下降。
- `node scripts/check-appearance.mjs`、`node scripts/check-motion.mjs`、`npm run build` 通過。

本地復核頁面（開發服務）：

- 修復前：`/reference/detail-transition.html?t=5&angle=-0.8&sharp=1&close=1&offset=0`
- 修復后：`/reference/detail-transition.html?t=5&angle=-0.8&sharp=1&close=1`

`sharp` 僅在驗證頁關閉景深以方便觀察，產品仍使用原有景深。
t