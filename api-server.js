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
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});


app.get('/api/events', (req, res) => {
  db.query('SELECT * FROM events ORDER BY created_at DESC', (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(results);
  });
});

app.get('/api/events/:id', (req, res) => {
  const id = req.params.id;
  db.query('SELECT * FROM events WHERE id = ?', [id], (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    if (results.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json(results[0]);
  });
});

app.post('/api/events', (req, res) => {
  const payload = req.body;
  db.query(
    'INSERT INTO events (type, session_id, user_id, url, event_data) VALUES (?, ?, ?, ?, ?)',
    [payload.type, payload.session || null, payload.userId || null, payload.url || null, JSON.stringify(payload)],
    (err, results) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ insertedId: results.insertId });
    }
  );
});

app.put('/api/events/:id', (req, res) => {
  const id = req.params.id;
  const payload = req.body;
  db.query(
    'UPDATE events SET type=?, session_id=?, user_id=?, url=?, event_data=? WHERE id=?',
    [payload.type, payload.session || null, payload.userId || null, payload.url || null, JSON.stringify(payload), id],
    (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true });
    }
  );
});

app.delete('/api/events/:id', (req, res) => {
  const id = req.params.id;
  db.query('DELETE FROM events WHERE id=?', [id], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});


const PORT = 4000; 
app.listen(PORT, () => {
  console.log(`Reporting API running on port ${PORT}`);
});