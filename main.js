
const express = require('express');
const cors = require('cors');
const UAParser = require('ua-parser-js');
const geoip = require('geoip-lite');
const requestIp = require('request-ip');
const { Pool } = require('pg');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

const ADMIN_TOKEN = process.env.ADMIN_TOKEN || crypto.randomBytes(32).toString('hex');
console.log(`🔑 管理介面訪問令牌: ${ADMIN_TOKEN}`);

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function initializeDatabase() {
    await pool.query(\`
        CREATE TABLE IF NOT EXISTS visitors (
            id SERIAL PRIMARY KEY,
            visitor_number INTEGER UNIQUE NOT NULL,
            ip_address TEXT NOT NULL,
            country TEXT,
            city TEXT,
            timezone TEXT,
            local_time TEXT,
            utc_offset INTEGER,
            browser_name TEXT,
            browser_version TEXT,
            os_name TEXT,
            os_version TEXT,
            device_type TEXT,
            device_vendor TEXT,
            navigator_language TEXT,
            fonts_available TEXT,
            screen_width INTEGER,
            screen_height INTEGER,
            screen_color_depth INTEGER,
            device_pixel_ratio REAL,
            hardware_concurrency INTEGER,
            cookie_enabled BOOLEAN,
            max_touch_points INTEGER,
            connection_type TEXT,
            connection_effective_type TEXT,
            connection_rtt INTEGER,
            source_type TEXT DEFAULT 'GET',
            last_visit TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            visit_count INTEGER DEFAULT 1
        );
    \`);
}
initializeDatabase();

app.use(cors());
app.use(requestIp.mw());
app.use(express.json());

function getRealIP(req) {
    const ip = req.headers['x-forwarded-for'] || req.connection?.remoteAddress || requestIp.getClientIp(req);
    return ip?.split(',')[0]?.replace('::ffff:', '') || 'Unknown';
}

function parseClientInfo(req, source = 'GET') {
    const ua = req.headers['user-agent'] || '';
    const parser = new UAParser(ua);
    const result = parser.getResult();
    const ip = getRealIP(req);
    const geo = geoip.lookup(ip) || {};
    return {
        ip_address: ip,
        country: geo.country || 'Unknown',
        city: geo.city || 'Unknown',
        browser_name: result.browser.name || 'Unknown',
        browser_version: result.browser.version || 'Unknown',
        os_name: result.os.name || 'Unknown',
        os_version: result.os.version || 'Unknown',
        device_type: result.device.type || 'desktop',
        device_vendor: result.device.vendor || 'Unknown',
        source_type: source
    };
}

async function getNextVisitorNumber() {
    const res = await pool.query('SELECT MAX(visitor_number) as max FROM visitors');
    return (res.rows[0].max || 0) + 1;
}

app.get('/assets/pixel.png', async (req, res) => {
    const info = parseClientInfo(req);
    const existing = await pool.query('SELECT * FROM visitors WHERE ip_address = $1 AND source_type = $2 LIMIT 1',
        [info.ip_address, info.source_type]);
    if (existing.rows.length) {
        await pool.query('UPDATE visitors SET visit_count = visit_count + 1, last_visit = CURRENT_TIMESTAMP WHERE visitor_number = $1',
            [existing.rows[0].visitor_number]);
    } else {
        const number = await getNextVisitorNumber();
        await pool.query(`INSERT INTO visitors (visitor_number, ip_address, country, city, browser_name, browser_version, os_name, os_version, device_type, device_vendor, source_type)
                          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [
            number, info.ip_address, info.country, info.city,
            info.browser_name, info.browser_version, info.os_name, info.os_version,
            info.device_type, info.device_vendor, info.source_type
        ]);
    }
    res.set('Content-Type', 'image/png');
    res.send(Buffer.from([
        0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A,0x00,0x00,0x00,0x0D,0x49,0x48,0x44,0x52,
        0x00,0x00,0x00,0x01,0x00,0x00,0x00,0x01,0x08,0x06,0x00,0x00,0x00,0x1F,0x15,0xC4,
        0x89,0x00,0x00,0x00,0x0B,0x49,0x44,0x41,0x54,0x78,0x9C,0x63,0x00,0x01,0x00,0x00,
        0x05,0x00,0x01,0x0D,0x0A,0x2D,0xB4,0x00,0x00,0x00,0x00,0x49,0x45,0x4E,0x44,0xAE,
        0x42,0x60,0x82
    ]));
});

app.get('/api/visitors', async (req, res) => {
    const token = req.query.token;
    if (token !== ADMIN_TOKEN) return res.status(401).json({ error: 'unauthorized' });
    const result = await pool.query('SELECT * FROM visitors ORDER BY last_visit DESC LIMIT 100');
    res.json({ success: true, data: result.rows });
});

app.listen(PORT, () => {
    console.log(`🚀 Server running at http://localhost:${PORT}`);
});
