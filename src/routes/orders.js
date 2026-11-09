// Роутер обработки заказов, заявок и платежей (src/routes/orders.js).
// Отвечает за:
// - оформление заказа из корзины с валидацией номера телефона РФ
// - отправку быстрых заявок на консультацию с форм сайта (лиды)
// - интеграцию со шлюзом оплаты (ЮKassa API или тестовый интерактивный шлюз)
// - подтверждение факта оплаты и перевод заказа в статус PAID
// - управление жизненным циклом заказа администратором (NEW -> PAID -> IN_PRODUCTION -> DELIVERING -> COMPLETED)
// - отправку email-уведомлений о новых сделках через mailer сервис

const express = require('express');
const router = express.Router();
const db = require('../db/database');
const https = require('https');
const crypto = require('crypto');
const { optionalAuth, requireAuth } = require('../middleware/auth');
const mailer = require('../services/mailer');

// Валидатор формата номера телефона РФ (+7 или 8 с 10-11 цифрами)
const PHONE_REGEX = /^(\+7|7|8)?[\s\-]?\(?[489][0-9]{2}\)?[\s\-]?[0-9]{3}[\s\-]?[0-9]{2}[\s\-]?[0-9]{2}$/;

function isValidPhone(phone) {
  if (!phone) return false;
  const clean = String(phone).trim();
  const digits = clean.replace(/\D/g, '');
  return PHONE_REGEX.test(clean) && (digits.length === 10 || digits.length === 11);
}

// Чтение системных настроек (ключи ЮKassa, почта админа)
function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

// POST /api/orders
// Создание нового заказа из корзины покупателя
router.post('/', optionalAuth, (req, res) => {
  const { customerName, customerPhone, customerEmail, customerAddress, customerComment, items } = req.body;

  if (!customerName || !customerName.trim()) {
    return res.status(400).json({ error: 'Пожалуйста, укажите ваше имя' });
  }

  if (!customerPhone || !isValidPhone(customerPhone)) {
    return res.status(400).json({ error: 'Пожалуйста, укажите корректный номер телефона РФ (например, +7 999 123-45-67)' });
  }

  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Корзина пуста' });
  }

  // Считаем итоговую стоимость корзины
  let totalPrice = 0;
  for (const item of items) {
    totalPrice += Number(item.price || 0) * Number(item.quantity || 1);
  }

  // Генерация уникального человекочитаемого номера заказа: DK-ГГГГММДД-XXXX
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const randomSuffix = Math.floor(1000 + Math.random() * 9000);
  const orderNumber = `DK-${dateStr}-${randomSuffix}`;

  // Привязка к аккаунту: если пользователь залогинен, берем его id,
  // иначе пробуем найти существующий аккаунт по совпадению телефона
  let userId = req.user ? req.user.id : null;
  if (!userId && (customerEmail || customerPhone)) {
    const cleanPhone = customerPhone.replace(/\D/g, '');
    const user = db.prepare(`
      SELECT id FROM users
      WHERE (email = ? AND email != '')
         OR (phone LIKE ? AND phone != '')
      LIMIT 1
    `).get(customerEmail ? customerEmail.trim().toLowerCase() : '', `%${cleanPhone.slice(-10)}%`);
    if (user) userId = user.id;
  }

  const result = db.prepare(`
    INSERT INTO orders (
      order_number, user_id, customer_name, customer_phone, customer_email, customer_address, customer_comment, items_json, total_price, payment_status, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', 'NEW')
  `).run(
    orderNumber,
    userId,
    customerName.trim(),
    customerPhone.trim(),
    (customerEmail || '').trim(),
    (customerAddress || '').trim(),
    (customerComment || '').trim(),
    JSON.stringify(items),
    totalPrice
  );

  const orderId = result.lastInsertRowid;
  const createdOrder = {
    id: orderId,
    order_number: orderNumber,
    customer_name: customerName.trim(),
    customer_phone: customerPhone.trim(),
    customer_email: (customerEmail || '').trim(),
    customer_address: (customerAddress || '').trim(),
    customer_comment: (customerComment || '').trim(),
    items,
    total_price: totalPrice,
    status: 'NEW'
  };

  // Отправляем email-уведомление администратору (асинхронно, без задержки ответа клиенту)
  mailer.sendOrderNotification(createdOrder).catch(console.error);

  res.status(201).json({
    orderId,
    orderNumber,
    totalPrice,
    paymentUrl: `/payment.html?orderId=${orderId}`
  });
});

// POST /api/orders/lead
// Быстрая заявка на консультацию или расчет стоимости (лид-форма)
router.post('/lead', optionalAuth, (req, res) => {
  const { name, phone, comment } = req.body;

  if (!phone || !isValidPhone(phone)) {
    return res.status(400).json({ error: 'Пожалуйста, укажите корректный номер телефона РФ (например, +7 999 123-45-67)' });
  }

  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const randomSuffix = Math.floor(1000 + Math.random() * 9000);
  const orderNumber = `LEAD-${dateStr}-${randomSuffix}`;

  const cleanName = (name || 'Клиент с сайта').trim();
  const cleanPhone = phone.trim();
  const cleanComment = (comment || 'Заявка с формы обратной связи').trim();

  let userId = req.user ? req.user.id : null;

  const result = db.prepare(`
    INSERT INTO orders (
      order_number, user_id, customer_name, customer_phone, customer_email, customer_address, customer_comment, items_json, total_price, payment_status, status
    ) VALUES (?, ?, ?, ?, '', '', ?, '[]', 0, 'LEAD', 'NEW')
  `).run(
    orderNumber,
    userId,
    cleanName,
    cleanPhone,
    cleanComment
  );

  // Оповещаем менеджера по почте
  mailer.sendLeadNotification({
    customer_name: cleanName,
    customer_phone: cleanPhone,
    customer_comment: cleanComment
  }).catch(console.error);

  res.status(201).json({
    success: true,
    message: 'Заявка успешно принята! Мы перезвоним вам в течение 15 минут.',
    orderId: result.lastInsertRowid,
    orderNumber
  });
});

