const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../database/db');
const { authMiddleware } = require('../middleware/auth');
const notify = require('../utils/notify');
const router = express.Router();

const other = (username) => db.prepare('SELECT id, username, full_name, avatar_url FROM users WHERE username=?').get(String(username).toLowerCase());

// Inbox: last message + unread count for each person
router.get('/conversations', authMiddleware, (req, res) => {
  res.json(db.prepare(`SELECT u.id, u.username, u.full_name, u.avatar_url,
      m.content AS last_message, m.created_at AS last_at,
      (SELECT COUNT(*) FROM messages x WHERE x.sender_id=u.id AND x.receiver_id=@me AND x.is_read=0) AS unread
    FROM users u JOIN messages m ON m.id = (
      SELECT id FROM messages WHERE (sender_id=@me AND receiver_id=u.id) OR (sender_id=u.id AND receiver_id=@me)
      ORDER BY created_at DESC, rowid DESC LIMIT 1)
    WHERE u.id != @me ORDER BY m.created_at DESC`).all({ me: req.user.id }));
});

router.get('/unread-count', authMiddleware, (req, res) => {
  res.json({ count: db.prepare('SELECT COUNT(*) c FROM messages WHERE receiver_id=? AND is_read=0').get(req.user.id).c });
});

// Opening a chat marks their messages as read
router.get('/with/:username', authMiddleware, (req, res) => {
  const u = other(req.params.username);
  if (!u) return res.status(404).json({ error: 'User not found' });
  const me = req.user.id;
  const msgs = db.prepare(`SELECT * FROM messages WHERE (sender_id=@me AND receiver_id=@o) OR (sender_id=@o AND receiver_id=@me)
    ORDER BY created_at ASC, rowid ASC LIMIT 200`).all({ me, o: u.id });
  db.prepare('UPDATE messages SET is_read=1 WHERE sender_id=? AND receiver_id=? AND is_read=0').run(u.id, me);
  const io = req.app.get('io');
  if (io) io.to('u:' + u.id).emit('messages_read', { by: me });
  res.json({ user: u, messages: msgs });
});

router.post('/to/:username', authMiddleware, (req, res) => {
  try {
    const u = other(req.params.username);
    if (!u) return res.status(404).json({ error: 'User not found' });
    if (u.id === req.user.id) return res.status(400).json({ error: 'Cannot message yourself' });
    const content = String(req.body.content || '').trim().slice(0, 2000);
    const image_url = req.body.image_url || '';
    if (!content && !image_url) return res.status(400).json({ error: 'Message is empty' });
    if (image_url && !/^\/uploads\/[\w.-]+$/.test(image_url)) return res.status(400).json({ error: 'Invalid image URL' });

    const id = uuidv4();
    db.prepare('INSERT INTO messages (id, sender_id, receiver_id, content, image_url) VALUES (?,?,?,?,?)').run(id, req.user.id, u.id, content, image_url);
    const msg = db.prepare('SELECT * FROM messages WHERE id=?').get(id);
    const io = req.app.get('io');
    if (io) { io.to('u:' + u.id).emit('message', msg); io.to('u:' + req.user.id).emit('message', msg); }
    res.status(201).json(msg);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

module.exports = router;
