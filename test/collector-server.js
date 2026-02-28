// collector-server.js
const express = require('express');
const mysql = require('mysql2');

const app = express();
app.use(express.json({ limit: '1mb' }));

const db = mysql.createPool({
  host: '127.0.0.1',
  user: 'collector_user',
  password: 'Fm53383S!',
  database: 'analytics'
});

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', 'https://test.chesterhuey.com');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.post('/collect', (req, res) => {
  const payload = req.body;

  if (!payload || !payload.type) {
    return res.status(400).send('Invalid payload');
  }

  const query = `
    INSERT INTO events (type, session_id, user_id, url, event_data)
    VALUES (?, ?, ?, ?, ?)
  `;

  db.query(
    query,
    [
      payload.type,
      payload.session || null,
      payload.userId || null,
      payload.url || null,
      JSON.stringify(payload)
    ],
    (err) => {
      if (err) {
        console.error('MySQL insert error:', err);
        return res.status(500).send('Database error');
      }
      res.status(200).send('OK');
    }
  );
});

app.get('/events', (req, res) => {
  const limit = req.query.limit || 100;
  const type = req.query.type;

  let query = 'SELECT * FROM events';
  const params = [];

  if (type) {
    query += ' WHERE type = ?';
    params.push(type);
  }

  query += ' ORDER BY created_at DESC LIMIT ?';
  params.push(parseInt(limit));

  db.query(query, params, (err, results) => {
    if (err) {
      console.error('MySQL query error:', err);
      return res.status(500).send('Database error');
    }
    res.json(results);
  });
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Collector server running on port ${PORT}`);
});