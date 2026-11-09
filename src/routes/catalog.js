// Роутер публичного каталога товаров (src/routes/catalog.js).
// Отвечает за:
// - получение списка серий с фильтрацией по категории (дома или бани)
// - детальную информацию о выбранной серии и ее комплектациях
// - популярные пресеты (хиты продаж для витрины главной страницы)
// - динамический текстовый контент сайта из таблицы site_content

const express = require('express');
const router = express.Router();
const db = require('../db/database');

// GET /api/catalog/series
// Список активных серий (можно фильтровать ?category=houses или ?category=saunas)
router.get('/series', (req, res) => {
  const { category } = req.query;
  let query = `
    SELECT s.*, c.slug as category_slug, c.name as category_name
    FROM series s
    JOIN categories c ON s.category_id = c.id
    WHERE s.is_active = 1
  `;
  const params = [];

  if (category) {
    query += ' AND c.slug = ?';
    params.push(category);
  }

  query += ' ORDER BY s.sort_order ASC';
  const seriesList = db.prepare(query).all(...params);
  res.json({ series: seriesList });
});

// GET /api/catalog/series/:slug
// Полная карточка серии с перечнем всех доступных габаритов
router.get('/series/:slug', (req, res) => {
  const series = db.prepare(`
    SELECT s.*, c.slug as category_slug, c.name as category_name
    FROM series s
    JOIN categories c ON s.category_id = c.id
    WHERE s.slug = ?
  `).get(req.params.slug);

  if (!series) {
    return res.status(404).json({ error: 'Серия не найдена' });
  }

  const configs = db.prepare(`
    SELECT * FROM configurations
    WHERE series_id = ?
    ORDER BY sort_order ASC
  `).all(series.id);

  res.json({ series, configurations: configs });
});

// GET /api/catalog/presets
// Популярные готовые конфигурации с плашками ("Хит продаж", "Выбор покупателей")
router.get('/presets', (req, res) => {
  const presets = db.prepare(`
    SELECT * FROM popular_presets
    ORDER BY sort_order ASC
  `).all();

  const formatted = presets.map(p => ({
    ...p,
    features: p.features_json ? JSON.parse(p.features_json) : []
  }));

  res.json({ presets: formatted });
});

// GET /api/catalog/content
// Текстовые блоки страниц, слоганы и контактная информация
router.get('/content', (req, res) => {
  const rows = db.prepare('SELECT key, value FROM site_content').all();
  const content = {};
  for (const row of rows) {
    content[row.key] = row.value;
  }
  res.json({ content });
});

module.exports = router;
