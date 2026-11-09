const express = require('express');
const router = express.Router();
const db = require('../db/database');
const https = require('https');
const crypto = require('crypto');

function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

// POST /api/orders - Create a new order from cart
router.post('/', (req, res) => {
  const { customerName, customerPhone, customerEmail, customerAddress, customerComment, items } = req.body;

  if (!customerName || !customerPhone) {
    return res.status(400).json({ error: 'Пожалуйста, укажите имя и номер телефона' });
  }

  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Корзина пуста' });
  }

  let totalPrice = 0;
  for (const item of items) {
    totalPrice += Number(item.price || 0) * Number(item.quantity || 1);
  }

  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const randomSuffix = Math.floor(1000 + Math.random() * 9000);
  const orderNumber = `DK-${dateStr}-${randomSuffix}`;

  const result = db.prepare(`
    INSERT INTO orders (
      order_number, customer_name, customer_phone, customer_email, customer_address, customer_comment, items_json, total_price, payment_status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING')
  `).run(
    orderNumber,
    customerName.trim(),
    customerPhone.trim(),
    (customerEmail || '').trim(),
    (customerAddress || '').trim(),
    (customerComment || '').trim(),
    JSON.stringify(items),
    totalPrice
  );

  res.status(201).json({
    orderId: result.lastInsertRowid,
    orderNumber,
    totalPrice
  });
});

// POST /api/orders/lead - Consultation request from lead banner form (Screenshot 4)
router.post('/lead', (req, res) => {
  const { name, phone, comment } = req.body;

  if (!phone || !phone.trim()) {
    return res.status(400).json({ error: 'Пожалуйста, укажите номер телефона' });
  }

  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const randomSuffix = Math.floor(1000 + Math.random() * 9000);
  const orderNumber = `LEAD-${dateStr}-${randomSuffix}`;

  const result = db.prepare(`
    INSERT INTO orders (
      order_number, customer_name, customer_phone, customer_email, customer_address, customer_comment, items_json, total_price, payment_status
    ) VALUES (?, ?, ?, '', '', ?, '[]', 0, 'LEAD')
  `).run(
    orderNumber,
    (name || 'Клиент с сайта').trim(),
    phone.trim(),
    (comment || 'Заявка с формы обратной связи').trim()
  );

  res.status(201).json({
    success: true,
    message: 'Заявка успешно принята! Мы перезвоним вам в течение 15 минут.',
    orderId: result.lastInsertRowid,
    orderNumber
  });
});

// GET /api/orders/:id - Get order details
router.get('/:id', (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) {
    return res.status(404).json({ error: 'Заказ не найден' });
  }

  res.json({
    ...order,
    items: JSON.parse(order.items_json || '[]')
  });
});

// POST /api/orders/:id/pay - Initiate payment (YooKassa real test payment or sandbox)
router.post('/:id/pay', async (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) {
    return res.status(404).json({ error: 'Заказ не найден' });
  }

  if (order.payment_status === 'PAID') {
    return res.json({ success: true, message: 'Заказ уже оплачен', orderId: order.id });
  }

  const shopId = process.env.YOOKASSA_SHOP_ID || getSetting('yookassa_shop_id');
  const secretKey = process.env.YOOKASSA_SECRET_KEY || getSetting('yookassa_secret_key');

  const protocol = req.protocol || 'http';
  const host = req.get('host') || 'localhost:3000';
  const returnUrl = `${protocol}://${host}/order-success.html?orderId=${order.id}`;

  // If real YooKassa test credentials are provided:
  if (shopId && secretKey && shopId.trim() && secretKey.trim()) {
    try {
      const idempotenceKey = crypto.randomUUID();
      const authHeader = 'Basic ' + Buffer.from(`${shopId.trim()}:${secretKey.trim()}`).toString('base64');
      
      const payload = JSON.stringify({
        amount: {
          value: `${order.total_price}.00`,
          currency: 'RUB'
        },
        capture: true,
        confirmation: {
          type: 'redirect',
          return_url: returnUrl
        },
        description: `Оплата заказа ${order.order_number} в магазине dokabani`
      });

      const yooResponse = await new Promise((resolve, reject) => {
        const request = https.request({
          hostname: 'api.yookassa.ru',
          port: 443,
          path: '/v3/payments',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload),
            'Idempotence-Key': idempotenceKey,
            'Authorization': authHeader
          }
        }, (resStream) => {
          let data = '';
          resStream.on('data', chunk => data += chunk);
          resStream.on('end', () => {
            try {
              resolve({ statusCode: resStream.statusCode, data: JSON.parse(data) });
            } catch (e) {
              resolve({ statusCode: resStream.statusCode, data });
            }
          });
        });

        request.on('error', reject);
        request.write(payload);
        request.end();
      });

      if (yooResponse.statusCode >= 200 && yooResponse.statusCode < 300 && yooResponse.data.confirmation) {
        db.prepare('UPDATE orders SET payment_id = ?, payment_provider = ? WHERE id = ?')
          .run(yooResponse.data.id, 'yookassa', order.id);

        return res.json({
          provider: 'yookassa',
          paymentId: yooResponse.data.id,
          confirmationUrl: yooResponse.data.confirmation.confirmation_url
        });
      } else {
        console.error('YooKassa error response:', yooResponse);
      }
    } catch (err) {
      console.error('YooKassa request exception:', err);
    }
  }

  // Fallback to interactive test payment simulation (0 RUB instant test or test card)
  db.prepare(`
    UPDATE orders
    SET payment_status = 'PAID', payment_provider = 'sandbox', payment_id = ?
    WHERE id = ?
  `).run(`SANDBOX-${Date.now()}`, order.id);

  res.json({
    provider: 'sandbox',
    success: true,
    message: 'Тестовая транзакция успешно проведена (0 ₽)',
    orderId: order.id,
    orderNumber: order.order_number,
    redirectUrl: `/order-success.html?orderId=${order.id}`
  });
});

// GET /api/orders/:id/check-payment - Check status with YooKassa if applicable
router.get('/:id/check-payment', async (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) {
    return res.status(404).json({ error: 'Заказ не найден' });
  }

  if (order.payment_status === 'PAID') {
    return res.json({ status: 'PAID' });
  }

  const shopId = process.env.YOOKASSA_SHOP_ID || getSetting('yookassa_shop_id');
  const secretKey = process.env.YOOKASSA_SECRET_KEY || getSetting('yookassa_secret_key');

  if (order.payment_provider === 'yookassa' && order.payment_id && shopId && secretKey) {
    try {
      const authHeader = 'Basic ' + Buffer.from(`${shopId.trim()}:${secretKey.trim()}`).toString('base64');
      const yooStatus = await new Promise((resolve, reject) => {
        https.get({
          hostname: 'api.yookassa.ru',
          path: `/v3/payments/${order.payment_id}`,
          headers: { 'Authorization': authHeader }
        }, (resStream) => {
          let data = '';
          resStream.on('data', chunk => data += chunk);
          resStream.on('end', () => {
            try { resolve(JSON.parse(data)); } catch (e) { resolve(null); }
          });
        }).on('error', reject);
      });

      if (yooStatus && (yooStatus.status === 'succeeded' || yooStatus.paid === true)) {
        db.prepare("UPDATE orders SET payment_status = 'PAID' WHERE id = ?").run(order.id);
        return res.json({ status: 'PAID' });
      }
    } catch (e) {
      console.error('Failed to verify with YooKassa:', e);
    }
  }

  res.json({ status: order.payment_status });
});

module.exports = router;
