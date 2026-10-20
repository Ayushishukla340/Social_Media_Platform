require('dotenv').config();
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error('JWT_SECRET is missing. Add it to your .env file.');

const verifyToken = (token) => jwt.verify(token, JWT_SECRET);
const getToken = (req) => (req.headers['authorization'] || '').split(' ')[1];

const authMiddleware = (req, res, next) => {
  const token = getToken(req);
  if (!token) return res.status(401).json({ error: 'Access token required' });
  try { req.user = verifyToken(token); next(); }
  catch (err) { return res.status(403).json({ error: 'Invalid or expired token' }); }
};

// Optional login: sets req.user if the token is valid, otherwise continues without error
const optionalAuth = (req, res, next) => {
  const token = getToken(req);
  if (token) { try { req.user = verifyToken(token); } catch (e) {} }
  next();
};

module.exports = { authMiddleware, optionalAuth, verifyToken, JWT_SECRET };
