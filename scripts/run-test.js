const { execSync } = require('child_process');

async function runTest() {
  console.log('⏳ Đang lấy JWT Token từ API Login...');
  try {
    const response = await fetch('http://localhost:3000/user/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': 'adfsdfbzvb_fdaf342'
      },
      body: JSON.stringify({
        email: 'idempotent.user@example.com',
        password: 'securePassword123'
      })
    });
    const result = await response.json();
    
    if (!result.success) {
      console.error('❌ Không thể đăng nhập:', result);
      return;
    }
    
    const token = result.data.accessToken;
    console.log('✅ Đã lấy được Token!');
    console.log('🚀 Bắt đầu chạy Autocannon (1000 CCU) test chức năng Find Products...');
    
    // Chạy lệnh autocannon với random page (1 -> 1000) qua tuỳ chọn url pattern của autocannon (dùng ngoặc vuông cho random)
    // Hoặc random bằng cách tạo nhiều request? Autocannon không support random directly in URL path natively without custom requests option, but wait, `autocannon` actually doesn't have a simple random number generator in the CLI URL param.
    // Instead, we can write a custom request array in autocannon JS API!
    // But since we are using CLI, we can't easily random per request unless we use JS API.
    // Let's rewrite this part to use JS API.
    const autocannon = require('autocannon');

    const instance = autocannon({
      url: 'http://localhost:3000',
      connections: 1000,
      duration: 30,
      requests: [
        {
          method: 'GET',
          setupRequest: (req, context) => {
            const randomPage = Math.floor(Math.random() * 100) + 1; // Random từ 1 đến 100
            req.path = `/products?page=${randomPage}&limit=20`;
            return req;
          },
          headers: {
            'Authorization': `Bearer ${token}`,
            'x-api-key': 'adfsdfbzvb_fdaf342'
          }
        }
      ]
    }, (err, result) => {
      if (err) {
        console.error('Lỗi khi chạy Autocannon:', err);
      }
    });

    autocannon.track(instance, { renderProgressBar: true });
    
  } catch (err) {
    console.error('❌ Có lỗi xảy ra:', err);
  }
}

runTest();
