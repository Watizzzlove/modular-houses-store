const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'doka-secret-key-magistr-2026';

function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Требуется авторизация (отсутствует Bearer токен)' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Недействительный или истекший токен сессии' });
  }
}

module.exports = {
  requireAuth,
  JWT_SECRET
};
