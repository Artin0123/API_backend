// 測試時間格式化和時區轉換功能
// 這個檔案用於驗證時間相關函數的正確性
// 格式化時間為 GMT+8 (台北時間)
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
// 測試本地時間計算
function calculateLocalTime(clientTime, utcOffset) {
    try {
        const time = new Date(clientTime);
        // UTC offset 是分鐘，負數表示東時區
        // 例如：台灣 +8 時區的 offset 是 -480 分鐘
        const offsetMinutes = utcOffset || 0;
        // 計算實際本地時間：客戶端時間 - offset（因為 offset 是負數，所以實際是加上）
        const actualLocalTime = new Date(time.getTime() - (offsetMinutes * 60000));
        // 再加 8 小時轉換為 GMT+8 顯示
        const gmt8Time = new Date(actualLocalTime.getTime() + (8 * 60 * 60 * 1000));
        return formatTimeGMT8(gmt8Time.toISOString());
    } catch (e) {
        return '計算錯誤';
    }
}
// 測試案例
function runTimeTests() {
    console.log('=== 時間測試開始 ===\n');
    // 測試案例 1: 當前時間
    const now = new Date();
    console.log('測試案例 1: 當前時間');
    console.log('原始時間:', now.toISOString());
    console.log('格式化結果:', formatTimeGMT8(now.toISOString()));
    console.log('');
    // 測試案例 2: 特定時間
    const testTime = '2024-01-15T10:30:45.000Z';
    console.log('測試案例 2: 特定UTC時間');
    console.log('原始時間:', testTime);
    console.log('格式化結果:', formatTimeGMT8(testTime));
    console.log('');
    // 測試案例 3: 本地時間計算 (台灣時區)
    const clientTime = '2024-01-15T18:30:45.000Z';
    const taiwanOffset = -480; // 台灣 GMT+8
    console.log('測試案例 3: 本地時間計算 (台灣)');
    console.log('客戶端時間:', clientTime);
    console.log('UTC偏移:', taiwanOffset, '分鐘');
    console.log('計算結果:', calculateLocalTime(clientTime, taiwanOffset));
    console.log('');
    // 測試案例 4: 本地時間計算 (美國東岸)
    const usEastOffset = 300; // 美國東岸 GMT-5
    console.log('測試案例 4: 本地時間計算 (美國東岸)');
    console.log('客戶端時間:', clientTime);
    console.log('UTC偏移:', usEastOffset, '分鐘');
    console.log('計算結果:', calculateLocalTime(clientTime, usEastOffset));
    console.log('');
    // 測試案例 5: 錯誤處理
    console.log('測試案例 5: 錯誤處理');
    console.log('無效時間 null:', formatTimeGMT8(null));
    console.log('無效時間 "":', formatTimeGMT8(''));
    console.log('無效時間格式:', formatTimeGMT8('invalid-date'));
    console.log('');
    // 測試案例 6: 邊界時間 (午夜和正午)
    console.log('測試案例 6: 邊界時間測試');
    const midnight = '2024-01-15T16:00:00.000Z'; // GMT+8 的午夜
    const noon = '2024-01-15T04:00:00.000Z'; // GMT+8 的正午
    console.log('午夜時間:', formatTimeGMT8(midnight));
    console.log('正午時間:', formatTimeGMT8(noon));
    console.log('');
    console.log('=== 時間測試結束 ===');
}
// 比較不同時區的時間顯示
function compareTimeZones() {
    console.log('\n=== 時區比較測試 ===\n');
    const testDate = new Date('2024-01-15T12:00:00.000Z');
    // 不同時區的格式化
    const timeZones = [
        'UTC',
        'Asia/Taipei',
        'America/New_York',
        'Europe/London',
        'Asia/Tokyo'
    ];
    timeZones.forEach(tz => {
        const formatter = new Intl.DateTimeFormat('zh-TW', {
            timeZone: tz,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        });
        console.log(`${tz}:`, formatter.format(testDate));
    });
    console.log('\n使用自訂格式化函數 (台北時間):');
    console.log('結果:', formatTimeGMT8(testDate.toISOString()));
}
// 執行所有測試
function runAllTests() {
    runTimeTests();
    compareTimeZones();
}
// 如果在 Node.js 環境中直接執行此檔案
if (typeof require !== 'undefined' && require.main === module) {
    runAllTests();
}
// 導出函數供其他檔案使用
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        formatTimeGMT8,
        calculateLocalTime,
        runTimeTests,
        compareTimeZones,
        runAllTests
    };
}