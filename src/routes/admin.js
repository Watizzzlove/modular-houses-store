const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../db/database');
const { requireAuth } = require('../middleware/auth');

// Protect all admin routes with JWT
router.use(requireAuth);

// Multer storage configuration for uploads
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

const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 }, // 15 MB limit
  fileFilter: (req, file, cb) => {
    if (/\.(jpe?g|png|webp)$/i.test(file.originalname)) {
      cb(null, true);
    } else {
      cb(new Error('Разрешены только изображения JPG, PNG, WEBP'));
    }
  }
});

// --- MEDIA MANAGEMENT ---

// GET /api/admin/media - List media items
router.get('/media', (req, res) => {
  const { seriesId, configId } = req.query;
  let sql = `
    SELECT m.*, s.name as series_name, c.label as config_label
    FROM media_items m
    JOIN series s ON m.series_id = s.id
    LEFT JOIN configurations c ON m.configuration_id = c.id
    WHERE 1=1
  `;
  const params = [];

  if (seriesId) {
    sql += ' AND m.series_id = ?';
    params.push(seriesId);
  }
  if (configId) {
    sql += ' AND m.configuration_id = ?';
    params.push(configId);
  }

  sql += ' ORDER BY m.id DESC LIMIT 100';
  const items = db.prepare(sql).all(...params);
  res.json({ items });
});

// POST /api/admin/media/upload - Upload new photo
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

// DELETE /api/admin/media/:id - Delete photo
router.delete('/media/:id', (req, res) => {
  const item = db.prepare('SELECT * FROM media_items WHERE id = ?').get(req.params.id);
  if (!item) {
    return res.status(404).json({ error: 'Медиафайл не найден' });
  }

  // If file was uploaded to /uploads, remove from disk
  if (item.url && item.url.startsWith('/uploads/')) {
    const diskPath = path.join(__dirname, '../../uploads', path.basename(item.url));
    if (fs.existsSync(diskPath)) {
      try { fs.unlinkSync(diskPath); } catch (e) { /* ignore */ }
    }
  }

  db.prepare('DELETE FROM media_items WHERE id = ?').run(req.params.id);
  res.json({ success: true, message: 'Фотография удалена' });
});

// --- CATALOG MANAGEMENT ---

// GET /api/admin/series
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

// --- SITE CONTENT MANAGEMENT ---

// GET /api/admin/content
router.get('/content', (req, res) => {
  const rows = db.prepare('SELECT key, value FROM site_content').all();
  const content = {};
  for (const r of rows) content[r.key] = r.value;
  res.json({ content });
});

// PUT /api/admin/content
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

// --- SETTINGS (YOOKASSA) ---

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

// --- ORDERS MANAGEMENT ---

// GET /api/admin/orders
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
router.put('/orders/:id/status', (req, res) => {
  const { paymentStatus } = req.body;
  if (!['PENDING', 'PAID', 'CANCELLED'].includes(paymentStatus)) {
    return res.status(400).json({ error: 'Недопустимый статус заказа' });
  }

  db.prepare('UPDATE orders SET payment_status = ? WHERE id = ?').run(paymentStatus, req.params.id);
  res.json({ success: true, message: 'Статус заказа обновлен' });
});

module.exports = router;
