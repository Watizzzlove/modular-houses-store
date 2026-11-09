// Роутер конфигуратора домов и бань (src/routes/configurator.js).
// Отвечает за:
// 1) Выдачу доступных размеров, пристроек (крыльцо/терраса) и цветов для конкретной серии
// 2) Каскадный подбор реальных фотографий (экстерьер, интерьер, планировки) под выбранные пользователем фильтры:
//    размер -> цвет -> пристрой (крыльцо / терраса открытая или закрытая).
// Если точных фото с пристроем нет в каталоге, срабатывает каскадный фолбек на базовые фото проекта.

const express = require('express');
const router = express.Router();
const db = require('../db/database');

// GET /api/configurator/:seriesSlug/options
// Загрузка всех параметров серии для отрисовки фильтров конфигуратора
router.get('/:seriesSlug/options', (req, res) => {
  const { seriesSlug } = req.params;
  const series = db.prepare(`
    SELECT s.*, c.slug as category_slug, c.name as category_name
    FROM series s
    JOIN categories c ON s.category_id = c.id
    WHERE s.slug = ?
  `).get(seriesSlug);

  if (!series) {
    return res.status(404).json({ error: `Серия '${seriesSlug}' не найдена` });
  }

  // Выбираем размеры дома, отсортированные по площади
  const configurations = db.prepare(`
    SELECT id, key, label, width, length, area, price, folder_name as folder
    FROM configurations
    WHERE series_id = ?
    ORDER BY sort_order ASC, area ASC
  `).all(series.id);

  if (configurations.length === 0) {
    return res.status(404).json({ error: 'Для данной серии пока нет доступных размеров' });
  }

  // Опции расширений (крыльцо, терраса)
  const extensions = db.prepare(`
    SELECT e.id, e.configuration_id, e.kind, e.terrace_type, e.key, e.label, e.price
    FROM extensions e
    JOIN configurations c ON e.configuration_id = c.id
    WHERE c.series_id = ?
  `).all(series.id);

  // Список уникальных цветов из базы фото
  const colors = db.prepare(`
    SELECT DISTINCT color FROM media_items
    WHERE series_id = ?
  `).all(series.id).map(r => r.color);

  res.json({
    series: {
      id: series.id,
      name: series.name,
      slug: series.slug,
      typeName: series.category_slug === 'houses' ? 'Дом' : 'Баня',
      categorySlug: series.category_slug,
      tagline: series.tagline,
      description: series.description,
      basePrice: series.base_price
    },
    houseChoices: configurations,
    extensions,
    availableColors: ['bronze', 'beige', 'graphite'],
    availableEntrances: ['porch', 'terrace'],
    availableTerraceTypes: ['covered', 'open'],
    standardPorchChoices: [
      { key: '2x3', label: '2×3 м', price: 180000 }
    ],
    standardTerraceChoices: [
      { key: '3x9', label: '3×9 м', price: 420000 }
    ]
  });
});

// GET /api/configurator/:seriesSlug/photos
// Умный каскадный подбор слайдов для галереи конфигуратора
router.get('/:seriesSlug/photos', (req, res) => {
  const { seriesSlug } = req.params;
  const { configKey, color = 'bronze', entrance, terraceType } = req.query;

  const series = db.prepare('SELECT id FROM series WHERE slug = ?').get(seriesSlug);
  if (!series) {
    return res.status(404).json({ error: 'Серия не найдена' });
  }

  // Находим конкретную конфигурацию по размеру (например, 9x9.5)
  let config = null;
  if (configKey) {
    config = db.prepare('SELECT id FROM configurations WHERE series_id = ? AND key = ?').get(series.id, configKey);
  }
  // Если не указана, берем первую дефолтную конфигурацию серии
  if (!config) {
    config = db.prepare('SELECT id FROM configurations WHERE series_id = ? ORDER BY sort_order ASC LIMIT 1').get(series.id);
  }

  if (!config) {
    return res.json({ slides: [] });
  }

  // Шаг 1: Пробуем найти фото с точным совпадением пристроя (крыльцо или терраса нужного типа)
  let photos = [];
  if (entrance && entrance !== 'none' && entrance !== 'base') {
    if (terraceType) {
      photos = db.prepare(`
        SELECT kind, filename as name, url, sort_order as "order"
        FROM media_items
        WHERE series_id = ? AND configuration_id = ? AND color = ? AND entrance_kind = ? AND terrace_type = ?
        ORDER BY sort_order ASC, id ASC
      `).all(series.id, config.id, color, entrance, terraceType);
    }
    if (photos.length === 0) {
      photos = db.prepare(`
        SELECT kind, filename as name, url, sort_order as "order"
        FROM media_items
        WHERE series_id = ? AND configuration_id = ? AND color = ? AND entrance_kind = ?
        ORDER BY sort_order ASC, id ASC
      `).all(series.id, config.id, color, entrance);
    }
  }

  // Шаг 2: Фолбек - если фото с выбранным пристроем в базе нет, берем базовые фото дома без пристроя
  if (photos.length === 0) {
    photos = db.prepare(`
      SELECT kind, filename as name, url, sort_order as "order"
      FROM media_items
      WHERE series_id = ? AND configuration_id = ? AND color = ? AND entrance_kind = 'base'
      ORDER BY sort_order ASC, id ASC
    `).all(series.id, config.id, color);
  }

  // Шаг 3: Проверка планировок - если фото пристроя есть, но нет файла чертежа/планировки,
  // подтягиваем планировку из базового комплекта этого цвета, чтобы клиент всегда видел планировку
  if (photos.length > 0 && !photos.some(p => p.kind === 'plan')) {
    const basePlanPhotos = db.prepare(`
      SELECT kind, filename as name, url, sort_order as "order"
      FROM media_items
      WHERE series_id = ? AND configuration_id = ? AND color = ? AND entrance_kind = 'base' AND kind = 'plan'
      ORDER BY sort_order ASC, id ASC
    `).all(series.id, config.id, color);

    for (const pl of basePlanPhotos) {
      if (!photos.some(p => p.url === pl.url)) {
        photos.push(pl);
      }
    }
  }

  // Преобразуем для фронтенда в массив слайдов
  const slides = photos.map(p => ({
    type: 'image',
    name: p.name,
    order: p.order,
    kind: p.kind || 'exterior',
    url: p.url,
    thumbnailUrl: p.url,
    referrerPolicy: 'no-referrer'
  }));

  res.json({ slides });
});

module.exports = router;
