let currentSortColumn = 'visitor_number';
let currentSortDirection = 'desc';
let visitorsData = []; // 用於存儲從 API 獲取的原始數據
let idToDisplayNumberMap = new Map(); // 用於存儲原始ID到顯示編號的映射

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
// 計算時區顯示（從 UTC offset 轉換）
function formatTimezone(utcOffset, timezone) {
    // 如果有明確的時區名稱，優先顯示
    if (timezone && timezone !== 'Unknown' && timezone !== ' - ') {
        // 同時顯示計算的時區
        if (utcOffset !== null && utcOffset !== undefined) {
            const hours = Math.abs(utcOffset) / 60;
            const sign = utcOffset <= 0 ? '+' : '-';
            const timezoneOffset = `GMT${sign}${hours}`;
            return `${timezone} (${timezoneOffset})`;
        }
        return timezone;
    }
    // 從 UTC offset 計算時區
    if (utcOffset !== null && utcOffset !== undefined) {
        // UTC offset 是分鐘，負數表示東時區
        const hours = Math.abs(utcOffset) / 60;
        const sign = utcOffset <= 0 ? '+' : '-';
        return `GMT${sign}${hours}`;
    }
    return ' - ';
}

function updateTable(sortedData) {
    const tbody = document.getElementById('visitors-tbody');
    tbody.innerHTML = '';

    // 為排序後的數據重新分配連續編號
    sortedData.forEach((visitor, index) => {
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
        // 計算時區顯示
        const timezoneDisplay = isGET ? ' - ' : formatTimezone(visitor.utc_offset, visitor.timezone);
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
        // 作業系統處理
        const osDisplay = truncateText(`${visitor.os_name} ${visitor.os_version}`, 25);
        const countryDisplay = truncateText(`${visitor.country} / ${visitor.city}`, 25);

        // 使用映射關係獲取連續編號
        const originalId = visitor.visitor_number || visitor.id;
        const displayNumber = idToDisplayNumberMap.get(originalId) || 0;

        // 為調試：在控制台顯示原始ID和顯示編號的對應關係
        // console.log(`原始ID: ${originalId}, 顯示編號: ${displayNumber}, IP: ${visitor.ip_address}`);

        row.innerHTML = `
            <td><span class="visitor-number">#${displayNumber}</span></td>
            <td>${visitor.ip_address || '未知'}</td>
            <td title="${visitor.country}/${visitor.city}">${countryDisplay}</td>
            <td title="${timezoneDisplay}">${truncateText(timezoneDisplay, 30)}</td>
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
            <td>${networkTypeDisplay}</td>
            <td>${networkEffectiveDisplay}</td>
            <td>${networkRttDisplay}</td>
            <td><span class="${isGET ? 'source-get' : 'source-post'}">${visitor.source_type || 'GET'}</span></td>
            <td><strong>${visitor.visit_count}</strong></td>
            <td>${formatTimeGMT8(visitor.last_visit)}</td>
        `;
    });

    // console.log(`✅ 表格更新完成，當前排序：${currentSortColumn} ${currentSortDirection}，共 ${sortedData.length} 筆記錄`);
}

function sortData(column, direction) {
    // console.log(`🔄 開始排序：欄位=${column}, 方向=${direction}`);

    // 排序前記錄前3筆資料的ID
    // console.log('排序前前3筆:', visitorsData.slice(0, 3).map(v => ({
    //     id: v.visitor_number || v.id,
    //     ip: v.ip_address
    // })));

    visitorsData.sort((a, b) => {
        let valA, valB;

        // 特殊處理國家/城市排序：先比較國家，再比較城市
        if (column === 'country') {
            const countryA = (a.country || '').toLowerCase();
            const countryB = (b.country || '').toLowerCase();
            const cityA = (a.city || '').toLowerCase();
            const cityB = (b.city || '').toLowerCase();

            if (countryA !== countryB) {
                valA = countryA;
                valB = countryB;
            } else {
                valA = cityA;
                valB = cityB;
            }
        } else if (column === 'visitor_number') {
            // 訪客編號按照原始的數據庫ID或visitor_number排序
            valA = a.visitor_number || a.id || 0;
            valB = b.visitor_number || b.id || 0;
        } else if (column === 'last_visit') {
            valA = new Date(a[column]);
            valB = new Date(b[column]);
        } else {
            valA = a[column];
            valB = b[column];
        }

        // 處理字串類型
        if (typeof valA === 'string') {
            valA = valA.toLowerCase();
            valB = valB.toLowerCase();
        }

        if (valA < valB) {
            return direction === 'asc' ? -1 : 1;
        }
        if (valA > valB) {
            return direction === 'asc' ? 1 : -1;
        }
        return 0;
    });

    // 排序後記錄前3筆資料的ID
    // console.log('排序後前3筆:', visitorsData.slice(0, 3).map(v => ({
    //     id: v.visitor_number || v.id,
    //     ip: v.ip_address
    // })));

    updateTable(visitorsData);
}

function updateSortArrows() {
    // 重置所有箭頭為雙向箭頭
    document.querySelectorAll('#visitors-table th .sort-arrow').forEach(arrow => {
        arrow.textContent = '⇅';
        arrow.className = 'sort-arrow sort-arrow-inactive';
    });

    // 更新當前排序欄位的箭頭
    const currentTh = Array.from(document.querySelectorAll('#visitors-table th.sortable')).find(th => {
        const columnName = th.getAttribute('onclick').match(/sortTable\('(.+?)'\)/)[1];
        return columnName === currentSortColumn;
    });

    if (currentTh) {
        const arrowSpan = currentTh.querySelector('.sort-arrow');
        if (arrowSpan) {
            arrowSpan.textContent = currentSortDirection === 'asc' ? '▲' : '▼';
            arrowSpan.className = 'sort-arrow';
        }
    }
}

function sortTable(column) {
    if (currentSortColumn === column) {
        currentSortDirection = currentSortDirection === 'asc' ? 'desc' : 'asc';
    } else {
        currentSortColumn = column;
        currentSortDirection = 'asc';
    }

    updateSortArrows();
    sortData(column, currentSortDirection);
}

// 欄位名稱映射，用於更新箭頭圖示
const columnMapping = {
    'visitor_number': '訪客編號',
    'ip_address': 'IPv4 地址',
    'country': '國家 / 城市',
    'source_type': '來源',
    'visit_count': '訪問次數',
    'last_visit': '最後訪問'
};

async function loadVisitors() {
    try {
        const token = new URLSearchParams(window.location.search).get('token');
        const response = await fetch('/api/visitors?limit=100&token=' + encodeURIComponent(token));
        const data = await response.json();
        if (data.success) {
            visitorsData = data.data; // 儲存原始數據
            createIdMapping(visitorsData); // 建立ID映射關係
            updateSortArrows(); // 初始化箭頭顯示
            sortData(currentSortColumn, currentSortDirection); // 初始排序並更新表格
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
// 建立ID映射關係
function createIdMapping(data) {
    // 獲取所有唯一的ID並按升序排列
    const allIds = [...new Set(data.map(v => v.visitor_number || v.id))].sort((a, b) => a - b);

    // 建立映射：原始ID → 連續編號(1開始)
    idToDisplayNumberMap.clear();
    allIds.forEach((id, index) => {
        idToDisplayNumberMap.set(id, index + 1);
    });

    // console.log('🗺️ ID映射關係:', Array.from(idToDisplayNumberMap.entries()));
}

// 初始載入
loadVisitors();
// 每30秒自動重新載入
setInterval(loadVisitors, 30000);