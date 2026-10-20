const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../database/db');
const { authMiddleware, optionalAuth } = require('../middleware/auth');
const notify = require('../utils/notify');

const router = express.Router();
const isFollowing = (a, b) => !!db.prepare('SELECT 1 FROM follows WHERE follower_id=? AND following_id=?').get(a, b);
const hasRequest = (a, b) => !!db.prepare('SELECT 1 FROM follow_requests WHERE requester_id=? AND target_id=?').get(a, b);
const relation = (me, t) => !me ? 'none' : isFollowing(me, t) ? 'following' : hasRequest(me, t) ? 'requested' : 'none';
const canView = (me, u) => !u.is_private || (me && (me === u.id || isFollowing(me, u.id)));
const findUser = (n) => db.prepare(
  'SELECT id, username, full_name, bio, avatar_url, cover_url, website, location, is_private, created_at FROM users WHERE username = ?'
).get(String(n).toLowerCase());
const count = (sql, id) => db.prepare(sql).get(id).c;

// ---- fixed paths first (before /:username) ----
router.get('/search/users', (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.json([]);
  res.json(db.prepare(`SELECT id, username, full_name, avatar_url, bio, is_private FROM users
    WHERE username LIKE ? OR full_name LIKE ? LIMIT 20`).all(`%${q}%`, `%${q}%`));
});

router.get('/suggestions/list', authMiddleware, (req, res) => {
  res.json(db.prepare(`SELECT id, username, full_name, avatar_url, bio FROM users
    WHERE id != ? AND id NOT IN (SELECT following_id FROM follows WHERE follower_id = ?)
    AND id NOT IN (SELECT target_id FROM follow_requests WHERE requester_id = ?)
    ORDER BY created_at DESC LIMIT 8`).all(req.user.id, req.user.id, req.user.id));
});

router.get('/me/requests', authMiddleware, (req, res) => {
  res.json(db.prepare(`SELECT r.id, r.created_at, u.username, u.full_name, u.avatar_url
    FROM follow_requests r JOIN users u ON u.id = r.requester_id
    WHERE r.target_id = ? ORDER BY r.created_at DESC`).all(req.user.id));
});

