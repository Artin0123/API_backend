require('dotenv').config();
const express = require('express');
const cors = require('cors');
const UAParser = require('ua-parser-js');
const geoip = require('geoip-lite');
const requestIp = require('request-ip');
const { Pool } = require('pg');
const crypto = require('crypto');
const app = express();
const PORT = 3000;
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
// 初始化 PostgreSQL 連接池
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false } // 一定要加，Supabase 需要 SSL
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
            local_time TIMESTAMP,
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
    // 本地時間處理
    let localTime = new Date().toISOString();
    let utcOffset = new Date().getTimezoneOffset();
    if (!isGET && clientData.local_time && clientData.utc_offset !== undefined) {
        localTime = clientData.local_time;
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
        local_time: localTime,
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
                    visitor_number, ip_address, country, city, timezone, local_time, utc_offset,
                    browser_name, browser_version, os_name, os_version, device_type, device_vendor,
                    navigator_language, fonts_available, screen_width, screen_height, screen_color_depth, device_pixel_ratio,
                    hardware_concurrency, cookie_enabled, max_touch_points,
                    connection_type, connection_effective_type, connection_rtt, source_type
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26)`;
                const values = [
                    visitorNumber, clientInfo.ip_address, clientInfo.country, clientInfo.city,
                    clientInfo.timezone, clientInfo.local_time, clientInfo.utc_offset,
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
                    visitor_number, ip_address, country, city, timezone, local_time, utc_offset,
                    browser_name, browser_version, os_name, os_version, device_type, device_vendor,
                    navigator_language, fonts_available, screen_width, screen_height, screen_color_depth, device_pixel_ratio,
                    hardware_concurrency, cookie_enabled, max_touch_points,
                    connection_type, connection_effective_type, connection_rtt, source_type
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26)`;
                const values = [
                    visitorNumber, clientInfo.ip_address, clientInfo.country, clientInfo.city,
                    clientInfo.timezone, clientInfo.local_time, clientInfo.utc_offset,
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
    res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <title>分析測試</title>
        <meta charset="UTF-8">
        <style>
            body { font-family: 'Microsoft JhengHei', Arial, sans-serif; margin: 20px; background: #f5f7fa; }
            .container { max-width: 1200px; margin: 0 auto; }
            .header { background: #28a745; color: white; padding: 20px; border-radius: 10px; text-align: center; margin-bottom: 20px; }
            .section { background: white; padding: 20px; border-radius: 10px; margin: 20px 0; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
            .btn { background: #28a745; color: white; padding: 10px 20px; border: none; border-radius: 5px; cursor: pointer; margin: 10px 5px; }
            .btn:hover { background: #218838; }
            .result { background: #f8f9fa; padding: 15px; border-radius: 5px; margin-top: 15px; white-space: pre-wrap; font-family: monospace; font-size: 12px; max-height: 500px; overflow-y: auto; }
            .loading { color: #007bff; }
            .error { color: #dc3545; }
            .success { color: #28a745; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>🔍 分析測試頁面</h1>
                <p>測試數據收集功能</p>
            </div>
            <div class="section">
                <h3>📡 發送數據到收集端點</h3>
                <button class="btn" onclick="testAnalytics()">🧪 測試分析收集</button>
                <button class="btn" onclick="testCollect()">📊 測試數據收集</button>
                <button class="btn" onclick="clearResults()">🗑️ 清除結果</button>
                <div id="result" class="result">點擊按鈕開始測試...</div>
            </div>
        </div>
        <script>
            function clearResults() {
                document.getElementById('result').textContent = '點擊按鈕開始測試...';
            }
            function showLoading(message) {
                document.getElementById('result').innerHTML = '<span class="loading">' + message + '</span>';
            }
            function showResult(data, isError = false) {
                const resultDiv = document.getElementById('result');
                const className = isError ? 'error' : 'success';
                resultDiv.innerHTML = '<span class="' + className + '">' + JSON.stringify(data, null, 2) + '</span>';
            }
            // 收集瀏覽器資訊
            function collectBrowserInfo() {
                return {
                    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                    navigator_language: navigator.language,
                    screen_width: screen.width,
                    screen_height: screen.height,
                    screen_color_depth: screen.colorDepth,
                    device_pixel_ratio: window.devicePixelRatio,
                    hardware_concurrency: navigator.hardwareConcurrency,
                    cookie_enabled: navigator.cookieEnabled,
                    max_touch_points: navigator.maxTouchPoints || 0,
                    local_time: new Date().toISOString(),
                    utc_offset: new Date().getTimezoneOffset(),
                    fonts_available: 'Arial,Times New Roman,Helvetica,Georgia,Verdana,Tahoma,Trebuchet MS,Comic Sans MS,Impact,Lucida Console',
                    connection_type: navigator.connection?.type || 'Unknown',
                    connection_effective_type: navigator.connection?.effectiveType || 'Unknown',
                    connection_rtt: navigator.connection?.rtt || 0,
                    page_url: window.location.href,
                    page_title: document.title
                };
            }
            async function testAnalytics() {
                showLoading('🔄 正在發送數據到 /api/analytics...');
                try {
                    const browserInfo = collectBrowserInfo();
                    const response = await fetch('/api/analytics', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify(browserInfo)
                    });
                    if (!response.ok) {
                        throw new Error(\`HTTP \${response.status}: \${response.statusText}\`);
                    }
                    const data = await response.json();
                    showResult(data);
                } catch (error) {
                    showResult({
                        error: true,
                        message: error.message,
                        timestamp: new Date().toISOString()
                    }, true);
                }
            }
            async function testCollect() {
                showLoading('🔄 正在發送數據到 /api/collect...');
                try {
                    const browserInfo = collectBrowserInfo();
                    const response = await fetch('/api/collect', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify(browserInfo)
                    });
                    if (!response.ok) {
                        throw new Error(\`HTTP \${response.status}: \${response.statusText}\`);
                    }
                    const data = await response.json();
                    showResult(data);
                } catch (error) {
                    showResult({
                        error: true,
                        message: error.message,
                        timestamp: new Date().toISOString()
                    }, true);
                }
            }
        </script>
    </body>
    </html>
    `);
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
    res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <title>網站分析系統</title>
        <meta charset="UTF-8">
        <style>
            body { font-family: 'Microsoft JhengHei', Arial, sans-serif; margin: 0; background: #f5f7fa; display: flex; justify-content: center; align-items: center; min-height: 100vh; }
            .login-container { background: white; padding: 40px; border-radius: 15px; box-shadow: 0 4px 15px rgba(0,0,0,0.1); text-align: center; max-width: 400px; }
            .header { color: #667eea; margin-bottom: 30px; }
            .input-group { margin: 20px 0; }
            .input-group input { width: 100%; padding: 12px; border: 2px solid #e9ecef; border-radius: 8px; font-size: 16px; }
            .btn { background: #667eea; color: white; padding: 12px 30px; border: none; border-radius: 8px; cursor: pointer; font-size: 16px; width: 100%; }
            .btn:hover { background: #5a6fd8; }
            .error { color: #dc3545; margin-top: 15px; }
        </style>
    </head>
    <body>
        <div class="login-container">
            <div class="header">
                <h1>📊 網站分析系統</h1>
                <p>請輸入訪問令牌</p>
            </div>
            <form onsubmit="login(event)">
                <div class="input-group">
                    <input type="password" id="token" placeholder="訪問令牌" required>
                </div>
                <button type="submit" class="btn">登入</button>
            </form>
            <div id="error" class="error"></div>
        </div>
        <script>
            function login(event) {
                event.preventDefault();
                const token = document.getElementById('token').value;
                if (token) {
                    window.location.href = '/?token=' + encodeURIComponent(token);
                } else {
                    document.getElementById('error').textContent = '請輸入訪問令牌';
                }
            }
        </script>
    </body>
    </html>
    `);
});
// 管理介面 (需要認證)
app.get('/admin', requireAuth, (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <title>網站分析系統</title>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
            body { font-family: 'Microsoft JhengHei', Arial, sans-serif; margin: 20px; background: #f5f7fa; }
            .container { max-width: 1800px; margin: 0 auto; }
            .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; border-radius: 15px; margin-bottom: 30px; text-align: center; }
            .section { background: white; margin: 20px 0; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.1); }
            .section-header { background: #667eea; color: white; padding: 20px; font-size: 1.2em; font-weight: bold; }
            .section-content { padding: 20px; }
            table { width: 100%; border-collapse: collapse; margin-top: 15px; font-size: 11px; }
            th, td { 
                padding: 8px; 
                text-align: left; 
                border-bottom: 1px solid #eee; 
                max-width: 300px; 
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
            th { 
                background: #f8f9fa; 
                font-weight: bold; 
                position: sticky; 
                top: 0;
            }
            tr:hover { background: #f8f9fa; }
            .visitor-number { font-family: monospace; background: #e9ecef; padding: 4px 8px; border-radius: 4px; font-size: 0.85em; font-weight: bold; }
            td[title] { cursor: help; }
            .btn { background: #667eea; color: white; padding: 10px 20px; border: none; border-radius: 6px; cursor: pointer; margin: 5px; }
            .btn:hover { background: #5a6fd8; }
            .overflow-scroll { overflow-x: auto; max-height: 600px; }
            .source-get { background: #ffc107; color: white; padding: 2px 6px; border-radius: 3px; font-size: 0.8em; }
            .source-post { background: #28a745; color: white; padding: 2px 6px; border-radius: 3px; font-size: 0.8em; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>📊 網站分析系統</h1>
                <p>訪客行為分析與統計</p>
            </div>
            <div class="section">
                <div class="section-header">
                    <span>👥 訪客數據分析</span>
                    <button class="btn" onclick="loadVisitors()">🔄 重新載入</button>
                    <button class="btn" onclick="testPixel()">🧪 測試像素</button>
                </div>
                <div class="section-content">
                    <div class="overflow-scroll">
                        <table id="visitors-table">
                            <thead>
                                <tr>
                                    <th>訪客編號</th>
                                    <th>IPv4 地址</th>
                                    <th>國家 / 城市</th>
                                    <th>時區</th>
                                    <th>瀏覽器</th>
                                    <th>作業系統</th>
                                    <th>設備</th>
                                    <th>螢幕解析度</th>
                                    <th>語言</th>
                                    <th>可用字體</th>
                                    <th>色彩深度</th>
                                    <th>CPU執行緒</th>
                                    <th>Cookie啟用</th>
                                    <th>觸控點數</th>
                                    <th>本地時間</th>
                                    <th>網路類型</th>
                                    <th>網路效能</th>
                                    <th>網路延遲</th>
                                    <th>來源</th>
                                    <th>訪問次數</th>
                                    <th>最後訪問</th>
                                </tr>
                            </thead>
                            <tbody id="visitors-tbody">
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
        <script>
            // 輔助函數：截斷文字並添加省略號
            function truncateText(text, maxLength) {
                if (!text || text === 'Unknown' || text === ' - ') return text;
                return text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
            }
            // 格式化時間為 GMT+8
            function formatTimeGMT8(dateString) {
                if (!dateString) return 'Unknown';
                try {
                    const date = new Date(dateString);
                    // 加8小時轉換為 GMT+8
                    const gmt8Date = new Date(date.getTime() + (8 * 60 * 60 * 1000));
                    const year = gmt8Date.getFullYear();
                    const month = gmt8Date.getMonth() + 1;
                    const day = gmt8Date.getDate();
                    const hours = gmt8Date.getHours();
                    const minutes = gmt8Date.getMinutes().toString().padStart(2, '0');
                    const seconds = gmt8Date.getSeconds().toString().padStart(2, '0');
                    const period = hours >= 12 ? '下午' : '上午';
                    const displayHours = hours === 0 ? 12 : (hours > 12 ? hours - 12 : hours);
                    return \`\${year}/\${month}/\${day} \${period}\${displayHours}:\${minutes}:\${seconds}\`;
                } catch (e) {
                    return 'Invalid Date';
                }
            }
            async function loadVisitors() {
                try {
                    const token = new URLSearchParams(window.location.search).get('token');
                    const response = await fetch('/api/visitors?limit=100&token=' + encodeURIComponent(token));
                    const data = await response.json();
                    if (data.success) {
                        const tbody = document.getElementById('visitors-tbody');
                        tbody.innerHTML = '';
                        data.data.forEach(visitor => {
                            const row = tbody.insertRow();
                            // 判斷來源類型
                            const isGET = visitor.source_type === 'GET';
                            // 處理設備名稱，移除 "Unknown"
                            let deviceDisplay = visitor.device_type || '';
                            if (visitor.device_vendor && visitor.device_vendor !== 'Unknown') {
                                deviceDisplay += (deviceDisplay ? ' ' : '') + visitor.device_vendor;
                            }
                            deviceDisplay = deviceDisplay.replace(/\\s*Unknown/g, '').trim() || '未知';
                            // 計算實際螢幕解析度或顯示 " - "
                            let screenResolution = ' - ';
                            if (!isGET && visitor.screen_width && visitor.screen_height) {
                                const actualWidth = Math.round(visitor.screen_width * (visitor.device_pixel_ratio || 1));
                                const actualHeight = Math.round(visitor.screen_height * (visitor.device_pixel_ratio || 1));
                                const resolutionNote = (visitor.device_pixel_ratio && visitor.device_pixel_ratio !== 1) ? ' (可能有誤)' : '';
                                screenResolution = \`\${actualWidth}x\${actualHeight}\${resolutionNote}\`;
                            }
                            // 提取瀏覽器版本的主要版本號（第一個小數點之前）
                            const browserVersion = visitor.browser_version ? visitor.browser_version.split('.')[0] : '';
                            const browserDisplay = \`\${visitor.browser_name} \${browserVersion}\`;
                            // 計算實際本地時間或顯示 " - "
                            let localTime = ' - ';
                            if (!isGET && visitor.local_time && visitor.utc_offset !== null) {
                                try {
                                    const clientTime = new Date(visitor.local_time);
                                    // UTC offset 是分鐘，負數表示東時區
                                    // 例如：台灣 +8 時區的 offset 是 -480 分鐘
                                    const offsetMinutes = visitor.utc_offset || 0;
                                    // 計算實際本地時間：客戶端時間 - offset（因為 offset 是負數，所以實際是加上）
                                    const actualLocalTime = new Date(clientTime.getTime() - (offsetMinutes * 60000));
                                    // 再加 8 小時轉換為 GMT+8 顯示
                                    const gmt8Time = new Date(actualLocalTime.getTime() + (8 * 60 * 60 * 1000));
                                    localTime = formatTimeGMT8(gmt8Time.toISOString());
                                } catch (e) {
                                    localTime = '計算錯誤';
                                }
                            }
                            // 字體列表處理
                            let fontsDisplay = ' - ';
                            let fontsTitle = '';
                            if (!isGET && visitor.fonts_available && visitor.fonts_available !== 'Unknown') {
                                fontsTitle = visitor.fonts_available;
                                fontsDisplay = truncateText(visitor.fonts_available, 200);
                            }
                            // 其他欄位的顯示邏輯
                            const languageDisplay = visitor.navigator_language || '未知';
                            const colorDepthDisplay = isGET ? ' - ' : (visitor.screen_color_depth ? visitor.screen_color_depth + '位' : '未知');
                            const cpuDisplay = isGET ? ' - ' : (visitor.hardware_concurrency || '未知');
                            const cookieDisplay = isGET ? ' - ' : (visitor.cookie_enabled ? '✅' : '❌');
                            const touchDisplay = isGET ? ' - ' : (visitor.max_touch_points || '0');
                            // 網路類型顯示 - Unknown 改為 " - "
                            let networkTypeDisplay = isGET ? ' - ' : (visitor.connection_type || ' - ');
                            let networkEffectiveDisplay = isGET ? ' - ' : (visitor.connection_effective_type || ' - ');
                            let networkRttDisplay = isGET ? ' - ' : ((visitor.connection_rtt || 0) + 'ms');
                            if (networkTypeDisplay === 'Unknown') networkTypeDisplay = ' - ';
                            if (networkEffectiveDisplay === 'Unknown') networkEffectiveDisplay = ' - ';
                            // 時區和作業系統處理
                            const timezoneDisplay = isGET ? ' - ' : truncateText(visitor.timezone, 30);
                            const osDisplay = truncateText(\`\${visitor.os_name} \${visitor.os_version}\`, 25);
                            const countryDisplay = truncateText(\`\${visitor.country} / \${visitor.city}\`, 25);
                            row.innerHTML = \`
                                <td><span class="visitor-number">#\${visitor.visitor_number || visitor.id}</span></td>
                                <td>\${visitor.ip_address || '未知'}</td>
                                <td title="\${visitor.country}/\${visitor.city}">\${countryDisplay}</td>
                                <td title="\${visitor.timezone}">\${timezoneDisplay}</td>
                                <td title="\${browserDisplay}">\${truncateText(browserDisplay, 20)}</td>
                                <td title="\${visitor.os_name} \${visitor.os_version}">\${osDisplay}</td>
                                <td title="\${deviceDisplay}">\${truncateText(deviceDisplay, 15)}</td>
                                <td>\${screenResolution}</td>
                                <td>\${languageDisplay}</td>
                                <td title="\${fontsTitle}">\${fontsDisplay}</td>
                                <td>\${colorDepthDisplay}</td>
                                <td>\${cpuDisplay}</td>
                                <td>\${cookieDisplay}</td>
                                <td>\${touchDisplay}</td>
                                <td title="\${localTime}">\${truncateText(localTime, 20)}</td>
                                <td>\${networkTypeDisplay}</td>
                                <td>\${networkEffectiveDisplay}</td>
                                <td>\${networkRttDisplay}</td>
                                <td><span class="\${isGET ? 'source-get' : 'source-post'}">\${visitor.source_type || 'GET'}</span></td>
                                <td><strong>\${visitor.visit_count}</strong></td>
                                <td>\${formatTimeGMT8(visitor.last_visit)}</td>
                            \`;
                        });
                    }
                } catch (error) {
                    console.error('載入失敗:', error);
                }
            }
            // 測試像素功能
            function testPixel() {
                const img = new Image();
                img.onload = () => console.log('✅ 像素測試成功');
                img.onerror = () => console.log('❌ 像素測試失敗');
                // 添加時間戳避免快取
                img.src = '/assets/pixel.png?test=1&timestamp=' + Date.now();
                console.log('🧪 正在測試像素...');
            }
            // 初始載入
            loadVisitors();
            // 每30秒自動重新載入
            setInterval(loadVisitors, 30000);
        </script>
    </body>
    </html>
    `);
});
// 啟動伺服器
const server = app.listen(PORT, '::', () => {
    const address = server.address();
    console.log(`🚀 網站分析系統已啟動`);
    console.log(`📡 伺服器地址: ${address.address}:${address.port}`);
    console.log(`🌐 訪問地址: http://localhost:${PORT}`);
    console.log(`🖼️  像素端點: http://localhost:${PORT}/assets/pixel.png`);
    console.log(`📊 管理介面: http://localhost:${PORT}`);
    console.log(`🧪 測試頁面:`);
    console.log(`   - 分析測試: http://localhost:${PORT}/api/analytics`);
    console.log(`   - 收集測試: http://localhost:${PORT}/test/analytics`);
}); 