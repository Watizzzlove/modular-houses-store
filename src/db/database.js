const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, '../../data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const uploadsDir = path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'store.db');
const db = new Database(dbPath);

// Enable WAL mode for concurrency and foreign keys
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT DEFAULT 'admin',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      sort_order INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS series (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category_id INTEGER REFERENCES categories(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      tagline TEXT,
      description TEXT,
      base_price INTEGER DEFAULT 0,
      cover_image TEXT,
      is_active INTEGER DEFAULT 1,
      sort_order INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS configurations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      series_id INTEGER REFERENCES series(id) ON DELETE CASCADE,
      key TEXT NOT NULL,
      label TEXT NOT NULL,
      width REAL NOT NULL,
      length REAL NOT NULL,
      area REAL NOT NULL,
      price INTEGER NOT NULL,
      folder_name TEXT,
      sort_order INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS extensions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      configuration_id INTEGER REFERENCES configurations(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      terrace_type TEXT,
      key TEXT NOT NULL,
      label TEXT NOT NULL,
      price INTEGER NOT NULL,
      width REAL DEFAULT 0,
      length REAL DEFAULT 0,
      area REAL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS media_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      series_id INTEGER REFERENCES series(id) ON DELETE CASCADE,
      configuration_id INTEGER REFERENCES configurations(id) ON DELETE CASCADE,
      color TEXT NOT NULL,
      entrance_kind TEXT DEFAULT 'base',
      terrace_type TEXT,
      kind TEXT NOT NULL,
      filename TEXT NOT NULL,
      url TEXT NOT NULL,
      sort_order INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS popular_presets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      badge TEXT,
      title TEXT NOT NULL,
      series_slug TEXT NOT NULL,
      size_key TEXT NOT NULL,
      color TEXT NOT NULL,
      entrance TEXT,
      terrace_type TEXT,
      extension_key TEXT,
      price INTEGER NOT NULL,
      area TEXT NOT NULL,
      dimensions TEXT NOT NULL,
      image_url TEXT NOT NULL,
      features_json TEXT,
      sort_order INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS site_content (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_number TEXT UNIQUE NOT NULL,
      user_id INTEGER,
      customer_name TEXT NOT NULL,
      customer_phone TEXT NOT NULL,
      customer_email TEXT,
      customer_address TEXT,
      customer_comment TEXT,
      items_json TEXT NOT NULL,
      total_price INTEGER NOT NULL,
      payment_status TEXT DEFAULT 'PENDING',
      status TEXT DEFAULT 'NEW',
      payment_id TEXT,
      payment_provider TEXT DEFAULT 'sandbox',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Safe migrations for added fields
  const userColumns = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
  if (!userColumns.includes('phone')) db.exec("ALTER TABLE users ADD COLUMN phone TEXT");
  if (!userColumns.includes('name')) db.exec("ALTER TABLE users ADD COLUMN name TEXT");

  const orderColumns = db.prepare("PRAGMA table_info(orders)").all().map(c => c.name);
  if (!orderColumns.includes('user_id')) db.exec("ALTER TABLE orders ADD COLUMN user_id INTEGER");
  if (!orderColumns.includes('status')) db.exec("ALTER TABLE orders ADD COLUMN status TEXT DEFAULT 'NEW'");
}

initSchema();

module.exports = db;
