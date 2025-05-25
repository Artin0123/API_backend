function login(event) {
    event.preventDefault();
    const token = document.getElementById('token').value;
    if (token) {
        window.location.href = '/?token=' + encodeURIComponent(token);
    } else {
        document.getElementById('error').textContent = '請輸入訪問令牌';
    }
} 