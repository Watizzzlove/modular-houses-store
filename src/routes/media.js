const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');

const ALLOWED_IMAGE = /\.(jpe?g|png|webp)$/i;

// GET /api/media/list?path=houses/altai
router.get('/list', (req, res) => {
  let requestedPath = String(req.query.path || '').trim();
  requestedPath = requestedPath.replace(/^[\/\\]+|[\/\\]+$/g, '');

  // Prevent directory traversal
  if (requestedPath.includes('..') || path.isAbsolute(requestedPath)) {
    return res.status(400).json({ error: 'Invalid path' });
  }

  // Only allow access within houses, saunas, uploads
  const allowedRoots = ['houses', 'saunas', 'uploads'];
  const firstSegment = requestedPath.split(/[\/\\]/)[0];
  if (!allowedRoots.includes(firstSegment)) {
    return res.status(403).json({ error: 'Access denied' });
  }

  const fullPath = path.resolve(__dirname, '..', '..', requestedPath);
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

    for (const entry of entries) {
      if (entry.isDirectory()) {
        items.push({
          name: entry.name,
          type: 'dir'
        });
      } else if (ALLOWED_IMAGE.test(entry.name)) {
        const fileUrl = '/' + path.posix.join(requestedPath.replace(/\\/g, '/'), entry.name);
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
    console.error('Media list error:', err);
    res.status(500).json({ error: 'Failed to list directory' });
  }
});

module.exports = router;
