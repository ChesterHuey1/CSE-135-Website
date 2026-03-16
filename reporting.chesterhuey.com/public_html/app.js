/**
 * app.js — Analytics Reporting Server
 *
 * Authentication: cookie-based sessions (sid cookie)
 * Authorization:  role-based — super_admin, analyst, viewer
 *
 * Roles:
 *   super_admin — all routes + user management (/api/users)
 *   analyst     — allowed sections defined per-user in users.sections
 *                 e.g. 'overview,performance' or 'overview,performance,errors'
 *   viewer      — saved reports only (read-only /api/reports)
 *
 * Routes:
 *   POST   /api/login
 *   POST   /api/logout
 *   GET    /api/me
 *
 *   GET    /api/users          (super_admin only)
 *   POST   /api/users          (super_admin only)
 *   PUT    /api/users/:id      (super_admin only)
 *   DELETE /api/users/:id      (super_admin only)
 *
 *   GET    /api/overview       (super_admin, analyst w/ overview section)
 *   GET    /api/performance    (super_admin, analyst w/ performance section)
 *   GET    /api/errors         (super_admin, analyst w/ errors section)
 *
 *   GET/POST/PUT/DELETE /api/pageviews|sessions|events|errors|page_exits|pageview_resources
 *
 *   POST   /collect            (no auth — receives collector beacons)
 *
 *   GET    /dashboard          (serves dashboard.html after auth check)
 *   GET    /dashboard.html|css|js  (static files)
 */

'use strict';

const http   = require('http');
const fs     = require('fs');
const path   = require('path');
const qs     = require('querystring');
const mysql  = require('mysql');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

// ── Database ──────────────────────────────────────────────────
const db = mysql.createPool({
  host:            '127.0.0.1',
  user:            'collector_user',
  password:        'Fm53383S!',
  database:        'analytics',
  connectionLimit: 5
});
db.query('SELECT 1', err => {
  if (err) { console.error('DB error:', err); process.exit(1); }
  console.log('MySQL connected.');
});

function dbQuery(sql, params) {
  return new Promise((res, rej) =>
    db.query(sql, params || [], (err, rows) => err ? rej(err) : res(rows))
  );
}

// ── Session Store ─────────────────────────────────────────────
// In-memory store: { sid → { id, email, displayName, role, sections[] } }
const sessionStore = {};
const SESSION_TTL  = 8 * 60 * 60 * 1000; // 8 hours

function createSession(user) {
  // Regenerate ID on every login (prevents session fixation)
  const sid = crypto.randomBytes(32).toString('hex');
  sessionStore[sid] = {
    user,
    expires: Date.now() + SESSION_TTL
  };
  return sid;
}

function getSession(req) {
  const cookie = req.headers.cookie || '';
  const m = cookie.match(/sid=([a-f0-9]+)/);
  if (!m) return null;
  const entry = sessionStore[m[1]];
  if (!entry) return null;
  if (Date.now() > entry.expires) {
    delete sessionStore[m[1]];
    return null;
  }
  // Slide expiry on activity
  entry.expires = Date.now() + SESSION_TTL;
  return entry.user;
}

function destroySession(req) {
  const cookie = req.headers.cookie || '';
  const m = cookie.match(/sid=([a-f0-9]+)/);
  if (m) delete sessionStore[m[1]];
}

// ── Authorization helpers ─────────────────────────────────────

/**
 * Returns the user from the session or sends 401.
 */
function requireAuth(req, res) {
  const user = getSession(req);
  if (!user) {
    res.writeHead(401, corsHeaders({ 'Content-Type': 'application/json' }));
    res.end(JSON.stringify({ error: 'Unauthorized' }));
    return null;
  }
  return user;
}

/**
 * Returns true if the user can access the given section.
 * super_admin: always yes
 * analyst: only if section is in their sections array
 * viewer: never (viewers use /api/reports only)
 */
function canAccess(user, section) {
  if (user.role === 'super_admin') return true;
  if (user.role === 'analyst') {
    return Array.isArray(user.sections) && user.sections.includes(section);
  }
  return false;
}

/**
 * Sends 403 Forbidden.
 */
function forbidden(res) {
  res.writeHead(403, corsHeaders({ 'Content-Type': 'application/json' }));
  res.end(JSON.stringify({ error: 'Forbidden — insufficient permissions' }));
}

// ── Response helpers ──────────────────────────────────────────
function corsHeaders(extra) {
  return Object.assign({
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  }, extra || {});
}

function json(res, data, status) {
  res.writeHead(status || 200, corsHeaders({ 'Content-Type': 'application/json' }));
  res.end(JSON.stringify(data));
}

