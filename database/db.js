const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'social_media.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL, full_name TEXT NOT NULL, bio TEXT DEFAULT '',
    avatar_url TEXT DEFAULT '', cover_url TEXT DEFAULT '', website TEXT DEFAULT '',
    location TEXT DEFAULT '', created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS follows (
    id TEXT PRIMARY KEY, follower_id TEXT NOT NULL, following_id TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (follower_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (following_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(follower_id, following_id)
  );
  CREATE TABLE IF NOT EXISTS posts (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, content TEXT NOT NULL, image_url TEXT DEFAULT '',
    likes_count INTEGER DEFAULT 0, comments_count INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS likes (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, post_id TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
    UNIQUE(user_id, post_id)
  );
  CREATE TABLE IF NOT EXISTS comments (
    id TEXT PRIMARY KEY, post_id TEXT NOT NULL, user_id TEXT NOT NULL, content TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS follow_requests (
    id TEXT PRIMARY KEY, requester_id TEXT NOT NULL, target_id TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (requester_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (target_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(requester_id, target_id)
  );
  CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, actor_id TEXT NOT NULL, type TEXT NOT NULL,
    post_id TEXT, message TEXT DEFAULT '', is_read INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY, sender_id TEXT NOT NULL, receiver_id TEXT NOT NULL,
    content TEXT DEFAULT '', image_url TEXT DEFAULT '', is_read INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (receiver_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS saves (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, post_id TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
    UNIQUE(user_id, post_id)
  );
  CREATE INDEX IF NOT EXISTS idx_posts_user ON posts(user_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_follows_follower ON follows(follower_id);
  CREATE INDEX IF NOT EXISTS idx_follows_following ON follows(following_id);
  CREATE INDEX IF NOT EXISTS idx_likes_post ON likes(post_id);
  CREATE INDEX IF NOT EXISTS idx_comments_post ON comments(post_id);
  CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_msg_pair ON messages(sender_id, receiver_id, created_at);
`);

// Safely add the new column to older databases (no data is lost)
const cols = db.prepare('PRAGMA table_info(users)').all().map(c => c.name);
if (!cols.includes('is_private')) db.exec('ALTER TABLE users ADD COLUMN is_private INTEGER DEFAULT 0');

module.exports = db;
