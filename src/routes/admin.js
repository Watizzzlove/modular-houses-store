// Роутер панели администратора (src/routes/admin.js).
// Защищен middleware requireAuth - доступ разрешен только по валидному JWT токену.
// Отвечает за:
// - управление медиатекой: загрузка фото через multer, фильтрация по категориям/сериям/цветам, удаление
// - управление каталогом: редактирование цен, описаний серий и доступных габаритов
// - управление текстовым контентом сайта (site_content)
// - настройка платежных шлюзов (ЮKassa) и уведомлений (почта админа, SMTP, SMS)
// - управление заказами: просмотр полного списка, смена статуса производства и оплаты
// - просмотр журнала отправленных email-уведомлений (outbox)

const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../db/database');
const { requireAuth } = require('../middleware/auth');
const mailer = require('../services/mailer');
const telegram = require('../services/telegram');

// Все эндпоинты админки требуют авторизации
router.use(requireAuth);

// Конфигурация multer для загрузки файлов в папку uploads/
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadPath = path.join(__dirname, '../../uploads');
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    cb(null, uploadPath);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname);
    const basename = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_-]/g, '_');
    cb(null, `${Date.now()}_${basename}${ext}`);
  }
});

// Ограничение размера до 15 МБ и фильтр только валидных графических форматов
const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/\.(jpe?g|png|webp)$/i.test(file.originalname)) {
      cb(null, true);
    } else {
      cb(new Error('Разрешены только изображения JPG, PNG, WEBP'));
    }
  }
});

// Управление медиатекой и фотографиями

// GET /api/admin/media
// Выборка фотографий с фильтрацией по серии, категории, цвету и типу фото
router.get('/media', (req, res) => {
  const { seriesId, categoryId, color, kind, configId } = req.query;
  let sql = `
    SELECT m.*, s.name as series_name, c.label as config_label, s.category_id, cat.name as category_name
    FROM media_items m
    JOIN series s ON m.series_id = s.id
    JOIN categories cat ON s.category_id = cat.id
    LEFT JOIN configurations c ON m.configuration_id = c.id
    WHERE 1=1
  `;
  const params = [];

  if (seriesId && seriesId !== 'all') {
    sql += ' AND m.series_id = ?';
    params.push(seriesId);
  }
  if (categoryId && categoryId !== 'all') {
    sql += ' AND s.category_id = ?';
    params.push(categoryId);
  }
  if (color && color !== 'all') {
    sql += ' AND m.color = ?';
    params.push(color);
  }
  if (kind && kind !== 'all') {
    sql += ' AND m.kind = ?';
    params.push(kind);
  }
  if (configId && configId !== 'all') {
    sql += ' AND m.configuration_id = ?';
    params.push(configId);
  }

  sql += ' ORDER BY m.id DESC LIMIT 400';
  const items = db.prepare(sql).all(...params);
  res.json({ items });
});

// POST /api/admin/media/upload
// Загрузка новой фотографии с привязкой к серии и комплектации
router.post('/media/upload', upload.single('photo'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Файл фотографии не передан' });
  }

  const { seriesId, configId, color = 'bronze', entranceKind = 'base', kind = 'exterior' } = req.body;
  if (!seriesId) {
    return res.status(400).json({ error: 'Укажите ID серии' });
  }

  const fileUrl = `/uploads/${req.file.filename}`;
  const result = db.prepare(`
    INSERT INTO media_items (
      series_id, configuration_id, color, entrance_kind, kind, filename, url, sort_order
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 1)
  `).run(
    seriesId,
    configId || null,
    color,
    entranceKind,
    kind,
    req.file.filename,
    fileUrl
  );

  res.status(201).json({
    success: true,
    id: result.lastInsertRowid,
    url: fileUrl,
    filename: req.file.filename
  });
});

