# 香港智慧城市地圖

打開就是一幅可拖動的香港地圖。地圖上有港鐵網絡和運輸署交通快拍點。

- 點一個車站，查看該站即將到站的班次。
- 點一個橙色快拍點，查看該處最新照片。
- 沒有班次、查不到資料或照片載入失敗時，側欄會寫明原因。

底圖使用 [OpenFreeMap](https://openfreemap.org/) 的公開服務，不用 API 金鑰。到站資料來自港鐵實時列車服務資訊，快拍照片和位置來自運輸署。車站座標來自 OpenStreetMap，路綫按官方站序以直線連接，不是真實軌道。

## 本地預覽

```bash
npm install
npm run dev
```

開發伺服器位址是 http://localhost:4317 。

## 正式發佈

驗收之後才發佈到 Cloudflare Workers 免費方案，使用帳戶自帶的 `workers.dev` 網址。靜態檔案不計入每日請求次數，這個網站不執行 Worker 程式。

```bash
npm run build
npx wrangler deploy
```

部署時要登入你自己的 Cloudflare 免費帳戶。不使用自訂網域、KV 或 R2。按課堂用量，預計費用是 0 港元。

若要更新車站座標，執行 `node scripts/build-network.mjs`。這一步會讀取港鐵車站表和 OpenStreetMap。
