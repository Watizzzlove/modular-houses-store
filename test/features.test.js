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
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function runFeatureTests() {
  console.log('\n--- Running New Features & Authentication Tests ---');
  const timestamp = Date.now();
  const testPhone = `+7 999 ${Math.floor(100 + Math.random() * 900)} ${Math.floor(10 + Math.random() * 90)} ${Math.floor(10 + Math.random() * 90)}`;
  const testEmail = `client_${timestamp}@example.com`;

  // 1. Phone validation check on Lead form
  console.log('1. Testing phone validation on lead submission...');
  const invalidLead = await request({
    hostname: 'localhost',
    port: 3030,
    path: '/api/orders/lead',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { name: 'Test', phone: '123' });
  assert.strictEqual(invalidLead.status, 400, 'Invalid phone must be rejected with 400');
  console.log('✓ Invalid phone correctly rejected with 400');

  // 2. Client registration with phone
  console.log('2. Testing client registration...');
  const regRes = await request({
    hostname: 'localhost',
    port: 3030,
    path: '/api/auth/register',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, {
    name: 'Иван Тестов',
    phone: testPhone,
    email: testEmail,
    password: 'password123'
  });
  assert.strictEqual(regRes.status, 201, 'Registration should return 201');
  assert.ok(regRes.data.token, 'Should return JWT token');
  const clientToken = regRes.data.token;
  const clientId = regRes.data.user.id;
  console.log(`✓ Client registered successfully (ID: ${clientId})`);

  // 3. Client login by phone
  console.log('3. Testing client login by phone...');
  const loginRes = await request({
    hostname: 'localhost',
    port: 3030,
    path: '/api/auth/login',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, {
    login: testPhone,
    password: 'password123'
  });
  assert.strictEqual(loginRes.status, 200, 'Login should succeed');
  assert.strictEqual(loginRes.data.user.id, clientId);
  console.log('✓ Client successfully logged in via phone');

  // 4. Create order linked to client
  console.log('4. Testing order creation with authentication...');
  const orderRes = await request({
    hostname: 'localhost',
    port: 3030,
    path: '/api/orders',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${clientToken}`
    }
  }, {
    customerName: 'Иван Тестов',
    customerPhone: testPhone,
    customerEmail: testEmail,
    customerAddress: 'г. Челябинск, ул. Ленина, 10',
    items: [{
      title: 'Дом «Алтай» 9×9,5 м с крыльцом 2×3 м',
      price: 4439000,
      quantity: 1
    }]
  });
  assert.strictEqual(orderRes.status, 201, 'Order creation should return 201');
  const orderId = orderRes.data.orderId;
  console.log(`✓ Order created with ID: ${orderId}, paymentUrl: ${orderRes.data.paymentUrl}`);

  // 5. Check Personal Cabinet orders
  console.log('5. Testing personal cabinet my-orders endpoint...');
  const myOrdersRes = await request({
    hostname: 'localhost',
    port: 3030,
    path: '/api/auth/my-orders',
    method: 'GET',
    headers: { 'Authorization': `Bearer ${clientToken}` }
  });
  assert.strictEqual(myOrdersRes.status, 200);
  assert.ok(myOrdersRes.data.orders.length >= 1, 'Client should have at least 1 order');
  assert.strictEqual(myOrdersRes.data.orders[0].id, orderId);
  console.log(`✓ Order ${orderId} appears in client personal cabinet`);

  // 6. Test Payment Gateway Confirmation
  console.log('6. Testing payment gateway confirmation...');
  const payConfirm = await request({
    hostname: 'localhost',
    port: 3030,
    path: `/api/orders/${orderId}/confirm-payment`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, {
    paymentId: 'YOO-TEST-999888',
    provider: 'yookassa_sandbox'
  });
  assert.strictEqual(payConfirm.status, 200);
  assert.strictEqual(payConfirm.data.status, 'PAID');
  console.log(`✓ Payment confirmed, order status: PAID`);

  // 7. Test Admin Status Lifecycle Transition
  console.log('7. Testing admin status transition to IN_PRODUCTION...');
  // Login as admin
  const adminLogin = await request({
    hostname: 'localhost',
    port: 3030,
    path: '/api/auth/login',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { email: 'admin@doka.local', password: 'admin123' });
  assert.strictEqual(adminLogin.status, 200, 'Admin login should succeed');
  const adminToken = adminLogin.data.token;

  const statusUpdate = await request({
    hostname: 'localhost',
    port: 3030,
    path: `/api/orders/${orderId}/status`,
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminToken}`
    }
  }, { status: 'IN_PRODUCTION' });
  assert.strictEqual(statusUpdate.status, 200);
  assert.strictEqual(statusUpdate.data.status, 'IN_PRODUCTION');
  console.log(`✓ Admin updated order lifecycle status to: IN_PRODUCTION`);

  // Verify in client cabinet
  const updatedCabinet = await request({
    hostname: 'localhost',
    port: 3030,
    path: '/api/auth/my-orders',
    method: 'GET',
    headers: { 'Authorization': `Bearer ${clientToken}` }
  });
  assert.strictEqual(updatedCabinet.data.orders[0].status, 'IN_PRODUCTION');
  console.log(`✓ Client personal cabinet reflects updated status: IN_PRODUCTION`);

  // 8. Test Email Outbox API
  console.log('8. Testing admin email notifications outbox...');
  const outboxRes = await request({
    hostname: 'localhost',
    port: 3030,
    path: '/api/admin/outbox',
    method: 'GET',
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });
  assert.strictEqual(outboxRes.status, 200);
  assert.ok(outboxRes.data.outbox.length > 0, 'Outbox should contain sent email notifications');
  console.log(`✓ Admin outbox retrieved (${outboxRes.data.outbox.length} notifications logged)`);

  // 9. Test Phone Push Code Registration Flow
  console.log('9. Testing phone push code registration flow...');
  const pushPhone = `+7999888${Math.floor(1000 + Math.random() * 9000)}`;
  const sendPushRes = await request({
    hostname: 'localhost',
    port: 3030,
    path: '/api/auth/send-push-code',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, {
    name: 'Илья Тестовый',
    phone: pushPhone,
    password: 'secretPassword123',
    passwordConfirm: 'secretPassword123'
  });
  assert.strictEqual(sendPushRes.status, 200);
  assert.strictEqual(sendPushRes.data.success, true);
  const receivedCode = sendPushRes.data.devCode;
  assert.ok(receivedCode, 'Should return push code in test mode');
  console.log(`✓ Push code generated and dispatched: ${receivedCode}`);

  const registerPushRes = await request({
    hostname: 'localhost',
    port: 3030,
    path: '/api/auth/register-phone',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, {
    phone: pushPhone,
    code: receivedCode,
    password: 'secretPassword123',
    passwordConfirm: 'secretPassword123',
    name: 'Илья Тестовый'
  });
  assert.strictEqual(registerPushRes.status, 201);
  assert.ok(registerPushRes.data.token, 'Should receive JWT token on push registration');
  assert.strictEqual(registerPushRes.data.user.phone, pushPhone);
  console.log(`✓ User successfully registered via push code verification`);

  console.log('10. Testing YooKassa payment webhook endpoint...');
  const webhookPaymentId = 'yoo_pay_' + Date.now();
  // Assign payment_id to orderId
  const db = require('../src/db/database');
  db.prepare('UPDATE orders SET payment_id = ? WHERE id = ?').run(webhookPaymentId, orderId);

  const webhookRes = await request({
    hostname: 'localhost',
    port: 3030,
    path: '/api/orders/webhook/yookassa',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, {
    type: 'notification',
    event: 'payment.succeeded',
    object: {
      id: webhookPaymentId,
      status: 'succeeded',
      paid: true,
      amount: { value: '1450000.00', currency: 'RUB' }
    }
  });
  assert.strictEqual(webhookRes.status, 200);
  const updatedOrder = db.prepare('SELECT payment_status FROM orders WHERE id = ?').get(orderId);
  assert.strictEqual(updatedOrder.payment_status, 'PAID');
  console.log(`✓ YooKassa webhook processed successfully, order status updated to: PAID`);

  console.log('11. Testing Telegram notification graceful fallback...');
  const telegram = require('../src/services/telegram');
  const tgResult = await telegram.sendMessage('Test notification');
  assert.strictEqual(typeof tgResult, 'object');
  assert.ok(tgResult.skipped || tgResult.success, 'Telegram should gracefully handle unconfigured or configured state');
  console.log(`✓ Telegram service handled gracefully (skipped: ${tgResult.skipped || false})`);

  console.log('12. Testing Telegram settings endpoint validation...');
  const tgValidationRes = await request({
    hostname: 'localhost',
    port: 3030,
    path: '/api/admin/settings/test-telegram',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminToken}`
    }
  }, {
    telegram_bot_token: '',
    telegram_chat_id: ''
  });
  assert.strictEqual(tgValidationRes.status, 400);
  assert.strictEqual(tgValidationRes.data.success, false);
  console.log('✓ Telegram endpoint correctly validates required bot token and chat ID');

  console.log('13. Testing printable contract generation endpoint...');
  const contractRes = await request({
    hostname: 'localhost',
    port: 3030,
    path: `/api/orders/${orderId}/contract`,
    method: 'GET'
  });
  assert.strictEqual(contractRes.status, 200);
  assert.ok(typeof contractRes.data === 'string' && contractRes.data.includes('Договор поставки и спецификация'), 'Contract HTML must contain legal header');
  assert.ok(contractRes.data.includes('ООО «МОДУЛЬ ХАУС»'), 'Contract HTML must contain company details');
  console.log('✓ Printable contract endpoint successfully generated HTML invoice/contract');

  console.log('14. Testing executive analytics KPI dashboard endpoint...');
  const analyticsRes = await request({
    hostname: 'localhost',
    port: 3030,
    path: '/api/admin/analytics',
    method: 'GET',
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });
  assert.strictEqual(analyticsRes.status, 200);
  assert.strictEqual(analyticsRes.data.success, true);
  assert.strictEqual(typeof analyticsRes.data.metrics.totalRevenue, 'number');
  assert.strictEqual(typeof analyticsRes.data.metrics.totalOrders, 'number');
  assert.ok(Array.isArray(analyticsRes.data.dailyStats));
  console.log(`✓ Analytics dashboard verified (Revenue: ${analyticsRes.data.metrics.totalRevenue} RUB, Orders: ${analyticsRes.data.metrics.totalOrders})`);

  console.log('15. Testing SEO endpoints and Excel CSV orders export...');
  const robotsRes = await request({ hostname: 'localhost', port: 3030, path: '/robots.txt', method: 'GET' });
  assert.strictEqual(robotsRes.status, 200);
  assert.ok(typeof robotsRes.data === 'string' && robotsRes.data.includes('User-agent'));

  const sitemapRes = await request({ hostname: 'localhost', port: 3030, path: '/sitemap.xml', method: 'GET' });
  assert.strictEqual(sitemapRes.status, 200);
  assert.ok(typeof sitemapRes.data === 'string' && sitemapRes.data.includes('<urlset'));

  const csvRes = await request({
    hostname: 'localhost',
    port: 3030,
    path: '/api/admin/orders/export/csv',
    method: 'GET',
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });
  assert.strictEqual(csvRes.status, 200);
  assert.ok(typeof csvRes.data === 'string' && csvRes.data.includes('Номер заказа'));
  console.log('✓ SEO robots.txt, sitemap.xml and CSV export verified successfully');

  console.log('16. Testing SQLite database backup download endpoint...');
  const backupRes = await request({
    hostname: 'localhost',
    port: 3030,
    path: '/api/admin/backup/db',
    method: 'GET',
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });
  assert.strictEqual(backupRes.status, 200);
  console.log('✓ SQLite database backup endpoint successfully served binary archive');

  console.log('\n🎉 ALL 16 FEATURE & AUTH TESTS PASSED PERFECTLY! 🎉\n');
}

runFeatureTests().catch(err => {
  console.error('Test Failed:', err);
  process.exit(1);
});
