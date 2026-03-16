const http = require("http");
const mysql = require("mysql");

// MySQL connection
const db = mysql.createConnection({
  host: '127.0.0.1',
  user: 'collector_user',
  password: 'Fm53383S!',
  database: 'collector_analytics'
});

db.connect(() => console.log("Connected to MySQL database."));

function formatTimestamp(ts) {
  if (!ts) return new Date().toISOString().slice(0, 19).replace('T', ' ');
  try {
    return new Date(ts).toISOString().slice(0, 19).replace('T', ' ');
  } catch (e) {
    return new Date().toISOString().slice(0, 19).replace('T', ' ');
  }
}

// Allowed origins
const ALLOWED_ORIGINS = [
  'http://test.chesterhuey.com',
  'https://test.chesterhuey.com'
];

function getCorsHeaders(req) {
  const origin = req.headers.origin || '';
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Credentials": "true"
  };
}

http.createServer((req, res) => {

  if (req.method === "OPTIONS") {
    res.writeHead(204, getCorsHeaders(req));
    res.end();
    return;
  }

  if (req.method === "POST" && req.url === "/collect") {
    let body = "";
    req.on("data", chunk => body += chunk.toString());
    req.on("end", () => {
      let data;
      try { data = JSON.parse(body); }
      catch (e) { res.writeHead(400); return res.end("bad json"); }

      const timestamp = formatTimestamp(data.timestamp);

      const sql = `INSERT INTO events
        (session_id, user_id, type, url, title, referrer, timestamp,
         technographics, timing, resources, vitals, error_count, custom_data)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`;

      db.query(sql, [
        data.session                       || "",
        data.userId                        || "",
        data.type                          || "",
        data.url                           || "",
        data.title                         || "",
        data.referrer                      || "",
        timestamp,
        JSON.stringify(data.technographics || {}),
        JSON.stringify(data.timing         || {}),
        JSON.stringify(data.resources      || {}),
        JSON.stringify(data.vitals         || {}),
        data.errorCount                    || 0,
        JSON.stringify(data.customData || data.data || {})
      ], err => {
        if (err) console.error("DB insert error:", err);
      });

      res.writeHead(200, {
        "Content-Type": "application/json",
        ...getCorsHeaders(req)
      });
      res.end(JSON.stringify({ status: "ok" }));
    });
    return;
  }

  res.writeHead(404);
  res.end();

}).listen(3000, "0.0.0.0", () => console.log("Collector running on port 3000"));