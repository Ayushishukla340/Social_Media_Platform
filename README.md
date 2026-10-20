# Connectly – Social Media Platform

Node.js + Express + SQLite + JWT + Socket.IO + vanilla JS frontend.

## Easiest way
Windows: double-click `START.bat`. Mac/Linux: run `./start.sh`

## Manual steps
1. `npm install`
2. `npm run seed`   (optional: demo accounts, password `demo1234`)
3. `npm start`
4. Open in your browser: http://localhost:3000

The `.env` file already contains a `JWT_SECRET`. Use a new one when you deploy.

## Demo accounts (seed ke baad)
aarav, priya, rohan, sneha (private) — password: demo1234

## Structure
- `server.js` – Express + Socket.IO + upload
- `database/db.js` – SQLite tables (auto-create)
- `routes/` – auth, users (follow, requests, privacy), posts, notifications, messages
- `public/index.html` – complete frontend
- `public/uploads/` – uploaded photos