// DELETE /api/admin/media/:id
// Удаление фото из базы и с диска (если это загрузка)
router.delete('/media/:id', (req, res) => {
  const item = db.prepare('SELECT * FROM media_items WHERE id = ?').get(req.params.id);
  if (!item) {
    return res.status(404).json({ error: 'Медиафайл не найден' });
  }

  // Если файл был загружен в /uploads, удаляем его физически с диска
  if (item.url && item.url.startsWith('/uploads/')) {
    const diskPath = path.join(__dirname, '../../uploads', path.basename(item.url));
    if (fs.existsSync(diskPath)) {
      try { fs.unlinkSync(diskPath); } catch (e) {}
    }
  }

  db.prepare('DELETE FROM media_items WHERE id = ?').run(req.params.id);
  res.json({ success: true, message: 'Фотография удалена' });
});

// Управление сериями и комплектациями

// GET /api/admin/series
// Получение полного списка серий с подсчетом количества доступных размеров и фото
router.get('/series', (req, res) => {
  const series = db.prepare(`
    SELECT s.*, c.name as category_name,
      (SELECT COUNT(*) FROM configurations WHERE series_id = s.id) as config_count,
      (SELECT COUNT(*) FROM media_items WHERE series_id = s.id) as media_count
    FROM series s
    JOIN categories c ON s.category_id = c.id
    ORDER BY s.sort_order ASC
  `).all();
  res.json({ series });
});

// PUT /api/admin/series/:id
// Быстрое редактирование серии (название, слоган, базовая цена, статус активности)
router.put('/series/:id', (req, res) => {
  const { name, tagline, description, basePrice, isActive, coverImage } = req.body;
  db.prepare(`
    UPDATE series
    SET name = coalesce(?, name),
        tagline = coalesce(?, tagline),
        description = coalesce(?, description),
        base_price = coalesce(?, base_price),
        is_active = coalesce(?, is_active),
        cover_image = coalesce(?, cover_image)
    WHERE id = ?
  `).run(name, tagline, description, basePrice, isActive, coverImage, req.params.id);

  res.json({ success: true, message: 'Серия обновлена' });
});

// GET /api/admin/configurations/:seriesId
// Получение конфигураций выбранной серии
router.get('/configurations/:seriesId', (req, res) => {
  const configs = db.prepare(`
    SELECT c.*,
      (SELECT COUNT(*) FROM media_items WHERE configuration_id = c.id) as media_count
    FROM configurations c
    WHERE c.series_id = ?
    ORDER BY c.sort_order ASC, c.area ASC
  `).all(req.params.seriesId);
  res.json({ configurations: configs });
});

// PUT /api/admin/configurations/:id
// Обновление параметров конкретного размера (цена, площадь, ширина, длина)
router.put('/configurations/:id', (req, res) => {
  const { label, price, area, width, length } = req.body;
  db.prepare(`
    UPDATE configurations
    SET label = coalesce(?, label),
        price = coalesce(?, price),
        area = coalesce(?, area),
        width = coalesce(?, width),
        length = coalesce(?, length)
    WHERE id = ?
  `).run(label, price, area, width, length, req.params.id);

  res.json({ success: true, message: 'Комплектация обновлена' });
});

