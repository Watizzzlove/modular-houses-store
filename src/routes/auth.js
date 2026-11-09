const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db/database');
const { requireAuth, JWT_SECRET } = require('../middleware/auth');

function normalizePhone(phone) {
  if (!phone) return null;
  const digits = String(phone).replace(/\D/g, '');
  if (!digits) return null;
  // If 11 digits starting with 7 or 8 -> normalize to +7
  if (digits.length === 11 && (digits.startsWith('7') || digits.startsWith('8'))) {
    return '+7' + digits.slice(1);
  }
  if (digits.length === 10) {
    return '+7' + digits;
  }
  return '+' + digits;
}

// POST /api/auth/register
router.post('/register', (req, res) => {
  const { name, email, phone, password } = req.body;
  if (!password || password.length < 6) {
    return res.status(400).json({ error: 'Пароль должен содержать не менее 6 символов' });
  }

  const cleanEmail = email && email.trim() ? email.trim().toLowerCase() : null;
  const cleanPhone = normalizePhone(phone);
  const cleanName = (name || '').trim();

  if (!cleanEmail && !cleanPhone) {
    return res.status(400).json({ error: 'Укажите email или номер телефона для регистрации' });
  }

  // Check existing
  if (cleanEmail) {
    const existingEmail = db.prepare('SELECT id FROM users WHERE email = ?').get(cleanEmail);
    if (existingEmail) {
      return res.status(409).json({ error: 'Пользователь с таким email уже зарегистрирован' });
    }
  }

  if (cleanPhone) {
    const existingPhone = db.prepare('SELECT id FROM users WHERE phone = ?').get(cleanPhone);
    if (existingPhone) {
      return res.status(409).json({ error: 'Пользователь с таким номером телефона уже зарегистрирован' });
    }
  }

  const passwordHash = bcrypt.hashSync(password, 10);
  const dummyEmail = cleanEmail || `${cleanPhone.replace(/\+/g, '')}@modul-client.local`;

  const result = db.prepare(`
    INSERT INTO users (email, phone, name, password_hash, role)
    VALUES (?, ?, ?, ?, 'client')
  `).run(dummyEmail, cleanPhone, cleanName, passwordHash);

  const userId = result.lastInsertRowid;

  // Auto-link any prior unassigned orders matching this email or phone
  if (cleanEmail || cleanPhone) {
    try {
      db.prepare(`
        UPDATE orders
        SET user_id = ?
        WHERE user_id IS NULL AND (
          (customer_email IS NOT NULL AND customer_email = ?) OR
          (customer_phone IS NOT NULL AND customer_phone = ?)
        )
      `).run(userId, cleanEmail || '', cleanPhone || '');
    } catch (e) {
      console.warn('Could not auto-link orders on register', e);
    }
  }

  const token = jwt.sign(
    { id: userId, email: dummyEmail, phone: cleanPhone, name: cleanName, role: 'client' },
    JWT_SECRET,
    { expiresIn: '30d' }
  );

  res.status(201).json({
    token,
    user: { id: userId, email: cleanEmail, phone: cleanPhone, name: cleanName, role: 'client' }
  });
});

// POST /api/auth/login
router.post('/login', (req, res) => {
  const { login, email, phone, password } = req.body;
  const identifier = (login || email || phone || '').trim();
  if (!identifier || !password) {
    return res.status(400).json({ error: 'Укажите email/телефон и пароль' });
  }

  const cleanIdent = identifier.toLowerCase();
  const phoneIdent = normalizePhone(identifier);

  let user = null;
  if (phoneIdent) {
    user = db.prepare('SELECT * FROM users WHERE phone = ? OR email = ?').get(phoneIdent, cleanIdent);
  } else {
    user = db.prepare('SELECT * FROM users WHERE email = ?').get(cleanIdent);
  }

  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Неверный логин или пароль' });
  }

  // Link any unassigned orders
  try {
    db.prepare(`
      UPDATE orders
      SET user_id = ?
      WHERE user_id IS NULL AND (
        (customer_email IS NOT NULL AND customer_email = ?) OR
        (customer_phone IS NOT NULL AND customer_phone = ?)
      )
    `).run(user.id, user.email || '', user.phone || '');
  } catch (e) {
    // ignore
  }

  const token = jwt.sign(
    { id: user.id, email: user.email, phone: user.phone, name: user.name, role: user.role },
    JWT_SECRET,
    { expiresIn: '30d' }
  );

  res.json({
    token,
    user: { id: user.id, email: user.email, phone: user.phone, name: user.name, role: user.role }
  });
});

// GET /api/auth/me
router.get('/me', requireAuth, (req, res) => {
  const user = db.prepare('SELECT id, email, phone, name, role, created_at FROM users WHERE id = ?').get(req.user.id);
  if (!user) {
    return res.status(404).json({ error: 'Пользователь не найден' });
  }
  res.json({ user });
});

// PUT /api/auth/profile
router.put('/profile', requireAuth, (req, res) => {
  const { name, phone, email } = req.body;
  const cleanPhone = normalizePhone(phone);
  const cleanEmail = email ? email.trim().toLowerCase() : null;

  db.prepare(`
    UPDATE users
    SET name = COALESCE(?, name),
        phone = COALESCE(?, phone),
        email = COALESCE(?, email)
    WHERE id = ?
  `).run(name ? name.trim() : null, cleanPhone, cleanEmail, req.user.id);

  const updated = db.prepare('SELECT id, email, phone, name, role, created_at FROM users WHERE id = ?').get(req.user.id);
  res.json({ user: updated });
});

// GET /api/auth/my-orders
router.get('/my-orders', requireAuth, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!user) {
    return res.status(404).json({ error: 'Пользователь не найден' });
  }

  const orders = db.prepare(`
    SELECT * FROM orders
    WHERE user_id = ?
       OR (customer_email IS NOT NULL AND customer_email = ?)
       OR (customer_phone IS NOT NULL AND customer_phone = ?)
    ORDER BY id DESC
  `).all(user.id, user.email || '', user.phone || '');

  const parsed = orders.map(o => {
    let items = [];
    try {
      items = JSON.parse(o.items_json);
    } catch (e) {
      items = [];
    }
    return {
      ...o,
      items,
      items_json: undefined
    };
  });

  res.json({ orders: parsed });
});

module.exports = router;
