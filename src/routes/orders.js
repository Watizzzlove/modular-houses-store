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
const telegram = require('../services/telegram');

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

// Справочник активных промокодов
const PROMOCODES = {
  'MODUL2026': { type: 'percent', value: 5, description: 'Скидка 5% на модульный дом' },
  'DOKA100': { type: 'fixed', value: 100000, description: 'Скидка 100 000 ₽ на заказ' },
  'LETO': { type: 'percent', value: 3, description: 'Скидка 3% на заказ' },
  'WELCOME': { type: 'fixed', value: 50000, description: 'Приветственная скидка 50 000 ₽' }
};

// POST /api/orders/promocode
// Проверка и применение промокода
router.post('/promocode', (req, res) => {
  const { code } = req.body;
  if (!code || !String(code).trim()) {
    return res.status(400).json({ valid: false, error: 'Введите промокод' });
  }

  const cleanCode = String(code).trim().toUpperCase();
  const promo = PROMOCODES[cleanCode];

  if (!promo) {
    return res.status(404).json({ valid: false, error: 'Промокод не найден или истек' });
  }

  res.json({
    valid: true,
    code: cleanCode,
    type: promo.type,
    value: promo.value,
    description: promo.description
  });
});

// POST /api/orders
// Создание нового заказа из корзины покупателя
router.post('/', optionalAuth, (req, res) => {
  const { customerName, customerPhone, customerEmail, customerAddress, customerComment, items, promocode } = req.body;

  if (!customerName || !customerName.trim()) {
    return res.status(400).json({ error: 'Пожалуйста, укажите ваше имя' });
  }

  if (!customerPhone || !isValidPhone(customerPhone)) {
    return res.status(400).json({ error: 'Пожалуйста, укажите корректный номер телефона РФ (например, +7 999 123-45-67)' });
  }

  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Корзина пуста' });
  }

  // Считаем базовую стоимость корзины
  let baseTotalPrice = 0;
  for (const item of items) {
    baseTotalPrice += Number(item.price || 0) * Number(item.quantity || 1);
  }

  // Расчет скидки по промокоду
  let discountAmount = 0;
  let appliedPromo = null;
  const storedItems = [...items];

  if (promocode) {
    const cleanCode = String(promocode).trim().toUpperCase();
    const promo = PROMOCODES[cleanCode];
    if (promo) {
      appliedPromo = cleanCode;
      if (promo.type === 'percent') {
        discountAmount = Math.round(baseTotalPrice * (promo.value / 100));
      } else if (promo.type === 'fixed') {
        discountAmount = Math.min(baseTotalPrice, promo.value);
      }
      if (discountAmount > 0) {
        storedItems.push({
          title: `Скидка по промокоду ${appliedPromo}`,
          subtitle: promo.description,
          price: -discountAmount,
          quantity: 1,
          isDiscount: true
        });
      }
    }
  }

  const totalPrice = Math.max(0, baseTotalPrice - discountAmount);

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
    JSON.stringify(storedItems),
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
    items: storedItems,
    total_price: totalPrice,
    status: 'NEW'
  };

  // Отправляем email и Telegram уведомления администратору (асинхронно)
  mailer.sendOrderNotification(createdOrder).catch(console.error);
  telegram.sendOrderNotification(createdOrder).catch(console.error);

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

  // Оповещаем менеджера по почте и в Telegram
  mailer.sendLeadNotification({
    customer_name: cleanName,
    customer_phone: cleanPhone,
    customer_comment: cleanComment
  }).catch(console.error);
  telegram.sendLeadNotification({
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

// GET /api/orders/:id/contract
// Формирование официального договора поставки и сметы в печатном формате
router.get('/:id/contract', (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) {
    return res.status(404).send('Заказ не найден');
  }

  const items = JSON.parse(order.items_json || '[]');
  const isPaid = order.payment_status === 'PAID';
  const priceFormatted = new Intl.NumberFormat('ru-RU').format(order.total_price);
  const dateFormatted = new Date(order.created_at).toLocaleDateString('ru-RU', {
    day: '2-digit', month: 'long', year: 'numeric'
  });

  const itemsRows = items.map((it, idx) => `
    <tr>
      <td style="text-align: center; width: 40px;">${idx + 1}</td>
      <td>
        <strong>${it.title || 'Модульный объект'}</strong>
        ${it.subtitle ? `<div style="font-size: 12px; color: #666; margin-top: 2px;">${it.subtitle}</div>` : ''}
        ${it.options ? `<div style="font-size: 11.5px; color: #777; margin-top: 4px;">Комплектация: ${Object.entries(it.options).map(([k, v]) => `${k}: ${v}`).join(', ')}</div>` : ''}
      </td>
      <td style="text-align: center; width: 60px;">1 шт.</td>
      <td style="text-align: right; width: 140px; font-weight: 600;">${new Intl.NumberFormat('ru-RU').format(it.price || 0)} ₽</td>
    </tr>
  `).join('');

  const html = `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <title>Договор поставки и спецификация #${order.order_number}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; color: #1c1d1f; line-height: 1.5; padding: 40px; max-width: 820px; margin: 0 auto; background: #fff; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #1c1d1f; padding-bottom: 18px; margin-bottom: 24px; }
    .brand { font-size: 24px; font-weight: 800; letter-spacing: -0.02em; }
    .brand span { color: #f97316; }
    .doc-meta { text-align: right; font-size: 13px; color: #555; }
    h1 { font-size: 19px; font-weight: 800; text-align: center; margin: 20px 0 16px; text-transform: uppercase; letter-spacing: -0.01em; }
    .party-block { display: flex; gap: 20px; margin-bottom: 24px; font-size: 13px; }
    .party-col { flex: 1; background: #faf9f6; border: 1px solid #e7e5e0; border-radius: 8px; padding: 14px 18px; }
    .party-title { font-weight: 700; font-size: 13.5px; margin-bottom: 6px; color: #111; }
    table { width: 100%; border-collapse: collapse; margin: 20px 0; font-size: 13px; }
    th, td { border: 1px solid #d1d5db; padding: 10px 14px; text-align: left; }
    th { background: #f3f4f6; font-weight: 700; }
    .total-row td { font-weight: 800; font-size: 15px; background: #faf9f6; }
    .stamp-badge { display: inline-block; padding: 6px 14px; border-radius: 6px; font-weight: 800; font-size: 13px; text-transform: uppercase; border: 2px solid; }
    .stamp-paid { border-color: #10b981; color: #10b981; background: rgba(16, 185, 129, 0.08); }
    .stamp-pending { border-color: #f59e0b; color: #b45309; background: rgba(245, 158, 11, 0.08); }
    .legal-terms { font-size: 12px; color: #555; line-height: 1.6; margin-top: 24px; border-top: 1px solid #e5e7eb; padding-top: 16px; }
    .signatures { display: flex; justify-content: space-between; margin-top: 40px; padding-top: 20px; }
    .sig-col { width: 45%; border-top: 1px solid #111; padding-top: 8px; font-size: 13px; }
    .print-btn-bar { margin-bottom: 24px; text-align: right; }
    .print-btn { background: #f97316; color: #fff; border: none; padding: 10px 20px; font-size: 14px; font-weight: 700; border-radius: 8px; cursor: pointer; }
    @media print {
      .print-btn-bar { display: none !important; }
      body { padding: 0; }
    }
  </style>
</head>
<body>
  <div class="print-btn-bar">
    <button class="print-btn" onclick="window.print()">Распечатать договор и смету (PDF)</button>
  </div>

  <div class="header">
    <div>
      <div class="brand">MODUL<span>.HAUS</span></div>
      <div style="font-size: 12px; color: #666; margin-top: 4px;">Завод модульного домостроения и бань</div>
    </div>
    <div class="doc-meta">
      <div><strong>Договор #${order.order_number}</strong></div>
      <div>Дата: ${dateFormatted}</div>
      <div style="margin-top: 6px;">
        <span class="stamp-badge ${isPaid ? 'stamp-paid' : 'stamp-pending'}">
          ${isPaid ? 'ОПЛАЧЕНО' : 'ОЖИДАЕТ ОПЛАТЫ'}
        </span>
      </div>
    </div>
  </div>

  <h1>Договор поставки и спецификация #${order.order_number}</h1>

  <div class="party-block">
    <div class="party-col">
      <div class="party-title">Поставщик:</div>
      <div><strong>ООО «МОДУЛЬ ХАУС»</strong></div>
      <div>ИНН 7453001234 / ОГРН 1207400056789</div>
      <div>Адрес производства: г. Челябинск, Троицкий тракт, 11</div>
      <div>Тел: +7 (999) 000-00-00 / Email: info@modul-haus.ru</div>
    </div>
    <div class="party-col">
      <div class="party-title">Покупатель:</div>
      <div><strong>${order.customer_name || 'Не указан'}</strong></div>
      <div>Телефон: ${order.customer_phone || '—'}</div>
      <div>Email: ${order.customer_email || '—'}</div>
      <div>Адрес доставки: ${order.customer_address || 'Самовывоз с завода'}</div>
    </div>
  </div>

  <h3 style="font-size: 15px; margin-bottom: 8px;">Спецификация поставляемой продукции</h3>
  <table>
    <thead>
      <tr>
        <th style="text-align: center;">№</th>
        <th>Наименование и комплектация</th>
        <th style="text-align: center;">Кол-во</th>
        <th style="text-align: right;">Сумма</th>
      </tr>
    </thead>
    <tbody>
      ${itemsRows}
      <tr class="total-row">
        <td colspan="3" style="text-align: right;">ИТОГО К ОПЛАТЕ:</td>
        <td style="text-align: right; color: #f97316;">${priceFormatted} ₽</td>
      </tr>
    </tbody>
  </table>

  <div class="legal-terms">
    <strong>Условия изготовления и гарантии:</strong><br>
    1. Поставщик обязуется изготовить и передать Покупателю модульную конструкцию согласно утверждённой выше спецификации в срок до 30 рабочих дней с момента внесения оплаты.<br>
    2. Гарантия на силовой каркас, скрытые дефекты и герметичность кровли составляет 5 (пять) лет с момента подписания акта приёма-передачи.<br>
    3. Доставка и монтаж на свайный фундамент осуществляются специализированной бригадой завода.
  </div>

  <div class="signatures">
    <div class="sig-col">
      <strong>От Поставщика:</strong><br><br>
      Генеральный директор ООО «МОДУЛЬ ХАУС»<br>
      / Смирнов А. В. / _________________ (М.П.)
    </div>
    <div class="sig-col">
      <strong>От Покупателя:</strong><br><br>
      ${order.customer_name || 'Покупатель'}<br>
      _________________ / _________________ /
    </div>
  </div>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
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

      // Отправка уведомления на почту и в Telegram администратора
      mailer.sendOrderNotification({
        ...order,
        payment_status: 'PAID'
      }).catch(err => console.error('Ошибка отправки email по вебхуку:', err.message));
      telegram.sendOrderNotification({
        ...order,
        payment_status: 'PAID'
      }).catch(err => console.error('Ошибка отправки Telegram по вебхуку:', err.message));
    }
  }

  // Всегда возвращаем HTTP 200, чтобы ЮKassa не повторяла запрос
  res.status(200).send('OK');
});

module.exports = router;
