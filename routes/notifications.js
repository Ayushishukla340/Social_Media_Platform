const express = require('express');
const db = require('../database/db');
const { authMiddleware } = require('../middleware/auth');
const router = express.Router();

router.get('/', authMiddleware, (req, res) => {
  res.json(db.prepare(`SELECT n.*, u.username, u.full_name, u.avatar_url FROM notifications n
    JOIN users u ON u.id = n.actor_id WHERE n.user_id = ? ORDER BY n.created_at DESC LIMIT 50`).all(req.user.id));
});

router.get('/unread-count', authMiddleware, (req, res) => {
  res.json({ count: db.prepare('SELECT COUNT(*) c FROM notifications WHERE user_id=? AND is_read=0').get(req.user.id).c });
});

router.post('/read-all', authMiddleware, (req, res) => {
  db.prepare('UPDATE notifications SET is_read=1 WHERE user_id=?').run(req.user.id);
  res.json({ message: 'All marked as read' });
});

module.exports = router;