function html(res, body, status) {
  res.writeHead(status || 200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(body);
}

function redirect(res, to) {
  res.writeHead(302, { Location: to });
  res.end();
}

function readBody(req) {
  return new Promise(r => {
    let b = '';
    req.on('data', c => b += c);
    req.on('end', () => r(b));
  });
}

// ── Static file serving ───────────────────────────────────────
const STATIC = {
  '/dashboard.html': 'text/html',
  '/dashboard.css':  'text/css',
  '/dashboard.js':   'text/javascript',
};

function serveStatic(req, res) {
  const urlPath = req.url.split('?')[0];
  const mime = STATIC[urlPath];
  if (!mime) return false;
  const filepath = path.join(__dirname, urlPath.slice(1));
  try {
    res.writeHead(200, { 'Content-Type': mime });
    res.end(fs.readFileSync(filepath));
  } catch (e) {
    res.writeHead(404); res.end('Not found');
  }
  return true;
}

// ── REST API (raw tables) ─────────────────────────────────────
const ALLOWED_TABLES = {
  pageviews: 'id', sessions: 'id', events: 'id',
  errors: 'id', page_exits: 'id', pageview_resources: 'id'
};

async function handleTableAPI(req, res, parts, method) {
  const user = requireAuth(req, res);
  if (!user) return;
  if (user.role !== 'super_admin' && user.role !== 'analyst') return forbidden(res);

  const tableName = parts[2];
  const id        = parts[3];
  if (!ALLOWED_TABLES[tableName]) {
    return json(res, { error: 'Unknown table', valid: Object.keys(ALLOWED_TABLES) }, 404);
  }
  const pk = ALLOWED_TABLES[tableName];

  try {
    if (method === 'GET' && !id) {
      const rows = await dbQuery(`SELECT * FROM \`${tableName}\` ORDER BY ${pk} DESC LIMIT 500`);
      return json(res, { count: rows.length, data: rows });
    }
    if (method === 'GET' && id) {
      const rows = await dbQuery(`SELECT * FROM \`${tableName}\` WHERE ${pk} = ?`, [id]);
      if (!rows.length) return json(res, { error: 'Not found' }, 404);
      return json(res, rows[0]);
    }
    if (method === 'POST') {
      if (user.role !== 'super_admin') return forbidden(res);
      const raw  = await readBody(req);
      const body = JSON.parse(raw);
      delete body[pk];
      const keys = Object.keys(body), vals = Object.values(body);
      if (!keys.length) return json(res, { error: 'Empty body' }, 400);
      const result = await dbQuery(
        `INSERT INTO \`${tableName}\` (${keys.map(k=>`\`${k}\``).join(',')}) VALUES (${keys.map(()=>'?').join(',')})`, vals
      );
      return json(res, { id: result.insertId, message: 'Created' }, 201);
    }
    if (method === 'PUT' && id) {
      if (user.role !== 'super_admin') return forbidden(res);
      const raw  = await readBody(req);
      const body = JSON.parse(raw);
      delete body[pk];
      const keys = Object.keys(body), vals = Object.values(body);
      if (!keys.length) return json(res, { error: 'Empty body' }, 400);
      const result = await dbQuery(
        `UPDATE \`${tableName}\` SET ${keys.map(k=>`\`${k}\` = ?`).join(', ')} WHERE ${pk} = ?`, [...vals, id]
      );
      if (!result.affectedRows) return json(res, { error: 'Not found' }, 404);
      return json(res, { message: 'Updated' });
    }
    if (method === 'DELETE' && id) {
      if (user.role !== 'super_admin') return forbidden(res);
      const result = await dbQuery(`DELETE FROM \`${tableName}\` WHERE ${pk} = ?`, [id]);
      if (!result.affectedRows) return json(res, { error: 'Not found' }, 404);
      return json(res, { message: 'Deleted' });
    }
    json(res, { error: 'Method not allowed' }, 405);
  } catch (e) {
    console.error('[tableAPI]', e.message);
    json(res, { error: e.message }, 500);
  }
}

// ── User management API (/api/users) ──────────────────────────
async function handleUsersAPI(req, res, parts, method) {
  const user = requireAuth(req, res);
  if (!user) return;
  if (user.role !== 'super_admin') return forbidden(res);

  const id = parts[3]; // /api/users/:id

  try {
    // GET /api/users — list all
    if (method === 'GET' && !id) {
      const rows = await dbQuery(
        `SELECT id, email, display_name, role, sections, created_at, last_login FROM users ORDER BY id ASC`
      );
      return json(res, { count: rows.length, data: rows });
    }

    // GET /api/users/:id
    if (method === 'GET' && id) {
      const rows = await dbQuery(
        `SELECT id, email, display_name, role, sections, created_at, last_login FROM users WHERE id = ?`, [id]
      );
      if (!rows.length) return json(res, { error: 'Not found' }, 404);
      return json(res, rows[0]);
    }

    // POST /api/users — create user
    if (method === 'POST') {
      const raw  = await readBody(req);
      const body = JSON.parse(raw);
      const { email, display_name, password, role, sections } = body;

      if (!email || !display_name || !password || !role) {
        return json(res, { error: 'email, display_name, password, role are required' }, 400);
      }
      if (!['super_admin', 'analyst', 'viewer'].includes(role)) {
        return json(res, { error: 'Invalid role' }, 400);
      }

      const hash   = await bcrypt.hash(password, 10);
      const result = await dbQuery(
        `INSERT INTO users (email, display_name, password_hash, role, sections) VALUES (?,?,?,?,?)`,
        [email, display_name, hash, role, sections || null]
      );
      return json(res, { id: result.insertId, message: 'User created' }, 201);
    }

    // PUT /api/users/:id — update user
    if (method === 'PUT' && id) {
      const raw  = await readBody(req);
      const body = JSON.parse(raw);

      // Prevent demoting the only super_admin
      if (body.role && body.role !== 'super_admin') {
        const [check] = await dbQuery(
          `SELECT COUNT(*) AS n FROM users WHERE role = 'super_admin'`
        );
        const [current] = await dbQuery(`SELECT role FROM users WHERE id = ?`, [id]);
        if (current && current.role === 'super_admin' && check.n <= 1) {
          return json(res, { error: 'Cannot demote the only super admin' }, 400);
        }
      }

      const fields = [];
      const vals   = [];

      if (body.email)        { fields.push('email = ?');        vals.push(body.email); }
      if (body.display_name) { fields.push('display_name = ?'); vals.push(body.display_name); }
      if (body.role)         { fields.push('role = ?');         vals.push(body.role); }
      if (body.sections !== undefined) { fields.push('sections = ?'); vals.push(body.sections || null); }
      if (body.password)     {
        const hash = await bcrypt.hash(body.password, 10);
        fields.push('password_hash = ?');
        vals.push(hash);
      }

      if (!fields.length) return json(res, { error: 'Nothing to update' }, 400);
      vals.push(id);

      const result = await dbQuery(
        `UPDATE users SET ${fields.join(', ')} WHERE id = ?`, vals
      );
      if (!result.affectedRows) return json(res, { error: 'Not found' }, 404);
      return json(res, { message: 'Updated' });
    }

    // DELETE /api/users/:id
    if (method === 'DELETE' && id) {
      // Prevent deleting the only super_admin
      const [check] = await dbQuery(`SELECT COUNT(*) AS n FROM users WHERE role = 'super_admin'`);
      const [current] = await dbQuery(`SELECT role FROM users WHERE id = ?`, [id]);
      if (current && current.role === 'super_admin' && check.n <= 1) {
        return json(res, { error: 'Cannot delete the only super admin' }, 400);
      }
      // Prevent self-delete
      if (String(current && current.id) === String(user.id)) {
        return json(res, { error: 'Cannot delete your own account' }, 400);
      }
      const result = await dbQuery(`DELETE FROM users WHERE id = ?`, [id]);
      if (!result.affectedRows) return json(res, { error: 'Not found' }, 404);
      return json(res, { message: 'Deleted' });
    }

    json(res, { error: 'Method not allowed' }, 405);
  } catch (e) {
    console.error('[usersAPI]', e.message);
    json(res, { error: e.message }, 500);
  }
}

// ── Dashboard data APIs ───────────────────────────────────────

