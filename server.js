require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const rateLimit = require('express-rate-limit');
const { Server } = require('socket.io');
const { authMiddleware, verifyToken } = require('./middleware/auth');

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const postRoutes = require('./routes/posts');
const notificationRoutes = require('./routes/notifications');
const messageRoutes = require('./routes/messages');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;

// ===== SOCKET.IO =====
const io = new Server(server, { cors: { origin: '*' } });
app.set('io', io);
const online = new Map(); // userId -> number of open tabs/connections

io.use((socket, next) => {
  try { socket.user = verifyToken(socket.handshake.auth?.token); next(); }
  catch (e) { next(new Error('Unauthorized')); }
});

io.on('connection', (socket) => {
  const uid = socket.user.id;
  socket.join('u:' + uid);
  online.set(uid, (online.get(uid) || 0) + 1);
  socket.emit('online_list', [...online.keys()]);
  if (online.get(uid) === 1) socket.broadcast.emit('presence', { userId: uid, online: true });

  // Typing indicator: client emit('typing', { to: userId, typing: true })
  socket.on('typing', ({ to, typing }) => {
    if (to) io.to('u:' + to).emit('typing', { from: uid, typing: !!typing });
  });

  socket.on('disconnect', () => {
    const n = (online.get(uid) || 1) - 1;
    if (n <= 0) { online.delete(uid); socket.broadcast.emit('presence', { userId: uid, online: false }); }
    else online.set(uid, n);
  });
});

// ===== MIDDLEWARE (first) =====
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ===== PHOTO UPLOAD =====
const uploadDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => cb(null, `${Date.now()}-${Math.round(Math.random() * 1e6)}${path.extname(file.originalname).toLowerCase()}`)
  }),
  fileFilter: (req, file, cb) => {
    if (['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(file.mimetype)) cb(null, true);
    else cb(new Error('Only image files are allowed (jpg, png, gif, webp)'), false);
  },
  limits: { fileSize: 10 * 1024 * 1024 }
});

app.post('/api/upload', authMiddleware, upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image file provided' });
  res.json({ url: `/uploads/${req.file.filename}`, message: 'Image uploaded successfully' });
});

// ===== API ROUTES =====
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 50, message: { error: 'Too many attempts. Try again later.' } });
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/posts', postRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/messages', messageRoutes);

app.get('/api/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));
app.get('/{*path}', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ===== ERROR HANDLER (last) =====
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'File too large. Max size is 10MB.' });
    return res.status(400).json({ error: err.message });
  }
  if (err) return res.status(400).json({ error: err.message });
  next();
});

server.listen(PORT, () => console.log(`\n🚀 Social Media Platform running at http://localhost:${PORT}\n`));
