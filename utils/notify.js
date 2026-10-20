const { v4: uuidv4 } = require('uuid');
const db = require('../database/db');

// Saves the notification to the DB and pushes it instantly via Socket.IO
module.exports = function notify(req, { to, actor, type, postId = null, message = '' }) {
  if (!to || to === actor) return;
  const id = uuidv4();
  db.prepare('INSERT INTO notifications (id, user_id, actor_id, type, post_id, message) VALUES (?,?,?,?,?,?)')
    .run(id, to, actor, type, postId, message);
  const n = db.prepare(`SELECT n.*, u.username, u.full_name, u.avatar_url
    FROM notifications n JOIN users u ON u.id = n.actor_id WHERE n.id = ?`).get(id);
  const io = req.app.get('io');
  if (io) io.to('u:' + to).emit('notification', n);
};
