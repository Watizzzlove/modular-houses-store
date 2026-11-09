const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');

// Модуль работы с медиафайлами и галереями каталога.
// Используется в админке для динамического просмотра структуры папок с фотографиями
// и выбора изображений для привязки к комплектациям.

const ALLOWED_IMAGE = /\.(jpe?g|png|webp)$/i;

// Получение списка файлов и подпапок по переданному относительному пути
// GET /api/media/list?path=houses/altai или path=catalog/houses/altai
router.get('/list', (req, res) => {
  let requestedPath = String(req.query.path || '').trim();
  requestedPath = requestedPath.replace(/^[\/\\]+|[\/\\]+$/g, '');

  // Защита от path traversal атак (переходов выше корня)
  if (requestedPath.includes('..') || path.isAbsolute(requestedPath)) {
    return res.status(400).json({ error: 'Недопустимый путь' });
  }

  // Разрешаем просмотр только в рамках каталога фото и загрузок
  const allowedRoots = ['catalog', 'houses', 'saunas', 'uploads'];
  const firstSegment = requestedPath.split(/[\/\\]/)[0];
  if (!allowedRoots.includes(firstSegment)) {
    return res.status(403).json({ error: 'Доступ к директории запрещен' });
  }

  // Приведение путей houses/saunas к новой структуре public/catalog
  let fullPath;
  let urlPrefix = '';
  if (firstSegment === 'houses' || firstSegment === 'saunas') {
    fullPath = path.resolve(__dirname, '..', '..', 'public', 'catalog', requestedPath);
    urlPrefix = '/' + requestedPath.replace(/\\/g, '/');
  } else if (firstSegment === 'catalog') {
    fullPath = path.resolve(__dirname, '..', '..', 'public', requestedPath);
    urlPrefix = '/' + requestedPath.replace(/\\/g, '/');
  } else {
    fullPath = path.resolve(__dirname, '..', '..', requestedPath);
    urlPrefix = '/' + requestedPath.replace(/\\/g, '/');
  }

  if (!fs.existsSync(fullPath)) {
    return res.json([]);
  }

  try {
    const stat = fs.statSync(fullPath);
    if (!stat.isDirectory()) {
      return res.json([]);
    }

    const entries = fs.readdirSync(fullPath, { withFileTypes: true });
    const items = [];

    // Формируем плоский список папок и картинок для отображения в админ-панели
    for (const entry of entries) {
      if (entry.isDirectory()) {
        items.push({
          name: entry.name,
          type: 'dir'
        });
      } else if (ALLOWED_IMAGE.test(entry.name)) {
        const fileUrl = urlPrefix + '/' + entry.name;
        items.push({
          name: entry.name,
          type: 'file',
          file: fileUrl,
          preview: fileUrl
        });
      }
    }

    res.json(items);
  } catch (err) {
    console.error('Ошибка чтения каталога медиа:', err);
    res.status(500).json({ error: 'Не удалось прочитать директорию' });
  }
});

module.exports = router;
