const http  = require('http');
const fs    = require('fs');
const qs    = require('querystring');
const mysql = require('mysql');
const crypto = require('crypto');

const USERS = {
  admin:  'admin123',
  grader: 'cse135grader'
};

const db = mysql.createConnection({
  host: '127.0.0.1', user: 'collector_user',
  password: 'Fm53383S!', database: 'collector_analytics'
});
db.connect(err => {
  if (err) { console.error('DB error:', err); process.exit(1); }
  console.log('MySQL connected.');
});

const sessions = {};

function newSession(user) {
  const id = crypto.randomBytes(16).toString('hex');
  sessions[id] = user;
  return id;
}

function getUser(req) {
  const cookie = req.headers.cookie || '';
  const m = cookie.match(/sid=([a-f0-9]+)/);
  return m ? sessions[m[1]] : null;
}

function readBody(req) {
  return new Promise(r => {
    let b = '';
    req.on('data', c => b += c);
    req.on('end', () => r(qs.parse(b)));
  });
}

function dbQuery(sql) {
  return new Promise((res, rej) =>
    db.query(sql, (err, rows) => err ? rej(err) : res(rows))
  );
}

function html(res, body) {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(body);
}

function json(res, data) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function redirect(res, to) {
  res.writeHead(302, { Location: to });
  res.end();
}

