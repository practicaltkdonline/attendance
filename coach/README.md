# 教練課堂管理 - 第一版串接

## 檔案

| 檔案 | 說明 |
|------|------|
| `Code.gs` | Google Apps Script 後端（貼到試算表） |
| `index.html` | 前端 PWA 介面 |
| `app.js` | 前端邏輯與 API 呼叫 |

試算表：
https://docs.google.com/spreadsheets/d/1nyg52zH-qj2n9RxXtrIsaxWned6q8HCK58rR-yfKm1I

---

## 部署步驟（重要）

### 1. 安裝 Apps Script

1. 打開上述 Google 試算表
2. **擴充功能 → Apps Script**
3. 刪除預設 `Code.gs` 內容，貼上本資料夾的 `Code.gs`
4. 儲存（Ctrl/Cmd + S）

### 2. 部署為網頁應用程式

1. 右上角 **部署 → 新增部署作業**
2. 類型選擇 **網頁應用程式**
3. 設定：
   - 說明：課堂管理 API
   - 執行身分：**我**
   - 具有存取權的使用者：**任何人**
4. 按 **部署**
5. 授權存取（用你的 Google 帳號）
6. **複製「網頁應用程式網址」**（類似 `https://script.google.com/macros/s/xxxxx/exec`）

### 3. 設定前端

打開 `app.js`，把第一行的 `API_URL` 改成你剛複製的網址：

```js
const API_URL = 'https://script.google.com/macros/s/你的部署ID/exec';
```

### 4. 開啟前端

用 VS Code Live Server 或任何靜態伺服器開啟 `index.html`。

（正式之後可放到 GitHub Pages / 你的網域）

---

## API 一覽

| action | 說明 |
|--------|------|
| ping | 測試連線 |
| getClassesByDate | 某日課堂（拆堂+已安排補堂） |
| getStudentStats | 學生已上/剩餘 |
| saveAttendance | 寫入點名 |
| saveClassLog | 寫入課堂 Log |
| getPendingMakeups | 待補列表 |
| createMakeups | 請假→產生待補 |
| arrangeMakeup | 安排補堂時間 |

---

## 工作表對應

- 拆堂表（唯讀）
- 點名紀錄（寫入）
- 課堂Log（寫入，唯一鍵用整堂 key）
- 補堂紀錄（寫入）
- 學生總覽（讀取總堂數）

唯一鍵格式：`姓名_YYYYMMDD_開始結束_道場`  
整堂 key：`YYYYMMDD_開始結束_道場`
