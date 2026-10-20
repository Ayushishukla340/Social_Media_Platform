const express = require('express');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const db = require('../database/db');
const { authMiddleware, optionalAuth } = require('../middleware/auth');
const notify = require('../utils/notify');

const router = express.Router();

// Used in every query: is_liked, is_saved, and the private-account filter
const BASE = `SELECT p.*, u.username, u.full_name, u.avatar_url, u.is_private,
  EXISTS(SELECT 1 FROM likes l WHERE l.post_id=p.id AND l.user_id=@me) AS is_liked,
  EXISTS(SELECT 1 FROM saves s WHERE s.post_id=p.id AND s.user_id=@me) AS is_saved
  FROM posts p JOIN users u ON u.id = p.user_id`;
const VISIBLE = `(u.is_private=0 OR p.user_id=@me OR p.user_id IN (SELECT following_id FROM follows WHERE follower_id=@me))`;
const page = (req, def) => {
  const limit = Math.min(parseInt(req.query.limit) || def, 50);
  return { limit, offset: ((parseInt(req.query.page) || 1) - 1) * limit };
};
const validImage = (url) => !url || /^\/uploads\/[\w.-]+$/.test(url) || /^https?:\/\/\S+$/.test(url);

router.post('/', authMiddleware, (req, res) => {
  try {
    const { content, image_url } = req.body;
    if (!content || !content.trim()) return res.status(400).json({ error: 'Content is required' });
    if (!validImage(image_url)) return res.status(400).json({ error: 'Invalid image URL' });
    const id = uuidv4();
    db.prepare('INSERT INTO posts (id, user_id, content, image_url) VALUES (?,?,?,?)').run(id, req.user.id, content.trim(), image_url || '');
    res.status(201).json(db.prepare(`${BASE} WHERE p.id=@id`).get({ me: req.user.id, id }));
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

router.get('/feed', authMiddleware, (req, res) => {
  const { limit, offset } = page(req, 10);
  res.json(db.prepare(`${BASE} WHERE p.user_id=@me OR p.user_id IN (SELECT following_id FROM follows WHERE follower_id=@me)
    ORDER BY p.created_at DESC LIMIT @limit OFFSET @offset`).all({ me: req.user.id, limit, offset }));
});

// Explore + search (?q=text or #hashtag)
router.get('/explore', optionalAuth, (req, res) => {
  const { limit, offset } = page(req, 12);
  const q = String(req.query.q || '').trim();
  res.json(db.prepare(`${BASE} WHERE ${VISIBLE} AND (@q='' OR p.content LIKE '%'||@q||'%')
    ORDER BY p.created_at DESC LIMIT @limit OFFSET @offset`).all({ me: req.user?.id || null, q, limit, offset }));
});

router.get('/saved/list', authMiddleware, (req, res) => {
  res.json(db.prepare(`${BASE} JOIN saves sv ON sv.post_id=p.id AND sv.user_id=@me
    WHERE ${VISIBLE} ORDER BY sv.created_at DESC`).all({ me: req.user.id }));
});

router.get('/:id', optionalAuth, (req, res) => {
  const post = db.prepare(`${BASE} WHERE p.id=@id AND ${VISIBLE}`).get({ me: req.user?.id || null, id: req.params.id });
  if (!post) return res.status(404).json({ error: 'Post not found' });
  res.json(post);
});

router.delete('/:id', authMiddleware, (req, res) => {
  try {
    const post = db.prepare('SELECT * FROM posts WHERE id=?').get(req.params.id);
    if (!post) return res.status(404).json({ error: 'Post not found' });
    if (post.user_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
    db.prepare('DELETE FROM posts WHERE id=?').run(post.id);
    if (/^\/uploads\/[\w.-]+$/.test(post.image_url || '')) {
      fs.unlink(path.join(__dirname, '..', 'public', 'uploads', path.basename(post.image_url)), () => {});
    }
    res.json({ message: 'Post deleted' });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

router.post('/:id/like', authMiddleware, (req, res) => {
  try {
    const post = db.prepare('SELECT id, user_id FROM posts WHERE id=?').get(req.params.id);
    if (!post) return res.status(404).json({ error: 'Post not found' });
    const me = req.user.id;
    const existing = db.prepare('SELECT id FROM likes WHERE user_id=? AND post_id=?').get(me, post.id);
    if (existing) {
      db.prepare('DELETE FROM likes WHERE id=?').run(existing.id);
      db.prepare('UPDATE posts SET likes_count = MAX(0, likes_count - 1) WHERE id=?').run(post.id);
    } else {
      db.prepare('INSERT INTO likes (id, user_id, post_id) VALUES (?,?,?)').run(uuidv4(), me, post.id);
      db.prepare('UPDATE posts SET likes_count = likes_count + 1 WHERE id=?').run(post.id);
      notify(req, { to: post.user_id, actor: me, type: 'like', postId: post.id });
    }
    res.json({ liked: !existing, likes_count: db.prepare('SELECT likes_count FROM posts WHERE id=?').get(post.id).likes_count });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

router.post('/:id/save', authMiddleware, (req, res) => {
  const post = db.prepare('SELECT id FROM posts WHERE id=?').get(req.params.id);
  if (!post) return res.status(404).json({ error: 'Post not found' });
  const ex = db.prepare('SELECT id FROM saves WHERE user_id=? AND post_id=?').get(req.user.id, post.id);
  if (ex) db.prepare('DELETE FROM saves WHERE id=?').run(ex.id);
  else db.prepare('INSERT INTO saves (id, user_id, post_id) VALUES (?,?,?)').run(uuidv4(), req.user.id, post.id);
  res.json({ saved: !ex });
});

router.get('/:id/comments', (req, res) => {
  res.json(db.prepare(`SELECT c.*, u.username, u.full_name, u.avatar_url FROM comments c
    JOIN users u ON c.user_id = u.id WHERE c.post_id = ? ORDER BY c.created_at ASC`).all(req.params.id));
});

router.post('/:id/comments', authMiddleware, (req, res) => {
  try {
    const { content } = req.body;
    if (!content || !content.trim()) return res.status(400).json({ error: 'Comment content required' });
    const post = db.prepare('SELECT id, user_id FROM posts WHERE id=?').get(req.params.id);
    if (!post) return res.status(404).json({ error: 'Post not found' });
    const id = uuidv4();
    db.prepare('INSERT INTO comments (id, post_id, user_id, content) VALUES (?,?,?,?)').run(id, post.id, req.user.id, content.trim());
    db.prepare('UPDATE posts SET comments_count = comments_count + 1 WHERE id=?').run(post.id);
    notify(req, { to: post.user_id, actor: req.user.id, type: 'comment', postId: post.id, message: content.trim().slice(0, 80) });
    res.status(201).json(db.prepare(`SELECT c.*, u.username, u.full_name, u.avatar_url FROM comments c
      JOIN users u ON c.user_id = u.id WHERE c.id=?`).get(id));
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

router.delete('/:postId/comments/:commentId', authMiddleware, (req, res) => {
  try {
    const c = db.prepare('SELECT * FROM comments WHERE id=?').get(req.params.commentId);
    if (!c) return res.status(404).json({ error: 'Comment not found' });
    if (c.user_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
    db.prepare('DELETE FROM comments WHERE id=?').run(c.id);
    db.prepare('UPDATE posts SET comments_count = MAX(0, comments_count - 1) WHERE id=?').run(c.post_id);
    res.json({ message: 'Comment deleted' });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

module.exports = router;