// GET /api/orders/:id
// Получение подробной информации о заказе по его ID
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

// POST /api/orders/:id/pay
// Инициализация платежа: если настроена ЮKassa, стучимся в ее API,
// иначе отдаем ссылку на наш тестовый интерактивный шлюз оплаты (sandbox)
router.post('/:id/pay', async (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) {
    return res.status(404).json({ error: 'Заказ не найден' });
  }

  if (order.payment_status === 'PAID') {
    return res.json({
      success: true,
      message: 'Заказ уже оплачен',
      orderId: order.id,
      redirectUrl: `/order-success.html?orderId=${order.id}`
    });
  }

  const shopId = process.env.YOOKASSA_SHOP_ID || getSetting('yookassa_shop_id');
  const secretKey = process.env.YOOKASSA_SECRET_KEY || getSetting('yookassa_secret_key');

  const protocol = req.protocol || 'http';
  const host = req.get('host') || 'localhost:3030';
  const returnUrl = `${protocol}://${host}/order-success.html?orderId=${order.id}`;

  // Если в настройках прописаны реальные ключи ЮKassa, отправляем запрос к API ЮKassa
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
        description: `Оплата заказа ${order.order_number} в магазине MODUL.HAUS`
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
      }
    } catch (err) {
      console.error('Ошибка обращения к API ЮKassa:', err);
    }
  }

  // Интерактивный тестовый платежный шлюз
  res.json({
    provider: 'sandbox',
    success: true,
    orderId: order.id,
    orderNumber: order.order_number,
    totalPrice: order.total_price,
    paymentUrl: `/payment.html?orderId=${order.id}`,
    confirmationUrl: `/payment.html?orderId=${order.id}`
  });
});

// POST /api/orders/:id/confirm-payment
// Подтверждение факта оплаты тестовым шлюзом
router.post('/:id/confirm-payment', (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) {
    return res.status(404).json({ error: 'Заказ не найден' });
  }

  const { paymentId, provider } = req.body;
  const pId = paymentId || `YK-TEST-${Date.now()}`;

  db.prepare(`
    UPDATE orders
    SET payment_status = 'PAID',
        status = 'PAID',
        payment_provider = ?,
        payment_id = ?
    WHERE id = ?
  `).run(provider || 'yookassa_test', pId, order.id);

  console.log(`[PAYMENT SUCCESS] Заказ ${order.order_number} успешно оплачен. Транзакция: ${pId}`);

  res.json({
    success: true,
    message: 'Оплата успешно принята!',
    orderId: order.id,
    orderNumber: order.order_number,
    status: 'PAID',
    redirectUrl: `/order-success.html?orderId=${order.id}`
  });
});

// PATCH /api/orders/:id/status
// Смена статуса заказа администратором (NEW -> PAID -> IN_PRODUCTION -> DELIVERING -> COMPLETED)
router.patch('/:id/status', requireAuth, (req, res) => {
  const { status } = req.body;
  const validStatuses = ['NEW', 'PAID', 'IN_PRODUCTION', 'DELIVERING', 'COMPLETED', 'CANCELLED'];
  if (!status || !validStatuses.includes(status)) {
    return res.status(400).json({ error: 'Недопустимый статус заказа' });
  }

  const order = db.prepare('SELECT id FROM orders WHERE id = ?').get(req.params.id);
  if (!order) {
    return res.status(404).json({ error: 'Заказ не найден' });
  }

  db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, req.params.id);
  res.json({ success: true, orderId: req.params.id, status });
});

// GET /api/orders/:id/check-payment
// Опрос статуса оплаты (для вебхуков или проверки возврата из ЮKassa)
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
      console.error('Ошибка проверки платежа в ЮKassa:', e);
    }
  }

  res.json({ status: order.payment_status });
});

// POST /api/orders/webhook/yookassa
// Официальный вебхук ЮKassa для асинхронных уведомлений о статусе платежей
router.post('/webhook/yookassa', (req, res) => {
  const event = req.body;
  if (!event || !event.event) {
    return res.status(400).send('Invalid webhook event');
  }

  if (event.event === 'payment.succeeded' && event.object) {
    const paymentId = event.object.id;
    const order = db.prepare('SELECT * FROM orders WHERE payment_id = ?').get(paymentId);
    if (order) {
      db.prepare(`
        UPDATE orders
        SET payment_status = 'PAID',
            status = 'PAID'
        WHERE id = ?
      `).run(order.id);
      console.log(`[YOOKASSA WEBHOOK] Платеж подтвержден для заказа #${order.order_number}`);

      // Отправка уведомления на почту администратора
      mailer.sendOrderNotification({
        ...order,
        payment_status: 'PAID'
      }).catch(err => console.error('Ошибка отправки email по вебхуку:', err.message));
    }
  }

  // Всегда возвращаем HTTP 200, чтобы ЮKassa не повторяла запрос
  res.status(200).send('OK');
});

module.exports = router;