router.put('/me/update', authMiddleware, (req, res) => {
  try {
    const { full_name, bio, website, location, avatar_url, cover_url, is_private } = req.body;
    db.prepare(`UPDATE users SET full_name=COALESCE(?,full_name), bio=COALESCE(?,bio), website=COALESCE(?,website),
      location=COALESCE(?,location), avatar_url=COALESCE(?,avatar_url), cover_url=COALESCE(?,cover_url),
      is_private=COALESCE(?,is_private), updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .run(full_name ?? null, bio ?? null, website ?? null, location ?? null, avatar_url ?? null, cover_url ?? null,
        is_private === undefined ? null : (is_private ? 1 : 0), req.user.id);
    res.json(db.prepare(`SELECT id, username, email, full_name, bio, avatar_url, cover_url, website, location, is_private, created_at
      FROM users WHERE id=?`).get(req.user.id));
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

router.post('/requests/:id/accept', authMiddleware, (req, res) => {
  const r = db.prepare('SELECT * FROM follow_requests WHERE id=? AND target_id=?').get(req.params.id, req.user.id);
  if (!r) return res.status(404).json({ error: 'Request not found' });
  db.transaction(() => {
    db.prepare('INSERT OR IGNORE INTO follows (id, follower_id, following_id) VALUES (?,?,?)').run(uuidv4(), r.requester_id, req.user.id);
    db.prepare('DELETE FROM follow_requests WHERE id=?').run(r.id);
  })();
  notify(req, { to: r.requester_id, actor: req.user.id, type: 'follow_accept' });
  res.json({ message: 'Request accepted' });
});

router.post('/requests/:id/reject', authMiddleware, (req, res) => {
  const r = db.prepare('DELETE FROM follow_requests WHERE id=? AND target_id=?').run(req.params.id, req.user.id);
  if (!r.changes) return res.status(404).json({ error: 'Request not found' });
  res.json({ message: 'Request rejected' });
});

// ---- /:username routes ----
router.get('/:username', optionalAuth, (req, res) => {
  try {
    const u = findUser(req.params.username);
    if (!u) return res.status(404).json({ error: 'User not found' });
    const me = req.user?.id;
    res.json({
      ...u,
      followers_count: count('SELECT COUNT(*) c FROM follows WHERE following_id=?', u.id),
      following_count: count('SELECT COUNT(*) c FROM follows WHERE follower_id=?', u.id),
      posts_count: count('SELECT COUNT(*) c FROM posts WHERE user_id=?', u.id),
      relation: relation(me, u.id), can_view: !!canView(me, u), is_me: me === u.id
    });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

router.get('/:username/posts', optionalAuth, (req, res) => {
  try {
    const u = findUser(req.params.username);
    if (!u) return res.status(404).json({ error: 'User not found' });
    const me = req.user?.id || null;
    if (!canView(me, u)) return res.status(403).json({ error: 'This account is private', private: true });
    res.json(db.prepare(`SELECT p.*, u.username, u.full_name, u.avatar_url,
      EXISTS(SELECT 1 FROM likes l WHERE l.post_id=p.id AND l.user_id=@me) AS is_liked,
      EXISTS(SELECT 1 FROM saves s WHERE s.post_id=p.id AND s.user_id=@me) AS is_saved
      FROM posts p JOIN users u ON u.id=p.user_id WHERE p.user_id=@uid ORDER BY p.created_at DESC`).all({ me, uid: u.id }));
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// Follow / Unfollow / Request / Cancel request
router.post('/:username/follow', authMiddleware, (req, res) => {
  try {
    const t = findUser(req.params.username);
    if (!t) return res.status(404).json({ error: 'User not found' });
    const me = req.user.id;
    if (t.id === me) return res.status(400).json({ error: 'Cannot follow yourself' });

    if (isFollowing(me, t.id)) {
      db.prepare('DELETE FROM follows WHERE follower_id=? AND following_id=?').run(me, t.id);
      return res.json({ status: 'none', following: false, message: 'Unfollowed' });
    }
    if (hasRequest(me, t.id)) {
      db.prepare('DELETE FROM follow_requests WHERE requester_id=? AND target_id=?').run(me, t.id);
      return res.json({ status: 'none', following: false, message: 'Request cancelled' });
    }
    if (t.is_private) {
      db.prepare('INSERT INTO follow_requests (id, requester_id, target_id) VALUES (?,?,?)').run(uuidv4(), me, t.id);
      notify(req, { to: t.id, actor: me, type: 'follow_request' });
      return res.json({ status: 'requested', following: false, message: 'Follow request sent' });
    }
    db.prepare('INSERT INTO follows (id, follower_id, following_id) VALUES (?,?,?)').run(uuidv4(), me, t.id);
    notify(req, { to: t.id, actor: me, type: 'follow' });
    res.json({ status: 'following', following: true, message: 'Followed' });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

router.get('/:username/is-following', authMiddleware, (req, res) => {
  const t = findUser(req.params.username);
  if (!t) return res.status(404).json({ error: 'User not found' });
  const status = relation(req.user.id, t.id);
  res.json({ following: status === 'following', status });
});

const listFollow = (col, other) => (req, res) => {
  const u = findUser(req.params.username);
  if (!u) return res.status(404).json({ error: 'User not found' });
  if (!canView(req.user?.id, u)) return res.status(403).json({ error: 'This account is private', private: true });
  res.json(db.prepare(`SELECT x.id, x.username, x.full_name, x.avatar_url, x.bio
    FROM follows f JOIN users x ON f.${other} = x.id WHERE f.${col} = ? ORDER BY f.created_at DESC`).all(u.id));
};
router.get('/:username/followers', optionalAuth, listFollow('following_id', 'follower_id'));
router.get('/:username/following', optionalAuth, listFollow('follower_id', 'following_id'));

module.exports = router;