async function handleOverview(req, res) {
  const user = requireAuth(req, res);
  if (!user) return;
  if (!canAccess(user, 'overview')) return forbidden(res);

  const params = new URLSearchParams(req.url.split('?')[1] || '');
  const start  = params.get('start') || new Date(Date.now() - 30*86400000).toISOString().slice(0,10);
  const end    = params.get('end')   || new Date().toISOString().slice(0,10);

  try {
    const [totals] = await dbQuery(`
      SELECT
        COUNT(*)                                                AS total_pageviews,
        COUNT(DISTINCT session_id)                             AS unique_sessions,
        ROUND(AVG(nt_load_event), 0)                          AS avg_load_ms,
        SUM(error_count)                                       AS total_errors
      FROM pageviews
      WHERE collected_at BETWEEN ? AND DATE_ADD(?, INTERVAL 1 DAY)
    `, [start, end]);

    const byDay = await dbQuery(`
      SELECT DATE(collected_at) AS day, COUNT(*) AS views
      FROM pageviews
      WHERE collected_at BETWEEN ? AND DATE_ADD(?, INTERVAL 1 DAY)
      GROUP BY DATE(collected_at) ORDER BY day ASC
    `, [start, end]);

    const topPages = await dbQuery(`
      SELECT url, COUNT(*) AS views
      FROM pageviews
      WHERE collected_at BETWEEN ? AND DATE_ADD(?, INTERVAL 1 DAY)
      GROUP BY url ORDER BY views DESC LIMIT 10
    `, [start, end]);

    json(res, { totals, byDay, topPages });
  } catch (e) {
    json(res, { error: e.message }, 500);
  }
}

async function handlePerformance(req, res) {
  const user = requireAuth(req, res);
  if (!user) return;
  if (!canAccess(user, 'performance')) return forbidden(res);

  const params = new URLSearchParams(req.url.split('?')[1] || '');
  const start  = params.get('start') || new Date(Date.now() - 30*86400000).toISOString().slice(0,10);
  const end    = params.get('end')   || new Date().toISOString().slice(0,10);

  try {
    const [vitals] = await dbQuery(`
      SELECT
        ROUND(AVG(lcp),0)           AS avg_lcp,
        ROUND(AVG(cls),3)           AS avg_cls,
        ROUND(AVG(inp),0)           AS avg_inp,
        ROUND(AVG(nt_ttfb),0)       AS avg_ttfb,
        ROUND(AVG(nt_load_event),0) AS avg_load,
        ROUND(AVG(nt_dom_complete),0) AS avg_dom
      FROM pageviews
      WHERE collected_at BETWEEN ? AND DATE_ADD(?, INTERVAL 1 DAY)
    `, [start, end]);

    const perPage = await dbQuery(`
      SELECT url,
        COUNT(*)                      AS views,
        ROUND(AVG(lcp),0)             AS avg_lcp,
        ROUND(AVG(nt_ttfb),0)         AS avg_ttfb,
        ROUND(AVG(nt_load_event),0)   AS avg_load
      FROM pageviews
      WHERE collected_at BETWEEN ? AND DATE_ADD(?, INTERVAL 1 DAY)
      GROUP BY url ORDER BY avg_lcp DESC LIMIT 20
    `, [start, end]);

    json(res, { vitals, perPage });
  } catch (e) {
    json(res, { error: e.message }, 500);
  }
}

async function handleErrorsReport(req, res) {
  const user = requireAuth(req, res);
  if (!user) return;
  if (!canAccess(user, 'errors')) return forbidden(res);

  const params = new URLSearchParams(req.url.split('?')[1] || '');
  const start  = params.get('start') || new Date(Date.now() - 30*86400000).toISOString().slice(0,10);
  const end    = params.get('end')   || new Date().toISOString().slice(0,10);

  try {
    const byDay = await dbQuery(`
      SELECT DATE(occurred_at) AS day, COUNT(*) AS count
      FROM errors
      WHERE occurred_at BETWEEN ? AND DATE_ADD(?, INTERVAL 1 DAY)
      GROUP BY DATE(occurred_at) ORDER BY day ASC
    `, [start, end]);

    const grouped = await dbQuery(`
      SELECT
        message,
        error_type,
        COUNT(*)              AS occurrences,
        MIN(occurred_at)      AS first_seen,
        MAX(occurred_at)      AS last_seen,
        source_file,
        line_number
      FROM errors
      WHERE occurred_at BETWEEN ? AND DATE_ADD(?, INTERVAL 1 DAY)
      GROUP BY message, error_type, source_file, line_number
      ORDER BY occurrences DESC LIMIT 50
    `, [start, end]);

    json(res, { byDay, grouped });
  } catch (e) {
    json(res, { error: e.message }, 500);
  }
}

