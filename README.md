# 網站分析系統 - 基於 PostgreSQL 版本

這是一個使用 PostgreSQL 作為資料庫的網站分析系統。

## ✨ 核心特色

- **🛡️ 防偽造機制**：基於瀏覽器指紋識別訪客
- **🔄 去重處理**：同一訪客不會重複計算
- **⚡ 頻率限制**：防止快速刷新偽造訪問
- **🔒 隱私保護**：IP 地址雜湊處理，無法還原

### 資料處理原則
- 僅收集技術性資訊，不涉及個人隱私
- IP 地址經過不可逆雜湊處理
- 不使用 Cookie 或本地存儲
- 所有資料僅用於統計分析
- 超過限制的請求會被標記為疑似機器人

## 📋 收集的資訊

### 🌍 地理位置資訊
- IP 地址（雜湊處理）
- 國家、城市

### 🖥️ 瀏覽器資訊
- 瀏覽器名稱和版本
- 語言設定

### 💻 作業系統資訊
- 作業系統名稱和版本
- CPU 架構

### 📱 設備資訊
- 設備類型（桌面/手機）
- 螢幕解析度
- 色彩深度
- 時區

### 🌐 網路資訊
- 連接類型
- 網路品質

## 環境設置

### 1. 安裝依賴
```bash
npm install
```

### 2. 設置環境變數
創建 `.env` 文件並設置以下變數：

```env
# PostgreSQL 資料庫連接字符串
# 格式: postgresql://username:password@hostname:port/database_name
# 範例 (Supabase): postgresql://postgres:your_password@db.your_project.supabase.co:5432/postgres
DATABASE_URL=postgresql://username:password@hostname:port/database_name

# 管理介面訪問令牌 (可選，如果不設置會自動生成)
ADMIN_TOKEN=your_admin_token_here
```

### 3. Supabase 設置範例
如果您使用 Supabase，連接字符串格式如下：
```env
DATABASE_URL=postgresql://postgres:your_password@db.your_project.supabase.co:5432/postgres
```

### 4. 啟動應用
```bash
npm start
```

## API 端點

- `GET /assets/pixel.png` - 像素追蹤端點
- `POST /api/collect` - 數據收集端點
- `GET /api/visitors` - 訪客數據查詢 (需要認證)
- `GET /` - 管理介面登入頁面
- `GET /admin` - 管理介面 (需要認證)

## 注意事項

1. **必須設置 DATABASE_URL**：應用啟動前必須設置正確的 PostgreSQL 連接字符串
2. 確保 PostgreSQL 資料庫已經創建
3. 確保網路連接可以訪問資料庫
4. 如果使用 Supabase，確保 SSL 設置正確
5. 首次運行時會自動創建所需的表格和索引
