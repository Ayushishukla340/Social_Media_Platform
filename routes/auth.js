const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const db = require('../database/db');
const { JWT_SECRET } = require('../middleware/auth');

const router = express.Router();
const PUBLIC = 'id, username, email, full_name, bio, avatar_url, cover_url, website, location, is_private, created_at';

router.post('/register', async (req, res) => {
  try {
    let { username, email, password, full_name } = req.body;
    if (!username || !email || !password || !full_name) return res.status(400).json({ error: 'All fields are required' });
    username = String(username).trim().toLowerCase();
    email = String(email).trim().toLowerCase();
    full_name = String(full_name).trim();

    if (!/^[a-z0-9_]{3,20}$/.test(username)) return res.status(400).json({ error: 'Username 3-20 characters: letters, numbers, underscore' });
    if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'Invalid email' });
    if (String(password).length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
    if (db.prepare('SELECT id FROM users WHERE username = ? OR email = ?').get(username, email))
      return res.status(409).json({ error: 'Username or email already exists' });

    const password_hash = await bcrypt.hash(password, 12);
    const id = uuidv4();
    const colors = ['6c63ff', 'ff6584', '43e97b', 'fa709a', '4facfe', 'f093fb', 'f5576c', 'fda085'];
    const avatar_url = `https://ui-avatars.com/api/?name=${encodeURIComponent(full_name)}&background=${colors[Math.floor(Math.random() * colors.length)]}&color=fff&size=200&bold=true`;
    db.prepare('INSERT INTO users (id, username, email, password_hash, full_name, avatar_url) VALUES (?,?,?,?,?,?)')
      .run(id, username, email, password_hash, full_name, avatar_url);

    const token = jwt.sign({ id, username, email }, JWT_SECRET, { expiresIn: '7d' });
    res.status(201).json({ token, user: db.prepare(`SELECT ${PUBLIC} FROM users WHERE id = ?`).get(id) });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

router.post('/login', async (req, res) => {
  try {
    const { identifier, password } = req.body;
    if (!identifier || !password) return res.status(400).json({ error: 'Identifier and password required' });
    const idf = String(identifier).trim().toLowerCase();
    const user = db.prepare('SELECT * FROM users WHERE username = ? OR email = ?').get(idf, idf);
    if (!user || !(await bcrypt.compare(password, user.password_hash)))
      return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign({ id: user.id, username: user.username, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
    const { password_hash, ...safeUser } = user;
    res.json({ token, user: safeUser });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

module.exports = router;
