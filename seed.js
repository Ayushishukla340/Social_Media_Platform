// Demo accounts + posts + follows. Run: npm run seed  (password for all: demo1234)
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const db = require('./database/db');

const hash = bcrypt.hashSync('demo1234', 10);
const people = [
  ['aarav', 'Aarav Singh', 'Coffee, code and cricket ☕', 0],
  ['priya', 'Priya Verma', 'Designer | Lucknow 🌸', 0],
  ['rohan', 'Rohan Mishra', 'Full-stack dev in the making', 0],
  ['sneha', 'Sneha Gupta', 'Private account demo 🔒', 1]
];
const ids = {};
for (const [un, name, bio, priv] of people) {
  const ex = db.prepare('SELECT id FROM users WHERE username=?').get(un);
  if (ex) { ids[un] = ex.id; continue; }
  const id = uuidv4(); ids[un] = id;
  db.prepare('INSERT INTO users (id, username, email, password_hash, full_name, bio, avatar_url, is_private) VALUES (?,?,?,?,?,?,?,?)')
    .run(id, un, un + '@demo.com', hash, name, bio,
      `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=6c4cf1&color=fff&size=200&bold=true`, priv);
}
const follow = (a, b) => db.prepare('INSERT OR IGNORE INTO follows (id, follower_id, following_id) VALUES (?,?,?)').run(uuidv4(), ids[a], ids[b]);
follow('aarav', 'priya'); follow('priya', 'aarav'); follow('rohan', 'aarav'); follow('aarav', 'rohan');

if (db.prepare('SELECT COUNT(*) c FROM posts WHERE user_id IN (?,?,?)').get(ids.aarav, ids.priya, ids.rohan).c === 0) {
  const posts = [
    ['priya', 'Just finished a new UI design! Would love some feedback 🎨 #design', 90],
    ['aarav', 'Today: practicing React + Node. #coding #webdev', 60],
    ['rohan', 'MERN stack project almost ready. #mern #webdev', 30],
    ['sneha', 'This post is only visible to followers 🔒', 10]
  ];
  for (const [u, c, minsAgo] of posts)
    db.prepare("INSERT INTO posts (id, user_id, content, created_at) VALUES (?,?,?, datetime('now', ?))")
      .run(uuidv4(), ids[u], c, `-${minsAgo} minutes`);
}
console.log('Demo ready. Login: aarav / priya / rohan / sneha  |  password: demo1234');
