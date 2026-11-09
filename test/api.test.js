const http = require('http');
const assert = require('assert');

function request(options, body = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, data });
        }
      });
    });
    req.on('error', reject);
    if (body) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
}

async function runTests() {
  console.log('--- Running API Integration Tests ---');
  const port = process.env.PORT || 3030;

  // 1. Catalog Series
  console.log('Testing GET /api/catalog/series...');
  const catRes = await request({ host: 'localhost', port, path: '/api/catalog/series', method: 'GET' });
  assert.strictEqual(catRes.status, 200);
  assert(catRes.data.series.length > 0, 'Series list must not be empty');
  console.log(`✓ Series received (${catRes.data.series.length} items)`);

  // 2. Presets
  console.log('Testing GET /api/catalog/presets...');
  const presetsRes = await request({ host: 'localhost', port, path: '/api/catalog/presets', method: 'GET' });
  assert.strictEqual(presetsRes.status, 200);
  assert(presetsRes.data.presets.length > 0, 'Presets list must not be empty');
  console.log(`✓ Presets received (${presetsRes.data.presets.length} items)`);

  // 3. Configurator options for Altai
  console.log('Testing GET /api/configurator/altai/options...');
  const cfgRes = await request({ host: 'localhost', port, path: '/api/configurator/altai/options', method: 'GET' });
  assert.strictEqual(cfgRes.status, 200);
  assert(cfgRes.data.houseChoices.length > 0, 'Altai must have configurations');
  console.log(`✓ Configurator options received (${cfgRes.data.houseChoices.length} sizes)`);

  // 4. Configurator photos
  console.log('Testing GET /api/configurator/altai/photos...');
  const photosRes = await request({ host: 'localhost', port, path: '/api/configurator/altai/photos?configKey=9x9.5&color=bronze', method: 'GET' });
  assert.strictEqual(photosRes.status, 200);
  assert(photosRes.data.slides.length > 0, 'Altai 9x9.5 must have photos');
  console.log(`✓ Configurator photos received (${photosRes.data.slides.length} slides)`);

  // 5. Auth Login
  console.log('Testing POST /api/auth/login...');
  const loginRes = await request({
    host: 'localhost',
    port,
    path: '/api/auth/login',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { email: 'admin@doka.local', password: 'admin123' });
  assert.strictEqual(loginRes.status, 200);
  assert(loginRes.data.token, 'Token must be returned');
  const token = loginRes.data.token;
  console.log('✓ Admin login successful with JWT');

  // 6. Create Order
  console.log('Testing POST /api/orders...');
  const orderRes = await request({
    host: 'localhost',
    port,
    path: '/api/orders',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, {
    customerName: 'Иван Тестовый',
    customerPhone: '+7 (999) 000-11-22',
    customerAddress: 'г. Челябинск, ул. Ленина, д. 1',
    items: [
      {
        title: 'Дом «Алтай» 9×9,5',
        price: 4259000,
        quantity: 1,
        details: { color: 'Бронза', size: '9×9,5' }
      }
    ]
  });
  assert.strictEqual(orderRes.status, 201);
  const orderId = orderRes.data.orderId;
  console.log(`✓ Order created with ID: ${orderId}`);

  // 7. Test Payment for Order
  console.log('Testing POST /api/orders/:id/pay...');
  const payRes = await request({
    host: 'localhost',
    port,
    path: `/api/orders/${orderId}/pay`,
    method: 'POST'
  });
  assert.strictEqual(payRes.status, 200);
  assert.strictEqual(payRes.data.success, true);
  console.log('✓ Payment successful (sandbox/0 RUB)');

  // 8. Admin Orders list
  console.log('Testing GET /api/admin/orders...');
  const adminOrdersRes = await request({
    host: 'localhost',
    port,
    path: '/api/admin/orders',
    method: 'GET',
    headers: { 'Authorization': `Bearer ${token}` }
  });
  assert.strictEqual(adminOrdersRes.status, 200);
  const foundOrder = adminOrdersRes.data.orders.find(o => o.id === orderId);
  assert(foundOrder, 'Created order must appear in admin orders');
  assert.strictEqual(foundOrder.payment_status, 'PAID', 'Order status must be PAID');
  console.log(`✓ Admin verified order ${foundOrder.order_number} status: ${foundOrder.payment_status}`);

  console.log('\n🎉 ALL 8 API TESTS PASSED SUCCESSFULLY! 🎉\n');
}

if (require.main === module) {
  runTests().catch(err => {
    console.error('Test failed:', err);
    process.exit(1);
  });
}

module.exports = runTests;