function page(title, user, content) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${title} — Analytics</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: sans-serif; background: #f0f2f5; min-height: 100vh; display: flex; }

    /* Sidebar */
    .sidebar {
      width: 200px; background: #1e293b; color: #fff;
      min-height: 100vh; padding: 24px 0; position: fixed; top:0; left:0; bottom:0;
    }
    .sidebar h2 { padding: 0 20px 20px; font-size: 16px; border-bottom: 1px solid #334155; margin-bottom: 12px; }
    .sidebar a {
      display: block; padding: 10px 20px; color: #94a3b8;
      text-decoration: none; font-size: 14px;
    }
    .sidebar a:hover, .sidebar a.active { color: #fff; background: #334155; }
    .sidebar .logout { margin-top: auto; position: absolute; bottom: 20px; left: 0; right: 0; padding: 0 20px; }
    .sidebar .logout a { color: #ef4444; background: none; padding: 0; }

    /* Main */
    .main { margin-left: 200px; padding: 32px; flex: 1; }
    h1 { font-size: 24px; margin-bottom: 24px; color: #1e293b; }

    /* Cards */
    .cards { display: flex; gap: 16px; margin-bottom: 32px; flex-wrap: wrap; }
    .card {
      background: #fff; border-radius: 8px; padding: 20px 24px;
      box-shadow: 0 1px 3px rgba(0,0,0,.1); min-width: 140px;
    }
    .card .label { font-size: 12px; color: #64748b; margin-bottom: 6px; }
    .card .value { font-size: 32px; font-weight: 700; color: #1e293b; }

    /* Chart containers */
    .charts { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 32px; }
    .chart-box {
      background: #fff; border-radius: 8px; padding: 20px;
      box-shadow: 0 1px 3px rgba(0,0,0,.1);
    }
    .chart-box h3 { font-size: 14px; color: #64748b; margin-bottom: 16px; }
    .chart-box.wide { grid-column: 1 / -1; }

    /* Table */
    .table-wrap {
      background: #fff; border-radius: 8px;
      box-shadow: 0 1px 3px rgba(0,0,0,.1); overflow: hidden;
    }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th { background: #f8fafc; padding: 12px 16px; text-align: left; color: #64748b; font-weight: 600; border-bottom: 1px solid #e2e8f0; }
    td { padding: 10px 16px; border-bottom: 1px solid #f1f5f9; color: #334155; }
    tr:last-child td { border-bottom: none; }
    tr:hover td { background: #f8fafc; }

    /* Login */
    .login-wrap { display:flex; align-items:center; justify-content:center; min-height:100vh; width:100%; background:#f0f2f5; }
    .login-box { background:#fff; border-radius:8px; padding:40px; width:340px; box-shadow:0 2px 8px rgba(0,0,0,.1); }
    .login-box h1 { font-size:22px; margin-bottom:24px; color:#1e293b; }
    .login-box label { display:block; font-size:13px; color:#64748b; margin-bottom:6px; }
    .login-box input { width:100%; border:1px solid #e2e8f0; border-radius:6px; padding:10px 12px; font-size:14px; margin-bottom:16px; outline:none; }
    .login-box input:focus { border-color:#3b82f6; }
    .login-box button { width:100%; background:#1e293b; color:#fff; border:none; border-radius:6px; padding:11px; font-size:15px; cursor:pointer; }
    .login-box button:hover { background:#334155; }
    .error { color:#ef4444; font-size:13px; margin-bottom:14px; }
  </style>
</head>
<body>
  <nav class="sidebar">
    <h2>📊 Analytics</h2>
    <a href="/dashboard">Dashboard</a>
    <a href="/table">Events Table</a>
    <a href="/charts">Charts</a>
    <div class="logout"><a href="/logout">Logout (${user})</a></div>
  </nav>
  <div class="main">
    <h1>${title}</h1>
    ${content}
  </div>
</body>
</html>`;
}

http.createServer(async (req, res) => {
  const path   = req.url.split('?')[0];
  const method = req.method;
  const user   = getUser(req);

  
  if (path === '/login') {
    if (method === 'POST') {
      const body = await readBody(req);
      if (USERS[body.username] && USERS[body.username] === body.password) {
        const sid = newSession(body.username);
        res.writeHead(302, { 'Set-Cookie': `sid=${sid}; HttpOnly; Path=/`, Location: '/dashboard' });
        res.end();
      } else {
        html(res, `<div class="login-wrap"><div class="login-box">
          <h1>Login</h1>
          <p class="error">Invalid username or password.</p>
          <form method="POST" action="/login">
            <label>Username</label><input name="username" autofocus>
            <label>Password</label><input name="password" type="password">
            <button>Sign In</button>
          </form>
        </div></div>`);
      }
      return;
    }
    html(res, `<div class="login-wrap"><div class="login-box">
      <h1>Login</h1>
      <form method="POST" action="/login">
        <label>Username</label><input name="username" autofocus>
        <label>Password</label><input name="password" type="password">
        <button>Sign In</button>
      </form>
    </div></div>`);
    return;
  }

  
  if (path === '/logout') {
    const cookie = req.headers.cookie || '';
    const m = cookie.match(/sid=([a-f0-9]+)/);
    if (m) delete sessions[m[1]];
    res.writeHead(302, { 'Set-Cookie': 'sid=; Max-Age=0; Path=/', Location: '/login' });
    res.end();
    return;
  }

  
  if (!user) return redirect(res, '/login');

  
  if (path === '/') return redirect(res, '/dashboard');

  
  if (path === '/dashboard') {
    try {
      const [summary] = await dbQuery(`
        SELECT
          COUNT(*) AS total,
          SUM(type='pageview')    AS pageviews,
          SUM(type='add_to_cart') AS carts,
          SUM(type='error')       AS errors
        FROM events`);
      html(res, page('Dashboard', user, `
        <div class="cards">
          <div class="card"><div class="label">Total Events</div><div class="value">${summary.total}</div></div>
          <div class="card"><div class="label">Pageviews</div><div class="value">${summary.pageviews||0}</div></div>
          <div class="card"><div class="label">Add to Cart</div><div class="value">${summary.carts||0}</div></div>
          <div class="card"><div class="label">Errors</div><div class="value">${summary.errors||0}</div></div>
        </div>
        <p style="color:#64748b;font-size:14px;">
          Use <a href="/table">Events Table</a> to browse raw data
          or <a href="/charts">Charts</a> to see visualizations.
        </p>
      `));
    } catch(e) { res.writeHead(500); res.end('DB error: ' + e.message); }
    return;
  }

  
  if (path === '/table') {
    try {
      const rows = await dbQuery(`
        SELECT id, type, url, title, session_id, timestamp
        FROM events ORDER BY id DESC LIMIT 100`);
      const trs = rows.map(r => `
        <tr>
          <td>${r.id}</td>
          <td>${r.type}</td>
          <td style="max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${r.url||'—'}</td>
          <td>${r.title||'—'}</td>
          <td style="font-family:monospace;font-size:11px">${r.session_id||'—'}</td>
          <td style="white-space:nowrap">${String(r.timestamp).slice(0,19)}</td>
        </tr>`).join('');
      html(res, page('Events Table', user, `
        <div class="table-wrap">
          <table>
            <thead><tr><th>ID</th><th>Type</th><th>URL</th><th>Title</th><th>Session</th><th>Timestamp</th></tr></thead>
            <tbody>${trs || '<tr><td colspan="6" style="text-align:center;padding:24px;color:#94a3b8">No events yet</td></tr>'}</tbody>
          </table>
        </div>
      `));
    } catch(e) { res.writeHead(500); res.end('DB error: ' + e.message); }
    return;
  }

  
  if (path === '/charts') {
    try {
      const byType  = await dbQuery(`SELECT type, COUNT(*) AS n FROM events GROUP BY type ORDER BY n DESC`);
      const byDay   = await dbQuery(`SELECT DATE(timestamp) AS day, COUNT(*) AS n FROM events GROUP BY DATE(timestamp) ORDER BY day ASC LIMIT 14`);

      const typeLabels = JSON.stringify(byType.map(r => r.type));
      const typeData   = JSON.stringify(byType.map(r => r.n));
      const dayLabels  = JSON.stringify(byDay.map(r => String(r.day).slice(0,10)));
      const dayData    = JSON.stringify(byDay.map(r => r.n));

      html(res, page('Charts', user, `
        <div class="charts">
          <div class="chart-box">
            <h3>Events by Type</h3>
            <canvas id="typeChart"></canvas>
          </div>
          <div class="chart-box wide">
            <h3>Events Per Day (last 14 days)</h3>
            <canvas id="dayChart"></canvas>
          </div>
        </div>
        <script>
          new Chart(document.getElementById('typeChart'), {
            type: 'doughnut',
            data: {
              labels: ${typeLabels},
              datasets: [{ data: ${typeData},
                backgroundColor: ['#3b82f6','#f59e0b','#ef4444','#10b981','#8b5cf6','#06b6d4'] }]
            },
            options: { plugins: { legend: { position: 'bottom' } } }
          });
          new Chart(document.getElementById('dayChart'), {
            type: 'bar',
            data: {
              labels: ${dayLabels},
              datasets: [{ label: 'Events', data: ${dayData},
                backgroundColor: '#3b82f6', borderRadius: 4 }]
            },
            options: { scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } },
                       plugins: { legend: { display: false } } }
          });
        </script>
      `));
    } catch(e) { res.writeHead(500); res.end('DB error: ' + e.message); }
    return;
  }

  res.writeHead(404);
  res.end('Not found');

}).listen(5000, '0.0.0.0', () => {
  console.log('Dashboard running on port 5000');
  console.log('Users: admin/admin123  |  grader/cse135grader');
});