// ── /collect endpoint ─────────────────────────────────────────
async function handleCollect(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  if (req.method !== 'POST')    { res.writeHead(405); res.end(); return; }

  let payload;
  try {
    const raw = await readBody(req);
    payload = JSON.parse(raw);
  } catch (e) { res.writeHead(400); res.end('Bad JSON'); return; }

  try {
    const sid    = payload.session || null;
    const userId = payload.userId  || null;
    const ts     = payload.timestamp ? new Date(payload.timestamp) : new Date();
    const tech   = payload.technographics || {};
    const net    = tech.network  || {};
    const timing = payload.timing    || {};
    const resources = payload.resources || {};
    const vitals    = payload.vitals    || {};

    if (sid) {
      await dbQuery(`
        INSERT INTO sessions (
          id, user_id, started_at, last_seen_at,
          user_agent, language, cookies_enabled,
          viewport_width, viewport_height,
          screen_width, screen_height, pixel_ratio,
          hardware_cores, device_memory_gb,
          color_scheme, timezone,
          net_effective_type, net_downlink, net_rtt, net_save_data
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON DUPLICATE KEY UPDATE
          last_seen_at       = VALUES(last_seen_at),
          user_id            = COALESCE(VALUES(user_id), user_id),
          viewport_width     = VALUES(viewport_width),
          viewport_height    = VALUES(viewport_height),
          net_effective_type = VALUES(net_effective_type),
          net_downlink       = VALUES(net_downlink),
          net_rtt            = VALUES(net_rtt)
      `, [
        sid, userId, ts, ts,
        tech.userAgent || null, tech.language || null,
        tech.cookiesEnabled != null ? (tech.cookiesEnabled ? 1 : 0) : null,
        tech.viewportWidth || null, tech.viewportHeight || null,
        tech.screenWidth || null, tech.screenHeight || null,
        tech.pixelRatio || null, tech.cores || null,
        tech.memory || null, tech.colorScheme || null,
        tech.timezone || null, net.effectiveType || null,
        net.downlink || null, net.rtt || null,
        net.saveData != null ? (net.saveData ? 1 : 0) : null
      ]);
    }

    if (payload.type === 'pageview') {
      const pv = await dbQuery(`
        INSERT INTO pageviews (
          session_id, user_id, url, page_title, referrer, collected_at, error_count,
          nt_dns_lookup, nt_tcp_connect, nt_tls_handshake, nt_ttfb, nt_download,
          nt_dom_interactive, nt_dom_complete, nt_load_event, nt_fetch_time,
          nt_transfer_size, nt_header_size, lcp, cls, inp, total_resources
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `, [
        sid, userId, payload.url || null, payload.title || null,
        payload.referrer || null, ts, payload.errorCount || 0,
        timing.dnsLookup || null, timing.tcpConnect || null,
        timing.tlsHandshake || null, timing.ttfb || null,
        timing.download || null, timing.domInteractive || null,
        timing.domComplete || null, timing.loadEvent || null,
        timing.fetchTime || null, timing.transferSize || null,
        timing.headerSize || null,
        vitals.lcp || null, vitals.cls || null, vitals.inp || null,
        resources.totalResources || null
      ]);

      if (resources.byType && pv.insertId) {
        for (const [type, data] of Object.entries(resources.byType)) {
          if (data.count > 0) {
            await dbQuery(
              `INSERT INTO pageview_resources (pageview_id, initiator_type, resource_count, total_size, total_duration) VALUES (?,?,?,?,?)`,
              [pv.insertId, type, data.count, data.totalSize, data.totalDuration]
            );
          }
        }
      }
    } else if (payload.type === 'page_exit') {
      await dbQuery(
        `INSERT INTO page_exits (session_id, url, time_on_page_ms, error_count, exited_at, lcp, cls, inp) VALUES (?,?,?,?,?,?,?,?)`,
        [sid, payload.url || null, payload.timeOnPage || null, payload.errorCount || 0, ts, vitals.lcp || null, vitals.cls || null, vitals.inp || null]
      );
    } else if (payload.type === 'event') {
      await dbQuery(
        `INSERT INTO events (session_id, user_id, event_name, url, occurred_at, event_data, custom_data) VALUES (?,?,?,?,?,?,?)`,
        [sid, userId, payload.event || 'unknown', payload.url || null, ts,
         payload.data ? JSON.stringify(payload.data) : null,
         payload.customData ? JSON.stringify(payload.customData) : null]
      );
    } else if (payload.type === 'error') {
      const err = payload.error || {};
      await dbQuery(
        `INSERT INTO errors (session_id, url, occurred_at, error_type, message, source_file, line_number, column_number, stack_trace, tag_name, resource_src) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [sid, payload.url || null, ts, err.type || 'unknown',
         err.message || null, err.source || null, err.line || null,
         err.column || null, err.stack || null, err.tagName || null, err.src || null]
      );
    }

    res.writeHead(204); res.end();
  } catch (e) {
    console.error('[collect] DB error:', e.message);
    res.writeHead(500); res.end('DB error');
  }
}

// ── Legacy dashboard UI (server-rendered) ─────────────────────
function legacyPage(title, user, content) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${title} — Analytics</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:sans-serif;background:#f0f2f5;min-height:100vh;display:flex}
    .sidebar{width:200px;background:#1e293b;color:#fff;min-height:100vh;padding:24px 0;position:fixed;top:0;left:0;bottom:0}
    .sidebar h2{padding:0 20px 20px;font-size:16px;border-bottom:1px solid #334155;margin-bottom:12px}
    .sidebar a{display:block;padding:10px 20px;color:#94a3b8;text-decoration:none;font-size:14px}
    .sidebar a:hover{color:#fff;background:#334155}
    .sidebar .logout{position:absolute;bottom:20px;left:0;right:0;padding:0 20px}
    .sidebar .logout a{color:#ef4444;background:none;padding:0}
    .main{margin-left:200px;padding:32px;flex:1}
    h1{font-size:24px;margin-bottom:24px;color:#1e293b}
    .cards{display:flex;gap:16px;margin-bottom:32px;flex-wrap:wrap}
    .card{background:#fff;border-radius:8px;padding:20px 24px;box-shadow:0 1px 3px rgba(0,0,0,.1);min-width:140px}
    .card .label{font-size:12px;color:#64748b;margin-bottom:6px}
    .card .value{font-size:32px;font-weight:700;color:#1e293b}
    .charts{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:32px}
    .chart-box{background:#fff;border-radius:8px;padding:20px;box-shadow:0 1px 3px rgba(0,0,0,.1)}
    .chart-box h3{font-size:14px;color:#64748b;margin-bottom:16px}
    .chart-box.wide{grid-column:1/-1}
    .table-wrap{background:#fff;border-radius:8px;box-shadow:0 1px 3px rgba(0,0,0,.1);overflow:hidden}
    table{width:100%;border-collapse:collapse;font-size:13px}
    th{background:#f8fafc;padding:12px 16px;text-align:left;color:#64748b;font-weight:600;border-bottom:1px solid #e2e8f0}
    td{padding:10px 16px;border-bottom:1px solid #f1f5f9;color:#334155}
    tr:last-child td{border-bottom:none}
    tr:hover td{background:#f8fafc}
    .login-wrap{display:flex;align-items:center;justify-content:center;min-height:100vh;width:100%;background:#f0f2f5}
    .login-box{background:#fff;border-radius:8px;padding:40px;width:340px;box-shadow:0 2px 8px rgba(0,0,0,.1)}
    .login-box h1{font-size:22px;margin-bottom:24px;color:#1e293b}
    .login-box label{display:block;font-size:13px;color:#64748b;margin-bottom:6px}
    .login-box input{width:100%;border:1px solid #e2e8f0;border-radius:6px;padding:10px 12px;font-size:14px;margin-bottom:16px;outline:none}
    .login-box input:focus{border-color:#3b82f6}
    .login-box button{width:100%;background:#1e293b;color:#fff;border:none;border-radius:6px;padding:11px;font-size:15px;cursor:pointer}
    .login-box button:hover{background:#334155}
    .error{color:#ef4444;font-size:13px;margin-bottom:14px}
    .comment-section{margin-top:32px}
    .comment-section h2{font-size:15px;font-weight:600;color:#1e293b;margin-bottom:16px}
    .comment-card{background:#fff;border-radius:8px;padding:18px 20px;box-shadow:0 1px 3px rgba(0,0,0,.08);border-left:4px solid #3b82f6;margin-bottom:12px}
    .comment-card.warn{border-left-color:#f59e0b}
    .comment-card.bad{border-left-color:#ef4444}
    .comment-card.good{border-left-color:#10b981}
    .comment-title{font-size:14px;font-weight:600;color:#1e293b;margin-bottom:6px}
    .comment-text{font-size:13px;color:#475569;line-height:1.6}
  </style>
</head>
<body>
  <nav class="sidebar">
    <h2>📊 Analytics</h2>
    <a href="/dashboard">Dashboard</a>
    <a href="/table">Pageviews</a>
    <a href="/events">Events</a>
    <a href="/errors">Errors</a>
    <a href="/charts">Charts</a>
    <a href="/dashboard.html">D3 View</a>
    <a href="/admin">User Admin</a>
    <div class="logout"><a href="/logout">Logout (${title === 'Login' ? '' : user})</a></div>
  </nav>
  <div class="main">
    <h1>${title}</h1>
    ${content}
  </div>
</body>
</html>`;
}

// ── HTTP Server ───────────────────────────────────────────────
http.createServer(async (req, res) => {
  const urlPath = req.url.split('?')[0];
  const method  = req.method;
  const parts   = urlPath.split('/');

  // CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, corsHeaders()); res.end(); return;
  }

  // Static files
  if (serveStatic(req, res)) return;

  // Collector beacon — no auth
  if (urlPath === '/collect') return handleCollect(req, res);

  // ── Auth API ────────────────────────────────────────────────
  if (urlPath === '/api/login' && method === 'POST') {
    const raw  = await readBody(req);
    let body;
    try { body = JSON.parse(raw); } catch { return json(res, { error: 'Bad JSON' }, 400); }

    const { email, password } = body;
    if (!email || !password) return json(res, { error: 'Email and password required' }, 400);

    try {
      const rows = await dbQuery(
        `SELECT id, email, display_name, password_hash, role, sections FROM users WHERE email = ?`,
        [email]
      );

      // Same error message for "no user" and "wrong password" — prevents email enumeration
      if (!rows.length || !(await bcrypt.compare(password, rows[0].password_hash))) {
        return json(res, { success: false, error: 'Invalid credentials' }, 401);
      }

      const u = rows[0];
      const sessionUser = {
        id:          u.id,
        email:       u.email,
        displayName: u.display_name,
        role:        u.role,
        sections:    u.sections ? u.sections.split(',') : []
      };

      // Update last_login
      await dbQuery(`UPDATE users SET last_login = NOW() WHERE id = ?`, [u.id]);

      // Create session (new ID each login — prevents session fixation)
      const sid = createSession(sessionUser);

      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Set-Cookie': `sid=${sid}; HttpOnly; Path=/; SameSite=Strict`
      });
      res.end(JSON.stringify({ success: true, user: sessionUser }));
    } catch (e) {
      json(res, { error: e.message }, 500);
    }
    return;
  }

  if (urlPath === '/api/logout' && method === 'POST') {
    destroySession(req);
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Set-Cookie': 'sid=; HttpOnly; Path=/; Max-Age=0'
    });
    res.end(JSON.stringify({ success: true }));
    return;
  }

  if (urlPath === '/api/me' && method === 'GET') {
    const user = getSession(req);
    if (!user) return json(res, { error: 'Unauthorized' }, 401);
    return json(res, { user });
  }

  // ── User management ─────────────────────────────────────────
  if (parts[1] === 'api' && parts[2] === 'users') {
    return handleUsersAPI(req, res, parts, method);
  }

  // ── Dashboard data APIs ─────────────────────────────────────
  if (urlPath.startsWith('/api/overview'))    return handleOverview(req, res);
  if (urlPath.startsWith('/api/performance')) return handlePerformance(req, res);
  if (urlPath.startsWith('/api/errors') && parts.length === 3) return handleErrorsReport(req, res);

  // ── Raw table REST API ──────────────────────────────────────
  if (parts[1] === 'api' && ALLOWED_TABLES[parts[2]]) {
    return handleTableAPI(req, res, parts, method);
  }

  // ── Legacy server-rendered UI ───────────────────────────────
  const user = getSession(req);

  if (urlPath === '/login') {
    if (user) return redirect(res, '/dashboard');
    html(res, `<div class="login-wrap"><div class="login-box">
      <h1>Analytics Login</h1>
      <form method="POST" action="/login-form">
        <label>Email</label><input name="email" type="email" autocomplete="email" autofocus>
        <label>Password</label><input name="password" type="password" autocomplete="current-password">
        <button>Sign In</button>
      </form></div></div>`);
    return;
  }

  if (urlPath === '/login-form' && method === 'POST') {
    const raw  = await readBody(req);
    const body = qs.parse(raw);
    try {
      const rows = await dbQuery(
        `SELECT id, email, display_name, password_hash, role, sections FROM users WHERE email = ?`,
        [body.email]
      );
      if (!rows.length || !(await bcrypt.compare(body.password || '', rows[0].password_hash))) {
        html(res, `<div class="login-wrap"><div class="login-box">
          <h1>Analytics Login</h1>
          <p class="error">Invalid email or password.</p>
          <form method="POST" action="/login-form">
            <label>Email</label><input name="email" type="email" value="${body.email || ''}" autofocus>
            <label>Password</label><input name="password" type="password">
            <button>Sign In</button>
          </form></div></div>`);
        return;
      }
      const u = rows[0];
      const sessionUser = {
        id: u.id, email: u.email, displayName: u.display_name,
        role: u.role, sections: u.sections ? u.sections.split(',') : []
      };
      await dbQuery(`UPDATE users SET last_login = NOW() WHERE id = ?`, [u.id]);
      const sid = createSession(sessionUser);
      res.writeHead(302, {
        'Set-Cookie': `sid=${sid}; HttpOnly; Path=/; SameSite=Strict`,
        Location: '/dashboard'
      });
      res.end();
    } catch (e) {
      html(res, `<div class="login-wrap"><div class="login-box"><h1>Error</h1><p>${e.message}</p></div></div>`, 500);
    }
    return;
  }

  if (urlPath === '/logout') {
    destroySession(req);
    res.writeHead(302, { 'Set-Cookie': 'sid=; Max-Age=0; Path=/', Location: '/login' });
    res.end();
    return;
  }

  if (!user) return redirect(res, '/login');
  if (urlPath === '/') return redirect(res, '/dashboard');
  if (urlPath === '/d3') return redirect(res, '/dashboard.html');

  // ── Dashboard ───────────────────────────────────────────────
  if (urlPath === '/dashboard') {
    try {
      const [pvCount]   = await dbQuery(`SELECT COUNT(*) AS n FROM pageviews`);
      const [sessCount] = await dbQuery(`SELECT COUNT(*) AS n FROM sessions`);
      const [evtCount]  = await dbQuery(`SELECT COUNT(*) AS n FROM events`);
      const [errCount]  = await dbQuery(`SELECT COUNT(*) AS n FROM errors`);
      const [avgVitals] = await dbQuery(`
        SELECT ROUND(AVG(lcp),0) AS avg_lcp, ROUND(AVG(cls),3) AS avg_cls,
               ROUND(AVG(inp),0) AS avg_inp, ROUND(AVG(nt_ttfb),0) AS avg_ttfb
        FROM pageviews WHERE lcp IS NOT NULL OR cls IS NOT NULL`);

      const topItems   = await dbQuery(`SELECT event_data, COUNT(*) AS n FROM events WHERE event_name='add_to_cart' GROUP BY event_data ORDER BY n DESC LIMIT 2`);
      const [exitAvg]  = await dbQuery(`SELECT ROUND(AVG(time_on_page_ms)/1000,1) AS avg_seconds FROM page_exits WHERE time_on_page_ms IS NOT NULL`);
      const [ttfbShare]= await dbQuery(`SELECT ROUND(AVG(nt_ttfb)/NULLIF(AVG(nt_load_event),0)*100,0) AS pct FROM pageviews WHERE nt_ttfb IS NOT NULL AND nt_load_event IS NOT NULL`);

      const comments = [];
      const lcp = avgVitals.avg_lcp;
      if (lcp != null) {
        if (lcp < 2500) comments.push({ type:'good', title:'Page Load Performance is Good', body:`Average LCP is <strong>${lcp}ms</strong>, within Google's "Good" threshold of under 2500ms. Users see the main content quickly.` });
        else if (lcp < 4000) comments.push({ type:'warn', title:'Page Load Needs Improvement', body:`Average LCP is <strong>${lcp}ms</strong>, in Google's "Needs Improvement" range. Consider optimizing images or adding preloading.` });
        else comments.push({ type:'bad', title:'Page Load is Slow', body:`Average LCP is <strong>${lcp}ms</strong>, exceeding Google's 4000ms poor threshold. Users may leave before content appears.` });
      }

      const ttfb = avgVitals.avg_ttfb, pct = ttfbShare ? ttfbShare.pct : null;
      if (ttfb != null && pct != null) {
        if (pct > 40) comments.push({ type:'warn', title:'Server Response is the Biggest Bottleneck', body:`TTFB averages <strong>${ttfb}ms</strong> and accounts for <strong>${pct}%</strong> of total load time. Adding caching would have the highest impact on speed.` });
        else comments.push({ type:'good', title:'Server Response Time is Healthy', body:`TTFB averages <strong>${ttfb}ms</strong>, only ${pct}% of total load time. The server responds quickly.` });
      }

      if (topItems.length >= 2) {
        try {
          const a = JSON.parse(topItems[0].event_data), b = JSON.parse(topItems[1].event_data);
          const ratio = topItems[1].n > 0 ? (topItems[0].n / topItems[1].n).toFixed(1) : '∞';
          comments.push({ type:'info', title:`${a.name} Dominates Cart Clicks`, body:`<strong>${a.name}</strong> added to cart ${topItems[0].n} times vs ${topItems[1].n} for ${b.name} — a <strong>${ratio}x</strong> difference. Brand recognition rather than price is the likely driver.` });
        } catch(e) {}
      }

      const avgSecs = exitAvg ? exitAvg.avg_seconds : null;
      if (avgSecs != null) {
        if (avgSecs < 10) comments.push({ type:'warn', title:'Users Are Leaving Very Quickly', body:`Average time on page is only <strong>${avgSecs}s</strong>. Users may be bouncing due to slow load times or unmet expectations.` });
        else comments.push({ type:'info', title:'Session Engagement is Normal', body:`Users spend an average of <strong>${avgSecs}s</strong> on the page, expected for a simple two-item product listing.` });
      }

      const errs = errCount.n;
      if (errs === 0) comments.push({ type:'good', title:'No Errors Detected', body:'Zero JS errors, resource failures, or promise rejections recorded across all tracked sessions.' });
      else comments.push({ type:'bad', title:`${errs} Error${errs>1?'s':''} Recorded`, body:`<strong>${errs}</strong> error${errs>1?'s have':' has'} been captured. Check the <a href="/errors" style="color:#3b82f6">Errors table</a> to identify what is failing.` });

      const commentHTML = comments.map(c => `
        <div class="comment-card ${c.type==='warn'?'warn':c.type==='bad'?'bad':c.type==='good'?'good':''}">
          <div class="comment-title">${c.title}</div>
          <div class="comment-text">${c.body}</div>
        </div>`).join('');

      html(res, legacyPage('Dashboard', user.displayName, `
        <div class="cards">
          <div class="card"><div class="label">Sessions</div><div class="value">${sessCount.n}</div></div>
          <div class="card"><div class="label">Pageviews</div><div class="value">${pvCount.n}</div></div>
          <div class="card"><div class="label">Cart Clicks</div><div class="value">${evtCount.n}</div></div>
          <div class="card"><div class="label">Errors</div><div class="value">${errCount.n}</div></div>
        </div>
        <div class="cards">
          <div class="card"><div class="label">Avg LCP (ms)</div><div class="value">${avgVitals.avg_lcp||'—'}</div></div>
          <div class="card"><div class="label">Avg CLS</div><div class="value">${avgVitals.avg_cls||'—'}</div></div>
          <div class="card"><div class="label">Avg INP (ms)</div><div class="value">${avgVitals.avg_inp||'—'}</div></div>
          <div class="card"><div class="label">Avg TTFB (ms)</div><div class="value">${avgVitals.avg_ttfb||'—'}</div></div>
        </div>
        <div class="comment-section">
          <h2>Analyst Commentary</h2>
          ${commentHTML || '<p style="color:#94a3b8;font-size:13px">No data yet.</p>'}
        </div>`));
    } catch(e) { res.writeHead(500); res.end('DB error: ' + e.message); }
    return;
  }

  // ── Admin panel (super_admin only) ──────────────────────────
  if (urlPath === '/admin') {
    if (user.role !== 'super_admin') return forbidden(res);
    try {
      const users = await dbQuery(`SELECT id, email, display_name, role, sections, last_login FROM users ORDER BY id ASC`);
      const rows = users.map(u => `
        <tr>
          <td>${u.id}</td>
          <td>${u.email}</td>
          <td>${u.display_name}</td>
          <td><span style="background:${u.role==='super_admin'?'#1e293b':u.role==='analyst'?'#3b82f6':'#64748b'};color:#fff;padding:2px 8px;border-radius:4px;font-size:11px">${u.role}</span></td>
          <td style="font-size:12px;color:#64748b">${u.sections||'—'}</td>
          <td style="font-size:12px">${u.last_login ? String(u.last_login).slice(0,19) : 'Never'}</td>
          <td><a href="/admin/delete/${u.id}" onclick="return confirm('Delete this user?')" style="color:#ef4444;font-size:12px">Delete</a></td>
        </tr>`).join('');

      html(res, legacyPage('User Admin', user.displayName, `
        <div class="table-wrap" style="margin-bottom:32px">
          <table>
            <thead><tr><th>ID</th><th>Email</th><th>Name</th><th>Role</th><th>Sections</th><th>Last Login</th><th></th></tr></thead>
            <tbody>${rows || '<tr><td colspan="7" style="text-align:center;padding:24px;color:#94a3b8">No users</td></tr>'}</tbody>
          </table>
        </div>
        <div style="background:#fff;border-radius:8px;padding:24px;box-shadow:0 1px 3px rgba(0,0,0,.1);max-width:480px">
          <h3 style="font-size:15px;margin-bottom:16px;color:#1e293b">Create New User</h3>
          <form method="POST" action="/admin/create">
            <label style="display:block;font-size:13px;color:#64748b;margin-bottom:4px">Email</label>
            <input name="email" type="email" required style="width:100%;border:1px solid #e2e8f0;border-radius:6px;padding:8px 12px;font-size:14px;margin-bottom:12px">
            <label style="display:block;font-size:13px;color:#64748b;margin-bottom:4px">Display Name</label>
            <input name="display_name" required style="width:100%;border:1px solid #e2e8f0;border-radius:6px;padding:8px 12px;font-size:14px;margin-bottom:12px">
            <label style="display:block;font-size:13px;color:#64748b;margin-bottom:4px">Password</label>
            <input name="password" type="password" required style="width:100%;border:1px solid #e2e8f0;border-radius:6px;padding:8px 12px;font-size:14px;margin-bottom:12px">
            <label style="display:block;font-size:13px;color:#64748b;margin-bottom:4px">Role</label>
            <select name="role" style="width:100%;border:1px solid #e2e8f0;border-radius:6px;padding:8px 12px;font-size:14px;margin-bottom:12px">
              <option value="viewer">viewer</option>
              <option value="analyst">analyst</option>
              <option value="super_admin">super_admin</option>
            </select>
            <label style="display:block;font-size:13px;color:#64748b;margin-bottom:4px">Sections (analyst only, comma-separated)</label>
            <input name="sections" placeholder="overview,performance,errors" style="width:100%;border:1px solid #e2e8f0;border-radius:6px;padding:8px 12px;font-size:14px;margin-bottom:16px">
            <button type="submit" style="background:#1e293b;color:#fff;border:none;border-radius:6px;padding:10px 20px;font-size:14px;cursor:pointer">Create User</button>
          </form>
        </div>`));
    } catch(e) { res.writeHead(500); res.end('DB error: ' + e.message); }
    return;
  }

  if (urlPath.startsWith('/admin/create') && method === 'POST') {
    if (user.role !== 'super_admin') return forbidden(res);
    const raw  = await readBody(req);
    const body = qs.parse(raw);
    try {
      const hash = await bcrypt.hash(body.password, 10);
      await dbQuery(
        `INSERT INTO users (email, display_name, password_hash, role, sections) VALUES (?,?,?,?,?)`,
        [body.email, body.display_name, hash, body.role, body.sections || null]
      );
      redirect(res, '/admin');
    } catch(e) {
      html(res, legacyPage('Error', user.displayName, `<p style="color:#ef4444">${e.message}</p><a href="/admin">Back</a>`));
    }
    return;
  }

  if (urlPath.startsWith('/admin/delete/') && method === 'GET') {
    if (user.role !== 'super_admin') return forbidden(res);
    const delId = parts[3];
    try {
      const [check] = await dbQuery(`SELECT COUNT(*) AS n FROM users WHERE role='super_admin'`);
      const [target] = await dbQuery(`SELECT role FROM users WHERE id=?`, [delId]);
      if (target && target.role === 'super_admin' && check.n <= 1) {
        html(res, legacyPage('Error', user.displayName, `<p style="color:#ef4444">Cannot delete the only super admin.</p><a href="/admin">Back</a>`));
        return;
      }
      await dbQuery(`DELETE FROM users WHERE id=?`, [delId]);
      redirect(res, '/admin');
    } catch(e) {
      html(res, legacyPage('Error', user.displayName, `<p style="color:#ef4444">${e.message}</p><a href="/admin">Back</a>`));
    }
    return;
  }

  // ── Pageviews table ─────────────────────────────────────────
  if (urlPath === '/table') {
    if (!canAccess(user, 'overview') && user.role !== 'super_admin') return forbidden(res);
    try {
      const rows = await dbQuery(`SELECT id, session_id, url, page_title, collected_at, lcp, cls, inp, nt_ttfb, error_count FROM pageviews ORDER BY id DESC LIMIT 100`);
      const trs = rows.map(r => `<tr><td>${r.id}</td><td style="max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${r.url||'—'}</td><td>${r.page_title||'—'}</td><td style="font-family:monospace;font-size:11px">${(r.session_id||'—').slice(0,12)}…</td><td>${r.lcp!=null?r.lcp+' ms':'—'}</td><td>${r.cls!=null?r.cls:'—'}</td><td>${r.inp!=null?r.inp+' ms':'—'}</td><td>${r.nt_ttfb!=null?r.nt_ttfb+' ms':'—'}</td><td>${r.error_count||0}</td><td style="white-space:nowrap">${String(r.collected_at).slice(0,19)}</td></tr>`).join('');
      html(res, legacyPage('Pageviews', user.displayName, `<div class="table-wrap"><table><thead><tr><th>ID</th><th>URL</th><th>Title</th><th>Session</th><th>LCP</th><th>CLS</th><th>INP</th><th>TTFB</th><th>Errors</th><th>Collected At</th></tr></thead><tbody>${trs||'<tr><td colspan="10" style="text-align:center;padding:24px;color:#94a3b8">No pageviews yet</td></tr>'}</tbody></table></div>`));
    } catch(e) { res.writeHead(500); res.end('DB error: ' + e.message); }
    return;
  }

  // ── Events table ────────────────────────────────────────────
  if (urlPath === '/events') {
    if (!canAccess(user, 'overview') && user.role !== 'super_admin') return forbidden(res);
    try {
      const rows = await dbQuery(`SELECT id, session_id, event_name, url, occurred_at, user_id FROM events ORDER BY id DESC LIMIT 100`);
      const trs = rows.map(r => `<tr><td>${r.id}</td><td>${r.event_name||'—'}</td><td style="max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${r.url||'—'}</td><td style="font-family:monospace;font-size:11px">${(r.session_id||'—').slice(0,12)}…</td><td>${r.user_id||'—'}</td><td style="white-space:nowrap">${String(r.occurred_at).slice(0,19)}</td></tr>`).join('');
      html(res, legacyPage('Events', user.displayName, `<div class="table-wrap"><table><thead><tr><th>ID</th><th>Event</th><th>URL</th><th>Session</th><th>User</th><th>Occurred At</th></tr></thead><tbody>${trs||'<tr><td colspan="6" style="text-align:center;padding:24px;color:#94a3b8">No events yet</td></tr>'}</tbody></table></div>`));
    } catch(e) { res.writeHead(500); res.end('DB error: ' + e.message); }
    return;
  }

  // ── Errors table ────────────────────────────────────────────
  if (urlPath === '/errors') {
    if (!canAccess(user, 'errors') && user.role !== 'super_admin') return forbidden(res);
    try {
      const rows = await dbQuery(`SELECT id, session_id, error_type, message, source_file, line_number, occurred_at FROM errors ORDER BY id DESC LIMIT 100`);
      const trs = rows.map(r => `<tr><td>${r.id}</td><td>${r.error_type||'—'}</td><td style="max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${r.message||'—'}</td><td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px">${r.source_file||'—'}</td><td>${r.line_number||'—'}</td><td style="font-family:monospace;font-size:11px">${(r.session_id||'—').slice(0,12)}…</td><td style="white-space:nowrap">${String(r.occurred_at).slice(0,19)}</td></tr>`).join('');
      html(res, legacyPage('Errors', user.displayName, `<div class="table-wrap"><table><thead><tr><th>ID</th><th>Type</th><th>Message</th><th>Source</th><th>Line</th><th>Session</th><th>Occurred At</th></tr></thead><tbody>${trs||'<tr><td colspan="7" style="text-align:center;padding:24px;color:#94a3b8">No errors yet</td></tr>'}</tbody></table></div>`));
    } catch(e) { res.writeHead(500); res.end('DB error: ' + e.message); }
    return;
  }

  // ── Charts ──────────────────────────────────────────────────
  if (urlPath === '/charts') {
    if (!canAccess(user, 'overview') && user.role !== 'super_admin') return forbidden(res);
    try {
      const byDay     = await dbQuery(`SELECT DATE(collected_at) AS day, COUNT(*) AS n FROM pageviews GROUP BY DATE(collected_at) ORDER BY day ASC LIMIT 14`);
      const byBrowser = await dbQuery(`SELECT CASE WHEN user_agent LIKE '%Firefox%' THEN 'Firefox' WHEN user_agent LIKE '%Edg%' THEN 'Edge' WHEN user_agent LIKE '%OPR%' THEN 'Opera' WHEN user_agent LIKE '%Chrome%' THEN 'Chrome' WHEN user_agent LIKE '%Safari%' THEN 'Safari' ELSE 'Other' END AS browser, COUNT(*) AS n FROM sessions GROUP BY browser ORDER BY n DESC`);
      const vitalsRows= await dbQuery(`SELECT ROUND(AVG(lcp),0) AS lcp, ROUND(AVG(nt_ttfb),0) AS ttfb, DATE(collected_at) AS day FROM pageviews WHERE collected_at >= DATE_SUB(NOW(), INTERVAL 14 DAY) GROUP BY DATE(collected_at) ORDER BY day ASC`);
      const dayLabels=JSON.stringify(byDay.map(r=>String(r.day).slice(0,10)));
      const dayData=JSON.stringify(byDay.map(r=>r.n));
      const browserLabels=JSON.stringify(byBrowser.map(r=>r.browser));
      const browserData=JSON.stringify(byBrowser.map(r=>r.n));
      const vitalsLabels=JSON.stringify(vitalsRows.map(r=>String(r.day).slice(0,10)));
      const lcpData=JSON.stringify(vitalsRows.map(r=>r.lcp));
      const ttfbData=JSON.stringify(vitalsRows.map(r=>r.ttfb));
      html(res, legacyPage('Charts', user.displayName, `
        <div class="charts">
          <div class="chart-box wide"><h3>Pageviews Per Day</h3><canvas id="dayChart"></canvas></div>
          <div class="chart-box"><h3>Sessions by Browser</h3><canvas id="browserChart"></canvas></div>
          <div class="chart-box"><h3>Avg LCP &amp; TTFB (ms)</h3><canvas id="vitalsChart"></canvas></div>
        </div>
        <script>
          new Chart(document.getElementById('dayChart'),{type:'bar',data:{labels:${dayLabels},datasets:[{label:'Pageviews',data:${dayData},backgroundColor:'#3b82f6',borderRadius:4}]},options:{scales:{y:{beginAtZero:true}},plugins:{legend:{display:false}}}});
          new Chart(document.getElementById('browserChart'),{type:'doughnut',data:{labels:${browserLabels},datasets:[{data:${browserData},backgroundColor:['#3b82f6','#f59e0b','#ef4444','#10b981','#8b5cf6','#06b6d4']}]},options:{plugins:{legend:{position:'bottom'}}}});
          new Chart(document.getElementById('vitalsChart'),{type:'line',data:{labels:${vitalsLabels},datasets:[{label:'LCP (ms)',data:${lcpData},borderColor:'#3b82f6',tension:0.3,fill:false},{label:'TTFB (ms)',data:${ttfbData},borderColor:'#f59e0b',tension:0.3,fill:false}]},options:{scales:{y:{beginAtZero:true}}}});
        </script>`));
    } catch(e) { res.writeHead(500); res.end('DB error: ' + e.message); }
    return;
  }

  res.writeHead(404); res.end('Not found');

}).listen(5000, '0.0.0.0', () => {
  console.log('Server running on port 5000');
  console.log('Roles: super_admin | analyst | viewer');
  console.log('Auth: POST /api/login  |  POST /api/logout  |  GET /api/me');
  console.log('Users: GET/POST/PUT/DELETE /api/users  (super_admin only)');
});