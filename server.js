require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const authRoutes = require('./src/routes/auth');
const catalogRoutes = require('./src/routes/catalog');
const configuratorRoutes = require('./src/routes/configurator');
const mediaRoutes = require('./src/routes/media');
const orderRoutes = require('./src/routes/orders');
const adminRoutes = require('./src/routes/admin');

// Ensure database and initial data exist
const runSeed = require('./src/db/seed');
try {
  runSeed();
} catch (e) {
  console.error('Seed notice:', e.message);
}

const app = express();
const PORT = process.env.PORT || 3030;

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Static Assets
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/houses', express.static(path.join(__dirname, 'houses')));
app.use('/saunas', express.static(path.join(__dirname, 'saunas')));
app.use(express.static(path.join(__dirname, 'public')));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/catalog', catalogRoutes);
app.use('/api/configurator', configuratorRoutes);
app.use('/api/media', mediaRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/admin', adminRoutes);

// Explicit Page Routes
app.get(['/houses', '/houses.html', '/modul-houses', '/modul-houses.html'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'houses.html'));
});

app.get(['/saunas', '/saunas.html', '/modul-saunas', '/modul-saunas.html'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'saunas.html'));
});

// Healthcheck
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// Fallback to index.html for client-side routing if requested
app.use((req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'Endpoint not found' });
  }
  const indexPath = path.join(__dirname, 'public', 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.send('Server is running. Frontend is being built.');
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`\n=================================================`);
  console.log(`🚀 Магазин модульных домов и бань запущен!`);
  console.log(`🌐 Главный сайт:     http://localhost:${PORT}/`);
  console.log(`🔑 Панель админа:   http://localhost:${PORT}/admin.html`);
  console.log(`=================================================\n`);
});
