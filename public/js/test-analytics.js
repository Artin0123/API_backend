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
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
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
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
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