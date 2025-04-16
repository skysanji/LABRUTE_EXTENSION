const express = require('express');
const WebSocket = require('ws');
const Database = require('better-sqlite3');
const path = require('path');
const app = express();
const port = 3000;

// DB Setup
const dbPath = path.join(__dirname, 'data', 'chat.db');
const db = new Database(dbPath);

// Tables init
db.prepare(`
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender TEXT,
    message TEXT,
    timestamp TEXT
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS profiles (
    id TEXT PRIMARY KEY,
    name TEXT,
    avatar TEXT,
    pseudo TEXT
  )
`).run();

// Serve static files (optional)
app.use(express.json());
app.use(express.static('public'));

// WebSocket server
const wss = new WebSocket.Server({ noServer: true });

wss.on('connection', (ws) => {
  // Send history on connection
  const storedMessages = db.prepare('SELECT sender, message, timestamp FROM messages ORDER BY id ASC').all();
  ws.send(JSON.stringify({ type: "history", messages: storedMessages }));

  const storedProfiles = db.prepare('SELECT * FROM profiles').all();
  const profilesObj = {};
  storedProfiles.forEach(p => profilesObj[p.id] = p);
  ws.send(JSON.stringify({ type: "profiles", profiles: profilesObj }));

  ws.on('message', (msg) => {
    const data = JSON.parse(msg);

    if (data.type === 'chat') {
      // Insert in DB
      db.prepare('INSERT INTO messages (sender, message, timestamp) VALUES (?, ?, ?)')
        .run(data.sender, data.message, data.timestamp);

      // Broadcast
      wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify(data));
        }
      });
    }

    if (data.type === 'typing' || data.type === 'stop_typing') {
      wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN && client !== ws) {
          client.send(JSON.stringify(data));
        }
      });
    }

    if (data.type === 'profile') {
      // Save or update profile
      db.prepare(`
        INSERT INTO profiles (id, name, avatar, pseudo)
        VALUES (@id, @name, @avatar, @pseudo)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          avatar = excluded.avatar,
          pseudo = excluded.pseudo
      `).run(data);

      // Broadcast profile update
      wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({ type: 'profile_update', profile: data }));
        }
      });
    }
  });
});

// HTTP + WS upgrade
const server = app.listen(port, () => {
  console.log(`✅ Server running on http://localhost:${port}`);
});

server.on('upgrade', (request, socket, head) => {
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
});
