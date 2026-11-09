require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

// Главный входной файл сервера Express.
// Здесь собираются роуты API, раздача статики по папкам (pages, catalog, css, js)
// и инициализация начальной базы данных при первом запуске.

const authRoutes = require('./src/routes/auth');
const catalogRoutes = require('./src/routes/catalog');
const configuratorRoutes = require('./src/routes/configurator');
const mediaRoutes = require('./src/routes/media');
const orderRoutes = require('./src/routes/orders');
const adminRoutes = require('./src/routes/admin');

// Автозапуск сидирования базы при старте сервера, если таблиц еще нет
const runSeed = require('./src/db/seed');
try {
  runSeed();
} catch (e) {
  console.error('Ошибка инициализации БД:', e.message);
}

const app = express();
const PORT = process.env.PORT || 3030;

// Парсинг JSON и urlencoded тела запросов, CORS для клиентских запросов
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Раздача статических файлов по стандартной структуре проекта:
// public/catalog - каталог фото домов и бань
// public/pages - HTML страницы
// public/css, public/js, public/images - клиентские скрипты, стили и графика
app.use('/catalog', express.static(path.join(__dirname, 'public', 'catalog')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/docs', express.static(path.join(__dirname, 'docs')));
app.use('/archify', express.static(path.join(__dirname, 'docs', 'archify')));

// Алиасы для обратной совместимости старых путей к фото
app.use('/houses', express.static(path.join(__dirname, 'public', 'catalog', 'houses')));
app.use('/saunas', express.static(path.join(__dirname, 'public', 'catalog', 'saunas')));

// Базовая раздача статики из public (стили, скрипты, картинки)
app.use(express.static(path.join(__dirname, 'public')));
app.use('/pages', express.static(path.join(__dirname, 'public', 'pages')));

// Подключение роутов API
app.use('/api/auth', authRoutes);
app.use('/api/catalog', catalogRoutes);
app.use('/api/configurator', configuratorRoutes);
app.use('/api/media', mediaRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/admin', adminRoutes);

// Маршрутизация HTML страниц из папки public/pages
const pagesDir = path.join(__dirname, 'public', 'pages');

// Главная страница
app.get(['/', '/index.html'], (req, res) => {
  res.sendFile(path.join(pagesDir, 'index.html'));
});

// Каталог и конфигуратор модульных домов
app.get(['/houses', '/houses.html', '/modul-houses', '/modul-houses.html'], (req, res) => {
  res.sendFile(path.join(pagesDir, 'houses.html'));
});

// Каталог и конфигуратор модульных бань
app.get(['/saunas', '/saunas.html', '/modul-saunas', '/modul-saunas.html'], (req, res) => {
  res.sendFile(path.join(pagesDir, 'saunas.html'));
});

// Личный кабинет клиента (авторизация, заказы, настройки профиля)
app.get(['/profile', '/profile.html', '/account', '/account.html'], (req, res) => {
  res.sendFile(path.join(pagesDir, 'profile.html'));
});

// Страница оплаты заказа через шлюз
app.get(['/payment', '/payment.html'], (req, res) => {
  res.sendFile(path.join(pagesDir, 'payment.html'));
});

// Страница успешного оформления или оплаты
app.get(['/order-success', '/order-success.html'], (req, res) => {
  res.sendFile(path.join(pagesDir, 'order-success.html'));
});

// Панель управления администратора
app.get(['/admin', '/admin.html'], (req, res) => {
  res.sendFile(path.join(pagesDir, 'admin.html'));
});

// Интерактивная архитектурная карта проекта Archify
app.get(['/architecture', '/architecture.html', '/archify-map'], (req, res) => {
  const mapPath = path.join(__dirname, 'docs', 'archify', 'system-architecture.html');
  if (fs.existsSync(mapPath)) {
    res.sendFile(mapPath);
  } else {
    res.redirect('/');
  }
});

// Проверка работоспособности сервиса (healthcheck)
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// Фолбек: если запрос не к API и путь не совпал ни с чем, отдаем главную страницу
app.use((req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'Эндпоинт не найден' });
  }
  const indexPath = path.join(pagesDir, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(500).send('Сервер запущен, но index.html не найден.');
  }
});

// Запуск прослушивания HTTP порта
app.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
  console.log(`Главный сайт: http://localhost:${PORT}/`);
  console.log(`Панель админа: http://localhost:${PORT}/admin.html`);
  console.log(`Карта архитектуры: http://localhost:${PORT}/architecture`);
});
