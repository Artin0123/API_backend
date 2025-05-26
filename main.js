require('dotenv').config();
const express = require('express');
const cors = require('cors');
const UAParser = require('ua-parser-js');
const geoip = require('geoip-lite');
const requestIp = require('request-ip');
const { Pool, types } = require('pg');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
// 指示 pg 將 TIMESTAMP (OID 1114) 欄位值視為 UTC
// types.builtins.TIMESTAMP 是 TIMESTAMP without time zone 的 OID
types.setTypeParser(types.builtins.TIMESTAMP, (stringValue) => {
    // 檢查 stringValue 是否已經包含 'Z' 或時區偏移，以避免重複添加
    if (stringValue.endsWith('Z') || /[\+\-]\d{2}:\d{2}$/.test(stringValue) || /[\+\-]\d{4}$/.test(stringValue)) {
        return new Date(stringValue);
    }
    return new Date(stringValue + 'Z'); // 附加 'Z' 表示這是 UTC 時間
});
const app = express();
// 修改連接埠設定，使用 Render 提供的 PORT 環境變數
const PORT = process.env.PORT || 3000;
// 輔助函數：讀取 HTML 檔案
function readHTMLFile(filename) {
    try {
        return fs.readFileSync(path.join(__dirname, 'views', filename), 'utf8');
    } catch (error) {
        console.error(`讀取 HTML 檔案錯誤 (${filename}):`, error);
        return '<h1>檔案讀取錯誤</h1>';
    }
}
// 簡單的速率限制
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW = 60000; // 1分鐘
const RATE_LIMIT_MAX_REQUESTS = 100; // 每分鐘最多100次請求
function rateLimit(req, res, next) {
    const clientIP = req.ip || req.connection.remoteAddress;
    const now = Date.now();
    if (!rateLimitMap.has(clientIP)) {
        rateLimitMap.set(clientIP, { count: 1, resetTime: now + RATE_LIMIT_WINDOW });
        return next();
    }
    const clientData = rateLimitMap.get(clientIP);
    if (now > clientData.resetTime) {
        clientData.count = 1;
        clientData.resetTime = now + RATE_LIMIT_WINDOW;
        return next();
    }
    if (clientData.count >= RATE_LIMIT_MAX_REQUESTS) {
        return res.status(429).json({ error: 'Too many requests' });
    }
    clientData.count++;
    next();
}
// 簡單的管理介面保護
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || crypto.randomBytes(32).toString('hex');
console.log(`🔑 管理介面訪問令牌: ${ADMIN_TOKEN}`);
function requireAuth(req, res, next) {
    const token = req.query.token || req.headers['authorization']?.replace('Bearer ', '');
    if (token !== ADMIN_TOKEN) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
}
// 中間件
app.use(cors({
    origin: function (origin, callback) {
        // 允許同源請求和特定域名
        const allowedOrigins = [
            'http://localhost:3000',
            'http://127.0.0.1:3000',
            // 添加您的域名
        ];
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            callback(null, true); // 暫時允許所有，生產環境應該限制
        }
    },
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    credentials: false
}));
app.use(requestIp.mw());
app.use(express.json({ limit: '1mb' })); // 限制請求大小
app.use(rateLimit); // 應用速率限制
// 提供靜態檔案服務
app.use(express.static('public'));
// 初始化 PostgreSQL 連接池
// 修改資料庫連接設定
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});
// 創建訪客分析表格
async function initializeDatabase() {
    try {
        // 訪客記錄表
        await pool.query(`CREATE TABLE IF NOT EXISTS visitors (
            id SERIAL PRIMARY KEY,
            visitor_number INTEGER UNIQUE NOT NULL,
            -- IP位址與地理位置
            ip_address TEXT NOT NULL,
            country TEXT,
            city TEXT,
            -- 時區與時間
            timezone TEXT,
            utc_offset INTEGER,
            -- User Agent 資訊
            browser_name TEXT,
            browser_version TEXT,
            os_name TEXT,
            os_version TEXT,
            device_type TEXT,
            device_vendor TEXT,
            -- 語言設定
            navigator_language TEXT,
            -- 字體資訊
            fonts_available TEXT,
            -- 螢幕與顯示
            screen_width INTEGER,
            screen_height INTEGER,
            screen_color_depth INTEGER,
            device_pixel_ratio REAL,
            -- 硬體資訊
            hardware_concurrency INTEGER,
            -- 其他瀏覽器特徵
            cookie_enabled BOOLEAN,
            max_touch_points INTEGER,
            -- 網路資訊
            connection_type TEXT,
            connection_effective_type TEXT,
            connection_rtt INTEGER,
            -- 來源類型
            source_type TEXT DEFAULT 'GET',
            -- 時間戳
            last_visit TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            visit_count INTEGER DEFAULT 1
        )`);
        // 創建索引
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_visitor_number ON visitors (visitor_number)`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_ip ON visitors (ip_address)`);
        console.log('✅ 資料庫表格初始化完成');
    } catch (error) {
        console.error('❌ 資料庫初始化錯誤:', error);
    }
}
// 初始化資料庫
initializeDatabase();
// 取得真實 IP 地址
function getRealIP(req) {
    // 檢查常見的代理標頭
    const ip = req.headers['x-forwarded-for'] ||
        req.headers['x-real-ip'] ||
        req.connection?.remoteAddress ||
        requestIp.getClientIp(req);
    if (!ip) return null;
    // 處理多個 IP 的情況（取第一個）
    const firstIP = ip.split(',')[0].trim();
    // 處理 IPv4-mapped IPv6 地址
    if (firstIP.startsWith('::ffff:')) {
        return firstIP.substring(7);
    }
    return firstIP;
}
// 生成訪客識別碼
function generateVisitorKey(clientData) {
    const ip = clientData.ip_address || 'unknown';
    const sourceType = clientData.source_type || 'GET';
    // 使用 IP + 來源類型生成唯一識別碼
    return crypto.createHash('sha256')
        .update(`${ip}|${sourceType}`)
        .digest('hex')
        .substring(0, 16);
}
// 獲取下一個訪客編號
async function getNextVisitorNumber() {
    try {
        const result = await pool.query('SELECT MAX(visitor_number) as max_number FROM visitors');
        const maxNumber = result.rows[0]?.max_number;
        return maxNumber ? maxNumber + 1 : 1;
    } catch (error) {
        throw error;
    }
}
// 解析客戶端資訊
function parseClientInfo(req, clientData = {}) {
    const userAgent = req.headers['user-agent'] || '';
    const parser = new UAParser(userAgent);
    const result = parser.getResult();
    const ip = getRealIP(req);
    const geo = geoip.lookup(ip) || {};
    const isGET = (clientData.source_type === 'GET');
    // 時區處理：GET 請求顯示 " - "
    let timezone = isGET ? ' - ' : 'Unknown';
    if (!isGET && clientData.timezone && clientData.timezone !== 'Unknown') {
        timezone = clientData.timezone;
    }
    // 語言處理：GET 可以從 Accept-Language 標頭獲取
    let language = 'Unknown';
    if (!isGET && clientData.navigator_language && clientData.navigator_language !== 'Unknown') {
        language = clientData.navigator_language;
    } else if (isGET && req.headers['accept-language']) {
        const acceptLang = req.headers['accept-language'];
        language = acceptLang.split(',')[0].split(';')[0].trim();
    }
    // Cookie 檢測 - GET 請求顯示 " - "
    let cookieEnabled = false;
    if (!isGET && clientData.cookie_enabled !== undefined) {
        cookieEnabled = clientData.cookie_enabled;
    }
    // UTC offset 處理
    let utcOffset = new Date().getTimezoneOffset();
    if (!isGET && clientData.utc_offset !== undefined) {
        utcOffset = clientData.utc_offset;
    }
    // 網路類型處理 - Unknown 改為 " - "
    let connectionType = isGET ? ' - ' : (clientData.connection_type || ' - ');
    let connectionEffectiveType = isGET ? ' - ' : (clientData.connection_effective_type || ' - ');
    let connectionRtt = isGET ? 0 : (clientData.connection_rtt || 0);
    if (connectionType === 'Unknown') connectionType = ' - ';
    if (connectionEffectiveType === 'Unknown') connectionEffectiveType = ' - ';
    return {
        // IP位址與地理位置
        ip_address: ip,
        country: geo.country || 'Unknown',
        region: geo.region || 'Unknown',
        city: geo.city || 'Unknown',
        // 時區與時間
        timezone: timezone,
        utc_offset: utcOffset,
        // User Agent 資訊
        user_agent: userAgent,
        browser_name: result.browser.name || 'Unknown',
        browser_version: result.browser.version || 'Unknown',
        os_name: result.os.name || 'Unknown',
        os_version: result.os.version || 'Unknown',
        device_type: result.device.type || 'desktop',
        device_vendor: result.device.vendor || 'Unknown',
        // 語言設定
        navigator_language: language,
        // 字體資訊
        fonts_available: isGET ? 'Unknown' : (clientData.fonts_available || 'Unknown'),
        // 螢幕與顯示
        screen_width: isGET ? 0 : (clientData.screen_width || 0),
        screen_height: isGET ? 0 : (clientData.screen_height || 0),
        screen_color_depth: isGET ? 0 : (clientData.screen_color_depth || 0),
        device_pixel_ratio: isGET ? 1 : (clientData.device_pixel_ratio || 1),
        // 硬體資訊
        hardware_concurrency: isGET ? 0 : (clientData.hardware_concurrency || 0),
        // 其他瀏覽器特徵
        cookie_enabled: cookieEnabled,
        max_touch_points: isGET ? 0 : (clientData.max_touch_points || 0),
        // 網路資訊
        connection_type: connectionType,
        connection_effective_type: connectionEffectiveType,
        connection_rtt: connectionRtt,
        // 來源類型
        source_type: clientData.source_type || 'GET',
        // 頁面資訊
        page_url: clientData.page_url || req.headers.referer || 'Unknown',
        page_title: clientData.page_title || 'Unknown',
        referrer: req.headers.referer || 'Direct'
    };
}
// GET 資源端點 (偽裝成圖片)
app.get('/assets/pixel.png', async (req, res) => {
    try {
        res.set({
            'Content-Type': 'image/png',
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0'
        });
        const clientInfo = parseClientInfo(req, { ...req.query, source_type: 'GET' });
        const visitorKey = generateVisitorKey(clientInfo);
        // 檢查訪客是否已存在
        try {
            const existingVisitor = await pool.query(
                'SELECT * FROM visitors WHERE ip_address = $1 AND source_type = $2 LIMIT 1',
                [clientInfo.ip_address, clientInfo.source_type]
            );
            if (existingVisitor.rows.length > 0) {
                // 更新現有訪客
                await pool.query(`UPDATE visitors SET 
                    last_visit = CURRENT_TIMESTAMP,
                    visit_count = visit_count + 1
                    WHERE visitor_number = $1`, [existingVisitor.rows[0].visitor_number]);
            } else {
                // 新訪客 - 獲取下一個訪客編號
                const visitorNumber = await getNextVisitorNumber();
                const insertSQL = `INSERT INTO visitors (
                    visitor_number, ip_address, country, city, timezone, utc_offset,
                    browser_name, browser_version, os_name, os_version, device_type, device_vendor,
                    navigator_language, fonts_available, screen_width, screen_height, screen_color_depth, device_pixel_ratio,
                    hardware_concurrency, cookie_enabled, max_touch_points,
                    connection_type, connection_effective_type, connection_rtt, source_type
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25)`;
                const values = [
                    visitorNumber, clientInfo.ip_address, clientInfo.country, clientInfo.city,
                    clientInfo.timezone, clientInfo.utc_offset,
                    clientInfo.browser_name, clientInfo.browser_version,
                    clientInfo.os_name, clientInfo.os_version, clientInfo.device_type, clientInfo.device_vendor,
                    clientInfo.navigator_language, clientInfo.fonts_available,
                    clientInfo.screen_width, clientInfo.screen_height, clientInfo.screen_color_depth, clientInfo.device_pixel_ratio,
                    clientInfo.hardware_concurrency, clientInfo.cookie_enabled, clientInfo.max_touch_points,
                    clientInfo.connection_type, clientInfo.connection_effective_type, clientInfo.connection_rtt, clientInfo.source_type
                ];
                await pool.query(insertSQL, values);
            }
        } catch (error) {
            console.error('資料庫操作錯誤:', error);
        }
        console.log(`✅ 訪客記錄: ${visitorKey.substring(0, 8)}... - ${clientInfo.ip_address} - ${clientInfo.browser_name}`);
        // 返回 1x1 透明圖片
        res.send(Buffer.from([
            0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
            0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
            0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
            0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4,
            0x89, 0x00, 0x00, 0x00, 0x0B, 0x49, 0x44, 0x41,
            0x54, 0x78, 0x9C, 0x63, 0x00, 0x01, 0x00, 0x00,
            0x05, 0x00, 0x01, 0x0D, 0x0A, 0x2D, 0xB4, 0x00,
            0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE,
            0x42, 0x60, 0x82
        ]));
    } catch (error) {
        console.error('處理錯誤:', error);
        res.status(500).send('Error');
    }
});
// POST 數據收集端點
app.post('/api/collect', async (req, res) => {
    try {
        res.set({
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0'
        });
        const clientInfo = parseClientInfo(req, { ...req.body, source_type: 'POST' });
        // 檢查訪客是否已存在
        try {
            const existingVisitor = await pool.query(
                'SELECT * FROM visitors WHERE ip_address = $1 AND source_type = $2',
                [clientInfo.ip_address, clientInfo.source_type]
            );
            if (existingVisitor.rows.length > 0) {
                // 更新現有訪客
                await pool.query(`UPDATE visitors SET 
                    last_visit = CURRENT_TIMESTAMP,
                    visit_count = visit_count + 1
                    WHERE visitor_number = $1`, [existingVisitor.rows[0].visitor_number]);
                console.log(`✅ 訪客資料已更新: 訪客編號 ${existingVisitor.rows[0].visitor_number} - ${clientInfo.ip_address} - ${clientInfo.browser_name}`);
                res.json({
                    success: true,
                    visitor_id: existingVisitor.rows[0].visitor_number,
                    message: '數據已更新'
                });
            } else {
                // 新訪客 - 獲取下一個訪客編號
                const visitorNumber = await getNextVisitorNumber();
                const insertSQL = `INSERT INTO visitors (
                    visitor_number, ip_address, country, city, timezone, utc_offset,
                    browser_name, browser_version, os_name, os_version, device_type, device_vendor,
                    navigator_language, fonts_available, screen_width, screen_height, screen_color_depth, device_pixel_ratio,
                    hardware_concurrency, cookie_enabled, max_touch_points,
                    connection_type, connection_effective_type, connection_rtt, source_type
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25)`;
                const values = [
                    visitorNumber, clientInfo.ip_address, clientInfo.country, clientInfo.city,
                    clientInfo.timezone, clientInfo.utc_offset,
                    clientInfo.browser_name, clientInfo.browser_version,
                    clientInfo.os_name, clientInfo.os_version, clientInfo.device_type, clientInfo.device_vendor,
                    clientInfo.navigator_language, clientInfo.fonts_available,
                    clientInfo.screen_width, clientInfo.screen_height, clientInfo.screen_color_depth, clientInfo.device_pixel_ratio,
                    clientInfo.hardware_concurrency, clientInfo.cookie_enabled, clientInfo.max_touch_points,
                    clientInfo.connection_type, clientInfo.connection_effective_type, clientInfo.connection_rtt, clientInfo.source_type
                ];
                await pool.query(insertSQL, values);
                console.log(`✅ 新訪客已記錄: 訪客編號 ${visitorNumber} - ${clientInfo.ip_address} - ${clientInfo.browser_name}`);
                res.json({
                    success: true,
                    visitor_id: visitorNumber,
                    message: '數據已記錄'
                });
            }
        } catch (error) {
            console.error('資料庫操作錯誤:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    } catch (error) {
        console.error('處理錯誤:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
// OPTIONS 預檢請求處理
app.options('/api/collect', (req, res) => {
    res.set({
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.status(200).end();
});
// 訪客數據 API (需要認證)
app.get('/api/visitors', requireAuth, async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 50;
        const offset = parseInt(req.query.offset) || 0;
        const result = await pool.query(
            `SELECT * FROM visitors ORDER BY last_visit DESC LIMIT $1 OFFSET $2`,
            [limit, offset]
        );
        res.json({
            success: true,
            data: result.rows,
            count: result.rows.length,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('查詢訪客數據錯誤:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
// POST 測試頁面
app.get('/test/analytics', (req, res) => {
    res.send(readHTMLFile('test-analytics.html'));
});
// 調試端點：GET 請求的 JSON 格式
app.get('/api/analytics', (req, res) => {
    try {
        const clientInfo = parseClientInfo(req, { ...req.query, source_type: 'GET' });
        const visitorKey = generateVisitorKey(clientInfo);
        res.json({
            success: true,
            request_type: 'GET',
            visitor_key: visitorKey,
            timestamp: new Date().toISOString(),
            client_info: clientInfo,
            raw_headers: req.headers,
            query_params: req.query,
            note: '這是 GET 請求可以獲取的所有資訊'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});
// 調試端點：POST 請求的 JSON 格式
app.post('/api/analytics', (req, res) => {
    try {
        // 設置 CORS 標頭
        res.set({
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type'
        });
        const clientInfo = parseClientInfo(req, { ...req.body, source_type: 'POST' });
        const visitorKey = generateVisitorKey(clientInfo);
        res.json({
            success: true,
            request_type: 'POST',
            visitor_key: visitorKey,
            timestamp: new Date().toISOString(),
            client_info: clientInfo,
            raw_headers: req.headers,
            body_data: req.body,
            note: '這是 POST 請求可以獲取的所有資訊'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});
// OPTIONS 預檢請求處理 - 為調試端點
app.options('/api/analytics', (req, res) => {
    res.set({
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.status(200).end();
});
// 登入頁面
app.get('/', (req, res) => {
    const token = req.query.token;
    if (token === ADMIN_TOKEN) {
        // 重定向到管理介面
        return res.redirect('/admin?token=' + encodeURIComponent(token));
    }
    res.send(readHTMLFile('login.html'));
});
// 管理介面 (需要認證)
app.get('/admin', requireAuth, (req, res) => {
    res.send(readHTMLFile('admin.html'));
});
// 啟動伺服器
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 伺服器已啟動在連接埠 ${PORT}`);
    console.log(`🌐 訪問地址: http://localhost:${PORT}`);
    console.log(`🖼️  像素端點: http://localhost:${PORT}/assets/pixel.png`);
    console.log(`📊 管理介面: http://localhost:${PORT}/?token=${ADMIN_TOKEN}`);
    console.log(`🧪 測試頁面:`);
    console.log(`   - 分析測試: http://localhost:${PORT}/api/analytics`);
    console.log(`   - 收集測試: http://localhost:${PORT}/test/analytics`);
});