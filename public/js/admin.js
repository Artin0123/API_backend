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
        // 使用 Intl.DateTimeFormat 獲取台北時間
        const formatter = new Intl.DateTimeFormat('zh-TW', {
            timeZone: 'Asia/Taipei',
            year: 'numeric',
            month: 'numeric',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        });
        const parts = formatter.formatToParts(date);
        const year = parts.find(p => p.type === 'year').value;
        const month = parts.find(p => p.type === 'month').value;
        const day = parts.find(p => p.type === 'day').value;
        const hour = parseInt(parts.find(p => p.type === 'hour').value);
        const minute = parts.find(p => p.type === 'minute').value;
        const second = parts.find(p => p.type === 'second').value;
        const period = hour >= 12 ? '下午' : '上午';
        const displayHours = hour === 0 ? 12 : (hour > 12 ? hour - 12 : hour);
        return `${year}/${month}/${day} ${period}${displayHours}:${minute}:${second}`;
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
                deviceDisplay = deviceDisplay.replace(/\s*Unknown/g, '').trim() || '未知';
                // 計算實際螢幕解析度或顯示 " - "
                let screenResolution = ' - ';
                if (!isGET && visitor.screen_width && visitor.screen_height) {
                    const actualWidth = Math.round(visitor.screen_width * (visitor.device_pixel_ratio || 1));
                    const actualHeight = Math.round(visitor.screen_height * (visitor.device_pixel_ratio || 1));
                    const resolutionNote = (visitor.device_pixel_ratio && visitor.device_pixel_ratio !== 1) ? ' (可能有誤)' : '';
                    screenResolution = `${actualWidth}x${actualHeight}${resolutionNote}`;
                }
                // 提取瀏覽器版本的主要版本號（第一個小數點之前）
                const browserVersion = visitor.browser_version ? visitor.browser_version.split('.')[0] : '';
                const browserDisplay = `${visitor.browser_name} ${browserVersion}`;
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
                const osDisplay = truncateText(`${visitor.os_name} ${visitor.os_version}`, 25);
                const countryDisplay = truncateText(`${visitor.country} / ${visitor.city}`, 25);
                row.innerHTML = `
                    <td><span class="visitor-number">#${visitor.visitor_number || visitor.id}</span></td>
                    <td>${visitor.ip_address || '未知'}</td>
                    <td title="${visitor.country}/${visitor.city}">${countryDisplay}</td>
                    <td title="${visitor.timezone}">${timezoneDisplay}</td>
                    <td title="${browserDisplay}">${truncateText(browserDisplay, 20)}</td>
                    <td title="${visitor.os_name} ${visitor.os_version}">${osDisplay}</td>
                    <td title="${deviceDisplay}">${truncateText(deviceDisplay, 15)}</td>
                    <td>${screenResolution}</td>
                    <td>${languageDisplay}</td>
                    <td title="${fontsTitle}">${fontsDisplay}</td>
                    <td>${colorDepthDisplay}</td>
                    <td>${cpuDisplay}</td>
                    <td>${cookieDisplay}</td>
                    <td>${touchDisplay}</td>
                    <td title="${localTime}">${truncateText(localTime, 20)}</td>
                    <td>${networkTypeDisplay}</td>
                    <td>${networkEffectiveDisplay}</td>
                    <td>${networkRttDisplay}</td>
                    <td><span class="${isGET ? 'source-get' : 'source-post'}">${visitor.source_type || 'GET'}</span></td>
                    <td><strong>${visitor.visit_count}</strong></td>
                    <td>${formatTimeGMT8(visitor.last_visit)}</td>
                `;
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