// POST /api/admin/configurations
// Добавление нового размера серии
router.post('/configurations', (req, res) => {
  const { seriesId, key, label, width, length, area, price } = req.body;
  if (!seriesId || !key || !label || !price) {
    return res.status(400).json({ error: 'Заполните обязательные поля (серия, ключ, название, цена)' });
  }

  const result = db.prepare(`
    INSERT INTO configurations (series_id, key, label, width, length, area, price, folder_name)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    seriesId,
    key,
    label,
    width || 0,
    length || 0,
    area || (width * length),
    price,
    `${width}x${length}__p${price}`
  );

  res.status(201).json({ success: true, id: result.lastInsertRowid });
});

// Управление контентом сайта

// GET /api/admin/content
router.get('/content', (req, res) => {
  const rows = db.prepare('SELECT key, value FROM site_content').all();
  const content = {};
  for (const r of rows) content[r.key] = r.value;
  res.json({ content });
});

// PUT /api/admin/content
// Массовое сохранение текстовых полей сайта
router.put('/content', (req, res) => {
  const entries = req.body;
  const updateStmt = db.prepare('INSERT OR REPLACE INTO site_content (key, value) VALUES (?, ?)');
  const updateMany = db.transaction((data) => {
    for (const [key, value] of Object.entries(data)) {
      updateStmt.run(key, String(value));
    }
  });

  updateMany(entries);
  res.json({ success: true, message: 'Контент сайта сохранён' });
});

// Системные настройки (ЮKassa, SMTP, SMS)

// GET /api/admin/settings
router.get('/settings', (req, res) => {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const settings = {};
  for (const r of rows) settings[r.key] = r.value;
  res.json({ settings });
});

// PUT /api/admin/settings
router.put('/settings', (req, res) => {
  const entries = req.body;
  const updateStmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  const updateMany = db.transaction((data) => {
    for (const [key, value] of Object.entries(data)) {
      updateStmt.run(key, String(value));
    }
  });

  updateMany(entries);
  res.json({ success: true, message: 'Настройки сохранены' });
});

// POST /api/admin/settings/test-mail
// Проверка подключения к SMTP серверу и отправка тестового письма
router.post('/settings/test-mail', async (req, res) => {
  const result = await mailer.testSmtpConnection(req.body);
  if (result.success) {
    res.json({
      success: true,
      message: result.message || `Тестовое письмо успешно отправлено на ${result.to}!`,
      messageId: result.messageId
    });
  } else {
    res.status(400).json({
      success: false,
      error: result.error
    });
  }
});

// POST /api/admin/settings/test-telegram
// Проверка подключения и отправка тестового сообщения в Telegram
router.post('/settings/test-telegram', async (req, res) => {
  const result = await telegram.testTelegramConnection(req.body);
  if (result.success) {
    res.json({
      success: true,
      message: result.message || 'Тестовое сообщение успешно отправлено в Telegram!',
      messageId: result.messageId
    });
  } else {
    res.status(400).json({
      success: false,
      error: result.error
    });
  }
});

// Управление заказами

// GET /api/admin/orders
// Список всех заказов с распарсенным JSON товаров
router.get('/orders', (req, res) => {
  const orders = db.prepare(`
    SELECT * FROM orders ORDER BY id DESC
  `).all();

  const formatted = orders.map(o => ({
    ...o,
    items: JSON.parse(o.items_json || '[]')
  }));

  res.json({ orders: formatted });
});

// PUT /api/admin/orders/:id/status
// Смена статуса заказа (NEW -> PAID -> IN_PRODUCTION -> DELIVERING -> COMPLETED)
router.put('/orders/:id/status', (req, res) => {
  const { paymentStatus, status } = req.body;
  if (paymentStatus && !['PENDING', 'PAID', 'CANCELLED'].includes(paymentStatus)) {
    return res.status(400).json({ error: 'Недопустимый статус оплаты' });
  }

  const validStatuses = ['NEW', 'PAID', 'IN_PRODUCTION', 'DELIVERING', 'COMPLETED', 'CANCELLED'];
  if (status && !validStatuses.includes(status)) {
    return res.status(400).json({ error: 'Недопустимый статус производства' });
  }

  if (paymentStatus && status) {
    db.prepare('UPDATE orders SET payment_status = ?, status = ? WHERE id = ?').run(paymentStatus, status, req.params.id);
  } else if (paymentStatus) {
    db.prepare('UPDATE orders SET payment_status = ? WHERE id = ?').run(paymentStatus, req.params.id);
  } else if (status) {
    db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, req.params.id);
  }

  res.json({ success: true, message: 'Статус заказа обновлен' });
});

// GET /api/admin/analytics
// Сводная аналитика и ключевые показатели (KPI) магазина
router.get('/analytics', (req, res) => {
  try {
    const revenueRow = db.prepare(`
      SELECT 
        COALESCE(SUM(total_price), 0) AS total_revenue,
        COUNT(*) AS total_orders,
        COALESCE(SUM(CASE WHEN payment_status = 'PAID' THEN 1 ELSE 0 END), 0) AS paid_orders,
        COALESCE(AVG(CASE WHEN payment_status = 'PAID' THEN total_price ELSE NULL END), 0) AS avg_order_value
      FROM orders
    `).get();

    const clientsCount = db.prepare(`
      SELECT COUNT(*) AS total_clients FROM users WHERE role = 'client'
    `).get().total_clients;

    const statusRows = db.prepare(`
      SELECT status, COUNT(*) AS count 
      FROM orders 
      GROUP BY status
    `).all();
    const statusMap = {};
    for (const s of statusRows) statusMap[s.status] = s.count;

    const recentOrders = db.prepare(`
      SELECT id, order_number, customer_name, customer_phone, total_price, payment_status, status, created_at
      FROM orders
      ORDER BY id DESC
      LIMIT 5
    `).all();

    const dailyStats = db.prepare(`
      SELECT 
        substr(created_at, 1, 10) AS day,
        COUNT(*) AS orders_count,
        COALESCE(SUM(CASE WHEN payment_status = 'PAID' THEN total_price ELSE 0 END), 0) AS daily_revenue
      FROM orders
      GROUP BY day
      ORDER BY day DESC
      LIMIT 7
    `).all().reverse();

    res.json({
      success: true,
      metrics: {
        totalRevenue: revenueRow.total_revenue,
        totalOrders: revenueRow.total_orders,
        paidOrders: revenueRow.paid_orders,
        avgOrderValue: Math.round(revenueRow.avg_order_value),
        conversionRate: revenueRow.total_orders > 0 
          ? Math.round((revenueRow.paid_orders / revenueRow.total_orders) * 100) 
          : 0,
        totalClients: clientsCount
      },
      statusDistribution: statusMap,
      dailyStats,
      recentOrders
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/admin/outbox
// Журнал отправленных почтовых уведомлений администратора
router.get('/outbox', (req, res) => {
  const outbox = mailer.getOutbox();
  res.json({ outbox });
});

// GET /api/admin/orders/export/csv
// Экспорт всех заказов магазина в CSV-файл с BOM для Microsoft Excel
router.get('/orders/export/csv', (req, res) => {
  try {
    const orders = db.prepare('SELECT * FROM orders ORDER BY id DESC').all();
    const header = ['ID', 'Номер заказа', 'Дата', 'Клиент', 'Телефон', 'Email', 'Адрес', 'Сумма (руб)', 'Статус оплаты', 'Статус производства', 'Состав заказа'];

    const rows = orders.map(o => {
      const items = JSON.parse(o.items_json || '[]');
      const itemsStr = items.map(i => `${i.title || 'Модуль'} (${i.price || 0} руб)`).join('; ');
      return [
        o.id,
        o.order_number,
        o.created_at,
        `"${(o.customer_name || '').replace(/"/g, '""')}"`,
        `"${(o.customer_phone || '').replace(/"/g, '""')}"`,
        `"${(o.customer_email || '').replace(/"/g, '""')}"`,
        `"${(o.customer_address || '').replace(/"/g, '""')}"`,
        o.total_price,
        o.payment_status,
        o.status,
        `"${itemsStr.replace(/"/g, '""')}"`
      ].join(';');
    });

    const csvContent = '\uFEFF' + [header.join(';'), ...rows].join('\r\n');
    const filename = `orders_modul_haus_${new Date().toISOString().slice(0, 10)}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csvContent);
  } catch (err) {
    res.status(500).json({ error: 'Ошибка экспорта CSV: ' + err.message });
  }
});

// GET /api/admin/backup/db
// Резервное копирование: безопасная выгрузка файла базы данных SQLite (.sqlite)
router.get('/backup/db', (req, res) => {
  try {
    const dbPath = path.join(__dirname, '../../data/store.db');
    if (!fs.existsSync(dbPath)) {
      return res.status(404).json({ error: 'Файл базы данных не найден' });
    }
    const filename = `modul_haus_backup_${new Date().toISOString().slice(0, 10)}.sqlite`;
    res.download(dbPath, filename);
  } catch (err) {
    res.status(500).json({ error: 'Ошибка создания бэкапа: ' + err.message });
  }
});

module.exports = router;
