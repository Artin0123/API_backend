// 簡化的測試伺服器
const express = require('express');
const app = express();
// 嘗試不同的端口
const ports = [3000, 3001, 3002, 3003, 8000, 8080];
let currentPortIndex = 0;
function tryStartServer() {
    const port = ports[currentPortIndex];
    console.log(`嘗試在端口 ${port} 啟動伺服器...`);
    const server = app.listen(port, () => {
        console.log(`✅ 伺服器成功啟動在 http://localhost:${port}`);
        console.log(`測試 URL: http://localhost:${port}/test`);
    });
    server.on('error', (error) => {
        if (error.code === 'EADDRINUSE') {
            console.log(`❌ 端口 ${port} 已被佔用`);
            currentPortIndex++;
            if (currentPortIndex < ports.length) {
                console.log(`🔄 嘗試下一個端口...`);
                tryStartServer();
            } else {
                console.error('❌ 所有端口都被佔用，無法啟動伺服器');
                process.exit(1);
            }
        } else {
            console.error('伺服器錯誤:', error);
            process.exit(1);
        }
    });
}
// 簡單的測試路由
app.get('/test', (req, res) => {
    res.json({
        success: true,
        message: '伺服器運行正常！',
        timestamp: new Date().toISOString()
    });
});
app.get('/', (req, res) => {
    res.send(`
        <h1>🚀 測試伺服器運行中</h1>
        <p>伺服器正常工作！</p>
        <a href="/test">測試 API</a>
    `);
});
// 開始嘗試啟動
tryStartServer(); 